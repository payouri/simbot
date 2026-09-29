// PROTOTYPE Variant A, "Workbench": a persistent app shell. Slot rail on the left,
// one working panel in the centre, a docked run log, and a resizable inspector.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Play,
  RotateCcw,
  Terminal,
} from "lucide-react";
import type { Flow, LogLine, RunState, StageProgress } from "../flow";
import { fmtDuration, looksLikeAddonString } from "../flow";
import { CHARACTER, CONSUMABLES, FIGHT_STYLES, PRECISIONS, SLOTS, type Item, type Slot, type SlotId } from "../data";
import {
  candidatesIn,
  COMBINATION_CAP,
  equippedIn,
  heaviestSlots,
  pool,
  preselect,

  unusableIn,
  type Ranked,
  type SimOutcome,
} from "../engine";
import { DeltaBar, fmtDps, fmtPct, fmtSigned, ItemFlags, ItemIcon, ItemName, Kbd, modKey, sourceLabel, statLine, Tag } from "../kit";

export const NAME = "Workbench";

// ---------- small helpers ----------

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

const slotDef = (id: SlotId) => SLOTS.find((s) => s.id === id)!;
const fmtNum = (n: number) => n.toLocaleString("en-US");
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Btn({
  children,
  onClick,
  tone = "ghost",
  disabled,
  title,
  className,
  size = "md",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "primary" | "ghost" | "outline" | "danger";
  disabled?: boolean;
  title?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const tones = {
    primary: "bg-action text-action-ink hover:bg-action-strong disabled:bg-raised disabled:text-faint",
    ghost: "text-muted hover:bg-raised hover:text-fg disabled:text-faint disabled:hover:bg-transparent",
    outline: "border border-line-strong text-fg hover:bg-raised disabled:text-faint",
    danger: "border border-loss/50 text-loss hover:bg-loss-wash",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed",
        size === "md" ? "h-8 px-3 text-[13px]" : "h-7 px-2 text-[12px]",
        tones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

function SepV() {
  return (
    <Separator className="group relative w-px bg-line outline-none transition-colors duration-150 hover:bg-action focus-visible:bg-action">
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </Separator>
  );
}
function SepH() {
  return (
    <Separator className="relative h-px bg-line outline-none transition-colors duration-150 hover:bg-action focus-visible:bg-action">
      <span className="absolute inset-x-0 -top-1 -bottom-1" />
    </Separator>
  );
}

function PanelHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
      <div className="flex min-w-0 flex-1 items-center gap-2 font-medium text-muted">{children}</div>
      {right}
    </div>
  );
}

// ---------- top bar ----------

function TopBar({ flow, compact }: { flow: Flow; compact: boolean }) {
  const { run, step } = flow;
  const running = step === "running" && (run.status === "running" || run.status === "queued");
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 20 20" className="size-5 text-action" aria-hidden>
          <rect x="2" y="11" width="3.5" height="7" rx="1" fill="currentColor" opacity="0.5" />
          <rect x="8.25" y="6" width="3.5" height="12" rx="1" fill="currentColor" opacity="0.75" />
          <rect x="14.5" y="2" width="3.5" height="16" rx="1" fill="currentColor" />
        </svg>
        <span className="text-[14px] font-semibold tracking-[-0.01em]">simbot</span>
        {!compact && <span className="text-faint">/</span>}
        {!compact && <span className="text-[13px] text-muted">Top Gear</span>}
      </div>

      {flow.parsed && !compact && (
        <div className="ml-2 flex min-w-0 items-center gap-2 border-l border-line pl-3 text-[12.5px]">
          <span className="font-medium text-fg">{CHARACTER.name}</span>
          <span className="truncate text-muted">
            {CHARACTER.spec} {CHARACTER.className} · {CHARACTER.region}-{CHARACTER.realm} · <span className="num">{CHARACTER.equippedIlvl}</span> ilvl
          </span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        {flow.simc && !compact && (
          <span className="flex items-center gap-1.5 text-[12px] text-faint" title={`Latest on midnight: ${flow.simc.latest}`}>
            SimC <span className="num text-muted">{flow.simc.running}</span>
            {flow.simc.behind > 0 && <Tag tone="noise">{flow.simc.behind} behind</Tag>}
          </span>
        )}

        {step === "setup" && flow.parsed && <RunControl flow={flow} compact={compact} />}

        {running && (
          <span className="flex items-center gap-2 text-[12.5px]">
            <span className="relative flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-action opacity-60" />
              <span className="relative size-2 rounded-full bg-action" />
            </span>
            <span className="text-muted">{run.status === "queued" ? `Queued, position ${run.queuePosition}` : "Running"}</span>
            <span className="num text-fg">{clock(run.elapsed)}</span>
          </span>
        )}

        {step === "results" && (
          <div className="flex items-center gap-1">
            <Btn onClick={flow.backToSetup} tone="ghost" size="sm">
              <RotateCcw size={13} /> Edit and re-run
            </Btn>
            {!compact && (
              <Btn onClick={flow.newImport} tone="ghost" size="sm">
                New import
              </Btn>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function RunControl({ flow, compact }: { flow: Flow; compact: boolean }) {
  const reason = flow.overCap
    ? `Over the ${fmtNum(COMBINATION_CAP)} combination cap`
    : flow.issues.length
      ? `Fix ${slotDef(flow.issues[0].slot).label} first`
      : undefined;
  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <div className={clsx("num text-[13px] font-medium", flow.overCap ? "text-loss" : "text-fg")}>
          {fmtNum(flow.count)} <span className="font-sans font-normal text-muted">{flow.count === 1 ? "combination" : "combinations"}</span>
        </div>
        {!compact && (
          <div className="text-[11px] text-faint">
            {flow.overCap ? "cap is 10,000" : <>about <span className="num">{fmtDuration(flow.estimate)}</span> on 16 threads</>}
          </div>
        )}
      </div>
      <Btn tone="primary" onClick={flow.start} disabled={!flow.canRun} title={reason}>
        <Play size={13} fill="currentColor" /> Run
        {!compact && (
          <span className="ml-1 flex gap-0.5 opacity-70">
            <span className="num text-[10.5px]">{modKey}</span>
            <span className="text-[10.5px]">↵</span>
          </span>
        )}
      </Btn>
    </div>
  );
}

// ---------- slot rail ----------

function Rail({
  flow,
  focus,
  setFocus,
  combo,
  glow,
  skeleton,
}: {
  flow: Flow;
  focus: SlotId;
  setFocus: (s: SlotId) => void;
  combo?: Ranked;
  glow?: boolean;
  skeleton?: boolean;
}) {
  const issueSlots = new Set(flow.issues.map((i) => i.slot));
  return (
    <nav aria-label="Slots" className="flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-panel">
      <PanelHead
        right={
          flow.step === "setup" && flow.parsed ? (
            <button className="text-[11.5px] text-faint hover:text-action" onClick={() => flow.setSelection(preselect())} title="Reset to likely upgrades">
              Reset
            </button>
          ) : undefined
        }
      >
        {combo ? (combo.combo.isBaseline ? "Equipped set" : `Combination #${combo.combo.id}`) : "Slots"}
      </PanelHead>
      <ul role="listbox" aria-label="Slots" className="flex-1 overflow-y-auto py-1">
        {SLOTS.map((s) => {
          if (skeleton || !flow.parsed)
            return (
              <li key={s.id} className="flex h-[46px] items-center gap-2.5 px-3">
                <span className={clsx("size-9 rounded-[5px] border border-line bg-sunk", skeleton && "animate-pulse")} />
                <span className="flex-1">
                  <span className="block text-[12.5px] text-faint">{s.label}</span>
                  {skeleton && <span className="mt-1 block h-2 w-20 animate-pulse rounded bg-raised" />}
                </span>
              </li>
            );
          return (
            <RailRow
              key={s.id}
              slot={s}
              flow={flow}
              active={!combo && focus === s.id}
              onClick={() => setFocus(s.id)}
              combo={combo}
              glow={glow}
              issue={issueSlots.has(s.id)}
            />
          );
        })}
      </ul>
      {flow.parsed && !combo && (
        <div className="border-t border-line px-3 py-2 text-[11px] text-faint">
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> slot · <Kbd>j</Kbd> <Kbd>k</Kbd> item · <Kbd>space</Kbd> toggle
        </div>
      )}
    </nav>
  );
}

function RailRow({
  slot,
  flow,
  active,
  onClick,
  combo,
  glow,
  issue,
}: {
  slot: Slot;
  flow: Flow;
  active: boolean;
  onClick: () => void;
  combo?: Ranked;
  glow?: boolean;
  issue: boolean;
}) {
  const eq = equippedIn(slot.id);
  const cands = candidatesIn(slot.id);
  const selected = cands.filter((c) => flow.selection[c.uid]).length;
  const change = combo?.combo.changes.find((c) => c.slot === slot.id);
  const shown: Item[] = combo ? combo.combo.gear[slot.id] : eq;
  return (
    <li
      role="option"
      aria-selected={active}
      onClick={combo ? undefined : onClick}
      className={clsx(
        "flex h-[46px] items-center gap-2.5 px-3 transition-colors duration-150",
        !combo && "cursor-pointer hover:bg-raised",
        active && "bg-action-wash",
      )}
      title={change ? `${change.from.map((i) => i.name).join(" + ")} → ${change.to.map((i) => i.name).join(" + ")}` : undefined}
    >
      <span className="flex w-9 shrink-0 flex-wrap gap-0.5">
        {shown.map((it) => (
          <ItemIcon key={it.uid} item={it} size={shown.length > 1 ? "sm" : "md"} showIlvl={shown.length === 1} glow={!!change && glow && !eq.some((e) => e.uid === it.uid)} className={shown.length > 1 ? "!size-[17px]" : undefined} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx("block text-[12.5px] font-medium", active ? "text-action" : "text-fg")}>{slot.label}</span>
        <span className="block truncate text-[11.5px] text-faint">
          {combo ? (
            change ? (
              <span className="text-gain">changed</span>
            ) : (
              "equipped"
            )
          ) : (
            <>
              <span className="num">{eq.map((e) => e.ilvl).join(" / ")}</span> equipped
            </>
          )}
        </span>
      </span>
      {!combo && (
        <span className="flex items-center gap-1.5">
          {issue && <AlertTriangle size={13} className="text-loss" aria-label="Problem in this slot" />}
          <span className={clsx("num text-[11.5px]", selected ? "text-action" : "text-faint")}>
            {selected}/{cands.length}
          </span>
        </span>
      )}
    </li>
  );
}

// ---------- paste ----------

function PastePanel({ flow }: { flow: Flow }) {
  const err = flow.parse.error instanceof Error ? flow.parse.error.message : null;
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-6 pt-14 pb-24">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-balance">Paste your Addon String</h1>
        <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-muted">
          In game, type <span className="num text-fg">/simc</span> and copy the whole window. simbot reads your equipped gear, bags, Great Vault
          and talent loadouts from it.
        </p>
        <div
          className={clsx(
            "mt-5 overflow-hidden rounded-[8px] border bg-sunk transition-colors duration-150",
            err ? "border-loss/60" : "border-line-strong focus-within:border-action",
          )}
        >
          <textarea
            autoFocus
            spellCheck={false}
            value={flow.text}
            onChange={(e) => flow.setText(e.target.value)}
            onPaste={(e) => {
              const t = e.clipboardData.getData("text");
              if (looksLikeAddonString(t)) {
                e.preventDefault();
                flow.setText(t);
                flow.parse.mutate(t);
              }
            }}
            placeholder={'# SimC Addon 12.1.0-04\npaladin="Aurelith"\nlevel=90\n...'}
            aria-label="Addon String"
            aria-invalid={!!err}
            className="num block h-[300px] w-full resize-none bg-transparent p-4 text-[12.5px] leading-[1.6] text-fg outline-none placeholder:text-faint/60"
          />
          <div className="flex items-center gap-2 border-t border-line bg-panel px-3 py-2">
            <span className="text-[12px] text-faint">
              {flow.parse.isPending ? "Reading items with SimC…" : flow.text ? `${fmtNum(flow.text.split("\n").length)} lines` : "Paste detects the string on its own"}
            </span>
            <div className="ml-auto flex gap-1.5">
              <Btn tone="ghost" size="sm" onClick={flow.pasteSample}>
                <ClipboardPaste size={13} /> Use sample
              </Btn>
              <Btn tone="primary" size="sm" disabled={!flow.text.trim() || flow.parse.isPending} onClick={() => flow.parse.mutate(flow.text)}>
                Import <ArrowRight size={13} />
              </Btn>
            </div>
          </div>
        </div>
        {err && (
          <p role="alert" className="mt-3 flex max-w-[70ch] gap-2 text-[13px] text-loss">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {err}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- setup: centre panel ----------

type Tab = "candidates" | "talents" | "settings";

function SetupCenter({
  flow,
  focus,
  cursor,
  setCursor,
  tab,
  setTab,
  readOnly,
}: {
  flow: Flow;
  focus: SlotId;
  cursor: number;
  setCursor: (n: number) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  readOnly?: boolean;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "candidates", label: `Candidates · ${slotDef(focus).label}` },
    { id: "talents", label: "Talents and consumables" },
    { id: "settings", label: "Sim settings" },
  ];
  return (
    <section className="flex h-full min-w-0 flex-col bg-bg">
      <div role="tablist" className="flex h-9 shrink-0 items-end gap-1 border-b border-line px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "relative h-9 px-2.5 text-[12.5px] font-medium transition-colors duration-150",
              tab === t.id ? "text-fg" : "text-faint hover:text-muted",
            )}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-action" />}
          </button>
        ))}
        {readOnly && (
          <span className="mb-2 ml-auto flex items-center gap-1 text-[11.5px] text-faint">
            <Lock size={12} /> Input is frozen while this Sim runs
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "candidates" && <Candidates flow={flow} slot={focus} cursor={cursor} setCursor={setCursor} readOnly={readOnly} />}
        {tab === "talents" && <TalentsTab flow={flow} readOnly={readOnly} />}
        {tab === "settings" && <SettingsTab flow={flow} readOnly={readOnly} />}
      </div>
    </section>
  );
}

function Candidates({
  flow,
  slot,
  cursor,
  setCursor,
  readOnly,
}: {
  flow: Flow;
  slot: SlotId;
  cursor: number;
  setCursor: (n: number) => void;
  readOnly?: boolean;
}) {
  const [showUnusable, setShowUnusable] = useState(false);
  const eq = equippedIn(slot);
  const cands = candidatesIn(slot);
  const unusable = unusableIn(slot);
  const issue = flow.issues.find((i) => i.slot === slot);
  const def = slotDef(slot);
  const top = Math.max(...eq.map((e) => e.ilvl));
  const setAll = (on: boolean) => flow.setSelection((s) => ({ ...s, ...Object.fromEntries(cands.map((c) => [c.uid, on])) }));

  return (
    <div className="px-4 pt-3 pb-24">
      {issue && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-[6px] border border-loss/40 bg-loss-wash px-3 py-2 text-[12.5px] text-fg">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-loss" />
          <span>{issue.message}</span>
        </div>
      )}
      <div className="mb-1.5 flex items-center gap-2 text-[12px] text-faint">
        <span>
          {def.paired ? "Any two of these, as a pair. " : ""}Equipped is always included.
        </span>
        {!readOnly && cands.length > 0 && (
          <span className="ml-auto flex gap-1">
            <Btn size="sm" onClick={() => setAll(true)}>
              All
            </Btn>
            <Btn size="sm" onClick={() => setAll(false)}>
              None
            </Btn>
          </span>
        )}
      </div>
      <ul className="overflow-hidden rounded-[8px] border border-line bg-panel">
        {eq.map((it) => (
          <CandidateRow key={it.uid} item={it} top={top} checked locked />
        ))}
        {cands.map((it, i) => (
          <CandidateRow
            key={it.uid}
            item={it}
            top={top}
            checked={!!flow.selection[it.uid]}
            cursor={cursor === i}
            onToggle={readOnly ? undefined : () => { setCursor(i); flow.toggle(it.uid); }}
          />
        ))}
        {showUnusable && unusable.map((it) => <CandidateRow key={it.uid} item={it} top={top} checked={false} unusable />)}
        {cands.length === 0 && (
          <li className="border-t border-line px-3 py-4 text-[12.5px] text-faint">Nothing else for this slot in your bags or Great Vault.</li>
        )}
      </ul>
      {unusable.length > 0 && (
        <button
          onClick={() => setShowUnusable((v) => !v)}
          className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-faint hover:text-muted"
        >
          {showUnusable ? <EyeOff size={13} /> : <Eye size={13} />}
          {showUnusable ? "Hide" : "Show"} {unusable.length} unusable {unusable.length === 1 ? "item" : "items"} ({unusable.map((u) => u.unusableReason).join(", ")})
        </button>
      )}
    </div>
  );
}

function CandidateRow({
  item,
  top,
  checked,
  locked,
  unusable,
  cursor,
  onToggle,
}: {
  item: Item;
  top: number;
  checked: boolean;
  locked?: boolean;
  unusable?: boolean;
  cursor?: boolean;
  onToggle?: () => void;
}) {
  const d = item.ilvl - top;
  const interactive = !!onToggle;
  return (
    <li
      onClick={onToggle}
      aria-selected={cursor}
      className={clsx(
        "grid grid-cols-[20px_auto_1fr_auto] items-center gap-3 border-t border-line px-3 py-2 first:border-t-0 transition-colors duration-150",
        interactive && "cursor-pointer hover:bg-raised",
        cursor && "bg-raised shadow-[inset_0_0_0_1px_var(--action)]",
        unusable && "opacity-50",
      )}
    >
      <span
        role="checkbox"
        aria-checked={checked}
        aria-disabled={!interactive}
        aria-label={`${item.name} ${item.ilvl}`}
        className={clsx(
          "grid size-4 place-items-center rounded-[4px] border transition-colors duration-150",
          checked ? "border-action bg-action text-action-ink" : "border-line-strong",
          locked && "opacity-60",
        )}
      >
        {checked && (locked ? <Lock size={10} strokeWidth={3} /> : <Check size={11} strokeWidth={3} />)}
      </span>
      <ItemIcon item={item} size="md" dim={unusable} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <ItemName item={item} className="truncate text-[13px]" />
          <ItemFlags item={item} />
          {unusable && <Tag tone="loss">{item.unusableReason}, not usable</Tag>}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-faint">{statLine(item)}</span>
      </span>
      <span className="text-right">
        <span className="num block text-[13px] text-fg">{item.ilvl}</span>
        <span className="block text-[11px] text-faint">
          {locked ? (
            "Equipped"
          ) : (
            <>
              <span className={clsx("num", d > 0 ? "text-gain" : "text-faint")}>{d === 0 ? "±0" : fmtSigned(d)}</span> · {sourceLabel(item.source)}
            </>
          )}
        </span>
      </span>
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-4 border-t border-line py-3 first:border-t-0">
      <div>
        <div className="text-[12.5px] font-medium text-fg">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] text-faint">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" className="inline-flex flex-wrap rounded-[7px] border border-line bg-sunk p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={clsx(
            "h-7 rounded-[5px] px-2.5 text-[12.5px] transition-colors duration-150",
            value === o.id ? "bg-raised text-fg shadow-[0_1px_2px_oklch(0_0_0/0.25)]" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TalentsTab({ flow, readOnly }: { flow: Flow; readOnly?: boolean }) {
  const sel = flow.settings.talentLoadouts;
  const toggle = (id: string) =>
    flow.setSettings((s) => {
      const has = s.talentLoadouts.includes(id);
      const next = has ? s.talentLoadouts.filter((x) => x !== id) : [...s.talentLoadouts, id];
      return { ...s, talentLoadouts: next.length ? next : s.talentLoadouts };
    });
  return (
    <div className="max-w-[760px] px-4 pt-3 pb-24">
      <Field label="Talent loadouts" hint="Each extra loadout multiplies the combinations">
        <ul className="overflow-hidden rounded-[8px] border border-line bg-panel">
          {CHARACTER.talentLoadouts.map((l) => {
            const on = sel.includes(l.id);
            return (
              <li
                key={l.id}
                onClick={readOnly ? undefined : () => toggle(l.id)}
                className={clsx("flex items-center gap-3 border-t border-line px-3 py-2 first:border-t-0", !readOnly && "cursor-pointer hover:bg-raised")}
              >
                <span role="checkbox" aria-checked={on} className={clsx("grid size-4 place-items-center rounded-[4px] border", on ? "border-action bg-action text-action-ink" : "border-line-strong")}>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="flex-1 text-[13px]">{l.name}</span>
                <span className="num max-w-[240px] truncate text-[11px] text-faint">{l.code}</span>
              </li>
            );
          })}
        </ul>
      </Field>
      <Field label="Consumables" hint="One set for every combination in this version">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          {Object.entries(CONSUMABLES).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-faint capitalize">{k === "weaponRune" ? "Weapon" : k}</dt>
              <dd className="text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </Field>
    </div>
  );
}

function SettingsTab({ flow, readOnly }: { flow: Flow; readOnly?: boolean }) {
  const s = flow.settings;
  const set = (patch: Partial<typeof s>) => flow.setSettings((x) => ({ ...x, ...patch }));
  const input = "num h-8 w-24 rounded-[6px] border border-line-strong bg-sunk px-2 text-[13px] text-fg outline-none focus:border-action disabled:text-faint";
  return (
    <div className="max-w-[760px] px-4 pt-3 pb-24">
      <Field label="Fight style">
        <Segmented value={s.fightStyle} options={FIGHT_STYLES.map((f) => ({ id: f.id as string, label: f.label, hint: f.hint }))} onChange={(v) => set({ fightStyle: v })} disabled={readOnly} />
      </Field>
      <Field label="Duration and targets">
        <div className="flex items-center gap-3 text-[12.5px] text-muted">
          <label className="flex items-center gap-2">
            <input type="number" className={input} value={s.duration} disabled={readOnly} onChange={(e) => set({ duration: +e.target.value })} /> seconds
          </label>
          <label className="flex items-center gap-2">
            <input type="number" className={clsx(input, "w-16")} min={1} value={s.targets} disabled={readOnly} onChange={(e) => set({ targets: +e.target.value })} /> {s.targets === 1 ? "target" : "targets"}
          </label>
        </div>
      </Field>
      <Field label="Precision" hint={PRECISIONS.find((p) => p.id === s.precision)?.hint}>
        <Segmented value={s.precision} options={PRECISIONS.map((p) => ({ id: p.id, label: `${p.label} · ${p.targetError}%` }))} onChange={(v) => set({ precision: v })} disabled={readOnly} />
      </Field>
      <Field label="Raw SimC options" hint="Appended to every combination, one per line">
        <textarea
          spellCheck={false}
          disabled={readOnly}
          value={s.rawOptions}
          onChange={(e) => set({ rawOptions: e.target.value })}
          placeholder={"optimal_raid=1\nbloodlust_percent=0"}
          className="num block h-28 w-full resize-y rounded-[6px] border border-line-strong bg-sunk p-2.5 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-action"
        />
      </Field>
    </div>
  );
}

// ---------- notices under the top bar ----------

function Notices({ flow }: { flow: Flow }) {
  const [updating, setUpdating] = useState(false);
  const drift = flow.parsed?.unknownItemIds ?? [];
  const heavy = flow.overCap ? heaviestSlots(flow.selection) : [];
  if (!drift.length && !flow.overCap) return null;
  return (
    <div className="shrink-0 border-b border-line">
      {drift.length > 0 && (
        <div className="flex items-center gap-2 bg-noise-wash px-3 py-2 text-[12.5px]">
          <AlertTriangle size={14} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            {drift.length} items are unknown to SimC <span className="num">{flow.simc?.running}</span> (ids <span className="num">{drift.join(", ")}</span>), so they are left out.
            SimC <span className="num">{flow.simc?.latest}</span> is {flow.simc?.behind} commits ahead.
          </span>
          <Btn size="sm" tone="outline" onClick={() => setUpdating(true)} disabled={updating}>
            {updating ? "Updating SimC…" : "Update SimC"}
          </Btn>
        </div>
      )}
      {flow.overCap && (
        <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-loss-wash px-3 py-2 text-[12.5px]">
          <AlertTriangle size={14} className="shrink-0 text-loss" />
          <span>
            <span className="num font-medium text-loss">{fmtNum(flow.count)}</span> combinations is over the <span className="num">{fmtNum(COMBINATION_CAP)}</span> cap.
            The biggest multipliers are {heavy.map((h, i) => (
              <span key={h.slot.id}>
                {i > 0 && (i === heavy.length - 1 ? " and " : ", ")}
                <span className="text-fg">{h.slot.label}</span> (<span className="num">{h.options}</span>)
              </span>
            ))}.
          </span>
          <Btn size="sm" tone="ghost" className="ml-auto" onClick={() => flow.setSelection(preselect())}>
            Reset to likely upgrades
          </Btn>
        </div>
      )}
    </div>
  );
}

// ---------- run dock ----------

function StageLadder({ stages, compact }: { stages: StageProgress[]; compact?: boolean }) {
  return (
    <ol className={clsx("grid gap-1.5", compact ? "" : "min-w-[260px]")}>
      {stages.map((s) => {
        const pct = s.entered ? s.done / s.entered : 0;
        return (
          <li key={s.plan.index} className="grid grid-cols-[20px_1fr_auto] items-center gap-2 text-[12px]">
            <span
              className={clsx(
                "num grid size-5 place-items-center rounded-full border text-[10.5px]",
                s.state === "done" && "border-action bg-action text-action-ink",
                s.state === "running" && "border-action text-action",
                s.state === "pending" && "border-line-strong text-faint",
                s.state === "stopped" && "border-loss text-loss",
              )}
            >
              {s.state === "done" ? <Check size={11} strokeWidth={3} /> : s.plan.index}
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline justify-between gap-2">
                <span className={clsx(s.state === "pending" ? "text-faint" : "text-fg")}>{s.plan.label}</span>
                <span className="num text-[11px] text-faint">
                  {fmtNum(s.done)}/{fmtNum(s.entered)} × {fmtNum(s.plan.iterations)}
                </span>
              </span>
              <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-line">
                <span
                  className={clsx("block h-full rounded-full transition-[width] duration-200 ease-linear", s.state === "stopped" ? "bg-loss" : "bg-action")}
                  style={{ width: `${(s.state === "done" ? 1 : pct) * 100}%` }}
                />
              </span>
            </span>
            <span className="num w-[70px] text-right text-[11px]">
              {s.survivors !== undefined && s.state === "done" ? (
                <span className="text-muted">→ {fmtNum(s.survivors)} kept</span>
              ) : s.state === "stopped" ? (
                <span className="text-loss">stopped</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const LOG_TONE: Record<LogLine["kind"], string> = {
  info: "text-muted",
  stage: "text-fg",
  progress: "text-muted",
  cull: "text-action",
  error: "text-loss",
  done: "text-gain",
  warn: "text-fg",
};

function LogStream({ log }: { log: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      role="log"
      aria-live="polite"
      className="num min-h-0 flex-1 overflow-y-auto bg-sunk px-3 py-2 text-[12px] leading-[1.7]"
    >
      {log.map((l) => (
        <div key={l.id} className="grid animate-[fadein_200ms_ease-out] grid-cols-[48px_1fr] gap-2">
          <span className="text-faint">{clock(l.t)}</span>
          <span className={clsx(LOG_TONE[l.kind], "break-words")}>{l.text}</span>
        </div>
      ))}
      {log.length === 0 && <div className="text-faint">Waiting for SimC…</div>}
      <style>{"@keyframes fadein{from{opacity:0}to{opacity:1}}"}</style>
    </div>
  );
}

function RunDock({ flow, compact }: { flow: Flow; compact?: boolean }) {
  const { run } = flow;
  const [confirm, setConfirm] = useState(false);
  const active = run.status === "running" || run.status === "queued";
  const statusText =
    run.status === "queued"
      ? `Queued, position ${run.queuePosition}`
      : run.status === "running"
        ? `Stage ${run.stages.find((s) => s.state === "running")?.plan.index ?? 1} of ${run.stages.length}`
        : run.status === "failed"
          ? "Failed"
          : run.status === "cancelled"
            ? run.discarded
              ? "Discarded"
              : "Stopped"
            : run.status === "succeeded"
              ? "Done"
              : "Idle";
  return (
    <section aria-label="Run" className="flex h-full min-h-0 flex-col bg-panel">
      <PanelHead
        right={
          active ? (
            confirm ? (
              <span className="flex items-center gap-1">
                <Btn size="sm" tone="outline" onClick={() => flow.stop(true)}>
                  Stop and keep results
                </Btn>
                <Btn size="sm" tone="danger" onClick={() => flow.stop(false)}>
                  Discard
                </Btn>
                <Btn size="sm" onClick={() => setConfirm(false)}>
                  Keep running
                </Btn>
              </span>
            ) : (
              <Btn size="sm" tone="ghost" onClick={() => setConfirm(true)}>
                <CircleStop size={13} /> Stop
              </Btn>
            )
          ) : run.status === "failed" ? (
            <span className="flex items-center gap-1">
              <Btn size="sm" tone="outline" onClick={flow.backToSetup}>
                <Copy size={13} /> Copy to new Draft
              </Btn>
              <Btn size="sm" tone="primary" onClick={flow.start}>
                <RotateCcw size={13} /> Retry
              </Btn>
            </span>
          ) : run.discarded ? (
            <Btn size="sm" tone="outline" onClick={flow.backToSetup}>
              Back to setup
            </Btn>
          ) : undefined
        }
      >
        <Terminal size={13} />
        <span className={clsx(run.status === "failed" ? "text-loss" : "text-fg")}>{statusText}</span>
        <span className="num text-faint">
          {clock(run.elapsed)}
          {active && run.eta > 0 && <> · about {fmtDuration(run.eta)} left</>}
        </span>
      </PanelHead>
      <div className={clsx("flex min-h-0 flex-1", compact ? "flex-col" : "flex-row")}>
        <div className={clsx("shrink-0 p-3", compact ? "border-b border-line" : "w-[340px] border-r border-line")}>
          <StageLadder stages={run.stages} compact={compact} />
          {!compact && (
            <p className="mt-3 text-[11.5px] leading-[1.5] text-faint">
              Each stage re-sims the survivors at higher precision. A combination stays in when it is within the error band of the leader. Your
              equipped set runs through every stage.
            </p>
          )}
        </div>
        <LogStream log={run.log} />
      </div>
    </section>
  );
}

// ---------- results ----------

/** Rank among the alternatives: the equipped set is pinned, not counted. */
const shownRank = (r: Ranked, o: SimOutcome) => (r.combo.isBaseline ? 0 : r.rank - (o.baseline.rank < r.rank ? 1 : 0));

function toneOf(r: Ranked): "gain" | "loss" | "noise" | "base" {
  if (r.combo.isBaseline) return "base";
  if (r.deltaPct - r.errorPct > 0) return "gain";
  if (r.deltaPct + r.errorPct < 0) return "loss";
  return "noise";
}

function VerdictLine({ run }: { run: RunState }) {
  const v = run.verdict;
  if (!v) return null;
  const color = { upgrade: "text-gain", equipped: "text-fg", noise: "text-fg", partial: "text-fg" }[v.kind];
  return (
    <div className="shrink-0 border-b border-line px-4 pt-4 pb-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {v.kind === "partial" && <Tag tone="loss">Provisional</Tag>}
        {v.kind === "noise" && <Tag tone="noise">Within noise</Tag>}
        {v.kind === "equipped" && <Tag tone="noise">No upgrade</Tag>}
        <h1 className={clsx("text-[19px] font-semibold tracking-[-0.015em]", color)}>{v.headline}</h1>
      </div>
      <p className="mt-1 max-w-[72ch] text-[13px] text-muted">{v.detail}</p>
    </div>
  );
}

type Row = { kind: "label"; text: string } | { kind: "row"; r: Ranked };

function Ranking({
  outcome,
  selected,
  setSelected,
  onOpen,
  compact,
}: {
  outcome: SimOutcome;
  selected: number;
  setSelected: (id: number) => void;
  onOpen?: () => void;
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const finalStage = Math.max(...outcome.ranked.map((r) => r.last.stage));
  const [min, max] = useMemo(() => {
    let lo = 0, hi = 0;
    for (const r of outcome.ranked) {
      lo = Math.min(lo, r.deltaPct - r.errorPct);
      hi = Math.max(hi, r.deltaPct + r.errorPct);
    }
    const pad = (hi - lo) * 0.06 || 0.5;
    return [lo - pad, hi + pad];
  }, [outcome]);

  const rows: Row[] = useMemo(() => {
    const others = outcome.ranked.filter((r) => !r.combo.isBaseline);
    const noise = others.filter((r) => r.withinNoiseOfBest);
    const out: Row[] = [];
    if (noise.length >= 2) {
      out.push({ kind: "label", text: `Within noise of #1 · ${noise.length} combinations` });
      noise.forEach((r) => out.push({ kind: "row", r }));
      out.push({ kind: "label", text: "Clearly behind" });
      others.filter((r) => !r.withinNoiseOfBest).forEach((r) => out.push({ kind: "row", r }));
    } else others.forEach((r) => out.push({ kind: "row", r }));
    return out;
  }, [outcome]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].kind === "label" ? 30 : 48),
    overscan: 12,
  });

  const flat = useMemo(() => outcome.ranked.map((r) => r.combo.id), [outcome]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const i = flat.indexOf(selected);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelected(flat[Math.min(flat.length - 1, i + 1)]);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected(flat[Math.max(0, i - 1)]);
      } else if (e.key === "Enter") onOpen?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selected, setSelected, onOpen]);

  useEffect(() => {
    const idx = rows.findIndex((x) => x.kind === "row" && x.r.combo.id === selected);
    if (idx >= 0) v.scrollToIndex(idx, { align: "auto" });
  }, [selected, rows, v]);

  const ticks = useMemo(() => {
    const step = niceStep((max - min) / 5);
    const out: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) out.push(+t.toFixed(4));
    return out;
  }, [min, max]);

  const grid = compact
    ? "grid grid-cols-[22px_92px_minmax(80px,1fr)_62px] items-center gap-2"
    : "grid grid-cols-[34px_104px_minmax(140px,1fr)_minmax(0,1.1fr)] items-center gap-3";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={clsx(grid, "h-8 shrink-0 border-b border-line px-4 text-[11px] text-faint")}>
        <span>#</span>
        <span>vs equipped</span>
        <span className="relative h-full">
          {ticks.map((t) => (
            <span key={t} className="num absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${((t - min) / (max - min)) * 100}%` }}>
              {t === 0 ? "0" : `${t > 0 ? "+" : "−"}${Math.abs(t)}%`}
            </span>
          ))}
        </span>
        <span>{compact ? "" : "Changed slots"}</span>
      </div>
      <RankRow r={outcome.baseline} rank={0} compact={compact} grid={grid} min={min} max={max} finalStage={finalStage} selected={selected === outcome.baseline.combo.id} onClick={() => setSelected(outcome.baseline.combo.id)} pinned />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Ranked combinations">
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            return (
              <div key={vi.key} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: vi.size }}>
                {row.kind === "label" ? (
                  <div className="flex h-full items-end px-4 pb-1.5 text-[11.5px] font-medium text-muted">{row.text}</div>
                ) : (
                  <RankRow
                    r={row.r}
                    rank={shownRank(row.r, outcome)}
                    compact={compact}
                    grid={grid}
                    min={min}
                    max={max}
                    finalStage={finalStage}
                    selected={selected === row.r.combo.id}
                    onClick={() => setSelected(row.r.combo.id)}
                    onDoubleClick={onOpen}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line px-4 text-[11px] text-faint">
        <span className="num">{fmtNum(outcome.ranked.length)}</span> ranked
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 border-x border-noise bg-noise-wash" /> ± error band
        </span>
        <span className="ml-auto">
          <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>↵</Kbd> open
        </span>
      </div>
    </div>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

function RankRow({
  r,
  grid,
  min,
  max,
  finalStage,
  selected,
  onClick,
  onDoubleClick,
  pinned,
  rank,
  compact,
}: {
  r: Ranked;
  rank: number;
  compact?: boolean;
  grid: string;
  min: number;
  max: number;
  finalStage: number;
  selected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  pinned?: boolean;
}) {
  const tone = toneOf(r);
  const changed = r.combo.changes.flatMap((c) => c.to.filter((t) => !c.from.some((f) => f.uid === t.uid)));
  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={clsx(
        grid,
        "h-12 cursor-pointer px-4 transition-colors duration-150",
        pinned ? "shrink-0 border-b border-line bg-panel" : r.withinNoiseOfBest ? "bg-noise-wash/60 hover:bg-raised" : "hover:bg-raised",
        selected && "!bg-action-wash shadow-[inset_0_0_0_1px_var(--action)]",
      )}
    >
      <span className="num text-[12px] text-faint">{pinned ? "" : rank}</span>
      <span className="leading-tight">
        <span className={clsx("num block text-[13px] font-medium", { gain: "text-gain", loss: "text-loss", noise: "text-muted", base: "text-fg" }[tone])}>
          {r.combo.isBaseline ? fmtDps(r.last.mean) : fmtPct(r.deltaPct)}
        </span>
        <span className="num block text-[11px] text-faint">{r.combo.isBaseline ? "DPS, equipped" : `±${r.errorPct.toFixed(2)}% · ${fmtSigned(r.delta)}`}</span>
      </span>
      <DeltaBar deltaPct={r.deltaPct} errorPct={r.errorPct} min={min} max={max} tone={tone} />
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {r.combo.isBaseline ? (
          <span className="text-[12px] text-muted">{compact ? "Equipped" : "Your equipped set"}</span>
        ) : compact ? (
          <span className="num text-[11.5px] text-muted">{r.combo.changes.length} changes</span>
        ) : (
          changed.map((it) => <ItemIcon key={it.uid} item={it} size="sm" showIlvl />)
        )}
        {r.combo.loadout !== "raid" && <Tag>M+ cleave</Tag>}
        {r.last.stage < finalStage && <Tag tone="noise" className="ml-auto">stage {r.last.stage}</Tag>}
      </span>
    </div>
  );
}

function Inspector({ r, outcome, flow, glow }: { r: Ranked; outcome: SimOutcome; flow: Flow; glow: boolean }) {
  const isTop = r.rank === outcome.ranked[0].rank && !r.combo.isBaseline;
  const [recap, setRecap] = useState(false);
  const tone = toneOf(r);
  return (
    <aside aria-label="Combination detail" className="flex h-full min-h-0 flex-col bg-panel">
      <PanelHead right={<span className="num text-faint">{r.combo.isBaseline ? "baseline" : `rank ${shownRank(r, outcome)}`}</span>}>
        {r.combo.isBaseline ? "Equipped set" : `Combination #${r.combo.id}`}
      </PanelHead>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-24">
        <div className="flex items-baseline gap-3">
          <span className={clsx("num text-[22px] font-semibold tracking-[-0.02em]", { gain: "text-gain", loss: "text-loss", noise: "text-fg", base: "text-fg" }[tone])}>
            {r.combo.isBaseline ? fmtDps(r.last.mean) : fmtPct(r.deltaPct)}
          </span>
          <span className="num text-[12.5px] text-muted">
            {r.combo.isBaseline ? "DPS" : `±${r.errorPct.toFixed(2)}% · ${fmtDps(r.last.mean)} DPS`}
          </span>
        </div>
        {tone === "noise" && <p className="mt-1 text-[12px] text-faint">The error band crosses zero: this may be no better than what you wear.</p>}
        {r.last.stage < outcome.stages.length && (
          <p className="mt-1 text-[12px] text-faint">
            Last measured at stage {r.last.stage}. {r.last.survived ? "The run stopped before it went further." : "It was culled there."}
          </p>
        )}

        <h2 className="mt-5 mb-2 text-[12px] font-medium text-muted">
          {r.combo.changes.length ? `${r.combo.changes.length} ${r.combo.changes.length === 1 ? "change" : "changes"} from equipped` : "No changes from equipped"}
        </h2>
        <ul className="overflow-hidden rounded-[8px] border border-line">
          {r.combo.changes.map((c) => (
            <li key={c.slot} className="grid grid-cols-[72px_1fr] gap-3 border-t border-line px-3 py-2.5 first:border-t-0">
              <span className="pt-0.5 text-[12px] text-faint">{slotDef(c.slot).label}</span>
              <span className="grid gap-1.5">
                {c.to.map((t, i) => {
                  const from = c.from.find((f) => f.uid === t.uid) ? t : c.from[i];
                  const same = from?.uid === t.uid;
                  return (
                    <span key={t.uid} className="flex min-w-0 items-center gap-2">
                      {same ? (
                        <span className="w-[62px] text-[11px] text-faint">kept</span>
                      ) : (
                        <span className="flex items-center gap-1 opacity-70">
                          <ItemIcon item={from} size="sm" />
                          <ChevronRight size={12} className="text-faint" />
                        </span>
                      )}
                      <ItemIcon item={t} size="md" showIlvl glow={!same && isTop && glow} />
                      <span className="min-w-0">
                        <ItemName item={t} className="block truncate text-[12.5px]" />
                        <span className="num block text-[11px] text-faint">
                          {same ? `${t.ilvl}` : `${from.ilvl} → ${t.ilvl}`} · {sourceLabel(t.source)}
                        </span>
                      </span>
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
          {r.combo.changes.length === 0 && <li className="px-3 py-3 text-[12.5px] text-faint">This is exactly what you have on.</li>}
        </ul>

        <h2 className="mt-5 mb-2 text-[12px] font-medium text-muted">Stages</h2>
        <div className="overflow-x-auto rounded-[8px] border border-line">
          <table className="num w-full text-[11.5px]">
            <thead className="text-faint">
              <tr className="[&>th]:px-2.5 [&>th]:py-1.5 [&>th]:text-right [&>th]:font-normal">
                <th className="!text-left" />
                {r.stages.map((s) => (
                  <th key={s.stage}>
                    Stage {s.stage}
                    {!s.survived && <span className="ml-1 text-loss">culled</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Iterations", (s) => fmtNum(s.iterations)],
                  ["Mean", (s) => fmtDps(s.mean)],
                  ["Error", (s) => `±${fmtDps(s.error)}`],
                  ["Median", (s) => fmtDps(s.median)],
                  ["Min", (s) => fmtDps(s.min)],
                  ["Max", (s) => fmtDps(s.max)],
                  ["Std dev", (s) => fmtDps(s.stdDev)],
                ] as [string, (s: Ranked["stages"][number]) => string][]
              ).map(([label, f]) => (
                <tr key={label} className="border-t border-line [&>td]:px-2.5 [&>td]:py-1.5 [&>td]:text-right">
                  <td className="!text-left font-sans text-faint">{label}</td>
                  {r.stages.map((s, i) => (
                    <td key={s.stage} className={i === r.stages.length - 1 ? "text-fg" : "text-muted"}>
                      {f(s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button onClick={() => setRecap((x) => !x)} className="mt-5 flex items-center gap-1 text-[12px] font-medium text-muted hover:text-fg" aria-expanded={recap}>
          {recap ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Settings this Sim ran with
        </button>
        {recap && (
          <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[12px]">
            {[
              ["Fight style", flow.settings.fightStyle],
              ["Duration", `${flow.settings.duration}s, ${flow.settings.targets} target`],
              ["Precision", PRECISIONS.find((p) => p.id === flow.settings.precision)?.label],
              ["Loadout", r.combo.loadout === "raid" ? "Raid single target" : "M+ cleave"],
              ["Consumables", `${CONSUMABLES.flask}, ${CONSUMABLES.food}`],
              ["SimC", flow.simc?.running],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-faint">{k}</dt>
                <dd className="text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </aside>
  );
}

function Results({ flow, desktop }: { flow: Flow; desktop: boolean }) {
  const outcome = flow.run.outcome!;
  const [selected, setSelected] = useState(outcome.ranked[0].combo.id);
  const [glow, setGlow] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setGlow(true), 280);
    return () => clearTimeout(t);
  }, []);
  const layout = useDefaultLayout({ id: "tg-a-results", storage: localStorage });
  const sel = outcome.ranked.find((r) => r.combo.id === selected) ?? outcome.ranked[0];

  if (!desktop)
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <VerdictLine run={flow.run} />
        <div className="h-[56vh] shrink-0 border-b border-line">
          <Ranking compact outcome={outcome} selected={selected} setSelected={setSelected} onOpen={() => detailRef.current?.scrollIntoView({ behavior: "smooth" })} />
        </div>
        <div ref={detailRef}>
          <Inspector r={sel} outcome={outcome} flow={flow} glow={glow} />
        </div>
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1">
      <Rail flow={flow} focus="head" setFocus={() => {}} combo={sel} glow={glow && sel.rank === 1} />
      <Group orientation="horizontal" id="tg-a-results" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged} className="min-w-0 flex-1">
        <Panel id="ranking" defaultSize="62" minSize={420} className="flex min-h-0 flex-col bg-bg">
          <VerdictLine run={flow.run} />
          <div className="min-h-0 flex-1">
            <Ranking outcome={outcome} selected={selected} setSelected={setSelected} />
          </div>
        </Panel>
        <SepV />
        <Panel id="inspector" defaultSize="38" minSize={320}>
          <Inspector r={sel} outcome={outcome} flow={flow} glow={glow} />
        </Panel>
      </Group>
    </div>
  );
}

// ---------- the variant ----------

export function VariantA({ flow }: { flow: Flow }) {
  const desktop = useMedia("(min-width: 768px)");
  const [focus, setFocus] = useState<SlotId>("head");
  const [cursor, setCursor] = useState(0);
  const [tab, setTab] = useState<Tab>("candidates");
  const dockLayout = useDefaultLayout({ id: "tg-a-run", storage: localStorage });

  // setup keyboard: ↑/↓ slot, j/k item, space toggles
  useEffect(() => {
    if (flow.step !== "setup" || !flow.parsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
      const si = SLOTS.findIndex((s) => s.id === focus);
      const cands = candidatesIn(focus);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = SLOTS[(si + (e.key === "ArrowDown" ? 1 : -1) + SLOTS.length) % SLOTS.length].id;
        setFocus(next);
        setCursor(0);
        setTab("candidates");
      } else if (e.key === "j") setCursor((c) => Math.min(cands.length - 1, c + 1));
      else if (e.key === "k") setCursor((c) => Math.max(0, c - 1));
      else if (e.key === " " && tab === "candidates" && cands[cursor]) {
        e.preventDefault();
        flow.toggle(cands[cursor].uid);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow, focus, cursor, tab]);

  const pickSlot = (s: SlotId) => {
    setFocus(s);
    setCursor(0);
    setTab("candidates");
  };

  const { step, run } = flow;
  const showResults = step === "results" && !!run.outcome;
  const showRun = step === "running" || (step === "results" && !run.outcome);

  let body: ReactNode;
  if (step === "paste" || !flow.parsed) {
    body = (
      <div className="flex min-h-0 flex-1">
        {desktop && <Rail flow={flow} focus={focus} setFocus={setFocus} skeleton={flow.parse.isPending} />}
        <main className="min-w-0 flex-1 bg-bg">
          <PastePanel flow={flow} />
        </main>
      </div>
    );
  } else if (showResults) {
    body = <Results key={run.outcome!.ranked.length + String(run.outcome!.partial)} flow={flow} desktop={desktop} />;
  } else if (showRun) {
    body = desktop ? (
      <div className="flex min-h-0 flex-1">
        <Rail flow={flow} focus={focus} setFocus={pickSlot} />
        <Group orientation="vertical" id="tg-a-run" defaultLayout={dockLayout.defaultLayout} onLayoutChanged={dockLayout.onLayoutChanged} className="min-w-0 flex-1">
          <Panel id="frozen" defaultSize="42" minSize={120}>
            <SetupCenter flow={flow} focus={focus} cursor={-1} setCursor={() => {}} tab={tab} setTab={setTab} readOnly />
          </Panel>
          <SepH />
          <Panel id="dock" defaultSize="58" minSize={180}>
            <RunDock flow={flow} />
          </Panel>
        </Group>
      </div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col pb-16">
        <RunDock flow={flow} compact />
      </div>
    );
  } else {
    // setup
    body = desktop ? (
      <div className="flex min-h-0 flex-1">
        <Rail flow={flow} focus={focus} setFocus={pickSlot} />
        <main className="min-w-0 flex-1">
          <SetupCenter flow={flow} focus={focus} cursor={cursor} setCursor={setCursor} tab={tab} setTab={setTab} />
        </main>
      </div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-3 py-2">
          {SLOTS.map((s) => {
            const n = pool(s.id, flow.selection).length - equippedIn(s.id).length;
            return (
              <button
                key={s.id}
                onClick={() => pickSlot(s.id)}
                className={clsx(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px]",
                  focus === s.id ? "border-action bg-action-wash text-action" : "border-line text-muted",
                )}
              >
                {s.label}
                <span className="num text-faint">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="min-h-0 flex-1">
          <SetupCenter flow={flow} focus={focus} cursor={cursor} setCursor={setCursor} tab={tab} setTab={setTab} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <TopBar flow={flow} compact={!desktop} />
      {step === "setup" && flow.parsed && <Notices flow={flow} />}
      {body}
    </div>
  );
}

