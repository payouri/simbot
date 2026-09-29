// PROTOTYPE shared atoms. Variants share these, never a layout.

import clsx from "clsx";
import { type CSSProperties, type ReactNode, useState } from "react";
import type { Item, Quality, Source } from "./data";

export const QUALITY_VAR: Record<Quality, string> = {
  poor: "var(--q-poor)",
  common: "var(--q-common)",
  uncommon: "var(--q-uncommon)",
  rare: "var(--q-rare)",
  epic: "var(--q-epic)",
  legendary: "var(--q-legendary)",
};
export const QUALITY_TEXT: Record<Quality, string> = {
  ...QUALITY_VAR,
  rare: "var(--q-rare-text)",
  epic: "var(--q-epic-text)",
};

const ICON_SIZES = { sm: 24, md: 36, lg: 48, xl: 64 } as const;

/**
 * Item icon: zamimg first, then Blizzard's CDN, then a drawn placeholder.
 * `glow` is simbot's one WoW nod: the item's own quality colour, lit.
 */
export function ItemIcon({
  item,
  size = "md",
  glow = false,
  showIlvl = false,
  dim = false,
  className,
}: {
  item: Item;
  size?: keyof typeof ICON_SIZES;
  glow?: boolean;
  showIlvl?: boolean;
  dim?: boolean;
  className?: string;
}) {
  const px = ICON_SIZES[size];
  const [src, setSrc] = useState(0);
  const sources = [
    `https://wow.zamimg.com/images/wow/icons/${px > 36 ? "large" : "medium"}/${item.icon}.jpg`,
    `https://render.worldofwarcraft.com/us/icons/56/${item.icon}.jpg`,
  ];
  const q = QUALITY_VAR[item.quality];
  const style: CSSProperties = {
    width: px,
    height: px,
    borderColor: q,
    boxShadow: glow
      ? `0 0 0 1px ${q}, 0 6px 18px -4px color-mix(in oklch, ${q} 70%, transparent), 0 0 28px -6px color-mix(in oklch, ${q} 55%, transparent)`
      : undefined,
  };
  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 overflow-hidden rounded-[5px] border bg-sunk transition-[box-shadow,opacity] duration-300 ease-out-quart",
        dim && "opacity-45 grayscale",
        className,
      )}
      style={style}
    >
      {src < sources.length ? (
        <img
          src={sources[src]}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setSrc((s) => s + 1)}
        />
      ) : (
        <svg viewBox="0 0 24 24" className="m-auto h-1/2 w-1/2 text-faint" aria-hidden>
          <path d="M5 5h14v14H5z M9 9h6v6H9z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      {showIlvl && (
        <span className="num absolute right-0 bottom-0 rounded-tl-[4px] bg-[oklch(0.1_0.01_250/0.82)] px-1 text-[10px] leading-[14px] font-medium text-[oklch(0.96_0_0)]">
          {item.ilvl}
        </span>
      )}
    </span>
  );
}

export function ItemName({ item, className }: { item: Item; className?: string }) {
  return (
    <span className={clsx("font-medium", className)} style={{ color: QUALITY_TEXT[item.quality] }}>
      {item.name}
    </span>
  );
}

const SOURCE_LABEL: Record<Source, string> = {
  equipped: "Equipped",
  bags: "Bags",
  vault: "Great Vault",
};
export const sourceLabel = (s: Source) => SOURCE_LABEL[s];

export function Tag({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "action" | "gain" | "loss" | "noise";
  className?: string;
}) {
  const tones = {
    neutral: "border-line text-muted",
    action: "border-action/40 text-action bg-action-wash",
    gain: "border-gain/40 text-gain bg-gain-wash",
    loss: "border-loss/40 text-loss bg-loss-wash",
    noise: "border-noise/40 text-muted bg-noise-wash",
  };
  return (
    <span
      className={clsx(
        "inline-flex h-[18px] items-center rounded-[4px] border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ItemFlags({ item }: { item: Item }) {
  return (
    <>
      {item.source === "vault" && <Tag tone="action">Vault</Tag>}
      {item.tier && <Tag>Set</Tag>}
      {item.embellished && <Tag>Embellished</Tag>}
      {item.onUse && <Tag>On use</Tag>}
      {item.unique && <Tag>Unique</Tag>}
    </>
  );
}

const STAT_LABEL = { crit: "Crit", haste: "Haste", mastery: "Mastery", vers: "Vers" } as const;
/** Secondary stats, primary labelled with the spec's primary stat (SimC reports strint/stragi). */
export function statLine(item: Item, primary = "Str") {
  const parts: string[] = [];
  if (item.primary) parts.push(`${item.primary.toLocaleString("en-US")} ${primary}`);
  for (const [k, v] of Object.entries(item.secondary))
    parts.push(`${v.toLocaleString("en-US")} ${STAT_LABEL[k as keyof typeof STAT_LABEL]}`);
  return parts.join(" · ");
}

export const fmtDps = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtSigned = (n: number, digits = 0) =>
  `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
export const fmtPct = (n: number, digits = 2) =>
  `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}%`;

/**
 * Δ vs equipped on a shared scale, with the ± error drawn as a band and whiskers.
 * Tone: gain / loss, or noise when the row cannot be told apart from #1 or from 0.
 */
export function DeltaBar({
  deltaPct,
  errorPct,
  min,
  max,
  tone,
  height = 14,
  className,
}: {
  deltaPct: number;
  errorPct: number;
  min: number;
  max: number;
  tone: "gain" | "loss" | "noise" | "base";
  height?: number;
  className?: string;
}) {
  const span = max - min || 1;
  const x = (v: number) => `${((Math.min(max, Math.max(min, v)) - min) / span) * 100}%`;
  const zero = x(0);
  const lo = Math.min(0, deltaPct),
    hi = Math.max(0, deltaPct);
  const color = {
    gain: "var(--gain)",
    loss: "var(--loss)",
    noise: "var(--noise)",
    base: "var(--fg-faint)",
  }[tone];
  return (
    <div
      className={clsx("relative w-full", className)}
      style={{ height }}
      role="img"
      aria-label={`${fmtPct(deltaPct)} versus equipped, plus or minus ${errorPct.toFixed(2)}%`}
    >
      <div className="absolute inset-y-0 w-px bg-line-strong" style={{ left: zero }} />
      {tone !== "base" && (
        <div
          className="absolute top-1/2 h-[55%] -translate-y-1/2 rounded-[2px]"
          style={{
            left: x(lo),
            width: `calc(${x(hi)} - ${x(lo)})`,
            background: color,
            opacity: tone === "noise" ? 0.55 : 0.9,
          }}
        />
      )}
      <div
        className="absolute top-1/2 h-full -translate-y-1/2 border-x"
        style={{
          left: x(deltaPct - errorPct),
          width: `calc(${x(deltaPct + errorPct)} - ${x(deltaPct - errorPct)})`,
          borderColor: color,
          background: `color-mix(in oklch, ${color} 18%, transparent)`,
        }}
      />
      <div
        className="absolute top-1/2 h-[2px] w-[2px] -translate-1/2 rounded-full"
        style={{ left: x(deltaPct), background: "var(--fg)" }}
      />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong bg-sunk px-1 text-[10.5px] leading-none text-muted">
      {children}
    </kbd>
  );
}

export const modKey =
  typeof navigator !== "undefined" && /Mac|iPhone/.test(navigator.platform) ? "⌘" : "Ctrl";
