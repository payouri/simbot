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
A sim of the character exactly as described by the Addon String; one result.

**Top Gear**:
A sim that evaluates many gear combinations drawn from the Addon String's items and ranks them.

**SimC Update**:
A new commit on SimC's active branch that is newer than the SimC the app runs. Detected and surfaced, applied only when the user chooses; applying it installs the newest available **SimC Build**, which may lag the commit by up to a day.

**SimC Build**:
One installable, self-contained copy of SimC, identified by its nightly tag (version, date, commit). The app may hold several; exactly one is the **Current SimC Build** that sims run on.
_Avoid_: SimC version (ambiguous with SimC's own version number), image

**Seed SimC Build**:
The SimC Build shipped inside the app itself, used only when no other SimC Build is available (e.g. first start offline).
