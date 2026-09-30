/**
 * A real server process over the fake `simc`, for tests that must crash and restart it.
 * Env: DATA_DIR, SCENARIO (fake-simc scenario dir), GATE and REPORT (fake-simc files).
 * Prints the port it listens on as its first stdout line.
 */
import { join } from "node:path";
import { createApp } from "../src/app";
import { BUILD_TAG, fakeLaunch, installFakeBuild, isFakeSimc } from "./harness";

const dataDir = process.env.DATA_DIR as string;
const scenario = process.env.SCENARIO as string;
const app = createApp(
  { dataDir, clientDir: join(dataDir, "client") },
  {
    launch: fakeLaunch(
      () => scenario,
      () => process.env.REPORT,
      () => process.env.GATE,
    ),
    isSimcProcess: isFakeSimc,
    log: () => {},
  },
);
installFakeBuild(dataDir, app, BUILD_TAG);
const server = Bun.serve({ port: 0, fetch: app.fetch });
console.log(server.port);
