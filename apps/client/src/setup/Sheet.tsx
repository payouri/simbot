import type { ImportItem } from "@simbot/shared";
import {
  PAPERDOLL_LABEL,
  PAPERDOLL_LEFT,
  PAPERDOLL_RIGHT,
  type PaperdollSlot,
} from "@simbot/shared";
import clsx from "clsx";
import { Lock } from "lucide-react";
import { forwardRef, type KeyboardEvent, type ReactNode, useSyncExternalStore } from "react";
import { Item } from "../items/Item";

export type Side = "left" | "right" | "center";

const PHONE = "(max-width: 767px)";
export function useIsPhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE).matches,
  );
}

/** Arrow-key navigation across the sheet: the two columns, then main hand at the bottom. */
export function neighbour(id: PaperdollSlot, key: string): PaperdollSlot | null {
  const li = PAPERDOLL_LEFT.indexOf(id);
  const ri = PAPERDOLL_RIGHT.indexOf(id);
  const col = li >= 0 ? PAPERDOLL_LEFT : ri >= 0 ? PAPERDOLL_RIGHT : null;
  const i = li >= 0 ? li : ri;
  if (!col) {
    if (key === "ArrowUp" || key === "ArrowLeft") return "wrists";
    if (key === "ArrowRight") return "trinket";
    return null;
  }
  const at = (slots: readonly PaperdollSlot[], n: number) => slots[n] ?? null;
  if (key === "ArrowUp") return i > 0 ? at(col, i - 1) : null;
  if (key === "ArrowDown") return i < col.length - 1 ? at(col, i + 1) : "main_hand";
  if (key === "ArrowLeft") return col === PAPERDOLL_RIGHT ? at(PAPERDOLL_LEFT, i) : null;
  if (key === "ArrowRight") return col === PAPERDOLL_LEFT ? at(PAPERDOLL_RIGHT, i) : null;
  return null;
}

export const focusSlot = (id: PaperdollSlot) =>
  document.querySelector<HTMLElement>(`[data-slot="${id}"]`)?.focus();

const onSlotKey = (id: PaperdollSlot) => (e: KeyboardEvent) => {
  const n = neighbour(id, e.key);
  if (n) {
    e.preventDefault();
    focusSlot(n);
  }
};

/** One slot on the sheet. The icon sits on the outer edge, the text faces the centre. */
export const SlotTile = forwardRef<
  HTMLButtonElement,
  {
    slot: PaperdollSlot;
    side: Side;
    equipped: ImportItem[];
    meta: ReactNode;
    open: boolean;
    locked: boolean;
    /** Smaller icons, for the phone's two-column grid. */
    compact?: boolean;
    onClick: () => void;
  }
>(function SlotTile({ slot, side, equipped, meta, open, locked, compact, onClick }, ref) {
  const mirrored = side === "right";
  return (
    <button
      ref={ref}
      type="button"
      data-slot={slot}
      aria-expanded={open}
      className={clsx(
        "group relative flex w-full min-w-0 items-center gap-3 rounded-[6px] px-2.5 py-2 transition-colors duration-150 hover:bg-panel",
        mirrored && "flex-row-reverse",
        open && "bg-raised ring-1 ring-action/50",
      )}
      onClick={onClick}
      onKeyDown={onSlotKey(slot)}
    >
      <span className={clsx("flex shrink-0 gap-1", mirrored && "flex-row-reverse")}>
        {equipped.length > 0 ? (
          equipped.map((it) => (
            <Item key={it.index} item={it} parts={{ icon: true }} size={compact ? "md" : "lg"} />
          ))
        ) : (
          <span
            className={clsx(
              "rounded-[5px] border border-dashed border-line-strong",
              compact ? "size-9" : "size-12",
            )}
          />
        )}
      </span>
      <span
        className={clsx(
          "flex min-w-0 flex-1 flex-col gap-0.5",
          mirrored ? "items-end text-right" : "items-start text-left",
        )}
      >
        <span
          className={clsx(
            "flex items-center gap-1.5 text-[11.5px] text-faint",
            mirrored && "flex-row-reverse",
          )}
        >
          {PAPERDOLL_LABEL[slot]}
          {locked && <Lock size={11} aria-label="Locked" />}
        </span>
        {equipped.length === 0 ? (
          <span className="text-[13px] text-faint">Nothing equipped</span>
        ) : (
          equipped.map((it) => (
            <Item
              key={it.index}
              item={it}
              parts={{ name: true }}
              className={clsx(
                "block max-w-full truncate",
                equipped.length === 1 ? "text-[13px]" : "text-[12px] leading-[1.3]",
              )}
            />
          ))
        )}
        <span className="text-[11.5px] text-muted">{meta}</span>
      </span>
    </button>
  );
});

/**
 * The sheet: left column, optional left tray, the centre (command column, main hand below it),
 * optional right tray, right column. A phone gets a two-column slot grid with the tray and the
 * command column stacked underneath.
 */
export function Sheet({
  renderSlot,
  center,
  leftTray,
  rightTray,
  phone,
  colWidth = 248,
}: {
  renderSlot: (id: PaperdollSlot, side: Side) => ReactNode;
  center: ReactNode;
  leftTray?: ReactNode;
  rightTray?: ReactNode;
  phone: boolean;
  colWidth?: number;
}) {
  if (phone) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
          {[...PAPERDOLL_LEFT, ...PAPERDOLL_RIGHT, "main_hand" as const].map((id) => (
            <div key={id} className={id === "main_hand" ? "col-span-2" : undefined}>
              {renderSlot(id, "left")}
            </div>
          ))}
        </div>
        {leftTray ?? rightTray}
        {center}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 items-stretch gap-4">
      <div className="flex shrink-0 flex-col gap-1" style={{ width: colWidth }}>
        {PAPERDOLL_LEFT.map((id) => (
          <div key={id}>{renderSlot(id, "left")}</div>
        ))}
      </div>
      {leftTray}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1">{center}</div>
        <div className="mx-auto w-full max-w-[320px]">{renderSlot("main_hand", "center")}</div>
      </div>
      {rightTray}
      <div className="flex shrink-0 flex-col gap-1" style={{ width: colWidth }}>
        {PAPERDOLL_RIGHT.map((id) => (
          <div key={id}>{renderSlot(id, "right")}</div>
        ))}
      </div>
    </div>
  );
}
