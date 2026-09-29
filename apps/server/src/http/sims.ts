import { createSimRequestSchema, simResultsResponseSchema, simSchema } from "@simbot/shared";
import type { Db } from "../db";
import { createSim, getSim, getSimResults, queueSim } from "../db/sims";
import type { EventBus } from "../events";
import { apiError, json, parseId, readBody } from "./util";

/** `POST /api/sims`: a Quick Sim Draft from an Import. */
export async function postSim(db: Db, req: Request): Promise<Response> {
  const body = await readBody(req, createSimRequestSchema);
  if (!body.ok) return body.res;
  const sim = createSim(db, body.data);
  if (!sim) return apiError(404, "import_not_found");
  return json(simSchema.parse(sim), 201);
}

/** `POST /api/sims/:id/queue`: `draft → queued`. */
export function postQueueSim(db: Db, bus: EventBus, rawId: string): Response {
  const id = parseId(rawId);
  if (id === null) return apiError(404, "sim_not_found");
  const queued = queueSim(db, id);
  if (!queued.ok) {
    return queued.reason === "not_found"
      ? apiError(404, "sim_not_found")
      : apiError(409, "invalid_transition", { message: "Only a Draft can be queued." });
  }
  bus.emit({ type: "queue.changed" });
  return json(simSchema.parse(queued.sim));
}

export function getSimById(db: Db, rawId: string): Response {
  const id = parseId(rawId);
  const sim = id === null ? null : getSim(db, id);
  return sim ? json(simSchema.parse(sim)) : apiError(404, "sim_not_found");
}

/** `GET /api/sims/:id/results`: 409 until the Sim has succeeded. */
export function getResults(db: Db, rawId: string): Response {
  const id = parseId(rawId);
  const sim = id === null ? null : getSim(db, id);
  if (!sim || id === null) return apiError(404, "sim_not_found");
  if (sim.status !== "succeeded") {
    return apiError(409, "results_unavailable", {
      message: `Sim is ${sim.status}; results exist only once it has succeeded.`,
    });
  }
  const results = getSimResults(db, id);
  return results ? json(simResultsResponseSchema.parse(results)) : apiError(404, "sim_not_found");
}
