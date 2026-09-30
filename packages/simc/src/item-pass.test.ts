import { describe, expect, test } from "bun:test";
import {
  assembleIndex,
  classifyItems,
  initErrorActor,
  parseItemLine,
  planItemPass,
  profileLines,
  type RawItem,
  readItemPass,
  renderItemPass,
} from "./item-pass";
import type { ItemMeta } from "./meta";

const item = (hand?: string) => ({
  name: "x",
  quality: 4,
  inventoryType: 1,
  itemClass: 4,
  itemSubclass: 4,
  ...(hand ? { hand: hand as never } : {}),
});
const meta = {
  items: {
    "1": item(),
    "2": item(),
    "3": item(),
    "10": item("1h"),
    "11": item("2h"),
    "12": item("shield"),
    "13": item("main"),
  },
  bonuses: { "100": {}, "101": {} },
} as unknown as Pick<ItemMeta, "items" | "bonuses">;

const PROFILE = 'mage="Ann"\nlevel=90\nrace=human\nspec=frost\n';
const eq = (slot: string, id: number, extra = "") =>
  ({ slot, source: "equipped", rawLine: `${slot}=x,id=${id}${extra}` }) satisfies RawItem;
const bag = (slot: string, id: number, extra = "") =>
  ({ slot, source: "bags", rawLine: `${slot}=,id=${id}${extra}` }) satisfies RawItem;

function plan(items: RawItem[], profile = PROFILE) {
  const { items: classified } = classifyItems(items, meta);
  const p = planItemPass(profile, classified, meta);
  return { classified, p, text: p.skipped === undefined ? renderItemPass(p, classified) : "" };
}

describe("parseItemLine", () => {
  test("reads slot, id and bonus ids, whatever the name", () => {
    expect(parseItemLine("shoulders=a_b,id=5,bonus_id=1/2/3,gem_id=9")).toEqual({
      slot: "shoulders",
      itemId: 5,
      bonusIds: [1, 2, 3],
      attrs: [
        ["id", "5"],
        ["bonus_id", "1/2/3"],
        ["gem_id", "9"],
      ],
    });
    expect(parseItemLine("finger=,id=7").slot).toBe("finger1");
    expect(parseItemLine("shoulder=,id=7").slot).toBe("shoulders");
    expect(parseItemLine("head=,bonus_id=1").itemId).toBeNull();
  });
});

describe("classifyItems", () => {
  test("an unknown item id or any unknown bonus id makes an Unknown Item", () => {
    const { items, unknown } = classifyItems(
      [
        bag("head", 1, ",bonus_id=100/101"),
        bag("head", 999),
        bag("neck", 2, ",bonus_id=100/555/556"),
        { slot: "chest", source: "bags", rawLine: "chest=,bonus_id=100" },
      ],
      meta,
    );
    expect(items.map((i) => i.known)).toEqual([true, false, false, false]);
    expect(unknown.itemIds).toEqual([999]);
    expect(unknown.bonusIds).toEqual([555, 556]);
    expect(unknown.items.map((u) => [u.index, u.unknownItemId, u.unknownBonusIds])).toEqual([
      [1, true, []],
      [2, false, [555, 556]],
      [3, true, []],
    ]);
  });
});

describe("planItemPass", () => {
  test("one candidate per slot per actor: actors = the most candidates in one slot", () => {
    const { p, text } = plan([
      eq("main_hand", 10),
      eq("head", 1),
      bag("head", 1),
      bag("head", 2),
      bag("head", 3),
      bag("neck", 1),
    ]);
    if (p.skipped !== undefined) throw new Error(p.skipped);
    expect(p.actors.map((a) => a.placements.map((x) => x.slot))).toEqual([
      ["head", "neck"],
      ["head"],
      ["head"],
    ]);
    expect(text).toContain('mage="base"');
    expect(text).toContain("copy=c2,base");
    expect(text.trimEnd().split("\n").slice(-3)).toEqual([
      "iterations=1",
      "item_db_source=local",
      "max_time=10",
    ]);
  });

  test("gems and enchants are never sent, and the addon's item names are dropped", () => {
    const { text } = plan([
      eq("main_hand", 10),
      eq("head", 1, ",bonus_id=100,gem_id=99999,enchant_id=5,crafted_stats=32/36"),
    ]);
    expect(text).toContain("head=,id=1,bonus_id=100,crafted_stats=32/36");
    expect(text).not.toMatch(/gem_id|enchant|=x,/);
  });

  test("unknown items are left out; an unknown equipped one does not stop the pass", () => {
    const { text } = plan([
      eq("main_hand", 10),
      eq("head", 999),
      eq("neck", 1, ",bonus_id=555"),
      bag("chest", 2, ",bonus_id=555"),
      bag("chest", 3),
    ]);
    expect(text).not.toMatch(/id=999|555/);
    expect(text).toContain("chest=,id=3");
  });

  test("a 2h candidate clears the off-hand; an off-hand rides with a one-handed companion", () => {
    const { p, text } = plan([eq("main_hand", 11), bag("main_hand", 11), bag("off_hand", 12)]);
    if (p.skipped !== undefined) throw new Error(p.skipped);
    const two = p.actors.find((a) => a.placements.some((x) => x.slot === "main_hand"));
    expect(two?.setup).toEqual(["off_hand="]);
    // No one-hander among the equipped, so the shield has no companion to be worn with.
    expect(text).not.toContain("off_hand=,id=12");

    const withCompanion = plan([eq("main_hand", 11), bag("main_hand", 10), bag("off_hand", 12)]);
    const o = withCompanion.p;
    if (o.skipped !== undefined) throw new Error(o.skipped);
    expect(o.actors.at(-1)).toMatchObject({
      name: "o0",
      setup: ["main_hand=,id=10"],
      placements: [{ slot: "off_hand" }],
    });
  });

  test("an unknown equipped weapon borrows a Candidate weapon, or skips the pass", () => {
    const borrowed = plan([eq("main_hand", 999), bag("main_hand", 13)]);
    expect(borrowed.text).toMatch(/^main_hand=,id=13$/m);
    const none = plan([eq("main_hand", 999), bag("head", 1)]);
    expect(none.p.skipped).toContain("main hand");
  });
});

describe("readItemPass", () => {
  const json2 = (players: unknown) => JSON.stringify({ sim: { players } });
  const gear = (id: number, ilevel: number, extra = {}) => ({
    encoded_item: `x,id=${id},bonus_id=1`,
    ilevel,
    stamina: 10,
    ...extra,
  });

  test("reads by actor and slot; a slot holding another item, or nothing, has no numbers", () => {
    const { classified, p } = plan([
      eq("main_hand", 10),
      eq("head", 1),
      bag("head", 2),
      bag("neck", 3),
      bag("chest", 1),
    ]);
    if (p.skipped !== undefined) throw new Error(p.skipped);
    const numbers = readItemPass(
      p,
      classified,
      json2([
        {
          name: "base",
          gear: { main_hand: gear(10, 300), head: gear(1, 290, { crit_rating: 5 }) },
        },
        // c0 holds head 2, neck 3 and chest 1; SimC reported the wrong head and no neck.
        { name: "c0", gear: { head: gear(1, 100), chest: gear(1, 295) } },
      ]),
    );
    expect(numbers.get(1)).toEqual({ ilvl: 290, stats: { stamina: 10, crit_rating: 5 } });
    expect(numbers.get(0)?.ilvl).toBe(300);
    expect(numbers.has(2)).toBe(false);
    expect(numbers.has(3)).toBe(false);
    expect(numbers.get(4)?.ilvl).toBe(295);
    const index = assembleIndex(classified, numbers);
    expect(index.map((i) => i.status)).toEqual(["ok", "ok", "unresolved", "unresolved", "ok"]);
  });

  test("a report that is not json2 throws", () => {
    const { classified, p } = plan([eq("main_hand", 10)]);
    if (p.skipped !== undefined) throw new Error(p.skipped);
    expect(() => readItemPass(p, classified, "not json")).toThrow("not valid JSON");
    expect(() => readItemPass(p, classified, json2([]))).toThrow("no base actor");
    expect(() => readItemPass(p, classified, "{}")).toThrow("output format changed");
  });
});

describe("initErrorActor", () => {
  test("names the player SimC blames", () => {
    expect(
      initErrorActor("Error: Initialization error: Player 'c4': Player c4 has an Off-Hand weapon"),
    ).toBe("c4");
    expect(initErrorActor("Trivial: Player 'c4' attempting to use Action")).toBeNull();
    expect(initErrorActor("Error: cannot open input file")).toBeNull();
  });
});

describe("profileLines", () => {
  test("drops file-writing options from an untrusted Addon String", () => {
    const text = [
      'mage="A"',
      "level=80",
      "html=/data/db.sqlite",
      "save=/home/u/.bashrc",
      "json+=/x",
      "level=80 xml=/y",
      "input=/etc/passwd",
    ].join("\n");
    expect(profileLines(text)).toEqual(['mage="base"', "level=80"]);
  });

  test("drops a ptr line of a PTR-client export: the Item Index is read on Live data", () => {
    expect(profileLines('mage="A"\nptr=1\nlevel=80')).toEqual(['mage="base"', "level=80"]);
  });
});
