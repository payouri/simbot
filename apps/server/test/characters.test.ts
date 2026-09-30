import { afterEach, describe, expect, test } from "bun:test";
import {
  characterConflictSchema,
  characterListResponseSchema,
  characterSchema,
} from "@simbot/shared";
import { addonString, type Harness, makeHarness } from "./harness";

let h: Harness;
afterEach(() => h?.close());

const other = () => addonString().replace('"Rootbeer"', '"Other"');

const list = async () =>
  characterListResponseSchema.parse(await (await h.call("GET", "/api/characters")).json());

describe("GET /api/characters", () => {
  test("lists Characters created by Import with their Import and Sim counts", async () => {
    h = makeHarness({ withBuild: false });
    const imp = await h.importText();
    await h.importText(`${addonString()}# later\n`);
    await h.createSim(imp.id);
    expect(await list()).toEqual([
      {
        ...imp.character,
        importCount: 2,
        simCount: 1,
      },
    ]);
  });
});

describe("PATCH /api/characters/:id", () => {
  test("edits region, realm, name and class", async () => {
    h = makeHarness({ withBuild: false });
    const imp = await h.importText();
    const res = await h.call("PATCH", `/api/characters/${imp.characterId}`, {
      region: "US",
      realm: "Area-52",
      name: "Renamed",
      class: "mage",
    });
    expect(res.status).toBe(200);
    expect(characterSchema.parse(await res.json())).toEqual({
      id: imp.characterId,
      region: "us",
      realm: "area-52",
      name: "Renamed",
      class: "mage",
    });
    expect((await h.importText()).characterId).not.toBe(imp.characterId);
  });

  test("rejects an empty edit and unknown Characters", async () => {
    h = makeHarness({ withBuild: false });
    const imp = await h.importText();
    expect((await h.call("PATCH", `/api/characters/${imp.characterId}`, {})).status).toBe(400);
    expect((await h.call("PATCH", "/api/characters/999", { name: "x" })).status).toBe(404);
  });

  test("an edit onto another Character is a conflict naming it, and changes nothing", async () => {
    h = makeHarness({ withBuild: false });
    const a = await h.importText();
    const b = await h.importText(other());
    const res = await h.call("PATCH", `/api/characters/${b.characterId}`, { name: "Rootbeer" });
    expect(res.status).toBe(409);
    const conflict = characterConflictSchema.parse(await res.json());
    expect(conflict.conflictingCharacter.id).toBe(a.characterId);
    expect((await list()).map((c) => c.name).sort()).toEqual(["Other", "Rootbeer"]);
  });

  test("Sims keep their Character Snapshot through an edit; new Sims use the edited identity", async () => {
    h = makeHarness({ withBuild: false });
    const imp = await h.importText();
    const before = await h.createSim(imp.id);
    await h.call("PATCH", `/api/characters/${imp.characterId}`, { name: "Renamed" });
    expect((await h.sim(before.id)).character).toEqual(before.character);
    expect((await h.sim(before.id)).character.name).toBe("Rootbeer");
    expect((await h.createSim(imp.id)).character.name).toBe("Renamed");
  });
});

describe("POST /api/characters/:id/merge", () => {
  test("moves Imports and Sims, deletes the merged Character, keeps snapshots", async () => {
    h = makeHarness({ withBuild: false });
    const a = await h.importText();
    const b = await h.importText(other());
    const simB = await h.createSim(b.id);
    const res = await h.call("POST", `/api/characters/${b.characterId}/merge`, {
      targetId: a.characterId,
    });
    expect(res.status).toBe(200);
    expect(characterSchema.parse(await res.json()).id).toBe(a.characterId);
    const merged = await h.sim(simB.id);
    expect(merged.characterId).toBe(a.characterId);
    expect(merged.character).toEqual(simB.character);
    expect(merged.character.name).toBe("Other");
    expect(await list()).toEqual([{ ...a.character, importCount: 2, simCount: 1 }]);
    expect(h.app.db.query("SELECT character_id FROM imports WHERE id = ?").get(b.id)).toEqual({
      character_id: a.characterId,
    });
  });

  test("an Import both Characters hold is folded into the target's, with its Sims", async () => {
    h = makeHarness({ withBuild: false });
    const a = await h.importText();
    const b = await h.importText(other());
    // Make B's identity collide with A's Import text by giving B the same checksum.
    h.app.db.run(
      "UPDATE imports SET checksum = (SELECT checksum FROM imports WHERE id = ?) WHERE id = ?",
      [a.id, b.id],
    );
    const simB = await h.createSim(b.id);
    const res = await h.call("POST", `/api/characters/${b.characterId}/merge`, {
      targetId: a.characterId,
    });
    expect(res.status).toBe(200);
    expect((await h.sim(simB.id)).importId).toBe(a.id);
    expect((await list())[0]?.importCount).toBe(1);
  });

  test("rejects self-merge and unknown Characters", async () => {
    h = makeHarness({ withBuild: false });
    const a = await h.importText();
    const self = await h.call("POST", `/api/characters/${a.characterId}/merge`, {
      targetId: a.characterId,
    });
    expect(self.status).toBe(400);
    const missing = await h.call("POST", `/api/characters/${a.characterId}/merge`, {
      targetId: 999,
    });
    expect(missing.status).toBe(404);
    expect(await list()).toHaveLength(1);
  });
});

describe("PATCH /api/sims/:id", () => {
  test("moves a Sim to another Character without touching its snapshot", async () => {
    h = makeHarness({ withBuild: false });
    const a = await h.importText();
    const b = await h.importText(other());
    const sim = await h.createSim(a.id);
    const res = await h.call("PATCH", `/api/sims/${sim.id}`, { characterId: b.characterId });
    expect(res.status).toBe(200);
    const moved = await h.sim(sim.id);
    expect(moved.characterId).toBe(b.characterId);
    expect(moved.character).toEqual(sim.character);
    expect((await h.call("PATCH", `/api/sims/${sim.id}`, { characterId: 999 })).status).toBe(404);
  });
});
