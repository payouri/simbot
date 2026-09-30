import { describe, expect, test } from "bun:test";
import {
  costModelFromCheckSim,
  costModelFromStages,
  estimateSeconds,
  isSoftWarning,
} from "./estimate";
import { weaponRulesFor } from "./weapons";

describe("estimateSeconds", () => {
  // A fixed model of the test's own, so the expected values do not move when the defaults are
  // re-measured.
  const MODEL = { msPerIteration: 1.5, iterationsTimesErrorSq: 250 };
  const base = { fightSeconds: 60, precision: "medium", model: MODEL } as const;
  /** Seconds of one Stage over `n` Combinations at `error`% under `MODEL`. */
  const stage = (n: number, error: number) => (n * (250 / error ** 2) * 1.5) / 1000;

  test("grows with the number of Combinations", () => {
    expect(estimateSeconds({ ...base, combinations: 1000 })).toBeGreaterThan(
      estimateSeconds({ ...base, combinations: 100 }),
    );
  });

  test("a tighter precision costs more; a longer fight costs the same", () => {
    const at = (precision: "low" | "medium" | "high", fightSeconds = 60) =>
      estimateSeconds({ ...base, combinations: 500, precision, fightSeconds });
    expect(at("high")).toBeGreaterThan(at("low"));
    // Each iteration of a 5x longer fight costs 5x, and it needs a fifth of the iterations.
    expect(at("medium", 300)).toBeCloseTo(at("medium", 60), 5);
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
    // Medium runs 1% -> 0.3% -> 0.2%; the survivor model keeps 10 of 2000, then the same 10.
    expect(estimateSeconds({ ...base, combinations: 2000 })).toBeCloseTo(
      stage(2000, 1) + stage(10, 0.3) + stage(10, 0.2),
      5,
    );
    // Low is two Stages, 1% -> 0.5%.
    expect(estimateSeconds({ ...base, precision: "low", combinations: 500 })).toBeCloseTo(
      stage(500, 1) + stage(10, 0.5),
      5,
    );
  });

  test("a Top Gear warns once its estimate passes 30 minutes, not before", () => {
    // Under the test model Medium Stage 1 costs 0.375 s per Combination: 4000 is about 27 min.
    expect(isSoftWarning(estimateSeconds({ ...base, combinations: 4000 }))).toBe(false);
    expect(isSoftWarning(estimateSeconds({ ...base, combinations: 5000 }))).toBe(true);
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

describe("costModelFromStages", () => {
  test("derives per-iteration cost and iterations x error^2 over every actor of every Stage", () => {
    // Stage 1: 9 profilesets + baseline, 100 iterations each, to 1%, 60 s fight, 3000 ms.
    // Stage 2: 1 profileset + baseline, 400 iterations each, to 0.5%, 120 s fight, 1000 ms.
    const m = costModelFromStages([
      { durationMs: 3000, iterations: 900, profilesets: 9, targetError: 1, fightSeconds: 60 },
      { durationMs: 1000, iterations: 400, profilesets: 1, targetError: 0.5, fightSeconds: 120 },
    ]);
    // 4000 ms over 10 * 100 + 2 * 400 * 2 = 2600 sixty-second iterations.
    expect(m?.msPerIteration).toBeCloseTo(4000 / 2600);
    // At a 60 s fight: (10 * 100 * 1 + 2 * 400 * 0.25 * 120/60) / 12 actors.
    expect(m?.iterationsTimesErrorSq).toBeCloseTo(1400 / 12);
  });

  test("learns the same model from a longer fight that needed fewer iterations", () => {
    const at60 = {
      durationMs: 3000,
      iterations: 900,
      profilesets: 9,
      targetError: 1,
      fightSeconds: 60,
    };
    const at300 = { ...at60, iterations: 180, fightSeconds: 300 };
    expect(costModelFromStages([at300])?.msPerIteration).toBeCloseTo(
      costModelFromStages([at60])?.msPerIteration ?? 0,
    );
    expect(costModelFromStages([at300])?.iterationsTimesErrorSq).toBeCloseTo(
      costModelFromStages([at60])?.iterationsTimesErrorSq ?? 0,
    );
  });

  test("skips Stages it cannot learn from, and gives nothing when none is left", () => {
    const good = {
      durationMs: 2000,
      iterations: 100,
      profilesets: 1,
      targetError: 1,
      fightSeconds: 60,
    };
    expect(costModelFromStages([])).toBeNull();
    expect(costModelFromStages([{ ...good, profilesets: 0 }])).toBeNull();
    expect(costModelFromStages([{ ...good, iterations: 0 }, good])).toEqual(
      costModelFromStages([good]),
    );
    expect(costModelFromStages([good])).toEqual({
      msPerIteration: 10,
      iterationsTimesErrorSq: 100,
    });
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
