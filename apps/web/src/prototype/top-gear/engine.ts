// PROTOTYPE engine. Mimics what the API would do with a Top Gear Selection:
// count and generate Combinations, run 3 staged sims with an error-band cull,
// and say plainly what the result means. Numbers are synthetic but consistent.

import { BASELINE_DPS, ITEMS, PRECISIONS, SLOTS, TIER_SET, type Item, type SlotId } from "./data";

export const COMBINATION_CAP = 10_000;
/** Below this, skip staging and run a single stage at final precision. */
export const MIN_FOR_STAGING = 24;
export type PrecisionId = (typeof PRECISIONS)[number]["id"];
export type Scenario = "upgrade" | "equipped" | "noise";

export interface Settings {
  fightStyle: string;
  duration: number;
  targets: number;
  precision: PrecisionId;
  rawOptions: string;
  talentLoadouts: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  fightStyle: "Patchwerk",
  duration: 300,
  targets: 1,
  precision: "medium",
  rawOptions: "",
  talentLoadouts: ["raid"],
};

export type Selection = Record<string, boolean>;

export const equippedIn = (slot: SlotId) =>
  ITEMS.filter((i) => i.slot === slot && i.source === "equipped").sort(
    (a, b) => (a.equippedIndex ?? 0) - (b.equippedIndex ?? 0),
  );
export const candidatesIn = (slot: SlotId, includeUnusable = false) =>
  ITEMS.filter((i) => i.slot === slot && i.source !== "equipped" && (includeUnusable || i.usable));
export const unusableIn = (slot: SlotId) => ITEMS.filter((i) => i.slot === slot && !i.usable);

/**
 * Preselection is budgeted. Selecting every ilvl upgrade (or a "≥ equipped − 6" window)
 * lands at 190k–290k combinations, far past the cap, so likely upgrades are added
 * in order of ilvl gain (vault first) while the count stays under the budget.
 */
export const PRESELECT_BUDGET = 500;

export function preselect(): Selection {
  const ranked = SLOTS.flatMap((slot) => {
    const top = Math.max(...equippedIn(slot.id).map((e) => e.ilvl));
    return candidatesIn(slot.id)
      .filter((c) => !c.oneHand && (c.source === "vault" || c.ilvl > top))
      .map((c) => ({ c, gain: (c.source === "vault" ? 100 : 0) + c.ilvl - top }));
  }).sort((a, b) => b.gain - a.gain);
  const sel: Selection = {};
  for (const { c } of ranked) {
    sel[c.uid] = true;
    if (countCombinations(sel) > PRESELECT_BUDGET) sel[c.uid] = false;
  }
  return sel;
}

export const selectAll = (): Selection =>
  Object.fromEntries(ITEMS.filter((i) => i.usable && i.source !== "equipped").map((i) => [i.uid, true]));
export const selectNone = (): Selection => ({});

export const pool = (slot: SlotId, sel: Selection) => [
  ...equippedIn(slot),
  ...candidatesIn(slot).filter((c) => sel[c.uid]),
];

type Option = Item[];

function slotOptions(slot: SlotId, sel: Selection): Option[] {
  const items = pool(slot, sel);
  const def = SLOTS.find((s) => s.id === slot)!;
  if (!def.paired) return items.map((i) => [i]);
  const out: Option[] = [];
  for (let a = 0; a < items.length; a++)
    for (let b = a + 1; b < items.length; b++) {
      const x = items[a], y = items[b];
      if (x.itemId === y.itemId && (x.unique || y.unique)) continue;
      out.push([x, y]);
    }
  return out;
}

const vaultCount = (o: Option) => o.filter((i) => i.source === "vault").length;

/** Exact count with the one-vault-item rule, via DP over slots. */
export function countCombinations(sel: Selection, loadouts = 1): number {
  let dp = [1, 0]; // ways with 0 / 1 vault items so far
  for (const slot of SLOTS) {
    const opts = slotOptions(slot.id, sel);
    const byVault = [0, 0, 0];
    for (const o of opts) byVault[Math.min(vaultCount(o), 2)]++;
    dp = [dp[0] * byVault[0], dp[0] * byVault[1] + dp[1] * byVault[0]];
  }
  return (dp[0] + dp[1]) * Math.max(1, loadouts);
}

/** Which slots multiply the count the most (for the over-cap hint). */
export function heaviestSlots(sel: Selection) {
  return SLOTS.map((s) => ({ slot: s, options: slotOptions(s.id, sel).length }))
    .filter((x) => x.options > 1)
    .sort((a, b) => b.options - a.options)
    .slice(0, 3);
}

export interface SlotIssue {
  slot: SlotId;
  message: string;
}

export function validate(sel: Selection): SlotIssue[] {
  const issues: SlotIssue[] = [];
  const mh = pool("main_hand", sel);
  if (mh.some((i) => i.oneHand))
    issues.push({
      slot: "main_hand",
      message: "Pilgrim's Hammer is one-handed and there is no off hand in your bags, so no valid combination can use it.",
    });
  return issues;
}

export interface Change {
  slot: SlotId;
  from: Item[];
  to: Item[];
}

export interface Combination {
  id: number;
  isBaseline: boolean;
  loadout: string;
  gear: Record<SlotId, Item[]>;
  changes: Change[];
  trueDps: number;
}

function tierBonus(gear: Record<SlotId, Item[]>) {
  const n = Object.values(gear).flat().filter((i) => i.tier).length;
  return (n >= 2 ? TIER_SET.twoPiece : 0) + (n >= 4 ? TIER_SET.fourPiece : 0);
}

function hash(n: number) {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
/** deterministic standard normal */
function gauss(seed: number) {
  const u = Math.max(hash(seed), 1e-9), v = hash(seed * 7 + 3);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function generateCombinations(sel: Selection, settings: Settings, limit = COMBINATION_CAP): Combination[] {
  const baselineGear = Object.fromEntries(SLOTS.map((s) => [s.id, equippedIn(s.id)])) as Record<SlotId, Item[]>;
  const baseTier = tierBonus(baselineGear);
  const perSlot = SLOTS.map((s) => slotOptions(s.id, sel).filter((o) => !o.some((i) => i.oneHand)));
  const loadouts = settings.talentLoadouts.length ? settings.talentLoadouts : ["raid"];
  const out: Combination[] = [];
  const cur: Option[] = [];

  const walk = (depth: number, vault: number) => {
    if (out.length >= limit) return;
    if (depth === SLOTS.length) {
      for (const loadout of loadouts) {
        const gear = Object.fromEntries(SLOTS.map((s, i) => [s.id, cur[i]])) as Record<SlotId, Item[]>;
        const changes: Change[] = [];
        let value = 0;
        SLOTS.forEach((s, i) => {
          const from = baselineGear[s.id];
          const to = cur[i];
          const same = from.length === to.length && from.every((f) => to.some((t) => t.uid === f.uid));
          if (!same) changes.push({ slot: s.id, from, to });
          value += to.reduce((a, t) => a + t.value, 0);
        });
        const id = out.length + 1;
        const loadoutDelta = loadout === "mplus" ? -1.6 : 0;
        const jitter = changes.length ? gauss(id * 13) * 0.06 : 0;
        const pct = value + tierBonus(gear) - baseTier + loadoutDelta + jitter;
        out.push({
          id,
          isBaseline: changes.length === 0 && loadout === loadouts[0],
          loadout,
          gear,
          changes,
          trueDps: BASELINE_DPS * (1 + pct / 100),
        });
      }
      return;
    }
    for (const o of perSlot[depth]) {
      const v = vault + vaultCount(o);
      if (v > 1) continue;
      cur[depth] = o;
      walk(depth + 1, v);
    }
  };
  walk(0, 0);
  // Combo 1 is always the equipped baseline
  const bi = out.findIndex((c) => c.isBaseline);
  if (bi > 0) out.unshift(...out.splice(bi, 1));
  out.forEach((c, i) => (c.id = i + 1));
  return out;
}

export interface StageStats {
  stage: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  /** 95% mean error, absolute DPS */
  error: number;
  iterations: number;
  survived: boolean;
}

export interface StagePlan {
  index: number;
  iterations: number;
  label: string;
}

const PRECISION_FACTOR: Record<PrecisionId, number> = { low: 0.35, medium: 1, high: 3 };

export function stagePlan(count: number, precision: PrecisionId): StagePlan[] {
  const f = PRECISION_FACTOR[precision];
  if (count < MIN_FOR_STAGING) return [{ index: 1, iterations: Math.round(6000 * f), label: "Final" }];
  return [
    { index: 1, iterations: Math.round(250 * f), label: "Scout" },
    { index: 2, iterations: Math.round(1500 * f), label: "Narrow" },
    { index: 3, iterations: Math.round(8000 * f), label: "Final" },
  ];
}

/** Iterations per second across 16 threads for this profile (synthetic). */
export const ITERATIONS_PER_SECOND = 9_000;

export function estimateSeconds(count: number, precision: PrecisionId) {
  const plan = stagePlan(count, precision);
  const survive = [1, 0.3, 0.1];
  return 4 + plan.reduce((a, s, i) => a + (count * survive[i] * s.iterations) / ITERATIONS_PER_SECOND, 0);
}

const SD_RATIO = 0.04;

function observe(c: Combination, stage: number, iterations: number): StageStats {
  const sd = c.trueDps * SD_RATIO;
  const error = (1.96 * sd) / Math.sqrt(iterations);
  const mean = c.trueDps + gauss(c.id * 31 + stage * 1009) * (error / 1.96);
  return {
    stage,
    mean,
    median: mean * (1 - 0.0021),
    min: mean * (1 - 0.11 - hash(c.id + stage) * 0.03),
    max: mean * (1 + 0.12 + hash(c.id * 3 + stage) * 0.04),
    stdDev: sd,
    error,
    iterations,
    survived: true,
  };
}

export interface Ranked {
  combo: Combination;
  stages: StageStats[];
  last: StageStats;
  delta: number;
  deltaPct: number;
  errorPct: number;
  withinNoiseOfBest: boolean;
  rank: number;
}

export interface StageOutcome {
  plan: StagePlan;
  entered: number;
  survivors: number;
}

export interface SimOutcome {
  ranked: Ranked[];
  stages: StageOutcome[];
  baseline: Ranked;
  partial: boolean;
}

/**
 * Run the staged sim. `stopAt` = { stage, fraction } simulates a stop part-way:
 * combinations are ranked at the last stage they finished.
 */
export function runStages(
  combos: Combination[],
  precision: PrecisionId,
  scenario: Scenario,
  stopAt?: { stage: number; fraction: number },
): SimOutcome {
  const shaped = applyScenario(combos, scenario);
  const plan = stagePlan(shaped.length, precision);
  const stats = new Map<number, StageStats[]>();
  let alive = shaped;
  const outcomes: StageOutcome[] = [];

  for (const p of plan) {
    if (stopAt && p.index > stopAt.stage) break;
    let entering = alive;
    if (stopAt && p.index === stopAt.stage) {
      const n = Math.floor(alive.length * stopAt.fraction);
      entering = [alive[0], ...alive.slice(1, Math.max(1, n))];
    }
    for (const c of entering) {
      const s = observe(c, p.index, p.iterations);
      stats.set(c.id, [...(stats.get(c.id) ?? []), s]);
    }
    const finishedStage = !stopAt || p.index < stopAt.stage;
    if (!finishedStage) {
      outcomes.push({ plan: p, entered: alive.length, survivors: 0 });
      break;
    }
    const last = (c: Combination) => stats.get(c.id)!.at(-1)!;
    const best = alive.reduce((b, c) => (last(c).mean > last(b).mean ? c : b), alive[0]);
    const isFinal = p.index === plan.at(-1)!.index;
    const next = isFinal
      ? alive
      : alive.filter((c) => {
          const x = last(c), b = last(best);
          const keep = c.isBaseline || b.mean - x.mean < Math.hypot(x.error, b.error);
          if (!keep) x.survived = false;
          return keep;
        });
    outcomes.push({ plan: p, entered: alive.length, survivors: next.length });
    alive = next;
  }

  const ranked = shaped
    .filter((c) => stats.has(c.id))
    .map((c) => {
      const st = stats.get(c.id)!;
      return { combo: c, stages: st, last: st.at(-1)! };
    });
  // deeper stage first, then mean: a stage-1 number never outranks a stage-3 one
  ranked.sort((a, b) => b.last.stage - a.last.stage || b.last.mean - a.last.mean);
  const baseRow = ranked.find((r) => r.combo.isBaseline)!;
  const top = ranked[0];
  const out: Ranked[] = ranked.map((r, i) => {
    const delta = r.last.mean - baseRow.last.mean;
    return {
      ...r,
      rank: i + 1,
      delta,
      deltaPct: (delta / baseRow.last.mean) * 100,
      errorPct: (Math.hypot(r.last.error, r.combo.isBaseline ? 0 : baseRow.last.error) / baseRow.last.mean) * 100,
      withinNoiseOfBest:
        r.last.stage === top.last.stage && top.last.mean - r.last.mean < Math.hypot(r.last.error, top.last.error),
    };
  });
  return { ranked: out, stages: outcomes, baseline: out.find((r) => r.combo.isBaseline)!, partial: !!stopAt };
}

function applyScenario(combos: Combination[], scenario: Scenario): Combination[] {
  const base = combos[0].trueDps;
  if (scenario === "upgrade") {
    // one clear leader, so the demo shows the plain upgrade verdict
    const lead = combos.reduce((b, c) => (c.trueDps > b.trueDps ? c : b), combos[0]);
    return combos.map((c) => (c.id === lead.id && !c.isBaseline ? { ...c, trueDps: c.trueDps + base * 0.0035 } : c));
  }
  if (scenario === "equipped")
    return combos.map((c) => (c.isBaseline ? c : { ...c, trueDps: base - Math.abs(c.trueDps - base) * 0.7 - base * 0.0012 }));
  // noise: the top four land within a hair of each other
  const sorted = [...combos].sort((a, b) => b.trueDps - a.trueDps);
  const lead = sorted.filter((c) => !c.isBaseline).slice(0, 4);
  const anchor = lead[0].trueDps;
  const ids = new Map(lead.map((c, i) => [c.id, anchor - base * 0.00012 * i]));
  return combos.map((c) => (ids.has(c.id) ? { ...c, trueDps: ids.get(c.id)! } : c));
}

export type VerdictKind = "upgrade" | "equipped" | "noise" | "partial";

export interface Verdict {
  kind: VerdictKind;
  headline: string;
  detail: string;
}

export function verdict(o: SimOutcome): Verdict {
  const top = o.ranked[0];
  const group = o.ranked.filter((r) => r.withinNoiseOfBest);
  const baseInGroup = group.some((r) => r.combo.isBaseline);
  const changes = top.combo.changes.length;
  const pct = `${top.deltaPct >= 0 ? "+" : ""}${top.deltaPct.toFixed(1)}%`;
  const err = `±${top.errorPct.toFixed(1)}`;
  if (o.partial) {
    return {
      kind: "partial",
      headline: top.combo.isBaseline ? "So far, your equipped set leads" : `So far, ${pct} (${err}) with ${changes} ${changes === 1 ? "change" : "changes"}`,
      detail: `Stopped during stage ${o.stages.at(-1)!.plan.index}. Rows are ranked by the deepest stage they finished, so treat the order as provisional.`,
    };
  }
  if (top.combo.isBaseline || baseInGroup)
    return {
      kind: "equipped",
      headline: "Your equipped set is best",
      detail: top.combo.isBaseline
        ? "Nothing in this selection beats what you are wearing."
        : `The best combination is ${pct}, which is inside the noise of your equipped set. Keep what you have.`,
    };
  if (group.length >= 2)
    return {
      kind: "noise",
      headline: `Top ${group.length} are within noise; pick by preference`,
      detail: `They all gain about ${pct} over equipped, and the sim cannot tell them apart at this precision.`,
    };
  return {
    kind: "upgrade",
    headline: `${pct} (${err}) with ${changes} ${changes === 1 ? "change" : "changes"}`,
    detail: `Beats your equipped set by ${Math.round(top.delta).toLocaleString("en-US")} DPS, clear of the noise.`,
  };
}
