import {
  type Character,
  type CreateSimRequest,
  characterConflictSchema,
  characterListResponseSchema,
  characterSchema,
  importSchema,
  type SimLadderResponse,
  type SimListResponse,
  type SimResultsResponse,
  type SimStatus,
  simLadderResponseSchema,
  simListResponseSchema,
  simResultsResponseSchema,
  simSchema,
  type UpdateCharacterRequest,
} from "@simbot/shared";
import { ApiRequestError, request } from "../api/http";

export const createImport = (text: string) =>
  request("POST", "/api/imports", importSchema, { text });
export const createSim = (req: CreateSimRequest) => request("POST", "/api/sims", simSchema, req);
export const queueSim = (id: number) => request("POST", `/api/sims/${id}/queue`, simSchema);
export const getSim = (id: number) => request("GET", `/api/sims/${id}`, simSchema);
export const getResults = (id: number): Promise<SimResultsResponse> =>
  request("GET", `/api/sims/${id}/results`, simResultsResponseSchema);
export const getLadder = (id: number): Promise<SimLadderResponse> =>
  request("GET", `/api/sims/${id}/ladder`, simLadderResponseSchema);
export const listSims = (filters?: {
  characterId?: number;
  status?: SimStatus;
}): Promise<SimListResponse> => {
  const params = new URLSearchParams();
  if (filters?.characterId) params.append("characterId", String(filters.characterId));
  if (filters?.status) params.append("status", filters.status);
  const query = params.toString() ? `?${params.toString()}` : "";
  return request("GET", `/api/sims${query}`, simListResponseSchema);
};
export const deleteSim = (id: number) =>
  request("DELETE", `/api/sims/${id}`, { parse: () => ({ success: true }) });
export const copySimToDraft = (id: number) =>
  request("POST", `/api/sims/${id}/copy-to-draft`, simSchema);
/** A Draft with the Sim's input, re-run under PTR Game Data. */
export const copySimToPtrDraft = (id: number) =>
  createSim({ copyFromSimId: id, settings: { gameData: "ptr" } });
/** Stop (`keep: true`, running Sim becomes cancelled) or Discard (`keep: false`, back to Draft). */
export const stopSim = (id: number, keep: boolean) =>
  request("POST", `/api/sims/${id}/stop`, simSchema, { keep });

/** Thrown by `updateCharacter` when the edit lands on another Character: offer `mergeCharacter`. */
export class CharacterConflictError extends Error {
  constructor(readonly conflicting: Character) {
    super("Another Character already has that identity.");
  }
}

export const listCharacters = () => request("GET", "/api/characters", characterListResponseSchema);
export const moveSim = (id: number, characterId: number) =>
  request("PATCH", `/api/sims/${id}`, simSchema, { characterId });
export const mergeCharacter = (id: number, targetId: number) =>
  request("POST", `/api/characters/${id}/merge`, characterSchema, { targetId });

/** A 409 `character_conflict` becomes a `CharacterConflictError` carrying the Character to merge into. */
export async function updateCharacter(
  id: number,
  patch: UpdateCharacterRequest,
): Promise<Character> {
  try {
    return await request("PATCH", `/api/characters/${id}`, characterSchema, patch);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 409) {
      const conflict = characterConflictSchema.safeParse(err.payload);
      if (conflict.success) throw new CharacterConflictError(conflict.data.conflictingCharacter);
    }
    throw err;
  }
}
