# Where does the offline item-to-icon mapping come from?

Resolves issue #12. Researched 2026-09-28. The live build was **12.1.0.69933**, the same build SimC's `client_data_version.inc` targets (see [item-display-data.md](https://github.com/payouri/simbot/blob/research/item-display-data/docs/research/item-display-data.md), issue #4).

**Question.** SimC has no icon names. Icons load by name from `render.worldofwarcraft.com/us/icons/56/{icon}.jpg` or `wow.zamimg.com/images/wow/icons/large/{icon}.jpg`. Where do we get an offline item id to icon name mapping, legally? The candidates are the Blizzard media API, Wowhead tooltip data, Raidbots `equippable-items.json` / `icon-lookup.json`, and DB2 tables via wago.tools or the listfile. This note covers terms, coverage, refresh and size for each.

## TL;DR

| Source | How | Coverage (armor + weapons) | Refresh after a patch | Terms | Size |
|---|---|---|---|---|---|
| **Client DB2 tables** (`Item`, `ItemModifiedAppearance`, `ItemAppearance`, `ManifestInterfaceData`), fetched as CSV from wago.tools **pinned to SimC's build** | Join IconFileDataID to the icon path | **139,968 / 140,756 (99.4 %)**. Matches Raidbots on 172,740 of 172,742 items that both resolve | Re-run a script with `?build=<SimC client_data_version>`. The same trigger as the **SimC Update** | Blizzard client data, the same basis SimC's own extracted tables use. wago.tools publishes no terms | ~25 MB CSV input. Output **5.3 MB JSON / 0.72 MB gzip** (equippable). 7.8 MB / 1.24 MB for all items |
| Raidbots `icon-lookup.json` | Download one file | 175,061 items (all classes) | Raidbots regenerates it per build | **No published terms**. Undocumented internal bucket | 23.9 MB (includes spells) |
| Raidbots `equippable-items.json` | Download, keep `id` and `icon` | 110,452 items | Same as above | Same as above | 53 MB |
| Blizzard Game Data API `/data/wow/media/item/{id}` | One call per item, OAuth | Items the API exposes | Re-pull. **30-day TTL is mandatory** | 36k calls/h, **max 30-day storage**, attribution | ~140k calls, about 4 h at the rate limit |
| Wowhead `nether.wowhead.com/tooltip/item/{id}` | One call per item | Very good | Same day | **ToS forbids automated access** except as documented | n/a |

**Recommendation.** Build the map ourselves from **client DB2 tables**: `Item.IconFileDataID`, with a fallback through `ItemModifiedAppearance` to `ItemAppearance.DefaultIconFileDataID`, resolved to a file name by `ManifestInterfaceData`. Pin the build to the one SimC was generated from. Run the script in the **SimC Update** flow (or at image build) and write a ~0.7 MB gzip `item-icons.json`. Load images from `wow.zamimg.com` first and `render.worldofwarcraft.com` second, and cache them locally. Neither the Blizzard API (30-day TTL rules out a one-time pull) nor Wowhead (ToS) fits. Raidbots gives identical data but has no contract. Keep it only as a manual cross-check.

## 1. Client DB2 tables (via wago.tools, or directly from Blizzard's CDN)

**The chain.** It was verified by downloading the four tables for build 12.1.5.69952 (the wago.tools default, which is the newest build) and joining them:

1. `Item.csv` has columns `ID, ClassID, SubclassID, …, IconFileDataID, …` (213,908 rows, 9.1 MB). Source: `https://wago.tools/db2/Item/csv`.
2. `IconFileDataID` is 0 for 59,909 items, including 59,529 armor/weapons: modern gear gets its icon from its *appearance*. For those items the chain is `ItemModifiedAppearance.csv` (`ItemID, ItemAppearanceModifierID, ItemAppearanceID, OrderIndex`, 4.4 MB) to `ItemAppearance.csv` (`DefaultIconFileDataID`, 2.1 MB). The fallback resolved 58,919 items.
3. `ManifestInterfaceData.csv` (`ID, FilePath, FileName`, 142,872 rows, 9.4 MB; 33,079 rows under `Interface\Icons\`) maps the FileDataID to `Interface\Icons\INV_Chest_Samurai.blp`. The icon name is the lower-cased file name without `.blp`, with spaces turned into `_`. That last rule is what the CDNs and Raidbots use: before it was applied, 1,781 of the 1,783 mismatches were spaces, such as `warlock_ healthstone` versus `warlock__healthstone`.

**Coverage (measured).**
- 139,968 of 140,756 armor/weapon items resolve (99.4 %).
- Against Raidbots `icon-lookup.json` (175,061 items): **172,740 agree, 2 disagree** (271133 and 271135, both Midnight-era items where the two sources pick different appearances), and 2,319 are unresolved on our side. Of those 2,319, 2,126 are class 20 (housing decor) and 144 are armor/weapons.
- The unresolved ones are almost all **encrypted/unreleased** icon files that ManifestInterfaceData does not list yet, such as `inv_encrypted05`. The community listfile ([wowdev/wow-listfile](https://github.com/wowdev/wow-listfile), releases updated daily, last 2026-09-27, 153 MB CSV, **no licence declared** in repo metadata) resolves 2,144 of those 2,146 FileDataIDs. The listfile is optional. It only matters for items that are not live yet, and the CDNs usually don't serve those icons anyway.
- The map covers what SimC covers (SimC keeps all armor and weapons; see item-display-data.md §1) and more.

**Per-difficulty icons (a caveat for our data model).** 2,659 equippable items, 388 of them with id ≥ 235000, have **different icons per `ItemAppearanceModifierID`**. Tier pieces are an example: item 236772 has modifier 9-12, 13-16, 17-20, 21-24, 25-28 and 29-32, each mapping to a different icon. Bonus ids select the modifier, so a strictly correct map is keyed by `(itemId, appearanceModId)`. A per-item-id map (which is all Raidbots' `icon-lookup.json` offers too) shows one variant's icon. That is acceptable for v1, but it is an open question.

**Refresh.** wago.tools serves any build: `https://wago.tools/db2/Item/csv?build=12.1.0.69933` returns `Item.12.1.0.69933.csv`, and `https://wago.tools/api/builds/latest` lists the current `wow` build (12.1.0.69933, created 2026-09-22). The unpinned default is the newest build (12.1.5.69952 here), which can run ahead of live, so **always pin to SimC's `client_data_version`**. The whole refresh is 4 HTTP GETs plus a join, which took under a minute in Python.

**No-third-party variant.** SimC's own `casc_extract/casc_extract.py` has `--cdn` ("Fetch data from Blizzard CDN") and `--mode extract` ([source @ midnight](https://github.com/simulationcraft/simc/blob/midnight/casc_extract/casc_extract.py)). This is how SimC produces its tables. It could fetch the same four DB2 files straight from Blizzard, parsed with `dbc_extract3` or a WoWDBDefs-based reader. That removes the wago.tools dependency but makes the build heavier. Keep it as a fallback if wago.tools goes away.

**Terms.**
- wago.tools shows no terms, API policy or rate limit (homepage checked 2026-09-28).
- The data is Blizzard client data. The Blizzard EULA §1.C.vi forbids "unauthorized process or software that intercepts, collects, reads, or 'mines' information generated or stored by the Platform", and §2.A reserves the content ([EULA](https://www.blizzard.com/en-us/legal/fba4d00f-c7e4-4883-b8b9-1b4500a402ea/blizzard-end-user-license-agreement)).
- In practice the whole sim ecosystem runs on the same extracted data: SimC's `engine/dbc/generated/*` (GPL repo), Raidbots, Wowhead. Our risk is exactly the one we already take by shipping SimC.
- We would ship a derived id-to-name map (strings), not Blizzard art. Icons are hot-linked from the CDNs and cached locally for a single user.
- Not legal advice. It is "as legal as SimC itself", which is the bar the project already accepts.

**Size.** The output for equippables only is `{"188839":"inv_cloth_raidmageprogenitor_d_01_chest",…}`: 5.3 MB raw, 0.72 MB gzip. For all 211k items it is 7.8 MB raw, 1.24 MB gzip. 25,674 distinct icon names. A `(itemId, modId)` map would be modestly larger.

## 2. Raidbots static data

- `https://www.raidbots.com/static/data/live/icon-lookup.json` (23.9 MB) is `{spell: {…408,543}, item: {…175,061}, currency: {…602}}` and maps id to icon name. `equippable-items.json` (53 MB, 110,452 items) has an `icon` field per item (see item-display-data.md §2).
- The data matches ours (see §1), which confirms that Raidbots derives it from the same DB2 chain.
- Terms: none published (`/terms`, `/tos`, `/legal` return 404). It is an undocumented bucket, so shape and availability can change without notice, and bundling it redistributes a third party's build artefact. Fine as a one-off test oracle, not as a runtime or build dependency.

## 3. Blizzard Game Data API (media endpoint)

- `GET /data/wow/media/item/{itemId}` (namespace `static-{region}`) returns `assets[{key:"icon", value:"https://render.worldofwarcraft.com/…/{icon}.jpg"}]`. It needs an OAuth client-credentials app.
- The [Blizzard Developer API Terms](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use) cap usage at 36,000 calls/hour and require "a maximum 30-day TTL" on stored data. A **one-time pull is therefore not permitted**: we would have to re-pull ~140k items monthly (about 4 h at the cap) and require every user to register an API client. It is disqualified for an offline, portable image.
- Useful as a lazy per-item fallback when online, if a user has credentials. Not needed.

## 4. Wowhead tooltip data

- `nether.wowhead.com/tooltip/item/{id}` returns `icon` (item-display-data.md §3). It is undocumented. Fanbyte's terms forbid access via "spiders, robots, crawlers, data mining tools" and allow APIs only "in the manner described by any accompanying documentation" ([terms](https://corp.fanbyte.com/legal/terms)). A bulk pull is not allowed.
- The **embed script** (the documented use) renders icons client-side when online. It is a fine optional add-on, but it is not an offline mapping.

## 5. Image CDNs (checked 2026-09-28)

| Icon | render.worldofwarcraft.com/us/icons/56 | wow.zamimg.com/images/wow/icons/large |
|---|---|---|
| `inv_cloth_raidmageprogenitor_d_01_chest` | 200 (3.0 KB) | 200 (2.3 KB) |
| `inv_12_trinket_raid_voidspire_int1_voiddragoneye` | 200 | 200 |
| `inv_cape_special_amanitusk_d_01_ulatek` (item 284057, new) | **403** | 200 |

Blizzard's render CDN lags behind for brand-new icons, while zamimg has them. So try zamimg first, fall back to render, then to a quality-coloured placeholder. Cache fetched images on disk: icons are about 2-3 KB each, so even all 25,674 would be about 70 MB.

## Recommendation

1. Add a `scripts/build-item-icons.ts` (Bun) that downloads `Item`, `ItemModifiedAppearance`, `ItemAppearance` and `ManifestInterfaceData` CSVs from wago.tools with `?build=<SimC client_data_version>`, joins them as in §1, and writes `data/item-icons.json` (equippable items + gems + consumables SimC knows; about 0.7 MB gzip).
2. Run it as part of the **SimC Update** flow so icons, stats and ilvls always come from the same build. Commit or bake the output into the Docker image so runtime is fully offline.
3. Serve images via a small backend proxy/cache: zamimg, then render.worldofwarcraft.com, then a placeholder.
4. Keep Raidbots `icon-lookup.json` only as a manual diff check in the script's test (expect ≥ 99.9 % agreement).

## Open questions surfaced

- **Per-appearance icons.** Should the map be keyed by `(itemId, ItemAppearanceModifierID)` so tier and raid items show the difficulty-correct icon? That requires resolving the appearance modifier from bonus ids, which SimC does (item bonus type "appearance modifier") but does not report in `json2`. We need to check whether SimC exposes it or whether we map bonus ids to modIds ourselves from `ItemBonus`.
- **Which item classes go in the map.** Equippables only, or also gems, enchants and consumables shown in the UI? This affects size only slightly.
- **wago.tools dependency.** It is an unofficial community service with no stated terms or SLA. Do we accept it, or invest in `casc_extract --cdn` directly against Blizzard's CDN?
- **Image caching and redistribution.** Is on-disk caching of CDN icons for one user acceptable, versus always hot-linking? We must not bake icon images into the public image.
