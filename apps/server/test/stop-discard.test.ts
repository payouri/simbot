import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  apiErrorSchema,
  importSchema,
  queueResponseSchema,
  type Sim,
  type SimResultsResponse,
  simSchema,
} from "@simbot/shared";
import { openDb } from "../src/db";
import { type AppEvent, createEventBus } from "../src/events";
import { recoverInterruptedRuns } from "../src/runner/recovery";
import { addonString, FIXTURES, fakeLaunch, type Harness, isAlive, makeHarness } from "./harness";

let h: Harness;
let gate: string | undefined;
let stubborn = false;
let report: string;
const launch = fakeLaunch(
  () => join(FIXTURES, "success"),
  () => report,
  () => gate,
  () => stubborn,
);

const start = (opts: Parameters<typeof makeHarness>[0] = {}) => {
  gate = undefined;
  stubborn = false;
  h = makeHarness({ launch, ...opts });
  report = join(h.root, "report.json");
  gate = join(h.root, "gate");
  return h;
};
afterEach(() => h?.close());

const until = async (ok: () => boolean | Promise<boolean>, what: string, ms = 5000) => {
  const stop = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > stop) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const launched = () => JSON.parse(readFileSync(report, "utf8")) as { pid: number };
const release = () => writeFileSync(gate as string, "");

/** Imports, queues and waits for the fake `simc` to be up: the Sim is mid-run. */
async function runningSim(): Promise<Sim> {
  const imp = await h.importText();
  const sim = await h.queue((await h.createSim(imp.id)).id);
  await until(() => existsSync(report), "SimC to launch");
  await until(async () => (await h.sim(sim.id)).status === "running", "the Sim to run");
  return h.sim(sim.id);
}

describe("Stop and Discard a running Sim", () => {
  test("Stop cancels the Sim, kills SimC and leaves no files behind", async () => {
    start();
    const live = await h.subscribe();
    const sim = await runningSim();
    const { pid } = launched();

    const res = await h.stop(sim.id, true);
    expect(res.status).toBe(202);
    await h.app.idle();

    const after = await h.sim(sim.id);
    expect(after.status).toBe("cancelled");
    expect(after.finishedAt).not.toBeNull();
    expect(isAlive(pid)).toBe(false);
    expect(existsSync(join(h.dataDir, "tmp", "1"))).toBe(false);
    expect(existsSync(h.simFile(sim.id, "stage-1.json.gz"))).toBe(false);
    // A stopped Sim keeps what it finished: here nothing yet, so an empty result set.
    const kept = await h.results(sim.id);
    expect(kept).toMatchObject({ status: "cancelled", results: [] });
    expect(queueResponseSchema.parse(await (await h.call("GET", "/api/queue")).json())).toEqual({
      entries: [],
    });
    await live.waitFor((e) => e.type === "sim.finished" && e.status === "cancelled");
    live.close();
  });

  test("Discard returns the Sim to a clean Draft that can run again", async () => {
    start();
    const live = await h.subscribe();
    const sim = await runningSim();
    const { pid } = launched();

    expect((await h.stop(sim.id, false)).status).toBe(202);
    await h.app.idle();

    const after = await h.sim(sim.id);
    expect(after).toMatchObject({
      status: "draft",
      simcTag: null,
      error: null,
      queuedAt: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(isAlive(pid)).toBe(false);
    expect(existsSync(join(h.dataDir, "sims", String(sim.id)))).toBe(false);
    expect(h.app.db.query("SELECT count(*) AS n FROM combinations").get()).toEqual({ n: 0 });
    expect(h.app.db.query("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 0 });
    await live.waitFor((e) => e.type === "sim.discarded");
    live.close();

    // As if it had never run: queue it again and it succeeds with a single baseline result.
    release();
    await h.queue(sim.id);
    await h.app.idle();
    expect((await h.sim(sim.id)).status).toBe("succeeded");
    const results: SimResultsResponse = await h.results(sim.id);
    expect(results.results).toHaveLength(1);
  });

  test("a queued or running Sim cannot be deleted, and can still be stopped", async () => {
    start();
    const sim = await runningSim();
    const res = await h.call("DELETE", `/api/sims/${sim.id}`);
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error).toBe("invalid_transition");
    expect((await h.sim(sim.id)).status).toBe("running");

    expect((await h.stop(sim.id, true)).status).toBe(202);
    await h.app.idle();
    expect((await h.sim(sim.id)).status).toBe("cancelled");
    // Once it has settled it can be deleted, folder and all.
    expect((await h.call("DELETE", `/api/sims/${sim.id}`)).status).toBe(204);
    expect(existsSync(join(h.dataDir, "sims", String(sim.id)))).toBe(false);
  });

  test("a stubborn SimC that ignores SIGTERM is SIGKILLed after the grace period", async () => {
    start({ killGraceMs: 100 });
    stubborn = true;
    const sim = await runningSim();
    const { pid } = launched();

    await h.stop(sim.id, true);
    await h.app.idle();

    expect((await h.sim(sim.id)).status).toBe("cancelled");
    expect(isAlive(pid)).toBe(false);
  });

  test("Discard overrides an earlier Stop that has not settled", async () => {
    start({ killGraceMs: 300 });
    stubborn = true;
    const sim = await runningSim();

    await h.stop(sim.id, true);
    await h.stop(sim.id, false);
    await h.app.idle();

    expect((await h.sim(sim.id)).status).toBe("draft");
  });
});

describe("Stop and Discard a queued Sim", () => {
  test("either one returns it to Draft and the Queue moves on", async () => {
    start();
    const first = await runningSim();
    const imp = await h.importText();
    const second = await h.queue((await h.createSim(imp.id)).id);
    const third = await h.queue((await h.createSim(imp.id)).id);

    for (const [sim, keep] of [
      [second, true],
      [third, false],
    ] as const) {
      const res = await h.stop(sim.id, keep);
      expect(res.status).toBe(200);
      expect(simSchema.parse(await res.json())).toMatchObject({ status: "draft", queuedAt: null });
    }
    const queue = queueResponseSchema.parse(await (await h.call("GET", "/api/queue")).json());
    expect(queue.entries.map((e) => e.simId)).toEqual([first.id]);

    release();
    await h.app.idle();
    expect((await h.sim(first.id)).status).toBe("succeeded");
    expect((await h.sim(second.id)).status).toBe("draft");
    expect((await h.sim(third.id)).status).toBe("draft");
  });
});

describe("POST /api/sims/:id/stop refusals", () => {
  test("a Draft or finished Sim is 409, an unknown one 404, a bad body 400", async () => {
    start();
    release();
    const imp = await h.importText();
    const draft = await h.createSim(imp.id);
    expect((await h.stop(draft.id, true)).status).toBe(409);
    const done = await h.runQuickSim();
    const refused = await h.stop(done.id, false);
    expect(refused.status).toBe(409);
    expect(apiErrorSchema.parse(await refused.json()).error).toBe("invalid_transition");
    expect((await h.stop(999, true)).status).toBe(404);
    expect((await h.call("POST", `/api/sims/${draft.id}/stop`, {})).status).toBe(400);
    expect((await h.call("GET", `/api/sims/${draft.id}/stop`)).status).toBe(405);
  });
});

describe("DELETE /api/sims/:id", () => {
  test("a running Sim is 409 and keeps running; a finished one is deleted with its folder", async () => {
    start();
    const sim = await runningSim();
    const refused = await h.call("DELETE", `/api/sims/${sim.id}`);
    expect(refused.status).toBe(409);
    expect(apiErrorSchema.parse(await refused.json()).error).toBe("invalid_transition");
    expect((await h.sim(sim.id)).status).toBe("running");

    release();
    await h.app.idle();
    expect((await h.sim(sim.id)).status).toBe("succeeded");
    const deleted = await h.call("DELETE", `/api/sims/${sim.id}`);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(existsSync(join(h.dataDir, "sims", String(sim.id)))).toBe(false);
    expect((await h.call("GET", `/api/sims/${sim.id}`)).status).toBe(404);
    expect((await h.call("DELETE", `/api/sims/${sim.id}`)).status).toBe(404);
  });
});

describe("boot recovery settles interrupted Sims like a live Stop or Discard", () => {
  test("each outcome sends the events a client reacts to, and a Discard loses its folder", async () => {
    start();
    release();
    // Three finished Sims, made to look as if the server died while each was running.
    const kept = await h.runQuickSim();
    const discarded = await h.runQuickSim();
    const resumed = await h.runQuickSim();
    const { app, dataDir } = h;
    app.db.run("UPDATE sims SET status = 'running', finished_at = NULL");
    app.db.run("UPDATE jobs SET status = 'running', finished_at = NULL WHERE kind = 'sim'");
    app.db.run("UPDATE jobs SET stop_mode = 'keep' WHERE sim_id = ?", [kept.id]);
    app.db.run("UPDATE jobs SET stop_mode = 'discard' WHERE sim_id = ?", [discarded.id]);
    expect(existsSync(h.simFile(discarded.id, "stage-1.json.gz"))).toBe(true);
    app.close();

    const db = openDb(dataDir);
    const bus = createEventBus();
    const events: AppEvent[] = [];
    bus.on((e) => void events.push(e));
    try {
      recoverInterruptedRuns({ db, dataDir, bus, isSimc: () => false });
    } finally {
      db.close();
    }

    const forSim = (id: number) =>
      events.filter((e) => "simId" in e && e.simId === id).map((e) => ({ ...e }));
    expect(forSim(kept.id)).toEqual([
      { type: "sim.status", simId: kept.id, status: "cancelled" },
      { type: "sim.finished", simId: kept.id, status: "cancelled" },
    ]);
    expect(forSim(discarded.id)).toEqual([
      { type: "sim.status", simId: discarded.id, status: "draft" },
      { type: "sim.discarded", simId: discarded.id },
    ]);
    expect(forSim(resumed.id)).toEqual([
      { type: "sim.status", simId: resumed.id, status: "queued" },
    ]);
    expect(events.filter((e) => e.type === "queue.changed")).toHaveLength(3);
    expect(existsSync(join(dataDir, "sims", String(discarded.id)))).toBe(false);
    expect(existsSync(h.simFile(kept.id, "stage-1.json.gz"))).toBe(true);
  });
});

describe("crash recovery (a real server process, killed and restarted)", () => {
  type Server = { proc: Bun.Subprocess<"ignore", "pipe", "inherit">; base: string };
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.proc.kill("SIGKILL");
  });

  async function boot(dataDir: string): Promise<Server> {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "server-under-test.ts")], {
      stdout: "pipe",
      stderr: "inherit",
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        SCENARIO: join(FIXTURES, "success"),
        GATE: gate,
        REPORT: report,
      },
    });
    const reader = proc.stdout.getReader();
    const first = await reader.read();
    reader.releaseLock();
    const server = {
      proc,
      base: `http://127.0.0.1:${Number(new TextDecoder().decode(first.value).trim())}`,
    };
    servers.push(server);
    return server;
  }
  const api = async (s: Server, method: string, path: string, body?: unknown) =>
    fetch(`${s.base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const simOn = async (s: Server, id: number) =>
    simSchema.parse(await (await api(s, "GET", `/api/sims/${id}`)).json());
  const crash = async (s: Server) => {
    s.proc.kill("SIGKILL"); // Not a clean shutdown: SimC is left running, orphaned.
    await s.proc.exited;
  };
  /** Starts a Sim on a server and waits until SimC is up; returns the SimC pid. */
  async function startRun(s: Server, simId: number) {
    rmReport();
    await api(s, "POST", `/api/sims/${simId}/queue`);
    await until(() => existsSync(report), "SimC to launch");
    await until(async () => (await simOn(s, simId)).status === "running", "the Sim to run");
    return launched().pid;
  }
  const rmReport = () => rmSync(report, { force: true });

  test("boot kills the orphaned SimC, wipes tmp/ and resumes the Job at the head of the queue", async () => {
    start();
    // The in-process app of the harness only supplies a data dir (and its DB migrations).
    const dataDir = h.dataDir;
    h.app.close();
    const one = await boot(dataDir);
    const imp = importSchema.parse(
      await (await api(one, "POST", "/api/imports", { text: addonString() })).json(),
    );
    const sim = simSchema.parse(
      await (await api(one, "POST", "/api/sims", { importId: imp.id })).json(),
    );
    const orphan = await startRun(one, sim.id);
    // A second Sim waits behind the first, and a stray tmp entry must go on boot.
    const other = simSchema.parse(
      await (await api(one, "POST", "/api/sims", { importId: imp.id })).json(),
    );
    await api(one, "POST", `/api/sims/${other.id}/queue`);
    mkdirSync(join(dataDir, "tmp", "stale"), { recursive: true });
    writeFileSync(join(dataDir, "tmp", "stale", "x"), "");

    await crash(one);
    expect(isAlive(orphan)).toBe(true);

    rmReport();
    const two = await boot(dataDir);
    expect(isAlive(orphan)).toBe(false);
    expect(existsSync(join(dataDir, "tmp", "stale"))).toBe(false);
    // It resumed before the Sim queued behind it: a new SimC is running, for the same Job.
    await until(() => existsSync(report) && launched().pid !== orphan, "SimC to relaunch");
    expect((await simOn(two, sim.id)).status).toBe("running");
    expect((await simOn(two, other.id)).status).toBe("queued");

    release();
    await until(async () => (await simOn(two, sim.id)).status === "succeeded", "the Sim to finish");
    await until(async () => (await simOn(two, other.id)).status === "succeeded", "the next Sim");
  });

  test("a Job interrupted twice in a row ends failed", async () => {
    start();
    const dataDir = h.dataDir;
    h.app.close();
    const one = await boot(dataDir);
    const imp = importSchema.parse(
      await (await api(one, "POST", "/api/imports", { text: addonString() })).json(),
    );
    const sim = simSchema.parse(
      await (await api(one, "POST", "/api/sims", { importId: imp.id })).json(),
    );
    await startRun(one, sim.id);
    await crash(one);

    rmReport();
    const two = await boot(dataDir);
    await until(() => existsSync(report), "SimC to relaunch");
    await until(async () => (await simOn(two, sim.id)).status === "running", "the Sim to resume");
    expect((await simOn(two, sim.id)).status).toBe("running");
    await crash(two);

    const three = await boot(dataDir);
    const failed = await simOn(three, sim.id);
    expect(failed.status).toBe("failed");
    expect(failed.error?.kind).toBe("interrupted");
    const queue = queueResponseSchema.parse(await (await api(three, "GET", "/api/queue")).json());
    expect(queue.entries).toEqual([]);
  });
});
