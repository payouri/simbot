import { z } from "zod";

/** Only the json2 fields we read; everything else in the report is ignored. */
const json2Schema = z.object({
  version: z.string().min(1),
  git_revision: z.string().min(1),
  git_branch: z.string().min(1),
  sim: z.object({
    options: z.object({
      dbc: z.object({ version_used: z.string() }).catchall(z.unknown()),
    }),
  }),
});

const gameVersionSchema = z.object({ wow_version: z.string().min(1) });

export type Json2BuildInfo = {
  simcVersion: string;
  gitRevision: string;
  gitBranch: string;
  gameDataVersion: string;
};

export class Json2FormatError extends Error {
  constructor(detail: string) {
    super(`SimC output format changed: ${detail}`);
    this.name = "Json2FormatError";
  }
}

/** Reads the build identity out of a json2 report. */
export function readBuildInfo(json2: unknown): Json2BuildInfo {
  const parsed = json2Schema.safeParse(json2);
  if (!parsed.success) throw new Json2FormatError(parsed.error.issues[0]?.message ?? "invalid");
  const { dbc } = parsed.data.sim.options;
  const game = gameVersionSchema.safeParse(dbc[dbc.version_used]);
  if (!game.success) throw new Json2FormatError(`no game data for "${dbc.version_used}"`);
  return {
    simcVersion: parsed.data.version,
    gitRevision: parsed.data.git_revision,
    gitBranch: parsed.data.git_branch,
    gameDataVersion: game.data.wow_version,
  };
}
