import { readCsvColumns } from "./csv";
import { type IncBonus, parseItemBonuses, parseItemData, parseItemEffects } from "./inc";
import type { HandType, ItemMeta, LimitCategory, MetaBonus, MetaGem, MetaItem } from "./schema";

/**
 * Item classes that go into item-meta and item-icons: weapons and armour, which is everything
 * a Character can wear. Consumables and the rest are left out on purpose, so the files
 * stay small and "known item" means "known equippable item". Widen this to add more.
 */
export const EQUIPPABLE_ITEM_CLASSES: ReadonlySet<number> = new Set([2, 4]);

/** An item is equippable when it is in one of those classes and has an inventory slot. */
export const isEquippable = (itemClass: number, inventoryType: number) =>
  EQUIPPABLE_ITEM_CLASSES.has(itemClass) && inventoryType !== 0;

const ITEM_CLASS_GEM = 3;
const UNIQUE_EQUIPPED = 0x00080000; // ITEM_FLAG_UNIQUE_EQUIPPED
const EFFECT_ON_USE = 0; // ITEM_SPELLTRIGGER_ON_USE
const EFFECT_ON_NO_DELAY_USE = 5; // ITEM_SPELLTRIGGER_ON_NO_DELAY_USE
const isOnUseEffect = (type: number) => type === EFFECT_ON_USE || type === EFFECT_ON_NO_DELAY_USE;

const BONUS_QUALITY = 3;
const BONUS_APPEARANCE = 7;
const BONUS_ADD_ITEM_EFFECT = 23;
const BONUS_LIMIT_CATEGORY = 35;

/** Inventory type -> hand type. 13 is a one-hander usable in either hand. */
const HAND_BY_INVENTORY_TYPE: Readonly<Record<number, HandType>> = {
  13: "1h",
  17: "2h",
  21: "main",
  22: "off",
  14: "shield",
  23: "held",
  15: "ranged",
  26: "ranged",
};

/** Hand type of an item; only weapons, shields and off-hand holdables have one. */
export function handTypeOf(itemClass: number, inventoryType: number): HandType | undefined {
  if (!EQUIPPABLE_ITEM_CLASSES.has(itemClass)) return undefined;
  return HAND_BY_INVENTORY_TYPE[inventoryType];
}

export type ItemMetaSources = {
  /** `item_data.inc`, `item_effect.inc` and `item_bonus.inc` at the build's git_revision. */
  itemDataInc: string;
  itemEffectInc: string;
  itemBonusInc: string;
  /** DB2 `ItemSparse` (needs `ID`, `LimitCategory`) and `ItemLimitCategory` at its game build. */
  itemSparseCsv: string;
  itemLimitCategoryCsv: string;
  /** DB2 `ItemLimitCategoryCondition` (`AddQuantity`, `PlayerConditionID`, `ParentItemLimitCategoryID`). */
  itemLimitCategoryConditionCsv: string;
};

export type BuildIdentity = { tag: string; gitRevision: string; gameDataVersion: string };

/** Bonus rows for one id in `index` order, the order SimC applies them in. */
function groupBonuses(rows: IncBonus[]): Map<number, IncBonus[]> {
  const byId = new Map<number, IncBonus[]>();
  for (const row of rows) {
    const list = byId.get(row.bonusId);
    if (list) list.push(row);
    else byId.set(row.bonusId, [row]);
  }
  for (const list of byId.values()) list.sort((a, b) => a.index - b.index);
  return byId;
}

export function buildItemMeta(build: BuildIdentity, src: ItemMetaSources): ItemMeta {
  const effects = parseItemEffects(src.itemEffectInc);
  const onUseItems = new Set<number>();
  const onUseEffectIds = new Set<number>();
  for (const e of effects) {
    if (!isOnUseEffect(e.type)) continue;
    onUseItems.add(e.itemId);
    onUseEffectIds.add(e.id);
  }

  const bonuses: Record<string, MetaBonus> = {};
  for (const [bonusId, rows] of groupBonuses(parseItemBonuses(src.itemBonusInc))) {
    const bonus: MetaBonus = {};
    for (const row of rows) {
      if (row.type === BONUS_QUALITY && bonus.quality === undefined) {
        bonus.quality = row.value1;
      } else if (row.type === BONUS_APPEARANCE) {
        // value_1 is the ItemAppearanceModifierID, value_2 its priority; lowest priority wins.
        if (bonus.appearancePriority === undefined || row.value2 < bonus.appearancePriority) {
          bonus.appearanceMod = row.value1;
          bonus.appearancePriority = row.value2;
        }
      } else if (row.type === BONUS_LIMIT_CATEGORY && bonus.limitCategory === undefined) {
        bonus.limitCategory = row.value1;
      } else if (row.type === BONUS_ADD_ITEM_EFFECT && onUseEffectIds.has(row.value1)) {
        bonus.onUse = true;
      }
    }
    bonuses[bonusId] = bonus;
  }

  const baseLimit = new Map<number, number>();
  for (const [id, limit] of readCsvColumns(src.itemSparseCsv, ["ID", "LimitCategory"])) {
    if (Number(limit) > 0) baseLimit.set(Number(id), Number(limit));
  }

  const items: Record<string, MetaItem> = {};
  const gems: Record<string, MetaGem> = {};
  for (const it of parseItemData(src.itemDataInc)) {
    if (it.itemClass === ITEM_CLASS_GEM) {
      const gem: MetaGem = {};
      if ((it.flags1 & UNIQUE_EQUIPPED) !== 0) gem.uniqueEquipped = true;
      const limit = baseLimit.get(it.id);
      if (limit !== undefined) gem.limitCategory = limit;
      if (Object.keys(gem).length > 0) gems[it.id] = gem;
      continue;
    }
    if (!isEquippable(it.itemClass, it.inventoryType)) continue;
    const item: MetaItem = {
      name: it.name,
      quality: it.quality,
      inventoryType: it.inventoryType,
      itemClass: it.itemClass,
      itemSubclass: it.itemSubclass,
    };
    const hand = handTypeOf(it.itemClass, it.inventoryType);
    if (hand) item.hand = hand;
    if (it.setId > 0) item.setId = it.setId;
    if ((it.flags1 & UNIQUE_EQUIPPED) !== 0) item.uniqueEquipped = true;
    if (onUseItems.has(it.id)) item.onUse = true;
    const limit = baseLimit.get(it.id);
    if (limit !== undefined) item.limitCategory = limit;
    items[it.id] = item;
  }

  const limitCategories: ItemMeta["limitCategories"] = {};
  const limitRows = readCsvColumns(src.itemLimitCategoryCsv, [
    "ID",
    "Name_lang",
    "Quantity",
    "Flags",
  ]);
  for (const [id, name, quantity, flags] of limitRows) {
    limitCategories[id as string] = {
      name: name as string,
      quantity: Number(quantity),
      flags: Number(flags),
    };
  }
  const conditionRows = readCsvColumns(src.itemLimitCategoryConditionCsv, [
    "AddQuantity",
    "PlayerConditionID",
    "ParentItemLimitCategoryID",
  ]);
  for (const [addQuantity, playerConditionId, parent] of conditionRows) {
    const category = limitCategories[parent as string];
    if (!category) continue; // a condition on a category that does not exist limits nothing
    category.conditions ??= [];
    category.conditions.push({
      addQuantity: Number(addQuantity),
      playerConditionId: Number(playerConditionId),
    });
  }

  return {
    schemaVersion: 1,
    tag: build.tag,
    gitRevision: build.gitRevision,
    gameDataVersion: build.gameDataVersion,
    items,
    bonuses,
    limitCategories,
    gems,
  };
}

/**
 * How many items of a category can be equipped at once in the best case: its quantity plus
 * whatever each condition adds. Whether the player meets a condition is unknown here, so pruning
 * with this never drops a Combination the game allows.
 */
export const maxQuantityOf = (category: LimitCategory): number =>
  category.quantity + (category.conditions ?? []).reduce((sum, c) => sum + c.addQuantity, 0);

/**
 * The appearance modifier a set of bonus ids selects: across all of them, the type 7 entry
 * with the lowest priority. Undefined when no bonus picks one (the item's default appearance).
 */
export function appearanceModFor(meta: ItemMeta, bonusIds: readonly number[]): number | undefined {
  let best: { mod: number; priority: number } | undefined;
  for (const id of bonusIds) {
    const b = meta.bonuses[id];
    if (b?.appearanceMod === undefined || b.appearancePriority === undefined) continue;
    if (!best || b.appearancePriority < best.priority) {
      best = { mod: b.appearanceMod, priority: b.appearancePriority };
    }
  }
  return best?.mod;
}
