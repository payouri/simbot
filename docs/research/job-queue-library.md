# Job queue library for the runner

Researched 2026-09-29, against Bun 1.4.2 on Linux x64.

**Question.** Which job queue library that persists to disk fits simbot's runner? The runner is one Bun process that already uses `bun:sqlite`. It runs one job at a time in strict FIFO order, and there are two job kinds: `sim` (a multi-Stage SimC child process that runs for minutes) and `simc_update`. There is no Redis and no Postgres.

**Answer: write it ourselves.** Use a `jobs` table in the existing `bun:sqlite` database, about 130 lines of TypeScript. No library fits the requirements without workarounds, and each one brings more code than it removes. The closest is **bunqueue**. It is the only library built for Bun and running on `bun:sqlite`, and its crash recovery really works. But after a restart it sends the interrupted job to the *back* of the queue, it retries a cancelled job by default, and it is a 7 MB, fast-moving engine sized for BullMQ-scale workloads. The prototype in the appendix covers every requirement, and a SIGKILL test confirms it behaves correctly.

## Requirements (most important first)

1. Survive a crash or restart. After a restart we must be able to find the job that was running and run it again, with an interruption counter so the job fails after 2 interruptions.
2. Run on Bun with `bun:sqlite`, or at least on Bun without native addons failing.
3. Cancel a queued job, and signal a running job's handler so it can SIGTERM the child.
4. Strict FIFO with concurrency 1. List the queue in order, and ideally move a job to the front.
5. Events or hooks on state changes, so we can push SSE.
6. Maintained, small, permissive licence, TypeScript types.

## Comparison

Legend: ✅ meets the requirement, ⚠️ partly or with a workaround, ❌ does not.

| | bunqueue 2.9.5 | liteque 0.9.1 | plainjob 0.0.14 | sidequest 1.16.5 | better-queue + sqlite store | @boringnode/queue 0.7.1 | bree 9.2.9 | **hand-rolled** |
|---|---|---|---|---|---|---|---|---|
| 1. In-flight job after restart | ✅ found at startup, `attempts++`, dead-letter queue when exhausted; ⚠️ goes to the **back** of the queue | ⚠️ only once its lease (`timeoutSecs`) expires; runs counted | ⚠️ only after `timeout` (30 min default); no counter | ⚠️ swept by a cron (60 min default) after `timeout` | ⚠️ re-run on start; no counter | ⚠️ stall threshold plus `maxStalledCount` | ❌ no persistence | ✅ at startup, keeps its place, fails after 2 |
| 2. Bun and `bun:sqlite` | ✅ `bun:sqlite`, Bun-only | ⚠️ better-sqlite3 (loads in Bun 1.4.2 via N-API prebuild) | ✅ `bun:sqlite` (`strict: true` required) | ❌ `enqueue()` hung under Bun in our test | ⚠️ `sqlite3` native addon | ⚠️ via Knex/Kysely | n/a | ✅ |
| 3. Cancel queued / signal running | ✅ `remove` / `worker.cancelJob`, which fires the `AbortSignal`; ⚠️ a cancelled job is **retried** unless you throw `UnrecoverableError` | ⚠️ only `cancelAllNonRunning()`; signal fires only on timeout | ❌ | ✅ `job.cancel` with signal | ⚠️ in-memory cancel | ❌ | n/a | ✅ |
| 4. FIFO, concurrency 1, ordered list, move to front | ✅ `concurrency: 1`, `getJobs`, `changePriority` | ⚠️ sorted by priority then createdAt, no list API | ❌ one worker per job type, so 2 kinds run 2 at once | ✅ | ⚠️ | ⚠️ no list API | n/a | ✅ |
| 5. Events | ✅ rich | ⚠️ `onComplete`/`onError` only | ⚠️ 3 callbacks | ✅ | ✅ | ⚠️ | n/a | ✅ `EventEmitter` |
| 6. Maintained, size, licence | ⚠️ MIT, 7.2 MB, ~730 JS files, 284 releases since 2026-01 | ✅ MIT, small, active (karakeep) | ❌ MIT, last release 2024-10 | ❌ **LGPL-3.0**, 92 MB installed | ❌ last release 2022 | ✅ MIT, active | MIT | ✅ our code |

**Candidates dropped quickly:**

- **bree** is a cron/interval scheduler that runs jobs in worker threads. It has no persistent job queue (npm description and README), so it does not answer this question.
- **@coderule/qulite** has a single release (2025-09-23) and depends on better-sqlite3 11.
- **@workglow/job-queue** and **@workglow/sqlite** are part of an AI-workflow framework. The SQLite backend is a peer dependency on `@sqlite.org/sqlite-wasm` and a vector extension, which is wrong for us.
- **graphile-worker** and **pg-boss** need Postgres.

## Key facts, verified from source and tests

### bunqueue (egeominotti/bunqueue, MIT, 570★)

**Architecture.** Embedded mode is an in-memory sharded priority queue, written behind to a SQLite file. By default a job is added to a `WriteBuffer` that flushes every **10 ms** (`writeBufferFlushMs ?? 10` in `dist/infrastructure/persistence/sqlite/state.js`), so a crash inside that window loses the add. The per-job option `durable: true` writes the job immediately instead (`jobLifecycle.js` `insertJob(job, durable)`).

**Bun.** The package exports `bun` and `node` entry points separately, and embedded mode needs `bun >= 1.4.0` (README). It uses `bun:sqlite` directly.

**Crash recovery, from source.** At startup, `recoverActiveJobs` (`dist/application/background/recovery/active.js`) loads every row with `state = 'active'` and does the following:

- increments `stallCount` and `attempts`;
- moves the job to the dead-letter queue if `attempts >= maxAttempts` or `stallCount >= maxStalls` (default 3);
- otherwise sets `runAt = now + calculateBackoff(job)`.

Waiting jobs are served in `priority DESC, run_at ASC, id ASC` order (`queries.js`). The new `runAt` therefore puts the interrupted job behind every job queued before the crash.

**Crash recovery, smoke test.** We enqueued jobs [sim#1, simc_update#2, sim#3] with `attempts: 3, durable: true`, then ran a worker with concurrency 1 and SIGKILLed it 3 s into sim#1.

- On restart, sim#1 was `delayed` with `attemptsMade=1`, and **simc_update#2 started first**.
- With `backoff: 0`, the same thing happened: sim#1 got `run_at = restart time` and went behind #2 and #3.
- After a second crash during #2, sim#3 ran before both of them.

Strict FIFO after a crash would need a fix-up at boot, for example `changePriority` on the recovered job.

**Cancel, smoke test.**

- `queue.remove(id)` removed a waiting job.
- `worker.cancelJob(id, reason)` aborted the handler's `AbortSignal` (second argument of the processor) within about 0.5 s, and emitted `cancelled` and then `failed`.
- The job then went back to **`waiting` with `attemptsMade=1`**, so a user-cancelled Sim would run again. To stop that, the handler must throw `UnrecoverableError` when it sees the abort.

**Upkeep.** 284 npm versions between 2026-01-28 and 2026-09-09. Recently closed issues include:

- #118: completed jobs never deleted from SQLite, so the database grows without bound;
- #119: a silent migration of about 8 min per GB on first boot;
- #97 and #110: dead-letter moves not persisted;
- #83: wrong job state after a server restart.

The bugs get fixed quickly, but the persistence layer is still changing under active development.

### liteque (karakeep-app/liteque, MIT, 79★)

- `dist/index.js` imports `better-sqlite3` and Drizzle at the top level, and `buildDBClient` opens its own connection. It cannot share our `bun:sqlite` handle; it could only share the file through WAL.
- **Bun, tested.** better-sqlite3 13.0.3 ships N-API prebuilds (`prebuilds/linux-x64.node`, `"gypfile": false`). Under Bun 1.4.2 it loads and runs queries (SQLite 3.53.4). `bun add` still prints `install script from "better-sqlite3" exited with 127` because it tries `node-gyp` anyway. The install exits 0 and the module works.
- **Recovery** is lease-based. `attemptDequeue` picks up rows that are `running` with `expireAt < now` and decrements `numRunsLeft`. A job running at the time of a crash is only re-run after `timeoutSecs`, and the same `timeoutSecs` also aborts healthy jobs (`Promise.race` with a timeout that calls `abortController.abort()`). For minutes-long Sims, that means either a long wait after a restart or a risk of killing long Stages.
- Completed jobs are **deleted** (`finalize`). The only cancel is `cancelAllNonRunning()`, and there is no per-job cancel or list.

### plainjob (justplainstuff/plainjob, MIT, 98★)

- Last npm release is 0.0.14 (2024-10-13); recent commits are only Renovate bumps.
- Supports `bun:sqlite` through `bun(new Database(path, { strict: true }))`. Without `strict` the inserts fail with `NOT NULL constraint failed` (tested).
- **One worker per job type** (`defineWorker(jobType, …)`), so `sim` and `simc_update` would need two workers and could run at the same time.
- **Recovery, tested.** A job running at the time of a crash stays `Processing` until the maintenance task runs `requeueTimedOutJobs`. The condition is `WHERE status = Processing AND next_run_at < now - timeout`, but `next_run_at` is the *enqueue* time, not the start time. In the test, the recovered job was flipped back to `Pending` **while it was running** ("requeued 1" printed after `START`). There is no attempt counter and no cancel.

### sidequest (sidequestjs/sidequest, **LGPL-3.0**, 1016★)

- It has the right features: `job.cancel` with the abort passed to the running job, `job.list`, and stale-job release that goes through `RetryTransition`, which respects `maxAttempts` (`routines/release-stale-jobs.js`).
- It targets Node. The engine uses `child_process.fork` plus Piscina worker threads by default, and the SQLite backend is Knex with better-sqlite3.
- **Bun, tested** with `fork: false, runner: "inline"`. `Sidequest.build(SimJob).enqueue()` **never resolved**. Sidequest resolves job files from V8 stack traces, and Bun reported the frame as `new SimJob (unknown:1:28)`. See issues #72 (Piscina on Bun, closed as "won't fix unless Bun supports Piscina") and #154 ("Invalid job class with Bun"). A `manualJobResolution` option exists; we did not test it.
- Recovery runs on a cron sweep (default every 60 minutes, stale after the job `timeout` or 10 min), not at startup.

### better-queue + better-queue-sqlite, @boringnode/queue

- **better-queue-sqlite** uses the `sqlite3` native addon, is callback-based, deletes tasks when they finish, and has had no release since 2022.
- **@boringnode/queue** (AdonisJS authors) has a Kysely adapter that could run on `bun:sqlite` through a Bun dialect. Its adapter surface (`kysely_adapter.js`) has `pop`, `recoverStalledJobs` and `renewJobs` but **no cancel and no list-jobs**.

## What a library would actually save us

These are the parts a library would provide that the hand-rolled version does not:

- retries with backoff (we do not want automatic retries of a failed Sim);
- delayed and cron jobs (the SimC Update check could be a `setInterval`);
- rate limits, dead-letter queues, flows and multi-worker leasing (not needed with one process and concurrency 1);
- a dashboard (the UI is ours anyway).

Everything simbot needs fits in about 130 lines of plain SQL.

- **Crash detection is trivial with one process.** At boot, before starting the loop, any row still `running` was interrupted. No leases, heartbeats or stall timers are needed. Every library above pays for multi-worker lease logic, and that is exactly what delays or re-orders recovery.
- **Resuming from the last finished Stage is our logic in every case.** No library knows about Stages. The queue only has to hand the handler an `interruptions` count and the job id.
- **The queue lives next to `sims`.** One transaction can flip a Sim's state and its queue row together, and the UI can join them. A library with its own schema or connection (bunqueue's msgpack blobs; liteque's and sidequest's separate better-sqlite3 connection) rules this out.

**Hand-rolled prototype (appendix).** It was tested under Bun 1.4.2 with three SIGKILLs:

- Run 1: sim#1 started, then SIGKILL.
- Run 2: sim#1 recovered with `interruptions=1` and **kept the head of the queue**; SIGKILL.
- Run 3: sim#1 was marked `failed` ("interrupted 2 times") and simc_update#2 started.

Cancel test:

- `moveToFront(3)` reordered the list to [1 running, 3, 2].
- `cancel(1)` on the running job SIGTERMed the child through the `AbortSignal`, marked it `cancelled`, and #3 started next.

Each state change emitted a `change` event, ready to forward to SSE.

## Caveat for any option: orphaned SimC processes

After SIGKILLing the Bun parent, the `Bun.spawn`ed child (`sleep 8`, standing in for SimC) **kept running** in our tests. No queue library handles this. When the runner boots and resumes a Sim, it must first kill any SimC left over from before the crash. Options are to record the child PID on the job row and kill it at boot, or to run SimC under a process group and kill the group. In Docker the problem is smaller, because a container restart kills the whole process tree. It remains real when the Bun process restarts while the container keeps running.

## Sources

- npm registry metadata (`npm view <pkg> version time dependencies peerDependencies license`) for every candidate, fetched 2026-09-29.
- Package source read from the published tarballs:
  - bunqueue@2.9.5: `dist/application/background/recovery/active.js`, `dist/infrastructure/persistence/sqlite/{state,jobLifecycle,queries}.js`, `dist/infrastructure/persistence/writeBuffer.js`, `dist/client/worker/runtime/control.d.ts`, `dist/client/errors.d.ts`, README.
  - liteque@0.9.1: `dist/index.js`, `dist/drizzle/*.sql`.
  - plainjob@0.0.14: `src/queue.ts`, `src/worker.ts`, README.
  - @sidequest/engine@1.16.5: `engine.js`, `routines/release-stale-jobs.js`, `execution/executor-manager.js`, `shared-runner/runner-pool.js`.
  - @sidequest/backend@1.16.5: `sql-backend.js` (`staleJobs`).
  - sidequest@1.16.5: `operations/job.d.ts`.
  - better-queue-sqlite@1.0.7: `index.js`.
  - @boringnode/queue@0.7.1: `build/src/drivers/kysely_adapter.js`, README.
  - better-sqlite3@13.0.3: `package.json`, `lib/database.js`, `prebuilds/`.
- GitHub API repository metadata (stars, open issues, last push, licence); sidequest issues [#72](https://github.com/sidequestjs/sidequest/issues/72) and [#154](https://github.com/sidequestjs/sidequest/issues/154); bunqueue issues [#83](https://github.com/egeominotti/bunqueue/issues/83), [#97](https://github.com/egeominotti/bunqueue/issues/97), [#110](https://github.com/egeominotti/bunqueue/issues/110), [#118](https://github.com/egeominotti/bunqueue/issues/118), [#119](https://github.com/egeominotti/bunqueue/issues/119).
- Smoke tests run locally under Bun 1.4.2: bunqueue (enqueue, SIGKILL, restart ×3, with `backoff` 1000 and 0; cancel), plainjob (SIGKILL, restart, timeout requeue), liteque and better-sqlite3 (import and query), sidequest (inline enqueue), and the hand-rolled prototype below.

## Appendix: hand-rolled prototype (tested)

A throwaway starting point, not production code. It passed the SIGKILL, cancel and move-to-front tests described above.

```ts
import { Database } from "bun:sqlite";
import { EventEmitter } from "node:events";

export type JobKind = "sim" | "simc_update";
export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";
export interface JobRow { id: number; kind: JobKind; payload: string; state: JobState; position: number;
  interruptions: number; error: string | null; created_at: number; started_at: number | null; finished_at: number | null; }
export type Handler = (job: JobRow, signal: AbortSignal) => Promise<void>;

const MAX_INTERRUPTIONS = 2;

export class JobQueue extends EventEmitter {
  private current: { id: number; ctrl: AbortController } | null = null;
  private wake: (() => void) | null = null;
  private stopped = false;

  constructor(private db: Database, private handlers: Record<JobKind, Handler>) {
    super();
    db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('sim','simc_update')),
        payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed','cancelled')),
        position REAL NOT NULL,
        interruptions INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER);
      CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (state, position);`);
  }

  /** Call once at boot, before start(): any job still 'running' was interrupted by a crash/restart. */
  recover(): JobRow[] {
    return this.db.transaction(() => {
      const rows = this.db.query<JobRow, []>(`SELECT * FROM jobs WHERE state = 'running'`).all();
      for (const r of rows) {
        const n = r.interruptions + 1;
        if (n >= MAX_INTERRUPTIONS) {
          this.db.query(`UPDATE jobs SET state='failed', interruptions=?, error='interrupted ${n} times', finished_at=? WHERE id=?`)
            .run(n, Date.now(), r.id);
        } else {
          // keep its original position: it stays at the head of the line
          this.db.query(`UPDATE jobs SET state='queued', interruptions=? WHERE id=?`).run(n, r.id);
        }
      }
      return rows;
    })();
  }

  enqueue(kind: JobKind, payload: unknown): JobRow {
    const row = this.db.query<JobRow, [string, string, number]>(
      `INSERT INTO jobs (kind, payload, position, created_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM jobs), ?) RETURNING *`,
    ).get(kind, JSON.stringify(payload), Date.now())!;
    this.emit("change", row); this.wake?.();
    return row;
  }

  list(): JobRow[] {
    return this.db.query<JobRow, []>(
      `SELECT * FROM jobs WHERE state IN ('queued','running') ORDER BY state = 'running' DESC, position`).all();
  }

  moveToFront(id: number): boolean {
    const r = this.db.query(`UPDATE jobs SET position = (SELECT MIN(position) - 1 FROM jobs WHERE state='queued')
                             WHERE id = ? AND state = 'queued'`).run(id);
    if (r.changes) this.emit("change", this.get(id));
    return r.changes > 0;
  }

  cancel(id: number): boolean {
    if (this.current?.id === id) { this.current.ctrl.abort(new Error("cancelled")); return true; } // handler SIGTERMs the child
    const r = this.db.query(`UPDATE jobs SET state='cancelled', finished_at=? WHERE id=? AND state='queued'`).run(Date.now(), id);
    if (r.changes) this.emit("change", this.get(id));
    return r.changes > 0;
  }

  get(id: number) { return this.db.query<JobRow, [number]>(`SELECT * FROM jobs WHERE id=?`).get(id); }

  private claimNext(): JobRow | null {
    return this.db.transaction(() => {
      const next = this.db.query<JobRow, []>(`SELECT * FROM jobs WHERE state='queued' ORDER BY position LIMIT 1`).get();
      if (!next) return null;
      return this.db.query<JobRow, [number, number]>(`UPDATE jobs SET state='running', started_at=? WHERE id=? RETURNING *`)
        .get(Date.now(), next.id);
    }).immediate();
  }

  private finish(id: number, state: JobState, error?: string) {
    this.db.query(`UPDATE jobs SET state=?, error=?, finished_at=? WHERE id=?`).run(state, error ?? null, Date.now(), id);
    this.emit("change", this.get(id));
  }

  async start() {
    while (!this.stopped) {
      const job = this.claimNext();
      if (!job) { await new Promise<void>((r) => (this.wake = r)); this.wake = null; continue; }
      this.emit("change", job);
      const ctrl = new AbortController();
      this.current = { id: job.id, ctrl };
      try {
        await this.handlers[job.kind](job, ctrl.signal);
        this.finish(job.id, "done");
      } catch (e) {
        this.finish(job.id, ctrl.signal.aborted ? "cancelled" : "failed", String(e));
      } finally { this.current = null; }
    }
  }

  stop() { this.stopped = true; this.current?.ctrl.abort(new Error("shutdown")); this.wake?.(); }
}
```

A handler turns the abort into a SIGTERM:

```ts
sim: async (job, signal) => {
  const child = Bun.spawn(["simc", /* … */]);
  const onAbort = () => child.kill("SIGTERM");
  signal.addEventListener("abort", onAbort, { once: true });
  const code = await child.exited;
  signal.removeEventListener("abort", onAbort);
  if (code !== 0) throw new Error(`simc exited ${code}`);
}
```

Gaps to close before production:

- The `stop()` abort currently marks the job `cancelled`. Graceful shutdown should leave it `running`, so that `recover()` counts it as an interruption, or it should get its own state.
- Record the child PID so a boot-time sweep can kill an orphaned SimC.
- Decide whether a graceful restart counts as an interruption.
