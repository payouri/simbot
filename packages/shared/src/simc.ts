import { z } from "zod";

/** What a SimC Build reports about itself (read from json2 when it is installed). */
export const simcBuildInfoSchema = z.object({
  /** SimC's own version number, e.g. `1210-01`. Distinct from the tag. */
  simcVersion: z.string().min(1),
  /** Short commit SHA the build was made from. */
  gitRevision: z.string().min(1),
  gitBranch: z.string().min(1),
  /** The WoW client build the game data matches, e.g. `12.1.0.69933`. */
  gameDataVersion: z.string().min(1),
});
export type SimcBuildInfo = z.infer<typeof simcBuildInfoSchema>;

/** An installed SimC Build: its nightly tag plus what it reports about itself. */
export const simcBuildSchema = simcBuildInfoSchema.extend({
  tag: z.string().min(1),
});
export type SimcBuild = z.infer<typeof simcBuildSchema>;

/** Progress of the boot-time fetch of the latest nightly. */
export const simcInstallStateSchema = z.object({
  state: z.enum(["idle", "installing", "failed"]),
  error: z.string().nullable(),
});
export type SimcInstallState = z.infer<typeof simcInstallStateSchema>;

/** `GET /api/simc`. `current` is null until a SimC Build is installed. */
export const simcStatusResponseSchema = z.object({
  current: simcBuildSchema.nullable(),
  install: simcInstallStateSchema,
});
export type SimcStatusResponse = z.infer<typeof simcStatusResponseSchema>;
