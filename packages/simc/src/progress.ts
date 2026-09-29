import type { SimProgress } from "@simbot/shared";

/**
 * SimC's stdout progress, run with `progressbar_type=1` (tab-separated, `\n`-terminated) plus
 * the parallel-profileset aggregate, which is always `\r`-terminated. Pure: bytes in, lines out.
 */

/** One `Baseline` or `Profileset` line: a pass of SimC and how far along it is. */
export type IterationProgress = {
  kind: "iterations";
  base: "Baseline" | "Profileset";
  /** The profileset's name; null for the baseline. */
  name: string | null;
  phaseIndex: number;
  /** Baseline plus profilesets. It grows during the baseline while profilesets are still parsed. */
  phaseCount: number;
  iterations: number;
  /** A moving estimate in `target_error` mode. */
  totalIterations: number;
  iterationsPerSecond: number;
  /** Only when SimC tracks a `target_error`. */
  mean: number | null;
  /** Percent of the mean (0.338 is 0.338 %). Only when SimC tracks a `target_error`. */
  errorPct: number | null;
  /** Left in this pass. On a pass's final line SimC prints the elapsed time here instead. */
  secondsLeft: number;
  /** Left over all passes, when SimC knows. */
  totalSecondsLeft: number | null;
};

/** `Profilesets (2*2): 3/5 [...] avg=1.42s done=4s left=3s`, printed by parallel profileset workers. */
export type ProfilesetAggregate = {
  kind: "aggregate";
  workers: number;
  threadsPerWorker: number;
  done: number;
  total: number;
  secondsLeft: number | null;
};

export type ProgressLine = IterationProgress | ProfilesetAggregate;
export type ParsedLine = ProgressLine | { kind: "text"; text: string };

/** `23s`, `1m, 4s`, `1h, 2m, 3s` to seconds; null when it is not a duration. */
export function parseDuration(text: string): number | null {
  const parts = text.split(",").map((p) => p.trim());
  let total = 0;
  for (const part of parts) {
    const m = /^(\d+(?:\.\d+)?)([hms])$/.exec(part);
    if (!m) return null;
    total += Number(m[1]) * { h: 3600, m: 60, s: 1 }[m[2] as "h" | "m" | "s"];
  }
  return parts.length > 0 ? total : null;
}

const AGGREGATE = /^Profilesets \((\d+)\*(\d+)\): (\d+)\/(\d+)(?:\s.*?\bleft=(.*))?$/;

const num = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

function parseIterations(fields: string[]): IterationProgress | null {
  const base = fields[0];
  if (base !== "Baseline" && base !== "Profileset") return null;
  // Profileset lines carry the profileset's name as field 2; the baseline has none.
  const name = base === "Profileset" ? (fields[1] ?? null) : null;
  if (base === "Profileset" && name === null) return null;
  const head = fields.slice(base === "Profileset" ? 2 : 1);
  const [phaseIndex, phaseCount, iterations, totalIterations, ips] = head.slice(0, 5).map(num);
  // Then, in order: [mean, error] (target_error only), seconds left, [time left for all passes].
  // Only these counts are possible: 1 (secs), 2 (secs, all), 3 (mean, error, secs), 4 (all four).
  const rest = head.slice(5);
  if (
    phaseIndex == null ||
    phaseCount == null ||
    iterations == null ||
    totalIterations == null ||
    ips == null
  ) {
    return null;
  }
  let mean: number | null = null;
  let errorPct: number | null = null;
  let secondsLeft: number | null;
  let totalSecondsLeft: number | null = null;
  if (rest.length === 1 || rest.length === 2) {
    secondsLeft = num(rest[0]);
    if (rest.length === 2) {
      totalSecondsLeft = parseDuration(rest[1] ?? "");
      if (totalSecondsLeft === null) return null;
    }
  } else if (rest.length === 3 || rest.length === 4) {
    mean = num(rest[0]);
    errorPct = num(rest[1]);
    secondsLeft = num(rest[2]);
    if (rest.length === 4) {
      totalSecondsLeft = parseDuration(rest[3] ?? "");
      if (totalSecondsLeft === null) return null;
    }
    if (mean === null || errorPct === null) return null;
  } else {
    return null;
  }
  if (secondsLeft === null) return null;
  return {
    kind: "iterations",
    base,
    name,
    phaseIndex,
    phaseCount,
    iterations,
    totalIterations,
    iterationsPerSecond: ips,
    mean,
    errorPct,
    secondsLeft,
    totalSecondsLeft,
  };
}

/** Parses one already-split line. Anything that is not progress (or is malformed) is `text`. */
export function parseProgressLine(line: string): ParsedLine | null {
  const text = line.trim();
  if (text === "") return null;
  const aggregate = AGGREGATE.exec(text);
  if (aggregate) {
    const [, workers, threads, done, total, left] = aggregate;
    return {
      kind: "aggregate",
      workers: Number(workers),
      threadsPerWorker: Number(threads),
      done: Number(done),
      total: Number(total),
      secondsLeft: left === undefined ? null : parseDuration(left.trim()),
    };
  }
  return parseIterations(line.replace(/\s+$/, "").split("\t")) ?? { kind: "text", text };
}

/**
 * Turns arbitrary stdout chunks into whole lines, splitting on `\r` and `\n` (the aggregate
 * line ends with `\r`). A partial line waits for the rest of its chunk; `flush` releases it.
 */
export function createLineSplitter() {
  let carry = "";
  return {
    push(chunk: string): string[] {
      const parts = (carry + chunk).split(/\r|\n/);
      carry = parts.pop() ?? "";
      return parts;
    },
    flush(): string[] {
      const rest = carry;
      carry = "";
      return rest === "" ? [] : [rest];
    },
  };
}

/** Streaming form: text chunks in, parsed lines out (blank lines dropped). */
export function createProgressParser() {
  const splitter = createLineSplitter();
  const parse = (lines: string[]) =>
    lines.flatMap((line) => {
      const parsed = parseProgressLine(line);
      return parsed ? [parsed] : [];
    });
  return {
    push: (chunk: string) => parse(splitter.push(chunk)),
    flush: () => parse(splitter.flush()),
  };
}

/**
 * A parsed line as the shared progress shape. The ETA is SimC's own estimate: the time left
 * over all passes when it gives one, else for this pass. A pass's final line carries elapsed
 * time in that slot, so it gets no ETA.
 */
export function toSimProgress(
  line: ProgressLine,
  ctx: { simId: number; stage: number; targetErrorPct: number | null },
): SimProgress {
  const { simId, stage, targetErrorPct } = ctx;
  if (line.kind === "aggregate") {
    return {
      simId,
      stage,
      phase: "profilesets",
      label: null,
      done: line.done,
      total: line.total,
      phaseIndex: null,
      phaseCount: null,
      errorPct: null,
      targetErrorPct,
      etaSeconds: line.secondsLeft,
    };
  }
  const passFinished = line.iterations >= line.totalIterations;
  return {
    simId,
    stage,
    phase: line.base === "Baseline" ? "baseline" : "profileset",
    label: line.name,
    done: line.iterations,
    total: line.totalIterations,
    phaseIndex: line.phaseIndex,
    phaseCount: line.phaseCount,
    errorPct: line.errorPct,
    targetErrorPct,
    etaSeconds: line.totalSecondsLeft ?? (passFinished ? null : line.secondsLeft),
  };
}
