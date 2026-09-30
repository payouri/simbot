import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "./simc/registry";

/** Icon names are the lower-cased `Interface\Icons` file names: letters, digits, `_`, `-`. */
export const ICON_NAME = /^[a-z0-9][a-z0-9_-]{0,127}$/;

/** Sources tried in order. Icons are never baked into the image: they are cached on first use. */
export const ICON_SOURCES: readonly ((name: string) => string)[] = [
  (name) => `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`,
  (name) => `https://render.worldofwarcraft.com/us/icons/56/${name}.jpg`,
];

/** Quality colours as in DESIGN.md (`q-*`), index = WoW quality 0..7. */
const QUALITY_COLOURS = [
  "#9d9d9d",
  "#f2f2f2",
  "#1eff00",
  "#0070dd",
  "#a335ee",
  "#ff8000",
  "#e6cc80",
  "#00ccff",
];

/** How long a failed lookup is remembered, so an offline server is not hammered per icon. */
const NEGATIVE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;

const CACHE_HEADERS = { "cache-control": "public, max-age=31536000, immutable" };

/** A quality-coloured square standing in for an icon that could not be fetched. */
export function placeholderSvg(quality: number): string {
  const colour = QUALITY_COLOURS[quality] ?? QUALITY_COLOURS[1];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56" width="56" height="56"><rect x="1.5" y="1.5" width="53" height="53" rx="6" fill="${colour}" fill-opacity="0.14" stroke="${colour}" stroke-width="3"/><text x="28" y="37" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="600" fill="${colour}" fill-opacity="0.8">?</text></svg>`;
}

export type IconDeps = {
  dataDir: string;
  fetch: Fetch;
  now?: () => number;
};

/**
 * `GET /api/icons/:name` behind the scenes: the disk cache first, then zamimg, then Blizzard's
 * render service, then a quality-coloured placeholder. Only a real image is cached.
 */
export function createIconService({ dataDir, fetch, now = Date.now }: IconDeps) {
  const dir = join(dataDir, "cache", "icons");
  const failedAt = new Map<string, number>();

  async function download(name: string): Promise<Uint8Array | null> {
    for (const url of ICON_SOURCES) {
      try {
        const res = await fetch(url(name), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > 0) return bytes;
      } catch {
        // Offline or slow: try the next source.
      }
    }
    return null;
  }

  return {
    async get(name: string, quality: number): Promise<Response> {
      const file = join(dir, `${name}.jpg`);
      const cached = Bun.file(file);
      if (await cached.exists()) {
        return new Response(cached, {
          headers: { "content-type": "image/jpeg", ...CACHE_HEADERS },
        });
      }
      const failed = failedAt.get(name);
      const bytes =
        failed !== undefined && now() - failed < NEGATIVE_TTL_MS ? null : await download(name);
      if (bytes) {
        failedAt.delete(name);
        const tmp = `${file}.${crypto.randomUUID()}.partial`;
        try {
          await mkdir(dir, { recursive: true });
          await Bun.write(tmp, bytes);
          await rename(tmp, file);
        } catch {
          await rm(tmp, { force: true });
        }
        return new Response(bytes, { headers: { "content-type": "image/jpeg", ...CACHE_HEADERS } });
      }
      failedAt.set(name, now());
      return new Response(placeholderSvg(quality), {
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "no-store",
          "x-icon-source": "placeholder",
        },
      });
    },
  };
}
export type IconService = ReturnType<typeof createIconService>;
