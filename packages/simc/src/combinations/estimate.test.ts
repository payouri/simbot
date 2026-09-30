import { describe, expect, test } from "bun:test";
import {
  costModelFromCheckSim,
  DEFAULT_COST_MODEL,
  estimateSeconds,
  isSoftWarning,
} from "./estimate";
import { weaponRulesFor } from "./weapons";

describe("estimateSeconds", () => {
  const base = { fightSeconds: 60, targetErrorPercent: 0.2, model: DEFAULT_COST_MODEL };

  test("grows with the number of Combinations", () => {
    expect(estimateSeconds({ ...base, combinations: 1000 })).toBeGreaterThan(
      estimateSeconds({ ...base, combinations: 100 }),
    );
  });

  test("a tighter target costs more, a longer fight costs more", () => {
    const at = (targetErrorPercent: number, fightSeconds = 60) =>
      estimateSeconds({ ...base, combinations: 500, targetErrorPercent, fightSeconds });
    expect(at(0.1)).toBeGreaterThan(at(0.5));
    expect(at(0.2, 300)).toBeCloseTo(at(0.2, 60) * 5, 5);
  });

  test("uses the measured model", () => {
    const fast = { msPerIteration: 0.5, iterationsTimesErrorSq: 250 };
    expect(estimateSeconds({ ...base, combinations: 500, model: fast })).toBeCloseTo(
      estimateSeconds({ ...base, combinations: 500 }) / 3,
      5,
    );
  });

  test("one Combination is a single full-precision run", () => {
    const s = estimateSeconds({ ...base, combinations: 1 });
    const iterations = 250 / 0.2 ** 2;
    expect(s).toBeGreaterThan((iterations * 1.5) / 1000);
    expect(s).toBeLessThan(((iterations * 1.5) / 1000) * 1.2);
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
