// Variant C: result appended to the run sheet. Verdict first, then ranking | detail.

import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { ArrowRight, CheckCircle2, Equal, Hourglass, TrendingUp } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Group,
  type LayoutStorage,
  Panel,
  Separator,
  useDefaultLayout,
} from "react-resizable-panels";
import { CHARACTER, type Item, SLOTS } from "../../data";
import type { Ranked, SimOutcome, Verdict } from "../../engine";
import type { Flow } from "../../flow";
import {
  DeltaBar,
  fmtDps,
  fmtPct,
  fmtSigned,
  ItemFlags,
  ItemIcon,
  ItemName,
  Kbd,
  statLine,
  Tag,
} from "../../kit";

const safeStorage: LayoutStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: layout just is not remembered */
    }
  },
};

function useIsPhone() {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

const tone = (r: Ranked): "gain" | "loss" | "noise" | "base" =>
  r.combo.isBaseline
    ? "base"
    : r.deltaPct - r.errorPct > 0
      ? "gain"
      : r.deltaPct + r.errorPct < 0
        ? "loss"
        : "noise";

const VERDICT_ICON = {
  upgrade: TrendingUp,
  equipped: CheckCircle2,
  noise: Equal,
  partial: Hourglass,
} as const;
const VERDICT_TONE = {
  upgrade: "text-gain",
  equipped: "text-fg",
  noise: "text-muted",
  partial: "text-muted",
} as const;

export function VerdictLine({ verdict, partial }: { verdict: Verdict; partial: boolean }) {
  const Icon = VERDICT_ICON[verdict.kind];
  return (
    <div className="flex items-start gap-3">
      <Icon
        size={22}
        strokeWidth={2.25}
        className={clsx("mt-[3px] shrink-0", VERDICT_TONE[verdict.kind])}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance text-fg">
          {verdict.headline}
          {partial && (
            <Tag tone="noise" className="ml-2 -translate-y-[3px] align-middle">
              Provisional
            </Tag>
          )}
        </p>
        <p className="mt-1 max-w-[70ch] text-[13.5px] text-muted">{verdict.detail}</p>
      </div>
    </div>
  );
}

type ListItem = { kind: "header"; label: string; count: number } | { kind: "row"; r: Ranked };

function buildList(o: SimOutcome, stageCount: number): ListItem[] {
  const rows = o.ranked.filter((r) => !r.combo.isBaseline);
  const buckets: { label: string; rows: Ranked[] }[] = [];
  const add = (label: string, rs: Ranked[]) => rs.length && buckets.push({ label, rows: rs });
  const deepest = Math.max(...o.ranked.map((r) => r.last.stage));
  const noise = rows.filter((r) => r.withinNoiseOfBest);
  if (noise.length >= 2) add("Indistinguishable from #1", noise);
  else if (noise.length === 1) add(o.partial ? "Leading" : "Best", noise);
  const rest = rows.filter((r) => !r.withinNoiseOfBest);
  for (let st = deepest; st >= 1; st--) {
    const at = rest.filter((r) => r.last.stage === st);
    if (o.partial)
      add(st === deepest ? `Reached stage ${st} before the stop` : `Stage ${st} only`, at);
    else add(st === stageCount ? "Clear of #1, all stages" : `Culled after stage ${st}`, at);
  }
  return buckets.flatMap((b) => [
    { kind: "header" as const, label: b.label, count: b.rows.length },
    ...b.rows.map((r) => ({ kind: "row" as const, r })),
  ]);
}

function ChangedIcons({ r, max = 6 }: { r: Ranked; max?: number }) {
  const added = r.combo.changes.flatMap((c) =>
    c.to.filter((t) => !c.from.some((f) => f.uid === t.uid)),
  );
  if (!added.length)
    return (
      <span className="text-[12.5px] text-muted">
        {r.combo.loadout === "mplus" ? "Equipped gear, M+ cleave talents" : "Equipped set"}
      </span>
    );
  return (
    <span className="flex items-center gap-1">
      {added.slice(0, max).map((i) => (
        <ItemIcon key={i.uid} item={i} size="sm" showIlvl />
      ))}
      {added.length > max && (
        <span className="num pl-0.5 text-[11.5px] text-faint">+{added.length - max}</span>
      )}
    </span>
  );
}

function Row({
  r,
  min,
  max,
  selected,
  onSelect,
  stageCount,
  partial,
}: {
  r: Ranked;
  min: number;
  max: number;
  selected: boolean;
  onSelect: () => void;
  stageCount: number;
  partial: boolean;
}) {
  const t = tone(r);
  const notFinal = r.last.stage < stageCount;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      tabIndex={-1}
      className={clsx(
        "grid h-full w-full grid-cols-[34px_minmax(0,176px)_minmax(80px,1fr)_104px] items-center gap-3 rounded-[5px] px-2 text-left transition-colors duration-150 max-md:grid-cols-[28px_1fr_92px]",
        selected ? "bg-action-wash ring-1 ring-action/45 ring-inset" : "hover:bg-raised",
      )}
    >
      <span className="num text-[12px] text-faint">{r.combo.isBaseline ? "" : r.rank}</span>
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <ChangedIcons r={r} max={5} />
      </span>
      <DeltaBar
        deltaPct={r.deltaPct}
        errorPct={r.errorPct}
        min={min}
        max={max}
        tone={t}
        className="max-md:hidden"
      />
      <span className="num text-right text-[12.5px] leading-tight">
        <span
          className={clsx(
            "block",
            t === "gain"
              ? "text-gain"
              : t === "loss"
                ? "text-loss"
                : t === "base"
                  ? "text-muted"
                  : "text-fg",
          )}
        >
          {r.combo.isBaseline ? "baseline" : fmtPct(r.deltaPct)}
        </span>
        <span className="block text-[11px] text-faint">
          ±{r.errorPct.toFixed(2)}%
          {notFinal && (
            <span className="text-muted">
              {" "}
              · {partial ? "S" : "cut S"}
              {r.last.stage}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function Ranking({
  o,
  selectedId,
  onSelect,
  onOpen,
  stageCount,
  height,
}: {
  o: SimOutcome;
  selectedId: number;
  onSelect: (id: number) => void;
  onOpen: () => void;
  stageCount: number;
  height: number | string;
}) {
  const items = useMemo(() => buildList(o, stageCount), [o, stageCount]);
  const deepest = Math.max(...o.ranked.map((r) => r.last.stage));
  const [min, max] = useMemo(() => {
    const scale = o.ranked.filter((r) => r.last.stage === deepest);
    const lo = Math.min(-0.25, ...scale.map((r) => r.deltaPct - r.errorPct));
    const hi = Math.max(0.25, ...scale.map((r) => r.deltaPct + r.errorPct));
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }, [o, deepest]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i].kind === "header" ? 30 : 46),
    overscan: 12,
  });
  const rowIdx = items.flatMap((it, i) => (it.kind === "row" ? [i] : []));
  const base = o.baseline;

  const move = (d: number) => {
    const cur = rowIdx.findIndex((i) => (items[i] as { r: Ranked }).r.combo.id === selectedId);
    const next = rowIdx[Math.max(0, Math.min(rowIdx.length - 1, cur + d))];
    if (next === undefined) return;
    onSelect((items[next] as { r: Ranked }).r.combo.id);
    v.scrollToIndex(next, { align: "auto" });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "j" || e.key === "ArrowDown") e.preventDefault(), move(1);
    else if (e.key === "k" || e.key === "ArrowUp") e.preventDefault(), move(-1);
    else if (e.key === "Enter") e.preventDefault(), onOpen();
    else if (e.key === "e") e.preventDefault(), onSelect(base.combo.id);
  };

  const pos = (t: number) => (t - min) / (max - min);
  // drop the zero label when it would collide with an end label
  const ticks = [min, 0, max]
    .filter((t, i) => i !== 1 || (pos(0) > 0.14 && pos(0) < 0.86))
    .map((t) => ({ t, left: `${pos(t) * 100}%` }));

  return (
    <div className="flex h-full flex-col">
      {/* scale header shares the row grid so the axis lines up with every bar */}
      <div className="grid grid-cols-[34px_minmax(0,176px)_minmax(80px,1fr)_104px] items-end gap-3 border-b border-line px-4 pt-2 pb-1.5 text-[11px] text-faint max-md:grid-cols-[28px_1fr_92px]">
        <span>#</span>
        <span>Changes vs equipped</span>
        <span className="relative h-4 max-md:hidden">
          {ticks.map(({ t, left }) => (
            <span
              key={t}
              className="num absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
              style={{ left }}
            >
              {t === 0 ? "0" : fmtPct(t, 1)}
            </span>
          ))}
        </span>
        <span className="text-right">Δ DPS</span>
      </div>

      {/* equipped set, pinned */}
      <div className="border-b border-line px-2 py-1" style={{ height: 54 }}>
        <div className="relative h-full">
          <Row
            r={base}
            min={min}
            max={max}
            selected={selectedId === base.combo.id}
            onSelect={() => onSelect(base.combo.id)}
            stageCount={stageCount}
            partial={o.partial}
          />
        </div>
      </div>
      <p className="px-4 pt-1.5 text-[11px] text-faint">
        Equipped ranks <span className="num text-muted">#{base.rank}</span> of{" "}
        <span className="num">{o.ranked.length.toLocaleString("en-US")}</span>
      </p>

      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKey}
        role="listbox"
        aria-label="Ranked combinations"
        aria-activedescendant={`c-row-${selectedId}`}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 focus-visible:outline-offset-[-2px]"
        style={{ height }}
      >
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((vi) => {
            const it = items[vi.index];
            return (
              <div
                key={vi.key}
                className="absolute inset-x-0"
                style={{ top: vi.start, height: vi.size }}
              >
                {it.kind === "header" ? (
                  <div className="flex h-full items-end gap-2 px-2 pb-1.5 text-[11.5px] font-medium text-faint">
                    {it.label}
                    <span className="num font-normal">{it.count.toLocaleString("en-US")}</span>
                  </div>
                ) : (
                  <div
                    id={`c-row-${it.r.combo.id}`}
                    role="option"
                    aria-selected={it.r.combo.id === selectedId}
                    className="h-full py-[2px]"
                  >
                    <Row
                      r={it.r}
                      min={min}
                      max={max}
                      selected={it.r.combo.id === selectedId}
                      onSelect={() => onSelect(it.r.combo.id)}
                      stageCount={stageCount}
                      partial={o.partial}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-1.5 text-[11px] text-faint max-md:hidden">
        <Kbd>j</Kbd>
        <Kbd>k</Kbd> move <Kbd>↵</Kbd> detail <Kbd>e</Kbd> equipped
      </div>
    </div>
  );
}

function diffItems(from: Item[], to: Item[]) {
  return {
    removed: from.filter((f) => !to.some((t) => t.uid === f.uid)),
    added: to.filter((t) => !from.some((f) => f.uid === t.uid)),
  };
}

function Detail({
  r,
  stageCount,
  flow,
  detailRef,
}: {
  r: Ranked;
  stageCount: number;
  flow: Flow;
  detailRef: React.RefObject<HTMLDivElement | null>;
}) {
  // the signature moment: new items light up in their own quality colour
  const [lit, setLit] = useState(false);
  useEffect(() => {
    setLit(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setLit(true)));
    return () => cancelAnimationFrame(id);
  }, [r.combo.id]);

  const unchanged = SLOTS.filter((s) => !r.combo.changes.some((c) => c.slot === s.id));
  const t = tone(r);
  const loadout = CHARACTER.talentLoadouts.find((l) => l.id === r.combo.loadout)!;

  return (
    <div
      ref={detailRef}
      tabIndex={-1}
      className="h-full overflow-y-auto px-5 py-4 focus-visible:outline-offset-[-2px]"
      aria-label="Combination detail"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold text-fg">
          {r.combo.isBaseline ? "Your equipped set" : `#${r.rank} · Combination ${r.combo.id}`}
        </h3>
        <span className="text-[12.5px] text-faint">{loadout.name} talents</span>
      </div>
      <p className="num mt-1.5 text-[13px]">
        <span
          className={clsx(
            "text-[18px] font-medium",
            t === "gain" ? "text-gain" : t === "loss" ? "text-loss" : "text-fg",
          )}
        >
          {r.combo.isBaseline ? fmtDps(r.last.mean) : fmtPct(r.deltaPct)}
        </span>
        <span className="text-muted">
          {r.combo.isBaseline
            ? " DPS mean"
            : ` ${fmtSigned(r.delta)} DPS · ±${r.errorPct.toFixed(2)}% · ${fmtDps(r.last.mean)} mean`}
        </span>
      </p>
      {t === "noise" && !r.combo.isBaseline && (
        <p className="mt-1 text-[12.5px] text-muted">
          The error band crosses zero: this may be no better than what you wear.
        </p>
      )}
      {r.last.stage < stageCount && (
        <p className="mt-1 text-[12.5px] text-muted">
          {flow.run.outcome?.partial
            ? `Measured through stage ${r.last.stage} only, before the stop.`
            : `Culled after stage ${r.last.stage}: clearly behind the leaders at that precision.`}
        </p>
      )}

      {r.combo.changes.length > 0 ? (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {r.combo.changes.map((c) => {
            const { removed, added } = diffItems(c.from, c.to);
            const slot = SLOTS.find((s) => s.id === c.slot)!;
            return (
              <li
                key={c.slot}
                className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 py-2.5 max-md:grid-cols-1 max-md:gap-1.5"
              >
                <span className="pt-0.5 text-[12px] text-faint">{slot.label}</span>
                <div className="space-y-2">
                  {added.map((n, k) => {
                    const o = removed[k];
                    return (
                      <div key={n.uid} className="flex items-start gap-2.5">
                        {o && (
                          <>
                            <ItemIcon item={o} size="sm" dim showIlvl className="mt-1.5" />
                            <ArrowRight
                              size={13}
                              className="mt-3 shrink-0 text-faint"
                              aria-label="replaced by"
                            />
                          </>
                        )}
                        <ItemIcon item={n} size="md" glow={lit} showIlvl />
                        <div className="min-w-0">
                          <div className="text-[13px] leading-snug">
                            <ItemName item={n} />
                          </div>
                          <div className="num text-[11.5px] text-muted">
                            {o ? (
                              <>
                                {o.ilvl} → {n.ilvl}
                              </>
                            ) : (
                              n.ilvl
                            )}{" "}
                            · {statLine(n)}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <ItemFlags item={n} />
                          </div>
                          {o && (
                            <div className="mt-0.5 truncate text-[11.5px] text-faint">
                              replaces {o.name}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-[13px] text-muted">
          This is what you are wearing now. Every other row is measured against it.
        </p>
      )}
      {r.combo.changes.length > 0 && (
        <p className="mt-2 text-[12px] text-faint">
          Unchanged: {unchanged.map((s) => s.label).join(", ")}
        </p>
      )}

      <h4 className="mt-6 mb-1.5 text-[12.5px] font-medium text-muted">By stage</h4>
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[520px] text-[12px]">
          <thead>
            <tr className="text-left text-faint">
              {[
                "Stage",
                "Iterations",
                "Mean",
                "± error",
                "Median",
                "Min",
                "Max",
                "Std dev",
                "",
              ].map((h) => (
                <th
                  key={h}
                  className="border-b border-line py-1 pr-3 font-normal whitespace-nowrap last:pr-0"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.stages.map((s) => (
              <tr key={s.stage} className="text-fg">
                <td className="border-b border-line py-1 pr-3">{s.stage}</td>
                <td className="border-b border-line py-1 pr-3 text-muted">
                  {s.iterations.toLocaleString("en-US")}
                </td>
                <td className="border-b border-line py-1 pr-3">{fmtDps(s.mean)}</td>
                <td className="border-b border-line py-1 pr-3 text-muted">{fmtDps(s.error)}</td>
                <td className="border-b border-line py-1 pr-3 text-muted">{fmtDps(s.median)}</td>
                <td className="border-b border-line py-1 pr-3 text-muted">{fmtDps(s.min)}</td>
                <td className="border-b border-line py-1 pr-3 text-muted">{fmtDps(s.max)}</td>
                <td className="border-b border-line py-1 pr-3 text-muted">{fmtDps(s.stdDev)}</td>
                <td className="border-b border-line py-1 text-right">
                  {s.survived ? (
                    s.stage === stageCount ? (
                      <span className="text-muted">final</span>
                    ) : (
                      <span className="text-muted">kept</span>
                    )
                  ) : (
                    <span className="text-loss">culled</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!r.combo.isBaseline && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={flow.backToSetup}
            className="h-8 rounded-[6px] border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg hover:border-fg/40"
          >
            Copy to new Draft
          </button>
        </div>
      )}
    </div>
  );
}

export function Results({ flow }: { flow: Flow }) {
  const o = flow.run.outcome!;
  const stageCount = flow.run.stages.length;
  const [selectedId, setSelectedId] = useState(() => o.ranked[0].combo.id);
  useEffect(() => setSelectedId(o.ranked[0].combo.id), [o]);
  const selected = o.ranked.find((r) => r.combo.id === selectedId) ?? o.ranked[0];
  const detailRef = useRef<HTMLDivElement>(null);
  const phone = useIsPhone();
  const layout = useDefaultLayout({ id: "simbot-c-results", storage: safeStorage });
  const openDetail = () => {
    detailRef.current?.focus({ preventScroll: !phone });
    if (phone) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const ranking = (
    <Ranking
      o={o}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onOpen={openDetail}
      stageCount={stageCount}
      height={phone ? "56vh" : "auto"}
    />
  );
  const detail = <Detail r={selected} stageCount={stageCount} flow={flow} detailRef={detailRef} />;

  return (
    <div>
      <VerdictLine verdict={flow.run.verdict!} partial={o.partial} />
      <div className="mt-5 overflow-hidden rounded-[8px] border border-line bg-panel">
        {phone ? (
          <div className="flex flex-col">
            <div className="flex flex-col" style={{ height: "calc(56vh + 130px)" }}>
              {ranking}
            </div>
            <div className="border-t border-line">{detail}</div>
          </div>
        ) : (
          <Group
            orientation="horizontal"
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
            style={{ height: "min(720px, calc(100vh - 150px))", minHeight: 480 }}
          >
            <Panel id="ranking" defaultSize="58" minSize={420}>
              {ranking}
            </Panel>
            <Separator className="group relative w-px bg-line outline-none data-[separator=active]:bg-action data-[separator=hover]:bg-line-strong">
              <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
              <span className="absolute top-1/2 left-1/2 h-8 w-[3px] -translate-1/2 rounded-full bg-line-strong opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
            </Separator>
            <Panel id="detail" defaultSize="42" minSize={320}>
              {detail}
            </Panel>
          </Group>
        )}
      </div>
    </div>
  );
}
