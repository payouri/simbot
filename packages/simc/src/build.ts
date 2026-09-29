import { join } from "node:path";

/**
 * On-disk layout of a SimC Build directory (`<data>/simc/<tag>/`). The official image is
 * Alpine/musl, so SimC always runs through its own bundled loader and library path; the
 * host's libc never matters.
 */
export function buildPaths(dir: string) {
  return {
    dir,
    simc: join(dir, "simc"),
    loader: join(dir, "lib", "ld-musl-x86_64.so.1"),
    libraryPath: `${join(dir, "lib")}:${join(dir, "usr", "lib")}`,
    profiles: join(dir, "profiles"),
  };
}

/** argv that launches the SimC Build in `dir` with `args`. */
export function launchCommand(dir: string, args: readonly string[]): string[] {
  const p = buildPaths(dir);
  return [p.loader, "--library-path", p.libraryPath, p.simc, ...args];
}
