import { describe, expect, test } from "bun:test";
import { CHECK_SIM_PROFILESET, readCheckSimResult } from "./check-sim";

const report = (dps: Record<string, number>) =>
  JSON.stringify({
    sim: {
      options: { confidence_estimator: 1.96 },
      players: [{ collected_data: { dps: { mean: 100000, mean_std_dev: 500, ...dps } } }],
      profilesets: { results: [{ name: CHECK_SIM_PROFILESET, mean: 100100 }] },
    },
  });

describe("readCheckSimResult", () => {
  test("derives the iteration count from std_dev and mean_std_dev", () => {
    const r = readCheckSimResult(report({ std_dev: 15811 }));
    expect(r.iterations).toBe(Math.round((15811 / 500) ** 2));
    expect(r.dps.meanError).toBeCloseTo(980, 5);
  });

  test("has no iteration count when the report has no std_dev", () => {
    expect(readCheckSimResult(report({})).iterations).toBeNull();
  });
});
