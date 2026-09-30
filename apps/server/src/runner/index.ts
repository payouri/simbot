import { abandonJob, nextQueuedJob } from "../db/sims";
import { type RunSimDeps, runSimJob } from "./run-sim";

export type RunnerDeps = RunSimDeps & {
  /**
   * Runs one `simc_update` Job to a terminal state; never throws. Injected so the runner
   * needn't know how SimC Builds are fetched, checked and installed.
   */
  runSimcJob: (jobId: number) => Promise<void>;
};

export type Runner = {
  stop(): void;
  /** Resolves once the Queue is empty and nothing is running. */
  idle(): Promise<void>;
};

/**
 * Job runner: strict FIFO over the `jobs` table (Sims and SimC Updates alike), one Job at a
 * time. It meets `http` only through the DB and the EventBus (`queue.changed` wakes it), never by import.
 */
export function startRunner(deps: RunnerDeps): Runner {
  const { db, bus } = deps;
  let stopped = false;
  let draining: Promise<void> | null = null;
  // Cleared by `drain` itself, in the same tick as its last look at the Queue, so a wake-up
  // arriving right after cannot be swallowed by a drain that has already finished.
  let running = false;
  let again = false;

  async function drain() {
    try {
      do {
        again = false;
        for (let job = nextQueuedJob(db); job && !stopped; job = nextQueuedJob(db)) {
          if (job.kind === "simc_update") await deps.runSimcJob(job.id);
          else if (job.simId !== null) await runSimJob(deps, { id: job.id, simId: job.simId });
          else abandonJob(db, job.id);
        }
      } while (again && !stopped);
    } finally {
      running = false;
    }
  }

  const kick = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    draining = drain()
      .catch((err) => (deps.log ?? console.error)(`runner: stopped draining the Queue: ${err}`))
      .finally(() => {
        draining = null;
      });
  };

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
