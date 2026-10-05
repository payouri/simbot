import type { ImportItem, ItemStats } from "@simbot/shared";

const QUALITY_VAR = [
  "--q-poor",
  "--q-common",
  "--q-uncommon",
  "--q-rare-text",
  "--q-epic-text",
  "--q-legendary",
  "--q-legendary",
  "--q-legendary",
];
const QUALITY_BORDER_VAR = [
  "--q-poor",
  "--q-common",
  "--q-uncommon",
  "--q-rare",
  "--q-epic",
  "--q-legendary",
  "--q-legendary",
  "--q-legendary",
];
export const qualityText = (q: number | null) => `var(${QUALITY_VAR[q ?? 1] ?? "--fg-muted"})`;
export const qualityBorder = (q: number | null) =>
  `var(${QUALITY_BORDER_VAR[q ?? 1] ?? "--line-strong"})`;

const STAT_LABEL: Record<string, string> = {
  strint: "Str/Int",
  stragi: "Str/Agi",
  stragiint: "Primary",
  strength: "Str",
  agility: "Agi",
  intellect: "Int",
  stamina: "Sta",
  crit_rating: "Crit",
  haste_rating: "Haste",
  mastery_rating: "Mastery",
  versatility_rating: "Vers",
  avoidance_rating: "Avoid",
  leech_rating: "Leech",
  speed_rating: "Speed",
  parry_rating: "Parry",
  dodge_rating: "Dodge",
  armor: "Armor",
};
/** Stat lines of an item: secondaries and primaries, stamina last. */
const STAT_ORDER = ["strint", "stragi", "stragiint", "strength", "agility", "intellect"];
export const statLabel = (key: string) =>
  STAT_LABEL[key] ?? key.replace(/_rating$/, "").replaceAll("_", " ");

export function statLine(stats: ItemStats): { key: string; value: number }[] {
  return Object.entries(stats)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => {
      const rank = (k: string) => (STAT_ORDER.includes(k) ? 0 : k === "stamina" ? 2 : 1);
      return rank(a.key) - rank(b.key) || b.value - a.value;
    });
}

/** What to call an item: its name, else a stand-in built from what the Addon String says. */
export function itemName(item: ImportItem): string {
  if (item.name) return item.name;
  return item.itemId === null ? "Unknown item" : `Item ${item.itemId}`;
}
