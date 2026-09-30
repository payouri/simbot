import { checkSimJson2Schema, type DpsSummary } from "@simbot/shared";
import { Json2FormatError } from "./json2";

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
 * error rule as a Quick Sim. Throws `Json2FormatError` unless the whole report fits the schema,
 * including the profileset result.
 */
export function readCheckSimResult(text: string | null): { dps: DpsSummary } {
  if (text === null) throw new Json2FormatError("no json2 report was written");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Json2FormatError("json2 report is not valid JSON");
  }
  const parsed = checkSimJson2Schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Json2FormatError(`${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}`);
  }
  const { sim } = parsed.data;
  if (!sim.profilesets.results.some((r) => r.name === CHECK_SIM_PROFILESET)) {
    throw new Json2FormatError(`profileset "${CHECK_SIM_PROFILESET}" missing from the report`);
  }
  const dps = sim.players[0]?.collected_data.dps;
  if (!dps) throw new Json2FormatError("no player in report");
  return {
    dps: { mean: dps.mean, meanError: dps.mean_std_dev * sim.options.confidence_estimator },
  };
}
