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

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { BUILD_COLONY_SHIP_POPULATION_REQUIREMENT } from '../empire';
import { BuiltObject } from '../builtObject';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ComponentType } from '../data/components';
import type { Design } from '../design';
import { Habitat, HabitatCategoryType, HabitatType, IndustryType, type SystemInfo } from '../types';
import { Creature } from '../creature';
import { Troop, TroopList, TroopType } from '../cargo';
import type { Race } from '../data/races';
import type { Facility } from '../data/facilities';
import type { Plague } from '../data/plagues';
import { Character, CharacterRole, getNonTransferringCharacters } from '../characters';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../diplomacy';
import { FleetPosture } from '../diplomacyTick';
import { netSort } from '../netSort';
import { galaxyStarDate } from '../tick/simTime';
import { splitString } from '../data/gameText';
import { formatNet, tryGetText } from '../textResolver';
import { ColonyResourceEffect, resourceBonusTotalByEffectType } from '../developmentLevel';
import { ResourceGroup, resourceGroupOf } from '../resourceSystem';
import { PlanetaryFacilityType, WonderType, facilityType } from '../researchSystem';
import { generateNewTroop } from '../builtObjectPlacement';
import { identifyStrongestRaceAttackTroop } from '../troops';
import { canBuildDesign, findNewestCanBuild, findNewestCanBuildFullEvaluate, resolveSubRoleDescription, checkDesignWithinConstructionSize, canBuildDesignTech } from '../designGeneration';
import { findNewestIncludingObsolete } from '../design';
import { checkRuinsHaveBenefit, canEmpireColonizeHabitat, canEmpireColonizeHabitatRange } from '../exploration';
import { SystemVisibilityStatus, findNearestUnexploredHabitat } from '../visibility';
import { isObjectVisibleToThisEmpire, checkEmpireTerritoryCanBuildAtLocation, isStellarObjectDockable } from '../independentTraders';
import { checkEmpireTerritoryCanBuildAtHabitat } from '../resourceTargets';
import { checkColonizingHabitat, checkBasesToBeBuiltAtHabitat, resolveSector, fastFindNearestUnexploredHabitat, fastFindNearestUnexploredHabitatInSector, PrioritizedTarget } from '../civilianAI';
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
import { checkEmpireCanRefuelAtEmpire, fastFindNearestRefuellingPoint } from '../movement';
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
/** The system whose star is `star` (Galaxy.Systems[habitat]). */
function systemOfStar(galaxy: Galaxy, star: Habitat): SystemInfo | null {
    const s = galaxy.systems[star.systemIndex];
    return s !== undefined && s.systemStar === star ? s : (galaxy.systems.find((x) => x.systemStar === star) ?? null);
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
    if (isCreature(o)) {
        // TODO(port): the Creature branch of Empire.IsObjectVisibleToThisEmpire (Empire.9.cs 3065) is not ported — a
        // creature the renderer shows (and can pick) counts as visible.
        return true;
    }
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

/** DesignList.cs 375/388 GetBuildableDesignsBySubRoles(subRoles, empire[, colony]). */
function getBuildableDesignsBySubRoles(designs: Design[], subRoles: BuiltObjectSubRole[], empire: Empire, colony?: Habitat | null): Design[] {
    const result: Design[] = [];
    for (const design of designs) {
        if (subRoles.includes(design.subRole) && !design.isObsolete && canBuildDesign(empire, design, true, colony ?? null)) result.push(design);
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
/** DesignList.cs 413 GetDesignsBySubRoles(subRoles). */
function getDesignsBySubRoles(designs: Design[], subRoles: BuiltObjectSubRole[]): Design[] {
    return designs.filter((d) => subRoles.includes(d.subRole) && !d.isObsolete);
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
        if (design3 !== null && design3.subRole === subRole && !design3.isObsolete && owner !== null) {
            // CanBuildDesign(design3, true, colony, out, out) runs for every design that reaches it; the C#'s
            // `DateCreated > num1 || OptimizedDesign > 0` pre-test only skips older non-optimized ones.
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

/** Empire.5.cs 3394 CheckTargetOfRepairMission(target). */
export function checkTargetOfRepairMission(empire: Empire, target: BuiltObject): boolean {
    for (const c of empire.constructionShips) {
        const builtObject = c as BuiltObject;
        const m = builtObjectMission(builtObject.mission);
        if (m !== null) {
            if (m.type === BuiltObjectMissionType.BuildRepair && m.secondaryTargetBuiltObject === target) return true;
            if (m.type === BuiltObjectMissionType.Build && m.secondaryTargetBuiltObject === target) return true;
        }
        if (builtObject.subsequentMissions === null || builtObject.subsequentMissions.length <= 0) continue;
        for (const sm of builtObject.subsequentMissions) {
            const q = builtObjectMission(sm);
            if (q === null) continue;
            if (q.type === BuiltObjectMissionType.BuildRepair && q.secondaryTargetBuiltObject === target) return true;
            if (q.type === BuiltObjectMissionType.Build && q.secondaryTargetBuiltObject === target) return true;
        }
    }
    return false;
}

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
                    // TODO(port): Empire.LastXaraktorVirusDeploy (Empire.cs 881) is not modelled — the C# compares
                    // CurrentDateTime - LastXaraktorVirusDeploy > 150 s; with the field's DateTime.MinValue default that holds.
                    void galaxy;
                    return { result: true, virus, reason };
                }
                reason = T('Cannot Deploy Xaraktor Virus - no facility');
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

/** Galaxy.CheckWithinDistancePotential(range, x1, y1, x2, y2): the axis-aligned pre-test before CalculateDistance. */
function withinDistancePotential(range: number, x1: number, y1: number, x2: number, y2: number): boolean {
    return Math.abs(x1 - x2) <= range && Math.abs(y1 - y2) <= range;
}

/** Main.Part11.cs 1138 method_133(x, y, range): fleets (lead ship) within range that the player can see, sorted. */
function fleetsNear(ctx: OrderMenuContext, x: number, y: number, range: number): ShipGroup[] {
    const list: ShipGroup[] = [];
    for (const empire of ctx.galaxy.empires) {
        for (const shipGroup of playerShipGroups(empire)) {
            const lead = shipGroup.leadShip;
            if (lead === null) continue;
            if (withinDistancePotential(range, lead.xpos, lead.ypos, x, y)) {
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
        if (bo !== null && bo.role !== BuiltObjectRole.Base && withinDistancePotential(range, bo.xpos, bo.ypos, x, y)) {
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
        if (bo !== null && bo.role === BuiltObjectRole.Base && withinDistancePotential(range, bo.xpos, bo.ypos, x, y)) {
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
                for (const habitat2 of systemInfo.habitats) {
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
            for (const habitat2 of systemInfo.habitats) {
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
            for (const habitat2 of systemInfo.habitats) {
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
        // TODO(port): BuiltObjectList.DetermineFuelRequired(setFuelLevelToZero) (BuiltObjectList.cs) is not ported — the fuel
        // types of the first ship stand in for the list's union (every ship of one empire burns the same fuels in practice).
        const fuelTypes = determineFuelRequired(first, true);
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
