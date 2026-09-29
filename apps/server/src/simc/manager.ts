import type { SimcInstallState, SimcStatusResponse } from "@simbot/shared";
import type { Db } from "../db";
import { installBuild, readInstalledBuild } from "./install";
import { createRegistryClient, type RegistryDeps } from "./registry";

const CURRENT_KEY = "simc.current_tag";

export type SimcManagerDeps = RegistryDeps & {
  db: Db;
  dataDir: string;
  log?: (message: string) => void;
};

/** Owns the Current SimC Build: which tag it is, and fetching one when there is none. */
export function createSimcManager(deps: SimcManagerDeps) {
  const { db, dataDir, log = console.error } = deps;
  const registry = createRegistryClient(deps);
  let install: SimcInstallState = { state: "idle", error: null };

  const currentTag = () =>
    db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(CURRENT_KEY)?.value ?? null;

  const setCurrentTag = (tag: string) =>
    db.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [CURRENT_KEY, tag],
    );

  return {
    async status(): Promise<SimcStatusResponse> {
      const tag = currentTag();
      return { current: tag ? await readInstalledBuild(dataDir, tag) : null, install };
    },

    /**
     * With no Current SimC Build, installs the latest nightly and makes it current. Never
     * throws: a failure is logged and reported by `status()`, and the app carries on without one.
     */
    async boot(): Promise<void> {
      const tag = currentTag();
      if (tag && (await readInstalledBuild(dataDir, tag))) return;
      install = { state: "installing", error: null };
      try {
        const [latest] = await registry.listNightlyTags();
        if (!latest) throw new Error("no SimC nightly tags found on Docker Hub");
        const build = await installBuild({ dataDir, tag: latest, registry });
        setCurrentTag(build.tag);
        install = { state: "idle", error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`simc: could not install a SimC Build, continuing without one: ${message}`);
        install = { state: "failed", error: message };
      }
    },
  };
}

export type SimcManager = ReturnType<typeof createSimcManager>;
