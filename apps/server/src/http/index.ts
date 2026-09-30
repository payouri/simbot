import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import {
  type AppEvent,
  appEventSchema,
  healthResponseSchema,
  type ImportItemsResponse,
  queueResponseSchema,
  queueSimcJobRequestSchema,
  type SimcJob,
  type SimcJobTarget,
  type SimcStatusResponse,
  type SnapshotEvent,
  simcJobSchema,
  simcSettingsRequestSchema,
  simcStatusResponseSchema,
} from "@simbot/shared";
import type { Db } from "../db";
import { getQueue } from "../db/sims";
import type { EventBus } from "../events";
import type { LiveTracker } from "../live";
import { getCharacters, patchCharacter, postMergeCharacter } from "./characters";
import { getIcon, getImportItems, getImportParsed, postImport } from "./imports";
import {
  deleteSim_Handler,
  getResults,
  getSimById,
  getSims,
  patchSim,
  postCopySimToDraft,
  postQueueSim,
  postSim,
  postStopSim,
} from "./sims";
import { apiError, json, readBody } from "./util";

export type HttpDeps = {
  db: Db;
  dataDir: string;
  clientDir: string;
  bus: EventBus;
  live: LiveTracker;
  /** Item index of Imports (the packed SimC pass) joined with item-meta. */
  items: {
    /** Runs the packed pass for the Import if it has no index for the Current SimC Build. */
    ensure: (importId: number) => Promise<unknown>;
    view: (importId: number) => Promise<ImportItemsResponse | null>;
  };
  /** `GET /api/icons/:name`: disk-cached icons with a quality-coloured placeholder. */
  icons: { get: (name: string, quality: number) => Promise<Response> };
  simc: {
    status: () => Promise<SimcStatusResponse>;
    /** Forces a SimC Update check and resolves with the result. */
    check: () => Promise<SimcStatusResponse>;
    /** Queues a SimC Update Job. */
    queueJob: (
      target: SimcJobTarget,
    ) => Promise<
      { ok: true; job: SimcJob } | { ok: false; reason: "busy" | "not_installed" | "no_seed" }
    >;
    /** Sets how many SimC Builds retention keeps. */
    setKeep: (keep: number) => Promise<void>;
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
export function createHttpHandler({
  db,
  dataDir,
  bus,
  live,
  clientDir,
  simc,
  items,
  icons,
}: HttpDeps) {
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
    if (pathname === "/api/simc/jobs") {
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const body = await readBody(req, queueSimcJobRequestSchema);
      if (!body.ok) return body.res;
      const queued = await simc.queueJob(body.data.target);
      if (queued.ok) return json(simcJobSchema.parse(queued.job), 201);
      if (queued.reason === "busy") {
        return apiError(409, "job_in_progress", {
          message: "A SimC Update is already queued or running.",
        });
      }
      return queued.reason === "not_installed"
        ? apiError(404, "build_not_installed", { message: "That SimC Build is not installed." })
        : apiError(404, "no_seed_build", { message: "This app ships no Seed SimC Build." });
    }
    if (pathname === "/api/simc/settings") {
      if (req.method !== "PATCH") return json({ error: "method_not_allowed" }, 405);
      const body = await readBody(req, simcSettingsRequestSchema);
      if (!body.ok) return body.res;
      await simc.setKeep(body.data.keep);
      return json(simcStatusResponseSchema.parse(await simc.status()));
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
      return postImport(db, items, req);
    }
    const importParsedRoute = pathname.match(/^\/api\/imports\/([^/]+)\/parsed$/);
    if (importParsedRoute) {
      const [, id] = importParsedRoute;
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return getImportParsed(db, Number(id));
    }
    const importItemsRoute = pathname.match(/^\/api\/imports\/([^/]+)\/items$/);
    if (importItemsRoute) {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return getImportItems(items, importItemsRoute[1]);
    }
    const iconRoute = pathname.match(/^\/api\/icons\/([^/]+)$/);
    if (iconRoute) {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return getIcon(icons, iconRoute[1], new URL(req.url).searchParams.get("q"));
    }
    if (pathname === "/api/characters") {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return getCharacters(db);
    }
    const characterRoute = pathname.match(/^\/api\/characters\/([^/]+)(?:\/(merge))?$/);
    if (characterRoute) {
      const [, id = "", action] = characterRoute;
      if (action === "merge") {
        return req.method === "POST"
          ? postMergeCharacter(db, req, id)
          : json({ error: "method_not_allowed" }, 405);
      }
      return req.method === "PATCH"
        ? patchCharacter(db, req, id)
        : json({ error: "method_not_allowed" }, 405);
    }
    if (pathname === "/api/sims") {
      if (req.method === "POST") {
        return postSim(db, req);
      }
      if (req.method === "GET") {
        return getSims(db, req);
      }
      return json({ error: "method_not_allowed" }, 405);
    }
    const simRoute = pathname.match(
      /^\/api\/sims\/([^/]+)(?:\/(queue|stop|results|files|copy-to-draft)(?:\/(.+))?)?$/,
    );
    if (simRoute) {
      const [, id = "", action, fileName] = simRoute;
      if (action === "queue") {
        return req.method === "POST"
          ? postQueueSim(db, bus, id)
          : json({ error: "method_not_allowed" }, 405);
      }
      if (action === "stop") {
        return req.method === "POST"
          ? postStopSim(db, bus, dataDir, id, req)
          : json({ error: "method_not_allowed" }, 405);
      }
      if (action === "copy-to-draft") {
        return req.method === "POST"
          ? postCopySimToDraft(db, id)
          : json({ error: "method_not_allowed" }, 405);
      }
      if (action === "files" && fileName) {
        if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        // Download file from sims folder
        const filePath = join("sims", id, fileName);
        const fullPath = join(dataDir, filePath);

        // Validate path is within sims directory
        const realPath = fullPath;
        if (!realPath.startsWith(join(dataDir, "sims", id))) {
          return apiError(403, "forbidden");
        }

        try {
          if (!existsSync(fullPath)) return apiError(404, "file_not_found");
          const file = Bun.file(fullPath);
          return new Response(file);
        } catch {
          return apiError(500, "internal_error");
        }
      }
      if (req.method === "PATCH" && !action) return patchSim(db, items, req, id);
      if (req.method === "DELETE") {
        return deleteSim_Handler(db, id, dataDir);
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
