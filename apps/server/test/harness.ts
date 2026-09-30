import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type AppEvent,
  appEventSchema,
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
import type { Fetch } from "../src/simc/registry";

export const FIXTURES = join(import.meta.dir, "fixtures/quick-sim");
export const FAKE_SIMC = join(import.meta.dir, "fake-simc/fake-simc.ts");
export const addonString = () => readFileSync(join(FIXTURES, "addon-string.txt"), "utf8");

export const BUILD_TAG = "1210-2026-09-29-d08a1c3";

/** Launches the fake `simc` replaying the scenario directory `scenario()` names at launch time. */
export const fakeLaunch =
  (
    scenario: () => string,
    report: () => string | undefined = () => undefined,
    gate: () => string | undefined = () => undefined,
    stubborn: () => boolean = () => false,
  ): Launch =>
  (_buildDir, args) => {
    const reportPath = report();
    const gatePath = gate();
    return [
      process.execPath,
      FAKE_SIMC,
      `--scenario=${scenario()}`,
      ...(reportPath ? [`--report=${reportPath}`] : []),
      ...(gatePath ? [`--gate=${gatePath}`] : []),
      ...(stubborn() ? ["--stubborn"] : []),
      ...args,
    ];
  };

/** What the fake `simc` was asked in one launch, read off its input file. */
export type FakeStageCall = {
  /** From the input file's name (`stage-<n>.simc`). */
  stage: number;
  /** Profileset names in the input, in order. */
  names: string[];
  targetError: number;
  input: string;
  /** How many times the fake has launched so far, this one included. */
  call: number;
};

/** What the fake `simc` answers: the base actor and each profileset as `[mean, meanError]`. */
export type FakeStageReply = {
  baseline?: [number, number];
  profilesets?: Record<string, [number, number]>;
  exit?: number;
  stderr?: string;
  /** Write a report with no `profilesets` block at all. */
  noProfilesets?: boolean;
  /** The launch waits for this file before writing its report (mid-Stage observation). */
  gate?: string;
};

/**
 * Launches a fake `simc` that answers a Smart Sim Stage: `reply` decides, from what the input
 * asks for, the report (written with the profilesets in reverse, since SimC's order is not
 * ours), the exit code and stderr. Calls are appended to `calls`.
 */
export function smartLaunch(
  root: () => string,
  reply: (call: FakeStageCall) => FakeStageReply,
  calls: FakeStageCall[] = [],
): Launch {
  return (_buildDir, args) => {
    const inputPath = args[0] as string;
    const input = readFileSync(inputPath, "utf8");
    const call: FakeStageCall = {
      stage: Number(/stage-(\d+)\.simc$/.exec(inputPath)?.[1] ?? 0),
      names: [...input.matchAll(/^profileset\."([^"]+)"\+=profileset_controller/gm)].map(
        (m) => m[1] as string,
      ),
      targetError: Number(/^target_error=(.*)$/m.exec(input)?.[1] ?? 0),
      input,
      call: calls.length + 1,
    };
    calls.push(call);
    const r = reply(call);
    const dir = mkdtempSync(join(root(), "smart-"));
    const [mean, err] = r.baseline ?? [100_000, 100];
    const sets = Object.entries(r.profilesets ?? {});
    const stdout = [
      `Baseline\t1\t${sets.length + 1}\t100\t100\t20.000\t${mean}\t0.500\t1`,
      ...sets.map(
        ([name, [m]], i) =>
          `Profileset\t${name}\t${i + 2}\t${sets.length + 1}\t100\t100\t20.000\t${m}\t0.500\t1`,
      ),
    ];
    writeFileSync(join(dir, "stdout.txt"), `${stdout.join("\n")}\n`);
    if (r.stderr) writeFileSync(join(dir, "stderr.txt"), r.stderr);
    if (r.exit) writeFileSync(join(dir, "exit"), String(r.exit));
    if (!r.exit) {
      writeFileSync(
        join(dir, "json2.json"),
        JSON.stringify({
          sim: {
            options: { confidence_estimator: 2 },
            players: [{ collected_data: { dps: { mean, mean_std_dev: err / 2 } } }],
            profilesets: r.noProfilesets
              ? undefined
              : {
                  results: sets
                    .map(([name, [m, e]]) => ({ name, mean: m, mean_error: e, iterations: 100 }))
                    .reverse(),
                },
          },
        }),
      );
    }
    return [
      process.execPath,
      FAKE_SIMC,
      `--scenario=${dir}`,
      ...(r.gate ? [`--gate=${r.gate}`] : []),
      ...args,
    ];
  };
}

/** Boot recovery's test for "is this stored PID still `simc`": the fake one is a `bun` script. */
export const isFakeSimc = (pid: number): boolean => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("fake-simc.ts");
  } catch {
    return false;
  }
};

/** Whether a process is running (a zombie awaiting its reaper does not count). */
export const isAlive = (pid: number): boolean => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
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

export const IMPORT_ITEMS = join(import.meta.dir, "fixtures/import-items");
export const importItemsAddonString = () =>
  readFileSync(join(IMPORT_ITEMS, "addon-string.txt"), "utf8");

/** Installs the trimmed item-meta and item-icons of the import-items fixture for `tag`. */
export function installFixtureMeta(dataDir: string, tag: string = BUILD_TAG) {
  const dir = join(dataDir, "meta", tag);
  mkdirSync(dir, { recursive: true });
  for (const file of ["item-meta.json", "item-icons.json"]) {
    const data = JSON.parse(readFileSync(join(IMPORT_ITEMS, file), "utf8"));
    writeFileSync(join(dir, file), JSON.stringify({ ...data, tag }));
  }
}

export type Harness = ReturnType<typeof makeHarness>;

/** A temp data dir plus an app over it, with typed helpers for the Quick Sim REST calls. */
export function makeHarness(
  opts: {
    launch?: Launch;
    withBuild?: boolean;
    debugLogs?: boolean;
    progressIntervalMs?: number;
    killGraceMs?: number;
    fetch?: Fetch;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "simbot-quick-"));
  const dataDir = join(root, "data");
  const app = createApp(
    { dataDir, clientDir: join(root, "client") },
    {
      launch: opts.launch,
      fetch: opts.fetch,
      log: () => {},
      debugLogs: opts.debugLogs,
      progressIntervalMs: opts.progressIntervalMs,
      killGraceMs: opts.killGraceMs,
      isSimcProcess: isFakeSimc,
    },
  );
  if (opts.withBuild ?? true) installFakeBuild(dataDir, app, BUILD_TAG);

  const call = (method: string, path: string, body?: unknown) =>
    app.fetch(
      new Request(`http://simbot.test${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
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
    /** `POST /api/sims/:id/stop`; the raw response, since callers check status codes. */
    stop: (id: number, keep: boolean) => call("POST", `/api/sims/${id}/stop`, { keep }),
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
    /** Connects to `GET /api/events` and collects every event, validated against the shared union. */
    async subscribe() {
      const abort = new AbortController();
      const res = await app.fetch(
        new Request("http://simbot.test/api/events", { signal: abort.signal }),
      );
      const events: AppEvent[] = [];
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const pump = (async () => {
        try {
          for (;;) {
            const chunk = await reader?.read();
            if (!chunk || chunk.done) return;
            buffer += decoder.decode(chunk.value, { stream: true });
            for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const data = frame.split("\n").find((l) => l.startsWith("data: "));
              if (data) events.push(appEventSchema.parse(JSON.parse(data.slice(6))));
            }
          }
        } catch {
          // Aborted.
        }
      })();
      return {
        events,
        /** Polls until an event matches; fails the test after `ms`. */
        async waitFor(match: (e: AppEvent) => boolean, ms = 5000) {
          const stop = Date.now() + ms;
          while (!events.some(match)) {
            if (Date.now() > stop) throw new Error(`timed out; got ${JSON.stringify(events)}`);
            await new Promise((r) => setTimeout(r, 10));
          }
        },
        close() {
          abort.abort();
          void pump;
        },
      };
    },
    simFile: (simId: number, name: string) => join(dataDir, "sims", String(simId), name),
    readGz: (path: string) => gunzipSync(readFileSync(path)).toString("utf8"),
    close() {
      app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
