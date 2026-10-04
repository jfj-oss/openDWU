// suggest — the player's answer to an advisor suggestion (a SemiAutomated task the AI proposed instead of doing it;
// diplomacyTick.ts checkTaskAuthorized queues it on the player empire, advisorQueue.ts).
//
// Ports (DistantWorlds/Main.Part2.cs):
//   1369 btnAdvisorSuggestionApprove_Click — `approveSuggestion`: one branch per AdvisorMessageType, each the same sim
//        calls the AI would have made (cited per branch), then diplomaticMessageQueue_0.RemoveMessage (2456).
//   2732 btnAdvisorSuggestionDecline_Click — `declineSuggestion`: RemoveMessage + the DeclinedTasks records.
//   2635 btnAdvisorSuggestionShow_Click (method_645 / 646 / 647) — `advisorSuggestionShowTarget`: what the view zooms to.
//   2781 method_649 — `advisorSuggestionTitle` (Galaxy.2.cs 3390 ResolveDescription(AdvisorMessageType, message) and the
//        ColonyFacility "Need Funds" override).
// Plus Empire.4.cs 4560 CanEmpireColonizeHabitat(habitat, out explanation) and Empire.7.cs 1637
// ColonizableHabitatTypesNonTechForEmpire, which only the Colonization approval uses.
//
// Determinism: runs on player input between ticks, like the click it stands for. Rnd draws are those of the called sim
// functions, in the handler's order (BuildOneOff: GenerateBuiltObjectName, the DefensiveBase suffix Next(0, 5),
// SelectRelativePoint / SelectRandomHeading; Colonization: GenerateBuiltObjectName ×2; fleet orders: AssignMission).
// The UI parts of the handlers (method_644 view restore, method_660 unpause, diplomaticMessageQueue_0 expiry of the
// conversation entries) are returned to the caller (`ApproveResult.expireDiplomacyFor`). Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import { Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import { Habitat, HabitatCategoryType, type HabitatType } from '../types';
import { Design, findNewest } from '../design';
import { Character, IntelligenceMission } from '../characters';
import { Creature } from '../creature';
import { ShipGroup } from '../fleets/shipGroup';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, type StellarObject } from '../missions/mission';
import { assignMission, recordRevertMission } from '../missions/assign';
import { forceCompleteMission, shipGroupAssignMission, determineDestroyOrCaptureTargetForFleet, shipGroupTotalTroopAttackStrength } from '../fleets/shipGroupTasks';
import { FLEET_ASSEMBLE_ATTACK_WAIT_PERIOD_PER_SHIP, determineLatestArrivalAtDestination, stellarDockingBays } from '../fleets/militaryAI';
import { implementBlockadeBuiltObject, implementBlockadeColony } from '../fleets/blockades';
import { determineDestroyOrCaptureTarget } from '../combat/attackAI';
import { galaxyStarDate } from '../tick/simTime';
import { EmpireMessage, EmpireMessageType, resolveDescription, sendEmpireMessage, sendMessageToEmpire } from '../messages';
import { DiplomaticRelation, DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../diplomacy';
import {
    cancelBlockades,
    changeDiplomaticRelation,
    declareWar,
    determineRelativeStrength,
    evaluateMilitaryPotency,
    formatText,
    formatThousands,
    generateMessageDescriptionRelation,
    generateMessageDescriptionType,
    getText,
    militaryPotency,
    offerMilitaryRefueling,
    offerMiningRights,
    weightedMilitaryPotency,
} from '../diplomacyTick';
import { PirateRelationType, changePirateRelation, obtainPirateRelation } from '../pirateRelations';
import { calculatePirateProtectionPricePerMonth } from '../pirates/pirateRelationsAI';
import { EmpireActivity, EmpireActivityType } from '../pirates/empireActivity';
import { PirateExpenseType } from '../pirates/pirateEconomy';
import { pirateEconomyPerformExpense } from '../pirates/pirateAI';
import { checkCanInitiateAttackAgainstPirateFacilities, initiateAttackAgainstPirateFacilities } from '../pirates/pirateEmpireAI';
import {
    PlanetaryFacility,
    calculatePlanetaryFacilityCost,
    facilitiesCountByType,
    facilitiesCountCompletedByType,
    queueFacilityConstruction,
    queueWonderConstruction,
} from '../construction/facilities';
import type { Facility } from '../data/facilities';
import { facilityType, PlanetaryFacilityType } from '../researchSystem';
import {
    calculateSpareAnnualRevenueComplete,
    colonizableHabitatTypesForEmpireTechOnly,
    createOrdersFor,
    dlFindNewestCanBuild,
    doRetrofit,
    habitatsFindShortestConstructionWaitQueue,
    procureConstructionComponentsAtColony,
    queueOf,
} from '../construction/empireConstruction';
import { calculateSupportCost } from '../forceStructure';
import { determineOrbitalBaseLocation } from '../pirates';
import { OrderType } from '../logistics/orders';
import { canEmpireColonizeHabitatRange } from '../exploration';
import { checkColonizationLikeliness } from '../tradeItems';
import { canBuiltObjectColonizeHabitat } from '../construction/constructionQueue';
import { BUILD_COLONY_SHIP_POPULATION_REQUIREMENT } from '../empire';
import { AdvisorMessageType, BoxedPirateRelationType, advisorSuggestionsView, expireAdvisorSuggestionsForEmpire, removeAdvisorSuggestion, resolveAdvisorTargetEmpire } from '../advisorQueue';
import { addDeclinedTasks } from '../missions/distress';

/** What Approve did. */
export interface ApproveResult {
    /** The suggestion was the queued AdvisorSuggestion (the C# `empireMessage_0 != null && … AdvisorSuggestion` guard). */
    handled: boolean;
    /** The C# calls diplomaticMessageQueue_0.ExpireDiplomacyMessagesForEmpire(empire) for these (UI conversation queue);
     *  the advisor entries among them are already removed here. */
    expireDiplomacyFor: Empire[];
}

// ---------------------------------------------------------------------------------------------------------------
// Title / cost / show target (display helpers of the popup).
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.2.cs 3390 ResolveDescription(AdvisorMessageType, message): the GameText tag of the suggestion's title. */
export function resolveAdvisorDescription(advisorMessageType: AdvisorMessageType, message: EmpireMessage | null): string {
    const T = AdvisorMessageType;
    switch (advisorMessageType) {
        case T.DefendTarget:
            return 'Advisor Message EnemyAttack';
        case T.WarTradeSanctions:
            if (message != null && message.subject instanceof Empire && typeof message.advisorMessageData === 'number') {
                switch (message.advisorMessageData as DiplomaticRelationType) {
                    case DiplomaticRelationType.War:
                        return 'Advisor Message DeclareWar';
                    case DiplomaticRelationType.TradeSanctions:
                        return 'Advisor Message InitiateTradeSanctions';
                }
            }
            return 'Advisor Message WarTradeSanctions';
        case T.Undefined:
            return '';
        default:
            return 'Advisor Message ' + T[advisorMessageType];
    }
}

/** Main.Part2.cs 2808-2819 (method_649): the title tag — ColonyFacility the player cannot afford says "Need Funds". */
export function advisorSuggestionTitle(galaxy: Galaxy, player: Empire, message: EmpireMessage): string {
    void galaxy;
    let text = resolveAdvisorDescription(message.advisorMessageType as AdvisorMessageType, message);
    if (message.advisorMessageType === AdvisorMessageType.ColonyFacility && isFacility(message.advisorMessageData)) {
        if (calculatePlanetaryFacilityCost(message.advisorMessageData, player) > player.stateMoney) text = 'Advisor Message ColonyFacility Need Funds';
    }
    return text;
}

/**
 * The price Approve would pay, as the approve branch computes it (null when the task costs nothing up front):
 * BuildOneOff Design.CalculateCurrentPurchasePrice (1390), Colonization the colony-ship design's price (1489 / 1557),
 * DiplomaticGift the message's Money (1833), ColonyFacility Galaxy.CalculatePlanetaryFacilityCost (2021).
 */
export function advisorSuggestionCost(galaxy: Galaxy, player: Empire, message: EmpireMessage): number | null {
    const data = message.advisorMessageData;
    switch (message.advisorMessageType as AdvisorMessageType) {
        case AdvisorMessageType.BuildOneOff:
            return isDesign(data) ? data.calculateCurrentPurchasePrice(galaxy) : null;
        case AdvisorMessageType.Colonization: {
            if (data instanceof BuiltObject) return null;
            const design = colonyShipDesign(player);
            return design !== null ? design.calculateCurrentPurchasePrice(galaxy) : null;
        }
        case AdvisorMessageType.DiplomaticGift:
            return message.money;
        case AdvisorMessageType.ColonyFacility:
            return isFacility(data) ? calculatePlanetaryFacilityCost(data, player) : null;
        default:
            return null;
    }
}

/** What "Show me first" centres on: an empire (method_645 → method_195, the empire view) or a map object (646 / 647). */
export type AdvisorShowTarget =
    | { kind: 'empire'; empire: Empire | null }
    | { kind: 'object'; object: Habitat | BuiltObject | Creature | ShipGroup; x: number; y: number; zoom: number };

/** Main.Part2.cs 2493 method_645: the subject empire (or the intelligence mission's / data's target empire). */
function showEmpire(m: EmpireMessage): AdvisorShowTarget {
    let empire: Empire | null = null;
    const subject = m.subject;
    if (subject instanceof Empire) empire = subject;
    else if (subject instanceof IntelligenceMission) empire = subject.targetEmpire;
    else if (m.advisorMessageData instanceof Empire) empire = m.advisorMessageData;
    return { kind: 'empire', empire };
}

/** Main.Part2.cs 2516 method_646: the subject habitat (or the data habitat), zoom 3500. */
function showHabitat(m: EmpireMessage): AdvisorShowTarget | null {
    let habitat: Habitat | null = null;
    if (m.subject instanceof Habitat) habitat = m.subject;
    else if (m.advisorMessageData instanceof Habitat) habitat = m.advisorMessageData;
    if (habitat === null) return null;
    return { kind: 'object', object: habitat, x: habitat.xpos, y: habitat.ypos, zoom: 3500.0 };
}

/** Main.Part2.cs 2546 method_647: the subject object (fleet → lead ship position; pirate mission → its target). */
function showObject(m: EmpireMessage): AdvisorShowTarget | null {
    let obj: Habitat | BuiltObject | Creature | ShipGroup | null = null;
    let x = 0;
    let y = 0;
    const subject = m.subject;
    if (subject instanceof BuiltObject || subject instanceof Habitat || subject instanceof Creature) {
        obj = subject;
        x = subject.xpos;
        y = subject.ypos;
    }
    if (subject instanceof ShipGroup) {
        obj = subject;
        if (subject.leadShip !== null) {
            x = subject.leadShip.xpos;
            y = subject.leadShip.ypos;
        }
    }
    if (subject instanceof EmpireActivity && subject.target !== null) {
        const t = subject.target as unknown;
        if (t instanceof Habitat || t instanceof BuiltObject || t instanceof Creature) {
            obj = t;
            x = t.xpos;
            y = t.ypos;
        }
    }
    if (obj === null) return null;
    return { kind: 'object', object: obj, x, y, zoom: 3500.0 };
}

/** Main.Part2.cs 2635 btnAdvisorSuggestionShow_Click: the per-type choice of method_645 / 646 / 647. */
export function advisorSuggestionShowTarget(m: EmpireMessage): AdvisorShowTarget | null {
    const T = AdvisorMessageType;
    switch (m.advisorMessageType as AdvisorMessageType) {
        case T.BuildOneOff:
        case T.Colonization:
        case T.EnemyBombard:
        case T.EnemyAttackPlanetDestroyer:
        case T.InvadeIndependent:
        case T.ColonyFacility:
            return showHabitat(m);
        case T.IntelligenceMission:
        case T.PrepareRaid:
        case T.DiplomaticGift:
        case T.TreatyOffer:
        case T.WarTradeSanctions:
        case T.OfferMilitaryRefueling:
        case T.CancelMilitaryRefueling:
        case T.OfferMiningRights:
        case T.CancelMiningRights:
        case T.AllowTradeRestrictedResources:
        case T.DisallowTradeRestrictedResources:
        case T.ComplyTradeSanctionsOther:
        case T.ComplyWarOther:
        case T.RequestLiftTradeSanctionsOther:
        case T.RequestEndWarOther:
            return showEmpire(m);
        case T.EnemyAttack:
        case T.EnemyBlockade:
        case T.DefendTerritory:
        case T.PirateRaid:
        case T.PirateFacilityEradicate:
        case T.OfferPirateAttackMission:
        case T.OfferPirateDefendMission:
        case T.OfferPirateSmuggleMission:
        case T.AcceptPirateSmugglingMission:
        case T.DefendTarget:
            return showObject(m);
        default:
            // BuildOrder opens the Build Order screen instead (Main.Part12.cs 2715 → method_628); Retrofit has no Show.
            return null;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Decline.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Main.Part2.cs 2732 btnAdvisorSuggestionDecline_Click: remove the suggestion; for the four attack types record the
 * target empire (ResolveTargetEmpireFromSubject) for 240 000, and record the subject (BuiltObject / Habitat /
 * IntelligenceMission / Empire) for 600 000, so CheckTaskAuthorized does not re-suggest it within those windows.
 * Returns false when `message` is not an advisor suggestion. No Rnd.
 */
export function declineSuggestion(galaxy: Galaxy, player: Empire, message: EmpireMessage): boolean {
    if (message == null || message.messageType !== EmpireMessageType.AdvisorSuggestion) return false;
    removeAdvisorSuggestion(player, message);
    const currentStarDate = galaxyStarDate(galaxy);
    let empire: Empire | null = null;
    const t = message.advisorMessageType as AdvisorMessageType;
    if (t === AdvisorMessageType.EnemyAttack || t === AdvisorMessageType.EnemyAttackPlanetDestroyer || t === AdvisorMessageType.EnemyBlockade || t === AdvisorMessageType.EnemyBombard) {
        empire = resolveAdvisorTargetEmpire(message);
    }
    // 2741-2767 (the same records as Empire.8.cs 4425-4449).
    addDeclinedTasks(player.declinedTasks, currentStarDate, message.subject, empire);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Approve.
// ---------------------------------------------------------------------------------------------------------------

function isDesign(o: unknown): o is Design {
    return o instanceof Design;
}

function isFacility(o: unknown): o is Facility {
    return o !== null && typeof o === 'object' && typeof (o as Facility).facilityId === 'number' && !(o instanceof PlanetaryFacility);
}

/** `Designs.FindNewestCanBuild(ColonyShip) ?? Designs.FindNewest(ColonyShip)` (1471-1478 / 1540-1547). */
function colonyShipDesign(player: Empire): Design | null {
    let design = dlFindNewestCanBuild(player.designs, BuiltObjectSubRole.ColonyShip);
    if (design === null) design = findNewest(player.designs, BuiltObjectSubRole.ColonyShip);
    return design;
}

/** Empire.7.cs 1637 ColonizableHabitatTypesNonTechForEmpire(empire): native types of big colonies beyond the tech types. */
export function colonizableHabitatTypesNonTechForEmpire(self: Empire, empire: Empire): HabitatType[] {
    const list: HabitatType[] = [];
    const list2 = colonizableHabitatTypesForEmpireTechOnly(empire);
    for (let i = 0; i < self.colonies.length; i++) {
        const habitat = self.colonies[i];
        if (habitat.population != null && habitat.population.totalAmount >= BUILD_COLONY_SHIP_POPULATION_REQUIREMENT) {
            const dominantRace = habitat.population.dominantRace;
            if (dominantRace != null && !list2.includes(dominantRace.nativeHabitatType) && !list.includes(dominantRace.nativeHabitatType)) list.push(dominantRace.nativeHabitatType);
        }
    }
    return list;
}

/** Empire.7.cs 1544 ColonizableHabitatTypesFromColonyShips(empire, empireHabitatTypes). */
function colonizableHabitatTypesFromColonyShips(empire: Empire, empireHabitatTypes: HabitatType[]): HabitatType[] {
    for (let i = 0; i < empire.builtObjects.length; i++) {
        const builtObject = empire.builtObjects[i];
        if (builtObject.subRole !== BuiltObjectSubRole.ColonyShip) continue;
        if (builtObject.nativeRace !== null && !empireHabitatTypes.includes(builtObject.nativeRace.nativeHabitatType)) empireHabitatTypes.push(builtObject.nativeRace.nativeHabitatType);
    }
    return empireHabitatTypes;
}

/** Empire.4.cs 4560 CanEmpireColonizeHabitat(habitat, out explanation). No Rnd. */
export function canEmpireColonizeHabitatExplained(galaxy: Galaxy, self: Empire, habitat: Habitat): { result: boolean; explanation: string } {
    if (!galaxy.checkEmpireTerritoryCanColonizeHabitat(self, habitat)) return { result: false, explanation: getText('Colonization Not Possible - Foreign Territory') };
    if (habitat.empire === galaxy.independentEmpire && habitat.population != null && habitat.population.totalAmount > 0) {
        if (!canEmpireColonizeHabitatRange(galaxy, self, habitat)) return { result: false, explanation: getText('Colonization Not Possible - Outside Range Limit') };
        const num = checkColonizationLikeliness(galaxy, habitat, self.dominantRace!);
        let explanation: string;
        if (num <= -20) explanation = getText('Colonization Probability Most unlikely');
        else if (num <= -5) explanation = getText('Colonization Probability Unlikely');
        else if (num <= 5) explanation = getText('Colonization Probability Possible');
        else explanation = getText('Colonization Probability Probable');
        return { result: true, explanation };
    }
    const design = colonyShipDesign(self);
    if (self.canDesignColonizeHabitat(design, habitat)) {
        if (!canEmpireColonizeHabitatRange(galaxy, self, habitat)) return { result: false, explanation: getText('Colonization Not Possible - Outside Range Limit') };
        return { result: true, explanation: getText('Colonization - Yes, using current colonization tech') };
    }
    let list = colonizableHabitatTypesNonTechForEmpire(self, self);
    if (list.includes(habitat.type)) {
        if (!canEmpireColonizeHabitatRange(galaxy, self, habitat)) return { result: false, explanation: getText('Colonization Not Possible - Outside Range Limit') };
        for (let i = 0; i < self.colonies.length; i++) {
            const habitat2 = self.colonies[i];
            const race = habitat2.population != null ? habitat2.population.dominantRace : null;
            if (race != null && race.nativeHabitatType === habitat.type && (habitat.category === HabitatCategoryType.Planet || habitat.category === HabitatCategoryType.Moon)) {
                return { result: true, explanation: formatText(getText('Colonization - Yes, native type for RACE'), race.name) };
            }
        }
    }
    list = colonizableHabitatTypesFromColonyShips(self, list);
    if (list.includes(habitat.type)) {
        if (!canEmpireColonizeHabitatRange(galaxy, self, habitat)) return { result: false, explanation: getText('Colonization Not Possible - Outside Range Limit') };
        for (let j = 0; j < self.builtObjects.length; j++) {
            const builtObject = self.builtObjects[j];
            if (builtObject.subRole === BuiltObjectSubRole.ColonyShip && canBuiltObjectColonizeHabitat(galaxy, self, builtObject, habitat).result) {
                return { result: true, explanation: formatText(getText('Colonization - Yes, using colony ship NAME'), builtObject.name) };
            }
        }
    }
    return { result: false, explanation: getText('No, unable to colonize') };
}

/** Main.Part2.cs 1386-1444: BuildOneOff — buy the proposed design at the subject colony. */
function approveBuildOneOff(galaxy: Galaxy, player: Empire, habitat6: Habitat, design3: Design): void {
    const num7 = design3.calculateCurrentPurchasePrice(galaxy);
    calculateSupportCost(galaxy, player, design3); // 1391 (result unused)
    calculateSpareAnnualRevenueComplete(galaxy, player); // 1392 (result unused)
    if (!(num7 <= player.stateMoney)) return;
    design3.buildCount++;
    const builtObject6 = new BuiltObject(design3, galaxy.generateBuiltObjectName(design3), galaxy);
    builtObject6.purchasePrice = num7;
    const q = queueOf(habitat6);
    if (q !== null && q.addBuiltObjectToConstruct(builtObject6)) {
        if (design3.subRole === BuiltObjectSubRole.DefensiveBase) {
            // 1403-1411
            const array = [getText('Ship SubRole DefensiveBase'), getText('Weapons Platform'), getText('Defense Platform'), getText('Defense Battery'), getText('Orbital Battery')];
            builtObject6.name = habitat6.name + ' ' + array[galaxy.rnd.next(0, array.length)];
        } else {
            builtObject6.name = galaxy.generateBuiltObjectName(design3, habitat6);
        }
        // 1417-1425
        let offset = determineOrbitalBaseLocation(galaxy, habitat6);
        if (design3.subRole === BuiltObjectSubRole.SmallSpacePort || design3.subRole === BuiltObjectSubRole.MediumSpacePort || design3.subRole === BuiltObjectSubRole.LargeSpacePort) {
            // (double)(habitat6.Diameter / 6) + 15.0: Diameter is a short → integer division.
            const range = Math.trunc(habitat6.diameter / 6) + 15.0;
            offset = galaxy.selectRelativePoint(range);
        }
        builtObject6.heading = galaxy.selectRandomHeading();
        builtObject6.targetHeading = builtObject6.heading;
        player.addBuiltObjectToGalaxy(builtObject6, habitat6, false, true, Math.trunc(offset.x), Math.trunc(offset.y));
        player.stateMoney -= num7;
        pirateEconomyPerformExpense(galaxy, player, num7, PirateExpenseType.Construction, galaxyStarDate(galaxy));
        builtObject6.builtAt = habitat6;
        // 1432-1437
        const resourcesToOrder3 = procureConstructionComponentsAtColony(galaxy, player, builtObject6, habitat6);
        createOrdersFor(galaxy, player, habitat6, resourcesToOrder3, OrderType.ConstructionShortage);
    } else {
        design3.buildCount--;
    }
}

/** Main.Part2.cs 1480-1532 / 1549-1604: build a colony ship for `habitat` at `habitat2` (or the shortest queue). */
function approveBuildColonyShip(galaxy: Galaxy, player: Empire, habitat: Habitat, habitat2: Habitat | null): void {
    const design = colonyShipDesign(player);
    if (design === null) return;
    const list = player.colonizableHabitatTypesForEmpire();
    const flag = player.canDesignColonizeHabitat(design, habitat);
    if (!flag && !list.includes(habitat.type)) return;
    const num3 = design.calculateCurrentPurchasePrice(galaxy);
    if (!(num3 <= player.stateMoney)) return;
    design.buildCount++;
    const builtObject2 = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy);
    builtObject2.purchasePrice = num3;
    if (habitat2 === null) {
        if (flag) {
            habitat2 = habitatsFindShortestConstructionWaitQueue(galaxy, player.colonies, builtObject2).habitat;
        } else {
            const habitatList: Habitat[] = [];
            for (const colony2 of player.colonies) {
                const dominantRace = colony2.population.dominantRace;
                if (dominantRace!.nativeHabitatType === habitat.type) habitatList.push(colony2);
            }
            habitat2 = habitatsFindShortestConstructionWaitQueue(galaxy, habitatList, builtObject2).habitat;
        }
    }
    const q = habitat2 !== null ? queueOf(habitat2) : null;
    if (habitat2 !== null && q !== null && q.addBuiltObjectToConstruct(builtObject2)) {
        builtObject2.name = galaxy.generateBuiltObjectName(design, habitat2);
        player.addBuiltObjectToGalaxy(builtObject2, habitat2, false, true);
        player.stateMoney -= num3;
        pirateEconomyPerformExpense(galaxy, player, num3, PirateExpenseType.Construction, galaxyStarDate(galaxy));
        assignMission(galaxy, builtObject2, BuiltObjectMissionType.Colonize, habitat, null, BuiltObjectMissionPriority.Normal);
        builtObject2.builtAt = habitat2;
        const resourcesToOrder = procureConstructionComponentsAtColony(galaxy, player, builtObject2, habitat2);
        createOrdersFor(galaxy, player, habitat2, resourcesToOrder, OrderType.ConstructionShortage);
    } else {
        design.buildCount--;
    }
}

/** The WaitAndAttack / WaitAndBombard arrival date (1640-1648 / 1729-1737); null when the C# would divide by zero. */
function waitStarDate(galaxy: Galaxy, player: Empire, fleet: ShipGroup, stellarObject: StellarObject): number | null {
    void player;
    let num9 = 2;
    const bays = stellarDockingBays(stellarObject);
    if (bays != null) num9 = bays.length;
    // long division: an empty DockingBays list makes the C# throw DivideByZeroException out of the click handler
    // (the suggestion stays queued); the port refuses the approval the same way.
    if (num9 === 0) return null;
    const num10 = Math.trunc((fleet.ships.length * FLEET_ASSEMBLE_ATTACK_WAIT_PERIOD_PER_SHIP) / num9);
    return determineLatestArrivalAtDestination(galaxy, fleet, stellarObject.xpos, stellarObject.ypos) + num10;
}

function asStellar(o: unknown): StellarObject | null {
    return o instanceof Habitat || o instanceof BuiltObject || o instanceof Creature ? o : null;
}

/**
 * Main.Part2.cs 1369 btnAdvisorSuggestionApprove_Click: perform the suggested task (the branch for its
 * AdvisorMessageType) and remove the suggestion from the queue. BuildOrder has no branch (its entry opens the Build
 * Order screen; Main.Part12.cs 2715), so approving one only removes it.
 */
export function approveSuggestion(galaxy: Galaxy, player: Empire, message: EmpireMessage): ApproveResult {
    const out: ApproveResult = { handled: false, expireDiplomacyFor: [] };
    if (message == null || message.messageType !== EmpireMessageType.AdvisorSuggestion) return out;
    out.handled = true;
    const expire = (e: Empire): void => {
        // diplomaticMessageQueue_0.ExpireDiplomacyMessagesForEmpire(e): the advisor entries here, the rest by the UI.
        expireAdvisorSuggestionsForEmpire(player, e);
        out.expireDiplomacyFor.push(e);
    };
    const subject = message.subject;
    const data = message.advisorMessageData;
    const data2 = message.advisorMessageData2;
    const now = (): number => galaxyStarDate(galaxy);
    const T = AdvisorMessageType;
    switch (message.advisorMessageType as AdvisorMessageType) {
        case T.BuildOneOff: // 1375
            if (subject instanceof Habitat && isDesign(data)) approveBuildOneOff(galaxy, player, subject, data);
            break;
        case T.Colonization: {
            // 1446
            if (!(subject instanceof Habitat)) break;
            const habitat = subject;
            if (!canEmpireColonizeHabitatExplained(galaxy, player, habitat).result) break;
            if (data != null) {
                if (data instanceof BuiltObject) {
                    // 1459-1466
                    if (data.subRole === BuiltObjectSubRole.ColonyShip) assignMission(galaxy, data, BuiltObjectMissionType.Colonize, habitat, null, BuiltObjectMissionPriority.Normal);
                } else if (data instanceof Habitat) {
                    // 1467-1535
                    approveBuildColonyShip(galaxy, player, habitat, data);
                }
                break;
            }
            // 1538-1605
            approveBuildColonyShip(galaxy, player, habitat, null);
            break;
        }
        case T.IntelligenceMission: // 1608
            if (subject instanceof IntelligenceMission && data instanceof Character) {
                subject.startDate = now(); // ResetStartDate
                subject.agent = data;
                data.mission = subject;
            }
            break;
        case T.EnemyAttack: {
            // 1627
            if (!(data instanceof ShipGroup)) break;
            const shipGroup6 = data;
            let stellarObject2: StellarObject | null = null;
            let starDate4 = now();
            const so = asStellar(data2);
            if (so !== null) {
                stellarObject2 = so;
                const d = waitStarDate(galaxy, player, shipGroup6, so);
                if (d === null) return { handled: false, expireDiplomacyFor: [] };
                starDate4 = d;
            }
            if (subject == null) break;
            if (subject instanceof BuiltObject) {
                forceCompleteMission(galaxy, shipGroup6);
                if (stellarObject2 !== null) {
                    shipGroupAssignMission(galaxy, shipGroup6, BuiltObjectMissionType.WaitAndAttack, subject, stellarObject2, BuiltObjectMissionPriority.High, false, null, starDate4);
                    break;
                }
                let missionType = BuiltObjectMissionType.Attack;
                if (shipGroup6.empire !== null) missionType = determineDestroyOrCaptureTargetForFleet(galaxy, shipGroup6.empire, shipGroup6, subject);
                shipGroupAssignMission(galaxy, shipGroup6, missionType, subject, null, BuiltObjectMissionPriority.High, false);
            } else if (subject instanceof Habitat || subject instanceof Creature || subject instanceof ShipGroup) {
                forceCompleteMission(galaxy, shipGroup6);
                if (stellarObject2 !== null) shipGroupAssignMission(galaxy, shipGroup6, BuiltObjectMissionType.WaitAndAttack, subject, stellarObject2, BuiltObjectMissionPriority.High, false, null, starDate4);
                else shipGroupAssignMission(galaxy, shipGroup6, BuiltObjectMissionType.Attack, subject, null, BuiltObjectMissionPriority.High, false);
            }
            break;
        }
        case T.EnemyBombard: {
            // 1716
            if (!(data instanceof ShipGroup)) break;
            const shipGroup2 = data;
            let stellarObject: StellarObject | null = null;
            let starDate3 = now();
            const so = asStellar(data2);
            if (so !== null) {
                stellarObject = so;
                const d = waitStarDate(galaxy, player, shipGroup2, so);
                if (d === null) return { handled: false, expireDiplomacyFor: [] };
                starDate3 = d;
            }
            if (subject instanceof Habitat) {
                forceCompleteMission(galaxy, shipGroup2);
                if (stellarObject !== null) shipGroupAssignMission(galaxy, shipGroup2, BuiltObjectMissionType.WaitAndBombard, subject, stellarObject, BuiltObjectMissionPriority.High, false, null, starDate3);
                else shipGroupAssignMission(galaxy, shipGroup2, BuiltObjectMissionType.Bombard, subject, null, BuiltObjectMissionPriority.High, false);
            }
            break;
        }
        case T.EnemyBlockade: {
            // 1756: ImplementBlockade(target, sendFleet: true, performAuthorizationCheck: false, ref refusalCount, fleet)
            if (!(data instanceof ShipGroup) || subject == null) break;
            const refusalCount = { value: 0 };
            if (subject instanceof BuiltObject) implementBlockadeBuiltObject(galaxy, player, subject, true, false, refusalCount, data);
            else if (subject instanceof Habitat) implementBlockadeColony(galaxy, player, subject, true, false, refusalCount, data);
            break;
        }
        case T.EnemyAttackPlanetDestroyer: // 1779
            if (data instanceof BuiltObject && subject instanceof Habitat) {
                if (!subject.hasBeenDestroyed && subject.empire !== player) assignMission(galaxy, data, BuiltObjectMissionType.Attack, subject, null, BuiltObjectMissionPriority.Normal);
            }
            break;
        case T.InvadeIndependent: // 1796
            if (subject instanceof Habitat && data instanceof ShipGroup && shipGroupTotalTroopAttackStrength(data) > 0) {
                shipGroupAssignMission(galaxy, data, BuiltObjectMissionType.Attack, subject, null, BuiltObjectMissionPriority.High, false);
            }
            break;
        case T.PrepareRaid: // 1813
            if (subject instanceof Empire && subject !== player && subject.active) player.empiresToAttack.push(subject);
            break;
        case T.DiplomaticGift: {
            // 1823
            if (!(subject instanceof Empire)) break;
            const num6 = message.money;
            if (player.stateMoney >= num6) {
                const empireMessage2 = new EmpireMessage(player, EmpireMessageType.GiveGift, null);
                empireMessage2.money = Math.trunc(num6);
                player.stateMoney -= num6;
                pirateEconomyPerformExpense(galaxy, player, num6, PirateExpenseType.Undefined, now());
                empireMessage2.description = formatText(getText('Please accept our gift of X credits'), formatThousands(num6)); // "###,###,###,##0"
                sendEmpireMessage(empireMessage2, subject);
                obtainDiplomaticRelation(player, subject);
            }
            break;
        }
        case T.TreatyOffer:
        case T.WarTradeSanctions:
            // 1846
            if (!(subject instanceof Empire) || subject === player || !subject.active) break;
            if (typeof data === 'number') approveDiplomaticRelation(galaxy, player, subject, data as DiplomaticRelationType, expire);
            else if (data instanceof BoxedPirateRelationType) approvePirateRelation(galaxy, player, subject, data.pirateRelationType as PirateRelationType);
            break;
        case T.ColonyFacility: // 2005
            if (subject instanceof Habitat && isFacility(data)) approveColonyFacility(galaxy, player, subject, data);
            break;
        case T.OfferMilitaryRefueling: // 2085
            if (subject instanceof Empire && subject !== player && subject.active) {
                const r = obtainDiplomaticRelation(player, subject);
                if (r.type !== DiplomaticRelationType.NotMet && r.type !== DiplomaticRelationType.War) offerMilitaryRefueling(player, subject);
            }
            break;
        case T.CancelMilitaryRefueling: // 2102
            if (subject instanceof Empire && subject !== player && subject.active) {
                const r = obtainDiplomaticRelation(player, subject);
                if (r.militaryRefuelingToOther) {
                    r.militaryRefuelingToOther = false;
                    sendMessageToEmpire(player, subject, EmpireMessageType.MilitaryRefuelingBlocked, player, getText('Military Refueling Blocked'));
                }
            }
            break;
        case T.OfferMiningRights: // 2121
            if (subject instanceof Empire && subject !== player && subject.active) {
                const r = obtainDiplomaticRelation(player, subject);
                if (r.type !== DiplomaticRelationType.NotMet && r.type !== DiplomaticRelationType.War) offerMiningRights(player, subject);
            }
            break;
        case T.CancelMiningRights: // 2138
            if (subject instanceof Empire && subject !== player && subject.active) {
                const r = obtainDiplomaticRelation(player, subject);
                if (r.miningRightsToOther) {
                    r.miningRightsToOther = false;
                    sendMessageToEmpire(player, subject, EmpireMessageType.MiningRightsBlocked, player, getText('Mining Rights Blocked'));
                }
            }
            break;
        case T.AllowTradeRestrictedResources: // 2157
            if (subject instanceof Empire && subject !== player && subject.active) {
                const r = obtainDiplomaticRelation(player, subject);
                if (!r.supplyRestrictedResources) {
                    r.supplyRestrictedResources = true;
                    sendMessageToEmpire(player, subject, EmpireMessageType.RestrictedResourceTradingAllowed, player, formatText(getText('Trade Restricted Resource EMPIRE'), player.name));
                }
            }
            break;
        case T.DisallowTradeRestrictedResources: // 2176
            if (subject instanceof Empire && subject !== player && subject.active) {
                const r = obtainDiplomaticRelation(player, subject);
                if (r.supplyRestrictedResources) {
                    r.supplyRestrictedResources = false;
                    sendMessageToEmpire(player, subject, EmpireMessageType.RestrictedResourceTradingBlocked, player, formatText(getText('Trade Restricted Resource Refuse EMPIRE'), player.name));
                }
            }
            break;
        case T.ComplyTradeSanctionsOther: // 2195
            if (subject instanceof Empire && subject !== player && subject.active && data instanceof Empire) {
                const current = obtainDiplomaticRelation(player, subject);
                changeDiplomaticRelation(galaxy, player, current, DiplomaticRelationType.TradeSanctions);
                sendMessageToEmpire(player, subject, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.TradeSanctions, getText('We terminate all trade with you effective immediately!'));
                sendMessageToEmpire(player, data, EmpireMessageType.Informational, null, formatText(getText('We join you in trade embargo against the EMPIRE'), subject.name));
                const ev3 = obtainEmpireEvaluation(galaxy, data, player);
                ev3.incidentEvaluation = ev3.incidentEvaluationRaw + 5.0;
                expire(subject);
            }
            break;
        case T.ComplyWarOther: // 2218
            if (subject instanceof Empire && subject !== player && subject.active && data instanceof Empire) {
                declareWar(galaxy, player, subject);
                sendMessageToEmpire(player, data, EmpireMessageType.Informational, null, formatText(getText('We join you in battle against the EMPIRE'), subject.name));
                const ev2 = obtainEmpireEvaluation(galaxy, data, player);
                ev2.incidentEvaluation = ev2.incidentEvaluationRaw + 10.0;
                expire(subject);
            }
            break;
        case T.DefendTerritory: // 2239
            if (subject instanceof ShipGroup) {
                if (subject.empire !== player && data instanceof ShipGroup) shipGroupAssignMission(galaxy, data, BuiltObjectMissionType.Attack, subject, null, BuiltObjectMissionPriority.High, false);
            } else if (subject instanceof BuiltObject) {
                if (subject.empire === player || !(data instanceof BuiltObject)) break;
                let missionType = BuiltObjectMissionType.Attack;
                if (data.empire !== null) missionType = determineDestroyOrCaptureTarget(galaxy, data.empire, data, subject, false);
                recordRevertMission(galaxy, data, missionType, true);
                assignMission(galaxy, data, missionType, subject, null, BuiltObjectMissionPriority.High);
            }
            break;
        case T.Retrofit: {
            // 2272: DoRetrofit(private ships + the subject list (or all state ships), now, 0, 0, true, true, true)
            const list: BuiltObject[] = [...player.privateBuiltObjects];
            if (Array.isArray(subject)) list.push(...(subject as BuiltObject[]));
            else list.push(...(player.builtObjects as BuiltObject[]));
            doRetrofit(galaxy, player, list, now(), 0, 0, true, true, true);
            break;
        }
        case T.RequestLiftTradeSanctionsOther: // 2292
        case T.RequestEndWarOther: {
            // 2313
            if (!(subject instanceof Empire) || subject === player || !subject.active || !(data instanceof Empire)) break;
            const ours = weightedMilitaryPotency(player);
            const theirs = weightedMilitaryPotency(subject);
            const potency = evaluateMilitaryPotency(galaxy, ours, theirs, subject);
            const type = message.advisorMessageType === T.RequestLiftTradeSanctionsOther ? EmpireMessageType.RequestLiftTradeSanctions : EmpireMessageType.RequestStopWar;
            sendMessageToEmpire(player, subject, type, data, generateMessageDescriptionType(type, potency, data));
            break;
        }
        case T.OfferPirateAttackMission: // 2334
        case T.OfferPirateDefendMission: // 2345
        case T.OfferPirateSmuggleMission: {
            // 2356
            const want = message.advisorMessageType === T.OfferPirateAttackMission ? EmpireActivityType.Attack : message.advisorMessageType === T.OfferPirateDefendMission ? EmpireActivityType.Defend : EmpireActivityType.Smuggle;
            if (data instanceof EmpireActivity && data.type === want && !player.pirateMissions.containsEquivalentTarget(data.target, data.type)) {
                player.pirateMissions.add(data);
                galaxy.pirateMissions.add(data);
            }
            break;
        }
        case T.PirateRaid: // 2367
            if (data instanceof ShipGroup && subject != null) {
                if (subject instanceof BuiltObject || subject instanceof Habitat) {
                    forceCompleteMission(galaxy, data);
                    shipGroupAssignMission(galaxy, data, BuiltObjectMissionType.Raid, subject, null, BuiltObjectMissionPriority.High, false);
                }
            }
            break;
        case T.PirateFacilityEradicate: // 2391
            if (subject instanceof Habitat && data instanceof PlanetaryFacility && checkCanInitiateAttackAgainstPirateFacilities(galaxy, subject, player, data)) {
                initiateAttackAgainstPirateFacilities(galaxy, subject, player, data);
            }
            break;
        case T.AcceptPirateSmugglingMission: // 2408
            if (data instanceof EmpireActivity && data.type === EmpireActivityType.Smuggle && data.requestingEmpire !== player) player.pirateMissions.add(data);
            break;
        case T.DefendTarget: {
            // 2418
            if (!(data instanceof ShipGroup) || subject == null) break;
            if (subject instanceof BuiltObject || subject instanceof Habitat) {
                const first = player.pirateMissions.getFirstByTargetAndType(subject, EmpireActivityType.Defend);
                let starDate = now();
                if (first !== null) starDate = first.expiryDate;
                forceCompleteMission(galaxy, data);
                shipGroupAssignMission(galaxy, data, BuiltObjectMissionType.MoveAndWait, subject, null, BuiltObjectMissionPriority.High, false, null, starDate);
            }
            break;
        }
    }
    // 2456
    removeAdvisorSuggestion(player, message);
    return out;
}

/** Main.Part2.cs 1857-1994: TreatyOffer / WarTradeSanctions with a DiplomaticRelationType. */
function approveDiplomaticRelation(galaxy: Galaxy, player: Empire, empire6: Empire, diplomaticRelationType: DiplomaticRelationType, expire: (e: Empire) => void): void {
    const R = DiplomaticRelationType;
    const now = galaxyStarDate(galaxy);
    const diplomaticRelation4 = obtainDiplomaticRelation(player, empire6);
    let flag3 = false;
    let description3 = '';
    let messageHint = '';
    switch (diplomaticRelationType) {
        case R.None:
            if (diplomaticRelation4.type === R.War) {
                flag3 = false;
                description3 = getText('We urge you to consider our proposal for an end to this pointless war'); // Empire.7.cs 3844
                messageHint = resolveDescription(DiplomaticRelationType, R.War);
            } else if (diplomaticRelation4.type === R.TradeSanctions) {
                flag3 = diplomaticRelation4.initiator === player;
            } else if (diplomaticRelation4.type === R.SubjugatedDominion) {
                if (diplomaticRelation4.initiator === player) {
                    flag3 = true;
                    description3 = getText('We are releasing you from subjugation to us. We no longer consider you to be our conquered dominion.'); // Empire.7.cs 3849
                    messageHint = resolveDescription(DiplomaticRelationType, R.SubjugatedDominion);
                } else {
                    flag3 = false;
                }
            } else {
                flag3 = true;
                description3 = getText('We cancel our treaty with you.');
                messageHint = resolveDescription(DiplomaticRelationType, diplomaticRelation4.type);
            }
            break;
        case R.SubjugatedDominion:
        case R.FreeTradeAgreement:
        case R.MutualDefensePact:
        case R.Protectorate:
            flag3 = false;
            break;
        case R.TradeSanctions:
        case R.War:
            flag3 = true;
            break;
    }
    if (flag3) {
        switch (diplomaticRelationType) {
            default:
                changeDiplomaticRelation(galaxy, player, diplomaticRelation4, diplomaticRelationType);
                diplomaticRelation4.lastDiplomacyTradeOfferDate = now;
                sendMessageToEmpire(player, empire6, EmpireMessageType.DiplomaticRelationChange, diplomaticRelationType, description3, { x: 0, y: 0 }, messageHint);
                expire(empire6);
                break;
            case R.TradeSanctions: {
                const empireEvaluation = obtainEmpireEvaluation(galaxy, empire6, player);
                changeDiplomaticRelation(galaxy, player, diplomaticRelation4, R.TradeSanctions);
                empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw - 20.0;
                diplomaticRelation4.lastDiplomacyTradeOfferDate = now;
                const ourPotencyVersusThem2 = determineRelativeStrength(galaxy, militaryPotency(player), empire6);
                const description5 = generateMessageDescriptionRelation(diplomaticRelation4, R.TradeSanctions, ourPotencyVersusThem2);
                sendMessageToEmpire(player, empire6, EmpireMessageType.DiplomaticRelationChange, R.TradeSanctions, description5);
                expire(empire6);
                break;
            }
            case R.War:
                declareWar(galaxy, player, empire6);
                expire(empire6);
                break;
            case R.None:
                if (diplomaticRelation4.type === R.TradeSanctions) {
                    changeDiplomaticRelation(galaxy, player, diplomaticRelation4, R.None);
                    cancelBlockades(galaxy, player, empire6);
                    cancelBlockades(galaxy, empire6, player);
                    diplomaticRelation4.lastDiplomacyTradeOfferDate = now;
                    const description4 = getText('Our trade sanctions against you have been lifted - we will now resume trade.'); // Empire.7.cs 3854
                    sendMessageToEmpire(player, empire6, EmpireMessageType.DiplomaticRelationChange, R.None, description4, { x: 0, y: 0 }, resolveDescription(DiplomaticRelationType, R.TradeSanctions));
                    expire(empire6);
                } else {
                    changeDiplomaticRelation(galaxy, player, diplomaticRelation4, diplomaticRelationType);
                    diplomaticRelation4.lastDiplomacyTradeOfferDate = now;
                    sendMessageToEmpire(player, empire6, EmpireMessageType.DiplomaticRelationChange, diplomaticRelationType, description3, { x: 0, y: 0 }, messageHint);
                    expire(empire6);
                }
                break;
        }
    } else {
        // 1985-1993: propose the treaty.
        const diplomaticRelation5 = new DiplomaticRelation(diplomaticRelationType, player, player, empire6, now, diplomaticRelation4.supplyRestrictedResources);
        const ourPotencyVersusThem3 = determineRelativeStrength(galaxy, militaryPotency(player), empire6);
        empire6.proposedDiplomaticRelations.add(diplomaticRelation5);
        const description6 = generateMessageDescriptionRelation(diplomaticRelation4, diplomaticRelationType, ourPotencyVersusThem3);
        diplomaticRelation4.lastDiplomacyTradeOfferDate = now;
        sendMessageToEmpire(player, empire6, EmpireMessageType.ProposeDiplomaticRelation, diplomaticRelationType, description6);
    }
}

/** Main.Part2.cs 1995-2027: TreatyOffer with a PirateRelationType (pirate protection offer / cancel). */
function approvePirateRelation(galaxy: Galaxy, player: Empire, empire6: Empire, pirateRelationType: PirateRelationType): void {
    const pirateRelation = obtainPirateRelation(player, empire6);
    const now = galaxyStarDate(galaxy);
    switch (pirateRelationType) {
        case PirateRelationType.None: {
            changePirateRelation(player, empire6, PirateRelationType.None, now);
            const empty = getText('Cancel Pirate Protection');
            sendMessageToEmpire(player, empire6, EmpireMessageType.CancelPirateProtection, player, empty);
            break;
        }
        case PirateRelationType.Protection: {
            let empty = getText('Pirate Offer Protection');
            if (player.pirateEmpireBaseHabitat !== null && empire6.pirateEmpireBaseHabitat !== null) empty = getText('Pirate Offer Protection Other Pirate');
            const empireMessage = new EmpireMessage(player, EmpireMessageType.PirateOfferProtection, null);
            empireMessage.description = empty;
            if (empire6.pirateEmpireBaseHabitat === null) empireMessage.money = Math.trunc(calculatePirateProtectionPricePerMonth(galaxy, player, empire6).price);
            sendEmpireMessage(empireMessage, empire6);
            pirateRelation.lastOfferDate = now;
            break;
        }
    }
}

/** Main.Part2.cs 2005-2083: ColonyFacility — queue the facility (or wonder) and pay for it. */
function approveColonyFacility(galaxy: Galaxy, player: Empire, habitat8: Habitat, def: Facility): void {
    const type = facilityType(def);
    if (type === PlanetaryFacilityType.Undefined) return;
    const num8 = calculatePlanetaryFacilityCost(def, player);
    if (!(player.stateMoney >= num8)) return;
    const facilities = habitat8.facilities ?? [];
    if (type === PlanetaryFacilityType.Wonder) {
        // 2027-2033: Facilities.CountWonderByType(def.WonderType) <= 0
        let wonders = 0;
        for (const f of facilities) if (f.type === PlanetaryFacilityType.Wonder && (f.wonderType as number) === def.wonderType) wonders++;
        if (wonders <= 0 && queueWonderConstruction(galaxy, habitat8, def)) {
            player.stateMoney -= num8;
            pirateEconomyPerformExpense(galaxy, player, num8, PirateExpenseType.FacilityConstruction, galaxyStarDate(galaxy));
        }
        return;
    }
    if (facilitiesCountByType(facilities, type) > 0) return;
    let flag4 = true;
    let pirateColonyControl = null;
    if (player.pirateEmpireBaseHabitat !== null) {
        pirateColonyControl = habitat8.pirateColonyControl.getByFaction(player);
        if (pirateColonyControl !== null) {
            switch (type) {
                case PlanetaryFacilityType.PirateCriminalNetwork:
                    flag4 = pirateColonyControl.controlLevel >= 1 && facilitiesCountCompletedByType(facilities, PlanetaryFacilityType.PirateFortress) > 0;
                    break;
                case PlanetaryFacilityType.PirateBase:
                    flag4 = pirateColonyControl.controlLevel >= 0.5;
                    break;
                case PlanetaryFacilityType.PirateFortress:
                    flag4 = pirateColonyControl.controlLevel >= 1 && habitat8.facilities != null && facilitiesCountCompletedByType(facilities, PlanetaryFacilityType.PirateBase) > 0;
                    break;
            }
        }
    }
    if (flag4 && queueFacilityConstruction(galaxy, habitat8, type)) {
        player.stateMoney -= num8;
        pirateEconomyPerformExpense(galaxy, player, num8, PirateExpenseType.FacilityConstruction, galaxyStarDate(galaxy));
        if (pirateColonyControl !== null) pirateColonyControl.hasFacilityControl = true;
    }
}

/** Convenience for the UI: the player's queue, newest last (advisorQueue.ts). */
export function pendingAdvisorSuggestions(player: Empire): readonly EmpireMessage[] {
    return advisorSuggestionsView(player);
}

