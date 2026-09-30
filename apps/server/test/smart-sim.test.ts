import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AppEvent,
  importItemsResponseSchema,
  rankResults,
  type Sim,
  simLadderResponseSchema,
  simSchema,
} from "@simbot/shared";
import { createApp } from "../src/app";
import type { Launch } from "../src/runner/run-sim";
import {
  FAKE_SIMC,
  type FakeStageCall,
  type FakeStageReply,
  type Harness,
  IMPORT_ITEMS,
  importItemsAddonString,
  installFixtureMeta,
  isFakeSimc,
  makeHarness,
  smartLaunch,
} from "./harness";

let h: Harness;
let calls: FakeStageCall[] = [];
let reply: (call: FakeStageCall) => FakeStageReply = () => ({});
afterEach(() => h?.close());

/** A Stage (profilesets or `stage-<n>.simc` in the input path) is the Smart Sim fake's; the item pass replays its recording. */
const dispatcher = (root: () => string): Launch => {
  const stage = smartLaunch(root, (c) => reply(c), calls);
  return (dir, args) =>
    /stage-\d+\.simc$/.test(args[0] as string)
      ? stage(dir, args)
      : [process.execPath, FAKE_SIMC, `--scenario=${join(IMPORT_ITEMS, "success")}`, ...args];
};

function start(next: (call: FakeStageCall) => FakeStageReply = () => ({})) {
  calls = [];
  reply = next;
  h = makeHarness({ launch: dispatcher(() => h.root) });
  installFixtureMeta(h.dataDir);
}

const HEADS = [175302, 137410];
const NECKS = [118848, 124391];
const SHOULDERS = [113884, 35031];
const CHESTS = [124318, 237613];

/** A Top Gear Draft over the fixture Import including these Candidate Items (by item id). */
async function topGear(ids: number[]): Promise<Sim> {
  const imp = await h.importText(importItemsAddonString());
  const res = await h.call("POST", "/api/sims", { importId: imp.id, kind: "top_gear" });
  const draft = simSchema.parse(await res.json());
  const items = importItemsResponseSchema.parse(
    await (await h.call("GET", `/api/imports/${imp.id}/items`)).json(),
  ).items;
  const included = ids.map((id) => {
    const found = items.find((i) => i.itemId === id && i.source === "bags");
    if (!found) throw new Error(`fixture item ${id} missing`);
    return found.index;
  });
  const put = await h.call("PATCH", `/api/sims/${draft.id}`, {
    topGearSelection: { included, talentLoadouts: [0], lockedSlots: [] },
  });
  expect(put.status).toBe(200);
  return draft;
}

const until = async (ok: () => boolean | Promise<boolean>, what: string, ms = 5000) => {
  const stop = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > stop) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

const rowsOf = (simId: number) =>
  h.app.db
    .query<
      { combination_id: number; is_baseline: number; stage: number; survived: number },
      [number]
    >(
      `SELECT r.combination_id, c.is_baseline, r.stage, r.survived FROM stage_results r
       JOIN combinations c ON c.id = r.combination_id WHERE c.sim_id = ? ORDER BY r.stage, r.combination_id`,
    )
    .all(simId);
const ladderOf = async (simId: number) =>
  simLadderResponseSchema.parse(await (await h.call("GET", `/api/sims/${simId}/ladder`)).json());
const stageRows = (simId: number, stage: number) => rowsOf(simId).filter((r) => r.stage === stage);

/** Ids 1..12 sit in a tight band at the top, everything else is far behind. */
const bandReply = (call: FakeStageCall): FakeStageReply => ({
  baseline: [99_999, 50],
  profilesets: Object.fromEntries(
    call.names.map((n) => [
      n,
      [Number(n) <= 12 ? 100_000 - Number(n) : 60_000, 50] as [number, number],
    ]),
  ),
});

describe("a 3-Stage Smart Sim", () => {
  test("culls the field between Stages and stores one Stage Result per Combination per Stage reached", async () => {
    start(bandReply);
    const live = await h.subscribe();
    const draft = await topGear([...HEADS, ...NECKS, ...SHOULDERS, ...CHESTS]);
    await h.queue(draft.id);
    await h.app.idle();
    const sim = await h.sim(draft.id);
    expect(sim.status).toBe("succeeded");

    // Medium precision: 1% then 0.3% then the picked 0.2%. 3^4 = 81 Combinations.
    expect(calls.map((c) => c.targetError)).toEqual([1, 0.3, 0.2]);
    expect(calls.map((c) => c.stage)).toEqual([1, 2, 3]);
    expect(calls[0]?.names).toHaveLength(80);
    // The 12 in the band (baseline included) go on; the baseline is the base actor, not a profileset.
    expect(calls[1]?.names).toHaveLength(11);
    expect(calls[2]?.names).toEqual(calls[1]?.names);
    expect(calls[1]?.input).not.toContain(`profileset."40"`);

    const counts = [1, 2, 3].map((s) => stageRows(draft.id, s).length);
    expect(counts).toEqual([81, 12, 12]);
    expect(stageRows(draft.id, 1).filter((r) => r.survived === 1)).toHaveLength(12);
    // The baseline has one Stage Result per Stage and always survives.
    const baseline = rowsOf(draft.id).filter((r) => r.is_baseline === 1);
    expect(baseline.map((r) => [r.stage, r.survived])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);

    // Every Stage's exact input and report are kept.
    for (const stage of [1, 2, 3]) {
      expect(readFileSync(h.simFile(draft.id, `stage-${stage}.simc`), "utf8")).toBe(
        calls[stage - 1]?.input as string,
      );
      expect(JSON.parse(h.readGz(h.simFile(draft.id, `stage-${stage}.json.gz`)))).toHaveProperty(
        "sim.players",
      );
    }
    expect(existsSync(join(h.dataDir, "tmp", "1"))).toBe(false);

    expect((await ladderOf(draft.id)).stages).toEqual([
      { stage: 1, targetErrorPct: 1, entered: 81, kept: 12, culled: 69, invalid: 0 },
      { stage: 2, targetErrorPct: 0.3, entered: 12, kept: 12, culled: 0, invalid: 0 },
      { stage: 3, targetErrorPct: 0.2, entered: 12, kept: 12, culled: 0, invalid: 0 },
    ]);

    await live.waitFor((e) => e.type === "sim.finished");
    live.close();
    const stages = live.events.filter(
      (e): e is Extract<AppEvent, { type: "sim.stage_started" | "sim.stage_finished" }> =>
        e.type === "sim.stage_started" || e.type === "sim.stage_finished",
    );
    expect(stages).toEqual([
      {
        type: "sim.stage_started",
        simId: draft.id,
        stage: 1,
        stages: 3,
        entered: 81,
        targetErrorPct: 1,
      },
      {
        type: "sim.stage_finished",
        simId: draft.id,
        stage: 1,
        survivors: 12,
        culled: 69,
        invalid: 0,
      },
      {
        type: "sim.stage_started",
        simId: draft.id,
        stage: 2,
        stages: 3,
        entered: 12,
        targetErrorPct: 0.3,
      },
      {
        type: "sim.stage_finished",
        simId: draft.id,
        stage: 2,
        survivors: 12,
        culled: 0,
        invalid: 0,
      },
      {
        type: "sim.stage_started",
        simId: draft.id,
        stage: 3,
        stages: 3,
        entered: 12,
        targetErrorPct: 0.2,
      },
      {
        type: "sim.stage_finished",
        simId: draft.id,
        stage: 3,
        survivors: 12,
        culled: 0,
        invalid: 0,
      },
    ]);
    // The ladder is narrated in the streaming log.
    const logs = live.events.flatMap((e) => (e.type === "sim.log" ? [e.message] : []));
    expect(logs).toContain("Stage 1 done: 12 kept, 69 culled.");
  });

  test("progress is tagged with the Stage it belongs to", async () => {
    start(bandReply);
    const live = await h.subscribe();
    const draft = await topGear([...HEADS, ...NECKS]);
    await h.queue(draft.id);
    await h.app.idle();
    live.close();
    const stagesSeen = new Set(
      live.events.flatMap((e) => (e.type === "sim.progress" ? [e.stage] : [])),
    );
    expect([...stagesSeen].sort()).toEqual([1, 2, 3]);
  });

  test("a field of 10 or fewer is never culled, however far behind the baseline it is", async () => {
    start((call) => ({
      baseline: [100_000, 10],
      profilesets: Object.fromEntries(call.names.map((n) => [n, [1_000, 10] as [number, number]])),
    }));
    const draft = await topGear([...HEADS, ...NECKS]); // 3 x 3 = 9 Combinations
    await h.queue(draft.id);
    await h.app.idle();
    expect((await h.sim(draft.id)).status).toBe("succeeded");
    expect(calls).toHaveLength(3);
    expect([1, 2, 3].map((s) => stageRows(draft.id, s).length)).toEqual([9, 9, 9]);
  });

  test("the baseline is never culled even when it trails the whole field", async () => {
    start((call) => ({
      baseline: [1_000, 10],
      profilesets: Object.fromEntries(
        call.names.map((n) => [n, [Number(n) <= 12 ? 100_000 : 2_000, 10] as [number, number]]),
      ),
    }));
    const draft = await topGear([...HEADS, ...NECKS, ...SHOULDERS, ...CHESTS]);
    await h.queue(draft.id);
    await h.app.idle();
    expect((await h.sim(draft.id)).status).toBe("succeeded");
    const baseline = rowsOf(draft.id).filter((r) => r.is_baseline === 1);
    expect(baseline.map((r) => r.stage)).toEqual([1, 2, 3]);
    expect(stageRows(draft.id, 2).length).toBeLessThan(15);
  });

  test("4 or fewer Combinations run as one Stage at the picked precision", async () => {
    start((call) => ({
      profilesets: Object.fromEntries(
        call.names.map((n) => [n, [99_000, 100] as [number, number]]),
      ),
    }));
    const draft = await topGear(HEADS); // 3 Combinations
    await h.queue(draft.id);
    await h.app.idle();
    expect((await h.sim(draft.id)).status).toBe("succeeded");
    expect(calls.map((c) => c.targetError)).toEqual([0.2]);
    expect(stageRows(draft.id, 1)).toHaveLength(3);
    expect((await ladderOf(draft.id)).stages).toHaveLength(1);
  });

  test("the profilesets override only the lines that differ, guarded", async () => {
    start();
    const draft = await topGear(HEADS);
    await h.queue(draft.id);
    await h.app.idle();
    const input = calls[0]?.input as string;
    const lines = input.split("\n").filter((l) => l.startsWith("profileset."));
    // Two profilesets: one guard line each, and a single head line for the one that swaps it.
    expect(lines.filter((l) => l.includes("set_bonus_enabled"))).toHaveLength(2);
    expect(lines.filter((l) => l.includes("+=head=")).length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.includes("+=neck="))).toBe(false);
    expect(input).toContain("iterations=50000");
  });
});

describe("an invalid profileset", () => {
  test("marks that Combination invalid and retries the Stage without it", async () => {
    start((call) =>
      call.call === 1
        ? { exit: 80, stderr: "Error: Initialization error: Profileset '3': bad weapons\n" }
        : {
            profilesets: Object.fromEntries(
              call.names.map((n) => [n, [99_000, 100] as [number, number]]),
            ),
          },
    );
    const live = await h.subscribe();
    const draft = await topGear([...HEADS, ...NECKS]);
    await h.queue(draft.id);
    await h.app.idle();
    live.close();
    expect((await h.sim(draft.id)).status).toBe("succeeded");

    expect(calls[0]?.names).toContain("3");
    expect(calls[1]?.names).not.toContain("3");
    expect(calls[1]?.stage).toBe(1);
    // It has no Stage Result in any Stage, and the ladder still counts it.
    expect(rowsOf(draft.id).some((r) => r.combination_id === 3)).toBe(false);
    expect(calls.slice(2).every((c) => !c.names.includes("3"))).toBe(true);
    expect((await ladderOf(draft.id)).stages[0]).toMatchObject({ entered: 8, invalid: 1 });
    const done = live.events.find((e) => e.type === "sim.stage_finished" && e.stage === 1);
    expect(done).toMatchObject({ invalid: 1 });
    expect(
      live.events.some(
        (e) => e.type === "sim.log" && e.level === "warn" && e.message.includes("3"),
      ),
    ).toBe(true);
  });

  test("gives up after 3 dropped Combinations and fails the Sim with SimC's error", async () => {
    start((call) => {
      const bad = call.names[0];
      return call.call <= 4
        ? { exit: 80, stderr: `Error: Initialization error: Profileset '${bad}': no\n` }
        : {};
    });
    const draft = await topGear([...HEADS, ...NECKS]);
    await h.queue(draft.id);
    await h.app.idle();
    const sim = await h.sim(draft.id);
    expect(sim.status).toBe("failed");
    expect(sim.error?.kind).toBe("simc_exit");
    expect(calls).toHaveLength(4);
    expect(rowsOf(draft.id)).toEqual([]);
  });

  test("an exit 80 that names no profileset of ours fails the Sim at once", async () => {
    start(() => ({ exit: 80, stderr: "Error: Initialization error: Player 'x': no\n" }));
    const draft = await topGear([...HEADS, ...NECKS]);
    await h.queue(draft.id);
    await h.app.idle();
    expect((await h.sim(draft.id)).status).toBe("failed");
    expect(calls).toHaveLength(1);
  });

  test("a profileset missing from a successful report is SimC output that changed", async () => {
    start((call) => ({
      profilesets: Object.fromEntries(
        call.names.slice(1).map((n) => [n, [99_000, 100] as [number, number]]),
      ),
    }));
    const draft = await topGear([...HEADS, ...NECKS]);
    await h.queue(draft.id);
    await h.app.idle();
    const sim = await h.sim(draft.id);
    expect(sim.status).toBe("failed");
    expect(sim.error?.kind).toBe("output_format_changed");
  });
});

describe("GET /api/sims/:id/results", () => {
  test("joins Stage Results with the Combinations and the Import's items", async () => {
    start(bandReply);
    const draft = await topGear([...HEADS, ...NECKS]);
    await h.queue(draft.id);
    await h.app.idle();

    const out = await h.results(draft.id);
    expect(out).toMatchObject({ simId: draft.id, status: "succeeded", stageCount: 3 });
    expect(out.simcTag).not.toBeNull();
    expect(out.combinations).toHaveLength(9);
    const baseline = out.combinations.filter((c) => c.isBaseline);
    expect(baseline).toHaveLength(1);
    const byIndex = new Map(out.items.map((i) => [i.index, i]));
    // Every worn item resolves against the Import's item index, with its name and quality.
    for (const c of out.combinations) {
      for (const index of Object.values(c.gear)) expect(byIndex.has(index)).toBe(true);
    }
    expect(out.items.some((i) => i.name !== null && i.quality !== null)).toBe(true);
    expect(out.talentLoadouts.length).toBeGreaterThan(0);
    // The client ranks straight from this payload.
    const ranking = rankResults(out.results);
    expect(ranking.baseline?.stage).toBe(3);
    expect(ranking.rows.length).toBeGreaterThan(1);
  });

  test("a stopped Sim shows its partial results with the Stage each row reached", async () => {
    let gate: string | undefined;
    start((call) => ({ ...bandReply(call), gate: call.stage === 2 ? gate : undefined }));
    gate = join(h.root, "gate");
    const draft = await topGear([...HEADS, ...NECKS, ...SHOULDERS, ...CHESTS]);
    await h.queue(draft.id);
    await until(() => calls.length === 2, "Stage 2 to launch");
    await h.stop(draft.id, true);
    await h.app.idle();

    const out = await h.results(draft.id);
    expect(out.status).toBe("cancelled");
    expect(out.stageCount).toBe(3);
    expect(out.results).toHaveLength(81);
    expect(new Set(out.results.map((r) => r.stage))).toEqual(new Set([1]));
    const ranking = rankResults(out.results);
    expect(ranking.rows).toHaveLength(81);
    expect(ranking.rows.every((r) => r.stage === 1)).toBe(true);
  });

  test("409 while the Sim is still running or queued", async () => {
    start(bandReply);
    const draft = await topGear([...HEADS]);
    expect((await h.call("GET", `/api/sims/${draft.id}/results`)).status).toBe(409);
  });
});

describe("Stop mid-Stage", () => {
  test("cancels the Sim and keeps the Stages that finished", async () => {
    let gate: string | undefined;
    start((call) => ({ ...bandReply(call), gate: call.stage === 2 ? gate : undefined }));
    gate = join(h.root, "gate");
    const draft = await topGear([...HEADS, ...NECKS, ...SHOULDERS, ...CHESTS]);
    await h.queue(draft.id);
    await until(() => calls.length === 2, "Stage 2 to launch");
    // Stage 2 is now waiting on its gate.
    expect((await h.stop(draft.id, true)).status).toBe(202);
    await h.app.idle();

    expect((await h.sim(draft.id)).status).toBe("cancelled");
    expect([1, 2].map((s) => stageRows(draft.id, s).length)).toEqual([81, 0]);
    expect(existsSync(h.simFile(draft.id, "stage-1.simc"))).toBe(true);
    expect(existsSync(h.simFile(draft.id, "stage-1.json.gz"))).toBe(true);
    expect(existsSync(h.simFile(draft.id, "stage-2.json.gz"))).toBe(false);
    expect((await ladderOf(draft.id)).stages.map((s) => s.entered)).toEqual([81, null, null]);
  });
});

describe("crash recovery between Stages", () => {
  test("resumes at the first unfinished Stage over the survivors of the last finished one", async () => {
    start(bandReply);
    const draft = await topGear([...HEADS, ...NECKS, ...SHOULDERS, ...CHESTS]);
    await h.queue(draft.id);
    await h.app.idle();
    const before = rowsOf(draft.id);
    const firstRun = calls.length;
    expect(firstRun).toBe(3);

    // The server died during Stage 3: no results for it, the Job and Sim still `running`.
    h.app.db.run(
      "DELETE FROM stage_results WHERE stage = 3 AND combination_id IN (SELECT id FROM combinations WHERE sim_id = ?)",
      [draft.id],
    );
    h.app.db.run("UPDATE sims SET status = 'running', finished_at = NULL WHERE id = ?", [draft.id]);
    h.app.db.run("UPDATE jobs SET status = 'running', finished_at = NULL WHERE sim_id = ?", [
      draft.id,
    ]);
    writeFileSync(join(h.dataDir, "stray"), "");
    const { dataDir, root } = h;
    h.app.close();

    calls = [];
    const stage = smartLaunch(() => root, bandReply, calls);
    const app = createApp(
      { dataDir, clientDir: join(root, "client") },
      {
        launch: (dir, args) =>
          /stage-\d+\.simc$/.test(args[0] as string)
            ? stage(dir, args)
            : [process.execPath, FAKE_SIMC, `--scenario=${join(IMPORT_ITEMS, "success")}`, ...args],
        log: () => {},
        isSimcProcess: isFakeSimc,
      },
    );
    try {
      await app.idle();
      const res = await app.fetch(new Request(`http://simbot.test/api/sims/${draft.id}`));
      expect(simSchema.parse(await res.json()).status).toBe("succeeded");
      // Only Stage 3 ran again, over the 11 profilesets that survived Stage 2.
      expect(calls.map((c) => c.stage)).toEqual([3]);
      expect(calls[0]?.names).toHaveLength(11);
      const after = app.db
        .query<{ combination_id: number; stage: number; survived: number }, [number]>(
          `SELECT r.combination_id, r.stage, r.survived FROM stage_results r
           JOIN combinations c ON c.id = r.combination_id WHERE c.sim_id = ? ORDER BY r.stage, r.combination_id`,
        )
        .all(draft.id);
      expect(after.filter((r) => r.stage < 3)).toEqual(
        before.filter((r) => r.stage < 3).map(({ is_baseline: _, ...r }) => r),
      );
      expect(after.filter((r) => r.stage === 3)).toHaveLength(12);
    } finally {
      app.close();
    }
  });
});

test("a Discard after Stage 1 drops every Stage Result and file", async () => {
  let gate: string | undefined;
  start((call) => ({ ...bandReply(call), gate: call.stage === 2 ? gate : undefined }));
  gate = join(h.root, "gate");
  const draft = await topGear([...HEADS, ...NECKS, ...SHOULDERS, ...CHESTS]);
  await h.queue(draft.id);
  await until(() => calls.length === 2, "Stage 2 to launch");
  await h.stop(draft.id, false);
  await h.app.idle();
  expect((await h.sim(draft.id)).status).toBe("draft");
  expect(rowsOf(draft.id)).toEqual([]);
  expect(existsSync(join(h.dataDir, "sims", String(draft.id)))).toBe(false);
});
