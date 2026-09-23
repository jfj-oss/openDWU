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

## Worker report

**Files changed:**
- `src/sim/galaxy.ts` (new) — `Galaxy` class + `generateGalaxy()`.
- `src/sim/data.ts` (new) — `parseSystemNames()`.
- `test/galaxy.test.ts` (new) — vitest coverage per the task spec.

**Done:**
- `SetGalaxyPhysicalDimensions` (Galaxy.3.cs 5723) ported as `Galaxy.setGalaxyPhysicalDimensions`; confirmed `SectorSizeX = SectorSizeY = 2_000_000`, `IndexSize = 400_000` via grep in `Galaxy.3.cs`/`Galaxy.cs`.
- `ObtainRandomGalaxyCoordinates` (both overloads, Galaxy.5.cs 2830-2865) ported.
- `SetupSun` (Galaxy.5.cs 1102-1373) ported for all six `GalaxyShape` variants (Spiral/Elliptical/Irregular/Ring/ClustersEven/ClustersVaried), including `SelectClusterIndex` and `SelectStar` (Galaxy.6.cs 2525-2617) helpers, and the star-cluster setup portion of the constructor (Galaxy.4.cs 2221-2276, as `Galaxy.setupStarClusters`).
- `GenerateCodeName` (Galaxy.4.cs 2788) and `AssignSystemName` (Galaxy.4.cs 3495-3543) ported; `parseSystemNames` in `src/sim/data.ts` parses `systemNames.txt`'s comment/comma-list format (verified against the real file's first 20 lines).
- `SetResearchBonus` / `SetScenicFactor` (Galaxy.5.cs 1947-2060, partial for `SetScenicFactor` — only the cases through line 2060 as specified) ported; numeric bonuses (`researchBonus`, `scenicFactor`) applied, RNG call sequence preserved even where the resulting value (`ResearchBonusIndustry`, `ScenicFeature`, `HasRings`) isn't stored (those fields don't exist on `Habitat` yet).
- `GenerateGasCloud()` (Galaxy.4.cs 2794-2955) ported: type roll, diameter roll, min-distance retry loop, picture-ref bucketing, orbit-direction roll all faithful. The nebula-anchored placement is **not** faithful (see below).
- Constructor logic (Galaxy.4.cs 2221-2347): cluster setup, per-star loop calling `setupSolarSystem` (stub with `TODO(01c)` marker where planet generation belongs), gas-cloud loop (`Rnd.Next(starCount/5, starCount/2)` — matches the `[140, 350)` test bound for `starCount=700`), then habitat re-indexing and `SystemInfo[]` construction (one per star; each system's `habitats` currently contains only the star itself, since moons/planets aren't generated).
- `npm run typecheck` and `npm test` both pass (22 tests).

**Left undone / approximated (all noted with `TODO(port)`/`TODO(01c)` comments in `galaxy.ts`):**
- **Nebula clouds / `GalaxyLocation` are not ported.** `GenerateGasCloud()` in the source anchors clouds inside existing `NebulaCloud` locations; since no nebula/location system exists yet, gas clouds are placed at uniform-random galaxy coordinates instead. This is a real deviation from the original spatial distribution (clouds would otherwise cluster in nebulae) but the RNG call sequence and all other mechanics (type/diameter rolls, retry loop, distance threshold) are preserved.
- `FindNearestSystemGasCloudAsteroid` is ported as a linear scan over `habitats` filtered to `GasCloud`/`Asteroid` categories, rather than the original's `GalaxyIndex` sector-grid search — same result, no perf optimization (fine at current scale; galaxy.test.ts runs starCount up to 700 well under 200ms).
- Black hole "Pull"/"Event Horizon" and supernova `GalaxyLocation` objects at the end of `SetupSun` are skipped entirely (needs `GalaxyLocation`, out of scope).
- `AssignSystemName`'s black-hole-name branch (`GenerateBlackHoleName`) is not ported; black-hole stars just get a code name via `GenerateCodeName` (same as any 0-planet system, which is what all stars currently are, since planets aren't generated in this task).
- `SetScenicFactor`'s cases past line 2060 (further habitat types) are out of scope per the task's line range and not ported.
- `Habitat.researchBonusIndustry`, `.scenicFeature`, `.hasRings` don't exist on the `types.ts` `Habitat` class; the corresponding RNG rolls are still consumed (to keep the random sequence faithful) but the values are discarded.
- The final sort step in the source constructor (`list.Sort()`, relying on `HabitatList`/`IComparable`) isn't ported — system/gas-cloud groups are instead kept in original generation order. This preserves determinism (same seed → identical output) but doesn't reproduce the original's exact in-memory habitat ordering (which only affects internal indexing, not any tested behavior here).
- `colonyPrevalence` is accepted in `generateGalaxy()`'s options for API-shape compatibility but currently unused (no colonies are generated yet).
