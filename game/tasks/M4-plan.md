# M4 plan — the running simulation (post game-start tick)

Scope: everything that runs after `createGame` returns: the UI-side frame loop that decides *which*
objects get `DoTasks` each frame, plus `Galaxy.DoTasks[TimeSensitive]`, `Empire.DoTasks[Pirates]`,
`ShipGroup.DoTasks`, `BuiltObject.DoTasks` (+ `Fighter.DoTasks`), `Habitat.DoTasks`, `Creature.DoTasks`,
`Character.DoTasks`, and every method they call.

C# root: `$SRC = $DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/` —
`DistantWorlds.Types/` (model), `BaconDistantWorlds/` (the Expanded mod, part of the port), `DistantWorlds/`
(app: `Main.Part*.cs`, `Start*.cs`). All `file:line` refs below are relative to those folders.
Names of TS files refer to `game/src/sim/` unless noted.

---------------------------------------------------------------------------------------------------

## 0. Key findings (read first)

1. **The C# runtime is not deterministic, by construction.** Past `Start.2.cs:1109` there is no C# Rnd
   stream to match:
   - `Empire.DoTasks` and `Galaxy.DoTasks` run on **worker threads** (`Main.Part12.cs:3807` `method_91`
     starts `ProcessorCount-1` threads; `method_94` 3857 enqueues; `method_96` 3919-3990 executes),
     concurrently with the main thread's Habitat/BuiltObject/Creature ticks, all sharing the static
     `Galaxy.Rnd` (`Galaxy.cs:77/826`).
   - `ReviewEmpireTerritoryCore` runs on the ThreadPool (`Galaxy.cs:3376-3382`); destroyed planets are
     removed on a fresh `Thread` (`Habitat.cs:1549`).
   - The Galaxy huge block (every 240 s) ends with `ReseedRandom()` = `new Random((int)DateTime.Now.Ticks)`
     (`Galaxy.cs:3088` → 3033). This already fires inside the game-start tick (`Start.2.cs:1109`).
   - The Bacon mod uses clock-seeded `new Random()` in ~20 places (`BaconHabitat.cs` ×8, e.g. 447
     market-price update chance; `BaconBuiltObject.cs` ×6; `BaconFighter.cs` ×3; `BaconEmpire.cs` ×2,
     e.g. 1122 pirate construction ships; `BaconGalaxy`, `BaconCharacter`), plus `ShipImageHelper`,
     `ColonyInvasion.cs`, `Empire.cs`/`Empire.2.cs` one each.
   - Simulation results depend on the **camera**: objects in view tick every frame with `inView: true`
     (finer dt, and `InView` changes gameplay branches: `BuiltObject.1.cs:2916, 3295, 4132`,
     `BuiltObject.cs:4202, 4285`, `BuiltObject.2.cs:942, 2259, 4574`).

   **Determinism contract for the TS port (proposal):** same *draw sites, order within one object's
   tick, and distributions* as the C#, on one seeded `galaxy.rnd` (no reseeding — keep the policy
   already used in `independentTraders.ts:823` and `pirates.ts:1017`; replace every clock-seeded
   `new Random()` by a draw-free derivation from the galaxy seed, like `designNames.ts:184`), executed by a
   **single-threaded, fixed-order scheduler**. A run is reproducible from `(seed, createGame options,
   speed schedule, view schedule)`. Headless tests use "no view".

2. **Reachable code is ~125k C# lines** (d≤3 call closure of all DoTasks roots, see §2 methodology):
   ~84k attributable to one subsystem + ~42k shared helpers (reached from ≥5 roots). By name match
   ~31k of that is already in `src/sim` — an upper bound (name collisions such as `CompleteTeardown`,
   `DoLocationEffects`, `ApplyLocationEffects`, `DoTasks` match the Creature ports only). Realistic:
   ~20-25 % ported, most of it game-start slices (designs, characters, force structure, stations,
   territory, taxes, visibility, troops).

3. **What M4 can defer** (stub with `TODO(port)` that throws only when enabled): story events
   (`ShakturiSendConvoy`, `CheckOfferStoryHint`, `CheckSendShipConvoysViaGateway`), scripted game events
   (`ProcessDelayedEventActions` → `ExecuteEventAction` `Galaxy.9.cs:1503-2860`, empty `DelayedActions` in a
   normal game), espionage (`AssignSpecialMissions`/`PerformIntelligenceMissions`, ~2k), achievements/
   victory/Steam (`ReviewAchievements`, `CheckVictoryConditions`, `UpdateAchievements`), super-pirate runtime
   and planet destroyers. That keeps M4 at roughly 21 packages of 1.5k–4k C# lines each.

4. **Structural hazards for the port**
   - `ExecuteCommands` is one 4,181-line switch (`BuiltObject.2.cs:399-4579`) touching movement, docking,
     cargo, construction, colonisation, combat and mission reassignment. It must be split by
     `CommandAction` case across packages behind one dispatcher (§3).
   - The four DoTasks bodies are tiny, but every block calls into 5-10 subsystems; parallel agents
     would collide in `empire.ts`/`galaxy.ts`/`builtObject.ts`. §3 fixes this with skeleton + per-package
     modules + field sections created up front by M4a.
   - Interval semantics differ per class: Empire uses `>=` on `double` seconds with touch updates
     **before** the blocks (`Empire.1.cs:3470-3500`); BuiltObject `>=` on TimeSpans with touch updates
     **after** each block (`BuiltObject.cs:3734/3770/3798`); Habitat uses **strict `>`**
     (`Habitat.cs:1437/1442/1499/1525`). "Intermediate" means 3 s for Galaxy/BuiltObject/Habitat
     (`Galaxy.3.cs:5139`) but 60 s for Empire (`Empire.cs:182`).
   - The game-start path already fakes parts of these ticks (`empireGeneration.ts` `empireDoTasksStandIn`,
     `independentTraders.ts` `galaxyGameStartHugeTick`/`LongTick`, `builtObjectPlacement.ts:245`
     `assignMissionsToBuiltObjectList` no-op, `gameStartTail.ts:1552` capital `Habitat.DoTasks`). M4 replaces
     them with the real ticks; all seed pins in `test/game*.test.ts`, `pirates*.test.ts`, etc. will move.

---------------------------------------------------------------------------------------------------

## 1. One simulation frame, from the game loop down

### 1.1 Frame driver (UI project)

`Main.Part12.cs:4121 ProgramLoop()` — one iteration per rendered frame, no fixed timestep:

```
ProgramLoop (Main.Part12.cs:4121)
 └─ if (bool_3 /*sim threads running*/)                                     4207
     ├─ currentDateTime = Galaxy.CurrentDateTime   (stopwatch × TimeSpeed, Galaxy.cs:1114; starDate = ms, 1098)
     ├─ builtObjectsInView = method_123()          (Main.Part11.cs:507: GetBuiltObjectsAtLocation(view centre,
     │                                              view width + 2*MaxSolarSystemSize) filtered to screen ±25000 px)
     ├─ ProcessMain(time, starDate, inView)        (Main.Part11.cs:533)   ── LEVEL-OF-DETAIL PASS
     │    ├─ Habitats[int_28..int_29].DoTasks(time)   (557) = every habitat of the system nearest the camera
     │    │                                            (range set by method_149, Main.Part11.cs:1768)
     │    ├─ builtObjectsInView[j].DoTasks(time, starDate, inView:true)   (592)
     │    └─ Systems[habitat_6.SystemIndex].Creatures[k].DoTasks(time)     (601)
     ├─ method_124(time)                           (Main.Part11.cs:744) UI refresh only
     └─ method_86(time, starDate, inView, multiCore)  (Main.Part12.cs:3517)  ── STAGGERED BACKGROUND PASS
          ├─ budgets (3524-3544): multiCore → habitats int_41 = min(1000, Habitats.Count),
          │    in-battle BOs int_42 = 150, BOs int_43 = min(1000, BuiltObjects.Count), creatures int_44 = 50,
          │    empires int_45 = 1, fleet-empires int_46 = 1 (single core: 200/50/100/30/1/1); pirates int_47 = 1
          │    (Main.Part13.cs:277)
          ├─ Galaxy.DoTasksTimeSensitive(starDate, time)                       3545  (every frame)
          ├─ every 100th frame: enqueue Galaxy → worker runs Galaxy.DoTasks(...) 3546 → 3980
          ├─ Empire.WarnOfIncomingEnemyFleetsAndPlanetDestroyers(player / mechanoid)  3559-3571 (UI warnings)
          ├─ "GxHab": next int_41 habitats round-robin (cursor int_48) → Habitat.DoTasks(time)   3571-3597
          ├─ "GxFlt": every 5th frame, one empire (cursor int_55): ShipGroups[m].DoTasks(time)    3598-3622
          ├─ "GxBO": (a) in-battle scan loop 3627-3664 (while at 3637) — decompiled loop never assigns builtObject inside
          │          the while, so it spins to num2 == num3 and breaks: **effectively a no-op** (port as such);
          │          (b) next int_43 BOs round-robin (cursor int_50), skipping those in view →
          │          BuiltObject.DoTasks(time, starDate, inView:false)   3665-3693
          ├─ "GxCr": next int_44 creatures round-robin (int_51) → Creature.DoTasks(time)   3695-3706
          ├─ "GxEm": every 10th frame enqueue Empires[int_52] → worker: if (Active) Empire.DoTasks()  3708-3722 → 3970
          └─ "GxEmP": every 10th frame enqueue PirateEmpires[int_57] → Empire.DoTasks() (→ DoTasksPirates)  3724-3742
```

Other UI-triggered ticks (skip in the port, note only): system-map refresh calls `Habitat.DoTasks` for the
selected system (`Main.Part11.cs:1952, 2006, 2177`); `Start.2.cs:36-53 method_76` ticks one empire's
colonies/ships (scenario/editor path).

Throughput implied by the budgets (60 fps): with N BuiltObjects each is ticked every ⌈N/1000⌉ frames
(dt grows with N — the ExecuteCommands loop integrates bigger dt, capped at 50 iterations by
`Galaxy.ConditionCheckLimit`, `Galaxy.7.cs:569`); each empire every 10·E frames (E empires); pirates every
10·P frames; Galaxy every 100 frames; one empire's fleets every 5 frames (+ each empire's own short block
ticks its fleets again, `Empire.1.cs:3508-3512`, and `Galaxy.ProcessPirateFleets` ticks pirate fleets).

### 1.2 Galaxy

`Galaxy.cs:3046 DoTasksTimeSensitive(starDate, time)` — every frame:
- `ReviewPirateMissionsAndAssign(starDate, dt)` `Galaxy.9.cs:527-575` — pirate contract bidding countdown / expiry.
- `ProcessDelayedEventActions(starDate)` `Galaxy.9.cs:1474-1501` — scripted game events (defer).

`Galaxy.cs:3054-3132 DoTasks(...)` — spans `Galaxy.3.cs:5139-5142`: Intermediate 3 s, Periodic 10 s,
Long 60 s, Huge 240 s; touch fields `_LastGalaxyProcessTime`/`_LastGalaxyHugeProcessTime`, reset by
`ResetLastTouchTimes` (3134). Order:

| step | line | touches |
|---|---|---|
| `if (ResetRandom) ReseedRandom()` | 3075 | Rnd (clock) — never true in play |
| `ProcessPirateFleets` | 3079 → 3278 | every pirate `ShipGroup.DoTasks` |
| **huge (≥240 s)** `ReviewEmpireTerritory(false)` | 3083 | territory grid (ThreadPool) |
| `SelectPopularDesignCandidates` | 3085 | independent designs |
| `DoGalaxyEvents` | 3086 → 3297 | `Rnd.Next(0,15·…)` → super pirates |
| `CleanupInvalidShipsInIndexes` | 3087 | index grids |
| `ReseedRandom` | 3088 | Rnd (clock) — **drop in TS** |
| **long (≥60 s)** `DeferEventsForGameStart=false`, `ReviewResourcePrices`, `ReviewComponentPrices`, `RemoveCompletedOrders`, `CancelExpiredOrders`, `UpdateSystemInfo`, `ReviewIndependentColonies`, `IndependentEmpire.UpdateEmpireRefuellingLocations`, `IdentifyDisputedBases`, `GenerateIndependentTraders`, `AssignIndependentTraderMissions`, `GenerateNewPirateEmpires`, `CheckForTerminatedPirateEmpires`, `GenerateNewPirateShips`, `DoSuperPirateTasks`, `ClearEmptyDebrisFields`, `ClearCompletedPlanetDestroyerProjects`, `CheckMergePirateFactions`, `ReviewPirateEmpireActivities`, `MaintainIndependentColonyFuelLevels`, `IndependentEmpire.CheckMarketOrders`, `IndependentEmpire.ReviewPirateSmugglingMissions/DefendMissions`, `IndependentColoniesMakeSmugglingOffersToPirates` (Rnd 1/colony), `…DefendOffersToPirates` (Rnd 1/colony), `ReviewRacePeriodicChanges`, `ReviewColonyFillFactor`, `ReviewEmpireTerritory(true)` (if no huge), `ReviewWondersBuilt`, `ReviewEmpireDifficultyFactors`, `ReviewAchievements`, `CheckVictoryConditions` | 3090-3130 | markets, orders, independents, pirates, territory, victory |

### 1.3 Empire

`Empire.1.cs:3427 DoTasks()` → pirates (`PirateEmpireBaseHabitat != null`) go to `DoTasksPirates` (4095).
Intervals `Empire.cs:176-186`: short 3 s, regular 10 s, periodic 30 s, intermediate 60 s, long 120 s,
huge 240 s. Touches are updated first (3452-3499), `flag = DominantRace.Expanding` (3500). At game start
the long touch is staggered by `Rnd.Next(1, LongProcessingInterval)` (`Start.2.cs:1345`) — already in
`game.ts`.

| block | line | calls (in order) |
|---|---|---|
| short 3 s | 3505 | `RespondToIncomingEnemyFleetsAndPlanetDestroyers`, all `ShipGroups[i].DoTasks`, `ProcessCharacters(dt)` (→ `Character.DoTasks`, `Empire.6.cs:3941-3951`, `Character.cs:4277`) |
| regular 10 s | 3515 | `ProcessDistressSignals`, `ClearOutOldDistressSignals`, `ClearExpiredViewableEmpires`, `ReviewDesignsAndRetrofit`, `UpdateEmpireRefuellingLocations` |
| periodic 30 s | 3523 | `CalculateRelativeEmpireSize`, `CheckReviewSpecialPirateEvents`, `CheckSendPirateRaid`, `RemoveDefeatedEmpireRelations`, `ProcessMessages`, `ConsiderTreatyProposals`, `EvaluateColonyVariables(dt)`, `RecruitAttackTroops`, `RecalculateEmpireCorruption`, `ReviewTaxes`*, `RecalculateColonyTaxRevenues`, `IdentifyMilitaryObjectives`*, `MaintainShipGroups`/`UpdateFleetLeadShips`/`ReviewFleetPostures`*, `CancelInactiveBlockades`, `ReviewPirateDefendMissions`, `ReviewPirateSmugglingMissions`, `CheckMarketOrders`, `AssignShipMissions`, `AssignSpecialMissions`*, `PerformIntelligenceMissions`, `PerformResearch(dt, true)`, `EvaluateSystemLinks` (*automation flags) |
| intermediate 60 s | 3562 | `TaskShipGroups`*, `ReviewFleetAdmiralBonuses`, `TaskResupplyShips`, `ReviewResearchStationBonuses`, `ReviewIndependentColonyTargets` (if expanding), `ProcessTradeBonuses`, `ReviewColonyPopulationPolicy`, `UpdateSystemExplorationStatus`, `CheckKnownPirateBases`, **money** (private revenue → `Counters.ProcessColonyRevenue`, `_PrivateMoney`; tax → `_StateMoney`, 3584-3610), `ProcessSubjugationTribute`, `DoCharacterEventLeader(CashNegative/Positive)`, `CheckForCharacterAppearance`, `ReviewCharacterLeaderChange`, `ProcessLeaderChangeInfluence`, `ReviewCharacterBonusesKnown`, `ReviewCharacterTraits`, `ReviewDemoralizingCharacters`, `ReviewCharacterLocations`, `CreateNewDesigns`*, `ReviewSystemThreats`, `_ColonizationTargets = IdentifyColonizationTargets`, `InvadeUnwillingColonizationTargets`, `_ResourceTargets = IdentifyResourceCentres`, `PrioritizeEmpireResourceNeeds`, `IdentifyUnavailableLuxuryResources`, player-only `UpdateSystemRefuellingStatus`/`CheckForStrandedShips`, `UpdateSystemFuelSourceStatus`, `UpdateAchievements` |
| long 120 s | 3644 | `MergeGalaxyMapsForSharedVisibilityEmpires`, `MergeKnownPirateBasesForSharedVisibilityEmpires`, `CheckTemptingTargets`, `ReviewColonyWonders`, `ReviewColonyFacilities`, `RefreshColonyFacilityInfo`, `SendAvailableFleetsToGuardStrategicLocations`, `ReviewEmpireAbilityBonuses`, `ReviewGovernmentEffects`, `CheckChangeGovernment`, `RecalculateColonyTaxRevenues`, `ClearInvalidDiplomaticRelations`, `EvaluatePoliticalSituation`, `ReviewDiplomaticStrategies`, `ReviewDiplomaticSituations`, `ReviewPirateRelations`, (met pirates) `Make{Attack,Defend,Smuggling}OffersToPirates`, `ReviewRestrictedResourceTrading`, `ReviewSpecialBonusesRuinsWonders`, `ReviewMigrationTourism`, `DoCrashResearch`, `TradeItems`, `DisbandExcessTroops`, `DetermineRandomAttacks`, `ProjectForceStructure`, `ProjectPrivateForceStructure`, `PayMaintenanceForBuiltObjects`, `PayForTroops`, `PayForPlanetaryFacilities`, `RetireOldBuiltObjects`, (InitiateConstruction) `ReviewLatestDesigns`/`DirectConstruction`/`DirectPrivateConstruction`, `ExertCulturalInfluence`, `ClearOldDistressSignals`, `ClearExpiredDeclinedTasks`, `DetermineMonitoringStationLocation`, `DetermineResearchStationLocation` |
| huge 240 s | 3708 | `CleanupInvalidShips`, `ReviewEmpireEndsAllWars`, `BuildDefensiveBases`, `CheckColoniesForPirateFacilitiesAndAttack`, `ShakturiSendConvoy`, `CheckOfferStoryHint`, `ResetRaceEvents`, `ReviewRandomEvents`, `ReviewEmpireEvents`, `CheckSendShipConvoysViaGateway`, `MaintainBaseResourceLevels`, `ReviewEnemyHelpEnlistment`, `ReviewDisputedTerritory` |

`DoTasksPirates` (4095-4273), same intervals: short 4163 (fleets, characters); regular 4172
(`ReviewDesignsAndRetrofit`, `ClearExpiredViewableEmpires`, `PirateCheckMissionsOnOffer`,
`UpdateEmpireRefuellingLocations`); periodic 4179 (`RemoveDefeatedEmpireRelations`,
`PirateRecalculateEmpireCorruption`, `ProcessMessages`, `EvaluateColonyVariablesPirate`, fleets maintenance,
`CheckMarketOrders`, `PirateAssignShipMissions`, special/intel missions, `PerformResearch`); intermediate
4200 (`PirateTaskFleets`, admiral/resupply/research-station bonuses, exploration status, `CheckKnownPirateBases`,
`PirateCollectIncomeFromControlledColonies`, character reviews, `CreateNewDesigns`,
`PirateReviewSystemThreats`, `PirateReviewColoniesToControl`, resource targets, `PirateGenerateSellInfoOffers`,
fuel status, `ReviewPirateSystemInfluence`); long 4243 (`BaconEmpire.DoTaskPiratesLongInterval`
`BaconEmpire.cs:1099`, map merges, `MaintainPirateSpaceportResourceLevels`, `PirateReviewColonyFacilities`,
`ClearInvalidDiplomaticRelations`, `PirateReviewEmpireRelations`, `PirateProjectForces`, `Pay*`,
`ReviewMigrationTourism`, `ReviewLatestDesigns`/`PirateDoConstruction`,
`PirateResetCivilianShipEmpireToIndependent`, `PiratesMakeAttackOffers`, `PirateTradeItems`,
`ClearExpiredDeclinedTasks`); huge 4267 (`PirateReviewRandomEvents`, `MaintainBaseResourceLevels`,
`CleanupInvalidShips`).

`ShipGroup.cs:97-122 DoTasks(time)`: ≥3 s `CheckForMissionCompletion` (516-1279, 764 lines),
`CheckForCompletedBattle`; ≥10 s `CheckRefuelManual`, `CheckRefuelRepairAttack`, `CheckSendForAttack`,
`ReviewCharacterLocationBonuses`, auto-controlled lead ship → `Empire.CheckAssignUnloadTroopsAtColonyNeedingThemMission`
or `LoadTroopsIfNecessaryAndPossible` (Rnd `Next(0,2)` per ship).

### 1.4 BuiltObject (ships and bases)

`BuiltObject.cs:3614-3853 DoTasks(time, starDate, inView)`. First call back-dates touches so all blocks fire
(3620-3633). `dt = now - _LastTouch` seconds.

| part | line | calls |
|---|---|---|
| every call | 3659-3733 | `DoDeployment`, `RechargeShields`, `ResolveIndex`+`UpdateIndexesForMovement` (index grid), InBattle flag, clear hyperjump flags, scan timeout, idle speed clamp / `CheckForPlanetDestroyerWeaponFiringDelayOnHyperExit`, **`ExecuteCommands` loop** (≤50 iterations, 3697-3705), `HandleWeaponsFiring`, `HandleAssaultPodMovement`, `Fighters[i].DoTasks` (→ `BaconFighter.DoTasks` `BaconFighter.cs:155`), `DoExplosions`, `DoLocationEffects`, assault counter |
| intermediate 3 s | 3734 | `BaconBuiltObject.CheckNearTarget`, `ScanArea`, `LaunchAllFighters` (in battle), `SetAttackRangeWhenNoMission`, `CheckShieldAreaRechargeReset`, `ApplyLocationEffects`, `ReviewDisabledComponents`, `ThreatEvaluation`, `ModifyAttackRangeByTargetSpeed`, `ScanForNewOwner`, `ScanForLocations`, `CheckForAttack`, `DetectHyperDeny`, `CheckForRandomAttackTargets`, `DoRepairs`, `ProcessBoardingAssault` |
| periodic 10 s | 3770 | `CheckRepairMissionStillValid`, `CheckClearDocking`, `CheckWhetherStillBeingBuilt`, (owned) `FleeFromHopelessBattle`, `ReviewFleetBonuses`, `CheckNearbyBuiltObjectsForShieldAreaRecharge`, `CheckFightersNeedUpgrading`, `BuildNewFighters`, `ManufactureRepairFighters`, `IndustrialProcessing`, `ReviewRetrofitConstructionQueue`, `CheckForRefuelling(cached)`, `CheckForRepairs`, `CheckForFuelOrdering`, `HealTroops`, `PirateBaseDiscovery`, `PerformFleetTasks` |
| long 60 s | 3798 | `BaconBuiltObject.HugeProcessingSpanActions`, `CheckForShipsNoLongerDocking`, `CheckForUnownedCargo`, `ReviewCaptainBonuses`, `CheckForRefuelling(fresh)`, `AnnualSupportCost`, `ReviewSystemVisibilityForPreWarpShip`, `UpdateRaidCountdown`, `Galaxy.CheckRemoveInvalidDockingShipsFromWaitQueue`, `CheckSelfDestruct`, `BaconBuiltObject.ResetAssaultPods` |
| every call (owned) | 3814-3834 | `DefendBase`, `DefendShipFromAttackers`, `FireAtAssaultPods`, `BaconBuiltObject.InterceptMissiles`, `FireAtNearbyFighters`, `FireTractorBeamsAtInvadingTroopTransports`, energy: static consumption, `PerformEnergyCollection`, `RechargeReactors` |

`ExecuteCommands` cases (`BuiltObject.2.cs`): Blockade 540, Repair 620, Retrofit 704, EvaluateThreats 792,
ScanArea 798, Escort 804, Colonize 936, HoldSyncFleet 1159, Hold 1207, ExtractResources 1227, Scrap 1311,
Build 1444, Attack/Bombard/Capture/Raid 1698-2730, Dock 2731, ConditionalHyperTo 2928, HyperTo 3020,
ImpulseTo 3224, Load 3232, MoveTo 3596, SprintTo 3627, Undock 3642, Unload 3698, ReassignMission 3999
(→ `Empire.AssignMissionToBuiltObject`), Refuel 4226, Deploy 4352, RepeatSubsequentCommands 4361,
SetParent 4367, Undeploy 4390, ClearParent 4406, ClearAttackers 4487.

### 1.5 Habitat

`Habitat.cs:1399-1556 DoTasks(time)` (all touches default `DateTime.MinValue` → first call runs every block):

| part | line | calls |
|---|---|---|
| every call | 1401-1436 | `DoExplosion`, `Move(galaxy)` (orbit — ported as `Habitat.advanceOrbit`, `types.ts:349`), `DoExplosions`, `HandleWeaponsFiring` |
| >3 s | 1437 | `CheckForShipsDiscoveringRuins` |
| >10 s | 1442 | `CalculateWarWithOurRace`, `ScanForNewOwner`, `GrowPopulation`, invasion space-control, `ProcessColonyTroops`, `ResolveInvasionBattles`, `ExtractResources`, `ManufacturingQueue.DoManufacturing`, `ConstructionQueue.DoConstruction`, `ConstructFacilities`, `IsShipYard`, `CheckForShipsOfNewEmpiresInSystem`, `AttackEnemyTargets`, `ProcessPlague`, `ReviewPirateControl` (→ `BaconHabitat.cs:1388`) |
| >60 s | 1499 | `ReviewWhetherRefuellingDepot`, `CheckHabitatIsEmpire` (if SpawnNewEmpires), `ReviewConstructionSpeed`, `RegenerateDamage`, `TerraformColony`, `IndependentColoniesRecruitAndTrainTroops`, `RecalculateDevelopmentLevelBaseline`, `RecalculateAnnualTaxRevenue`, `ConsumeResources`, `ConsumeAndOrderStrategicResourceSupply`, `CheckForShipsNoLongerDocking`, `CheckForSpacePortFacilities`, `CheckSatisfaction`, `UpdateConqueredFactor`, `CalculateMigrationFactor`, `UpdateRaidCountdown` |
| >240 s | 1525 | `BaconHabitat.HugeProcessingSpanActions` (434: prisoners, AI infrastructure, market cash/prices with clock Rnd, decay), `ClearTroopsAwaitingPickup`, `CheckForUnownedCargo`, `RecalculateColonyInfluenceRadius`, `Galaxy.ChanceColonyGovernorPromotion`, `SpawnCreatures`, `ReviewManufacturedResources`, `CheckRemoveInvalidDockingShipsFromWaitQueue` |
| destroyed | 1547-1552 | `DoPlanetRemove` on a new thread |

### 1.6 Creature / Fighter / Character

- `Creature.cs:531-568`: `Move`, `DoLocationEffects`; ≥3 s `CheckForAttackers`, `AttackTarget`, `Heal`,
  `ApplyLocationEffects`; ≥10 s `CheckForTargets` (visible), `CompleteTeardown`, `CheckFixNotInSystem`; ≥30 s
  `Split`, `ChooseAction`, `Reproduce`. **Ported** in `creature.ts:349` except combat (`AttackTarget`,
  `CheckForTargets`, `CheckForAttackers` are TODO — they need BuiltObjects/combat).
- `BaconFighter.cs:155-184` (via `Fighter.cs:256`): recharge, `DoMovement`, `UpdateMissionParameters`,
  `CheckBomberDefensiveFire`, `HandleWeaponsFiring`, explosions; ≥3 s return/evaluate/carrier checks,
  `ApplyLocationEffectsNEW`.
- `Character.cs:4277-4283 DoTasks(galaxy)` — called from `ProcessCharacters` (Empire short block).

### 1.7 Time model to port

`CurrentStarDate = (CurrentDateTime.Ticks − _StartDateTime.Ticks)/10000 + _StartStarDate` (`Galaxy.cs:1098`)
— integer ms. All `timePassed` values are `Ticks/1e7` seconds. Proposal: `SimTime` = integer game-ms since
start (`galaxy.nowMs`), `DateTime.MinValue` = a sentinel `MIN_TIME = -2**52`, spans as integer ms; every
touch field stores ms. `galaxy.currentTimeSeconds` (`galaxy.ts:166`, used by `creature.ts`) becomes a
getter over it. Keep `Math.trunc`/int casts where the C# casts.

---------------------------------------------------------------------------------------------------

## 2. Inventory of everything the DoTasks bodies call

### 2.1 Method

A script (not committed) parsed every method in `DistantWorlds.Types/*.cs` + `BaconDistantWorlds/*.cs`
(4,445 definitions), took each call in the DoTasks bodies above as a root (231 roots), and followed calls to
depth 3, resolving `receiver.Name(` by receiver type where it can and otherwise by name. Each
reached method is attributed to the root where it is reached at the shallowest depth; methods reached
from ≥5 roots are counted once as **shared helpers** (§2.4). Columns:

- **body** — lines of the root method(s) itself (overloads summed);
- **closure** — lines of the root + callees attributed to it (d≤3, excluding shared helpers). Name-based
  resolution over-includes a bit, so read these as ±30 %;
- **Rnd d/t** — `Galaxy.Rnd.Next/NextDouble` sites in the root body / `Y` if any callee within d≤3 draws;
  `+clock×n` = n clock-seeded `new Random(` sites in that closure (see §0);
- **TS** — status in `src/sim` by name search of TS identifiers and comments: *ported* (a camelCase
  definition or "Port of …" exists — check the file, many are game-start slices with `TODO(port)` branches),
  *referenced / partial* (named in comments / stand-ins), *TODO note*, *—* (nothing).

Totals: 231 roots, ~84k attributed closure lines + ~42k shared-helper lines.

### 2.2 Subsystem summary

| # | subsystem | roots | body | closure | direct Rnd | roots with Rnd in closure | ported (name match) |
|---|---|---:|---:|---:|---:|---:|---|
| A | economy / taxes / money / market | 17 | 940 | 1,853 | 0 | 2 | ~350 (prices, taxes, corruption, dev level) |
| B | construction, shipyards, facilities, designs | 21 | 3,122 | 7,688 | 7 | 12 | ~2,000 (designs, force structure, research-station location) |
| C | private sector (independent traders, private construction) | 5 | 565 | 770 | 4 | 3 | ~570 (traders — game-start form) |
| D | missions & ship AI (commands, docking, distress) | 16 | 4,873 | 12,782 | 16 | 4 | ~950 (mostly false hits) |
| E | movement / hyperjump / fuel / energy / orbits | 14 | 820 | 1,124 | 1 | 1 | orbits, refuelling locations |
| F | fleets / ShipGroups / military AI | 23 | 2,222 | 5,959 | 4 | 18 | ~370 (`ResolveLocationsToDefend`) |
| G | colonization | 6 | 230 | 353 | 1 | 2 | ~0 (targets are game-start only) |
| H | research progress | 4 | 383 | 2,377 | 3 | 2 | ~170 (`researchSystem.ts` tree/levels) |
| I | diplomacy / treaties / politics | 11 | 2,168 | 6,331 | 20 | 7 | ~260 (`diplomacy.ts` model) |
| J | pirates (missions, economy, factions) | 47 | 3,700 | 10,351 | 13 | 20 | ~1,650 (faction generation, relations) |
| K | characters, character events, espionage | 15 | 1,601 | 5,142 | 22 | 11 | ~1,450 (`characters.ts`) |
| L | trade / freight / orders / contracts / cargo | 12 | 529 | 1,410 | 0 | 0 | ~85 (order cancel/remove) |
| M | resource extraction / industry | 6 | 891 | 1,194 | 3 | 2 | ~390 (resource targets) |
| N | population growth / migration / happiness | 9 | 560 | 1,280 | 1 | 1 | ~0 (only `CalculateMigrationFactor` TODOs) |
| O | events / disasters / storms / story | 17 | 1,275 | 8,632 | 30 | 11 | location effects (Creature only) |
| P | creatures | 11 | 480 | 1,096 | 5 | 7 | ~590 (`creature.ts`, minus combat) |
| Q | messages / UI-only / achievements / victory | 5 | 292 | 920 | 0 | 1 | — |
| R | combat (weapons, damage, fighters, boarding, invasion, troops) | 54 | 4,837 | 10,947 | 31 | 24 | ~350 (troop garrison helpers) |
| S | visibility / exploration / territory | 15 | 763 | 2,868 | 3 | 4 | ~760 (`visibility.ts`, `territory.ts`) |
| T | infrastructure (indexes, cleanup, Rnd) | 6 | 174 | 724 | 0 | 1 | index cleanup |

### 2.3 Per-root tables

Block codes: G = Galaxy, E = Empire, P = pirate empire, SG = ShipGroup, BO = BuiltObject, H = Habitat,
Cr = Creature.

#### A. economy/taxes/money/market — 17 entry points, ~940 body lines, ~1,853 closure lines (d≤3, exclusive), 0 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ReviewResourcePrices | G-long 60s | Galaxy.1.cs 1204-1307 | 104 | 104 | 0/- | ported |
| ReviewComponentPrices | G-long 60s | Galaxy.1.cs 1027-1045 | 19 | 19 | 0/- | ported |
| EvaluateColonyVariables | E-periodic 30s | Empire.4.cs 2943-3307 | 365 | 765 | 0/Y | referenced / partial |
| RecalculateEmpireCorruption | E-periodic 30s | Empire.4.cs 3411-3446 | 36 | 36 | 0/- | ported |
| ReviewTaxes | E-periodic 30s | Empire.10.cs 158-176 | 19 | 48 | 0/- | ported |
| RecalculateColonyTaxRevenues | E-periodic 30s | Empire.10.cs 43-53 | 11 | 11 | 0/- | ported |
| ProcessColonyRevenue | E-intermediate 60s | — | 0 | 0 | 0/- | inline money block (Empire.1.cs 3579-3603) |
| ProcessSubjugationTribute | E-intermediate 60s | Empire.1.cs 996-1011 | 16 | 16 | 0/- | — |
| ReviewGovernmentEffects | E-long 120s | Empire.10.cs 55-84 | 30 | 30 | 0/- | — |
| CheckChangeGovernment | E-long 120s | Empire.10.cs 86-156 | 71 | 103 | 0/Y | — |
| ReviewSpecialBonusesRuinsWonders | E-long 120s | Empire.3.cs 939-1113 | 175 | 175 | 0/- | TODO note |
| PayMaintenanceForBuiltObjects | E-long 120s | Empire.4.cs 1743-1755 | 13 | 46 | 0/- | referenced / partial |
| PayForTroops | E-long 120s | Empire.2.cs 4010-4015 | 6 | 6 | 0/- | — |
| PayForPlanetaryFacilities | E-long 120s | Empire.2.cs 4004-4008 | 5 | 5 | 0/- | — |
| RecalculateDevelopmentLevelBaseline | H >60s | Habitat.cs 5575-5587 | 13 | 13 | 0/- | ported |
| RecalculateAnnualTaxRevenue | H >60s | Habitat.cs 6083-6119 | 37 | 37 | 0/- | ported |
| HugeProcessingSpanActions | H >240s | BaconHabitat.cs 434-453 | 20 | 439 | 0/- +clock×5 | — |

#### B. construction, shipyards, facilities, designs — 21 entry points, ~3,122 body lines, ~7,688 closure lines (d≤3, exclusive), 7 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ReviewWondersBuilt | G-long 60s | Galaxy.5.cs 334-388 | 55 | 55 | 0/- | — |
| ReviewDesignsAndRetrofit | E-regular 10s | Empire.1.cs 3403-3420 | 18 | 569 | 0/Y +clock×1 | — |
| CreateNewDesigns | E-intermediate 60s | Empire.10.cs 3256-3259; Empire.10.cs 3261-3264 | 393 | 1435 | 1/Y +clock×2 | ported |
| ReviewColonyWonders | E-long 120s | Empire.3.cs 114-207 | 94 | 212 | 0/- | — |
| ReviewColonyFacilities | E-long 120s | Empire.3.cs 395-816 | 422 | 475 | 1/Y | — |
| RefreshColonyFacilityInfo | E-long 120s | Empire.3.cs 104-112 | 9 | 9 | 0/- | referenced / partial |
| ProjectForceStructure | E-long 120s | Empire.9.cs 4990-5340 | 351 | 488 | 0/- | ported |
| RetireOldBuiltObjects | E-long 120s | Empire.6.cs 587-716 | 130 | 138 | 0/Y +clock×3 | — |
| ReviewLatestDesigns | E-long 120s | Empire.10.cs 3065-3080 | 16 | 16 | 0/- | — |
| DirectConstruction | E-long 120s | Empire.6.cs 2373-2902 | 530 | 1026 | 0/Y | — |
| DetermineMonitoringStationLocation | E-long 120s | Empire.5.cs 3769-3924 | 156 | 242 | 1/Y | — |
| DetermineResearchStationLocation | E-long 120s | Empire.5.cs 3575-3578; Empire.5.cs 3580-3678 | 103 | 159 | 0/- | ported |
| BuildDefensiveBases | E-huge 240s | Empire.10.cs 1211-1375 | 165 | 170 | 1/Y | — |
| DoRepairs | BO 3s | BuiltObject.cs 3498-3501; BaconBuiltObject.cs 4763-4861 | 103 | 120 | 1/Y +clock×2 | — |
| CheckWhetherStillBeingBuilt | BO 10s | BuiltObject.cs 3877-3901 | 25 | 25 | 0/- | — |
| ReviewRetrofitConstructionQueue | BO 10s | BuiltObject.2.cs 6023-6082 | 60 | 60 | 0/Y | — |
| DoManufacturing | H >10s | ManufacturingQueue.cs 305-339 | 35 | 323 | 0/Y | — |
| DoConstruction | H >10s | ConstructionQueue.cs 1196-1222 | 27 | 1189 | 1/Y | — |
| ConstructFacilities | H >10s | Habitat.cs 2039-2223 | 185 | 704 | 1/Y | — |
| ReviewConstructionSpeed | H >60s | ConstructionQueue.cs 66-69; BaconConstructionQueue.cs 45-257 | 217 | 224 | 0/- | referenced / partial |
| CheckForSpacePortFacilities | H >60s | Habitat.cs 2729-2756 | 28 | 49 | 0/- | ported |

#### C. private sector — 5 entry points, ~565 body lines, ~770 closure lines (d≤3, exclusive), 4 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| SelectPopularDesignCandidates | G-huge 240s | Galaxy.7.cs 4698-4755 | 58 | 112 | 0/- | ported |
| GenerateIndependentTraders | G-long 60s | Galaxy.7.cs 4354-4546 | 193 | 216 | 4/Y +clock×2 | ported |
| AssignIndependentTraderMissions | G-long 60s | Galaxy.7.cs 4548-4595 | 48 | 48 | 0/Y +clock×3 | ported |
| ProjectPrivateForceStructure | E-long 120s | Empire.9.cs 4767-4932 | 166 | 227 | 0/- | ported |
| DirectPrivateConstruction | E-long 120s | Empire.6.cs 741-840 | 100 | 167 | 0/Y | — |

#### D. missions & ship AI (commands, docking) — 16 entry points, ~4,873 body lines, ~12,782 closure lines (d≤3, exclusive), 16 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ProcessDistressSignals | E-regular 10s | Empire.3.cs 4915-5020 | 106 | 212 | 0/Y | — |
| ClearOutOldDistressSignals | E-regular 10s | Empire.3.cs 4898-4913 | 16 | 16 | 0/- | — |
| AssignShipMissions | E-periodic 30s | Empire.4.cs 4796-4861 | 66 | 116 | 0/Y | — |
| ClearOldDistressSignals | E-long 120s | Empire.2.cs 3985-4002 | 18 | 18 | 0/- | — |
| ClearExpiredDeclinedTasks | E-long 120s | Empire.8.cs 4357-4372 | 16 | 16 | 0/- | — |
| ExecuteCommands | BO every call | BuiltObject.2.cs 399-4579 | 4181 | 11129 | 16/Y +clock×7 | — |
| CheckNearTarget | BO 3s | BaconBuiltObject.cs 2578-2669 | 92 | 100 | 0/- | — |
| ScanForNewOwner | BO 3s | BuiltObject.1.cs 65-68; BuiltObject.1.cs 70-206 | 141 | 760 | 0/Y +clock×2 | — |
| CheckRepairMissionStillValid | BO 10s | BuiltObject.1.cs 4474-4494 | 21 | 21 | 0/- | — |
| CheckClearDocking | BO 10s | BuiltObject.1.cs 1275-1282; BuiltObject.1.cs 1284-1354 | 79 | 79 | 0/- | — |
| CheckForRepairs | BO 10s | BuiltObject.cs 4077-4094 | 18 | 18 | 0/- | — |
| HugeProcessingSpanActions | BO 60s | BaconBuiltObject.cs 4083-4095 | 13 | 191 | 0/- +clock×3 | — |
| CheckForShipsNoLongerDocking | BO 60s | BuiltObject.cs 3903-3932 | 30 | 30 | 0/- | — |
| CheckRemoveInvalidDockingShipsFromWaitQueue | BO 60s | Galaxy.cs 3540-3567 | 28 | 28 | 0/- | — |
| CheckForShipsNoLongerDocking | H >60s | Habitat.cs 2464-2483 | 20 | 20 | 0/- | — |
| CheckRemoveInvalidDockingShipsFromWaitQueue | H >240s | Galaxy.cs 3540-3567 | 28 | 28 | 0/- | — |

#### E. movement/hyperjump/fuel/energy/orbits — 14 entry points, ~820 body lines, ~1,124 closure lines (d≤3, exclusive), 1 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| UpdateEmpireRefuellingLocations | G-long 60s | Empire.6.cs 3845-3939 | 95 | 95 | 0/- | ported (independentTraders.ts) |
| UpdateEmpireRefuellingLocations | E-regular 10s | Empire.6.cs 3845-3939 | 95 | 95 | 0/- | ported (independentTraders.ts) |
| EvaluateSystemLinks | E-periodic 30s | Empire.9.cs 3273-3381 | 109 | 147 | 1/Y | — |
| UpdateSystemRefuellingStatus | E-intermediate 60s | Empire.2.cs 3856-3878 | 23 | 139 | 0/- | — |
| CheckForStrandedShips | E-intermediate 60s | Empire.4.cs 2516-2548 | 33 | 33 | 0/- | — |
| UpdateSystemFuelSourceStatus | E-intermediate 60s | Empire.2.cs 3784-3854 | 71 | 71 | 0/- | — |
| DoDeployment | BO every call | BuiltObject.cs 3473-3496 | 24 | 24 | 0/- | — |
| PerformEnergyCollection | BO every call | BuiltObject.2.cs 7765-7803 | 39 | 39 | 0/- | — |
| RechargeReactors | BO every call | BuiltObject.1.cs 2509-2524 | 16 | 16 | 0/- | — |
| DetectHyperDeny | BO 3s | BuiltObject.1.cs 1737-1770 | 34 | 34 | 0/- | — |
| CheckForRefuelling | BO 10s | BuiltObject.cs 4940-5099 | 160 | 294 | 0/- | — |
| CheckForFuelOrdering | BO 10s | BuiltObject.cs 4697-4772 | 76 | 76 | 0/- | — |
| Move | H every call | Habitat.cs 5449-5482 | 34 | 50 | 0/- | ported (types.ts advanceOrbit) |
| ReviewWhetherRefuellingDepot | H >60s | Habitat.cs 2007-2017 | 11 | 11 | 0/- | — |

#### F. fleets / ShipGroups / military AI — 23 entry points, ~2,222 body lines, ~5,959 closure lines (d≤3, exclusive), 4 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ProcessPirateFleets | G-every | Galaxy.cs 3278-3295 | 18 | 97 | 0/Y +clock×1 | referenced / partial |
| RespondToIncomingEnemyFleetsAndPlanetDestroyers | E-short 3s | Empire.1.cs 3198-3320 | 123 | 294 | 0/Y | — |
| CheckForMissionCompletion | SG 3s/10s | ShipGroup.cs 516-1279 | 764 | 1745 | 0/Y | — |
| CheckForCompletedBattle | SG 3s/10s | ShipGroup.cs 191-222 | 32 | 32 | 0/Y | — |
| CheckRefuelManual | SG 3s/10s | ShipGroup.cs 1597-1668 | 72 | 72 | 0/Y | — |
| CheckRefuelRepairAttack | SG 3s/10s | ShipGroup.cs 1670-1812 | 143 | 424 | 0/Y | — |
| CheckSendForAttack | SG 3s/10s | ShipGroup.cs 170-189 | 20 | 20 | 0/Y | — |
| ReviewCharacterLocationBonuses | SG 3s/10s | ShipGroup.cs 316-368 | 53 | 97 | 0/- | — |
| CheckAssignUnloadTroopsAtColonyNeedingThemMission | SG 3s/10s | Empire.5.cs 727-742; Empire.5.cs 755-770 | 32 | 76 | 0/- | — |
| LoadTroopsIfNecessaryAndPossible | SG 3s/10s | ShipGroup.cs 124-135 | 12 | 240 | 1/Y | — |
| IdentifyMilitaryObjectives | E-periodic 30s | Empire.8.cs 4266-4355 | 90 | 411 | 1/Y | — |
| MaintainShipGroups | E-periodic 30s | Empire.9.cs 2472-2730 | 259 | 400 | 0/Y | — |
| UpdateFleetLeadShips | E-periodic 30s | Empire.9.cs 2460-2470 | 11 | 11 | 0/- | — |
| ReviewFleetPostures | E-periodic 30s | Empire.9.cs 2454-2458 | 5 | 5 | 0/Y | — |
| CancelInactiveBlockades | E-periodic 30s | Empire.2.cs 3938-3983 | 46 | 46 | 0/- | — |
| TaskShipGroups | E-intermediate 60s | Empire.9.cs 1162-1274 | 113 | 466 | 0/Y | — |
| TaskResupplyShips | E-intermediate 60s | Empire.9.cs 52-59 | 8 | 319 | 0/Y | — |
| ReviewSystemThreats | E-intermediate 60s | Empire.9.cs 4163-4419 | 257 | 298 | 0/Y | referenced / partial |
| CheckTemptingTargets | E-long 120s | Empire.10.cs 913-927 | 15 | 197 | 1/Y | — |
| SendAvailableFleetsToGuardStrategicLocations | E-long 120s | Empire.5.cs 1007-1040 | 34 | 425 | 0/Y | — |
| DetermineRandomAttacks | E-long 120s | Empire.2.cs 4512-4564 | 53 | 222 | 1/Y | — |
| ReviewFleetBonuses | BO 10s | BuiltObject.cs 1906-1928 | 23 | 23 | 0/- | — |
| PerformFleetTasks | BO 10s | BuiltObject.cs 3503-3541 | 39 | 39 | 0/Y | — |

#### G. colonization — 6 entry points, ~230 body lines, ~353 closure lines (d≤3, exclusive), 1 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ReviewIndependentColonies | G-long 60s | Galaxy.1.cs 827-838 | 12 | 12 | 0/- | ported |
| ReviewColonyFillFactor | G-long 60s | Galaxy.cs 3020-3031 | 12 | 12 | 0/- | referenced / partial |
| ReviewIndependentColonyTargets | E-intermediate 60s | Empire.5.cs 1298-1313 | 16 | 28 | 0/- | — |
| IdentifyColonizationTargets | E-intermediate 60s | Empire.4.cs 4652-4655; Empire.4.cs 4657-4660 | 126 | 208 | 0/- | referenced / partial |
| InvadeUnwillingColonizationTargets | E-intermediate 60s | Empire.4.cs 4449-4485 | 37 | 66 | 1/Y | — |
| ScanForNewOwner | H >10s | Habitat.cs 2571-2597 | 27 | 27 | 0/Y | — |

#### H. research progress — 4 entry points, ~383 body lines, ~2,377 closure lines (d≤3, exclusive), 3 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| PerformResearch | E-periodic 30s | Empire.3.cs 1756-1768 | 13 | 1596 | 0/Y | referenced / partial |
| ReviewResearchStationBonuses | E-intermediate 60s | Empire.3.cs 2732-2816 | 85 | 137 | 0/- | — |
| ReviewEmpireAbilityBonuses | E-long 120s | Empire.cs 2891-2896; Empire.cs 2898-3066 | 175 | 175 | 0/- | referenced / partial |
| DoCrashResearch | E-long 120s | Empire.3.cs 3093-3202 | 110 | 469 | 3/Y | — |

#### I. diplomacy/treaties/politics — 11 entry points, ~2,168 body lines, ~6,331 closure lines (d≤3, exclusive), 20 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| RemoveDefeatedEmpireRelations | E-periodic 30s | Empire.1.cs 3322-3372 | 51 | 51 | 0/- | — |
| ProcessMessages | E-periodic 30s | Empire.3.cs 4240-4848 | 609 | 2175 | 13/Y | — |
| ConsiderTreatyProposals | E-periodic 30s | Empire.3.cs 3606-3924 | 319 | 697 | 0/Y | — |
| ClearInvalidDiplomaticRelations | E-long 120s | Empire.8.cs 1875-1903 | 29 | 29 | 0/- | — |
| EvaluatePoliticalSituation | E-long 120s | Empire.8.cs 1905-2305 | 401 | 603 | 4/Y | — |
| ReviewDiplomaticStrategies | E-long 120s | Empire.8.cs 66-479 | 414 | 517 | 0/Y | referenced / partial |
| ReviewDiplomaticSituations | E-long 120s | Empire.8.cs 742-753 | 12 | 804 | 0/Y | — |
| TradeItems | E-long 120s | Empire.7.cs 2576-2664 | 89 | 211 | 1/Y | — |
| ReviewEmpireEndsAllWars | E-huge 240s | Empire.1.cs 3961-3967 | 7 | 12 | 0/- | — |
| ReviewEnemyHelpEnlistment | E-huge 240s | Empire.7.cs 2060-2147 | 88 | 868 | 0/- | — |
| ReviewDisputedTerritory | E-huge 240s | Empire.7.cs 2205-2353 | 149 | 364 | 2/Y | — |

#### J. pirates (missions, economy, factions) — 47 entry points, ~3,700 body lines, ~10,351 closure lines (d≤3, exclusive), 13 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ReviewPirateMissionsAndAssign | G-ts | Galaxy.9.cs 527-575 | 49 | 49 | 0/- | — |
| DoGalaxyEvents | G-huge 240s | Galaxy.cs 3297-3311 | 15 | 455 | 1/Y | referenced / partial |
| GenerateNewPirateEmpires | G-long 60s | Galaxy.9.cs 20-124 | 105 | 1273 | 0/Y +clock×1 | ported |
| CheckForTerminatedPirateEmpires | G-long 60s | Galaxy.8.cs 3268-3352 | 85 | 85 | 1/Y +clock×3 | referenced / partial |
| GenerateNewPirateShips | G-long 60s | Galaxy.8.cs 2774-2776 | 3 | 3 | 0/- | referenced / partial |
| DoSuperPirateTasks | G-long 60s | Galaxy.9.cs 208-218; Galaxy.9.cs 284-338 | 66 | 214 | 0/Y | referenced / partial |
| CheckMergePirateFactions | G-long 60s | Galaxy.8.cs 2907-2947 | 41 | 109 | 0/Y | referenced / partial |
| ReviewPirateEmpireActivities | G-long 60s | Galaxy.8.cs 3398-3486 | 89 | 89 | 0/- | referenced / partial |
| ReviewPirateSmugglingMissions | G-long 60s | Empire.2.cs 1358-1424 | 67 | 83 | 0/Y | referenced / partial |
| ReviewPirateDefendMissions | G-long 60s | Empire.2.cs 1313-1356 | 44 | 44 | 0/- | referenced / partial |
| IndependentColoniesMakeSmugglingOffersToPirates | G-long 60s | Galaxy.cs 3237-3276 | 40 | 62 | 1/Y | referenced / partial |
| IndependentColoniesMakeDefendOffersToPirates | G-long 60s | Galaxy.cs 3203-3235 | 33 | 33 | 1/Y | referenced / partial |
| CheckReviewSpecialPirateEvents | E-periodic 30s | Empire.7.cs 3408-3414 | 7 | 7 | 0/Y | — |
| CheckSendPirateRaid | E-periodic 30s | Empire.1.cs 4065-4093 | 29 | 29 | 0/- | — |
| ReviewPirateDefendMissions | E-periodic 30s | Empire.2.cs 1313-1356 | 44 | 44 | 0/- | referenced / partial |
| ReviewPirateSmugglingMissions | E-periodic 30s | Empire.2.cs 1358-1424 | 67 | 67 | 0/Y | referenced / partial |
| CheckKnownPirateBases | E-intermediate 60s | Empire.1.cs 979-994 | 16 | 16 | 0/- | — |
| ReviewPirateRelations | E-long 120s | Empire.2.cs 2401-2508 | 108 | 245 | 1/Y | — |
| CheckHaveMetPirates | E-long 120s | Empire.3.cs 3528-3542 | 15 | 15 | 0/- | ported |
| MakeAttackOffersToPirates | E-long 120s | Empire.2.cs 1719-1845 | 127 | 356 | 0/- | — |
| MakeDefendOffersToPirates | E-long 120s | Empire.2.cs 1138-1249 | 112 | 225 | 0/- | — |
| MakeSmugglingOffersToPirates | E-long 120s | Empire.2.cs 1426-1526 | 101 | 207 | 0/- | — |
| CheckColoniesForPirateFacilitiesAndAttack | E-huge 240s | Empire.1.cs 4328-4331; BaconEmpire.cs 1499-1542 | 48 | 215 | 0/Y | — |
| PirateCheckMissionsOnOffer | P-regular 10s | Empire.2.cs 1943-2047 | 105 | 309 | 0/- +clock×1 | — |
| PirateRecalculateEmpireCorruption | P-periodic 30s | Empire.4.cs 3406-3409; BaconEmpire.cs 1253-1267 | 19 | 19 | 1/Y | — |
| EvaluateColonyVariablesPirate | P-periodic 30s | Empire.4.cs 2579-2941 | 363 | 363 | 0/Y | referenced / partial |
| PirateAssignShipMissions | P-periodic 30s | Empire.1.cs 4385-4422 | 38 | 2356 | 0/Y | — |
| PirateTaskFleets | P-intermediate 60s | Empire.9.cs 904-1160 | 257 | 708 | 0/- | — |
| PirateCollectIncomeFromControlledColonies | P-intermediate 60s | Empire.2.cs 2895-2942 | 48 | 110 | 0/- | — |
| PirateReviewSystemThreats | P-intermediate 60s | Empire.9.cs 4139-4161 | 23 | 23 | 0/- | — |
| PirateReviewColoniesToControl | P-intermediate 60s | Empire.1.cs 3103-3141 | 39 | 93 | 0/- | ported (root); callees partly |
| PirateGenerateSellInfoOffers | P-intermediate 60s | Empire.1.cs 4359-4383 | 25 | 379 | 1/Y | — |
| ReviewPirateSystemInfluence | P-intermediate 60s | Empire.7.cs 2180-2203 | 24 | 24 | 0/- | — |
| DoTaskPiratesLongInterval | P-long 120s | BaconEmpire.cs 1099-1106 | 8 | 155 | 0/Y +clock×2 | — |
| MaintainPirateSpaceportResourceLevels | P-long 120s | Empire.4.cs 2399-2424 | 26 | 62 | 0/- | — |
| PirateReviewColonyFacilities | P-long 120s | Empire.3.cs 254-393 | 140 | 151 | 0/- | — |
| PirateReviewEmpireRelations | P-long 120s | Empire.2.cs 2510-2645 | 136 | 249 | 0/- | — |
| PirateProjectForces | P-long 120s | Empire.2.cs 766-1136 | 371 | 439 | 0/- | — |
| PirateDoConstruction | P-long 120s | Empire.2.cs 219-560 | 342 | 466 | 0/Y | — |
| PirateResetCivilianShipEmpireToIndependent | P-long 120s | Empire.1.cs 4333-4357 | 25 | 25 | 0/- | — |
| PiratesMakeAttackOffers | P-long 120s | Empire.2.cs 1847-1941 | 95 | 95 | 0/- | — |
| PirateTradeItems | P-long 120s | Empire.7.cs 2666-2756 | 91 | 91 | 2/Y | — |
| PirateReviewRandomEvents | P-huge 240s | Empire.1.cs 1731-1756 | 26 | 121 | 4/Y | — |
| PirateBaseDiscovery | BO 10s | BuiltObject.1.cs 1889-1905 | 17 | 17 | 0/- | — |
| UpdateRaidCountdown | BO 60s | BuiltObject.1.cs 2894-2903 | 10 | 10 | 0/- | — |
| ReviewPirateControl | H >10s | BaconHabitat.cs 1388-1538 | 151 | 151 | 0/- | — |
| UpdateRaidCountdown | H >60s | Habitat.cs 1608-1617 | 10 | 10 | 0/- | — |

#### K. characters, events, espionage — 15 entry points, ~1,601 body lines, ~5,142 closure lines (d≤3, exclusive), 22 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ProcessCharacters | E-short 3s | Empire.6.cs 3941-3951 | 11 | 11 | 0/- | — |
| AssignSpecialMissions | E-periodic 30s | Empire.5.cs 5401-5549 | 149 | 921 | 3/Y | — |
| PerformIntelligenceMissions | E-periodic 30s | Empire.5.cs 5597-6110 | 514 | 1014 | 6/Y +clock×3 | — |
| ReviewFleetAdmiralBonuses | E-intermediate 60s | Empire.2.cs 2944-2953 | 10 | 93 | 0/- | — |
| DoCharacterEventLeader | E-intermediate 60s | Galaxy.1.cs 3756-3760 | 5 | 5 | 0/Y | — |
| CheckForCharacterAppearance | E-intermediate 60s | Empire.6.cs 3990-4302 | 313 | 686 | 2/Y +clock×1 | — |
| ReviewCharacterLeaderChange | E-intermediate 60s | Empire.6.cs 4769-4870 | 102 | 189 | 1/Y +clock×1 | — |
| ProcessLeaderChangeInfluence | E-intermediate 60s | Empire.6.cs 5084-5135 | 52 | 211 | 4/Y +clock×1 | — |
| ReviewCharacterBonusesKnown | E-intermediate 60s | Empire.6.cs 4716-4755 | 40 | 40 | 0/- | — |
| ReviewCharacterTraits | E-intermediate 60s | Empire.7.cs 16-317 | 302 | 1791 | 3/Y | — |
| ReviewDemoralizingCharacters | E-intermediate 60s | Empire.7.cs 319-346 | 28 | 28 | 1/Y +clock×1 | — |
| ReviewCharacterLocations | E-intermediate 60s | Empire.7.cs 348-363 | 16 | 81 | 0/Y | — |
| ReviewCaptainBonuses | BO 60s | BuiltObject.cs 1448-1486 | 39 | 39 | 0/- | ported |
| ChanceColonyGovernorPromotion | H >240s | Galaxy.2.cs 4784-4796 | 13 | 13 | 2/Y | — |
| DoTasks | Char (E-short) | Character.cs 4277-4283 | 7 | 20 | 0/Y | — (characters.ts has the model) |

#### L. trade/freight/orders/contracts/cargo — 12 entry points, ~529 body lines, ~1,410 closure lines (d≤3, exclusive), 0 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| RemoveCompletedOrders | G-long 60s | Galaxy.1.cs 1047-1066 | 20 | 20 | 0/- | ported |
| CancelExpiredOrders | G-long 60s | Galaxy.1.cs 1126-1158 | 33 | 33 | 0/- | ported |
| MaintainIndependentColonyFuelLevels | G-long 60s | Galaxy.cs 1682-1701 | 20 | 82 | 0/- | referenced / partial |
| CheckMarketOrders | G-long 60s | Empire.4.cs 720-823 | 104 | 714 | 0/- | referenced / partial |
| CheckMarketOrders | E-periodic 30s | Empire.4.cs 720-823 | 104 | 104 | 0/- | referenced / partial |
| ProcessTradeBonuses | E-intermediate 60s | Empire.1.cs 1029-1058 | 30 | 62 | 0/- | — |
| ReviewRestrictedResourceTrading | E-long 120s | Empire.4.cs 4311-4352 | 42 | 93 | 0/- | — |
| MaintainBaseResourceLevels | E-huge 240s | Empire.1.cs 4275-4293 | 19 | 32 | 0/- | — |
| CheckForUnownedCargo | BO 60s | BuiltObject.cs 3568-3607 | 40 | 40 | 0/- | — |
| ConsumeResources | H >60s | Habitat.cs 2758-2816 | 59 | 67 | 0/- | — |
| ConsumeAndOrderStrategicResourceSupply | H >60s | Habitat.cs 7293-7310 | 18 | 123 | 0/- | — |
| CheckForUnownedCargo | H >240s | Habitat.cs 1558-1597 | 40 | 40 | 0/- | — |

#### M. resource extraction/industry — 6 entry points, ~891 body lines, ~1,194 closure lines (d≤3, exclusive), 3 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| IdentifyResourceCentres | E-intermediate 60s | Empire.4.cs 1948-1951; Empire.4.cs 1953-1956 | 203 | 295 | 0/- | ported |
| PrioritizeEmpireResourceNeeds | E-intermediate 60s | Empire.2.cs 4023-4026; Empire.2.cs 4028-4031 | 148 | 184 | 0/- | — |
| IdentifyUnavailableLuxuryResources | E-intermediate 60s | Empire.4.cs 1827-1848 | 22 | 82 | 0/- | ported |
| IndustrialProcessing | BO 10s | BuiltObject.2.cs 7805-8129 | 325 | 407 | 0/Y | — |
| ExtractResources | H >10s | Habitat.cs 2827-2912 | 86 | 86 | 0/- | — |
| ReviewManufacturedResources | H >240s | Habitat.cs 1899-2005 | 107 | 140 | 3/Y | — |

#### N. population growth/migration/happiness — 9 entry points, ~560 body lines, ~1,280 closure lines (d≤3, exclusive), 1 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ReviewRacePeriodicChanges | G-long 60s | Galaxy.cs 3425-3496 | 72 | 113 | 0/- | referenced / partial |
| ReviewColonyPopulationPolicy | E-intermediate 60s | Empire.2.cs 3198-3438 | 241 | 289 | 0/- | — |
| ReviewMigrationTourism | E-long 120s | Empire.5.cs 3128-3136 | 9 | 405 | 0/- | — |
| CalculateWarWithOurRace | H >10s | Habitat.cs 5694-5716 | 23 | 23 | 0/- | TODO note |
| GrowPopulation | H >10s | Habitat.cs 5172-5228 | 57 | 70 | 0/- | referenced / partial |
| TerraformColony | H >60s | Habitat.cs 7211-7214; BaconHabitat.cs 243-280 | 42 | 42 | 0/- | — |
| CheckSatisfaction | H >60s | Habitat.cs 5992-6068 | 77 | 299 | 1/Y | — |
| UpdateConqueredFactor | H >60s | Habitat.cs 1599-1606 | 8 | 8 | 0/- | TODO note |
| CalculateMigrationFactor | H >60s | Habitat.cs 1162-1192 | 31 | 31 | 0/- | TODO note |

#### O. events/disasters/storms/story — 17 entry points, ~1,275 body lines, ~8,632 closure lines (d≤3, exclusive), 30 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ProcessDelayedEventActions | G-ts | Galaxy.9.cs 1474-1501 | 28 | 3583 | 0/Y +clock×6 | — |
| ClearEmptyDebrisFields | G-long 60s | Galaxy.5.cs 2893-2921 | 29 | 68 | 0/- | referenced / partial |
| ShakturiSendConvoy | E-huge 240s | Empire.2.cs 3487-3506 | 20 | 28 | 1/Y | — |
| CheckOfferStoryHint | E-huge 240s | Empire.2.cs 3508-3782 | 275 | 639 | 1/Y | — |
| ResetRaceEvents | E-huge 240s | Empire.1.cs 2094-2129 | 36 | 36 | 0/- | — |
| ReviewRandomEvents | E-huge 240s | Empire.1.cs 1758-1786 | 29 | 366 | 5/Y | — |
| ReviewEmpireEvents | E-huge 240s | Empire.1.cs 2811-2881 | 71 | 1800 | 8/Y +clock×1 | — |
| CheckSendShipConvoysViaGateway | E-huge 240s | Empire.1.cs 3899-3959 | 61 | 75 | 4/Y | — |
| DoLocationEffects | BO every call | BuiltObject.cs 3448-3471 | 24 | 24 | 0/Y +clock×2 | — |
| ApplyLocationEffectsNEW | Fighter every call / 3s | Fighter.cs 261-338 | 78 | 78 | 4/Y +clock×3 | — |
| ApplyLocationEffects | BO 3s | BuiltObject.cs 3934-4045 | 112 | 112 | 4/Y +clock×2 | — |
| DoExplosion | H every call | Habitat.cs 6341-6377 | 37 | 37 | 0/- | — |
| ProcessPlague | H >10s | Habitat.cs 1678-1836 | 159 | 262 | 2/Y +clock×1 | — |
| CheckHabitatIsEmpire | H >60s | Habitat.cs 5230-5447 | 218 | 1078 | 1/Y +clock×2 | — |
| DoPlanetRemove | H >240s | Habitat.cs 6379-6397 | 19 | 348 | 0/- | — |
| DoLocationEffects | Cr 3/10/30s | Creature.cs 1672-1688 | 17 | 17 | 0/- | ported |
| ApplyLocationEffects | Cr 3/10/30s | Creature.cs 1609-1670 | 62 | 81 | 0/- | ported |

#### P. creatures — 11 entry points, ~480 body lines, ~1,096 closure lines (d≤3, exclusive), 5 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| SpawnCreatures | H >240s | Habitat.cs 1619-1641 | 23 | 33 | 0/Y | — |
| Move | Cr 3/10/30s | Creature.cs 998-1148 | 151 | 295 | 1/Y | ported |
| CheckForAttackers | Cr 3/10/30s | Creature.cs 1196-1204 | 9 | 9 | 0/- | TODO note |
| AttackTarget | Cr 3/10/30s | Creature.cs 1299-1345 | 47 | 313 | 0/Y +clock×1 | TODO note |
| Heal | Cr 3/10/30s | Creature.cs 520-527 | 8 | 8 | 0/- | ported |
| CheckForTargets | Cr 3/10/30s | Creature.cs 1206-1244 | 39 | 103 | 0/Y | TODO note |
| CompleteTeardown | Cr 3/10/30s | Creature.cs 948-996 | 49 | 49 | 0/- | ported |
| CheckFixNotInSystem | Cr 3/10/30s | Creature.cs 570-646 | 77 | 77 | 0/- | ported |
| Split | Cr 3/10/30s | Creature.cs 869-887 | 19 | 19 | 1/Y | ported |
| ChooseAction | Cr 3/10/30s | Creature.cs 648-669 | 22 | 154 | 2/Y | ported |
| Reproduce | Cr 3/10/30s | Creature.cs 889-924 | 36 | 36 | 1/Y | ported |

#### Q. messages/UI-only/achievements/victory — 5 entry points, ~292 body lines, ~920 closure lines (d≤3, exclusive), 0 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ReviewAchievements | G-long 60s | Galaxy.1.cs 2935-2955 | 21 | 165 | 0/- | — |
| CheckVictoryConditions | G-long 60s | Galaxy.1.cs 88-153 | 66 | 454 | 0/Y | — |
| WarnOfIncomingEnemyFleetsAndPlanetDestroyers | UI frame | Empire.6.cs 1776-1935 | 160 | 213 | 0/- | — |
| IdentifyMechanoidEmpire | UI frame | Galaxy.8.cs 1619-1631 | 13 | 13 | 0/- | — |
| UpdateAchievements | E-intermediate 60s | Empire.1.cs 3969-4000 | 32 | 75 | 0/- | — |

#### R. combat (weapons, fighters, boarding, troops/invasion) — 54 entry points, ~4,837 body lines, ~10,947 closure lines (d≤3, exclusive), 31 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ClearCompletedPlanetDestroyerProjects | G-long 60s | Galaxy.5.cs 2867-2891 | 25 | 25 | 0/- | referenced / partial |
| RecruitAttackTroops | E-periodic 30s | Empire.4.cs 3908-4012 | 105 | 151 | 0/- | — |
| DisbandExcessTroops | E-long 120s | Empire.4.cs 1627-1741 | 115 | 115 | 0/- | — |
| RechargeShields | BO every call | BuiltObject.1.cs 2225-2261 | 37 | 37 | 0/- | — |
| CheckForPlanetDestroyerWeaponFiringDelayOnHyperExit | BO every call | BuiltObject.1.cs 1815-1837 | 23 | 23 | 0/- | — |
| HandleWeaponsFiring | BO every call | BuiltObject.1.cs 3737-4472 | 736 | 1678 | 9/Y +clock×3 | — |
| HandleAssaultPodMovement | BO every call | BuiltObject.1.cs 2626-2740 | 115 | 307 | 0/Y | — |
| DoExplosions | BO every call | BuiltObject.1.cs 14-40 | 27 | 27 | 0/Y +clock×3 | — |
| DefendBase | BO every call | BuiltObject.cs 4557-4695 | 139 | 233 | 0/Y | — |
| DefendShipFromAttackers | BO every call | BuiltObject.cs 4448-4555 | 108 | 108 | 0/Y | — |
| FireAtAssaultPods | BO every call | BuiltObject.1.cs 2905-2952 | 48 | 48 | 0/Y | — |
| InterceptMissiles | BO every call | BaconBuiltObject.cs 5032-5088 | 57 | 57 | 0/- | — |
| FireAtNearbyFighters | BO every call | BuiltObject.cs 4274-4361 | 88 | 121 | 0/Y | — |
| FireTractorBeamsAtInvadingTroopTransports | BO every call | BuiltObject.cs 4191-4272 | 82 | 175 | 0/Y | — |
| RechargeEnergy | Fighter every call / 3s | Fighter.cs 2092-2099 | 8 | 8 | 0/- | — |
| RechargeShields | Fighter every call / 3s | Fighter.cs 2101-2112 | 12 | 12 | 0/- | — |
| RepairDamage | Fighter every call / 3s | Fighter.cs 2114-2122 | 9 | 9 | 0/- | — |
| DoMovement | Fighter every call / 3s | Fighter.cs 1783-1832 | 50 | 196 | 0/- | — |
| UpdateMissionParameters | Fighter every call / 3s | Fighter.cs 1657-1676 | 20 | 489 | 0/Y | — |
| CheckBomberDefensiveFire | Fighter every call / 3s | BaconFighter.cs 656-702 | 47 | 79 | 1/Y +clock×2 | — |
| HandleWeaponsFiring | Fighter every call / 3s | Fighter.cs 668-907 | 240 | 950 | 2/Y +clock×3 | — |
| DoExplosions | Fighter every call / 3s | Fighter.cs 1071-1097 | 27 | 79 | 0/- | — |
| ReturnToCarrierForRepairs | Fighter every call / 3s | Fighter.cs 502-516 | 15 | 15 | 0/- | — |
| EvaluateThreats | Fighter every call / 3s | Fighter.cs 518-521; BaconFighter.cs 283-456 | 178 | 375 | 0/Y +clock×3 | TODO note |
| CheckCarrierDestroyed | Fighter every call / 3s | Fighter.cs 440-446 | 7 | 7 | 0/- | — |
| CheckReturnToCarrier | Fighter every call / 3s | Fighter.cs 435-438; BaconFighter.cs 131-153 | 27 | 52 | 0/- | — |
| ReturnToCarrierIfOutOfAmmo | Fighter every call / 3s | BaconFighter.cs 218-225 | 8 | 8 | 0/- | — |
| LaunchAllFighters | BO 3s | BuiltObject.cs 1818-1832 | 15 | 29 | 0/Y | — |
| SetAttackRangeWhenNoMission | BO 3s | BuiltObject.2.cs 7734-7752 | 19 | 19 | 0/- | — |
| CheckShieldAreaRechargeReset | BO 3s | BuiltObject.cs 1930-1945 | 16 | 16 | 0/- | — |
| ReviewDisabledComponents | BO 3s | BuiltObject.2.cs 6084-6125 | 42 | 42 | 0/Y +clock×1 | — |
| ThreatEvaluation | BO 3s | BuiltObject.1.cs 243-388 | 146 | 953 | 0/Y | — |
| ModifyAttackRangeByTargetSpeed | BO 3s | BuiltObject.2.cs 197-203; BuiltObject.2.cs 205-307 | 110 | 144 | 0/- | — |
| CheckForAttack | BO 3s | BuiltObject.1.cs 1185-1273 | 89 | 115 | 0/- | — |
| CheckForRandomAttackTargets | BO 3s | BuiltObject.1.cs 1852-1887 | 36 | 36 | 0/- | — |
| ProcessBoardingAssault | BO 3s | BuiltObject.1.cs 2954-3312 | 359 | 888 | 5/Y +clock×3 | — |
| FleeFromHopelessBattle | BO 10s | BuiltObject.1.cs 642-699 | 58 | 165 | 0/Y | — |
| CheckNearbyBuiltObjectsForShieldAreaRecharge | BO 10s | BuiltObject.cs 1947-2004 | 58 | 58 | 1/Y | — |
| CheckFightersNeedUpgrading | BO 10s | BuiltObject.cs 3548-3551; BaconBuiltObject.cs 5308-5334 | 31 | 51 | 0/Y +clock×3 | — |
| BuildNewFighters | BO 10s | BuiltObject.cs 1896-1899; BaconBuiltObject.cs 3151-3218 | 72 | 190 | 0/- | — |
| ManufactureRepairFighters | BO 10s | BuiltObject.cs 1901-1904; BaconBuiltObject.cs 3241-3301 | 65 | 108 | 0/- | — |
| HealTroops | BO 10s | BuiltObject.cs 4047-4075 | 29 | 29 | 0/- | — |
| CheckSelfDestruct | BO 60s | BuiltObject.2.cs 4816-4823 | 8 | 104 | 0/Y +clock×2 | — |
| ResetAssaultPods | BO 60s | BaconBuiltObject.cs 777-790 | 14 | 14 | 0/- | — |
| DoExplosions | H every call | Habitat.cs 6309-6339 | 31 | 31 | 0/- | — |
| HandleWeaponsFiring | H every call | Habitat.cs 2267-2348 | 82 | 147 | 0/Y | — |
| ResolveInvasionEmpires | H >10s | Habitat.cs 3229-3297 | 69 | 69 | 0/- | ported |
| CalculateSpaceControlStrengths | H >10s | Habitat.cs 4423-4426; BaconHabitat.cs 1162-1186 | 29 | 48 | 0/- | — |
| ProcessColonyTroops | H >10s | Habitat.cs 1643-1652 | 10 | 10 | 0/Y | ported |
| ResolveInvasionBattles | H >10s | Habitat.cs 3365-4315 | 951 | 2065 | 13/Y +clock×2 | — |
| AttackEnemyTargets | H >10s | Habitat.cs 2640-2684 | 45 | 119 | 0/Y | — |
| RegenerateDamage | H >60s | Habitat.cs 2485-2502 | 18 | 31 | 0/- | — |
| IndependentColoniesRecruitAndTrainTroops | H >60s | Habitat.cs 2914-2980 | 67 | 67 | 0/- | — |
| ClearTroopsAwaitingPickup | H >240s | Habitat.cs 2599-2613 | 15 | 15 | 0/- | — |

#### S. visibility/exploration/territory — 15 entry points, ~763 body lines, ~2,868 closure lines (d≤3, exclusive), 3 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ReviewEmpireTerritory | G-huge 240s | Galaxy.cs 3376-3382 | 7 | 7 | 0/- | ported (territory.ts) |
| ReviewEmpireTerritoryCore | G-huge 240s | Galaxy.cs 3384-3423 | 40 | 358 | 0/- | referenced / partial |
| UpdateSystemInfo | G-long 60s | Galaxy.1.cs 840-859 | 20 | 20 | 0/- | ported |
| IdentifyDisputedBases | G-long 60s | Galaxy.cs 3741-3780 | 40 | 97 | 0/- | ported |
| ClearExpiredViewableEmpires | E-regular 10s | Empire.2.cs 3918-3936 | 19 | 19 | 0/- | — |
| UpdateSystemExplorationStatus | E-intermediate 60s | Empire.2.cs 3880-3916 | 37 | 49 | 0/- | — |
| MergeGalaxyMapsForSharedVisibilityEmpires | E-long 120s | Empire.1.cs 1060-1070 | 11 | 11 | 0/Y | ported |
| MergeKnownPirateBasesForSharedVisibilityEmpires | E-long 120s | Empire.1.cs 1072-1090 | 19 | 19 | 0/- | — |
| ExertCulturalInfluence | E-long 120s | Empire.cs 4734-4872 | 139 | 139 | 1/Y | — |
| ScanArea | BO 3s | BuiltObject.1.cs 2034-2223 | 190 | 763 | 2/Y +clock×1 | — |
| ScanForLocations | BO 3s | BuiltObject.1.cs 1935-2032 | 98 | 98 | 0/- | — |
| ReviewSystemVisibilityForPreWarpShip | BO 60s | BuiltObject.cs 3855-3875 | 21 | 21 | 0/- | — |
| CheckForShipsDiscoveringRuins | H >3s | Habitat.cs 2504-2569 | 66 | 1195 | 0/Y | — |
| CheckForShipsOfNewEmpiresInSystem | H >10s | Habitat.cs 2615-2621 | 7 | 23 | 0/- | — |
| RecalculateColonyInfluenceRadius | H >240s | Habitat.cs 1066-1114 | 49 | 49 | 0/- | ported |

#### T. infrastructure (indexes, cleanup, rnd) — 6 entry points, ~174 body lines, ~724 closure lines (d≤3, exclusive), 0 direct Rnd sites

| method | block | C# | body | closure | Rnd d/t | TS |
|---|---|---|---:|---:|---|---|
| ReseedRandom | G-every | Galaxy.cs 3033-3037 | 5 | 5 | 0/- +clock×1 | referenced / partial |
| CleanupInvalidShipsInIndexes | G-huge 240s | Galaxy.cs 3782-3806 | 25 | 25 | 0/- | ported |
| ReviewEmpireDifficultyFactors | G-long 60s | Galaxy.cs 1452-1471 | 20 | 525 | 0/- | — |
| CalculateRelativeEmpireSize | E-periodic 30s | Empire.7.cs 4135-4162 | 28 | 28 | 0/- | — |
| CleanupInvalidShips | E-huge 240s | Empire.8.cs 2896-2972 | 77 | 77 | 0/Y +clock×3 | — |
| UpdateIndexesForMovement | BO every call | BuiltObject.2.cs 7163-7181 | 19 | 64 | 0/- | — |
### 2.4 Shared helpers (reached from ≥5 roots) — port once, early

~1,036 methods / ~42k lines, ~18k of which match ported names. The hubs that block many packages:

| helper | C# | lines | Rnd | reached from | TS |
|---|---|---:|---|---:|---|
| `Empire.SendMessageToEmpire` (5 overloads) + `EmpireMessage` | `Empire.7.cs:2916-2960`, `EmpireMessage.cs` (263) | ~300 | – | 93 roots | — → **M4a** (queue only; text via `ResolveDescription` stub) |
| `BuiltObject.ClearPreviousMissionRequirements` | `BuiltObject.1.cs:1356-1518` | 162 | – | 73 | throws TODO (`builtObject.ts:1224`) → **M4b** |
| `OrderList.GetOrders` (4 overloads) | `OrderList.cs:157-258` | 100 | – | 57 | — → **M4d** |
| `BuiltObject.AssignMission` (overloads) | `BuiltObject.2.cs:7555-7732` | 180 | – | 50 | — → **M4b** |
| `ShipGroup.AssignMission` (overloads) | `ShipGroup.cs:2028-2095+` | ~150 | – | many | — → **M4l** |
| `Galaxy.CheckTriggerEvent` | `Galaxy.9.cs:1270-1397` | 128 | – | 43 | referenced → **M4a** stub (no game events) |
| `DoCharacterEvent` | `Galaxy.1.cs:3781-5321` | 1,541 | 39 | 39 | ported for game-start events (`characters.ts`) — audit runtime event types in **M4u** |
| `BuiltObject.InflictDamage` / `Fighter.InflictDamage` | `BuiltObject.2.cs:6221-6782`, `Fighter.cs:1104-1570` | 562 + 467 | 17 | 34 | — → **M4o** |
| `Empire.TakeOwnershipOfBuiltObject` | `Empire.1.cs:524-897` | 374 | – | 29 | — → **M4q** (capture), stub earlier |
| `CompleteTeardown` (BuiltObject / Habitat / Empire) | `BuiltObject.2.cs:5171-5555`, `Habitat.cs:7613-8004`, `Empire.cs:4879-5295` | 385 + 392 + 417 | – | 47/36/23 | not ported (name hit is Creature's) → **M4o** (BO), **M4u** (habitat, empire) |
| `Habitat.ClearColony` | `Habitat.cs:7450-7611` | 162 | – | 23 | referenced → **M4q** |
| `EmpireCounters.ProcessBuiltObjectDestruction` | `EmpireCounters.cs:333-479` | 147 | – | 19 | — → **M4o** |
| `Galaxy.EvaluateThreats` / `EvaluateSystemThreats` / `DetermineThreatLevel` ×2 | `Galaxy.7.cs:3223-3423, 3506-3629, 3681-3813` | ~550 | – | 18 | TODO → **M4n** |
| `Empire.ChangeDiplomaticRelation` | `Empire.8.cs:2568-2822` | 255 | 1 | 12 | — → **M4r** |
| `CheckSendPreWarpProgressEventMessage` | `Empire.7.cs:3426-3834` | 409 | 7 | 19 | — → **M4u** |
| `DoCharacterEventChanceNewSkill` | `Galaxy.1.cs:5323-5730` | 408 | 2 | 18 | — → **M4u** |
| `Empire.DoResearchBreakthrough` | `Empire.3.cs:2500-2655` | 156 | – | 18 | — → **M4k** |
| `Galaxy.EliminatePirateFaction` | `Galaxy.8.cs:3026-3184` | 159 | – | 20 | — → **M4s** |
| `BaconBuiltObject.CollectScrapFromDestroyedBuiltObjects` | `BaconBuiltObject.cs:5160-5298` | 139 | – | 17 | — → **M4o** |
| `Galaxy.FastFindNearestRefuellingPointInIndex` | `Galaxy.6.cs:3309-3445` | 137 | – | 9 | — → **M4c** |
| `Galaxy.ResolveDescription` (enum → text, many overloads) | `Galaxy.1/2/3.cs` | ~3,000 | – | 71 | referenced → **M4a**: return enum names / GameText keys; full text in M9 |
| `ListHelper.ToArrayThreadSafe` | `ListHelper.cs` | trivial | – | 66 | array copy (`slice()`) — keep the copy: callers mutate while iterating |

Already-ported building blocks M4 reuses: `BuiltObject` model + `ReDefine` (`builtObject.ts`), designs
(`design*.ts`), `GalaxyIndex` ring searches and index grids (`galaxy.ts:282-300`), territory
(`territory.ts`), visibility (`visibility.ts`), taxes/approval (`taxes.ts`, `developmentLevel.ts`,
`raceBias.ts`), force-structure projections (`forceStructure*.ts`), resource targets (`resourceTargets.ts`),
stations (`stationPlacement.ts`), troops/garrisons (`troops.ts`), characters (`characters.ts`), diplomacy and
pirate-relation models (`diplomacy.ts`, `pirateRelations.ts`), independent traders + game-start ticks
(`independentTraders.ts`), market prices (`market.ts`), creatures (`creature.ts`), cargo/population
(`cargo.ts`, `population.ts`), research tree (`researchSystem.ts`).

---------------------------------------------------------------------------------------------------

## 3. Work packages

### 3.1 Ground rules (so packages can run in parallel)

1. **M4a owns the tick skeletons.** The DoTasks bodies (`tick/*.ts`) are written once by M4a, in C#
   order, and call one named entry point per C# call. For every entry point, M4a creates the owning
   package's module with a stub (`export function reviewTaxes(empire: Empire): void { /* TODO(port) M4j */ }`)
   and the agreed signature. Packages only replace bodies in **their own files**; nobody else edits the
   skeletons. If a package needs a new cross-package entry point, it adds a stub to the *owner's* file
   in a separate one-line commit (or asks the orchestrator).
2. **Free functions, C# `this` first** — the `diplomacy.ts` convention. No new methods on `Empire`,
   `Galaxy`, `BuiltObject`, `Habitat`.
3. **Field sections.** M4a adds to `empire.ts`, `galaxy.ts`, `builtObject.ts`, `types.ts` (Habitat) one
   comment-delimited block per package (`// ---- M4d fields (Order/Contract) ----`). A package adds its
   fields only inside its block, so merges are append-only and conflict-free.
4. **Stubs keep the tick running.** Unported callees are no-ops that do *not* draw Rnd; when the C# would
   draw, add `// RND: <site> not drawn until <package>` so the seed-pin churn is expected.
5. Every package: cite C# `file:line` above each ported function, keep `TODO(port)` notes, run
   `npm run typecheck` + `npm test`, re-pin seeds it moves (see §5), and list the pins it changed in its
   report.

### 3.2 File layout in `src/sim/`

```
tick/            M4a  simTime.ts scheduler.ts galaxyTick.ts empireTick.ts pirateTick.ts
                      builtObjectTick.ts habitatTick.ts harness.ts digest.ts
messages.ts      M4a  EmpireMessage, SendMessageToEmpire*, message queue (UI reads it later)
missions/        M4b  mission.ts (BuiltObjectMission, Command, enums) assign.ts (AssignMission,
                      ClearPreviousMissionRequirements) executeCommands.ts (loop + dispatch table)
                 M4c  cmdMovement.ts        M4e cmdDocking.ts      M4h cmdConstruction.ts
                 M4g  cmdExtract.ts         M4n cmdAttack.ts       M4f cmdReassign.ts
                 M4m  cmdMilitary.ts (Blockade/Escort/Patrol/HoldSync)   M4q cmdTroops.ts (Deploy/Colonize-invade)
movement.ts      M4c  DoMovement, hyperjump, gravity wells, fuel ranges, energy, index upkeep
logistics/       M4d  orders.ts contracts.ts freight.ts colonySupply.ts
                 M4e  docking.ts refuel.ts
civilianAI.ts    M4f  AssignMissionToBuiltObject + exploration/migration/tourism
industry.ts      M4g  extraction, IndustrialProcessing, ManufacturingQueue
construction/    M4h  constructionQueue.ts constructionYard.ts retrofit.ts repair.ts
                 M4i  empireConstruction.ts facilities.ts wonders.ts
colonyTick.ts    M4j  growth, happiness, migration factor, terraforming, damage regen
treasury.ts      M4j  money flow, maintenance, government, ability bonuses
researchTick.ts  M4k
fleets/          M4l  shipGroup.ts shipGroupTick.ts        M4m militaryAI.ts
combat/          M4n  threats.ts attackAI.ts   M4o weapons.ts damage.ts teardown.ts
                 M4p  fighters.ts               M4q invasion.ts boarding.ts troopsRuntime.ts
diplomacyTick.ts M4r  (+ tradeItems.ts)
pirates/         M4s  missionsMarket.ts (EmpireActivity) pirateAI.ts pirateGalaxyTick.ts
exploration.ts   M4t  ScanArea, ScanForLocations, ruins discovery, encounters, territory scheduling
events.ts        M4u  random/empire events, plague, rebellion (CheckHabitatIsEmpire), storms,
                      creature combat hooks, character runtime reviews
```

### 3.3 Packages

Sizes are C# lines to port (roots + attributed closure from §2.3, minus what is already ported).

| id | package | C# scope (file:line) | size | Rnd | depends on |
|---|---|---|---:|---|---|
| **M4a** | **Tick core, scheduler, harness, messages** | `Main.Part12.cs:4121-4230, 3517-3743` (ProgramLoop, method_86 budgets/cursors), `Main.Part11.cs:507-610` (in-view LOD, as an optional `view` input), `Galaxy.cs:3039-3137` (DoTasks, TimeSensitive, ResetLastTouchTimes), `Empire.1.cs:3427-3728, 4095-4273`, `BuiltObject.cs:3609-3853`, `Habitat.cs:1399-1556`, `ShipGroup.cs:97-122`; time model (§1.7); `EmpireMessage.cs`, `Empire.7.cs:2916-2960`; `ResolveDescription` stub; stubs + field sections for every package; replace `galaxy.step` (`galaxy.ts:260`) and the game-start stand-ins (`empireDoTasksStandIn`, `galaxyGameStart*Tick`) with calls to the real ticks; `runGameSeconds` + `stateDigest` | ~1,200 | none new; re-pin all | — |
| **M4b** | Missions & command dispatcher | `BuiltObjectMission.cs` (1,033), `Command.cs` (324), `BuiltObjectMissionType.cs`, `CommandAction`, `BuiltObject.2.cs:7555-7732` AssignMission, `BuiltObject.1.cs:1356-1518` ClearPreviousMissionRequirements, `BuiltObject.2.cs:399-539 + 4352-4579` (loop frame, Deploy/Undeploy/Repeat/SetParent/ClearParent/ClearAttackers, EvaluateThreats/ScanArea/Hold cases), distress signals (`Empire.3.cs:4898-5020`, `Empire.2.cs:3985-4002`), `ClearExpiredDeclinedTasks` | ~2,300 | few | a |
| **M4c** | Movement, hyperjump, fuel, energy, index upkeep | cases MoveTo 3596, SprintTo 3627, ImpulseTo 3224, HyperTo 3020, ConditionalHyperTo 2928, HoldSyncFleet 1159 (`BuiltObject.2.cs`); `DoMovement` 6851, `AccelerateToTargetSpeed` 7334, `GetCurrentTurnRate` 7372, `CalculateCurrentHeading` 7433, `ConsumeFuel` 7131, `UpdateIndexesForMovement` 7163, `PerformEnergyCollection` 7765; `BuiltObject.1.cs:1737-1850` (hyper deny, gravity wells), 2326-2524 (fuel ranges, `RechargeReactors`); `DoDeployment` `BuiltObject.cs:3473`; `BaconBuiltObject` `UpdatePosition` 4329, `ExitHyperjump` 4627, `CheckHyperjumpPending` 2539, stargates 4433; `Galaxy.6.cs:3309` refuelling-point search; Empire `EvaluateSystemLinks` (`Empire.9.cs:3273`), `UpdateSystemFuelSourceStatus`/`RefuellingStatus` (`Empire.2.cs:3784-3878`), `CheckForStrandedShips`; `ReviewWhetherRefuellingDepot` | ~2,600 | 1-2 | b |
| **M4d** | Orders, contracts, freight assignment, colony consumption | `Order.cs`, `OrderList.cs`, `Contract*.cs`; `Galaxy.cs:1703-1773` (CheckAndOrderResource, CreateOrder), `Galaxy.1.cs:1068-1158`; `Empire.4.cs:337-823` (FindFreighterToFulfillOrder, smuggling, **CheckMarketOrders**), 1135-1526 (InitiateContract, FreighterFulfillOrders, FindFreighterForContract); `Habitat.cs:2758-2816, 7293-7310` (ConsumeResources, ConsumeAndOrderStrategicResourceSupply); `MaintainBaseResourceLevels` (`Empire.1.cs:4275`), `MaintainIndependentColonyFuelLevels` (`Galaxy.cs:1682`), `ReviewRestrictedResourceTrading`, `ProcessTradeBonuses`, `CheckForUnownedCargo` (BO + Habitat); generalise `market.ts` `MarketOrder` and `independentTraders.ts` `GalaxyOrder/GalaxyContract` | ~2,600 | 2 | a (calls M4b AssignMission via stub) |
| **M4e** | Docking & cargo commands, refuelling | cases Dock 2731, Undock 3642, Load 3232, Unload 3698, Refuel 4226 (`BuiltObject.2.cs`); `CheckClearDocking` (`BuiltObject.1.cs:1275-1354`), `CheckForShipsNoLongerDocking` (BO 3903, Habitat 2464), `Galaxy.cs:3540` wait queue, `DetectShipsDocking*` (`BuiltObject.1.cs:5347-5381`); `CheckForRefuelling` (`BuiltObject.cs:4940`), `SetupRefuelling` 4774, `CheckForFuelOrdering` 4697, `AutoRefuelRepairShip` (`BuiltObject.2.cs:4706`), refuel data 7029-7130 | ~2,300 | 0 | b, c, d |
| **M4f** | Civilian mission AI (private sector) | `Empire.5.cs:1361-2801` **AssignMissionToBuiltObject** (1,432 lines, 22 Rnd), `Empire.4.cs:4796-4861` AssignShipMissions, `Empire.5.cs:2859-3272` (resort/migration/tourism missions, destinations), `ReviewMigrationTourism` 3128; `Galaxy.6.cs:4152` FindNextHabitatToExplore, 4360 FastFindNearestUnexploredHabitat; case ReassignMission 3999; `DirectPrivateConstruction` (`Empire.6.cs:741`); replace `builtObjectPlacement.ts:245` no-op | ~3,500 | ~30 | b, c, d (e for freighters to be useful) |
| **M4g** | Resource extraction & industry | case ExtractResources 1227; `Habitat.ExtractResources` 2827; `BuiltObject.IndustrialProcessing` (`BuiltObject.2.cs:7805-8129`); `ManufacturingQueue.cs` (415); `ReviewManufacturedResources` (`Habitat.cs:1899`); `PrioritizeEmpireResourceNeeds` (`Empire.2.cs:4023-4170`) | ~1,300 | 3 | b, d |
| **M4h** | Construction queues & shipyards | `ConstructionQueue.cs` (1,411; `ProcessSingleConstructionYard` 286-1125), `ConstructionYard*.cs`, `BaconConstructionQueue.cs:45-257` (ReviewConstructionSpeed); cases Build 1444, Scrap 1311, Retrofit 704, Repair 620; `ReviewRetrofitConstructionQueue` (`BuiltObject.2.cs:6023`), `DoRepairs` (`BaconBuiltObject.cs:4763`), `CheckWhetherStillBeingBuilt`, `CheckRepairMissionStillValid`, `CheckForRepairs`; new ships join the galaxy (index, empire lists) | ~3,000 | 1 | b, d |
| **M4i** | Empire construction & facilities AI | `Empire.6.cs:2373-2902` DirectConstruction, 587-716 RetireOldBuiltObjects, `Empire.10.cs:3065` ReviewLatestDesigns, 1211-1375 BuildDefensiveBases, `Empire.5.cs:3769` DetermineMonitoringStationLocation, `Empire.1.cs:3403` ReviewDesignsAndRetrofit + `Empire.5.cs:126` AssignRetrofitMission, `Empire.6.cs:498` AssignScrapMission, `Empire.1.cs:4002` CheckBuildoutResearchCapacity; facilities: `Empire.3.cs:104-816` (wonders, facilities), `Habitat.cs:2039` ConstructFacilities, `Galaxy.5.cs:334` ReviewWondersBuilt | ~3,000 | ~5 | h |
| **M4j** | Colony growth, happiness, treasury, government | Habitat: `GrowPopulation` 5172, `CheckSatisfaction` 5992, `CalculateMigrationFactor` 1162, `UpdateConqueredFactor` 1599, `CalculateWarWithOurRace` 5694, `TerraformColony` (`BaconHabitat.cs:243`), `RegenerateDamage` 2485; Empire: money block `Empire.1.cs:3579-3603`, `ProcessSubjugationTribute` 996, `EvaluateColonyVariables` (`Empire.4.cs:2943-3307`), `ReviewColonyPopulationPolicy` (`Empire.2.cs:3198`), `Pay*` (`Empire.4.cs:1743`, `Empire.2.cs:4004-4015`), `ReviewGovernmentEffects`/`CheckChangeGovernment` (`Empire.10.cs:55-156`), `ReviewEmpireAbilityBonuses` (`Empire.cs:2891-3066`), `ReviewSpecialBonusesRuinsWonders` (`Empire.3.cs:939`), `ReviewRacePeriodicChanges` (`Galaxy.cs:3425`), `ReviewColonyFillFactor`, `EmpireCounters.cs` revenue parts; `BaconHabitat.HugeProcessingSpanActions` economy parts (market cash/prices, infrastructure decay) | ~3,000 | 2 + clock | a |
| **M4k** | Research progress | `Empire.3.cs:1756` PerformResearch → `ResearchSystem.cs` progress parts, `DoResearchBreakthrough` 2495-2655, `DoResearchAbilityBreakthrough` 2069, `DoCrashResearch` 3093, `ReviewResearchStationBonuses` 2732, `ReviewDesignComponentsAvailable` (ported) | ~2,200 | 3-5 | a |
| **M4l** | ShipGroup model & fleet tick | `ShipGroup.cs` (3,578: DoTasks subroutines, AssignMission overloads, refuel/repair/attack checks, lead ship, fuel range), `ShipGroupList.cs`; `UpdateFleetLeadShips`, `ReviewFleetPostures`, `MaintainShipGroups` (`Empire.9.cs:2454-2730`), `PerformFleetTasks` (`BuiltObject.cs:3503`), `ReviewFleetBonuses`, `Galaxy.ProcessPirateFleets` | ~4,000 | ~5 | b, c |
| **M4m** | Military AI | `Empire.8.cs:4266-4355` IdentifyMilitaryObjectives + 4845-5143 ForSingleEmpire, `Empire.9.cs:4163` ReviewSystemThreats, 1162 TaskShipGroups, 52 TaskResupplyShips, 3704 IdentifyEmpireStrikePoints, 1747 ResolveLocationsToDefend (ported); `Empire.1.cs:3198` RespondToIncoming…, `Empire.10.cs:913` CheckTemptingTargets, `Empire.5.cs:1007` SendAvailableFleetsToGuard, `Empire.2.cs:4512` DetermineRandomAttacks, 3938 CancelInactiveBlockades, `Empire.8.cs:3335-4710` AssignFleet*Mission; cases Blockade 540, Escort 804; `Empire.6.cs:1776` Warn… (UI) | ~3,500 | ~8 | l, n |
| **M4n** | Threat evaluation & ship attack AI | `BuiltObject.1.cs:208-388` (PerformThreatEvaluation/ThreatEvaluation), `BaconBuiltObject.cs:4863` IdentifySystemThreatsToUs, `Galaxy.7.cs:3223-3813` threat functions, `BuiltObject.1.cs:951` ShouldAttack, 1185 CheckForAttack, 642 FleeFromHopelessBattle, 1852 CheckForRandomAttackTargets, `BuiltObject.2.cs:197-307` attack range; attack/bombard/capture/raid case 1698-2730; `BaconBuiltObject.CheckNearTarget` 2578 | ~3,200 | ~5 | b, c |
| **M4o** | Weapons, damage, destruction | `BuiltObject.1.cs:3737-4472` HandleWeaponsFiring, `Habitat.cs:2267` HandleWeaponsFiring + `AttackEnemyTargets` 2640, `BuiltObject.2.cs:6216-6782` InflictDamage, shields (`RechargeShields`, area recharge `BuiltObject.cs:1930-2004`), explosions (`BuiltObject.1.cs:14`, `Habitat.cs:6309-6377`), `BuiltObject.cs:4191-4695` defensive fire, `BaconBuiltObject.InterceptMissiles` 5032, `ReviewDisabledComponents`, `CheckSelfDestruct`, BO `CompleteTeardown` 5171, `EmpireCounters.ProcessBuiltObjectDestruction`, `SpaceBattleStats.cs`, `ModifyDiplomacyFromAttack` (`BuiltObject.1.cs:4721`), scrap collection | ~4,000 | ~30 | n |
| **M4p** | Fighters | `Fighter.cs` (2,124), `FighterList`, `BaconFighter.cs` (DoTasks 155, evaluate threats 283-456, bomber fire 656); carrier side: `LaunchAllFighters`, `BuildNewFighters`/`ManufactureRepairFighters`/`CheckFightersNeedUpgrading` (`BaconBuiltObject.cs:3151-5334`), `FireAtNearbyFighters` | ~3,000 | ~10 + clock | o |
| **M4q** | Ground invasion, troops, boarding, capture | `Habitat.cs:3229-4426` (ResolveInvasionEmpires ported, ResolveInvasionBattles 951 lines, space-control strengths + `BaconHabitat.cs:1162`), `ColonyInvasion.cs`, `BuiltObject.1.cs:2954-3312` ProcessBoardingAssault, 2626 assault pods, 2905 FireAtAssaultPods, `BaconBuiltObject.ResetAssaultPods`; troops: `RecruitAttackTroops` (`Empire.4.cs:3908`), `DisbandExcessTroops` 1627, `IndependentColoniesRecruitAndTrainTroops` (`Habitat.cs:2914`), `HealTroops`, `ClearTroopsAwaitingPickup`, load/unload-troops missions (`Empire.5.cs:727-907`, `ShipGroup.LoadTroopsIfNecessaryAndPossible`), `Empire.1.cs:524` TakeOwnershipOfBuiltObject, `Habitat.ScanForNewOwner`, `BuiltObject.1.cs:65-206` ScanForNewOwner, `Habitat.ClearColony` | ~4,000 | ~20 | o, e |
| **M4r** | Diplomacy runtime | `Empire.3.cs:4240-4848` ProcessMessages, 3606-3924 ConsiderTreatyProposals, `Empire.8.cs:1905-2305` EvaluatePoliticalSituation, 66-479 ReviewDiplomaticStrategies, 742 ReviewDiplomaticSituations (→ ~800 closure), 1875 ClearInvalidDiplomaticRelations, 2568 ChangeDiplomaticRelation, 1014 PrepareFleetsForWar; `Empire.7.cs:1779` EvaluateTradeOffer, 2411-2664 TradeItems & offers, 2060 ReviewEnemyHelpEnlistment, 2205 ReviewDisputedTerritory; `Galaxy.4.cs:3857-4470` tradeable items; `Empire.1.cs:3322` RemoveDefeatedEmpireRelations, 3961 ReviewEmpireEndsAllWars; `CalculateRelativeEmpireSize` | ~5,000 (large; split r1 politics / r2 messages+trade if needed) | ~20 | a (b for fleet side effects via stubs) |
| **M4s** | Pirates runtime | **s1 marketplace**: `EmpireActivity*.cs`, `Galaxy.9.cs:527` ReviewPirateMissionsAndAssign, `Galaxy.cs:3203-3276` independent offers, `Empire.2.cs:1138-2146` Make*Offers / PirateCheck*, `Empire.4.cs:1543` CompletePirateMission, `Empire.2.cs:1313-1424` Review*Missions, `Empire.2.cs:2401` ReviewPirateRelations. **s2 faction AI**: `Empire.1.cs:4385-5505` PirateAssignShipMission(s) (1,081), `Empire.9.cs:904` PirateTaskFleets, `Empire.2.cs:219-1136` PirateDoConstruction/PirateProjectForces, 2510 PirateReviewEmpireRelations, 2895 PirateCollectIncome, `Empire.1.cs:4333-4383`, `Empire.7.cs:2180, 2666`, `Empire.4.cs:2399, 2579`, `BaconEmpire.cs:1099-1542`, `BaconHabitat.cs:1388` ReviewPirateControl, galaxy pirate steps `Galaxy.8.cs:2774-3486` (terminate/merge/eliminate/activities), `Empire.1.cs:4065` CheckSendPirateRaid, raid countdowns | s1 ~2,000, s2 ~4,000 | ~20 + clock | s1: a, b; s2: l, n, s1, h |
| **M4t** | Visibility, exploration, territory runtime | `BuiltObject.1.cs:2034` ScanArea, 1935 ScanForLocations, `Habitat.cs:2504` CheckForShipsDiscoveringRuins (→ ruins discovery, ~1.2k closure, partly in `ruins.ts`), 2615 CheckForShipsOfNewEmpiresInSystem, `Galaxy.7.cs:3957` DoEmpireEncounter, `BuiltObject.cs:3855` pre-warp visibility, `Empire.2.cs:3880` UpdateSystemExplorationStatus, 3918 ClearExpiredViewableEmpires, `Empire.1.cs:979-1090` known pirate bases / map merges, `Empire.cs:4734` ExertCulturalInfluence, territory scheduling (`Galaxy.cs:3376-3423` synchronous), `UpdateSystemInfo` | ~2,500 | ~3 | a |
| **M4u** | Events, disasters, character runtime, creature combat | `Empire.1.cs:1731-2881` (random/race/empire events, pirate random events), `Empire.7.cs:3408-3834` special pirate / pre-warp events, `Habitat.cs:1678` ProcessPlague, 5230 CheckHabitatIsEmpire (rebellion, new empires), 1619 SpawnCreatures, `DoPlanetRemove` + Habitat/Empire `CompleteTeardown`; BO storms `BuiltObject.cs:3448, 3934` (Do/ApplyLocationEffects); galaxy `DoGalaxyEvents` (super pirates → existing `pirates.ts`), `ClearEmptyDebrisFields`; characters: `ProcessCharacters`/`Character.DoTasks`, `Empire.6.cs:3990-5135` appearance/leader change, `Empire.7.cs:16-363` trait/location reviews (mostly ported), `Galaxy.2.cs:4784` governor promotion, runtime `DoCharacterEvent` types; creature combat `Creature.cs:1196-1345`; stubs that throw for story/game events/espionage | ~4,000 | ~40 | o (combat hooks), j |

Deferred (not M4): espionage (`Empire.5.cs:4183-6110`, `Empire.6.cs:21-343`), story events,
`ExecuteEventAction` game events, achievements/victory/Steam, planet destroyer and super-pirate runtime
beyond the existing generation code, Bacon player-only features (prisoners UI, custom bombers).

### 3.4 Order and parallelism

```
wave 0 (1 agent)      M4a
wave 1 (6 parallel)   M4b  M4d  M4j  M4k  M4r  M4t          (disjoint files; d uses AssignMission stub)
wave 2 (5 parallel)   M4c  M4g  M4h  M4n  M4s1              (need b)
wave 3 (6 parallel)   M4e  M4l  M4i  M4o  M4f*  M4u*        (e: c,d; l: b,c; i: h; o: n)
wave 4 (4 parallel)   M4m  M4p  M4q  M4s2                   (m: l,n; p: o; q: o,e; s2: l,n,s1,h)
```
`*` M4f can start in wave 3 against M4e's stubs; freighters only become useful once M4e lands.
M4u can start any time after M4a for the non-combat parts; its creature-combat and teardown parts wait for M4o.

Milestone checkpoints (headless harness, §5): after wave 1 — colonies grow, money flows, research
completes, diplomacy evolves on a galaxy with parked ships; after wave 3 — ships move, trade, mine, build and
explore; after wave 4 — wars, fleets, pirates, invasions.

---------------------------------------------------------------------------------------------------

## 4. Performance notes (faithful first, optimise later)

What the C# already does to scale — keep these, they change behaviour if removed:

- **Round-robin staggering** (§1.1): ≤1000 habitats, ≤1000 ships, 50 creatures per frame; one empire per
  10 frames; Galaxy every 100 frames. Per-object ticks compute `dt` from their own `_LastTouch`, so a
  big galaxy just means coarser dt, not more work per frame. `ExecuteCommands` is capped at 50 iterations
  per tick (`BuiltObject.cs:3697`, `Galaxy.7.cs:569`).
- **Spatial index grids**: `IndexSize = 400,000` (`Galaxy.3.cs:4965`), `SectorSize = 2,000,000`,
  `MaxSolarSystemSize = 23,000`. `BuiltObjectIndex[x][y]` is refreshed on every ship tick
  (`UpdateIndexesForMovement`, `BuiltObject.2.cs:7163`); neighbour queries are
  `GetBuiltObjectsAtLocation`/`GetHabitatsAtLocation` (`Galaxy.5.cs:3117, 3166`: own cell + up to 3
  adjacent cells by nearest edge). Habitat/system grids + ring search are already ported (`galaxy.ts:282`).
- **Per-empire, per-system threat cache**: ships in a system reuse
  `Empire.SystemVisibility[sys].Threats`, recomputed at most every 5 s (`BuiltObject.1.cs:225-233`);
  ships outside systems call `Galaxy.EvaluateThreats` themselves. `_Threats` is a fixed 20-slot array.
  This is the main thing keeping combat below O(n²) — port it exactly.
- Territory is a 2,000-unit grid rebuilt every 240 s (and systems-only every 60 s) off-thread in C#
  (`Galaxy.cs:3376`). TS: run synchronously inside the Galaxy tick (determinism); `territory.ts` already
  has the incremental `ReviewEmpireTerritoryUpdate`.

Hot spots to watch with thousands of ships (measure with the harness before optimising):

1. **Crowded index cells** — a 400k cell around a home system can hold hundreds of ships/bases.
   `DefendBase`, `FireAtNearbyFighters`, `FireTractorBeams…`, `CheckForRandomAttackTargets`
   (`BuiltObject.1.cs:1863`), weapons target search (`BuiltObject.1.cs:4242, 4357`), habitat destruction
   area damage (3564) scan the whole cell per ship ⇒ O(k²) per cell per 3 s. Later: sub-cell buckets,
   *but iteration order decides target choice and Rnd order*, so any replacement must reproduce C# `List`
   order (insertion order, `Remove` keeps order).
2. **Empire-wide scans in the periodic/long blocks**: `AssignShipMissions` walks all ships every 30 s and
   calls `AssignMissionToBuiltObject` for idle ones (each does nearest-X ring searches);
   `CheckMarketOrders` × `FindFreighterToFulfillOrder` is O(orders × freighters); `DirectConstruction`,
   `MaintainShipGroups`, `IdentifyMilitaryObjectivesForSingleEmpire` (all empires × all colonies/bases).
   These run once per empire per interval, so they're O(E·n) per interval, not per frame — fine at first.
3. **Galaxy-wide loops inside per-object code**: `Habitat.CompleteTeardown` loops all BuiltObjects and
   Creatures (`Habitat.cs:7618-7700`); `Creature.cs:957` loops all BuiltObjects; `Galaxy.BuiltObjects.Contains/
   Remove` on teardown. Rare events — keep naive.
4. **`List.Contains` in the scheduler**: `method_86` checks `builtObjectList_1.Contains` /
   `builtObjectList.Contains` for up to 1000 candidates (`Main.Part12.cs:3655, 3674`) — use a `Set` in TS;
   order-neutral.
5. **Allocation churn**: C# allocates new `BuiltObjectList`/`HabitatList` in almost every helper. In TS keep
   it simple first; reuse scratch arrays only in measured hot paths.
6. **Numeric faithfulness costs**: `Math.fround` on float fields, int truncation — cheap, keep them.
7. **Web Workers later**: only pure computations (territory grid rebuild, threat evaluation snapshots) can
   move off-thread without breaking determinism; the tick itself stays single-threaded.

Targets for the harness (to track, not gate): 700-star galaxy, 10 empires, game-start ships → ~2 ms/frame
of sim at wave 1, <8 ms/frame at wave 4 with ~3,000 ships.

---------------------------------------------------------------------------------------------------

## 5. Testing strategy

### 5.1 Determinism contract (see §0)

- Same `(seed, options, speed schedule, view schedule)` ⇒ bit-identical state. Tests always run with
  **no view** (no in-view LOD) and a fixed frame length.
- Fixed-step scheduler: one sim frame = `FRAME_REAL_MS (1000/60) × timeSpeed` game-ms, quantised to
  integer ms with a carried remainder. The renderer accumulates real time and runs whole sim frames
  (cap ~4 per render frame), so results don't depend on the display refresh rate.
- Deferred work order within a frame: the C# enqueues Galaxy/Empire ticks to worker threads; TS runs them
  **at the end of the frame, in enqueue order** (Galaxy first when both fire). Document this in
  `scheduler.ts`; it's the one ordering choice the C# doesn't define.
- No clock seeds anywhere under `src/sim` (a test greps for `Date.now`/`performance.now`/`Math.random`
  in `src/sim/**`).

### 5.2 Headless harness (M4a)

- `src/sim/tick/harness.ts`:
  `runGameSeconds(game, seconds, { frameMs?, onFrame?, stopOnTodo? }) → { frames, rndDraws, timings }`
  runs the real scheduler with no renderer.
- `stateDigest(game)`: stable hash over galaxy time, `rnd` internal state (`random.ts` seed array + indices),
  and per-empire/per-colony/per-ship key fields (position as float64 bits, money, population, cargo,
  mission type, touch times), iterated in C# list order.
- `scripts/sim-run.mjs --seed 1 --stars 700 --empires 10 --seconds 600 [--profile]` — prints digest,
  entity counts, Rnd draws, and ms per subsystem (wrap each tick entry point with an optional timer).
- `random.ts`: add an opt-in draw counter and trace hook (`galaxy.rnd.trace = (site) => …`) to diff two
  runs quickly when determinism breaks.
- TODO(port) throws: harness option `stopOnTodo: true` in CI (a stub reached in a test galaxy fails the
  test); `false` in soak runs (count and report them).

### 5.3 Test layers

1. **Unit tests per ported method** (as today): tiny hand-built galaxies, check C# int/float semantics,
   interval edges (`>=` vs `>`), and Rnd draw counts per call.
2. **Tick-structure tests (M4a)**: with every subsystem stubbed, check that for a scripted clock each block
   fires at the right times (Empire 3/10/30/60/120/240 s with `>=`, Habitat strict `>`, BO first-call
   back-dating, Galaxy long/huge), round-robin cursors wrap as in `method_86`, and the in-battle loop stays a no-op.
3. **Determinism tests**: `createGame(seed 1)`, run 120 game-s twice → identical digest; run 60 + 60 vs
   120 in one call → identical (no hidden dependence on call granularity).
4. **Seed pins**: `test/golden/m4-seed1.json` holds `{digest, counts, rndDraws}` after 0 / 60 / 600 game-s
   for 2-3 small configs. Every package regenerates the goldens with a script, and its report says why the
   pins moved (expected: every package that ports a Rnd-drawing site). Keep the existing game-start pins
   (`test/game.test.ts`, `startingColonies`, `pirates`, …) but move them onto the real ticks in M4a.
5. **Invariant tests (run after every harness test)**: no NaN/∞ positions, fuel, energy or money; every
   live ship is in exactly the index cell for its position; empire ↔ colony ↔ ship back-references agree;
   no destroyed object in live lists after teardown; populations ≥ 0; orders reference live objects.
6. **Behaviour smoke tests per wave**: after 600 game-s on seed 1, colonies have grown, state money
   changed, at least one research project finished (wave 1); ships moved, a freighter delivered cargo, a
   new ship was built, a system was explored (wave 3); after longer runs, a fleet fought, a pirate mission
   was accepted (wave 4). Assert trends, not exact values; exact values live in the goldens.
7. **Soak / perf (opt-in, `SIM_SOAK=1`)**: 1,400 stars, 20 empires, 30 game-minutes; report ms/frame
   and TODO hits; no CI gate.

There is no way to run the C# headlessly (WinForms app, threads, clock seeds), so parity is checked by
review against the source, statement by statement, plus the unit tests above — not by comparing streams.

---------------------------------------------------------------------------------------------------

## 6. Risks / open questions

- **Independent empire**: `Galaxy.IndependentEmpire` is not ticked by the frame loop (only its methods
  called from the Galaxy long block). Check that `createGame` keeps it out of `galaxy.empires`.
- **View LOD in the real app**: to stay reproducible, the app can feed the camera as a scheduler input
  (faithful), or tick everything as "not in view" (simpler; changes feel slightly: in-view ships update
  every frame in C#). Recommend: faithful, behind a flag, default on in the app, off in tests.
- **`ResolveDescription` text** is needed for messages only; M4a returns keys, M9 localises.
- **ExecuteCommands dispatcher**: cases share locals and fall through (`goto case HyperTo/MoveTo`,
  `BuiltObject.2.cs:2966, 3002`). M4b must define the per-case function signature (bo, galaxy,
  timeRemaining, time, starDate) → remaining time, and keep the shared prologue/epilogue
  (399-539, 4487-4579) in the dispatcher.
- **Game-start re-pin**: M4a replaces the stand-ins (`empireDoTasksStandIn`, `galaxyGameStart*Tick`,
  `assignMissionsToBuiltObjectList` no-op, capital `Habitat.DoTasks`) with the real skeletons (stubs
  inside). That moves Rnd-dependent pins once, up front; later packages move them again. Coordinate with the
  agent currently editing `src/`/`test/` before starting M4a.
- Bacon mod calls through `BaconBuiltObject.myMain` (UI `Main`) for game settings (e.g. `BaconEmpire.cs:1101`
  skips the player). The TS needs a `game.settings` handle on `Galaxy` for these.
