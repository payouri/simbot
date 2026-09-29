import type { Config } from "./config";
import { openDb } from "./db";
import { createEventBus } from "./events";
import { createHttpHandler } from "./http";
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
};

/** The server seam: everything the process does, minus binding a port and the boot fetch. */
export function createApp(config: Pick<Config, "dataDir" | "clientDir">, deps: AppDeps = {}) {
  const db = openDb(config.dataDir);
  const bus = createEventBus();
  const simc = createSimcManager({
    db,
    dataDir: config.dataDir,
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep,
    log: deps.log,
  });
  const runner = startRunner({
    db,
    bus,
    dataDir: config.dataDir,
    currentBuild: () => simc.current(),
    launch: deps.launch,
    log: deps.log,
  });
  const handle = createHttpHandler({
    db,
    bus,
    clientDir: config.clientDir,
    simcStatus: () => simc.status(),
  });
  return {
    db,
    fetch: (req: Request) => handle(req),
    /** Resolves once the Queue is empty and no Sim is running. */
    idle: () => runner.idle(),
    /**
     * Boot work that needs the network: with no Current SimC Build, installs the latest
     * nightly. Resolves when done and never rejects; `main` starts it without awaiting
     * so the server answers while the download runs.
     */
    boot: () => simc.boot(),
    close() {
      runner.stop();
      db.close();
    },
  };
}
