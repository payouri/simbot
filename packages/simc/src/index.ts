// Pure SimC library: build launcher, input builder, progress parser, json2 reader
// and exit-code classifier. No DB or HTTP code belongs here (enforced by Biome).
export { AddonStringError, type ProfileHeader, parseProfileHeader } from "./addon-string";
export { buildPaths, launchCommand } from "./build";
export { type Json2BuildInfo, Json2FormatError, readBuildInfo } from "./json2";
export { probeBuild } from "./probe";
export {
  buildInput,
  classifyExit,
  PRECISION_TARGET_ERROR,
  readQuickSimResult,
  stageArgs,
} from "./quick-sim";
