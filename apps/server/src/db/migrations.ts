/**
 * Ordered, append-only list. Never edit or reorder a shipped migration; add a new one.
 * Each migration runs once, inside a transaction, and is recorded in `schema_migrations`.
 */
export type Migration = { id: number; name: string; sql: string };

export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: "settings",
    sql: `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
    `,
  },
];
