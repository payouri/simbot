import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simcStatusResponseSchema } from "@simbot/shared";
import { itemIconsSchema, itemMetaSchema } from "@simbot/simc";
import { createApp } from "../app";
import { isStaleMeta, readBuildMeta } from "./meta";
import { fakeRegistry, fixture, json2, LATEST_NIGHTLY } from "./registry-fixture";

let root: string;
let dataDir: string;
let app: ReturnType<typeof createApp> | undefined;
const sleeps: number[] = [];
const logs: string[] = [];

const boot = (registry: { fetch: typeof fetch }) => {
  app = createApp(
    { dataDir, clientDir: join(root, "client") },
    {
      fetch: registry.fetch,
      sleep: async (ms) => void sleeps.push(ms),
      log: (m) => void logs.push(m),
    },
  );
  return app;
};

const status = async (a = app) => {
  const res = await a?.fetch(new Request("http://simbot.test/api/simc"));
  return { res, body: simcStatusResponseSchema.parse(await res?.json()) };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "simbot-simc-"));
  dataDir = join(root, "data");
  sleeps.length = 0;
  logs.length = 0;
});

afterEach(async () => {
  await app?.idle();
  app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe("boot with an empty data dir", () => {
  test("installs the latest nightly and records it as current", async () => {
    const registry = fakeRegistry();
    const a = boot(registry);
    expect((await status(a)).body.current).toBeNull();

    await a.boot();

    const { res, body } = await status(a);
    expect(res?.status).toBe(200);
    const build = {
      tag: LATEST_NIGHTLY,
      simcVersion: "1210-01",
      gitRevision: "d08a1c3",
      gitBranch: "midnight",
      gameDataVersion: "12.1.0.69933",
      ptrGameDataVersion: null,
    };
    expect(body).toEqual({
      current: build,
      install: { state: "idle", error: null },
      update: null,
      installed: [build],
      keep: 3,
      ptrEnabled: false,
      job: null,
      checkSim: null,
      itemMetaError: null,
    });
    expect(LATEST_NIGHTLY).toBe("1210-2026-09-29-d08a1c3");
  });

  test("goes through the injected fetch only: Hub tags, then anonymous registry pull", async () => {
    const registry = fakeRegistry();
    await boot(registry).boot();
    const hosts = registry.calls.map((u) => new URL(u).host);
    expect(new Set(hosts)).toEqual(
      new Set([
        "hub.docker.com",
        "auth.docker.io",
        "registry-1.docker.io",
        "raw.githubusercontent.com",
        "wago.tools",
      ]),
    );
    expect(registry.calls[0]).toContain("/tags?ordering=last_updated");
    expect(registry.calls.filter((u) => u.includes("/manifests/"))).toEqual([
      `https://registry-1.docker.io/v2/simulationcraftorg/simc/manifests/${LATEST_NIGHTLY}`,
    ]);
    expect(registry.calls.filter((u) => u.includes("/blobs/"))).toHaveLength(4);
  });

  test("extracts simc, the loader, libs and profiles, and nothing else", async () => {
    await boot(fakeRegistry()).boot();
    const dir = join(dataDir, "simc", LATEST_NIGHTLY);
    expect(statSync(join(dir, "simc")).mode & 0o111).not.toBe(0);
    expect(statSync(join(dir, "lib", "ld-musl-x86_64.so.1")).mode & 0o111).not.toBe(0);
    expect(readlinkSync(join(dir, "lib", "libc.musl-x86_64.so.1"))).toBe("ld-musl-x86_64.so.1");
    expect(lstatSync(join(dir, "usr", "lib", "libz.so.1")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, "usr", "lib", "libstdc++.so.6.0.34"))).toBe(true);
    expect(existsSync(join(dir, "profiles", "MID1", "MID1_Mage_Fire.simc"))).toBe(true);
    expect(existsSync(join(dir, "usr", "lib", "libapk.so.3.0.0"))).toBe(false);
    expect(existsSync(join(dir, "usr", "lib", "engines-3"))).toBe(false);
    expect(existsSync(join(dir, "bin"))).toBe(false);
  });

  test("installs via .partial: nothing is left there, and current survives a restart", async () => {
    const registry = fakeRegistry();
    await boot(registry).boot();
    expect(readdirSafe(join(dataDir, "simc", ".partial"))).toEqual([]);

    app?.close();
    const again = fakeRegistry();
    const restarted = boot(again);
    await restarted.boot();
    expect(again.calls).toEqual([]);
    expect((await status(restarted)).body.current?.tag).toBe(LATEST_NIGHTLY);
  });

  test("a recorded current tag whose files are gone is fetched again", async () => {
    await boot(fakeRegistry()).boot();
    rmSync(join(dataDir, "simc", LATEST_NIGHTLY), { recursive: true });
    app?.close();
    const again = fakeRegistry();
    const restarted = boot(again);
    await restarted.boot();
    expect(again.calls.length).toBeGreaterThan(0);
    expect((await status(restarted)).body.current?.tag).toBe(LATEST_NIGHTLY);
  });
});

describe("transient failures", () => {
  test("a 5xx then a 429 are retried with backoff and the install succeeds", async () => {
    const registry = fakeRegistry((url, n) => {
      if (url.includes("hub.docker.com") && n === 1) return new Response("", { status: 503 });
      if (url.includes("hub.docker.com") && n === 2) return new Response("", { status: 502 });
      if (url.includes("/manifests/") && n === 1) return new Response("", { status: 500 });
    });
    const a = boot(registry);
    await a.boot();
    expect((await status(a)).body.current?.tag).toBe(LATEST_NIGHTLY);
    expect(sleeps).toEqual([1000, 4000, 1000]);
  });

  test("Retry-After is honoured, capped at 60 seconds", async () => {
    const registry = fakeRegistry((url, n) => {
      if (url.includes("hub.docker.com") && n === 1) {
        return new Response("", { status: 429, headers: { "retry-after": "7" } });
      }
      if (url.includes("hub.docker.com") && n === 2) {
        return new Response("", { status: 429, headers: { "retry-after": "3600" } });
      }
    });
    await boot(registry).boot();
    expect(sleeps).toEqual([7000, 60_000]);
  });

  test("network errors are retried too", async () => {
    let failed = false;
    const registry = fakeRegistry();
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!failed && String(input).includes("hub.docker.com")) {
        failed = true;
        throw new TypeError("fetch failed");
      }
      return registry.fetch(input, init);
    }) as typeof fetch;
    const a = boot({ fetch: flaky });
    await a.boot();
    expect((await status(a)).body.current?.tag).toBe(LATEST_NIGHTLY);
  });

  test("after 3 tries boot reports the error, continues without a build and leaves no files", async () => {
    const registry = fakeRegistry((url) =>
      url.includes("/blobs/") ? new Response("", { status: 503 }) : undefined,
    );
    const a = boot(registry);
    await a.boot();

    const { res, body } = await status(a);
    expect(res?.status).toBe(200);
    expect(body.current).toBeNull();
    expect(body.install.state).toBe("failed");
    expect(body.install.error).toContain("after 3 attempt(s)");
    expect(logs.join("\n")).toContain("continuing without one");
    expect(registry.calls.filter((u) => u.includes("/blobs/"))).toHaveLength(3);
    expect(sleeps).toEqual([1000, 4000]);
    expect(existsSync(join(dataDir, "simc", LATEST_NIGHTLY))).toBe(false);
    expect(readdirSafe(join(dataDir, "simc", ".partial"))).toEqual([]);
    // The app still serves.
    expect((await a.fetch(new Request("http://simbot.test/api/health"))).status).toBe(200);
  });

  test("a non-transient error (404) is not retried", async () => {
    const registry = fakeRegistry((url) =>
      url.includes("/manifests/") ? new Response("", { status: 404 }) : undefined,
    );
    const a = boot(registry);
    await a.boot();
    expect((await status(a)).body.install.state).toBe("failed");
    expect(registry.calls.filter((u) => u.includes("/manifests/"))).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  test("a corrupted layer is rejected by its digest", async () => {
    const registry = fakeRegistry((url) =>
      url.includes("/blobs/") ? new Response("garbage") : undefined,
    );
    const a = boot(registry);
    await a.boot();
    const { body } = await status(a);
    expect(body.install.error).toContain("digest mismatch");
    expect(body.current).toBeNull();
  });

  test("a build whose json2 output isn't understood is rejected and not installed", async () => {
    const changed = JSON.stringify({ ...JSON.parse(json2), git_revision: undefined });
    const a = boot(fakeRegistry(() => undefined, changed));
    await a.boot();
    const { body } = await status(a);
    expect(body.current).toBeNull();
    expect(body.install.error).toContain("SimC output format changed");
    expect(existsSync(join(dataDir, "simc", LATEST_NIGHTLY))).toBe(false);
    expect(readdirSafe(join(dataDir, "simc", ".partial"))).toEqual([]);
  });
});

describe("item-meta and item-icons", () => {
  const metaDirFor = () => join(dataDir, "meta", LATEST_NIGHTLY);
  const readMeta = (file: string) => JSON.parse(readFileSync(join(metaDirFor(), file), "utf8"));
  const metaCalls = (calls: string[]) =>
    calls.filter((u) => /raw\.githubusercontent|wago\.tools/.test(u));

  test("installing a build also builds both files under meta/<tag>/", async () => {
    const registry = fakeRegistry();
    await boot(registry).boot();
    expect(readdirSafe(metaDirFor()).sort()).toEqual(["item-icons.json", "item-meta.json"]);
    const meta = itemMetaSchema.parse(readMeta("item-meta.json"));
    expect(meta).toMatchObject({ tag: LATEST_NIGHTLY, gitRevision: "d08a1c3" });
    expect(meta.items[270175]?.name).toBe("Voracious Heart of Ula'tek");
    const icons = itemIconsSchema.parse(readMeta("item-icons.json"));
    expect(icons.items[270175]).toBe("inv_121_trinket_raid_ulatek_heart");
    expect(readdirSafe(join(dataDir, "meta", ".partial"))).toEqual([]);
  });

  test("reads SimC's tables at the build's commit and DB2 pinned to its game build", async () => {
    const registry = fakeRegistry();
    await boot(registry).boot();
    const calls = metaCalls(registry.calls);
    for (const table of ["item_data", "item_effect", "item_bonus"]) {
      expect(calls).toContain(
        `https://raw.githubusercontent.com/simulationcraft/simc/d08a1c3/engine/dbc/generated/${table}.inc`,
      );
    }
    const wago = calls.filter((u) => u.includes("wago.tools"));
    expect(wago).toHaveLength(7);
    for (const url of wago) expect(url).toEndWith("/csv?build=12.1.0.69933");
  });

  test("a current build that lacks them gets them on the next boot, and only them", async () => {
    const failing = fakeRegistry((url) =>
      url.includes("wago.tools") ? new Response("", { status: 400 }) : undefined,
    );
    await boot(failing).boot();
    // The install itself is unharmed.
    expect((await status()).body.current?.tag).toBe(LATEST_NIGHTLY);
    expect((await status()).body.install.state).toBe("idle");
    expect(logs.join("\n")).toContain("could not build item-meta and item-icons");
    expect(existsSync(metaDirFor())).toBe(false);
    expect(readdirSafe(join(dataDir, "meta", ".partial"))).toEqual([]);
    // The failure is reported, not only logged.
    expect((await status()).body.itemMetaError).toContain("400");

    app?.close();
    const again = fakeRegistry();
    await boot(again).boot();
    expect((await status()).body.itemMetaError).toBeNull();
    expect(again.calls.every((u) => /raw\.githubusercontent|wago\.tools/.test(u))).toBe(true);
    expect(existsSync(join(metaDirFor(), "item-meta.json"))).toBe(true);
  });

  test("nothing is fetched when both files are already there", async () => {
    await boot(fakeRegistry()).boot();
    app?.close();
    const again = fakeRegistry();
    await boot(again).boot();
    expect(again.calls).toEqual([]);
  });

  test("a truncated file is rebuilt", async () => {
    await boot(fakeRegistry()).boot();
    writeFileSync(join(metaDirFor(), "item-meta.json"), '{"schemaVersion":1');
    app?.close();
    const again = fakeRegistry();
    await boot(again).boot();
    expect(metaCalls(again.calls).length).toBeGreaterThan(0);
    expect(itemMetaSchema.safeParse(readMeta("item-meta.json")).success).toBe(true);
  });

  test("item data built before icon overrides were read is rebuilt", async () => {
    await boot(fakeRegistry()).boot();
    const file = join(metaDirFor(), "item-icons.json");
    const icons = JSON.parse(readFileSync(file, "utf8"));
    icons.bonusIcons = undefined;
    writeFileSync(file, JSON.stringify(icons));
    app?.close();
    const again = fakeRegistry();
    await boot(again).boot();
    expect(metaCalls(again.calls).length).toBeGreaterThan(0);
    expect(readMeta("item-icons.json").bonusIcons).toBeDefined();
  });

  test("stale item data stays readable when its rebuild fails", async () => {
    await boot(fakeRegistry()).boot();
    const file = join(metaDirFor(), "item-icons.json");
    const icons = JSON.parse(readFileSync(file, "utf8"));
    icons.bonusIcons = undefined;
    writeFileSync(file, JSON.stringify(icons));
    app?.close();
    const failing = fakeRegistry((url) =>
      url.includes("wago.tools") ? new Response("", { status: 400 }) : undefined,
    );
    await boot(failing).boot();
    expect(logs.join("\n")).toContain("could not build item-meta and item-icons");
    const kept = await readBuildMeta(dataDir, LATEST_NIGHTLY);
    expect(kept?.icons.items[270175]).toBe("inv_121_trinket_raid_ulatek_heart");
    expect(kept && isStaleMeta(kept)).toBe(true);
  });

  test("transient failures on the network sources are retried", async () => {
    const registry = fakeRegistry((url, n) => {
      if (url.includes("item_data.inc") && n === 1) return new Response("", { status: 503 });
      if (url.includes("/ItemSparse/") && n === 1) return new Response("", { status: 429 });
    });
    await boot(registry).boot();
    expect(existsSync(join(metaDirFor(), "item-icons.json"))).toBe(true);
    expect(sleeps).toEqual([1000, 1000]);
  });

  test("data pinned to another build than asked for is refused", async () => {
    const registry = fakeRegistry((url) =>
      url.includes("/ItemLimitCategory/")
        ? new Response(fixture("ItemLimitCategory.csv"), {
            headers: {
              "content-disposition": 'attachment; filename="ItemLimitCategory.12.1.5.70077.csv"',
            },
          })
        : undefined,
    );
    await boot(registry).boot();
    expect(logs.join("\n")).toContain("another build");
    expect(existsSync(metaDirFor())).toBe(false);
  });

  test("a game data version the source doesn't have (400) fails once, without retries", async () => {
    const registry = fakeRegistry((url) =>
      url.includes("/Item/") ? new Response("", { status: 400 }) : undefined,
    );
    await boot(registry).boot();
    expect(metaCalls(registry.calls).filter((u) => u.includes("/Item/"))).toHaveLength(1);
    expect(existsSync(metaDirFor())).toBe(false);
  });

  test("changed SimC table layouts fail the build instead of writing bad data", async () => {
    const registry = fakeRegistry((url) =>
      url.includes("item_bonus.inc") ? new Response("// nothing here\n") : undefined,
    );
    await boot(registry).boot();
    expect(logs.join("\n")).toContain("SimC generated data format changed");
    expect(existsSync(metaDirFor())).toBe(false);
  });
});

describe("/api/simc", () => {
  test("only answers GET", async () => {
    const a = boot(fakeRegistry());
    const res = await a.fetch(new Request("http://simbot.test/api/simc", { method: "POST" }));
    expect(res.status).toBe(405);
  });
});

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
