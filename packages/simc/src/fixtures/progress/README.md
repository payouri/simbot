Stdout transcripts for the progress parser.

- `quick-sim-recorded.txt`: recorded from SimC `1210-2026-09-29-d08a1c3` (a Quick Sim, `progressbar_type=1`).
- `parallel-profilesets.txt`: recorded from the same build (Stage 1 of a Top Gear over 27 Combinations, `profileset_work_threads=2`; `\r`-terminated aggregate lines, durations such as `371.074ms`). The rest of that run (stderr, json2, input) is in `../top-gear/`. Re-record it with `apps/server/test/smart-sim.simc.test.ts`'s scenario when SimC's output changes.
- The others are written from the formats and observed lines in `docs/research/simc-progress-results.md` (research for #6): target-error baseline and sequential profilesets (names with spaces, `1m, 4s` durations). The app always runs profilesets in parallel, so the sequential form has not been recorded and stays hand-written.
