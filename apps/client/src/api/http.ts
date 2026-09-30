import { apiErrorSchema } from "@simbot/shared";

/** A non-2xx response. `message` is the server's, `payload` the parsed body (or null). */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
  }
}

/** Throws an `ApiRequestError` carrying the server's message for a non-2xx response. */
export async function request<T>(
  method: string,
  path: string,
  schema: { parse(raw: unknown): T },
  body?: unknown,
  init: Pick<RequestInit, "signal" | "keepalive"> = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(payload);
    const first = err.success ? err.data.issues?.[0]?.message : undefined;
    const more = err.success ? Math.max(0, (err.data.issues?.length ?? 0) - 1) : 0;
    throw new ApiRequestError(
      err.success
        ? `${err.data.message ?? err.data.error}${first ? ` ${first}` : ""}${more > 0 ? ` (and ${more} more)` : ""}`
        : `${method} ${path} failed: ${res.status}`,
      res.status,
      payload,
    );
  }
  return schema.parse(payload);
}
