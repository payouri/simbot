import type { SimSettings, TopGearSelection } from "@simbot/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { patchSim } from "./api";

export type SaveState = { kind: "saved" } | { kind: "saving" } | { kind: "error"; message: string };

export type DraftInput = { settings: SimSettings; selection: TopGearSelection };

const SAVE_DELAY_MS = 400;

/**
 * A Draft's editable input with autosave. Edits apply at once and are sent after a short pause,
 * one request at a time (the next carries whatever changed meanwhile). `flush` sends what is
 * pending now and resolves once the server has it (it rejects if saving failed); the page also flushes as it unmounts and,
 * with `keepalive`, as it is hidden or closed, so a reload restores what was on screen.
 */
export function useDraftAutosave(simId: number, initial: DraftInput) {
  const [input, setInput] = useState(initial);
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const latest = useRef(initial);
  const dirty = useRef({ settings: false, selection: false });
  const running = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(async (): Promise<boolean> => {
    while (dirty.current.settings || dirty.current.selection) {
      const sending = { ...dirty.current };
      dirty.current = { settings: false, selection: false };
      setSave({ kind: "saving" });
      try {
        await patchSim(simId, {
          settings: sending.settings ? latest.current.settings : undefined,
          topGearSelection: sending.selection ? latest.current.selection : undefined,
        });
      } catch (err) {
        dirty.current = {
          settings: dirty.current.settings || sending.settings,
          selection: dirty.current.selection || sending.selection,
        };
        setSave({ kind: "error", message: err instanceof Error ? err.message : "Saving failed." });
        return false;
      }
    }
    setSave({ kind: "saved" });
    return true;
  }, [simId]);

  const flushQuietly = useCallback((): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!running.current) {
      running.current = send().finally(() => {
        running.current = null;
      });
    }
    return running.current;
  }, [send]);

  /** Resolves once the server has everything; rejects if a save failed so callers do not act on stale data. */
  const flush = useCallback(async (): Promise<void> => {
    if (!(await flushQuietly())) throw new Error("Saving failed; the setup was not saved.");
  }, [flushQuietly]);

  const retry = useCallback(() => void flushQuietly(), [flushQuietly]);

  const edit = useCallback(
    (change: { settings?: SimSettings; selection?: TopGearSelection }) => {
      latest.current = {
        settings: change.settings ?? latest.current.settings,
        selection: change.selection ?? latest.current.selection,
      };
      if (change.settings) dirty.current.settings = true;
      if (change.selection) dirty.current.selection = true;
      setInput(latest.current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flushQuietly(), SAVE_DELAY_MS);
    },
    [flushQuietly],
  );

  useEffect(() => {
    const onHide = () => {
      if (!dirty.current.settings && !dirty.current.selection) return;
      void patchSim(
        simId,
        {
          settings: dirty.current.settings ? latest.current.settings : undefined,
          topGearSelection: dirty.current.selection ? latest.current.selection : undefined,
        },
        { keepalive: true },
      ).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      void flushQuietly();
    };
  }, [simId, flushQuietly]);

  return { input, edit, flush, save, retry };
}
