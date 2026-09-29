// Variant C: one step of the run sheet. Collapses to a one-line summary once behind you.
import type { ReactNode } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Loader2, X, Circle, Pause } from "lucide-react";

export type SectionStatus = "done" | "active" | "pending" | "running" | "error" | "stopped";

const ICON: Record<SectionStatus, ReactNode> = {
  done: <Check size={13} strokeWidth={2.5} />,
  active: <Circle size={8} fill="currentColor" strokeWidth={0} />,
  pending: <Circle size={8} strokeWidth={2} />,
  running: <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />,
  error: <X size={13} strokeWidth={2.5} />,
  stopped: <Pause size={11} strokeWidth={2.5} fill="currentColor" />,
};
const ICON_TONE: Record<SectionStatus, string> = {
  done: "text-muted border-line-strong bg-panel",
  active: "text-action border-action/60 bg-action-wash",
  pending: "text-faint border-line bg-bg",
  running: "text-action border-action/60 bg-action-wash",
  error: "text-loss border-loss/60 bg-loss-wash",
  stopped: "text-muted border-line-strong bg-panel",
};

export function Section({
  id,
  status,
  title,
  summary,
  aside,
  open,
  onToggle,
  last,
  below,
  children,
}: {
  id: string;
  status: SectionStatus;
  title: string;
  summary?: ReactNode;
  aside?: ReactNode;
  open: boolean;
  onToggle?: () => void;
  last?: boolean;
  /** always visible, open or collapsed (warnings that belong to this step) */
  below?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={`c-${id}`} className="relative pl-10" aria-labelledby={`c-${id}-h`}>
      {!last && <span aria-hidden className="absolute top-8 bottom-0 left-[11px] w-px bg-line" />}
      <span
        aria-hidden
        className={clsx("absolute top-[7px] left-0 grid size-[23px] place-items-center rounded-full border", ICON_TONE[status])}
      >
        {ICON[status]}
      </span>
      <div className="flex min-h-9 items-center gap-3">
        <button
          type="button"
          id={`c-${id}-h`}
          onClick={onToggle}
          disabled={!onToggle}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-[4px] py-1.5 text-left disabled:cursor-default"
        >
          <h2 className="shrink-0 text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
          {!open && summary && <span className="min-w-0 truncate text-[13px] text-muted">{summary}</span>}
          {onToggle && (
            <ChevronDown
              size={14}
              className={clsx("ml-auto shrink-0 text-faint transition-transform duration-200 ease-out-quart group-hover:text-muted", open && "rotate-180")}
            />
          )}
        </button>
        {aside}
      </div>
      {below && <div className="pt-1.5">{below}</div>}
      {open && <div className="pt-2 pb-9">{children}</div>}
      {!open && <div className="pb-5" />}
    </section>
  );
}
