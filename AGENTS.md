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
- Import boundaries (`http` and `runner` never import each other, `simc` has no DB or HTTP, `shared` only zod) are Biome `noRestrictedImports` overrides in `biome.json`, covered by `tests/boundaries.test.ts`.

## Verification gate

- `bun run check`: Biome (lint, format, import boundaries), tsc for every package, and `bun test`. Run it before calling any change done.
- `.githooks/test-pre-push.sh`: run it after changing anything in `.githooks/`.
