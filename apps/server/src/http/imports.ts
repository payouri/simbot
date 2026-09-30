import { createImportRequestSchema, importItemsResponseSchema, importSchema } from "@simbot/shared";
import { AddonStringError } from "@simbot/simc";
import type { Db } from "../db";
import { createImport, getParsedImport } from "../db/imports";
import { ICON_NAME } from "../icons";
import type { HttpDeps } from ".";
import { apiError, json, parseId, readBody } from "./util";

/**
 * `POST /api/imports`: 201 for a new Import, 200 when the same text was already imported. The
 * packed item pass runs here; whatever happens to it, the Import itself succeeded.
 */
export async function postImport(
  db: Db,
  items: HttpDeps["items"],
  req: Request,
): Promise<Response> {
  const body = await readBody(req, createImportRequestSchema);
  if (!body.ok) return body.res;
  try {
    const { import: imp, created } = createImport(db, body.data.text);
    await items.ensure(imp.id).catch(() => {});
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

/** `GET /api/imports/:id/items`: every item with its numbers, static fields and Unknown Items. */
export async function getImportItems(items: HttpDeps["items"], rawId: string | undefined) {
  const id = parseId(rawId);
  const view = id === null ? null : await items.view(id);
  if (!view) return apiError(404, "not_found", { message: "Import not found" });
  return json(importItemsResponseSchema.parse(view));
}

/** `GET /api/icons/:name?q=<quality>`: the icon, or a placeholder in the item's quality colour. */
export function getIcon(icons: HttpDeps["icons"], name: string | undefined, q: string | null) {
  if (!name || !ICON_NAME.test(name)) return apiError(400, "invalid_icon_name");
  const quality = Number.isInteger(Number(q)) ? Number(q) : 1;
  return icons.get(name, quality);
}
