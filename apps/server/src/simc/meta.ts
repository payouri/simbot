import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

/**
 * Item data built before bonus icon overrides and limit conditions were read: its icons lack
 * `bonusIcons`. Both files are built together, so this one marker covers the pair. It is still
 * usable (no override applies, no condition is known), so readers keep it while
 * `ensureBuildMeta` rebuilds it, and keep it when the rebuild fails.
 */
export const isStaleMeta = (data: { icons: ItemIcons }) => data.icons.bonusIcons === undefined;

/** Reads a build's item-meta and item-icons, or null unless both are present and valid. */
export const readBuildMeta = (dataDir: string, tag: string) =>
  readMetaDir(metaDir(dataDir, tag), tag);

/** Reads item-meta and item-icons from any directory (a data dir's `meta/<tag>/` or the seed's). */
export async function readMetaDir(
  dir: string,
  tag: string,
): Promise<{ meta: ItemMeta; icons: ItemIcons } | null> {
  try {
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

/**
 * Installs item data that is already built (the Seed SimC Build's baked meta) as `meta/<tag>/`,
 * through `.partial/`. Throws unless `srcDir` holds a valid pair for `tag`.
 */
export async function installMetaFrom(dataDir: string, tag: string, srcDir: string) {
  if (!(await readMetaDir(srcDir, tag)))
    throw new Error(`no valid item data for ${tag} in ${srcDir}`);
  const partial = join(metaRoot(dataDir), ".partial", tag);
  await rm(partial, { recursive: true, force: true });
  await mkdir(join(metaRoot(dataDir), ".partial"), { recursive: true });
  try {
    await cp(srcDir, partial, { recursive: true });
    await rm(metaDir(dataDir, tag), { recursive: true, force: true });
    await rename(partial, metaDir(dataDir, tag));
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    throw err;
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
 * already there, valid and not stale. A stale pair stays in place until its rebuild succeeds.
 * Throws on any failure: callers decide whether that is fatal.
 */
export async function ensureBuildMeta(
  opts: { dataDir: string; build: SimcBuild } & MetaDeps,
): Promise<{ built: false } | { built: true; equippable: number; resolved: number }> {
  const { dataDir, build } = opts;
  const existing = await readBuildMeta(dataDir, build.tag);
  if (existing && !isStaleMeta(existing)) return { built: false };

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
  const itemLimitCategoryConditionCsv = await db2("ItemLimitCategoryCondition");

  const meta = buildItemMeta(
    { tag, gitRevision, gameDataVersion },
    {
      itemDataInc: itemDataInc as string,
      itemEffectInc: itemEffectInc as string,
      itemBonusInc: itemBonusInc as string,
      itemSparseCsv,
      itemLimitCategoryCsv,
      itemLimitCategoryConditionCsv,
    },
  );
  const { icons, equippable, resolved } = buildItemIcons(
    { tag, gameDataVersion },
    {
      itemCsv,
      itemModifiedAppearanceCsv,
      itemAppearanceCsv,
      manifestInterfaceDataCsv,
      itemBonusInc: itemBonusInc as string,
    },
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
