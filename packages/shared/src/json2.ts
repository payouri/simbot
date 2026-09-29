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
            dps: z.object({ mean: z.number(), mean_std_dev: z.number().nonnegative() }),
          }),
        }),
      )
      .min(1),
  }),
});
export type QuickSimJson2 = z.infer<typeof quickSimJson2Schema>;
