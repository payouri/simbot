<!-- Owner: payouri. Last audited 2026-09-30 against payouri/agentic-research agentsMd/rulebook.md. -->
# simbot

## Read these before the matching work

- `CONTEXT.md`: the domain glossary. Read it before naming anything in code, issues or commits. Terms like **Top Gear** and **Addon String** have fixed meanings, and each lists synonyms to avoid.
- `PRODUCT.md`: users, purpose, positioning and the decided stack. Read it before any product, scope or stack decision. v1 has one user and no auth.
- `DESIGN.md`: the visual system (colour tokens, type, components). Read it before touching UI in `apps/client`. Its tokens are the source of truth for colour and type.

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

## Where work goes

- UI screens: `apps/client/src/<feature>/`. `src/prototype/` is the mock-data Paperdoll prototype, not the real UI (#47). Don't build on it.
- HTTP routes: `apps/server/src/http/`. Job execution (Sims and SimC Updates share one FIFO `jobs` table): `apps/server/src/runner/`. SQLite: `apps/server/src/db/`.
- SimC Build install, updates, item-meta and the Import item index: `apps/server/src/simc/`.
- Pure SimC logic (Addon String and progress parsing, Combinations, Smart Sim Stages and Cull, json2 reading): `packages/simc/`.
- API contracts (zod schemas the server and client both parse through): `packages/shared/`.

## Gotchas

- Migrations in `apps/server/src/db/migrations.ts` are append-only. Each runs once and is recorded in `schema_migrations`, so an edited or reordered migration never re-runs on an existing `/data`. Add a new one instead.
- Import boundaries are enforced by Biome `noRestrictedImports` overrides in `biome.json`, tested in `tests/boundaries.test.ts`: `http` and `runner` never import each other, `packages/simc` has no DB or HTTP code, and `packages/shared` imports only zod.
- `createApp` (`apps/server/src/app.ts`) never touches the network or the real SimC. Network goes through the injected `fetch`, and tests pass a fake `simc` that replays recorded runs from `apps/server/test/fixtures/<flow>/<scenario>/`. Keep new network or SimC calls behind those seams, or the gate starts hitting Docker Hub.
- Some fixtures are hand-written, not recorded. `packages/simc/src/fixtures/progress/README.md` says which. Don't treat a hand-written fixture as evidence of SimC's real output.
- The threading and precision defaults and the estimate's `DEFAULT_COST_MODEL` are unmeasured placeholders until #45. Don't quote them as benchmarks. #30's numbers were made up and had to be deleted.

## Verification gate

- `bun test <path>`: one test file while iterating.
- `bun run check`: Biome (lint, format, import boundaries), tsc for every package, and `bun test`. Run it before calling any change done.
- A green `bun run check` has never run SimC. `bun run test:simc` runs the real-SimC tests against a SimC Build in `SIMBOT_DATA_DIR`, and the Docker build needs Docker. Run them when you change what goes to or comes back from SimC.
- `.githooks/test-pre-push.sh`: run it after changing anything in `.githooks/`.
