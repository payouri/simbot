import { describe, expect, test } from "bun:test";
import { buildCheckSimInput, CHECK_SIM_PROFILESET, readCheckSimResult } from "./check-sim";

const report = (dps: Record<string, number>) =>
  JSON.stringify({
    sim: {
      options: { confidence_estimator: 1.96 },
      players: [{ collected_data: { dps: { mean: 100000, mean_std_dev: 500, ...dps } } }],
      profilesets: { results: [{ name: CHECK_SIM_PROFILESET, mean: 100100 }] },
    },
  });

describe("readCheckSimResult", () => {
  test("derives the iteration count from std_dev and mean_std_dev", () => {
    const r = readCheckSimResult(report({ std_dev: 15811 }));
    expect(r.iterations).toBe(Math.round((15811 / 500) ** 2));
    expect(r.dps.meanError).toBeCloseTo(980, 5);
  });

  test("has no iteration count when the report has no std_dev", () => {
    expect(readCheckSimResult(report({})).iterations).toBeNull();
  });
});

describe("buildCheckSimInput", () => {
  const profile =
    'mage="X"\nlevel=80\nsave=/data/simbot.sqlite\nhtml=/app/client/index.html\noutput=/tmp/o\ninput=/etc/passwd\nptr=1\n';

  test.each(["live", "ptr"] as const)("drops file, network and ptr options on the %s pass", (g) => {
    const input = buildCheckSimInput(profile, g);
    expect(input).toContain('mage="X"\nlevel=80\n');
    expect(input).not.toMatch(/^(save|html|output|input)=/m);
    expect(input.match(/^ptr=1$/gm) ?? []).toHaveLength(g === "ptr" ? 1 : 0);
  });

  test("contains Check Sim options and profileset override", () => {
    const input = buildCheckSimInput("mage=Test\nregion=us\nserver=Area 52", "live");
    expect(input).toContain("# simbot Check Sim");
    expect(input).toContain("fight_style=Patchwerk");
    expect(input).toContain("target_error=1");
    expect(input).toContain(`profileset."${CHECK_SIM_PROFILESET}"+=gear_haste_rating=1`);
  });
});
