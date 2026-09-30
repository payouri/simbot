import { PRESELECT_MAX_COMBINATIONS, paperdollSlotOf } from "@simbot/shared";
import { type GearItem, type GenerateInput, generateCombinations } from "./generate";

/** Above this many gear sets a preselection probe is already over budget. */
const PROBE_WALK_CAP = 20_000;

/**
 * The default preselection: Candidate Items that are likely upgrades by item level gain over
 * what is worn in their slot, Great Vault items first, as many as fit in `max` Combinations.
 *
 * Candidates go in one at a time in that order; one that would push the count over `max`, or
 * that no valid Combination could use, is skipped and the next is tried. Locked slots and items
 * without an item level are never picked. Returns `GearItem.index` values, ascending.
 */
export function preselect(
  input: Omit<GenerateInput, "included">,
  max: number = PRESELECT_MAX_COMBINATIONS,
): number[] {
  const locked = new Set(input.lockedSlots);
  // What an item replaces: the worst piece worn in its Paperdoll slot. The weapons tile holds
  // a main hand and an off hand, which are compared by their own SimC slot.
  const key = (it: GearItem) => {
    const slot = paperdollSlotOf(it.slot);
    return slot === "main_hand" ? it.slot : slot;
  };
  const worst = new Map<string, number>();
  for (const it of input.items) {
    const k = key(it);
    if (it.source !== "equipped" || !k) continue;
    worst.set(k, Math.min(worst.get(k) ?? Infinity, it.ilvl ?? 0));
  }
  const gain = (it: GearItem) => {
    const slot = paperdollSlotOf(it.slot);
    const k = key(it);
    if (!slot || !k || locked.has(slot) || it.ilvl === null) return 0;
    return it.ilvl - (worst.get(k) ?? 0);
  };
  const ranked = input.items
    .filter((it) => it.source !== "equipped" && gain(it) > 0)
    .sort(
      (a, b) =>
        Number(b.source === "great_vault") - Number(a.source === "great_vault") ||
        gain(b) - gain(a) ||
        a.index - b.index,
    );

  const picked: number[] = [];
  for (const cand of ranked) {
    const probe = generateCombinations(
      { ...input, included: [...picked, cand.index] },
      { walkCap: PROBE_WALK_CAP },
    );
    if (probe.atLeast || probe.count > max || probe.unusedCandidates.includes(cand.index)) continue;
    picked.push(cand.index);
  }
  return picked.sort((a, b) => a - b);
}
