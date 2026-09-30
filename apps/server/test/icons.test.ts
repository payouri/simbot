import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Harness, makeHarness } from "./harness";

let h: Harness;
afterEach(() => h?.close());

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** A network where `up` maps a URL prefix to a response; everything else is offline. */
function network(up: Record<string, () => Response>) {
  const urls: string[] = [];
  const fetch = async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const match = Object.keys(up).find((prefix) => url.startsWith(prefix));
    if (!match) throw new TypeError("network down");
    return (up[match] as () => Response)();
  };
  return { fetch, urls };
}
const image = () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
const ZAM = "https://wow.zamimg.com/";
const BLIZ = "https://render.worldofwarcraft.com/";

describe("GET /api/icons/:name", () => {
  test("fetches from zamimg once, then serves the disk cache without the network", async () => {
    const net = network({ [ZAM]: image });
    h = makeHarness({ fetch: net.fetch });
    const first = await h.call("GET", "/api/icons/inv_sword_04");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(JPEG);
    expect(net.urls).toEqual(["https://wow.zamimg.com/images/wow/icons/large/inv_sword_04.jpg"]);
    expect(existsSync(join(h.dataDir, "cache", "icons", "inv_sword_04.jpg"))).toBe(true);

    const second = await h.call("GET", "/api/icons/inv_sword_04");
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(JPEG);
    expect(net.urls).toHaveLength(1);
  });

  test("falls back to Blizzard's render service when zamimg fails", async () => {
    const net = network({ [ZAM]: () => new Response("nope", { status: 404 }), [BLIZ]: image });
    h = makeHarness({ fetch: net.fetch });
    const res = await h.call("GET", "/api/icons/inv_sword_04");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(net.urls.at(-1)).toBe("https://render.worldofwarcraft.com/us/icons/56/inv_sword_04.jpg");
  });

  test("offline: a quality-coloured placeholder that is never cached", async () => {
    const net = network({});
    h = makeHarness({ fetch: net.fetch });
    const epic = await h.call("GET", "/api/icons/inv_sword_04?q=4");
    expect(epic.status).toBe(200);
    expect(epic.headers.get("content-type")).toBe("image/svg+xml");
    expect(epic.headers.get("x-icon-source")).toBe("placeholder");
    expect(epic.headers.get("cache-control")).toBe("no-store");
    expect(await epic.text()).toContain("#a335ee");
    const rare = await h.call("GET", "/api/icons/other_icon?q=3");
    expect(await rare.text()).toContain("#0070dd");
    expect(existsSync(join(h.dataDir, "cache", "icons", "inv_sword_04.jpg"))).toBe(false);
  });

  test("a failed lookup is not retried on every request", async () => {
    const net = network({});
    h = makeHarness({ fetch: net.fetch });
    await h.call("GET", "/api/icons/inv_sword_04");
    const attempts = net.urls.length;
    await h.call("GET", "/api/icons/inv_sword_04");
    expect(net.urls).toHaveLength(attempts);
  });

  test("something that is not an image is not cached as one", async () => {
    const net = network({
      [ZAM]: () => new Response("<html>", { headers: { "content-type": "text/html" } }),
    });
    h = makeHarness({ fetch: net.fetch });
    const res = await h.call("GET", "/api/icons/inv_sword_04");
    expect(res.headers.get("x-icon-source")).toBe("placeholder");
    expect(existsSync(join(h.dataDir, "cache", "icons", "inv_sword_04.jpg"))).toBe(false);
  });

  test("names that could leave the cache directory are refused", async () => {
    const net = network({ [ZAM]: image });
    h = makeHarness({ fetch: net.fetch });
    for (const name of ["..%2F..%2Fdb", "a.b", "A_B", "%00", "a%2Fb"]) {
      const res = await h.call("GET", `/api/icons/${name}`);
      expect(res.status, name).toBe(400);
    }
    expect(net.urls).toEqual([]);
  });
});
