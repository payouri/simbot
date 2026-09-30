import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  apiErrorSchema,
  type CombinationPreview,
  combinationDefinitionSchema,
  combinationPreviewSchema,
  importItemsResponseSchema,
  MAX_COMBINATIONS,
  simSchema,
} from "@simbot/shared";
import { queueSim } from "../src/db/sims";
import type { Launch } from "../src/runner/run-sim";
import {
  BUILD_TAG,
  FAKE_SIMC,
  type Harness,
  IMPORT_ITEMS,
  importItemsAddonString,
  installFixtureMeta,
  makeHarness,
  smartLaunch,
} from "./harness";

let h: Harness;
afterEach(() => h?.close());

function start() {
  // A Top Gear Stage (profilesets in its input) is answered by the Smart Sim fake; the item
  // pass replays its recording.
  const stage = smartLaunch(
    () => h.root,
    (call) => ({
      profilesets: Object.fromEntries(
        call.names.map((n) => [n, [99_000, 100] as [number, number]]),
      ),
    }),
  );
  const launch: Launch = (dir, args) =>
    /^profileset\./m.test(readFileSync(args[0] as string, "utf8"))
      ? stage(dir, args)
      : [process.execPath, FAKE_SIMC, `--scenario=${join(IMPORT_ITEMS, "success")}`, ...args];
  h = makeHarness({ launch });
  installFixtureMeta(h.dataDir);
}

async function draft() {
  const imp = await h.importText(importItemsAddonString());
  const res = await h.call("POST", "/api/sims", { importId: imp.id, kind: "top_gear" });
  const sim = simSchema.parse(await res.json());
  const items = importItemsResponseSchema.parse(
    await (await h.call("GET", `/api/imports/${imp.id}/items`)).json(),
  ).items;
  return { imp, sim, items };
}

/** Item index by Import order, as in the fixture: see the addon string. */
const at = (
  items: { index: number; itemId: number | null; source: string }[],
  id: number,
  source = "bags",
) => {
  const found = items.find((i) => i.itemId === id && i.source === source);
  if (!found) throw new Error(`fixture item ${id} missing`);
  return found.index;
};

const selection = (included: number[], extra: Record<string, unknown> = {}) => ({
  included,
  talentLoadouts: [0],
  lockedSlots: [],
  ...extra,
});

const previewOf = async (simId: number, body: unknown = {}) => {
  const res = await h.call("POST", `/api/sims/${simId}/preview-combinations`, body);
  expect(res.status).toBe(200);
  return combinationPreviewSchema.parse(await res.json());
};
const put = (id: number, topGearSelection: unknown) =>
  h.call("PATCH", `/api/sims/${id}`, { topGearSelection });

describe("POST /api/sims/:id/preview-combinations", () => {
  test("the equipped set alone is one Combination", async () => {
    start();
    const { sim } = await draft();
    const p = await previewOf(sim.id);
    expect(p).toMatchObject({ count: 1, refused: false, softWarning: false, issues: [] });
    expect(p.estimateSeconds).toBeGreaterThan(0);
    expect(p.estimateBasis).toBe("default");
  });

  test("counts pruned Combinations for unsaved edits, and leaves the Draft alone", async () => {
    start();
    const { sim, items } = await draft();
    const heads = [at(items, 175302), at(items, 137410)];
    const p = await previewOf(sim.id, { topGearSelection: selection(heads) });
    expect(p.count).toBe(3);
    expect((await h.sim(sim.id)).topGearSelection?.included).toEqual([]);
  });

  test("rings are unordered pairs, a unique-equipped copy is pruned", async () => {
    start();
    const { sim, items } = await draft();
    const rings = [at(items, 169160), at(items, 251934), at(items, 124899)];
    // worn pair plus 3 bag rings (the Platinum Star Band copy is not included): C(5,2)
    expect((await previewOf(sim.id, { topGearSelection: selection(rings) })).count).toBe(10);
    // Light Company Guidon is unique-equipped and on-use: the bag copy never joins the worn one
    const guidon = at(items, 249344);
    const p = await previewOf(sim.id, { topGearSelection: selection([guidon]) });
    // {gaze, guidon} baseline, {gaze, guidonCopy} identical -> deduped, {guidon, guidonCopy} pruned
    expect(p.count).toBe(1);
  });

  test("at most one Great Vault item", async () => {
    start();
    const { sim, items } = await draft();
    const vault = at(items, 148780, "great_vault");
    const p = await previewOf(sim.id, {
      topGearSelection: selection([vault, at(items, 118848)]),
    });
    expect(p.count).toBe(2 * 2);
  });

  test("a locked slot keeps what is worn", async () => {
    start();
    const { sim, items } = await draft();
    const heads = [at(items, 175302), at(items, 137410)];
    const p = await previewOf(sim.id, {
      topGearSelection: selection(heads, { lockedSlots: ["head"] }),
    });
    expect(p.count).toBe(1);
  });

  test("a one-handed weapon with no off hand is reported against its Candidate", async () => {
    start();
    const { sim, items } = await draft();
    const axe = at(items, 61402);
    const p = await previewOf(sim.id, { topGearSelection: selection([axe]) });
    expect(p.count).toBe(1);
    expect(p.issues).toHaveLength(1);
    expect(p.issues[0]).toMatchObject({ candidate: axe, path: "topGearSelection.included.0" });
    expect(p.issues[0]?.message).toContain("one-handed");
    // Frost dual wields: two one-handers make a pair.
    const pair = await previewOf(sim.id, {
      topGearSelection: selection([axe, at(items, 115646)]),
    });
    expect(pair.issues).toEqual([]);
    expect(pair.count).toBe(2);
  });

  test("Talent Loadouts and settings feed the estimate", async () => {
    start();
    const { sim, items } = await draft();
    const heads = [at(items, 175302), at(items, 137410)];
    const long = await previewOf(sim.id, {
      topGearSelection: selection(heads),
      settings: { durationSeconds: 600, precision: "high" },
    });
    const short = await previewOf(sim.id, {
      topGearSelection: selection(heads),
      settings: { durationSeconds: 60, precision: "low" },
    });
    expect(long.count).toBe(short.count);
    expect(long.estimateSeconds ?? 0).toBeGreaterThan((short.estimateSeconds ?? 0) * 10);
  });

  test("above 50,000 Combinations it is refused, with no estimate", async () => {
    start();
    const { sim, items } = await draft();
    const everything = items.filter((i) => i.selectable).map((i) => i.index);
    const p: CombinationPreview = await previewOf(sim.id, {
      topGearSelection: selection(everything),
    });
    expect(p.refused).toBe(true);
    expect(p.count).toBeGreaterThan(MAX_COMBINATIONS);
    expect(p.estimateSeconds).toBeNull();
    expect(p.issues.some((i) => i.path === "topGearSelection")).toBe(true);
  });

  test("a long estimate warns softly but is not refused", async () => {
    start();
    const { sim, items } = await draft();
    const p = await previewOf(sim.id, {
      topGearSelection: selection(
        items
          .filter(
            (i) => i.selectable && ["head", "neck", "shoulders", "back", "chest"].includes(i.slot),
          )
          .map((i) => i.index),
      ),
      settings: { durationSeconds: 1800, precision: "high", targets: 1 },
    });
    expect(p.refused).toBe(false);
    expect(p.softWarning).toBe(p.estimateSeconds !== null && p.estimateSeconds > 1800);
  });

  test("is fast enough for live typing", async () => {
    start();
    const { sim, items } = await draft();
    const body = {
      topGearSelection: selection(items.filter((i) => i.selectable).map((i) => i.index)),
    };
    await previewOf(sim.id, body);
    const started = performance.now();
    await previewOf(sim.id, body);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  test("uses the Check Sim of the Current SimC Build once there is one", async () => {
    start();
    const { sim, items } = await draft();
    const body = { topGearSelection: selection([at(items, 175302), at(items, 137410)]) };
    const before = await previewOf(sim.id, body);
    h.app.db.run(
      `INSERT INTO check_sim_results
         (build_tag, import_id, previous_tag, dps_mean, dps_mean_error, created_at, duration_ms, iterations)
       VALUES (?, ?, NULL, 100000, 500, ?, 60000, 1000)`,
      [BUILD_TAG, sim.importId, new Date().toISOString()],
    );
    const after = await previewOf(sim.id, body);
    expect(after.estimateBasis).toBe("check_sim");
    expect(after.estimateSeconds).not.toBe(before.estimateSeconds);
  });

  test("404 for an unknown Sim", async () => {
    start();
    expect((await h.call("POST", "/api/sims/999/preview-combinations", {})).status).toBe(404);
  });
});

describe("queueing a Top Gear", () => {
  test("freezes the Combinations, baseline first, and the SimC Build they were validated on", async () => {
    start();
    const { sim, items } = await draft();
    const included = [at(items, 175302), at(items, 137410), at(items, 118848)];
    expect((await put(sim.id, selection(included))).status).toBe(200);
    const preview = await previewOf(sim.id);
    const before = h.app.db;
    const res = await h.call("POST", `/api/sims/${sim.id}/queue`);
    expect(res.status).toBe(200);
    const rows = before
      .query<{ definition: string; is_baseline: number }, [number]>(
        "SELECT definition, is_baseline FROM combinations WHERE sim_id = ? ORDER BY id",
      )
      .all(sim.id);
    expect(rows).toHaveLength(preview.count);
    expect(rows[0]?.is_baseline).toBe(1);
    expect(rows.filter((r) => r.is_baseline).length).toBe(1);
    const defs = rows.map((r) => combinationDefinitionSchema.parse(JSON.parse(r.definition)));
    expect(defs[0]?.kind).toBe("equipped");
    expect(defs[1]?.kind).toBe("gear");
    expect(new Set(defs.map((d) => JSON.stringify(d.gear))).size).toBe(defs.length);
    expect(
      before
        .query<{ frozen_simc_tag: string | null }, [number]>(
          "SELECT frozen_simc_tag FROM sims WHERE id = ?",
        )
        .get(sim.id)?.frozen_simc_tag,
    ).toBe(BUILD_TAG);
    await h.app.idle();
  });

  test("a Candidate no Combination can use is a 422 with a per-Candidate error, and stays a Draft", async () => {
    start();
    const { sim, items } = await draft();
    const axe = at(items, 61402);
    await put(sim.id, selection([axe]));
    const res = await h.call("POST", `/api/sims/${sim.id}/queue`);
    expect(res.status).toBe(422);
    const err = apiErrorSchema.parse(await res.json());
    expect(err.error).toBe("invalid_combinations");
    expect(err.issues?.[0]?.path).toBe("topGearSelection.included.0");
    expect((await h.sim(sim.id)).status).toBe("draft");
  });

  test("above 50,000 Combinations queueing is refused", async () => {
    start();
    const { sim, items } = await draft();
    // Saved through the DB: PATCH would accept it too, but this keeps the test about the queue.
    await put(sim.id, selection(items.filter((i) => i.selectable).map((i) => i.index)));
    const res = await h.call("POST", `/api/sims/${sim.id}/queue`);
    expect(res.status).toBe(422);
    const err = apiErrorSchema.parse(await res.json());
    expect(err.message).toContain("Too many");
    expect((await h.sim(sim.id)).status).toBe("draft");
    const n = h.app.db
      .query<{ n: number }, [number]>("SELECT count(*) AS n FROM combinations WHERE sim_id = ?")
      .get(sim.id);
    expect(n?.n).toBe(0);
  });

  test("a Discard puts it back to Draft with nothing frozen", async () => {
    start();
    const { sim, items } = await draft();
    await put(sim.id, selection([at(items, 175302)]));
    // Hold the Queue so the Sim is still queued: queue it straight in the DB.
    const queued = queueSim(h.app.db, sim.id, {
      selection: (await h.sim(sim.id)).topGearSelection ?? selection([]),
      simcTag: BUILD_TAG,
      combinations: [],
    });
    expect(queued.ok).toBe(true);
    await h.call("POST", `/api/sims/${sim.id}/stop`, { keep: false });
    expect(
      h.app.db
        .query<{ frozen_simc_tag: string | null }, [number]>(
          "SELECT frozen_simc_tag FROM sims WHERE id = ?",
        )
        .get(sim.id)?.frozen_simc_tag,
    ).toBeNull();
  });

  test("a plan built from a selection that changed meanwhile is refused", async () => {
    start();
    const { sim, items } = await draft();
    await put(sim.id, selection([at(items, 175302)]));
    const result = queueSim(h.app.db, sim.id, {
      selection: selection([at(items, 137410)]),
      simcTag: BUILD_TAG,
      combinations: [],
    });
    expect(result).toEqual({ ok: false, reason: "selection_changed" });
  });
});

describe("Job start", () => {
  test("re-validates Combinations frozen on another SimC Build, and fails the Sim if they no longer hold", async () => {
    start();
    const { sim, items } = await draft();
    const unknown = items.find((i) => i.status === "unknown")?.index ?? -1;
    await put(sim.id, selection([at(items, 175302)]));
    const current = (await h.sim(sim.id)).topGearSelection;
    if (!current) throw new Error("no selection");
    queueSim(h.app.db, sim.id, {
      selection: current,
      simcTag: "old-build",
      combinations: [
        { isBaseline: true, definition: { kind: "equipped", gear: { head: 0 }, talentLoadout: 0 } },
        {
          isBaseline: false,
          definition: { kind: "gear", gear: { chest: unknown }, talentLoadout: 0 },
        },
      ],
    });
    h.app.bus.emit({ type: "queue.changed" });
    await h.app.idle();
    const after = await h.sim(sim.id);
    expect(after.status).toBe("failed");
    expect(after.error?.kind).toBe("invalid_combinations");
  });

  test("a Sim frozen on the Current SimC Build starts without re-validation", async () => {
    start();
    const { sim, items } = await draft();
    await put(sim.id, selection([at(items, 175302)]));
    expect((await h.call("POST", `/api/sims/${sim.id}/queue`)).status).toBe(200);
    await h.app.idle();
    expect((await h.sim(sim.id)).status).toBe("succeeded");
  });

  test("re-validation of a still-valid Sim lets it run", async () => {
    start();
    const { sim, items } = await draft();
    await put(sim.id, selection([at(items, 175302)]));
    const current = (await h.sim(sim.id)).topGearSelection;
    if (!current) throw new Error("no selection");
    const frozen = await h.app.combos.freeze(await h.sim(sim.id));
    if (!frozen.ok) throw new Error("freeze failed");
    queueSim(h.app.db, sim.id, {
      selection: current,
      simcTag: "old-build",
      combinations: frozen.combinations,
    });
    h.app.bus.emit({ type: "queue.changed" });
    await h.app.idle();
    expect((await h.sim(sim.id)).status).toBe("succeeded");
  });
});

describe("POST /api/sims/:id/preselect", () => {
  test("adds likely upgrades within 500 Combinations, vault first, once", async () => {
    start();
    const { sim, items } = await draft();
    const res = await h.call("POST", `/api/sims/${sim.id}/preselect`);
    expect(res.status).toBe(200);
    const after = simSchema.parse(await res.json());
    const included = after.topGearSelection?.included ?? [];
    expect(included.length).toBeGreaterThan(0);
    expect(after.topGearSelection?.preselected).toBe(true);
    const vault = at(items, 148780, "great_vault");
    expect(included).toContain(vault);
    const p = await previewOf(sim.id);
    expect(p.count).toBeLessThanOrEqual(500);
    expect(p.issues).toEqual([]);
    // Candidates that are no upgrade stay out: the ilvl 289 head does not beat the worn 289.
    expect(included).not.toContain(at(items, 175302));
    // A second call changes nothing.
    const again = simSchema.parse(
      await (await h.call("POST", `/api/sims/${sim.id}/preselect`)).json(),
    );
    expect(again.topGearSelection).toEqual(after.topGearSelection);
    // And it queues.
    expect((await h.call("POST", `/api/sims/${sim.id}/queue`)).status).toBe(200);
    await h.app.idle();
  });

  test("is refused outside Draft and for a Quick Sim", async () => {
    start();
    const { sim } = await draft();
    await h.call("POST", `/api/sims/${sim.id}/queue`);
    await h.app.idle();
    expect((await h.call("POST", `/api/sims/${sim.id}/preselect`)).status).toBe(409);
  });
});
