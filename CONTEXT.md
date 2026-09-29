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

**Smart Sim**:
A Top Gear run split into **Stages** of increasing precision, **Culling** between them, so only contenders reach the most precise Stage. The equipped set runs through every Stage and is never Culled.
_Avoid_: staged sim, multi-stage sim

**Stage**:
One pass of a Smart Sim over the surviving combinations at a single precision. The last Stage runs at the precision the user picked.

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
