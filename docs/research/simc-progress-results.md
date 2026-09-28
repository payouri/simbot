# How do we read SimC progress and results?

Research for issue #6. Answers three questions: how SimC reports progress while it runs (so we can stream it over SSE), what the JSON report contains for one actor and for profilesets, and how SimC behaves when it is cancelled or fails.

## Sources and method

- **SimC source**, `simulationcraft/simc` branch `midnight`, commit [`4c7c736`](https://github.com/simulationcraft/simc/tree/4c7c73621e596419b5bd6faa5d68940a9c640379) (2026-09-27), reporting as `SimulationCraft 1210-01 for World of Warcraft 12.1.0.69933 Live`. All links below point at that commit.
- **SimC wiki**, [ProfileSet](https://github.com/simulationcraft/simc/wiki/ProfileSet), [Output](https://github.com/simulationcraft/simc/wiki/Output) (it includes the exit-code table) and [StatisticalBehaviour](https://github.com/simulationcraft/simc/wiki/StatisticalBehaviour).
- **Experiments.** I built the CLI from that commit on Linux (`make optimized`). I ran `profiles/MID2/MID2_Death_Knight_Frost.simc` alone and with 5 profilesets (race swaps), in sequential and parallel modes. I sent it SIGINT, SIGTERM and SIGKILL, and fed it bad input. Lines marked **(observed)** come from these runs.

Where the wiki and the source disagree, the source wins. That happens twice (JSON option naming, and `progressbar_type` is missing from the wiki).

---

## 1. Progress reporting

### Where it goes

- Progress goes to **stdout** (`std::cout << ... << std::flush`) from the main sim thread only. Worker threads have `report_progress = 0`. See [`progress_bar.cpp#L325-L369`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp#L325-L369) and [`sim.cpp#L3436`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/sim.cpp#L3436).
- Warnings and errors go to **stderr** as `"<Level>: <message>\n"`, flushed ([`sim.cpp#L3251-L3261`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/sim.cpp#L3251-L3261)). Fatal errors print `Error: <chain>` to stderr ([`sc_main.cpp#L379-L392`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sc_main.cpp#L379-L392)).
- Stdout also carries other text: a version banner, `Simulating... ( iterations=…, threads=…, target_error=… )`, `Merging data from thread-N ...`, `Analyzing actor data ...`, `Generating reports...`, report timings, and by default the **whole text report**. Pass `output=/dev/null` (or a file) to move the text report off stdout ([`sim.cpp#L3872`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/sim.cpp#L3872)) **(observed)**.
- Each update is flushed on its own, so stdout can be read as a live stream through a pipe with no pty **(observed)**.

### Two formats, chosen by `progressbar_type` (0 or 1; `opt_bool`, [`sim.cpp#L3815`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/sim.cpp#L3815))

The wiki does not document this option. The logic is in [`progress_bar.cpp`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp).

**`progressbar_type=0` (default).** Human-readable, space-delimited. In-flight updates end with **`\r`**. A phase's final line ends with **`\n`** ([L332-L333](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp#L332-L333)).

```
Generating Baseline: 1/6 [=>..................] 247/3000 49.158 14sec
Generating Profileset: Night Elf 3/6 [===================>] 206/206 32.106 Mean=259041 Error=0.406% 1.604 (6s)
```

The fields are: `Generating <base>:`, then ` <phase>` if there is one, then `<phase_idx>/<total_phases>`, the bar, `<iter>/<total_iter>`, iterations/sec per thread, then ` Mean=… Error=…%` only when `target_error>0`, then remaining time as `Nmin Nsec`, then ` (<time left for all phases>)`. The colon after the base was added "for easier parsing" ([L341-L345](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp#L341-L345)). A profileset name can contain spaces, which makes this format awkward to parse.

**`progressbar_type=1`.** Machine-oriented, **tab-delimited, one line per update, always `\n`**. **Use this one.**

```
Baseline	1	6	52	500	14.413	7.771
Profileset	Gnome	2	6	61	500	20.657	5.313	23s
Baseline	1	1	400	3451	149.285	261243.629	0.338	5.109
```

| # | Field | Notes |
|---|-------|-------|
| 1 | base | `Baseline`, `Profileset`, or a scale-factor or plot label ([`sc_main.cpp#L357`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sc_main.cpp#L357), [`profileset.cpp#L123-L124`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/profileset.cpp#L123-L124)) |
| 2 | phase | Only if set. It holds the **profileset name**, or the actor name under `single_actor_batch`. **Missing for Baseline**, so the column count varies. Tell the cases apart by field 1 |
| next | phase index | 1-based ([`current_progress()`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp#L439-L447)) |
| next | total phases | baseline + profilesets (+ scaling or plot phases), from [`compute_total_phases()`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp#L388-L426). **It grows during the baseline** while profilesets are still being parsed on a background thread: we saw `1/2`, `1/3`, `1/6` **(observed)**. Treat it as final only once field 1 is `Profileset` |
| next | current iterations | For this phase |
| next | total iterations | In fixed-`iterations` mode this is the target. In `target_error` mode it is a **moving estimate** (3451, 3653, 3726, … in our run) **(observed)** |
| next | iterations/sec/thread | |
| next (target_error only) | current mean | Of the metric (DPS) |
| next (target_error only) | current error | **Percent** (0.338 means 0.338 %) |
| next | seconds left in this phase | 3 decimals. On the final line this is the elapsed time instead ([L185-L201](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp#L185-L201)) |
| last (optional) | time left for all phases | Formatted like `23s` or `1m, 4s`. Only once the total is known and the line is not the final one ([L203-L215](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp#L203-L215)) |

### Update cadence

- Fixed iterations: about **every 1 % of the work queue** (`interval = work_queue size / 100`, [L76-L96](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp#L76-L96)). The code also has a 1-second max-interval check, but it computes `last_update - now` (a negative duration), so the check is always true and only the iteration interval applies ([L130-L140](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/progress_bar.cpp#L130-L140)).
- `target_error` mode: every `analyze_error_interval` iterations (default **100**, [`sim.cpp#L1402`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/sim.cpp#L1402)). Nothing is printed before the first 100 iterations. A fast sim can therefore show only its final line: a 0.5 % target error run gave just one line **(observed)**.
- Each phase ends with a "finished" line. The next phase then starts from iteration 0 ([`sim.cpp#L3186-L3207`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/sim.cpp#L3186-L3207)).

### Profilesets: sequential vs parallel

- **Sequential** (default). Each profileset is a child sim that prints normal progress lines with base `Profileset` and phase = the profileset name ([`profileset.cpp#L108-L125`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/profileset.cpp#L108-L125)). This gives per-profileset **and** per-iteration progress.
- **Parallel** (`profileset_work_threads=N`, which gives `floor(threads/N)` workers; [wiki](https://github.com/simulationcraft/simc/wiki/ProfileSet#parallel-processing-for-profilesets), [`profileset.cpp#L667-L680`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/profileset.cpp#L667-L680)). Per-iteration progress is turned off (`report_progress = false`). Instead, one aggregate line is printed each time a worker starts or finishes. The line is **always `\r`-terminated and does not change with `progressbar_type`** ([`profileset.cpp#L829-L884`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/profileset.cpp#L829-L884)):
  ```
  Profilesets (2*2): 3/5 [===========>........] avg=1.42s done=4s left=3s
  ```
  The format is `Profilesets (<workers>*<threads per worker>): <done>/<total> [bar] avg=… done=… left=…`. `done` is approximate: it read `1/5` before anything had finished **(observed)**. The baseline still uses the normal progress lines.
- The **order profilesets run in is not the input order**. `profileset_map` is a `std::unordered_map` ([`option.hpp#L63`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/option.hpp#L63)), and the wiki calls it "an (unordered) sequence". Our input Orc, Troll, Dwarf, Night Elf, Gnome ran as Gnome, Night Elf, Dwarf, Troll, Orc **(observed)**. Key everything by profileset name.

### SSE parsing recipe

Use `progressbar_type=1 output=/dev/null json2=<file>`. Split stdout on `/\r|\n/`. Then:

- A line that starts with `Baseline\t` or `Profileset\t` is a progress event. Parse it by field 1 as in the table above.
- A line matching `^Profilesets \((\d+)\*(\d+)\): (\d+)/(\d+)` is a parallel-mode aggregate.
- Ignore everything else, or pass it through as a log.

Read stderr separately for warnings and the fatal `Error:` line.

---

## 2. JSON output

### Options and versions (the wiki is out of date here)

- The wiki marks `json=` as deprecated and says to use `json2=`. The **source says otherwise**. `json=<file>[,version=X][,pretty_print=1][,full_states=1][,decimal_places=N]` is the versioned option. `json2=<file>` is now just an alias for `json=<file>,version=2` ([`sim.cpp#L139-L224`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/sim.cpp#L139-L224)).
- Valid versions are `3.0.0-alpha1` and `2.0.0`. Plain `json=` defaults to `3.0.0-alpha1` ([`report_configuration.cpp#L33-L36`, `#L80-L84`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/report_configuration.cpp#L33-L84)). Version 3 is marked "Unreleased" ([`Changelog.md`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/Changelog.md)). Its only structural change is that each profileset's metrics become one `metrics[]` array.
- **Gotcha (observed):** the v3 features are gated on `version_intersects(">=3.0.0")`. The default `3.0.0-alpha1` is a semver prerelease and **does not match**. So plain `json=` currently writes the v2 profileset layout, with no `$id`, while `report_version` says `3.0.0-alpha1` ([`report_json.cpp#L1097-L1108`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/report_json.cpp#L1097-L1108)). **Pin `json2=`** (or `version=2.0.0`) so the shape we parse is stable. Watch this when we track SimC updates.
- If the JSON file can't be opened, SimC only logs an error and **exits 0** ([`report_json.cpp#L1435-L1445`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/report_json.cpp#L1435-L1441)). Always check that the file exists and parses.

### Top-level shape

The root is written by [`print_json_pretty`, `report_json.cpp#L1375-L1426`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/report_json.cpp#L1375-L1426) and [`to_json(sim)`, `#L1171-L1344`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/report_json.cpp#L1171-L1344):

```
{ version, report_version, ptr_enabled, beta_enabled, build_date, build_time, timestamp,
  git_revision, git_branch, [no_networking],
  sim: { options{…, iterations, target_error, threads, confidence, confidence_estimator, fight_style, …},
         overrides, players[], [profilesets], [dps_plot], [reforge_plot],
         statistics{elapsed_cpu_seconds, elapsed_time_seconds, init_time_seconds, merge_time_seconds,
                    analyze_time_seconds, simulation_length{…}, total_events_processed, raid_dps{…}, total_dmg{…}},
         [targets, raid_events, sim_auras, iteration_data]   // only when report_details=1 (default)
  },
  [logs: [{level, message}]]   // every warning/error SimC raised, e.g. "implementation_not_yet_verified"
}
```

`git_revision` and `version` identify which SimC build produced a result, which is useful for SimC Update tracking.

### Single actor (Quick Sim)

`sim.players[0]` has `name, race, level, role, specialization, talents, …, gear, collected_data, buffs, procs, gains, stats[] (per-ability), stats_pets` ([`report_json.cpp#L748-L870`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/report_json.cpp#L748-L870)).

DPS is **`sim.players[0].collected_data.dps`**, an `extended_sample_data` object ([`sc_js.cpp#L237-L255`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/interfaces/sc_js.cpp#L237-L255)):

```json
"dps": { "sum": 521531911.19, "count": 1999, "mean": 260896.40, "min": 235732.62, "max": 292475.68,
         "median": 261018.53, "variance": 65386851.86, "std_dev": 8086.21,
         "mean_variance": 32709.78, "mean_std_dev": 180.86 }
```

- **There is no `mean_error` for the player. Compute it** as `mean_std_dev * sim.options.confidence_estimator` (1.95996 at the default 95 % confidence). That is how SimC computes the profileset `mean_error` ([`report_json.cpp#L1004`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/report_json.cpp#L1004)). Divide by `mean` to get the "Error %" figure. For our run: 180.86 × 1.96 = ±354 DPS, or 0.14 %.
- **There is no DPS distribution histogram in JSON.** We get only summary stats: min, max, median, std_dev, and for profilesets also quartiles. The HTML report builds its distribution chart itself. To draw a histogram we would need per-iteration data, which JSON doesn't have, or we fake a normal curve from mean and std_dev. `iteration_data.low/high` holds only a few extreme iterations (seeds for reproducing them), and only when that collection is enabled.
- The iteration count is `collected_data.dps.count` (also `collected_data.total_iterations`). With `iterations=2000` it said 1999 **(observed)**. Don't assume it equals the requested count.
- Also present: `collected_data.dpse`, `timeline_dmg{mean, mean_std_dev, min, max, data[]}` (a DPS-over-time series), `fight_length`, per-ability `stats[]`, and `buffs[]`.

### Profilesets (Top Gear)

`sim.profilesets` is written by [`profileset_json2`, `report_json.cpp#L981-L1049`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/report_json.cpp#L981-L1049). It holds `metric` (the metric's long name, e.g. `"Damage per Second"`) and `results[]`:

```json
{ "name": "Gnome", "mean": 259106.13, "min": 236678.77, "max": 285065.14,
  "stddev": 9040.19, "mean_stddev": 626.82, "mean_error": 1228.55,
  "median": 259803.45, "first_quartile": 251640.00, "third_quartile": 265623.48,
  "iterations": 208,
  "additional_metrics": [ { "metric": "Damage Taken per Second", "mean": …, … } ],   // if profileset_metric lists >1
  "overrides": { "race": "gnome", "talents": "…", "gear": {…}, "stats": {…} } }      // if profileset_output_data set
```

- `mean_error` here is already `mean_stddev * confidence_estimator`, in absolute DPS.
- **A profileset whose `mean == 0` is left out entirely.** That covers profilesets that were cancelled, never ran, or produced no result ([L991-L994](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/report/json/report_json.cpp#L991-L994)). Compare against the list we submitted. A missing name means "no result".
- The **results array is in run order**, which is unordered as noted above. It is **not sorted**. We sort it ourselves. The text report ranks by median; Raidbots-style ranking uses mean.
- The **baseline is not in `results`**. It is `sim.players[0].collected_data.dps`. For Top Gear the equipped set is the baseline, and each candidate combo is a profileset.
- `profileset_output_data=race,gear,talents,stats` ([`profileset.cpp#L1043-L1110`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/profileset.cpp#L1043-L1110)). `gear` lists only slots whose item id differs from the baseline, as `{slot: {item_id, item_level}}`. **Bug (observed):** if `race` or `talents` is requested but `stats` is not, `overrides.stats` still appears, filled with uninitialised garbage (for example `agility: 1.7e+161`). Either request `stats` too or ignore `overrides.stats`. Better still, we already know what each profileset contains because we generated it, so we map by name and skip `overrides`.
- Profileset child sims run with `report_details=0` and a fresh `seed=0` ([`profileset.cpp#L108-L113`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/profileset.cpp#L108-L113), wiki). Per-ability breakdowns for profilesets are not available.
- JSON is written **once, at the very end**. There are no partial results mid-run from JSON. Per-profileset results can be streamed only from the progress lines: in `target_error` mode the finished line carries `Mean=`/`Error=`.

---

## 3. Cancellation and failure

### Signals ([`sc_main.cpp#L33-L134`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sc_main.cpp#L33-L134))

SimC installs handlers **only for SIGINT and SIGSEGV** (POSIX builds). On SIGINT it prints `sim_signal_handler: Interrupt! Iteration=… Seed=… TargetHealth=…` to stderr, followed by ` ProfileSet=<name>` if a profileset is running. What happens next depends on the run:

| Situation | Handler action | What we saw |
|-----------|----------------|-------------|
| Plain single actor (Quick Sim) | `interrupt()` flushes the work queue, and the sim **finishes normally** with the iterations done so far | **Exit 0**. Full reports, JSON included, from the partial run (344 of 100000 iterations). Only the stderr line and the low `dps.count` show it was interrupted **(observed)** |
| Profilesets present, scale factors, plots, or `single_actor_batch` | `cancel()` sets `canceled`, flushes queues, and cancels profilesets | **Exit 1**. The stderr line plus `Trivial: Simulation has been canceled after N iterations!`. **Reports are still written**: the `canceled` short-circuit in [`sc_main.cpp#L359-L377`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sc_main.cpp#L359-L377) falls through to `print_suite`. The JSON has the partial baseline and **only the profilesets that finished**. The one in progress and the ones not started are left out. Same in parallel mode **(observed)** |
| SIGINT twice | The second one arrives after the handler has already run. No harm | Same as a single SIGINT **(observed)** |
| SIGTERM | No handler, so the default action applies | Killed at once, **exit 143**, no report or JSON **(observed)** |
| SIGKILL | | **Exit 137**, nothing written **(observed)** |

Implications for the backend:

- **Cancel = SIGTERM, then SIGKILL after a grace period.** Delete or ignore the output. Treat a user cancel as "no result". Don't send SIGINT unless we want partial results, because SIGINT on a Quick Sim exits 0 and looks like success.
- If we ever want "stop early, keep what you have" (for example Top Gear partial results), SIGINT gives us that. Detect it by exit code 1 plus the results missing from `profilesets.results`.
- Exit code alone is not proof of success. Success means exit 0, the JSON exists and parses, and the iteration count is plausible.

### Failures and exit codes

Exit codes come from [`util.hpp#L29-L73`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/util/util.hpp#L29-L73) and the [wiki Output#Exit Codes](https://github.com/simulationcraft/simc/wiki/Output#exit-codes). The deepest `sc_exception` in the chain sets the code ([`util.cpp#L3422-L3445`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/util/util.cpp#L3422-L3445)).

| Code | Meaning |
|------|---------|
| 0 | Success. Also returned for a SIGINT-interrupted Quick Sim and for a JSON file that couldn't be opened |
| 1 | Other exception, or **cancelled** |
| 30 | Invalid APL argument |
| 40 | Initialization error |
| 50 / 51 | Runtime error during iteration / simulation stuck |
| 60 / 61 | Network/file error / report output error |
| 70 / 71 / 72 | Invalid sim option / fight style / unsupported spec |
| 80 / 81 / 82 | Invalid player option / talent string / item string |

Behaviour we saw:

- A bad baseline talent string gives **exit 81**, no JSON, and on stderr `Error: Initialization error: Player 'X': Hash 'GARBAGE': Not enough characters.` **(observed)**
- A bad option inside one profileset **aborts the whole run**: **exit 80**, no JSON, `Error: Profileset 'Bad': Player 'X': Unknown race 'martian'.` Profileset options are validated on a background thread while the baseline runs ([`profileset.cpp#L542-L636`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sim/profileset.cpp#L542-L636)), so this can happen partway through the baseline **(observed)**. One broken Top Gear combo kills every combo, so we must generate valid input.
- An **unknown option does not fail**. It prints `Trivial: Warning: Unknown option 'x' with value '1', ignoring` to stderr and exits 0 **(observed)**. Don't rely on SimC to reject typos in what we generate.
- stderr also carries harmless warnings such as `Implementation Not Yet Verified: …`. They repeat once per profileset child sim, and each sim's warnings also land in `logs[]` in the JSON. **Non-empty stderr is not failure.** Only the `Error:` prefix combined with a non-zero exit is.
- SIGSEGV: the handler prints thread, iteration and seed to stderr, then `exit(SIGSEGV)`, which gives **exit 11** and no report ([`sc_main.cpp#L108-L115`](https://github.com/simulationcraft/simc/blob/4c7c73621e596419b5bd6faa5d68940a9c640379/engine/sc_main.cpp#L108-L115)).

---

## Recommended invocation

```
simc <input.simc> progressbar_type=1 output=/dev/null json2=<job-dir>/result.json [threads=N] [target_error=… | iterations=…]
```

- Stream stdout split on `\r|\n`, parse tab-delimited `Baseline`/`Profileset` lines and `Profilesets (` lines, and turn them into SSE progress events.
- Keep stderr as a job log. On a non-zero exit, show the last `Error:` line.
- On exit 0, read `result.json`. Quick Sim DPS is `sim.players[0].collected_data.dps.{mean, mean_std_dev}` × `sim.options.confidence_estimator`. Top Gear is `sim.profilesets.results[]` keyed by name, plus the baseline. Sort them ourselves and treat a missing name as no result.
- Cancel with SIGTERM, then SIGKILL.
