import { resolve } from "node:path";

export type Config = {
  /** Root of the `/data` volume. On the host this is `./data` at the repo root. */
  dataDir: string;
  /** Directory holding the built client (`apps/client/dist`). */
  clientDir: string;
  port: number;
  /** Where the image ships the Seed SimC Build (`SIMBOT_SEED_DIR`); unset outside the image. */
  seedDir: string | undefined;
};

const repoRoot = resolve(import.meta.dir, "../../..");

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    dataDir: resolve(env.SIMBOT_DATA_DIR ?? resolve(repoRoot, "data")),
    clientDir: resolve(env.SIMBOT_CLIENT_DIR ?? resolve(repoRoot, "apps/client/dist")),
    port: Number(env.PORT ?? 3000),
    seedDir: env.SIMBOT_SEED_DIR ? resolve(env.SIMBOT_SEED_DIR) : undefined,
  };
}
