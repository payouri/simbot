import type { DpsSummary } from "@simbot/shared";
import { baselineDps, checkSimJson2Schema, Json2FormatError, readJson2 } from "./json2";

/** Name of the one profileset a Check Sim runs; it must come back in the report. */
export const CHECK_SIM_PROFILESET = "Check Sim";

/** The Check Sim runs to 1% `target_error`: a coarse but stable number to compare builds by. */
export const CHECK_SIM_TARGET_ERROR = 1;

/**
 * The SimC input for a Check Sim: the Addon String (or a profile from the build) unchanged, a
 * short fixed fight, the 1% target error, and one profileset override so the build's profileset
 * path is exercised too.
 */
export function buildCheckSimInput(profile: string): string {
  const head = profile.endsWith("\n") ? profile : `${profile}\n`;
  return `${head}${[
    "",
    "# simbot Check Sim",
    "fight_style=Patchwerk",
    "max_time=60",
    "desired_targets=1",
    `target_error=${CHECK_SIM_TARGET_ERROR}`,
    `profileset."${CHECK_SIM_PROFILESET}"+=gear_haste_rating=1`,
  ].join("\n")}\n`;
}

/** A player line in a SimC profile: the way to tell a character profile from a bare options file. */
const PLAYER_LINE =
  /^(warrior|paladin|hunter|rogue|priest|deathknight|shaman|mage|warlock|monk|druid|demonhunter|evoker)="?[^\n]+/m;

export const isPlayerProfile = (text: string) => PLAYER_LINE.test(text);

/**
 * Reads the Check Sim result out of json2 text (`null` when SimC wrote no file). Same DPS and
 * error rule as a Quick Sim, plus the iteration count that calibrates the time estimate. Throws `Json2FormatError` unless the whole report fits the schema,
 * including the profileset result.
 */
export function readCheckSimResult(text: string | null): {
  dps: DpsSummary;
  /** Iterations the run needed (`(std_dev / mean_std_dev)^2`), when the report has `std_dev`. */
  iterations: number | null;
} {
  const { sim } = readJson2(text, checkSimJson2Schema);
  if (!sim.profilesets.results.some((r) => r.name === CHECK_SIM_PROFILESET)) {
    throw new Json2FormatError(`profileset "${CHECK_SIM_PROFILESET}" missing from the report`);
  }
  const { summary, stdDev, meanStdDev } = baselineDps(sim);
  const iterations =
    stdDev !== undefined && meanStdDev > 0 ? Math.round((stdDev / meanStdDev) ** 2) : null;
  return { dps: summary, iterations };
}
