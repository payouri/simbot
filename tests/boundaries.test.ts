import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

/**
 * Lints `source` as a probe file at `path`, so the per-directory Biome overrides apply.
 * (Biome's stdin mode does not report lint diagnostics, hence the temporary file.)
 */
async function lintAs(path: string, source: string) {
  const file = join(repoRoot, dirname(path), `boundary-probe-${crypto.randomUUID()}.ts`);
  writeFileSync(file, source);
  try {
    const proc = Bun.spawn(["bunx", "biome", "lint", file], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: repoRoot,
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode: await proc.exited, output: out + err };
  } finally {
    rmSync(file, { force: true });
  }
}

const rule = "noRestrictedImports";

describe("import boundaries (Biome)", () => {
  const violations: [string, string, string][] = [
    ["http -> runner", "apps/server/src/http/x.ts", 'import { startRunner } from "../runner";'],
    ["http -> runner (deep)", "apps/server/src/http/x.ts", 'import "../runner/jobs";'],
    [
      "runner -> http",
      "apps/server/src/runner/x.ts",
      'import { createHttpHandler } from "../http";',
    ],
    ["simc -> bun:sqlite", "packages/simc/src/x.ts", 'import { Database } from "bun:sqlite";'],
    ["simc -> node:http", "packages/simc/src/x.ts", 'import { createServer } from "node:http";'],
    [
      "simc -> server db",
      "packages/simc/src/x.ts",
      'import { openDb } from "@simbot/server/src/db";',
    ],
    ["shared -> node builtin", "packages/shared/src/x.ts", 'import { join } from "node:path";'],
    ["shared -> workspace package", "packages/shared/src/x.ts", 'import "@simbot/simc";'],
    ["shared -> third party", "packages/shared/src/x.ts", 'import "react";'],
  ];

  for (const [name, path, source] of violations) {
    test(`${name} fails`, async () => {
      const { exitCode, output } = await lintAs(path, `${source}\n`);
      expect(output).toContain(rule);
      expect(exitCode).not.toBe(0);
    });
  }

  const allowed: [string, string, string][] = [
    ["http -> db", "apps/server/src/http/x.ts", 'import type { Db } from "../db";'],
    ["runner -> db", "apps/server/src/runner/x.ts", 'import type { Db } from "../db";'],
    [
      "shared -> zod",
      "packages/shared/src/x.ts",
      'import { z } from "zod";\nexport const s = z.string();',
    ],
    ["shared -> sibling", "packages/shared/src/x.ts", 'export * from "./health";'],
  ];

  for (const [name, path, source] of allowed) {
    test(`${name} is allowed`, async () => {
      const { output } = await lintAs(path, `${source}\n`);
      expect(output).not.toContain(rule);
    });
  }
});
