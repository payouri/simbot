import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ImportItem,
  importItemsResponseSchema,
  importSetupSchema,
  type Sim,
  simSchema,
} from "@simbot/shared";
import type { Launch } from "../src/runner/run-sim";
import {
  FAKE_SIMC,
  type Harness,
  IMPORT_ITEMS,
  importItemsAddonString,
  installFixtureMeta,
  makeHarness,
} from "./harness";

let h: Harness;
let reports: string;
afterEach(() => {
  h?.close();
  if (reports) rmSync(reports, { recursive: true, force: true });
});

/** A harness whose SimC replays the recorded packed item pass, with the fixture's item-meta. */
function start() {
  reports = mkdtempSync(join(tmpdir(), "simbot-reports-"));
  const launch: Launch = (_dir, args) => [
    process.execPath,
    FAKE_SIMC,
    `--scenario=${join(IMPORT_ITEMS, "success")}`,
    ...args,
  ];
  h = makeHarness({ launch });
  installFixtureMeta(h.dataDir);
}

async function draft(extra: Record<string, unknown> = {}) {
  const imp = await h.importText(importItemsAddonString());
  const res = await h.call("POST", "/api/sims", { importId: imp.id, kind: "top_gear", ...extra });
  expect(res.status).toBe(201);
  const sim = simSchema.parse(await res.json());
  const items = importItemsResponseSchema.parse(
    await (await h.call("GET", `/api/imports/${imp.id}/items`)).json(),
  ).items;
  return { imp, sim, items };
}

const patch = (id: number, body: unknown) => h.call("PATCH", `/api/sims/${id}`, body);
const pick = (items: ImportItem[], f: (i: ImportItem) => boolean) => {
  const found = items.find(f);
  if (!found) throw new Error("fixture item missing");
  return found;
};
const selectable = (items: ImportItem[]) => items.filter((i) => i.selectable);

describe("creating a Draft for the setup", () => {
  test("a Top Gear Draft from an Import starts with the equipped Talent Loadout selected", async () => {
    start();
    const { sim } = await draft();
    expect(sim.status).toBe("draft");
    expect(sim.kind).toBe("top_gear");
    expect(sim.topGearSelection).toEqual({ included: [], talentLoadouts: [0], lockedSlots: [] });
  });

  test("a Draft without a kind is a Quick Sim, and a copy of a Quick Sim opens the setup with a selection", async () => {
    start();
    const imp = await h.importText(importItemsAddonString());
    const sim = await h.createSim(imp.id);
    expect(sim.kind).toBe("quick");
    const copy = simSchema.parse(
      await (await h.call("POST", "/api/sims", { copyFromSimId: sim.id })).json(),
    );
    expect(copy.kind).toBe("quick");
    expect(copy.topGearSelection).toEqual({ included: [], talentLoadouts: [0], lockedSlots: [] });
  });

  test("exactly one of importId and copyFromSimId", async () => {
    start();
    const { imp, sim } = await draft();
    expect((await h.call("POST", "/api/sims", {})).status).toBe(400);
    const both = await h.call("POST", "/api/sims", { importId: imp.id, copyFromSimId: sim.id });
    expect(both.status).toBe(400);
    expect((await h.call("POST", "/api/sims", { importId: 999 })).status).toBe(404);
    expect((await h.call("POST", "/api/sims", { copyFromSimId: 999 })).status).toBe(404);
  });

  test("a copy keeps the source's Import, settings and Top Gear Selection", async () => {
    start();
    const { sim, items } = await draft();
    const [a, b] = selectable(items);
    if (!a || !b) throw new Error("fixture needs two candidates");
    const selection = { included: [b.index, a.index], talentLoadouts: [0], lockedSlots: ["head"] };
    await patch(sim.id, { topGearSelection: selection, settings: { durationSeconds: 120 } });
    const res = await h.call("POST", "/api/sims", { copyFromSimId: sim.id });
    expect(res.status).toBe(201);
    const copy = simSchema.parse(await res.json());
    expect(copy.id).not.toBe(sim.id);
    expect(copy.status).toBe("draft");
    expect(copy.kind).toBe("top_gear");
    expect(copy.importId).toBe(sim.importId);
    expect(copy.character).toEqual(sim.character);
    expect(copy.settings.durationSeconds).toBe(120);
    expect(copy.topGearSelection).toEqual({
      included: [a.index, b.index].sort((x, y) => x - y),
      talentLoadouts: [0],
      lockedSlots: ["head"],
    });
    const viaSettings = await h.call("POST", "/api/sims", {
      copyFromSimId: sim.id,
      settings: { targets: 3 },
    });
    expect(simSchema.parse(await viaSettings.json()).settings).toMatchObject({
      targets: 3,
      durationSeconds: 120,
    });
  });

  test("copy-to-draft keeps the Top Gear Selection too", async () => {
    start();
    const { sim, items } = await draft();
    const pickOne = selectable(items)[0] as ImportItem;
    await patch(sim.id, {
      topGearSelection: { included: [pickOne.index], talentLoadouts: [0], lockedSlots: [] },
    });
    const copy = simSchema.parse(
      await (await h.call("POST", `/api/sims/${sim.id}/copy-to-draft`)).json(),
    );
    expect(copy.topGearSelection?.included).toEqual([pickOne.index]);
  });
});

describe("PATCH /api/sims/:id on a Draft", () => {
  test("saves the Top Gear Selection and Sim Settings, and a later read restores them exactly", async () => {
    start();
    const { sim, items } = await draft();
    const vault = pick(items, (i) => i.selectable && i.source === "great_vault");
    const bag = pick(items, (i) => i.selectable && i.source === "bags");
    const res = await patch(sim.id, {
      topGearSelection: {
        included: [vault.index, bag.index, bag.index],
        talentLoadouts: [0],
        lockedSlots: ["trinket", "head", "trinket"],
      },
      settings: { fightStyle: "HecticAddCleave", targets: 4, rawOptions: "override.bloodlust=0" },
    });
    expect(res.status).toBe(200);
    const saved = simSchema.parse(await res.json());
    const expected = [vault.index, bag.index].sort((x, y) => x - y);
    expect(saved.topGearSelection).toEqual({
      included: expected,
      talentLoadouts: [0],
      lockedSlots: ["head", "trinket"],
    });
    const reread = await h.sim(sim.id);
    expect(reread).toEqual(saved);
    expect(reread.settings).toMatchObject({
      fightStyle: "HecticAddCleave",
      targets: 4,
      rawOptions: "override.bloodlust=0",
      durationSeconds: 300,
    });
  });

  test("settings alone leave the selection alone, and the selection alone leaves settings alone", async () => {
    start();
    const { sim, items } = await draft();
    const one = selectable(items)[0] as ImportItem;
    await patch(sim.id, {
      topGearSelection: { included: [one.index], talentLoadouts: [0], lockedSlots: [] },
    });
    const afterSettings = simSchema.parse(
      await (await patch(sim.id, { settings: { precision: "high" } })).json(),
    );
    expect(afterSettings.topGearSelection?.included).toEqual([one.index]);
    const afterSelection = simSchema.parse(
      await (
        await patch(sim.id, {
          topGearSelection: { included: [], talentLoadouts: [0], lockedSlots: [] },
        })
      ).json(),
    );
    expect(afterSelection.settings.precision).toBe("high");
  });

  test("refuses an Unknown Item, an equipped item and a made-up index, applying nothing", async () => {
    start();
    const { sim, items } = await draft();
    const unknown = pick(items, (i) => i.status === "unknown" && i.source !== "equipped");
    expect(unknown.selectable).toBe(false);
    const equipped = pick(items, (i) => i.source === "equipped");
    const ok = selectable(items)[0] as ImportItem;
    const res = await patch(sim.id, {
      settings: { targets: 9 },
      topGearSelection: {
        included: [ok.index, unknown.index, equipped.index, 99999],
        talentLoadouts: [0],
        lockedSlots: [],
      },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: { path: string }[] };
    expect(body.error).toBe("invalid_selection");
    expect(body.issues.map((i) => i.path)).toEqual([
      "topGearSelection.included.1",
      "topGearSelection.included.2",
      "topGearSelection.included.3",
    ]);
    const after = await h.sim(sim.id);
    expect(after.settings.targets).toBe(1);
    expect(after.topGearSelection?.included).toEqual([]);
  });

  test("refuses a Talent Loadout the Import does not have", async () => {
    start();
    const { sim } = await draft();
    const res = await patch(sim.id, {
      topGearSelection: { included: [], talentLoadouts: [5], lockedSlots: [] },
    });
    expect(res.status).toBe(422);
  });

  test("rejects malformed bodies", async () => {
    start();
    const { sim } = await draft();
    expect((await patch(sim.id, {})).status).toBe(400);
    expect((await patch(sim.id, { settings: { durationSeconds: 5 } })).status).toBe(400);
    expect(
      (
        await patch(sim.id, {
          topGearSelection: { included: [], talentLoadouts: [], lockedSlots: ["ankles"] },
        })
      ).status,
    ).toBe(400);
    expect((await patch(999, { settings: { targets: 2 } })).status).toBe(404);
  });
});

describe("PATCH /api/sims/:id outside Draft", () => {
  test("is rejected for the input, and the Sim stays as it was", async () => {
    start();
    const { sim } = await draft();
    const queued: Sim = await h.queue(sim.id);
    expect(queued.status).not.toBe("draft");
    await h.app.idle();
    const before = await h.sim(sim.id);
    expect(before.status).not.toBe("draft");

    const settings = await patch(sim.id, { settings: { targets: 5 } });
    expect(settings.status).toBe(409);
    expect(((await settings.json()) as { error: string }).error).toBe("not_a_draft");
    const selection = await patch(sim.id, {
      topGearSelection: { included: [], talentLoadouts: [0], lockedSlots: ["head"] },
    });
    expect(selection.status).toBe(409);
    expect(await h.sim(sim.id)).toEqual(before);
  });

  test("still moves the Sim to another Character", async () => {
    start();
    const { sim } = await draft();
    await h.queue(sim.id);
    await h.app.idle();
    const res = await patch(sim.id, { characterId: sim.characterId });
    expect(res.status).toBe(200);
  });

  test("a mixed request is refused whole", async () => {
    start();
    const { sim } = await draft();
    await h.queue(sim.id);
    await h.app.idle();
    const res = await patch(sim.id, { characterId: 999, settings: { targets: 2 } });
    expect(res.status).toBe(409);
  });
});

describe("GET /api/imports/:id/parsed", () => {
  test("names each Talent Loadout, which one is equipped, and the consumables", async () => {
    start();
    const text = `${importItemsAddonString()}\nflask=flask_of_tempered_aggression_3\nfood=disabled\npotion=tempered_potion_3\n`;
    const imp = await h.importText(text);
    const res = await h.call("GET", `/api/imports/${imp.id}/parsed`);
    const setup = importSetupSchema.parse(await res.json());
    expect(setup.talentLoadouts).toHaveLength(1);
    expect(setup.talentLoadouts[0]).toMatchObject({ comment: "Raid", equipped: true });
    expect(setup.consumables).toEqual({
      flask: "flask_of_tempered_aggression_3",
      potion: "tempered_potion_3",
    });
  });
});
