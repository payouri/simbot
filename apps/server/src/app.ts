import type { Config } from "./config";
import { openDb } from "./db";
import { createHttpHandler } from "./http";
import { startRunner } from "./runner";

/** The server seam: everything the process does, minus binding a port. */
export function createApp(config: Pick<Config, "dataDir" | "clientDir">) {
  const db = openDb(config.dataDir);
  const runner = startRunner(db);
  const handle = createHttpHandler({ db, clientDir: config.clientDir });
  return {
    db,
    fetch: (req: Request) => handle(req),
    close() {
      runner.stop();
      db.close();
    },
  };
}
