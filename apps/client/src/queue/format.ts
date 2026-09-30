import type { SimProgress } from "@simbot/shared";

const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** `42s`, `1m 4s`, `1h 2m`. */
export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** 0 to 1; SimC's total is an estimate in target-error mode, so the bar is too. */
export const fraction = (p: SimProgress) =>
  p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0;

/** What `done / total` counts, for a label. */
export function unitsLabel(p: SimProgress): string {
  const unit = p.phase === "profilesets" ? "profilesets" : "iterations";
  return `${count.format(p.done)} / ${count.format(p.total)} ${unit}`;
}

export function errorLabel(p: SimProgress): string | null {
  if (p.errorPct === null) return null;
  const now = `${p.errorPct.toFixed(2)}%`;
  return p.targetErrorPct === null ? now : `${now} → ${p.targetErrorPct}%`;
}

export function passLabel(p: SimProgress): string {
  if (p.phase === "baseline") return "Baseline";
  if (p.phase === "profileset") return p.label ?? "Profileset";
  return "Profilesets";
}

/** The estimate in the command column: `~3 min`, `under 1 min`, `~1.5 h`. */
export function formatEstimate(seconds: number): string {
  if (seconds < 60) return "under 1 min";
  const minutes = seconds / 60;
  if (minutes < 120) return `~${Math.round(minutes)} min`;
  return `~${(Math.round(minutes / 6) / 10).toString()} h`;
}
