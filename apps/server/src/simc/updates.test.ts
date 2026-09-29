import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simcStatusResponseSchema } from "@simbot/shared";
import { createApp } from "../app";
import tagsFixture from "./fixtures/tags.json";

const CURRENT = "1210-2026-09-28-4c7c736";
const REVISION = "4c7c736";
const HUB_TAGS = tagsFixture.results.map((r) => r.name); // latest, 09-29, 09-28, 09-27
const GITHUB = "https://api.github.com/repos/simulationcraft/simc";

const commit = (sha: string, message: string) => ({
  sha,
  html_url: `https://github.com/simulationcraft/simc/commit/${sha}`,
  commit: { message },
});

type World = {
  /** Newest-first Hub tags. */
  hubTags: string[];
  aheadBy: number;
  commits: ReturnType<typeof commit>[];
  defaultBranch: string;
  github: "ok" | "down";
};

/** Injected `fetch` for GitHub and Docker Hub that logs every call. */
function fakeWorld(overrides: Partial<World> = {}) {
  const world: World = {
    hubTags: HUB_TAGS.filter((t) => t !== "latest").filter((t) => t <= CURRENT),
    aheadBy: 0,
    commits: [],
    defaultBranch: "midnight",
    github: "ok",
    ...overrides,
  };
  const calls: string[] = [];
  const fetchFn = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.startsWith("https://hub.docker.com/")) {
      return Response.json({ results: world.hubTags.map((name) => ({ name })) });
    }
    if (url.startsWith(GITHUB)) {
      if (world.github === "down") return new Response("nope", { status: 500 });
      if (url === GITHUB) return Response.json({ default_branch: world.defaultBranch });
      if (url === `${GITHUB}/compare/${REVISION}...${world.defaultBranch}`) {
        return Response.json({
          ahead_by: world.aheadBy,
          html_url: `https://github.com/simulationcraft/simc/compare/${REVISION}...${world.defaultBranch}`,
          commits: world.commits,
        });
      }
    }
    return new Response("not found", { status: 404 });
  };
  return {
    world,
    fetch: fetchFn as typeof fetch,
    calls,
    githubCalls: () => calls.filter((u) => u.startsWith(GITHUB)),
    hubCalls: () => calls.filter((u) => u.startsWith("https://hub.docker.com/")),
  };
}

let root: string;
let dataDir: string;
let app: ReturnType<typeof createApp> | undefined;
let clock: number;
const logs: string[] = [];

/** Boots an app whose Current SimC Build is `CURRENT`, as if installed earlier. */
function boot(fake: { fetch: typeof fetch }, opts: { seedTag?: string; current?: boolean } = {}) {
  if (opts.current !== false) {
    const dir = join(dataDir, "simc", CURRENT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "build.json"),
      JSON.stringify({
        tag: CURRENT,
        simcVersion: "1210-01",
        gitRevision: REVISION,
        gitBranch: "midnight",
        gameDataVersion: "12.1.0.69933",
      }),
    );
  }
  app = createApp(
    { dataDir, clientDir: join(root, "client") },
    {
      fetch: fake.fetch,
      sleep: async () => {},
      log: (m) => void logs.push(m),
      seedTag: () => opts.seedTag ?? null,
      now: () => new Date(clock),
    },
  );
  if (opts.current !== false) {
    app.db.run(
      "INSERT INTO settings (key, value) VALUES ('simc.current_tag', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [CURRENT],
    );
  }
  return app;
}

const req = (a: NonNullable<typeof app>, path: string, method = "GET") =>
  a.fetch(new Request(`http://simbot.test${path}`, { method }));

/** What a client sees: GET /api/simc, then wait for the background check it triggered. */
async function clientAsks(a: NonNullable<typeof app>) {
  const first = simcStatusResponseSchema.parse(await (await req(a, "/api/simc")).json());
  await a.idle();
  const settled = simcStatusResponseSchema.parse(await (await req(a, "/api/simc")).json());
  return { first, settled };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "simbot-updates-"));
  dataDir = join(root, "data");
  clock = Date.parse("2026-09-30T10:00:00Z");
  logs.length = 0;
});

afterEach(() => {
  app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe("when checks run", () => {
  test("nothing is fetched until a client asks", async () => {
    const fake = fakeWorld();
    boot(fake);
    await app?.idle();
    expect(fake.calls).toEqual([]);
  });

  test("with no Current SimC Build there is nothing to compare from", async () => {
    const fake = fakeWorld();
    const a = boot(fake, { current: false });
    const { settled } = await clientAsks(a);
    expect(settled.update).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  test("the first ask returns instantly with no result and triggers a check", async () => {
    const fake = fakeWorld();
    const a = boot(fake);
    const { first, settled } = await clientAsks(a);
    expect(first.update).toBeNull();
    expect(settled.update?.state).toBe("up_to_date");
    expect(fake.githubCalls().length).toBeGreaterThan(0);
    expect(fake.hubCalls()).toHaveLength(1);
  });

  test("a second ask within the hour is served from the store", async () => {
    const fake = fakeWorld();
    const a = boot(fake);
    await clientAsks(a);
    const before = fake.calls.length;
    clock += 59 * 60 * 1000;
    const { first } = await clientAsks(a);
    expect(first.update?.state).toBe("up_to_date");
    expect(fake.calls).toHaveLength(before);
  });

  test("an ask after the hour checks again", async () => {
    const fake = fakeWorld();
    const a = boot(fake);
    await clientAsks(a);
    const before = fake.calls.length;
    clock += 61 * 60 * 1000;
    const { settled } = await clientAsks(a);
    expect(fake.calls.length).toBe(before * 2);
    expect(settled.update?.checkedAt).toBe(new Date(clock).toISOString());
  });

  test("POST /api/simc/check forces one within the hour and returns the result", async () => {
    const fake = fakeWorld();
    const a = boot(fake);
    await clientAsks(a);
    const before = fake.calls.length;
    fake.world.aheadBy = 1;
    fake.world.commits = [commit("aaa1111", "Fix it")];
    const res = await req(a, "/api/simc/check", "POST");
    expect(res.status).toBe(200);
    const body = simcStatusResponseSchema.parse(await res.json());
    expect(body.update?.state).toBe("commits_ahead");
    expect(fake.calls.length).toBe(before * 2);
    expect((await req(a, "/api/simc/check")).status).toBe(405);
  });

  test("concurrent asks share one check", async () => {
    const fake = fakeWorld();
    const a = boot(fake);
    await Promise.all([req(a, "/api/simc"), req(a, "/api/simc"), req(a, "/api/simc")]);
    await a.idle();
    expect(fake.hubCalls()).toHaveLength(1);
  });
});

describe("the three states", () => {
  test("up to date: no commits ahead and nothing newer on the Hub", async () => {
    const a = boot(fakeWorld());
    const { settled } = await clientAsks(a);
    expect(settled.update).toMatchObject({
      state: "up_to_date",
      aheadBy: 0,
      commits: [],
      target: null,
      error: null,
      currentTag: CURRENT,
      branch: "midnight",
    });
  });

  test("commits ahead: the branch moved but no newer build exists yet", async () => {
    const fake = fakeWorld({
      aheadBy: 2,
      commits: [
        commit("bbb2222", "[Mage] Fire: tweak Combustion\n\nLong body."),
        commit("ccc3333", "Update spell data"),
      ],
    });
    const a = boot(fake);
    const { settled } = await clientAsks(a);
    expect(settled.update).toMatchObject({
      state: "commits_ahead",
      aheadBy: 2,
      target: null,
      compareUrl: `https://github.com/simulationcraft/simc/compare/${REVISION}...midnight`,
    });
    expect(settled.update?.commits).toEqual([
      {
        sha: "bbb2222",
        title: "[Mage] Fire: tweak Combustion",
        message: "[Mage] Fire: tweak Combustion\n\nLong body.",
        url: "https://github.com/simulationcraft/simc/commit/bbb2222",
      },
      {
        sha: "ccc3333",
        title: "Update spell data",
        message: "Update spell data",
        url: "https://github.com/simulationcraft/simc/commit/ccc3333",
      },
    ]);
  });

  test("the active branch comes from default_branch, not a constant", async () => {
    const fake = fakeWorld({ defaultBranch: "thewarwithin" });
    const a = boot(fake);
    await clientAsks(a);
    expect(fake.githubCalls()).toContain(`${GITHUB}/compare/${REVISION}...thewarwithin`);
  });

  test("installable: a newer nightly exists, and only the newest is offered", async () => {
    const fake = fakeWorld({
      hubTags: ["1210-2026-09-29-d08a1c3", "1210-2026-09-28-9999999", CURRENT],
      aheadBy: 5,
      commits: [commit("ddd4444", "Something")],
    });
    const a = boot(fake);
    const { settled } = await clientAsks(a);
    expect(settled.update).toMatchObject({
      state: "installable",
      target: { source: "nightly", tag: "1210-2026-09-29-d08a1c3" },
      aheadBy: 5,
    });
  });

  test("installable: a Seed SimC Build newer than current is offered", async () => {
    const a = boot(fakeWorld(), { seedTag: "1210-2026-09-29-abcdef0" });
    const { settled } = await clientAsks(a);
    expect(settled.update).toMatchObject({
      state: "installable",
      target: { source: "seed", tag: "1210-2026-09-29-abcdef0" },
    });
  });

  test("installable: the newest of a newer nightly and a newer seed wins", async () => {
    const fake = fakeWorld({ hubTags: ["1210-2026-09-30-eeeeeee", CURRENT] });
    const a = boot(fake, { seedTag: "1210-2026-09-29-abcdef0" });
    const { settled } = await clientAsks(a);
    expect(settled.update?.target).toEqual({ source: "nightly", tag: "1210-2026-09-30-eeeeeee" });
  });

  test("a seed that is not newer than current is not offered", async () => {
    const a = boot(fakeWorld(), { seedTag: "1210-2026-09-20-0000000" });
    const { settled } = await clientAsks(a);
    expect(settled.update?.state).toBe("up_to_date");
  });

  test("the result survives a restart and is not re-fetched", async () => {
    const fake = fakeWorld({ aheadBy: 1, commits: [commit("fff5555", "One")] });
    const a = boot(fake);
    await clientAsks(a);
    const before = fake.calls.length;
    a.close();
    const again = boot(fake);
    const { first } = await clientAsks(again);
    expect(first.update?.state).toBe("commits_ahead");
    expect(fake.calls).toHaveLength(before);
  });

  test("a result made for an older Current SimC Build is not shown for a new one", async () => {
    const fake = fakeWorld();
    const a = boot(fake);
    await clientAsks(a);
    a.db.run(
      "UPDATE settings SET value = '1210-2026-09-27-7ffaabf' WHERE key = 'simc.current_tag'",
    );
    const res = simcStatusResponseSchema.parse(await (await req(a, "/api/simc")).json());
    expect(res.current).toBeNull(); // not installed on disk, so no stale update either
    expect(res.update).toBeNull();
  });
});

describe("failures", () => {
  test("a failed check keeps the previous result, records the error and is not retried at once", async () => {
    const fake = fakeWorld({ aheadBy: 1, commits: [commit("fff5555", "One")] });
    const a = boot(fake);
    await clientAsks(a);

    fake.world.github = "down";
    clock += 2 * 60 * 60 * 1000;
    const { settled } = await clientAsks(a);
    expect(settled.update).toMatchObject({ state: "commits_ahead", aheadBy: 1 });
    expect(settled.update?.error).toContain("HTTP 500");
    expect(logs.some((l) => l.includes("update check failed"))).toBe(true);

    const before = fake.calls.length;
    await clientAsks(a);
    expect(fake.calls).toHaveLength(before);

    // A forced check retries, and success clears the error.
    fake.world.github = "ok";
    const forced = simcStatusResponseSchema.parse(
      await (await req(a, "/api/simc/check", "POST")).json(),
    );
    expect(forced.update?.error).toBeNull();
  });
});

describe("GET /api/events", () => {
  test("streams simc.status_changed when a check finishes", async () => {
    const a = boot(fakeWorld());
    const res = await req(a, "/api/events");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    let text = "";
    const read = async (until: string) => {
      while (!text.includes(until)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };

    await read(": connected");
    await req(a, "/api/simc/check", "POST");
    await read("simc.status_changed");
    await reader.cancel();

    expect(text).toContain('event: simc.status_changed\ndata: {"type":"simc.status_changed"}\n\n');
  });
});
