import { type GameData, ptrAvailable } from "@simbot/shared";
import clsx from "clsx";
import { Tag } from "../setup/ItemTile";
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
  const unavailable = !build
    ? "No SimC Build is installed"
    : ptrAvailable(build)
      ? null
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
