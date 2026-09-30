/**
 * The app over the fake `simc`, seeded for a browser walk of every screen (#52). Run with
 * `bun run smoke:server`; serves the built client (`bun run build` first) and prints
 * `{ port, root, sims }` as its first stdout line. `PORT` sets the port, `SMOKE_ROOT` the
 * temp directory.
 *
 * Seeds one Import, a finished Quick Sim, a finished Top Gear inflated to `SMOKE_ROWS`
 * (default 10,000) Combinations, and a Top Gear Draft. While `<root>/hold` exists, each new
 * Quick Sim's fake `simc` prints a progress line part way through and then waits for
 * `<root>/release`, so a Sim can be watched mid-way and the Queue shows it running.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { importItemsResponseSchema, importSchema, simSchema } from "@simbot/shared";
import { createApp } from "../src/app";
import type { Launch } from "../src/runner/run-sim";
import {
  BUILD_TAG,
  derivedScenario,
  FAKE_SIMC,
  FIXTURES,
  IMPORT_ITEMS,
  importItemsAddonString,
  installFakeBuild,
  installFixtureMeta,
  isFakeSimc,
  smartLaunch,
} from "./harness";

const root = process.env.SMOKE_ROOT ?? mkdtempSync(join(tmpdir(), "simbot-smoke-"));
const dataDir = join(root, "data");
mkdirSync(dataDir, { recursive: true });
const rows = Number(process.env.SMOKE_ROWS ?? 10_000);

const stage = smartLaunch(
  () => root,
  (call) => ({
    baseline: [99_999, 50],
    profilesets: Object.fromEntries(
      call.names.map((n) => [
        n,
        [Number(n) <= 12 ? 100_000 - Number(n) : 60_000, 50] as [number, number],
      ]),
    ),
  }),
);
// The recorded Quick Sim prints only its final progress line (131 of 131 iterations), so a held
// run would read 100% while it waits. This one stops at a hand-written line part way through
// (60 of 131), shaped like the recorded one; it is not SimC output.
const heldScenario = derivedScenario(root, "success", (files) => {
  const header = String(files["stdout.txt"]).split("\n").slice(0, 4);
  const midway = "Baseline\t1\t1\t60\t131\t72.626\t149700.000\t0.851\t1";
  files["stdout.txt"] = Buffer.from(`${[...header, midway].join("\n")}\n`);
});

const launch: Launch = (dir, args) => {
  const input = args[0] as string;
  // A Stage with profilesets is a Top Gear's; a Quick Sim's Stage and the item pass replay recordings.
  const topGearStage =
    /stage-\d+\.simc$/.test(input) && /^profileset\./m.test(readFileSync(input, "utf8"));
  if (topGearStage) return stage(dir, args);
  if (/pass\.simc$/.test(input)) {
    return [process.execPath, FAKE_SIMC, `--scenario=${join(IMPORT_ITEMS, "success")}`, ...args];
  }
  if (!existsSync(join(root, "hold"))) {
    return [process.execPath, FAKE_SIMC, `--scenario=${join(FIXTURES, "success")}`, ...args];
  }
  const gate = `--gate=${join(root, "release")}`;
  return [process.execPath, FAKE_SIMC, `--scenario=${heldScenario}`, gate, ...args];
};

const app = createApp(
  { dataDir, clientDir: resolve(import.meta.dir, "../../client/dist") },
  {
    launch,
    isSimcProcess: isFakeSimc,
    log: () => {},
    progressIntervalMs: 100,
    // No network: Docker Hub, GitHub and Wowhead answer "down", so the SimC page shows its error state.
    fetch: () => Promise.reject(new Error("smoke server: no network")),
  },
);
installFakeBuild(dataDir, app, BUILD_TAG);
installFixtureMeta(dataDir);
const server = Bun.serve({ port: Number(process.env.PORT ?? 0), fetch: app.fetch });

const call = (method: string, path: string, body?: unknown) =>
  app.fetch(
    new Request(`http://smoke.test${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const imp = importSchema.parse(
  await (await call("POST", "/api/imports", { text: importItemsAddonString() })).json(),
);
const quick = simSchema.parse(await (await call("POST", "/api/sims", { importId: imp.id })).json());
await call("POST", `/api/sims/${quick.id}/queue`);
await app.idle();

const topGear = simSchema.parse(
  await (await call("POST", "/api/sims", { importId: imp.id, kind: "top_gear" })).json(),
);
const items = importItemsResponseSchema.parse(
  await (await call("GET", `/api/imports/${imp.id}/items`)).json(),
).items;
const included = [175302, 137410, 118848, 124391, 113884, 35031, 124318, 237613].map((id) => {
  const found = items.find((i) => i.itemId === id && i.source === "bags");
  if (!found) throw new Error(`fixture item ${id} missing`);
  return found.index;
});
await call("PATCH", `/api/sims/${topGear.id}`, {
  topGearSelection: { included, talentLoadouts: [0], lockedSlots: [] },
});
await call("POST", `/api/sims/${topGear.id}/queue`);
await app.idle();

// Inflate the finished Top Gear to `rows` Combinations by cloning one real definition.
const { definition } = app.db
  .query<{ definition: string }, [number]>(
    "SELECT definition FROM combinations WHERE sim_id = ? AND is_baseline = 0 LIMIT 1",
  )
  .get(topGear.id) as { definition: string };
const have = app.db
  .query<{ n: number }, [number]>("SELECT count(*) AS n FROM combinations WHERE sim_id = ?")
  .get(topGear.id)?.n as number;
app.db.transaction(() => {
  const addC = app.db.prepare(
    "INSERT INTO combinations (sim_id, definition, is_baseline) VALUES (?, ?, 0)",
  );
  const addR = app.db.prepare(
    "INSERT INTO stage_results (combination_id, stage, dps_mean, dps_mean_error, survived) VALUES (?, 1, ?, 50, 0)",
  );
  for (let i = have; i < rows; i++) {
    const { lastInsertRowid } = addC.run(topGear.id, definition);
    addR.run(lastInsertRowid, 60_000 + ((i * 7919) % 30_000));
  }
})();

// A Top Gear Draft, left unqueued, for the setup screen.
const setup = simSchema.parse(
  await (await call("POST", "/api/sims", { importId: imp.id, kind: "top_gear" })).json(),
);
await call("PATCH", `/api/sims/${setup.id}`, {
  topGearSelection: { included, talentLoadouts: [0], lockedSlots: [] },
});

console.log(
  JSON.stringify({
    port: server.port,
    root,
    sims: { quick: quick.id, topGear: topGear.id, draft: setup.id },
  }),
);
