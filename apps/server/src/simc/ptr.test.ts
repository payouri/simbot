import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ptrAvailable, type SimcStatusResponse, simcStatusResponseSchema } from "@simbot/shared";
import { createApp } from "../app";
import { fakeRegistry, LATEST_NIGHTLY } from "./registry-fixture";

const CURRENT = "1210-2026-09-20-4c7c736";
const SEED = "1210-2026-09-25-abcdef0";
const LIVE = "12.1.0.69933";

let root: string;
let dataDir: string;
let seedRoot: string;
let app: ReturnType<typeof createApp>;

const writeBuild = (dir: string, tag: string, extra: Record<string, unknown>) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "build.json"),
    JSON.stringify({
      tag,
      simcVersion: "1210-01",
      gitRevision: tag.split("-").at(-1),
      gitBranch: "midnight",
      gameDataVersion: LIVE,
      ...extra,
    }),
  );
};

/** GitHub and Docker Hub answer "nothing newer than CURRENT"; only the Seed can be offered. */
const quietWorld = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://hub.docker.com/")) {
    return Response.json({ results: [{ name: CURRENT }] });
  }
  if (url === "https://api.github.com/repos/simulationcraft/simc") {
    return Response.json({ default_branch: "midnight" });
  }
  if (url.startsWith("https://api.github.com/repos/simulationcraft/simc/compare/")) {
    return Response.json({ ahead_by: 0, commits: [], html_url: "https://github.test/compare" });
  }
  return new Response("not found", { status: 404 });
}) as unknown as typeof fetch;

function boot(fetchFn: typeof fetch, opts: { current?: Record<string, unknown>; seed?: boolean }) {
  if (opts.current) {
    writeBuild(join(dataDir, "simc", CURRENT), CURRENT, opts.current);
  }
  if (opts.seed)
    writeBuild(join(seedRoot, "simc", SEED), SEED, { ptrGameDataVersion: "12.1.5.70077" });
  app = createApp(
    { dataDir, clientDir: join(root, "client") },
    {
      fetch: fetchFn,
      sleep: async () => {},
      log: () => {},
      seedTag: () => (opts.seed ? SEED : null),
      seedDir: () => (opts.seed ? join(seedRoot, "simc", SEED) : null),
    },
  );
  if (opts.current) {
    app.db.run(
      "INSERT INTO settings (key, value) VALUES ('simc.current_tag', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [CURRENT],
    );
  }
  return app;
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

const setPtr = async (ptrEnabled: boolean) => {
  const res = await call("PATCH", "/api/simc/settings", { ptrEnabled });
  expect(res.status).toBe(200);
  return simcStatusResponseSchema.parse(await res.json());
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "simbot-ptr-"));
  dataDir = join(root, "data");
  seedRoot = join(root, "seed");
});

afterEach(async () => {
  await app?.idle();
  app?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("the simc.ptr_enabled setting", () => {
  test("is off by default, set through the SimC settings endpoint, and survives a restart", async () => {
    boot(quietWorld, { current: { ptrGameDataVersion: "12.1.5.69952" } });
    expect((await status()).ptrEnabled).toBe(false);
    expect((await setPtr(true)).ptrEnabled).toBe(true);
    await app.idle();
    app.close();

    boot(quietWorld, { current: { ptrGameDataVersion: "12.1.5.69952" } });
    expect((await status()).ptrEnabled).toBe(true);
    expect((await setPtr(false)).ptrEnabled).toBe(false);
  });

  test("shares the endpoint with keep: each alone works, neither is a 400", async () => {
    boot(quietWorld, { current: {} });
    const both = await call("PATCH", "/api/simc/settings", { keep: 2, ptrEnabled: true });
    const body = simcStatusResponseSchema.parse(await both.json());
    expect([body.keep, body.ptrEnabled]).toEqual([2, true]);
    expect((await call("PATCH", "/api/simc/settings", { keep: 5 })).status).toBe(200);
    expect((await status()).ptrEnabled).toBe(true);
    expect((await call("PATCH", "/api/simc/settings", {})).status).toBe(400);
    expect((await call("PATCH", "/api/simc/settings", { ptrEnabled: "yes" })).status).toBe(400);
  });
});

describe("Live and PTR versions on the status", () => {
  test("with the setting on, each installed build carries both versions", async () => {
    boot(quietWorld, { current: { ptrGameDataVersion: "12.1.5.69952" } });
    const body = await setPtr(true);
    const expected = { gameDataVersion: LIVE, ptrGameDataVersion: "12.1.5.69952" };
    expect(body.current).toMatchObject(expected);
    expect(body.installed[0]).toMatchObject(expected);
    expect(ptrAvailable(body.current as NonNullable<typeof body.current>)).toBe(true);
  });

  test("with the setting off, builds keep their real PTR version, so a PTR Draft copied then is judged on the facts", async () => {
    boot(quietWorld, { current: { ptrGameDataVersion: "12.1.5.69952" } });
    const body = await status();
    expect(body.ptrEnabled).toBe(false);
    expect(body.current?.ptrGameDataVersion).toBe("12.1.5.69952");
    expect(body.installed.map((b) => b.ptrGameDataVersion)).toEqual(["12.1.5.69952"]);
    // The runner will run a PTR Sim on this build, so the status must not say it has no PTR.
    expect(ptrAvailable(body.current as NonNullable<typeof body.current>)).toBe(true);
    expect(body.update?.ptrChange ?? null).toBeNull();
  });

  test("a PTR equal to Live is not available", async () => {
    boot(quietWorld, { current: { ptrGameDataVersion: LIVE } });
    const build = (await setPtr(true)).current;
    expect(build?.ptrGameDataVersion).toBe(LIVE);
    expect(ptrAvailable(build as NonNullable<typeof build>)).toBe(false);
  });

  test("a build installed before PTR versions were recorded counts as no PTR available", async () => {
    boot(quietWorld, { current: {} });
    const build = (await setPtr(true)).current;
    expect(build?.ptrGameDataVersion).toBeNull();
    expect(ptrAvailable(build as NonNullable<typeof build>)).toBe(false);
  });

  test("the probe records both versions on the build it installs, whatever the setting", async () => {
    boot(fakeRegistry().fetch, {});
    await app.boot();
    const onDisk = JSON.parse(
      readFileSync(join(dataDir, "simc", LATEST_NIGHTLY, "build.json"), "utf8"),
    );
    expect(onDisk).toMatchObject({ gameDataVersion: LIVE, ptrGameDataVersion: "12.1.5.69952" });
    expect((await status()).current?.ptrGameDataVersion).toBe("12.1.5.69952");
    expect((await setPtr(true)).current).toMatchObject({
      gameDataVersion: LIVE,
      ptrGameDataVersion: "12.1.5.69952",
    });
  });
});

describe("the update offer", () => {
  const offered = async () => {
    await status();
    await app.idle();
    return status();
  };

  test("marks a PTR data change when both versions are known and the setting is on", async () => {
    boot(quietWorld, { current: { ptrGameDataVersion: "12.1.5.69952" }, seed: true });
    await setPtr(true);
    const body = await offered();
    expect(body.update?.target).toEqual({ source: "seed", tag: SEED });
    expect(body.update?.ptrChange).toEqual({ from: "12.1.5.69952", to: "12.1.5.70077" });
  });

  test("shows no mark when the setting is off", async () => {
    boot(quietWorld, { current: { ptrGameDataVersion: "12.1.5.69952" }, seed: true });
    const body = await offered();
    expect(body.update?.state).toBe("installable");
    expect(body.update?.ptrChange ?? null).toBeNull();
  });

  test("reads the Seed's PTR version only from the Seed directory, never from the working directory", async () => {
    // A build.json for the Seed's tag sits in the working directory, but no Seed directory is wired.
    const cwd = process.cwd();
    const elsewhere = join(root, "cwd");
    writeBuild(elsewhere, SEED, { ptrGameDataVersion: "12.1.5.70077" });
    writeBuild(join(dataDir, "simc", CURRENT), CURRENT, { ptrGameDataVersion: "12.1.5.69952" });
    app = createApp(
      { dataDir, clientDir: join(root, "client") },
      { fetch: quietWorld, sleep: async () => {}, log: () => {}, seedTag: () => SEED },
    );
    app.db.run("INSERT INTO settings (key, value) VALUES ('simc.current_tag', ?)", [CURRENT]);
    process.chdir(elsewhere);
    try {
      await setPtr(true);
      const body = await offered();
      expect(body.update?.target).toEqual({ source: "seed", tag: SEED });
      expect(body.update?.ptrChange ?? null).toBeNull();
    } finally {
      process.chdir(cwd);
    }
  });

  test("shows no mark when the PTR version is unchanged or the current one is unknown", async () => {
    boot(quietWorld, { current: { ptrGameDataVersion: "12.1.5.70077" }, seed: true });
    await setPtr(true);
    expect((await offered()).update?.ptrChange ?? null).toBeNull();
    app.close();

    boot(quietWorld, { current: {}, seed: true });
    await setPtr(true);
    expect((await offered()).update?.ptrChange ?? null).toBeNull();
  });
});
