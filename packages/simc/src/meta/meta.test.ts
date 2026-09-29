import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildItemIcons, IconCoverageError, iconFor, iconNameOf } from "./build-icons";
import { appearanceModFor, buildItemMeta } from "./build-meta";
import { readCsvColumns } from "./csv";
import { IncFormatError, parseItemBonuses, parseItemData, parseItemEffects } from "./inc";
import { itemIconsSchema, itemMetaSchema } from "./schema";
import { compareWithJson2, sampleItemIds, sampleProfile, tokenizeName } from "./verify";

/**
 * Fixtures are excerpts of real rows: the three `.inc` files from SimC `d08a1c3` (`midnight`)
 * and DB2 CSVs from wago.tools at game build 12.1.0.69933 (CSV columns trimmed to those read).
 */
const fx = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

const build = {
  tag: "1210-2026-09-29-d08a1c3",
  gitRevision: "d08a1c3",
  gameDataVersion: "12.1.0.69933",
};
const metaSources = {
  itemDataInc: fx("item_data.inc"),
  itemEffectInc: fx("item_effect.inc"),
  itemBonusInc: fx("item_bonus.inc"),
  itemSparseCsv: fx("ItemSparse.csv"),
  itemLimitCategoryCsv: fx("ItemLimitCategory.csv"),
};
const iconSources = {
  itemCsv: fx("Item.csv"),
  itemModifiedAppearanceCsv: fx("ItemModifiedAppearance.csv"),
  itemAppearanceCsv: fx("ItemAppearance.csv"),
  manifestInterfaceDataCsv: fx("ManifestInterfaceData.csv"),
};

describe("readCsvColumns", () => {
  test("returns the requested columns in the requested order", () => {
    expect(readCsvColumns("A,B,C\n1,2,3\n4,5,6\n", ["C", "A"])).toEqual([
      ["3", "1"],
      ["6", "4"],
    ]);
  });

  test("handles quotes, doubled quotes, embedded newlines and commas, and CRLF", () => {
    const csv = 'ID,Text,Last\r\n1,"a, ""b""\nc",x\r\n2,plain,y';
    expect(readCsvColumns(csv, ["ID", "Text", "Last"])).toEqual([
      ["1", 'a, "b"\nc', "x"],
      ["2", "plain", "y"],
    ]);
  });

  test("skips blank lines and fills short rows", () => {
    expect(readCsvColumns("A,B\n1,2\n\n3\n", ["A", "B"])).toEqual([
      ["1", "2"],
      ["3", ""],
    ]);
  });

  test("throws when a requested column is missing from the header", () => {
    expect(() => readCsvColumns("A,B\n1,2\n", ["A", "Nope"])).toThrow("Nope");
  });
});

describe("SimC .inc parsers", () => {
  test("parseItemData reads flags, class, slot and set, and unescapes names", () => {
    const items = parseItemData(metaSources.itemDataInc);
    const trinket = items.find((i) => i.id === 270175);
    expect(trinket).toMatchObject({
      name: "Voracious Heart of Ula'tek",
      quality: 4,
      inventoryType: 12,
      itemClass: 4,
      flags1: 0x80000,
    });
    expect(items.find((i) => i.id === 3024)?.name).toBe('BKP 2700 "Enforcer"');
    expect(items.find((i) => i.id === 271474)?.setId).toBe(2055);
  });

  test("parseItemEffects and parseItemBonuses read their row layouts", () => {
    expect(parseItemEffects(metaSources.itemEffectInc)).toContainEqual({
      id: 234585,
      itemId: 270175,
      type: 0,
    });
    expect(parseItemBonuses(metaSources.itemBonusInc)).toContainEqual({
      bonusId: 12854,
      type: 7,
      value1: 3,
      value2: -1,
      index: 2,
    });
  });

  test("a changed row layout is an error, not wrong data", () => {
    const short = '  { "X", 1, 0x0, 0x0, 0x00, 1 },\n';
    expect(() => parseItemData(short)).toThrow(IncFormatError);
    expect(() => parseItemData("")).toThrow(IncFormatError);
    expect(() => parseItemEffects("static const int x = 1;\n")).toThrow(IncFormatError);
    expect(() => parseItemBonuses("static x __item_bonus_data { {\n  nope\n} };\n")).toThrow(
      IncFormatError,
    );
  });
});

describe("buildItemMeta", () => {
  const meta = buildItemMeta(build, metaSources);

  test("produces a document that validates against the schema", () => {
    expect(itemMetaSchema.parse(JSON.parse(JSON.stringify(meta)))).toEqual(meta);
    expect(meta).toMatchObject(build);
  });

  test("carries name, quality, unique-equipped and on-use from SimC's tables", () => {
    expect(meta.items[270175]).toEqual({
      name: "Voracious Heart of Ula'tek",
      quality: 4,
      inventoryType: 12,
      itemClass: 4,
      itemSubclass: 0,
      uniqueEquipped: true,
      onUse: true,
    });
    // Only an on-equip effect: not on-use.
    expect(meta.items[246085]).toBeUndefined();
    expect(meta.items[268209]?.onUse).toBeUndefined();
  });

  test("carries the set id", () => {
    expect(meta.items[271474]?.setId).toBe(2055);
    expect(meta.items[270175]?.setId).toBeUndefined();
  });

  test("derives the hand type from the inventory type", () => {
    const hands = Object.fromEntries(
      [284846, 281566, 268209, 242604, 281245, 281571, 277800, 281248, 280377].map((id) => [
        id,
        meta.items[id]?.hand,
      ]),
    );
    expect(hands).toEqual({
      284846: "2h",
      281566: "1h",
      268209: "main",
      242604: "off",
      281245: "shield",
      281571: "held",
      277800: "ranged",
      281248: "ranged",
      280377: undefined, // a trinket
    });
  });

  test("joins the base limit category and the limit quantities from DB2", () => {
    expect(meta.items[236881]).toMatchObject({ name: "Void-Touched Shank", limitCategory: 680 });
    expect(meta.limitCategories[680]).toEqual({ name: "Void-Touched", quantity: 1, flags: 1 });
    expect(meta.limitCategories[512]).toEqual({ name: "Embellished", quantity: 2, flags: 1 });
  });

  test("keeps only equippable armour and weapons", () => {
    expect(meta.items[187552]).toBeDefined(); // an armour piece with an on-use effect
    expect(meta.items[265714]).toBeUndefined(); // armour class, no inventory slot
    expect(meta.items[246085]).toBeUndefined(); // gem
    expect(meta.items[280422]).toBeUndefined(); // consumable
    for (const item of Object.values(meta.items)) expect([2, 4]).toContain(item.itemClass);
  });

  test("reads what bonus ids grant", () => {
    expect(meta.bonuses[8960]).toEqual({ limitCategory: 512 });
    expect(meta.bonuses[12854]).toEqual({ quality: 4, appearanceMod: 3, appearancePriority: -1 });
    expect(meta.bonuses[12790]).toMatchObject({ appearanceMod: 1 });
    // Type 23 adds an item effect; only an on-use one counts.
    expect(meta.bonuses[6277]).toMatchObject({ onUse: true });
    expect(meta.bonuses[6272]?.onUse).toBeUndefined();
  });

  test("lists every bonus id SimC knows, even those that change nothing we track", () => {
    expect(meta.bonuses[591]).toEqual({});
    expect(meta.bonuses[13335]).toEqual({});
    expect(meta.bonuses[99999]).toBeUndefined();
  });

  test("appearanceModFor picks the lowest priority across bonus ids", () => {
    expect(appearanceModFor(meta, [12854, 13750])).toBe(3);
    expect(appearanceModFor(meta, [12790])).toBe(1);
    // 6272 has mod 150 at priority 300, 12854 has mod 3 at priority -1.
    expect(appearanceModFor(meta, [6272, 12854])).toBe(3);
    expect(appearanceModFor(meta, [8960, 99999])).toBeUndefined();
  });
});

describe("buildItemIcons", () => {
  const { icons, equippable, resolved } = buildItemIcons(build, iconSources);

  test("produces a document that validates against the schema", () => {
    expect(itemIconsSchema.parse(JSON.parse(JSON.stringify(icons)))).toEqual(icons);
  });

  test("covers at least 99% of equippable armour and weapons", () => {
    expect(equippable).toBe(141);
    expect(resolved).toBe(140);
    expect(resolved / equippable).toBeGreaterThanOrEqual(0.99);
    expect(icons.items[2716]).toBeUndefined(); // the one with no icon file yet
  });

  test("uses Item.IconFileDataID when set", () => {
    expect(icons.items[270175]).toBe("inv_121_trinket_raid_ulatek_heart");
  });

  test("falls back through ItemModifiedAppearance and ItemAppearance", () => {
    // 236772 has no icon of its own; modifier 0's appearance gives the default.
    expect(icons.items[236772]).toBe("inv_sword_2h_artifactarathor_d_01");
  });

  test("keys tier-style items by appearance modifier", () => {
    const perMod = icons.appearanceMods[236772];
    expect(perMod).toBeDefined();
    expect(new Set(Object.values(perMod ?? {})).size).toBeGreaterThan(1);
    const [mod, name] = Object.entries(perMod ?? {}).at(-1) ?? [];
    expect(iconFor(icons, 236772, Number(mod))).toBe(name);
    // No modifier, or one the item has no icon for, gives the default.
    expect(iconFor(icons, 236772)).toBe(icons.items[236772]);
    expect(iconFor(icons, 236772, 9999)).toBe(icons.items[236772]);
  });

  test("keeps items whose modifiers share one icon out of the per-modifier map", () => {
    const viaAppearance = readCsvColumns(iconSources.itemCsv, ["ID", "ClassID", "IconFileDataID"])
      .filter(([id, classId, icon]) => icon === "0" && classId !== "0" && icons.items[id as string])
      .map(([id]) => id as string);
    expect(viaAppearance.length).toBeGreaterThan(10);
    expect(viaAppearance.filter((id) => !icons.appearanceMods[id]).length).toBeGreaterThan(10);
  });

  test("leaves out items that are not equippable", () => {
    const ids = new Set(Object.keys(icons.items));
    const classes = readCsvColumns(iconSources.itemCsv, ["ID", "ClassID", "InventoryType"]);
    for (const [id, classId, inventoryType] of classes) {
      if (!["2", "4"].includes(classId as string) || inventoryType === "0") {
        expect(ids.has(id as string)).toBe(false);
      }
    }
  });

  test("names an icon after its file: lower case, spaces as underscores, only under Icons", () => {
    expect(iconNameOf("Interface\\Icons\\", "INV_Chest Samurai.blp")).toBe("inv_chest_samurai");
    expect(iconNameOf("Interface\\ICONS\\", "INV_Misc.blp")).toBe("inv_misc");
    expect(iconNameOf("Interface\\Buttons\\", "Foo.blp")).toBeNull();
    expect(iconNameOf("Interface\\Icons\\", "Foo.tga")).toBeNull();
  });

  test("fails loudly when the join stops resolving icons", () => {
    const noIcons = { ...iconSources, manifestInterfaceDataCsv: "ID,FilePath,FileName\n" };
    expect(() => buildItemIcons(build, noIcons)).toThrow(IconCoverageError);
  });
});

describe("live SimC verification helpers", () => {
  const meta = buildItemMeta(build, metaSources);

  test("tokenizeName follows SimC: lower case, spaces to underscores, punctuation dropped", () => {
    expect(tokenizeName("Voracious Heart of Ula'tek")).toBe("voracious_heart_of_ulatek");
    expect(tokenizeName("Exo-Mesh Carpalform Armplates Mk. VII")).toBe(
      "exomesh_carpalform_armplates_mk._vii",
    );
  });

  test("sampleProfile equips each sampled item alone on its own actor", () => {
    const profile = sampleProfile(meta, [270175, 284846, 265714]);
    expect(profile).toContain("copy=p0,Test\ntrinket1=,id=270175\n");
    expect(profile).toContain("copy=p1,Test\nmain_hand=,id=284846\n");
    expect(profile).not.toContain("265714"); // not in the meta
    expect(sampleItemIds(meta, 1)).toContain(270175);
    expect(sampleItemIds(meta, 1000)).toHaveLength(1);
  });

  test("compareWithJson2 flags a name that differs and ignores items it does not know", () => {
    const report = {
      sim: {
        players: [
          {
            gear: {
              trinket1: {
                name: "voracious_heart_of_ulatek",
                encoded_item: "voracious_heart_of_ulatek,id=270175",
              },
            },
          },
          {
            gear: {
              head: { name: "renamed_helm", encoded_item: "renamed_helm,id=271474,bonus_id=1" },
            },
          },
          { gear: { head: { name: "mystery", encoded_item: "mystery,id=1" } } },
        ],
      },
    };
    expect(compareWithJson2(meta, report)).toEqual({
      checked: 2,
      mismatches: [
        { id: 271474, field: "name", meta: meta.items[271474]?.name, simc: "renamed_helm" },
      ],
    });
    expect(() => compareWithJson2(meta, {})).toThrow("no sim.players");
  });
});
