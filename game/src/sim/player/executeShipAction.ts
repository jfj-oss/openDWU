// 17b — the player order dispatcher: Main.Part7.cs 45-1845 method_347(ShipAction shipAction_1, bool bool_28), with the
// BaconMain.cs 160 HandleToolstripClick hook it starts with, and the small sim helpers it reaches that were not in
// src/sim yet (ported below, cited). UI side effects become fields of the returned ShipActionResult:
//   method_208(x)                     → result.select = x (the new _Game.SelectedObject; `undefined` = unchanged)
//   method_593(action) / method_592() → result.openSubMenu / result.returnToTop (the build / fighter sub-menus)
//   mouseHoverMode_0 = …              → result.mouseHoverMode
//   method_345()                      → result.showSmugglingResourceSelection
//   GenerateAutomationMessageBox(t)   → options.automationPrompt(t) (true = "Turn off automation"); every prompt
//                                       shown is listed in result.automationPrompts (GameText keys).
//   pnlDetailInfo.Invalidate / sounds / music → nothing.
// `_Game.PlayerEmpire` is the `empire` argument, `_Game.SelectedObject` the `selected` argument.
// bool_28 is "invoked from the right-click action menu" (actionMenu_ItemClicked passes true, the colony build panel
// Main.Part3.cs 3730 passes false): it only picks where a colony-built base goes (the menu's screen point, which the
// caller passes already converted to galaxy coordinates as options.actionMenuPoint). Queueing (shift-click) is
// ShipAction.isSubsequentAction.
// Rnd: only through the called sim methods (mission constructors, SelectRelativeParkingPoint, AssignShipSystemPatrol's
// Next, DeployVirus's Next(15, 20) + creature placement). Never on the tick path.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { AutomationLevel, BUILD_COLONY_SHIP_POPULATION_REQUIREMENT } from '../empire';
import type { BuiltObject } from '../builtObject';
import { BuiltObject as BuiltObjectClass } from '../builtObject';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import type { Design } from '../design';
import { galaxyComponentCurrentPrices } from '../design';
import { Habitat, HabitatCategoryType, HabitatType, type SystemInfo } from '../types';
import { Creature, CreatureType } from '../creature';
import { Troop, TroopList, TroopType } from '../cargo';
import type { Race } from '../data/races';
import type { Facility } from '../data/facilities';
import type { Plague } from '../data/plagues';
import { Character, CharacterRole } from '../characters';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { formatText, FleetPosture } from '../diplomacyTick';
import { netSort } from '../netSort';
import { galaxyNow, galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from '../tick/simTime';
import { ColonyResourceEffect, resourceBonusTotalByEffectType } from '../developmentLevel';
import { ResourceGroup, resourceGroupOf } from '../resourceSystem';
import { PlanetaryFacilityType, facilityType } from '../researchSystem';
import { resolveColonyHabitatTypeByIndexDesertBeforeOcean } from '../types';
import { generateNewTroop } from '../builtObjectPlacement';
import { findNewestCanBuild } from '../designGeneration';
import { checkRuinsHaveBenefit, canEmpireColonizeHabitat, investigateRuins } from '../exploration';
import { infectWithPlague } from '../events';
import { exitHyperjump } from '../movement';
import { getPrivateFunds } from '../forceStructure';
import { applyCorruptionToIncome, OrderType } from '../logistics/orders';
import { checkTriggerEvent } from '../story/eventActions';
import { EventTriggerType } from '../story/gameEventModel';
import { identifyPirateBase } from '../characters';
import {
    BuiltObjectMission,
    BuiltObjectMissionPriority,
    BuiltObjectMissionType,
    COORD_UNSET_DOUBLE,
    Sector,
    builtObjectMission,
    type MissionTarget,
    type StellarObject,
} from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements, constructionQueueOf } from '../missions/assign';
import { ShipGroup, empireShipGroups, disbandShipGroup, forceCompleteMission, leaveShipGroup } from '../fleets/shipGroup';
import {
    compareShipGroups,
    getNextFleetNumberDescription,
    selectFleetBase,
    shipGroupAddShipToFleet,
    shipGroupAssignMission,
    shipGroupAssignMissionFull,
    shipGroupIsShipAvailable,
    shipGroupQueueMission,
    shipGroupUpdate,
    empireFindNearestRefuellingPoint,
} from '../fleets/shipGroupTasks';
import { checkAssignFleetWaitAndAttackMission, identifyNearestAvailableFleet, implementBlockade } from '../fleets/militaryAI';
import { blockadeFor } from '../fleets/blockades';
import {
    assignFleetRetrofit,
    assignRetrofitMission,
    colonizableHabitatTypesForEmpireTechOnly,
    findNearestShipYard,
    newBuiltObjectShouldBeAutomated,
    purchaseNewBuiltObject,
    purchaseNewBuiltObjectAt,
    queueOf,
} from '../construction/empireConstruction';
import { componentListDiff, resolveComponentList } from '../construction/constructionYard';
import {
    calculatePlanetaryFacilityCost,
    canBuildWonder,
    countPirateCriminalNetworks,
    definitionsFindFacilityByType,
    facilitiesFindBestPirateFacility,
    identifyEmpireRegionalCapitals,
    planetaryFacilityDefinitionsStatic,
    queueFacilityConstruction,
    queueWonderConstruction,
} from '../construction/facilities';
import { assignMissionToBuiltObject } from '../civilianAI';
import { pirateAssignShipMission, pirateEconomyPerformExpense, pirateEconomyPerformIncome } from '../pirates/pirateAI';
import { PirateExpenseType, PirateIncomeType } from '../pirates/pirateEconomy';
import { EmpireActivity, EmpireActivityType } from '../pirates/empireActivity';
import type { PirateColonyControl } from '../pirates/pirateColonyControl';
import {
    calculatePirateAttackPrice,
    calculatePirateDefendPrice,
    calculatePirateSmugglePricePerUnit,
    createOrderWithExpiry,
    removePirateSmugglingMissionFromAllEmpires,
} from '../pirates/missionsMarket';
import { builtObjectCompleteTeardown } from '../combat/teardown';
import { calculateBuiltObjectLootingValue, empireColonyIncomeFactor, empireLootingFactor, identifyPirateSpaceport } from '../combat/damage';
import { takeOwnershipOfBuiltObject, investigateAbandonedBuiltObject } from '../combat/ownership';
import { assignLoadTroopsMission, findNearestColonyWithExcessTroops, getTroopsNotGarrisonedNotAwaitingPickup } from '../combat/troopsRuntime';
import { troopLevelMinimum } from '../troops';
import { assignFleetUnloadTroops } from '../combat/invasion';
import { evaluateThreats } from '../combat/threats';
import { fastFindNearestColony } from '../combat/threats';
import { BuiltObjectEncounterAction } from '../gameStartTail';
import {
    Fighter,
    FighterType,
    buildNewBomber,
    buildNewFighter,
    fighterCompleteTeardown,
    identifyLatestBomberSpecification,
    identifyLatestFighterSpecification,
    launchAvailableBombers,
    launchAvailableFighters,
    launchFighter,
    returnBombers,
    returnFighters,
    returnToCarrier,
} from '../combat/fighters';
import { ShipAction, ShipActionType, isSystemInfo } from './shipAction';

/** What _Game.SelectedObject can be when an order is given (method_347 handles these five kinds). */
export type ShipActionSelection = BuiltObject | Habitat | ShipGroup | Fighter | BuiltObject[] | null;

/** Main.Part1 MouseHoverMode values method_347 sets (the next map click picks the fleet's attack point / home base). */
export type ShipActionMouseHoverMode = 'SetFleetAttackPoint' | 'SetFleetHomeBase';

export interface ShipActionOptions {
    /**
     * GenerateAutomationMessageBox(task).Show() == "off": asked with the GameText key of the automated task
     * ("Colonization", "Ship Building", "Fleet Formation", "Colony Tax Rates", "Troop Recruitment"); return true for
     * "Turn off automation". Default: automation is left on (the "On" button).
     */
    automationPrompt?: (task: string) => boolean;
    /** bool_28 == true: actionMenu.Left/Top converted by method_151 to galaxy coordinates (colony-built base placement). */
    actionMenuPoint?: { x: number; y: number };
}

export interface ShipActionResult {
    /** false when the order was not executed: nothing selected, not applicable, or it needs an unported sim method. */
    ok: boolean;
    /** The GameText text the C# shows, else a short diagnostic for ok:false. */
    message?: string;
    /** method_208(x): what the UI should select afterwards (`undefined`: leave the selection alone). */
    select?: ShipActionSelection;
    /** Main.Part7.cs 1722-1735: drop the selection from the selection history and select the next entry in it. */
    selectNextFromHistory?: boolean;
    /** method_593(action): open this build / fighter sub-menu. */
    openSubMenu?: ShipAction;
    /** method_592(): back to the top of the action menu. */
    returnToTop?: boolean;
    mouseHoverMode?: ShipActionMouseHoverMode;
    /** method_345(): show the pirate smuggling-mission resource picker for the selected colony. */
    showSmugglingResourceSelection?: boolean;
    /** Bacon mod forms (planetCargoDataForm / CustomizeShipForm / InvasionCommandForm) the hint asks to open. */
    openForm?: 'trade' | 'customizeShip' | 'invasionCommand';
    /** GameText keys of the automation prompts that were asked (GenerateAutomationMessageBox). */
    automationPrompts: string[];
}

class Ctx {
    readonly result: ShipActionResult = { ok: true, automationPrompts: [] };
    constructor(readonly galaxy: Galaxy, readonly empire: Empire, readonly options: ShipActionOptions) {}
    /** `GenerateAutomationMessageBox(TextResolver.GetText(task)).Show(this).ToLower() == "off"`. */
    askTurnOff(task: string): boolean {
        this.result.automationPrompts.push(task);
        return this.options.automationPrompt !== undefined && this.options.automationPrompt(task);
    }
    fail(message: string): ShipActionResult {
        this.result.ok = false;
        this.result.message = message;
        return this.result;
    }
}

/** A TODO(port) stop: the branch needs a sim method that is not ported yet. */
function todoPort(ctx: Ctx, what: string): ShipActionResult {
    return ctx.fail(`TODO(port): ${what}`);
}

function isBuiltObject(o: unknown): o is BuiltObject {
    return o instanceof BuiltObjectClass;
}
function isHabitat(o: unknown): o is Habitat {
    return o instanceof Habitat;
}
function isShipGroup(o: unknown): o is ShipGroup {
    return o instanceof ShipGroup;
}
function isEmpire(o: unknown): o is Empire {
    return o !== null && typeof o === 'object' && (o as Empire).empireId !== undefined && (o as Empire).pirateMissions !== undefined && !(o instanceof BuiltObjectClass);
}
function isStellarObject(o: unknown): o is StellarObject {
    return o instanceof BuiltObjectClass || o instanceof Habitat || o instanceof Creature;
}
/** PlanetaryFacilityDefinition (data/facilities.ts Facility record). */
function isFacilityDefinition(o: unknown): o is Facility {
    return o !== null && typeof o === 'object' && typeof (o as Facility).facilityId === 'number' && typeof (o as Facility).wonderType === 'number';
}
/** Plague (data/plagues.ts record). */
function isPlague(o: unknown): o is Plague {
    return o !== null && typeof o === 'object' && typeof (o as Plague).plagueId === 'number' && typeof (o as Plague).specialFunctionCode === 'number';
}
/** `object target` handed to AssignMission / QueueMission: only StellarObject / ShipGroup / Sector targets mean anything there. */
function missionTarget(o: unknown): MissionTarget | null {
    if (isStellarObject(o) || isShipGroup(o) || o instanceof Sector) return o;
    return null;
}
/** Point.X == 0 && Point.Y == 0. */
function positionIsZero(action: ShipAction): boolean {
    return action.position.x === 0 && action.position.y === 0;
}
/** StellarObject.GameEventId for a Fighter (StellarObject.cs short, default short.MinValue; Fighter carries none in TS). */
function fighterGameEventId(fighter: Fighter): number {
    return (fighter as unknown as { gameEventId?: number }).gameEventId ?? -32768;
}
function fleetName(empire: Empire): string {
    const nextFleetNumberDescription = empire !== null ? getNextFleetNumberDescription(empire) : '';
    return formatText('{0} Fleet', nextFleetNumberDescription); // string.Format(TextResolver.GetText("Nth Fleet"), n)
}
function sortShipGroups(empire: Empire): void {
    netSort(empireShipGroups(empire), compareShipGroups);
}

// ---------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------

/**
 * Main.Part7.cs 45 method_347(shipAction_1, bool_28): execute a player order for the selected object.
 * `fromActionMenu` is bool_28 (see the file header).
 */
export function executeShipAction(
    galaxy: Galaxy,
    empire: Empire,
    selected: ShipActionSelection,
    action: ShipAction,
    fromActionMenu: boolean,
    options: ShipActionOptions = {},
): ShipActionResult {
    const ctx = new Ctx(galaxy, empire, options);
    // 47 BaconMain.HandleToolstripClick(shipAction_1)
    const bacon = handleToolstripClick(ctx, selected, action);
    if (bacon !== null) return bacon;
    // 48-68
    switch (action.actionType) {
        case ShipActionType.ColonyBuildWonder:
        case ShipActionType.BuildOptionsPrivate:
        case ShipActionType.BuildOptions:
        case ShipActionType.ColonyBuildOptions:
        case ShipActionType.FighterOptions:
            ctx.result.openSubMenu = action; // method_593(shipAction_1)
            return ctx.result;
        case ShipActionType.ReturnToTop:
            ctx.result.returnToTop = true; // method_592()
            return ctx.result;
    }
    // 69-72
    if (selected === null) {
        return ctx.fail('no selection');
    }
    if (selected instanceof Fighter) {
        executeForFighter(ctx, selected, action);
        return ctx.result;
    }
    if (isBuiltObject(selected)) {
        return executeForBuiltObject(ctx, selected, action);
    }
    if (isHabitat(selected)) {
        return executeForHabitat(ctx, selected, action, fromActionMenu);
    }
    if (isShipGroup(selected)) {
        return executeForShipGroup(ctx, selected, action);
    }
    // 1557: `if (!(_Game.SelectedObject is BuiltObjectList)) return;`
    if (Array.isArray(selected)) {
        return executeForBuiltObjectList(ctx, selected, action);
    }
    return ctx.fail('unsupported selection');
}

// ---------------------------------------------------------------------------------------------------------------
// BaconMain.cs 160 HandleToolstripClick
// ---------------------------------------------------------------------------------------------------------------

/**
 * BaconMain.cs 160 HandleToolstripClick(action): the Bacon mod's extra menu items (identified by Hint) and its
 * GiveBuiltObject sale price. Returns a result to stop at (a TODO(port) branch), else null to go on with method_347.
 */
function handleToolstripClick(ctx: Ctx, selected: ShipActionSelection, action: ShipAction): ShipActionResult | null {
    // 162: BaconBuiltObject.myMain is set once a game is running (BaconStart.cs 27/47).
    const actionType = action.actionType;
    if (actionType === ShipActionType.GiveBuiltObject) {
        if (!isBuiltObject(action.target)) return null;
        const builtObject = action.target;
        const empire = builtObject.empire;
        if (empire === null) return null; // 175 reads empire.Name before its own null check (a NullReferenceException).
        if (!empire.name.includes('Romulan') && !empire.name.includes('Mining Company')) return null;
        // TODO(port): BaconBuiltObject.FindResalePriceOfShip — BaconBuiltObject.cs 3860 (sale price paid by Target2 to the
        // giver, + a hyperdrive component when the buyer passed PreWarpProgressEventOccurredFirstHyperjump; BaconMain.cs 184-213).
        return todoPort(ctx, 'BaconBuiltObject.FindResalePriceOfShip — BaconBuiltObject.cs:3860');
    }
    switch (action.hint) {
        case 'popup':
            // 215-235: a message box with ExtraData (the game pauses while it shows).
            ctx.result.message = action.extraData ?? '';
            return null;
        case 'sleep': {
            // 237-270
            if (!isBuiltObject(action.target)) return null;
            const builtObject2 = action.target;
            if (builtObject2.empire !== ctx.empire && builtObject2.actualEmpire !== ctx.empire && !ctx.empire.name.includes('Romulan')) return null;
            if (builtObject2.baconValues !== null && builtObject2.baconValues.has('sleep')) {
                builtObject2.baconValues.delete('sleep');
                builtObject2.owner = builtObject2.actualEmpire;
                if (builtObject2.baconValues.size === 0) builtObject2.baconValues = null;
                return null;
            }
            if (builtObject2.baconValues === null) builtObject2.baconValues = new Map();
            builtObject2.baconValues.set('sleep', null);
            const mission = builtObjectMission(builtObject2.mission);
            if (mission !== null) mission.clear();
            builtObject2.owner = null;
            return null;
        }
        case 'asteroidColony':
            return todoPort(ctx, 'BaconHabitat.DeployAsteroidColony — BaconMain.cs:275');
        case 'research': {
            // 279-331: the ship lab's research node per industry (BaconValues lab0/lab1/lab2).
            const builtObject3 = action.target as BuiltObject;
            const researchNode = action.target2 as { industry?: number } | null;
            if (researchNode !== null && researchNode !== undefined && typeof researchNode === 'object') {
                if (builtObject3.baconValues === null) builtObject3.baconValues = new Map();
                // IndustryType: Undefined 0, Weapon 1, Energy 2, HighTech 3.
                switch (researchNode.industry) {
                    case 1:
                        builtObject3.baconValues.set('lab0', researchNode);
                        break;
                    case 2:
                        builtObject3.baconValues.set('lab1', researchNode);
                        break;
                    case 3:
                        builtObject3.baconValues.set('lab2', researchNode);
                        break;
                }
            }
            return null;
        }
        case 'constructShip':
            return todoPort(ctx, 'BaconHabitat.BuildShipForPirate — BaconMain.cs:341');
        case 'missionExploreRuins':
            return todoPort(ctx, 'BaconHabitat.BeginScientificMissionExploreRuins — BaconMain.cs:350');
        case 'missionProspectForResources':
            return todoPort(ctx, 'BaconHabitat.BeginScientificMissionProspectForResources — BaconMain.cs:358');
        case 'trade':
            ctx.result.openForm = 'trade';
            return null;
        case 'recruitShipOfficer':
            return todoPort(ctx, 'BaconBuiltObject.RecruitShipOfficer — BaconMain.cs:374');
        case 'customizeShip':
            ctx.result.openForm = 'customizeShip';
            return null;
        case 'invasionCommand':
            ctx.result.openForm = 'invasionCommand';
            return null;
    }
    void selected;
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Fighter (Main.Part7.cs 73-101)
// ---------------------------------------------------------------------------------------------------------------

function executeForFighter(ctx: Ctx, fighter: Fighter, action: ShipAction): void {
    const { galaxy, empire } = ctx;
    if (fighter.empire !== empire) return;
    switch (action.actionType) {
        case ShipActionType.FighterLaunchFighters:
        case ShipActionType.FighterLaunchBombers:
            if (fighter.onboardCarrier && fighter.parentBuiltObject !== null && !fighter.parentBuiltObject.hasBeenDestroyed) {
                launchFighter(galaxy, fighter.parentBuiltObject, fighter);
            }
            break;
        case ShipActionType.FighterRetrieveFighters:
        case ShipActionType.FighterRetrieveBombers:
            if (!fighter.onboardCarrier && fighter.parentBuiltObject !== null && !fighter.parentBuiltObject.hasBeenDestroyed) {
                returnToCarrier(fighter);
            }
            break;
    }
    const missionType = action.missionType;
    if (missionType === BuiltObjectMissionType.Retire) {
        checkTriggerEvent(galaxy, fighterGameEventId(fighter), empire, EventTriggerType.Destroy, null);
        fighterCompleteTeardown(galaxy, fighter);
        ctx.result.select = null; // method_208(null)
    }
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject (Main.Part7.cs 102-821)
// ---------------------------------------------------------------------------------------------------------------

function executeForBuiltObject(ctx: Ctx, builtObject: BuiltObject, action: ShipAction): ShipActionResult {
    if (builtObject.role === BuiltObjectRole.Base) {
        return executeForBase(ctx, builtObject, action);
    }
    return executeForShip(ctx, builtObject, action);
}

/** Main.Part7.cs 105-393: the selected object is a base. */
function executeForBase(ctx: Ctx, builtObject: BuiltObject, action: ShipAction): ShipActionResult {
    const { galaxy, empire } = ctx;
    // 107-269
    switch (action.actionType) {
        case ShipActionType.ChangePirateHomeBase: {
            if (!isHabitat(action.target)) break;
            const habitat = action.target;
            if (empire.pirateEmpireBaseHabitat !== null && habitat !== null) {
                const builtObject3 = identifyPirateBase(empire);
                if (builtObject3 !== null && builtObject3.supportCostFactor === 0) {
                    builtObject3.supportCostFactor = 1;
                }
                empire.pirateEmpireBaseHabitat = habitat;
                builtObject.supportCostFactor = 0;
            }
            break;
        }
        case ShipActionType.TransferCharacter:
            transferCharacter(ctx, builtObject, action);
            break;
        case ShipActionType.GeneratePirateMissionAttack: {
            const attackPrice2 = calculatePirateAttackPrice(galaxy, empire, builtObject);
            const expiryDate2 = galaxyStarDate(galaxy) + Math.trunc(1.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
            const empireActivity2 = new EmpireActivity(builtObject.empire, empire, expiryDate2, EmpireActivityType.Attack, builtObject, attackPrice2);
            togglePirateMission(ctx, empireActivity2);
            break;
        }
        case ShipActionType.GeneratePirateMissionDefend: {
            const attackPrice = calculatePirateDefendPrice(galaxy, empire, builtObject);
            const expiryDate = galaxyStarDate(galaxy) + Math.trunc(1.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
            const empireActivity = new EmpireActivity(builtObject.empire, empire, expiryDate, EmpireActivityType.Defend, builtObject, attackPrice);
            togglePirateMission(ctx, empireActivity);
            break;
        }
        case ShipActionType.GiveBuiltObject:
            if (giveBuiltObject(ctx, builtObject, action)) return ctx.result;
            break;
        case ShipActionType.FighterBuildFighter:
        case ShipActionType.FighterBuildBomber:
        case ShipActionType.FighterLaunchFighters:
        case ShipActionType.FighterLaunchBombers:
        case ShipActionType.FighterRetrieveFighters:
        case ShipActionType.FighterRetrieveBombers:
            fighterCommand(ctx, builtObject, action.actionType);
            return ctx.result;
        case ShipActionType.AssignAttack:
            // 226-235
            if (builtObject.empire !== null && builtObject.empire.pirateEmpireBaseHabitat !== null) {
                let shipGroup = identifyNearestAvailableFleet(galaxy, empire, builtObject.xpos, builtObject.ypos, false, true, 0.0);
                if (shipGroup === null) {
                    shipGroup = identifyNearestAvailableFleet(galaxy, empire, builtObject.xpos, builtObject.ypos, false, false, 0.0);
                }
                if (shipGroup !== null) {
                    shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Attack, builtObject, null, BuiltObjectMissionPriority.High, true);
                }
            }
            break;
        case ShipActionType.FighterUpgradeAll:
            fighterUpgradeAll(ctx, builtObject);
            return ctx.result;
    }
    // 270-392
    switch (action.missionType) {
        case BuiltObjectMissionType.Retire: {
            // 272-318
            const parentQueue = builtObject.parentHabitat !== null ? constructionQueueOf(builtObject.parentHabitat.constructionQueue) : null;
            if (builtObject.parentHabitat !== null && parentQueue !== null) {
                for (const constructionYard of parentQueue.constructionYards ?? []) {
                    if (constructionYard.shipUnderConstruction === builtObject) {
                        constructionYard.shipUnderConstruction = null;
                    }
                }
                const waitQueue = parentQueue.constructionWaitQueue;
                if (waitQueue !== null && waitQueue.includes(builtObject)) {
                    waitQueue.splice(waitQueue.indexOf(builtObject), 1);
                }
            }
            const queue = constructionQueueOf(builtObject.constructionQueue);
            if (queue !== null) {
                for (const constructionYard2 of queue.constructionYards ?? []) {
                    if (constructionYard2.shipUnderConstruction !== null) {
                        const underConstruction = constructionYard2.shipUnderConstruction;
                        sendCharactersHome(galaxy, underConstruction);
                        checkTriggerEvent(galaxy, underConstruction.gameEventId, empire, EventTriggerType.Destroy, null);
                        builtObjectCompleteTeardown(galaxy, underConstruction, true);
                        constructionYard2.shipUnderConstruction = null;
                    }
                }
                const builtObjectList: BuiltObject[] = [];
                builtObjectList.push(...(queue.constructionWaitQueue ?? []));
                for (const item of builtObjectList) {
                    sendCharactersHome(galaxy, item);
                    checkTriggerEvent(galaxy, item.gameEventId, empire, EventTriggerType.Destroy, null);
                    builtObjectCompleteTeardown(galaxy, item, true);
                }
                if (queue.constructionWaitQueue !== null) queue.constructionWaitQueue.length = 0;
            }
            retireLooting(ctx, builtObject);
            sendCharactersHome(galaxy, builtObject);
            checkTriggerEvent(galaxy, builtObject.gameEventId, empire, EventTriggerType.Destroy, null);
            builtObjectCompleteTeardown(galaxy, builtObject);
            break;
        }
        case BuiltObjectMissionType.Retrofit: {
            // 319-347
            if (action.design === null || builtObject.builtAt !== null) break;
            let num = 0.0;
            const componentList = componentListDiff(resolveComponentList(builtObject.components), action.design.components);
            const prices = galaxyComponentCurrentPrices(galaxy);
            for (const item2 of componentList) {
                num += prices[item2.componentId];
            }
            num *= 5.0;
            let flag2 = true;
            if (builtObject.owner === null) {
                if (num > getPrivateFunds(builtObject.empire!)) flag2 = false;
            } else if (num > builtObject.owner.stateMoney) {
                flag2 = false;
            }
            if (flag2 && isBuiltObject(action.target)) {
                assignRetrofitMission(galaxy, builtObject.empire!, builtObject, action.design, action.target, true);
            }
            break;
        }
        case BuiltObjectMissionType.Build:
            // 348-390
            if (action.design !== null) {
                buildAutomationPrompts(ctx, action.design);
                let flag = true;
                const subRole = action.design.subRole;
                if (
                    subRole === BuiltObjectSubRole.GasMiningStation ||
                    subRole === BuiltObjectSubRole.MiningStation ||
                    subRole === BuiltObjectSubRole.SmallFreighter ||
                    subRole === BuiltObjectSubRole.MediumFreighter ||
                    subRole === BuiltObjectSubRole.LargeFreighter ||
                    subRole === BuiltObjectSubRole.PassengerShip ||
                    subRole === BuiltObjectSubRole.MiningShip ||
                    subRole === BuiltObjectSubRole.GasMiningShip
                ) {
                    flag = false;
                }
                let isAutoControlled = newBuiltObjectShouldBeAutomated(builtObject.empire!, subRole);
                if (!flag) isAutoControlled = true;
                // 379-381: builtObject.Empire.PurchaseNewBuiltObject(design, builtObject, flag, isAutoControlled) (Empire.6.cs 2098);
                // a null result has an empty body in the C# — no message box (the action menu already disables
                // unaffordable designs, Main.Part8.cs 1843).
                if (purchaseNewBuiltObject(galaxy, builtObject.empire!, action.design, builtObject, flag, isAutoControlled) === null) {
                    return ctx.fail('PurchaseNewBuiltObject returned null (Main.Part7.cs:379: no message)');
                }
            } else if (builtObject.damagedComponentCount > 0 && builtObject.empire === empire) {
                const ship = fastFindBestConstructionShip(galaxy, builtObject.xpos, builtObject.ypos, builtObject.empire);
                if (ship !== null) {
                    assignMission(galaxy, ship, BuiltObjectMissionType.BuildRepair, null, builtObject, BuiltObjectMissionPriority.Normal);
                }
            }
            break;
    }
    return ctx.result;
}

/** Main.Part7.cs 395-817: the selected object is a ship. */
function executeForShip(ctx: Ctx, builtObject: BuiltObject, action: ShipAction): ShipActionResult {
    const { galaxy, empire } = ctx;
    // 397-596
    if (action.actionType !== ShipActionType.Undefined) {
        switch (action.actionType) {
            case ShipActionType.GiveBuiltObject:
                if (giveBuiltObject(ctx, builtObject, action)) return ctx.result;
                break;
            case ShipActionType.AutomateShip:
                automateShip(ctx, builtObject);
                return ctx.result;
            case ShipActionType.JoinShipGroup:
                if (isShipGroup(action.target)) {
                    fleetFormationPrompt(ctx);
                    const shipGroup2 = action.target;
                    shipGroupAddShipToFleet(galaxy, shipGroup2, builtObject);
                } else if (action.target === null || action.target === undefined) {
                    fleetFormationPrompt(ctx);
                    const shipGroup3 = new ShipGroup(galaxy);
                    shipGroup3.empire = builtObject.empire;
                    shipGroup3.gatherPoint = null;
                    shipGroup3.name = fleetName(builtObject.empire!);
                    empireShipGroups(builtObject.empire!).push(shipGroup3);
                    shipGroupAddShipToFleet(galaxy, shipGroup3, builtObject);
                    shipGroupUpdate(galaxy, shipGroup3);
                    sortShipGroups(builtObject.empire!);
                    ctx.result.select = shipGroup3; // method_208(shipGroup3)
                }
                return ctx.result;
            case ShipActionType.LeaveShipGroup:
                if (builtObject.shipGroup !== null) {
                    fleetFormationPrompt(ctx);
                    leaveShipGroup(galaxy, builtObject);
                }
                return ctx.result;
            case ShipActionType.SetAsLeadShipInGroup:
                if (builtObject.shipGroup !== null) {
                    fleetFormationPrompt(ctx);
                    (builtObject.shipGroup as ShipGroup).leadShip = builtObject;
                }
                return ctx.result;
            case ShipActionType.AssignShipGroupHomeColony:
                if (isHabitat(action.target)) {
                    fleetFormationPrompt(ctx);
                    const habitat3 = action.target;
                    if (habitat3.empire === builtObject.empire && builtObject.shipGroup !== null) {
                        (builtObject.shipGroup as ShipGroup).gatherPoint = habitat3;
                    }
                }
                return ctx.result;
            case ShipActionType.ClearQueuedMissions:
                builtObject.subsequentMissions.length = 0;
                return ctx.result;
            case ShipActionType.InvestigateRuins:
                if (isHabitat(action.target)) {
                    const habitat2 = action.target;
                    if (checkRuinsHaveBenefit(galaxy, habitat2.ruin, empire)) {
                        // ArhCaEfBkk(): plays the discovery sound.
                        investigateRuins(galaxy, empire, habitat2);
                    }
                }
                return ctx.result;
            case ShipActionType.InvestigateBuiltObject:
                if (isBuiltObject(action.target)) {
                    const builtObject4 = action.target;
                    if (builtObject4.empire === null) {
                        // musicPlayer fade / discovery.mp3
                        builtObject4.playerEmpireEncounterAction = BuiltObjectEncounterAction.Prompt;
                        investigateAbandonedBuiltObject(galaxy, empire, builtObject4);
                    }
                }
                return ctx.result;
            case ShipActionType.FighterBuildFighter:
            case ShipActionType.FighterBuildBomber:
            case ShipActionType.FighterLaunchFighters:
            case ShipActionType.FighterLaunchBombers:
            case ShipActionType.FighterRetrieveFighters:
            case ShipActionType.FighterRetrieveBombers:
                fighterCommand(ctx, builtObject, action.actionType);
                return ctx.result;
            case ShipActionType.UnautomateShip:
                builtObject.isAutoControlled = false;
                return ctx.result;
            case ShipActionType.FighterUpgradeAll:
                fighterUpgradeAll(ctx, builtObject);
                return ctx.result;
            case ShipActionType.TransferCharacter:
                transferCharacter(ctx, builtObject, action);
                break;
        }
    }
    // 597-600
    if (builtObject.builtAt !== null) {
        return ctx.result;
    }
    // 602-648: Build / BuildRepair
    if (action.missionType === BuiltObjectMissionType.Build || action.missionType === BuiltObjectMissionType.BuildRepair) {
        if (action.design !== null && action.target !== null && isBuiltObject(action.target)) {
            const builtObject6 = action.target;
            if (action.isSubsequentAction) {
                queueMissionFull(galaxy, builtObject, BuiltObjectMissionType.Build, builtObject6, builtObject6, BuiltObjectMissionPriority.Normal, {});
                return ctx.result;
            }
            clearPreviousMissionRequirements(galaxy, builtObject, true);
            assignMission(galaxy, builtObject, BuiltObjectMissionType.Build, builtObject6, builtObject6, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
            return ctx.result;
        }
        if (action.design === null && action.target !== null && isBuiltObject(action.target)) {
            const builtObject7 = action.target;
            if (builtObject7 === builtObject && builtObject7.role !== BuiltObjectRole.Base && (builtObject7.topSpeed <= 0 || builtObject7.warpSpeed <= 0)) {
                const builtObject8 = fastFindBestConstructionShip(galaxy, builtObject7.xpos, builtObject7.ypos, builtObject7.empire);
                if (builtObject8 !== null) {
                    const m8 = builtObjectMission(builtObject8.mission);
                    if (m8 !== null && m8.type !== BuiltObjectMissionType.Undefined) {
                        queueMissionFull(galaxy, builtObject8, BuiltObjectMissionType.BuildRepair, null, builtObject7, BuiltObjectMissionPriority.Normal, { x: builtObject7.xpos, y: builtObject7.ypos });
                        return ctx.result;
                    }
                    clearPreviousMissionRequirements(galaxy, builtObject8, true);
                    assignMission(galaxy, builtObject8, BuiltObjectMissionType.BuildRepair, null, builtObject7, BuiltObjectMissionPriority.Normal, { x: builtObject7.xpos, y: builtObject7.ypos, manuallyAssigned: true });
                    return ctx.result;
                }
            }
            if (builtObject7.role === BuiltObjectRole.Base) {
                clearPreviousMissionRequirements(galaxy, builtObject, true);
                assignMission(galaxy, builtObject, BuiltObjectMissionType.BuildRepair, null, builtObject7, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
            } else if (action.isSubsequentAction) {
                queueMissionFull(galaxy, builtObject, BuiltObjectMissionType.BuildRepair, null, builtObject7, BuiltObjectMissionPriority.Normal, { x: builtObject7.xpos, y: builtObject7.ypos });
            } else {
                clearPreviousMissionRequirements(galaxy, builtObject, true);
                assignMission(galaxy, builtObject, BuiltObjectMissionType.BuildRepair, null, builtObject7, BuiltObjectMissionPriority.Normal, { x: builtObject7.xpos, y: builtObject7.ypos, manuallyAssigned: true });
            }
            return ctx.result;
        }
    }
    // 649-664: Patrol a star / gas cloud / system.
    if (action.missionType === BuiltObjectMissionType.Patrol && isHabitat(action.target) && (action.target.category === HabitatCategoryType.GasCloud || action.target.category === HabitatCategoryType.Star)) {
        const system = systemForStar(galaxy, action.target);
        clearPreviousMissionRequirements(galaxy, builtObject, true);
        assignShipSystemPatrol(galaxy, builtObject.empire!, builtObject, system!, true);
        builtObject.isAutoControlled = false;
        return ctx.result;
    }
    if (action.missionType === BuiltObjectMissionType.Patrol && isSystemInfo(action.target)) {
        const system2 = action.target;
        clearPreviousMissionRequirements(galaxy, builtObject, true);
        assignShipSystemPatrol(galaxy, builtObject.empire!, builtObject, system2, true);
        builtObject.isAutoControlled = false;
        return ctx.result;
    }
    // 665-676
    if (action.missionType === BuiltObjectMissionType.Retrofit) {
        if (action.design !== null && action.target !== null && isBuiltObject(action.target)) {
            assignRetrofitMission(galaxy, builtObject.empire!, builtObject, action.design, action.target, true);
        } else if (action.design !== null && action.target !== null && isHabitat(action.target)) {
            assignRetrofitMission(galaxy, builtObject.empire!, builtObject, action.design, action.target, true);
        }
        return ctx.result;
    }
    // 677-695
    if (action.missionType === BuiltObjectMissionType.Retire && action.target !== null && isBuiltObject(action.target)) {
        const builtObject9 = action.target;
        if (builtObject9 === builtObject && builtObject.builtAt === null) {
            retireLooting(ctx, builtObject);
            sendCharactersHome(galaxy, builtObject);
            builtObjectCompleteTeardown(galaxy, builtObject);
            return ctx.result;
        }
    }
    // 696-719
    if (action.missionType === BuiltObjectMissionType.LoadTroops) {
        if (action.target !== null && isHabitat(action.target)) {
            if (action.isSubsequentAction) {
                assignLoadTroopsMission(galaxy, builtObject.empire!, builtObject, action.target, true, false, true);
                builtObject.isAutoControlled = false;
            } else {
                clearPreviousMissionRequirements(galaxy, builtObject, true);
                assignLoadTroopsMission(galaxy, builtObject.empire!, builtObject, action.target, false, false, true);
                builtObject.isAutoControlled = false;
            }
        } else {
            assignLoadTroopsMission(galaxy, builtObject.empire!, builtObject, null, false, false, true);
            builtObject.isAutoControlled = false;
        }
        return ctx.result;
    }
    // 720-738
    if (action.missionType === BuiltObjectMissionType.Escape) {
        const attackers = builtObject.attackers ?? [];
        if (attackers.length > 0) {
            action.target = attackers[0];
            clearPreviousMissionRequirements(galaxy, builtObject, true);
        } else {
            const threats = evaluateThreats(galaxy, builtObject).threats;
            if (threats === null || threats.length <= 0) {
                return ctx.result;
            }
            action.target = threats[0];
            clearPreviousMissionRequirements(galaxy, builtObject, true);
        }
    }
    // 739-746
    if (action.missionType === BuiltObjectMissionType.Hold) {
        exitHyperjump(galaxy, builtObject);
    }
    if (!action.isSubsequentAction) {
        clearPreviousMissionRequirements(galaxy, builtObject, true);
    }
    // 747-771
    if (action.missionType === BuiltObjectMissionType.UnloadTroops) {
        const troopList = new TroopList();
        if (builtObject.troops !== null && builtObject.troops.count > 0) {
            for (const t of builtObject.troops.items) troopList.add(t);
        }
        if (positionIsZero(action)) {
            if (action.isSubsequentAction) {
                queueMissionFull(galaxy, builtObject, action.missionType, missionTarget(action.target), null, BuiltObjectMissionPriority.Normal, { troops: troopList });
            } else {
                assignMission(galaxy, builtObject, action.missionType, missionTarget(action.target), null, BuiltObjectMissionPriority.Normal, { troops: troopList, manuallyAssigned: true });
            }
        } else if (action.isSubsequentAction) {
            queueMissionFull(galaxy, builtObject, action.missionType, missionTarget(action.target), null, BuiltObjectMissionPriority.Normal, { troops: troopList, x: action.position.x, y: action.position.y });
        } else {
            assignMission(galaxy, builtObject, action.missionType, missionTarget(action.target), null, BuiltObjectMissionPriority.Normal, {
                troops: troopList,
                x: action.position.x,
                y: action.position.y,
                allowReprocessing: true,
                manuallyAssigned: true,
            });
        }
        return ctx.result;
    }
    // 772-819
    const target = missionTarget(action.target);
    if (action.design !== null) {
        if (positionIsZero(action)) {
            if (action.isSubsequentAction) {
                queueMissionFull(galaxy, builtObject, action.missionType, target, null, BuiltObjectMissionPriority.Normal, { design: action.design });
            } else {
                assignMission(galaxy, builtObject, action.missionType, target, null, BuiltObjectMissionPriority.Normal, { design: action.design, manuallyAssigned: true });
            }
        } else if (action.isSubsequentAction) {
            queueMissionFull(galaxy, builtObject, action.missionType, target, null, BuiltObjectMissionPriority.Normal, { design: action.design, x: action.position.x, y: action.position.y });
        } else {
            assignMission(galaxy, builtObject, action.missionType, target, null, BuiltObjectMissionPriority.Normal, { design: action.design, x: action.position.x, y: action.position.y, manuallyAssigned: true });
        }
    } else {
        if (builtObject.subRole === BuiltObjectSubRole.ColonyShip && empire.controlColonization === AutomationLevel.FullyAutomated && ctx.askTurnOff('Colonization')) {
            empire.controlColonization = AutomationLevel.Undefined /* C# Manual (0) */;
        }
        if (positionIsZero(action)) {
            if (action.isSubsequentAction) {
                queueMissionFull(galaxy, builtObject, action.missionType, target, null, BuiltObjectMissionPriority.Normal, {});
            } else {
                assignMission(galaxy, builtObject, action.missionType, target, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
            }
        } else if (action.isSubsequentAction) {
            queueMissionFull(galaxy, builtObject, action.missionType, target, null, BuiltObjectMissionPriority.Normal, { x: action.position.x, y: action.position.y });
        } else {
            assignMission(galaxy, builtObject, action.missionType, target, null, BuiltObjectMissionPriority.Normal, { x: action.position.x, y: action.position.y, manuallyAssigned: true });
        }
    }
    // 804-816
    if (action.missionType === BuiltObjectMissionType.Hold) {
        if ((action.target === null || action.target === undefined) && (action.target2 === null || action.target2 === undefined)) {
            builtObject.preferredSpeed = 0;
            builtObject.targetSpeed = 0;
        } else if (action.target === builtObject && (action.target2 === null || action.target2 === undefined)) {
            builtObject.preferredSpeed = 0;
            builtObject.targetSpeed = 0;
        }
    }
    builtObject.isAutoControlled = false;
    return ctx.result;
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat (Main.Part7.cs 822-1236)
// ---------------------------------------------------------------------------------------------------------------

function executeForHabitat(ctx: Ctx, habitat4: Habitat, action: ShipAction, fromActionMenu: boolean): ShipActionResult {
    const { galaxy, empire } = ctx;
    if (action.actionType !== ShipActionType.Undefined) {
        switch (action.actionType) {
            case ShipActionType.ColonyTaxUp1:
            case ShipActionType.ColonyTaxUp5:
            case ShipActionType.ColonyTaxDown1:
            case ShipActionType.ColonyTaxDown5: {
                // 830-862
                if (empire.controlColonyTaxRates && ctx.askTurnOff('Colony Tax Rates')) {
                    empire.controlColonyTaxRates = false;
                }
                if (habitat4.empire !== null && habitat4.empire !== galaxy.independentEmpire && habitat4.empire === empire) {
                    let num6 = 0.0;
                    switch (action.actionType) {
                        case ShipActionType.ColonyTaxUp1:
                            num6 = 0.01;
                            break;
                        case ShipActionType.ColonyTaxUp5:
                            num6 = 0.05;
                            break;
                        case ShipActionType.ColonyTaxDown1:
                            num6 = -0.01;
                            break;
                        case ShipActionType.ColonyTaxDown5:
                            num6 = -0.05;
                            break;
                    }
                    let num7 = habitat4.taxRate;
                    num7 += num6;
                    num7 = Math.max(0.0, Math.min(num7, 0.5));
                    habitat4.taxRate = Math.fround(num7);
                    // pnlDetailInfo.Invalidate()
                }
                return ctx.result;
            }
            case ShipActionType.BuildColonize: {
                // 863-882
                const colonizableHabitatTypes = empire.colonizableHabitatTypesForEmpire();
                const latestColonyShip = findNewestCanBuild(empire.designs, BuiltObjectSubRole.ColonyShip, empire);
                let builtObject10: BuiltObject | null = null;
                for (const builtObject13 of empire.builtObjects) {
                    const m = builtObjectMission(builtObject13.mission);
                    if (builtObject13.subRole === BuiltObjectSubRole.ColonyShip && m !== null && m.type === BuiltObjectMissionType.Colonize && m.targetHabitat === habitat4) {
                        builtObject10 = builtObject13;
                        break;
                    }
                }
                if (builtObject10 === null && canEmpireColonizeHabitat(galaxy, empire, empire, habitat4, colonizableHabitatTypes, latestColonyShip)) {
                    return buildColonyShipFor(ctx, habitat4); // method_539(habitat4)
                }
                break;
            }
            case ShipActionType.RecruitTroops:
                recruitTroops(ctx, habitat4, action);
                return ctx.result;
            case ShipActionType.GeneratePirateMissionDefend: {
                // 952-970
                const attackPrice3 = calculatePirateDefendPrice(galaxy, empire, habitat4);
                const expiryDate3 = galaxyStarDate(galaxy) + Math.trunc(1.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
                const empireActivity3 = new EmpireActivity(habitat4.empire, empire, expiryDate3, EmpireActivityType.Defend, habitat4, attackPrice3);
                togglePirateMission(ctx, empireActivity3);
                break;
            }
            case ShipActionType.GeneratePirateMissionSmuggling:
                // 971-1019
                if (typeof action.target2 === 'number') {
                    const b = action.target2 & 0xff;
                    let attackPrice4 = 1.0;
                    if (b !== 255) {
                        attackPrice4 = calculatePirateSmugglePricePerUnit(galaxy, empire, habitat4, b);
                    }
                    const expiryDate4 = galaxyStarDate(galaxy) + Math.trunc(3.0 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0);
                    const empireActivity4 = new EmpireActivity(habitat4.empire, empire, expiryDate4, EmpireActivityType.Smuggle, habitat4, attackPrice4);
                    empireActivity4.resourceId = b;
                    if (b !== 255) {
                        // Empire.CreateOrder(habitat4, new Resource(b), 10000, isState: true, OrderType.Standard, expiryDate4)
                        empireActivity4.relatedOrder = createOrderWithExpiry(galaxy, habitat4, b, 10000, true, OrderType.Standard, expiryDate4);
                    }
                    if (!empire.pirateMissions.containsEquivalent(empireActivity4)) {
                        empire.pirateMissions.add(empireActivity4);
                        if (!galaxy.pirateMissions.containsEquivalent(empireActivity4)) {
                            galaxy.pirateMissions.add(empireActivity4);
                        }
                        break;
                    }
                    removePirateSmugglingMissionFromAllEmpires(galaxy, empireActivity4);
                    empire.pirateMissions.removeEquivalent(empireActivity4);
                    const firstByTargetAndType = galaxy.pirateMissions.getFirstByTargetAndType(habitat4, EmpireActivityType.Smuggle);
                    if (firstByTargetAndType !== null) {
                        galaxy.pirateMissions.remove(firstByTargetAndType);
                        if (firstByTargetAndType.relatedOrder !== null) {
                            firstByTargetAndType.relatedOrder.expiryDate = galaxyStarDate(galaxy);
                        }
                    }
                } else if (action.target2 === null || action.target2 === undefined) {
                    ctx.result.showSmugglingResourceSelection = true; // method_345()
                }
                break;
            case ShipActionType.DeployVirus: {
                // 1020-1043
                if (!isHabitat(action.target)) break;
                const habitat5 = action.target;
                if (habitat5.population === null || habitat5.population.totalAmount <= 0 || !isPlague(action.target2)) break;
                const plague = action.target2;
                infectWithPlague(galaxy, habitat5, plague as Parameters<typeof infectWithPlague>[2], null);
                if (plague.specialFunctionCode === 1) {
                    const num8 = galaxy.rnd.next(15, 20);
                    for (let k = 0; k < num8; k++) {
                        const p = galaxy.selectRelativeHabitatSurfacePoint(habitat5);
                        galaxy.generateCreatureAtHabitat(CreatureType.Kaltor, habitat5, false, Math.trunc(p.x), Math.trunc(p.y));
                    }
                    // Main.Part7.cs 1042: _Game.PlayerEmpire.LastXaraktorVirusDeploy = CurrentDateTime (read by
                    // CanDeployXaraktorVirus, Empire.10.cs 4532).
                    ctx.empire.lastXaraktorVirusDeploy = galaxyNow(galaxy);
                }
                break;
            }
            case ShipActionType.TransferCharacter:
                transferCharacter(ctx, habitat4, action);
                break;
            case ShipActionType.BuildPlanetaryFacility:
                buildPlanetaryFacility(ctx, habitat4, action);
                return ctx.result;
        }
    }
    // 1136-1232
    const missionType = action.missionType;
    if (missionType === BuiltObjectMissionType.Build && action.design !== null) {
        buildAutomationPrompts(ctx, action.design);
        let flag5 = true;
        if (action.design.subRole === BuiltObjectSubRole.GasMiningStation || action.design.subRole === BuiltObjectSubRole.MiningStation) {
            flag5 = false;
        }
        let int_ = 0;
        let int_2 = 0;
        if (fromActionMenu) {
            // actionMenu.Left/Top → method_151 (screen to galaxy)
            int_ = ctx.options.actionMenuPoint?.x ?? 0;
            int_2 = ctx.options.actionMenuPoint?.y ?? 0;
        } else if (!positionIsZero(action)) {
            int_ = action.position.x;
            int_2 = action.position.y;
        }
        if (habitat4.empire !== null && habitat4.empire === empire) {
            let isAutoControlled2 = newBuiltObjectShouldBeAutomated(habitat4.empire, action.design.subRole);
            if (!flag5) isAutoControlled2 = true;
            // 1180-1182: habitat4.Empire.PurchaseNewBuiltObject(design, habitat4, int_, int_2, flag5, isAutoControlled2)
            // (Empire.6.cs 1996); a null result has an empty body in the C# — no message box.
            if (purchaseNewBuiltObjectAt(galaxy, habitat4.empire, action.design, habitat4, int_, int_2, flag5, isAutoControlled2) === null) {
                return ctx.fail('PurchaseNewBuiltObject returned null (Main.Part7.cs:1180: no message)');
            }
        } else if (action.design.subRole !== BuiltObjectSubRole.MiningStation && action.design.subRole !== BuiltObjectSubRole.GasMiningStation) {
            if (action.design.role === BuiltObjectRole.Base) {
                let num12 = 0.0;
                let num13 = 0.0;
                if (habitat4.category === HabitatCategoryType.Star) {
                    let p: { x: number; y: number };
                    if (habitat4.type === HabitatType.BlackHole) {
                        p = galaxy.selectRelativeParkingPoint(habitat4.diameter * 0.7);
                    } else {
                        p = galaxy.selectRelativeParkingPoint(2000.0 + galaxy.rnd.nextDouble() * 3000.0);
                    }
                    num12 = p.x;
                    num13 = p.y;
                } else {
                    const p = galaxy.selectRelativeHabitatSurfacePoint(habitat4);
                    num12 = p.x;
                    num13 = p.y;
                }
                const builtObject11 = fastFindBestConstructionShip(galaxy, habitat4.xpos, habitat4.ypos, empire);
                if (builtObject11 !== null) {
                    const m11 = builtObjectMission(builtObject11.mission);
                    if (m11 !== null && m11.type !== BuiltObjectMissionType.Undefined) {
                        queueMissionFull(galaxy, builtObject11, BuiltObjectMissionType.Build, habitat4, null, BuiltObjectMissionPriority.Normal, { design: action.design, x: num12, y: num13 });
                    } else {
                        assignMission(galaxy, builtObject11, BuiltObjectMissionType.Build, habitat4, null, BuiltObjectMissionPriority.Normal, { design: action.design, x: num12, y: num13, manuallyAssigned: true });
                    }
                }
            }
        } else {
            buildMiningStationAt(ctx, null, habitat4); // method_540(null, habitat4)
        }
    }
    return ctx.result;
}

// ---------------------------------------------------------------------------------------------------------------
// ShipGroup (Main.Part7.cs 1237-1556)
// ---------------------------------------------------------------------------------------------------------------

function executeForShipGroup(ctx: Ctx, shipGroup4: ShipGroup, action: ShipAction): ShipActionResult {
    const { galaxy } = ctx;
    if (action.actionType !== ShipActionType.Undefined) {
        switch (action.actionType) {
            case ShipActionType.AssignShipGroupHomeColony:
                if (isHabitat(action.target)) {
                    const habitat6 = action.target;
                    if (habitat6.empire === shipGroup4.empire) {
                        shipGroup4.gatherPoint = habitat6;
                    }
                }
                return ctx.result;
            case ShipActionType.ClearQueuedMissions:
                shipGroup4.subsequentMissions.length = 0;
                for (const ship of shipGroup4.ships) {
                    ship.subsequentMissions.length = 0;
                }
                return ctx.result;
            case ShipActionType.AutomateShip:
                setShipGroupAutomated(shipGroup4, true); // method_348(shipGroup4, true)
                return ctx.result;
            case ShipActionType.DisbandShipGroup: {
                if (action.target === null || !isShipGroup(action.target)) break;
                const shipGroup5 = action.target;
                if (shipGroup5.empire !== null) {
                    if (shipGroup4 === shipGroup5) {
                        ctx.result.select = null; // method_208(null)
                    }
                    disbandShipGroup(galaxy, shipGroup5.empire, shipGroup5);
                }
                break;
            }
            case ShipActionType.UnautomateShip:
                setShipGroupAutomated(shipGroup4, false);
                return ctx.result;
            case ShipActionType.SetFleetPosture:
                if (shipGroup4.posture === FleetPosture.Attack) {
                    shipGroup4.posture = FleetPosture.Defend;
                } else if (shipGroup4.posture === FleetPosture.Defend) {
                    shipGroup4.posture = FleetPosture.Attack;
                }
                return ctx.result;
            case ShipActionType.SetFleetRange:
                if (shipGroup4.postureRangeSquared <= 2250000.0) {
                    shipGroup4.postureRangeSquared = 2304000000.0;
                } else if (shipGroup4.postureRangeSquared <= 2304000000.0) {
                    shipGroup4.postureRangeSquared = 250000000000.0;
                } else if (shipGroup4.postureRangeSquared <= 250000000000.0) {
                    shipGroup4.postureRangeSquared = 1000000000000.0;
                } else if (shipGroup4.postureRangeSquared <= 1000000000000.0) {
                    shipGroup4.postureRangeSquared = 3.4028234663852886e38;
                } else {
                    shipGroup4.postureRangeSquared = 2250000.0;
                }
                return ctx.result;
            case ShipActionType.SetFleetAttackPoint:
                ctx.result.mouseHoverMode = 'SetFleetAttackPoint';
                return ctx.result;
            case ShipActionType.SetFleetHomeBase:
                ctx.result.mouseHoverMode = 'SetFleetHomeBase';
                return ctx.result;
            case ShipActionType.TransferCharacter:
                if (action.target2 !== null && action.target2 instanceof Character) {
                    const character4 = action.target2;
                    if (action.target !== null && isBuiltObject(action.target)) {
                        const destination = action.target;
                        character4.transferToNewLocation(destination, galaxy);
                    }
                }
                return ctx.result;
        }
    }
    // 1322-1337
    if (action.missionType === BuiltObjectMissionType.Escape) {
        const leadShip = shipGroup4.leadShip!;
        const attackers = leadShip.attackers ?? [];
        if (attackers.length > 0) {
            action.target = attackers[0];
        } else {
            const threats = evaluateThreats(galaxy, leadShip).threats;
            if (threats === null || threats.length <= 0) {
                return ctx.result;
            }
            action.target = threats[0];
        }
    }
    // 1338-1391
    if (action.missionType === BuiltObjectMissionType.Blockade && action.target !== null && action.target !== undefined) {
        if (isHabitat(action.target)) {
            const colony = action.target;
            const blockade = blockadeFor(galaxy, colony);
            if (blockade !== null) {
                if (blockade.initiator !== shipGroup4.empire) {
                    return ctx.result;
                }
            } else {
                if (action.isSubsequentAction) {
                    shipGroupQueueMission(galaxy, shipGroup4, BuiltObjectMissionType.Blockade, colony, null, BuiltObjectMissionPriority.High);
                } else {
                    implementBlockade(galaxy, shipGroup4.empire!, colony, false, false);
                }
                setShipGroupAutomated(shipGroup4, false);
            }
        } else if (isBuiltObject(action.target)) {
            const builtObject12 = action.target;
            const blockade2 = blockadeFor(galaxy, builtObject12);
            if (blockade2 !== null) {
                if (blockade2.initiator !== shipGroup4.empire) {
                    return ctx.result;
                }
            } else {
                if (action.isSubsequentAction) {
                    shipGroupQueueMission(galaxy, shipGroup4, BuiltObjectMissionType.Blockade, builtObject12, null, BuiltObjectMissionPriority.High);
                } else {
                    implementBlockade(galaxy, shipGroup4.empire!, builtObject12, false, false);
                }
                setShipGroupAutomated(shipGroup4, false);
            }
        }
    }
    // 1393-1402
    setShipGroupAutomated(shipGroup4, false);
    let missionType2 = action.missionType;
    if (missionType2 === BuiltObjectMissionType.WaitAndAttack || missionType2 === BuiltObjectMissionType.WaitAndBombard) {
        const r = checkAssignFleetWaitAndAttackMission(galaxy, shipGroup4.empire!, shipGroup4, missionType2, missionTarget(action.target), BuiltObjectMissionPriority.High);
        missionType2 = r.missionType;
        if (r.assigned) {
            return ctx.result;
        }
        action.setMissionType(missionType2);
    }
    // 1403-1422
    if (action.missionType === BuiltObjectMissionType.LoadTroops) {
        if (action.target !== null && isHabitat(action.target)) {
            assignFleetLoadTroops(galaxy, shipGroup4.empire!, shipGroup4, action.target, true);
        } else {
            assignFleetLoadTroops(galaxy, shipGroup4.empire!, shipGroup4, null, true);
        }
        return ctx.result;
    }
    if (action.missionType === BuiltObjectMissionType.UnloadTroops) {
        if (action.target !== null && isHabitat(action.target)) {
            assignFleetUnloadTroops(galaxy, shipGroup4.empire!, shipGroup4, action.target, true);
        }
        return ctx.result;
    }
    // 1423-1434
    if (action.missionType === BuiltObjectMissionType.Patrol && isHabitat(action.target) && (action.target.category === HabitatCategoryType.GasCloud || action.target.category === HabitatCategoryType.Star)) {
        const system3 = systemForStar(galaxy, action.target);
        assignFleetSystemPatrol(galaxy, shipGroup4.empire!, shipGroup4, system3);
        return ctx.result;
    }
    if (action.missionType === BuiltObjectMissionType.Patrol && isSystemInfo(action.target)) {
        const system4 = action.target;
        assignFleetSystemPatrol(galaxy, shipGroup4.empire!, shipGroup4, system4);
        return ctx.result;
    }
    // 1435-1446
    if (action.missionType === BuiltObjectMissionType.Retrofit) {
        let shipYard: StellarObject | null = null;
        if (action.target !== null && isBuiltObject(action.target)) {
            shipYard = action.target;
        }
        if (assignFleetRetrofit(galaxy, shipGroup4.empire!, shipGroup4, shipYard, false)) {
            return ctx.result;
        }
    }
    const target = missionTarget(action.target);
    // 1447-1554
    if (action.missionType === BuiltObjectMissionType.Repair) {
        if (action.isSubsequentAction) {
            shipGroupQueueMission(galaxy, shipGroup4, BuiltObjectMissionType.Repair, target, null, BuiltObjectMissionPriority.High);
        } else if (action.target !== null && isBuiltObject(action.target)) {
            assignFleetRepair(galaxy, shipGroup4.empire!, shipGroup4, action.target);
        } else {
            assignFleetRepair(galaxy, shipGroup4.empire!, shipGroup4, null);
        }
    } else if (action.missionType === BuiltObjectMissionType.Refuel) {
        if (action.isSubsequentAction) {
            shipGroupQueueMission(galaxy, shipGroup4, BuiltObjectMissionType.Refuel, target, null, BuiltObjectMissionPriority.High);
        } else {
            shipGroupAssignMission(galaxy, shipGroup4, BuiltObjectMissionType.Refuel, target, null, BuiltObjectMissionPriority.Unavailable, true);
        }
    } else if (action.missionType === BuiltObjectMissionType.Hold) {
        forceCompleteMission(galaxy, shipGroup4);
        for (let l = 0; l < shipGroup4.ships.length; l++) {
            shipGroup4.ships[l].targetSpeed = 0;
            shipGroup4.ships[l].preferredSpeed = 0;
            shipGroup4.ships[l].isAutoControlled = false;
        }
    } else if (action.design !== null) {
        if (positionIsZero(action)) {
            if (action.isSubsequentAction) {
                shipGroupQueueMission(galaxy, shipGroup4, action.missionType, target, null, BuiltObjectMissionPriority.Normal, { design: action.design });
            } else {
                shipGroupAssignMissionFull(galaxy, shipGroup4, action.missionType, target, null, null, action.design, COORD_UNSET_DOUBLE, COORD_UNSET_DOUBLE, -1, BuiltObjectMissionPriority.Normal, true);
            }
        } else if (action.isSubsequentAction) {
            shipGroupQueueMission(galaxy, shipGroup4, action.missionType, target, null, BuiltObjectMissionPriority.Normal, { design: action.design, x: action.position.x, y: action.position.y });
        } else {
            shipGroupAssignMissionFull(galaxy, shipGroup4, action.missionType, target, null, null, action.design, action.position.x, action.position.y, -1, BuiltObjectMissionPriority.Normal, true);
        }
    } else {
        let priority = BuiltObjectMissionPriority.Normal;
        const mt = action.missionType as BuiltObjectMissionType; // Refuel is handled above; the C# still tests it here.
        if (
            mt === BuiltObjectMissionType.Attack ||
            mt === BuiltObjectMissionType.WaitAndAttack ||
            mt === BuiltObjectMissionType.Bombard ||
            mt === BuiltObjectMissionType.WaitAndBombard ||
            mt === BuiltObjectMissionType.Refuel
        ) {
            priority = BuiltObjectMissionPriority.High;
        }
        if (positionIsZero(action)) {
            if (action.isSubsequentAction) {
                shipGroupQueueMission(galaxy, shipGroup4, missionType2, target, null, priority);
            } else {
                shipGroupAssignMission(galaxy, shipGroup4, missionType2, target, null, priority, true);
            }
        } else if (action.isSubsequentAction) {
            shipGroupQueueMission(galaxy, shipGroup4, action.missionType, target, null, priority, { x: action.position.x, y: action.position.y });
        } else {
            shipGroupAssignMission(galaxy, shipGroup4, action.missionType, target, null, priority, true, { x: action.position.x, y: action.position.y });
        }
    }
    return ctx.result;
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObjectList (Main.Part7.cs 1557-1844)
// ---------------------------------------------------------------------------------------------------------------

function executeForBuiltObjectList(ctx: Ctx, builtObjectList2: BuiltObject[], action: ShipAction): ShipActionResult {
    const { galaxy, empire } = ctx;
    if (action.actionType !== ShipActionType.Undefined) {
        switch (action.actionType) {
            case ShipActionType.UnautomateShip:
                for (const item3 of builtObjectList2) {
                    item3.isAutoControlled = false;
                }
                return ctx.result;
            case ShipActionType.CreateNewFleet: {
                // 1573-1605
                fleetFormationPrompt(ctx);
                let flag6 = false;
                for (let m = 0; m < builtObjectList2.length; m++) {
                    if (builtObjectList2[m].role === BuiltObjectRole.Military) {
                        flag6 = true;
                        break;
                    }
                }
                if (!flag6) {
                    return ctx.fail('no military ship selected');
                }
                const shipGroup6 = new ShipGroup(galaxy);
                shipGroup6.empire = empire;
                shipGroup6.gatherPoint = selectFleetBase(galaxy, empire, shipGroup6);
                for (let n = 0; n < builtObjectList2.length; n++) {
                    if (builtObjectList2[n].role === BuiltObjectRole.Military) {
                        shipGroupAddShipToFleet(galaxy, shipGroup6, builtObjectList2[n]);
                    }
                }
                if (shipGroup6.ships.length > 0) {
                    shipGroup6.name = fleetName(empire);
                    empireShipGroups(empire).push(shipGroup6);
                    sortShipGroups(empire);
                }
                shipGroupUpdate(galaxy, shipGroup6);
                ctx.result.select = shipGroup6; // method_208(shipGroup6)
                return ctx.result;
            }
            case ShipActionType.AutomateShip:
                for (const item4 of builtObjectList2) {
                    automateShip(ctx, item4);
                }
                return ctx.result;
            case ShipActionType.JoinShipGroup: {
                // 1624-1673
                if (isShipGroup(action.target)) {
                    fleetFormationPrompt(ctx);
                    const shipGroup7 = action.target;
                    for (const item5 of builtObjectList2) {
                        if (item5.role === BuiltObjectRole.Military) {
                            shipGroupAddShipToFleet(galaxy, shipGroup7, item5);
                        }
                    }
                    shipGroupUpdate(galaxy, shipGroup7);
                    return ctx.result;
                }
                if (action.target !== null && action.target !== undefined) {
                    return ctx.result;
                }
                fleetFormationPrompt(ctx);
                const shipGroup8 = new ShipGroup(galaxy);
                shipGroup8.empire = builtObjectList2[0].empire;
                for (const item6 of builtObjectList2) {
                    if (item6.role === BuiltObjectRole.Military) {
                        shipGroupAddShipToFleet(galaxy, shipGroup8, item6);
                    }
                }
                if (shipGroup8.ships.length > 0) {
                    const e0 = builtObjectList2[0].empire!;
                    shipGroup8.gatherPoint = selectFleetBase(galaxy, e0, shipGroup8);
                    shipGroup8.name = fleetName(e0);
                    empireShipGroups(e0).push(shipGroup8);
                    shipGroupUpdate(galaxy, shipGroup8);
                    sortShipGroups(e0);
                }
                ctx.result.select = shipGroup8;
                return ctx.result;
            }
            case ShipActionType.LeaveShipGroup:
                fleetFormationPrompt(ctx);
                for (const item7 of builtObjectList2) {
                    if (item7.shipGroup !== null) {
                        leaveShipGroup(galaxy, item7);
                    }
                }
                return ctx.result;
        }
    }
    // 1689-1712
    if (action.missionType === BuiltObjectMissionType.Patrol && isHabitat(action.target) && (action.target.category === HabitatCategoryType.GasCloud || action.target.category === HabitatCategoryType.Star)) {
        const systemInfo = systemForStar(galaxy, action.target)!;
        for (const item8 of builtObjectList2) {
            clearPreviousMissionRequirements(galaxy, item8, true);
            assignMission(galaxy, item8, action.missionType, systemInfo.systemStar, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
            item8.isAutoControlled = false;
        }
        return ctx.result;
    }
    if (action.missionType === BuiltObjectMissionType.Patrol && isSystemInfo(action.target)) {
        const systemInfo2 = action.target;
        for (const item9 of builtObjectList2) {
            clearPreviousMissionRequirements(galaxy, item9, true);
            assignMission(galaxy, item9, action.missionType, systemInfo2.systemStar, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
            item9.isAutoControlled = false;
        }
        return ctx.result;
    }
    // 1713-1737
    if (action.missionType === BuiltObjectMissionType.Retire && (action.target === null || action.target === undefined)) {
        for (const item10 of builtObjectList2) {
            if (item10.builtAt === null) {
                sendCharactersHome(galaxy, item10);
                builtObjectCompleteTeardown(galaxy, item10);
            }
        }
        // list_5.Remove(selection); int_22 = method_210(…); method_209(list_5[int_22] or null); method_212(): the UI's
        // selection-history list picks the next selection.
        ctx.result.selectNextFromHistory = true;
        return ctx.result;
    }
    // 1738-1759
    if (action.missionType === BuiltObjectMissionType.Escape) {
        for (const item11 of builtObjectList2) {
            const attackers = item11.attackers ?? [];
            if (attackers.length > 0) {
                action.target = attackers[0];
                clearPreviousMissionRequirements(galaxy, item11, true);
            } else {
                const threats = evaluateThreats(galaxy, item11).threats;
                if (threats !== null && threats.length > 0) {
                    action.target = threats[0];
                    clearPreviousMissionRequirements(galaxy, item11, true);
                }
            }
        }
        return ctx.result;
    }
    // 1760-1770
    if (action.missionType === BuiltObjectMissionType.Attack && action.target !== null && action.target !== undefined) {
        for (const item12 of builtObjectList2) {
            if (item12.firepowerRaw > 0 || item12.fighterCapacity > 0 || (item12.troops !== null && item12.troops.totalAttackStrength > 0)) {
                assignMission(galaxy, item12, BuiltObjectMissionType.Attack, missionTarget(action.target), null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
            }
        }
        return ctx.result;
    }
    // 1771-1799
    if (action.missionType === BuiltObjectMissionType.Refuel) {
        for (const item13 of builtObjectList2) {
            if (item13 === null) continue;
            if (action.target !== null && isStellarObject(action.target)) {
                const stellarObject = action.target;
                clearPreviousMissionRequirements(galaxy, item13, true);
                assignMission(galaxy, item13, BuiltObjectMissionType.Refuel, stellarObject, null, BuiltObjectMissionPriority.Unavailable);
            } else {
                const stellarObject2 = empireFindNearestRefuellingPoint(galaxy, empire, item13.xpos, item13.ypos, item13.fuelType, 1);
                if (stellarObject2 !== null) {
                    clearPreviousMissionRequirements(galaxy, item13, true);
                    assignMission(galaxy, item13, BuiltObjectMissionType.Refuel, stellarObject2, null, BuiltObjectMissionPriority.Unavailable);
                }
            }
        }
        return ctx.result;
    }
    // 1800-1830
    if (action.missionType === BuiltObjectMissionType.Repair) {
        for (const item14 of builtObjectList2) {
            if (item14 === null) continue;
            if (action.target !== null && isStellarObject(action.target)) {
                const stellarObject3 = action.target;
                if (stellarObject3 !== null && (stellarObject3 as { constructionQueue?: unknown }).constructionQueue != null) {
                    clearPreviousMissionRequirements(galaxy, item14, true);
                    if (item14.damagedComponentCount > 0) {
                        assignMission(galaxy, item14, BuiltObjectMissionType.Repair, stellarObject3, null, BuiltObjectMissionPriority.Unavailable);
                    } else {
                        assignMission(galaxy, item14, BuiltObjectMissionType.Refuel, stellarObject3, null, BuiltObjectMissionPriority.Unavailable);
                    }
                }
            } else {
                const stellarObject4 = findNearestShipYardBase(galaxy, empire, item14);
                if (stellarObject4 !== null) {
                    clearPreviousMissionRequirements(galaxy, item14, true);
                    if (item14.damagedComponentCount > 0) {
                        assignMission(galaxy, item14, BuiltObjectMissionType.Repair, stellarObject4, null, BuiltObjectMissionPriority.Unavailable);
                    } else {
                        assignMission(galaxy, item14, BuiltObjectMissionType.Refuel, stellarObject4, null, BuiltObjectMissionPriority.Unavailable);
                    }
                }
            }
        }
        return ctx.result;
    }
    // 1831-1843
    for (const item15 of builtObjectList2) {
        clearPreviousMissionRequirements(galaxy, item15, true);
        if (positionIsZero(action)) {
            assignMission(galaxy, item15, action.missionType, missionTarget(action.target), null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        } else {
            assignMission(galaxy, item15, action.missionType, missionTarget(action.target), null, BuiltObjectMissionPriority.Normal, { x: action.position.x, y: action.position.y, manuallyAssigned: true });
        }
        item15.isAutoControlled = false;
    }
    return ctx.result;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared branch bodies (repeated verbatim in several C# cases)
// ---------------------------------------------------------------------------------------------------------------

/** `if (PlayerEmpire.ControlMilitaryFleets && GenerateAutomationMessageBox("Fleet Formation") == "off") ControlMilitaryFleets = false`. */
function fleetFormationPrompt(ctx: Ctx): void {
    if (ctx.empire.controlMilitaryFleets && ctx.askTurnOff('Fleet Formation')) {
        ctx.empire.controlMilitaryFleets = false;
    }
}

/** Main.Part7.cs 350-359 / 1139-1148: the Colonization / Ship Building automation prompts before a Build order. */
function buildAutomationPrompts(ctx: Ctx, design: Design): void {
    const empire = ctx.empire;
    if (design.subRole === BuiltObjectSubRole.ColonyShip) {
        if (empire.controlColonization === AutomationLevel.FullyAutomated && ctx.askTurnOff('Colonization')) {
            empire.controlColonization = AutomationLevel.Undefined /* C# Manual (0) */;
        }
    } else if (empire.controlStateConstruction === AutomationLevel.FullyAutomated && ctx.askTurnOff('Ship Building')) {
        empire.controlStateConstruction = AutomationLevel.Undefined /* C# Manual (0) */;
    }
}

/** Main.Part7.cs 416-429 AutomateShip (and 1606-1623 per list entry). */
function automateShip(ctx: Ctx, builtObject: BuiltObject): void {
    builtObject.isAutoControlled = true;
    if (builtObject.empire !== null) {
        if (builtObject.empire.pirateEmpireBaseHabitat === null) {
            assignMissionToBuiltObject(ctx.galaxy, builtObject.empire, builtObject, false, null);
        } else {
            pirateAssignShipMission(ctx.galaxy, builtObject.empire, builtObject, galaxyStarDate(ctx.galaxy));
        }
    }
}

/** Main.Part7.cs 1855 method_348(shipGroup, automated). */
function setShipGroupAutomated(shipGroup: ShipGroup, automated: boolean): void {
    for (const ship of shipGroup.ships) {
        ship.isAutoControlled = automated;
    }
}

/** Main.Part7.cs 188-206 / 399-415 GiveBuiltObject: true when the C# returns. */
function giveBuiltObject(ctx: Ctx, selected: ShipActionSelection, action: ShipAction): boolean {
    if (!isBuiltObject(action.target)) return false;
    const builtObject2 = action.target;
    if (!isEmpire(action.target2)) return false;
    const empire = action.target2;
    if (builtObject2.empire !== empire) {
        takeOwnershipOfBuiltObject(ctx.galaxy, empire, builtObject2, empire, true, true);
        if (selected === builtObject2) {
            ctx.result.select = null; // method_208(null)
        }
        return true;
    }
    return false;
}

/** Main.Part7.cs 207-224 / 490-513: fighter build / launch / retrieve, then method_593(FighterOptions). */
function fighterCommand(ctx: Ctx, builtObject: BuiltObject, actionType: ShipActionType): void {
    const galaxy = ctx.galaxy;
    switch (actionType) {
        case ShipActionType.FighterBuildFighter:
            buildNewFighter(galaxy, builtObject);
            break;
        case ShipActionType.FighterBuildBomber:
            buildNewBomber(galaxy, builtObject);
            break;
        case ShipActionType.FighterLaunchFighters:
            launchAvailableFighters(galaxy, builtObject);
            break;
        case ShipActionType.FighterLaunchBombers:
            launchAvailableBombers(galaxy, builtObject);
            break;
        case ShipActionType.FighterRetrieveFighters:
            returnFighters(builtObject);
            break;
        case ShipActionType.FighterRetrieveBombers:
            returnBombers(builtObject);
            break;
    }
    ctx.result.openSubMenu = ShipAction.forAction(ShipActionType.FighterOptions, builtObject);
}

/** Main.Part7.cs 236-267 / 517-548 FighterUpgradeAll: tear down onboard fighters of an outdated specification. */
function fighterUpgradeAll(ctx: Ctx, builtObject: BuiltObject): void {
    const fighters = builtObject.fighters as Fighter[] | null;
    if (fighters === null || fighters.length <= 0) return;
    let fighterSpecification = null;
    let fighterSpecification2 = null;
    if (builtObject.empire !== null && builtObject.empire.research !== null) {
        fighterSpecification = identifyLatestFighterSpecification(builtObject.empire);
        fighterSpecification2 = identifyLatestBomberSpecification(builtObject.empire);
    }
    const array = fighters.slice();
    for (const fighter2 of array) {
        if (fighter2.specification === null) continue;
        if (fighterSpecification !== null && fighter2.specification.type === FighterType.Interceptor) {
            if (fighter2.specification !== fighterSpecification && fighter2.onboardCarrier) {
                fighterCompleteTeardown(ctx.galaxy, fighter2);
            }
        } else if (fighterSpecification2 !== null && fighter2.specification.type === FighterType.Bomber && fighter2.specification !== fighterSpecification2 && fighter2.onboardCarrier) {
            fighterCompleteTeardown(ctx.galaxy, fighter2);
        }
    }
}

/** Main.Part7.cs 123-133 / 549-559 / 1044-1054 TransferCharacter to the selected base / ship / colony. */
function transferCharacter(ctx: Ctx, location: BuiltObject | Habitat, action: ShipAction): void {
    if (action.target2 !== null && action.target2 instanceof Character) {
        const character = action.target2;
        const characterList = resolveCharactersValidForLocation(ctx.galaxy, location, ctx.empire);
        if (characterList.includes(character)) {
            character.transferToNewLocation(location, ctx.galaxy);
        }
    }
}

/** Main.Part7.cs 134-151 / 952-970: add the pirate mission, or withdraw it when it is already offered. */
function togglePirateMission(ctx: Ctx, activity: EmpireActivity): void {
    const { galaxy, empire } = ctx;
    if (!empire.pirateMissions.containsEquivalent(activity)) {
        empire.pirateMissions.add(activity);
        if (!galaxy.pirateMissions.containsEquivalent(activity)) {
            galaxy.pirateMissions.add(activity);
        }
    } else if (galaxy.pirateMissions.containsEquivalent(activity)) {
        empire.pirateMissions.removeEquivalent(activity);
    }
}

/** Main.Part7.cs 305-313 / 683-691: a pirate player loots its own scrapped ship. */
function retireLooting(ctx: Ctx, builtObject: BuiltObject): void {
    const { galaxy, empire } = ctx;
    if (empire.pirateEmpireBaseHabitat !== null) {
        let num2 = calculateBuiltObjectLootingValue(builtObject);
        num2 *= empireColonyIncomeFactor(empire);
        num2 *= empireLootingFactor(empire);
        num2 = applyCorruptionToIncome(empire, num2);
        empire.stateMoney += num2;
        pirateEconomyPerformIncome(galaxy, empire, num2, PirateIncomeType.Looting, galaxyStarDate(galaxy));
    }
}

/** Main.Part7.cs 883-951 RecruitTroops at the selected colony. */
function recruitTroops(ctx: Ctx, habitat4: Habitat, action: ShipAction): void {
    const { galaxy, empire } = ctx;
    if (empire.controlTroopGeneration && ctx.askTurnOff('Troop Recruitment')) {
        empire.controlTroopGeneration = false;
    }
    if (habitat4.empire === null || habitat4.empire === galaxy.independentEmpire || habitat4.troopsToRecruit === null) {
        return;
    }
    const dominantRace = habitat4.population.dominantRace as Race;
    let num11 = dominantRace.troopStrength;
    if (habitat4.ruin !== null) {
        num11 = Math.trunc(num11 * (1.0 + habitat4.ruin.bonusDefensive));
    }
    const bonusTotalByEffectType = resourceBonusTotalByEffectType(habitat4, ColonyResourceEffect.RecruitedTroopStrength);
    num11 += Math.trunc(bonusTotalByEffectType);
    let troop: Troop | null = null;
    if (action.target2 !== null && action.target2 instanceof Troop) {
        troop = action.target2;
    }
    let troop2: Troop;
    const colonyEmpire = habitat4.empire;
    if (troop !== null) {
        if (action.extraData === 'clone') {
            troop2 = generateNewTroop(colonyEmpire.generateTroopDescription(troop.name), troop.type, troop.attackStrength, colonyEmpire, troop.race as Race | null, false);
            troop2.setDefendStrength(troop.defendStrength);
        } else if (action.extraData === 'robotic') {
            troop2 = generateNewTroop(colonyEmpire.generateTroopDescription(troop.name), troop.type, troop.attackStrength, colonyEmpire, troop.race as Race | null, false);
            troop2.setDefendStrength(troop.defendStrength);
            troop2.maintenanceMultiplier = 0.25;
        } else if (action.extraData === 'elite') {
            troop2 = generateNewTroop(colonyEmpire.generateTroopDescription(troop.name), troop.type, troop.attackStrength, colonyEmpire, troop.race as Race | null, false);
            troop2.setDefendStrength(troop.defendStrength);
        } else {
            troop2 = generateNewTroop(colonyEmpire.generateTroopDescription(troop.name), troop.type, num11, colonyEmpire, dominantRace);
        }
    } else {
        troop2 = generateNewTroop(colonyEmpire.generateTroopDescription(dominantRace.troopName), TroopType.Infantry, num11, colonyEmpire, dominantRace);
    }
    troop2.readiness = 0;
    troop2.colony = habitat4;
    habitat4.troopsToRecruit.add(troop2);
    if (habitat4.empire !== null && habitat4.empire.troops !== null) {
        habitat4.empire.troops.add(troop2);
    }
}

/** Main.Part7.cs 1055-1134 BuildPlanetaryFacility at the selected colony. */
function buildPlanetaryFacility(ctx: Ctx, habitat4: Habitat, action: ShipAction): void {
    const { galaxy, empire } = ctx;
    if (!isFacilityDefinition(action.target)) return;
    const planetaryFacilityDefinition = action.target;
    const defType = facilityType(planetaryFacilityDefinition);
    if (defType === PlanetaryFacilityType.Wonder) {
        const planetaryFacilityDefinitionList = resolveBuildableWonders(galaxy, habitat4);
        if (
            planetaryFacilityDefinitionList.find((d) => d.facilityId === planetaryFacilityDefinition.facilityId) !== undefined &&
            empire.stateMoney >= calculatePlanetaryFacilityCost(planetaryFacilityDefinition, empire) &&
            queueWonderConstruction(galaxy, habitat4, planetaryFacilityDefinition)
        ) {
            empire.stateMoney -= calculatePlanetaryFacilityCost(planetaryFacilityDefinition, empire);
            pirateEconomyPerformExpense(galaxy, empire, calculatePlanetaryFacilityCost(planetaryFacilityDefinition, empire), PirateExpenseType.FacilityConstruction, galaxyStarDate(galaxy));
        }
        return;
    }
    let planetaryFacilityDefinitionList2 = resolveBuildableFacilities(galaxy, habitat4);
    if (empire.pirateEmpireBaseHabitat !== null && habitat4.empire !== empire) {
        planetaryFacilityDefinitionList2 = resolveBuildableFacilitiesPirates(galaxy, habitat4, empire);
    }
    const num4 = calculatePlanetaryFacilityCost(planetaryFacilityDefinition, empire);
    if (definitionsFindFacilityByType(planetaryFacilityDefinitionList2, defType) === null || !(empire.stateMoney >= num4)) {
        return;
    }
    let flag3 = true;
    let pirateColonyControl: PirateColonyControl | null = null;
    if (defType === PlanetaryFacilityType.PirateBase || defType === PlanetaryFacilityType.PirateFortress || defType === PlanetaryFacilityType.PirateCriminalNetwork) {
        flag3 = false;
        pirateColonyControl = habitat4.pirateColonyControl.getByFacilityControl();
        if (pirateColonyControl !== null && pirateColonyControl.empireId === empire.empireId) {
            flag3 = true;
            if (defType === PlanetaryFacilityType.PirateCriminalNetwork) {
                flag3 = false;
                const planetaryFacility = facilitiesFindBestPirateFacility(habitat4.facilities ?? [], true, true);
                if (planetaryFacility !== null && planetaryFacility.type === PlanetaryFacilityType.PirateFortress && pirateColonyControl.hasFacilityControl && countPirateCriminalNetworks(galaxy, empire) <= 0) {
                    flag3 = true;
                }
            }
        } else {
            pirateColonyControl = habitat4.pirateColonyControl.getByFaction(empire);
            let num5 = Math.fround(0.5);
            let flag4 = true;
            if (defType === PlanetaryFacilityType.PirateFortress) {
                num5 = 1;
            }
            if (defType === PlanetaryFacilityType.PirateCriminalNetwork) {
                flag4 = false;
                num5 = 1;
                const planetaryFacility2 = facilitiesFindBestPirateFacility(habitat4.facilities ?? [], true, true);
                // C# reads pirateColonyControl.HasFacilityControl here without a null check (NullReferenceException when null).
                if (planetaryFacility2 !== null && planetaryFacility2.type === PlanetaryFacilityType.PirateFortress && pirateColonyControl!.hasFacilityControl && countPirateCriminalNetworks(galaxy, empire) <= 0) {
                    flag4 = true;
                }
            }
            if (pirateColonyControl !== null && pirateColonyControl.controlLevel >= num5 && flag4) {
                flag3 = true;
            }
        }
    }
    if (flag3 && queueFacilityConstruction(galaxy, habitat4, defType)) {
        if (pirateColonyControl !== null) {
            pirateColonyControl.hasFacilityControl = true;
        }
        empire.stateMoney -= num4;
        pirateEconomyPerformExpense(galaxy, empire, num4, PirateExpenseType.FacilityConstruction, galaxyStarDate(galaxy));
    }
}

/** Main.Part4.cs 2826 method_539(habitat): buy a colony ship at the best colony and send it to colonize. */
function buildColonyShipFor(ctx: Ctx, habitat9: Habitat): ShipActionResult {
    const { galaxy, empire } = ctx;
    // 2828-2831
    if (habitat9 === null) {
        return ctx.fail('no habitat');
    }
    // 2832-2837
    let colonizableHabitatTypes = empire.colonizableHabitatTypesForEmpire();
    const design = findNewestCanBuild(empire.designs, BuiltObjectSubRole.ColonyShip, empire);
    if (design === null || !canEmpireColonizeHabitat(galaxy, empire, empire, habitat9, colonizableHabitatTypes, design)) {
        return ctx.fail('cannot colonize');
    }
    // 2838-2863: the colony with the lowest (wait time + 1) × √distance that may build a ship for this habitat type.
    colonizableHabitatTypes = colonizableHabitatTypesForEmpireTechOnly(empire);
    let habitat: Habitat | null = null;
    let num = Number.MAX_VALUE;
    for (const colony of empire.colonies) {
        if (
            (habitat9.empire === galaxy.independentEmpire || colonizableHabitatTypes.includes(habitat9.type) || colony.population.dominantRace!.nativeHabitatType === habitat9.type) &&
            colony.population.totalAmount >= BUILD_COLONY_SHIP_POPULATION_REQUIREMENT
        ) {
            const num2 = galaxy.calculateDistance(colony.xpos, colony.ypos, habitat9.xpos, habitat9.ypos);
            let num3 = 600.0;
            const queue = queueOf(colony);
            if (queue !== null) {
                num3 = queue.estimateCurrentWaitQueueTime();
                num3 += 1.0;
            }
            let num4 = num3 * num2;
            if (num2 > 0.0) {
                num4 = num3 * Math.sqrt(num2);
            }
            if (num4 < num) {
                num = num4;
                habitat = colony;
            }
        }
    }
    // 2864-2868: PurchaseNewBuiltObject(design, habitat, isStateOwned: true, isAutoControlled) (Empire.6.cs 1991)
    // ?.AssignMission(Colonize, habitat_9, null, Normal, manuallyAssigned: true). No message either way.
    if (habitat !== null) {
        const isAutoControlled = newBuiltObjectShouldBeAutomated(empire, BuiltObjectSubRole.ColonyShip);
        const builtObject = purchaseNewBuiltObject(galaxy, empire, design, habitat, true, isAutoControlled);
        if (builtObject === null) {
            return ctx.fail('PurchaseNewBuiltObject returned null (Main.Part4.cs:2867: no message)');
        }
        assignMission(galaxy, builtObject, BuiltObjectMissionType.Colonize, habitat9, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        return ctx.result;
    }
    return ctx.fail('no colony can build the colony ship');
}

/** Main.Part4.cs 2871 method_540(builtObject, habitat): send a construction ship to build a (gas) mining station. */
function buildMiningStationAt(ctx: Ctx, builtObject8: BuiltObject | null, habitat9: Habitat): void {
    const { galaxy, empire } = ctx;
    let subRole = BuiltObjectSubRole.MiningStation;
    if (countGasResources(galaxy, habitat9) > 0) {
        subRole = BuiltObjectSubRole.GasMiningStation;
    }
    const design = findNewestCanBuild(empire.designs, subRole, empire);
    if (design === null) return;
    const p = galaxy.selectRelativeHabitatSurfacePoint(habitat9);
    const num = p.x;
    const num2 = p.y;
    if (builtObject8 === null) {
        builtObject8 = fastFindBestConstructionShip(galaxy, habitat9.xpos, habitat9.ypos, empire);
        if (builtObject8 !== null) {
            const m = builtObjectMission(builtObject8.mission);
            if (m !== null && m.type !== BuiltObjectMissionType.Undefined) {
                queueMissionFull(galaxy, builtObject8, BuiltObjectMissionType.Build, habitat9, null, BuiltObjectMissionPriority.Normal, { design, x: num, y: num2 });
            } else {
                assignMission(galaxy, builtObject8, BuiltObjectMissionType.Build, habitat9, null, BuiltObjectMissionPriority.Normal, { design, x: num, y: num2, manuallyAssigned: true });
            }
        }
    } else {
        assignMission(galaxy, builtObject8, BuiltObjectMissionType.Build, habitat9, null, BuiltObjectMissionPriority.Normal, { design, x: num, y: num2, manuallyAssigned: true });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Sim helpers method_347 reaches that were not ported yet (small, cited)
// ---------------------------------------------------------------------------------------------------------------

/**
 * BuiltObject.2.cs 7506-7548 QueueMission overloads through the 11-argument one (7541): bases never queue. The
 * construction module's queueMission covers only the (target, target2, [design,] priority) overloads.
 */
export function queueMissionFull(
    galaxy: Galaxy,
    bo: BuiltObject,
    missionType: BuiltObjectMissionType,
    target: MissionTarget | null,
    target2: MissionTarget | null,
    priority: BuiltObjectMissionPriority,
    args: { troops?: TroopList | null; design?: Design | null; x?: number; y?: number },
): void {
    if (bo.role !== BuiltObjectRole.Base) {
        const item = new BuiltObjectMission(galaxy, bo, missionType, target, target2, priority, {
            troops: args.troops ?? null,
            design: args.design ?? null,
            x: args.x ?? COORD_UNSET_DOUBLE,
            y: args.y ?? COORD_UNSET_DOUBLE,
            starDate: -1,
            allowReprocessing: true,
            allowBuiltObjectChanges: false,
        });
        bo.subsequentMissions.push(item);
    }
}

/** Galaxy.7.cs 705 FastFindBestConstructionShip(x, y, empire). No Rnd. */
export function fastFindBestConstructionShip(galaxy: Galaxy, x: number, y: number, empire: Empire | null): BuiltObject | null {
    let result: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    if (empire !== null) {
        const ships = empire.constructionShips as (BuiltObject | null)[];
        for (let i = 0; i < ships.length; i++) {
            const builtObject = ships[i];
            if (builtObject === null || !builtObject.isShipYard) continue;
            const num2 = galaxy.calculateDistance(x, y, builtObject.xpos, builtObject.ypos);
            let num3 = 1000.0;
            const queue = constructionQueueOf(builtObject.constructionQueue);
            if (queue !== null && queue.constructionWaitQueue !== null) {
                num3 = 100.0;
                const m = builtObjectMission(builtObject.mission);
                if (m !== null && m.type !== BuiltObjectMissionType.Undefined) {
                    num3 += 500.0;
                    if (builtObject.subsequentMissions !== null && builtObject.subsequentMissions.length > 0) {
                        num3 += builtObject.subsequentMissions.length * 500.0;
                    }
                    if (queue.constructionWaitQueue.length > 0) {
                        num3 += queue.constructionWaitQueue.length * 500.0;
                    }
                }
            }
            const num4 = num3 * num2;
            if (num4 < num) {
                result = builtObject;
                num = num4;
            }
        }
    }
    return result;
}

/** Empire.5.cs 377 FindNearestShipYardBase(ship). No Rnd. */
export function findNearestShipYardBase(galaxy: Galaxy, empire: Empire, ship: BuiltObject): BuiltObject | null {
    let result: BuiltObject | null = null;
    let num = Number.MAX_VALUE;
    const yards = empire.constructionYards as BuiltObject[];
    for (let i = 0; i < yards.length; i++) {
        const builtObject = yards[i];
        if (builtObject.role === BuiltObjectRole.Base) {
            const num2 = galaxy.calculateDistanceSquared(ship.xpos, ship.ypos, builtObject.xpos, builtObject.ypos);
            if (num2 < num) {
                result = builtObject;
                num = num2;
            }
        }
    }
    return result;
}

/** BuiltObject.cs 2006 SendCharactersHome(). No Rnd. */
export function sendCharactersHome(galaxy: Galaxy, builtObject: BuiltObject): void {
    if ((builtObject.damagedComponentCount > 0 && builtObject.inBattle) || builtObject.characters === null) {
        return;
    }
    const array = (builtObject.characters as (Character | null)[]).slice();
    for (const character of array) {
        if (character === null || character.empire === null) continue;
        if (character.empire.capital !== null) {
            character.completeLocationTransfer(character.empire.capital, galaxy);
        } else if (character.empire.pirateEmpireBaseHabitat !== null) {
            const builtObject2 = identifyPirateSpaceport(galaxy, character.empire);
            if (builtObject2 !== null) {
                character.completeLocationTransfer(builtObject2, galaxy);
            }
        }
    }
}

/** CharacterList.cs 314 GetNonTransferringCharacters(role). */
function getNonTransferringCharacters(characters: readonly (Character | null)[], role: CharacterRole): Character[] {
    const list: Character[] = [];
    for (let index = 0; index < characters.length; ++index) {
        const character = characters[index];
        if (character !== null && character.transferDestination === null && character.transferTimeRemaining <= 0.0 && (role === CharacterRole.Undefined || character.role === role)) {
            list.push(character);
        }
    }
    return list;
}

function isCreatureLocation(o: unknown): o is Creature {
    return o instanceof Creature;
}

/** Galaxy.2.cs 4736 ResolveCharactersValidForLocation(location, empire): characters that may be sent there. No Rnd. */
export function resolveCharactersValidForLocation(galaxy: Galaxy, location: StellarObject | null, empire: Empire | null): Character[] {
    let characterList: Character[] = [];
    if (empire !== null && location !== null) {
        const characters = empire.characters as (Character | null)[];
        // StellarObject.Empire (a Creature's is null).
        const locationEmpire = isCreatureLocation(location) ? null : location.empire;
        if (locationEmpire === empire) {
            if (isHabitat(location)) {
                characterList = getNonTransferringCharacters(characters, CharacterRole.Undefined);
            } else if (isBuiltObject(location)) {
                if (location.owner === empire) {
                    characterList = getNonTransferringCharacters(characters, CharacterRole.Undefined);
                }
            }
        } else if (isHabitat(location)) {
            const habitat = location;
            if (habitat.empire !== null && habitat.empire !== galaxy.independentEmpire && habitat.population !== null && habitat.population.totalAmount > 0 && habitat === habitat.empire.capital) {
                const diplomaticRelation = obtainDiplomaticRelation(empire, habitat.empire);
                if (diplomaticRelation.type !== DiplomaticRelationType.NotMet && diplomaticRelation.type !== DiplomaticRelationType.War) {
                    characterList = getNonTransferringCharacters(characters, CharacterRole.Ambassador);
                }
            }
        }
        const characterList2: Character[] = [];
        for (let i = 0; i < characterList.length; i++) {
            if (characterList[i].location === location) {
                characterList2.push(characterList[i]);
            }
        }
        for (let j = 0; j < characterList2.length; j++) {
            const k = characterList.indexOf(characterList2[j]);
            if (k >= 0) characterList.splice(k, 1);
        }
    }
    return characterList;
}

/** SystemInfoList.cs 16 `Systems[systemStar]`: the system whose SystemStar is this habitat, else null. */
function systemForStar(galaxy: Galaxy, systemStar: Habitat): SystemInfo | null {
    for (let index = 0; index < galaxy.systems.length; ++index) {
        if (galaxy.systems[index].systemStar === systemStar) return galaxy.systems[index];
    }
    return null;
}

/** Empire.9.cs 308 IdentifyEmpireAssetsInSystem(system). */
function identifyEmpireAssetsInSystem(empire: Empire, system: SystemInfo): StellarObject[] {
    const stellarObjectList: StellarObject[] = [];
    for (let i = 0; i < system.habitats.length; i++) {
        const habitat = system.habitats[i];
        if (habitat.owner === empire) {
            stellarObjectList.push(habitat);
        } else {
            if (habitat.basesAtHabitat === null || habitat.basesAtHabitat.length <= 0) continue;
            for (let j = 0; j < habitat.basesAtHabitat.length; j++) {
                const builtObject = habitat.basesAtHabitat[j];
                if (builtObject.empire === empire) {
                    stellarObjectList.push(builtObject);
                }
            }
        }
    }
    return stellarObjectList;
}

/** Empire.9.cs 284 AssignShipSystemPatrol(ship, system, manuallyAssigned). Rnd: Next(0, assets) when the empire has assets there. */
export function assignShipSystemPatrol(galaxy: Galaxy, empire: Empire, ship: BuiltObject, system: SystemInfo, manuallyAssigned: boolean): boolean {
    const stellarObjectList = identifyEmpireAssetsInSystem(empire, system);
    if (stellarObjectList.length > 0) {
        const stellarObject = stellarObjectList[galaxy.rnd.next(0, stellarObjectList.length)];
        if (isBuiltObject(stellarObject)) {
            clearPreviousMissionRequirements(galaxy, ship);
            assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, stellarObject, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned });
            return true;
        }
        if (isHabitat(stellarObject)) {
            clearPreviousMissionRequirements(galaxy, ship);
            assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, stellarObject, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned });
            return true;
        }
        return false;
    }
    clearPreviousMissionRequirements(galaxy, ship);
    assignMission(galaxy, ship, BuiltObjectMissionType.Move, system.systemStar, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned });
    return true;
}

/** Empire.9.cs 338 AssignFleetSystemPatrol(fleet, system). */
export function assignFleetSystemPatrol(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, system: SystemInfo | null): boolean {
    if (fleet.ships !== null && fleet.ships.length > 0 && system !== null) {
        const stellarObjectList = identifyEmpireAssetsInSystem(empire, system);
        let num = fleet.ships.length;
        if (stellarObjectList.length > 1) {
            num = Math.max(1, Math.trunc(fleet.ships.length / stellarObjectList.length));
        }
        if (stellarObjectList.length > 0) {
            if (system.systemStar !== null) {
                shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Patrol, system.systemStar, null, BuiltObjectMissionPriority.Normal, true);
            }
            let num2 = 0;
            for (let i = 0; i < stellarObjectList.length; i++) {
                let num3 = num2 + num;
                if (num3 > fleet.ships.length) {
                    num3 = fleet.ships.length;
                }
                if (i === stellarObjectList.length - 1) {
                    num3 = fleet.ships.length;
                }
                for (let j = num2; j < num3; j++) {
                    if (shipGroupIsShipAvailable(fleet.ships[j])) {
                        clearPreviousMissionRequirements(galaxy, fleet.ships[j]);
                        assignMission(galaxy, fleet.ships[j], BuiltObjectMissionType.Patrol, stellarObjectList[i], null, BuiltObjectMissionPriority.Normal);
                    }
                }
                num2 += num;
                if (num2 >= fleet.ships.length) {
                    break;
                }
            }
            return true;
        }
        if (system.systemStar !== null) {
            if (system.systemStar.category === HabitatCategoryType.GasCloud || system.systemStar.type === HabitatType.BlackHole || system.systemStar.type === HabitatType.SuperNova) {
                shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Move, system.systemStar, null, BuiltObjectMissionPriority.Normal, true);
                return true;
            }
            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Patrol, system.systemStar, null, BuiltObjectMissionPriority.Normal, true);
            return true;
        }
    }
    return false;
}

/** Empire.9.cs 407/412/417 AssignFleetLoadTroops(fleet, colony, manuallyAssigned[, enforceMinimumTroopLimitsAtColonies = !manuallyAssigned]). */
export function assignFleetLoadTroops(galaxy: Galaxy, empire: Empire, fleet: ShipGroup | null, colony: Habitat | null, manuallyAssigned: boolean, enforceMinimumTroopLimitsAtColonies = !manuallyAssigned): boolean {
    void empire;
    let result = false;
    if (fleet !== null) {
        let habitat = colony;
        if (habitat === null) {
            habitat = fastFindNearestColony(galaxy, Math.trunc(fleet.leadShip!.xpos), Math.trunc(fleet.leadShip!.ypos), fleet.empire!, 0);
        }
        if (habitat !== null) {
            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.LoadTroops, habitat, null, BuiltObjectMissionPriority.Normal, manuallyAssigned);
            if (colony === null && fleet.mission !== null) {
                fleet.mission.targetHabitat = null;
            }
            let flag = false;
            if (colony !== null && colony.empire !== fleet.empire && colony.invadingTroops !== null && colony.invadingTroops.count > 0 && colony.invadingTroops.items[0].empire === fleet.empire) {
                flag = true;
            }
            for (let i = 0; i < fleet.ships.length; i++) {
                const builtObject = fleet.ships[i];
                let habitat2 = colony;
                if (builtObject === null || builtObject.empire === null || !shipGroupIsShipAvailable(builtObject) || builtObject.troopCapacityRemaining < 100) {
                    continue;
                }
                let prefilteredTroopsNotBeingPickedUp = new TroopList();
                if (habitat2 === null) {
                    const r = findNearestColonyWithExcessTroops(galaxy, builtObject.empire, builtObject, enforceMinimumTroopLimitsAtColonies, false);
                    habitat2 = r.habitat;
                    prefilteredTroopsNotBeingPickedUp = r.prefilteredTroopsNotBeingPickedUp;
                }
                if (habitat2 === null) {
                    return result;
                }
                let troopList: TroopList | null = null;
                if (habitat2 !== null) {
                    troopList = habitat2.troops;
                    if (flag && colony === habitat2) {
                        troopList = habitat2.invadingTroops;
                    }
                }
                if (habitat2 === null || troopList === null) {
                    continue;
                }
                let troopList2 = prefilteredTroopsNotBeingPickedUp;
                if (flag && colony === habitat2) {
                    troopList2 = new TroopList();
                    for (let j = 0; j < troopList.count; j++) {
                        if (troopList.items[j] !== null && troopList.items[j].empire === builtObject.empire) {
                            troopList2.add(troopList.items[j]);
                        }
                    }
                } else if (prefilteredTroopsNotBeingPickedUp === null || prefilteredTroopsNotBeingPickedUp.count <= 0) {
                    troopList2 = getTroopsNotGarrisonedNotAwaitingPickup(habitat2.troops!);
                }
                if (troopList2.count <= 0) {
                    continue;
                }
                let num = builtObject.troopCapacityRemaining;
                let num2 = troopList.totalDefendStrength;
                if (enforceMinimumTroopLimitsAtColonies) {
                    const num3 = troopLevelMinimum(galaxy, habitat2, galaxy.difficultyLevel) * 100;
                    num2 -= num3;
                }
                const troopList3 = new TroopList();
                let flag2 = false;
                for (let k = 0; k < troopList2.count; k++) {
                    const troop = troopList2.items[k];
                    if (troop !== null && num2 - Math.trunc(Math.fround(troop.defendStrength * troop.readiness)) >= 0 && num >= troop.size) {
                        troopList3.add(troop);
                        flag2 = true;
                        num -= troop.size;
                        num2 -= Math.trunc(Math.fround(troop.defendStrength * troop.readiness));
                        if (num < 100 || num2 <= 0) {
                            break;
                        }
                    }
                }
                if (flag2) {
                    clearPreviousMissionRequirements(galaxy, builtObject);
                    assignMission(galaxy, builtObject, BuiltObjectMissionType.LoadTroops, habitat2, null, BuiltObjectMissionPriority.Normal, { troops: troopList3, manuallyAssigned });
                    result = true;
                }
            }
        }
    }
    return result;
}

/** Empire.9.cs 551/556 AssignFleetRepair(fleet[, shipYard]). */
export function assignFleetRepair(galaxy: Galaxy, empire: Empire, fleet: ShipGroup | null, shipYard: StellarObject | null): boolean {
    void empire;
    if (fleet !== null) {
        if (shipYard === null) {
            shipYard = findNearestShipYard(galaxy, fleet.empire!, fleet.leadShip!, true, false);
        }
        if (shipYard !== null && isBuiltObject(shipYard)) {
            shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Repair, shipYard, null, BuiltObjectMissionPriority.High, true);
            for (let i = 0; i < fleet.ships.length; i++) {
                const builtObject = fleet.ships[i];
                const m = builtObjectMission(builtObject.mission);
                if (shipGroupIsShipAvailable(builtObject) || (m !== null && m.type === BuiltObjectMissionType.Repair && builtObject.builtAt === null)) {
                    if (builtObject.damagedComponentCount > 0) {
                        clearPreviousMissionRequirements(galaxy, builtObject);
                        assignMission(galaxy, builtObject, BuiltObjectMissionType.Repair, shipYard, null, BuiltObjectMissionPriority.Unavailable);
                    } else {
                        clearPreviousMissionRequirements(galaxy, builtObject);
                        assignMission(galaxy, builtObject, BuiltObjectMissionType.Refuel, shipYard, null, BuiltObjectMissionPriority.Unavailable);
                    }
                }
            }
            return true;
        }
    }
    return false;
}

/** HabitatResourceList.cs 168 CountGasResources(). */
function countGasResources(galaxy: Galaxy, habitat: Habitat): number {
    let num = 0;
    for (let index = 0; index < habitat.resources.length; ++index) {
        const habitatResource = habitat.resources[index];
        if (habitatResource !== null && resourceGroupOf(galaxy.resourceSystem.byId.get(habitatResource.resourceId)!) === ResourceGroup.Gas) ++num;
    }
    return num;
}

/** Habitat.cs 6481 ResolveBuildableWonders(). */
export function resolveBuildableWonders(galaxy: Galaxy, habitat: Habitat): Facility[] {
    const empire = habitat.empire;
    if (empire !== null && empire !== galaxy.independentEmpire && empire.research !== null && habitat.population !== null && habitat.population.totalAmount > 0) {
        const list = empire.research.buildablePlanetaryFacilities.slice();
        const list2: Facility[] = [];
        for (let i = 0; i < list.length; i++) {
            if (facilityType(list[i]) !== PlanetaryFacilityType.Wonder) list2.push(list[i]);
        }
        for (let j = 0; j < list.length; j++) {
            if (list[j].value3 > 0) {
                const habitatType = resolveColonyHabitatTypeByIndexDesertBeforeOcean(list[j].value3 - 1);
                if (habitat.type !== habitatType) list2.push(list[j]);
            }
        }
        const facilities = habitat.facilities;
        if (facilities !== null && facilities.length > 0 && list.length > 0) {
            for (let k = 0; k < list.length; k++) {
                for (let l = 0; l < facilities.length; l++) {
                    if (facilities[l].planetaryFacilityDefinitionId === list[k].facilityId) {
                        list2.push(list[k]);
                        break;
                    }
                }
            }
        }
        for (let m = 0; m < list.length; m++) {
            if (facilityType(list[m]) === PlanetaryFacilityType.Wonder && !canBuildWonder(galaxy, habitat, list[m])) list2.push(list[m]);
        }
        removeAll(list, list2);
        return list;
    }
    return [];
}

/** Habitat.cs 6660 ResolveBuildableFacilities(). */
export function resolveBuildableFacilities(galaxy: Galaxy, habitat: Habitat): Facility[] {
    const empire = habitat.empire;
    if (empire !== null && empire !== galaxy.independentEmpire && empire.research !== null && habitat.population !== null && habitat.population.totalAmount > 0) {
        const list = empire.research.buildablePlanetaryFacilities.slice();
        const list2: (Facility | null)[] = [];
        for (let i = 0; i < list.length; i++) {
            if (facilityType(list[i]) === PlanetaryFacilityType.Wonder) list2.push(list[i]);
        }
        const facilities = habitat.facilities;
        if (facilities !== null && facilities.length > 0 && list.length > 0) {
            for (let j = 0; j < list.length; j++) {
                for (let k = 0; k < facilities.length; k++) {
                    if (facilities[k].type === facilityType(list[j])) {
                        list2.push(list[j]);
                        break;
                    }
                }
            }
            const has = (t: PlanetaryFacilityType) => facilities.some((f) => f.type === t);
            if (has(PlanetaryFacilityType.CloningFacility) || has(PlanetaryFacilityType.RoboticTroopFoundry) || has(PlanetaryFacilityType.TroopTrainingCenter)) {
                list2.push(definitionsFindFacilityByType(list, PlanetaryFacilityType.CloningFacility));
                list2.push(definitionsFindFacilityByType(list, PlanetaryFacilityType.RoboticTroopFoundry));
                list2.push(definitionsFindFacilityByType(list, PlanetaryFacilityType.TroopTrainingCenter));
            }
        }
        let num = 0;
        for (const d of list) if (facilityType(d) === PlanetaryFacilityType.RegionalCapital) num++;
        const habitatList = identifyEmpireRegionalCapitals(empire, true);
        if (habitat === empire.capital || habitatList.length >= num) {
            for (let l = 0; l < list.length; l++) {
                if (facilityType(list[l]) === PlanetaryFacilityType.RegionalCapital) list2.push(list[l]);
            }
        } else if (num > 1) {
            let num2 = 0;
            for (let num3 = list.length - 1; num3 >= 0; num3--) {
                if (facilityType(list[num3]) === PlanetaryFacilityType.RegionalCapital && num2 < num - 1) {
                    list2.push(list[num3]);
                    num2++;
                }
            }
        }
        removeAll(list, list2);
        return list;
    }
    return [];
}

/** Habitat.cs 6590 ResolveBuildableFacilitiesPirates(pirateFaction). */
export function resolveBuildableFacilitiesPirates(galaxy: Galaxy, habitat: Habitat, pirateFaction: Empire | null): Facility[] {
    const list: Facility[] = [];
    const defs = planetaryFacilityDefinitionsStatic(galaxy);
    const item = defs[25];
    const item2 = defs[26];
    const item3 = defs[32];
    const facilities = habitat.facilities;
    if (pirateFaction !== null && pirateFaction.pirateEmpireBaseHabitat !== null && habitat.empire !== null && habitat.population !== null && habitat.population.totalAmount > 0 && facilities !== null) {
        const completedPirateBases = facilities.filter((f) => f.type === PlanetaryFacilityType.PirateBase && f.constructionProgress >= 1.0).length;
        let byFacilityControl = habitat.pirateColonyControl.getByFacilityControl();
        if (byFacilityControl !== null) {
            if (byFacilityControl.empireId === pirateFaction.empireId && byFacilityControl.controlLevel >= Math.fround(0.5)) {
                list.push(item);
                if (byFacilityControl.controlLevel >= 1 && completedPirateBases > 0) {
                    list.push(item2);
                    const planetaryFacility = facilitiesFindBestPirateFacility(facilities, true, true);
                    if (planetaryFacility !== null && planetaryFacility.type === PlanetaryFacilityType.PirateFortress && byFacilityControl.hasFacilityControl && countPirateCriminalNetworks(galaxy, pirateFaction) <= 0) {
                        list.push(item3);
                    }
                }
            }
        } else {
            byFacilityControl = habitat.pirateColonyControl.getHighestControl();
            if (byFacilityControl !== null && byFacilityControl.empireId === pirateFaction.empireId && byFacilityControl.controlLevel >= Math.fround(0.5)) {
                list.push(item);
                if (byFacilityControl.controlLevel >= 1 && completedPirateBases > 0) {
                    list.push(item2);
                }
            }
        }
        const list2: Facility[] = [];
        for (let i = 0; i < list.length; i++) {
            if (facilityType(list[i]) === PlanetaryFacilityType.Wonder) list2.push(list[i]);
        }
        if (facilities.length > 0 && list.length > 0) {
            for (let j = 0; j < list.length; j++) {
                for (let k = 0; k < facilities.length; k++) {
                    if (facilities[k].type === facilityType(list[j])) {
                        list2.push(list[j]);
                        break;
                    }
                }
            }
        }
        removeAll(list, list2);
    }
    return list;
}

/** `foreach (x in list2) list.Remove(x)`: List.Remove drops the first match (null entries match nothing here). */
function removeAll(list: Facility[], toRemove: readonly (Facility | null)[]): void {
    for (let n = 0; n < toRemove.length; n++) {
        const x = toRemove[n];
        if (x === null) continue;
        const i = list.indexOf(x);
        if (i >= 0) list.splice(i, 1);
    }
}
