import {
  changedSlots,
  moveSelection,
  PAPERDOLL_LABEL,
  type PaperdollSlot,
  type RankedRow,
  type Sim,
  type SimResultsResponse,
  type VerdictKind,
  verdictFor,
} from "@simbot/shared";
import { useMutation } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { Equal, Hourglass, ShieldCheck, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { Link, useNavigate } from "react-router";
import { Item } from "../items/Item";
import { PtrClientNotice } from "../notice/PtrClientNotice";
import { copySimToDraft } from "../quick-sim/api";
import { Sheet, type Side, useIsPhone } from "../setup/Sheet";
import { CopyToPtrDraft, GameDataBadge, LiveItemStatsNote } from "../simc/GameData";
import { Tag } from "../ui/Tag";
import { useSimResults } from "./api";
import { DeltaBar, fmtDps, fmtPct, fmtSigned } from "./DeltaBar";
import { layoutStorage, RESULTS_LAYOUT_ID } from "./layout";
import { buildResultsModel, type ResultsModel } from "./model";

const ROW_PITCH = 46;

/** A finished or stopped Top Gear: the verdict, the doll in the selected Combination, the ranking. */
export function ResultsPage({ sim }: { sim: Sim }) {
  const results = useSimResults(sim.id, true);
  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
      <nav className="mb-4 flex gap-4 text-[12.5px]">
        <Link to="/quick-sim" className="text-muted hover:text-fg">
          New Sim
        </Link>
        <Link to="/history" className="text-muted hover:text-fg">
          History
        </Link>
        <Link to="/queue" className="text-muted hover:text-fg">
          Queue
        </Link>
      </nav>
      {results.isPending && <p className="text-[13px] text-muted">Loading the results…</p>}
      {results.isError && <p className="text-[13px] text-loss">Could not load the results.</p>}
      {results.data && <Results sim={sim} data={results.data} />}
    </main>
  );
}

function Results({ sim, data }: { sim: Sim; data: SimResultsResponse }) {
  const phone = useIsPhone();
  const model = useMemo(() => buildResultsModel(data), [data]);
  const rows = model.ranking.rows;
  const [selected, setSelected] = useState(0);
  const at = Math.min(selected, Math.max(0, rows.length - 1));
  const row = rows[at];
  const stopped = data.status === "cancelled";
  const layout = useDefaultLayout({ id: RESULTS_LAYOUT_ID, storage: layoutStorage });

  const verdict = useMemo(() => {
    const top = rows[0];
    const dress = top ? model.dress(top.combinationId) : null;
    return verdictFor(model.ranking, dress ? changedSlots(dress).length : 0, stopped);
  }, [model, rows, stopped]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Verdict
          kind={verdict.kind}
          headline={verdict.headline}
          detail={verdict.detail}
          sim={sim}
        />
        <SimcLine tag={data.simcTag} />
      </div>
    );
  }

  const header = (
    <Verdict
      kind={verdict.kind}
      headline={verdict.headline}
      detail={verdict.detail}
      sim={sim}
      provisional={stopped}
    />
  );
  const doll = row && <Dressed model={model} row={row} phone={phone} />;
  const stages = row && (
    <StageTable model={model} row={row} stageCount={data.stageCount} simId={sim.id} />
  );
  const ranking = (
    <Ranking
      model={model}
      stageCount={data.stageCount}
      selected={at}
      onSelect={setSelected}
      phone={phone}
    />
  );

  if (phone) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {ranking}
        {doll}
        {stages}
        <SimcLine tag={data.simcTag} />
      </div>
    );
  }
  return (
    // The Group sets its own inline `height: 100%`, which beats a height class on it: the height
    // comes from this wrapper, or the ranking panel grows to its content and nothing is virtual.
    <div className="h-[calc(100dvh-88px)] min-h-[520px]">
      <Group
        orientation="horizontal"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
      >
        <Panel id="doll" defaultSize="58" minSize={560} className="overflow-y-auto">
          <div className="flex flex-col gap-6 pr-4 pb-16">
            {header}
            {doll}
            {stages}
            <SimcLine tag={data.simcTag} />
          </div>
        </Panel>
        <Separator className="group relative w-[9px] shrink-0 cursor-col-resize outline-none">
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors duration-150 group-hover:bg-action group-focus-visible:bg-action group-data-[separator=active]:bg-action" />
        </Separator>
        <Panel id="ranking" defaultSize="42" minSize={420} className="flex min-h-0 flex-col">
          {ranking}
        </Panel>
      </Group>
    </div>
  );
}

function SimcLine({ tag }: { tag: string | null }) {
  if (!tag) return null;
  return (
    <p className="text-[11.5px] text-faint">
      Simmed with SimC <span className="num">{tag}</span>
    </p>
  );
}

const VERDICT_ICON: Record<VerdictKind, typeof TrendingUp> = {
  upgrade: TrendingUp,
  equipped: ShieldCheck,
  noise: Equal,
  partial: Hourglass,
  empty: Hourglass,
};
const VERDICT_TONE: Record<VerdictKind, string> = {
  upgrade: "text-gain",
  equipped: "text-fg",
  noise: "text-noise",
  partial: "text-loss",
  empty: "text-muted",
};

function Verdict({
  kind,
  headline,
  detail,
  sim,
  provisional = false,
}: {
  kind: VerdictKind;
  headline: string;
  detail: string;
  sim: Sim;
  provisional?: boolean;
}) {
  const Icon = VERDICT_ICON[kind];
  const navigate = useNavigate();
  const edit = useMutation({
    mutationFn: () => copySimToDraft(sim.id),
    onSuccess: (draft) => navigate(`/sims/${draft.id}/setup`),
  });
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 gap-3">
        <Icon size={22} className={clsx("mt-0.5 shrink-0", VERDICT_TONE[kind])} aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-[20px] leading-tight font-semibold tracking-[-0.01em] text-balance">
            {headline}
            <GameDataBadge gameData={sim.settings.gameData} version={sim.gameDataVersion} />
            {provisional && <Tag tone="loss">Provisional</Tag>}
          </h1>
          <p className="max-w-[62ch] text-[13px] text-muted">{detail}</p>
          <LiveItemStatsNote gameData={sim.settings.gameData} className="text-[12px] text-faint" />
          <PtrClientNotice sim={sim} />
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={edit.isPending}
          onClick={() => edit.mutate()}
          className="rounded-[6px] border border-line-strong px-3 py-1.5 text-[12.5px] font-medium hover:bg-raised disabled:opacity-50"
        >
          Edit and re-run
        </button>
        <CopyToPtrDraft
          simId={sim.id}
          gameData={sim.settings.gameData}
          className="rounded-[6px] border border-line-strong px-3 py-1.5 text-[12.5px] font-medium hover:bg-raised disabled:opacity-50"
        />
        {edit.isError && (
          <p role="alert" className="text-[12.5px] text-loss">
            {edit.error.message}
          </p>
        )}
      </div>
    </header>
  );
}

function Dressed({ model, row, phone }: { model: ResultsModel; row: RankedRow; phone: boolean }) {
  const dress = model.dress(row.combinationId);
  const changed = dress ? changedSlots(dress) : [];
  const loadout = model.loadout(row.combinationId);
  const baseLoadout = model.baseline ? model.loadout(model.baseline.id) : null;

  const renderSlot = (slot: PaperdollSlot, side: Side) => {
    const d = dress?.[slot];
    const mirrored = side === "right";
    const isChanged = !!d && (d.fresh.length > 0 || d.gone.length > 0);
    return (
      <div
        data-slot={slot}
        className={clsx(
          "flex min-w-0 items-center gap-3 rounded-[6px] px-2.5 py-2",
          mirrored && "flex-row-reverse",
          !isChanged && "opacity-60",
        )}
      >
        <span className={clsx("flex shrink-0 gap-1", mirrored && "flex-row-reverse")}>
          {d && d.items.length > 0 ? (
            d.items.map((it) => {
              // An item that changed in the displayed Combination glows in its quality colour.
              const fresh = d.fresh.some((f) => f.index === it.index);
              return (
                <Item
                  key={it.index}
                  item={it}
                  parts={{ icon: true }}
                  size={fresh || !phone ? "lg" : "md"}
                  glow={fresh ? row.combinationId : undefined}
                />
              );
            })
          ) : (
            <span className="size-12 rounded-[5px] border border-dashed border-line-strong" />
          )}
        </span>
        <span
          className={clsx(
            "flex min-w-0 flex-1 flex-col gap-0.5",
            mirrored ? "items-end text-right" : "items-start text-left",
          )}
        >
          <span className="text-[11.5px] text-faint">{PAPERDOLL_LABEL[slot]}</span>
          {d?.items.length ? (
            d.items.map((it) => (
              <Item
                key={it.index}
                item={it}
                parts={{ name: true }}
                className={clsx(
                  "block max-w-full truncate",
                  d.items.length === 1 ? "text-[13px]" : "text-[12.5px]",
                )}
              />
            ))
          ) : (
            <span className="text-[13px] text-faint">Nothing worn</span>
          )}
          {d && d.gone.length > 0 && (
            <span
              className={clsx(
                "flex items-center gap-1.5 text-[11.5px]",
                mirrored && "flex-row-reverse",
              )}
            >
              <span className="text-faint">was</span>
              {d.gone.map((g) => (
                <span key={g.index} className="inline-flex items-center gap-1">
                  <Item item={g} parts={{ icon: true }} size="sm" dim ilvl={false} />
                  <span className="num text-faint">{g.ilvl ?? ""}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <Sheet
      phone={phone}
      colWidth={220}
      renderSlot={renderSlot}
      center={
        <div
          className="flex h-full flex-col justify-center gap-3 px-1 text-center"
          aria-live="polite"
        >
          <p className="text-[11.5px] text-faint">
            #<span className="num">{row.rank}</span> · Combination{" "}
            <span className="num">{row.combinationId}</span>
          </p>
          {row.isBaseline ? (
            <p className="text-[20px] font-semibold">Your equipped set</p>
          ) : (
            <>
              <p
                className={clsx(
                  "num text-[28px] leading-none font-semibold tracking-[-0.02em]",
                  row.tone === "gain" && "text-gain",
                  row.tone === "loss" && "text-loss",
                  row.tone === "noise" && "text-noise",
                )}
              >
                {fmtPct(row.deltaPct)}
              </p>
              <p className="num text-[12.5px] text-muted">
                {fmtSigned(row.delta)} DPS · ±{row.errorPct.toFixed(2)}%
              </p>
              <p className="text-[12.5px] text-muted">
                {changed.length === 0
                  ? "Same gear as equipped"
                  : `${changed.length} ${changed.length === 1 ? "slot changes" : "slots change"}: ${changed.map((s) => PAPERDOLL_LABEL[s]).join(", ")}`}
              </p>
            </>
          )}
          {loadout && loadout !== baseLoadout && (
            <p className="text-[12.5px] text-muted">Talents: {loadout}</p>
          )}
          {row.inNoiseGroup && row.rank > 1 && (
            <p className="text-[11.5px] text-noise">Within noise of #1</p>
          )}
        </div>
      }
    />
  );
}

function StageTable({
  model,
  row,
  stageCount,
  simId,
}: {
  model: ResultsModel;
  row: RankedRow;
  stageCount: number;
  simId: number;
}) {
  const own = model.stageResults.get(row.combinationId) ?? [];
  const base = new Map(
    (model.baseline ? (model.stageResults.get(model.baseline.id) ?? []) : []).map((r) => [
      r.stage,
      r,
    ]),
  );
  const invalid = model.combinations.get(row.combinationId)?.invalidStage ?? null;
  const th = "px-2.5 py-1.5 text-right font-normal text-faint first:text-left";
  const td = "num px-2.5 py-1.5 text-right first:text-left";
  return (
    <section className="flex flex-col gap-2" aria-label="Stages">
      <h2 className="text-[13px] font-semibold">
        Stages for #<span className="num">{row.rank}</span>
        {row.stage < stageCount && (
          <span className="ml-2 font-normal text-loss">
            reached stage <span className="num">{row.stage}</span> of{" "}
            <span className="num">{stageCount}</span>
          </span>
        )}
      </h2>
      <div className="overflow-x-auto rounded-[8px] border border-line">
        <table className="w-full min-w-[480px] text-[12.5px]">
          <thead className="border-b border-line bg-panel">
            <tr>
              {["Stage", "Mean DPS", "Error", "Δ vs equipped", "Download"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {own.map((s) => {
              const b = base.get(s.stage);
              return (
                <tr key={s.stage} className="border-b border-line last:border-0">
                  <td className={td}>{s.stage}</td>
                  <td className={clsx(td, "text-fg")}>{fmtDps(s.dps.mean)}</td>
                  <td className={td}>±{fmtDps(s.dps.meanError)}</td>
                  <td className={td}>
                    {b && !s.isBaseline
                      ? fmtPct(((s.dps.mean - b.dps.mean) / b.dps.mean) * 100)
                      : "–"}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <div className="flex flex-col gap-1 items-end">
                      {s.stage === stageCount ? (
                        <span className="text-faint">final</span>
                      ) : s.survived ? (
                        <span className="text-faint">kept</span>
                      ) : (
                        <span className="text-loss">culled</span>
                      )}
                      <div className="flex gap-1">
                        <a
                          href={`/api/sims/${simId}/files/stage-${s.stage}.simc`}
                          download={`stage-${s.stage}.simc`}
                          className="text-[11.5px] text-action hover:underline"
                          title="Download SimC input"
                        >
                          simc
                        </a>
                        <a
                          href={`/api/sims/${simId}/files/stage-${s.stage}.json.gz`}
                          download={`stage-${s.stage}.json.gz`}
                          className="text-[11.5px] text-action hover:underline"
                          title="Download json2 output"
                        >
                          json
                        </a>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {invalid !== null && (
        <p className="text-[12.5px] text-loss">
          SimC refused this Combination in stage <span className="num">{invalid}</span>, so it took
          no further part.
        </p>
      )}
    </section>
  );
}

function Ranking({
  model,
  stageCount,
  selected,
  onSelect,
  phone,
}: {
  model: ResultsModel;
  stageCount: number;
  selected: number;
  onSelect: (index: number) => void;
  phone: boolean;
}) {
  const { rows, baseline, noiseGroup, min, max } = model.ranking;
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_PITCH,
    overscan: 12,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"))
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      e.preventDefault();
      const next = moveSelection(selected, rows.length, e.key);
      onSelect(next);
      virtual.scrollToIndex(next, { align: "auto" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, rows.length, onSelect, virtual]);

  const zeroFraction = (0 - min) / (max - min || 1);
  const zeroAt = `${zeroFraction * 100}%`;
  // The end labels own the ends: a "0" this close to one would print on top of it.
  const zeroClear = zeroFraction > 0.15 && zeroFraction < 0.85;
  const maxIcons = phone ? 4 : 7;
  const reachedShallow = rows.some((r) => r.stage < stageCount);

  return (
    <section className={clsx("flex min-h-0 flex-col", !phone && "h-full")} aria-label="Ranking">
      <header className="flex flex-col gap-2 border-b border-line pb-2.5 pl-2 sm:pl-4">
        <div className="flex items-baseline justify-between gap-3 pr-2">
          <h2 className="text-[14px] font-semibold">
            <span className="num">{rows.length.toLocaleString("en-US")}</span> ranked
          </h2>
          <span className="hidden items-center gap-1 text-[11.5px] text-faint sm:flex">
            <kbd className="num rounded-[3px] border border-line-strong px-1">j</kbd>
            <kbd className="num rounded-[3px] border border-line-strong px-1">k</kbd> to move
          </span>
        </div>
        {noiseGroup > 1 && (
          <p className="text-[12.5px] text-muted">
            <span className="text-noise">
              #1 to #<span className="num">{noiseGroup}</span>
            </span>{" "}
            cannot be told apart at this precision.
          </p>
        )}
        {reachedShallow && (
          <p className="text-[12.5px] text-faint">
            Each row shows the Stage it reached (<span className="num">S1</span> to{" "}
            <span className="num">S{stageCount}</span>). Rows that stopped earlier rank below every
            row that went further.
          </p>
        )}
        {baseline && (
          <RankRow
            model={model}
            row={baseline}
            stageCount={stageCount}
            selected={selected === baseline.rank - 1}
            onClick={() => onSelect(baseline.rank - 1)}
            pinned
            maxIcons={maxIcons}
          />
        )}
        <div className="grid grid-cols-[34px_minmax(120px,1fr)_92px] gap-3 pr-1 text-[10.5px] text-faint">
          <span />
          <span className="num relative h-3">
            <span className="absolute left-0">{fmtPct(min, 1)}</span>
            {zeroClear && (
              <span className="absolute -translate-x-1/2" style={{ left: zeroAt }}>
                0
              </span>
            )}
            <span className="absolute right-0">{fmtPct(max, 1)}</span>
          </span>
          <span className="text-right">vs equipped</span>
        </div>
      </header>
      <div
        ref={scroller}
        className={clsx("min-h-0 flex-1 overflow-y-auto px-2 pb-16", phone && "max-h-[60vh]")}
      >
        <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((vi) => {
            const r = rows[vi.index];
            if (!r) return null;
            return (
              <div
                key={vi.key}
                className="absolute inset-x-0"
                style={{ top: vi.start, height: vi.size }}
              >
                <RankRow
                  model={model}
                  row={r}
                  stageCount={stageCount}
                  selected={selected === vi.index}
                  onClick={() => onSelect(vi.index)}
                  maxIcons={maxIcons}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RankRow({
  model,
  row,
  stageCount,
  selected,
  onClick,
  pinned = false,
  maxIcons,
}: {
  model: ResultsModel;
  row: RankedRow;
  stageCount: number;
  selected: boolean;
  onClick: () => void;
  pinned?: boolean;
  maxIcons: number;
}) {
  const { min, max } = model.ranking;
  const dress = model.dress(row.combinationId);
  const icons = dress ? Object.values(dress).flatMap((d) => d.fresh) : [];
  const shallow = row.stage < stageCount;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected}
      className={clsx(
        "grid h-[42px] w-full grid-cols-[34px_minmax(120px,1fr)_92px] items-center gap-3 rounded-[6px] px-2 text-left transition-colors duration-150",
        selected
          ? "bg-action-wash ring-1 ring-action/45"
          : row.inNoiseGroup && !pinned
            ? "bg-noise-wash/60 hover:bg-noise-wash"
            : "hover:bg-panel",
      )}
    >
      <span className="num text-[11.5px] text-faint">{pinned ? "" : row.rank}</span>
      <span className="flex min-w-0 flex-col gap-1">
        <DeltaBar
          deltaPct={row.deltaPct}
          errorPct={row.errorPct}
          min={min}
          max={max}
          tone={row.tone}
        />
        <span className="flex h-[20px] items-center gap-1 overflow-hidden">
          {row.isBaseline ? (
            <span className="text-[11.5px] text-muted">
              Equipped{pinned ? `, rank ${row.rank}` : ""}
            </span>
          ) : (
            icons
              .slice(0, maxIcons)
              .map((it) => (
                <Item key={it.index} item={it} parts={{ icon: true }} size="sm" ilvl={false} />
              ))
          )}
          {icons.length > maxIcons && !row.isBaseline && (
            <span className="num text-[11px] text-faint">+{icons.length - maxIcons}</span>
          )}
          <span title={`Reached stage ${row.stage} of ${stageCount}`}>
            <Tag tone={shallow ? "noise" : "neutral"}>S{row.stage}</Tag>
          </span>
        </span>
      </span>
      <span className="num flex flex-col items-end text-[12.5px] leading-tight">
        <span
          className={clsx(
            row.tone === "gain" && "text-gain",
            row.tone === "loss" && "text-loss",
            row.tone === "noise" && "text-noise",
            row.tone === "base" && "text-muted",
          )}
        >
          {row.isBaseline ? fmtDps(row.mean) : fmtPct(row.deltaPct)}
        </span>
        <span className="text-[11px] text-faint">±{row.errorPct.toFixed(2)}%</span>
      </span>
    </button>
  );
}
