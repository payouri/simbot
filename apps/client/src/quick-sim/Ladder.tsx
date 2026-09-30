import type { LadderStage, SimStatus } from "@simbot/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { type LogLine, useRunningSim } from "../live/live";
import { getLadder } from "./api";

const count = new Intl.NumberFormat("en-US");

const TONE = { debug: "text-faint", info: "text-muted", warn: "text-loss", error: "text-loss" };

/** A Top Gear's Stages: each one's target, and how many Combinations entered and were kept. */
export function StageLadder({ simId, status }: { simId: number; status: SimStatus | undefined }) {
  const live = useRunningSim(simId);
  const ladder = useQuery({
    queryKey: ["sim", simId, "ladder"],
    queryFn: () => getLadder(simId),
    refetchInterval: status === "running" || status === "queued" ? 5000 : false,
  });
  const stages = ladder.data?.stages ?? [];
  if (stages.length === 0) return null;
  return (
    <ol className="mt-4 flex flex-col gap-3" aria-label="Stage ladder">
      {stages.map((s) => (
        <StageRow
          key={s.stage}
          stage={s}
          running={status === "running" && live?.stage === s.stage}
          stopped={status === "cancelled" && s.entered === null}
        />
      ))}
    </ol>
  );
}

function StageRow({
  stage: s,
  running,
  stopped,
}: {
  stage: LadderStage;
  running: boolean;
  stopped: boolean;
}) {
  const done = s.entered !== null && s.kept !== null;
  return (
    <li className={running || done ? "" : "opacity-45"}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="flex items-baseline gap-2">
          <span className="num text-faint">{s.stage}</span>
          <span className="font-medium">to {s.targetErrorPct}% error</span>
        </span>
        <span className="num text-[12.5px] text-muted">
          {done ? (
            <>
              {count.format(s.entered ?? 0)} <span className="text-faint">→</span>{" "}
              <span className="text-fg">{count.format(s.kept ?? 0)}</span> kept
              {s.culled > 0 && (
                <span className="text-faint">, {count.format(s.culled)} culled</span>
              )}
            </>
          ) : running ? (
            <span className="text-action">running</span>
          ) : stopped ? (
            <span className="text-loss">stopped</span>
          ) : (
            "waiting"
          )}
          {s.invalid > 0 && (
            <span className="text-loss">, {count.format(s.invalid)} invalid dropped</span>
          )}
        </span>
      </div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div
          className={`h-full rounded-full ${done ? "bg-fg/35" : stopped ? "bg-loss" : "bg-action"} ${running ? "w-1/3 animate-pulse" : ""}`}
          style={done ? { width: "100%" } : undefined}
        />
      </div>
    </li>
  );
}

/** The running Sim's log, newest last, kept scrolled to the end. */
export function RunLog({ simId }: { simId: number }) {
  const live = useRunningSim(simId);
  const lines: LogLine[] = live?.log ?? [];
  const ref = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a line arrives
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  if (lines.length === 0) return null;
  return (
    <div
      ref={ref}
      role="log"
      aria-label="SimC log"
      className="num mt-4 max-h-[200px] min-h-[80px] overflow-y-auto rounded-[8px] bg-sunk px-3 py-2.5 text-[11.5px] leading-[1.65]"
    >
      {lines.map((l) => (
        <div key={l.id} className={`break-words ${TONE[l.level]}`}>
          {l.message}
        </div>
      ))}
    </div>
  );
}
