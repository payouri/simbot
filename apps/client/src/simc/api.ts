import { type SimcJobTarget, simcStatusResponseSchema } from "@simbot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../api/http";

export const SIMC_KEY = ["simc"] as const;

const statusRequest = (method: string, path: string, body?: unknown) =>
  request(method, path, simcStatusResponseSchema, body);

/** The stored SimC status. The server refreshes a stale one in the background and says so over SSE. */
export function useSimcStatus() {
  return useQuery({
    queryKey: SIMC_KEY,
    queryFn: () => statusRequest("GET", "/api/simc"),
    // Poll while the boot-time install is running so the build appears without a reload.
    refetchInterval: (q) =>
      q.state.data?.install.state === "installing" || q.state.data?.job?.status === "running"
        ? 2000
        : false,
  });
}

/** Forces a check now (`POST /api/simc/check`) and puts the result straight into the cache. */
export function useCheckSimcNow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => statusRequest("POST", "/api/simc/check"),
    onSuccess: (status) => client.setQueryData(SIMC_KEY, status),
  });
}

/** Queues a SimC Update Job (`POST /api/simc/jobs`): an update, a Switch or a Retry. */
export function useQueueSimcJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: SimcJobTarget) =>
      request("POST", "/api/simc/jobs", { parse: () => undefined }, { target }),
    onSettled: () => client.invalidateQueries({ queryKey: SIMC_KEY }),
  });
}

/** Sets how many builds to keep (`PATCH /api/simc/settings`). */
export function useSetKeepBuilds() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (keep: number) => statusRequest("PATCH", "/api/simc/settings", { keep }),
    onSuccess: (status) => client.setQueryData(SIMC_KEY, status),
  });
}

/** Turns PTR Sims on or off (`PATCH /api/simc/settings`). */
export function useSetPtrEnabled() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ptrEnabled: boolean) =>
      statusRequest("PATCH", "/api/simc/settings", { ptrEnabled }),
    onSuccess: (status) => client.setQueryData(SIMC_KEY, status),
  });
}
