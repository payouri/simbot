import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CombinationDefinition, defaultSimSettings } from "@simbot/shared";
import {
  buildStageInput,
  CULL_KEEP_TOP,
  type CullEntry,
  cull,
  invalidProfileset,
  Json2FormatError,
  profilesetLines,
  readImportGear,
  readStageReport,
  stageLadder,
} from "./index";

const addonString = readFileSync(
  join(import.meta.dir, "../../../apps/server/test/fixtures/import-items/addon-string.txt"),
  "utf8",
);

describe("stageLadder", () => {
  test("each preset ends at its own precision, above the fixed 1% then 0.3% rungs", () => {
    expect(stageLadder("low", 100)).toEqual([1, 0.5]);
    expect(stageLadder("medium", 100)).toEqual([1, 0.3, 0.2]);
    expect(stageLadder("high", 100)).toEqual([1, 0.3, 0.1]);
  });

  test("up to 4 Combinations there is one Stage, at the picked precision", () => {
    for (const n of [1, 2, 4]) {
      expect(stageLadder("low", n)).toEqual([0.5]);
      expect(stageLadder("medium", n)).toEqual([0.2]);
      expect(stageLadder("high", n)).toEqual([0.1]);
    }
    expect(stageLadder("medium", 5)).toHaveLength(3);
  });
});

const entry = (id: number, mean: number, error: number, isBaseline = false): CullEntry => ({
  id,
  isBaseline,
  mean,
  error,
});

describe("cull", () => {
  test("drops what is behind the best by at least 2 combined standard errors", () => {
    // Combined error of x and the best: hypot(300, 400) = 500; the band is 1000.
    const field = [
      entry(1, 100_000, 400),
      ...Array.from({ length: 10 }, (_, i) => entry(i + 2, 100_000 - 10 * (i + 1), 1)),
      entry(20, 99_001, 300), // 999 behind: inside the band
      entry(21, 99_000, 300), // exactly 1000 behind: out
      entry(22, 90_000, 300),
    ];
    const { kept, culled } = cull(field);
    expect(kept).toContain(20);
    expect(culled).toEqual([21, 22]);
  });

  test("always keeps the top 10 by mean, however far behind", () => {
    // 12 Combinations, all miles behind the best; only the best is close.
    const field = [
      entry(1, 200_000, 1),
      ...Array.from({ length: 11 }, (_, i) => entry(i + 2, 100_000 - i * 100, 1)),
    ];
    const { kept, culled } = cull(field);
    expect(kept).toHaveLength(CULL_KEEP_TOP);
    expect(kept).toContain(1);
    expect(kept).toContain(10); // the ninth-best of the rest
    expect(culled).toEqual([11, 12]);
  });

  test("never culls the baseline, even last and far behind", () => {
    const field = [
      ...Array.from({ length: 12 }, (_, i) => entry(i + 2, 200_000 - i, 1)),
      entry(1, 50_000, 1, true),
    ];
    const { kept, culled } = cull(field);
    expect(kept).toContain(1);
    expect(culled).not.toContain(1);
    expect(kept).toHaveLength(11);
  });

  test("a wide error keeps a close contender the bands overlap", () => {
    const { kept } = cull([
      entry(1, 100_000, 50),
      ...Array.from({ length: 10 }, (_, i) => entry(i + 2, 100_000 - i, 50)),
      entry(50, 98_000, 2_000), // 2000 behind, but its own error is 2000
    ]);
    expect(kept).toContain(50);
  });

  test("a field of ten or fewer is kept whole", () => {
    const field = [entry(1, 100, 0), entry(2, 1, 0), entry(3, 0, 0)];
    expect(cull(field).culled).toEqual([]);
  });
});

describe("profilesetLines", () => {
  const gear = readImportGear(addonString);
  const at = (slot: string, id: number) =>
    gear.itemBodies.findIndex((b, i) => b.includes(`id=${id}`) && i >= 0 && slot);
  const baseline: CombinationDefinition = { kind: "equipped", gear: {}, talentLoadout: null };

  test("writes only the slot that differs, guarded", () => {
    const head = at("head", 175302);
    const lines = profilesetLines(
      7,
      { kind: "gear", gear: { ...gear.equipped, head }, talentLoadout: null },
      baseline,
      gear,
    );
    expect(lines).toEqual([
      `profileset."7"+=profileset_controller.set_bonus_enabled=1`,
      `profileset."7"+=head=${gear.itemBodies[head]}`,
    ]);
  });

  test("an emptied slot is cleared and a different Talent Loadout is written", () => {
    const { off_hand: _o, ...withoutTrinket } = gear.equipped;
    const { trinket2: _t, ...rest } = withoutTrinket;
    const lines = profilesetLines(
      2,
      { kind: "gear", gear: rest, talentLoadout: 0 },
      baseline,
      gear,
    );
    expect(lines).toContain(`profileset."2"+=trinket2=`);
    // Loadout 0 is the equipped talents line: nothing to override.
    expect(lines.some((l) => l.includes("talents="))).toBe(false);
    const other = { ...gear, loadouts: ["talents=AAA"] };
    expect(
      profilesetLines(3, { kind: "gear", gear: gear.equipped, talentLoadout: 0 }, baseline, other),
    ).toContain(`profileset."3"+=talents=AAA`);
  });
});

describe("buildStageInput", () => {
  const gear = readImportGear(addonString);
  const baseline: CombinationDefinition = { kind: "equipped", gear: {}, talentLoadout: null };
  const head = gear.itemBodies.findIndex((b) => b.includes("id=175302"));

  test("puts the Stage's target error and a profileset per survivor after the Addon String", () => {
    const input = buildStageInput({
      addonString,
      settings: defaultSimSettings,
      targetError: 0.3,
      baseline,
      profilesets: [
        {
          id: 4,
          definition: { kind: "gear", gear: { ...gear.equipped, head }, talentLoadout: null },
        },
      ],
    });
    expect(input.startsWith(addonString)).toBe(true);
    expect(input).toContain("target_error=0.3\n");
    expect(input).toContain("iterations=50000");
    expect(input).toContain(`profileset."4"+=head=`);
    expect(input).not.toContain("target_error=0.2");
  });

  test("with no survivor it is the Quick Sim input at that target", () => {
    const input = buildStageInput({
      addonString,
      settings: defaultSimSettings,
      targetError: 0.2,
      baseline,
      profilesets: [],
    });
    expect(input).not.toContain("profileset");
    expect(input).not.toContain("iterations=");
  });
});

describe("readStageReport", () => {
  const report = (results: unknown[]) =>
    JSON.stringify({
      sim: {
        options: { confidence_estimator: 2 },
        players: [{ collected_data: { dps: { mean: 100, mean_std_dev: 3 } } }],
        profilesets: { results },
      },
    });

  test("matches profilesets by name in any order", () => {
    const out = readStageReport(
      report([
        { name: "9", mean: 90, mean_error: 4 },
        { name: "5", mean: 95, stddev: 20, iterations: 100 },
      ]),
      [5, 9],
    );
    expect(out.baseline).toEqual({ mean: 100, meanError: 6 });
    expect(out.profilesets.get(9)).toEqual({ mean: 90, meanError: 4 });
    expect(out.profilesets.get(5)).toEqual({ mean: 95, meanError: 4 });
  });

  test("a missing profileset, a missing file and garbage are format errors", () => {
    expect(() => readStageReport(report([]), [3])).toThrow(Json2FormatError);
    expect(() => readStageReport(null, [])).toThrow(Json2FormatError);
    expect(() => readStageReport("{", [])).toThrow(Json2FormatError);
    expect(() => readStageReport(report([{ name: "3", mean: 1 }]), [3])).toThrow(Json2FormatError);
  });

  test("a report without profilesets is fine when none are expected", () => {
    const text = JSON.stringify({
      sim: {
        options: { confidence_estimator: 2 },
        players: [{ collected_data: { dps: { mean: 1, mean_std_dev: 1 } } }],
      },
    });
    expect(readStageReport(text, []).profilesets.size).toBe(0);
  });
});

test("invalidProfileset reads the id out of SimC's error", () => {
  expect(invalidProfileset("Error: Initialization error: Profileset '12': bad")).toBe(12);
  expect(invalidProfileset("Error: Player 'o0': nope")).toBeNull();
});
