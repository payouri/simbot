import { type Precision, SOFT_WARN_SECONDS } from "@simbot/shared";
import { CULL_KEEP_TOP, stageLadder } from "../smart-sim";

/**
 * What one SimC Build costs to run, measured on this machine.
 * - `msPerIteration`: wall time of one iteration of one profileset over a 60 s fight, all
 *   threads working.
 * - `iterationsTimesErrorSq`: iterations x (mean error in percent of DPS)^2 over a 60 s fight,
 *   near constant, so reaching error `e` takes about `iterationsTimesErrorSq / e^2` iterations
 *   of a 60 s fight, and `60 / fight` times that over a longer one: a longer fight's DPS varies
 *   less. The two cancel, so fight length does not change the estimate.
 */
export type CostModel = { msPerIteration: number; iterationsTimesErrorSq: number };

/**
 * The model a preview uses until a Top Gear has finished on the Current SimC Build: what the
 * app's own learner (`costModelFromStages`) read off the 4-item Sim (9 Combinations, first
 * repeat) of `apps/server/bench/results/2026-09-30T12-47-17-748Z.json` (Frost Death Knight, 300 s
 * fight, interval 50, SimC 1210-2026-09-29-d08a1c3, AMD Ryzen 7 7735HS on 16 threads). Its 249.5
 * is the 49.9 learnt there, restated per 60 s fight (x 300/60); 300 s estimates are unchanged.
 * At today's defaults (threads 1, interval 5, SimC 1210-2026-09-30-613b5fb) it gives 94% to 125%
 * of measured wall time on all 41 such Sims, two gear sets, 9 to 39,366 Combinations, Medium and
 * High, 300 s and 600 s fights: `2026-09-30T15-23-13-858Z.json`, `2026-09-30T17-49-31-838Z.json`,
 * `2026-09-30T18-11-43-303Z.json`, `2026-09-30T18-59-57-173Z.json`,
 * `2026-09-30T19-59-29-283Z.json`. It runs low at Low (`2026-09-30T16-58-33-758Z.json`, interval
 * 50): 61% to 65% on the 4-item Sims (1.4 s and 1.5 s against 2.3 s and 2.4 s), 69% to 94% on the
 * rest. One machine; `apps/server/bench/README.md` has the history.
 */
export const DEFAULT_COST_MODEL: CostModel = {
  msPerIteration: 0.124,
  iterationsTimesErrorSq: 249.5,
};

/** Fight length the cost model is measured over (the Check Sim's `max_time`). */
export const COST_MODEL_FIGHT_SECONDS = 60;

/**
 * Reads a cost model out of a Check Sim: how long it took, the iterations it needed to reach
 * its error, and that error (percent of DPS). It ran the base actor and one profileset over
 * `COST_MODEL_FIGHT_SECONDS`. Null when a number is missing or not positive.
 * The app does not estimate from it: a Check Sim runs a few hundred iterations in about 0.7 s,
 * mostly SimC's start-up. Over the six #58 results files (`2026-09-30T15-23-13-858Z.json` to
 * `2026-09-30T19-59-29-283Z.json`) its model gave 0.9x to 9.5x the measured wall time, within
 * 30% in 6 of 227 Sims, all at `profileset_work_threads=16`, where every Sim ran slow. The
 * benchmark still reports it.
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
    const fightScale = fightSeconds / COST_MODEL_FIGHT_SECONDS;
    iterationsAt60 += n * perActor * fightScale;
    iterationsTimesErrorSq += n * perActor * targetError ** 2 * fightScale;
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
 * are closer in DPS keeps more, and this shape then under-estimates. The second gear set
 * (`bench/sets/gulthrak-fury.txt`) is not such a set: from 8 to 38,880 profilesets every Cull
 * left 9 plus the baseline (`2026-09-30T15-23-13-858Z.json`, `2026-09-30T18-11-43-303Z.json`,
 * `2026-09-30T18-59-57-173Z.json`). At High, 39,365 Frost profilesets left 85, then 9; the
 * Stages after the first were 4% of that Sim (`2026-09-30T17-49-31-838Z.json`). On this shape a
 * Sim's own model gives 92% to 106% of its wall time at today's defaults over every #58 file, and
 * 92% to 124% counting the interval sweep and Low (all at `profileset_work_threads=1`).
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
  // Per iteration the cost grows with the fight and the iterations needed shrink with it: the
  // fight length cancels, so both terms are read at `COST_MODEL_FIGHT_SECONDS`.
  let alive = Math.max(0, Math.floor(input.combinations));
  let ms = 0;
  stageLadder(input.precision, alive).forEach((error, i) => {
    ms += alive * (model.iterationsTimesErrorSq / error ** 2) * model.msPerIteration;
    const cull = ESTIMATE_CULLS[i] ?? ESTIMATE_CULLS[ESTIMATE_CULLS.length - 1];
    if (cull) alive = Math.min(alive, Math.max(cull.keepMin, Math.ceil(alive * cull.keepFraction)));
  });
  return ms / 1000;
}

export const isSoftWarning = (seconds: number) => seconds > SOFT_WARN_SECONDS;
