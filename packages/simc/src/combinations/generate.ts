import {
  type ItemSource,
  MAX_COMBINATIONS,
  type PaperdollSlot,
  paperdollSlotOf,
} from "@simbot/shared";
import type { HandType } from "../meta";

/**
 * Top Gear Combination generation: a depth-first walk over the slot product, smallest slot
 * first, pruning as it goes; tier minimums, the dedupe key and the Talent Loadouts come after.
 * Pure: no DB, no SimC, no I/O. The caller turns an Import's items into `GearItem`s.
 */

/** A gear item as the walk sees it: identity, where it came from and the rules it can break. */
export type GearItem = {
  /** `ImportItem.index`. */
  index: number;
  /** SimC's name for the slot the Addon String listed it under (`finger1`, `off_hand`, ...). */
  slot: string;
  source: ItemSource;
  itemId: number | null;
  /** What makes two items the same for the dedupe key: the item line without its slot. */
  signature: string;
  ilvl: number | null;
  /** Weapon handedness; absent for anything that is not a weapon, shield or held item. */
  hand?: HandType;
  uniqueEquipped?: boolean;
  onUse?: boolean;
  /** ItemLimitCategory ids that count this item (its own plus those its bonuses grant). */
  limitCategories?: readonly number[];
  gemIds?: readonly number[];
  /** Tier set id, when the item belongs to a set. */
  setId?: number;
  /** Catalyst charges converting this item into what it is costs. */
  catalystCost?: number;
  /** Upgrade budget (crests) getting this item to the level it is offered at costs. */
  upgradeCost?: number;
};

export type GenerateInput = {
  /** Every gear item of the Import that may take part: the equipped ones and the readable Candidate Items. */
  items: readonly GearItem[];
  /** `GearItem.index` of the Candidate Items the user included. */
  included: readonly number[];
  lockedSlots: readonly PaperdollSlot[];
  /** Selected Talent Loadouts (positions in the Import's list). Empty: only the equipped one. */
  talentLoadouts: readonly number[];
  /** The loadout the character has on; null when the profile's own talents are not in the list. */
  equippedLoadout: number | null;
  /** ItemLimitCategory id -> how many of it may be equipped. */
  categoryLimits?: ReadonlyMap<number, number>;
  /** Gem ids that may be socketed only once across the equipped set. */
  uniqueGems?: ReadonlySet<number>;
  /** Weapon rules of the class and spec. */
  weapons?: { dualWield: boolean; titansGrip: boolean };
  minTierPieces?: number;
  catalystCharges?: number;
  upgradeBudget?: number;
};

export type GenerateOptions = {
  /** Also return the Combinations, not just the count. Ignored above `MAX_COMBINATIONS`. */
  materialize?: boolean;
  /** Stop walking after this many complete gear sets (a safety cap; `atLeast` is then set). */
  walkCap?: number;
  /** Stop walking after this many nodes. */
  nodeCap?: number;
};

export type Combination = {
  /** 1-based; 1 is the equipped baseline. */
  id: number;
  isBaseline: boolean;
  /** SimC slot -> `GearItem.index`, for every slot that holds an item. */
  gear: Record<string, number>;
  talentLoadout: number | null;
};

export type GenerateResult = {
  /** Combinations after pruning, the baseline and every Talent Loadout included. */
  count: number;
  gearCount: number;
  loadoutCount: number;
  /** A safety cap stopped the walk: the real count is at least `count`. */
  atLeast: boolean;
  /** Included Candidate Items that no Combination uses. Empty when the walk was cut short. */
  unusedCandidates: number[];
  /** Present when `materialize` was asked for and the count is within `MAX_COMBINATIONS`. */
  combinations?: Combination[];
};

export const DEFAULT_WALK_CAP = 250_000;
export const DEFAULT_NODE_CAP = 5_000_000;

const TIER_SLOTS: ReadonlySet<PaperdollSlot> = new Set([
  "head",
  "shoulders",
  "chest",
  "hands",
  "legs",
]);
const MAIN_HAND: ReadonlySet<HandType | undefined> = new Set(["1h", "main", undefined]);
const OFF_HAND_ONLY: ReadonlySet<HandType | undefined> = new Set(["off", "shield", "held"]);
const TWO_HANDED: ReadonlySet<HandType | undefined> = new Set(["2h", "ranged"]);

/** One way to fill a Paperdoll slot: the items and where each sits. */
type SlotOption = {
  items: GearItem[];
  assign: [string, GearItem][];
  vault: number;
  uniqueIds: number[];
  categories: Map<number, number>;
  gems: Map<number, number>;
  catalyst: number;
  upgrade: number;
  /** Identity for the dedupe key. */
  key: string;
};

const bump = (m: Map<number, number>, k: number, by: number) => m.set(k, (m.get(k) ?? 0) + by);

/** Builds an option, or null when the items in it already break a rule among themselves. */
function makeOption(
  assign: [string, GearItem][],
  unorderedKey: boolean,
  ctx: Ctx,
): SlotOption | null {
  const items = assign.map(([, it]) => it);
  const option: SlotOption = {
    items,
    assign,
    vault: 0,
    uniqueIds: [],
    categories: new Map(),
    gems: new Map(),
    catalyst: 0,
    upgrade: 0,
    key: "",
  };
  const seenUnique = new Set<number>();
  for (const it of items) {
    if (it.source === "great_vault") option.vault++;
    if (it.uniqueEquipped && it.itemId !== null) {
      if (seenUnique.has(it.itemId)) return null;
      seenUnique.add(it.itemId);
      option.uniqueIds.push(it.itemId);
    }
    for (const c of it.limitCategories ?? []) if (ctx.limits.has(c)) bump(option.categories, c, 1);
    for (const g of it.gemIds ?? []) if (ctx.uniqueGems.has(g)) bump(option.gems, g, 1);
    option.catalyst += it.catalystCost ?? 0;
    option.upgrade += it.upgradeCost ?? 0;
  }
  if (option.vault > 1) return null;
  for (const [c, n] of option.categories) if (n > (ctx.limits.get(c) ?? Infinity)) return null;
  for (const n of option.gems.values()) if (n > 1) return null;
  const sigs = items.map((i) => i.signature);
  option.key = (unorderedKey ? [...sigs].sort() : sigs).join("+");
  return option;
}

type Ctx = {
  limits: ReadonlyMap<number, number>;
  uniqueGems: ReadonlySet<number>;
};

const isOnUse = (i: GearItem) => i.onUse === true;

/** All ways to wear `pool` in a two-slot pair: unordered, both orders when both are on-use. */
function pairOptions(pool: readonly GearItem[], slots: [string, string], ctx: Ctx): SlotOption[] {
  if (pool.length < 2) {
    return pool.map((it) => makeOption([[slots[0], it]], true, ctx)).filter((o) => o !== null);
  }
  const out: SlotOption[] = [];
  for (let a = 0; a < pool.length; a++) {
    for (let b = a + 1; b < pool.length; b++) {
      const x = pool[a] as GearItem;
      const y = pool[b] as GearItem;
      const both = isOnUse(x) && isOnUse(y);
      const forward = makeOption(
        [
          [slots[0], x],
          [slots[1], y],
        ],
        !both,
        ctx,
      );
      if (forward) out.push(forward);
      if (both) {
        const swapped = makeOption(
          [
            [slots[0], y],
            [slots[1], x],
          ],
          false,
          ctx,
        );
        if (swapped) out.push(swapped);
      }
    }
  }
  return out;
}

/** Weapon options by the 1H / 2H / dual-wield / Fury rules. A one-hander always needs an off hand. */
function weaponOptions(
  pool: readonly GearItem[],
  rules: { dualWield: boolean; titansGrip: boolean },
  ctx: Ctx,
): SlotOption[] {
  const out: SlotOption[] = [];
  const push = (assign: [string, GearItem][], unordered: boolean) => {
    const o = makeOption(assign, unordered, ctx);
    if (o) out.push(o);
  };
  const twoHanders = pool.filter((i) => TWO_HANDED.has(i.hand));
  for (const w of twoHanders) push([["main_hand", w]], true);
  if (rules.titansGrip) {
    for (let a = 0; a < twoHanders.length; a++) {
      for (let b = a + 1; b < twoHanders.length; b++) {
        push(
          [
            ["main_hand", twoHanders[a] as GearItem],
            ["off_hand", twoHanders[b] as GearItem],
          ],
          true,
        );
      }
    }
  }
  for (const main of pool.filter((i) => MAIN_HAND.has(i.hand))) {
    for (const off of pool) {
      if (off === main) continue;
      const offOk =
        OFF_HAND_ONLY.has(off.hand) ||
        (rules.dualWield && (off.hand === "1h" || off.hand === undefined));
      if (!offOk) continue;
      // Weapons key unordered: two one-handers swapped between the hands are the same pair.
      push(
        [
          ["main_hand", main],
          ["off_hand", off],
        ],
        true,
      );
    }
  }
  return out;
}

type SlotDef = { slot: PaperdollSlot; equipped: GearItem[]; candidates: GearItem[] };

function equippedOption(def: SlotDef, ctx: Ctx): SlotOption {
  const assign = def.equipped.map((it): [string, GearItem] => [it.slot, it]);
  // Equipped items are what the character wears: they are an option whatever the rules say.
  const onUsePair =
    def.slot === "trinket" && def.equipped.length === 2 && def.equipped.every(isOnUse);
  const raw = makeOption(assign, !onUsePair, ctx);
  if (raw) return raw;
  return {
    items: def.equipped,
    assign,
    vault: 0,
    uniqueIds: [],
    categories: new Map(),
    gems: new Map(),
    catalyst: 0,
    upgrade: 0,
    key: (onUsePair
      ? def.equipped.map((i) => i.signature)
      : def.equipped.map((i) => i.signature).sort()
    ).join("+"),
  };
}

function optionsFor(def: SlotDef, locked: boolean, input: GenerateInput, ctx: Ctx): SlotOption[] {
  const base = equippedOption(def, ctx);
  if (locked || def.candidates.length === 0) return [base];
  const pool = [...def.equipped, ...def.candidates];
  let options: SlotOption[];
  if (def.slot === "finger") options = pairOptions(pool, ["finger1", "finger2"], ctx);
  else if (def.slot === "trinket") options = pairOptions(pool, ["trinket1", "trinket2"], ctx);
  else if (def.slot === "main_hand") {
    options = weaponOptions(pool, input.weapons ?? { dualWield: false, titansGrip: false }, ctx);
  } else {
    options = pool.map((it) => makeOption([[def.slot, it]], true, ctx)).filter((o) => o !== null);
  }
  // The equipped arrangement leads, so the walk meets the baseline first.
  const seen = new Set([base.key]);
  return [base, ...options.filter((o) => !seen.has(o.key) && seen.add(o.key))];
}

/** Ways to say "the same Combination": pairs sort, on-use trinkets keep their order. */
const gearKey = (chosen: readonly SlotOption[]) =>
  chosen
    .map((o) => o.key)
    .sort()
    .join("|");

/** The tier set most worn (else most on offer); its pieces are the ones a tier minimum counts. */
function tierSetId(defs: readonly SlotDef[]): number | null {
  const tally = (pick: (d: SlotDef) => GearItem[]) => {
    const counts = new Map<number, number>();
    for (const d of defs) {
      if (!TIER_SLOTS.has(d.slot)) continue;
      for (const it of pick(d)) if (it.setId !== undefined) bump(counts, it.setId, 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
  };
  return tally((d) => d.equipped) ?? tally((d) => [...d.equipped, ...d.candidates]);
}

const slotOf = (item: GearItem): PaperdollSlot | null => paperdollSlotOf(item.slot);

export function generateCombinations(
  input: GenerateInput,
  options: GenerateOptions = {},
): GenerateResult {
  const walkCap = options.walkCap ?? DEFAULT_WALK_CAP;
  const nodeCap = options.nodeCap ?? DEFAULT_NODE_CAP;
  const ctx: Ctx = {
    limits: input.categoryLimits ?? new Map(),
    uniqueGems: input.uniqueGems ?? new Set(),
  };
  const included = new Set(input.included);
  const locked = new Set(input.lockedSlots);

  const defs = new Map<PaperdollSlot, SlotDef>();
  for (const item of input.items) {
    const slot = slotOf(item);
    if (!slot) continue;
    let def = defs.get(slot);
    if (!def) {
      def = { slot, equipped: [], candidates: [] };
      defs.set(slot, def);
    }
    if (item.source === "equipped") def.equipped.push(item);
    else if (included.has(item.index) && !locked.has(slot)) def.candidates.push(item);
  }
  for (const d of defs.values())
    d.equipped.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  const slotDefs = [...defs.values()];

  // The baseline: what is worn now, in the order it is worn.
  const baseChosen = slotDefs.map((d) => equippedOption(d, ctx));
  const baseGear: Record<string, number> = {};
  for (const o of baseChosen) for (const [slot, it] of o.assign) baseGear[slot] = it.index;
  const baseKey = gearKey(baseChosen);

  const slotOptions = slotDefs
    .map((d) => optionsFor(d, locked.has(d.slot), input, ctx))
    .sort((a, b) => a.length - b.length);

  // The walk.
  const leaves: SlotOption[][] = [];
  const chosen: SlotOption[] = new Array(slotOptions.length);
  let vault = 0;
  let catalyst = 0;
  let upgrade = 0;
  let nodes = 0;
  let capped = false;
  const ids = new Set<number>();
  const cats = new Map<number, number>();
  const gems = new Map<number, number>();
  const catalystMax = input.catalystCharges ?? Infinity;
  const upgradeMax = input.upgradeBudget ?? Infinity;

  const fits = (o: SlotOption): boolean => {
    if (vault + o.vault > 1) return false;
    if (catalyst + o.catalyst > catalystMax || upgrade + o.upgrade > upgradeMax) return false;
    for (const id of o.uniqueIds) if (ids.has(id)) return false;
    for (const [c, n] of o.categories) {
      if ((cats.get(c) ?? 0) + n > (ctx.limits.get(c) ?? Infinity)) return false;
    }
    for (const g of o.gems.keys()) if (gems.has(g)) return false;
    return true;
  };
  const apply = (o: SlotOption, sign: 1 | -1) => {
    vault += sign * o.vault;
    catalyst += sign * o.catalyst;
    upgrade += sign * o.upgrade;
    for (const id of o.uniqueIds) {
      if (sign === 1) ids.add(id);
      else ids.delete(id);
    }
    for (const [c, n] of o.categories) bump(cats, c, sign * n);
    for (const [g, n] of o.gems) bump(gems, g, sign * n);
    if (sign === -1) for (const g of o.gems.keys()) if (gems.get(g) === 0) gems.delete(g);
  };
  const walk = (depth: number) => {
    if (capped) return;
    if (depth === slotOptions.length) {
      if (leaves.length >= walkCap) capped = true;
      else leaves.push([...chosen]);
      return;
    }
    for (const o of slotOptions[depth] as SlotOption[]) {
      if (++nodes > nodeCap) {
        capped = true;
        return;
      }
      if (!fits(o)) continue;
      apply(o, 1);
      chosen[depth] = o;
      walk(depth + 1);
      apply(o, -1);
      if (capped) return;
    }
  };
  walk(0);

  // After the walk: tier minimums, then the dedupe key.
  const tierId = input.minTierPieces ? tierSetId(slotDefs) : null;
  const tierPieces = (leaf: readonly SlotOption[]) =>
    leaf.reduce(
      (n, o) =>
        n +
        o.items.filter((i) => {
          const slot = slotOf(i);
          return slot && TIER_SLOTS.has(slot) && i.setId !== undefined && i.setId === tierId;
        }).length,
      0,
    );
  const kept = input.minTierPieces
    ? leaves.filter((l) => tierPieces(l) >= (input.minTierPieces ?? 0))
    : leaves;

  const used = new Set<number>();
  const unique = new Map<string, SlotOption[]>();
  for (const leaf of kept) {
    for (const o of leaf) for (const it of o.items) used.add(it.index);
    const key = gearKey(leaf);
    if (!unique.has(key)) unique.set(key, leaf);
  }
  unique.delete(baseKey);
  const gearCount = unique.size + 1;

  // Talent Loadouts multiply the gear; the baseline keeps the equipped one whatever is selected.
  const selected: (number | null)[] = input.talentLoadouts.length
    ? [...new Set(input.talentLoadouts)]
    : [input.equippedLoadout];
  const baselineOutside = !selected.includes(input.equippedLoadout);
  const count = gearCount * selected.length + (baselineOutside ? 1 : 0);

  const itemAt = new Map(input.items.map((i) => [i.index, i]));
  const unusedCandidates = capped
    ? []
    : [...new Set(input.included)].filter((i) => {
        const item = itemAt.get(i);
        const slot = item && slotOf(item);
        return item && slot && item.source !== "equipped" && !locked.has(slot) && !used.has(i);
      });

  const result: GenerateResult = {
    count,
    gearCount,
    loadoutCount: selected.length + (baselineOutside ? 1 : 0),
    atLeast: capped,
    unusedCandidates,
  };
  if (options.materialize && count <= MAX_COMBINATIONS) {
    const out: Combination[] = [];
    const add = (gear: Record<string, number>, loadout: number | null, isBaseline: boolean) =>
      out.push({ id: out.length + 1, isBaseline, gear, talentLoadout: loadout });
    add(baseGear, input.equippedLoadout, true);
    const gearOf = (leaf: readonly SlotOption[]) => {
      const gear: Record<string, number> = {};
      for (const o of leaf) for (const [slot, it] of o.assign) gear[slot] = it.index;
      return gear;
    };
    for (const l of selected) if (l !== input.equippedLoadout) add(baseGear, l, false);
    for (const leaf of unique.values()) {
      const gear = gearOf(leaf);
      for (const l of selected) add(gear, l, false);
    }
    result.combinations = out;
  }
  return result;
}
