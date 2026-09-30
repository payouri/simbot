import {
  apiErrorSchema,
  type CreateSimRequest,
  importSchema,
  type SimListResponse,
  type SimResultsResponse,
  type SimStatus,
  simListResponseSchema,
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
