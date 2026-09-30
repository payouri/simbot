import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveInside } from "../src/http";
import { type Harness, makeHarness } from "./harness";

let h: Harness;
afterEach(() => h?.close());

describe("sim sub-routes", () => {
  test("DELETE on a read-only action does not delete the Sim", async () => {
    h = makeHarness();
    const sim = await h.createSim((await h.importText()).id);
    for (const action of ["results", "ladder", "files", "files/x.simc"]) {
      const res = await h.call("DELETE", `/api/sims/${sim.id}/${action}`);
      expect(res.status).toBe(405);
    }
    expect((await h.call("GET", `/api/sims/${sim.id}`)).status).toBe(200);
  });

  test("files: bare /files is 404, bad id is sim_not_found, files are served", async () => {
    h = makeHarness();
    const sim = await h.createSim((await h.importText()).id);
    expect((await h.call("GET", `/api/sims/${sim.id}/files`)).status).toBe(404);
    const bad = await h.call("GET", "/api/sims/abc/files/x");
    expect(bad.status).toBe(404);
    expect(((await bad.json()) as { error: string }).error).toBe("sim_not_found");
    mkdirSync(join(h.dataDir, "sims", String(sim.id)), { recursive: true });
    writeFileSync(join(h.dataDir, "sims", String(sim.id), "stage-1.simc"), "hello");
    const ok = await h.call("GET", `/api/sims/${sim.id}/files/stage-1.simc`);
    expect(await ok.text()).toBe("hello");
    expect((await h.call("GET", `/api/sims/${sim.id}/files/nope`)).status).toBe(404);
  });

  test("resolveInside refuses siblings sharing a prefix", () => {
    expect(resolveInside("/d/sims/1", "a.simc")).toBe("/d/sims/1/a.simc");
    expect(resolveInside("/d/sims/1", "../12/a.simc")).toBeNull();
    expect(resolveInside("/d/sims/1", "..")).toBeNull();
  });
});
