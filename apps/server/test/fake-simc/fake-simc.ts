#!/usr/bin/env bun
/**
 * A stand-in for the `simc` executable that replays a recorded run. It takes the same
 * arguments the runner gives SimC, preceded by `--scenario=<dir>`, and replays that
 * directory's files:
 *
 *   stdout.txt     progress transcript, written to stdout
 *   stderr.txt     written to stderr
 *   json2.json.gz  (or json2.json) written to the `json2=<path>` argument; absent means
 *                  SimC wrote no report
 *   exit           exit code (default 0)
 *
 * If `--gate=<file>` is given, it writes stdout and stderr, then waits until that file exists
 * before writing the report and exiting, so a test can observe a Sim mid-run.
 *
 * If `--report=<file>` is given (also before the SimC arguments), it also records how it was launched there (pid, process
 * group, argv, and the input file's text), so tests can check what the runner did.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const scenarioArg = args.find((a) => a.startsWith("--scenario="));
if (!scenarioArg) {
  console.error("fake-simc: missing --scenario=<dir>");
  process.exit(2);
}
const scenario = scenarioArg.slice("--scenario=".length);
const reportArg = args.find((a) => a.startsWith("--report="));
const gateArg = args.find((a) => a.startsWith("--gate="));
const simcArgs = args.filter((a) => a !== scenarioArg && a !== reportArg && a !== gateArg);
const [input, ...options] = simcArgs;
const option = (name: string) =>
  options.find((o) => o.startsWith(`${name}=`))?.slice(name.length + 1);

if (!input || !existsSync(input)) {
  console.error(`Error: cannot open input file ${input}`);
  process.exit(3);
}

const report = reportArg?.slice("--report=".length);
if (report) {
  // /proc/self/stat is "pid (comm) state ppid pgrp ...": pgrp is the 3rd field after ")".
  const stat = readFileSync("/proc/self/stat", "utf8");
  const pgid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
  writeFileSync(
    report,
    JSON.stringify({
      pid: process.pid,
      pgid,
      args: simcArgs,
      input: readFileSync(input, "utf8"),
      cwd: process.cwd(),
    }),
  );
}

const read = (name: string) => {
  const path = join(scenario, name);
  return existsSync(path) ? readFileSync(path) : null;
};

const flush = (stream: NodeJS.WriteStream, data: Buffer | string) =>
  new Promise<void>((done) => void stream.write(data, () => done()));
await flush(process.stdout, read("stdout.txt") ?? "");
await flush(process.stderr, read("stderr.txt") ?? "");

const gate = gateArg?.slice("--gate=".length);
while (gate && !existsSync(gate)) await new Promise((r) => setTimeout(r, 10));

const json2Path = option("json2");
const gz = read("json2.json.gz");
const plain = read("json2.json");
if (json2Path && (gz || plain)) {
  writeFileSync(json2Path, gz ? gunzipSync(gz) : (plain as Buffer));
}

process.exit(Number(read("exit")?.toString().trim() ?? "0"));
