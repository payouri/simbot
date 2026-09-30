import {
  CONSUMABLE_KEYS,
  type CombinationPreview,
  fightStyleSchema,
  type ImportItemsResponse,
  type ImportSetup,
  PAPERDOLL_LABEL,
  type PaperdollSlot,
  type Precision,
  precisionSchema,
  type Sim,
  type SimSettings,
  type TopGearSelection,
} from "@simbot/shared";
import clsx from "clsx";
import { ChevronDown, Lock, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { PassNote, UnknownBanner } from "../items/ImportItems";
import { formatEstimate } from "../queue/format";
import { useSimcStatus } from "../simc/api";
import { chipView } from "../simc/SimcChip";
import type { SaveState } from "./autosave";
import {
  CONSUMABLE_LABEL,
  candidatesInPlay,
  effectiveConsumables,
  loadoutName,
  prettyOption,
  type SlotItems,
  setConsumable,
  slotsInPlay,
  toggleLoadout,
  toggleLock,
} from "./model";

/** Tier-set minimums offered: none, the 2- and 4-piece bonuses, every tier slot. */
const TIER_MINIMUMS = [0, 2, 4, 5] as const;

const PRECISION_LABEL: Record<Precision, string> = { low: "Low", medium: "Medium", high: "High" };
const FIGHT_LABEL: Record<string, string> = {
  Patchwerk: "Patchwerk",
  CastingPatchwerk: "Casting Patchwerk",
  HecticAddCleave: "Hectic add cleave",
  LightMovement: "Light movement",
  HeavyMovement: "Heavy movement",
  DungeonSlice: "Dungeon slice",
};

/** What the estimate rests on, for the tooltip. */
const estimateTitle = (p: CombinationPreview) =>
  p.estimateBasis === "check_sim"
    ? "Estimated from the last Check Sim of this SimC Build"
    : "Estimated with default speeds until a Check Sim has measured this SimC Build";

export const modKey =
  typeof navigator !== "undefined" && /Mac|iPhone/.test(navigator.platform) ? "⌘" : "Ctrl";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong bg-sunk px-1 text-[10.5px] leading-none text-muted">
      {children}
    </kbd>
  );
}

const seg = (on: boolean) =>
  clsx(
    "rounded-[5px] px-2.5 py-1 text-[12.5px] transition-colors duration-150",
    on ? "bg-raised text-fg ring-1 ring-line-strong" : "text-muted hover:text-fg",
  );

const inputClass =
  "num h-7 rounded-[5px] border border-line bg-panel px-2 outline-none focus:border-action";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));

function SettingsForm({
  settings,
  onChange,
}: {
  settings: SimSettings;
  onChange: (next: SimSettings) => void;
}) {
  const set = (patch: Partial<SimSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="flex flex-col gap-3.5 rounded-[8px] border border-line bg-sunk/60 p-3.5 text-[12.5px]">
      <div className="flex flex-col gap-1.5">
        <span className="text-faint">Fight style</span>
        <div className="flex flex-wrap gap-1">
          {fightStyleSchema.options.map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={settings.fightStyle === style}
              className={seg(settings.fightStyle === style)}
              onClick={() => set({ fightStyle: style })}
            >
              {FIGHT_LABEL[style] ?? style}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-faint">Duration (s)</span>
          <input
            type="number"
            min={10}
            max={1800}
            value={settings.durationSeconds}
            onChange={(e) => set({ durationSeconds: clamp(Number(e.target.value), 10, 1800) })}
            className={clsx(inputClass, "w-20")}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-faint">Targets</span>
          <input
            type="number"
            min={1}
            max={20}
            value={settings.targets}
            onChange={(e) => set({ targets: clamp(Number(e.target.value), 1, 20) })}
            className={clsx(inputClass, "w-16")}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-faint">Precision</span>
          <div className="flex gap-1">
            {precisionSchema.options.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={settings.precision === p}
                className={seg(settings.precision === p)}
                onClick={() => set({ precision: p })}
              >
                {PRECISION_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-faint">Raw SimC options, one per line, applied last</span>
        <textarea
          value={settings.rawOptions}
          maxLength={4000}
          onChange={(e) => set({ rawOptions: e.target.value })}
          rows={3}
          spellCheck={false}
          placeholder={"desired_targets=1\noverride.bloodlust=0"}
          className="num resize-y rounded-[5px] border border-line bg-panel px-2 py-1.5 text-[12px] outline-none placeholder:text-faint focus:border-action"
        />
      </label>
    </div>
  );
}

/** The one consumable set every Combination runs with. An empty field keeps the export's. */
function ConsumablesForm({
  exported,
  selection,
  onSelection,
}: {
  exported: Readonly<Record<string, string>>;
  selection: TopGearSelection;
  onSelection: (next: TopGearSelection) => void;
}) {
  const picked = selection.consumables ?? {};
  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-line bg-sunk/60 p-3.5 text-[12.5px]">
      <p className="text-faint">
        One set for every combination, as SimC names it. Leave a field empty to keep the Addon
        String's, or write <span className="num">disabled</span> for none.
      </p>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
        {CONSUMABLE_KEYS.map((key) => (
          <label key={key} className="contents">
            <span className="text-faint">{CONSUMABLE_LABEL[key] ?? key}</span>
            <input
              type="text"
              value={picked[key] ?? ""}
              placeholder={exported[key] ?? "SimC default"}
              maxLength={120}
              spellCheck={false}
              onChange={(e) => onSelection(setConsumable(selection, key, e.target.value))}
              className={clsx(inputClass, "w-full min-w-0 placeholder:text-faint")}
            />
          </label>
        ))}
      </div>
      {Object.keys(picked).length > 0 && (
        <button
          type="button"
          className="self-start text-[12px] text-muted underline hover:text-fg"
          onClick={() => {
            const { consumables: _, ...rest } = selection;
            onSelection(rest);
          }}
        >
          Use the Addon String's set
        </button>
      )}
    </div>
  );
}

function SaveNote({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  if (save.kind === "error") {
    return (
      <p role="alert" className="text-[12px] text-loss">
        Not saved: {save.message}{" "}
        <button type="button" className="underline" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  return (
    <p className="text-[11.5px] text-faint" aria-live="polite">
      {save.kind === "saving" ? "Saving…" : "Draft saved"}
    </p>
  );
}

/** The middle of the sheet: who, SimC, what varies, the Sim Settings, locked slots and Run. */
export function Command({
  sim,
  itemsView,
  setup,
  settings,
  selection,
  groups,
  save,
  preview,
  previewError,
  runError,
  running,
  onSettings,
  onSelection,
  onRun,
  onRetry,
}: {
  sim: Sim;
  itemsView: ImportItemsResponse;
  setup: ImportSetup | undefined;
  settings: SimSettings;
  selection: TopGearSelection;
  groups: Record<PaperdollSlot, SlotItems>;
  save: SaveState;
  /** The Combination count, validation and estimate of the setup on screen. */
  preview: CombinationPreview | undefined;
  previewError: boolean;
  runError: string | null;
  running: boolean;
  onSettings: (next: SimSettings) => void;
  onSelection: (next: TopGearSelection) => void;
  onRun: () => void;
  onRetry: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consumablesOpen, setConsumablesOpen] = useState(false);
  const simc = useSimcStatus();
  const chip = chipView(simc.data);
  const c = sim.character;
  const inPlay = candidatesInPlay(selection, groups);
  const slots = slotsInPlay(selection, groups);
  // Issues would come back as a 422; Run stays available while the first preview is on its way.
  const issues = preview?.issues ?? [];
  const canRun = !running && issues.length === 0;
  const count = new Intl.NumberFormat("en-US");
  const exported = setup?.consumables ?? {};
  const consumables = effectiveConsumables(exported, selection.consumables);

  return (
    <div className="flex h-full flex-col gap-5 rounded-[10px] border border-line bg-panel/60 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">{c.name}</h2>
        <p className="text-[13px] text-muted">
          {[c.spec, c.class].filter(Boolean).join(" ")}
          {c.race ? ` · ${c.race}` : ""}
          {c.level ? ` · ${c.level}` : ""} · {c.region.toUpperCase()} {c.realm}
        </p>
      </div>

      <UnknownBanner unknown={itemsView.unknown} />
      <PassNote pass={itemsView.pass} />

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13px]">
        <dt className="text-faint">SimC</dt>
        <dd>
          <Link to="/simc" title={chip.title} className="num text-muted hover:text-fg">
            {chip.label}
          </Link>
        </dd>
        <dt className="text-faint">Talents</dt>
        <dd className="flex flex-wrap gap-1.5">
          {setup === undefined ? (
            <span className="text-faint">Reading loadouts…</span>
          ) : setup.talentLoadouts.length === 0 ? (
            <span className="text-muted">None saved in the Addon String</span>
          ) : (
            setup.talentLoadouts.map((l, i) => {
              const on = selection.talentLoadouts.includes(i);
              const only = on && selection.talentLoadouts.length === 1;
              return (
                <button
                  key={l.rawLine}
                  type="button"
                  aria-pressed={on}
                  disabled={only}
                  title={only ? "At least one loadout is simmed" : undefined}
                  onClick={() => onSelection(toggleLoadout(selection, i))}
                  className={clsx(
                    "rounded-[5px] border px-2 py-0.5 text-[12.5px] transition-colors duration-150",
                    on
                      ? "border-action/50 bg-action-wash text-fg"
                      : "border-line text-muted hover:border-line-strong hover:text-fg",
                    only && "cursor-default",
                  )}
                >
                  {loadoutName(l, i)}
                  {l.equipped && <span className="ml-1.5 text-[11px] text-faint">on now</span>}
                </button>
              );
            })
          )}
        </dd>
        <dt className="text-faint">Consumables</dt>
        <dd>
          <button
            type="button"
            className="flex items-center gap-1.5 text-left text-muted hover:text-fg"
            aria-expanded={consumablesOpen}
            onClick={() => setConsumablesOpen((v) => !v)}
          >
            <span>
              {consumables.length === 0
                ? "None in the Addon String"
                : consumables.map(({ key, value, picked }, i) => (
                    <span key={key}>
                      {i > 0 && ", "}
                      <span className="text-faint">{CONSUMABLE_LABEL[key] ?? key} </span>
                      <span className={clsx(picked && "text-fg")}>{prettyOption(value)}</span>
                    </span>
                  ))}
            </span>
            <ChevronDown
              size={14}
              className={clsx(
                "shrink-0 transition-transform duration-200",
                consumablesOpen && "rotate-180",
              )}
            />
          </button>
        </dd>
        <dt className="text-faint">Tier set</dt>
        <dd className="flex flex-wrap gap-1">
          {TIER_MINIMUMS.map((n) => {
            const on = (selection.minTierPieces ?? 0) === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                title={n === 0 ? "No tier minimum" : `Keep at least ${n} tier pieces`}
                className={seg(on)}
                onClick={() => onSelection({ ...selection, minTierPieces: n })}
              >
                {n === 0 ? "Any" : n === 5 ? "5" : `${n}+`}
              </button>
            );
          })}
        </dd>
        <dt className="text-faint">Sim</dt>
        <dd>
          <button
            type="button"
            className="flex items-center gap-1.5 text-left text-muted hover:text-fg"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <span>
              {FIGHT_LABEL[settings.fightStyle] ?? settings.fightStyle} ·{" "}
              <span className="num">{settings.durationSeconds}s</span> ·{" "}
              <span className="num">{settings.targets}</span>{" "}
              {settings.targets === 1 ? "target" : "targets"} ·{" "}
              {PRECISION_LABEL[settings.precision]} precision
              {settings.rawOptions.trim() !== "" && " · raw options"}
            </span>
            <ChevronDown
              size={14}
              className={clsx(
                "shrink-0 transition-transform duration-200",
                settingsOpen && "rotate-180",
              )}
            />
          </button>
        </dd>
        {selection.lockedSlots.length > 0 && (
          <>
            <dt className="text-faint">Locked</dt>
            <dd className="flex flex-wrap gap-1.5">
              {selection.lockedSlots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  title="Unlock"
                  onClick={() => onSelection(toggleLock(selection, slot))}
                  className="flex items-center gap-1 rounded-[5px] border border-line px-2 py-0.5 text-[12.5px] text-muted hover:border-line-strong hover:text-fg"
                >
                  <Lock size={11} />
                  {PAPERDOLL_LABEL[slot]}
                </button>
              ))}
            </dd>
          </>
        )}
      </dl>

      {consumablesOpen && (
        <ConsumablesForm exported={exported} selection={selection} onSelection={onSelection} />
      )}
      {settingsOpen && <SettingsForm settings={settings} onChange={onSettings} />}

      <div className="mt-auto flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <span
              className={clsx(
                "num text-[26px] leading-none font-semibold tracking-[-0.02em]",
                preview?.refused && "text-loss",
              )}
              aria-live="polite"
            >
              {preview
                ? `${preview.atLeast ? "more than " : ""}${count.format(preview.count)}`
                : "…"}
            </span>
            <span className="pt-1 text-[12.5px] text-muted">
              {preview?.count === 1 ? "combination" : "combinations"}
              {preview?.estimateSeconds != null && (
                <>
                  {" · "}
                  <span className="num" title={estimateTitle(preview)}>
                    {formatEstimate(preview.estimateSeconds)}
                  </span>
                </>
              )}
              {" · "}
              <span className="num">{inPlay}</span> {inPlay === 1 ? "candidate" : "candidates"} in{" "}
              <span className="num">{slots}</span> {slots === 1 ? "slot" : "slots"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1 text-[11.5px] text-faint lg:flex">
              <Kbd>{modKey}</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <button
              type="button"
              onClick={onRun}
              disabled={!canRun}
              className="flex h-10 items-center gap-2 rounded-[7px] bg-action px-5 text-[14px] font-semibold text-action-ink transition-colors duration-150 hover:bg-action-strong disabled:cursor-not-allowed disabled:bg-raised disabled:text-faint"
            >
              <Play size={15} fill="currentColor" /> {running ? "Queuing…" : "Run"}
            </button>
          </div>
        </div>
        {preview?.refused ? (
          <p role="alert" className="text-[12.5px] text-loss">
            Over the limit of {count.format(preview.max)} combinations after pruning. Include fewer
            candidates or lock a slot to run.
          </p>
        ) : preview?.softWarning ? (
          <p className="rounded-[6px] bg-noise-wash px-2.5 py-1.5 text-[12.5px] text-fg">
            This is a long run: about {formatEstimate(preview.estimateSeconds ?? 0)}. Fewer
            candidates or a lower precision make it shorter.
          </p>
        ) : inPlay === 0 ? (
          <p className="text-[12.5px] text-muted">
            Only your equipped set is selected, so this runs as a single baseline sim.
          </p>
        ) : null}
        {issues.filter((i) => i.candidate !== null).length > 0 && (
          <ul className="flex flex-col gap-1 text-[12.5px] text-loss">
            {issues
              .filter((i) => i.candidate !== null)
              .slice(0, 5)
              .map((i) => (
                <li key={i.path}>{i.message}</li>
              ))}
          </ul>
        )}
        {previewError && (
          <p className="text-[12.5px] text-faint">The combination count is not available now.</p>
        )}
        {runError && (
          <p role="alert" className="text-[12.5px] text-loss">
            {runError}
          </p>
        )}
        <SaveNote save={save} onRetry={onRetry} />
      </div>
    </div>
  );
}
