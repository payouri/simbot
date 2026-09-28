# Resolving candidate item data before any sim runs

Resolves issue #11. Researched 2026-09-28 against SimC `midnight` @ `4c7c736` (WoW Live data 12.1.0.69933). Builds on [item-display-data.md](https://github.com/payouri/simbot/blob/research/item-display-data/docs/research/item-display-data.md) (#4), [addon-string.md](https://github.com/payouri/simbot/blob/research/addon-string/docs/research/addon-string.md) (#5), [top-gear-combinations.md](https://github.com/payouri/simbot/blob/research/top-gear-combinations/docs/research/top-gear-combinations.md) (#3), [simc-linux-docker.md](https://github.com/payouri/simbot/blob/research/simc-linux-docker/docs/research/simc-linux-docker.md) (#2) and [item-icon-mapping.md](https://github.com/payouri/simbot/blob/research/item-icon-mapping/docs/research/item-icon-mapping.md) (#12).

**Question.** Before the user clicks Run, the item picker needs ilvl, stats, name and quality for every candidate item in the **Addon String**. Top Gear pruning also needs unique-equipped, ItemLimitCategory (category + quantity), item set id, weapon hand type and the on-use trinket flag, and the icon map wants the resolved appearance. Which approach gives us this: (a) a cheap SimC pass, (b) SimC's generated data plus a TS port of its bonus-id logic, or (c) a small C++ helper on SimC's dbc code?

Items marked **(measured)** were run on this machine: 16 threads, plain GCC `-O3` release build of `4c7c736`. The official PGO Docker binary is about 27% faster (see #2), so treat these timings as upper bounds. The throwaway scripts named below (`bench.py`, `verify.py`, `extract-meta.mjs`, `itemdump.cpp`) were scratch prototypes and are not committed.

## TL;DR

- **Use two sources.** Numbers (ilvl, stats) come from one cheap SimC pass at import time. Static fields come from a small `item-meta.json` that we extract at build time, in the **SimC Update** step, from SimC's own generated tables plus two DB2 tables.
- **The SimC pass.** Pack the candidates into as few `copy=` actors as possible (one candidate per slot per actor) and run `iterations=1 max_time=1 json2=`. It takes **0.17 s for 30-60 candidates and 0.48 s for 182 (measured)**, with ilvl and per-item stats identical to one actor per candidate. It needs no code changes after a SimC Update.
- **Don't build the pass on `profileset_output_data=gear`.** It reports only `item_id` and `item_level`. It omits any candidate whose item id matches the equipped one (32 of 182 here). And it reads uninitialized memory, which breaks the JSON report while SimC still exits 0 (details below).
- **Static fields are plain lookups, with no math.** Name, quality, inventory type (hence hand type), item set id, the unique-equipped flag, the on-use flag, the appearance modifier and the bonus-granted limit category are all in SimC's generated `.inc` files. **Two things SimC does not have:** an item's *base* `ItemSparse.LimitCategory` (for example "Void-Touched" weapons, Gladiator's Medallions, Darkmoon Decks) and the `ItemLimitCategory` quantity table. Both come from DB2 through the same wago.tools pipeline as the icon map (#12).
- **Don't do (b) or (c).** A TS port of the bonus and scaling math would chase 27 logic commits a year in `sc_item_data.cpp` and `item.cpp`. The C++ helper works (prototype below) but is no faster (init dominates), and it forces a source build, which gives up the official Docker image recommended in #2.
- **Resolved appearance id: yes.** Bonus type 7 rows are in SimC's `item_bonus.inc`, and the rule is "lowest `value_2` wins". That gives the `(itemId, appearanceModId)` key #12 needs.

## Test input

I built an Addon String in the exact `GetSimcProfile` shape from #5 (header, character block, equipped lines, `### Gear from Bags`, `### Weekly Reward Choices`, checksum line). The items are real current ones, not invented ids. The equipped set is SimC's `profiles/MID2/MID2_Warrior_Fury.simc` gear, rewritten into addon form (`slot=,id=...,bonus_id=...`, no name token, no `ilevel=`). The candidates are every distinct plate/weapon line from the MID2 Warrior, Paladin and DK profiles, plus every neck, back, ring and trinket line from all MID1 and MID2 profiles. I kept only lines that carry `bonus_id` and have no `ilevel=`, `enchant=` or `embellishment=` override, because the addon never writes those. Like the addon, it folds `finger2`→`finger1` and `trinket2`→`trinket1`.

That gives **182 candidates**. They include tier pieces (set 2067), Myth-track bonus 12854, crafted embellished items (bonus 8960, `crafting_quality` bonus 12497), `redirected_base_stats`, `content_tuning`, 2H weapons, and on-use and unique trinkets. Real exports usually have 30-60 candidates. 182 is a heavy "full bags + bank + warband bank" case.

## (a) A cheap SimC pass

### What `json2` exposes per item

`gear_to_json` writes, for every active slot of every actor, `name` (the **tokenized** name, e.g. `voracious_heart_of_ulatek`), `encoded_item`, `ilevel`, and every non-zero item stat ([`engine/report/json/report_json.cpp` L382-406](https://github.com/simulationcraft/simc/blob/4c7c736/engine/report/json/report_json.cpp#L382-L406)). The stats are the item's own stats; gems and enchants are not included. Primary stats come out combined (`strint`, `stragi`, `agiint`), so the UI must map them to the spec's primary stat. **It does not expose** quality, display name, set id, unique flag, inventory type or hand type, on-use, limit category or appearance.

### Three ways to get every candidate into a report (measured)

| Candidates | One `profileset` per candidate, `profileset_output_data=gear/stats` | One `copy=` actor per candidate | **Packed `copy=` actors (≤ 1 candidate per slot per actor)** |
|---|---|---|---|
| 0 (equipped only) | 0.10-0.13 s | same | same |
| 30 | 0.56 s | 0.54 s | **0.17 s** (6 actors) |
| 60 | 0.65-0.97 s | 0.77-0.93 s | **0.17-0.25 s** (7 actors) |
| 182 | 1.83-2.10 s | 2.25 s | **0.48 s** (34 actors) |
| Per-item output | `item_id`, `item_level` only | name token, ilvl, stats | name token, ilvl, stats |

- All runs used `iterations=1 max_time=1 vary_combat_length=0 report_details=0 threads=16`. The SimC stats line shows almost all of the wall time is init (`InitSeconds 1.94` of `WallSeconds 2.17` for 198 profilesets). The combat itself is negligible.
- `threads=1` gives the same 0.49 s for the packed case, so init is effectively serial.
- **Packed vs one actor per candidate:** all 182 `encoded_item` strings were found, and every field was identical (`verify.py`, 0 mismatches). Packing is safe because each item resolves independently of what sits in the other slots.
- Rings and trinkets drive the actor count because there are only two slots of each per actor. 34 actors for 182 candidates is mostly rings and trinkets.

The packed input the app would generate looks like this:

```
<live lines of the Addon String: class line, level, race, spec, talents, equipped slots>
copy=p0,Thrallina
head=,id=271474,bonus_id=4786/12854/13692/13698/13750,gem_id=240983,redirected_base_stats=251126
finger1=,id=268266,bonus_id=12854/13335/13668,...
finger2=,id=268252,bonus_id=12854/13750,...
trinket1=,...
copy=p1,Thrallina
...
```

Run it with `simc in.simc json2=out.json iterations=1 max_time=1 report_details=0 item_db_source=local`, then index `sim.players[*].gear[*]` by `encoded_item` (drop the name token first).

### Pitfalls found

1. **`profileset_output_data=gear` reads uninitialized memory.** `profile_output_data_t` leaves its twenty `double` stat members uninitialized. Only `m_race` is initialized ([`engine/sim/profileset.hpp` L222-252](https://github.com/simulationcraft/simc/blob/4c7c736/engine/sim/profileset.hpp#L222-L252)). `save_output_data` fills them only for the `stats` option ([`profileset.cpp` L1043-1127](https://github.com/simulationcraft/simc/blob/4c7c736/engine/sim/profileset.cpp#L1043-L1127)). With `gear` alone, the JSON writer then sees garbage such as `4.66e-310` or NaN. The report stops with `Error generating JSON report: JSON Writer did not accept document.` and leaves a **truncated or 0-byte `json2` file while SimC exits 0**. Whether it hits depends on the run: it failed at 60, 80, 120, 150 and 198 profilesets but not at 100. **Workaround:** `profileset_output_data=gear/stats`, which gave 6 of 6 clean runs. This also matters for Top Gear results (#3), and it's worth an upstream issue.
2. `profileset_output_data=gear` lists a slot only when `parent_item.parsed.data.id != item.parsed.data.id` (same file, L1066). A candidate that is the same item id with other bonus ids, such as a higher-track copy of the equipped ring, gets **no gear entry**. That was 32 of 182 here.
3. **An unknown item id aborts the whole run.** With the default item source, SimC tries the Blizzard API and fails: `Error retrieving item from BCP API: Unable to authorize …`. With `item_db_source=local` it fails with `Cannot initialize data.` Either way, one bad line kills every candidate. **Pre-filter candidate ids against `item-meta.json`, which comes from the same build.**
4. **An unknown bonus id is silently ignored.** Item 271456 with bonus `99999` came out at **ilvl 48** instead of 334, with no warning. When an Addon String is newer than our SimC (a new season's bonus ids), we'd show wrong numbers. **Check every bonus id against the build's full bonus-id set** (kept in `item-meta.json`) and warn "SimC is older than this item, apply the SimC Update".
5. Always pass `item_db_source=local`, so an import never touches the network.
6. SimC does not check the exit code of the JSON write. Parse the file and treat a parse failure as an error.

### Correctness

- SimC is the engine that sims, so its ilvl and stats are by definition the numbers the sim uses.
- **Spot check against Wowhead tooltips (which mirror the in-game tooltip, bonus ids applied server-side).** I checked five items by hand. ilvl, primary stat, stamina and secondaries all match SimC exactly:
  - 271456 `12854:13335:13750`: 334, str/int 189, sta 3,910, crit 140, haste 61.
  - 268213 `13335:13848`: 344, 207, 4,385, crit 148, mastery 61.
  - 237834 crafted, 7 bonus ids: 331, 103, 2,124, haste 56, mastery 56.
  - 271474 `4786:12854:13692:13698:13750`: 334.
  - 249344 `13654`: 298.
  - The static flags match too: Wowhead's "Unique-Equipped", "Unique-Equipped: Embellished (2)", "Two-Hand" and "Use:" lines line up with the flags below.
- **A free runtime cross-check.** The Addon String's `# Name (ilvl)` comments come from the game client (#5). Compare them with SimC's ilvl and flag any mismatch, for example after a squish or an outdated SimC.

## Static fields: build-time `item-meta.json`

Every combination-validity and display field except ilvl and stats is a table lookup. No scaling math is involved:

| Field | Source in SimC's generated data (`engine/dbc/generated/`) | Notes |
|---|---|---|
| Display name | `item_data.inc` `name` | Real name with punctuation: "Voracious Heart of Ula'tek", "Maze-roa, Warlord's Fury" |
| Base quality | `item_data.inc` `quality` | Overridden by bonus **type 3** (`value_1`), e.g. 12854 → 4 |
| Inventory type, class, subclass | `item_data.inc` `inventory_type`, `item_class`, `item_subclass` | Hand type: 17 = 2H, 13 = 1H, 21 = MH, 22 = OH, 14 = shield, 23 = held in off-hand. Also gives armor type for class-usability filtering |
| Item set id | `item_data.inc` `id_set` | e.g. 2067 (tier), 2070 (weapon set `bite_of_zuljan`) |
| Unique-equipped | `item_data.inc` `flags_1 & 0x80000` (`ITEM_FLAG_UNIQUE_EQUIPPED`, [`data_enums.hh`](https://github.com/simulationcraft/simc/blob/4c7c736/engine/dbc/data_enums.hh)) | |
| On-use | `item_effect.inc` rows for the item with `type` 0 (`ON_USE`) or 5 (`ON_NO_DELAY_USE`) | Bonus **type 23** adds an effect by `item_effect` id (embellishments). Resolve it through the same table |
| Limit category granted by a bonus | `item_bonus.inc` **type 35** (`value_1`) | e.g. bonus 8960 → category 512 "Embellished". First one wins |
| Appearance modifier | `item_bonus.inc` **type 7**: `value_1` = ItemAppearanceModifierID, `value_2` = priority, **lowest priority wins** | e.g. 12854/13848 → mod 3, 12790/12793 → mod 1. Feeds #12. Type 28 (`ICON_FILE_DATA_ID`, 17 rows) overrides the icon directly |
| **Base limit category** | **not in SimC**: `dbc_item_data_t` has no such field ([`item_data.hpp`](https://github.com/simulationcraft/simc/blob/4c7c736/engine/dbc/item_data.hpp)) | DB2 `ItemSparse.LimitCategory` |
| **Limit quantity** | **not in SimC** | DB2 `ItemLimitCategory` (`Name_lang`, `Quantity`, `Flags`), plus `ItemLimitCategoryCondition` (3 rows) |

- **Bonus-type semantics.** SimC's `item_bonus_type` enum names only the types it applies ([`data_enums.hh` L77-99](https://github.com/simulationcraft/simc/blob/4c7c736/engine/dbc/data_enums.hh#L77-L99)). The extractor still emits **every** `ItemBonus` row (`ItemBonusDataGenerator`, [`dbc_extract3/dbc/generator.py`](https://github.com/simulationcraft/simc/blob/4c7c736/dbc_extract3/dbc/generator.py)), so types 7, 23 and 35 are in the data. Their meaning and the "lowest priority wins" rule for appearance are from TrinityCore's `ItemBonusType` enum (`ITEM_BONUS_APPEARANCE = 7`, `ITEM_BONUS_ITEM_EFFECT_ID = 23`, `ITEM_BONUS_ITEM_LIMIT_CATEGORY = 35`) and `BonusData::AddBonus` ([`DBCEnums.h`](https://github.com/TrinityCore/TrinityCore/blob/master/src/server/game/DataStores/DBCEnums.h), [`Item.cpp`](https://github.com/TrinityCore/TrinityCore/blob/master/src/server/game/Entities/Item/Item.cpp)). The TrinityCore source is used only as a reference, not code we reuse.
- **Why the DB2 gap matters (measured, `ItemSparse` / `ItemLimitCategory` @ 12.1.0.69933 from wago.tools):**
  - 1,480 equippable armor/weapons have a base `LimitCategory`, 50 of them current (id ≥ 235000). Examples: 680 "Void-Touched" (qty 1, 25 items), 474 "Gladiator's Medallions" (1, 11), 472 "Darkmoon Deck" (1, 4), 512 "Embellished" (2, 3), 704 "Plume of Belo'ren" (1, 2).
  - The bonus-granted ones in SimC's table are 512 Embellished (2), 697 "Outdoor Embellished" (1), 699 "Spark of Beginnings" (3) and some legacy Shadowlands categories.
  - Without the DB2 join, Top Gear would let two Void-Touched weapons or two Darkmoon Decks through.
- **Prototype extractor (measured).** `extract-meta.mjs` is 50 lines of Node, regex over the three `.inc` files. It parses 110,980 equippable items and 3,667 bonus ids (types 3/7/23/35) in **0.24 s**. Output: **8.5 MB JSON, 1.34 MB gzip**. Loading takes 45 ms in Node, and lookups are O(1).
  - Checked against the C++ helper's live `item_t` values for all 560 resolved slots: **0 mismatches** on quality, set id, unique flag, on-use, appearance mod and bonus limit category.
  - Adding the full bonus-id set (for pitfall 4) and the two DB2 columns adds little.
- **Where the `.inc` files come from.** With the recommended Docker-image SimC (#2), we don't have the source tree. Fetch the `.inc` files from `raw.githubusercontent.com/simulationcraft/simc/<git_revision>/engine/dbc/generated/…`, where `git_revision` is read from the pinned binary. That makes the metadata byte-identical to the compiled-in data.
  - Alternative: take everything static from DB2 (`Item`, `ItemSparse`, `ItemXItemEffect`/`ItemEffect`, `ItemBonus`) pinned to `client_data_version`, which is the same pipeline as #12. That drops the GitHub fetch but loses SimC's hotfix-adjusted values.
- **Maintenance per SimC Update:** re-run the script, no code change. The generated tables change almost daily (`item_data.inc` 117 and `item_bonus.inc` 91 commits in 12 months, all `[live] Game data update`). The *struct layouts* the regex depends on are stable: `item_data.hpp` 0 commits and `item_database.hpp` 2 commits in 12 months (GitHub commits API). A layout change would show up as a sudden drop in the parsed count, so assert on it.

## (b) TS port of SimC's bonus-id and scaling logic

- **Scope to port.** `item_database::apply_item_bonus` handles types 1, 2, 3, 6, 11, 13, 14, 23, 25, 42, 48, 49, 50, 51, 52 and 53 ([`sc_item_data.cpp` L172-540](https://github.com/simulationcraft/simc/blob/4c7c736/engine/dbc/sc_item_data.cpp#L172)). On top of that:
  - `sort_item_bonuses`, `curve_point_value`, `apply_item_scaling`, `scaled_stat` (the stat budget from `rand_prop_points`), and the combat-rating and stamina multipliers (L1769-1860).
  - Content tuning, the squish-era curve, crafting quality and `redirected_base_stats` (in `item.cpp`).
  - Parsing `item_data.inc` (26 MB), `item_scaling.inc` (12 MB), `item_bonus.inc`, `rand_prop_points.inc`, `content_tuning.inc`, and the curve and multiplier tables.
  - That is roughly 1,000+ lines of C++ semantics.
- **Churn (GitHub commits API, `midnight`, 2025-09-28 → 2026-09-28).** `sc_item_data.cpp` had **16 commits** and `item/item.cpp` **11**, clustered on patches. Examples:
  - Jan 2026 (Midnight squish): "Support ItemBonus type 53, and scale type 49 with the Midnight squish curve", "Fix ItemBonus type 49 Midnight Scaling", "Implement ItemBonus type 52".
  - Feb 2026: "Fix ItemBonus type 51 item level parsing when item has drop level".
  - Jun-Jul 2026 (12.1): "Parse squish era to properly apply item bonus type 49", "Add ContentTuning table", "support redirected_base_stats option", "Ignore content_tuning when max_level_squish is 0".
  - Each of these is a change the port would have to notice and re-implement. Until it did, the picker would show different numbers from the sim.
- **Latency:** it would be the fastest option (microseconds per item after about 0.5-1 s to load about 40 MB of tables), but the SimC pass is already sub-second.
- **Verdict:** high maintenance for an ongoing correctness risk, to save about 0.2-0.4 s per import. We would still need SimC as the test oracle. Not recommended.

## (c) C++ helper on SimC's engine

**Prototype (measured).** `itemdump.cpp` is about 110 lines, compiled against the existing engine objects. It links every `.o` except `sc_main.o`, with `-lcurl -lpthread`: 1.5 s to compile and 1.2 s to link. It runs `dbc::init`, `module_t::init`, `unique_gear::register_*`, `sim.setup`, `sim.init()` and **no combat**. It then prints one JSON line per item with display name, ilvl, quality after bonuses, inventory type, class/subclass, hand type, set id, unique flag, bonus limit category, on-use, appearance mod, `encoded_item` and stats. Example output:

```json
{"actor":"Thrallina","slot":"trinket1","id":270175,"name":"Voracious Heart of Ula'tek","ilvl":344,"quality":4,
 "inventory_type":12,"hand":null,"set_id":0,"unique_equipped":true,"limit_category_bonus":0,"on_use":true,
 "appearance_mod":3,"encoded":"voracious_heart_of_ulatek,id=270175,bonus_id=13335/13848","stats":{"crit_rating":149}}
```

- **Latency:** 0.22-0.24 s for 30-60 candidates and 0.69 s for the 182-candidate packed input (init 572 ms). That is **no faster than the plain SimC pass (0.17-0.25 s and 0.48 s)**, because the cost is player and special-effect init, not combat. A trimmed helper could be faster, but only by forking more of SimC's init.
- **Coverage:** everything in the table above, still **except** the base `ItemSparse.LimitCategory` and the quantities. Those need an extractor patch (`generator.py` + `item_data.hpp`) or the same DB2 join anyway.
- **Maintenance per SimC Update:**
  - We must build SimC from source, which means giving up the official PGO Docker image (#2) or building twice (+2 min for GCC, more with PGO).
  - We carry an out-of-tree file that uses internal APIs: `sim_t::setup`/`init`, `item_t::parsed`, `dbc_t::item_bonus`, `unique_gear::*`. Those change without notice; for example "Initialize everything in parsed_input_t" landed 2026-09-11.
  - Break risk is low to medium per update, and fixes need C++ work.
- **Verdict:** it works, but it adds nothing that the SimC pass plus build-time metadata doesn't give. Keep it in mind only if we ever build SimC from source anyway. The cleaner route to the same result is an **upstream PR** that adds `quality`, `inventory_type`, `id_set` and `appearance_mod` to `gear_to_json`. It is small and self-contained, and would make (a) cover most fields with zero local code.

## Comparison

| | (a) packed SimC `json2` pass | (b) TS port | (c) C++ helper | Build-time `item-meta.json` |
|---|---|---|---|---|
| Latency, 30-60 candidates | **0.17-0.25 s** | ~ms (+ ~0.5-1 s table load) | 0.22-0.24 s | ~45 ms load, then O(1) |
| Latency, 182 candidates | 0.48 s | ~ms | 0.69 s | O(1) |
| ilvl, stats | **yes, authoritative** | yes, if the port is right | yes, authoritative | no (base ilvl only) |
| Display name, quality | token only | yes | yes | **yes** |
| Set id, unique, hand type, on-use | no | yes | yes | **yes** |
| Limit category + quantity | no | bonus part only | bonus part only | **yes with the DB2 join** |
| Appearance mod | no | yes | yes | **yes** |
| Work per SimC Update | **none** | re-port logic changes (~27 commits a year) | rebuild from source + fix API drift | re-run the script |

## Recommendation

1. **At SimC Update (build time):** generate `data/item-meta.json` in the same script as `item-icons.json` (#12). Inputs:
   - SimC's `item_data.inc`, `item_effect.inc` and `item_bonus.inc` fetched at the pinned `git_revision`.
   - DB2 `ItemSparse.LimitCategory` and `ItemLimitCategory` (+ `ItemLimitCategoryCondition`) from wago.tools pinned to SimC's `client_data_version`.

   Emit per item: name, quality, inventory type, class/subclass, set id, unique, on-use, base limit category. Emit per bonus id: quality override, appearance mod + priority, added item effect, limit category. Also emit the set of all known bonus ids. About 1.3 MB gzip.
2. **At Addon String import (runtime):** validate every candidate's item id and bonus ids against `item-meta.json`. Unknown ids get a "SimC older than this item" warning and are left out of the SimC input. Then run **one packed SimC pass**: `copy=` actors, at most one candidate per slot, with `iterations=1 max_time=1 report_details=0 item_db_source=local json2=`. Read ilvl and stats from `gear[*]`, keyed by `encoded_item`. Cache the results per `(encoded item line, SimC git_revision)`.
3. **Merge the two** into the picker model: numbers from SimC, flags and names from meta, plus the icon from #12 keyed by `(itemId, appearanceModId)`. Cross-check SimC's ilvl against the Addon String's `# Name (ilvl)` comment.
4. **Top Gear pruning** (#3) uses `unique`, the limit category (base, or granted by a bonus such as 8960 → 512 "Embellished" ×2) with its quantity, `set`, the hand type derived from inventory type, and `use`. It needs no SimC call.
5. **Don't** port the bonus math to TS and **don't** ship a C++ helper. Where SimC runs profilesets, use `profileset_output_data=gear/stats`, never `gear` alone, and treat an unparsable `json2` as a failure even when the exit code is 0.

## Open questions surfaced

- **Upstream the `profile_output_data_t` bug?** The uninitialized doubles give a truncated `json2` with exit code 0. It is also worth proposing a small `gear_to_json` extension (quality, inventory type, set id, appearance mod).
- **Class usability filtering.** The addon exports bag items the class can't use (#5). Should the picker hide wrong armor types and weapon types using meta `class`/`subclass`, or show them greyed out?
- **Primary stat display.** SimC reports combined primaries (`strint`, `stragi`, `agiint`). The UI needs the spec's primary stat to label them. That comes from the spec table, not item data.
- **Newer-than-SimC items.** When an Addon String has unknown item or bonus ids, do we block Top Gear, drop those items with a warning, or offer the **SimC Update** directly?
- **`.inc` fetch vs pure DB2.** Should the metadata script depend on GitHub raw at `git_revision` (exact SimC data, hotfixes included) or only on wago.tools DB2 (one source shared with #12)?
