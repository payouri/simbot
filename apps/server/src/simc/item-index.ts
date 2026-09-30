import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ImportItem,
  ImportItemsResponse,
  ItemIndex,
  ItemPass,
  SimcBuild,
} from "@simbot/shared";
import {
  appearanceModFor,
  assembleIndex,
  BASE_ACTOR,
  classifyExit,
  classifyItems,
  type ItemIcons,
  type ItemMeta,
  iconFor,
  initErrorActor,
  itemPassArgs,
  launchCommand,
  parseAddonString,
  parseItemLine,
  planItemPass,
  type RawItem,
  readItemPass,
  renderItemPass,
} from "@simbot/simc";
import type { Db } from "../db";
import { getImportText, getItemIndex, saveItemIndex } from "../db/imports";
import type { Launch } from "./check-sim";
import { readBuildMeta } from "./meta";

/** A wedged SimC must not hold an Import request forever. A real pass takes well under 1 s. */
const PASS_TIMEOUT_MS = 60_000;
const STDERR_KEEP = 2000;
/** How many times a pass drops the actor SimC blames and runs again. */
const MAX_DROPS = 5;

export type ItemIndexerDeps = {
  db: Db;
  dataDir: string;
  /** The Current SimC Build, or null when there is none. */
  currentBuild: () => Promise<SimcBuild | null>;
  launch?: Launch;
  log?: (message: string) => void;
  clock?: () => number;
};

type PassOutcome =
  | { ok: true; json2: string; ms: number; actors: number }
  | { ok: false; reason: string; ms: number };

/** Runs SimC on `input`; when it blames one actor, drops that actor's candidates and retries. */
async function runPass(opts: {
  dir: string;
  tmpRoot: string;
  launch: Launch;
  clock: () => number;
  render: (exclude: ReadonlySet<string>) => string;
  actorNames: readonly string[];
}): Promise<PassOutcome & { dropped: string[] }> {
  const started = opts.clock();
  await mkdir(opts.tmpRoot, { recursive: true });
  const work = await mkdtemp(join(opts.tmpRoot, "item-pass-"));
  const dropped: string[] = [];
  try {
    for (;;) {
      const inputPath = join(work, "pass.simc");
      const json2Path = join(work, "pass.json");
      await rm(json2Path, { force: true });
      await writeFile(inputPath, opts.render(new Set(dropped)));
      let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
      try {
        proc = Bun.spawn(opts.launch(opts.dir, itemPassArgs(inputPath, json2Path)), {
          cwd: work,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          timeout: PASS_TIMEOUT_MS,
        });
      } catch (err) {
        const reason = `Could not start SimC: ${err instanceof Error ? err.message : String(err)}`;
        return { ok: false, reason, ms: opts.clock() - started, dropped };
      }
      const [, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const ms = opts.clock() - started;
      if (exitCode === 0) {
        const json2 = await readFile(json2Path, "utf8").catch(() => null);
        if (json2 === null) return { ok: false, reason: "SimC wrote no json2 report", ms, dropped };
        return { ok: true, json2, ms, actors: opts.actorNames.length - dropped.length, dropped };
      }
      const blamed = initErrorActor(stderr);
      if (
        blamed &&
        blamed !== BASE_ACTOR &&
        !dropped.includes(blamed) &&
        dropped.length < MAX_DROPS
      ) {
        dropped.push(blamed);
        continue;
      }
      const reason = classifyExit(proc.signalCode ? null : exitCode, stderr.slice(-STDERR_KEEP));
      return { ok: false, reason: reason.message, ms, dropped };
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const qualityOf = (meta: ItemMeta, bonusIds: readonly number[], base: number) => {
  let quality = base;
  for (const id of bonusIds) quality = meta.bonuses[id]?.quality ?? quality;
  return quality;
};

/** `relentless_riders_crown` -> `Relentless Riders Crown`, for items the meta does not know. */
function nameFromLine(rawLine: string): string | null {
  const name = rawLine
    .slice(rawLine.indexOf("=") + 1)
    .split(",")[0]
    ?.trim();
  return name ? name.replaceAll("_", " ").replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
}

/**
 * Owns the item index of Imports: runs the packed SimC pass, stores the result on the Import
 * (recomputed when the Current SimC Build changes), and joins it with item-meta for display.
 */
export function createItemIndexer(deps: ItemIndexerDeps) {
  const { db, dataDir, log = console.error, clock = performance.now.bind(performance) } = deps;
  const launch = deps.launch ?? launchCommand;
  const metaCache = new Map<string, { meta: ItemMeta; icons: ItemIcons } | null>();
  const inflight = new Map<number, Promise<ItemIndex | null>>();

  const metaFor = async (tag: string) => {
    if (!metaCache.get(tag)) metaCache.set(tag, await readBuildMeta(dataDir, tag));
    return metaCache.get(tag) ?? null;
  };

  async function compute(
    importId: number,
    text: string,
    build: SimcBuild | null,
  ): Promise<ItemIndex> {
    const parsed = parseAddonString(text);
    const raw: RawItem[] = [
      ...parsed.equippedItems.map((i) => ({ slot: i.slot, source: i.source, rawLine: i.rawLine })),
      ...parsed.candidateItems.map((i) => ({ slot: i.slot, source: i.source, rawLine: i.rawLine })),
    ];
    const unknownFields = parsed.report.unknownFields;
    // Without a build or its item data nothing can be checked: every item is shown, unread.
    const noPass = (reason: string): ItemIndex => ({
      simcTag: build?.tag ?? null,
      pass: { status: "skipped", reason, ms: null, actors: 0 },
      items: raw.map((r, index) => {
        const p = parseItemLine(r.rawLine);
        return {
          index,
          slot: p.slot,
          source: r.source,
          rawLine: r.rawLine,
          itemId: p.itemId,
          bonusIds: p.bonusIds,
          status: "unresolved" as const,
          ilvl: null,
          stats: null,
        };
      }),
      unknown: { unknownFields, items: [], itemIds: [], bonusIds: [] },
    });
    if (!build) return noPass("no SimC Build is installed");
    const data = await metaFor(build.tag);
    if (!data) return noPass(`no item data for SimC Build ${build.tag}`);

    const { items, unknown } = classifyItems(raw, data.meta);
    const plan = planItemPass(text, items, data.meta);
    const result = (pass: ItemPass, numbers = new Map()): ItemIndex => ({
      simcTag: build.tag,
      pass,
      items: assembleIndex(items, numbers),
      unknown: { unknownFields, ...unknown },
    });
    if (plan.skipped !== undefined) {
      return result({ status: "skipped", reason: plan.skipped, ms: null, actors: 0 });
    }
    if (raw.length === 0) return result({ status: "ok", reason: null, ms: 0, actors: 0 });

    const outcome = await runPass({
      dir: join(dataDir, "simc", build.tag),
      tmpRoot: join(dataDir, "tmp"),
      launch,
      clock,
      render: (exclude) => renderItemPass(plan, items, exclude),
      actorNames: plan.actors.map((a) => a.name),
    });
    if (!outcome.ok) {
      log(`item pass for Import ${importId} failed: ${outcome.reason}`);
      return result({
        status: "failed",
        reason: outcome.reason,
        ms: Math.round(outcome.ms),
        actors: 0,
      });
    }
    // The actors SimC rejected were left out of the run, so their placements read as missing.
    const numbers = readItemPass(plan, items, outcome.json2);
    return result(
      { status: "ok", reason: null, ms: Math.round(outcome.ms), actors: outcome.actors },
      numbers,
    );
  }

  /** Makes sure the Import has an item index for the Current SimC Build, and returns it. */
  function ensure(importId: number): Promise<ItemIndex | null> {
    const running = inflight.get(importId);
    if (running) return running;
    const job = (async () => {
      const text = getImportText(db, importId);
      if (text === null) return null;
      const build = await deps.currentBuild();
      const stored = getItemIndex(db, importId);
      if (stored && stored.simcTag === (build?.tag ?? null)) return stored;
      try {
        const index = await compute(importId, text, build);
        saveItemIndex(db, importId, index);
        return index;
      } catch (err) {
        // The Import already succeeded; a pass that cannot be read leaves it without numbers.
        log(`item pass for Import ${importId} failed: ${err}`);
        return null;
      }
    })().finally(() => inflight.delete(importId));
    inflight.set(importId, job);
    return job;
  }

  /** The Import's items, numbers from the index joined with the static fields of item-meta. */
  async function view(importId: number): Promise<ImportItemsResponse | null> {
    if (getImportText(db, importId) === null) return null;
    const index = await ensure(importId);
    if (!index) {
      return {
        importId,
        simcTag: null,
        pass: { status: "failed", reason: "the item pass could not be read", ms: null, actors: 0 },
        items: [],
        unknown: { unknownFields: [], items: [], itemIds: [], bonusIds: [] },
      };
    }
    const data = index.simcTag ? await metaFor(index.simcTag) : null;
    const items = index.items.map((i): ImportItem => {
      const meta = data?.meta;
      const known = i.itemId !== null ? meta?.items[i.itemId] : undefined;
      // An Unknown Item is a placeholder: bonuses SimC does not know decide quality and icon.
      const shown = i.status === "unknown" ? undefined : known;
      return {
        ...i,
        name: known?.name ?? nameFromLine(i.rawLine),
        quality: meta && shown ? qualityOf(meta, i.bonusIds, shown.quality) : null,
        icon:
          data && meta && shown && i.itemId !== null
            ? (iconFor(data.icons, i.itemId, appearanceModFor(meta, i.bonusIds)) ?? null)
            : null,
        selectable: i.source !== "equipped" && i.status === "ok",
      };
    });
    return { importId, simcTag: index.simcTag, pass: index.pass, items, unknown: index.unknown };
  }

  /** The item-meta of a SimC Build, or null when the build has none. */
  async function meta(tag: string): Promise<ItemMeta | null> {
    return (await metaFor(tag))?.meta ?? null;
  }

  return { ensure, view, meta };
}

export type ItemIndexer = ReturnType<typeof createItemIndexer>;
