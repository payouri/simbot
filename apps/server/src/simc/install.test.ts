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
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simcStatusResponseSchema } from "@simbot/shared";
import { createApp } from "../app";
import manifestFixture from "./fixtures/manifest.json";
import tagsFixture from "./fixtures/tags.json";
import { buildLayer } from "./tar-fixture";

const json2 = readFileSync(join(import.meta.dir, "fixtures", "json2.json"), "utf8");
const LATEST_NIGHTLY = tagsFixture.results.find((r) => r.name !== "latest")?.name ?? "";

const digestOf = (bytes: Uint8Array) =>
  `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;

/**
 * Layers shaped like the real image (see fixtures/manifest.json): musl loader and libs,
 * the simc binary, profiles. `simc` is a fake that writes the recorded json2 report, and the
 * loader is a shim that drops `--library-path <p>` and execs the rest, so no musl is needed.
 */
function fakeImage(report: string) {
  const layers = [
    buildLayer([
      { path: "bin/busybox", content: "not needed", mode: 0o755 },
      { path: "lib/ld-musl-x86_64.so.1", content: '#!/bin/sh\nshift 2\nexec "$@"\n', mode: 0o755 },
      { path: "lib/libc.musl-x86_64.so.1", symlink: "ld-musl-x86_64.so.1" },
      { path: "usr/lib/libz.so.1.3.2", content: "z", mode: 0o755 },
      { path: "usr/lib/libz.so.1", symlink: "libz.so.1.3.2" },
      { path: "usr/lib/libapk.so.3.0.0", content: "apk", mode: 0o755 },
      { path: "usr/lib/engines-3/afalg.so", content: "engine", mode: 0o755 },
    ]),
    buildLayer([{ path: "usr/lib/libstdc++.so.6.0.34", content: "cxx", mode: 0o755 }]),
    buildLayer([
      { path: "app/", dir: true },
      {
        path: "app/SimulationCraft/simc",
        content: `#!/bin/sh
for a in "$@"; do case "$a" in json2=*) out="\${a#json2=}";; esac; done
cat > "$out" <<'JSON'
${report}
JSON
`,
        mode: 0o755,
      },
    ]),
    buildLayer([
      { path: "app/SimulationCraft/profiles/CI.simc", content: "optimal_raid=1\n" },
      { path: "app/SimulationCraft/profiles/MID1/MID1_Mage_Fire.simc", content: "mage=x\n" },
    ]),
  ];
  const blobs = new Map(layers.map((l) => [digestOf(l), l]));
  const manifest = {
    ...manifestFixture,
    layers: [...blobs.entries()].map(([digest, bytes]) => ({
      ...manifestFixture.layers[0],
      digest,
      size: bytes.length,
    })),
  };
  return { blobs, manifest };
}

type Handler = (url: string, n: number) => Response | undefined;

/** An injected `fetch` that replays recorded registry/Hub responses and logs every call. */
function fakeRegistry(override: Handler = () => undefined, report: string = json2) {
  const image = fakeImage(report);
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const fetchFn = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const n = (counts.get(url) ?? 0) + 1;
    counts.set(url, n);
    const forced = override(url, n);
    if (forced) return forced;
    if (url.startsWith("https://auth.docker.io/token")) {
      return Response.json({ token: "anonymous-token" });
    }
    if (url.startsWith("https://hub.docker.com/v2/repositories/simulationcraftorg/simc/tags")) {
      return Response.json(tagsFixture);
    }
    if (url.includes("/manifests/")) return Response.json(image.manifest);
    const blob = image.blobs.get(url.slice(url.lastIndexOf("/") + 1));
    if (url.includes("/blobs/") && blob) return new Response(blob);
    return new Response("not found", { status: 404 });
  };
  return { fetch: fetchFn as typeof fetch, calls, image };
}

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

afterEach(() => {
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
    expect(body).toEqual({
      current: {
        tag: LATEST_NIGHTLY,
        simcVersion: "1210-01",
        gitRevision: "d08a1c3",
        gitBranch: "midnight",
        gameDataVersion: "12.1.0.69933",
      },
      install: { state: "idle", error: null },
    });
    expect(LATEST_NIGHTLY).toBe("1210-2026-09-29-d08a1c3");
  });

  test("goes through the injected fetch only: Hub tags, then anonymous registry pull", async () => {
    const registry = fakeRegistry();
    await boot(registry).boot();
    const hosts = registry.calls.map((u) => new URL(u).host);
    expect(new Set(hosts)).toEqual(
      new Set(["hub.docker.com", "auth.docker.io", "registry-1.docker.io"]),
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
    expect(sleeps).toEqual([500, 1000, 500]);
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
    expect(sleeps).toEqual([500, 1000]);
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
