# Star-list audit — 2026-09-26 (branch wip/staraudit)

C# `SystemInfo.Habitats` never contains the star: Galaxy.4.cs 2340 `systemInfo.Habitats = DetermineHabitatsInSystem(star)`,
and Galaxy.6.cs 4611 collects the entries *after* the star in `Galaxy.Habitats` whose `Parent != null`. The TS
`SystemInfo.habitats` array holds the star at [0]. `planetsOf(system)` (src/sim/types.ts) gives the C# list;
`galaxy.systemHabitatsOf(i)` delegates to it. The raw `system.habitats` is kept only where the C# covers the star as well
(generation, Galaxy.Habitats-wide index rebuilds, UI lookups).

Tests: `test/starListAudit.test.ts`, one per fixed group (A map knowledge, B refuelling, C AI assets/targets, D planetsOf
invariant, which also covers the order-menu group). Pins: `npm run repin -- --dry-run` / `--check` report 0 moved (no seed-1
pinned scenario reaches a reader whose result changes).

"Effect" means what changes when the star is iterated: **visible** = the result differs, **none** = the same result
(the star fails the loop's filter, or the C# handles it separately and the operation is idempotent).

## Direct `system.habitats` readers

| # | TS file:line (after fix) | C# file:line | C# includes star? | TS matched before? | Effect | Fix applied? | Test |
|---|---|---|---|---|---|---|---|
| 1 | src/sim/exploration.ts:971 InvestigateRuins map reveal | Galaxy.5.cs 4137 | no (star set separately at 4145) | no | none (idempotent SetResourcesKnown) | yes, planetsOf | — |
| 2 | src/sim/exploration.ts:1235 InvestigateRuins Refugees target | Galaxy.5.cs 4498 | no | no | **visible**: the star (index 0) was the first habitat > 400 away, so refugees spawned at the star | yes | A |
| 3 | src/sim/combat/ownership.ts:1344 InvestigateAbandonedBuiltObject map reveal | Galaxy.5.cs 5393 | no (star set separately) | no | none | yes | — |
| 4 | src/sim/story/eventActions.ts:1139 event map reveal | Galaxy.9.cs 2269 | no (star set separately) | no | none | yes | — |
| 5 | src/sim/tradeItems.ts:223 ValueGalaxyMapForEmpire | Galaxy.4.cs 4635 | no | no | **visible**: a known star added 200 to the map value | yes | A |
| 6 | src/sim/tradeItems.ts:446 GiveTerritoryMap | Galaxy.4.cs 3817 DetermineHabitatsInSystem | no | no (`Math.max(1, n)`) | none in practice: star-only systems never have colonies, so they are not in DetermineEmpireSystems | yes (the loop count is now the C# count) | — |
| 7 | src/sim/tradeItems.ts:1621 ReviewDisputedTerritory | Empire.7.cs 2290 | no | no | none (the star has no owner) | yes | — |
| 8 | src/sim/movement.ts:1735 FastFindNearestRefuellingPointInIndex | Galaxy.6.cs 3375 | no (a gas-cloud star's bases are the 3332 branch) | no | **visible**: bases at a star were refuelling points (and gas-cloud spaceports skipped the 3332 visibility test) | yes | B |
| 9 | src/sim/movement.ts:1831 IdentifyWhetherSystemIsRefuellingPointForEmpire | Galaxy.6.cs 3219 | no (a gas-cloud star's bases are the 3181 branch) | no | **visible** (same as #8) | yes | B (shares the scenario) |
| 10 | src/sim/movement.ts:2061 UpdateSystemFuelSourceStatus | Empire.2.cs 3828 | no (a gas cloud is handled at 3817) | no | none (same conditions + Contains dedupe) | yes | — |
| 11 | src/sim/independentTraders.ts:638 UpdateEmpireRefuellingLocations | Empire.6.cs 3905 | no (gas cloud `continue`s at 3881) | no | **visible**: a normal star's bases were refuelling locations | yes | B |
| 12 | src/sim/civilianAI.ts:2330 IdentifyColonizationTargets | Empire.4.cs 4713 | no | no | none (the Star category is filtered) | yes | — |
| 13 | src/sim/civilianAI.ts:2744 FindNextSystemToScout | Galaxy.6.cs 4027 | no | no | none (stars have no ruin) | yes | — |
| 14 | src/sim/diplomacyTick.ts:1264 IdentifyOurDisputedColonies | Empire.9.cs 3531 | no | no | none (the star has no empire) | yes | — |
| 15 | src/sim/diplomacyTick.ts:3038 colony-trade valuation | Empire.3.cs 4562 `Systems[habitat].Habitats` | no | no | none (the star is never a colony) | yes. C# oddity: the SystemInfoList indexer matches SystemStar only (SystemInfoList.cs 16), so a colony subject gives null and throws; TS keeps the subject's system (TODO noted) | — |
| 16 | src/sim/pirates/pirateFleets.ts:87 IdentifyDesiredEnemyMiningStations | Empire.2.cs 4186 | no | no | **visible** in principle: a gas-cloud star's gas mining station became a raid target | yes | — (scenario needs deficient resources; covered by the group C pattern) |
| 17 | src/sim/pirates/pirateFleets.ts:127 IdentifyRaidableColonies | Empire.2.cs 4279 | no | no | none (the star is unpopulated) | yes | — |
| 18 | src/sim/fleets/militaryAI.ts:4012 SendScoutsToSingleEnemyEmpire | Empire.9.cs 4528 | no | no | **visible**: star-only systems were scouted (C# skips Count ≤ 0), and the star was the fallback target | yes | — |
| 19 | src/sim/player/executeShipAction.ts:2005 IdentifyEmpireAssetsInSystem | Empire.9.cs 312 | no | no | **visible**: bases at the star (gas-cloud mining stations) were patrol assets, which changed the Rnd.Next(0, n) bound and the Patrol/Move choice | yes | C |
| 20 | src/sim/logistics/freight.ts:200 GenerateValidTradingPosts | Empire.4.cs 619-625 | no | no | none (star-only: Count ≤ 0 continue vs nothing found) | yes | — |
| 21 | src/sim/story/storyEvents.ts:802 GenerateAncientHelpers | Galaxy.8.cs 1980 | no | no | none (star types are outside the switch) | yes | — |
| 22 | src/sim/combat/damage.ts:1665 DestroyHabitat moons | BuiltObject.1.cs 3539-3544 | no | no | none (the star's Parent is null) | yes | — |
| 23 | src/sim/player/orderMenu.ts:582 method_137 coloniesNear | Main.Part11.cs 1217 | no | no | none (unpopulated) | yes | D (invariant) |
| 24 | src/sim/player/orderMenu.ts:603 method_138 foreignPopulatedNear | Main.Part11.cs 1245 | no | no | none | yes | D (invariant) |
| 25 | src/sim/player/orderMenu.ts:619 method_139 colonizableNear | Main.Part11.cs 1268 | no | no | none (the star cannot be colonized) | yes | D (invariant) |
| 26 | src/sim/player/orderMenu.ts:3751 FindNearestHabitatInSystem | Galaxy.6.cs 3630 | no (the star is tested first at 3619) | no | none (strict `<` against its own distance) | yes | D (invariant) |
| 27 | src/sim/events.ts:980 RemoveSystem | Galaxy.9.cs 3176-3193 | the C# adds the star itself (`Count + 1`, RemoveSingleHabitat(star)) | yes (already adapted: `-length`, star skipped by category) | none | n/a | — |
| 28 | src/sim/events.ts:1116 Habitat.CompleteTeardown RemoveAt(IndexOf) | Habitat.cs 7613 | n/a (removal by identity) | yes | none | n/a | — |
| 29 | src/sim/galaxy.ts:3511 / 4432 AddHabitat / asteroid insert (writes) | Galaxy.9.cs 3225ff | writes to Habitats | yes | — | n/a | — |
| 30 | src/sim/galaxy.ts:4726ff Build Systems (generation) | Galaxy.4.cs 2335-2347 | star stored as SystemStar | yes (TS convention: star at [0]) | — | n/a | — |
| 31 | src/sim/save/galaxySave.ts:421 index-grid rebuild on load | Galaxy.Habitats → HabitatIndex (includes stars) | **yes** | yes (star-inclusive needed) | — | keep raw list. Separate finding: generation puts every habitat in its *star's* index cell (galaxy.ts 4714-4719), while the load rebuild uses each habitat's own cell. Not fixed here | — |
| 32 | src/sim/gameStartTail.ts:251 | (already filters the star) | no | yes | — | n/a | — |
| 33 | src/sim/player/shipAction.ts:138 isSystemInfo type guard | — | n/a | n/a | — | n/a | — |
| 34 | src/sim/player/advisorBrief.ts:278 isSystemExplored | Galaxy.6.cs 4542 FindNearestUnexploredHabitatInIndex (HabitatIndex, includes stars) | **yes** | yes | — | keep | — |
| 35 | src/sim/player/advisorBrief.ts:472 / 568 advisor contacts / colonize targets | TS advisor (no C# Systems[].Habitats read) | n/a | — | none (the star is unowned and cannot be colonized) | keep | — |
| 36 | src/main.ts:404, 1164; src/ui/hud.ts:998, 1037, 1083 `systems.find(s => s.habitats.includes(h))` | UI: system of a habitat *or star* | yes (must find the star's system) | yes | — | keep | — |
| 37 | src/ui/hud.ts:1243, 1809-1823; src/render/mainView.ts:432/436; src/render/empireLayer.ts:211; src/ui/screens/galaxyMap.ts:569 | UI / render (draw every body; counts filter by category) | yes / category-filtered | yes | none | keep | — |

## `galaxy.systemHabitatsOf(i)` readers (already exclude the star; spot-checked against the C#)

empireGeneration.ts:176 (Galaxy.7.cs 5338, verified), creature.ts:558/579 (Creature.cs InitiateWander), game.ts:417/606/940
(Start.cs method_50, Galaxy.6.cs ClearIndependentColoniesFromSystem, Start.2.cs), industry.ts:230 (Empire.2.cs
PrioritizeEmpireResourceNeeds), empire.ts:681 (Empire.cs 4257-4260: star set separately, verified), resourceTargets.ts:335,
visibility.ts:137/289 (star set separately / Empire.9.cs CheckSystemVisible), civilianAI.ts:849/1655/2829/3014/3094 (fix7,
cited), events.ts:1700, startHabitats.ts:158, ruins.ts:616, exploration.ts:335/502, shipGroupTasks.ts:1660, galaxy.ts:392/760/
3411/3503, pirates.ts:700/1034, stationPlacement.ts:567, empireConstruction.ts:2075/2094, pirateShipMissions.ts:677,
ui/screens/galaxyMap.ts:559. All match (C# excludes the star). None changed.

**Totals:** 37 direct-reader rows audited (46 sites) plus 35 `systemHabitatsOf` readers. 26 direct readers now use planetsOf
(8 of them change a visible result: #2, #5, #8, #9, #11, #16, #18, #19). The rest already matched or need the star.
