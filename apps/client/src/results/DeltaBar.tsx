import type { RowTone } from "@simbot/shared";
import clsx from "clsx";

export const fmtDps = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtPct = (n: number, digits = 2) =>
  `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}%`;
export const fmtSigned = (n: number) =>
  `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

const COLOR: Record<RowTone, string> = {
  gain: "var(--gain)",
  loss: "var(--loss)",
  noise: "var(--noise)",
  base: "var(--fg-faint)",
};

/**
 * Δ vs equipped on a scale shared by every row, with the error drawn as a band with whiskers
 * and the mean as a dot. `noise` rows cannot be told apart from #1 or from zero.
 */
export function DeltaBar({
  deltaPct,
  errorPct,
  min,
  max,
  tone,
  height = 12,
}: {
  deltaPct: number;
  errorPct: number;
  min: number;
  max: number;
  tone: RowTone;
  height?: number;
}) {
  const span = max - min || 1;
  const x = (v: number) => `${((Math.min(max, Math.max(min, v)) - min) / span) * 100}%`;
  const lo = Math.min(0, deltaPct);
  const hi = Math.max(0, deltaPct);
  const color = COLOR[tone];
  return (
    <div
      className="relative w-full"
      style={{ height }}
      role="img"
      aria-label={`${fmtPct(deltaPct)} versus equipped, plus or minus ${errorPct.toFixed(2)}%`}
    >
      <div className="absolute inset-y-0 w-px bg-line-strong" style={{ left: x(0) }} />
      {tone !== "base" && (
        <div
          className={clsx(
            "absolute top-1/2 h-[55%] -translate-y-1/2 rounded-[2px]",
            tone === "noise" ? "opacity-55" : "opacity-90",
          )}
          style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})`, background: color }}
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
        className="absolute top-1/2 size-[2px] -translate-1/2 rounded-full bg-fg"
        style={{ left: x(deltaPct) }}
      />
    </div>
  );
}
