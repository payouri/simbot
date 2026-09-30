import type {
  IndexedItem,
  ItemSource,
  ItemStats,
  UnknownItem,
  UnknownReport,
} from "@simbot/shared";
import { z } from "zod";
import { isClassKey, isEquipmentSlot, isUnsafeOptionLine } from "./addon-string";
import type { ItemMeta, MetaItem } from "./meta";

/**
 * The packed pass: one SimC run per Import that reads every item's ilvl and stats.
 *
 * The equipped set is the `base` actor. Candidate Items go into as few `copy=` actors as
 * possible, one per slot per actor, each a copy of `base` with candidates swapped in. SimC runs
 * `iterations=1` with `item_db_source=local` and the numbers are read back from each actor's
 * json2 `gear` by slot.
 *
 * Ways the pass could lie or abort, and what guards them:
 * - an unknown item id aborts SimC, an unknown bonus id is silently ignored (ilvl wrong): items
 *   with either are never sent (`classifyItems`);
 * - an unknown gem id aborts SimC: gems and enchants are never sent, so the numbers are the
 *   item's own;
 * - SimC drops items the class cannot use from `gear` without a word: an item is only `ok` when
 *   the reported item in its slot has its id (`readItemPass`);
 * - a 2h weapon next to an off-hand, or no main hand at all, aborts SimC: off-hands ride with a
 *   companion one-hander, 2h candidates clear the off-hand, and the caller drops an actor SimC
 *   names in an error and retries (`initErrorActor`).
 */

export type RawItem = { slot: string; source: ItemSource; rawLine: string };

export type ParsedItemLine = {
  slot: string;
  itemId: number | null;
  bonusIds: number[];
  /** Attributes after the name, in order: `[key, value]`. */
  attrs: [string, string][];
};

const SLOT_ALIASES: Readonly<Record<string, string>> = {
  shoulder: "shoulders",
  wrist: "wrists",
  finger: "finger1",
  trinket: "trinket1",
  two_hand: "main_hand",
};

/** SimC's own name for a slot, which is also the key in json2 `gear`. */
export const normalizeSlot = (slot: string) => SLOT_ALIASES[slot] ?? slot;

const num = (raw: string | undefined) => (raw !== undefined && /^\d+$/.test(raw) ? +raw : null);

/** Reads `slot=name,id=1,bonus_id=1/2,...`. The name is ignored: SimC looks the item up by id. */
export function parseItemLine(rawLine: string): ParsedItemLine {
  const eq = rawLine.indexOf("=");
  const slot = normalizeSlot(rawLine.slice(0, Math.max(eq, 0)).trim());
  const attrs: [string, string][] = [];
  for (const part of rawLine
    .slice(eq + 1)
    .split(",")
    .slice(1)) {
    const at = part.indexOf("=");
    if (at > 0) attrs.push([part.slice(0, at).trim(), part.slice(at + 1).trim()]);
  }
  const get = (key: string) => attrs.find(([k]) => k === key)?.[1];
  const bonus = get("bonus_id");
  return {
    slot,
    itemId: num(get("id")),
    bonusIds: bonus ? bonus.split(/[/:]/).map(Number).filter(Number.isInteger) : [],
    attrs,
  };
}

export type ClassifiedItem = RawItem & {
  index: number;
  parsed: ParsedItemLine;
  known: boolean;
  unknown: UnknownItem | null;
};

/**
 * Checks every item and bonus id against the Current SimC Build's item-meta. An item whose id
 * or any bonus id is missing is an Unknown Item.
 */
export function classifyItems(
  items: readonly RawItem[],
  meta: Pick<ItemMeta, "items" | "bonuses">,
): { items: ClassifiedItem[]; unknown: Omit<UnknownReport, "unknownFields"> } {
  const itemIds = new Set<number>();
  const bonusIds = new Set<number>();
  const classified = items.map((raw, index): ClassifiedItem => {
    const parsed = parseItemLine(raw.rawLine);
    const unknownItemId = parsed.itemId === null || !(parsed.itemId in meta.items);
    const unknownBonusIds = parsed.bonusIds.filter((id) => !(id in meta.bonuses));
    const known = !unknownItemId && unknownBonusIds.length === 0;
    if (unknownItemId && parsed.itemId !== null) itemIds.add(parsed.itemId);
    for (const id of unknownBonusIds) bonusIds.add(id);
    return {
      ...raw,
      index,
      parsed,
      known,
      unknown: known
        ? null
        : {
            index,
            slot: parsed.slot,
            source: raw.source,
            rawLine: raw.rawLine,
            itemId: parsed.itemId,
            unknownItemId,
            unknownBonusIds,
          },
    };
  });
  const sorted = (ids: Set<number>) => [...ids].sort((a, b) => a - b);
  return {
    items: classified,
    unknown: {
      items: classified.flatMap((i) => (i.unknown ? [i.unknown] : [])),
      itemIds: sorted(itemIds),
      bonusIds: sorted(bonusIds),
    },
  };
}

/** Attributes that would make SimC decode extra data (and abort on an unknown id). */
const DROPPED_ATTRS = new Set(["gem_id", "gem_bonus_id", "enchant", "enchant_id"]);

const passLine = (slot: string, item: ParsedItemLine) =>
  [
    `${slot}=`,
    `,id=${item.itemId}`,
    ...item.attrs
      .filter(([k]) => k !== "id" && !DROPPED_ATTRS.has(k))
      .map(([k, v]) => `,${k}=${v}`),
  ].join("");

type Placement = { index: number; slot: string };
export type PassActor = {
  name: string;
  /** Lines that come after `copy=` and before the placements (companion weapon, off-hand reset). */
  setup: string[];
  placements: Placement[];
};

export type ItemPassPlan =
  | { skipped: string }
  | {
      skipped?: undefined;
      /** Slot of every known equipped item, read from the `base` actor. */
      base: Placement[];
      actors: PassActor[];
      profile: string[];
    };

const OFF_HANDS = new Set(["off", "shield", "held"]);
const TWO_HANDS = new Set(["2h", "ranged"]);
export const BASE_ACTOR = "base";

/** The profile lines of an Addon String: everything that is not a comment or an item. */
export function profileLines(addonString: string): string[] {
  const out: string[] = [];
  for (const line of addonString.split(/\r\n|\n|\r/)) {
    if (isUnsafeOptionLine(line)) continue;
    const eq = line.indexOf("=");
    if (!line.trim() || line.startsWith("#") || eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (isEquipmentSlot(key)) continue;
    out.push(isClassKey(key) ? `${key}="${BASE_ACTOR}"` : line);
  }
  return out;
}

/**
 * Plans the packed pass. Only known items are sent. Equipped items form the `base` actor;
 * known Candidate Items are packed into `copy=` actors, one per slot per actor.
 */
export function planItemPass(
  addonString: string,
  items: readonly ClassifiedItem[],
  meta: Pick<ItemMeta, "items">,
): ItemPassPlan {
  const metaOf = (i: ClassifiedItem): MetaItem | undefined =>
    i.parsed.itemId === null ? undefined : meta.items[i.parsed.itemId];
  const handOf = (i: ClassifiedItem) => metaOf(i)?.hand;
  const isWeapon = (i: ClassifiedItem) => handOf(i) !== undefined;

  const equipped = items.filter((i) => i.source === "equipped" && i.known);
  const candidates = items.filter((i) => i.source !== "equipped" && i.known);
  const baseLines = new Map<string, ClassifiedItem>();
  for (const i of equipped) baseLines.set(i.parsed.slot, i);

  // A pass with no main hand aborts SimC, and an unknown equipped weapon is left out: borrow a
  // Candidate weapon for the base so the rest of the pass still runs. Its numbers are not used.
  let borrowed: ClassifiedItem | null = null;
  if (!baseLines.has("main_hand")) {
    borrowed = candidates.find((i) => isWeapon(i) && !OFF_HANDS.has(handOf(i) as string)) ?? null;
    if (!borrowed) return { skipped: "no known main hand weapon to run the pass with" };
  }

  const oneHanded = (i: ClassifiedItem | undefined) =>
    i !== undefined && (handOf(i) === "1h" || handOf(i) === "main");
  const companion = oneHanded(baseLines.get("main_hand"))
    ? baseLines.get("main_hand")
    : candidates.find((i) => oneHanded(i));

  const general: PassActor[] = [];
  const offHand: PassActor[] = [];
  const put = (actors: PassActor[], prefix: string, item: ClassifiedItem, slot: string) => {
    let actor = actors.find((a) => !a.placements.some((p) => p.slot === slot));
    if (!actor) {
      actor = { name: `${prefix}${actors.length}`, setup: [], placements: [] };
      actors.push(actor);
    }
    actor.placements.push({ index: item.index, slot });
    return actor;
  };

  for (const item of candidates) {
    const hand = handOf(item);
    if (hand !== undefined && OFF_HANDS.has(hand)) {
      // With no one-hander to pair it with, the off-hand is not sent and reads as unresolved.
      if (!companion) continue;
      const actor = put(offHand, "o", item, "off_hand");
      if (actor.setup.length === 0) {
        actor.setup.push(passLine("main_hand", companion.parsed));
      }
    } else if (hand !== undefined) {
      const actor = put(general, "c", item, "main_hand");
      if (TWO_HANDS.has(hand) && !actor.setup.includes("off_hand=")) actor.setup.push("off_hand=");
    } else {
      put(general, "c", item, item.parsed.slot);
    }
  }

  const base: Placement[] = equipped.map((i) => ({ index: i.index, slot: i.parsed.slot }));
  const profile = [
    ...profileLines(addonString),
    ...equipped.map((i) => passLine(i.parsed.slot, i.parsed)),
    ...(borrowed ? [passLine("main_hand", borrowed.parsed)] : []),
  ];
  return { base, actors: [...general, ...offHand], profile };
}

/** The SimC input of a plan, without the actors named in `exclude`. */
export function renderItemPass(
  plan: Exclude<ItemPassPlan, { skipped: string }>,
  items: readonly ClassifiedItem[],
  exclude: ReadonlySet<string> = new Set(),
): string {
  const lines = [...plan.profile];
  for (const actor of plan.actors) {
    if (exclude.has(actor.name)) continue;
    lines.push(`copy=${actor.name},${BASE_ACTOR}`, ...actor.setup);
    for (const p of actor.placements) {
      const item = items[p.index] as ClassifiedItem;
      lines.push(passLine(p.slot, item.parsed));
    }
  }
  lines.push("iterations=1", "item_db_source=local", "max_time=10", "");
  return lines.join("\n");
}

/** SimC arguments of the pass: the input, no progress bar, no text report, json2 to a file. */
export const itemPassArgs = (inputPath: string, json2Path: string) => [
  inputPath,
  "progressbar_type=0",
  "output=/dev/null",
  `json2=${json2Path}`,
];

/** The player named in a SimC initialization error (`Player 'c3': ...`), if there is one. */
export function initErrorActor(stderr: string): string | null {
  return /Initialization error: Player '([^']+)'/.exec(stderr)?.[1] ?? null;
}

const passJson2Schema = z.object({
  sim: z.object({
    players: z.array(
      z.object({
        name: z.string(),
        gear: z.record(
          z.string(),
          z.object({ encoded_item: z.string(), ilevel: z.number() }).catchall(z.unknown()),
        ),
      }),
    ),
  }),
});

export class ItemPassFormatError extends Error {
  constructor(detail: string) {
    super(`SimC output format changed: ${detail}`);
    this.name = "ItemPassFormatError";
  }
}

export type ItemNumbers = { ilvl: number; stats: ItemStats };

/**
 * Reads the numbers for every placed item out of the pass's json2 `gear`, by actor and slot. An
 * item is only reported when the item SimC put in that slot has the item's id; anything else
 * (SimC dropped it, or another item sits there) has no entry, so no wrong number is ever shown.
 */
export function readItemPass(
  plan: Exclude<ItemPassPlan, { skipped: string }>,
  items: readonly ClassifiedItem[],
  json2Text: string,
): Map<number, ItemNumbers> {
  let raw: unknown;
  try {
    raw = JSON.parse(json2Text);
  } catch {
    throw new ItemPassFormatError("json2 report is not valid JSON");
  }
  const parsed = passJson2Schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ItemPassFormatError(`${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}`);
  }
  const players = new Map(parsed.data.sim.players.map((p) => [p.name, p.gear]));
  const out = new Map<number, ItemNumbers>();
  const read = (actor: string, p: Placement) => {
    const entry = players.get(actor)?.[p.slot];
    const id = /(?:^|,)id=(\d+)/.exec(entry?.encoded_item ?? "")?.[1];
    if (!entry || Number(id) !== items[p.index]?.parsed.itemId) return;
    const stats: ItemStats = {};
    for (const [key, value] of Object.entries(entry)) {
      if (key !== "ilevel" && typeof value === "number") stats[key] = value;
    }
    out.set(p.index, { ilvl: entry.ilevel, stats });
  };
  if (!players.has(BASE_ACTOR)) throw new ItemPassFormatError("no base actor in report");
  for (const p of plan.base) read(BASE_ACTOR, p);
  for (const actor of plan.actors) for (const p of actor.placements) read(actor.name, p);
  return out;
}

/** The item index of an Import: each item's status and numbers, in the Import's item order. */
export function assembleIndex(
  items: readonly ClassifiedItem[],
  numbers: ReadonlyMap<number, ItemNumbers>,
): IndexedItem[] {
  return items.map((i) => {
    const n = numbers.get(i.index);
    return {
      index: i.index,
      slot: i.parsed.slot,
      source: i.source,
      rawLine: i.rawLine,
      itemId: i.parsed.itemId,
      bonusIds: i.parsed.bonusIds,
      status: !i.known ? "unknown" : n ? "ok" : "unresolved",
      ilvl: n?.ilvl ?? null,
      stats: n?.stats ?? null,
    };
  });
}
