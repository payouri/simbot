import { z } from "zod";

/**
 * The Paperdoll's slots. SimC names finer slots (`finger1`, `trinket2`, `off_hand`, `two_hand`);
 * the sheet groups them the way the character sheet does: one tile for rings, one for trinkets,
 * one for the weapons.
 */
export const paperdollSlotSchema = z.enum([
  "head",
  "neck",
  "shoulders",
  "back",
  "chest",
  "wrists",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger",
  "trinket",
  "main_hand",
]);
export type PaperdollSlot = z.infer<typeof paperdollSlotSchema>;

/** Six slots down the left, six down the right, main hand at the bottom centre. */
export const PAPERDOLL_LEFT: readonly PaperdollSlot[] = [
  "head",
  "neck",
  "shoulders",
  "back",
  "chest",
  "wrists",
];
export const PAPERDOLL_RIGHT: readonly PaperdollSlot[] = [
  "hands",
  "waist",
  "legs",
  "feet",
  "finger",
  "trinket",
];

export const PAPERDOLL_LABEL: Record<PaperdollSlot, string> = {
  head: "Head",
  neck: "Neck",
  shoulders: "Shoulders",
  back: "Back",
  chest: "Chest",
  wrists: "Wrists",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  finger: "Rings",
  trinket: "Trinkets",
  main_hand: "Weapons",
};

const SIMC_SLOT_GROUP: Record<string, PaperdollSlot> = {
  head: "head",
  neck: "neck",
  shoulder: "shoulders",
  shoulders: "shoulders",
  back: "back",
  chest: "chest",
  wrist: "wrists",
  wrists: "wrists",
  hands: "hands",
  waist: "waist",
  legs: "legs",
  feet: "feet",
  finger: "finger",
  finger1: "finger",
  finger2: "finger",
  trinket: "trinket",
  trinket1: "trinket",
  trinket2: "trinket",
  main_hand: "main_hand",
  off_hand: "main_hand",
  two_hand: "main_hand",
};

/** The Paperdoll slot a SimC slot name belongs to; null for a name the sheet has no tile for. */
export const paperdollSlotOf = (simcSlot: string): PaperdollSlot | null =>
  SIMC_SLOT_GROUP[simcSlot] ?? null;

/** The SimC options a consumable set is made of, in the order they are written. */
export const CONSUMABLE_KEYS = [
  "flask",
  "food",
  "potion",
  "augmentation",
  "temporary_enchant",
] as const;
export const consumableKeySchema = z.enum(CONSUMABLE_KEYS);
export type ConsumableKey = z.infer<typeof consumableKeySchema>;

/**
 * One consumable as SimC names it (`flask_of_power_3`, `main_hand:oil_3`), or `disabled` for
 * none. No spaces or line breaks, so a value can only ever write its own option line.
 */
export const consumableValueSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);

/** The user's consumable set: an option given here replaces the Addon String's for every Combination. */
export const consumableSetSchema = z.partialRecord(consumableKeySchema, consumableValueSchema);
export type ConsumableSet = z.infer<typeof consumableSetSchema>;

/**
 * What a Top Gear Sim is built from, as far as the setup can say: which Candidate Items are in
 * play (by `ImportItem.index` in the Import's item list), which Talent Loadouts (by position in
 * the Import's loadout list) and which slots stay as equipped. Combinations come from this later.
 */
export const topGearSelectionSchema = z.object({
  included: z.array(z.number().int().min(0)).max(2000),
  talentLoadouts: z.array(z.number().int().min(0)).max(100),
  lockedSlots: z.array(paperdollSlotSchema).max(paperdollSlotSchema.options.length),
  /** At least this many tier-set pieces in every Combination (0 or absent: no minimum). */
  minTierPieces: z.number().int().min(0).max(5).optional(),
  /** Catalyst charges the Combination may spend; absent: not limited. */
  catalystCharges: z.number().int().min(0).max(100).optional(),
  /** Upgrade budget (crests) the Combination may spend; absent: not limited. */
  upgradeBudget: z.number().int().min(0).max(100000).optional(),
  /** The consumable set every Combination runs with; an option left out keeps the export's. */
  consumables: consumableSetSchema.optional(),
  /** The default preselection has been applied (or declined), so it is not applied again. */
  preselected: z.boolean().optional(),
});
export type TopGearSelection = z.infer<typeof topGearSelectionSchema>;

/** Nothing extra included, the equipped Talent Loadout (when the Import has one) selected. */
export const defaultTopGearSelection = (equippedLoadout: number | null): TopGearSelection => ({
  included: [],
  talentLoadouts: equippedLoadout === null ? [] : [equippedLoadout],
  lockedSlots: [],
});

/** Sorted and deduplicated, so two equal selections serialise the same. */
export const normalizeSelection = (s: TopGearSelection): TopGearSelection => ({
  included: [...new Set(s.included)].sort((a, b) => a - b),
  talentLoadouts: [...new Set(s.talentLoadouts)].sort((a, b) => a - b),
  lockedSlots: paperdollSlotSchema.options.filter((slot) => s.lockedSlots.includes(slot)),
  ...(s.minTierPieces ? { minTierPieces: s.minTierPieces } : {}),
  ...(s.catalystCharges !== undefined ? { catalystCharges: s.catalystCharges } : {}),
  ...(s.upgradeBudget !== undefined ? { upgradeBudget: s.upgradeBudget } : {}),
  ...(consumablesOf(s.consumables) ? { consumables: consumablesOf(s.consumables) } : {}),
  ...(s.preselected ? { preselected: true } : {}),
});

/** A consumable set in key order; undefined when it overrides nothing. */
function consumablesOf(set: ConsumableSet | undefined): ConsumableSet | undefined {
  if (!set) return undefined;
  const entries = CONSUMABLE_KEYS.flatMap((k) => (set[k] ? [[k, set[k]] as const] : []));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** A Talent Loadout of an Import, as the setup lists it. */
export const importLoadoutSchema = z.object({
  comment: z.string().nullable(),
  rawLine: z.string(),
  /** The loadout the character has on right now. */
  equipped: z.boolean(),
});
export type ImportLoadout = z.infer<typeof importLoadoutSchema>;

/** The parts of `GET /api/imports/:id/parsed` the setup reads. */
export const importSetupSchema = z.object({
  talentLoadouts: z.array(importLoadoutSchema),
  /** SimC option -> value for the consumables in the Addon String (`flask`, `food`, ...). */
  consumables: z.record(z.string(), z.string()),
});
export type ImportSetup = z.infer<typeof importSetupSchema>;
