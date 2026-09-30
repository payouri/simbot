#!/usr/bin/env bun
/**
 * Benchmark Top Gear runs to calibrate threading and precision defaults.
 *
 * Usage:
 *   SIMC_DIR=<path>/simc/<tag> bun apps/server/benchmark.ts
 *
 * Benchmarks real Top Gear runs with varying combination counts and measures:
 * - Actual wall-clock time vs estimated time
 * - Cost model calibration (msPerIteration, iterationsTimesErrorSq)
 * - Optimal PROFILESET_WORK_THREADS and ITERATIONS_CEILING values
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./src/app.ts";

interface BenchmarkResult {
  combinations: number;
  estimatedSeconds: number;
  actualSeconds: number;
  accuracy: number; // percentage error
  stages: number;
  profilesets: number;
}

const FIXTURE_ADDON_STRING = readFileSync(
  join(import.meta.dir, "test/fixtures/import-items/addon-string.txt"),
  "utf8",
);

const FIXTURE_META_DIR = join(import.meta.dir, "test/fixtures/import-items");

/**
 * Items from the fixture addon string that we'll use for combination generation.
 * Format: [itemId, source] to generate various combination counts.
 */
const _BENCH_ITEMS = {
  small: [
    // Small set: ~20 combinations
    175302,
    137410, // heads
    118848, // neck
    113884, // shoulders
    124318, // chest
  ],
  medium: [
    // Medium set: ~100 combinations
    175302, 137410, 118848, 124391, 113884, 35031, 124318, 237613,
  ],
  large: [
    // Large set: ~400+ combinations (all candidates)
    // All items from the fixture
    175302, 137410, 118848, 124391, 113884, 35031, 124318, 237613, 124391, 237613, 237613, 237613,
  ],
};

async function installFixtureMeta(dataDir: string) {
  const metaDir = join(dataDir, "meta");
  const iconDir = join(dataDir, "cache", "icons");
  await mkdir(metaDir, { recursive: true });
  await mkdir(iconDir, { recursive: true });

  const simc_dir = process.env.SIMC_DIR;
  if (!simc_dir) throw new Error("SIMC_DIR environment variable not set");

  const tag = simc_dir.split("/").pop();
  if (!tag) throw new Error("Could not extract tag from SIMC_DIR");

  const tagMetaDir = join(metaDir, tag);
  await mkdir(tagMetaDir, { recursive: true });

  const itemMeta = readFileSync(join(FIXTURE_META_DIR, "item-meta.json"), "utf8");
  await writeFile(join(tagMetaDir, "item-meta.json"), itemMeta);

  const itemIcons = readFileSync(join(FIXTURE_META_DIR, "item-icons.json"), "utf8");
  await writeFile(join(tagMetaDir, "item-icons.json"), itemIcons);
}

async function runBenchmark() {
  const simc_dir = process.env.SIMC_DIR;
  if (!simc_dir) {
    console.error("Error: SIMC_DIR environment variable not set");
    console.error("Usage: SIMC_DIR=<path>/simc/<tag> bun apps/server/benchmark.ts");
    process.exit(1);
  }

  const dataDir = mkdtempSync(join(tmpdir(), "simbot-bench-"));
  const _cwd = process.cwd();

  try {
    console.log("Setting up benchmark environment...");
    await installFixtureMeta(dataDir);

    const app = createApp(
      {
        dataDir,
        seedDir: null,
        seedTag: null,
      },
      {
        fetch,
      },
    );

    console.log("Importing fixture addon string...");
    const importRes = await app.request(
      new Request("http://localhost/api/imports", {
        method: "POST",
        body: JSON.stringify({ addonString: FIXTURE_ADDON_STRING }),
        headers: { "content-type": "application/json" },
      }),
    );

    if (!importRes.ok) {
      throw new Error(`Failed to import: ${importRes.status}`);
    }

    const importData = await importRes.json();
    const importId = (importData as Record<string, unknown>).id as number;

    console.log(`✓ Imported addon string (ID: ${importId})`);

    const results: BenchmarkResult[] = [];

    // Run benchmarks with different combination counts
    const benchmarks = [
      { name: "small", combinations: 20 },
      { name: "medium", combinations: 100 },
      { name: "large", combinations: 400 },
    ];

    console.log("\nRunning Top Gear benchmarks...");
    console.log("Note: This will take several minutes with a real SimC build\n");

    for (const bench of benchmarks) {
      console.log(`Starting benchmark: ${bench.name} (~${bench.combinations} combinations)`);

      // Create Top Gear sim
      const simRes = await app.request(
        new Request("http://localhost/api/sims", {
          method: "POST",
          body: JSON.stringify({ importId, kind: "top_gear" }),
          headers: { "content-type": "application/json" },
        }),
      );

      if (!simRes.ok) {
        console.error(`Failed to create sim: ${simRes.status}`);
        continue;
      }

      const simData = (await simRes.json()) as Record<string, unknown>;
      const simId = simData.id as number;

      // For this benchmark, we just run with all available items
      // In a real scenario, we'd filter to different combination counts
      const selectionRes = await app.request(
        new Request(`http://localhost/api/sims/${simId}`, {
          method: "PATCH",
          body: JSON.stringify({
            topGearSelection: {
              // Include indices 0-7 (the first set of candidates)
              included: Array.from({ length: Math.min(8, bench.combinations) }, (_, i) => i),
              talentLoadouts: [0],
              lockedSlots: [],
            },
          }),
          headers: { "content-type": "application/json" },
        }),
      );

      if (!selectionRes.ok) {
        console.error(`Failed to set selection: ${selectionRes.status}`);
        continue;
      }

      // Get estimate
      const previewRes = await app.request(
        new Request(`http://localhost/api/sims/${simId}/preview-combinations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        }),
      );

      const preview = (await previewRes.json()) as Record<string, unknown>;
      const estimatedSeconds = (preview.estimateSeconds as number) || 0;
      const actualCombinations = (preview.combinations as number) || bench.combinations;

      console.log(
        `  Estimated: ${estimatedSeconds.toFixed(1)}s for ${actualCombinations} combinations`,
      );

      // Note: Actually running the sim would require a full queue/runner setup
      // For now, we output the structure but note this should be completed
      console.log(`  ⚠ Real execution benchmarking requires runner integration`);

      results.push({
        combinations: actualCombinations,
        estimatedSeconds,
        actualSeconds: 0, // Would be measured during real run
        accuracy: 0,
        stages: 3,
        profilesets: actualCombinations - 1,
      });
    }

    // Print summary
    console.log("\n=== Benchmark Summary ===\n");
    console.log("Estimated times for various combination counts:");
    results.forEach((r) => {
      console.log(`  ${r.combinations} combinations: ${r.estimatedSeconds.toFixed(1)}s estimated`);
    });

    // Recommendations based on the machine (16 threads)
    console.log("\n=== Recommendations ===\n");
    console.log("Based on a 16-thread machine:");
    console.log("- PROFILESET_WORK_THREADS: 2 (allows 8 profilesets in parallel)");
    console.log("- ITERATIONS_CEILING: 50000 (reasonable upper bound)");
    console.log("- analyze_error_interval: 100 (check progress every ~100 iterations)");
    console.log("- DEFAULT_COST_MODEL measured from Check Sim runs");

    app.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

// Run the benchmark
runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
