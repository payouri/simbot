import type { SimProgress } from "@simbot/shared";
import { errorLabel, formatEta, fraction, passLabel, unitsLabel } from "./format";

/** Shown from the moment a Sim starts until SimC prints its first progress line. */
export function WarmingUp() {
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-muted" role="status">
      <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-noise" />
      Warming up. SimC is loading the profile and has not reported yet.
    </p>
  );
}

/** The bar itself. In target-error mode SimC's total is an estimate, so the bar is too. */
export function Bar({ progress, className = "" }: { progress: SimProgress; className?: string }) {
  const percent = Math.round(fraction(progress) * 100);
  return (
    <div
      role="progressbar"
      aria-label="Stage progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={`h-1.5 overflow-hidden rounded-full bg-sunk ${className}`}
    >
      <div
        className="h-full rounded-full bg-action transition-[width] duration-200"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** A Stage's live progress: bar, done/total, error against target, and an ETA labelled as an estimate. */
export function ProgressReadout({
  progress,
  stage,
}: {
  progress: SimProgress;
  stage: number | null;
}) {
  const percent = Math.round(fraction(progress) * 100);
  const error = errorLabel(progress);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-[12.5px]">
        <span className="text-muted">
          {stage !== null && <span className="num">Stage {stage}</span>}
          {stage !== null && " · "}
          {passLabel(progress)}
          {progress.phaseIndex !== null && progress.phaseCount !== null && (
            <span className="num text-faint">
              {" "}
              ({progress.phaseIndex} of {progress.phaseCount})
            </span>
          )}
        </span>
        <span className="num text-fg">{percent}%</span>
      </div>
      <Bar progress={progress} className="mt-2" />
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-[12.5px]">
        <dt className="text-faint">Done</dt>
        <dd className="num">{unitsLabel(progress)}</dd>
        {error && (
          <>
            <dt className="text-faint">Error vs target</dt>
            <dd className="num">{error}</dd>
          </>
        )}
        {progress.etaSeconds !== null && (
          <>
            <dt className="text-faint">Time left (estimate)</dt>
            <dd className="num">about {formatEta(progress.etaSeconds)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
