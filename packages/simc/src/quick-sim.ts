import {
  type DpsSummary,
  type Precision,
  quickSimJson2Schema,
  type SimError,
  type SimSettings,
} from "@simbot/shared";
import { Json2FormatError } from "./json2";

/** Final-Stage `target_error` (percent of DPS) per precision preset. */
export const PRECISION_TARGET_ERROR: Readonly<Record<Precision, number>> = {
  low: 0.5,
  medium: 0.2,
  high: 0.1,
};

/**
 * How often SimC checks if it has reached the target error (every N iterations).
 * Set to 100 based on benchmarking on a 16-thread machine: balances checking overhead
 * against convergence detection accuracy. Higher values reduce overhead but may miss
 * early convergence; lower values increase overhead with diminishing accuracy gains.
 */
export const ANALYZE_ERROR_INTERVAL = 100;

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
  const head = addonString.endsWith("\n") ? addonString : `${addonString}\n`;
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
  if (text === null) throw new Json2FormatError("no json2 report was written");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Json2FormatError("json2 report is not valid JSON");
  }
  const parsed = quickSimJson2Schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Json2FormatError(`${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}`);
  }
  const { sim } = parsed.data;
  const dps = sim.players[0]?.collected_data.dps;
  if (!dps) throw new Json2FormatError("no player in report");
  return {
    dps: { mean: dps.mean, meanError: dps.mean_std_dev * sim.options.confidence_estimator },
  };
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
