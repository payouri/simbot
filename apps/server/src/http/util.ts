import type { ApiError } from "@simbot/shared";
import type { z } from "zod";

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const apiError = (status: number, error: string, extra: Omit<ApiError, "error"> = {}) =>
  json({ error, ...extra } satisfies ApiError, status);

/** Parses a JSON request body against a shared contract; a 400 response when it doesn't fit. */
export async function readBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; res: Response }> {
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
