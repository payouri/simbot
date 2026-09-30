import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  type ApiError,
  createSimRequestSchema,
  patchSimRequestSchema,
  type SimListItem,
  simListResponseSchema,
  simResultsResponseSchema,
  simSchema,
  simStatusSchema,
  stopSimRequestSchema,
} from "@simbot/shared";
import type { Db } from "../db";
import { moveSim } from "../db/characters";
import { getParsedImport } from "../db/imports";
import {
  copySim,
  createSim,
  deleteSim,
  getSim,
  getSimResults,
  listSims,
  queueSim,
  requestStop,
  updateDraft,
} from "../db/sims";
import type { EventBus } from "../events";
import type { HttpDeps } from ".";
import { apiError, json, parseId, readBody } from "./util";

/** `POST /api/sims`: a Draft from an Import (`importId`) or a copy of a Sim (`copyFromSimId`). */
export async function postSim(db: Db, req: Request): Promise<Response> {
  const body = await readBody(req, createSimRequestSchema);
  if (!body.ok) return body.res;
  const { importId, copyFromSimId, kind, settings } = body.data;
  if (copyFromSimId !== undefined) {
    const copy = copySim(db, copyFromSimId, { kind, settings });
    return copy ? json(simSchema.parse(copy), 201) : apiError(404, "sim_not_found");
  }
  const sim = importId === undefined ? null : createSim(db, { importId, kind, settings });
  if (!sim) return apiError(404, "import_not_found");
  return json(simSchema.parse(sim), 201);
}

/**
 * Checks a Top Gear Selection against the Sim's Import: every included item must be a
 * selectable Candidate Item (not equipped, not an Unknown Item, read by SimC) and every Talent
 * Loadout must exist. Returns one issue per offender.
 */
async function selectionIssues(
  db: Db,
  items: HttpDeps["items"],
  importId: number,
  selection: { included: number[]; talentLoadouts: number[] },
): Promise<NonNullable<ApiError["issues"]>> {
  const issues: NonNullable<ApiError["issues"]> = [];
  if (selection.included.length > 0) {
    const view = await items.view(importId);
    const byIndex = new Map((view?.items ?? []).map((i) => [i.index, i]));
    selection.included.forEach((index, at) => {
      const item = byIndex.get(index);
      const why = !item
        ? "is not an item of this Import"
        : item.selectable
          ? null
          : item.status === "unknown"
            ? "is an Unknown Item and cannot be selected"
            : item.source === "equipped"
              ? "is equipped, not a Candidate Item"
              : "was not read by SimC and cannot be selected";
      if (why)
        issues.push({ path: `topGearSelection.included.${at}`, message: `Item ${index} ${why}.` });
    });
  }
  const loadouts = getParsedImport(db, importId)?.talentLoadouts.length ?? 0;
  selection.talentLoadouts.forEach((index, at) => {
    if (index >= loadouts) {
      issues.push({
        path: `topGearSelection.talentLoadouts.${at}`,
        message: `Talent Loadout ${index} does not exist.`,
      });
    }
  });
  return issues;
}

/**
 * `PATCH /api/sims/:id`: moves the Sim to another Character (any state), or saves the Sim
 * Settings and Top Gear Selection of a Draft (409 `not_a_draft` for any other state; 422
 * `invalid_selection` naming each Candidate that cannot be selected). Nothing is applied unless
 * the whole request is.
 */
export async function patchSim(
  db: Db,
  items: HttpDeps["items"],
  req: Request,
  rawId: string,
): Promise<Response> {
  const id = parseId(rawId);
  if (id === null) return apiError(404, "sim_not_found");
  const current = getSim(db, id);
  if (!current) return apiError(404, "sim_not_found");
  const body = await readBody(req, patchSimRequestSchema);
  if (!body.ok) return body.res;
  const { characterId, settings, topGearSelection } = body.data;
  const editsInput = settings !== undefined || topGearSelection !== undefined;
  if (editsInput && current.status !== "draft") {
    return apiError(409, "not_a_draft", {
      message: "A Sim's input is frozen once it leaves Draft.",
    });
  }
  if (topGearSelection) {
    const issues = await selectionIssues(db, items, current.importId, topGearSelection);
    if (issues.length > 0) {
      return apiError(422, "invalid_selection", {
        message: "The selection includes items that cannot be selected.",
        issues,
      });
    }
  }
  let sim = current;
  if (characterId !== undefined) {
    const moved = moveSim(db, id, characterId);
    if (!moved.ok) return apiError(404, moved.reason);
    sim = moved.sim;
  }
  if (editsInput) {
    const saved = updateDraft(db, id, { settings, topGearSelection });
    if (!saved.ok) {
      return saved.reason === "not_found"
        ? apiError(404, "sim_not_found")
        : apiError(409, "not_a_draft", {
            message: "A Sim's input is frozen once it leaves Draft.",
          });
    }
    sim = saved.sim;
  }
  return json(simSchema.parse(sim));
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

/**
 * `POST /api/sims/:id/stop {keep}`: Stop (`keep: true`) or Discard (`keep: false`).
 * A queued Sim returns to Draft at once (200). A running one answers 202 with the Sim still
 * `running`: SimC is being signalled, and the Sim settles once it has exited (`sim.status`).
 */
export async function postStopSim(
  db: Db,
  bus: EventBus,
  dataDir: string,
  rawId: string,
  req: Request,
): Promise<Response> {
  const id = parseId(rawId);
  if (id === null) return apiError(404, "sim_not_found");
  const body = await readBody(req, stopSimRequestSchema);
  if (!body.ok) return body.res;
  const stopped = requestStop(db, id, body.data.keep);
  if (!stopped.ok) {
    return stopped.reason === "not_found"
      ? apiError(404, "sim_not_found")
      : apiError(409, "invalid_transition", {
          message: "Only a queued or running Sim can be stopped or discarded.",
        });
  }
  if (stopped.outcome === "discarded") {
    rmSync(join(dataDir, "sims", String(id)), { recursive: true, force: true });
    bus.emit({ type: "sim.status", simId: id, status: "draft" });
    bus.emit({ type: "sim.discarded", simId: id });
    bus.emit({ type: "queue.changed" });
    return json(simSchema.parse(stopped.sim));
  }
  bus.emit({ type: "sim.stop_requested", simId: id });
  return json(simSchema.parse(stopped.sim), 202);
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

/** `GET /api/sims?characterId&status`: List Sims with optional filters. */
export function getSims(db: Db, req: Request): Response {
  const url = new URL(req.url);
  const characterId = url.searchParams.get("characterId");
  const status = url.searchParams.get("status");

  const filters: { characterId?: number; status?: string } = {};
  if (characterId) {
    const id = parseId(characterId);
    if (id === null) return apiError(400, "invalid_character_id");
    filters.characterId = id;
  }
  if (status) {
    // Validate status is a valid SimStatus
    const statusResult = simStatusSchema.safeParse(status);
    if (!statusResult.success) return apiError(400, "invalid_status");
    filters.status = status;
  }

  const sims = listSims(db, filters);
  const items: SimListItem[] = sims.map((sim) => ({
    id: sim.id,
    kind: sim.kind,
    status: sim.status,
    characterId: sim.characterId,
    character: sim.character,
    simcTag: sim.simcTag,
    createdAt: sim.createdAt,
    finishedAt: sim.finishedAt,
  }));
  return json(simListResponseSchema.parse(items));
}

/** `DELETE /api/sims/:id`: Delete a Sim and its folder. */
export function deleteSim_Handler(db: Db, rawId: string, dataDir: string): Response {
  const id = parseId(rawId);
  if (id === null) return apiError(404, "sim_not_found");
  const deleted = deleteSim(db, id);
  if (!deleted) return apiError(404, "sim_not_found");

  // Delete the sim's folder
  const simDir = join(dataDir, "sims", String(id));
  try {
    rmSync(simDir, { recursive: true, force: true });
  } catch {
    // Folder might not exist, which is fine
  }

  return json({ success: true }, 204);
}

/** `POST /api/sims/:id/copy-to-draft`: Copy a Sim's input into a new Draft. */
export function postCopySimToDraft(db: Db, rawId: string): Response {
  const id = parseId(rawId);
  const newSim = id === null ? null : copySim(db, id);
  if (!newSim) return apiError(404, "sim_not_found");
  return json(simSchema.parse(newSim), 201);
}
