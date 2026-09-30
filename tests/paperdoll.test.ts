import { describe, expect, test } from "bun:test";
import {
  candidatesInPlay,
  groupBySlot,
  includedCount,
  loadoutName,
  setCandidates,
  slotsInPlay,
  toggleItem,
  toggleLoadout,
  toggleLock,
} from "../apps/client/src/setup/model";
import {
  defaultTopGearSelection,
  type ImportItem,
  normalizeSelection,
  paperdollSlotOf,
  topGearSelectionSchema,
} from "../packages/shared/src";

let next = 0;
const item = (over: Partial<ImportItem>): ImportItem => ({
  index: next++,
  slot: "head",
  source: "bags",
  rawLine: "",
  itemId: 1,
  bonusIds: [],
  status: "ok",
  ilvl: 600,
  stats: {},
  name: "Thing",
  quality: 4,
  icon: null,
  selectable: over.source !== "equipped" && (over.status ?? "ok") === "ok",
  ...over,
});

describe("Paperdoll slots", () => {
  test("SimC slot names collapse into the sheet's tiles", () => {
    expect(paperdollSlotOf("finger1")).toBe("finger");
    expect(paperdollSlotOf("finger2")).toBe("finger");
    expect(paperdollSlotOf("trinket2")).toBe("trinket");
    expect(paperdollSlotOf("off_hand")).toBe("main_hand");
    expect(paperdollSlotOf("two_hand")).toBe("main_hand");
    expect(paperdollSlotOf("shoulder")).toBe("shoulders");
    expect(paperdollSlotOf("tabard")).toBeNull();
  });
});

describe("Top Gear Selection", () => {
  test("normalises to a stable order without duplicates", () => {
    const n = normalizeSelection({
      included: [5, 1, 5, 3],
      talentLoadouts: [2, 0, 2],
      lockedSlots: ["trinket", "head", "trinket"],
    });
    expect(n).toEqual({
      included: [1, 3, 5],
      talentLoadouts: [0, 2],
      lockedSlots: ["head", "trinket"],
    });
    expect(topGearSelectionSchema.safeParse(n).success).toBe(true);
  });

  test("the default has nothing included and the equipped loadout selected", () => {
    expect(defaultTopGearSelection(2)).toEqual({
      included: [],
      talentLoadouts: [2],
      lockedSlots: [],
    });
    expect(defaultTopGearSelection(null).talentLoadouts).toEqual([]);
  });

  test("rejects a slot the sheet does not have", () => {
    expect(
      topGearSelectionSchema.safeParse({ included: [], talentLoadouts: [], lockedSlots: ["x"] })
        .success,
    ).toBe(false);
  });
});

describe("setup model", () => {
  const worn = item({ slot: "finger1", source: "equipped", ilvl: 620 });
  const worn2 = item({ slot: "finger2", source: "equipped", ilvl: 610 });
  const ring = item({ slot: "finger1", ilvl: 630 });
  const vaultRing = item({ slot: "finger1", source: "great_vault", ilvl: 640 });
  const unknownRing = item({ slot: "finger1", status: "unknown", ilvl: null, selectable: false });
  const unusableHead = item({ slot: "head", status: "unresolved", ilvl: null, selectable: false });
  const weapon = item({ slot: "off_hand", ilvl: 615 });
  const groups = groupBySlot([worn2, worn, ring, unknownRing, vaultRing, unusableHead, weapon]);

  test("groups equipped, candidates, Unknown Item placeholders and unusable items per tile", () => {
    expect(groups.finger.equipped.map((i) => i.index)).toEqual([worn.index, worn2.index]);
    expect(groups.finger.candidates.map((i) => i.index)).toEqual([vaultRing.index, ring.index]);
    expect(groups.finger.placeholders).toEqual([unknownRing]);
    expect(groups.head.unusable).toEqual([unusableHead]);
    expect(groups.head.candidates).toEqual([]);
    expect(groups.main_hand.candidates).toEqual([weapon]);
  });

  test("an Unknown Item is never among the candidates that can be included", () => {
    expect(Object.values(groups).flatMap((g) => g.candidates)).not.toContain(unknownRing);
  });

  test("toggling and bulk include update the count", () => {
    let sel = defaultTopGearSelection(0);
    sel = toggleItem(sel, ring.index);
    expect(includedCount(sel.included, groups.finger.candidates)).toBe(1);
    sel = setCandidates(sel, groups.finger.candidates, true);
    expect(includedCount(sel.included, groups.finger.candidates)).toBe(2);
    sel = toggleItem(sel, ring.index);
    expect(sel.included).toEqual([vaultRing.index]);
    sel = setCandidates(sel, groups.finger.candidates, false);
    expect(sel.included).toEqual([]);
  });

  test("a locked slot's candidates are not in play", () => {
    let sel = setCandidates(defaultTopGearSelection(0), groups.finger.candidates, true);
    expect(candidatesInPlay(sel, groups)).toBe(2);
    expect(slotsInPlay(sel, groups)).toBe(1);
    sel = toggleLock(sel, "finger");
    expect(sel.lockedSlots).toEqual(["finger"]);
    expect(candidatesInPlay(sel, groups)).toBe(0);
    expect(toggleLock(sel, "finger").lockedSlots).toEqual([]);
  });

  test("the last Talent Loadout cannot be switched off", () => {
    let sel = defaultTopGearSelection(1);
    expect(toggleLoadout(sel, 1)).toBe(sel);
    sel = toggleLoadout(sel, 0);
    expect(sel.talentLoadouts).toEqual([1, 0]);
    expect(toggleLoadout(sel, 1).talentLoadouts).toEqual([0]);
  });

  test("names loadouts by comment, else by whether they are on now", () => {
    expect(loadoutName({ comment: " Raid ", equipped: true }, 0)).toBe("Raid");
    expect(loadoutName({ comment: null, equipped: true }, 0)).toBe("Equipped talents");
    expect(loadoutName({ comment: null, equipped: false }, 2)).toBe("Loadout 3");
  });
});
