import { z } from "zod";
import { characterSnapshotSchema, gameDataSchema, simKindSchema } from "./sim";
import { simcJobStatusSchema, simcJobTargetSchema, simcUpdateStepSchema } from "./simc";

/** A Sim Job in the Queue: the running one, or one waiting its turn. */
export const simQueueEntrySchema = z.object({
  type: z.literal("sim"),
  jobId: z.number().int(),
  simId: z.number().int(),
  kind: simKindSchema,
  gameData: gameDataSchema.default("live"),
  status: z.enum(["queued", "running"]),
  character: characterSnapshotSchema,
  queuedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
});
export type SimQueueEntry = z.infer<typeof simQueueEntrySchema>;

/** A SimC Update Job in the Queue. It holds the Queue while it runs, like a Sim. */
export const simcUpdateQueueEntrySchema = z.object({
  type: z.literal("simc_update"),
  jobId: z.number().int(),
  status: z.enum(["queued", "running"]),
  target: simcJobTargetSchema,
  /** The step running now; null while the Job waits, or before its first step. */
  step: simcUpdateStepSchema.nullable(),
  /** The tag the target resolved to, once the Job has started. */
  tag: z.string().nullable(),
  queuedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
});
export type SimcUpdateQueueEntry = z.infer<typeof simcUpdateQueueEntrySchema>;

/** One Job in the Queue: a Sim or a SimC Update. */
export const queueEntrySchema = z.discriminatedUnion("type", [
  simQueueEntrySchema,
  simcUpdateQueueEntrySchema,
]);
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

/** A Stage began: how many Stages the ladder has, how many Combinations entered, its target. */
export const simStageStartedEventSchema = z.object({
  type: z.literal("sim.stage_started"),
  simId: z.number().int(),
  stage: z.number().int(),
  /** Stages in the ladder (the last one is at the precision the user picked). */
  stages: z.number().int(),
  /** Combinations in the Stage, the baseline included. */
  entered: z.number().int(),
  /** The `target_error` the Stage runs to, percent of DPS. */
  targetErrorPct: z.number(),
});

export const simProgressEventSchema = simProgressSchema.extend({
  type: z.literal("sim.progress"),
});

/** A Stage finished and its Stage Results are stored; clients refetch over REST. */
export const simStageFinishedEventSchema = z.object({
  type: z.literal("sim.stage_finished"),
  simId: z.number().int(),
  stage: z.number().int(),
  /** Combinations kept for the next Stage (all that finished, on the last Stage). */
  survivors: z.number().int(),
  /** Combinations Culled by this Stage. */
  culled: z.number().int(),
  /** Combinations SimC refused during this Stage and that were dropped. */
  invalid: z.number().int(),
});

export const simFinishedEventSchema = z.object({
  type: z.literal("sim.finished"),
  simId: z.number().int(),
  status: z.enum(["succeeded", "failed", "cancelled"]),
});

/** A Sim was Discarded: its results are gone and it is a Draft again. */
export const simDiscardedEventSchema = z.object({
  type: z.literal("sim.discarded"),
  simId: z.number().int(),
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
  simDiscardedEventSchema,
  simLogEventSchema,
  simcStatusChangedEventSchema,
  simcUpdateStatusEventSchema,
]);
export type AppEvent = z.infer<typeof appEventSchema>;
export type SnapshotEvent = z.infer<typeof snapshotEventSchema>;
