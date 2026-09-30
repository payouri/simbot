import {
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
import { request } from "../api/http";

/** The Draft as the server has it. Never cached past the page: the page owns the edits. */
export function useDraftQuery(id: number) {
  return useQuery({
    queryKey: ["sim", id, "setup"],
    queryFn: (): Promise<Sim> => request("GET", `/api/sims/${id}`, simSchema),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/** The Import's Talent Loadouts and consumables. */
export function useImportSetup(importId: number) {
  return useQuery({
    queryKey: ["import", importId, "setup"],
    queryFn: (): Promise<ImportSetup> =>
      request("GET", `/api/imports/${importId}/parsed`, importSetupSchema),
  });
}

/** `PATCH /api/sims/:id`. `keepalive` lets a save started as the page closes still go out. */
export async function patchSim(
  id: number,
  body: PatchSimRequest,
  opts: { keepalive?: boolean } = {},
): Promise<Sim> {
  return request("PATCH", `/api/sims/${id}`, simSchema, body, { keepalive: opts.keepalive });
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
    queryFn: ({ signal }): Promise<CombinationPreview> =>
      request(
        "POST",
        `/api/sims/${simId}/preview-combinations`,
        combinationPreviewSchema,
        JSON.parse(body),
        { signal },
      ),
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** `POST /api/sims/:id/preselect`: the default preselection, saved on the Draft. */
export const preselectDraft = (id: number): Promise<Sim> =>
  request("POST", `/api/sims/${id}/preselect`, simSchema);
