import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  apiErrorSchema,
  queueResponseSchema,
  simcStatusResponseSchema,
  simListResponseSchema,
  simSchema,
} from "@simbot/shared";
import { BUILD_TAG, FIXTURES, fakeLaunch, type Harness, makeHarness } from "./harness";

let h: Harness;
let report: string;
const launch = fakeLaunch(
  () => join(FIXTURES, "success"),
  () => report,
);

const start = async (ptrEnabled = true) => {
  h = makeHarness({ launch });
  report = join(h.root, "launch.json");
  if (ptrEnabled) await setPtr(true);
  return h;
};

const setPtr = async (on: boolean) => {
  await h.call("PATCH", "/api/simc/settings", { ptrEnabled: on });
  // Reading the status starts a background update check; let it finish before the test ends.
  await h.app.idle();
};

const rmLaunch = () => rmSync(report, { force: true });

/** The SimC input the fake `simc` was launched with. */
const launched = () =>
  existsSync(report) ? (JSON.parse(readFileSync(report, "utf8")).input as string) : null;

const rewriteBuild = (patch: Record<string, unknown>) => {
  const path = join(h.dataDir, "simc", BUILD_TAG, "build.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...patch }));
};

afterEach(() => h?.close());

describe("Game Data in Sim Settings", () => {
  test("defaults to live everywhere", async () => {
    await start(false);
    const imp = await h.importText();
    const sim = await h.createSim(imp.id);
    expect(sim.settings.gameData).toBe("live");
    // A Sim stored before Game Data existed reads as live.
    const stored = JSON.parse(
      (h.app.db.query("SELECT settings FROM sims WHERE id = ?").get(sim.id) as { settings: string })
        .settings,
    );
    delete stored.gameData;
    h.app.db.run("UPDATE sims SET settings = ? WHERE id = ?", [JSON.stringify(stored), sim.id]);
    expect((await h.sim(sim.id)).settings.gameData).toBe("live");
  });

  test("a Draft can pick PTR while PTR Sims are on, and it is saved and frozen", async () => {
    await start();
    const imp = await h.importText();
    const sim = await h.createSim(imp.id, { gameData: "ptr" });
    expect(sim.settings.gameData).toBe("ptr");
    const saved = await h.call("PATCH", `/api/sims/${sim.id}`, { settings: { gameData: "live" } });
    expect(simSchema.parse(await saved.json()).settings.gameData).toBe("live");
    await h.call("PATCH", `/api/sims/${sim.id}`, { settings: { gameData: "ptr" } });
    await h.queue(sim.id);
    const late = await h.call("PATCH", `/api/sims/${sim.id}`, { settings: { gameData: "live" } });
    expect(late.status).toBe(409);
  });

  test("a patch that leaves Game Data out keeps the Draft's", async () => {
    await start();
    const imp = await h.importText();
    const sim = await h.createSim(imp.id, { gameData: "ptr" });
    const res = await h.call("PATCH", `/api/sims/${sim.id}`, { settings: { targets: 2 } });
    expect(simSchema.parse(await res.json()).settings).toMatchObject({
      gameData: "ptr",
      targets: 2,
    });
  });
});

describe("refusing PTR while PTR Sims are off", () => {
  test("a new Draft with PTR Game Data is refused", async () => {
    await start(false);
    const imp = await h.importText();
    const res = await h.call("POST", "/api/sims", {
      importId: imp.id,
      settings: { gameData: "ptr" },
    });
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error).toBe("ptr_disabled");
    expect(h.app.db.query("SELECT count(*) AS n FROM sims").get()).toEqual({ n: 0 });
  });

  test("so is switching a Live Draft to PTR, and copying a Live Sim as PTR", async () => {
    await start(false);
    const imp = await h.importText();
    const live = await h.createSim(imp.id);
    const patched = await h.call("PATCH", `/api/sims/${live.id}`, {
      settings: { gameData: "ptr" },
    });
    expect(patched.status).toBe(409);
    const copied = await h.call("POST", "/api/sims", {
      copyFromSimId: live.id,
      settings: { gameData: "ptr" },
    });
    expect(copied.status).toBe(409);
    expect((await h.sim(live.id)).settings.gameData).toBe("live");
  });

  test("a frozen Live Sim answers not_a_draft, not ptr_disabled, and a missing source 404s", async () => {
    await start(false);
    const imp = await h.importText();
    const live = await h.createSim(imp.id);
    await h.queue(live.id);
    const patched = await h.call("PATCH", `/api/sims/${live.id}`, {
      settings: { gameData: "ptr" },
    });
    expect(patched.status).toBe(409);
    expect(apiErrorSchema.parse(await patched.json()).error).toBe("not_a_draft");
    const missing = await h.call("POST", "/api/sims", {
      copyFromSimId: 9999,
      settings: { gameData: "ptr" },
    });
    expect(missing.status).toBe(404);
  });

  test("a PTR Draft made while it was on can still be saved and queued once it is off", async () => {
    await start();
    const imp = await h.importText();
    const sim = await h.createSim(imp.id, { gameData: "ptr" });
    await setPtr(false);
    const saved = await h.call("PATCH", `/api/sims/${sim.id}`, { settings: { targets: 2 } });
    expect(saved.status).toBe(200);
    expect((await h.queue(sim.id)).status).toBe("queued");
    await h.app.idle();
    expect((await h.sim(sim.id)).status).toBe("succeeded");
  });
});

describe("raw SimC options", () => {
  test.each([
    "ptr=1",
    "ptr=0",
    "fight_style=Patchwerk ptr=1",
    "  PTR = 1",
    "fight_style=Patchwerk\nptr=1",
  ])("a ptr line (%j) is refused with a clear message", async (rawOptions) => {
    await start();
    const imp = await h.importText();
    const create = await h.call("POST", "/api/sims", {
      importId: imp.id,
      settings: { rawOptions },
    });
    expect(create.status).toBe(400);
    expect(JSON.stringify(await create.json())).toContain("Raw options cannot set ptr");
    const draft = await h.createSim(imp.id);
    const patch = await h.call("PATCH", `/api/sims/${draft.id}`, { settings: { rawOptions } });
    expect(patch.status).toBe(400);
  });

  test("other options that merely contain ptr are fine", async () => {
    await start();
    const imp = await h.importText();
    const sim = await h.createSim(imp.id, { rawOptions: "optr=1\nscript_ptr=2" });
    expect(sim.settings.rawOptions).toBe("optr=1\nscript_ptr=2");
  });
});

describe("running a PTR Sim", () => {
  test("its SimC input has ptr=1 and records the PTR game data version", async () => {
    await start();
    const sim = await h.runQuickSim({ gameData: "ptr" });
    expect(sim.status).toBe("succeeded");
    expect(launched()).toMatch(/^ptr=1$/m);
    expect(sim.settings.gameData).toBe("ptr");
    expect(sim.simcTag).toBe(BUILD_TAG);
    expect(sim.gameDataVersion).toBe("12.1.5.69952");
    const results = await h.results(sim.id);
    expect(results).toMatchObject({ gameData: "ptr", gameDataVersion: "12.1.5.69952" });
  });

  test("a Live Sim's input never has ptr=1, and it records the Live version", async () => {
    await start();
    const sim = await h.runQuickSim();
    expect(sim.status).toBe("succeeded");
    expect(launched()).not.toMatch(/^\s*ptr\s*=/m);
    expect(sim.gameDataVersion).toBe("12.1.0.69933");
    expect(await h.results(sim.id)).toMatchObject({ gameData: "live" });
  });

  test("the list says which Sims are PTR", async () => {
    await start();
    const ptr = await h.runQuickSim({ gameData: "ptr" });
    const res = simListResponseSchema.parse(await (await h.call("GET", "/api/sims")).json());
    expect(res.find((s) => s.id === ptr.id)?.gameData).toBe("ptr");
  });

  test.each([
    [
      "the PTR data is the same as Live",
      { ptrGameDataVersion: "12.1.0.69933" },
      "its PTR game data is the same as Live",
    ],
    ["the build has no PTR data", { ptrGameDataVersion: null }, "no PTR version is recorded"],
  ])("fails clearly and never runs on Live when %s", async (_name, patch, reason) => {
    await start();
    rewriteBuild(patch);
    const sim = await h.runQuickSim({ gameData: "ptr" });
    expect(sim.status).toBe("failed");
    expect(sim.error?.kind).toBe("ptr_unavailable");
    expect(sim.error?.message).toContain(`No PTR data in SimC Build ${BUILD_TAG}`);
    expect(sim.error?.message).toContain(reason);
    expect(launched()).toBeNull();
  });

  test("names a failed PTR Check Sim, not Live, and records no PTR version", async () => {
    await start();
    h.app.db.run(
      "INSERT OR REPLACE INTO ptr_check_results (build_tag, error, created_at) VALUES (?, ?, ?)",
      [BUILD_TAG, "SimC exited 1", new Date().toISOString()],
    );
    const sim = await h.runQuickSim({ gameData: "ptr" });
    expect(sim.status).toBe("failed");
    expect(sim.error?.kind).toBe("ptr_unavailable");
    expect(sim.error?.message).toContain("PTR failed its Check Sim: SimC exited 1");
    expect(sim.error?.message).not.toContain("same as Live");
    expect(sim.gameDataVersion).toBeNull();
    expect(launched()).toBeNull();
  });

  test("a copy of a PTR Sim is a PTR Draft with no version yet", async () => {
    await start();
    const sim = await h.runQuickSim({ gameData: "ptr" });
    expect(sim.gameDataVersion).not.toBeNull();
    const copy = await h.call("POST", `/api/sims/${sim.id}/copy-to-draft`);
    const draft = simSchema.parse(await copy.json());
    expect(draft).toMatchObject({ gameDataVersion: null, settings: { gameData: "ptr" } });
  });

  test("the setting reads back through the SimC status", async () => {
    await start();
    const status = simcStatusResponseSchema.parse(await (await h.call("GET", "/api/simc")).json());
    await h.app.idle();
    expect(status.ptrEnabled).toBe(true);
  });
});

describe("Copy to PTR Draft and PTR Sims with the setting on and off", () => {
  const copyAsPtr = (id: number) =>
    h.call("POST", "/api/sims", { copyFromSimId: id, settings: { gameData: "ptr" } });

  test("a Live Sim copied to a PTR Draft keeps its setup, runs on PTR and is badged PTR", async () => {
    await start();
    const live = await h.runQuickSim({ targets: 3 });
    const res = await copyAsPtr(live.id);
    expect(res.status).toBe(201);
    const draft = simSchema.parse(await res.json());
    expect(draft).toMatchObject({
      status: "draft",
      importId: live.importId,
      settings: { gameData: "ptr", targets: 3 },
    });
    rmLaunch();
    await h.queue(draft.id);
    await h.app.idle();
    expect(launched()).toMatch(/^ptr=1$/m);
    expect((await h.sim(draft.id)).gameDataVersion).toBe("12.1.5.69952");
    const list = simListResponseSchema.parse(await (await h.call("GET", "/api/sims")).json());
    expect(list.find((s) => s.id === draft.id)?.gameData).toBe("ptr");
    expect(list.find((s) => s.id === live.id)?.gameData).toBe("live");
  });

  test("copying a Live Sim to PTR is refused while the setting is off", async () => {
    await start();
    const live = await h.runQuickSim();
    await setPtr(false);
    const res = await copyAsPtr(live.id);
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error).toBe("ptr_disabled");
  });

  test("copying a PTR Sim gives a PTR Draft that queues and runs with the setting off", async () => {
    await start();
    const ptr = await h.runQuickSim({ gameData: "ptr" });
    await setPtr(false);
    for (const copy of [
      await h.call("POST", `/api/sims/${ptr.id}/copy-to-draft`),
      await h.call("POST", "/api/sims", { copyFromSimId: ptr.id }),
      await copyAsPtr(ptr.id),
    ]) {
      expect(copy.status).toBe(201);
      const draft = simSchema.parse(await copy.json());
      expect(draft.settings.gameData).toBe("ptr");
      rmLaunch();
      expect((await h.queue(draft.id)).status).toBe("queued");
      await h.app.idle();
      expect(launched()).toMatch(/^ptr=1$/m);
      expect((await h.sim(draft.id)).status).toBe("succeeded");
    }
  });

  test("the Queue says which Sims are PTR", async () => {
    await start();
    const imp = await h.importText();
    const ptr = await h.createSim(imp.id, { gameData: "ptr" });
    const live = await h.createSim(imp.id);
    await h.queue(ptr.id);
    await h.queue(live.id);
    const queue = queueResponseSchema.parse(await (await h.call("GET", "/api/queue")).json());
    const gameData = (id: number) =>
      queue.entries.flatMap((e) => (e.type === "sim" && e.simId === id ? [e.gameData] : []));
    expect(gameData(ptr.id)).toEqual(["ptr"]);
    expect(gameData(live.id)).toEqual(["live"]);
    await h.app.idle();
  });

  test("turning the setting off leaves queued and past PTR Sims as they were", async () => {
    await start();
    const past = await h.runQuickSim({ gameData: "ptr" });
    const imp = await h.importText();
    const waiting = await h.createSim(imp.id, { gameData: "ptr" });
    rmLaunch();
    await h.queue(waiting.id);
    await setPtr(false);
    await h.app.idle();
    const ran = await h.sim(waiting.id);
    expect(ran).toMatchObject({ status: "succeeded", settings: { gameData: "ptr" } });
    expect(launched()).toMatch(/^ptr=1$/m);
    expect(await h.sim(past.id)).toMatchObject({
      status: "succeeded",
      settings: { gameData: "ptr" },
    });
    expect(await h.results(past.id)).toMatchObject({ gameData: "ptr" });
    const list = simListResponseSchema.parse(await (await h.call("GET", "/api/sims")).json());
    expect(list.filter((s) => s.gameData === "ptr")).toHaveLength(2);
  });
});
