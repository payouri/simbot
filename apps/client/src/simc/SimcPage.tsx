import {
  deltaTone,
  MAX_KEEP_BUILDS,
  type SimcCheckSim,
  type SimcJob,
  type SimcJobTarget,
  type SimcStatusResponse,
  type SimcUpdateStatus,
  type SimcUpdateStep,
} from "@simbot/shared";
import { useCheckSimcNow, useQueueSimcJob, useSetKeepBuilds, useSimcStatus } from "./api";

const FIELDS = [
  ["Tag", "tag"],
  ["SimC version", "simcVersion"],
  ["Commit", "gitRevision"],
  ["Branch", "gitBranch"],
  ["Game data version", "gameDataVersion"],
] as const;

const SUMMARY: Record<SimcUpdateStatus["state"], (u: SimcUpdateStatus) => string> = {
  up_to_date: () => "SimC is up to date.",
  commits_ahead: (u) =>
    `${u.aheadBy} ${u.aheadBy === 1 ? "commit" : "commits"} ahead of this build. No newer build yet, the next one is expected overnight.`,
  error: () => "Could not check for updates.",
  installable: (u) =>
    u.target?.source === "seed"
      ? "A newer SimC Build ships with this app."
      : "A newer SimC nightly is available.",
};

const ago = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
};

function Build({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="num break-all text-[12.5px]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const STEP_LABEL: Record<SimcUpdateStep, string> = {
  fetch: "Fetching the build",
  check: "Running the Check Sim",
  meta: "Building item data",
  commit: "Switching over",
};

const targetLabel = (t: SimcJobTarget) =>
  t.kind === "installed"
    ? `Switch to ${t.tag}`
    : t.kind === "seed"
      ? "Install the shipped build"
      : "Install the latest nightly";

const dpsFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** The pending or failed SimC Update Job; a failed one shows its step and error, with Retry. */
function JobPanel({ job }: { job: SimcJob }) {
  const queue = useQueueSimcJob();
  const failed = job.status === "failed";
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="text-[14px] font-semibold">
        {failed ? "SimC update failed" : "SimC update in progress"}
      </h2>
      <p className="mt-2 text-[13px] text-muted">
        {targetLabel(job.target)}
        {job.tag && job.target.kind !== "installed" ? ` (${job.tag})` : ""}
      </p>
      {failed ? (
        <>
          <p className="mt-2 text-loss">
            Failed at: {job.step ? STEP_LABEL[job.step] : "start"}. {job.error}
          </p>
          <p className="mt-1 text-[12.5px] text-faint">The Current SimC Build was not changed.</p>
          <button
            type="button"
            onClick={() => queue.mutate(job.target)}
            disabled={queue.isPending}
            className="mt-3 rounded-md border border-line-strong px-3 py-1.5 text-[12.5px] font-medium hover:bg-raised disabled:text-faint"
          >
            Retry
          </button>
        </>
      ) : (
        <p className="mt-2 num text-[12.5px]">
          {job.status === "queued"
            ? "Waiting in the Queue behind running sims."
            : `${job.step ? STEP_LABEL[job.step] : "Starting"}…`}
        </p>
      )}
    </section>
  );
}

const TONE_CLASS = { gain: "text-gain", loss: "text-loss", noise: "text-noise" } as const;

/** Check Sim DPS of the Current SimC Build, as a delta against the previous build when known. */
function CheckSimDelta({ check }: { check: SimcCheckSim }) {
  const prev = check.previous;
  const diff = prev ? check.dps.mean - prev.dps.mean : null;
  const pct = prev && diff !== null && prev.dps.mean > 0 ? (diff / prev.dps.mean) * 100 : null;
  const tone =
    prev && diff !== null ? deltaTone(diff, check.dps.meanError, prev.dps.meanError) : "noise";
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="text-[14px] font-semibold">Check Sim</h2>
      <p className="mt-2 num text-[13px]">
        {dpsFormat.format(check.dps.mean)} DPS ± {dpsFormat.format(check.dps.meanError)}
      </p>
      {prev && diff !== null ? (
        <p className={`mt-1 num text-[13px] ${TONE_CLASS[tone]}`}>
          {diff >= 0 ? "+" : "−"}
          {dpsFormat.format(Math.abs(diff))} DPS
          {pct !== null && ` (${diff >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%)`}
          <span className="text-faint"> vs {prev.tag}</span>
        </p>
      ) : (
        <p className="mt-1 text-[12.5px] text-faint">
          No earlier build was checked on this Import.
        </p>
      )}
    </section>
  );
}

function Installed({ status }: { status: SimcStatusResponse }) {
  const queue = useQueueSimcJob();
  const setKeep = useSetKeepBuilds();
  const busy = status.job?.status === "queued" || status.job?.status === "running";
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">Installed builds</h2>
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Keep
          <input
            type="number"
            min={1}
            max={MAX_KEEP_BUILDS}
            defaultValue={status.keep}
            key={status.keep}
            onBlur={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isInteger(n) && n >= 1 && n <= MAX_KEEP_BUILDS && n !== status.keep) {
                setKeep.mutate(n);
              }
            }}
            className="num w-14 rounded-md border border-line-strong bg-sunk px-2 py-1 text-fg"
          />
        </label>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {status.installed.map((b) => {
          const isCurrent = b.tag === status.current?.tag;
          return (
            <li key={b.tag} className="flex items-center justify-between gap-3 py-2">
              <span className="num min-w-0 break-all text-[12.5px]">{b.tag}</span>
              {isCurrent ? (
                <span className="shrink-0 text-[12.5px] text-muted">Current</span>
              ) : (
                <button
                  type="button"
                  onClick={() => queue.mutate({ kind: "installed", tag: b.tag })}
                  disabled={busy || queue.isPending}
                  className="shrink-0 rounded-md border border-line-strong px-3 py-1 text-[12.5px] font-medium hover:bg-raised disabled:text-faint disabled:hover:bg-transparent"
                >
                  Switch
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[12.5px] text-faint">
        Switching to an older build pins it. The current build and any in use are never removed.
      </p>
      {(queue.isError || setKeep.isError) && (
        <p className="mt-2 text-loss">That did not go through. Try again.</p>
      )}
    </section>
  );
}

function Changelog({ update }: { update: SimcUpdateStatus }) {
  if (update.commits.length === 0) return null;
  const hidden = update.aheadBy - update.commits.length;
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[14px] font-semibold">Changelog</h2>
        {update.compareUrl && (
          <a
            href={update.compareUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[12.5px] text-action hover:text-action-strong"
          >
            Compare on GitHub
          </a>
        )}
      </div>
      <ul className="mt-3 divide-y divide-line">
        {update.commits.map((c) => (
          <li key={c.sha} className="flex gap-3 py-2">
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="num shrink-0 text-[12.5px] text-action hover:text-action-strong"
            >
              {c.sha.slice(0, 7)}
            </a>
            <span className="min-w-0 break-words text-[13px]">{c.title}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-2 text-[12.5px] text-muted">
          {hidden} more on GitHub, past the first {update.commits.length}.
        </p>
      )}
    </section>
  );
}

function InstallButton({
  status,
  target,
}: {
  status: SimcStatusResponse;
  target: "nightly" | "seed";
}) {
  const queue = useQueueSimcJob();
  const busy = status.job?.status === "queued" || status.job?.status === "running";
  return (
    <button
      type="button"
      onClick={() => queue.mutate({ kind: target })}
      disabled={busy || queue.isPending}
      className="mt-3 rounded-md bg-action px-3 py-1.5 text-[12.5px] font-medium text-action-ink hover:bg-action-strong disabled:opacity-50"
    >
      Update SimC
    </button>
  );
}

function Update({ status }: { status: SimcStatusResponse }) {
  const check = useCheckSimcNow();
  const update = status.update;
  return (
    <>
      <section className="rounded-xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold">Updates</h2>
          <button
            type="button"
            onClick={() => check.mutate()}
            disabled={check.isPending}
            className="rounded-md border border-line-strong px-3 py-1.5 text-[12.5px] font-medium hover:bg-raised disabled:text-faint disabled:hover:bg-transparent"
          >
            {check.isPending ? "Checking…" : "Check now"}
          </button>
        </div>
        {update ? (
          <>
            <p className="mt-3">{SUMMARY[update.state](update)}</p>
            {update.state === "installable" && update.target && (
              <InstallButton status={status} target={update.target.source} />
            )}
            {update.error && <p className="mt-2 text-loss">Last check failed: {update.error}</p>}
            <p className="mt-2 text-[12.5px] text-faint">Checked {ago(update.checkedAt)}</p>
          </>
        ) : (
          <p className="mt-3 text-muted">Checking for updates…</p>
        )}
        {check.isError && <p className="mt-2 text-loss">Could not run the check.</p>}
      </section>
      {update?.target && (
        <Build
          title="Latest SimC Build"
          rows={[
            ["Tag", update.target.tag],
            [
              "Source",
              update.target.source === "seed" ? "Shipped with the app" : "Docker Hub nightly",
            ],
          ]}
        />
      )}
      {update && <Changelog update={update} />}
    </>
  );
}

/** The SimC page: the Current SimC Build, what is newer, and the commits in between. */
export function SimcPage() {
  const query = useSimcStatus();
  const status = query.data;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-5 py-10">
      <h1 className="text-[24px] font-semibold tracking-tight">SimC</h1>
      {query.isPending && <p className="text-muted">Loading…</p>}
      {query.isError && <p className="text-loss">Could not load SimC status.</p>}
      {status?.current && (
        <Build
          title="Current SimC Build"
          rows={FIELDS.map(([label, key]) => [label, status.current?.[key] ?? ""])}
        />
      )}
      {status && !status.current && (
        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="text-[14px] font-semibold">Current SimC Build</h2>
          <p className="mt-3 text-muted">
            {status.install.state === "installing" && "Installing the latest SimC nightly…"}
            {status.install.state === "failed" && (
              <span className="text-loss">
                Could not install a SimC Build: {status.install.error}
              </span>
            )}
            {status.install.state === "idle" && "No SimC Build installed."}
          </p>
        </section>
      )}
      {status?.itemMetaError && (
        <section role="status" className="rounded-xl border border-loss/35 bg-loss-wash p-5">
          <h2 className="text-[14px] font-semibold">Item data</h2>
          <p className="mt-3">
            Could not build item data for this SimC Build, so imported items show up unresolved:{" "}
            {status.itemMetaError}
          </p>
          <p className="mt-2 text-[12.5px] text-muted">
            It is retried the next time the app starts.
          </p>
        </section>
      )}
      {status?.job && <JobPanel job={status.job} />}
      {status?.current && <Update status={status} />}
      {status?.checkSim && <CheckSimDelta check={status.checkSim} />}
      {status && status.installed.length > 0 && <Installed status={status} />}
    </main>
  );
}
