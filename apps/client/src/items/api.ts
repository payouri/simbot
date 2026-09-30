import { type ImportItemsResponse, importItemsResponseSchema } from "@simbot/shared";
import { useQuery } from "@tanstack/react-query";
import { request } from "../api/http";

export function useImportItems(importId: number) {
  return useQuery({
    queryKey: ["import", importId, "items"],
    queryFn: (): Promise<ImportItemsResponse> =>
      request("GET", `/api/imports/${importId}/items`, importItemsResponseSchema),
  });
}

/** `GET /api/icons/:name`: the server caches it and draws a quality-coloured placeholder offline. */
export const iconUrl = (name: string, quality: number | null) =>
  `/api/icons/${encodeURIComponent(name)}?q=${quality ?? 1}`;
