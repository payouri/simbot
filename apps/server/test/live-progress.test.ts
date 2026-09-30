import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AppEvent,
  appEventSchema,
  queueResponseSchema,
  type SimProgress,
  snapshotEventSchema,
} from "@simbot/shared";
import { derivedScenario, FIXTURES, fakeLaunch, type Harness, makeHarness } from "./harness";

let h: Harness;
let scenario = join(FIXTURES, "success");
let gate: string | undefined;
const launch = fakeLaunch(
  () => scenario,
  () => undefined,
  () => gate,
);

const start = (opts: Parameters<typeof makeHarness>[0] = {}) => {
  scenario = join(FIXTURES, "success");
  gate = undefined;
  h = makeHarness({ launch, ...opts });
  return h;
};
afterEach(() => h?.close());

const types = (events: AppEvent[]): string[] => events.map((e) => e.type);
/** Collapses runs of the same type, so a test need not care how many progress events came. */
const shape = (events: AppEvent[]) => types(events).filter((t, i, all) => t !== all[i - 1]);
const isProgress = (e: AppEvent): e is AppEvent & SimProgress & { type: "sim.progress" } =>
  e.type === "sim.progress";

/** Baseline lines as SimC prints them with `target_error`, then the recorded run's noise. */
const PROGRESS_STDOUT = [
  "SimulationCraft 1210-01 for World of Warcraft",
  "Baseline\t1\t1\t100\t3451\t149.285\t149000.000\t1.402\t21.870",
  "Baseline\t1\t1\t400\t3726\t149.285\t149500.000\t0.338\t5.109",
  "Baseline\t1\t1\t3726\t3726\t148.900\t149861.052\t0.198\t25.020",
  "Merging data from thread-1 ...",
  "",
].join("\n");

const withStdout = (stdout: string, extra: Record<string, string> = {}) =>
  derivedScenario(h.root, "success", (files) => {
    files["stdout.txt"] = Buffer.from(stdout);
    for (const [name, text] of Object.entries(extra)) files[name] = Buffer.from(text);
  });

describe("event sequence of a Quick Sim (recorded SimC output)", () => {
  test("snapshot, queue change, Stage start, progress, Stage finish, finish", async () => {
    start();
    const live = await h.subscribe();
    await h.runQuickSim();
    await live.waitFor((e) => e.type === "sim.finished");
    await live.waitFor(() => live.events.at(-1)?.type === "queue.changed");
    live.close();

    expect(shape(live.events)).toEqual([
      "snapshot",
      "queue.changed", // queued, then started
      "sim.stage_started",
      "sim.progress",
      "sim.log", // the recorded run's one stderr line
      "sim.stage_finished",
      "sim.finished",
      "queue.changed", // left the Queue
    ]);

    const [snapshot] = live.events;
    expect(snapshot).toEqual({ type: "snapshot", queue: [], running: null });
    const started = live.events.find((e) => e.type === "sim.stage_started");
    const finished = live.events.find((e) => e.type === "sim.finished");
    expect(started).toMatchObject({ simId: 1, stage: 1 });
    expect(finished).toEqual({ type: "sim.finished", simId: 1, status: "succeeded" });
    // The recorded run printed one Baseline line, its last: 131 of 131 iterations, 0.574 % error.
    const progress = live.events.find(isProgress);
    expect(progress).toMatchObject({
      simId: 1,
      stage: 1,
      phase: "baseline",
      done: 131,
      total: 131,
      errorPct: 0.574,
      targetErrorPct: 0.2,
      etaSeconds: null,
    });
    expect(live.events.flatMap((e) => (e.type === "sim.log" ? [e.level] : []))).toEqual(["info"]);
  });

  test("a failed Sim ends with sim.finished failed and no Stage finish", async () => {
    start();
    scenario = join(FIXTURES, "setup-failure");
    const live = await h.subscribe();
    await h.runQuickSim();
    await live.waitFor((e) => e.type === "sim.finished");
    live.close();
    expect(live.events.find((e) => e.type === "sim.finished")).toMatchObject({ status: "failed" });
    expect(types(live.events)).not.toContain("sim.stage_finished");
  });
});

describe("progress", () => {
  test("is throttled but the final line always arrives", async () => {
    start();
    scenario = withStdout(PROGRESS_STDOUT);
    const live = await h.subscribe();
    await h.runQuickSim();
    await live.waitFor((e) => e.type === "sim.stage_finished");
    live.close();
    const progress = live.events.filter(isProgress);
    // The lines arrive within a few ms: the first goes out at once, the rest collapse to the latest.
    expect(progress.length).toBeLessThan(3);
    expect(progress.at(-1)).toMatchObject({ done: 3726, total: 3726, errorPct: 0.198 });
    expect(progress[0]).toMatchObject({ done: 100, total: 3451, etaSeconds: 21.87 });
  });

  test("without a throttle every line is an event", async () => {
    start({ progressIntervalMs: 0 });
    scenario = withStdout(PROGRESS_STDOUT);
    const live = await h.subscribe();
    await h.runQuickSim();
    await live.waitFor((e) => e.type === "sim.stage_finished");
    live.close();
    expect(live.events.filter(isProgress).map((p) => p.done)).toEqual([100, 400, 3726]);
  });

  test("SimC's chatter is a sim.log only under the dev flag; stderr is always logged", async () => {
    const stderr = "Warning: something odd\nError: not fatal\nplain note\n";
    for (const debugLogs of [false, true]) {
      start({ debugLogs });
      scenario = withStdout(PROGRESS_STDOUT, { "stderr.txt": stderr });
      const live = await h.subscribe();
      await h.runQuickSim();
      await live.waitFor((e) => e.type === "sim.finished");
      live.close();
      const logs = live.events.flatMap((e) => (e.type === "sim.log" ? [[e.level, e.message]] : []));
      expect(logs.filter(([level]) => level !== "debug")).toEqual([
        ["warn", "Warning: something odd"],
        ["error", "Error: not fatal"],
        ["info", "plain note"],
      ]);
      const debug = logs.filter(([level]) => level === "debug").map(([, m]) => m);
      expect(debug).toEqual(
        debugLogs
          ? ["SimulationCraft 1210-01 for World of Warcraft", "Merging data from thread-1 ..."]
          : [],
      );
      h.close();
    }
  });
});

describe("watching the Queue", () => {
  test("two Quick Sims: the first progresses live while the second waits", async () => {
    start({ progressIntervalMs: 0 });
    gate = join(h.root, "gate");
    scenario = withStdout(PROGRESS_STDOUT);
    const live = await h.subscribe();
    const imp = await h.importText();
    const first = await h.createSim(imp.id);
    const second = await h.createSim(imp.id);
    await h.queue(first.id);
    await h.queue(second.id);

    // SimC has printed its lines but not exited, so the first Sim is running.
    await live.waitFor((e) => isProgress(e) && e.done === 3726);
    const queue = queueResponseSchema.parse(await (await h.call("GET", "/api/queue")).json());
    expect(queue.entries.map((e) => [e.type === "sim" ? e.simId : null, e.status])).toEqual([
      [first.id, "running"],
      [second.id, "queued"],
    ]);
    const head = queue.entries[0];
    expect(head?.type === "sim" ? head.character.name : null).toBe("Rootbeer");
    expect(live.events.filter(isProgress).every((p) => p.simId === first.id)).toBe(true);

    // A client that connects now gets the Queue and the last progress, and no replay.
    const late = await h.subscribe();
    await late.waitFor((e) => e.type === "snapshot");
    late.close();
    const snapshot = snapshotEventSchema.parse(late.events[0]);
    expect(snapshot.queue.map((e) => (e.type === "sim" ? e.simId : null))).toEqual([
      first.id,
      second.id,
    ]);
    expect(snapshot.running).toMatchObject({
      simId: first.id,
      stage: 1,
      progress: { done: 3726, total: 3726, errorPct: 0.198 },
    });
    expect(late.events).toHaveLength(1);

    writeFileSync(gate, "");
    await h.app.idle();
    live.close();
    expect((await h.sim(first.id)).status).toBe("succeeded");
    expect((await h.sim(second.id)).status).toBe("succeeded");
    const finishes = live.events.flatMap((e) => (e.type === "sim.finished" ? [e.simId] : []));
    expect(finishes).toEqual([first.id, second.id]);
    const empty = queueResponseSchema.parse(await (await h.call("GET", "/api/queue")).json());
    expect(empty.entries).toEqual([]);
  });

  test("the SSE route is GET only, and every frame is in the shared union", async () => {
    start();
    expect((await h.call("POST", "/api/events")).status).toBe(405);
    expect((await h.call("POST", "/api/queue")).status).toBe(405);
    const live = await h.subscribe();
    await live.waitFor((e) => e.type === "snapshot");
    live.close();
    for (const e of live.events) expect(appEventSchema.safeParse(e).success).toBe(true);
    expect(existsSync(h.dataDir)).toBe(true);
  });
});
