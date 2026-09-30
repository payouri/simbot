import { describe, expect, test } from "bun:test";
import {
  changedSlots,
  type ImportItem,
  moveSelection,
  NOISE_SIGMA,
  rankResults,
  redress,
  type StageResult,
  verdictFor,
} from "../packages/shared/src";

const res = (
  combinationId: number,
  stage: number,
  mean: number,
  meanError: number,
  isBaseline = false,
): StageResult => ({
  combinationId,
  isBaseline,
  stage,
  dps: { mean, meanError },
  survived: true,
});
const BASE = res(1, 3, 100_000, 50, true);

describe("rankResults", () => {
  test("measures Δ against the baseline's final-Stage result, not its first", () => {
    // The baseline moved between Stages (100k at Stage 1, 101k at Stage 3): Δ uses the latter.
    const r = rankResults([
      res(1, 1, 100_000, 300, true),
      res(1, 3, 101_000, 50, true),
      res(2, 3, 102_000, 50),
    ]);
    const row = r.rows.find((x) => x.combinationId === 2);
    expect(row?.delta).toBe(1000);
    expect(row?.deltaPct).toBeCloseTo(0.99, 2);
    expect(r.baseline?.mean).toBe(101_000);
  });

  test("a deeper Stage outranks a shallower one whatever the mean", () => {
    const r = rankResults([BASE, res(2, 1, 200_000, 100), res(3, 3, 99_000, 50)]);
    expect(r.rows.map((x) => x.combinationId)).toEqual([1, 3, 2]);
    expect(r.rows.map((x) => x.stage)).toEqual([3, 3, 1]);
  });

  test("groups the rows within noise of #1 at the top", () => {
    const r = rankResults([
      BASE,
      res(2, 3, 103_000, 50),
      res(3, 3, 102_950, 50),
      res(4, 3, 102_900, 50),
      res(5, 3, 101_000, 50),
    ]);
    expect(r.noiseGroup).toBe(3);
    expect(r.rows.map((x) => x.inNoiseGroup)).toEqual([true, true, true, false, false]);
    expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(r.rows[0]?.tone).toBe("noise");
  });

  test("puts a wide-error row that ties #1 in the group even when a tighter row below it does not", () => {
    const r = rankResults([
      BASE,
      res(2, 3, 103_000, 50),
      res(3, 3, 102_700, 50),
      res(4, 3, 102_500, 400),
    ]);
    expect(r.rows.map((x) => x.combinationId)).toEqual([2, 4, 3, 1]);
    expect(r.rows.slice(0, 2).every((x) => x.inNoiseGroup)).toBe(true);
    expect(r.rows[2]?.inNoiseGroup).toBe(false);
  });

  test("tones: gain, loss and noise against zero; error combines with the baseline's", () => {
    const r = rankResults([
      BASE,
      res(2, 3, 105_000, 50),
      res(3, 3, 95_000, 50),
      res(4, 3, 100_040, 50),
    ]);
    const tone = (id: number) => r.rows.find((x) => x.combinationId === id)?.tone;
    expect(tone(1)).toBe("base");
    expect(tone(2)).toBe("gain");
    expect(tone(3)).toBe("loss");
    expect(tone(4)).toBe("noise");
    const four = r.rows.find((x) => x.combinationId === 4);
    expect(four?.errorPct).toBeCloseTo((Math.hypot(50, 50) / 100_000) * 100, 6);
    expect(NOISE_SIGMA).toBe(2);
  });

  test("one shared scale covers every row's band and zero", () => {
    const r = rankResults([BASE, res(2, 3, 105_000, 500), res(3, 3, 90_000, 500)]);
    for (const row of r.rows) {
      expect(row.deltaPct - row.errorPct).toBeGreaterThanOrEqual(r.min);
      expect(row.deltaPct + row.errorPct).toBeLessThanOrEqual(r.max);
    }
    expect(r.min).toBeLessThan(0);
    expect(r.max).toBeGreaterThan(0);
  });

  test("a stopped Sim ranks what it has, each row at the Stage it reached", () => {
    const r = rankResults([
      res(1, 1, 100_000, 300, true),
      res(2, 1, 101_000, 300),
      res(3, 1, 99_000, 300),
    ]);
    expect(r.rows.map((x) => x.stage)).toEqual([1, 1, 1]);
    expect(r.rows[0]?.combinationId).toBe(2);
  });

  test("nothing finished: empty ranking", () => {
    expect(rankResults([]).rows).toEqual([]);
  });

  test("stays fast with 10,000 rows", () => {
    const rows: StageResult[] = [BASE];
    for (let i = 2; i <= 10_000; i++) rows.push(res(i, 3, 90_000 + ((i * 7919) % 20_000), 40));
    const start = performance.now();
    const r = rankResults(rows);
    expect(performance.now() - start).toBeLessThan(500);
    expect(r.rows).toHaveLength(10_000);
    expect(r.rows.map((x) => x.rank)).toEqual(Array.from({ length: 10_000 }, (_, i) => i + 1));
  });
});

describe("verdictFor", () => {
  test("equipped is best when the baseline leads", () => {
    const r = rankResults([BASE, res(2, 3, 99_000, 50)]);
    expect(verdictFor(r, 0, false)).toMatchObject({
      kind: "equipped",
      headline: "Your equipped set is best",
    });
  });

  test("equipped is best when the leader is inside the baseline's noise", () => {
    const r = rankResults([BASE, res(2, 3, 100_050, 50)]);
    expect(verdictFor(r, 1, false).kind).toBe("equipped");
  });

  test("a clear winner names the gain and the number of changes", () => {
    const r = rankResults([BASE, res(2, 3, 103_000, 50), res(3, 3, 101_000, 50)]);
    const v = verdictFor(r, 2, false);
    expect(v.kind).toBe("upgrade");
    expect(v.headline).toBe("+3.0% (±0.1) with 2 changes");
  });

  test("top N within noise", () => {
    const r = rankResults([
      BASE,
      res(2, 3, 103_000, 50),
      res(3, 3, 102_950, 50),
      res(4, 3, 102_900, 50),
    ]);
    expect(verdictFor(r, 1, false)).toMatchObject({
      kind: "noise",
      headline: "Top 3 are within noise; pick by preference",
    });
  });

  test("a stopped Sim is provisional, and an empty one says so", () => {
    const r = rankResults([res(1, 1, 100_000, 300, true), res(2, 1, 104_000, 300)]);
    expect(verdictFor(r, 1, true).kind).toBe("partial");
    expect(verdictFor(rankResults([]), 0, true).kind).toBe("empty");
  });
});

const item = (index: number, slot: string): ImportItem =>
  ({ index, slot, source: "bags", status: "ok", name: `i${index}` }) as ImportItem;

describe("redress", () => {
  const items = new Map(
    [
      item(0, "head"),
      item(1, "head"),
      item(2, "finger1"),
      item(3, "finger2"),
      item(4, "finger1"),
    ].map((i) => [i.index, i]),
  );
  const equipped = { head: 0, finger1: 2, finger2: 3 };

  test("marks the new item fresh and the replaced one gone", () => {
    const d = redress({ head: 1, finger1: 2, finger2: 3 }, equipped, items);
    expect(d.head.fresh.map((i) => i.index)).toEqual([1]);
    expect(d.head.gone.map((i) => i.index)).toEqual([0]);
    expect(d.finger.fresh).toEqual([]);
    expect(changedSlots(d)).toEqual(["head"]);
  });

  test("two rings that swap fingers change nothing; one new ring shows which went", () => {
    expect(changedSlots(redress({ head: 0, finger1: 3, finger2: 2 }, equipped, items))).toEqual([]);
    const d = redress({ head: 0, finger1: 4, finger2: 3 }, equipped, items);
    expect(d.finger.fresh.map((i) => i.index)).toEqual([4]);
    expect(d.finger.gone.map((i) => i.index)).toEqual([2]);
    expect(d.finger.items.map((i) => i.index)).toEqual([4, 3]);
  });

  test("the equipped set itself has no changes", () => {
    expect(changedSlots(redress(equipped, equipped, items))).toEqual([]);
  });
});

describe("moveSelection", () => {
  test("j goes down, k goes up, both stop at the ends, other keys stay", () => {
    expect(moveSelection(2, 10, "j")).toBe(3);
    expect(moveSelection(2, 10, "k")).toBe(1);
    expect(moveSelection(0, 10, "k")).toBe(0);
    expect(moveSelection(9, 10, "j")).toBe(9);
    expect(moveSelection(4, 10, "x")).toBe(4);
    expect(moveSelection(4, 0, "j")).toBe(0);
  });
});
