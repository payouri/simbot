import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ImportItem, importItemsResponseSchema, itemIndexSchema } from "@simbot/shared";
import type { Launch } from "../src/runner/run-sim";
import {
  BUILD_TAG,
  FAKE_SIMC,
  type Harness,
  IMPORT_ITEMS,
  importItemsAddonString,
  installFakeBuild,
  installFixtureMeta,
  makeHarness,
} from "./harness";

let h: Harness;
let reports: string;
afterEach(() => {
  h?.close();
  if (reports) rmSync(reports, { recursive: true, force: true });
});

/** Replays `scenarios` in launch order (the last one repeats), recording each launch's input. */
function start(scenarios: string[], opts: { meta?: boolean } = {}) {
  reports = mkdtempSync(join(tmpdir(), "simbot-reports-"));
  let calls = 0;
  const launch: Launch = (_dir, args) => {
    const n = calls++;
    const scenario = scenarios[Math.min(n, scenarios.length - 1)] as string;
    return [
      process.execPath,
      FAKE_SIMC,
      `--scenario=${join(IMPORT_ITEMS, scenario)}`,
      `--report=${join(reports, `run-${n}.json`)}`,
      ...args,
    ];
  };
  h = makeHarness({ launch });
  if (opts.meta ?? true) installFixtureMeta(h.dataDir);
  return { launches: () => calls };
}

const launchedInput = (n: number): string =>
  (JSON.parse(readFileSync(join(reports, `run-${n}.json`), "utf8")) as { input: string }).input;

async function itemsOf(importId: number) {
  const res = await h.call("GET", `/api/imports/${importId}/items`);
  expect(res.status).toBe(200);
  return importItemsResponseSchema.parse(await res.json());
}

const find = (items: ImportItem[], source: string, slot: string, itemId: number) =>
  items.find((i) => i.source === source && i.slot === slot && i.itemId === itemId);

describe("the packed item pass at Import", () => {
  test("runs once per Import and stores the item index on it", async () => {
    const { launches } = start(["success"]);
    const imp = await h.importText(importItemsAddonString());
    expect(launches()).toBe(1);
    const row = h.app.db
      .query<{ item_index: string }, [number]>("SELECT item_index FROM imports WHERE id = ?")
      .get(imp.id);
    const index = itemIndexSchema.parse(JSON.parse(row?.item_index ?? "null"));
    expect(index.simcTag).toBe(BUILD_TAG);
    expect(index.pass).toMatchObject({ status: "ok", actors: 7 });
    expect(index.items).toHaveLength(54);

    // Reading the items, or pasting the same text again, never runs SimC again.
    await itemsOf(imp.id);
    await h.importText(importItemsAddonString());
    expect(launches()).toBe(1);
  });

  test("the launched input equals the recorded one: one pass, packed into copy= actors", async () => {
    start(["success"]);
    await h.importText(importItemsAddonString());
    const recorded = readFileSync(join(IMPORT_ITEMS, "success/input.simc"), "utf8");
    expect(launchedInput(0)).toBe(recorded);
    expect(recorded).toContain("iterations=1");
    expect(recorded).toContain("item_db_source=local");
    expect(recorded.match(/^copy=/gm)).toHaveLength(7);
    // Equipped gems and enchants are not part of the pass, so an unknown gem cannot abort it.
    expect(recorded).not.toMatch(/gem_id|enchant/);
  });

  test("Unknown Items stay out of the pass and are recorded on the Import", async () => {
    start(["success"]);
    const imp = await h.importText(importItemsAddonString());
    expect(launchedInput(0)).not.toContain("999999");
    expect(launchedInput(0)).not.toContain("999998");
    // The known item with an unknown bonus is left out too: it would get a silently wrong ilvl.
    expect(launchedInput(0)).not.toContain("id=71982");

    const { items, unknown } = await itemsOf(imp.id);
    expect(unknown).toMatchObject({ itemIds: [999999], bonusIds: [999998], unknownFields: [] });
    expect(unknown.items).toEqual([
      expect.objectContaining({
        slot: "chest",
        source: "bags",
        itemId: 999999,
        unknownItemId: true,
        unknownBonusIds: [],
      }),
      expect.objectContaining({
        slot: "legs",
        itemId: 71982,
        unknownItemId: false,
        unknownBonusIds: [999998],
      }),
    ]);
    const unknownItems = items.filter((i) => i.status === "unknown");
    expect(unknownItems).toHaveLength(2);
    for (const item of unknownItems) {
      expect(item).toMatchObject({
        ilvl: null,
        stats: null,
        quality: null,
        icon: null,
        selectable: false,
      });
    }
  });

  test("reads ilvl and stats for equipped items and Candidate Items", async () => {
    start(["success"]);
    const imp = await h.importText(importItemsAddonString());
    const { items, pass, simcTag } = await itemsOf(imp.id);
    expect(simcTag).toBe(BUILD_TAG);
    expect(pass.status).toBe("ok");

    const crown = find(items, "equipped", "head", 249970);
    expect(crown).toMatchObject({
      name: "Relentless Rider's Crown",
      ilvl: 289,
      quality: 4,
      icon: "inv_plate_raiddeathknightmidnight_d_01_helm",
      status: "ok",
      selectable: false,
    });
    expect(crown?.stats).toMatchObject({ stamina: 2326, haste_rating: 107, mastery_rating: 57 });
    // The equipped ring's gem and enchant are not counted; the item's own numbers are.
    expect(find(items, "equipped", "finger1", 193708)?.stats).toEqual({
      stamina: 1309,
      crit_rating: 199,
      mastery_rating: 104,
    });

    const vaultHead = items.find((i) => i.source === "great_vault" && i.slot === "head");
    expect(vaultHead).toMatchObject({ status: "ok", ilvl: 298, selectable: true });
  });

  test("a Candidate Item with the equipped item's id still gets its data", async () => {
    start(["success"]);
    const imp = await h.importText(importItemsAddonString());
    const { items } = await itemsOf(imp.id);
    const ring = find(items, "bags", "finger1", 193708);
    const guidon = find(items, "bags", "trinket1", 249344);
    const crown = find(items, "bags", "head", 249970);
    expect(ring).toMatchObject({ status: "ok", ilvl: 289, selectable: true });
    expect(guidon).toMatchObject({ status: "ok", ilvl: 298, selectable: true });
    // Same id as the equipped crown, other bonus ids: its own ilvl, not the equipped one's.
    expect(crown).toMatchObject({ status: "ok", ilvl: 298, selectable: true });
  });

  test("an item SimC did not report has no numbers and cannot be selected", async () => {
    start(["success"]);
    const imp = await h.importText(importItemsAddonString());
    const { items } = await itemsOf(imp.id);
    // A death knight cannot use a shield: SimC drops it from gear without saying so.
    const shield = items.find((i) => i.slot === "off_hand");
    expect(shield).toMatchObject({
      status: "unresolved",
      ilvl: null,
      stats: null,
      selectable: false,
      icon: expect.any(String),
    });
    expect(items.filter((i) => i.status === "unresolved").length).toBeGreaterThan(0);
    // No item shows numbers unless SimC reported that very item.
    for (const item of items.filter((i) => i.status === "ok")) {
      expect(item.ilvl).toBeGreaterThan(200);
    }
  });

  test("when SimC rejects one actor the pass drops it and runs again", async () => {
    const { launches } = start(["init-error", "dropped-actor"]);
    const imp = await h.importText(importItemsAddonString());
    expect(launches()).toBe(2);
    expect(launchedInput(0)).toContain("copy=o0,base");
    expect(launchedInput(1)).not.toContain("copy=o0,base");
    const { items, pass } = await itemsOf(imp.id);
    expect(pass).toMatchObject({ status: "ok", actors: 6 });
    expect(items.find((i) => i.slot === "off_hand")?.status).toBe("unresolved");
    expect(find(items, "equipped", "head", 249970)?.status).toBe("ok");
  });

  test("a pass SimC fails leaves the Import in place, items shown without numbers", async () => {
    // `init-error` names `o0` again on the retry: after that no actor is left to blame.
    start(["init-error"]);
    const res = await h.call("POST", "/api/imports", { text: importItemsAddonString() });
    expect(res.status).toBe(201);
    const imp = (await res.json()) as { id: number };
    const { items, pass } = await itemsOf(imp.id);
    expect(pass.status).toBe("failed");
    expect(pass.reason).toContain("Off-Hand weapon equipped with a 2h");
    expect(items).toHaveLength(54);
    expect(items.filter((i) => i.status === "ok")).toHaveLength(0);
    expect(items.filter((i) => i.status === "unknown")).toHaveLength(2);
  });

  test("without item data for the build the pass is skipped and the Import succeeds", async () => {
    const { launches } = start(["success"], { meta: false });
    const imp = await h.importText(importItemsAddonString());
    expect(launches()).toBe(0);
    const { pass, items, unknown } = await itemsOf(imp.id);
    expect(pass).toMatchObject({ status: "skipped" });
    expect(items).toHaveLength(54);
    expect(items.every((i) => i.status === "unresolved" && i.ilvl === null)).toBe(true);
    expect(unknown.items).toEqual([]);
  });

  test("an Import read before the build's item data arrived is re-read once it has", async () => {
    const { launches } = start(["success"], { meta: false });
    const imp = await h.importText(importItemsAddonString());
    expect((await itemsOf(imp.id)).pass.status).toBe("skipped");
    installFixtureMeta(h.dataDir);
    const view = await itemsOf(imp.id);
    expect(view.pass.status).toBe("ok");
    expect(view.items.some((i) => i.selectable)).toBe(true);
    expect(launches()).toBe(1);
  });

  test("a failed pass is retried on the next read instead of cached for the build", async () => {
    const { launches } = start(["init-error", "init-error", "success"]);
    const imp = await h.importText(importItemsAddonString());
    const before = launches();
    expect((await itemsOf(imp.id)).pass.status).toBe("ok");
    expect(launches()).toBeGreaterThan(before);
  });

  test("without a SimC Build the Import succeeds and shows its items", async () => {
    reports = mkdtempSync(join(tmpdir(), "simbot-reports-"));
    h = makeHarness({ withBuild: false });
    const imp = await h.importText(importItemsAddonString());
    const { pass, simcTag, items } = await itemsOf(imp.id);
    expect(pass.status).toBe("skipped");
    expect(simcTag).toBeNull();
    expect(items).toHaveLength(54);
  });

  test("a new Current SimC Build re-reads the Import against its own item data", async () => {
    const { launches } = start(["success"]);
    const imp = await h.importText(importItemsAddonString());
    expect(launches()).toBe(1);
    installFakeBuild(h.dataDir, h.app, "1210-2026-09-30-aaaaaaa");
    installFixtureMeta(h.dataDir, "1210-2026-09-30-aaaaaaa");
    const view = await itemsOf(imp.id);
    expect(view.simcTag).toBe("1210-2026-09-30-aaaaaaa");
    expect(launches()).toBe(2);
  });

  test("an unknown Import is 404", async () => {
    start(["success"]);
    expect((await h.call("GET", "/api/imports/999/items")).status).toBe(404);
    expect((await h.call("GET", "/api/imports/abc/items")).status).toBe(404);
  });

  test("ilvl matches the item level the game shows (Wowhead) for every item SimC read", async () => {
    start(["success"]);
    const imp = await h.importText(importItemsAddonString());
    const { items } = await itemsOf(imp.id);
    const shown = JSON.parse(readFileSync(join(IMPORT_ITEMS, "wowhead-ilvl.json"), "utf8")) as {
      items: { itemId: number; bonusIds: string; ilvl: number }[];
    };
    const read = items.filter((i) => i.status === "ok");
    expect(read).toHaveLength(shown.items.length);
    for (const item of read) {
      const expected = shown.items.find(
        (s) => s.itemId === item.itemId && s.bonusIds === item.bonusIds.join("/"),
      );
      expect(expected, `${item.itemId} ${item.bonusIds.join("/")}`).toBeDefined();
      expect(item.ilvl).toBe(expected?.ilvl as number);
    }
  });

  test("equipped item names agree with the names the addon wrote", async () => {
    start(["success"]);
    const imp = await h.importText(importItemsAddonString());
    const { items } = await itemsOf(imp.id);
    for (const item of items.filter((i) => i.source === "equipped")) {
      const token = item.rawLine.slice(item.rawLine.indexOf("=") + 1).split(",")[0] ?? "";
      const tokenized = (item.name ?? "")
        .toLowerCase()
        .replaceAll(" ", "_")
        .replace(/[^a-z0-9_]/g, "");
      expect(tokenized).toBe(token);
    }
  });
});
