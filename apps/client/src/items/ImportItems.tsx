import type { ImportItem, ImportItemsResponse, ItemStats, UnknownReport } from "@simbot/shared";
import { Link } from "react-router";
import { useSimcStatus } from "../simc/api";
import { iconUrl, useImportItems } from "./api";
import { useWowheadTooltips } from "./wowhead";

const QUALITY_VAR = [
  "--q-poor",
  "--q-common",
  "--q-uncommon",
  "--q-rare-text",
  "--q-epic-text",
  "--q-legendary",
  "--q-legendary",
  "--q-legendary",
];
const QUALITY_BORDER_VAR = [
  "--q-poor",
  "--q-common",
  "--q-uncommon",
  "--q-rare",
  "--q-epic",
  "--q-legendary",
  "--q-legendary",
  "--q-legendary",
];
const qualityText = (q: number | null) => `var(${QUALITY_VAR[q ?? 1] ?? "--fg-muted"})`;
const qualityBorder = (q: number | null) => `var(${QUALITY_BORDER_VAR[q ?? 1] ?? "--line-strong"})`;

const STAT_LABEL: Record<string, string> = {
  strint: "Str/Int",
  stragi: "Str/Agi",
  stragiint: "Primary",
  strength: "Str",
  agility: "Agi",
  intellect: "Int",
  stamina: "Sta",
  crit_rating: "Crit",
  haste_rating: "Haste",
  mastery_rating: "Mastery",
  versatility_rating: "Vers",
  avoidance_rating: "Avoid",
  leech_rating: "Leech",
  speed_rating: "Speed",
  parry_rating: "Parry",
  dodge_rating: "Dodge",
  armor: "Armor",
};
/** Stat lines of an item: secondaries and primaries, stamina last. */
const STAT_ORDER = ["strint", "stragi", "stragiint", "strength", "agility", "intellect"];
const statLabel = (key: string) =>
  STAT_LABEL[key] ?? key.replace(/_rating$/, "").replaceAll("_", " ");

function statLine(stats: ItemStats): { key: string; value: number }[] {
  return Object.entries(stats)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => {
      const rank = (k: string) => (STAT_ORDER.includes(k) ? 0 : k === "stamina" ? 2 : 1);
      return rank(a.key) - rank(b.key) || b.value - a.value;
    });
}

const SLOT_LABEL: Record<string, string> = {
  head: "Head",
  neck: "Neck",
  shoulders: "Shoulders",
  back: "Back",
  chest: "Chest",
  wrists: "Wrists",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  finger1: "Finger",
  finger2: "Finger",
  trinket1: "Trinket",
  trinket2: "Trinket",
  main_hand: "Weapon",
  off_hand: "Off-hand",
};
const SLOT_ORDER = Object.keys(SLOT_LABEL);
const slotRank = (slot: string) => {
  const at = SLOT_ORDER.indexOf(slot);
  return at < 0 ? SLOT_ORDER.length : at;
};

function wowheadData(item: ImportItem): string | undefined {
  if (item.itemId === null || item.status === "unknown") return undefined;
  const bonus = item.bonusIds.length ? `&bonus=${item.bonusIds.join(":")}` : "";
  return `item=${item.itemId}${bonus}${item.ilvl ? `&ilvl=${item.ilvl}` : ""}`;
}

function ItemIcon({ item }: { item: ImportItem }) {
  const border = qualityBorder(item.quality);
  return (
    <span
      className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[6px] border bg-sunk"
      style={{ borderColor: border }}
    >
      {item.icon ? (
        <img src={iconUrl(item.icon, item.quality)} alt="" width={36} height={36} loading="lazy" />
      ) : (
        <span aria-hidden="true" className="text-[15px] font-semibold text-faint">
          ?
        </span>
      )}
    </span>
  );
}

function ItemRow({ item }: { item: ImportItem }) {
  const unknown = item.status === "unknown";
  const candidate = item.source !== "equipped";
  const name = item.name ?? (item.itemId === null ? "Unknown item" : `Item ${item.itemId}`);
  const wowhead = wowheadData(item);
  const stats = item.stats ? statLine(item.stats) : [];
  return (
    <li
      className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${unknown ? "bg-loss-wash" : ""} ${
        candidate && !item.selectable ? "opacity-70" : ""
      }`}
      data-status={item.status}
      data-selectable={candidate ? item.selectable : undefined}
    >
      <ItemIcon item={item} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-[13px]">
          {wowhead && item.itemId !== null ? (
            <a
              href={`https://www.wowhead.com/item=${item.itemId}`}
              data-wowhead={wowhead}
              target="_blank"
              rel="noreferrer"
              className="truncate font-medium hover:underline"
              style={{ color: qualityText(item.quality) }}
            >
              {name}
            </a>
          ) : (
            <span className="truncate font-medium" style={{ color: qualityText(item.quality) }}>
              {name}
            </span>
          )}
          <span className="shrink-0 text-[11.5px] text-faint">
            {SLOT_LABEL[item.slot] ?? item.slot}
          </span>
        </p>
        <p className="num truncate text-[11.5px] text-muted">
          {unknown
            ? "Unknown to this SimC Build"
            : item.status === "unresolved"
              ? "No numbers: SimC did not read this item"
              : stats.map((s) => `${s.value} ${statLabel(s.key)}`).join("  ")}
        </p>
      </div>
      <span className="num shrink-0 text-[13px]" title="Item level">
        {item.ilvl ?? "-"}
      </span>
      {candidate && !item.selectable && (
        <span className="shrink-0 rounded-[4px] px-1.5 text-[11px] text-faint ring-1 ring-line">
          {unknown ? "Not selectable" : "Unread"}
        </span>
      )}
    </li>
  );
}

function Section({ title, items }: { title: string; items: ImportItem[] }) {
  if (items.length === 0) return null;
  const sorted = [...items].sort(
    (a, b) => slotRank(a.slot) - slotRank(b.slot) || a.index - b.index,
  );
  return (
    <section className="mt-5">
      <h3 className="text-[12.5px] font-semibold text-muted">
        {title} <span className="num font-normal text-faint">{items.length}</span>
      </h3>
      <ul className="mt-1.5 flex flex-col">
        {sorted.map((item) => (
          <ItemRow key={item.index} item={item} />
        ))}
      </ul>
    </section>
  );
}

function UnknownDetail({ unknown }: { unknown: UnknownReport }) {
  return (
    <details className="mt-2 text-[12.5px]">
      <summary className="cursor-pointer text-muted">What was unknown</summary>
      <div className="mt-2 flex flex-col gap-3 rounded-lg bg-sunk p-3">
        {unknown.itemIds.length > 0 && (
          <p>
            <span className="text-faint">Item ids </span>
            <span className="num">{unknown.itemIds.join(", ")}</span>
          </p>
        )}
        {unknown.bonusIds.length > 0 && (
          <p>
            <span className="text-faint">Bonus ids </span>
            <span className="num">{unknown.bonusIds.join(", ")}</span>
          </p>
        )}
        {unknown.unknownFields.length > 0 && (
          <p>
            <span className="text-faint">Fields ignored </span>
            <span className="num">{unknown.unknownFields.join(", ")}</span>
          </p>
        )}
        {unknown.items.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {unknown.items.map((u) => (
              <li key={u.index} className="num text-[11.5px]">
                <span className="text-muted">
                  {u.source.replace("_", " ")} / {u.slot}
                </span>{" "}
                {u.unknownItemId
                  ? `item ${u.itemId ?? "(no id)"} unknown`
                  : `item ${u.itemId}, bonus ${u.unknownBonusIds.join(", ")} unknown`}
                <br />
                <span className="break-all text-faint">{u.rawLine}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/** Warns about Unknown Items; points at the SimC page when a newer SimC Build can be installed. */
function UnknownBanner({ unknown }: { unknown: UnknownReport }) {
  const simc = useSimcStatus();
  const installable = simc.data?.update?.state === "installable";
  const count = unknown.items.length;
  const equipped = unknown.items.some((u) => u.source === "equipped");
  if (count === 0 && unknown.unknownFields.length === 0) return null;
  return (
    <div role="status" className="mt-4 rounded-lg border border-loss/35 bg-loss-wash p-3">
      {count > 0 && (
        <p className="text-[12.5px]">
          {count} item{count === 1 ? " is" : "s are"} unknown to this SimC Build.
          {equipped && " Equipped ones are still simmed as SimC reads them."} Candidate ones show as
          placeholders and cannot be selected.{" "}
          {installable && (
            <>
              A newer SimC Build can be installed:{" "}
              <Link to="/simc" className="underline">
                open the SimC page
              </Link>
              .
            </>
          )}
        </p>
      )}
      <UnknownDetail unknown={unknown} />
    </div>
  );
}

function PassNote({ pass }: { pass: ImportItemsResponse["pass"] }) {
  if (pass.status === "ok") return null;
  return (
    <p className="mt-3 text-[12.5px] text-muted">
      Item numbers are not available
      {pass.reason ? `: ${pass.reason}` : ""}. Names and icons still show.
    </p>
  );
}

/** Every item of an Import with icon, name, ilvl, stats and quality, and its Unknown Items. */
export function ImportItems({ importId }: { importId: number }) {
  const query = useImportItems(importId);
  useWowheadTooltips(query.data);
  if (query.isPending) return <p className="mt-6 text-[12.5px] text-muted">Loading gear…</p>;
  if (query.isError) return <p className="mt-6 text-[12.5px] text-loss">Could not load gear.</p>;
  const { items, unknown, pass } = query.data;
  const by = (source: string) => items.filter((i) => i.source === source);
  return (
    <div className="mt-8">
      <h2 className="text-[14px] font-semibold">Gear</h2>
      <UnknownBanner unknown={unknown} />
      <PassNote pass={pass} />
      <Section title="Equipped" items={by("equipped")} />
      <Section title="Bags" items={by("bags")} />
      <Section title="Great Vault" items={by("great_vault")} />
      <Section title="Linked" items={by("linked")} />
    </div>
  );
}
