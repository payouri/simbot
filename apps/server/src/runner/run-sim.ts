import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { SimcBuild, SimError, SimLogLevel, SimProgress } from "@simbot/shared";
import {
  buildInput,
  classifyExit,
  createLineSplitter,
  createProgressParser,
  Json2FormatError,
  launchCommand,
  type ParsedLine,
  PRECISION_TARGET_ERROR,
  readQuickSimResult,
  stageArgs,
  toSimProgress,
} from "@simbot/simc";
import type { Db } from "../db";
import { getImportText } from "../db/imports";
import {
  abandonJob,
  cancelSim,
  discardRunningSim,
  failSim,
  getFrozenSimcTag,
  getSim,
  getStopMode,
  setJobPid,
  startSim,
  succeedSim,
} from "../db/sims";
import type { EventBus } from "../events";
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
const STAGE = 1;

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
 * Runs one Quick Sim Job to a terminal state. Never throws: every failure is recorded on the
 * Sim as a classified error. Files live in `tmp/<job>/` while running and move to
 * `sims/<id>/stage-1.*` on success.
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
  const finished = (status: "succeeded" | "failed") => {
    bus.emit({ type: "sim.status", simId: job.simId, status });
    bus.emit({ type: "sim.finished", simId: job.simId, status });
    bus.emit({ type: "queue.changed" });
  };
  const fail = (error: SimError) => {
    failSim(db, job.id, job.simId, error);
    finished("failed");
  };

  /** Stop (`cancelled`, results kept) or Discard (back to Draft, results and folder gone). */
  const settleStop = async (mode: "keep" | "discard") => {
    if (mode === "discard") {
      discardRunningSim(db, job.simId);
      await rm(join(dataDir, "sims", String(job.simId)), { recursive: true, force: true });
      bus.emit({ type: "sim.status", simId: job.simId, status: "draft" });
      bus.emit({ type: "sim.discarded", simId: job.simId });
    } else {
      cancelSim(db, job.id, job.simId);
      bus.emit({ type: "sim.status", simId: job.simId, status: "cancelled" });
      bus.emit({ type: "sim.finished", simId: job.simId, status: "cancelled" });
    }
    bus.emit({ type: "queue.changed" });
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
  // has launched is picked up by the checks below.
  const offStop = bus.on((event) => {
    if (event.type === "sim.stop_requested" && event.simId === job.simId) terminate();
  });

  if (sim?.status !== "queued") {
    log(`runner: Job ${job.id} has no queued Sim ${job.simId}, dropping it`);
    abandonJob(db, job.id);
    return;
  }

  try {
    // The SimC Build is resolved now, not at queue time, and recorded on the Sim.
    const build = await deps.currentBuild();
    if (!startSim(db, job.id, sim.id, build?.tag ?? null)) {
      abandonJob(db, job.id);
      return;
    }
    bus.emit({ type: "sim.status", simId: sim.id, status: "running" });
    bus.emit({ type: "queue.changed" });
    if (!build) {
      return fail({ kind: "no_simc_build", message: "No SimC Build is installed." });
    }

    if (sim.kind === "top_gear" && deps.revalidate && getFrozenSimcTag(db, sim.id) !== build.tag) {
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

    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    const inputPath = join(tmp, "stage-1.simc");
    const json2Path = join(tmp, "stage-1.json");
    await writeFile(inputPath, buildInput(addonString, sim.settings));

    const buildDir = join(dataDir, "simc", build.tag);
    const stopBeforeLaunch = getStopMode(db, job.id);
    if (stopBeforeLaunch) return await settleStop(stopBeforeLaunch);
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
      return fail({
        kind: "launch_failed",
        message: `Could not start SimC: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    setJobPid(db, job.id, proc.pid);
    if (getStopMode(db, job.id)) terminate();
    bus.emit({ type: "sim.stage_started", simId: sim.id, stage: STAGE });

    const emitLog = (level: SimLogLevel, message: string) =>
      bus.emit({ type: "sim.log", simId: sim.id, level, message: message.slice(0, LOG_LINE_MAX) });
    const targetErrorPct = PRECISION_TARGET_ERROR[sim.settings.precision];
    const onLines = (lines: ParsedLine[]) => {
      for (const line of lines) {
        if (line.kind === "text") {
          if (deps.debugLogs) emitLog("debug", line.text);
        } else {
          progress.push(toSimProgress(line, { simId: sim.id, stage: STAGE, targetErrorPct }));
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
    const running = proc;
    const [, , exitCode] = await Promise.all([
      readText(proc.stdout, (text) => onLines(stdoutParser.push(text))),
      readText(proc.stderr, (text) => {
        stderr += text;
        if (stderr.length > STDERR_KEEP * 2) stderr = stderr.slice(-STDERR_KEEP);
        onStderrLines(stderrLines.push(text));
      }),
      running.exited,
    ]);
    onLines(stdoutParser.flush());
    onStderrLines(stderrLines.flush());
    progress.flush();
    stderr = stderr.slice(-STDERR_KEEP);
    // A Discard wins even over a run that got to finish; a Stop only when there is nothing to keep.
    const stop = getStopMode(db, job.id);
    if (stop === "discard" || (stop === "keep" && exitCode !== 0)) return await settleStop(stop);
    if (exitCode !== 0) return fail(classifyExit(running.signalCode ? null : exitCode, stderr));

    const json2Text = await readOrNull(json2Path);
    try {
      const { dps } = readQuickSimResult(json2Text);
      const simDir = join(dataDir, "sims", String(sim.id));
      await mkdir(simDir, { recursive: true });
      await writeFile(join(simDir, "stage-1.json.gz"), gzipSync(json2Text ?? ""));
      await rename(inputPath, join(simDir, "stage-1.simc"));
      succeedSim(db, job.id, sim.id, STAGE, dps);
      bus.emit({ type: "sim.stage_finished", simId: sim.id, stage: STAGE });
      finished("succeeded");
    } catch (err) {
      if (err instanceof Json2FormatError) {
        return fail({ kind: "output_format_changed", message: err.message });
      }
      throw err;
    }
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
