/**
 * Image build step: `bun bake-seed-cli.ts <seed-root> <tag>`. The Dockerfile has copied the
 * official image's SimC files to `<seed-root>/simc/<tag>/`. This runs that build once to record
 * its `build.json`, then builds its item-meta and item-icons into `<seed-root>/meta/<tag>/`
 * (network needed, at image build time only) so the first start works offline.
 */
import { join } from "node:path";
import { simcBuildSchema } from "@simbot/shared";
import { probeBuild } from "@simbot/simc";
import { ensureBuildMeta } from "./meta";

const [root, tag] = process.argv.slice(2);
if (!root || !tag) {
  console.error("usage: bake-seed-cli <seed-root> <tag>");
  process.exit(1);
}
const dir = join(root, "simc", tag);
const build = simcBuildSchema.parse({ tag, ...(await probeBuild(dir)) });
await Bun.write(join(dir, "build.json"), JSON.stringify(build, null, 2));
const result = await ensureBuildMeta({ dataDir: root, build, fetch });
console.log(
  `seed ${tag}: baked item data (${result.built ? `${result.resolved}/${result.equippable} icons` : "already there"})`,
);
