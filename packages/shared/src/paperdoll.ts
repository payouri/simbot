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

/**
 * What a Top Gear Sim is built from, as far as the setup can say: which Candidate Items are in
 * play (by `ImportItem.index` in the Import's item list), which Talent Loadouts (by position in
 * the Import's loadout list) and which slots stay as equipped. Combinations come from this later.
 */
export const topGearSelectionSchema = z.object({
  included: z.array(z.number().int().min(0)).max(2000),
  talentLoadouts: z.array(z.number().int().min(0)).max(100),
  lockedSlots: z.array(paperdollSlotSchema).max(paperdollSlotSchema.options.length),
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
});

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
