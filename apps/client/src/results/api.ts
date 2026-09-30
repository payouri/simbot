import { type SimResultsResponse, simResultsResponseSchema } from "@simbot/shared";
import { useQuery } from "@tanstack/react-query";
import { getResults } from "../quick-sim/api";

/** `GET /api/sims/:id/results`, once the Sim has succeeded or been stopped. */
export function useSimResults(simId: number, enabled: boolean) {
  return useQuery<SimResultsResponse>({
    queryKey: ["sim", simId, "results"],
    queryFn: async () => simResultsResponseSchema.parse(await getResults(simId)),
    enabled,
  });
}
