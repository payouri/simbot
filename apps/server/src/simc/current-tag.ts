import { Database } from "bun:sqlite";
import { join } from "node:path";

/** The Current SimC Build's tag from the database, read-only, for the standalone scripts. */
export function currentTag(dataDir: string): string | null {
  const db = new Database(join(dataDir, "db", "simbot.sqlite"), { readonly: true });
  try {
    return (
      db
        .query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'simc.current_tag'")
        .get()?.value ?? null
    );
  } finally {
    db.close();
  }
}
