# Top Gear benchmark (#45)

`bun run bench:top-gear` runs real gear sets through the Current SimC Build and writes every
measurement to `results/<timestamp>.json`. Read one back with
`bun run bench:top-gear --summarize <file>`. The options are at the top of `top-gear.ts`.

Needs an installed SimC Build in `SIMBOT_DATA_DIR` and an otherwise idle 16-thread machine.
Committed runs (all SimC 1210-2026-09-29-d08a1c3, AMD Ryzen 7 7735HS, the `import-items` fixture's
Addon String passed as `--sets apps/server/test/fixtures/import-items/addon-string.txt`, hence the
`addon-string/` case names, `--caps` taking its first N Candidate Items in Import order):

- `2026-09-30T11-07-06-473Z.json`: threads 1, 2, 4, 8, 16; caps 4, 8, 12; 3 repeats.
- `2026-09-30T11-50-49-078Z.json`, `2026-09-30T12-33-34-232Z.json`: threads 1; intervals 400 to 5.
- `2026-09-30T12-44-04-817Z.json`: High precision, for the ceiling.
- `2026-09-30T12-47-17-748Z.json`: the settled defaults, caps 4, 8, 12; 3 repeats.
- `2026-09-30T12-50-50-411Z.json`: the settled defaults, caps 14, 16, 18 (2,916, 8,748 and 39,366
  Combinations), 1 repeat. Not used to fit anything, but it ran before `DEFAULT_COST_MODEL` was
  set (its `previewEstimateSeconds` come from an earlier model), so it is not a blind test.
- `2026-09-30T13-53-13-088Z.json`: the settled defaults with SimC's total `threads` swept, 16 (every
  logical thread, SimC's own default) against 8 (one per physical core); caps 12 and 16; 3 repeats.
  The only file run with the current defaults already in place (its previews equal today's estimate).
  Run with `--total-threads 16,8`. 16 was faster at both caps, well beyond the run-to-run spread:
  cap 12 (972 Combinations) 43.8, 46.1, 46.1s at 16 against 52.5, 52.3, 51.3s at 8 (8 is 11% to 20%
  slower, median 13%); cap 16 (8,748) 335.4, 343.9, 347.0s at 16 against 392.3, 392.6, 392.8s at 8
  (13% to 17% slower, median 14%). SMT helps SimC here, so the app leaves `threads` unset. One
  machine, one gear set.

Their `checkSim` is null: the seed data dir never ran a Check Sim, so the `check sim` estimate
basis has not been measured. Only one gear set exists in the repo, so the Cull shape and cost model
are fitted to it; run the benchmark with your own exports before trusting them for another.

Where the estimate stands (every figure from `--summarize` on these files):

- On `DEFAULT_COST_MODEL` it is within 30% of every case: 86% to 115% of measured on the file it
  was fitted from, 78% to 80% on caps 14 to 18, 72% to 94% on the threads file. It runs low at
  large sizes, so a Sim a little over 30 minutes can show no soft warning; no Sim that long has run.
- `learnt from others (worst)`, the model a preview uses after a Top Gear, is outside 30% when a
  small case learns from a large one: 139% to 143% at cap 4 in `2026-09-30T12-47-17-748Z.json`, 152%
  at High. Step 5's bar below is therefore not met yet. The 1% Stage runs to the error-check
  interval, not to 1/error², and one `iterationsTimesErrorSq` cannot follow both.

## Settling the defaults

1. Run it with your own Addon String export(s) (`--sets`) and `--repeats 3`.
2. Threading: take the `profileset_work_threads` sweep point with the lowest total wall time in
   the summary. Set `PROFILESET_WORK_THREADS` (`packages/simc/src/smart-sim.ts`) to it.
3. Ceiling: if any profileset ran at `iterationsCeiling`, the ceiling is binding and cuts
   precision; raise it. If none did, the ceiling is slack; set it above the largest
   `maxIterations` seen, with headroom.
4. Interval: set `ANALYZE_ERROR_INTERVAL` (`packages/simc/src/quick-sim.ts`) to the largest swept
   value that a smaller one does not clearly beat, judged against the spread between repeated
   runs of one value. A smaller interval lets SimC stop earlier,
   and the benchmark records no achieved error, so it cannot show what that costs in accuracy.
5. Estimate: read the "Estimate against measured wall time" block. A preview shows the `check sim`
   estimate until a Top Gear has finished on the build, then one learnt from the last Top Gear, so
   the acceptance bar is every `check sim` and `learnt from others (worst)` cell within 30%. A
   `learnt from self` cell runs on the Sim's own cost model, so when it is out too the Cull shape
   is off: fit `ESTIMATE_CULLS` (`estimate.ts`) to the Stage profilesets counts in the results.
   When only `learnt from others` is out, the Cull shape is fine and the cost model does not carry
   from one gear set to another. Change `DEFAULT_COST_MODEL` only to a `learnt from self` model the summary prints,
   and quote it.
6. Record: in the doc comment of each constant you change, cite the results file by name and the
   numbers it gave, and drop its "Unmeasured" wording. Change nothing the file does not show.
   Keep the `AGENTS.md` gotcha about these constants in step with what the results files hold.
