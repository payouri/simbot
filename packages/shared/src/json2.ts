import { z } from "zod";

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
export type QuickSimJson2 = z.infer<typeof quickSimJson2Schema>;

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
 * profilesets, `profilesets.results[]`. Each result carries its error either as `mean_error`
 * (what SimC writes) or as `stddev` and `iterations`, from which it is derived.
 */
export const stageJson2Schema = quickSimJson2Schema.extend({
  sim: quickSimJson2Schema.shape.sim.extend({
    profilesets: z
      .object({
        results: z.array(
          z.object({
            name: z.string(),
            mean: z.number(),
            mean_error: z.number().nonnegative().optional(),
            stddev: z.number().nonnegative().optional(),
            iterations: z.number().positive().optional(),
          }),
        ),
      })
      .optional(),
  }),
});
export type StageJson2 = z.infer<typeof stageJson2Schema>;
