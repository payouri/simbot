<!-- Owner: payouri. Last audited 2026-09-29 against payouri/agentic-research agentsMd/rulebook.md. -->
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

## Verification gate

- `cd apps/web && bun run typecheck`: run it before calling any `apps/web` change done. It is the only check that exists today.
