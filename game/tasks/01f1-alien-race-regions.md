# Task 01f1 — SetupAlienRacePopulations (race regions)

thinking: off

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

**Mechanical port — start editing within your first few tool calls.** Read each listed range once (Read with offset/limit) and translate it line by line into `src/sim/galaxy.ts` (or a new `src/sim/` module), keeping **every `Rnd` call in the same order** and the same constants. Cite the source above each function (`// Port of Galaxy.6.cs <Name>`). Do not survey other files; do not Read image files.

Port, in this order:
- `$SRC/Galaxy.6.cs` 1055–1199 `SetupAlienRacePopulations(empireStarts, aggressiveRacesRequired)`
- its helpers: `Galaxy.6.cs` 1021–1043 `DetermineAggressiveRaces`, 1200–1211 `DetermineRaceRegion`, 1050–1054 `CheckDistanceFromLocation`, 977–995 `CheckLocationOverlap`, and `$SRC/EmpireStartList.cs` from line 47 `TotalColoniesForRace`.
- It creates race-region `GalaxyLocation`s — use the GalaxyLocation types from task 01e (`src/sim/galaxyLocation.ts`) and `addGalaxyLocationIndex` if 01e added one (else a TODO).

Wire it into the constructor port **before the star loop**, where the C# calls it (`$SRC/Galaxy.4.cs` ~2205–2220: `aggressiveRacesRequired` = 3/2/1/0 for `aggressionLevel` ≥ 1.5 / 1.3 / 1.1 / else). Add `aggressionLevel` (default 1.0) and `empireStarts` (default empty) to `GalaxyOptions`; races come from GameData (task 04a) via `generateGalaxy` options.

Tests: race regions exist, inside galaxy bounds, deterministic; aggression 1.5 marks ≥ 3 aggressive races. `npm run typecheck` && `npm test`. Append `## Worker report`.
