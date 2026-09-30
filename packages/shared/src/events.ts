import { z } from "zod";
import { characterSnapshotSchema, simKindSchema } from "./sim";
import { simcJobStatusSchema, simcUpdateStepSchema } from "./simc";

/** One Job in the Queue: the running one, or one waiting its turn. */
export const queueEntrySchema = z.object({
  jobId: z.number().int(),
  simId: z.number().int(),
  kind: simKindSchema,
  status: z.enum(["queued", "running"]),
  character: characterSnapshotSchema,
  queuedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
});
export type QueueEntry = z.infer<typeof queueEntrySchema>;

/** `GET /api/queue`: the running Job first, then the waiting ones in the order they will run. */
export const queueResponseSchema = z.object({ entries: z.array(queueEntrySchema) });
export type QueueResponse = z.infer<typeof queueResponseSchema>;

/**
 * Where a running Stage is. `done`/`total` count what `phase` says: iterations for the
 * baseline and for one profileset, whole profilesets for the parallel aggregate. In
 * `target_error` mode SimC's `total` is a moving estimate, so it can grow.
 */
export const simProgressSchema = z.object({
  simId: z.number().int(),
  stage: z.number().int(),
  phase: z.enum(["baseline", "profileset", "profilesets"]),
  /** The profileset's name when `phase` is `profileset`. */
  label: z.string().nullable(),
  done: z.number(),
  total: z.number(),
  /** Which pass of SimC this is (baseline first), when SimC says. */
  phaseIndex: z.number().int().nullable(),
  phaseCount: z.number().int().nullable(),
  /** Current error, percent of DPS; null when SimC is not tracking a target error. */
  errorPct: z.number().nullable(),
  /** The `target_error` the Stage is heading for, percent of DPS. */
  targetErrorPct: z.number().nullable(),
  /** SimC's own estimate of the seconds left. An estimate, not a promise. */
  etaSeconds: z.number().nullable(),
});
export type SimProgress = z.infer<typeof simProgressSchema>;

/** On connect: the Queue and, for the running Job, its last progress. Nothing is replayed. */
export const snapshotEventSchema = z.object({
  type: z.literal("snapshot"),
  queue: z.array(queueEntrySchema),
  running: z
    .object({
      simId: z.number().int(),
      /** Null until the Stage has started: SimC is still warming up. */
      stage: z.number().int().nullable(),
      /** Null until SimC prints its first progress line. */
      progress: simProgressSchema.nullable(),
    })
    .nullable(),
});

/** A Job joined, started or left the Queue. Clients refetch `GET /api/queue`. */
export const queueChangedEventSchema = z.object({ type: z.literal("queue.changed") });

export const simStageStartedEventSchema = z.object({
  type: z.literal("sim.stage_started"),
  simId: z.number().int(),
  stage: z.number().int(),
});

export const simProgressEventSchema = simProgressSchema.extend({
  type: z.literal("sim.progress"),
});

export const simStageFinishedEventSchema = z.object({
  type: z.literal("sim.stage_finished"),
  simId: z.number().int(),
  stage: z.number().int(),
});

export const simFinishedEventSchema = z.object({
  type: z.literal("sim.finished"),
  simId: z.number().int(),
  status: z.enum(["succeeded", "failed"]),
});

export const simLogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type SimLogLevel = z.infer<typeof simLogLevelSchema>;

/** A line SimC printed that is not progress. `debug` (its chatter) goes out only under the dev flag. */
export const simLogEventSchema = z.object({
  type: z.literal("sim.log"),
  simId: z.number().int(),
  level: simLogLevelSchema,
  message: z.string(),
});

/** The stored SimC status changed (an update check finished, or the Current SimC Build changed). Clients refetch `GET /api/simc`. */
export const simcStatusChangedEventSchema = z.object({ type: z.literal("simc.status_changed") });

/** A SimC Update Job moved: it started, entered a step, finished or failed. */
export const simcUpdateStatusEventSchema = z.object({
  type: z.literal("simc.update_status"),
  jobId: z.number().int(),
  status: simcJobStatusSchema,
  step: simcUpdateStepSchema.nullable(),
  tag: z.string().nullable(),
  error: z.string().nullable(),
});

/** Everything the global `GET /api/events` SSE stream can carry. */
export const appEventSchema = z.discriminatedUnion("type", [
  snapshotEventSchema,
  queueChangedEventSchema,
  simStageStartedEventSchema,
  simProgressEventSchema,
  simStageFinishedEventSchema,
  simFinishedEventSchema,
  simLogEventSchema,
  simcStatusChangedEventSchema,
  simcUpdateStatusEventSchema,
]);
export type AppEvent = z.infer<typeof appEventSchema>;
export type SnapshotEvent = z.infer<typeof snapshotEventSchema>;
