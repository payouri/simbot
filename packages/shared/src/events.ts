import { z } from "zod";

/** The stored SimC status changed (an update check finished, or the Current SimC Build changed). Clients refetch `GET /api/simc`. */
export const simcStatusChangedEventSchema = z.object({ type: z.literal("simc.status_changed") });

/** Everything the global `GET /api/events` SSE stream can carry. Grows as slices add events. */
export const appEventSchema = z.discriminatedUnion("type", [simcStatusChangedEventSchema]);
export type AppEvent = z.infer<typeof appEventSchema>;
