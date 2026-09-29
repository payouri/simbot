import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import {
  healthResponseSchema,
  type SimcStatusResponse,
  simcStatusResponseSchema,
} from "@simbot/shared";
import type { Db } from "../db";
import type { EventBus } from "../events";
import { postImport } from "./imports";
import { getResults, getSimById, postQueueSim, postSim } from "./sims";
import { apiError, json } from "./util";

export type HttpDeps = {
  db: Db;
  clientDir: string;
  bus: EventBus;
  simcStatus: () => Promise<SimcStatusResponse>;
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

/** Builds the request handler: `/api/*` REST routes, everything else is the built client. */
export function createHttpHandler({ db, bus, clientDir, simcStatus }: HttpDeps) {
  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname === "/api/health") {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      db.query("SELECT 1").get();
      return json(healthResponseSchema.parse({ status: "ok" }));
    }
    if (pathname === "/api/simc") {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return json(simcStatusResponseSchema.parse(await simcStatus()));
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
