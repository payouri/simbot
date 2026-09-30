import { createHash } from "node:crypto";
import { type Import, type ItemIndex, itemIndexSchema } from "@simbot/shared";
import { parseAddonString, parseProfileHeader } from "@simbot/simc";
import type { Db } from ".";

type ImportRow = {
  id: number;
  character_id: number;
  checksum: string;
  created_at: string;
  region: string;
  realm: string;
  name: string;
  class: string;
};

const IMPORT_SELECT = `
  SELECT i.id, i.character_id, i.checksum, i.created_at, c.region, c.realm, c.name, c.class
  FROM imports i JOIN characters c ON c.id = i.character_id`;

const toImport = (row: ImportRow): Import => ({
  id: row.id,
  characterId: row.character_id,
  character: {
    id: row.character_id,
    region: row.region,
    realm: row.realm,
    name: row.name,
    class: row.class,
  },
  checksum: row.checksum,
  createdAt: row.created_at,
});

export const checksumOf = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Stores an Addon String as an Import, matching (or creating) its Character on region, realm,
 * name and class. Pasting the same text for the same Character again returns the existing
 * Import. Throws `AddonStringError` when the text has no character header.
 */
export function createImport(db: Db, text: string): { import: Import; created: boolean } {
  const header = parseProfileHeader(text);
  const checksum = checksumOf(text);
  return db.transaction(() => {
    const now = new Date().toISOString();
    db.run(
      "INSERT OR IGNORE INTO characters (region, realm, name, class, created_at) VALUES (?, ?, ?, ?, ?)",
      [header.region, header.realm, header.name, header.class, now],
    );
    const character = db
      .query<{ id: number }, [string, string, string, string]>(
        "SELECT id FROM characters WHERE region = ? AND realm = ? AND name = ? AND class = ?",
      )
      .get(header.region, header.realm, header.name, header.class);
    if (!character) throw new Error("character upsert failed");
    const result = db.run(
      "INSERT OR IGNORE INTO imports (character_id, raw_text, checksum, created_at) VALUES (?, ?, ?, ?)",
      [character.id, text, checksum, now],
    );
    const row = db
      .query<ImportRow, [number, string]>(
        `${IMPORT_SELECT} WHERE i.character_id = ? AND i.checksum = ?`,
      )
      .get(character.id, checksum);
    if (!row) throw new Error("import insert failed");
    return { import: toImport(row), created: result.changes > 0 };
  })();
}

export function getImport(db: Db, id: number): Import | null {
  const row = db.query<ImportRow, [number]>(`${IMPORT_SELECT} WHERE i.id = ?`).get(id);
  return row ? toImport(row) : null;
}

/** The raw Addon String exactly as it was received. */
export function getImportText(db: Db, id: number): string | null {
  return (
    db.query<{ raw_text: string }, [number]>("SELECT raw_text FROM imports WHERE id = ?").get(id)
      ?.raw_text ?? null
  );
}

/**
 * Parse the Addon String of an import and return the parsed data with verification results.
 * Returns null if the import doesn't exist.
 */
export function getParsedImport(db: Db, id: number) {
  const text = getImportText(db, id);
  if (!text) return null;

  const parsed = parseAddonString(text);
  return {
    character: parsed.character,
    equippedItems: parsed.equippedItems,
    candidateItems: parsed.candidateItems,
    talentLoadouts: parsed.talentLoadouts,
    additionalInfo: parsed.additionalInfo,
    checksumVerification: parsed.checksumVerification,
    report: parsed.report,
  };
}

/** The stored item index of an Import, or null when none was stored (or it no longer parses). */
export function getItemIndex(db: Db, id: number): ItemIndex | null {
  const raw = db
    .query<{ item_index: string | null }, [number]>("SELECT item_index FROM imports WHERE id = ?")
    .get(id)?.item_index;
  if (!raw) return null;
  try {
    const parsed = itemIndexSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveItemIndex(db: Db, id: number, index: ItemIndex): void {
  db.run("UPDATE imports SET item_index = ? WHERE id = ?", [JSON.stringify(index), id]);
}
