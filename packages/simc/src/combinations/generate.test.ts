import { describe, expect, test } from "bun:test";
import { MAX_COMBINATIONS } from "@simbot/shared";
import { type GearItem, type GenerateInput, generateCombinations } from "./generate";

let next = 0;
/** A gear item; the index counts up, the signature is unique unless given. */
const gear = (slot: string, extra: Partial<GearItem> = {}): GearItem => {
  const index = next++;
  return {
    index,
    slot,
    source: "bags",
    itemId: 1000 + index,
    signature: `id=${1000 + index}`,
    ilvl: 600,
    ...extra,
  };
};
const worn = (slot: string, extra: Partial<GearItem> = {}) =>
  gear(slot, { source: "equipped", ...extra });

const run = (items: GearItem[], rest: Partial<GenerateInput> = {}, materialize = true) =>
  generateCombinations(
    {
      items,
      included: items.filter((i) => i.source !== "equipped").map((i) => i.index),
      lockedSlots: [],
      talentLoadouts: [],
      equippedLoadout: null,
      ...rest,
    },
    { materialize },
  );

const slotsOf = (c: { gear: Record<string, number> }, slot: string) => c.gear[slot];

describe("baseline and plain slots", () => {
  test("Combination 1 is the equipped baseline, then one per candidate", () => {
    const head = worn("head");
    const alt = gear("head");
    const alt2 = gear("head");
    const neck = worn("neck");
    const r = run([head, alt, alt2, neck]);
    expect(r.count).toBe(3);
    expect(r.combinations?.[0]).toMatchObject({ id: 1, isBaseline: true });
    expect(r.combinations?.[0]?.gear).toEqual({ head: head.index, neck: neck.index });
    expect(r.combinations?.map((c) => c.gear.head).sort()).toEqual(
      [head.index, alt.index, alt2.index].sort(),
    );
    expect(r.combinations?.filter((c) => c.isBaseline)).toHaveLength(1);
  });

  test("candidates multiply across slots", () => {
    const r = run([worn("head"), gear("head"), worn("neck"), gear("neck"), gear("neck")]);
    expect(r.count).toBe(2 * 3);
  });

  test("a candidate that is not included is not used", () => {
    const head = worn("head");
    const alt = gear("head");
    const r = run([head, alt], { included: [] });
    expect(r.count).toBe(1);
  });

  test("a locked slot keeps what is worn even with candidates included", () => {
    const head = worn("head");
    const alt = gear("head");
    const neck = worn("neck");
    const alt2 = gear("neck");
    const r = run([head, alt, neck, alt2], { lockedSlots: ["head"] });
    expect(r.count).toBe(2);
    expect(r.combinations?.every((c) => slotsOf(c, "head") === head.index)).toBe(true);
  });

  test("the walk visits the smallest slot first but the result does not depend on it", () => {
    const items = [
      worn("head"),
      gear("head"),
      gear("head"),
      gear("head"),
      worn("neck"),
      gear("neck"),
    ];
    const a = run(items);
    const b = run([...items].reverse());
    expect(a.count).toBe(8);
    expect(b.count).toBe(8);
  });
});

describe("pruning", () => {
  test("at most one Great Vault item", () => {
    const r = run([
      worn("head"),
      gear("head", { source: "great_vault" }),
      worn("neck"),
      gear("neck", { source: "great_vault" }),
      worn("back"),
      gear("back"),
    ]);
    // 2 x 2 x 2 = 8, minus head+neck both vault (2 back choices)
    expect(r.count).toBe(6);
    for (const c of r.combinations ?? []) {
      const vaults = [slotsOf(c, "head"), slotsOf(c, "neck")].filter(
        (i) => i !== undefined && i > 0,
      );
      expect(vaults.length).toBeLessThanOrEqual(2);
    }
  });

  test("two vault items in one ring pair are refused", () => {
    const a = gear("finger1", { source: "great_vault" });
    const b = gear("finger2", { source: "great_vault" });
    const r = run([worn("finger1"), worn("finger2"), a, b]);
    const pairs = r.combinations?.map((c) => [c.gear.finger1, c.gear.finger2].sort());
    expect(pairs?.some((p) => p?.includes(a.index) && p.includes(b.index))).toBe(false);
  });

  test("unique-equipped by item id: two copies never sit together", () => {
    const wornCopy = worn("finger1", { itemId: 77, uniqueEquipped: true, signature: "id=77,a" });
    const other = worn("finger2", { itemId: 5, signature: "id=5" });
    const bagCopy = gear("finger1", { itemId: 77, uniqueEquipped: true, signature: "id=77,b" });
    const r = run([wornCopy, other, bagCopy]);
    // pairs: {worn77, 5} baseline, {bag77, 5}; {worn77, bag77} is refused
    expect(r.count).toBe(2);
    expect(
      r.combinations?.some((c) => [c.gear.finger1, c.gear.finger2].every((i) => i !== other.index)),
    ).toBe(false);
  });

  test("a non-unique duplicate is allowed", () => {
    const a = worn("finger1", { itemId: 77, signature: "id=77,a" });
    const b = worn("finger2", { itemId: 5, signature: "id=5" });
    const c = gear("finger1", { itemId: 77, signature: "id=77,b" });
    expect(run([a, b, c]).count).toBe(3);
  });

  test("item-limit categories cap how many of a category are worn", () => {
    const limits = new Map([[512, 2]]);
    const emb = (slot: string, worn_ = false) =>
      gear(slot, { source: worn_ ? "equipped" : "bags", limitCategories: [512] });
    const h = emb("head", true);
    const n = emb("neck", true);
    const c = emb("chest");
    // head + neck equipped already fill the limit of 2; chest candidate can only replace nothing
    const r = run([h, n, worn("chest"), c], { categoryLimits: limits });
    expect(r.count).toBe(1);
    expect(r.unusedCandidates).toEqual([c.index]);
  });

  test("a category limit does not touch items outside it", () => {
    const limits = new Map([[512, 1]]);
    const r = run([worn("head"), gear("head", { limitCategories: [512] })], {
      categoryLimits: limits,
    });
    expect(r.count).toBe(2);
  });

  test("unique gems: the same unique gem cannot sit on two items", () => {
    const h = worn("head", { gemIds: [9] });
    const n = gear("neck", { gemIds: [9] });
    const r = run([h, worn("neck"), n], { uniqueGems: new Set([9]) });
    expect(r.count).toBe(1);
    expect(run([h, worn("neck"), n]).count).toBe(2);
  });

  test("catalyst charges bound how many catalysed items are worn", () => {
    const a = gear("head", { catalystCost: 1 });
    const b = gear("chest", { catalystCost: 1 });
    const items = [worn("head"), a, worn("chest"), b];
    expect(run(items, { catalystCharges: 1 }).count).toBe(3);
    expect(run(items, { catalystCharges: 0 }).count).toBe(1);
    expect(run(items, { catalystCharges: 2 }).count).toBe(4);
    expect(run(items).count).toBe(4);
  });

  test("the upgrade budget bounds the total upgrade cost", () => {
    const a = gear("head", { upgradeCost: 60 });
    const b = gear("chest", { upgradeCost: 60 });
    const items = [worn("head"), a, worn("chest"), b];
    expect(run(items, { upgradeBudget: 100 }).count).toBe(3);
    expect(run(items, { upgradeBudget: 120 }).count).toBe(4);
    expect(run(items, { upgradeBudget: 50 }).count).toBe(1);
  });
});

describe("rings and trinkets", () => {
  test("rings are unordered pairs", () => {
    const a = worn("finger1");
    const b = worn("finger2");
    const c = gear("finger1");
    const r = run([a, b, c]);
    expect(r.count).toBe(3); // {a,b} {a,c} {b,c}
    const keys = new Set(r.combinations?.map((x) => [x.gear.finger1, x.gear.finger2].sort()));
    expect(keys.size).toBe(3);
  });

  test("four rings make six pairs", () => {
    const r = run([worn("finger1"), worn("finger2"), gear("finger1"), gear("finger2")]);
    expect(r.count).toBe(6);
  });

  test("the baseline keeps the order it is worn in", () => {
    const a = worn("finger1");
    const b = worn("finger2");
    const r = run([a, b, gear("finger1")]);
    expect(r.combinations?.[0]?.gear).toEqual({ finger1: a.index, finger2: b.index });
  });

  test("two on-use trinkets are simmed in both orders", () => {
    const a = worn("trinket1", { onUse: true });
    const b = worn("trinket2", { onUse: true });
    const c = gear("trinket1", { onUse: true });
    const r = run([a, b, c]);
    // {a,b} ordered x2, {a,c} x2, {b,c} x2
    expect(r.count).toBe(6);
    expect(r.combinations?.[0]?.gear).toEqual({ trinket1: a.index, trinket2: b.index });
  });

  test("an on-use trinket with a passive one is one order", () => {
    const a = worn("trinket1", { onUse: true });
    const b = worn("trinket2");
    const c = gear("trinket1", { onUse: true });
    // {a,b} {b,c} one order each; {a,c} both on-use, two orders
    expect(run([a, b, c]).count).toBe(4);
  });

  test("a trinket slot without candidates does not add swapped orders", () => {
    const a = worn("trinket1", { onUse: true });
    const b = worn("trinket2", { onUse: true });
    expect(run([a, b]).count).toBe(1);
  });
});

describe("weapons", () => {
  const dual = { dualWield: true, titansGrip: false };
  const none = { dualWield: false, titansGrip: false };

  test("a two-hander is worn alone", () => {
    const mh = worn("main_hand", { hand: "1h" });
    const oh = worn("off_hand", { hand: "shield" });
    const th = gear("main_hand", { hand: "2h" });
    const r = run([mh, oh, th], { weapons: none });
    expect(r.count).toBe(2);
    const two = r.combinations?.find((c) => c.gear.main_hand === th.index);
    expect(two?.gear.off_hand).toBeUndefined();
  });

  test("a one-hander needs an off hand", () => {
    const mh = worn("main_hand", { hand: "1h" });
    const oh = worn("off_hand", { hand: "off" });
    const alone = gear("main_hand", { hand: "1h" });
    const r = run([mh, oh, alone], { weapons: none });
    // alone can pair with oh
    expect(r.count).toBe(2);
    const bad = gear("main_hand", { hand: "1h" });
    const only = run([gear("main_hand", { hand: "1h" }), worn("main_hand", { hand: "2h" }), bad], {
      weapons: none,
    });
    expect(only.unusedCandidates.length).toBe(2);
  });

  test("a one-hander with no off hand anywhere is refused and reported", () => {
    const mh = worn("main_hand", { hand: "2h" });
    const hammer = gear("main_hand", { hand: "1h" });
    const r = run([mh, hammer], { weapons: none });
    expect(r.count).toBe(1);
    expect(r.unusedCandidates).toEqual([hammer.index]);
  });

  test("off-hand-only items go in the off hand, main-hand-only in the main", () => {
    const main = worn("main_hand", { hand: "main" });
    const off = worn("off_hand", { hand: "off" });
    const shield = gear("off_hand", { hand: "shield" });
    const r = run([main, off, shield], { weapons: none });
    expect(r.count).toBe(2);
    expect(r.combinations?.every((c) => c.gear.main_hand === main.index)).toBe(true);
  });

  test("without dual wield a one-hander is never an off hand", () => {
    const a = worn("main_hand", { hand: "1h" });
    const b = worn("off_hand", { hand: "off" });
    const c = gear("main_hand", { hand: "1h" });
    const r = run([a, b, c], { weapons: none });
    expect(r.combinations?.every((x) => x.gear.off_hand === b.index)).toBe(true);
  });

  test("dual wield pairs two one-handers, unordered", () => {
    const a = worn("main_hand", { hand: "1h" });
    const b = worn("off_hand", { hand: "1h" });
    const c = gear("main_hand", { hand: "1h" });
    const r = run([a, b, c], { weapons: dual });
    expect(r.count).toBe(3); // {a,b} {a,c} {b,c}
  });

  test("Fury wields two two-handers", () => {
    const a = worn("main_hand", { hand: "2h" });
    const b = worn("off_hand", { hand: "2h" });
    const c = gear("main_hand", { hand: "2h" });
    const fury = { dualWield: true, titansGrip: true };
    const r = run([a, b, c], { weapons: fury });
    // singles a,b,c; pairs {a,b} {a,c} {b,c}
    expect(r.count).toBe(6);
    expect(r.combinations?.[0]?.gear).toEqual({ main_hand: a.index, off_hand: b.index });
    // Without Titan's Grip: the three two-handers alone, and the worn pair as the baseline.
    expect(run([a, b, c], { weapons: dual }).count).toBe(4);
  });
});

describe("tier minimums, dedupe and loadouts", () => {
  const tier = (slot: string, source: GearItem["source"] = "bags") =>
    gear(slot, { source, setId: 1 });

  test("a tier minimum removes Combinations with too few pieces, after the walk", () => {
    const items = [
      tier("head", "equipped"),
      tier("shoulders", "equipped"),
      worn("chest"),
      tier("chest"),
      worn("hands"),
      tier("hands"),
    ];
    expect(run(items).count).toBe(4);
    expect(run(items, { minTierPieces: 3 }).count).toBe(1 + 3); // baseline + those with >= 3
    expect(run(items, { minTierPieces: 4 }).count).toBe(1 + 1); // baseline + both tier swaps
  });

  test("the baseline is kept whatever the tier minimum says", () => {
    const r = run([worn("head"), gear("head")], { minTierPieces: 4 });
    expect(r.count).toBe(1);
    expect(r.combinations?.[0]?.isBaseline).toBe(true);
  });

  test("identical items dedupe to one Combination", () => {
    const a = worn("head", { signature: "id=1,bonus=2" });
    const same = gear("head", { signature: "id=1,bonus=2" });
    const r = run([a, same, worn("neck")]);
    expect(r.count).toBe(1);
  });

  test("swapped rings are one Combination even from different pools", () => {
    const a = worn("finger1", { signature: "A" });
    const b = worn("finger2", { signature: "B" });
    const dupB = gear("finger1", { signature: "B" });
    expect(run([a, b, dupB]).count).toBe(2 - 1 + 1); // {A,B}, {A,B}dup, {B,B}
  });

  test("Talent Loadouts multiply the gear Combinations", () => {
    const items = [worn("head"), gear("head"), gear("head")];
    const r = run(items, { talentLoadouts: [0, 1], equippedLoadout: 0 });
    expect(r.count).toBe(6);
    expect(r.combinations?.[0]).toMatchObject({ isBaseline: true, talentLoadout: 0 });
    expect(r.combinations?.filter((c) => c.isBaseline)).toHaveLength(1);
  });

  test("the baseline stays when its loadout is deselected", () => {
    const items = [worn("head"), gear("head")];
    const r = run(items, { talentLoadouts: [1], equippedLoadout: 0 });
    expect(r.count).toBe(2 * 1 + 1);
    expect(r.combinations?.[0]).toMatchObject({ isBaseline: true, talentLoadout: 0 });
  });

  test("Combination ids run from 1", () => {
    const r = run([worn("head"), gear("head"), gear("head")], {
      talentLoadouts: [0, 1],
      equippedLoadout: 0,
    });
    expect(r.combinations?.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("the runaway guard", () => {
  const big = (slots: number, per: number) => {
    const names = ["head", "neck", "shoulders", "back", "chest", "wrists", "hands", "waist"];
    return names
      .slice(0, slots)
      .flatMap((s) => [worn(s), ...Array.from({ length: per }, () => gear(s))]);
  };

  test("counts past the limit without materialising", () => {
    const r = run(big(8, 5)); // 6^8 = 1.6M
    expect(r.atLeast).toBe(true);
    expect(r.combinations).toBeUndefined();
    expect(r.count).toBeGreaterThan(MAX_COMBINATIONS);
  });

  test("a large but finite count is exact and fast", () => {
    const started = performance.now();
    const r = run(big(6, 6), {}, false); // 7^6 = 117,649 > walk of 250k? no: exact
    expect(r.atLeast).toBe(false);
    expect(r.count).toBe(7 ** 6);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("the node cap also stops a walk that finds nothing", () => {
    const items = big(6, 6);
    const r = generateCombinations(
      {
        items,
        included: items.map((i) => i.index),
        lockedSlots: [],
        talentLoadouts: [],
        equippedLoadout: null,
      },
      { nodeCap: 1000 },
    );
    expect(r.atLeast).toBe(true);
  });
});
