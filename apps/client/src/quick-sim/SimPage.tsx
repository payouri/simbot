import type { SimStatus } from "@simbot/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useRunningSim } from "../live/live";
import { ProgressReadout, WarmingUp } from "../queue/Progress";
import { getResults, getSim } from "./api";

const STATUS_LABEL: Record<SimStatus, string> = {
  draft: "Draft",
  queued: "Waiting in the Queue",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
};

const isFinished = (status: SimStatus | undefined) => status === "succeeded" || status === "failed";

const dpsFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** A Quick Sim: its state while it waits and runs, then DPS ± error. */
export function SimPage() {
  const id = Number(useParams().id);
  const sim = useQuery({
    queryKey: ["sim", id],
    queryFn: () => getSim(id),
    refetchInterval: (q) => (isFinished(q.state.data?.status) ? false : 1000),
  });
  const succeeded = sim.data?.status === "succeeded";
  const results = useQuery({
    queryKey: ["sim", id, "results"],
    queryFn: () => getResults(id),
    enabled: succeeded,
  });
  const live = useRunningSim(id);
  const dps = results.data?.results.find((r) => r.isBaseline)?.dps;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 md:px-6">
      <div className="flex gap-4 text-[12.5px]">
        <Link to="/quick-sim" className="text-muted hover:text-fg">
          New Quick Sim
        </Link>
        <Link to="/queue" className="text-muted hover:text-fg">
          Queue
        </Link>
      </div>
      {sim.isPending && <p className="mt-6 text-muted">Loading…</p>}
      {sim.isError && <p className="mt-6 text-loss">Could not load this Sim.</p>}
      {sim.data && (
        <>
          <h1 className="mt-3 text-[20px] font-semibold tracking-tight">
            {sim.data.character.name}
            <span className="ml-2 text-[12.5px] font-normal text-muted">
              {sim.data.character.spec} {sim.data.character.class}, {sim.data.character.realm}
            </span>
          </h1>

          <section className="mt-6 rounded-[10px] border border-line bg-panel/60 p-5">
            <p className="text-[12.5px] text-muted">{STATUS_LABEL[sim.data.status]}</p>
            {sim.data.status === "running" &&
              (live?.progress ? (
                <div className="mt-3">
                  <ProgressReadout progress={live.progress} stage={live.stage} />
                </div>
              ) : (
                <div className="mt-3">
                  <WarmingUp />
                </div>
              ))}
            {dps && (
              <p className="num mt-2 text-[26px] font-semibold leading-none tracking-tight">
                {dpsFormat.format(dps.mean)}
                <span className="ml-2 text-[16px] font-normal text-muted">
                  ± {dpsFormat.format(dps.meanError)}
                </span>
                <span className="ml-2 text-[12.5px] font-normal text-faint">DPS</span>
              </p>
            )}
            {results.isError && <p className="mt-2 text-loss">Could not load the result.</p>}
            {sim.data.status === "failed" && sim.data.error && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-loss/35 bg-loss-wash p-3 text-[12.5px]"
              >
                <p>{sim.data.error.message}</p>
                {sim.data.error.stderr && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-sunk p-3 font-mono text-[11.5px] leading-[1.65] text-muted">
                    {sim.data.error.stderr}
                  </pre>
                )}
              </div>
            )}
            {sim.data.simcTag && (
              <p className="mt-3 text-[11.5px] text-faint">
                Simmed with SimC <span className="num">{sim.data.simcTag}</span>
              </p>
            )}
          </section>

          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-[12.5px]">
            <dt className="text-faint">Fight</dt>
            <dd className="num">
              {sim.data.settings.fightStyle}, {sim.data.settings.durationSeconds}s,{" "}
              {sim.data.settings.targets} target{sim.data.settings.targets === 1 ? "" : "s"}
            </dd>
            <dt className="text-faint">Precision</dt>
            <dd>{sim.data.settings.precision}</dd>
          </dl>
        </>
      )}
    </main>
  );
}
