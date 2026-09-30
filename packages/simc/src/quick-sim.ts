import type { DpsSummary, Precision, SimError, SimSettings } from "@simbot/shared";
import { stripUnsafeOptions } from "./addon-string";
import { baselineDps, quickSimJson2Schema, readJson2 } from "./json2";

/** Final-Stage `target_error` (percent of DPS) per precision preset. */
export const PRECISION_TARGET_ERROR: Readonly<Record<Precision, number>> = {
  low: 0.5,
  medium: 0.2,
  high: 0.1,
};

/**
 * How often SimC checks if it has reached the target error (every N iterations).
 * Measured: going by its later Stages' iterations × error² (about 40), this gear set needs about
 * 40 iterations for 1% error, yet at intervals 100 to 400 every profileset of a 1% Stage ran exactly the interval plus one, and at 50 they ran 51 or 101
 * (51.0 to 69.8 on average per Sim): SimC stops only at a check. At intervals 50 to 400
 * that Stage was 77% to 94% of a 972-Combination Sim's Stage time.
 * Summed median wall time over the 4-, 8- and 12-item cases (9, 81 and 972 Combinations),
 * `profileset_work_threads=1`, Medium, 3 repeats, SimC 1210-2026-09-29-d08a1c3 on a 16-thread
 * AMD Ryzen 7 7735HS: 266.3 s at 400, 152.9 s at 200, 92.2 s at 100, 68.1 s at 50, 64.7 s
 * and 69.5 s at 25 (two runs), 63.6 s at 10, 61.6 s at 5. Sources:
 * `apps/server/bench/results/2026-09-30T11-50-49-078Z.json` (400 to 25) and
 * `2026-09-30T12-33-34-232Z.json` (25 to 5). 50 and 25 are a tie: 50 ran 68.1 s here and
 * 69.2 s in `2026-09-30T12-47-17-748Z.json`, 25 ran 64.7 s and 69.5 s. 10 and 5 were 7% and 10%
 * faster than 50, one run each, against 7% between the two runs of 25. Smaller
 * intervals were not chosen because the benchmark records no achieved error, so it cannot show
 * what stopping earlier costs in accuracy.
 */
export const ANALYZE_ERROR_INTERVAL = 50;

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
    ...(options.extraLines ?? []),
  ];
  if (settings.rawOptions.trim() !== "") lines.push("# Raw options", settings.rawOptions);
  const safe = stripUnsafeOptions(addonString);
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
