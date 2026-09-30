import {
  type GameData,
  type ImportItem,
  PAPERDOLL_LABEL,
  type PaperdollSlot,
} from "@simbot/shared";
import clsx from "clsx";
import { Check, Lock, LockOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { statLabel, statLine } from "../items/ImportItems";
import { LiveItemStatsNote } from "../simc/GameData";
import { ItemName, ItemTile, Tag } from "./ItemTile";
import { includedCount, type SlotItems } from "./model";

type RowState = "equipped" | "on" | "off" | "placeholder" | "unusable";

const SOURCE_LABEL: Record<string, string> = { bags: "Bags", linked: "Linked" };

/** The item level this candidate adds over what is worn in the same kind of slot, if anything. */
function ilvlDelta(item: ImportItem, equipped: ImportItem[]): number | null {
  if (item.ilvl === null) return null;
  const kind = (slot: string) => slot.replace(/[12]$/, "");
  const worn = equipped
    .filter((e) => kind(e.slot) === kind(item.slot) && e.ilvl !== null)
    .map((e) => e.ilvl as number);
  return worn.length === 0 ? null : item.ilvl - Math.min(...worn);
}

function TrayRow({
  item,
  state,
  delta,
  disabled,
  first,
  onToggle,
}: {
  item: ImportItem;
  state: RowState;
  delta: number | null;
  disabled?: boolean;
  first?: boolean;
  onToggle?: () => void;
}) {
  const stats = item.stats
    ? statLine(item.stats)
        .filter((s) => s.key.endsWith("_rating"))
        .slice(0, 4)
        .map((s) => `${s.value} ${statLabel(s.key)}`)
        .join("  ")
    : "";
  const inert = state === "equipped" || state === "placeholder" || state === "unusable";
  const inner = (
    <>
      <span
        aria-hidden="true"
        className={clsx(
          "mt-1.5 grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-action",
          state === "on" && "border-action bg-action text-action-ink",
          state === "off" && "border-line-strong",
          state === "equipped" && "border-transparent text-faint",
          (state === "placeholder" || state === "unusable") && "border-line opacity-50",
          disabled && state === "off" && "opacity-50",
        )}
      >
        {state === "on" && <Check size={11} strokeWidth={3} />}
        {state === "equipped" && <Lock size={11} />}
      </span>
      <ItemTile item={item} size="md" dim={state === "unusable" || disabled} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <ItemName
          item={item}
          className={clsx("truncate text-[13px]", state === "unusable" && "opacity-50")}
        />
        <span className="truncate text-[11.5px] text-faint">
          {state === "placeholder"
            ? "Unknown to this SimC Build"
            : state === "unusable"
              ? "SimC could not read this item"
              : stats}
        </span>
        <span className="flex flex-wrap gap-1 pt-0.5">
          {state === "equipped" ? (
            <Tag>Equipped</Tag>
          ) : item.source === "great_vault" ? (
            <Tag tone="action">Great Vault</Tag>
          ) : (
            <Tag>{SOURCE_LABEL[item.source] ?? item.source}</Tag>
          )}
          {state === "placeholder" && <Tag tone="loss">Not selectable</Tag>}
        </span>
      </span>
      {(state === "on" || state === "off") && delta !== null && (
        <span
          className={clsx(
            "num shrink-0 text-[12px]",
            delta > 0 ? "text-gain" : delta < 0 ? "text-loss" : "text-faint",
          )}
          title="Item level against what is worn"
        >
          {delta === 0 ? "=" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`}
        </span>
      )}
    </>
  );
  const cls = "flex w-full items-start gap-2.5 rounded-[6px] px-2 py-2 text-left";
  if (inert) {
    return (
      <li className={cls} data-state={state}>
        {inner}
      </li>
    );
  }
  return (
    <li>
      <label
        className={clsx(
          cls,
          "transition-colors duration-150",
          disabled ? "cursor-default" : "cursor-pointer hover:bg-raised",
        )}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={state === "on"}
          disabled={disabled}
          data-first={first ? "" : undefined}
          onChange={onToggle}
        />
        {inner}
      </label>
    </li>
  );
}

/**
 * A slot's candidates, open beside the sheet rather than over it. Unknown Items sit in the list
 * as placeholders; items the class cannot use hide behind a count.
 */
export function Tray({
  slot,
  group,
  included,
  locked,
  phone,
  gameData,
  onToggleItem,
  onSetAll,
  onToggleLock,
  onClose,
}: {
  slot: PaperdollSlot;
  group: SlotItems;
  included: number[];
  locked: boolean;
  phone: boolean;
  gameData: GameData;
  onToggleItem: (index: number) => void;
  onSetAll: (on: boolean) => void;
  onToggleLock: () => void;
  onClose: () => void;
}) {
  const [showUnusable, setShowUnusable] = useState(false);
  const root = useRef<HTMLElement>(null);
  // Opening a tray moves focus into it; Escape (below) hands it back to the slot.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[data-first]")?.focus();
  }, []);
  const chosen = includedCount(included, group.candidates);
  const empty =
    group.candidates.length === 0 && group.placeholders.length === 0 && group.unusable.length === 0;
  return (
    <section
      ref={root}
      aria-label={`${PAPERDOLL_LABEL[slot]} candidates`}
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
          <h3 className="text-[14px] font-semibold">{PAPERDOLL_LABEL[slot]}</h3>
          <span className="num text-[12px] text-muted">
            {chosen} of {group.candidates.length}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[12px]">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-muted hover:text-fg disabled:opacity-40"
            disabled={locked}
            onClick={() => onSetAll(true)}
          >
            All
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-muted hover:text-fg disabled:opacity-40"
            disabled={locked}
            onClick={() => onSetAll(false)}
          >
            None
          </button>
          <button
            type="button"
            aria-pressed={locked}
            className={clsx(
              "flex items-center gap-1 rounded px-1.5 py-0.5 hover:text-fg",
              locked ? "text-fg" : "text-muted",
            )}
            onClick={onToggleLock}
          >
            {locked ? <Lock size={12} /> : <LockOpen size={12} />}
            {locked ? "Locked" : "Lock"}
          </button>
          <button
            type="button"
            className="ml-1 grid size-6 place-items-center rounded text-muted hover:bg-raised hover:text-fg"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </header>
      {locked && (
        <p className="border-b border-line bg-raised px-3.5 py-2 text-[12.5px] text-muted">
          Locked: Top Gear keeps what is equipped here. Unlock to choose candidates.
        </p>
      )}
      <LiveItemStatsNote
        gameData={gameData}
        className="border-b border-line px-3.5 py-2 text-[12px] text-faint"
      />
      <ul className="flex max-h-[520px] flex-col overflow-y-auto p-1.5">
        {group.equipped.map((it) => (
          <TrayRow key={it.index} item={it} state="equipped" delta={null} />
        ))}
        {group.candidates.map((it, i) => (
          <TrayRow
            key={it.index}
            item={it}
            state={included.includes(it.index) ? "on" : "off"}
            delta={ilvlDelta(it, group.equipped)}
            disabled={locked}
            first={i === 0 && !locked}
            onToggle={() => onToggleItem(it.index)}
          />
        ))}
        {group.placeholders.map((it) => (
          <TrayRow key={it.index} item={it} state="placeholder" delta={null} />
        ))}
        {showUnusable &&
          group.unusable.map((it) => (
            <TrayRow key={it.index} item={it} state="unusable" delta={null} />
          ))}
        {empty && (
          <li className="px-2.5 py-3 text-[12.5px] text-muted">
            Nothing in your Bags or Great Vault fits this slot.
          </li>
        )}
      </ul>
      {group.unusable.length > 0 && (
        <button
          type="button"
          aria-expanded={showUnusable}
          className="border-t border-line px-3.5 py-2 text-left text-[12px] text-faint hover:text-muted"
          onClick={() => setShowUnusable((v) => !v)}
        >
          {showUnusable ? "Hide" : "Show"} <span className="num">{group.unusable.length}</span>{" "}
          unusable {group.unusable.length === 1 ? "item" : "items"}
        </button>
      )}
    </section>
  );
}
