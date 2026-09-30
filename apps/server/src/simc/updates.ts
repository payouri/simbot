import type { SimcCommit, SimcUpdateStatus, SimcUpdateTarget } from "@simbot/shared";
import type { Fetch } from "./registry";

const REPO = "simulationcraft/simc";
const API = `https://api.github.com/repos/${REPO}`;
const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "simbot",
  "x-github-api-version": "2022-11-28",
};

/** `<simc version>-<date>-<short sha>`, as produced by the nightly images. */
const TAG_PARTS = /^\d+-(\d{4}-\d{2}-\d{2})-([0-9a-f]+)$/;

const tagDate = (tag: string) => TAG_PARTS.exec(tag)?.[1] ?? null;

/** Sort order for SimC Builds, newest first: by the date in the tag, then by the tag itself. */
export function newestFirst(a: { tag: string }, b: { tag: string }): number {
  const x = tagDate(a.tag) ?? "";
  const y = tagDate(b.tag) ?? "";
  if (x !== y) return x < y ? 1 : -1;
  return a.tag < b.tag ? 1 : a.tag > b.tag ? -1 : 0;
}

/**
 * Whether `candidate` is a newer build than `current`. Nightly tags carry their date, so a later
 * date wins. On the same date a different commit only counts when Docker Hub pushed it after
 * `current` (`hubOrder` is the Hub list, most recently pushed first).
 */
function isNewer(candidate: string, current: string, hubOrder: readonly string[]): boolean {
  if (candidate === current) return false;
  const a = tagDate(candidate);
  const b = tagDate(current);
  if (!a || !b) return false;
  if (a !== b) return a > b;
  const ai = hubOrder.indexOf(candidate);
  const bi = hubOrder.indexOf(current);
  return ai !== -1 && (bi === -1 || ai < bi);
}

/** The newest of the candidate tags, or null when none is newer than `current`. */
function newestOffer(
  current: string,
  hubTags: readonly string[],
  seedTag: string | null,
): SimcUpdateTarget | null {
  const offers: SimcUpdateTarget[] = [];
  const nightly = hubTags.find((t) => isNewer(t, current, hubTags));
  if (nightly) offers.push({ source: "nightly", tag: nightly });
  if (seedTag && isNewer(seedTag, current, hubTags)) offers.push({ source: "seed", tag: seedTag });
  // Only the newest is offered. A nightly wins a tie: it is the fresher artefact to install.
  return (
    offers.sort((x, y) => {
      const dx = tagDate(x.tag) ?? "";
      const dy = tagDate(y.tag) ?? "";
      if (dx !== dy) return dx < dy ? 1 : -1;
      return x.source === "nightly" ? -1 : 1;
    })[0] ?? null
  );
}

async function githubJson(fetchFn: Fetch, url: string): Promise<unknown> {
  const res = await fetchFn(url, { headers: GITHUB_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} from api.github.com`);
  return res.json();
}

export type CompareResult = {
  branch: string;
  aheadBy: number;
  commits: SimcCommit[];
  compareUrl: string;
};

/** GitHub `/compare` from `revision` to the repository's active branch (`default_branch`). */
export async function compareToActiveBranch(
  fetchFn: Fetch,
  revision: string,
): Promise<CompareResult> {
  const repo = (await githubJson(fetchFn, API)) as { default_branch?: unknown };
  if (typeof repo.default_branch !== "string" || repo.default_branch === "") {
    throw new Error("GitHub did not report a default_branch for SimC");
  }
  const branch = repo.default_branch;
  const cmp = (await githubJson(
    fetchFn,
    `${API}/compare/${encodeURIComponent(revision)}...${encodeURIComponent(branch)}`,
  )) as {
    ahead_by?: unknown;
    html_url?: unknown;
    commits?: { sha?: unknown; html_url?: unknown; commit?: { message?: unknown } }[];
  };
  const commits = (cmp.commits ?? []).map((c): SimcCommit => {
    const message = typeof c.commit?.message === "string" ? c.commit.message : "";
    const sha = String(c.sha ?? "");
    return {
      sha,
      title: message.split("\n", 1)[0] ?? "",
      message,
      url: typeof c.html_url === "string" ? c.html_url : `https://github.com/${REPO}/commit/${sha}`,
    };
  });
  return {
    branch,
    aheadBy: typeof cmp.ahead_by === "number" ? cmp.ahead_by : commits.length,
    commits,
    compareUrl:
      typeof cmp.html_url === "string"
        ? cmp.html_url
        : `https://github.com/${REPO}/compare/${revision}...${branch}`,
  };
}

/**
 * Runs one SimC Update check: GitHub compare plus the Hub tag list. Throws if either call fails
 * (the caller records the failure), so a half-answered check never lands in the store.
 */
export async function runUpdateCheck(opts: {
  fetch: Fetch;
  listNightlyTags: () => Promise<string[]>;
  currentTag: string;
  gitRevision: string;
  seedTag: string | null;
  now: Date;
}): Promise<SimcUpdateStatus> {
  const [compare, hubTags] = await Promise.all([
    compareToActiveBranch(opts.fetch, opts.gitRevision),
    opts.listNightlyTags(),
  ]);
  const target = newestOffer(opts.currentTag, hubTags, opts.seedTag);
  return {
    state: target ? "installable" : compare.aheadBy > 0 ? "commits_ahead" : "up_to_date",
    checkedAt: opts.now.toISOString(),
    error: null,
    currentTag: opts.currentTag,
    branch: compare.branch,
    aheadBy: compare.aheadBy,
    commits: compare.commits,
    compareUrl: compare.compareUrl,
    target,
  };
}
