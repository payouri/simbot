Recorded from SimC `1210-2026-09-29-d08a1c3` for the packed item pass (`item_db_source=local`,
`iterations=1`, `output=/dev/null json2=<file>`).

- `addon-string.txt`: the Quick Sim fixture's Frost Death Knight with a wide set of Candidate Items
  (two per slot, three rings and trinkets, the ring and trinket already equipped, 2h and 1h
  weapons, a shield, a staff, Great Vault items) plus two Unknown Items: `id=999999`, and a known
  legs item with the unknown `bonus_id=999998`.
- `item-meta.json`, `item-icons.json`: the real files of that build, trimmed to the ids used above.
- `success/`: the whole pass. `input.simc` is what the pass renders for the Addon String against
  the trimmed meta; the server test asserts the launched input equals it, so the recorded
  `json2.json.gz` can never drift from the code. Exit 0.
- `init-error/`: SimC's exit 80 when an actor holds a 2h in both hands (`Player 'o0'`); the
  server drops the actor and runs again.
- `dropped-actor/`: the pass without actor `o0`, i.e. the run after that retry.

Re-record with `SIMC_DIR=<data>/simc/<tag> bun apps/server/test/fixtures/import-items/record.ts
<scenario>` (`EXCLUDE=o0` for `dropped-actor/`), after installing the trimmed meta or regenerating
it from the build's item-meta.

## ilvl accuracy check

`wowhead-ilvl.json` holds the Item Level Wowhead's tooltip service shows for every item of the
Addon String that SimC read (49 items, equipped and Candidate, fetched 2026-09-30). Wowhead
computes it from the same item-bonus tables as the game client. The packed pass matched all 49
(0 mismatches) and `import-items.test.ts` re-asserts that offline. The game client itself was not
available to compare against, so "in-game" here means "as Wowhead displays it". Items an unknown
bonus id would have made wrong (`bonus_id=999998`) are the reason unknown ids are never sent:
SimC ignores that bonus and would report the base ilvl instead.
