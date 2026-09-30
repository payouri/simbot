import {
  type SimcJobTarget,
  type SimcStatusResponse,
  simcStatusResponseSchema,
} from "@simbot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const SIMC_KEY = ["simc"] as const;

async function readStatus(res: Response, what: string): Promise<SimcStatusResponse> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status}`);
  return simcStatusResponseSchema.parse(await res.json());
}

/** The stored SimC status. The server refreshes a stale one in the background and says so over SSE. */
export function useSimcStatus() {
  return useQuery({
    queryKey: SIMC_KEY,
    queryFn: async () => readStatus(await fetch("/api/simc"), "GET /api/simc"),
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
    mutationFn: async () =>
      readStatus(await fetch("/api/simc/check", { method: "POST" }), "POST /api/simc/check"),
    onSuccess: (status) => client.setQueryData(SIMC_KEY, status),
  });
}

/** Queues a SimC Update Job (`POST /api/simc/jobs`): an update, a Switch or a Retry. */
export function useQueueSimcJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (target: SimcJobTarget) => {
      const res = await fetch("/api/simc/jobs", {
        method: "POST",
        body: JSON.stringify({ target }),
      });
      if (!res.ok) throw new Error(`POST /api/simc/jobs failed: ${res.status}`);
    },
    onSettled: () => client.invalidateQueries({ queryKey: SIMC_KEY }),
  });
}

/** Sets how many builds to keep (`PATCH /api/simc/settings`). */
export function useSetKeepBuilds() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (keep: number) =>
      readStatus(
        await fetch("/api/simc/settings", { method: "PATCH", body: JSON.stringify({ keep }) }),
        "PATCH /api/simc/settings",
      ),
    onSuccess: (status) => client.setQueryData(SIMC_KEY, status),
  });
}
