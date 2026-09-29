import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { SimcBuild, SimError } from "@simbot/shared";
import {
  buildInput,
  classifyExit,
  Json2FormatError,
  launchCommand,
  readQuickSimResult,
  stageArgs,
} from "@simbot/simc";
import type { Db } from "../db";
import { getImportText } from "../db/imports";
import { abandonJob, failSim, getSim, setJobPid, startSim, succeedSim } from "../db/sims";
import type { EventBus } from "../events";

export type Launch = (buildDir: string, args: readonly string[]) => string[];

export type RunSimDeps = {
  db: Db;
  dataDir: string;
  bus: EventBus;
  /** Resolves the Current SimC Build at Job start. */
  currentBuild: () => Promise<SimcBuild | null>;
  /** argv for a SimC Build directory; tests swap in the fake `simc`. */
  launch?: Launch;
  log?: (message: string) => void;
};

const STDERR_KEEP = 8_000;

/** Reads a stream to the end, keeping only its last `keep` (> 0) characters. */
async function tail(stream: ReadableStream<Uint8Array>, keep: number): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    if (text.length > keep * 2) text = text.slice(-keep);
  }
  return (text + decoder.decode()).slice(-keep);
}

/** Reads a stream to the end and drops it: SimC blocks if its stdout pipe is never drained. */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  for await (const _ of stream) {
    // Progress parsing arrives with the live-progress slice.
  }
}

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

  const fail = (error: SimError) => {
    failSim(db, job.id, job.simId, error);
    bus.emit({ type: "sim.status", simId: job.simId, status: "failed" });
  };

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
    if (!build) {
      return fail({ kind: "no_simc_build", message: "No SimC Build is installed." });
    }

    const addonString = getImportText(db, sim.importId);
    if (addonString === null) throw new Error(`Import ${sim.importId} is missing`);

    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    const inputPath = join(tmp, "stage-1.simc");
    const json2Path = join(tmp, "stage-1.json");
    await writeFile(inputPath, buildInput(addonString, sim.settings));

    const buildDir = join(dataDir, "simc", build.tag);
    let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
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

    const [, stderr, exitCode] = await Promise.all([
      drainStream(proc.stdout),
      tail(proc.stderr, STDERR_KEEP),
      proc.exited,
    ]);
    if (exitCode !== 0) return fail(classifyExit(proc.signalCode ? null : exitCode, stderr));

    const json2Text = await readOrNull(json2Path);
    try {
      const { dps } = readQuickSimResult(json2Text);
      const simDir = join(dataDir, "sims", String(sim.id));
      await mkdir(simDir, { recursive: true });
      await writeFile(join(simDir, "stage-1.json.gz"), gzipSync(json2Text ?? ""));
      await rename(inputPath, join(simDir, "stage-1.simc"));
      succeedSim(db, job.id, sim.id, 1, dps);
      bus.emit({ type: "sim.status", simId: sim.id, status: "succeeded" });
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
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
