import { type Precision, SOFT_WARN_SECONDS } from "@simbot/shared";
import { CULL_KEEP_TOP, stageLadder } from "../smart-sim";

/**
 * What one SimC Build costs to run, measured on this machine.
 * - `msPerIteration`: wall time of one iteration of one profileset over a 60 s fight, all
 *   threads working.
 * - `iterationsTimesErrorSq`: iterations x (mean error in percent of DPS)^2, near constant, so
 *   reaching error `e` takes about `iterationsTimesErrorSq / e^2` iterations.
 */
export type CostModel = { msPerIteration: number; iterationsTimesErrorSq: number };

/**
 * The stand-in until a Check Sim has measured the Current SimC Build. It is the model the
 * app's own learner (`costModelFromStages`) read off the 4-item Sim (9 Combinations, first
 * repeat) of `apps/server/bench/results/2026-09-30T12-47-17-748Z.json`: SimC
 * 1210-2026-09-29-d08a1c3, `profileset_work_threads=1`, `analyze_error_interval=50`, Medium,
 * AMD Ryzen 7 7735HS on 16 threads. The 12-item Sim's own model there (0.130, 59.2) is higher
 * in `iterationsTimesErrorSq` because its 971-profileset 1% Stage outweighs the rest, and a 1%
 * Stage runs to the error-check interval (59.7 iterations per profileset, where its later
 * Stages' iterations × error² are 38.6 and 39.6), which one constant cannot follow. The old 1.5
 * and 250 were about 12x and 5x the new values.
 * How it fares, from the files' summaries: on its own file it gives 86% to 115% of measured
 * wall time (a fit, not a test); on caps 14, 16 and 18 of `2026-09-30T12-50-50-411Z.json`,
 * 80%, 80% and 78% (2,916 to 39,366 Combinations); on `2026-09-30T13-53-13-088Z.json`, the only
 * file run with this model already in place, 81% to 94% (72% to 80% with SimC's `threads=8`). So it under-estimates large Top Gears
 * by about a fifth, and a Sim a little over 30 minutes can show no soft warning. None of that
 * checks the Check Sim basis (never measured) or the model the app learns from its last Top
 * Gear: learnt from a larger case, a 9-Combination Sim came out at 139% to 143% (`12-47`) and
 * 152% at High (`2026-09-30T12-44-04-817Z.json`), outside 30%. One gear set on one machine: a
 * slower machine needs its Check Sim.
 */
export const DEFAULT_COST_MODEL: CostModel = {
  msPerIteration: 0.124,
  iterationsTimesErrorSq: 49.9,
};

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
 * Both Culls keep `CULL_KEEP_TOP` Combinations (the baseline is among them), a fixed floor and
 * no share of the field. Read off the benchmark's one gear set, over every Top Gear in results
 * `2026-09-30T11-07-06-473Z.json`, `2026-09-30T11-50-49-078Z.json`,
 * `2026-09-30T12-33-34-232Z.json` and `2026-09-30T12-44-04-817Z.json`: from 80 profilesets the
 * first Cull left 9 (plus the baseline) every time; from 971 it left 9 in 23 of 40 Sims and up
 * to 16; the second Cull left 9 every time. Larger fields keep more: from 2,915, 8,747 and
 * 39,365 profilesets the first Cull left 25, 37 and 47 (`2026-09-30T12-50-50-411Z.json`), and
 * 21 to 27 from 8,747 (`2026-09-30T13-53-13-088Z.json`). This shape under-counts those, but the
 * Stages after the first were at most 11% of those Sims' Stage time, 1% at 39,365.
 * The real Cull keeps whoever is within 2 standard errors of the best, so a set whose items
 * are closer in DPS than this one's keeps more, and this shape then under-estimates. Only one
 * real gear set has been measured.
 */
export const ESTIMATE_CULLS: readonly CullShape[] = [
  { keepFraction: 0, keepMin: CULL_KEEP_TOP },
  { keepFraction: 0, keepMin: CULL_KEEP_TOP },
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
