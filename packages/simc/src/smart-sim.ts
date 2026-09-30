import {
  CONSUMABLE_KEYS,
  type CombinationDefinition,
  type ConsumableSet,
  type DpsSummary,
  type Precision,
  type SimSettings,
} from "@simbot/shared";
import { equippedTalentsLine, parseAddonString } from "./addon-string";
import { normalizeSlot } from "./item-pass";
import { baselineDps, Json2FormatError, readJson2, stageJson2Schema } from "./json2";
import { buildInput, PRECISION_TARGET_ERROR } from "./quick-sim";

/**
 * The Smart Sim: the Stage ladder, the Cull, the SimC input of one Stage and the reading of its
 * report. Pure: no DB, no SimC, no I/O.
 */

/** Staging only kicks in above this many Combinations; up to it the one Stage is the final one. */
export const STAGING_MIN_COMBINATIONS = 4;

/** The top of the field by mean that a Cull always keeps. */
export const CULL_KEEP_TOP = 10;

/** The Cull band, in combined standard errors: 2 is a 95% interval. */
export const CULL_SIGMAS = 2;

/**
 * Upper bound on iterations per pass, so a `target_error` that never comes still ends.
 * Unmeasured default; not yet calibrated against real Sims.
 */
export const ITERATIONS_CEILING = 50_000;

/**
 * Profilesets SimC works on at once; the rest of its threads share each one's iterations.
 * Unmeasured default; not yet calibrated against real Sims.
 */
export const PROFILESET_WORK_THREADS = 2;

/** `target_error` (percent of DPS) of every Stage before the last, per precision preset. */
const LADDER: Readonly<Record<Precision, readonly number[]>> = {
  low: [1],
  medium: [1, 0.3],
  high: [1, 0.3],
};

/**
 * The `target_error` of each Stage, coarsest first. The last is the precision the user picked
 * (Low 1 → 0.5, Medium 1 → 0.3 → 0.2, High 1 → 0.3 → 0.1); with `STAGING_MIN_COMBINATIONS` or
 * fewer Combinations there is only that one.
 */
export function stageLadder(precision: Precision, combinations: number): number[] {
  const final = PRECISION_TARGET_ERROR[precision];
  if (combinations <= STAGING_MIN_COMBINATIONS) return [final];
  return [...LADDER[precision], final];
}

/** A Combination's outcome in a Stage; `error` is in DPS, like `mean`. */
export type CullEntry = { id: number; isBaseline: boolean; mean: number; error: number };

/**
 * Splits a Stage's field into who goes on and who is Culled. `x` is Culled when
 * `best − x ≥ 2·√(err_x² + err_best²)` (both are 95% half-widths), unless it is in the top
 * `CULL_KEEP_TOP` by mean. The baseline is never Culled. Order in, order out.
 */
export function cull(entries: readonly CullEntry[]): { kept: number[]; culled: number[] } {
  const ranked = [...entries].sort((a, b) => b.mean - a.mean || a.id - b.id);
  const best = ranked[0];
  const top = new Set(ranked.slice(0, CULL_KEEP_TOP).map((e) => e.id));
  const kept: number[] = [];
  const culled: number[] = [];
  for (const e of entries) {
    const inBand =
      best !== undefined && best.mean - e.mean < CULL_SIGMAS * Math.hypot(e.error, best.error);
    (e.isBaseline || top.has(e.id) || inBand ? kept : culled).push(e.id);
  }
  return { kept, culled };
}

/** Everything about an Import that turns a Combination back into SimC lines. */
export type ImportGear = {
  /** `ImportItem.index` to the item line after its `slot=`. */
  itemBodies: readonly string[];
  /** The `talents=` lines of the Talent Loadouts, by position. */
  loadouts: readonly string[];
  /** The `talents=` line the character has on. */
  equippedTalents: string | null;
  /** SimC slot to the index of the equipped item, for a baseline without its own gear map. */
  equipped: Readonly<Record<string, number>>;
};

const bodyOf = (rawLine: string) => rawLine.slice(rawLine.indexOf("=") + 1);

/** Reads the Import's item lines and talents. Indexes match `ImportItem.index`. */
export function readImportGear(addonString: string): ImportGear {
  const parsed = parseAddonString(addonString);
  const items = [...parsed.equippedItems, ...parsed.candidateItems];
  const equipped: Record<string, number> = {};
  parsed.equippedItems.forEach((item, index) => {
    equipped[normalizeSlot(item.slot)] = index;
  });
  return {
    itemBodies: items.map((i) => bodyOf(i.rawLine)),
    loadouts: parsed.talentLoadouts.map((l) => l.rawLine.trim()),
    equippedTalents: equippedTalentsLine(addonString),
    equipped,
  };
}

/** Name of the profileset for a Combination: its id. */
export const profilesetName = (combinationId: number) => String(combinationId);

/** Line that guards every profileset, so tier set bonuses are re-evaluated for its gear. */
export const SET_BONUS_GUARD = "profileset_controller.set_bonus_enabled=1";

const talentsOf = (def: CombinationDefinition, gear: ImportGear) =>
  def.talentLoadout === null
    ? gear.equippedTalents
    : (gear.loadouts[def.talentLoadout] ?? gear.equippedTalents);

const baselineGear = (baseline: CombinationDefinition, gear: ImportGear) =>
  Object.keys(baseline.gear).length > 0 ? baseline.gear : gear.equipped;

/**
 * The `profileset."<id>"+=` lines that turn the base actor (Combination 1) into `definition`:
 * only the slots whose item differs (an emptied slot is written as `slot=`), and the talents
 * when they differ.
 */
export function profilesetLines(
  combinationId: number,
  definition: CombinationDefinition,
  baseline: CombinationDefinition,
  gear: ImportGear,
): string[] {
  const name = profilesetName(combinationId);
  const prefix = `profileset."${name}"+=`;
  const lines = [`${prefix}${SET_BONUS_GUARD}`];
  const base = baselineGear(baseline, gear);
  const slots = [...new Set([...Object.keys(base), ...Object.keys(definition.gear)])].sort();
  for (const slot of slots) {
    const index = definition.gear[slot];
    if (index === base[slot]) continue;
    if (index === undefined) {
      lines.push(`${prefix}${slot}=`);
      continue;
    }
    const body = gear.itemBodies[index];
    if (body === undefined) {
      throw new Error(`Combination ${combinationId} wears item ${index}, which the Import lacks`);
    }
    lines.push(`${prefix}${slot}=${body}`);
  }
  const talents = talentsOf(definition, gear);
  if (talents !== null && talents !== talentsOf(baseline, gear)) lines.push(`${prefix}${talents}`);
  return lines;
}

export type StageInputPlan = {
  addonString: string;
  settings: SimSettings;
  /** `target_error` of this Stage, percent of DPS. */
  targetError: number;
  baseline: CombinationDefinition;
  /** The survivors that run as profilesets (never the baseline). */
  profilesets: readonly { id: number; definition: CombinationDefinition }[];
  /** The user's consumable set, written on the base actor so every Combination runs with it. */
  consumables?: ConsumableSet;
};

/** One option line per consumable the set gives, in key order. */
export function consumableLines(set: ConsumableSet | undefined): string[] {
  if (!set) return [];
  return CONSUMABLE_KEYS.flatMap((key) => (set[key] ? [`${key}=${set[key]}`] : []));
}

/**
 * The SimC input of one Stage: the Addon String as the base actor (Combination 1), the Sim
 * Settings, this Stage's `target_error` under an iterations ceiling, and one profileset per
 * survivor. A Stage with no profilesets is a Quick Sim's input unchanged.
 */
export function buildStageInput(plan: StageInputPlan): string {
  const consumables = consumableLines(plan.consumables);
  if (plan.profilesets.length === 0) {
    return buildInput(plan.addonString, plan.settings, {
      targetError: plan.targetError,
      extraLines: consumables,
    });
  }
  const gear = readImportGear(plan.addonString);
  const head = buildInput(plan.addonString, plan.settings, {
    targetError: plan.targetError,
    extraLines: [
      ...consumables,
      `iterations=${ITERATIONS_CEILING}`,
      `profileset_work_threads=${PROFILESET_WORK_THREADS}`,
    ],
  });
  const lines = plan.profilesets.flatMap((p) =>
    profilesetLines(p.id, p.definition, plan.baseline, gear),
  );
  return `${head}# Profilesets\n${lines.join("\n")}\n`;
}

export type StageReport = {
  baseline: DpsSummary;
  /** By Combination id. */
  profilesets: Map<number, DpsSummary>;
  /**
   * Iterations summed over the profilesets, what the time estimate learns from. Null when the
   * Stage ran none or one of them does not report its count.
   */
  iterations: number | null;
};

/**
 * Reads a Stage's json2 text (`null` when SimC wrote no file): the base actor's DPS and, for
 * each id in `expected`, its entry of `profilesets.results[]` matched by name. A missing
 * entry means that profileset failed. Throws `Json2FormatError`.
 */
export function readStageReport(text: string | null, expected: readonly number[]): StageReport {
  const { sim } = readJson2(text, stageJson2Schema);
  const baseline = baselineDps(sim).summary;
  const byName = new Map((sim.profilesets?.results ?? []).map((r) => [r.name, r]));
  const profilesets = new Map<number, DpsSummary>();
  let iterations: number | null = expected.length > 0 ? 0 : null;
  for (const id of expected) {
    const r = byName.get(profilesetName(id));
    if (!r) throw new Json2FormatError(`profileset "${id}" missing from the report`);
    profilesets.set(id, { mean: r.mean, meanError: r.mean_error });
    iterations =
      iterations !== null && r.iterations !== undefined ? iterations + r.iterations : null;
  }
  return { baseline, profilesets, iterations };
}

/** The Combination SimC refused in an exit-80 stderr (`Profileset '<id>'`), if it names one. */
export function invalidProfileset(stderr: string): number | null {
  const m = /Profileset '(\d+)'/.exec(stderr);
  return m?.[1] === undefined ? null : Number(m[1]);
}
