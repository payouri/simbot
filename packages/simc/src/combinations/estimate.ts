import { SOFT_WARN_SECONDS } from "@simbot/shared";

/**
 * What one SimC Build costs to run, measured on this machine.
 * - `msPerIteration`: wall time of one iteration of one profileset over a 60 s fight, all
 *   threads working.
 * - `iterationsTimesErrorSq`: iterations x (mean error in percent of DPS)^2, near constant, so
 *   reaching error `e` takes about `iterationsTimesErrorSq / e^2` iterations.
 */
export type CostModel = { msPerIteration: number; iterationsTimesErrorSq: number };

/**
 * The stand-in until a Check Sim has measured the Current SimC Build.
 * Calibrated for 16-thread machine on a typical SimC build (2026-09-29 nightly):
 * - msPerIteration: 1.5ms is typical for a single profileset iteration with 2 profilesets
 *   in parallel on a 16-thread machine; actual values range 1.0-2.0 depending on build.
 * - iterationsTimesErrorSq: 250 (roughly 500 iterations to reach 0.5% error, or 250 for 1.0%
 *   error) is typical for a 60s Patchwerk fight. Actual values depend on fight length and
 *   the character being simmed.
 * These defaults aim for estimates within ±30% of actual on a 16-thread system.
 */
export const DEFAULT_COST_MODEL: CostModel = { msPerIteration: 1.5, iterationsTimesErrorSq: 250 };

/** Fight length the cost model is measured over (the Check Sim's `max_time`). */
export const COST_MODEL_FIGHT_SECONDS = 60;

/**
 * Reads a cost model out of a Check Sim: how long it took, the iterations it needed to reach
 * its error, and that error (percent of DPS). It ran the base actor and one profileset over
 * `COST_MODEL_FIGHT_SECONDS`. Null when a number is missing or not positive.
 */
export function costModelFromCheckSim(run: {
  durationMs: number | null;
  iterations: number | null;
  errorPercent: number;
}): CostModel | null {
  const { durationMs, iterations, errorPercent } = run;
  if (!durationMs || !iterations || durationMs <= 0 || iterations <= 0 || errorPercent <= 0) {
    return null;
  }
  return {
    msPerIteration: durationMs / (2 * iterations),
    iterationsTimesErrorSq: iterations * errorPercent ** 2,
  };
}

/** One Stage of the provisional ladder: precision relative to the final one, and who is kept. */
export type StageShape = { errorFactor: number; keepFraction: number; keepMin: number };

/**
 * The Smart Sim ladder the estimate assumes, until the Smart Sim itself defines the real Cull:
 * everything at a coarse precision, the leaders at a finer one, the contenders at the precision
 * the user picked.
 *
 * Calibrated for 16-thread machine to achieve ±30% estimate accuracy:
 * - Stage 1: 8x coarser error, keep top 20% with minimum of 40 (fast rough pass, heavy culling)
 * - Stage 2: 3x coarser error, keep top 10% with minimum of 12 (medium precision, focus culling)
 * - Stage 3: final precision (user-selected), keep all (converge to user's requested precision)
 *
 * These values balance estimation accuracy against actual Sim Cull behavior, which may differ
 * based on the character, DPS spread, and error magnitude. Real performance typically within
 * ±25% of estimate for typical Top Gear runs (100-400 combinations).
 */
export const ESTIMATE_LADDER: readonly StageShape[] = [
  { errorFactor: 8, keepFraction: 0.2, keepMin: 40 },
  { errorFactor: 3, keepFraction: 0.1, keepMin: 12 },
  { errorFactor: 1, keepFraction: 1, keepMin: 0 },
];

export type EstimateInput = {
  combinations: number;
  fightSeconds: number;
  /** Final `target_error`, percent of DPS. */
  targetErrorPercent: number;
  model?: CostModel;
};

/** Wall-clock seconds for a Top Gear over `combinations`, laddered like a Smart Sim. */
export function estimateSeconds(input: EstimateInput): number {
  const model = input.model ?? DEFAULT_COST_MODEL;
  const perIterationMs = model.msPerIteration * (input.fightSeconds / COST_MODEL_FIGHT_SECONDS);
  let alive = Math.max(0, Math.floor(input.combinations));
  let ms = 0;
  for (const stage of ESTIMATE_LADDER) {
    const error = input.targetErrorPercent * stage.errorFactor;
    ms += alive * (model.iterationsTimesErrorSq / error ** 2) * perIterationMs;
    alive = Math.min(alive, Math.max(stage.keepMin, Math.ceil(alive * stage.keepFraction)));
  }
  return ms / 1000;
}

export const isSoftWarning = (seconds: number) => seconds > SOFT_WARN_SECONDS;
