/** SimC's class keys: the profile line that opens a character (`deathknight="Name"`). */
const CLASS_KEYS = new Set([
  "deathknight",
  "demonhunter",
  "druid",
  "evoker",
  "hunter",
  "mage",
  "monk",
  "paladin",
  "priest",
  "rogue",
  "shaman",
  "warlock",
  "warrior",
]);

export type ProfileHeader = {
  region: string;
  realm: string;
  name: string;
  class: string;
  spec: string | null;
  race: string | null;
  level: number | null;
};

export class AddonStringError extends Error {
  constructor(detail: string) {
    super(`Not an Addon String: ${detail}`);
    this.name = "AddonStringError";
  }
}

const unquote = (value: string) => value.trim().replace(/^"(.*)"$/, "$1");

/**
 * Reads the character identity from an Addon String's profile header: the class line, then
 * `region=`, `server=` and, when present, `spec=`, `race=` and `level=`. Comment lines (bags,
 * saved loadouts) are ignored. Region and realm are lower-cased so a Character matches
 * however the addon cased them; the name keeps its case.
 */
export function parseProfileHeader(text: string): ProfileHeader {
  let name: string | null = null;
  let klass: string | null = null;
  const seen: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = unquote(line.slice(eq + 1));
    if (CLASS_KEYS.has(key)) {
      if (klass === null) {
        klass = key;
        name = value;
      }
    } else if (["region", "server", "spec", "race", "level"].includes(key)) {
      seen[key] ??= value;
    }
  }
  if (klass === null || !name) throw new AddonStringError('no character line (e.g. mage="Name")');
  if (!seen.region) throw new AddonStringError("no region= line");
  if (!seen.server) throw new AddonStringError("no server= line");
  const level = Number(seen.level);
  return {
    region: seen.region.toLowerCase(),
    realm: seen.server.toLowerCase(),
    name,
    class: klass,
    spec: seen.spec ?? null,
    race: seen.race ?? null,
    level: Number.isInteger(level) && level > 0 ? level : null,
  };
}
