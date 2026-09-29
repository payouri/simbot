import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  apiErrorSchema,
  defaultSimSettings,
  importSchema,
  type SimSettings,
  simSchema,
} from "@simbot/shared";
import {
  addonString,
  BUILD_TAG,
  derivedScenario,
  FIXTURES,
  fakeLaunch,
  type Harness,
  installFakeBuild,
  makeHarness,
} from "./harness";

let h: Harness;
let scenario = join(FIXTURES, "success");
let report: string | undefined;
const launch = fakeLaunch(
  () => scenario,
  () => report,
);

const start = (opts: Parameters<typeof makeHarness>[0] = {}) => {
  scenario = join(FIXTURES, "success");
  report = undefined;
  h = makeHarness({ launch, ...opts });
  return h;
};

afterEach(() => h?.close());

describe("POST /api/imports", () => {
  test("stores the raw text and matches the Character from the profile header", async () => {
    start();
    const res = await h.call("POST", "/api/imports", { text: addonString() });
    expect(res.status).toBe(201);
    const imp = importSchema.parse(await res.json());
    expect(imp.character).toMatchObject({
      region: "eu",
      realm: "draenor",
      name: "Rootbeer",
      class: "deathknight",
    });
    expect(imp.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(h.app.db.query("SELECT raw_text FROM imports WHERE id = ?").get(imp.id)).toEqual({
      raw_text: addonString(),
    });
  });

  test("the same text for the same Character reuses the Import", async () => {
    start();
    const first = await h.importText();
    const res = await h.call("POST", "/api/imports", { text: addonString() });
    expect(res.status).toBe(200);
    expect(importSchema.parse(await res.json()).id).toBe(first.id);
  });

  test("another paste for the same Character is a new Import on the same Character", async () => {
    start();
    const first = await h.importText();
    const second = await h.importText(`${addonString()}# a later export\n`);
    expect(second.id).not.toBe(first.id);
    expect(second.characterId).toBe(first.characterId);
  });

  test("a different name is a different Character", async () => {
    start();
    const first = await h.importText();
    const other = await h.importText(addonString().replace('"Rootbeer"', '"Other"'));
    expect(other.characterId).not.toBe(first.characterId);
  });

  test("text that is not an Addon String is a 422; a malformed body is a 400", async () => {
    start();
    const bad = await h.call("POST", "/api/imports", { text: "hello world" });
    expect(bad.status).toBe(422);
    expect(apiErrorSchema.parse(await bad.json()).error).toBe("invalid_addon_string");
    expect((await h.call("POST", "/api/imports", { text: "" })).status).toBe(400);
    expect((await h.call("POST", "/api/imports", {})).status).toBe(400);
    expect((await h.call("GET", "/api/imports")).status).toBe(405);
  });
});

describe("POST /api/sims", () => {
  test("creates a Draft with default settings and a Character Snapshot", async () => {
    start();
    const imp = await h.importText();
    const res = await h.call("POST", "/api/sims", { importId: imp.id });
    expect(res.status).toBe(201);
    const sim = simSchema.parse(await res.json());
    expect(sim).toMatchObject({
      kind: "quick",
      status: "draft",
      importId: imp.id,
      characterId: imp.characterId,
      settings: defaultSimSettings,
      simcTag: null,
      error: null,
      queuedAt: null,
    });
    expect(sim.character).toEqual({
      name: "Rootbeer",
      region: "eu",
      realm: "draenor",
      class: "deathknight",
      spec: "frost",
      race: "pandaren",
      level: 90,
    });
  });

  test("presets and raw options are merged over the defaults and frozen", async () => {
    start();
    const imp = await h.importText();
    const settings: Partial<SimSettings> = {
      fightStyle: "HecticAddCleave",
      targets: 3,
      precision: "high",
      rawOptions: "vary_combat_length=0",
    };
    const sim = await h.createSim(imp.id, settings);
    expect(sim.settings).toEqual({ ...defaultSimSettings, ...settings });
    expect((await h.sim(sim.id)).settings).toEqual(sim.settings);
  });

  test("rejects unknown presets, unknown Imports and bad bodies", async () => {
    start();
    const imp = await h.importText();
    const badStyle = await h.call("POST", "/api/sims", {
      importId: imp.id,
      settings: { fightStyle: "Nope" },
    });
    expect(badStyle.status).toBe(400);
    expect(apiErrorSchema.parse(await badStyle.json()).issues?.[0]?.path).toBe(
      "settings.fightStyle",
    );
    expect((await h.call("POST", "/api/sims", { importId: 999 })).status).toBe(404);
    expect((await h.call("POST", "/api/sims", { importId: "x" })).status).toBe(400);
  });
});

describe("Quick Sim life cycle", () => {
  test("draft → queued → running → succeeded, with DPS and its mean error", async () => {
    start();
    const imp = await h.importText();
    const draft = await h.createSim(imp.id);
    expect(draft.status).toBe("draft");

    const queued = await h.queue(draft.id);
    expect(queued.status).toBe("queued");
    expect(queued.queuedAt).not.toBeNull();

    await h.app.idle();
    const done = await h.sim(draft.id);
    expect(done.status).toBe("succeeded");
    expect(done.simcTag).toBe(BUILD_TAG);
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    expect(done.error).toBeNull();

    const { results, simcTag } = await h.results(draft.id);
    expect(simcTag).toBe(BUILD_TAG);
    expect(results).toHaveLength(1);
    const [baseline] = results;
    expect(baseline).toMatchObject({ isBaseline: true, stage: 1, survived: true });
    // Recorded run: dps.mean 149864.5185..., mean_std_dev 408.8675..., confidence_estimator 1.95996...
    expect(baseline?.dps.mean).toBeCloseTo(149864.5185, 3);
    expect(baseline?.dps.meanError).toBeCloseTo(408.867548073941 * 1.9599639854088815, 6);
  });

  test("only a Draft can be queued, and unknown Sims are 404", async () => {
    start();
    const imp = await h.importText();
    const draft = await h.createSim(imp.id);
    await h.queue(draft.id);
    const again = await h.call("POST", `/api/sims/${draft.id}/queue`);
    expect(again.status).toBe(409);
    expect(apiErrorSchema.parse(await again.json()).error).toBe("invalid_transition");
    await h.app.idle();
    expect((await h.call("POST", `/api/sims/${draft.id}/queue`)).status).toBe(409);
    expect((await h.call("POST", "/api/sims/999/queue")).status).toBe(404);
    expect((await h.call("GET", "/api/sims/999")).status).toBe(404);
    expect((await h.call("GET", "/api/sims/abc")).status).toBe(404);
  });

  test("results exist only once the Sim has succeeded", async () => {
    start();
    const imp = await h.importText();
    const draft = await h.createSim(imp.id);
    const res = await h.call("GET", `/api/sims/${draft.id}/results`);
    expect(res.status).toBe(409);
    expect(apiErrorSchema.parse(await res.json()).error).toBe("results_unavailable");
    expect((await h.call("GET", "/api/sims/999/results")).status).toBe(404);
  });

  test("Sims run one at a time, first in first out", async () => {
    start();
    const imp = await h.importText();
    const [a, b, c] = await Promise.all([
      h.createSim(imp.id),
      h.createSim(imp.id),
      h.createSim(imp.id),
    ]);
    if (!a || !b || !c) throw new Error("unreachable");
    await h.queue(a.id);
    await h.queue(b.id);
    await h.queue(c.id);
    await h.app.idle();
    const [ra, rb, rc] = await Promise.all([h.sim(a.id), h.sim(b.id), h.sim(c.id)]);
    for (const sim of [ra, rb, rc]) expect(sim.status).toBe("succeeded");
    expect(ra.finishedAt && rb.startedAt && ra.finishedAt <= rb.startedAt).toBe(true);
    expect(rb.finishedAt && rc.startedAt && rb.finishedAt <= rc.startedAt).toBe(true);
  });

  test("the SimC Build is resolved when the Job starts and recorded on the Sim", async () => {
    start();
    installFakeBuild(h.dataDir, h.app, "1210-2026-09-30-aaaaaaa");
    const sim = await h.runQuickSim();
    expect(sim.simcTag).toBe("1210-2026-09-30-aaaaaaa");
  });
});

describe("what the runner feeds SimC", () => {
  test("the Addon String goes in unchanged, followed by the frozen settings", async () => {
    start();
    const sim = await h.runQuickSim({ precision: "high", targets: 2, rawOptions: "foo=bar" });
    expect(sim.status).toBe("succeeded");
    const input = readFileSync(h.simFile(sim.id, "stage-1.simc"), "utf8");
    expect(input.startsWith(addonString())).toBe(true);
    const settingsBlock = input.slice(addonString().length);
    expect(settingsBlock).toContain("fight_style=Patchwerk");
    expect(settingsBlock).toContain("max_time=300");
    expect(settingsBlock).toContain("desired_targets=2");
    expect(settingsBlock).toContain("target_error=0.1");
    expect(settingsBlock.trimEnd().endsWith("foo=bar")).toBe(true);
  });

  test("SimC runs in its own process group with quiet output and json2 in tmp/<job>/", async () => {
    start();
    report = join(h.root, "report.json");
    await h.runQuickSim();
    const seen = JSON.parse(readFileSync(report, "utf8"));
    expect(seen.pgid).toBe(seen.pid);
    const [input, ...options] = seen.args;
    expect(input).toBe(join(h.dataDir, "tmp", "1", "stage-1.simc"));
    expect(options).toEqual([
      "progressbar_type=1",
      "output=/dev/null",
      `json2=${join(h.dataDir, "tmp", "1", "stage-1.json")}`,
    ]);
    expect(seen.cwd).toBe(join(h.dataDir, "tmp", "1"));
    expect(h.app.db.query("SELECT pid FROM jobs WHERE id = 1").get()).toEqual({ pid: seen.pid });
  });

  test("keeps stage-1.simc and stage-1.json.gz, and leaves tmp/<job>/ empty", async () => {
    start();
    const sim = await h.runQuickSim();
    expect(readdirSync(join(h.dataDir, "sims", String(sim.id))).sort()).toEqual([
      "stage-1.json.gz",
      "stage-1.simc",
    ]);
    const json2 = JSON.parse(h.readGz(h.simFile(sim.id, "stage-1.json.gz")));
    expect(json2.sim.players[0].name).toBe("Rootbeer");
    expect(existsSync(join(h.dataDir, "tmp", "1"))).toBe(false);
  });
});

describe("failures", () => {
  const failed = async () => {
    const sim = await h.runQuickSim();
    expect(sim.status).toBe("failed");
    expect((await h.call("GET", `/api/sims/${sim.id}/results`)).status).toBe(409);
    expect(existsSync(join(h.dataDir, "tmp", "1"))).toBe(false);
    return sim;
  };

  test("a SimC exit code and stderr are classified and kept", async () => {
    start();
    scenario = join(FIXTURES, "setup-failure");
    const sim = await failed();
    expect(sim.error).toMatchObject({ kind: "simc_exit", exitCode: 70 });
    expect(sim.error?.message).toContain("SimC exited with code 70");
    expect(sim.error?.message).toContain("Invalid fight style");
    expect(sim.error?.stderr).toContain("Setup failure");
    expect(sim.simcTag).toBe(BUILD_TAG);
    expect(existsSync(join(h.dataDir, "sims", String(sim.id)))).toBe(false);
  });

  test("exit 0 without a json2 report is an output format change", async () => {
    start();
    scenario = derivedScenario(h.root, "success", (f) => {
      f["json2.json.gz"] = null;
    });
    const sim = await failed();
    expect(sim.error?.kind).toBe("output_format_changed");
    expect(sim.error?.message).toStartWith("SimC output format changed");
  });

  test("a json2 that does not parse is an output format change", async () => {
    start();
    scenario = derivedScenario(h.root, "success", (f) => {
      f["json2.json.gz"] = gzipSync("{ not json");
    });
    expect((await failed()).error?.kind).toBe("output_format_changed");
  });

  test("a json2 missing the fields we read is an output format change", async () => {
    start();
    scenario = derivedScenario(h.root, "success", (f) => {
      const report = JSON.parse(gunzipSync(f["json2.json.gz"] as Buffer).toString());
      delete report.sim.players[0].collected_data.dps.mean_std_dev;
      f["json2.json.gz"] = gzipSync(JSON.stringify(report));
    });
    const sim = await failed();
    expect(sim.error?.kind).toBe("output_format_changed");
    expect(sim.error?.message).toContain("mean_std_dev");
  });

  test("no installed SimC Build fails the Sim instead of hanging the Queue", async () => {
    start({ withBuild: false });
    const sim = await failed();
    expect(sim.error?.kind).toBe("no_simc_build");
    expect(sim.simcTag).toBeNull();
    // The Queue moves on: the next Sim runs once a Build exists.
    installFakeBuild(h.dataDir, h.app, BUILD_TAG);
    expect((await h.runQuickSim()).status).toBe("succeeded");
  });

  test("a SimC that cannot be launched fails the Sim", async () => {
    start({ launch: () => ["/nonexistent/simc-loader"] });
    const sim = await failed();
    expect(sim.error?.kind).toBe("launch_failed");
  });
});

describe("boot", () => {
  test("a Job left running by a dead process fails its Sim instead of blocking the Queue", async () => {
    start();
    const imp = await h.importText();
    const draft = await h.createSim(imp.id);
    await h.queue(draft.id);
    await h.app.idle();
    // Simulate a crash: the finished Sim's Job and Sim are put back as running.
    h.app.db.run("UPDATE sims SET status = 'running', error = NULL WHERE id = ?", [draft.id]);
    h.app.db.run("UPDATE jobs SET status = 'running' WHERE sim_id = ?", [draft.id]);
    const { dataDir, root } = h;
    h.app.close();
    const { createApp } = await import("../src/app");
    const app = createApp({ dataDir, clientDir: join(root, "client") }, { launch, log: () => {} });
    try {
      const res = await app.fetch(new Request(`http://simbot.test/api/sims/${draft.id}`));
      const sim = simSchema.parse(await res.json());
      expect(sim.status).toBe("failed");
      expect(sim.error?.kind).toBe("interrupted");
    } finally {
      app.close();
    }
  });
});
