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

/** SimC equipment slot names that can hold items. */
const EQUIPMENT_SLOTS = new Set([
  "head",
  "neck",
  "shoulder",
  "shoulders",
  "back",
  "chest",
  "wrists",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger",
  "finger1",
  "finger2",
  "trinket",
  "trinket1",
  "trinket2",
  "main_hand",
  "off_hand",
  "two_hand",
]);

/** Whether `key` is an equipment slot key of a SimC profile (`head`, `finger1`, `main_hand`...). */
export const isEquipmentSlot = (key: string) => EQUIPMENT_SLOTS.has(key);

/** Whether `key` is the class line that opens a character (`mage="Name"`). */
export const isClassKey = (key: string) => CLASS_KEYS.has(key);

/**
 * SimC options that write files, read files or reach the network. An Addon String is untrusted
 * text, so no line that sets one of them may reach SimC.
 */
const UNSAFE_OPTION =
  /^(html|xml|json\d*|json_.*|csv|save(_.*)?|output|log|debug_log|input|hosted_html|xml_style|armory|wowhead|bcp_api|apikey|.*_(output|file|path|dir)(_.*)?|.*_plot_output.*)$/;

/** Whether the line sets a file-writing, file-reading or network SimC option. */
export function isUnsafeOptionLine(line: string): boolean {
  return line.split(/\s+/).some((token) => {
    const eq = token.indexOf("=");
    if (eq < 1) return false;
    const key = token.slice(0, eq).replace(/[+-]$/, "").toLowerCase();
    return UNSAFE_OPTION.test(key);
  });
}

/** The Addon String without the lines that set an unsafe SimC option. */
export function stripUnsafeOptions(addonString: string): string {
  return addonString
    .split(/(?<=\r\n|\n|\r)/)
    .filter((line) => !isUnsafeOptionLine(line))
    .join("");
}

/**
 * The Addon String without the lines that set `ptr`. An export from the PTR client may carry
 * `ptr=1`; Game Data alone decides which data a Sim runs on, so a Live Sim never inherits it.
 */
export function stripPtrOption(addonString: string): string {
  return addonString
    .split(/(?<=\r\n|\n|\r)/)
    .filter((line) => !/(^|\s)ptr\s*=/i.test(line))
    .join("");
}

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

/** Compute Adler-32 checksum for addon string verification. */
export function adler32(text: string): string {
  let a = 1;
  let b = 0;
  const mod = 65521;

  for (const char of text) {
    a = (a + char.charCodeAt(0)) % mod;
    b = (b + a) % mod;
  }

  const result = ((b << 16) | a) >>> 0;
  return result.toString(16).padStart(8, "0");
}

export type EquippedItem = {
  slot: string;
  rawLine: string;
  source: "equipped";
};

export type CandidateItem = {
  slot: string;
  rawLine: string;
  source: "bags" | "great_vault" | "linked";
};

export type TalentLoadout = {
  comment: string | null;
  rawLine: string;
};

export type ParsedAddonString = {
  character: ProfileHeader;
  equippedItems: EquippedItem[];
  candidateItems: CandidateItem[];
  talentLoadouts: TalentLoadout[];
  additionalInfo: Record<string, string>;
  checksumVerification: { expected: string; matches: boolean } | null;
  report: {
    unknownFields: string[];
    missingChecksum: boolean;
  };
};

/**
 * Parses a full Addon String into its components: profile, equipped items, candidate items,
 * talent loadouts, and additional character info. Verifies the Adler-32 checksum.
 */
export function parseAddonString(text: string): ParsedAddonString {
  const header = parseProfileHeader(text);
  const lines = text.split(/\r?\n/);

  const equippedItems: EquippedItem[] = [];
  const candidateItems: CandidateItem[] = [];
  const talentLoadouts: TalentLoadout[] = [];
  const additionalInfo: Record<string, string> = {};
  const unknownFields = new Set<string>();
  let checksumVerification: { expected: string; matches: boolean } | null = null;
  let missingChecksum = true;
  let currentSection: string | null = null;
  let lastCommentLine: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle checksum line first
    if (line.includes("Checksum:")) {
      missingChecksum = false;
      const match = line.match(/Checksum:\s*([0-9a-f]+)/i);
      if (match) {
        const expectedChecksum = match[1].toLowerCase();
        // Remove checksum line and recalculate
        const textWithoutChecksum = text.slice(0, text.indexOf("# Checksum"));
        const computedChecksum = adler32(textWithoutChecksum.trimEnd());
        checksumVerification = {
          expected: expectedChecksum,
          matches: computedChecksum === expectedChecksum,
        };
      }
      continue;
    }

    // Check for section headers
    if (line.startsWith("###")) {
      currentSection = line.slice(3).trim().toLowerCase();
      lastCommentLine = null;
      continue;
    }

    // Handle comment lines
    if (line.startsWith("# ")) {
      const content = line.slice(2);

      // Check if it's a talent loadout name
      if (line.startsWith("# Saved Loadout:")) {
        lastCommentLine = content.slice("Saved Loadout:".length).trim();
        continue;
      }

      // Check if it's an equipment line in a section (comment starting with # <slot>=)
      const eq = content.indexOf("=");
      if (eq > 0) {
        const key = content.slice(0, eq).trim();
        const isEquipmentSlot = EQUIPMENT_SLOTS.has(key);

        if (isEquipmentSlot && currentSection) {
          const slotName = key;
          if (currentSection === "gear from bags") {
            candidateItems.push({
              slot: slotName,
              rawLine: content,
              source: "bags",
            });
          } else if (
            currentSection === "weekly reward choices" ||
            currentSection === "gear from great vault"
          ) {
            candidateItems.push({
              slot: slotName,
              rawLine: content,
              source: "great_vault",
            });
          } else if (currentSection === "linked gear") {
            candidateItems.push({
              slot: slotName,
              rawLine: content,
              source: "linked",
            });
          } else if (!currentSection.startsWith("end of ")) {
            unknownFields.add(`${currentSection}: ${key}`);
          }
        } else if (key === "talents") {
          // Talent loadouts can appear in any context
          talentLoadouts.push({
            comment: lastCommentLine,
            rawLine: content,
          });
          lastCommentLine = null;
        } else if (currentSection === "additional character info" && !isEquipmentSlot) {
          additionalInfo[key] = content.slice(eq + 1).trim();
        } else if (
          currentSection &&
          !isEquipmentSlot &&
          !["region", "realm", "server", "race", "level", "role", "professions"].includes(key)
        ) {
          unknownFields.add(key);
        }
      } else {
        // Plain comment text (not containing =)
        if (
          content &&
          !content.startsWith("Saved") &&
          !content.startsWith("Spare") &&
          currentSection !== "additional character info"
        ) {
          lastCommentLine = content;
        }
      }

      continue;
    }

    // Skip empty lines
    if (!line.trim()) {
      continue;
    }

    // Parse equipment lines (profile or item lines at top level)
    const eq = line.indexOf("=");
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    const isEquipmentSlot = EQUIPMENT_SLOTS.has(key);

    if (isEquipmentSlot && (!currentSection || currentSection === "character")) {
      equippedItems.push({
        slot: key,
        rawLine: line,
        source: "equipped",
      });
    }
  }

  // Also check for talent loadouts in the main profile section
  for (const line of lines) {
    if (line.startsWith("talents=") && !line.startsWith("# ")) {
      const talentString = line;
      // Look back to see if there's a comment naming this loadout
      const idx = lines.indexOf(line);
      let comment: string | null = null;
      if (idx > 0 && lines[idx - 1].startsWith("# Saved Loadout:")) {
        comment = lines[idx - 1].slice("# Saved Loadout:".length).trim();
      }
      if (!talentLoadouts.some((t) => t.rawLine === talentString)) {
        talentLoadouts.push({
          comment,
          rawLine: talentString,
        });
      }
    }
  }

  return {
    character: header,
    equippedItems,
    candidateItems,
    talentLoadouts,
    additionalInfo,
    checksumVerification,
    report: {
      unknownFields: Array.from(unknownFields),
      missingChecksum,
    },
  };
}

/** SimC options that describe consumables in a profile. */
const CONSUMABLE_KEYS = ["flask", "food", "potion", "augmentation", "temporary_enchant"];

/**
 * The consumables a profile has on: the `flask=`, `food=`, `potion=`, `augmentation=` and
 * `temporary_enchant=` lines outside comments. A value of `disabled` or an empty one is dropped.
 */
export function parseConsumables(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = unquote(line.slice(eq + 1));
    if (CONSUMABLE_KEYS.includes(key) && value !== "" && value !== "disabled") {
      found[key] ??= value;
    }
  }
  return found;
}

/** The `talents=` line the character has on (the profile's, not a saved loadout's comment). */
export function equippedTalentsLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("talents=")) return line.trim();
  }
  return null;
}
