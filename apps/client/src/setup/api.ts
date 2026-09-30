import {
  apiErrorSchema,
  type CombinationPreview,
  combinationPreviewSchema,
  type ImportSetup,
  importSetupSchema,
  type PatchSimRequest,
  type Sim,
  type SimSettings,
  simSchema,
  type TopGearSelection,
} from "@simbot/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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

/** A value that follows `value` after it has stayed put for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const PREVIEW_DEBOUNCE_MS = 300;

/**
 * The Combination count, validation and time estimate of the setup as it is on screen (not as
 * it is saved), re-asked 300 ms after the last edit. The previous answer stays until the new
 * one arrives.
 */
export function useCombinationPreview(
  simId: number,
  edits: { selection: TopGearSelection; settings: SimSettings },
) {
  const body = useDebounced(
    JSON.stringify({ topGearSelection: edits.selection, settings: edits.settings }),
    PREVIEW_DEBOUNCE_MS,
  );
  return useQuery({
    queryKey: ["sim", simId, "preview", body],
    queryFn: async ({ signal }): Promise<CombinationPreview> => {
      const res = await fetch(`/api/sims/${simId}/preview-combinations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal,
      });
      if (!res.ok) throw new Error(`Preview failed (${res.status}).`);
      return combinationPreviewSchema.parse(await res.json());
    },
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** `POST /api/sims/:id/preselect`: the default preselection, saved on the Draft. */
export async function preselectDraft(id: number): Promise<Sim> {
  const res = await fetch(`/api/sims/${id}/preselect`, { method: "POST" });
  if (!res.ok) throw new Error(`Preselecting failed (${res.status}).`);
  return simSchema.parse(await res.json());
}
