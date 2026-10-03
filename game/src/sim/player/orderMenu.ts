// 17c — the player's order menus, as pure sim-side logic (no DOM / Pixi):
//   * the right-click action menu: Main.Part8.cs 1537-3201 method_316-343 (per-target builders, sub-menus, the
//     "Queue Next Mission" menus) and 3202-5066 method_344 (the menu for the selected object and the thing under
//     the cursor), plus Main.Part8.cs 1332 actionMenu_Opening (when it opens);
//   * the selection panel's eight action buttons: Main.Part3.cs 1968-3724 method_593 (+ method_585 / method_588
//     button state / method_590 hint text / method_591, and 3725 method_594's follow-up after a click);
//   * the main view's right-click: Main.Part10.cs 248-697 (the default order under the cursor, mainView_MouseMove's
//     selection branch), 3063-3125 (the fleet attack-point / home-base pick after SetFleetAttackPoint/HomeBase) and
//     3310-3559 (mainView_MouseClick right button: execute that order directly, incl. the Blockade check);
//   * Main.Part12.cs 2467-2505 method_78: a click on the targets list (PrioritizedTarget).
//
// A ToolStripMenuItem becomes an OrderMenuItem { key, label, hint, enabled, action, children }: `key` is the
// GameText key of the text (TextResolver.GetText(key)); `label` the text the C# shows (string.Format'ed with the
// target's name); `action` the ShipAction in its Tag when the C# sets one (only those items execute on click, see
// Main.Part7.cs 1846 actionMenu_ItemClicked). The UI executes a picked action with executeShipAction (17b).
//
// `_Game.PlayerEmpire` is ctx.empire, `_Game.SelectedObject` ctx.selected, int_15/int_16 (the cursor in galaxy
// coordinates) ctx.cursorX/Y, double_0 (the zoom: galaxy units per screen pixel) ctx.zoomFactor, and method_143
// (the object under a point: ShipGroup / BuiltObject / Creature / Habitat / SystemInfo / null) the ctx.pickAt
// callback the renderer supplies.
//
// Rnd: building these menus draws galaxy.rnd exactly where the C# does — method_323 / method_344's "Build here"
// designs (Galaxy.SelectRelativePoint) and method_593's build buttons (SelectRelativeHabitatSurfacePoint,
// SelectRelativeParkingPoint). Only ever called from player input, never on the tick path.

import { markNewOrders, snapshotOrders } from '../missions/playerOrder';
import { availableThreatActions } from '../scenario/threats/framework';
import type { Galaxy } from '../galaxy';
import { galaxyNow, spanSeconds } from '../tick/simTime';
import type { Empire } from '../empire';
import { BUILD_COLONY_SHIP_POPULATION_REQUIREMENT } from '../empire';
import { BuiltObject } from '../builtObject';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ComponentType } from '../data/components';
import type { Design } from '../design';
import { Habitat, HabitatCategoryType, HabitatType, IndustryType, planetsOf, type SystemInfo } from '../types';
import { Creature } from '../creature';
import { Troop, TroopType } from '../cargo';
import type { Race } from '../data/races';
import type { Facility } from '../data/facilities';
import type { Plague } from '../data/plagues';
import { Character, CharacterRole, getNonTransferringCharacters } from '../characters';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { FleetPosture } from '../diplomacyTick';
import { netSort } from '../netSort';
import { splitString } from '../data/gameText';
import { formatNet, tryGetText } from '../textResolver';
import { ColonyResourceEffect, resourceBonusTotalByEffectType } from '../developmentLevel';
import { ResourceGroup, resourceGroupOf } from '../resourceSystem';
import { PlanetaryFacilityType, WonderType, facilityType } from '../researchSystem';
import { generateNewTroop } from '../builtObjectPlacement';
import { identifyStrongestRaceAttackTroop } from '../troops';
import { canBuildDesign, findNewestCanBuild, getBuildableDesignsBySubRoles, findNewestCanBuildFullEvaluate, resolveSubRoleDescription, checkDesignWithinConstructionSize, canBuildDesignTech } from '../designGeneration';
import { findNewestIncludingObsolete, getDesignsBySubRoles } from '../design';
import { checkRuinsHaveBenefit, canEmpireColonizeHabitat, canEmpireColonizeHabitatRange } from '../exploration';
import { SystemVisibilityStatus, findNearestUnexploredHabitat } from '../visibility';
import { isObjectVisibleToThisEmpire, checkEmpireTerritoryCanBuildAtLocation, isStellarObjectDockable } from '../independentTraders';
import { checkEmpireTerritoryCanBuildAtHabitat } from '../resourceTargets';
import { checkColonizingHabitat, checkBasesToBeBuiltAtHabitat, checkTargetOfRepairMission, resolveSector, fastFindNearestUnexploredHabitat, fastFindNearestUnexploredHabitatInSector, PrioritizedTarget } from '../civilianAI';
import { resolveSectorDescription } from '../empireEvents';
import { checkAlreadyHaveMiningStationAtHabitat } from '../missions/cmdConstruction';
import { determineSpacePortAtHabitat } from '../logistics/colonySupply';
import { canDestroyHabitat, determineSpacePortAtColony } from '../combat/attackAI';
import { determineSpacePortAtColonyIncludingUnderConstruction, calculatePirateAttackPrice, calculatePirateDefendPrice, calculatePirateSmugglePricePerUnit } from '../pirates/missionsMarket';
import { EmpireActivityType } from '../pirates/empireActivity';
import { fastFindNearestSpacePort, checkResearchStationAtLocation } from '../stationPlacement';
import { determineOrbitalBaseLocation } from '../pirates';
import { canBuildBuiltObject as canBuildBuiltObjectFor, getPrivateFunds } from '../forceStructure';
import { determineFuelRequired } from '../logistics/refuel';
import { checkEmpireCanRefuelAtEmpire, checkWithinDistancePotential, fastFindNearestRefuellingPoint } from '../movement';
import { evaluateThreats } from '../combat/threats';
import { findNearestShipYard, reviewLatestDesigns, determineRetrofitAffordability } from '../construction/empireConstruction';
import { canBuiltObjectColonizeHabitat } from '../construction/constructionQueue';
import { calculatePlanetaryFacilityCost, facilitiesCountCompletedByType, facilitiesFindCompletedByType } from '../construction/facilities';
import { findNearestColonyWithExcessTroops } from '../combat/troopsRuntime';
import { canSendShipToBlockadeColony, canSendShipToBlockadeBuiltObject, blockadeFor } from '../fleets/blockades';
import { implementBlockade, checkAssignFleetWaitAndAttackMission, decideBestFleetRefuelPoint, determineFuelRequiredForFleet, identifyNearestAvailableFleet } from '../fleets/militaryAI';
import { ShipGroup, empireShipGroups } from '../fleets/shipGroup';
import {
    compareShipGroups,
    empireFleetMaximumCount,
    forceCompleteMission,
    getFleetAdmiralsAndGenerals,
    shipGroupAssignMission,
    shipGroupAssignMissionFull,
    shipGroupCalculateRequiredFuel,
    shipGroupDetermineStrongestTroopTransport,
    shipGroupTotalAvailableBoardingAssaultStrength,
    shipGroupTotalBombardPower,
    shipGroupTotalDamage,
    shipGroupTotalFighterCount,
    shipGroupTotalFirepower,
    shipGroupTotalTroopSpaceRemaining,
} from '../fleets/shipGroupTasks';
import { assignMission, clearPreviousMissionRequirements, constructionQueueOf } from '../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, COORD_UNSET_DOUBLE, Sector, builtObjectMission, type MissionTarget, type StellarObject } from '../missions/mission';
import { assignLoadTroopsMission } from '../combat/troopsRuntime';
import { assignFleetUnloadTroops } from '../combat/invasion';
import { Fighter, FighterType, fightersOf, checkFightersAvailableForLaunch, identifyLatestBomberSpecification, identifyLatestFighterSpecification } from '../combat/fighters';
import { ShipAction, ShipActionType, createMissionShipAction, createShipAction, isSystemInfo, type Point } from './shipAction';
import {
    assignFleetLoadTroops,
    assignFleetSystemPatrol,
    findNearestShipYardBase,
    resolveBuildableFacilities,
    resolveBuildableFacilitiesPirates,
    resolveBuildableWonders,
    resolveCharactersValidForLocation,
    systemForStar,
    type ShipActionSelection,
} from './executeShipAction';

// ---------------------------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------------------------

/** One ToolStripMenuItem (or separator) of the action menu / a selection-panel button. */
export interface OrderMenuItem {
    /** GameText key of the text (the untranslated `TextResolver.GetText` argument), or the literal text. */
    key: string;
    /** The text the C# shows (formatted with the target's name / cost). */
    label: string;
    /** ShipAction.Hint (selection buttons) — why an entry is disabled, else a longer description. */
    hint: string | null;
    enabled: boolean;
    /** The ShipAction in the item's Tag; only items with one execute on click. */
    action: ShipAction | null;
    children: OrderMenuItem[];
    /** A ToolStripSeparator. */
    separator: boolean;
    /** method_354 idle-ships picker: the ship to select instead of an action. */
    select?: BuiltObject;
}

/** What the menu is built for: the player, the selection and the thing under the cursor. */
export interface OrderMenuContext {
    galaxy: Galaxy;
    /** _Game.PlayerEmpire. */
    empire: Empire;
    /** _Game.SelectedObject. */
    selected: ShipActionSelection;
    /** int_15 / int_16: the cursor in galaxy coordinates (ints). */
    cursorX: number;
    cursorY: number;
    /** double_0: the main view zoom (galaxy units per screen pixel; > 100 is the sector / galaxy level). */
    zoomFactor: number;
    /** Main.Part11.cs 1330 method_143(x, y, bool_28): the object under a galaxy point (bool_28: also far ships at galaxy zoom). */
    pickAt: (x: number, y: number, includeDistantShips: boolean) => unknown;
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers (text, type tests, C# helpers that are not in src/sim yet)
// ---------------------------------------------------------------------------------------------------------------

/** TextResolver.GetText(key), falling back to the key while no GameText table is loaded. */
function T(key: string): string {
    return tryGetText(key) ?? key;
}
/** string.Format(format, args). */
function F(format: string, ...args: unknown[]): string {
    return formatNet(format, args);
}
/** `x.ToString("######0")` / `"0"`: rounded to an integer, no grouping. */
function n0(x: number): string {
    return String(Math.round(x));
}
/** `x.ToString("###,###,##0")` (en-US grouping). */
function nGroup(x: number): string {
    return Math.round(x).toLocaleString('en-US');
}
/** `x.ToString("0.0")`. */
function n1(x: number): string {
    return x.toFixed(1);
}
/** `s.ToUpper(CultureInfo.InvariantCulture)`. */
function upper(s: string): string {
    return s.toUpperCase();
}

function isBuiltObject(o: unknown): o is BuiltObject {
    return o instanceof BuiltObject;
}
function isHabitat(o: unknown): o is Habitat {
    return o instanceof Habitat;
}
function isShipGroup(o: unknown): o is ShipGroup {
    return o instanceof ShipGroup;
}
function isCreature(o: unknown): o is Creature {
    return o instanceof Creature;
}
function isFacility(o: unknown): o is Facility {
    return o !== null && typeof o === 'object' && typeof (o as Facility).facilityId === 'number' && typeof (o as Facility).wonderType === 'number';
}
function isPlague(o: unknown): o is Plague {
    return o !== null && typeof o === 'object' && typeof (o as Plague).plagueId === 'number' && typeof (o as Plague).specialFunctionCode === 'number';
}
/** A StellarObject target (for MissionTarget / ActivityTarget arguments). */
function stellar(o: unknown): StellarObject | null {
    return isBuiltObject(o) || isHabitat(o) || isCreature(o) ? o : null;
}
function missionTarget(o: unknown): MissionTarget | null {
    if (isBuiltObject(o) || isHabitat(o) || isCreature(o) || isShipGroup(o) || o instanceof Sector) return o;
    return null;
}
function missionTypeOf(mission: unknown): BuiltObjectMissionType {
    const m = builtObjectMission(mission);
    return m === null ? BuiltObjectMissionType.Undefined : m.type;
}
function hasMission(mission: unknown): boolean {
    return missionTypeOf(mission) !== BuiltObjectMissionType.Undefined;
}
function hasConstructionYards(bo: BuiltObject | Habitat): boolean {
    const yards = constructionQueueOf(bo.constructionQueue)?.constructionYards ?? null;
    return yards !== null && yards.length > 0;
}
function shipGroupOf(bo: BuiltObject): ShipGroup | null {
    return isShipGroup(bo.shipGroup) ? bo.shipGroup : null;
}
function attackersOf(bo: BuiltObject): StellarObject[] {
    return (bo.attackers ?? []) as StellarObject[];
}
function nameOf(o: unknown): string {
    if (isBuiltObject(o) || isHabitat(o) || isCreature(o)) return o.name;
    if (isShipGroup(o)) return o.name ?? '';
    return '';
}
function playerShipGroups(empire: Empire): ShipGroup[] {
    return empireShipGroups(empire).filter((g): g is ShipGroup => g !== null);
}
/** Galaxy.MaxSolarSystemSize. */
function maxSolarSystemSize(galaxy: Galaxy): number {
    return galaxy.maxSolarSystemSize;
}
/** `(int)(Galaxy.MaxSolarSystemSize * 3.0)`: the range of the galaxy-zoom target sub-menus. */
function nearRange(galaxy: Galaxy): number {
    return Math.trunc(maxSolarSystemSize(galaxy) * 3.0);
}
/** empire.CheckSystemVisibilityStatus(systemIndex). */
function systemVisibility(empire: Empire, systemIndex: number): SystemVisibilityStatus {
    return empire.visibility.checkSystemVisibilityStatus(systemIndex);
}
/** Empire.IsObjectVisibleToThisEmpire for the StellarObject kinds the menus test. */
function visibleTo(ctx: { galaxy: Galaxy; empire: Empire }, o: BuiltObject | Habitat | Creature): boolean {
    // Empire.9.cs 3037 IsObjectVisibleToThisEmpire(Creature) (visibility.ts isCreatureVisible).
    if (isCreature(o)) return ctx.empire.visibility.isCreatureVisible(o);
    return isObjectVisibleToThisEmpire(ctx.galaxy, ctx.empire, o);
}

/** Galaxy.2.cs 2510 ResolveDescription(HabitatCategoryType). */
export function describeHabitatCategory(category: HabitatCategoryType): string {
    return tryGetText(`HabitatCategoryType ${HabitatCategoryType[category]}`) ?? splitString(HabitatCategoryType[category] ?? '');
}
/** Galaxy.2.cs 2523 ResolveDescription(HabitatType). */
export function describeHabitatType(type: HabitatType): string {
    return tryGetText(`HabitatType ${HabitatType[type]}`) ?? splitString(HabitatType[type] ?? '');
}
/** Galaxy.2.cs 2133 ResolveDescription(BuiltObjectSubRole). */
export function describeSubRole(subRole: BuiltObjectSubRole): string {
    return tryGetText(`Ship SubRole ${BuiltObjectSubRole[subRole]}`) ?? resolveSubRoleDescription(subRole);
}
/** Galaxy.2.cs 1977 ResolveDescription(CharacterRole): GetText of the split enum name ("Fleet Admiral", …). */
function describeCharacterRole(role: CharacterRole): string {
    return T(splitString(CharacterRole[role] ?? ''));
}
/** Galaxy.7.cs 5406 ResolveDescription(TroopType). */
function describeTroopType(type: TroopType): string {
    return tryGetText(`TroopType ${TroopType[type]}`) ?? splitString(TroopType[type] ?? '');
}

/** DesignList.cs 64 FindNewestIncludingObsolete(subRole, includePlanetDestroyers). */
function findNewestIncludingObsoletePD(designs: Design[], subRole: BuiltObjectSubRole, includePlanetDestroyers = true): Design | null {
    if (includePlanetDestroyers) return findNewestIncludingObsolete(designs, subRole);
    let num = 0;
    let result: Design | null = null;
    for (const design of designs) {
        if (design.subRole === subRole && !design.isPlanetDestroyer && design.dateCreated > num) {
            num = design.dateCreated;
            result = design;
        }
    }
    return result;
}

/** DesignList.cs 364 GetBuildablePlanetDestroyerDesigns(empire). */
function getBuildablePlanetDestroyerDesigns(designs: Design[], empire: Empire): Design[] {
    const result: Design[] = [];
    for (const design of designs) {
        if (design.role !== BuiltObjectRole.Base && design.isPlanetDestroyer && !design.isObsolete && canBuildDesign(empire, design)) result.push(design);
    }
    return result;
}
/** DesignList.cs 15 ContainsSubRole. */
function containsSubRole(designs: Design[], subRole: BuiltObjectSubRole): boolean {
    return designs.some((d) => d.subRole === subRole);
}

/**
 * DesignList.cs 214 FindNewestCanBuildFullEvaluate(subRole, colony, out missingTech, out sizeTooBig, includePlanetDestroyers)
 * with Empire.10.cs 430 CanBuildDesign's out reasons: the reasons are those of the last design CanBuildDesign ran on.
 */
function findNewestCanBuildFullEvaluateReasons(
    designs: Design[],
    subRole: BuiltObjectSubRole,
    colony: Habitat | null,
    includePlanetDestroyers: boolean,
): { design: Design | null; missingTech: boolean; sizeTooBig: boolean } {
    let missingTech = false;
    let sizeTooBig = false;
    for (const design3 of designs) {
        const owner = design3 !== null ? (design3.empire as Empire | null) : null;
        if (design3 !== null && design3.subRole === subRole && !design3.isObsolete && (design3.dateCreated > 0 || design3.optimizedDesign > 0) && owner !== null) {
            // CanBuildDesign(design3, true, colony, out, out) runs for every design that reaches it. The reasons only matter
            // when no design is found, and then num1 never left 0, so the pre-test is `DateCreated > 0 || OptimizedDesign > 0`.
            missingTech = !canBuildDesignTech(owner, design3);
            sizeTooBig = !missingTech && !checkDesignWithinConstructionSize(owner, design3, colony);
        }
    }
    const design = findNewestCanBuildFullEvaluate(designs, subRole, colony, includePlanetDestroyers);
    if (design !== null) {
        missingTech = false;
        sizeTooBig = false;
    }
    return { design, missingTech, sizeTooBig };
}

/** Empire.5.cs 3397 CheckTargetOfRepairMission: one port, civilianAI.ts. */
export { checkTargetOfRepairMission };

/** BuiltObject.cs 4378 CheckFightersNeedReturning. */
function checkFightersNeedReturning(bo: BuiltObject): boolean {
    const fighters = fightersOf(bo);
    if (fighters !== null) {
        for (const f of fighters) if (!f.onboardCarrier && !f.hasBeenDestroyed && f.specification.type === FighterType.Interceptor) return true;
    }
    return false;
}
/** BuiltObject.cs 4393 CheckBombersAvailableForLaunch. */
function checkBombersAvailableForLaunch(bo: BuiltObject): boolean {
    const fighters = fightersOf(bo);
    if (fighters !== null) {
        for (const f of fighters) if (f.onboardCarrier && f.health >= 1 && f.specification.type === FighterType.Bomber) return true;
    }
    return false;
}
/** BuiltObject.cs 4408 CheckBombersNeedReturning. */
function checkBombersNeedReturning(bo: BuiltObject): boolean {
    const fighters = fightersOf(bo);
    if (fighters !== null) {
        for (const f of fighters) if (!f.onboardCarrier && !f.hasBeenDestroyed && f.specification.type === FighterType.Bomber) return true;
    }
    return false;
}
/** FighterList.cs 14 TotalSize. */
function fightersTotalSize(bo: BuiltObject): number {
    let total = 0;
    for (const f of fightersOf(bo) ?? []) total += f.size;
    return total;
}

/** ShipGroup.cs TotalTroopAttackStrength etc. are on the fleet; BuiltObject.Troops.TotalAttackStrength. */
function troopAttackStrength(bo: BuiltObject): number {
    return bo.troops !== null ? bo.troops.totalAttackStrength : 0;
}

/** Empire.10.cs 4518 CanDeployXaraktorVirus(out xaraktorVirus, out cannotDeployReason). */
export function canDeployXaraktorVirus(galaxy: Galaxy, empire: Empire): { result: boolean; virus: Plague | null; reason: string } {
    let virus: Plague | null = null;
    let reason = '';
    const enabled = empire.research?.enabledPlagues ?? [];
    if (enabled.length > 0) {
        virus = ((enabled as unknown as Plague[]).find((p) => p.specialFunctionCode === 1) ?? null) as Plague | null; // GetFirstBySpecialFunctionCode(1)
        if (virus !== null) {
            if (empire.colonies.length > 0) {
                const num = countColoniesWithWonder(empire, WonderType.RaceAchievement, 2);
                if (num > 0) {
                    // Empire.10.cs 4532: CurrentDateTime.Subtract(LastXaraktorVirusDeploy).TotalSeconds > 150.0
                    if (spanSeconds(galaxyNow(galaxy), empire.lastXaraktorVirusDeploy) > 150.0) {
                        return { result: true, virus, reason };
                    }
                    reason = T('Cannot Deploy Xaraktor Virus - too soon');
                } else {
                    reason = T('Cannot Deploy Xaraktor Virus - no facility');
                }
            } else {
                reason = T('Cannot Deploy Xaraktor Virus - no facility');
            }
        }
    }
    return { result: false, virus, reason };
}
/** HabitatList.cs 211 CountColoniesWithFacilityType(Wonder, wonderType, value2) → PlanetaryFacilityList.cs 96 CountCompletedWonderByType. */
function countColoniesWithWonder(empire: Empire, wonderType: WonderType, value2: number): number {
    let num = 0;
    for (const habitat of empire.colonies) {
        if (habitat !== null && !habitat.hasBeenDestroyed && habitat.facilities !== null) {
            for (const f of habitat.facilities) {
                if (f.type === PlanetaryFacilityType.Wonder && f.def.wonderType === wonderType && f.constructionProgress >= 1.0 && f.def.value2 === value2) num++;
            }
        }
    }
    return num;
}

// ---------------------------------------------------------------------------------------------------------------
// Menu item factories (Main.Part8.cs 1395-1495 method_309-312)
// ---------------------------------------------------------------------------------------------------------------

function newItem(key: string, label: string, action: ShipAction | null = null): OrderMenuItem {
    return { key, label, hint: action?.hint ?? null, enabled: true, action, children: [], separator: false };
}
function separator(): OrderMenuItem {
    return { key: '', label: '', hint: null, enabled: false, action: null, children: [], separator: true };
}
/** `new ToolStripMenuItem(text) { Tag = action }` (the items the C# builds by hand). */
function leaf(key: string, label: string, action: ShipAction | null): OrderMenuItem {
    return newItem(key, label, action);
}

/**
 * Main.Part8.cs 1406 method_311(string_30, string_31, object_7, bool_28): an item whose text is string_30 formatted
 * with the target's name (a Habitat as "<category> <name>", an unexplored star / system as "Unknown star/system"),
 * string_31 for a ShipAction with no target but a click Position, or string_30 as is. With bool_28 the Tag is object_7.
 * `key30` / `key31` are the GameText keys of the two formats (for tests / localisation).
 */
function item311(ctx: OrderMenuContext, key30: string, fmt30: string, key31: string, fmt31: string, object7: unknown, bool28: boolean): OrderMenuItem {
    let label: string | null = null;
    let key = key30;
    let empty = '';
    let obj: unknown = object7;
    let isPoint = false;
    if (object7 instanceof ShipAction) {
        obj = object7.target;
        if (obj === null || obj === undefined) {
            obj = null;
            if (object7.position.x !== 0 && object7.position.y !== 0) {
                obj = object7.position;
                isPoint = true;
            } else {
                label = fmt30;
            }
        }
    }
    if (obj !== null && obj !== undefined) {
        if (isHabitat(obj)) {
            if (obj.category !== HabitatCategoryType.Star) {
                empty = describeHabitatCategory(obj.category) + ' ' + obj.name;
            } else {
                empty = systemVisibility(ctx.empire, obj.systemIndex) !== SystemVisibilityStatus.Unexplored ? obj.name : T('Unknown star');
            }
            label = F(fmt30, empty);
        } else if (isBuiltObject(obj) || isCreature(obj) || isShipGroup(obj)) {
            empty = nameOf(obj);
            label = F(fmt30, empty);
        } else if (!isSystemInfo(obj)) {
            if (isPoint) {
                label = F(fmt31, empty);
                key = key31;
            } else {
                label = fmt30;
            }
        } else {
            const systemInfo = obj;
            empty = systemVisibility(ctx.empire, systemInfo.systemStar.systemIndex) !== SystemVisibilityStatus.Unexplored ? systemInfo.systemStar.name : T('Unknown system');
            label = F(fmt30, empty);
        }
    }
    const action = bool28 && object7 instanceof ShipAction ? object7 : null;
    return newItem(key, label ?? fmt30, action);
}
/** Main.Part8.cs 1395 method_309(text, tag): method_311(text, "", tag, false) — a parent item (no Tag). */
function item309(ctx: OrderMenuContext, key: string, fmt: string, object7: unknown): OrderMenuItem {
    return item311(ctx, key, fmt, '', '', object7, false);
}
/** Main.Part8.cs 1400 method_310(text, tag, bool_28): method_311(text, "", tag, bool_28). */
function item310(ctx: OrderMenuContext, key: string, fmt: string, object7: unknown, bool28: boolean): OrderMenuItem {
    return item311(ctx, key, fmt, '', '', object7, bool28);
}
/** Main.Part8.cs 1484 method_312(text): an empty parent item. */
function item312(key: string, label: string): OrderMenuItem {
    return newItem(key, label, null);
}
/** A sub-item "Subrole: Design (1234 credits)" for a build design, disabled when it costs more than StateMoney. */
function designItem(ctx: OrderMenuContext, design: Design, action: ShipAction): OrderMenuItem {
    const price = design.calculateCurrentPurchasePrice(ctx.galaxy);
    const label = describeSubRole(design.subRole) + ': ' + design.name + ' (' + n0(price) + ' ' + T('credits') + ')';
    const item = leaf(design.name, label, action);
    if (price > ctx.empire.stateMoney) item.enabled = false;
    return item;
}

/** `new ShipAction(missionType, target)` (ShipAction.cs 59). */
function missionAction(missionType: BuiltObjectMissionType, target: unknown): ShipAction {
    return ShipAction.forMission(missionType, target);
}
/** `new ShipAction(missionType, target, offset, design)` (ShipAction.cs 45). */
function missionActionAt(missionType: BuiltObjectMissionType, target: unknown, offset: Point, design: Design | null): ShipAction {
    return ShipAction.forMissionAt(missionType, target, offset, design);
}
/** Main.Part8.cs 1506 method_315(missionType, target) with the context's cursor (int_15, int_16). */
function m315(ctx: OrderMenuContext, missionType: BuiltObjectMissionType, target: unknown): ShipAction {
    if (target !== null && target !== undefined) {
        let num = 0;
        let num2 = 0;
        let t: unknown = target;
        if (isHabitat(target)) {
            num = ctx.cursorX - Math.trunc(target.xpos);
            num2 = ctx.cursorY - Math.trunc(target.ypos);
        } else if (isSystemInfo(target)) {
            num = ctx.cursorX - Math.trunc(target.systemStar.xpos);
            num2 = ctx.cursorY - Math.trunc(target.systemStar.ypos);
            t = target.systemStar;
        } else if (isCreature(target)) {
            num = ctx.cursorX - Math.trunc(target.xpos);
            num2 = ctx.cursorY - Math.trunc(target.ypos);
        }
        return ShipAction.forMissionAt(missionType, t, { x: num, y: num2 }, null);
    }
    return ShipAction.forMissionAt(missionType, null, { x: ctx.cursorX, y: ctx.cursorY }, null);
}

// ---------------------------------------------------------------------------------------------------------------
// Target list helpers (Main.Part11.cs 1138-1283 method_133-139)
// ---------------------------------------------------------------------------------------------------------------

/** Main.Part11.cs 1138 method_133(x, y, range): fleets (lead ship) within range that the player can see, sorted. */
function fleetsNear(ctx: OrderMenuContext, x: number, y: number, range: number): ShipGroup[] {
    const list: ShipGroup[] = [];
    for (const empire of ctx.galaxy.empires) {
        for (const shipGroup of playerShipGroups(empire)) {
            const lead = shipGroup.leadShip;
            if (lead === null) continue;
            if (checkWithinDistancePotential(range, lead.xpos, lead.ypos, x, y)) {
                const num = ctx.galaxy.calculateDistance(lead.xpos, lead.ypos, x, y);
                if (Math.trunc(num) <= range && visibleTo(ctx, lead)) list.push(shipGroup);
            }
        }
    }
    netSort(list, compareShipGroups);
    return list;
}
/** The BuiltObjectIndex cell at (x, y) (Galaxy.ResolveIndex + BuiltObjectIndex[X][Y]). */
function builtObjectsInIndexCell(galaxy: Galaxy, x: number, y: number): BuiltObject[] {
    const idx = galaxy.resolveIndex(x, y);
    return galaxy.builtObjectIndexGrid[idx.x]?.[idx.y] ?? [];
}
/** Main.Part11.cs 1161 method_134(x, y, range): non-base ships in the index cell within range. */
function shipsNear(ctx: OrderMenuContext, x: number, y: number, range: number): BuiltObject[] {
    const list: BuiltObject[] = [];
    for (const bo of builtObjectsInIndexCell(ctx.galaxy, x, y)) {
        if (bo !== null && bo.role !== BuiltObjectRole.Base && checkWithinDistancePotential(range, bo.xpos, bo.ypos, x, y)) {
            const num = ctx.galaxy.calculateDistance(bo.xpos, bo.ypos, x, y);
            if (Math.trunc(num) <= range) list.push(bo);
        }
    }
    return list;
}
/** Main.Part11.cs 1180 method_135(x, y, range): bases in the index cell within range that the player can see. */
function basesNear(ctx: OrderMenuContext, x: number, y: number, range: number): BuiltObject[] {
    const list: BuiltObject[] = [];
    for (const bo of builtObjectsInIndexCell(ctx.galaxy, x, y)) {
        if (bo !== null && bo.role === BuiltObjectRole.Base && checkWithinDistancePotential(range, bo.xpos, bo.ypos, x, y)) {
            const num = ctx.galaxy.calculateDistance(bo.xpos, bo.ypos, x, y);
            if (Math.trunc(num) <= range && visibleTo(ctx, bo)) list.push(bo);
        }
    }
    return list;
}
/** Main.Part11.cs 1199/1204 method_136/137(x, y, range, includeIndependent): populated colonies of the nearest (seen) system. */
function coloniesNear(ctx: OrderMenuContext, x: number, y: number, range: number, includeIndependent = true): Habitat[] {
    const list: Habitat[] = [];
    const habitat = ctx.galaxy.fastFindNearestSystem(x, y);
    if (habitat === null) return list; // C# dereferences it (NullReferenceException) — never null in a real galaxy.
    const num = ctx.galaxy.calculateDistance(habitat.xpos, habitat.ypos, x, y);
    if (Math.trunc(num) <= range) {
        const status = systemVisibility(ctx.empire, habitat.systemIndex);
        if (status === SystemVisibilityStatus.Visible || status === SystemVisibilityStatus.Explored) {
            const systemInfo = ctx.galaxy.systems[habitat.systemIndex];
            if (systemInfo !== undefined && systemInfo !== null) {
                for (const habitat2 of planetsOf(systemInfo)) { // Main.Part11.cs 1217 systemInfo.Habitats: no star
                    if (habitat2.owner !== null && habitat2.owner !== ctx.galaxy.independentEmpire && habitat2.population.totalAmount > 0) {
                        list.push(habitat2);
                    } else if (includeIndependent && habitat2.owner === ctx.galaxy.independentEmpire && habitat2.population.totalAmount > 0) {
                        list.push(habitat2);
                    }
                }
            }
        }
    }
    return list;
}
/** Main.Part11.cs 1235 method_138(x, y, range, empire): populated habitats of the nearest system not owned by `empire`. */
function foreignPopulatedNear(ctx: OrderMenuContext, x: number, y: number, range: number, empire: Empire | null): Habitat[] {
    const list: Habitat[] = [];
    const habitat = ctx.galaxy.fastFindNearestSystem(x, y);
    if (habitat === null) return list;
    const num = ctx.galaxy.calculateDistance(habitat.xpos, habitat.ypos, x, y);
    if (Math.trunc(num) <= range) {
        const systemInfo = ctx.galaxy.systems[habitat.systemIndex];
        if (systemInfo !== undefined && systemInfo !== null) {
            for (const habitat2 of planetsOf(systemInfo)) { // Main.Part11.cs 1245 systemInfo.Habitats: no star
                if (habitat2 !== null && habitat2.population !== null && habitat2.population.items.length > 0 && (empire === null || habitat2.empire !== empire)) list.push(habitat2);
            }
        }
    }
    return list;
}
/** Main.Part11.cs 1258 method_139(ship, x, y, range): unowned habitats of the nearest system `ship` can colonize. */
function colonizableNear(ctx: OrderMenuContext, ship: BuiltObject, x: number, y: number, range: number): Habitat[] {
    const list: Habitat[] = [];
    const habitat = ctx.galaxy.fastFindNearestSystem(x, y);
    if (habitat === null) return list;
    const num = ctx.galaxy.calculateDistance(habitat.xpos, habitat.ypos, x, y);
    if (Math.trunc(num) <= range) {
        const systemInfo = ctx.galaxy.systems[habitat.systemIndex];
        if (systemInfo !== undefined && systemInfo !== null) {
            for (const habitat2 of planetsOf(systemInfo)) { // Main.Part11.cs 1268 systemInfo.Habitats: no star
                if (habitat2.owner === null || habitat2.owner === ctx.galaxy.independentEmpire) {
                    if (canBuiltObjectColonizeHabitat(ctx.galaxy, ctx.empire, ship, habitat2).result && canEmpireColonizeHabitatRange(ctx.galaxy, ctx.empire, habitat2)) list.push(habitat2);
                }
            }
        }
    }
    return list;
}
/** Main.Part11.cs 1285 method_140(ship): a player ship that can be multi-selected. */
export function isSelectablePlayerShip(empire: Empire, bo: BuiltObject): boolean {
    if (bo.empire !== empire) return false;
    if (bo.role === BuiltObjectRole.Base) return false;
    if (bo.owner === null) return false;
    if (bo.unbuiltComponentCount > 0) return false;
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-target builders (Main.Part8.cs 1537-2576 method_316-340)
// ---------------------------------------------------------------------------------------------------------------

const EMPIRE_NAME_COLLATOR = new Intl.Collator('en-US');

/** Main.Part8.cs 1537 method_316(ship): "Give to" → one entry per empire the player has met (not as a pirate) or has pirate relations with. */
function giveToMenu(ctx: OrderMenuContext, bo: BuiltObject | null): OrderMenuItem | null {
    let item: OrderMenuItem | null = null;
    if (bo !== null) {
        const player = ctx.empire;
        const empireList: Empire[] = [];
        if (player.pirateEmpireBaseHabitat === null) {
            for (const rel of player.diplomaticRelations) {
                if (rel.type !== DiplomaticRelationType.NotMet && rel.otherEmpire !== null && rel.otherEmpire !== player && !empireList.includes(rel.otherEmpire)) empireList.push(rel.otherEmpire);
            }
        }
        for (const rel of player.pirateRelations) {
            const other = rel.otherEmpire;
            if (rel.type !== 0 && other !== null && other !== player && !empireList.includes(other)) empireList.push(other);
        }
        netSort(empireList, (a, b) => EMPIRE_NAME_COLLATOR.compare(a.name, b.name)); // EmpireList.Sort (Empire.CompareTo = Name.CompareTo)
        if (empireList.length > 0) {
            item = item312('Give to', T('Give to'));
            for (const e of empireList) {
                const action = createShipAction(ShipActionType.GiveBuiltObject, bo);
                action.target2 = e;
                item.children.push(item311(ctx, e.name, e.name, e.name, e.name, action, true)); // + the empire's small flag image
            }
        }
    }
    return item;
}

/** Main.Part8.cs 1582 method_317(base): a foreign base — assign / cancel a mercenary attack mission. */
function pirateAttackMissionItem(ctx: OrderMenuContext, bo: BuiltObject | null): OrderMenuItem | null {
    let result: OrderMenuItem | null = null;
    if (bo !== null && bo.role === BuiltObjectRole.Base && bo.empire !== ctx.empire) {
        if (!ctx.empire.pirateMissions.containsEquivalentTarget(bo, EmpireActivityType.Attack)) {
            const action = createShipAction(ShipActionType.GeneratePirateMissionAttack, bo);
            const text = F(T('Assign Mercenary Attack Mission'), bo.name, n0(calculatePirateAttackPrice(ctx.galaxy, ctx.empire, bo)));
            result = item311(ctx, 'Assign Mercenary Attack Mission', text, 'Assign Mercenary Attack Mission', text, action, true);
        } else if (ctx.galaxy.pirateMissions.containsEquivalentTarget(bo, EmpireActivityType.Attack)) {
            const text2 = F(T('Cancel Mercenary Attack Mission'), bo.name);
            const action2 = createShipAction(ShipActionType.GeneratePirateMissionAttack, bo);
            result = item311(ctx, 'Cancel Mercenary Attack Mission', text2, 'Cancel Mercenary Attack Mission', text2, action2, true);
        }
    }
    return result;
}

/** Main.Part8.cs 1603 method_318(colony) / 1624 method_319(base): an own colony / base — assign / cancel a mercenary defense mission. */
function pirateDefendMissionItem(ctx: OrderMenuContext, target: Habitat | BuiltObject | null): OrderMenuItem | null {
    let result: OrderMenuItem | null = null;
    const applies = target !== null && (isHabitat(target) ? target.empire === ctx.empire : target.role === BuiltObjectRole.Base && target.empire === ctx.empire);
    if (applies && target !== null) {
        if (!ctx.empire.pirateMissions.containsEquivalentTarget(target, EmpireActivityType.Defend)) {
            const action = createShipAction(ShipActionType.GeneratePirateMissionDefend, target);
            const text = F(T('Assign Mercenary Defense Mission'), target.name, n0(calculatePirateDefendPrice(ctx.galaxy, ctx.empire, target)));
            result = item311(ctx, 'Assign Mercenary Defense Mission', text, 'Assign Mercenary Defense Mission', text, action, true);
        } else if (ctx.galaxy.pirateMissions.containsEquivalentTarget(target, EmpireActivityType.Defend)) {
            const text2 = F(T('Cancel Mercenary Defense Mission'), target.name);
            const action2 = createShipAction(ShipActionType.GeneratePirateMissionDefend, target);
            result = item311(ctx, 'Cancel Mercenary Defense Mission', text2, 'Cancel Mercenary Defense Mission', text2, action2, true);
        }
    }
    return result;
}

/** Main.Part8.cs 1645 method_320(colony): an own colony — a mercenary smuggling mission for all / one resource, or cancel it. */
function pirateSmugglingMissionItem(ctx: OrderMenuContext, habitat: Habitat | null): OrderMenuItem | null {
    let item: OrderMenuItem | null = null;
    if (habitat !== null && habitat.empire === ctx.empire) {
        if (!ctx.empire.pirateMissions.containsEquivalentTarget(habitat, EmpireActivityType.Smuggle)) {
            let text = F(T('Assign Mercenary Smuggling Mission'), habitat.name);
            item = item312('Assign Mercenary Smuggling Mission', text);
            let action = createShipAction(ShipActionType.GeneratePirateMissionSmuggling, habitat);
            action.target2 = 255; // byte.MaxValue: all resources
            text = F(T('Smuggling Mission for RESOURCE for PRICE'), '100.0', T('All Resources'));
            item.children.push(item311(ctx, 'Smuggling Mission for RESOURCE for PRICE', text, '', text, action, true));
            for (const resource of ctx.galaxy.resourceSystem.resources) {
                action = createShipAction(ShipActionType.GeneratePirateMissionSmuggling, habitat);
                action.target2 = resource.resourceId;
                const num = calculatePirateSmugglePricePerUnit(ctx.galaxy, ctx.empire, habitat, resource.resourceId);
                text = F(T('Smuggling Mission for RESOURCE for PRICE'), n1(num * 100.0), resource.name);
                item.children.push(item311(ctx, 'Smuggling Mission for RESOURCE for PRICE', text, '', text, action, true));
            }
        } else {
            const text2 = F(T('Cancel Mercenary Smuggling Mission'), habitat.name);
            const action2 = createShipAction(ShipActionType.GeneratePirateMissionSmuggling, habitat);
            action2.target2 = 255;
            item = item311(ctx, 'Cancel Mercenary Smuggling Mission', text2, '', text2, action2, true);
        }
    }
    return item;
}

/** Main.Part8.cs 1680 method_321(fleet): "Transfer Character to <fleet>" — the player's admirals / generals / pirate leaders not already with it. */
function transferCharacterToFleetMenu(ctx: OrderMenuContext, shipGroup: ShipGroup): OrderMenuItem | null {
    const action = createShipAction(ShipActionType.TransferCharacter, shipGroup.leadShip);
    const text = F(T('Transfer Character to LOCATION'), shipGroup.name ?? '');
    const item = item311(ctx, 'Transfer Character to LOCATION', text, '', '', action, false);
    const characterList: Character[] = [];
    let characterList2: Character[] = [];
    if (shipGroup !== null && shipGroup.empire === ctx.empire && shipGroup.empire.characters !== null) {
        const characters = shipGroup.empire.characters as Character[];
        characterList2 = getFleetAdmiralsAndGenerals(characters, shipGroup);
        characterList.push(...getNonTransferringCharacters(characters, CharacterRole.FleetAdmiral));
        characterList.push(...getNonTransferringCharacters(characters, CharacterRole.TroopGeneral));
        characterList.push(...getNonTransferringCharacters(characters, CharacterRole.PirateLeader));
    }
    for (const character of characterList) {
        if (characterList2.includes(character)) continue;
        const action2 = action.clone();
        action2.target2 = character;
        if (character.role === CharacterRole.TroopGeneral) {
            const builtObject = shipGroupDetermineStrongestTroopTransport(shipGroup);
            if (builtObject !== null) action2.target = builtObject;
        }
        item.children.push(leaf(character.name, character.name + '  (' + describeCharacterRole(character.role) + ')', action2));
    }
    return characterList.length <= 0 ? null : item;
}

/** Main.Part8.cs 1724 method_322(location): "Transfer Character to <location>" — Galaxy.ResolveCharactersValidForLocation. */
function transferCharacterToLocationMenu(ctx: OrderMenuContext, location: BuiltObject | Habitat): OrderMenuItem | null {
    const action = createShipAction(ShipActionType.TransferCharacter, location);
    const text = F(T('Transfer Character to LOCATION'), location.name);
    const item = item311(ctx, 'Transfer Character to LOCATION', text, '', '', action, false);
    const characterList = resolveCharactersValidForLocation(ctx.galaxy, location, ctx.empire);
    for (const character of characterList) {
        const action2 = action.clone();
        action2.target2 = character;
        item.children.push(leaf(character.name, character.name + '  (' + describeCharacterRole(character.role) + ')', action2));
    }
    return characterList.length <= 0 ? null : item;
}

/** One "Build here" design entry with the SelectRelativePoint offset around a target habitat (Main.Part8.cs 1832-1848). */
function buildHereDesignItem(ctx: OrderMenuContext, design: Design, base: ShipAction, habitat: Habitat | null): OrderMenuItem {
    const action = base.clone();
    action.design = design;
    if (habitat !== null) {
        action.target = habitat;
        const p = ctx.galaxy.selectRelativePoint(habitat.diameter / 2.5); // Rnd
        action.position = { x: Math.trunc(p.x), y: Math.trunc(p.y) };
    }
    return designItem(ctx, design, action);
}

/** Main.Part8.cs 1748 method_323(constructionShip): "Build here" at the cursor (galaxy zoom): bases the ship can build there. */
function buildHereMenu(ctx: OrderMenuContext, bo: BuiltObject): OrderMenuItem | null {
    const action = m315(ctx, BuiltObjectMissionType.Build, null);
    const item = item311(ctx, 'Build here', T('Build here'), 'Build here', T('Build here'), action, false);
    const obj = ctx.pickAt(ctx.cursorX, ctx.cursorY, true);
    let flag = false;
    const empire = bo.empire!;
    if (ctx.empire.pirateEmpireBaseHabitat !== null) {
        let habitat: Habitat | null = null;
        let flag2 = true;
        const list: BuiltObjectSubRole[] = [];
        if (obj !== null && (isHabitat(obj) || isSystemInfo(obj))) {
            let flag3 = true;
            let flag4 = true;
            if (isHabitat(obj)) {
                const habitat2 = obj;
                if (habitat2.population !== null && habitat2.population.items.length > 0 && habitat2.empire !== ctx.empire) {
                    flag3 = false;
                    flag4 = false;
                    flag2 = false;
                }
                if (checkAlreadyHaveMiningStationAtHabitat(habitat2, empire)) flag4 = false;
                if (determineSpacePortAtHabitat(habitat2) !== null) flag3 = false;
                habitat = habitat2;
            } else {
                const systemInfo = obj;
                if (systemInfo.systemStar !== null && systemInfo.systemStar.category === HabitatCategoryType.GasCloud) {
                    if (checkAlreadyHaveMiningStationAtHabitat(systemInfo.systemStar, empire)) flag4 = false;
                    if (determineSpacePortAtHabitat(systemInfo.systemStar) !== null) flag3 = false;
                    habitat = systemInfo.systemStar;
                }
            }
            if (flag3) list.push(BuiltObjectSubRole.SmallSpacePort, BuiltObjectSubRole.MediumSpacePort, BuiltObjectSubRole.LargeSpacePort);
            if (flag4) list.push(BuiltObjectSubRole.MiningStation, BuiltObjectSubRole.GasMiningStation);
        }
        if (flag2) list.push(BuiltObjectSubRole.ResortBase, BuiltObjectSubRole.GenericBase, BuiltObjectSubRole.MonitoringStation, BuiltObjectSubRole.DefensiveBase);
        const designs = getBuildableDesignsBySubRoles(empire.designs, list, ctx.empire);
        const destroyers = getBuildablePlanetDestroyerDesigns(empire.designs, ctx.empire);
        if (destroyers.length > 0) designs.push(...destroyers);
        for (const design of designs) {
            if (canBuildDesign(empire, design) && design.size <= ctx.empire.maximumConstructionSizeBase(design.subRole)) {
                flag = true;
                item.children.push(buildHereDesignItem(ctx, design, action, habitat));
            }
        }
    } else if (checkEmpireTerritoryCanBuildAtLocation(ctx.galaxy, empire, ctx.cursorX, ctx.cursorY)) {
        let habitat3: Habitat | null = null;
        const list2: BuiltObjectSubRole[] = [];
        if (obj !== null && (isHabitat(obj) || isSystemInfo(obj))) {
            let flag5 = true;
            if (isHabitat(obj)) {
                if (checkAlreadyHaveMiningStationAtHabitat(obj, empire)) flag5 = false;
                habitat3 = obj;
            } else {
                const systemInfo2 = obj;
                if (systemInfo2.systemStar !== null && systemInfo2.systemStar.category === HabitatCategoryType.GasCloud) {
                    if (checkAlreadyHaveMiningStationAtHabitat(systemInfo2.systemStar, empire)) flag5 = false;
                    habitat3 = systemInfo2.systemStar;
                }
            }
            if (flag5) list2.push(BuiltObjectSubRole.MiningStation, BuiltObjectSubRole.GasMiningStation);
        }
        list2.push(
            BuiltObjectSubRole.ResortBase,
            BuiltObjectSubRole.GenericBase,
            BuiltObjectSubRole.EnergyResearchStation,
            BuiltObjectSubRole.WeaponsResearchStation,
            BuiltObjectSubRole.HighTechResearchStation,
            BuiltObjectSubRole.MonitoringStation,
            BuiltObjectSubRole.DefensiveBase,
        );
        const designs2 = getBuildableDesignsBySubRoles(empire.designs, list2, ctx.empire);
        const destroyers2 = getBuildablePlanetDestroyerDesigns(empire.designs, ctx.empire);
        if (destroyers2.length > 0) designs2.push(...destroyers2);
        for (const design2 of designs2) {
            if (canBuildDesign(empire, design2) && design2.size <= ctx.empire.maximumConstructionSizeBase(design2.subRole)) {
                flag = true;
                item.children.push(buildHereDesignItem(ctx, design2, action, habitat3));
            }
        }
    }
    return flag ? item : null;
}

/** Main.Part8.cs 1931 method_324(): "Move to" at galaxy zoom — the nearest system, then nearby colonies and bases. */
function moveToMenu(ctx: OrderMenuContext): OrderMenuItem | null {
    const num = nearRange(ctx.galaxy);
    const item = item312('Move to', T('Move to'));
    const habitat = ctx.galaxy.fastFindNearestSystem(ctx.cursorX, ctx.cursorY);
    if (habitat !== null) {
        const status = systemVisibility(ctx.empire, habitat.systemIndex);
        const tag = missionAction(BuiltObjectMissionType.Move, habitat);
        let empty = status !== SystemVisibilityStatus.Unexplored ? habitat.name : T('Unknown');
        switch (habitat.category) {
            case HabitatCategoryType.GasCloud:
                empty = empty + ' ' + T('Gas Cloud');
                break;
            case HabitatCategoryType.Star:
                empty = empty + ' ' + T('System');
                break;
        }
        item.children.push(leaf(habitat.name, empty, tag));
    }
    for (const h of coloniesNear(ctx, ctx.cursorX, ctx.cursorY, num)) item.children.push(leaf(h.name, h.name, missionAction(BuiltObjectMissionType.Move, h)));
    for (const b of basesNear(ctx, ctx.cursorX, ctx.cursorY, num)) item.children.push(leaf(b.name, b.name, missionAction(BuiltObjectMissionType.Move, b)));
    return item.children.length === 0 ? null : item;
}

/** "<name> (<empire or Lost/Abandoned>)". */
function ownedLabel(name: string, empire: Empire | null, noEmpireKey: string): string {
    return name + ' (' + (empire !== null ? empire.name : T(noEmpireKey)) + ')';
}

/** Main.Part8.cs 1985 method_325() / 1990 method_326(missionType): "Bombard" / "Prepare and Bombard" — nearby foreign colonies. */
function bombardMenu(ctx: OrderMenuContext, missionType: BuiltObjectMissionType): OrderMenuItem | null {
    const range = nearRange(ctx.galaxy);
    m315(ctx, missionType, null); // result unused in the C#
    const key = missionType === BuiltObjectMissionType.Bombard ? 'Bombard' : 'Prepare and Bombard';
    const item = item312(key, T(key));
    for (const h of coloniesNear(ctx, ctx.cursorX, ctx.cursorY, range)) {
        if (h.empire !== ctx.empire) item.children.push(leaf(h.name, ownedLabel(h.name, h.empire, 'Lost'), missionAction(missionType, h)));
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2031 method_327(): "Capture" — nearby foreign (non-independent) bases. */
function captureMenu(ctx: OrderMenuContext): OrderMenuItem | null {
    const range = nearRange(ctx.galaxy);
    m315(ctx, BuiltObjectMissionType.Capture, null);
    const item = item312('Capture', T('Capture'));
    for (const b of basesNear(ctx, ctx.cursorX, ctx.cursorY, range)) {
        if (b.empire !== ctx.empire && b.empire !== ctx.galaxy.independentEmpire) item.children.push(leaf(b.name, ownedLabel(b.name, b.empire, 'Abandoned'), missionAction(BuiltObjectMissionType.Capture, b)));
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2064 method_328(): "Raid" (pirates only) — nearby foreign populated habitats and bases (a base still in its raid countdown is disabled). */
function raidMenu(ctx: OrderMenuContext): OrderMenuItem | null {
    const num = nearRange(ctx.galaxy);
    m315(ctx, BuiltObjectMissionType.Raid, null);
    const item = item312('Raid', T('Raid'));
    if (ctx.empire.pirateEmpireBaseHabitat !== null) {
        for (const h of foreignPopulatedNear(ctx, ctx.cursorX, ctx.cursorY, num, ctx.empire)) {
            if (h.empire !== ctx.empire) item.children.push(leaf(h.name, ownedLabel(h.name, h.empire, 'Abandoned'), missionAction(BuiltObjectMissionType.Raid, h)));
        }
        for (const b of basesNear(ctx, ctx.cursorX, ctx.cursorY, num)) {
            if (b.empire !== ctx.empire && b.empire !== ctx.galaxy.independentEmpire) {
                const it = leaf(b.name, ownedLabel(b.name, b.empire, 'Abandoned'), missionAction(BuiltObjectMissionType.Raid, b));
                if (b.raidCountdown > 0) it.enabled = false;
                item.children.push(it);
            }
        }
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2121 method_329() / 2126 method_330(missionType): "Attack" / "Prepare and Attack" — nearby foreign colonies, bases and fleets. */
function attackMenu(ctx: OrderMenuContext, missionType: BuiltObjectMissionType): OrderMenuItem | null {
    const num = nearRange(ctx.galaxy);
    m315(ctx, missionType, null);
    const key = missionType === BuiltObjectMissionType.Attack ? 'Attack' : 'Prepare and Attack';
    const item = item312(key, T(key));
    for (const h of coloniesNear(ctx, ctx.cursorX, ctx.cursorY, num)) {
        if (h.empire !== ctx.empire) item.children.push(leaf(h.name, ownedLabel(h.name, h.empire, 'Lost'), missionAction(missionType, h)));
    }
    for (const b of basesNear(ctx, ctx.cursorX, ctx.cursorY, num)) {
        if (b.empire !== ctx.empire && b.empire !== ctx.galaxy.independentEmpire) item.children.push(leaf(b.name, ownedLabel(b.name, b.empire, 'Abandoned'), missionAction(missionType, b)));
    }
    for (const g of fleetsNear(ctx, ctx.cursorX, ctx.cursorY, num)) {
        if (g.empire !== ctx.empire) item.children.push(leaf(g.name ?? '', ownedLabel(g.name ?? '', g.empire, 'Abandoned'), missionAction(missionType, g)));
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2201 method_331() / 2206 method_332(missionType): troop "Attack" — nearby foreign colonies only. */
function troopAttackMenu(ctx: OrderMenuContext, missionType: BuiltObjectMissionType): OrderMenuItem | null {
    const range = nearRange(ctx.galaxy);
    const key = missionType === BuiltObjectMissionType.Attack ? 'Attack' : 'Prepare and Attack';
    const item = item312(key, T(key));
    for (const h of coloniesNear(ctx, ctx.cursorX, ctx.cursorY, range)) {
        if (h.empire !== ctx.empire) item.children.push(leaf(h.name, h.name, missionAction(missionType, h)));
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2241 method_333(): "Patrol" — the system under the cursor, own colonies and bases nearby. */
function patrolMenu(ctx: OrderMenuContext): OrderMenuItem | null {
    const num = nearRange(ctx.galaxy);
    const item = item312('Patrol', T('Patrol'));
    const obj = ctx.pickAt(ctx.cursorX, ctx.cursorY, false);
    if (obj !== null && isSystemInfo(obj)) {
        item.children.push(leaf(obj.systemStar.name, obj.systemStar.name + ' ' + T('system'), missionAction(BuiltObjectMissionType.Patrol, obj)));
    }
    for (const h of coloniesNear(ctx, ctx.cursorX, ctx.cursorY, num)) {
        if (h.empire === ctx.empire) item.children.push(leaf(h.name, h.name, missionAction(BuiltObjectMissionType.Patrol, h)));
    }
    for (const b of basesNear(ctx, ctx.cursorX, ctx.cursorY, num)) {
        if (b.empire === ctx.empire) item.children.push(leaf(b.name, b.name, missionAction(BuiltObjectMissionType.Patrol, b)));
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2290 method_334(): "Blockade" — nearby foreign colonies (no independents) and bases the player may blockade. */
function blockadeMenu(ctx: OrderMenuContext): OrderMenuItem | null {
    const num = nearRange(ctx.galaxy);
    const item = item312('Blockade', T('Blockade'));
    for (const h of coloniesNear(ctx, ctx.cursorX, ctx.cursorY, num, false)) {
        if (h.empire !== ctx.empire && canSendShipToBlockadeColony(ctx.galaxy, ctx.empire, h)) item.children.push(leaf(h.name, ownedLabel(h.name, h.empire, 'Lost'), missionAction(BuiltObjectMissionType.Blockade, h)));
    }
    for (const b of basesNear(ctx, ctx.cursorX, ctx.cursorY, num)) {
        if (b.empire !== ctx.empire && canSendShipToBlockadeBuiltObject(ctx.galaxy, ctx.empire, b)) item.children.push(leaf(b.name, ownedLabel(b.name, b.empire, 'Abandoned'), missionAction(BuiltObjectMissionType.Blockade, b)));
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2339 method_335(): "Colonize" — explored unowned habitats of the nearest system the selected colony ship can settle. */
function colonizeMenu(ctx: OrderMenuContext): OrderMenuItem | null {
    const range = nearRange(ctx.galaxy);
    const item = item312('Colonize', T('Colonize'));
    if (isBuiltObject(ctx.selected)) {
        for (const h of colonizableNear(ctx, ctx.selected, ctx.cursorX, ctx.cursorY, range)) {
            if (h !== null && ctx.empire.visibility.checkSystemExplored(h.systemIndex) && h.owner !== ctx.empire) item.children.push(leaf(h.name, h.name, missionAction(BuiltObjectMissionType.Colonize, h)));
        }
    }
    return item.children.length === 0 ? null : item;
}

// Main.Part8.cs 2370 method_336() ("Refuel at" nearby own depots) has no caller in the C#; not ported.

/** Main.Part8.cs 2409 method_337(): "Escort" — the player's construction / colony / exploration ships nearby. */
function escortMenu(ctx: OrderMenuContext): OrderMenuItem | null {
    const range = nearRange(ctx.galaxy);
    const item = item312('Escort', T('Escort'));
    for (const b of shipsNear(ctx, ctx.cursorX, ctx.cursorY, range)) {
        if (b.owner === ctx.empire && (b.role === BuiltObjectRole.Build || b.role === BuiltObjectRole.Colony || b.role === BuiltObjectRole.Exploration)) item.children.push(leaf(b.name, b.name, missionAction(BuiltObjectMissionType.Escort, b)));
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2436 method_338(ship, bool_28): "Load Troops" — own colonies with ungarrisoned troops, invaded colonies with the player's troops, the nearest colony with spare troops. */
function loadTroopsMenu(ctx: OrderMenuContext, bo: BuiltObject | null, forFleet: boolean): OrderMenuItem | null {
    const range = nearRange(ctx.galaxy);
    const item = item312('Load Troops', T('Load Troops'));
    for (const h of coloniesNear(ctx, ctx.cursorX, ctx.cursorY, range)) {
        if (h.owner === ctx.empire) {
            if (h.troops === null || h.troops.count <= 0) continue;
            for (const troop of h.troops.items) {
                if (troop !== null && troop.empire === ctx.empire && !troop.garrisoned) {
                    item.children.push(leaf('At X', F(T('At X'), h.name), missionAction(BuiltObjectMissionType.LoadTroops, h)));
                    break;
                }
            }
        } else {
            const inv = h.invadingTroops;
            if (h.owner === ctx.empire || inv === null || inv.count <= 0 || inv.items[0].empire !== ctx.empire) continue;
            for (const troop of inv.items) {
                if (troop !== null && troop.empire === ctx.empire) {
                    item.children.push(leaf('At X', F(T('At X'), h.name), missionAction(BuiltObjectMissionType.LoadTroops, h)));
                    break;
                }
            }
        }
    }
    // C# dereferences builtObject_8.Empire (the fleet's lead ship for method_344's ShipGroup branch).
    const owner = bo?.empire ?? null;
    const habitat = owner !== null ? findNearestColonyWithExcessTroops(ctx.galaxy, owner, bo, false, false).habitat : null;
    if (habitat !== null) {
        let tag = missionAction(BuiltObjectMissionType.LoadTroops, habitat);
        if (forFleet) tag = missionAction(BuiltObjectMissionType.LoadTroops, null);
        item.children.push(leaf('At nearest colony with available troops', T('At nearest colony with available troops'), tag));
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2506 method_339(): "Unload Troops at" — the first own colony nearby. */
function unloadTroopsMenu(ctx: OrderMenuContext): OrderMenuItem | null {
    const range = nearRange(ctx.galaxy);
    const item = item312('Unload Troops at', T('Unload Troops at'));
    for (const h of coloniesNear(ctx, ctx.cursorX, ctx.cursorY, range)) {
        if (h.empire === ctx.empire) {
            item.children.push(leaf(h.name, h.name, missionAction(BuiltObjectMissionType.UnloadTroops, h)));
            break;
        }
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2534 method_340(): "Change Colony Tax" ±5 / ±1 % for the first own colony nearby. */
function colonyTaxMenu(ctx: OrderMenuContext): OrderMenuItem | null {
    const item = item312('Change Colony Tax', T('Change Colony Tax'));
    const range = nearRange(ctx.galaxy);
    for (const h of coloniesNear(ctx, ctx.cursorX, ctx.cursorY, range)) {
        if (h.empire === ctx.empire) {
            item.children.push(leaf('+5%', '+5%', createShipAction(ShipActionType.ColonyTaxUp5, h)));
            item.children.push(leaf('+1%', '+1%', createShipAction(ShipActionType.ColonyTaxUp1, h)));
            item.children.push(leaf('-1%', '-1%', createShipAction(ShipActionType.ColonyTaxDown1, h)));
            item.children.push(leaf('-5%', '-5%', createShipAction(ShipActionType.ColonyTaxDown5, h)));
            break;
        }
    }
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 2577 method_341(item): mark every action in the sub-tree as queued (IsSubsequentAction). */
function markSubsequent(item: OrderMenuItem): void {
    if (item.action !== null) item.action.isSubsequentAction = true;
    for (const child of item.children) if (!child.separator) markSubsequent(child);
}

function pushIf(list: OrderMenuItem[], item: OrderMenuItem | null): boolean {
    if (item === null) return false;
    list.push(item);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Sub-menus repeated verbatim in method_342 / 343 / 344
// ---------------------------------------------------------------------------------------------------------------

/** `habitat = FastFindNearestSystem(int_15, int_16); if (CalculateDistance(...) > MaxSolarSystemSize) habitat = null`. */
function nearestSystemAtCursor(ctx: OrderMenuContext): Habitat | null {
    const habitat = ctx.galaxy.fastFindNearestSystem(ctx.cursorX, ctx.cursorY);
    if (habitat === null) return null;
    const num = ctx.galaxy.calculateDistance(ctx.cursorX, ctx.cursorY, habitat.xpos, habitat.ypos);
    return num > maxSolarSystemSize(ctx.galaxy) ? null : habitat;
}

/** A clone of `base` with Target = target, as a method_310(text, action, true) item. */
function targetItem(ctx: OrderMenuContext, key: string, fmt: string, base: ShipAction, target: unknown): OrderMenuItem {
    const action = base.clone();
    action.target = target;
    return item310(ctx, key, fmt, action, true);
}

/** The "All systems in sector X" explore entry (method_344 only). */
function exploreSectorItem(ctx: OrderMenuContext, bo: BuiltObject, base: ShipAction): OrderMenuItem | null {
    const sector = resolveSector(ctx.galaxy, ctx.cursorX, ctx.cursorY);
    const actual = bo.actualEmpire;
    const habitat = actual !== null ? fastFindNearestUnexploredHabitatInSector(ctx.galaxy, bo.xpos, bo.ypos, actual, sector) : null;
    if (habitat === null) return null;
    const text = F(T('All systems in sector X'), resolveSectorDescription(ctx.galaxy, ctx.cursorX, ctx.cursorY));
    return targetItem(ctx, 'All systems in sector X', text, base, sector);
}

/** "Explore" at galaxy zoom (method_342 2676-2703 / method_344 4236-4270): this system, the nearest unexplored system[, the sector]. */
function exploreMenuFar(ctx: OrderMenuContext, bo: BuiltObject, obj: unknown, withSector: boolean): OrderMenuItem {
    const habitat = nearestSystemAtCursor(ctx);
    const item = item309(ctx, 'Explore', T('Explore'), BuiltObjectMissionType.Explore);
    const base = createMissionShipAction(BuiltObjectMissionType.Explore);
    if (habitat !== null) {
        item.children.push(targetItem(ctx, 'This system', T('This system') + ' ({0})', base, habitat));
    } else if (obj !== null && isSystemInfo(obj)) {
        item.children.push(targetItem(ctx, 'This system', T('This system') + ' ({0})', base, obj.systemStar));
    }
    let habitat2 = fastFindNearestUnexploredHabitat(ctx.galaxy, bo.xpos, bo.ypos, bo.actualEmpire);
    if (habitat2 !== null) {
        habitat2 = ctx.galaxy.determineHabitatSystemStar(habitat2);
        item.children.push(targetItem(ctx, 'Nearest unexplored system', T('Nearest unexplored system'), base, habitat2));
    }
    if (withSector) pushIf(item.children, exploreSectorItem(ctx, bo, base));
    return item;
}

/** "Explore" at system zoom (method_342 2823-2856 / method_344 4417-4460): the habitat, this system, the nearest unexplored system[, the sector]. */
function exploreMenuNear(ctx: OrderMenuContext, bo: BuiltObject, obj: unknown, nearest: Habitat | null, withSector: boolean): OrderMenuItem {
    const item = item309(ctx, 'Explore', T('Explore'), BuiltObjectMissionType.Explore);
    const base = createMissionShipAction(BuiltObjectMissionType.Explore);
    if (obj !== null && isHabitat(obj)) item.children.push(targetItem(ctx, '{0}', '{0}', base, obj));
    if (nearest !== null) {
        item.children.push(targetItem(ctx, 'This system', T('This system') + ' ({0})', base, nearest));
    } else if (obj !== null && isSystemInfo(obj)) {
        item.children.push(targetItem(ctx, 'This system', T('This system') + ' ({0})', base, obj.systemStar));
    }
    const actual = bo.actualEmpire;
    let habitat5 = actual !== null ? findNearestUnexploredHabitat(ctx.galaxy, bo.xpos, bo.ypos, actual.visibility, true) : null;
    if (habitat5 !== null) {
        habitat5 = ctx.galaxy.determineHabitatSystemStar(habitat5);
        item.children.push(targetItem(ctx, 'Nearest unexplored system', T('Nearest unexplored system'), base, habitat5));
    }
    if (withSector) pushIf(item.children, exploreSectorItem(ctx, bo, base));
    return item;
}

/** "Repair" (…): at the ship yard under the cursor, at the nearest ship yard. Added only when it has entries. */
function repairMenu(ctx: OrderMenuContext, key: string, ship: BuiltObject, empire: Empire, obj: unknown, self: unknown, includeVerySmallYards: boolean): OrderMenuItem | null {
    const item = item309(ctx, key, T(key), BuiltObjectMissionType.Repair);
    const base = createMissionShipAction(BuiltObjectMissionType.Repair);
    if (obj !== null && isBuiltObject(obj) && obj.empire === empire && obj.isShipYard && self !== obj) item.children.push(targetItem(ctx, 'At X', T('At X'), base, obj));
    const yard = findNearestShipYard(ctx.galaxy, empire, ship, true, includeVerySmallYards);
    if (yard !== null) item.children.push(targetItem(ctx, 'At nearest ship yard', T('At nearest ship yard'), base, yard));
    return item.children.length > 0 ? item : null;
}

/** The depot under the cursor's owner: `obj is BuiltObject ? Empire : obj is Habitat ? Empire : null`. */
function refuelingEmpireOf(obj: unknown): Empire | null {
    if (isBuiltObject(obj)) return obj.empire;
    if (isHabitat(obj)) return obj.empire;
    return null;
}
function isRefuellingDepot(obj: unknown): boolean {
    return (isBuiltObject(obj) && obj.isRefuellingDepot) || (isHabitat(obj) && obj.isRefuellingDepot);
}

/** A ship's "Refuel": at the depot under the cursor (method_344 also checks CheckEmpireCanRefuelAtEmpire), at the nearest refuelling point. */
function shipRefuelMenu(ctx: OrderMenuContext, bo: BuiltObject, obj: unknown, checkRefuelRights: boolean): OrderMenuItem | null {
    const item = item309(ctx, 'Refuel', T('Refuel'), BuiltObjectMissionType.Refuel);
    const base = createMissionShipAction(BuiltObjectMissionType.Refuel);
    if (obj !== null && isRefuellingDepot(obj) && bo !== obj) {
        if (!checkRefuelRights || checkEmpireCanRefuelAtEmpire(ctx.galaxy, bo, ctx.empire, refuelingEmpireOf(obj))) item.children.push(targetItem(ctx, 'At X', T('At X'), base, obj));
    }
    const fuelTypes = determineFuelRequired(bo, true);
    const point =
        bo.role !== BuiltObjectRole.Military
            ? fastFindNearestRefuellingPoint(ctx.galaxy, bo.xpos, bo.ypos, fuelTypes, bo.actualEmpire, bo)
            : fastFindNearestRefuellingPoint(ctx.galaxy, bo.xpos, bo.ypos, fuelTypes, bo.actualEmpire, bo, true, null);
    if (point !== null && (isBuiltObject(point) || isHabitat(point))) item.children.push(targetItem(ctx, 'At nearest refuelling point', T('At nearest refuelling point'), base, point));
    return item.children.length > 0 ? item : null;
}

/** "Build at X" (a habitat under the cursor inside the builder's territory): bases buildable there (method_342 2866-2911 / method_344 4555-4600). */
function buildAtHabitatMenu(ctx: OrderMenuContext, bo: BuiltObject, habitat: Habitat, withPlanetDestroyers: boolean): OrderMenuItem {
    const empire = bo.empire!;
    const base = m315(ctx, BuiltObjectMissionType.Build, habitat);
    const item = item310(ctx, 'Build at X', T('Build at X'), base, false);
    const list: BuiltObjectSubRole[] = [];
    let flag4 = true;
    if (checkAlreadyHaveMiningStationAtHabitat(habitat, empire)) flag4 = false;
    if (flag4) list.push(BuiltObjectSubRole.MiningStation, BuiltObjectSubRole.GasMiningStation);
    if (withPlanetDestroyers) {
        list.push(BuiltObjectSubRole.ResortBase, BuiltObjectSubRole.GenericBase);
    } else {
        list.push(BuiltObjectSubRole.GenericBase, BuiltObjectSubRole.ResortBase);
    }
    list.push(
        BuiltObjectSubRole.EnergyResearchStation,
        BuiltObjectSubRole.WeaponsResearchStation,
        BuiltObjectSubRole.HighTechResearchStation,
        BuiltObjectSubRole.MonitoringStation,
        BuiltObjectSubRole.DefensiveBase,
    );
    const designs = getBuildableDesignsBySubRoles(empire.designs, list, ctx.empire);
    if (withPlanetDestroyers) {
        const destroyers = getBuildablePlanetDestroyerDesigns(empire.designs, ctx.empire);
        if (destroyers.length > 0) designs.push(...destroyers);
    }
    for (const design of designs) {
        if (flag4 || (design.extractionGas <= 0 && design.extractionLuxury <= 0 && design.extractionMine <= 0)) {
            const action = base.clone();
            action.design = design;
            item.children.push(designItem(ctx, design, action));
        }
    }
    return item;
}

// ---------------------------------------------------------------------------------------------------------------
// "Queue Next Mission" (Main.Part8.cs 2598 method_342 for a ship, 3035 method_343 for a fleet)
// ---------------------------------------------------------------------------------------------------------------

/** `(obj is Habitat && Empire != null && != Independent && != empire) || (obj is BuiltObject && Empire != empire) || (obj is ShipGroup && Empire != empire) || obj is Creature`. */
function isHostileTarget(ctx: OrderMenuContext, obj: unknown, empire: Empire | null): boolean {
    if (obj === null || obj === undefined) return false;
    if (isHabitat(obj)) return obj.empire !== null && obj.empire !== ctx.galaxy.independentEmpire && obj.empire !== empire;
    if (isBuiltObject(obj)) return obj.empire !== empire;
    if (isShipGroup(obj)) return obj.empire !== empire;
    return isCreature(obj);
}
/** `obj is Habitat || (obj is BuiltObject && Role == Base)`. */
function isPatrolTarget(obj: unknown): boolean {
    return isHabitat(obj) || (isBuiltObject(obj) && obj.role === BuiltObjectRole.Base);
}
/** `(obj is Habitat && Empire != null && != Independent && != empire) || (obj is BuiltObject && Role == Base && Empire != empire)`. */
function isBlockadeTarget(ctx: OrderMenuContext, obj: unknown, empire: Empire | null): boolean {
    if (isHabitat(obj)) return obj.empire !== null && obj.empire !== ctx.galaxy.independentEmpire && obj.empire !== empire;
    if (isBuiltObject(obj)) return obj.role === BuiltObjectRole.Base && obj.empire !== empire;
    return false;
}
/** The Blockade X entry when the empire may blockade the target (CanSendShipToBlockadeColony / BuiltObject). */
function blockadeItem(ctx: OrderMenuContext, obj: unknown, empire: Empire): OrderMenuItem | null {
    let flag = true;
    if (isHabitat(obj)) flag = canSendShipToBlockadeColony(ctx.galaxy, empire, obj);
    else if (isBuiltObject(obj)) flag = canSendShipToBlockadeBuiltObject(ctx.galaxy, empire, obj);
    if (!flag) return null;
    return item310(ctx, 'Blockade X', T('Blockade X'), m315(ctx, BuiltObjectMissionType.Blockade, obj), true);
}
/** `method_311(obj == self ? method_315(Move, null) : method_315(Move, obj), "Move to X", "Move here", true)`. */
function moveItem(ctx: OrderMenuContext, obj: unknown, self: unknown): OrderMenuItem {
    const action = obj === self ? m315(ctx, BuiltObjectMissionType.Move, null) : m315(ctx, BuiltObjectMissionType.Move, obj);
    return item311(ctx, 'Move to X', T('Move to X'), 'Move here', T('Move here'), action, true);
}

/** Main.Part8.cs 2598 method_342(ship): "Queue Next Mission" — the orders again, every action marked IsSubsequentAction. */
function queueNextMissionMenu(ctx: OrderMenuContext, bo: BuiltObject): OrderMenuItem | null {
    const item = item312('Queue Next Mission', T('Queue Next Mission'));
    const list = item.children;
    if (bo.owner === ctx.empire && bo.subRole !== BuiltObjectSubRole.ColonyShip) {
        const empire = bo.empire!;
        const obj = ctx.pickAt(ctx.cursorX, ctx.cursorY, true);
        if (ctx.zoomFactor > 100.0) {
            pushIf(list, moveToMenu(ctx));
            if (hasConstructionYards(bo)) pushIf(list, buildHereMenu(ctx, bo));
            let flag = false;
            if (bo.firepowerRaw > 0 || bo.fighterCapacity > 0) {
                if (pushIf(list, attackMenu(ctx, BuiltObjectMissionType.Attack))) flag = true;
                pushIf(list, patrolMenu(ctx));
                pushIf(list, escortMenu(ctx));
                pushIf(list, blockadeMenu(ctx));
            }
            if (bo.troops !== null && bo.troops.totalAttackStrength > 0) {
                if (!flag) pushIf(list, troopAttackMenu(ctx, BuiltObjectMissionType.Attack));
                pushIf(list, unloadTroopsMenu(ctx));
            }
            if (bo.troopCapacityRemaining >= 100) pushIf(list, loadTroopsMenu(ctx, bo, false));
            if (bo.sensorResourceProfileSensorRange > 0) list.push(exploreMenuFar(ctx, bo, obj, false));
            if ((bo.subRole as BuiltObjectSubRole) === BuiltObjectSubRole.ColonyShip && bo.empire !== null && bo.empire.pirateEmpireBaseHabitat === null) pushIf(list, colonizeMenu(ctx)); // unreachable here (the menu excludes colony ships)
            if (bo.damagedComponentCount > 0) pushIf(list, repairMenu(ctx, 'Repair', bo, empire, obj, bo, true));
        } else {
            const habitat3 = nearestSystemAtCursor(ctx);
            let flag2 = false;
            list.push(moveItem(ctx, obj, bo));
            if ((bo.firepowerRaw > 0 || bo.fighterCapacity > 0) && obj !== bo) {
                if (isHostileTarget(ctx, obj, empire)) {
                    list.push(item310(ctx, 'Attack X', T('Attack X'), m315(ctx, BuiltObjectMissionType.Attack, obj), true));
                    flag2 = true;
                }
                if (obj !== null && isPatrolTarget(obj)) list.push(item310(ctx, 'Patrol X', T('Patrol X'), m315(ctx, BuiltObjectMissionType.Patrol, obj), true));
                if (obj !== null && isBuiltObject(obj) && obj.role !== BuiltObjectRole.Base && obj.empire === empire) list.push(item310(ctx, 'Escort X', T('Escort X'), m315(ctx, BuiltObjectMissionType.Escort, obj), true));
                if (obj !== null && isBlockadeTarget(ctx, obj, empire)) pushIf(list, blockadeItem(ctx, obj, empire));
            }
            if (bo.troops !== null && bo.troops.totalAttackStrength > 0 && obj !== bo) {
                if (!flag2 && obj !== null && ((isHabitat(obj) && obj.empire !== empire) || (isBuiltObject(obj) && obj.empire !== empire) || (isShipGroup(obj) && obj.empire !== empire))) {
                    list.push(item310(ctx, 'Attack X', T('Attack X'), m315(ctx, BuiltObjectMissionType.Attack, obj), true));
                }
                if (obj !== null && isHabitat(obj) && obj.empire === empire) list.push(item310(ctx, 'Unload Troops at X', T('Unload Troops at X'), m315(ctx, BuiltObjectMissionType.UnloadTroops, obj), true));
            }
            if (bo.troopCapacityRemaining >= 100) {
                const t = item309(ctx, 'Load Troops', T('Load Troops'), BuiltObjectMissionType.LoadTroops);
                const base = createMissionShipAction(BuiltObjectMissionType.LoadTroops);
                if (obj !== null && isHabitat(obj) && obj.empire === empire) t.children.push(targetItem(ctx, 'At X', T('At X'), base, obj));
                const habitat4 = findNearestColonyWithExcessTroops(ctx.galaxy, empire, bo, false, false).habitat;
                if (habitat4 !== null) t.children.push(targetItem(ctx, 'At nearest colony', T('At nearest colony'), base, habitat4));
                if (t.children.length > 0) list.push(t);
            }
            if (bo.sensorResourceProfileSensorRange > 0) list.push(exploreMenuNear(ctx, bo, obj, habitat3, false));
            if (hasConstructionYards(bo)) {
                if (obj !== bo) {
                    if (isHabitat(obj)) {
                        if (checkEmpireTerritoryCanBuildAtHabitat(ctx.galaxy, empire, obj)) list.push(buildAtHabitatMenu(ctx, bo, obj, false));
                    } else if (obj === null) {
                        const base17 = m315(ctx, BuiltObjectMissionType.Build, null);
                        const t2 = item311(ctx, 'Build here', T('Build here'), 'Build here', T('Build here'), base17, false);
                        let flag5 = false;
                        if (checkEmpireTerritoryCanBuildAtLocation(ctx.galaxy, empire, ctx.cursorX, ctx.cursorY)) {
                            const list2 = [
                                BuiltObjectSubRole.GenericBase,
                                BuiltObjectSubRole.EnergyResearchStation,
                                BuiltObjectSubRole.WeaponsResearchStation,
                                BuiltObjectSubRole.HighTechResearchStation,
                                BuiltObjectSubRole.MonitoringStation,
                                BuiltObjectSubRole.DefensiveBase,
                            ];
                            for (const design of getBuildableDesignsBySubRoles(empire.designs, list2, ctx.empire)) {
                                if (design.size <= ctx.empire.maximumConstructionSizeBase(design.subRole)) {
                                    flag5 = true;
                                    const action = base17.clone();
                                    action.design = design;
                                    t2.children.push(designItem(ctx, design, action));
                                }
                            }
                        }
                        if (flag5) list.push(t2);
                    }
                }
            }
            if ((bo.subRole as BuiltObjectSubRole) === BuiltObjectSubRole.ColonyShip && bo.components.countNormalComponentsByType(ComponentType.HabitationColonization) > 0 && obj !== null && isHabitat(obj) && (obj.empire === null || obj.empire === ctx.galaxy.independentEmpire)) {
                if (canBuiltObjectColonizeHabitat(ctx.galaxy, empire, bo, obj).result) list.push(item310(ctx, 'Colonize X', T('Colonize X'), m315(ctx, BuiltObjectMissionType.Colonize, obj), true));
            }
            if ((bo.extractionGas > 0 || bo.extractionLuxury > 0 || bo.extractionMine > 0) && obj !== null && isHabitat(obj) && obj.category !== HabitatCategoryType.Star && (obj.empire === null || obj.empire === ctx.galaxy.independentEmpire)) {
                list.push(item310(ctx, 'Mine X', T('Mine X'), m315(ctx, BuiltObjectMissionType.ExtractResources, obj), true));
            }
            if (bo.damagedComponentCount > 0) pushIf(list, repairMenu(ctx, 'Repair', bo, empire, obj, bo, true));
        }
        list.push(separator());
        const refuel = item309(ctx, 'Refuel', T('Refuel'), BuiltObjectMissionType.Refuel);
        const base23 = createMissionShipAction(BuiltObjectMissionType.Refuel);
        if (obj !== null && isRefuellingDepot(obj) && bo !== obj) refuel.children.push(targetItem(ctx, 'At X', T('At X'), base23, obj));
        const fuelTypes = determineFuelRequired(bo, true);
        const point =
            bo.role !== BuiltObjectRole.Military
                ? fastFindNearestRefuellingPoint(ctx.galaxy, bo.xpos, bo.ypos, fuelTypes, bo.actualEmpire, bo)
                : fastFindNearestRefuellingPoint(ctx.galaxy, bo.xpos, bo.ypos, fuelTypes, bo.actualEmpire, bo, true, null);
        if (point !== null && (isBuiltObject(point) || isHabitat(point))) refuel.children.push(targetItem(ctx, 'At nearest refuelling point', T('At nearest refuelling point'), base23, point));
        if (refuel.children.length > 0) list.push(refuel);
        list.push(item310(ctx, 'Clear All Queued Missions', T('Clear All Queued Missions'), createShipAction(ShipActionType.ClearQueuedMissions, null), true));
    }
    markSubsequent(item);
    return item.children.length === 0 ? null : item;
}

/** Main.Part8.cs 3035 method_343(fleet): "Queue Next Mission" for a fleet (every action marked IsSubsequentAction). */
function fleetQueueNextMissionMenu(ctx: OrderMenuContext, shipGroup: ShipGroup): OrderMenuItem | null {
    const item = item312('Queue Next Mission', T('Queue Next Mission'));
    const list = item.children;
    const obj = ctx.pickAt(ctx.cursorX, ctx.cursorY, true);
    const empire = shipGroup.empire;
    const lead = shipGroup.leadShip!;
    if (ctx.zoomFactor > 100.0) {
        pushIf(list, moveToMenu(ctx));
        pushIf(list, attackMenu(ctx, BuiltObjectMissionType.Attack));
        pushIf(list, attackMenu(ctx, BuiltObjectMissionType.WaitAndAttack));
        pushIf(list, patrolMenu(ctx));
        pushIf(list, escortMenu(ctx));
        pushIf(list, blockadeMenu(ctx));
    } else {
        list.push(moveItem(ctx, obj, shipGroup));
        if (isHostileTarget(ctx, obj, empire)) {
            list.push(item310(ctx, 'Attack X', T('Attack X'), m315(ctx, BuiltObjectMissionType.Attack, obj), true));
            list.push(item310(ctx, 'Prepare and Attack X', T('Prepare and Attack X'), m315(ctx, BuiltObjectMissionType.WaitAndAttack, obj), true));
        }
        if (obj !== null && isPatrolTarget(obj)) list.push(item310(ctx, 'Patrol X', T('Patrol X'), m315(ctx, BuiltObjectMissionType.Patrol, obj), true));
        if (obj !== null && isBlockadeTarget(ctx, obj, empire) && empire !== null) pushIf(list, blockadeItem(ctx, obj, empire));
    }
    list.push(separator());
    const refuel = item309(ctx, 'Refuel all ships', T('Refuel all ships'), BuiltObjectMissionType.Refuel);
    const base2 = createMissionShipAction(BuiltObjectMissionType.Refuel);
    if (obj !== null && isRefuellingDepot(obj) && shipGroup !== obj) refuel.children.push(targetItem(ctx, 'At X', T('At X'), base2, obj));
    const fuelTypes = empire !== null ? determineFuelRequiredForFleet(shipGroup, true).requiredFuel : [];
    const point = fastFindNearestRefuellingPoint(ctx.galaxy, lead.xpos, lead.ypos, fuelTypes, empire, lead, true, null, shipGroup.ships.length);
    if (point !== null && (isBuiltObject(point) || isHabitat(point))) refuel.children.push(targetItem(ctx, 'At nearest refuelling point', T('At nearest refuelling point'), base2, point));
    const port = empire !== null ? fastFindNearestSpacePort(ctx.galaxy, lead.xpos, lead.ypos, empire) : null;
    if (port !== null) refuel.children.push(targetItem(ctx, 'At your nearest Space Port', T('At your nearest Space Port'), base2, port));
    if (refuel.children.length > 0) list.push(refuel);
    if (shipGroup.ships.some((s) => s.damagedComponentCount > 0) && empire !== null) {
        pushIf(list, repairMenu(ctx, 'Repair and Refuel damaged ships', lead, empire, obj, shipGroup, false));
    }
    const back = m315(ctx, BuiltObjectMissionType.Move, shipGroup.gatherPoint);
    back.position = { x: 0, y: 0 };
    list.push(item310(ctx, 'Return to base', T('Return to base') + ' ({0})', back, true));
    list.push(item310(ctx, 'Clear All Queued Missions', T('Clear All Queued Missions'), createShipAction(ShipActionType.ClearQueuedMissions, null), true));
    markSubsequent(item);
    return item.children.length === 0 ? null : item;
}

// ---------------------------------------------------------------------------------------------------------------
// The action menu (Main.Part8.cs 3202 method_344)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Main.Part8.cs 3202 method_344(): the right-click action menu for ctx.selected and the thing under the cursor
 * (actionMenu.Items). Empty when nothing is selected or nothing applies.
 */
export function buildActionMenu(ctx: OrderMenuContext): OrderMenuItem[] {
    const items: OrderMenuItem[] = [];
    const sel = ctx.selected;
    if (sel === null) return items;
    if (isShipGroup(sel)) {
        fleetActionMenu(ctx, sel, items);
    } else if (isHabitat(sel)) {
        habitatActionMenu(ctx, sel, items);
    } else if (Array.isArray(sel)) {
        shipListActionMenu(ctx, sel, items);
    } else if (isBuiltObject(sel)) {
        builtObjectActionMenu(ctx, sel, items);
    }
    return items;
}

/** The first threat to `bo`: its first attacker, else Galaxy.EvaluateThreats(bo)[0]. */
function firstThreat(ctx: OrderMenuContext, bo: BuiltObject): unknown {
    const attackers = attackersOf(bo);
    if (attackers.length > 0) return attackers[0];
    const threats = evaluateThreats(ctx.galaxy, bo).threats;
    return threats !== null && threats.length > 0 ? threats[0] : null;
}

/** Main.Part8.cs 3212-3534: a fleet is selected. */
function fleetActionMenu(ctx: OrderMenuContext, shipGroup: ShipGroup, items: OrderMenuItem[]): void {
    const obj = ctx.pickAt(ctx.cursorX, ctx.cursorY, true);
    const empire = shipGroup.empire;
    const lead = shipGroup.leadShip!;
    const now = ctx.galaxy.nowMs;
    if (ctx.zoomFactor > 100.0) {
        pushIf(items, moveToMenu(ctx));
        pushIf(items, attackMenu(ctx, BuiltObjectMissionType.Attack));
        pushIf(items, attackMenu(ctx, BuiltObjectMissionType.WaitAndAttack));
        if (shipGroupTotalBombardPower(shipGroup) > 0) {
            pushIf(items, bombardMenu(ctx, BuiltObjectMissionType.Bombard));
            pushIf(items, bombardMenu(ctx, BuiltObjectMissionType.WaitAndBombard));
        }
        if (shipGroupTotalAvailableBoardingAssaultStrength(shipGroup, now) > 0) {
            pushIf(items, captureMenu(ctx));
            pushIf(items, raidMenu(ctx));
        }
        pushIf(items, patrolMenu(ctx));
        pushIf(items, escortMenu(ctx));
        pushIf(items, blockadeMenu(ctx));
        if (shipGroupTotalTroopSpaceRemaining(shipGroup) > 0) pushIf(items, loadTroopsMenu(ctx, lead, true));
    } else {
        items.push(moveItem(ctx, obj, shipGroup));
        if (isHostileTarget(ctx, obj, empire)) {
            items.push(item310(ctx, 'Attack X', T('Attack X'), m315(ctx, BuiltObjectMissionType.Attack, obj), true));
            items.push(item310(ctx, 'Prepare and Attack X', T('Prepare and Attack X'), m315(ctx, BuiltObjectMissionType.WaitAndAttack, obj), true));
            if (shipGroupTotalBombardPower(shipGroup) > 0 && isHabitat(obj) && obj.empire !== null && obj.empire !== ctx.galaxy.independentEmpire && obj.empire !== empire) {
                items.push(item310(ctx, 'Bombard X', T('Bombard X'), m315(ctx, BuiltObjectMissionType.Bombard, obj), true));
                items.push(item310(ctx, 'Prepare and Bombard X', T('Prepare and Bombard X'), m315(ctx, BuiltObjectMissionType.WaitAndBombard, obj), true));
            }
        }
        if (obj !== null && isBuiltObject(obj) && obj.empire !== empire && shipGroupTotalAvailableBoardingAssaultStrength(shipGroup, now) > 0) {
            items.push(item310(ctx, 'Capture X', T('Capture X'), m315(ctx, BuiltObjectMissionType.Capture, obj), true));
        }
        if (
            obj !== null &&
            ((isBuiltObject(obj) && obj.role === BuiltObjectRole.Base && obj.empire !== empire) || (isHabitat(obj) && obj.population !== null && obj.population.items.length > 0 && obj.empire !== empire)) &&
            shipGroupTotalAvailableBoardingAssaultStrength(shipGroup, now) > 0 &&
            empire !== null &&
            empire.pirateEmpireBaseHabitat !== null
        ) {
            items.push(item310(ctx, 'Raid X', T('Raid X'), m315(ctx, BuiltObjectMissionType.Raid, obj), true));
        }
        if (obj !== null && isPatrolTarget(obj)) items.push(item310(ctx, 'Patrol X', T('Patrol X'), m315(ctx, BuiltObjectMissionType.Patrol, obj), true));
        if (obj !== null && isBlockadeTarget(ctx, obj, empire) && empire !== null) pushIf(items, blockadeItem(ctx, obj, empire));
        if (shipGroupTotalTroopSpaceRemaining(shipGroup) > 0) pushIf(items, loadTroopsMenu(ctx, lead, true));
    }
    items.push(separator());
    if (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined) {
        items.push(leaf('Stop', T('Stop'), m315(ctx, BuiltObjectMissionType.Hold, null)));
    }
    if (firstThreat(ctx, lead) !== null) items.push(leaf('Escape', T('Escape'), m315(ctx, BuiltObjectMissionType.Escape, null)));
    const home = createMissionShipAction(BuiltObjectMissionType.Undefined);
    home.actionType = ShipActionType.AssignShipGroupHomeColony;
    if (isHabitat(obj) && obj.empire === empire) {
        home.target = obj;
        items.push(item310(ctx, 'Assign X as base', T('Assign X as base'), home, true));
    }
    pushIf(items, transferCharacterToFleetMenu(ctx, shipGroup));
    const refuel = item309(ctx, 'Refuel all ships', T('Refuel all ships'), BuiltObjectMissionType.Refuel);
    const base3 = createMissionShipAction(BuiltObjectMissionType.Refuel);
    if (obj !== null && isRefuellingDepot(obj)) {
        if (shipGroup !== obj && checkEmpireCanRefuelAtEmpire(ctx.galaxy, lead, ctx.empire, refuelingEmpireOf(obj))) refuel.children.push(targetItem(ctx, 'At X', T('At X'), base3, obj));
    }
    const resourceList = shipGroupCalculateRequiredFuel(shipGroup);
    let point = empire !== null ? decideBestFleetRefuelPoint(ctx.galaxy, ctx.empire, lead.xpos, lead.ypos, empire, resourceList, null) : null;
    if (point === null) point = fastFindNearestRefuellingPoint(ctx.galaxy, lead.xpos, lead.ypos, resourceList, empire, lead, true, null, shipGroup.ships.length);
    if (point !== null && (isBuiltObject(point) || isHabitat(point))) refuel.children.push(targetItem(ctx, 'At nearest refuelling point', T('At nearest refuelling point'), base3, point));
    const port = empire !== null ? fastFindNearestSpacePort(ctx.galaxy, lead.xpos, lead.ypos, empire) : null;
    if (port !== null) refuel.children.push(targetItem(ctx, 'At your nearest Space Port', T('At your nearest Space Port'), base3, port));
    if (refuel.children.length > 0) items.push(refuel);
    if (shipGroup.ships.some((s) => s.damagedComponentCount > 0) && empire !== null) {
        pushIf(items, repairMenu(ctx, 'Repair and Refuel damaged ships', lead, empire, obj, shipGroup, false));
    }
    if (empire !== null) {
        const retrofit = item309(ctx, 'Retrofit to latest designs', T('Retrofit to latest designs'), BuiltObjectMissionType.Retrofit);
        const base11 = createMissionShipAction(BuiltObjectMissionType.Retrofit);
        if (obj !== null && isBuiltObject(obj) && obj.empire === empire && obj.isShipYard && (shipGroup as unknown) !== obj) retrofit.children.push(targetItem(ctx, 'At X', T('At X'), base11, obj));
        const yard = findNearestShipYard(ctx.galaxy, empire, lead, true, false);
        if (yard !== null) retrofit.children.push(targetItem(ctx, 'At nearest ship yard', T('At nearest ship yard'), base11, yard));
        if (retrofit.children.length > 0) items.push(retrofit);
    }
    items.push(item310(ctx, 'Disband Fleet', T('Disband Fleet'), createShipAction(ShipActionType.DisbandShipGroup, shipGroup), true));
    const back = m315(ctx, BuiltObjectMissionType.Move, shipGroup.gatherPoint);
    back.position = { x: 0, y: 0 };
    items.push(item310(ctx, 'Return to base', T('Return to base') + ' ({0})', back, true));
    if (shipGroup.mission !== null && shipGroup.mission.type !== BuiltObjectMissionType.Undefined) pushIf(items, fleetQueueNextMissionMenu(ctx, shipGroup));
}

/** A colony's "Build …" design list entry (Main.Part8.cs 3576-3593): only designs CanBuildBuiltObject there and CanBuildDesign (no size check). */
function colonyBuildItem(ctx: OrderMenuContext, habitat: Habitat): OrderMenuItem {
    const base = m315(ctx, BuiltObjectMissionType.Build, habitat);
    const item = item310(ctx, 'Build at X', T('Build at X'), base, false);
    const list: BuiltObjectSubRole[] = [
        BuiltObjectSubRole.ColonyShip,
        BuiltObjectSubRole.ConstructionShip,
        BuiltObjectSubRole.ResupplyShip,
        BuiltObjectSubRole.GenericBase,
        BuiltObjectSubRole.EnergyResearchStation,
        BuiltObjectSubRole.WeaponsResearchStation,
        BuiltObjectSubRole.HighTechResearchStation,
        BuiltObjectSubRole.MonitoringStation,
        BuiltObjectSubRole.DefensiveBase,
    ];
    if (determineSpacePortAtColonyIncludingUnderConstruction(habitat) === null) list.push(BuiltObjectSubRole.SmallSpacePort, BuiltObjectSubRole.MediumSpacePort, BuiltObjectSubRole.LargeSpacePort);
    const empire = habitat.empire!;
    for (const design of getBuildableDesignsBySubRoles(empire.designs, list, ctx.empire, habitat)) {
        // `new BuiltObject(item, "", _Game.Galaxy)` draws no Rnd; canBuildBuiltObject takes the design (forceStructure.ts).
        if (canBuildBuiltObjectFor(empire, design, habitat) && canBuildDesign(empire, design, false)) {
            const action = base.clone();
            action.design = design;
            item.children.push(designItem(ctx, design, action));
        }
    }
    return item;
}

/** A facility / wonder entry "Name (1234 credits)" (disabled when it costs more than StateMoney). */
function facilityItem(ctx: OrderMenuContext, def: Facility): OrderMenuItem {
    const cost = calculatePlanetaryFacilityCost(def, ctx.empire);
    const it = leaf(def.name, def.name + ' (' + n0(cost) + ' credits)', createShipAction(ShipActionType.BuildPlanetaryFacility, def));
    if (cost > ctx.empire.stateMoney) it.enabled = false;
    return it;
}

/** Main.Part8.cs 3535-3706: a habitat is selected. */
function habitatActionMenu(ctx: OrderMenuContext, habitat2: Habitat, items: OrderMenuItem[]): void {
    const player = ctx.empire;
    if (habitat2 !== null && player.pirateEmpireBaseHabitat === null) {
        let builtObject2: BuiltObject | null = null;
        for (const b of player.builtObjects) {
            const m = builtObjectMission(b.mission);
            if (b.subRole === BuiltObjectSubRole.ColonyShip && m !== null && m.type === BuiltObjectMissionType.Colonize && m.targetHabitat === habitat2) {
                builtObject2 = b;
                break;
            }
        }
        const colonizableHabitatTypes = player.colonizableHabitatTypesForEmpire();
        const latestColonyShip = findNewestCanBuildColonyShip(player);
        if (canEmpireColonizeHabitat(ctx.galaxy, player, player, habitat2, colonizableHabitatTypes, latestColonyShip)) {
            const action = createShipAction(ShipActionType.BuildColonize, habitat2);
            let it: OrderMenuItem;
            if (builtObject2 !== null) {
                let fmt = F(T('SHIPNAME colonizing PLANETNAME'), builtObject2.name, '{0}');
                let key = 'SHIPNAME colonizing PLANETNAME';
                const builtAt = builtObject2.builtAt as { name?: string } | null;
                if (builtAt !== null && builtAt !== undefined) {
                    fmt = F(T('SHIPNAME building at COLONY to colonize PLANETNAME'), builtObject2.name, builtAt.name ?? '', '{0}');
                    key = 'SHIPNAME building at COLONY to colonize PLANETNAME';
                }
                it = item310(ctx, key, fmt, action, true);
                it.enabled = false;
            } else {
                it = item310(ctx, 'Build new Colony Ship and Colonize X', T('Build new Colony Ship and Colonize X'), action, true);
            }
            items.push(it);
        }
    }
    if (habitat2.population.totalAmount > 0 && habitat2.empire === player) {
        if (hasConstructionYards(habitat2)) items.push(colonyBuildItem(ctx, habitat2));
        if (player.troopCanRecruitInfantry) {
            const action17 = createMissionShipAction(BuiltObjectMissionType.Undefined);
            action17.actionType = ShipActionType.RecruitTroops;
            action17.target = habitat2;
            items.push(item310(ctx, 'Recruit Troops at X', T('Recruit Troops at X'), action17, true));
        }
        const facilities = item310(ctx, 'Build planetary facilities', T('Build planetary facilities'), createShipAction(ShipActionType.ColonyBuildOptions, habitat2), true);
        const list = resolveBuildableFacilities(ctx.galaxy, habitat2);
        if (list.length > 0) {
            for (const def of list) facilities.children.push(facilityItem(ctx, def));
            items.push(facilities);
        }
        const wonders = item310(ctx, 'Build Wonders', T('Build Wonders'), createShipAction(ShipActionType.ColonyBuildWonder, habitat2), true);
        const list2 = resolveBuildableWonders(ctx.galaxy, habitat2);
        if (list2.length > 0) {
            for (const def of list2) wonders.children.push(facilityItem(ctx, def));
            items.push(wonders);
        }
        pushIf(items, pirateDefendMissionItem(ctx, habitat2));
        pushIf(items, pirateSmugglingMissionItem(ctx, habitat2));
        pushIf(items, colonyTaxMenu(ctx));
        // Mod layer (19b/19f): scenario threat actions on the player's own colony (e.g. "Purge Dark Farm").
        if (ctx.galaxy.scenario !== null) {
            for (const t of availableThreatActions(ctx.galaxy, player, habitat2)) {
                const a = createShipAction(ShipActionType.ScenarioThreatAction, habitat2);
                a.extraData = t.kind;
                items.push(leaf(t.kind, t.label, a));
            }
        }
    }
    if (player.pirateEmpireBaseHabitat !== null && habitat2.empire !== player) {
        const facilities = item310(ctx, 'Build planetary facilities', T('Build planetary facilities'), createShipAction(ShipActionType.ColonyBuildOptions, habitat2), true);
        const list3 = resolveBuildableFacilitiesPirates(ctx.galaxy, habitat2, player);
        if (list3.length > 0) {
            for (const def of list3) facilities.children.push(facilityItem(ctx, def));
            items.push(facilities);
        }
    }
    pushIf(items, transferCharacterToLocationMenu(ctx, habitat2));
}

/** Main.Part8.cs 3707-3963: several ships are selected (BuiltObjectList). */
function shipListActionMenu(ctx: OrderMenuContext, builtObjectList: BuiltObject[], items: OrderMenuItem[]): void {
    if (builtObjectList.length > 0 && builtObjectList[0].owner === ctx.empire) {
        const first = builtObjectList[0];
        const empire = first.empire!;
        let num5 = 0;
        let num6 = 0;
        let num7 = 0;
        let num8 = 0;
        let num9 = 0;
        let num10 = 0;
        for (const b of builtObjectList) {
            num5 += b.firepowerRaw;
            num6 += b.fighterCapacity;
            num7 += b.bombardWeaponPower;
            num8 += b.damagedComponentCount;
            num9 += b.troopCapacity;
            num10 += b.assaultStrength;
        }
        const obj2 = ctx.pickAt(ctx.cursorX, ctx.cursorY, true);
        if (ctx.zoomFactor > 100.0) {
            pushIf(items, moveToMenu(ctx));
            if (num5 > 0 || num6 > 0) pushIf(items, attackMenu(ctx, BuiltObjectMissionType.Attack));
            if (num10 > 0) {
                pushIf(items, captureMenu(ctx));
                pushIf(items, raidMenu(ctx));
            }
            if (num7 > 0) pushIf(items, bombardMenu(ctx, BuiltObjectMissionType.Bombard));
            if (num8 > 0) pushIf(items, repairMenu(ctx, 'Repair damaged ships', first, empire, obj2, builtObjectList, false));
        } else {
            nearestSystemAtCursor(ctx); // habitat3: computed and unused in the C#
            items.push(moveItem(ctx, obj2, builtObjectList));
            if ((num5 > 0 || num6 > 0) && obj2 !== builtObjectList && isHostileTarget(ctx, obj2, empire)) {
                items.push(item310(ctx, 'Attack X', T('Attack X'), m315(ctx, BuiltObjectMissionType.Attack, obj2), true));
            }
            if (num10 > 0 && isBuiltObject(obj2) && obj2.empire !== empire) {
                items.push(item310(ctx, 'Capture X', T('Capture X'), m315(ctx, BuiltObjectMissionType.Capture, obj2), true));
            }
            if (
                num10 > 0 &&
                obj2 !== null &&
                ((isBuiltObject(obj2) && obj2.role === BuiltObjectRole.Base && obj2.empire !== empire) || (isHabitat(obj2) && obj2.population !== null && obj2.population.items.length > 0 && obj2.empire !== empire)) &&
                empire.pirateEmpireBaseHabitat !== null
            ) {
                items.push(item310(ctx, 'Raid X', T('Raid X'), m315(ctx, BuiltObjectMissionType.Raid, obj2), true));
            }
            if (num7 > 0 && isHabitat(obj2) && obj2.empire !== null && obj2.empire !== ctx.galaxy.independentEmpire && obj2.empire !== empire) {
                items.push(item310(ctx, 'Bombard X', T('Bombard X'), m315(ctx, BuiltObjectMissionType.Bombard, obj2), true));
            }
            if (num8 > 0) pushIf(items, repairMenu(ctx, 'Repair damaged ships', first, empire, obj2, builtObjectList, false));
            if (items.length > 0) items.push(separator());
            items.push(leaf('Stop', T('Stop'), createMissionShipAction(BuiltObjectMissionType.Hold)));
            items.push(leaf('Escape', T('Escape'), createMissionShipAction(BuiltObjectMissionType.Escape)));
            if (num5 > 0 || num9 > 0 || num7 > 0 || num6 > 0) items.push(joinFleetMenu(ctx, empire));
            const leave = createMissionShipAction(BuiltObjectMissionType.Undefined);
            leave.actionType = ShipActionType.LeaveShipGroup;
            leave.target = null;
            items.push(item310(ctx, 'Leave Current Fleet', T('Leave Current Fleet'), leave, true));
        }
        let shipToRefuel = first;
        for (const b of builtObjectList) {
            if (b.role === BuiltObjectRole.Military) {
                shipToRefuel = b;
                break;
            }
        }
        const refuel = item309(ctx, 'Refuel all ships', T('Refuel all ships'), BuiltObjectMissionType.Refuel);
        const base34 = createMissionShipAction(BuiltObjectMissionType.Refuel);
        if (obj2 !== null && isRefuellingDepot(obj2)) {
            if (builtObjectList !== obj2 && checkEmpireCanRefuelAtEmpire(ctx.galaxy, shipToRefuel, ctx.empire, refuelingEmpireOf(obj2))) refuel.children.push(targetItem(ctx, 'At X', T('At X'), base34, obj2));
        }
        const fuelTypes = listDetermineFuelRequired(builtObjectList, true);
        const point = fastFindNearestRefuellingPoint(ctx.galaxy, first.xpos, first.ypos, fuelTypes, first.actualEmpire, shipToRefuel, false, null, builtObjectList.length);
        if (point !== null && (isBuiltObject(point) || isHabitat(point))) refuel.children.push(targetItem(ctx, 'At nearest refuelling point', T('At nearest refuelling point'), base34, point));
        if (refuel.children.length > 0) items.push(refuel);
        const retire = item309(ctx, 'Retire all ships', T('Retire all ships'), BuiltObjectMissionType.Retire);
        const base38 = createMissionShipAction(BuiltObjectMissionType.Retire);
        if (obj2 !== null && isBuiltObject(obj2) && obj2.isShipYard && (builtObjectList as unknown) !== obj2) retire.children.push(targetItem(ctx, 'At X', T('At X'), base38, obj2));
        const yardBase = findNearestShipYardBase(ctx.galaxy, empire, first);
        if (yardBase !== null) retire.children.push(targetItem(ctx, 'At nearest ship yard', T('At nearest ship yard'), base38, yardBase));
        const scrap = m315(ctx, BuiltObjectMissionType.Retire, null);
        scrap.position = { x: 0, y: 0 };
        retire.children.push(item310(ctx, 'Scrap Ships Immediately', T('Scrap Ships Immediately'), scrap, true));
        if (retire.children.length > 0) items.push(retire);
    }
    const automate = createMissionShipAction(BuiltObjectMissionType.Undefined);
    automate.actionType = ShipActionType.AutomateShip;
    items.push(item310(ctx, 'Automate all ships', T('Automate all ships'), automate, true));
}

/** "Join Fleet": (New Fleet) while under Empire.FleetMaximumCount, then every fleet of the empire. */
function joinFleetMenu(ctx: OrderMenuContext, empire: Empire): OrderMenuItem {
    const join = createMissionShipAction(BuiltObjectMissionType.Undefined);
    join.actionType = ShipActionType.JoinShipGroup;
    const item = item309(ctx, 'Join Fleet', T('Join Fleet'), BuiltObjectMissionType.Undefined);
    const groups = playerShipGroups(empire);
    if (groups.length < empireFleetMaximumCount(empire)) item.children.push(item310(ctx, 'New Fleet', '(' + T('New Fleet') + ')', join, true));
    for (const g of groups) {
        const a = join.clone();
        a.target = g;
        item.children.push(item310(ctx, g.name ?? '', g.name ?? '', a, true));
    }
    return item;
}

/** BuiltObjectList.cs 654 DetermineFuelRequired(setFuelLevelToZero): one entry per fuel resource, SortTag = the amount. */
function listDetermineFuelRequired(list: BuiltObject[], setFuelLevelToZero: boolean): { resourceId: number; sortTag: number }[] {
    const resourceList: { resourceId: number; sortTag: number }[] = [];
    for (const builtObject of list) {
        let num = 1;
        if (!setFuelLevelToZero) num = builtObject.fuelCapacity - Math.trunc(builtObject.currentFuel);
        const fuelType = builtObject.fuelType;
        if (fuelType === null) continue; // C# dereferences FuelType (never null for a ship)
        const existing = resourceList.find((r) => r.resourceId === fuelType.resourceId);
        if (existing !== undefined) {
            existing.sortTag += num;
            continue;
        }
        resourceList.push({ resourceId: fuelType.resourceId, sortTag: num });
    }
    return resourceList;
}

/** Empire.Designs.FindNewestCanBuild(BuiltObjectSubRole.ColonyShip). */
function findNewestCanBuildColonyShip(empire: Empire): Design | null {
    return findNewestCanBuild(empire.designs, BuiltObjectSubRole.ColonyShip, empire);
}

/** The own-base retrofit sub-role list (Main.Part8.cs 4077-4124 / 4950-4996): same family as the base. */
function baseRetrofitSubRoles(bo: BuiltObject): BuiltObjectSubRole[] {
    const S = BuiltObjectSubRole;
    const list: BuiltObjectSubRole[] = [];
    if (bo.subRole === S.GasMiningStation) list.push(S.GasMiningStation);
    else if (bo.subRole === S.MiningStation) list.push(S.MiningStation);
    else if (bo.subRole !== S.SmallSpacePort && bo.subRole !== S.MediumSpacePort && bo.subRole !== S.LargeSpacePort) {
        switch (bo.subRole) {
            case S.DefensiveBase:
            case S.EnergyResearchStation:
            case S.WeaponsResearchStation:
            case S.HighTechResearchStation:
            case S.ResortBase:
            case S.MonitoringStation:
            case S.GenericBase:
                list.push(bo.subRole);
                break;
        }
    } else {
        list.push(S.SmallSpacePort, S.MediumSpacePort, S.LargeSpacePort);
    }
    return list;
}

/** "Retrofit" → "To <design> (<subrole>) for N credits" per buildable newer base design (disabled when unaffordable). */
function baseRetrofitMenu(ctx: OrderMenuContext, bo: BuiltObject, designs: Design[]): OrderMenuItem {
    const item = item309(ctx, 'Retrofit', T('Retrofit'), BuiltObjectMissionType.Retrofit);
    const base = m315(ctx, BuiltObjectMissionType.Retrofit, bo);
    for (const design of designs) {
        const r = determineRetrofitAffordability(ctx.galaxy, bo.empire!, bo, design);
        const label = F(T('To X for Y credits'), design.name + ' (' + describeSubRole(design.subRole) + ')', n0(r.cost));
        const action = base.clone();
        action.design = design;
        const it = leaf('To X for Y credits', label, action);
        if (!r.result) it.enabled = false;
        item.children.push(it);
    }
    return item;
}

/** "Retire" → "Scrap Base Immediately". */
function scrapBaseMenu(ctx: OrderMenuContext, bo: BuiltObject): OrderMenuItem {
    const item = item312('Retire', T('Retire'));
    item.children.push(leaf('Scrap Base Immediately', T('Scrap Base Immediately'), m315(ctx, BuiltObjectMissionType.Retire, bo)));
    return item;
}

/** Main.Part8.cs 3964-5065: a ship or base is selected. */
function builtObjectActionMenu(ctx: OrderMenuContext, builtObject6: BuiltObject, items: OrderMenuItem[]): void {
    const player = ctx.empire;
    const now = ctx.galaxy.nowMs;
    void now;
    if (builtObject6.owner === player) {
        const empire = builtObject6.empire!;
        if (builtObject6.role === BuiltObjectRole.Base) {
            // 3975-4180
            if (builtObject6.isShipYard && hasConstructionYards(builtObject6)) {
                const base43 = m315(ctx, BuiltObjectMissionType.Build, builtObject6);
                const build = item310(ctx, 'Build at X', T('Build at X'), base43, false);
                const S = BuiltObjectSubRole;
                const list2 = [
                    S.ExplorationShip,
                    S.Escort,
                    S.Frigate,
                    S.Destroyer,
                    S.Cruiser,
                    S.CapitalShip,
                    S.Carrier,
                    S.TroopTransport,
                    S.SmallFreighter,
                    S.MediumFreighter,
                    S.LargeFreighter,
                    S.PassengerShip,
                    S.MiningShip,
                    S.GasMiningShip,
                ];
                for (const design of getDesignsBySubRoles(empire.designs, list2)) {
                    if (canBuildBuiltObjectFor(empire, design, null) && canBuildDesign(empire, design) && !design.isPlanetDestroyer) {
                        const action = base43.clone();
                        action.design = design;
                        build.children.push(designItem(ctx, design, action));
                    }
                }
                items.push(build);
            }
            const owner = builtObject6.owner!;
            if (
                owner.pirateEmpireBaseHabitat !== null &&
                (builtObject6.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject6.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject6.subRole === BuiltObjectSubRole.LargeSpacePort) &&
                builtObject6.parentHabitat !== null &&
                builtObject6.parentHabitat !== owner.pirateEmpireBaseHabitat
            ) {
                items.push(leaf('Set as Home Base', T('Set as Home Base'), createShipAction(ShipActionType.ChangePirateHomeBase, builtObject6.parentHabitat)));
            }
            const ph = builtObject6.parentHabitat;
            if ((ph === null || ph.population.totalAmount <= 0 || ph.empire !== builtObject6.empire) && ph !== null && ph.population !== null && ph.population.items.length !== 0 && ph.population.totalAmount > 0) {
                if (ph === null || ph.population === null || ph.population.totalAmount <= 0 || ph.owner === ctx.galaxy.independentEmpire) items.push(scrapBaseMenu(ctx, builtObject6));
            } else {
                const list3 = baseRetrofitSubRoles(builtObject6);
                const designs = getBuildableDesignsBySubRoles(empire.designs, list3, player, builtObject6.parentHabitat);
                const at = designs.indexOf(builtObject6.design);
                if (at >= 0) designs.splice(at, 1);
                if (designs.length > 0 && builtObject6.retrofitDesign === null && builtObject6.builtAt === null) items.push(baseRetrofitMenu(ctx, builtObject6, designs));
                items.push(scrapBaseMenu(ctx, builtObject6));
            }
        } else {
            shipActionMenu(ctx, builtObject6, items);
        }
    } else if (builtObject6.empire === player && builtObject6.role === BuiltObjectRole.Base) {
        // 4945-5020: a base of the player's empire it does not own (e.g. a private base).
        const empire = builtObject6.empire;
        const list8 = baseRetrofitSubRoles(builtObject6);
        const designs = getBuildableDesignsBySubRoles(empire.designs, list8, player);
        const at = designs.indexOf(builtObject6.design);
        if (at >= 0) designs.splice(at, 1);
        if (designs.length > 0 && builtObject6.retrofitDesign === null && builtObject6.builtAt === null) items.push(baseRetrofitMenu(ctx, builtObject6, designs));
        items.push(scrapBaseMenu(ctx, builtObject6));
    }
    pushIf(items, transferCharacterToLocationMenu(ctx, builtObject6));
    if (builtObject6.role === BuiltObjectRole.Base) {
        if (builtObject6.empire === player) pushIf(items, pirateDefendMissionItem(ctx, builtObject6));
        else pushIf(items, pirateAttackMissionItem(ctx, builtObject6));
    }
    if (builtObject6.empire === player || builtObject6.owner === player) pushIf(items, giveToMenu(ctx, builtObject6));
    if (hasMission(builtObject6.mission)) pushIf(items, queueNextMissionMenu(ctx, builtObject6));
}

/** Main.Part8.cs 4133-4943: one of the player's ships is selected. */
function shipActionMenu(ctx: OrderMenuContext, builtObject6: BuiltObject, items: OrderMenuItem[]): void {
    const player = ctx.empire;
    const empire = builtObject6.empire!;
    const obj3 = ctx.pickAt(ctx.cursorX, ctx.cursorY, true);
    if (ctx.zoomFactor > 100.0) {
        // 4136-4302
        if (builtObject6.unbuiltComponentCount <= 0) {
            pushIf(items, moveToMenu(ctx));
            if (builtObject6.isShipYard && hasConstructionYards(builtObject6)) pushIf(items, buildHereMenu(ctx, builtObject6));
            let flag7 = false;
            if (builtObject6.firepowerRaw > 0 || builtObject6.fighterCapacity > 0) {
                if (pushIf(items, attackMenu(ctx, BuiltObjectMissionType.Attack))) flag7 = true;
            }
            if (builtObject6.bombardWeaponPower > 0) {
                if (pushIf(items, bombardMenu(ctx, BuiltObjectMissionType.Bombard))) flag7 = true;
            }
            if (builtObject6.assaultStrength > 0 && builtObject6.assaultRange > 0) {
                if (pushIf(items, captureMenu(ctx))) flag7 = true;
            }
            if (builtObject6.assaultStrength > 0 && builtObject6.assaultRange > 0) {
                if (pushIf(items, raidMenu(ctx))) flag7 = true;
            }
            if (builtObject6.firepowerRaw > 0 || builtObject6.fighterCapacity > 0) {
                pushIf(items, patrolMenu(ctx));
                pushIf(items, escortMenu(ctx));
                pushIf(items, blockadeMenu(ctx));
            }
            if (troopAttackStrength(builtObject6) > 0) {
                if (!flag7) pushIf(items, troopAttackMenu(ctx, BuiltObjectMissionType.Attack));
                pushIf(items, unloadTroopsMenu(ctx));
            }
            if (builtObject6.troopCapacityRemaining >= 100) pushIf(items, loadTroopsMenu(ctx, builtObject6, false));
            if (builtObject6.sensorResourceProfileSensorRange > 0) items.push(exploreMenuFar(ctx, builtObject6, obj3, true));
            if (builtObject6.subRole === BuiltObjectSubRole.ColonyShip && builtObject6.empire !== null && builtObject6.empire.pirateEmpireBaseHabitat === null) pushIf(items, colonizeMenu(ctx));
            if (builtObject6.damagedComponentCount > 0) pushIf(items, repairMenu(ctx, 'Repair', builtObject6, empire, obj3, builtObject6, true));
        }
    } else {
        // 4303-4749
        const habitat7 = nearestSystemAtCursor(ctx);
        let flag8 = false;
        if (builtObject6.unbuiltComponentCount <= 0) {
            items.push(moveItem(ctx, obj3, builtObject6));
            if ((builtObject6.firepowerRaw > 0 || builtObject6.fighterCapacity > 0) && obj3 !== builtObject6) {
                let flag9 = false;
                if (isHostileTarget(ctx, obj3, empire)) flag9 = true;
                else if (builtObject6.isPlanetDestroyer && obj3 !== null && isHabitat(obj3) && canDestroyHabitat(ctx.galaxy, builtObject6, obj3)) flag9 = true;
                if (flag9) {
                    items.push(item310(ctx, 'Attack X', T('Attack X'), m315(ctx, BuiltObjectMissionType.Attack, obj3), true));
                    flag8 = true;
                }
                if (obj3 !== null && isBuiltObject(obj3) && obj3.empire !== empire && builtObject6.assaultStrength > 0 && builtObject6.assaultRange > 0) {
                    items.push(item310(ctx, 'Capture X', T('Capture X'), m315(ctx, BuiltObjectMissionType.Capture, obj3), true));
                    flag8 = true;
                }
                if (
                    obj3 !== null &&
                    ((isBuiltObject(obj3) && obj3.role === BuiltObjectRole.Base && obj3.empire !== empire) || (isHabitat(obj3) && obj3.population !== null && obj3.population.items.length > 0 && obj3.empire !== empire)) &&
                    builtObject6.assaultStrength > 0 &&
                    builtObject6.assaultRange > 0 &&
                    builtObject6.empire !== null &&
                    builtObject6.empire.pirateEmpireBaseHabitat !== null
                ) {
                    items.push(item310(ctx, 'Raid X', T('Raid X'), m315(ctx, BuiltObjectMissionType.Raid, obj3), true));
                    flag8 = true;
                }
            }
            if (builtObject6.bombardWeaponPower > 0 && obj3 !== null && isHabitat(obj3)) {
                if (obj3.empire !== null && obj3.empire !== ctx.galaxy.independentEmpire && obj3.empire !== empire) {
                    items.push(item310(ctx, 'Bombard X', T('Bombard X'), m315(ctx, BuiltObjectMissionType.Bombard, obj3), true));
                    flag8 = true;
                }
            }
            if ((builtObject6.firepowerRaw > 0 || builtObject6.fighterCapacity > 0) && obj3 !== builtObject6) {
                if (obj3 !== null && isPatrolTarget(obj3)) items.push(item310(ctx, 'Patrol X', T('Patrol X'), m315(ctx, BuiltObjectMissionType.Patrol, obj3), true));
                if (obj3 !== null && isBuiltObject(obj3) && obj3.role !== BuiltObjectRole.Base && obj3.empire === empire) items.push(item310(ctx, 'Escort X', T('Escort X'), m315(ctx, BuiltObjectMissionType.Escort, obj3), true));
                if (obj3 !== null && isBlockadeTarget(ctx, obj3, empire)) pushIf(items, blockadeItem(ctx, obj3, empire));
            }
            if (troopAttackStrength(builtObject6) > 0 && obj3 !== builtObject6) {
                if (!flag8 && obj3 !== null && ((isHabitat(obj3) && obj3.empire !== empire) || (isBuiltObject(obj3) && obj3.empire !== empire) || (isShipGroup(obj3) && obj3.empire !== empire))) {
                    items.push(item310(ctx, 'Attack X', T('Attack X'), m315(ctx, BuiltObjectMissionType.Attack, obj3), true));
                }
                if (obj3 !== null && isHabitat(obj3) && obj3.empire === empire) items.push(item310(ctx, 'Unload Troops at X', T('Unload Troops at X'), m315(ctx, BuiltObjectMissionType.UnloadTroops, obj3), true));
            }
            if (builtObject6.troopCapacityRemaining >= 100) {
                const t = item309(ctx, 'Load Troops', T('Load Troops'), BuiltObjectMissionType.LoadTroops);
                const base56 = createMissionShipAction(BuiltObjectMissionType.LoadTroops);
                if (obj3 !== null && isHabitat(obj3) && obj3.empire === empire) t.children.push(targetItem(ctx, 'At X', T('At X'), base56, obj3));
                const habitat8 = findNearestColonyWithExcessTroops(ctx.galaxy, empire, builtObject6, false, false).habitat;
                if (habitat8 !== null) t.children.push(targetItem(ctx, 'At nearest colony', T('At nearest colony'), base56, habitat8));
                if (t.children.length > 0) items.push(t);
            }
            if (builtObject6.sensorResourceProfileSensorRange > 0) items.push(exploreMenuNear(ctx, builtObject6, obj3, habitat7, true));
            if (builtObject6.isShipYard && hasConstructionYards(builtObject6) && obj3 !== builtObject6) {
                if (isHabitat(obj3)) {
                    if (player.pirateEmpireBaseHabitat !== null) {
                        pushIf(items, pirateBuildAtHabitatMenu(ctx, builtObject6, obj3));
                    } else if (checkEmpireTerritoryCanBuildAtHabitat(ctx.galaxy, empire, obj3)) {
                        items.push(buildAtHabitatMenu(ctx, builtObject6, obj3, true));
                    }
                } else if (obj3 === null) {
                    pushIf(items, buildHereNearMenu(ctx, builtObject6));
                }
            }
            if (
                builtObject6.subRole === BuiltObjectSubRole.ColonyShip &&
                builtObject6.empire !== null &&
                builtObject6.empire.pirateEmpireBaseHabitat === null &&
                builtObject6.components.countNormalComponentsByType(ComponentType.HabitationColonization) > 0 &&
                obj3 !== null &&
                isHabitat(obj3) &&
                (obj3.empire === null || obj3.empire === ctx.galaxy.independentEmpire)
            ) {
                if (canBuiltObjectColonizeHabitat(ctx.galaxy, empire, builtObject6, obj3).result && canEmpireColonizeHabitatRange(ctx.galaxy, empire, obj3)) {
                    items.push(item310(ctx, 'Colonize X', T('Colonize X'), m315(ctx, BuiltObjectMissionType.Colonize, obj3), true));
                }
            }
            if (
                (builtObject6.extractionGas > 0 || builtObject6.extractionLuxury > 0 || builtObject6.extractionMine > 0) &&
                builtObject6.subRole !== BuiltObjectSubRole.ResupplyShip &&
                obj3 !== null &&
                isHabitat(obj3) &&
                obj3.category !== HabitatCategoryType.Star &&
                (obj3.empire === null || obj3.empire === ctx.galaxy.independentEmpire)
            ) {
                items.push(item310(ctx, 'Mine X', T('Mine X'), m315(ctx, BuiltObjectMissionType.ExtractResources, obj3), true));
            }
        }
        if (builtObject6.subRole === BuiltObjectSubRole.ResupplyShip) {
            if (!builtObject6.isDeployed && builtObject6.deployProgress === 0.0 && obj3 !== null && isHabitat(obj3)) {
                if (obj3.empire === null || obj3.empire === ctx.galaxy.independentEmpire) items.push(item310(ctx, 'Deploy at X', T('Deploy at X'), m315(ctx, BuiltObjectMissionType.Deploy, obj3), true));
            } else if (builtObject6.isDeployed && builtObject6.deployProgress === 0.0) {
                items.push(item310(ctx, 'Undeploy', T('Undeploy'), createMissionShipAction(BuiltObjectMissionType.Undeploy), true));
            }
        }
        if (isHabitat(obj3)) {
            const ruin = obj3.ruin;
            if (ruin !== null && ruin.playerEmpireEncountered && checkRuinsHaveBenefit(ctx.galaxy, ruin, player)) {
                const num18 = ctx.galaxy.calculateDistance(builtObject6.xpos, builtObject6.ypos, obj3.xpos, obj3.ypos);
                if (num18 <= 500.0) items.push(item310(ctx, 'Investigate Ruins', T('Investigate Ruins'), createShipAction(ShipActionType.InvestigateRuins, obj3), true));
            }
        }
        if (isBuiltObject(obj3)) {
            if (obj3.empire === null && obj3.unbuiltComponentCount <= 0 && obj3.damagedComponentCount <= 0) {
                const num19 = ctx.galaxy.calculateDistance(builtObject6.xpos, builtObject6.ypos, obj3.xpos, obj3.ypos);
                if (num19 <= 500.0) {
                    const key = obj3.role !== BuiltObjectRole.Base ? 'Investigate Ship' : 'Investigate Base';
                    items.push(item310(ctx, key, T(key), createShipAction(ShipActionType.InvestigateBuiltObject, obj3), true));
                }
            }
        }
        if (builtObject6.unbuiltComponentCount <= 0 && builtObject6.damagedComponentCount > 0) pushIf(items, repairMenu(ctx, 'Repair', builtObject6, empire, obj3, builtObject6, true));
    }
    // 4750-4943
    if (items.length > 0) items.push(separator());
    if (builtObject6.builtAt === null && hasMission(builtObject6.mission)) items.push(leaf('Stop', T('Stop'), createMissionShipAction(BuiltObjectMissionType.Hold)));
    if (builtObject6.unbuiltComponentCount <= 0) {
        if (firstThreat(ctx, builtObject6) !== null) items.push(leaf('Escape', T('Escape'), createMissionShipAction(BuiltObjectMissionType.Escape)));
    }
    const group = shipGroupOf(builtObject6);
    if (group === null) {
        if (builtObject6.firepowerRaw > 0 || builtObject6.troopCapacity > 0 || builtObject6.bombardWeaponPower > 0 || builtObject6.fighterCapacity > 0) items.push(joinFleetMenu(ctx, empire));
    } else {
        const leave = createMissionShipAction(BuiltObjectMissionType.Undefined);
        leave.actionType = ShipActionType.LeaveShipGroup;
        leave.target = group;
        items.push(item310(ctx, 'Leave FLEETNAME', F(T('Leave FLEETNAME'), '{0}'), leave, true));
        if (group.leadShip !== builtObject6) {
            const lead = createMissionShipAction(BuiltObjectMissionType.Undefined);
            lead.actionType = ShipActionType.SetAsLeadShipInGroup;
            lead.target = group;
            items.push(item310(ctx, 'Make lead ship for FLEETNAME', F(T('Make lead ship for FLEETNAME'), '{0}'), lead, true));
        }
    }
    if (builtObject6.unbuiltComponentCount <= 0) {
        pushIf(items, shipRefuelMenu(ctx, builtObject6, obj3, true));
        reviewLatestDesigns(ctx.galaxy, empire); // builtObject6.Empire.ReviewLatestDesigns()
        const list7 = [builtObject6.subRole];
        const designList =
            builtObject6.parentHabitat === null
                ? getBuildableDesignsBySubRoles(empire.designs, list7, player)
                : getBuildableDesignsBySubRoles(empire.designs, list7, player, builtObject6.parentHabitat);
        const at = designList.indexOf(builtObject6.design);
        if (at >= 0) designList.splice(at, 1);
        if (designList.length > 0 && builtObject6.retrofitDesign === null && missionTypeOf(builtObject6.mission) !== BuiltObjectMissionType.Retrofit) {
            const retrofit = item309(ctx, 'Retrofit', T('Retrofit'), BuiltObjectMissionType.Retrofit);
            const base80 = createMissionShipAction(BuiltObjectMissionType.Retrofit);
            if (obj3 !== null && isBuiltObject(obj3) && obj3.isShipYard && builtObject6 !== obj3) {
                for (const design of designList) {
                    const a = base80.clone();
                    a.target = obj3;
                    const b = a.clone();
                    b.design = design;
                    retrofit.children.push(item310(ctx, 'To X at Y', F(T('To X at Y'), design.name, '{0}'), b, true));
                }
            }
            const yardBase = findNearestShipYardBase(ctx.galaxy, empire, builtObject6);
            if (yardBase !== null) {
                for (const design of designList) {
                    const a = base80.clone();
                    a.target = yardBase;
                    const b = a.clone();
                    b.design = design;
                    retrofit.children.push(item310(ctx, 'To X at nearest ship yard', F(T('To X at nearest ship yard'), design.name), b, true));
                }
            }
            if (retrofit.children.length > 0) items.push(retrofit);
        }
    }
    const retire = item309(ctx, 'Retire', T('Retire'), BuiltObjectMissionType.Retire);
    const base85 = createMissionShipAction(BuiltObjectMissionType.Retire);
    if (builtObject6.unbuiltComponentCount <= 0) {
        if (obj3 !== null && isBuiltObject(obj3) && obj3.isShipYard && builtObject6 !== obj3) retire.children.push(targetItem(ctx, 'At X', T('At X'), base85, obj3));
        const yardBase = findNearestShipYardBase(ctx.galaxy, empire, builtObject6);
        if (yardBase !== null) retire.children.push(targetItem(ctx, 'At nearest ship yard', T('At nearest ship yard'), base85, yardBase));
    }
    if (builtObject6.builtAt === null) retire.children.push(item310(ctx, 'Scrap Ship Immediately', T('Scrap Ship Immediately'), m315(ctx, BuiltObjectMissionType.Retire, builtObject6), true));
    if (retire.children.length > 0) items.push(retire);
    if (!builtObject6.isAutoControlled) {
        const automate = createMissionShipAction(BuiltObjectMissionType.Undefined);
        automate.actionType = ShipActionType.AutomateShip;
        items.push(item310(ctx, 'Automate', T('Automate'), automate, true));
    }
}

/** Main.Part8.cs 4480-4551: a pirate's construction ship over a habitat — "Build at X" (space ports, mining, generic bases, planet destroyers). */
function pirateBuildAtHabitatMenu(ctx: OrderMenuContext, bo: BuiltObject, habitat11: Habitat): OrderMenuItem | null {
    const empire = bo.empire!;
    const base = m315(ctx, BuiltObjectMissionType.Build, habitat11);
    const item = item310(ctx, 'Build at X', T('Build at X'), base, false);
    const list4: BuiltObjectSubRole[] = [];
    let flag12 = true;
    let flag13 = true;
    let flag14 = true;
    if (habitat11.population !== null && habitat11.population.items.length > 0 && habitat11.empire !== ctx.empire) {
        flag14 = false;
        flag13 = false;
        flag12 = false;
    }
    if (checkAlreadyHaveMiningStationAtHabitat(habitat11, empire)) flag13 = false;
    if (determineSpacePortAtHabitat(habitat11) !== null) flag14 = false;
    if (flag14) list4.push(BuiltObjectSubRole.SmallSpacePort, BuiltObjectSubRole.MediumSpacePort, BuiltObjectSubRole.LargeSpacePort);
    if (flag13) list4.push(BuiltObjectSubRole.MiningStation, BuiltObjectSubRole.GasMiningStation);
    if (flag12) list4.push(BuiltObjectSubRole.ResortBase, BuiltObjectSubRole.GenericBase, BuiltObjectSubRole.MonitoringStation, BuiltObjectSubRole.DefensiveBase);
    const designs = getBuildableDesignsBySubRoles(empire.designs, list4, ctx.empire);
    const destroyers = getBuildablePlanetDestroyerDesigns(empire.designs, ctx.empire);
    if (destroyers.length > 0) designs.push(...destroyers);
    for (const design of designs) {
        if (flag13 || (design.extractionGas <= 0 && design.extractionLuxury <= 0 && design.extractionMine <= 0)) {
            const action = base.clone();
            action.design = design;
            item.children.push(designItem(ctx, design, action));
        }
    }
    return item.children.length > 0 ? item : null;
}

/** Main.Part8.cs 4602-4646: a construction ship over empty space at system zoom — "Build here" (resort / generic / research / monitoring / defensive bases, planet destroyers). */
function buildHereNearMenu(ctx: OrderMenuContext, bo: BuiltObject): OrderMenuItem | null {
    const empire = bo.empire!;
    const base = m315(ctx, BuiltObjectMissionType.Build, null);
    const item = item311(ctx, 'Build here', T('Build here'), 'Build here', T('Build here'), base, false);
    const list6: BuiltObjectSubRole[] = [BuiltObjectSubRole.ResortBase, BuiltObjectSubRole.GenericBase];
    if (ctx.empire.pirateEmpireBaseHabitat === null) list6.push(BuiltObjectSubRole.EnergyResearchStation, BuiltObjectSubRole.WeaponsResearchStation, BuiltObjectSubRole.HighTechResearchStation);
    list6.push(BuiltObjectSubRole.MonitoringStation, BuiltObjectSubRole.DefensiveBase);
    let flag16 = false;
    const designs = getBuildableDesignsBySubRoles(empire.designs, list6, ctx.empire);
    const destroyers = getBuildablePlanetDestroyerDesigns(empire.designs, ctx.empire);
    if (destroyers.length > 0) designs.push(...destroyers);
    for (const design of designs) {
        if (design.size <= ctx.empire.maximumConstructionSizeBase(design.subRole)) {
            flag16 = true;
            const action = base.clone();
            action.design = design;
            item.children.push(designItem(ctx, design, action));
        }
    }
    return flag16 ? item : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Troops a colony can recruit (Habitat.cs 6834 DetermineTroopTypeForColony, 6900 ResolveRecruitableTroopsForColony)
// ---------------------------------------------------------------------------------------------------------------

/** `(int)((float)num * 1.5f)`. */
function eliteStrength(num: number): number {
    return Math.trunc(Math.fround(Math.fround(num) * 1.5));
}

/** Habitat.cs 6834 DetermineTroopTypeForColony(): the troop a colony recruits by default. No Rnd. */
export function determineTroopTypeForColony(galaxy: Galaxy, habitat: Habitat): Troop | null {
    let troop: Troop | null = null;
    if (habitat.population !== null) {
        const dominantRace = habitat.population.dominantRace as Race | null;
        const empire = habitat.empire;
        const troop2 = empire !== null ? identifyStrongestRaceAttackTroop(empire) : null;
        let num = 100.0;
        if (dominantRace !== null) num = dominantRace.troopStrength;
        if (habitat.ruin !== null) num *= 1.0 + habitat.ruin.bonusDefensive;
        for (const f of habitat.facilities ?? []) {
            if (!(f.constructionProgress >= 1)) continue;
            switch (f.type) {
                case PlanetaryFacilityType.CloningFacility:
                    if (troop2 !== null) {
                        troop = generateNewTroop(T('Clone Trooper Battalion'), TroopType.Infantry, troop2.attackStrength, empire, troop2.race as Race | null, false);
                        troop.setDefendStrength(troop2.defendStrength);
                        troop.colony = habitat;
                    }
                    break;
                case PlanetaryFacilityType.RoboticTroopFoundry:
                    troop = generateNewTroop(T('BattleBot Group'), TroopType.Infantry, 60, empire, null, false);
                    troop.maintenanceMultiplier = 0.25;
                    troop.pictureRef = galaxy.races.length;
                    troop.colony = habitat;
                    break;
                case PlanetaryFacilityType.TroopTrainingCenter:
                    troop = generateNewTroop(F(T('Elite TROOPNAME'), dominantRace!.troopName), TroopType.Infantry, eliteStrength(num), empire, dominantRace);
                    troop.colony = habitat;
                    break;
            }
        }
        if (troop === null && dominantRace !== null) {
            troop = generateNewTroop(dominantRace.troopName, TroopType.Infantry, Math.trunc(num), empire, dominantRace);
            troop.readiness = 0;
            troop.colony = habitat;
        }
    }
    return troop;
}

/** Habitat.cs 6900 ResolveRecruitableTroopsForColony(out cloneIndex, out roboticIndex, out eliteIndex). No Rnd. */
export function resolveRecruitableTroopsForColony(galaxy: Galaxy, habitat: Habitat): { troops: Troop[]; cloneIndex: number; roboticIndex: number; eliteIndex: number } {
    const troopList: Troop[] = [];
    let cloneIndex = -1;
    let roboticIndex = -1;
    let eliteIndex = -1;
    if (habitat.population !== null) {
        const dominantRace = habitat.population.dominantRace as Race | null;
        const empire = habitat.empire;
        const troop = empire !== null ? identifyStrongestRaceAttackTroop(empire) : null;
        let num = 100.0;
        if (dominantRace !== null) num = dominantRace.troopStrength;
        if (habitat.ruin !== null) num *= 1.0 + habitat.ruin.bonusDefensive;
        num += resourceBonusTotalByEffectType(habitat, ColonyResourceEffect.RecruitedTroopStrength);
        const facilities = habitat.facilities ?? [];
        if (empire !== null && empire.research !== null && dominantRace !== null) {
            if (empire.troopCanRecruitInfantry) {
                const t = generateNewTroop(dominantRace.troopName, TroopType.Infantry, Math.trunc(num), empire, dominantRace);
                t.readiness = 0;
                t.colony = habitat;
                troopList.push(t);
            }
            if (empire.troopCanRecruitArmored && facilitiesFindCompletedByType(facilities, PlanetaryFacilityType.ArmoredFactory) !== null) {
                const t = generateNewTroop(raceTroopName(dominantRace, dominantRace.troopNameArmored), TroopType.Armored, Math.trunc(num), empire, dominantRace);
                t.readiness = 0;
                t.colony = habitat;
                troopList.push(t);
            }
            if (empire.troopCanRecruitArtillery) {
                // Race.TroopNameArtillery ← races.txt TroopNamePlanetaryDefense (Race.cs 1423).
                const t = generateNewTroop(raceTroopName(dominantRace, dominantRace.troopNamePlanetaryDefense), TroopType.Artillery, Math.trunc(num), empire, dominantRace);
                t.readiness = 0;
                t.colony = habitat;
                troopList.push(t);
            }
            if (empire.troopCanRecruitSpecialForces && facilitiesFindCompletedByType(facilities, PlanetaryFacilityType.MilitaryAcademy) !== null) {
                const t = generateNewTroop(raceTroopName(dominantRace, dominantRace.troopNameSpecialForces), TroopType.SpecialForces, Math.trunc(num), empire, dominantRace);
                t.readiness = 0;
                t.colony = habitat;
                troopList.push(t);
            }
        }
        for (const planetaryFacility of facilities) {
            if (planetaryFacility === null || !(planetaryFacility.constructionProgress >= 1)) continue;
            let troop6: Troop | null = null;
            switch (planetaryFacility.type) {
                case PlanetaryFacilityType.CloningFacility:
                    if (troop !== null) {
                        troop6 = generateNewTroop(T('Clone Trooper Battalion'), TroopType.Infantry, troop.attackStrength, empire, troop.race as Race | null, false);
                        troop6.setDefendStrength(troop.defendStrength);
                        troop6.colony = habitat;
                    }
                    break;
                case PlanetaryFacilityType.RoboticTroopFoundry:
                    troop6 = generateNewTroop(T('BattleBot Group'), TroopType.Infantry, 60, empire, null, false);
                    troop6.maintenanceMultiplier = 0.25;
                    troop6.pictureRef = galaxy.races.length;
                    troop6.colony = habitat;
                    break;
                case PlanetaryFacilityType.TroopTrainingCenter:
                    troop6 = generateNewTroop(F(T('Elite TROOPNAME'), dominantRace!.troopName), TroopType.Infantry, eliteStrength(num), empire, dominantRace);
                    troop6.colony = habitat;
                    break;
            }
            if (troop6 !== null) {
                switch (planetaryFacility.type) {
                    case PlanetaryFacilityType.CloningFacility:
                        cloneIndex = troopList.length;
                        break;
                    case PlanetaryFacilityType.RoboticTroopFoundry:
                        roboticIndex = troopList.length;
                        break;
                    case PlanetaryFacilityType.TroopTrainingCenter:
                        eliteIndex = troopList.length;
                        break;
                }
                troopList.push(troop6);
            }
        }
    }
    return { troops: troopList, cloneIndex, roboticIndex, eliteIndex };
}
/** Race.cs LoadFromFile 1063-1074: an empty TroopNameArmored / Artillery / SpecialForces falls back to TroopName. */
function raceTroopName(race: Race, name: string): string {
    return race.troopName !== '' && name === '' ? race.troopName : name;
}

// ---------------------------------------------------------------------------------------------------------------
// Selection panel action buttons (Main.Part3.cs 1120-3805 btnSelectionAction1-8, method_585-594)
// ---------------------------------------------------------------------------------------------------------------

/** The selection the eight buttons act on (`_Game.PlayerEmpire` / `_Game.SelectedObject`). */
export interface SelectionContext {
    galaxy: Galaxy;
    empire: Empire;
    selected: ShipActionSelection;
}

/** method_589's button colour families. */
export type SelectionButtonStyle = '' | 'fighter' | 'build' | 'buildprivate' | 'facility' | 'wonder' | 'plague';

/** One of btnSelectionAction1..8 after method_588(button, action). */
export interface SelectionButton {
    /** The button's Tag (null: nothing happens on click). */
    action: ShipAction | null;
    /** glassButton.Enabled (false also when the Tag is null). */
    enabled: boolean;
    /** The hover text: button.Hint, else method_590(Tag) (Main.Part10.cs 738-793). */
    hint: string;
    style: SelectionButtonStyle;
    /** Build buttons: ships of this sub-role under construction at the yard (the yellow number). */
    count: number;
}

/** Main.Part3.cs 1949 method_591(missingTech, sizeTooBig): " (CANNOT BUILD - Missing Tech / Size too big)". */
function cannotBuildReason(missingTech: boolean, sizeTooBig: boolean): string {
    let text = ' (' + upper(T('Cannot Build'));
    if (missingTech) text = text + ' - ' + T('Missing Tech');
    else if (sizeTooBig) text = text + ' - ' + T('Size too big');
    return text + ')';
}
const NOT_ENOUGH_MONEY = (): string => ' (' + upper(T('Not Enough Money')) + ')';
const CANNOT_BUILD = (): string => ' (' + upper(T('Cannot Build')) + ')';

/** Main.Part3.cs 1667 method_590(tag): the long description of a selection button's action. */
export function selectionActionHint(ctx: SelectionContext, tag: unknown): string {
    let text = '';
    if (!(tag instanceof ShipAction)) return text;
    const shipAction = tag;
    const player = ctx.empire;
    const selected = ctx.selected;
    if (shipAction.missionType !== BuiltObjectMissionType.Undefined) {
        switch (shipAction.missionType) {
            case BuiltObjectMissionType.Escape:
                text = text + T('Escape from attackers') + ' (E)';
                break;
            case BuiltObjectMissionType.Retire:
                if (isBuiltObject(shipAction.target)) {
                    text += T('Scrap base immediately');
                } else if (shipAction.target instanceof Fighter) {
                    text += shipAction.target.specification.type !== FighterType.Bomber ? T('Scrap Fighter immediately') : T('Scrap Bomber immediately');
                }
                break;
            case BuiltObjectMissionType.Retrofit:
                if (selected !== null && isBuiltObject(selected)) {
                    if (shipAction.design !== null) {
                        const r = determineRetrofitAffordability(ctx.galaxy, player, selected, shipAction.design);
                        text = F(T('Retrofit to latest design'), shipAction.design.name, nGroup(r.cost));
                    }
                } else if (selected !== null && isShipGroup(selected)) {
                    text = T('Retrofit fleet to latest designs');
                }
                break;
            case BuiltObjectMissionType.Colonize:
                if (isHabitat(shipAction.target)) {
                    const h = shipAction.target;
                    text += F(T('Colonize TYPE CATEGORY NAME'), describeHabitatType(h.type), describeHabitatCategory(h.category).toLowerCase(), h.name);
                }
                break;
            case BuiltObjectMissionType.Hold:
                text = text + T('Stop') + ' (S)';
                break;
            case BuiltObjectMissionType.LoadTroops:
                text += T('Load Troops at nearest colony');
                break;
            case BuiltObjectMissionType.Refuel:
            case BuiltObjectMissionType.Repair:
                text += !isShipGroup(selected) ? T('Refuel and Repair ship') : T('Refuel and Repair Fleet');
                break;
            case BuiltObjectMissionType.Move:
                text += T('Return to Base');
                if (isHabitat(shipAction.target)) text = text + ' (' + shipAction.target.name + ')';
                break;
            case BuiltObjectMissionType.Explore:
                text += T('Explore nearest system');
                break;
            case BuiltObjectMissionType.Build:
                if (isHabitat(shipAction.target)) {
                    const habitat = shipAction.target;
                    if (shipAction.design !== null) {
                        const num = shipAction.design.calculateCurrentPurchasePrice(ctx.galaxy);
                        text =
                            habitat.owner === player
                                ? F(T('Build SHIPTYPE'), describeSubRole(shipAction.design.subRole), shipAction.design.name, nGroup(num))
                                : F(T('Queue construction ship to build a DESIGN here'), describeSubRole(shipAction.design.subRole), shipAction.design.name, nGroup(num));
                    }
                } else if (isBuiltObject(shipAction.target2)) {
                    const builtObject = shipAction.target as BuiltObject; // C# casts Target (not Target2)
                    if (builtObject !== null && builtObject.empire === player && builtObject.unbuiltOrDamagedComponentCount > 0) text = F(T('Queue construction ship to Repair X'), builtObject.name);
                } else if (shipAction.design !== null) {
                    text = F(T('Build SHIPTYPE'), describeSubRole(shipAction.design.subRole), shipAction.design.name, nGroup(shipAction.design.calculateCurrentPurchasePrice(ctx.galaxy)));
                }
                break;
        }
    } else if (shipAction.actionType !== ShipActionType.Undefined) {
        switch (shipAction.actionType) {
            case ShipActionType.RecruitTroops: {
                text += T('Recruit Troops');
                if (selected === null || !isHabitat(selected)) break;
                const habitat5 = selected;
                if (habitat5.population !== null && habitat5.population.totalAmount > 0 && habitat5.empire === player) {
                    let troop: Troop | null = shipAction.target2 instanceof Troop ? shipAction.target2 : null;
                    if (troop === null) troop = determineTroopTypeForColony(ctx.galaxy, habitat5);
                    if (troop !== null) text = text + ' (' + troop.name + ', ' + describeTroopType(troop.type) + ')';
                }
                break;
            }
            case ShipActionType.AutomateShip:
                text = text + T('Automate Ship') + ' (A)';
                break;
            case ShipActionType.JoinShipGroup:
                text += T('Join nearest Fleet');
                break;
            case ShipActionType.LeaveShipGroup:
                text += T('Leave Fleet');
                break;
            case ShipActionType.BuildColonize:
                if (isHabitat(shipAction.target)) {
                    const habitat4 = shipAction.target;
                    const design = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.ColonyShip, null);
                    if (design !== null) {
                        const num2 = design.calculateCurrentPurchasePrice(ctx.galaxy);
                        text += F(T('Build a new colony ship and Colonize'), describeHabitatType(habitat4.type), describeHabitatCategory(habitat4.category).toLowerCase(), habitat4.name, nGroup(num2));
                    }
                }
                break;
            case ShipActionType.FighterOptions:
                text += T('Manage Fighters and Bombers');
                break;
            case ShipActionType.FighterBuildFighter:
                text += T('Build new fighter');
                break;
            case ShipActionType.FighterBuildBomber:
                text += T('Build new bomber');
                break;
            case ShipActionType.FighterLaunchFighters:
                text += !(shipAction.target instanceof Fighter) ? T('Launch available Fighters') : T('Launch this Fighter');
                break;
            case ShipActionType.FighterLaunchBombers:
                text += !(shipAction.target instanceof Fighter) ? T('Launch available Bombers') : T('Launch this Bomber');
                break;
            case ShipActionType.FighterRetrieveFighters:
                text += !(shipAction.target instanceof Fighter) ? T('Return all Fighters') : T('Return this Fighter to carrier');
                break;
            case ShipActionType.FighterRetrieveBombers:
                text += !(shipAction.target instanceof Fighter) ? T('Return all Bombers') : T('Return this Bomber to carrier');
                break;
            case ShipActionType.BuildOptions:
                text = T('Build new ship or base');
                break;
            case ShipActionType.ReturnToTop:
                text = T('Return to Top');
                break;
            case ShipActionType.UnautomateShip:
                text += T('Turn off automation');
                break;
            case ShipActionType.CreateNewFleet:
                text += T('Create new Fleet');
                break;
            case ShipActionType.ColonyBuildOptions:
                text = T('Build new planetary facility');
                break;
            case ShipActionType.BuildPlanetaryFacility:
                if (isFacility(shipAction.target)) {
                    const def = shipAction.target;
                    text += F(T('Build FACILITY cost'), def.name, nGroup(calculatePlanetaryFacilityCost(def, player)));
                }
                break;
            case ShipActionType.AssignAttack:
                text = T('Attack with nearest available fleet');
                break;
            case ShipActionType.FighterUpgradeAll:
                text += T('Upgrade all fighters and bombers to latest');
                break;
            case ShipActionType.SetFleetPosture:
                text = T('Set Posture');
                if (isShipGroup(shipAction.target)) {
                    if (shipAction.target.posture === FleetPosture.Defend) text = text + '  (' + T('Currently Defend') + ')';
                    else if (shipAction.target.posture === FleetPosture.Attack) text = text + '  (' + T('Currently Attack') + ')';
                }
                break;
            case ShipActionType.SetFleetRange: {
                text = T('Set Range');
                if (!isShipGroup(shipAction.target)) break;
                const g = shipAction.target;
                if (g.postureRangeSquared <= 2250000.0) {
                    if (g.posture === FleetPosture.Attack) text = text + '  (' + T('Currently Target') + ')';
                    else if (g.posture === FleetPosture.Defend) text = text + '  (' + T('Currently Home Base') + ')';
                } else if (g.postureRangeSquared <= 2304000000.0) {
                    text = text + '  (' + T('Currently System') + ')';
                } else if (g.postureRangeSquared <= 250000000000.0) {
                    text = text + '  (' + T('Currently Nearby Systems') + ')';
                } else if (g.postureRangeSquared <= 1000000000000.0) {
                    text = text + '  (' + T('Currently Sector') + ')';
                } else {
                    text = text + '  (' + T('Currently Anywhere') + ')';
                }
                break;
            }
            case ShipActionType.SetFleetAttackPoint:
                text = T('Set Attack Target');
                if (isShipGroup(shipAction.target)) {
                    const ap = shipAction.target.attackPoint;
                    text = text + '  (' + F(T('Currently X'), ap === null ? T('None') : nameOf(ap)) + ')';
                }
                break;
            case ShipActionType.SetFleetHomeBase:
                text = T('Set Home Base');
                if (isShipGroup(shipAction.target)) {
                    const gp = shipAction.target.gatherPoint;
                    text = text + '  (' + F(T('Currently X'), gp === null ? T('None') : nameOf(gp)) + ')';
                }
                break;
            case ShipActionType.ColonyBuildWonder:
                text = T('Build new Wonder');
                break;
            case ShipActionType.BuildOptionsPrivate:
                text = T('Build new civilian ship');
                break;
            case ShipActionType.GeneratePirateMissionAttack: {
                const t = stellar(shipAction.target) as BuiltObject | Habitat;
                text = player.pirateMissions.containsEquivalentTarget(t, EmpireActivityType.Attack)
                    ? T('Cancel Mercenary Attack Mission')
                    : F(T('Assign Mercenary Attack Mission'), t.name, n0(calculatePirateAttackPrice(ctx.galaxy, player, t)));
                break;
            }
            case ShipActionType.GeneratePirateMissionDefend: {
                const t = stellar(shipAction.target) as BuiltObject | Habitat;
                text = player.pirateMissions.containsEquivalentTarget(t, EmpireActivityType.Defend)
                    ? T('Cancel Mercenary Defend Mission')
                    : F(T('Assign Mercenary Defense Mission'), t.name, n0(calculatePirateDefendPrice(ctx.galaxy, player, t)));
                break;
            }
            case ShipActionType.GeneratePirateMissionSmuggling: {
                const t = stellar(shipAction.target) as BuiltObject | Habitat;
                text = player.pirateMissions.containsEquivalentTarget(t, EmpireActivityType.Smuggle) ? T('Cancel Mercenary Smuggling Mission') : T('Assign Mercenary Smuggling Mission');
                break;
            }
            case ShipActionType.DeployVirus:
                if (isPlague(shipAction.target2)) text = F(T('Deploy PLAGUE at this colony'), shipAction.target2.name);
                break;
        }
    }
    return text;
}

/** The (missionType, Build, design) button: "<Design> at <yard>" (the 8 build buttons of a base / colony). */
function buildButton(ctx: SelectionContext, target: unknown, offset: Point, design: Design | null): ShipAction {
    return missionActionAt(BuiltObjectMissionType.Build, target, offset, design);
}
/** `FindNewestCanBuildFullEvaluate(subRole, colony)` (includePlanetDestroyers true) + " (CANNOT BUILD)" / " (NOT ENOUGH MONEY)". */
function newestOrReason(ctx: SelectionContext, subRole: BuiltObjectSubRole, colony: Habitat | null): { design: Design | null; reason: string } {
    let design = findNewestCanBuildFullEvaluate(ctx.empire.designs, subRole, colony);
    let reason = '';
    if (design === null) {
        reason = CANNOT_BUILD();
    } else if (design.calculateCurrentPurchasePrice(ctx.galaxy) > ctx.empire.stateMoney) {
        design = null;
        reason = NOT_ENOUGH_MONEY();
    }
    return { design, reason };
}
/** Set the hint to method_590(action) + suffix. */
function hintWith(ctx: SelectionContext, action: ShipAction, suffix: string): void {
    action.hint = selectionActionHint(ctx, action) + suffix;
}

type Slots = (ShipAction | null)[];
function slots(...a: (ShipAction | null)[]): Slots {
    return a;
}
const EMPTY_SLOTS = (): Slots => slots(null, null, null, null, null, null, null, null);
const RETURN_TO_TOP = (): ShipAction => createShipAction(ShipActionType.ReturnToTop, null);

/**
 * Main.Part3.cs 1968 method_593(shipAction_1): the eight selection-panel actions for the selection, at the top level
 * (subMenu null = method_592) or inside a sub-menu (BuildOptions / FighterOptions / ColonyBuildWonder /
 * BuildOptionsPrivate / ColonyBuildOptions). `null` when the C# leaves the buttons as they were (a sub-menu that
 * does not apply to the selection).
 */
export function selectionActions(ctx: SelectionContext, subMenu: ShipAction | null): Slots | null {
    if (subMenu !== null) {
        switch (subMenu.actionType) {
            case ShipActionType.BuildOptions:
                return buildOptionsSlots(ctx);
            case ShipActionType.FighterOptions:
                return fighterOptionsSlots(ctx, subMenu);
            case ShipActionType.ColonyBuildWonder:
                return colonyWonderSlots(ctx);
            case ShipActionType.BuildOptionsPrivate:
                return buildOptionsPrivateSlots(ctx);
            case ShipActionType.ColonyBuildOptions:
                return colonyFacilitySlots(ctx);
        }
        return null;
    }
    const sel = ctx.selected;
    if (sel === null) return EMPTY_SLOTS();
    if (isHabitat(sel)) return habitatSlots(ctx, sel);
    if (isBuiltObject(sel)) return builtObjectSlots(ctx, sel);
    if (sel instanceof Fighter) {
        if (sel.empire === ctx.empire) {
            let a27: ShipAction | null = null;
            if (!sel.underConstruction) {
                a27 = sel.onboardCarrier
                    ? createShipAction(sel.specification.type !== FighterType.Bomber ? ShipActionType.FighterLaunchFighters : ShipActionType.FighterLaunchBombers, sel)
                    : createShipAction(sel.specification.type !== FighterType.Bomber ? ShipActionType.FighterRetrieveFighters : ShipActionType.FighterRetrieveBombers, sel);
            }
            return slots(a27, null, null, null, null, null, null, missionAction(BuiltObjectMissionType.Retire, sel));
        }
        return null;
    }
    if (isShipGroup(sel)) return fleetSlots(ctx, sel);
    if (Array.isArray(sel)) {
        if (sel.length <= 0) return null;
        // `PlayerEmpire.FindNearestRefuellingPoint(x, y, FuelType, 3)`: result unused in the C# (no Rnd) — not called.
        let a29 = missionAction(BuiltObjectMissionType.Refuel, sel);
        let num10 = 0;
        for (const b of sel) if (b !== null && b.damagedComponentCount > 0) num10 += b.damagedComponentCount;
        if (num10 > 0) a29 = missionAction(BuiltObjectMissionType.Repair, sel);
        return slots(missionAction(BuiltObjectMissionType.Hold, sel), a29, missionAction(BuiltObjectMissionType.Escape, sel), createShipAction(ShipActionType.CreateNewFleet, sel), null, null, null, null);
    }
    return EMPTY_SLOTS(); // Creature / SystemInfo
}

/** Main.Part3.cs 1975-2152: BuildOptions for a base (warships) or for an own colony (space port, defenses, civilian builders). */
function buildOptionsSlots(ctx: SelectionContext): Slots | null {
    const sel = ctx.selected;
    const player = ctx.empire;
    if (sel === null) return null;
    if (isBuiltObject(sel)) {
        const builtObject3 = sel;
        if (builtObject3.role !== BuiltObjectRole.Base) return null;
        const offset2: Point = { x: 0, y: 0 };
        const roles = [
            BuiltObjectSubRole.Escort,
            BuiltObjectSubRole.Frigate,
            BuiltObjectSubRole.Destroyer,
            BuiltObjectSubRole.Cruiser,
            BuiltObjectSubRole.CapitalShip,
            BuiltObjectSubRole.TroopTransport,
            BuiltObjectSubRole.Carrier,
            BuiltObjectSubRole.ExplorationShip,
        ];
        const designs: (Design | null)[] = [];
        const texts: string[] = [];
        for (const role of roles) {
            const r = findNewestCanBuildFullEvaluateReasons(player.designs, role, null, false);
            let design = r.design;
            let text = '';
            if (design === null) {
                text = cannotBuildReason(r.missingTech, r.sizeTooBig);
            } else if (design.calculateCurrentPurchasePrice(ctx.galaxy) > player.stateMoney) {
                design = null;
                text = NOT_ENOUGH_MONEY();
            }
            designs.push(design);
            texts.push(text);
        }
        const actions = designs.map((d) => buildButton(ctx, builtObject3, offset2, d));
        roles.forEach((role, i) => {
            if (designs[i] === null) {
                actions[i].design = findNewestIncludingObsoletePD(player.designs, role, false);
                actions[i].enabled = false;
            }
        });
        actions.forEach((a) => (a.hint = selectionActionHint(ctx, a)));
        actions.forEach((a, i) => (a.hint = (a.hint ?? '') + texts[i]));
        const [a15, a16, a17, a18, a19, a20, a21, a22] = actions;
        const [, , , design10, design11, design12, design13, design14] = designs;
        if (design13 !== null) {
            if (design11 === null) return slots(a15, a16, a17, a18, a21, a20, a22, RETURN_TO_TOP());
            if (design10 === null) return slots(a15, a16, a17, a21, a19, a20, a22, RETURN_TO_TOP());
            if (design12 === null) return slots(a15, a16, a17, a18, a19, a21, a22, RETURN_TO_TOP());
            if (design14 === null) return slots(a15, a16, a17, a18, a19, a20, a21, RETURN_TO_TOP());
            return slots(a15, a16, a17, a18, a19, a20, a22, RETURN_TO_TOP());
        }
        return slots(a15, a16, a17, a18, a19, a20, a22, RETURN_TO_TOP());
    }
    if (!isHabitat(sel)) return null;
    const habitat3 = sel;
    if (habitat3.owner !== player) return null;
    let text18 = '';
    let design15: Design | null;
    let design16: Design | null;
    const num4 = player.policy!.constructionSpaceportLargeColonyPopulationThreshold * 1000000;
    const num5 = player.policy!.constructionSpaceportMediumColonyPopulationThreshold * 1000000;
    if (habitat3.population.totalAmount > num4) {
        design15 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.LargeSpacePort, habitat3);
        design16 = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.LargeSpacePort);
    } else if (habitat3.population.totalAmount > num5) {
        design15 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.MediumSpacePort, habitat3);
        design16 = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.MediumSpacePort);
    } else {
        design15 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.SmallSpacePort, habitat3);
        design16 = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.SmallSpacePort);
    }
    if (design15 === null) {
        let design17 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.SmallSpacePort, habitat3);
        let design18 = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.SmallSpacePort);
        if (design17 === null) {
            design17 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.MediumSpacePort, habitat3);
            design18 = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.MediumSpacePort);
            if (design17 === null) {
                design17 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.LargeSpacePort, habitat3);
                design18 = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.LargeSpacePort);
            }
        }
        if (design17 !== null && design18 !== null) {
            design15 = design17;
            design16 = design18;
        }
    }
    if (determineSpacePortAtColony(ctx.galaxy, habitat3) !== null) {
        design15 = null;
        text18 = ' (' + upper(T('Spaceport Already At Colony')) + ')';
    }
    if (design15 !== null && design15.calculateCurrentPurchasePrice(ctx.galaxy) > player.stateMoney) {
        design15 = null;
        text18 = NOT_ENOUGH_MONEY();
    }
    const r19 = newestOrReason(ctx, BuiltObjectSubRole.DefensiveBase, habitat3);
    const r20 = newestOrReason(ctx, BuiltObjectSubRole.ColonyShip, null);
    const r21 = newestOrReason(ctx, BuiltObjectSubRole.ConstructionShip, null);
    const r22 = newestOrReason(ctx, BuiltObjectSubRole.ResupplyShip, null);
    const r23 = newestOrReason(ctx, BuiltObjectSubRole.MonitoringStation, habitat3);
    let p = ctx.galaxy.selectRelativeHabitatSurfacePoint(habitat3); // Rnd
    let point: Point = { x: Math.trunc(p.x + habitat3.xpos), y: Math.trunc(p.y + habitat3.ypos) };
    const a23 = buildButton(ctx, habitat3, point, design15);
    p = determineOrbitalBaseLocation(ctx.galaxy, habitat3);
    point = { x: Math.trunc(p.x + habitat3.xpos), y: Math.trunc(p.y + habitat3.ypos) };
    const a24 = buildButton(ctx, habitat3, point, r19.design);
    point = { x: Math.trunc(habitat3.xpos), y: Math.trunc(habitat3.ypos) };
    const a25 = buildButton(ctx, habitat3, point, r20.design);
    const a26 = buildButton(ctx, habitat3, point, r21.design);
    const a27 = buildButton(ctx, habitat3, point, r22.design);
    p = ctx.galaxy.selectRelativeHabitatSurfacePoint(habitat3); // Rnd
    point = { x: Math.trunc(p.x + habitat3.xpos), y: Math.trunc(p.y + habitat3.ypos) };
    const a28 = buildButton(ctx, habitat3, point, r23.design);
    if (design15 === null) {
        a23.design = design16;
        a23.enabled = false;
    }
    if (r19.design === null) {
        a24.design = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.DefensiveBase);
        a24.enabled = false;
    }
    if (r20.design === null || habitat3.population.totalAmount < BUILD_COLONY_SHIP_POPULATION_REQUIREMENT) {
        a25.design = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.ColonyShip);
        a25.enabled = false;
    }
    if (r21.design === null) {
        a26.design = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.ConstructionShip);
        a26.enabled = false;
    }
    if (r22.design === null) {
        a27.design = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.ResupplyShip);
        a27.enabled = false;
    }
    if (r23.design === null) {
        a28.design = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.MonitoringStation);
        a28.enabled = false;
    }
    hintWith(ctx, a23, text18);
    hintWith(ctx, a24, r19.reason);
    hintWith(ctx, a25, r20.reason);
    hintWith(ctx, a26, r21.reason);
    hintWith(ctx, a27, r22.reason);
    hintWith(ctx, a28, r23.reason);
    return slots(a23, a24, a25, a26, a27, a28, null, RETURN_TO_TOP());
}

/** Main.Part3.cs 2345-2430: FighterOptions for a carrier. */
function fighterOptionsSlots(ctx: SelectionContext, subMenu: ShipAction): Slots | null {
    if (!isBuiltObject(subMenu.target)) return null;
    const builtObject = subMenu.target;
    let num = 0;
    if (builtObject.fighters !== null) num = builtObject.fighterCapacity - fightersTotalSize(builtObject);
    const a3 = createShipAction(ShipActionType.FighterBuildFighter, builtObject);
    const a4 = createShipAction(ShipActionType.FighterBuildBomber, builtObject);
    const a5 = createShipAction(ShipActionType.FighterLaunchFighters, builtObject);
    const a6 = createShipAction(ShipActionType.FighterLaunchBombers, builtObject);
    const a7 = createShipAction(ShipActionType.FighterUpgradeAll, builtObject);
    a3.hint = selectionActionHint(ctx, a3);
    a4.hint = selectionActionHint(ctx, a4);
    a7.hint = selectionActionHint(ctx, a7);
    if (num < 10) {
        a3.enabled = false;
        a4.enabled = false;
        a3.hint = a3.hint + ' (' + upper(T('Carrier Full')) + ')';
        a4.hint = a4.hint + ' (' + upper(T('Carrier Full')) + ')';
    }
    let text = '';
    let text2 = '';
    if (checkFightersAvailableForLaunch(builtObject)) {
        a5.actionType = ShipActionType.FighterLaunchFighters;
    } else if (checkFightersNeedReturning(builtObject)) {
        a5.actionType = ShipActionType.FighterRetrieveFighters;
    } else {
        a5.enabled = false;
        text = ' (' + upper(T('No Fighters Available')) + ')';
    }
    if (checkBombersAvailableForLaunch(builtObject)) {
        a6.actionType = ShipActionType.FighterLaunchBombers;
    } else if (checkBombersNeedReturning(builtObject)) {
        a6.actionType = ShipActionType.FighterRetrieveBombers;
    } else {
        a6.enabled = false;
        text2 = ' (' + upper(T('No Bombers Available')) + ')';
    }
    a5.hint = selectionActionHint(ctx, a5) + text;
    a6.hint = selectionActionHint(ctx, a6) + text2;
    let text3 = '';
    let flag = false;
    const fighters = fightersOf(builtObject);
    if (fighters !== null && fighters.length > 0) {
        let spec: unknown = null;
        let spec2: unknown = null;
        if (builtObject.empire !== null && builtObject.empire.research !== null) {
            spec = identifyLatestFighterSpecification(builtObject.empire);
            spec2 = identifyLatestBomberSpecification(builtObject.empire);
        }
        for (const f of fighters) {
            if (f.specification === null) continue;
            if (spec !== null && f.specification.type === FighterType.Interceptor) {
                if (f.specification !== spec && f.onboardCarrier) {
                    flag = true;
                    break;
                }
            } else if (spec2 !== null && f.specification.type === FighterType.Bomber && f.specification !== spec2 && f.onboardCarrier) {
                flag = true;
                break;
            }
        }
    }
    if (!flag) {
        text3 = ' (' + upper(T('No Onboard Fighters Need Upgrading')) + ')';
        a7.enabled = false;
    }
    a7.hint = (a7.hint ?? '') + text3;
    return slots(a3, a4, a5, a6, null, null, a7, RETURN_TO_TOP());
}

/** Up to seven facility / wonder buttons (Not Enough Money disables) + Return to Top. */
function facilitySlots(ctx: SelectionContext, defs: Facility[]): Slots {
    const out: Slots = [null, null, null, null, null, null, null];
    for (let l = 0; l < defs.length; l++) {
        const a = createShipAction(ShipActionType.BuildPlanetaryFacility, defs[l]);
        a.hint = selectionActionHint(ctx, a);
        if (calculatePlanetaryFacilityCost(defs[l], ctx.empire) > ctx.empire.stateMoney) {
            a.enabled = false;
            a.hint = a.hint + NOT_ENOUGH_MONEY();
        }
        if (l < 7) out[l] = a; // the C# switch keeps only indices 0-6
    }
    out.push(RETURN_TO_TOP());
    return out;
}

/** Main.Part3.cs 2431-2490: ColonyBuildWonder. */
function colonyWonderSlots(ctx: SelectionContext): Slots | null {
    const sel = ctx.selected;
    if (sel === null || !isHabitat(sel)) return null;
    if (sel.empire !== ctx.empire || sel.population === null || sel.population.totalAmount <= 0) return null;
    return facilitySlots(ctx, resolveBuildableWonders(ctx.galaxy, sel));
}

/** Main.Part3.cs 2491-2634: BuildOptionsPrivate for a base (civilian ships). */
function buildOptionsPrivateSlots(ctx: SelectionContext): Slots | null {
    const sel = ctx.selected;
    if (sel === null || !isBuiltObject(sel)) return null;
    if (sel.role !== BuiltObjectRole.Base) return null;
    const offset: Point = { x: 0, y: 0 };
    const roles = [
        BuiltObjectSubRole.SmallFreighter,
        BuiltObjectSubRole.MediumFreighter,
        BuiltObjectSubRole.LargeFreighter,
        BuiltObjectSubRole.PassengerShip,
        BuiltObjectSubRole.MiningShip,
        BuiltObjectSubRole.GasMiningShip,
    ];
    const rs = roles.map((role) => newestOrReason(ctx, role, null));
    const actions = rs.map((r) => buildButton(ctx, sel, offset, r.design));
    roles.forEach((role, i) => {
        if (rs[i].design === null) {
            actions[i].design = findNewestIncludingObsolete(ctx.empire.designs, role);
            actions[i].enabled = false;
        }
    });
    actions.forEach((a) => (a.hint = selectionActionHint(ctx, a)));
    actions.forEach((a, i) => (a.hint = (a.hint ?? '') + rs[i].reason));
    return slots(actions[0], actions[1], actions[2], actions[3], actions[4], actions[5], null, RETURN_TO_TOP());
}

/** Main.Part3.cs 2635-2745: ColonyBuildOptions (own colony facilities, or a pirate's controlled colony). */
function colonyFacilitySlots(ctx: SelectionContext): Slots | null {
    const sel = ctx.selected;
    if (sel === null || !isHabitat(sel)) return null;
    const habitat = sel;
    if (habitat.empire === ctx.empire && habitat.population !== null && habitat.population.totalAmount > 0) {
        return facilitySlots(ctx, resolveBuildableFacilities(ctx.galaxy, habitat));
    }
    if (!habitat.pirateColonyControl.checkFactionHasControl(ctx.empire) || habitat.population === null || habitat.population.totalAmount <= 0) return null;
    return facilitySlots(ctx, resolveBuildableFacilitiesPirates(ctx.galaxy, habitat, ctx.empire));
}

/** Main.Part3.cs 2749-3200: the top-level buttons for a selected habitat. */
function habitatSlots(ctx: SelectionContext, habitat4: Habitat): Slots {
    const player = ctx.empire;
    const galaxy = ctx.galaxy;
    if (habitat4.owner === player) {
        // 2752-2898: recruit troops ×5, defense / smuggling missions, wonders, facilities, build options.
        const recruit: (ShipAction | null)[] = [null, null, null, null, null];
        const r = resolveRecruitableTroopsForColony(galaxy, habitat4);
        for (let m = 0; m < r.troops.length; m++) {
            if (r.troops[m] === null || m > 4) continue;
            const a = createShipAction(ShipActionType.RecruitTroops, habitat4);
            a.target2 = r.troops[m];
            if (r.cloneIndex === m) a.extraData = 'clone';
            else if (r.roboticIndex === m) a.extraData = 'robotic';
            else if (r.eliteIndex === m) a.extraData = 'elite';
            recruit[m] = a;
        }
        let [a29, a30, a31, a32, a33] = recruit;
        const a34 = createShipAction(ShipActionType.ColonyBuildOptions, habitat4);
        const a35 = createShipAction(ShipActionType.ColonyBuildWonder, habitat4);
        a34.hint = selectionActionHint(ctx, a34);
        a35.hint = selectionActionHint(ctx, a35);
        if (resolveBuildableFacilities(galaxy, habitat4).length <= 0) {
            a34.enabled = false;
            a34.hint = a34.hint + ' (' + T('No buildable facilities') + ')';
        }
        if (resolveBuildableWonders(galaxy, habitat4).length <= 0) {
            a35.enabled = false;
            a35.hint = a35.hint + ' (' + T('No buildable wonders') + ')';
        }
        const a36 = createShipAction(ShipActionType.GeneratePirateMissionDefend, habitat4);
        a36.hint = F(T('Assign Mercenary Defense Mission'), habitat4.name, n0(calculatePirateDefendPrice(galaxy, player, habitat4)));
        if (player.pirateMissions.containsEquivalentTarget(habitat4, EmpireActivityType.Defend)) {
            a36.enabled = false;
            a36.hint = a36.hint + ' (' + upper(T('Mission Already Assigned')) + ')';
        }
        if (a32 === null) a32 = a36;
        const a37 = createShipAction(ShipActionType.GeneratePirateMissionSmuggling, habitat4);
        a37.hint = F(T('Assign Mercenary Smuggling Mission'), habitat4.name);
        if (player.pirateMissions.containsEquivalentTarget(habitat4, EmpireActivityType.Smuggle)) {
            a37.enabled = false;
            a37.hint = a37.hint + ' (' + upper(T('Mission Already Assigned')) + ')';
        }
        if (a33 === null) a33 = a37;
        return slots(a29, a30, a31, a32, a33, a35, a34, createShipAction(ShipActionType.BuildOptions, habitat4));
    }
    if (habitat4.owner !== galaxy.independentEmpire && habitat4.owner !== null) {
        // 2900-2940: a foreign colony.
        if (player.pirateEmpireBaseHabitat !== null) {
            if (habitat4.pirateColonyControl.checkFactionHasControl(player)) {
                const a38 = createShipAction(ShipActionType.ColonyBuildOptions, habitat4);
                a38.hint = selectionActionHint(ctx, a38);
                if (resolveBuildableFacilitiesPirates(galaxy, habitat4, player).length <= 0) {
                    a38.enabled = false;
                    a38.hint = a38.hint + ' (' + T('No buildable facilities') + ')';
                }
                return slots(null, null, null, null, null, null, null, a38);
            }
            return EMPTY_SLOTS();
        }
        return slots(null, null, null, null, null, null, deployVirusSlot(ctx, habitat4), null);
    }
    // 2941-3200: an unowned (or independent) habitat — colonize and the bases the player can build there.
    let p = galaxy.selectRelativeHabitatSurfacePoint(habitat4); // Rnd
    let offset3: Point = { x: Math.trunc(p.x), y: Math.trunc(p.y) };
    if (habitat4.category === HabitatCategoryType.Star) {
        let minimumDistance = Math.trunc(habitat4.diameter / 2) + 600.0;
        if (habitat4.type === HabitatType.BlackHole) minimumDistance = Math.trunc(habitat4.diameter / 2) + 5000.0;
        else if (habitat4.type === HabitatType.SuperNova) minimumDistance = 3000.0;
        p = galaxy.selectRelativeParkingPoint(minimumDistance); // Rnd
        offset3 = { x: Math.trunc(p.x), y: Math.trunc(p.y) };
    }
    let a41: ShipAction | null = null;
    let a42: ShipAction | null = null;
    let text24 = '';
    if (player.pirateEmpireBaseHabitat !== null) {
        let text25 = '';
        let design24 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.SmallSpacePort, null);
        const design25 = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.SmallSpacePort);
        if (determineSpacePortAtHabitat(habitat4) !== null) {
            design24 = null;
            text25 = ' (' + upper(T('Spaceport Already Here')) + ')';
        }
        if (design24 !== null && design24.calculateCurrentPurchasePrice(galaxy) > player.stateMoney) {
            design24 = null;
            text25 = NOT_ENOUGH_MONEY();
        }
        a41 = missionActionAt(BuiltObjectMissionType.Build, habitat4, offset3, design24);
        if (design24 === null) {
            a41.design = design25;
            a41.enabled = false;
        }
        a41.hint = selectionActionHint(ctx, a41) + text25;
    } else {
        a42 = createShipAction(ShipActionType.BuildColonize, habitat4);
        if (checkColonizingHabitat(player, habitat4) !== null) {
            a42.enabled = false;
            text24 = ' (' + upper(T('Already Colonizing')) + ')';
        }
        if (!galaxy.checkEmpireTerritoryCanColonizeHabitat(player, habitat4)) {
            a42.enabled = false;
            text24 = ' (' + upper(T("In another empire's territory")) + ')';
        }
    }
    const designList = checkBasesToBeBuiltAtHabitat(player, habitat4);
    let text26 = '';
    let design26 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.MiningStation, null);
    const resourceIds = galaxy.resolveValidResourcesForHabitatExcludeManufactured(habitat4);
    if (resourceIds.some((id) => { const res = galaxy.resourceSystem.resources[id]; return res !== undefined && resourceGroupOf(res) === ResourceGroup.Gas; })) {
        design26 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.GasMiningStation, null);
    }
    let text27 = '';
    let design27 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.EnergyResearchStation, null);
    if (habitat4.researchBonus > 0) {
        switch (habitat4.researchBonusIndustry) {
            case IndustryType.Weapon:
                design27 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.WeaponsResearchStation, null);
                break;
            case IndustryType.Energy:
                design27 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.EnergyResearchStation, null);
                break;
            case IndustryType.HighTech:
                design27 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.HighTechResearchStation, null);
                break;
        }
    }
    if (player.pirateEmpireBaseHabitat !== null) design27 = null;
    let text28 = '';
    const design28 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.MonitoringStation, null);
    let empty = '';
    const design29 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.ResortBase, null);
    let a43: ShipAction | null = missionActionAt(BuiltObjectMissionType.Build, habitat4, offset3, design26);
    if (design26 === null) {
        a43.design = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.MiningStation);
        text26 = CANNOT_BUILD(); // the C# leaves this button enabled
    } else if (design26.calculateCurrentPurchasePrice(galaxy) > getPrivateFunds(player)) {
        a43.enabled = false;
        text26 = NOT_ENOUGH_MONEY();
    }
    let a44: ShipAction | null = missionActionAt(BuiltObjectMissionType.Build, habitat4, offset3, design27);
    if (design27 === null) {
        a44.design = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.EnergyResearchStation);
        a44.enabled = false;
        text27 = CANNOT_BUILD();
    } else if (habitat4.researchBonus <= 0) {
        a44.enabled = false;
        text27 = ' (' + upper(T('No Research Bonus Here')) + ')';
    } else if (checkResearchStationAtLocation(galaxy, habitat4)) {
        a44.enabled = false;
        text27 = ' (' + upper(T('Research Station Already Here')) + ')';
    } else if (design27.calculateCurrentPurchasePrice(galaxy) > player.stateMoney) {
        a44.enabled = false;
        text27 = NOT_ENOUGH_MONEY();
    }
    let a45: ShipAction | null = missionActionAt(BuiltObjectMissionType.Build, habitat4, offset3, design28);
    if (design28 === null) {
        a45.design = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.MonitoringStation);
        a45.enabled = false;
        text28 = CANNOT_BUILD();
    } else if (design28.calculateCurrentPurchasePrice(galaxy) > player.stateMoney) {
        a45.enabled = false;
        text28 = NOT_ENOUGH_MONEY();
    }
    let a46: ShipAction | null = missionActionAt(BuiltObjectMissionType.Build, habitat4, offset3, design29);
    const wonders = habitat4.facilities !== null ? facilitiesCountCompletedByType(habitat4.facilities, PlanetaryFacilityType.Wonder) : 0;
    if (design29 === null) {
        a46.design = findNewestIncludingObsolete(player.designs, BuiltObjectSubRole.ResortBase);
        a46.enabled = false;
        empty = CANNOT_BUILD();
    } else if (habitat4.scenicFactor <= 0 && habitat4.ruin === null && (habitat4.facilities === null || wonders <= 0)) {
        a46.enabled = false;
        empty = ' (' + upper(T('No Scenery Bonus Here')) + ')';
    } else if (design29.calculateCurrentPurchasePrice(galaxy) > player.stateMoney) {
        a46.enabled = false;
        empty = NOT_ENOUGH_MONEY();
    } else {
        let empty2 = '';
        if (habitat4.scenicFactor > 0) empty2 = T('Natural scenery');
        else if (habitat4.ruin !== null) empty2 = T('Ancient Ruins');
        else if (habitat4.facilities !== null && wonders > 0) empty2 = T('Planetary Wonders');
        empty = ' (' + F(T('Tourism from X'), empty2) + ')';
    }
    if (player.pirateEmpireBaseHabitat === null && !checkEmpireTerritoryCanBuildAtHabitat(galaxy, player, habitat4)) {
        const territory = ' (' + upper(T("In another empire's territory")) + ')';
        a43.enabled = false;
        text26 = territory;
        a44.enabled = false;
        text27 = territory;
        a45.enabled = false;
        text28 = territory;
        a46.enabled = false;
        empty = territory;
    }
    if (a42 !== null) a42.hint = selectionActionHint(ctx, a42);
    a43.hint = selectionActionHint(ctx, a43);
    a44.hint = selectionActionHint(ctx, a44);
    a45.hint = selectionActionHint(ctx, a45);
    a46.hint = selectionActionHint(ctx, a46);
    if (player.pirateEmpireBaseHabitat === null) {
        const colonizableHabitatTypes = player.colonizableHabitatTypesForEmpire();
        const design30 = findNewestCanBuildFullEvaluate(player.designs, BuiltObjectSubRole.ColonyShip, null);
        if (!canEmpireColonizeHabitat(galaxy, player, player, habitat4, colonizableHabitatTypes, design30)) {
            a42!.enabled = false;
            text24 = ' (' + upper(T('Cannot Colonize')) + ')';
        } else if (design30 === null) {
            a42!.enabled = false;
            text24 = ' (' + upper(T('No Colony Ship Design')) + ')';
        } else if (design30.calculateCurrentPurchasePrice(galaxy) > player.stateMoney) {
            a42!.enabled = false;
            text24 = NOT_ENOUGH_MONEY();
        }
    }
    if (containsSubRole(designList, BuiltObjectSubRole.MiningStation) || containsSubRole(designList, BuiltObjectSubRole.GasMiningStation)) {
        a43.enabled = false;
        text26 = ' (' + upper(T('Already Building Mining Station Here')) + ')';
    }
    if (containsSubRole(designList, BuiltObjectSubRole.MonitoringStation)) {
        a45.enabled = false;
        text28 = ' (' + upper(T('Already Building Monitoring Station Here')) + ')';
    }
    if (containsSubRole(designList, BuiltObjectSubRole.ResortBase)) {
        a46.enabled = false;
        empty = ' (' + upper(T('Already Building Resort Base Here')) + ')';
    }
    if (containsSubRole(designList, BuiltObjectSubRole.EnergyResearchStation) || containsSubRole(designList, BuiltObjectSubRole.WeaponsResearchStation) || containsSubRole(designList, BuiltObjectSubRole.HighTechResearchStation)) {
        a44.enabled = false;
        text27 = ' (' + upper(T('Already Building Research Station Here')) + ')';
    }
    if (checkAlreadyHaveMiningStationAtHabitat(habitat4, player)) {
        a43.enabled = false;
        text26 = ' (' + upper(T('Mining Station Already Here')) + ')';
    }
    if (a42 !== null) a42.hint = (a42.hint ?? '') + text24;
    a43.hint = (a43.hint ?? '') + text26;
    a44.hint = (a44.hint ?? '') + text27;
    a45.hint = (a45.hint ?? '') + text28;
    a46.hint = (a46.hint ?? '') + empty;
    if (habitat4.category === HabitatCategoryType.Star) a43 = null;
    if (habitat4.category !== HabitatCategoryType.Planet && habitat4.category !== HabitatCategoryType.Moon) a42 = null;
    if (habitat4.type === HabitatType.GasGiant || habitat4.type === HabitatType.FrozenGasGiant || habitat4.type === HabitatType.BarrenRock) a42 = null;
    if (a41 !== null && a41.design === null) a41 = null;
    if (a44.design === null) a44 = null;
    if (a45.design === null) a45 = null;
    if (a46.design === null) a46 = null;
    const a47 = habitat4.population !== null && habitat4.population.totalAmount > 0 && habitat4.empire !== null ? deployVirusSlot(ctx, habitat4) : null;
    if (player.pirateEmpireBaseHabitat === null) return slots(a42, a43, a44, a45, a46, null, a47, null);
    if (habitat4.pirateColonyControl.checkFactionHasControl(player)) {
        const a49 = createShipAction(ShipActionType.ColonyBuildOptions, habitat4);
        a49.hint = selectionActionHint(ctx, a49);
        if (resolveBuildableFacilitiesPirates(galaxy, habitat4, player).length <= 0) {
            a49.enabled = false;
            a49.hint = a49.hint + ' (' + T('No buildable facilities') + ')';
        }
        return slots(a41, a43, a44, a45, a46, null, a47, a49);
    }
    return slots(a41, a43, a44, a45, a46, null, a47, null);
}

/** Main.Part3.cs 2920-2937 / 3200-3218: DeployVirus when the player has the Xaraktor virus (disabled with its reason). */
function deployVirusSlot(ctx: SelectionContext, habitat: Habitat): ShipAction | null {
    let action: ShipAction | null = null;
    if (habitat.population !== null && habitat.population.totalAmount > 0 && habitat.empire !== null) {
        const r = canDeployXaraktorVirus(ctx.galaxy, ctx.empire);
        if (r.virus !== null) {
            action = createShipAction(ShipActionType.DeployVirus, habitat);
            action.target2 = r.virus;
            action.hint = selectionActionHint(ctx, action);
            if (!r.result) {
                action.hint = action.hint + ' (' + upper(r.reason) + ')';
                action.enabled = false;
            }
        }
    }
    return action;
}

/** "Queue construction ship to Repair X" (+ ALREADY REPAIRING). */
function queueRepairAction(ctx: SelectionContext, bo: BuiltObject): ShipAction {
    const a = missionAction(BuiltObjectMissionType.Build, bo);
    a.hint = F(T('Queue construction ship to Repair X'), bo.name);
    if (checkTargetOfRepairMission(bo.empire!, bo)) {
        a.enabled = false;
        a.hint = a.hint + ' (' + upper(T('Already Repairing')) + ')';
    }
    return a;
}

/** A base's retrofit button (Main.Part3.cs 3239-3262 / 3510-3530). */
function baseRetrofitButton(ctx: SelectionContext, bo: BuiltObject): ShipAction {
    const player = ctx.empire;
    let text = '';
    const design = findNewestCanBuildFullEvaluate(player.designs, bo.subRole, bo.parentHabitat);
    const action = missionActionAt(BuiltObjectMissionType.Retrofit, bo, { x: 0, y: 0 }, design);
    const r = determineRetrofitAffordability(ctx.galaxy, player, bo, design);
    if (design !== null && design !== bo.design) {
        if (r.cost > player.stateMoney) {
            action.enabled = false;
            text = NOT_ENOUGH_MONEY();
        } else if (bo.retrofitDesign !== null || bo.builtAt !== null) {
            action.enabled = false;
            text = ' (' + upper(T('Already Retrofitting')) + ')';
        }
    } else {
        action.enabled = false;
        text = ' (' + upper(T('Already Latest Design')) + ')';
    }
    action.hint = selectionActionHint(ctx, action) + text;
    return action;
}

/** A base's mercenary defense button (Main.Part3.cs 3272-3278). */
function baseDefendButton(ctx: SelectionContext, bo: BuiltObject): ShipAction {
    const a = createShipAction(ShipActionType.GeneratePirateMissionDefend, bo);
    a.hint = F(T('Assign Mercenary Defense Mission'), bo.name, n0(calculatePirateDefendPrice(ctx.galaxy, ctx.empire, bo)));
    if (ctx.empire.pirateMissions.containsEquivalentTarget(bo, EmpireActivityType.Defend)) {
        a.enabled = false;
        a.hint = a.hint + ' (' + upper(T('Mission Already Assigned')) + ')';
    }
    return a;
}

/** Main.Part3.cs 3219-3563: the top-level buttons for a selected ship / base. */
function builtObjectSlots(ctx: SelectionContext, builtObject5: BuiltObject): Slots {
    const player = ctx.empire;
    const galaxy = ctx.galaxy;
    if (builtObject5.owner === player) {
        if (builtObject5.isFunctional && builtObject5.builtAt === null) {
            if (builtObject5.role === BuiltObjectRole.Base) {
                // 3228-3285
                let a50: ShipAction | null = null;
                let a23: ShipAction | null = null;
                let a51: ShipAction | null = null;
                let a52: ShipAction | null = null;
                if (builtObject5.isShipYard && hasConstructionYards(builtObject5)) {
                    a23 = createShipAction(ShipActionType.BuildOptions, builtObject5);
                    if (player.pirateEmpireBaseHabitat !== null) a51 = createShipAction(ShipActionType.BuildOptionsPrivate, builtObject5);
                }
                if (builtObject5.fighterCapacity > 0 || (builtObject5.fighters !== null && builtObject5.fighters.length > 0)) a52 = createShipAction(ShipActionType.FighterOptions, builtObject5);
                const a53 = baseRetrofitButton(ctx, builtObject5);
                if (builtObject5.damagedComponentCount > 0 && (builtObject5.parentHabitat === null || builtObject5.parentHabitat.empire !== builtObject5.empire)) a50 = queueRepairAction(ctx, builtObject5);
                const a55 = baseDefendButton(ctx, builtObject5);
                if (a51 !== null) return slots(a53, a50, a55, null, null, a52, a51, a23);
                return slots(a53, a50, a55, null, null, null, a52, a23);
            }
            // 3286-3456: a ship.
            let a57: ShipAction | null = null;
            let a24: ShipAction | null = null;
            let a25: ShipAction | null = null;
            let a59: ShipAction | null = null;
            const a56 = !builtObject5.isAutoControlled ? createShipAction(ShipActionType.AutomateShip, builtObject5) : createShipAction(ShipActionType.UnautomateShip, builtObject5);
            // `if (SubRole == ExplorationShip) new ShipAction(Explore, NearestSystemStar)` — built and dropped in the C#.
            let text30 = '';
            if (builtObject5.troopCapacity > 0) {
                a57 = missionAction(BuiltObjectMissionType.LoadTroops, null);
                if (builtObject5.troopCapacityRemaining < 100) {
                    a57.enabled = false;
                    text30 = ' (' + upper(T('Troop Carrier Full')) + ')';
                }
                a57.hint = selectionActionHint(ctx, a57) + text30;
            }
            if (builtObject5.fighterCapacity > 0 || (builtObject5.fighters !== null && builtObject5.fighters.length > 0)) a24 = createShipAction(ShipActionType.FighterOptions, builtObject5);
            if (builtObject5.role === BuiltObjectRole.Military && (builtObject5.firepowerRaw > 0 || builtObject5.fighterCapacity > 0)) {
                if (shipGroupOf(builtObject5) === null) {
                    let target: ShipGroup | null = null;
                    let num8 = Number.MAX_VALUE;
                    for (const g of playerShipGroups(player)) {
                        if (g.leadShip !== null) {
                            const num9 = galaxy.calculateDistance(builtObject5.xpos, builtObject5.ypos, g.leadShip.xpos, g.leadShip.ypos);
                            if (num9 < num8) {
                                target = g;
                                num8 = num9;
                            }
                        }
                    }
                    a25 = createShipAction(ShipActionType.JoinShipGroup, target);
                } else {
                    a25 = createShipAction(ShipActionType.LeaveShipGroup, null);
                }
            }
            const fuelTypes = determineFuelRequired(builtObject5); // DetermineFuelRequired() = (setFuelLevelToZero: true)
            const stellarObject = fastFindNearestRefuellingPoint(galaxy, builtObject5.xpos, builtObject5.ypos, fuelTypes, builtObject5.actualEmpire, builtObject5);
            const stellarObject2 = findNearestShipYard(galaxy, player, builtObject5, true, true);
            let a58: ShipAction;
            if (builtObject5.unbuiltOrDamagedComponentCount > 0) {
                a58 = missionAction(BuiltObjectMissionType.Repair, stellarObject2);
                if (stellarObject2 === null) a58.enabled = false;
            } else {
                a58 = missionAction(BuiltObjectMissionType.Refuel, stellarObject);
                if (stellarObject === null) a58.enabled = false;
            }
            if (builtObject5.damagedComponentCount > 0) {
                if (builtObject5.topSpeed === 0 || (builtObject5.warpSpeed === 0 && builtObject5.design !== null && builtObject5.design.warpSpeed > 0)) a59 = queueRepairAction(ctx, builtObject5);
            } else {
                let text31 = '';
                const design32 = findNewestCanBuildFullEvaluate(player.designs, builtObject5.subRole, builtObject5.parentHabitat);
                a59 = missionActionAt(BuiltObjectMissionType.Retrofit, stellarObject2, { x: 0, y: 0 }, design32);
                const r = determineRetrofitAffordability(galaxy, player, builtObject5, design32);
                if (design32 !== null && design32 !== builtObject5.design) {
                    if (r.cost > player.stateMoney) {
                        a59.enabled = false;
                        text31 = NOT_ENOUGH_MONEY();
                    } else if (builtObject5.retrofitDesign !== null || builtObject5.builtAt !== null || missionTypeOf(builtObject5.mission) === BuiltObjectMissionType.Retrofit) {
                        a59.enabled = false;
                        text31 = ' (' + upper(T('Already Retrofitting')) + ')';
                    }
                } else {
                    a59.enabled = false;
                    text31 = ' (' + upper(T('Already Latest Design')) + ')';
                }
                if (stellarObject2 === null) a59.enabled = false;
                a59.hint = selectionActionHint(ctx, a59) + text31;
            }
            return slots(missionAction(BuiltObjectMissionType.Hold, builtObject5), a58, a59, missionAction(BuiltObjectMissionType.Escape, null), a57, a25, a56, a24);
        }
        // 3457-3492: a ship / base under construction or not functional — only a repair order.
        let a61: ShipAction | null = null;
        if (builtObject5.damagedComponentCount > 0) {
            if (builtObject5.role === BuiltObjectRole.Base && (builtObject5.parentHabitat === null || builtObject5.parentHabitat.empire !== builtObject5.empire)) {
                a61 = missionAction(BuiltObjectMissionType.Build, builtObject5);
            } else if (builtObject5.role !== BuiltObjectRole.Base && builtObject5.owner === player) {
                if (builtObject5.topSpeed !== 0 && (builtObject5.warpSpeed !== 0 || builtObject5.design === null || builtObject5.design.warpSpeed <= 0)) {
                    a61 = missionAction(BuiltObjectMissionType.Repair, null);
                    const yard = findNearestShipYard(galaxy, builtObject5.empire!, builtObject5, true, true);
                    if (yard !== null) {
                        a61.target = yard;
                        a61.hint = F(T('Repair at X'), nameOf(yard));
                    } else {
                        a61 = missionAction(BuiltObjectMissionType.Build, builtObject5);
                    }
                } else {
                    a61 = missionAction(BuiltObjectMissionType.Build, builtObject5);
                }
            }
        }
        if (a61 !== null && (a61.hint === null || a61.hint === '')) {
            a61.hint = F(T('Queue construction ship to Repair X'), builtObject5.name);
            if (checkTargetOfRepairMission(builtObject5.empire!, builtObject5)) {
                a61.enabled = false;
                a61.hint = a61.hint + ' (' + upper(T('Already Repairing')) + ')';
            }
        }
        return slots(a61, null, null, null, null, null, null, null);
    }
    if (builtObject5.empire === player) {
        // 3494-3547: a base of the player's empire it does not own.
        if (builtObject5.role === BuiltObjectRole.Base) {
            const a26 = missionAction(BuiltObjectMissionType.Retire, builtObject5);
            const a63 = baseRetrofitButton(ctx, builtObject5);
            let a64: ShipAction | null = null;
            if (builtObject5.damagedComponentCount > 0) {
                // the Base test is always true in this branch
                if (builtObject5.parentHabitat === null || builtObject5.parentHabitat.empire !== builtObject5.empire) a64 = missionAction(BuiltObjectMissionType.Build, builtObject5);
            }
            if (a64 !== null) {
                a64.hint = F(T('Queue construction ship to Repair X'), builtObject5.name);
                if (checkTargetOfRepairMission(builtObject5.empire, builtObject5)) {
                    a64.enabled = false;
                    a64.hint = a64.hint + ' (' + upper(T('Already Repairing')) + ')';
                }
            }
            return slots(a26, a63, a64, baseDefendButton(ctx, builtObject5), null, null, null, null);
        }
        return EMPTY_SLOTS();
    }
    if (builtObject5.empire !== null && builtObject5.empire.pirateEmpireBaseHabitat !== null && builtObject5.role === BuiltObjectRole.Base) {
        // 3549-3565: a pirate base.
        const a67 = createShipAction(ShipActionType.AssignAttack, builtObject5);
        const assigned = resolveAssignedFleet(player, new PrioritizedTarget(builtObject5, 1000));
        if (assigned.fleet !== null) {
            a67.hint = T('Attack with nearest available fleet') + ' (' + upper(assigned.fleet.name ?? '') + ' ' + upper(T('Already Attacking')) + ')';
            a67.enabled = false;
        }
        const a68 = createShipAction(ShipActionType.GeneratePirateMissionAttack, builtObject5);
        a68.hint = F(T('Assign Mercenary Attack Mission'), builtObject5.name, n0(calculatePirateAttackPrice(galaxy, player, builtObject5)));
        if (player.pirateMissions.containsEquivalentTarget(builtObject5, EmpireActivityType.Attack)) {
            a68.enabled = false;
            a68.hint = a68.hint + ' (' + upper(T('Mission Already Assigned')) + ')';
        }
        return slots(a67, a68, null, null, null, null, null, null);
    }
    let a69: ShipAction | null = null;
    if (builtObject5.role === BuiltObjectRole.Base) {
        a69 = createShipAction(ShipActionType.GeneratePirateMissionAttack, builtObject5);
        a69.hint = F(T('Assign Mercenary Attack Mission'), builtObject5.name, n0(calculatePirateAttackPrice(galaxy, player, builtObject5)));
        if (player.pirateMissions.containsEquivalentTarget(builtObject5, EmpireActivityType.Attack)) {
            a69.enabled = false;
            a69.hint = a69.hint + ' (' + upper(T('Mission Already Assigned')) + ')';
        }
    }
    return slots(a69, null, null, null, null, null, null, null);
}

/** Main.Part3.cs 3582-3645: the top-level buttons for a selected fleet. */
function fleetSlots(ctx: SelectionContext, shipGroup2: ShipGroup): Slots {
    const player = ctx.empire;
    const galaxy = ctx.galaxy;
    if (shipGroup2.empire !== player) return EMPTY_SLOTS();
    const lead = shipGroup2.leadShip!;
    const a71 = createShipAction(ShipActionType.AutomateShip, shipGroup2);
    if (lead.isAutoControlled) a71.actionType = ShipActionType.UnautomateShip;
    const resourceList2 = shipGroupCalculateRequiredFuel(shipGroup2);
    let stellarObject4 = decideBestFleetRefuelPoint(galaxy, player, lead.xpos, lead.ypos, player, resourceList2, null);
    let a72 = missionAction(BuiltObjectMissionType.Refuel, stellarObject4);
    if (shipGroupTotalDamage(shipGroup2) > 0) {
        const stellarObject5 = findNearestShipYard(galaxy, player, lead, true, false);
        a72 = missionAction(BuiltObjectMissionType.Repair, stellarObject5);
        if (stellarObject5 === null) a72.enabled = false;
    } else if (stellarObject4 === null) {
        stellarObject4 = fastFindNearestRefuellingPoint(galaxy, lead.xpos, lead.ypos, resourceList2, shipGroup2.empire, lead, true, null, shipGroup2.ships.length);
        a72 = missionAction(BuiltObjectMissionType.Refuel, stellarObject4);
        if (stellarObject4 === null) a72.enabled = false;
    }
    // `new ShipAction(Retrofit, shipGroup2)` — built and dropped in the C#.
    const a73 = missionAction(BuiltObjectMissionType.LoadTroops, shipGroup2);
    const a74 = missionAction(BuiltObjectMissionType.Move, shipGroup2.gatherPoint);
    if (shipGroup2.gatherPoint === null) a74.enabled = false;
    let text33 = '';
    if (shipGroupTotalTroopSpaceRemaining(shipGroup2) < 100) {
        a73.enabled = false;
        text33 = ' (' + upper(T('All Troop Carriers Full')) + ')';
    }
    a73.hint = selectionActionHint(ctx, a73) + text33;
    const a75 = createShipAction(ShipActionType.SetFleetHomeBase, shipGroup2);
    a75.hint = selectionActionHint(ctx, a75);
    const a76 = createShipAction(ShipActionType.SetFleetAttackPoint, shipGroup2);
    a76.hint = selectionActionHint(ctx, a76);
    const a77 = createShipAction(ShipActionType.SetFleetPosture, shipGroup2);
    a77.hint = selectionActionHint(ctx, a77);
    const a78 = createShipAction(ShipActionType.SetFleetRange, shipGroup2);
    a78.hint = selectionActionHint(ctx, a78);
    void a74; // built (and Enabled set) but not shown in the C#
    return slots(missionAction(BuiltObjectMissionType.Hold, shipGroup2), a72, a73, a75, a76, a77, a78, a71);
}

/** ItemListCollectionPanel.cs 822 ResolveAssignedFleet(target, out missionQueueIndex): the player's fleet attacking `target` now or later. */
export function resolveAssignedFleet(empire: Empire, target: PrioritizedTarget): { fleet: ShipGroup | null; missionQueueIndex: number } {
    const isAttackType = (t: BuiltObjectMissionType): boolean =>
        t === BuiltObjectMissionType.Attack || t === BuiltObjectMissionType.Bombard || t === BuiltObjectMissionType.WaitAndAttack || t === BuiltObjectMissionType.WaitAndBombard;
    const tgt = target.target;
    for (const g of playerShipGroups(empire)) {
        const m = g.mission;
        if (m === null || !isAttackType(m.type) || m.target !== tgt) {
            if (g.subsequentMissions === null || g.subsequentMissions.length <= 0) continue;
            for (let j = 0; j < g.subsequentMissions.length; j++) {
                const q = g.subsequentMissions[j];
                if (q !== null && isAttackType(q.type) && q.target === tgt) return { fleet: g, missionQueueIndex: j + 1 };
            }
            continue;
        }
        return { fleet: g, missionQueueIndex: 0 };
    }
    return { fleet: null, missionQueueIndex: 0 };
}

/**
 * Main.Part3.cs 1208 method_588(button, action) (+ the hover text of Main.Part10.cs 738-793): the button's Tag,
 * Enabled, colour family and hint. Action / mission types without a button image clear the Tag (the button does
 * nothing), as do Build buttons without a design or repair target.
 */
export function selectionButton(ctx: SelectionContext, action: ShipAction | null): SelectionButton {
    const out: SelectionButton = { action: null, enabled: false, hint: '', style: '', count: 0 };
    if (action === null) return out;
    let tag: ShipAction | null = action;
    let style: SelectionButtonStyle = '';
    if (action.actionType !== ShipActionType.Undefined) {
        switch (action.actionType) {
            case ShipActionType.RecruitTroops:
            case ShipActionType.AutomateShip:
            case ShipActionType.JoinShipGroup:
            case ShipActionType.LeaveShipGroup:
            case ShipActionType.BuildColonize:
            case ShipActionType.ReturnToTop:
            case ShipActionType.UnautomateShip:
            case ShipActionType.CreateNewFleet:
            case ShipActionType.AssignAttack:
            case ShipActionType.SetFleetPosture:
            case ShipActionType.SetFleetRange:
            case ShipActionType.SetFleetAttackPoint:
            case ShipActionType.SetFleetHomeBase:
            case ShipActionType.GeneratePirateMissionAttack:
            case ShipActionType.GeneratePirateMissionDefend:
            case ShipActionType.GeneratePirateMissionSmuggling:
                break;
            case ShipActionType.FighterOptions:
            case ShipActionType.FighterBuildFighter:
            case ShipActionType.FighterBuildBomber:
            case ShipActionType.FighterLaunchFighters:
            case ShipActionType.FighterLaunchBombers:
            case ShipActionType.FighterRetrieveFighters:
            case ShipActionType.FighterRetrieveBombers:
            case ShipActionType.FighterUpgradeAll:
                style = 'fighter';
                break;
            case ShipActionType.BuildOptions:
                style = 'build';
                break;
            case ShipActionType.ColonyBuildOptions:
                style = 'facility';
                break;
            case ShipActionType.ColonyBuildWonder:
                style = 'wonder';
                break;
            case ShipActionType.BuildOptionsPrivate:
                style = 'buildprivate';
                break;
            case ShipActionType.BuildPlanetaryFacility:
                if (isFacility(action.target)) style = facilityType(action.target) === PlanetaryFacilityType.Wonder ? 'wonder' : 'facility';
                break;
            case ShipActionType.DeployVirus:
                style = 'plague';
                break;
            default:
                tag = null;
                break;
        }
    } else if (action.missionType !== BuiltObjectMissionType.Undefined) {
        switch (action.missionType) {
            case BuiltObjectMissionType.Escape:
            case BuiltObjectMissionType.Retire:
            case BuiltObjectMissionType.Retrofit:
            case BuiltObjectMissionType.Hold:
            case BuiltObjectMissionType.Explore:
            case BuiltObjectMissionType.Repair:
            case BuiltObjectMissionType.Move:
            case BuiltObjectMissionType.Refuel:
            case BuiltObjectMissionType.LoadTroops:
                break;
            case BuiltObjectMissionType.Build:
                if (action.design !== null) {
                    const sel = ctx.selected;
                    if (isBuiltObject(sel) || isHabitat(sel)) {
                        const q = sel.constructionQueue as { countUnderConstruction?: (subRole: BuiltObjectSubRole) => number } | null;
                        if (q !== null && typeof q.countUnderConstruction === 'function') out.count = q.countUnderConstruction(action.design.subRole);
                    }
                    // TODO(port): Empire.CheckDesignResourcesAtConstructionYard (Empire.1.cs 3374) — the button's
                    // " (RESOURCE SHORTAGE: …)" hint suffix and warning overlay; ResolveResourcesFromComponents + cargo
                    // availability are not ported to src/sim yet.
                    style = 'build';
                } else if (isBuiltObject(action.target) && action.target.damagedComponentCount > 0 && action.target.empire === ctx.empire) {
                    // the repair button
                } else {
                    tag = null;
                }
                break;
            default:
                tag = null;
                break;
        }
    } else {
        tag = null;
    }
    out.action = tag;
    // `glassButton.Enabled = shipAction.Enabled` (a cleared Tag makes the click a no-op).
    out.enabled = tag !== null && action.enabled;
    out.style = style;
    out.hint = action.hint !== null && action.hint !== '' ? action.hint : selectionActionHint(ctx, tag);
    return out;
}

/** method_593 + method_585/588: the eight buttons, or null when the C# leaves them unchanged. */
/**
 * Whether selectionButtons(ctx, subMenu) may draw galaxy.rnd: an unowned / independent habitat's top page (habitatSlots,
 * Main.Part3.cs 2941-3200) or a habitat's Build Options (buildOptionsSlots, 2152-2310). Every other page only reads the
 * game (the UI builds those itself; these go through the journaled 'selectionButtons' command, playerOps.ts).
 */
export function selectionButtonsDrawRandom(ctx: { galaxy: Galaxy; empire: Empire; selected: ShipActionSelection }, subMenu: ShipAction | null): boolean {
    const sel = ctx.selected;
    if (!isHabitat(sel)) return false;
    if (subMenu === null) return sel.owner !== ctx.empire && (sel.owner === null || sel.owner === ctx.galaxy.independentEmpire);
    return subMenu.actionType === ShipActionType.BuildOptions;
}

export function selectionButtons(ctx: SelectionContext, subMenu: ShipAction | null): SelectionButton[] | null {
    const acts = selectionActions(ctx, subMenu);
    if (acts === null) return null;
    return acts.map((a) => selectionButton(ctx, a));
}

/**
 * Main.Part3.cs 3725 method_594(tag), after method_347(action, false): which button page to show next.
 * `undefined`: leave the page as is; `null`: the top level (method_592); a ShipAction: that sub-menu (method_593).
 */
export function selectionAfterClick(action: ShipAction): ShipAction | null | undefined {
    if (action.actionType !== ShipActionType.Undefined) {
        switch (action.actionType) {
            case ShipActionType.FighterBuildFighter:
            case ShipActionType.FighterBuildBomber:
            case ShipActionType.FighterLaunchFighters:
            case ShipActionType.FighterLaunchBombers:
            case ShipActionType.FighterRetrieveFighters:
            case ShipActionType.FighterRetrieveBombers:
                // method_593(new ShipAction(FighterOptions, null)): a null target leaves the buttons unchanged.
                return action.target instanceof Fighter ? undefined : createShipAction(ShipActionType.FighterOptions, null);
            case ShipActionType.BuildPlanetaryFacility:
                if (isFacility(action.target)) {
                    return facilityType(action.target) === PlanetaryFacilityType.Wonder ? createShipAction(ShipActionType.ColonyBuildWonder, null) : createShipAction(ShipActionType.ColonyBuildOptions, null);
                }
                return undefined;
            case ShipActionType.SetFleetPosture:
            case ShipActionType.SetFleetRange:
            case ShipActionType.AutomateShip:
            case ShipActionType.JoinShipGroup:
            case ShipActionType.LeaveShipGroup:
            case ShipActionType.BuildColonize:
            case ShipActionType.UnautomateShip:
                return null;
        }
        return undefined;
    }
    switch (action.missionType) {
        case BuiltObjectMissionType.Retrofit:
            return null;
        case BuiltObjectMissionType.Build:
            if (action.design !== null) {
                switch (action.design.subRole) {
                    case BuiltObjectSubRole.SmallFreighter:
                    case BuiltObjectSubRole.MediumFreighter:
                    case BuiltObjectSubRole.LargeFreighter:
                    case BuiltObjectSubRole.PassengerShip:
                    case BuiltObjectSubRole.GasMiningShip:
                    case BuiltObjectSubRole.MiningShip:
                        return createShipAction(ShipActionType.BuildOptionsPrivate, null);
                    default:
                        return createShipAction(ShipActionType.BuildOptions, null);
                }
            }
            return undefined;
    }
    return undefined;
}

/**
 * Main.Part11.cs 661-728 (every 500 ms while something is selected): refresh the button page from the first
 * button's Tag. `undefined`: no refresh (the first button has no Tag); `null`: the top level; else that sub-menu.
 */
export function selectionRefreshPage(selected: ShipActionSelection, firstButtonTag: ShipAction | null): ShipAction | null | undefined {
    if (selected === null || firstButtonTag === null) return undefined;
    const shipAction = firstButtonTag;
    if (shipAction.actionType !== ShipActionType.Undefined) {
        switch (shipAction.actionType) {
            case ShipActionType.FighterBuildFighter:
            case ShipActionType.FighterBuildBomber:
            case ShipActionType.FighterLaunchFighters:
            case ShipActionType.FighterLaunchBombers:
            case ShipActionType.FighterRetrieveFighters:
            case ShipActionType.FighterRetrieveBombers:
                return shipAction.target instanceof Fighter ? null : createShipAction(ShipActionType.FighterOptions, selected);
            case ShipActionType.BuildPlanetaryFacility:
                if (isFacility(shipAction.target)) {
                    return facilityType(shipAction.target) === PlanetaryFacilityType.Wonder ? createShipAction(ShipActionType.ColonyBuildWonder, selected) : createShipAction(ShipActionType.ColonyBuildOptions, selected);
                }
                return undefined;
            default:
                return null;
        }
    }
    if (shipAction.missionType !== BuiltObjectMissionType.Undefined) {
        if (shipAction.missionType === BuiltObjectMissionType.Build) {
            if (!isBuiltObject(shipAction.target) || shipAction.target !== selected) return createShipAction(ShipActionType.BuildOptions, null);
            return undefined;
        }
        return null;
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Automation prompt (GenerateAutomationMessageBox, Main.Part7.cs)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The flag each GenerateAutomationMessageBox(task) prompt of method_347 turns off on "off" (Main.Part7.cs 350-359,
 * 830-836, 883-887 and the Fleet Formation prompts): executeShipAction lists the prompts it asked in
 * result.automationPrompts; a UI that shows its dialog after the order (the C# message box is modal and blocks the
 * game) applies the player's answer with this. Returns false for an unknown task.
 */
export function applyAutomationOff(empire: Empire, task: string): boolean {
    switch (task) {
        case 'Colonization':
            empire.controlColonization = 0 as typeof empire.controlColonization; // AutomationLevel.Manual (C# 0)
            return true;
        case 'Ship Building':
            empire.controlStateConstruction = 0 as typeof empire.controlStateConstruction;
            return true;
        case 'Fleet Formation':
            empire.controlMilitaryFleets = false;
            return true;
        case 'Colony Tax Rates':
            empire.controlColonyTaxRates = false;
            return true;
        case 'Troop Recruitment':
            empire.controlTroopGeneration = false;
            return true;
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// The default right-click order under the cursor (Main.Part10.cs 45 mainView_MouseMove, 248-697)
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.MouseHoverHabitatProximityRange (Galaxy.3.cs 5052). */
export const MOUSE_HOVER_HABITAT_PROXIMITY_RANGE = 120.0;

/** Galaxy.6.cs 3613 FindNearestHabitatInSystem(system, x, y): the star or habitat nearest the point. */
function findNearestHabitatInSystem(galaxy: Galaxy, system: SystemInfo | null, x: number, y: number): Habitat | null {
    let num = Number.MAX_VALUE;
    let result: Habitat | null = null;
    if (system !== null) {
        if (system.systemStar !== null) {
            const num2 = galaxy.calculateDistanceSquared(x, y, system.systemStar.xpos, system.systemStar.ypos);
            if (num2 < num) {
                num = num2;
                result = system.systemStar;
            }
        }
        for (const habitat of planetsOf(system)) { // Galaxy.6.cs 3630 system.Habitats: no star (tested above)
            if (habitat === null) continue;
            const num3 = galaxy.calculateDistanceSquared(x, y, habitat.xpos, habitat.ypos);
            if (num3 < num) {
                result = habitat;
                num = num3;
            }
        }
    }
    return result;
}

/** The mouse cursor the C# shows with the default order (cursor_1 … cursor_15). */
export type HoverCursor = 'default' | 'move' | 'attack' | 'bombard' | 'colonize' | 'patrol' | 'mine' | 'loadTroops' | 'unloadTroops' | 'blockade' | 'escort' | 'repair' | 'capture' | 'raid';

export interface HoverOrder {
    /** shipAction_0: the order a plain right-click gives (null: none — a right-click opens the menu). */
    action: ShipAction | null;
    /** string_17: the status text ("Right-click to Attack X   (Ctrl-Right-click for more missions...)"). */
    text: string;
    cursor: HoverCursor;
}

export interface HoverInput {
    galaxy: Galaxy;
    empire: Empire;
    selected: ShipActionSelection;
    /** The cursor in galaxy coordinates (int_ / int_2 after method_151). */
    x: number;
    y: number;
    /** method_143(x, y, false): the object under the cursor. */
    target: unknown;
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
}

/** `x.ToString("0,K")`: thousands, rounded, with a K. */
function kilo(v: number): string {
    return String(Math.round(v / 1000)) + 'K';
}

/**
 * Main.Part10.cs 1375-1437 method_209: the selection the main view gives orders to — builtObject_5 (a player ship that
 * moves: TopSpeed > 0 and Owner == player) or shipGroup_2 (a player fleet); bool_18 = either.
 */
export function orderSubject(empire: Empire, selected: ShipActionSelection): { ship: BuiltObject | null; fleet: ShipGroup | null } {
    if (isBuiltObject(selected) && selected.topSpeed > 0 && selected.owner === empire) return { ship: selected, fleet: null };
    if (isShipGroup(selected) && selected.empire === empire) return { ship: null, fleet: selected };
    return { ship: null, fleet: null };
}

/** The `Move here (12K, 34K)` order to a free point. */
function moveHere(x: number, y: number): HoverOrder {
    const text = T('Move here') + ' (' + kilo(x) + ', ' + kilo(y) + ')';
    return { action: missionActionAt(BuiltObjectMissionType.Move, null, { x, y }, null), text, cursor: 'default' };
}

/** `empire.ObtainDiplomaticRelation(other).Type is MutualDefensePact / Protectorate / FreeTradeAgreement` (no attack by default). */
function isFriendlyTreaty(empire: Empire | null, other: Empire | null): boolean {
    if (empire === null || other === null) return false;
    const t = obtainDiplomaticRelation(empire, other).type;
    return t === DiplomaticRelationType.MutualDefensePact || t === DiplomaticRelationType.Protectorate || t === DiplomaticRelationType.FreeTradeAgreement;
}

/**
 * Main.Part10.cs 248-697 (mainView_MouseMove with a player ship / fleet selected and Ctrl up): the order a right-click
 * gives for the object under the cursor, its status text and cursor. `action` null: no default order.
 */
export function resolveHoverOrder(input: HoverInput): HoverOrder {
    const none: HoverOrder = { action: null, text: '', cursor: 'default' };
    const { galaxy, empire: player } = input;
    const subject = orderSubject(player, input.selected);
    const builtObject5 = subject.ship;
    const shipGroup2 = subject.fleet;
    if ((builtObject5 === null && shipGroup2 === null) || input.ctrl) return none; // bool_18 && !Ctrl
    const obj = input.target;
    const int_ = input.x;
    const int_2 = input.y;
    let empire: Empire | null = null;
    let num = 0;
    let num2 = 0;
    let num3 = 0;
    let num4 = 0;
    let num5 = 0;
    let num6 = 0;
    let flag4 = false;
    let flag5 = false;
    let flag6 = false;
    let flag7 = false;
    let flag8 = false;
    let flag9 = false;
    if (builtObject5 !== null) {
        empire = builtObject5.empire;
        num = builtObject5.firepowerRaw;
        num3 = builtObject5.bombardWeaponPower;
        num2 = builtObject5.fighterCapacity;
        num4 = builtObject5.troopCapacityRemaining;
        num5 = 0;
        if (builtObject5.troops !== null) {
            num5 = builtObject5.troops.totalAttackStrength;
            num6 = builtObject5.troops.count;
        }
        if (builtObject5.assaultStrength > 0 && builtObject5.assaultRange > 0) flag9 = true;
        if (builtObject5.role === BuiltObjectRole.Military) flag4 = true;
        if ((builtObject5.extractionGas > 0 || builtObject5.extractionLuxury > 0 || builtObject5.extractionMine > 0) && builtObject5.subRole !== BuiltObjectSubRole.ResupplyShip) flag5 = true;
        if (builtObject5.isPlanetDestroyer) flag7 = true;
        flag6 = builtObject5.isShipYard;
        if (builtObject5.subRole === BuiltObjectSubRole.ResupplyShip) flag8 = true;
    } else if (shipGroup2 !== null) {
        empire = shipGroup2.empire;
        num = shipGroupTotalFirepower(shipGroup2);
        num2 = shipGroupTotalFighterCount(shipGroup2);
        num3 = shipGroupTotalBombardPower(shipGroup2);
        num4 = 0;
        num5 = shipGroup2.totalTroopAttackStrength;
        if (num5 > 0) num6 = 1;
        if (shipGroupTotalAvailableBoardingAssaultStrength(shipGroup2, galaxy.nowMs) > 0) flag9 = true;
        flag4 = true;
        flag5 = false;
        flag6 = false;
    }
    let result: HoverOrder = { action: null, text: '', cursor: 'default' };
    const set = (action: ShipAction, text: string, cursor: HoverCursor): void => {
        result = { action, text, cursor };
    };
    const hdesc = (h: Habitat): string => describeHabitatCategory(h.category) + ' ' + h.name;
    if (obj === null || obj === undefined) {
        // 324-396: empty space — a habitat within MouseHoverHabitatProximityRange of the cursor, else a free point.
        let habitat2: Habitat | null = null;
        let habitat4: Habitat | null = null;
        const habitat5 = galaxy.fastFindNearestSystem(int_, int_2);
        if (habitat5 !== null) {
            const systemInfo = galaxy.systems[habitat5.systemIndex] ?? null;
            if (systemInfo !== null) habitat4 = findNearestHabitatInSystem(galaxy, systemInfo, int_, int_2);
        }
        if (habitat4 !== null) {
            let num7 = galaxy.calculateDistance(int_, int_2, habitat4.xpos, habitat4.ypos);
            num7 -= Math.trunc(habitat4.diameter / 2);
            if (num7 > 0.0 && num7 < MOUSE_HOVER_HABITAT_PROXIMITY_RANGE) habitat2 = habitat4;
        }
        if (habitat2 !== null) {
            if (player.visibility.checkSystemExplored(habitat2.systemIndex)) {
                let flag10 = false;
                if (habitat2.empire !== null && habitat2.empire !== galaxy.independentEmpire && habitat2.empire !== empire && flag4 && empire !== null) {
                    const t = obtainDiplomaticRelation(empire, habitat2.empire).type;
                    if (t === DiplomaticRelationType.TradeSanctions || t === DiplomaticRelationType.War) flag10 = true;
                }
                if (flag10) {
                    set(missionAction(BuiltObjectMissionType.Blockade, habitat2), T('Blockade X') + ' ' + hdesc(habitat2), 'blockade');
                } else {
                    const num8 = int_ - Math.trunc(habitat2.xpos);
                    const num9 = int_2 - Math.trunc(habitat2.ypos);
                    set(missionActionAt(BuiltObjectMissionType.Move, habitat2, { x: num8, y: num9 }, null), F(T('Move to X'), hdesc(habitat2)), 'move');
                }
            } else {
                result = moveHere(int_, int_2);
            }
        } else if (!flag6) {
            result = moveHere(int_, int_2);
        }
    } else if (isHabitat(obj)) {
        // 397-563
        const habitat1 = obj;
        if (player.visibility.checkSystemExplored(habitat1.systemIndex)) {
            if ((habitat1.category === HabitatCategoryType.GasCloud || habitat1.type === HabitatType.BlackHole) && !flag6 && !flag8) result = moveHere(int_, int_2);
            if (habitat1.ruin !== null && habitat1.ruin.playerEmpireEncountered && checkRuinsHaveBenefit(galaxy, habitat1.ruin, player)) return none; // shipAction_0 = null
            let flag11 = false;
            if ((num > 0 || num5 > 0 || num2 > 0) && habitat1.empire !== null && habitat1.empire !== empire && habitat1.population !== null && habitat1.population.totalAmount > 0) {
                flag11 = true;
                if (isFriendlyTreaty(empire, habitat1.empire)) flag11 = false;
            } else if (flag7 && builtObject5 !== null && canDestroyHabitat(galaxy, builtObject5, habitat1)) {
                flag11 = true;
                if (isFriendlyTreaty(empire, habitat1.empire)) flag11 = false;
            } else if (num5 > 0 && habitat1.empire === galaxy.independentEmpire && habitat1.empire !== empire && habitat1.population !== null && habitat1.population.totalAmount > 0) {
                flag11 = true;
            }
            if (flag11) {
                if (input.shift && num3 > 0 && habitat1.empire !== null && habitat1.empire !== player) {
                    set(missionAction(BuiltObjectMissionType.Bombard, habitat1), F(T('Bombard X'), hdesc(habitat1)), 'bombard');
                } else if (habitat1.empire !== null && habitat1.empire !== player && player.pirateEmpireBaseHabitat !== null && flag9 && num6 <= 0) {
                    set(missionAction(BuiltObjectMissionType.Raid, habitat1), F(T('Raid X'), hdesc(habitat1)), 'raid');
                } else if (input.alt && flag9 && habitat1.empire !== null && habitat1.empire !== player && player.pirateEmpireBaseHabitat !== null) {
                    set(missionAction(BuiltObjectMissionType.Raid, habitat1), F(T('Raid X'), hdesc(habitat1)), 'raid');
                } else {
                    const text6 = flag7 ? F(T('Destroy X'), hdesc(habitat1)) : F(T('Attack X'), hdesc(habitat1));
                    set(missionAction(BuiltObjectMissionType.Attack, habitat1), text6, 'attack');
                }
            }
            if (flag4 && habitat1.empire === empire) {
                set(missionAction(BuiltObjectMissionType.Patrol, habitat1), F(T('Patrol X'), hdesc(habitat1)), 'patrol');
            } else if (flag4 && (habitat1.category === HabitatCategoryType.GasCloud || habitat1.category === HabitatCategoryType.Star)) {
                set(missionAction(BuiltObjectMissionType.Patrol, habitat1), F(T('Patrol X'), habitat1.name + ' ' + T('system')), 'patrol');
            }
            if (flag5 && (habitat1.empire === null || habitat1.empire === galaxy.independentEmpire)) {
                set(missionAction(BuiltObjectMissionType.ExtractResources, habitat1), F(T('Mine X'), hdesc(habitat1)), 'mine');
            }
            if (num4 >= 100 && habitat1.empire === empire && habitat1.troops !== null && habitat1.troops.count > 0) {
                set(missionAction(BuiltObjectMissionType.LoadTroops, habitat1), F(T('Load Troops at X'), hdesc(habitat1)), 'loadTroops');
            } else if (num4 >= 100 && habitat1.empire !== empire && habitat1.invadingTroops !== null && habitat1.invadingTroops.count > 0 && habitat1.invadingTroops.items[0].empire === empire) {
                set(missionAction(BuiltObjectMissionType.LoadTroops, habitat1), F(T('Load Troops at X'), hdesc(habitat1)), 'loadTroops');
            }
            if ((num6 > 0 && num4 < 100 && habitat1.empire === empire) || (num5 > 0 && habitat1.empire === empire && habitat1.troops !== null && habitat1.troops.count === 0)) {
                set(missionAction(BuiltObjectMissionType.UnloadTroops, habitat1), F(T('Unload Troops at X'), hdesc(habitat1)), 'unloadTroops');
            }
            if (builtObject5 !== null && builtObject5.subRole === BuiltObjectSubRole.ColonyShip && (habitat1.empire === null || habitat1.empire === galaxy.independentEmpire)) {
                const e5 = builtObject5.empire;
                if (e5 !== null && canBuiltObjectColonizeHabitat(galaxy, e5, builtObject5, habitat1).result && canEmpireColonizeHabitatRange(galaxy, e5, habitat1)) {
                    set(missionAction(BuiltObjectMissionType.Colonize, habitat1), F(T('Colonize X'), hdesc(habitat1)), 'colonize');
                }
            }
        } else {
            result = moveHere(int_, int_2);
        }
    } else if (isBuiltObject(obj)) {
        // 564-649
        const builtObject6 = obj;
        if (isObjectVisibleToThisEmpire(galaxy, player, builtObject6)) {
            if (builtObject6.empire === null && builtObject6.damagedComponentCount === 0 && builtObject6.unbuiltComponentCount === 0) return none;
            if ((num > 0 || num2 > 0 || num5 > 0) && builtObject6.empire !== empire && builtObject6.empire !== galaxy.independentEmpire) {
                if (!isFriendlyTreaty(empire, builtObject6.empire)) {
                    if (flag9 && input.shift) set(missionAction(BuiltObjectMissionType.Capture, builtObject6), F(T('Capture X'), builtObject6.name), 'capture');
                    else if (flag9 && input.alt && player.pirateEmpireBaseHabitat !== null) set(missionAction(BuiltObjectMissionType.Raid, builtObject6), F(T('Raid X'), builtObject6.name), 'raid');
                    else set(missionAction(BuiltObjectMissionType.Attack, builtObject6), F(T('Attack X'), builtObject6.name), 'attack');
                }
            }
            if ((num > 0 || num2 > 0 || num5 > 0) && builtObject6.empire === empire && builtObject6.firepowerRaw === 0 && builtObject6 !== builtObject5) {
                set(missionAction(BuiltObjectMissionType.Escort, builtObject6), F(T('Escort X'), builtObject6.name), 'escort');
            }
            if ((num > 0 || num2 > 0) && builtObject6.empire === empire && builtObject6.role === BuiltObjectRole.Base) {
                set(missionAction(BuiltObjectMissionType.Patrol, builtObject6), F(T('Patrol X'), builtObject6.name), 'patrol');
            }
            if (flag6 && (builtObject6.damagedComponentCount > 0 || builtObject6.unbuiltComponentCount > 0) && builtObject6.builtAt === null && builtObject5 !== builtObject6) {
                set(ShipAction.forMission(BuiltObjectMissionType.Build, null, builtObject6), F(T('Repair X'), builtObject6.name), 'repair');
            }
        } else {
            result = moveHere(int_, int_2);
        }
    } else if (isCreature(obj)) {
        // 650-672
        if (visibleTo({ galaxy, empire: player }, obj)) {
            if (num > 0 || num2 > 0) set(missionAction(BuiltObjectMissionType.Attack, obj), F(T('Attack X'), obj.name), 'attack');
        } else {
            result = moveHere(int_, int_2);
        }
    }
    // 685-689: the status text prefix / suffix (MouseHoverMode is Undefined here).
    if (result.text !== '') {
        result.text = T('Right-click to') + ' ' + result.text + '   (' + T('Ctrl-Right-click for more missions') + '...)';
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Right-click in the main view (Main.Part10.cs 3049 mainView_MouseClick, right button: 3310-3559)
// ---------------------------------------------------------------------------------------------------------------

export type RightClickResult =
    /** The default order was given (or refused by the blockade / built-at checks: `executed` false). */
    | { kind: 'order'; executed: boolean; attackClick: boolean }
    /** Nothing selected: method_355/354 — the idle-ships picker at the cursor (items select a ship). */
    | { kind: 'idleShips'; items: OrderMenuItem[] }
    /** Something else selected and no default order: method_149 centres the view on the click point. */
    | { kind: 'center' }
    /** Ctrl held: the click itself does nothing (the action menu opens). */
    | { kind: 'none' };

/**
 * Main.Part10.cs 3310-3559: a right-click (no drag, Ctrl up) with `order` = shipAction_0, the default order under the
 * cursor (resolveHoverOrder). For the selected player ship (builtObject_5) or fleet (shipGroup_2) the order is
 * executed directly, incl. the Blockade check (join an existing blockade only as its initiator, else start one).
 * `alt`: Alt held (Attack / Bombard become WaitAndAttack / WaitAndBombard for a fleet). `zoomFactor` is double_0
 * (the idle-ships picker shows fleets by name at galaxy zoom).
 */
export function rightClickOrder(galaxy: Galaxy, empire: Empire, selected: ShipActionSelection, order: ShipAction | null, keys: { ctrl: boolean; alt: boolean }, zoomFactor = 1): RightClickResult {
    if (keys.ctrl) return { kind: 'none' };
    const { ship: builtObject5, fleet: shipGroup2 } = orderSubject(empire, selected);
    const shipAction0 = order;
    // Not in the C#: the order no longer clears IsAutoControlled; the missions it creates are marked as player orders
    // instead, so an automated ship / fleet carries the order out and then goes back to automation (playerOrder.ts).
    if (builtObject5 !== null && shipAction0 !== null) {
        const snap = snapshotOrders([builtObject5]);
        const result = shipRightClick(galaxy, builtObject5, shipAction0);
        markNewOrders(snap);
        return result;
    }
    if (shipGroup2 !== null && shipAction0 !== null) {
        const snap = snapshotOrders([], [shipGroup2]);
        const result = fleetRightClick(galaxy, shipGroup2, shipAction0, keys.alt);
        markNewOrders(snap);
        return result;
    }
    if (selected === null) {
        const list: BuiltObject[] = [];
        for (const b of empire.builtObjects) {
            if (!hasMission(b.mission) && b.role !== BuiltObjectRole.Base && b.builtAt === null && b.shipGroup === null) list.push(b);
        }
        if (list.length > 0) return { kind: 'idleShips', items: idleShipItems(list, zoomFactor) };
        return { kind: 'none' };
    }
    return { kind: 'center' };
}

/**
 * Whether a right-click re-centres the view on the click point. The original (Main.Part10.cs 3310-3559, method_149)
 * does so for `{ kind: 'center' }` even when the action menu opens on the same click; here the view stays exactly where
 * it was whenever that menu opens (`menu` = the items openActionMenu returned), so clicking something the selection can
 * interact with only opens the menu at the cursor.
 */
export function rightClickCentersView(result: RightClickResult, menu: readonly unknown[] | null): boolean {
    return result.kind === 'center' && (menu === null || menu.length === 0);
}

/** Main.Part7.cs 3537 method_354(ships, null): one entry per ship ("Name (SubRole)"), a fleet lead at galaxy zoom by its fleet. */
function idleShipItems(list: BuiltObject[], zoomFactor: number): OrderMenuItem[] {
    const items: OrderMenuItem[] = [];
    for (const item of list) {
        const group = shipGroupOf(item);
        if (group !== null && group.leadShip === item && zoomFactor > 100.0) {
            const it = leaf(group.name ?? '', group.name ?? '', null);
            it.select = item; // Tag = ShipGroup: the UI selects the fleet through its lead ship
            items.push(it);
        } else {
            const it = leaf(item.name, item.name + ' (' + describeSubRole(item.subRole) + ')', null);
            it.select = item;
            items.push(it);
        }
    }
    return items;
}

/** The blockade check (Main.Part10.cs 3318-3351 / 3406-3443): false = someone else's blockade (the order is dropped). */
function blockadeCheck(galaxy: Galaxy, empire: Empire, target: unknown, beforeImplement: () => void): boolean {
    if (isHabitat(target) || isBuiltObject(target)) {
        const blockade = blockadeFor(galaxy, target);
        if (blockade !== null) {
            if (blockade.initiator !== empire) return false;
        } else {
            beforeImplement();
            implementBlockade(galaxy, empire, target, false, false);
        }
    }
    return true;
}

/** Main.Part10.cs 3312-3400: the order for the selected ship. */
function shipRightClick(galaxy: Galaxy, builtObject5: BuiltObject, shipAction0: ShipAction): RightClickResult {
    const empire = builtObject5.empire!;
    const refused: RightClickResult = { kind: 'order', executed: false, attackClick: false };
    if (builtObject5.builtAt !== null) return refused;
    if (shipAction0.missionType === BuiltObjectMissionType.Blockade && shipAction0.target !== null) {
        if (!blockadeCheck(galaxy, empire, shipAction0.target, () => undefined)) return refused;
    }
    if (shipAction0.missionType === BuiltObjectMissionType.LoadTroops && isHabitat(shipAction0.target)) {
        clearPreviousMissionRequirements(galaxy, builtObject5, true);
        assignLoadTroopsMission(galaxy, empire, builtObject5, shipAction0.target, false, true, true);
        return { kind: 'order', executed: true, attackClick: false };
    }
    if (shipAction0.missionType === BuiltObjectMissionType.UnloadTroops && isHabitat(shipAction0.target) && builtObject5.troops !== null) {
        clearPreviousMissionRequirements(galaxy, builtObject5, true);
        assignMission(galaxy, builtObject5, BuiltObjectMissionType.UnloadTroops, shipAction0.target, null, BuiltObjectMissionPriority.Normal, { troops: builtObject5.troops, manuallyAssigned: true });
        return { kind: 'order', executed: true, attackClick: false };
    }
    clearPreviousMissionRequirements(galaxy, builtObject5, true);
    if (shipAction0.target2 !== null && shipAction0.target2 !== undefined && shipAction0.target !== builtObject5) {
        if (isBuiltObject(shipAction0.target2)) {
            const builtObject8 = shipAction0.target2;
            assignMission(galaxy, builtObject5, shipAction0.missionType, missionTarget(shipAction0.target), builtObject8, BuiltObjectMissionPriority.Normal, {
                x: builtObject8.xpos,
                y: builtObject8.ypos,
                manuallyAssigned: true,
            });
        }
        return { kind: 'order', executed: true, attackClick: false };
    }
    let attackClick = false;
    const target = missionTarget(shipAction0.target);
    const p = shipAction0.position;
    if (shipAction0.design !== null) {
        if (p.x === 0 && p.y === 0) {
            assignMission(galaxy, builtObject5, shipAction0.missionType, target, null, BuiltObjectMissionPriority.Normal, { design: shipAction0.design, manuallyAssigned: true });
        } else {
            assignMission(galaxy, builtObject5, shipAction0.missionType, target, null, BuiltObjectMissionPriority.Normal, { design: shipAction0.design, x: p.x, y: p.y, manuallyAssigned: true });
        }
    } else {
        if (p.x === 0 && p.y === 0) {
            assignMission(galaxy, builtObject5, shipAction0.missionType, target, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        } else {
            assignMission(galaxy, builtObject5, shipAction0.missionType, target, null, BuiltObjectMissionPriority.Normal, { x: p.x, y: p.y, manuallyAssigned: true });
        }
        if (shipAction0.missionType === BuiltObjectMissionType.Attack || shipAction0.missionType === BuiltObjectMissionType.Bombard) attackClick = true; // method_0(ResolveAttackClick()): a sound
    }
    return { kind: 'order', executed: true, attackClick };
}

/** Main.Part10.cs 3401-3541: the order for the selected fleet. */
function fleetRightClick(galaxy: Galaxy, shipGroup2: ShipGroup, shipAction0: ShipAction, alt: boolean): RightClickResult {
    const empire = shipGroup2.empire!;
    const refused: RightClickResult = { kind: 'order', executed: false, attackClick: false };
    // The C#'s method_348(fleet, false) (every ship's IsAutoControlled = false) is dropped: see rightClickOrder.
    if (shipAction0.missionType === BuiltObjectMissionType.Blockade && shipAction0.target !== null) {
        if (!blockadeCheck(galaxy, empire, shipAction0.target, () => undefined)) return refused;
    }
    if (shipAction0.missionType === BuiltObjectMissionType.LoadTroops) {
        if (shipAction0.target !== null && shipAction0.target !== undefined) {
            if (isHabitat(shipAction0.target)) assignFleetLoadTroops(galaxy, empire, shipGroup2, shipAction0.target, true);
        } else {
            assignFleetLoadTroops(galaxy, empire, shipGroup2, null, true);
        }
        return { kind: 'order', executed: true, attackClick: false };
    }
    if (shipAction0.missionType === BuiltObjectMissionType.UnloadTroops) {
        if (isHabitat(shipAction0.target)) assignFleetUnloadTroops(galaxy, empire, shipGroup2, shipAction0.target, true);
        return { kind: 'order', executed: true, attackClick: false };
    }
    const target = missionTarget(shipAction0.target);
    const p = shipAction0.position;
    if (shipAction0.design !== null) {
        if (p.x === 0 && p.y === 0) {
            shipGroupAssignMissionFull(galaxy, shipGroup2, shipAction0.missionType, target, null, null, shipAction0.design, COORD_UNSET_DOUBLE, COORD_UNSET_DOUBLE, -1, BuiltObjectMissionPriority.Normal, true);
        } else {
            shipGroupAssignMissionFull(galaxy, shipGroup2, shipAction0.missionType, target, null, null, shipAction0.design, p.x, p.y, -1, BuiltObjectMissionPriority.Normal, true);
        }
        return { kind: 'order', executed: true, attackClick: false };
    }
    const isAttack = (t: BuiltObjectMissionType): boolean =>
        t === BuiltObjectMissionType.Attack || t === BuiltObjectMissionType.Bombard || t === BuiltObjectMissionType.WaitAndAttack || t === BuiltObjectMissionType.WaitAndBombard;
    let priority = BuiltObjectMissionPriority.Normal;
    if (isAttack(shipAction0.missionType)) priority = BuiltObjectMissionPriority.High;
    if (p.x === 0 && p.y === 0) {
        let missionType: BuiltObjectMissionType = shipAction0.missionType;
        if (alt) {
            switch (missionType) {
                case BuiltObjectMissionType.Attack:
                    missionType = BuiltObjectMissionType.WaitAndAttack;
                    break;
                case BuiltObjectMissionType.Bombard:
                    missionType = BuiltObjectMissionType.WaitAndBombard;
                    break;
            }
        }
        if (missionType !== BuiltObjectMissionType.WaitAndAttack && missionType !== BuiltObjectMissionType.WaitAndBombard) {
            if (shipAction0.missionType === BuiltObjectMissionType.Patrol && isHabitat(shipAction0.target) && (shipAction0.target.category === HabitatCategoryType.GasCloud || shipAction0.target.category === HabitatCategoryType.Star)) {
                const system = systemForStar(galaxy, shipAction0.target);
                if (assignFleetSystemPatrol(galaxy, empire, shipGroup2, system)) return { kind: 'order', executed: true, attackClick: false };
            } else if (shipAction0.missionType === BuiltObjectMissionType.Patrol && isSystemInfo(shipAction0.target)) {
                if (assignFleetSystemPatrol(galaxy, empire, shipGroup2, shipAction0.target)) return { kind: 'order', executed: true, attackClick: false };
            }
        } else {
            const r = checkAssignFleetWaitAndAttackMission(galaxy, empire, shipGroup2, missionType, target, priority);
            if (r.assigned) return { kind: 'order', executed: true, attackClick: false };
            missionType = r.missionType;
            shipAction0.setMissionType(missionType);
        }
        shipGroupAssignMission(galaxy, shipGroup2, missionType, target, null, priority, true);
    } else {
        shipGroupAssignMission(galaxy, shipGroup2, shipAction0.missionType, target, null, priority, true, { x: p.x, y: p.y });
    }
    return { kind: 'order', executed: true, attackClick: isAttack(shipAction0.missionType) };
}

/**
 * Main.Part10.cs 3063-3125 (mainView_MouseClick in MouseHoverMode SetFleetAttackPoint / SetFleetHomeBase, after the
 * selection button of the same name): set the selected fleet's AttackPoint (a colony or base of another empire) or
 * GatherPoint (a dockable friendly refuelling point); a click on nothing clears it. Returns true when the fleet changed.
 */
export function fleetPointClick(galaxy: Galaxy, empire: Empire, fleet: ShipGroup | null, mode: 'SetFleetAttackPoint' | 'SetFleetHomeBase', target: unknown): boolean {
    if (fleet === null) return false;
    if (mode === 'SetFleetAttackPoint') {
        if (target !== null && target !== undefined) {
            if (isHabitat(target)) {
                if (target.empire !== null && target.empire !== empire) {
                    fleet.attackPoint = target;
                    return true;
                }
            } else if (isBuiltObject(target)) {
                if (target.role === BuiltObjectRole.Base && target.empire !== null && target.empire !== empire) {
                    fleet.attackPoint = target;
                    return true;
                }
            }
            return false;
        }
        fleet.attackPoint = null;
        return true;
    }
    if (target !== null && target !== undefined) {
        // PlayerEmpire.BuiltObjects.FindFirstBuiltObject(BuiltObjectRole.Military)
        const shipToRefuel = empire.builtObjects.find((b) => b !== null && b.role === BuiltObjectRole.Military) ?? null;
        if (isHabitat(target)) {
            if (isStellarObjectDockable(galaxy, target, empire) && checkEmpireCanRefuelAtEmpire(galaxy, shipToRefuel, target.empire, empire)) {
                fleet.gatherPoint = target;
                return true;
            }
        } else if (isBuiltObject(target)) {
            if (target.role === BuiltObjectRole.Base && isStellarObjectDockable(galaxy, target, empire) && checkEmpireCanRefuelAtEmpire(galaxy, shipToRefuel, target.empire, empire)) {
                fleet.gatherPoint = target;
                return true;
            }
        }
        return false;
    }
    fleet.gatherPoint = null;
    return true;
}

/**
 * Main.Part8.cs 1332 actionMenu_Opening: whether a right-click opens the action menu, and its items. Cancelled while
 * a default order exists and Ctrl is up (the click gives that order instead). The menu is built (method_344) when
 * the selection has an owner empire or is a habitat the player could colonize; else it is empty.
 */
export function openActionMenu(ctx: OrderMenuContext, hoverOrder: ShipAction | null, ctrl: boolean): OrderMenuItem[] | null {
    if (hoverOrder !== null && !ctrl) return null;
    const sel = ctx.selected;
    let empire: Empire | null = null;
    let flag = false;
    if (sel !== null) {
        if (isBuiltObject(sel)) empire = sel.empire;
        if (Array.isArray(sel)) {
            empire = sel.length > 0 ? sel[0].empire : null;
        } else if (isHabitat(sel)) {
            empire = sel.empire;
            const player = ctx.empire;
            const colonizableHabitatTypes = player.colonizableHabitatTypesForEmpire();
            const latestColonyShip = findNewestCanBuildColonyShip(player);
            flag = canEmpireColonizeHabitat(ctx.galaxy, player, player, sel, colonizableHabitatTypes, latestColonyShip);
        } else if (isShipGroup(sel)) {
            empire = sel.empire;
        }
    }
    const items = flag || empire !== null ? buildActionMenu(ctx) : [];
    // TODO(port): BaconMain.cs 1288 GenerateToolStripItems (the Bacon mod's Alt-right-click menu: sleep, asteroid colony,
    // ship lab research, pirate ship construction, trade / customize / invasion forms) — not ported.
    // TODO(port): Main.Part2.cs 4888 AddMenuItems ("Show Energy collection at this point for current tech", a mod debug
    // item) — not ported.
    return items;
}

// ---------------------------------------------------------------------------------------------------------------
// The targets list (Main.Part12.cs 2467 method_78, PrioritizedTarget items)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Main.Part12.cs 2467-2505: a click on a target in the left-hand targets list. Left: select the fleet already
 * attacking it; else send the selected player fleet (unless it already attacks it); else the nearest available fleet
 * (within fuel range first). Right: force-complete the current mission of the fleet attacking it now (queue index 0).
 * Returns what the UI should select (`undefined`: leave the selection).
 */
export function targetListClick(galaxy: Galaxy, empire: Empire, selected: ShipActionSelection, target: PrioritizedTarget, button: 'left' | 'right'): { select?: ShipGroup } {
    const shipGroup = isShipGroup(selected) ? selected : null;
    const assigned = resolveAssignedFleet(empire, target);
    const shipGroup2 = assigned.fleet;
    if (button === 'left') {
        if (shipGroup2 !== null) return { select: shipGroup2 };
        const tgt = target.target;
        if (shipGroup !== null && shipGroup.empire === empire) {
            const m = shipGroup.mission;
            if (
                m === null ||
                m.target !== tgt ||
                (m.type !== BuiltObjectMissionType.Attack && m.type !== BuiltObjectMissionType.Bombard && m.type !== BuiltObjectMissionType.WaitAndAttack && m.type !== BuiltObjectMissionType.WaitAndBombard)
            ) {
                shipGroupAssignMission(galaxy, shipGroup, BuiltObjectMissionType.Attack, tgt, null, BuiltObjectMissionPriority.High, true);
            }
            return {};
        }
        const c = target.resolveTargetCoordinates();
        let shipGroup3 = identifyNearestAvailableFleet(galaxy, empire, c.x, c.y, false, true, 0.0);
        if (shipGroup3 === null) shipGroup3 = identifyNearestAvailableFleet(galaxy, empire, c.x, c.y, false, false, 0.0);
        if (shipGroup3 !== null) shipGroupAssignMission(galaxy, shipGroup3, BuiltObjectMissionType.Attack, tgt, null, BuiltObjectMissionPriority.High, true);
        return {};
    }
    if (shipGroup2 !== null && assigned.missionQueueIndex === 0) forceCompleteMission(galaxy, shipGroup2);
    return {};
}
