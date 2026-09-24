# Task 01f2 — SelectPopulation (independent native populations)

thinking: off

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

**Mechanical port — start editing within your first few tool calls.** Read each listed range once (Read with offset/limit) and translate it line by line into `src/sim/galaxy.ts` (or a new `src/sim/` module), keeping **every `Rnd` call in the same order** and the same constants. Cite the source above each function (`// Port of Galaxy.6.cs <Name>`). Do not survey other files; do not Read image files.

Depends on 01f1. Port:
- `$SRC/Galaxy.6.cs` 1218–1254 `SelectPopulation(habitat, sun)`
- helpers: `Galaxy.6.cs` 1330–1346 `CalculatePopulationAmount`, 1273–1292 `CheckIndependentColonyLimitForRace`, 1320–1329 `RenameSystemIfHome`, and `$SRC/Galaxy.4.cs` 1919–1938 `DetermineNearestRaceRegion`.
- `Population` / `PopulationList` types from `$SRC/Population.cs`, `PopulationList.cs` (only the fields these use; `RecalculateTotalAmount`).

Wire at the `TODO(port): SelectPopulation` site(s) in `src/sim/galaxy.ts` (inside the setupSolarSystem port), exactly where the C# calls it.

Tests: some colonizable planets carry native populations whose race ids exist in GameData; deterministic. `npm run typecheck` && `npm test`. Append `## Worker report`.
