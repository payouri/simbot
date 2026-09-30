/**
 * A Top Gear (Smart Sim) against a real SimC Build. Opt-in and outside the gate: run it with
 * `bun run test:simc` when the profileset fixtures are recorded again or SimC's output format is
 * in doubt. Needs an installed SimC Build and its item-meta in `SIMBOT_DATA_DIR` (the app
 * installs both on first start). Checks what the fake `simc` stands in for: the profileset
 * override lines, `set_bonus_enabled`, and the shape of `profilesets.results[]`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { importItemsResponseSchema, rankResults, type Sim, simSchema } from "@simbot/shared";
import { loadConfig } from "../src/config";
import { type Harness, importItemsAddonString, makeHarness } from "./harness";

const enabled = process.env.SIMBOT_TEST_SIMC === "1";
let h: Harness;

/** Two Candidate Items in each of three slots: 3^3 = 27 Combinations, well over one Stage's worth. */
const IDS = [175302, 137410, 118848, 124391, 113884, 35031];

describe.skipIf(!enabled)("Top Gear against a real SimC Build", () => {
  beforeAll(() => {
    const dataDir = loadConfig().dataDir;
    const tag = readdirSync(join(dataDir, "simc")).find((d) => !d.startsWith("."));
    if (!tag || !existsSync(join(dataDir, "meta", tag, "item-meta.json"))) {
      throw new Error(
        `no SimC Build with item data in ${dataDir}; run the app once to install one`,
      );
    }
    h = makeHarness({ withBuild: false });
    symlinkSync(join(dataDir, "simc"), join(h.dataDir, "simc"));
    symlinkSync(join(dataDir, "meta"), join(h.dataDir, "meta"));
    h.app.db.run("INSERT INTO settings (key, value) VALUES ('simc.current_tag', ?)", [tag]);
  });

  afterAll(() => h?.close());

  test("ranks every Combination with a positive DPS and a small error, from real profileset reports", async () => {
    const imp = await h.importText(importItemsAddonString());
    const draft = simSchema.parse(
      await (
        await h.call("POST", "/api/sims", {
          importId: imp.id,
          kind: "top_gear",
          settings: { precision: "low" },
        })
      ).json(),
    );
    const { items } = importItemsResponseSchema.parse(
      await (await h.call("GET", `/api/imports/${imp.id}/items`)).json(),
    );
    const included = IDS.map((id) => {
      const found = items.find((i) => i.itemId === id && i.source === "bags");
      if (!found) throw new Error(`fixture item ${id} missing`);
      return found.index;
    });
    const put = await h.call("PATCH", `/api/sims/${draft.id}`, {
      topGearSelection: { included, talentLoadouts: [0], lockedSlots: [] },
    });
    expect(put.status).toBe(200);
    await h.queue(draft.id);
    await h.app.idle();

    const sim: Sim = await h.sim(draft.id);
    expect(sim.error).toBeNull();
    expect(sim.status).toBe("succeeded");

    const out = await h.results(draft.id);
    expect(out.combinations).toHaveLength(27);
    expect(out.combinations.filter((c) => c.invalidStage !== null)).toEqual([]);
    const ranking = rankResults(out.results);
    expect(ranking.rows.length).toBeGreaterThan(4);
    for (const row of ranking.rows) {
      expect(row.mean).toBeGreaterThan(10_000);
      expect(row.error).toBeGreaterThan(0);
      expect(row.error / row.mean).toBeLessThan(0.02);
    }
  }, 600_000);
});
