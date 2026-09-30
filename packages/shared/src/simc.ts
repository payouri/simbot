import { z } from "zod";

/** What a SimC Build reports about itself (read from json2 when it is installed). */
export const simcBuildInfoSchema = z.object({
  /** SimC's own version number, e.g. `1210-01`. Distinct from the tag. */
  simcVersion: z.string().min(1),
  /** Short commit SHA the build was made from. */
  gitRevision: z.string().min(1),
  gitBranch: z.string().min(1),
  /** The WoW client build the Live game data matches, e.g. `12.1.0.69933`. */
  gameDataVersion: z.string().min(1),
  /**
   * The WoW client build the PTR game data matches, e.g. `12.1.5.69952`. Null when the build
   * carries none, and for a build probed before PTR versions were recorded (it counts as having
   * no PTR available until it is installed again).
   */
  ptrGameDataVersion: z.string().min(1).nullable().default(null),
});
export type SimcBuildInfo = z.infer<typeof simcBuildInfoSchema>;

/** An installed SimC Build: its nightly tag plus what it reports about itself. */
export const simcBuildSchema = simcBuildInfoSchema.extend({
  tag: z.string().min(1),
  /**
   * Why the PTR pass of this build's Check Sim failed, e.g. a non-zero exit; null when it passed
   * or never ran. Recorded against the tag, apart from the Live Check Sim, and never a reason to reject the build: only PTR is unavailable on it.
   */
  ptrCheckError: z.string().min(1).nullable().optional(),
});
export type SimcBuild = z.infer<typeof simcBuildSchema>;

/**
 * Whether a build has a PTR to sim on: its PTR game data differs from Live and its PTR Check Sim
 * pass did not fail.
 */
export const ptrAvailable = (
  b: Pick<SimcBuildInfo, "gameDataVersion" | "ptrGameDataVersion"> & {
    ptrCheckError?: string | null;
  },
) =>
  b.ptrGameDataVersion !== null && b.ptrGameDataVersion !== b.gameDataVersion && !b.ptrCheckError;

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
 * - `error`: the check failed and there was no earlier result to keep; `error` says why.
 */
export const simcUpdateStatusSchema = z.object({
  state: z.enum(["up_to_date", "commits_ahead", "installable", "error"]),
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
  /**
   * Set only while PTR Sims are on and both builds' PTR versions are known: the offered target
   * changes the PTR game data from `from` to `to` or, with no target, the SimC Update that made
   * the current build current did. Computed when the status is read, never stored (so absent on a
   * stored check).
   */
  ptrChange: z
    .object({ from: z.string().min(1), to: z.string().min(1) })
    .nullable()
    .optional(),
});
export type SimcUpdateStatus = z.infer<typeof simcUpdateStatusSchema>;

/** What a `simc_update` Job applies. Resolved to a tag when the Job starts, not when it is queued. */
export const simcJobTargetSchema = z.discriminatedUnion("kind", [
  /** The newest Docker Hub nightly at Job start. */
  z.object({ kind: z.literal("nightly") }),
  /** The Seed SimC Build shipped with the app. */
  z.object({ kind: z.literal("seed") }),
  /** A SimC Build that is already installed: switching to it pins it. */
  z.object({ kind: z.literal("installed"), tag: z.string().min(1) }),
]);
export type SimcJobTarget = z.infer<typeof simcJobTargetSchema>;

/** The steps of a SimC Update, in order. */
export const simcUpdateStepSchema = z.enum(["fetch", "check", "meta", "commit"]);
export type SimcUpdateStep = z.infer<typeof simcUpdateStepSchema>;

export const simcJobStatusSchema = z.enum(["queued", "running", "done", "failed"]);
export type SimcJobStatus = z.infer<typeof simcJobStatusSchema>;

/** A `simc_update` Job. `step` is the step running now, or the one that failed. */
export const simcJobSchema = z.object({
  id: z.number().int(),
  target: simcJobTargetSchema,
  status: simcJobStatusSchema,
  step: simcUpdateStepSchema.nullable(),
  /** The tag the target resolved to, once the Job has started. */
  tag: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type SimcJob = z.infer<typeof simcJobSchema>;

/** `POST /api/simc/jobs`. */
export const queueSimcJobRequestSchema = z.object({ target: simcJobTargetSchema });
export type QueueSimcJobRequest = z.infer<typeof queueSimcJobRequestSchema>;

export const MAX_KEEP_BUILDS = 20;
export const DEFAULT_KEEP_BUILDS = 3;

/** `PATCH /api/simc/settings`. */
export const simcSettingsRequestSchema = z
  .object({
    /** How many SimC Builds to keep installed (the current one and any in use always stay). */
    keep: z.number().int().min(1).max(MAX_KEEP_BUILDS).optional(),
    /** Turns PTR Sims on or off (`simc.ptr_enabled`). */
    ptrEnabled: z.boolean().optional(),
  })
  .refine((s) => s.keep !== undefined || s.ptrEnabled !== undefined, {
    message: "Send at least one setting.",
  });
export type SimcSettingsRequest = z.infer<typeof simcSettingsRequestSchema>;

const checkSimDpsSchema = z.object({ mean: z.number(), meanError: z.number() });

/** The Check Sim result stored for the Current SimC Build, and the previous build's when both exist. */
export const simcCheckSimSchema = z.object({
  tag: z.string().min(1),
  importId: z.number().int(),
  dps: checkSimDpsSchema,
  previous: z.object({ tag: z.string().min(1), dps: checkSimDpsSchema }).nullable(),
});
export type SimcCheckSim = z.infer<typeof simcCheckSimSchema>;

/** `GET /api/simc`. `current` is null until a SimC Build is installed. */
export const simcStatusResponseSchema = z.object({
  current: simcBuildSchema.nullable(),
  install: simcInstallStateSchema,
  /** The stored result of the last update check; null before the first one or with no build. */
  update: simcUpdateStatusSchema.nullable(),
  /** Every installed SimC Build, newest first. */
  installed: z.array(simcBuildSchema),
  /** How many builds retention keeps. */
  keep: z.number().int().min(1),
  /**
   * Whether PTR Sims are on. The builds carry their real PTR version and Check Sim failure either
   * way, so a PTR Draft copied while off is judged on the facts; the client shows them only while
   * on. While off the update offer has no `ptrChange`.
   */
  ptrEnabled: z.boolean(),
  /** The latest SimC Update Job while it is queued, running or failed; null once it is done. */
  job: simcJobSchema.nullable(),
  /** The Check Sim DPS of the Current SimC Build and, when both exist, of the build before it. */
  checkSim: simcCheckSimSchema.nullable(),
  /**
   * Why the Current SimC Build has no item-meta and item-icons, when building them failed; null
   * when they exist or nothing has failed. Without them an Import's items show up unresolved.
   */
  itemMetaError: z.string().nullable(),
});
export type SimcStatusResponse = z.infer<typeof simcStatusResponseSchema>;
