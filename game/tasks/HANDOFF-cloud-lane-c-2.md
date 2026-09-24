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

## Update — starting techs (tech level 0.5 "Normal")
- `src/sim/data/policies.ts`: EmpirePolicy tech-focus fields (LoadFromFile, ResolveTechFocus/ResolveTechFocuses), ComponentCategoryType, DetermineComponentCategoryByIndex, ResolveTechDisallow. GameData now prefetches `Policy/<race>.txt` and `Policy/pirate/<race>.txt` (a missing file gives the default policy).
- `researchSystem.ts`: SetTechTreeStartingDefaults and ...Pirates, FindAndResearchLowestProject (type/category), GetLowestProjectForTypeAny/Infantry/ResupplyShips, DisallowedRaces from race DisallowedResearchArea1-3/DisallowedComponentIds; `setTechTreeLevel(0.5)` works.
- The Empire ctors (8-arg and independent) call SetTechTreeStartingDefaults(race, policy) as in C#; GenerateEmpire loads the race policy. No Rnd, so the seed-1 pins are unchanged.
- `test/startingTechs.test.ts` (6 tests).

## Update — C2d pirate factions
- `src/sim/pirates.ts`: ports of `Galaxy.8.cs` `GeneratePirateEmpire` (4471/4491/4496) → `generatePirateEmpire`/`generatePirateEmpireRandom`; `SelectRandomPiratePlaystyle` (4291) → `selectRandomPiratePlaystyle`; `SelectRandomPirateRace`/`SelectRandomAggressiveRace`/`SelectRandomRace` (3722/3741/3703) → `selectRandomPirateRace`/`selectRandomAggressiveRace`/`selectRandomRace`; `SetPirateFactionModifiers` (4396, via BaconEmpire) → `pirateFactionModifiers`; `Galaxy.9.cs` `GenerateNewPirateEmpires` (20) → `generateNewPirateEmpires`; `GeneratePirateEmpireName` (738) → `generatePirateEmpireName`; `Galaxy.8.cs` `FindNearestPirateFaction` (2872) → `findNearestPirateFaction` (stub, see TODOs); `Galaxy.7.cs` `FastFindNearestIndependentHabitat` (1944) → `fastFindNearestIndependentHabitat`; `Galaxy.cs`/`BaconGalaxy` `SetEmpireDifficultyFactors` (1417/129) → `setEmpireDifficultyFactors`; `Empire.1.cs` `PirateReviewColoniesToControl`/`PirateCheckControlColony` (3103) → `pirateReviewColoniesToControl`. `PiratePlayStyle` enum and `raceDefaultPiratePlaystyle` (Race.cs "PirateDefaultPlaystyle": file value + 1, kept only if in range) round out the module.
- `createGame` (`src/sim/game.ts`) gains `piratePrevalence`, `pirateProximity`, `maximumEmpireAmount`, `difficultyLevel` options; when `piratePrevalence > 0` it calls `generateNewPirateEmpires` once, after the starting colonies, in place of the first `Galaxy.DoTasks` tick (see Rnd-parity note below).
- Pirate colours: `empireColors.ts` gained `selectColorFromKeyDark` (dark colour-key table for pirate factions) and `determineSecondaryColor` (complementary colour from a main colour); `selectUnusedMainColor(galaxy, isPirateFaction)` picks from the dark table when `isPirateFaction`. `Empire.selectEmpireColors(isPirateFaction, setColors)` in `empire.ts` routes pirate empires through that branch; `generatePirateEmpire` calls it with `isPirateFaction = true` (skipped for super pirates, which keep the fixed black/white placeholder colours pending that feature).
- Empire pirate ctor path (`new Empire(galaxy, name, false, homeHabitat, race, policy)`): explores the `2*sqrt(starCount)` nearest unexplored systems via `galaxy.fastFindNearestUnexploredSystem` (new Galaxy method) instead of the normal empire's home-system reveal. Once `galaxy.age > 0`, empires meeting for the first time also update `knownPirateEmpires`/`metPirateRelations` on both sides (empire.ts ~355-362) — this only fires post game-start since age is 0 at creation.
- Pirate generation runs exactly once inside `createGame`, standing in for the first `Galaxy.DoTasks` long-interval tick in `Start.2.cs`; that tick is itself past the point where Rnd parity with C# already breaks (first `Empire.DoTasks`, unported — see "Rnd parity status" above), so this ordering costs no additional parity.
- Not ported (tracked as TODO(port) comments in `pirates.ts`): play-as-pirate player start (`Start.2.cs` ~560-730); super pirates; the pirate base/fleet/mining stations (need ship designs + `BuiltObjects`, which don't exist yet — in C# this makes `FindNewestCanBuild(SmallSpacePort)` null and skips the whole base block including its Rnd draws, so the TS stream is unaffected by leaving it out); `findNearestPirateFaction`/`FindNearestBuiltObject` are stubs returning null until `BuiltObjects` exist; the `PirateRelation` model (attitude/reputation between empires and pirates) is not modelled beyond `knownPirateEmpires`/`metPirateRelations`; empire flags (`GenerateEmpireFlag`, clock-seeded `Random`, so skipping costs no galaxy Rnd); player pirate policy overrides (enslavement, pirate missions).
- `test/pirates.test.ts` (17 tests): `pirateFactionModifiers` per playstyle, `raceDefaultPiratePlaystyle` mapping, `setEmpireDifficultyFactors` for a non-player empire, `createGame` with `piratePrevalence: 1.0` (well-formed pirate empires, base habitat has fuel resource and isn't co-located with a populated independent colony, starting tech researched without colonisation, distinct pirate colours, determinism pinned for seed 1, and `piratePrevalence` unset gives zero pirates), and `generatePirateEmpireName`'s word-count and exact 4-Rnd-draw shape. Full suite: 312/312 passing (295 existing + 17 new).

## Update — C2f ship designs
Commit `eb6582b`. Ports (one line each):
- `builtObjectTypes.ts`: `BuiltObjectSubRole` (was alphabetised without `Undefined`; now the exact C# member order, since values are used as array indices, e.g. `Empire.LatestDesigns[(int)subRole]`, and in picture-index math — this is a correctness fix to earlier code, not new).
- `componentStatic.ts`: `ComponentDefinition`/`ComponentImprovement`/`Component` (ResolveComponentCategory, ResolveIndustry, IsPlanetDestroyer, EvaluateLatest/EvaluateNext) + `Galaxy.3/4.cs` `GenerateOrderedComponentLists`/`SetHyperDriveSpeeds`/`SetResearchCosts`/`InitializeData` ordering.
- `data/designSpecifications.ts` + `data/designNames.ts`: `DesignSpecification.cs`/`DesignSpecificationComponentRule*.cs` parsing and the small enums (BattleTactics, InvasionTactics, BuiltObjectFleeWhen, BuiltObjectRole, DesignImageScalingMode); `Galaxy.4.cs LoadDesignNames` (designNames.txt family parsing).
- `data/policies.ts`: full `EmpirePolicy.cs` port — every public field, `LoadFromFile`/`SetNameValuePair`, `Parse*` helpers, `Galaxy.4.cs ResolveTechFocus`/`ResolveTechFocuses` (SaveToFile/BuildPolicyLine/Clone not ported — nothing writes policy files back out).
- `design.ts`: `Design.cs`/`DesignList.cs` component list/identity fields, energy helpers for `PlaceComponentsOnDesign`, `IsEquivalent`, `QuickCalculateSize`, `DesignList.Find*`, plus `Galaxy.8.cs DetermineLifeSupportRequired`/`DetermineHabModulesRequired`.
- `designPlacement.ts`: statement-for-statement port of `Empire.10.cs PlaceComponentsOnDesign` (1658-2989) incl. the over-budget size-trim cascade and final reactor/energy-collector/superweapon placement, plus `CheckDesignReactorCountDecreased`/`IncludeOptionalComponent`/`AdjustComponentAmount`/`SelectPreferredSuperWeapon`.
- `designNames.ts`: `Empire.cs GenerateDesignName`/`GetNewProperDesignName`/`RomanNumeral`/`GenerateDesignNamePrefix`.
- `designGeneration.ts`: `BaconEmpire.CreateNewDesigns` (via `Empire.10.cs 3261`), `ReviewDesignComponentsAvailable`, `CheckDesignComponentsAvailable`/`CanBuildDesignTech`/`CheckDesignWithinConstructionSize`/`CanBuildDesign`/`CheckDesignSubRoleShouldBeUpgraded`/`ReviewRemoveObsoleteDesignsForSubRole`, `DesignList.FindNewestCanBuild`/`FindNewestCanBuildFullEvaluate`, `ResolveLegacySubRole`/`ResolveDescription(subRole)`.
- `researchSystem.ts` (component evaluation parts): improvements, latest/best-by-type/category and ordered-component review feeding design generation's buildability checks.
- `galaxy.ts`: `checkEmpireTerritoryCanColonizeHabitat`, `findNearestColonizableHabitatUnoccupiedSystem`/`findNearestColonizableHabitat` (Galaxy.7.cs), `fastFindNearestUnexploredSystem` is pre-existing (pirate exploration, not new here).
- `empire.ts`: `maximumConstructionSize`/`maximumConstructionSizeBase`, `reviewMaximumConstructionSize`, `reviewCanBuildShipTypes`, `canDesignColonizeHabitat`, `determineColonizeLowQualityHabitat`, plus new design-related fields (`controlDesigns`, `initiateConstruction`, `componentDefinitions`, etc.).
- `empireGeneration.ts`: wires `createNewDesigns` into `generateEmpire` at the one ported piece of `Empire.DoTasks` — `Empire.1.cs 3623`'s long-interval block `if (_ControlDesigns) CreateNewDesigns(...)` — everything else in that AI tick remains unported.
- `pirates.ts`: `generatePirateEmpire` calls `createNewDesigns` the same way, standing in for pirates' first `DoTasks`.
- `game.ts`: the colonizable-habitat search (`findNearestColonizableHabitat*`) is now wired into the starting-colonies loop so extra colonies (age ≥ 2 expansion) actually land on habitats the empire can colonize.

Design generation runs at game start only through that one ported fragment of `Empire.DoTasks` (the design step) — called once from `generateEmpire` for normal empires and once from `generatePirateEmpireRandom`/`generatePirateEmpire` for pirates (`GeneratePirateEmpire`). Nothing else in `Empire.DoTasks` is ported. `GenerateDesignName` draws `Rnd`, so this changes the C# Rnd stream from that point on; the seed-1 pins across empire/pirate/game tests were re-pinned to match.

Starting colonies now actually populate (seed 1, tech 0.5, Normal favourability): age 1 → 1 colony per empire (no expansion), age 2 → 2, age 3 → 5-6 (see `test/startingColonies.test.ts`).

Known gaps / TODOs (`grep TODO(port)` in the touched files):
- `Design.ReDefine` (speeds/firepower/weapons/shields/price) is not ported — `FirepowerRaw` stays 0 and `Weapons` is empty, so `IsPlanetDestroyer` is always false (matches an un-ReDefined C# design).
- Optimized designs (`LoadOptimizedDesignsForEmpire`/`ResolveOptimizedDesigns`) not loaded, so `Design.CalculateTechLevel` is never reached (throws if hit — dead code path today).
- The planet-destroyer design-generation branch throws (`TODO(port): planet destroyer design generation`) — unreachable for a starting empire, which never has a super weapon.
- Minor-ship images: `pictureRef` left at 0, `ShipImageHelper.ResolveMinorShipImageIndex`'s own clock-seeded `Random` not ported (no galaxy-Rnd cost).
- `CheckDesignInUse`-style logic is absent pending `BuiltObjects`.
- Pirate base/fleet/mining-station block (`Galaxy.8.cs 4623-4820`) still skipped, but is now *reachable* in principle since a `SmallSpacePort` design exists after this change — flagged as a place where later pirates in a game could start drawing extra Rnd once that block is ported (first pirate's Rnd draws unaffected).
- `DesignNames`'s wall-clock reseed is replaced by a galaxy-seed-derived `Random` (as with other clock-seeded spots) — unreachable divergence in practice.
- Oversized starting designs (e.g. CapitalShip 647 vs max 230 at tech 0.5) are faithful to the C#: DefensiveBase/ResortBase are not trim-eligible (Empire.10.cs 2362), the trim feasibility pre-check abandons trimming when even removing every candidate won't fit (2677-2680), and CreateNewDesigns only checks CanBuildDesign when a previous design of that subrole exists (BaconEmpire.cs 947-955).

Tests: added `test/componentStatic.test.ts`, `test/designNames.test.ts`, `test/designPlacement.test.ts`, `test/designSpecifications.test.ts`, `test/policies.test.ts`, `test/researchComponents.test.ts`, `test/startingColonies.test.ts` (plus updates to `empire.test.ts`/`game.test.ts`/`pirates.test.ts`). Full suite: **401/401 passing**.

## Update — C2g play-as-pirate player start
- `game.ts`: `player.playAsPirate` / `player.piratePlayStyle` port Start.2.cs 567-729 (bool_2): race via method_48(…, pirate), fuel-resource base (FindNearestHabitatWithResource) away from nebulae and independent-colony systems, CheckNearIndependentColony(2,000,000), 3,000,000 retry offsets, GeneratePirateEmpire(isPlayerEmpire), name/playstyle override, nearest-independent exploration. Pirate player excluded from empireList/list3/list6, findAiCapital playAsPirate, num23-- offset.
- Normal player now gets SetEmpireDifficultyFactors; selectRace's fallback uses SelectRandomRace(0).
- `test/pirateStart.test.ts`. Player pirate policy overrides (Galaxy.8.cs 4504) and the player ImplementEnslavement=false (Galaxy.7.cs 5093) are applied; loadEmpirePolicy now returns a copy (C# loads fresh). TODO: pirate flag, Start.2.cs 1493 near-player pirate spawn (after Galaxy.DoTasks; not ported for either mode).

## Update — M3 game start complete (wired)
- `createGame` now runs the full Start.2.cs game-start sequence after the starting colonies: territory review, 20× price reviews, first Galaxy.DoTasks (huge block: territory/popular designs/super-pirate events; long block: independent traders, GenerateNewPirateEmpires), per-empire setup (colony recalc, space ports, base facilities, research-bonus gas giant, pre-warp resources, unlock-tech ruin, research/mining stations, luxury, taxes + colony troops, second Empire.DoTasks stand-in when age > 0, touch-time Rnd), starting state/private ships + troops, diplomatic meetings, pirate-player meetings, starting characters, near-player pirate, ruins, gameStartTail (asteroid fields at age 0, special/bonus/silver-mist ruins, abandoned ships, restricted resources…).
- New modules: builtObject/builtObjectComponent/weapon, builtObjectPlacement, forceStructure(+Projection), resourceTargets, stationPlacement, market, taxes, developmentLevel, raceBias, troops, characters, pirateRelations, diplomacy, independentTraders, ruins, startHabitats, gameStartTail; pirates.ts extended (bases/fleets/super pirates).
- Test seam: `CreateGameOptions.__phaseHook(phase, galaxy, empire?)` → 'stop' returns early at a phase boundary (test-only).
- `test/createGameFull.test.ts` pins the seed-1 game-start summary (4 empires × 1 port/1 research/6 mining stations, 7 explorers + 3 construction ships each, private freighters/miners; 7 pirate factions with bases; 150 independent traders; 27 ruins).
- Rnd parity: C# game start is not seed-deterministic (Galaxy 240 s block reseeds Rnd from the clock; Bacon clock Randoms; worker threads). The port keeps one seeded stream; see tasks/M4-plan.md determinism contract.
- Known TODOs: mission assignment (AssignMissionsToBuiltObjectList no-op; draws Rnd in C#), the rest of Empire/Galaxy DoTasks (M4), story events (off by default), messages/UI text.
- Next: M4 per tasks/M4-plan.md (M4a tick core in progress).

## M4a switch-over + wave 1 (in progress)

- `3a1ae7f`: createGame / GenerateEmpire call the real ticks (tick/gameStart.ts) at the C# sites; stand-ins
  `empireDoTasksStandIn`, `galaxyGameStartHugeTick/LongTick` removed. createGame pins unchanged; the 600 s
  digest moved to `78d35aa06c9a1e5b` (1344-1350 touch stagger now applied, incl. LastHugeTouch).
- Wave 1 merged into `claude/cloud-lane-c2` (last merge `bba13c4`, 626 tests passing):
  - M4b missions/command dispatcher (`missions/`: mission.ts, assign.ts, resolveCommands.ts, executeCommands.ts,
    distress.ts; per-package case stubs `missions/cmd*.ts`).
  - M4d orders/contracts/freight/colony supply (`logistics/`). A null `Habitat.dockingBayWaitQueue` reads as an
    empty queue until M4e creates them.
  - M4j colony growth, satisfaction, treasury, government (`colonyTick.ts`, `treasury.ts`; EmpireCounters class).
  - M4k research progress (`researchTick.ts`, extended `researchSystem.ts`).
  - M4r diplomacy runtime (`diplomacyTick.ts`, `tradeItems.ts`, EmpireEvaluation in `diplomacy.ts`).
  - M4t exploration/visibility/territory (`exploration.ts`; UpdateSystemInfo player variant).
  - Pins moved: 600 s digest now `9582e8126fa8a7cd`; createGameFull / troops / many createGame pins moved with M4k
    (game-start PerformResearch draws Rnd) and M4j (game-start EvaluateColonyVariables / recruitment).
- Wave 2 running in `/home/user/wt/m4{c,g,h,n,s1}` (branched at `58e94b7`, before M4r): M4n on Fable, the rest on Opus.
