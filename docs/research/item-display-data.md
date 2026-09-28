# Where does item display data come from?

Resolves issue #4. Researched 2026-09-28 against WoW live build **12.1.0.69933**.

**Question.** We have an item id and bonus ids from the **Addon String**. Where do we get the item's name, icon, final ilvl, stats, quality and set/embellishment info? The candidates are Wowhead, Raidbots static data, SimC's DBC-extracted data and the Blizzard Game Data API. For each one this note covers coverage, how bonus ids are applied, how fresh the data is after a patch, licensing/ToS, and whether it works offline.

## TL;DR

| Source | Name | Icon | Final ilvl (bonus ids) | Stats | Quality | Set / Embellish | Freshness | ToS / licence | Offline |
|---|---|---|---|---|---|---|---|---|---|
| **SimC (the binary we already run)** | yes | **no** | **yes, authoritative** (same code that sims) | yes (final, per item) | yes | set id + `embellishment_data` | per SimC build; `[live]` data commits land within days of a build (several per week) | GPL-3.0 code; data extracted from the game client | **yes** |
| **Raidbots static data** | yes | icon *name* | raw tables only, **we would re-implement the math** | base allocations | base | `itemSetId`, `bonuses.json` effects | regenerated per build (metadata `generatedAt`) | **no published terms, not a public API** | yes, if mirrored |
| **Wowhead tooltips** | yes | icon name + CDN | **yes** (`bonus=` param, server-side) | yes (in HTML) | yes | yes (in HTML) | fast, usually same day | ToS forbids automated access except as documented; the embed script is the documented use | **no** |
| **Blizzard Game Data API** | yes | yes (media endpoint) | **no**: no bonus-id support | base only | base | `item_set` | official | 36k req/h, **30-day TTL**, attribution, OAuth client required | **no** |

**Recommendation.** Use **SimC as the source of truth for ilvl, stats, name, quality and set/embellishment**, since it is the engine whose numbers we display, so it can never disagree with the sim. Add **icons by name from a CDN** (Blizzard `render.worldofwarcraft.com` or Wowhead `wow.zamimg.com`), with a local cache. Optionally load Wowhead's embed script for rich hover tooltips when online. Don't make the app depend on Raidbots' undocumented bucket or on the Blizzard API.

## 1. SimC's own DBC-extracted data

**What exists.** SimC ships generated C++ tables in `engine/dbc/generated/` ([tree @ midnight](https://github.com/simulationcraft/simc/tree/midnight/engine/dbc/generated)). The default branch is `midnight` and the licence is GPL-3.0 (GitHub repo metadata). The relevant files are `item_data.inc` (~26 MB), `item_bonus.inc`, `item_scaling.inc`, `item_naming.inc`, `item_set_bonus.inc`, `embellishment_data.inc` and `gem_data.inc`, and each has a `_ptr` twin.

- **Fields.** `dbc_item_data_t` has `name`, `id`, `level` (ilvl), `quality`, `inventory_type`, `item_class/subclass`, stat allocations, sockets, `id_set`, `id_curve` and `crafting_quality`. It has **no icon field** ([`engine/dbc/item_data.hpp`](https://github.com/simulationcraft/simc/blob/midnight/engine/dbc/item_data.hpp)).
- **Coverage.** The extractor keeps *all* armor and weapons ("Include all Armor and Weapons", `classdata.classs in [2, 4]`), plus gems, selected consumables and enchants. It blacklists only deprecated, QA and NYI items ([`dbc_extract3/dbc/generator.py`, `ItemDataGenerator.filter`](https://github.com/simulationcraft/simc/blob/midnight/dbc_extract3/dbc/generator.py)).
- **Bonus ids.** `item_database::apply_item_bonus` handles every bonus type: `ITEM_BONUS_ILEVEL`, `SCALE_CONFIG`/`SCALE_CONFIG_2` with content-tuning caps, `SQUISH_CURVE` (the Midnight squish curve), `CRAFTING_QUALITY`, `POST_SQUISH_ITEM_LEVEL`, nested `APPLY_BONUS`, and so on ([`engine/dbc/sc_item_data.cpp` L172+](https://github.com/simulationcraft/simc/blob/midnight/engine/dbc/sc_item_data.cpp)). This logic is non-trivial and changes with every squish, which is the main argument against re-implementing it ourselves.
- **Embellishments.** `embellishment_data.inc` maps each embellishment name to its bonus id, item id and spell id (54 entries in build 69933). Set bonuses live in `item_set_bonus.inc`.
- **How we get it out.** SimC's JSON report (`json2=`) writes one object per equipped slot with `name`, `encoded_item`, `ilevel` and every non-zero final stat ([`engine/report/json/report_json.cpp` `gear_to_json`, L382-406](https://github.com/simulationcraft/simc/blob/midnight/engine/report/json/report_json.cpp)). For profilesets (Top Gear), `profileset_output_data=gear` adds `item_id`/`item_level` per slot for each combination (same file L938-947; option registered in [`engine/sim/profileset.cpp` L968](https://github.com/simulationcraft/simc/blob/midnight/engine/sim/profileset.cpp)).
- **Freshness.** `client_data_version.inc` currently reads `12.1.0.69933`, hotfix date 2026-09-24. The commit history for that file shows `[live] Game data update` commits on 09-17, 09-18, 09-19, 09-21, 09-22, 09-23 and 09-25. Our data is therefore exactly as fresh as the SimC build we run, which ties it to the **SimC Update** flow.
- **Offline.** Yes. Everything is compiled into the binary we already ship.
- **Gap.** There is no icon name. We also have no cheap "describe this item" CLI entry point for items that are *not* equipped (bag/vault items before a sim). See the open questions.

## 2. Raidbots public static data

**What exists.** A public GCS/Cloudflare bucket at `https://www.raidbots.com/static/data/{live,ptr}/…`. `metadata.json` lists about 50 files and gives `wowBuild: 12.1.0.69933` and `generatedAt: 2026-09-24T23:00:32Z`. Responses carry `access-control-allow-origin: *` and `cache-control: max-age=2678400` (fetched 2026-09-28).

- **`equippable-items.json`** (53 MB, 110,452 items). Each item has `id`, `name`, `icon` (a name such as `inv_cloth_raidmageprogenitor_d_01_chest`), `quality`, `itemLevel` (base), `stats` as `{id, alloc}`, `itemSetId`, `socketInfo`, `specs`, `sources`, `itemLimit`, `squishEra`, and so on.
- **`bonuses.json`** (9,746 entries). Fields include `level`, `levelOffset`, `curveId`, `dropLevelCurve`, `quality`, `socket`, `craftedStats`, `effect`, `item_limit_category`, `name_override`, `upgrade`, `applyBonusId`. There are also companion tables (`item-curves.json`, `item-squish-era.json`, `content-tuning.json`, `bonus-*.json`, `item-sets.json`, `icon-lookup.json`).
- **Bonus ids.** These files are **raw inputs**. The code that combines them into a final ilvl and stats is Raidbots' own client code and is not published. We would have to port SimC's `apply_item_bonus` logic to TypeScript and keep it in sync after every squish or season.
- **Freshness.** Good: regenerated per build.
- **ToS.** No terms page was found (`/terms`, `/tos`, `/legal` and `/terms-of-service` all return 404). It is an undocumented internal asset bucket, not an API contract. Its shape can change without notice, and heavy downloads of a single-person hobby app's worth of 50-100 MB files from a small donor-funded service are a courtesy question.
- **Offline.** Only if we mirror the files. Doing that means redistributing someone else's data in our Docker image.

## 3. Wowhead tooltips

**What exists.** The documented integration is the embed script plus `data-wowhead="…"` attributes on links ([wowhead.com/tooltips](https://www.wowhead.com/tooltips)). Documented item options include `bonus=` (colon-separated bonus ids), `ilvl`, `gems`, `ench`, `pcs` (set pieces for the set-bonus count), `upgd`, `lvl`, `sock` and `transmog`.

- **The JSON behind it** (`https://nether.wowhead.com/tooltip/item/{id}?dataEnv=1&locale=0&bonus=…`) returns `name`, `quality`, `icon` and `tooltip` (rendered HTML with ilvl, stats, set pieces and so on). Tested with item 188839 and `bonus=8153:1498`, which returned name, quality 4, icon, and "Item Level 58" plus squished stats. **This endpoint is undocumented**, and the stats are only available by scraping HTML comments like `<!--stat5-->`.
- **Bonus ids.** Applied server-side by Wowhead, which is accurate.
- **Icons.** `https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg` (HTTP 200).
- **Freshness.** Usually updated on the day of a patch or hotfix.
- **ToS.** Wowhead's tooltips page links to Fanbyte's terms ([corp.fanbyte.com/legal/terms](https://corp.fanbyte.com/legal/terms)). Those terms forbid accessing or downloading content "using any engine, software, tool, agent, device or mechanism (including spiders, robots, crawlers, data mining tools…)", and allow APIs only "in the manner described by any accompanying documentation". Using the **embed script in the browser is the sanctioned use**. Server-side scraping of `nether.wowhead.com` for stats is not.
- **Offline.** No.

## 4. Blizzard Game Data API

- **Endpoints.** `/data/wow/item/{id}` (static namespace) and `/data/wow/media/item/{id}` (icon asset URL), plus item-set endpoints. It requires an OAuth client-credentials app.
- **Bonus ids.** **Not supported.** The old Community API's `bl=` bonus list was not carried over. Community forum thread "Bonus ID option in Game Data API" (2020-03-21) got only a moderator reply saying the team was "aware… they'll discuss this internally"; nothing has shipped since ([forum](https://us.forums.blizzard.com/en/blizzard/t/bonus-id-option-in-game-data-api/4430)). The API therefore returns base/preview stats only, which is useless for the final ilvl of a Top Gear candidate. The *Profile* API does return resolved equipment, but only for the armory-equipped set, not for Addon String bag or vault items.
- **ToS** ([Blizzard Developer API Terms of Use](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use)): 36,000 calls/hour, "You must implement a maximum 30-day TTL" on stored data, and you must identify Blizzard as the source.
- **Icons.** `https://render.worldofwarcraft.com/us/icons/56/{icon}.jpg` is served without auth (HTTP 200), given an icon name from any source.
- **Offline.** No.

## Recommendation

1. **SimC is the authority for everything numeric.** For the equipped set, and for each Top Gear combination, read `gear` from `json2` (with `profileset_output_data=gear`). This guarantees the ilvl and stats we display are the ones SimC simmed, and they update automatically with each **SimC Update**.
2. **Name, quality, set and embellishment** also come from SimC's tables. Where the report doesn't expose them, get them from a small extracted index (see Q1 below).
3. **Icons:** resolve item id to icon name once, cache it locally, and load images from `render.worldofwarcraft.com` or `wow.zamimg.com`. When offline, show a quality-coloured placeholder.
4. **Rich tooltips (optional, online only):** add Wowhead's embed script with `data-wowhead="bonus=…&ilvl=…&gems=…&ench=…"`. This is the documented, permitted use, costs zero backend code, and degrades gracefully.
5. **Avoid** building on Raidbots' bucket (no contract, would need a TS port of the bonus math) and on the Blizzard API (no bonus ids, OAuth, 30-day TTL).

## Open questions surfaced

- **Q1: Display data for non-equipped items before a sim.** Bag and vault items need ilvl and stats in the item picker before any sim runs. Options: (a) run a cheap SimC pass (for example `iterations=1` with one profileset per candidate and `profileset_output_data=gear`) and take `name`/`ilevel`/stats; (b) parse `item_data.inc`, `item_bonus.inc` and the related files at build time into JSON and port `apply_item_bonus` to TS; (c) a small C++ helper linked against SimC's dbc code. Needs a spike.
- **Q2: Source of item-id to icon-name mapping offline.** SimC has no icons. Candidates: a one-time pull from the Blizzard media API or Wowhead embed JSON into a local cache, or Raidbots `equippable-items.json`. This is a licensing and ToS decision.
- **Q3: Does `profileset_output_data=gear` expose enough** (currently only `item_id` and `item_level` per slot, no stats or name) for the Top Gear results table, or do we need a SimC patch or extra pass?
- **Q4: Squished ilvls.** Midnight's item squish means Wowhead, SimC and the in-game display must agree on post-squish numbers. SimC applies `SQUISH_CURVE_MIDNIGHT`. Verify that SimC matches the in-game display for a sample Addon String.
