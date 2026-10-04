# Sim worker: the simulation on its own thread

Status: **the default (2026-10-03, after the final check in §10).** Every game (new, loaded, tutorial, restarted) runs
its simulation in a Web Worker, in the browser and in the desktop app. The in-thread mode stays as the fallback (§6):
`?simWorker=0`, or Options → "Simulation in a worker thread (next game)" unticked (main menu Options or the game menu's
option list). With it, the game runs exactly as before the worker: one thread, the same code path. `?simWorker=1`
forces the worker whatever the setting says.

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

### 2.5 Presentation clock: smooth drawn motion when steps land unevenly (both modes)

`src/render/renderInterp.ts PresentationClock`, run by `MainView.update` over the loop's raw render time
(`?renderClock=0` turns it off). When a late-game step costs more than its frame, steps land several per frame and
then none (in-thread), or in bursts of messages (worker), and drawing the latest step stutters. The clock is a
render-side playout buffer in step units: it advances at the rate steps have been landing (2 s of arrivals), a little
faster or slower (bounded, filtered) to stay `delay` steps behind raw (stepSerial − 1 + alpha); `delay` covers how far
raw dips below its steady line (about 0 when steps land evenly, so the in-thread loop draws exactly what it drew
before), grows when the clock has to wait at the latest step, shrinks slowly; a large lag eases out at up to 2.5× rate
(only a lag over 60 steps jumps); paused, it stands still. Each object keeps its last 8 step samples
(`MotionInterpolator`) and is drawn between the two that bracket the presented step; `renderNowMs` (orbits, effects)
is the game time one step after it, through the committed steps' own times. Ships flying relative to a planet or base
(ParentOffset) are now extrapolated between round-robin touches like free-flying ones (they stood still and jumped
every ~10 steps on a 10 000-ship galaxy). Tests: `test/renderInterp-presentClock.test.ts`, `simWorkerPacing.test.ts`.

Drawn motion on the late saves (`scripts/perf-render.mjs --load=… --gpu=egl --motion`, 60 Hz headless compositor, 4×
speed; q = a ship's drawn move per frame over its true speed × the sim's measured rate; stall = q < 0.25):

| save, mode, zoom | before: stall % / q p95 / jerk p95 | after: stall % / q p95 / jerk p95 | drawn lag (steps), before → after |
|---|---|---|---|
| late2500, in-thread, galaxy | 57.0 / 9.74 / 9.80 | 0.00 / 1.01 / 0.26 | 0.02 → 0.06 |
| late2500, in-thread, system | 76.5 / 9.32 / 9.32 | 0.02 / 1.01 / 0.01 | 0.07 → 0.11 |
| late2500, in-thread 2× + 14 ms steps, galaxy | 51.7 / 4.95 / 4.97 | 0.02 / 1.06 / 0.04 | — |
| late2500, worker, galaxy | 48.1 / 5.00 / 5.65 | 0.04 / 1.13 / 0.11 | 8.4 → 6.6 |
| late2500, worker, system | 68.7 / 5.12 / 4.96 | 0.22 / 1.10 / 0.05 | 7.6 → 9.2 |
| late2500-1200, in-thread, system | 75.5 / 9.39 / 9.52 | 0.00 / 1.01 / 0.02 | 0.07 → 0.12 |
| late2500-1200, worker, sector | 36.5 / 2.43 / 9.19 | 2.15 / 1.27 / 0.09 | 8.6 → 11.9 |

Most of the "before" stalls are ships drawn in a planet's frame (ParentOffset) between round-robin touches; the rest
(and the worker's clock stalls/jumps) is the arrival pattern. The worker's lag is a playout buffer either way
(StepPacer held messages back; the clock trails them); its frames that still stand still follow a main-thread hitch
(a 112 ms cold apply in that sector run). Worker lag figures come from separate runs of the same setup.

**Headings (2026-10-04).** CalculateCurrentHeading (BuiltObject.2.cs 7433) turns a ship by GetCurrentTurnRate × the
whole time since its last touch, so on a 10 000-object galaxy a turning ship held its heading for ~11 steps and then
swung by the whole turn at its next touch (positions were already extrapolated between touches, headings were not).
`sampleBuiltObject` now samples a ship the sim turned at its latest touch (its committed heading changed from the
touch before: a ship whose command does not turn it — waiting, docked — keeps a TargetHeading it does not face) at the
heading its next touch gives it: toward TargetHeading at the C# rate (`builtObjectTurnRate`: speed bands, fleet and
captain bonuses), clamped on the target, and moves it along that heading as DoMovement does; a ship preparing a
hyperjump accelerates first (`nextTouchSpeed`, the HyperTo leg's order). What the next touch decides that the samples
could not show — a turn begun or re-aimed there, a command that does not turn the ship for a touch (SetParent between
HyperTo and MoveTo, a Dock waiting for its bay) — is eased at 2 × the turn rate (`HEADING_EASE_FACTOR`,
`MotionInterpolator.sample` turnLimit; `easeHeadings` off for A/B) instead of turned in one step; teleports and warp
legs still snap. Fighters and creatures already extrapolated their turns (extrapolateMover); they get the same ease,
and the creature's unwrapped CalculateCurrentHeading (Creature.cs 685) is now ported exactly (`turnHeading`). Worker
mode needs nothing new: `_heading`, `targetHeading`, `currentSpeed`, `_targetSpeed`, `hyperjumpPrepare` and
`lastTouch` are fixed hot fields gated by lastTouch, so they travel in the step that touched the ship — the only step
they change in; TurnRate / AccelerationRate (design values), the fleet bonus and the captain side table travel cold.
Tests: `test/renderInterp-heading.test.ts` (the sim's own CalculateCurrentHeading on a synthetic round-robin fleet, both
loop modes; the ports against movement.ts / Creature / Fighter; a real 4000-star galaxy padded to 10 763 objects,
in-thread and end to end through SimHost / SimClientCore; fighters in a fight; creatures).

`scripts/perf-render.mjs --motion` now also measures headings: the sim's continuous heading is its committed heading at
each touch lerped between touches; on a steady turn (every touch interval around the drawn instant turned at one rate)
q = drawn heading change per frame / the sim's, stall q < 0.25, jump q > 2.05 (the ease runs at exactly 2), reversal
q < 0, jerk |Δq|. `late4000.dwusave` (`scripts/lategame-start.mjs --stars 4000 --seconds 1200`: 5 458 systems, 142 k
habitats, 10 763 built objects), 60 Hz headless compositor, before → after:

| mode, speed, zoom | stall % | jump % | reversal % | jerk p95 | largest step per frame p99 / max (°) |
|---|---|---|---|---|---|
| worker, 4×, system | 59.0 → 0.36 | 13.4 → 0.21 | 3.72 → 0.00 | 8.03 → 0.02 | 6.9 / 29.8 → 2.0 / 4.3 |
| worker, 4×, sector | 60.5 → 0.55 | 15.2 → 0.27 | 2.61 → 0.02 | 7.01 → 0.03 | 6.6 / 11.7 → 1.4 / 4.1 |
| worker, 1×, system | 73.4 → 0.00 | 17.4 → 0.06 | 0.93 → 0.00 | 7.66 → 0.10 | 1.7 / 4.4 → 0.5 / 1.0 |
| worker, 1×, sector | 70.1 → 0.00 | 18.5 → 0.06 | 0.52 → 0.00 | 5.07 → 0.09 | 1.4 / 2.0 → 0.3 / 1.1 |
| in-thread, 4×, system | 82.4 → 0.16 | 9.5 → 0.16 | 0 → 0 | 10.18 → 0.00 | 10.7 / 28.8 → 1.9 / 4.1 |
| in-thread, 4×, sector | 82.3 → 0.25 | 9.3 → 0.30 | 0 → 0 | 9.88 → 0.00 | 6.8 / 11.5 → 1.4 / 4.1 |
| in-thread, 1×, system | 82.1 → 0.00 | 9.3 → 0.07 | 0 → 0 | 10.08 → 0.01 | 1.8 / 5.2 → 0.5 / 0.6 |
| in-thread, 1×, sector | 82.0 → 0.00 | 9.3 → 0.34 | 0 → 0 | 9.70 → 0.01 | 1.7 / 7.3 → 0.8 / 1.5 |

Ships drawn turning that the sim did not turn: 0.00-0.07 % of the frame pairs in still intervals; turning on away
from where a turn stopped (a command that did not turn the ship): 0-0.7 % of the pairs just after a stop. Position
motion and the clock are unchanged (q p50 1.00-1.02; position stalls only where the clock starved after a worker
hiccup, ≤ 0.8 %), and MainView.update is too (galaxy zoom 4.87 /
4.87 → 4.89 / 4.32 ms, system 3.36 / 3.91 → 3.46 / 3.08 ms, alternated runs); sampling all 10 654 ships in node costs
3-17 % more (0.1-0.5 ms a frame), while the view samples only those on screen.

### 2.6 Chunk 9: sync performance in big late games (2026-10-03)

What was wrong on the late saves (`late2500`: 9.8 k ships; `late2500-1200`: the same galaxy 1 200 s later, 144 MB):

- **Main-thread hitches of 17-112 ms** (435 ms at worst in node) whenever a command reply landed — the HUD's own
  commands (money panel, UI records) included: `applyThrough` applied the whole cold backlog in that frame, and the
  backlog sat at 20-30 parts because the pump's budget grew too slowly. A cold part with many newborns cost far more
  than its size: the decoder's object → id **WeakMap** (2.4 M keys) took ~5 µs per insert and stalled for up to a
  second under churn, and its id array went sparse (dictionary mode) whenever a later hot part's ids landed first.
- **270 KB of hot part per step**: 40 bytes per field set (five float64s), and 2 100 of the ~6 500 hot sets a step were
  idle weapons' `resetNext` flipping on every touch.
- **Worker diff 12-16 ms per tick, 8-10 ms of it the hot pass**: every gated ship's and every hot array's shadow was
  read every step, although the sim touches about a tenth of them.

The fixes (§3.2-§3.4, §4.3): a compact wire format (uint32 codes, f64 lane only for numbers that need it, one Set record
per object), guarded hot fields, probe registries for the hot pass, a dense decoder with a Map, budgeted dependency
births, command replies that wait for their cold parts under their own budget, and a faster-growing cold pump budget.

`node scripts/sync-measure.mjs <save> --steps 300 --verify` (worker and main thread in one process; load average 10-20):

| late2500 | before | after |
|---|---|---|
| hot part KB per step (mean / p95 / max) | 272 / 500 / 549 | **56 / 68 / 144** |
| delta KB per step (mean / p95) | 447 / 819 | **121 / 190** |
| main hot apply ms (mean / p95 / max) | 0.42 / 0.77 / 6.6 | 0.42 / 0.66 / 3.6 |
| main cold pump ms per frame (mean / p95 / max), backlog parts p95 / max | 0.80 / 1.74 / 2.83, 23 / 29 | **0.25 / 0.53 / 3.75, 0 / 2** |
| snapshot: size, main-thread apply | 425 MB, 2.7 s | **201 MB, 1.0 s** |
| `--verify` (replica save text, digest) | identical | identical |

`node scripts/sync-measure.mjs <save> --client --steps 600 --replies 30 [--verify]` — new: SimHost and SimClientCore
end to end, as the browser runs them (each message structured-cloned, `frame()` timed, a command with a reply every
30 steps, one frame per step):

| late2500, 1× | before | after |
|---|---|---|
| main `frame()` ms (mean / p95 / max) | 4.52 / 9.96 / 435.6 | **0.84 / 2.25 / 8.8** |
| frames over 8 / 16 ms (of 600) | 35 / 19 | **2 / 0** |
| of which hot apply (mean / p95 / max) | 3.41 / 5.36 / 435.5 | 0.41 / 0.56 / 8.3 |
| of which cold pump (mean / p95 / max) | 0.94 / 2.49 / 11.9 | 0.34 / 1.03 / 6.8 |
| the frame that answers a reply (mean / max ms) | 80 / 436 | **1.5 / 6.5** |
| reply latency | the frame it lands | 1.1 frames mean, 2 at p95 |
| replica built from the snapshot | 7.2 s | 1.7 s |
| `--verify` | identical | identical |
| at 4× speed: `frame()` max, frames over 16 ms, reply frame mean (two runs each) | 104 / 186 ms, 13 / 11, 42 / 44 ms | 11 / 11 ms, 0 / 0, 2.3 / 2.0 ms |

| late2500-1200 (load average 6-10) | before | after |
|---|---|---|
| hot part KB per step (mean / p95 / max) | 283 / 521 / 544 | **57 / 69 / 153** |
| delta KB per step (mean / p95) | 498 / 881 | **143 / 212** |
| main hot apply ms (mean / p95 / max) | 0.34 / 0.52 / 6.2 | **0.22 / 0.33 / 1.9** |
| main cold pump ms per frame (mean / p95 / max), backlog p95 / max | 0.47 / 1.10 / 3.5, 11 / 19 | 0.18 / 0.51 / 4.1, 0 / 1 |
| snapshot: size, main-thread apply | 449 MB, 2.3 s | **213 MB, 0.73 s** |
| client mode: `frame()` ms (mean / p95 / max), frames over 16 ms | 1.31 / 1.87 / 48.2, 7 of 600 | **0.43 / 1.00 / 4.9, 0** |
| client mode: the frame that answers a reply (mean / max ms) | 13.4 / 48.2 | **0.87 / 2.8** |
| client mode: worker hot pass / diff ms (mean) | 4.41 / 7.80 | 3.76 / 7.19 |
| `--verify` (both modes) | identical | identical |

Worker, the same client runs alternated base / chunk 9 (1×, 400 steps): hot pass 10.5 / 9.4 → 8.4 / 6.7 ms mean, diff
15.6 / 14.3 → 13.9 / 11.5 ms mean (the probe registries alone, A/B in one process: hot pass −21 %). The cold pass keeps
its 3 ms budget per tick.

Browser, `scripts/perf-render.mjs --load=<save> --motion --gpu=egl --speed=4 --qs=simWorker=1` (60 Hz headless
compositor; `--eval` of a script that ignores pause writes, as the late saves raise an event popup that pauses the game
after about 20 s; base and chunk 9 alternated, load average 9-18):

| zoom | hot ms/frame | cold ms/frame | max hot / max cold / max sync ms | delta KB (last message) | lag steps (mean) | clock stall % |
|---|---|---|---|---|---|---|
| late2500 galaxy | 0.27 → 0.30 | 0.37 → 0.21 | 1.5 / 4.4 / 4.4 → 6.7 / 2.2 / 7.2 | 765 → 133 | 7.8 → 12.2 | 0 → 0 |
| late2500 sector | 0.28 → 0.30 | 0.31 → 0.17 | 3.7 / 7.3 / 7.8 → 4.8 / 2.4 / 6.9 | 1 111 → 316 | 7.2 → 9.3 | 0.57 → 0 |
| late2500 system | 0.33 → 0.26 | 0.33 → 0.18 | 1.6 / 1.3 / 2.5 → 2.5 / 1.1 / 3.0 | 459 → 212 | 4.0 → 11.2 | 0 → 0 |
| late2500 planet | 0.41 → 0.15 | 0.31 → 0.21 | 4.4 / 4.1 / 6.1 → 0.9 / 1.3 / 1.4 | 2 127 → 127 | 10.7 → 10.2 | 0 → 0 |
| late2500-1200 galaxy | 0.37 → 0.22 | 0.24 → 0.20 | 4.7 / 1.3 / 5.2 → 4.0 / 2.0 / 4.6 | 1 459 → 197 | 11.1 → 10.7 | 0.28 → 2.22 |
| late2500-1200 sector | 0.30 → 0.27 | 0.27 → 0.15 | 2.1 / 0.9 / 2.7 → 5.9 / 1.5 / 6.2 | 1 817 → 383 | 9.6 → 12.5 | 0 → 1.76 |
| late2500-1200 system | 0.38 → 0.21 | 0.71 → 0.19 | 5.1 / **165.6** / **165.6** → 2.2 / 1.2 / 3.0 | 829 → 205 | 11.3 → 10.9 | 0.85 → 0 |
| late2500-1200 planet | 0.42 → 0.20 | 0.19 → 0.13 | 5.2 / 0.6 / 5.7 → 2.4 / 1.5 / 2.9 | 1 288 → 280 | 12.9 → 12.0 | 1.66 → 0 |

fps is 56-60 at every zoom in both (vsync-bound); the worker ran 60 steps/s in both. The main thread's sync cost per
frame is down by about a third and its worst frame by an order of magnitude where the old path hit a big cold apply.
The drawn lag and the clock's stalls did not move: they follow the worker's per-tick cost on this loaded machine (step
3-37 ms + diff 7-33 ms per tick in these runs, so the messages carry 2-4+ steps and the clock's playout buffer holds
about two bursts), and they swing with the machine's load between runs (base 4.0-12.9 steps, chunk 9 9.3-12.5 in the
same pairs; §2.5's runs: 6.6-11.9).

**The presentation clock (tried, not changed).** On the synthetic arrival patterns of the clock tests (bursts of 4-6
steps every 60-90 ms, 1-8 at 30-130 ms, a worker behind with 1-4) the dip-based delay holds about twice what the clock
needs: lag 10.1 steps where the burst needs ~5. Trimming the headroom the clock never used over its window
(and a lower slack) brought it to 7.0-7.4 without a stall on those patterns, but with occasional worker gaps (a
150-270 ms hiccup every few seconds, as these runs show) it starved 3-4× as often, and in the browser it raised the
clock stall % at two of four zooms; holding the trim off for 10 s after a starve left a 7 % gain. Not worth the
stutter: the clock is unchanged, and the lag comes down with the worker's per-tick cost (§8 "Worker headroom").

`scripts/simworker-smoke.mjs <url> --load=/dev-saves/late2500.dwusave --gpu=egl`: SMOKE OK; render pacing mean / p95 /
max |drawn − wall × rate| 0.51 / 1.28 / 3.62 ms → 0.38 / 1.00 / 2.79 ms, no frame standing still; worst hot apply over
the run (command replies, screens, the UI flows) 11.0 → 5.8 ms, worst cold pump 5.1 → 1.8 ms. With `--detect-writes`
(the UI tour): 0 unexpected keys, replica digest = worker digest after the tour.

**SharedArrayBuffer.** `crossOriginIsolated` is false in Vite dev and in the Electron shell (neither sends COOP / COEP;
`desktop/main.cjs` serves `dwu://` through `protocol.handle` without them), so `SharedArrayBuffer` is not defined there.
It is not used: the delta streams are already transferred (zero copy), and the hot part is now ~56 KB, so a shared ring
would save one allocation per message at the cost of cross-origin isolation for every asset; nothing needs to degrade.

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

**Wire format (chunk 9).** Records are uint32 codes: a header (`op + 8 · n`) and the object's id, then the record's
values. Consecutive sets of one object share one Set record of n (key, value) pairs, key = slot · 16 + tag. A value is
its tag, then its payload in the narrowest lane that holds it exactly: an integer in [0, 2³²) or a float32-exact number
(the sim's C# `float` fields) is one code, any other number goes to the stream's f64 lane, a ref / string / static is
one code (sync id, string index), true / false / null / undefined none. So a moved ship's position, heading and touch
cost about 40 bytes instead of 200, and every value arrives bit-exact (−0, NaN and ±Infinity included). Strings and
typed-array contents ride alongside, as before.

**Hot pass registries (chunk 9).** Gated objects (BuiltObject, Fighter, Creature) are not walked through their shadows
every step: each gated class keeps a dense list with the values its ungated fields (the gate, hasBeenDestroyed) had at
the last gate compare, numbers in an f64 lane. The hot pass probes each object against that record (one read of the
object, no shadow or shape lookup) and runs the gate compare only for those that changed: about a tenth of the ships on
a late galaxy. Hot arrays (ships' and fighters' explosion lists, a system's creatures, …) are listed densely with their
length at the last compare: an array that was empty then and is empty now is skipped. Both are exact: any other compare
that changes the object's shadow (the cold pass, compareNow, a touch) invalidates its entry (emitSet / writeContents),
so "unchanged since the last compare" means "equal to the shadow". `hotRegistries: false` turns them off (A/B).

**Guarded hot fields (chunk 9).** `hotFieldGuards` (replicaGalaxy.ts): a fixed hot field compared at the step rate only
while its guard field is ≥ 0. Weapon.resetNext / FighterWeapon.resetNext flip on every touch of an idle weapon (no
target: reset next, then reset), 2 000+ sets a step on a late galaxy; the view reads them only for a shot in flight
(effectsLayer.ts shotFlightSpeed: distanceTravelled > 1; reset() sets −1). The cold pass still compares them, in the hot
stream (a fixed class's pinned slot), so the replica is exact within a cycle.

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
  then the hot body. Since chunk 9 those births are budgeted (`depBudgetMs`, 4 ms a frame): when they do not fit,
  `apply` returns `pending` and the message — and every message after it — waits for the next frame, where the same
  call continues. Nothing references the newborns until the hot body is applied, so readers never see a half-built
  object; the replica's hot state stays at the previous message meanwhile, and the cold pump waits.
- **Main thread, per delta:** register the shapes, apply the hot part, queue the cold part.
- **Main thread, per frame:** pump the cold queue for 0.5 ms. The budget grows by 50 % per queued part beyond 2, up to
  8× (`coldPumpScale`; it was +10 % beyond 4, up to 4×, and the queue then sat at 20-30 parts on the late save: a
  third of a second of cold data, all of which a command reply applied at once). A part may be left half-applied, but
  only between objects: never between an array's new length and its element sets.
- **Command replies** wait for the cold parts through their delta (§4.3 "Freshness of `onApplied`"): those parts are
  pumped first, under `replyBudgetMs` (4 ms a frame), and the replies — with the events of their message and of the
  messages after it, in order — are delivered once they are in. A message's events are delivered before its own cold
  part applies (its drops among them), a reply after it.
- **The side tables** (what the save keeps beside the graph: prices, characters, captain bonuses, Random draw counts,
  race fields, plague levels) are recollected into the side root as each cold cycle starts (`ReplicaEncoder
  .onCycleStart`, inside the diff, before the cycle's first compare; and before a full compare), and go onto the
  replica's objects every 60th apply with the cold queue empty, or once the stream has been idle for 30 cold pumps
  (`GalaxyReplica.pumpCold`). Before §10 they were recollected at the delta after the wrap — after the new cycle had
  already compared the side root (low ids) in the same call — and applied only on the 60th apply, so a paused game,
  whose stream stops one full cycle after its last change, kept the previous draw counts on the replica for good
  (replica digest ≠ worker digest while paused; `test/simWorker.test.ts` "a paused game settles").

### 3.4 Decoding (main thread)

- Class instances are built by generated per-shape constructors (one hidden class per shape, as save loading does),
  so the replica is as fast to read as a loaded game.
- The id tables are dense (`objs` is filled with null ahead of ids not born here yet, kinds / shapes are typed arrays)
  and the reverse map (replica object → sync id) is a Map: at 2.4 M keys a WeakMap insert cost about 5 µs, with GC
  stalls of up to a second under churn — it was 80 % of the cold pump and most of the snapshot apply.
- Field sets go through generated per-shape setters.
- Save revive hooks (Cargo, Random) are honoured.

## 4. Protocol, ownership and commands (src/simworker/protocol.ts, simHost.ts, clientCore.ts, worker.ts)

### 4.1 Messages

Main → worker:

- `init {boot: create(options without gameData, scenario) | load(save text, scenario), startOptions, clock?, sync?}` (the
  wizard's flag pick and message options are createGame options: `playerFlagShape`, `messageOptions`)
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
- **Fresh replies (chunk 6).** Besides the precise compare of a command's arguments and result (see "Freshness of
  `onApplied`" below), the host compares what they and the issuing empire reach, breadth-first, at most 3 levels and
  3000 objects (`ReplicaEncoder.compareReach`). So a screen's refresh in `onApplied` sees, for example, the list a
  new fleet template went into. Both compares reshape a class instance that has gained a lazily set `declare`d
  field (e.g. `Empire.fleetDesigns`, `constructionBoard`). The round-robin cold pass does not notice new fields.
  Ops that name what they change by a number add the book it points into, read after the executor ran
  (`simworker/commandReach.ts commandFreshRoots`): `fleetTemplate*` the fleet design book with every template and build
  order, `constructionJob*` the construction board and its jobs. A template's rows are past the reach of the ids and
  the empire (on a real empire the 3000 objects go to the empire's own lists first), so before §10 the Fleet Designs
  tab re-rendered in Add Design's reply on the old rows and the new row did not show (`test/simWorkerScreens.test.ts`
  "by id").
- **Refresh on open** (`simworker/refresh.ts requestSimRefresh`, message `refresh`): when a screen opens, it asks the
  worker to `compareReach` the objects it shows. It re-renders once they have arrived: the reply waits for the cold
  parts through its delta, as a command reply does (§4.3 "Freshness of `onApplied`"). In-thread this is a no-op.
- **`runPlayerCommand`** (synchronous result) throws on a replica. Its two callers, the advisor chat and the diplomat
  voice, are in §9 chunk 8.
- **By-value identity** (`remoteArgs.ts RemoteValues`). By-value objects carry a main-thread value id. Shared or cyclic
  values within one argument decode to one object. The same main-thread object sent by several commands decodes to
  one worker object, as the executors share it in-thread (a mission assigned by one command and framed by the next):
  before its first command is applied, it is refilled with the latest contents; after that, for two boundaries, only
  the fields the main thread changed since its last send are written, so the sim's own changes stay. The worker kicks
  a paused tick as a task of its own (`worker.ts kick`), so commands posted together reach one boundary.

### 4.4 UI calls that write the game (order menus, selection buttons, money panel, lookups)

Some UI calls are not orders but still change sim state, as the C# UI does: building the right-click action menu and
the selection panel's buttons draws `galaxy.rnd` (the "Build here" designs, the build pages' surface / parking points,
`DetermineOrbitalBaseLocation`) and runs `ReviewLatestDesigns`; the money panel runs `CheckAgeVariableIncome`; many
reads obtain (add) the relation / evaluation records they look up. None of them may write outside the journaled
command queue (§8 "UI sim writes"): they are either **journaled player commands** whose reply is what the UI shows —
`actionMenu`, `selectionButtons` (only the pages that draw, `orderMenu.ts selectionButtonsDrawRandom`),
`habitatDispatch`, `moneyPanel` (only when `treasury.ts moneyPanelWriteDue`), `obtainUiRecords` — or **read-only UI
reads** (`sim/readOnlyQuery.ts`) that run on the replica in worker mode and on the in-thread game between frames:

- A command is applied at the next frame boundary in both modes, journaled and replayed; in worker mode its reply comes
  one round trip later (once the cold parts through its delta are applied, as every reply). A reply for a right-click
  or a selection / page the UI has left since is not shown.
- A read-only lookup answers with the value it would give (a detached record, the aged figure) and writes nothing. The
  records the C# UI's lookups add are asked for (`requestUiRecord`) and added by one `obtainUiRecords` command per UI
  task, the same in both modes. Port-only reads (the local-model briefs) use `withPureSimReads`: they ask for nothing.
- Gates: `test/simWorkerOrders.test.ts` (a scripted UI player: menus, button pages, dispatch, right-click, box
  selection, hotkeys, fleet point) gives the in-thread menus, command log and digest in worker mode, seed + the log
  replays the in-thread game exactly, and both fail without the menu commands; `test/uiSimWrites.test.ts` (each path:
  read twice → the save text and galaxy.rnd unchanged; the commands replay; worker = in-thread).

(Before this, these calls were *queries* — `simworker/simQuery.ts`, run directly in-thread and in the worker on a
replica, never journaled, so a replay of seed + log missed their writes. The query protocol is gone.)

**The player's message pipeline is sim code** (`sim/playerMessages.ts`, 2026-10-03). The game-state half of the C#
Main's handling of what the sim sends the player — ReceiveMessageInternal (Main.Part9.cs 1572: the advisor queue at
2226, the defeat game end at 1994-2020, the conversation stamp at 2361, the ticker line's stamp and history entry at
2404-2410 / method_251), method_523's event history message (Main.Part4.cs:487, 1311 / 1496) and
PromptForAuthorizationInternal (Main.Part9.cs 1053) — runs in the sim, the same code in every mode:

- *Where.* In the C#, Main is the player's IMessageRecipient / IEventMessageRecipient / IAutomationAuthorizer
  (Main.Part12.cs:2881), and each call from the sim threads is BeginInvoke'd onto the UI thread (Main.Part9.cs 1535
  ReceiveMessage, Main.Part4.cs:481 ReceiveEventMessage, Main.Part9.cs 1046 PromptForAuthorization), which handles
  them one at a time in arrival order whenever it gets to them — no fixed point. The port keeps that queue (the
  player's inbox, `messages.ts playerInbox`: SendMessageToEmpire, SendEventMessageToEmpire and
  PromptPlayerForAuthorization append to it) and drains it at fixed points, in arrival order: at the **end of every
  sim frame** (`scheduler.ts runSimFrame → playerMessagesFrameEnd`: the UI thread runs between the sim's frames),
  **after every applied command** (`playerCommands.ts applyOp`, the ai-advisor commands: a click handler finishes
  before the UI thread takes the next queued call), and before a save (`serializeGame`), so the inbox is empty at
  every save point and is not saved. A message sent while draining (an event's history message) joins the end of the
  queue and is handled in the same drain, as a BeginInvoke from the UI thread is. The inbox is attached when the
  game view would attach Main: at the end of createGame, on load, and lazily at the first frame or boundary.
- *Age expiry.* The advisor queue's age expiry (DiplomaticMessageQueue.cs 864 method_3) runs in the C# on every
  DrawMessages of the queue, i.e. on the UI's draw timer: it is sim-driven, at the end of every frame, after the drain.
  The `expireAdvisorSuggestions` command is no longer issued (kept for old logs).
- *The UI-triggered writes are journaled commands*, issued where the C# UI makes them: `removeOldHistoryMessages`
  (Galactic History's rebind, Main.Part4.cs:2986 method_542 → Empire.cs 4708; only when there is something to trim),
  `expireAdvisorSuggestionsForEmpire` (the advisor cases of ExpireDiplomacyMessagesForEmpire after a diplomacy
  exchange, DiplomaticMessageQueue.cs 344 / 357-380, called from Main.Part10.cs 4171 … and Main.Part2.cs 1919 …),
  `setMessageOptions` (the Message Settings and Suppress-all checkboxes, Main.Part6.cs:2406-2489). The `uiOp` message
  is gone.
- *Message options are game state.* What is stamped and recorded depends on Game.DisplayMessage* / DisplayPopup*
  (Game.cs:71-127), which the C# saves with the game and copies from the GameOptions at a new game (Start.2.cs
  2147-2188). They are `Galaxy.messageOptions` (saved; null = method_260's defaults), set at creation from
  `CreateGameOptions.messageOptions` and changed by `setMessageOptions`; the UI keeps a mirror
  (`ui/messageRouting.ts`) that adopts the game's options when a game view starts. The routing rules moved to
  `sim/messageRouting.ts`.
- *Stable suggestion ids.* A queued suggestion gets `EmpireMessage.advisorSuggestionId` from
  `Empire.nextAdvisorSuggestionId` (`advisorQueue.ts assignAdvisorSuggestionId`); commands name it as
  `{r: 'advid', k: [empire, id]}` (`commandCodec.ts`), so `approveSuggestion` / `declineSuggestion` find it however
  the queue changed around it. Logs from before the ids say `'adv'` (queue index), which still decodes.
- *The UI only reads and draws.* The pipeline hands each handled message's receipt (advisor / route / conversation
  action / ticker) and each event to the galaxy's listener (`setPlayerMessageListener`). In-thread
  `ui/messagePipeline.ts installLocalMessageStream` turns them into the game view's `PlayerMessageStream`; in worker
  mode the host sends them as `playerMessages` events (§4.5). The ticker (`empireMessageFeed.ts`), the popups and
  stubs (`messagePopups.ts`), the advisor window and the event panel read; none of them writes the game.
- *Deviations kept.* The C# also overwrites the message's Description with the formatted ticker line and fills an
  empty Title (method_251): the port keeps the sim's gameText() encoding and formats both when drawing. A popup
  message without a date is stamped when it arrives (port-only, for its stub's date).
- *Other open writes, closed here.* The chronicle store (`llm/chronicleJob.ts`) is the journaled `storeChronicleYear`
  command (the entry by value: seed + log replays the model's text; `runPlayerCommand` in-thread, `remote.command` in
  worker mode; the `chronicleYear` host op is gone). The wizard's flag pick is `CreateGameOptions.playerFlagShape`,
  written at the end of createGame (it was a write after createGame in main.ts and `workerBoot.ts`).
- *Save compatibility.* No version bump: the new fields are default-filled on load (`galaxySave.ts
  migrateEmpireMessageFields`: `nextAdvisorSuggestionId`, ids for the queued suggestions in queue order, the UI
  recipient fields as null; `Galaxy.messageOptions` reads as the defaults when absent). The UI recipient fields
  (`messageRecipient`, `eventMessageRecipient`) are no longer saved (CODEC skip list), so the save text is the same in
  both modes without the worker's old recipient toggling.
- Gates: `test/playerMessagePipeline.test.ts` (the arrival order; headless seed + log replays the history, the
  advisor queue and the options exactly, with suggestions approved / declined by id, the trim and the expiry;
  `'advid'` / `'adv'` decoding; a save written before the change, `test/fixtures/before-sim-message-pipeline.dwusave.gz`,
  loads, runs on and round-trips), `test/simWorkerMessages.test.ts` (headless = in-thread = worker: digest, log, save
  text and galaxy, each message delivered once in order; the UI-triggered writes are commands in worker mode; no
  replica writes), `test/llmChronicle.test.ts` (the chronicle command replays).

**Freshness of `onApplied`.** The host compares what a command named and returned (`ReplicaEncoder.compareNow`: the
issuing empire to depth 1, arguments and results to depth 2) in the delta of the tick that applied it, and the main
thread runs the command replies once the cold parts through that delta are applied. So a callback reads the replica as
of that boundary or later (one step or more later than in-thread), including cold fields. Until chunk 9 this was
`GalaxyReplica.applyThrough`, which applied the whole cold backlog in the frame the reply landed (17-112 ms on the late
save, 435 ms at worst); now the parts are pumped under `replyBudgetMs` a frame and the reply waits for them: about one
frame on the late save (§2.6).

**Dropped objects.** A BuiltObject, Habitat, ShipGroup, Creature, Fighter or Empire the replica no longer knows (destroyed
and dropped by the mark while the HUD still held it) is never sent by value. In a top-level array argument (a ships
list, a selection) it is left out with a warning, and the order goes for the rest (in-thread the executor gets the dead
ship and skips it). Anywhere else the command fails, and its
callback gets the op's failure value (see "Failed commands" below).

**Failed commands** (`clientCore.ts`, `simHost.ts settleCommands`, `commandFailure.ts`; test
`test/simWorkerCommandFailures.test.ts`). In-thread, every issued command reaches its executor at the next boundary, and
`onApplied` always gets its result. The only exception is an executor that throws: the frame stops, the game pauses with
"Simulation error", and the callback never runs. On a replica, every command issued with a callback is answered exactly
once, never inside the `issuePlayerCommand` call, and in issue order (a command that fails at once waits for the replies
of the commands ahead of it, as one boundary applies them in order).

| What happened | Callback | Promise (`remoteSimHost(g).command` / `hostOp`) |
|---|---|---|
| The executor ran (also a refusal: `false`, `null`, `-1`, `{ ok: false }`) | its result, as in-thread | resolves |
| The executor threw, or an unknown op | none, as in-thread. The worker pauses with a `simError` (toast) and replies `threw`, so nothing is left waiting; the commands after it apply at the next boundary | rejects |
| An argument cannot be sent (dropped object, unregistered class) or the worker cannot resolve it (stale sync id, unknown static), or the issuing empire is gone | the op's **failure value** (`COMMAND_FAILURE`: the value its executor returns when it refuses, with the reason as the message where the result has one) | rejects |
| The result has a part that cannot cross exactly (an unregistered class, a function) | the result with those parts made plain, logged loudly (`console.error`: make the type sendable) | resolves |
| The command reached a frame boundary after its deadline (`REPLY_TIMEOUT_MS`, 30 s after it was sent: the timeout policy below) | the failure value; the worker did not apply it and says so (`expired`) | rejects |
| No reply `REPLY_TIMEOUT_MS + REPLY_GRACE_MS` (60 s) after it was sent (the worker runs no frames: hung, or a lost message) | the failure value: the worker is declared unresponsive and stopped (next row) | rejects |
| The worker stopped (`worker.ts` fatal: its loop or the sync threw; an uncaught error; a message that could not be read; `SimWorkerClient.stop`) | the failure value, at once. Later commands fail in a microtask, and a `workerStopped` event shows a toast and the restart box (§4.6) | rejects |
| The game is closed, reloaded or a new one started (`SimClientCore.dispose`) | the failure value, in a microtask after the teardown. The command sink stays installed, so a command issued on the closed replica fails the same way | rejects |

**The timeout policy (deterministic: the worker decides).** Every command message carries a `deadline` (epoch ms,
`performance.timeOrigin + performance.now()`, the same clock in both threads: the send time plus `REPLY_TIMEOUT_MS`).
`SimHost.command` only decodes it; the frame boundary admits it (`SimHost.admitCommands`, called right before the
boundary's drain in `tick`, and before a save's or a debug `advance`'s flush): the boundary reads the wall clock once,
hands the commands whose deadline has not passed to the player queue in arrival order — they are applied by the drain
that follows, at exactly the boundary they were applied at before — and rejects the others: not applied, not journaled
(seed + command log replays the game without them), a console warning in the worker (`rejected: it reached a frame
boundary N ms after its deadline`) and an `expired` reply, which the main thread delivers as the op's failure value.
The main thread never fails a command on a clock of its own while the worker runs: a worker that runs frames answers
every command by its first boundary after the deadline (applied, or expired), so a callback that got the failure value
can no longer see the order land, and a slow reply to an order applied in time is delivered as applied. Only when no
reply has come `REPLY_GRACE_MS` (30 s) after the deadline — the worker runs no frames at all — the main thread declares
it unresponsive (`SimClientCore.checkReplyTimeouts` → `onUnresponsive` → `SimWorkerClient.stop`: terminated, so it
cannot apply anything later), every waiting request fails, and the restart is offered (§4.6). In-thread nothing changes:
commands always reach the next boundary. Tests: `test/simWorkerCommandFailures.test.ts` (a command delayed past its
deadline is rejected and not journaled, the next one applies; an order applied in time with a slow reply is delivered as
applied; a lost message trips the backstop).

**Quick repeats** (`src/ui/pendingCommands.ts`, `test/simWorkerQuickClicks.test.ts`). A control that computes its next
value from what the game shows — a stepper adds one to the current count, a toggle sends the opposite of the current
flag, a purchase button is enabled while nothing was bought for the target — reads state one reply behind: in-thread for
the rest of the frame, on a replica for a round trip. Such controls keep the last value they sent per key
(`PendingValues`) until that command's reply lands (any outcome; an earlier reply never clears a later send), compute
from it and show it; one-shot actions are busy (`PendingOnce`) from the click until the reply that settles them. In-thread
an entry lives less than a frame, so only clicks inside one frame (which used to compute from the old value too) see it.
The controls (audit of every `issuePlayerCommand` in `src/ui` next to a read of the game):

| Control | Was | Now |
|---|---|---|
| Colonies tax box / spinner (`coloniesScreen.ts issueColonyTaxRate`) | ColonyTax steps from the replica's rate to the box's value: overshoot / lost steps | steps from the rate last sent; the box shows it |
| Fleets troop-loadout spinners and "Use Troop Loadouts" (`fleetsList.ts issueFleetTroopLoadout`) | the other types from the replica's loadout | from the loadout last sent; the group shows it |
| Fleets "Automate" order button | the direction from the replica | from the state last sent |
| Fleet Designs − / + / Add Design (`fleetDesignsTab.ts FleetTemplateCounts`) | count ± 1 from the replica | from the count last sent; the grid shows it |
| Expansion Planner Build / Action (`expansionPlanner.ts plannerBuildColonyShip`, `plannerQueueMiningStation`) | enabled for two round trips; Build bought a ship per click (`buildNewShips` + a separate colonize order) | busy per target until the reply; Build is the BuildColonize order (method_539 in the game, after Main.Part7.cs's "a colony ship is on its way" check — so even two orders reaching one boundary buy one ship) |
| Selection panel Automate (`hud.ts`), Ships and Bases Automate (row and button), Ship Designs Upgrade (per sub-role) | toggled from the replica | from the state last sent |
| Diplomacy "trade restricted resources" check box | the 1 s re-render reset it to the replica's value | shows the value last sent |
| Research tree click (queue / dequeue / crash question) | membership from the replica: a quick second click queued again | the queue with the clicks in flight (a second click on a node just queued asks the crash question, as in-thread) |
| Selection panel order buttons (`orderMenu.ts`) | a second click repeated the stale button (a toggle's direction, the old page) | ignored until the order's reply (a new selection starts afresh) |
| HUD dispatch slots | a second click re-resolved before the first order landed | busy per slot until the order's reply |
| Empire Policy automation combos (`empirePolicyModel.ts issuePolicyPanel`) | sent values remembered for as long as the panel was open | until each reply lands; in-thread and worker logs are the same (`setEmpireControl` in both modes) |

Not changed, by design: commands whose arguments are the control's own value (combo boxes, check boxes the user sets,
renames, the Game Options window, which also keeps its sent values) and relative orders the executor resolves in the game
(fleet posture / range, wait-queue and job moves, ship order keys); purchases the C# allows once per click (yard
purchases, Build Facility: the executor checks money and limits).

**Failure texts.** Recruit refusals now say why (`executeShipAction.ts recruitTroops`: "Recruit Troops at X: …", shown by
the Troops and Colonies screens and the order menu; the C# returns silently, no state change either way). Construction
Yards Refuel / Repair / Retire name the destination ("Refuel at X", "Repair at X", "Retire at X") or the reason the ship
was skipped, with the C# Mission column's "(None)" (`constructionYards.ts yardShipOrderText`). The Expansion Planner's
mining job refusal is "Cannot build here: X (reason)" with the construction board's reason (`plannerCannotBuildText`).

Refresh requests never call `onFresh` on a failure, as in-thread; they are removed from the waiting table, and the
timeout covers them too. Save / digest / debug / commandLog requests reject when the worker stops or the
client is disposed. `save()` then returns null, as for a failed save. The failure values are typed per op: a new player
op does not compile without one.

### 4.5 Sim → UI hooks

These run in the worker on the authoritative game, and the main thread gets an event:

- The game end: the sim ends the game itself (`victory.ts onGameEnd`: DoGameEnd's model part, `gameIsFinished` and
  the victor, and method_436's `reviewAchievements`, in every mode and headless — §10.2); the host's handler pauses
  the worker's clock and sends the `gameEnd` event with the args (victor, outcome, text); the main thread plays the
  music and shows the outcome (the comparison window's overlay and the Game End panel)
  (`empireComparison.ts presentGameEnd`).
- The player's message pipeline (`sim/playerMessages.ts`, §4.4): it runs in the worker's tick as it runs in-thread
  and headless; the host only listens (`setPlayerMessageListener`) and, after each tick, sends one `playerMessages`
  event: each handled message once (also those ProcessMessages emptied before any sync), with its receipt (advisor,
  route, conversation action, ticker), plus the events, encoded after the tick so a message is born on the main
  thread with its final stamp. The main thread's `PlayerMessageStream` (`ui/workerMessages.ts`) feeds the ticker,
  popups and stubs, and the events go to the replica player's event recipient (the UI's hidden field); they only
  draw. The message options, the history trim and the advisor expiry are journaled commands (§4.4).
- The location-pinged hook: the main thread centres the camera on the replica object.
- A sim error: the worker pauses and the main thread shows a toast.

### 4.6 Restart after the worker stopped (`src/simworker/restart.ts`, `main.ts offerWorkerRestart`)

A worker that stopped for good (its loop or the sync threw, an uncaught error, a message that could not be read, the
reply backstop) cannot be resumed. The main thread has already failed every request waiting on it (§4.4); then:

- a toast, and the original-style message box "Simulation Stopped" (MessageBoxEx: `originalWindow.ts messageBox`) with
  the reason, the source it would restart from (and the fallbacks), and **Restart** / **Main Menu**;
- Restart tries the sources best first (`restartSources` / `restartFromSources`): **the worker's own save of its last
  state** (`worker.ts fatal` → `SimHost.rescueSave`, sent with the fatal error when the game still serializes — the sim's
  errors are contained by `SimHost.tick`, so a fatal error is usually the sync's or the host's; the commands not applied
  yet are dropped from it, since they were failed on the main thread, and no rescue save is made if some were already on
  the galaxy's queue), else **the replica** serialized on the main thread (`serializeGame` of the replica: hot data
  current, cold data up to a cold cycle older, no command log — the restarted game's log starts at the restart; exact
  after a full compare, test), else **this game's last autosave** (`autosave.ts currentGameAutosave`). A source whose text
  cannot be had or that the new worker cannot load gives way to the next;
- the chosen text boots a new worker exactly as a load does (`loadSaveInWorker`: snapshot, new replica — the re-sync),
  the old view is torn down (its client disposed: anything still waiting fails) and the game view starts on the new
  replica, **paused**; a toast names the source. Main Menu (or nothing loadable) returns to the main menu.

Tests: `test/simWorkerRestart.test.ts` (a crash with orders in flight: each fails once, promises reject; the restart from
the worker's save is exact, paused and playable — the clock runs, an order applies and replies; the replica fallback is
exact after a full compare; a source that throws or does not load gives way to the autosave). Smoke:
`scripts/simworker-smoke.mjs` crashes the worker twice (`SimWorkerClient.simulateFatal`: from the worker's save;
`SimWorkerClient.stop`: from the replica), restarts through the box and recruits in the restarted game.

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
  in-thread log. A browser session replays bit-exact headless **in the same engine** (§10.3: the campaign's replay in a
  page with no game view gives the worker's digest and save text); in node it does not, in either mode, because node's
  V8 and Chromium's give different last bits for `Math.sin`, `cos`, `tan`, `asin`, `exp`, `log`, `atan2`, `pow`, … on
  a few percent of arguments (§8 "Cross-engine replays").

## 6. Fallback in-thread mode

With the flag off (`?simWorker=0`, or the setting unticked), `startGameView` creates the in-thread `createSimLoop`
exactly as before. `SimHost`, the worker and the replica are not created. `issuePlayerCommand` takes the local queue,
because no remote sink is registered.

The setting (`ui/settings.ts simWorker`, default on) is stored with `simWorkerVersion: 2`: a stored `simWorker` from
before the flip (the old default `false`, written with every other setting whenever one changed) is not a choice and is
ignored, so existing players get the worker; one they untick afterwards is kept (`test/simWorkerDefault.test.ts`).

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
| `src/simworker/commandFailure.ts` | Each player op's failure value, for commands the worker could not apply (§4.4 "Failed commands") |
| `src/simworker/restart.ts` | The restart after the worker stopped: sources, prompt text, fallbacks (§4.6) |
| `src/ui/pendingCommands.ts` | `PendingValues` / `PendingOnce`: the values controls sent until their replies land (§4.4 "Quick repeats") |
| `test/simWorkerQuickClicks.test.ts`, `test/simWorkerRestart.test.ts` | Quick repeats in both modes; the restart flow |
| `src/simworker/bootOptions.ts` | createGame options across the boundary |
| `src/sim/readOnlyQuery.ts` | Read-only UI reads (replica; the in-thread game between frames), record requests, `withSimWrites` / `withPureSimReads` (§4.4, §8) |
| `src/simworker/tradeFlowSync.ts` | Trade-flow recording in the worker; the ledger as a side table (chunk 3) |
| `src/simworker/protocol.ts` | Message types |
| `src/simworker/refresh.ts` | Refresh-on-open requests from the screens (`requestSimRefresh`; no-op in-thread) |
| `src/simFrameBudget.ts` | SimFrameBudget, shared by both modes |
| `scripts/sync-measure.mjs` | Sync cost on a save (`--compare-options`, `--verify`, `--census`, `--hot-fields`; `--client`: SimHost + SimClientCore end to end, with command replies, §2.6) |
| `test/replicaSyncChunk9.test.ts` | Chunk 9: the compact wire format's exactness, guarded hot fields, the hot pass registries, budgeted dependency births, replies waiting for their cold parts |
| `scripts/simworker-smoke.mjs` | Browser smoke: boots with the flag, checks run / speed / pause / move order, screenshots |
| `test/simWorkerCommandFailures.test.ts` | Failed commands: refusals, throws, unknown ops, dropped / stale arguments, unsendable results, timeout, worker stop, close / reload (§4.4) |
| `test/simWorker.test.ts`, `test/replicaSync.test.ts` | Determinism, fidelity and save gates; codec fuzz (8 seeds × 400 steps by default; `FUZZ_SEEDS` / `FUZZ_STEPS`) |
| `src/simworker/writeDetector.ts`, `test/replicaWriteDetector.test.ts` | Dev-only replica write detector (`?detectWrites=1`, §9 chunk 0) and its tests |
| `src/simworker/commandReach.ts` | What a command's reply must carry beyond its arguments (ops that name a template / job by id, §4.3) |
| `scripts/simworker-campaign.mjs` | The final check's long play session (§10): new games of each kind, years at 1×-4×, every screen and panel with real orders, save / load, autosave, crashes, the write detector, the headless replay |
| `scripts/simworker-campaign-compare.mjs` | Two campaign runs side by side (worker against in-thread): differing checks, ops per step, errors, popups |
| `scripts/simworker-replay-check.mjs` | A campaign session's seed + command log replayed headless in node, digest and save text compared (cross-engine: §8) |
| `scripts/desktop-check.mjs` | The desktop app (packaged, or `--unpacked`: `electron desktop/main.cjs` over dist/): the worker boots, a command replies, the worker saves; `?simWorker=0` runs in-thread |
| `test/simWorkerDefault.test.ts` | The default: the setting, its migration, the `?simWorker` override |

## 8. Known limits of phase 1 (also in §9)

- **Cross-engine replays (not the worker's: both modes).** The sim calls `Math.sin` / `cos` / `tan` / `asin` /
  `atan2` / `exp` / `log` / `pow` (about 190 call sites, orbits and headings among them), whose last bit differs
  between engines: node 22 (V8 12.4) against the headless Chromium 151 here differ on up to 18 % of sampled arguments
  (`sin` / `cos` 3–4 %, `exp` / `pow` 9–10 %, `atan2` 18 %; `sqrt`, `hypot` none; node 26 agrees with Chromium on `pow`
  only); a page's main thread and its workers always
  agree. So a browser or desktop session's command log replays bit-exact only in the same engine — the campaign's
  browser replay (§10.3) is exact; `scripts/simworker-replay-check.mjs` in node is not (the first difference is a star
  position at galaxy creation). The node harness and its pins are unaffected (node against node). Making it hold
  across engines needs sim-owned deterministic transcendental functions (a JS port of fdlibm for the ~190 call sites,
  a sim change that moves every pin, with a cost in the late-game step) — left as a decision for the project.

- **Boot cost.** A late save's snapshot is about 3–4 s to encode on top of the worker's own load (201 MB since chunk
  9, 425 MB before), and the main thread is busy for about 1–1.7 s applying it (2–7 s before). A streamed or
  incremental snapshot would fix the rest.
- **Occasional hot-apply spikes (3–14 ms)** — addressed in chunk 2: the birth bursts (missions with their commands,
  research-improved weapon stats) now travel cold, the usual dependencies (new designs and fleets, fighter launches,
  refits) are gone, and a remaining dependency applies only births (§3.3). What is left is the hot part's own volume
  on a busy step (about 5 000 sets) and GC pauses (§2.4). Since chunk 9 a dependency's births are budgeted across
  frames and command replies no longer apply the cold backlog at once (§2.6): the worst main-thread sync frame on the
  late saves is 4–11 ms (it was 17–165 ms in the browser, 435 ms in node).
- **Worker headroom.** Step plus diff is 10–20 ms per step on the loaded machine at 60 steps/s. Above that the worker
  falls behind and the budget catches up, exactly as the in-thread loop does. Tuning knobs: `coldBudgetMs`,
  `coldMaxSets`, `markBudgetMs`. Behind, a tick carries several steps and the presentation clock trails about two
  bursts (6–12 steps on the late saves under load, §2.6): the lag comes down only with the worker's per-tick cost. The
  hot pass is now mostly the ~1 000 touched ships' own compares (their 52 hot fields, their weapons), memory-bound
  reads of the sim objects and their shadows.
- **Cold staleness.** Cold data is up to one cycle old (about 1–1.5 s), plus any pump backlog. A paused game settles
  to exact: the worker keeps comparing for two full cycles after the last change.
- **UI sim writes (2026-10-03).** No UI path writes the game, or draws `galaxy.rnd`, outside the journaled command
  queue any more, in either mode (decisions per path: consumer audit §4.1):
  - Where the C# UI makes the write, it is a journaled player command issued at the same point, whose reply the UI
    shows: `actionMenu` (the right-click menu: "Build here" SelectRelativePoint, ReviewLatestDesigns),
    `selectionButtons` (the button pages that draw), `habitatDispatch`, `moneyPanel` (CheckAgeVariableIncome, only when
    `moneyPanelWriteDue`) and `obtainUiRecords` (the records Obtain* adds). In-thread the reply comes within a frame
    instead of inside the call.
  - Every other UI read is read-only (`sim/readOnlyQuery.ts`): on the replica as before, and on the in-thread game
    (`simLoop.ts` marks it) whenever no sim code runs (outside a frame, outside a command's executor, which
    `playerCommands.ts` runs in `withSimWrites`). The player message pipeline is sim code now (§4.4; it runs inside
    the frame or a command, in `withSimWrites`). Port-only reads (the local-model
    briefs, `llm/replicaReads.ts`) are `withPureSimReads`.
  - The `simQuery` protocol (query message, `SimHost.query` / `flush`, `ui/workerQueryCache.ts`) is gone.
  - `repin --check`: 0 pins move (the harness has no UI). Write detector (`scripts/simworker-smoke.mjs
    --detect-writes`, with a UI tour of every panel and screen): 0 unexpected keys on a fresh game and on
    `late2500.dwusave`, replica digest = worker digest after the tour; the tour's in-thread save-text probe
    (`--inthread --detect-writes`) shows a state change only in steps that applied one of the commands above.
  - Closed (2026-10-03, §4.4): the message pipeline runs in the sim tick at fixed points (the end of each frame, after
    each command, before a save) in every mode; its UI-triggered writes (the history trim, the advisor expiry of a
    diplomacy exchange, the message options) are journaled commands and the age expiry is sim-driven; the `uiOp`
    message is gone; `approveSuggestion` names the suggestion by a stable id; the chronicle store is a command; the
    wizard's flag pick is a createGame option. Seed + log now replays the message history, the advisor queue and the
    options (`test/playerMessagePipeline.test.ts`); headless = in-thread = worker (`test/simWorkerMessages.test.ts`).
    `repin`: 1 pin moved (`tickDeterminism.digest600`: the deferred authorization prompts and the frame-end age expiry change
    what the 600 s harness run reaches). Write detector: no pipeline
    writes outside the sim and commands (`scripts/simworker-smoke.mjs --detect-writes`, `--inthread --detect-writes`).
  - Left: the voice job's message upgrade (`hostOps.ts voiceMessage`, `applyVoiceToMessage` rewrites a message's text
    in the worker, unjournaled; a stable message id would make it a command); the conversation queue is UI state, as
    the C# queue is (not saved), so its expiry stays UI-side.
- **Ported since phase 1:** the advisor and diplomat-voice commands go through the worker (`remote.command`; in-thread
  `runPlayerCommand`), tutorials boot in the worker (chunk 1), `__dwu.sim` / `__dwu.simBudget` are worker stand-ins and
  `__dwu.commands.log()` returns a Promise of the worker's log (chunk 1). Dev scripts that write `__dwu.galaxy`
  directly (screenshot set-ups under `withSimWrites`) write the replica in worker mode, which the worker never sees:
  they need `?simWorker=0` now that the worker is the default.
- **Command replies.** Every command issued on the replica with a callback is answered exactly once, in issue order
  (§4.4 "Failed commands"). Before this fix, an error reply (a result that could not be encoded, a stale argument)
  only logged a warning. The worker dying, a reload or a lost message left the callback waiting forever, so the flows
  that wait on it hung: Recruit (`troops.ts` / `coloniesScreen.ts` await the reply) and the Design Editor's Save
  (`saving` was reset only in the callback). Audited: every UI caller of `issuePlayerCommand`, `simQuery`,
  `requestSimRefresh` and `remoteSimHost` (about 140 sites). They take the failure value on their existing refusal
  path, and none keeps a busy state past it. Smoke: `scripts/simworker-smoke.mjs` (game mode, both modes; `--no-commands`
  skips it) recruits from the Troops screen, saves from the Design Editor (a copy, then a refused blank design twice),
  and in worker mode crashes the worker twice and restarts it (§4.6).
  Remaining limits:
  - An executor that throws leaves the waiting flows stuck in both modes (`designEditor.ts` `saving`), as in-thread; the
    quick-repeat overlays of such a command stay until the screen closes (the selection bar's until the selection
    changes).
- **Command flow (2026-10-03).** Fixed: the timeout policy (§4.4: the worker rejects commands past their deadline at the
  frame boundary; the main thread delivers the worker's verdict, and only a worker that runs no frames is stopped after
  the grace); quick repeated clicks (§4.4 "Quick repeats": every UI control that computes the next value from the game
  — tax steps, troop-loadout spinners, Fleet Designs ±, toggles, the research tree, the selection bar, dispatch slots,
  Expansion Planner Build — computes from what it last sent; N clicks give N steps in both modes, a double-clicked colony
  ship purchase buys one); the Empire Policy automation combos journal the same `setEmpireControl` commands in both
  modes (test); the restart after the worker stopped (§4.6); informative Recruit / Construction Yards / Expansion Planner
  failure texts. `repin --check`: 0 (the recruit refusal's result message is not state).
  Left:
  - the replica restart source can carry cold data up to a cold cycle old and has no command log;
  - a hard crash (terminated worker, `onerror`, a lost message) has no rescue save of the worker's own (the replica or the
    autosave is used); the autosave fallback covers only autosaves this game view wrote;
  - the overlays cover what a click computes; displays that are not the control itself (labels elsewhere, other open
    screens) still show the replica's value until the reply.

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
  LastIonStrike, so on a replica only strikes that land are heard. The event stings chain on the replica player's
  `Empire.eventMessageRecipient`, which chunk 4's `ui/workerMessages.ts` calls with the worker's event messages.
- Write detector (smoke `--detect-writes`, late save, combat and hyperjump views added to the smoke): no chunk-2 key
  left (`*SoundPlayed` gone); `Empire.eventMessageRecipient` (defined on the replica player by `eventMessages.ts` and
  `gameAudio.ts`, chunk 4's design) remains.
- Hot-apply spikes: mission / design / fleet references compared hot but sent cold, births-only dependencies (§3.3).
- Interpolation timing: first `clientCore.ts StepPacer`, a playout buffer that held step messages back; now replaced
  by the render-side presentation clock (§2.5), the same in both modes. Every message is applied at the next frame
  (replies at once), and the picture stops at the press (the clock stands still while the pause ack and the steps in
  flight land).
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
  picks its point in the worker, or become a journaled command (done, §4.4 / §8); the async `onApplied` contract for selection follow-ups;
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
- **Done:**
  - Every order of the screens goes through `issuePlayerCommand`. On a replica the Empire Policy panel issues its
    automation combos as `setEmpireControl` commands. In-thread it still writes `Empire.control*` directly, as the C#
    method_597 does.
  - Write-free reads on a replica. Some C# lookups create what they look up (`obtainDiplomaticRelation`,
    `obtainPirateRelation`, `obtainEmpireEvaluation`, `scenarioState`, `wondersBuilt`), and some money reads age the
    income they read (`thisYearsSpacePortIncome`, `thisYearsResortIncome`, `checkAgeVariableIncome`, the NaN tax
    recalculation). On a galaxy marked read-only (`sim/readOnlyQuery.ts markReadOnlyGalaxy`; clientCore marks the
    replica) they return the same value without writing. That covers every main-thread caller, not only the screens:
    the planner's AI queries, the approval and tax queries, the charter checks, the HUD. Since §8 "UI sim writes"
    the in-thread game is read-only for them too while the UI runs (between frames, outside a command's executor);
    tests and the headless harness never mark a galaxy, so `repin` is unchanged.
  - The Build Order's cashflow figure is a read (Main.Part2.cs 785 shows the money panel's last figure); the money
    panel's CheckAgeVariableIncome is the journaled `moneyPanel` command (§8 "UI sim writes").
  - The replica gets the BaconSettings.txt statics (prices, maintenance) at boot.
  - Tests: `test/simWorkerScreens.test.ts`, with the script in `test/helpers/screenOrders.ts`.
    - 29 screen orders run through the host against the in-thread loop; the digest, the log and the replies match.
    - Fresh replies and refresh requests are checked.
    - The screens' reads, run on a replica, leave it equal to the worker's game; chunk 0's write detector finds no
      write.
  - Browser: `scripts/simworker-screens.mjs` opens every screen with the game paused, with `detectWrites=1`, and
    compares the replica digest with the worker's. It then renames the empire and saves a design through the editor.
- **Still open:**
  - ~~A reply whose result fails to encode is dropped (console warning only). The await-style callers (recruit, the
    editor's Save) then wait forever.~~ Fixed: §4.4 "Failed commands".
  - The Galactopedia's `loadGameData` reloads the global GameText table, which drops scenario text added on the main
    thread.
  - Lazily added `declare`d class fields reach the replica only through `compareNow` (chunk 9 / 0).
  - ~~In worker mode, the records the in-thread UI creates lazily are not created at all.~~ Fixed (§8 "UI sim
    writes"): in both modes the read only asks for them and one journaled `obtainUiRecords` command adds them.

**Chunk 7 — diplomacy, intelligence and politics.**
- Files: `ui/screens/diplomacyScreen.ts`, `diplomacyRelationsView.ts`, `empireIntel.ts`, `empiresList.ts`,
  `tradePanel.ts`, `warTermsPanel.ts`, `intelligence.ts`, `characterEventText.ts`, `ui/courtView.ts`,
  `emergentPolitics.ts`, `internalSecurityView.ts`, `scenario/rimTraderRows.ts`, `leagueRows.ts`.
- Work: `obtainDiplomaticRelation` creates a relation on read (use a non-creating lookup); delete the dead
  intelligence mutators; by-value IntelligenceMission / TradeNegotiation / PeaceTerms arguments.
- Test: proposal and trade flows through the host vs in-thread.
- **Done.**
  - `rimTraderRows` reads through `peekDiplomaticRelation`, in both modes; the dead intelligence mutators are deleted.
  - The talk panel's listing and the pirate protection price are read-only UI reads whose records are added by the
    `obtainUiRecords` command (§4.4; they were worker queries before); a probe of every other read the chunk's
    screens make found no writes.
  - The DEAL_BEGIN negotiation is detached from the replica before the trade panel edits it (`tradePanel.ts
    detachTradeNegotiation`).
  - Missions and peace terms go by value, keeping their identity (§4.3).
  - Tests: `test/simWorkerDiplomacy.test.ts` (the listing reads and their records; proposals, trade, pirate protection, agent missions with a
    false flag, transfers, dismissal, politics / court / security, peace terms: the in-thread log and digest) and
    `test/simWorkerScreenReads.test.ts` (the screens' replica reads leave the replica unchanged, in nine game
    setups).
  - Browser: `scripts/simworker-smoke-diplomacy.mjs <url> --load=<save>` (a save where the player has met everyone).
  - Left to other chunks: the conversation queue's message expiry (`setDiplomacyMessageExpiry`, chunk 4) and the
    diplomat voice (chunk 8).

**Chunk 8 — LLM and AI advisor.**
- Files: `src/llm/*`, `ui/advisorClient.ts`, `advisorPanel.ts`, `diplomatVoice.ts`, `aiAdvisorDriver.ts`,
  `aiAdvisorLog.ts`, `llmOverlay.ts`.
- Work: `runPlayerCommand` (advisorCommands, diplomatCounter) and `applyStrategicDecisions` become queued commands
  with async results; `storeChronicleYear` becomes a command; `drainVoiceCues` becomes a worker → main event; the
  brief builders run on the replica (read-only) or in the worker.
- Test: advisor turn through the host; aiAdvisor18c's import-walk test still holds.

**Chunk 9 — sync performance** (independent of the others). *Done* (2026-10-03; numbers in §2.6).
- Files: `src/simworker/replicaSync.ts`, `replicaGalaxy.ts`, `clientCore.ts`, `writeDetector.ts`;
  `scripts/sync-measure.mjs --client`, `scripts/simworker-smoke.mjs` (sync stats before the simulated crash).
- **Time-sliced forced applies, replica kept consistent.**
  - Command and refresh replies no longer apply the cold backlog at once (`applyThrough` is gone). A message's replies
    wait in `SimClientCore.settling` until the cold parts through its delta are applied; those parts are pumped first,
    under `replyBudgetMs` (4 ms a frame), then the regular pump. Replies and events stay in order. A message's events go
    out before its own cold part applies (its drops among them), as before; a reply after it, as before. A worker that
    stops answers the replies already received first.
  - A hot part that depends on cold births applies them under `depBudgetMs` (4 ms a frame). If they do not fit,
    `ReplicaDecoder.apply` returns `pending`, the message and those after it wait, and the next frame continues the same
    call. The newborns are unreferenced shells until the hot body is applied, and the pump waits meanwhile.
  - The cold pump's budget grows faster with the queue (×1 up to 2 parts, +50 % a part, at most ×8), so the queue stays
    at 0–2 parts instead of 20–30, and a reply waits about a frame.
  - The decoder's reverse map is a Map (was a WeakMap: 5 µs inserts, GC stalls up to a second at 2.4 M keys), and its
    id tables are dense (the sparse `objs` array had fallen into dictionary mode). That was most of the cold pump's
    cost and of the 112–165 ms cold applies, and it makes the snapshot apply 2–4× faster.
- **A smaller hot stream.**
  - The compact wire format (§3.2): uint32 codes, an f64 lane only for the numbers that need it, integers and
    float32-exact numbers in one code, and one Set record per object. Exact: `--verify` gives the identical save text
    and digest.
  - Guarded hot fields (`hotFieldGuards`): idle weapons' `resetNext` (2 100 sets a step) travel only while the shot is
    drawn.
  - Hot part 272 → 56 KB a step, delta 447 → 121 KB, snapshot 425 → 201 MB.
  - Not done, on purpose: quantizing or lossy delta-encoding positions. Lossless deltas of full doubles do not shrink.
    A lossy one would break consumers that compare positions exactly (the parent-frame test in `renderInterp.ts
    followsParent`, UI distance reads), for ~10 KB a step more.
- **Worker diff.** Probe registries for gated objects and hot arrays (§3.2): the hot pass skips untouched ships without
  reading their shadows (−20–30 % hot pass, A/B and alternated runs). The guard removes a third of the hot sets.
- **Presentation clock.** Tried trimming the delay's unused headroom. It is not kept, because of the stall trade-off
  (§2.6): the lag follows the worker's per-tick cost.
- **SharedArrayBuffer.** Not cross-origin isolated in Vite dev or Electron; not used, and not needed after the above
  (§2.6).
- **Tests.**
  - `test/replicaSyncChunk9.test.ts`: every lane exact (−0, NaN, ±Infinity, 2³², 5e-324, statics, refs); one Set
    record per object; guards; registry exactness with a value changed back after another compare sent it; registries
    on = off over a randomized run; dependency births over several budgeted calls; a reply waiting for its cold parts
    over several frames, in issue order.
  - `test/simWorkerMainView.test.ts` checks `resetNext` only for shots in flight.
  - All of `test/simWorker*`, `test/replica*` and `test/renderInterp*` pass.
  - Write detector (smoke `--detect-writes`, late save, UI tour): 0 unexpected keys, digests equal.
  - `repin --check`: 0.
- **Still open.**
  - A streamed snapshot (boot is still 3–4 s of encode and 1–1.7 s of main-thread apply).
  - The worker's hot pass: the touched ships' own compares (§8 "Worker headroom"). A typed per-shape shadow for the
    hot numeric slots would cut its memory traffic.
  - Worker GC: the shadows roughly double the worker heap.
  - Single frames of 5–10 ms remain: a birth burst in the hot part, or a GC pause.

## 10. Final check before the default (2026-10-03/04)

### 10.1 What was run

`scripts/simworker-campaign.mjs` (long scripted sessions in headless Chromium 151, swiftshader, 1600×900), each kind
in worker mode (`--detect-writes`) and in-thread, with the same seed, on a machine at load average 13–26:

| Game | Game time played | Worker: checks ok / failed | In-thread: ok / failed | Console errors | Popups taken (choices) |
|---|---|---|---|---|---|
| Standard (main menu → wizard, Custom Standard, seed 4242) | 3 years (1 840 s) at 1×, 2×, 4× | 115 / 0 | 93 / 0 | 0 / 0 | 25 (9) / 15 (4) |
| Introductory (wizard → Introductory Game) | 1.5 years | 110 / 0 | 90 / 0 | 0 / 0 | 14 (5) / 13 (3) |
| Return of the Shakturi (+ the story panel's choice) | 1.5 years | 109 / 1 ¹ | 90 / 1 ¹ | 0 / 0 | 11 (3) / 12 (3) |
| Pre-warp (PreWarp galaxy and empire) | 1.5 years | 97 / 3 ¹ | 76 / 3 ¹ | 0 / 0 | 5 / 5 |
| Pirate faction (Custom Pirate) | 0.3–0.5 years | 79 / 2 ¹ | 63 / 1 ¹ | 0 / 0 | pirate missions |
| Time-limit game end (the sim ends the game in its first long tick) | 0.3 years | 94 / 1 ² | 71 / 2 ¹ | 0 / 0 | the Game End panel |
| late2500 (`/dev-saves/late2500.dwusave`, 9.8 k ships), loaded from `?load=` | 150 s at 1×–4× (the sim kept 0.99–3.9× real time) | 90 / 5 ³; without the detector: all ok | 76 / 0 | 1 ³ / 0 | events |

¹ Script selectors fixed afterwards (a pre-warp start has no ships to list or build; the Galactopedia's root; a window
left open by the game end), re-run clean on the merged tree. ² The game-end replay (§10.2, fixed). ³ With the write
detector (which roughly doubles the replica's heap) and Playwright's console handles (below), the tab ran out of memory
at the second restart; without the detector the whole run, both restarts included, passed (fix 4 below).

After merging origin (SetupSun's picture draws changed every seed's galaxy), worker runs again: standard (1 year),
pirate (0.5), game end (worker and in-thread), pre-warp and Shakturi (0.5 each), late2500: all checks pass, 0 console
errors, 0 unexpected replica writes, replica digest = worker digest, every browser replay identical; the original
`scripts/simworker-smoke.mjs --load=/dev-saves/late2500.dwusave --detect-writes`: SMOKE OK.

Each session: new game through the real menus (the wizard for standard and Introductory, `?newgame=` for the others),
the Introduction panel; play segments at 1×, 2× and 4× alternating with UI steps (every other step with the clock
running), each step checking its effect on the game and the redraw, a hang watchdog (the clock must move while running;
no animation frame for 20 s fails), every command reply settled within 10 s (no stuck waits), every console error
recorded with its step:

- every top-bar screen with real orders: Colonies (tax by the spinner, rename), Ships and Bases (Automate / Unautomate
  flipping the button, Refuel), Fleets → Fleet Designs (New Fleet Design, Add Design, three quick +), Ship Designs →
  Copy As New → Design Editor → Save, Build Order (Purchase, or the cannot-afford box), Construction Yards (Purchase ×2,
  Remove Ship → Yes, the Fleet Builds / Construction Jobs tabs), Troops (Recruit, with the automation question),
  Research (three tree clicks queue, a queue drag the game allows reorders the queue and the panel), Expansion Planner
  (Build and Send Colony Ship, or a mining-station job), Empire Summary (rename), Empire Policy (a policy combo, an
  automation combo, Save, Load the saved file, Load an installed one), Diplomacy (every row, Speak → a small gift with
  its reply and the treasury, a pirate faction's protection talk), Characters, Graphs, Galactic History, Message
  History, the game-editor button, the top strip's overflow menu (Galaxy Map, Empires list, Game Options, the admiral,
  the shortcuts), F1 Galactopedia, G Galaxy Map;
- every left-sidebar panel: opened, row 0 clicked (selects) and double-clicked (centres), Pirate Missions' row button;
- the selection panel (Explore), a plain right-click on a body (the default order or the menu), Ctrl-right-click →
  the action menu (through the pick popup when objects are stacked) → a leaf item;
- control groups (Ctrl+1 / Ctrl+2, 1 selects, Shift+2 selects and centres), the Ground Report ([, hover, resize, [),
  T (panels cycle), D (display type ×3), H (message history, every tab), Game Options (O: an Empire Settings combo, a
  Message Settings check box twice);
- popups as they come: story popups (Galactic History revealed …), event choices (Investigate Ruins / Base), pirate
  protection conversations accepted (the tribute: `acceptPirateOfferProtection`), events and cards closed; the Return
  of the Shakturi story panel's Yes (`storyEventAction`);
- save from the game menu → Main Menu → Load Game → the save → the same game (nowMs, empire, colonies; worker: the
  worker's digest) → continue; an autosave (1-minute interval) written and listed;
- worker mode: the write detector (0 unexpected keys in every run), the replica digest = the worker's once paused, the
  headless replays (§10.3), then a fatal stop (the worker's save) and a hard stop (the replica) with Restart, play and
  orders in each restarted game.

`scripts/simworker-campaign-compare.mjs` lines two runs up. With the same seed the worker and in-thread runs journal
the same ops step by step (standard, Shakturi, pre-warp: identical op sets per step but for the money panel's
`moneyPanel`, which is due by time); the games then drift apart as the replies land a round trip later (the standard
in-thread run ended with a negative treasury and so had no gift option).

The desktop app: `scripts/desktop-check.mjs --unpacked` (Electron 44 over the built dist/, on a virtual Wayland
compositor): the worker boots by default under `dwu://`, a command's reply reaches the replica, the worker saves, and
`?simWorker=0` runs in-thread; no console or page errors.

### 10.2 Bugs found and fixed

1. **Fleet Designs: Add Design did not show the row (worker only).** The reply of `fleetTemplateSetEntry [id, design,
   n]` ran before the template's rows reached the replica: the ops name the template by id, and its rows are past the
   reach of the arguments and the empire (§4.3). `simworker/commandReach.ts` adds the books such ops point into
   (fleet templates and build orders, the construction board) to the reply's compare. Test:
   `simWorkerScreens.test.ts` "by id" (fails without it).
2. **A paused game's replica never became exact (worker only).** The side tables (Random draw counts, prices,
   characters, …) went onto the replica's objects only every 60th apply, and the worker recollected them at the delta
   after a cold cycle wrapped — after the new cycle had compared them; a paused stream stops a cycle after the last
   change, so the replica kept old draw counts (replica digest ≠ worker digest for good). Now recollected as each
   cycle starts (`ReplicaEncoder.onCycleStart`) and applied once the stream is idle (§3.3). Test: `simWorker.test.ts`
   "a paused game settles".
3. **A game that ended did not replay headless (both modes; sim).** DoGameEnd's model part (IsFinished, the victor,
   the achievement review) ran only in the handlers the app and the worker install, so seed + log of such a session
   replayed to another game (`gameIsFinished` false, the victory check raised every long tick). It runs in
   `victory.ts onGameEnd` now (§4.5); the handlers keep the pause and the banner. `repin --check`: 0 pins move. Test:
   `gameEndReplay.test.ts`.
4. **Every replaced game view stayed in memory (both modes).** After a load, a new game or a restart the old galaxy,
   main view and (worker) replica stayed alive: +140 MB per view on a small game, +530 MB on late2500, so a few restarts
   or loads of a late game ran the tab out of memory (the campaign's late2500 run crashed the page at the second
   restart). Retainers (heap snapshots): HUD timers and document listeners, settings subscriptions, the left sidebar's
   timer and resize listener, MainView's window listeners, images kept with their onload closures in Pixi's texture
   cache, the Pixi stage destroyed without its children (Texts stay listeners of the TextStyles Pixi's text-metrics
   cache keeps), module caches keyed by Empire, a once-registered listener capturing the first window's scope, the
   restart prompt's guard and a disposed client's event handler. Fixed at each (`ui/hudLifetime.ts`, …);
   `scripts/simworker-leak-probe.mjs` (live instances counted with CDP `queryObjects` after a GC, `--tour` of every
   screen, `--snapshot`): one game alive after two restarts of each kind and two loads, in both modes. (A Playwright
   page with a `console` listener keeps console arguments alive through DevTools handles, which can hold a closed
   window and through it a game: the campaign's own heap figures are higher for that reason, not the app's.)
5. **The setting's default.** Flipping `simWorker` to true alone would not have reached existing players: every save
   of the settings wrote the old default `false`. A stored value counts only with `simWorkerVersion: 2` (§6).

Script-only findings, not bugs: `parc2-shots.mjs` looked for the old game-end overlay class; desktop-check's F5 / F8
selectors (also fixed on origin); `researchdrag-shots.mjs` and `parD3-shots.mjs` write the game directly and now pin
`?simWorker=0`. The Expansion Planner's Build button is on for a pirate faction without a buildable colony ship design
and does nothing on a click — as the C# (Main.Part11.cs method_161 enables it, Main.Part4.cs method_539 returns).

### 10.3 Determinism

For every new-game session in worker mode, before the crashes: the createGame options the page posted to the worker
(captured from the `init` message), the worker's save and digest. Seed + the save's command log replayed headless
(`createGame` + `replayCommandLog`, no game view) **in the same browser engine**: the same digest and the same save
text, byte for byte, in all of standard (3 years, 1 872 s, 102+ log entries), Introductory, Shakturi, pre-warp, pirate
and — after fix 3 — the game-end session; again on the merged tree (standard, pirate, game end). In node
(`scripts/simworker-replay-check.mjs`) the replay differs from the first star position on, in both modes: §8
"Cross-engine replays".

### 10.4 Remaining known differences between the modes

- A command's reply comes one round trip later (one to two frames; the late save: about a frame, §2.6) — the games of
  a scripted session drift apart as the same clicks land at later boundaries; quick repeats are covered (§4.4).
- The drawn picture trails the simulation by the presentation clock's playout buffer in worker mode (§2.5, §2.6).
- Cold data on the replica is up to a cold cycle old while running (§8 "Cold staleness"); paused, it is exact.
- `__dwu.galaxy` is the replica: writes to it from the console or a dev script reach nothing (§8).
- The Pixi "BindGroup … destroyed while still bound" warnings at a teardown (both modes).

Not the worker's, found on the way: `renderInterp-fighters.test.ts` fails after origin's SetupSun change (its new
galaxy ends the fight in a ~200-unit leash reset): `sampleFighter` extrapolates a fighter that is out of view past its
carrier's leash circle (600 Patrol / 1 500) between round-robin touches, which the next touch pulls back (18 small
reversals); clamping the extrapolation to the circle, as `fighterDoMovement` does, removes 17 of them, but the test's
jerk bound also catches the reset's ease and a burst-moving port — left to the render owner.
