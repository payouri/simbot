<!-- Owner: payouri. Last audited 2026-09-30 against payouri/agentic-research agentsMd/rulebook.md. -->
# simbot

## Read these before the matching work

- `CONTEXT.md`: the domain glossary. Read it before naming anything in code, issues or commits. Terms like **Top Gear** and **Addon String** have fixed meanings, and each lists synonyms to avoid.
- `PRODUCT.md`: users, purpose, positioning and the decided stack. Read it before any product, scope or stack decision. v1 has one user and no auth.
- `DESIGN.md`: the visual system (colour tokens, type, components). Read it before touching UI in `apps/web`. Its tokens are the source of truth for colour and type.

## Generated files

- `DESIGN.md` and `.impeccable/design.json` are written together by the impeccable skill. Change them through `/impeccable`, not by hand, so the sidecar stays in sync with the prose.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `payouri/simbot`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Git

<!-- Authority for linear history is .githooks/pre-push. This prose repeats it so any harness knows why a push is refused. GitHub can't enforce it server-side on a private free-plan repo, so the hook and the PR merge setting are the only mechanisms. -->

- `main` has linear history. GitHub only allows rebase merges on PRs, and `.githooks/pre-push` refuses any push that adds a merge commit to `main`. To land a branch, rebase it onto `main` and fast-forward (`git merge --ff-only`).
- Never get past the hook with `--no-verify`, `-c core.hooksPath=…` or by editing `.githooks/`. If it refuses, rebase the merge commit away.
- Catch a branch up with `git rebase main`, not `git merge main`. A merge commit on the branch gets refused when the branch lands.

## Layout

- `apps/client`: React + Vite UI (the Paperdoll prototype lives in `src/prototype`).
- `apps/server`: one Bun process, split into `src/http`, `src/runner` and `src/db`. `src/app.ts` (`createApp`) is the server seam that tests drive.
- `packages/shared`: zod schemas and enums. Imports only zod.
- `packages/simc`: pure SimC library, no DB or HTTP code.
- `bun run dev` starts the server and the Vite client. `SIMBOT_DATA_DIR` sets the data dir (default `./data`).
- `apps/server/src/simc`: SimC Build fetch (Docker Hub registry HTTP API through an injected `fetch`), layer extraction into `<data>/simc/<tag>/` and the Current SimC Build. `createApp(config, { fetch })` does not touch the network; `main.ts` calls `app.boot()`, which installs the latest nightly when there is no Current SimC Build.
- `apps/server/test`: seam-1 tests drive `createApp` over REST with a fake `simc` (`fake-simc/fake-simc.ts`) that replays the recorded runs in `fixtures/<flow>/<scenario>/` (`stdout.txt`, `stderr.txt`, `json2.json.gz`, `exit`). `bun run test:simc` runs the same flow against a real SimC Build in `SIMBOT_DATA_DIR`; it is not part of the gate.
- `apps/server/src/simc/meta.ts` builds `<data>/meta/<tag>/item-meta.json` and `item-icons.json` for a SimC Build (SimC's `.inc` tables from GitHub at its `git_revision`, DB2 CSVs from wago.tools at its game data version, both through the injected `fetch`). The pure parsers, schemas and lookups (`appearanceModFor`, `iconFor`) are in `packages/simc/src/meta`. `boot()` builds them for the Current SimC Build when missing. Standalone: `bun run --cwd apps/server build-meta [tag]` and `verify-meta [tag]` (checks item-meta against that build's live simc).
- Live progress: the runner parses SimC's stdout with `packages/simc/src/progress.ts` and emits `sim.*` events on the EventBus (`sim.progress` throttled to about 4/s in `runner/throttle.ts`). `GET /api/events` is the one global SSE stream, opening with a `snapshot`; its union is `appEventSchema` in `packages/shared/src/events.ts`. `GET /api/queue` lists Jobs. `SIMBOT_DEBUG_LOGS=1` also sends SimC's non-progress stdout as `sim.log` at `debug`.
- SimC Update Jobs (`kind = 'simc_update'` in `jobs`, same FIFO as Sims): `POST /api/simc/jobs {target}` (`nightly`, `seed` or `installed <tag>`, resolved at Job start, one queued or running at a time), `PATCH /api/simc/settings {keep}`. `simc/manager.ts` `runJob` runs fetch into `.partial/`, Check Sim (`simc/check-sim.ts`), meta, commit (rename, switch, evict) and streams `simc.update_status`. Results per (build, Import) live in `check_sim_results`. `createApp` calls `simc.recover()` before the runner starts: `.partial` dirs go and a running SimC Job restarts from step 1. `seedDir` (with `seedTag`) is where the Seed SimC Build is copied from. Tests: `simc/update-job.test.ts`.
- Docker: `Dockerfile` (multi-stage: client build, `bake` stage lays out the Seed SimC Build from `COPY --from=simulationcraftorg/simc:<SIMC_TAG>` and runs `simc/bake-seed-cli.ts`) and `compose.yaml`. The image sets `SIMBOT_SEED_DIR=/app/seed` (`simc/<tag>/` with `build.json`, `meta/<tag>/`); `simc/seed.ts` `loadSeed` reads it in `main.ts`. `boot()` with no Current SimC Build installs the seed offline, then queues one nightly `simc_update` Job, once ever (`simc.first_update_queued`). Not run in the gate: it needs Docker.
- Item display: `POST /api/imports` runs one packed SimC pass (`packages/simc/src/item-pass.ts`, driven by `apps/server/src/simc/item-index.ts`) and stores the item index on the Import (`imports.item_index`, recomputed when the Current SimC Build changes). Unknown Items (item or bonus id missing from item-meta) never enter the pass and are recorded in the index. `GET /api/imports/:id/items` joins the index with item-meta and item-icons; `GET /api/icons/:name` (`src/icons.ts`) serves icons from `<data>/cache/icons/`, zamimg then Blizzard, else a quality-coloured SVG. Fixtures and the ilvl check: `apps/server/test/fixtures/import-items/README.md`; `bun run test:simc` also times the pass on a real build.
- Top Gear setup (`apps/client/src/setup`, route `/sims/:id/setup`; a Draft opened in `SimPage` redirects there): the Paperdoll of an Import's items, edited into the Draft's Top Gear Selection (`sims.top_gear_selection`, `topGearSelectionSchema`) and Sim Settings, autosaved by `PATCH /api/sims/:id` (`useDraftAutosave`, debounced, one request in flight). The PATCH also moves a Sim to another Character. Saving input is 409 `not_a_draft` outside Draft, and a selection that includes an unselectable item is 422 `invalid_selection`. `POST /api/sims {importId | copyFromSimId}` makes a Draft (a copy keeps the selection). SimC slots group into 13 Paperdoll slots in `packages/shared/src/paperdoll.ts`. Run queues the Draft only while no candidate is in play; Combination generation is a later step.
- Combinations: `packages/simc/src/combinations` is pure. `generateCombinations` walks the slot product smallest slot first, pruning on one Great Vault item, unique-equipped item ids, item-limit categories, unique gems, catalyst charges and upgrade budget; tier minimums, locks and the dedupe key apply after (locks by leaving the slot's Candidates out, which gives the same result). Rings and trinkets are unordered pairs (both orders for on-use + on-use trinkets); weapons follow `weaponRulesFor(class, spec)`. Combination 1 is the equipped baseline, Talent Loadouts multiply the gear. `preselect` (vault first, then ilvl gain, at most 500) and `estimateSeconds` (provisional 3-stage ladder over a `CostModel` measured by the Check Sim: `check_sim_results.duration_ms`/`iterations`, else `DEFAULT_COST_MODEL`) live beside it. `apps/server/src/combinations.ts` feeds it from the Import's items and item-meta: `POST /api/sims/:id/preview-combinations` (body may carry unsaved edits) returns count, issues and estimate; `POST /api/sims/:id/preselect` applies the default preselection once; `POST /api/sims/:id/queue` re-generates, answers 422 `invalid_combinations` with per-Candidate issues (also above 50,000, `MAX_COMBINATIONS`), and freezes the Combinations plus `sims.frozen_simc_tag`. At Job start the runner re-validates them (`revalidate`) when the Current SimC Build is not that tag. No item data marks unique gems, catalyst or upgrade costs yet, so the server passes none and those pruning rules are exercised by the pure tests only.
- Import boundaries (`http` and `runner` never import each other, `simc` has no DB or HTTP, `shared` only zod) are Biome `noRestrictedImports` overrides in `biome.json`, covered by `tests/boundaries.test.ts`.

## Verification gate

- `bun run check`: Biome (lint, format, import boundaries), tsc for every package, and `bun test`. Run it before calling any change done.
- `.githooks/test-pre-push.sh`: run it after changing anything in `.githooks/`.
