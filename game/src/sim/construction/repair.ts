// M4h — repairs: BaconBuiltObject.cs 4763 DoRepairs (BuiltObject.cs 3498), BaconBuiltObject.cs 2166 CalculateCrewLevel,
// BuiltObject.1.cs 4474 CheckRepairMissionStillValid, BuiltObject.cs 4077 CheckForRepairs.

import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import { registerTodo, todo } from '../tick/todo';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ComponentStatus, csInt } from '../builtObjectComponent';
import { Random } from '../random';
import { captainBonuses } from '../characters';
import { clearPreviousMissionRequirements } from '../missions/assign';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { shipGroupRepairBonus, type ShipGroup } from '../fleets/shipGroup';
import { battleStatsDamageRepairedUs } from '../combat/damage';
import type { ConstructionQueue } from './constructionQueue';

/** BaconBuiltObject.cs 66-70 shipFreeRepairTimeFromCrewSkill* (seconds per component; BaconSettings.txt has the same values). */
const SHIP_FREE_REPAIR_TIME_AVERAGE = 160;
const SHIP_FREE_REPAIR_TIME_EXPERIENCED = 120;
const SHIP_FREE_REPAIR_TIME_VETERAN = 80;
const SHIP_FREE_REPAIR_TIME_ELITE = 40;
const SHIP_FREE_REPAIR_TIME_LEGENDARY = 20;

/** The clock-seeded `new Random()` of DoRepairs (plan §0): one galaxy-seed-derived stream. */
function repairClockRnd(galaxy: Galaxy): Random {
    if (galaxy.baconRepairClockRnd === null) galaxy.baconRepairClockRnd = new Random((galaxy.randomSeed ^ 0x4e9a1d27) | 0);
    return galaxy.baconRepairClockRnd;
}

/** BuiltObject.CareerBattleStats (SpaceBattleStats; M4o owns the type): WeaponsDamageToEnemy (float) / DamageToUs (int). */
interface CareerBattleStatsLike {
    weaponsDamageToEnemy: number;
    damageToUs: number;
}

/**
 * BaconBuiltObject.cs 2166 CalculateCrewLevel(main, ship): "" for non-military ships, else by career damage dealt minus
 * three times damage taken. The C# creates CareerBattleStats when null (all zero) — TODO(port) M4o: the TS BuiltObject
 * has no CareerBattleStats yet, so a missing one reads as zeros ("green").
 */
export function calculateCrewLevel(ship: BuiltObject): string {
    if (ship.role !== BuiltObjectRole.Military) return '';
    let num = 0;
    const stats = (ship as unknown as { careerBattleStats?: CareerBattleStatsLike | null }).careerBattleStats ?? null;
    const weaponsDamageToEnemy = stats !== null ? stats.weaponsDamageToEnemy : 0;
    const damageToUs = stats !== null ? stats.damageToUs : 0;
    if (ship.role === BuiltObjectRole.Military) num = csInt(Math.max(0.0, Math.fround(weaponsDamageToEnemy - Math.fround(damageToUs * 3))));
    return num >= 100 ? (num >= 3999 ? (num >= 8999 ? (num >= 15999 ? (num >= 24999 ? 'legendary' : 'elite') : 'veteran') : 'experienced') : 'average') : 'green';
}

/**
 * BaconBuiltObject.cs 4763 DoRepairs(ship, timePassed) (via BuiltObject.cs 3498). BaconBuiltObject.myMain (the UI Main)
 * is set in any running game, so its null early-out is taken as not null (as colonyTick.ts does).
 * Rnd: Galaxy.Rnd.Next(0, Components.Count) when components get repaired; the fractional-repair chance uses the
 * clock-seeded `new Random()` (galaxy-seed stream here).
 */
export function doRepairs(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    const ship = builtObject;
    let num1 = ship.damageRepair;
    let num2 = 0;
    switch (calculateCrewLevel(ship)) {
        case 'average': num2 = SHIP_FREE_REPAIR_TIME_AVERAGE; break;
        case 'experienced': num2 = SHIP_FREE_REPAIR_TIME_EXPERIENCED; break;
        case 'veteran': num2 = SHIP_FREE_REPAIR_TIME_VETERAN; break;
        case 'elite': num2 = SHIP_FREE_REPAIR_TIME_ELITE; break;
        case 'legendary': num2 = SHIP_FREE_REPAIR_TIME_LEGENDARY; break;
    }
    if (num2 !== 0 && (num2 < num1 || num1 === 0)) num1 = num2;
    if (ship.empire !== null && num1 > 0 && ship.damagedComponentCount > 0) {
        let num3 = num1;
        if (ship.shipGroup !== null) num3 /= shipGroupRepairBonus(ship.shipGroup as ShipGroup);
        // BuiltObject.CaptainRepairBonus => _CaptainRepairBonus / 100.0 (byte, 100 until ReviewCaptainBonuses runs).
        const cb = captainBonuses(ship);
        const captainRepairBonus = (cb !== null ? cb.repair : 100) / 100.0;
        const num4 = num3 / captainRepairBonus;
        let num5 = csInt(timePassed / num4);
        if (num5 === 0) {
            const num6 = timePassed / num4;
            if (repairClockRnd(galaxy).nextDouble() < num6) num5 = 1;
        }
        let componentToRepairCount = num5;
        if (componentToRepairCount > 0) {
            // Design.RepaitPriorityTemplateName (ExpansionMod repair-priority templates, set only through the player's
            // repair-priority UI / FixAI/PlayerDesignRepairTemplates) is null for every TS design, so the C# takes the
            // random-start branch. TODO(port): repair-priority templates (Main._ExpModMain.GetRepairPriorityList).
            const components = ship.components.items;
            const num8 = galaxy.rnd.next(0, components.length);
            for (let index = num8; index < components.length && componentToRepairCount > 0; ++index) {
                if (components[index].status === ComponentStatus.Damaged) {
                    components[index].status = ComponentStatus.Normal;
                    --componentToRepairCount;
                }
            }
            for (let index = 0; index < num8 && componentToRepairCount > 0; ++index) {
                if (components[index].status === ComponentStatus.Damaged) {
                    components[index].status = ComponentStatus.Normal;
                    --componentToRepairCount;
                }
            }
            ship.reDefine();
            const repairAmount = Math.max(0, num5 - componentToRepairCount);
            if (ship.battleStats !== null) battleStatsDamageRepairedUs(ship.battleStats, repairAmount);
            // ShipGroup.BattleStats (M4l/M4o) — TODO(port) M4l: the TS ShipGroup has no BattleStats yet (C# null until a
            // fleet battle starts).
        }
    }
    const mission = builtObjectMission(ship.mission);
    if (ship.damagedComponentCount !== 0 || mission === null || mission.type !== BuiltObjectMissionType.Repair) return;
    mission.clear();
}

/** BuiltObject.1.cs 4474 CheckRepairMissionStillValid (the bool result is unused by BuiltObject.DoTasks 3773). */
export function checkRepairMissionStillValid(galaxy: Galaxy, builtObject: BuiltObject): boolean {
    const mission = builtObjectMission(builtObject.mission);
    if (builtObject.subRole === BuiltObjectSubRole.ConstructionShip && builtObject.isAutoControlled && mission !== null && mission.type === BuiltObjectMissionType.BuildRepair) {
        const secondaryTargetBuiltObject = mission.secondaryTargetBuiltObject;
        if (secondaryTargetBuiltObject !== null) {
            const targetMission = builtObjectMission(secondaryTargetBuiltObject.mission);
            if (targetMission !== null && targetMission.type === BuiltObjectMissionType.Repair && (secondaryTargetBuiltObject.topSpeed > 0 || secondaryTargetBuiltObject.warpSpeed > 0)) {
                clearPreviousMissionRequirements(galaxy, builtObject);
                return false;
            }
            if (secondaryTargetBuiltObject.currentSpeed > 0) {
                clearPreviousMissionRequirements(galaxy, builtObject);
                return false;
            }
        }
    }
    return true;
}

/** BuiltObject.cs 4077 CheckForRepairs. */
export function checkForRepairs(galaxy: Galaxy, builtObject: BuiltObject): void {
    void galaxy;
    if (builtObject.builtAt !== null) {
        return;
    }
    if (builtObject.role === BuiltObjectRole.Base) {
        const ph = builtObject.parentHabitat;
        const queue = ph !== null ? (ph.constructionQueue as ConstructionQueue | null) : null;
        if (
            builtObject.unbuiltOrDamagedComponentCount > 0 &&
            ph !== null &&
            ph.population.totalAmount > 0 &&
            ph.empire === builtObject.empire &&
            queue !== null &&
            !queue.constructionWaitQueue!.includes(builtObject) &&
            queue.addBuiltObjectToConstruct(builtObject)
        ) {
            builtObject.builtAt = ph;
        }
    } else if (!builtObject.repairForNextMission && builtObject.unbuiltOrDamagedComponentCount > 0 && builtObject.builtAt === null) {
        builtObject.repairForNextMission = true;
    }
}

// ---- stub added by M4o (called from combat/damage.ts DetermineScrapDamagedShip, Galaxy.7.cs 2858) ----

const T_findNearestShipYard = registerTodo('M4h', 'findNearestShipYard');
/** Empire.5.cs 397 FindNearestShipYard(ship, canRepairOrBuild, includeVerySmallYards) — stub: null (no yard found). */
export function findNearestShipYard(galaxy: Galaxy, empire: Empire, ship: BuiltObject, canRepairOrBuild: boolean, includeVerySmallYards: boolean): BuiltObject | Habitat | null {
    void galaxy; void empire; void ship; void canRepairOrBuild; void includeVerySmallYards;
    /* TODO(port) M4h */ todo(T_findNearestShipYard);
    return null;
}
