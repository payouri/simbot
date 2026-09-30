import {
  type CombinationDefinition,
  type CombinationIssue,
  type CombinationPreview,
  type ImportItem,
  type ImportItemsResponse,
  MAX_COMBINATIONS,
  PAPERDOLL_LABEL,
  paperdollSlotOf,
  type Sim,
  type SimcBuild,
  type SimSettings,
  type TopGearSelection,
} from "@simbot/shared";
import {
  type Combination,
  type CostModel,
  costModelFromCheckSim,
  costModelFromStages,
  DEFAULT_COST_MODEL,
  estimateSeconds,
  type GearItem,
  type GenerateInput,
  type GenerateResult,
  generateCombinations,
  type ItemMeta,
  isSoftWarning,
  parseItemLine,
  preselect,
  weaponRulesFor,
} from "@simbot/simc";
import type { Db } from "./db";
import { equippedLoadoutIndex, getParsedImport } from "./db/imports";
import { getCheckSimCost } from "./db/simc-jobs";
import { lastTopGearStageCosts } from "./db/sims";

/** What the service needs of the item indexer. */
export type ItemsSource = {
  view: (importId: number) => Promise<ImportItemsResponse | null>;
  meta: (tag: string) => Promise<ItemMeta | null>;
};

export type CombinationServiceDeps = {
  db: Db;
  items: ItemsSource;
  currentBuild: () => Promise<SimcBuild | null>;
};

/** A frozen Combination row: what `queueSim` stores. */
export type FrozenCombination = { isBaseline: boolean; definition: CombinationDefinition };

export type FreezeResult =
  | { ok: true; simcTag: string | null; combinations: FrozenCombination[] }
  | { ok: false; refused: boolean; issues: CombinationIssue[] };

type Prepared = {
  input: GenerateInput;
  view: ImportItemsResponse;
  issues: CombinationIssue[];
};

const nameOf = (item: ImportItem) => item.name ?? `item ${item.itemId ?? "?"}`;

/**
 * Checks a Top Gear Selection against the Sim's Import: every included item must be a
 * selectable Candidate Item (not equipped, not an Unknown Item, read by SimC) and every Talent
 * Loadout must exist. One issue per offender.
 */
export function selectionIssues(
  view: ImportItemsResponse | null,
  loadoutCount: number,
  selection: Pick<TopGearSelection, "included" | "talentLoadouts">,
): CombinationIssue[] {
  const issues: CombinationIssue[] = [];
  const byIndex = new Map((view?.items ?? []).map((i) => [i.index, i]));
  selection.included.forEach((index, at) => {
    const item = byIndex.get(index);
    const why = !item
      ? "is not an item of this Import"
      : item.selectable
        ? null
        : item.status === "unknown"
          ? "is an Unknown Item and cannot be selected"
          : item.source === "equipped"
            ? "is equipped, not a Candidate Item"
            : "was not read by SimC and cannot be selected";
    if (why) {
      issues.push({
        path: `topGearSelection.included.${at}`,
        candidate: index,
        message: `Item ${index} ${why}.`,
      });
    }
  });
  selection.talentLoadouts.forEach((index, at) => {
    if (index >= loadoutCount) {
      issues.push({
        path: `topGearSelection.talentLoadouts.${at}`,
        candidate: null,
        message: `Talent Loadout ${index} does not exist.`,
      });
    }
  });
  return issues;
}

/** Why an included Candidate Item can be in no Combination, as well as we can tell. */
function unusedReason(item: ImportItem, hand: string | undefined): string {
  if (hand === "1h" || hand === "main") {
    return "is a one-handed weapon and no off hand can go with it";
  }
  if (hand === "off" || hand === "shield" || hand === "held") {
    return "is an off-hand item and no one-handed weapon can go with it";
  }
  if (item.source === "great_vault") return "is a Great Vault item that no Combination can hold";
  return "breaks a rule (unique-equipped, item limit, tier minimum or budget) in every Combination";
}

export function createCombinationService(deps: CombinationServiceDeps) {
  const { db } = deps;

  /** The engine's input for a Sim's setup, and every problem that stops the setup outright. */
  async function prepare(sim: Sim, selection: TopGearSelection): Promise<Prepared | null> {
    const view = await deps.items.view(sim.importId);
    if (!view) return null;
    const meta = view.simcTag ? await deps.items.meta(view.simcTag) : null;
    const loadouts = getParsedImport(db, sim.importId)?.talentLoadouts.length ?? 0;
    const issues = selectionIssues(view, loadouts, selection);

    const gear: GearItem[] = [];
    for (const item of view.items) {
      if (!paperdollSlotOf(item.slot)) continue;
      if (item.source !== "equipped" && !item.selectable) continue;
      const line = parseItemLine(item.rawLine);
      const mi = item.itemId !== null ? meta?.items[item.itemId] : undefined;
      const bonuses = item.bonusIds.map((id) => meta?.bonuses[id]);
      const gems = line.attrs
        .filter(([k]) => k === "gem_id")
        .flatMap(([, v]) => v.split(/[/:]/).map(Number))
        .filter((n) => Number.isInteger(n) && n > 0);
      // A socketed gem with a limit category (e.g. one Thalassian Diamond) counts the item too.
      const categories = [
        mi?.limitCategory,
        ...bonuses.map((b) => b?.limitCategory),
        ...gems.map((g) => meta?.gems?.[g]?.limitCategory),
      ].filter((c): c is number => c !== undefined);
      gear.push({
        index: item.index,
        slot: item.slot,
        source: item.source,
        itemId: item.itemId,
        // The item as SimC reads it: without the slot or the name, which do not tell items apart.
        signature: item.rawLine.slice(item.rawLine.indexOf(",") + 1),
        ilvl: item.ilvl,
        hand: mi?.hand,
        uniqueEquipped: mi?.uniqueEquipped,
        onUse: mi?.onUse === true || bonuses.some((b) => b?.onUse === true),
        limitCategories: categories,
        gemIds: gems,
        setId: mi?.setId,
      });
    }
    const categoryLimits = new Map(
      Object.entries(meta?.limitCategories ?? {}).map(([id, c]) => [Number(id), c.quantity]),
    );
    const input: GenerateInput = {
      items: gear,
      included: selection.included,
      lockedSlots: selection.lockedSlots,
      talentLoadouts: selection.talentLoadouts,
      equippedLoadout: equippedLoadoutIndex(db, sim.importId),
      categoryLimits,
      uniqueGems: new Set(
        Object.entries(meta?.gems ?? {})
          .filter(([, g]) => g.uniqueEquipped)
          .map(([id]) => Number(id)),
      ),
      weapons: weaponRulesFor(sim.character.class, sim.character.spec),
      minTierPieces: selection.minTierPieces,
      catalystCharges: selection.catalystCharges,
      upgradeBudget: selection.upgradeBudget,
    };
    return { input, view, issues };
  }

  const unusedIssues = (
    p: Prepared,
    selection: TopGearSelection,
    unused: number[],
    meta: (index: number) => string | undefined,
  ): CombinationIssue[] =>
    unused.map((index) => {
      const item = p.view.items.find((i) => i.index === index);
      const at = selection.included.indexOf(index);
      const slot = item ? paperdollSlotOf(item.slot) : null;
      return {
        path: `topGearSelection.included.${at}`,
        candidate: index,
        message: item
          ? `${nameOf(item)}${slot ? ` (${PAPERDOLL_LABEL[slot]})` : ""} ${unusedReason(item, meta(index))}.`
          : `Item ${index} cannot be part of any Combination.`,
      };
    });

  const handOf = (p: Prepared) => (index: number) =>
    p.input.items.find((i) => i.index === index)?.hand;

  const overLimitIssue = (count: number, atLeast: boolean): CombinationIssue => ({
    path: "topGearSelection",
    candidate: null,
    message: `${atLeast ? "More than " : ""}${count.toLocaleString("en-US")} Combinations after pruning; the limit is ${MAX_COMBINATIONS.toLocaleString("en-US")}. Include fewer candidates or lock a slot.`,
  });

  /** Everything wrong with a generated setup: selection issues, the ceiling, unusable Candidates. */
  function problemsOf(p: Prepared, selection: TopGearSelection, gen: GenerateResult) {
    const refused = gen.count > MAX_COMBINATIONS || gen.atLeast;
    const issues = [...p.issues];
    if (refused) issues.push(overLimitIssue(gen.count, gen.atLeast));
    else issues.push(...unusedIssues(p, selection, gen.unusedCandidates, handOf(p)));
    return { refused, issues };
  }

  /**
   * The cost model of the Current SimC Build: learnt from its most recent finished Top Gear,
   * else seeded from its last Check Sim, else the default.
   */
  async function costModel(): Promise<{
    model: CostModel;
    basis: CombinationPreview["estimateBasis"];
  }> {
    const build = await deps.currentBuild();
    if (!build) return { model: DEFAULT_COST_MODEL, basis: "default" };
    const learnt = costModelFromStages(lastTopGearStageCosts(db, build.tag));
    if (learnt) return { model: learnt, basis: "finished_sims" };
    const cost = getCheckSimCost(db, build.tag);
    const measured = cost ? costModelFromCheckSim(cost) : null;
    if (measured) return { model: measured, basis: "check_sim" };
    return { model: DEFAULT_COST_MODEL, basis: "default" };
  }

  /** `POST /api/sims/:id/preview-combinations`: count, validation and the time estimate. */
  async function preview(
    sim: Sim,
    edits: { selection?: TopGearSelection; settings?: Partial<SimSettings> } = {},
  ): Promise<CombinationPreview | null> {
    const selection = edits.selection ?? sim.topGearSelection;
    if (!selection) return null;
    const settings = { ...sim.settings, ...edits.settings };
    const p = await prepare(sim, selection);
    if (!p) return null;
    const gen = generateCombinations(p.input);
    const { refused, issues } = problemsOf(p, selection, gen);
    const { model, basis } = await costModel();
    const seconds = refused
      ? null
      : estimateSeconds({
          combinations: gen.count,
          fightSeconds: settings.durationSeconds,
          precision: settings.precision,
          model,
        });
    return {
      count: gen.count,
      atLeast: gen.atLeast,
      gearCount: gen.gearCount,
      loadoutCount: gen.loadoutCount,
      estimateSeconds: seconds,
      estimateBasis: basis,
      softWarning: seconds !== null && isSoftWarning(seconds),
      refused,
      max: MAX_COMBINATIONS,
      issues,
    };
  }

  const toFrozen = (c: Combination): FrozenCombination => ({
    isBaseline: c.isBaseline,
    definition: {
      kind: c.isBaseline ? "equipped" : "gear",
      gear: c.gear,
      talentLoadout: c.talentLoadout,
    },
  });

  /**
   * Generates and validates the Combinations of a Sim's saved selection, to be frozen on it.
   * Fails with the per-Candidate issues (and `refused` above `MAX_COMBINATIONS`).
   */
  async function freeze(sim: Sim): Promise<FreezeResult> {
    const selection = sim.topGearSelection;
    if (!selection) return { ok: false, refused: false, issues: [] };
    const p = await prepare(sim, selection);
    if (!p) return { ok: false, refused: false, issues: [] };
    const gen = generateCombinations(p.input, { materialize: true });
    const { refused, issues } = problemsOf(p, selection, gen);
    if (issues.length > 0 || !gen.combinations) return { ok: false, refused, issues };
    return {
      ok: true,
      simcTag: p.view.simcTag,
      combinations: gen.combinations.map(toFrozen),
    };
  }

  /**
   * Checks a Sim's frozen Combinations against the Current SimC Build, which is not the one
   * they were generated on: every item they wear must still be read by it, and the setup must
   * still generate. Returns the problems, empty when it holds.
   */
  async function revalidate(
    sim: Sim,
    frozen: readonly CombinationDefinition[],
  ): Promise<CombinationIssue[]> {
    const selection = sim.topGearSelection;
    if (!selection) return [];
    const p = await prepare(sim, selection);
    if (!p) return [{ path: "import", candidate: null, message: "The Import is gone." }];
    const issues = [...p.issues];
    const readable = new Set(
      p.view.items.filter((i) => i.source === "equipped" || i.selectable).map((i) => i.index),
    );
    const worn = new Set(frozen.flatMap((d) => Object.values(d.gear)));
    for (const index of worn) {
      if (readable.has(index)) continue;
      issues.push({
        path: "topGearSelection.included",
        candidate: index,
        message: `Item ${index} is not readable by SimC Build ${p.view.simcTag ?? "(none)"}.`,
      });
    }
    return issues;
  }

  /** The default preselection for a Draft: likely upgrades by ilvl gain, vault first, within 500. */
  async function preselection(sim: Sim): Promise<number[] | null> {
    const selection = sim.topGearSelection;
    if (!selection) return null;
    const p = await prepare(sim, selection);
    if (!p) return null;
    const { included: _included, ...rest } = p.input;
    return preselect(rest);
  }

  return { preview, freeze, revalidate, preselection };
}

export type CombinationService = ReturnType<typeof createCombinationService>;
