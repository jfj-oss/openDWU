// M4i — planetary facilities: the PlanetaryFacility model (PlanetaryFacility.cs, PlanetaryFacilityList.cs,
// PlanetaryFacilityDefinitionList.cs lookups, PlanetaryFacilityBuildDateList.cs), the Habitat facility methods
// (Habitat.cs QueueFacilityConstruction 6759, QueueWonderConstruction 6740, CanBuildWonder 6460, CheckTroopFacilitiesPresent
// 6791, ConstructFacilities 2039, ReviewPlanetaryFacilities 7216, CheckRemoveFacilityTracking 2031) and the empire facility
// AI (Empire.3.cs RefreshColonyFacilityInfo 104, PirateReviewColonyFacilities 254, ReviewColonyFacilities 395,
// CountFacilities 837, DetermineFacilityColonies 884, DetermineTroopFacilityColonies 902,
// CalculateAccurateAnnualCashflowIncludingUnderConstruction 4106; Empire.4.cs IdentifyEmpireCapitals 3340,
// IdentifyEmpireRegionalCapitals 3360, RecalculateColonyDistancesFromCapital 3384; Empire.2.cs CountPirateCriminalNetworks
// 2871; Galaxy.8.cs CalculatePlanetaryFacilityBuildTimeFactor 4265 / CalculatePlanetaryFacilityCost 4276).
//
// Rnd: ReviewColonyFacilities draws Rnd.Next(0, 2) for a colony that is not a location to defend but has a space port
// (Empire.3.cs 682, behind the cost / maintenance / bunker checks); ConstructFacilities draws Rnd.Next(0, 3000000) when a
// RaceAchievement wonder with Value2 == 1 completes (Habitat.cs 2152), plus the draws of DoCharacterEvent (characters.ts)
// and CheckCancelWonderBuilding (wonders.ts).
//
// PirateColonyControl (Habitat.GetPirateControl) is not modelled yet (M4s2): its lookups are the stubs in
// pirates/pirateAI.ts, which return null — what the C# sees for a colony with an empty PirateColonyControlList.

import { checkTriggerEvent } from '../story/eventActions';
import { EventTriggerType } from '../story/gameEventModel';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { empireGovernmentAttributes } from '../empire';
import { resolveColonyHabitatTypeByIndexDesertBeforeOcean, type Habitat } from '../types';
import type { Facility } from '../data/facilities';
import { PlanetaryFacilityType, WonderType, facilityType } from '../researchSystem';
import { netSort } from '../netSort';
import { habitatCompareTo } from '../stationPlacement';
import { strategicValue } from '../territory';
import {
    annualFacilityMaintenance,
    annualPirateProtection,
    annualPrivateMaintenance,
    annualStateMaintenance,
    annualSubjugationTribute,
    annualTaxRevenue,
    calculateAnnualSubjugationTributeIncome,
    recalculateDistanceFactorWithCapitals,
} from '../forceStructure';
import { annualTroopMaintenanceIncludeRecruiting } from '../troops';
import { AdvisorMessageType, checkTaskAuthorized, type RefCount } from '../diplomacyTick';
import { gameText } from '../colonyTick';
import { CharacterEventType, CharacterSkillType, doCharacterEventForList, getHighestSkillLevelExcludeLeaders, resolveLocationsToDefend, stellarObjectCharacters } from '../characters';
import { determineSpacePortAtColony } from '../combat/attackAI';
import { resolveEmpireRaceTendency } from '../researchTick';
import { empireApprovalRating } from '../taxes';
import { calculatePirateCashflow, habitatPirateControlByFacilityControl, habitatPirateControlHighest, pirateEconomyPerformExpense } from '../pirates/pirateAI';
import { PirateExpenseType } from '../pirates/pirateEconomy';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { DisasterEventType, EventMessageType } from '../eventTypes';
import { sendNewsBroadcast } from '../events';
import { galaxyStarDate } from '../tick/simTime';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../galaxyTime';
import { Population } from '../population';
import { BuiltObjectComponent, ComponentStatus } from '../builtObjectComponent';
import { Weapon } from '../weapon';
import { DiplomaticRelationType } from '../diplomacy';
import { registerTodo, todo } from '../tick/todo';
import { getEmpireById } from '../logistics/contracts';
import { checkCancelWonderBuilding, checkWonderBuiltDef, reviewWondersBuilt } from './wonders';

const f32 = Math.fround;

// ---------------------------------------------------------------------------------------------------------------
// PlanetaryFacility / PlanetaryFacilityList (the model)
// ---------------------------------------------------------------------------------------------------------------

/**
 * PlanetaryFacility.cs. The C# keeps the definition id and resolves every other property through the static
 * Galaxy.PlanetaryFacilityDefinitionsStatic[id]; the TS keeps a reference to that (immutable) definition instead.
 */
export class PlanetaryFacility {
    /** Galaxy.PlanetaryFacilityDefinitionsStatic[_PlanetaryFacilityDefinitionId]. */
    readonly def: Facility;
    /** float ConstructionProgress. */
    private _constructionProgress = 0;

    constructor(def: Facility, constructionProgress = 0) {
        this.def = def;
        this._constructionProgress = f32(constructionProgress);
    }

    get constructionProgress(): number { return this._constructionProgress; }
    set constructionProgress(v: number) { this._constructionProgress = f32(v); }
    get planetaryFacilityDefinitionId(): number { return this.def.facilityId; }
    get name(): string { return this.def.name; }
    get type(): PlanetaryFacilityType { return facilityType(this.def); }
    get wonderType(): WonderType { return this.def.wonderType as WonderType; }
    get value1(): number { return this.def.value1; }
    get value2(): number { return this.def.value2; }
    get value3(): number { return this.def.value3; }
    get maintenance(): number { return this.def.maintenanceCost; }
}

/** PlanetaryFacilityList.CountByType (PlanetaryFacilityList.cs 262). */
export function facilitiesCountByType(list: readonly PlanetaryFacility[], type: PlanetaryFacilityType): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        if (list[index].type === type) ++num;
    }
    return num;
}

/** PlanetaryFacilityList.CountCompletedByType(type) (PlanetaryFacilityList.cs 273). */
export function facilitiesCountCompletedByType(list: readonly PlanetaryFacility[], type: PlanetaryFacilityType): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        if (list[index].type === type && list[index].constructionProgress >= 1.0) ++num;
    }
    return num;
}

/** PlanetaryFacilityList.FindByType (PlanetaryFacilityList.cs 120). */
export function facilitiesFindByType(list: readonly PlanetaryFacility[], type: PlanetaryFacilityType): PlanetaryFacility | null {
    for (let index = 0; index < list.length; ++index) {
        if (list[index].type === type) return list[index];
    }
    return null;
}

/** PlanetaryFacilityList.FindCompletedByType (PlanetaryFacilityList.cs 140). */
export function facilitiesFindCompletedByType(list: readonly PlanetaryFacility[], type: PlanetaryFacilityType): PlanetaryFacility | null {
    for (let index = 0; index < list.length; ++index) {
        if (list[index].type === type && list[index].constructionProgress >= 1.0) return list[index];
    }
    return null;
}

/**
 * PlanetaryFacilityList.FindBestPirateFacility(includeCriminalNetwork) (178) / FindBestCompletedPirateFacility (150,
 * `completedOnly`).
 */
export function facilitiesFindBestPirateFacility(list: readonly PlanetaryFacility[], includeCriminalNetwork: boolean, completedOnly = false): PlanetaryFacility | null {
    let best: PlanetaryFacility | null = null;
    for (let index = 0; index < list.length; ++index) {
        const planetaryFacility = list[index];
        if (planetaryFacility === null || (completedOnly && !(planetaryFacility.constructionProgress >= 1.0))) continue;
        switch (planetaryFacility.type) {
            case PlanetaryFacilityType.PirateBase:
            case PlanetaryFacilityType.PirateFortress:
                if (best === null || planetaryFacility.value2 > best.value2) best = planetaryFacility;
                break;
            case PlanetaryFacilityType.PirateCriminalNetwork:
                if (includeCriminalNetwork && (best === null || planetaryFacility.value2 > best.value2)) best = planetaryFacility;
                break;
        }
    }
    return best;
}

/** PlanetaryFacilityList.CalculateAnnualMaintenance (PlanetaryFacilityList.cs 227). */
export function facilitiesCalculateAnnualMaintenance(list: readonly PlanetaryFacility[]): number {
    let annualMaintenance = 0.0;
    for (let index = 0; index < list.length; ++index) {
        const planetaryFacility = list[index];
        if (planetaryFacility !== null && planetaryFacility.constructionProgress >= 1.0) {
            annualMaintenance += planetaryFacility.maintenance;
        }
    }
    return annualMaintenance;
}

// ---------------------------------------------------------------------------------------------------------------
// PlanetaryFacilityDefinitionList (static definitions / buildable lists)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.PlanetaryFacilityDefinitionsStatic (facilities.txt; ids are sequential, so the index is the id). */
export function planetaryFacilityDefinitionsStatic(galaxy: Galaxy): readonly Facility[] {
    return galaxy.researchStatic?.facilities ?? [];
}

/** PlanetaryFacilityDefinitionList.FindFacilityByType (PlanetaryFacilityDefinitionList.cs 342). */
export function definitionsFindFacilityByType(list: readonly Facility[], type: PlanetaryFacilityType): Facility | null {
    for (let index = 0; index < list.length; ++index) {
        if (facilityType(list[index]) === type) return list[index];
    }
    return null;
}

/** PlanetaryFacilityDefinitionList.CountByType (PlanetaryFacilityDefinitionList.cs 393). */
export function definitionsCountByType(list: readonly Facility[], type: PlanetaryFacilityType): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        if (facilityType(list[index]) === type) ++num;
    }
    return num;
}

/** PlanetaryFacilityDefinitionList.GetWonders (PlanetaryFacilityDefinitionList.cs 362). */
export function definitionsGetWonders(list: readonly Facility[]): Facility[] {
    const wonders: Facility[] = [];
    for (let index = 0; index < list.length; ++index) {
        if (facilityType(list[index]) === PlanetaryFacilityType.Wonder) wonders.push(list[index]);
    }
    return wonders;
}

/** List<T>.Remove(item): removes the first reference-equal element. */
export function listRemove<T>(list: T[], item: T): boolean {
    const i = list.indexOf(item);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// PlanetaryFacilityBuildDateList (Empire.TrackedWonders)
// ---------------------------------------------------------------------------------------------------------------

/** PlanetaryFacilityBuildDate.cs. */
export interface PlanetaryFacilityBuildDate {
    colony: Habitat;
    facilityId: number;
    buildDate: number;
}

/** PlanetaryFacilityBuildDateList.RemoveBuildDate (PlanetaryFacilityBuildDateList.cs 30). */
export function trackedWondersRemoveBuildDate(list: PlanetaryFacilityBuildDate[], colony: Habitat, planetaryFacilityId: number): void {
    const toRemove: PlanetaryFacilityBuildDate[] = [];
    for (let index = 0; index < list.length; ++index) {
        const d = list[index];
        if (d !== null && d.colony === colony && d.facilityId === planetaryFacilityId) toRemove.push(d);
    }
    for (let index = 0; index < toRemove.length; ++index) listRemove(list, toRemove[index]);
}

/** PlanetaryFacilityBuildDateList.AddUpdateBuildDate (PlanetaryFacilityBuildDateList.cs 43). */
export function trackedWondersAddUpdateBuildDate(list: PlanetaryFacilityBuildDate[], colony: Habitat, planetaryFacilityId: number, buildDate: number): void {
    trackedWondersRemoveBuildDate(list, colony, planetaryFacilityId);
    list.push({ colony, facilityId: planetaryFacilityId, buildDate });
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.8.cs cost / build-time factors
// ---------------------------------------------------------------------------------------------------------------

/** Empire.PlanetaryFacilityBuildFactor / PlanetaryWonderBuildFactor (1.0 unless a pirate play style sets them; 0 → 1). */
function empireFacilityBuildFactor(empire: Empire, wonder: boolean): number {
    const mods = empire.pirateFactionModifiers;
    if (mods === null) return 1.0;
    const v = wonder ? mods.planetaryWonderBuildFactor : mods.planetaryFacilityBuildFactor;
    return v === 0.0 ? 1.0 : v;
}

/** Galaxy.8.cs 4265 CalculatePlanetaryFacilityBuildTimeFactor(planetaryFacility, empire). */
export function calculatePlanetaryFacilityBuildTimeFactor(planetaryFacility: PlanetaryFacility | null, empire: Empire | null): number {
    let num = 1.0;
    if (planetaryFacility !== null && empire !== null) {
        const type = planetaryFacility.type;
        num = type !== PlanetaryFacilityType.Wonder && type !== PlanetaryFacilityType.PirateCriminalNetwork ? num * empireFacilityBuildFactor(empire, false) : num * empireFacilityBuildFactor(empire, true);
    }
    return num;
}

/** Galaxy.8.cs 4276 CalculatePlanetaryFacilityCost(planetaryFacility, empire). */
export function calculatePlanetaryFacilityCost(planetaryFacility: Facility | null, empire: Empire | null): number {
    let num = 0.0;
    if (planetaryFacility !== null) {
        num = planetaryFacility.buildCost;
        if (empire !== null) {
            const type = facilityType(planetaryFacility);
            num = type !== PlanetaryFacilityType.Wonder && type !== PlanetaryFacilityType.PirateCriminalNetwork ? num * empireFacilityBuildFactor(empire, false) : num * empireFacilityBuildFactor(empire, true);
        }
    }
    return num;
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat facility methods
// ---------------------------------------------------------------------------------------------------------------

/** Habitat.cs 6460 CanBuildWonder(wonder). */
export function canBuildWonder(galaxy: Galaxy, habitat: Habitat, wonder: Facility | null): boolean {
    if (wonder !== null && facilityType(wonder) === PlanetaryFacilityType.Wonder) {
        if (checkWonderBuiltDef(galaxy, wonder)) return false;
        if ((wonder.wonderType as WonderType) === WonderType.RaceAchievement && wonder.value3 > 0) {
            const habitatType = resolveColonyHabitatTypeByIndexDesertBeforeOcean(wonder.value3 - 1);
            if (habitat.type !== habitatType) return false;
        }
        return true;
    }
    return false;
}

/** Habitat.cs 6740 QueueWonderConstruction(wonder, fullyConstructed = false). */
export function queueWonderConstruction(galaxy: Galaxy, habitat: Habitat, wonder: Facility, fullyConstructed = false): boolean {
    if (habitat.facilities === null) habitat.facilities = [];
    if (checkWonderBuiltDef(galaxy, wonder)) return false;
    let constructionProgress = 0;
    if (fullyConstructed) constructionProgress = 1;
    habitat.facilities.push(new PlanetaryFacility(wonder, constructionProgress));
    return true;
}

/** Habitat.cs 6759 QueueFacilityConstruction(facilityType, fullyConstructed = false). */
export function queueFacilityConstruction(galaxy: Galaxy, habitat: Habitat, type: PlanetaryFacilityType, fullyConstructed = false): boolean {
    if (habitat.facilities === null) habitat.facilities = [];
    for (let i = 0; i < habitat.facilities.length; i++) {
        if (habitat.facilities[i].type === type) return false;
    }
    const planetaryFacilityDefinition = definitionsFindFacilityByType(planetaryFacilityDefinitionsStatic(galaxy), type);
    if (planetaryFacilityDefinition !== null) {
        let constructionProgress = 0;
        if (fullyConstructed) constructionProgress = 1;
        habitat.facilities.push(new PlanetaryFacility(planetaryFacilityDefinition, constructionProgress));
        return true;
    }
    return false;
}

/** Habitat.cs 6791 CheckTroopFacilitiesPresent. */
export function checkTroopFacilitiesPresent(habitat: Habitat): boolean {
    let result = false;
    const facilities = habitat.facilities;
    if (facilities !== null && facilities.length > 0) {
        let val = 0;
        val = Math.max(val, facilitiesCountByType(facilities, PlanetaryFacilityType.CloningFacility));
        val = Math.max(val, facilitiesCountByType(facilities, PlanetaryFacilityType.RoboticTroopFoundry));
        val = Math.max(val, facilitiesCountByType(facilities, PlanetaryFacilityType.TroopTrainingCenter));
        if (val > 0) result = true;
    }
    return result;
}

/** Habitat.cs 2031 CheckRemoveFacilityTracking(facility). */
export function checkRemoveFacilityTracking(habitat: Habitat, facility: PlanetaryFacility | null): void {
    if (facility !== null && habitat.empire !== null && habitat.empire.trackedWonders !== null) {
        trackedWondersRemoveBuildDate(habitat.empire.trackedWonders, habitat, facility.planetaryFacilityDefinitionId);
    }
}

/** Habitat.cs 7216 ReviewPlanetaryFacilities(empire). */
export function reviewPlanetaryFacilities(galaxy: Galaxy, habitat: Habitat, empire: Empire | null): void {
    let b = 0;
    let planetaryShieldPresent = false;
    let giantIonCannonPresent = false;
    let giantIonCannon: Weapon | null = null;
    let b2 = 0;
    let planetaryFacility: PlanetaryFacility | null = null;
    const facilities = habitat.facilities;
    if (facilities !== null) {
        for (let i = 0; i < facilities.length; i++) {
            if (!(facilities[i].constructionProgress >= 1)) continue;
            if (facilities[i].type === PlanetaryFacilityType.FortifiedBunker) {
                b = facilities[i].value1 & 0xff; // (byte)
            } else if (facilities[i].type === PlanetaryFacilityType.IonCannon) {
                giantIonCannonPresent = true;
                const def = galaxy.researchStatic?.componentStatic?.byId.get(facilities[i].value1);
                if (def === undefined) throw new Error(`ReviewPlanetaryFacilities: component ${facilities[i].value1} not in Galaxy.ComponentDefinitionsStatic`);
                giantIonCannon = Weapon.fromBuiltObjectComponent(new BuiltObjectComponent(def, ComponentStatus.Normal));
            } else if (facilities[i].type === PlanetaryFacilityType.PlanetaryShield) {
                planetaryShieldPresent = true;
            } else if (facilities[i].type === PlanetaryFacilityType.Wonder) {
                if (planetaryFacility === null || facilities[i].value1 > planetaryFacility.value1) planetaryFacility = facilities[i];
                if (facilities[i].wonderType === WonderType.ColonyDefense) b2 = facilities[i].value2 & 0xff;
            }
        }
    }
    const val = 10.0 * ((1.0 + b2 / 10.0) * (1.0 + b / 10.0)) - 10.0;
    // (byte)Math.Min(255.0, val): val >= 0 here.
    const defensiveFortressBonus = Math.trunc(Math.min(255.0, val)) & 0xff;
    habitat.planetaryShieldPresent = planetaryShieldPresent;
    habitat.giantIonCannonPresent = giantIonCannonPresent;
    habitat.giantIonCannon = giantIonCannon;
    habitat.defensiveFortressBonus = defensiveFortressBonus;
    habitat.wonderForDevelopment = planetaryFacility;
    if (empire !== null) recalculateColonyDistancesFromCapital(galaxy, empire);
}


/** Habitat.cs 2039 ConstructFacilities(timePassed). */
export function constructFacilities(galaxy: Galaxy, habitat: Habitat, timePassed: number): void {
    const facilities = habitat.facilities;
    if (facilities === null || facilities.length <= 0) return;
    let val = 100000.0 * (REAL_SECONDS_IN_GALACTIC_YEAR / strategicValue(habitat));
    val = Math.max(90.0, Math.min(1800.0, val));
    let num = f32(timePassed / val);
    let num2 = f32(timePassed / (val * 10.0));
    let flag = false;
    if (habitat.empire !== null && habitat.empire.leader !== null) {
        const num3 = f32(1.0 + habitat.empire.leader.facilityConstructionSpeed / 100.0);
        num = f32(num * num3);
        num2 = f32(num2 * num3);
    }
    const characters = stellarObjectCharacters(habitat);
    if (characters !== null && characters.length > 0) {
        const highestSkillLevelExcludeLeaders = getHighestSkillLevelExcludeLeaders(characters, CharacterSkillType.FacilityConstructionSpeed);
        const num4 = f32(1.0 + highestSkillLevelExcludeLeaders / 100.0);
        num = f32(num * num4);
        num2 = f32(num2 * num4);
    }
    for (let i = 0; i < facilities.length; i++) {
        const planetaryFacility = facilities[i];
        if (planetaryFacility === null || !(planetaryFacility.constructionProgress < 1)) continue;
        let num5 = f32(1);
        switch (planetaryFacility.type) {
            case PlanetaryFacilityType.PirateBase:
            case PlanetaryFacilityType.PirateFortress:
            case PlanetaryFacilityType.PirateCriminalNetwork: {
                const byFacilityControl = habitatPirateControlByFacilityControl(galaxy, habitat);
                if (byFacilityControl !== null) {
                    const empireById = getEmpireById(galaxy, byFacilityControl.empireId);
                    num5 = f32(calculatePlanetaryFacilityBuildTimeFactor(planetaryFacility, empireById));
                }
                break;
            }
            default:
                if (habitat.empire !== null) num5 = f32(calculatePlanetaryFacilityBuildTimeFactor(planetaryFacility, habitat.empire));
                break;
        }
        switch (planetaryFacility.type) {
            case PlanetaryFacilityType.Wonder:
                planetaryFacility.constructionProgress += f32(num2 * num5);
                break;
            case PlanetaryFacilityType.PirateBase:
                planetaryFacility.constructionProgress += f32(f32(num * 1) * num5);
                break;
            case PlanetaryFacilityType.PirateFortress:
                planetaryFacility.constructionProgress += f32(f32(num * 0.5) * num5);
                break;
            case PlanetaryFacilityType.PirateCriminalNetwork:
                planetaryFacility.constructionProgress += f32(f32(num * 0.25) * num5);
                break;
            default:
                planetaryFacility.constructionProgress += f32(num * num5);
                break;
        }
        if (planetaryFacility.constructionProgress > 1) {
            // Habitat.cs 2112: _Galaxy.CheckTriggerEvent(GameEventId, Empire, Build, facility) (story/eventActions.ts, M4z3).
            checkTriggerEvent(galaxy, habitat.gameEventId, habitat.empire, EventTriggerType.Build, planetaryFacility);
            num = f32(planetaryFacility.constructionProgress - 1);
            planetaryFacility.constructionProgress = 1;
            flag = true;
            const habitat2 = galaxy.determineHabitatSystemStar(habitat);
            let empire: Empire | null = habitat.empire;
            const byFacilityControl2 = habitatPirateControlByFacilityControl(galaxy, habitat);
            if ((planetaryFacility.type === PlanetaryFacilityType.PirateBase || planetaryFacility.type === PlanetaryFacilityType.PirateFortress || planetaryFacility.type === PlanetaryFacilityType.PirateCriminalNetwork) && byFacilityControl2 !== null) {
                // PirateEmpires.GetByEmpireId.
                empire = galaxy.pirateEmpires.find((e) => e !== null && e.empireId === byFacilityControl2.empireId) ?? null;
            }
            if (empire !== null) {
                if (planetaryFacility.type === PlanetaryFacilityType.Wonder) {
                    // TODO(port) M9: SendEventMessageToEmpire(WonderBuilt, title, message, facility, this) (Habitat.cs 2127-2130,
                    // needs Galaxy.ResolveWonderDescription) — event pop-up; no sim state.
                    sendNewsBroadcast(empire, EventMessageType.WonderBuilt, planetaryFacility, DisasterEventType.Undefined, false, false, EmpireMessageType.Undefined, habitat); // Habitat.cs 2131
                } else if (empire.pirateEmpireBaseHabitat !== null) {
                    if (planetaryFacility.type === PlanetaryFacilityType.PirateCriminalNetwork) {
                        if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire) {
                            const description = gameText('Colony Lost to Pirate Criminal Network', habitat.name, habitat2.name, empire.name);
                            sendMessageToEmpire(habitat.empire, habitat.empire, EmpireMessageType.ColonyLost, habitat, description);
                        }
                        empire.takeOwnershipOfColony(habitat, empire);
                    }
                    // TODO(port) M9: SendEventMessageToEmpire(WonderBuilt, "Pirate Facility Build Title", ...) — event pop-up.
                } else {
                    const description2 = gameText('We have completed construction of a new FACILITY', planetaryFacility.name, habitat.name, habitat2.name);
                    sendMessageToEmpire(empire, empire, EmpireMessageType.ColonyFacilityCompleted, habitat, description2);
                }
            }
            if (planetaryFacility.type === PlanetaryFacilityType.Wonder && planetaryFacility.wonderType === WonderType.RaceAchievement && planetaryFacility.value2 === 1) {
                const race = galaxy.races.find((r) => r.name === 'Mechanoid') ?? null;
                if (race !== null) {
                    // C#: Rnd.Next(0, 3000000) * 1000 is int * int (unchecked): values above int.MaxValue / 1000 wrap negative.
                    const num6 = 15000000000 + ((galaxy.rnd.next(0, 3000000) * 1000) | 0);
                    habitat.maxPopulation = Math.max(habitat.maxPopulation, habitat.population.totalAmount + num6);
                    const population = new Population(race, num6);
                    habitat.population.add(population);
                    habitat.name = 'Utopia';
                }
            }
            if (planetaryFacility.type === PlanetaryFacilityType.Wonder) {
                checkCancelWonderBuilding(galaxy, planetaryFacility);
                reviewWondersBuilt(galaxy);
                if (habitat.empire !== null && habitat.empire.diplomaticRelations !== null) {
                    const relations = habitat.empire.diplomaticRelations.toArray();
                    for (let j = 0; j < relations.length; j++) {
                        const diplomaticRelation = relations[j];
                        if (diplomaticRelation === null || diplomaticRelation.type === DiplomaticRelationType.NotMet || diplomaticRelation.otherEmpire === habitat.empire) continue;
                        const otherEmpire = diplomaticRelation.otherEmpire;
                        if (otherEmpire !== null) {
                            const byId = planetaryFacility.def;
                            if (otherEmpire.visibility.checkSystemExplored(habitat2.systemIndex)) {
                                const description3 = gameText('EMPIRE has completed construction of a new WONDER at COLONY SYSTEM', habitat.empire.name, planetaryFacility.name, habitat.name, habitat2.name);
                                sendMessageToEmpire(otherEmpire, otherEmpire, EmpireMessageType.ColonyFacilityCompleted, byId, description3, { x: Math.trunc(habitat.xpos), y: Math.trunc(habitat.ypos) }, '');
                            } else {
                                const description4 = gameText('EMPIRE has completed construction of a new WONDER', habitat.empire.name, planetaryFacility.name);
                                sendMessageToEmpire(otherEmpire, otherEmpire, EmpireMessageType.ColonyFacilityCompleted, byId, description4);
                            }
                        }
                    }
                }
                // C# Empire.TrackedWonders: a completing wonder is always on an owned colony.
                const owner = habitat.empire!;
                if (owner.trackedWonders === null) owner.trackedWonders = [];
                trackedWondersAddUpdateBuildDate(owner.trackedWonders, habitat, planetaryFacility.planetaryFacilityDefinitionId, galaxyStarDate(galaxy));
                doCharacterEventForList(galaxy, CharacterEventType.BuildWonder, planetaryFacility, characters, true, habitat.empire);
            } else {
                doCharacterEventForList(galaxy, CharacterEventType.BuildFacility, planetaryFacility, characters, true, habitat.empire);
            }
        } else {
            num = 0;
        }
        if (num <= 0) break;
    }
    if (flag && habitat.empire !== null) {
        reviewPlanetaryFacilities(galaxy, habitat, habitat.empire);
        refreshColonyFacilityInfo(galaxy, habitat.empire);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Empire facility helpers
// ---------------------------------------------------------------------------------------------------------------

/** Empire.4.cs 3360 IdentifyEmpireRegionalCapitals(includeUnderConstruction = false). */
export function identifyEmpireRegionalCapitals(empire: Empire, includeUnderConstruction = false): Habitat[] {
    const habitatList: Habitat[] = [];
    const colonies = empire.colonies;
    if (colonies !== null) {
        for (let i = 0; i < colonies.length; i++) {
            const facilities = colonies[i].facilities;
            if (colonies[i] === empire.capital || colonies[i].hasBeenDestroyed || facilities === null || facilities.length <= 0) continue;
            for (let j = 0; j < facilities.length; j++) {
                if (facilities[j].type === PlanetaryFacilityType.RegionalCapital && (includeUnderConstruction || facilities[j].constructionProgress >= 1)) {
                    habitatList.push(colonies[i]);
                    break;
                }
            }
        }
    }
    return habitatList;
}

/** Empire.4.cs 3340 IdentifyEmpireCapitals. */
export function identifyEmpireCapitalsWithRegional(empire: Empire): Habitat[] {
    const habitatList: Habitat[] = [];
    if (empire.capital !== null && !empire.capital.hasBeenDestroyed) habitatList.push(empire.capital);
    const habitatList2 = identifyEmpireRegionalCapitals(empire);
    if (habitatList2 !== null && habitatList2.length > 0) habitatList.push(...habitatList2);
    return habitatList;
}

/** Empire.4.cs 3384 RecalculateColonyDistancesFromCapital. */
export function recalculateColonyDistancesFromCapital(galaxy: Galaxy, empire: Empire): void {
    const empireCapitals = identifyEmpireCapitalsWithRegional(empire);
    if (empire.colonies !== null && empire.colonies.length > 0) {
        for (let i = 0; i < empire.colonies.length; i++) {
            recalculateDistanceFactorWithCapitals(galaxy, empire.colonies[i], empireCapitals);
        }
    }
}

/** Empire.3.cs 837/842 CountFacilities(facilityType, mustBeCompleted = false). */
export function countFacilities(empire: Empire, type: PlanetaryFacilityType, mustBeCompleted = false): number {
    let num = 0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat !== null && habitat.facilities !== null) {
            num = !mustBeCompleted ? num + facilitiesCountByType(habitat.facilities, type) : num + facilitiesCountCompletedByType(habitat.facilities, type);
        }
    }
    return num;
}

/** Empire.3.cs 884 DetermineFacilityColonies(facilityType). */
export function determineFacilityColonies(empire: Empire, type: PlanetaryFacilityType): Habitat[] {
    const habitatList: Habitat[] = [];
    for (let i = 0; i < empire.colonies.length; i++) {
        let num = 0;
        const facilities = empire.colonies[i].facilities;
        if (facilities !== null) num = Math.max(num, facilitiesCountByType(facilities, type));
        if (num > 0) habitatList.push(empire.colonies[i]);
    }
    return habitatList;
}

/** Empire.3.cs 902 DetermineTroopFacilityColonies. */
export function determineTroopFacilityColonies(empire: Empire): Habitat[] {
    const habitatList: Habitat[] = [];
    for (let i = 0; i < empire.colonies.length; i++) {
        let num = 0;
        const facilities = empire.colonies[i].facilities;
        if (facilities !== null) {
            num = Math.max(num, facilitiesCountByType(facilities, PlanetaryFacilityType.CloningFacility));
            num = Math.max(num, facilitiesCountByType(facilities, PlanetaryFacilityType.RoboticTroopFoundry));
            num = Math.max(num, facilitiesCountByType(facilities, PlanetaryFacilityType.TroopTrainingCenter));
        }
        if (num > 0) habitatList.push(empire.colonies[i]);
    }
    return habitatList;
}

/** Empire.2.cs 2871 CountPirateCriminalNetworks. */
export function countPirateCriminalNetworks(galaxy: Galaxy, empire: Empire): number {
    let num = 0;
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat === null || habitat.hasBeenDestroyed || habitat.facilities === null || habitat.facilities.length <= 0) continue;
        if (habitat.empire === empire) {
            num += facilitiesCountByType(habitat.facilities, PlanetaryFacilityType.PirateCriminalNetwork);
            continue;
        }
        const byFacilityControl = habitatPirateControlByFacilityControl(galaxy, habitat);
        if (byFacilityControl !== null && byFacilityControl.empireId === empire.empireId) {
            num += facilitiesCountByType(habitat.facilities, PlanetaryFacilityType.PirateCriminalNetwork);
        }
    }
    return num;
}

/** Empire.3.cs 4106 CalculateAccurateAnnualCashflowIncludingUnderConstruction(out annualEmpireExpenses). */
export function calculateAccurateAnnualCashflowIncludingUnderConstruction(galaxy: Galaxy, empire: Empire): { cashflow: number; annualEmpireExpenses: number } {
    let annualEmpireExpenses = 0.0;
    if (empire.pirateEmpireBaseHabitat !== null) {
        return { cashflow: calculatePirateCashflow(galaxy, empire, true), annualEmpireExpenses };
    }
    annualEmpireExpenses = annualStateMaintenance(empire) + annualTroopMaintenanceIncludeRecruiting(empire) + annualSubjugationTribute(galaxy, empire) + annualPirateProtection(empire) + annualFacilityMaintenance(empire);
    const num = annualTaxRevenue(galaxy, empire) + calculateAnnualSubjugationTributeIncome(galaxy, empire);
    const government = empireGovernmentAttributes(empire);
    if (government !== null && government.specialFunctionCode === 1) {
        annualEmpireExpenses += annualPrivateMaintenance(empire);
    }
    return { cashflow: num - annualEmpireExpenses, annualEmpireExpenses };
}

/** Empire.10.cs 3555/3560 GenerateAutomationMessageColonyFacility(colony, facility, haveFunds = true) — advisor text. */
export function generateAutomationMessageColonyFacility(galaxy: Galaxy, colony: Habitat, facility: Facility, haveFunds = true): string {
    const habitat = galaxy.determineHabitatSystemStar(colony);
    // TODO(port) M9: the per-type advisor / explanation GameText (Empire.10.cs 3562-3640); only the player reads it.
    return gameText(haveFunds ? 'Automation Colony Facility' : 'Automation Colony Facility No Funds', facility.name, colony.name, habitat.name);
}

// ---------------------------------------------------------------------------------------------------------------
// Empire facility AI (tick entry points)
// ---------------------------------------------------------------------------------------------------------------

/** Empire.3.cs 104 RefreshColonyFacilityInfo. */
export function refreshColonyFacilityInfo(galaxy: Galaxy, empire: Empire): void {
    empire.capitals = identifyEmpireCapitalsWithRegional(empire);
    empire.capitalSystemStars.length = 0;
    for (let i = 0; i < empire.capitals.length; i++) {
        empire.capitalSystemStars.push(galaxy.determineHabitatSystemStar(empire.capitals[i]));
    }
}

/** HabitatList.Sort() + Reverse() (Habitat.CompareTo: strategic value, then population). */
export function sortedHabitatsDescending(colonies: readonly Habitat[]): Habitat[] {
    const habitatList = colonies.slice();
    netSort(habitatList, habitatCompareTo);
    habitatList.reverse();
    return habitatList;
}

/** Empire.3.cs 254 PirateReviewColonyFacilities. */
export function pirateReviewColonyFacilities(galaxy: Galaxy, empire: Empire): void {
    const defs = planetaryFacilityDefinitionsStatic(galaxy);
    const planetaryFacilityDefinition = definitionsFindFacilityByType(defs, PlanetaryFacilityType.PirateBase);
    const planetaryFacilityDefinition2 = definitionsFindFacilityByType(defs, PlanetaryFacilityType.PirateFortress);
    const planetaryFacilityDefinition3 = definitionsFindFacilityByType(defs, PlanetaryFacilityType.PirateCriminalNetwork);
    const refusalCount: RefCount = { value: 0 };
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat === null) continue;
        let flag = false;
        let pirateColonyControl = habitatPirateControlByFacilityControl(galaxy, habitat);
        if (pirateColonyControl !== null && pirateColonyControl.empireId === empire.empireId) {
            flag = true;
        } else {
            pirateColonyControl = habitatPirateControlHighest(galaxy, habitat);
            if (pirateColonyControl !== null && pirateColonyControl.empireId === empire.empireId && pirateColonyControl.controlLevel >= 0.5) {
                flag = true;
            }
        }
        if (!flag || pirateColonyControl === null) continue;
        const control = pirateColonyControl;
        if (habitat.facilities === null) habitat.facilities = [];
        const facilities = habitat.facilities;
        // One C# block per facility kind (same shape): funds check, authorisation, queue, pay.
        const tryQueue = (def: Facility | null, type: PlanetaryFacilityType): void => {
            const cost = calculatePlanetaryFacilityCost(def, empire);
            let haveFunds = false;
            if (empire.stateMoney >= cost) haveFunds = true;
            if (!haveFunds) {
                checkTaskAuthorized(galaxy, empire, empire.controlColonyFacilities, refusalCount, generateAutomationMessageColonyFacility(galaxy, habitat, def!, false), habitat, AdvisorMessageType.ColonyFacility, null, def, null);
            } else if (checkTaskAuthorized(galaxy, empire, empire.controlColonyFacilities, refusalCount, generateAutomationMessageColonyFacility(galaxy, habitat, def!), habitat, AdvisorMessageType.ColonyFacility, null, def, null) && queueFacilityConstruction(galaxy, habitat, type)) {
                empire.stateMoney -= cost;
                pirateEconomyPerformExpense(galaxy, empire, cost, PirateExpenseType.FacilityConstruction, galaxyStarDate(galaxy));
                control.hasFacilityControl = true;
            }
        };
        if (control.controlLevel >= 1) {
            if (facilitiesCountByType(facilities, PlanetaryFacilityType.PirateBase) <= 0) {
                tryQueue(planetaryFacilityDefinition, PlanetaryFacilityType.PirateBase);
            } else if (facilitiesCountByType(facilities, PlanetaryFacilityType.PirateFortress) <= 0 && facilitiesCountCompletedByType(facilities, PlanetaryFacilityType.PirateBase) > 0) {
                tryQueue(planetaryFacilityDefinition2, PlanetaryFacilityType.PirateFortress);
            } else {
                if (facilitiesCountCompletedByType(facilities, PlanetaryFacilityType.PirateFortress) <= 0) continue;
                // C# evaluates the funds flag before CountPirateCriminalNetworks; neither has side effects.
                if (countPirateCriminalNetworks(galaxy, empire) > 0) continue;
                tryQueue(planetaryFacilityDefinition3, PlanetaryFacilityType.PirateCriminalNetwork);
            }
        } else {
            if (facilitiesCountByType(facilities, PlanetaryFacilityType.PirateBase) > 0) continue;
            tryQueue(planetaryFacilityDefinition, PlanetaryFacilityType.PirateBase);
        }
    }
}

/** Empire.3.cs 395 ReviewColonyFacilities. */
export function reviewColonyFacilities(galaxy: Galaxy, empire: Empire): void {
    const policy = empire.policy!;
    const planetaryFacilityDefinitionList = empire.research.buildablePlanetaryFacilities.slice();
    const planetaryFacilityDefinitionList2: Facility[] = [];
    for (let i = 0; i < planetaryFacilityDefinitionList.length; i++) {
        let allowed = true;
        switch (facilityType(planetaryFacilityDefinitionList[i])) {
            case PlanetaryFacilityType.ArmoredFactory: allowed = policy.colonyAllowFacilityArmoredFactory; break;
            case PlanetaryFacilityType.SpyAcademy: allowed = policy.colonyAllowFacilitySpyAcademy; break;
            case PlanetaryFacilityType.ScienceAcademy: allowed = policy.colonyAllowFacilityScienceAcademy; break;
            case PlanetaryFacilityType.NavalAcademy: allowed = policy.colonyAllowFacilityNavalAcademy; break;
            case PlanetaryFacilityType.MilitaryAcademy: allowed = policy.colonyAllowFacilityMilitaryAcademy; break;
            case PlanetaryFacilityType.CloningFacility: allowed = policy.colonyAllowFacilityCloningFacility; break;
            case PlanetaryFacilityType.FortifiedBunker: allowed = policy.colonyAllowFacilityFortifiedBunker; break;
            case PlanetaryFacilityType.IonCannon: allowed = policy.colonyAllowFacilityGiantIonCannon; break;
            case PlanetaryFacilityType.PlanetaryShield: allowed = policy.colonyAllowFacilityPlanetaryShield; break;
            case PlanetaryFacilityType.RegionalCapital: allowed = policy.colonyAllowFacilityRegionalCapital; break;
            case PlanetaryFacilityType.RoboticTroopFoundry: allowed = policy.colonyAllowFacilityRoboticTroopFoundry; break;
            case PlanetaryFacilityType.TroopTrainingCenter: allowed = policy.colonyAllowFacilityTroopTrainingCenter; break;
            case PlanetaryFacilityType.TerraformingFacility: allowed = policy.colonyAllowFacilityTerraformingFacility; break;
        }
        if (!allowed) planetaryFacilityDefinitionList2.push(planetaryFacilityDefinitionList[i]);
    }
    for (let j = 0; j < planetaryFacilityDefinitionList2.length; j++) listRemove(planetaryFacilityDefinitionList, planetaryFacilityDefinitionList2[j]);
    const refusalCount: RefCount = { value: 0 };
    const authorized = (colony: Habitat, def: Facility): boolean =>
        checkTaskAuthorized(galaxy, empire, empire.controlColonyFacilities, refusalCount, generateAutomationMessageColonyFacility(galaxy, colony, def), colony, AdvisorMessageType.ColonyFacility, null, def, null);
    const cost = (def: Facility | null): number => calculatePlanetaryFacilityCost(def, empire);
    let num = calculateAccurateAnnualCashflowIncludingUnderConstruction(galaxy, empire).cashflow;
    // 485-527: regional capitals.
    const habitatList = identifyEmpireRegionalCapitals(empire, true);
    const planetaryFacilityDefinition = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.RegionalCapital);
    const num2 = definitionsCountByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.RegionalCapital);
    const num3 = cost(planetaryFacilityDefinition);
    if (habitatList.length < num2 && planetaryFacilityDefinition !== null && empire.stateMoney >= num3 && num > planetaryFacilityDefinition.maintenanceCost) {
        habitatList.push(empire.capital!);
        const habitatList2: Habitat[] = [];
        for (let k = 0; k < empire.colonies.length; k++) {
            if (!habitatList.includes(empire.colonies[k]) && empire.colonies[k].population !== null && empire.colonies[k].population.totalAmount >= policy.colonyFacilityPopulationThresholdRegionalCapital * 1000000) {
                habitatList2.push(empire.colonies[k]);
            }
        }
        netSort(habitatList2, habitatCompareTo);
        habitatList2.reverse();
        let habitat: Habitat | null = null;
        const num4 = galaxy.sectorSize * 0.7;
        for (let l = 0; l < habitatList2.length && strategicValue(habitatList2[l]) >= 100000; l++) {
            let flag = true;
            for (let m = 0; m < habitatList.length; m++) {
                const num5 = galaxy.calculateDistance(habitatList2[l].xpos, habitatList2[l].ypos, habitatList[m].xpos, habitatList[m].ypos);
                if (num5 < num4) {
                    flag = false;
                    break;
                }
            }
            if (flag) {
                habitat = habitatList2[l];
                break;
            }
        }
        if (habitat !== null && empire.stateMoney >= num3 && authorized(habitat, planetaryFacilityDefinition) && queueFacilityConstruction(galaxy, habitat, PlanetaryFacilityType.RegionalCapital)) {
            empire.stateMoney -= num3;
            num -= planetaryFacilityDefinition.maintenanceCost;
        }
    }
    // 528-545: terraforming.
    const planetaryFacilityDefinition2 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.TerraformingFacility);
    if (planetaryFacilityDefinition2 !== null) {
        const num6 = cost(planetaryFacilityDefinition2);
        for (let n = 0; n < empire.colonies.length; n++) {
            const habitat2 = empire.colonies[n];
            if (habitat2 !== null && !habitat2.hasBeenDestroyed && habitat2.population !== null) {
                const totalAmount = habitat2.population.totalAmount;
                if (
                    totalAmount >= policy.colonyFacilityPopulationThresholdTerraformingFacility * 1000000 &&
                    empire.stateMoney > num6 * 2.5 &&
                    num > planetaryFacilityDefinition2.maintenanceCost &&
                    habitat2.damage > 0 &&
                    facilitiesCountByType(habitat2.facilities!, PlanetaryFacilityType.TerraformingFacility) <= 0 &&
                    authorized(habitat2, planetaryFacilityDefinition2) &&
                    queueFacilityConstruction(galaxy, habitat2, PlanetaryFacilityType.TerraformingFacility)
                ) {
                    empire.stateMoney -= num6;
                    num -= planetaryFacilityDefinition2.maintenanceCost;
                }
            }
        }
    }
    // 546-654: shields, ion cannons, academies.
    const habitatList3 = sortedHabitatsDescending(empire.colonies);
    const planetaryFacilityDefinition3 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.PlanetaryShield);
    const planetaryFacilityDefinition4 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.IonCannon);
    const planetaryFacilityDefinition5 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.SpyAcademy);
    const planetaryFacilityDefinition6 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.ScienceAcademy);
    const planetaryFacilityDefinition7 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.NavalAcademy);
    let num7 = 0.0;
    let num8 = 0.0;
    if (planetaryFacilityDefinition5 !== null) {
        num7 = cost(planetaryFacilityDefinition5);
        num8 = planetaryFacilityDefinition5.maintenanceCost;
    } else if (planetaryFacilityDefinition6 !== null) {
        num7 = cost(planetaryFacilityDefinition6);
        num8 = planetaryFacilityDefinition6.maintenanceCost;
    } else if (planetaryFacilityDefinition7 !== null) {
        num7 = cost(planetaryFacilityDefinition7);
        num8 = planetaryFacilityDefinition7.maintenanceCost;
    } else if (planetaryFacilityDefinition3 !== null) {
        num7 = cost(planetaryFacilityDefinition3);
        num8 = planetaryFacilityDefinition3.maintenanceCost;
    } else if (planetaryFacilityDefinition4 !== null) {
        num7 = cost(planetaryFacilityDefinition4);
        num8 = planetaryFacilityDefinition4.maintenanceCost;
    }
    if (num7 > 0.0) {
        let num9 = 1;
        const num10 = !(policy.researchPriority < 1.0) ? (policy.researchPriority < 1.5 ? 1 : !(policy.researchPriority < 2.0) ? 3 : 2) : 0;
        let num11 = 1;
        switch (policy.constructionMilitary) {
            case 0: num11 = 0; break;
            case 1: num11 = 1; break;
            case 2: num11 = 2; break;
        }
        if (empire.dominantRace !== null && empire.dominantRace.espionageBonus > 0) num9 = 2;
        let num12 = countFacilities(empire, PlanetaryFacilityType.SpyAcademy);
        let num13 = countFacilities(empire, PlanetaryFacilityType.ScienceAcademy);
        let num14 = countFacilities(empire, PlanetaryFacilityType.NavalAcademy);
        for (let num15 = 0; num15 < habitatList3.length; num15++) {
            const h = habitatList3[num15];
            if (empire.stateMoney > num7 * 2.5 && num > num8 && strategicValue(h) > 200000) {
                let num16 = 0;
                let num17 = 0;
                let num18 = 0;
                let num19 = 0;
                let num20 = 0;
                if (h.facilities !== null) {
                    num16 = facilitiesCountByType(h.facilities, PlanetaryFacilityType.PlanetaryShield);
                    num17 = facilitiesCountByType(h.facilities, PlanetaryFacilityType.IonCannon);
                    num18 = facilitiesCountByType(h.facilities, PlanetaryFacilityType.SpyAcademy);
                    num19 = facilitiesCountByType(h.facilities, PlanetaryFacilityType.ScienceAcademy);
                    num20 = facilitiesCountByType(h.facilities, PlanetaryFacilityType.NavalAcademy);
                }
                const popAtLeast = (thresholdMillions: number): boolean => h.population !== null && h.population.totalAmount >= thresholdMillions * 1000000;
                if (planetaryFacilityDefinition3 !== null && num16 <= 0 && empire.stateMoney > cost(planetaryFacilityDefinition3) && num > planetaryFacilityDefinition3.maintenanceCost && popAtLeast(policy.colonyFacilityPopulationThresholdPlanetaryShield) && authorized(h, planetaryFacilityDefinition3) && queueFacilityConstruction(galaxy, h, PlanetaryFacilityType.PlanetaryShield)) {
                    empire.stateMoney -= cost(planetaryFacilityDefinition3);
                    num -= planetaryFacilityDefinition3.maintenanceCost;
                }
                if (planetaryFacilityDefinition4 !== null && num17 <= 0 && empire.stateMoney > cost(planetaryFacilityDefinition4) && num > planetaryFacilityDefinition4.maintenanceCost && popAtLeast(policy.colonyFacilityPopulationThresholdGiantIonCannon) && authorized(h, planetaryFacilityDefinition4) && queueFacilityConstruction(galaxy, h, PlanetaryFacilityType.IonCannon)) {
                    empire.stateMoney -= cost(planetaryFacilityDefinition4);
                    num -= planetaryFacilityDefinition4.maintenanceCost;
                }
                if (planetaryFacilityDefinition5 !== null && num18 <= 0 && num12 < num9 && empire.stateMoney > cost(planetaryFacilityDefinition5) && num > planetaryFacilityDefinition5.maintenanceCost && popAtLeast(policy.colonyFacilityPopulationThresholdSpyAcademy) && authorized(h, planetaryFacilityDefinition5) && queueFacilityConstruction(galaxy, h, PlanetaryFacilityType.SpyAcademy)) {
                    empire.stateMoney -= cost(planetaryFacilityDefinition5);
                    num -= planetaryFacilityDefinition5.maintenanceCost;
                    num12++;
                }
                if (planetaryFacilityDefinition6 !== null && num19 <= 0 && num13 < num10 && empire.stateMoney > cost(planetaryFacilityDefinition6) && num > planetaryFacilityDefinition6.maintenanceCost && popAtLeast(policy.colonyFacilityPopulationThresholdScienceAcademy) && authorized(h, planetaryFacilityDefinition6) && queueFacilityConstruction(galaxy, h, PlanetaryFacilityType.ScienceAcademy)) {
                    empire.stateMoney -= cost(planetaryFacilityDefinition6);
                    num -= planetaryFacilityDefinition6.maintenanceCost;
                    num13++;
                }
                if (planetaryFacilityDefinition7 !== null && num20 <= 0 && num14 < num11 && empire.stateMoney > cost(planetaryFacilityDefinition7) && num > planetaryFacilityDefinition7.maintenanceCost && popAtLeast(policy.colonyFacilityPopulationThresholdNavalAcademy) && authorized(h, planetaryFacilityDefinition7) && queueFacilityConstruction(galaxy, h, PlanetaryFacilityType.NavalAcademy)) {
                    empire.stateMoney -= cost(planetaryFacilityDefinition7);
                    num -= planetaryFacilityDefinition7.maintenanceCost;
                    num14++;
                }
            }
        }
    }
    // 655-688: fortified bunkers.
    const planetaryFacilityDefinition8 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.FortifiedBunker);
    if (planetaryFacilityDefinition8 !== null) {
        const stellarObjectList = resolveLocationsToDefend(galaxy, empire, false);
        for (let num21 = 0; num21 < empire.colonies.length; num21++) {
            const c = empire.colonies[num21];
            if (!(empire.stateMoney > cost(planetaryFacilityDefinition8)) || !(num > planetaryFacilityDefinition8.maintenanceCost)) continue;
            let num22 = 0;
            if (c.facilities !== null) num22 = facilitiesCountByType(c.facilities, PlanetaryFacilityType.FortifiedBunker);
            if (num22 > 0) continue;
            const popOk = (): boolean => c.population !== null && c.population.totalAmount >= policy.colonyFacilityPopulationThresholdFortifiedBunker * 1000000;
            if ((stellarObjectList as unknown[]).includes(c) && popOk()) {
                if (authorized(c, planetaryFacilityDefinition8) && queueFacilityConstruction(galaxy, c, PlanetaryFacilityType.FortifiedBunker)) {
                    empire.stateMoney -= cost(planetaryFacilityDefinition8);
                    num -= planetaryFacilityDefinition8.maintenanceCost;
                }
            } else if (determineSpacePortAtColony(galaxy, c) !== null && galaxy.rnd.next(0, 2) === 1 && popOk() && authorized(c, planetaryFacilityDefinition8) && queueFacilityConstruction(galaxy, c, PlanetaryFacilityType.FortifiedBunker)) {
                empire.stateMoney -= cost(planetaryFacilityDefinition8);
                num -= planetaryFacilityDefinition8.maintenanceCost;
            }
        }
    }
    // 689-755: troop facilities.
    const planetaryFacilityDefinition9 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.TroopTrainingCenter);
    const planetaryFacilityDefinition10 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.RoboticTroopFoundry);
    const planetaryFacilityDefinition11 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.CloningFacility);
    let planetaryFacilityDefinition12: Facility | null = null;
    // C# reads DominantRace.TroopStrength unguarded (every empire running this has a dominant race).
    const num23 = resolveEmpireRaceTendency(empire.dominantRace!);
    const num24: number = empire.dominantRace!.troopStrength;
    let num25 = 0;
    if (num23 === 2 || num24 < 100.0) {
        planetaryFacilityDefinition12 = planetaryFacilityDefinition10;
        num25 = policy.colonyFacilityPopulationThresholdRoboticTroopFoundry * 1000000;
    } else if (num23 === 1 || num24 > 125.0) {
        if (planetaryFacilityDefinition11 !== null) {
            planetaryFacilityDefinition12 = planetaryFacilityDefinition11;
            num25 = policy.colonyFacilityPopulationThresholdCloningFacility * 1000000;
        } else {
            planetaryFacilityDefinition12 = planetaryFacilityDefinition9;
            num25 = policy.colonyFacilityPopulationThresholdTroopTrainingCenter * 1000000;
        }
    } else if (num23 === 3) {
        planetaryFacilityDefinition12 = planetaryFacilityDefinition9;
        num25 = policy.colonyFacilityPopulationThresholdTroopTrainingCenter * 1000000;
    } else {
        planetaryFacilityDefinition12 = planetaryFacilityDefinition9;
        num25 = policy.colonyFacilityPopulationThresholdTroopTrainingCenter * 1000000;
    }
    num7 = 0.0;
    num8 = 0.0;
    if (planetaryFacilityDefinition12 !== null) {
        num7 = cost(planetaryFacilityDefinition12);
        num8 = planetaryFacilityDefinition12.maintenanceCost;
    }
    const habitatList4 = determineTroopFacilityColonies(empire);
    let num26 = habitatList4.length;
    const num27 = Math.max(1, Math.trunc(empire.colonies.length / 7));
    if (num26 < num27 && num7 > 0.0 && empire.stateMoney > num7 && num > num8) {
        for (let num28 = 0; num28 < empire.colonies.length; num28++) {
            const c = empire.colonies[num28];
            if (c.population !== null && c.population.totalAmount > num25 && empireApprovalRating(galaxy, c) >= 10.0) {
                let num29 = 0;
                if (c.facilities !== null) {
                    num29 = Math.max(num29, facilitiesCountByType(c.facilities, PlanetaryFacilityType.CloningFacility));
                    num29 = Math.max(num29, facilitiesCountByType(c.facilities, PlanetaryFacilityType.RoboticTroopFoundry));
                    num29 = Math.max(num29, facilitiesCountByType(c.facilities, PlanetaryFacilityType.TroopTrainingCenter));
                }
                if (num29 <= 0 && empire.stateMoney > num7 && num > num8 && authorized(c, planetaryFacilityDefinition12!) && queueFacilityConstruction(galaxy, c, facilityType(planetaryFacilityDefinition12!))) {
                    empire.stateMoney -= num7;
                    num -= num8;
                    num26++;
                }
            }
        }
    }
    // 756-782: armored factories.
    const planetaryFacilityDefinition13 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.ArmoredFactory);
    const habitatList5 = determineFacilityColonies(empire, PlanetaryFacilityType.ArmoredFactory);
    let num30 = habitatList5.length;
    let num31 = Math.max(1, Math.trunc(empire.colonies.length / 8));
    num31 = policy.troopRecruitArmorLevel < 1.0 ? Math.max(1, Math.trunc(num31 * 0.5)) : !(policy.troopRecruitArmorLevel < 1.5) ? Math.max(1, Math.trunc(num31 * 1.5)) : Math.max(1, Math.trunc(num31 * 1.0));
    if (planetaryFacilityDefinition13 !== null && num30 < num31 && cost(planetaryFacilityDefinition13) > 0.0 && empire.stateMoney > cost(planetaryFacilityDefinition13) && num > planetaryFacilityDefinition13.maintenanceCost) {
        num25 = policy.colonyFacilityPopulationThresholdArmoredFactory * 1000000;
        for (let num32 = 0; num32 < habitatList3.length; num32++) {
            const habitat3 = habitatList3[num32];
            if (habitat3.population !== null && habitat3.population.totalAmount > num25 && num30 < num31) {
                let num33 = 0;
                if (habitat3.facilities !== null) num33 = facilitiesCountByType(habitat3.facilities, PlanetaryFacilityType.ArmoredFactory);
                if (num33 <= 0 && empire.stateMoney > cost(planetaryFacilityDefinition13) && num > planetaryFacilityDefinition13.maintenanceCost && authorized(habitat3, planetaryFacilityDefinition13) && queueFacilityConstruction(galaxy, habitat3, facilityType(planetaryFacilityDefinition13))) {
                    empire.stateMoney -= cost(planetaryFacilityDefinition13);
                    num -= planetaryFacilityDefinition13.maintenanceCost;
                    num30++;
                }
            }
        }
    }
    // 783-816: military academies.
    const planetaryFacilityDefinition14 = definitionsFindFacilityByType(planetaryFacilityDefinitionList, PlanetaryFacilityType.MilitaryAcademy);
    const habitatList6 = determineFacilityColonies(empire, PlanetaryFacilityType.MilitaryAcademy);
    let num34 = habitatList6.length;
    const num35 = !(policy.troopGarrisonLevel < 0.5) ? (policy.troopGarrisonLevel < 1.0 ? 1 : !(policy.troopGarrisonLevel < 1.5) ? 3 : 2) : 0;
    if (planetaryFacilityDefinition14 === null || num34 >= num35 || !(cost(planetaryFacilityDefinition14) > 0.0) || !(empire.stateMoney > cost(planetaryFacilityDefinition14)) || !(num > planetaryFacilityDefinition14.maintenanceCost)) {
        return;
    }
    num25 = policy.colonyFacilityPopulationThresholdMilitaryAcademy * 1000000;
    for (let num36 = 0; num36 < habitatList3.length; num36++) {
        const habitat4 = habitatList3[num36];
        if (habitat4.population !== null && habitat4.population.totalAmount > num25 && num34 < num35) {
            let num37 = 0;
            if (habitat4.facilities !== null) num37 = facilitiesCountByType(habitat4.facilities, PlanetaryFacilityType.MilitaryAcademy);
            if (num37 <= 0 && empire.stateMoney > cost(planetaryFacilityDefinition14) && num > planetaryFacilityDefinition14.maintenanceCost && authorized(habitat4, planetaryFacilityDefinition14) && queueFacilityConstruction(galaxy, habitat4, facilityType(planetaryFacilityDefinition14))) {
                empire.stateMoney -= cost(planetaryFacilityDefinition14);
                num -= planetaryFacilityDefinition14.maintenanceCost;
                num34++;
            }
        }
    }
}
