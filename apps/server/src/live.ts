import type { SimProgress } from "@simbot/shared";
import type { EventBus } from "./events";

export type LiveSim = { stage: number | null; progress: SimProgress | null };

/**
 * What a client that connects mid-run missed: the running Sim's Stage and last progress.
 * Fed from the EventBus, so `http` reads it without importing `runner`. Only the latest
 * progress is kept; nothing is replayed.
 */
export function createLiveTracker(bus: EventBus) {
  let current: (LiveSim & { simId: number }) | null = null;
  bus.on((event) => {
    switch (event.type) {
      case "sim.stage_started":
        current = { simId: event.simId, stage: event.stage, progress: null };
        break;
      case "sim.progress": {
        const { type: _, ...progress } = event;
        if (current?.simId === event.simId) current.progress = progress;
        break;
      }
      case "sim.finished":
      case "sim.discarded":
        if (current?.simId === event.simId) current = null;
        break;
    }
  });
  return {
    get(simId: number): LiveSim | null {
      return current?.simId === simId ? { stage: current.stage, progress: current.progress } : null;
    },
  };
}

export type LiveTracker = ReturnType<typeof createLiveTracker>;
