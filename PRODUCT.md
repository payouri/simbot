# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Decided in the wayfinder map ([#1](https://github.com/payouri/simbot/issues/1)): a TypeScript pnpm-style monorepo with `apps/client` (React, Vite, shadcn/ui, Tailwind, TanStack Query, Zustand), `apps/server` (Bun, which runs `simc` as a child process) and `packages/shared`. Persistence is `bun:sqlite`. It ships as one portable Docker container.

## Users

- **Primary user: the owner.** A World of Warcraft (retail) player who sims their own characters. Today it runs on their own machine. Later it moves to their homelab.
- **Future users: possibly a few more people.** v1 has one user and no auth. Product decisions should not rule out more users later, but multi-user hosting and auth are out of scope for now.
- **Job:** decide what gear to wear or upgrade. The main flow is: paste an Addon String, pick candidate items, choose settings, run the sim, read the ranked results against the equipped set, and act on them in game.

## Product Purpose

simbot is a self-hosted gear simulator in the style of Raidbots, built on SimC. It offers two sim types:

- **Quick Sim:** sims the character exactly as the Addon String describes it.
- **Top Gear:** generates many gear combinations from the Addon String's items, sims them in stages, and ranks them.

Success means the owner gets a trustworthy answer to "what should I wear?" faster and more clearly than on Raidbots. That answer should be kept, so it can be reopened and re-run later.

## Positioning

simbot copies Raidbots' workflow, not its look or branding. It aims to beat Raidbots on four things:

- **Capacity:** no paywall or per-user caps. The only limits come from the environment: one sim at a time using all threads (16 on the current machine) behind a small local FIFO queue, plus safety caps against runaway combination counts.
- **History and re-runs:** every Sim is stored with its frozen input and output. It can be reopened, copied into a new Draft, and re-run when gear or SimC changes.
- **Faster setup:** fewer steps from paste to results, with smart defaults for item picking and settings.
- **Clearer results:** it is obvious which gear wins, by how much compared to the equipped set, and whether the difference is within noise.

## Operating Context

- Mostly used on a desktop, alt-tabbed from the game. Typical moments are after a loot drop or on Great Vault day.
- Later, the user may check a sim's progress and results from a phone, with the app reached on the homelab.
- The input comes from the in-game SimulationCraft addon: the **Addon String** is copied in game and pasted into simbot.
- Live progress streams to the UI over SSE while SimC runs. Sims can be cancelled.
- A **SimC Update** (a new commit on SimC's active branch) is detected and shown as the running version vs the latest one. It is applied only when the user chooses, and never during a sim.

## Capabilities and Constraints

- Terminology comes from `CONTEXT.md`. Use SimC, Addon String, Quick Sim, Top Gear, SimC Update, Sim, Import, Character, Combination, Candidate, Stage, and so on. Do not call the app a "simulator"; that word is ambiguous with SimC.
- Retail only, all classes and specs. The Addon String is the only import source.
- Items display richly from day one: icon, name, item level, stats and quality. This data comes from SimC plus locally built `item-icons.json` and `item-meta.json`. There is no dependency on Raidbots data or the Blizzard API.
- **Top Gear v1:** capped combinations, 3-stage smart sims, unique-equip and paired-slot rules, talent loadouts from the Addon String, and a single consumable set chosen by the user.
- **Sim Settings:** presets (fight style, duration, targets, precision) plus a field for advanced raw SimC options.
- **Sim life cycle:** `draft → queued → running → succeeded | failed | cancelled`. Only a Draft can be edited.
- Out of scope: Droptimizer, Stat Weights, public multi-user hosting, and any visual clone of Raidbots.
- Still open (tracked in issues): the queue and job-runner design (#10), packaging (#14), the SimC update flow (#9), the Smart Sim cull (#13), and the look and feel of the Top Gear flow (#8).

## Brand Commitments

- The product name is **simbot**.
- The design is simbot's own. Raidbots inspires the workflow only; never reuse its branding or look.

## Evidence on Hand

- Research notes on SimC, the Addon String, item data, icons and combinations are in the wayfinder issues (#2–#7, #11, #12).
- There are no testimonials, users, benchmarks or screenshots yet. Do not invent any.

## Product Principles

1. **The Sim is the source of truth.** A past result must always be reproducible and explainable from what was frozen on the Sim.
2. **Honest numbers.** Show differences together with their uncertainty. Never present noise as a win.
3. **Paste to answer, fast.** Every extra step between the Addon String and the ranked result has to justify itself.
4. **Limited by the machine, not the product.** Constraints come from hardware and safety, never from artificial tiers.
5. **The user stays in control of SimC.** Updates are visible and chosen, never silent.
