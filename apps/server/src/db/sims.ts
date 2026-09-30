import {
  type CharacterSnapshot,
  type CombinationDefinition,
  canTransition,
  characterSnapshotSchema,
  combinationDefinitionSchema,
  type DpsSummary,
  defaultSimSettings,
  defaultTopGearSelection,
  normalizeSelection,
  type QueueEntry,
  type Sim,
  type SimError,
  type SimKind,
  type SimLadderResponse,
  type SimResultsResponse,
  type SimSettings,
  type SimStatus,
  simErrorSchema,
  simSettingsSchema,
  type TopGearSelection,
  topGearSelectionSchema,
} from "@simbot/shared";
import { parseProfileHeader, type StageCost, stageLadder } from "@simbot/simc";
import type { Db } from ".";
import { getCharacter } from "./characters";
import { equippedLoadoutIndex, getImportText } from "./imports";

type SimRow = {
  id: number;
  kind: SimKind;
  status: SimStatus;
  import_id: number;
  character_id: number;
  character_snapshot: string;
  settings: string;
  top_gear_selection: string | null;
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
  topGearSelection: row.top_gear_selection
    ? topGearSelectionSchema.parse(JSON.parse(row.top_gear_selection))
    : null,
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
 * Creates a Draft from an Import. Omitted settings take the defaults; the merged settings and
 * the Character Snapshot are frozen on the Sim, and it starts with the default Top Gear
 * Selection whatever its kind, so any Draft can open the setup. Null when the Import is unknown.
 */
export function createSim(
  db: Db,
  input: { importId: number; kind?: SimKind; settings?: Partial<SimSettings> },
): Sim | null {
  const imp = db
    .query<{ character_id: number }, [number]>("SELECT character_id FROM imports WHERE id = ?")
    .get(input.importId);
  const character = imp ? getCharacter(db, imp.character_id) : null;
  const text = getImportText(db, input.importId);
  if (!imp || !character || text === null) return null;
  const header = parseProfileHeader(text);
  const snapshot: CharacterSnapshot = {
    // Identity is the Character's now, so an edited Character is not frozen under its old name.
    name: character.name,
    region: character.region,
    realm: character.realm,
    class: character.class,
    spec: header.spec,
    race: header.race,
    level: header.level,
  };
  const kind = input.kind ?? "quick";
  const settings = simSettingsSchema.parse({ ...defaultSimSettings, ...input.settings });
  const selection = defaultTopGearSelection(equippedLoadoutIndex(db, input.importId));
  return insertDraft(db, {
    kind,
    importId: input.importId,
    characterId: imp.character_id,
    snapshot,
    settings,
    selection,
  });
}

/**
 * Creates a Draft as a copy of another Sim's input: same Import, Character, Character Snapshot,
 * settings (unless overridden) and Top Gear Selection. Null when the source Sim is unknown.
 */
export function copySim(
  db: Db,
  sourceId: number,
  input: { kind?: SimKind; settings?: Partial<SimSettings> } = {},
): Sim | null {
  const source = getSim(db, sourceId);
  if (!source) return null;
  const kind = input.kind ?? source.kind;
  return insertDraft(db, {
    kind,
    importId: source.importId,
    characterId: source.characterId,
    snapshot: source.character,
    settings: simSettingsSchema.parse({ ...source.settings, ...input.settings }),
    selection:
      source.topGearSelection ?? defaultTopGearSelection(equippedLoadoutIndex(db, source.importId)),
  });
}

/**
 * The kind a Draft has with `selection` saved on it: Candidates included make it a Top Gear
 * whatever it started as. The one place that rule lives, applied on every write of a Draft.
 */
const draftKind = (kind: SimKind, selection: TopGearSelection | null): SimKind =>
  (selection?.included.length ?? 0) > 0 ? "top_gear" : kind;

function insertDraft(
  db: Db,
  d: {
    kind: SimKind;
    importId: number;
    characterId: number;
    snapshot: CharacterSnapshot;
    settings: SimSettings;
    selection: TopGearSelection | null;
  },
): Sim {
  const result = db.run(
    `INSERT INTO sims (kind, status, import_id, character_id, character_snapshot, settings,
                       top_gear_selection, created_at)
     VALUES (?, 'draft', ?, ?, ?, ?, ?, ?)`,
    [
      draftKind(d.kind, d.selection),
      d.importId,
      d.characterId,
      JSON.stringify(d.snapshot),
      JSON.stringify(d.settings),
      d.selection ? JSON.stringify(normalizeSelection(d.selection)) : null,
      new Date().toISOString(),
    ],
  );
  const sim = getSim(db, Number(result.lastInsertRowid));
  if (!sim) throw new Error("sim insert failed");
  return sim;
}

export type UpdateDraftResult =
  | { ok: true; sim: Sim }
  | { ok: false; reason: "not_found" | "not_a_draft" };

/**
 * Saves a Draft's Sim Settings (merged over the stored ones) and Top Gear Selection (replaced
 * whole); Candidates included make it a Top Gear. The row must still be a Draft when written, so
 * a Sim queued in between is left alone.
 */
export function updateDraft(
  db: Db,
  id: number,
  patch: { settings?: Partial<SimSettings>; topGearSelection?: TopGearSelection },
): UpdateDraftResult {
  return db.transaction((): UpdateDraftResult => {
    const current = getSim(db, id);
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status !== "draft") return { ok: false, reason: "not_a_draft" };
    const settings = simSettingsSchema.parse({ ...current.settings, ...patch.settings });
    const selection = patch.topGearSelection
      ? normalizeSelection(patch.topGearSelection)
      : current.topGearSelection;
    db.run(
      `UPDATE sims SET settings = ?, top_gear_selection = ?, kind = ?
       WHERE id = ? AND status = 'draft'`,
      [
        JSON.stringify(settings),
        selection ? JSON.stringify(selection) : null,
        draftKind(current.kind, selection),
        id,
      ],
    );
    const sim = getSim(db, id);
    if (!sim) throw new Error("sim vanished");
    return { ok: true, sim };
  })();
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
  patch: Partial<
    Record<"simc_tag" | "error" | "queued_at" | "started_at" | "finished_at", string | null>
  >,
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
  | { ok: false; reason: "not_found" | "invalid_transition" | "selection_changed" };

/** The Combinations a Top Gear Sim is queued with, generated from `selection` on `simcTag`. */
export type QueuePlan = {
  selection: TopGearSelection;
  simcTag: string | null;
  combinations: readonly { isBaseline: boolean; definition: CombinationDefinition }[];
};

/**
 * `draft → queued`: freezes the Sim, stores its Combinations (a Top Gear's generated ones with
 * the baseline first, otherwise just the baseline) and appends a `sim` Job to the FIFO, all in
 * one transaction. A plan built from a selection that was edited meanwhile is refused.
 */
export function queueSim(db: Db, id: number, plan?: QueuePlan): QueueResult {
  return db.transaction((): QueueResult => {
    const current = getSim(db, id);
    if (!current) return { ok: false, reason: "not_found" };
    if (!canTransition(current.status, "queued"))
      return { ok: false, reason: "invalid_transition" };
    if (
      plan &&
      JSON.stringify(normalizeSelection(plan.selection)) !==
        JSON.stringify(current.topGearSelection && normalizeSelection(current.topGearSelection))
    ) {
      return { ok: false, reason: "selection_changed" };
    }
    const now = new Date().toISOString();
    if (!transition(db, id, current.status, "queued", { queued_at: now })) {
      return { ok: false, reason: "invalid_transition" };
    }
    const insert = db.prepare(
      "INSERT INTO combinations (sim_id, definition, is_baseline) VALUES (?, ?, ?)",
    );
    if (plan) {
      for (const c of plan.combinations) {
        insert.run(id, JSON.stringify(c.definition), c.isBaseline ? 1 : 0);
      }
      db.run("UPDATE sims SET frozen_simc_tag = ? WHERE id = ?", [plan.simcTag, id]);
    } else {
      insert.run(id, JSON.stringify({ kind: "equipped" }), 1);
    }
    const job = db.run(
      "INSERT INTO jobs (kind, sim_id, status, created_at) VALUES ('sim', ?, 'queued', ?)",
      [id, now],
    );
    const sim = getSim(db, id);
    if (!sim) throw new Error("sim vanished");
    return { ok: true, sim, jobId: Number(job.lastInsertRowid) };
  })();
}

export type QueuedJob = { id: number; kind: "sim" | "simc_update"; simId: number | null };

/** The oldest waiting Job of any kind: the Queue is strict FIFO. */
export function nextQueuedJob(db: Db): QueuedJob | null {
  const row = db
    .query<{ id: number; kind: QueuedJob["kind"]; sim_id: number | null }, []>(
      "SELECT id, kind, sim_id FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1",
    )
    .get();
  return row ? { id: row.id, kind: row.kind, simId: row.sim_id } : null;
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

/** `running → succeeded`; the Stage Results are already stored (see `recordStage`). */
export function succeedSim(db: Db, jobId: number, simId: number) {
  db.transaction(() => {
    const now = new Date().toISOString();
    if (!transition(db, simId, "running", "succeeded", { finished_at: now })) {
      throw new Error(`Sim ${simId} is no longer running`);
    }
    db.run("UPDATE jobs SET status = 'done', finished_at = ? WHERE id = ?", [now, jobId]);
  })();
}

export type CombinationRow = {
  id: number;
  isBaseline: boolean;
  definition: CombinationDefinition;
  /** The Stage in which SimC refused it; null while it is valid. */
  invalidStage: number | null;
};

/** The Sim's frozen Combinations with their database ids (the profileset names), baseline first. */
export function getCombinationRows(db: Db, simId: number): CombinationRow[] {
  return db
    .query<
      { id: number; is_baseline: number; definition: string; invalid_stage: number | null },
      [number]
    >(
      "SELECT id, is_baseline, definition, invalid_stage FROM combinations WHERE sim_id = ? ORDER BY id",
    )
    .all(simId)
    .map((r) => ({
      id: r.id,
      isBaseline: r.is_baseline === 1,
      definition: combinationDefinitionSchema.parse(JSON.parse(r.definition)),
      invalidStage: r.invalid_stage,
    }));
}

/** The last Stage that has Stage Results, 0 when none has: a resumed Sim starts after it. */
export function lastFinishedStage(db: Db, simId: number): number {
  return (
    db
      .query<{ stage: number | null }, [number]>(
        `SELECT MAX(r.stage) AS stage FROM stage_results r
         JOIN combinations c ON c.id = r.combination_id WHERE c.sim_id = ?`,
      )
      .get(simId)?.stage ?? 0
  );
}

/** Ids of the Combinations that survived `stage`, i.e. the field of the next one. */
export function stageSurvivorIds(db: Db, simId: number, stage: number): number[] {
  return db
    .query<{ combination_id: number }, [number, number]>(
      `SELECT r.combination_id FROM stage_results r
       JOIN combinations c ON c.id = r.combination_id
       WHERE c.sim_id = ? AND r.stage = ? AND r.survived = 1 ORDER BY r.combination_id`,
    )
    .all(simId, stage)
    .map((r) => r.combination_id);
}

export type StageOutcome = { combinationId: number; dps: DpsSummary; survived: boolean };

/** What a finished Stage's SimC run cost, stored next to its results for the time estimate. */
export type StageRunCost = {
  simId: number;
  durationMs: number;
  /** Summed over the profilesets; null when SimC did not report it. */
  iterations: number | null;
  profilesets: number;
  targetError: number;
};

/**
 * Stores a finished Stage: one Stage Result per Combination that ran it and, when given, what
 * the run cost; all or nothing.
 */
export function recordStage(
  db: Db,
  stage: number,
  outcomes: readonly StageOutcome[],
  cost?: StageRunCost,
) {
  db.transaction(() => {
    if (cost) {
      db.run(
        `INSERT OR REPLACE INTO stage_costs
           (sim_id, stage, duration_ms, iterations, profilesets, target_error)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          cost.simId,
          stage,
          Math.round(cost.durationMs),
          cost.iterations === null ? null : Math.round(cost.iterations),
          cost.profilesets,
          cost.targetError,
        ],
      );
    }
    const insert = db.prepare(
      `INSERT INTO stage_results (combination_id, stage, dps_mean, dps_mean_error, survived)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const o of outcomes) {
      insert.run(o.combinationId, stage, o.dps.mean, o.dps.meanError, o.survived ? 1 : 0);
    }
    // A finished Stage is progress: only interruptions with none in between count as in a row.
    const first = outcomes[0];
    if (first) {
      db.run(
        `UPDATE jobs SET interruptions = 0 WHERE kind = 'sim' AND status = 'running'
           AND sim_id = (SELECT sim_id FROM combinations WHERE id = ?)`,
        [first.combinationId],
      );
    }
  })();
}

/**
 * The Stage costs of the most recently finished Top Gear that ran on SimC Build `tag` and
 * recorded any, with the fight length it ran. Empty when there is none.
 */
export function lastTopGearStageCosts(db: Db, tag: string): StageCost[] {
  return db
    .query<
      {
        duration_ms: number;
        iterations: number;
        profilesets: number;
        target_error: number;
        fight_seconds: number;
      },
      [string]
    >(
      `SELECT c.duration_ms, c.iterations, c.profilesets, c.target_error,
              json_extract(s.settings, '$.durationSeconds') AS fight_seconds
       FROM stage_costs c JOIN sims s ON s.id = c.sim_id
       WHERE c.sim_id = (
         SELECT s2.id FROM sims s2
         WHERE s2.kind = 'top_gear' AND s2.status = 'succeeded' AND s2.simc_tag = ?1
           AND EXISTS (SELECT 1 FROM stage_costs c2
                       WHERE c2.sim_id = s2.id AND c2.iterations IS NOT NULL)
         ORDER BY s2.finished_at DESC, s2.id DESC LIMIT 1)
         AND c.iterations IS NOT NULL
       ORDER BY c.stage`,
    )
    .all(tag)
    .map((r) => ({
      durationMs: r.duration_ms,
      iterations: r.iterations,
      profilesets: r.profilesets,
      targetError: r.target_error,
      fightSeconds: r.fight_seconds,
    }));
}

/** SimC refused this Combination in `stage`: it takes no further part. */
export function markInvalid(db: Db, combinationId: number, stage: number) {
  db.run("UPDATE combinations SET invalid_stage = ? WHERE id = ?", [stage, combinationId]);
}

/**
 * The Stage ladder as it stands: every planned Stage with its `target_error` and, for the ones
 * that finished, how many Combinations entered and were kept. Null when the Sim is unknown.
 */
export function getLadder(db: Db, simId: number): SimLadderResponse | null {
  const sim = getSim(db, simId);
  if (!sim) return null;
  const total =
    db
      .query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM combinations WHERE sim_id = ?")
      .get(simId)?.n ?? 0;
  const counts = new Map(
    db
      .query<{ stage: number; entered: number; kept: number }, [number]>(
        `SELECT r.stage, COUNT(*) AS entered, SUM(r.survived) AS kept FROM stage_results r
         JOIN combinations c ON c.id = r.combination_id WHERE c.sim_id = ? GROUP BY r.stage`,
      )
      .all(simId)
      .map((r) => [r.stage, r]),
  );
  const invalid = new Map(
    db
      .query<{ stage: number; n: number }, [number]>(
        `SELECT invalid_stage AS stage, COUNT(*) AS n FROM combinations
         WHERE sim_id = ? AND invalid_stage IS NOT NULL GROUP BY invalid_stage`,
      )
      .all(simId)
      .map((r) => [r.stage, r.n]),
  );
  return {
    simId,
    stages: stageLadder(sim.settings.precision, total).map((targetErrorPct, i) => {
      const stage = i + 1;
      const done = counts.get(stage);
      return {
        stage,
        targetErrorPct,
        entered: done?.entered ?? null,
        kept: done?.kept ?? null,
        culled: done ? done.entered - done.kept : 0,
        invalid: invalid.get(stage) ?? 0,
      };
    }),
  };
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

export type StopMode = "keep" | "discard";

/** How many times in a row a crash may interrupt a Job before it fails instead of resuming. */
export const MAX_INTERRUPTIONS = 2;

/** Back to a Draft, as if it had never run: results, Combinations and run traces are dropped. */
function resetToDraft(db: Db, simId: number, from: "queued" | "running") {
  if (
    !transition(db, simId, from, "draft", {
      simc_tag: null,
      error: null,
      queued_at: null,
      started_at: null,
      finished_at: null,
    })
  ) {
    throw new Error(`Sim ${simId} is no longer ${from}`);
  }
  db.run("UPDATE sims SET frozen_simc_tag = NULL WHERE id = ?", [simId]);
  // Stage results go with their Combinations (ON DELETE CASCADE).
  db.run("DELETE FROM combinations WHERE sim_id = ?", [simId]);
  db.run("DELETE FROM stage_costs WHERE sim_id = ?", [simId]);
  db.run("DELETE FROM jobs WHERE kind = 'sim' AND sim_id = ?", [simId]);
}

export type StopResult =
  | { ok: true; sim: Sim; outcome: "discarded" | "stopping" }
  | { ok: false; reason: "not_found" | "invalid_transition" };

/**
 * Asks to end a queued or running Sim. A queued Sim returns to Draft at once (Stop and Discard
 * alike: it has nothing to keep). A running Sim only has the request recorded on its Job: the
 * runner signals SimC and settles the Sim once the process is gone. Discard outranks Stop.
 */
export function requestStop(db: Db, id: number, keep: boolean): StopResult {
  return db.transaction((): StopResult => {
    const current = getSim(db, id);
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status === "queued") {
      resetToDraft(db, id, "queued");
    } else if (current.status === "running") {
      const mode: StopMode = keep ? "keep" : "discard";
      db.run(
        `UPDATE jobs SET stop_mode = ? WHERE kind = 'sim' AND sim_id = ? AND status = 'running'
           AND (stop_mode IS NULL OR ? = 'discard')`,
        [mode, id, mode],
      );
    } else {
      return { ok: false, reason: "invalid_transition" };
    }
    const sim = getSim(db, id);
    if (!sim) throw new Error("sim vanished");
    return { ok: true, sim, outcome: current.status === "queued" ? "discarded" : "stopping" };
  })();
}

/** The pending Stop or Discard request on a Job, if any. */
export function getStopMode(db: Db, jobId: number): StopMode | null {
  const row = db
    .query<{ stop_mode: StopMode | null }, [number]>("SELECT stop_mode FROM jobs WHERE id = ?")
    .get(jobId);
  return row?.stop_mode ?? null;
}

/** `running → cancelled` (Stop): the Sim keeps every Stage Result it finished. */
export function cancelSim(db: Db, jobId: number, simId: number) {
  db.transaction(() => {
    const now = new Date().toISOString();
    transition(db, simId, "running", "cancelled", { finished_at: now });
    db.run("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ?", [now, jobId]);
  })();
}

/** `running → draft` (Discard): results and Job are deleted. Files are the caller's concern. */
export function discardRunningSim(db: Db, simId: number) {
  db.transaction(() => resetToDraft(db, simId, "running"))();
}

/**
 * Boot recovery for Sim Jobs a dead process left `running`. Each is interrupted once more: the
 * first time it goes back to the head of the Queue (Job ids are FIFO order and it was the head
 * when it started), the second time in a row it fails. Returns what happened, for events and to
 * know which PIDs to reap.
 */
export function recoverInterruptedSims(db: Db): {
  jobId: number;
  simId: number;
  pid: number | null;
  outcome: "requeued" | "failed" | "cancelled" | "discarded";
}[] {
  const orphans = db
    .query<{ id: number; sim_id: number; pid: number | null; interruptions: number }, []>(
      "SELECT id, sim_id, pid, interruptions FROM jobs WHERE kind = 'sim' AND status = 'running' ORDER BY id",
    )
    .all();
  return orphans.map(({ id, sim_id, pid, interruptions }) => {
    const count = interruptions + 1;
    // A Stop or Discard asked for before the crash is settled now rather than redone.
    const mode = getStopMode(db, id);
    if (mode === "discard") {
      discardRunningSim(db, sim_id);
      return { jobId: id, simId: sim_id, pid, outcome: "discarded" as const };
    }
    if (mode === "keep") {
      cancelSim(db, id, sim_id);
      return { jobId: id, simId: sim_id, pid, outcome: "cancelled" as const };
    }
    if (count >= MAX_INTERRUPTIONS) {
      failSim(db, id, sim_id, {
        kind: "interrupted",
        message: `The server stopped ${count} times in a row while this Sim was running.`,
      });
      return { jobId: id, simId: sim_id, pid, outcome: "failed" as const };
    }
    db.transaction(() => {
      transition(db, sim_id, "running", "queued", { started_at: null });
      db.run(
        "UPDATE jobs SET status = 'queued', pid = NULL, started_at = NULL, interruptions = ? WHERE id = ?",
        [count, id],
      );
    })();
    return { jobId: id, simId: sim_id, pid, outcome: "requeued" as const };
  });
}

/**
 * A Sim's Stage Results with its Combinations and the number of planned Stages. `status` is the
 * Sim's own; the caller decides which states have results to show. The Import's items and Talent
 * Loadouts are joined in by the HTTP layer (they come from the item index, not this database).
 */
export function getSimResults(
  db: Db,
  simId: number,
): Pick<
  SimResultsResponse,
  "simId" | "simcTag" | "stageCount" | "results" | "combinations"
> | null {
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
  const combinations = getCombinationRows(db, simId);
  return {
    simId,
    simcTag: sim.simcTag,
    stageCount: stageLadder(sim.settings.precision, combinations.length).length,
    results: rows.map((r) => ({
      combinationId: r.combination_id,
      isBaseline: r.is_baseline === 1,
      stage: r.stage,
      dps: { mean: r.dps_mean, meanError: r.dps_mean_error },
      survived: r.survived === 1,
    })),
    combinations: combinations.map((c) => ({
      id: c.id,
      isBaseline: c.isBaseline,
      gear: c.definition.gear,
      talentLoadout: c.definition.talentLoadout,
      invalidStage: c.invalidStage,
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
        kind: SimKind;
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

export type DeleteResult = { ok: true } | { ok: false; reason: "not_found" | "in_queue" };

/**
 * Deletes a Sim, with its Job, Combinations and Stage Results (ON DELETE CASCADE). A queued or
 * running Sim is refused: its Job is still live, and deleting it would leave SimC running with
 * nothing left to stop it by. Files are the caller's concern.
 */
export function deleteSim(db: Db, simId: number): DeleteResult {
  return db.transaction((): DeleteResult => {
    const result = db.run("DELETE FROM sims WHERE id = ? AND status NOT IN ('queued', 'running')", [
      simId,
    ]);
    if (result.changes > 0) return { ok: true };
    return getSim(db, simId)
      ? { ok: false, reason: "in_queue" }
      : { ok: false, reason: "not_found" };
  })();
}

/** The Combinations frozen on a Sim, in the order they were generated (the baseline first). */
export function getFrozenCombinations(db: Db, simId: number): CombinationDefinition[] {
  return db
    .query<{ definition: string }, [number]>(
      "SELECT definition FROM combinations WHERE sim_id = ? ORDER BY id",
    )
    .all(simId)
    .map((r) => combinationDefinitionSchema.parse(JSON.parse(r.definition)));
}

/** The SimC Build tag the Sim's Combinations were validated against when it was queued. */
export function getFrozenSimcTag(db: Db, simId: number): string | null {
  return (
    db
      .query<{ frozen_simc_tag: string | null }, [number]>(
        "SELECT frozen_simc_tag FROM sims WHERE id = ?",
      )
      .get(simId)?.frozen_simc_tag ?? null
  );
}
