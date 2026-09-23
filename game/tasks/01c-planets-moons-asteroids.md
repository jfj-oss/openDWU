# Task 01c — Solar systems: planets, moons, asteroid fields

Depends on 01b. **Work style:** read one function (Read with offset/limit), write its port, next. Cite the source above each ported function.

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

Replace the `TODO(01c)` stub in `src/sim/galaxy.ts` with a full port of `Galaxy.5.cs` 1386–~1700 `SetupSolarSystem(galaxyShape, sunHabitat, out asteroidField)` in the original order, plus the helpers it calls:
- `Galaxy.6.cs` 2307 `CalculatePlanetTypePrevalenceByStarType`, 2365 `SelectPlanetType`, 1873 `SelectMoonType`, 2062 `SelectHabitatPictures`.
- `Galaxy.4.cs` 3170 `SelectHabitatQuality`.
- `Galaxy.9.cs` 3463–3600 `GenerateAsteroidField` (both overloads; resources param → skip with TODO but keep its Rnd calls).
- `SelectResources`, `SelectPopulation`, `SelectCreatures`: **do not port yet** — but if they consume `Rnd` calls, note in the report which ones (they'll desync the sequence until ported; acceptable for now).
For each helper: Grep `-n` for `void <Name>(` or `<Name>(` to get the line, Read ~150 lines from there.

Tests (extend `test/galaxy.test.ts`): planets' parent is their system's star; moons' parent is a planet; orbit distances within the ranges SelectPlanetType returns; planet count per system obeys the SetupSolarSystem tables (≤ 15 for main-sequence, ≤ 2 white dwarf, ≤ 1 neutron, 0 supernova); deterministic.

Done when `npm run typecheck` && `npm test` pass. Append `## Worker report`.
