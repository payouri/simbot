import { rmSync } from "node:fs";
import { join } from "node:path";
import type { EventBus } from "./events";

/** Where a Sim ended up once the DB has recorded it leaving `queued` or `running`. */
export type Settlement = "succeeded" | "failed" | "cancelled" | "discarded" | "requeued";

/**
 * The one place that says what settling a Sim means outside the DB: a Discard also loses
 * `sims/<id>/`, and each outcome has its fixed set of events (clients react to `sim.finished`,
 * `sim.discarded` and `queue.changed`, not to `sim.status`). Call it after the DB transition.
 * Used by the runner, by `POST /api/sims/:id/stop` and by boot recovery.
 */
export function settleSim(
  deps: { dataDir: string; bus: EventBus },
  simId: number,
  outcome: Settlement,
) {
  const { dataDir, bus } = deps;
  switch (outcome) {
    case "discarded":
      rmSync(join(dataDir, "sims", String(simId)), { recursive: true, force: true });
      bus.emit({ type: "sim.status", simId, status: "draft" });
      bus.emit({ type: "sim.discarded", simId });
      break;
    case "requeued":
      bus.emit({ type: "sim.status", simId, status: "queued" });
      break;
    default:
      bus.emit({ type: "sim.status", simId, status: outcome });
      bus.emit({ type: "sim.finished", simId, status: outcome });
  }
  bus.emit({ type: "queue.changed" });
}
