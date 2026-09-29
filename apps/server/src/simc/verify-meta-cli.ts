/**
 * Standalone: checks an installed SimC Build's item-meta against that live SimC. Equips a
 * sample of items (one per actor), runs the build's own simc and compares what it loaded.
 * `bun run verify-meta [tag] [step]`; without a tag it uses the Current SimC Build.
 * Exits 1 on any mismatch.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareWithJson2, launchCommand, sampleItemIds, sampleProfile } from "@simbot/simc";
import { loadConfig } from "../config";
import { currentTag } from "./current-tag";
import { buildDir } from "./install";
import { readBuildMeta } from "./meta";

const { dataDir } = loadConfig();
const tag = process.argv[2] ?? currentTag(dataDir);
const step = Number(process.argv[3] ?? 100);
if (!tag) {
  console.error("no tag given and no Current SimC Build in the database");
  process.exit(1);
}
const built = await readBuildMeta(dataDir, tag);
if (!built) {
  console.error(`no item-meta for ${tag}: run \`bun run build-meta ${tag}\` first`);
  process.exit(1);
}

const tmp = join(dataDir, "tmp", `verify-meta-${crypto.randomUUID()}`);
await mkdir(tmp, { recursive: true });
try {
  const ids = sampleItemIds(built.meta, step);
  await writeFile(join(tmp, "sample.simc"), sampleProfile(built.meta, ids));
  const proc = Bun.spawn(
    launchCommand(buildDir(dataDir, tag), [
      join(tmp, "sample.simc"),
      "iterations=1",
      "max_time=1",
      "report_details=0",
      "item_db_source=local",
      `json2=${join(tmp, "out.json")}`,
      "output=/dev/null",
    ]),
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await proc.exited) !== 0) throw new Error("simc exited with an error");
  const { checked, mismatches } = compareWithJson2(
    built.meta,
    await Bun.file(join(tmp, "out.json")).json(),
  );
  console.log(`checked ${checked} of ${ids.length} sampled items, ${mismatches.length} mismatches`);
  for (const m of mismatches) console.log(`  ${m.id}: meta "${m.meta}" vs simc "${m.simc}"`);
  process.exitCode = mismatches.length === 0 && checked > 0 ? 0 : 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
