# Sim worker: the simulation on its own thread

Status: **phase 1 (foundation) done, behind a flag.** Turn it on with `?simWorker=1`, or with Game Menu → Options →
"Simulation in a worker thread (experimental, next game)". It is off by default. `?simWorker=0` forces it off.
With the flag off, the game runs exactly as before: one thread, the same code path.

Companion document: [sim-worker-consumer-audit.md](sim-worker-consumer-audit.md) lists every render and UI file's
sim reads by frequency, the per-frame field set, the direct sim writes and the identity dependencies. The work list in
§9 is built on it.

## 1. Decision

The worker runs the authoritative game. The main thread keeps a **read-only replica of the object graph**: the same
classes, the same fields and the same object identities over time. The replica is kept in sync by per-step deltas.
This is option A of the brief, with C's split into rates:

- **Hot objects:** what the view draws and interpolates every frame. They are compared after every step and travel
  in a *hot stream* that the main thread applies at once.
- **Cold objects:** everything else. They are compared round-robin under a time and size budget, about one full
  cycle per second. They travel in a *cold stream* that the main thread applies in order, in slices, under a per-frame
  budget.

**Why this design.** The audit (§0.5) found that almost every consumer depends on `instanceof`, `===`, and `WeakMap`s
or `Map`s keyed by sim objects. A replica with stable identities keeps that code working unchanged. The main view, the
HUD, the selection panel and the screens all run against the replica today, untouched. A snapshot design (option B)
would mean rewriting every one of the ~90 consumers. Measured on the late save (§2), the replica fits the main-thread
budget, at about 0.1–0.2 ms per frame on average.

How the sync stays cheap without touching the sim:

- **No write tracking in the sim.** The worker keeps a *shadow* copy of every synced object's field values and
  compares objects with their shadows using generated, monomorphic per-shape compare functions. Sim code is
  untouched, runs at full speed, and cannot be made non-deterministic by the sync, which only reads.
- **Gates.** Ships, fighters and creatures are fully compared only in the steps the sim processed them, that is, when
  their `lastTouch` moved. With more than 1000 built objects the sim moves them round-robin anyway. Their weapons (the
  shots in flight) and fighters are compared along with them.
- **Fixed hot fields.** For BuiltObject, Creature, Fighter, Weapon, FighterWeapon and Explosion, only the listed
  per-frame fields (`replicaGalaxy.ts alwaysHotFields`) travel hot. Their other fields (~350 for a ship) travel cold.
- **Per-field streams** (§3.3): a few fields of cold classes travel hot (a habitat's explosions, the player's system
  visibility), a habitat's orbit fields go hot only when a parked ship or a shot refers to the habitat, and a ship's
  mission, design and fleet references travel cold.

## 2. Measurements (late game: 2500-star save, 3096 systems, 84k habitats, 9.8k built objects)

All numbers come from `public/dev-saves/late2500.dwusave` (136 MB, built with `scripts/lategame-start.mjs --stars 2500`).
The machine is a shared 16-core box under load: load average 9–13 during these runs, other agents' tests running.

### 2.1 Options compared — `node scripts/sync-measure.mjs <save> --compare-options`

| Option | Worker cost per step | Wire per step | Main-thread cost | Consumers to port |
|---|---|---|---|---|
| **A-naive**: diff the whole graph after every step | 236 ms mean, 192 ms p50 | 1.3 MB mean | 5.5 ms mean, 36 ms p95 | none |
| **B**: typed-array snapshot of the hot fields, plus query RPC for the UI | 4.1 ms pack | 2.2 MB | 1.1 ms (transfer and read only) | **all ~90** (render layers, HUD, panels, 13 screens) |
| **C**: full replica at 4–10 Hz, plus B's snapshot per step | a 2.4 s encode and 425 MB per full refresh; a delta refresh costs A-naive's 200 ms each time | — | 2 s rebuild per full refresh | everything that needs step-rate data, as in B |
| **Chosen (A with hot/cold streams, gates, fixed hot fields)** | **7.7 ms mean, 12.1 ms p95** (diff), plus the step itself | 271 KB hot part mean (580 KB max), ~480 KB total | **hot apply 0.29 ms mean, 0.42 ms p95; cold pump ≤ 0.5 ms per frame by budget** | none for the main view; see §9 for the rest |

The full graph is 2.34 M objects: 1.09 M arrays, 406 k `BuiltObjectComponent`s, 128 k plain objects, 105 k
`SystemVisibility`s, 84 k Habitats, and so on (`--census`). The steps that shaped the design, in the order they were
measured (worker diff per step, then main apply):

| Variant | Worker diff ms (mean / p95) | Main apply ms (mean / p95 / max) |
|---|---|---|
| everything reachable from a hot object counted as hot (664 k objects) | 83 / 102 | 2.4 / 13.9 / 28 |
| hot classes plus a hot-container list, Habitat cold | 27 / 52 | 2.5 / 13.9 / 27 |
| adaptive hot fields | 17 / 30 | 1.7 / 5.0 / 29 |
| gate on `lastTouch` (only touched ships fully compared), weapons as gated children | 9.3 / 17 | 1.6 / 4.3 / 29 |
| fixed hot-field list for BuiltObject / Creature, cold sets capped at 6000 per step | 7.5 / 11.8 | 1.2 / 6.5 / 46 (new-object bursts) |
| **two streams (hot now, cold queued and pumped), cold fields of fixed classes in the cold stream** | **7.7 / 12.1** | **hot 0.29 / 0.42 / 5.9; cold pump per frame 0.47 / 1.2 / 3.9** |

The snapshot (the first sync, at boot or load) is 2.34 M objects, 425 MB of streams and strings. It takes 2.4 s to
encode in the worker, 0.5 s to clone, and 1.8–2.1 s to apply on the main thread. That is boot time, comparable to
loading the save in-thread today.

**Fidelity.** After a full compare, `galaxyToJSON(replica)` is byte-identical to `galaxyToJSON(authoritative)` (130 MB),
and the state digests match (`sync-measure.mjs --verify`). That covers every object, every field, the side tables and
the territory grid.

### 2.2 Main-thread frame time — `scripts/perf-render.mjs --load=<save> --gpu=egl` (RTX 4090, 3840×2160 canvas)

Uncapped (`--uncapped`: no vsync, so fps shows capacity). Game speed 1×, 6 s per zoom.

| Zoom | In-thread fps | In-thread p95 ms | In-thread 240 Hz misses | In-thread sim ms/frame | **Worker fps** | **Worker p95 ms** | **Worker 240 Hz misses** | **Worker sync ms/frame** |
|---|---|---|---|---|---|---|---|---|
| galaxy | 114 | 95.6 (one 1.7 s render stall) | 25.0 % | 1.28 | **140** | **12.5** | **10.3 %** | **0.23** |
| sector | 181 | 11.4 | 10.9 % | 0.83 | **188** | **9.4** | **11.8 %** | **0.17** |
| system | 247 | 14.8 | 22.3 % | 0.65 | **384** | **9.3** | **6.6 %** | **0.08** |
| planet | 250 | 10.0 | 16.3 % | 0.69 | **350** | **6.1** | **4.1 %** | **0.08** |

"240 Hz misses" counts frames longer than 6.25 ms (1.5 refresh periods). In-thread, "sim ms/frame" is the step averaged
over all frames: one frame in four at 240 Hz carries a 2.7–4.1 ms step. In worker mode, "sync ms/frame" is the hot
apply plus the cold pump. The worker kept 60 steps/s throughout (360–429 steps in 6 s).

Worker-mode sync detail, per frame (hot / cold mean, then the worst frame's hot and cold apply):

| Zoom | hot ms | cold ms | max hot | max cold | worker step ms | worker diff ms | delta KB |
|---|---|---|---|---|---|---|---|
| galaxy | 0.13 | 0.10 | 6.2 | 1.4 | 2.2 | 7.6 | 213 |
| sector | 0.10 | 0.06 | 4.9 | 1.3 | 6.4 | 12.0 | 959 |
| system | 0.05 | 0.03 | 3.0 | 2.7 | 2.1 | 8.7 | 737 |
| planet | 0.05 | 0.03 | 14.0 | 2.1 | 6.0 | 14.7 | 793 |

The remaining misses are render-side (Pixi update and render at 4K on a loaded machine), not the sim. The worst hot
applies are single frames: a cold part forced by a dependency, or a birth burst. They are listed in §8 as tuning work.

I re-ran worker mode (uncapped) after the final codec change (the births stream, §3.3) at a higher machine load
(load average 19–22):

| Zoom | fps | p95 ms | 240 Hz misses | sync ms/frame | max sync ms | worker step + diff ms |
|---|---|---|---|---|---|---|
| galaxy | 330 | 7.0 | 5.9 % | 0.10 | 6.7 | 6.8 + 11.8 |
| sector | 385 | 6.9 | 5.4 % | 0.10 | 7.8 | 8.5 + 21.4 |
| system | 387 | 7.8 | 7.5 % | 0.09 | 4.8 | 12.7 + 20.2 |
| planet | 503 | 5.3 | 2.7 % | 0.06 | 6.6 | 8.6 + 14.9 |

The worker still held 60 steps/s (360–373 steps in 6 s). Its step and diff times grow with machine load, because the
two share the worker thread.

Vsync run (no `--uncapped`; the headless compositor's own rate): see §2.3.

### 2.3 Vsync run

Headless Chromium's compositor runs at 60 Hz, so this run shows the main thread's busy time per frame when every frame
carries a step (in-thread). Both modes hold 60 fps; the numbers are the main thread's cost:

| Zoom | In-thread update ms | In-thread sim ms/frame | **Worker update ms** | **Worker sync ms/frame** (hot / cold) | Worker max sync ms |
|---|---|---|---|---|---|
| galaxy | 3.85 | 2.94 | **1.82** | **0.63** (0.32 / 0.28) | 2.1 |
| sector | 3.48 | 3.40 | **1.07** | **0.53** (0.30 / 0.21) | 1.6 |
| system | 5.95 | 3.42 | **1.44** | **0.54** (0.30 / 0.22) | 2.0 |
| planet | 5.29 | 3.22 | **1.42** | **0.55** (0.33 / 0.20) | 2.3 |

The sim step leaves the main thread: 2.9–3.4 ms per step becomes 0.5–0.6 ms of sync. `MainView.update` also gets
2–4× cheaper in worker mode. That is probably because the sim no longer evicts the render's working set from the
cache and no longer adds GC pressure on the main thread, but this is not proven. The worker kept 60 steps/s (worker
step 1.8–3.0 ms, diff 4.6–9.6 ms).

**Verdict.** The sim's contribution to a 240 Hz frame drops from one 2.7–4.1 ms step in every fourth frame to
0.05–0.3 ms in every frame. The main-thread budget is now render-bound: uncapped system/planet zoom reached 350–384
fps, against about 250 in-thread.

### 2.4 Chunk 2: hot path, spikes and render pacing (late save, machine load average 26-50)

Main-thread hot apply per step, `node scripts/sync-measure.mjs <save> --steps 200`, the same save and steps back to
back (the load moves the absolute numbers by up to 2×; the two runs per tree bracket it):

| | hot apply ms mean | p95 | max | hot KB mean | worker hot pass ms mean |
|---|---|---|---|---|---|
| before | 2.33 / 1.36 | 10.5 / 5.9 | 31 / 10 | 200 / 219 | 16.7 / 8.8 |
| after | 0.56 / 1.03 | 1.24 / 2.26 | 9.3 / 40 (GC) | 270 / 270 | 9.9 / 16.5 |

The worst hot applies before carried 300-700 new objects (missions and their commands, weapon stats); after, the hot
part's births are new ships and their explosions. The per-step compares added (the player's 3 096 system
visibilities, the targets and parent habitats of the touched ships, gate lists) cost about 0.3 ms of the worker's
hot pass. The hot part grew by about a quarter: the shot / fighter / explosion fields now travel hot from the first
step of a fight instead of after a cold cycle.

Render pacing, `scripts/simworker-smoke.mjs --load=/dev-saves/late2500.dwusave --gpu=egl` (60 Hz headless
compositor; the drawn game time's advance per frame against the wall clock at the measured rate):

| | mean ms | p95 ms | frames standing still (of 180) |
|---|---|---|---|
| worker, before | 13.4 | 30.9 | 39 |
| worker, after, `?simPace=0` | 20.0 | 57.5 | 88 |
| worker, after (StepPacer) | 3.4 | 8.6 | 0 |
| in-thread (before and after) | 0.44 | 0.67 | 0 |

On this load the worker ran 4-6 steps per message (step + diff 40-100 ms); the two unpaced runs differ mostly by
that (21 against 33 ms in their last step). The synthetic patterns in
`test/simWorkerPacing.test.ts` (240 Hz): worker at real time with 12-26 ms jittered arrivals, p95 0.2 ms against
4.2 ms unpaced; 3 steps per 68 ms, p95 0.3 ms against 30 ms.

## 3. The replica sync (src/simworker/replicaSync.ts, replicaGalaxy.ts)

### 3.1 Identity and the shadow

Every object reachable from the roots gets a sync id when the encoder first sees it. There are two roots: the Galaxy,
and a *side-tables* root that holds the state the TS port keeps outside the graph, the same set the save writes
(`galaxySave.ts collectSideTables`). Ids are never reused.

For each object the encoder keeps a shadow: field values in shape order, array elements, Map entries, Set items,
typed-array contents. The main-thread decoder keeps `id → replica object` and `replica object → id`.

What is synced and what is not:

- **What the save writes is what is synced.** That means the same class registry (`saveClassPrototypes`), the same
  externals (static GameData objects named `kind:key`, resolved against the replica's own GameData tables), and the
  same skip list, *except* that `EmpireTerritory.territory` IS synced (the save writes it beside the graph).
- Galaxy static tables, the step order and `EmpireVisibility.owner` (closures) are rebuilt on the replica by
  `replicaStatics().wire`, exactly as a save load does.
- New empires get their visibility hooks when they appear.

### 3.2 Compare passes (worker, after each tick)

1. **Hot pass, every tick.**
   - Every hot-class instance: Galaxy, BuiltObject, Creature, Fighter, ShipGroup, Empire, Explosion.
   - Every hot container: `Galaxy.builtObjects` / `creatures` / `empires` / `pirateEmpires`, `*.explosions`,
     `Empire.builtObjects` / `shipGroups`, `ShipGroup.ships`. Containers are labelled by where they were found,
     `Class.field`.
   - **Gated classes** (BuiltObject, Fighter, Creature): `lastTouch` and `hasBeenDestroyed` are compared every tick.
     When `lastTouch` moved, the hot fields are compared too, plus the `weapons` and `fighters` lists and the Weapon /
     FighterWeapon instances in them.
   - **Hot fields:**
     - *Fixed list* for BuiltObject, Creature, Fighter, Weapon, FighterWeapon and Explosion (`alwaysHotFields`): the
       renderInterp `Moving*` fields, plus the audit §3 per-frame set (visibility, combat, hyper, ion strike, ambient,
       mission), the shot fields `effectsLayer.ts` draws, and the explosion fields. (An adaptive list made the first
       second of a fight after a quiet spell travel at the cold rate: a field became hot only after a cold cycle in
       which it changed often enough.)
     - *Adaptive* for the other hot classes: a field is hot while it changed at least 0.25 times per step in a recent
       cold cycle.
   - **Gate lists:** a ship's `attackers` (mutated in place; combat bars) is compared with its gate, without its
     elements. A gate's child containers (`weapons`, `fighters`) travel hot, so a new fighter or weapon is born in the
     hot stream.
   - **Touches** (`ReplicaEncoder.touch` / `touchId`, from `GalaxySyncSource.hotPass`): the habitats with a giant ion
     cannon (with the cannon's shot) and the player's (and its visibility partners') `SystemVisibility` records are
     compared every step.
   - **Related objects** (`relatedFields`): when a shot, fighter or creature is compared, so is its target (its hot
     fields without its gate; or a habitat's hot-stream and mixed fields), so a shield strike or a bombardment
     explosion shows in the same step; when a ship is, so is its `parentHabitat` / `dockedAt`, whose committed
     position its own was just derived from (`renderInterp.ts followsParent`).
2. **Cold pass.** Every object, whole, round-robin. Hot-class instances are included, so changes made by others,
   such as damage to an untouched ship, also arrive. The pass stops each tick after 3 ms or 6000 field sets / new
   objects, whichever comes first, and covers at least 1/1200 of the objects per tick. On the late save a full cycle
   takes about 1–1.5 s.
3. **Incremental mark.** Every 8 cycles, a reachability mark over the *shadows* (what the replica holds) runs at
   1 ms per tick. It is snapshot-at-the-beginning, with barriers on every reference written or overwritten while it
   runs. It is followed by an incremental sweep. Unreachable objects are dropped on both sides, so neither side leaks.

Change detection uses SameValue: NaN equals NaN, and −0 differs from 0, because the digest hashes the sign bit.
Values travel as a tag plus a payload in Float64 streams; strings and typed-array contents ride alongside.

### 3.3 Two streams and their ordering rules

Each delta has a `hot` part and a `cold` part, and each part has shells (new objects) and a body (fills and sets).

- **An object's changes always travel in its own stream.**
  - Hot classes, child-hot classes and hot containers use the hot stream.
  - Empire and ShipGroup are compared every step but travel cold (`coldStreamClasses`).
  - For BuiltObject and Creature, sets of non-hot fields travel cold. This is safe because a fixed shape's slots never
    change stream.
  - Per field, fixed per class (`replicaGalaxy.ts`): `hotStreamFields` always travel hot (Habitat explosions /
    explosion / giantIonCannon / hasBeenDestroyed, SystemVisibility.status); `coldStreamFields` of a fixed hot class
    are compared every step but travel cold (BuiltObject mission / design / shipGroup: a new mission is a burst of
    births, a new design or fleet is usually born in a cold part first — sent hot, both made hot-apply spikes).
  - `mixedStreamFields` (Habitat lastTouch / orbitAngle / xpos / ypos) travel cold from the cold pass and hot from a
    touch or a related compare. A touch re-sends all of an object's mixed fields hot when one went cold since the
    last hot send, and the decoder drops a queued cold set of a mixed field older than the object's last hot one.
- **An object's birth (shell plus first contents) travels with the record that first referenced it.** If a hot
  record refers to an object born in a cold part the main thread may not have applied yet, the delta carries
  `coldDep`. The main thread then applies the hot shells, then **only the shells and births** of the cold parts up to
  `coldDep` (their bodies stay queued for the pump: a body only sets fields of objects that existed before its part),
  then the hot body.
- **Main thread, per delta:** register the shapes, apply the hot part, queue the cold part.
- **Main thread, per frame:** pump the cold queue for 0.5 ms. The budget grows by 10 % per queued part beyond 4, up to
  4×. A part may be left half-applied, but only between objects: never between an array's new length and its element
  sets.

### 3.4 Decoding (main thread)

- Class instances are built by generated per-shape constructors (one hidden class per shape, as save loading does),
  so the replica is as fast to read as a loaded game.
- Field sets go through generated per-shape setters.
- Save revive hooks (Cargo, Random) are honoured.

## 4. Protocol, ownership and commands (src/simworker/protocol.ts, simHost.ts, clientCore.ts, worker.ts)

### 4.1 Messages

Main → worker:

- `init {boot: create(options without gameData, scenario, flagShapeIndex) | load(save text, scenario), startOptions, clock?, sync?}`
- `clock {seq, speed, paused}`
- `command {id, empire: syncId, op, args: RemoteArg[]}`
- `save {id}`
- `digest {id}`
- `dispose`

Worker → main:

- `progress {step, fraction}`
- `snapshot {delta, baseTechCost, viewX, viewY, clock, stepSerial, startOptions}`
- `step {delta, stepSerial, steps, nowMs, backlogMs, speed, paused, clockSeq, stepMs, diffMs, results[], events[]}`
- `saved {id, text}`
- `digest {id, digest, nowMs, stepSerial}`
- `error`

The delta streams are transferred, not copied.

### 4.2 Ownership rules

- **The worker owns all sim state.** Only the worker runs sim code that writes the graph: steps, commands, game end,
  achievements, saves.
- **The replica is read-only.** A main-thread write to a replica object is not an error, but it is wrong. The worker
  never sees it, and the next sync of that field overwrites it, or never does if the worker's value does not change.
  The audit's §4 lists the 27 places that still write. They are §9's work. The dev-only write detector
  (`?detectWrites=1`, §9 chunk 0) finds them at run time, with stacks.
- **The clock.** The HUD's GalaxyTime stays on the main thread as the control surface and is bound to the replica
  Galaxy's `nowMs`, which travels hot. Pause and speed changes are posted, with a sequence number, the moment they are
  written: `SimClientCore.bindClock` turns the instance's `paused` / `speed` into accessors, so every writer (HUD
  buttons, keyboard, game menu, auto-pause, tutorials, the action menu, the console) posts at once. The worker's own
  GalaxyTime is authoritative. The main thread adopts the worker's pause and speed (for example, a game end that
  paused from inside a tick) once a step message echoes the last clock seq it sent.
- **Optimistic pause.** From the press until the worker acknowledges the pause (a step message whose clock seq
  reaches it), the main thread holds the step messages instead of applying them: the replica's `nowMs`, its positions
  and the render time (drawn as paused, alpha 0) stand still from the frame the player paused, as in-thread. The worker
  ticks at once on a clock message, so the ack is one round trip (tens of ms). At the ack the held messages apply,
  with the steps the worker ran before the pause reached it (0–2 in the smoke: at most ~35 game ms at 1×). Resuming
  before the ack releases the hold; a worker that does not answer within 500 ms releases it too.

### 4.3 Commands

`issuePlayerCommand(galaxy, …)` on a replica galaxy goes to a remote sink (`playerCommands.ts setRemoteCommandSink`),
not to the local queue.

- **Arguments** (`remoteArgs.ts`):
  - Replica objects are sent by **sync id**. The worker resolves them to the exact authoritative object, whatever list
    it is in and however stale the replica's cold data is.
  - Statics are sent as externals.
  - Anything else goes by value with its class name: ShipAction, option objects, DesignDraft-like copies.
- **Applying.** The worker calls the ordinary `issuePlayerCommand` on the real galaxy. The command is applied at the
  worker's next frame boundary and **journaled by the ordinary command-log codec**. The command log is therefore the
  same as in-thread: same entries, same boundaries `nowMs`, same encoding.
- **`onApplied`.** The executor's result is encoded with sync ids and sent back in that tick's step message. Objects
  it names that the replica does not know yet are born in the same delta's hot part, and objects born in a cold part
  become a dependency. The callback runs on the main thread once the delta is applied, so the reply always resolves to
  replica objects. Unlike in-thread play, it runs one round trip later, not inside the boundary.
- **`runPlayerCommand`** (synchronous result) throws on a replica. Its two callers, the advisor chat and the diplomat
  voice, are in §9 chunk 8.

### 4.4 Queries (order menus, selection buttons, money panel)

Some UI calls are not commands but still change sim state, as the C# UI does: building the right-click action menu
and the selection panel's buttons draws `galaxy.rnd` (the "Build here" designs, the build pages' surface / parking
points, `DetermineOrbitalBaseLocation`) and fills `Empire.latestDesigns`; the money panel runs
`CheckAgeVariableIncome`. They go through `simworker/simQuery.ts` (`SIM_QUERIES`: `actionMenu`, `selectionButtons`,
`habitatDispatch`, `moneyPanel`):

- In-thread, `simQuery(galaxy, empire, op, args, done)` runs the function and calls `done` inside the call, as before.
- On a replica, the query is posted (`query {id, empire, op, args}`), the worker runs it on the authoritative galaxy at
  once, in message order with the commands (so its draws land where in-thread play makes them), and posts an immediate
  sync-only step message (`SimHost.flush`) carrying the reply. Replies travel by value except graph objects (sync ids).
- Every in-thread build is still made, one query each (never coalesced: the draw count must match). A reply for a
  right-click or a selection / page the UI has left since is not shown.
- Gate: `test/simWorkerOrders.test.ts` (a scripted UI player: menus, button pages, dispatch, right-click, box
  selection, hotkeys, fleet point) gives the in-thread menus, command log and digest; building the menus on the
  replica instead does not.

**Freshness of `onApplied`.** The host compares what a command named and returned (`ReplicaEncoder.compareNow`: the
issuing empire to depth 1, arguments and results to depth 2) in the delta of the tick that applied it, and the main
thread applies the cold parts through that delta before it runs the command replies (`GalaxyReplica.applyThrough`).
So a callback reads the replica as of that boundary (one step later than in-thread), including cold fields.

**Dropped objects.** A BuiltObject, Habitat, ShipGroup, Creature, Fighter or Empire the replica no longer knows (destroyed
and dropped by the mark while the HUD still held it) is never sent by value: the command or query is dropped with a
warning and its callback does not run.

### 4.5 Sim → UI hooks

These run in the worker on the authoritative game, and the main thread gets an event:

- The game-end handler: pause, `doGameEnd`, `reviewAchievements`. The banner is not ported yet; the main thread shows
  a toast.
- The location-pinged hook: the main thread centres the camera on the replica object.
- A sim error: the worker pauses and the main thread shows a toast.

## 5. Determinism, the command log, saves and replays

- **The step loop is the in-thread one.** The worker's `SimHost.tick` runs the same `SimFrameBudget.run(SimDriver, …)`
  (moved unchanged to `src/simFrameBudget.ts`): drain the command boundary, journal the speed, the same fixed steps of
  `FRAME_REAL_MS`, the same pause probe, the same error containment. `?simView=1` (the camera LOD pass) is off in
  worker mode, because the camera is not in the worker.
- **The sync only reads.** It reads own enumerable data properties, array elements, Map / Set iteration and
  typed-array elements. It runs no getter, writes nothing and draws no RNG.
- **Gate (test).** `test/simWorker.test.ts` runs the scripted player of the command-log tests (`helpers/commandScript.ts`,
  60 s scale: move a ship, create a fleet, purchase, treaty, tax, policy, speed changes). The player reads and orders
  on the **replica**, through the host. The run must give the same tick count, the same command log (JSON-equal) and
  the same `stateDigest` as the same script through the real in-thread app loop (`simLoop.ts createSimLoop`), tick for
  tick. After a full compare, the replica's save text must equal the authoritative one.
- **`repin --check`:** 0 changes. The sim's behaviour is untouched; the only sim-side change is the remote-sink hook
  in `playerCommands.ts`.
- **Save.** The worker serializes its own game (`SimHost.save` = `serializeGame`), and the main thread awaits it. The
  save panel, Download and autosave now accept `serialize()` returning a Promise. The text is the same format, so
  saves load in either mode.
- **Load.** The main thread does not parse the save. It posts the text (or, for `?load=<url>`, only the URL: the
  worker fetches it). The worker parses it once (`workerBoot.ts`), reads its scenario, builds its data with that
  overlay, deserializes, and names the scenario in the snapshot (`SnapshotMessage.scenario`); the main thread builds
  its replica's static data from that, and takes the save's start options from the snapshot. Tests: a save from a
  host, loaded into a new host, continues to the same digest, and its replica matches; the same through
  `bootWorkerGame`, with and without a scenario (test/simWorkerBoot.test.ts).
- **New games.** createGame options are structured-cloned into the worker. `bootOptions.ts` drops gameData (the worker
  loads its own from the same URLs, with the same scenario overlay) and rebuilds class-typed options
  (`VictoryConditions`). Test: the cloned options build a byte-identical game, and the test fails without the rebuild.
- **Replays** are unchanged: `replayCommandLog` runs headless from seed plus log. The log a worker game writes is the
  in-thread log.

## 6. Fallback in-thread mode

With the flag off (the default), `startGameView` creates the in-thread `createSimLoop` exactly as before. `SimHost`,
the worker and the replica are not created. `issuePlayerCommand` takes the local queue, because no remote sink is
registered.

The only behaviour changes in this mode are:

- `serialize()` may be awaited (a string awaits to itself);
- autosave's `save` is async;
- `SimFrameBudget` moved files and is re-exported from `simLoop.ts`.

## 7. Files

| File | Role |
|---|---|
| `src/simworker/replicaSync.ts` | Generic encoder (shadow diff, hot/cold streams, gates, incremental mark) and decoder (shells, generated constructors and setters, cold pump) |
| `src/simworker/replicaGalaxy.ts` | Galaxy binding: roots, side tables, hot classes / containers / fields / gates, replica static wiring |
| `src/simworker/simHost.ts` | Worker-side host: step loop, commands, clock, events, save, digest (DOM-free; tests drive it) |
| `src/simworker/clientCore.ts` | Main-side core: replica, command sink, replies, clock hand-off, render time, sync stats (DOM-free) |
| `src/simworker/worker.ts` | Worker entry: data loading, create / load, timer loop, message dispatch |
| `src/simworker/workerClient.ts` | Main-side Worker wrapper, boot with progress, frame loop, async save / digest, the flag |
| `src/simworker/remoteArgs.ts` | Command arguments and replies across the boundary (sync ids) |
| `src/simworker/bootOptions.ts` | createGame options across the boundary |
| `src/simworker/simQuery.ts` | UI-side sim calls that change state as the C# UI does (menus, buttons, money panel), run where the game runs (§4.4) |
| `src/simworker/tradeFlowSync.ts` | Trade-flow recording in the worker; the ledger as a side table (chunk 3) |
| `src/simworker/protocol.ts` | Message types |
| `src/simFrameBudget.ts` | SimFrameBudget, shared by both modes |
| `scripts/sync-measure.mjs` | Sync cost on a save (`--compare-options`, `--verify`, `--census`, `--hot-fields`) |
| `scripts/simworker-smoke.mjs` | Browser smoke: boots with the flag, checks run / speed / pause / move order, screenshots |
| `test/simWorker.test.ts`, `test/replicaSync.test.ts` | Determinism, fidelity and save gates; codec fuzz (8 seeds × 400 steps by default; `FUZZ_SEEDS` / `FUZZ_STEPS`) |
| `src/simworker/writeDetector.ts`, `test/replicaWriteDetector.test.ts` | Dev-only replica write detector (`?detectWrites=1`, §9 chunk 0) and its tests |

## 8. Known limits of phase 1 (also in §9)

- **Boot cost.** A late save's snapshot is about 4–5 s on top of the worker's own load, and the main thread is busy
  for about 2 s applying it. A streamed or incremental snapshot would fix that.
- **Occasional hot-apply spikes (3–14 ms)** — addressed in chunk 2: the birth bursts (missions with their commands,
  research-improved weapon stats) now travel cold, the usual dependencies (new designs and fleets, fighter launches,
  refits) are gone, and a remaining dependency applies only births (§3.3). What is left is the hot part's own volume
  on a busy step (about 5 000 sets) and GC pauses (§2.4).
- **Worker headroom.** Step plus diff is 10–20 ms per step on the loaded machine at 60 steps/s. Above that the worker
  falls behind and the budget catches up, exactly as the in-thread loop does. Tuning knobs: `coldBudgetMs`,
  `coldMaxSets`, `markBudgetMs`.
- **Cold staleness.** Cold data is up to one cycle old (about 1–1.5 s), plus any pump backlog. A paused game settles
  to exact: the worker keeps comparing for two full cycles after the last change.
- **Not ported (§9):** the game-end banner, message-pipeline writes,
  synchronous advisor commands, tutorials (they still boot in-thread), the
  `__dwu.sim` / `simBudget` debug hooks (null in worker mode), and `__dwu.commands.log` (the replica has no log).

## 9. Porting work list (parallel chunks)

Each chunk is independent. All chunks share the same test approach:

- **Unit tests.** Drive `SimHost` and `SimClientCore` in-process, as `test/simWorker.test.ts` does, and assert on the
  replica (and on `host.digest()` and the command log against the in-thread run when the chunk issues commands).
- **Browser.** `scripts/simworker-smoke.mjs <dev url>`, with `--load=/dev-saves/late2500.dwusave` for the late game,
  extended with the chunk's own checks, and screenshots of the chunk's screens with `?simWorker=1` vs `0`.
- **Determinism.** `npm run repin -- --check` must stay at 0, and `test:fast` must pass with the flag off.
- **Safety net: the replica write detector** (chunk 0, done). Run your chunk's checks with it on, and make sure your
  chunk's keys in the findings table below disappear. See "Chunk 0" below.

**Chunk 0 — replica write detector (done).**
- Files: `src/simworker/writeDetector.ts`; the decoder hook in `replicaSync.ts` (`ReplicaDecoder.watch`, `fieldName`,
  `idLimit`: additive, null by default); the install in `workerClient.ts`; `scripts/simworker-smoke.mjs --detect-writes`;
  `test/replicaWriteDetector.test.ts`.
- **Turn it on:** `?simWorker=1&detectWrites=1` (dev builds only, `import.meta.env.DEV`). It warns once per key in the
  console (`[replica write] …`) and is reachable as `window.__dwuWriteDetector`: `checkAll()` (compare everything now),
  `writes()` / `unexpected()` (findings, with counts, first detail and stack), `summary()`, `reset()`, `arm(key)`.
  `detectWrites=all` traps every field of every replica object from the start, so the first write already has a stack
  (heavier; fine on a fresh game). In tests: `installReplicaWriteDetector(client.replica, { warn })`, then
  `det.checkAll()` / `det.unexpected()`. Smoke: `node scripts/simworker-smoke.mjs <url> --detect-writes[=all]` prints the
  findings after the move order and at the end, and saves `<out>/replica-writes.json`.
- **How it works.** It keeps a mirror of the values the decoder applied to each replica object. The decoder calls
  `watch(id, slot)` before each record; the first record on an object in an apply compares it with its mirror (only the
  field being set, for a field set), so a foreign write is found when the sync next touches the object. Objects the sync
  does not touch again are compared by a round-robin sweep at the start of every cold pump (0.25 ms), and by
  `checkAll()`. Once a key is found, a trap is armed on it: the field becomes an accessor on every live and future replica
  object with that label (containers: `push` / `splice` / `set` / `add` / … are watched), so the next write reports its
  stack. Index writes (`a[i] = v`) and added / deleted keys are found by the compare only. Writes made while the replica
  applies a delta (the decoder, `GalaxyReplica.afterApply`'s static wiring and side tables) are the sync's and never
  reported. `REPLICA_WRITE_ALLOW` (in `writeDetector.ts`) lists intended client-side state, with a reason per entry: it
  is empty, because every write found so far is a bug.
- **Keys:** `Class.field` (class names from the save registry), `<label>.field` for a plain object, `<label>[]` for an
  array, `<label>{}` for a Map / Set, `<label>#` for a typed array; a container's label is where it was first found
  (`Empire.messageHistory[]` is that array).
- **Cost:** off, nothing (the hook is null). On, the main thread's sync work is about 3–4× (fresh game: about 2 ms more
  per frame in node). Installing it on the late save takes a few seconds and roughly doubles the replica's heap.
- **Findings** (smoke on a fresh game, and on `late2500.dwusave`, both modes; 2026-10-03). Each key, the writer the trap
  caught (or the compare's detail), and the chunk it belongs to:

  | Key | Writer (stack) | Chunk |
  |---|---|---|
  | `EmpireMessage.starDate` | `ui/empireMessageFeed.ts recordTickerMessage` ← `main.ts refreshHud` (4 Hz) | 4 (audit §4 item 2) |
  | `Empire.messageHistory[]` (push) | `sim/messages.ts addHistoryMessage` ← `empireMessageFeed.ts recordTickerMessage` ← `refreshHud` | 4 (item 2) |
  | `Empire.advisorSuggestions[]` (push) | `sim/advisorQueue.ts addAdvisorSuggestion` ← `receiveAdvisorSuggestionMessage` ← `ui/messagePopups.ts tick` | 4 (item 3) |
  | `Empire.eventMessageRecipient` (key "deleted": redefined non-enumerable, compare only) | `ui/eventMessages.ts` 138 / 194 and `audio/gameAudio.ts` 265 (`Object.defineProperty` on the player Empire) | 4 (item 6), 2 |
  | `Empire.useAveragedVariableIncome`, `Empire.variableIncome`, `Empire.lastVariableIncomeUpdate`, `Empire.thisYearsResortIncomeValue`, `BuiltObject.currentYearsIncome` | `sim/treasury.ts checkAgeVariableIncome` (→ `ageVariableIncomeValues`, `thisYearsResortIncome`, `resetYearlyIncome`) ← `moneyPanelIncome` ← `ui/hud.ts refreshMoney` / `buildMoneyPanel` | **5 — not in the audit.** The C# UI does this too (Main.Part11.cs 841): it is a sim write by design, so it must become a command (or run in the worker at the panel's rate). `currentYearsIncome` is reset on every space port / mining station / resort base at a new galactic year. |
  | `BuiltObject.hyperjumpAboutToEnterSoundPlayed` | `audio/mainViewSounds.ts MainViewSounds.hyperjump` ← `collect` ← `gameAudio.ts frame` | 2 (item 1) |

  The smoke has no combat and opens no screens, so the audit's other writes (`Weapon.soundEffectPlayed`,
  `Explosion.explosionSoundPlayed`, `BuiltObject.ionStrikeSoundPlayed`, the order menus' `Random` draws, the screens'
  writes) did not come up. Run your chunk's flows with the detector on to catch them; a replica RNG draw is reported as
  `Random.inext` / `Random.inextp` / `Random.seedArray[]` (tested).

**Chunk 1 — clock, boot and persistence edges.**
- Files: `src/main.ts` (tutorial boot `startTutorialGame` through the worker; `bootGameWithOptions` non-autostart
  path), `ui/screens/tutorials.ts`, `ui/autoPause.ts`, `ui/keyboard.ts`, `ui/hud.ts` clock buttons,
  `ui/screens/gameMenu.ts`, `ui/loadingOverlay.ts`, the `__dwu` debug surface (`sim`, `simBudget`, `commands.log`
  through a worker request), `ui/eventLogDev.ts`.
- Work: pause latency (an optimistic local pause that holds the replica `nowMs` until the worker acks); load without
  the main-thread JSON parse (send the scenario id from the save index, or parse in the worker).
- Test: pause / speed / tutorial "Play This Game" in the smoke; load from the main menu.
- **Done:**
  - The optimistic pause and immediate clock posting (§4.2); the worker ticks on every clock message.
  - Load without a main-thread parse (§5); `?load=<url>` is fetched by the worker.
  - Tutorials and the bare `generateGalaxy` boot (`bootGameWithOptions` without `?autostart`, kind `generate`) run in
    the worker; a tutorial game that fails to start in the worker returns to the main menu with a toast.
  - Debug surface: `__dwu.sim` / `__dwu.simBudget` are stand-ins for the worker's SimDriver / SimFrameBudget
    (`SimWorkerClient.debugObject`: fields read the last known value, writes go to the worker, other members are
    called there and return a Promise, e.g. `await __dwu.sim.advance(1000)`); `__dwu.commands.log()` returns a
    Promise of the worker's log. `__dwu.eventLog` reads the replica (cold-synced).
  - Tests: test/simWorkerBoot.test.ts. Smoke: `scripts/simworker-smoke.mjs` default, `--tutorial`, `--menuload`,
    `--generate` (each also with `--inthread`).
- **Still open:** the in-flight steps at a pause are applied, not hidden (the authoritative game ran them); the
  autosave / save panel and the wizard need no change (they await `serialize()` and post their options).

**Chunk 2 — Main View hot path and audio.** *Done* (see §2.4 for the numbers):
- Hot fields validated per layer (§3.2): fixed lists for Fighter / Weapon / FighterWeapon / Explosion as well,
  `lastIonStrike`, `canHyperJump`, `lastLocationEffectTouch` added, the audio flags dropped; gate lists (`attackers`,
  `locationEffects`); child containers hot; related targets and parent habitats; the player's system visibility and
  giant-ion-cannon habitats touched every step; `Galaxy.systems[].creatures` hot.
- Habitat-fired shots: the cannon is its habitat's touch child, and the habitat's LastTouch comes with it (mixed field).
  Planet explosions and bombardment: hot-stream fields, compared through the firing shot's target.
- `builtObjectIndexGrid` stays cold (consumer audit §3: 400 000-unit cells, one reader, splices would go hot).
- Audio: `mainViewSounds.ts SoundMarks` — render-side marks on a replica (`ReplicaSoundMarks`), the sim's flags
  in-thread (`simFlagSoundMarks`, unchanged). An ion hit that disables nothing re-arms the C# flag without a new
  LastIonStrike, so on a replica only strikes that land are heard. The event stings ride on
  `Empire.eventMessageRecipient`, which the worker's sim calls on its own empire: on a replica `gameAudio.ts` no
  longer defines it (one writer of chunk 0's `Empire.eventMessageRecipient` finding gone; `ui/eventMessages.ts` is the
  other), and chunk 4's event-message handler plays them with `gameAudio.ts playEventMessageSting`.
- Write detector (smoke `--detect-writes`, late save, combat and hyperjump views added to the smoke): no chunk-2 key
  left (`*SoundPlayed` gone); what remains is chunk 4's.
- Hot-apply spikes: mission / design / fleet references compared hot but sent cold, births-only dependencies (§3.3).
- Interpolation timing: `clientCore.ts StepPacer`, a playout buffer in step units (`?simPace=0` turns it off).
  With chunk 1's optimistic pause: the picture stops at the press (drawn position held at the latest applied step;
  the steps in the buffer and in flight land with the ack in one frame, on the same interpolation line), while the
  replica's clock lands a few steps past it — the smoke's "pause is instant" check reads the drawn time when paced.
  A message carrying a command / query reply is held at most 50 ms (`REPLY_WAIT_MS`).
- Tests: `test/replicaHotStreams.test.ts`, `simWorkerMainView.test.ts`, `simWorkerPacing.test.ts`,
  `mainViewSoundsReplica.test.ts`; the smoke reports the render pacing (`--gpu=egl`, `--qs=`).

Original brief:
- Files: `render/mainView.ts`, `renderInterp.ts`, `builtObjectIndex.ts`, `builtObjectLayer.ts`, `fighterLayer.ts`,
  `creatureLayer.ts`, `effectsLayer.ts`, `ambientLayer.ts`, `shipOverlays.ts`, `liveryLayer.ts`, `combatBars.ts`,
  `rangeRings.ts`, `followCamera.ts`, `fog.ts`, `src/audio/mainViewSounds.ts`, `gameAudio.ts`.
- Work: validate audit §3 against `alwaysHotFields` per layer (add fields, never sets of fields that change every step
  without being needed); habitat-fired shots (Habitat weapons are cold); `builtObjectIndexGrid` (cold, read by fog
  through `findShipOutsideSystemWithScanRange`); **audio's `*SoundPlayed` writes to a render-side WeakSet** (on a
  replica a re-armed flag is never re-sent, so later sounds go missing); interpolation timing (alpha from the step
  message's backlog plus arrival time) under jitter.
- Test: perf-render `--qs=simWorker=1`; compare screenshots of combat and hyperjumps in both modes.

**Chunk 3 — map overlays and scenario map art.**
- Files: `render/empireLayer.ts`, `overlayLayer.ts`, `galaxyMarkers.ts`, `battleIcons.ts`, `freightOverlay.ts`,
  `artBundleLayer.ts`, `threatMarkers.ts`, `wreckDebris.ts`, `leagueArt.ts`, `concord*.ts`, `empireLineage.ts`,
  `rimAtmosphere*.ts`, `rimDust.ts`, `ui/screens/galaxyMap.ts`, `tradeFlows.ts`, `ui/freightText.ts`,
  `ui/mapOverlays.ts`, `ui/scenario/wreckageUi.ts`.
- Work: trade-flow recording runs in the worker (a command or init flag), and the ledger is synced as a side-table
  root; the rim install (`installRimWeights` / `installRimNameOverrides` write `galaxy.scenario.state`) runs in the
  worker at boot.
- Test: overlay screenshots in both modes; a freight ledger equality test through the host.
- **Done.**
  - *Trade flows.* `tradeFlows.ts setRemoteTradeFlows` is registered on the replica, the same pattern as
    `setRemoteCommandSink`. The overlay's unchanged enable / disable calls post a `tradeFlows` message, which is not a
    command and is not journaled. The worker records on the authoritative galaxy. The ledger travels as a view in the
    side-tables root (`tradeFlows`). The view shares `entries` and carries `version`, `startStarDate` and a Map of
    the live freighters' contract destinations, refreshed at most every 15 ticks. The sim keeps those destinations in a
    WeakMap, which cannot be synced. `index` stays empty, because only the recorder reads it. Until the first sync
    the replica shows an empty placeholder.
  - *Rim.* `installWorkerBootState` (simHost.ts) runs `installRimAtmosphereData` in the worker after create or load,
    before the first tick. On a replica the call is a no-op. The rim curve moved to Pixi-free `render/rimCurve.ts`.
  - *Reads.* The overlay readers are write-free on a replica. The territory overlay's sources
    (`colonyInfluenceRadius`, `colonies`, `active`, explored systems) arrive cold, and its 30-frame signature poll
    follows them.
  - *Tests and tools.* Tests: `test/simWorkerMapOverlays.test.ts`. Smoke: `scripts/simworker-overlays-smoke.mjs`
    (`--inthread`, `--scenario=rim-atmosphere`).

**Chunk 4 — messages, events and game end** (the largest write cluster, audit §4 items 2–7 and 9).
- Files: `ui/empireMessageFeed.ts`, `messagePopups.ts`, `messageStubList.ts`, `messageStubs.ts`, `messageRouting.ts`,
  `messagePicture.ts`, `messageGoto.ts`, `conversationActions.ts`, `eventMessages.ts`, `advisorSuggestions.ts`,
  `pirateProtectionPrice.ts`, `ui/screens/galacticHistory.ts`, `messageHistory.ts`, `empireComparison.ts`.
- Work: `Empire.messages` is emptied by the sim between syncs, so the main thread can miss messages; add a worker →
  main "player message" event stream. Move the starDate stamp, the history and advisor-queue writes,
  `eventMessageRecipient`, `sendEmpireMessage`, `removeOldHistoryMessages` and `onGameEnd` into the worker (as
  commands or worker-side handlers). Port the game-end banner on top of the `gameEnd` event.
- Test: a host test where scripted sim events produce messages, and the main side sees each exactly once.

**Chunk 5 — HUD, selection and orders.**
- Files: `ui/hud.ts`, `selectionInfo.ts`, `selectionInfoView.ts`, `leftSidebar.ts`, `leftSidebarView.ts`,
  `orderMenu.ts`, `shipCommandKeys.ts`, `shipHotkeys.ts`, `topBar.ts`, `mapTooltip.ts`, `pickMenu.ts`,
  `listSelection.ts`, `screens/coloniesList.ts`.
- Work: the order menu's `galaxy.rnd` draws (`selectRelativePoint` and friends) must move into the command, which
  picks its point in the worker, or become a worker query; the async `onApplied` contract for selection follow-ups;
  selection of objects that the replica dropped (destroyed ships).
- Test: right-click and action-menu orders through the host give the in-thread command log.

**Chunk 6 — empire management screens** (about 1 Hz, command-only).
- Files: `ui/screens/coloniesScreen.ts`, `constructionYards.ts`, `buildOrder*.ts`, `buildQueue*.ts`,
  `shipsAndBasesList.ts`, `shipDesigns.ts`, `designEditor.ts`, `designPanelsModel.ts`, `fleetsList.ts`,
  `fleetDesignsTab.ts`, `troops.ts`, `research*.ts`, `empirePolicy*.ts`, `gameOptionsPanel.ts`, `expansionPlanner.ts`,
  `empireSummary*.ts`, `charters.ts`, `galactopedia.ts`.
- Work: async `onApplied`; by-value arguments (DesignDraft, policies) through `remoteArgs`; confirm that the heavy AI
  queries the planner runs are write-free on the replica.
- Test: per screen, the command it issues through the host gives the in-thread digest; screenshots in both modes.

**Chunk 7 — diplomacy, intelligence and politics.**
- Files: `ui/screens/diplomacyScreen.ts`, `diplomacyRelationsView.ts`, `empireIntel.ts`, `empiresList.ts`,
  `tradePanel.ts`, `warTermsPanel.ts`, `intelligence.ts`, `characterEventText.ts`, `ui/courtView.ts`,
  `emergentPolitics.ts`, `internalSecurityView.ts`, `scenario/rimTraderRows.ts`, `leagueRows.ts`.
- Work: `obtainDiplomaticRelation` creates a relation on read (use a non-creating lookup); delete the dead
  intelligence mutators; by-value IntelligenceMission / TradeNegotiation / PeaceTerms arguments.
- Test: proposal and trade flows through the host vs in-thread.

**Chunk 8 — LLM and AI advisor.**
- Files: `src/llm/*`, `ui/advisorClient.ts`, `advisorPanel.ts`, `diplomatVoice.ts`, `aiAdvisorDriver.ts`,
  `aiAdvisorLog.ts`, `llmOverlay.ts`.
- Work: `runPlayerCommand` (advisorCommands, diplomatCounter) and `applyStrategicDecisions` become queued commands
  with async results; `storeChronicleYear` becomes a command; `drainVoiceCues` becomes a worker → main event; the
  brief builders run on the replica (read-only) or in the worker.
- Test: advisor turn through the host; aiAdvisor18c's import-walk test still holds.

**Chunk 9 — sync performance** (independent of the others).
- Files: `src/simworker/*`.
- Work: a streamed snapshot (boot); fewer forced cold dependencies (cold-kind births in the cold stream); time-sliced
  forced parts; a SharedArrayBuffer ring for hot positions if cross-origin isolation is enabled in the desktop shell
  (`desktop/main.cjs` can set COOP/COEP); worker GC (the shadows roughly double the worker heap).
- Test: `scripts/sync-measure.mjs --verify` stays identical; perf-render numbers in this document.
