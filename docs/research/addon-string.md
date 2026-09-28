# The Addon String: format and parsing

Research for [issue #5](https://github.com/payouri/simbot/issues/5).
Researched 2026-09-28.

## Sources

All claims below come from these primary sources, read at the pinned commits:

- **simc-addon**: [`simulationcraft/simc-addon`](https://github.com/simulationcraft/simc-addon) @ `305f979` (2026-08-21), addon version `12.1.0-04`, TOC `120005, 120007, 120100`.
  - `core.lua`: `GetSimcProfile` (assembles the whole string), `GetItemStringFromItemLink` (item lines), `GetBagItemStrings`, `GetExportString` (talents), the currency getters, `adler32`.
  - `extras.lua`: slot tables, `invTypeToSlotNum`, the currency/item/achievement ID lists.
  - `bonusrolls.lua`: `GetBonusRollItems`.
- **SimC engine**: [`simulationcraft/simc`](https://github.com/simulationcraft/simc) branch `midnight` @ `4c7c736` (2026-09-27).
  - `engine/sim/option.cpp`: `option_db_t::parse_text` / `parse_line` (comment handling).
  - `engine/sim/sim.hpp`: the `strict_parsing` doc comment.
  - `engine/player/player.cpp`: `player_t::create_options`, `parse_talent_string`, `parse_traits_hash`.
  - `engine/item/item.cpp` (around line 840): item option table.
- **SimC wiki**: [`Characters`](https://github.com/simulationcraft/simc/wiki/Characters), [`Equipment`](https://github.com/simulationcraft/simc/wiki/Equipment), [`ProfileSet`](https://github.com/simulationcraft/simc/wiki/ProfileSet).

## TL;DR

- The Addon String **is a SimC profile**. Every uncommented line is a normal SimC option (`warrior="Name"`, `level=`, `talents=`, `head=,id=...`), so **SimC reads it directly**. SimC skips any line that starts with `#` (`option.cpp`). By default it also ignores option names it doesn't know (`strict_parsing` defaults to false, `sim.hpp`). A **Quick Sim** can therefore pass the string to SimC unchanged.
- Everything Top Gear needs beyond the equipped set is **inside `#` comments**: bag, bank and warband-bank items, Great Vault choices, linked items, saved talent loadouts, catalyst charges, upgrade currencies, high watermarks, upgrade achievements and bonus-roll data. SimC never sees these. **Our app has to parse them.** Each commented item line is a valid SimC item line with `# ` in front of it.
- To build the item picker we must parse: the character block, the equipped slot lines, the commented item lines in each `###` section (plus the `# Name (ilvl)` comment above each one), the talent lines (active and saved), and the `### Additional Character Info` key/values.
- The string does **not** include item names or item levels that we can rely on (the comments are "best effort"), item icons, stats, whether an item is 1H or 2H, armor type, whether an item is usable by the class, or where a bag item is stored. That information has to come from game data, most likely SimC itself (see the open questions).
- Existing TS parsers: **none on npm**. Two small public GitHub projects exist. [`frostdev-ops/frostsim`](https://github.com/frostdev-ops/frostsim) (`src/lib/import/character.ts`) is **GPL-3.0** and can only be used as a reference. [`DomNidy/saint_sim`](https://github.com/DomNidy/saint_sim) (`apps/web/src/lib/simulation/parse-addon-export.ts`) has **no license**, so we can't reuse it. **We write our own.** The grammar is small and line-oriented.

## Overall layout

`GetSimcProfile` writes the sections in this fixed order. Lines end with `\n`.

1. **Header comments**: `# <Name> - <Spec> - <YYYY-MM-DD HH:MM> - <region>/<realm>`, then `# SimC Addon <version>`, `# WoW <version>.<build>, TOC <toc>`, `# Requires SimulationCraft <x> or newer`. The last one is currently a hard-coded placeholder, `1000-01`.
2. **Character block** (live options):
   - `<class>="<Name>"`: this line creates the actor. `class` is the class token, e.g. `warrior`, `death_knight`, `demon_hunter`.
   - `level=`, `race=`, then `zandalari_loa=` (Zandalari trolls only), `region=`, `server=`, `role=`, `professions=a=rank/b=rank`, `spec=`.
   - `# loot_spec=`: commented out.
   - Tokens are made with SimC's `Tokenize`: lower-case, spaces become `_`.
3. **Talents**:
   - The active loadout: `talents=<Blizzard loadout export string>`.
   - Then every saved loadout for the current spec. Each is a pair of lines, `# Saved Loadout: <name>` followed by `# talents=<string>`.
   - `GetExportString` only comments out loadouts whose config ID isn't the active one. If the WoW API also returns the active config ID in the saved list, that loadout will show up there as a second live `talents=` line. This depends on client behavior and is **not verified**; the parser should cope with it either way.
   - If the user ticks "Offspec Talent Loadouts", there is a `### Offspec Loadouts: <SpecName>` section with `# Offspec Loadout: <name>` / `# offspec_talents=<string>`. The addon rewrites the spec ID in the string header.
   - If the client has no talent data yet, it writes `# Unable to export talents - ...`.
4. **Extra trait systems**: `omnium_talents=<entryID>:<rank>/...`. This is a live line. It is the 12.0.7 "player power", trait system 48. SimC reads it (`omnium_talents` in `create_options`).
5. **Equipped gear**: one live `<slot>=,id=...` line per slot, with an optional `# <Name> (<ilvl>)` comment above it. Slot order comes from `simcSlotNames`: head, neck, shoulder, back, chest, shirt, tabard, wrist, hands, waist, legs, feet, finger1, finger2, trinket1, trinket2, main_hand, off_hand.
6. **`### Gear from Bags`** (left out with `/simc nobags`): each item is `#`, `# <Name> (<ilvl>)`, then `# <slot>=,id=...`. Items are sorted by slot number.
7. **`### Weekly Reward Choices`** … `### End of Weekly Reward Choices`: the Great Vault. Only present while rewards can be claimed. Same three-line shape as the bag items.
8. **`### Merchant items`**: only with `/simc merchant`. Used for debugging.
9. **`### Linked gear`**: items the user shift-clicked after `/simc`.
10. **`### Additional Character Info`**: a list of `#` / `# key=value` pairs (see below).
11. **`# Checksum: <hex>`**: the last line.

## Item line grammar

The addon builds an item line from the WoW item link (`GetItemStringFromItemLink`):

```
<slot>=,id=<itemId>[,enchant_id=N][,gem_id=a/b/c][,bonus_id=a/b/.../z][,drop_level=N]
       [,content_tuning=N][,redirected_base_stats=N][,crafted_stats=a/b][,gem_bonus_id=a/b]
       [,crafting_quality=N][,titan_disc_id=N]
```

- The value starts with `=,` because the item has no name token. SimC names it from `id`.
- The options always come in the order shown above. Multi-value options use `/` as the separator. This matches the `Equipment` wiki: "Multiple bonus ids use "/" as a delimiter".
- `gem_id` has trailing zeros removed. An empty socket in the middle stays as `0`.
- `drop_level` (modifier 9), `content_tuning` (28), `crafted_stats` (29/30) and `redirected_base_stats` (64) come from the link's modifier pairs. Modifier 64 is prospective: it's for 12.1 catalyst items that inherit stats from the source item.
- `titan_disc_id` only appears on the 11.1.7 belt (item IDs 242664 / 245964–245966).
- Every one of these is a known item option in SimC's `item.cpp` option table. `crafting_quality` and `context` are accepted there as dummy options.
- For `/simc debug` with the upgrade vendor open, the addon adds an extra comment above the item: `# upgrade_levels=<lvl>:<ilvlInc>:c#<currencyId>#<cost>#<discounted>,...:i#<itemId>#<count>#<disc>/...`. It lists the cost of each upgrade level the item isn't on yet. It doesn't appear in normal exports.

The slot of a bag or vault item comes from `invTypeToSlotNum`. Two consequences:

- **Rings and trinkets are always `finger1` / `trinket1`.**
- **Every main-hand-capable weapon is `main_hand`, and every shield or off-hand item is `off_hand`.** That includes 2H weapons. The string doesn't say whether a weapon is 1H or 2H, or whether it can go in the off hand. We have to look that up.

The addon doesn't check whether the class can use a bag item (armor type, weapon type). It only checks that the item has an equip slot.

Since 11.2, the "bags" section also covers the character bank and the warband bank: `GetBagItemStrings` loops over containers `0..(bags + reagent bag + character bank + account bank)`. **Nothing in the output says whether an item is in the bags, the bank or the warband bank.**

## Talents

- `talents=` takes Blizzard's loadout export string: base64, with a header of 8-bit serialization version, 16-bit spec ID and 128-bit tree hash, followed by the node data.
  - SimC decodes it itself (`parse_traits_hash` in `player.cpp`). The `Characters` wiki says it "accepts Blizzard's in-game generated talent export hash, from either the talent UI export or the Simulationcraft addon."
  - The addon refuses to export if `C_Traits.GetLoadoutSerializationVersion() ~= 2`.
- **Our app does not need to decode talent strings to run sims.** It only needs to find them and pass the chosen one to SimC as a `talents=` line. To show talent trees we would need to decode them; that's out of scope for the picker.
- SimC has no `offspec_talents` option. These lines are always commented out, so SimC never reads them either way.

## `### Additional Character Info`

Every value here is a comment, so SimC ignores all of it. The keys are written in this order. `slot_high_watermarks` and `bonus_roll_items` are only written when they have data.

| Key | Format | Meaning | Source |
|---|---|---|---|
| `catalyst_currencies` | `currencyId:qty/...` | Catalyst charges. IDs 2813, 3116, 3269, 3378 (Dawnlight Manaflux), 3465 (Venomblight Manaflux). Written even when the quantity is 0. | `GetCatalystCurrencies`, `extras.lua` |
| `upgrade_currencies` | `c:currencyId:qty/.../i:itemId:count/...` | Upgrade currencies (`c`, only when qty > 0; e.g. 3008 Valorstones, 3383/3341/3343/3345/3347 Dawncrests, 3442–3446 Mistcrests) and items used as currency (`i`, e.g. Sparks, Enchanted Crests, Heraldry; the count includes bank and warband bank). | `GetUpgradeCurrencies` |
| `slot_high_watermarks` | `slot:charHW:accountHW/...` | Highest item level ever earned per slot, for character and account. Used for discounted upgrades. `slot` is `Enum.ItemRedundancySlot` (0–16), **not** a paper-doll slot. | `GetSlotHighWatermarks` |
| `upgrade_achievements` | `achId/...` | Completed crest-discount achievements from a fixed list (e.g. 42767–42770 "… of the Dawn", 62410–62416 "… of the Mist"). | `GetItemUpgradeAchievements` |
| `bonus_roll_currencies` | `currencyId:qty/...` | Bonus-roll currency, e.g. 3418 Nebulous Voidcore. | `GetBonusRollCurrencies` |
| `bonus_roll_items` | `currency:source:context:keyLevel:itemId:specId/...` | Bonus-roll wins this season, recorded by the addon (SavedVariables). The comment in `bonusrolls.lua` says it exists "so Raidbots can map it to a season". | `GetBonusRollItems` |

Top Gear's "upgrade items" and "catalyst" options need these values together with game data: upgrade tracks, and catalyst item mappings per slot and class. None of that game data is in the string.

## Checksum

`# Checksum: <hex>` is the Adler-32 of everything above that line, computed after `||` has been turned back into `|`. The code comment calls it "a lightweight verification that the input hasn't been edited/modified". SimC ignores it because it's a comment. We can check it to warn the user that the string was edited or cut off during paste. We should not reject the string because of it.

## Realistic annotated example

This is an illustrative example. Its structure is exactly what `GetSimcProfile` produces at `305f979`. The IDs are plausible but made up, and the checksum is a placeholder. Annotations (`<--`) are not part of the real output.

```text
# Thrallina - Fury - 2026-09-27 21:14 - EU/Hyjal            <-- header comment (name, spec, date, region/realm)
# SimC Addon 12.1.0-04
# WoW 12.0.7.63728, TOC 120007
# Requires SimulationCraft 1000-01 or newer

warrior="Thrallina"                                         <-- creates the actor; class token = key
level=90
race=orc
region=eu
server=hyjal
role=attack
professions=blacksmithing=100/mining=100
spec=fury
# loot_spec=fury

talents=CgEAAAAAAAAAAAAAAAAAAAAAAYmZmxMzMGzyMmZmZGAAAAAAAjZmxYGDzMzMzYmxMDzMbzMAAAAAAAYGzMMAA   <-- active loadout (live)

# Saved Loadout: Raid ST
# talents=CgEAAAAAAAAAAAAAAAAAAAAAAYmZmxMzMGzyMmZmZGAAAAAAAjZmxYGDzMzMzYmxMDzMbzMAAAAAAAYGzMMAA
# Saved Loadout: M+ AoE
# talents=CgEAAAAAAAAAAAAAAAAAAAAAAYmZmxMzMmZmZMmZmZGAAAAAAAjZmxYGDzMzMzYmxMDzMbzMAAAAAAAYGzMMYA

omnium_talents=113204:1/113211:2/113219:1                   <-- extra trait system (live; SimC reads it)

# Crest of the Stormbound Sovereign (723)                   <-- best-effort "Name (ilvl)" comment
head=,id=249952,bonus_id=12806/6652/12667/13577/12790,gem_id=240892
# Talisman of Mirrored Echoes (720)
neck=,id=251880,gem_id=240892/240892,bonus_id=12793/6652/12667/13577/12790
...
# Band of the Unseen Tide (720)
finger1=,id=251217,enchant_id=7967,gem_id=240892/240892,bonus_id=12793/6652/12667/13577
# Everforged Warband Ring (714)
finger2=,id=222439,enchant_id=7967,bonus_id=10421/9633/8902/12050/12053/10879/10222,crafted_stats=32/40,crafting_quality=5
...
main_hand=,id=249283,enchant_id=7981,bonus_id=12806/6652/12667/13577
off_hand=,id=249283,enchant_id=7979,bonus_id=12793/6652/12667/13577     <-- no name comment (lookup was throttled)

### Gear from Bags                                          <-- bags + char bank + warband bank, not distinguished
#
# Bindings of the Wild Hunt (710)
# wrist=,id=250311,bonus_id=12790/6652/12667,drop_level=90  <-- a real SimC item line after "# "
#
# Seal of the Drowned Crown (717)
# finger1=,id=251096,bonus_id=12806/6652/12667/13577        <-- rings always finger1, trinkets always trinket1
#
# Greataxe of Endless Winter (707)
# main_hand=,id=249911,bonus_id=12790/6652,drop_level=90    <-- 2H or 1H? not stated

### Weekly Reward Choices                                   <-- Great Vault (only when rewards can be claimed)
#
# Idol of the Rising Storm (730)
# trinket1=,id=249343,bonus_id=12806/6652/13577/12795
#
### End of Weekly Reward Choices

### Additional Character Info
#
# catalyst_currencies=3378:4/3465:0/2813:0/3116:0/3269:0    <-- catalyst charges (currencyId:qty)
#
# upgrade_currencies=c:3008:1843/c:3345:212/c:3347:45/i:274476:1   <-- c=currency, i=item-as-currency
#
# slot_high_watermarks=0:723:726/1:720:720/2:717:723        <-- ItemRedundancySlot:char:account
#
# upgrade_achievements=42767/42768/42769
#
# bonus_roll_currencies=3418:2
#
# bonus_roll_items=3418:1:5:12:249343:72                    <-- currency:source:context:keyLevel:itemId:specId

# Checksum: 5f3a0b21
```

## What our parser must extract (to build the item picker)

We can use a single-pass, line-oriented state machine. The `###` headers tell us which section we're in.

1. **Normalize**: convert CRLF to LF, trim trailing whitespace, and turn `||` into `|`. Keep the raw text for the checksum.
2. **Character block**: find the class line (`^(<class token>)="(.+)"$`) and `level`, `race`, `region`, `server`, `role`, `spec`, `professions`, `zandalari_loa`, plus the commented `loot_spec`.
3. **Talents**: the live `talents=` line (active), the `# Saved Loadout: <name>` / `# talents=` pairs, and optionally the `offspec_talents` sections. Remove duplicates by string, and if there is more than one live `talents=` line, use the first one.
4. **Items**:
   - Equipped items are the live `<slot>=,...` lines.
   - Candidate items are the `# <slot>=,...` lines in `Gear from Bags`, `Weekly Reward Choices` and `Linked gear`. Tag each with its source.
   - For each one, keep the `# Name (ilvl)` comment directly above it if present. Match it with `^(.*?\S)\s+\((\d+)\)$`.
   - Split the options on `,` and then on the first `=`. Split multi-value options on `/`. Keep the exact original line so we can feed it back to SimC unchanged. SimC is the authority on what the item is.
5. **Additional info**: parse the `# key=value` lines into typed maps.
6. **Checksum**: check it and report a mismatch as a warning.

We should treat unknown options and unknown `###` sections as data we keep, not as errors. The addon adds fields often; for example `redirected_base_stats` was added ahead of time for 12.1.

## Does SimC parse it directly?

Yes, the live part. The class line sets `sim->active_player`, and each following `key=value` token is sent to that player's or item's option table.

SimC does **not** understand the commented sections. To sim a bag item, a saved loadout or a combination, someone has to remove the `# ` and write the line as a live option or as a profileset override. For Top Gear that someone is our app: it generates a base profile plus `profileset."<name>"+=<slot>=,id=...` lines (see the `ProfileSet` wiki). SimC does no Top Gear work itself.

## Open questions this raises

- **Item metadata source**: we need names, ilvl, icon, 1H/2H, armor type, class usability, catalyst and upgrade paths. The options are:
  - have SimC resolve them (e.g. run a zero-iteration sim, or read the JSON report's per-item data);
  - use SimC's generated DBC data files;
  - use the Blizzard or Wowhead APIs.
  Which should we use, and what does each cost at import time?
- **Combination validity**: rules for 1H+1H vs 2H vs 1H+off-hand, unique-equipped items and rings, and embellishment limits. These rules come from item data, not from the string.
- **Catalyst and upgrade simulation**: Top Gear's "catalyze" and "upgrade to X" options need catalyst mappings and upgrade-track tables, plus the currency and watermark data above. Is this in scope for v1?
- **Bag location**: bank, warband bank and bags look the same in the export. Is that acceptable in the UI?
- **Version drift**: the export format follows WoW patches, via the addon version and TOC. How do we detect and handle a format our parser doesn't know? Keep unknown data, and warn when the SimC in use is older than the addon version?
