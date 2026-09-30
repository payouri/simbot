import type { DpsSummary, Precision, SimError, SimSettings } from "@simbot/shared";
import { stripPtrOption, stripUnsafeOptions } from "./addon-string";
import { baselineDps, quickSimJson2Schema, readJson2 } from "./json2";

/** Final-Stage `target_error` (percent of DPS) per precision preset. */
export const PRECISION_TARGET_ERROR: Readonly<Record<Precision, number>> = {
  low: 0.5,
  medium: 0.2,
  high: 0.1,
};

/**
 * How often SimC checks if it has reached the target error (every N iterations).
 * Measured: SimC stops only at a check, so a larger interval overshoots. At intervals 100 to 400
 * every profileset of a 1% Stage ran exactly the interval plus one, where about 40 iterations
 * reach 1% (`apps/server/bench/results/2026-09-30T11-50-49-078Z.json`, SimC
 * 1210-2026-09-29-d08a1c3).
 * Chosen from `2026-09-30T15-23-13-858Z.json` (SimC 1210-2026-09-30-613b5fb, 16-thread AMD Ryzen 7
 * 7735HS, Medium, `profileset_work_threads=1`, 3 repeats, two gear sets: the import-items
 * fixture's Frost Death Knight and `bench/sets/gulthrak-fury.txt`, 4, 8 and 12 items each).
 * Summed median wall time over the six cases: 128.4 s at 5, 132.4 s at 10, 138.6 s at 50,
 * 139.1 s at 25. On the 12-item cases (972 and 973 Combinations), 5 against 50: 42.9 s
 * (41.6 to 43.0) against 48.6 s (46.9 to 49.7), and 38.8 s (38.0 to 38.8) against 43.7 s (43.3 to
 * 44.3), no overlap between repeats. On the 4- and 8-item cases 50 was up to 0.6 s faster. The
 * error reached costs nothing: every final Stage at every interval ended at the 0.2% target
 * (worst profileset 0.200%; median profileset 0.196% to 0.199% at 50, 0.1996% to 0.1999% at 5).
 * Nothing below 5 was swept. One machine.
 */
export const ANALYZE_ERROR_INTERVAL = 5;

/**
 * The SimC input for a Quick Sim: the Addon String unchanged, then the frozen Sim Settings as
 * option lines, then the user's raw options (which may override the generated ones). A Smart
 * Sim Stage passes its own `targetError` and `extraLines`, which sit before the raw options.
 */
export function buildInput(
  addonString: string,
  settings: SimSettings,
  options: { targetError?: number; extraLines?: readonly string[] } = {},
): string {
  const lines = [
    "",
    "# simbot Sim Settings",
    `fight_style=${settings.fightStyle}`,
    `max_time=${settings.durationSeconds}`,
    `desired_targets=${settings.targets}`,
    `target_error=${options.targetError ?? PRECISION_TARGET_ERROR[settings.precision]}`,
    `analyze_error_interval=${ANALYZE_ERROR_INTERVAL}`,
    // Live is SimC's default and is never spelled out; only a PTR Sim selects the PTR data.
    ...(settings.gameData === "ptr" ? ["ptr=1"] : []),
    ...(options.extraLines ?? []),
  ];
  if (settings.rawOptions.trim() !== "") lines.push("# Raw options", settings.rawOptions);
  const safe = stripPtrOption(stripUnsafeOptions(addonString));
  const head = safe.endsWith("\n") ? safe : `${safe}\n`;
  return `${head}${lines.join("\n")}\n`;
}

/**
 * SimC arguments for one Stage. They come after the input file, so they win over anything
 * the input (including raw options) says about where output goes.
 */
export function stageArgs(inputPath: string, json2Path: string): string[] {
  return [inputPath, "progressbar_type=1", "output=/dev/null", `json2=${json2Path}`];
}

/**
 * Reads the Quick Sim result out of json2 text (`null` when SimC wrote no file). Mean error is
 * `mean_std_dev × confidence_estimator`. Throws `Json2FormatError` for anything unexpected.
 */
export function readQuickSimResult(text: string | null): { dps: DpsSummary } {
  return { dps: baselineDps(readJson2(text, quickSimJson2Schema).sim).summary };
}

const STDERR_KEEP = 2000;

/** Turns a non-zero (or signalled) SimC exit into a Sim error carrying the code and stderr. */
export function classifyExit(exitCode: number | null, stderr: string): SimError {
  const tail = stderr.trim().slice(-STDERR_KEEP);
  const lines = tail.split("\n").map((l) => l.trim());
  const reason = [...lines].reverse().find((l) => /^error:/i.test(l)) ?? lines.at(-1) ?? "";
  const what = exitCode === null ? "SimC was killed" : `SimC exited with code ${exitCode}`;
  return {
    kind: "simc_exit",
    message: reason ? `${what}: ${reason}` : what,
    exitCode,
    stderr: tail,
  };
}
