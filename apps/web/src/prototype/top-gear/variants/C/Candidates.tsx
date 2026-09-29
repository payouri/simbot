// Variant C: candidates as a dense slot table with inline toggle chips.
import { useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { AlertTriangle, Lock } from "lucide-react";
import { SLOTS, type Item } from "../../data";
import { candidatesIn, equippedIn, unusableIn } from "../../engine";
import type { Flow } from "../../flow";
import { ItemFlags, ItemIcon, ItemName, statLine, Kbd } from "../../kit";

function Chip({
  item,
  state,
  onToggle,
  row,
  col,
  readOnly,
}: {
  item: Item;
  state: "equipped" | "on" | "off" | "unusable";
  onToggle?: () => void;
  row: number;
  col: number;
  readOnly: boolean;
}) {
  const locked = state === "equipped" || state === "unusable" || readOnly;
  const label =
    state === "equipped"
      ? `${item.name}, ${item.ilvl}, equipped`
      : state === "unusable"
        ? `${item.name}, ${item.ilvl}, ${item.unusableReason}, cannot be used`
        : `${item.name}, ${item.ilvl}${item.source === "vault" ? ", Great Vault" : ""}`;
  return (
    <span className="group/chip relative">
      <button
        type="button"
        data-row={row}
        data-col={col}
        aria-pressed={state === "equipped" || state === "on"}
        aria-disabled={locked}
        aria-label={label}
        onClick={locked ? undefined : onToggle}
        className={clsx(
          "flex h-9 items-center gap-2 rounded-[6px] border py-1 pr-2.5 pl-1 transition-[background-color,border-color,opacity] duration-150 ease-out-quart",
          state === "equipped" && "cursor-default border-line-strong bg-raised",
          state === "on" && "border-action/55 bg-action-wash hover:border-action",
          state === "off" && "border-line bg-transparent opacity-70 hover:border-line-strong hover:opacity-100",
          state === "unusable" && "cursor-not-allowed border-dashed border-line opacity-60",
          readOnly && state !== "equipped" && "cursor-default hover:border-inherit",
        )}
      >
        <ItemIcon item={item} size="sm" showIlvl dim={state === "unusable" || state === "off"} />
        <span className="hidden max-w-[150px] truncate text-[12.5px] xl:inline">
          <ItemName item={item} className={clsx(state === "off" && "opacity-80")} />
        </span>
        <span className="num text-[12px] text-muted xl:hidden">{item.ilvl}</span>
        {state === "equipped" && <Lock size={11} className="text-faint" aria-hidden />}
        {item.source === "vault" && <span className="size-1.5 rounded-full bg-action" aria-hidden />}
      </button>
      {/* hover detail, positioned above the chip; pointer only, the label carries it for AT */}
      <span
        role="presentation"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-0 z-30 hidden w-[280px] rounded-[6px] border border-line-strong bg-raised p-2.5 shadow-pop group-hover/chip:block"
      >
        <span className="block text-[13px] leading-snug">
          <ItemName item={item} />
        </span>
        <span className="num mt-0.5 block text-[11.5px] text-muted">
          ilvl {item.ilvl} · {item.source === "vault" ? "Great Vault" : item.source === "equipped" ? "Equipped" : "Bags"}
          {state === "unusable" && ` · ${item.unusableReason}, not usable by Retribution`}
        </span>
        <span className="mt-1 block text-[11.5px] text-muted">{statLine(item)}</span>
        <span className="mt-1.5 flex flex-wrap gap-1">
          <ItemFlags item={item} />
        </span>
      </span>
    </span>
  );
}

export function CandidatesTable({ flow, readOnly }: { flow: Flow; readOnly: boolean }) {
  const [showUnusable, setShowUnusable] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);

  const focus = (row: number, col: number) => {
    const rows = ref.current?.querySelectorAll<HTMLButtonElement>(`[data-row="${row}"]`);
    if (!rows?.length) return;
    rows[Math.min(col, rows.length - 1)].focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (!el.dataset.row) return;
    const row = Number(el.dataset.row), col = Number(el.dataset.col);
    if (e.key === "j" || e.key === "ArrowDown") (e.preventDefault(), focus(Math.min(SLOTS.length - 1, row + 1), col));
    else if (e.key === "k" || e.key === "ArrowUp") (e.preventDefault(), focus(Math.max(0, row - 1), col));
    else if (e.key === "ArrowRight" && !e.altKey) (e.preventDefault(), focus(row, col + 1));
    else if (e.key === "ArrowLeft" && !e.altKey) (e.preventDefault(), focus(row, Math.max(0, col - 1)));
  };

  return (
    <div>
      <div
        ref={ref}
        onKeyDown={onKey}
        role="grid"
        aria-label="Candidate items per slot"
        className="rounded-[8px] border border-line bg-panel"
      >
        {SLOTS.map((slot, row) => {
          const eq = equippedIn(slot.id);
          const cands = candidatesIn(slot.id);
          const unusable = unusableIn(slot.id);
          const selected = cands.filter((c) => flow.selection[c.uid]).length;
          const issue = flow.issues.find((i) => i.slot === slot.id);
          const reveal = showUnusable[slot.id];
          let col = 0;
          return (
            <div
              key={slot.id}
              role="row"
              className={clsx("grid grid-cols-[112px_1fr_auto] items-start gap-x-4 border-line px-3 py-2 first:rounded-t-[8px] last:rounded-b-[8px] max-md:grid-cols-[1fr_auto]", row > 0 && "border-t", issue && "bg-loss-wash")}
            >
              <div className="pt-2 max-md:col-span-2 max-md:pt-0">
                <div className="text-[13px] font-medium text-fg">{slot.label}</div>
                {slot.paired && <div className="text-[11.5px] text-faint">choose 2</div>}
              </div>
              <div className="flex min-w-0 flex-wrap gap-1.5" role="gridcell">
                {eq.map((i) => (
                  <Chip key={i.uid} item={i} state="equipped" row={row} col={col++} readOnly={readOnly} />
                ))}
                {cands.length > 0 && <span aria-hidden className="mx-0.5 my-1.5 w-px self-stretch bg-line" />}
                {cands.map((i) => (
                  <Chip
                    key={i.uid}
                    item={i}
                    state={flow.selection[i.uid] ? "on" : "off"}
                    onToggle={() => flow.toggle(i.uid)}
                    row={row}
                    col={col++}
                    readOnly={readOnly}
                  />
                ))}
                {reveal && unusable.map((i) => <Chip key={i.uid} item={i} state="unusable" row={row} col={col++} readOnly />)}
                {cands.length === 0 && !reveal && <span className="self-center py-2 text-[12.5px] text-faint">Only the equipped item</span>}
                {issue && (
                  <p className="flex w-full items-start gap-1.5 pt-1 text-[12.5px] text-loss" role="alert">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      {issue.message} <span className="text-muted">Deselect it to run.</span>
                    </span>
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5 pt-2 text-right max-md:row-start-1 max-md:col-start-2 max-md:pt-0">
                <span className="num text-[12px] text-muted">
                  {selected} of {cands.length}
                </span>
                {unusable.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowUnusable((s) => ({ ...s, [slot.id]: !s[slot.id] }))}
                    className="rounded-[3px] text-[11.5px] text-faint underline-offset-2 hover:text-muted hover:underline"
                  >
                    {reveal ? "hide unusable" : `${unusable.length} unusable hidden`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-action" /> Great Vault, at most one per combination
        </span>
        <span className="flex items-center gap-1 max-md:hidden">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd> rows <Kbd>←</Kbd>
          <Kbd>→</Kbd> items <Kbd>space</Kbd> toggle
        </span>
        {readOnly && <span>Frozen: this Sim left Draft. Copy it to a new Draft to change candidates.</span>}
      </p>
    </div>
  );
}

export function CandidatesSkeleton() {
  return (
    <div className="overflow-hidden rounded-[8px] border border-line bg-panel" aria-busy="true" aria-label="Reading items">
      {SLOTS.map((s, i) => (
        <div key={s.id} className={clsx("grid grid-cols-[112px_1fr] items-center gap-4 px-3 py-2", i > 0 && "border-t border-line")}>
          <span className="text-[13px] text-faint">{s.label}</span>
          <div className="flex gap-1.5">
            {Array.from({ length: 1 + ((i * 7) % 4) }).map((_, j) => (
              <span key={j} className="h-9 w-[76px] animate-pulse rounded-[6px] bg-raised xl:w-[170px]" style={{ animationDelay: `${(i + j) * 40}ms` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
