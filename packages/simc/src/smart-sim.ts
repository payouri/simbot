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
 * Kept at 50,000 because the benchmark shows it is never binding: no profileset of any benchmark
 * Sim ran at the ceiling. The most iterations one profileset ran: 401 at Low
 * (`apps/server/bench/results/2026-09-30T16-58-33-758Z.json`, two gear sets, up to 17,497
 * Combinations), 2,211 at Medium (`2026-09-30T15-23-13-858Z.json`), 4,451 at High
 * (`2026-09-30T12-44-04-817Z.json`, 0.1% target error) and 4,021 at High over 39,366
 * Combinations (`2026-09-30T17-49-31-838Z.json`). 50,000 is 11x headroom over the highest seen,
 * not a tuned value. One machine.
 */
export const ITERATIONS_CEILING = 50_000;

/**
 * Profilesets SimC works on at once; the rest of its threads share each one's iterations.
 * Measured: 1 is the fastest of 1, 2, 4, 8 and 16 on a 16-thread machine (AMD Ryzen 7 7735HS),
 * both times it was swept. At `analyze_error_interval=50`, SimC 1210-2026-09-30-613b5fb, Medium,
 * 3 repeats, two gear sets (the import-items fixture's Frost Death Knight and
 * `bench/sets/gulthrak-fury.txt`, 4, 8 and 12 items each): summed median wall time over the six
 * cases 138.6 s at 1, 160.8 s at 2, 199.4 s at 4, 300.3 s at 8, 682.3 s at 16
 * (`apps/server/bench/results/2026-09-30T15-23-13-858Z.json`). At interval 100, SimC
 * 1210-2026-09-29-d08a1c3, the Frost set alone: 94.8 s at 1, 103.2 s at 2, 121.8 s at 4, 166.2 s
 * at 8, 355.9 s at 16 (`2026-09-30T11-07-06-473Z.json`). Its Stage 1 is up to 972 short
 * profilesets, and a likely reason is that splitting one that short over threads costs more
 * than it gains; the benchmark does not measure why. At interval 5 (the same two sets and
 * cases): 123.9 s at 1, 152.9 s at 2, 185.0 s at 4 (`2026-09-30T18-59-57-173Z.json`). One
 * machine.
 */
export const PROFILESET_WORK_THREADS = 1;

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
  /** Expected ids with no entry in the report: those profilesets failed. */
  missing: number[];
};

/**
 * Reads a Stage's json2 text (`null` when SimC wrote no file): the base actor's DPS and, for
 * each id in `expected`, its entry of `profilesets.results[]` matched by name. A missing
 * entry means that profileset failed and its id lands in `missing`. Throws `Json2FormatError` when
 * the base actor, or the whole `profilesets` block while some are expected, is absent.
 */
export function readStageReport(text: string | null, expected: readonly number[]): StageReport {
  const { sim } = readJson2(text, stageJson2Schema);
  const baseline = baselineDps(sim).summary;
  if (expected.length > 0 && !sim.profilesets) {
    throw new Json2FormatError("the report has no profilesets block");
  }
  const byName = new Map((sim.profilesets?.results ?? []).map((r) => [r.name, r]));
  const profilesets = new Map<number, DpsSummary>();
  let iterations: number | null = expected.length > 0 ? 0 : null;
  const missing: number[] = [];
  for (const id of expected) {
    const r = byName.get(profilesetName(id));
    if (!r) {
      missing.push(id);
      continue;
    }
    profilesets.set(id, { mean: r.mean, meanError: r.mean_error });
    iterations =
      iterations !== null && r.iterations !== undefined ? iterations + r.iterations : null;
  }
  return { baseline, profilesets, iterations, missing };
}

/** The Combination SimC refused in an exit-80 stderr (`Profileset '<id>'`), if it names one. */
export function invalidProfileset(stderr: string): number | null {
  const m = /Profileset '(\d+)'/.exec(stderr);
  return m?.[1] === undefined ? null : Number(m[1]);
}
