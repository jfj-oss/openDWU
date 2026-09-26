# Roadmap

Milestones follow the spec's Part 15 (16.1) in `Distant_Worlds_Universe_Recreation_Prompt.md`. Status: ✅ done · 🔄 landed with known gaps · 📝 task spec written, not yet run · ⬜ not started.

## How the work is organised
- **Lanes A/B (ninfer, headless Sonnet at low effort):** small tasks with `scope: locked` + `thinking: off` in their spec (`tasks/NN-*.md`), one C# source excerpt pasted in per task so the worker never has to explore the game install. Run via `scripts/run-queue.sh`; `scripts/worker.sh` picks the model, `WORKER=ninfer` uses the local NInfer-4090 box instead of the API.
- **Lane C (cloud, Opus):** larger, cross-cutting slices that need judgment or the decompiled source directly — M2 empire model, colonies, visibility, orchestration, ship designs. Tracked in `tasks/HANDOFF-cloud*.md`, `tasks/REVIEW-cloud.md`, `tasks/M2-plan.md`.
- Game art/data/decompiled source live in the private repo **jfj-oss/dwu-assets**, symlinked in as `public/assets/dwu` (`npm run import-assets`); nothing from the original game is committed here.
- Reviews (typecheck + tests + screenshot comparison against real gameplay footage) happen after each worker commit before the next task starts.

## State on 2026-09-26

Everything below is merged into this branch as of the `wip/todosweep` merge (`52bfc98`). See "Known open items" for
what still needs work before v0.1.

**Simulation core**
- M1–M4: the whole running simulation is ported and merged — galaxy/system/planet generation, empires & colonies,
  ships & space ops, and the full M4 tick (missions/movement, docking/refuel, orders/contracts/freight, industry,
  construction & shipyards, colony growth/treasury, research, fleets & military AI, threats/weapons/damage, fighters,
  invasions/boarding/troops, diplomacy, pirates, exploration/territory, events/characters/creatures, espionage, story
  & scripted events, victory/achievements, super pirates/planet destroyers, empire teardown/splits) — including the
  `M4-deferred-plan.md` z1–z6 follow-ups (teardown & empire lifecycle, espionage, story/scripted events,
  victory/achievements/stats, super-pirate & planet-destroyer runtime, pirate-control readers), all merged.
- Determinism: one seeded `galaxy.rnd`, fixed-order scheduler, 600 s digest pinned (`test/tickDeterminism.test.ts`),
  golden pins refreshed with `npm run repin -- --reason …`, a cached test harness (`cachedTickGame`/`cachedTickGameRun`)
  so most tests build the seed-1 game once, and command-log replay so both player orders and advisor-issued LLM
  commands stay journaled and deterministic.
- Combat verified statement-for-statement against the decompiled C# on 6 hand-worked scenarios (escort vs pirate,
  fleet vs base, carrier fighters, boarding, invasion, plus a 30-game-minute soak: 319 battle records, 25 ships
  destroyed) — 2 real bugs found and fixed (spawned ships had every component `Unbuilt`; `Empire.RaidStrengthFactor`
  read as 1.0 in boarding maths) (`tasks/COMBAT-VERIFICATION-2026-09-26.md`).
- TODO(port) sweep of the 12 densest sim files: 136 notes triaged — 46 ported for real behaviour change, 33 stale
  notes rewritten, 13 packaged for later, 40 confirmed dead/UI-only (`tasks/TODO-PORT-INVENTORY-2026-09-26.md`).
- 5-seed × 2-game-year soak: 0 exceptions, 0 NaN/Infinity values, 0 console errors/warnings across every run; heap
  stable, no leak (`tasks/SOAK-2026-09-26.md`).

**Player command layer (17a–17f)**
- 17a buildorder, 17b ship-action model + executor, 17c right-click order menu + selection actions, 17d Empire
  Policy & automation panel, 17e outgoing diplomacy proposals, 17f ship design editor — all merged. Reviewed against
  the C# line by line: mostly faithful, ranked findings in `tasks/REVIEW-player-layer-2026-09-25.md` (top issue: the
  Xaraktor virus cooldown isn't enforced — see Known open items).

**Screens**
- Full main menu + new-game wizard, streamlined HUD, Colonies (F2), Empire Summary (F6), Ships & Bases (F11), Message
  History (H), Galaxy Map (G), Diplomacy (F5) with trade negotiation, Research (F7), Fleets (F12),
  Victory/Comparison (V), Intelligence Agents/Characters (F4), Troops, Expansion Planner, Ship Designs (F8, with the
  17f editor), Construction Yards & build order, save/load, options, tutorials, Galactopedia, Galactic History
  screen, autosave.
- Popups: message/advisor-suggestion/conversation stub list under the top-right empire panel, opening into the full
  card/dialog on click (`popupstubs`, per user direction 2026-09-26).

**Rendering, audio, effects**
- Combat effects: weapon shots, beams, explosions, shield strikes, hyperjump, destroyed-ship sprite release
  (`combatfx`).
- Ambient effects: thrusters, lights/beacons, mining, construction, shields (`ambientfx`).
- Render perf pass: cached Graphics, bodies group, no per-frame allocations, extent-based system cull (`renderperf`).
- Audio: every C# sound trigger (weapons, explosions, hyperjump, mining/construction, ambient area voices, nebula
  thunder, music with correct track-end/area/event-sting rules, UI clicks) wired 1:1 to its TS site — verified with a
  headless run (97 requests, no console errors) and a `galaxy.rnd`-untouched check (`tasks/AUDIO-WIRING-2026-09-26.md`).

**Opt-in local-LLM features (18a–c, off by default)**
- 18a chat-commanded advisor, 18b diplomat voice, 18c AI-empire strategic decisions — the model never runs inside the
  tick; its choices are appended to the same command log the scheduler drains, so seed + command log stays
  deterministic and every pin holds with no model installed.

**Platforms**
- Linux x86_64 packaging done and verified. macOS arm64 build exists (untested/unsigned — see Known open items).

## Known open items

**Correctness questions under investigation**
- No war is declared in any of 5 soak seeds across 2 game years, despite FTAs/sanctions already in place — suspected
  AI war-decision gate issue; needs instrumentation of `checkCanConductNewWar`/`checkReadyForWar`
  (`SOAK-2026-09-26.md` A2).
- Colony-ship construction matches the ported C# formula exactly (checked in `fix6`), but first colonies complete
  very late (day 438–690 across 5 seeds) and 0–5 of 10 AI empires have a second colony after 2 years — the mechanic
  is faithful to the formula; whether it matches real DW:U pace (AI `DifficultyLevel`/`ColonyShipBuildSpeedRate`,
  other purchase paths) is still open (`SOAK-2026-09-26.md` A1).
- Secondary soak anomalies not yet resolved: colony ships stuck in an attack/cancel/escape loop for 100–280 days
  (A4); fleets idle at home for 200+ days, likely normal absent war (A5); research pace (+4..9 projects/2yr)
  plausible but unconfirmed against the C# at this colony count (A6); per-tick cost grows 1.3–1.6x over 2 years from
  `cmdHyperTo`'s nearest-system search, faithful to the C# but a perf option exists (A8).

**Remaining ports (todosweep package-later list)**
- Diplomacy counters (`EmpireCounters.ProcessRelationChange` etc., ~70 lines, feeds race victory conditions/achievements).
- `BaconEmpire.ProcessScienceShips` + scheduling (~150 lines).
- Bacon scientific missions — explore ruins / prospect for resources (~130 lines, player UI only).
- Bacon loans (`MakeLoanPayment`, ~80 lines, player UI only).
- `Habitat.DoTasks` at planet/moon generation (~150 lines + callees, needs an Rnd audit on a half-built galaxy).
- Three game options not yet plumbed from the wizard into `createGame`: `BaseTechCost`, `MaximumEmpireAmount`,
  `ColonizationRange`.
- 4 `registerTodo` stubs in `diplomacyTick.ts` owned by other agents (excluded from this sweep).

**Rendering gaps**
- Fighters: weapon shots/explosions not drawn (`effectsLayer.ts` TODO), and fighter/creature pick at low zoom not
  ported (`builtObjectLayer.ts:548`) — in progress.
- Ship-art marker pixels: the original replaces pure-blue/pure-yellow marker pixels with neighbouring colours when
  caching ship art (`BuiltObjectImageCache.cs`); the port draws the raw art, so engine/light markers show on the hull.
- Tractor-beam strike effect has no sim state yet; area weapons (Ion Pulse/Area Destruction/Area Gravity),
  torpedo/missile flight, point defence, ion damage, and bombardment effects are read-through verified but not
  exercised end to end (`COMBAT-VERIFICATION-2026-09-26.md`).
- Screen mini-maps left out on purpose so far: the Galaxy Map screen's system mini-map/habitat info panel, and the
  Expansion Planner's galaxy mini-map + deficient-resources grid (both noted `TODO(port)` in their task files).

**Platform**
- macOS arm64: builds, but untested on real hardware, unsigned/unnotarized, no `.icns` icon, no CrossOver/Whisky/Flatpak
  install detection.
- Save size/time: a 1,400-star save is ~139 MB of text and takes 2.3–5.4 s synchronously (the C# also blocks with
  "Saving the Galaxy…", but a compact/binary codec or off-main-thread streaming would cut both) — packaged for after
  the core is complete.

**Deferred design work**
- Mod layer + scenarios (`tasks/19-mod-layer-scenarios.md`): 19a larger maps / rim-trader isolationist empire
  (~map 1 day, data+hooks ~2 days, behavioural variant ~1 week); 19b "Dark Farms" hidden sleeper-faction storyline
  (~1 week); 19c chartered companies / VOC-style sub-empires (~1 week on top of 19a). All designed, none started.
- A full game/scenario editor is not planned.

## Next milestones

1. **v0.1 first playable** — close out "Known open items" above: resolve the war/expansion-pace correctness
   questions, land the todosweep package-later ports, finish the rendering gaps (fighters, marker pixels,
   tractor/ion effects, screen mini-maps), and get a real macOS arm64 test + signing pass plus a save-size/time fix.
2. **Polish** — the cosmetic/ordering findings from `tasks/REVIEW-player-layer-2026-09-25.md` (duplicate helper
   cleanup, automation-prompt ordering, minor UI hints), remaining stale-TODO cleanup, and a general pass on anything
   found during v0.1 playtesting.
3. **Mod layer** — 19a mod/scenario data layer + rim-trader empire, 19b Dark Farms storyline, 19c chartered
   companies (`tasks/19-mod-layer-scenarios.md`). No game editor planned.

## M1 — Map & rendering core
| Task | Scope | Status |
|---|---|---|
| 01a | .NET `System.Random` port, core habitat types | ✅ |
| 01b/01c | Galaxy skeleton: stars (6 shapes), solar systems, planets/moons/asteroids | ✅ |
| 01d | Supernova, resources, treasure asteroids | ✅ |
| 01e/01h | Nebulae, galaxy locations (verified against source) | ✅ |
| 01f1–01f3 | Alien race regions, native populations, creatures | ✅ (native-population Rnd truncation bug found + fixed in `50a6942`) |
| 01g/01i | Black-hole/moon names, scenic features, research-bonus industry | ✅ |
| 02, 02b, 02c | Main View seamless galaxy⇄system zoom, art paths, planet/star art, labels | ✅ |
| 03, 03b | Electron desktop shell + packaging (macOS arm64, Linux x86_64) | ✅ |
| 05a–05d | HUD shell: layout, chrome art, font, streamlined redesign, touch-ups | ✅ |
| 06a–06i | Main menu + full new-game wizard (galaxy/race/empire/options/victory/colonization) → `createGame` | ✅ |
| 07a/07b | Galaxy time, orbital motion, HUD clock wiring | ✅ |
| 08f1–08f3 | Region labels, nebula clouds, map label font | ✅ |
| 08g | Click-to-select in Main View | ✅ |
| 08h | Creature spawn + movement/AI tick + combat (landed with M4p/M4u) | ✅ |
| 09a/09b | Music player, sound effects | ✅ |
| 10a–10c | Keyboard shortcuts, selection panel details, escape/game menu | ✅ |
| 10d–10h | HUD live empire data, edge fixes, settings wiring, small TODOs, colony cycling | ✅ |
| 11a1–11a3 | Save / load (JSON + RNG state; IndexedDB saves, .dwusave download/open; main-menu Load) | ✅ |
| 06j–06l | Galactopedia, credits/options, tutorials list + tutorial window | ✅ |

## UI polish (lanes A/B, streamlined HUD)
| Task | Scope | Status |
|---|---|---|
| 12a | G zooms out to the whole galaxy; letter hotkeys fixed (case) | ✅ |
| 12b/12g | Empires list panel (HUD Empires button), column headers | ✅ |
| 12c | Help/*.mht listing in the asset manifest (Galactopedia game-info/theme topics) | ✅ |
| 12d | Shared toast; "not yet available" for unported screens/hotkeys | ✅ |
| 12e | Saves stored in IndexedDB (localStorage quota too small) | ✅ |
| 12f | Tutorials list shows real step titles | ✅ |
| 12h | Sound effects volume/mute in Options | ✅ |
| 12i | Message History panel (H / ticker click) | ✅ |
| 12j | Empire Summary panel (F6) | ✅ |
| 12k | Main View hover tooltip | ✅ |

## Data loaders (feeds M2+)
| Task | Scope | Status |
|---|---|---|
| 04a/04b | Races, families, bias matrices, governments, resources, components, fighters, facilities, plagues, research | ✅ |
| 04c | Loader alignment fix | ✅ |
| 04d1–04d3 | Names, policies, design templates | ✅ |
| — | Known data gap: `Race.nativePlanetType` (1–5) vs generated `HabitatType` (8–16) don't line up, so native-population placement never matches with current data (`08b` in `REVIEW-cloud.md`) | 🔄 |

## M2 — Empires & colonies
Landed via `M2a`–`M2e3` (lanes A/B) plus cloud-lane-C slices `C1`–`C2c-4` (fog of war, colonies, `GenerateEmpire`, game-creation orchestration). See `tasks/M2-plan.md`.
| Slice | Scope | Status |
|---|---|---|
| M2a | Empire core constructor | ✅ |
| C1 | System visibility / fog-of-war model (sim only, not yet wired into render/AI hooks) | 🔄 |
| M2b / C2a | Colonies: `makeHabitatIntoColony`, colony fields on Habitat, resource system | ✅ |
| M2c / C2b | `generateEmpire` (player + AI), empire colours/names | ✅ (Rnd parity with the C# stream holds only up to the first `Empire.DoTasks`, which isn't ported) |
| C2c-1–C2c-4 | GalaxyIndex ring search, `DetermineSystemInfo`, empire-territory grid, research/tech-level runtime, `createGame` orchestration (independent empire, player + AI capitals, starting colonies) | ✅ |
| M2e/M2e2/M2e3 | Empires drawn on the map: owner-colour rings, territory blobs, view/render bug fixes | ✅ |
| — | Known gaps: fractional tech levels (e.g. 0.5) throw in `SetTechTreeStartingDefaults`; expansion beyond the capital is still rare/slow in the current soak — colony-ship designs now exist, so this is a construction-pace question, not a missing-designs one (see State on 2026-09-26 → Known open items) | 🔄 |

### Cloud-lane-C follow-on work (merged)
Slices originally tracked on the cloud-lane-C2 branch are merged into this branch:
- **C2d/C2e** pirate empire generation (`pirates.ts`), pirate faction modifiers (e.g. `RaidStrengthFactor`, verified in `tasks/COMBAT-VERIFICATION-2026-09-26.md`), pirate colours/names; pirate bases/fleets/mining stations render as ordinary `BuiltObject`s.
- **C2f** ship designs at game start: components, `DesignSpecification`/policy parsing, `PlaceComponentsOnDesign`, design generation wired into `Empire.DoTasks`. `Design.ReDefine` (speed/firepower/weapons) is now ported (`wip/redefine`); optimized designs and planet-destroyer design generation at tech level 0 remain unreached/unexercised.
- **C2g** play-as-pirate player start, player policy overrides (enslavement etc.) for both normal and pirate starts — done.

## M3 — Ships & space ops, M4 — the running simulation ✅ (2026-09-25)
Cloud lane C ported the M3 game start (designs, starting ships/bases, pirates, characters, taxes). The whole running
simulation (lane C's M4 plan: 21 packages M4a–u/s1/s2, then the deferred z1–z6) was ported locally by parallel Opus agents
and merged: missions & movement, docking/refuel, orders/contracts/freight, industry, construction & shipyards, empire
construction/facilities AI, colony growth/treasury, research progress, fleets & military AI, threats/weapons/damage,
fighters, invasions/boarding/troops, diplomacy runtime, pirates (marketplace + faction AI), exploration/territory,
events/characters/creatures, espionage, story & scripted events, victory/achievements, super pirates/planet destroyers,
empire teardown/splits. Determinism: one seeded `galaxy.rnd`, fixed-order scheduler, 600 s digest pinned
(`test/tickDeterminism.test.ts`); save/load round-trips the full runtime graph. `src/simLoop.ts` drives the scheduler
from the render loop, so the browser game runs it live. Perf tooling: `scripts/sim-run.mjs` (soak 1,400 stars /
20 empires / 30 game-min without exceptions). See `tasks/M4-plan.md`, `tasks/M4-deferred-plan.md`.

`M4-deferred-plan.md`'s z1–z6 follow-ups — empire/system teardown & splits, espionage, story & scripted events,
victory/achievements/stats, super-pirate & planet-destroyer runtime, pirate-control readers — are merged, closing
out the M4 plan. Combat verified statement-for-statement against the C# on 6 scenarios plus a 30-game-minute soak
(`tasks/COMBAT-VERIFICATION-2026-09-26.md`); two real deviations found and fixed (spawned ships born with every
component `Unbuilt`; `Empire.RaidStrengthFactor` read as 1.0 in boarding maths).

## M9 — UI (done, 2026-09-26)
Streamlined HUD + screens over the live sim: Empires list, Colonies (F2), Empire Summary (F6), Ships & Bases (F11),
Message History (H), Galaxy Map (G), Diplomacy (F5) with trade negotiation, Research (F7), Fleets (F12), Victory /
Comparison (V), Intelligence Agents / Characters (F4), Troops, Expansion Planner, Ship Designs (F8) with the 17f
in-screen design editor, Construction Yards & build order, Empire Policy & automation panel (17d), save/load,
options, tutorials, Galactopedia, Galactic History, autosave. Message/advisor popups are a compact stub list under
the top-right panel that opens into the full dialog on click (`popupstubs`). The player command layer (17a–17f:
build orders, ship-action execution, right-click order menu, policy panel, outgoing diplomacy proposals, design
editor) is merged and reviewed (`tasks/REVIEW-player-layer-2026-09-25.md`). Left out on purpose (streamlined-HUD
decision): the classic minimap (replaced by a list) and each screen's own mini-map (Galaxy Map, Expansion Planner).
Not planned: a full game/scenario editor.

## M5–M8, M10
Research/diplomacy/AI/content runtime landed inside M4 (plus the M4z1-z6 follow-ups above); autosave is done (M10).
Remaining per the spec: content completeness checks (M8), stats XML output, themes/modding (see the mod layer,
`tasks/19-mod-layer-scenarios.md`), and the cross-cutting perf/stability gates (soak pass done 2026-09-26, open
anomalies tracked in State on 2026-09-26 → Known open items).

## Platforms
Native apps for **macOS arm64** and **Linux x86_64** (Electron shell, tasks 03/03b — done; Linux packaging verified).
macOS arm64 builds but is untested on real hardware and unsigned/unnotarized (no `.icns` icon, no
CrossOver/Whisky/Flatpak install detection) — see Known open items. The game reads art/data from the user's DW:U
install folder at runtime; nothing from the original game is committed.
