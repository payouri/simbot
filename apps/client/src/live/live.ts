import { type AppEvent, appEventSchema, type SimLogLevel, type SimProgress } from "@simbot/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { QUEUE_KEY } from "../queue/api";
import { SIMC_KEY } from "../simc/api";

/** A line of the running Sim's streaming log. */
export type LogLine = { id: number; level: SimLogLevel; message: string; at: number };

const LOG_KEEP = 300;
let logId = 0;

export type RunningSim = {
  simId: number;
  /** Null until the Stage has started. */
  stage: number | null;
  /** Null until SimC prints its first progress line: it is still warming up. */
  progress: SimProgress | null;
  /** The newest log lines of this run, oldest first. */
  log: LogLine[];
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
      setRunning(event.running && { ...event.running, log: [] });
      break;
    case "sim.stage_started":
      setRunning({
        simId: event.simId,
        stage: event.stage,
        progress: null,
        log: running?.simId === event.simId ? running.log : [],
      });
      break;
    case "sim.progress": {
      const { type: _, ...progress } = event;
      setRunning({
        simId: event.simId,
        stage: event.stage,
        progress,
        log: running?.simId === event.simId ? running.log : [],
      });
      break;
    }
    case "sim.log":
      if (running?.simId === event.simId) {
        const line = { id: ++logId, level: event.level, message: event.message, at: Date.now() };
        setRunning({ ...running, log: [...running.log, line].slice(-LOG_KEEP) });
      }
      break;
    case "sim.finished":
    case "sim.discarded":
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

/**
 * Holds the one `GET /api/events` connection for the app and keeps the caches in step with it.
 * The connection closes when the page is hidden into the back/forward cache and reopens (with a
 * fresh snapshot) when it comes back: a cached page's open stream would otherwise hold one of
 * the browser's six connections to the server, and a few full-page navigations stall the next.
 */
export function LiveConnection() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
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
        case "sim.stage_started":
        case "sim.stage_finished":
          void client.invalidateQueries({ queryKey: ["sim", event.simId, "ladder"] });
          break;
        case "sim.finished":
        case "sim.discarded":
          void client.invalidateQueries({ queryKey: ["sim", event.simId] });
          break;
        case "simc.status_changed":
        case "simc.update_status":
          void client.invalidateQueries({ queryKey: SIMC_KEY });
          break;
      }
    };
    let source: EventSource | null = null;
    const open = () => {
      source?.close();
      source = new EventSource("/api/events");
      for (const type of EVENT_TYPES) source.addEventListener(type, onMessage as EventListener);
    };
    const close = () => {
      source?.close();
      source = null;
      setRunning(null);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) open();
    };
    open();
    window.addEventListener("pagehide", close);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", close);
      window.removeEventListener("pageshow", onPageShow);
      close();
    };
  }, [client]);
  return null;
}
