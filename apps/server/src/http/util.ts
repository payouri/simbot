import type { ApiError } from "@simbot/shared";
import type { z } from "zod";

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const apiError = (status: number, error: string, extra: Omit<ApiError, "error"> = {}) =>
  json({ error, ...extra } satisfies ApiError, status);

/** Parses a JSON request body against a shared contract; a 400 response when it doesn't fit, 415 when not sent as JSON. */
export async function readBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; res: Response }> {
  // Only `application/json` forces a CORS preflight; `text/plain` and form types are "simple"
  // cross-site requests that any web page could send without the user's consent.
  const type = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    return {
      ok: false,
      res: apiError(415, "unsupported_media_type", {
        message: "Content-Type must be application/json.",
      }),
    };
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: apiError(400, "invalid_json", { message: "Body is not JSON." }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: apiError(400, "invalid_request", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

/** `/api/sims/12` style ids: digits only, so `12abc` and `-1` are not ids. */
export const parseId = (raw: string | undefined): number | null =>
  raw !== undefined && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
