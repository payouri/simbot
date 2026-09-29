Recorded from SimC `1210-2026-09-29-d08a1c3` (`simc <input> progressbar_type=1 output=/dev/null json2=<file>`).

- `addon-string.txt`: a Frost Death Knight Addon String built from the build's own `MID1_Death_Knight_Frost` profile, with the addon's header, a saved loadout and a bag item.
- `success/`: that string plus `fight_style=Patchwerk max_time=300 desired_targets=1 target_error=1.0`. Exit 0.
- `setup-failure/`: the same input plus `fight_style=NoSuchStyle`. SimC exits 70 with no json2.

Re-record when SimC's output format is in doubt: run the command above against a real build and copy `stdout`, `stderr`, the gzipped json2 and the exit code.
