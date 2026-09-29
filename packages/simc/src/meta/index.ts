export type { ItemIconSources, ItemIconsResult } from "./build-icons";
export { buildItemIcons, IconCoverageError, iconFor, MIN_ICON_COVERAGE } from "./build-icons";
export type { ItemMetaSources } from "./build-meta";
export {
  appearanceModFor,
  buildItemMeta,
  EQUIPPABLE_ITEM_CLASSES,
  handTypeOf,
  isEquippable,
} from "./build-meta";
export { IncFormatError } from "./inc";
export * from "./schema";
export type { MetaMismatch } from "./verify";
export { compareWithJson2, sampleItemIds, sampleProfile, tokenizeName } from "./verify";
