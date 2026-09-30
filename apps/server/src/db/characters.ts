import type { Character, CharacterListItem, Sim, UpdateCharacterRequest } from "@simbot/shared";
import type { Db } from ".";
import { getSim } from "./sims";

type CharacterRow = { id: number; region: string; realm: string; name: string; class: string };

const toCharacter = (row: CharacterRow): Character => ({
  id: row.id,
  region: row.region,
  realm: row.realm,
  name: row.name,
  class: row.class,
});

export function getCharacter(db: Db, id: number): Character | null {
  const row = db
    .query<CharacterRow, [number]>(
      "SELECT id, region, realm, name, class FROM characters WHERE id = ?",
    )
    .get(id);
  return row ? toCharacter(row) : null;
}

export function listCharacters(db: Db): CharacterListItem[] {
  return db
    .query<CharacterRow & { import_count: number; sim_count: number }, []>(
      `SELECT c.id, c.region, c.realm, c.name, c.class,
         (SELECT COUNT(*) FROM imports i WHERE i.character_id = c.id) AS import_count,
         (SELECT COUNT(*) FROM sims s WHERE s.character_id = c.id) AS sim_count
       FROM characters c ORDER BY c.name COLLATE NOCASE, c.id`,
    )
    .all()
    .map((row) => ({
      ...toCharacter(row),
      importCount: row.import_count,
      simCount: row.sim_count,
    }));
}

export type UpdateCharacterResult =
  | { ok: true; character: Character }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; conflicting: Character };

/**
 * Edits a Character's identity. Region and realm are lower-cased, as on Import. An edit that
 * lands on another Character's identity changes nothing and reports that Character so the
 * caller can offer a merge. Sims keep their frozen Character Snapshot.
 */
export function updateCharacter(
  db: Db,
  id: number,
  patch: UpdateCharacterRequest,
): UpdateCharacterResult {
  return db.transaction((): UpdateCharacterResult => {
    const current = getCharacter(db, id);
    if (!current) return { ok: false, reason: "not_found" };
    const next: Character = {
      ...current,
      region: patch.region?.toLowerCase() ?? current.region,
      realm: patch.realm?.toLowerCase() ?? current.realm,
      name: patch.name ?? current.name,
      class: patch.class ?? current.class,
    };
    const clash = db
      .query<CharacterRow, [string, string, string, string, number]>(
        `SELECT id, region, realm, name, class FROM characters
         WHERE region = ? AND realm = ? AND name = ? AND class = ? AND id != ?`,
      )
      .get(next.region, next.realm, next.name, next.class, id);
    if (clash) return { ok: false, reason: "conflict", conflicting: toCharacter(clash) };
    db.run("UPDATE characters SET region = ?, realm = ?, name = ?, class = ? WHERE id = ?", [
      next.region,
      next.realm,
      next.name,
      next.class,
      id,
    ]);
    return { ok: true, character: next };
  })();
}

export type MergeCharacterResult =
  | { ok: true; character: Character }
  | { ok: false; reason: "not_found" | "same_character" };

/**
 * Moves every Import and Sim of `sourceId` onto `targetId`, then deletes the source. An Import
 * whose text the target already holds is folded into that one (its Sims and Check Sim results
 * follow). Character Snapshots are never touched.
 */
export function mergeCharacters(db: Db, sourceId: number, targetId: number): MergeCharacterResult {
  if (sourceId === targetId) return { ok: false, reason: "same_character" };
  return db.transaction((): MergeCharacterResult => {
    const source = getCharacter(db, sourceId);
    const target = getCharacter(db, targetId);
    if (!source || !target) return { ok: false, reason: "not_found" };

    const dupes = db
      .query<{ from_id: number; to_id: number }, [number, number]>(
        `SELECT s.id AS from_id, t.id AS to_id FROM imports s
         JOIN imports t ON t.checksum = s.checksum AND t.character_id = ?
         WHERE s.character_id = ?`,
      )
      .all(targetId, sourceId);
    for (const { from_id, to_id } of dupes) {
      db.run("UPDATE sims SET import_id = ? WHERE import_id = ?", [to_id, from_id]);
      db.run("UPDATE OR IGNORE check_sim_results SET import_id = ? WHERE import_id = ?", [
        to_id,
        from_id,
      ]);
      db.run("DELETE FROM check_sim_results WHERE import_id = ?", [from_id]);
      db.run("DELETE FROM imports WHERE id = ?", [from_id]);
    }
    db.run("UPDATE imports SET character_id = ? WHERE character_id = ?", [targetId, sourceId]);
    db.run("UPDATE sims SET character_id = ? WHERE character_id = ?", [targetId, sourceId]);
    db.run("DELETE FROM characters WHERE id = ?", [sourceId]);
    return { ok: true, character: target };
  })();
}

export type MoveSimResult =
  | { ok: true; sim: Sim }
  | { ok: false; reason: "sim_not_found" | "character_not_found" };

/** Points a Sim at another Character. Its Character Snapshot stays as frozen. */
export function moveSim(db: Db, simId: number, characterId: number): MoveSimResult {
  if (!getSim(db, simId)) return { ok: false, reason: "sim_not_found" };
  if (!getCharacter(db, characterId)) return { ok: false, reason: "character_not_found" };
  db.run("UPDATE sims SET character_id = ? WHERE id = ?", [characterId, simId]);
  const sim = getSim(db, simId);
  if (!sim) return { ok: false, reason: "sim_not_found" };
  return { ok: true, sim };
}
