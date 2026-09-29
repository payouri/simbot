/**
 * The Quick Sim flow against a real SimC Build. Opt-in and outside the gate: run it with
 * `bun run test:simc` when fixtures are recorded or SimC's output format is in doubt. Uses the
 * Current SimC Build in `SIMBOT_DATA_DIR` (default `./data`), fetching the latest nightly there
 * first if there is none.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { type Harness, makeHarness } from "./harness";

const enabled = process.env.SIMBOT_TEST_SIMC === "1";
let h: Harness;

describe.skipIf(!enabled)("Quick Sim against a real SimC Build", () => {
  beforeAll(async () => {
    const real = createApp({ dataDir: loadConfig().dataDir, clientDir: "" });
    await real.boot();
    const status = (await (await real.fetch(new Request("http://x/api/simc"))).json()) as {
      current: { tag: string } | null;
    };
    real.close();
    if (!status.current) throw new Error("no SimC Build available; is the network up?");
    h = makeHarness({ withBuild: false });
    symlinkSync(join(loadConfig().dataDir, "simc"), join(h.dataDir, "simc"));
    h.app.db.run("INSERT INTO settings (key, value) VALUES ('simc.current_tag', ?)", [
      status.current.tag,
    ]);
  }, 300_000);

  afterAll(() => h?.close());

  test("a recorded Addon String simulates to a DPS with a small mean error", async () => {
    const sim = await h.runQuickSim({ precision: "low" });
    expect(sim.error).toBeNull();
    expect(sim.status).toBe("succeeded");
    const [result] = (await h.results(sim.id)).results;
    expect(result?.dps.mean).toBeGreaterThan(10_000);
    expect(result?.dps.meanError).toBeGreaterThan(0);
    expect((result?.dps.meanError ?? 1) / (result?.dps.mean ?? 1)).toBeLessThan(0.01);
    expect(h.readGz(h.simFile(sim.id, "stage-1.json.gz"))).toContain('"report_version"');
  }, 120_000);

  test("a SimC setup error fails the Sim with its exit code and stderr", async () => {
    const sim = await h.runQuickSim({ rawOptions: "fight_style=NoSuchStyle" });
    expect(sim.status).toBe("failed");
    expect(sim.error?.kind).toBe("simc_exit");
    expect(sim.error?.exitCode).not.toBe(0);
    expect(sim.error?.stderr).toContain("NoSuchStyle");
  }, 120_000);
});
