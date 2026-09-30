import { describe, expect, test } from "bun:test";
import { PRESELECT_MAX_COMBINATIONS } from "@simbot/shared";
import { type GearItem, generateCombinations } from "./generate";
import { preselect } from "./preselect";

let next = 0;
const item = (slot: string, extra: Partial<GearItem> = {}): GearItem => {
  const index = next++;
  return {
    index,
    slot,
    source: "bags",
    itemId: 1000 + index,
    signature: `id=${index}`,
    ilvl: 600,
    ...extra,
  };
};
const base = (items: GearItem[], rest: object = {}) => ({
  items,
  lockedSlots: [],
  talentLoadouts: [],
  equippedLoadout: null,
  ...rest,
});

describe("preselect", () => {
  test("picks only candidates that beat what is worn", () => {
    const head = item("head", { source: "equipped", ilvl: 620 });
    const up = item("head", { ilvl: 630 });
    const down = item("head", { ilvl: 600 });
    expect(preselect(base([head, up, down]))).toEqual([up.index]);
  });

  test("never picks locked slots or items without an item level", () => {
    const head = item("head", { source: "equipped", ilvl: 600 });
    const neck = item("neck", { source: "equipped", ilvl: 600 });
    const up = item("head", { ilvl: 650 });
    const unread = item("neck", { ilvl: null });
    expect(preselect(base([head, neck, up, unread], { lockedSlots: ["head"] }))).toEqual([]);
  });

  test("stays within the Combination budget", () => {
    const items: GearItem[] = [];
    for (const slot of ["head", "neck", "shoulders", "back", "chest", "wrists", "hands"]) {
      items.push(item(slot, { source: "equipped", ilvl: 600 }));
      for (let i = 0; i < 4; i++) items.push(item(slot, { ilvl: 610 + i }));
    }
    const picked = preselect(base(items));
    const count = generateCombinations({ ...base(items), included: picked }).count;
    expect(count).toBeLessThanOrEqual(PRESELECT_MAX_COMBINATIONS);
    expect(picked.length).toBeGreaterThan(0);
  });

  test("takes Great Vault first, then the biggest ilvl gain", () => {
    // Budget of 2 Combinations: only one extra candidate fits.
    const head = item("head", { source: "equipped", ilvl: 600 });
    const big = item("head", { ilvl: 660 });
    const vault = item("head", { source: "great_vault", ilvl: 620 });
    expect(preselect(base([head, big, vault]), 2)).toEqual([vault.index]);
    const noVault = preselect(base([head, big, item("head", { ilvl: 610 })]), 2);
    expect(noVault).toEqual([big.index]);
  });

  test("skips a candidate no Combination could use, and keeps going", () => {
    const main = item("main_hand", { source: "equipped", ilvl: 600, hand: "2h" });
    const hammer = item("main_hand", { ilvl: 700, hand: "1h" });
    const neck = item("neck", { source: "equipped", ilvl: 600 });
    const chain = item("neck", { ilvl: 610 });
    expect(preselect(base([main, hammer, neck, chain]))).toEqual([chain.index]);
  });

  test("a slot with nothing worn counts the whole item level as gain", () => {
    const off = item("off_hand", { ilvl: 500, hand: "held" });
    const main = item("main_hand", { source: "equipped", ilvl: 600, hand: "1h" });
    expect(preselect(base([main, off]))).toEqual([off.index]);
  });
});
