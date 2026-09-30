import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db";
import { recoverInterruptedSims } from "../db/sims";
import type { EventBus } from "../events";
import { settleSim } from "../settle";

/** Whether `pid` is a live `simc`, by what `/proc` says it is running. */
export type IsSimcProcess = (pid: number) => boolean;

/** True when the process's executable (or its command's first word) is named `simc`. */
export const isSimcProcess: IsSimcProcess = (pid) => {
  try {
    const comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    if (comm === "simc") return true;
    const [argv0 = ""] = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    return argv0.split("/").at(-1) === "simc";
  } catch {
    return false; // Gone, or no /proc.
  }
};

/** Signals a process group (SimC and whatever it forked); false when there is nothing to signal. */
export function killGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    // SimC runs as its own group leader (spawned detached), so -pid reaches its children too.
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Boot recovery, before the runner starts: kills any `simc` a dead server left behind (only a
 * stored PID that `/proc` still shows as `simc`, since PIDs get reused), wipes `tmp/`, and
 * settles each interrupted Sim Job: back to the head of the Queue to resume at its first
 * unfinished Stage, or `failed` after two interruptions in a row.
 */
export function recoverInterruptedRuns(deps: {
  db: Db;
  dataDir: string;
  bus: EventBus;
  isSimc?: IsSimcProcess;
}) {
  const { db, dataDir, bus, isSimc = isSimcProcess } = deps;
  const recovered = recoverInterruptedSims(db);
  for (const { pid } of recovered) {
    if (pid !== null && isSimc(pid)) killGroup(pid, "SIGKILL");
  }
  rmSync(join(dataDir, "tmp"), { recursive: true, force: true });
  for (const { simId, outcome } of recovered) settleSim({ dataDir, bus }, simId, outcome);
}
