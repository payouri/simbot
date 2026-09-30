/**
 * The Top Gear benchmark's plumbing against the fake `simc`: it queues a Sim per case and sweep point,
 * reads the Stage costs back and shapes its results. The fake's timings and iterations are
 * canned, so nothing here says anything about real run times.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkEstimates, summarizeSweeps } from "@simbot/simc";
import { type Case, parseArgs, rawOptionsOf, runBenchmark, sweepPoints } from "../bench/top-gear";
import type { Launch } from "../src/runner/run-sim";
import {
  FAKE_SIMC,
  type Harness,
  IMPORT_ITEMS,
  importItemsAddonString,
  installFixtureMeta,
  makeHarness,
  smartLaunch,
} from "./harness";

describe("sweepPoints", () => {
  test("varies one option at a time around the first value of each list", () => {
    const points = sweepPoints([2, 4], [100, 200], [50_000]);
    expect(points).toEqual([
      { profilesetWorkThreads: 2, analyzeErrorInterval: 100, iterationsCeiling: 50_000 },
      { profilesetWorkThreads: 4, analyzeErrorInterval: 100, iterationsCeiling: 50_000 },
      { profilesetWorkThreads: 2, analyzeErrorInterval: 200, iterationsCeiling: 50_000 },
    ]);
  });

  test("sweeps SimC's total threads only when asked, and writes them as `threads=`", () => {
    expect(sweepPoints([1], [50], [9000]).every((p) => p.totalThreads === undefined)).toBe(true);
    const points = sweepPoints([1], [50], [9000], [16, 8]);
    expect(points.map((p) => p.totalThreads)).toEqual([16, 8]);
    expect(rawOptionsOf(points[1] as never)).toBe(
      "profileset_work_threads=1\nanalyze_error_interval=50\niterations=9000\nthreads=8",
    );
    expect(() => parseArgs(["--total-threads", "8,16"])).not.toThrow();
  });

  test("writes a sweep point as raw option lines", () => {
    expect(rawOptionsOf(sweepPoints([8], [50], [9000])[0] as never)).toBe(
      "profileset_work_threads=8\nanalyze_error_interval=50\niterations=9000",
    );
  });
});

describe("parseArgs", () => {
  test("reads --flag value pairs", () => {
    expect([...parseArgs(["--threads", "2,4", "--repeats", "3"])]).toEqual([
      ["threads", "2,4"],
      ["repeats", "3"],
    ]);
  });

  test("refuses an unknown flag or a flag with no value", () => {
    expect(() => parseArgs(["--thread", "2"])).toThrow("unknown option --thread");
    expect(() => parseArgs(["--threads", "--repeats", "3"])).toThrow("--threads needs a value");
    expect(() => parseArgs(["--repeats"])).toThrow("--repeats needs a value");
  });
});

describe("runBenchmark", () => {
  test("sims each case at each sweep point and reads back Stages, counts and wall time", async () => {
    const inputs: string[] = [];
    const harness = (): Harness => {
      const root = () => h.root;
      const stage = smartLaunch(root, (call) => {
        inputs.push(call.input);
        return {
          baseline: [100_000, 50],
          profilesets: Object.fromEntries(call.names.map((n) => [n, [90_000, 50]])),
        };
      });
      const launch: Launch = (dir, args) =>
        /stage-\d+\.simc$/.test(args[0] as string)
          ? stage(dir, args)
          : [process.execPath, FAKE_SIMC, `--scenario=${join(IMPORT_ITEMS, "success")}`, ...args];
      const h = makeHarness({ launch });
      installFixtureMeta(h.dataDir);
      return h;
    };
    const cases: Case[] = [
      { name: "small", addonString: importItemsAddonString(), cap: 4 },
      { name: "large", addonString: importItemsAddonString(), cap: 8 },
    ];
    const sweeps = [
      ...sweepPoints([2, 8], [100], [50_000]),
      {
        profilesetWorkThreads: 2,
        analyzeErrorInterval: 100,
        iterationsCeiling: 50_000,
        totalThreads: 3,
      },
    ];
    const sims = await runBenchmark({
      harness,
      cases,
      sweeps,
      precision: "low",
      fightSeconds: 60,
      repeats: 1,
    });

    expect(sims).toHaveLength(6);
    const small = sims.find((r) => r.caseName === "small");
    const large = sims.find((r) => r.caseName === "large");
    expect(large?.combinations ?? 0).toBeGreaterThan(small?.combinations ?? 0);
    expect(small?.stages.length).toBeGreaterThan(0);
    expect(small?.stages[0]?.profilesets).toBeGreaterThan(0);
    expect(small?.wallMs).toBeGreaterThan(0);
    expect(inputs.some((i) => i.includes("profileset_work_threads=8"))).toBe(true);
    expect(inputs.filter((i) => i.includes("profileset_work_threads=2")).length).toBeGreaterThan(0);
    // `--total-threads` reaches the Stage input as a raw option, after the lines it overrides.
    const withTotal = inputs.filter((i) => /^threads=3$/m.test(i));
    expect(withTotal.length).toBeGreaterThan(0);
    for (const i of withTotal) {
      expect(i.indexOf("threads=3")).toBeGreaterThan(i.indexOf("# Raw options"));
      expect(i.indexOf("# Raw options")).toBeGreaterThan(i.indexOf("profileset_work_threads=1"));
    }
    expect(inputs.filter((i) => /^threads=/m.test(i))).toHaveLength(withTotal.length);

    expect(summarizeSweeps(sims)).toHaveLength(3);
    expect(checkEstimates({ sims, checkSim: null })).toHaveLength(6);
  }, 60_000);
});
