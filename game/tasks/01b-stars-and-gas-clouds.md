# Task 01b — Galaxy skeleton: stars (all shapes), names, gas clouds

Depends on 01a (`src/sim/random.ts`, `src/sim/types.ts`). **Work style:** read one function (Read with offset/limit on the given lines), immediately write its TS port, then move to the next. Do not survey other files. Cite the source above each function: `// Port of Galaxy.5.cs SetupSun`.

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

Create `src/sim/galaxy.ts` with a `Galaxy` class holding `rnd: Random`, `sizeX, sizeY, sectorSize (2_000_000), sectorWidth, sectorHeight, starCount, galaxyShape, habitats: Habitat[], systems: SystemInfo[]`, star-cluster lists.

Port in this order:
1. `Galaxy.3.cs` 5723–5734 `SetGalaxyPhysicalDimensions`.
2. `Galaxy.5.cs` 2830–2900 `ObtainRandomGalaxyCoordinates*` (and any helper they call).
3. `Galaxy.5.cs` 1102–1374 `SetupSun(galaxyShape)` — star type selection + position per shape (spiral arms, elliptical, ring, irregular, clusters). Port every helper it calls (find each with Grep `-n` for its name, then Read just that function).
4. `Galaxy.4.cs` 2788 `GenerateCodeName`, 3495+ `AssignSystemName` (system names are passed in as `systemNames: string[]` — read `/home/justinf/projects/Dwureup/game/public/assets/dwu/systemNames.txt` format with `head` to see it; loader `src/sim/data.ts` `parseSystemNames(text)`).
5. `Galaxy.5.cs` 1947–2060 `SetResearchBonus`, `SetScenicFactor`.
6. `Galaxy.4.cs` 2794–2990 `GenerateGasCloud()` and the overload.
7. The constructor part, `Galaxy.4.cs` 2221–2345: cluster setup (2221–2276), then per star call **a stub** `setupSolarSystem(shape)` that for now does `SetupSun` + `AssignSystemName`/`SetScenicFactor`/`SetResearchBonus` only (Task 01c fills in planets — mark `TODO(01c)` where planets go, at the matching place in `Galaxy.5.cs` 1386+), the gas-cloud loop, sort, re-index, build `systems`.

Public API: `generateGalaxy({ seed, shape, starCount, sectorWidth, sectorHeight, colonyPrevalence, systemNames }): Galaxy`.

Tests `test/galaxy.test.ts`: per shape with 700 stars → 700 star systems (+ gas clouds count in `[140, 350)`), all coords in bounds, deterministic for a seed; spiral density higher at center than rim.

Done when `npm run typecheck` && `npm test` pass. Append `## Worker report`.
