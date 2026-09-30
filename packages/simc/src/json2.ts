import type { DpsSummary } from "@simbot/shared";
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

/**
 * The slice of a SimC json2 report a Quick Sim reads. Everything else in the report is
 * ignored, so only a change to these fields counts as "SimC output format changed".
 */
export const quickSimJson2Schema = z.object({
  sim: z.object({
    options: z.object({ confidence_estimator: z.number().positive() }),
    players: z
      .array(
        z.object({
          collected_data: z.object({
            dps: z.object({
              mean: z.number(),
              mean_std_dev: z.number().nonnegative(),
              /** Spread of one iteration; with `mean_std_dev` it gives the iteration count. */
              std_dev: z.number().nonnegative().optional(),
            }),
          }),
        }),
      )
      .min(1),
  }),
});

/**
 * The Check Sim report: the Quick Sim slice plus the one profileset it ran. A build whose json2
 * lacks profileset results (or names them differently) is rejected.
 */
export const checkSimJson2Schema = quickSimJson2Schema.extend({
  sim: quickSimJson2Schema.shape.sim.extend({
    profilesets: z.object({
      results: z.array(z.object({ name: z.string(), mean: z.number() })).min(1),
    }),
  }),
});

/**
 * The slice of a Smart Sim Stage report: the Quick Sim slice plus, when the Stage ran
 * profilesets, `profilesets.results[]`. Each result carries its `mean_error` and `iterations` (recorded from
 * SimC `1210-2026-09-29-d08a1c3`; see `fixtures/top-gear/`).
 */
export const stageJson2Schema = quickSimJson2Schema.extend({
  sim: quickSimJson2Schema.shape.sim.extend({
    profilesets: z
      .object({
        results: z.array(
          z.object({
            name: z.string(),
            mean: z.number(),
            mean_error: z.number().nonnegative(),
            iterations: z.number().positive().optional(),
          }),
        ),
      })
      .optional(),
  }),
});

/**
 * Parses json2 text (`null` when SimC wrote no file) against `schema`. Throws `Json2FormatError`
 * for a missing file, invalid JSON or a report that does not fit the schema.
 */
export function readJson2<T extends z.ZodType>(text: string | null, schema: T): z.infer<T> {
  if (text === null) throw new Json2FormatError("no json2 report was written");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Json2FormatError("json2 report is not valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Json2FormatError(`${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

/** The base actor's DPS: mean error is `mean_std_dev × confidence_estimator`. */
export function baselineDps(sim: z.infer<typeof quickSimJson2Schema>["sim"]): {
  summary: DpsSummary;
  /** Spread of one iteration, when the report has `std_dev`. */
  stdDev: number | undefined;
  meanStdDev: number;
} {
  const dps = sim.players[0]?.collected_data.dps;
  if (!dps) throw new Json2FormatError("no player in report");
  return {
    summary: { mean: dps.mean, meanError: dps.mean_std_dev * sim.options.confidence_estimator },
    stdDev: dps.std_dev,
    meanStdDev: dps.mean_std_dev,
  };
}
