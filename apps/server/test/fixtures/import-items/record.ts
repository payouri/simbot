/**
 * Records the packed pass for `addon-string.txt` from a real SimC Build:
 *
 *   SIMC_DIR=<data>/simc/<tag> bun apps/server/test/fixtures/import-items/record.ts <scenario-dir>
 *
 * It renders the pass exactly as the server does (against the trimmed `item-meta.json` next to
 * it), runs the SimC Build, and writes `json2.json.gz`, `stderr.txt` and `exit` into the
 * scenario directory. `input.simc` is kept beside them for reading, not replayed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  classifyItems,
  itemMetaSchema,
  itemPassArgs,
  launchCommand,
  parseAddonString,
  planItemPass,
  renderItemPass,
} from "@simbot/simc";

const here = import.meta.dir;
const [scenario] = process.argv.slice(2);
const simcDir = process.env.SIMC_DIR;
if (!scenario || !simcDir) throw new Error("usage: SIMC_DIR=<build dir> record.ts <scenario-dir>");

/** `EXCLUDE=o0,c4` leaves those actors out, as the server does on its retry after an init error. */
const exclude = new Set((process.env.EXCLUDE ?? "").split(",").filter(Boolean));

const text = readFileSync(join(here, "addon-string.txt"), "utf8");
const meta = itemMetaSchema.parse(JSON.parse(readFileSync(join(here, "item-meta.json"), "utf8")));
const parsed = parseAddonString(text);
const { items } = classifyItems(
  [...parsed.equippedItems, ...parsed.candidateItems].map((i) => ({
    slot: i.slot,
    source: i.source,
    rawLine: i.rawLine,
  })),
  meta,
);
const plan = planItemPass(text, items, meta);
if (plan.skipped !== undefined) throw new Error(plan.skipped);

mkdirSync(scenario, { recursive: true });
const input = join(scenario, "input.simc");
const json2 = join(scenario, "pass.json");
writeFileSync(input, renderItemPass(plan, items, exclude));
const proc = Bun.spawnSync(launchCommand(simcDir, itemPassArgs(input, json2)));
writeFileSync(join(scenario, "stderr.txt"), proc.stderr);
writeFileSync(join(scenario, "exit"), String(proc.exitCode));
try {
  writeFileSync(join(scenario, "json2.json.gz"), gzipSync(readFileSync(json2)));
} catch {
  // SimC wrote no report.
}
