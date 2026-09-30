import { z } from "zod";
import { topGearSelectionSchema } from "./paperdoll";

/**
 * Life cycle of a Sim. Stop ends a running Sim as `cancelled`; Discard sends a queued or running
 * one back to `draft`; a Sim interrupted by a crash goes back to `queued`.
 */
export const simStatusSchema = z.enum([
  "draft",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type SimStatus = z.infer<typeof simStatusSchema>;

export const simTransitions: Readonly<Record<SimStatus, readonly SimStatus[]>> = {
  draft: ["queued"],
  queued: ["running", "draft"],
  running: ["succeeded", "failed", "cancelled", "draft", "queued"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export const canTransition = (from: SimStatus, to: SimStatus) => simTransitions[from].includes(to);

export const simKindSchema = z.enum(["quick", "top_gear"]);
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

const characterField = z.string().trim().min(1).max(100);

/** `PATCH /api/characters/:id`. Any subset of the identity fields; at least one. */
export const updateCharacterRequestSchema = z
  .object({
    region: characterField,
    realm: characterField,
    name: characterField,
    class: characterField,
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Give at least one of region, realm, name, class.",
  });
export type UpdateCharacterRequest = z.infer<typeof updateCharacterRequestSchema>;

/** `POST /api/characters/:id/merge`. Moves this Character's Imports and Sims into `targetId`. */
export const mergeCharacterRequestSchema = z.object({ targetId: z.number().int() });
export type MergeCharacterRequest = z.infer<typeof mergeCharacterRequestSchema>;

/** `GET /api/characters`: each Character with how many Imports and Sims it groups. */
export const characterListItemSchema = characterSchema.extend({
  importCount: z.number().int(),
  simCount: z.number().int(),
});
export type CharacterListItem = z.infer<typeof characterListItemSchema>;
export const characterListResponseSchema = z.array(characterListItemSchema);
export type CharacterListResponse = z.infer<typeof characterListResponseSchema>;

/** 409 from an edit whose identity is already another Character: the UI offers a merge. */
export const characterConflictSchema = z.object({
  error: z.literal("character_conflict"),
  message: z.string().optional(),
  conflictingCharacter: characterSchema,
});
export type CharacterConflict = z.infer<typeof characterConflictSchema>;

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
  /** The setup a Draft autosaves; null only for a Sim created before the setup existed. */
  topGearSelection: topGearSelectionSchema.nullable(),
  /** The SimC Build tag, recorded when the Job starts. */
  simcTag: z.string().nullable(),
  error: simErrorSchema.nullable(),
  createdAt: isoDate,
  queuedAt: isoDate.nullable(),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
});
export type Sim = z.infer<typeof simSchema>;

/**
 * `POST /api/sims`: a Draft from an Import (`importId`) or as a copy of another Sim's input
 * (`copyFromSimId`); exactly one. Omitted settings take the defaults (a copy: the source's).
 * `kind` defaults to a Quick Sim for an Import and to the source's kind for a copy.
 */
export const createSimRequestSchema = z
  .object({
    importId: z.number().int().optional(),
    copyFromSimId: z.number().int().optional(),
    kind: simKindSchema.optional(),
    settings: simSettingsSchema.partial().optional(),
  })
  .refine((v) => (v.importId === undefined) !== (v.copyFromSimId === undefined), {
    message: "Give exactly one of importId, copyFromSimId.",
  });
export type CreateSimRequest = z.input<typeof createSimRequestSchema>;

/**
 * `PATCH /api/sims/:id`. `characterId` moves the Sim to another Character (its Character
 * Snapshot is untouched) and works in any state. `settings` (any subset) and `topGearSelection`
 * (replaced whole) change the input, which only a Draft allows.
 */
export const patchSimRequestSchema = z
  .object({
    characterId: z.number().int(),
    settings: simSettingsSchema.partial(),
    topGearSelection: topGearSelectionSchema,
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Give at least one of characterId, settings, topGearSelection.",
  });
export type PatchSimRequest = z.infer<typeof patchSimRequestSchema>;

/**
 * `POST /api/sims/:id/stop`. `keep: true` is Stop (a running Sim becomes `cancelled`, keeping
 * what it finished); `keep: false` is Discard (results and folder are deleted, back to `draft`).
 */
export const stopSimRequestSchema = z.object({ keep: z.boolean() });
export type StopSimRequest = z.infer<typeof stopSimRequestSchema>;

/** `POST /api/sims/:id/copy-to-draft`. Copies a Sim's input into a new Draft. */
export const copySimToDraftRequestSchema = z.object({});
export type CopySimToDraftRequest = z.infer<typeof copySimToDraftRequestSchema>;

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

export const simListItemSchema = z.object({
  id: z.number().int(),
  kind: simKindSchema,
  status: simStatusSchema,
  characterId: z.number().int(),
  character: characterSnapshotSchema,
  simcTag: z.string().nullable(),
  createdAt: isoDate,
  finishedAt: isoDate.nullable(),
});
export type SimListItem = z.infer<typeof simListItemSchema>;

export const simListResponseSchema = z.array(simListItemSchema);
export type SimListResponse = z.infer<typeof simListResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
