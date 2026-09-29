import {
  apiErrorSchema,
  type CreateSimRequest,
  importSchema,
  type SimResultsResponse,
  simResultsResponseSchema,
  simSchema,
} from "@simbot/shared";

/** Throws an Error carrying the server's message for a non-2xx response. */
async function request<T>(
  method: string,
  path: string,
  schema: { parse(raw: unknown): T },
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(payload);
    throw new Error(
      err.success
        ? (err.data.message ?? err.data.error)
        : `${method} ${path} failed: ${res.status}`,
    );
  }
  return schema.parse(payload);
}

export const createImport = (text: string) =>
  request("POST", "/api/imports", importSchema, { text });
export const createSim = (req: CreateSimRequest) => request("POST", "/api/sims", simSchema, req);
export const queueSim = (id: number) => request("POST", `/api/sims/${id}/queue`, simSchema);
export const getSim = (id: number) => request("GET", `/api/sims/${id}`, simSchema);
export const getResults = (id: number): Promise<SimResultsResponse> =>
  request("GET", `/api/sims/${id}/results`, simResultsResponseSchema);
