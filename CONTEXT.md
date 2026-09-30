# simbot

A self-hosted gear simulator for World of Warcraft (retail) built on SimulationCraft.

## Language

**SimC**:
The SimulationCraft engine, run as an external program; the thing the app wraps.
_Avoid_: simulator (ambiguous with the app itself)

**Addon String**:
The text export produced by the in-game SimulationCraft addon: character, equipped gear, bag/bank/vault items, talents. The only character import in scope.
_Avoid_: profile string, armory import

**Quick Sim**:
A Sim with exactly one Combination: the character as described by its input; one result.

**Top Gear**:
A Sim that evaluates many Combinations drawn from the Addon String's items and ranks them.

**Smart Sim**:
A Top Gear run split into **Stages** of increasing precision, **Culling** between them, so only contenders reach the most precise Stage. The equipped set runs through every Stage and is never Culled.
_Avoid_: staged sim, multi-stage sim

**Cull**:
Dropping the combinations that are clearly behind the best from a Stage before the next one, while always keeping a minimum number of the leaders.
_Avoid_: prune (that's removing invalid combinations before any sim runs)

**Job**:
One unit of work waiting in or taken from the **Queue**: either running a Sim or applying a SimC Update. Only one Job runs at a time.
_Avoid_: task, run (when meaning the queue entry)

**Queue**:
The ordered list of waiting Jobs, first in first out. A SimC Update waits its turn like any other Job, so it never interrupts a Sim.

**Stop**:
Ending a running Sim early while keeping what it finished: the Sim becomes cancelled and every Combination keeps the last Stage it completed.

**Discard**:
Throwing away a queued or running Sim's progress: its results are dropped and it returns to Draft, as if it had never run.
_Avoid_: cancel (ambiguous between Stop and Discard)

**SimC Update**:
A new commit on SimC's active branch that is newer than the SimC the app runs. Detected and surfaced, applied only when the user chooses; applying it installs the newest available **SimC Build**, which may lag the commit by up to a day. An update is only *installable* once such a newer SimC Build exists; until then the app only reports how many commits it is behind.

**Check Sim**:
A short sim of the user's latest Import (or, with none, a sample profile shipped with the build) run on a SimC Build before it becomes the Current SimC Build; if it fails or its output isn't understood, the build is rejected and the Current SimC Build stays as it was.

**SimC Build**:
One installable, self-contained copy of SimC, identified by its nightly tag (version, date, commit). The app may hold several; exactly one is the **Current SimC Build** that sims run on.
_Avoid_: SimC version (ambiguous with SimC's own version number), image

**Seed SimC Build**:
The SimC Build shipped inside the app itself: used when no other SimC Build is available (e.g. first start offline), and offered as a SimC Update when a new app version ships one newer than the Current SimC Build.

**Character**:
A WoW character, recognised on Import by region, realm, name and class, and editable afterwards. It groups the Imports and Sims that belong to it. The user never creates one by hand.
_Avoid_: toon, player, profile

**Import**:
An immutable character description brought into the app from outside, as the raw text received (today an Addon String paste, possibly an armory fetch later). Several Sims can start from the same Import.
_Avoid_: snapshot, upload, profile

**Sim**:
One request to SimC and everything about it: its input, its Sim Settings, its Character, its processing state and, when it finishes, its output. Quick Sim and Top Gear are kinds of Sim. A Sim is the source of truth for its own history: its input is frozen once it leaves Draft.
_Avoid_: run, job, simulation report

**Sim Settings**:
The simulation parameters a Sim ran with (fight style, duration, targets, precision, raw SimC options), frozen on the Sim so later changes to defaults or presets never alter it.
_Avoid_: config, options

**Combination**:
One full set of the user-configurable choices that affect a Sim's output: gear per slot (with enchants and gems), talents, consumables. Character-dependent traits (class, spec, race) and fight settings are not part of it.
_Avoid_: combo, set, variant

**Stage**:
One pass of SimC over a Sim's surviving Combinations at a given precision. A Quick Sim has one; a Smart Sim has several, Culling between them. The last Stage runs at the precision the user picked.
_Avoid_: round, phase

**Stage Result**:
The measured outcome of one Combination in one Stage (DPS summary and error) and whether it survived to the next Stage.
_Avoid_: score, report

**Draft**:
A Sim that has never been queued: saved so no setup is lost, and the only state in which its input can change. A Draft starts from an Import or as a copy of another Sim's input.
_Avoid_: pending, unsaved sim

**Character Snapshot**:
The character-dependent traits frozen on a Sim (identity at the time, class, spec, race, level, professions), kept for history however the Character changes later.
_Avoid_: base profile

**Top Gear Selection**:
The pool of Candidates and the constraints (e.g. one Great Vault item, locked slots) a Top Gear Sim was built from; its Combinations are generated from it.
_Avoid_: picker state, filters

**Candidate**:
One selectable option in a Top Gear Selection: a Candidate Item, a Talent Loadout, or later a consumable.

**Candidate Item**:
A gear item from the Import that Top Gear may place in a slot, with the place it came from (equipped, bags, Great Vault, linked).
_Avoid_: bag item, alternative

**Unknown Item**:
An item in an Import that the Current SimC Build doesn't recognise (unknown item or bonus id). The Import still succeeds: an equipped Unknown Item is simmed as SimC reads it, but as a Candidate Item it can't be selected. What was unknown is always recorded on the Import for anyone who wants to see it.
_Avoid_: invalid item, broken item

**Item Index**:
What the app knows about every item in an Import: the item level and stats SimC reports for it, read by one packed SimC run at Import, and which items were Unknown Items. Stored on the Import and read again when the Current SimC Build changes; static fields (name, quality, icon) are joined from that build's item data on display.
_Avoid_: item cache, item metadata

**Talent Loadout**:
A saved talent build carried in the Import; one of them is the equipped one.
_Avoid_: talent set, build
