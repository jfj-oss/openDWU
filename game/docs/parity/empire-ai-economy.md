# Empire AI & economy parity (Empire*.cs and related)

Read-only audit: C# Empire.cs + Empire.1-10.cs, EmpirePolicy, DiplomaticRelation, EmpireEvaluation, Character, Race, IntelligenceMission, EmpireCounters, GovernmentAttributes, EmpireTerritory, TradeableItem(List), ResearchSystem, EmpireStart(List), compared with `game/src`.

**Status (parity batch D4, 2026-10-03):** the Status column was re-checked against the branch. FIXED rows name the commit; D4 rows are in that batch's commits. What is left is UI, mod-only or out of scope.

**Bottom line:** the empire-level port is close to complete at the method level. No whole subsystem is missing. `tick/empireTick.ts` matches C# `Empire.1.cs DoTasks` (3427-3728) call by call, in order. Of ~950 Empire*.cs methods, 93 names never appear in our code; ~85 of those are never called in 1.9.5 either, or are UI/save-load only. Every EmpirePolicy field is read in at least two sim files.

## Ranked gaps

| # | Feature | C# source | Status | Our location | Impact | Notes |
|---|---|---|---|---|---|---|
| 1 | Built wonders count toward scenic/tourism value | Habitat.cs CalculateScenicFactorIncludingRuinsWonders | FIXED (f76485a) | sim/civilianAI.ts:364 | Med-High | Stale TODO says wonders don't exist; construction/wonders.ts builds them. Wrong tourism destinations (Empire.5.cs 2820), resort siting (Empire.5.cs 3165/3188/3221) and resort income (BuiltObject.2.cs 4889) |
| 2 | Enemy warship check before placing a spaceport | Empire.6.cs 3165 CheckSystemEnemyShipLevel (DetermineNewSpacePortLocations 3296/3318) | FIXED (f490e42) | sim/stationPlacement.ts:411 | Med | AI builds spaceports in contested systems; `systemVisibility[i].threats` exists (resourceTargets.ts:288) |
| 3 | Race-achievement wonder research limited to its race | Galaxy.3.cs ~2015-2045 (BuildWonder → project AllowedRaces) | FIXED (c011117) | sim/researchSystem.ts:165 | Med | Gizurean, Shandar, Zenox, Wekkarus wonders probably researchable by all races |
| 4 | Race periodic personality swings | Race.cs 320-400 ChangePeriodActive; Galaxy.cs 3438-3473 | FIXED (8f3b492, 10b4bc8) | accessors in colonyTick.ts:139-170 | Med | ~20 sites read raw values: researchTick.ts:1022-1033/1531, civilianAI.ts:2327, tradeItems.ts:620, taxes.ts:198/486, resourceTargets.ts:355, combat/threats.ts:1238, troops.ts:163, designGeneration.ts:106/624, empireEvents.ts:624; empireConstruction.ts:215 hardcodes StrengthInNumbers maintenance bonus to 0. Affects Dhayut, Gizurean, Securan |
| 5 | Fleet retrofit mission carries the target design | Empire.9.cs AssignFleetRetrofit | FIXED (840902b) | construction/empireConstruction.ts:939 | Med-Low | Design parameter dropped |
| 6 | Player prompt for semi-automated restricted-resource trading | Empire.8.cs 4395 CheckTaskAuthorized | FIXED (5ff63c8) | logistics/orders.ts:719 | Low-Med | Use the full diplomacyTick.ts:385 version |
| 7 | Player toggle for restricted-resource trading | DiplomaticRelation.SupplyRestrictedResources | FIXED (D4: setSupplyRestrictedResources op) | ui/screens/diplomacyScreen.ts:1186 | Med (player) | Sim side ported |
| 8 | Pirate "Buy information" | Main.Part9.cs:207, Empire.5.cs GenerateSaleableInfoForEmpire | FIXED (D4: PIRATE_BUYINFO) | player/diplomacyProposals.ts:31 | Low-Med | Sim function ported; never offered |
| 9 | Empire Policy design pickers and default automation options | Main.Part3.cs 4710-4716 | OPEN (UI) | ui/screens/empirePolicyModel.ts:72/499/862 | Low-Med | Pickers read-only |
| 10 | AI SubjugateRequest to the player | Empire.8.cs 1527 | OPEN (advisor brief; AI-to-AI ported) | player/diplomatBrief.ts:236 | Low | AI-to-AI works |
| 11 | Characters read the cached capitals list | Empire.cs 513 Capitals | FIXED (c84178d) | characters.ts:7062 | Low | Recomputed each time; determinism risk |
| 12 | Capital choice after losing a colony (setup path) | Empire.cs 3596 SelectBestCandidateForCapital | FIXED (9508833) | empire.ts:1066 | Low | Uses colonies[0]; runtime path is correct |
| 13 | Player free-trader upkeep (Bacon mod) | BaconEmpire PayAnnualMaintenanceCostForFreeTraders | OPEN (Bacon mod, unreachable) | treasury.ts:221-248 | Low | |
| 14 | Freedom Alliance victory story | Galaxy.1.cs 429 DecimateEmpire / GuardiansDepart | OPEN (agent C4) | victory.ts:1052 | Low | |
| 15 | Bacon story actions: loan payment, scientific missions | BaconGalaxy.cs 334-343 | OPEN (Bacon mod, nothing queues them) | story/eventActions.ts:1713-1717 | Low | |
| 16 | Pirate relationship factors (diplomacy UI) | Empire.7.cs 4270 | OPEN (UI) | diplomacyScreen.ts:1352 | Low | |
| 17 | Empire ability-bonus lines (diplomacy UI) | Empire.cs ResolveEmpireAbilityBonusDescriptions | OPEN (UI) | diplomacyScreen.ts:1124 | Low | |
| 18 | Original-save fix-ups | Empire.10.cs ExtendLatestDesignsWithNewSubRoles, ReviewBuiltObjectWeaponsComponentValues, ReviewUnpersistedColonyData | OPEN (original .sav only) | — | Low | Only for loading original .sav files |

## Fully ported (spot-verified)
- **Diplomacy:** ReviewDiplomaticStrategies, EvaluatePoliticalSituation, ImplementDiplomaticStrategy, ApplyDiplomaticStrategyToRelation, ConsiderTreatyProposals, ProcessMessages, DetermineEmpireRelationshipFactors, government-style affinity.
- **Trade and war:** EvaluateTradeOffer, TradeItems, ReviewEnemyHelpEnlistment, ReviewDisputedTerritory, DeclareWar, ConsiderEndWar, PrepareFleetsForWar, CheckReadyForWar, DetermineVictorInWar, DetermineSubjugationOfLoserInWar.
- **Expansion and building:** IdentifyColonizationTargets, DetermineColonizationValue, BuildNewShips, DirectConstruction, DirectPrivateConstruction, RetireOldBuiltObjects, ProjectForceStructure, ProjectPrivateForceStructure.
- **Economy:** ReviewTaxes, RecalculateEmpireCorruption, PerformPrivateTransaction, PayMaintenance, PayForTroops, PayForPlanetaryFacilities, subjugation tribute, trade bonuses, CheckMarketOrders, freight.
- **Research:** SelectNextResearchProject, PerformResearch, DoCrashResearch.
- **Espionage:** AssignSpecialMissions, PerformIntelligenceMissions, outcomes, counters.
- **Government:** ReviewGovernmentEffects, CheckChangeGovernment, HaveRevolution, SelectSuitableGovernment.
- **Characters:** ProcessCharacters, CheckForCharacterAppearance, leader change, traits, locations.
- **Events, splits, elimination:** random/empire events, InitiateEmpireSplit, SplinterEmpire, CompleteTeardown, defeatedEmpires.
- **Military AI:** IdentifyMilitaryObjectives, TaskShipGroups, DetermineRandomAttacks, CheckTemptingTargets, blockades.

## Dead C# code (never called in 1.9.5; needs no port)
- **Agents and finance:** GenerateIntelligenceAgents, NewAgentsCanRecruit, PayForAgents, CalculateColonyTaxResistance, EvaluateViabilityOf*Enterprises, SetTaxRate.
- **War and diplomacy:** CheckDeclareWar, CheckCancelTreaty, WarInevitability; the UpgradeDesiredDiplomaticRelationTypeIfAtWar → ResolveDesiredDiplomaticRelationType chain; CalculateTotalMobileFirepowerAtWarWithUs; DetermineDiplomaticMissionDifficulty; CountEmpires*DeclaredWar*; DetermineUnfriendlyEmpires; ResolveEnemyEmpires; DetermineEmpiresWithConquerStrategy; DetermineEmpiresPirateWillingToAttack.
- **Station designs:** DesignDefensiveBase, DesignMonitoringStation, DesignResearchStation (and generators).
- **Fleets:** AssembleStrikeGroup, IdentifyNewFleetDefendLocation, IdentifyDefendLocations, WaypointShipGroup, CountFleetsUsingColonyAsBase, FindAvailableShipGroup* variants.
- **Misc:** CheckNextResearchForSpecialCases, DetermineEmpireRaces, DetermineResortBaseLocation, ResolveLatestBombardWeaponImprovement, CalculateMinimumOrderFulfillmentThreshhold; ResearchSystem IdentifyBestProject / ResolveResearchPathToNode; component-cargo order branches; LoadOptimizedDesignsForEmpire.

## Stale TODO(port) notes (code done, comment wrong) — all removed (472d8b8, 618320f, D4)
- diplomacy.ts:189-193: the throwing `DiplomaticRelation.performTradeTransaction` stub; the real port is logistics/contracts.ts:194. Delete the stub.
- treasury.ts:500; pirates.ts:496; troops.ts:199/210; victory.ts:510, 752; logistics/freight.ts:78.
- The notes at gaps 1, 2 and 4 are stale, but there the behaviour is still wrong.
