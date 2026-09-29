import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type Import,
  importSchema,
  type Sim,
  type SimResultsResponse,
  type SimSettings,
  simcBuildSchema,
  simResultsResponseSchema,
  simSchema,
} from "@simbot/shared";
import { createApp } from "../src/app";
import type { Launch } from "../src/runner/run-sim";

export const FIXTURES = join(import.meta.dir, "fixtures/quick-sim");
export const FAKE_SIMC = join(import.meta.dir, "fake-simc/fake-simc.ts");
export const addonString = () => readFileSync(join(FIXTURES, "addon-string.txt"), "utf8");

export const BUILD_TAG = "1210-2026-09-29-d08a1c3";

/** Launches the fake `simc` replaying the scenario directory `scenario()` names at launch time. */
export const fakeLaunch =
  (scenario: () => string, report: () => string | undefined = () => undefined): Launch =>
  (_buildDir, args) => {
    const reportPath = report();
    return [
      process.execPath,
      FAKE_SIMC,
      `--scenario=${scenario()}`,
      ...(reportPath ? [`--report=${reportPath}`] : []),
      ...args,
    ];
  };

/** A scenario directory that starts as a copy of a recorded one, then applies `edit`. */
export function derivedScenario(
  root: string,
  from: string,
  edit: (files: Record<string, Buffer | null>) => void,
): string {
  const files: Record<string, Buffer | null> = {};
  for (const name of ["stdout.txt", "stderr.txt", "json2.json.gz", "exit"]) {
    try {
      files[name] = readFileSync(join(FIXTURES, from, name));
    } catch {
      files[name] = null;
    }
  }
  edit(files);
  const dir = mkdtempSync(join(root, "scenario-"));
  for (const [name, content] of Object.entries(files)) {
    if (content) writeFileSync(join(dir, name), content);
  }
  return dir;
}

/** Marks `tag` as an installed SimC Build and as the Current one. */
export function installFakeBuild(dataDir: string, app: ReturnType<typeof createApp>, tag: string) {
  const dir = join(dataDir, "simc", tag);
  mkdirSync(dir, { recursive: true });
  const build = simcBuildSchema.parse({
    tag,
    simcVersion: "1210-01",
    gitRevision: tag.split("-").at(-1),
    gitBranch: "midnight",
    gameDataVersion: "12.1.0.69933",
  });
  writeFileSync(join(dir, "build.json"), JSON.stringify(build));
  app.db.run(
    "INSERT INTO settings (key, value) VALUES ('simc.current_tag', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [tag],
  );
}

export type Harness = ReturnType<typeof makeHarness>;

/** A temp data dir plus an app over it, with typed helpers for the Quick Sim REST calls. */
export function makeHarness(opts: { launch?: Launch; withBuild?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "simbot-quick-"));
  const dataDir = join(root, "data");
  const app = createApp(
    { dataDir, clientDir: join(root, "client") },
    { launch: opts.launch, log: () => {} },
  );
  if (opts.withBuild ?? true) installFakeBuild(dataDir, app, BUILD_TAG);

  const call = (method: string, path: string, body?: unknown) =>
    app.fetch(
      new Request(`http://simbot.test${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  return {
    root,
    dataDir,
    app,
    call,
    async importText(text: string = addonString()): Promise<Import> {
      const res = await call("POST", "/api/imports", { text });
      return importSchema.parse(await res.json());
    },
    async createSim(importId: number, settings?: Partial<SimSettings>): Promise<Sim> {
      const res = await call("POST", "/api/sims", { importId, settings });
      return simSchema.parse(await res.json());
    },
    async queue(id: number): Promise<Sim> {
      const res = await call("POST", `/api/sims/${id}/queue`);
      return simSchema.parse(await res.json());
    },
    async sim(id: number): Promise<Sim> {
      return simSchema.parse(await (await call("GET", `/api/sims/${id}`)).json());
    },
    async results(id: number): Promise<SimResultsResponse> {
      return simResultsResponseSchema.parse(
        await (await call("GET", `/api/sims/${id}/results`)).json(),
      );
    },
    /** Import, create, queue and wait for the runner to finish. */
    async runQuickSim(settings?: Partial<SimSettings>): Promise<Sim> {
      const imp = await this.importText();
      const draft = await this.createSim(imp.id, settings);
      await this.queue(draft.id);
      await app.idle();
      return this.sim(draft.id);
    },
    simFile: (simId: number, name: string) => join(dataDir, "sims", String(simId), name),
    readGz: (path: string) => gunzipSync(readFileSync(path)).toString("utf8"),
    close() {
      app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
