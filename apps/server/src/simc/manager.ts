import { rmSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_KEEP_BUILDS,
  type SimcBuild,
  type SimcInstallState,
  type SimcJob,
  type SimcJobTarget,
  type SimcStatusResponse,
  type SimcUpdateStatus,
  type SimcUpdateStep,
  simcUpdateStatusSchema,
} from "@simbot/shared";
import type { Db } from "../db";
import {
  failSimcJob,
  finishSimcJob,
  getCheckSim,
  getSimcJob,
  hasCheckSim,
  latestImport,
  latestOpenSimcJob,
  queueSimcJob,
  requeueInterruptedSimcJobs,
  saveCheckSim,
  setSimcJobStep,
  setSimcJobTag,
  startSimcJob,
  tagsInUse,
} from "../db/simc-jobs";
import type { EventBus } from "../events";
import { type Launch, runCheckSim } from "./check-sim";
import {
  buildDir,
  commitBuild,
  discardPartial,
  installBuild,
  listInstalledBuilds,
  partialDir,
  populateFromRegistry,
  populateFromSeed,
  readBuildRecord,
  readInstalledBuild,
  removeBuild,
  simcRoot,
  stageBuild,
} from "./install";
import { ensureBuildMeta, installMetaFrom, metaDir, metaRoot, readBuildMeta } from "./meta";
import { createRegistryClient, type RegistryDeps } from "./registry";
import { runUpdateCheck } from "./updates";

const CURRENT_KEY = "simc.current_tag";
const UPDATE_KEY = "simc.update_check";
const KEEP_KEY = "simc.keep";
const PTR_ENABLED_KEY = "simc.ptr_enabled";
/** Set once the first-start update to the latest nightly has been queued; never queued again. */
const FIRST_UPDATE_KEY = "simc.first_update_queued";

/** A check younger than this is served from the store without touching the network. */
export const CHECK_MAX_AGE_MS = 60 * 60 * 1000;

export type SimcManagerDeps = RegistryDeps & {
  db: Db;
  dataDir: string;
  events: EventBus;
  log?: (message: string) => void;
  /** Tag of the Seed SimC Build shipped in the app, if any; offered when newer than current. */
  seedTag?: () => string | null;
  /** Directory of the Seed SimC Build shipped in the app, laid out like an installed build. */
  seedDir?: () => string | null;
  /** Directory holding the Seed SimC Build's baked item-meta and item-icons, if it has them. */
  seedMetaDir?: () => string | null;
  /** argv that launches a SimC Build directory for the Check Sim. Tests pass the fake `simc`. */
  launch?: Launch;
  now?: () => Date;
};

/** Owns the Current SimC Build: which tag it is, and fetching one when there is none. */
export function createSimcManager(deps: SimcManagerDeps) {
  const {
    db,
    dataDir,
    events,
    log = console.error,
    seedTag = () => null,
    seedDir = () => null,
    seedMetaDir = () => null,
  } = deps;
  const now = deps.now ?? (() => new Date());
  const registry = createRegistryClient(deps);
  let install: SimcInstallState = { state: "idle", error: null };
  /** The last failed item-meta build, for the tag it was for; cleared when a build succeeds. */
  let metaFailure: { tag: string; message: string } | null = null;

  const currentTag = () =>
    db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(CURRENT_KEY)?.value ?? null;

  const putSetting = (key: string, value: string) =>
    db.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );

  const getSetting = (key: string) =>
    db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key)
      ?.value ?? null;

  const setCurrentTag = (tag: string) => putSetting(CURRENT_KEY, tag);

  const storedUpdate = (): SimcUpdateStatus | null => {
    const raw = db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(UPDATE_KEY)?.value;
    if (!raw) return null;
    try {
      const parsed = simcUpdateStatusSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  const storeUpdate = (update: SimcUpdateStatus) => putSetting(UPDATE_KEY, JSON.stringify(update));

  /** The stored check, only if it was made against the build that is current now. */
  const updateFor = (build: SimcBuild | null) => {
    const stored = storedUpdate();
    return build && stored?.currentTag === build.tag ? stored : null;
  };

  const current = async () => {
    const tag = currentTag();
    return tag ? await readInstalledBuild(dataDir, tag) : null;
  };

  const ptrEnabled = () => getSetting(PTR_ENABLED_KEY) === "1";

  /** A build as the status shows it: without its PTR version while PTR Sims are off. */
  const shown = (b: SimcBuild, withPtr: boolean): SimcBuild =>
    withPtr ? b : { ...b, ptrGameDataVersion: null };

  /**
   * The offered target's PTR data change against the current build, when both PTR versions are
   * known: an installed target, or the Seed SimC Build (its `build.json` ships with the app). A
   * nightly that is not installed yet has no known PTR version, so it carries no mark.
   */
  const ptrChangeOf = async (
    build: SimcBuild | null,
    update: SimcUpdateStatus,
  ): Promise<SimcUpdateStatus["ptrChange"]> => {
    const target = update.target;
    const from = build?.ptrGameDataVersion;
    if (!target || !from) return null;
    const known =
      (await readInstalledBuild(dataDir, target.tag)) ??
      (target.source === "seed" && target.tag === seedTag()
        ? await readBuildRecord(seedDir() ?? "", target.tag)
        : null);
    const to = known?.ptrGameDataVersion;
    return to && to !== from ? { from, to } : null;
  };

  const statusOf = async (
    build: SimcBuild | null,
    update: SimcUpdateStatus | null,
  ): Promise<SimcStatusResponse> => {
    const withPtr = ptrEnabled();
    return {
      current: build && shown(build, withPtr),
      install,
      update: update && {
        ...update,
        ptrChange: withPtr ? await ptrChangeOf(build, update) : null,
      },
      installed: (await listInstalledBuilds(dataDir)).map((b) => shown(b, withPtr)),
      keep: keepCount(),
      ptrEnabled: withPtr,
      job: latestOpenSimcJob(db),
      checkSim: build ? getCheckSim(db, build.tag) : null,
      itemMetaError: build && metaFailure?.tag === build.tag ? metaFailure.message : null,
    };
  };

  let inFlight: Promise<void> | null = null;

  /** Single-flight: one check at a time, and callers during a check share it. */
  const runCheck = (build: SimcBuild): Promise<void> => {
    inFlight ??= (async () => {
      const previous = updateFor(build);
      let result: SimcUpdateStatus;
      try {
        // Newer is measured against the newest installed build, not the current one: switching
        // to an older build pins it, and stays quiet until something newer than all of them exists.
        const base = (await listInstalledBuilds(dataDir))[0] ?? build;
        result = {
          ...(await runUpdateCheck({
            fetch: deps.fetch,
            listNightlyTags: () => registry.listNightlyTags(),
            currentTag: base.tag,
            gitRevision: base.gitRevision,
            seedTag: seedTag(),
            now: now(),
          })),
          currentTag: build.tag,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`simc: update check failed: ${message}`);
        // Keep what we knew, but stamp the time: a failing check is not retried on every request.
        // With nothing known yet the state is `error`, not a quiet `up_to_date`.
        result = {
          state: "error",
          aheadBy: 0,
          commits: [],
          branch: null,
          compareUrl: null,
          target: null,
          ...previous,
          currentTag: build.tag,
          checkedAt: now().toISOString(),
          error: message,
        };
      }
      storeUpdate(result);
      events.emit({ type: "simc.status_changed" });
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const keepCount = () => {
    const raw = db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(KEEP_KEY)?.value;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : DEFAULT_KEEP_BUILDS;
  };

  /**
   * Retention: keeps the newest `keep` builds, and never evicts the Current SimC Build or one an
   * unfinished Sim uses (those count towards the number). Never throws: a failed removal is
   * logged and retried at the next eviction.
   */
  const evict = async () => {
    try {
      const installed = await listInstalledBuilds(dataDir);
      const cur = currentTag();
      const keep = new Set<string>([...(cur ? [cur] : []), ...tagsInUse(db)]);
      for (const b of installed) {
        if (keep.size >= keepCount()) break;
        keep.add(b.tag);
      }
      for (const b of installed) {
        if (keep.has(b.tag)) continue;
        await removeBuild(dataDir, b.tag);
        await rm(metaDir(dataDir, b.tag), { recursive: true, force: true });
      }
    } catch (err) {
      log(`simc: eviction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const emitJob = (job: {
    id: number;
    status: SimcJob["status"];
    step: SimcUpdateStep | null;
    tag: string | null;
    error: string | null;
  }) =>
    events.emit({
      type: "simc.update_status",
      jobId: job.id,
      status: job.status,
      step: job.step,
      tag: job.tag,
      error: job.error,
    });

  /** Installs the Seed SimC Build's baked item data when it has some. Never throws. */
  const useSeedMeta = async (tag: string) => {
    const src = seedMetaDir();
    if (!src || tag !== seedTag()) return;
    try {
      await installMetaFrom(dataDir, tag, src);
    } catch (err) {
      log(
        `simc: baked item data unusable, will fetch it: ${err instanceof Error ? err.message : err}`,
      );
    }
  };

  /** Which tag a target means right now, and how to fill a staging directory with it. */
  const resolveTarget = async (
    target: SimcJobTarget,
  ): Promise<{ tag: string; populate: (dir: string) => Promise<void> }> => {
    if (target.kind === "installed") {
      return {
        tag: target.tag,
        populate: async () => {
          throw new Error(`SimC Build ${target.tag} is not installed`);
        },
      };
    }
    if (target.kind === "seed") {
      const tag = seedTag();
      const dir = seedDir();
      if (!tag || !dir) throw new Error("this app ships no Seed SimC Build");
      return { tag, populate: populateFromSeed(dir) };
    }
    const [latest] = await registry.listNightlyTags();
    if (!latest) throw new Error("no SimC nightly tags found on Docker Hub");
    return { tag: latest, populate: populateFromRegistry(registry, latest) };
  };

  /**
   * Runs one `simc_update` Job to a terminal state: fetch into `.partial/`, Check Sim, item
   * data into `meta/<tag>/`, then commit (rename, switch, evict). Never throws. Any failure
   * before the switch removes what the Job made and leaves the Current SimC Build as it was.
   */
  const runJob = async (jobId: number): Promise<void> => {
    if (!startSimcJob(db, jobId)) return;
    events.emit({ type: "queue.changed" });
    const job = getSimcJob(db, jobId);
    if (!job) return;
    let step: SimcUpdateStep = "fetch";
    let tag: string | null = null;
    let staged = false;
    let installedHere = false;
    let metaBuiltHere = false;
    const publish = (status: SimcJob["status"], error: string | null = null) => {
      emitJob({ id: jobId, status, step: status === "done" ? null : step, tag, error });
    };
    const enter = (next: SimcUpdateStep) => {
      step = next;
      setSimcJobStep(db, jobId, next);
      publish("running");
    };

    try {
      enter("fetch");
      const target = await resolveTarget(job.target);
      tag = target.tag;
      setSimcJobTag(db, jobId, tag);
      publish("running");
      let build = await readInstalledBuild(dataDir, tag);
      if (!build) {
        staged = true;
        build = await stageBuild({ dataDir, tag, populate: target.populate });
      }

      enter("check");
      const imp = latestImport(db);
      const tmpRoot = join(dataDir, "tmp");
      await mkdir(tmpRoot, { recursive: true });
      // The Current SimC Build has no Check Sim on this Import yet (a re-import, or a Seed build
      // that never ran one): run it now so the delta against it always exists. Best effort.
      const baseTag = currentTag();
      let baseline: Awaited<ReturnType<typeof runCheckSim>> | null = null;
      if (imp && baseTag && baseTag !== tag && !hasCheckSim(db, baseTag, imp.id)) {
        baseline = await runCheckSim({
          dir: buildDir(dataDir, baseTag),
          tmpRoot,
          addonString: imp.text,
          launch: deps.launch,
        }).catch((err) => {
          log(
            `simc: baseline check sim of ${baseTag} failed: ${err instanceof Error ? err.message : err}`,
          );
          return null;
        });
      }
      const { dps, durationMs, iterations } = await runCheckSim({
        dir: staged ? partialDir(dataDir, tag) : buildDir(dataDir, tag),
        tmpRoot,
        addonString: imp?.text ?? null,
        launch: deps.launch,
      });

      enter("meta");
      let hadMeta = (await readBuildMeta(dataDir, tag)) !== null;
      if (!hadMeta && job.target.kind === "seed") {
        await useSeedMeta(tag);
        hadMeta = (await readBuildMeta(dataDir, tag)) !== null;
        metaBuiltHere = hadMeta;
      }
      await ensureBuildMeta({ dataDir, build, fetch: deps.fetch, sleep: deps.sleep });
      if (metaFailure?.tag === tag) metaFailure = null;
      metaBuiltHere ||= !hadMeta;

      enter("commit");
      if (staged) {
        await commitBuild(dataDir, tag);
        installedHere = true;
      }
      const before = currentTag();
      db.transaction(() => {
        setCurrentTag(build.tag);
        if (imp) {
          if (baseline && before && before !== build.tag) {
            saveCheckSim(db, {
              buildTag: before,
              importId: imp.id,
              previousTag: null,
              dps: baseline.dps,
              durationMs: baseline.durationMs,
              iterations: baseline.iterations,
            });
          }
          saveCheckSim(db, {
            buildTag: build.tag,
            importId: imp.id,
            previousTag:
              before === build.tag ? (getCheckSim(db, build.tag)?.previous?.tag ?? null) : before,
            dps,
            durationMs,
            iterations,
          });
        }
      })();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`simc: update job ${jobId} failed at ${step}: ${message}`);
      if (tag && staged) await discardPartial(dataDir, tag);
      if (tag && installedHere) await removeBuild(dataDir, tag).catch(() => {});
      if (tag && staged && metaBuiltHere) {
        await rm(metaDir(dataDir, tag), { recursive: true, force: true }).catch(() => {});
      }
      failSimcJob(db, jobId, step, message);
      publish("failed", message);
      events.emit({ type: "simc.status_changed" });
      events.emit({ type: "queue.changed" });
      return;
    }
    await evict();
    finishSimcJob(db, jobId);
    publish("done");
    events.emit({ type: "simc.status_changed" });
    events.emit({ type: "queue.changed" });
  };

  /**
   * Queues a SimC Update Job. Refused while another is queued or running, when an installed
   * target isn't installed, and when a seed target has no Seed SimC Build.
   */
  const queueJob = async (
    target: SimcJobTarget,
  ): Promise<
    { ok: true; job: SimcJob } | { ok: false; reason: "busy" | "not_installed" | "no_seed" }
  > => {
    if (target.kind === "installed" && !(await readInstalledBuild(dataDir, target.tag))) {
      return { ok: false, reason: "not_installed" };
    }
    if (target.kind === "seed" && !(seedTag() && seedDir())) {
      return { ok: false, reason: "no_seed" };
    }
    const queued = queueSimcJob(db, target);
    if (!queued.ok) return queued;
    emitJob(queued.job);
    events.emit({ type: "simc.status_changed" });
    events.emit({ type: "queue.changed" });
    return queued;
  };

  /** Makes the Seed SimC Build the installed build, from the app's own copy: no network. */
  const installSeed = async (): Promise<SimcBuild> => {
    const tag = seedTag();
    const dir = seedDir();
    if (!tag || !dir) throw new Error("this app ships no Seed SimC Build");
    const build = await stageBuild({ dataDir, tag, populate: populateFromSeed(dir) });
    try {
      await commitBuild(dataDir, tag);
    } catch (err) {
      await discardPartial(dataDir, tag);
      throw err;
    }
    await useSeedMeta(tag);
    return build;
  };

  return {
    /** The Current SimC Build, or null when none is installed. */
    current,

    /**
     * Startup cleanup, before the runner starts: staging directories are deleted and a
     * SimC Update Job that was running when the process died goes back to the Queue, to start
     * again from step 1.
     */
    recover(): void {
      rmSync(join(simcRoot(dataDir), ".partial"), { recursive: true, force: true });
      rmSync(join(metaRoot(dataDir), ".partial"), { recursive: true, force: true });
      requeueInterruptedSimcJobs(db);
    },

    runJob,

    queueJob,

    /** Sets how many builds to keep (at least 1) and evicts down to it right away. */
    async setKeep(keep: number): Promise<void> {
      putSetting(KEEP_KEY, String(keep));
      await evict();
      events.emit({ type: "simc.status_changed" });
    },

    /** Whether PTR Sims are on. */
    ptrEnabled,

    /** Turns PTR Sims on or off. It changes only what is shown and what can be started. */
    setPtrEnabled(enabled: boolean): void {
      putSetting(PTR_ENABLED_KEY, enabled ? "1" : "0");
      events.emit({ type: "simc.status_changed" });
    },

    /** The stored state, instantly. A stale one (over an hour old) starts a background check. */
    async status(): Promise<SimcStatusResponse> {
      const build = await current();
      const update = updateFor(build);
      if (build && !inFlight) {
        const age = update ? now().getTime() - Date.parse(update.checkedAt) : Infinity;
        if (!(age < CHECK_MAX_AGE_MS)) void runCheck(build);
      }
      return statusOf(build, update);
    },

    /** Forces a check now, ignoring the hour. Resolves with the stored result; null with no build. */
    async check(): Promise<SimcStatusResponse> {
      const build = await current();
      if (build) await (inFlight ?? runCheck(build));
      return statusOf(build, updateFor(build));
    },

    /** Resolves when any background check has finished. For tests and shutdown. */
    async idle(): Promise<void> {
      await inFlight;
    },

    /**
     * With no Current SimC Build, installs the latest nightly and makes it current. Either way
     * the Current SimC Build then gets its item-meta and item-icons if it lacks them. Never
     * throws: a failure is logged and reported by `status()`, and the app carries on without it.
     */
    async boot(): Promise<void> {
      const tag = currentTag();
      let current = tag ? await readInstalledBuild(dataDir, tag) : null;
      if (!current) {
        install = { state: "installing", error: null };
        events.emit({ type: "simc.status_changed" });
        try {
          let seeded = false;
          if (seedTag() && seedDir()) {
            try {
              current = await installSeed();
              seeded = true;
            } catch (err) {
              log(
                `simc: could not install the Seed SimC Build: ${err instanceof Error ? err.message : err}`,
              );
            }
          }
          if (!current) {
            const [latest] = await registry.listNightlyTags();
            if (!latest) throw new Error("no SimC nightly tags found on Docker Hub");
            current = await installBuild({ dataDir, tag: latest, registry });
          }
          setCurrentTag(current.tag);
          // Exactly one update to the latest nightly, ever: the flag outlives a failed Job, so
          // later starts stay quiet and the failure is shown for the user to retry.
          const firstStart = seeded && !getSetting(FIRST_UPDATE_KEY);
          if (firstStart) {
            putSetting(FIRST_UPDATE_KEY, "1");
            await queueJob({ kind: "nightly" });
          }
          install = { state: "idle", error: null };
          events.emit({ type: "simc.status_changed" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(`simc: could not install a SimC Build, continuing without one: ${message}`);
          install = { state: "failed", error: message };
          events.emit({ type: "simc.status_changed" });
          return;
        }
      }
      // Missing item data must not undo an install: sims still run, and the next boot retries.
      try {
        await ensureBuildMeta({ dataDir, build: current, fetch: deps.fetch, sleep: deps.sleep });
        if (metaFailure?.tag === current.tag) metaFailure = null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`simc: could not build item-meta and item-icons for ${current.tag}: ${message}`);
        metaFailure = { tag: current.tag, message };
      }
      events.emit({ type: "simc.status_changed" });
    },
  };
}

export type SimcManager = ReturnType<typeof createSimcManager>;
