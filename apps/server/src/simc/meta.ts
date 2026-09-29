import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SimcBuild } from "@simbot/shared";
import {
  buildItemIcons,
  buildItemMeta,
  type ItemIcons,
  type ItemMeta,
  itemIconsSchema,
  itemMetaSchema,
} from "@simbot/simc";
import { createRetry, type Fetch, RegistryError, retryAfterMs } from "./registry";

export const ITEM_META_FILE = "item-meta.json";
export const ITEM_ICONS_FILE = "item-icons.json";

export const metaRoot = (dataDir: string) => join(dataDir, "meta");
export const metaDir = (dataDir: string, tag: string) => join(metaRoot(dataDir), tag);

/** SimC's generated tables at the build's commit: byte-identical to what the binary embeds. */
export const incUrl = (gitRevision: string, table: string) =>
  `https://raw.githubusercontent.com/simulationcraft/simc/${gitRevision}/engine/dbc/generated/${table}.inc`;

/** A DB2 table as CSV, pinned to the SimC Build's game data version. wago.tools is the source. */
export const db2Url = (table: string, gameDataVersion: string) =>
  `https://wago.tools/db2/${table}/csv?build=${encodeURIComponent(gameDataVersion)}`;

export type MetaDeps = {
  fetch: Fetch;
  /** Injected so tests don't wait out backoff. */
  sleep?: (ms: number) => Promise<void>;
};

/** Reads a build's item-meta and item-icons, or null unless both are present and valid. */
export async function readBuildMeta(
  dataDir: string,
  tag: string,
): Promise<{ meta: ItemMeta; icons: ItemIcons } | null> {
  try {
    const dir = metaDir(dataDir, tag);
    const meta = itemMetaSchema.safeParse(
      JSON.parse(await readFile(join(dir, ITEM_META_FILE), "utf8")),
    );
    const icons = itemIconsSchema.safeParse(
      JSON.parse(await readFile(join(dir, ITEM_ICONS_FILE), "utf8")),
    );
    if (!meta.success || !icons.success) return null;
    if (meta.data.tag !== tag || icons.data.tag !== tag) return null;
    return { meta: meta.data, icons: icons.data };
  } catch {
    return null;
  }
}

function createTextFetcher({ fetch, sleep = Bun.sleep }: MetaDeps) {
  const withRetry = createRetry(sleep);
  return (url: string, expectedBuild?: string): Promise<string> =>
    withRetry(`fetching ${new URL(url).host}${new URL(url).pathname}`, async () => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new RegistryError(
          `HTTP ${res.status} from ${new URL(url).host}`,
          res.status >= 500 || res.status === 429,
          retryAfterMs(res),
        );
      }
      // wago.tools names the file after the build it served. Refuse another build's data.
      const served = res.headers.get("content-disposition");
      if (expectedBuild && served && !served.includes(`.${expectedBuild}.`)) {
        throw new RegistryError(`wago.tools served another build than ${expectedBuild}`, false);
      }
      return res.text();
    });
}

/**
 * Builds `item-meta.json` and `item-icons.json` for `build` into `<dataDir>/meta/<tag>/`,
 * through `.partial/` so a failure leaves nothing behind. Does nothing when both files are
 * already there and valid. Throws on any failure: callers decide whether that is fatal.
 */
export async function ensureBuildMeta(
  opts: { dataDir: string; build: SimcBuild } & MetaDeps,
): Promise<{ built: false } | { built: true; equippable: number; resolved: number }> {
  const { dataDir, build } = opts;
  if (await readBuildMeta(dataDir, build.tag)) return { built: false };

  const get = createTextFetcher(opts);
  const { gitRevision, gameDataVersion, tag } = build;
  const db2 = (table: string) => get(db2Url(table, gameDataVersion), gameDataVersion);

  const [itemDataInc, itemEffectInc, itemBonusInc] = await Promise.all(
    ["item_data", "item_effect", "item_bonus"].map((t) => get(incUrl(gitRevision, t))),
  );
  const [itemSparseCsv, itemLimitCategoryCsv, itemCsv] = [
    await db2("ItemSparse"),
    await db2("ItemLimitCategory"),
    await db2("Item"),
  ];
  const itemModifiedAppearanceCsv = await db2("ItemModifiedAppearance");
  const itemAppearanceCsv = await db2("ItemAppearance");
  const manifestInterfaceDataCsv = await db2("ManifestInterfaceData");

  const meta = buildItemMeta(
    { tag, gitRevision, gameDataVersion },
    {
      itemDataInc: itemDataInc as string,
      itemEffectInc: itemEffectInc as string,
      itemBonusInc: itemBonusInc as string,
      itemSparseCsv,
      itemLimitCategoryCsv,
    },
  );
  const { icons, equippable, resolved } = buildItemIcons(
    { tag, gameDataVersion },
    { itemCsv, itemModifiedAppearanceCsv, itemAppearanceCsv, manifestInterfaceDataCsv },
  );

  const final = metaDir(dataDir, tag);
  const partial = join(metaRoot(dataDir), ".partial", tag);
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    await writeFile(join(partial, ITEM_META_FILE), JSON.stringify(meta));
    await writeFile(join(partial, ITEM_ICONS_FILE), JSON.stringify(icons));
    await rm(final, { recursive: true, force: true });
    await rename(partial, final);
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    throw err;
  }
  return { built: true, equippable, resolved };
}
