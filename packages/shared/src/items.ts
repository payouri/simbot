import { z } from "zod";

/**
 * What the Import view knows about every item in an Import: SimC's numbers for it (from the
 * packed pass) joined with the static fields of the Current SimC Build's item-meta.
 */

/** Where an item came from in the Addon String. */
export const itemSourceSchema = z.enum(["equipped", "bags", "great_vault", "linked"]);
export type ItemSource = z.infer<typeof itemSourceSchema>;

/**
 * - `ok`: SimC read the item and reported its numbers.
 * - `unknown`: an **Unknown Item**: its item id or one of its bonus ids is not in the Current
 *   SimC Build. It was left out of the packed pass, so it has no numbers.
 * - `unresolved`: the item is known, but SimC did not report it (e.g. the class cannot use it,
 *   or the pass could not place it). It has no numbers rather than wrong ones.
 */
export const itemStatusSchema = z.enum(["ok", "unknown", "unresolved"]);
export type ItemStatus = z.infer<typeof itemStatusSchema>;

/** Stat name as SimC's json2 reports it (`stamina`, `crit_rating`, `strint`, ...) -> value. */
export const itemStatsSchema = z.record(z.string(), z.number());
export type ItemStats = z.infer<typeof itemStatsSchema>;

export const unknownItemSchema = z.object({
  /** Position in the Import's item list (equipped first, then Candidate Items). */
  index: z.number().int(),
  slot: z.string(),
  source: itemSourceSchema,
  rawLine: z.string(),
  itemId: z.number().int().nullable(),
  /** The item id itself is not in the Current SimC Build. */
  unknownItemId: z.boolean(),
  unknownBonusIds: z.array(z.number().int()),
});
export type UnknownItem = z.infer<typeof unknownItemSchema>;

/** Everything the Current SimC Build did not recognise in an Import. */
export const unknownReportSchema = z.object({
  /** Unknown `#` comment fields in the Addon String (build independent). */
  unknownFields: z.array(z.string()),
  items: z.array(unknownItemSchema),
  itemIds: z.array(z.number().int()),
  bonusIds: z.array(z.number().int()),
});
export type UnknownReport = z.infer<typeof unknownReportSchema>;

export const itemPassSchema = z.object({
  /** `skipped`: no pass could run (no SimC Build or item data). `failed`: SimC rejected it. */
  status: z.enum(["ok", "skipped", "failed"]),
  reason: z.string().nullable(),
  /** Wall time of the SimC run, milliseconds. */
  ms: z.number().nullable(),
  actors: z.number().int(),
});
export type ItemPass = z.infer<typeof itemPassSchema>;

/** The dynamic half of an item: what is stored on the Import as its item index. */
export const indexedItemSchema = z.object({
  index: z.number().int(),
  slot: z.string(),
  source: itemSourceSchema,
  rawLine: z.string(),
  itemId: z.number().int().nullable(),
  bonusIds: z.array(z.number().int()),
  status: itemStatusSchema,
  ilvl: z.number().int().nullable(),
  stats: itemStatsSchema.nullable(),
});
export type IndexedItem = z.infer<typeof indexedItemSchema>;

/** The item index stored on an Import, valid for the SimC Build it names. */
export const itemIndexSchema = z.object({
  simcTag: z.string().nullable(),
  pass: itemPassSchema,
  items: z.array(indexedItemSchema),
  unknown: unknownReportSchema,
});
export type ItemIndex = z.infer<typeof itemIndexSchema>;

export const importItemSchema = indexedItemSchema.extend({
  name: z.string().nullable(),
  /** 0 poor .. 7 heirloom, after any bonus override; null for an Unknown Item. */
  quality: z.number().int().nullable(),
  /** Icon name for `GET /api/icons/:name`; null when the item has none. */
  icon: z.string().nullable(),
  /** A Candidate Item can be picked for Top Gear only when SimC read it. Equipped items: false. */
  selectable: z.boolean(),
});
export type ImportItem = z.infer<typeof importItemSchema>;

/** `GET /api/imports/:id/items`. */
export const importItemsResponseSchema = z.object({
  importId: z.number().int(),
  simcTag: z.string().nullable(),
  pass: itemPassSchema,
  items: z.array(importItemSchema),
  unknown: unknownReportSchema,
});
export type ImportItemsResponse = z.infer<typeof importItemsResponseSchema>;
