# Handoff — cloud lane C, task C2 (partial): colonies + GenerateEmpire landed; orchestration blocked

Branch `claude/cloud-lane-c2` (based on working branch `e53add3` = M2a, and it merges `claude/cloud-lane-c1`). Typecheck clean; 267/267 tests pass.

## Landed
| Slice | Commit | What |
|---|---|---|
| C2a (M2b) | `0a47e91` | `colony.ts` makeHabitatIntoColony + setColonyResources (Galaxy.8.cs 639/699); colony fields on Habitat (owner, empire, isRefuellingDepot, damage→quality, troopsToRecruit, invadingTroops, facilities stub); `Empire.takeOwnershipOfColony` core; M2b owner checks in setColonizableHabitatsInSystem; `resourceSystem.ts` (strategic/luxury/fuel lists, CalculateRelativeImportanceLevels, SortByRelativeImportance); `netSort.ts` (.NET introsort, because List.Sort is unstable and tie order matters). |
| C2b (M2c) | `bc97f4b` | `empireGeneration.ts` generateEmpire (Galaxy.7.cs 5078-5377 in C# order); `empireColors.ts` + Empire.SelectEmpireColors (colour keys, unused/complementary colours); Empire.GenerateEmpireName; player-capital colony name; Empire ctor `isPlayerEmpire` arg. |

## Fixes to earlier code (please note when merging)
- **M2a `SystemVisibilityStatus`** had the wrong member order (Unexplored, Visible, Explored). It is now re-exported from `visibility.ts` (C#: Undefined, Unexplored, Explored, Visible). Empire now holds a C1 `EmpireVisibility` (`empire.visibility`); `systemVisibility` and `resourceMap` are getters over it, and M2a's stub ResourceMap is removed.
- **M2a placeholder constants replaced with the C# values:** ColonyAnnualResourceConsumptionRate 1e-8, luxury 2e-8, MinimumLuxuryResourceReorderAmount 100, _LongProcessingInterval 120 s.
- **M2a `setStartupColonyResourceCargo`** now iterates the real `StrategicResourcesOrderedByRelativeImportance` / `LuxuryResources`, and `SelectRandomLuxuryResource` is ported (50-try restricted/manufactured filter).
- **`Cargo.reserved`** is an int, as in C# (`Cargo.cs:21`); M2a had a bool.
- **`CargoList.add`** merges same empire + resource (CargoList.cs:183).
- **`PopulationList.add`** merges same-race populations and does not touch TotalAmount (PopulationList.cs:38); `dominantRace` getter added. One galaxy test assertion was relaxed accordingly (independentCount ≥ entries).

## Rnd parity status
- `GenerateEmpire` matches the C# stream **up to `empire.DoTasks()`** (Galaxy.7.cs ~5341). The Empire ctor backdates its touch times, so the first DoTasks runs the full empire AI tick (draws Rnd, not ported). Everything drawn after the first GenerateEmpire therefore diverges until Empire.DoTasks exists. The header of `empireGeneration.ts` lists which other unported callees were checked and don't draw Rnd.
- `SetTechTreeLevel` draws only for fractional tech levels, so integer tech levels stay exact.

## Why C2c (createGame orchestration) is not done — blockers
`Start.2.cs CreateGameFromSettings` (the actual orchestrator; method_81 is the save loader just above it) needs these before it can match the C# Rnd sequence:
1. **GalaxyIndex ring search.** `FastFindNearestPlanetMoonOfTypesUnoccupiedSystem` draws `Rnd.Next(0, habitats)` **per system visited**. The draw count depends on the C# SystemsIndex/HabitatIndex grids, `DetermineSectorBoundaries` / `BuildIndexListForSearching` visit order, and early exit. The linear-scan stand-ins used so far (visit order doesn't matter when no Rnd is drawn) aren't enough here. Needs a port of ResolveIndex / IndexMaxX / DetermineSectorBoundaries / BuildIndexListForSearching and index grids built in C# insertion order.
2. **SystemInfo.PlanetCount / DominantEmpire** (UpdateSystemInfo / DetermineSystemInfo), used by method_51 and the colony searches.
3. **EmpireTerritory grid** (`CheckEmpireTerritoryIdAtLocation`, ReviewEmpireTerritory / ReviewEmpireTerritoryUpdate), inside the per-system colony search.
4. **Designs + research colonisation flags.** `FindNearestColonizableHabitatUnoccupiedSystem` returns null without a buildable colony-ship design; `ColonizableHabitatTypesForEmpire` needs CanColonize* from research.
5. **Galaxy.DoTasks** (runs after the starting colonies), plus pirates, ruins, age-0 asteroid fields/creatures, and the special-location blocks that follow in the same method.

Suggested task order: **C2c-1** GalaxyIndex ring search (self-contained; also lets every nearest-X helper drop its linear scan) → **C2c-2** UpdateSystemInfo + EmpireTerritory → **C2c-3** research colonisation flags + colony-ship design stub → **C2c-4** createGame (independent empire, SetNativeResourceCargo/SetEmpireForAllIndependentHabitats/ReviewIndependentColonies, player + AI capitals via method_48/51/53/84/91/92/93, starting colonies) → **C2d** GeneratePirateEmpire + pirate placement. Exact parity past the first GenerateEmpire also needs **Empire.DoTasks**.

## Update — C2c landed (supersedes "C2c blocked" above)
- C2c-1 `e13b93c`: resource system, netSort, ICU-sorted system list, gas clouds are systems.
- C2c-2 `cf2bbec`: GalaxyIndex ring search, DetermineSystemInfo, nearest-* finders.
- C2c-3 `18e3429`: territory, research tree levels, independent empire ctor.
- C2c-4: `src/sim/game.ts` `createGame(options)` — independent empire, player capital, AI empires (proximity modes, region placement), starting colonies, ReviewIndependentColonies, SetEmpireForAllIndependentHabitats. `test/game.test.ts` pins seed 1 capitals S147/S127/S81/S63, 1 colony each.
- Still TODO: C2d pirates; tech level 0.5 (SetTechTreeStartingDefaults) throws; designs/colony ships (so extra starting colonies are rare); Empire.DoTasks (Rnd parity ends there); C3 galaxy map must skip gas-cloud systems after merge.
