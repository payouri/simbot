# Top Gear benchmark (#45, #58)

`bun run bench:top-gear` runs real gear sets through the Current SimC Build and writes every
measurement to `results/<timestamp>.json`. Read one back with
`bun run bench:top-gear --summarize <file>`. The options are at the top of `top-gear.ts`.

Needs an installed SimC Build in `SIMBOT_DATA_DIR` and an otherwise idle 16-thread machine.
Before any Sim it runs a Check Sim of each gear set (`checkSims` in the results file), and for
every Stage it records the error the profilesets reached (`maxErrorPercent`,
`medianErrorPercent`: `mean_error` in percent of the mean, the unit of `targetError`); the
summary gives each sweep point's final-Stage error.

Gear sets: `apps/server/test/fixtures/import-items/addon-string.txt` (Rootbeer, Frost Death
Knight) and `sets/gulthrak-fury.txt` (Gulthrak, Fury Warrior, a real export whose Adler-32
checksum `b6775177` matches its text). Add only real exports here, never an invented one.
Committed runs, all on an AMD Ryzen 7 7735HS (16 threads). `--caps` takes each set's first N
Candidate Items in Import order; the Frost set's case names are `addon-string/`, from its file name.

#45, SimC 1210-2026-09-29-d08a1c3, the Frost set only, `checkSim` null (that data dir never ran
one), no achieved error recorded:

- `2026-09-30T11-07-06-473Z.json`: threads 1, 2, 4, 8, 16; caps 4, 8, 12; 3 repeats.
- `2026-09-30T11-50-49-078Z.json`, `2026-09-30T12-33-34-232Z.json`: threads 1; intervals 400 to 5.
- `2026-09-30T12-44-04-817Z.json`: High precision, for the ceiling.
- `2026-09-30T12-47-17-748Z.json`: the then-settled defaults (interval 50), caps 4, 8, 12; 3 repeats.
- `2026-09-30T12-50-50-411Z.json`: the same defaults, caps 14, 16, 18 (2,916, 8,748 and 39,366
  Combinations), 1 repeat.
- `2026-09-30T13-53-13-088Z.json`: SimC's total `threads` swept, 16 (every logical thread, SimC's
  own default) against 8 (one per physical core); caps 12 and 16; 3 repeats; `--total-threads 16,8`.
  16 was faster at both caps, well beyond the run-to-run spread: cap 12 (972 Combinations) 43.8,
  46.1, 46.1s at 16 against 52.5, 52.3, 51.3s at 8 (median 13% slower); cap 16 (8,748) 335.4,
  343.9, 347.0s against 392.3, 392.6, 392.8s (median 14% slower). SMT helps SimC here, so the app
  leaves `threads` unset.

#58, SimC 1210-2026-09-30-613b5fb, with a Check Sim per set (`checkSims`) and achieved error:

- `2026-09-30T15-23-13-858Z.json`: both sets, caps 4, 8, 12, Medium, 3 repeats; threads 1, 2, 4,
  8, 16 at interval 50, and intervals 50, 25, 10, 5 at threads 1. Moved the interval to 5.
- `2026-09-30T16-58-33-758Z.json`: Low precision, both sets, caps 4, 8, 12, 16, 3 repeats
  (interval 50, before it moved).
- `2026-09-30T17-49-31-838Z.json`: High, Frost cap 18 (39,366 Combinations), 1 repeat: 1,330 s.
- `2026-09-30T18-11-43-303Z.json`: Fury caps 14, 16, 18 (5,833, 17,497, 38,881), Medium, 1 repeat.
- `2026-09-30T18-59-57-173Z.json`: today's defaults (interval 5), both sets, caps 4, 8, 12, threads
  1, 2, 4, 3 repeats: the threads re-sweep at the current interval.
- `2026-09-30T19-59-29-283Z.json`: as `17-49`, with a 600 s fight (`--duration 600`): 1,334 s.

What is still unmeasured:

- **A Sim over 30 minutes.** The longest was 1,334 s: 39,366 Combinations at High, the costliest
  preset, near the 50,000-Combination limit. A 600 s fight took as long as a 300 s one, since
  each iteration costs twice as much but half as many are needed. On this machine and these
  sets no Top Gear the app accepts seems to reach 30 minutes, so the soft warning's threshold is
  untested against a real run. A slower machine, or a costlier fight style or target count, might
  get there; none of those were run.
- A slower machine than this one. Only one machine has run any of it.

Where the estimate stands (every figure from `--summarize`, or `checkEstimates` over these files):

- On `DEFAULT_COST_MODEL` it is within 30% of all 41 Sims at today's defaults (threads 1, interval
  5, in `15-23`, `17-49`, `18-11`, `18-59` and `19-59`): 94% to 125% of measured, both sets, 9 to
  39,366 Combinations, Medium and High, 300 s and 600 s fights. At threads 2 and 4 it falls to
  57%. It runs low at Low: 61% to 65% on the 4-item Sims (1.4 s and 1.5 s against 2.3 s and
  2.4 s), 69% to 94% on the rest (`16-58`, interval 50).
- `learnt from others (worst)`, the model a preview uses once a Top Gear has finished, is within
  30% at today's defaults: 72% to 126% in `18-59`'s `profileset_work_threads=1` rows (across the
  two sets too; its threads 2 and 4 rows run 52% to 192%), 98% to 102% in `18-11`. It was not at interval 50: 139% to 152% in #45's files, and 64% to 166% at Low in
  `16-58`.
- `check sim`: 0.9x to 9.5x measured, within 30% in 6 of 227 Sims. A Check Sim's few hundred
  iterations take about 0.7 s, mostly SimC's start-up. The app no longer estimates from it.
- Fight length: until #58 the estimate scaled with fight length and put the 600 s Sim at 188%.
  `iterationsTimesErrorSq` is now per 60 s fight and scales down with longer fights; the two
  600 s and 300 s Sims learn 212 and 214. That fix rests on this one pair.

## Settling the defaults

1. Run it with your own Addon String export(s) (`--sets`) and `--repeats 3`.
2. Threading: take the `profileset_work_threads` sweep point with the lowest total wall time in
   the summary. Set `PROFILESET_WORK_THREADS` (`packages/simc/src/smart-sim.ts`) to it.
3. Ceiling: if any profileset ran at `iterationsCeiling`, the ceiling is binding and cuts
   precision; raise it. If none did, the ceiling is slack; set it above the largest
   `maxIterations` seen, with headroom.
4. Interval: set `ANALYZE_ERROR_INTERVAL` (`packages/simc/src/quick-sim.ts`) to the largest swept
   value that a smaller one does not clearly beat, judged against the spread between repeated
   runs of one value. A smaller interval lets SimC stop earlier; check the summary's final-Stage
   error stays at the target, so stopping earlier costs no accuracy.
5. Estimate: read the "Estimate against measured wall time" block. A preview shows the `default`
   estimate until a Top Gear has finished on the build, then one learnt from the last Top Gear, so
   the acceptance bar is every `default` and `learnt from others (worst)` cell within 30%. A
   `learnt from self` cell runs on the Sim's own cost model, so when it is out too the Cull shape
   is off: fit `ESTIMATE_CULLS` (`estimate.ts`) to the Stage profilesets counts in the results.
   When only `learnt from others` is out, the Cull shape is fine and the cost model does not carry
   from one gear set to another. Change `DEFAULT_COST_MODEL` only to a `learnt from self` model the summary prints,
   and quote it.
6. Record: in the doc comment of each constant you change, cite the results file by name and the
   numbers it gave, and drop its "Unmeasured" wording. Change nothing the file does not show.
   Keep the `AGENTS.md` gotcha about these constants in step with what the results files hold.
