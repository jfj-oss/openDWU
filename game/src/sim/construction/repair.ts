// M4h — repairs: BaconBuiltObject.cs 4763 DoRepairs (BuiltObject.cs 3498), BaconBuiltObject.cs 2166 CalculateCrewLevel,
// BuiltObject.1.cs 4474 CheckRepairMissionStillValid, BuiltObject.cs 4077 CheckForRepairs.

import { isAiControlled } from '../missions/playerOrder';
import type { Galaxy } from '../galaxy';
import type { BuiltObject } from '../builtObject';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ComponentStatus, csInt } from '../builtObjectComponent';
import { Random } from '../random';
import { captainBonuses } from '../characters';
import { clearPreviousMissionRequirements } from '../missions/assign';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { shipGroupRepairBonus, type ShipGroup } from '../fleets/shipGroup';
import { battleStatsDamageRepairedUs, type SpaceBattleStats } from '../combat/damage';
import type { ConstructionQueue } from './constructionQueue';
import type { Empire } from '../empire';
import { BuiltObject as BuiltObjectClass } from '../builtObject';
import { Habitat } from '../types';
import type { ComponentDefinition } from '../componentStatic';
import { assignMission } from '../missions/assign';
import { BuiltObjectMissionPriority } from '../missions/mission';
import { MAX_SOLAR_SYSTEM_SIZE, baconMovementSettings } from '../movement';
import { OrderType, empireCreateOrder } from '../logistics/orders';
import { findNearestShipYard, procureConstructionComponentsAtBuiltObject, procureConstructionComponentsAtColony } from './empireConstruction';

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
 * three times damage taken. The C# creates CareerBattleStats when null (all zero); a missing one reads as zeros here,
 * the same result (BaconSpaceBattleStats.cs 20, achievements.ts, creates it where it accumulates).
 */
export function calculateCrewLevel(ship: BuiltObject): string {
    if (ship.role !== BuiltObjectRole.Military) return '';
    let num = 0;
    const stats = ship.careerBattleStats as CareerBattleStatsLike | null;
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
            // BaconBuiltObject.cs 4855: ShipGroup.BattleStats.DamageRepairedUs (null until a fleet battle starts). Combat
            // verification part 2: this was left out when ShipGroup.battleStats landed.
            const groupStats = ship.shipGroup !== null ? ((ship.shipGroup as ShipGroup).battleStats as SpaceBattleStats | null) : null;
            if (groupStats !== null) battleStatsDamageRepairedUs(groupStats, repairAmount);
        }
    }
    const mission = builtObjectMission(ship.mission);
    if (ship.damagedComponentCount !== 0 || mission === null || mission.type !== BuiltObjectMissionType.Repair) return;
    mission.clear();
}

/** BuiltObject.1.cs 4474 CheckRepairMissionStillValid (the bool result is unused by BuiltObject.DoTasks 3773). */
export function checkRepairMissionStillValid(galaxy: Galaxy, builtObject: BuiltObject): boolean {
    const mission = builtObjectMission(builtObject.mission);
    if (builtObject.subRole === BuiltObjectSubRole.ConstructionShip && isAiControlled(builtObject) && mission !== null && mission.type === BuiltObjectMissionType.BuildRepair) {
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

// ---- Empire.4.cs 4863 AssignRepairMission (stub added by M4e for logistics/refuel.ts AutoRefuelRepairShip; ported at the
// wave-4 M4s2 merge, where pirate AssignMissionsToBuiltObjectList (BaconEmpire PirateShipMissions) first reached it) ----

/**
 * Empire.4.cs 4863-4914 AssignRepairMission(builtObject): FindNearestShipYard(builtObject, canRepairOrBuild: true,
 * includeVerySmallYards: true); a non-warp ship too far away gives up; orders ConstructionShortage resources for the
 * unbuilt components (ResolveUnbuiltComponents 4916), then ClearPreviousMissionRequirements + AssignMission(Repair, yard,
 * null, VeryHigh) → true. No Rnd in the body. `empire` is the C# `this` (unused by the body beyond its helpers).
 */
export function assignRepairMission(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject): boolean {
    const actualEmpire = builtObject.actualEmpire;
    if (actualEmpire === null || actualEmpire === galaxy.independentEmpire) return false;
    if (builtObject.role !== BuiltObjectRole.Base && builtObject.topSpeed <= 0) return false;
    const stellarObject = findNearestShipYard(galaxy, empire, builtObject, true, true);
    if (stellarObject !== null) {
        const num = galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, stellarObject.xpos, stellarObject.ypos);
        if (builtObject.warpSpeed <= 0 && num > baconMovementSettings.hyperJumpThreshhold && (builtObject.topSpeed <= 0 || !(num < MAX_SOLAR_SYSTEM_SIZE))) {
            return false;
        }
    }
    if (stellarObject !== null) {
        if (builtObject.unbuiltComponentCount > 0) {
            const componentList = resolveUnbuiltComponents(builtObject);
            if (componentList.length > 0) {
                if (stellarObject instanceof BuiltObjectClass) {
                    const resourcesToOrder = procureConstructionComponentsAtBuiltObject(galaxy, empire, builtObject, stellarObject, true, componentList);
                    for (const item of resourcesToOrder.items) {
                        empireCreateOrder(galaxy, empire, stellarObject, item.commodity, item.amount, false, OrderType.ConstructionShortage);
                    }
                } else if (stellarObject instanceof Habitat) {
                    const resourcesToOrder = procureConstructionComponentsAtColony(galaxy, empire, builtObject, stellarObject, componentList);
                    for (const item2 of resourcesToOrder.items) {
                        empireCreateOrder(galaxy, empire, stellarObject, item2.commodity, item2.amount, false, OrderType.ConstructionShortage);
                    }
                }
            }
        }
        clearPreviousMissionRequirements(galaxy, builtObject);
        assignMission(galaxy, builtObject, BuiltObjectMissionType.Repair, stellarObject, null, BuiltObjectMissionPriority.VeryHigh);
        return true;
    }
    return false;
}

/** Empire.4.cs 4916 ResolveUnbuiltComponents: `new Component(ComponentID)` for each Unbuilt component, in order. */
function resolveUnbuiltComponents(builtObject: BuiltObject): ComponentDefinition[] {
    const componentList: ComponentDefinition[] = [];
    for (let i = 0; i < builtObject.components.items.length; i++) {
        const builtObjectComponent = builtObject.components.items[i];
        if (builtObjectComponent.status === ComponentStatus.Unbuilt) componentList.push(builtObjectComponent.def);
    }
    return componentList;
}
