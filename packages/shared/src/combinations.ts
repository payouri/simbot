import { z } from "zod";
import { topGearSelectionSchema } from "./paperdoll";
import { simSettingsSchema } from "./sim";

/** A Top Gear over this many Combinations (after pruning) is refused, at preview and at queue. */
export const MAX_COMBINATIONS = 50_000;

/** The default preselection stays at or under this many Combinations. */
export const PRESELECT_MAX_COMBINATIONS = 500;

/** Above this estimate the UI warns softly; it never blocks. */
export const SOFT_WARN_SECONDS = 30 * 60;

/**
 * One frozen Combination as stored on the Sim: for each SimC slot the `ImportItem.index` worn
 * there (equipped slots included), and the Talent Loadout by position in the Import's loadout
 * list (null: the talents the Addon String's profile has on).
 */
export const combinationDefinitionSchema = z.object({
  kind: z.enum(["equipped", "gear"]),
  /** Empty for the baseline of a Quick Sim, which is the Import as it is. */
  gear: z.record(z.string(), z.number().int().min(0)).default({}),
  talentLoadout: z.number().int().min(0).nullable().default(null),
});
export type CombinationDefinition = z.infer<typeof combinationDefinitionSchema>;

/** A validation problem tied to a Candidate (or to the selection as a whole). */
export const combinationIssueSchema = z.object({
  /** `topGearSelection.included.<n>` for a Candidate Item, `topGearSelection` for the whole. */
  path: z.string(),
  /** The Candidate Item's `ImportItem.index`, when the problem is one Candidate's. */
  candidate: z.number().int().nullable(),
  message: z.string(),
});
export type CombinationIssue = z.infer<typeof combinationIssueSchema>;

/**
 * `POST /api/sims/:id/preview-combinations`. The body may carry the unsaved edits of the
 * setup; what it leaves out is read from the Draft.
 */
export const previewCombinationsRequestSchema = z.object({
  topGearSelection: topGearSelectionSchema.optional(),
  settings: simSettingsSchema.partial().optional(),
});
export type PreviewCombinationsRequest = z.infer<typeof previewCombinationsRequestSchema>;

export const combinationPreviewSchema = z.object({
  /** Combinations after pruning, the baseline and every Talent Loadout included. */
  count: z.number().int(),
  /** The count stopped growing at a safety cap: the real number is at least `count`. */
  atLeast: z.boolean(),
  gearCount: z.number().int(),
  loadoutCount: z.number().int(),
  /** Estimated wall time of the whole Smart Sim; null when the count is refused. */
  estimateSeconds: z.number().nullable(),
  /** `check_sim`: measured on the Current SimC Build's last Check Sim. `default`: a stand-in. */
  estimateBasis: z.enum(["check_sim", "default"]),
  /** The estimate is above about 30 minutes. */
  softWarning: z.boolean(),
  /** More than 50,000 Combinations after pruning: the Sim cannot be queued. */
  refused: z.boolean(),
  max: z.number().int(),
  issues: z.array(combinationIssueSchema),
});
export type CombinationPreview = z.infer<typeof combinationPreviewSchema>;
