import { createImportRequestSchema, importSchema } from "@simbot/shared";
import { AddonStringError } from "@simbot/simc";
import type { Db } from "../db";
import { createImport } from "../db/imports";
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
