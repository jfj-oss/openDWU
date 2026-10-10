// M4a skeleton: Empire.DoTasks (Empire.1.cs 3427-3728) for normal empires; pirate factions branch to
// DoTasksPirates (tick/pirateTick.ts). Statement-for-statement in C# order: touch fields are updated BEFORE the
// blocks (3452-3499), intervals are `>=` on double seconds (Empire.cs 176-186: 3/10/30/60/120/240 s).
//
// Every call is either an existing port (taxes.ts, forceStructure.ts, designGeneration.ts, resourceTargets.ts,
// stationPlacement.ts, independentTraders.ts, pirateRelations.ts, characters.ts) or a named stub in its owning
// package module (tasks/M4-plan.md §3.2). Runs on a C# worker thread; the TS scheduler runs it at the end of the
// frame in enqueue order (tick/scheduler.ts).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { MIN_TIME, REAL_SECONDS_IN_GALACTIC_YEAR, galaxyNow, galaxyStarDate, spanSeconds } from './simTime';
import { shipGroupDoTasks } from './shipGroupTick';
import { empirePirateDoTasks } from './pirateTick';
import { empireShipGroups, maintainShipGroups, reviewFleetAdmiralBonuses, reviewFleetPostures, updateFleetLeadShips } from '../fleets/shipGroup';
// Existing ports.
import { recalculateEmpireCorruption, reviewTaxes } from '../taxes';
import { annualTaxRevenue, privateAnnualRevenue, projectForceStructure, projectPrivateForceStructure, recalculateColonyTaxRevenues } from '../forceStructure';
import { createNewDesigns } from '../designGeneration';
import { identifyResourceCentres } from '../resourceTargets';
import { determineResearchStationLocation, identifyUnavailableLuxuryResources } from '../stationPlacement';
import { updateEmpireRefuellingLocations } from '../independentTraders';
import { checkHaveMetPirates } from '../pirateRelations';
import { CharacterEventType, doCharacterEventForList } from '../characters';
// Package stubs.
import { clearExpiredDeclinedTasks, clearOldDistressSignals, clearOutOldDistressSignals, processDistressSignals } from '../missions/distress';
import { checkForStrandedShips, evaluateSystemLinks, updateSystemFuelSourceStatus, updateSystemRefuellingStatus } from '../movement';
import { checkMarketOrders, maintainBaseResourceLevels, processTradeBonuses, reviewRestrictedResourceTrading } from '../logistics/orders';
import { assignShipMissions, directPrivateConstruction, identifyColonizationTargets, reviewIndependentColonyTargets, reviewMigrationTourism } from '../civilianAI';
import { prioritizeEmpireResourceNeeds } from '../industry';
import { buildDefensiveBases, determineMonitoringStationLocation, directConstruction, retireOldBuiltObjects, reviewDesignsAndRetrofit, reviewLatestDesigns } from '../construction/empireConstruction';
import { refreshColonyFacilityInfo, reviewColonyFacilities } from '../construction/facilities';
import { reviewColonyWonders } from '../construction/wonders';
import { evaluateColonyVariables, reviewColonyPopulationPolicy } from '../colonyTick';
import {
    checkChangeGovernment,
    countersProcessColonyRevenue,
    payForPlanetaryFacilities,
    payForTroops,
    payMaintenanceForBuiltObjects,
    processSubjugationTribute,
    reviewEmpireAbilityBonuses,
    reviewGovernmentEffects,
    reviewSpecialBonusesRuinsWonders,
} from '../treasury';
import { doCrashResearch, performResearch, reviewResearchStationBonuses } from '../researchTick';
import {
    cancelInactiveBlockades,
    checkTemptingTargets,
    determineRandomAttacks,
    identifyMilitaryObjectives,
    respondToIncomingEnemyFleetsAndPlanetDestroyers,
    reviewSystemThreats,
    sendAvailableFleetsToGuardStrategicLocations,
    taskResupplyShips,
    taskShipGroups,
} from '../fleets/militaryAI';
import { cleanupInvalidShips } from '../combat/teardown';
import { invadeUnwillingColonizationTargets } from '../combat/invasion';
import { disbandExcessTroops, recruitAttackTroops } from '../combat/troopsRuntime';
import {
    calculateRelativeEmpireSize,
    clearInvalidDiplomaticRelations,
    considerTreatyProposals,
    evaluatePoliticalSituation,
    processMessages,
    removeDefeatedEmpireRelations,
    reviewDiplomaticSituations,
    reviewDiplomaticStrategies,
    reviewDisputedTerritory,
    reviewEmpireEndsAllWars,
    reviewEnemyHelpEnlistment,
} from '../diplomacyTick';
import { tradeItems } from '../tradeItems';
import {
    makeAttackOffersToPirates,
    makeDefendOffersToPirates,
    makeSmugglingOffersToPirates,
    reviewPirateDefendMissions,
    reviewPirateRelations,
    reviewPirateSmugglingMissions,
} from '../pirates/missionsMarket';
import { checkColoniesForPirateFacilitiesAndAttack, checkSendPirateRaid } from '../pirates/pirateAI';
import {
    checkKnownPirateBases,
    clearExpiredViewableEmpires,
    exertCulturalInfluence,
    mergeGalaxyMapsForSharedVisibilityEmpires,
    mergeKnownPirateBasesForSharedVisibilityEmpires,
    updateSystemExplorationStatus,
} from '../exploration';
import {
    assignSpecialMissions,
    checkForCharacterAppearance,
    checkOfferStoryHint,
    checkReviewSpecialPirateEvents,
    checkSendShipConvoysViaGateway,
    performIntelligenceMissions,
    processCharacters,
    processLeaderChangeInfluence,
    resetRaceEvents,
    reviewCharacterBonusesKnown,
    reviewCharacterLeaderChange,
    reviewCharacterLocations,
    reviewCharacterTraits,
    reviewDemoralizingCharacters,
    reviewEmpireEvents,
    reviewRandomEvents,
    shakturiSendConvoy,
    updateAchievements,
} from '../events';
import { AutomationLevel } from '../empire';
import { scenarioFlag } from '../scenario/state';
import { scenarioEmit, scenarioQuery } from '../scenario/hooks';
import { rimTraderColonyCapReached } from '../scenario/rimTrade/common';
import { isHumanEmpire } from '../humanEmpires';

/** Empire.cs 176-186 _ShortProcessingInterval .. _HugeProcessingInterval (seconds). */
export const SHORT_PROCESSING_INTERVAL = 3.0;
export const REGULAR_PROCESSING_INTERVAL = 10.0;
export const PERIODIC_PROCESSING_INTERVAL = 30.0;
export const INTERMEDIATE_PROCESSING_INTERVAL = 60.0;
export const LONG_PROCESSING_INTERVAL = 120.0;
export const HUGE_PROCESSING_INTERVAL = 240.0;

/**
 * Empire ctor touch times (Empire.cs 3921-3925 / 4320-4324): short..long = CurrentDateTime −
 * ((int)LongProcessingInterval + 1) s; _LastHugeTouch is not set (stays MinValue). The empire.ts field defaults are
 * these values at game time 0; call this for an empire constructed at a later game time.
 */
export function initEmpireTouchTimes(galaxy: Galaxy, empire: Empire): void {
    empire.lastLongTouch = galaxyNow(galaxy) - (Math.trunc(LONG_PROCESSING_INTERVAL) + 1) * 1000;
    empire.lastIntermediateTouch = empire.lastLongTouch;
    empire.lastPeriodicTouch = empire.lastLongTouch;
    empire.lastRegularTouch = empire.lastLongTouch;
    empire.lastShortTouch = empire.lastLongTouch;
}

/** Empire.1.cs 3422 ResetLastTouchTimesToMinimum. */
export function resetLastTouchTimesToMinimum(empire: Empire): void {
    empire.lastHugeTouch = empire.lastLongTouch = empire.lastIntermediateTouch = empire.lastPeriodicTouch = empire.lastRegularTouch = empire.lastShortTouch = MIN_TIME;
}

/** Galaxy.DoCharacterEventLeader (Galaxy.1.cs 3756): an empty source list plus the leader(s) of `leaderEmpire`. */
function doCharacterEventLeader(galaxy: Galaxy, eventType: CharacterEventType, eventData: unknown, leaderEmpire: Empire): void {
    doCharacterEventForList(galaxy, eventType, eventData, [], true, leaderEmpire);
}

/** Empire.1.cs 3427 DoTasks(). */
export function empireDoTasks(galaxy: Galaxy, empire: Empire): void {
    // 3429-3432
    if (empire.pirateEmpireBaseHabitat !== null) {
        empirePirateDoTasks(galaxy, empire);
        return;
    }
    // 3435-3438
    if (!empire.active) {
        return;
    }
    // 3439-3451
    const currentDateTime = galaxyNow(galaxy);
    const num = spanSeconds(currentDateTime, empire.lastShortTouch);
    const num2 = spanSeconds(currentDateTime, empire.lastRegularTouch);
    const num3 = spanSeconds(currentDateTime, empire.lastPeriodicTouch);
    const num4 = spanSeconds(currentDateTime, empire.lastIntermediateTouch);
    const num5 = spanSeconds(currentDateTime, empire.lastLongTouch);
    const timePassedSpanMs = currentDateTime - empire.lastLongTouch; // TimeSpan timePassedSpan
    const num6 = spanSeconds(currentDateTime, empire.lastHugeTouch);
    // 3452-3475
    if (num < 0.0) empire.lastShortTouch = currentDateTime;
    if (num2 < 0.0) empire.lastRegularTouch = currentDateTime;
    if (num3 < 0.0) empire.lastPeriodicTouch = currentDateTime;
    if (num4 < 0.0) empire.lastIntermediateTouch = currentDateTime;
    if (num5 < 0.0) empire.lastLongTouch = currentDateTime;
    if (num6 < 0.0) empire.lastHugeTouch = currentDateTime;
    // 3476-3499
    if (num >= SHORT_PROCESSING_INTERVAL) empire.lastShortTouch = currentDateTime;
    if (num2 >= REGULAR_PROCESSING_INTERVAL) empire.lastRegularTouch = currentDateTime;
    if (num3 >= PERIODIC_PROCESSING_INTERVAL) empire.lastPeriodicTouch = currentDateTime;
    if (num4 >= INTERMEDIATE_PROCESSING_INTERVAL) empire.lastIntermediateTouch = currentDateTime;
    if (num5 >= LONG_PROCESSING_INTERVAL) empire.lastLongTouch = currentDateTime;
    if (num6 >= HUGE_PROCESSING_INTERVAL) empire.lastHugeTouch = currentDateTime;
    // 3500-3504
    let flag = true;
    if (empire.dominantRace !== null) {
        flag = empire.dominantRace.expanding;
    }
    // Mod layer (Smarter AI pre-warp opening): the state AI makes no strategic moves (the `!dormant &&` gates below).
    const dormant = galaxy.scenario !== null && scenarioQuery(galaxy, 'stateAIDormant', false, { empire });
    // 3505-3514 short block.
    if (num >= SHORT_PROCESSING_INTERVAL) {
        respondToIncomingEnemyFleetsAndPlanetDestroyers(galaxy, empire);
        const shipGroups = empireShipGroups(empire);
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            shipGroupDoTasks(galaxy, shipGroup!, currentDateTime);
        }
        processCharacters(galaxy, empire, num);
    }
    // 3515-3522 regular block.
    if (num2 >= REGULAR_PROCESSING_INTERVAL) {
        processDistressSignals(galaxy, empire);
        clearOutOldDistressSignals(galaxy, empire);
        clearExpiredViewableEmpires(galaxy, empire);
        reviewDesignsAndRetrofit(galaxy, empire);
        updateEmpireRefuellingLocations(galaxy, empire);
    }
    // 3523-3561 periodic block.
    if (num3 >= PERIODIC_PROCESSING_INTERVAL) {
        empire.relativeEmpireSize = calculateRelativeEmpireSize(galaxy, empire);
        checkReviewSpecialPirateEvents(galaxy, empire);
        checkSendPirateRaid(galaxy, empire);
        removeDefeatedEmpireRelations(galaxy, empire);
        processMessages(galaxy, empire);
        considerTreatyProposals(galaxy, empire);
        evaluateColonyVariables(galaxy, empire, num3);
        if (!dormant) recruitAttackTroops(galaxy, empire);
        recalculateEmpireCorruption(empire);
        if (empire.controlColonyTaxRates) {
            reviewTaxes(galaxy, empire);
        }
        recalculateColonyTaxRevenues(galaxy, empire);
        if (!dormant && empire.controlMilitaryAttacks !== AutomationLevel.Undefined) {
            identifyMilitaryObjectives(galaxy, empire);
        }
        if (empire.controlMilitaryFleets) {
            maintainShipGroups(galaxy, empire);
            updateFleetLeadShips(galaxy, empire);
            reviewFleetPostures(galaxy, empire);
        }
        cancelInactiveBlockades(galaxy, empire);
        reviewPirateDefendMissions(galaxy, empire, galaxyStarDate(galaxy));
        reviewPirateSmugglingMissions(galaxy, empire, galaxyStarDate(galaxy));
        checkMarketOrders(galaxy, empire);
        assignShipMissions(galaxy, empire);
        if (!dormant && empire.controlAgentAssignment !== AutomationLevel.Undefined) {
            assignSpecialMissions(galaxy, empire);
        }
        performIntelligenceMissions(galaxy, empire);
        performResearch(galaxy, empire, num3, true);
        evaluateSystemLinks(galaxy, empire);
    }
    // 3562-3643 intermediate block.
    if (num4 >= INTERMEDIATE_PROCESSING_INTERVAL) {
        if (empire.controlMilitaryFleets) {
            taskShipGroups(galaxy, empire);
        }
        reviewFleetAdmiralBonuses(galaxy, empire);
        taskResupplyShips(galaxy, empire);
        reviewResearchStationBonuses(galaxy, empire);
        if (!dormant && flag) {
            reviewIndependentColonyTargets(galaxy, empire);
        }
        processTradeBonuses(galaxy, empire, num4);
        reviewColonyPopulationPolicy(galaxy, empire, num4);
        updateSystemExplorationStatus(galaxy, empire);
        checkKnownPirateBases(galaxy, empire);
        // 3579-3610 money.
        const privateAnnualRevenueValue = privateAnnualRevenue(galaxy, empire);
        let num7 = privateAnnualRevenueValue * (num4 / REAL_SECONDS_IN_GALACTIC_YEAR);
        if (Number.isNaN(num7)) {
            num7 = 0.0;
        }
        countersProcessColonyRevenue(galaxy, empire, num7);
        empire.privateMoney += num7;
        const annualTaxRevenueValue = annualTaxRevenue(galaxy, empire);
        let val = annualTaxRevenueValue * (num4 / REAL_SECONDS_IN_GALACTIC_YEAR);
        val = Math.max(0.0, val);
        if (Number.isNaN(val)) {
            val = 0.0;
        }
        empire.stateMoney += val;
        empire.privateMoney -= val;
        if (Number.isNaN(empire.stateMoney)) {
            empire.stateMoney = 0.0;
        }
        if (Number.isNaN(empire.privateMoney)) {
            empire.privateMoney = 0.0;
        }
        processSubjugationTribute(galaxy, empire, num4);
        if (empire.stateMoney < 0.0) {
            doCharacterEventLeader(galaxy, CharacterEventType.CashNegative, null, empire);
        } else {
            doCharacterEventLeader(galaxy, CharacterEventType.CashPositive, null, empire);
        }
        if (empire !== galaxy.independentEmpire && empire.dominantRace !== null) {
            checkForCharacterAppearance(galaxy, empire);
        }
        reviewCharacterLeaderChange(galaxy, empire, num4);
        processLeaderChangeInfluence(galaxy, empire, num4);
        reviewCharacterBonusesKnown(galaxy, empire);
        reviewCharacterTraits(galaxy, empire);
        reviewDemoralizingCharacters(galaxy, empire);
        reviewCharacterLocations(galaxy, empire);
        if (empire.controlDesigns) {
            const starDate = galaxyStarDate(galaxy);
            createNewDesigns(galaxy, empire, starDate, starDate);
        }
        reviewSystemThreats(galaxy, empire);
        // Mod layer 19a: the Concord stops colonizing at its cap (tasks/19a-rim-trader.md R2)
        empire.colonizationTargets = scenarioFlag(galaxy, 'rimTrader') && rimTraderColonyCapReached(galaxy, empire) ? [] : identifyColonizationTargets(galaxy, empire);
        if (!dormant && flag) {
            invadeUnwillingColonizationTargets(galaxy, empire);
        }
        if (galaxy.scenario !== null && !dormant && flag) scenarioEmit(galaxy, 'colonizationTargetsReviewed', { empire }); // mod layer (Smarter AI independents)
        empire.resourceTargets = identifyResourceCentres(galaxy, empire);
        empire.empireResourceTargets = prioritizeEmpireResourceNeeds(galaxy, empire);
        identifyUnavailableLuxuryResources(galaxy, empire);
        if (isHumanEmpire(galaxy, empire)) {
            updateSystemRefuellingStatus(galaxy, empire);
            checkForStrandedShips(galaxy, empire);
        }
        updateSystemFuelSourceStatus(galaxy, empire);
        updateAchievements(galaxy, empire);
    }
    // 3644-3707 long block.
    if (num5 >= LONG_PROCESSING_INTERVAL) {
        mergeGalaxyMapsForSharedVisibilityEmpires(galaxy, empire);
        mergeKnownPirateBasesForSharedVisibilityEmpires(galaxy, empire);
        if (!dormant && flag) {
            checkTemptingTargets(galaxy, empire);
        }
        if (!dormant) reviewColonyWonders(galaxy, empire);
        if (!dormant) reviewColonyFacilities(galaxy, empire);
        refreshColonyFacilityInfo(galaxy, empire);
        if (!dormant && flag) {
            sendAvailableFleetsToGuardStrategicLocations(galaxy, empire);
        }
        reviewEmpireAbilityBonuses(galaxy, empire);
        reviewGovernmentEffects(galaxy, empire, num5);
        checkChangeGovernment(galaxy, empire);
        recalculateColonyTaxRevenues(galaxy, empire);
        clearInvalidDiplomaticRelations(galaxy, empire);
        evaluatePoliticalSituation(galaxy, empire, timePassedSpanMs);
        reviewDiplomaticStrategies(galaxy, empire);
        if (!dormant) reviewDiplomaticSituations(galaxy, empire);
        reviewPirateRelations(galaxy, empire, galaxyStarDate(galaxy), num5);
        if (!dormant && checkHaveMetPirates(empire)) {
            makeAttackOffersToPirates(galaxy, empire, galaxyStarDate(galaxy));
            makeDefendOffersToPirates(galaxy, empire, galaxyStarDate(galaxy));
            makeSmugglingOffersToPirates(galaxy, empire, galaxyStarDate(galaxy));
        }
        reviewRestrictedResourceTrading(galaxy, empire);
        reviewSpecialBonusesRuinsWonders(galaxy, empire);
        reviewMigrationTourism(galaxy, empire);
        doCrashResearch(galaxy, empire);
        if (!dormant && !empire.reclusive) {
            tradeItems(galaxy, empire);
        }
        if (empire.controlTroopGeneration) {
            disbandExcessTroops(galaxy, empire);
        }
        if (!dormant && empire.controlMilitaryAttacks !== AutomationLevel.Undefined && !empire.reclusive) {
            determineRandomAttacks(galaxy, empire);
        }
        const forceStructureCtx = { currentStarDate: galaxyStarDate(galaxy), difficultyLevel: galaxy.difficultyLevel };
        projectForceStructure(galaxy, empire, forceStructureCtx);
        projectPrivateForceStructure(galaxy, empire, forceStructureCtx);
        payMaintenanceForBuiltObjects(galaxy, empire, num5);
        payForTroops(galaxy, empire, num5);
        payForPlanetaryFacilities(galaxy, empire, num5);
        retireOldBuiltObjects(galaxy, empire);
        if (empire.initiateConstruction) {
            reviewLatestDesigns(galaxy, empire);
            if (dormant) scenarioEmit(galaxy, 'dormantStateConstruction', { empire }); // mod layer (Smarter AI opening build order)
            else directConstruction(galaxy, empire);
            directPrivateConstruction(galaxy, empire);
        }
        exertCulturalInfluence(galaxy, empire);
        clearOldDistressSignals(galaxy, empire);
        clearExpiredDeclinedTasks(galaxy, empire);
        if (!dormant) determineMonitoringStationLocation(galaxy, empire);
        if (!dormant) determineResearchStationLocation(galaxy, empire, false, true);
    }
    // 3708-3726 huge block.
    if (num6 >= HUGE_PROCESSING_INTERVAL) {
        cleanupInvalidShips(galaxy, empire);
        reviewEmpireEndsAllWars(galaxy, empire, galaxyStarDate(galaxy));
        if (!dormant) buildDefensiveBases(galaxy, empire);
        if (!dormant) checkColoniesForPirateFacilitiesAndAttack(galaxy, empire);
        shakturiSendConvoy(galaxy, empire);
        checkOfferStoryHint(galaxy, empire);
        resetRaceEvents(galaxy, empire);
        reviewRandomEvents(galaxy, empire);
        reviewEmpireEvents(galaxy, empire);
        checkSendShipConvoysViaGateway(galaxy, empire, num6);
        maintainBaseResourceLevels(galaxy, empire);
        if (!dormant && !empire.reclusive) {
            reviewEnemyHelpEnlistment(galaxy, empire);
        }
        if (!dormant) reviewDisputedTerritory(galaxy, empire);
    }
}
