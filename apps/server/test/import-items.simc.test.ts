/**
 * The packed item pass against a real SimC Build. Opt-in and outside the gate: run it with
 * `bun run test:simc` (needs an installed SimC Build and its item-meta in `SIMBOT_DATA_DIR`,
 * which the app installs on first start). Checks the numbers the recorded fixtures
 * stand in for, and the time budget: about 180 Candidate Items in at most 0.5 s.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { importItemsResponseSchema } from "@simbot/shared";
import { loadConfig } from "../src/config";
import { type Harness, importItemsAddonString, makeHarness } from "./harness";

const enabled = process.env.SIMBOT_TEST_SIMC === "1";
let h: Harness;

describe.skipIf(!enabled)("packed item pass against a real SimC Build", () => {
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

  const view = async (text: string) => {
    const imp = await h.importText(text);
    const res = await h.call("GET", `/api/imports/${imp.id}/items`);
    return importItemsResponseSchema.parse(await res.json());
  };

  test("reads every known item of a wide Addon String, without unknown ids aborting it", async () => {
    const { items, pass, unknown } = await view(importItemsAddonString());
    expect(pass.status).toBe("ok");
    expect(unknown.itemIds).toEqual([999999]);
    expect(items.filter((i) => i.status === "ok").length).toBeGreaterThan(40);
  }, 60_000);

  test("about 180 Candidate Items take at most 0.5 s", async () => {
    const base = importItemsAddonString();
    const head = base.slice(0, base.indexOf("### Gear from Bags"));
    const { items: known } = await view(base);
    const pool = known.filter(
      (i) => i.status === "ok" && i.source === "bags" && i.slot !== "main_hand",
    );
    const lines = Array.from({ length: 180 }, (_, n) => {
      const item = pool[n % pool.length];
      return `# ${item?.slot}=,id=${item?.itemId},bonus_id=${item?.bonusIds.join("/")}`;
    });
    const text = `${head}### Gear from Bags\n#\n${lines.join("\n")}\n`;
    const { pass, items } = await view(text);
    expect(pass.status).toBe("ok");
    expect(items.filter((i) => i.source !== "equipped")).toHaveLength(180);
    expect(pass.ms).toBeLessThanOrEqual(500);
  }, 60_000);
});
