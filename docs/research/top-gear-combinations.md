# How Top Gear builds and prunes gear combinations

Research for issue #3. Question: how do Raidbots Top Gear and SimC's own profileset features turn a set of candidate items into combinations? That covers slot rules, the combination cap, and Smart Sim staging. The goal is enough detail to rebuild the behaviour.

Researched 2026-09-28.

## Sources and how much to trust them

| Tag | Source | Trust |
|---|---|---|
| **[RB-JS]** | Raidbots' production frontend bundle, fetched 2026-09-28: `https://www.raidbots.com/frontend/simbot.3c9ecffcefe095b8013a.js` plus its webpack chunks, mainly `875.*.js` (combination generator, SimC input writer) and `602.*.js` (Top Gear form). It is minified, so the notes below paraphrase the code. Variable names are the minifier's. | Highest. This is the code that builds the combinations in the browser. It will drift when Raidbots redeploys. |
| **[RB-SUP]** | Raidbots support articles: [55 Smart Sim](https://support.raidbots.com/article/55-smart-sim), [61 Top Gear Sidegrades](https://support.raidbots.com/article/61-top-gear-sidegrades), [64 Gem/enchant sims](https://support.raidbots.com/article/64-why-do-gem-enchant-sims-take-so-long), [23 Double on-use trinkets](https://support.raidbots.com/article/23-how-do-sims-handle-double-on-use-trinkets), [63 SwiftSim](https://support.raidbots.com/article/63-swift-sim), [42 Talent tree size](https://support.raidbots.com/article/42-talent-tree-combination-size) | High (first party), but written in prose |
| **[RB-BLOG]** | Seriallos (Raidbots author) on Medium: [Smart Sim (2018)](https://medium.com/raidbots/smart-sim-2b54952aba44), [Smart Sim Is Ready!](https://medium.com/raidbots/smart-sim-is-ready-ecb12c07bcf0), [Top Gear: Find Your Best Combination (2017)](https://medium.com/raidbots/top-gear-find-your-best-combination-7c5a2443718a). Read through web.archive.org because Medium returns 403. | First party, but some of it is old |
| **[RB-ISS]** | Owner replies in [seriallos/raidbots-issues](https://github.com/seriallos/raidbots-issues): #332 (vault), #446 (tier sets with vault), #396 (gem rules), #414 (stage counts) | First party, each about one case |
| **[SIMC]** | SimC source at `simulationcraft/simc@4c7c7362` (branch `midnight`, 2026-09-27): `engine/sim/profileset.cpp`, `profileset_control.{hpp,cpp}`, `sim.cpp`, `sim.hpp`. Also the [ProfileSet wiki page](https://github.com/simulationcraft/simc/wiki/ProfileSet). | Highest for anything SimC does |
| **[ASC]** | [AutoSimC](https://github.com/SimCMinMax/AutoSimC) @ `d4e0df35` (2021-10-12): `settings.py`, `splitter.py`, `permutation.py`, `profile.py`. Raidbots says its Smart Sim copies AutoSimC's approach and defaults [RB-BLOG]. | Open-source reimplementation; secondary but exact |

**What is not public:** the staging runs on Raidbots' servers (the "Flightmaster" service [RB-BLOG]). The rule that decides how many combinations survive each stage is not in the frontend or any first-party article. The frontend config does expose the server-side constants (see §3.2), but the survivor formula below comes from AutoSimC, which Raidbots says it copied. It is a well-grounded inference, not a confirmed Raidbots fact.

---

## 1. Combination generation (Raidbots Top Gear)

The browser builds every combination [RB-JS, `875` module 311, function `ln` then `_n`]. The server only receives the finished SimC input.

### 1.1 Candidate lists per slot

- Candidates are grouped per slot: `head, neck, shoulder, back, chest, wrist, hands, waist, legs, feet`, then `rings`, `trinkets`, `main_hand`, `off_hand`.
- **Enchant expansion:** if the user picked enchants for a slot, each candidate item is multiplied by each chosen enchant that fits it. An item that already has an enchant is left alone unless "replace existing" is on.
- **Hard requirements** (otherwise zero combinations): every slot except `off_hand` needs at least one candidate, `rings` needs at least 2 and `trinkets` needs at least 2. The error text is "Top Gear requires all items/slots filled… check for a 1-hand main hand without an offhand" ([raidbots-issues #199](https://github.com/seriallos/raidbots-issues/issues/199)).

### 1.2 Rings and trinkets: unordered pairs

- Rings: every 2-combination (n choose 2) of the ring candidates. A pair whose two entries are the same physical item (same `guid`) is dropped [RB-JS: `new Combination(R.rings, 2)` filtered on `t.guid === r.guid`]. The combinatorics class computes `nCr`; its `length = o(n, k)`.
- Trinkets: every 2-combination the same way. For a pair where **both trinkets are on-use**, the code also adds the **reversed order** (trinket1 and trinket2 swapped). Support article 23 explains why: the trinket in slot 1 is used first, and slot order can change DPS. In the current code the swap is guarded by `!M`, where `M = find(trinkets, {equipped: true})`. So the swapped variants appear only under that condition. I could not fully resolve the condition from minified code. Treat this as "on-use pairs get both orders".
- The same item *id* cannot appear twice (unique-equipped, §1.4). Two different copies of a non-unique ring are allowed.

### 1.3 Weapons: (main hand, off hand or none) pairs

Build the Cartesian product `main_hand × (off_hand ∪ {null})`, then drop a pair if any of these holds [RB-JS lines around `A.dualWield`, `A.dualWield2h`]:

| Rejected when | Meaning |
|---|---|
| MH and OH are the same `guid` | Same physical weapon in both hands |
| MH is not 2H, the spec is `dualWield`, and OH is none | Dual-wield specs must fill the off hand with a 1H |
| MH is 2H, OH is present, and the spec is not `dualWield2h` | Only Fury (Titan's Grip) pairs 2H with an off hand |
| The spec is `dualWield2h` and OH is none | Fury always dual-wields |
| MH hand type is `mh` or `1h` and OH is none | Any 1H needs an off hand (a weapon, shield or held-in-off-hand item) |
| Either weapon is quality 6 (artifact) and the qualities differ | Legion artifact pairing (legacy) |

Spec flags come from the Raidbots spec table. `dualWield: true` is set for Frost DK, Havoc/Vengeance/Devourer DH, Survival, Brewmaster, Windwalker, all three Rogue specs, Enhancement and Fury. Only Fury has `dualWield2h: true`. A 2H with no off hand is always allowed for non-Fury specs, including dual-wield specs such as Frost DK and Survival. The hand type (`2h`/`mh`/`oh`/`1h`) comes from the item's class/subclass and inventory type.

AutoSimC's equivalent rules are cruder [ASC `profile.py valid_weapons`]: off-hand types are banned from the MH, bows and guns are for hunter/rogue/warrior only, and a 2H takes an OH only for Fury.

### 1.4 Constraint filter applied while walking the product

The product of all slot lists (with rings, trinkets and weapons each counted as one "slot" of pairs, plus optional talent and consumable dimensions) is walked depth-first. Slots are ordered **smallest list first** (`sortStrategy "size-asc"`). A branch is cut as soon as it breaks a constraint. The constraints carry forward as running sets and counters [RB-JS, recursive `h()` inside `ln`]:

1. **Custom item limits** (`customItemLimits`, from `nn()`):
   - **Great Vault:** an item tagged `weekly_reward` counts toward category `weekly_reward` with quantity 1. So **at most one vault item per combination**, because you can only take one vault reward ([RB-ISS #332](https://github.com/seriallos/raidbots-issues/issues/332)).
   - **Catalyst:** an item tagged `catalyst` counts toward category `catalyst`, capped at the user's "catalyst charges" setting.
2. **Unique-equipped:** an item flagged `uniqueEquipped` cannot appear twice by item id. This mostly matters for rings and trinkets.
3. **Item limit categories** (`itemLimit: {category, quantity}`): this is WoW's ItemLimitCategory, taken from item data. **Embellishments work through this mechanism**: an embellishment carries an `itemLimit`, and applying one to a crafted item copies it onto the item (`replaceEmbellishment` sets `itemLimit: i.itemLimit`). The quantity comes from game data that Raidbots loads at runtime, not from the bundle. In-game, embellishments are capped at 2; that figure is general game knowledge and was not verified in these sources. Named unique-equipped groups work the same way, for example Dragonflight tinkers with `itemLimit {category: 569, quantity: 1}`. The UI hint reads "Select alternate items in other slots that share the Unique-Equipped of this item".
4. **Unique gems:** a gem with a `unique` group may appear only once per combination. This check is skipped when a flag (`c`) is set, apparently "gems already handled".
5. **Upgrade budget:** if the user priced upgrades, the running cost per currency must stay within the budget. An alternate currency is allowed as a fallback.

After the walk, `_n()` turns each surviving raw combination into gear. It applies extra rules:

6. **Item set (tier) minimums:** the user can require N pieces of an item set (the "Item Sets" panel). A combination is dropped unless `count[itemSetId] >= required` for every required set [RB-JS `_e()(p, … (c[n]||0) < e && (y = !1))`]. With vault items this can leave very few valid sets ([RB-ISS #446](https://github.com/seriallos/raidbots-issues/issues/446)). Separately, SimC has an in-engine tier guard (§2.3).
7. **Locked ring or locked trinket:** if the user locked a specific ring or trinket, a combination without it is dropped.
8. **Gem filling:** open or replaceable sockets are filled from the chosen gems. Since Dragonflight the rule is **one type of each gem kind**: for example one prismatic gem type plus a single secondary gem type repeated, not every mix ([RB-ISS #396](https://github.com/seriallos/raidbots-issues/issues/396)). An optional "Only Max Colors" rule applies to the current colour-gem system.
9. **Deduplication:** each final set gets a key. The key joins the chosen index per slot, each enchant, the sorted gem list, the summed stats from prismatic gems and ring enchants, the talents, the consumables and "omnium" talents. Duplicate keys are dropped (`setKey` counter). Combinations that differ only in which of two identical ring enchants is on which finger collapse to one.

**The equipped set is always Combination 1.** It goes through the same builder with constraint checks off (`le(ce, !0)`). So the currently worn gear is always simmed and becomes the profileset **baseline** (§2.1).

### 1.5 Other dimensions multiplied in

- **Talent loadouts:** each selected loadout is one more dimension. A loadout with "generate combos" expands into talent combinations up to `maxCombinations`.
- **Consumables:** each consumable type with more than one choice adds a dimension.

### 1.6 Caps

From the site config object `optimize` in [RB-JS] `simbot.js`:

```
optimize: { maxRawCombinations: 200000, maxCombinations: 10000, maxCombinationsDownload: 10000,
            maxTotalCombinations: 10000, smartThreshold: 2000000, maxWalkPartials: 5000000,
            maxContaminants: 9,
            maxEnhancements: { main_hand: 9, off_hand: 9, head: 1, shoulder: 1, back: 4, chest: 4,
                               bracer: 4, glove: 4, legs: 4, feet: 1, finger: 5, wrist: 4, hands: 4, socket: 13 } }
```

- The DFS stops ("Too many combinations") after **200,000 raw leaves** or **5,000,000 explored partials**.
- More than **10,000** combinations after filtering and dedupe is also "too many".
- `maxEnhancements` caps how many gems or enchants can be chosen per slot.
- **Iteration budget**, the cap users actually hit: `iterations = numCombinations × costPerCombo`. With Smart Sim, `costPerCombo = 5000` (`A = e => isSmart(e) ? 5e3 : e`, also stated in [RB-SUP 55]). The UI shows "Iterations: X / LIMIT (N combinations)" and errors past the limit. Non-Smart runs above `smartThreshold` = 2,000,000 iterations are rejected ("Very large sims must use Smart Sim").
- Per-tier `iterationsLimit`: default/registered 300,000 (60 combos), uncommon/rare 1,800,000 (360), heirloom 5,000,000 (1,000), epic/legendary 15,000,000 (3,000), theorycrafter/simcdev 16,000,000, artifact 32,000,000. A self-hosted single user has no reason to copy the tiers. Keep a hard combo cap, such as the 10k or 200k-raw guard, so the UI does not hang.

### 1.7 Emitted SimC input

[RB-JS `formInputToData`, `"profileset"` mode]:

- Combo 1 (the equipped set) is written as the normal actor: every slot as `slot=…`, plus `talents=`.
- Every other combo is `profileset."Combo N"+=slot=…` for **all 16 slots**, not only the changed ones (`slot=,` for an empty slot), plus `talents=` and consumables.
- Global options add `target_error=` (see §3.2) and, if set, `profileset_metric=`.

---

## 2. What SimC itself provides

### 2.1 Profilesets

[SIMC `profileset.cpp`, wiki]:

- `profileset."Name"=opt` / `+=opt` overrides options on top of **one** baseline actor. Names must be unique and cannot contain `.`.
- `profileset_metric=` (default `dps`) chooses what is collected. Each result stores `min, first_quartile, median, mean, third_quartile, max, stddev, mean_stddev, iterations` (JSON report `profilesets.results[]` includes `mean_stddev`).
- `profileset_work_threads=N` runs `floor(threads / N)` profilesets in parallel, each on N threads. `profileset_init_threads` sets init parallelism. Detailed reporting is off for profilesets (`report_details=0` is forced).
- Each profileset is a child sim. Per-set options such as `target_error` or `iterations` are allowed.

### 2.2 target_error semantics

[SIMC `sim.cpp analyze_error`, `sim.hpp`]:

- `mean_error = confidence_estimator × mean_std_dev`, with `confidence = 0.95`, so the estimator is z = 1.96. `target_error` is a **percentage**: `current_error = 100 × mean_error / mean`, taking the worst actor.
- The error is checked every `analyze_error_interval` iterations (default 100). The sim stops as soon as `current_error < target_error`. Otherwise it projects `n × (current/target)²` iterations. With no `iterations` given, the cap is 1,000,000 and the default `target_error` is 0.2 (0.05 with scale factors).
- So the "DPS-Error" / `1.96 × mean_std_dev` value is the **half-width of a 95% CI**. The Raidbots report computes the same thing (`error = 1.96 * mean_std_dev; percent = error / mean`) [RB-JS].

### 2.3 Profileset controllers (in-engine pruning)

[SIMC `profileset_control.*`]:

- The option is `profileset_controller.<key>=opt=v,opt=v`. Controllers run at `POST_INIT` or `POST_ITER` and can cancel a profileset. Cancellations are reported under `profileset_controller.cancelled_profilesets` in JSON.
- The only registered generic controller is `set_bonus_enabled` (`tier=<name>,pc=<n>,player=<name>`). It cancels any profileset whose player lacks that set bonus after init. It is a cheap engine-side tier-count guard, useful when set counting is hard to do client-side. The Monk module has a class-specific `valid_talents` controller.
- **SimC has no multi-stage or survivor logic.** The staging lives entirely in the wrapper (Raidbots Flightmaster, AutoSimC).

---

## 3. Smart Sim staging

### 3.1 What Raidbots states

[RB-SUP 55, RB-BLOG]:

- Smart Sim runs "a series of sims — initially … very fast but low precision sims, then … choose the winners from that round, increase the precision, and run another round".
- Stated ladder: **3 stages at 1%, 0.2%, 0.05%** target error, "the same default behavior of AutoSimc". The first round "can often eliminate 95% or more" of sets. Low-precision rounds need about 100–200 iterations each.
- Non-Top-Gear sims under Smart Sim run a single stage at 0.05%.
- Report sidegrades are results within `2 × error` of the top result, about 0.1% at 0.05% precision [RB-SUP 61].
- Stage progress in the UI is labelled "Low Precision / Medium Precision / High Precision" [RB-JS `857`].
- Real example: 136 combos in stage 1, then 128 in stage 2, then 37 in stage 3 ([RB-ISS #414](https://github.com/seriallos/raidbots-issues/issues/414)). Gear sets that sit close together barely cull at 1%.

### 3.2 What the shipped config says now

[RB-JS `simbot.js`, `flightmaster` block, production values; the `l.x5` flag selects dev values and also selects the Stripe test key]:

```
flightmaster: { multistageThreshold: 4, highPrecision: 0.05, lowPrecision: 0.1,
                multiPrecisionDefault: [1, 0.2, 0.05], multiPrecisionFast: [1, 0.3, 0.1],
                errorThreshold: 2.5, equippedAnchorMaxProfilesets: 100,
                chunkSizes: [8, 32, 256], psetWorkThreadThreshold: 0.5, psetWorkThreadAmount: 2,
                psetAnalyzeErrorInterval: 50, largeProfilesetCount: 250, … }
```

and in the SimC input writer: `target_error = isSmart ? (highPrecisionChecked ? highPrecision : lowPrecision) : (iterations > 25000 ? highPrecision : 0)`.

How I read these (only the fact that they are shipped is certain, not their exact semantics):

- **Two stage ladders.** The default Smart Sim final precision is now **0.1%** (`lowPrecision`) with stages **1% → 0.3% → 0.1%**. The UI checkbox "High Precision (2x more precise, 4x slower)" (`smartHighPrecision`) switches to **1% → 0.2% → 0.05%**, the ladder the support article documents. This matches `input.txt` carrying `target_error=0.1` or `0.05`.
- `multistageThreshold: 4`: Smart Sim staging only applies above 4 combinations. SwiftSim uses the same "more than 4 combinations" cut-off [RB-SUP 63]. Smaller sims run one stage at final precision.
- `errorThreshold: 2.5` is most likely the survivor-band width (see §3.3). **Unconfirmed.**
- `equippedAnchorMaxProfilesets: 100` and the report's `cullAnchor` suggest that the equipped set is carried through stages as an anchor for comparison when the run is at most 100 profilesets. **Unconfirmed.**
- `psetAnalyzeErrorInterval: 50` is `analyze_error_interval` for profilesets, so low-precision stages can stop sooner. AutoSimC uses 10 when target_error > 0.1. `psetWorkThreadThreshold 0.5 / psetWorkThreadAmount 2` presumably means `profileset_work_threads=2` for loose-precision stages. `chunkSizes [8, 32, 256]` is how profilesets are split across worker machines, which is irrelevant for one machine.

### 3.3 Survivor rule (AutoSimC, reproducible)

[ASC `splitter.py _filter_by_target_error`, `settings.py`]:

```
sort results by metric, descending; best = results[0]
keep r  iff  best.mean - r.mean  <  sqrt(r.err² + best.err²) × (multiplier / 1.96)
   where err = SimC "DPS-Error" = 1.96 × mean_stddev  (95% CI half-width)
   multiplier default 1.96  → factor 1  (a 95% two-sided test on the difference)
if fewer than 3 results, keep all
```

- Defaults: `num_stages = 3`, `default_target_error = {1: 1.0, 2: 0.2, 3: 0.05}`, `default_error_rate_multiplier = 1.96` (use 2.58 for 99%). `default_grabbing_method = "target_error"`. The `top_n` alternative (`{-1: 1, -2: 100, -3: 1000}`) is "no longer recommended".
- Each stage re-sims **only the survivors** from scratch at the tighter `target_error`. AutoSimC adds `analyze_error_interval=10` when `target_error > 0.1`.
- AutoSimC always keeps the baseline profile.
- The number of survivors per stage is **not fixed**. It depends on how many combinations fall inside the statistical band of the leader. That is why gem and enchant sims (0.1–0.5% differences) keep far more combinations [RB-SUP 64].

If Raidbots' `errorThreshold: 2.5` is the multiplier in the same formula, its band is somewhat wider (2.5/1.96 ≈ 1.28× AutoSimC's), which is more conservative.

---

## 4. Recipe to reproduce (recommended for simbot)

1. **Candidate lists per slot** from the Addon String (equipped, bags, vault). Tag vault items (`weekly_reward`). Carry `uniqueEquipped`, `itemLimit {category, quantity}` (embellishments included), `itemSetId` and hand type for every item. These must come from item data; see the item-data research ticket.
2. **Pairs:** rings and trinkets as n choose 2, excluding the same physical item and the same unique id. Add the reversed order for on-use + on-use trinket pairs. Weapons as `MH × (OH ∪ ∅)` filtered by the §1.3 table.
3. **DFS over the product, smallest slot first.** Prune on vault ≤ 1, unique-equipped id sets, item-limit category counts (embellishments: the category quantity, 2 in game), unique gems and catalyst charges. Then apply the tier-set minimums, gems and dedupe by key. Abort past a raw cap (Raidbots uses 200k raw and 10k final).
4. **Combo 1 = equipped set** (unconstrained) as the SimC baseline actor. Every other combo is a `profileset."Combo N"+=` line for every slot. Optionally add `profileset_controller.set_bonus_enabled=…` as an engine-side tier guard.
5. **Stages:** if there are 4 or fewer combos, run once at final precision. Otherwise use the ladder `[1.0, 0.2, 0.05]` (or the faster `[1.0, 0.3, 0.1]`). After each stage keep `best − x < k·sqrt(err_x² + err_best²)` with k = 1 (AutoSimC) to 1.28 (Raidbots' 2.5 threshold if the guess is right). Always keep the equipped combo. Re-run the survivors at the next target_error.
6. **Parallelism on 16 threads:** `threads=16` with `profileset_work_threads=2` (8 parallel sets) for the loose stages and larger work-thread counts for the final stage. The best value needs measuring.
7. **Report:** flag sidegrades as results within `2 × error` of the top.

## 5. Open points / not verifiable from public sources

- The exact Flightmaster survivor formula, and whether `errorThreshold` is the band multiplier.
- Whether the equipped set is always forced through every stage ("anchor").
- The exact trigger for adding the reversed trinket order (the `!M` guard).
- Item-limit quantities and categories (embellishments are 2 in game) must come from game data (ItemLimitCategory), not be hard-coded. The Raidbots embellishment table is loaded at runtime and was not inspected.
