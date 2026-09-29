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

**SimC Update**:
A new commit on SimC's active branch that is newer than the SimC the app runs. Detected and surfaced, applied only when the user chooses.

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
One pass of SimC over a Sim's surviving Combinations at a given precision. A Quick Sim has one; Top Gear usually has several, each culling the weakest.
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

**Talent Loadout**:
A saved talent build carried in the Import; one of them is the equipped one.
_Avoid_: talent set, build
