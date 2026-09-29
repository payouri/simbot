import { simcStatusResponseSchema } from "@simbot/shared";
import { useQuery } from "@tanstack/react-query";

async function fetchSimcStatus() {
  const res = await fetch("/api/simc");
  if (!res.ok) throw new Error(`GET /api/simc failed: ${res.status}`);
  return simcStatusResponseSchema.parse(await res.json());
}

const FIELDS = [
  ["Tag", "tag"],
  ["SimC version", "simcVersion"],
  ["Commit", "gitRevision"],
  ["Branch", "gitBranch"],
  ["Game data version", "gameDataVersion"],
] as const;

/** Bare SimC page: the Current SimC Build's identity. Update flow and changelog come later. */
export function SimcPage() {
  const query = useQuery({
    queryKey: ["simc"],
    queryFn: fetchSimcStatus,
    // Poll while the boot-time install is running so the build appears without a reload.
    refetchInterval: (q) => (q.state.data?.install.state === "installing" ? 2000 : false),
  });
  const status = query.data;

  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <h1 className="text-[24px] font-semibold tracking-tight">SimC</h1>
      <section className="mt-6 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-[14px] font-semibold">Current SimC Build</h2>
        {query.isPending && <p className="mt-3 text-muted">Loading…</p>}
        {query.isError && <p className="mt-3 text-loss">Could not load SimC status.</p>}
        {status?.current && (
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
            {FIELDS.map(([label, key]) => (
              <div key={key} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="font-mono text-[12.5px]">{status.current?.[key]}</dd>
              </div>
            ))}
          </dl>
        )}
        {status && !status.current && (
          <p className="mt-3 text-muted">
            {status.install.state === "installing" && "Installing the latest SimC nightly…"}
            {status.install.state === "failed" && (
              <span className="text-loss">
                Could not install a SimC Build: {status.install.error}
              </span>
            )}
            {status.install.state === "idle" && "No SimC Build installed."}
          </p>
        )}
      </section>
    </main>
  );
}
