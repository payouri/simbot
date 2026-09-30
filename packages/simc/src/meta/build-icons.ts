import { isEquippable } from "./build-meta";
import { readCsvColumns } from "./csv";
import { parseItemBonuses } from "./inc";
import type { ItemIcons } from "./schema";

export type ItemIconSources = {
  /** DB2 tables at the build's game data version. */
  itemCsv: string;
  itemModifiedAppearanceCsv: string;
  itemAppearanceCsv: string;
  manifestInterfaceDataCsv: string;
  /** `item_bonus.inc` at the build's git_revision, for bonus type 28 icon overrides. */
  itemBonusInc: string;
};

export type IconBuildIdentity = { tag: string; gameDataVersion: string };

/** Share of equippable items that must resolve to an icon; below it the join is broken. */
export const MIN_ICON_COVERAGE = 0.99;

export type ItemIconsResult = {
  icons: ItemIcons;
  /** Equippable armour and weapons in `Item`, and how many of them got an icon. */
  equippable: number;
  resolved: number;
};

export class IconCoverageError extends Error {
  constructor(coverage: number) {
    super(
      `item-icons covers ${(coverage * 100).toFixed(2)}% of equippable items, ` +
        `below ${MIN_ICON_COVERAGE * 100}%: the DB2 join is probably broken`,
    );
    this.name = "IconCoverageError";
  }
}

const BONUS_ICON = 28;
const ICON_DIR = "interface\\icons\\";

/** `Interface\Icons\INV_Chest Samurai.blp` -> `inv_chest_samurai`; null outside the icon dir. */
export function iconNameOf(filePath: string, fileName: string): string | null {
  if (!filePath.toLowerCase().startsWith(ICON_DIR)) return null;
  if (!fileName.toLowerCase().endsWith(".blp")) return null;
  return fileName.slice(0, -4).toLowerCase().replaceAll(" ", "_");
}

/**
 * Item.IconFileDataID -> (when 0) ItemModifiedAppearance -> ItemAppearance.DefaultIconFileDataID
 * -> ManifestInterfaceData file name. Items with several appearance modifiers whose icons
 * differ also get a per-modifier map, so tier pieces show the difficulty-correct icon.
 * Throws `IconCoverageError` when fewer than 99% of equippable items resolve.
 */
export function buildItemIcons(build: IconBuildIdentity, src: ItemIconSources): ItemIconsResult {
  const iconByFile = new Map<number, string>();
  for (const [id, path, name] of readCsvColumns(src.manifestInterfaceDataCsv, [
    "ID",
    "FilePath",
    "FileName",
  ])) {
    const icon = iconNameOf(path as string, name as string);
    if (icon) iconByFile.set(Number(id), icon);
  }

  // Bonus type 28: value_1 is the icon's FileDataID. Across a bonus id's rows the first wins.
  const bonusIcons: Record<string, string> = {};
  for (const row of [...parseItemBonuses(src.itemBonusInc)].sort((a, b) => a.index - b.index)) {
    if (row.type !== BONUS_ICON) continue;
    const icon = iconByFile.get(row.value1);
    if (icon) bonusIcons[row.bonusId] ??= icon;
  }

  const appearanceIcon = new Map<number, number>();
  for (const [id, icon] of readCsvColumns(src.itemAppearanceCsv, ["ID", "DefaultIconFileDataID"])) {
    appearanceIcon.set(Number(id), Number(icon));
  }

  // itemId -> [modifier, orderIndex, icon name] for every appearance that resolves.
  const appearances = new Map<number, [number, number, string][]>();
  const modRows = readCsvColumns(src.itemModifiedAppearanceCsv, [
    "ItemID",
    "ItemAppearanceModifierID",
    "ItemAppearanceID",
    "OrderIndex",
  ]);
  for (const [itemId, mod, appearanceId, order] of modRows) {
    const icon = iconByFile.get(appearanceIcon.get(Number(appearanceId)) ?? 0);
    if (!icon) continue;
    const entry: [number, number, string] = [Number(mod), Number(order), icon];
    const list = appearances.get(Number(itemId));
    if (list) list.push(entry);
    else appearances.set(Number(itemId), [entry]);
  }

  const items: ItemIcons["items"] = {};
  const appearanceMods: ItemIcons["appearanceMods"] = {};
  let equippable = 0;
  let resolved = 0;
  const itemRows = readCsvColumns(src.itemCsv, [
    "ID",
    "ClassID",
    "InventoryType",
    "IconFileDataID",
  ]);
  for (const [id, classId, inventoryType, iconFile] of itemRows) {
    if (!isEquippable(Number(classId), Number(inventoryType))) continue;
    equippable++;
    const own = iconByFile.get(Number(iconFile));
    const list = appearances.get(Number(id));
    let icon = own;
    if (!icon && list) {
      // Default appearance: modifier 0 if there is one, else the lowest modifier.
      list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      icon = list[0]?.[2];
      const byMod: Record<string, string> = {};
      for (const [mod, , name] of list) byMod[mod] ??= name;
      if (new Set(Object.values(byMod)).size > 1) appearanceMods[id as string] = byMod;
    }
    if (!icon) continue;
    items[id as string] = icon;
    resolved++;
  }

  const coverage = equippable === 0 ? 0 : resolved / equippable;
  if (coverage < MIN_ICON_COVERAGE) throw new IconCoverageError(coverage);
  return {
    icons: {
      schemaVersion: 1,
      tag: build.tag,
      gameDataVersion: build.gameDataVersion,
      items,
      appearanceMods,
      bonusIcons,
    },
    equippable,
    resolved,
  };
}

/**
 * The icon for an item: a bonus icon override (type 28) if one of `bonusIds` has one, else the
 * per-appearance icon when it depends on the appearance modifier, else the item's own.
 */
export function iconFor(
  icons: ItemIcons,
  itemId: number,
  appearanceMod?: number,
  bonusIds: readonly number[] = [],
): string | undefined {
  for (const id of bonusIds) {
    const override = icons.bonusIcons?.[id];
    if (override) return override;
  }
  const perMod = appearanceMod === undefined ? undefined : icons.appearanceMods[itemId];
  return perMod?.[appearanceMod as number] ?? icons.items[itemId];
}
