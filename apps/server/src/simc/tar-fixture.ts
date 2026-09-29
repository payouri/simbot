import { gzipSync } from "node:zlib";

export type FixtureEntry =
  | { path: string; content: string; mode?: number }
  | { path: string; symlink: string }
  | { path: string; dir: true };

const enc = new TextEncoder();

function header(path: string, size: number, mode: number, type: string, link = ""): Uint8Array {
  const h = new Uint8Array(512);
  const put = (at: number, value: string) => h.set(enc.encode(value), at);
  put(0, path);
  put(100, `${mode.toString(8).padStart(7, "0")}\0`);
  put(124, `${size.toString(8).padStart(11, "0")}\0`);
  put(156, type);
  put(157, link);
  put(257, "ustar\0");
  put(148, "        ");
  const sum = h.reduce((a, b) => a + b, 0);
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return h;
}

/** Builds a gzipped tar layer, like a container image layer. Test-only. */
export function buildLayer(entries: FixtureEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    if ("dir" in e) parts.push(header(e.path, 0, 0o755, "5"));
    else if ("symlink" in e) parts.push(header(e.path, 0, 0o777, "2", e.symlink));
    else {
      const body = enc.encode(e.content);
      parts.push(header(e.path, body.length, e.mode ?? 0o644, "0"));
      const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
      padded.set(body);
      parts.push(padded);
    }
  }
  parts.push(new Uint8Array(1024));
  const tar = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    tar.set(p, at);
    at += p.length;
  }
  return gzipSync(tar);
}
