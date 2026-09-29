import type { ItemMeta } from "./schema";

/** Where each inventory type is worn, for building a SimC profile that equips one item. */
const SLOT_BY_INVENTORY_TYPE: Readonly<Record<number, string>> = {
  1: "head",
  2: "neck",
  3: "shoulder",
  5: "chest",
  6: "waist",
  7: "legs",
  8: "feet",
  9: "wrist",
  10: "hands",
  11: "finger1",
  12: "trinket1",
  13: "main_hand",
  14: "off_hand",
  15: "main_hand",
  16: "back",
  17: "main_hand",
  20: "chest",
  21: "main_hand",
  22: "off_hand",
  23: "off_hand",
  26: "main_hand",
};

/** SimC's `util::tokenize` for item names: lower case, spaces to `_`, punctuation dropped. */
export const tokenizeName = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(" ", "_")
    .replace(/[^a-z0-9_.]/g, "");

/** Every `step`-th item of the meta, in id order, as ids to check against a live SimC. */
export function sampleItemIds(meta: ItemMeta, step: number): number[] {
  return Object.keys(meta.items)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((_, i) => i % step === 0);
}

/** A SimC profile with one actor per item, each wearing only that item. */
export function sampleProfile(meta: ItemMeta, ids: readonly number[]): string {
  const lines = ['warrior="Test"', "level=90", "race=human", "spec=fury"];
  ids.forEach((id, i) => {
    const slot = SLOT_BY_INVENTORY_TYPE[meta.items[id]?.inventoryType ?? 0];
    if (slot) lines.push(`copy=p${i},Test`, `${slot}=,id=${id}`);
  });
  return `${lines.join("\n")}\n`;
}

export type MetaMismatch = { id: number; field: "name"; meta: string; simc: string };

/**
 * Compares the items a live SimC loaded (from its json2 report) with the meta.
 * json2 exposes only the tokenized name, so that is the one live value it can vouch for.
 */
export function compareWithJson2(
  meta: ItemMeta,
  json2: unknown,
): { checked: number; mismatches: MetaMismatch[] } {
  const players = (json2 as { sim?: { players?: { gear?: Record<string, unknown> }[] } }).sim
    ?.players;
  if (!Array.isArray(players)) throw new Error("json2 has no sim.players");
  let checked = 0;
  const mismatches: MetaMismatch[] = [];
  for (const player of players) {
    for (const gear of Object.values(player.gear ?? {})) {
      const { name, encoded_item: encoded } = gear as { name?: string; encoded_item?: string };
      const id = Number(/(?:^|,)id=(\d+)/.exec(encoded ?? "")?.[1]);
      const item = meta.items[id];
      if (!item || typeof name !== "string") continue;
      checked++;
      if (tokenizeName(item.name) !== name) {
        mismatches.push({ id, field: "name", meta: item.name, simc: name });
      }
    }
  }
  return { checked, mismatches };
}
