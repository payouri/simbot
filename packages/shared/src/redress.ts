import type { ImportItem } from "./items";
import { type PaperdollSlot, paperdollSlotOf, paperdollSlotSchema } from "./paperdoll";

const PAPERDOLL_SLOTS_ALL = paperdollSlotSchema.options;

/** What one Paperdoll slot holds in a Combination, against the equipped set. */
export type SlotDress = {
  /** Worn in the Combination, SimC slot order (finger1 before finger2). */
  items: ImportItem[];
  /** Worn in the Combination but not in the equipped set: these glow. */
  fresh: ImportItem[];
  /** Worn in the equipped set but not in the Combination: shown as "was". */
  gone: ImportItem[];
};

const wornIn = (
  gear: Readonly<Record<string, number>>,
  byIndex: ReadonlyMap<number, ImportItem>,
): Record<PaperdollSlot, ImportItem[]> => {
  const out = Object.fromEntries(PAPERDOLL_SLOTS_ALL.map((s) => [s, [] as ImportItem[]])) as Record<
    PaperdollSlot,
    ImportItem[]
  >;
  for (const simcSlot of Object.keys(gear).sort()) {
    const slot = paperdollSlotOf(simcSlot);
    const item = byIndex.get(gear[simcSlot] as number);
    if (slot && item) out[slot].push(item);
  }
  return out;
};

/**
 * Re-dresses the Paperdoll in a Combination. An item counts as changed by its Import index, so
 * two rings that swap fingers change nothing.
 */
export function redress(
  gear: Readonly<Record<string, number>>,
  equippedGear: Readonly<Record<string, number>>,
  byIndex: ReadonlyMap<number, ImportItem>,
): Record<PaperdollSlot, SlotDress> {
  const now = wornIn(gear, byIndex);
  const was = wornIn(equippedGear, byIndex);
  return Object.fromEntries(
    PAPERDOLL_SLOTS_ALL.map((slot) => {
      const have = new Set(now[slot].map((i) => i.index));
      const had = new Set(was[slot].map((i) => i.index));
      return [
        slot,
        {
          items: now[slot],
          fresh: now[slot].filter((i) => !had.has(i.index)),
          gone: was[slot].filter((i) => !have.has(i.index)),
        },
      ];
    }),
  ) as Record<PaperdollSlot, SlotDress>;
}

/** How many Paperdoll slots differ from the equipped set. */
export const changedSlots = (dress: Record<PaperdollSlot, SlotDress>): PaperdollSlot[] =>
  PAPERDOLL_SLOTS_ALL.filter((s) => dress[s].fresh.length > 0 || dress[s].gone.length > 0);
