// M4h — construction queues: ConstructionQueue.cs (1,411) and BaconConstructionQueue.cs (ReviewConstructionSpeed,
// ConstructionSpeedMultiplier, MoveCargoFromBuilderToBuiltBase), plus the small callees only construction uses:
// EmpireCounters.ProcessBuiltObjectConstruction, Galaxy.2.cs ChanceNewFleetAdmiralFromConstruction, Empire.7.cs
// CanBuiltObjectColonizeHabitat / CalculateColonizationPopulation, ResearchSystem
// SelectRandomNextResearchProjectExcludeSuperWeapons.
//
// Rnd (in C# call order): DoConstruction draws Rnd.Next(0, yards) once per call (1203); a completed build / retrofit
// draws in SelectRelativeParkingPoint (3 draws, via the Move mission), DoCharacterEvent (M4u) and
// ChanceNewFleetAdmiralFromConstruction; research bonuses draw in SelectRandomNextResearchProjectExcludeSuperWeapons and
// the scrap message Rnd.Next(0, 5).
//
// Time: `_LastProcessed` and `tempNow` are sim ms (tick/simTime.ts); TimeSpan.TotalMilliseconds = the ms difference.

import { checkTriggerEvent, getMatchingGameEventIdPlanetDestroyerConstructionCompleted } from '../story/eventActions';
import { EventTriggerType } from '../story/gameEventModel';
import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Race } from '../data/races';
import type { Design } from '../design';
import { HabitatCategoryType, HabitatType, type Habitat } from '../types';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectComponent, ComponentStatus, csInt } from '../builtObjectComponent';
import { Cargo, CargoList, ResourceRef } from '../cargo';
import { ComponentType } from '../data/components';
import type { ComponentCategoryType } from '../data/policies';
import type { ComponentDefinition } from '../componentStatic';
import { ColonyResourceEffect, resourceBonusTotalByEffectType } from '../developmentLevel';
import {
    Character,
    CharacterEventType,
    CharacterRole,
    CharacterSkillType,
    doCharacterEventForList,
    generateNewCharacter,
    getHighestSkillLevel,
    getHighestSkillLevelExcludeLeaders,
    stellarObjectCharacters,
} from '../characters';
import { charactersCanGenerateAmountNonIntelligenceAgent } from '../troops';
import { PlanetaryFacilityType, WonderType, getProjectsByCategory, findNodeById, type TechNode } from '../researchSystem';
import { doResearchBreakthrough } from '../researchTick';
import { EmpireMessageType, resolveDescription, sendMessageToEmpire, sendMessageToEmpireWithTitle } from '../messages';
import { assignMission, clearPreviousMissionRequirements } from '../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, builtObjectMission } from '../missions/mission';
import { checkSendPreWarpProgressEventMessage } from '../events';
import { PreWarpProgressEventType } from '../exploration';
import { scanForNewOwnerBuiltObject } from '../combat/invasion';
import { builtObjectCompleteTeardown } from '../combat/teardown';
import { assignFleetWaypointMission } from '../fleets/shipGroup';
import { canBuildBuiltObject } from '../forceStructure';
import { galaxyStarDate } from '../tick/simTime';
import { researchComponentTechPoints } from '../designGeneration';
import {
    ConstructionYard,
    componentListDiff,
    findNextBuiltComponent,
    findNextUnbuiltComponent,
    indexByIdAndStatus,
    registerConstructionQueueFactory,
    resolveComponentList,
    yardsIndexOfComponent,
    yardsIndexOfShip,
} from './constructionYard';
import { formatGameTextNow } from '../textResolver';
import { scenarioEmit } from '../scenario/hooks';

/** Galaxy.3.cs 5086 ColonyShipBuildFactor = 10.0. */
export const COLONY_SHIP_BUILD_FACTOR = 10.0;
/** Galaxy.3.cs 5119 AdvancedTechBonusFactor = 200.0. */
export const ADVANCED_TECH_BONUS_FACTOR = 200.0;
/** Galaxy.3.cs 5120 ColonyBuildSpeedIdealPopulation = 10000000000.0. */
export const COLONY_BUILD_SPEED_IDEAL_POPULATION = 10000000000.0;
/** Galaxy.3.cs 5135 ColonyShipBuildSpeedRateDefault = 1.0. */
const COLONY_SHIP_BUILD_SPEED_RATE_DEFAULT = 1.0;
/** BaconConstructionQueue.cs 14 myConstructionSpeedMultiplier = 5.0. */
const BACON_MY_CONSTRUCTION_SPEED_MULTIPLIER = 5.0;

/** TextResolver.GetText(key) + string.Format(args): the key and arguments (full text in M9, as colonyTick.ts). */
function gameText(key: string, ...args: unknown[]): string {
    return args.length > 0 ? `${key}|${args.map((a) => String(a)).join('|')}` : key;
}

// ---------------------------------------------------------------------------------------------------------------
// Race properties the TS Race data does not model (Race.cs)
// ---------------------------------------------------------------------------------------------------------------

/** Race.cs ParseDoubleValue for a Race.extra key (fallback when absent). */
function raceExtraDouble(race: Race, key: string, fallback: number): number {
    const raw = race.extra?.[key];
    if (raw === undefined) return fallback;
    return Number(raw.trim());
}

/** Race.cs 131 ConstructionSpeedModifier = 1.0 ("ConstructionSpeedFactor", clamped to [0.3, 5.5], Race.cs 1400). */
export function raceConstructionSpeedModifier(race: Race): number {
    if (race.extra?.['ConstructionSpeedFactor'] === undefined) return 1.0;
    return Math.max(0.3, Math.min(raceExtraDouble(race, 'ConstructionSpeedFactor', 1.0), 5.5));
}

/** Race.cs 198-208 ColonyConstructionSpeedFactor<Type> = 1.0 (clamped to [0.2, 5.0], Race.cs 1474-1492). */
function raceColonyConstructionSpeedFactor(race: Race, type: 'Volcanic' | 'Desert' | 'MarshySwamp' | 'Continental' | 'Ocean' | 'Ice'): number {
    const key = `ColonyConstructionSpeedFactor${type}`;
    if (race.extra?.[key] === undefined) return 1.0;
    return Math.min(5.0, Math.max(0.2, raceExtraDouble(race, key, 1.0)));
}

/** The race factor switch of BaconConstructionQueue.ReviewConstructionSpeed (habitat type → factor, 1.0 otherwise). */
function raceColonyConstructionFactorForType(race: Race, habitatType: HabitatType): number {
    switch (habitatType) {
        case HabitatType.Volcanic: return raceColonyConstructionSpeedFactor(race, 'Volcanic');
        case HabitatType.Desert: return raceColonyConstructionSpeedFactor(race, 'Desert');
        case HabitatType.MarshySwamp: return raceColonyConstructionSpeedFactor(race, 'MarshySwamp');
        case HabitatType.Continental: return raceColonyConstructionSpeedFactor(race, 'Continental');
        case HabitatType.Ocean: return raceColonyConstructionSpeedFactor(race, 'Ocean');
        case HabitatType.Ice: return raceColonyConstructionSpeedFactor(race, 'Ice');
        default: return 1.0;
    }
}

/**
 * The Value2 of each completed ColonyConstructionSpeed wonder of a colony, in list order (BaconConstructionQueue.cs 63:
 * facility != null && Type == Wonder && WonderType == ColonyConstructionSpeed && ConstructionProgress >= 1).
 */
function colonyConstructionSpeedWonderValues(habitat: Habitat): number[] {
    const values: number[] = [];
    if (habitat.facilities !== null) {
        for (let index = 0; index < habitat.facilities.length; ++index) {
            const facility = habitat.facilities[index];
            if (facility !== null && facility.type === PlanetaryFacilityType.Wonder && facility.wonderType === WonderType.ColonyConstructionSpeed && facility.constructionProgress >= 1.0) {
                values.push(facility.value2);
            }
        }
    }
    return values;
}

// ---------------------------------------------------------------------------------------------------------------
// ConstructionQueue
// ---------------------------------------------------------------------------------------------------------------

/** A StellarObject that can own a ConstructionQueue / Cargo (BuiltObject or Habitat). */
type QueueParent = BuiltObject | Habitat;

/** ConstructionQueue.cs. */
export class ConstructionQueue {
    private readonly _galaxy: Galaxy;
    private readonly _parentBuiltObject: BuiltObject | null;
    private readonly _parentHabitat: Habitat | null;
    private _constructionYards: ConstructionYard[] | null = null;
    private _constructionWaitQueue: BuiltObject[] | null = null;
    /** DateTime _LastProcessed (sim ms). */
    private _lastProcessed = 0;
    militaryConstructionSpeedModifier = 1.0;
    civilianConstructionSpeedModifier = 1.0;
    colonyConstructionSpeedModifier = 1.0;
    /** public int _ConstructionSpeed = 1. */
    _constructionSpeed = 1;

    /** ConstructionQueue(BuiltObject, Galaxy) (71) / ConstructionQueue(Habitat, Galaxy) (79). */
    constructor(parent: QueueParent, galaxy: Galaxy, parentIsBuiltObject: boolean) {
        this._galaxy = galaxy;
        if (parentIsBuiltObject) {
            this._parentBuiltObject = parent as BuiltObject;
            this._parentHabitat = null;
            this.redefineBuiltObject(parent as BuiltObject);
        } else {
            this._parentHabitat = parent as Habitat;
            this._parentBuiltObject = null;
            this.redefineHabitat(parent as Habitat);
        }
        this._lastProcessed = galaxy.nowMs;
    }

    get parentBuiltObject(): BuiltObject | null { return this._parentBuiltObject; }
    get parentHabitat(): Habitat | null { return this._parentHabitat; }
    get constructionSpeed(): number { return this._constructionSpeed; }
    get constructionYards(): ConstructionYard[] | null { return this._constructionYards; }
    get constructionWaitQueue(): BuiltObject[] | null { return this._constructionWaitQueue; }

    /** ConstructionQueue.Empire (46). */
    get empire(): Empire | null {
        if (this._parentBuiltObject !== null) return this._parentBuiltObject.empire;
        if (this._parentHabitat !== null) return this._parentHabitat.empire;
        return null;
    }

    /** ConstructionQueue.ReviewConstructionSpeed (66) → BaconConstructionQueue.ReviewConstructionSpeed. */
    reviewConstructionSpeed(): void {
        baconReviewConstructionSpeed(this);
    }

    /** GetUnderConstruction(subRoles) (87). */
    getUnderConstruction(subRoles: readonly BuiltObjectSubRole[]): BuiltObject[] {
        const builtObjectList: BuiltObject[] = [];
        const yards = this._constructionYards!;
        for (let i = 0; i < yards.length; i++) {
            const constructionYard = yards[i];
            if (constructionYard.shipUnderConstruction !== null && subRoles.includes(constructionYard.shipUnderConstruction.subRole)) {
                builtObjectList.push(constructionYard.shipUnderConstruction);
            }
        }
        if (this._constructionWaitQueue !== null) {
            for (let j = 0; j < this._constructionWaitQueue.length; j++) {
                const builtObject = this._constructionWaitQueue[j];
                if (builtObject != null && subRoles.includes(builtObject.subRole)) builtObjectList.push(builtObject);
            }
        }
        return builtObjectList;
    }

    /** CountUnderConstruction(subRole) (112). */
    countUnderConstruction(subRole: BuiltObjectSubRole): number {
        let num = 0;
        const yards = this._constructionYards!;
        for (let i = 0; i < yards.length; i++) {
            if (yards[i].shipUnderConstruction !== null && yards[i].shipUnderConstruction!.subRole === subRole) num++;
        }
        if (this._constructionWaitQueue !== null) {
            for (let j = 0; j < this._constructionWaitQueue.length; j++) {
                if (this._constructionWaitQueue[j] != null && this._constructionWaitQueue[j].subRole === subRole) num++;
            }
        }
        return num;
    }

    /** EstimateCurrentWaitQueueTime (135). */
    estimateCurrentWaitQueueTime(): number {
        const yards = this._constructionYards!;
        const waitQueue = this._constructionWaitQueue!;
        const num = 40.0 / (this.constructionSpeed / 1000.0);
        if (waitQueue.length === 0) {
            for (let i = 0; i < yards.length; i++) {
                if (yards[i].shipUnderConstruction === null) return num;
            }
        }
        let num2 = 4.4942328371557893e307;
        for (let j = 0; j < yards.length; j++) {
            const constructionYard2 = yards[j];
            if (constructionYard2.shipUnderConstruction !== null) {
                const num3 = constructionYard2.shipUnderConstruction.unbuiltOrDamagedComponentCount / (constructionYard2.constructionSpeed / 1000.0);
                if (num3 < num2) num2 = num3;
                continue;
            }
            num2 = 0.0;
            break;
        }
        let num4 = 0;
        for (let k = 0; k < waitQueue.length; k++) {
            num4 += waitQueue[k].unbuiltOrDamagedComponentCount;
        }
        const num5 = yards.length > 0 ? Math.trunc(num4 / yards.length) : 536870911;
        const num6 = num5 / (this.constructionSpeed / 1000.0);
        return num + num2 + num6;
    }

    /** Redefine(Habitat) (178): one colony yard of component 94 (max size 20000, speed = its Value1). */
    redefineHabitat(habitat: Habitat): void {
        void habitat;
        if (this._constructionYards === null) this._constructionYards = [];
        if (this._constructionWaitQueue === null) this._constructionWaitQueue = [];
        // new BuiltObjectComponent(94, ComponentStatus.Normal): BuiltObjectComponentId stays -1 (not added to a list).
        const def = componentDefinition(this._galaxy, 94);
        const builtObjectComponent = new BuiltObjectComponent(def, ComponentStatus.Normal);
        const item = new ConstructionYard(builtObjectComponent.componentId, builtObjectComponent.builtObjectComponentId, 20000, builtObjectComponent.value1);
        this._constructionYards.push(item);
        this.reviewConstructionSpeed();
    }

    /** Redefine(BuiltObject[, forceSingleConstructionYard]) (193/198). */
    redefineBuiltObject(builtObject: BuiltObject, forceSingleConstructionYard = false): boolean {
        void builtObject;
        if (this._constructionYards === null) this._constructionYards = [];
        if (this._constructionWaitQueue === null) this._constructionWaitQueue = [];
        let flag = false;
        const components = this._parentBuiltObject!.components.items;
        for (let i = 0; i < components.length; i++) {
            const builtObjectComponent = components[i];
            if (builtObjectComponent.type !== ComponentType.ConstructionBuild) continue;
            const num = yardsIndexOfComponent(this._constructionYards!, builtObjectComponent);
            if (builtObjectComponent.status === ComponentStatus.Damaged || builtObjectComponent.status === ComponentStatus.Unbuilt) {
                if (num >= 0) {
                    const yard = this._constructionYards![num];
                    if (yard.shipUnderConstruction !== null) {
                        yard.retrofitComponentsToBeBuilt = null;
                        this._constructionWaitQueue!.splice(0, 0, yard.shipUnderConstruction);
                        yard.shipUnderConstruction = null;
                    }
                    this._constructionYards!.splice(num, 1);
                }
            } else {
                flag = true;
                if (num < 0) {
                    const item = new ConstructionYard(builtObjectComponent.componentId, builtObjectComponent.builtObjectComponentId, builtObjectComponent.value2, builtObjectComponent.value1);
                    this._constructionYards!.push(item);
                }
            }
        }
        if (!flag && forceSingleConstructionYard) {
            const item2 = new ConstructionYard(94, -1, 5000, 50);
            this._constructionYards!.push(item2);
            flag = true;
        }
        if (!flag) {
            this._constructionYards = null;
            this._constructionWaitQueue = null;
        }
        this.reviewConstructionSpeed();
        return flag;
    }

    /** ProcessWaitQueue (259). */
    private processWaitQueue(): void {
        const builtObjectList: BuiltObject[] = [];
        let buildingEmpire: Empire | null = null;
        if (this._parentBuiltObject !== null) buildingEmpire = this._parentBuiltObject.empire;
        else if (this._parentHabitat !== null) buildingEmpire = this._parentHabitat.empire;
        const waitQueue = this._constructionWaitQueue!;
        if (waitQueue.length <= 0) return;
        for (const item of waitQueue) {
            if (yardsAddBuiltObjectToConstruct(this._galaxy, this._constructionYards!, item, buildingEmpire)) builtObjectList.push(item);
        }
        for (const item2 of builtObjectList) {
            const index = waitQueue.indexOf(item2);
            if (index >= 0) waitQueue.splice(index, 1);
        }
    }

    /** The cargo list, empire and cargo space the yard works with (the `_ParentBuiltObject` / `_ParentHabitat` pairs). */
    private parentCargo(): CargoList | null {
        if (this._parentBuiltObject !== null) return this._parentBuiltObject.cargo;
        if (this._parentHabitat !== null) return this._parentHabitat.cargo;
        return null;
    }

    /** ProcessSingleConstructionYard(constructionYard, timePassed, galaxy, completedBuiltObjects) (286-1125). */
    private processSingleConstructionYard(constructionYard: ConstructionYard | null, timePassedMs: number, galaxy: Galaxy, completedBuiltObjects: BuiltObject[]): void {
        if (constructionYard === null || constructionYard.shipUnderConstruction === null) return;
        if (constructionYard.incrementalProgress < 0) constructionYard.incrementalProgress = 0;
        let num = 0.0;
        if (this._parentBuiltObject !== null) this._parentBuiltObject.doingConstruction = true;
        const shipUnderConstruction = constructionYard.shipUnderConstruction;
        // 301-326
        if (shipUnderConstruction.scrap) {
            num = ((timePassedMs / 1000.0) * ((constructionYard.constructionSpeed / 1000.0) * 4.0)) / (constructionYard.buildSpeedModifier * 2.0);
        } else if (
            shipUnderConstruction.retrofitDesign !== null &&
            constructionYard.retrofitComponentsToBeScrapped !== null &&
            constructionYard.retrofitComponentsToBeScrapped.length > 0 &&
            (constructionYard.retrofitComponentsToBeBuilt === null || constructionYard.retrofitComponentsToBeBuilt.length <= 0)
        ) {
            num = ((timePassedMs / 1000.0) * ((constructionYard.constructionSpeed / 1000.0) * 4.0)) / constructionYard.buildSpeedModifier;
        } else {
            num = ((timePassedMs / 1000.0) * (constructionYard.constructionSpeed / 1000.0)) / constructionYard.buildSpeedModifier;
            if (shipUnderConstruction.subRole === BuiltObjectSubRole.ColonyShip) {
                num /= COLONY_SHIP_BUILD_FACTOR;
                if (this.empire !== null) num *= empireColonyShipBuildSpeedRate(this.empire);
            } else if (shipUnderConstruction.role !== BuiltObjectRole.Base && shipUnderConstruction.design.isPlanetDestroyer) {
                num /= 5.0;
            }
        }
        // 327-339
        let empire: Empire | null = null;
        if (this._parentBuiltObject !== null) empire = this._parentBuiltObject.empire;
        else if (this._parentHabitat !== null) empire = this._parentHabitat.empire;
        if (empire !== null && empire.dominantRace !== null) {
            num = num * raceConstructionSpeedModifier(empire.dominantRace) * constructionSpeedMultiplier(this);
        }
        // 340-364
        if (shipUnderConstruction !== null) {
            switch (shipUnderConstruction.role) {
                case BuiltObjectRole.Military:
                    num *= this.militaryConstructionSpeedModifier;
                    break;
                case BuiltObjectRole.Base:
                    switch (shipUnderConstruction.subRole) {
                        case BuiltObjectSubRole.SmallSpacePort:
                        case BuiltObjectSubRole.MediumSpacePort:
                        case BuiltObjectSubRole.LargeSpacePort:
                        case BuiltObjectSubRole.DefensiveBase:
                            num *= this.militaryConstructionSpeedModifier;
                            break;
                        default:
                            num *= this.civilianConstructionSpeedModifier;
                            break;
                    }
                    break;
                default:
                    num = shipUnderConstruction.subRole !== BuiltObjectSubRole.ColonyShip ? num * this.civilianConstructionSpeedModifier : num * this.colonyConstructionSpeedModifier;
                    break;
            }
        }
        // 365-381: build-speed research bonus (a yard building an unowned object with unresearched tech).
        if (constructionYard.buildSpeedModifier > 1.0 && constructionYard.shipUnderConstruction !== null && !constructionYard.shipUnderConstruction.scrap && this.empire !== null && this.empire.research != null) {
            const researchNode = selectRandomNextResearchProjectExcludeSuperWeapons(galaxy, this.empire);
            if (researchNode !== null) {
                let num2 = num * ADVANCED_TECH_BONUS_FACTOR * constructionYard.buildSpeedModifier;
                if (Number.isNaN(num2)) num2 = 100.0;
                researchNode.progress = Math.fround(researchNode.progress + Math.fround(num2));
                if (researchNode.progress >= researchNode.cost) {
                    doResearchBreakthrough(galaxy, this.empire, researchNode, true);
                }
            }
        }
        // 382-389
        constructionYard.incrementalProgress = constructionYard.incrementalProgress + Math.fround(num);
        if (!(constructionYard.incrementalProgress >= 1.0)) return;
        let num3 = csInt(constructionYard.incrementalProgress);
        constructionYard.incrementalProgress = constructionYard.incrementalProgress - num3;
        let shipUnderConstruction2: BuiltObject | null = constructionYard.shipUnderConstruction;
        const iterationCount = { value: 0 };
        while (conditionCheckLimit(num3 > 0 && shipUnderConstruction2 !== null && shipUnderConstruction2.components !== null, 500, iterationCount)) {
            const ship = shipUnderConstruction2!;
            let num4 = 0;
            if (ship.scrap) {
                // 395-435: take components apart, returning their resources to the parent's cargo.
                num4 = findNextBuiltComponent(ship.components, 0);
                if (num4 >= 0) {
                    const iterationCount2 = { value: 0 };
                    while (conditionCheckLimit(num4 >= 0 && num3 > 0, 500, iterationCount2)) {
                        let cargoList: CargoList | null = null;
                        let empire2: Empire | null = null;
                        let num5 = 0;
                        if (this._parentBuiltObject !== null) {
                            if (this._parentBuiltObject.cargo !== null) cargoList = this._parentBuiltObject.cargo;
                            empire2 = this._parentBuiltObject.empire;
                            num5 = this._parentBuiltObject.cargoSpace;
                        } else if (this._parentHabitat !== null && this._parentHabitat.population.totalAmount > 0) {
                            if (this._parentHabitat.cargo !== null) cargoList = this._parentHabitat.cargo;
                            empire2 = this._parentHabitat.owner;
                            num5 = 536870911;
                        }
                        const component = ship.components.items[num4];
                        if (component.status === ComponentStatus.Normal && cargoList !== null && num5 > 0) {
                            for (const requiredResource of component.def.resourceRequirements) {
                                const cargo = new Cargo(new ResourceRef(requiredResource.resourceId), requiredResource.amount, empire2);
                                cargoList.add(cargo);
                            }
                        }
                        component.status = ComponentStatus.Unbuilt;
                        num4 = findNextBuiltComponent(ship.components, num4 + 1);
                        num3--;
                    }
                    continue;
                }
                // 437: _Galaxy.CheckTriggerEvent(ship.GameEventId, Empire, Destroy) (story/eventActions.ts, M4z3).
                checkTriggerEvent(this._galaxy, ship.gameEventId, this.empire, EventTriggerType.Destroy, null);
                // 438-487: research bonus from disassembling unresearched technology.
                const queueEmpire = this.empire;
                if (queueEmpire !== null && queueEmpire.research != null) {
                    const bs = resolveBuildSpeed(queueEmpire, this._galaxy, ship);
                    const researchCategory = bs.researchCategory;
                    const num6 = bs.result;
                    if (num6 > 1.0) {
                        let text = '';
                        let researchNode2 = selectRandomNextResearchProjectExcludeSuperWeaponsByCategory(galaxy, queueEmpire, researchCategory);
                        if (researchNode2 === null) {
                            researchNode2 = selectRandomNextResearchProjectExcludeSuperWeapons(galaxy, queueEmpire);
                        }
                        if (researchNode2 === null || galaxy.rnd.next(0, 5) === 6) {
                            if (this._parentBuiltObject !== null) {
                                text = formatGameTextNow('We have disassembled the ship X at Y', [ship.name, this._parentBuiltObject.name]);
                            } else if (this._parentHabitat !== null) {
                                text = formatGameTextNow('We have disassembled the ship X at Y', [ship.name, this._parentHabitat.name]);
                            }
                            text = text + '. ' + formatGameTextNow('Unfortunately our engineers were unable to learn anything new from inspecting its technology') + '.';
                        } else {
                            let num7 = ship.size * ADVANCED_TECH_BONUS_FACTOR * num6;
                            if (Number.isNaN(num7)) num7 = 10000.0;
                            researchNode2.progress = Math.fround(researchNode2.progress + Math.fround(num7));
                            if (this._parentBuiltObject !== null) {
                                text = formatGameTextNow('We have received a research bonus in X from disassembling Y', [researchNode2.def.name, ship.name, this._parentBuiltObject.name]);
                            } else if (this._parentHabitat !== null) {
                                text = formatGameTextNow('We have received a research bonus in X from disassembling Y', [researchNode2.def.name, ship.name, this._parentHabitat.name]);
                            }
                            text += '.';
                            if (researchNode2.progress >= researchNode2.cost) {
                                doResearchBreakthrough(galaxy, queueEmpire, researchNode2, true, true, false);
                            }
                        }
                        sendMessageToEmpire(queueEmpire, queueEmpire, EmpireMessageType.GeneralGoodEvent, ship, text);
                    }
                }
                // 488-516: characters aboard move to the yard (or its colony).
                const shipCharacters = ship.characters as (Character | null)[] | null;
                if (shipCharacters !== null && shipCharacters.length > 0) {
                    if (this._parentBuiltObject !== null) {
                        const pbo = this._parentBuiltObject;
                        if (pbo.parentHabitat !== null) {
                            if (stellarObjectCharacters(pbo.parentHabitat) !== null) {
                                const array = shipCharacters.slice();
                                for (let i = 0; i < array.length; i++) array[i]?.completeLocationTransfer(pbo.parentHabitat, this._galaxy);
                            }
                        } else if (pbo.characters !== null) {
                            const array2 = shipCharacters.slice();
                            for (let j = 0; j < array2.length; j++) array2[j]?.completeLocationTransfer(pbo, this._galaxy);
                        }
                    } else if (this._parentHabitat !== null && stellarObjectCharacters(this._parentHabitat) !== null) {
                        const array3 = shipCharacters.slice();
                        for (let k = 0; k < array3.length; k++) array3[k]?.completeLocationTransfer(this._parentHabitat, this._galaxy);
                    }
                }
                // 517-571: troops aboard move to the yard (or its colony). The C# removes while indexing forward
                // (every other troop is skipped); kept as is.
                if (ship.troops !== null && ship.troops.items.length > 0) {
                    if (this._parentBuiltObject !== null) {
                        const pbo = this._parentBuiltObject;
                        if (pbo.parentHabitat !== null) {
                            if (pbo.parentHabitat.troops !== null) {
                                for (let l = 0; l < ship.troops.items.length; l++) {
                                    const troop = ship.troops.items[l];
                                    if (troop != null) {
                                        troop.builtObject = null;
                                        ship.troops.remove(troop);
                                        pbo.parentHabitat.troops.add(troop);
                                        troop.colony = pbo.parentHabitat;
                                    }
                                }
                            }
                        } else if (pbo.troops !== null) {
                            for (let m = 0; m < ship.troops.items.length; m++) {
                                const troop2 = ship.troops.items[m];
                                if (troop2 != null) {
                                    troop2.builtObject = null;
                                    troop2.colony = null;
                                    ship.troops.remove(troop2);
                                    pbo.troops.add(troop2);
                                    troop2.builtObject = pbo;
                                }
                            }
                        }
                    } else if (this._parentHabitat !== null && this._parentHabitat.troops !== null) {
                        for (let n = 0; n < ship.troops.items.length; n++) {
                            const troop3 = ship.troops.items[n];
                            if (troop3 != null) {
                                troop3.builtObject = null;
                                ship.troops.remove(troop3);
                                this._parentHabitat.troops.add(troop3);
                                troop3.colony = this._parentHabitat;
                            }
                        }
                    }
                }
                // 572-582
                ship.builtAt = null;
                ship.parentBuiltObject = null;
                ship.parentHabitat = null;
                ship.parentOffsetX = -2000000001.0;
                ship.parentOffsetY = -2000000001.0;
                constructionYard.shipUnderConstruction = null;
                num3 = 0;
                builtObjectCompleteTeardown(galaxy, ship, false);
                constructionYard.incrementalProgress = 0;
                constructionYard.shipUnderConstruction = null;
                continue;
            }
            if (ship.retrofitDesign !== null) {
                // 584-763: retrofit — repair damage, build the new components, strip the old ones, then finish.
                if (constructionYard.retrofitComponentsToBeBuilt === null) {
                    constructionYard.retrofitComponentsToBeBuilt = componentListDiff(resolveComponentList(ship.components), ship.retrofitDesign.components);
                    constructionYard.retrofitComponentsToBeScrapped = componentListDiff(ship.retrofitDesign.components, resolveComponentList(ship.components));
                }
                let cargoList2: CargoList = new CargoList();
                let num8 = 0;
                let empire3: Empire | null = null;
                if (this._parentBuiltObject !== null) {
                    if (this._parentBuiltObject.cargo !== null) cargoList2 = this._parentBuiltObject.cargo;
                    num8 = this._parentBuiltObject.cargoSpace;
                    empire3 = this._parentBuiltObject.empire;
                } else if (this._parentHabitat !== null) {
                    if (this._parentHabitat.cargo !== null) cargoList2 = this._parentHabitat.cargo;
                    num8 = 536870911; // Habitat.CargoSpace (Habitat.cs 293)
                    empire3 = this._parentHabitat.empire;
                }
                const num9 = identifyComponentToRepair(ship);
                if (num9 >= 0) {
                    ship.components.items[num9].status = ComponentStatus.Normal;
                    num3--;
                    continue;
                }
                if (constructionYard.retrofitComponentsToBeBuilt !== null && constructionYard.retrofitComponentsToBeBuilt.length > 0) {
                    num4 = identifyComponentToBuildFromList(cargoList2, empire3, constructionYard.retrofitComponentsToBeBuilt);
                    if (num4 >= 0) {
                        const cargo2 = cargoList2.getCargoComponent(constructionYard.retrofitComponentsToBeBuilt[num4].componentId, empire3);
                        if (cargo2 !== null && cargo2.amount > 0) {
                            cargo2.amount--;
                            cargo2.reserved--;
                            if (cargo2.amount <= 0 && cargo2.reserved <= 0) cargoList2.remove(cargo2);
                            const component = new BuiltObjectComponent(constructionYard.retrofitComponentsToBeBuilt[num4], ComponentStatus.Normal);
                            ship.components.add(component);
                            constructionYard.retrofitComponentsToBeBuilt.splice(num4, 1);
                        }
                    }
                    num3--;
                    continue;
                }
                if (constructionYard.retrofitComponentsToBeBuilt !== null && constructionYard.retrofitComponentsToBeScrapped !== null && constructionYard.retrofitComponentsToBeScrapped.length > 0 && constructionYard.retrofitComponentsToBeBuilt.length <= 0) {
                    ship.pictureRef = ship.retrofitDesign.pictureRef;
                    ship.subRole = ship.retrofitDesign.subRole;
                    const num10 = indexByIdAndStatus(ship.components, constructionYard.retrofitComponentsToBeScrapped[0].componentId, ComponentStatus.Normal);
                    if (num10 >= 0) {
                        if (cargoList2 !== null && num8 > 0) {
                            for (const requiredResource2 of ship.components.items[num10].def.resourceRequirements) {
                                const cargo3 = new Cargo(new ResourceRef(requiredResource2.resourceId), requiredResource2.amount, empire3);
                                cargoList2.add(cargo3);
                            }
                        }
                        ship.components.items[num10].status = ComponentStatus.Unbuilt;
                    }
                    constructionYard.retrofitComponentsToBeScrapped.splice(0, 1);
                    num3--;
                    continue;
                }
                // 669-699: retrofit complete.
                ship.design = ship.retrofitDesign;
                if (
                    ship.subRole !== ship.design.subRole &&
                    (ship.subRole === BuiltObjectSubRole.SmallSpacePort || ship.subRole === BuiltObjectSubRole.MediumSpacePort || ship.subRole === BuiltObjectSubRole.LargeSpacePort) &&
                    (ship.design.subRole === BuiltObjectSubRole.SmallSpacePort || ship.design.subRole === BuiltObjectSubRole.MediumSpacePort || ship.design.subRole === BuiltObjectSubRole.LargeSpacePort)
                ) {
                    ship.subRole = ship.design.subRole;
                    ship.pictureRef = ship.design.pictureRef;
                }
                ship.reDefine();
                for (let num11 = findNextUnbuiltComponent(ship.components, 0); num11 >= 0; num11 = findNextUnbuiltComponent(ship.components, 0)) {
                    ship.components.items.splice(num11, 1);
                }
                ship.reDefine();
                constructionYard.retrofitComponentsToBeBuilt = null;
                constructionYard.retrofitComponentsToBeScrapped = null;
                ship.retrofitDesign = null;
                ship.builtAt = null;
                ship.dateRetrofit = galaxyCurrentStarDate(this._galaxy);
                let arg = '';
                if (this._parentBuiltObject !== null) {
                    arg = this._parentBuiltObject.parentHabitat === null ? this._parentBuiltObject.name : this._parentBuiltObject.parentHabitat.name;
                } else if (this._parentHabitat !== null) {
                    arg = this._parentHabitat.name;
                }
                let empty = '';
                empty =
                    ship.role !== BuiltObjectRole.Base
                        ? empty + formatGameTextNow('Retrofitting for the SHIPTYPE NAME has been completed at LOCATION', [resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, ship.subRole), ship.name, arg])
                        : empty + formatGameTextNow('Retrofitting for the SHIPTYPE NAME has been completed at LOCATION', ['base', ship.name, arg]);
                constructionYard.incrementalProgress = 0;
                constructionYard.shipUnderConstruction = null;
                num3 = 0;
                ship.firstExecutionOfCommand = true;
                const shipMission = builtObjectMission(ship.mission);
                if (shipMission !== null) shipMission.completeCommand();
                completedBuiltObjects.push(ship);
                if (Number.isNaN(ship.currentFuel)) ship.currentFuel = 0.0;
                if (Number.isNaN(ship.currentEnergy)) ship.currentEnergy = 0.0;
                ship.reDefine();
                if (ship.fuelType !== null) {
                    let num12 = -1;
                    const cargoList3 = this.parentCargo();
                    if (cargoList3 !== null) num12 = cargoList3.indexOf(ship.fuelType, ship.empire);
                    if (num12 >= 0) {
                        const c = cargoList3!.items[num12];
                        const room = ship.fuelCapacity - Math.trunc(ship.currentFuel);
                        const num13 = c.available < room ? c.available : room;
                        c.amount -= num13;
                        ship.currentFuel += num13;
                    }
                }
                ship.currentEnergy = Math.max(ship.currentEnergy, 0.0);
                if (ship.troopCapacity > 0 && ship.empire !== null && ship.empire.policy != null && ship.troopLoadoutArmored !== 255 && ship.troopLoadoutArtillery !== 255 && ship.troopLoadoutInfantry !== 255 && ship.troopLoadoutSpecialForces !== 255) {
                    ship.setTroopLoadoutsFromPolicy(ship.empire.policy);
                }
                if (!assignFleetWaypointMission(this._galaxy, ship, true, null) && ship.topSpeed > 0) {
                    const m = builtObjectMission(ship.mission);
                    if (m === null || m.type === BuiltObjectMissionType.Undefined) {
                        const p = this._galaxy.selectRelativeParkingPoint();
                        if (this._parentHabitat !== null) {
                            assignMission(this._galaxy, ship, BuiltObjectMissionType.Move, this._parentHabitat, null, BuiltObjectMissionPriority.Low, { x: p.x, y: p.y });
                        } else if (this._parentBuiltObject !== null) {
                            assignMission(this._galaxy, ship, BuiltObjectMissionType.Move, this._parentBuiltObject, null, BuiltObjectMissionPriority.Low, { x: p.x, y: p.y });
                        }
                    }
                }
                if (ship.empire !== null && ship.empire.builtObjects !== null && ship.empire.builtObjects.includes(ship)) {
                    sendMessageToEmpire(ship.empire, ship.empire, EmpireMessageType.ShipBaseCompleted, ship, empty);
                }
                this.processWaitQueue();
                if (constructionYard.shipUnderConstruction === null) break;
                shipUnderConstruction2 = constructionYard.shipUnderConstruction;
                continue;
            }
            // 765-790: new construction / repair — build (or repair) one component.
            let cargoList4: CargoList = new CargoList();
            let empire4: Empire | null = null;
            if (this._parentBuiltObject !== null) {
                if (this._parentBuiltObject.cargo !== null) cargoList4 = this._parentBuiltObject.cargo;
                empire4 = this._parentBuiltObject.empire;
            } else if (this._parentHabitat !== null) {
                if (this._parentHabitat.cargo !== null) cargoList4 = this._parentHabitat.cargo;
                empire4 = this._parentHabitat.empire;
            }
            num4 = identifyComponentToBuild(cargoList4, empire4, ship);
            if (num4 >= 0) {
                const component = ship.components.items[num4];
                if (component.status === ComponentStatus.Damaged) {
                    component.status = ComponentStatus.Normal;
                } else {
                    const cargo4 = cargoList4.getCargoComponent(component.componentId, empire4);
                    if (cargo4 !== null && cargo4.amount > 0) {
                        cargo4.amount--;
                        cargo4.reserved--;
                        if (cargo4.amount <= 0 && cargo4.reserved <= 0) cargoList4.remove(cargo4);
                        component.status = ComponentStatus.Normal;
                    }
                }
            }
            if (num4 === -2147483648) {
                this.completeConstruction(constructionYard, ship, empire4, completedBuiltObjects);
                if (constructionYard.shipUnderConstruction === null) break;
                shipUnderConstruction2 = constructionYard.shipUnderConstruction;
            }
            num3--;
        }
        // 1121-1124
        if (shipUnderConstruction2!.retrofitDesign === null) {
            shipUnderConstruction2!.reDefine();
        }
    }

    /** ProcessSingleConstructionYard 812-1111: every component built — the ship / base is complete. */
    private completeConstruction(constructionYard: ConstructionYard, ship: BuiltObject, empire4: Empire | null, completedBuiltObjects: BuiltObject[]): void {
        const galaxy = this._galaxy;
        if (Number.isNaN(ship.currentFuel)) ship.currentFuel = 0.0;
        if (Number.isNaN(ship.currentEnergy)) ship.currentEnergy = 0.0;
        ship.reDefine();
        ship.dateBuilt = galaxyCurrentStarDate(galaxy);
        ship.dateRetrofit = galaxyCurrentStarDate(galaxy);
        ship.builtAt = null;
        let arg2 = '';
        if (this._parentBuiltObject !== null) {
            arg2 = ship.parentBuiltObject === null ? this._parentBuiltObject.name : ship.parentBuiltObject.name;
        } else if (this._parentHabitat !== null) {
            arg2 = this._parentHabitat.name;
        }
        if (ship.empire === null) {
            scanForNewOwnerBuiltObject(galaxy, ship, this._parentBuiltObject);
        }
        let empty2 = '';
        empty2 =
            ship.role !== BuiltObjectRole.Base
                ? empty2 + formatGameTextNow('The SHIPTYPE NAME has been completed at LOCATION', [resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, ship.subRole), ship.name, arg2])
                : empty2 + formatGameTextNow('The SHIPTYPE NAME has been completed at LOCATION', ['base', ship.name, arg2]);
        if (empire4 !== null && empire4.counters != null) {
            processBuiltObjectConstruction(empire4, ship);
        }
        if (ship.isPlanetDestroyer && ship.topSpeed > 0) {
            ship.currentFuel = ship.fuelCapacity;
            // 843-844: GetMatchingGameEventIdPlanetDestroyerConstructionCompleted + CheckTriggerEvent (story/eventActions.ts, M4z3).
            const matchingGameEventIdPlanetDestroyerConstructionCompleted = getMatchingGameEventIdPlanetDestroyerConstructionCompleted(galaxy, empire4);
            checkTriggerEvent(galaxy, matchingGameEventIdPlanetDestroyerConstructionCompleted, empire4, EventTriggerType.PlanetDestroyerConstructionCompleted, ship);
        }
        // 841-896
        let eventType = CharacterEventType.BuildCivilianShip;
        switch (ship.subRole) {
            case BuiltObjectSubRole.Escort:
            case BuiltObjectSubRole.Frigate:
            case BuiltObjectSubRole.Destroyer:
            case BuiltObjectSubRole.Cruiser:
            case BuiltObjectSubRole.CapitalShip:
            case BuiltObjectSubRole.TroopTransport:
            case BuiltObjectSubRole.Carrier:
            case BuiltObjectSubRole.ResupplyShip:
                eventType = CharacterEventType.BuildMilitaryShip;
                break;
            case BuiltObjectSubRole.ExplorationShip:
            case BuiltObjectSubRole.SmallFreighter:
            case BuiltObjectSubRole.MediumFreighter:
            case BuiltObjectSubRole.LargeFreighter:
            case BuiltObjectSubRole.PassengerShip:
            case BuiltObjectSubRole.ConstructionShip:
            case BuiltObjectSubRole.GasMiningShip:
            case BuiltObjectSubRole.MiningShip:
                eventType = CharacterEventType.BuildCivilianShip;
                break;
            case BuiltObjectSubRole.ColonyShip:
                eventType = CharacterEventType.BuildColonyShip;
                break;
            case BuiltObjectSubRole.DefensiveBase:
                eventType = CharacterEventType.BuildMilitaryBase;
                break;
            case BuiltObjectSubRole.GasMiningStation:
            case BuiltObjectSubRole.MiningStation:
                eventType = CharacterEventType.BuildMiningStation;
                break;
            case BuiltObjectSubRole.GenericBase:
            case BuiltObjectSubRole.MonitoringStation:
                eventType = CharacterEventType.BuildOtherBase;
                break;
            case BuiltObjectSubRole.EnergyResearchStation:
                eventType = CharacterEventType.BuildResearchStationEnergy;
                break;
            case BuiltObjectSubRole.HighTechResearchStation:
                eventType = CharacterEventType.BuildResearchStationHighTech;
                break;
            case BuiltObjectSubRole.WeaponsResearchStation:
                eventType = CharacterEventType.BuildResearchStationWeapons;
                break;
            case BuiltObjectSubRole.ResortBase:
                eventType = CharacterEventType.BuildResortBase;
                break;
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort:
                eventType = CharacterEventType.BuildSpaceport;
                break;
        }
        // 897-913
        const characterList: Character[] = [];
        if (this._parentBuiltObject !== null) {
            const pboCharacters = this._parentBuiltObject.characters as Character[] | null;
            if (pboCharacters !== null) characterList.push(...pboCharacters);
            if (this._parentBuiltObject.parentHabitat !== null) {
                const hc = stellarObjectCharacters(this._parentBuiltObject.parentHabitat);
                if (hc !== null) characterList.push(...hc);
            }
        } else if (this._parentHabitat !== null) {
            const hc = stellarObjectCharacters(this._parentHabitat);
            if (hc !== null) characterList.push(...hc);
        }
        doCharacterEventForList(galaxy, eventType, ship, characterList, true, ship.empire);
        // 915-935
        if (empire4 !== null) {
            if (this._parentBuiltObject !== null) {
                if (this._parentBuiltObject.parentHabitat !== null) {
                    chanceNewFleetAdmiralFromConstruction(galaxy, ship, empire4, this._parentBuiltObject.parentHabitat);
                } else {
                    chanceNewFleetAdmiralFromConstruction(galaxy, ship, empire4, this._parentBuiltObject);
                }
            } else if (this._parentHabitat !== null) {
                chanceNewFleetAdmiralFromConstruction(galaxy, ship, empire4, this._parentHabitat);
            }
        }
        // 936-963
        if (ship.empire !== null) {
            switch (ship.subRole) {
                case BuiltObjectSubRole.GasMiningStation:
                case BuiltObjectSubRole.MiningStation:
                    checkSendPreWarpProgressEventMessage(galaxy, ship.empire, PreWarpProgressEventType.BuildFirstMiningStation, ship);
                    break;
                case BuiltObjectSubRole.EnergyResearchStation:
                case BuiltObjectSubRole.WeaponsResearchStation:
                case BuiltObjectSubRole.HighTechResearchStation:
                    checkSendPreWarpProgressEventMessage(galaxy, ship.empire, PreWarpProgressEventType.BuildFirstResearchStation, ship);
                    break;
                case BuiltObjectSubRole.SmallSpacePort:
                case BuiltObjectSubRole.MediumSpacePort:
                case BuiltObjectSubRole.LargeSpacePort:
                    checkSendPreWarpProgressEventMessage(galaxy, ship.empire, PreWarpProgressEventType.BuildFirstSpaceport, ship);
                    break;
                default:
                    if (ship.role !== BuiltObjectRole.Base) {
                        if (ship.role === BuiltObjectRole.Military) {
                            checkSendPreWarpProgressEventMessage(galaxy, ship.empire, PreWarpProgressEventType.BuildFirstMilitaryShip, ship);
                        }
                        checkSendPreWarpProgressEventMessage(galaxy, ship.empire, PreWarpProgressEventType.BuildFirstShip, ship);
                    }
                    break;
            }
        }
        // 964-1048: parent / offset hand-over and fuel from the yard's cargo.
        let num14 = 0;
        if (this._parentBuiltObject !== null) {
            const pbo = this._parentBuiltObject;
            if (ship.parentBuiltObject !== null) {
                ship.parentBuiltObject = null;
                ship.parentOffsetX = -2000000001.0;
                ship.parentOffsetY = -2000000001.0;
            }
            if ((pbo.role === BuiltObjectRole.Base || ship.role !== BuiltObjectRole.Base) && (pbo !== ship || ship.role !== BuiltObjectRole.Base)) {
                ship.parentHabitat = null;
                ship.parentOffsetX = -2000000001.0;
                ship.parentOffsetY = -2000000001.0;
            }
            if (pbo.role !== BuiltObjectRole.Base && ship.role === BuiltObjectRole.Base) {
                if (pbo.parentHabitat !== null) {
                    ship.parentHabitat = pbo.parentHabitat;
                    let flag = false;
                    const pboMission = builtObjectMission(pbo.mission);
                    if (pboMission !== null) {
                        const command = pboMission.fastPeekCurrentCommand();
                        if (command !== null && command.action === CommandAction.Build && command.targetHabitat !== null) {
                            const targetHabitat = command.targetHabitat;
                            if (targetHabitat === pbo.parentHabitat) {
                                ship.parentOffsetX = command.targetRelativeXpos;
                                ship.parentOffsetY = command.targetRelativeYpos;
                                flag = true;
                            }
                        }
                    }
                    if (!flag) {
                        ship.parentOffsetX = pbo.xpos - pbo.parentHabitat.xpos;
                        ship.parentOffsetY = pbo.ypos - pbo.parentHabitat.ypos;
                    }
                }
            } else {
                ship.parentBuiltObject = null;
                ship.parentOffsetX = -2000000001.0;
                ship.parentOffsetY = -2000000001.0;
                if (pbo !== null && pbo.parentBuiltObject === ship) {
                    pbo.parentBuiltObject = null;
                    pbo.parentOffsetX = -2000000001.0;
                    pbo.parentOffsetY = -2000000001.0;
                }
            }
            if (ship.fuelType !== null) {
                let num15 = -1;
                if (pbo.cargo !== null) num15 = pbo.cargo.indexOf(ship.fuelType, ship.actualEmpire);
                if (num15 >= 0) {
                    const c = pbo.cargo!.items[num15];
                    const room = ship.fuelCapacity - Math.trunc(ship.currentFuel);
                    num14 = c.available < room ? c.available : room;
                    c.amount -= num14;
                }
            }
        } else if (this._parentHabitat !== null) {
            ship.parentHabitat = this._parentHabitat;
            if (ship.fuelType !== null) {
                let num16 = -1;
                if (this._parentHabitat.cargo !== null) num16 = this._parentHabitat.cargo.indexOf(ship.fuelType, ship.empire);
                if (num16 >= 0) {
                    const c = this._parentHabitat.cargo!.items[num16];
                    const room = ship.fuelCapacity - Math.trunc(ship.currentFuel);
                    num14 = c.available < room ? c.available : room;
                    c.amount -= num14;
                }
            }
        }
        // 1049-1052: CheckTriggerEvent(ParentHabitat.GameEventId, Empire, Build, ship) (story/eventActions.ts, M4z3).
        if (ship.parentHabitat !== null) checkTriggerEvent(this._galaxy, ship.parentHabitat.gameEventId, this.empire, EventTriggerType.Build, ship);
        ship.currentFuel += num14;
        ship.currentEnergy = Math.max(ship.currentEnergy, 0.0);
        if (
            this._parentBuiltObject !== null &&
            this._parentBuiltObject.subRole === BuiltObjectSubRole.ConstructionShip &&
            this._parentBuiltObject.cargo !== null &&
            ship.role === BuiltObjectRole.Base &&
            ship.cargo !== null &&
            (ship.parentHabitat === null || ship.parentHabitat.empire !== ship.actualEmpire)
        ) {
            moveCargoFromBuilderToBuiltBase(this._parentBuiltObject, ship);
        }
        if (ship.troopCapacity > 0 && ship.empire !== null && ship.empire.policy != null) {
            ship.setTroopLoadoutsFromPolicy(ship.empire.policy);
        }
        // 1066-1076 (constructionYard.ShipUnderConstruction is `ship` here).
        constructionYard.shipUnderConstruction!.builtAt = null;
        constructionYard.shipUnderConstruction = null;
        ship.firstExecutionOfCommand = true;
        completedBuiltObjects.push(ship);
        ship.repairForNextMission = false;
        ship.refuelForNextMission = false;
        ship.retireForNextMission = false;
        ship.reDefine();
        constructionYard.incrementalProgress = 0;
        constructionYard.shipUnderConstruction = null;
        // 1077-1104: send the new ship to a parking point (or check its colonisation target).
        if (ship.role !== BuiltObjectRole.Base && (this._parentBuiltObject === null || this._parentBuiltObject.subRole !== BuiltObjectSubRole.ConstructionShip) && !assignFleetWaypointMission(galaxy, ship, true, null) && ship.topSpeed > 0) {
            const m = builtObjectMission(ship.mission);
            if (m === null || m.type === BuiltObjectMissionType.Undefined) {
                const p = galaxy.selectRelativeParkingPoint();
                if (this._parentHabitat !== null) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.Move, this._parentHabitat, null, BuiltObjectMissionPriority.Low, { x: p.x, y: p.y });
                } else if (this._parentBuiltObject !== null) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.Move, this._parentBuiltObject, null, BuiltObjectMissionPriority.Low, { x: p.x, y: p.y });
                }
            } else if (ship.subRole === BuiltObjectSubRole.ColonyShip && m !== null && m.type === BuiltObjectMissionType.Colonize && m.targetHabitat !== null) {
                if (!canBuiltObjectColonizeHabitat(galaxy, ship.empire!, ship, m.targetHabitat).result) {
                    clearPreviousMissionRequirements(galaxy, ship);
                    const p3 = galaxy.selectRelativeParkingPoint();
                    if (this._parentHabitat !== null) {
                        assignMission(galaxy, ship, BuiltObjectMissionType.Move, this._parentHabitat, null, BuiltObjectMissionPriority.Low, { x: p3.x, y: p3.y });
                    } else if (this._parentBuiltObject !== null) {
                        assignMission(galaxy, ship, BuiltObjectMissionType.Move, this._parentBuiltObject, null, BuiltObjectMissionPriority.Low, { x: p3.x, y: p3.y });
                    }
                }
            }
        }
        const actualEmpire = ship.actualEmpire;
        if (actualEmpire !== null && actualEmpire.builtObjects !== null && actualEmpire.builtObjects.includes(ship)) {
            sendMessageToEmpire(actualEmpire, actualEmpire, EmpireMessageType.ShipBaseCompleted, ship, empty2);
        }
        if (galaxy.scenario !== null) scenarioEmit(galaxy, 'builtObjectBuilt', { builtObject: ship, empire: actualEmpire }); // mod layer
        this.processWaitQueue();
        void num14;
    }

    /** ResetProcessTime(time) (1191). */
    resetProcessTime(time: number): void {
        this._lastProcessed = time;
    }

    /** DoConstruction(galaxy, tempNow) (1196). Rnd: Next(0, yards.Count). */
    doConstruction(galaxy: Galaxy, tempNow: number): BuiltObject[] {
        const builtObjectList: BuiltObject[] = [];
        const timePassedMs = tempNow - this._lastProcessed;
        this.processWaitQueue();
        const yards = this._constructionYards!;
        const num = galaxy.rnd.next(0, yards.length);
        for (let i = num; i < yards.length; i++) {
            this.processSingleConstructionYard(yards[i], timePassedMs, galaxy, builtObjectList);
        }
        for (let j = 0; j < num; j++) {
            this.processSingleConstructionYard(yards[j], timePassedMs, galaxy, builtObjectList);
        }
        this.processWaitQueue();
        this._lastProcessed = tempNow;
        return builtObjectList;
    }

    /** Clear() (1225). */
    clear(): void {
        const waitQueue = this._constructionWaitQueue!;
        for (let i = 0; i < waitQueue.length; i++) {
            waitQueue[i].builtAt = null;
        }
        waitQueue.length = 0;
        for (const constructionYard of this._constructionYards!) {
            if (constructionYard.shipUnderConstruction !== null) {
                constructionYard.shipUnderConstruction.builtAt = null;
                constructionYard.shipUnderConstruction.firstExecutionOfCommand = true;
                constructionYard.shipUnderConstruction.reDefine();
                constructionYard.shipUnderConstruction = null;
            }
            constructionYard.incrementalProgress = 0;
            constructionYard.retrofitComponentsToBeBuilt = null;
            constructionYard.retrofitComponentsToBeScrapped = null;
            constructionYard.shipUnderConstruction = null;
        }
    }

    /** RemoveBuiltObject(builtObject) (1247). */
    removeBuiltObject(builtObject: BuiltObject): boolean {
        const waitQueue = this._constructionWaitQueue!;
        if (waitQueue.includes(builtObject)) {
            builtObject.builtAt = null;
            waitQueue.splice(waitQueue.indexOf(builtObject), 1);
            return true;
        }
        const yards = this._constructionYards!;
        const num = yardsIndexOfShip(yards, builtObject);
        if (num >= 0 && yards[num].shipUnderConstruction !== null) {
            const s = yards[num].shipUnderConstruction!;
            s.builtAt = null;
            s.firstExecutionOfCommand = true;
            s.reDefine();
            yards[num].shipUnderConstruction = null;
            return true;
        }
        return false;
    }

    /** The colony-yard restriction shared by the AddBuiltObjectTo* methods: null = go on, true/false = return that. */
    private habitatYardRestriction(builtObject: BuiltObject, onAccepted: () => void): boolean | null {
        if (this._parentHabitat !== null) {
            if (builtObject.subRole === BuiltObjectSubRole.ColonyShip || builtObject.subRole === BuiltObjectSubRole.ConstructionShip || builtObject.subRole === BuiltObjectSubRole.ResupplyShip || builtObject.role === BuiltObjectRole.Base) {
                onAccepted();
                return true;
            }
            if (builtObject.design.topSpeed > 0 && builtObject.role !== BuiltObjectRole.Colony && builtObject.role !== BuiltObjectRole.Build) {
                return false;
            }
        }
        return null;
    }

    /** AddBuiltObjectToRetrofit(builtObject, design) (1270). */
    addBuiltObjectToRetrofit(builtObject: BuiltObject, design: Design): boolean {
        const accept = (): void => {
            builtObject.retrofitDesign = design;
            this._constructionWaitQueue!.push(builtObject);
            builtObject.retrofitForNextMission = false;
        };
        const r = this.habitatYardRestriction(builtObject, accept);
        if (r !== null) return r;
        accept();
        return true;
    }

    /** AddBuiltObjectToScrap(builtObject) (1293). */
    addBuiltObjectToScrap(builtObject: BuiltObject): boolean {
        const accept = (): void => {
            builtObject.scrap = true;
            this._constructionWaitQueue!.push(builtObject);
            builtObject.retireForNextMission = false;
        };
        const r = this.habitatYardRestriction(builtObject, accept);
        if (r !== null) return r;
        accept();
        return true;
    }

    /** AddBuiltObjectToRepair(builtObject) (1316). */
    addBuiltObjectToRepair(builtObject: BuiltObject): boolean {
        const accept = (): void => {
            this._constructionWaitQueue!.push(builtObject);
        };
        const r = this.habitatYardRestriction(builtObject, accept);
        if (r !== null) return r;
        accept();
        return true;
    }

    /** AddBuiltObjectToConstruct(builtObject) (1334). */
    addBuiltObjectToConstruct(builtObject: BuiltObject): boolean {
        const galaxy = this._galaxy;
        let num = 0.0;
        let num2 = 0.0;
        let heading = 0;
        if (this._parentHabitat !== null) {
            if (builtObject.role !== BuiltObjectRole.Base) {
                num = this._parentHabitat.xpos;
                num2 = this._parentHabitat.ypos;
                heading = 0;
            } else {
                num = builtObject.xpos;
                num2 = builtObject.ypos;
                heading = builtObject.heading;
            }
        } else if (this._parentBuiltObject !== null) {
            num = this._parentBuiltObject.xpos;
            num2 = this._parentBuiltObject.ypos;
            heading = this._parentBuiltObject.heading;
        }
        if (this._parentHabitat !== null) {
            if (builtObject.subRole === BuiltObjectSubRole.ColonyShip || builtObject.subRole === BuiltObjectSubRole.ConstructionShip || builtObject.subRole === BuiltObjectSubRole.ResupplyShip || builtObject.role === BuiltObjectRole.Base) {
                const habitat = galaxy.fastFindNearestSystem(num, num2);
                if (habitat !== null) {
                    const num3 = galaxy.calculateDistance(num, num2, habitat.xpos, habitat.ypos);
                    if (num3 < galaxy.maxSolarSystemSize + 500.0) builtObject.nearestSystemStar = habitat;
                }
                if (builtObject.subRole === BuiltObjectSubRole.ColonyShip) {
                    const population = this._parentHabitat.population;
                    builtObject.nativeRace = population.dominantRace;
                    for (let i = 0; i < population.items.length; i++) {
                        if (population.items[i].race === population.dominantRace) {
                            const num4 = calculateColonizationPopulation(builtObject.design);
                            population.items[i].amount -= num4;
                            population.items[i].amount = Math.max(1000000, population.items[i].amount);
                            population.recalculateTotalAmount();
                            break;
                        }
                    }
                }
                this._constructionWaitQueue!.push(builtObject);
                return true;
            }
            if (builtObject.design.topSpeed > 0 && builtObject.role !== BuiltObjectRole.Colony && builtObject.role !== BuiltObjectRole.Build) {
                return false;
            }
        }
        // Empire.CanBuildBuiltObject(builtObject) (Empire.10.cs 554): forceStructure.ts takes the design, whose
        // Role / SubRole / Size a builtObject queued for construction carries unchanged (BuiltObject ctor).
        if (canBuildBuiltObject(this.empire!, builtObject.design)) {
            const habitat2 = galaxy.fastFindNearestSystem(num, num2);
            if (habitat2 !== null) {
                const num5 = galaxy.calculateDistance(num, num2, habitat2.xpos, habitat2.ypos);
                if (num5 <= galaxy.maxSolarSystemSize + 500.0) builtObject.nearestSystemStar = habitat2;
            }
            this._constructionWaitQueue!.push(builtObject);
            builtObject.heading = heading;
            builtObject.targetHeading = builtObject.heading;
            return true;
        }
        return false;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ProcessSingleConstructionYard helpers (ConstructionQueue.cs 1127-1189)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.7.cs 569 ConditionCheckLimit(condition, maximumIterations, ref iterationCount). */
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { value: number }): boolean {
    if (iterationCount.value >= maximumIterations) return false;
    iterationCount.value++;
    return condition;
}

/** IdentifyComponentToBuild(cargo, empire, ComponentList components) (1127). */
function identifyComponentToBuildFromList(cargo: CargoList, empire: Empire | null, components: readonly ComponentDefinition[]): number {
    for (let i = 0; i < components.length; i++) {
        if (cargo.getExistsComponent(components[i].componentId)) {
            const num = cargo.indexOfComponent(components[i].componentId, empire);
            if (num >= 0 && cargo.items[num].amount > 0) return i;
        }
    }
    return -1;
}

/**
 * IdentifyComponentToBuild(cargo, empire, BuiltObject) (1142): first damaged component, else the first unbuilt one
 * whose component the cargo holds (runs of the same component id are checked once); int.MinValue when nothing is
 * unbuilt or damaged, -1 when components are missing.
 */
function identifyComponentToBuild(cargo: CargoList, empire: Empire | null, builtObject: BuiltObject): number {
    let num = 0;
    let num2 = -1;
    const items = builtObject.components.items;
    for (let i = 0; i < items.length; i++) {
        switch (items[i].status) {
            case ComponentStatus.Damaged:
                return i;
            case ComponentStatus.Unbuilt:
                num++;
                if (items[i].componentId === num2) break;
                num2 = items[i].componentId;
                if (cargo.getExistsComponent(items[i].componentId)) {
                    const num3 = cargo.indexOfComponent(items[i].componentId, empire);
                    if (num3 >= 0) return i;
                }
                break;
        }
    }
    if (num === 0) return -2147483648;
    return -1;
}

/** IdentifyComponentToRepair(builtObject) (1176). */
function identifyComponentToRepair(builtObject: BuiltObject): number {
    const items = builtObject.components.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].status === ComponentStatus.Damaged) return i;
    }
    return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// BaconConstructionQueue.cs
// ---------------------------------------------------------------------------------------------------------------

/** BaconConstructionQueue.ConstructionSpeedMultiplier(queue) (16): 5.0 for an empire whose name contains "Romulan". */
export function constructionSpeedMultiplier(queue: ConstructionQueue | null): number {
    let num = 1.0;
    if (queue !== null && queue.empire !== null && queue.empire.name.includes('Romulan')) num = BACON_MY_CONSTRUCTION_SPEED_MULTIPLIER;
    return num;
}

/** BaconConstructionQueue.MoveCargoFromBuilderToBuiltBase(constructionShip, builtObject) (24): up to 100 of each resource. */
export function moveCargoFromBuilderToBuiltBase(constructionShip: BuiltObject, builtObject: BuiltObject): void {
    const actualEmpire = builtObject.actualEmpire;
    const cargoItems = constructionShip.cargo!.items;
    for (let index = 0; index < cargoItems.length; ++index) {
        const cargo = cargoItems[index];
        // C# compares cargo.EmpireId with ActualEmpire.EmpireId (-1 when null): the TS cargo keeps the Empire itself.
        if (cargo != null && cargo.empire === actualEmpire && actualEmpire !== null && cargo.commodityIsResource && cargo.amount > 0) {
            const amount = Math.min(cargo.amount, 100);
            builtObject.cargo!.add(new Cargo(new ResourceRef(cargo.commodity.resourceId), amount, cargo.empire));
            cargo.amount -= amount;
        }
    }
}

/** BaconConstructionQueue.ReviewConstructionSpeed(conQueue) (45). No Rnd. */
export function baconReviewConstructionSpeed(conQueue: ConstructionQueue): void {
    if (conQueue.parentHabitat === null) {
        conQueue._constructionSpeed = 1;
        const pbo = conQueue.parentBuiltObject;
        const researchSystem = pbo !== null && pbo.empire !== null ? pbo.empire.research : null;
        let val1 = 1.0;
        let num1 = 1.0;
        let num2 = 1.0;
        if (pbo !== null && pbo.parentHabitat !== null) {
            const ph = pbo.parentHabitat;
            if (ph.facilities !== null) {
                for (const v2 of colonyConstructionSpeedWonderValues(ph)) val1 = Math.max(val1, 1.0 + v2 / 100.0);
            }
            // ParentHabitat.ResourceBonuses (never null on a TS habitat).
            const totalByEffectType = resourceBonusTotalByEffectType(ph, ColonyResourceEffect.ConstructionSpeed);
            if (totalByEffectType > 0.0) num1 = 1.0 + Math.max(0.0, Math.min(100.0, totalByEffectType)) / 100.0;
            if (ph.population != null && ph.population.dominantRace !== null) {
                const dominantRace = ph.population.dominantRace;
                num2 *= raceConstructionSpeedModifier(dominantRace) * constructionSpeedMultiplier(conQueue);
                const f = raceColonyConstructionFactorForType(dominantRace, ph.type);
                if (f !== 1.0) num2 *= f;
            }
        }
        const yards = conQueue.constructionYards;
        if (yards === null) return;
        for (const constructionYard of yards) {
            if (researchSystem !== null) {
                const def = componentDefinition(pbo!._galaxy, constructionYard.componentId);
                const componentImprovement = researchSystem.resolveImprovedComponentValues(def);
                constructionYard.constructionSpeed = csInt(componentImprovement.value1 * val1 * num1 * num2);
                if (constructionYard.constructionSpeed > conQueue.constructionSpeed) conQueue._constructionSpeed = constructionYard.constructionSpeed;
            } else if (constructionYard.constructionSpeed > conQueue.constructionSpeed) {
                conQueue._constructionSpeed = constructionYard.constructionSpeed;
            }
        }
        return;
    }
    const ph = conQueue.parentHabitat;
    let num3 = 10000000.0;
    if (ph.population != null && ph.population.items.length > 0) num3 = ph.population.totalAmount;
    let num4 = csInt(600.0 * Math.min(1.0, Math.sqrt(num3 / COLONY_BUILD_SPEED_IDEAL_POPULATION)));
    if (ph.facilities !== null) {
        let num5 = 0.0;
        for (const v2 of colonyConstructionSpeedWonderValues(ph)) num5 = v2 / 100.0;
        if (num5 > 0.0) num4 = csInt(num4 * (1.0 + num5));
    }
    const totalByEffectType = resourceBonusTotalByEffectType(ph, ColonyResourceEffect.ConstructionSpeed);
    if (totalByEffectType > 0.0) {
        const num6 = 1.0 + Math.max(0.0, Math.min(100.0, totalByEffectType)) / 100.0;
        num4 = csInt(num4 * num6);
    }
    if (ph.population != null && ph.population.dominantRace !== null) {
        const dominantRace = ph.population.dominantRace;
        num4 = csInt(num4 * raceConstructionSpeedModifier(dominantRace) * constructionSpeedMultiplier(conQueue));
        const f = raceColonyConstructionFactorForType(dominantRace, ph.type);
        if (f !== 1.0) num4 = csInt(num4 * f);
    }
    let val1_1 = 0;
    let val1_2 = 0;
    let val1_3 = 0;
    // (conQueue.ParentHabitat != null here, so the ParentBuiltObject branch of the C# is unreachable.)
    const characters = stellarObjectCharacters(ph);
    if (characters !== null && characters.length > 0) {
        val1_1 = Math.max(val1_1, getHighestSkillLevelExcludeLeaders(characters, CharacterSkillType.MilitaryShipConstructionSpeed));
        val1_2 = Math.max(val1_2, getHighestSkillLevelExcludeLeaders(characters, CharacterSkillType.CivilianShipConstructionSpeed));
        val1_3 = Math.max(val1_3, getHighestSkillLevelExcludeLeaders(characters, CharacterSkillType.ColonyShipConstructionSpeed));
    }
    void getHighestSkillLevel;
    const empire = conQueue.empire;
    if (empire !== null && empire.leader !== null) {
        val1_1 += empire.leader.militaryShipConstructionSpeed;
        val1_2 += empire.leader.civilianShipConstructionSpeed;
        val1_3 += empire.leader.civilianShipConstructionSpeed;
    }
    conQueue.militaryConstructionSpeedModifier = 1.0 + val1_1 / 100.0;
    conQueue.civilianConstructionSpeedModifier = 1.0 + val1_2 / 100.0;
    conQueue.colonyConstructionSpeedModifier = 1.0 + val1_3 / 100.0;
    conQueue._constructionSpeed = num4;
    for (const constructionYard of conQueue.constructionYards!) constructionYard.constructionSpeed = num4;
}

// ---------------------------------------------------------------------------------------------------------------
// Creation / ReDefine hooks and the Habitat tick entry points
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.ComponentDefinitionsStatic[componentId]. */
function componentDefinition(galaxy: Galaxy, componentId: number): ComponentDefinition {
    const def = galaxy.researchStatic?.componentStatic?.byId.get(componentId);
    if (def === undefined) throw new Error(`ConstructionQueue: component ${componentId} not in Galaxy.ComponentDefinitionsStatic`);
    return def;
}

/** Habitat.ConstructionQueue as the typed queue (types.ts declares it `unknown`). */
export function habitatConstructionQueue(habitat: Habitat): ConstructionQueue | null {
    return habitat.constructionQueue as ConstructionQueue | null;
}

/** BuiltObject.ConstructionQueue as the typed queue (builtObject.ts declares it `unknown`). */
export function builtObjectConstructionQueue(builtObject: BuiltObject): ConstructionQueue | null {
    return builtObject.constructionQueue as ConstructionQueue | null;
}

registerConstructionQueueFactory({
    forHabitat: (galaxy, habitat) => new ConstructionQueue(habitat, galaxy, false),
    forBuiltObject: (galaxy, builtObject) => new ConstructionQueue(builtObject, galaxy, true),
});

/** ConstructionQueue.cs 1196 DoConstruction(galaxy, time) on a colony (Habitat.cs 1479-1482). Rnd: Next(0, yards). */
export function doConstruction(galaxy: Galaxy, habitat: Habitat, time: number): void {
    habitatConstructionQueue(habitat)!.doConstruction(galaxy, time);
}

/** ConstructionQueue.DoConstruction on a ship / base yard — called by BuiltObject.IndustrialProcessing (BuiltObject.2.cs 8120-8123, M4g). */
export function doConstructionBuiltObject(galaxy: Galaxy, builtObject: BuiltObject, time: number): void {
    builtObjectConstructionQueue(builtObject)!.doConstruction(galaxy, time);
}

/** ConstructionQueue.ResetProcessTime(time) — BuiltObject.IndustrialProcessing (BuiltObject.2.cs 8125-8128, M4g). */
export function resetConstructionProcessTime(builtObject: BuiltObject, time: number): void {
    builtObjectConstructionQueue(builtObject)!.resetProcessTime(time);
}

/** ConstructionQueue.cs 66 / BaconConstructionQueue.cs 45 ReviewConstructionSpeed on a colony (Habitat.cs 1506-1509). */
export function reviewConstructionSpeed(galaxy: Galaxy, habitat: Habitat): void {
    void galaxy;
    habitatConstructionQueue(habitat)!.reviewConstructionSpeed();
}

// ---------------------------------------------------------------------------------------------------------------
// Small callees only construction reaches
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.CurrentStarDate. */
function galaxyCurrentStarDate(galaxy: Galaxy): number {
    return galaxyStarDate(galaxy);
}

/** Empire.ColonyShipBuildSpeedRate (Empire.cs 421 = ColonyShipBuildSpeedRateDefault; BaconGalaxy.SetEmpireDifficultyFactors). */
function empireColonyShipBuildSpeedRate(empire: Empire): number {
    const f = empire.difficultyFactors;
    return f !== null && f.colonyShipBuildSpeedRate !== undefined ? f.colonyShipBuildSpeedRate : COLONY_SHIP_BUILD_SPEED_RATE_DEFAULT;
}

/** EmpireCounters.ProcessBuiltObjectConstruction(builtObject) (EmpireCounters.cs 321); counters live in the M4h empire block. */
export function processBuiltObjectConstruction(empire: Empire, builtObject: BuiltObject | null): void {
    if (builtObject === null) return;
    if (builtObject.role === BuiltObjectRole.Base) ++empire.countersBuildBaseCount;
    else if (builtObject.role === BuiltObjectRole.Military) ++empire.countersBuildMilitaryShipCount;
    else ++empire.countersBuildCivilianShipCount;
}

/** Galaxy.2.cs 5151 ChanceNewFleetAdmiralFromConstruction(builtObjectConstructed, empire, location). Rnd: Next(0, num). */
export function chanceNewFleetAdmiralFromConstruction(galaxy: Galaxy, builtObjectConstructed: BuiltObject | null, empire: Empire | null, location: BuiltObject | Habitat | null): boolean {
    if (builtObjectConstructed !== null && empire !== null && location !== null && !location.hasBeenDestroyed) {
        let num = 0;
        if (builtObjectConstructed.subRole === BuiltObjectSubRole.DefensiveBase) num = 30;
        else if (builtObjectConstructed.subRole === BuiltObjectSubRole.Carrier) num = 20;
        else if (builtObjectConstructed.subRole === BuiltObjectSubRole.ResupplyShip) num = 15;
        else if (builtObjectConstructed.subRole === BuiltObjectSubRole.Cruiser) num = 20;
        else if (builtObjectConstructed.subRole === BuiltObjectSubRole.CapitalShip) {
            num = 15;
            if (builtObjectConstructed.isPlanetDestroyer || builtObjectConstructed.size > 2000) num = 5;
        }
        if (num > 0 && galaxy.rnd.next(0, num) === 1 && charactersCanGenerateAmountNonIntelligenceAgent(empire) > 0) {
            const character = generateNewCharacter(galaxy, empire, CharacterRole.FleetAdmiral, location).character;
            const title = gameText('New Character Event Title', resolveDescription(CharacterRole as unknown as Record<number, string>, character.role));
            const description = gameText('New Character Event Construction Fleet Admiral', resolveDescription(BuiltObjectSubRole as unknown as Record<number, string>, builtObjectConstructed.subRole), builtObjectConstructed.name, character.name);
            sendMessageToEmpireWithTitle(empire, empire, EmpireMessageType.CharacterAppearance, character, description, title);
            return true;
        }
    }
    return false;
}

/** Empire.7.cs 1485 CalculateColonizationPopulation(design): the largest Value1 of a HabitationColonization component. */
export function calculateColonizationPopulation(design: Design): number {
    let num = 0;
    // ComponentDefinition.GetByType(HabitationColonization, ComponentDefinitionsStatic): every such definition id, in
    // definition order; the result is the max over the design's components of those ids (order-independent).
    for (let j = 0; j < design.components.length; j++) {
        const component2 = design.components[j];
        if (component2.type === ComponentType.HabitationColonization && component2.value1 > num) num = component2.value1;
    }
    return num;
}

/** Empire.7.cs 1433 CanBuiltObjectColonizeHabitat(builtObject, habitat, out newPopulationAmount). */
export function canBuiltObjectColonizeHabitat(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject, habitat: Habitat): { result: boolean; newPopulationAmount: number } {
    let newPopulationAmount = 0;
    if (builtObject.role !== BuiltObjectRole.Colony) return { result: false, newPopulationAmount };
    if (habitat.category !== HabitatCategoryType.Planet && habitat.category !== HabitatCategoryType.Moon) return { result: false, newPopulationAmount };
    for (let i = 0; i < builtObject.components.items.length; i++) {
        const builtObjectComponent = builtObject.components.items[i];
        if (builtObjectComponent.type === ComponentType.HabitationColonization && builtObjectComponent.status === ComponentStatus.Normal) {
            newPopulationAmount = builtObjectComponent.value1;
        }
    }
    // Empire.7.cs 1452-1455: a Shakturi colony ship settles a billion.
    if (galaxy.shakturiActualRace !== null && builtObject.nativeRace !== null && builtObject.nativeRace === galaxy.shakturiActualRace) newPopulationAmount = 1000000000;
    if (!galaxy.checkEmpireTerritoryCanColonizeHabitat(empire, habitat)) return { result: false, newPopulationAmount };
    if (habitat.population.totalAmount > 0 && (habitat.empire === null || habitat.empire === galaxy.independentEmpire)) return { result: true, newPopulationAmount };
    if (builtObject.subRole === BuiltObjectSubRole.ColonyShip && builtObject.nativeRace !== null && builtObject.nativeRace.nativeHabitatType === habitat.type) {
        if (newPopulationAmount <= 0) newPopulationAmount = 15000000;
        return { result: true, newPopulationAmount };
    }
    let result: boolean;
    switch (habitat.type) {
        case HabitatType.Continental: result = empire.canColonizeContinental; break;
        case HabitatType.MarshySwamp: result = empire.canColonizeMarshySwamp; break;
        case HabitatType.Desert: result = empire.canColonizeDesert; break;
        case HabitatType.Ocean: result = empire.canColonizeOcean; break;
        case HabitatType.Ice: result = empire.canColonizeIce; break;
        case HabitatType.Volcanic: result = empire.canColonizeVolcanic; break;
        default: result = false; break;
    }
    return { result, newPopulationAmount };
}

/** ResearchSystem.cs 272-274: the super-weapon projects excluded from random research bonuses. */
const SUPER_WEAPON_PROJECT_IDS = [272, 273, 274];

/** ResearchNodeList.StripProjectsById(ids) (ResearchNodeList.cs 114). */
function stripProjectsById(list: TechNode[], researchProjectIds: readonly number[]): TechNode[] {
    return list.filter((n) => !(n != null && researchProjectIds.includes(n.def.projectId)));
}

/** ResearchSystem.SelectRandomNextResearchProjectExcludeSuperWeapons(galaxy) (ResearchSystem.cs 717). Rnd: Next(0, count). */
export function selectRandomNextResearchProjectExcludeSuperWeapons(galaxy: Galaxy, empire: Empire): TechNode | null {
    const rs = empire.research;
    const researchNode1: TechNode | null = null;
    if (rs.nextProjects !== null && rs.nextProjects.length > 0) {
        const researchNodeList = stripProjectsById(rs.nextProjects.slice(), SUPER_WEAPON_PROJECT_IDS);
        if (researchNodeList.length > 0) {
            const index = galaxy.rnd.next(0, researchNodeList.length);
            const researchNode2 = researchNodeList[index];
            if (researchNode2 != null && rs.nextProjects !== null) return findNodeById(rs.nextProjects, researchNode2.def.projectId);
        }
    }
    return researchNode1;
}

/** ResearchSystem.SelectRandomNextResearchProjectExcludeSuperWeapons(galaxy, category) (ResearchSystem.cs 671). Rnd: Next(0, count). */
export function selectRandomNextResearchProjectExcludeSuperWeaponsByCategory(galaxy: Galaxy, empire: Empire, category: ComponentCategoryType): TechNode | null {
    const rs = empire.research;
    let researchNode: TechNode | null = null;
    let researchNodeList: TechNode[] = [];
    if (rs.nextProjects !== null) {
        researchNodeList = stripProjectsById(getProjectsByCategory(rs.nextProjects, category), SUPER_WEAPON_PROJECT_IDS);
    }
    if (researchNodeList !== null && researchNodeList.length > 0) {
        const index = galaxy.rnd.next(0, researchNodeList.length);
        researchNode = researchNodeList[index];
    }
    return researchNode;
}

// ---------------------------------------------------------------------------------------------------------------
// ConstructionYardList.AddBuiltObjectToConstruct / Galaxy.4.cs ResolveBuildSpeed
// ---------------------------------------------------------------------------------------------------------------

/** ConstructionYardList.AddBuiltObjectToConstruct(builtObject, buildingEmpire) (ConstructionYardList.cs 42). */
export function yardsAddBuiltObjectToConstruct(galaxy: Galaxy, yards: readonly ConstructionYard[], builtObject: BuiltObject, buildingEmpire: Empire | null): boolean {
    for (const constructionYard of yards) {
        if (constructionYard.shipUnderConstruction === null) {
            let num = 1.0;
            if (builtObject.empire === null && buildingEmpire !== null) {
                num = resolveBuildSpeed(buildingEmpire, galaxy, builtObject, false).result;
            }
            constructionYard.buildSpeedModifier = num;
            constructionYard.shipUnderConstruction = builtObject;
            constructionYard.incrementalProgress = 0.0;
            constructionYard.retrofitComponentsToBeBuilt = null;
            constructionYard.retrofitComponentsToBeScrapped = null;
            if (builtObject.retrofitDesign !== null) {
                constructionYard.retrofitComponentsToBeBuilt = componentListDiff(resolveComponentList(builtObject.components), builtObject.retrofitDesign.components);
                constructionYard.retrofitComponentsToBeScrapped = componentListDiff(builtObject.retrofitDesign.components, resolveComponentList(builtObject.components));
            }
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Galaxy.4.cs 1843 ResolveBuildSpeed(buildingEmpire, galaxy, builtObject, considerAllComponents, out researchCategory)
 * (1826/1832/1838 are the overloads: considerAllComponents defaults to true).
 * 1858 num4 = (int)((double)galaxy.BaseTechCost * 0.5).
 */
export function resolveBuildSpeed(buildingEmpire: Empire | null, galaxy: Galaxy, builtObject: BuiltObject, considerAllComponents = true): { result: number; researchCategory: ComponentCategoryType } {
    let result = 1.0;
    let num = 0;
    let num2 = 0.0;
    let num3 = 0.0;
    let componentCategoryType = 0 as ComponentCategoryType; // ComponentCategoryType.Undefined
    const minTech = researchComponentTechPoints(galaxy).min;
    for (let i = 0; i < builtObject.components.items.length; i++) {
        const builtObjectComponent = builtObject.components.items[i];
        if (!considerAllComponents && builtObjectComponent.status === ComponentStatus.Normal) continue;
        // ResearchSystem.GetMinTechPoints(component) (ResearchSystem.cs 1244).
        const minTechPoints = minTech.length > builtObjectComponent.componentId ? minTech[builtObjectComponent.componentId] : 0;
        let num4 = Math.trunc(galaxy.baseTechCost * 0.5);
        if (buildingEmpire !== null && buildingEmpire.research != null && buildingEmpire.research.checkComponentResearched(builtObjectComponent.def)) {
            num4 = minTechPoints;
        }
        let val = (minTechPoints + 1.0) / (num4 + 1.0);
        val = Math.max(1.0, val);
        val -= 1.0;
        val = Math.min(val, 20.0);
        if (val > 0.0) {
            num2 += builtObjectComponent.size * val;
            num += builtObjectComponent.size;
            if (val > num3) {
                num3 = val;
                componentCategoryType = builtObjectComponent.category;
            }
        }
    }
    if (num2 > 0.0) {
        result = 1.0 + num2 / num;
    }
    return { result, researchCategory: componentCategoryType };
}

