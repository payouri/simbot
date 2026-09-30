import { describe, expect, test } from "bun:test";
import {
  costModelFromCheckSim,
  DEFAULT_COST_MODEL,
  estimateSeconds,
  isSoftWarning,
} from "./estimate";
import { weaponRulesFor } from "./weapons";

describe("estimateSeconds", () => {
  const base = { fightSeconds: 60, precision: "medium", model: DEFAULT_COST_MODEL } as const;
  /** Seconds of one Stage over `n` Combinations at `error`% under the default model. */
  const stage = (n: number, error: number) => (n * (250 / error ** 2) * 1.5) / 1000;

  test("grows with the number of Combinations", () => {
    expect(estimateSeconds({ ...base, combinations: 1000 })).toBeGreaterThan(
      estimateSeconds({ ...base, combinations: 100 }),
    );
  });

  test("a tighter precision costs more, a longer fight costs more", () => {
    const at = (precision: "low" | "medium" | "high", fightSeconds = 60) =>
      estimateSeconds({ ...base, combinations: 500, precision, fightSeconds });
    expect(at("high")).toBeGreaterThan(at("low"));
    expect(at("medium", 300)).toBeCloseTo(at("medium", 60) * 5, 5);
  });

  test("uses the measured model", () => {
    const fast = { msPerIteration: 0.5, iterationsTimesErrorSq: 250 };
    expect(estimateSeconds({ ...base, combinations: 500, model: fast })).toBeCloseTo(
      estimateSeconds({ ...base, combinations: 500 }) / 3,
      5,
    );
  });

  test("up to four Combinations is a single full-precision Stage", () => {
    expect(estimateSeconds({ ...base, combinations: 1 })).toBeCloseTo(stage(1, 0.2), 5);
    expect(estimateSeconds({ ...base, combinations: 4 })).toBeCloseTo(stage(4, 0.2), 5);
  });

  test("follows the Smart Sim's Stage ladder, not a coarser one", () => {
    // Medium runs 1% -> 0.3% -> 0.2%; the survivor model keeps 400 of 2000, then 40 of 400.
    expect(estimateSeconds({ ...base, combinations: 2000 })).toBeCloseTo(
      stage(2000, 1) + stage(400, 0.3) + stage(40, 0.2),
      5,
    );
    // Low is two Stages, 1% -> 0.5%; Stage 1 alone is about 187 s for 500 Combinations.
    expect(estimateSeconds({ ...base, precision: "low", combinations: 500 })).toBeCloseTo(
      stage(500, 1) + stage(100, 0.5),
      5,
    );
  });

  test("a Medium Top Gear of 2000 Combinations warns about a long run", () => {
    expect(isSoftWarning(estimateSeconds({ ...base, combinations: 2000 }))).toBe(true);
  });

  test("soft warning starts above 30 minutes", () => {
    expect(isSoftWarning(1800)).toBe(false);
    expect(isSoftWarning(1801)).toBe(true);
  });
});

describe("costModelFromCheckSim", () => {
  test("derives per-iteration cost and iterations x error^2", () => {
    const m = costModelFromCheckSim({ durationMs: 4000, iterations: 1000, errorPercent: 0.5 });
    expect(m).toEqual({ msPerIteration: 2, iterationsTimesErrorSq: 250 });
  });

  test("gives nothing when a number is missing", () => {
    expect(costModelFromCheckSim({ durationMs: null, iterations: 5, errorPercent: 1 })).toBeNull();
    expect(costModelFromCheckSim({ durationMs: 10, iterations: null, errorPercent: 1 })).toBeNull();
    expect(costModelFromCheckSim({ durationMs: 10, iterations: 5, errorPercent: 0 })).toBeNull();
  });
});

describe("weaponRulesFor", () => {
  test("Fury has Titan's Grip and dual wield", () => {
    expect(weaponRulesFor("warrior", "fury")).toEqual({ dualWield: true, titansGrip: true });
    expect(weaponRulesFor("warrior", "arms")).toEqual({ dualWield: false, titansGrip: false });
  });
  test("dual wield by class and spec", () => {
    expect(weaponRulesFor("rogue", null).dualWield).toBe(true);
    expect(weaponRulesFor("deathknight", "Frost").dualWield).toBe(true);
    expect(weaponRulesFor("deathknight", "unholy").dualWield).toBe(false);
    expect(weaponRulesFor("mage", "fire").dualWield).toBe(false);
  });
});
