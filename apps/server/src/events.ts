import type { AppEvent as ClientEvent, SimStatus } from "@simbot/shared";

export type AppEvent =
  /** The Queue gained a Job; the runner wakes up. */
  | { type: "queue.changed" }
  /** A Sim moved to a new status. */
  | { type: "sim.status"; simId: number; status: SimStatus }
  /** Events the global `GET /api/events` SSE stream carries, per the shared schema. */
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
