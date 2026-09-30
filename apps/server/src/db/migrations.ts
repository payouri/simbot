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
  {
    id: 3,
    name: "simc_update_jobs",
    sql: `
      ALTER TABLE jobs ADD COLUMN target TEXT;
      ALTER TABLE jobs ADD COLUMN step TEXT;
      ALTER TABLE jobs ADD COLUMN resolved_tag TEXT;
      ALTER TABLE jobs ADD COLUMN error TEXT;

      CREATE TABLE check_sim_results (
        build_tag      TEXT NOT NULL,
        import_id      INTEGER NOT NULL REFERENCES imports (id),
        previous_tag   TEXT,
        dps_mean       REAL NOT NULL,
        dps_mean_error REAL NOT NULL,
        created_at     TEXT NOT NULL,
        PRIMARY KEY (build_tag, import_id)
      ) STRICT;
    `,
  },
  {
    id: 4,
    name: "stop_and_recovery",
    sql: `
      -- 'keep' (Stop) or 'discard', set while a running Job is being ended on request.
      ALTER TABLE jobs ADD COLUMN stop_mode TEXT;
      -- How many times in a row a crash interrupted this Job.
      ALTER TABLE jobs ADD COLUMN interruptions INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: 5,
    name: "import_item_index",
    sql: `
      -- The packed pass's result for an Import (ilvl, stats, Unknown Items), as JSON, valid for
      -- the SimC Build it names. Derived data: recomputed when the Current SimC Build changes.
      ALTER TABLE imports ADD COLUMN item_index TEXT;
    `,
  },
  {
    id: 6,
    name: "top_gear_selection",
    sql: `
      -- The Top Gear Selection a Draft autosaves, as JSON. Null for a Sim that never had one.
      ALTER TABLE sims ADD COLUMN top_gear_selection TEXT;
    `,
  },
  {
    id: 7,
    name: "frozen_combinations",
    sql: `
      -- The SimC Build tag the Sim's Combinations were generated and validated against when it
      -- was queued. Re-validated at Job start if the Current SimC Build is another one.
      ALTER TABLE sims ADD COLUMN frozen_simc_tag TEXT;
      -- What the Check Sim cost: wall time and iterations. Calibrates the time estimate.
      ALTER TABLE check_sim_results ADD COLUMN duration_ms INTEGER;
      ALTER TABLE check_sim_results ADD COLUMN iterations INTEGER;
    `,
  },
  {
    id: 8,
    name: "smart_sim_invalid_combinations",
    sql: `
      -- The Stage in which SimC refused this Combination (exit 80 on its profileset). It is
      -- dropped from that Stage on and has no Stage Result for it or any later one.
      ALTER TABLE combinations ADD COLUMN invalid_stage INTEGER;
    `,
  },
  {
    id: 9,
    name: "top_gear_kind_from_selection",
    sql: `
      -- A Draft with Candidates included is a Top Gear: its kind now says so as the Draft is
      -- saved, not only once it is queued. Brings Drafts saved before that rule in line.
      UPDATE sims SET kind = 'top_gear'
      WHERE status = 'draft' AND kind = 'quick'
        AND json_array_length(top_gear_selection, '$.included') > 0;
    `,
  },
  {
    id: 10,
    name: "stage_costs",
    sql: `
      -- What each finished Smart Sim Stage cost: wall time of its SimC run, iterations summed
      -- over its profilesets (null when SimC did not report them), how many profilesets ran and
      -- the target_error they ran to. Refines the time estimate from finished Sims.
      CREATE TABLE stage_costs (
        sim_id       INTEGER NOT NULL REFERENCES sims (id) ON DELETE CASCADE,
        stage        INTEGER NOT NULL,
        duration_ms  INTEGER NOT NULL,
        iterations   INTEGER,
        profilesets  INTEGER NOT NULL,
        target_error REAL NOT NULL,
        PRIMARY KEY (sim_id, stage)
      ) STRICT;
    `,
  },
];
