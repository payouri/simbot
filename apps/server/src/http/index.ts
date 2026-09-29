import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import {
  type AppEvent,
  appEventSchema,
  healthResponseSchema,
  queueResponseSchema,
  type SimcStatusResponse,
  type SnapshotEvent,
  simcStatusResponseSchema,
} from "@simbot/shared";
import type { Db } from "../db";
import { getQueue } from "../db/sims";
import type { EventBus } from "../events";
import type { LiveTracker } from "../live";
import { postImport } from "./imports";
import { getResults, getSimById, postQueueSim, postSim } from "./sims";
import { apiError, json } from "./util";

export type HttpDeps = {
  db: Db;
  clientDir: string;
  bus: EventBus;
  live: LiveTracker;
  simc: {
    status: () => Promise<SimcStatusResponse>;
    /** Forces a SimC Update check and resolves with the result. */
    check: () => Promise<SimcStatusResponse>;
  };
};

function serveClient(clientDir: string, pathname: string): Response {
  let rel = "";
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  } catch {
    // Malformed percent-encoding is not a file; fall through to the app shell.
  }
  const file = join(clientDir, rel);
  const inside = file === clientDir || file.startsWith(clientDir + sep);
  if (inside && rel !== "" && existsSync(file) && statSync(file).isFile()) {
    return new Response(Bun.file(file));
  }
  // Unknown non-file paths are client routes (react-router): serve the app shell.
  const index = join(clientDir, "index.html");
  if (existsSync(index)) return new Response(Bun.file(index));
  return new Response("Client not built. Run `bun run build`.", { status: 404 });
}

/**
 * The global SSE stream: a `snapshot` on connect, then every client-facing EventBus event,
 * framed as `event: <type>` + JSON `data`.
 */
function eventStream(
  events: EventBus,
  snapshot: () => SnapshotEvent,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          unsubscribe();
        }
      };
      const sendEvent = (event: unknown) => {
        // Only events in the shared client contract go out; server-internal ones stay in-process.
        const parsed = appEventSchema.safeParse(event);
        if (!parsed.success) return;
        const valid: AppEvent = parsed.data;
        send(`event: ${valid.type}\ndata: ${JSON.stringify(valid)}\n\n`);
      };
      send(": connected\n\n");
      // Synchronous from snapshot to subscribe, so no event falls between them.
      sendEvent(snapshot());
      unsubscribe = events.on(sendEvent);
      signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel: () => unsubscribe(),
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

/** Builds the request handler: `/api/*` REST routes, everything else is the built client. */
export function createHttpHandler({ db, bus, live, clientDir, simc }: HttpDeps) {
  const snapshot = (): SnapshotEvent => {
    const queue = getQueue(db);
    const running = queue.find((e) => e.status === "running");
    const state = running ? live.get(running.simId) : null;
    return {
      type: "snapshot",
      queue,
      running: running
        ? {
            simId: running.simId,
            stage: state?.stage ?? null,
            progress: state?.progress ?? null,
          }
        : null,
    };
  };
  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname === "/api/health") {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      db.query("SELECT 1").get();
      return json(healthResponseSchema.parse({ status: "ok" }));
    }
    if (pathname === "/api/simc") {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return json(simcStatusResponseSchema.parse(await simc.status()));
    }
    if (pathname === "/api/simc/check") {
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return json(simcStatusResponseSchema.parse(await simc.check()));
    }
    if (pathname === "/api/events") {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return eventStream(bus, snapshot, req.signal);
    }
    if (pathname === "/api/queue") {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return json(queueResponseSchema.parse({ entries: getQueue(db) }));
    }
    if (pathname === "/api/imports") {
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return postImport(db, req);
    }
    if (pathname === "/api/sims") {
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return postSim(db, req);
    }
    const simRoute = pathname.match(/^\/api\/sims\/([^/]+)(?:\/(queue|results))?$/);
    if (simRoute) {
      const [, id = "", action] = simRoute;
      if (action === "queue") {
        return req.method === "POST"
          ? postQueueSim(db, bus, id)
          : json({ error: "method_not_allowed" }, 405);
      }
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return action === "results" ? getResults(db, id) : getSimById(db, id);
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return apiError(404, "not_found");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405);
    }
    return serveClient(clientDir, pathname);
  };
}
