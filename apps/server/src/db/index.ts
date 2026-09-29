import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { migrations as allMigrations, type Migration } from "./migrations";

export type Db = Database;

export function migrate(db: Db, migrations: readonly Migration[] = allMigrations): void {
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT",
  );
  const applied = new Set(
    db
      .query<{ id: number }, []>("SELECT id FROM schema_migrations")
      .all()
      .map((row) => row.id),
  );
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.run(migration.sql);
      db.run("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)", [
        migration.id,
        migration.name,
        new Date().toISOString(),
      ]);
    })();
  }
}

/** Opens `<dataDir>/db/simbot.sqlite`, creating the directory, and applies pending migrations. */
export function openDb(dataDir: string): Db {
  const dir = join(dataDir, "db");
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "simbot.sqlite"), { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}
