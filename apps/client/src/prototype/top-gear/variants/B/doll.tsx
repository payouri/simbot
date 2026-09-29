// Variant B: the character-sheet frame every step renders into.

import clsx from "clsx";
import {
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { type Item, SLOTS, type SlotId } from "../../data";
import { ItemIcon, ItemName, QUALITY_TEXT } from "../../kit";

export const LEFT: SlotId[] = ["head", "neck", "shoulder", "back", "chest", "wrist"];
export const RIGHT: SlotId[] = ["hands", "waist", "legs", "feet", "finger", "trinket"];
export const slotLabel = (id: SlotId) => SLOTS.find((s) => s.id === id)!.label;

export function useIsPhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(max-width: 767px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
  );
}

export type Side = "left" | "right" | "center";

/** Arrow-key navigation across the sheet: columns, then main hand at the bottom. */
export function neighbour(id: SlotId, key: string): SlotId | null {
  const li = LEFT.indexOf(id),
    ri = RIGHT.indexOf(id);
  const col = li >= 0 ? LEFT : ri >= 0 ? RIGHT : null;
  const i = li >= 0 ? li : ri;
  if (!col) {
    if (key === "ArrowUp") return "wrist";
    if (key === "ArrowLeft") return "wrist";
    if (key === "ArrowRight") return "trinket";
    return null;
  }
  if (key === "ArrowUp") return i > 0 ? col[i - 1] : null;
  if (key === "ArrowDown") return i < col.length - 1 ? col[i + 1] : "main_hand";
  if (key === "ArrowLeft") return col === RIGHT ? LEFT[i] : null;
  if (key === "ArrowRight") return col === LEFT ? RIGHT[i] : null;
  return null;
}

export const focusSlot = (id: SlotId) =>
  document.querySelector<HTMLElement>(`[data-b-slot="${id}"]`)?.focus();

export const onSlotKey = (id: SlotId) => (e: KeyboardEvent) => {
  const n = neighbour(id, e.key);
  if (n) {
    e.preventDefault();
    focusSlot(n);
  }
};

/** Glow that lights up after mount, so a new selection animates in. */
export function GlowIcon({
  item,
  token,
  size = "lg",
}: {
  item: Item;
  token: string | number;
  size?: "md" | "lg";
}) {
  const [lit, setLit] = useState(false);
  useEffect(() => {
    setLit(false);
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setLit(true)));
    return () => cancelAnimationFrame(r);
  }, [token]);
  return <ItemIcon item={item} size={size} glow={lit} showIlvl className="duration-[250ms]" />;
}

interface TileProps {
  slot: SlotId;
  side: Side;
  items: Item[];
  meta?: ReactNode;
  aside?: ReactNode;
  icons?: ReactNode;
  open?: boolean;
  issue?: boolean;
  quiet?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}

/** One slot on the sheet. Icon sits on the outer edge; text faces the centre. */
export const SlotTile = forwardRef<HTMLButtonElement, TileProps>(function SlotTile(
  { slot, side, items, meta, aside, icons, open, issue, quiet, interactive = true, onClick },
  ref,
) {
  const mirrored = side === "right";
  const body = (
    <>
      <span className={clsx("flex shrink-0 gap-1", mirrored && "flex-row-reverse")}>
        {icons ??
          items.map((it) => <ItemIcon key={it.uid} item={it} size="lg" showIlvl dim={quiet} />)}
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
          {slotLabel(slot)}
          {issue && <span className="size-1.5 rounded-full bg-loss" aria-label="Blocks Run" />}
        </span>
        {items.length === 1 ? (
          <ItemName
            item={items[0]}
            className={clsx("block max-w-full truncate text-[13px]", quiet && "opacity-60")}
          />
        ) : (
          <span
            className={clsx(
              "flex max-w-full flex-col text-[12px] leading-[1.3]",
              quiet && "opacity-60",
              mirrored && "items-end",
            )}
          >
            {items.map((it) => (
              <span
                key={it.uid}
                className="max-w-full truncate font-medium"
                style={{ color: QUALITY_TEXT[it.quality] }}
              >
                {it.name}
              </span>
            ))}
          </span>
        )}
        {meta && <span className="text-[11.5px] text-muted">{meta}</span>}
      </span>
      {aside}
    </>
  );
  const cls = clsx(
    "group relative flex w-full items-center gap-3 rounded-[6px] px-2.5 py-2 transition-colors duration-150",
    mirrored && "flex-row-reverse",
    interactive && "hover:bg-panel",
    open && "bg-raised ring-1 ring-action/50",
    issue && !open && "ring-1 ring-loss/45",
  );
  if (!interactive) return <div className={cls}>{body}</div>;
  return (
    <button
      ref={ref}
      type="button"
      data-b-slot={slot}
      aria-expanded={open}
      className={cls}
      onClick={onClick}
      onKeyDown={onSlotKey(slot)}
    >
      {body}
    </button>
  );
});

/**
 * The sheet: left column, optional left tray, the centre (command column + main hand),
 * optional right tray, right column. Phone collapses to a two-column slot grid.
 */
export function Sheet({
  renderSlot,
  center,
  leftTray,
  rightTray,
  phone,
  mainHandBelow = true,
  colWidth = 248,
}: {
  renderSlot: (id: SlotId, side: Side) => ReactNode;
  center: ReactNode;
  leftTray?: ReactNode;
  rightTray?: ReactNode;
  phone: boolean;
  mainHandBelow?: boolean;
  colWidth?: number;
}) {
  if (phone) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
          {[...LEFT, ...RIGHT, "main_hand" as SlotId].map((id) => (
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
        {LEFT.map((id) => (
          <div key={id}>{renderSlot(id, "left")}</div>
        ))}
      </div>
      {leftTray}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1">{center}</div>
        {mainHandBelow && (
          <div className="mx-auto w-full max-w-[320px]">{renderSlot("main_hand", "center")}</div>
        )}
      </div>
      {rightTray}
      <div className="flex shrink-0 flex-col gap-1" style={{ width: colWidth }}>
        {RIGHT.map((id) => (
          <div key={id}>{renderSlot(id, "right")}</div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonSheet({ phone }: { phone: boolean }) {
  const tile = (k: string, side: Side) => (
    <div
      key={k}
      className={clsx(
        "flex items-center gap-3 px-2.5 py-2",
        side === "right" && "flex-row-reverse",
      )}
    >
      <span className="size-12 shrink-0 animate-pulse rounded-[5px] bg-panel" />
      <span className={clsx("flex flex-1 flex-col gap-1.5", side === "right" && "items-end")}>
        <span className="h-2.5 w-12 animate-pulse rounded bg-panel" />
        <span className="h-3 w-36 animate-pulse rounded bg-panel" />
      </span>
    </div>
  );
  return (
    <div aria-busy className="flex flex-col gap-4">
      <p className="text-[13px] text-muted">Reading items and asking SimC for their stats…</p>
      <Sheet
        phone={phone}
        renderSlot={(id, side) => tile(id, side)}
        center={
          <div className="flex h-full flex-col gap-3 rounded-[8px] border border-line p-5">
            <span className="h-5 w-40 animate-pulse rounded bg-panel" />
            <span className="h-3 w-64 animate-pulse rounded bg-panel" />
            <span className="mt-6 h-10 w-full animate-pulse rounded bg-panel" />
          </div>
        }
      />
    </div>
  );
}
