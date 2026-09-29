import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { healthResponseSchema } from "@simbot/shared";
import type { Db } from "../db";

export type HttpDeps = { db: Db; clientDir: string };

const json = (body: unknown, status = 200) => Response.json(body, { status });

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
export function createHttpHandler({ db, clientDir }: HttpDeps) {
  return (req: Request): Response => {
    const { pathname } = new URL(req.url);
    if (pathname === "/api/health") {
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      db.query("SELECT 1").get();
      return json(healthResponseSchema.parse({ status: "ok" }));
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, 404);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405);
    }
    return serveClient(clientDir, pathname);
  };
}
