import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchCommand } from "./build";
import { type Json2BuildInfo, readBuildInfo } from "./json2";

/** A wedged SimC must not hang boot. A real probe finishes in well under a second. */
const PROBE_TIMEOUT_MS = 120_000;

/** A one-iteration, default-gear sim: the cheapest run that still produces a json2 report. */
const PROBE_ARGS = [
  "deathknight=probe",
  "spec=blood",
  "load_default_gear=1",
  "class_talents=all",
  "spec_talents=all",
  "hero_talents=1",
  "iterations=1",
  "max_time=20",
  "threads=1",
  "output=/dev/null",
] as const;

/**
 * Runs the SimC Build in `dir` once and reads its version, commit, branch and game data
 * version from the json2 report. Rejects if SimC fails to run or the report isn't understood.
 */
export async function probeBuild(dir: string, tmpRoot: string = tmpdir()): Promise<Json2BuildInfo> {
  const work = await mkdtemp(join(tmpRoot, "simc-probe-"));
  try {
    const out = join(work, "out.json");
    const proc = Bun.spawn(launchCommand(dir, [...PROBE_ARGS, `json2=${out}`]), {
      stdout: "ignore",
      stderr: "pipe",
      cwd: work,
      timeout: PROBE_TIMEOUT_MS,
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0)
      throw new Error(`simc exited with code ${code}: ${stderr.trim().slice(0, 500)}`);
    let report: unknown;
    try {
      report = JSON.parse(await readFile(out, "utf8"));
    } catch {
      throw new Error("simc produced no readable json2 report");
    }
    return readBuildInfo(report);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
