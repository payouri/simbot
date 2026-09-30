import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type SimcBuild, simcBuildSchema } from "@simbot/shared";
import { probeBuild } from "@simbot/simc";
import type { RegistryClient } from "./registry";
import { extractLayer, selectBuildFile } from "./tar";
import { newestFirst } from "./updates";

const BUILD_FILE = "build.json";

export const simcRoot = (dataDir: string) => join(dataDir, "simc");
export const buildDir = (dataDir: string, tag: string) => join(simcRoot(dataDir), tag);

/** Reads an installed build's record, or null if it isn't installed (or is unreadable). */
export const readInstalledBuild = (dataDir: string, tag: string) =>
  readBuildRecord(buildDir(dataDir, tag), tag);

/** Reads the `build.json` of the build laid out in `dir` (an installed build or the Seed). */
export async function readBuildRecord(dir: string, tag: string): Promise<SimcBuild | null> {
  try {
    const raw = await readFile(join(dir, BUILD_FILE), "utf8");
    const parsed = simcBuildSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.tag === tag ? parsed.data : null;
  } catch {
    return null;
  }
}

export const partialDir = (dataDir: string, tag: string) =>
  join(simcRoot(dataDir), ".partial", tag);

/** Deletes a build's staging directory. Never throws. */
export const discardPartial = (dataDir: string, tag: string) =>
  rm(partialDir(dataDir, tag), { recursive: true, force: true }).catch(() => {});

/**
 * Stages the SimC Build `tag` in `<dataDir>/simc/.partial/<tag>/`: `populate` fills the directory
 * (a registry fetch, or a copy of the Seed SimC Build), then the build is run once to read its
 * version. The build is not installed yet: callers check it, then `commitBuild`. A failure
 * removes the staging directory.
 */
export async function stageBuild(opts: {
  dataDir: string;
  tag: string;
  populate: (dir: string) => Promise<void>;
}): Promise<SimcBuild> {
  const { dataDir, tag } = opts;
  const partial = partialDir(dataDir, tag);
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    await opts.populate(partial);
    const tmp = join(dataDir, "tmp");
    await mkdir(tmp, { recursive: true });
    const info = await probeBuild(partial, tmp);
    const build = simcBuildSchema.parse({ tag, ...info });
    await writeFile(join(partial, BUILD_FILE), JSON.stringify(build, null, 2));
    return build;
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    throw err;
  }
}

/** Fills a staging directory from the registry: every layer of the image, filtered to what runs SimC. */
export const populateFromRegistry =
  (registry: RegistryClient, tag: string) =>
  async (dir: string): Promise<void> => {
    const manifest = await registry.fetchManifest(tag);
    for (const layer of manifest.layers) {
      await extractLayer(await registry.fetchBlob(layer.digest), dir, selectBuildFile);
    }
  };

/** Fills a staging directory with a copy of the Seed SimC Build shipped in the app. */
export const populateFromSeed =
  (seedDir: string) =>
  async (dir: string): Promise<void> => {
    // Verbatim: the default rewrites a relative symlink (libz.so.1 -> libz.so.1.3.2) to an absolute
    // path into the seed, so the installed build would keep depending on the seed's location.
    await cp(seedDir, dir, { recursive: true, verbatimSymlinks: true });
  };

/** Moves a staged build into place: `.partial/<tag>/` becomes `simc/<tag>/`. */
export async function commitBuild(dataDir: string, tag: string): Promise<void> {
  // A half-installed leftover at the final path (no build.json) must not block the rename.
  await rm(buildDir(dataDir, tag), { recursive: true, force: true });
  await rename(partialDir(dataDir, tag), buildDir(dataDir, tag));
}

/** Removes an installed build from disk. */
export const removeBuild = (dataDir: string, tag: string) =>
  rm(buildDir(dataDir, tag), { recursive: true, force: true });

/** Every installed SimC Build, newest first (by the date in its tag). */
export async function listInstalledBuilds(dataDir: string): Promise<SimcBuild[]> {
  let names: string[];
  try {
    names = (await readdir(simcRoot(dataDir), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return [];
  }
  const builds = await Promise.all(names.map((name) => readInstalledBuild(dataDir, name)));
  return builds.filter((b): b is SimcBuild => b !== null).sort(newestFirst);
}

/**
 * Installs the SimC Build `tag` into `<dataDir>/simc/<tag>/` from the registry, making no
 * decision about whether it becomes current. A failure at any step removes the partial directory
 * and leaves `simc/<tag>/` absent.
 */
export async function installBuild(opts: {
  dataDir: string;
  tag: string;
  registry: RegistryClient;
}): Promise<SimcBuild> {
  const { dataDir, tag, registry } = opts;
  const already = await readInstalledBuild(dataDir, tag);
  if (already) return already;
  const build = await stageBuild({ dataDir, tag, populate: populateFromRegistry(registry, tag) });
  try {
    await commitBuild(dataDir, tag);
  } catch (err) {
    await discardPartial(dataDir, tag);
    throw err;
  }
  return build;
}
