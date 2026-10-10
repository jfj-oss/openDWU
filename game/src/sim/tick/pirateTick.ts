// M4a skeleton: Empire.DoTasksPirates (Empire.1.cs 4095-4273) — pirate factions (PirateEmpireBaseHabitat != null).
// Same interval fields and touch-first update order as Empire.DoTasks (tick/empireTick.ts).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { galaxyNow, galaxyStarDate, spanSeconds } from './simTime';
import { shipGroupDoTasks } from './shipGroupTick';
import {
    HUGE_PROCESSING_INTERVAL,
    INTERMEDIATE_PROCESSING_INTERVAL,
    LONG_PROCESSING_INTERVAL,
    PERIODIC_PROCESSING_INTERVAL,
    REGULAR_PROCESSING_INTERVAL,
    SHORT_PROCESSING_INTERVAL,
} from './empireTick';
import { empireShipGroups, maintainShipGroups, reviewFleetAdmiralBonuses, reviewFleetPostures, updateFleetLeadShips } from '../fleets/shipGroup';
import { AutomationLevel } from '../empire';
// Existing ports.
import { createNewDesigns } from '../designGeneration';
import { identifyResourceCentres } from '../resourceTargets';
import { identifyUnavailableLuxuryResources } from '../stationPlacement';
import { updateEmpireRefuellingLocations } from '../independentTraders';
import { pirateReviewColoniesToControl } from '../pirates';
// Package stubs.
import { clearExpiredDeclinedTasks } from '../missions/distress';
import { checkForStrandedShips, updateSystemFuelSourceStatus, updateSystemRefuellingStatus } from '../movement';
import { checkMarketOrders, maintainBaseResourceLevels } from '../logistics/orders';
import { reviewMigrationTourism } from '../civilianAI';
import { prioritizeEmpireResourceNeeds } from '../industry';
import { reviewDesignsAndRetrofit, reviewLatestDesigns } from '../construction/empireConstruction';
import { pirateReviewColonyFacilities } from '../construction/facilities';
import { evaluateColonyVariablesPirate } from '../colonyTick';
import { payForPlanetaryFacilities, payForTroops, payMaintenanceForBuiltObjects } from '../treasury';
import { performResearch, reviewResearchStationBonuses } from '../researchTick';
import { taskResupplyShips } from '../fleets/militaryAI';
import { cleanupInvalidShips } from '../combat/teardown';
import { clearInvalidDiplomaticRelations, processMessages, removeDefeatedEmpireRelations } from '../diplomacyTick';
import { pirateCheckMissionsOnOffer, piratesMakeAttackOffers } from '../pirates/missionsMarket';
import {
    doTaskPiratesLongInterval,
    maintainPirateSpaceportResourceLevels,
    pirateAssignShipMissions,
    pirateCollectIncomeFromControlledColonies,
    pirateDoConstruction,
    pirateGenerateSellInfoOffers,
    pirateProjectForces,
    pirateRecalculateEmpireCorruption,
    pirateResetCivilianShipEmpireToIndependent,
    pirateReviewEmpireRelations,
    pirateReviewSystemThreats,
    pirateTaskFleets,
    pirateTradeItems,
    reviewPirateSystemInfluence,
} from '../pirates/pirateAI';
import {
    checkKnownPirateBases,
    clearExpiredViewableEmpires,
    mergeGalaxyMapsForSharedVisibilityEmpires,
    mergeKnownPirateBasesForSharedVisibilityEmpires,
    updateSystemExplorationStatus,
} from '../exploration';
import {
    assignSpecialMissions,
    checkForCharacterAppearance,
    performIntelligenceMissions,
    pirateReviewRandomEvents,
    processCharacters,
    processLeaderChangeInfluence,
    reviewCharacterLeaderChange,
    reviewCharacterLocations,
    reviewCharacterTraits,
    reviewDemoralizingCharacters,
    updateAchievements,
} from '../events';
import { isHumanEmpire } from '../humanEmpires';

/** Empire.1.cs 4095 DoTasksPirates(). */
export function empirePirateDoTasks(galaxy: Galaxy, empire: Empire): void {
    // 4097-4100
    if (!empire.active) {
        return;
    }
    // 4101-4114
    const currentStarDate = galaxyStarDate(galaxy);
    const currentDateTime = galaxyNow(galaxy);
    const num = spanSeconds(currentDateTime, empire.lastShortTouch);
    const num2 = spanSeconds(currentDateTime, empire.lastRegularTouch);
    const num3 = spanSeconds(currentDateTime, empire.lastPeriodicTouch);
    const num4 = spanSeconds(currentDateTime, empire.lastIntermediateTouch);
    const num5 = spanSeconds(currentDateTime, empire.lastLongTouch);
    const num6 = spanSeconds(currentDateTime, empire.lastHugeTouch);
    // 4115-4138
    if (num < 0.0) empire.lastShortTouch = currentDateTime;
    if (num2 < 0.0) empire.lastRegularTouch = currentDateTime;
    if (num3 < 0.0) empire.lastPeriodicTouch = currentDateTime;
    if (num4 < 0.0) empire.lastIntermediateTouch = currentDateTime;
    if (num5 < 0.0) empire.lastLongTouch = currentDateTime;
    if (num6 < 0.0) empire.lastHugeTouch = currentDateTime;
    // 4139-4162
    if (num >= SHORT_PROCESSING_INTERVAL) empire.lastShortTouch = currentDateTime;
    if (num2 >= REGULAR_PROCESSING_INTERVAL) empire.lastRegularTouch = currentDateTime;
    if (num3 >= PERIODIC_PROCESSING_INTERVAL) empire.lastPeriodicTouch = currentDateTime;
    if (num4 >= INTERMEDIATE_PROCESSING_INTERVAL) empire.lastIntermediateTouch = currentDateTime;
    if (num5 >= LONG_PROCESSING_INTERVAL) empire.lastLongTouch = currentDateTime;
    if (num6 >= HUGE_PROCESSING_INTERVAL) empire.lastHugeTouch = currentDateTime;
    // 4163-4171 short block.
    if (num >= SHORT_PROCESSING_INTERVAL) {
        const shipGroups = empireShipGroups(empire);
        for (let i = 0; i < shipGroups.length; i++) {
            const shipGroup = shipGroups[i];
            shipGroupDoTasks(galaxy, shipGroup!, currentDateTime);
        }
        processCharacters(galaxy, empire, num);
    }
    // 4172-4178 regular block.
    if (num2 >= REGULAR_PROCESSING_INTERVAL) {
        reviewDesignsAndRetrofit(galaxy, empire);
        clearExpiredViewableEmpires(galaxy, empire);
        pirateCheckMissionsOnOffer(galaxy, empire, currentStarDate);
        updateEmpireRefuellingLocations(galaxy, empire);
    }
    // 4179-4199 periodic block.
    if (num3 >= PERIODIC_PROCESSING_INTERVAL) {
        removeDefeatedEmpireRelations(galaxy, empire);
        pirateRecalculateEmpireCorruption(galaxy, empire);
        processMessages(galaxy, empire);
        evaluateColonyVariablesPirate(galaxy, empire, num3);
        if (empire.controlMilitaryFleets) {
            maintainShipGroups(galaxy, empire);
            updateFleetLeadShips(galaxy, empire);
            reviewFleetPostures(galaxy, empire);
        }
        checkMarketOrders(galaxy, empire);
        pirateAssignShipMissions(galaxy, empire, currentStarDate);
        if (empire.controlAgentAssignment !== AutomationLevel.Undefined) {
            assignSpecialMissions(galaxy, empire);
        }
        performIntelligenceMissions(galaxy, empire);
        performResearch(galaxy, empire, num3, true);
    }
    // 4200-4242 intermediate block.
    if (num4 >= INTERMEDIATE_PROCESSING_INTERVAL) {
        if (empire.controlMilitaryAttacks !== AutomationLevel.Undefined) {
            pirateTaskFleets(galaxy, empire);
        }
        reviewFleetAdmiralBonuses(galaxy, empire);
        taskResupplyShips(galaxy, empire);
        reviewResearchStationBonuses(galaxy, empire);
        updateSystemExplorationStatus(galaxy, empire);
        checkKnownPirateBases(galaxy, empire);
        pirateCollectIncomeFromControlledColonies(galaxy, empire, num4);
        if (empire !== galaxy.independentEmpire && empire.dominantRace !== null) {
            checkForCharacterAppearance(galaxy, empire);
        }
        reviewCharacterLeaderChange(galaxy, empire, num4);
        processLeaderChangeInfluence(galaxy, empire, num4);
        reviewCharacterTraits(galaxy, empire);
        reviewDemoralizingCharacters(galaxy, empire);
        reviewCharacterLocations(galaxy, empire);
        if (empire.controlDesigns) {
            createNewDesigns(galaxy, empire, currentStarDate, currentStarDate);
        }
        pirateReviewSystemThreats(galaxy, empire);
        // 4224 _ColonizationTargets = PirateReviewColoniesToControl() (pirates.ts; Galaxy.IndependentColonies).
        empire.colonizationTargets = pirateReviewColoniesToControl(galaxy, empire, galaxy.independentColonies);
        empire.empireResourceTargets = prioritizeEmpireResourceNeeds(galaxy, empire, false, 5, 1.0);
        empire.resourceTargets = identifyResourceCentres(galaxy, empire);
        identifyUnavailableLuxuryResources(galaxy, empire);
        pirateGenerateSellInfoOffers(galaxy, empire);
        if (isHumanEmpire(galaxy, empire)) {
            updateSystemRefuellingStatus(galaxy, empire);
            checkForStrandedShips(galaxy, empire);
        }
        updateSystemFuelSourceStatus(galaxy, empire);
        reviewPirateSystemInfluence(galaxy, empire);
        if (isHumanEmpire(galaxy, empire)) {
            updateAchievements(galaxy, empire);
        }
    }
    // 4243-4266 long block.
    if (num5 >= LONG_PROCESSING_INTERVAL) {
        doTaskPiratesLongInterval(galaxy, empire);
        mergeGalaxyMapsForSharedVisibilityEmpires(galaxy, empire);
        mergeKnownPirateBasesForSharedVisibilityEmpires(galaxy, empire);
        maintainPirateSpaceportResourceLevels(galaxy, empire);
        pirateReviewColonyFacilities(galaxy, empire);
        clearInvalidDiplomaticRelations(galaxy, empire);
        // 4250: the C# passes num4 (intermediate span), not num5.
        pirateReviewEmpireRelations(galaxy, empire, currentStarDate, num4);
        pirateProjectForces(galaxy, empire, currentStarDate);
        payMaintenanceForBuiltObjects(galaxy, empire, num5);
        payForTroops(galaxy, empire, num5);
        payForPlanetaryFacilities(galaxy, empire, num5);
        reviewMigrationTourism(galaxy, empire);
        if (empire.initiateConstruction) {
            reviewLatestDesigns(galaxy, empire);
            pirateDoConstruction(galaxy, empire);
        }
        pirateResetCivilianShipEmpireToIndependent(galaxy, empire);
        piratesMakeAttackOffers(galaxy, empire, currentStarDate);
        pirateTradeItems(galaxy, empire);
        clearExpiredDeclinedTasks(galaxy, empire);
    }
    // 4267-4272 huge block.
    if (num6 >= HUGE_PROCESSING_INTERVAL) {
        pirateReviewRandomEvents(galaxy, empire);
        maintainBaseResourceLevels(galaxy, empire);
        cleanupInvalidShips(galaxy, empire);
    }
}
