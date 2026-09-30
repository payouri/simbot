import { type QueueResponse, queueResponseSchema } from "@simbot/shared";
import { useQuery } from "@tanstack/react-query";
import { request } from "../api/http";

export const QUEUE_KEY = ["queue"] as const;

const getQueue = (): Promise<QueueResponse> => request("GET", "/api/queue", queueResponseSchema);

/** The Queue. The live stream refetches it whenever it changes. */
export const useQueueQuery = () => useQuery({ queryKey: QUEUE_KEY, queryFn: getQueue });
