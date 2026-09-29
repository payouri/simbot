import { z } from "zod";

/**
 * `meta/<tag>/item-meta.json`: static item fields for one SimC Build, built from SimC's
 * generated data at the build's `git_revision` plus two DB2 tables (see `buildItemMeta`).
 * Keys are ids as decimal strings, as JSON requires.
 */

/** Weapon handedness derived from the inventory type; absent for non-weapons. */
export const handTypeSchema = z.enum(["1h", "2h", "main", "off", "shield", "held", "ranged"]);
export type HandType = z.infer<typeof handTypeSchema>;

export const metaItemSchema = z.object({
  name: z.string(),
  /** Base quality (0 poor .. 7 heirloom). A bonus of type 3 can override it. */
  quality: z.number().int(),
  inventoryType: z.number().int(),
  itemClass: z.number().int(),
  itemSubclass: z.number().int(),
  hand: handTypeSchema.optional(),
  /** Item set id; absent when the item is in no set. */
  setId: z.number().int().optional(),
  uniqueEquipped: z.boolean().optional(),
  /** The item has an on-use effect of its own. Bonuses can add one (see `metaBonusSchema`). */
  onUse: z.boolean().optional(),
  /** Base ItemLimitCategory id (DB2 `ItemSparse.LimitCategory`); absent when there is none. */
  limitCategory: z.number().int().optional(),
});
export type MetaItem = z.infer<typeof metaItemSchema>;

/** What one bonus id changes. `{}` means SimC knows the id but it changes none of these. */
export const metaBonusSchema = z.object({
  /** Quality override (bonus type 3). */
  quality: z.number().int().optional(),
  /** Appearance modifier (type 7). Across all of an item's bonuses the lowest priority wins. */
  appearanceMod: z.number().int().optional(),
  appearancePriority: z.number().int().optional(),
  /** Grants this ItemLimitCategory (type 35), e.g. 512 "Embellished". */
  limitCategory: z.number().int().optional(),
  /** Adds an on-use item effect (type 23). */
  onUse: z.boolean().optional(),
});
export type MetaBonus = z.infer<typeof metaBonusSchema>;

export const limitCategorySchema = z.object({
  name: z.string(),
  /** How many items of the category may be equipped at once. */
  quantity: z.number().int(),
  flags: z.number().int(),
});
export type LimitCategory = z.infer<typeof limitCategorySchema>;

export const itemMetaSchema = z.object({
  schemaVersion: z.literal(1),
  tag: z.string().min(1),
  gitRevision: z.string().min(1),
  gameDataVersion: z.string().min(1),
  /** Equippable armour and weapons known to this SimC Build, by item id. */
  items: z.record(z.string(), metaItemSchema),
  /** Every bonus id this SimC Build knows, by bonus id. An id missing here is unknown to SimC. */
  bonuses: z.record(z.string(), metaBonusSchema),
  limitCategories: z.record(z.string(), limitCategorySchema),
});
export type ItemMeta = z.infer<typeof itemMetaSchema>;

/**
 * `meta/<tag>/item-icons.json`: icon names for equippable armour and weapons, by item id.
 * An icon name is the lower-cased `Interface\Icons` file name without `.blp`, spaces as `_`.
 */
export const itemIconsSchema = z.object({
  schemaVersion: z.literal(1),
  tag: z.string().min(1),
  gameDataVersion: z.string().min(1),
  /** The icon every appearance of the item shares, or its default one. */
  items: z.record(z.string(), z.string()),
  /**
   * Only for items whose icon differs per appearance modifier (tier and raid pieces):
   * item id -> ItemAppearanceModifierID -> icon name. Overrides `items` when present.
   */
  appearanceMods: z.record(z.string(), z.record(z.string(), z.string())),
});
export type ItemIcons = z.infer<typeof itemIconsSchema>;
