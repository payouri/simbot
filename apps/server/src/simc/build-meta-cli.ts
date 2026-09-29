/**
 * Standalone: builds `meta/<tag>/item-meta.json` and `item-icons.json` for an installed SimC
 * Build. `bun run build-meta [tag]`; without a tag it uses the Current SimC Build.
 * Honours SIMBOT_DATA_DIR like the server does.
 */
import { loadConfig } from "../config";
import { currentTag } from "./current-tag";
import { readInstalledBuild } from "./install";
import { ensureBuildMeta, metaDir } from "./meta";

const { dataDir } = loadConfig();

const tag = process.argv[2] ?? currentTag(dataDir);
if (!tag) {
  console.error("no tag given and no Current SimC Build in the database");
  process.exit(1);
}
const build = await readInstalledBuild(dataDir, tag);
if (!build) {
  console.error(`SimC Build ${tag} is not installed under ${dataDir}/simc`);
  process.exit(1);
}
const result = await ensureBuildMeta({ dataDir, build, fetch });
console.log(
  result.built
    ? `built ${metaDir(dataDir, tag)} (icons: ${result.resolved}/${result.equippable} equippable items)`
    : `${metaDir(dataDir, tag)} is already up to date`,
);
