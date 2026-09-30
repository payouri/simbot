import {
  type DpsSummary,
  type SimcCheckSim,
  type SimcJob,
  type SimcJobStatus,
  type SimcJobTarget,
  type SimcUpdateQueueEntry,
  type SimcUpdateStep,
  simcJobTargetSchema,
  simcUpdateStepSchema,
} from "@simbot/shared";
import type { Db } from ".";

type JobRow = {
  id: number;
  status: SimcJobStatus;
  target: string;
  step: string | null;
  resolved_tag: string | null;
  error: string | null;
  created_at: string;
};

const toJob = (row: JobRow): SimcJob => ({
  id: row.id,
  target: simcJobTargetSchema.parse(JSON.parse(row.target)),
  status: row.status,
  step: row.step ? simcUpdateStepSchema.parse(row.step) : null,
  tag: row.resolved_tag,
  error: row.error,
  createdAt: row.created_at,
});

const SELECT = `SELECT id, status, target, step, resolved_tag, error, created_at
  FROM jobs WHERE kind = 'simc_update'`;

export function getSimcJob(db: Db, id: number): SimcJob | null {
  const row = db.query<JobRow, [number]>(`${SELECT} AND id = ?`).get(id);
  return row ? toJob(row) : null;
}

/**
 * The newest SimC Update Job unless it is done: a queued or running one is in flight, a failed
 * one waits for Retry. A newer Job replaces an older failed one.
 */
export function latestOpenSimcJob(db: Db): SimcJob | null {
  const row = db.query<JobRow, []>(`${SELECT} ORDER BY id DESC LIMIT 1`).get();
  return row && row.status !== "done" ? toJob(row) : null;
}

/** SimC Update Jobs in the Queue (running or waiting), the running one first, then by id. */
export function getSimcQueueEntries(db: Db): SimcUpdateQueueEntry[] {
  return db
    .query<JobRow & { started_at: string | null }, []>(
      `SELECT id, status, target, step, resolved_tag, error, created_at, started_at
       FROM jobs WHERE kind = 'simc_update' AND status IN ('queued', 'running')
       ORDER BY status = 'running' DESC, id`,
    )
    .all()
    .map((row) => ({
      type: "simc_update" as const,
      jobId: row.id,
      status: row.status === "running" ? ("running" as const) : ("queued" as const),
      target: simcJobTargetSchema.parse(JSON.parse(row.target)),
      step: row.step ? simcUpdateStepSchema.parse(row.step) : null,
      tag: row.resolved_tag,
      queuedAt: row.created_at,
      startedAt: row.started_at,
    }));
}

/** Appends a `simc_update` Job, unless one is already queued or running (at most one). */
export function queueSimcJob(
  db: Db,
  target: SimcJobTarget,
): { ok: true; job: SimcJob } | { ok: false; reason: "busy" } {
  return db.transaction((): { ok: true; job: SimcJob } | { ok: false; reason: "busy" } => {
    const busy = db
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM jobs WHERE kind = 'simc_update' AND status IN ('queued', 'running')",
      )
      .get();
    if (busy && busy.n > 0) return { ok: false, reason: "busy" };
    const result = db.run(
      "INSERT INTO jobs (kind, status, target, created_at) VALUES ('simc_update', 'queued', ?, ?)",
      [JSON.stringify(target), new Date().toISOString()],
    );
    const job = getSimcJob(db, Number(result.lastInsertRowid));
    if (!job) throw new Error("simc job insert failed");
    return { ok: true, job };
  })();
}

/** `queued → running`. False when the Job is not queued any more. */
export function startSimcJob(db: Db, id: number): boolean {
  return (
    db.run(
      "UPDATE jobs SET status = 'running', started_at = ?, step = NULL, error = NULL WHERE id = ? AND status = 'queued'",
      [new Date().toISOString(), id],
    ).changes > 0
  );
}

export function setSimcJobStep(db: Db, id: number, step: SimcUpdateStep) {
  db.run("UPDATE jobs SET step = ? WHERE id = ?", [step, id]);
}

export function setSimcJobTag(db: Db, id: number, tag: string) {
  db.run("UPDATE jobs SET resolved_tag = ? WHERE id = ?", [tag, id]);
}

export function finishSimcJob(db: Db, id: number) {
  db.run("UPDATE jobs SET status = 'done', step = NULL, finished_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
}

/** `running → failed`, keeping the step that failed and why. */
export function failSimcJob(db: Db, id: number, step: SimcUpdateStep, error: string) {
  db.run("UPDATE jobs SET status = 'failed', step = ?, error = ?, finished_at = ? WHERE id = ?", [
    step,
    error,
    new Date().toISOString(),
    id,
  ]);
}

/** Jobs left `running` by a process that died go back to the Queue, to restart from step 1. */
export function requeueInterruptedSimcJobs(db: Db): number {
  return db.run(
    "UPDATE jobs SET status = 'queued', step = NULL, resolved_tag = NULL, started_at = NULL WHERE kind = 'simc_update' AND status = 'running'",
  ).changes;
}

/** Tags of SimC Builds that a Sim not yet finished is using. Those builds are never evicted. */
export function tagsInUse(db: Db): string[] {
  return db
    .query<{ simc_tag: string }, []>(
      "SELECT DISTINCT simc_tag FROM sims WHERE status IN ('queued', 'running') AND simc_tag IS NOT NULL",
    )
    .all()
    .map((r) => r.simc_tag);
}

/** The newest Import, the input for a Check Sim; null when nothing was imported yet. */
export function latestImport(db: Db): { id: number; text: string } | null {
  const row = db
    .query<{ id: number; raw_text: string }, []>(
      "SELECT id, raw_text FROM imports ORDER BY id DESC LIMIT 1",
    )
    .get();
  return row ? { id: row.id, text: row.raw_text } : null;
}

/** Stores the Check Sim of `buildTag` on an Import, replacing an earlier one for the same pair. */
export function saveCheckSim(
  db: Db,
  input: {
    buildTag: string;
    importId: number;
    previousTag: string | null;
    dps: DpsSummary;
    durationMs?: number | null;
    iterations?: number | null;
  },
) {
  db.run(
    `INSERT OR REPLACE INTO check_sim_results
       (build_tag, import_id, previous_tag, dps_mean, dps_mean_error, created_at,
        duration_ms, iterations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.buildTag,
      input.importId,
      input.previousTag,
      input.dps.mean,
      input.dps.meanError,
      new Date().toISOString(),
      input.durationMs ?? null,
      input.iterations ?? null,
    ],
  );
}

/** Whether `tag` has a Check Sim on this Import. */
export function hasCheckSim(db: Db, tag: string, importId: number): boolean {
  return !!db
    .query("SELECT 1 FROM check_sim_results WHERE build_tag = ? AND import_id = ?")
    .get(tag, importId);
}

/** The cost of the newest Check Sim of `tag`: wall time, iterations and the error it reached. */
export function getCheckSimCost(
  db: Db,
  tag: string,
): { durationMs: number | null; iterations: number | null; errorPercent: number } | null {
  const row = db
    .query<
      {
        duration_ms: number | null;
        iterations: number | null;
        dps_mean: number;
        dps_mean_error: number;
      },
      [string]
    >(
      `SELECT duration_ms, iterations, dps_mean, dps_mean_error FROM check_sim_results
       WHERE build_tag = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(tag);
  if (!row || row.dps_mean <= 0) return null;
  return {
    durationMs: row.duration_ms,
    iterations: row.iterations,
    errorPercent: (row.dps_mean_error / row.dps_mean) * 100,
  };
}

type CheckRow = {
  build_tag: string;
  import_id: number;
  previous_tag: string | null;
  dps_mean: number;
  dps_mean_error: number;
};

/**
 * The newest Check Sim of `tag`, and the one of the build that was current before it on the same
 * Import, when that exists too.
 */
export function getCheckSim(db: Db, tag: string): SimcCheckSim | null {
  const row = db
    .query<CheckRow, [string]>(
      "SELECT * FROM check_sim_results WHERE build_tag = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(tag);
  if (!row) return null;
  const before = row.previous_tag
    ? db
        .query<CheckRow, [string, number]>(
          "SELECT * FROM check_sim_results WHERE build_tag = ? AND import_id = ?",
        )
        .get(row.previous_tag, row.import_id)
    : null;
  return {
    tag: row.build_tag,
    importId: row.import_id,
    dps: { mean: row.dps_mean, meanError: row.dps_mean_error },
    previous: before
      ? {
          tag: before.build_tag,
          dps: { mean: before.dps_mean, meanError: before.dps_mean_error },
        }
      : null,
  };
}

/** Records the PTR pass of `tag`'s Check Sim: `error` null when it passed, else why it failed. */
export function savePtrCheck(db: Db, tag: string, error: string | null) {
  db.run(
    "INSERT OR REPLACE INTO ptr_check_results (build_tag, error, created_at) VALUES (?, ?, ?)",
    [tag, error, new Date().toISOString()],
  );
}

/** Why the PTR pass failed for each build tag that has a failed one. */
export function ptrCheckErrors(db: Db): Map<string, string> {
  const rows = db
    .query<{ build_tag: string; error: string }, []>(
      "SELECT build_tag, error FROM ptr_check_results WHERE error IS NOT NULL",
    )
    .all();
  return new Map(rows.map((r) => [r.build_tag, r.error]));
}
