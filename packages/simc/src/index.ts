// Pure SimC library: build launcher, input builder, progress parser, json2 reader
// and exit-code classifier. No DB or HTTP code belongs here (enforced by Biome).
export { buildPaths, launchCommand } from "./build";
export { type Json2BuildInfo, Json2FormatError, readBuildInfo } from "./json2";
export { probeBuild } from "./probe";
