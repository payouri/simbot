import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { ImportItem, ImportItemsResponse, Sim, TopGearSelection } from "@simbot/shared";
import type { ItemMeta } from "@simbot/simc";
import { createCombinationService } from "./combinations";
import { migrate } from "./db";

/** A readable item line; `gem` sockets that gem id. */
const item = (
  index: number,
  slot: string,
  source: ImportItem["source"],
  itemId: number,
  gem?: number,
): ImportItem => ({
  index,
  slot,
  source,
  rawLine: `${slot}=,id=${itemId}${gem ? `,gem_id=${gem}` : ""}`,
  itemId,
  bonusIds: [],
  status: "ok",
  ilvl: 700,
  stats: null,
  name: `item ${itemId}`,
  quality: 4,
  icon: null,
  selectable: source !== "equipped",
});

const DIAMOND = 240983; // Indecipherable Eversong Diamond: limit category 698, one at a time
const CITRINE = 228634; // Thunderlord's Crackling Citrine: unique-equipped

const meta: ItemMeta = {
  schemaVersion: 1,
  tag: "t",
  gitRevision: "r",
  gameDataVersion: "g",
  items: {
    7: {
      name: "tier head",
      quality: 4,
      inventoryType: 1,
      itemClass: 4,
      itemSubclass: 4,
      setId: 10,
    },
  },
  bonuses: {},
  limitCategories: { 698: { name: "Thalassian Diamond", quantity: 1, flags: 1 } },
  gems: { [DIAMOND]: { limitCategory: 698 }, [CITRINE]: { uniqueEquipped: true } },
};

function service(items: ImportItem[]) {
  const db = new Database(":memory:");
  migrate(db);
  const view: ImportItemsResponse = {
    importId: 1,
    simcTag: "t",
    pass: { status: "ok", reason: null, ms: 1, actors: 1 },
    items,
    unknown: { unknownFields: [], items: [], itemIds: [], bonusIds: [] },
  };
  return createCombinationService({
    db,
    items: { view: async () => view, meta: async () => meta },
    currentBuild: async () => null,
  });
}

const sim = (included: number[], extra: Partial<TopGearSelection> = {}) =>
  ({
    id: 1,
    importId: 1,
    character: { class: "deathknight", spec: "frost" },
    settings: { durationSeconds: 300, precision: "standard" },
    topGearSelection: { included, lockedSlots: [], talentLoadouts: [], ...extra },
  }) as unknown as Sim;

describe("gem limits from item-meta", () => {
  test("a second gem of a one-at-a-time limit category is pruned", async () => {
    const svc = service([
      item(0, "head", "equipped", 1, DIAMOND),
      item(1, "finger1", "equipped", 2),
      item(2, "finger2", "equipped", 3),
      item(3, "finger1", "bags", 4, DIAMOND),
    ]);
    const p = await svc.preview(sim([3]));
    // {1,2} worn; {1,4} and {2,4} would wear two Thalassian Diamonds.
    expect(p?.count).toBe(1);
    expect(p?.issues.map((i) => i.candidate)).toEqual([3]);
  });

  test("a unique-equipped gem is worn at most once", async () => {
    const svc = service([
      item(0, "head", "equipped", 1, CITRINE),
      item(1, "neck", "equipped", 2),
      item(2, "neck", "bags", 5, CITRINE),
      item(3, "neck", "bags", 6),
    ]);
    // The citrine neck would pair with the citrine head: only the plain neck stays.
    expect((await svc.preview(sim([2, 3])))?.count).toBe(2);
  });
});

test("the selection's tier minimum reaches the walk", async () => {
  const svc = service([item(0, "head", "equipped", 7), item(1, "head", "bags", 8)]);
  expect((await svc.preview(sim([1])))?.count).toBe(2);
  // The bag head drops the only tier piece.
  expect((await svc.preview(sim([1], { minTierPieces: 1 })))?.count).toBe(1);
});
