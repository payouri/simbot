import { type SimcStatusResponse, simcStatusResponseSchema } from "@simbot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

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
    refetchInterval: (q) => (q.state.data?.install.state === "installing" ? 2000 : false),
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

/** Keeps the SimC status live: refetches whenever the server says it changed. */
export function useSimcLiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    const refresh = () => void client.invalidateQueries({ queryKey: SIMC_KEY });
    source.addEventListener("simc.status_changed", refresh);
    return () => source.close();
  }, [client]);
}
