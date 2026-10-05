import { type GameData, ptrAvailable } from "@simbot/shared";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { useNavigate } from "react-router";
import { copySimToPtrDraft } from "../quick-sim/api";
import { Tag } from "../ui/Tag";
import { useSimcStatus } from "./api";

const LABEL: Record<GameData, string> = { live: "Live", ptr: "PTR" };

/** Marks a PTR Sim so a PTR result is never mistaken for a Live one. Live Sims carry none. */
export function GameDataBadge({
  gameData,
  version,
}: {
  gameData: GameData;
  version?: string | null;
}) {
  if (gameData !== "ptr") return null;
  return (
    <span title={version ? `PTR game data ${version}` : "Simmed on PTR game data"}>
      <Tag tone="action">PTR</Tag>
    </span>
  );
}

/**
 * On a PTR Sim the item stats and levels on screen are Live item data (PTR item data is not read
 * yet), while SimC itself sims with the PTR data. Says so, and renders nothing for a Live Sim.
 */
export function LiveItemStatsNote({
  gameData,
  className,
}: {
  gameData: GameData;
  className?: string;
}) {
  if (gameData !== "ptr") return null;
  return (
    <p role="note" className={className}>
      Item stats shown are Live. This Sim runs on PTR game data.
    </p>
  );
}

/**
 * The Game Data choice of a Draft. Hidden while PTR Sims are off, unless the Draft is already
 * PTR (a copy of a PTR Sim), so it can still be switched back. PTR is shown but disabled, with
 * the reason, when the Current SimC Build has no PTR data that differs from Live.
 */
export function GameDataControl({
  value,
  onChange,
  seg,
}: {
  value: GameData;
  onChange: (next: GameData) => void;
  /** The caller's segmented-button class, so the control matches its form. */
  seg: (on: boolean) => string;
}) {
  const status = useSimcStatus().data;
  if (!status || (!status.ptrEnabled && value !== "ptr")) return null;
  const build = status.current;
  // With PTR Sims off the server hides the build's PTR data from the status, so availability is
  // unknown here; a PTR Draft (copied from a PTR Sim) still runs, so don't claim it will fail.
  const unavailable = !status.ptrEnabled
    ? null
    : !build
      ? "No SimC Build is installed"
      : ptrAvailable(build)
        ? null
        : build.ptrCheckError
          ? `PTR failed its Check Sim on ${build.tag}`
          : `No PTR data in SimC Build ${build.tag}`;
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0 text-[11.5px] text-faint">
      <legend className="mb-1.5 p-0">Game Data</legend>
      <div className="flex gap-1">
        {(["live", "ptr"] as const).map((g) => {
          const disabled = g === "ptr" && unavailable !== null && value !== "ptr";
          return (
            <button
              key={g}
              type="button"
              aria-pressed={value === g}
              disabled={disabled}
              title={disabled ? (unavailable ?? undefined) : undefined}
              onClick={() => onChange(g)}
              className={clsx(seg(value === g), disabled && "cursor-not-allowed opacity-50")}
            >
              {LABEL[g]}
            </button>
          );
        })}
      </div>
      {unavailable && value !== "ptr" && <span role="note">{unavailable}</span>}
      {unavailable && value === "ptr" && (
        <span role="note" className="text-loss">
          {unavailable}: this PTR Sim will fail.
        </span>
      )}
    </fieldset>
  );
}

/**
 * "Copy to PTR Draft", next to a Sim's copy action: the same setup as a new Draft on PTR Game
 * Data. Shown only while PTR Sims are on and the Current SimC Build has PTR data. A copy of a PTR
 * Sim is already PTR (the plain copy does that, even with the setting off), so none is offered.
 */
export function CopyToPtrDraft({
  simId,
  gameData,
  className,
}: {
  simId: number;
  gameData: GameData;
  className?: string;
}) {
  const status = useSimcStatus().data;
  const navigate = useNavigate();
  const copy = useMutation({
    mutationFn: () => copySimToPtrDraft(simId),
    onSuccess: (draft) => navigate(`/sims/${draft.id}/setup`),
  });
  if (gameData === "ptr" || !status?.ptrEnabled || !status.current || !ptrAvailable(status.current))
    return null;
  return (
    <>
      <button
        type="button"
        disabled={copy.isPending}
        onClick={() => copy.mutate()}
        className={className}
      >
        Copy to PTR Draft
      </button>
      {copy.isError && (
        <span role="alert" className="text-[12.5px] text-loss">
          {copy.error.message}
        </span>
      )}
    </>
  );
}
