import type { ImportItem } from "@simbot/shared";
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import { iconUrl } from "./api";
import { itemName, qualityBorder, qualityText, statLabel, statLine } from "./format";
import { useTooltipHost, wowheadData } from "./wowhead";

const SIZE = { sm: 20, md: 36, lg: 48 } as const;

type Parts = { icon?: boolean; name?: boolean; meta?: boolean };
const ALL: Parts = { icon: true, name: true, meta: true };

/**
 * Every item on screen: its icon, its name and a stat line, each switched on by `parts`. The
 * whole item hosts its Wowhead tooltip, except an Unknown Item, which Wowhead cannot know.
 *
 * Icon-only and name-only items render a single element, so a slot holding several items lays
 * out one icon-only item per icon and one name-only item per name.
 */
export function Item({
  item,
  size = "md",
  parts = ALL,
  ilvl = true,
  dim = false,
  mirrored = false,
  glow,
  meta,
  aside,
  className,
}: {
  item: ImportItem;
  /** 20, 36 or 48px icon. */
  size?: keyof typeof SIZE;
  parts?: Parts;
  /** The ilvl badge on the icon. */
  ilvl?: boolean;
  /** Greys out the icon: unusable or replaced. */
  dim?: boolean;
  /** Icon on the outer (right) edge, text right-aligned. */
  mirrored?: boolean;
  /** Lights the icon in its quality colour (the One Glow Rule); a new key replays the glow. */
  glow?: string | number;
  /** Replaces the default stat line. */
  meta?: ReactNode;
  /** Follows the name on its line: tags, a slot label. */
  aside?: ReactNode;
  className?: string;
}) {
  const host = useTooltipHost(wowheadData(item));
  const unknown = item.status === "unknown";
  const nameColor = { color: unknown ? "var(--fg-muted)" : qualityText(item.quality) };

  const icon = parts.icon && <Icon item={item} size={size} ilvl={ilvl} dim={dim} glow={glow} />;
  if (parts.icon && !parts.name && !parts.meta) {
    return (
      <span {...host} className={clsx("inline-flex shrink-0", className)}>
        {icon}
      </span>
    );
  }
  if (parts.name && !parts.icon && !parts.meta) {
    return (
      <span {...host} className={clsx("font-medium", className)} style={nameColor}>
        {itemName(item)}
        {aside}
      </span>
    );
  }
  return (
    <span
      {...host}
      className={clsx("flex min-w-0", mirrored && "flex-row-reverse text-right", className)}
    >
      {icon}
      <span className={clsx("flex min-w-0 flex-1 flex-col", mirrored && "items-end")}>
        {parts.name && (
          <span
            className={clsx(
              "flex max-w-full items-baseline gap-2 text-[13px]",
              mirrored && "flex-row-reverse",
            )}
          >
            <span data-part="name" className="truncate font-medium" style={nameColor}>
              {itemName(item)}
            </span>
            {aside}
          </span>
        )}
        {parts.meta &&
          (meta ?? (
            <span className="num truncate text-[11.5px] text-muted">{defaultMeta(item)}</span>
          ))}
      </span>
    </span>
  );
}

function defaultMeta(item: ImportItem): string {
  if (item.status === "unknown") return "Unknown to this SimC Build";
  if (item.status === "unresolved") return "No numbers: SimC did not read this item";
  if (!item.stats) return "";
  return statLine(item.stats)
    .map((s) => `${s.value} ${statLabel(s.key)}`)
    .join("  ");
}

/**
 * Square, bordered in the item's quality colour, with a mono ilvl badge. An Unknown Item is a
 * dashed placeholder with no icon, quality or level.
 */
function Icon({
  item,
  size,
  ilvl,
  dim,
  glow,
}: {
  item: ImportItem;
  size: keyof typeof SIZE;
  ilvl: boolean;
  dim: boolean;
  glow?: string | number;
}) {
  const px = SIZE[size];
  const unknown = item.status === "unknown";
  const tile = (
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
      {ilvl && item.ilvl !== null && !unknown && (
        <span className="num absolute right-0 bottom-0 rounded-tl-[4px] bg-[oklch(0.1_0.01_250/0.82)] px-1 text-[10px] leading-[14px] font-medium text-[oklch(0.96_0_0)]">
          {item.ilvl}
        </span>
      )}
    </span>
  );
  if (glow === undefined) return tile;
  return (
    <span
      key={glow}
      className="item-glow inline-flex shrink-0"
      style={{ "--glow": qualityBorder(item.quality) } as CSSProperties}
    >
      {tile}
    </span>
  );
}
