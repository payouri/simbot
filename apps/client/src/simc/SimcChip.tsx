import type { SimcStatusResponse } from "@simbot/shared";
import { Link } from "react-router";
import { useSimcStatus } from "./api";

type Tone = "quiet" | "dot" | "accent" | "error";

/** The chip's border and text, and its dot (none when quiet), for each tone. */
const TONES: Record<Tone, { chip: string; dot: string | null }> = {
  quiet: { chip: "border-line text-muted hover:bg-panel hover:text-fg", dot: null },
  dot: { chip: "border-line text-muted hover:bg-panel hover:text-fg", dot: "bg-noise" },
  accent: { chip: "border-action/50 bg-action-wash text-fg", dot: "bg-action" },
  error: { chip: "border-loss/50 text-fg hover:bg-panel", dot: "bg-loss" },
};

/**
 * Red when item data is missing or the first update check failed, accented when an update is
 * installable, dotted when commits are ahead, quiet otherwise.
 */
export function chipView(status: SimcStatusResponse | undefined): {
  tone: Tone;
  label: string;
  title: string;
} {
  const build = status?.current;
  const base = build ? `SimC ${build.simcVersion}` : "SimC";
  const update = status?.update;
  if (build && status?.itemMetaError) {
    return {
      tone: "error",
      label: `${base} · item data missing`,
      title: "Item data could not be built, so imported items are unresolved. See the SimC page.",
    };
  }
  if (build && update?.state === "error") {
    return {
      tone: "error",
      label: `${base} · update check failed`,
      title: "The update check failed. See the SimC page.",
    };
  }
  if (build && update?.state === "installable") {
    return {
      tone: "accent",
      label: `${base} · update available`,
      title: "A newer SimC Build can be installed",
    };
  }
  if (build && update?.state === "commits_ahead") {
    const n = update.aheadBy;
    return {
      tone: "dot",
      label: `${base} · ${n} ${n === 1 ? "commit" : "commits"} behind`,
      title: "The next build is expected overnight",
    };
  }
  return { tone: "quiet", label: base, title: "SimC" };
}

export function SimcChip() {
  const { data } = useSimcStatus();
  const { tone, label, title } = chipView(data);
  const { chip, dot } = TONES[tone];
  return (
    <Link
      to="/simc"
      title={title}
      className={[
        "inline-flex h-[26px] items-center gap-2 rounded-md border px-2.5 text-[12.5px] transition-colors duration-150",
        chip,
      ].join(" ")}
    >
      {dot && <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />}
      <span className="num">{label}</span>
    </Link>
  );
}
