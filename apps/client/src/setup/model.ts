import {
  type ImportItem,
  PAPERDOLL_LEFT,
  PAPERDOLL_RIGHT,
  type PaperdollSlot,
  paperdollSlotOf,
  type TopGearSelection,
} from "@simbot/shared";

/** What one Paperdoll slot holds, from an Import's items. */
export type SlotItems = {
  /** What is worn there (two rings, two trinkets, weapons). */
  equipped: ImportItem[];
  /** Candidate Items SimC read: the ones that can be included. */
  candidates: ImportItem[];
  /** Unknown Item candidates: shown as placeholders, never selectable. */
  placeholders: ImportItem[];
  /** Candidate Items the Current SimC Build knows but did not read (the class cannot use them). */
  unusable: ImportItem[];
};

export const PAPERDOLL_SLOTS: readonly PaperdollSlot[] = [
  ...PAPERDOLL_LEFT,
  ...PAPERDOLL_RIGHT,
  "main_hand",
];

const byIndex = (a: ImportItem, b: ImportItem) => a.index - b.index;

/** Higher item level first, unread items last; ties keep Addon String order. */
const byIlvlDesc = (a: ImportItem, b: ImportItem) =>
  (b.ilvl ?? -1) - (a.ilvl ?? -1) || a.index - b.index;

export function groupBySlot(items: readonly ImportItem[]): Record<PaperdollSlot, SlotItems> {
  const groups = Object.fromEntries(
    PAPERDOLL_SLOTS.map((slot): [PaperdollSlot, SlotItems] => [
      slot,
      { equipped: [], candidates: [], placeholders: [], unusable: [] },
    ]),
  ) as Record<PaperdollSlot, SlotItems>;
  for (const item of items) {
    const slot = paperdollSlotOf(item.slot);
    if (!slot) continue;
    const group = groups[slot];
    if (item.source === "equipped") group.equipped.push(item);
    else if (item.status === "unknown") group.placeholders.push(item);
    else if (item.selectable) group.candidates.push(item);
    else group.unusable.push(item);
  }
  for (const group of Object.values(groups)) {
    group.equipped.sort(byIndex);
    group.candidates.sort(byIlvlDesc);
    group.placeholders.sort(byIndex);
    group.unusable.sort(byIndex);
  }
  return groups;
}

/** How many of a slot's candidates are included. */
export const includedCount = (included: readonly number[], candidates: readonly ImportItem[]) =>
  candidates.filter((c) => included.includes(c.index)).length;

export function toggleItem(selection: TopGearSelection, index: number): TopGearSelection {
  const on = selection.included.includes(index);
  return {
    ...selection,
    included: on ? selection.included.filter((i) => i !== index) : [...selection.included, index],
  };
}

/** Includes (`on`) or excludes every one of `candidates`. */
export function setCandidates(
  selection: TopGearSelection,
  candidates: readonly ImportItem[],
  on: boolean,
): TopGearSelection {
  const indexes = new Set(candidates.map((c) => c.index));
  const rest = selection.included.filter((i) => !indexes.has(i));
  return { ...selection, included: on ? [...rest, ...indexes] : rest };
}

export function toggleLock(selection: TopGearSelection, slot: PaperdollSlot): TopGearSelection {
  const locked = selection.lockedSlots.includes(slot);
  return {
    ...selection,
    lockedSlots: locked
      ? selection.lockedSlots.filter((s) => s !== slot)
      : [...selection.lockedSlots, slot],
  };
}

/** At least one Talent Loadout stays selected: switching off the last one does nothing. */
export function toggleLoadout(selection: TopGearSelection, index: number): TopGearSelection {
  const on = selection.talentLoadouts.includes(index);
  if (on && selection.talentLoadouts.length === 1) return selection;
  return {
    ...selection,
    talentLoadouts: on
      ? selection.talentLoadouts.filter((i) => i !== index)
      : [...selection.talentLoadouts, index],
  };
}

/** Candidates that count: included ones in slots that are not locked. */
export function candidatesInPlay(
  selection: TopGearSelection,
  groups: Record<PaperdollSlot, SlotItems>,
): number {
  return PAPERDOLL_SLOTS.filter((slot) => !selection.lockedSlots.includes(slot)).reduce(
    (n, slot) => n + includedCount(selection.included, groups[slot].candidates),
    0,
  );
}

/** Slots with at least one included candidate that is in play. */
export function slotsInPlay(
  selection: TopGearSelection,
  groups: Record<PaperdollSlot, SlotItems>,
): number {
  return PAPERDOLL_SLOTS.filter(
    (slot) =>
      !selection.lockedSlots.includes(slot) &&
      includedCount(selection.included, groups[slot].candidates) > 0,
  ).length;
}

/** A SimC option value as words: `flask_of_power_3` becomes "flask of power 3". */
export const prettyOption = (value: string) => value.replaceAll("_", " ");

export const CONSUMABLE_LABEL: Record<string, string> = {
  flask: "Flask",
  food: "Food",
  potion: "Potion",
  augmentation: "Rune",
  temporary_enchant: "Weapon oil",
};

/** The name a Talent Loadout is listed under. */
export const loadoutName = (
  loadout: { comment: string | null; equipped: boolean },
  position: number,
) => loadout.comment?.trim() || (loadout.equipped ? "Equipped talents" : `Loadout ${position + 1}`);
