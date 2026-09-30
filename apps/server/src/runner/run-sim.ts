import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  isTopGear,
  ptrUnavailableReason,
  type SimcBuild,
  type SimError,
  type SimLogLevel,
  type SimProgress,
} from "@simbot/shared";
import {
  buildStageInput,
  type CullEntry,
  classifyExit,
  createLineSplitter,
  createProgressParser,
  cull,
  invalidProfileset,
  Json2FormatError,
  launchCommand,
  type ParsedLine,
  readStageReport,
  stageArgs,
  stageLadder,
  toSimProgress,
} from "@simbot/simc";
import type { Db } from "../db";
import { getImportText } from "../db/imports";
import {
  abandonJob,
  type CombinationRow,
  cancelSim,
  discardRunningSim,
  failSim,
  getCombinationRows,
  getFrozenSimcTag,
  getSim,
  getStopMode,
  lastFinishedStage,
  markInvalid,
  recordStage,
  setJobPid,
  stageSurvivorIds,
  startSim,
  succeedSim,
} from "../db/sims";
import type { EventBus } from "../events";
import { settleSim } from "../settle";
import type { Launch } from "../simc/check-sim";
import { killGroup } from "./recovery";
import { createThrottle } from "./throttle";

export type { Launch };

export type RunSimDeps = {
  db: Db;
  dataDir: string;
  bus: EventBus;
  /**
   * Checks a Top Gear's frozen Combinations against the Current SimC Build; resolves with the
   * problems (none: fine). Called at Job start when that build is not the one they were
   * validated on.
   */
  revalidate?: (simId: number) => Promise<string[]>;
  /** Resolves the Current SimC Build at Job start. */
  currentBuild: () => Promise<SimcBuild | null>;
  /** argv for a SimC Build directory; tests swap in the fake `simc`. */
  launch?: Launch;
  log?: (message: string) => void;
  /** Dev flag: also emit SimC's non-progress stdout as `sim.log` at `debug`. */
  debugLogs?: boolean;
  /** Minimum gap between `sim.progress` events. Defaults to 250 ms (about 4 per second). */
  progressIntervalMs?: number;
  /** How long SimC gets to exit after SIGTERM before SIGKILL. Defaults to 5 s. */
  killGraceMs?: number;
};

const KILL_GRACE_MS = 5_000;
const STDERR_KEEP = 8_000;
const PROGRESS_INTERVAL_MS = 250;
const LOG_LINE_MAX = 2_000;
/** Combinations SimC may refuse (exit 80 on a profileset) in one Stage before the Sim fails. */
const MAX_INVALID_RETRIES = 3;

/** Feeds a stream's decoded text to `onText` until it ends. */
async function readText(stream: ReadableStream<Uint8Array>, onText: (text: string) => void) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) onText(decoder.decode(chunk, { stream: true }));
  onText(decoder.decode());
}

/** SimC prefixes what it raises on stderr with its level. */
const stderrLevel = (line: string): SimLogLevel =>
  /^error/i.test(line) ? "error" : /^warning/i.test(line) ? "warn" : "info";

const readOrNull = (path: string) => readFile(path, "utf8").catch(() => null);

/**
 * Runs one Sim Job to a terminal state. Never throws: every failure is recorded on the Sim as a
 * classified error. A Quick Sim is one Stage over the baseline; a Top Gear is a Smart Sim, one
 * SimC run per Stage with a Cull between them, resuming at the first Stage without results.
 * A Stage's files live in `tmp/<job>/` while it runs and move to `sims/<id>/stage-<n>.*` when
 * it finishes.
 */
export async function runSimJob(deps: RunSimDeps, job: { id: number; simId: number }) {
  const { db, dataDir, bus, launch = launchCommand, log = console.error } = deps;
  const sim = getSim(db, job.simId);
  const tmp = join(dataDir, "tmp", String(job.id));
  const progress = createThrottle<SimProgress>(
    deps.progressIntervalMs ?? PROGRESS_INTERVAL_MS,
    (p) => bus.emit({ type: "sim.progress", ...p }),
  );

  /** A Sim reached a terminal state: tell clients, and that the Queue shrank. */
  const finished = (status: "succeeded" | "failed") => settleSim(deps, job.simId, status);
  const fail = (error: SimError) => {
    failSim(db, job.id, job.simId, error);
    finished("failed");
  };

  /** Stop (`cancelled`, results kept) or Discard (back to Draft, results and folder gone). */
  const settleStop = (mode: "keep" | "discard") => {
    if (mode === "discard") discardRunningSim(db, job.simId);
    else cancelSim(db, job.id, job.simId);
    settleSim(deps, job.simId, mode === "discard" ? "discarded" : "cancelled");
  };

  // SIGTERM to SimC's process group, then SIGKILL if it is still there after the grace period.
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  const terminate = () => {
    if (!proc || killTimer) return;
    const pid = proc.pid;
    killGroup(pid, "SIGTERM");
    killTimer = setTimeout(() => killGroup(pid, "SIGKILL"), deps.killGraceMs ?? KILL_GRACE_MS);
  };
  // A request lands in the DB first; the event only wakes us, so one that arrives before SimC
  // has launched is picked up by the checks in the Stage loop.
  const offStop = bus.on((event) => {
    if (event.type === "sim.stop_requested" && event.simId === job.simId) terminate();
  });

  if (sim?.status !== "queued") {
    log(`runner: Job ${job.id} has no queued Sim ${job.simId}, dropping it`);
    abandonJob(db, job.id);
    return;
  }

  const emitLog = (level: SimLogLevel, message: string) =>
    bus.emit({ type: "sim.log", simId: sim.id, level, message: message.slice(0, LOG_LINE_MAX) });

  type SimcRun =
    | { ok: false; error: SimError }
    | { ok: true; exitCode: number; signalled: boolean; stderr: string };

  /** One SimC process, with both pipes drained and its progress streamed. */
  async function runSimc(
    buildDir: string,
    stage: number,
    inputPath: string,
    json2Path: string,
    targetErrorPct: number,
  ): Promise<SimcRun> {
    try {
      // Its own process group, so Stop can later signal SimC and everything it forks.
      proc = Bun.spawn(launch(buildDir, stageArgs(inputPath, json2Path)), {
        cwd: tmp,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      });
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "launch_failed",
          message: `Could not start SimC: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
    const running = proc;
    setJobPid(db, job.id, running.pid);
    if (getStopMode(db, job.id)) terminate();

    const onLines = (lines: ParsedLine[]) => {
      for (const line of lines) {
        if (line.kind === "text") {
          if (deps.debugLogs) emitLog("debug", line.text);
        } else {
          progress.push(toSimProgress(line, { simId: job.simId, stage, targetErrorPct }));
        }
      }
    };
    // Both pipes are always drained: SimC blocks once a pipe fills.
    const stdoutParser = createProgressParser();
    const stderrLines = createLineSplitter();
    let stderr = "";
    const onStderrLines = (lines: string[]) => {
      for (const line of lines) if (line.trim() !== "") emitLog(stderrLevel(line), line.trim());
    };
    const [, , exitCode] = await Promise.all([
      readText(running.stdout, (text) => onLines(stdoutParser.push(text))),
      readText(running.stderr, (text) => {
        stderr += text;
        if (stderr.length > STDERR_KEEP * 2) stderr = stderr.slice(-STDERR_KEEP);
        onStderrLines(stderrLines.push(text));
      }),
      running.exited,
    ]);
    onLines(stdoutParser.flush());
    onStderrLines(stderrLines.flush());
    progress.flush();
    if (killTimer) clearTimeout(killTimer);
    killTimer = null;
    proc = null;
    return {
      ok: true,
      exitCode,
      signalled: running.signalCode !== null,
      stderr: stderr.slice(-STDERR_KEEP),
    };
  }

  try {
    // The SimC Build is resolved now, not at queue time, and recorded on the Sim.
    const build = await deps.currentBuild();
    const isPtr = sim.settings.gameData === "ptr";
    // The version of the Sim's own game data, so a PTR result stays explainable once the PTR moves on.
    const ptrReason = build && isPtr ? ptrUnavailableReason(build) : null;
    const gameDataVersion = build
      ? isPtr
        ? ptrReason === null
          ? build.ptrGameDataVersion
          : null
        : build.gameDataVersion
      : null;
    if (!startSim(db, job.id, sim.id, build?.tag ?? null, gameDataVersion)) {
      abandonJob(db, job.id);
      return;
    }
    bus.emit({ type: "sim.status", simId: sim.id, status: "running" });
    bus.emit({ type: "queue.changed" });
    if (!build) {
      return fail({ kind: "no_simc_build", message: "No SimC Build is installed." });
    }

    // Never a silent fallback to Live: a PTR Sim with no PTR to run on fails here.
    if (ptrReason !== null) {
      return fail({
        kind: "ptr_unavailable",
        message: `No PTR data in SimC Build ${build.tag}: ${ptrReason}, so this PTR Sim was not run.`,
      });
    }

    if (isTopGear(sim) && deps.revalidate && getFrozenSimcTag(db, sim.id) !== build.tag) {
      const problems = await deps.revalidate(sim.id);
      if (problems.length > 0) {
        return fail({
          kind: "invalid_combinations",
          message: `SimC Build ${build.tag} changed what the Combinations allow: ${problems.slice(0, 3).join(" ")}`,
        });
      }
    }

    const addonString = getImportText(db, sim.importId);
    if (addonString === null) throw new Error(`Import ${sim.importId} is missing`);

    const rows = getCombinationRows(db, sim.id);
    const baseline = rows.find((r) => r.isBaseline);
    if (!baseline) throw new Error(`Sim ${sim.id} has no baseline Combination`);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ladder = stageLadder(sim.settings.precision, rows.length);

    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    const buildDir = join(dataDir, "simc", build.tag);
    const simDir = join(dataDir, "sims", String(sim.id));

    // Resume: the field is whatever survived the last finished Stage (everyone, on a fresh
    // start), minus the Combinations SimC has refused.
    const done = lastFinishedStage(db, sim.id);
    let field: number[] = done === 0 ? rows.map((r) => r.id) : stageSurvivorIds(db, sim.id, done);
    const refused = new Set(rows.filter((r) => r.invalidStage !== null).map((r) => r.id));
    field = field.filter((id) => !refused.has(id));
    const verbose = rows.length > 1;

    for (let stage = done + 1; stage <= ladder.length; stage++) {
      const targetError = ladder[stage - 1] as number;
      const isFinal = stage === ladder.length;
      const inputPath = join(tmp, `stage-${stage}.simc`);
      const json2Path = join(tmp, `stage-${stage}.json`);
      let dropped = 0;
      let invalidNow = rows.filter((r) => r.invalidStage === stage).length;

      for (;;) {
        // A Stop or Discard asked for since the last check is honoured before SimC launches.
        const stopBefore = getStopMode(db, job.id);
        if (stopBefore) return settleStop(stopBefore);

        const survivors = field
          .filter((id) => id !== baseline.id)
          .map((id) => byId.get(id))
          .filter((r): r is CombinationRow => r !== undefined);
        await writeFile(
          inputPath,
          buildStageInput({
            addonString,
            settings: sim.settings,
            targetError,
            baseline: baseline.definition,
            profilesets: survivors.map((r) => ({ id: r.id, definition: r.definition })),
            consumables: sim.topGearSelection?.consumables,
          }),
        );
        bus.emit({
          type: "sim.stage_started",
          simId: sim.id,
          stage,
          stages: ladder.length,
          entered: survivors.length + 1,
          targetErrorPct: targetError,
        });
        if (verbose) {
          emitLog(
            "info",
            `Stage ${stage} of ${ladder.length}: ${survivors.length + 1} Combinations to ${targetError}% error.`,
          );
        }

        const started = performance.now();
        const run = await runSimc(buildDir, stage, inputPath, json2Path, targetError);
        const durationMs = performance.now() - started;
        if (!run.ok) return fail(run.error);
        // A Discard wins even over a run that got to finish; a Stop only when there is nothing to keep.
        const stop = getStopMode(db, job.id);
        if (stop === "discard" || (stop === "keep" && run.exitCode !== 0)) {
          return settleStop(stop);
        }
        if (run.exitCode !== 0) {
          // Exit 80 naming one of our profilesets: drop that Combination and run the Stage again.
          const bad = run.exitCode === 80 ? invalidProfileset(run.stderr) : null;
          if (
            bad !== null &&
            bad !== baseline.id &&
            field.includes(bad) &&
            dropped < MAX_INVALID_RETRIES
          ) {
            dropped++;
            invalidNow++;
            markInvalid(db, bad, stage);
            field = field.filter((id) => id !== bad);
            emitLog(
              "warn",
              `Combination ${bad} is invalid for SimC and was dropped; Stage ${stage} runs again without it.`,
            );
            continue;
          }
          return fail(classifyExit(run.signalled ? null : run.exitCode, run.stderr));
        }

        const json2Text = await readOrNull(json2Path);
        let report: ReturnType<typeof readStageReport>;
        try {
          report = readStageReport(
            json2Text,
            survivors.map((r) => r.id),
          );
        } catch (err) {
          if (err instanceof Json2FormatError) {
            return fail({ kind: "output_format_changed", message: err.message });
          }
          throw err;
        }

        // A Combination missing from an otherwise valid report failed: drop it, keep the Stage.
        for (const id of report.missing) {
          invalidNow++;
          markInvalid(db, id, stage);
          emitLog(
            "warn",
            `Combination ${id} is missing from Stage ${stage}'s report and was dropped.`,
          );
        }
        const missingSet = new Set(report.missing);
        const entries: CullEntry[] = [
          {
            id: baseline.id,
            isBaseline: true,
            mean: report.baseline.mean,
            error: report.baseline.meanError,
          },
          ...survivors
            .filter((r) => !missingSet.has(r.id))
            .map((r) => {
              const dps = report.profilesets.get(r.id) as { mean: number; meanError: number };
              return { id: r.id, isBaseline: false, mean: dps.mean, error: dps.meanError };
            }),
        ];
        const { kept, culled } = isFinal
          ? { kept: entries.map((e) => e.id), culled: [] as number[] }
          : cull(entries);
        const keptSet = new Set(kept);

        // Files first: a crash before the rows land just redoes this Stage over them.
        await mkdir(simDir, { recursive: true });
        await writeFile(join(simDir, `stage-${stage}.json.gz`), gzipSync(json2Text ?? ""));
        await rename(inputPath, join(simDir, `stage-${stage}.simc`));
        recordStage(
          db,
          stage,
          entries.map((e) => ({
            combinationId: e.id,
            dps: { mean: e.mean, meanError: e.error },
            survived: keptSet.has(e.id),
          })),
          {
            simId: sim.id,
            durationMs,
            iterations: report.iterations,
            // Only the profilesets that came back: the iterations are summed over those.
            profilesets: report.profilesets.size,
            targetError,
          },
        );
        field = kept;
        bus.emit({
          type: "sim.stage_finished",
          simId: sim.id,
          stage,
          survivors: kept.length,
          culled: culled.length,
          invalid: invalidNow,
        });
        if (verbose) {
          emitLog(
            "info",
            `Stage ${stage} done: ${kept.length} kept, ${culled.length} culled${invalidNow > 0 ? `, ${invalidNow} invalid` : ""}.`,
          );
        }
        break;
      }
    }

    succeedSim(db, job.id, sim.id);
    finished("succeeded");
  } catch (err) {
    log(
      `runner: Job ${job.id} crashed: ${err instanceof Error ? (err.stack ?? err.message) : err}`,
    );
    const now = getSim(db, job.simId);
    if (now?.status === "running") {
      fail({
        kind: "internal",
        message: `Internal error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } finally {
    offStop();
    if (killTimer) clearTimeout(killTimer);
    progress.cancel();
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
