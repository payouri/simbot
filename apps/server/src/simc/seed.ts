import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { simcBuildSchema } from "@simbot/shared";

export type Seed = {
  tag: string;
  /** The Seed SimC Build, laid out like an installed build (with its `build.json`). */
  dir: string;
  /** Its baked `item-meta.json` and `item-icons.json`. */
  metaDir: string;
};

/**
 * Finds the Seed SimC Build the image shipped, under `root`: `simc/<tag>/` (an installed-build
 * layout with `build.json`) and `meta/<tag>/`. Null when `root` is unset or holds no valid build,
 * as in dev, where the app installs the latest nightly instead.
 */
export function loadSeed(root: string | undefined): Seed | null {
  if (!root) return null;
  try {
    const tags = readdirSync(join(root, "simc"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
    for (const tag of tags.reverse()) {
      const dir = join(root, "simc", tag);
      const parsed = simcBuildSchema.safeParse(
        JSON.parse(readFileSync(join(dir, "build.json"), "utf8")),
      );
      if (parsed.success && parsed.data.tag === tag) {
        return { tag, dir, metaDir: join(root, "meta", tag) };
      }
    }
  } catch {
    // no seed shipped
  }
  return null;
}
