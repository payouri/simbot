import { z } from "zod";
import { importItemSchema } from "./items";
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

/** Which game data inside a SimC Build a Sim runs on: Live, or the PTR's (`ptr=1`). */
export const gameDataSchema = z.enum(["live", "ptr"]);
export type GameData = z.infer<typeof gameDataSchema>;

/**
 * Whether raw SimC options set `ptr`. Game Data owns that option, so a line for it is refused:
 * raw options and Game Data could otherwise disagree.
 */
export const hasPtrOption = (rawOptions: string) => /(^|\s)ptr\s*=/i.test(rawOptions);

const simSettingsFields = {
  fightStyle: fightStyleSchema,
  durationSeconds: z.number().int().min(10).max(1800),
  targets: z.number().int().min(1).max(20),
  precision: precisionSchema,
  gameData: gameDataSchema,
  /** Extra SimC option lines, appended verbatim after the generated ones. */
  rawOptions: z.string().max(4000),
};

/**
 * The parameters a Sim ran with, as stored and served. Frozen on the Sim so later default changes
 * never alter it. `gameData` is `live` when absent, which is how Sims stored before it existed read.
 */
export const simSettingsSchema = z.object({
  ...simSettingsFields,
  gameData: gameDataSchema.default("live"),
});
export type SimSettings = z.infer<typeof simSettingsSchema>;

/**
 * Sim Settings as a request sends them: any subset, nothing defaulted (an omitted field keeps
 * the Draft's value), and no `ptr=` line in the raw options.
 */
export const simSettingsPatchSchema = z
  .object({
    ...simSettingsFields,
    rawOptions: simSettingsFields.rawOptions.refine((v) => !hasPtrOption(v), {
      message: "Raw options cannot set ptr. Pick the Game Data instead.",
    }),
  })
  .partial();
export type SimSettingsPatch = z.infer<typeof simSettingsPatchSchema>;

export const defaultSimSettings: SimSettings = {
  fightStyle: "Patchwerk",
  durationSeconds: 300,
  targets: 1,
  precision: "medium",
  gameData: "live",
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
  "invalid_combinations",
  "ptr_unavailable",
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
  /** The Import's `ptrClient` flag, so a Sim can carry the notice without a second fetch. */
  importPtrClient: z.boolean().default(false),
  characterId: z.number().int(),
  character: characterSnapshotSchema,
  settings: simSettingsSchema,
  /** The setup a Draft autosaves; null only for a Sim created before the setup existed. */
  topGearSelection: topGearSelectionSchema.nullable(),
  /** The SimC Build tag, recorded when the Job starts. */
  simcTag: z.string().nullable(),
  /**
   * The game data version the Sim ran on (the Live or the PTR one of that build, by its Game
   * Data), recorded with `simcTag` when the Job starts. Null until then.
   */
  gameDataVersion: z.string().nullable().default(null),
  error: simErrorSchema.nullable(),
  createdAt: isoDate,
  queuedAt: isoDate.nullable(),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
});
export type Sim = z.infer<typeof simSchema>;

/**
 * Whether a Sim is a Top Gear: its `kind`, and only that. The server keeps `kind` right as the
 * Draft is edited (a Draft saved with Candidates included is a Top Gear), so nothing else needs
 * to look at the selection to tell.
 */
export const isTopGear = (sim: Pick<Sim, "kind">) => sim.kind === "top_gear";

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
    settings: simSettingsPatchSchema.optional(),
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
    settings: simSettingsPatchSchema,
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
  /**
   * The Addon String's `# WoW` header matched the Current SimC Build's PTR version or was newer
   * than its Live version when it was imported: it was probably exported from the PTR client.
   * A hint only, it never changes Game Data.
   */
  ptrClient: z.boolean().default(false),
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

/** A frozen Combination as the results view needs it: what it wears and which Stage refused it. */
export const resultCombinationSchema = z.object({
  id: z.number().int(),
  isBaseline: z.boolean(),
  /** SimC slot -> `ImportItem.index` worn there, equipped slots included. */
  gear: z.record(z.string(), z.number().int().min(0)),
  /** Position in `talentLoadouts`; null: the talents the Addon String's profile has on. */
  talentLoadout: z.number().int().min(0).nullable(),
  /** The Stage in which SimC refused it, when it did. */
  invalidStage: z.number().int().nullable(),
});
export type ResultCombination = z.infer<typeof resultCombinationSchema>;

/**
 * `GET /api/sims/:id/results`, once the Sim has succeeded or been stopped (a stopped Sim keeps
 * what its Stages finished). Stage Results are joined with the Combinations and the Import's
 * items, so a client can dress the Paperdoll without another request.
 */
export const simResultsResponseSchema = z.object({
  simId: z.number().int(),
  simcTag: z.string().nullable(),
  /** What the Sim ran on, for the Game Data badge. */
  gameData: gameDataSchema.default("live"),
  gameDataVersion: z.string().nullable().default(null),
  status: z.enum(["succeeded", "cancelled"]),
  /** How many Stages the ladder plans; a stopped Sim may have finished fewer. */
  stageCount: z.number().int(),
  results: z.array(stageResultSchema),
  combinations: z.array(resultCombinationSchema),
  /** The Import's items (the item index joined with item-meta), empty when it has none. */
  items: z.array(importItemSchema),
  /** The Import's Talent Loadouts in the order `talentLoadout` counts them. */
  talentLoadouts: z.array(z.object({ comment: z.string().nullable(), equipped: z.boolean() })),
});
export type SimResultsResponse = z.infer<typeof simResultsResponseSchema>;

export const simListItemSchema = z.object({
  id: z.number().int(),
  kind: simKindSchema,
  status: simStatusSchema,
  characterId: z.number().int(),
  character: characterSnapshotSchema,
  simcTag: z.string().nullable(),
  gameData: gameDataSchema.default("live"),
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

/** One rung of a Sim's Stage ladder, as it stands: planned, running or done. */
export const ladderStageSchema = z.object({
  stage: z.number().int(),
  /** The `target_error` the Stage runs to, percent of DPS. */
  targetErrorPct: z.number(),
  /** Combinations that entered the Stage; null until it has finished. */
  entered: z.number().int().nullable(),
  /** Combinations kept for the next Stage; null until it has finished. */
  kept: z.number().int().nullable(),
  culled: z.number().int(),
  /** Combinations SimC refused during the Stage. */
  invalid: z.number().int(),
});
export type LadderStage = z.infer<typeof ladderStageSchema>;

/** `GET /api/sims/:id/ladder`: every planned Stage, with what the finished ones did to the field. */
export const simLadderResponseSchema = z.object({
  simId: z.number().int(),
  stages: z.array(ladderStageSchema),
});
export type SimLadderResponse = z.infer<typeof simLadderResponseSchema>;
