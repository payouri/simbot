import type { Config } from "./config";
import { openDb } from "./db";
import { createHttpHandler } from "./http";
import { startRunner } from "./runner";
import { createSimcManager } from "./simc/manager";
import type { Fetch } from "./simc/registry";

export type AppDeps = {
  /** All Docker Hub and registry traffic goes through this. Defaults to the global `fetch`. */
  fetch?: Fetch;
  /** Backoff wait between retries; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

/** The server seam: everything the process does, minus binding a port and the boot fetch. */
export function createApp(config: Pick<Config, "dataDir" | "clientDir">, deps: AppDeps = {}) {
  const db = openDb(config.dataDir);
  const runner = startRunner(db);
  const simc = createSimcManager({
    db,
    dataDir: config.dataDir,
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep,
    log: deps.log,
  });
  const handle = createHttpHandler({
    db,
    clientDir: config.clientDir,
    simcStatus: () => simc.status(),
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
    close() {
      runner.stop();
      db.close();
    },
  };
}
