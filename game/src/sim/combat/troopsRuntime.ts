// M4q — troop recruitment/disbanding, healing, garrison pickup, troop missions.
//
// Ports (statement for statement, same Galaxy.Rnd draw order):
//   Empire.4.cs 3908 RecruitAttackTroops, 1627 DisbandExcessTroops; BuiltObject.cs 4047 HealTroops;
//   Habitat.cs 2914 IndependentColoniesRecruitAndTrainTroops, 2599 ClearTroopsAwaitingPickup;
//   HabitatList.cs 339 GetHabitatsWithCompletedFacilities; BaconHabitat.cs 575 / 608 HandlePlayerPrisoners /
//   HandleAIPrisoners (+ GetSpiesInPrison 566).
// Galaxy.Rnd: none in the functions above.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { empireGovernmentAttributes } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { ShipGroup } from '../fleets/shipGroup';
import { registerTodo, todo } from '../tick/todo';
import type { CommandContext } from '../missions/executeCommands';
import { TroopList, TroopType, type Troop } from '../cargo';
import { generateNewTroop, raceTroopNameFallback, troopLevelRequired, calculateCostPerTroop } from '../troops';
import { PlanetaryFacilityType } from '../researchSystem';
import { checkTroopFacilitiesPresent, facilitiesFindCompletedByType, calculateAccurateAnnualCashflowIncludingUnderConstruction } from '../construction/facilities';
import { calculateAccurateAnnualCashflow } from '../construction/empireConstruction';
import { ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND, SPENDING_TROOP_PERCENTAGE, annualPirateProtection, annualSubjugationTribute, annualTroopMaintenanceIncludeRecruiting, calculateAccurateAnnualIncome, totalColonyStrategicValue } from '../forceStructure';
import { annualStateMaintenanceExcludingUnderConstruction } from '../treasury';
import { raceAggressionLevel, raceChangePeriodActive } from '../colonyTick';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../tick/simTime';
import { conditionCheckLimit } from '../tick/builtObjectTick';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { CharacterSkillType, empireLeader, ensureHabitatInvadingCharacters, ensureStellarObjectCharacters, getHighestSkillLevel, resolveLocationsToDefend, type Character } from '../characters';
import type { Race } from '../data/races';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectMission, BuiltObjectMissionPriority, isBuiltObject, isHabitat } from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../missions/assign';
import { checkAtWar } from '../forceStructure';
import { calculateDefaultTroopMaintenanceMultiplier, troopLevelMinimum } from '../troops';
import { shipGroupCheckAnyShipsInBattle, shipGroupGetTroopCountsByType, shipGroupGetTroopLoadoutTargetAmounts, shipGroupIsShipAvailable, shipGroupTotalTroopCount } from '../fleets/shipGroupTasks';
import { withinFuelRange } from '../movement';
import { dockingBayIndexOfShip } from '../logistics/docking';
import { habitatInvadingCharacterList, stellarObjectCharacters } from '../characters';
import { netSort } from '../netSort';
import { compareDouble } from '../diplomacyTick';
import { assignFleetUnloadTroops } from './invasion';
import { listRemove } from '../researchSystem';
import { handleAIPrisoners, handlePlayerPrisoners } from '../espionagePrisoners';

const f32 = Math.fround;

/** Galaxy.3.cs 5014 TroopAnnualRecruitmentAmount. */
const TROOP_ANNUAL_RECRUITMENT_AMOUNT = 150;

/** Race.cs 366 CautionLevel: PeriodicCautionLevel (file value clamped to [50, 200], default 100) while ChangePeriodActive. */
function raceCautionLevel(galaxy: Galaxy, race: Race): number {
    if (!raceChangePeriodActive(galaxy, race)) return race.caution;
    const raw = race.extra?.['PeriodicFactorsCaution'];
    if (raw === undefined) return 100;
    const t = raw.trim();
    const n = /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : 100;
    return Math.max(50, Math.min(n, 200));
}

/** HabitatList.cs 339 GetHabitatsWithCompletedFacilities(facilityType). */
export function getHabitatsWithCompletedFacilities(list: readonly Habitat[], facilityType: PlanetaryFacilityType): Habitat[] {
    const completedFacilities: Habitat[] = [];
    for (let index = 0; index < list.length; ++index) {
        const habitat = list[index];
        if (habitat != null && habitat.facilities !== null && facilitiesFindCompletedByType(habitat.facilities, facilityType) !== null) completedFacilities.push(habitat);
    }
    return completedFacilities;
}

/** Empire.4.cs 3908 RecruitAttackTroops. No Rnd. */
export function recruitAttackTroops(galaxy: Galaxy, empire: Empire): void {
    if (!empire.controlTroopGeneration || empire.colonies == null || empire.troops == null) {
        return;
    }
    const policy = empire.policy!;
    const num = empire.troops.countByType(TroopType.Armored);
    const num2 = empire.troops.countByType(TroopType.SpecialForces);
    const val = Math.trunc(empire.colonies.length * 1.0 * policy.troopRecruitArmorLevel);
    const num3 = Math.max(val, Math.trunc((totalColonyStrategicValue(empire) / 150000.0) * policy.troopRecruitArmorLevel));
    const val2 = Math.trunc(empire.colonies.length * 0.3 * policy.troopRecruitSpecialForcesLevel);
    const num4 = Math.max(val2, Math.trunc((totalColonyStrategicValue(empire) / 600000.0) * policy.troopRecruitSpecialForcesLevel));
    const num5 = calculateCostPerTroop(empire, TroopType.Armored, null, null);
    calculateCostPerTroop(empire, TroopType.Artillery, null, null);
    calculateCostPerTroop(empire, TroopType.SpecialForces, null, null);
    let num6 = Math.max(0, num3 - num);
    let num7 = Math.max(0, num4 - num2);
    if (!empire.troopCanRecruitArmored) {
        num6 = 0;
    }
    if (!empire.troopCanRecruitSpecialForces) {
        num7 = 0;
    }
    const num8 = num6 * num5;
    const num9 = num7 * num5;
    const num10 = num8 + num9;
    const { cashflow: num11, annualEmpireExpenses } = calculateAccurateAnnualCashflowIncludingUnderConstruction(galaxy, empire);
    const num12 = empire.stateMoney / annualEmpireExpenses;
    let flag = false;
    const num14 = num11 - num10;
    if (num14 > 0.0) {
        flag = true;
    } else if (num12 >= ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND) {
        flag = true;
    } else if (num11 > 0.0) {
        // num13 = num11 / num10 (unused).
        flag = true;
    }
    if (!flag) {
        return;
    }
    if (num6 > 0 && empire.troopCanRecruitArmored) {
        const habitatsWithCompletedFacilities = getHabitatsWithCompletedFacilities(empire.colonies, PlanetaryFacilityType.ArmoredFactory);
        for (let i = 0; i < habitatsWithCompletedFacilities.length; i++) {
            const habitat = habitatsWithCompletedFacilities[i];
            if (habitat != null && !habitat.hasBeenDestroyed && habitat.empire === empire && habitat.troopsToRecruit !== null && habitat.population != null && habitat.population.dominantRace !== null) {
                const dominantRace = habitat.population.dominantRace;
                const troopStrength = dominantRace.troopStrength;
                const troop = generateNewTroop(empire.generateTroopDescription(raceTroopNameFallback(dominantRace, dominantRace.troopNameArmored)), TroopType.Armored, troopStrength, empire, dominantRace);
                if (troop !== null) {
                    troop.colony = habitat;
                    troop.readiness = 0;
                    habitat.troopsToRecruit.add(troop);
                    empire.troops.add(troop);
                }
                num6--;
                if (num6 <= 0) {
                    break;
                }
            }
        }
    }
    if (num7 <= 0 || !empire.troopCanRecruitSpecialForces) {
        return;
    }
    const habitatsWithCompletedFacilities2 = getHabitatsWithCompletedFacilities(empire.colonies, PlanetaryFacilityType.MilitaryAcademy);
    for (let j = 0; j < habitatsWithCompletedFacilities2.length; j++) {
        const habitat2 = habitatsWithCompletedFacilities2[j];
        if (habitat2 != null && !habitat2.hasBeenDestroyed && habitat2.empire === empire && habitat2.troopsToRecruit !== null && habitat2.population != null && habitat2.population.dominantRace !== null) {
            const dominantRace2 = habitat2.population.dominantRace;
            const troopStrength2 = dominantRace2.troopStrength;
            const troop2 = generateNewTroop(empire.generateTroopDescription(raceTroopNameFallback(dominantRace2, dominantRace2.troopNameSpecialForces)), TroopType.SpecialForces, troopStrength2, empire, dominantRace2);
            if (troop2 !== null) {
                troop2.colony = habitat2;
                troop2.readiness = 0;
                habitat2.troopsToRecruit.add(troop2);
                empire.troops.add(troop2);
            }
            num7--;
            if (num7 <= 0) {
                break;
            }
        }
    }
}

/** Troop.Empire = null (the loosely typed cargo.ts field). */
function clearTroopEmpire(troop: Troop): void {
    troop.empire = null;
}

/** Empire.4.cs 1627 DisbandExcessTroops. No Rnd. */
export function disbandExcessTroops(galaxy: Galaxy, empire: Empire): void {
    if (empire.troops == null || empire.dominantRace === null || empire.colonies == null || empire.builtObjects == null) {
        return;
    }
    const num = calculateAccurateAnnualIncome(galaxy, empire);
    const num2 = raceAggressionLevel(galaxy, empire.dominantRace) / 100.0;
    const num3 = raceCautionLevel(galaxy, empire.dominantRace) / 100.0;
    const num4 = ((num2 + num3) / 2.0) * SPENDING_TROOP_PERCENTAGE;
    const num5 = annualTroopMaintenanceIncludeRecruiting(empire) / num;
    const count = empire.troops.count;
    const num6 = annualStateMaintenanceExcludingUnderConstruction(empire) + annualSubjugationTribute(galaxy, empire) + annualTroopMaintenanceIncludeRecruiting(empire) + annualPirateProtection(empire);
    const num7 = empire.stateMoney / num6;
    const num8 = calculateAccurateAnnualCashflow(galaxy, empire);
    if (!(num8 < 0.0) || !(num7 < ALLOWABLE_YEARS_MAINTENANCE_FROM_CASH_ON_HAND) || !(num5 > num4)) {
        return;
    }
    let num9 = csDoubleToInt(1.0 + (num5 - num4) * count);
    if (num9 > count) {
        num9 = count;
    }
    let num10 = 0;
    if (num10 < num9) {
        const stellarObjectList = resolveLocationsToDefend(galaxy, empire, false);
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat = empire.colonies[i];
            if (
                habitat == null ||
                habitat.troops === null ||
                stellarObjectList.includes(habitat) ||
                habitat.troops.count <= 0 ||
                Math.trunc(habitat.troops.totalDefendStrengthExcludeReadiness / 100) <= csDoubleToInt(troopLevelRequired(galaxy, habitat, galaxy.difficultyLevel) * 0.5) ||
                checkTroopFacilitiesPresent(habitat) ||
                habitat.defensiveFortressBonus > 0
            ) {
                continue;
            }
            const troop = habitat.troops.items[0];
            if (troop != null) {
                const troopEmpire = troop.empire as Empire | null;
                if (troopEmpire !== null && troopEmpire.troops != null) {
                    troopEmpire.troops.remove(troop);
                }
                troop.colony = null;
                troop.builtObject = null;
                clearTroopEmpire(troop);
                habitat.troops.items.splice(0, 1);
                num10++;
                if (num10 >= num9) {
                    break;
                }
            }
        }
    }
    if (num10 < num9) {
        for (let j = 0; j < empire.builtObjects.length; j++) {
            const builtObject = empire.builtObjects[j];
            if (builtObject == null || builtObject.troops === null || builtObject.troops.count <= 0 || builtObject.subRole === BuiltObjectSubRole.TroopTransport || !builtObject.isAutoControlled) {
                continue;
            }
            let flag = true;
            const mission = builtObjectMission(builtObject.mission);
            if (mission !== null && (mission.type === BuiltObjectMissionType.Attack || mission.type === BuiltObjectMissionType.WaitAndAttack) && mission.targetHabitat !== null) {
                flag = false;
            }
            if (!flag || builtObject.troops.count <= 0) {
                continue;
            }
            const troop2 = builtObject.troops.items[0];
            const troop2Empire = troop2 != null ? (troop2.empire as Empire | null) : null;
            if (troop2 != null && troop2Empire !== null && troop2Empire.troops != null) {
                troop2Empire.troops.remove(troop2);
                troop2.builtObject = null;
                troop2.colony = null;
                clearTroopEmpire(troop2);
                builtObject.troops.items.splice(0, 1);
                num10++;
                if (num10 >= num9) {
                    break;
                }
            }
        }
    }
    if (num10 >= num9) {
        return;
    }
    for (let k = 0; k < empire.builtObjects.length; k++) {
        const builtObject2 = empire.builtObjects[k];
        if (builtObject2 == null || builtObject2.troops === null || builtObject2.troops.count <= 0 || !builtObject2.isAutoControlled) {
            continue;
        }
        const troop3 = builtObject2.troops.items[0];
        const troop3Empire = troop3 != null ? (troop3.empire as Empire | null) : null;
        if (troop3 != null && troop3Empire !== null && troop3Empire.troops != null) {
            troop3Empire.troops.remove(troop3);
            troop3.builtObject = null;
            troop3.colony = null;
            clearTroopEmpire(troop3);
            builtObject2.troops.items.splice(0, 1);
            num10++;
            if (num10 >= num9) {
                break;
            }
        }
    }
}

/** C# (int)double on x86/x64: NaN / out of range → int.MinValue. */
function csDoubleToInt(v: number): number {
    if (!Number.isFinite(v) || v >= 2147483648 || v <= -2147483649) return -2147483648;
    return Math.trunc(v);
}

/** BuiltObject.cs 4047 HealTroops(timePassed). No Rnd. */
export function healTroops(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    void galaxy;
    const self = builtObject;
    if (self.troops === null || self.troops.count <= 0 || self.medicalCapacity <= 0) {
        return;
    }
    let num = (self.medicalCapacity / 500.0) * timePassed;
    const empire = self.empire;
    const gov = empire !== null ? empireGovernmentAttributes(empire) : null;
    if (empire !== null && gov !== null) {
        num *= gov.troopRecruitment;
        const leader = empireLeader(empire);
        if (leader !== null) {
            num *= 1.0 + leader.troopRecoveryRate / 100.0;
        }
    }
    const characters = self.characters as Character[] | null;
    if (characters !== null && characters.length > 0) {
        const highestSkillLevel = getHighestSkillLevel(characters, CharacterSkillType.TroopRecoveryRate);
        num *= 1.0 + highestSkillLevel / 100.0;
    }
    for (const troop of self.troops.items) {
        troop.readiness = f32(troop.readiness + f32(num));
        if (troop.readiness > 100) {
            troop.readiness = 100;
        }
    }
}

/** Habitat.cs 2914 IndependentColoniesRecruitAndTrainTroops(timePassed). No Rnd. */
export function independentColoniesRecruitAndTrainTroops(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    const self = habitat;
    if (self.empire !== galaxy.independentEmpire || self.population == null) {
        return;
    }
    if (self.troops === null) {
        self.troops = new TroopList();
    }
    if (self.troopsToRecruit === null) {
        self.troopsToRecruit = new TroopList();
    }
    if (self.invadingTroops === null) {
        self.invadingTroops = new TroopList();
    }
    ensureStellarObjectCharacters(self);
    ensureHabitatInvadingCharacters(self);
    const num = csDoubleToInt(troopLevelRequired(galaxy, self, galaxy.difficultyLevel) / 1.0);
    let num2 = Math.trunc(self.troops.totalDefendStrength / 100);
    num2 += self.troopsToRecruit.count * 100;
    if (num2 < num) {
        const dominantRace = self.population.dominantRace!;
        let num3 = f32(dominantRace.troopStrength);
        if (self.ruin !== null) {
            num3 = csDoubleToInt(num3 * (1.0 + self.ruin.bonusDefensive));
        }
        // string.Format(GetText("RACENAME Militia"), dominantRace) — Race.ToString() is the race name.
        const troop = generateNewTroop(`${dominantRace.name} Militia`, TroopType.Infantry, Math.trunc(num3), galaxy.independentEmpire, dominantRace);
        troop.readiness = 0;
        troop.colony = self;
        self.troopsToRecruit.add(troop);
    }
    let num4 = TROOP_ANNUAL_RECRUITMENT_AMOUNT * (timePassed / REAL_SECONDS_IN_GALACTIC_YEAR);
    if (self.ruin !== null) {
        num4 *= 1.0 + self.ruin.bonusDefensive;
    }
    if (self.troopsToRecruit.count <= 0) {
        return;
    }
    const iterationCount = { count: 0 };
    while (conditionCheckLimit(num4 > 0.0 && self.troopsToRecruit.count > 0, 50, iterationCount)) {
        const troop2 = self.troopsToRecruit.items[0];
        troop2.readiness = f32(troop2.readiness + f32(num4));
        num4 = 0.0;
        if (troop2.readiness >= 100) {
            num4 = f32(troop2.readiness - 100);
            troop2.readiness = 100;
            troop2.colony = self;
            self.troops.add(troop2);
            self.troopsToRecruit.items.splice(0, 1);
        }
    }
}

/** Habitat.cs 2599 ClearTroopsAwaitingPickup. No Rnd. */
export function clearTroopsAwaitingPickup(galaxy: Galaxy, habitat: Habitat): void {
    void galaxy;
    if (habitat.troops === null || habitat.troops.count <= 0) {
        return;
    }
    for (let i = 0; i < habitat.troops.count; i++) {
        const troop = habitat.troops.items[i];
        if (troop.awaitingPickup) {
            troop.awaitingPickup = false;
        }
    }
}

/**
 * BaconHabitat.cs 575 HandlePlayerPrisoners / 608 HandleAIPrisoners (captured spies, BaconValues "capturedSpies"; clock
 * Randoms only). Added by M4j (BaconHabitat.HugeProcessingSpanActions, colonyTick.ts); the handlers are ported by M4z2
 * (espionagePrisoners.ts).
 */
export function baconHabitatHandlePrisoners(galaxy: Galaxy, habitat: Habitat, isPlayer: boolean): void {
    if (isPlayer) handlePlayerPrisoners(galaxy, habitat);
    else handleAIPrisoners(galaxy, habitat);
}

// ---------------------------------------------------------------------------------------------------------------
// Troop missions: Empire.5.cs 529-907, ShipGroup.cs 124, BuiltObject.cs 1717
// ---------------------------------------------------------------------------------------------------------------

/** Empire.ColoniesNeedingTroops (Empire.cs 301: nothing in the C# ever adds to it, so it stays empty). */
function coloniesNeedingTroops(empire: Empire): Habitat[] {
    return empire.coloniesNeedingTroops;
}

/** Empire.5.cs 744 AssignUnloadTroopsAtColonyNeedingThemMission(ship, colony). Rnd: AssignMission draws. */
function assignUnloadTroopsAtColonyNeedingThemMissionShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject | null, colony: Habitat | null): boolean {
    const list = coloniesNeedingTroops(empire);
    if (ship !== null && colony !== null && colony.empire === empire && list !== null && list.includes(colony) && ship.troops!.count > 0) {
        assignMission(galaxy, ship, BuiltObjectMissionType.UnloadTroops, colony, null, BuiltObjectMissionPriority.Normal);
        listRemove(list, colony);
        return true;
    }
    return false;
}

/** Empire.5.cs 727 CheckAssignUnloadTroopsAtColonyNeedingThemMission(ship). Rnd: the mission's draws. */
export function checkAssignUnloadTroopsAtColonyNeedingThemMissionShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject): boolean {
    const list = coloniesNeedingTroops(empire);
    if (list !== null && list.length > 0 && ship !== null && ship.troops !== null && ship.troops.count > 0 && !checkAtWar(empire)) {
        const num = 65000;
        for (let i = 0; i < list.length; i++) {
            const habitat = list[i];
            if (habitat != null && habitat.troops !== null && habitat.troops.totalAttackStrength < num) {
                return assignUnloadTroopsAtColonyNeedingThemMissionShip(galaxy, empire, ship, habitat);
            }
        }
    }
    return false;
}

/** Empire.5.cs 772 AssignUnloadTroopsAtColonyNeedingThemMission(fleet, colony). */
function assignUnloadTroopsAtColonyNeedingThemMissionFleet(galaxy: Galaxy, empire: Empire, fleet: ShipGroup | null, colony: Habitat | null): boolean {
    const list = coloniesNeedingTroops(empire);
    if (fleet !== null && colony !== null && colony.empire === empire && list !== null && list.includes(colony) && shipGroupTotalTroopCount(fleet) > 0 && assignFleetUnloadTroops(galaxy, empire, fleet, colony, false)) {
        listRemove(list, colony);
        return true;
    }
    return false;
}

/** Empire.5.cs 755 CheckAssignUnloadTroopsAtColonyNeedingThemMission(fleet). */
export function checkAssignUnloadTroopsAtColonyNeedingThemMission(galaxy: Galaxy, empire: Empire, shipGroup: ShipGroup): boolean {
    const fleet = shipGroup;
    const list = coloniesNeedingTroops(empire);
    if (list !== null && list.length > 0 && fleet !== null && fleet.ships !== null && shipGroupTotalTroopCount(fleet) > 0 && !checkAtWar(empire)) {
        const num = 65000;
        for (let i = 0; i < list.length; i++) {
            const habitat = list[i];
            if (habitat != null && habitat.troops !== null && habitat.troops.totalAttackStrength < num) {
                return assignUnloadTroopsAtColonyNeedingThemMissionFleet(galaxy, empire, fleet, habitat);
            }
        }
    }
    return false;
}

/** Empire.5.cs 797 AssignGarrisonTroopsAtPenalColonyMission(ship, penalColony). Rnd: AssignMission draws. */
function assignGarrisonTroopsAtPenalColonyMission(galaxy: Galaxy, empire: Empire, ship: BuiltObject | null, penalColony: Habitat | null): boolean {
    if (ship !== null && penalColony !== null && penalColony.empire === empire && empire.penalColonies !== null && empire.penalColonies.includes(penalColony) && ship.troops!.count > 0) {
        assignMission(galaxy, ship, BuiltObjectMissionType.UnloadTroops, penalColony, null, BuiltObjectMissionPriority.Normal);
        return true;
    }
    return false;
}

/** Empire.5.cs 782 CheckAssignGarrisonTroopsAtPenalColonyMission(ship). */
export function checkAssignGarrisonTroopsAtPenalColonyMission(galaxy: Galaxy, empire: Empire, ship: BuiltObject): boolean {
    if (ship !== null && ship.troops !== null && ship.troops.count > 0 && empire.penalColonies !== null) {
        for (let i = 0; i < empire.penalColonies.length; i++) {
            const habitat = empire.penalColonies[i];
            if (habitat != null && habitat.troops !== null && Math.trunc(habitat.troops.totalDefendStrength / 100) < troopLevelRequired(galaxy, habitat, galaxy.difficultyLevel)) {
                return assignGarrisonTroopsAtPenalColonyMission(galaxy, empire, ship, habitat);
            }
        }
    }
    return false;
}

/** TroopList.cs 402 GetTroopsNotGarrisonedNotAwaitingPickup(). */
function getTroopsNotGarrisonedNotAwaitingPickup(list: TroopList): TroopList {
    const result = new TroopList();
    for (let index = 0; index < list.count; ++index) {
        const troop = list.items[index];
        if (troop != null && !troop.garrisoned && !troop.awaitingPickup) result.add(troop);
    }
    return result;
}
/** TroopList.cs 249 GetFirstNonGarrisoned(troopType) (Undefined = any type). */
function getFirstNonGarrisoned(list: TroopList, troopType: TroopType): Troop | null {
    for (let index = 0; index < list.count; ++index) {
        const t = list.items[index];
        if (t != null && (troopType === TroopType.Undefined || t.type === troopType) && !t.garrisoned) return t;
    }
    return null;
}
/** TroopList.cs 260 GetFirstNonGarrisonedWithinSize(troopType, maximumSize). */
function getFirstNonGarrisonedWithinSize(list: TroopList, troopType: TroopType, maximumSize: number): Troop | null {
    for (let index = 0; index < list.count; ++index) {
        const t = list.items[index];
        if (t != null && (troopType === TroopType.Undefined || t.type === troopType) && !t.garrisoned && t.size <= maximumSize) return t;
    }
    return null;
}
/** TroopList.cs TotalDefendStrengthNotGarrisonedNotAwaitingPickup / NotGarrisoned / Garrisoned: (int) of a double sum of DefendStrength × Readiness. */
function totalDefendStrengthWhere(list: TroopList, pred: (t: Troop) => boolean): number {
    let total = 0.0;
    for (const troop of list.items) if (pred(troop)) total += troop.defendStrength * troop.readiness;
    return Math.trunc(total);
}

/** BuiltObject.cs 1717 GetTroopLoadoutTargetAmounts(out infantry, out artillery, out armor, out specialForces). No Rnd. */
export function builtObjectGetTroopLoadoutTargetAmounts(bo: BuiltObject): { infantryAmount: number; artilleryAmount: number; armorAmount: number; specialForcesAmount: number } {
    let infantryAmount = bo.troopLoadoutInfantry;
    let artilleryAmount = bo.troopLoadoutArtillery;
    let armorAmount = bo.troopLoadoutArmored;
    let specialForcesAmount = bo.troopLoadoutSpecialForces;
    if (infantryAmount === 0 && artilleryAmount === 0 && armorAmount === 0 && specialForcesAmount === 0) {
        infantryAmount = Math.trunc(bo.troopCapacity / 100);
    } else if (infantryAmount === 255 && artilleryAmount === 255 && armorAmount === 255 && specialForcesAmount === 255) {
        infantryAmount = Math.trunc(bo.troopCapacity / 100);
        artilleryAmount = 0;
        armorAmount = 0;
        specialForcesAmount = 0;
    }
    if (bo.empire !== null) {
        const num = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.Infantry));
        const num2 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.Armored));
        const num3 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.Artillery));
        const num4 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.SpecialForces));
        if (!bo.empire.troopCanRecruitSpecialForces) {
            armorAmount += Math.trunc((specialForcesAmount * num4) / num2);
            specialForcesAmount = 0;
        }
        if (!bo.empire.troopCanRecruitArmored) {
            infantryAmount += Math.trunc((armorAmount * num2) / num);
            armorAmount = 0;
        }
        if (!bo.empire.troopCanRecruitArtillery) {
            infantryAmount += Math.trunc((artilleryAmount * num3) / num);
            artilleryAmount = 0;
        }
    }
    return { infantryAmount, artilleryAmount, armorAmount, specialForcesAmount };
}

/** A ship's (or its fleet's) troop loadout targets (the ShipGroup / BuiltObject GetTroopLoadoutTargetAmounts choice). */
function loadoutTargets(ship: BuiltObject): { infantryAmount: number; artilleryAmount: number; armorAmount: number; specialForcesAmount: number } {
    const shipGroup = ship.shipGroup as ShipGroup | null;
    return shipGroup !== null ? shipGroupGetTroopLoadoutTargetAmounts(shipGroup) : builtObjectGetTroopLoadoutTargetAmounts(ship);
}

/** Empire.5.cs 691 CalculateTroopStrengthToBePickedUp(colony, out remainingTroops). No Rnd. */
export function calculateTroopStrengthToBePickedUp(empire: Empire, colony: Habitat | null): { strength: number; remainingTroops: TroopList } {
    let num = 0;
    let remainingTroops = new TroopList();
    if (colony !== null && colony.troops !== null) {
        remainingTroops = getTroopsNotGarrisonedNotAwaitingPickup(colony.troops);
        for (let i = 0; i < empire.builtObjects.length; i++) {
            const builtObject = empire.builtObjects[i];
            if (builtObject == null || builtObject.troopCapacity <= 0) continue;
            const mission = builtObjectMission(builtObject.mission);
            if (mission === null || mission.type !== BuiltObjectMissionType.LoadTroops || mission.targetHabitat === null || mission.targetHabitat !== colony || mission.troops === null) continue;
            num += mission.troops.totalDefendStrength;
            for (let j = 0; j < mission.troops.count; j++) {
                const troop = mission.troops.items[j];
                if (troop != null && remainingTroops.contains(troop)) remainingTroops.remove(troop);
            }
        }
    }
    return { strength: num, remainingTroops };
}

/**
 * Empire.5.cs 545 FindNearestColonyWithExcessTroops(ship, enforceMinimumTroopLimits, out prefilteredTroopsNotBeingPickedUp,
 * allowTroopTypeFallback). No Rnd.
 */
export function findNearestColonyWithExcessTroops(galaxy: Galaxy, empire: Empire, ship: BuiltObject | null, enforceMinimumTroopLimits: boolean, allowTroopTypeFallback: boolean): { habitat: Habitat | null; prefilteredTroopsNotBeingPickedUp: TroopList } {
    let num = Number.MAX_VALUE;
    let habitat: Habitat | null = null;
    let prefilteredTroopsNotBeingPickedUp = new TroopList();
    if (ship !== null && ship.troops !== null && ship.empire !== null) {
        const { infantryAmount, artilleryAmount, armorAmount, specialForcesAmount } = loadoutTargets(ship);
        const shipGroup = ship.shipGroup as ShipGroup | null;
        let infantryCount: number;
        let armorCount: number;
        let artilleryCount: number;
        let specialForcesCount: number;
        if (shipGroup !== null) {
            const c = shipGroupGetTroopCountsByType(shipGroup);
            infantryCount = c.infantryCount;
            artilleryCount = c.artilleryCount;
            armorCount = c.armorCount;
            specialForcesCount = c.specialForcesCount;
        } else {
            infantryCount = ship.troops.countByType(TroopType.Infantry);
            artilleryCount = ship.troops.countByType(TroopType.Artillery);
            armorCount = ship.troops.countByType(TroopType.Armored);
            specialForcesCount = ship.troops.countByType(TroopType.SpecialForces);
        }
        let flag = infantryAmount > 0 && infantryCount < infantryAmount;
        let flag2 = armorAmount > 0 && armorCount < armorAmount;
        let flag3 = artilleryAmount > 0 && artilleryCount < artilleryAmount;
        let flag4 = specialForcesAmount > 0 && specialForcesCount < specialForcesAmount;
        if (shipGroup === null && ship.troopLoadoutInfantry === 255 && ship.troopLoadoutArmored === 255 && ship.troopLoadoutArtillery === 255 && ship.troopLoadoutSpecialForces === 255) {
            flag = true;
            flag2 = true;
            flag3 = true;
            flag4 = true;
        } else if (shipGroup !== null && shipGroup.troopLoadoutInfantry === 255 && shipGroup.troopLoadoutArmored === 255 && shipGroup.troopLoadoutArtillery === 255 && shipGroup.troopLoadoutSpecialForces === 255) {
            flag = true;
            flag2 = true;
            flag3 = true;
            flag4 = true;
        }
        const num2 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.Infantry));
        const num3 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.Armored));
        const num4 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.Artillery));
        const num5 = Math.trunc(100.0 * calculateDefaultTroopMaintenanceMultiplier(TroopType.SpecialForces));
        const troopCapacityRemaining = ship.troopCapacityRemaining;
        if (flag && troopCapacityRemaining < num2) flag = false;
        if (flag3 && troopCapacityRemaining < num4) flag3 = false;
        if (flag2 && troopCapacityRemaining < num3) flag2 = false;
        if (flag4 && troopCapacityRemaining < num5) flag4 = false;
        for (let i = 0; i < empire.colonies.length; i++) {
            const habitat2 = empire.colonies[i];
            if (habitat2.invadingTroops !== null && habitat2.invadingTroops.count > 0) continue;
            let num6 = troopLevelMinimum(galaxy, habitat2, galaxy.difficultyLevel) * 100;
            if (!enforceMinimumTroopLimits) num6 = -1;
            if (habitat2.troops === null || habitat2.troops.totalDefendStrength <= num6 || habitat2.troops.count <= 0 || totalDefendStrengthWhere(habitat2.troops, (t) => !t.garrisoned && !t.awaitingPickup) <= 0) continue;
            const { strength: num7, remainingTroops } = calculateTroopStrengthToBePickedUp(empire, habitat2);
            let num8 = totalDefendStrengthWhere(habitat2.troops, (t) => !t.garrisoned);
            if (enforceMinimumTroopLimits) {
                const totalDefendStrengthGarrisoned = totalDefendStrengthWhere(habitat2.troops, (t) => t.garrisoned);
                if (num6 > totalDefendStrengthGarrisoned) num8 -= num6 - totalDefendStrengthGarrisoned;
            }
            num8 -= num7;
            if (num8 <= 0) continue;
            let flag5 = false;
            const firstNonGarrisoned = getFirstNonGarrisoned(habitat2.troops, TroopType.SpecialForces);
            const firstNonGarrisoned2 = getFirstNonGarrisoned(habitat2.troops, TroopType.Armored);
            const firstNonGarrisoned3 = getFirstNonGarrisoned(habitat2.troops, TroopType.Artillery);
            const firstNonGarrisoned4 = getFirstNonGarrisoned(habitat2.troops, TroopType.Infantry);
            if (flag4 && firstNonGarrisoned !== null) flag5 = true;
            if (flag2 && firstNonGarrisoned2 !== null) flag5 = true;
            if (flag3 && firstNonGarrisoned3 !== null) flag5 = true;
            if (flag && firstNonGarrisoned4 !== null) flag5 = true;
            if (!flag5 && allowTroopTypeFallback && (firstNonGarrisoned4 !== null || firstNonGarrisoned3 !== null || firstNonGarrisoned2 !== null || firstNonGarrisoned !== null)) flag5 = true;
            if (flag5) {
                const num9 = galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, habitat2.xpos, habitat2.ypos);
                if (num9 < num) {
                    habitat = habitat2;
                    num = num9;
                    prefilteredTroopsNotBeingPickedUp = remainingTroops;
                }
            }
        }
        if (habitat === null && !allowTroopTypeFallback) {
            const r = findNearestColonyWithExcessTroops(galaxy, empire, ship, enforceMinimumTroopLimits, true);
            habitat = r.habitat;
            prefilteredTroopsNotBeingPickedUp = r.prefilteredTroopsNotBeingPickedUp;
        }
    }
    return { habitat, prefilteredTroopsNotBeingPickedUp };
}

/**
 * Empire.5.cs 808-823 AssignLoadTroopsMission(ship[, colony[, queueMission, enforceMinimumTroopLimits[, manuallyAssigned]]])
 * (overload defaults: colony null, queueMission false, enforceMinimumTroopLimits true, manuallyAssigned false). Rnd: the
 * LoadTroops mission's ResolveCommandsForMission draws.
 */
export function assignLoadTroopsMission(galaxy: Galaxy, empire: Empire, ship: BuiltObject, colony: Habitat | null = null, queueMission = false, enforceMinimumTroopLimits = true, manuallyAssigned = false): boolean {
    if (ship.troops !== null && ship.troopCapacity - ship.troops.totalSize >= 100) {
        let habitat = colony;
        let prefilteredTroopsNotBeingPickedUp = new TroopList();
        if (colony === null) {
            const r = findNearestColonyWithExcessTroops(galaxy, empire, ship, enforceMinimumTroopLimits, false);
            habitat = r.habitat;
            prefilteredTroopsNotBeingPickedUp = r.prefilteredTroopsNotBeingPickedUp;
        }
        if (habitat !== null) {
            let flag = false;
            if (habitat.empire !== ship.empire && habitat.invadingTroops !== null && habitat.invadingTroops.count > 0 && habitat.invadingTroops.items[0].empire === ship.empire) {
                flag = true;
                enforceMinimumTroopLimits = false;
            }
            if (flag) {
                for (let i = 0; i < habitat.invadingTroops!.count; i++) {
                    const troop = habitat.invadingTroops!.items[i];
                    if (troop != null && troop.empire === ship.empire) prefilteredTroopsNotBeingPickedUp.add(troop);
                }
            } else if (prefilteredTroopsNotBeingPickedUp === null || prefilteredTroopsNotBeingPickedUp.count <= 0) {
                prefilteredTroopsNotBeingPickedUp = getTroopsNotGarrisonedNotAwaitingPickup(habitat.troops!);
            }
            if (prefilteredTroopsNotBeingPickedUp.count > 0) {
                let num = ship.troopCapacityRemaining;
                let num2 = 0;
                if (flag) {
                    num2 = habitat.invadingTroops!.totalDefendStrength;
                } else {
                    num2 = habitat.troops!.totalDefendStrength;
                    if (enforceMinimumTroopLimits) {
                        const num3 = troopLevelMinimum(galaxy, habitat, galaxy.difficultyLevel) * 100;
                        num2 -= num3;
                    }
                }
                const troopList = new TroopList();
                let flag2 = false;
                for (let j = 0; j < prefilteredTroopsNotBeingPickedUp.count; j++) {
                    const troop2 = prefilteredTroopsNotBeingPickedUp.items[j];
                    const strength = Math.trunc(f32(f32(troop2.defendStrength) * troop2.readiness));
                    if (troop2 != null && num2 - strength >= 0 && num >= troop2.size) {
                        troopList.add(troop2);
                        flag2 = true;
                        num -= troop2.size;
                        num2 -= strength;
                        if (num <= 0 || num2 <= 0) break;
                    }
                }
                if (flag2 && withinFuelRange(galaxy, ship, habitat.xpos, habitat.ypos, 0.0)) {
                    if (queueMission) {
                        // BuiltObject.2.cs 7511 QueueMission(missionType, target, target2, troops, priority).
                        if (ship.role !== BuiltObjectRole.Base) {
                            const item = new BuiltObjectMission(galaxy, ship, BuiltObjectMissionType.LoadTroops, habitat, null, BuiltObjectMissionPriority.Normal, { troops: troopList, allowReprocessing: true, allowBuiltObjectChanges: false });
                            (ship.subsequentMissions as BuiltObjectMission[]).push(item);
                        }
                    } else {
                        clearPreviousMissionRequirements(galaxy, ship);
                        assignMission(galaxy, ship, BuiltObjectMissionType.LoadTroops, habitat, null, BuiltObjectMissionPriority.Normal, { troops: troopList, manuallyAssigned });
                    }
                    return true;
                }
            }
        }
    }
    return false;
}

/** ShipGroup.cs 124 LoadTroopsIfNecessaryAndPossible. Rnd: Next(0, 2) per eligible ship (+ the LoadTroops mission draws). */
export function loadTroopsIfNecessaryAndPossible(galaxy: Galaxy, shipGroup: ShipGroup): void {
    const mission = builtObjectMission(shipGroup.mission);
    if ((mission !== null && mission.type !== BuiltObjectMissionType.Undefined) || shipGroupCheckAnyShipsInBattle(shipGroup)) return;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        const sm = ship != null ? builtObjectMission(ship.mission) : null;
        if (
            ship != null &&
            ship.isAutoControlled &&
            (sm === null || sm.type === BuiltObjectMissionType.Undefined) &&
            shipGroupIsShipAvailable(ship) &&
            ship.troops !== null &&
            ship.troopCapacity - ship.troops.totalSize >= 100 &&
            galaxy.rnd.next(0, 2) === 1
        ) {
            assignLoadTroopsMission(galaxy, shipGroup.empire!, ship, null, false, false, false);
        }
    }
}

/** TroopList.Sort() (Troop.CompareTo: OverallAttackStrength ascending; .NET introsort) then Reverse(). */
function sortTroopsDescendingByAttack(list: TroopList): void {
    netSort(list.items, (a, b) => compareDouble(a.overallAttackStrength, b.overallAttackStrength));
    list.items.reverse();
}

/**
 * BuiltObject.2.cs 3363-3540: case Load, the `command.Troops` branch (the ship is docked): pick troops by the ship / fleet
 * loadout from the dock's Troops (or our InvadingTroops there), move them aboard with the invading characters, then
 * complete the command. Returns the case `result` (0.0 when it breaks without setting it). No Rnd.
 */
export function cmdLoadTroops(ctx: CommandContext): number {
    const { galaxy, bo, mission, command, timePassed } = ctx;
    let result = 0.0;
    const dockedAt = bo.dockedAt as BuiltObject | Habitat;
    const commandTroops = command.troops!;
    let num54 = -1;
    if (dockedAt.dockingBays !== null) num54 = dockingBayIndexOfShip(dockedAt.dockingBays, bo);
    if (num54 < 0 || bo.troopCapacityRemaining < 100) return result;
    let troopList3 = dockedAt.troops!;
    let characterList: Character[] | null = isBuiltObject(dockedAt) ? (dockedAt.characters as Character[] | null) : stellarObjectCharacters(dockedAt);
    let flag19 = false;
    if (dockedAt.empire !== bo.empire && isHabitat(dockedAt)) {
        const habitat8 = dockedAt;
        if (habitat8.invadingTroops !== null && habitat8.invadingTroops.count > 0 && habitat8.invadingTroops.items[0].empire === bo.empire) {
            flag19 = true;
            troopList3 = habitat8.invadingTroops;
            characterList = habitatInvadingCharacterList(habitat8);
        }
    } else if (dockedAt.empire === bo.empire && isHabitat(dockedAt)) {
        const habitat9 = dockedAt;
        if (habitat9.invadingTroops !== null && habitat9.invadingTroops.count > 0 && habitat9.invadingTroops.items[0].empire === bo.empire) {
            flag19 = true;
            troopList3 = habitat9.invadingTroops;
            characterList = habitatInvadingCharacterList(habitat9);
        }
    }
    sortTroopsDescendingByAttack(troopList3);
    const shipGroup = bo.shipGroup as ShipGroup | null;
    for (let t = 0; t < commandTroops.count; t++) {
        let troop: Troop | null = null;
        if (troopList3 !== null && troopList3.count > 0 && bo.troops !== null) {
            if (flag19) {
                for (let num55 = 0; num55 < troopList3.count; num55++) {
                    const troop2 = troopList3.items[num55];
                    if (troop2 != null && troop2.empire === bo.empire && troop2.size <= bo.troopCapacityRemaining) {
                        troop = troop2;
                        break;
                    }
                }
            } else {
                const { infantryAmount, artilleryAmount, armorAmount, specialForcesAmount } = loadoutTargets(bo);
                troop = null;
                if (shipGroup === null && bo.troopLoadoutInfantry === 255 && bo.troopLoadoutArmored === 255 && bo.troopLoadoutArtillery === 255 && bo.troopLoadoutSpecialForces === 255) {
                    troop = getFirstNonGarrisonedWithinSize(troopList3, TroopType.Undefined, bo.troopCapacityRemaining);
                } else if (shipGroup !== null && shipGroup.troopLoadoutInfantry === 255 && shipGroup.troopLoadoutArmored === 255 && shipGroup.troopLoadoutArtillery === 255 && shipGroup.troopLoadoutSpecialForces === 255) {
                    troop = getFirstNonGarrisonedWithinSize(troopList3, TroopType.Undefined, bo.troopCapacityRemaining);
                } else {
                    let infantryCount = bo.troops.countByType(TroopType.Infantry);
                    let armorCount = bo.troops.countByType(TroopType.Armored);
                    let artilleryCount = bo.troops.countByType(TroopType.Artillery);
                    let specialForcesCount = bo.troops.countByType(TroopType.SpecialForces);
                    if (shipGroup !== null) {
                        const c = shipGroupGetTroopCountsByType(shipGroup);
                        infantryCount = c.infantryCount;
                        artilleryCount = c.artilleryCount;
                        armorCount = c.armorCount;
                        specialForcesCount = c.specialForcesCount;
                    }
                    if (troop === null && infantryAmount > 0 && infantryCount < infantryAmount) troop = getFirstNonGarrisoned(troopList3, TroopType.Infantry);
                    if (troop === null && armorAmount > 0 && armorCount < armorAmount) troop = getFirstNonGarrisoned(troopList3, TroopType.Armored);
                    if (troop === null && artilleryAmount > 0 && artilleryCount < artilleryAmount) troop = getFirstNonGarrisoned(troopList3, TroopType.Artillery);
                    if (troop === null && specialForcesAmount > 0 && specialForcesCount < specialForcesAmount) troop = getFirstNonGarrisoned(troopList3, TroopType.SpecialForces);
                    if (troop === null && specialForcesAmount > 0 && specialForcesCount < specialForcesAmount) troop = getFirstNonGarrisonedWithinSize(troopList3, TroopType.Armored, bo.troopCapacityRemaining);
                    if (troop === null && artilleryAmount > 0 && artilleryCount < artilleryAmount) troop = getFirstNonGarrisoned(troopList3, TroopType.Infantry);
                    if (troop === null && armorAmount > 0 && armorCount < armorAmount) troop = getFirstNonGarrisoned(troopList3, TroopType.Infantry);
                    if (troop === null) troop = getFirstNonGarrisoned(troopList3, TroopType.Infantry);
                }
            }
            if (troop !== null && troop.size <= bo.troopCapacityRemaining) {
                troop.garrisoned = false;
                troopList3.remove(troop);
                troop.builtObject = bo;
                bo.troops.add(troop);
                if (!flag19 || characterList === null || characterList.length <= 0) continue;
                const array = characterList.slice();
                for (const character of array) {
                    if (character != null && character.empire === bo.empire) character.completeLocationTransfer(bo, galaxy);
                }
                continue;
            }
            commandTroops.clear();
            mission.completeCommand();
            bo.firstExecutionOfCommand = true;
            result = timePassed;
            return result;
        }
        commandTroops.clear();
        mission.completeCommand();
        bo.firstExecutionOfCommand = true;
        result = timePassed;
        return result;
    }
    commandTroops.clear();
    mission.completeCommand();
    bo.firstExecutionOfCommand = true;
    result = timePassed;
    return result;
}
