import { z } from "zod";

/** Life cycle of a Sim. Stop/Discard (`cancelled`, back to `draft`) arrive with the Queue slice. */
export const simStatusSchema = z.enum(["draft", "queued", "running", "succeeded", "failed"]);
export type SimStatus = z.infer<typeof simStatusSchema>;

export const simTransitions: Readonly<Record<SimStatus, readonly SimStatus[]>> = {
  draft: ["queued"],
  queued: ["running"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

export const canTransition = (from: SimStatus, to: SimStatus) => simTransitions[from].includes(to);

export const simKindSchema = z.enum(["quick"]);
export type SimKind = z.infer<typeof simKindSchema>;

export const fightStyleSchema = z.enum([
  "Patchwerk",
  "CastingPatchwerk",
  "HecticAddCleave",
  "LightMovement",
  "HeavyMovement",
  "DungeonSlice",
]);
export type FightStyle = z.infer<typeof fightStyleSchema>;

export const precisionSchema = z.enum(["low", "medium", "high"]);
export type Precision = z.infer<typeof precisionSchema>;

/** The parameters a Sim ran with. Frozen on the Sim so later default changes never alter it. */
export const simSettingsSchema = z.object({
  fightStyle: fightStyleSchema,
  durationSeconds: z.number().int().min(10).max(1800),
  targets: z.number().int().min(1).max(20),
  precision: precisionSchema,
  /** Extra SimC option lines, appended verbatim after the generated ones. */
  rawOptions: z.string().max(4000),
});
export type SimSettings = z.infer<typeof simSettingsSchema>;

export const defaultSimSettings: SimSettings = {
  fightStyle: "Patchwerk",
  durationSeconds: 300,
  targets: 1,
  precision: "medium",
  rawOptions: "",
};

/** The identity of a Character, read from an Addon String's profile header. */
export const characterSchema = z.object({
  id: z.number().int(),
  region: z.string(),
  realm: z.string(),
  name: z.string(),
  class: z.string(),
});
export type Character = z.infer<typeof characterSchema>;

/** Character-dependent traits frozen on a Sim. */
export const characterSnapshotSchema = z.object({
  name: z.string(),
  region: z.string(),
  realm: z.string(),
  class: z.string(),
  spec: z.string().nullable(),
  race: z.string().nullable(),
  level: z.number().int().nullable(),
});
export type CharacterSnapshot = z.infer<typeof characterSnapshotSchema>;

export const simErrorKindSchema = z.enum([
  "no_simc_build",
  "launch_failed",
  "simc_exit",
  "output_format_changed",
  "interrupted",
  "internal",
]);
export type SimErrorKind = z.infer<typeof simErrorKindSchema>;

/** Why a Sim failed. `exitCode`/`stderr` are set for `simc_exit`. */
export const simErrorSchema = z.object({
  kind: simErrorKindSchema,
  message: z.string(),
  exitCode: z.number().int().nullable().optional(),
  stderr: z.string().optional(),
});
export type SimError = z.infer<typeof simErrorSchema>;

const isoDate = z.string();

export const simSchema = z.object({
  id: z.number().int(),
  kind: simKindSchema,
  status: simStatusSchema,
  importId: z.number().int(),
  characterId: z.number().int(),
  character: characterSnapshotSchema,
  settings: simSettingsSchema,
  /** The SimC Build tag, recorded when the Job starts. */
  simcTag: z.string().nullable(),
  error: simErrorSchema.nullable(),
  createdAt: isoDate,
  queuedAt: isoDate.nullable(),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
});
export type Sim = z.infer<typeof simSchema>;

/** `POST /api/sims`. Omitted settings take the defaults; a Quick Sim is the only kind for now. */
export const createSimRequestSchema = z.object({
  importId: z.number().int(),
  kind: simKindSchema.default("quick"),
  settings: simSettingsSchema.partial().optional(),
});
export type CreateSimRequest = z.input<typeof createSimRequestSchema>;

export const importSchema = z.object({
  id: z.number().int(),
  characterId: z.number().int(),
  character: characterSchema,
  checksum: z.string(),
  createdAt: isoDate,
});
export type Import = z.infer<typeof importSchema>;

/** Big enough for any real Addon String (tens of KB with bags), small enough to bound a paste. */
export const MAX_ADDON_STRING_LENGTH = 512 * 1024;

/** `POST /api/imports`. The text is stored and later fed to SimC unchanged. */
export const createImportRequestSchema = z.object({
  text: z.string().min(1).max(MAX_ADDON_STRING_LENGTH),
});
export type CreateImportRequest = z.infer<typeof createImportRequestSchema>;

/** DPS mean with its error: `mean_std_dev × confidence_estimator`. */
export const dpsSummarySchema = z.object({ mean: z.number(), meanError: z.number() });
export type DpsSummary = z.infer<typeof dpsSummarySchema>;

export const stageResultSchema = z.object({
  combinationId: z.number().int(),
  isBaseline: z.boolean(),
  stage: z.number().int(),
  dps: dpsSummarySchema,
  survived: z.boolean(),
});
export type StageResult = z.infer<typeof stageResultSchema>;

/** `GET /api/sims/:id/results`, only once the Sim has succeeded. */
export const simResultsResponseSchema = z.object({
  simId: z.number().int(),
  simcTag: z.string().nullable(),
  results: z.array(stageResultSchema),
});
export type SimResultsResponse = z.infer<typeof simResultsResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
