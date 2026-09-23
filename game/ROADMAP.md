# Roadmap

Milestones follow the spec's Part 15 (16.1). Each milestone is split into small **worker tasks** (headless Claude Code, Sonnet at low effort) (`tasks/NN-*.md`), run by `scripts/run-queue.sh` and reviewed by the orchestrator (typecheck + tests + screenshot comparison against real gameplay footage).

Status: ✅ done · 🔄 running/queued · 📝 spec written · ⬜ not started

## M1 — Map & rendering core
| Task | Scope | Status |
|---|---|---|
| 01a | .NET `System.Random` port, core habitat types | ✅ |
| 01b | Galaxy skeleton: star placement (6 shapes), names, gas clouds | 🔄 |
| 01c | Solar systems: planets, moons, asteroid fields | 🔄 |
| 02 | Main View: one seamless zoom galaxy ⇄ system, original art | 📝 |
| 03 | Native desktop shell (Electron): macOS arm64 + Linux x86_64 | 📝 |
| 05 | HUD shell: original layout, chrome art, font, zoom/time/minimap | 📝 |
| 06 | Main menu + new-game wizard (all pages) | 📝 |
| — | Resources + nebulae/GalaxyLocations + ruins + creatures placement | ⬜ |
| — | Visibility / fog of war, time system | ⬜ |
| — | Galaxy Map screen (G) | ⬜ |

## Data (feeds M2+)
| Task | Scope | Status |
|---|---|---|
| 04a | Loaders: races, families, bias matrices, governments, theme paths | 🔄 |
| 04b | Loaders: resources, components, fighters, facilities, plagues, research | 🔄 |

## M2–M10
Not started. Order per the spec: M2 Empires & colonies → M3 Ships & space ops → M4 Combat → M5 Research → M6 Diplomacy & espionage → M7 AI & automation → M8 Content & storylines → M9 UI completeness → M10 Persistence & modding. Each gets split into pre-mapped tasks (source file + line ranges) before it starts.

## Platforms
Native apps for **macOS arm64** and **Linux x86_64** (Electron shell, task 03). The game reads art/data from the user's DW:U install folder; nothing from the original game is committed.
