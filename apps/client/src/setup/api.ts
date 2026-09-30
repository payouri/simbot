import {
  apiErrorSchema,
  type ImportSetup,
  importSetupSchema,
  type PatchSimRequest,
  type Sim,
  simSchema,
} from "@simbot/shared";
import { useQuery } from "@tanstack/react-query";

/** The Draft as the server has it. Never cached past the page: the page owns the edits. */
export function useDraftQuery(id: number) {
  return useQuery({
    queryKey: ["sim", id, "setup"],
    queryFn: async (): Promise<Sim> => {
      const res = await fetch(`/api/sims/${id}`);
      if (!res.ok) throw new Error(`GET /api/sims/${id} failed: ${res.status}`);
      return simSchema.parse(await res.json());
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** The Import's Talent Loadouts and consumables. */
export function useImportSetup(importId: number) {
  return useQuery({
    queryKey: ["import", importId, "setup"],
    queryFn: async (): Promise<ImportSetup> => {
      const res = await fetch(`/api/imports/${importId}/parsed`);
      if (!res.ok) throw new Error(`GET /api/imports/${importId}/parsed failed: ${res.status}`);
      return importSetupSchema.parse(await res.json());
    },
  });
}

/** `PATCH /api/sims/:id`. `keepalive` lets a save started as the page closes still go out. */
export async function patchSim(
  id: number,
  body: PatchSimRequest,
  opts: { keepalive?: boolean } = {},
): Promise<Sim> {
  const res = await fetch(`/api/sims/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: opts.keepalive,
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(payload);
    throw new Error(
      err.success
        ? (err.data.issues?.[0]?.message ?? err.data.message ?? err.data.error)
        : `Saving failed (${res.status}).`,
    );
  }
  return simSchema.parse(payload);
}
