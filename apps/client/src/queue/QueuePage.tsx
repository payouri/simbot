import type { QueueEntry, SimcUpdateQueueEntry, SimQueueEntry } from "@simbot/shared";
import { Link } from "react-router";
import { useRunningSim } from "../live/live";
import { GameDataBadge } from "../simc/GameData";
import { STEP_LABEL, targetLabel } from "../simc/labels";
import { useQueueQuery } from "./api";
import { errorLabel, formatEta, fraction } from "./format";
import { Bar, WarmingUp } from "./Progress";

function Running({ entry }: { entry: SimQueueEntry }) {
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

function Status({ status }: { status: QueueEntry["status"] }) {
  return (
    <span className={`text-[12.5px] ${status === "running" ? "text-fg" : "text-muted"}`}>
      {status === "running" ? "Running" : "Waiting"}
    </span>
  );
}

function SimRow({ entry, position }: { entry: SimQueueEntry; position: number }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <Link to={`/sims/${entry.simId}`} className="text-[14px] font-semibold hover:text-action">
          <span className="num mr-2 text-faint">{position}</span>
          {entry.character.name}
          <span className="ml-2 text-[12.5px] font-normal text-muted">
            Quick Sim · {entry.character.spec} {entry.character.class}
          </span>
          <span className="ml-2 align-middle">
            <GameDataBadge gameData={entry.gameData} />
          </span>
        </Link>
        <Status status={entry.status} />
      </div>
      {entry.status === "running" && (
        <div className="mt-3">
          <Running entry={entry} />
        </div>
      )}
    </>
  );
}

/** A SimC Update holds the Queue while it installs: show its target and the step it is on. */
function SimcUpdateRow({ entry, position }: { entry: SimcUpdateQueueEntry; position: number }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <Link to="/simc" className="text-[14px] font-semibold hover:text-action">
          <span className="num mr-2 text-faint">{position}</span>
          SimC Update
          <span className="ml-2 text-[12.5px] font-normal text-muted">
            {targetLabel(entry.target)}
            {/* An installed target already names its tag; a nightly or seed shows what it resolved to. */}
            {entry.tag && entry.target.kind !== "installed" && ` · ${entry.tag}`}
          </span>
        </Link>
        <Status status={entry.status} />
      </div>
      {entry.status === "running" && (
        <p className="num mt-3 text-[12px] text-muted">
          {entry.step ? `${STEP_LABEL[entry.step]}…` : "Starting…"}
        </p>
      )}
    </>
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
        One Job runs at a time, a Sim or a SimC Update; the rest wait their turn.
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
          <li
            key={`${entry.type}-${entry.jobId}`}
            className="rounded-[10px] border border-line bg-panel/60 p-4"
          >
            {entry.type === "sim" ? (
              <SimRow entry={entry} position={i + 1} />
            ) : (
              <SimcUpdateRow entry={entry} position={i + 1} />
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
