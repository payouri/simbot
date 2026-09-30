import {
  type CharacterSnapshot,
  canTransition,
  characterSnapshotSchema,
  type DpsSummary,
  defaultSimSettings,
  type QueueEntry,
  type Sim,
  type SimError,
  type SimResultsResponse,
  type SimSettings,
  type SimStatus,
  simErrorSchema,
  simSettingsSchema,
} from "@simbot/shared";
import { parseProfileHeader } from "@simbot/simc";
import type { Db } from ".";
import { getImportText } from "./imports";

type SimRow = {
  id: number;
  kind: "quick";
  status: SimStatus;
  import_id: number;
  character_id: number;
  character_snapshot: string;
  settings: string;
  simc_tag: string | null;
  error: string | null;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

const toSim = (row: SimRow): Sim => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  importId: row.import_id,
  characterId: row.character_id,
  character: characterSnapshotSchema.parse(JSON.parse(row.character_snapshot)),
  settings: simSettingsSchema.parse(JSON.parse(row.settings)),
  simcTag: row.simc_tag,
  error: row.error ? simErrorSchema.parse(JSON.parse(row.error)) : null,
  createdAt: row.created_at,
  queuedAt: row.queued_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export function getSim(db: Db, id: number): Sim | null {
  const row = db.query<SimRow, [number]>("SELECT * FROM sims WHERE id = ?").get(id);
  return row ? toSim(row) : null;
}

/**
 * Creates a Quick Sim Draft from an Import. Omitted settings take the defaults; the merged
 * settings and the Character Snapshot are frozen on the Sim. Null when the Import is unknown.
 */
export function createSim(
  db: Db,
  input: { importId: number; settings?: Partial<SimSettings> },
): Sim | null {
  const imp = db
    .query<{ character_id: number }, [number]>("SELECT character_id FROM imports WHERE id = ?")
    .get(input.importId);
  const text = getImportText(db, input.importId);
  if (!imp || text === null) return null;
  const header = parseProfileHeader(text);
  const snapshot: CharacterSnapshot = {
    name: header.name,
    region: header.region,
    realm: header.realm,
    class: header.class,
    spec: header.spec,
    race: header.race,
    level: header.level,
  };
  const settings = simSettingsSchema.parse({ ...defaultSimSettings, ...input.settings });
  const result = db.run(
    `INSERT INTO sims (kind, status, import_id, character_id, character_snapshot, settings, created_at)
     VALUES ('quick', 'draft', ?, ?, ?, ?, ?)`,
    [
      input.importId,
      imp.character_id,
      JSON.stringify(snapshot),
      JSON.stringify(settings),
      new Date().toISOString(),
    ],
  );
  const sim = getSim(db, Number(result.lastInsertRowid));
  if (!sim) throw new Error("sim insert failed");
  return sim;
}

/**
 * Moves a Sim along its life cycle: only edges in `simTransitions` are allowed, and the row
 * must still be in `from` (so two writers can't both win). Returns whether it moved.
 */
function transition(
  db: Db,
  id: number,
  from: SimStatus,
  to: SimStatus,
  patch: Partial<Record<"simc_tag" | "error" | "queued_at" | "started_at" | "finished_at", string>>,
): boolean {
  if (!canTransition(from, to)) throw new Error(`illegal Sim transition ${from} -> ${to}`);
  const columns = Object.keys(patch);
  const sets = ["status = ?", ...columns.map((c) => `${c} = ?`)].join(", ");
  const result = db.run(`UPDATE sims SET ${sets} WHERE id = ? AND status = ?`, [
    to,
    ...Object.values(patch),
    id,
    from,
  ]);
  return result.changes > 0;
}

export type QueueResult =
  | { ok: true; sim: Sim; jobId: number }
  | { ok: false; reason: "not_found" | "invalid_transition" };

/**
 * `draft → queued`: freezes the Sim, creates its baseline Combination and appends a `sim` Job
 * to the FIFO, all in one transaction.
 */
export function queueSim(db: Db, id: number): QueueResult {
  return db.transaction((): QueueResult => {
    const current = getSim(db, id);
    if (!current) return { ok: false, reason: "not_found" };
    if (!canTransition(current.status, "queued"))
      return { ok: false, reason: "invalid_transition" };
    const now = new Date().toISOString();
    if (!transition(db, id, current.status, "queued", { queued_at: now })) {
      return { ok: false, reason: "invalid_transition" };
    }
    db.run("INSERT INTO combinations (sim_id, definition, is_baseline) VALUES (?, ?, 1)", [
      id,
      JSON.stringify({ kind: "equipped" }),
    ]);
    const job = db.run(
      "INSERT INTO jobs (kind, sim_id, status, created_at) VALUES ('sim', ?, 'queued', ?)",
      [id, now],
    );
    const sim = getSim(db, id);
    if (!sim) throw new Error("sim vanished");
    return { ok: true, sim, jobId: Number(job.lastInsertRowid) };
  })();
}

export type QueuedJob = { id: number; simId: number };

/** The oldest waiting Job: the Queue is strict FIFO. */
export function nextQueuedJob(db: Db): QueuedJob | null {
  const row = db
    .query<{ id: number; sim_id: number }, []>(
      "SELECT id, sim_id FROM jobs WHERE kind = 'sim' AND status = 'queued' ORDER BY id LIMIT 1",
    )
    .get();
  return row ? { id: row.id, simId: row.sim_id } : null;
}

/** `queued → running`, recording the SimC Build tag (null when there was none to resolve). */
export function startSim(db: Db, jobId: number, simId: number, simcTag: string | null): boolean {
  return db.transaction(() => {
    const now = new Date().toISOString();
    const patch: Record<string, string> = { started_at: now };
    if (simcTag) patch.simc_tag = simcTag;
    if (!transition(db, simId, "queued", "running", patch)) return false;
    db.run("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?", [now, jobId]);
    return true;
  })();
}

/** Closes a Job whose Sim can no longer run it (gone, or no longer queued). */
export function abandonJob(db: Db, jobId: number) {
  db.run("UPDATE jobs SET status = 'failed', finished_at = ? WHERE id = ?", [
    new Date().toISOString(),
    jobId,
  ]);
}

export function setJobPid(db: Db, jobId: number, pid: number) {
  db.run("UPDATE jobs SET pid = ? WHERE id = ?", [pid, jobId]);
}

/** `running → succeeded`, storing the Stage Result of the baseline Combination. */
export function succeedSim(db: Db, jobId: number, simId: number, stage: number, dps: DpsSummary) {
  db.transaction(() => {
    const now = new Date().toISOString();
    const combination = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM combinations WHERE sim_id = ? AND is_baseline = 1",
      )
      .get(simId);
    if (!combination) throw new Error(`Sim ${simId} has no baseline Combination`);
    db.run(
      `INSERT INTO stage_results (combination_id, stage, dps_mean, dps_mean_error, survived)
       VALUES (?, ?, ?, ?, 1)`,
      [combination.id, stage, dps.mean, dps.meanError],
    );
    if (!transition(db, simId, "running", "succeeded", { finished_at: now })) {
      throw new Error(`Sim ${simId} is no longer running`);
    }
    db.run("UPDATE jobs SET status = 'done', finished_at = ? WHERE id = ?", [now, jobId]);
  })();
}

/** `running → failed` with a classified error. */
export function failSim(db: Db, jobId: number, simId: number, error: SimError) {
  db.transaction(() => {
    const now = new Date().toISOString();
    transition(db, simId, "running", "failed", {
      finished_at: now,
      error: JSON.stringify(error),
    });
    db.run("UPDATE jobs SET status = 'failed', finished_at = ? WHERE id = ?", [now, jobId]);
  })();
}

/** Jobs left `running` by a process that died. They fail rather than block the FIFO forever. */
export function failOrphanedJobs(db: Db): { jobId: number; simId: number }[] {
  const orphans = db
    .query<{ id: number; sim_id: number }, []>(
      "SELECT id, sim_id FROM jobs WHERE kind = 'sim' AND status = 'running'",
    )
    .all();
  for (const { id, sim_id } of orphans) {
    failSim(db, id, sim_id, {
      kind: "interrupted",
      message: "The server stopped while this Sim was running.",
    });
  }
  return orphans.map(({ id, sim_id }) => ({ jobId: id, simId: sim_id }));
}

export function getSimResults(db: Db, simId: number): SimResultsResponse | null {
  const sim = getSim(db, simId);
  if (!sim) return null;
  const rows = db
    .query<
      {
        combination_id: number;
        is_baseline: number;
        stage: number;
        dps_mean: number;
        dps_mean_error: number;
        survived: number;
      },
      [number]
    >(
      `SELECT r.combination_id, c.is_baseline, r.stage, r.dps_mean, r.dps_mean_error, r.survived
       FROM stage_results r JOIN combinations c ON c.id = r.combination_id
       WHERE c.sim_id = ? ORDER BY r.stage, c.id`,
    )
    .all(simId);
  return {
    simId,
    simcTag: sim.simcTag,
    results: rows.map((r) => ({
      combinationId: r.combination_id,
      isBaseline: r.is_baseline === 1,
      stage: r.stage,
      dps: { mean: r.dps_mean, meanError: r.dps_mean_error },
      survived: r.survived === 1,
    })),
  };
}

/** The running Job first, then the waiting ones in the order they will run. */
export function getQueue(db: Db): QueueEntry[] {
  const rows = db
    .query<
      {
        job_id: number;
        sim_id: number;
        job_status: "queued" | "running";
        kind: "quick";
        character_snapshot: string;
        queued_at: string | null;
        started_at: string | null;
      },
      []
    >(
      `SELECT j.id AS job_id, j.sim_id, j.status AS job_status, s.kind, s.character_snapshot,
              s.queued_at, j.started_at
       FROM jobs j JOIN sims s ON s.id = j.sim_id
       WHERE j.kind = 'sim' AND j.status IN ('queued', 'running')
       ORDER BY j.status = 'running' DESC, j.id`,
    )
    .all();
  return rows.map((r) => ({
    jobId: r.job_id,
    simId: r.sim_id,
    kind: r.kind,
    status: r.job_status,
    character: characterSnapshotSchema.parse(JSON.parse(r.character_snapshot)),
    queuedAt: r.queued_at,
    startedAt: r.started_at,
  }));
}

export type SimListFilters = {
  characterId?: number;
  status?: string | SimStatus;
};

/**
 * Lists Sims with optional filters by Character and status.
 */
export function listSims(db: Db, filters: SimListFilters): Sim[] {
  const whereConditions: string[] = [];
  const params: (number | string)[] = [];

  if (filters.characterId !== undefined) {
    whereConditions.push("character_id = ?");
    params.push(filters.characterId);
  }
  if (filters.status !== undefined) {
    whereConditions.push("status = ?");
    params.push(filters.status as string);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
  const rows = db
    .query<SimRow, (number | string)[]>(
      `SELECT * FROM sims ${whereClause} ORDER BY finished_at DESC NULLS LAST, queued_at DESC NULLS LAST, created_at DESC`,
    )
    .all(...params);

  return rows.map(toSim);
}

/**
 * Deletes a Sim by ID. Returns true if the Sim existed and was deleted.
 */
export function deleteSim(db: Db, simId: number): boolean {
  const result = db.run("DELETE FROM sims WHERE id = ?", [simId]);
  return result.changes > 0;
}
