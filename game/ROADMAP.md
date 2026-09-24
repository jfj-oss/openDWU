# Roadmap

Milestones follow the spec's Part 15 (16.1) in `Distant_Worlds_Universe_Recreation_Prompt.md`. Status: ✅ done · 🔄 landed with known gaps · 📝 task spec written, not yet run · ⬜ not started.

## How the work is organised
- **Lanes A/B (ninfer, headless Sonnet at low effort):** small tasks with `scope: locked` + `thinking: off` in their spec (`tasks/NN-*.md`), one C# source excerpt pasted in per task so the worker never has to explore the game install. Run via `scripts/run-queue.sh`; `scripts/worker.sh` picks the model, `WORKER=ninfer` uses the local NInfer-4090 box instead of the API.
- **Lane C (cloud, Opus):** larger, cross-cutting slices that need judgment or the decompiled source directly — M2 empire model, colonies, visibility, orchestration, ship designs. Tracked in `tasks/HANDOFF-cloud*.md`, `tasks/REVIEW-cloud.md`, `tasks/M2-plan.md`.
- Game art/data/decompiled source live in the private repo **jfj-oss/dwu-assets**, symlinked in as `public/assets/dwu` (`npm run import-assets`); nothing from the original game is committed here.
- Reviews (typecheck + tests + screenshot comparison against real gameplay footage) happen after each worker commit before the next task starts.

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
| 08h | Creature spawn + movement/AI tick (combat still TODO, needs `BuiltObject`s) | 🔄 |
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
| 12j | Empire Summary panel (F6) | 🔄 |
| 12k | Main View hover tooltip | 🔄 |

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
| — | Known gaps: pirates not generated during `createGame` (C2d, tracked below as unmerged); fractional tech levels (e.g. 0.5) throw in `SetTechTreeStartingDefaults`; extra starting colonies rely on colony-ship designs that mostly don't exist yet, so expansion beyond the capital is rare | 🔄 |

### Unmerged cloud-lane-C work (`origin/claude/cloud-lane-c2`, not yet in this branch)
Further slices exist on the cloud-lane-C2 branch but haven't been merged into the working branch yet:
- **C2d/C2e** pirate empire generation (`pirates.ts`), pirate faction modifiers, pirate colours/names — pirate base/fleet/mining stations still stubbed (need `BuiltObject`s).
- **C2f** ship designs at game start: components, `DesignSpecification`/policy parsing, `PlaceComponentsOnDesign`, design generation wired into the one ported fragment of `Empire.DoTasks`. Known gaps: `Design.ReDefine` (speed/firepower/weapons) unported, optimized designs not loaded, planet-destroyer design generation throws (unreachable today).
- **C2g** play-as-pirate player start, player policy overrides (enslavement etc.) for both normal and pirate starts.

## M3–M10
Not started as dedicated milestones (design/component/policy data models from the unmerged C2f work above will feed M3 once merged). Order per the spec: M3 Ships & space ops → M4 Combat → M5 Research → M6 Diplomacy & espionage → M7 AI & automation → M8 Content & storylines → M9 UI completeness → M10 Persistence & modding (11a save/load above is a down payment on M10). Each will be split into pre-mapped small tasks (source file + line ranges) before it starts, the same way M1/M2 were.

## Platforms
Native apps for **macOS arm64** and **Linux x86_64** (Electron shell, tasks 03/03b — done). The game reads art/data from the user's DW:U install folder at runtime; nothing from the original game is committed.
