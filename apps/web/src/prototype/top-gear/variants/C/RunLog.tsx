// Variant C: the running Sim as an append-only streaming log, Vercel-build style.
import { useEffect, useLayoutEffect, useRef } from "react";
import clsx from "clsx";
import { fmtDuration, type Flow, type LogLine, type StageProgress } from "../../flow";

const stamp = (t: number) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const LINE_TONE: Record<LogLine["kind"], string> = {
  info: "text-muted",
  stage: "text-fg",
  progress: "text-muted",
  cull: "text-muted",
  warn: "text-fg",
  error: "text-loss",
  done: "text-fg font-medium",
};

function StageBar({ s }: { s: StageProgress }) {
  const frac = s.entered ? s.done / s.entered : 0;
  const pct = s.state === "done" ? 100 : Math.round(frac * 100);
  return (
    <div className="grid grid-cols-[48px_1fr_auto] items-center gap-3 py-1 max-md:grid-cols-[1fr_auto]">
      <span className="num text-[11.5px] text-faint max-md:hidden" />
      <div className="flex min-w-0 items-center gap-3">
        <span className={clsx("w-[112px] shrink-0 whitespace-nowrap text-[12.5px] max-md:w-auto", s.state === "pending" ? "text-faint" : "text-fg")}>
          Stage {s.plan.index} · {s.plan.label}
        </span>
        <div className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Stage ${s.plan.index}`}>
          <div
            className={clsx(
              "absolute inset-y-0 left-0 rounded-full transition-[width] duration-150 ease-linear",
              s.state === "stopped" ? "bg-noise" : s.state === "done" ? "bg-[var(--fg-faint)]" : "bg-action",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="num w-[190px] text-right text-[12px] text-muted max-md:w-auto">
        {s.state === "pending" ? (
          <span className="text-faint">waiting</span>
        ) : (
          <>
            {s.done.toLocaleString("en-US")}/{s.entered.toLocaleString("en-US")}
            {s.state === "done" && s.survivors !== undefined && s.survivors !== s.entered && <span className="text-faint"> · kept {s.survivors.toLocaleString("en-US")}</span>}
            {s.state === "stopped" && <span className="text-faint"> · stopped</span>}
          </>
        )}
      </span>
    </div>
  );
}

export function RunLog({ flow }: { flow: Flow }) {
  const run = flow.run;
  const endRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  // follow the newest line unless the user scrolled up
  useEffect(() => {
    const onScroll = () => {
      following.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (following.current && (run.status === "running" || run.status === "queued")) endRef.current?.scrollIntoView({ block: "end" });
  }, [run.log.length, run.status]);

  const live = run.status === "running" || run.status === "queued";

  return (
    <div>
      <div className="rounded-[8px] border border-line bg-sunk">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-[12.5px]">
          <span className="font-medium text-fg">
            {run.status === "queued" && <>Queued · position <span className="num">{run.queuePosition}</span></>}
            {run.status === "running" && <>Running on 16 threads</>}
            {run.status === "succeeded" && <>Finished</>}
            {run.status === "failed" && <span className="text-loss">SimC failed</span>}
            {run.status === "cancelled" && (run.discarded ? <>Stopped and discarded</> : <>Stopped, partial results kept</>)}
          </span>
          <span className="num ml-auto text-muted">
            {fmtDuration(run.elapsed)} elapsed
            {live && <span className="text-faint"> · about {fmtDuration(run.eta)} left</span>}
          </span>
        </div>

        {run.stages.length > 0 && (
          <div className="border-b border-line px-3 py-1.5">
            {run.stages.map((s) => (
              <StageBar key={s.plan.index} s={s} />
            ))}
          </div>
        )}

        <ol className="num max-h-none px-3 py-2 text-[12.5px] leading-[22px]" aria-live="polite" aria-label="SimC log">
          {run.log.map((l) => (
            <li key={l.id} className="grid grid-cols-[48px_1fr] gap-3 max-md:grid-cols-[40px_1fr]">
              <span className="text-faint select-none">{stamp(l.t)}</span>
              <span className={clsx("break-words", LINE_TONE[l.kind])}>{l.text}</span>
            </li>
          ))}
          {live && (
            <li className="grid grid-cols-[48px_1fr] gap-3 max-md:grid-cols-[40px_1fr]" aria-hidden>
              <span className="text-faint">{stamp(run.elapsed)}</span>
              <span className="inline-block h-[14px] w-[7px] translate-y-[4px] animate-pulse bg-action" />
            </li>
          )}
        </ol>
        <div ref={endRef} />
      </div>

      {live && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => flow.stop(true)}
            className="h-8 rounded-[6px] border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg transition-colors duration-150 hover:border-fg/40"
          >
            Stop and keep results
          </button>
          <button
            type="button"
            onClick={() => flow.stop(false)}
            className="h-8 rounded-[6px] px-3 text-[13px] font-medium text-loss transition-colors duration-150 hover:bg-loss-wash"
          >
            Discard
          </button>
          <span className="text-[12px] text-faint">Stopping keeps every combination at the last stage it finished.</span>
        </div>
      )}

      {run.status === "failed" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={flow.backToSetup} className="h-8 rounded-[6px] bg-action px-3 text-[13px] font-medium text-action-ink hover:bg-action-strong">
            Copy to new Draft
          </button>
          <button type="button" onClick={flow.start} className="h-8 rounded-[6px] border border-line-strong bg-panel px-3 text-[13px] font-medium text-fg hover:border-fg/40">
            Retry
          </button>
          <span className="text-[12px] text-muted">The bonus id is newer than this SimC build. Applying the SimC Update usually fixes this.</span>
        </div>
      )}

      {run.status === "cancelled" && run.discarded && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={flow.backToSetup} className="h-8 rounded-[6px] bg-action px-3 text-[13px] font-medium text-action-ink hover:bg-action-strong">
            Back to setup
          </button>
          <span className="text-[12px] text-muted">Nothing from this run was kept.</span>
        </div>
      )}
    </div>
  );
}
