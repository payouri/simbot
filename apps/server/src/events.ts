import type { AppEvent as ClientEvent, SimStatus } from "@simbot/shared";

export type AppEvent =
  /** A Sim moved to a new status. */
  | { type: "sim.status"; simId: number; status: SimStatus }
  /** Stop or Discard was asked for a running Sim; the runner signals its SimC. */
  | { type: "sim.stop_requested"; simId: number }
  /** Events the global `GET /api/events` SSE stream carries, per the shared schema. `queue.changed` also wakes the runner. */
  | ClientEvent;

/**
 * In-process event emitter. `http` and `runner` meet only through the DB and this bus, so
 * the runner can later move into its own process with a different transport behind it.
 */
export function createEventBus() {
  const listeners = new Set<(event: AppEvent) => void>();
  return {
    emit(event: AppEvent) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (err) {
          console.error("event listener failed", err);
        }
      }
    },
    /** Returns an unsubscribe function. */
    on(listener: (event: AppEvent) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
