// M4r — trade offers between empires.
//
// Ports: TradeableItem.cs, TradeableItemList.cs, TradeableItemType.cs, TradeOfferResponse.cs; Empire.7.cs 2576 TradeItems,
// 2758 DetermineAcceptTerritoryMapTrade, 2789 CheckKnowledgeOfSecretLocations, 2824 DetermineAcceptGalaxyMapTrade;
// Galaxy.4.cs 3550 GetRefactorForEmpire (+ BaconGalaxy.cs 266 RefactorValueForEmpire), 3680 ValueTerritoryMapForEmpire,
// 3808 GiveTerritoryMap, 4377 ResolveTradeableItemsMaps, 4623 ValueGalaxyMapForEmpire.
//
// Also (below): Empire.7.cs 1779 EvaluateTradeOffer, 2411/2485 DetermineOfferedTradeItems*, 2060 ReviewEnemyHelpEnlistment,
// 2205 ReviewDisputedTerritory; Galaxy.4.cs 3857 GiveTradeableItem, 4176-4406 ResolveTradeableItems*, colony / base /
// diplomacy values. Still TODO(port): 4474 ResolveTradeableItemsPirateInfo. The player's side (trade screen, task 17e2) is
// player/tradeNegotiation.ts.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { registerTodo, todo } from './tick/todo';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from './tick/simTime';
import { pirateEconomyPerformExpense, pirateEconomyPerformIncome } from './pirates/pirateAI';
import { PirateExpenseType, PirateIncomeType } from './pirates/pirateEconomy';
import { DiplomaticRelationType, DiplomaticStrategy, obtainEmpireEvaluation } from './diplomacy';
import { obtainPirateRelation } from './pirateRelations';
import { EmpireMessageType, sendMessageToEmpire } from './messages';
import { determineEmpireSystems } from './forceStructure';
import { SystemVisibilityStatus } from './visibility';
import { mergeGalaxyMap } from './exploration';
import { HabitatCategoryType } from './types';
import { habitatCompareTo } from './stationPlacement';
import { GalaxyLocationType } from './galaxyLocation';
import {
    aggressionLevel,
    calculateNextAllowableProposalDate,
    cancelBlockades,
    cautionLevel,
    changeDiplomaticRelation,
    compareDouble,
    declareWar,
    determineDesiredDiplomaticRelationTypical,
    determineEmpireDominatedSystems,
    determineVictorInWar,
    fastFindNearestColony,
    formatText,
    friendlinessLevel,
    getText,
    loyaltyLevel,
    obtainAttitude,
    pirateRelationEvaluation,
    processEndOfWarWithEmpire,
    resetAttitudeLevelsAtEndOfWar,
    sendNewsBroadcastWarStartEnd,
    setCivilityRating,
    weightedMilitaryPotency,
} from './diplomacyTick';
import type { BuiltObject } from './builtObject';
import { Habitat as HabitatClass, HabitatType, type Habitat, type SystemInfo } from './types';
import type { Race } from './data/races';
import { BuiltObjectRole } from './data/designSpecifications';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { DiplomaticRelation, DiplomaticRelationList, EmpireEvaluation, empireEvaluationByEmpire, empireEvaluationsOf, obtainDiplomaticRelation } from './diplomacy';
import { PirateRelationType, type PirateRelation } from './pirateRelations';
import { resolveDescription, sendMessageToEmpireWithTitle } from './messages';
import { identifyEmpireCapitals } from './forceStructure';
import { strategicValue } from './territory';
import { netSort } from './netSort';
import { galaxyResourceCurrentPrices } from './design';
import { isObjectVisibleToThisEmpire } from './independentTraders';
import { takeOwnershipOfBuiltObject, takeOwnershipOfColonyRuntime } from './combat/invasion';
import { haveRevolution } from './treasury';
import { GalaxyLocation } from './galaxyLocation';
import { galaxyColonyFillFactor } from './colonyTick';
import type { TechNode } from './researchSystem';
import { nodeCategory, resolveResearchAbilityType, ResearchAbilityType } from './researchSystem';
import { resolveMoreAdvancedProjectsIncludeSpecial } from './espionage';
import { doResearchBreakthrough } from './researchTick';
import type { Component } from './data/components';
import { ComponentType } from './data/components';
import { ComponentCategoryType } from './data/policies';
import { DesignSpecificationComponentRuleType, resolveComponentCategoryForType, type DesignSpecification } from './data/designSpecifications';

// TradeableItemType.cs (member order exact).
export enum TradeableItemType {
    Undefined,
    Money,
    Colony,
    Base,
    TerritoryMap,
    GalaxyMap,
    AdoptGovernmentStyle,
    ThreatenWar,
    DeclareWarOther,
    ThreatenTradeSanctions,
    InitiateTradeSanctionsOther,
    EndWar,
    EndWarOther,
    LiftTradeSanctions,
    LiftTradeSanctionsOther,
    ResearchProject,
    ContactEmpire,
    SecretLocation,
    SystemMap,
    IndependentColonyLocation,
}

// TradeOfferResponse.cs.
export enum TradeOfferResponse {
    Undefined,
    RefuseUnfair,
    Refuse,
    PromptForImprovement,
    Accept,
    AcceptUnfair,
}

/** TradeableItem.cs: (type, item, value); CompareTo = Value.CompareTo. */
export class TradeableItem {
    showSecretLocationNames = true;
    constructor(
        readonly type: TradeableItemType,
        readonly item: unknown,
        readonly value: number,
    ) {}

    clone(): TradeableItem {
        return new TradeableItem(this.type, this.item, this.value);
    }

    /** TradeableItem.cs 36 ToString(showValue): GameText keys (M9 localises). */
    toString(showValue = true): string {
        let str1 = '';
        switch (this.type) {
            case TradeableItemType.TerritoryMap:
                str1 = getText('Trade Description Territory Map');
                break;
            case TradeableItemType.GalaxyMap:
                str1 = getText('Trade Description Galaxy Map');
                break;
            case TradeableItemType.ThreatenWar:
                str1 = getText('Trade Description Threaten War');
                break;
            case TradeableItemType.ThreatenTradeSanctions:
                str1 = getText('Trade Description Threaten Trade Sanctions');
                break;
            case TradeableItemType.ResearchProject:
                str1 = String((this.item as { name?: string } | null)?.name ?? '');
                break;
            default:
                str1 = `${TradeableItemType[this.type]}`;
                break;
        }
        if (showValue && this.type !== TradeableItemType.Money && this.type !== TradeableItemType.TerritoryMap && this.type !== TradeableItemType.GalaxyMap && this.type !== TradeableItemType.ThreatenWar && this.type !== TradeableItemType.ThreatenTradeSanctions) {
            str1 = str1 + ' (' + Math.round(this.value).toLocaleString('en-US') + ')';
        }
        return str1;
    }
}

/** TradeableItemList.cs 14 TotalValue (int sum). */
export function tradeableItemsTotalValue(list: readonly TradeableItem[]): number {
    let totalValue = 0;
    for (const t of list) totalValue = (totalValue + t.value) | 0;
    return totalValue;
}

// ---------------------------------------------------------------------------------------------------------------
// Constants (Galaxy.3.cs 5076-5081; BaconGalaxy.cs 17 with its default setting).
// ---------------------------------------------------------------------------------------------------------------

const TRADE_TERRITORY_MAP_THRESHHOLD = 5;
const TRADE_GALAXY_MAP_THRESHHOLD = 15;
const TRADE_RESEARCH_THRESHHOLD = 25;
const TRADE_RESEARCH_SPECIAL_THRESHHOLD = 50;
const MINIMUM_DIPLOMACY_TRADE_PROPOSAL_INTERVAL_YEARS = 1.25;
/** BaconGalaxy.priceReductionFactor = 1 (BaconMain settings key "priceReductionFactor" may override — default kept). */
const BACON_PRICE_REDUCTION_FACTOR = 1;
/** Galaxy.cs 686 AllowTechTrading = true (Start wizard option, not in the TS CreateGameOptions yet). */
const ALLOW_TECH_TRADING = true;

// ---------------------------------------------------------------------------------------------------------------
// Values (Galaxy.4.cs).
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.4.cs 3550 GetRefactorForEmpire(requestingEmpire, offeringEmpire). */
export function getRefactorForEmpire(galaxy: Galaxy, requestingEmpire: Empire, offeringEmpire: Empire): number {
    let num = 1.0;
    let num2 = 0;
    if (requestingEmpire.pirateEmpireBaseHabitat === null && offeringEmpire.pirateEmpireBaseHabitat === null) {
        num2 = obtainEmpireEvaluation(galaxy, offeringEmpire, requestingEmpire).overallAttitude;
    } else {
        num2 = Math.trunc(pirateRelationEvaluation(obtainPirateRelation(offeringEmpire, requestingEmpire)));
    }
    num = num2 > 0 ? Math.min(1.0, 10.0 / Math.min(50, num2)) : num2 !== 0 ? Math.max(1.0, Math.abs(Math.max(-50, num2)) / 10.0) : 1.0;
    const num3 = 0.7 * ((5.0 + (5.0 - galaxy.difficultyLevel)) / 10.0);
    if (requestingEmpire === galaxy.playerEmpire) num /= num3;
    return num;
}

/** Galaxy.4.cs 3573 RefactorValueForEmpire → BaconGalaxy.cs 266: ((int)min(value × refactor, 2^30−1)) / priceReductionFactor. */
export function refactorValueForEmpire(galaxy: Galaxy, value: number, requestingEmpire: Empire, offeringEmpire: Empire): number {
    const refactorForEmpire = getRefactorForEmpire(galaxy, requestingEmpire, offeringEmpire);
    let num = Math.trunc(value * refactorForEmpire);
    if (num > 1073741823) num = 1073741823;
    return Math.trunc((num | 0) / BACON_PRICE_REDUCTION_FACTOR);
}

/** Galaxy.4.cs 3680 ValueTerritoryMapForEmpire(mapEmpire, requestingEmpire). */
export function valueTerritoryMapForEmpire(galaxy: Galaxy, mapEmpire: Empire, requestingEmpire: Empire): number {
    let num2 = 0;
    const habitatList = determineEmpireSystems(galaxy, mapEmpire, true);
    for (const item of habitatList) {
        if (!requestingEmpire.visibility.checkSystemExplored(item.systemIndex)) {
            const sys = galaxy.systems[item.systemIndex];
            num2 += (sys.planetCount ?? 0) + (sys.moonCount ?? 0);
        }
    }
    let num = num2 * 100;
    if (requestingEmpire === galaxy.playerEmpire) num = Math.trunc(num * (galaxy.playerEmpire.difficultyLevel * galaxy.playerEmpire.difficultyLevel));
    return num;
}

/** Galaxy.4.cs 4623 ValueGalaxyMapForEmpire(mapEmpire, requestingEmpire). */
export function valueGalaxyMapForEmpire(galaxy: Galaxy, mapEmpire: Empire, requestingEmpire: Empire): number {
    let num2 = 0;
    if (mapEmpire.resourceMap != null) {
        for (let i = 0; i < mapEmpire.systemVisibility.length; i++) {
            if (!mapEmpire.visibility.checkSystemExplored(i)) continue;
            const habitats = galaxy.systems[i].habitats;
            for (let j = 0; j < habitats.length; j++) {
                if (habitats[j].category !== HabitatCategoryType.Asteroid && mapEmpire.resourceMap.checkResourcesKnown(habitats[j]) && !requestingEmpire.resourceMap.checkResourcesKnown(habitats[j])) num2++;
            }
        }
    }
    let num = num2 * 200;
    if (requestingEmpire === galaxy.playerEmpire) num = Math.trunc(num * (galaxy.playerEmpire.difficultyLevel * galaxy.playerEmpire.difficultyLevel));
    return num;
}

/** Galaxy.4.cs 4377 ResolveTradeableItemsMaps(giver, receiver, refactorValuesForEmpire). */
export function resolveTradeableItemsMaps(galaxy: Galaxy, giver: Empire, receiver: Empire, refactorValuesForEmpire: boolean): TradeableItem[] {
    const list: TradeableItem[] = [];
    let num = valueTerritoryMapForEmpire(galaxy, giver, receiver);
    if (num >= 0 && refactorValuesForEmpire) num = refactorValueForEmpire(galaxy, num, receiver, giver);
    if (num >= 0) list.push(new TradeableItem(TradeableItemType.TerritoryMap, null, num));
    let num2 = valueGalaxyMapForEmpire(galaxy, giver, receiver);
    if (num2 >= 0 && refactorValuesForEmpire) num2 = refactorValueForEmpire(galaxy, num2, receiver, giver);
    if (num2 >= 0) list.push(new TradeableItem(TradeableItemType.GalaxyMap, null, num2));
    return list;
}

/** TradeableItem.Item is ResearchNode (TechNode is an interface: its runtime shape). */
export function isTechNode(item: unknown): item is TechNode {
    return item !== null && typeof item === 'object' && 'def' in (item as object) && 'isResearched' in (item as object);
}

/** ResearchNode.cs 140 IsEquivalent(researchNode): same Name, Industry, Category, TechLevel and Row. */
function researchNodeIsEquivalent(a: TechNode, b: TechNode): boolean {
    return b.def.name === a.def.name && b.def.industry === a.def.industry && b.def.category === a.def.category && b.def.techLevel === a.def.techLevel && b.def.row === a.def.row;
}

/** ResearchNodeList.cs 1063 IndexOf(researchNode): the first equivalent node. */
function researchNodeListIndexOf(list: readonly TechNode[], researchNode: TechNode): number {
    for (let index = 0; index < list.length; ++index) if (researchNodeIsEquivalent(list[index], researchNode)) return index;
    return -1;
}

/** ResearchNodeList.cs 1050 GetEquivalent(researchNode): this[ResearchNodeId] when in range. */
export function techTreeGetEquivalent(tree: readonly TechNode[], researchNode: TechNode | null): TechNode | null {
    return researchNode != null && tree.length > researchNode.def.projectId ? tree[researchNode.def.projectId] : null;
}

/** Component by id (ResearchNode.Components / ComponentImprovement.ImprovedComponent). */
function componentById(galaxy: Galaxy, componentId: number): Component | null {
    return galaxy.researchStatic?.componentsById.get(componentId) ?? null;
}

/** ResearchNode.cs 73 CheckAnyComponentTypeMatches(type). */
function researchNodeCheckAnyComponentTypeMatches(galaxy: Galaxy, node: TechNode, type: ComponentType): boolean {
    if (node.def.components != null) {
        for (let index = 0; index < node.def.components.length; ++index) {
            const component = componentById(galaxy, node.def.components[index]);
            if (component != null && component.type === type) return true;
        }
        for (let index = 0; index < node.def.componentImprovements.length; ++index) {
            const improved = componentById(galaxy, node.def.componentImprovements[index].componentId);
            if (improved != null && improved.type === type) return true;
        }
    }
    return false;
}

/** DesignSpecificationList.cs 108 CheckAnyDesignSpecificationsUseComponent → ComponentRuleList.cs 14 CheckAnyRulesUseComponent. */
function checkAnyDesignSpecificationsUseComponent(specs: readonly (DesignSpecification | null)[], component: Component): boolean {
    for (let index = 0; index < specs.length; ++index) {
        const designSpecification = specs[index];
        if (designSpecification == null || designSpecification.componentRules == null) continue;
        for (let i = 0; i < designSpecification.componentRules.length; ++i) {
            const rule = designSpecification.componentRules[i];
            if (rule != null && (rule.componentRuleType === DesignSpecificationComponentRuleType.MustHave || rule.componentRuleType === DesignSpecificationComponentRuleType.ShouldHave)) {
                if (rule.componentType !== ComponentType.Undefined) {
                    if (component.type === rule.componentType) return true;
                } else if (rule.componentCategory !== ComponentCategoryType.Undefined && resolveComponentCategoryForType(component.type) === rule.componentCategory) {
                    return true;
                }
            }
        }
    }
    return false;
}

/** Galaxy.4.cs 4551 ValueResearchProjectForEmpire(project, requestingEmpire). No Rnd. */
export function valueResearchProjectForEmpire(galaxy: Galaxy, project: TechNode | null, requestingEmpire: Empire): number {
    let num = -1;
    if (project != null) {
        // C# dereferences GetEquivalent(project) unguarded.
        const num2 = Math.trunc(project.cost - techTreeGetEquivalent(requestingEmpire.research.techTree, project)!.progress);
        let num3 = 0;
        for (let i = 0; i < galaxy.empires.length; i++) {
            const empire = galaxy.empires[i];
            if (techTreeGetEquivalent(empire.research.techTree, project)!.isResearched) num3++;
        }
        num = Math.trunc(num2 * 3.0);
        if (requestingEmpire.research.allowedRacesCount(project) > 0) num *= 5;
        if (num3 > 1) num = Math.trunc(num / Math.sqrt(num3));
        let flag = false;
        const def = project.def;
        if ((def.components.length > 0 || def.componentImprovements.length > 0) && def.abilities.length <= 0 && def.fighters.length <= 0 && def.facilityId == null) {
            if (def.components.length > 0) {
                for (let j = 0; j < def.components.length; j++) {
                    const component = componentById(galaxy, def.components[j]);
                    if (component != null && requestingEmpire.designSpecifications != null && checkAnyDesignSpecificationsUseComponent(requestingEmpire.designSpecifications, component)) {
                        flag = true;
                        break;
                    }
                }
            }
            if (def.componentImprovements.length > 0) {
                for (let k = 0; k < def.componentImprovements.length; k++) {
                    const componentImprovement = def.componentImprovements[k];
                    if (componentImprovement != null) {
                        const improvedComponent = componentById(galaxy, componentImprovement.componentId);
                        if (improvedComponent != null && requestingEmpire.designSpecifications != null && checkAnyDesignSpecificationsUseComponent(requestingEmpire.designSpecifications, improvedComponent)) {
                            flag = true;
                            break;
                        }
                    }
                }
            }
        }
        if (requestingEmpire !== galaxy.playerEmpire && !flag) num = 0;
        if (requestingEmpire === galaxy.playerEmpire) num = Math.trunc(num * (galaxy.playerEmpire.difficultyLevel * galaxy.playerEmpire.difficultyLevel));
        if (num > 1073741823) num = 1073741823;
    }
    return num | 0;
}

/** Galaxy.4.cs 4305 ResolveTradeableItemsResearchProjects(giver, receiver, refactor, includeSpecialTech) → 4310 (includeWarpColonizationWeapons: true). */
export function resolveTradeableItemsResearchProjects(galaxy: Galaxy, giver: Empire, receiver: Empire, refactorValuesForEmpire: boolean, includeSpecialTech: boolean, includeWarpColonizationWeapons = true): TradeableItem[] {
    const tradeableItemList: TradeableItem[] = [];
    const researchNodeList = resolveMoreAdvancedProjectsIncludeSpecial(receiver, giver, includeSpecialTech);
    for (let i = 0; i < researchNodeList.length; i++) {
        const researchNode = researchNodeList[i];
        if (!researchNode.selfResearched) continue;
        let flag = true;
        if (!includeWarpColonizationWeapons) {
            switch (nodeCategory(researchNode)) {
                case ComponentCategoryType.WeaponBeam:
                case ComponentCategoryType.WeaponTorpedo:
                case ComponentCategoryType.WeaponArea:
                case ComponentCategoryType.WeaponPointDefense:
                case ComponentCategoryType.WeaponIon:
                case ComponentCategoryType.WeaponGravity:
                case ComponentCategoryType.AssaultPod:
                case ComponentCategoryType.Fighter:
                case ComponentCategoryType.HyperDrive:
                case ComponentCategoryType.WeaponSuperBeam:
                case ComponentCategoryType.WeaponSuperArea:
                case ComponentCategoryType.WeaponSuperTorpedo:
                    flag = false;
                    break;
            }
            if (resolveResearchAbilityType(researchNode) === ResearchAbilityType.ColonizeHabitatType) flag = false;
            if (researchNodeCheckAnyComponentTypeMatches(galaxy, researchNode, ComponentType.HabitationColonization)) flag = false;
        }
        if (flag) {
            let num = valueResearchProjectForEmpire(galaxy, researchNode, receiver);
            const num2 = 0.67 / galaxy.difficultyLevel;
            if (giver === galaxy.playerEmpire) num = Math.trunc(num * num2);
            else if (receiver === galaxy.playerEmpire) num = Math.trunc(num / num2);
            if (num >= 0 && refactorValuesForEmpire) num = refactorValueForEmpire(galaxy, num, receiver, giver);
            if (num > 0) tradeableItemList.push(new TradeableItem(TradeableItemType.ResearchProject, researchNode, num));
        }
    }
    return tradeableItemList;
}

// ---------------------------------------------------------------------------------------------------------------
// Acceptance (Empire.7.cs 2758-2837) and delivery (Galaxy.4.cs 3808).
// ---------------------------------------------------------------------------------------------------------------

/** Empire.7.cs 2758 DetermineAcceptTerritoryMapTrade(offeredValue, offeringEmpire). */
export function determineAcceptTerritoryMapTrade(galaxy: Galaxy, self: Empire, offeredValue: number, offeringEmpire: Empire): boolean {
    let flag = false;
    if (self.pirateEmpireBaseHabitat === null && offeringEmpire.pirateEmpireBaseHabitat === null) {
        const ev = obtainEmpireEvaluation(galaxy, self, offeringEmpire);
        if (ev.overallAttitude >= TRADE_TERRITORY_MAP_THRESHHOLD && !self.reclusive) flag = true;
    } else {
        const pirateRelation = obtainPirateRelation(self, offeringEmpire);
        if (pirateRelationEvaluation(pirateRelation) >= TRADE_TERRITORY_MAP_THRESHHOLD && !self.reclusive) flag = true;
    }
    if (flag) {
        const num = refactorValueForEmpire(galaxy, valueTerritoryMapForEmpire(galaxy, self, offeringEmpire), offeringEmpire, self);
        const num2 = Math.trunc(num * 0.75);
        if (offeredValue >= num2) return true;
    }
    return false;
}

/** Empire.7.cs 2789 CheckKnowledgeOfSecretLocations(otherEmpire). */
export function checkKnowledgeOfSecretLocations(self: Empire, otherEmpire: Empire): boolean {
    const known = self.visibility.knownGalaxyLocations;
    const list = [
        ...known.filter((l) => l.type === GalaxyLocationType.RestrictedArea),
        ...known.filter((l) => l.type === GalaxyLocationType.DebrisField),
        ...known.filter((l) => l.type === GalaxyLocationType.PlanetDestroyer),
    ];
    for (const item of list) {
        if (!otherEmpire.visibility.knownGalaxyLocations.includes(item)) return true;
    }
    return false;
}

/** Empire.7.cs 2824 DetermineAcceptGalaxyMapTrade(offeredValue, offeringEmpire). */
export function determineAcceptGalaxyMapTrade(galaxy: Galaxy, self: Empire, offeredValue: number, offeringEmpire: Empire): boolean {
    const num = obtainAttitude(galaxy, self, offeringEmpire);
    if (num >= TRADE_GALAXY_MAP_THRESHHOLD && !self.reclusive) {
        const num2 = refactorValueForEmpire(galaxy, valueGalaxyMapForEmpire(galaxy, self, offeringEmpire), offeringEmpire, self);
        const num3 = Math.trunc(num2 * 0.85);
        if (offeredValue >= num3 && !checkKnowledgeOfSecretLocations(self, offeringEmpire)) return true;
    }
    return false;
}

/** Galaxy.4.cs 3808 GiveTerritoryMap(giver, receiver). TODO(port) M4t: the player's ReviewEmpireTerritory(onlySystems) refresh. */
export function giveTerritoryMap(galaxy: Galaxy, giver: Empire | null, receiver: Empire | null): void {
    if (giver === null || receiver === null) return;
    const habitatList = determineEmpireSystems(galaxy, giver);
    for (const item of habitatList) {
        // DetermineHabitatsInSystem(item): the same test once per habitat of the system (idempotent).
        const n = Math.max(1, galaxy.systems[item.systemIndex].habitats.length);
        for (let k = 0; k < n; k++) {
            const status = receiver.systemVisibility[item.systemIndex].status;
            if (status !== SystemVisibilityStatus.Visible) receiver.visibility.setSystemVisibility(item, SystemVisibilityStatus.Explored);
        }
    }
    if (giver.pirateEmpireBaseHabitat !== null && giver.spacePorts != null && receiver.knownPirateBases != null) {
        for (let i = 0; i < giver.spacePorts.length; i++) {
            const builtObject = giver.spacePorts[i];
            if (builtObject == null || builtObject.hasBeenDestroyed) continue;
            if (builtObject.nearestSystemStar !== null) {
                const status2 = receiver.systemVisibility[builtObject.nearestSystemStar.systemIndex].status;
                if (status2 !== SystemVisibilityStatus.Visible) receiver.visibility.setSystemVisibility(builtObject.nearestSystemStar, SystemVisibilityStatus.Explored);
            }
            if (!receiver.knownPirateBases.includes(builtObject)) receiver.knownPirateBases.push(builtObject);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// TradeItems (Empire.7.cs 2576).
// ---------------------------------------------------------------------------------------------------------------

/**
 * Empire.7.cs 2576 TradeItems: offer one map (or, for allies, a tech) to each befriended empire not offered one recently.
 * Rnd: Next(0, items.Count) per offer considered.
 */
export function tradeItems(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    const currentStarDate = galaxyStarDate(galaxy);
    const num = currentStarDate - Math.trunc(MINIMUM_DIPLOMACY_TRADE_PROPOSAL_INTERVAL_YEARS * galaxyColonyFillFactor(galaxy) * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
    if (self === galaxy.playerEmpire) return;
    for (let i = 0; i < self.diplomaticRelations.count; i++) {
        const diplomaticRelation = self.diplomaticRelations.at(i);
        if (
            diplomaticRelation.type === DiplomaticRelationType.NotMet ||
            diplomaticRelation.type === DiplomaticRelationType.TradeSanctions ||
            diplomaticRelation.type === DiplomaticRelationType.War ||
            diplomaticRelation.lastTradeDealOfferDate > num ||
            (diplomaticRelation.strategy !== DiplomaticStrategy.Ally && diplomaticRelation.strategy !== DiplomaticStrategy.Befriend)
        ) {
            continue;
        }
        const other = diplomaticRelation.otherEmpire!;
        const overallAttitude = obtainEmpireEvaluation(galaxy, self, other).overallAttitude;
        const tradeableItemList: TradeableItem[] = [];
        let num2 = TRADE_RESEARCH_THRESHHOLD;
        if (other === galaxy.playerEmpire) num2 = Math.trunc(TRADE_RESEARCH_THRESHHOLD * galaxy.difficultyLevel);
        if (diplomaticRelation.strategy === DiplomaticStrategy.Ally && overallAttitude >= num2 && ALLOW_TECH_TRADING) {
            let num3 = TRADE_RESEARCH_SPECIAL_THRESHHOLD;
            if (other === galaxy.playerEmpire) num3 = Math.trunc(TRADE_RESEARCH_SPECIAL_THRESHHOLD * galaxy.difficultyLevel);
            const includeSpecialTech = overallAttitude >= num3;
            // RND: with research items stubbed (M4k) the Next(0, Count) below draws over maps only.
            tradeableItemList.push(...resolveTradeableItemsResearchProjects(galaxy, self, other, true, includeSpecialTech));
        }
        if (diplomaticRelation.type !== DiplomaticRelationType.MutualDefensePact && diplomaticRelation.type !== DiplomaticRelationType.Protectorate) {
            tradeableItemList.push(...resolveTradeableItemsMaps(galaxy, self, other, true));
        }
        if (tradeableItemList.length <= 0) continue;
        const index = galaxy.rnd.next(0, tradeableItemList.length);
        const tradeableItem = tradeableItemList[index];
        let flag = true;
        let description = 'We offer ';
        switch (tradeableItem.type) {
            case TradeableItemType.TerritoryMap: {
                description = formatText(getText('Trade Swap Maps'), tradeableItem.toString());
                const offeredValue2 = refactorValueForEmpire(galaxy, valueTerritoryMapForEmpire(galaxy, other, self), self, other);
                flag = determineAcceptTerritoryMapTrade(galaxy, self, offeredValue2, other);
                break;
            }
            case TradeableItemType.GalaxyMap: {
                description = formatText(getText('Trade Swap Maps'), tradeableItem.toString());
                const offeredValue = refactorValueForEmpire(galaxy, valueGalaxyMapForEmpire(galaxy, other, self), self, other);
                flag = determineAcceptGalaxyMapTrade(galaxy, self, offeredValue, other);
                break;
            }
            case TradeableItemType.ResearchProject: {
                let arg = tradeableItem.toString();
                const node = tradeableItem.item as { name?: string } | null;
                if (node !== null && node.name !== undefined) arg = node.name;
                description = formatText(getText('Trade Tech'), arg, String(tradeableItem.value));
                const num4 = tradeableItem.value * 1.2;
                if (other.stateMoney < num4) flag = false;
                break;
            }
        }
        if (flag) {
            diplomaticRelation.lastTradeDealOfferDate = currentStarDate;
            sendMessageToEmpire(self, other, EmpireMessageType.OfferTrade, tradeableItem, description);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// TradeableItemList helpers (TradeableItemList.cs).
// ---------------------------------------------------------------------------------------------------------------

/** TradeableItemList.cs 100 ExtractHighOrderedItemsByType(types): matching items, sorted by Value (List.Sort), reversed. */
export function extractHighOrderedItemsByType(list: readonly TradeableItem[], types: readonly TradeableItemType[]): TradeableItem[] {
    const ordered: TradeableItem[] = [];
    if (types != null && types.length > 0) {
        for (const tradeableItem of list) {
            for (let index = 0; index < types.length; index++) {
                if (tradeableItem.type === types[index]) ordered.push(tradeableItem);
            }
        }
        netSort(ordered, (a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
        ordered.reverse();
    }
    return ordered;
}

/** TradeableItemList.cs 121 ContainsType(type). */
export function containsType(list: readonly TradeableItem[], type: TradeableItemType): boolean {
    for (const t of list) if (t.type === type) return true;
    return false;
}

/** List<T>.Remove (reference equality — TradeableItemList.IndexOf is `new`, not used by Remove). */
function removeItem(list: TradeableItem[], item: TradeableItem): void {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Values (Galaxy.4.cs 3545-3680, 4165, 4519-4770; Galaxy.5.cs 20-120; Empire.4.cs 4199-4400).
// ---------------------------------------------------------------------------------------------------------------

const MAX_SOLAR_SYSTEM_SIZE = 23000;

/** Galaxy.cs 1198 TotalMoneyInGalaxy. */
function totalMoneyInGalaxy(galaxy: Galaxy): number {
    let num = 0.0;
    for (let i = 0; i < galaxy.empires.length; i++) {
        num += galaxy.empires[i].stateMoney;
        num += galaxy.empires[i].privateMoney;
    }
    return num;
}

/** Galaxy.4.cs 3578 GetMoneyRate. */
export function getMoneyRate(galaxy: Galaxy): number {
    return totalMoneyInGalaxy(galaxy) / 1000000.0;
}

/** Galaxy.4.cs 3583 ValueMoney(moneyAmount). */
export function valueMoney(moneyAmount: number): number {
    return Math.trunc(moneyAmount);
}

/** Galaxy.4.cs 3545 CalculateDistanceFactor(distance). */
function calculateDistanceFactor(distance: number): number {
    return Math.max(1000000000.0, Math.pow(distance, 1.8)) / 1000000000.0;
}

/** C# (long) clamp to 2^30−1 then (int). */
function clampValue(num: number): number {
    if (num > 1073741823) num = 1073741823;
    return num | 0;
}

/** Galaxy.1.cs 1367 CheckColonizationLikeliness(potentialColony, colonizingRace). */
export function checkColonizationLikeliness(galaxy: Galaxy, potentialColony: Habitat, colonizingRace: Race): number {
    let num = colonizingRace.friendliness - colonizingRace.aggression;
    let num2 = 100;
    if (potentialColony.empire === galaxy.independentEmpire && potentialColony.population != null && potentialColony.population.dominantRace !== null) {
        const dominantRace = potentialColony.population.dominantRace;
        num2 = dominantRace.friendliness - dominantRace.aggression;
        if (dominantRace === colonizingRace) {
            num2 += 35;
            num2 = Math.max(5, num2);
            num += 25;
            num = Math.max(5, num);
        } else if (dominantRace.raceFamily === colonizingRace.raceFamily) {
            num2 += 20;
            num += 15;
        }
    }
    return num + num2;
}

/** Empire.4.cs 4272 DetermineResourceValue(habitat). */
export function determineResourceValue(galaxy: Galaxy, self: Empire, habitat: Habitat): number {
    let num = 1.0;
    if (self.resourceMap != null && self.resourceMap.checkResourcesKnown(habitat)) {
        const prices = galaxyResourceCurrentPrices(galaxy);
        const list = habitat.resources != null ? habitat.resources.slice() : [];
        for (let i = 0; i < list.length; i++) {
            const habitatResource = list[i];
            if (habitatResource != null) {
                let num2 = prices[habitatResource.resourceId] / 10.0;
                let num3 = 100.0;
                const isRestricted = (galaxy.resourceSystem.resources[habitatResource.resourceId]?.superLuxuryBonusAmount ?? 0) > 0; // Resource.cs 34
                if (self.policy != null && isRestricted) {
                    num2 *= 50.0;
                    num3 = 2000.0;
                    num2 *= self.policy.controlRestrictedResourcesPriority;
                    num3 *= self.policy.controlRestrictedResourcesPriority;
                }
                if (num2 > num3) num2 = num3;
                if (num2 < 0.1) num2 = 0.1;
                num += num2;
            }
        }
    }
    return num;
}

/** Empire.4.cs 4370 DetermineProximityFromMajorColony(habitat, strategicThreshold). */
function determineProximityFromMajorColony(galaxy: Galaxy, self: Empire, habitat: Habitat | null, strategicThreshold: number): number {
    if (habitat !== null) {
        let habitat2 = fastFindNearestColony(galaxy, habitat.xpos, habitat.ypos, self, strategicThreshold);
        if (habitat2 === null) habitat2 = self.capital;
        if (habitat2 !== null) return calculateDistanceFactor(galaxy.calculateDistance(habitat.xpos, habitat.ypos, habitat2.xpos, habitat2.ypos));
    }
    return 1.0;
}

/** Empire.4.cs 4199 DetermineColonizationValue(habitat). */
export function determineColonizationValue(galaxy: Galaxy, self: Empire, habitat: Habitat): number {
    let num = Math.trunc(Math.fround(habitat.quality * habitat.quality) * 20000.0);
    let num2 = 1.0;
    if (habitat.population != null && habitat.population.items.length > 0 && (habitat.empire === galaxy.independentEmpire || habitat.empire === null)) {
        let val = checkColonizationLikeliness(galaxy, habitat, self.dominantRace!);
        val = Math.min(105, val);
        let num3 = 1.0 + val / 100.0;
        num3 *= num3;
        num3 *= num3;
        num3 *= 1.0 + Math.sqrt(Math.trunc(habitat.population.totalAmount / 10000000));
        num *= num3;
        num2 = 3.0;
    }
    const ruin = habitat.ruin;
    if (ruin !== null) {
        num *= 1.0 + ruin.developmentBonus;
        if (ruin.bonusDefensive > 0.0 || ruin.bonusDiplomacy > 0.0 || ruin.bonusHappiness > 0.0 || ruin.bonusResearchEnergy > 0.0 || ruin.bonusResearchHighTech > 0.0 || ruin.bonusResearchWeapons > 0.0 || ruin.bonusWealth > 0.0) num *= 30.0;
        num *= self.policy!.colonizeRuinsPriority;
    }
    let d = determineResourceValue(galaxy, self, habitat);
    d = Math.sqrt(d);
    num *= d;
    let num4 = 1.0;
    const p = self.policy!;
    switch (habitat.type) {
        case HabitatType.Continental: num4 = p.colonizeContinentalPriority; break;
        case HabitatType.MarshySwamp: num4 = p.colonizeMarshySwampPriority; break;
        case HabitatType.Ocean: num4 = p.colonizeOceanPriority; break;
        case HabitatType.Desert: num4 = p.colonizeDesertPriority; break;
        case HabitatType.Ice: num4 = p.colonizeIcePriority; break;
        case HabitatType.Volcanic: num4 = p.colonizeVolcanicPriority; break;
    }
    num *= num4;
    num /= determineProximityFromMajorColony(galaxy, self, habitat, 50000) / num2;
    return num | 0; // (int)num (unchecked)
}

/** Galaxy.4.cs 3589 ValueColonyForEmpire(colony, empire). */
export function valueColonyForEmpire(galaxy: Galaxy, colony: Habitat, empire: Empire): number {
    const num2 = determineColonizationValue(galaxy, empire, colony);
    const num3 = Math.trunc(strategicValue(colony) * 1.5);
    let num = num3 + num2 * 100;
    if (empire === galaxy.playerEmpire) num = Math.trunc(num * (galaxy.playerEmpire.difficultyLevel * galaxy.playerEmpire.difficultyLevel));
    num = Math.trunc(num * getMoneyRate(galaxy));
    return clampValue(num);
}

/** Empire.4.cs 4398 DetermineProximityFromCapital(BuiltObject). */
function determineProximityFromCapitalBuiltObject(galaxy: Galaxy, self: Empire, bo: BuiltObject): number {
    const c = self.pirateEmpireBaseHabitat === null ? self.capital! : self.pirateEmpireBaseHabitat;
    return Math.sqrt(Math.sqrt(1.0 + galaxy.calculateDistance(c.xpos, c.ypos, bo.xpos, bo.ypos)) / 100.0);
}

/** Galaxy.4.cs 3607 ValueBaseForEmpire(station, empire). */
export function valueBaseForEmpire(galaxy: Galaxy, station: BuiltObject, empire: Empire): number {
    let result = -1;
    if (station.role === BuiltObjectRole.Base) {
        let num = 1.0;
        switch (station.subRole) {
            case BuiltObjectSubRole.GasMiningStation:
            case BuiltObjectSubRole.MiningStation: {
                const parentHabitat2 = station.parentHabitat;
                if (parentHabitat2 !== null) num = determineResourceValue(galaxy, empire, parentHabitat2) * 2000.0;
                break;
            }
            case BuiltObjectSubRole.EnergyResearchStation:
            case BuiltObjectSubRole.WeaponsResearchStation:
            case BuiltObjectSubRole.HighTechResearchStation: {
                const num3 = station.researchEnergy + station.researchHighTech + station.researchWeapons;
                num = Math.max(100.0, num3 / 5.0);
                break;
            }
            case BuiltObjectSubRole.MonitoringStation:
                num = 20000.0;
                break;
            case BuiltObjectSubRole.DefensiveBase:
                num = 5000.0;
                break;
            case BuiltObjectSubRole.GenericBase:
                num = 5000.0;
                if (station.design != null && station.design.name.toLowerCase().includes(getText('Research').toLowerCase())) {
                    const num2 = station.researchEnergy + station.researchHighTech + station.researchWeapons;
                    num = Math.max(100.0, num2 / 5.0);
                } else if (station.sensorLongRange > 0) {
                    num = 20000.0;
                }
                break;
            case BuiltObjectSubRole.SmallSpacePort:
            case BuiltObjectSubRole.MediumSpacePort:
            case BuiltObjectSubRole.LargeSpacePort: {
                num = 15000.0;
                const parentHabitat = station.parentHabitat;
                if (parentHabitat !== null) num = Math.max(num, strategicValue(parentHabitat) * 0.5);
                break;
            }
            case BuiltObjectSubRole.ResortBase:
                num = 15000.0;
                break;
        }
        const num4 = determineProximityFromCapitalBuiltObject(galaxy, empire, station);
        result = Math.trunc(num * num4) | 0;
        const val = Math.trunc(1000000.0 * (station.annualSupportCost / totalMoneyInGalaxy(galaxy))) | 0;
        if (empire === galaxy.playerEmpire) result = Math.trunc(result * (galaxy.playerEmpire.difficultyLevel * galaxy.playerEmpire.difficultyLevel)) | 0;
        result = Math.max(result, val);
        result = Math.trunc(result * getMoneyRate(galaxy)) | 0;
    }
    return result;
}

/** Empire.8.cs 3294 ResolveTypicalAttitudeLevel(type, out lowerLevel, out upperLevel) — only upperLevel is read here. */
function resolveTypicalAttitudeUpperLevel(type: DiplomaticRelationType): number {
    switch (type) {
        case DiplomaticRelationType.War: return -50;
        case DiplomaticRelationType.TradeSanctions: return -25;
        case DiplomaticRelationType.Truce: return -25;
        case DiplomaticRelationType.SubjugatedDominion: return 0;
        case DiplomaticRelationType.None: return 24;
        case DiplomaticRelationType.FreeTradeAgreement: return 49;
        default: return 2147483647;
    }
}

/** Shared body of Galaxy.4.cs 4652 ValueDeclareWarOnEmpire / 4692 ValueInitiateTradeSanctionsAgainstEmpire. */
function valueActionAgainstEmpire(galaxy: Galaxy, empire: Empire, targetEmpire: Empire, war: boolean): number {
    let num = -1;
    const diplomaticRelation = obtainDiplomaticRelation(empire, targetEmpire);
    const ok = war
        ? diplomaticRelation != null && diplomaticRelation.type !== DiplomaticRelationType.War && diplomaticRelation.type !== DiplomaticRelationType.NotMet
        : diplomaticRelation != null && diplomaticRelation.type !== DiplomaticRelationType.TradeSanctions && diplomaticRelation.type !== DiplomaticRelationType.War && diplomaticRelation.type !== DiplomaticRelationType.NotMet;
    if (ok) {
        let num2 = 1.0;
        const upperLevel = resolveTypicalAttitudeUpperLevel(war ? DiplomaticRelationType.War : DiplomaticRelationType.TradeSanctions);
        const ev = obtainEmpireEvaluation(galaxy, empire, targetEmpire);
        if (ev != null) num2 = ev.overallAttitude <= upperLevel ? 1.0 : ev.overallAttitude - upperLevel;
        if (diplomaticRelation.type === DiplomaticRelationType.FreeTradeAgreement) {
            const num3 = Math.max(1.0, loyaltyLevel(empire) / 100.0);
            num2 = num2 * 2.0 * (num3 * num3);
        } else if (diplomaticRelation.type === DiplomaticRelationType.MutualDefensePact || diplomaticRelation.type === DiplomaticRelationType.Protectorate) {
            const num4 = Math.max(1.0, loyaltyLevel(empire) / 100.0);
            num2 = num2 * 3.5 * (num4 * num4 * num4);
        }
        num2 = Math.pow(num2, 0.75);
        let num5 = weightedMilitaryPotency(targetEmpire) / weightedMilitaryPotency(empire);
        if (targetEmpire === galaxy.playerEmpire) num5 /= galaxy.playerEmpire.difficultyLevel * galaxy.playerEmpire.difficultyLevel;
        num5 = Math.min(Math.max(num5, 0.5), 10.0);
        num = Math.trunc(num2 * num5 * (war ? 10000.0 : 4000.0));
    }
    num = Math.trunc(num * getMoneyRate(galaxy));
    return clampValue(num);
}
export function valueDeclareWarOnEmpire(galaxy: Galaxy, empire: Empire, targetEmpire: Empire): number {
    return valueActionAgainstEmpire(galaxy, empire, targetEmpire, true);
}
export function valueInitiateTradeSanctionsAgainstEmpire(galaxy: Galaxy, empire: Empire, targetEmpire: Empire): number {
    return valueActionAgainstEmpire(galaxy, empire, targetEmpire, false);
}

/** Galaxy.4.cs 4165 UpdateValueDeclareWarOnEmpire(value, requester, giver, targetEmpire). */
export function updateValueDeclareWarOnEmpire(value: number, requester: Empire, giver: Empire, targetEmpire: Empire): number {
    const diplomaticRelation = obtainDiplomaticRelation(giver, targetEmpire);
    const diplomaticRelation2 = obtainDiplomaticRelation(giver, requester);
    if ((diplomaticRelation2.type === DiplomaticRelationType.MutualDefensePact || (diplomaticRelation2.type === DiplomaticRelationType.Protectorate && diplomaticRelation2.initiator === giver)) && diplomaticRelation.type !== DiplomaticRelationType.MutualDefensePact && diplomaticRelation.type !== DiplomaticRelationType.Protectorate) value = 0;
    return value;
}

/** Galaxy.4.cs 4732 ValueEndWarAgainstUs(attackingEmpire, targetEmpire). */
export function valueEndWarAgainstUs(galaxy: Galaxy, attackingEmpire: Empire, targetEmpire: Empire): number {
    let num = -1;
    if (attackingEmpire !== targetEmpire) {
        const diplomaticRelation = obtainDiplomaticRelation(attackingEmpire, targetEmpire);
        if (diplomaticRelation.type === DiplomaticRelationType.War) {
            num = 10000;
            const v = determineVictorInWar(diplomaticRelation);
            if (v.victor === attackingEmpire) {
                let num2 = weightedMilitaryPotency(v.victor) / weightedMilitaryPotency(v.loser);
                if (v.loser === galaxy.playerEmpire) num2 *= galaxy.playerEmpire.difficultyLevel * galaxy.playerEmpire.difficultyLevel;
                num2 = Math.min(Math.max(num2, 0.5), 5.0);
                num = Math.trunc(num2 * 80000.0 * v.winningRatio);
            } else {
                let val = weightedMilitaryPotency(v.loser) / weightedMilitaryPotency(v.victor);
                val = Math.min(Math.max(val, 0.5), 5.0);
                num = Math.trunc((val * 40000.0) / v.winningRatio);
            }
        }
    }
    return clampValue(num);
}

/** Galaxy.5.cs 59 ValueLiftTradeSanctionsAgainstUs(attackingEmpire, targetEmpire). */
export function valueLiftTradeSanctionsAgainstUs(galaxy: Galaxy, attackingEmpire: Empire, targetEmpire: Empire): number {
    let num = -1;
    if (attackingEmpire !== targetEmpire) {
        const diplomaticRelation = obtainDiplomaticRelation(attackingEmpire, targetEmpire);
        if (diplomaticRelation.type === DiplomaticRelationType.TradeSanctions) {
            num = 5000;
            let num2 = weightedMilitaryPotency(attackingEmpire) / weightedMilitaryPotency(targetEmpire);
            if (targetEmpire === galaxy.playerEmpire) num2 *= galaxy.playerEmpire.difficultyLevel * galaxy.playerEmpire.difficultyLevel;
            num2 = Math.min(Math.max(num2, 0.5), 5.0);
            num = Math.trunc(num2 * 15000.0);
        }
    }
    return clampValue(num);
}

/**
 * Galaxy.5.cs 20 ValueEndWarWithEmpire / 84 ValueLiftTradeSanctionsAgainstEmpire(requestingEmpire, empire, targetEmpire).
 * The sanctions variant reads empire.EmpireEvaluations[requestingEmpire] (no add) where the war variant calls ObtainEmpireEvaluation.
 */
function valueStopActionWithEmpire(galaxy: Galaxy, requestingEmpire: Empire, empire: Empire, targetEmpire: Empire, war: boolean): number {
    let num = -1;
    const diplomaticRelation = obtainDiplomaticRelation(empire, targetEmpire);
    if (diplomaticRelation.otherEmpire !== empire && diplomaticRelation.type !== DiplomaticRelationType.NotMet) {
        const diplomaticRelation2 = obtainDiplomaticRelation(requestingEmpire, diplomaticRelation.otherEmpire);
        if (diplomaticRelation2 != null && diplomaticRelation2.type !== DiplomaticRelationType.NotMet && diplomaticRelation.type === (war ? DiplomaticRelationType.War : DiplomaticRelationType.TradeSanctions)) {
            const ev = obtainEmpireEvaluation(galaxy, requestingEmpire, targetEmpire);
            const num2 = 30;
            if (ev.overallAttitude > num2) {
                let num3 = 0;
                const ev2 = war ? obtainEmpireEvaluation(galaxy, empire, requestingEmpire) : empireEvaluationByEmpire(empireEvaluationsOf(empire), requestingEmpire);
                if (ev2 !== null) num3 = ev2.overallAttitude;
                num3 = 60 - num3;
                if (num3 < 20) num3 = 20;
                let val = weightedMilitaryPotency(empire) / weightedMilitaryPotency(requestingEmpire);
                const num4 = (ev.overallAttitude - num2) / 20.0;
                val = Math.min(Math.max(val, 0.5), 5.0);
                num = Math.trunc(num3 * val * num4 * (war ? 2000.0 : 900.0));
            }
        }
    }
    num = Math.trunc(num * getMoneyRate(galaxy));
    return clampValue(num);
}

// ---------------------------------------------------------------------------------------------------------------
// ResolveTradeableItems (Galaxy.4.cs 4176-4474, BaconGalaxy.cs 165).
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.7.cs 2317/2332 FindNearestHabitat(x, y): SystemsIndex ring search over HabitatIndex (any type). */
function findNearestHabitat(galaxy: Galaxy, x: number, y: number): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    return galaxy.ringSearch(x, y, (cx, cy) => {
        let habitat: Habitat | null = null;
        let distance = Number.MAX_VALUE;
        for (const h of galaxy.habitatIndexGrid[cx][cy]) {
            const dx = ix - h.xpos;
            const dy = iy - h.ypos;
            const num = dx * dx + dy * dy;
            if (!(num < distance)) continue;
            habitat = h;
            distance = num;
        }
        if (habitat !== null) distance = galaxy.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
        return { item: habitat, distance };
    });
}

/** Empire.9.cs 3019 IsObjectAreaKnownToThisEmpire(stellarObject). */
export function isObjectAreaKnownToThisEmpire(galaxy: Galaxy, self: Empire, obj: Habitat | BuiltObject): boolean {
    const habitat = findNearestHabitat(galaxy, obj.xpos, obj.ypos);
    if (habitat !== null) {
        const num = galaxy.calculateDistance(obj.xpos, obj.ypos, habitat.xpos, habitat.ypos);
        if (num <= MAX_SOLAR_SYSTEM_SIZE * 2.1 && self.visibility.checkSystemExplored(habitat.systemIndex)) return true;
    }
    return isObjectVisibleToThisEmpire(galaxy, self, obj);
}

/** SystemInfo.OtherEmpires.Contains(empire) (EmpireSystemSummaryList.cs 14); the TS list is null when empty. */
function otherEmpiresContains(sys: SystemInfo, empire: Empire): boolean {
    return sys.otherEmpires != null && sys.otherEmpires.some((s) => s.empire === empire);
}
/** SystemInfo.IsDisputed (Galaxy.1.cs 1016: more than one empire has colonies in the system). */
function systemIsDisputed(sys: SystemInfo): boolean {
    return sys.dominantEmpire != null && sys.otherEmpires != null && sys.otherEmpires.length > 0;
}

/** Galaxy.4.cs 4300 → BaconGalaxy.cs 165 ResolveTradeableItemsColoniesBases(giver, receiver, refactorValuesForEmpire). */
export function resolveTradeableItemsColoniesBases(galaxy: Galaxy, giver: Empire, receiver: Empire, refactorValuesForEmpire: boolean): TradeableItem[] {
    const list: TradeableItem[] = [];
    if (giver !== null && receiver !== null) {
        // `habitat` (nearest giver colony to the receiver's capital / pirate base) is computed and unused in the Bacon version.
        if (receiver.capital !== null) fastFindNearestColony(galaxy, Math.trunc(receiver.capital.xpos), Math.trunc(receiver.capital.ypos), giver, 0);
        const habitatList1: Habitat[] = [];
        const habitatList2: Habitat[] = [];
        if (giver.colonies != null) {
            for (let index = 0; index < giver.colonies.length; index++) {
                const colony = giver.colonies[index];
                if (colony != null && colony.owner === giver && isObjectAreaKnownToThisEmpire(galaxy, receiver, colony)) {
                    const habitatSystemStar = galaxy.determineHabitatSystemStar(colony);
                    const sys = galaxy.systems[habitatSystemStar.systemIndex];
                    if (BACON_TRADE_EVERYTHING) {
                        habitatList2.push(colony);
                    } else if (systemIsDisputed(sys) && sys.dominantEmpire != null && sys.dominantEmpire.empire === receiver) {
                        if (!habitatList1.includes(habitatSystemStar)) habitatList1.push(habitatSystemStar);
                        if (!habitatList2.includes(colony)) habitatList2.push(colony);
                    }
                }
            }
        }
        for (let index = 0; index < habitatList2.length; index++) {
            const colony = habitatList2[index];
            let num = valueColonyForEmpire(galaxy, colony, giver);
            if (num >= 0 && refactorValuesForEmpire) num = refactorValueForEmpire(galaxy, num, receiver, giver);
            if (num >= 0) list.push(new TradeableItem(TradeableItemType.Colony, colony, num));
        }
        const dominatedSystems = determineEmpireDominatedSystems(galaxy, receiver, true);
        const baseFilter = (x: BuiltObject): boolean => x.role === BuiltObjectRole.Base && (x.parentHabitat === null || x.parentHabitat.population == null || x.parentHabitat.population.totalAmount === 0);
        const builtObjectList: BuiltObject[] = [...giver.builtObjects.filter(baseFilter), ...giver.privateBuiltObjects.filter(baseFilter)];
        for (let index = 0; index < builtObjectList.length; index++) {
            const station = builtObjectList[index];
            const nss = station.nearestSystemStar;
            if ((BACON_TRADE_EVERYTHING || (nss !== null && (habitatList1.includes(nss) || dominatedSystems.includes(nss)))) && isObjectAreaKnownToThisEmpire(galaxy, receiver, station)) {
                let num = valueBaseForEmpire(galaxy, station, giver);
                if (num >= 0 && refactorValuesForEmpire) num = refactorValueForEmpire(galaxy, num, receiver, giver);
                if (num >= 0) list.push(new TradeableItem(TradeableItemType.Base, station, num));
            }
        }
        // BaconGalaxy.cs 236-246: the player's manually flagged trade items (BaconGalaxy.manualTradeItems — UI-only; empty headless).
    }
    return list;
}
/** BaconGalaxy.tradeEverything = false (BaconMain settings key "tradeEverything" may override — default kept). */
const BACON_TRADE_EVERYTHING = false;

/** Galaxy.4.cs 4176 ResolveTradeableItemsDiplomacy(giver, receiver, refactorValuesForEmpire). */
export function resolveTradeableItemsDiplomacy(galaxy: Galaxy, giver: Empire, receiver: Empire, refactorValuesForEmpire: boolean): TradeableItem[] {
    const list: TradeableItem[] = [];
    const empireList: Empire[] = [];
    const empireList2: Empire[] = [];
    for (let i = 0; i < giver.diplomaticRelations.count; i++) {
        const dr = giver.diplomaticRelations.at(i);
        if (dr.otherEmpire !== receiver && dr.initiator === giver && !dr.locked) {
            if (dr.type === DiplomaticRelationType.War) empireList.push(dr.otherEmpire!);
            else if (dr.type === DiplomaticRelationType.TradeSanctions) empireList2.push(dr.otherEmpire!);
        }
    }
    for (let j = 0; j < receiver.diplomaticRelations.count; j++) {
        const dr2 = receiver.diplomaticRelations.at(j);
        if (dr2.otherEmpire === giver) continue;
        const dr3 = giver.diplomaticRelations.byEmpire(dr2.otherEmpire);
        if (dr3 !== null && dr3.type !== DiplomaticRelationType.NotMet && dr3.type !== DiplomaticRelationType.War && dr2.type === DiplomaticRelationType.War && !dr3.locked) {
            let value = valueDeclareWarOnEmpire(galaxy, giver, dr2.otherEmpire!);
            value = updateValueDeclareWarOnEmpire(value, receiver, giver, dr2.otherEmpire!);
            if (value >= 0 && refactorValuesForEmpire) value = refactorValueForEmpire(galaxy, value, receiver, giver);
            list.push(new TradeableItem(TradeableItemType.DeclareWarOther, dr2.otherEmpire, value));
        }
    }
    for (let k = 0; k < receiver.diplomaticRelations.count; k++) {
        const dr4 = receiver.diplomaticRelations.at(k);
        if (dr4.otherEmpire === giver) continue;
        const dr5 = giver.diplomaticRelations.byEmpire(dr4.otherEmpire);
        if (dr5 !== null && dr5.type !== DiplomaticRelationType.NotMet && dr5.type !== DiplomaticRelationType.TradeSanctions && dr5.type !== DiplomaticRelationType.War && dr4.type === DiplomaticRelationType.TradeSanctions && !dr5.locked) {
            let num = valueInitiateTradeSanctionsAgainstEmpire(galaxy, giver, dr4.otherEmpire!);
            if (num >= 0 && refactorValuesForEmpire) num = refactorValueForEmpire(galaxy, num, receiver, giver);
            list.push(new TradeableItem(TradeableItemType.InitiateTradeSanctionsOther, dr4.otherEmpire, num));
        }
    }
    for (const item of empireList) {
        let num2 = valueStopActionWithEmpire(galaxy, receiver, giver, item, true);
        if (num2 >= 0 && refactorValuesForEmpire) num2 = refactorValueForEmpire(galaxy, num2, receiver, giver);
        if (num2 >= 0) list.push(new TradeableItem(TradeableItemType.EndWarOther, item, num2));
    }
    for (const item2 of empireList2) {
        let num3 = valueStopActionWithEmpire(galaxy, receiver, giver, item2, false);
        if (num3 >= 0 && refactorValuesForEmpire) num3 = refactorValueForEmpire(galaxy, num3, receiver, giver);
        if (num3 >= 0) list.push(new TradeableItem(TradeableItemType.LiftTradeSanctionsOther, item2, num3));
    }
    const dr6 = obtainDiplomaticRelation(giver, receiver);
    if (dr6.type === DiplomaticRelationType.War && !dr6.locked) {
        let num4 = valueEndWarAgainstUs(galaxy, giver, receiver);
        if (num4 >= 0 && refactorValuesForEmpire) num4 = refactorValueForEmpire(galaxy, num4, receiver, giver);
        if (num4 >= 0) list.push(new TradeableItem(TradeableItemType.EndWar, giver, num4));
    } else if (dr6.type === DiplomaticRelationType.TradeSanctions && !dr6.locked) {
        let num5 = valueLiftTradeSanctionsAgainstUs(galaxy, giver, receiver);
        if (num5 >= 0 && refactorValuesForEmpire) num5 = refactorValueForEmpire(galaxy, num5, receiver, giver);
        if (num5 >= 0) list.push(new TradeableItem(TradeableItemType.LiftTradeSanctions, receiver, num5));
    }
    if (dr6.type !== DiplomaticRelationType.War && !dr6.locked) list.push(new TradeableItem(TradeableItemType.ThreatenWar, receiver, 0));
    if (dr6.type !== DiplomaticRelationType.War && dr6.type !== DiplomaticRelationType.TradeSanctions && !dr6.locked) list.push(new TradeableItem(TradeableItemType.ThreatenTradeSanctions, receiver, 0));
    return list;
}

const T_pirateInfo = registerTodo('M4r', 'ResolveTradeableItemsPirateInfo (GenerateSaleableInfoForEmpire — M4s)');

/** Galaxy.4.cs 4401/4406 ResolveTradeableItems(giver, receiver, includeNearestColony, refactorValuesForEmpire[, includeAllItems]). */
export function resolveTradeableItems(galaxy: Galaxy, giver: Empire, receiver: Empire, includeNearestColony: boolean, refactorValuesForEmpire: boolean, includeAllItems = false): TradeableItem[] {
    void includeNearestColony;
    const list: TradeableItem[] = [];
    let num = 0;
    if (giver.pirateEmpireBaseHabitat === null && receiver.pirateEmpireBaseHabitat === null) {
        const ev = obtainEmpireEvaluation(galaxy, giver, receiver);
        if (ev != null) num = ev.overallAttitude;
    } else {
        num = Math.trunc(pirateRelationEvaluation(obtainPirateRelation(giver, receiver)));
    }
    for (const m of [10.0, 100.0, 1000.0, 10000.0, 100000.0]) list.push(new TradeableItem(TradeableItemType.Money, m, valueMoney(m)));
    if (receiver.pirateEmpireBaseHabitat === null) list.push(...resolveTradeableItemsColoniesBases(galaxy, giver, receiver, refactorValuesForEmpire));
    if (includeAllItems || num >= TRADE_TERRITORY_MAP_THRESHHOLD) list.push(...resolveTradeableItemsMaps(galaxy, giver, receiver, refactorValuesForEmpire));
    if (ALLOW_TECH_TRADING) {
        let num2 = TRADE_RESEARCH_THRESHHOLD;
        if (receiver === galaxy.playerEmpire) num2 = Math.trunc(TRADE_RESEARCH_THRESHHOLD * galaxy.difficultyLevel);
        if (includeAllItems || num >= num2) {
            let num3 = TRADE_RESEARCH_SPECIAL_THRESHHOLD;
            if (receiver === galaxy.playerEmpire) num3 = Math.trunc(TRADE_RESEARCH_SPECIAL_THRESHHOLD * galaxy.difficultyLevel);
            const includeSpecialTech = includeAllItems || num >= num3;
            list.push(...resolveTradeableItemsResearchProjects(galaxy, giver, receiver, refactorValuesForEmpire, includeSpecialTech));
        }
    }
    if (giver.pirateEmpireBaseHabitat === null && receiver.pirateEmpireBaseHabitat === null) list.push(...resolveTradeableItemsDiplomacy(galaxy, giver, receiver, refactorValuesForEmpire));
    if (giver.pirateEmpireBaseHabitat !== null) {
        // TODO(port) M4s: Galaxy.4.cs 4474 ResolveTradeableItemsPirateInfo (Empire.GenerateSaleableInfoForEmpire).
        todo(T_pirateInfo);
    }
    return list;
}

// ---------------------------------------------------------------------------------------------------------------
// Offers (Empire.7.cs 2411 / 2485) and their evaluation (Empire.7.cs 1779).
// ---------------------------------------------------------------------------------------------------------------

/** Empire.7.cs 2485 DetermineOfferedTradeItems(valueWillingToPay, tradeableItems, maximumItems): null when it can't reach the value. */
export function determineOfferedTradeItems(self: Empire, valueWillingToPay: number, tradeableItems: TradeableItem[], maximumItems: number): TradeableItem[] | null {
    let list: TradeableItem[] = [];
    const tv = (): number => tradeableItemsTotalValue(list);
    const num = Math.trunc(valueWillingToPay * 1.5);
    const list2 = extractHighOrderedItemsByType(tradeableItems, [TradeableItemType.EndWar, TradeableItemType.LiftTradeSanctions]);
    if (list2.length > 0 && tradeableItemsTotalValue(list2) >= valueWillingToPay && tradeableItemsTotalValue(list2) < num) {
        if (list.length < maximumItems) list.push(...list2);
        return list;
    }
    for (const type of [TradeableItemType.Colony, TradeableItemType.Base, TradeableItemType.ResearchProject]) {
        if (tv() < valueWillingToPay) {
            const l = extractHighOrderedItemsByType(tradeableItems, [type]);
            for (let i = 0; i < l.length; i++) {
                if (tv() < valueWillingToPay && tv() + l[i].value < num && list.length < maximumItems) list.push(l[i]);
            }
        }
    }
    if (tv() < valueWillingToPay) {
        const list6 = extractHighOrderedItemsByType(tradeableItems, [TradeableItemType.TerritoryMap]);
        const list7 = extractHighOrderedItemsByType(tradeableItems, [TradeableItemType.GalaxyMap]);
        if (list6.length > 0 && tv() + tradeableItemsTotalValue(list6) < num && list.length < maximumItems) list.push(...list6);
        if (list7.length > 0 && tv() < valueWillingToPay && tv() + tradeableItemsTotalValue(list7) < num) {
            if (list6.length > 0) removeItem(list, list6[0]);
            if (list.length < maximumItems) list.push(...list7);
        }
    }
    if (tv() < valueWillingToPay) {
        const num2 = Math.trunc(self.stateMoney * 0.2) | 0;
        if (num2 > 0) {
            let val = valueWillingToPay - tv();
            val = Math.min(val, num2);
            if (tv() + val < num && list.length < maximumItems) list.push(new TradeableItem(TradeableItemType.Money, val, val));
        }
    }
    if (tv() < valueWillingToPay) {
        list.length = 0;
        return null;
    }
    void list;
    return list;
}

/** Empire.7.cs 2411 DetermineOfferedTradeItemsForTarget(value, systemToExclude, tradeableItems, relation, evaluation). */
function determineOfferedTradeItemsForTarget(galaxy: Galaxy, self: Empire, value: number, systemToExclude: Habitat | null, tradeableItems: TradeableItem[], relation: DiplomaticRelation, evaluation: EmpireEvaluation): TradeableItem[] | null {
    let list: TradeableItem[] | null = [];
    if (systemToExclude !== null) {
        const list2: TradeableItem[] = [];
        for (const tradeableItem of tradeableItems) {
            if (tradeableItem.type === TradeableItemType.Base) {
                if ((tradeableItem.item as BuiltObject).nearestSystemStar === systemToExclude) list2.push(tradeableItem);
            } else if (tradeableItem.type === TradeableItemType.Colony) {
                if (galaxy.determineHabitatSystemStar(tradeableItem.item as Habitat) === systemToExclude) list2.push(tradeableItem);
            }
        }
        if (list2.length > 0) for (const item of list2) removeItem(tradeableItems, item);
    }
    let num = Math.sqrt(friendlinessLevel(self) / 100.0);
    num += galaxy.rnd.nextDouble() * 0.05;
    num = Math.min(1.1, num);
    const valueWillingToPay = Math.trunc(value * num);
    if (relation.type === DiplomaticRelationType.War) {
        const l3 = extractHighOrderedItemsByType(tradeableItems, [TradeableItemType.EndWar]);
        if (l3.length > 0) list.push(...l3);
    } else if (relation.type === DiplomaticRelationType.TradeSanctions) {
        const l4 = extractHighOrderedItemsByType(tradeableItems, [TradeableItemType.LiftTradeSanctions]);
        if (l4.length > 0) list.push(...l4);
    } else if ((aggressionLevel(self) >= 125 || evaluation.overallAttitude < -45) && relation.strategy === DiplomaticStrategy.Conquer && galaxy.rnd.next(0, 2) === 1) {
        const l5 = extractHighOrderedItemsByType(tradeableItems, [TradeableItemType.ThreatenWar]);
        const l6 = extractHighOrderedItemsByType(tradeableItems, [TradeableItemType.ThreatenTradeSanctions]);
        if (l5.length > 0) list.push(...l5);
        else if (l6.length > 0) list.push(...l6);
    } else if ((aggressionLevel(self) < 115 && evaluation.overallAttitude >= -25) || (relation.strategy !== DiplomaticStrategy.Conquer && relation.strategy !== DiplomaticStrategy.Punish) || galaxy.rnd.next(0, 3) <= 0) {
        list = determineOfferedTradeItems(self, valueWillingToPay, tradeableItems, 6);
    }
    return list;
}

/** Empire.7.cs 2028 CheckForCapitalTradeItems(items). */
function checkForCapitalTradeItems(self: Empire, items: readonly TradeableItem[]): boolean {
    for (const item of items) if (item.type === TradeableItemType.Colony && item.item === self.capital) return true;
    return false;
}

/** Empire.7.cs 2044 CheckForCriticalTradeItems(items): capitals, the capital, or a colony in a capital system (Empire.CapitalSystemStars). */
function checkForCriticalTradeItems(galaxy: Galaxy, self: Empire, items: readonly TradeableItem[]): boolean {
    // Empire.Capitals / CapitalSystemStars are refreshed by RefreshColonyFacilityInfo (Empire.3.cs 104, M4i); recomputed here.
    const capitals = identifyEmpireCapitals(self);
    const capitalSystemStars = capitals.map((c) => galaxy.determineHabitatSystemStar(c));
    for (const item of items) {
        if (item.type === TradeableItemType.Colony) {
            const habitat = item.item as Habitat;
            if (capitals.includes(habitat) || habitat === self.capital || capitalSystemStars.includes(galaxy.determineHabitatSystemStar(habitat))) return true;
        }
    }
    return false;
}

/**
 * Empire.7.cs 1779 EvaluateTradeOffer(offeringEmpire, offered, requested, disallowCriticalItems).
 * Rnd: Next(0,3) when a threat offer is strong enough, and when a lowball offer might be accepted under pressure.
 */
export function evaluateTradeOffer(galaxy: Galaxy, self: Empire, offeringEmpire: Empire | null, offered: readonly TradeableItem[], requested: readonly TradeableItem[], disallowCriticalItems: boolean): TradeOfferResponse {
    if (offeringEmpire !== self && !self.reclusive && offeringEmpire !== null) {
        let diplomaticRelation: DiplomaticRelation | null = null;
        let ev: EmpireEvaluation | null = null;
        let pirateRelation: PirateRelation | null = null;
        if (self.pirateEmpireBaseHabitat === null && offeringEmpire.pirateEmpireBaseHabitat === null) {
            diplomaticRelation = obtainDiplomaticRelation(self, offeringEmpire);
            ev = obtainEmpireEvaluation(galaxy, self, offeringEmpire);
        } else {
            pirateRelation = obtainPirateRelation(self, offeringEmpire);
        }
        const offeredTotal = (): number => tradeableItemsTotalValue(offered);
        const requestedTotal = tradeableItemsTotalValue(requested);
        let val = (100 + Math.trunc((aggressionLevel(self) - friendlinessLevel(self)) / 2)) / 100.0;
        val = Math.max(0.97, val);
        const num = Math.trunc(requestedTotal * val) | 0;
        let val2 = (requestedTotal + 1) / (offeredTotal() + 1);
        val2 = Math.min(10.0, Math.max(0.2, val2));
        const capitalGate = (r: TradeOfferResponse): TradeOfferResponse => (checkForCapitalTradeItems(self, requested) ? TradeOfferResponse.Refuse : r);
        const endOrLift = (dr: DiplomaticRelation, keepType: (t: DiplomaticRelationType) => boolean): TradeOfferResponse | null => {
            if (dr.locked) return TradeOfferResponse.Refuse;
            const desired = determineDesiredDiplomaticRelationTypical(dr.strategy, dr.type);
            if (!keepType(desired) && offeredTotal() >= requestedTotal) return capitalGate(TradeOfferResponse.Accept);
            if (containsType(offered, TradeableItemType.Colony) || containsType(offered, TradeableItemType.Base)) {
                if (offeredTotal() >= requestedTotal) return capitalGate(TradeOfferResponse.Accept);
                if (offeredTotal() >= num) return capitalGate(TradeOfferResponse.Accept);
                if (offeredTotal() >= requestedTotal) return capitalGate(TradeOfferResponse.PromptForImprovement);
                return TradeOfferResponse.Refuse;
            }
            return null;
        };
        if (diplomaticRelation !== null && diplomaticRelation.type === DiplomaticRelationType.War && containsType(offered, TradeableItemType.EndWar)) {
            const r = endOrLift(diplomaticRelation, (t) => t === DiplomaticRelationType.War);
            if (r !== null) return r;
        }
        if (diplomaticRelation !== null && diplomaticRelation.type === DiplomaticRelationType.TradeSanctions && containsType(offered, TradeableItemType.LiftTradeSanctions)) {
            const r = endOrLift(diplomaticRelation, (t) => t === DiplomaticRelationType.TradeSanctions || t === DiplomaticRelationType.War);
            if (r !== null) return r;
        }
        let flag = true;
        if (disallowCriticalItems && checkForCriticalTradeItems(galaxy, self, requested)) flag = false;
        const threat = (civilityFactor: number, incidentFactor: number, strengthFactor: number): TradeOfferResponse => {
            let d = weightedMilitaryPotency(offeringEmpire) / weightedMilitaryPotency(self);
            d = Math.sqrt(d);
            d *= 0.7;
            let num2 = 1.0 + (aggressionLevel(self) - cautionLevel(self)) / 100.0;
            num2 *= num2;
            num2 = Math.max(1.0, num2);
            setCivilityRating(offeringEmpire, offeringEmpire.civilityRating - val2 * civilityFactor);
            ev!.incidentEvaluation = ev!.incidentEvaluationRaw - val2 * incidentFactor;
            if (d > num2 * strengthFactor && galaxy.rnd.next(0, 3) > 0 && ev!.overallAttitude > -50) return flag ? TradeOfferResponse.AcceptUnfair : TradeOfferResponse.RefuseUnfair;
            if (offeredTotal() >= requestedTotal) return flag ? TradeOfferResponse.Accept : TradeOfferResponse.Refuse;
            return TradeOfferResponse.RefuseUnfair;
        };
        if (diplomaticRelation !== null && diplomaticRelation.type !== DiplomaticRelationType.War && containsType(offered, TradeableItemType.ThreatenWar)) return threat(0.5, 3.0, 1.0);
        if (diplomaticRelation !== null && diplomaticRelation.type !== DiplomaticRelationType.War && diplomaticRelation.type !== DiplomaticRelationType.TradeSanctions && containsType(offered, TradeableItemType.ThreatenTradeSanctions)) return threat(0.3, 2.0, 2.0);
        if (!flag) return TradeOfferResponse.Refuse;
        if (offeredTotal() >= num) {
            const num4 = offeredTotal() / num;
            if (num4 > 1.0) {
                const num5 = offeredTotal() - num;
                if (num5 >= 1000) {
                    const num6 = Math.sqrt(Math.sqrt(Math.sqrt(num5))) - 1.37;
                    if (self.pirateEmpireBaseHabitat === null && offeringEmpire.pirateEmpireBaseHabitat === null) {
                        const ev2 = obtainEmpireEvaluation(galaxy, self, offeringEmpire);
                        ev2.incidentEvaluation = ev2.incidentEvaluationRaw + num6;
                    } else if (pirateRelation !== null) {
                        pirateRelation.evaluationOffenseOverRequests = Math.fround(pirateRelation.evaluationOffenseOverRequests + Math.fround(num6));
                    }
                }
            }
            return TradeOfferResponse.Accept;
        }
        if (offeredTotal() >= requestedTotal) return TradeOfferResponse.PromptForImprovement;
        if (offeredTotal() > 0 && !(val2 < 0.5)) return TradeOfferResponse.Refuse;
        let d3 = weightedMilitaryPotency(offeringEmpire) / weightedMilitaryPotency(self);
        d3 = Math.sqrt(d3);
        d3 *= 0.7;
        let num7 = 1.0 + (aggressionLevel(self) - cautionLevel(self)) / 100.0;
        num7 *= num7;
        num7 = Math.max(1.0, num7);
        let val3 = num / 5000.0;
        val3 = Math.min(val3, 15.0);
        if (ev !== null && self.pirateEmpireBaseHabitat === null && offeringEmpire.pirateEmpireBaseHabitat === null) {
            if (offeredTotal() <= 0) ev.incidentEvaluation = ev.incidentEvaluationRaw - val3;
            else ev.incidentEvaluation = ev.incidentEvaluationRaw - (offeredTotal() / num) * val3;
            if (d3 > num7 * 4.0 && galaxy.rnd.next(0, 3) > 1 && ev.overallAttitude > -20) return TradeOfferResponse.AcceptUnfair;
            return TradeOfferResponse.RefuseUnfair;
        }
        if (pirateRelation !== null) {
            if (offeredTotal() <= 0) pirateRelation.evaluationOffenseOverRequests = Math.fround(pirateRelation.evaluationOffenseOverRequests - Math.fround(val3));
            else pirateRelation.evaluationOffenseOverRequests = Math.fround(pirateRelation.evaluationOffenseOverRequests - Math.fround((offeredTotal() / num) * val3));
            if (d3 > num7 * 4.0 && galaxy.rnd.next(0, 3) > 1 && pirateRelationEvaluation(pirateRelation) > -20) return TradeOfferResponse.AcceptUnfair;
            return TradeOfferResponse.RefuseUnfair;
        }
    }
    return TradeOfferResponse.Refuse;
}

// ---------------------------------------------------------------------------------------------------------------
// GiveTradeableItem (Galaxy.4.cs 3857).
// ---------------------------------------------------------------------------------------------------------------

/** Empire.cs 2807 AddLocationHint(location): skipped when an existing hint lies within MaxSolarSystemSize (Rectangle.Contains). */
export function addLocationHint(self: Empire, location: { x: number; y: number }): void {
    const left = location.x - MAX_SOLAR_SYSTEM_SIZE;
    const top = location.y - MAX_SOLAR_SYSTEM_SIZE;
    const size = MAX_SOLAR_SYSTEM_SIZE * 2;
    for (const p of self.locationHints) {
        if (p.x >= left && p.x < left + size && p.y >= top && p.y < top + size) return;
    }
    self.locationHints.push(location);
}


/** Galaxy.4.cs 3857 GiveTradeableItem(giver, receiver, item, exchangedItems). */
export function giveTradeableItem(galaxy: Galaxy, giver: Empire, receiver: Empire, item: TradeableItem, exchangedItems: readonly TradeableItem[] | null): void {
    switch (item.type) {
        case TradeableItemType.Money: {
            const num2 = typeof item.item === 'number' ? item.item : 0.0;
            giver.stateMoney -= num2;
            // Galaxy.4.cs 3872-3886: the PirateEconomy ledger (SellInfo when money buys contacts / locations / maps).
            let flag = false;
            if (
                exchangedItems !== null &&
                exchangedItems.length > 0 &&
                exchangedItems.some(
                    (x) =>
                        x.type === TradeableItemType.ContactEmpire ||
                        x.type === TradeableItemType.IndependentColonyLocation ||
                        x.type === TradeableItemType.SecretLocation ||
                        x.type === TradeableItemType.SystemMap,
                )
            ) {
                flag = true;
            }
            pirateEconomyPerformExpense(galaxy, giver, num2, PirateExpenseType.Undefined, galaxyStarDate(galaxy));
            receiver.stateMoney += num2;
            pirateEconomyPerformIncome(galaxy, receiver, num2, flag ? PirateIncomeType.SellInfo : PirateIncomeType.Undefined, galaxyStarDate(galaxy));
            break;
        }
        case TradeableItemType.Base:
            if (item.item !== null && typeof item.item === 'object' && 'builtObjectID' in (item.item as object)) takeOwnershipOfBuiltObject(galaxy, receiver, item.item as BuiltObject, receiver, true);
            break;
        case TradeableItemType.Colony:
            if (item.item instanceof HabitatClass) takeOwnershipOfColonyRuntime(galaxy, receiver, item.item, receiver);
            break;
        case TradeableItemType.TerritoryMap:
            giveTerritoryMap(galaxy, giver, receiver);
            break;
        case TradeableItemType.GalaxyMap:
            mergeGalaxyMap(galaxy, giver, receiver); // Galaxy.4.cs 3700 (exploration.ts)
            break;
        case TradeableItemType.ContactEmpire: {
            const empire3 = item.item as Empire | null;
            if (empire3 === null || !(empire3.diplomaticRelations instanceof DiplomaticRelationList)) break;
            const title = formatText(getText('Inform Empire Their Contact Details Sold Title'), receiver.name);
            const description = formatText(getText('Inform Empire Their Contact Details Sold'), giver.name, receiver.name);
            if (receiver.pirateEmpireBaseHabitat !== null && empire3 !== null) {
                const pr = obtainPirateRelation(receiver, empire3);
                if (pr.type === PirateRelationType.NotMet) pr.type = PirateRelationType.None;
                sendMessageToEmpireWithTitle(empire3, empire3, EmpireMessageType.GeneralNeutralEvent, null, description, title);
                const pr2 = obtainPirateRelation(empire3, receiver);
                if (pr2.type === PirateRelationType.NotMet) pr2.type = PirateRelationType.None;
            } else {
                const dr = obtainDiplomaticRelation(receiver, empire3);
                if (dr.type === DiplomaticRelationType.NotMet) dr.type = DiplomaticRelationType.None;
                sendMessageToEmpireWithTitle(empire3, empire3, EmpireMessageType.GeneralNeutralEvent, null, description, title);
                const dr5 = obtainDiplomaticRelation(empire3, receiver);
                if (dr5.type === DiplomaticRelationType.NotMet) dr5.type = DiplomaticRelationType.None;
            }
            break;
        }
        case TradeableItemType.SystemMap:
            if (item.item instanceof HabitatClass) {
                if (receiver.visibility.checkSystemVisibilityStatus(item.item.systemIndex) === SystemVisibilityStatus.Unexplored) receiver.visibility.setSystemVisibility(item.item, SystemVisibilityStatus.Explored);
            }
            break;
        case TradeableItemType.IndependentColonyLocation:
            if (item.item instanceof HabitatClass) {
                const systemStar3 = galaxy.determineHabitatSystemStar(item.item);
                if (receiver.visibility.checkSystemVisibilityStatus(systemStar3.systemIndex) === SystemVisibilityStatus.Unexplored) receiver.visibility.setSystemVisibility(systemStar3, SystemVisibilityStatus.Explored);
                addLocationHint(receiver, { x: Math.trunc(item.item.xpos), y: Math.trunc(item.item.ypos) });
            }
            break;
        case TradeableItemType.SecretLocation:
            if (item.item instanceof GalaxyLocation) {
                if (!receiver.visibility.knownGalaxyLocations.includes(item.item)) receiver.visibility.knownGalaxyLocations.push(item.item);
                addLocationHint(receiver, { x: Math.trunc(item.item.xpos), y: Math.trunc(item.item.ypos) });
            } else if (item.item instanceof HabitatClass) {
                const systemStar2 = galaxy.determineHabitatSystemStar(item.item);
                if (receiver.visibility.checkSystemVisibilityStatus(systemStar2.systemIndex) === SystemVisibilityStatus.Unexplored) receiver.visibility.setSystemVisibility(systemStar2, SystemVisibilityStatus.Explored);
                addLocationHint(receiver, { x: Math.trunc(item.item.xpos), y: Math.trunc(item.item.ypos) });
            }
            break;
        case TradeableItemType.ResearchProject: {
            // Galaxy.4.cs 4005-4036: drop the (equivalent) node from the receiver's queues, then the breakthrough.
            const researchNode = isTechNode(item.item) ? item.item : null;
            if (researchNode !== null) {
                const research = receiver.research;
                let num = researchNodeListIndexOf(research.researchQueueEnergy, researchNode);
                if (num >= 0) research.researchQueueEnergy.splice(num, 1);
                num = researchNodeListIndexOf(research.researchQueueHighTech, researchNode);
                if (num >= 0) research.researchQueueHighTech.splice(num, 1);
                num = researchNodeListIndexOf(research.researchQueueWeapons, researchNode);
                if (num >= 0) research.researchQueueWeapons.splice(num, 1);
                num = researchNodeListIndexOf(research.techTree, researchNode);
                if (num >= 0) doResearchBreakthrough(galaxy, receiver, research.techTree[num], false, true, true);
                research.update(receiver.dominantRace);
            }
            break;
        }
        case TradeableItemType.AdoptGovernmentStyle:
            if (giver.pirateEmpireBaseHabitat === null) {
                const gov = item.item as { governmentId?: number } | null;
                if (gov !== null && typeof gov.governmentId === 'number') haveRevolution(galaxy, giver, giver.dominantRace, gov.governmentId, 1.0); // Empire.10.cs 4452 overload
            }
            break;
        case TradeableItemType.DeclareWarOther: {
            const empire4 = item.item as Empire | null;
            if (empire4 !== null && giver.pirateEmpireBaseHabitat === null && empire4.pirateEmpireBaseHabitat === null) declareWar(galaxy, giver, empire4, receiver);
            break;
        }
        case TradeableItemType.EndWar:
            if (giver.pirateEmpireBaseHabitat === null && receiver.pirateEmpireBaseHabitat === null) {
                const dr = obtainDiplomaticRelation(giver, receiver);
                resetAttitudeLevelsAtEndOfWar(galaxy, dr);
                dr.type = DiplomaticRelationType.None;
                dr.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
                const dr2 = obtainDiplomaticRelation(receiver, giver);
                dr2.type = DiplomaticRelationType.None;
                dr2.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
                processEndOfWarWithEmpire(galaxy, giver, receiver);
                processEndOfWarWithEmpire(galaxy, receiver, giver);
                changeDiplomaticRelation(galaxy, giver, dr, DiplomaticRelationType.None);
                sendNewsBroadcastWarStartEnd(dr);
            }
            break;
        case TradeableItemType.LiftTradeSanctions:
            if (giver.pirateEmpireBaseHabitat === null && receiver.pirateEmpireBaseHabitat === null) {
                const dr = obtainDiplomaticRelation(giver, receiver);
                if (dr.type === DiplomaticRelationType.TradeSanctions) {
                    changeDiplomaticRelation(galaxy, giver, dr, DiplomaticRelationType.None);
                    sendMessageToEmpire(giver, receiver, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None, getText('Our trade sanctions against you have been lifted - we will now resume trade.'), { x: 0, y: 0 }, resolveDescription(DiplomaticRelationType, DiplomaticRelationType.TradeSanctions));
                    cancelBlockades(galaxy, giver, receiver);
                    cancelBlockades(galaxy, receiver, giver);
                }
            }
            break;
        case TradeableItemType.EndWarOther: {
            const empire5 = item.item as Empire | null;
            if (empire5 !== null && giver.pirateEmpireBaseHabitat === null && empire5.pirateEmpireBaseHabitat === null) {
                const dr = obtainDiplomaticRelation(giver, empire5);
                if (dr.type === DiplomaticRelationType.War) {
                    resetAttitudeLevelsAtEndOfWar(galaxy, dr);
                    dr.type = DiplomaticRelationType.None;
                    dr.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
                    const dr2 = obtainDiplomaticRelation(empire5, giver);
                    dr2.type = DiplomaticRelationType.None;
                    dr2.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
                    processEndOfWarWithEmpire(galaxy, giver, empire5);
                    processEndOfWarWithEmpire(galaxy, empire5, giver);
                    changeDiplomaticRelation(galaxy, giver, dr, DiplomaticRelationType.None);
                    sendMessageToEmpire(giver, empire5, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None, getText('We are ending our war with you'), { x: 0, y: 0 }, resolveDescription(DiplomaticRelationType, DiplomaticRelationType.War));
                    sendNewsBroadcastWarStartEnd(dr);
                }
            }
            break;
        }
        case TradeableItemType.InitiateTradeSanctionsOther: {
            const empire2 = item.item as Empire | null;
            if (empire2 !== null && giver.pirateEmpireBaseHabitat === null && empire2.pirateEmpireBaseHabitat === null) {
                const dr4 = giver.diplomaticRelations.byEmpire(empire2);
                if (dr4 !== null) {
                    changeDiplomaticRelation(galaxy, giver, dr4, DiplomaticRelationType.TradeSanctions);
                    sendMessageToEmpire(giver, empire2, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.TradeSanctions, getText('Our blockade is perfectly legal...'), { x: 0, y: 0 }, 'PERSUADED');
                }
            }
            break;
        }
        case TradeableItemType.LiftTradeSanctionsOther: {
            const empire = item.item as Empire | null;
            if (empire !== null && giver.pirateEmpireBaseHabitat === null && empire.pirateEmpireBaseHabitat === null) {
                const dr3 = giver.diplomaticRelations.byEmpire(empire);
                if (dr3 !== null) {
                    changeDiplomaticRelation(galaxy, giver, dr3, DiplomaticRelationType.None);
                    sendMessageToEmpire(giver, empire, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None, getText('Our trade sanctions against you have been lifted - we will now resume trade.'), { x: 0, y: 0 }, resolveDescription(DiplomaticRelationType, DiplomaticRelationType.TradeSanctions));
                    cancelBlockades(galaxy, giver, empire);
                    cancelBlockades(galaxy, empire, giver);
                }
            }
            break;
        }
        case TradeableItemType.ThreatenWar:
        case TradeableItemType.ThreatenTradeSanctions:
            break;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ReviewEnemyHelpEnlistment (Empire.7.cs 2060) and ReviewDisputedTerritory (Empire.7.cs 2205).
// ---------------------------------------------------------------------------------------------------------------

/** Empire.7.cs 2149 IdentifyBestEmpireToAttackEnemy(enemyEmpire, desiredRelationType, currentStarDate). */
function identifyBestEmpireToAttackEnemy(galaxy: Galaxy, self: Empire, enemyEmpire: Empire, desiredRelationType: DiplomaticRelationType, currentStarDate: number): Empire | null {
    let result: Empire | null = null;
    let num = Number.MAX_VALUE;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        const diplomaticRelation = obtainDiplomaticRelation(self, empire);
        const num2 = calculateNextAllowableProposalDate(galaxy, diplomaticRelation);
        if (currentStarDate < num2 || diplomaticRelation.type === DiplomaticRelationType.NotMet || diplomaticRelation.type === DiplomaticRelationType.War || diplomaticRelation.type === DiplomaticRelationType.TradeSanctions) continue;
        const diplomaticRelation2 = obtainDiplomaticRelation(empire, enemyEmpire);
        const t = diplomaticRelation2.type;
        if (t !== DiplomaticRelationType.NotMet && t !== DiplomaticRelationType.MutualDefensePact && t !== DiplomaticRelationType.Protectorate && t !== DiplomaticRelationType.War && t !== desiredRelationType) {
            const num3 = galaxy.calculateDistance(empire.capital!.xpos, empire.capital!.ypos, enemyEmpire.capital!.xpos, enemyEmpire.capital!.ypos);
            const ev = obtainEmpireEvaluation(galaxy, empire, enemyEmpire);
            const num4 = weightedMilitaryPotency(empire) / weightedMilitaryPotency(enemyEmpire);
            const num5 = ev.overallAttitude + 50;
            const num6 = (num5 * num3) / num4;
            if (num6 < num) {
                result = empire;
                num = num6;
            }
        }
    }
    return result;
}

/** Empire.7.cs 2060 ReviewEnemyHelpEnlistment: ask a third empire (for pay) to join a losing war or sanctions. */
export function reviewEnemyHelpEnlistment(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    const currentStarDate = galaxyStarDate(galaxy);
    if (self === galaxy.playerEmpire) return;
    for (let i = 0; i < galaxy.empires.length; i++) {
        const other = galaxy.empires[i];
        if (other === self) continue;
        const diplomaticRelation = obtainDiplomaticRelation(self, other);
        const war = diplomaticRelation.type === DiplomaticRelationType.War;
        if (!war && diplomaticRelation.type !== DiplomaticRelationType.TradeSanctions) continue;
        let num = weightedMilitaryPotency(self) / weightedMilitaryPotency(other);
        if (other === galaxy.playerEmpire) num /= galaxy.playerEmpire.difficultyLevel;
        if (!(num < (war ? 0.9 : 0.6))) continue;
        const empire2 = identifyBestEmpireToAttackEnemy(galaxy, self, other, war ? DiplomaticRelationType.War : DiplomaticRelationType.TradeSanctions, currentStarDate);
        if (empire2 === null) continue;
        const requested: TradeableItem[] = [];
        let num2 = war ? valueDeclareWarOnEmpire(galaxy, empire2, other) : valueInitiateTradeSanctionsAgainstEmpire(galaxy, empire2, other);
        if (num2 >= 0) {
            if (war) num2 = updateValueDeclareWarOnEmpire(num2, self, empire2, other);
            num2 = refactorValueForEmpire(galaxy, num2, self, empire2);
            requested.push(new TradeableItem(war ? TradeableItemType.DeclareWarOther : TradeableItemType.InitiateTradeSanctionsOther, other, num2));
            const tradeableItems = resolveTradeableItems(galaxy, self, empire2, false, true);
            const offered = determineOfferedTradeItems(self, num2, tradeableItems, 6);
            if (offered !== null && offered.length > 0) {
                const description = formatText(getText('Request help against EMPIRE'), other.name);
                sendMessageToEmpire(self, empire2, EmpireMessageType.OfferTrade, [offered, requested], description);
                obtainDiplomaticRelation(self, empire2).lastDiplomacyTradeOfferDate = currentStarDate;
            }
        }
    }
}

/** Empire.7.cs 2369 CalculateNextAllowableTradeProposalDate(relation). */
function calculateNextAllowableTradeProposalDate(galaxy: Galaxy, relation: DiplomaticRelation): number {
    let num = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * (MINIMUM_DIPLOMACY_TRADE_PROPOSAL_INTERVAL_YEARS * galaxyColonyFillFactor(galaxy)));
    let num2 = galaxy.empires.length;
    if (relation.otherEmpire !== null && relation.otherEmpire.diplomaticRelations != null) num2 = relation.otherEmpire.diplomaticRelations.countMet();
    let val = num2 / galaxy.empires.length;
    val = Math.max(0.3, Math.min(1.0, val));
    num = Math.trunc(num * val * 2.0);
    return relation.lastTradeDealOfferDate + num;
}

/**
 * Empire.7.cs 2205 ReviewDisputedTerritory: demand (or buy) back other empires' colonies / bases in our territory.
 * Rnd: Next(0,3) per war relation whose desired type is War (result discarded), Next(0,3) before a colony demand, the
 * offer's NextDouble / Next draws.
 */
export function reviewDisputedTerritory(galaxy: Galaxy, empire: Empire): void {
    const self = empire;
    if (self === galaxy.playerEmpire || self.dominantRace === null) return;
    const currentStarDate = galaxyStarDate(galaxy);
    const habitatList = determineEmpireDominatedSystems(galaxy, self, true);
    for (let i = 0; i < galaxy.empires.length; i++) {
        const other = galaxy.empires[i];
        if (other === self) continue;
        const diplomaticRelation = obtainDiplomaticRelation(self, other);
        if (diplomaticRelation == null || diplomaticRelation.type === DiplomaticRelationType.NotMet) continue;
        if (diplomaticRelation.type === DiplomaticRelationType.War) {
            const t = determineDesiredDiplomaticRelationTypical(diplomaticRelation.strategy, diplomaticRelation.type);
            if (t === DiplomaticRelationType.War) galaxy.rnd.next(0, 3); // `Galaxy.Rnd.Next(0, 3); _ = 1;` (result unused)
        }
        const num = calculateNextAllowableTradeProposalDate(galaxy, diplomaticRelation);
        if (currentStarDate < num) continue;
        const habitatList2: Habitat[] = [];
        const builtObjectList: BuiltObject[] = [];
        const num2 = 60 - (friendlinessLevel(self) - cautionLevel(self));
        const ev = obtainEmpireEvaluation(galaxy, self, other);
        if (ev != null && ev.overallAttitude < num2) {
            const builtObjectList2 = [...other.builtObjects, ...other.privateBuiltObjects];
            for (let j = 0; j < builtObjectList2.length; j++) {
                const bo = builtObjectList2[j];
                const sr = bo?.subRole;
                if (
                    bo == null ||
                    bo.role !== BuiltObjectRole.Base ||
                    bo.builtAt != null ||
                    bo.unbuiltComponentCount > 0 ||
                    (sr !== BuiltObjectSubRole.MiningStation &&
                        sr !== BuiltObjectSubRole.GasMiningStation &&
                        sr !== BuiltObjectSubRole.GenericBase &&
                        sr !== BuiltObjectSubRole.EnergyResearchStation &&
                        sr !== BuiltObjectSubRole.WeaponsResearchStation &&
                        sr !== BuiltObjectSubRole.HighTechResearchStation &&
                        sr !== BuiltObjectSubRole.MonitoringStation &&
                        sr !== BuiltObjectSubRole.DefensiveBase &&
                        sr !== BuiltObjectSubRole.ResortBase) ||
                    bo.nearestSystemStar === null ||
                    !habitatList.includes(bo.nearestSystemStar)
                ) {
                    continue;
                }
                if (sr === BuiltObjectSubRole.MiningStation || sr === BuiltObjectSubRole.GasMiningStation) {
                    bo.sortTag = bo.parentHabitat !== null ? 100.0 * determineResourceValue(galaxy, self, bo.parentHabitat) : 1000.0;
                } else {
                    bo.sortTag = 10000.0;
                }
                builtObjectList.push(bo);
            }
        }
        for (let k = 0; k < habitatList.length; k++) {
            const habitat = habitatList[k];
            if (habitat == null || habitat.systemIndex < 0 || habitat.systemIndex >= galaxy.systems.length) continue;
            const systemInfo = galaxy.systems[habitat.systemIndex];
            // C# `OtherEmpires == null` never holds (DetermineSystemInfo always assigns a list); TS keeps null for "empty".
            if (systemInfo == null || !systemIsDisputed(systemInfo) || systemInfo.dominantEmpire == null || (systemInfo.dominantEmpire.empire !== other && !otherEmpiresContains(systemInfo, other)) || systemInfo.dominantEmpire.empire !== self || systemInfo.habitats == null) continue;
            for (let l = 0; l < systemInfo.habitats.length; l++) {
                const habitat2 = systemInfo.habitats[l];
                if (habitat2 != null && habitat2.owner === other && habitat2.owner.capital !== habitat2) habitatList2.push(habitat2);
            }
        }
        netSort(habitatList2, habitatCompareTo);
        habitatList2.reverse();
        netSort(builtObjectList, (a, b) => compareDouble(a.sortTag, b.sortTag)); // BuiltObject.2.cs 8156 CompareTo: SortTag
        builtObjectList.reverse();
        const requested: TradeableItem[] = [];
        let offered: TradeableItem[] | null = [];
        if (habitatList2.length > 0 && galaxy.rnd.next(0, 3) > 0) {
            const tradeableItems = resolveTradeableItems(galaxy, self, other, false, true);
            let num3 = valueColonyForEmpire(galaxy, habitatList2[0], self);
            if (num3 >= 0) num3 = refactorValueForEmpire(galaxy, num3, self, other);
            requested.push(new TradeableItem(TradeableItemType.Colony, habitatList2[0], num3));
            const systemToExclude = galaxy.determineHabitatSystemStar(habitatList2[0]);
            offered = determineOfferedTradeItemsForTarget(galaxy, self, num3, systemToExclude, tradeableItems, diplomaticRelation, ev);
        } else if (builtObjectList.length > 0) {
            const tradeableItems2 = resolveTradeableItems(galaxy, self, other, false, true);
            let num4 = valueBaseForEmpire(galaxy, builtObjectList[0], self);
            if (num4 >= 0) num4 = refactorValueForEmpire(galaxy, num4, self, other);
            requested.push(new TradeableItem(TradeableItemType.Base, builtObjectList[0], num4));
            offered = determineOfferedTradeItemsForTarget(galaxy, self, num4, builtObjectList[0].nearestSystemStar, tradeableItems2, diplomaticRelation, ev);
        }
        const flag = self.dominantRace !== null ? self.dominantRace.expanding : true;
        if (requested.length > 0 && offered !== null) {
            let text: string;
            if (offered.length > 0 && flag) {
                const threats = extractHighOrderedItemsByType(offered, [TradeableItemType.ThreatenWar, TradeableItemType.ThreatenTradeSanctions]);
                text = threats.length <= 0 ? formatText(getText('Trade Offer'), describeItems(offered), describeItems(requested)) : formatText(getText('Trade Demand Threat'), describeItems(requested), describeItems(offered));
            } else {
                text = formatText(getText('Trade Demand'), describeItems(requested));
            }
            sendMessageToEmpire(self, other, EmpireMessageType.OfferTrade, [offered, requested], text);
            diplomaticRelation.lastTradeDealOfferDate = currentStarDate;
        }
    }
}

/** TradeableItemList.cs 58 ToString → BuildTradeableItemsDescription(items, showValues false). */
function describeItems(items: readonly TradeableItem[]): string {
    let str = '';
    for (const t of items) {
        str += t.type === TradeableItemType.GalaxyMap ? getText('Trade Description OUR GALAXY MAP') : t.type === TradeableItemType.TerritoryMap ? getText('Trade Description OUR TERRITORY MAP') : t.toString(false);
        str += ', ';
    }
    if (str.length > 0) str = str.substring(0, str.length - 2);
    return str;
}

/** ProcessMessages OfferTrade object[] deal (Empire.3.cs 4378-4418). */
export function processTradeDealMessage(galaxy: Galaxy, self: Empire, sender: Empire, offered: TradeableItem[], requested: TradeableItem[]): void {
    const response = evaluateTradeOffer(galaxy, self, sender, offered, requested, true);
    if (response === TradeOfferResponse.Accept || response === TradeOfferResponse.AcceptUnfair) {
        for (const item2 of offered) giveTradeableItem(galaxy, sender, self, item2, requested);
        for (const item3 of requested) giveTradeableItem(galaxy, self, sender, item3, offered);
    } else {
        if (sender === galaxy.playerEmpire || sender.pirateEmpireBaseHabitat !== null || self.pirateEmpireBaseHabitat !== null) return;
        for (const item4 of offered) {
            if (item4.type === TradeableItemType.ThreatenWar) {
                declareWar(galaxy, sender, self);
            } else if (item4.type === TradeableItemType.ThreatenTradeSanctions) {
                const current = obtainDiplomaticRelation(sender, self);
                changeDiplomaticRelation(galaxy, sender, current, DiplomaticRelationType.TradeSanctions);
                sendMessageToEmpire(sender, self, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.TradeSanctions, getText('We terminate all trade with you effective immediately!'));
            }
        }
    }
}
