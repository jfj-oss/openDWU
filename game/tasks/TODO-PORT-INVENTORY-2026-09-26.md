# TODO(port) inventory — 12 densest sim files (2026-09-26)

Branch `wip/todosweep`. Lines are those of the base commit `00bdcb7` (before the sweep). Scope: every `TODO(port)` in empire.ts, story/eventActions.ts, galaxy.ts, forceStructure.ts, independentTraders.ts, game.ts, story/storyStart.ts, diplomacyTick.ts, builtObject.ts, resourceTargets.ts, gameStartTail.ts, exploration.ts (136 notes).

## Method

- Callers grepped for every code-path note; C# read at the cited method.
- Reachability: temporary counters (worktree only, reverted) at each code-path note, then `node scripts/sim-run.mjs --seed 1 --seconds 1800` (700 stars, 10 empires, age 1, pirates on = 30 game minutes, 1095 game days) and the same with `--seed 2 --age 0` (PreWarp start). Counts quoted below are from those runs (createGame + 30 min). "0 hits" = code path reachable in a normal game but not taken in these 30 minutes.
- Verdicts: **port-now** (small, reachable; ported in this sweep, note removed), **port-now (stale)** (already ported elsewhere — the note/typing comment was out of date; rewritten), **package-later** (large / needs a subsystem or game-option plumbing), **package-later (excluded)** (`registerTodo` stubs owned by other agents — not touched), **dead** (unreachable, no effect, or UI/visual only; note left as is).

## Counts

| verdict | notes |
|---|---|
| port-now (real behaviour change) | 46 |
| port-now (stale note) | 33 |
| package-later | 13 |
| package-later (excluded registerTodo) | 4 |
| dead | 40 |
| **total** | 136 |

## Inventory

| # | file:line | note | C# cited | reachable in a normal game (evidence) | C# size | verdict |
|---|---|---|---|---|---|---|
| 1 | `empire.ts:9` | header: unported callees are stub methods | — | n/a (comment) | — | port-now (stale) |
| 2 | `empire.ts:103` | EmpireCounters header | EmpireCounters.cs | n/a — class is ported below | — | port-now (stale) |
| 3 | `empire.ts:115` | diplomacy counters (WarsWeStarted, BrokenTreaty, SubjugationsMade, AtWar time) | EmpireCounters.cs 148-218 ProcessRelationChange; callers Empire.8.cs 2631, Empire.cs 4948, Empire.3.cs 3480 | yes (every relation change); readers: race victory conditions Galaxy.cs 3939-4369, achievements | ~70 + 4 call sites in diplomacy files | package-later |
| 4 | `empire.ts:420` | _LongProcessingInterval value | Empire.cs 184 | n/a — value 120 s already ported | — | port-now (stale) |
| 5 | `empire.ts:425` | colony consumption statics | Galaxy.3.cs 5004-5039 | n/a — values already ported | — | port-now (stale) |
| 6 | `empire.ts:597` | independent-empire ctor body | Empire.cs 4146 | n/a — initializeIndependentCtor is the full port | — | port-now (stale) |
| 7 | `empire.ts:629` | FastFindNearestUnexploredSystem / Age>0 contact loop | Empire.cs 4236-4318 | n/a — ported in initializeIndependentCtor | — | port-now (stale) |
| 8 | `empire.ts:754` | ColonyNames/ColonyNameIndex capital rename | Empire.cs 3766-3771 | n/a — Galaxy.colonyNames is ported, branch live | — | port-now (stale) |
| 9 | `empire.ts:763` | Policy.ResearchDesign* from race | Empire.cs 3775-3779 | no effect: the writes go to the default Policy, which `Policy = policy` replaces (policy is never null in TS callers) | 5 lines | dead |
| 10 | `empire.ts:837` | GenerateEmpireFlag / FlagShapes | Galaxy.GenerateEmpireFlag | UI only (flag bitmaps; clock-seeded Random) | — | dead |
| 11 | `empire.ts:881` | Galaxy.CurrentDateTime for the 5 Last*Touch dates | Empire.cs 3921-3925 | n/a — field defaults + tick/empireTick.ts initEmpireTouchTimes | — | port-now (stale) |
| 12 | `empire.ts:887` | capital cargo re-title: only IndependentEmpire-owned cargo, component vs resource | Empire.cs 3927-3951 | ctor runs at game start only (0 non-independent cargo hits); still a divergence | 8 lines | port-now |
| 13 | `empire.ts:1033` | TakeOwnershipOfColony fallback details | Empire.1.cs 64-370 | no — takeOwnershipOfColonyFullHook (combat/ownership.ts) is always installed; fallback hits 0 | — | dead |
| 14 | `empire.ts:1063` | SelectBestCandidateForCapital (fallback path) | Empire.cs | no (fallback path, 0 hits) | — | dead |
| 15 | `empire.ts:1081` | order removal (fallback path) | Empire.1.cs 250-266 | no (fallback path) | — | dead |
| 16 | `empire.ts:1089` | mining stations/bases/troops (fallback path) | Empire.1.cs 272+ | no (fallback path) | — | dead |
| 17 | `empire.ts:1154` | PlanetDestroyer spec file path | DesignSpecification.cs / Galaxy paths | platform path only; the spec is loaded from data | — | dead |
| 18 | `empire.ts:1190` | ChangeGovernment | Empire.10.cs 4377 | n/a — full body in treasury.ts changeGovernment | — | port-now (stale) |
| 19 | `empire.ts:1279` | ReviewResearchAbilities callee bodies | Empire.3.cs 2059-2454 | n/a — bodies ported (M4j/M4k) | — | port-now (stale) |
| 20 | `empire.ts:1304` | ReviewColonizationTypes | Empire.3.cs 2184 | n/a — ported directly below | — | port-now (stale) |
| 21 | `empire.ts:1359` | DetermineColonizeLowQualityHabitat Ruin bonus branch | Empire.4.cs 4254-4270 | yes (colonization AI, civilianAI.ts 772/787, galaxy.ts 853/881); 0 hits in 30 min (no q<0.5 ruin target chosen) | 3 lines | port-now |
| 22 | `empire.ts:1741` | SendMessageToEmpire ShipBasePurchased | Empire.7.cs 1427-1430 | yes — 987 hits at createGame, 1555 in 30 min | 1 line | port-now |
| 23 | `empire.ts:1765` | KnownPirateBases filling | BuiltObject.1.cs 1889, Empire.1.cs 1072, Galaxy.4.cs 3798 | n/a — filled by pirateAI.ts / exploration.ts / boarding.ts | — | port-now (stale) |
| 24 | `empire.ts:1931` | FleetAttack*Portion from GameOptions | Start.2.cs 2140-2141 | n/a — applyStartAutomationSettings copies them | — | port-now (stale) |
| 25 | `empire.ts:1944` | AttackOvermatchFactor game option | Start.2.cs 2135 | n/a — applyStartAutomationSettings copies it | — | port-now (stale) |
| 26 | `empire.ts:1951` | TargettingFactor / CountermeasuresFactor | BaconGalaxy.cs 137-138 SetEmpireDifficultyFactors | yes — 1/sqrt(d) != 1 on 589 difficulty reviews (pirate factions); the fields read by weapons.ts/fighters.ts stayed 1.0 | 2 lines | port-now |
| 27 | `story/eventActions.ts:22` | header: UI-only statements are M9 | — | UI only | — | dead |
| 28 | `story/eventActions.ts:691` | LocationPinged (RevealObject) | Galaxy.9.cs GameEventAction RevealObject | UI event | — | dead |
| 29 | `story/eventActions.ts:711` | LocationPinged (RevealObject habitat) | idem | UI event | — | dead |
| 30 | `story/eventActions.ts:877` | design.PictureRef ShipImageHelper | ShipImageHelper.ResolveMinorShipImageIndex | visual; own clock Random | — | dead |
| 31 | `story/eventActions.ts:995` | design{2,3,4}.PictureRef | ShipImageHelper.ResolveNewShipImageIndex | visual; own clock Random | — | dead |
| 32 | `story/eventActions.ts:1598` | OnCharacterImageChanged | Galaxy.9.cs | UI event | — | dead |
| 33 | `story/eventActions.ts:1609` | OnCharacterImageChanged | Galaxy.9.cs | UI event | — | dead |
| 34 | `story/eventActions.ts:1674` | BaconMain.ProcessGameStats | BaconGalaxy.cs 315 | stats files (IO) | — | dead |
| 35 | `story/eventActions.ts:1676` | statSaveIntervalInGameDays | BaconMain.cs 678-685 | the SaveStats action is never queued in TS (baconSettings.ts: BaconInitialize tail unported); IO only | — | dead |
| 36 | `story/eventActions.ts:1680` | ProcessEmpireScienceShips (lab research on exploration ships) | BaconEmpire.cs 170-240 ProcessScienceShips + BaconMain.cs 703-716 scheduling | yes in C# (BaconSettings researchPerLab=1000); TS never queues the action (0 hits) | ~150 (+ GetRandomResearchNode, StoreScientificData, scheduling) | package-later |
| 37 | `story/eventActions.ts:1681` | (throw for the same action) | idem | idem | idem | package-later |
| 38 | `story/eventActions.ts:1683` | ResolveScientificMissionExploreRuins | BaconHabitat.cs 810-875 | player UI mission (BaconMain menu) only | ~70 | package-later |
| 39 | `story/eventActions.ts:1685` | ResolveScientificMissionProspectForResources | BaconHabitat.cs 745-805 | player UI mission only | ~60 | package-later |
| 40 | `story/eventActions.ts:1687` | MakeLoanPayment | BaconEmpire loans | player UI (loans) only | ~80 | package-later |
| 41 | `galaxy.ts:8` | header: remaining TODO markers | — | comment | — | port-now (stale) |
| 42 | `galaxy.ts:731` | FindNearestColony StrategicValue threshold | Galaxy.3.cs 1739 | every ported caller passes threshold 0 (StrategicValue >= 0 always); the only non-zero caller (Empire.5.cs 3735) is replaced by BaconEmpire | — | dead |
| 43 | `galaxy.ts:932` | LoadShipNames | Start.2.cs 510 | stock shipNames.txt has no names: GetCustomName is always "" | — | dead |
| 44 | `galaxy.ts:1561` | FindNearestSystemGasCloudAsteroid | Galaxy.6.cs 3714 + 2814 FindNearestSystemGasCloudAsteroidInIndex | yes — every galaxy (SetupSun star spacing Galaxy.5.cs 1264, gas clouds, pirate ambush). TS scanned only GasCloud/Asteroid categories; C# takes any Parent==null habitat (stars, clouds) | ~20 | port-now |
| 45 | `galaxy.ts:2370` | GenerateGasCloud nebula-anchored placement | Galaxy.4.cs 2794-2852 | yes — every gas cloud of every galaxy | ~12 | port-now |
| 46 | `galaxy.ts:3479` | habitat.DoTasks(CurrentDateTime) at generation | Galaxy.8.cs 473 (and 215-680) | yes (every generated planet in C#) | Habitat.DoTasks (Habitat.cs 1399, ~150 + callees) on a half-built galaxy — needs an audit of spawnCreatures/Bacon clock draws | package-later |
| 47 | `galaxy.ts:3490` | Cargo / Troops / TroopsToRecruit / InvadingTroops lists | Galaxy.8.cs 479-482 | yes (GenerateContinentalPlanet: home systems, startHabitats.ts) | 4 lines | port-now |
| 48 | `galaxy.ts:3666` | rest of GenerateEmpire | Galaxy.7.cs | n/a — empireGeneration.ts | — | port-now (stale) |
| 49 | `galaxy.ts:4020` | habitat.DoTasks at generation (planets) | Galaxy.8.cs | as galaxy.ts:3479 | as 3479 | package-later |
| 50 | `galaxy.ts:4128` | habitat.DoTasks at generation (moons) | Galaxy.8.cs | as galaxy.ts:3479 | as 3479 | package-later |
| 51 | `galaxy.ts:4553` | Shadows story branches throw | — | n/a — no throwing branch remains | — | port-now (stale) |
| 52 | `galaxy.ts:4630` | colony placement / GenerateEmpire wiring | — | n/a — game.ts / empireGeneration.ts | — | port-now (stale) |
| 53 | `galaxy.ts:4741` | DetermineSystemInfo fields | Galaxy.1.cs 873 | n/a — determineSystemInfo is the full port | — | port-now (stale) |
| 54 | `forceStructure.ts:92` | BuiltObjectView instead of BuiltObject | — | typing only | — | port-now (stale) |
| 55 | `forceStructure.ts:118` | _ShipMaintenanceSavings | Empire.cs 2991 | n/a — reads empire.shipMaintenanceSavings (treasury.ts) | — | port-now (stale) |
| 56 | `forceStructure.ts:169` | ResourceCurrentPrices (constructor values) | Galaxy.ResourceCurrentPrices (ReviewResourcePrices) | yes — 18208 calls at createGame, 730941 in 30 min (IdentifyResourceCentres); prices are reviewed 20x before | 1 line | port-now |
| 57 | `forceStructure.ts:245` | TroopCanRecruit* flags from research abilities | Empire.3.cs 2299 ReviewTroopTypes / Empire.9.cs 4944 | yes (CalculateStateExpenditureBalance); flags equal empire fields in all 30-min calls | 5 lines | port-now |
| 58 | `forceStructure.ts:316` | Habitat._MigrationFactor | HabitatList.cs 553 | yes — 163 colony reads with MigrationFactor != 0 | 1 line | port-now |
| 59 | `forceStructure.ts:318` | Habitat.HasBeenDestroyed | HabitatList.cs 559 | yes (a destroyed colony can linger in lists); 0 hits | 1 line | port-now |
| 60 | `forceStructure.ts:460` | RaidCountdown / RaidEconomyDamageFactor | Habitat.cs 878-882, 891-904 | yes — 1284 revenue calcs on raided colonies | 5 lines | port-now |
| 61 | `forceStructure.ts:508` | Habitat.Rebelling | Empire.cs 1683 | yes — 79 hits | 1 line | port-now |
| 62 | `forceStructure.ts:623` | ThisYearsForeignTradeBonuses / SpacePortIncome in subjugation income | Empire.1.cs 1013 | yes when a subjugation exists; 0 hits in 30 min | 1 line | port-now |
| 63 | `forceStructure.ts:634` | idem in AnnualSubjugationTribute | Empire.cs 1756 | idem | 1 line | port-now |
| 64 | `forceStructure.ts:692` | _ThisYearsStateFuelCosts | Empire.9.cs 5345 | yes (field is written by refuel.ts); 0 non-zero hits | 1 line | port-now |
| 65 | `forceStructure.ts:779` | Galaxy.BaseTechCost (pirate support cost) | Galaxy.cs 908 / Start.2.cs 111 | value equals the fixed research-cost option until createGame exposes it (383 calls) | option plumbing | package-later |
| 66 | `forceStructure.ts:853` | Galaxy.Orders.GetOrders(this).Count | Empire.9.cs 4767 / OrderList.cs 217 | yes — empire has orders on 20 projections at createGame, 170 in 30 min | 1 line | port-now |
| 67 | `independentTraders.ts:59` | Galaxy.CurrentStarDate stand-in (start date) | Galaxy.cs CurrentStarDate | yes — trader DateBuilt and the 20-year retirement cutoff use it every long galaxy tick | 1 line | port-now |
| 68 | `independentTraders.ts:73` | RepaitPriorityTemplateName in Design.Clone | Design.cs 2006 | set only by the ExpansionMod player UI; always null | — | dead |
| 69 | `independentTraders.ts:257` | _EmpiresSharedVisibility LongRangeScanners loop | Empire.9.cs 3159-3180 | yes with shared-visibility treaties; 0 hits in 30 min | ~15 | port-now |
| 70 | `independentTraders.ts:267` | Fighter branch | Empire.9.cs 3093-3107 | no — every TS caller passes a Habitat or BuiltObject | — | dead |
| 71 | `independentTraders.ts:270` | _EmpiresViewable / _EmpiresSharedVisibility contains | Empire.9.cs 3071 | yes with treaties / espionage; 0 hits | 2 lines | port-now |
| 72 | `independentTraders.ts:295` | shared-visibility FindShipOutsideSystemWithScanRange loop | Empire.9.cs 3213-3224 | idem | ~8 | port-now |
| 73 | `independentTraders.ts:468` | Mission.Type (mission system) | Galaxy.7.cs 4555 | n/a — mission is ported; stale cast | — | port-now (stale) |
| 74 | `independentTraders.ts:481` | Refuel mission for RefuelForNextMission traders | Galaxy.7.cs 4570-4588 | yes — 1135 hits in 30 min | ~12 | port-now |
| 75 | `independentTraders.ts:489` | CompleteTeardown of retired traders | Galaxy.7.cs 4591-4594 | yes after 20 game years / RetireForNextMission; 0 hits in 30 min | 1 line | port-now |
| 76 | `independentTraders.ts:513` | ObtainDiplomaticRelation MiningRightsToOther | Galaxy.cs 3681-3685 | yes (IdentifyDisputedBases for bases without a parent habitat); 0 hits | 2 lines | port-now |
| 77 | `independentTraders.ts:575` | DiplomaticRelations[empire] TradeSanctions/War | Galaxy.3.cs 1832-1838 | yes — 2144 hits where the relation was war/sanctions | 3 lines | port-now |
| 78 | `independentTraders.ts:585` | Habitat.IsBlockaded | Galaxy.3.cs 1851-1857 | yes — 39 hits | 1 line | port-now |
| 79 | `game.ts:15` | header: not-ported list | — | comment (outdated) | — | port-now (stale) |
| 80 | `game.ts:477` | AssignSystemName(h3, 1) fallback | Start.cs 3951-3955 | only when 200 placement tries fail; 0 hits | 2 lines | port-now |
| 81 | `game.ts:608` | Habitat.ClearColony details | Galaxy.6.cs 871 → Habitat.ClearColony | yes — age-0 start (1 hit seed 2 age 0) | 1 line (clearColony is ported) | port-now |
| 82 | `game.ts:792` | Empire.DiscoveryActionRuin | Start.2.cs 2144 | yes (player ruin discovery, Habitat.cs 2545; 1 hit age 0) | field + 1 line | port-now |
| 83 | `game.ts:849` | TroopGeneral appearance message | Galaxy.2.cs 5231-5233 | yes — 3 hits | 3 lines | port-now |
| 84 | `game.ts:968` | empire flag | Galaxy.GenerateEmpireFlag | UI only (clock Random) | — | dead |
| 85 | `game.ts:1134` | maximumEmpireAmount default not C# | Start.2.cs 115 MaximumEmpireAmount = wizard option | game-option plumbing (wizard) | option plumbing | package-later |
| 86 | `game.ts:1218` | player AttackRange* from GameOptions | Start.2.cs 1352-1363 | yes (always); values equal the field defaults | 9 lines | port-now |
| 87 | `game.ts:1247` | Galaxy.DoTasks at 1484 (per-call work) | Start.2.cs 1484 | yes (always): ProcessPirateFleets runs; the timed blocks do not | 1 line | port-now |
| 88 | `game.ts:1270` | rest of CreateGameFromSettings | Start.2.cs 2019-2146 | UI/Game-object state only (Display* flags, view) | — | dead |
| 89 | `story/storyStart.ts:10` | design.PictureRef ShipImageHelper | ShipImageHelper.Resolve*ShipImageIndex | visual; own clock Random | — | dead |
| 90 | `story/storyStart.ts:125` | design.PictureRef ShipImageHelper | ShipImageHelper.Resolve*ShipImageIndex | visual; own clock Random | — | dead |
| 91 | `story/storyStart.ts:286` | design.PictureRef ShipImageHelper | ShipImageHelper.Resolve*ShipImageIndex | visual; own clock Random | — | dead |
| 92 | `story/storyStart.ts:870` | design.PictureRef ShipImageHelper | ShipImageHelper.Resolve*ShipImageIndex | visual; own clock Random | — | dead |
| 93 | `story/storyStart.ts:377` | family picture (Rnd draw kept) | ShipImageHelper.ResolveMajorShipImageIndex | visual; the Galaxy.Rnd draw is already made | — | dead |
| 94 | `story/storyStart.ts:399` | family picture (Rnd draw kept) | ShipImageHelper.ResolveMajorShipImageIndex | visual; the Galaxy.Rnd draw is already made | — | dead |
| 95 | `story/storyStart.ts:469` | family picture (Rnd draw kept) | ShipImageHelper.ResolveMajorShipImageIndex | visual; the Galaxy.Rnd draw is already made | — | dead |
| 96 | `story/storyStart.ts:750` | family picture (Rnd draw kept) | ShipImageHelper.ResolveMajorShipImageIndex | visual; the Galaxy.Rnd draw is already made | — | dead |
| 97 | `story/storyStart.ts:643` | DesignPirateBase(design, 0) EvaluateDesiredComponent path | Galaxy.8.cs 2626 | no story caller uses techLevel 0 | — | dead |
| 98 | `diplomacyTick.ts:185` | Aggression/Caution/Friendliness periodic levels | Race.cs 350-400 | yes when a race change period is active (Securan 3y, Dhayut 5y, Gizurean 7y); 0 hits in 30 min | ~6 | port-now |
| 99 | `diplomacyTick.ts:344` | ShipGroup.Posture / TotalTroopAttackStrength | ShipGroup.cs 2967 | n/a — ShipGroup has both now; the view read defaults | 2 lines | port-now |
| 100 | `diplomacyTick.ts:392` | DeclinedTaskList | Empire.8.cs 4403-4480 | registerTodo stub (other agent) | — | package-later (excluded) |
| 101 | `diplomacyTick.ts:1204` | CheckEmpireBuildingVictoryWonder | Empire.8.cs 16-33 | yes — GameRaceSpecificVictoryConditionsEnabled defaults true; 639 calls | ~12 | port-now |
| 102 | `diplomacyTick.ts:1741` | BuiltObjectMission.Priority | Empire.9.cs 4594 | yes — 58 scouts with a non-Undefined priority | 1 line | port-now |
| 103 | `diplomacyTick.ts:2688` | _SpecialBonusDiplomacy | Empire.cs 983 | yes (field written by treasury.ts ReviewSpecialBonusesRuinsWonders); 0 non-zero | 1 line | port-now |
| 104 | `diplomacyTick.ts:2773` | LeaveSystem Move missions | Empire.3.cs 3945 | registerTodo stub (other agent) | — | package-later (excluded) |
| 105 | `diplomacyTick.ts:2804` | RemoveMilitaryForcesFromSystem Refuel missions | Empire.3.cs 4032 | registerTodo stub (other agent) | — | package-later (excluded) |
| 106 | `diplomacyTick.ts:3052` | RemoveColoniesFromSystem orders | Empire.3.cs 4586-4633 | registerTodo stub (other agent) | — | package-later (excluded) |
| 107 | `builtObject.ts:10` | header: subsystems not ported | — | comment (outdated) | — | port-now (stale) |
| 108 | `builtObject.ts:93` | Empire.AttackRangeOther field | Empire.cs 367 | n/a — field exists; stale cast | — | port-now (stale) |
| 109 | `builtObject.ts:290` | ShipGroup typing | — | typing only | — | port-now (stale) |
| 110 | `builtObject.ts:292` | ContractList typing | — | typing only | — | port-now (stale) |
| 111 | `builtObject.ts:296` | BuiltObjectMission typing | — | typing only | — | port-now (stale) |
| 112 | `builtObject.ts:339` | CharacterList typing | — | typing only | — | port-now (stale) |
| 113 | `builtObject.ts:414` | StrengthInNumbersMaintenanceLowerForSmallShips | BuiltObject.cs 799-802 | yes while a race period is active (Gizurean/Dhayut events); 0 hits in 30 min | 3 lines | port-now |
| 114 | `builtObject.ts:427` | Galaxy.BaseTechCost (pirate maintenance) | Galaxy.cs 908 | as forceStructure.ts:779 (66585 calls, value fixed) | option plumbing | package-later |
| 115 | `builtObject.ts:1105` | Troop model typing | — | typing only | — | port-now (stale) |
| 116 | `resourceTargets.ts:39` | AssignedShip typing | — | typing only | — | port-now (stale) |
| 117 | `resourceTargets.ts:156` | KnownPirateBases filled by scans | BuiltObject.1.cs 1902 | n/a — filled now | — | port-now (stale) |
| 118 | `resourceTargets.ts:185` | ObtainDiplomaticRelation MiningRightsToOther | Galaxy.cs 3659-3663 | yes — 41332 hits | 2 lines | port-now |
| 119 | `resourceTargets.ts:193` | DetermineDefendingFirepower > 300 for the player | BaconGalaxy.cs 162 / Galaxy.6.cs 4696 | yes — 3256 player hits | 1 line | port-now |
| 120 | `resourceTargets.ts:279` | SystemVisibility.Threats | Empire.9.cs 4035-4075 | yes — 27581 calls with threats present | ~25 | port-now |
| 121 | `resourceTargets.ts:291` | SpacePorts positions typing | — | typing only | — | port-now (stale) |
| 122 | `resourceTargets.ts:298` | Habitat.HasBeenDestroyed | Empire.4.cs 1975 | yes (destroyed colony still listed); 0 hits | 1 line | port-now |
| 123 | `gameStartTail.ts:32` | header: capital Habitat.DoTasks | Start.2.cs 2035-2038 | see :1524 | — | port-now |
| 124 | `gameStartTail.ts:44` | ShipImageHelper picture picks | ShipImageHelper | visual; own clock Random | — | dead |
| 125 | `gameStartTail.ts:182` | RepaitPriorityTemplateName | Design.cs 2006 | always null | — | dead |
| 126 | `gameStartTail.ts:908` | design.PictureRef ShipImageHelper | ShipImageHelper.ResolveMinorShipImageIndex | visual; own clock Random | — | dead |
| 127 | `gameStartTail.ts:1364` | design.PictureRef ShipImageHelper | ShipImageHelper.ResolveMinorShipImageIndex | visual; own clock Random | — | dead |
| 128 | `gameStartTail.ts:1480` | design.PictureRef ShipImageHelper | ShipImageHelper.ResolveMinorShipImageIndex | visual; own clock Random | — | dead |
| 129 | `gameStartTail.ts:1524` | PlayerEmpire.Capital.DoTasks(CurrentDateTime) | Start.2.cs 2035-2038 | yes (every new game); Habitat.DoTasks is ported (tick/habitatTick.ts) | 1 line | port-now |
| 130 | `exploration.ts:98` | ColonizationRange / EnforceLimit game options | Galaxy.cs 729/732 | wizard option (startGameOptions.colonizationRangeKly) not plumbed into createGame | option plumbing | package-later |
| 131 | `exploration.ts:536` | Empire._CivilityRating | Galaxy.9.cs | yes (rebel-colony evaluation); 0 hits in 30 min | 1 line | port-now |
| 132 | `exploration.ts:745` | design.PictureRef ShipImageHelper | ShipImageHelper | visual; own clock Random | — | dead |
| 133 | `exploration.ts:911` | design.PictureRef ShipImageHelper | ShipImageHelper | visual; own clock Random | — | dead |
| 134 | `exploration.ts:1142` | design.PictureRef ShipImageHelper | ShipImageHelper | visual; own clock Random | — | dead |
| 135 | `exploration.ts:1257` | design.PictureRef ShipImageHelper | ShipImageHelper | visual; own clock Random | — | dead |
| 136 | `exploration.ts:1335` | Empire.DiscoveryActionRuin | Habitat.cs 2545 | yes (player ruin discovery; 1 hit age 0) | 1 line | port-now |


## What was ported (the "port-now" rows)

All port-now rows above were ported statement for statement with the C# cite at the statement, and the note removed
(stale notes were rewritten to describe what is there). Tests: `test/todoSweep.test.ts` (harness game, seed 1) asserts the
visible effect of each group. Two additions outside the 12 files were needed: `pirates.ts` setEmpireDifficultyFactors writes
Empire.TargettingFactor / CountermeasuresFactor (BaconGalaxy.cs 137-138), `taxes.ts` raidEconomyDamageFactor reads
Habitat.RaidCountdown (Habitat.cs 891), `colonyTick.ts` gains raceCautionLevel / raceFriendlinessLevel / racePeriodicRaceEvent
(Race.cs 366-400, 1360), `messages.ts` registers the ShipBasePurchased sender (keeps empire.ts free of an import cycle).

Items whose note said "empty / unreachable at game start" but that the probes hit in play (they were reachable):
forceStructure MigrationFactor (163 hits), RaidCountdown (1284), Rebelling (79), Orders.GetOrders (170, and 20 during
createGame), ResourceCurrentPrices (730941 calls against base prices); independentTraders RefuelForNextMission (1135),
war/sanctions docking (2144), habitat blockade (39); resourceTargets threats (27581), mining rights (41332), player
defending firepower (3256); diplomacyTick scout Mission.Priority (58); empire.ts ShipBasePurchased (987 at createGame);
TargettingFactor (589 difficulty reviews with a factor != 1); FindNearestSystemGasCloudAsteroid and GenerateGasCloud
(every galaxy). All of them move the seed pins.

## Effect on a normal game (sim-run, seed 1, 700 stars, 10 empires, 30 game minutes)

Before: start digest 3307e9fa3fd39a52, 26194 habitats, 17 colonies at the end. After: stars keep the C# 4 x MaxSolarSystemSize
spacing and gas clouds sit in nebulae (the generated galaxy differs: 31833 habitats instead of 26194), 13 colonies at the end, 0 exceptions, the same 2 registerTodo stubs reached.

## package-later list (C# size)

| item | C# | size |
|---|---|---|
| Habitat.DoTasks at planet/moon generation (galaxy.ts 3479/4020/4128) | Galaxy.8.cs 215-680 → Habitat.cs 1399 | ~150 lines + callees; Rnd audit on a half-built galaxy |
| Diplomacy counters (EmpireCounters ProcessRelationChange etc.) | EmpireCounters.cs 148-218 + 4 call sites | ~70 |
| BaconEmpire.ProcessScienceShips + scheduling | BaconEmpire.cs 170-240, BaconMain.cs 703-716 | ~150 |
| Bacon scientific missions (explore ruins / prospect) | BaconHabitat.cs 745-875 | ~130 (player UI) |
| Bacon loans (MakeLoanPayment) | BaconEmpire | ~80 (player UI) |
| Galaxy.BaseTechCost option (forceStructure 779, builtObject 427) | Start.2.cs 111 | option plumbing |
| MaximumEmpireAmount option (game.ts 1134) | Start.2.cs 115 | option plumbing |
| ColonizationRange / EnforceLimit options (exploration.ts 98) | Galaxy.cs 729/732 | option plumbing |
| 4 registerTodo stubs in diplomacyTick.ts (excluded, other agents) | Empire.8.cs 4403-4480, Empire.3.cs 3945/4032/4586 | — |
