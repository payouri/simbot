import type { ImportItem } from "@simbot/shared";
import clsx from "clsx";
import { iconUrl } from "../items/api";
import { qualityBorder, qualityText } from "../items/ImportItems";

const SIZE = { sm: 20, md: 36, lg: 48 } as const;

/**
 * An item's icon: square, bordered in its quality colour, with a mono ilvl badge. An Unknown
 * Item is a dashed placeholder with no icon, quality or level; `dim` greys out unusable items.
 */
export function ItemTile({
  item,
  size = "md",
  dim = false,
  showIlvl = true,
}: {
  item: ImportItem;
  size?: keyof typeof SIZE;
  dim?: boolean;
  showIlvl?: boolean;
}) {
  const px = SIZE[size];
  const unknown = item.status === "unknown";
  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 overflow-hidden rounded-[5px] border bg-sunk",
        unknown && "border-dashed",
        dim && "opacity-45 grayscale",
      )}
      style={{
        width: px,
        height: px,
        borderColor: unknown ? "var(--line-strong)" : qualityBorder(item.quality),
      }}
    >
      {item.icon && !unknown ? (
        <img
          src={iconUrl(item.icon, item.quality)}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true" className="m-auto text-[15px] font-semibold text-faint">
          ?
        </span>
      )}
      {showIlvl && item.ilvl !== null && !unknown && (
        <span className="num absolute right-0 bottom-0 rounded-tl-[4px] bg-[oklch(0.1_0.01_250/0.82)] px-1 text-[10px] leading-[14px] font-medium text-[oklch(0.96_0_0)]">
          {item.ilvl}
        </span>
      )}
    </span>
  );
}

/** What to call an item: its name, else a stand-in built from what the Addon String says. */
export function itemName(item: ImportItem): string {
  if (item.name) return item.name;
  return item.itemId === null ? "Unknown item" : `Item ${item.itemId}`;
}

export function ItemName({ item, className }: { item: ImportItem; className?: string }) {
  const unknown = item.status === "unknown";
  return (
    <span
      className={clsx("font-medium", className)}
      style={{ color: unknown ? "var(--fg-muted)" : qualityText(item.quality) }}
    >
      {itemName(item)}
    </span>
  );
}

/** A tag in the design system's tones. */
export function Tag({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "action" | "loss" | "noise";
}) {
  const tones = {
    neutral: "border-line text-muted",
    action: "border-action/40 bg-action-wash text-action",
    loss: "border-loss/40 bg-loss-wash text-loss",
    noise: "border-noise/40 bg-noise-wash text-muted",
  };
  return (
    <span
      className={clsx(
        "inline-flex h-[18px] items-center rounded-[4px] border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
