import type { QueueEntry } from "@simbot/shared";
import { Link } from "react-router";
import { useRunningSim } from "../live/live";
import { useQueueQuery } from "./api";
import { errorLabel, formatEta, fraction } from "./format";
import { Bar, WarmingUp } from "./Progress";

function Running({ entry }: { entry: QueueEntry }) {
  const live = useRunningSim(entry.simId);
  const progress = live?.progress ?? null;
  if (!progress) return <WarmingUp />;
  const error = errorLabel(progress);
  return (
    <div>
      <Bar progress={progress} />
      <p className="num mt-2 text-[12px] text-muted">
        {Math.round(fraction(progress) * 100)}%{error && ` · error ${error}`}
        {progress.etaSeconds !== null &&
          ` · about ${formatEta(progress.etaSeconds)} left (estimate)`}
      </p>
    </div>
  );
}

/** Waiting and running Jobs, in the order they run. */
export function QueuePage() {
  const queue = useQueueQuery();
  const entries = queue.data?.entries ?? [];
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 md:px-6">
      <h1 className="text-[20px] font-semibold tracking-tight">Queue</h1>
      <p className="mt-1 text-[12.5px] text-muted">
        One Sim runs at a time; the rest wait their turn.
      </p>
      {queue.isPending && <p className="mt-6 text-muted">Loading…</p>}
      {queue.isError && <p className="mt-6 text-loss">Could not load the Queue.</p>}
      {queue.data && entries.length === 0 && (
        <p className="mt-6 text-muted">
          Nothing is running or waiting.{" "}
          <Link to="/quick-sim" className="text-action hover:text-action-strong">
            Run a Quick Sim
          </Link>
        </p>
      )}
      <ol className="mt-6 flex flex-col gap-3">
        {entries.map((entry, i) => (
          <li key={entry.jobId} className="rounded-[10px] border border-line bg-panel/60 p-4">
            <div className="flex items-baseline justify-between gap-4">
              <Link
                to={`/sims/${entry.simId}`}
                className="text-[14px] font-semibold hover:text-action"
              >
                <span className="num mr-2 text-faint">{i + 1}</span>
                {entry.character.name}
                <span className="ml-2 text-[12.5px] font-normal text-muted">
                  Quick Sim · {entry.character.spec} {entry.character.class}
                </span>
              </Link>
              <span
                className={`text-[12.5px] ${entry.status === "running" ? "text-fg" : "text-muted"}`}
              >
                {entry.status === "running" ? "Running" : "Waiting"}
              </span>
            </div>
            {entry.status === "running" && (
              <div className="mt-3">
                <Running entry={entry} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
