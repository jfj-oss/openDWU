// M4q — boarding, assault pods, tractor beams, prisoners.
//
// Ports (statement for statement, same Galaxy.Rnd draw order):
//   BuiltObject.1.cs 2531/2567 CheckLaunchAssaultPodsAtTarget, 2626 HandleAssaultPodMovement, 2779 PerformRaidColonyInvasion,
//   2905 FireAtAssaultPods, 2954 ProcessBoardingAssault, 3462 DisableRandomComponent; BuiltObject.cs 4191
//   FireTractorBeamsAtInvadingTroopTransports; Habitat.cs 3300 PiratesDefendAgainstRaid; BaconBuiltObject.cs 112
//   AssaultPodStrengthMultiplier, 777 ResetAssaultPods, 2474 AssignNearestSystemStarIfNull, 4083 HugeProcessingSpanActions,
//   4105/4138 HandlePlayerPrisoners / HandleAIPrisoners; ShipGroup.cs 3165 TotalAvailableBoardingAssaultStrengthCapturingTarget.
// Time: `time` (= _tempNow) is game ms; Weapon.lastFired is game ms (MIN_TIME = never fired).
// Clock-seeded `new Random()` (BaconBuiltObject.cs 4089) → galaxy.baconBoardingClockRnd, seeded from the galaxy seed.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { AutomationLevel } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Creature } from '../creature';
import type { ShipGroup } from '../fleets/shipGroup';
import type { Weapon } from '../weapon';
import { Random } from '../random';
import { Troop, TroopList, TroopType } from '../cargo';
import { ComponentType } from '../data/components';
import { ComponentCategoryType } from '../data/policies';
import { ComponentStatus, toShort } from '../builtObjectComponent';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission, isBuiltObject, isHabitat, type StellarObject } from '../missions/mission';
import { clearPreviousMissionRequirements } from '../missions/assign';
import { CharacterDeathType, characterSendDeathMessage } from '../characterRuntime';
import { CharacterEventType, CharacterRole, CharacterSkillType, doCharacterEventForList, getHighestSkillLevel, stellarObjectCharacters, type Character } from '../characters';
import { EmpireMessageType, resolveDescription, sendMessageToEmpire } from '../messages';
import { formatText, getText, declareWar } from '../diplomacyTick';
import { EventMessageType, chanceNewFleetAdmiralCaptured, chanceNewShipCaptainCaptured, sendEventMessageToEmpire } from '../events';
import { getEmpireById } from '../logistics/contracts';
import { applyCorruptionToIncome } from '../logistics/orders';
import { pirateEconomyPerformIncome } from '../pirates/pirateAI';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { checkCancelAttackMissionsForBuiltObject, completePirateMission } from '../pirates/missionsMarket';
import { PirateRelationEvaluationType, PirateRelationType, changePirateEvaluation } from '../pirateRelations';
import { assignRetrofitMission, assignScrapMission } from '../construction/empireConstruction';
import { findNewestCanBuild } from '../designGeneration';
import { galaxyStarDate } from '../tick/simTime';
import { strategicValue } from '../territory';
import { PreWarpProgressEventType } from '../exploration';
import { checkSendPreWarpProgressEventMessage } from '../events';
import { MAX_SOLAR_SYSTEM_SIZE } from '../movement';
import { calculateBoardingDefenseValue, determineAngle, notifyOfAttackHabitat, resolveTechBonusFactor, shouldAttack } from './attackAI';
import { builtObjectThreats } from './threats';
import { builtObjectCalculateAssaultPodAttackValues } from '../fleets/shipGroupTasks';
import {
    calculateRawDamageOfWeaponsAboveRange,
    determineHitTargetWeapon,
    determineTractorBeamShouldPullTarget,
    fireWeaponTypeAtTarget,
    modifyDiplomacyFromAttack,
    modifyDiplomacyFromAttackBuiltObject,
    modifyDiplomacyFromAttackEmpire,
    weaponFire,
    weaponFireAtWeapon,
    weaponIsAvailable,
    weaponTarget,
} from './weapons';
import { baconIsMyShip, calculateBuiltObjectLootingValue, empireColonyIncomeFactor, identifyPirateSpaceport, inflictDamageFull } from './damage';
import { colonyInvasionUi, doRaidBonuses, empireRaidBonusFactor, failPirateDefendMission, getNearestBuiltObject, InvasionStats, invasionStatsOf, pirateColonyControl, pirateColonyControlByFacilityControl, takeOwnershipOfBuiltObject } from './invasion';
import { getSpiesInPrison } from './troopsRuntime';

const f32 = Math.fround;

/** BaconBuiltObject.cs 48 myAssaultPodStrengthMultiplier. */
const MY_ASSAULT_POD_STRENGTH_MULTIPLIER = 6.0;

/** BaconBuiltObject.cs 112 AssaultPodStrengthMultiplier(firingShip). */
export function assaultPodStrengthMultiplier(firingShip: BuiltObject): number {
    let num = 1.0;
    if (baconIsMyShip(firingShip)) num = MY_ASSAULT_POD_STRENGTH_MULTIPLIER;
    return num;
}

/** Empire.RaidStrengthFactor (Empire.cs 431; SetPirateFactionModifiers, 1.0 for non-pirates; 0 reads as 1). */
export function empireRaidStrengthFactor(empire: Empire): number {
    const f = empire.pirateFactionModifiers !== null ? empire.pirateFactionModifiers.raidStrengthFactor : 1.0;
    return f === 0.0 ? 1.0 : f;
}

function attackersOf(o: BuiltObject | Habitat): StellarObject[] | null {
    return o.attackers as StellarObject[] | null;
}
function charactersOf(o: BuiltObject): Character[] | null {
    return o.characters as Character[] | null;
}
/** C# (short)double: truncate, then wrap to 16 bits. */
function csShort(v: number): number {
    return toShort(Math.trunc(v));
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 3462 DisableRandomComponent
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 3462 DisableRandomComponent(durationInMilliseconds): the first eligible Normal component. No Rnd. */
export function disableRandomComponent(galaxy: Galaxy, self: BuiltObject, durationInMilliseconds: number): unknown {
    void galaxy;
    if (self.disabledComponentIndexes === null) self.disabledComponentIndexes = [];
    if (self.disabledComponentDurations === null) self.disabledComponentDurations = [];
    const components = self.components.items;
    for (let i = 0; i < components.length; i++) {
        const builtObjectComponent = components[i];
        if (builtObjectComponent != null && builtObjectComponent.status === ComponentStatus.Normal) {
            const type = builtObjectComponent.type;
            if (type !== ComponentType.Armor && type !== ComponentType.ComputerCommandCenter && !self.disabledComponentIndexes.includes(toShort(i))) {
                self.disabledComponentIndexes.push(toShort(i));
                self.disabledComponentDurations.push(durationInMilliseconds);
                self.reDefine();
                return builtObjectComponent;
            }
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Assault pods
// ---------------------------------------------------------------------------------------------------------------

/**
 * BuiltObject.1.cs 2531 / 2567 CheckLaunchAssaultPodsAtTarget(time, Habitat | BuiltObject target). Rnd per available pod
 * in range: Next(0, 5); on a launch Fire's draws + 2 × NextDouble (pod scatter).
 */
export function checkLaunchAssaultPodsAtTarget(galaxy: Galaxy, builtObject: BuiltObject, time: number, target: BuiltObject | Habitat): void {
    const self = builtObject;
    const mission = builtObjectMission(self.mission);
    if (isHabitat(target)) {
        let flag = false;
        if (mission !== null && mission.type === BuiltObjectMissionType.Raid && target.population != null && target.population.items.length > 0 && target.empire !== self.empire) flag = true;
        if (!flag || self.assaultAttackValue > 0 || target === null || target.hasBeenDestroyed || target.empire === self.empire || target.planetaryShieldPresent) return;
        const num = galaxy.calculateDistance(self.xpos, self.ypos, target.xpos, target.ypos);
        if (!(num < f32(self.assaultRange)) || self.weapons === null) return;
        for (let i = 0; i < self.weapons.length; i++) {
            const weapon = self.weapons[i];
            if (weapon != null && weapon.component !== null && weapon.component.type === ComponentType.AssaultPod && weapon.range >= num && weaponIsAvailable(weapon, self, time) && galaxy.rnd.next(0, 5) === 1) {
                weaponFire(galaxy, weapon, self, target, num, time, true, 1.0);
                weapon.x += galaxy.rnd.nextDouble() * 20.0 - 10.0;
                weapon.y += galaxy.rnd.nextDouble() * 20.0 - 10.0;
                const attackers = attackersOf(target);
                if (target.empire !== null && target.empire !== galaxy.independentEmpire && target.empire !== self.empire && attackers !== null && !attackers.includes(self)) {
                    modifyDiplomacyFromAttack(galaxy, self, target.empire, true, false, 2, 2.0);
                }
                if (attackers !== null && !attackers.includes(self)) attackers.push(self);
            }
        }
        return;
    }
    let flag = false;
    let assaultIsRaid = false;
    if (mission !== null) {
        if (mission.type === BuiltObjectMissionType.Capture) {
            flag = true;
        } else if (mission.type === BuiltObjectMissionType.Raid) {
            flag = true;
            assaultIsRaid = true;
        }
    }
    if (self.role === BuiltObjectRole.Base && target.role !== BuiltObjectRole.Base) flag = true;
    if (target.empire === null) flag = false;
    if (!flag || self.assaultAttackValue > 0 || target === null || target.hasBeenDestroyed || target.empire === self.empire || !(target.currentShields < f32(self.assaultShieldPenetration))) return;
    const num2 = galaxy.calculateDistance(self.xpos, self.ypos, target.xpos, target.ypos);
    if (!(num2 < f32(self.assaultRange)) || self.weapons === null) return;
    for (let i = 0; i < self.weapons.length; i++) {
        const weapon = self.weapons[i];
        if (weapon != null && weapon.component !== null && weapon.component.type === ComponentType.AssaultPod && weapon.range >= num2 && weaponIsAvailable(weapon, self, time) && galaxy.rnd.next(0, 5) === 1) {
            weaponFire(galaxy, weapon, self, target, num2, time, true, 1.0);
            weapon.x += galaxy.rnd.nextDouble() * 20.0 - 10.0;
            weapon.y += galaxy.rnd.nextDouble() * 20.0 - 10.0;
            modifyDiplomacyFromAttackBuiltObject(galaxy, self, target);
            const attackers = attackersOf(target);
            if (attackers !== null && !attackers.includes(self)) attackers.push(self);
            if (target.assaultAttackValue === 0) target.assaultIsRaid = assaultIsRaid;
            if (self.assaultAttackValue <= 0) self.assaultDefenseValue = csShort(calculateBoardingDefenseValue(galaxy, self, time).value);
        }
    }
}

/**
 * BuiltObject.1.cs 2626 HandleAssaultPodMovement(timePassed): pods in flight close on their target; on arrival they add
 * to a ship's boarding attack (or defence) or raid a colony. Rnd: only through PerformRaidColonyInvasion.
 */
export function handleAssaultPodMovement(galaxy: Galaxy, builtObject: BuiltObject, timePassed: number): void {
    const self = builtObject;
    if (self.weapons === null) return;
    for (let i = 0; i < self.weapons.length; i++) {
        const weapon = self.weapons[i];
        if (weapon == null || weapon.component === null || weapon.component.type !== ComponentType.AssaultPod) continue;
        const target = weaponTarget(weapon) as StellarObject | null;
        if (!(weapon.distanceTravelled >= 0) || target === null || target.hasBeenDestroyed) continue;
        const distanceFromTarget = weapon.distanceFromTarget;
        const num = determineAngle(weapon.x, weapon.y, target.xpos, target.ypos);
        weapon.x += Math.cos(num) * weapon.speed * timePassed;
        weapon.y += Math.sin(num) * weapon.speed * timePassed;
        const num2 = (weapon.distanceFromTarget = f32(galaxy.calculateDistance(weapon.x, weapon.y, target.xpos, target.ypos)));
        weapon.heading = f32(num);
        if (!(f32(distanceFromTarget + 1) < num2) && !(num2 < 10.0)) continue;
        if (isBuiltObject(target)) {
            const bo = target;
            let num3 = 1.0;
            let num4 = 1.0;
            if (self.empire !== null) {
                num4 = self.empire.boardingAttackFactor * assaultPodStrengthMultiplier(self);
                num4 *= empireRaidStrengthFactor(self.empire);
                if (self.empire.dominantRace !== null) num3 = self.empire.dominantRace.troopStrength / 100.0;
            }
            if (bo.empire === self.empire) {
                bo.assaultDefenseValue = toShort(bo.assaultDefenseValue + csShort(weapon.rawDamage * num3 * num4));
            } else {
                if (self.empire !== null && bo.assaultAttackValue === 0) bo.assaultAttackEmpireId = self.empire.empireId & 0xff;
                if (bo.assaultIsRaid) doCharacterEventForList(galaxy, CharacterEventType.Raid, bo, charactersOf(self), false, null);
                else doCharacterEventForList(galaxy, CharacterEventType.Boarding, bo, charactersOf(self), false, null);
                let num5 = csShort(weapon.rawDamage * num3 * num4);
                if (self.sensorTraceScannerPower > 0) num5 = csShort(num5 * (1.0 + self.sensorTraceScannerPower / 100.0));
                const chars = charactersOf(self);
                if (chars !== null && chars.length > 0) {
                    const num6 = 1.0 + 0.01 * getHighestSkillLevel(chars, CharacterSkillType.BoardingAssault);
                    num5 = csShort(num5 * num6);
                }
                bo.assaultAttackValue = toShort(bo.assaultAttackValue + num5);
            }
        } else if (isHabitat(target)) {
            const habitat = target;
            let flag = true;
            if (habitat.invadingTroops !== null && habitat.invadingTroops.count > 0) {
                const array = habitat.invadingTroops.items.slice();
                let flag2 = false;
                for (const troop of array) {
                    if (troop != null && troop.empire !== null && troop.type !== TroopType.PirateRaider && troop.empire === self.empire) {
                        flag2 = true;
                        break;
                    }
                }
                if (flag2) flag = false;
            }
            if (flag) {
                let num7 = 1.0;
                let num8 = 1.0;
                if (self.empire !== null) {
                    num8 = empireRaidStrengthFactor(self.empire);
                    if (self.empire.dominantRace !== null) num7 = (self.empire.dominantRace.troopStrength / 100.0) * assaultPodStrengthMultiplier(self);
                }
                const attackStrength = Math.trunc(weapon.rawDamage * 1.0 * num7 * num8);
                doCharacterEventForList(galaxy, CharacterEventType.Raid, habitat, charactersOf(self), false, null);
                doCharacterEventForList(galaxy, CharacterEventType.Raid, habitat, stellarObjectCharacters(habitat), false, null);
                performRaidColonyInvasion(galaxy, self, habitat, attackStrength);
            }
        }
        weapon.reset();
    }
}

/** Habitat.cs 3300 PiratesDefendAgainstRaid(raidingEmpire). No Rnd while no pirate faction controls the colony. */
export function piratesDefendAgainstRaid(galaxy: Galaxy, habitat: Habitat, raidingEmpire: Empire): void {
    void raidingEmpire;
    const control = pirateColonyControl(habitat);
    if (control === null || control.length <= 0) return;
    const byFacilityControl = pirateColonyControlByFacilityControl(control);
    if (byFacilityControl === null) return;
    const empireById = getEmpireById(galaxy, byFacilityControl.empireId);
    if (empireById === null || empireById === raidingEmpire) return;
    // Troops.PirateRaider check + GenerateDefensivePirateRaiders (BaconHabitat) — reachable only with pirate colony control.
    throw new Error('TODO(port) M4s2: Habitat.GenerateDefensivePirateRaiders (BaconHabitat) — pirate colony control');
}

/**
 * BuiltObject.1.cs 2779 PerformRaidColonyInvasion(targetColony, attackStrength): a landed pod becomes a PirateRaider troop
 * invading the colony. Rnd: NextDouble (intercept chance) [+ NextDouble (readiness loss)].
 */
export function performRaidColonyInvasion(galaxy: Galaxy, self: BuiltObject, targetColony: Habitat, attackStrength: number): void {
    const empire = self.empire;
    if (targetColony === null || targetColony.owner === null || empire === null || empire.dominantRace === null) return;
    notifyOfAttackHabitat(galaxy, self, empire, targetColony, false, true, true);
    checkSendPreWarpProgressEventMessage(galaxy, targetColony.owner, PreWarpProgressEventType.FirstPirateRaid, targetColony, empire);
    const name = empire.generateTroopDescription(formatText(getText('RACE Pirate Raider'), empire.dominantRace.name));
    const troop = new Troop(name, TroopType.PirateRaider, attackStrength, attackStrength, 100, 100, empire, empire.dominantRace);
    if (empire.dominantRace !== null) troop.pictureRef = empire.dominantRace.pictureIndex; // Race.PictureRef ← races.txt PictureIndex
    empire.troops.add(troop);
    piratesDefendAgainstRaid(galaxy, targetColony, empire);
    const list: unknown[] = [];
    let num = 0;
    let num2 = 0;
    if (targetColony.basesAtHabitat !== null && targetColony.basesAtHabitat.length > 0) {
        for (let i = 0; i < targetColony.basesAtHabitat.length; i++) {
            if (targetColony.basesAtHabitat[i].firepowerRaw > 0) {
                num += targetColony.basesAtHabitat[i].firepowerRaw;
                list.push(targetColony.basesAtHabitat[i]);
                num2++;
            }
        }
    }
    if (targetColony.planetaryShieldPresent) {
        num += 1000;
        num2++;
    }
    let num3 = 0;
    let num4 = 0;
    const num5 = num;
    const byType = targetColony.troops!.getByType(TroopType.Artillery);
    num3 = byType.totalDefendStrength;
    if (byType.count > 0) {
        if (targetColony.empire !== null) {
            num3 = Math.trunc(f32(num3 * targetColony.empire.troopAttackStrengthBonusFactorArtillery));
            num4 = Math.trunc(f32(num3 * targetColony.empire.troopPlanetaryDefenseInterceptBonusFactor));
        }
        num += Math.trunc(num3 / 50);
        list.push(...byType.items);
        num2 += byType.count;
    }
    num = Math.min(3000, num);
    num2 = Math.min(10, num2);
    let val = Math.sqrt(num) * Math.sqrt(num2);
    val = Math.min(90.0, val);
    const num6 = Math.trunc(num4 / 50) + num5;
    let val2 = Math.sqrt(num6) * Math.sqrt(num2);
    val2 = Math.min(95.0, val2);
    if (targetColony.invadingTroops === null || targetColony.invadingTroops.count <= 0) {
        // PirateColonyControlList GetPirateControl(): no pirate control is modelled yet (M4s2) — an empty list.
        const pirateControl = pirateColonyControl(targetColony) ?? [];
        for (let j = 0; j < pirateControl.length; j++) {
            const pcc = pirateControl[j];
            if (pcc != null && pcc.controlLevel >= 0.5 && pcc.empireId !== empire.empireId) {
                const empireById = getEmpireById(galaxy, pcc.empireId);
                if (empireById !== null) {
                    let num7 = f32(-5);
                    num7 = f32(num7 - f32(f32(pcc.controlLevel - 0.5) * 10));
                    changePirateEvaluation(empireById, empire, num7, PirateRelationEvaluationType.RaidsAgainstOurColonies);
                }
            }
        }
        const colonyEmpire = targetColony.empire;
        if (colonyEmpire !== null && colonyEmpire !== galaxy.independentEmpire && colonyEmpire.pirateRelations !== null) {
            for (let k = 0; k < colonyEmpire.pirateRelations.count; k++) {
                const pirateRelation = colonyEmpire.pirateRelations.get(k);
                if (pirateRelation != null && pirateRelation.otherEmpire !== null && pirateRelation.type === PirateRelationType.Protection && pirateRelation.evaluation >= 5 && pirateRelation.otherEmpire !== empire) {
                    changePirateEvaluation(pirateRelation.otherEmpire, empire, -5, PirateRelationEvaluationType.RaidsAgainstOurColonies);
                }
            }
            changePirateEvaluation(colonyEmpire, empire, -10, PirateRelationEvaluationType.RaidsAgainstOurColonies);
        }
    }
    troop.colony = targetColony;
    if (targetColony.invadingTroops === null) targetColony.invadingTroops = new TroopList();
    targetColony.invadingTroops.add(troop);
    colonyInvasionUi(targetColony);
    if (galaxy.rnd.nextDouble() * 100.0 < val2) {
        let val3 = val * galaxy.rnd.nextDouble();
        val3 = Math.min(f32(troop.readiness * f32(0.9)), val3);
        troop.readiness = f32(troop.readiness - f32(val3));
        if (targetColony.invasionStats === null) targetColony.invasionStats = new InvasionStats(targetColony, empire, targetColony.empire);
        const stats = invasionStatsOf(targetColony);
        if (stats !== null) stats.troopsDamageToInvaders = f32(stats.troopsDamageToInvaders + f32(val3));
        colonyInvasionUi(targetColony);
    }
    void list;
    const chars = charactersOf(self);
    if (chars !== null) {
        for (const character of chars.slice()) {
            if (character.role === CharacterRole.TroopGeneral) {
                character.completeLocationTransfer(targetColony, galaxy, true);
                colonyInvasionUi(targetColony);
            }
        }
    }
    if (targetColony.empire !== galaxy.independentEmpire && targetColony.empire !== empire) {
        const num8 = Math.max(1.0, Math.min(4.0, strategicValue(targetColony) / 250000.0));
        const evaluationImpact = Math.min(20, Math.max(2, Math.trunc((troop.attackStrength / 30.0) * num8)));
        modifyDiplomacyFromAttackEmpire(galaxy, self, targetColony.empire, evaluationImpact);
        const ce = targetColony.empire!;
        if ((strategicValue(targetColony) > 50000 || (ce !== null && ce.capitals !== null && ce.capitals.includes(targetColony))) && empire !== null && empire.pirateEmpireBaseHabitat === null && ce.pirateEmpireBaseHabitat === null && ce.controlDiplomacyOffense === AutomationLevel.FullyAutomated) {
            declareWar(galaxy, ce, empire);
        }
    }
}

/**
 * BuiltObject.1.cs 2905 FireAtAssaultPods(time, inView): point defence shoots at incoming assault pods. Rnd: the point
 * defence hit roll and Fire draws.
 */
export function fireAtAssaultPods(galaxy: Galaxy, builtObject: BuiltObject, time: number, inView: boolean): void {
    const self = builtObject;
    if (self.pointDefenseWeaponsRange <= 0) return;
    if (self.assaultPodFiringCounter >= 32766) self.assaultPodFiringCounter = 0;
    self.assaultPodFiringCounter++;
    if (inView && self.assaultPodFiringCounter % 5 !== 0) return;
    const attackers = attackersOf(self) ?? [];
    for (let i = 0; i < attackers.length; i++) {
        const stellarObject = attackers[i];
        if (stellarObject == null || !isBuiltObject(stellarObject)) continue;
        const bo = stellarObject;
        if (bo.assaultStrength <= 0 || bo.weapons === null) continue;
        for (let j = 0; j < bo.weapons.length; j++) {
            const weapon = bo.weapons[j];
            if (
                weapon == null ||
                weapon.component === null ||
                weapon.component.type !== ComponentType.AssaultPod ||
                !(weapon.distanceTravelled >= 0) ||
                weapon.target === null ||
                weapon.target !== self ||
                !(weapon.distanceFromTarget < f32(self.pointDefenseWeaponsRange)) ||
                self.weapons === null
            ) {
                continue;
            }
            for (let k = 0; k < self.weapons.length; k++) {
                const weapon2 = self.weapons[k];
                if (weapon2 != null && weapon2.component !== null && weapon2.component.type === ComponentType.WeaponPointDefense && weapon.distanceFromTarget <= f32(weapon2.range) && weaponIsAvailable(weapon2, self, time)) {
                    const { willHit, hitRangeChance } = determineHitTargetWeapon(galaxy, self, weapon2, weapon, weapon.distanceFromTarget);
                    weaponFireAtWeapon(galaxy, weapon2, self, weapon, weapon.distanceFromTarget, time, willHit, hitRangeChance);
                    break;
                }
            }
        }
    }
}

/** BaconBuiltObject.cs 777 ResetAssaultPods(ship): pods not fired for over 120 s are reset. No Rnd. */
export function resetAssaultPods(galaxy: Galaxy, builtObject: BuiltObject): void {
    void galaxy;
    const ship = builtObject;
    const source2: Weapon[] = ship.weapons.filter((x) => x.component.category === ComponentCategoryType.AssaultPod);
    if (source2.length <= 0) return;
    for (const weapon of source2) {
        // (ship.LastTouch.Ticks - weapon.LastFired.Ticks) / 10000000L > 120L: long division of ticks (truncating).
        if (Math.trunc((ship.lastTouch - weapon.lastFired) / 1000) > 120) weapon.reset();
    }
}

/** The clock-seeded `new Random()` stand-in (plan §0): one stream per galaxy, seeded from the galaxy seed. */
function baconBoardingClockRnd(galaxy: Galaxy): Random {
    if (galaxy.baconBoardingClockRnd === null) galaxy.baconBoardingClockRnd = new Random((galaxy.randomSeed ^ 0x0b0a4d17) | 0);
    return galaxy.baconBoardingClockRnd;
}

/** BaconBuiltObject.cs 2474 AssignNearestSystemStarIfNull(ship). No Rnd. */
function assignNearestSystemStarIfNull(galaxy: Galaxy, ship: BuiltObject): void {
    let habitat = ship.nearestSystemStar;
    if (habitat !== null) return;
    // BaconBuiltObject.myMain is set in any running game.
    const nearestSystem = galaxy.fastFindNearestSystem(ship.xpos, ship.ypos);
    if (nearestSystem !== null && galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, nearestSystem.xpos, nearestSystem.ypos) < MAX_SOLAR_SYSTEM_SIZE * MAX_SOLAR_SYSTEM_SIZE + 1000000) {
        habitat = nearestSystem;
    }
    if (habitat !== null) {
        ship.nearestSystemStar = habitat;
        if (ship.actualEmpire !== null) ship.actualEmpire.visibility.resolveSystemVisibilityForUnit(ship, false);
    }
}

/**
 * BaconBuiltObject.cs 4083 HugeProcessingSpanActions(ship): AssignNearestSystemStarIfNull, then (clock Random > 0.25 →
 * return) the prisoners (captured spies: espionage, deferred — the lists stay absent).
 */
export function baconBuiltObjectHugeProcessingSpanActions(galaxy: Galaxy, builtObject: BuiltObject): void {
    const ship = builtObject;
    if (ship.nearestSystemStar === null) assignNearestSystemStarIfNull(galaxy, ship);
    if (baconBoardingClockRnd(galaxy).nextDouble() > 0.25) return;
    if (ship.actualEmpire !== null && ship.actualEmpire === galaxy.playerEmpire) {
        // 4105 HandlePlayerPrisoners (the C# try/catch swallows everything).
        if (ship.baconValues === null) return;
        const spiesInPrison = getSpiesInPrison(ship);
        if (spiesInPrison === null || spiesInPrison.length === 0) return;
        throw new Error('TODO(port) deferred espionage: BaconBuiltObject.HandlePlayerPrisoners captured spies');
    }
    // 4138 HandleAIPrisoners.
    if (ship.actualEmpire === galaxy.playerEmpire || ship.baconValues === null) return;
    const spiesInPrison = getSpiesInPrison(ship);
    if (spiesInPrison === null || spiesInPrison.length === 0) return;
    throw new Error('TODO(port) deferred espionage: BaconBuiltObject.HandleAIPrisoners captured spies');
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.cs 4191 FireTractorBeamsAtInvadingTroopTransports
// ---------------------------------------------------------------------------------------------------------------

/**
 * BuiltObject.cs 4191 FireTractorBeamsAtInvadingTroopTransports(time, inView): a space port holds troop ships off its
 * colony. Rnd: the tractor beams' Fire draws.
 */
export function fireTractorBeamsAtInvadingTroopTransports(galaxy: Galaxy, builtObject: BuiltObject, time: number, inView: boolean): void {
    const self = builtObject;
    if (
        self.role !== BuiltObjectRole.Base ||
        self.parentHabitat === null ||
        self.parentHabitat.empire !== self.empire ||
        self.tractorBeamRange <= 0 ||
        (self.subRole !== BuiltObjectSubRole.SmallSpacePort && self.subRole !== BuiltObjectSubRole.MediumSpacePort && self.subRole !== BuiltObjectSubRole.LargeSpacePort)
    ) {
        return;
    }
    if (self.tractorBeamFiringCounter >= 32766) self.tractorBeamFiringCounter = 0;
    self.tractorBeamFiringCounter++;
    const threats = builtObjectThreats(self);
    if ((inView && self.tractorBeamFiringCounter % 10 !== 0) || !(self.currentEnergy / self.reactorStorageCapacity > 0.2) || threats.length <= 0) return;
    const builtObjectList: BuiltObject[] = [];
    const num = self.tractorBeamRange * self.tractorBeamRange;
    const num2 = self.sensorTraceScannerRange * self.sensorTraceScannerRange;
    let ourLongRangeWeaponsDamage = 0;
    if (self.weapons !== null) ourLongRangeWeaponsDamage = calculateRawDamageOfWeaponsAboveRange(self.weapons, self.tractorBeamRange);
    let builtObject0: BuiltObject | null = null;
    let num3 = Number.MAX_VALUE;
    for (let i = 0; i < threats.length; i++) {
        const stellarObject = threats[i] as StellarObject | null;
        if (stellarObject == null || !isBuiltObject(stellarObject)) continue;
        const builtObject2 = stellarObject;
        if (builtObject2 === null || builtObject2.troopCapacity <= 0 || !shouldAttack(galaxy, self, stellarObject, time, false)) continue;
        const num4 = galaxy.calculateDistanceSquared(self.xpos, self.ypos, builtObject2.xpos, builtObject2.ypos);
        if (!(num4 < num) || builtObject2.actualEmpire === self.actualEmpire || determineTractorBeamShouldPullTarget(self, builtObject2, ourLongRangeWeaponsDamage, Math.sqrt(num4))) continue;
        let flag = true;
        if (num4 < num2 && self.sensorTraceScannerPower > builtObject2.sensorTraceScannerJamming) {
            flag = builtObject2.troops !== null && builtObject2.troops.count > 0;
        }
        if (flag) {
            builtObjectList.push(builtObject2);
            if (num4 < num3) {
                builtObject0 = builtObject2;
                num3 = num4;
            }
        }
    }
    if (builtObject0 === null) return;
    let maximumPortion = 1.0;
    if (builtObjectList.length > 0) maximumPortion = 0.5;
    fireWeaponTypeAtTarget(galaxy, self, ComponentType.WeaponTractorBeam, Math.sqrt(num3), builtObject0, time, false, maximumPortion);
    if (builtObjectList.length <= 0) return;
    maximumPortion = 0.5 / builtObjectList.length;
    for (let j = 0; j < builtObjectList.length; j++) {
        const builtObject3 = builtObjectList[j];
        if (builtObject3 != null) {
            const distanceToTarget = galaxy.calculateDistance(self.xpos, self.ypos, builtObject3.xpos, builtObject3.ypos);
            fireWeaponTypeAtTarget(galaxy, self, ComponentType.WeaponTractorBeam, distanceToTarget, builtObject3, time, false, maximumPortion);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject.1.cs 2954 ProcessBoardingAssault
// ---------------------------------------------------------------------------------------------------------------

/** The looting a captured ship / base is scrapped for (BuiltObject.1.cs 3105-3110 / 3172-3177 / 3279-3284). */
function scrapCapturedForLoot(galaxy: Galaxy, self: BuiltObject, empireById: Empire): number {
    let num = 2.0 * calculateBuiltObjectLootingValue(self);
    num *= empireColonyIncomeFactor(empireById);
    num = applyCorruptionToIncome(empireById, num);
    empireById.stateMoney += num;
    pirateEconomyPerformIncome(galaxy, empireById, num, PirateIncomeType.ScrapCapturedShips, galaxyStarDate(galaxy));
    return num;
}

/**
 * BuiltObject.1.cs 2954 ProcessBoardingAssault(time, timePassed): boarding troops and defenders wear each other down; a
 * won boarding captures (or raids / scraps) the ship. Rnd while boarded: 2 × NextDouble, NextDouble [+ Next(20000, 30000)];
 * on capture Next(0, 7) for a pirate ship, and the capture's callee draws.
 */
export function processBoardingAssault(galaxy: Galaxy, builtObject: BuiltObject, time: number, timePassed: number): void {
    const self = builtObject;
    if (self.assaultAttackValue > 0) {
        if (self.assaultDefenseValue === 0) self.assaultDefenseValue = csShort(calculateBoardingDefenseValue(galaxy, self, time).value);
        const num = Math.max(0.5, Math.min(2.0, self.assaultAttackValue / self.assaultDefenseValue));
        const num2 = (timePassed * (2.0 + galaxy.rnd.nextDouble() * 2.0)) / num;
        const num3 = timePassed * (2.0 + galaxy.rnd.nextDouble() * 2.0) * num;
        self.assaultAttackValue = Math.max(0, csShort(self.assaultAttackValue - num2));
        self.assaultDefenseValue = Math.max(0, csShort(self.assaultDefenseValue - num3));
        if (num2 + num3 > galaxy.rnd.nextDouble() * 10.0 * timePassed) {
            const durationInMilliseconds = toShort(galaxy.rnd.next(20000, 30000));
            disableRandomComponent(galaxy, self, durationInMilliseconds);
        }
        if (self.assaultAttackValue === 0) {
            self.assaultDefenseValue = csShort(calculateBoardingDefenseValue(galaxy, self, time).value);
            self.assaultAttackEmpireId = 0;
            self.assaultIsRaid = false;
            return;
        }
        if (self.assaultDefenseValue !== 0) return;
        const empireById = getEmpireById(galaxy, self.assaultAttackEmpireId);
        if (empireById === null || !empireById.active) return;
        if (self.assaultIsRaid) {
            const raidBonusFactor = empireRaidBonusFactor(empireById);
            doRaidBonuses(galaxy, empireById, self, raidBonusFactor);
            self.raidCountdown = 60;
            self.assaultAttackValue = 0;
            self.assaultAttackEmpireId = 0;
            self.assaultIsRaid = false;
            failPirateDefendMission(galaxy, self.actualEmpire, self);
            return;
        }
        boardingCapture(galaxy, self, empireById, time);
    } else if (self.assaultDefenseValueDefault <= 0 || self.assaultDefenseValueFixed <= 0 || self.inView || self.inBattle) {
        const all = calculateBoardingDefenseValue(galaxy, self, time, true);
        const num12 = all.value;
        let fixedDefenseValue4 = all.fixedDefenseValue;
        if (self.assaultDefenseValue > num12) {
            const num13 = Math.max(1.0, 1.0 * timePassed);
            self.assaultDefenseValue = csShort(self.assaultDefenseValue - num13);
        } else if (self.assaultDefenseValue < num12) {
            const cur = calculateBoardingDefenseValue(galaxy, self, time);
            fixedDefenseValue4 = cur.fixedDefenseValue;
            self.assaultDefenseValue = csShort(cur.value);
        }
        self.assaultDefenseValueDefault = csShort(num12);
        self.assaultDefenseValueFixed = csShort(fixedDefenseValue4);
    }
}

/** ProcessBoardingAssault 3020-3310: the ship falls to the boarders (captured / self-destructs / scrapped / enlisted). */
function boardingCapture(galaxy: Galaxy, self: BuiltObject, empireById: Empire, time: number): void {
    let description2 = '';
    const actualEmpire2 = self.actualEmpire;
    if (actualEmpire2 !== null) {
        let empty: string;
        if (self.role === BuiltObjectRole.Base) {
            empty = formatText(getText('BASE has been boarded and captured'), self.name, empireById.name);
        } else {
            const arg = resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, self.subRole).toLowerCase();
            empty = formatText(getText('Our ship X has been boarded and captured'), arg, self.name, empireById.name);
        }
        sendMessageToEmpire(actualEmpire2, self.actualEmpire, EmpireMessageType.ShipBaseBoardedLost, self, empty);
        description2 = self.role !== BuiltObjectRole.Base ? formatText(getText('We have boarded and captured the ship X'), self.name, actualEmpire2.name) : formatText(getText('We have boarded and captured BASE'), self.name, actualEmpire2.name);
    }
    const chars = charactersOf(self);
    if (chars !== null && chars.length > 0) {
        const array = chars.slice();
        for (const character of array) {
            if (character != null) {
                if (self.role === BuiltObjectRole.Base) characterSendDeathMessage(galaxy, character, CharacterDeathType.BaseCaptured);
                else characterSendDeathMessage(galaxy, character, CharacterDeathType.ShipCaptured);
                character.kill(galaxy);
            }
        }
    }
    if (actualEmpire2 !== null && actualEmpire2.characters !== null) {
        const ec = actualEmpire2.characters as Character[];
        for (let j = 0; j < ec.length; j++) {
            const character2 = ec[j];
            if (character2 != null && character2.active && character2.transferDestination !== null && character2.transferDestination === self && character2.location !== self) character2.resetTransfer();
        }
    }
    if (self.troops !== null && self.troops.count > 0) {
        for (let k = 0; k < self.troops.count; k++) {
            const troop = self.troops.items[k];
            const te = troop != null ? (troop.empire as Empire | null) : null;
            if (troop != null && te !== null && te.troops.contains(troop)) te.troops.remove(troop);
        }
        self.troops.clear();
    }
    if (self.pirateEmpireId > 0) {
        const empireById2 = getEmpireById(galaxy, self.pirateEmpireId);
        if (empireById2 !== null && empireById2.pirateEmpireBaseHabitat !== null && galaxy.rnd.next(0, 7) === 1) {
            const builtObject = identifyPirateSpaceport(galaxy, empireById2);
            if (builtObject !== null && builtObject.nearestSystemStar !== null && empireById !== null && empireById.knownPirateBases !== null && !empireById.knownPirateBases.includes(builtObject)) {
                empireById.knownPirateBases.push(builtObject);
                const habitat = galaxy.determineHabitatSystemStar(builtObject.nearestSystemStar);
                const text = `(${Math.trunc(habitat.xpos)}, ${Math.trunc(habitat.ypos)})`; // ResolveSectorDescription (text, M9)
                const message = formatText(getText('Ship Capture Reveals Pirate Base'), self.name, empireById2.name, builtObject.name, habitat.name, text);
                sendEventMessageToEmpire(empireById, EventMessageType.GeneralDiscovery, getText('Ship Capture Reveals Pirate Base Title'), message, builtObject, null);
            }
        }
    }
    let flag = false;
    if (self.role === BuiltObjectRole.Base && self.parentHabitat !== null && self.parentHabitat.empire !== null && self.parentHabitat.population != null && self.parentHabitat.population.items.length > 0) flag = true;
    if (flag) {
        const habitat2 = galaxy.determineHabitatSystemStar(self.nearestSystemStar!);
        const parent = self.parentHabitat!;
        if (empireById.pirateEmpireBaseHabitat !== null) {
            const num4 = scrapCapturedForLoot(galaxy, self, empireById);
            const message2 = formatText(getText('Boarded Base Self Destructs Capture Loot'), self.name, parent.name, habitat2.name, num4.toFixed(0));
            sendEventMessageToEmpire(empireById, EventMessageType.GeneralDiscovery, getText('Boarded Base Self Destructs Title'), message2, self, parent);
        } else {
            const message3 = formatText(getText('Boarded Base Self Destructs Capture'), self.name, parent.name, habitat2.name);
            sendEventMessageToEmpire(empireById, EventMessageType.GeneralDiscovery, getText('Boarded Base Self Destructs Title'), message3, self, parent);
        }
        const message4 = formatText(getText('Boarded Base Self Destructs Loss'), empireById.name, self.name, parent.name, habitat2.name);
        sendEventMessageToEmpire(self.empire!, EventMessageType.GeneralDiscovery, getText('Boarded Base Self Destructs Title'), message4, self, parent);
        inflictDamageFull(galaxy, self, self, null, 1000000.0, time, 0, false, 0.0, false);
    } else {
        checkCancelAttackMissionsForBuiltObject(galaxy, self, empireById);
        takeOwnershipOfBuiltObject(galaxy, empireById, self, empireById, true, true);
        sendMessageToEmpire(empireById, empireById, EmpireMessageType.ShipBaseBoardedCaptured, self, description2);
        empireById.counters.captureShipCount++;
        const nearestBuiltObject = getNearestBuiltObject(empireById.builtObjects, self.xpos, self.ypos, BuiltObjectRole.Military, self);
        if (nearestBuiltObject !== null && !chanceNewShipCaptainCaptured(galaxy, self, empireById, nearestBuiltObject, true, false)) {
            chanceNewFleetAdmiralCaptured(galaxy, self, empireById, nearestBuiltObject, true);
        }
        const num5 = calculateBoardingDefenseValue(galaxy, self, time, true).value;
        self.assaultDefenseValue = Math.min(csShort(num5), self.assaultAttackValue);
        self.assaultAttackValue = 0;
        self.assaultOwnershipChangeCounter = 3000;
    }
    if (empireById.pirateEmpireBaseHabitat !== null) {
        const byAttackTarget = empireById.pirateMissions.getByAttackTarget(self, empireById);
        if (byAttackTarget !== null) completePirateMission(galaxy, empireById, byAttackTarget);
    }
    const policy = empireById.policy;
    if (flag || policy == null) return;
    if (self.role === BuiltObjectRole.Base) {
        let flag2 = false;
        switch (policy.captureEnlistBase) {
            case 0:
                flag2 = false;
                break;
            case 1:
                flag2 = self.subRole !== BuiltObjectSubRole.EnergyResearchStation && self.subRole !== BuiltObjectSubRole.HighTechResearchStation && self.subRole !== BuiltObjectSubRole.WeaponsResearchStation;
                break;
            case 2:
                flag2 = true;
                break;
        }
        if (flag2) {
            const num6 = scrapCapturedForLoot(galaxy, self, empireById);
            const empty2 = (self.role as BuiltObjectRole) !== BuiltObjectRole.Base ? formatText(getText('Captured Ship Scrapped Description'), self.name, num6.toFixed(0)) : formatText(getText('Captured Base Scrapped Description'), self.name, num6.toFixed(0));
            sendMessageToEmpire(empireById, empireById, EmpireMessageType.ShipBaseScrapped, self, empty2);
            self.doingConstruction = true;
            // NextSoundTimeConstruction = 0 (UI sound).
            inflictDamageFull(galaxy, self, self, null, 1000000.0, time, 0, false, 0.0, false);
        }
        return;
    }
    let num7 = 0;
    if (self.role === BuiltObjectRole.Military) num7 = policy.captureEnlistMilitaryShip;
    else if ((self.role as BuiltObjectRole) !== BuiltObjectRole.Base) num7 = policy.captureEnlistCivilianShip;
    let flag3 = true;
    const num8 = resolveTechBonusFactor(empireById, galaxy, self);
    switch (num7) {
        case 0:
            flag3 = true;
            break;
        case 1:
            if (self.size <= empireById.maximumConstructionSize(self.subRole) && num8 <= 1.0) flag3 = false;
            break;
        case 2:
            if (self.size > empireById.maximumConstructionSize(self.subRole) || num8 > 1.0) flag3 = false;
            break;
        case 3:
            flag3 = false;
            break;
    }
    if (flag3) {
        if (empireById.pirateEmpireBaseHabitat !== null && self.role === BuiltObjectRole.Freight) chanceNewShipCaptainCaptured(galaxy, self, empireById, self, true, true);
        let flag4 = false;
        if (self.role === BuiltObjectRole.Military) flag4 = policy.upgradeEnlistedMilitaryShips;
        else if ((self.role as BuiltObjectRole) !== BuiltObjectRole.Base) flag4 = policy.upgradeEnlistedCivilianShips;
        if (flag4) {
            clearPreviousMissionRequirements(galaxy, self);
            const design = findNewestCanBuild(empireById.designs, self.subRole, empireById);
            if (design !== null) assignRetrofitMission(galaxy, empireById, self, design, null, true);
        }
        return;
    }
    let num9 = 0;
    if (self.role === BuiltObjectRole.Military) num9 = policy.captureDisassembleMilitaryShip;
    else if ((self.role as BuiltObjectRole) !== BuiltObjectRole.Base) num9 = policy.captureDisassembleCivilianShip;
    let flag5 = true;
    switch (num9) {
        case 0:
            flag5 = true;
            break;
        case 1:
            if (self.size > empireById.maximumConstructionSize(self.subRole) || num8 > 1.0) flag5 = false;
            break;
        case 2:
            flag5 = false;
            break;
    }
    const num10 = self.components.countNormalComponentsByCategory(ComponentCategoryType.HyperDrive);
    if (!flag5) {
        if (self.topSpeed <= 0) flag5 = true;
        else if (self.warpSpeed <= 0 && num10 <= 0) flag5 = true;
    }
    if (flag5) {
        const num11 = scrapCapturedForLoot(galaxy, self, empireById);
        const empty3 = (self.role as BuiltObjectRole) !== BuiltObjectRole.Base ? formatText(getText('Captured Ship Scrapped Description'), self.name, num11.toFixed(0)) : formatText(getText('Captured Base Scrapped Description'), self.name, num11.toFixed(0));
        sendMessageToEmpire(empireById, empireById, EmpireMessageType.ShipBaseScrapped, self, empty3);
        self.doingConstruction = true;
        inflictDamageFull(galaxy, self, self, null, 1000000.0, time, 0, false, 0.0, false);
    } else if (!assignScrapMission(galaxy, empireById, self, false, num10 <= 0)) {
        inflictDamageFull(galaxy, self, self, null, 1000000.0, time, 0, false, 0.0, false);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ShipGroup.cs 3165 TotalAvailableBoardingAssaultStrengthCapturingTarget
// ---------------------------------------------------------------------------------------------------------------

/** ShipGroup.cs 3165 TotalAvailableBoardingAssaultStrengthCapturingTarget(time, target). No Rnd. */
export function shipGroupTotalAvailableBoardingAssaultStrengthCapturingTarget(galaxy: Galaxy, shipGroup: ShipGroup, time: number, target: BuiltObject | Habitat | Creature | null): number {
    void galaxy;
    let num = 0;
    for (let index = 0; index < shipGroup.ships.length; ++index) {
        const ship = shipGroup.ships[index];
        if (ship != null && !ship.hasBeenDestroyed) {
            const mission = builtObjectMission(ship.mission);
            if (mission !== null && mission.target === target && (mission.type === BuiltObjectMissionType.Raid || mission.type === BuiltObjectMissionType.Capture)) {
                num += builtObjectCalculateAssaultPodAttackValues(ship, time).value;
            }
        }
    }
    return num;
}
