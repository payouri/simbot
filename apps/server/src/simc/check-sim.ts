import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DpsSummary } from "@simbot/shared";
import {
  buildCheckSimInput,
  buildPaths,
  classifyExit,
  isPlayerProfile,
  launchCommand,
  readCheckSimResult,
  stageArgs,
} from "@simbot/simc";

/** argv that launches a SimC Build directory; tests swap in the fake `simc`. */
export type Launch = (buildDir: string, args: readonly string[]) => string[];

/** A wedged SimC must not hold the Queue forever. A real Check Sim takes seconds. */
const CHECK_SIM_TIMEOUT_MS = 10 * 60_000;
const STDERR_KEEP = 2000;

/** The first character profile under a build's `profiles/`, or null when it ships none. */
async function findProfile(profilesDir: string): Promise<string | null> {
  let entries: { name: string; parentPath: string; isFile(): boolean }[];
  try {
    entries = await readdir(profilesDir, { recursive: true, withFileTypes: true });
  } catch {
    return null;
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".simc"))
    .map((e) => join(e.parentPath, e.name))
    .sort();
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (isPlayerProfile(text)) return text;
  }
  return null;
}

/**
 * Runs a Check Sim on the SimC Build in `dir`: the latest Import's Addon String, or with none a
 * profile from the build, at 1% `target_error` plus one profileset override. Resolves with the
 * DPS; rejects when SimC fails or its output is not understood.
 */
export async function runCheckSim(opts: {
  dir: string;
  tmpRoot: string;
  /** The latest Import's Addon String, if there is one. */
  addonString: string | null;
  launch?: Launch;
}): Promise<{
  dps: DpsSummary;
  source: "import" | "profile";
  /** Wall time of the SimC run and the iterations it took: what the time estimate is built on. */
  durationMs: number;
  iterations: number | null;
}> {
  const { dir, launch = launchCommand } = opts;
  const profile = opts.addonString ?? (await findProfile(buildPaths(dir).profiles));
  if (profile === null) throw new Error("no Import and the build ships no profile to check with");

  const work = await mkdtemp(join(opts.tmpRoot, "check-sim-"));
  try {
    const inputPath = join(work, "check.simc");
    const json2Path = join(work, "check.json");
    await writeFile(inputPath, buildCheckSimInput(profile));
    let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
    const started = performance.now();
    try {
      proc = Bun.spawn(launch(dir, stageArgs(inputPath, json2Path)), {
        cwd: work,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: CHECK_SIM_TIMEOUT_MS,
      });
    } catch (err) {
      throw new Error(`Could not start SimC: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    const [, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        classifyExit(proc.signalCode ? null : exitCode, stderr.slice(-STDERR_KEEP)).message,
      );
    }
    const durationMs = Math.round(performance.now() - started);
    const text = await readFile(json2Path, "utf8").catch(() => null);
    const result = readCheckSimResult(text);
    return {
      dps: result.dps,
      source: opts.addonString ? "import" : "profile",
      durationMs,
      iterations: result.iterations,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
