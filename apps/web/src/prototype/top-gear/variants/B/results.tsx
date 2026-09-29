// Variant B results: the sheet re-dressed in the selected combination | the ranking.
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Equal, Hourglass, ShieldCheck, TrendingUp } from "lucide-react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CHARACTER, type SlotId } from "../../data";
import type { Ranked, SimOutcome, Verdict, VerdictKind } from "../../engine";
import type { Flow } from "../../flow";
import { DeltaBar, fmtDps, fmtPct, fmtSigned, ItemIcon, Tag } from "../../kit";
import { GlowIcon, Sheet, slotLabel, SlotTile, useIsPhone, type Side } from "./doll";

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

export function Results({ flow }: { flow: Flow }) {
  const phone = useIsPhone();
  const o = flow.run.outcome;
  const v = flow.run.verdict;
  const [sel, setSel] = useState(0);
  const layout = useDefaultLayout({ id: "simbot-b-results", storage });

  if (!o || !v) return <p className="p-8 text-muted">No results yet.</p>;
  const r = o.ranked[Math.min(sel, o.ranked.length - 1)];

  const left = (
    <div className="flex flex-col gap-6">
      <VerdictLine v={v} flow={flow} />
      <Dressed r={r} phone={phone} baselineId={o.baseline.combo.id} />
      <StageTable r={r} finalStage={o.stages.at(-1)!.plan.index} />
    </div>
  );
  const right = <Ranking o={o} sel={sel} setSel={setSel} phone={phone} />;

  if (phone)
    return (
      <div className="flex flex-col gap-6 px-4 pt-4 pb-32">
        <VerdictLine v={v} flow={flow} />
        {right}
        <Dressed r={r} phone baselineId={o.baseline.combo.id} />
        <StageTable r={r} finalStage={o.stages.at(-1)!.plan.index} />
      </div>
    );

  return (
    <Group orientation="horizontal" className="h-[calc(100vh-57px)]" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
      <Panel id="doll" defaultSize="58" minSize={560} className="overflow-y-auto">
        <div className="px-6 pt-5 pb-24">{left}</div>
      </Panel>
      <Separator className="group relative w-[9px] shrink-0 cursor-col-resize outline-none">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors duration-150 group-hover:bg-action group-focus-visible:bg-action group-data-[separator=active]:bg-action" />
      </Separator>
      <Panel id="ranking" defaultSize="42" minSize={420} className="flex min-h-0 flex-col">
        {right}
      </Panel>
    </Group>
  );
}

const VERDICT_ICON: Record<VerdictKind, typeof TrendingUp> = { upgrade: TrendingUp, equipped: ShieldCheck, noise: Equal, partial: Hourglass };
const VERDICT_TONE: Record<VerdictKind, string> = { upgrade: "text-gain", equipped: "text-fg", noise: "text-noise", partial: "text-loss" };

function VerdictLine({ v, flow }: { v: Verdict; flow: Flow }) {
  const Icon = VERDICT_ICON[v.kind];
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 gap-3">
        <Icon size={22} className={clsx("mt-0.5 shrink-0", VERDICT_TONE[v.kind])} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="flex flex-wrap items-center gap-2 text-[20px] leading-tight font-semibold tracking-[-0.01em] text-balance">
            {v.headline}
            {v.kind === "partial" && <Tag tone="loss">Provisional</Tag>}
          </h2>
          <p className="max-w-[62ch] text-[13px] text-muted">{v.detail}</p>
        </div>
      </div>
      <div className="flex gap-2 text-[12.5px]">
        <button className="rounded-[6px] border border-line-strong px-3 py-1.5 font-medium hover:bg-raised" onClick={flow.backToSetup}>
          Edit and re-run
        </button>
        <button className="rounded-[6px] px-2.5 py-1.5 text-muted hover:text-fg" onClick={flow.newImport}>
          New import
        </button>
      </div>
    </header>
  );
}

function Dressed({ r, phone, baselineId }: { r: Ranked; phone: boolean; baselineId: number }) {
  const changes = new Map(r.combo.changes.map((c) => [c.slot, c]));
  const renderSlot = (id: SlotId, side: Side) => {
    const ch = changes.get(id);
    const items = r.combo.gear[id];
    if (!ch) return <SlotTile slot={id} side={side} items={items} interactive={false} quiet />;
    const fresh = ch.to.filter((t) => !ch.from.some((f) => f.uid === t.uid));
    const gone = ch.from.filter((f) => !ch.to.some((t) => t.uid === f.uid));
    return (
      <SlotTile
        slot={id}
        side={side}
        items={items}
        interactive={false}
        icons={items.map((it) => (fresh.includes(it) ? <GlowIcon key={it.uid} item={it} token={r.combo.id} /> : <ItemIcon key={it.uid} item={it} size="lg" showIlvl />))}
        meta={
          <span className={clsx("inline-flex items-center gap-1.5", side === "right" && "flex-row-reverse")}>
            <span className="text-faint">was</span>
            {gone.map((g) => (
              <ItemIcon key={g.uid} item={g} size="sm" dim />
            ))}
            <span className="num text-faint">{gone.map((g) => g.ilvl).join(", ")}</span>
          </span>
        }
      />
    );
  };
  const isBase = r.combo.id === baselineId;
  return (
    <Sheet
      phone={phone}
      colWidth={220}
      renderSlot={renderSlot}
      center={
        <div className="flex h-full flex-col justify-center gap-3 px-1 text-center" aria-live="polite">
          <p className="text-[12px] text-faint">
            #{r.rank} · Combo <span className="num">{r.combo.id}</span>
            {r.combo.loadout !== "raid" && ` · ${CHARACTER.talentLoadouts.find((l) => l.id === r.combo.loadout)?.name}`}
          </p>
          {isBase ? (
            <p className="text-[15px] font-semibold">Your equipped set</p>
          ) : (
            <>
              <p className={clsx("num text-[28px] leading-none font-semibold tracking-[-0.02em]", r.delta >= 0 ? "text-gain" : "text-loss")}>{fmtPct(r.deltaPct)}</p>
              <p className="num text-[12.5px] text-muted">
                {fmtSigned(r.delta)} DPS · ±{r.errorPct.toFixed(2)}%
              </p>
              <p className="text-[12.5px] text-muted">
                {r.combo.changes.length} {r.combo.changes.length === 1 ? "slot changes" : "slots change"}: {r.combo.changes.map((c) => slotLabel(c.slot)).join(", ")}
              </p>
            </>
          )}
          {r.withinNoiseOfBest && r.rank > 1 && <p className="text-[12px] text-noise">Within noise of #1</p>}
        </div>
      }
    />
  );
}

function StageTable({ r, finalStage }: { r: Ranked; finalStage: number }) {
  const th = "px-2.5 py-1.5 text-right font-normal text-faint first:text-left";
  const td = "num px-2.5 py-1.5 text-right first:text-left";
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold">
        Stages for #{r.rank}
        {r.last.stage < finalStage && <span className="ml-2 font-normal text-loss">did not reach the final stage</span>}
      </h3>
      <div className="overflow-x-auto rounded-[8px] border border-line">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="border-b border-line bg-panel">
            <tr>
              {["Stage", "Iterations", "Mean", "Median", "Min", "Max", "Std dev", "Error", ""].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.stages.map((s) => (
              <tr key={s.stage} className="border-b border-line last:border-0">
                <td className={td}>{s.stage}</td>
                <td className={td}>{s.iterations.toLocaleString("en-US")}</td>
                <td className={clsx(td, "text-fg")}>{fmtDps(s.mean)}</td>
                <td className={td}>{fmtDps(s.median)}</td>
                <td className={td}>{fmtDps(s.min)}</td>
                <td className={td}>{fmtDps(s.max)}</td>
                <td className={td}>{fmtDps(s.stdDev)}</td>
                <td className={td}>±{fmtDps(s.error)}</td>
                <td className={clsx(td, "font-sans")}>{s.survived ? <span className="text-faint">kept</span> : <span className="text-loss">culled</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const ROW_H = 46;

function Ranking({ o, sel, setSel, phone }: { o: SimOutcome; sel: number; setSel: (i: number) => void; phone: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const finalStage = o.stages.at(-1)!.plan.index;
  const { min, max } = useMemo(() => {
    let lo = 0, hi = 0;
    for (const x of o.ranked) {
      lo = Math.min(lo, x.deltaPct - x.errorPct);
      hi = Math.max(hi, x.deltaPct + x.errorPct);
    }
    const pad = (hi - lo) * 0.06 || 0.5;
    return { min: lo - pad, max: hi + pad };
  }, [o]);
  const noiseGroup = o.ranked.filter((x) => x.withinNoiseOfBest).length;
  const v = useVirtualizer({ count: o.ranked.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const n = Math.max(0, Math.min(o.ranked.length - 1, sel + (e.key === "j" ? 1 : -1)));
        setSel(n);
        v.scrollToIndex(n, { align: "auto" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, setSel, o.ranked.length, v]);

  const baseIdx = o.ranked.findIndex((x) => x.combo.isBaseline);
  const zeroAt = `${((0 - min) / (max - min)) * 100}%`;

  return (
    <section className={clsx("flex min-h-0 flex-col", !phone && "h-full")} aria-label="Ranking">
      <header className="flex flex-col gap-2 border-b border-line px-4 pt-4 pb-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[14px] font-semibold">
            <span className="num">{o.ranked.length.toLocaleString("en-US")}</span> ranked
          </h3>
          <span className="hidden items-center gap-1 text-[11.5px] text-faint sm:flex">
            <kbd className="num rounded-[3px] border border-line-strong px-1">j</kbd>
            <kbd className="num rounded-[3px] border border-line-strong px-1">k</kbd> to move
          </span>
        </div>
        {noiseGroup > 1 && (
          <p className="text-[12px] text-muted">
            <span className="text-noise">#1 to #{noiseGroup}</span> cannot be told apart at this precision.
          </p>
        )}
        {o.ranked.some((x) => x.last.stage < finalStage) && (
          <p className="text-[12px] text-faint">
            Rows tagged <span className="text-muted">S1</span> or <span className="text-muted">S2</span> were culled at that stage and rank below every final row.
          </p>
        )}
        <Row r={o.ranked[baseIdx]} min={min} max={max} finalStage={finalStage} selected={sel === baseIdx} onClick={() => setSel(baseIdx)} pinned maxIcons={phone ? 4 : 7} />
        <div className="grid grid-cols-[34px_minmax(120px,1fr)_92px] gap-3 pr-1 text-[10.5px] text-faint">
          <span />
          <span className="num relative h-3">
            <span className="absolute left-0">{fmtPct(min, 1)}</span>
            <span className="absolute -translate-x-1/2" style={{ left: zeroAt }}>
              0
            </span>
            <span className="absolute right-0">{fmtPct(max, 1)}</span>
          </span>
          <span className="text-right">vs equipped</span>
        </div>
      </header>
      <div ref={scroller} className={clsx("min-h-0 flex-1 overflow-y-auto px-2 pb-24", phone && "max-h-[60vh]")}>
        <div className="relative w-full" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((vi) => {
            const r = o.ranked[vi.index];
            return (
              <div key={vi.key} className="absolute inset-x-0" style={{ top: vi.start, height: vi.size }}>
                <Row r={r} min={min} max={max} finalStage={finalStage} selected={sel === vi.index} onClick={() => setSel(vi.index)} maxIcons={phone ? 4 : 7} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Row({ r, min, max, finalStage, selected, onClick, pinned, maxIcons }: { r: Ranked; min: number; max: number; finalStage: number; selected: boolean; onClick: () => void; pinned?: boolean; maxIcons: number }) {
  const tone = r.combo.isBaseline ? "base" : Math.abs(r.deltaPct) < r.errorPct ? "noise" : r.delta > 0 ? "gain" : "loss";
  const icons = r.combo.changes.flatMap((c) => c.to.filter((t) => !c.from.some((f) => f.uid === t.uid)));
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected}
      className={clsx(
        "grid h-[42px] w-full grid-cols-[34px_minmax(120px,1fr)_92px] items-center gap-3 rounded-[6px] px-2 text-left transition-colors duration-150",
        selected ? "bg-action-wash ring-1 ring-action/45" : r.withinNoiseOfBest && !pinned ? "bg-noise-wash/60 hover:bg-noise-wash" : "hover:bg-panel",
      )}
    >
      <span className="num text-[12px] text-faint">{pinned ? "" : r.rank}</span>
      <span className="flex min-w-0 flex-col gap-1">
        <DeltaBar deltaPct={r.deltaPct} errorPct={r.errorPct} min={min} max={max} tone={tone} height={12} />
        <span className="flex h-[20px] items-center gap-1 overflow-hidden">
          {r.combo.isBaseline ? (
            <span className="text-[11.5px] text-muted">Equipped{pinned ? `, rank ${r.rank}` : ""}</span>
          ) : (
            icons.slice(0, maxIcons).map((it) => <ItemIcon key={it.uid} item={it} size="sm" />)
          )}
          {icons.length > maxIcons && <span className="num text-[11px] text-faint">+{icons.length - maxIcons}</span>}
          {r.last.stage < finalStage && <span title={`Last finished stage ${r.last.stage}`}><Tag className="ml-1 shrink-0">S{r.last.stage}</Tag></span>}
        </span>
      </span>
      <span className="num flex flex-col items-end text-[12.5px] leading-tight">
        <span className={tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : tone === "noise" ? "text-noise" : "text-muted"}>{r.combo.isBaseline ? fmtDps(r.last.mean) : fmtPct(r.deltaPct)}</span>
        <span className="text-[11px] text-faint">±{r.errorPct.toFixed(2)}%</span>
      </span>
    </button>
  );
}
