import { createApp } from "./app";
import { loadConfig } from "./config";
import { loadSeed } from "./simc/seed";

const config = loadConfig();
const seed = loadSeed(config.seedDir);
const app = createApp(config, {
  debugLogs: process.env.SIMBOT_DEBUG_LOGS === "1",
  seedTag: () => seed?.tag ?? null,
  seedDir: () => seed?.dir ?? null,
  seedMetaDir: () => seed?.metaDir ?? null,
});
const server = Bun.serve({ port: config.port, fetch: app.fetch });
void app.boot();
console.log(`simbot listening on ${server.url} (data: ${config.dataDir})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.stop();
    app.close();
    process.exit(0);
  });
}
