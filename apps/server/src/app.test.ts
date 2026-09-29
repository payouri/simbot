import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { healthResponseSchema } from "@simbot/shared";
import { createApp } from "./app";

let root: string;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "simbot-"));
  const clientDir = join(root, "client");
  mkdirSync(join(clientDir, "assets"), { recursive: true });
  writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(join(clientDir, "assets", "app.js"), "console.log(1)");
  app = createApp({ dataDir: join(root, "data"), clientDir });
});

afterEach(() => {
  app.close();
  rmSync(root, { recursive: true, force: true });
});

const get = (path: string) => app.fetch(new Request(`http://simbot.test${path}`));

describe("GET /api/health", () => {
  test("reports ok in the shared contract shape", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json())).toEqual({ status: "ok" });
  });

  test("unknown api routes are JSON 404s, not the client shell", async () => {
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("built client", () => {
  test("serves built files", async () => {
    const res = await get("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
  });

  test("falls back to the app shell for client routes", async () => {
    const res = await get("/prototype/top-gear");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>shell</title>");
  });

  test("malformed percent-encoding falls back to the app shell", async () => {
    const res = await get("/%E0%A4%A");
    expect(res.status).toBe(200);
  });

  test("does not serve files outside the client dir", async () => {
    writeFileSync(join(root, "secret.txt"), "secret");
    const res = await get("/..%2Fsecret.txt");
    expect(await res.text()).not.toContain("secret");
  });
});

describe("boot", () => {
  test("creates the SQLite DB under the data dir and applies the first migration", () => {
    expect(existsSync(join(root, "data", "db", "simbot.sqlite"))).toBe(true);
    const applied = app.db.query("SELECT id, name FROM schema_migrations ORDER BY id").all();
    expect(applied[0]).toEqual({ id: 1, name: "settings" });
    expect(() => app.db.query("SELECT key, value FROM settings").all()).not.toThrow();
  });

  test("booting again on the same data dir does not re-apply migrations", () => {
    const dataDir = join(root, "data");
    app.close();
    app = createApp({ dataDir, clientDir: join(root, "client") });
    expect(app.db.query("SELECT count(*) AS n FROM schema_migrations").get()).toEqual({ n: 1 });
  });
});
