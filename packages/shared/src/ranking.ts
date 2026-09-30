import type { StageResult } from "./sim";

/**
 * Two results are told apart when their means differ by at least this many combined standard
 * errors. It is the Cull's own threshold (`best − x ≥ 2·√(err_x² + err_best²)`), so a row the
 * ranking calls indistinguishable is one the Cull would have kept too.
 */
export const NOISE_SIGMA = 2;

/** Tone of a build-to-build DPS delta: noise unless it clears both builds' combined error. */
export function deltaTone(diff: number, errorA: number, errorB: number): "gain" | "loss" | "noise" {
  if (Math.abs(diff) <= NOISE_SIGMA * Math.hypot(errorA, errorB)) return "noise";
  return diff > 0 ? "gain" : "loss";
}

/** How a row reads against the equipped set. `noise`: cannot be told apart from #1 or from 0. */
export type RowTone = "base" | "gain" | "loss" | "noise";

export type RankedRow = {
  combinationId: number;
  isBaseline: boolean;
  /** 1-based position in the ranking. */
  rank: number;
  /** The last Stage this Combination has a Stage Result for. */
  stage: number;
  mean: number;
  error: number;
  /** DPS against the baseline's final-Stage result. */
  delta: number;
  deltaPct: number;
  /** The row's error and the baseline's combined, in percent of the baseline's DPS. */
  errorPct: number;
  /** The row cannot be told apart from #1 (#1 itself included when it is not alone). */
  inNoiseGroup: boolean;
  tone: RowTone;
};

export type Ranking = {
  rows: RankedRow[];
  /** The baseline's row, wherever it ranks; null when nothing has finished. */
  baseline: RankedRow | null;
  /** Rows tied with #1 in the noise, #1 included; 1 when #1 stands alone. */
  noiseGroup: number;
  /** One scale for every row's Δ% ± error, zero included. */
  min: number;
  max: number;
};

type Last = {
  combinationId: number;
  isBaseline: boolean;
  stage: number;
  mean: number;
  error: number;
};

/**
 * Ranks Combinations by their last finished Stage: a deeper Stage always outranks a shallower
 * one, so a Stage 1 number never sits above a Stage 3 one. Within the Stage the rows that cannot
 * be told apart from #1 come first (by mean), then the rest by mean. Every Δ is against the
 * baseline's own last Stage Result, which is its final-Stage one because the baseline is never
 * Culled. Pure: O(n log n) for tens of thousands of rows.
 */
export function rankResults(results: readonly StageResult[]): Ranking {
  const lastOf = new Map<number, Last>();
  for (const r of results) {
    const prev = lastOf.get(r.combinationId);
    if (!prev || r.stage > prev.stage) {
      lastOf.set(r.combinationId, {
        combinationId: r.combinationId,
        isBaseline: r.isBaseline,
        stage: r.stage,
        mean: r.dps.mean,
        error: r.dps.meanError,
      });
    }
  }
  const lasts = [...lastOf.values()];
  const base = lasts.find((l) => l.isBaseline) ?? null;
  if (!base || base.mean <= 0) {
    return { rows: [], baseline: null, noiseGroup: 0, min: 0, max: 0 };
  }

  const byStageThenMean = (a: Last, b: Last) =>
    b.stage - a.stage || b.mean - a.mean || a.combinationId - b.combinationId;
  lasts.sort(byStageThenMean);
  const top = lasts[0] as Last;
  const tiedWithTop = (l: Last) =>
    l.stage === top.stage && top.mean - l.mean < NOISE_SIGMA * Math.hypot(l.error, top.error);
  const tied = new Set(lasts.filter(tiedWithTop).map((l) => l.combinationId));
  const ordered = [
    ...lasts.filter((l) => tied.has(l.combinationId)),
    ...lasts.filter((l) => !tied.has(l.combinationId)),
  ];
  const noiseGroup = tied.size;

  let lo = 0;
  let hi = 0;
  const rows = ordered.map((l, i): RankedRow => {
    const delta = l.mean - base.mean;
    const deltaPct = (delta / base.mean) * 100;
    const errorPct = ((l.isBaseline ? l.error : Math.hypot(l.error, base.error)) / base.mean) * 100;
    const inNoiseGroup = noiseGroup > 1 && tied.has(l.combinationId);
    let tone: RowTone;
    if (l.isBaseline) tone = "base";
    else if (inNoiseGroup || Math.abs(deltaPct) < NOISE_SIGMA * errorPct) tone = "noise";
    else tone = delta > 0 ? "gain" : "loss";
    lo = Math.min(lo, deltaPct - errorPct);
    hi = Math.max(hi, deltaPct + errorPct);
    return {
      combinationId: l.combinationId,
      isBaseline: l.isBaseline,
      rank: i + 1,
      stage: l.stage,
      mean: l.mean,
      error: l.error,
      delta,
      deltaPct,
      errorPct,
      inNoiseGroup,
      tone,
    };
  });
  const pad = (hi - lo) * 0.06 || 0.5;
  return {
    rows,
    baseline: rows.find((r) => r.isBaseline) ?? null,
    noiseGroup,
    min: lo - pad,
    max: hi + pad,
  };
}

export type VerdictKind = "upgrade" | "equipped" | "noise" | "partial" | "empty";

export type Verdict = { kind: VerdictKind; headline: string; detail: string };

const signed = (n: number, digits: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The plain sentence that comes first. Measured against the baseline's final-Stage result:
 * "equipped is best" when nothing beats the baseline outside the noise, "top N within noise"
 * when several leaders cannot be told apart, otherwise the clear winner. A stopped Sim is only
 * ever provisional.
 *
 * @param topChanges how many slots the #1 Combination changes against the equipped set
 */
export function verdictFor(ranking: Ranking, topChanges: number, stopped: boolean): Verdict {
  const top = ranking.rows[0];
  if (!top) {
    return {
      kind: "empty",
      headline: stopped ? "Stopped before anything finished" : "No results",
      detail: "No Combination has a result yet.",
    };
  }
  const pct = `${signed(top.deltaPct, 1)}%`;
  const err = `±${top.errorPct.toFixed(1)}`;
  const changes = plural(topChanges, "change", "changes");
  if (stopped) {
    return {
      kind: "partial",
      headline: top.isBaseline
        ? "So far, your equipped set leads"
        : `So far, ${pct} (${err}) with ${changes}`,
      detail:
        "The Sim was stopped. Rows are ranked by the deepest Stage they finished, so treat the order as provisional.",
    };
  }
  const baselineTied = top.isBaseline || ranking.baseline?.inNoiseGroup === true;
  if (baselineTied) {
    return {
      kind: "equipped",
      headline: "Your equipped set is best",
      detail: top.isBaseline
        ? "Nothing in this selection beats what you are wearing."
        : `The best combination is ${pct}, which is inside the noise of your equipped set. Keep what you have.`,
    };
  }
  if (ranking.noiseGroup >= 2) {
    return {
      kind: "noise",
      headline: `Top ${ranking.noiseGroup} are within noise; pick by preference`,
      detail: `They all gain about ${pct} over equipped, and the sim cannot tell them apart at this precision.`,
    };
  }
  return {
    kind: "upgrade",
    headline: `${pct} (${err}) with ${changes}`,
    detail: `Beats your equipped set by ${Math.round(top.delta).toLocaleString("en-US")} DPS, clear of the noise.`,
  };
}

/**
 * The row j (down) or k (up) moves the selection to, clamped to the list; any other key keeps it.
 */
export function moveSelection(current: number, count: number, key: string): number {
  if (count <= 0) return 0;
  const step = key === "j" ? 1 : key === "k" ? -1 : 0;
  return Math.max(0, Math.min(count - 1, current + step));
}
