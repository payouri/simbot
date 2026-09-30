import { chmod, lstat, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

type TarEntry = {
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  mode: number;
  linkname: string;
  data: Uint8Array;
};

const decoder = new TextDecoder();
const cstr = (b: Uint8Array) => {
  const end = b.indexOf(0);
  return decoder.decode(end === -1 ? b : b.subarray(0, end));
};
const octal = (b: Uint8Array) => Number.parseInt(cstr(b).trim() || "0", 8);

/** Parses `key=value` records of a pax extended header. */
function parsePax(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < data.length) {
    const space = data.indexOf(0x20, i);
    if (space === -1) break;
    const len = Number.parseInt(decoder.decode(data.subarray(i, space)), 10);
    if (!(len > 0)) break;
    const record = decoder.decode(data.subarray(space + 1, i + len - 1));
    const eq = record.indexOf("=");
    if (eq !== -1) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

/** Reads the entries of an (uncompressed) ustar/GNU/pax tar archive. */
export function* readTar(tar: Uint8Array): Generator<TarEntry> {
  let offset = 0;
  let longPath: string | undefined;
  let longLink: string | undefined;
  let pax: Record<string, string> = {};
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return;
    const size = octal(header.subarray(124, 136));
    const flag = String.fromCharCode(header[156] || 0x30);
    if (offset + 512 + size > tar.length) throw new Error("truncated tar archive");
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (flag === "L") longPath = cstr(data);
    else if (flag === "K") longLink = cstr(data);
    else if (flag === "x") pax = { ...pax, ...parsePax(data) };
    else if (flag === "g") {
      // Global pax headers carry archive-wide metadata we don't use.
    } else {
      const prefix = cstr(header.subarray(345, 500));
      const name = cstr(header.subarray(0, 100));
      const path = pax.path ?? longPath ?? (prefix ? `${prefix}/${name}` : name);
      const linkname = pax.linkpath ?? longLink ?? cstr(header.subarray(157, 257));
      const type =
        flag === "0" || flag === "7"
          ? "file"
          : flag === "5"
            ? "dir"
            : flag === "2"
              ? "symlink"
              : "other";
      yield { path, type, mode: octal(header.subarray(100, 108)), linkname, data };
      longPath = longLink = undefined;
      pax = {};
    }
  }
}

/** `path` with every symlink already on disk resolved; missing trailing parts are kept as-is. */
async function realParent(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    // A dangling symlink also reports ENOENT; writing under it would follow it blindly.
    if (
      await lstat(path).then(
        () => true,
        () => false,
      )
    ) {
      throw new Error(`refusing to extract through a dangling symlink: ${path}`);
    }
    return join(await realParent(dirname(path)), basename(path));
  }
}

/**
 * Extracts the entries of one gzipped layer into `destDir`. `select` maps an archive path
 * (`app/SimulationCraft/simc`) to a path relative to `destDir`, or null to skip the entry.
 * Later layers overwrite earlier ones, as in a container filesystem.
 */
export async function extractLayer(
  gz: Uint8Array,
  destDir: string,
  select: (archivePath: string) => string | null,
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const root = await realpath(destDir);
  for (const entry of readTar(gunzipSync(gz))) {
    const rel = select(entry.path.replace(/^\.?\/+/, ""));
    if (rel === null || (entry.type !== "file" && entry.type !== "symlink")) continue;
    const target = resolve(root, normalize(rel));
    if (isAbsolute(rel) || !target.startsWith(root + sep)) {
      throw new Error(`refusing to extract outside the build directory: ${entry.path}`);
    }
    // Earlier entries may have planted symlinks: resolve them on disk, not just lexically.
    const parent = await realParent(dirname(target));
    if (parent !== root && !parent.startsWith(root + sep)) {
      throw new Error(`refusing to extract outside the build directory: ${entry.path}`);
    }
    await mkdir(parent, { recursive: true });
    const real = join(parent, basename(target));
    await rm(real, { force: true });
    if (entry.type === "symlink") {
      // Layer links are relative to their own directory; keep them inside the build.
      const resolved = resolve(parent, entry.linkname);
      if (isAbsolute(entry.linkname) || !resolved.startsWith(root + sep)) {
        throw new Error(`refusing symlink that leaves the build directory: ${entry.path}`);
      }
      await symlink(entry.linkname, real);
    } else {
      await writeFile(real, entry.data);
      await chmod(real, entry.mode & 0o777);
    }
  }
}

/** Where each archive path lands in a SimC Build directory; null for everything we don't need. */
export function selectBuildFile(archivePath: string): string | null {
  const simc = "app/SimulationCraft/";
  if (archivePath === `${simc}simc`) return "simc";
  if (archivePath.startsWith(`${simc}profiles/`)) return archivePath.slice(simc.length);
  if (archivePath === "lib/ld-musl-x86_64.so.1" || archivePath === "lib/libc.musl-x86_64.so.1") {
    return archivePath;
  }
  // Shared libraries only: not the apk package manager's, not engines or modules in subdirs.
  const lib = /^usr\/lib\/([^/]+)$/.exec(archivePath);
  if (lib?.[1] && /\.so(\.|$)/.test(lib[1]) && !lib[1].startsWith("libapk")) return archivePath;
  return null;
}
