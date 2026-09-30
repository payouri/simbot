import {
  type ImportItem,
  type PaperdollSlot,
  type Ranking,
  type ResultCombination,
  rankResults,
  redress,
  type SimResultsResponse,
  type SlotDress,
  type StageResult,
} from "@simbot/shared";
import { loadoutName } from "../setup/model";

/** Everything the results view looks up per row, built once per response. */
export type ResultsModel = {
  ranking: Ranking;
  byIndex: Map<number, ImportItem>;
  combinations: Map<number, ResultCombination>;
  stageResults: Map<number, StageResult[]>;
  baseline: ResultCombination | null;
  dress: (combinationId: number) => Record<PaperdollSlot, SlotDress> | null;
  /** The Talent Loadout a Combination plays, named the way the setup names it. */
  loadout: (combinationId: number) => string | null;
};

export function buildResultsModel(data: SimResultsResponse): ResultsModel {
  const byIndex = new Map(data.items.map((i) => [i.index, i]));
  const combinations = new Map(data.combinations.map((c) => [c.id, c]));
  const stageResults = new Map<number, StageResult[]>();
  for (const r of data.results) {
    const list = stageResults.get(r.combinationId);
    if (list) list.push(r);
    else stageResults.set(r.combinationId, [r]);
  }
  const baseline = data.combinations.find((c) => c.isBaseline) ?? null;
  const equippedLoadout = data.talentLoadouts.findIndex((l) => l.equipped);
  const cache = new Map<number, Record<PaperdollSlot, SlotDress>>();
  return {
    ranking: rankResults(data.results),
    byIndex,
    combinations,
    stageResults,
    baseline,
    dress(combinationId) {
      const cached = cache.get(combinationId);
      if (cached) return cached;
      const combo = combinations.get(combinationId);
      if (!combo || !baseline) return null;
      const out = redress(combo.gear, baseline.gear, byIndex);
      cache.set(combinationId, out);
      return out;
    },
    loadout(combinationId) {
      const combo = combinations.get(combinationId);
      if (!combo || data.talentLoadouts.length === 0) return null;
      const at = combo.talentLoadout ?? equippedLoadout;
      const l = data.talentLoadouts[at];
      return l ? loadoutName(l, at) : null;
    },
  };
}
