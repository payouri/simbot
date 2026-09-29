import type { Config } from "./config";
import { openDb } from "./db";
import { createEventBus } from "./events";
import { createHttpHandler } from "./http";
import { createLiveTracker } from "./live";
import { startRunner } from "./runner";
import type { Launch } from "./runner/run-sim";
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
  now?: () => Date;
  /** Dev flag: SimC's non-progress stdout also goes out as `sim.log` at `debug`. */
  debugLogs?: boolean;
  /** Minimum gap between `sim.progress` events (default 250 ms). Tests shrink it. */
  progressIntervalMs?: number;
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
    now: deps.now,
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
  });
  const handle = createHttpHandler({
    db,
    bus,
    live,
    clientDir: config.clientDir,
    simc: { status: () => simc.status(), check: () => simc.check() },
  });
  return {
    db,
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
