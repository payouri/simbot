import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = createApp(config);
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
