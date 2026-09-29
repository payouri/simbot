import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type SimcBuild, simcBuildSchema } from "@simbot/shared";
import { probeBuild } from "@simbot/simc";
import type { RegistryClient } from "./registry";
import { extractLayer, selectBuildFile } from "./tar";

const BUILD_FILE = "build.json";

export const simcRoot = (dataDir: string) => join(dataDir, "simc");
export const buildDir = (dataDir: string, tag: string) => join(simcRoot(dataDir), tag);

/** Reads an installed build's record, or null if it isn't installed (or is unreadable). */
export async function readInstalledBuild(dataDir: string, tag: string): Promise<SimcBuild | null> {
  try {
    const raw = await readFile(join(buildDir(dataDir, tag), BUILD_FILE), "utf8");
    const parsed = simcBuildSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.tag === tag ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Installs the SimC Build `tag` into `<dataDir>/simc/<tag>/`: fetch and extract into
 * `.partial/<tag>/`, run it once to read its version, then rename into place. A failure at
 * any step removes the partial directory and leaves `simc/<tag>/` absent.
 */
export async function installBuild(opts: {
  dataDir: string;
  tag: string;
  registry: RegistryClient;
}): Promise<SimcBuild> {
  const { dataDir, tag, registry } = opts;
  const final = buildDir(dataDir, tag);
  const partial = join(simcRoot(dataDir), ".partial", tag);
  const already = await readInstalledBuild(dataDir, tag);
  if (already) return already;

  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    const manifest = await registry.fetchManifest(tag);
    for (const layer of manifest.layers) {
      await extractLayer(await registry.fetchBlob(layer.digest), partial, selectBuildFile);
    }
    const tmp = join(dataDir, "tmp");
    await mkdir(tmp, { recursive: true });
    const info = await probeBuild(partial, tmp);
    const build = simcBuildSchema.parse({ tag, ...info });
    await writeFile(join(partial, BUILD_FILE), JSON.stringify(build, null, 2));
    // A half-installed leftover at the final path (no build.json) must not block the rename.
    await rm(final, { recursive: true, force: true });
    await rename(partial, final);
    return build;
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    throw err;
  }
}
