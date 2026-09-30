import { type Precision, SOFT_WARN_SECONDS } from "@simbot/shared";
import { stageLadder } from "../smart-sim";

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
 * Unmeasured defaults, not yet calibrated against real Sims; no accuracy is claimed.
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

/** What one finished Smart Sim Stage cost: the numbers stored next to its results. */
export type StageCost = {
  /** Wall time of the Stage's SimC run. */
  durationMs: number;
  /** Iterations summed over the profilesets that ran in the Stage. */
  iterations: number;
  /** Profilesets that ran in the Stage (the baseline is not one). */
  profilesets: number;
  /** The Stage's `target_error`, percent of DPS. */
  targetError: number;
  /** Fight length of the Sim the Stage belongs to. */
  fightSeconds: number;
};

/**
 * Refines the cost model from a finished Top Gear's Stages. Each Stage ran its profilesets plus
 * the baseline, every actor to the Stage's `target_error`; the profilesets' mean iteration count
 * stands in for the baseline's. Stages with a number that is not positive are skipped; null when
 * none is left to learn from.
 */
export function costModelFromStages(stages: readonly StageCost[]): CostModel | null {
  let ms = 0;
  let iterationsAt60 = 0;
  let iterationsTimesErrorSq = 0;
  let actors = 0;
  for (const s of stages) {
    const { durationMs, iterations, profilesets, targetError, fightSeconds } = s;
    if ([durationMs, iterations, profilesets, targetError, fightSeconds].some((n) => !(n > 0))) {
      continue;
    }
    const perActor = iterations / profilesets;
    const n = profilesets + 1;
    ms += durationMs;
    iterationsAt60 += n * perActor * (fightSeconds / COST_MODEL_FIGHT_SECONDS);
    iterationsTimesErrorSq += n * perActor * targetError ** 2;
    actors += n;
  }
  if (actors === 0) return null;
  return {
    msPerIteration: ms / iterationsAt60,
    iterationsTimesErrorSq: iterationsTimesErrorSq / actors,
  };
}

/** Who a Cull is assumed to keep: `keepFraction` of the field, never fewer than `keepMin`. */
export type CullShape = { keepFraction: number; keepMin: number };

/**
 * The survivor model the estimate assumes for each Cull, in Stage order (the final Stage has no
 * Cull). The Stage precisions themselves come from `stageLadder`, the ladder the Smart Sim runs.
 * - First Cull: keep the top 20%, at least 40.
 * - Second Cull: keep the top 10%, at least 12 (above `CULL_KEEP_TOP` plus the baseline).
 * The real Cull keeps whoever is within 2 standard errors of the best, so the share it keeps
 * depends on the DPS spread. Unmeasured shape (provisional): real Cull behavior may differ; no
 * accuracy is claimed.
 */
export const ESTIMATE_CULLS: readonly CullShape[] = [
  { keepFraction: 0.2, keepMin: 40 },
  { keepFraction: 0.1, keepMin: 12 },
];

export type EstimateInput = {
  combinations: number;
  fightSeconds: number;
  /** The precision preset; it picks the Stage ladder (`stageLadder`) and the final error. */
  precision: Precision;
  model?: CostModel;
};

/** Wall-clock seconds for a Top Gear over `combinations`, laddered like the Smart Sim. */
export function estimateSeconds(input: EstimateInput): number {
  const model = input.model ?? DEFAULT_COST_MODEL;
  const perIterationMs = model.msPerIteration * (input.fightSeconds / COST_MODEL_FIGHT_SECONDS);
  let alive = Math.max(0, Math.floor(input.combinations));
  let ms = 0;
  stageLadder(input.precision, alive).forEach((error, i) => {
    ms += alive * (model.iterationsTimesErrorSq / error ** 2) * perIterationMs;
    const cull = ESTIMATE_CULLS[i] ?? ESTIMATE_CULLS[ESTIMATE_CULLS.length - 1];
    if (cull) alive = Math.min(alive, Math.max(cull.keepMin, Math.ceil(alive * cull.keepFraction)));
  });
  return ms / 1000;
}

export const isSoftWarning = (seconds: number) => seconds > SOFT_WARN_SECONDS;
