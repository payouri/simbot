// Pure SimC library: build launcher, input builder, progress parser, json2 reader
// and exit-code classifier. No DB or HTTP code belongs here (enforced by Biome).
export {
  AddonStringError,
  adler32,
  type CandidateItem,
  type EquippedItem,
  equippedTalentsLine,
  isClassKey,
  isEquipmentSlot,
  type ParsedAddonString,
  type ProfileHeader,
  parseAddonString,
  parseConsumables,
  parseProfileHeader,
  type TalentLoadout,
} from "./addon-string";
export { buildPaths, launchCommand } from "./build";
export {
  buildCheckSimInput,
  CHECK_SIM_PROFILESET,
  CHECK_SIM_TARGET_ERROR,
  isPlayerProfile,
  readCheckSimResult,
} from "./check-sim";
export {
  assembleIndex,
  BASE_ACTOR,
  type ClassifiedItem,
  classifyItems,
  type ItemNumbers,
  ItemPassFormatError,
  type ItemPassPlan,
  initErrorActor,
  itemPassArgs,
  type ParsedItemLine,
  type PassActor,
  parseItemLine,
  planItemPass,
  type RawItem,
  readItemPass,
  renderItemPass,
} from "./item-pass";
export { type Json2BuildInfo, Json2FormatError, readBuildInfo } from "./json2";
export * from "./meta";
export { probeBuild } from "./probe";
export {
  createLineSplitter,
  createProgressParser,
  type IterationProgress,
  type ParsedLine,
  type ProfilesetAggregate,
  type ProgressLine,
  parseDuration,
  parseProgressLine,
  toSimProgress,
} from "./progress";
export {
  buildInput,
  classifyExit,
  PRECISION_TARGET_ERROR,
  readQuickSimResult,
  stageArgs,
} from "./quick-sim";
