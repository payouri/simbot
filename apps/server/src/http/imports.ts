import { createImportRequestSchema, importSchema } from "@simbot/shared";
import { AddonStringError } from "@simbot/simc";
import type { Db } from "../db";
import { createImport, getParsedImport } from "../db/imports";
import { apiError, json, readBody } from "./util";

/** `POST /api/imports`: 201 for a new Import, 200 when the same text was already imported. */
export async function postImport(db: Db, req: Request): Promise<Response> {
  const body = await readBody(req, createImportRequestSchema);
  if (!body.ok) return body.res;
  try {
    const { import: imp, created } = createImport(db, body.data.text);
    return json(importSchema.parse(imp), created ? 201 : 200);
  } catch (err) {
    if (err instanceof AddonStringError) {
      return apiError(422, "invalid_addon_string", { message: err.message });
    }
    throw err;
  }
}

/** `GET /api/imports/:id/parsed`: Get the parsed data from an Import's Addon String. */
export function getImportParsed(db: Db, id: number): Response {
  const parsed = getParsedImport(db, id);
  if (!parsed) {
    return apiError(404, "not_found", { message: "Import not found" });
  }
  return json(parsed, 200);
}
