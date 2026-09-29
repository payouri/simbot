// Variant B setup: the sheet is the picker; the centre column is the command column.

import clsx from "clsx";
import { AlertTriangle, Check, ChevronDown, CircleAlert, Lock, Play, X } from "lucide-react";
import { useState } from "react";
import {
  CHARACTER,
  CONSUMABLES,
  FIGHT_STYLES,
  type Item,
  PRECISIONS,
  type SlotId,
} from "../../data";
import {
  COMBINATION_CAP,
  candidatesIn,
  equippedIn,
  heaviestSlots,
  pool,
  unusableIn,
} from "../../engine";
import { type Flow, fmtDuration } from "../../flow";
import { ItemFlags, ItemIcon, ItemName, Kbd, modKey, sourceLabel, statLine, Tag } from "../../kit";
import { focusSlot, LEFT, Sheet, type Side, SlotTile, slotLabel, useIsPhone } from "./doll";

export function Setup({ flow }: { flow: Flow }) {
  const phone = useIsPhone();
  const [open, setOpen] = useState<SlotId | null>(null);
  const openSide: "left" | "right" | null = open ? (LEFT.includes(open) ? "left" : "right") : null;

  const tray = open ? (
    <Tray
      key={open}
      slot={open}
      flow={flow}
      phone={phone}
      onClose={() => {
        const s = open;
        setOpen(null);
        requestAnimationFrame(() => focusSlot(s));
      }}
    />
  ) : undefined;

  const renderSlot = (id: SlotId, side: Side) => {
    const eq = equippedIn(id);
    const cands = candidatesIn(id);
    const chosen = cands.filter((c) => flow.selection[c.uid]).length;
    const issue = flow.issues.some((i) => i.slot === id);
    return (
      <SlotTile
        slot={id}
        side={side}
        items={eq}
        open={open === id}
        issue={issue}
        onClick={() => setOpen((o) => (o === id ? null : id))}
        meta={
          cands.length === 0 ? (
            <span className="text-faint">No candidates</span>
          ) : (
            <span className={clsx("num", chosen > 0 && "text-action")}>
              {chosen} of {cands.length} candidates
            </span>
          )
        }
      />
    );
  };

  return (
    <Sheet
      phone={phone}
      renderSlot={renderSlot}
      leftTray={openSide === "left" || (phone && open) ? tray : undefined}
      rightTray={openSide === "right" && !phone ? tray : undefined}
      center={<Command flow={flow} />}
    />
  );
}

function Tray({
  slot,
  flow,
  onClose,
  phone,
}: {
  slot: SlotId;
  flow: Flow;
  onClose: () => void;
  phone: boolean;
}) {
  const [showUnusable, setShowUnusable] = useState(false);
  const eq = equippedIn(slot);
  const cands = candidatesIn(slot);
  const unusable = unusableIn(slot);
  const issue = flow.issues.find((i) => i.slot === slot);
  const chosen = cands.filter((c) => flow.selection[c.uid]).length;
  const top = Math.max(...eq.map((e) => e.ilvl));
  const setAll = (v: boolean) =>
    flow.setSelection((s) => ({ ...s, ...Object.fromEntries(cands.map((c) => [c.uid, v])) }));

  return (
    <section
      aria-label={`${slotLabel(slot)} candidates`}
      className={clsx(
        "flex shrink-0 flex-col overflow-hidden rounded-[8px] border border-line bg-panel shadow-pop",
        phone ? "w-full" : "w-[360px] self-start",
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[14px] font-semibold">{slotLabel(slot)}</h3>
          <span className="num text-[12px] text-muted">
            {chosen} of {cands.length}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[12px]">
          <button
            className="rounded px-1.5 py-0.5 text-muted hover:text-fg"
            onClick={() => setAll(true)}
          >
            All
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-muted hover:text-fg"
            onClick={() => setAll(false)}
          >
            None
          </button>
          <button
            className="ml-1 grid size-6 place-items-center rounded text-muted hover:bg-raised hover:text-fg"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </header>
      {issue && (
        <p className="flex gap-2 border-b border-line bg-loss-wash px-3.5 py-2.5 text-[12.5px] text-fg">
          <CircleAlert size={15} className="mt-0.5 shrink-0 text-loss" />
          {issue.message}
        </p>
      )}
      <ul className="flex max-h-[520px] flex-col overflow-y-auto p-1.5">
        {eq.map((it) => (
          <TrayRow key={it.uid} item={it} top={top} state="locked" />
        ))}
        {cands.map((it, i) => (
          <TrayRow
            key={it.uid}
            item={it}
            top={top}
            state={flow.selection[it.uid] ? "on" : "off"}
            autoFocus={i === 0}
            onToggle={() => flow.toggle(it.uid)}
          />
        ))}
        {showUnusable &&
          unusable.map((it) => <TrayRow key={it.uid} item={it} top={top} state="unusable" />)}
        {cands.length === 0 && (
          <li className="px-2.5 py-3 text-[12.5px] text-muted">
            Nothing in your bags or vault fits this slot.
          </li>
        )}
      </ul>
      {unusable.length > 0 && (
        <button
          className="border-t border-line px-3.5 py-2 text-left text-[12px] text-faint hover:text-muted"
          onClick={() => setShowUnusable((v) => !v)}
        >
          {showUnusable ? "Hide" : "Show"} {unusable.length} unusable{" "}
          {unusable.length === 1 ? "item" : "items"} (
          {unusable.map((u) => u.unusableReason).join(", ")})
        </button>
      )}
    </section>
  );
}

function TrayRow({
  item,
  top,
  state,
  onToggle,
  autoFocus,
}: {
  item: Item;
  top: number;
  state: "locked" | "on" | "off" | "unusable";
  onToggle?: () => void;
  autoFocus?: boolean;
}) {
  const d = item.ilvl - top;
  const inner = (
    <>
      <span
        className={clsx(
          "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-150",
          state === "on" && "border-action bg-action text-action-ink",
          state === "off" && "border-line-strong",
          state === "locked" && "border-transparent text-faint",
          state === "unusable" && "border-line opacity-50",
        )}
      >
        {state === "on" && <Check size={11} strokeWidth={3} />}
        {state === "locked" && <Lock size={11} />}
      </span>
      <ItemIcon item={item} size="md" showIlvl dim={state === "unusable"} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <ItemName
          item={item}
          className={clsx("truncate text-[13px]", state === "unusable" && "opacity-50")}
        />
        <span className="truncate text-[11.5px] text-faint">{statLine(item, "Str")}</span>
        <span className="flex flex-wrap gap-1 pt-0.5">
          {state === "locked" ? (
            <Tag>Equipped</Tag>
          ) : (
            item.source !== "vault" && <Tag>{sourceLabel(item.source)}</Tag>
          )}
          {state === "unusable" && <Tag tone="loss">{item.unusableReason}</Tag>}
          <ItemFlags item={item} />
        </span>
      </span>
      {state !== "locked" && (
        <span
          className={clsx(
            "num shrink-0 text-[12px]",
            d > 0 ? "text-gain" : d < 0 ? "text-loss" : "text-faint",
          )}
        >
          {d === 0 ? "=" : `${d > 0 ? "+" : "−"}${Math.abs(d)}`}
        </span>
      )}
    </>
  );
  const cls = "flex w-full items-start gap-2.5 rounded-[6px] px-2 py-2 text-left";
  if (state === "locked" || state === "unusable")
    return <li className={clsx(cls, "cursor-default")}>{inner}</li>;
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={state === "on"}
        autoFocus={autoFocus}
        className={clsx(cls, "transition-colors duration-150 hover:bg-raised")}
        onClick={onToggle}
      >
        {inner}
      </button>
    </li>
  );
}

function Command({ flow }: { flow: Flow }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const s = flow.settings;
  const heavy = flow.overCap ? heaviestSlots(flow.selection) : [];
  const drift = flow.parsed?.unknownItemIds ?? [];
  const varying = [
    ...LEFT,
    "hands",
    "waist",
    "legs",
    "feet",
    "finger",
    "trinket",
    "main_hand",
  ].filter(
    (id) =>
      pool(id as SlotId, flow.selection).length > (id === "finger" || id === "trinket" ? 2 : 1),
  ).length;
  const fight = FIGHT_STYLES.find((f) => f.id === s.fightStyle);
  const precision = PRECISIONS.find((p) => p.id === s.precision)!;

  return (
    <div className="flex h-full flex-col gap-5 rounded-[10px] border border-line bg-panel/60 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">
          {CHARACTER.name}
        </h2>
        <p className="text-[13px] text-muted">
          {CHARACTER.spec} {CHARACTER.className} · {CHARACTER.race} · {CHARACTER.level} ·{" "}
          {CHARACTER.region} {CHARACTER.realm}
        </p>
        <p className="num text-[12px] text-faint">Equipped ilvl {CHARACTER.equippedIlvl}</p>
      </div>

      {drift.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[8px] border border-loss/35 bg-loss-wash px-3.5 py-3 text-[12.5px]">
          <p className="flex gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-loss" />
            <span>
              {drift.length} items have ids this SimC build does not know (
              <span className="num">{drift.join(", ")}</span>). They are left out until SimC is
              updated.
            </span>
          </p>
          <div className="flex gap-2 pl-6">
            <button className="rounded-[5px] bg-action px-2.5 py-1 text-[12px] font-medium text-action-ink hover:bg-action-strong">
              Update SimC to {flow.simc?.latest.split(" · ")[1]}
            </button>
            <span className="self-center text-faint">{flow.simc?.behind} commits newer</span>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13px]">
        <dt className="text-faint">Talents</dt>
        <dd className="flex flex-wrap gap-1.5">
          {CHARACTER.talentLoadouts.map((l) => {
            const on = s.talentLoadouts.includes(l.id);
            const only = on && s.talentLoadouts.length === 1;
            return (
              <button
                key={l.id}
                aria-pressed={on}
                disabled={only}
                title={only ? "At least one loadout is simmed" : undefined}
                onClick={() =>
                  flow.setSettings((x) => ({
                    ...x,
                    talentLoadouts: on
                      ? x.talentLoadouts.filter((t) => t !== l.id)
                      : [...x.talentLoadouts, l.id],
                  }))
                }
                className={clsx(
                  "rounded-[5px] border px-2 py-0.5 text-[12.5px] transition-colors duration-150",
                  on
                    ? "border-action/50 bg-action-wash text-fg"
                    : "border-line text-muted hover:border-line-strong hover:text-fg",
                  only && "cursor-default",
                )}
              >
                {l.name}
              </button>
            );
          })}
        </dd>
        <dt className="text-faint">Consumables</dt>
        <dd className="text-muted">
          {CONSUMABLES.flask}, {CONSUMABLES.food}, {CONSUMABLES.potion}
        </dd>
        <dt className="text-faint">Sim</dt>
        <dd>
          <button
            className="flex items-center gap-1.5 text-left text-muted hover:text-fg"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            {fight?.label} · <span className="num">{s.duration}s</span> ·{" "}
            <span className="num">{s.targets}</span> {s.targets === 1 ? "target" : "targets"} ·{" "}
            {precision.label} precision
            <ChevronDown
              size={14}
              className={clsx("transition-transform duration-200", settingsOpen && "rotate-180")}
            />
          </button>
        </dd>
      </dl>

      {settingsOpen && <SettingsForm flow={flow} />}

      <div className="mt-auto flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <span
              className={clsx(
                "num text-[26px] leading-none font-semibold tracking-[-0.02em]",
                flow.overCap ? "text-loss" : "text-fg",
              )}
            >
              {flow.count.toLocaleString("en-US")}
            </span>
            <span className="pt-1 text-[12.5px] text-muted">
              combinations across {varying} slots
              {s.talentLoadouts.length > 1 ? ` × ${s.talentLoadouts.length} loadouts` : ""}
              {!flow.overCap && (
                <>
                  , about <span className="num text-fg">{fmtDuration(flow.estimate)}</span>
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1 text-[11.5px] text-faint lg:flex">
              <Kbd>{modKey}</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <button
              onClick={flow.start}
              disabled={!flow.canRun}
              className="flex h-10 items-center gap-2 rounded-[7px] bg-action px-5 text-[14px] font-semibold text-action-ink transition-colors duration-150 hover:bg-action-strong disabled:cursor-not-allowed disabled:bg-raised disabled:text-faint"
            >
              <Play size={15} fill="currentColor" /> Run Top Gear
            </button>
          </div>
        </div>
        {flow.overCap && (
          <p className="text-[12.5px] text-muted">
            Over the <span className="num">{COMBINATION_CAP.toLocaleString("en-US")}</span> cap.
            Most combinations come from{" "}
            {heavy.map((h, i) => (
              <span key={h.slot.id}>
                <button
                  className="text-fg underline decoration-line-strong hover:decoration-action"
                  onClick={() => focusSlot(h.slot.id)}
                >
                  {h.slot.label}
                </button>{" "}
                (<span className="num">{h.options}</span> options)
                {i < heavy.length - 1 ? ", " : "."}
              </span>
            ))}{" "}
            Deselect a few there.
          </p>
        )}
        {flow.issues.map((i) => (
          <p key={i.slot} className="flex gap-2 text-[12.5px] text-muted">
            <CircleAlert size={14} className="mt-0.5 shrink-0 text-loss" />
            <span>
              <button
                className="text-fg underline decoration-line-strong hover:decoration-action"
                onClick={() => focusSlot(i.slot)}
              >
                {slotLabel(i.slot)}
              </button>
              : {i.message}
            </span>
          </p>
        ))}
        {flow.count === 1 && !flow.overCap && (
          <p className="text-[12.5px] text-muted">
            Only your equipped set is selected, so this runs as a single baseline sim.
          </p>
        )}
      </div>
    </div>
  );
}

function SettingsForm({ flow }: { flow: Flow }) {
  const s = flow.settings;
  const set = (patch: Partial<typeof s>) => flow.setSettings((x) => ({ ...x, ...patch }));
  const seg = (on: boolean) =>
    clsx(
      "rounded-[5px] px-2.5 py-1 text-[12.5px] transition-colors duration-150",
      on ? "bg-raised text-fg ring-1 ring-line-strong" : "text-muted hover:text-fg",
    );
  return (
    <div className="flex flex-col gap-3.5 rounded-[8px] border border-line bg-sunk/60 p-3.5 text-[12.5px]">
      <div className="flex flex-col gap-1.5">
        <span className="text-faint">Fight style</span>
        <div className="flex flex-wrap gap-1">
          {FIGHT_STYLES.map((f) => (
            <button
              key={f.id}
              title={f.hint}
              className={seg(s.fightStyle === f.id)}
              onClick={() => set({ fightStyle: f.id })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-faint">Duration (s)</span>
          <input
            type="number"
            min={30}
            max={900}
            value={s.duration}
            onChange={(e) => set({ duration: Number(e.target.value) })}
            className="num h-7 w-20 rounded-[5px] border border-line bg-panel px-2 outline-none focus:border-action"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-faint">Targets</span>
          <input
            type="number"
            min={1}
            max={20}
            value={s.targets}
            onChange={(e) => set({ targets: Number(e.target.value) })}
            className="num h-7 w-16 rounded-[5px] border border-line bg-panel px-2 outline-none focus:border-action"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-faint">Precision</span>
          <div className="flex gap-1">
            {PRECISIONS.map((p) => (
              <button
                key={p.id}
                title={p.hint}
                className={seg(s.precision === p.id)}
                onClick={() => set({ precision: p.id })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-faint">Raw SimC options, one per line, applied last</span>
        <textarea
          value={s.rawOptions}
          onChange={(e) => set({ rawOptions: e.target.value })}
          rows={3}
          spellCheck={false}
          placeholder="desired_targets=1&#10;override.bloodlust=0"
          className="num resize-y rounded-[5px] border border-line bg-panel px-2 py-1.5 text-[12px] outline-none placeholder:text-faint focus:border-action"
        />
      </label>
    </div>
  );
}
