import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createLineSplitter,
  createProgressParser,
  type ParsedLine,
  parseDuration,
  parseProgressLine,
  toSimProgress,
} from "./progress";

const transcript = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures/progress", name), "utf8");

const parseAll = (text: string, chunk = text.length || 1) => {
  const parser = createProgressParser();
  const out: ParsedLine[] = [];
  for (let i = 0; i < text.length; i += chunk) out.push(...parser.push(text.slice(i, i + chunk)));
  out.push(...parser.flush());
  return out;
};
const progressOnly = (lines: ParsedLine[]) => lines.filter((l) => l.kind !== "text");

describe("recorded Quick Sim", () => {
  test("its one Baseline line is the final line with elapsed time", () => {
    const lines = progressOnly(parseAll(transcript("quick-sim-recorded.txt")));
    expect(lines).toEqual([
      {
        kind: "iterations",
        base: "Baseline",
        name: null,
        phaseIndex: 1,
        phaseCount: 1,
        iterations: 131,
        totalIterations: 131,
        iterationsPerSecond: 72.626,
        mean: 149861.052,
        errorPct: 0.574,
        secondsLeft: 0.113,
        totalSecondsLeft: null,
      },
    ]);
  });

  test("the banner, thread merges and report lines stay text", () => {
    const text = parseAll(transcript("quick-sim-recorded.txt")).filter((l) => l.kind === "text");
    expect(text.length).toBeGreaterThan(5);
    expect(text.some((l) => l.text.startsWith("Merging data from thread-"))).toBe(true);
  });
});

describe("target_error baseline", () => {
  test("carries mean and error percent and their moving totals", () => {
    const lines = progressOnly(parseAll(transcript("baseline-target-error.txt")));
    expect(lines.map((l) => l.kind === "iterations" && [l.iterations, l.totalIterations])).toEqual([
      [100, 3451],
      [400, 3726],
      [3726, 3726],
    ]);
    expect(lines[1]).toMatchObject({ mean: 261243.629, errorPct: 0.338, secondsLeft: 5.109 });
  });
});

describe("sequential profilesets", () => {
  test("names may contain spaces; the baseline has no name column", () => {
    const [base, night, gnome] = progressOnly(parseAll(transcript("sequential-profilesets.txt")));
    expect(base).toMatchObject({ base: "Baseline", name: null, phaseCount: 6, secondsLeft: 7.771 });
    expect(night).toMatchObject({
      base: "Profileset",
      name: "Night Elf",
      phaseIndex: 2,
      iterations: 61,
      mean: null,
      errorPct: null,
      secondsLeft: 5.313,
      totalSecondsLeft: 23,
    });
    expect(gnome).toMatchObject({ name: "Gnome", secondsLeft: 3, iterations: 120 });
  });

  test("a duration such as `1m, 4s` in the last column is the time left for all passes", () => {
    const lines = progressOnly(parseAll(transcript("sequential-profilesets.txt")));
    expect(lines[2]).toMatchObject({ name: "Gnome", totalSecondsLeft: 64 });
  });
});

describe("parallel profilesets", () => {
  test("\\r-terminated aggregate lines each become one update", () => {
    const lines = progressOnly(parseAll(transcript("parallel-profilesets.txt")));
    expect(lines.map((l) => l.kind)).toEqual(["iterations", "aggregate", "aggregate", "aggregate"]);
    expect(lines.slice(1)).toEqual([
      { kind: "aggregate", workers: 2, threadsPerWorker: 2, done: 1, total: 5, secondsLeft: 0 },
      { kind: "aggregate", workers: 2, threadsPerWorker: 2, done: 3, total: 5, secondsLeft: 3 },
      { kind: "aggregate", workers: 2, threadsPerWorker: 2, done: 5, total: 5, secondsLeft: 0 },
    ]);
  });
});

describe("chunking", () => {
  test.each(["quick-sim-recorded.txt", "sequential-profilesets.txt", "parallel-profilesets.txt"])(
    "%s parses the same however the stream is chunked",
    (name) => {
      const text = transcript(name);
      const whole = parseAll(text);
      for (const size of [1, 3, 7, 64]) expect(parseAll(text, size)).toEqual(whole);
    },
  );

  test("a line waits for its terminator; flush releases the last one", () => {
    const splitter = createLineSplitter();
    expect(splitter.push("Profilesets (1*1): 1/2")).toEqual([]);
    expect(splitter.push(" [=>]\rnext")).toEqual(["Profilesets (1*1): 1/2 [=>]"]);
    expect(splitter.flush()).toEqual(["next"]);
    expect(splitter.flush()).toEqual([]);
  });
});

describe("malformed lines", () => {
  test.each([
    "Baseline\t1\t1",
    "Baseline\tx\t1\t2\t3\t4\t5",
    "Baseline\t1\t1\t2\t3\t4\t5\t6",
    "Profileset",
    "Profilesets (a*b): 1/2",
    "Generating reports...",
  ])("%j is text, never a crash", (line) => {
    expect(parseProgressLine(line)).toEqual({ kind: "text", text: line.trim() });
  });

  test("blank lines are dropped", () => {
    expect(parseProgressLine("  \t ")).toBeNull();
  });
});

test("parseDuration", () => {
  expect(parseDuration("23s")).toBe(23);
  expect(parseDuration("1m, 4s")).toBe(64);
  expect(parseDuration("1h, 2m, 3s")).toBe(3723);
  expect(parseDuration("soon")).toBeNull();
  expect(parseDuration("")).toBeNull();
});

describe("toSimProgress", () => {
  const ctx = { simId: 7, stage: 1, targetErrorPct: 0.2 };
  const lines = () => progressOnly(parseAll(transcript("baseline-target-error.txt")));

  test("a running baseline line carries error, target and SimC's ETA", () => {
    const [, mid] = lines();
    if (mid?.kind !== "iterations") throw new Error("expected a baseline line");
    expect(toSimProgress(mid, ctx)).toEqual({
      simId: 7,
      stage: 1,
      phase: "baseline",
      label: null,
      done: 400,
      total: 3726,
      phaseIndex: 1,
      phaseCount: 1,
      errorPct: 0.338,
      targetErrorPct: 0.2,
      etaSeconds: 5.109,
    });
  });

  test("a pass's final line has no ETA, since SimC prints elapsed time there", () => {
    const last = lines().at(-1);
    if (last?.kind !== "iterations") throw new Error("expected a baseline line");
    expect(toSimProgress(last, ctx).etaSeconds).toBeNull();
  });

  test("the time left for all passes wins over this pass's", () => {
    const line = progressOnly(parseAll(transcript("sequential-profilesets.txt")))[1];
    if (line?.kind !== "iterations") throw new Error("expected a profileset line");
    expect(toSimProgress(line, ctx)).toMatchObject({
      phase: "profileset",
      label: "Night Elf",
      etaSeconds: 23,
    });
  });

  test("an aggregate line counts profilesets", () => {
    const line = progressOnly(parseAll(transcript("parallel-profilesets.txt")))[2];
    if (line?.kind !== "aggregate") throw new Error("expected an aggregate line");
    expect(toSimProgress(line, ctx)).toMatchObject({
      phase: "profilesets",
      done: 3,
      total: 5,
      errorPct: null,
      etaSeconds: 3,
    });
  });
});
