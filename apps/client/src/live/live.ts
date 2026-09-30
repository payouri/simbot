import { type AppEvent, appEventSchema, type SimProgress } from "@simbot/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { QUEUE_KEY } from "../queue/api";
import { SIMC_KEY } from "../simc/api";

export type RunningSim = {
  simId: number;
  /** Null until the Stage has started. */
  stage: number | null;
  /** Null until SimC prints its first progress line: it is still warming up. */
  progress: SimProgress | null;
};

let running: RunningSim | null = null;
const listeners = new Set<() => void>();
const setRunning = (next: RunningSim | null) => {
  running = next;
  for (const listener of listeners) listener();
};

/** Reduces one server event into the live state (the running Sim and its latest progress). */
export function applyEvent(event: AppEvent) {
  switch (event.type) {
    case "snapshot":
      setRunning(event.running);
      break;
    case "sim.stage_started":
      setRunning({ simId: event.simId, stage: event.stage, progress: null });
      break;
    case "sim.progress": {
      const { type: _, ...progress } = event;
      setRunning({ simId: event.simId, stage: event.stage, progress });
      break;
    }
    case "sim.finished":
      if (running?.simId === event.simId) setRunning(null);
      break;
  }
}

/** The running Sim's live state, or null when nothing runs (or the stream is not connected yet). */
export function useRunningSim(simId?: number): RunningSim | null {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => running,
  );
  return simId === undefined || current?.simId === simId ? current : null;
}

const EVENT_TYPES = appEventSchema.options.map((o) => o.shape.type.value);

/** Holds the one `GET /api/events` connection for the app and keeps the caches in step with it. */
export function LiveConnection() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    const onMessage = (message: MessageEvent<string>) => {
      let parsed: ReturnType<typeof appEventSchema.safeParse>;
      try {
        parsed = appEventSchema.safeParse(JSON.parse(message.data));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const event = parsed.data;
      applyEvent(event);
      switch (event.type) {
        case "snapshot":
          client.setQueryData(QUEUE_KEY, { entries: event.queue });
          break;
        case "queue.changed":
          void client.invalidateQueries({ queryKey: QUEUE_KEY });
          break;
        case "sim.finished":
          void client.invalidateQueries({ queryKey: ["sim", event.simId] });
          break;
        case "simc.status_changed":
        case "simc.update_status":
          void client.invalidateQueries({ queryKey: SIMC_KEY });
          break;
      }
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onMessage as EventListener);
    return () => {
      source.close();
      setRunning(null);
    };
  }, [client]);
  return null;
}
