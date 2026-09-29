import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchCommand, readBuildInfo } from "./index";

const recorded = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../apps/server/src/simc/fixtures/json2.json"), "utf8"),
);

test("launchCommand runs simc through the bundled musl loader and library path", () => {
  expect(launchCommand("/d/simc/t", ["iterations=1"])).toEqual([
    "/d/simc/t/lib/ld-musl-x86_64.so.1",
    "--library-path",
    "/d/simc/t/lib:/d/simc/t/usr/lib",
    "/d/simc/t/simc",
    "iterations=1",
  ]);
});

test("readBuildInfo reads version, commit, branch and game data version from json2", () => {
  expect(readBuildInfo(recorded)).toEqual({
    simcVersion: "1210-01",
    gitRevision: "d08a1c3",
    gitBranch: "midnight",
    gameDataVersion: "12.1.0.69933",
  });
});

test("readBuildInfo follows dbc.version_used", () => {
  const ptr = structuredClone(recorded);
  ptr.sim.options.dbc.version_used = "PTR";
  expect(readBuildInfo(ptr).gameDataVersion).toBe("12.1.5.69952");
});

test("readBuildInfo rejects a changed format", () => {
  const { git_branch: _, ...missing } = recorded;
  expect(() => readBuildInfo(missing)).toThrow("SimC output format changed");
  const noGame = structuredClone(recorded);
  noGame.sim.options.dbc.version_used = "Nope";
  expect(() => readBuildInfo(noGame)).toThrow("SimC output format changed");
  expect(() => readBuildInfo(null)).toThrow("SimC output format changed");
});
