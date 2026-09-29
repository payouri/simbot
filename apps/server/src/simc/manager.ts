import {
  type SimcBuild,
  type SimcInstallState,
  type SimcStatusResponse,
  type SimcUpdateStatus,
  simcUpdateStatusSchema,
} from "@simbot/shared";
import type { Db } from "../db";
import type { EventBus } from "../events";
import { installBuild, readInstalledBuild } from "./install";
import { ensureBuildMeta } from "./meta";
import { createRegistryClient, type RegistryDeps } from "./registry";
import { runUpdateCheck } from "./updates";

const CURRENT_KEY = "simc.current_tag";
const UPDATE_KEY = "simc.update_check";

/** A check younger than this is served from the store without touching the network. */
export const CHECK_MAX_AGE_MS = 60 * 60 * 1000;

export type SimcManagerDeps = RegistryDeps & {
  db: Db;
  dataDir: string;
  events: EventBus;
  log?: (message: string) => void;
  /** Tag of the Seed SimC Build shipped in the app, if any; offered when newer than current. */
  seedTag?: () => string | null;
  now?: () => Date;
};

/** Owns the Current SimC Build: which tag it is, and fetching one when there is none. */
export function createSimcManager(deps: SimcManagerDeps) {
  const { db, dataDir, events, log = console.error, seedTag = () => null } = deps;
  const now = deps.now ?? (() => new Date());
  const registry = createRegistryClient(deps);
  let install: SimcInstallState = { state: "idle", error: null };

  const currentTag = () =>
    db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(CURRENT_KEY)?.value ?? null;

  const putSetting = (key: string, value: string) =>
    db.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );

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

  let inFlight: Promise<void> | null = null;

  /** Single-flight: one check at a time, and callers during a check share it. */
  const runCheck = (build: SimcBuild): Promise<void> => {
    inFlight ??= (async () => {
      const previous = updateFor(build);
      let result: SimcUpdateStatus;
      try {
        result = await runUpdateCheck({
          fetch: deps.fetch,
          listNightlyTags: () => registry.listNightlyTags(),
          currentTag: build.tag,
          gitRevision: build.gitRevision,
          seedTag: seedTag(),
          now: now(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`simc: update check failed: ${message}`);
        // Keep what we knew, but stamp the time: a failing check is not retried on every request.
        result = {
          state: "up_to_date",
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

  return {
    /** The Current SimC Build, or null when none is installed. */
    current,

    /** The stored state, instantly. A stale one (over an hour old) starts a background check. */
    async status(): Promise<SimcStatusResponse> {
      const build = await current();
      const update = updateFor(build);
      if (build && !inFlight) {
        const age = update ? now().getTime() - Date.parse(update.checkedAt) : Infinity;
        if (!(age < CHECK_MAX_AGE_MS)) void runCheck(build);
      }
      return { current: build, install, update };
    },

    /** Forces a check now, ignoring the hour. Resolves with the stored result; null with no build. */
    async check(): Promise<SimcStatusResponse> {
      const build = await current();
      if (build) await (inFlight ?? runCheck(build));
      return { current: build, install, update: updateFor(build) };
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
          const [latest] = await registry.listNightlyTags();
          if (!latest) throw new Error("no SimC nightly tags found on Docker Hub");
          current = await installBuild({ dataDir, tag: latest, registry });
          setCurrentTag(current.tag);
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`simc: could not build item-meta and item-icons for ${current.tag}: ${message}`);
      }
    },
  };
}

export type SimcManager = ReturnType<typeof createSimcManager>;
