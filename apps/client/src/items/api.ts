import { type ImportItemsResponse, importItemsResponseSchema } from "@simbot/shared";
import { useQuery } from "@tanstack/react-query";

export function useImportItems(importId: number) {
  return useQuery({
    queryKey: ["import", importId, "items"],
    queryFn: async (): Promise<ImportItemsResponse> => {
      const res = await fetch(`/api/imports/${importId}/items`);
      if (!res.ok) throw new Error(`GET /api/imports/${importId}/items failed: ${res.status}`);
      return importItemsResponseSchema.parse(await res.json());
    },
  });
}

/** `GET /api/icons/:name`: the server caches it and draws a quality-coloured placeholder offline. */
export const iconUrl = (name: string, quality: number | null) =>
  `/api/icons/${encodeURIComponent(name)}?q=${quality ?? 1}`;
