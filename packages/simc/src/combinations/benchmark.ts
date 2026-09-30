import type { Precision } from "@simbot/shared";
import { SOFT_WARN_SECONDS } from "@simbot/shared";
import {
  type CostModel,
  costModelFromCheckSim,
  costModelFromStages,
  estimateSeconds,
  type StageCost,
} from "./estimate";

/**
 * Reading of the Top Gear benchmark's raw measurements (`apps/server/bench/top-gear.ts`): which
 * threading and precision settings ran fastest, and how far the time estimate is from the wall
 * time the Sims really took. Pure: the script measures, this only reads what it wrote.
 */

/**
 * One point of the benchmark's sweep: the SimC options it varies. Each goes into the Sim's raw
 * options, after the lines the Stage input writes, so it overrides them.
 */
export type SweepPoint = {
  profilesetWorkThreads: number;
  analyzeErrorInterval: number;
  iterationsCeiling: number;
  /** SimC's total `threads`. Absent: SimC's own default, every logical thread. */
  totalThreads?: number;
};

/** One finished Stage of a benchmarked Sim, as the app stored it plus what its report says. */
export type BenchStage = {
  stage: number;
  durationMs: number;
  /** Summed over the profilesets; null when SimC did not report it. */
  iterations: number | null;
  profilesets: number;
  targetError: number;
  /** Most iterations any one profileset ran, from the Stage's json2. Null when unread. */
  maxIterations: number | null;
  /** Profilesets that ran `iterationsCeiling` iterations or more (stopped by it, not by error). */
  atCeiling: number | null;
  /**
   * Error the Stage's profilesets reached, each one's `mean_error` in percent of its mean (the
   * unit of `targetError`): the worst and the median, from the Stage's json2. Null when unread,
   * and absent from files written before it was recorded.
   */
  maxErrorPercent?: number | null;
  medianErrorPercent?: number | null;
};

/** One Top Gear Sim of one case at one sweep point. */
export type BenchSim = {
  /** Name of the gear set and its selection, e.g. `fixture/cap-12`. */
  caseName: string;
  precision: Precision;
  fightSeconds: number;
  /** Combinations generated, the baseline included. */
  combinations: number;
  sweep: SweepPoint;
  /** 1-based repeat of the same case and sweep point. */
  repeat: number;
  /** Wall time from queueing the Sim to the runner going idle. */
  wallMs: number;
  stages: BenchStage[];
  /** What the preview promised before the Sim (default cost model); null when refused. */
  previewEstimateSeconds: number | null;
};

/** What the Current SimC Build's last Check Sim measured, as the app stores it. */
export type BenchCheckSim = {
  durationMs: number | null;
  iterations: number | null;
  errorPercent: number;
};

export type BenchResults = {
  schema: 1;
  /** Only ever written by the benchmark script. */
  producedBy: "apps/server/bench/top-gear.ts";
  startedAt: string;
  simcTag: string;
  machine: { cpus: number; model: string };
  /**
   * The last Check Sim of `simcTag` in the benchmarked data dir, which the `check sim` column
   * reads when a case's set has none in `checkSims`. Null when it has none. The app no longer
   * estimates from a Check Sim (`costModelFromCheckSim`).
   */
  checkSim: BenchCheckSim | null;
  /**
   * A Check Sim the benchmark ran itself on each gear set, by set name, the way the app runs one
   * on the latest Import. A case's estimate uses its own set's, else `checkSim`. Absent from
   * files written before the benchmark ran them.
   */
  checkSims?: Record<string, BenchCheckSim>;
  sims: BenchSim[];
};

/** The gear set a case belongs to: its name up to the last `/` (`set/cap-12`). */
export const setOfCase = (caseName: string) =>
  caseName.includes("/") ? caseName.slice(0, caseName.lastIndexOf("/")) : caseName;

export const sweepKey = (p: SweepPoint) =>
  `threads=${p.profilesetWorkThreads} interval=${p.analyzeErrorInterval} ceiling=${p.iterationsCeiling}${
    p.totalThreads === undefined ? "" : ` total=${p.totalThreads}`
  }`;

/** The estimate's tolerance the issue asks for: within 30% of the measured wall time. */
export const ESTIMATE_TOLERANCE = 0.3;

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/**
 * The error a Stage's profilesets reached, from its json2 `profilesets.results`: each one's
 * `mean_error` in percent of its `mean`, the worst and the median. Null when none has a
 * positive mean.
 */
export function achievedError(
  results: readonly { mean: number; mean_error: number }[],
): { max: number; median: number } | null {
  const errors = results.flatMap((r) => (r.mean > 0 ? [(r.mean_error / r.mean) * 100] : []));
  return errors.length ? { max: Math.max(...errors), median: median(errors) } : null;
}

/** The Stage costs of a Sim, in the shape the app refines its cost model from. */
export function stageCostsOf(sim: BenchSim): StageCost[] {
  return sim.stages.flatMap((s) =>
    s.iterations === null
      ? []
      : [
          {
            durationMs: s.durationMs,
            iterations: s.iterations,
            profilesets: s.profilesets,
            targetError: s.targetError,
            fightSeconds: sim.fightSeconds,
          },
        ],
  );
}

export type EstimateCheck = {
  seconds: number;
  /** `seconds` over the measured wall time. */
  ratio: number;
  within: boolean;
};

export type SimEstimateCheck = {
  caseName: string;
  sweep: string;
  repeat: number;
  measuredSeconds: number;
  /** The estimate on `DEFAULT_COST_MODEL`: what a build with no Check Sim shows. */
  defaultModel: EstimateCheck;
  /** The estimate on the Check Sim's cost model. Null when the results carry no usable one. */
  checkSimModel: EstimateCheck | null;
  /**
   * The app refines its cost model from its most recent finished Top Gear alone, whichever that
   * was. This is the worst estimate over the models learnt each from one Sim of another case at
   * the same sweep point, with that Sim's name. Null when there is no other case to learn from.
   */
  learntFromOthers: (EstimateCheck & { from: string }) | null;
  /**
   * The estimate on a model learnt from this very Sim, and that model: isolates the Cull-shape
   * error. Null when the Sim reported no iterations.
   */
  learntFromSelf: (EstimateCheck & { model: CostModel }) | null;
};

function check(seconds: number, measured: number): EstimateCheck {
  const ratio = seconds / measured;
  return { seconds, ratio, within: Math.abs(ratio - 1) <= ESTIMATE_TOLERANCE };
}

/** The estimate of a Sim's case on `model`, or the default model when `model` is undefined. */
function estimateSim(sim: BenchSim, model?: CostModel) {
  return estimateSeconds({
    combinations: sim.combinations,
    fightSeconds: sim.fightSeconds,
    precision: sim.precision,
    model,
  });
}

const offBy = (c: EstimateCheck) => Math.abs(c.ratio - 1);

/** Checks the time estimate against every Sim's measured wall time. */
export function checkEstimates(
  results: Pick<BenchResults, "sims" | "checkSim" | "checkSims">,
): SimEstimateCheck[] {
  const { sims } = results;
  return sims.map((sim) => {
    const checkSim = results.checkSims?.[setOfCase(sim.caseName)] ?? results.checkSim;
    const checkSimModel = checkSim ? costModelFromCheckSim(checkSim) : null;
    const measured = sim.wallMs / 1000;
    const key = sweepKey(sim.sweep);
    let worst: (EstimateCheck & { from: string }) | null = null;
    for (const other of sims) {
      if (sweepKey(other.sweep) !== key || other.caseName === sim.caseName) continue;
      const model = costModelFromStages(stageCostsOf(other));
      if (!model) continue;
      const c = check(estimateSim(sim, model), measured);
      if (!worst || offBy(c) > offBy(worst)) {
        worst = { ...c, from: `${other.caseName} #${other.repeat}` };
      }
    }
    const self = costModelFromStages(stageCostsOf(sim));
    return {
      caseName: sim.caseName,
      sweep: key,
      repeat: sim.repeat,
      measuredSeconds: measured,
      defaultModel: check(estimateSim(sim), measured),
      checkSimModel: checkSimModel ? check(estimateSim(sim, checkSimModel), measured) : null,
      learntFromOthers: worst,
      learntFromSelf: self ? { ...check(estimateSim(sim, self), measured), model: self } : null,
    };
  });
}

export type SweepSummary = {
  sweep: string;
  sims: number;
  /** Cases this sweep point ran, each by the median of its repeats. */
  cases: number;
  /** Sum over cases of the median wall time. Comparable between points with the same cases. */
  totalWallSeconds: number;
  /** Profilesets that stopped at the iterations ceiling, summed over every Stage of every Sim. */
  atCeiling: number;
  /** Profilesets that ran in total, same scope. */
  profilesets: number;
  /** `targetError` of the final Stage, when every Sim here shares one. */
  finalTargetError: number | null;
  /**
   * Error reached in each Sim's final Stage (its worst profileset): the median over the Sims and
   * the worst. Null when no Sim's report was read for it.
   */
  finalErrorMedian: number | null;
  finalErrorMax: number | null;
};

/** One line per sweep point, fastest first; only points that ran every case are comparable. */
export function summarizeSweeps(sims: readonly BenchSim[]): SweepSummary[] {
  const allCases = new Set(sims.map((s) => s.caseName));
  const byPoint = new Map<string, BenchSim[]>();
  for (const s of sims) {
    const key = sweepKey(s.sweep);
    byPoint.set(key, [...(byPoint.get(key) ?? []), s]);
  }
  const out: SweepSummary[] = [];
  for (const [sweep, ss] of byPoint) {
    const perCase = new Map<string, number[]>();
    for (const s of ss) perCase.set(s.caseName, [...(perCase.get(s.caseName) ?? []), s.wallMs]);
    if (perCase.size !== allCases.size) continue;
    const stages = ss.flatMap((s) => s.stages);
    const finals = ss.flatMap((s) => s.stages.at(-1) ?? []);
    const targets = new Set(finals.map((s) => s.targetError));
    const reached = finals.flatMap((s) =>
      typeof s.maxErrorPercent === "number" ? [s.maxErrorPercent] : [],
    );
    out.push({
      sweep,
      sims: ss.length,
      cases: perCase.size,
      totalWallSeconds: [...perCase.values()].reduce((sum, ms) => sum + median(ms) / 1000, 0),
      atCeiling: stages.reduce((n, s) => n + (s.atCeiling ?? 0), 0),
      profilesets: stages.reduce((n, s) => n + s.profilesets, 0),
      finalTargetError: targets.size === 1 ? ([...targets][0] as number) : null,
      finalErrorMedian: reached.length ? median(reached) : null,
      finalErrorMax: reached.length ? Math.max(...reached) : null,
    });
  }
  return out.sort((a, b) => a.totalWallSeconds - b.totalWallSeconds);
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const cell = (c: EstimateCheck | null) =>
  c ? `${c.seconds.toFixed(1)}s (${pct(c.ratio)})${c.within ? "" : " OUT"}` : "n/a";

/** The text the script prints: sweep points ranked, then the estimate against every Sim. */
export function formatSummary(results: BenchResults): string {
  const lines = [
    `SimC ${results.simcTag} on ${results.machine.cpus} threads (${results.machine.model}), ${results.startedAt}`,
    ...Object.entries(results.checkSims ?? {}).map(
      ([set, c]) =>
        `Check Sim on ${set}: ${c.durationMs === null ? "n/a" : `${(c.durationMs / 1000).toFixed(1)}s`}, ${c.iterations ?? "n/a"} iterations, ${c.errorPercent.toFixed(3)}% error`,
    ),
    "",
    "Sweep points, fastest first (sum over cases of the median wall time):",
  ];
  for (const s of summarizeSweeps(results.sims)) {
    const reached =
      s.finalErrorMedian === null || s.finalErrorMax === null
        ? "final-Stage error n/a"
        : `final-Stage error ${s.finalErrorMedian.toFixed(3)}% median, ${s.finalErrorMax.toFixed(3)}% max${
            s.finalTargetError === null ? "" : ` (target ${s.finalTargetError}%)`
          }`;
    lines.push(
      `  ${s.sweep}: ${s.totalWallSeconds.toFixed(1)}s over ${s.cases} cases, ${s.atCeiling}/${s.profilesets} profileset runs at the ceiling, ${reached}`,
    );
  }
  lines.push(
    "",
    `Estimate against measured wall time (tolerance +-${pct(ESTIMATE_TOLERANCE)}, soft warning at ${SOFT_WARN_SECONDS}s):`,
  );
  for (const c of checkEstimates(results)) {
    const others = c.learntFromOthers
      ? `${cell(c.learntFromOthers)} from ${c.learntFromOthers.from}`
      : "n/a";
    const self = c.learntFromSelf
      ? `${cell(c.learntFromSelf)} on msPerIteration=${c.learntFromSelf.model.msPerIteration.toPrecision(3)} iterationsTimesErrorSq=${c.learntFromSelf.model.iterationsTimesErrorSq.toPrecision(3)}`
      : "n/a";
    lines.push(
      `  ${c.caseName} #${c.repeat} [${c.sweep}] measured ${c.measuredSeconds.toFixed(1)}s | default ${cell(c.defaultModel)} | check sim ${cell(c.checkSimModel)} | learnt from others (worst) ${others} | learnt from self ${self}`,
    );
  }
  return lines.join("\n");
}
