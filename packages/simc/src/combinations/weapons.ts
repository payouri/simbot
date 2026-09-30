/**
 * The weapon rules of a class and spec: whether a one-hander may go in the off hand (dual
 * wield) and whether a two-hander may (Fury's Titan's Grip). Everything else wields one
 * two-hander alone, or a one-hander with a shield, off-hand or held item.
 */
export type WeaponRules = { dualWield: boolean; titansGrip: boolean };

const DUAL_WIELD_SPECS: Readonly<Record<string, readonly string[] | "all">> = {
  rogue: "all",
  demonhunter: "all",
  deathknight: ["frost"],
  monk: ["windwalker"],
  shaman: ["enhancement"],
  warrior: ["fury"],
};

export function weaponRulesFor(klass: string, spec: string | null): WeaponRules {
  const specs = DUAL_WIELD_SPECS[klass.toLowerCase()];
  const s = spec?.toLowerCase().replaceAll(" ", "_") ?? null;
  return {
    dualWield: specs === "all" || (specs !== undefined && s !== null && specs.includes(s)),
    titansGrip: klass.toLowerCase() === "warrior" && s === "fury",
  };
}
