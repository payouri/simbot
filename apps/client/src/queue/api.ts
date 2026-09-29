import { apiErrorSchema, type QueueResponse, queueResponseSchema } from "@simbot/shared";
import { useQuery } from "@tanstack/react-query";

export const QUEUE_KEY = ["queue"] as const;

async function getQueue(): Promise<QueueResponse> {
  const res = await fetch("/api/queue");
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(payload);
    throw new Error(
      err.success ? (err.data.message ?? err.data.error) : `GET /api/queue failed: ${res.status}`,
    );
  }
  return queueResponseSchema.parse(payload);
}

/** The Queue. The live stream refetches it whenever it changes. */
export const useQueueQuery = () => useQuery({ queryKey: QUEUE_KEY, queryFn: getQueue });
