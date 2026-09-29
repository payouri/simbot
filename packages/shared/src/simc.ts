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

/** One commit on SimC's active branch between the Current SimC Build and its head. */
export const simcCommitSchema = z.object({
  sha: z.string().min(1),
  /** First line of the commit message. */
  title: z.string(),
  /** Full commit message. */
  message: z.string(),
  url: z.string(),
});
export type SimcCommit = z.infer<typeof simcCommitSchema>;

/** The newest SimC Build that could be installed, and where it comes from. */
export const simcUpdateTargetSchema = z.object({
  /** `nightly` is the newest Docker Hub tag; `seed` is the Seed SimC Build shipped in the app. */
  source: z.enum(["nightly", "seed"]),
  tag: z.string().min(1),
});
export type SimcUpdateTarget = z.infer<typeof simcUpdateTargetSchema>;

/**
 * The stored result of the last SimC Update check.
 * - `up_to_date`: nothing newer upstream and no newer build.
 * - `commits_ahead`: the branch moved on but no newer build exists yet.
 * - `installable`: a newer nightly or Seed SimC Build exists (only the newest is offered).
 */
export const simcUpdateStatusSchema = z.object({
  state: z.enum(["up_to_date", "commits_ahead", "installable"]),
  /** ISO time the check ran (also set when it failed, so a failure is not retried at once). */
  checkedAt: z.string(),
  /** Set when the last check failed; the other fields then hold the previous result. */
  error: z.string().nullable(),
  /** Tag of the Current SimC Build the check compared from. */
  currentTag: z.string().min(1),
  branch: z.string().nullable(),
  aheadBy: z.number().int().nonnegative(),
  /** Commit messages between the Current SimC Build and the branch head, oldest first. */
  commits: z.array(simcCommitSchema),
  compareUrl: z.string().nullable(),
  target: simcUpdateTargetSchema.nullable(),
});
export type SimcUpdateStatus = z.infer<typeof simcUpdateStatusSchema>;

/** `GET /api/simc`. `current` is null until a SimC Build is installed. */
export const simcStatusResponseSchema = z.object({
  current: simcBuildSchema.nullable(),
  install: simcInstallStateSchema,
  /** The stored result of the last update check; null before the first one or with no build. */
  update: simcUpdateStatusSchema.nullable(),
});
export type SimcStatusResponse = z.infer<typeof simcStatusResponseSchema>;
