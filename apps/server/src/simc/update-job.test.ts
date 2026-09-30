import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  type AppEvent,
  ptrAvailable,
  type QueueEntry,
  queueResponseSchema,
  type SimcJob,
  type SimcStatusResponse,
  simcJobSchema,
  simcStatusResponseSchema,
} from "@simbot/shared";
import { addonString, derivedScenario, fakeLaunch, installFakeBuild } from "../../test/harness";
import { createApp } from "../app";
import { getQueue } from "../db/queue";
import { fakeRegistry, json2, LATEST_NIGHTLY } from "./registry-fixture";

const OLD = "1210-2026-09-27-7ffaabf";
const MID = "1210-2026-09-28-4c7c736";

let root: string;
let dataDir: string;
let app: ReturnType<typeof createApp>;
let scenario: string;
const sleeps: number[] = [];
const logs: string[] = [];
const events: AppEvent[] = [];
const reports: string[] = [];

type Handler = Parameters<typeof fakeRegistry>[0];

/** A Check Sim report: the Quick Sim slice plus the profileset result. */
function checkScenario(opts: { mean?: number; exit?: number; profileset?: boolean } = {}) {
  return derivedScenario(root, "success", (files) => {
    const report = JSON.parse(gunzipSync(files["json2.json.gz"] as Buffer).toString());
    report.sim.players[0].collected_data.dps.mean = opts.mean ?? 100_000;
    if (opts.profileset !== false) {
      report.sim.profilesets = { results: [{ name: "Check Sim", mean: opts.mean ?? 100_000 }] };
    }
    files["json2.json.gz"] = Buffer.from(gzipSync(JSON.stringify(report)));
    if (opts.exit) files.exit = Buffer.from(String(opts.exit));
  });
}

/** GitHub answers "nothing ahead", so a check is decided by the Hub tags alone. */
const github: NonNullable<Handler> = (url) => {
  if (url === "https://api.github.com/repos/simulationcraft/simc") {
    return Response.json({ default_branch: "midnight" });
  }
  if (url.startsWith("https://api.github.com/repos/simulationcraft/simc/compare/")) {
    return Response.json({ ahead_by: 0, commits: [], html_url: "https://github.test/compare" });
  }
};

function boot(handler: Handler = () => undefined, extra: Parameters<typeof createApp>[1] = {}) {
  const registry = fakeRegistry((url, n) => handler(url, n) ?? github(url, n));
  app = createApp(
    { dataDir, clientDir: join(root, "client") },
    {
      fetch: registry.fetch,
      sleep: async (ms) => void sleeps.push(ms),
      log: (m) => void logs.push(m),
      launch: fakeLaunch(
        () => scenario,
        () => reports[0],
      ),
      ...extra,
    },
  );
  app.bus.on((e) => void events.push(e as AppEvent));
  return { registry };
}

const call = (method: string, path: string, body?: unknown) =>
  app.fetch(
    new Request(`http://simbot.test${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const status = async (): Promise<SimcStatusResponse> =>
  simcStatusResponseSchema.parse(await (await call("GET", "/api/simc")).json());

const postJob = (target: unknown) => call("POST", "/api/simc/jobs", { target });

/** Queues a job, waits for the Queue to drain, and returns the resulting status. */
async function applyJob(target: unknown): Promise<SimcStatusResponse> {
  const res = await postJob(target);
  expect(res.status).toBe(201);
  await app.idle();
  return status();
}

const readdirSafe = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);
const installedTags = () =>
  readdirSafe(join(dataDir, "simc"))
    .filter((n) => !n.startsWith("."))
    .sort();

const importText = async () =>
  (await (await call("POST", "/api/imports", { text: addonString() })).json()) as { id: number };

const updateEvents = () =>
  events.filter((e): e is Extract<AppEvent, { type: "simc.update_status" }> => {
    return e.type === "simc.update_status";
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "simbot-update-"));
  dataDir = join(root, "data");
  scenario = checkScenario();
  sleeps.length = 0;
  logs.length = 0;
  events.length = 0;
  reports.length = 0;
});

afterEach(async () => {
  await app?.idle();
  app?.close();
  rmSync(root, { recursive: true, force: true });
});

/** Boots an app whose Current SimC Build is the older `OLD`. */
function bootWithOld(handler?: Handler, extra?: Parameters<typeof createApp>[1]) {
  const b = boot(handler, extra);
  installFakeBuild(dataDir, app, OLD);
  // The fake registry serves item data for revision d08a1c3 only.
  const file = join(dataDir, "simc", OLD, "build.json");
  const build = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...build, gitRevision: "d08a1c3" }));
  return b;
}

describe("applying a nightly", () => {
  test("fetch, Check Sim, meta, commit: the new build becomes current, the old one stays installed", async () => {
    bootWithOld();
    const body = await applyJob({ kind: "nightly" });

    expect(body.current?.tag).toBe(LATEST_NIGHTLY);
    expect(body.installed.map((b) => b.tag)).toEqual([LATEST_NIGHTLY, OLD]);
    expect(body.job).toBeNull();
    expect(installedTags()).toEqual([OLD, LATEST_NIGHTLY].sort());
    expect(existsSync(join(dataDir, "meta", LATEST_NIGHTLY, "item-meta.json"))).toBe(true);
    expect(readdirSafe(join(dataDir, "simc", ".partial"))).toEqual([]);
    expect(readdirSafe(join(dataDir, "meta", ".partial"))).toEqual([]);
  });

  test("each step is streamed as simc.update_status, in order", async () => {
    bootWithOld();
    await applyJob({ kind: "nightly" });
    const steps = updateEvents()
      .filter((e) => e.status === "running")
      .map((e) => e.step)
      .filter((step, i, all) => step !== all[i - 1]);
    expect(steps).toEqual(["fetch", "check", "meta", "commit"]);
    const last = updateEvents().at(-1);
    expect(last).toMatchObject({ status: "done", step: null, tag: LATEST_NIGHTLY, error: null });
    expect(updateEvents()[0]).toMatchObject({ status: "queued" });
  });

  test("the Check Sim runs on the staged build before it is installed, on the latest Import", async () => {
    bootWithOld();
    const report = join(root, "report.json");
    reports.push(report);
    const imp = await importText();
    await applyJob({ kind: "nightly" });
    const ran = JSON.parse(await Bun.file(report).text());
    expect(ran.input).toContain("target_error=1");
    expect(ran.input).toContain('profileset."Check Sim"+=');
    expect(ran.input).toContain("deathknight=");
    expect(imp.id).toBeGreaterThan(0);
  });

  test("with no Import the Check Sim uses a profile shipped in the build", async () => {
    bootWithOld();
    const report = join(root, "report.json");
    reports.push(report);
    await applyJob({ kind: "nightly" });
    const ran = JSON.parse(await Bun.file(report).text());
    expect(ran.input).toContain("mage=x");
    expect((await status()).checkSim).toBeNull();
  });
});

describe("the PTR pass of the Check Sim", () => {
  const setPtr = (ptrEnabled: boolean) => call("PATCH", "/api/simc/settings", { ptrEnabled });

  /** Boots with the Check Sim inputs recorded; the PTR pass (`ptr=1`) replays `ptrScenario`. */
  function bootPtr(ptrScenario: string) {
    const inputs: string[] = [];
    const launch = (dir: string, args: readonly string[]) => {
      const input = readFileSync(args[0] as string, "utf8");
      inputs.push(input);
      return fakeLaunch(() => (input.includes("ptr=1") ? ptrScenario : scenario))(dir, args);
    };
    bootWithOld(undefined, { launch });
    return inputs;
  }

  test("setting on: a second pass runs with ptr=1, and a passing one leaves PTR available", async () => {
    const inputs = bootPtr(checkScenario({ mean: 90_000 }));
    await setPtr(true);
    await importText();
    const body = await applyJob({ kind: "nightly" });

    expect(inputs).toHaveLength(3); // the baseline on the old build, Live, then PTR
    expect(inputs.filter((i) => i.includes("ptr=1"))).toHaveLength(1);
    expect(inputs.at(-1)).toContain("ptr=1");
    expect(body.current?.tag).toBe(LATEST_NIGHTLY);
    expect(body.current?.ptrCheckError).toBeNull();
    expect(ptrAvailable(body.current as NonNullable<typeof body.current>)).toBe(true);
  });

  test.each([
    ["exits non-zero", { exit: 1 }],
    ["prints output that is not understood", { profileset: false }],
  ])(
    "a PTR pass that %s never rejects the build: it is recorded and PTR is unavailable",
    async (_, opts) => {
      const inputs = bootPtr(checkScenario({ mean: 50_000, ...opts }));
      await setPtr(true);
      await importText();
      const body = await applyJob({ kind: "nightly" });

      expect(inputs.some((i) => i.includes("ptr=1"))).toBe(true);
      expect(body.job).toBeNull();
      expect(body.current?.tag).toBe(LATEST_NIGHTLY);
      expect(body.current?.ptrCheckError).toBeTruthy();
      expect(body.installed.find((b) => b.tag === LATEST_NIGHTLY)?.ptrCheckError).toBeTruthy();
      expect(ptrAvailable(body.current as NonNullable<typeof body.current>)).toBe(false);
      // The Live comparison is the Live pass alone: the failed PTR pass left no mark on it.
      expect(body.checkSim).toMatchObject({ tag: LATEST_NIGHTLY, dps: { mean: 100_000 } });
      expect(body.checkSim?.previous?.tag).toBe(OLD);
      // The failure lives in its own table, keyed by the tag.
      const rows = app.db
        .query<{ build_tag: string }, []>("SELECT build_tag FROM ptr_check_results")
        .all();
      expect(rows.map((r) => r.build_tag)).toEqual([LATEST_NIGHTLY]);
    },
  );

  test("the failure stays on the build with PTR Sims off, so a copied PTR Draft still sees it", async () => {
    bootPtr(checkScenario({ exit: 1 }));
    await setPtr(true);
    await applyJob({ kind: "nightly" });
    expect((await status()).current?.ptrCheckError).toBeTruthy();
    await setPtr(false);
    const off = await status();
    expect(off.ptrEnabled).toBe(false);
    expect(off.current?.ptrCheckError).toBeTruthy();
    expect(ptrAvailable(off.current as NonNullable<typeof off.current>)).toBe(false);
  });

  test("neither pass hands SimC the Import's file, network or ptr options", async () => {
    const inputs = bootPtr(checkScenario());
    await setPtr(true);
    const text = `${addonString()}\nsave=${join(root, "stolen.simc")}\nhtml=${join(root, "x.html")}\ninput=/etc/passwd\nptr=1\n`;
    expect((await call("POST", "/api/imports", { text })).status).toBe(201);
    await applyJob({ kind: "nightly" });

    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(input).not.toMatch(/^(save|html|input)=/m);
      expect(input).toContain("deathknight=");
    }
    // Only the PTR pass selects PTR: the Import's own ptr=1 never reaches the Live passes.
    expect(inputs.filter((i) => /^ptr=1$/m.test(i))).toHaveLength(1);
  });

  test("after install the SimC page still marks the PTR data change the update made", async () => {
    bootPtr(checkScenario());
    const file = join(dataDir, "simc", OLD, "build.json");
    const old = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...old, ptrGameDataVersion: "12.1.5.69000" }));
    await setPtr(true);
    await applyJob({ kind: "nightly" });
    await app.idle();
    const body = await status();

    expect(body.current?.tag).toBe(LATEST_NIGHTLY);
    expect(body.update?.target ?? null).toBeNull();
    expect(body.update?.ptrChange).toEqual({ from: "12.1.5.69000", to: "12.1.5.69952" });
    await setPtr(false);
    expect((await status()).update?.ptrChange ?? null).toBeNull();
  });

  test("setting off: no PTR pass runs and nothing is recorded", async () => {
    const inputs = bootPtr(checkScenario({ exit: 1 }));
    await importText();
    const body = await applyJob({ kind: "nightly" });

    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.some((i) => i.includes("ptr=1"))).toBe(false);
    expect(body.current?.tag).toBe(LATEST_NIGHTLY);
    expect(app.db.query("SELECT 1 FROM ptr_check_results").all()).toEqual([]);
  });
});

describe("one Job at a time", () => {
  test("a second Job is refused while one is queued or running, and accepted after", async () => {
    bootWithOld();
    expect((await postJob({ kind: "nightly" })).status).toBe(201);
    const second = await postJob({ kind: "installed", tag: OLD });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("job_in_progress");
    await app.idle();
    expect((await postJob({ kind: "installed", tag: OLD })).status).toBe(201);
    await app.idle();
  });

  test("validates the request", async () => {
    bootWithOld();
    expect((await call("POST", "/api/simc/jobs", { target: { kind: "bogus" } })).status).toBe(400);
    expect((await call("GET", "/api/simc/jobs")).status).toBe(405);
    expect((await postJob({ kind: "installed", tag: "nope" })).status).toBe(404);
    expect((await postJob({ kind: "seed" })).status).toBe(404);
    expect((await call("PATCH", "/api/simc/settings", { keep: 0 })).status).toBe(400);
    expect((await call("POST", "/api/simc/settings", { keep: 2 })).status).toBe(405);
  });

  test("the Job waits in the Queue: a Sim queued before it runs on the old build, one after on the new", async () => {
    bootWithOld();
    const imp = await importText();
    const draft = async () =>
      (await (await call("POST", "/api/sims", { importId: imp.id })).json()) as { id: number };
    const a = await draft();
    const b = await draft();
    await call("POST", `/api/sims/${a.id}/queue`);
    await postJob({ kind: "nightly" });
    await call("POST", `/api/sims/${b.id}/queue`);
    await app.idle();
    const tag = async (id: number) =>
      ((await (await call("GET", `/api/sims/${id}`)).json()) as { simcTag: string }).simcTag;
    expect(await tag(a.id)).toBe(OLD);
    expect(await tag(b.id)).toBe(LATEST_NIGHTLY);
  });
});

describe("the Queue lists SimC Update Jobs", () => {
  const queueEntries = async () =>
    queueResponseSchema.parse(await (await call("GET", "/api/queue")).json()).entries;

  test("a queued Job shows in FIFO order between the Sims around it, and leaves when done", async () => {
    bootWithOld();
    const imp = await importText();
    const draft = async () =>
      (await (await call("POST", "/api/sims", { importId: imp.id })).json()) as { id: number };
    const a = await draft();
    const b = await draft();
    await call("POST", `/api/sims/${a.id}/queue`);
    await postJob({ kind: "nightly" });
    await call("POST", `/api/sims/${b.id}/queue`);
    const entries = await queueEntries();
    expect(entries.map((e) => [e.type, e.type === "sim" ? e.simId : null])).toEqual([
      ["sim", a.id],
      ["simc_update", null],
      ["sim", b.id],
    ]);
    expect(entries[1]).toMatchObject({ status: "queued", target: { kind: "nightly" }, step: null });
    await app.idle();
    expect(await queueEntries()).toEqual([]);
  });

  test("the running Job shows the step it is on and the tag it resolved to", async () => {
    bootWithOld();
    const seen: QueueEntry[][] = [];
    app.bus.on((e) => {
      if (e.type === "simc.update_status" && e.status === "running") seen.push(getQueue(app.db));
    });
    await applyJob({ kind: "nightly" });
    const at = (step: string) =>
      seen.find(([head]) => head?.type === "simc_update" && head.step === step);
    expect(at("check")).toEqual([
      expect.objectContaining({
        type: "simc_update",
        status: "running",
        target: { kind: "nightly" },
        step: "check",
        tag: LATEST_NIGHTLY,
      }),
    ]);
    expect(at("commit")).toBeDefined();
  });

  test("queue.changed fires when the Job is queued, starts and finishes", async () => {
    bootWithOld();
    await applyJob({ kind: "nightly" });
    expect(events.filter((e) => e.type === "queue.changed")).toHaveLength(3);
  });

  test("a failed Job leaves the Queue and announces it", async () => {
    bootWithOld((url) =>
      url.includes("/manifests/") ? new Response("", { status: 404 }) : undefined,
    );
    await applyJob({ kind: "nightly" });
    expect(await queueEntries()).toEqual([]);
    expect(events.filter((e) => e.type === "queue.changed")).toHaveLength(3);
  });
});

describe("failures leave the Current SimC Build untouched", () => {
  async function expectRejected(step: string, message: RegExp) {
    const body = await status();
    expect(body.current?.tag).toBe(OLD);
    expect(installedTags()).toEqual([OLD]);
    expect(readdirSafe(join(dataDir, "simc", ".partial"))).toEqual([]);
    expect(readdirSafe(join(dataDir, "meta", ".partial"))).toEqual([]);
    expect(existsSync(join(dataDir, "meta", LATEST_NIGHTLY))).toBe(false);
    expect(body.job).toMatchObject({ status: "failed", step });
    expect(body.job?.error).toMatch(message);
    expect(updateEvents().at(-1)).toMatchObject({ status: "failed", step });
  }

  test("fetch", async () => {
    bootWithOld((url) =>
      url.includes("/manifests/") ? new Response("", { status: 404 }) : undefined,
    );
    await applyJob({ kind: "nightly" });
    await expectRejected("fetch", /404/);
  });

  test("check: SimC exits non-zero", async () => {
    bootWithOld();
    scenario = checkScenario({ exit: 70 });
    await applyJob({ kind: "nightly" });
    await expectRejected("check", /exited with code 70/);
  });

  test("check: output not understood (no profileset result)", async () => {
    bootWithOld();
    scenario = checkScenario({ profileset: false });
    await applyJob({ kind: "nightly" });
    await expectRejected("check", /SimC output format changed/);
  });

  test("meta", async () => {
    bootWithOld((url) =>
      url.includes("wago.tools") ? new Response("", { status: 400 }) : undefined,
    );
    await applyJob({ kind: "nightly" });
    await expectRejected("meta", /400/);
  });

  test("commit: nothing is switched and the installed copy is removed again", async () => {
    bootWithOld();
    await importText();
    app.db.run(
      "CREATE TRIGGER no_check_sims BEFORE INSERT ON check_sim_results BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    await applyJob({ kind: "nightly" });
    await expectRejected("commit", /boom/);
  });

  test("Retry queues a new Job for the same target, and the failed one stops showing", async () => {
    let fail = true;
    bootWithOld((url) =>
      fail && url.includes("/manifests/") ? new Response("", { status: 404 }) : undefined,
    );
    const failed = (await applyJob({ kind: "nightly" })).job as SimcJob;
    expect(failed.status).toBe("failed");
    // Nothing re-queued on its own.
    expect((await status()).job?.id).toBe(failed.id);
    fail = false;
    const body = await applyJob(failed.target);
    expect(body.job).toBeNull();
    expect(body.current?.tag).toBe(LATEST_NIGHTLY);
  });

  test("an unknown installed target fails at fetch", async () => {
    bootWithOld();
    // Installed when queued, gone by the time the Job starts.
    app.db.run(
      `INSERT INTO jobs (kind, status, target, created_at)
       VALUES ('simc_update', 'queued', '{"kind":"installed","tag":"1210-2026-01-01-0000000"}', ?)`,
      [new Date().toISOString()],
    );
    app.bus.emit({ type: "queue.changed" });
    await app.idle();
    expect(simcJobSchema.parse((await status()).job)).toMatchObject({
      status: "failed",
      step: "fetch",
    });
  });
});

describe("in-step retries", () => {
  test("5xx and 429 get 3 tries with 1 s then 4 s backoff", async () => {
    let hits = 0;
    bootWithOld((url) =>
      url.includes("/manifests/") && ++hits <= 2
        ? new Response("", { status: hits === 1 ? 503 : 429 })
        : undefined,
    );
    const body = await applyJob({ kind: "nightly" });
    expect(body.current?.tag).toBe(LATEST_NIGHTLY);
    expect(sleeps).toEqual([1000, 4000]);
  });

  test("Retry-After is honoured up to 60 s", async () => {
    bootWithOld((url, n) =>
      url.includes("/manifests/") && n <= 2
        ? new Response("", { status: 429, headers: { "retry-after": n === 1 ? "9" : "9999" } })
        : undefined,
    );
    await applyJob({ kind: "nightly" });
    expect(sleeps).toEqual([9000, 60_000]);
  });

  test("network errors are retried, and after 3 tries the Job fails at that step", async () => {
    let calls = 0;
    const flaky = fakeRegistry(github);
    app = createApp(
      { dataDir, clientDir: join(root, "client") },
      {
        fetch: (async (input: string | URL | Request, init?: RequestInit) => {
          if (String(input).includes("/manifests/")) {
            calls++;
            throw new TypeError("fetch failed");
          }
          return flaky.fetch(input, init);
        }) as typeof fetch,
        sleep: async (ms) => void sleeps.push(ms),
        log: () => {},
      },
    );
    installFakeBuild(dataDir, app, OLD);
    const body = await applyJob({ kind: "nightly" });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 4000]);
    expect(body.job).toMatchObject({ status: "failed", step: "fetch" });
    expect(body.job?.error).toContain("after 3 attempt(s)");
    expect(body.current?.tag).toBe(OLD);
  });

  test("a client error (404) is not retried", async () => {
    bootWithOld((url) =>
      url.includes("/manifests/") ? new Response("", { status: 404 }) : undefined,
    );
    await applyJob({ kind: "nightly" });
    expect(sleeps).toEqual([]);
  });
});

describe("crash restart", () => {
  test("partials are deleted at boot and an interrupted Job restarts from step 1", async () => {
    boot();
    installFakeBuild(dataDir, app, OLD);
    const stale = join(dataDir, "simc", ".partial", LATEST_NIGHTLY);
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "half-extracted"), "x");
    mkdirSync(join(dataDir, "meta", ".partial", LATEST_NIGHTLY), { recursive: true });
    app.db.run(
      `INSERT INTO jobs (kind, status, target, step, resolved_tag, created_at, started_at)
       VALUES ('simc_update', 'running', '{"kind":"nightly"}', 'check', ?, ?, ?)`,
      [LATEST_NIGHTLY, new Date().toISOString(), new Date().toISOString()],
    );
    app.close();

    boot();
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(dataDir, "meta", ".partial"))).toBe(false);
    await app.idle();

    const body = await status();
    expect(body.current?.tag).toBe(LATEST_NIGHTLY);
    expect(body.job).toBeNull();
    expect(updateEvents().find((e) => e.status === "running")?.step).toBe("fetch");
  });
});

describe("retention", () => {
  function fakeInstalled(tag: string) {
    const dir = join(dataDir, "simc", tag);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "build.json"),
      JSON.stringify({
        tag,
        simcVersion: "1210-01",
        gitRevision: tag.split("-").at(-1),
        gitBranch: "midnight",
        gameDataVersion: "12.1.0.69933",
      }),
    );
    mkdirSync(join(dataDir, "meta", tag), { recursive: true });
  }
  const T = ["1210-2026-09-20-aaaaaaa", "1210-2026-09-21-bbbbbbb", "1210-2026-09-22-ccccccc"];
  const setCurrent = (tag: string) =>
    app.db.run("UPDATE settings SET value = ? WHERE key = 'simc.current_tag'", [tag]);

  test("an update keeps the newest 3 by default and evicts the rest, with their meta", async () => {
    bootWithOld();
    for (const t of T) fakeInstalled(t);
    expect((await status()).keep).toBe(3);
    await applyJob({ kind: "nightly" });
    // New + the two newest of the rest; OLD (09-27) and 09-22 stay, 09-21 and 09-20 go.
    expect(installedTags()).toEqual([T[2], OLD, LATEST_NIGHTLY].sort());
    expect(existsSync(join(dataDir, "meta", T[0] as string))).toBe(false);
    expect(existsSync(join(dataDir, "meta", T[2] as string))).toBe(true);
  });

  test("keep-N is settable, at least 1, and evicts at once", async () => {
    bootWithOld();
    for (const t of T) fakeInstalled(t);
    setCurrent(T[2] as string);
    const res = await call("PATCH", "/api/simc/settings", { keep: 2 });
    expect(res.status).toBe(200);
    const body = simcStatusResponseSchema.parse(await res.json());
    expect(body.keep).toBe(2);
    // Newest by tag date first: OLD (09-27), then the current T[2] is always kept.
    expect(installedTags()).toEqual([T[2], OLD].sort());
    expect((await call("PATCH", "/api/simc/settings", { keep: 0 })).status).toBe(400);
  });

  test("never evicts the current build or one an unfinished Sim uses", async () => {
    bootWithOld();
    for (const t of T) fakeInstalled(t);
    setCurrent(T[0] as string);
    const imp = await importText();
    const sim = (await (await call("POST", "/api/sims", { importId: imp.id })).json()) as {
      id: number;
    };
    app.db.run("UPDATE sims SET status = 'running', simc_tag = ? WHERE id = ?", [T[1], sim.id]);
    await call("PATCH", "/api/simc/settings", { keep: 1 });
    expect(installedTags()).toEqual([T[0], T[1]].sort());
  });
});

describe("switching to an installed build", () => {
  test("pins it: installable stays quiet until a nightly newer than the newest installed appears", async () => {
    let hub = ["latest", LATEST_NIGHTLY, MID, OLD];
    const handler: Handler = (url) => {
      if (url.startsWith("https://hub.docker.com/")) {
        return Response.json({ results: hub.map((name) => ({ name })) });
      }
    };
    bootWithOld(handler);
    await importText();
    await applyJob({ kind: "nightly" });
    expect((await status()).current?.tag).toBe(LATEST_NIGHTLY);

    const pinned = await applyJob({ kind: "installed", tag: OLD });
    expect(pinned.current?.tag).toBe(OLD);
    // Nothing was fetched for a switch.
    expect(installedTags()).toEqual([OLD, LATEST_NIGHTLY].sort());

    const quiet = simcStatusResponseSchema.parse(
      await (await call("POST", "/api/simc/check")).json(),
    );
    expect(quiet.update).toMatchObject({ currentTag: OLD, state: "up_to_date", target: null });

    const newer = "1210-2026-09-30-eeeeeee";
    hub = ["latest", newer, ...hub.slice(1)];
    const loud = simcStatusResponseSchema.parse(
      await (await call("POST", "/api/simc/check")).json(),
    );
    expect(loud.update).toMatchObject({
      state: "installable",
      target: { source: "nightly", tag: newer },
    });
  });
});

describe("Check Sim delta", () => {
  test("stored per (build, Import) and shown against the previous build when both exist", async () => {
    bootWithOld();
    const imp = await importText();
    scenario = checkScenario({ mean: 100_000 });
    await applyJob({ kind: "installed", tag: OLD });
    expect((await status()).checkSim).toMatchObject({ tag: OLD, previous: null });

    scenario = checkScenario({ mean: 110_000 });
    const body = await applyJob({ kind: "nightly" });
    expect(body.checkSim).toMatchObject({
      tag: LATEST_NIGHTLY,
      importId: imp.id,
      dps: { mean: 110_000 },
      previous: { tag: OLD, dps: { mean: 100_000 } },
    });
    const rows = app.db.query("SELECT count(*) AS n FROM check_sim_results").get();
    expect(rows).toEqual({ n: 2 });
  });

  test("after a re-import the previous build is checked on the new Import, so the delta still shows", async () => {
    bootWithOld();
    await importText();
    scenario = checkScenario({ mean: 100_000 });
    await applyJob({ kind: "installed", tag: OLD });
    const second = (await (
      await call("POST", "/api/imports", { text: `${addonString()}\n# edited\n` })
    ).json()) as { id: number };
    scenario = checkScenario({ mean: 120_000 });
    const body = await applyJob({ kind: "nightly" });
    expect(body.checkSim).toMatchObject({
      tag: LATEST_NIGHTLY,
      importId: second.id,
      previous: { tag: OLD },
    });
  });

  test("a Seed-style build with no Check Sim gets a delta once an Import exists", async () => {
    bootWithOld();
    const imp = await importText();
    expect((await status()).checkSim).toBeNull();
    const body = await applyJob({ kind: "nightly" });
    expect(body.checkSim).toMatchObject({ importId: imp.id, previous: { tag: OLD } });
  });
});

describe("Seed SimC Build", () => {
  /** A directory laid out like an installed build, with a fake musl loader and simc. */
  function seedBuild() {
    const dir = join(root, "seed");
    mkdirSync(join(dir, "lib"), { recursive: true });
    mkdirSync(join(dir, "profiles"), { recursive: true });
    writeFileSync(join(dir, "lib", "ld-musl-x86_64.so.1"), '#!/bin/sh\nshift 2\nexec "$@"\n');
    writeFileSync(
      join(dir, "simc"),
      `#!/bin/sh
for a in "$@"; do case "$a" in json2=*) out="\${a#json2=}";; esac; done
cat > "$out" <<'JSON'
${json2}
JSON
`,
    );
    writeFileSync(join(dir, "profiles", "Seed.simc"), "mage=seed\n");
    chmodSync(join(dir, "lib", "ld-musl-x86_64.so.1"), 0o755);
    chmodSync(join(dir, "simc"), 0o755);
    return dir;
  }
  const SEED = "1210-2026-09-29-5eed5ee";

  test("is installed from the app's own copy, without touching the registry", async () => {
    const dir = seedBuild();
    const { registry } = bootWithOld(undefined, { seedTag: () => SEED, seedDir: () => dir });
    const body = await applyJob({ kind: "seed" });
    expect(body.current?.tag).toBe(SEED);
    expect(installedTags()).toEqual([OLD, SEED].sort());
    expect(registry.calls.some((u) => u.includes("/blobs/"))).toBe(false);
  });
});
