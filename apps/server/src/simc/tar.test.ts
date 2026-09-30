import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { extractLayer, selectBuildFile } from "./tar";
import { buildLayer } from "./tar-fixture";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "simbot-tar-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("selectBuildFile keeps only what a SimC Build needs", () => {
  expect(selectBuildFile("app/SimulationCraft/simc")).toBe("simc");
  expect(selectBuildFile("app/SimulationCraft/profiles/MID1/a.simc")).toBe("profiles/MID1/a.simc");
  expect(selectBuildFile("lib/ld-musl-x86_64.so.1")).toBe("lib/ld-musl-x86_64.so.1");
  expect(selectBuildFile("usr/lib/libcurl.so.4")).toBe("usr/lib/libcurl.so.4");
  expect(selectBuildFile("usr/lib/libapk.so.3.0.0")).toBeNull();
  expect(selectBuildFile("usr/lib/os-release")).toBeNull();
  expect(selectBuildFile("usr/lib/engines-3/capi.so")).toBeNull();
  expect(selectBuildFile("bin/busybox")).toBeNull();
});

test("later layers overwrite earlier ones", async () => {
  const pick = (p: string) => p;
  await extractLayer(buildLayer([{ path: "a.txt", content: "one" }]), dir, pick);
  await extractLayer(buildLayer([{ path: "a.txt", content: "two" }]), dir, pick);
  expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("two");
});

test("refuses to write outside the destination", async () => {
  const layer = buildLayer([{ path: "evil", content: "x" }]);
  await expect(extractLayer(layer, dir, () => "../evil")).rejects.toThrow(/outside/);
});

test("refuses symlinks that leave the destination", async () => {
  const layer = buildLayer([{ path: "link", symlink: "../../etc/passwd" }]);
  await expect(extractLayer(layer, dir, (p) => p)).rejects.toThrow(/symlink/);
});

test("rejects a truncated archive", async () => {
  const layer = buildLayer([{ path: "a.txt", content: "x".repeat(2000) }]);
  const tar = gunzipSync(layer).slice(0, 700);
  await expect(extractLayer(gzipSync(tar), dir, (p) => p)).rejects.toThrow(/truncated/);
});

test("refuses writes through a chain of symlinks that leaves the destination", async () => {
  const root = join(dir, "root");
  // `l` really points at root/x, so `m`'s `../../outside` lands in dir/outside, not the root.
  const layer = buildLayer([
    { path: "x/f", content: "x" },
    { path: "a1/a2/f", content: "x" },
    { path: "a1/a2/l", symlink: "../../x" },
    { path: "a1/a2/l/m", symlink: "../../outside" },
    { path: "a1/a2/l/m/pwned", content: "PWNED" },
  ]);
  mkdirSync(join(dir, "outside"));
  await expect(extractLayer(layer, root, (p) => p)).rejects.toThrow(/build directory/);
  expect(existsSync(join(dir, "outside", "pwned"))).toBe(false);
});

test("refuses writes through a dangling symlink", async () => {
  const layer = buildLayer([
    { path: "d/l", symlink: "../nowhere" },
    { path: "d/l/f", content: "x" },
  ]);
  await expect(extractLayer(layer, dir, (p) => p)).rejects.toThrow(/dangling symlink/);
});
