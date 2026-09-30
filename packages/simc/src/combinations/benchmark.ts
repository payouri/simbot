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
   * The last Check Sim of `simcTag` in the benchmarked data dir: the basis of the estimate a Top
   * Gear preview shows before any Top Gear has finished on that build. Null when it has none.
   */
  checkSim: BenchCheckSim | null;
  sims: BenchSim[];
};

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
  results: Pick<BenchResults, "sims" | "checkSim">,
): SimEstimateCheck[] {
  const { sims } = results;
  const checkSimModel = results.checkSim ? costModelFromCheckSim(results.checkSim) : null;
  return sims.map((sim) => {
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
    out.push({
      sweep,
      sims: ss.length,
      cases: perCase.size,
      totalWallSeconds: [...perCase.values()].reduce((sum, ms) => sum + median(ms) / 1000, 0),
      atCeiling: stages.reduce((n, s) => n + (s.atCeiling ?? 0), 0),
      profilesets: stages.reduce((n, s) => n + s.profilesets, 0),
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
    "",
    "Sweep points, fastest first (sum over cases of the median wall time):",
  ];
  for (const s of summarizeSweeps(results.sims)) {
    lines.push(
      `  ${s.sweep}: ${s.totalWallSeconds.toFixed(1)}s over ${s.cases} cases, ${s.atCeiling}/${s.profilesets} profileset runs at the ceiling`,
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
