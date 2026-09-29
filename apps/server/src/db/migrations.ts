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
  {
    id: 2,
    name: "quick_sim",
    sql: `
      CREATE TABLE characters (
        id         INTEGER PRIMARY KEY,
        region     TEXT NOT NULL,
        realm      TEXT NOT NULL,
        name       TEXT NOT NULL,
        class      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (region, realm, name, class)
      ) STRICT;

      CREATE TABLE imports (
        id           INTEGER PRIMARY KEY,
        character_id INTEGER NOT NULL REFERENCES characters (id),
        raw_text     TEXT NOT NULL,
        checksum     TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        UNIQUE (character_id, checksum)
      ) STRICT;

      CREATE TABLE sims (
        id                 INTEGER PRIMARY KEY,
        kind               TEXT NOT NULL,
        status             TEXT NOT NULL,
        import_id          INTEGER NOT NULL REFERENCES imports (id),
        character_id       INTEGER NOT NULL REFERENCES characters (id),
        character_snapshot TEXT NOT NULL,
        settings           TEXT NOT NULL,
        simc_tag           TEXT,
        error              TEXT,
        created_at         TEXT NOT NULL,
        queued_at          TEXT,
        started_at         TEXT,
        finished_at        TEXT
      ) STRICT;

      CREATE TABLE combinations (
        id          INTEGER PRIMARY KEY,
        sim_id      INTEGER NOT NULL REFERENCES sims (id) ON DELETE CASCADE,
        definition  TEXT NOT NULL,
        is_baseline INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE stage_results (
        id             INTEGER PRIMARY KEY,
        combination_id INTEGER NOT NULL REFERENCES combinations (id) ON DELETE CASCADE,
        stage          INTEGER NOT NULL,
        dps_mean       REAL NOT NULL,
        dps_mean_error REAL NOT NULL,
        survived       INTEGER NOT NULL,
        UNIQUE (combination_id, stage)
      ) STRICT;

      CREATE TABLE jobs (
        id          INTEGER PRIMARY KEY,
        kind        TEXT NOT NULL,
        sim_id      INTEGER REFERENCES sims (id) ON DELETE CASCADE,
        status      TEXT NOT NULL,
        pid         INTEGER,
        created_at  TEXT NOT NULL,
        started_at  TEXT,
        finished_at TEXT
      ) STRICT;
      CREATE INDEX jobs_by_status ON jobs (status, id);
    `,
  },
];
