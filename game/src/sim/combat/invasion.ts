// M4q — ground invasion, colony capture, ownership scans.
//
// Ports (statement for statement, same Galaxy.Rnd draw order):
//   Habitat.cs 3365 ResolveInvasionBattles, 2982 CheckForReinforcements, 3032 InvadingSpecialForcesAttack,
//   3171 AttemptToDamagePlanetaryDefenseUnits, 3200 AttemptToDestroyFacility, 3300 PiratesDefendAgainstRaid,
//   4336 CalculatePopulationStrength, 4368 DetermineTroopModifiers, 4423 CalculateSpaceControlStrengths,
//   4435 CalculateForceStrengths, 4447 CalculateForceStrength, 4559 DetermineDefendBonuses, 4749 DetermineAttackBonuses,
//   4973/4978 InflictTroopLosses, 5888 IdentifyLeavingEmpire, 1204 StopRebelling, 5589/5602 Set/GetDevelopmentLevel;
//   BaconHabitat.cs 1162 CalculateSpaceControlStrengths, 1188 CalculateForceStrengths;
//   TroopList.cs 128 GetTroopStrengthsByType, 426 RemoveTroopsByType; InvasionStats.cs;
//   Galaxy.5.cs 3067 GetNearbyBuiltObjects, 4953 DoRaidBonuses; Galaxy.2.cs 5192 ChanceNewTroopGeneralFromInvasion;
//   Empire.8.cs 5197 FindNearestTroopShipWithSpace; Empire.9.cs 525 AssignFleetUnloadTroops;
//   Empire.4.cs 4449 InvadeUnwillingColonizationTargets; Empire.10.cs 3777 GenerateAutomationMessageInvadeIndependent;
//   EmpireCounters.cs 288 ProcessColonyConquest; ResearchSystem.cs 240 ResolveMoreAdvancedProjects;
//   BuiltObjectList.cs 497 GetNearestBuiltObject(x, y, role, exclude).
// Ownership transfer (TakeOwnershipOfColony / TakeOwnershipOfBuiltObject / ClearColony / ScanForNewOwner) lives in
// combat/ownership.ts; the entry points other packages import from here are re-exported at the end of this file.
//
// Habitat.ColonyInvasion is the UI's invasion view (ColonyInvasion.cs: images, explosions, its own clock-seeded Random).
// The tick resolves invasions only while it is null (Habitat.cs 1487), so its Rnd-drawing AddExplosion branches are
// dead in the headless sim; colonyInvasionUi throws a TODO if a view is ever attached (UI port, M9).
// Habitat._PirateColonyControl: M4s2's PirateColonyControlList (wired at the M4q merge; see pirateColonyControl below).

import { isAiControlled } from '../missions/playerOrder';
import { recordRaidLoss } from '../scenario/emergent/crisesCore';
import { scenarioQuery } from '../scenario/hooks';
import { registerTodo, todo } from '../tick/todo';
import { cancelBlockadeColony } from '../fleets/blockades';
import { getNearbyBuiltObjects } from '../pirates/pirateAI';
import { identifyLeavingEmpire } from '../events';
import type { PirateColonyControlList } from '../pirates/pirateColonyControl';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import { HabitatType, type Habitat } from '../types';
import type { Race } from '../data/races';
import { Cargo, Troop as TroopClass, TroopList, TroopType, type Troop } from '../cargo';
import { empireRaidStrengthFactor } from './boarding';
import { ensureHabitatInvadingCharacters, ensureStellarObjectCharacters } from '../characters';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isBuiltObject, isHabitat, type StellarObject } from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../missions/assign';
import { shipGroupAssignMission, type ShipGroup } from '../fleets/shipGroup';
import { shipGroupIsShipAvailable } from '../fleets/shipGroupTasks';
import { EmpireMessageType, resolveDescription, sendMessageToEmpire, sendMessageToEmpireWithTitle } from '../messages';
import { formatText, getText } from '../diplomacyTick';
import { DiplomaticRelationType } from '../diplomacy';
import {
    CharacterRole,
    generateNewCharacter,
    habitatInvadingCharacterList,
    stellarObjectCharacters,
    type Character,
} from '../characters';
import { CharacterDeathType, characterSendDeathMessage } from '../characterRuntime';
import { charactersCanGenerateAmountNonIntelligenceAgent, raceCharacterRandomAppearanceChanceGeneral, resolveInvasionEmpires } from '../troops';
import { PlanetaryFacilityType } from '../researchSystem';
import { checkRemoveFacilityTracking, facilitiesFindBestPirateFacility, facilitiesFindByType, reviewPlanetaryFacilities, type PlanetaryFacility } from '../construction/facilities';
import { SECTOR_SIZE, cargoEmpireId } from '../logistics/orders';
import { getEmpireById } from '../logistics/contracts';
import { fastFindNearestColony } from './threats';
import { raceAggressionLevel } from '../colonyTick';
import { getBuiltObjectsAtLocation } from '../stationPlacement';

import { HabitatCategoryType } from '../types';
import { AutomationLevel } from '../empire';
import { CharacterEventType, CharacterSkillType, doCharacterEventForList, empireLeader, getHighestSkillLevelExcludeLeaders, getHighestSkillLevelExcludeRole, identifyPirateBase } from '../characters';
import { identifyPirateSpaceport, inflictWarDamageHabitat, empireColonyIncomeFactor } from './damage';
import { checkIonCannonReadyToFire, checkTargetInRange, habitatFireWeaponsAtTarget } from './weapons';
import { sendNewEmpireRaceAbilityEvent } from '../events';
import { resolveStandardRaceBias } from '../raceBias';
import { reviewEmpireTerritory } from '../exploration';
import { reviewEmpireAbilityBonusesFull } from '../treasury';
import { EmpireActivityType } from '../pirates/empireActivity';
import { obtainPirateRelation } from '../pirateRelations';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { pirateEconomyPerformIncome } from '../pirates/pirateAI';
import { doResearchBreakthrough } from '../researchTick';
import { findNodeById, getProjectsByIndustry, type TechNode } from '../researchSystem';
import { IndustryType } from '../types';
import { galaxyStarDate } from '../tick/simTime';
import { findNearestAvailableFleet } from '../fleets/militaryAI';
import { FleetPosture, checkTaskAuthorized, AdvisorMessageType } from '../diplomacyTick';
import { checkColonizationLikeliness } from '../tradeItems';
import type { ColonizationTarget } from '../civilianAI';
import { resolveMoreAdvancedProjectsIncludeSpecial } from '../espionage';
import {
    clearColony as clearColonyImpl,
    takeOwnershipOfBuiltObject as takeOwnershipOfBuiltObjectImpl,
    takeOwnershipOfColonyFull,
    scanForNewOwnerHabitat as scanForNewOwnerHabitatImpl,
    scanForNewOwnerBuiltObject as scanForNewOwnerBuiltObjectImpl,
    cancelAttacksHabitat,
} from './ownership';
import { baconSettings } from '../data/baconSettings';

/** Galaxy.ResolveDescription(HabitatCategoryType) key table. */
const HabitatCategoryDesc = HabitatCategoryType as unknown as Record<number, string>;

const f32 = Math.fround;

// ---------------------------------------------------------------------------------------------------------------
// InvasionStats.cs
// ---------------------------------------------------------------------------------------------------------------

/** InvasionStats.cs (Habitat.InvasionStats; the GroundInvasion character event data). */
export class InvasionStats {
    colony: Habitat | null;
    troopsDamageToInvaders = 0; // float
    troopsDamageToDefenders = 0; // float
    destroyedInvadingTroops = 0;
    destroyedDefendingTroops = 0;
    invasionSucceeded = false;
    invadingEmpire: Empire | null;
    defendingEmpire: Empire | null;
    constructor(colony: Habitat | null, invadingEmpire: Empire | null, defendingEmpire: Empire | null) {
        this.colony = colony;
        this.invadingEmpire = invadingEmpire;
        this.defendingEmpire = defendingEmpire;
    }
}

/** Habitat.InvasionStats (declared `unknown` in the M4q block of types.ts). */
export function invasionStatsOf(habitat: Habitat): InvasionStats | null {
    return habitat.invasionStats as InvasionStats | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Small typed views and helpers
// ---------------------------------------------------------------------------------------------------------------

export function troopEmpire(troop: Troop): Empire | null {
    return troop.empire as Empire | null;
}
function troopRace(troop: Troop): Race | null {
    return troop.race as Race | null;
}
function colonyCharacters(h: Habitat): Character[] | null {
    return stellarObjectCharacters(h);
}
function invadingCharacters(h: Habitat): Character[] | null {
    return habitatInvadingCharacterList(h);
}
function removeFirst<T>(list: T[] | null, item: T): boolean {
    if (list === null) return false;
    const i = list.indexOf(item);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
}

/** C# (int)double on x86/x64: NaN / out of range → int.MinValue. */
export function csDoubleToInt(v: number): number {
    if (!Number.isFinite(v) || v >= 2147483648 || v <= -2147483649) return -2147483648;
    return Math.trunc(v);
}

/**
 * Habitat.ColonyInvasion.AddExplosion / AddInvaderLanding* (UI). Never reached from the tick (see header); throws when a
 * view is attached so the skipped Rnd draws (firer selection) cannot go unnoticed.
 */
export function colonyInvasionUi(habitat: Habitat): void {
    if (habitat.colonyInvasion !== null) {
        throw new Error('TODO(port) M9: ColonyInvasion view (AddExplosion / AddInvaderLanding, firer Rnd draws)');
    }
}

/** Habitat.cs 5589 SetDevelopmentLevel(developmentLevel): clamp _DevelopmentLevel to [0, 50]. */
export function setDevelopmentLevel(habitat: Habitat, developmentLevel: number): void {
    habitat.developmentLevel = developmentLevel;
    if (habitat.developmentLevel > 50) {
        habitat.developmentLevel = 50;
    } else if (habitat.developmentLevel < 0) {
        habitat.developmentLevel = 0;
    }
}
/** Habitat.cs 5602 GetDevelopmentLevel(): _DevelopmentLevel. */
export function getDevelopmentLevel(habitat: Habitat): number {
    return habitat.developmentLevel;
}

/** TroopList.cs 426 RemoveTroopsByType(troopTypeToRemove, alsoRemoveFromEmpire). */
export function removeTroopsByType(list: TroopList, troopTypeToRemove: TroopType, alsoRemoveFromEmpire: boolean): void {
    const troopList: Troop[] = [];
    for (let index = 0; index < list.count; ++index) {
        const troop = list.items[index];
        if (troop != null && troop.type === troopTypeToRemove) troopList.push(troop);
    }
    for (let index = 0; index < troopList.length; ++index) {
        const troop = troopList[index];
        if (troop != null) {
            list.remove(troop);
            const e = troopEmpire(troop);
            if (alsoRemoveFromEmpire && e !== null && e.troops != null && e.troops.contains(troop)) e.troops.remove(troop);
        }
    }
}

/** TroopList.cs 128 GetTroopStrengthsByType(defending, out infantry, out artillery, out armor, out specialForces). */
export function getTroopStrengthsByType(list: TroopList, defending: boolean): { infantryStrength: number; artilleryStrength: number; armorStrength: number; specialForcesStrength: number } {
    let infantryStrength = 0.0;
    let armorStrength = 0.0;
    let artilleryStrength = 0.0;
    let specialForcesStrength = 0.0;
    for (let index = 0; index < list.count; ++index) {
        const troop = list.items[index];
        if (troop == null) continue;
        switch (troop.type) {
            case TroopType.Infantry:
            case TroopType.PirateRaider:
                if (defending) infantryStrength += troop.overallDefendStrength;
                else infantryStrength += troop.overallAttackStrength;
                break;
            case TroopType.Armored:
                if (defending) armorStrength += troop.overallDefendStrength;
                else armorStrength += troop.overallAttackStrength;
                break;
            case TroopType.Artillery:
                if (defending) artilleryStrength += troop.overallDefendStrength;
                else artilleryStrength += troop.overallAttackStrength;
                break;
            case TroopType.SpecialForces:
                if (defending) specialForcesStrength += troop.overallDefendStrength;
                else specialForcesStrength += troop.overallAttackStrength;
                break;
        }
    }
    return { infantryStrength, artilleryStrength, armorStrength, specialForcesStrength };
}

/** BuiltObjectList.cs 497 GetNearestBuiltObject(x, y, role, builtObjectToExclude). */
export function getNearestBuiltObject(list: readonly BuiltObject[], x: number, y: number, role: BuiltObjectRole, builtObjectToExclude: BuiltObject | null): BuiltObject | null {
    let result: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < list.length; i++) {
        const builtObject = list[i];
        if (builtObject != null && builtObject !== builtObjectToExclude && builtObject.role === role) {
            // Galaxy.CalculateDistanceSquaredStatic.
            const dx = x - builtObject.xpos;
            const dy = y - builtObject.ypos;
            const num2 = dx * dx + dy * dy;
            if (num2 < num) {
                num = num2;
                result = builtObject;
            }
        }
    }
    return result;
}

/** The character death bookkeeping repeated through ResolveInvasionBattles (counters, UI explosion, message, Kill). */
function killInvasionCharacter(galaxy: Galaxy, habitat: Habitat, counterEmpire: Empire | null, character: Character): void {
    if (counterEmpire !== null && counterEmpire.counters !== null) {
        counterEmpire.counters.processCharacterDeath(character);
    }
    colonyInvasionUi(habitat);
    characterSendDeathMessage(galaxy, character, CharacterDeathType.ColonyInvasion);
    character.kill(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat._PirateColonyControl (PirateColonyControlList.cs): M4s2's model (pirates/pirateColonyControl.ts, Habitat field)
// ---------------------------------------------------------------------------------------------------------------

/** Habitat._PirateColonyControl / GetPirateControl() (types.ts Habitat.pirateColonyControl, never null in the TS model). */
export function pirateColonyControl(habitat: Habitat): PirateColonyControlList {
    return habitat.pirateColonyControl;
}

// ---------------------------------------------------------------------------------------------------------------
// Space control / force strengths
// ---------------------------------------------------------------------------------------------------------------

/**
 * Habitat.cs 4423 CalculateSpaceControlStrengths(defender, invader, out defenders, out attackers) → BaconHabitat.cs 1162
 * (the Bacon body re-resolves the invasion empires itself; the arguments are overwritten). No Rnd.
 */
export function calculateSpaceControlStrengths(galaxy: Galaxy, habitat: Habitat, defender: Empire | null, invader: Empire | null): { defenders: number; attackers: number } {
    void defender;
    void invader;
    const planet = habitat;
    const { defender: defendingEmpire, invader: attackingEmpire } = resolveInvasionEmpires(planet);
    let spaceControlStrengthDefenders = 0;
    let spaceControlStrengthAttackers = 0;
    // BaconBuiltObject.myMain is set in any running game.
    const nearbyBuiltObjects = getNearbyBuiltObjects(galaxy, planet.xpos, planet.ypos, 2000.0);
    for (let index = 0; index < nearbyBuiltObjects.length; ++index) {
        const builtObject = nearbyBuiltObjects[index];
        if (builtObject != null && !builtObject.hasBeenDestroyed && builtObject.firepowerRaw > 0) {
            if (builtObject.owner === defendingEmpire) spaceControlStrengthDefenders += builtObject.firepowerRaw;
            else if (builtObject.owner === attackingEmpire) spaceControlStrengthAttackers += builtObject.firepowerRaw;
        }
    }
    return { defenders: spaceControlStrengthDefenders, attackers: spaceControlStrengthAttackers };
}

export { resolveInvasionEmpires };

/** A troop's empire can colonise this habitat type (the DetermineDefendBonuses / DetermineAttackBonuses switch). */
function empireCanColonizeType(empire: Empire, type: HabitatType): boolean {
    switch (type) {
        case HabitatType.Continental:
            return empire.canColonizeContinental;
        case HabitatType.MarshySwamp:
            return empire.canColonizeMarshySwamp;
        case HabitatType.Desert:
            return empire.canColonizeDesert;
        case HabitatType.Ocean:
            return empire.canColonizeOcean;
        case HabitatType.Ice:
            return empire.canColonizeIce;
        case HabitatType.Volcanic:
            return empire.canColonizeVolcanic;
        default:
            return false;
    }
}

export interface Modifiers {
    amounts: number[];
    reasons: string[];
}

/** Troop-general skill modifier shared by DetermineDefendBonuses / DetermineAttackBonuses (Habitat.cs 4631-4691 / 4821-4881). */
function troopGeneralModifier(characters: Character[] | null, defending: boolean, num: number, num2: number, num3: number, num4: number): { flag2: boolean; num9: number } {
    const num8 = num + num2 + num3 + num4;
    let flag2 = false;
    let num9 = 0.0;
    if (characters !== null && characters.length > 0) {
        let num10 = -100;
        let num11 = -100;
        let num12 = -100;
        let num13 = -100;
        let num14 = -100;
        for (let j = 0; j < characters.length; j++) {
            const character = characters[j];
            if (character != null && character.role === CharacterRole.TroopGeneral) {
                flag2 = true;
                num10 = Math.max(num10, defending ? character.troopGroundDefense : character.troopGroundAttack);
                num11 = Math.max(num11, character.troopStrengthInfantry);
                num12 = Math.max(num12, character.troopStrengthArmor);
                num13 = Math.max(num13, character.troopStrengthPlanetaryDefense);
                num14 = Math.max(num14, character.troopStrengthSpecialForces);
            }
        }
        if (num10 <= -100) num10 = 0;
        if (num11 <= -100) num11 = 0;
        if (num12 <= -100) num12 = 0;
        if (num13 <= -100) num13 = 0;
        if (num14 <= -100) num14 = 0;
        if (num > 0.0 && num11 !== 0) num9 += (num / num8) * (num11 / 100.0);
        if (num2 > 0.0 && num12 !== 0) num9 += (num2 / num8) * (num12 / 100.0);
        if (num3 > 0.0 && num13 !== 0) num9 += (num3 / num8) * (num13 / 100.0);
        if (num4 > 0.0 && num14 !== 0) num9 += (num4 / num8) * (num14 / 100.0);
        num9 += num10 / 100.0;
    }
    return { flag2, num9 };
}

/** Planet-type sums shared by DetermineDefendBonuses / DetermineAttackBonuses (Habitat.cs 4574-4630 / 4764-4820). */
function planetTypeSums(habitat: Habitat, troops: TroopList, defending: boolean): { num: number; num2: number; num3: number; num4: number; num5: number; num6: number } {
    let num = 0.0;
    let num2 = 0.0;
    let num3 = 0.0;
    let num4 = 0.0;
    let num5 = 0.0;
    let num6 = 0.0;
    for (let i = 0; i < troops.count; i++) {
        const troop = troops.items[i];
        if (troop == null) continue;
        const s = defending ? troop.overallDefendStrength : troop.overallAttackStrength;
        switch (troop.type) {
            case TroopType.Infantry:
                num += s;
                break;
            case TroopType.Armored:
                num2 += s;
                break;
            case TroopType.Artillery:
                num3 += s;
                break;
            case TroopType.SpecialForces:
                num4 += s;
                break;
        }
        num5 += s;
        num6 += s;
        const race = troopRace(troop);
        if (troop != null && race !== null && race.nativeHabitatType === habitat.type) {
            num6 += s * 0.1;
            continue;
        }
        let flag = false;
        const e = troopEmpire(troop);
        if (e !== null) flag = empireCanColonizeType(e, habitat.type);
        if (race !== null && race.nativeHabitatType === habitat.type) flag = true;
        if (!flag) num6 -= s * 0.1;
    }
    return { num, num2, num3, num4, num5, num6 };
}

/** Habitat.cs 4559 DetermineDefendBonuses(troops, characters, out amounts, out reasons). No Rnd. */
export function determineDefendBonuses(galaxy: Galaxy, habitat: Habitat, troops: TroopList | null, characters: Character[] | null): Modifiers {
    const modifierAmounts: number[] = [];
    const modifierReasons: string[] = [];
    const result = { amounts: modifierAmounts, reasons: modifierReasons };
    if (troops === null) return result;
    const { num, num2, num3, num4, num5, num6 } = planetTypeSums(habitat, troops, true);
    if (num5 > 0.0 && num6 > 0.0) {
        const num7 = num6 / num5 - 1.0;
        if (num7 !== 0.0) {
            modifierAmounts.push(num7);
            modifierReasons.push(getText('Planet Type'));
        }
    }
    const { flag2, num9 } = troopGeneralModifier(characters, true, num, num2, num3, num4);
    if (flag2 && num9 !== 0.0) {
        modifierAmounts.push(num9);
        modifierReasons.push(getText('Colony Invasion Bonus Troop General'));
    }
    if (habitat.defensiveFortressBonus > 0) {
        modifierAmounts.push(habitat.defensiveFortressBonus / 10.0);
        modifierReasons.push(getText('Colony Invasion Bonus Defensive Facilities'));
    }
    const control = pirateColonyControl(habitat);
    if (control === null || control.count <= 0 || troops.count <= 0) return result;
    const troop2 = troops.items[0];
    if (troop2 == null || troop2.type !== TroopType.PirateRaider || troopEmpire(troop2) === null || habitat.facilities === null) return result;
    // PlanetaryFacilityList.FindBestCompletedPirateFacility(includeCriminalNetwork: true).
    const planetaryFacility = facilitiesFindBestPirateFacility(habitat.facilities, true, true);
    if (planetaryFacility === null) return result;
    const byFacilityControl = control.getByFacilityControl();
    if (byFacilityControl === null) return result;
    const empireById = getEmpireById(galaxy, byFacilityControl.empireId);
    if (empireById !== null && empireById === troopEmpire(troop2)) {
        let item = 0.25;
        switch (planetaryFacility.type) {
            case PlanetaryFacilityType.PirateBase:
                item = 0.25;
                break;
            case PlanetaryFacilityType.PirateFortress:
                item = 0.5;
                break;
            case PlanetaryFacilityType.PirateCriminalNetwork:
                item = 1.0;
                break;
        }
        modifierAmounts.push(item);
        modifierReasons.push(getText('Colony Invasion Bonus Pirate Facilities'));
    }
    return result;
}

/** Habitat.cs 4749 DetermineAttackBonuses(troops, characters, out amounts, out reasons). No Rnd. */
export function determineAttackBonuses(habitat: Habitat, troops: TroopList | null, characters: Character[] | null): Modifiers {
    const modifierAmounts: number[] = [];
    const modifierReasons: string[] = [];
    const result = { amounts: modifierAmounts, reasons: modifierReasons };
    if (troops === null) return result;
    const { num, num2, num3, num4, num5, num6 } = planetTypeSums(habitat, troops, false);
    if (num5 > 0.0 && num6 > 0.0) {
        const num7 = num6 / num5 - 1.0;
        if (num7 !== 0.0) {
            modifierAmounts.push(num7);
            modifierReasons.push(getText('Planet Type'));
        }
    }
    const { flag2, num9 } = troopGeneralModifier(characters, false, num, num2, num3, num4);
    if (flag2 && num9 !== 0.0) {
        modifierAmounts.push(num9);
        modifierReasons.push(getText('Colony Invasion Bonus Troop General'));
    }
    return result;
}

/** Habitat.cs 4368 DetermineTroopModifiers(defendingEmpire, attackingEmpire, defendingTroops, attackingTroops, ...). No Rnd. */
export function determineTroopModifiers(
    galaxy: Galaxy,
    habitat: Habitat,
    defendingTroops: TroopList,
    attackingTroops: TroopList,
    defendingCharacters: Character[] | null,
    attackingCharacters: Character[] | null,
): { defend: Modifiers; attack: Modifiers } {
    const defend = determineDefendBonuses(galaxy, habitat, defendingTroops, defendingCharacters);
    const attack = determineAttackBonuses(habitat, attackingTroops, attackingCharacters);
    const d = getTroopStrengthsByType(defendingTroops, true);
    void defendingTroops.totalDefendStrength;
    // The C# passes defending: true for the attackers too.
    const a = getTroopStrengthsByType(attackingTroops, true);
    const totalAttackStrength = attackingTroops.totalAttackStrength;
    if (totalAttackStrength > 0 && d.armorStrength > 0.0 && d.armorStrength >= a.armorStrength * 2.0) {
        defend.amounts.push(0.25);
        defend.reasons.push(getText('Armored Reserve'));
    } else if (a.armorStrength > 0.0 && a.armorStrength >= d.armorStrength * 2.0) {
        attack.amounts.push(0.25);
        attack.reasons.push(getText('Armored Breakthrough'));
    }
    if (totalAttackStrength > 0 && d.infantryStrength > 0.0 && d.infantryStrength >= a.infantryStrength * 2.0) {
        defend.amounts.push(0.25);
        defend.reasons.push(getText('Fortified Line'));
    } else if (a.infantryStrength > 0.0 && a.infantryStrength >= d.infantryStrength * 2.0) {
        attack.amounts.push(0.25);
        attack.reasons.push(getText('Overwhelming Odds'));
    }
    if (totalAttackStrength > 0 && d.artilleryStrength > a.specialForcesStrength) {
        defend.amounts.push(0.25);
        defend.reasons.push(getText('Defense Grid'));
    } else if (a.artilleryStrength > d.specialForcesStrength) {
        attack.amounts.push(0.25);
        attack.reasons.push(getText('Defense Grid'));
    }
    if (totalAttackStrength > 0 && d.specialForcesStrength > a.artilleryStrength) {
        defend.amounts.push(0.25);
        defend.reasons.push(getText('Special Operations'));
    } else if (a.specialForcesStrength > d.artilleryStrength) {
        attack.amounts.push(0.25);
        attack.reasons.push(getText('Special Operations'));
    }
    if (habitat.invasionSpaceControlStrengthDefenders > habitat.invasionSpaceControlStrengthAttackers) {
        defend.amounts.push(0.25);
        defend.reasons.push(getText('Space Control'));
    } else if (habitat.invasionSpaceControlStrengthAttackers > habitat.invasionSpaceControlStrengthDefenders) {
        attack.amounts.push(0.25);
        attack.reasons.push(getText('Space Control'));
    }
    return { defend, attack };
}

/** C# Math.Round(value, 2) (MidpointRounding.ToEven) on a double. */
function roundTo2Even(value: number): number {
    const scaled = value * 100.0;
    let r = Math.round(scaled);
    if (Math.abs(scaled - Math.trunc(scaled)) === 0.5) r = 2 * Math.round(scaled / 2);
    return r / 100.0;
}


/**
 * Habitat.cs 4428/4435 CalculateForceStrengths → BaconHabitat.cs 1188 CalculateForceStrengths(planet, defender, attacker,
 * defendingTroops, defendingCharacters, attackingTroops, attackingCharacters, out defendingStrength, out attackingStrength,
 * ...). The Bacon body's try/catch swallows exceptions (both strengths then stay 0). No Rnd.
 */
export function calculateForceStrengths(
    galaxy: Galaxy,
    habitat: Habitat,
    defender: Empire | null,
    attacker: Empire | null,
    defendingTroops: TroopList,
    defendingCharacters: Character[] | null,
    attackingTroops: TroopList,
    attackingCharacters: Character[] | null,
): { defendingStrength: number; attackingStrength: number } {
    const r = calculateForceStrengthsDetailed(galaxy, habitat, defender, attacker, defendingTroops, defendingCharacters, attackingTroops, attackingCharacters);
    return { defendingStrength: r.defendingStrength, attackingStrength: r.attackingStrength };
}

/**
 * The same, with the overload's other outs (BaconHabitat.cs 1188: totalDefendModifier, totalAttackModifier,
 * modifierAmountsDefense / modifierReasonsDefense, modifierAmountsAttack / modifierReasonsAttack): the Ground Report
 * header lists the modifiers (ColonyInvasion.cs Draw, ui/screens/groundReport.ts). No Rnd, no writes.
 */
export function calculateForceStrengthsDetailed(
    galaxy: Galaxy,
    habitat: Habitat,
    defender: Empire | null,
    attacker: Empire | null,
    defendingTroops: TroopList,
    defendingCharacters: Character[] | null,
    attackingTroops: TroopList,
    attackingCharacters: Character[] | null,
): { defendingStrength: number; attackingStrength: number; totalDefendModifier: number; totalAttackModifier: number; defend: Modifiers; attack: Modifiers } {
    const { defend, attack } = determineTroopModifiers(galaxy, habitat, defendingTroops, attackingTroops, defendingCharacters, attackingCharacters);
    if (
        attacker !== null &&
        defender !== null &&
        baconSettings.useInvasionModifierReputation &&
        attackingTroops !== null &&
        attackingTroops.count > 0 &&
        attackingTroops.items[0].type !== TroopType.PirateRaider &&
        defendingTroops !== null &&
        defendingTroops.count > 0
    ) {
        // defendingTroops[0].Empire.PirateEmpireBaseHabitat: a null troop empire throws inside the Bacon try block (the
        // catch leaves both strengths at 0).
        const e0 = troopEmpire(defendingTroops.items[0]);
        if (e0 === null) return { defendingStrength: 0, attackingStrength: 0, totalDefendModifier: 0, totalAttackModifier: 0, defend: { amounts: [], reasons: [] }, attack: { amounts: [], reasons: [] } };
        if (e0.pirateEmpireBaseHabitat === null) {
            const num = defender.civilityRating - attacker.civilityRating;
            if (num < -5.0) {
                defend.amounts.push(roundTo2Even(num / 200.0));
                defend.reasons.push('Reputation');
            } else if (num > 5.0) {
                defend.amounts.push(roundTo2Even(num / 200.0));
                defend.reasons.push('Reputation');
            }
        }
    }
    let totalDefendModifier = 0.0;
    for (let index = 0; index < defend.amounts.length; ++index) totalDefendModifier += defend.amounts[index];
    let totalAttackModifier = 0.0;
    for (let index = 0; index < attack.amounts.length; ++index) totalAttackModifier += attack.amounts[index];
    const defendingStrength = csDoubleToInt((1.0 + totalDefendModifier) * defendingTroops.totalDefendStrength);
    const attackingStrength = csDoubleToInt((1.0 + totalAttackModifier) * attackingTroops.totalAttackStrength);
    return { defendingStrength, attackingStrength, totalDefendModifier, totalAttackModifier, defend, attack };
}

/** Habitat.cs 4447 CalculateForceStrength(troops, characters, defending, out amounts, out reasons). No Rnd. */
export function calculateForceStrength(galaxy: Galaxy, habitat: Habitat, troops: TroopList | null, characters: Character[] | null, defending: boolean): number {
    let result = 0;
    if (troops !== null) {
        const modifiers = defending ? determineDefendBonuses(galaxy, habitat, troops, characters) : determineAttackBonuses(habitat, troops, characters);
        let num = 1.0;
        for (let i = 0; i < modifiers.amounts.length; i++) num += modifiers.amounts[i];
        result = !defending ? troops.totalAttackStrength : troops.totalDefendStrength;
        result = csDoubleToInt(result * num);
    }
    return result;
}

/** Habitat.cs 4336 CalculatePopulationStrength(out isDefending, invader, defender). No Rnd. */
export function calculatePopulationStrength(galaxy: Galaxy, habitat: Habitat, invader: Empire | null, defender: Empire | null): { result: number; isDefending: boolean } {
    let isDefending = true;
    let result = 0;
    if (habitat.population != null && habitat.population.dominantRace !== null) {
        result = Math.trunc(habitat.population.totalAmount / 5000000) * raceAggressionLevel(galaxy, habitat.population.dominantRace);
    }
    let flag = false;
    if (habitat.rebelling && habitat.invadingTroops !== null) {
        for (let i = 0; i < habitat.invadingTroops.count; i++) {
            const troop = habitat.invadingTroops.items[i];
            if (troop != null && (troopEmpire(troop) === galaxy.independentEmpire || troopEmpire(troop) === null)) {
                flag = true;
                break;
            }
        }
    }
    let flag2 = false;
    if (invader !== null && invader === habitat.empire && defender !== null && defender.pirateEmpireBaseHabitat !== null) flag2 = true;
    if (flag || flag2) isDefending = false;
    return { result, isDefending };
}

// ---------------------------------------------------------------------------------------------------------------
// Troop losses, special forces, reinforcements
// ---------------------------------------------------------------------------------------------------------------

/**
 * Habitat.cs 4973/4978 InflictTroopLosses(defendingEmpire, inflicter, losses, troops, attackingTroops, galaxy[,
 * specialForcesEvadeBetter = true]). Rnd: Next(0, troops.Count) per troop hit (recursing while the losses exceed a
 * troop's readiness); the UI firer draws only with a ColonyInvasion view. (M4o's stub signature, InflictBombardDamage.)
 */
export function inflictTroopLosses(galaxy: Galaxy, habitat: Habitat, defendingEmpire: Empire | null, inflicter: Empire | null, losses: number, troops: TroopList | null, attackingTroops: TroopList | null, specialForcesEvadeBetter = true): void {
    void attackingTroops;
    if (troops === null || troops.count <= 0) return;
    const troop = troops.items[galaxy.rnd.next(0, troops.count)];
    if (troop == null) return;
    if (troop.type === TroopType.SpecialForces && specialForcesEvadeBetter) losses /= 3.0;
    const stats = invasionStatsOf(habitat);
    if (troop.readiness >= losses) {
        troop.readiness = f32(troop.readiness - f32(losses));
        colonyInvasionUi(habitat);
        if (stats !== null) {
            if (inflicter === defendingEmpire) stats.troopsDamageToInvaders = f32(stats.troopsDamageToInvaders + f32(losses));
            else stats.troopsDamageToDefenders = f32(stats.troopsDamageToDefenders + f32(losses));
        }
        return;
    }
    if (inflicter !== null && inflicter.counters !== null) inflicter.counters.processTroopDestruction(troop);
    if (stats !== null) {
        if (inflicter === defendingEmpire) {
            stats.troopsDamageToInvaders = f32(stats.troopsDamageToInvaders + troop.readiness);
            stats.destroyedInvadingTroops++;
        } else {
            stats.troopsDamageToDefenders = f32(stats.troopsDamageToDefenders + troop.readiness);
            stats.destroyedDefendingTroops++;
        }
    }
    colonyInvasionUi(habitat);
    losses -= troop.readiness;
    troops.remove(troop);
    const e = troopEmpire(troop);
    if (e !== null && e.troops != null) e.troops.remove(troop);
    // The recursion uses the 6-argument overload (specialForcesEvadeBetter: true).
    inflictTroopLosses(galaxy, habitat, defendingEmpire, inflicter, losses, troops, attackingTroops);
}

/** Habitat.cs 3171 AttemptToDamagePlanetaryDefenseUnits(units, specialForcesTroop, timePassed, galaxy). Rnd: NextDouble, Next. */
function attemptToDamagePlanetaryDefenseUnits(galaxy: Galaxy, habitat: Habitat, planetaryDefenseUnits: TroopList | null, specialForcesTroop: Troop | null, timePassed: number): boolean {
    if (specialForcesTroop !== null && planetaryDefenseUnits !== null && planetaryDefenseUnits.count > 0) {
        const num = 0.8 + galaxy.rnd.nextDouble() * 0.4;
        const num2 = Math.max(0.5, Math.sqrt(specialForcesTroop.overallAttackStrength / 10000.0));
        const num3 = f32(num2 * timePassed * num);
        const index = galaxy.rnd.next(0, planetaryDefenseUnits.count);
        const troop = planetaryDefenseUnits.items[index];
        if (troop != null) {
            if (troop.readiness > num3) {
                troop.readiness = f32(troop.readiness - num3);
                colonyInvasionUi(habitat);
            } else {
                const sfEmpire = troopEmpire(specialForcesTroop);
                if (sfEmpire !== null && sfEmpire.counters !== null) sfEmpire.counters.processTroopDestruction(troop);
                colonyInvasionUi(habitat);
                const e = troopEmpire(troop);
                if (e !== null && e.troops != null) e.troops.remove(troop);
                habitat.troops!.remove(troop);
            }
            return true;
        }
    }
    return false;
}

/**
 * Habitat.cs 3200 AttemptToDestroyFacility(ref facility, specialForcesTroop, timePassed, galaxy). Rnd: NextDouble, and
 * Next(5, 11) when the facility is destroyed. Returns the C# result and the `ref` facility.
 */
function attemptToDestroyFacility(galaxy: Galaxy, habitat: Habitat, facility: PlanetaryFacility | null, specialForcesTroop: Troop | null, timePassed: number): { result: boolean; facility: PlanetaryFacility | null } {
    if (specialForcesTroop !== null && facility !== null) {
        const num = (specialForcesTroop.overallAttackStrength * timePassed) / 10000.0;
        if (num > galaxy.rnd.nextDouble() * 20.0) {
            let flag = true;
            if (habitat.empire === troopEmpire(specialForcesTroop) && (facility.type === PlanetaryFacilityType.PirateBase || facility.type === PlanetaryFacilityType.PirateFortress || facility.type === PlanetaryFacilityType.PirateCriminalNetwork)) {
                flag = false;
            }
            if (!flag) {
                const description = formatText(getText('Special Forces Destroy Facility Description'), facility.name, specialForcesTroop.name, habitat.name);
                sendMessageToEmpire(habitat.empire, habitat.empire, EmpireMessageType.PlanetaryFacilityDestroyed, facility, description);
            }
            const num2 = galaxy.rnd.next(5, 11);
            specialForcesTroop.setAttackStrength(specialForcesTroop.attackStrength + num2);
            removeFirst(habitat.facilities, facility);
            checkRemoveFacilityTracking(habitat, facility);
            reviewPlanetaryFacilities(galaxy, habitat, habitat.empire);
            // facility = null (the UI explosion is then handed a null facility).
            colonyInvasionUi(habitat);
            return { result: true, facility: null };
        }
    }
    return { result: false, facility };
}

/** The `!AttemptToDestroyFacility(ref f1, ...) && !AttemptToDestroyFacility(ref f2, ...) && ...` chain (short-circuit). */
function attemptFacilities(galaxy: Galaxy, habitat: Habitat, facilities: (PlanetaryFacility | null)[], troop: Troop, timePassed: number): boolean {
    for (let k = 0; k < facilities.length; k++) {
        const r = attemptToDestroyFacility(galaxy, habitat, facilities[k], troop, timePassed);
        facilities[k] = r.facility;
        if (r.result) return true;
    }
    return false;
}

/** Habitat.cs 3032 InvadingSpecialForcesAttack(timePassed, galaxy). Rnd: the Attempt* helpers, then 2 × NextDouble + losses. */
function invadingSpecialForcesAttack(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    if (habitat.invadingTroops === null || habitat.invadingTroops.count <= 0) return;
    const byType = habitat.invadingTroops.getByType(TroopType.SpecialForces);
    if (byType === null || byType.count <= 0) return;
    const empires = resolveInvasionEmpires(habitat);
    const invader = empires.invader;
    let defender = empires.defender;
    if (defender === null) defender = habitat.empire;
    let flag = false;
    if (invader === habitat.empire && defender!.pirateEmpireBaseHabitat !== null) flag = true;
    if (flag) {
        const facilities: (PlanetaryFacility | null)[] = [null, null, null];
        if (habitat.facilities !== null) {
            facilities[0] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.PirateBase);
            facilities[1] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.PirateFortress);
            facilities[2] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.PirateCriminalNetwork);
        }
        let planetaryDefenseUnits = new TroopList();
        if (habitat.troops !== null) planetaryDefenseUnits = habitat.troops.getByType(TroopType.Artillery);
        for (let i = 0; i < byType.count; i++) {
            const troop = byType.items[i];
            if (troop != null && !attemptFacilities(galaxy, habitat, facilities, troop, timePassed)) {
                attemptToDamagePlanetaryDefenseUnits(galaxy, habitat, planetaryDefenseUnits, troop, timePassed);
            }
        }
    } else {
        const facilities: (PlanetaryFacility | null)[] = [null, null, null, null, null, null, null, null];
        if (habitat.facilities !== null) {
            facilities[0] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.FortifiedBunker);
            facilities[1] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.PlanetaryShield);
            facilities[2] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.IonCannon);
            facilities[3] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.ArmoredFactory);
            facilities[4] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.CloningFacility);
            facilities[5] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.RoboticTroopFoundry);
            facilities[6] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.TroopTrainingCenter);
            facilities[7] = facilitiesFindByType(habitat.facilities, PlanetaryFacilityType.MilitaryAcademy);
        }
        let planetaryDefenseUnits2 = new TroopList();
        if (habitat.troops !== null) planetaryDefenseUnits2 = habitat.troops.getByType(TroopType.Artillery);
        for (let j = 0; j < byType.count; j++) {
            const troop2 = byType.items[j];
            if (troop2 != null && !attemptFacilities(galaxy, habitat, facilities, troop2, timePassed)) {
                attemptToDamagePlanetaryDefenseUnits(galaxy, habitat, planetaryDefenseUnits2, troop2, timePassed);
            }
        }
    }
    const byType2 = habitat.troops!.getByType(TroopType.SpecialForces);
    if (byType2 === null || byType2.count <= 0) return;
    const num = calculateForceStrength(galaxy, habitat, byType2, colonyCharacters(habitat), false);
    const num2 = calculateForceStrength(galaxy, habitat, byType, invadingCharacters(habitat), true);
    const num3 = Math.min(2.0, Math.max(0.5, num2 / (num + 1.0)));
    const num4 = Math.min(2.0, Math.max(0.5, num / (num2 + 1.0)));
    const num5 = Math.max(1.5, Math.sqrt((num + num2) / 10000.0) / 2.0);
    const num6 = 0.8 + galaxy.rnd.nextDouble() * 0.4;
    let num7 = num6 * num3 * num5 * timePassed;
    const num8 = 0.8 + galaxy.rnd.nextDouble() * 0.4;
    let num9 = num8 * num4 * num5 * timePassed;
    const num10 = num - num7;
    const num11 = num2 - num9;
    if (num10 > num11) {
        const num12 = num10 / num11;
        const val = num * 0.9;
        if (num11 <= 0.0) {
            num7 += num11;
            num7 = Math.min(val, Math.max(0.0, num7));
        } else if (num12 >= 10.0) {
            num7 -= num11;
            num7 = Math.min(val, Math.max(0.0, num7));
        }
    } else if (num10 <= 0.0) {
        num9 += num10;
        num9 = Math.max(0.0, num9);
    }
    inflictTroopLosses(galaxy, habitat, defender, defender, num7, byType, byType2, false);
    inflictTroopLosses(galaxy, habitat, defender, invader, num9, byType2, byType, false);
}

/** Habitat.cs 2982 CheckForReinforcements(invasionForceStrength, defendingForceStrength). Rnd: mission assignment draws. */
function checkForReinforcements(galaxy: Galaxy, habitat: Habitat, invasionForceStrength: number, defendingForceStrength: number): void {
    const empire = habitat.empire;
    if (empire === null || empire === galaxy.independentEmpire || defendingForceStrength >= csDoubleToInt(invasionForceStrength * 1.5)) return;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        const mission = builtObjectMission(builtObject.mission);
        if (builtObject.troopCapacity > 0 && builtObject.troops !== null && builtObject.troops.count > 0 && builtObject.topSpeed > 0 && mission !== null && mission.type === BuiltObjectMissionType.UnloadTroops && mission.targetHabitat === habitat) {
            defendingForceStrength += builtObject.troops.totalDefendStrength;
        }
    }
    if (defendingForceStrength >= csDoubleToInt(invasionForceStrength * 1.5)) return;
    const num = SECTOR_SIZE * SECTOR_SIZE;
    for (let j = 0; j < empire.builtObjects.length; j++) {
        const builtObject2 = empire.builtObjects[j];
        const m2 = builtObjectMission(builtObject2.mission);
        if (
            builtObject2.troopCapacity <= 0 ||
            builtObject2.troops === null ||
            builtObject2.troops.count <= 0 ||
            builtObject2.troops.totalDefendStrength <= 0 ||
            builtObject2.topSpeed <= 0 ||
            builtObject2.warpSpeed <= 0 ||
            !isAiControlled(builtObject2) ||
            (m2 !== null &&
                m2.type !== BuiltObjectMissionType.Undefined &&
                m2.priority !== BuiltObjectMissionPriority.Low &&
                m2.priority !== BuiltObjectMissionPriority.Normal &&
                (m2.type !== BuiltObjectMissionType.Move || m2.targetHabitat !== habitat) &&
                (m2.type !== BuiltObjectMissionType.Attack || m2.targetHabitat !== null))
        ) {
            continue;
        }
        let num2 = galaxy.calculateDistanceSquared(builtObject2.xpos, builtObject2.ypos, habitat.xpos, habitat.ypos);
        if (!(num2 < num)) continue;
        const shipGroup = builtObject2.shipGroup as ShipGroup | null;
        if (shipGroup !== null && shipGroup.leadShip !== null) {
            const gm = builtObjectMission(shipGroup.mission);
            if (isAiControlled(shipGroup.leadShip) && (gm === null || gm.type === BuiltObjectMissionType.Undefined || gm.priority === BuiltObjectMissionPriority.Low)) {
                num2 = galaxy.calculateDistanceSquared(shipGroup.leadShip.xpos, shipGroup.leadShip.ypos, habitat.xpos, habitat.ypos);
                if (num2 < num && builtObject2.empire !== null) {
                    assignFleetUnloadTroops(galaxy, builtObject2.empire, shipGroup, habitat, false);
                }
            }
        } else {
            clearPreviousMissionRequirements(galaxy, builtObject2);
            assignMission(galaxy, builtObject2, BuiltObjectMissionType.UnloadTroops, habitat, null, BuiltObjectMissionPriority.High, { troops: builtObject2.troops });
        }
    }
}

/** Empire.9.cs 525 AssignFleetUnloadTroops(fleet, colony, manuallyAssigned). Rnd: mission assignment draws. */
export function assignFleetUnloadTroops(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, colony: Habitat, manuallyAssigned: boolean): boolean {
    void empire;
    let result = false;
    shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.UnloadTroops, colony, null, BuiltObjectMissionPriority.Normal, manuallyAssigned);
    for (let i = 0; i < fleet.ships.length; i++) {
        const builtObject = fleet.ships[i];
        if (shipGroupIsShipAvailable(builtObject)) {
            clearPreviousMissionRequirements(galaxy, builtObject);
            if (builtObject.troops !== null && builtObject.troops.count > 0) {
                const troopList = new TroopList();
                for (const t of builtObject.troops.items) troopList.add(t);
                assignMission(galaxy, builtObject, BuiltObjectMissionType.UnloadTroops, colony, null, BuiltObjectMissionPriority.Normal, { troops: troopList, manuallyAssigned });
                result = true;
            } else {
                assignMission(galaxy, builtObject, BuiltObjectMissionType.Move, colony, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned });
            }
        }
    }
    return result;
}

/** Empire.8.cs 5197 FindNearestTroopShipWithSpace(x, y, capacityRequired). No Rnd. */
export function findNearestTroopShipWithSpace(galaxy: Galaxy, empire: Empire, x: number, y: number, capacityRequired: number): BuiltObject | null {
    let builtObject: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject2 = empire.builtObjects[i];
        if (builtObject2 != null && !builtObject2.hasBeenDestroyed && builtObject2.role === BuiltObjectRole.Military && builtObject2.troopCapacity >= capacityRequired && builtObject2.troopCapacityRemaining >= capacityRequired) {
            const num2 = galaxy.calculateDistanceSquared(x, y, builtObject2.xpos, builtObject2.ypos);
            if (builtObject === null || num > num2) {
                builtObject = builtObject2;
                num = num2;
            }
        }
    }
    return builtObject;
}

// ---------------------------------------------------------------------------------------------------------------
// Pirate missions, raid bonuses, troop generals
// ---------------------------------------------------------------------------------------------------------------

/**
 * The failed pirate Defend-mission block shared by ResolveInvasionBattles (Habitat.cs 3780-3795) and
 * ProcessBoardingAssault (BuiltObject.1.cs 3000-3016): the protected target fell although a pirate faction had won the
 * defend mission for it. No Rnd.
 */
export function failPirateDefendMission(galaxy: Galaxy, empire2: Empire | null, target: BuiltObject | Habitat): void {
    void galaxy;
    if (empire2 === null || empire2.pirateMissions === null) return;
    const mission = empire2.pirateMissions.getFirstByTargetAndTypeAssigned(target, EmpireActivityType.Defend, empire2);
    if (mission === null || mission.assignedEmpire === null || mission.bidTimeRemaining !== 0) return;
    const pirateRelation = obtainPirateRelation(empire2, mission.assignedEmpire);
    pirateRelation.evaluationPirateMissionsFail = f32(pirateRelation.evaluationPirateMissionsFail - 20);
    const targetName = mission.target !== null ? (mission.target as { name: string }).name : '';
    let description = formatText(getText('Pirate Defend Mission Failed Pirate'), mission.requestingEmpire!.name, targetName, mission.price.toFixed(0));
    sendMessageToEmpire(mission.assignedEmpire, mission.assignedEmpire, EmpireMessageType.PirateDefendMissionFailed, mission.target, description);
    description = formatText(getText('Pirate Defend Mission Failed Other'), mission.assignedEmpire.name, targetName, mission.price.toFixed(0));
    sendMessageToEmpire(mission.requestingEmpire, mission.requestingEmpire, EmpireMessageType.PirateDefendMissionFailed, mission.target, description);
    mission.requestingEmpire!.pirateMissions.removeEquivalent(mission);
    mission.assignedEmpire.pirateMissions.removeEquivalent(mission);
    empire2.pirateMissions.removeEquivalent(mission);
}

/** StellarObject.RaidCountdown (byte): BuiltObject / Habitat. */
function raidCountdownOf(target: BuiltObject | Habitat): number {
    return target.raidCountdown;
}

/** DoRaidBonuses case 1 fallback: a queue head from a random industry (Galaxy.5.cs 5040-5062 / 5105-5127). Rnd: Next(0, 3). */
function randomQueueHead(galaxy: Galaxy, attackingEmpire: Empire): TechNode | null {
    let researchNode: TechNode | null = null;
    switch (galaxy.rnd.next(0, 3)) {
        case 0:
            if (attackingEmpire.research.researchQueueEnergy.length > 0) researchNode = attackingEmpire.research.researchQueueEnergy[0];
            break;
        case 1:
            if (attackingEmpire.research.researchQueueHighTech.length > 0) researchNode = attackingEmpire.research.researchQueueHighTech[0];
            break;
        case 2:
            if (attackingEmpire.research.researchQueueWeapons.length > 0) researchNode = attackingEmpire.research.researchQueueWeapons[0];
            break;
    }
    return researchNode;
}

/**
 * Galaxy.5.cs 4953 DoRaidBonuses(attackingEmpire, target, lootFactor). Rnd (by loot type): BuiltObject targets draw
 * Next(0, 3) (space ports) / Next(0, 2) (mining stations); Habitat targets Next(0, 3); then case 0 NextDouble, case 1
 * Next(0, count) or Next(0, 3) + NextDouble, case 2 per cargo Next(0, 2) (after the first) + Next(5, n), or NextDouble.
 */
export function doRaidBonuses(galaxy: Galaxy, attackingEmpire: Empire | null, target: BuiltObject | Habitat | null, lootFactor: number): void {
    if (target === null || target.empire === null || attackingEmpire === null) return;
    let num = 1.0;
    const raidCountdown = raidCountdownOf(target);
    if (raidCountdown > 0) {
        num = (raidCountdown / 60.0) * 0.75;
        if (raidCountdown > 55) num = 0.0;
    }
    if (num === 0.0) {
        const description = formatText(getText('We have raided TARGET of the EMPIRE but failed to obtain any loot'), target.name, target.empire.name);
        sendMessageToEmpire(attackingEmpire, attackingEmpire, EmpireMessageType.RaidBonuses, target, description);
        const empty = !isHabitat(target)
            ? formatText(getText('The EMPIRE have raided our base TARGET but failed to obtain any loot'), target.name, attackingEmpire.name)
            : formatText(getText('The EMPIRE have raided our colony TARGET but failed to obtain any loot'), target.name, attackingEmpire.name);
        sendMessageToEmpire(target.empire, target.empire, EmpireMessageType.RaidVictim, target, empty);
        return;
    }
    let cargoList: { items: Cargo[] } | null = null;
    let empire: Empire | null = null;
    let num2 = 0;
    let num3 = 0;
    let industryType = IndustryType.Undefined;
    if (isBuiltObject(target)) {
        const builtObject = target;
        cargoList = builtObject.cargo;
        empire = builtObject.empire;
        num3 = builtObject.size;
        switch (builtObject.subRole) {
            case BuiltObjectSubRole.EnergyResearchStation:
            case BuiltObjectSubRole.WeaponsResearchStation:
            case BuiltObjectSubRole.HighTechResearchStation:
                num2 = 1;
                industryType =
                    builtObject.subRole === BuiltObjectSubRole.EnergyResearchStation
                        ? IndustryType.Energy
                        : builtObject.subRole === BuiltObjectSubRole.HighTechResearchStation
                          ? IndustryType.HighTech
                          : builtObject.subRole === BuiltObjectSubRole.WeaponsResearchStation
                            ? IndustryType.Weapon
                            : IndustryType.Undefined;
                break;
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort:
                num2 = galaxy.rnd.next(0, 3) !== 1 ? (builtObject.researchEnergy > 0 || builtObject.researchHighTech > 0 || builtObject.researchWeapons > 0 ? 1 : 2) : 0;
                break;
            case BuiltObjectSubRole.GasMiningStation:
            case BuiltObjectSubRole.MiningStation:
                num2 = galaxy.rnd.next(0, 2) !== 1 ? 2 : 0;
                break;
            default:
                num2 = 0;
                break;
        }
    } else if (isHabitat(target)) {
        const habitat = target;
        cargoList = habitat.cargo;
        empire = habitat.empire;
        if (habitat.population != null && habitat.population.items.length > 0) num3 = Math.trunc(habitat.population.totalAmount / 10000);
        num2 = galaxy.rnd.next(0, 3);
    }
    let text = '';
    let num4 = 0.0;
    switch (num2) {
        case 0:
            num4 = Math.sqrt(num3) * (30.0 + galaxy.rnd.nextDouble() * 20.0);
            num4 *= empireColonyIncomeFactor(attackingEmpire);
            num4 *= num;
            num4 *= lootFactor;
            num4 = Math.max(100.0, Math.min(empire!.stateMoney * 0.5, num4));
            attackingEmpire.stateMoney += num4;
            empire!.stateMoney -= num4;
            if (attackingEmpire.pirateEmpireBaseHabitat !== null) pirateEconomyPerformIncome(galaxy, attackingEmpire, num4, PirateIncomeType.Undefined, galaxyStarDate(galaxy));
            text = formatText(getText('X credits'), num4.toFixed(0));
            break;
        case 1: {
            const researchNodeList = resolveMoreAdvancedProjectsIncludeSpecial(attackingEmpire, empire!, true) // ResearchSystem.cs 238 overload (includeSpecialTech: true);
            if (researchNodeList.length > 0) {
                let researchNodeList2 = researchNodeList;
                switch (industryType) {
                    case IndustryType.Energy:
                        researchNodeList2 = getProjectsByIndustry(researchNodeList, IndustryType.Energy);
                        break;
                    case IndustryType.HighTech:
                        researchNodeList2 = getProjectsByIndustry(researchNodeList, IndustryType.HighTech);
                        break;
                    case IndustryType.Weapon:
                        researchNodeList2 = getProjectsByIndustry(researchNodeList, IndustryType.Weapon);
                        break;
                    default:
                        researchNodeList2 = researchNodeList;
                        break;
                }
                if (researchNodeList2.length > 0 && num > 0.7) {
                    const researchNode = researchNodeList2[galaxy.rnd.next(0, researchNodeList2.length)];
                    if (researchNode != null) {
                        const researchNode2 = findNodeById(attackingEmpire.research.techTree, researchNode.def.projectId);
                        if (researchNode2 !== null && !researchNode2.isResearched) {
                            doResearchBreakthrough(galaxy, attackingEmpire, researchNode2, false);
                            text = formatText(getText('Research breakthrough in PROJECT'), researchNode2.def.name);
                        }
                    }
                    break;
                }
                const researchNode3 = randomQueueHead(galaxy, attackingEmpire);
                if (researchNode3 !== null) {
                    const num7 = galaxy.baseTechCost / 120000.0; // Galaxy.5.cs 5096
                    let num8 = (40000.0 + 30000.0 * galaxy.rnd.nextDouble()) * num7;
                    num8 *= num;
                    num8 *= lootFactor;
                    researchNode3.progress = f32(researchNode3.progress + f32(num8));
                    researchNode3.progress = Math.min(f32(researchNode3.cost - 1000), researchNode3.progress);
                    text = formatText(getText('Improved our understanding of PROJECT'), researchNode3.def.name);
                }
                break;
            }
            const researchNode4 = randomQueueHead(galaxy, attackingEmpire);
            if (researchNode4 !== null) {
                const num9 = galaxy.baseTechCost / 120000.0; // Galaxy.5.cs 5130
                let num10 = (40000.0 + 30000.0 * galaxy.rnd.nextDouble()) * num9;
                num10 *= num;
                num10 *= lootFactor;
                researchNode4.progress = f32(researchNode4.progress + f32(num10));
                researchNode4.progress = Math.min(f32(researchNode4.cost - 1000), researchNode4.progress);
                text = formatText(getText('Improved our understanding of PROJECT'), researchNode4.def.name);
            }
            break;
        }
        case 2: {
            if (cargoList === null || cargoList.items.length <= 0) break;
            const cargoList2: Cargo[] = [];
            for (let i = 0; i < cargoList.items.length; i++) {
                const cargo = cargoList.items[i];
                const num5 = csDoubleToInt(cargo.available * num * lootFactor);
                if (cargo != null && cargoEmpireId(cargo) === empire!.empireId && cargo.commodityIsResource && num5 > 10 && (cargoList2.length <= 0 || galaxy.rnd.next(0, 2) === 1)) {
                    const num6 = galaxy.rnd.next(5, num5);
                    if (num6 > 0) {
                        cargoList2.push(new Cargo(cargo.commodity, num6, attackingEmpire));
                        cargo.amount -= num6;
                    }
                }
            }
            if (cargoList2.length > 0) {
                // 19d2 resource crises (scenario flag): remember what the raid took (the yearly review opens the crisis). No Rnd.
                if (galaxy.scenario !== null) recordRaidLoss(galaxy, isHabitat(target) ? target : target.parentHabitat, cargoList2.map((c) => c.commodity.resourceId));
                if (attackingEmpire.pirateEmpireBaseHabitat !== null) {
                    const builtObject2 = identifyPirateBase(attackingEmpire);
                    if (builtObject2 !== null && builtObject2.cargo !== null) {
                        for (let j = 0; j < cargoList2.length; j++) builtObject2.cargo.add(cargoList2[j]);
                    }
                } else if (attackingEmpire.spacePorts !== null && attackingEmpire.spacePorts.length > 0) {
                    const builtObject3 = attackingEmpire.spacePorts[0];
                    if (builtObject3 != null && builtObject3.cargo !== null) {
                        for (let k = 0; k < cargoList2.length; k++) builtObject3.cargo.add(cargoList2[k]);
                    }
                }
                for (let l = 0; l < cargoList2.length; l++) {
                    if (l > 0) text += ', ';
                    text = text + cargoList2[l].amount.toFixed(0) + ' ' + (galaxy.resources.find((r) => r.resourceId === cargoList2[l].commodity.resourceId)?.name ?? '');
                }
            } else {
                num4 = Math.sqrt(num3) * (30.0 + galaxy.rnd.nextDouble() * 20.0);
                num4 *= empireColonyIncomeFactor(attackingEmpire);
                num4 *= num;
                num4 *= lootFactor;
                num4 = Math.max(100.0, Math.min(empire!.stateMoney * 0.5, num4));
                attackingEmpire.stateMoney += num4;
                empire!.stateMoney -= num4;
                if (attackingEmpire.pirateEmpireBaseHabitat !== null) pirateEconomyPerformIncome(galaxy, attackingEmpire, num4, PirateIncomeType.Undefined, galaxyStarDate(galaxy));
                text = formatText(getText('X credits'), num4.toFixed(0));
            }
            break;
        }
    }
    if (text === '') {
        const description2 = formatText(getText('We have raided TARGET of the EMPIRE but failed to obtain any loot'), target.name, empire!.name);
        sendMessageToEmpire(attackingEmpire, attackingEmpire, EmpireMessageType.RaidBonuses, target, description2);
        const empty2 = !isHabitat(target)
            ? formatText(getText('The EMPIRE have raided our base TARGET but failed to obtain any loot'), target.name, attackingEmpire.name)
            : formatText(getText('The EMPIRE have raided our colony TARGET but failed to obtain any loot'), target.name, attackingEmpire.name);
        sendMessageToEmpire(empire, empire, EmpireMessageType.RaidVictim, target, empty2);
        return;
    }
    if (attackingEmpire.counters !== null) attackingEmpire.counters.raidSuccessCount++;
    const empty3 = isBuiltObject(target)
        ? !(lootFactor < 1.0)
            ? formatText(getText('We have raided base TARGET of the EMPIRE and pillaged the following'), target.name, empire!.name, text)
            : formatText(getText('We have raided base TARGET of the EMPIRE and pillaged the following FAIL'), target.name, empire!.name, text)
        : !(lootFactor < 1.0)
          ? formatText(getText('We have raided colony TARGET of the EMPIRE and pillaged the following'), target.name, empire!.name, text)
          : formatText(getText('We have raided colony TARGET of the EMPIRE and pillaged the following FAIL'), target.name, empire!.name, text);
    sendMessageToEmpire(attackingEmpire, attackingEmpire, EmpireMessageType.RaidBonuses, target, empty3);
    if (isBuiltObject(target)) {
        const description3 = formatText(getText('The EMPIRE have raided our base TARGET and stolen the following'), target.name, attackingEmpire.name, text);
        sendMessageToEmpire(empire, empire, EmpireMessageType.RaidVictim, target, description3);
    } else {
        const description4 = formatText(getText('The EMPIRE have raided our colony TARGET and stolen the following'), target.name, attackingEmpire.name, text);
        sendMessageToEmpire(empire, empire, EmpireMessageType.RaidVictim, target, description4);
    }
}

/**
 * Galaxy.2.cs 5192 ChanceNewTroopGeneralFromInvasion(empire, invadedColony, invading). Rnd: Next(0, num) for a colony
 * above 100M population (+ GenerateNewCharacter draws on a 1).
 */
export function chanceNewTroopGeneralFromInvasion(galaxy: Galaxy, empire: Empire | null, invadedColony: Habitat | null, invading: boolean): boolean {
    if (empire !== null && invadedColony !== null && !invadedColony.hasBeenDestroyed && invadedColony.population != null && invadedColony.population.totalAmount > 100000000) {
        let num = 8;
        if (empire.dominantRace !== null) num = Math.max(2, csDoubleToInt(num / raceCharacterRandomAppearanceChanceGeneral(empire.dominantRace)));
        if (invading) num = csDoubleToInt(num * 1.5);
        if (galaxy.rnd.next(0, num) === 1 && charactersCanGenerateAmountNonIntelligenceAgent(empire) > 0) {
            const character = generateNewCharacter(galaxy, empire, CharacterRole.TroopGeneral, invadedColony).character;
            const habitat = galaxy.determineHabitatSystemStar(invadedColony);
            const title = formatText(getText('New Character Event Title'), resolveDescription(CharacterRole, character.role));
            const empty = !invading
                ? formatText(getText('New Character Event Defense Troop General'), invadedColony.name, habitat.name, character.name)
                : formatText(getText('New Character Event Invasion Troop General'), resolveDescription(HabitatType, invadedColony.type).toLowerCase(), invadedColony.name, habitat.name, character.name);
            sendMessageToEmpireWithTitle(empire, empire, EmpireMessageType.CharacterAppearance, character, empty, title);
            return true;
        }
    }
    return false;
}

/** EmpireCounters.cs 288 ProcessColonyConquest(colony, previousOwner) (`self` = the conquering empire's counters). No Rnd. */
export function processColonyConquest(self: Empire, colony: Habitat | null, previousOwner: Empire | null): void {
    if (colony === null) return;
    ++self.counters.coloniesConqueredCount;
    if (previousOwner === null) return;
    const c = previousOwner.counters;
    ++c.lossesColoniesTotalCount;
    if (colony.population != null) c.lossesColoniesPopulationAmount += colony.population.totalAmount;
    switch (colony.type) {
        case HabitatType.Volcanic:
            ++c.lossesColoniesVolcanicCount;
            break;
        case HabitatType.Desert:
            ++c.lossesColoniesDesertCount;
            break;
        case HabitatType.MarshySwamp:
            ++c.lossesColoniesMarshySwampCount;
            break;
        case HabitatType.Continental:
            ++c.lossesColoniesContinentalCount;
            break;
        case HabitatType.Ocean:
            ++c.lossesColoniesOceanCount;
            break;
        case HabitatType.Ice:
            ++c.lossesColoniesIceCount;
            break;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat.cs 3365 ResolveInvasionBattles
// ---------------------------------------------------------------------------------------------------------------

/** "Our troops gain experience" (Habitat.cs 3589-3611): the defenders' attack/defend strength bonus after a repelled invasion. */
function defendersGainExperience(galaxy: Galaxy, habitat: Habitat, raid: boolean): void {
    void galaxy;
    if (habitat.troops === null) return;
    let num17 = f32(15);
    if (raid) num17 = f32(5);
    const leader = habitat.empire !== null ? empireLeader(habitat.empire) : null;
    if (habitat.empire !== null && leader !== null) {
        const num18 = f32(1.0 + leader.troopExperienceGain / 100.0);
        num17 = f32(num17 * num18);
    }
    const chars = colonyCharacters(habitat);
    if (chars !== null && chars.length > 0) {
        const highestSkillLevelExcludeLeaders = getHighestSkillLevelExcludeLeaders(chars, CharacterSkillType.TroopExperienceGain);
        const num19 = f32(1.0 + highestSkillLevelExcludeLeaders / 100.0);
        num17 = f32(num17 * num19);
    }
    for (const troop5 of habitat.troops.items) {
        if (troop5 != null) {
            troop5.setAttackStrength(troop5.attackStrength + Math.trunc(f32(num17 / 2)));
            troop5.setDefendStrength(troop5.defendStrength + Math.trunc(num17));
        }
    }
}

/**
 * Habitat.cs 3365 ResolveInvasionBattles(timePassed, galaxy). Rnd, in order: InvadingSpecialForcesAttack; 2 × NextDouble
 * (loss factors); InflictTroopLosses ×2 (Next per troop hit); NextDouble (civilian losses, when populated); then on a
 * repelled invasion Next(6, 15) (+ ChanceNewTroopGeneralFromInvasion Next) / on a raid NextDouble (+ NextDouble,
 * Next(0, 3), NextDouble when facilities / raid bonuses), on a successful raid NextDouble (pirate control) and the raid
 * bonus draws, on a conquest Next(11, 24), Next(0, 8) (+ character generation), and the ownership transfer's draws.
 * The two `new Random((int)DateTime.Now.Ticks)` of the C# are never drawn from.
 */
export function resolveInvasionBattles(galaxy: Galaxy, habitat: Habitat, timeSpanSeconds: number): void {
    const self = habitat;
    const timePassedSeconds = timeSpanSeconds;
    const chars0 = invadingCharacters(self);
    if ((self.invadingTroops === null || self.invadingTroops.count <= 0) && (chars0 === null || chars0.length <= 0)) return;
    const resolved = resolveInvasionEmpires(self);
    const invader = resolved.invader;
    let defender = resolved.defender;
    if (defender === null) defender = self.empire;
    if (self.invasionStats === null) self.invasionStats = new InvasionStats(self, invader, self.empire);
    const invadingTroops = self.invadingTroops!;
    let flag = false;
    if (invadingTroops.count > 0 && invadingTroops.items[0].type === TroopType.PirateRaider) {
        flag = true;
        for (let i = 0; i < invadingTroops.count; i++) {
            const troop = invadingTroops.items[i];
            if (troop != null && troop.type !== TroopType.PirateRaider) {
                flag = false;
                break;
            }
        }
    }
    invadingSpecialForcesAttack(galaxy, self, timePassedSeconds);
    let { attackingStrength, defendingStrength } = calculateForceStrengths(galaxy, self, defender, invader, self.troops!, colonyCharacters(self), invadingTroops, invadingCharacters(self));
    let num = 0;
    let isDefending = false;
    if (self.population != null) {
        const ps = calculatePopulationStrength(galaxy, self, invader, defender);
        num = ps.result;
        isDefending = ps.isDefending;
    }
    let flag2 = false;
    let flag3 = false;
    if (self.rebelling && self.invadingTroops !== null) {
        for (let j = 0; j < self.invadingTroops.count; j++) {
            if (self.invadingTroops !== null && (troopEmpire(self.invadingTroops.items[j]) === galaxy.independentEmpire || troopEmpire(self.invadingTroops.items[j]) === null)) {
                flag2 = true;
                break;
            }
        }
    }
    if (invader === self.empire && defender!.pirateEmpireBaseHabitat !== null) flag3 = true;
    if (flag2 || flag3 || !isDefending) {
        if (!flag) attackingStrength += num;
    } else if (!flag && self.troops!.count > 0 && self.troops!.totalDefendStrength > 0) {
        defendingStrength += num;
    }
    if (!flag3) checkForReinforcements(galaxy, self, attackingStrength, defendingStrength);
    // `new Random((int)DateTime.Now.Ticks);` — constructed and discarded (no draw).
    const num2 = Math.min(2.0, Math.max(0.5, defendingStrength / (attackingStrength + 1.0)));
    const num3 = Math.min(2.0, Math.max(0.5, attackingStrength / (defendingStrength + 1.0)));
    const num4 = Math.max(0.5, Math.sqrt((attackingStrength + defendingStrength) / 10000.0) / 2.0);
    const num5 = 0.8 + galaxy.rnd.nextDouble() * 0.4;
    let num6 = num5 * num2 * num4 * timePassedSeconds;
    const num7 = 0.8 + galaxy.rnd.nextDouble() * 0.4;
    let num8 = num7 * num3 * num4 * timePassedSeconds;
    const num9 = attackingStrength - num6;
    const num10 = defendingStrength - num8;
    if (num9 > num10) {
        const num11 = num9 / num10;
        const val = attackingStrength * 0.9;
        if (num10 <= 0.0) {
            num6 += num10;
            num6 = Math.min(val, Math.max(0.0, num6));
        } else if (num11 >= 10.0) {
            num6 -= num10;
            num6 = Math.min(val, Math.max(0.0, num6));
        }
    } else if (num9 <= 0.0) {
        num8 += num9;
        num8 = Math.max(0.0, num8);
    }
    inflictTroopLosses(galaxy, self, defender, defender, num6, self.invadingTroops, self.troops);
    inflictTroopLosses(galaxy, self, defender, invader, num8, self.troops, self.invadingTroops);
    if (self.population != null) {
        const num12 = Math.max(20000.0, Math.min(1000000.0, self.population.totalAmount / 4000.0));
        let val2 = Math.min(10000000.0, self.population.totalAmount / 2000.0);
        val2 = Math.max(val2, num12);
        let num13 = timePassedSeconds * (num12 + (val2 - num12) * galaxy.rnd.nextDouble());
        if (flag) num13 /= 12.0;
        if (self.population.totalAmount - csLong(num13) > 0) {
            const num14 = num13 / self.population.items.length;
            for (const item of self.population.items) {
                if (item == null) continue;
                const num15 = Math.min(Math.trunc(item.amount / 2), csLong(num14));
                item.amount -= num15;
                colonyInvasionUi(self);
                if (item.amount < 0) item.amount = 0;
            }
            self.population.recalculateTotalAmount();
        }
    }
    if (self.invadingTroops === null || self.invadingTroops.totalAttackStrength <= 0) {
        invasionRepelled(galaxy, self, defender!, invader, flag, flag2);
        return;
    }
    const num21 = attackingStrength / defendingStrength;
    let flag5 = false;
    const num22 = self.troops!.countByType(TroopType.PirateRaider);
    if (num22 > 0 && num22 === self.troops!.count) flag5 = true;
    if (!flag5 && invader === self.empire) flag5 = true;
    if (flag) {
        if (raidInProgress(galaxy, self, defender!, invader!, attackingStrength, num21, timePassedSeconds)) return;
    }
    let num30 = 20.0;
    if (flag) num30 = 10.0;
    if (!(num21 >= num30)) return;
    invasionSucceeded(galaxy, self, defender, invader, flag, flag2, flag5);
}

/** C# (long)double (truncation; the population amounts stay far inside the long range). */
function csLong(v: number): number {
    return Math.trunc(v);
}

/** ResolveInvasionBattles 3474-3620: the invaders are gone (InvadingTroops.TotalAttackStrength <= 0). */
function invasionRepelled(galaxy: Galaxy, self: Habitat, defender: Empire, invader: Empire | null, flag: boolean, flag2: boolean): void {
    let flag4 = false;
    const troops = self.troops!;
    if (troops.count > 0 && troops.items[0].type === TroopType.PirateRaider) {
        flag4 = true;
        for (let k = 0; k < troops.count; k++) {
            const troop2 = troops.items[k];
            if (troop2 != null && troop2.type !== TroopType.PirateRaider) {
                flag4 = false;
                break;
            }
        }
    }
    galaxy.invasionFailures++;
    const invChars = invadingCharacters(self);
    if (invChars !== null && invChars.length > 0) {
        const array = invChars.slice();
        for (let l = 0; l < array.length; l++) {
            if (array[l] != null) {
                if (self.empire !== null && self.empire.counters !== null) self.empire.counters.processCharacterDeath(array[l]);
                colonyInvasionUi(self);
                characterSendDeathMessage(galaxy, array[l], CharacterDeathType.ColonyInvasion);
                array[l].kill(galaxy);
            }
        }
    }
    const stats = invasionStatsOf(self);
    if (flag4) {
        const arg = resolveDescription(HabitatCategoryDesc, self.category) + ' ' + self.name;
        sendMessageToEmpire(defender, defender, EmpireMessageType.ColonyDefended, self, formatText(getText('Our pirate forces have defended our hidden base on X'), arg));
        self.rebelling = false;
        if (invader !== null) {
            const description = formatText(getText('Our attempted eradication of the EMPIRE pirate faction on COLONY has failed'), self.name, defender.name);
            sendMessageToEmpire(invader, invader, EmpireMessageType.ColonyDefended, self, description);
        }
        if (stats !== null) {
            stats.invasionSucceeded = false;
            doCharacterEventForList(galaxy, CharacterEventType.GroundInvasion, stats, colonyCharacters(self), false, null);
        }
        self.invasionStats = null;
        removeTroopsByType(self.invadingTroops!, TroopType.PirateRaider, true);
        removeTroopsByType(troops, TroopType.PirateRaider, true);
        const num16 = galaxy.rnd.next(6, 15);
        let val3 = getDevelopmentLevel(self) - num16;
        val3 = Math.max(0, val3);
        setDevelopmentLevel(self, val3);
        return;
    }
    const arg2 = resolveDescription(HabitatCategoryDesc, self.category) + ' ' + self.name;
    if (self.empire !== null) {
        if (flag2) {
            sendMessageToEmpire(self.empire, self.empire, EmpireMessageType.ColonyDefended, self, formatText(getText('We have put down a rebellion on X'), arg2));
            self.rebelling = false;
        } else if (flag) {
            sendMessageToEmpire(self.empire, self.empire, EmpireMessageType.ColonyDefended, self, formatText(getText('We have fended off a raid on X'), arg2));
        } else {
            sendMessageToEmpire(self.empire, self.empire, EmpireMessageType.ColonyDefended, self, formatText(getText('We have fended off an invasion on X'), arg2));
        }
    }
    if (invader !== null) {
        // Empire.Name dereferences the colony's empire (as the C# does).
        const empty = !flag
            ? formatText(getText('Our attempted invasion of COLONY of EMPIRE has failed'), self.name, self.empire!.name)
            : formatText(getText('Our attempted raid on COLONY of EMPIRE has failed'), self.name, self.empire!.name);
        sendMessageToEmpire(invader, invader, EmpireMessageType.ColonyDefended, self, empty);
    }
    if (stats !== null) {
        stats.invasionSucceeded = false;
        doCharacterEventForList(galaxy, CharacterEventType.GroundInvasion, stats, colonyCharacters(self), false, null);
    }
    self.invasionStats = null;
    defendersGainExperience(galaxy, self, flag);
    removeTroopsByType(self.invadingTroops!, TroopType.PirateRaider, true);
    removeTroopsByType(troops, TroopType.PirateRaider, true);
    const num20 = galaxy.rnd.next(6, 15);
    let val4 = getDevelopmentLevel(self) - num20;
    val4 = Math.max(0, val4);
    setDevelopmentLevel(self, val4);
    doCharacterEventForList(galaxy, CharacterEventType.ColonyDevelopmentDecrease, self, colonyCharacters(self), true, self.empire);
    chanceNewTroopGeneralFromInvasion(galaxy, self.empire, self, false);
}

/**
 * ResolveInvasionBattles 3630-3771 (raid, `flag`): facility damage and the raiders' withdrawal. Returns true when the
 * C# returns (the raiders withdrew).
 */
function raidInProgress(galaxy: Galaxy, self: Habitat, defender: Empire, invader: Empire, attackingStrength: number, num21: number, timePassedSeconds: number): boolean {
    const num23 = galaxy.rnd.nextDouble() / timePassedSeconds;
    if (num23 < 0.005 && self.facilities !== null) {
        const planetaryFacility = facilitiesFindBestPirateFacility(self.facilities, false);
        const control = pirateColonyControl(self);
        if (planetaryFacility !== null && control !== null) {
            const byFacilityControl = control.getByFacilityControl();
            if (byFacilityControl !== null) {
                const empireById = getEmpireById(galaxy, byFacilityControl.empireId);
                if (empireById !== null && empireById !== invader) {
                    let num24 = f32(0.2 * f32(attackingStrength / 10000));
                    num24 = f32(num24 * f32(0.7 + galaxy.rnd.nextDouble() * 0.6));
                    switch (planetaryFacility.type) {
                        case PlanetaryFacilityType.PirateBase:
                            num24 = f32(num24 * 1);
                            break;
                        case PlanetaryFacilityType.PirateFortress:
                            num24 = f32(num24 * f32(0.7));
                            break;
                        case PlanetaryFacilityType.PirateCriminalNetwork:
                            num24 = f32(num24 * f32(0.4));
                            break;
                    }
                    if (planetaryFacility.constructionProgress < 1) num24 = f32(num24 * f32(1.5));
                    num24 = f32(num24 * f32(empireById.pirateFactionModifiers?.planetaryFacilityEliminationFactor ?? 1.0));
                    const num25 = f32(planetaryFacility.constructionProgress - num24);
                    if (num25 <= 0) {
                        removeFirst(self.facilities, planetaryFacility);
                        checkRemoveFacilityTracking(self, planetaryFacility);
                        const planetaryFacility2 = facilitiesFindBestPirateFacility(self.facilities, true);
                        if (planetaryFacility2 === null) {
                            byFacilityControl.hasFacilityControl = false;
                            byFacilityControl.controlLevel = Math.min(f32(0.49), Math.max(f32(0.01), f32(byFacilityControl.controlLevel - f32(0.2))));
                        }
                        const description2 = formatText(getText('Invasion Destroys Facility Description'), planetaryFacility.name, self.name);
                        sendMessageToEmpire(empireById, empireById, EmpireMessageType.PlanetaryFacilityDestroyed, planetaryFacility, description2);
                    } else {
                        planetaryFacility.constructionProgress = num25;
                        const description3 = formatText(getText('Invasion Damages Facility Description'), planetaryFacility.name, self.name);
                        sendMessageToEmpire(empireById, empireById, EmpireMessageType.PlanetaryFacilityDamaged, planetaryFacility, description3);
                    }
                }
            }
        }
    }
    const invadingTroops = self.invadingTroops!;
    let num27 = 0.3;
    switch (invadingTroops.count) {
        case 1:
            num27 = 0.05;
            break;
        case 2:
            num27 = 0.1;
            break;
        case 3:
            num27 = 0.15;
            break;
        case 4:
            num27 = 0.2;
            break;
        default:
            num27 = 0.3;
            break;
    }
    if (!(invadingTroops.count > 1 && num21 < num27)) return false;
    const array2 = invadingTroops.items.slice();
    for (const troop3 of array2) {
        if (troop3 != null && troop3.type === TroopType.PirateRaider) {
            invadingTroops.remove(troop3);
            const e = troopEmpire(troop3);
            if (e !== null && e.troops != null && e.troops.contains(troop3)) e.troops.remove(troop3);
        }
    }
    const invChars = invadingCharacters(self);
    if (invChars !== null && invChars.length > 0) {
        for (let n = 0; n < invChars.length; n++) {
            const character = invChars[n];
            if (character != null && character.empire !== null && character.empire.pirateEmpireBaseHabitat !== null && character.empire === invader) {
                const builtObject = galaxy.findNearestBuiltObjectOfEmpire(Math.trunc(self.xpos), Math.trunc(self.ypos), character.empire);
                if (builtObject !== null) character.completeLocationTransfer(builtObject, galaxy);
            }
        }
    }
    const description4 = formatText(getText('Raid Withdrawal Description Invader'), self.name);
    sendMessageToEmpire(invader, invader, EmpireMessageType.ColonyDefended, self, description4);
    const description5 = formatText(getText('Raid Withdrawal Description Defender'), self.name, invader.name);
    sendMessageToEmpire(defender, defender, EmpireMessageType.ColonyDefended, self, description5);
    removeTroopsByType(invadingTroops, TroopType.PirateRaider, true);
    removeTroopsByType(self.troops!, TroopType.PirateRaider, true);
    if (galaxy.rnd.next(0, 3) > 0) {
        let num28 = 0.0;
        if (self.invasionSpaceControlStrengthAttackers > 0) {
            num28 = self.invasionSpaceControlStrengthDefenders > 0 ? Math.max(0.1, Math.min(1.0, Math.trunc(self.invasionSpaceControlStrengthAttackers / self.invasionSpaceControlStrengthDefenders))) : 1.0;
        }
        if (num28 > 0.0) {
            let num29 = 0.1 + galaxy.rnd.nextDouble() * 0.4 * num28;
            num29 *= empireRaidBonusFactor(invader);
            doRaidBonuses(galaxy, invader, self, num29);
        }
    }
    return true;
}

/** Empire.RaidBonusFactor (Empire.cs 434; SetPirateFactionModifiers, 1.0 for non-pirates). */
export function empireRaidBonusFactor(empire: Empire): number {
    const f = empire.pirateFactionModifiers !== null ? empire.pirateFactionModifiers.raidBonusFactor : 1.0;
    return f === 0.0 ? 1.0 : f;
}

/** Relocates an invading character that is not taking over the colony (the nearest military ship, capital or pirate port). */
function relocateOrKillCharacter(galaxy: Galaxy, self: Habitat, empire: Empire | null, character: Character): void {
    const ce = character.empire!;
    const nearest = getNearestBuiltObject(ce.builtObjects, self.xpos, self.ypos, BuiltObjectRole.Military, null);
    if (nearest !== null) {
        character.completeLocationTransfer(nearest, galaxy);
    } else if (ce.capital !== null) {
        character.completeLocationTransfer(ce.capital, galaxy);
    } else {
        if (ce.pirateEmpireBaseHabitat === null) return;
        const builtObject = identifyPirateSpaceport(galaxy, ce);
        if (builtObject !== null) {
            character.completeLocationTransfer(builtObject, galaxy);
            return;
        }
        killInvasionCharacter(galaxy, self, empire, character);
    }
}

/** ResolveInvasionBattles 3773-4331: the invaders win (num21 >= 20, raids >= 10). */
function invasionSucceeded(galaxy: Galaxy, self: Habitat, defender: Empire | null, invader: Empire | null, flag: boolean, flag2: boolean, flag5: boolean): void {
    galaxy.invasionSuccesses++;
    let empire: Empire | null = null;
    if (self.invadingTroops !== null && self.invadingTroops.count > 0 && self.invadingTroops.items[0] != null) empire = troopEmpire(self.invadingTroops.items[0]);
    if (flag) {
        failPirateDefendMission(galaxy, self.empire, self);
        const raidBonusFactor = empireRaidBonusFactor(empire!);
        doRaidBonuses(galaxy, empire, self, raidBonusFactor);
        const invChars = invadingCharacters(self);
        if (invChars !== null && invChars.length > 0) {
            for (let num31 = 0; num31 < invChars.length; num31++) {
                const character2 = invChars[num31];
                if (character2 != null && character2.empire !== null && character2.empire.builtObjects !== null) {
                    const nearestBuiltObject = getNearestBuiltObject(character2.empire.builtObjects, self.xpos, self.ypos, BuiltObjectRole.Military, null);
                    if (nearestBuiltObject !== null) character2.completeLocationTransfer(nearestBuiltObject, galaxy);
                }
            }
        }
        const control = pirateColonyControl(self);
        if (empire !== null && empire.pirateEmpireBaseHabitat !== null && control !== null) {
            const byFaction = control.getByFaction(empire.empireId);
            if (byFaction !== null) {
                let num32 = f32(0.07 + galaxy.rnd.nextDouble() * 0.08);
                num32 = f32(num32 * f32(empireRaidBonusFactor(empire)));
                byFaction.controlLevel = Math.min(1, f32(byFaction.controlLevel + num32));
            }
        }
        self.raidCountdown = 60;
    } else {
        conquerColony(galaxy, self, defender, invader, empire, flag2, flag5);
    }
    removeTroopsByType(self.invadingTroops!, TroopType.PirateRaider, true);
    removeTroopsByType(self.troops!, TroopType.PirateRaider, true);
}

/** ResolveInvasionBattles 3826-4328 (`else` of the raid branch): the colony falls to the invaders (or rebels, or pirates are driven out). */
function conquerColony(galaxy: Galaxy, self: Habitat, defender: Empire | null, invader: Empire | null, empire: Empire | null, flag2: boolean, flag5: boolean): void {
    const troops = self.troops!;
    removeTroopsByType(troops, TroopType.PirateRaider, true);
    removeTroopsByType(self.invadingTroops!, TroopType.PirateRaider, true);
    const troopList: Troop[] = [];
    if (flag2) {
        if (self.troops !== null) {
            if (self.empire !== null && self.empire.troops != null) {
                for (const troop6 of self.troops.items) {
                    if (troop6 != null && (troopEmpire(troop6) === galaxy.independentEmpire || troopEmpire(troop6) === null)) {
                        const e6 = troopEmpire(troop6);
                        if (e6 !== null && e6.troops != null) e6.troops.remove(troop6);
                        troopList.push(troop6);
                    }
                }
            }
            self.troops.clear();
        }
    } else if (self.troops !== null) {
        if (self.empire !== null && self.empire.troops != null) {
            for (const troop7 of self.troops.items) {
                if (troop7 != null) {
                    if (empire !== null && empire.counters !== null) empire.counters.processTroopDestruction(troop7);
                    const e7 = troopEmpire(troop7);
                    if (e7 !== null && e7.troops != null) e7.troops.remove(troop7);
                }
            }
        }
        self.troops.clear();
    }
    const chars = colonyCharacters(self);
    if (chars !== null && chars.length > 0) {
        const array3 = chars.slice();
        for (const character3 of array3) {
            if (character3 == null) continue;
            const role = character3.role;
            if (role === CharacterRole.IntelligenceAgent) {
                if (self.empire !== null && self.empire.capital !== null && self !== self.empire.capital) {
                    character3.completeLocationTransfer(self.empire.capital, galaxy);
                } else if (character3.empire!.pirateEmpireBaseHabitat !== null) {
                    const builtObject2 = identifyPirateSpaceport(galaxy, character3.empire);
                    if (builtObject2 !== null) {
                        character3.completeLocationTransfer(builtObject2, galaxy);
                        continue;
                    }
                    killInvasionCharacter(galaxy, self, empire, character3);
                } else {
                    killInvasionCharacter(galaxy, self, empire, character3);
                }
            } else if (character3.empire !== null && character3.empire !== self.empire && character3.empire.builtObjects !== null) {
                relocateOrKillCharacter(galaxy, self, empire, character3);
            } else {
                killInvasionCharacter(galaxy, self, empire, character3);
            }
        }
    }
    const empireList: (Empire | null)[] = [];
    const list: number[] = [];
    if (self.invadingTroops !== null) {
        let num35 = f32(25);
        const leader = empire !== null ? empireLeader(empire) : null;
        if (empire !== null && leader !== null) {
            const num36 = f32(1.0 + leader.troopExperienceGain / 100.0);
            num35 = f32(num35 * num36);
        }
        const invChars = invadingCharacters(self);
        if (invChars !== null && invChars.length > 0) {
            const highestSkillLevelExcludeRole = getHighestSkillLevelExcludeRole(invChars, CharacterSkillType.TroopExperienceGain, CharacterRole.Leader);
            const num37 = f32(1.0 + highestSkillLevelExcludeRole / 100.0);
            num35 = f32(num35 * num37);
        }
        const troopList2: Troop[] = [];
        for (const invadingTroop of self.invadingTroops.items) {
            if (invadingTroop == null) continue;
            const num38 = empireList.indexOf(troopEmpire(invadingTroop));
            if (num38 >= 0) {
                list[num38] += invadingTroop.overallAttackStrength;
            } else {
                empireList.push(troopEmpire(invadingTroop));
                list.push(invadingTroop.overallAttackStrength);
            }
            invadingTroop.setAttackStrength(invadingTroop.attackStrength + Math.trunc(num35));
            invadingTroop.setDefendStrength(invadingTroop.defendStrength + Math.trunc(f32(num35 / 2)));
            if (troopEmpire(invadingTroop) !== empire) {
                troopList2.push(invadingTroop);
                continue;
            }
            if (self.troops === null) self.troops = new TroopList();
            self.troops.add(invadingTroop);
        }
        self.invadingTroops.clear();
        for (let num39 = 0; num39 < troopList2.length; num39++) {
            const troop4 = troopList2[num39];
            const e4 = troop4 != null ? troopEmpire(troop4) : null;
            if (troop4 != null && e4 !== null && e4 !== self.empire && e4.builtObjects !== null) {
                const builtObject4 = findNearestTroopShipWithSpace(galaxy, e4, self.xpos, self.ypos, troop4.size);
                if (builtObject4 !== null && builtObject4.troops !== null) {
                    builtObject4.troops.add(troop4);
                    troop4.builtObject = builtObject4;
                    continue;
                }
                const habitat = fastFindNearestColony(galaxy, self.xpos, self.ypos, e4, 0);
                if (habitat !== null && habitat.troops !== null) {
                    troop4.colony = habitat;
                    habitat.troops.add(troop4);
                } else {
                    e4.troops.remove(troop4);
                }
            } else if (troop4 != null && e4 !== null && e4.troops != null) {
                e4.troops.remove(troop4);
            }
        }
    }
    let empire3: Empire | null = null;
    if (flag2) {
        empire3 = identifyLeavingEmpire(galaxy, self);
    } else {
        let num40 = 0.0;
        for (let num41 = 0; num41 < empireList.length; num41++) {
            if (list[num41] > num40) {
                num40 = list[num41];
                empire3 = empireList[num41];
            }
        }
    }
    const invChars2 = invadingCharacters(self);
    if (invChars2 !== null) {
        const characterList: Character[] = [];
        for (let num42 = 0; num42 < invChars2.length; num42++) {
            const character4 = invChars2[num42];
            if (character4 != null) {
                if (character4.empire === empire3) colonyCharacters(self)!.push(character4);
                else characterList.push(character4);
            }
        }
        invChars2.length = 0;
        for (let num43 = 0; num43 < characterList.length; num43++) {
            const character5 = characterList[num43];
            if (character5 != null && character5.empire !== null && character5.empire !== self.empire && character5.empire.builtObjects !== null) {
                relocateOrKillCharacter(galaxy, self, empire, character5);
            } else {
                killInvasionCharacter(galaxy, self, empire, character5);
            }
        }
    }
    if (flag5 && self.facilities !== null) {
        const planetaryFacilityList: PlanetaryFacility[] = [];
        let planetaryFacility3: PlanetaryFacility | null = null;
        for (let num44 = 0; num44 < self.facilities.length; num44++) {
            const planetaryFacility4 = self.facilities[num44];
            if (planetaryFacility4 != null && (planetaryFacility4.type === PlanetaryFacilityType.PirateBase || planetaryFacility4.type === PlanetaryFacilityType.PirateFortress || planetaryFacility4.type === PlanetaryFacilityType.PirateCriminalNetwork)) {
                planetaryFacility3 = planetaryFacility4;
                planetaryFacilityList.push(planetaryFacility4);
            }
        }
        for (let num45 = 0; num45 < planetaryFacilityList.length; num45++) {
            removeFirst(self.facilities, planetaryFacilityList[num45]);
            checkRemoveFacilityTracking(self, planetaryFacilityList[num45]);
        }
        if (planetaryFacility3 !== null) {
            // _PirateColonyControl.GetByFacilityControl() — the C# dereferences the list without a null check.
            const byFacilityControl2 = pirateColonyControl(self).getByFacilityControl();
            if (byFacilityControl2 !== null) {
                byFacilityControl2.hasFacilityControl = false;
                byFacilityControl2.controlLevel = Math.min(f32(0.49), Math.max(f32(0.01), f32(byFacilityControl2.controlLevel - f32(0.25))));
                const empireById2 = getEmpireById(galaxy, byFacilityControl2.empireId);
                if (empireById2 !== null) {
                    const description7 = formatText(getText('Invasion Destroys Facility Description'), planetaryFacility3.name, self.name);
                    sendMessageToEmpire(empireById2, empireById2, EmpireMessageType.PlanetaryFacilityDestroyed, planetaryFacility3, description7);
                }
            }
        }
    }
    if (!flag5) {
        if (self.owner !== null && self.empire !== galaxy.independentEmpire) {
            self.empire!.visibility.resolveSystemVisibilityAt(self.xpos, self.ypos, null, self);
            if (self.owner.colonies !== null) removeFirst(self.owner.colonies, self);
        }
        if (self.empire !== null) {
            if (flag2) {
                let description8 = '';
                if (empire3 === galaxy.independentEmpire) {
                    description8 = formatText(getText('Our colony at the PLANETTYPE COLONYNAME has revolted and left our empire INDEPENDENT'), resolveDescription(HabitatCategoryDesc, self.category), self.name);
                } else if (empire3 !== null) {
                    description8 = formatText(getText('Our colony at the PLANETTYPE COLONYNAME has revolted and left our empire JOIN OTHER'), resolveDescription(HabitatCategoryDesc, self.category), self.name, empire3.name);
                }
                sendMessageToEmpire(self.empire, self.empire, EmpireMessageType.ColonyLost, self, description8);
            } else if (empire3 !== null && !flag5) {
                const description9 = formatText(getText('The EMPIRE have invaded the PLANETTYPE COLONYNAME'), empire3.name, resolveDescription(HabitatCategoryDesc, self.category), self.name);
                sendMessageToEmpire(self.empire, self.empire, EmpireMessageType.ColonyLost, self, description9);
            }
        }
        if (troopList.length > 0) {
            for (let num47 = 0; num47 < troopList.length; num47++) {
                troopList[num47].empire = empire3;
                self.troops!.add(troopList[num47]);
            }
        }
        if (empire3 !== null) {
            if (!flag2) {
                inflictWarDamageHabitat(galaxy, empire3, self);
                cancelBlockadeColony(galaxy, empire3, self);
                cancelAttacksHabitat(galaxy, empire3, self);
                if (self.population != null && self.population.dominantRace !== null && empire3.dominantRace !== null) {
                    const num48 = resolveStandardRaceBias(self.population.dominantRace, empire3.dominantRace);
                    self.conqueredFactor = f32(Math.min(0.0, (num48 - 12.0) * 1.5));
                }
            }
            if (empire3.counters !== null) processColonyConquest(empire3, self, self.empire);
            // 19e Exchange: a merchant-spy faction may win the fight but never annexes — ownership goes to null so the
            // stock lost-colony adoption can re-seat the habitat with its original owner.
            const captureEmpire = scenarioQuery(galaxy, 'combatCaptureAllowed', true, { capturingEmpire: empire3, habitat: self }) ? empire3 : null;
            takeOwnershipOfColonyFull(galaxy, empire3, self, captureEmpire, flag2, false);
            self.taxRate = 0;
        }
        reviewEmpireTerritory(galaxy, false);
        const num50 = galaxy.rnd.next(11, 24);
        setDevelopmentLevel(self, getDevelopmentLevel(self) - num50);
        doCharacterEventForList(galaxy, CharacterEventType.ColonyDevelopmentDecrease, self, colonyCharacters(self), false, null);
        if (self.facilities !== null && self.facilities.length > 0) {
            const planetaryFacility5 = self.facilities[self.facilities.length - 1];
            if (planetaryFacility5 != null && planetaryFacility5.constructionProgress < 1) {
                colonyInvasionUi(self);
                removeFirst(self.facilities, planetaryFacility5);
                checkRemoveFacilityTracking(self, planetaryFacility5);
                reviewPlanetaryFacilities(galaxy, self, empire3);
            }
        }
    }
    const stats = invasionStatsOf(self);
    if (stats !== null) {
        stats.invasionSucceeded = true;
        doCharacterEventForList(galaxy, CharacterEventType.GroundInvasion, stats, colonyCharacters(self), false, null);
    }
    self.invasionStats = null;
    if (empire3 !== null) {
        if (flag2) {
            const description10 = formatText(getText('Colony Left Empire Joined Us'), resolveDescription(HabitatCategoryDesc, self.category), self.name);
            sendMessageToEmpire(empire3, empire3, EmpireMessageType.ColonyGained, self, description10);
            self.rebelling = false;
        } else if (flag5) {
            if (invader !== null && defender !== null) {
                const description11 = formatText(getText('Pirate Removed From Colony Description'), defender.name, self.name);
                sendMessageToEmpire(invader, invader, EmpireMessageType.ColonyGained, self, description11);
            }
        } else {
            const description12 = formatText(getText('Invaded Colony Taken Over'), resolveDescription(HabitatCategoryDesc, self.category), self.name);
            sendMessageToEmpire(empire3, empire3, EmpireMessageType.ColonyGained, self, description12);
        }
        if (self.population != null && self.population.dominantRace !== null) {
            const { descriptions: list2, raceChanged } = reviewEmpireAbilityBonusesFull(galaxy, empire3);
            if (list2.length > 0 && raceChanged !== null) {
                // Habitat.cs 4287-4297.
                sendNewEmpireRaceAbilityEvent(empire3, flag2 ? 'Conquest New Race Ability Militia' : 'Conquest New Race Ability', '\n', self, raceChanged, list2);
            }
        }
        if (self.population != null && self.population.totalAmount > 100000000 && self.empire !== null && self.empire !== galaxy.independentEmpire && galaxy.rnd.next(0, 8) === 1 && charactersCanGenerateAmountNonIntelligenceAgent(empire3) > 0) {
            const character6 = generateNewCharacter(galaxy, empire3, CharacterRole.TroopGeneral, self).character;
            if (character6 !== null) {
                const title = formatText(getText('New Character Event Title'), resolveDescription(CharacterRole, character6.role));
                const description13 = formatText(getText('New Character Event Troop General'), self.name, character6.name);
                sendMessageToEmpireWithTitle(empire3, empire3, EmpireMessageType.CharacterAppearance, character6, description13, title);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.4.cs 4449 InvadeUnwillingColonizationTargets
// ---------------------------------------------------------------------------------------------------------------

/** Empire.10.cs 3777 GenerateAutomationMessageInvadeIndependent(habitat, invasionFleet) — advisor text (UI). */
function generateAutomationMessageInvadeIndependent(galaxy: Galaxy, habitat: Habitat | null, invasionFleet: ShipGroup | null): string {
    const system = habitat !== null ? galaxy.determineHabitatSystemStar(habitat) : null;
    const race = habitat !== null && habitat.population != null ? habitat.population.dominantRace : null;
    return formatText(
        getText('Automation Invade Independent'),
        system !== null ? system.name : '',
        race !== null ? race.name : '',
        invasionFleet !== null ? invasionFleet.name : '',
        habitat !== null ? habitat.name : '',
    );
}

/**
 * Empire.4.cs 4449 InvadeUnwillingColonizationTargets(galaxy). Rnd: NextDouble (always); fleet AssignMission draws for each
 * target an available attack fleet is sent to.
 */
export function invadeUnwillingColonizationTargets(galaxy: Galaxy, empire: Empire): void {
    const refusalCount = { value: 0 };
    const num = csDoubleToInt(100.0 + galaxy.rnd.nextDouble() * 10.0);
    if (raceAggressionLevel(galaxy, empire.dominantRace!) <= num) return;
    const habitatPrioritizationList: ColonizationTarget[] = [];
    const num2 = Math.min(10, empire.colonizationTargets.length);
    for (let i = 0; i < num2; i++) {
        const target = empire.colonizationTargets[i];
        if (target.assignedShip != null) continue;
        const habitat = target.habitat;
        if (habitat == null) continue;
        const num3 = checkColonizationLikeliness(galaxy, habitat, empire.dominantRace!);
        if (num3 < -3 && empire.determineColonizeLowQualityHabitat(habitat)) {
            const shipGroup = findNearestAvailableFleet(galaxy, empire, habitat.xpos, habitat.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack, true, 0.1, false, false, false, true, 40000);
            if (
                shipGroup !== null &&
                (isAiControlled(shipGroup.leadShip!) || empire.controlMilitaryAttacks === AutomationLevel.PartiallyAutomated) &&
                checkTaskAuthorized(galaxy, empire, empire.controlMilitaryAttacks, refusalCount, generateAutomationMessageInvadeIndependent(galaxy, habitat, shipGroup), habitat, AdvisorMessageType.InvadeIndependent, null, shipGroup, null)
            ) {
                shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Attack, habitat, null, BuiltObjectMissionPriority.High, false);
                habitatPrioritizationList.push(target);
            }
        }
    }
    for (const item of habitatPrioritizationList) removeFirst(empire.colonizationTargets, item);
}

// ---------------------------------------------------------------------------------------------------------------
// Entry points used by the Attack / Raid case (missions/cmdAttack.ts, M4n)
// ---------------------------------------------------------------------------------------------------------------

/** Habitat.cs 2255 TargetInvadingShips(invader, time): the giant ion cannon fires at the invader. Rnd: the cannon's Fire. */
export function targetInvadingShips(galaxy: Galaxy, habitat: Habitat, invader: BuiltObject, time: number): void {
    if (habitat.giantIonCannonPresent && habitat.giantIonCannon !== null) {
        // Habitat.cs 2245 CheckIonCannonCanFireAtTarget(target, time, out distanceToTarget).
        if (checkIonCannonReadyToFire(habitat, time)) {
            const { inRange, distanceToTarget } = checkTargetInRange(galaxy, habitat, invader);
            if (inRange) habitatFireWeaponsAtTarget(galaxy, habitat, distanceToTarget, invader, time);
        }
    }
}

/** Habitat.cs 1204 StopRebelling(): `_Rebelling = false`. */
export function habitatStopRebelling(galaxy: Galaxy, habitat: Habitat): void {
    void galaxy;
    habitat.rebelling = false;
}

/**
 * BuiltObject.2.cs 2367-2374: `InvasionStats ??= new InvasionStats(colony, Empire, colony.Empire);
 * InvasionStats.TroopsDamageToInvaders += (float)amount`.
 */
export function addInvasionStatsTroopsDamageToInvaders(galaxy: Galaxy, colony: Habitat, invadingEmpire: Empire | null, amount: number): void {
    void galaxy;
    if (colony.invasionStats === null) colony.invasionStats = new InvasionStats(colony, invadingEmpire, colony.empire);
    const stats = invasionStatsOf(colony);
    if (stats !== null) stats.troopsDamageToInvaders = f32(stats.troopsDamageToInvaders + f32(amount));
}

/** Character.CompleteLocationTransfer(colony, galaxy, invadingDestination: true) (BuiltObject.2.cs 2393). */
export function characterCompleteLocationTransferInvading(galaxy: Galaxy, character: Character, colony: Habitat): void {
    character.completeLocationTransfer(colony, galaxy, true);
}

// ---------------------------------------------------------------------------------------------------------------
// Ownership entry points (combat/ownership.ts), re-exported for the modules that import them from here
// ---------------------------------------------------------------------------------------------------------------

/** Habitat.cs 2571 ScanForNewOwner (combat/ownership.ts). */
export function scanForNewOwnerHabitat(galaxy: Galaxy, habitat: Habitat): void {
    scanForNewOwnerHabitatImpl(galaxy, habitat);
}

/** BuiltObject.1.cs 65 / 70 ScanForNewOwner([preferredDiscoverer]) (combat/ownership.ts). */
export function scanForNewOwnerBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, preferredDiscoverer: BuiltObject | null = null): void {
    scanForNewOwnerBuiltObjectImpl(galaxy, builtObject, preferredDiscoverer);
}

/** Habitat.cs 7445 / 7450 ClearColony(clearingEmpire) (combat/ownership.ts). */
export function clearColony(galaxy: Galaxy, habitat: Habitat, newOwner: Empire | null): void {
    clearColonyImpl(galaxy, habitat, newOwner);
}

/** Empire.1.cs 524-541 TakeOwnershipOfBuiltObject(builtObject, newOwner, setDesignAsObsolete) (combat/ownership.ts). */
export function takeOwnershipOfBuiltObject(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject, newOwner: Empire | null, setDesignAsObsolete: boolean, removeFromFleet = true): void {
    takeOwnershipOfBuiltObjectImpl(galaxy, empire, builtObject, newOwner, setDesignAsObsolete, removeFromFleet);
}

/** Empire.1.cs 54/64 TakeOwnershipOfColony(colony, newEmpire) at runtime (a traded colony; combat/ownership.ts). */
export function takeOwnershipOfColonyRuntime(galaxy: Galaxy, empire: Empire, colony: Habitat, newEmpire: Empire): void {
    takeOwnershipOfColonyFull(galaxy, empire, colony, newEmpire, false, false);
}

// ---- Stub added by M4s2 (BaconEmpire.cs 1499 CheckColoniesForPirateFacilitiesAndAttack → Habitat.cs 3312) ----

/**
 * Habitat.cs 3360 GenerateDefensivePirateRaiders(defendingPirateFaction, currentDefendingTroopsInvade) →
 * BaconHabitat.cs 1269 GenerateDefensivePirateRaiders (M4z1). Rnd: Next(0, 3) (raider count). Callers: Habitat.cs 3312
 * InitiateAttackAgainstPirateFacilities (pirates/pirateEmpireAI.ts) and 3324 PiratesDefendAgainstRaid (combat/boarding.ts).
 * The "piratebase" BaconValue is only set by the player's AddFundsToPirateBase console command (UI), so d stays 0 in a
 * headless game; the 1327-1335 "pirate base under attack" prompt is UI (TODO(port) M9). The raiders go into
 * planet.Troops / faction.Troops without Troop.Colony, as in the C#.
 */
export function generateDefensivePirateRaiders(galaxy: Galaxy, planet: Habitat, defendingPirateFaction: Empire | null, currentDefendingTroopsInvade: boolean): void {
    let num1 = Math.fround(50);
    let d = 0;
    if (defendingPirateFaction === null || defendingPirateFaction.dominantRace === null) return;
    if (currentDefendingTroopsInvade) {
        const items1: Troop[] = planet.troops !== null ? planet.troops.items.slice() : [];
        const planetCharacters = ensureStellarObjectCharacters(planet);
        const items2 = planetCharacters.slice();
        planet.troops!.clear();
        planetCharacters.length = 0;
        for (const t of items1) planet.invadingTroops!.add(t);
        const invadingCharacters = ensureHabitatInvadingCharacters(planet);
        for (const c of items2) invadingCharacters.push(c);
    }
    let num2 = 1;
    let planetaryFacility: PlanetaryFacility | null = null;
    if (planet.facilities !== null) planetaryFacility = facilitiesFindBestPirateFacility(planet.facilities, true, true);
    if (planetaryFacility !== null) {
        switch (planetaryFacility.type) {
            case PlanetaryFacilityType.PirateBase:
                num2 = baconSettings.pirateBaseTroops;
                break;
            case PlanetaryFacilityType.PirateFortress:
                num2 = baconSettings.pirateFortressTroops;
                break;
            case PlanetaryFacilityType.PirateCriminalNetwork:
                num2 = baconSettings.pirateCriminalNetworkTroops;
                break;
        }
    }
    if (planet.baconValues !== null && planet.baconValues.has('piratebase')) {
        d = Math.trunc((planet.baconValues.get('piratebase') as number) / 1000);
        const num3 = d <= 100 ? Math.trunc(Math.sqrt(d)) : 10 + Math.trunc(d / 20);
        num2 += num3;
        num1 = Math.fround(Math.max(100.0, 60.0 + num3));
    }
    const num4 = num2 + galaxy.rnd.next(0, 3);
    const num5 = defendingPirateFaction.dominantRace.troopStrength / 100.0;
    const raidStrengthFactor = empireRaidStrengthFactor(defendingPirateFaction);
    const num6 = Math.trunc(num1 * num5 * raidStrengthFactor);
    for (let index = 0; index < num4; ++index) {
        const troop = new TroopClass(defendingPirateFaction.generateTroopDescription(formatText(getText('RACE Pirate Raider'), defendingPirateFaction.dominantRace.name)), TroopType.PirateRaider, num6, num6, 100, 100, defendingPirateFaction, defendingPirateFaction.dominantRace);
        // Race.PictureRef ← races.txt PictureIndex (as combat/boarding.ts PerformRaidColonyInvasion).
        if (defendingPirateFaction.dominantRace !== null) troop.pictureRef = defendingPirateFaction.dominantRace.pictureIndex;
        if (troop !== null) {
            planet.troops!.add(troop);
            defendingPirateFaction.troops.add(troop);
        }
    }
}
