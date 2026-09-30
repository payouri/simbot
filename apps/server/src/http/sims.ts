import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  combinationPreviewSchema,
  createSimRequestSchema,
  isTopGear,
  MAX_COMBINATIONS,
  patchSimRequestSchema,
  previewCombinationsRequestSchema,
  type SimListItem,
  simLadderResponseSchema,
  simListResponseSchema,
  simResultsResponseSchema,
  simSchema,
  simStatusSchema,
  stopSimRequestSchema,
} from "@simbot/shared";
import { type CombinationService, selectionIssues } from "../combinations";
import type { Db } from "../db";
import { moveSim } from "../db/characters";
import { getParsedImport } from "../db/imports";
import {
  copySim,
  createSim,
  deleteSim,
  getLadder,
  getSim,
  getSimResults,
  listSims,
  type QueuePlan,
  queueSim,
  requestStop,
  updateDraft,
} from "../db/sims";
import type { EventBus } from "../events";
import { settleSim } from "../settle";
import type { HttpDeps } from ".";
import { apiError, json, parseId, readBody } from "./util";

/** 409: a Draft that would newly run on PTR Game Data while PTR Sims are off. */
const ptrDisabled = () =>
  apiError(409, "ptr_disabled", {
    message: "PTR Sims are off. Turn them on from the SimC page to sim on PTR Game Data.",
  });

/** `POST /api/sims`: a Draft from an Import (`importId`) or a copy of a Sim (`copyFromSimId`). */
export async function postSim(
  db: Db,
  ptrEnabled: HttpDeps["simc"]["ptrEnabled"],
  req: Request,
): Promise<Response> {
  const body = await readBody(req, createSimRequestSchema);
  if (!body.ok) return body.res;
  const { importId, copyFromSimId, kind, settings } = body.data;
  if (copyFromSimId !== undefined) {
    // A copy of a PTR Sim stays PTR whatever the setting; only a switch from Live needs it on.
    const source = getSim(db, copyFromSimId);
    if (source && settings?.gameData === "ptr" && source.settings.gameData !== "ptr") {
      if (!ptrEnabled()) return ptrDisabled();
    }
    const copy = copySim(db, copyFromSimId, { kind, settings });
    return copy ? json(simSchema.parse(copy), 201) : apiError(404, "sim_not_found");
  }
  if (settings?.gameData === "ptr" && !ptrEnabled()) return ptrDisabled();
  const sim = importId === undefined ? null : createSim(db, { importId, kind, settings });
  if (!sim) return apiError(404, "import_not_found");
  return json(simSchema.parse(sim), 201);
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
  ptrEnabled: HttpDeps["simc"]["ptrEnabled"],
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
  if (
    settings?.gameData === "ptr" &&
    current.settings.gameData !== "ptr" &&
    current.status === "draft" &&
    !ptrEnabled()
  ) {
    return ptrDisabled();
  }
  if (topGearSelection) {
    const issues = selectionIssues(
      await items.view(current.importId),
      getParsedImport(db, current.importId)?.talentLoadouts.length ?? 0,
      topGearSelection,
    ).map(({ path, message }) => ({ path, message }));
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

/**
 * `POST /api/sims/:id/queue`: `draft → queued`. A Top Gear re-generates its Combinations from
 * the saved selection first and queues only if they validate: 422 `invalid_combinations`
 * carries the per-Candidate errors (above 50,000 Combinations too). The Combinations and the
 * SimC Build they were validated on are frozen on the Sim.
 */
export async function postQueueSim(
  db: Db,
  bus: EventBus,
  combinations: CombinationService,
  rawId: string,
): Promise<Response> {
  const id = parseId(rawId);
  if (id === null) return apiError(404, "sim_not_found");
  const current = getSim(db, id);
  if (!current) return apiError(404, "sim_not_found");
  let plan: QueuePlan | undefined;
  if (isTopGear(current) && current.status === "draft" && current.topGearSelection) {
    const frozen = await combinations.freeze(current);
    if (!frozen.ok) {
      return apiError(422, "invalid_combinations", {
        message: frozen.refused
          ? `Too many Combinations: the limit is ${MAX_COMBINATIONS.toLocaleString("en-US")}.`
          : "The selection has no valid set of Combinations.",
        issues: frozen.issues,
      });
    }
    plan = {
      selection: current.topGearSelection,
      simcTag: frozen.simcTag,
      combinations: frozen.combinations,
    };
  }
  const queued = queueSim(db, id, plan);
  if (!queued.ok) {
    if (queued.reason === "not_found") return apiError(404, "sim_not_found");
    return queued.reason === "selection_changed"
      ? apiError(409, "selection_changed", {
          message: "The selection changed while it was being checked. Try again.",
        })
      : apiError(409, "invalid_transition", { message: "Only a Draft can be queued." });
  }
  bus.emit({ type: "queue.changed" });
  return json(simSchema.parse(queued.sim));
}

/**
 * `POST /api/sims/:id/preview-combinations`: how many Combinations the setup makes, what is
 * wrong with it and how long it should take. The body may hold unsaved edits (selection,
 * settings); what it leaves out comes from the Draft. Read only.
 */
export async function postPreviewCombinations(
  db: Db,
  combinations: CombinationService,
  req: Request,
  rawId: string,
): Promise<Response> {
  const id = parseId(rawId);
  const sim = id === null ? null : getSim(db, id);
  if (!sim) return apiError(404, "sim_not_found");
  if (!sim.topGearSelection) {
    return apiError(409, "not_top_gear", { message: "This Sim has no Top Gear selection." });
  }
  const body = await readBody(req, previewCombinationsRequestSchema);
  if (!body.ok) return body.res;
  const preview = await combinations.preview(sim, {
    selection: body.data.topGearSelection,
    settings: body.data.settings,
  });
  return preview
    ? json(combinationPreviewSchema.parse(preview))
    : apiError(404, "import_not_found");
}

/**
 * `POST /api/sims/:id/preselect`: applies the default preselection to a Draft, once (it marks
 * the selection `preselected`): likely upgrades by item-level gain, Great Vault first, within
 * 500 Combinations. Included candidates already there are kept. Returns the Sim.
 */
export async function postPreselect(
  db: Db,
  combinations: CombinationService,
  rawId: string,
): Promise<Response> {
  const id = parseId(rawId);
  const sim = id === null ? null : getSim(db, id);
  if (!sim || id === null) return apiError(404, "sim_not_found");
  if (sim.status !== "draft") {
    return apiError(409, "not_a_draft", {
      message: "A Sim's input is frozen once it leaves Draft.",
    });
  }
  if (!sim.topGearSelection) {
    return apiError(409, "not_top_gear", { message: "This Sim has no Top Gear selection." });
  }
  if (sim.topGearSelection.preselected) return json(simSchema.parse(sim));
  const picked = await combinations.preselection(sim);
  if (!picked) return apiError(404, "import_not_found");
  const saved = updateDraft(db, id, {
    topGearSelection: {
      ...sim.topGearSelection,
      included: [...new Set([...sim.topGearSelection.included, ...picked])],
      preselected: true,
    },
  });
  return saved.ok ? json(simSchema.parse(saved.sim)) : apiError(409, "not_a_draft");
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
    settleSim({ dataDir, bus }, id, "discarded");
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

/**
 * `GET /api/sims/:id/results`: the Combinations with their Stage Results, joined with the
 * Import's items. Available once the Sim has succeeded, and for a stopped (cancelled) Sim, which
 * keeps what its Stages finished; 409 otherwise.
 */
export async function getResults(
  db: Db,
  items: HttpDeps["items"],
  rawId: string,
): Promise<Response> {
  const id = parseId(rawId);
  const sim = id === null ? null : getSim(db, id);
  if (!sim || id === null) return apiError(404, "sim_not_found");
  if (sim.status !== "succeeded" && sim.status !== "cancelled") {
    return apiError(409, "results_unavailable", {
      message: `Sim is ${sim.status}; results exist only once it has succeeded or been stopped.`,
    });
  }
  const results = getSimResults(db, id);
  if (!results) return apiError(404, "sim_not_found");
  const view = await items.view(sim.importId);
  const loadouts = getParsedImport(db, sim.importId)?.talentLoadouts ?? [];
  return json(
    simResultsResponseSchema.parse({
      ...results,
      status: sim.status,
      items: view?.items ?? [],
      talentLoadouts: loadouts.map((l) => ({ comment: l.comment, equipped: l.equipped })),
    }),
  );
}

/** `GET /api/sims/:id/ladder`: the planned Stages and what each finished one did to the field. */
export function getSimLadder(db: Db, rawId: string): Response {
  const id = parseId(rawId);
  const ladder = id === null ? null : getLadder(db, id);
  return ladder ? json(simLadderResponseSchema.parse(ladder)) : apiError(404, "sim_not_found");
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
    gameData: sim.settings.gameData,
    createdAt: sim.createdAt,
    finishedAt: sim.finishedAt,
  }));
  return json(simListResponseSchema.parse(items));
}

/**
 * `DELETE /api/sims/:id`: Delete a Sim and its folder. 409 `invalid_transition` while it is
 * queued or running: Stop or Discard it first.
 */
export function deleteSim_Handler(db: Db, rawId: string, dataDir: string): Response {
  const id = parseId(rawId);
  if (id === null) return apiError(404, "sim_not_found");
  const deleted = deleteSim(db, id);
  if (!deleted.ok) {
    return deleted.reason === "not_found"
      ? apiError(404, "sim_not_found")
      : apiError(409, "invalid_transition", {
          message: "A queued or running Sim cannot be deleted. Stop or Discard it first.",
        });
  }

  // Delete the sim's folder
  const simDir = join(dataDir, "sims", String(id));
  try {
    rmSync(simDir, { recursive: true, force: true });
  } catch {
    // Folder might not exist, which is fine
  }

  return new Response(null, { status: 204 });
}

/** `POST /api/sims/:id/copy-to-draft`: Copy a Sim's input into a new Draft. */
export function postCopySimToDraft(db: Db, rawId: string): Response {
  const id = parseId(rawId);
  const newSim = id === null ? null : copySim(db, id);
  if (!newSim) return apiError(404, "sim_not_found");
  return json(simSchema.parse(newSim), 201);
}
