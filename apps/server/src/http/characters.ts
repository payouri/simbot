import {
  characterListResponseSchema,
  characterSchema,
  mergeCharacterRequestSchema,
  updateCharacterRequestSchema,
} from "@simbot/shared";
import type { Db } from "../db";
import { listCharacters, mergeCharacters, updateCharacter } from "../db/characters";
import { apiError, json, parseId, readBody } from "./util";

/** `GET /api/characters`. */
export const getCharacters = (db: Db): Response =>
  json(characterListResponseSchema.parse(listCharacters(db)));

/** `PATCH /api/characters/:id`: 409 `character_conflict` names the Character to merge into. */
export async function patchCharacter(db: Db, req: Request, rawId: string): Promise<Response> {
  const id = parseId(rawId);
  if (id === null) return apiError(404, "character_not_found");
  const body = await readBody(req, updateCharacterRequestSchema);
  if (!body.ok) return body.res;
  const result = updateCharacter(db, id, body.data);
  if (result.ok) return json(characterSchema.parse(result.character));
  if (result.reason === "not_found") return apiError(404, "character_not_found");
  return json(
    {
      error: "character_conflict",
      message: "Another Character already has that region, realm, name and class.",
      conflictingCharacter: characterSchema.parse(result.conflicting),
    },
    409,
  );
}

/** `POST /api/characters/:id/merge`: the Character in the path is merged into `targetId`. */
export async function postMergeCharacter(db: Db, req: Request, rawId: string): Promise<Response> {
  const id = parseId(rawId);
  if (id === null) return apiError(404, "character_not_found");
  const body = await readBody(req, mergeCharacterRequestSchema);
  if (!body.ok) return body.res;
  const result = mergeCharacters(db, id, body.data.targetId);
  if (result.ok) return json(characterSchema.parse(result.character));
  return result.reason === "same_character"
    ? apiError(400, "same_character", { message: "A Character cannot be merged into itself." })
    : apiError(404, "character_not_found");
}
