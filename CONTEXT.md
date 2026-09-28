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
A new commit on SimC's active branch that is newer than the SimC the app runs. Detected and surfaced, applied only when the user chooses.
