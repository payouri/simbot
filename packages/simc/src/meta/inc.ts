/**
 * Parsers for SimC's generated `.inc` tables (`engine/dbc/generated/`). They read the row
 * layouts of `dbc_item_data_t`, `item_effect_t` and `item_bonus_entry_t` at the build's
 * `git_revision`. A layout change shows up as `IncFormatError` rather than as wrong data.
 */

export class IncFormatError extends Error {
  constructor(detail: string) {
    super(`SimC generated data format changed: ${detail}`);
    this.name = "IncFormatError";
  }
}

export type IncItem = {
  id: number;
  name: string;
  flags1: number;
  quality: number;
  inventoryType: number;
  itemClass: number;
  itemSubclass: number;
  setId: number;
};

export type IncEffect = { id: number; itemId: number; type: number };

export type IncBonus = {
  bonusId: number;
  type: number;
  value1: number;
  value2: number;
  index: number;
};

/** Fields after the name in a `dbc_item_data_t` row, with the socket braces folded to one. */
const ITEM_FIELDS = 27;

/** Every item row: `{ "Name", id, flags_1, flags_2, type_flags, level, ..., crafting_quality },`. */
export function parseItemData(inc: string): IncItem[] {
  const items: IncItem[] = [];
  for (const line of inc.split("\n")) {
    if (!line.startsWith('  { "')) continue;
    // The name is a C string literal: find its closing quote, skipping escapes.
    let end = 5;
    while (end < line.length && line[end] !== '"') end += line[end] === "\\" ? 2 : 1;
    const name = line.slice(5, end).replace(/\\(.)/g, "$1");
    const rest = line
      .slice(end + 1)
      .replace(/\{[^}]*\}/, "S") // the socket_color array
      .replace(/\}\s*,?\s*$/, "");
    const f = rest.split(",").slice(1); // the first piece is the empty string before the comma
    if (f.length !== ITEM_FIELDS) {
      throw new IncFormatError(`item_data row has ${f.length} fields, expected ${ITEM_FIELDS}`);
    }
    const n = (i: number) => Number(f[i]);
    const item: IncItem = {
      id: n(0),
      name,
      flags1: Number(f[1]),
      quality: n(8),
      inventoryType: n(9),
      itemClass: n(10),
      itemSubclass: n(11),
      setId: n(23),
    };
    if (
      ![item.id, item.flags1, item.quality, item.inventoryType, item.itemClass, item.setId].every(
        Number.isFinite,
      )
    ) {
      throw new IncFormatError(`item_data row for "${name}" has a non-numeric field`);
    }
    items.push(item);
  }
  if (items.length === 0) throw new IncFormatError("no item_data rows found");
  return items;
}

/** The rows of one `static ... __name { {` array, up to its closing `} };`. */
function arrayBody(inc: string, name: string): string[] {
  const lines = inc.split("\n");
  const start = lines.findIndex((l) => l.includes(name) && l.includes("{ {"));
  if (start === -1) throw new IncFormatError(`array ${name} not found`);
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("} }")) return body;
    body.push(line);
  }
  throw new IncFormatError(`array ${name} is not terminated`);
}

const ints = (line: string, count: number): number[] | null => {
  const open = line.indexOf("{");
  const close = line.indexOf("}");
  if (open === -1 || close === -1) return null;
  const parts = line
    .slice(open + 1, close)
    .split(",")
    .map((p) => Number(p.trim()));
  return parts.length === count && parts.every(Number.isFinite) ? parts : null;
};

/** `item_effect_t`: `{ id, spell_id, item_id, index, type, cooldown_group, ... }`. */
export function parseItemEffects(inc: string): IncEffect[] {
  const effects: IncEffect[] = [];
  for (const line of arrayBody(inc, "__item_effect_data")) {
    if (!line.trim()) continue;
    const v = ints(line, 8);
    if (!v) throw new IncFormatError(`unreadable item_effect row: ${line.trim()}`);
    effects.push({ id: v[0] as number, itemId: v[2] as number, type: v[4] as number });
  }
  if (effects.length === 0) throw new IncFormatError("no item_effect rows found");
  return effects;
}

/** `item_bonus_entry_t`: `{ id, bonus_id, type, value_1, value_2, value_3, value_4, index }`. */
export function parseItemBonuses(inc: string): IncBonus[] {
  const bonuses: IncBonus[] = [];
  for (const line of arrayBody(inc, "__item_bonus_data")) {
    if (!line.trim()) continue;
    const v = ints(line, 8);
    if (!v) throw new IncFormatError(`unreadable item_bonus row: ${line.trim()}`);
    bonuses.push({
      bonusId: v[1] as number,
      type: v[2] as number,
      value1: v[3] as number,
      value2: v[4] as number,
      index: v[7] as number,
    });
  }
  if (bonuses.length === 0) throw new IncFormatError("no item_bonus rows found");
  return bonuses;
}
