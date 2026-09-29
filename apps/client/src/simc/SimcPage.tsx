import type { SimcStatusResponse, SimcUpdateStatus } from "@simbot/shared";
import { useCheckSimcNow, useSimcStatus } from "./api";

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
      {status?.current && <Update status={status} />}
    </main>
  );
}
