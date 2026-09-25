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

const T_checkAssignUnloadTroopsAtColonyNeedingThemMission = registerTodo('M4q', 'checkAssignUnloadTroopsAtColonyNeedingThemMission');
/** Empire.5.cs 727 CheckAssignUnloadTroopsAtColonyNeedingThemMission(fleet). */
export function checkAssignUnloadTroopsAtColonyNeedingThemMission(galaxy: Galaxy, empire: Empire, shipGroup: ShipGroup): boolean {
    /* TODO(port) M4q */ todo(T_checkAssignUnloadTroopsAtColonyNeedingThemMission);
    return false;
}

const T_loadTroopsIfNecessaryAndPossible = registerTodo('M4q', 'loadTroopsIfNecessaryAndPossible');
/** ShipGroup.cs 124 LoadTroopsIfNecessaryAndPossible. */
export function loadTroopsIfNecessaryAndPossible(galaxy: Galaxy, shipGroup: ShipGroup): void {
    // RND: Next(0,2) per eligible ship — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_loadTroopsIfNecessaryAndPossible);
}

/** BaconHabitat.cs 566 GetSpiesInPrison(planet) / BaconBuiltObject.cs 4097 GetSpiesInPrison(ship): BaconValues["capturedSpies"]. */
export function getSpiesInPrison(o: { baconValues: Map<string, unknown> | null }): Character[] | null {
    if (o.baconValues === null) return null;
    const baconValues = o.baconValues;
    return !baconValues.has('capturedSpies') ? null : (baconValues.get('capturedSpies') as Character[]);
}

/**
 * BaconHabitat.cs 575 HandlePlayerPrisoners / 608 HandleAIPrisoners (captured spies, BaconValues "capturedSpies"; clock
 * Randoms only). Added by M4j (BaconHabitat.HugeProcessingSpanActions, colonyTick.ts). Only the espionage code (deferred,
 * tasks/M4-plan.md §0.3: Empire.5.cs 4183-6110) puts spies in prison, so the lists stay absent/empty until it is ported.
 */
export function baconHabitatHandlePrisoners(galaxy: Galaxy, habitat: Habitat, isPlayer: boolean): void {
    const planet = habitat;
    if (isPlayer) {
        // 575 HandlePlayerPrisoners.
        if (planet.baconValues === null) return;
        const spiesInPrison = getSpiesInPrison(planet);
        if (spiesInPrison === null) return;
        for (const character1 of spiesInPrison) {
            if (character1.empire !== galaxy.playerEmpire) {
                // TODO(port) deferred espionage: BaconHabitat.SpyEscaped / SpyDefected (clock Randoms, BaconCharacter events).
                throw new Error('TODO(port): BaconHabitat.HandlePlayerPrisoners captured spies (espionage, deferred)');
            }
        }
        return;
    }
    // 608 HandleAIPrisoners.
    if (planet.empire === galaxy.playerEmpire || planet.baconValues === null) return;
    const spiesInPrison = getSpiesInPrison(planet);
    if (spiesInPrison === null || spiesInPrison.length === 0) return;
    // TODO(port) deferred espionage: SpyEscaped / SpyDefected / ShouldRansomSpy and the transfer to the player capital's list.
    throw new Error('TODO(port): BaconHabitat.HandleAIPrisoners captured spies (espionage, deferred)');
}

// ---- stub added by M4e (missions/cmdDocking.ts case Load) ----

const T_cmdLoadTroops = registerTodo('M4q', 'cmdLoadTroops');
/**
 * BuiltObject.2.cs 3363-3540: case Load, `command.Troops` branch (docked; pick troops by the ship / fleet loadout from
 * the dock's Troops or InvadingTroops, move them aboard, transfer invading characters, then complete the command).
 * Receives the case locals and returns the case `result`. Stub: 0.0 (the ship waits on the Load command; no Rnd in the
 * C# branch). LoadTroops missions are created by M4q.
 */
export function cmdLoadTroops(ctx: CommandContext): number {
    /* TODO(port) M4q */ todo(T_cmdLoadTroops);
    return 0.0;
}

// ---- stub added by M4l (MaintainShipGroups, BuiltObject.PerformFleetTasks) ----

const T_assignLoadTroopsMission = registerTodo('M4q', 'assignLoadTroopsMission');
/**
 * Empire.5.cs 808-823 AssignLoadTroopsMission(ship[, colony[, queueMission, enforceMinimumTroopLimits[, manuallyAssigned]]])
 * (overload defaults: colony null, queueMission false, enforceMinimumTroopLimits true, manuallyAssigned false) — stub: false.
 */
export function assignLoadTroopsMission(galaxy: Galaxy, empire: Empire, ship: BuiltObject, colony: Habitat | null = null, queueMission = false, enforceMinimumTroopLimits = true, manuallyAssigned = false): boolean {
    // RND: AssignMission(LoadTroops) → ResolveCommandsForMission draws — not drawn until M4q.
    /* TODO(port) M4q */ todo(T_assignLoadTroopsMission);
    return false;
}

// ---- stubs added by M4f (called from civilianAI.ts AssignMissionToBuiltObject, Empire.5.cs 1879-1880) ----

const T_checkAssignUnloadTroopsAtColonyNeedingThemMissionShip = registerTodo('M4q', 'checkAssignUnloadTroopsAtColonyNeedingThemMissionShip');
/** Empire.5.cs 727 CheckAssignUnloadTroopsAtColonyNeedingThemMission(ship) (single-ship overload) — stub: false. */
export function checkAssignUnloadTroopsAtColonyNeedingThemMissionShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject): boolean {
    /* TODO(port) M4q */ todo(T_checkAssignUnloadTroopsAtColonyNeedingThemMissionShip);
    return false;
}

const T_checkAssignGarrisonTroopsAtPenalColonyMission = registerTodo('M4q', 'checkAssignGarrisonTroopsAtPenalColonyMission');
/** Empire.5.cs 782 CheckAssignGarrisonTroopsAtPenalColonyMission(ship) — stub: false. */
export function checkAssignGarrisonTroopsAtPenalColonyMission(galaxy: Galaxy, empire: Empire, ship: BuiltObject): boolean {
    /* TODO(port) M4q */ todo(T_checkAssignGarrisonTroopsAtPenalColonyMission);
    return false;
}
