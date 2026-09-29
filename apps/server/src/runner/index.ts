import type { Db } from "../db";

export type Runner = { stop(): void };

/**
 * Job runner. It meets `http` only through the DB (and later an EventBus), never by import,
 * so it can move into its own process. Empty until the queue slice.
 */
export function startRunner(_db: Db): Runner {
  return { stop() {} };
}
