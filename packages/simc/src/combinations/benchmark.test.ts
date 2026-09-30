import { describe, expect, test } from "bun:test";
import {
  type BenchSim,
  type BenchStage,
  checkEstimates,
  type SweepPoint,
  summarizeSweeps,
  sweepKey,
} from "./benchmark";

// Every number here is synthetic, made up to exercise the arithmetic. None is a measurement.
const pt = (profilesetWorkThreads: number): SweepPoint => ({
  profilesetWorkThreads,
  analyzeErrorInterval: 100,
  iterationsCeiling: 50_000,
});

const stage = (n: number, over: Partial<BenchStage> = {}): BenchStage => ({
  stage: n,
  durationMs: 10_000,
  iterations: 10_000,
  profilesets: 10,
  targetError: 1,
  maxIterations: 1000,
  atCeiling: 0,
  ...over,
});

const sim = (caseName: string, wallMs: number, sweep = pt(2), over: Partial<BenchSim> = {}) =>
  ({
    caseName,
    precision: "low",
    fightSeconds: 60,
    combinations: 11,
    sweep,
    repeat: 1,
    wallMs,
    stages: [stage(1)],
    previewEstimateSeconds: null,
    ...over,
  }) satisfies BenchSim;

const checks = (sims: BenchSim[]) => checkEstimates({ sims, checkSim: null });

describe("summarizeSweeps", () => {
  test("ranks sweep points by the summed median wall time of their cases", () => {
    const sims = [
      sim("a", 10_000, pt(2)),
      sim("b", 20_000, pt(2)),
      sim("a", 6_000, pt(8)),
      sim("b", 9_000, pt(8)),
      sim("b", 11_000, pt(8), { repeat: 2 }),
      sim("b", 10_000, pt(8), { repeat: 3 }),
    ];
    const [best, second] = summarizeSweeps(sims);
    expect(best?.sweep).toBe(sweepKey(pt(8)));
    expect(best?.totalWallSeconds).toBeCloseTo(6 + 10);
    expect(second?.totalWallSeconds).toBeCloseTo(30);
  });

  test("leaves out a sweep point that did not run every case", () => {
    const sims = [sim("a", 1000, pt(2)), sim("b", 1000, pt(2)), sim("a", 500, pt(4))];
    expect(summarizeSweeps(sims).map((s) => s.sweep)).toEqual([sweepKey(pt(2))]);
  });

  test("counts profilesets that stopped at the ceiling", () => {
    const sims = [sim("a", 1000, pt(2), { stages: [stage(1, { atCeiling: 3 })] })];
    expect(summarizeSweeps(sims)[0]).toMatchObject({ atCeiling: 3, profilesets: 10 });
  });
});

describe("checkEstimates", () => {
  test("flags a Sim whose estimate is more than 30% off", () => {
    const [far] = checks([sim("a", 1)]);
    expect(far?.defaultModel.within).toBe(false);
    const seconds = far?.defaultModel.seconds ?? 0;
    const [near] = checks([sim("a", seconds * 1000 * 1.25)]);
    expect(near?.defaultModel.within).toBe(true);
    expect(near?.defaultModel.ratio).toBeCloseTo(0.8);
  });

  test("learns from other cases at the same sweep point only", () => {
    const out = checks([sim("a", 5000, pt(2)), sim("b", 5000, pt(2)), sim("c", 5000, pt(8))]);
    expect(out[0]?.learntFromOthers?.from).toBe("b #1");
    expect(out[2]?.learntFromOthers).toBeNull();
    expect(out[2]?.learntFromSelf).not.toBeNull();
  });

  test("learns from each other Sim alone, like the app, and keeps the worst", () => {
    // "b" took twice as long per iteration as "c"; each is its own model, never pooled.
    const out = checks([
      sim("a", 5000),
      sim("b", 5000, pt(2), { stages: [stage(1, { durationMs: 20_000 })] }),
      sim("c", 5000),
    ]);
    const self = out[0]?.learntFromSelf?.seconds ?? 0;
    expect(out[0]?.learntFromOthers?.from).toBe("b #1");
    expect(out[0]?.learntFromOthers?.seconds).toBeCloseTo(self * 2);
  });

  test("checks the Check Sim's cost model when the results carry one", () => {
    const [c] = checkEstimates({
      sims: [sim("a", 5000)],
      checkSim: { durationMs: 2000, iterations: 1000, errorPercent: 0.5 },
    });
    expect(c?.checkSimModel).not.toBeNull();
    const [none] = checkEstimates({
      sims: [sim("a", 5000)],
      checkSim: { durationMs: null, iterations: 1000, errorPercent: 0.5 },
    });
    expect(none?.checkSimModel).toBeNull();
  });

  test("learns nothing from a Sim whose iterations SimC did not report", () => {
    const [c] = checks([sim("a", 5000, pt(2), { stages: [stage(1, { iterations: null })] })]);
    expect(c?.learntFromSelf).toBeNull();
  });
});
