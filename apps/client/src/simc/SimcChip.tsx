import type { SimcStatusResponse } from "@simbot/shared";
import { Link } from "react-router";
import { useSimcStatus } from "./api";

type Tone = "quiet" | "dot" | "accent";

/** Quiet when up to date, dotted when commits are ahead, accented when an update is installable. */
export function chipView(status: SimcStatusResponse | undefined): {
  tone: Tone;
  label: string;
  title: string;
} {
  const build = status?.current;
  const base = build ? `SimC ${build.simcVersion}` : "SimC";
  const update = status?.update;
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
  return (
    <Link
      to="/simc"
      title={title}
      className={[
        "inline-flex h-[26px] items-center gap-2 rounded-md border px-2.5 text-[12.5px] transition-colors duration-150",
        tone === "accent"
          ? "border-action/50 bg-action-wash text-fg"
          : "border-line text-muted hover:bg-panel hover:text-fg",
      ].join(" ")}
    >
      {tone !== "quiet" && (
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${tone === "accent" ? "bg-action" : "bg-noise"}`}
        />
      )}
      <span className="num">{label}</span>
    </Link>
  );
}
