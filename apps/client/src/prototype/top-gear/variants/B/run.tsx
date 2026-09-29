// Variant B running: the sheet stays; the centre becomes the stage ladder and log.

import clsx from "clsx";
import { Check, CircleAlert, Copy, Loader2, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SlotId } from "../../data";
import { equippedIn, pool } from "../../engine";
import { type Flow, fmtDuration, type LogLine, type StageProgress } from "../../flow";
import { Sheet, type Side, SlotTile, useIsPhone } from "./doll";

export function Running({ flow }: { flow: Flow }) {
  const phone = useIsPhone();
  const active = flow.run.status === "running" || flow.run.status === "queued";
  const renderSlot = (id: SlotId, side: Side) => {
    const n = pool(id, flow.selection).length;
    const varies = n > (id === "finger" || id === "trinket" ? 2 : 1);
    return (
      <SlotTile
        slot={id}
        side={side}
        items={equippedIn(id)}
        interactive={false}
        quiet={!varies}
        meta={
          varies ? (
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 text-action",
                side === "right" && "flex-row-reverse",
              )}
            >
              <span
                className={clsx("size-1.5 rounded-full bg-action", active && "animate-pulse")}
              />
              <span className="num">{n}</span> in play
            </span>
          ) : (
            <span className="text-faint">Fixed</span>
          )
        }
      />
    );
  };
  return <Sheet phone={phone} renderSlot={renderSlot} center={<Ladder flow={flow} />} />;
}

function Ladder({ flow }: { flow: Flow }) {
  const r = flow.run;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const active = r.status === "running" || r.status === "queued";
  return (
    <div className="flex h-full min-h-[480px] flex-col gap-5 rounded-[10px] border border-line bg-panel/60 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1" aria-live="polite">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold">
            {r.status === "queued" && (
              <>
                <Loader2 size={16} className="animate-spin text-muted" /> Queued, position{" "}
                <span className="num">{r.queuePosition}</span>
              </>
            )}
            {r.status === "running" && (
              <>
                <Loader2 size={16} className="animate-spin text-action" /> Simming
              </>
            )}
            {r.status === "failed" && (
              <>
                <CircleAlert size={16} className="text-loss" /> SimC failed
              </>
            )}
            {r.status === "cancelled" && "Run discarded"}
            {r.status === "succeeded" && (
              <>
                <Check size={16} className="text-gain" /> Done
              </>
            )}
          </h2>
          <p className="num text-[12.5px] text-muted">
            {r.status === "queued"
              ? "Starts when Kaelthra's Quick Sim finishes"
              : `${fmtDuration(r.elapsed)} elapsed${active ? ` · about ${fmtDuration(r.eta)} left` : ""}`}
          </p>
        </div>
        {active && (
          <div className="flex items-center gap-2">
            {confirmDiscard ? (
              <>
                <span className="text-[12.5px] text-muted">Throw away every result?</span>
                <button
                  className="rounded-[6px] bg-loss px-3 py-1.5 text-[12.5px] font-medium text-[oklch(0.18_0.02_30)]"
                  onClick={() => flow.stop(false)}
                >
                  Discard
                </button>
                <button
                  className="rounded-[6px] px-2.5 py-1.5 text-[12.5px] text-muted hover:text-fg"
                  onClick={() => setConfirmDiscard(false)}
                >
                  Keep running
                </button>
              </>
            ) : (
              <>
                <button
                  className="flex items-center gap-1.5 rounded-[6px] border border-line-strong px-3 py-1.5 text-[12.5px] font-medium hover:bg-raised disabled:opacity-40"
                  onClick={() => flow.stop(true)}
                  disabled={r.status === "queued"}
                  title={
                    r.status === "queued"
                      ? "Nothing has run yet"
                      : "Stop now and rank what has finished"
                  }
                >
                  <Square size={11} fill="currentColor" /> Stop and keep results
                </button>
                <button
                  className="rounded-[6px] px-2.5 py-1.5 text-[12.5px] text-muted hover:text-loss"
                  onClick={() => setConfirmDiscard(true)}
                >
                  Discard
                </button>
              </>
            )}
          </div>
        )}
      </header>

      <ol className="flex flex-col gap-3.5">
        {r.stages.map((s) => (
          <StageRow key={s.plan.index} s={s} />
        ))}
      </ol>

      {r.status === "failed" && (
        <div className="flex flex-col gap-3 rounded-[8px] border border-loss/35 bg-loss-wash p-3.5">
          <p className="num text-[12px] leading-relaxed break-words text-fg">{r.error}</p>
          <p className="text-[12.5px] text-muted">
            Nothing was ranked. The likely fix is a newer SimC; your setup is kept either way.
          </p>
          <div className="flex gap-2">
            <button
              className="flex items-center gap-1.5 rounded-[6px] bg-action px-3 py-1.5 text-[12.5px] font-medium text-action-ink hover:bg-action-strong"
              onClick={flow.backToSetup}
            >
              <Copy size={13} /> Copy to new Draft
            </button>
            <button
              className="flex items-center gap-1.5 rounded-[6px] border border-line-strong px-3 py-1.5 text-[12.5px] hover:bg-raised"
              onClick={flow.start}
            >
              <RotateCcw size={13} /> Retry
            </button>
          </div>
        </div>
      )}
      {r.status === "cancelled" && r.discarded && (
        <div className="flex items-center justify-between gap-3 rounded-[8px] border border-line p-3.5 text-[12.5px]">
          <span className="text-muted">
            Nothing was kept. Your selection and settings are still there.
          </span>
          <button
            className="rounded-[6px] border border-line-strong px-3 py-1.5 font-medium hover:bg-raised"
            onClick={flow.backToSetup}
          >
            Back to setup
          </button>
        </div>
      )}

      <Log lines={r.log} />
    </div>
  );
}

function StageRow({ s }: { s: StageProgress }) {
  const pct = s.entered ? (s.done / s.entered) * 100 : 0;
  const fill = s.state === "done" ? 100 : pct;
  return (
    <li
      className={clsx(
        "flex flex-col gap-1.5 transition-opacity duration-200",
        s.state === "pending" && "opacity-45",
      )}
    >
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="flex items-baseline gap-2">
          <span className="num text-faint">{s.plan.index}</span>
          <span className="font-medium">{s.plan.label}</span>
          <span className="num text-[11.5px] text-faint">
            {s.plan.iterations.toLocaleString("en-US")} it
          </span>
        </span>
        <span className="num text-[12.5px] text-muted">
          {s.state === "done" && s.survivors !== undefined ? (
            <>
              {s.entered.toLocaleString("en-US")} <span className="text-faint">→</span>{" "}
              <span className="text-fg">{s.survivors.toLocaleString("en-US")}</span> kept
            </>
          ) : s.state === "running" ? (
            <>
              {s.done.toLocaleString("en-US")} / {s.entered.toLocaleString("en-US")}
            </>
          ) : s.state === "stopped" ? (
            <span className="text-loss">stopped at {Math.round(pct)}%</span>
          ) : (
            <>up to {s.entered.toLocaleString("en-US")}</>
          )}
        </span>
      </div>
      <div
        className="h-[3px] overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={Math.round(fill)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Stage ${s.plan.index}`}
      >
        <div
          className={clsx(
            "h-full rounded-full transition-[width] duration-150 ease-linear",
            s.state === "done" ? "bg-fg/35" : s.state === "stopped" ? "bg-loss" : "bg-action",
          )}
          style={{ width: `${fill}%` }}
        />
      </div>
    </li>
  );
}

function Log({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  const tone: Record<LogLine["kind"], string> = {
    info: "text-muted",
    stage: "text-fg",
    progress: "text-muted",
    cull: "text-fg",
    error: "text-loss",
    done: "text-gain",
    warn: "text-loss",
  };
  return (
    <div
      ref={ref}
      className="num mt-auto max-h-[200px] min-h-[120px] overflow-y-auto rounded-[8px] bg-sunk px-3 py-2.5 text-[11.5px] leading-[1.65]"
      aria-label="SimC log"
    >
      {lines.map((l) => (
        <div key={l.id} className="flex gap-3">
          <span className="w-10 shrink-0 text-right text-faint">{fmtDuration(l.t)}</span>
          <span className={clsx("min-w-0 break-words", tone[l.kind])}>{l.text}</span>
        </div>
      ))}
    </div>
  );
}
