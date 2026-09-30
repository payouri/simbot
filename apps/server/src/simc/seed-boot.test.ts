import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { type SimcStatusResponse, simcStatusResponseSchema } from "@simbot/shared";
import { derivedScenario, fakeLaunch } from "../../test/harness";
import { createApp } from "../app";
import { ensureBuildMeta } from "./meta";
import { fakeRegistry, json2, LATEST_NIGHTLY } from "./registry-fixture";
import { loadSeed } from "./seed";

const SEED = "1210-2026-09-20-d08a1c3";

let root: string;
let dataDir: string;
let seedRoot: string;
let scenario: string;
let app: ReturnType<typeof createApp>;
const logs: string[] = [];

/** What `bake-seed-cli` leaves in the image: `simc/<tag>/` with build.json, and `meta/<tag>/`. */
async function bakeSeed() {
  const dir = join(seedRoot, "simc", SEED);
  mkdirSync(join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "profiles"), { recursive: true });
  mkdirSync(join(dir, "usr", "lib"), { recursive: true });
  writeFileSync(join(dir, "usr", "lib", "libz.so.1.3.2"), "lib");
  symlinkSync("libz.so.1.3.2", join(dir, "usr", "lib", "libz.so.1"));
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
  chmodSync(join(dir, "lib", "ld-musl-x86_64.so.1"), 0o755);
  chmodSync(join(dir, "simc"), 0o755);
  const build = {
    tag: SEED,
    simcVersion: "1210-01",
    gitRevision: "d08a1c3",
    gitBranch: "midnight",
    gameDataVersion: "12.1.0.69933",
    ptrGameDataVersion: "12.1.5.69952",
  };
  writeFileSync(join(dir, "build.json"), JSON.stringify(build));
  await ensureBuildMeta({ dataDir: seedRoot, build, fetch: fakeRegistry().fetch });
}

function boot(fetchFn: typeof fetch) {
  const seed = loadSeed(seedRoot);
  app = createApp(
    { dataDir, clientDir: join(root, "client") },
    {
      fetch: fetchFn,
      sleep: async () => {},
      log: (m) => void logs.push(m),
      launch: fakeLaunch(() => scenario),
      seedTag: () => seed?.tag ?? null,
      seedDir: () => seed?.dir ?? null,
      seedMetaDir: () => seed?.metaDir ?? null,
    },
  );
  return app;
}

const status = async (): Promise<SimcStatusResponse> =>
  simcStatusResponseSchema.parse(
    await (await app.fetch(new Request("http://simbot.test/api/simc"))).json(),
  );

const updateJobs = () =>
  app.db.query<{ n: number }, []>("SELECT count(*) AS n FROM jobs WHERE kind = 'simc_update'").get()
    ?.n;

const offline = (async () => {
  throw new TypeError("network is unreachable");
}) as unknown as typeof fetch;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "simbot-seed-"));
  dataDir = join(root, "data");
  seedRoot = join(root, "seed");
  scenario = derivedScenario(root, "success", (files) => {
    const report = JSON.parse(gunzipSync(files["json2.json.gz"] as Buffer).toString());
    report.sim.profilesets = { results: [{ name: "Check Sim", mean: 100_000 }] };
    files["json2.json.gz"] = Buffer.from(gzipSync(JSON.stringify(report)));
  });
  logs.length = 0;
  await bakeSeed();
});

afterEach(async () => {
  await app?.idle();
  app?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("first start on the Seed SimC Build", () => {
  test("offline: the seed is current with its baked item data, and the failed update is shown", async () => {
    boot(offline);
    await app.boot();
    await app.idle();

    const body = await status();
    expect(body.current?.tag).toBe(SEED);
    expect(body.install).toEqual({ state: "idle", error: null });
    expect(existsSync(join(dataDir, "meta", SEED, "item-meta.json"))).toBe(true);
    expect(existsSync(join(dataDir, "meta", SEED, "item-icons.json"))).toBe(true);
    expect(body.job?.status).toBe("failed");
    expect(body.job?.error).toBeTruthy();
    expect(updateJobs()).toBe(1);
  });

  test("the installed seed keeps its relative library symlinks, so it never points back at the seed", async () => {
    boot(offline);
    await app.boot();
    await app.idle();
    expect(readlinkSync(join(dataDir, "simc", SEED, "usr", "lib", "libz.so.1"))).toBe(
      "libz.so.1.3.2",
    );
  });

  test("online: exactly one update to the latest nightly, and later starts queue none", async () => {
    const registry = fakeRegistry();
    boot(registry.fetch);
    await app.boot();
    await app.idle();

    const body = await status();
    expect(body.current?.tag).toBe(LATEST_NIGHTLY);
    expect(body.installed.map((b) => b.tag).sort()).toEqual([SEED, LATEST_NIGHTLY].sort());
    expect(updateJobs()).toBe(1);

    // `status()` may have started a background update check; let it finish before closing the DB.
    await app.idle();
    app.close();
    const again = fakeRegistry();
    boot(again.fetch);
    await app.boot();
    await app.idle();
    expect(updateJobs()).toBe(1);
    expect((await status()).current?.tag).toBe(LATEST_NIGHTLY);
    expect(again.calls.some((u) => u.includes("/manifests/"))).toBe(false);
  });

  test("a failed first update is not queued again on the next start", async () => {
    boot(offline);
    await app.boot();
    await app.idle();
    app.close();

    boot(offline);
    await app.boot();
    await app.idle();
    expect(updateJobs()).toBe(1);
    expect((await status()).current?.tag).toBe(SEED);
  });

  test("without a shipped seed, boot still installs the latest nightly and queues nothing", async () => {
    rmSync(seedRoot, { recursive: true });
    boot(fakeRegistry().fetch);
    await app.boot();
    expect((await status()).current?.tag).toBe(LATEST_NIGHTLY);
    expect(updateJobs()).toBe(0);
  });
});
