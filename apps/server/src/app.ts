import { createCombinationService } from "./combinations";
import type { Config } from "./config";
import { openDb } from "./db";
import { getFrozenCombinations, getSim } from "./db/sims";
import { createEventBus } from "./events";
import { createHttpHandler } from "./http";
import { createIconService } from "./icons";
import { createLiveTracker } from "./live";
import { startRunner } from "./runner";
import { type IsSimcProcess, recoverInterruptedRuns } from "./runner/recovery";
import type { Launch } from "./runner/run-sim";
import { createItemIndexer } from "./simc/item-index";
import { createSimcManager } from "./simc/manager";
import type { Fetch } from "./simc/registry";

export type AppDeps = {
  /** All Docker Hub and registry traffic goes through this. Defaults to the global `fetch`. */
  fetch?: Fetch;
  /** Backoff wait between retries; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  /** argv that launches a SimC Build directory. Tests pass the fake `simc`. */
  launch?: Launch;
  /** Tag of the Seed SimC Build shipped in the app, if any. */
  seedTag?: () => string | null;
  /** Directory of the Seed SimC Build shipped in the app, laid out like an installed build. */
  seedDir?: () => string | null;
  /** Directory holding the Seed SimC Build's baked item-meta and item-icons. */
  seedMetaDir?: () => string | null;
  now?: () => Date;
  /** Dev flag: SimC's non-progress stdout also goes out as `sim.log` at `debug`. */
  debugLogs?: boolean;
  /** Minimum gap between `sim.progress` events (default 250 ms). Tests shrink it. */
  progressIntervalMs?: number;
  /** How long SimC gets to exit after SIGTERM before SIGKILL (default 5 s). Tests shrink it. */
  killGraceMs?: number;
  /** Whether a stored PID is still `simc` (default: asks `/proc`). The fake `simc` needs its own. */
  isSimcProcess?: IsSimcProcess;
};

/** The server seam: everything the process does, minus binding a port and the boot fetch. */
export function createApp(config: Pick<Config, "dataDir" | "clientDir">, deps: AppDeps = {}) {
  const db = openDb(config.dataDir);
  const bus = createEventBus();
  const live = createLiveTracker(bus);
  const simc = createSimcManager({
    db,
    dataDir: config.dataDir,
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep,
    log: deps.log,
    events: bus,
    seedTag: deps.seedTag,
    seedDir: deps.seedDir,
    seedMetaDir: deps.seedMetaDir,
    launch: deps.launch,
    now: deps.now,
  });
  // Before the runner starts: staging directories go, an interrupted SimC Job restarts, and
  // an orphaned `simc` is killed with its interrupted Sim Job put back in the Queue.
  simc.recover();
  recoverInterruptedRuns({ db, dataDir: config.dataDir, bus, isSimc: deps.isSimcProcess });
  const items = createItemIndexer({
    db,
    dataDir: config.dataDir,
    currentBuild: () => simc.current(),
    launch: deps.launch,
    log: deps.log,
  });
  const combinations = createCombinationService({
    db,
    items,
    currentBuild: () => simc.current(),
  });
  const runner = startRunner({
    db,
    bus,
    dataDir: config.dataDir,
    currentBuild: () => simc.current(),
    launch: deps.launch,
    log: deps.log,
    debugLogs: deps.debugLogs,
    progressIntervalMs: deps.progressIntervalMs,
    killGraceMs: deps.killGraceMs,
    runSimcJob: simc.runJob,
    revalidate: async (simId) => {
      const sim = getSim(db, simId);
      if (!sim) return [];
      const issues = await combinations.revalidate(sim, getFrozenCombinations(db, simId));
      return issues.map((i) => i.message);
    },
  });
  const icons = createIconService({ dataDir: config.dataDir, fetch: deps.fetch ?? fetch });
  const handle = createHttpHandler({
    db,
    dataDir: config.dataDir,
    bus,
    live,
    items,
    icons,
    combinations,
    clientDir: config.clientDir,
    simc: {
      status: () => simc.status(),
      check: () => simc.check(),
      queueJob: (target) => simc.queueJob(target),
      setKeep: (keep) => simc.setKeep(keep),
      setPtrEnabled: (enabled) => simc.setPtrEnabled(enabled),
    },
  });
  return {
    db,
    /** The in-process event bus, for tests that watch what the app emits. */
    bus,
    combinations,
    fetch: (req: Request) => handle(req),
    /**
     * Boot work that needs the network: with no Current SimC Build, installs the latest
     * nightly. Resolves when done and never rejects; `main` starts it without awaiting
     * so the server answers while the download runs.
     */
    boot: () => simc.boot(),
    /** Resolves once the Queue is empty, no Sim is running and no SimC Update check is in flight. */
    idle: async () => {
      await Promise.all([runner.idle(), simc.idle()]);
    },
    close() {
      runner.stop();
      db.close();
    },
  };
}
