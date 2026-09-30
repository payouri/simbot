/**
 * The Top Gear benchmark: runs real gear sets through the Current SimC Build under a sweep of
 * threading and precision settings and writes what it measured. Nothing in it is an estimate of
 * its own; every number in its output file comes from a run.
 *
 *   SIMBOT_DATA_DIR=<data> bun run bench:top-gear [options]
 *
 * Needs an installed SimC Build and its item-meta in the data dir (the app installs both on first
 * start), and a machine that is otherwise idle: a Stage uses every thread. Results go to
 * `apps/server/bench/results/<timestamp>.json`; `--summarize <file>` reads one back.
 *
 * Before any Sim it runs a Check Sim of each gear set on the build, as a SimC Update does on the
 * latest Import, so the summary can show how far a Check Sim's cost model is from each Sim (the
 * app does not estimate from it) even on a data dir that has none.
 *
 * Options:
 *   --sets <file,file>       Addon String files, one gear set each. Default: the import-items
 *                            fixture's Frost Death Knight. Real exports live in `bench/sets/`.
 *   --caps <n,n,...>         Candidate Items taken from each set per case, in Import order
 *                            (only the ones SimC read). Default 4,8,12,16,24,all. More items is
 *                            more Combinations; the benchmark records how many it got.
 *   --threads <n,n,...>      `profileset_work_threads` values to sweep. Default 1,2,4,8,16.
 *   --total-threads <n,n>    SimC's total `threads` values to sweep. Default: not set, so SimC
 *                            uses every logical thread.
 *   --intervals <n,n,...>    `analyze_error_interval` values. Default 100.
 *   --ceilings <n,n,...>     Iteration ceilings (`iterations=`). Default 50000.
 *   --precision <preset>     low | medium | high. Default medium.
 *   --duration <seconds>     Fight length. Default 300 (the app's default).
 *   --repeats <n>            Sims of each case at each sweep point. Default 1; 3 is better.
 *   --out <dir>              Where to write the results. Default apps/server/bench/results.
 *
 * The sweep is one-at-a-time around the first value of each list, not a full grid: threads vary
 * with the first interval and ceiling, and so on. SimC options reach the Sim through its raw
 * options, which the Stage input places after the defaults, so no production code is touched.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import {
  combinationPreviewSchema,
  importItemsResponseSchema,
  type Precision,
  precisionSchema,
  simSchema,
} from "@simbot/shared";
import {
  ANALYZE_ERROR_INTERVAL,
  achievedError,
  type BenchCheckSim,
  type BenchResults,
  type BenchSim,
  type BenchStage,
  formatSummary,
  ITERATIONS_CEILING,
  PROFILESET_WORK_THREADS,
  type SweepPoint,
  sweepKey,
} from "@simbot/simc";
import { loadConfig } from "../src/config";
import { getCheckSimCost } from "../src/db/simc-jobs";
import { getStageCosts } from "../src/db/sims";
import { type Launch, runCheckSim } from "../src/simc/check-sim";
import { buildDir } from "../src/simc/install";
import {
  type Harness,
  importItemsAddonString,
  installedBuildTag,
  makeRealBuildHarness,
} from "../test/harness";

export type Case = { name: string; addonString: string; cap: number | "all" };

export type BenchOptions = {
  /** A fresh app over a temp data dir with a SimC Build installed. Called once per Sim. */
  harness: () => Harness;
  cases: readonly Case[];
  sweeps: readonly SweepPoint[];
  precision: Precision;
  fightSeconds: number;
  repeats: number;
  log?: (line: string) => void;
};

/** One-at-a-time sweep around the first value of each list. */
export function sweepPoints(
  threads: readonly number[],
  intervals: readonly number[],
  ceilings: readonly number[],
  totalThreads: readonly number[] = [],
): SweepPoint[] {
  const base: SweepPoint = {
    ...(totalThreads.length ? { totalThreads: totalThreads[0] } : {}),
    profilesetWorkThreads: threads[0] ?? PROFILESET_WORK_THREADS,
    analyzeErrorInterval: intervals[0] ?? ANALYZE_ERROR_INTERVAL,
    iterationsCeiling: ceilings[0] ?? ITERATIONS_CEILING,
  };
  const all: SweepPoint[] = [
    ...threads.map((profilesetWorkThreads) => ({ ...base, profilesetWorkThreads })),
    ...intervals.map((analyzeErrorInterval) => ({ ...base, analyzeErrorInterval })),
    ...ceilings.map((iterationsCeiling) => ({ ...base, iterationsCeiling })),
    ...totalThreads.map((n) => ({ ...base, totalThreads: n })),
  ];
  const seen = new Set<string>();
  return all.filter((p) => !seen.has(sweepKey(p)) && seen.add(sweepKey(p)));
}

export const rawOptionsOf = (p: SweepPoint) =>
  [
    `profileset_work_threads=${p.profilesetWorkThreads}`,
    `analyze_error_interval=${p.analyzeErrorInterval}`,
    `iterations=${p.iterationsCeiling}`,
    ...(p.totalThreads === undefined ? [] : [`threads=${p.totalThreads}`]),
  ].join("\n");

/** Each profileset of a Stage's json2, read off the stored report. */
function profilesetsOf(
  json2: string,
): { iterations?: number; mean?: number; mean_error?: number }[] {
  const parsed = JSON.parse(json2) as {
    sim?: {
      profilesets?: { results?: { iterations?: number; mean?: number; mean_error?: number }[] };
    };
  };
  return parsed.sim?.profilesets?.results ?? [];
}

/**
 * A Check Sim of each gear set on the SimC Build in `dir`, by set name, one after the other: the
 * run a SimC Update makes on the latest Import, whose time and iterations the summary's `check
 * sim` column is read from.
 */
export async function runCheckSims(
  sets: readonly { name: string; text: string }[],
  opts: { dir: string; launch?: Launch },
): Promise<Record<string, BenchCheckSim>> {
  const tmpRoot = mkdtempSync(join(tmpdir(), "simbot-bench-check-"));
  try {
    const out: Record<string, BenchCheckSim> = {};
    for (const set of sets) {
      const run = await runCheckSim({
        dir: opts.dir,
        tmpRoot,
        addonString: set.text,
        launch: opts.launch,
      });
      out[set.name] = {
        durationMs: run.durationMs,
        iterations: run.iterations,
        errorPercent: (run.dps.meanError / run.dps.mean) * 100,
      };
    }
    return out;
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function simOne(
  h: Harness,
  c: Case,
  sweep: SweepPoint,
  opts: BenchOptions,
): Promise<Omit<BenchSim, "repeat">> {
  const imp = await h.importText(c.addonString);
  const draft = simSchema.parse(
    await (
      await h.call("POST", "/api/sims", {
        importId: imp.id,
        kind: "top_gear",
        settings: {
          precision: opts.precision,
          durationSeconds: opts.fightSeconds,
          rawOptions: rawOptionsOf(sweep),
        },
      })
    ).json(),
  );
  const { items } = importItemsResponseSchema.parse(
    await (await h.call("GET", `/api/imports/${imp.id}/items`)).json(),
  );
  const candidates = items.filter((i) => i.selectable).map((i) => i.index);
  const included = c.cap === "all" ? candidates : candidates.slice(0, c.cap);
  const put = await h.call("PATCH", `/api/sims/${draft.id}`, {
    topGearSelection: { included, talentLoadouts: [0], lockedSlots: [] },
  });
  if (put.status !== 200) throw new Error(`saving the selection failed: ${await put.text()}`);

  const preview = combinationPreviewSchema.parse(
    await (await h.call("POST", `/api/sims/${draft.id}/preview-combinations`, {})).json(),
  );
  if (preview.refused) throw new Error(`${c.name}: the selection is refused`);

  const started = performance.now();
  await h.queue(draft.id);
  await h.app.idle();
  const wallMs = performance.now() - started;

  const sim = await h.sim(draft.id);
  if (sim.status !== "succeeded") {
    throw new Error(`${c.name} ended ${sim.status}: ${JSON.stringify(sim.error)}`);
  }
  const stages: BenchStage[] = getStageCosts(h.app.db, draft.id).map((cost) => {
    let results: ReturnType<typeof profilesetsOf> = [];
    try {
      results = profilesetsOf(h.readGz(h.simFile(draft.id, `stage-${cost.stage}.json.gz`)));
    } catch {
      // No report to read: the fields read from it below stay null.
    }
    const per = results.flatMap((r) => (typeof r.iterations === "number" ? [r.iterations] : []));
    const error = achievedError(
      results.flatMap((r) =>
        typeof r.mean === "number" && typeof r.mean_error === "number"
          ? [{ mean: r.mean, mean_error: r.mean_error }]
          : [],
      ),
    );
    return {
      ...cost,
      maxIterations: per.length ? Math.max(...per) : null,
      atCeiling: per.length ? per.filter((n) => n >= sweep.iterationsCeiling).length : null,
      maxErrorPercent: error?.max ?? null,
      medianErrorPercent: error?.median ?? null,
    };
  });
  return {
    caseName: c.name,
    precision: opts.precision,
    fightSeconds: opts.fightSeconds,
    combinations: preview.count,
    sweep,
    wallMs,
    stages,
    previewEstimateSeconds: preview.estimateSeconds,
  };
}

/** Sims every case at every sweep point, `repeats` times, each on a fresh app and database. */
export async function runBenchmark(opts: BenchOptions): Promise<BenchSim[]> {
  const log = opts.log ?? (() => {});
  const sims: BenchSim[] = [];
  for (const sweep of opts.sweeps) {
    for (const c of opts.cases) {
      for (let repeat = 1; repeat <= opts.repeats; repeat++) {
        const h = opts.harness();
        try {
          const sim = await simOne(h, c, sweep, opts);
          sims.push({ ...sim, repeat });
          log(
            `${c.name} #${repeat} [${sweepKey(sweep)}]: ${sim.combinations} Combinations, ${(sim.wallMs / 1000).toFixed(1)}s`,
          );
        } finally {
          h.close();
        }
      }
    }
  }
  return sims;
}

// -- CLI ---------------------------------------------------------------------------------------

const FLAGS = [
  "summarize",
  "sets",
  "caps",
  "threads",
  "total-threads",
  "intervals",
  "ceilings",
  "precision",
  "duration",
  "repeats",
  "out",
];

/** `--flag value` pairs; throws on an unknown flag or one with no value. */
export function parseArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = (argv[i] as string).replace(/^--/, "");
    const value = argv[i + 1];
    if (!FLAGS.includes(flag)) throw new Error(`unknown option ${argv[i]}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`--${flag} needs a value`);
    args.set(flag, value);
  }
  return args;
}

/** A positive integer, or a clear error naming the option it came from. */
function positiveInt(v: string, flag: string): number {
  const n = Number(v.trim());
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${flag}: ${v} is not a positive integer`);
  return n;
}

const intList = (v: string | undefined, flag: string, fallback: number[]) =>
  v ? v.split(",").map((s) => positiveInt(s, flag)) : fallback;

/** The Check Sim the app stored for `tag` in the real data dir's database, read only. */
function readCheckSim(dataDir: string, tag: string): BenchCheckSim | null {
  const path = join(dataDir, "db", "simbot.sqlite");
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true, strict: true });
  try {
    return getCheckSimCost(db, tag);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const summarize = args.get("summarize");
  if (summarize) {
    console.log(formatSummary(JSON.parse(readFileSync(summarize, "utf8")) as BenchResults));
    return;
  }

  const dataDir = loadConfig().dataDir;
  const tag = installedBuildTag(dataDir);

  const setFiles = args.get("sets")?.split(",") ?? [];
  const sets = setFiles.length
    ? setFiles.map((f) => ({
        name:
          f
            .split("/")
            .at(-1)
            ?.replace(/\.\w+$/, "") ?? f,
        text: readFileSync(f, "utf8"),
      }))
    : [{ name: "fixture", text: importItemsAddonString() }];
  const caps = (args.get("caps") ?? "4,8,12,16,24,all")
    .split(",")
    .map((s): number | "all" => (s.trim() === "all" ? "all" : positiveInt(s, "caps")));
  const cases = sets.flatMap((s) =>
    caps.map((cap) => ({ name: `${s.name}/cap-${cap}`, addonString: s.text, cap })),
  );
  const sweeps = sweepPoints(
    intList(args.get("threads"), "threads", [1, 2, 4, 8, 16]),
    intList(args.get("intervals"), "intervals", [ANALYZE_ERROR_INTERVAL]),
    intList(args.get("ceilings"), "ceilings", [ITERATIONS_CEILING]),
    intList(args.get("total-threads"), "total-threads", []),
  );
  const precision = precisionSchema.parse(args.get("precision") ?? "medium");
  const startedAt = new Date().toISOString();

  const checkSims = await runCheckSims(sets, { dir: buildDir(dataDir, tag) });
  for (const [set, c] of Object.entries(checkSims)) {
    console.log(
      `check sim ${set}: ${c.durationMs}ms, ${c.iterations} iterations, ${c.errorPercent.toFixed(3)}%`,
    );
  }
  const sims = await runBenchmark({
    harness: () => makeRealBuildHarness(dataDir, tag),
    cases,
    sweeps,
    precision,
    fightSeconds: positiveInt(args.get("duration") ?? "300", "duration"),
    repeats: positiveInt(args.get("repeats") ?? "1", "repeats"),
    log: console.log,
  });

  const results: BenchResults = {
    schema: 1,
    producedBy: "apps/server/bench/top-gear.ts",
    startedAt,
    simcTag: tag,
    machine: { cpus: cpus().length, model: cpus()[0]?.model ?? "unknown" },
    checkSim: readCheckSim(dataDir, tag),
    checkSims,
    sims,
  };
  const outDir = args.get("out") ?? join(import.meta.dir, "results");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\n${formatSummary(results)}\n\nwrote ${file}`);
}

if (import.meta.main) await main();
