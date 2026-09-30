import type { QueueEntry } from "@simbot/shared";
import type { Db } from ".";
import { getSimcQueueEntries } from "./simc-jobs";
import { getSimQueueEntries } from "./sims";

/**
 * The Queue: the running Job first (Sim or SimC Update, only one runs at a time), then the
 * waiting ones in the order they will run, which is the order they were queued (`jobs.id`).
 */
export function getQueue(db: Db): QueueEntry[] {
  const all: QueueEntry[] = [...getSimQueueEntries(db), ...getSimcQueueEntries(db)];
  return all.sort(
    (a, b) => Number(b.status === "running") - Number(a.status === "running") || a.jobId - b.jobId,
  );
}
