import { readFileSync } from "node:fs";
import { join } from "node:path";
import manifestFixture from "./fixtures/manifest.json";
import tagsFixture from "./fixtures/tags.json";
import { buildLayer } from "./tar-fixture";

const metaFixtures = join(import.meta.dir, "../../../../packages/simc/src/meta/fixtures");
export const fixture = (name: string) => readFileSync(join(metaFixtures, name), "utf8");
export const json2 = readFileSync(join(import.meta.dir, "fixtures", "json2.json"), "utf8");
export const LATEST_NIGHTLY = tagsFixture.results.find((r) => r.name !== "latest")?.name ?? "";

const digestOf = (bytes: Uint8Array) =>
  `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;

/**
 * Layers shaped like the real image (see fixtures/manifest.json): musl loader and libs,
 * the simc binary, profiles. `simc` is a fake that writes the recorded json2 report, and the
 * loader is a shim that drops `--library-path <p>` and execs the rest, so no musl is needed.
 */
export function fakeImage(report: string) {
  const layers = [
    buildLayer([
      { path: "bin/busybox", content: "not needed", mode: 0o755 },
      { path: "lib/ld-musl-x86_64.so.1", content: '#!/bin/sh\nshift 2\nexec "$@"\n', mode: 0o755 },
      { path: "lib/libc.musl-x86_64.so.1", symlink: "ld-musl-x86_64.so.1" },
      { path: "usr/lib/libz.so.1.3.2", content: "z", mode: 0o755 },
      { path: "usr/lib/libz.so.1", symlink: "libz.so.1.3.2" },
      { path: "usr/lib/libapk.so.3.0.0", content: "apk", mode: 0o755 },
      { path: "usr/lib/engines-3/afalg.so", content: "engine", mode: 0o755 },
    ]),
    buildLayer([{ path: "usr/lib/libstdc++.so.6.0.34", content: "cxx", mode: 0o755 }]),
    buildLayer([
      { path: "app/", dir: true },
      {
        path: "app/SimulationCraft/simc",
        content: `#!/bin/sh
for a in "$@"; do case "$a" in json2=*) out="\${a#json2=}";; esac; done
cat > "$out" <<'JSON'
${report}
JSON
`,
        mode: 0o755,
      },
    ]),
    buildLayer([
      { path: "app/SimulationCraft/profiles/CI.simc", content: "optimal_raid=1\n" },
      { path: "app/SimulationCraft/profiles/MID1/MID1_Mage_Fire.simc", content: "mage=x\n" },
    ]),
  ];
  const blobs = new Map(layers.map((l) => [digestOf(l), l]));
  const manifest = {
    ...manifestFixture,
    layers: [...blobs.entries()].map(([digest, bytes]) => ({
      ...manifestFixture.layers[0],
      digest,
      size: bytes.length,
    })),
  };
  return { blobs, manifest };
}

export type Handler = (url: string, n: number) => Response | undefined;

/** An injected `fetch` that replays recorded registry/Hub responses and logs every call. */
export function fakeRegistry(override: Handler = () => undefined, report: string = json2) {
  const image = fakeImage(report);
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const fetchFn = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const n = (counts.get(url) ?? 0) + 1;
    counts.set(url, n);
    const forced = override(url, n);
    if (forced) return forced;
    if (url.startsWith("https://auth.docker.io/token")) {
      return Response.json({ token: "anonymous-token" });
    }
    if (url.startsWith("https://hub.docker.com/v2/repositories/simulationcraftorg/simc/tags")) {
      return Response.json(tagsFixture);
    }
    if (url.startsWith(`https://raw.githubusercontent.com/simulationcraft/simc/d08a1c3/`)) {
      return new Response(fixture(`${url.slice(url.lastIndexOf("/") + 1)}`));
    }
    const db2 = /^https:\/\/wago\.tools\/db2\/(\w+)\/csv\?build=(.+)$/.exec(url);
    if (db2) {
      return new Response(fixture(`${db2[1]}.csv`), {
        headers: { "content-disposition": `attachment; filename="${db2[1]}.${db2[2]}.csv"` },
      });
    }
    if (url.includes("/manifests/")) return Response.json(image.manifest);
    const blob = image.blobs.get(url.slice(url.lastIndexOf("/") + 1));
    if (url.includes("/blobs/") && blob) return new Response(blob);
    return new Response("not found", { status: 404 });
  };
  return { fetch: fetchFn as typeof fetch, calls, image };
}
