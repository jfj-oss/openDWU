// M4a skeleton: Habitat.DoTasks (Habitat.cs 1399-1556). Statement-for-statement in C# order. Intervals are STRICT
// `>` TimeSpan tests (1437/1442/1499/1525); touches are written after each block. The every-call part moves the
// habitat along its orbit (Habitat.Move, ported as Habitat.advanceOrbit in types.ts).

import type { Galaxy } from '../galaxy';
import type { Habitat } from '../types';
import {
    HUGE_PROCESSING_SPAN_MS,
    INTERMEDIATE_PROCESSING_SPAN_MS,
    LONG_PROCESSING_SPAN_MS,
    PERIODIC_PROCESSING_SPAN_MS,
    REAL_SECONDS_IN_GALACTIC_YEAR,
    galaxyStarDate,
    spanSeconds,
} from './simTime';
// Existing ports.
import { processColonyTroopsFull, resolveInvasionEmpires } from '../troops';
import { recalculateDevelopmentLevelBaseline } from '../developmentLevel';
import { checkEmpireHasHyperDriveTech, recalculateAnnualTaxRevenue } from '../forceStructure';
import { checkForSpacePortFacilities } from '../stationPlacement';
import { recalculateColonyInfluenceRadius } from '../territory';
// Package stubs.
import { reviewWhetherRefuellingDepot } from '../movement';
import { checkForUnownedCargoHabitat } from '../logistics/orders';
import { consumeAndOrderStrategicResourceSupply, consumeResources } from '../logistics/colonySupply';
import { checkForShipsNoLongerDockingHabitat, checkRemoveInvalidDockingShipsFromWaitQueue } from '../logistics/docking';
import { doManufacturing, extractResources, reviewManufacturedResources } from '../industry';
import { doConstruction, reviewConstructionSpeed } from '../construction/constructionQueue';
import { constructFacilities } from '../construction/facilities';
import {
    baconHabitatHugeProcessingSpanActions,
    calculateMigrationFactor,
    calculateWarWithOurRace,
    checkSatisfaction,
    growPopulation,
    regenerateDamage,
    terraformColony,
    updateConqueredFactor,
} from '../colonyTick';
import { attackEnemyTargets, handleWeaponsFiringHabitat } from '../combat/weapons';
import { doExplosionHabitat, doExplosionsHabitat } from '../combat/damage';
import { calculateSpaceControlStrengths, resolveInvasionBattles, scanForNewOwnerHabitat } from '../combat/invasion';
import { clearTroopsAwaitingPickup, independentColoniesRecruitAndTrainTroops } from '../combat/troopsRuntime';
import { reviewPirateControl, updateRaidCountdownHabitat } from '../pirates/pirateAI';
import { checkForShipsDiscoveringRuins, checkForShipsOfNewEmpiresInSystem } from '../exploration';
import { chanceColonyGovernorPromotion, checkHabitatIsEmpire, doPlanetRemove, processPlague, spawnCreatures } from '../events';

/** Galaxy.3.cs 5012-5014 TroopStrengthAnnualNeutralizationAmount / TroopSizeAnnualRegenerationAmount / TroopAnnualRecruitmentAmount. */
const TROOP_STRENGTH_ANNUAL_NEUTRALIZATION_AMOUNT = 1;
const TROOP_SIZE_ANNUAL_REGENERATION_AMOUNT = 50;
const TROOP_ANNUAL_RECRUITMENT_AMOUNT = 150;

/**
 * Habitat.cs 1643 ProcessColonyTroops(timePassed): the Empire.4.cs 3469 full overload with no finances, atWar false,
 * no defend list and performRecruitment false (troops.ts processColonyTroopsFull).
 */
export function habitatProcessColonyTroops(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    if (habitat.empire !== null) {
        const troopStrengthNeutralizationAmount = TROOP_STRENGTH_ANNUAL_NEUTRALIZATION_AMOUNT * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
        const troopSizeRegenerationAmount = TROOP_SIZE_ANNUAL_REGENERATION_AMOUNT * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
        const troopRecruitmentAmount = TROOP_ANNUAL_RECRUITMENT_AMOUNT * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
        processColonyTroopsFull(
            galaxy, habitat.empire, habitat, null, troopStrengthNeutralizationAmount, troopSizeRegenerationAmount, troopRecruitmentAmount,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false, null, false, galaxy.difficultyLevel,
        );
    }
}

/** Habitat.cs 1399 DoTasks(DateTime time); `time` in game ms. */
export function habitatDoTasks(galaxy: Galaxy, habitat: Habitat, time: number): boolean {
    const h = habitat;
    // 1401
    const tempNow = time;
    // 1402-1405
    if (h.explosion !== null) {
        doExplosionHabitat(galaxy, h);
    }
    // 1406
    if (!h.hasBeenDestroyed) {
        // 1408-1409 DoingTasks = true; Move(_Galaxy) with (_tempNow − _LastTouch).TotalSeconds.
        h.doingTasks = true;
        h.advanceOrbit(spanSeconds(tempNow, h.lastTouch));
        // 1410-1413
        if (h.explosions !== null && h.explosions.length > 0) {
            doExplosionsHabitat(galaxy, h);
        }
        // 1414-1429
        if (tempNow < h.lastIntermediateTouch) h.lastIntermediateTouch = tempNow;
        if (tempNow < h.lastPeriodicTouch) h.lastPeriodicTouch = tempNow;
        if (tempNow < h.lastLongTouch) h.lastLongTouch = tempNow;
        if (tempNow < h.lastTouch) h.lastTouch = tempNow;
        // 1430-1435
        const timeSpan = tempNow - h.lastIntermediateTouch;
        const timeSpan2 = tempNow - h.lastPeriodicTouch;
        const timeSpan3 = tempNow - h.lastTouch;
        const timePassed = spanSeconds(tempNow, h.lastLongTouch);
        const timeSpan4 = tempNow - h.lastLongTouch;
        const timeSpan5 = tempNow - h.lastHugeTouch;
        // 1436
        handleWeaponsFiringHabitat(galaxy, h, timeSpan3 / 1000, time);
        // 1437-1441
        if (timeSpan > INTERMEDIATE_PROCESSING_SPAN_MS) {
            checkForShipsDiscoveringRuins(galaxy, h);
            h.lastIntermediateTouch = tempNow;
        }
        // 1442-1498
        if (timeSpan2 > PERIODIC_PROCESSING_SPAN_MS) {
            const timeSpan2Seconds = timeSpan2 / 1000;
            calculateWarWithOurRace(galaxy, h);
            scanForNewOwnerHabitat(galaxy, h);
            if (!h.rebelling) {
                growPopulation(galaxy, h, timeSpan2Seconds);
            }
            if (h.invadingTroops !== null && h.invadingTroops.count > 0) {
                const { defender, invader } = resolveInvasionEmpires(h);
                let spaceControlStrengthDefenders = -1;
                let spaceControlStrengthAttackers = -1;
                const strengths = calculateSpaceControlStrengths(galaxy, h, defender, invader);
                spaceControlStrengthDefenders = strengths.defenders;
                spaceControlStrengthAttackers = strengths.attackers;
                h.invasionSpaceControlStrengthDefenders = spaceControlStrengthDefenders;
                h.invasionSpaceControlStrengthAttackers = spaceControlStrengthAttackers;
            } else {
                h.invasionSpaceControlStrengthDefenders = -1;
                h.invasionSpaceControlStrengthAttackers = -1;
            }
            if (h.colonyInvasion === null) {
                // RND: Empire.ProcessColonyTroops (troops.ts) draws per completed recruit; with performRecruitment false none.
                habitatProcessColonyTroops(galaxy, h, timeSpan2Seconds);
                resolveInvasionBattles(galaxy, h, timeSpan2Seconds);
            }
            if (!h.rebelling) {
                extractResources(galaxy, h, timeSpan2Seconds);
            }
            if (!h.rebelling && h.owner !== null) {
                if (h.manufacturingQueue !== null) {
                    doManufacturing(galaxy, h, time, galaxyStarDate(galaxy));
                }
                if (h.constructionQueue !== null) {
                    doConstruction(galaxy, h, time);
                }
            }
            constructFacilities(galaxy, h, timeSpan2Seconds);
            if (h.owner !== null && h.owner !== galaxy.independentEmpire) {
                h.isShipYard = true;
            } else {
                h.isShipYard = false;
            }
            checkForShipsOfNewEmpiresInSystem(galaxy, h, time);
            attackEnemyTargets(galaxy, h, time);
            processPlague(galaxy, h, timeSpan2Seconds);
            reviewPirateControl(galaxy, h, timeSpan2Seconds);
            h.lastPeriodicTouch = tempNow;
        }
        // 1499-1524
        if (timeSpan4 > LONG_PROCESSING_SPAN_MS) {
            reviewWhetherRefuellingDepot(galaxy, h);
            if (galaxy.spawnNewEmpires) {
                checkHabitatIsEmpire(galaxy, h);
            }
            if (h.constructionQueue !== null && h.owner !== null) {
                reviewConstructionSpeed(galaxy, h);
            }
            regenerateDamage(galaxy, h, timeSpan4 / 1000);
            terraformColony(galaxy, h, timePassed);
            independentColoniesRecruitAndTrainTroops(galaxy, h, timePassed);
            recalculateDevelopmentLevelBaseline(h);
            recalculateAnnualTaxRevenue(galaxy, h);
            consumeResources(galaxy, h, timePassed);
            consumeAndOrderStrategicResourceSupply(galaxy, h, timePassed);
            checkForShipsNoLongerDockingHabitat(galaxy, h);
            checkForSpacePortFacilities(h);
            checkSatisfaction(galaxy, h);
            updateConqueredFactor(galaxy, h, timePassed);
            calculateMigrationFactor(galaxy, h);
            updateRaidCountdownHabitat(galaxy, h, timePassed);
            h.lastLongTouch = tempNow;
        }
        // 1525-1544
        if (timeSpan5 > HUGE_PROCESSING_SPAN_MS) {
            baconHabitatHugeProcessingSpanActions(galaxy, h);
            clearTroopsAwaitingPickup(galaxy, h);
            checkForUnownedCargoHabitat(galaxy, h);
            let empireHasWarptech = true;
            if (h.empire !== null) {
                empireHasWarptech = checkEmpireHasHyperDriveTech(h.empire);
            }
            recalculateColonyInfluenceRadius(galaxy, h, empireHasWarptech);
            if (h.empire !== null && h.empire !== galaxy.independentEmpire) {
                chanceColonyGovernorPromotion(galaxy, h.empire, h);
            }
            spawnCreatures(galaxy, h);
            reviewManufacturedResources(galaxy, h);
            checkRemoveInvalidDockingShipsFromWaitQueue(galaxy, h);
            h.lastHugeTouch = tempNow;
        }
        // 1545-1547
        h.lastTouch = tempNow;
        h.doingTasks = false;
        return true;
    }
    // 1549-1553: DoPlanetRemove runs on a new Thread in C#; synchronous here.
    if (h.explosion === null && galaxy.systems[h.systemIndex].habitats.includes(h) && galaxy.habitats.includes(h) && !h.doingRemove) {
        doPlanetRemove(galaxy, h);
    }
    h.lastTouch = tempNow;
    return false;
}
