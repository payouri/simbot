import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSimSettings } from "@simbot/shared";
import {
  AddonStringError,
  buildInput,
  classifyExit,
  Json2FormatError,
  launchCommand,
  parseProfileHeader,
  readBuildInfo,
  readQuickSimResult,
  stageArgs,
} from "./index";
import { quickSimJson2Schema, readJson2 } from "./json2";

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

describe("Addon String header", () => {
  const addon = readFileSync(
    join(import.meta.dir, "../../../apps/server/test/fixtures/quick-sim/addon-string.txt"),
    "utf8",
  );

  test("reads the Character identity and snapshot traits, ignoring comment lines", () => {
    expect(parseProfileHeader(addon)).toEqual({
      region: "eu",
      realm: "draenor",
      name: "Rootbeer",
      class: "deathknight",
      spec: "frost",
      race: "pandaren",
      level: 90,
    });
  });

  test("a commented-out character line does not count", () => {
    expect(() => parseProfileHeader('# mage="Nope"\nregion=eu\nserver=x')).toThrow(
      AddonStringError,
    );
  });

  test("requires a region and a server", () => {
    expect(() => parseProfileHeader('mage="A"\nserver=x')).toThrow("region");
    expect(() => parseProfileHeader('mage="A"\nregion=eu')).toThrow("server");
  });
});

describe("Quick Sim input and result", () => {
  const settings = {
    ...defaultSimSettings,
    precision: "low",
    rawOptions: "iterations=10",
  } as const;

  test("buildInput keeps the Addon String verbatim, then adds settings and raw options", () => {
    const text = 'mage="A"\r\nregion=eu\r\nserver=x';
    const input = buildInput(text, settings);
    expect(input.startsWith(`${text}\n`)).toBe(true);
    expect(input).toContain("target_error=0.5");
    expect(input.trimEnd().endsWith("iterations=10")).toBe(true);
  });

  test("stageArgs puts output options after the input file", () => {
    expect(stageArgs("/t/in.simc", "/t/out.json")).toEqual([
      "/t/in.simc",
      "progressbar_type=1",
      "output=/dev/null",
      "json2=/t/out.json",
    ]);
  });

  const report = (mean_std_dev: number, confidence_estimator: number) =>
    JSON.stringify({
      sim: {
        options: { confidence_estimator },
        players: [{ collected_data: { dps: { mean: 1000, mean_std_dev } } }],
      },
    });

  test("mean error is mean_std_dev × confidence_estimator", () => {
    expect(readQuickSimResult(report(10, 1.96)).dps).toEqual({ mean: 1000, meanError: 19.6 });
  });

  test("anything unexpected is an output format change", () => {
    for (const bad of [null, "nope", "{}", report(10, 0), '{"sim":{"players":[]}}']) {
      expect(() => readQuickSimResult(bad)).toThrow(Json2FormatError);
    }
  });

  test("readJson2 rejects a missing, non-JSON or misshapen report with Json2FormatError", () => {
    for (const bad of [null, "nope", "{}"]) {
      expect(() => readJson2(bad, quickSimJson2Schema)).toThrow(Json2FormatError);
    }
    expect(() => readJson2(report(10, 0), quickSimJson2Schema)).toThrow(/confidence_estimator/);
  });

  test("classifyExit keeps the code and prefers the Error: line", () => {
    const err = classifyExit(70, "warn\nError: Setup failure: bad\nexit\n");
    expect(err).toMatchObject({ kind: "simc_exit", exitCode: 70 });
    expect(err.message).toBe("SimC exited with code 70: Error: Setup failure: bad");
    expect(classifyExit(null, "").message).toBe("SimC was killed");
  });
});
