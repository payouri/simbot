import { failOrphanedJobs, nextQueuedJob } from "../db/sims";
import { type RunSimDeps, runSimJob } from "./run-sim";

export type Runner = {
  stop(): void;
  /** Resolves once the Queue is empty and nothing is running. */
  idle(): Promise<void>;
};

/**
 * Job runner: strict FIFO over the `jobs` table, one Job at a time. It meets `http` only
 * through the DB and the EventBus (`queue.changed` wakes it), never by import.
 */
export function startRunner(deps: RunSimDeps): Runner {
  const { db, bus } = deps;
  let stopped = false;
  let draining: Promise<void> | null = null;
  let again = false;

  async function drain() {
    do {
      again = false;
      for (let job = nextQueuedJob(db); job && !stopped; job = nextQueuedJob(db)) {
        await runSimJob(deps, job);
      }
    } while (again && !stopped);
  }

  const kick = () => {
    if (stopped) return;
    if (draining) {
      again = true;
      return;
    }
    draining = drain()
      .catch((err) => (deps.log ?? console.error)(`runner: stopped draining the Queue: ${err}`))
      .finally(() => {
        draining = null;
      });
  };

  // A Job left running by a dead process would block the FIFO forever.
  for (const { simId } of failOrphanedJobs(db)) {
    bus.emit({ type: "sim.status", simId, status: "failed" });
  }
  const off = bus.on((event) => {
    if (event.type === "queue.changed") kick();
  });
  kick();

  return {
    stop() {
      stopped = true;
      off();
    },
    async idle() {
      while (draining) await draining;
    },
  };
}
