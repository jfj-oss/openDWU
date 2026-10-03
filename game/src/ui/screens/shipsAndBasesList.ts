// Ships and Bases window: a port of the original's pnlBuiltObjectInfo ScreenPanel on the shared original-style window
// (originalWindow.ts), opened by F11 or the top-bar button (Main.Part9.cs tbtnBuiltObjects_Click -> Main.Part11.cs
// method_178). Layout (1024 × 756, body-relative pixels) is method_178's:
//   - the role filter combo (cmbBuiltObjectFilter, the 18 entries of Main.Part3.cs SetControlLocalizedLabels) in the
//     header at (380, 12);
//   - the BuiltObjectListView (ctlBuiltObjectList, 680 × 288 at (10, 10)): Empire flag, picture, Name (red = damaged,
//     orange = unbuilt components), Role, Mission, System, Firepower, Speed, Maintenance, Fleet, Automated (click to
//     toggle, Main.Part6.cs ctlBuiltObjectList_CellClick). MultiSelect (click / Ctrl / Shift / Ctrl+A), sortable;
//     rows ordered by distance to the selection (BaconMain.cs method_423);
//   - the button rows at y 308 (Select / Go to / View Design / View Fleet / Set Fleet combo) and 350 (Refuel / Repair /
//     Retrofit / Retire / Scrap) with ctlBuiltObjectList_SelectionChanged{,_1}'s enable rules;
//   - the galaxy map (gmapBuiltObject, 300 × 300 at (700, 25)): the crosshair on the selected item, yellow dots on every
//     listed object when a filter is chosen (cmbBuiltObjectFilter_SelectedIndexChanged SetLocations);
//   - the name box (hvhxxedjqS at (750, 355), rename on leave) and the InfoPanel (pnlBuiltObjectDetail, 300 × 300 at
//     (700, 385)) drawn by the selection panel's InfoPanel port (selectionInfo.ts / selectionInfoView.ts);
//   - the tab control (tabBuiltObjectData, 680 × 300 at (10, 385)): Cargo, Components, Construction Yards, Docking Bays,
//     Troops & Characters, Weapons, with the original's "(n)" counts.
// The Retrofit button opens pnlRetrofit (Main.Part3.cs method_574 / 575: total cost, the design combo when every
// selected item has the same sub-role, the warnings of method_576, Go) and Scrap asks first
// (btnBuiltObjectScrapSelected_Click). Every command goes through the player command queue.
// Not in the original (kept from earlier tasks): "Refit selected / all to latest" (fleetOps.planRetrofit /
// retrofitShips), the Automate toggle button under the Set Fleet combo, and the "Construction Jobs" tab (the
// construction board of sim/player/constructionBoard.ts).
// TODO(port): the troop loadout group of the Troops tab (Main.Part11.cs method_179), the construction-yard buttons (purchaser, move/remove in the wait queue,
// Main.Part11.cs method_169), the cargo resource-shortage label and the weapons damage graph (WeaponListView).

import './shipsAndBasesList.css';
import type { BuiltObject } from '../../sim/builtObject';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
import { Habitat } from '../../sim/types';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../../sim/missions/mission';
import { ShipGroup, empireShipGroups } from '../../sim/fleets/shipGroup';
import { isPrivateDesignSubRole } from '../../sim/player/playerOrders';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { constructionJobRows } from '../../sim/player/constructionBoard';
import { ShipAction, ShipActionType } from '../../sim/player/shipAction';
import { getBuildableDesignsBySubRoles } from '../../sim/designGeneration';
import { ComponentStatus } from '../../sim/builtObjectComponent';
import { CharacterRole } from '../../sim/characters';
import { ComponentCategoryType } from '../../sim/data/policies';
import { newDesignDraft } from '../../sim/player/designEditor';
import { subRoleLabel, missionTypeLabel, habitatTypeLabel, resourceIconUrl } from '../hud';
import { confirmAutomationOff } from '../orderMenu';
import { planRetrofit, type RetrofitPlanEntry, type RetrofitResult } from '../../sim/player/fleetOps';
import { showToast } from '../toast';
import {
    COLORS,
    FONT,
    OwGrid,
    dropDown,
    dropText,
    el,
    glassButton,
    gradientPanel,
    messageBox,
    openOriginalWindow,
    place,
    setButtonLabel,
    setText,
    tabStrip,
    textBox,
    type GridColumn,
    type OriginalWindow,
} from '../originalWindow';
import { buildInfoModel } from '../selectionInfo';
import { empireFlagUrl, renderInfoModel } from '../selectionInfoView';
import { habitatImageUrl, shipImageUrl } from '../selectionInfo';
import { CROSSHAIR_COLOR, DIMMED_COLOR, GRID_COLOR, galaxyMapScale, sectorColumnLabel, starBrushColor, starDotSizes } from './galaxyMap';
import { yardRows, waitRows, type ConstructionSite } from './constructionYards';
import { troopRows, type TroopRow } from './troops';
import { openDesignEditor } from './designEditor';
import { readOnlyQuery } from '../../sim/readOnlyQuery';
import { requestSimRefresh } from '../../simworker/refresh';

/** Human label for a built-object role: 'None' for Undefined (GameText.txt
 * "Ship Role Base" -> Base, ... , Undefined -> "None"), otherwise the enum
 * name (Galaxy.2.cs ResolveDescription(BuiltObjectRole)). */
export function builtObjectRoleLabel(role: BuiltObjectRole): string {
    if (role === BuiltObjectRole.Undefined) return 'None';
    return BuiltObjectRole[role];
}

/** cmbBuiltObjectFilter items (Main.Part3.cs SetControlLocalizedLabels 1006-1027), in the original's order. */
export const BUILT_OBJECT_FILTERS = [
    '(Show all ships and bases)',
    'Selected Item',
    'Colony Ships',
    'Construction Yards',
    'Defensive Bases',
    'Exploration Ships',
    'Freighters',
    'Military Ships',
    'Mining Ships',
    'Mining Stations',
    'Monitoring Stations',
    'Passenger Ships',
    'Other Bases',
    'Research Stations',
    'Resort Bases',
    'Resupply Ships',
    'Space Ports',
    'Troop Carriers',
] as const;
export type BuiltObjectFilter = (typeof BUILT_OBJECT_FILTERS)[number];
export const FILTER_ALL: BuiltObjectFilter = BUILT_OBJECT_FILTERS[0];
export const FILTER_SELECTED: BuiltObjectFilter = BUILT_OBJECT_FILTERS[1];
export const FILTER_CONSTRUCTION_YARDS: BuiltObjectFilter = BUILT_OBJECT_FILTERS[3];

/** One displayed row of the panel. Pure so the row logic is testable without a DOM (jsdom is not configured). */
export interface ShipsAndBasesRow {
    /** The ship/base; null for a colony row (the Construction Yards filter also lists the colonies). */
    builtObject: BuiltObject | null;
    /** The listed stellar object: the ship/base or the colony. */
    stellarObject: BuiltObject | Habitat;
    name: string;
    /** `${role}, ${subRole}` (BuiltObjectListView.cs 545-561); just the role
     * when the sub-role is Undefined. A colony: "<type> <category>" (BindSingleHabitat). */
    role: string;
    /** Mission type label, or '(None)'. */
    mission: string;
    /** Nearest system star's name, or '(Deep Space)'. */
    system: string;
    /** Parent habitat's name, or '' for free-flying ships. */
    location: string;
    /** The fleet's name, or '(None)'. */
    fleet: string;
    automated: boolean;
    /** FirepowerRaw (cell format "#0"). */
    firepower: number;
    /** (int)TopSpeed. */
    speed: number;
    /** AnnualSupportCost less the empire's ShipMaintenanceSavings share. */
    maintenance: number;
    /** BindSingleBuiltObject (_ShowDetails): 'damaged' (red) / 'unbuilt' (orange) name, else null. */
    nameState: 'damaged' | 'unbuilt' | null;
    /** The name cell's tooltip ("X components damaged (...)" / "Under construction (X components unbuilt)"). */
    nameTip: string;
}

/** The empire fields the list reads (the tests pass a plain object). */
export interface ShipsAndBasesEmpire {
    builtObjects: BuiltObject[];
    privateBuiltObjects: BuiltObject[];
    colonies?: Habitat[];
}

type SubRoles = readonly BuiltObjectSubRole[];
const S = BuiltObjectSubRole;

/** GetBuiltObjectsBySubRole over one list (null slots skipped). */
function bySubRole(list: readonly BuiltObject[], subRoles: SubRoles): BuiltObject[] {
    return list.filter((b) => b !== null && subRoles.includes(b.subRole));
}

/**
 * BaconMain.cs 1738 method_423 for the filter names of the vanilla combo: which objects a filter lists. Some filters read
 * only the state-owned list, others also the private (civilian) list, and Passenger Ships lists the private ones first,
 * exactly as the C# adds them. "Selected Item" lists the selection when it is the player's; anything else lists all.
 */
export function filterBuiltObjects(
    empire: ShipsAndBasesEmpire,
    filter: BuiltObjectFilter,
    selected: { xpos: number; ypos: number } | null,
): (BuiltObject | Habitat)[] {
    const state = empire.builtObjects;
    const priv = empire.privateBuiltObjects;
    const both = (subRoles: SubRoles): BuiltObject[] => [...bySubRole(state, subRoles), ...bySubRole(priv, subRoles)];
    let list: (BuiltObject | Habitat)[];
    switch (filter) {
        case 'Colony Ships': list = bySubRole(state, [S.ColonyShip]); break;
        case 'Construction Yards': {
            const isYard = (b: BuiltObject): boolean => {
                const yards = (b.constructionQueue as { constructionYards?: unknown[] | null } | null)?.constructionYards;
                return b.isShipYard && yards !== null && yards !== undefined && yards.length > 0;
            };
            list = [...state.filter((b) => b !== null && isYard(b)), ...priv.filter((b) => b !== null && isYard(b)), ...(empire.colonies ?? [])];
            break;
        }
        case 'Exploration Ships': list = bySubRole(state, [S.ExplorationShip]); break;
        case 'Freighters': list = both([S.SmallFreighter, S.MediumFreighter, S.LargeFreighter]); break;
        case 'Military Ships':
            list = bySubRole(state, [S.Escort, S.Frigate, S.Destroyer, S.Cruiser, S.CapitalShip, S.TroopTransport, S.Carrier, S.ResupplyShip]);
            break;
        case 'Mining Ships': list = both([S.MiningShip, S.GasMiningShip]); break;
        case 'Mining Stations': list = both([S.MiningStation, S.GasMiningStation]); break;
        case 'Other Bases': list = both([S.GenericBase]); break;
        case 'Research Stations': list = both([S.EnergyResearchStation, S.WeaponsResearchStation, S.HighTechResearchStation]); break;
        case 'Defensive Bases': list = both([S.DefensiveBase]); break;
        case 'Monitoring Stations': list = both([S.MonitoringStation]); break;
        case 'Passenger Ships': list = [...bySubRole(priv, [S.PassengerShip]), ...bySubRole(state, [S.PassengerShip])]; break;
        case 'Resort Bases': list = both([S.ResortBase]); break;
        case 'Resupply Ships': list = bySubRole(state, [S.ResupplyShip]); break;
        case 'Space Ports': list = bySubRole(state, [S.SmallSpacePort, S.MediumSpacePort, S.LargeSpacePort]); break;
        case 'Troop Carriers': list = [...state, ...priv].filter((b) => b !== null && b.troopCapacity > 0); break;
        case 'Selected Item': {
            const all = [...state, ...priv];
            list = selected !== null ? all.filter((b) => b === (selected as unknown)) : [];
            break;
        }
        default: list = [...state, ...priv].filter((b) => b !== null);
    }
    if (selected !== null) {
        // BaconMain.cs OrderByDistance; Array.prototype.sort is stable, like C# LINQ OrderBy.
        list = [...list].sort((a, b) => {
            const da = (a.xpos - selected.xpos) ** 2 + (a.ypos - selected.ypos) ** 2;
            const db = (b.xpos - selected.xpos) ** 2 + (b.ypos - selected.ypos) ** 2;
            return da - db;
        });
    }
    return list;
}

function isBuiltObject(o: BuiltObject | Habitat): o is BuiltObject {
    return 'subRole' in o;
}

/** BuiltObjectListView.BindSingleBuiltObject: the maintenance cell, AnnualSupportCost × (1 − ShipMaintenanceSavings). */
export function builtObjectMaintenance(b: { annualSupportCost?: number; empire?: { shipMaintenanceSavings?: number } | null }): number {
    const cost = b.annualSupportCost ?? 0;
    const savings = b.empire ? cost * (b.empire.shipMaintenanceSavings ?? 0) : 0;
    return cost - savings;
}

/** BindSingleBuiltObject's name colour and tooltip (red: damaged components, orange: unbuilt components). */
export function builtObjectNameState(b: BuiltObject, player: unknown = null): { state: 'damaged' | 'unbuilt' | null; tip: string } {
    const damaged = b.damagedComponentCount ?? 0;
    const unbuilt = b.unbuiltComponentCount ?? 0;
    if (damaged > 0) {
        let tip = `${damaged} components damaged`;
        if (b.role === BuiltObjectRole.Base) {
            const ph = b.parentHabitat as { population?: { totalAmount?: number } | null; empire?: unknown } | null;
            const repairing = ph !== null && ph !== undefined && (ph.population?.totalAmount ?? 0) > 0 && ph.empire === player;
            tip += repairing ? ' (repairing at colony)' : ' (send a construction ship to repair)';
        } else if ((b.warpSpeed ?? 0) <= 0) {
            tip += ' (no hyperdrive, cannot travel for repairs)';
        }
        return { state: 'damaged', tip };
    }
    if (unbuilt > 0) return { state: 'unbuilt', tip: `Under construction (${unbuilt} components unbuilt)` };
    return { state: null, tip: '' };
}

/** Rows for the panel: the objects the filter lists (default "(Show all ships and bases)": the empire's state-owned +
 * private ships and bases), stably sorted by squared distance to `selected` when there is one. */
export function shipsAndBasesRows(
    empire: ShipsAndBasesEmpire,
    selected: { xpos: number; ypos: number } | null,
    filter: BuiltObjectFilter = FILTER_ALL,
): ShipsAndBasesRow[] {
    return filterBuiltObjects(empire, filter, selected).map((o) => {
        if (!isBuiltObject(o)) {
            // BindSingleHabitat.
            const h = o as Habitat & { nearestSystemStar?: { name: string } | null };
            return {
                builtObject: null,
                stellarObject: o,
                name: o.name,
                role: h.type !== undefined ? habitatTypeLabel(h.type, h.category) : 'Colony',
                mission: '(None)',
                system: h.nearestSystemStar?.name ?? '',
                location: '',
                fleet: '(None)',
                automated: false,
                firepower: 0,
                speed: 0,
                maintenance: 0,
                nameState: null,
                nameTip: '',
            };
        }
        const sub = subRoleLabel(o.subRole);
        const m = builtObjectMission(o.mission);
        const sg = o.shipGroup as { name?: string | null } | null | undefined;
        const fleet = sg === null || sg === undefined ? null : sg.name || '(Unnamed fleet)';
        const ns = builtObjectNameState(o, empire);
        return {
            builtObject: o,
            stellarObject: o,
            name: o.name,
            role: sub ? `${builtObjectRoleLabel(o.role)}, ${sub}` : builtObjectRoleLabel(o.role),
            mission: m !== null && m.type !== BuiltObjectMissionType.Undefined ? missionTypeLabel(m.type) : '(None)',
            system: o.nearestSystemStar?.name || '(Deep Space)',
            location: o.parentHabitat?.name ?? '',
            fleet: fleet ?? '(None)',
            automated: o.isAutoControlled === true,
            firepower: o.firepowerRaw ?? 0,
            speed: Math.trunc(o.topSpeed ?? 0),
            maintenance: builtObjectMaintenance(o as unknown as Parameters<typeof builtObjectMaintenance>[0]),
            nameState: ns.state,
            nameTip: ns.tip,
        };
    });
}

/** The ships (not colonies) of a row selection. */
export function selectedShips(rows: readonly ShipsAndBasesRow[]): BuiltObject[] {
    return rows.map((r) => r.builtObject).filter((b): b is BuiltObject => b !== null);
}

/** Main.Part6.cs ctlBuiltObjectList_SelectionChanged_1 / Main.Part11.cs ctlBuiltObjectList_SelectionChanged (enable
 *  rules of the buttons under the list), extended to a multi-row selection: a button is on when it applies to any
 *  selected ship. */
export interface ShipsActionState {
    /** Set Fleet combo: enabled when a Military ship is selected. */
    setFleet: boolean;
    /** View Fleet: the first selected ship is in a fleet. */
    viewFleet: boolean;
    retire: boolean;
    refuel: boolean;
    repair: boolean;
    /** Retrofit: a selected item is not already being retrofitted (RetrofitDesign == null). */
    retrofit: boolean;
    /** Scrap: any ship / base. */
    scrap: boolean;
    /** View Design: the first selected item is a ship / base. */
    viewDesign: boolean;
    /** Automate toggle (CellClick on Automated): a selected ship with an owner that is not a base. */
    automate: boolean;
}
export function shipsActionState(ships: readonly BuiltObject[]): ShipsActionState {
    const mobile = (b: BuiltObject): boolean => b.topSpeed > 0 && b.role !== BuiltObjectRole.Base;
    return {
        setFleet: ships.some((b) => b.role === BuiltObjectRole.Military),
        viewFleet: ships.length > 0 && ships[0].shipGroup !== null && ships[0].shipGroup !== undefined,
        retire: ships.some((b) => b.owner !== null && mobile(b)),
        refuel: ships.some(mobile),
        repair: ships.some((b) => mobile(b) && b.damagedComponentCount > 0),
        retrofit: ships.some((b) => (b.retrofitDesign ?? null) === null),
        scrap: ships.length > 0,
        viewDesign: ships.length > 0 && ships[0].design != null,
        automate: ships.some((b) => b.owner !== null && b.owner !== undefined && b.role !== BuiltObjectRole.Base),
    };
}

/** Confirm text for a retrofit plan: how many ships go, the estimated total cost, and how many are skipped. */
export function retrofitConfirmText(plan: readonly RetrofitPlanEntry[], scope: string): string {
    const go = plan.filter((e) => e.skip === null);
    const cost = go.reduce((n, e) => n + e.cost, 0);
    return `Refit ${go.length} ${scope} to their latest designs for an estimated ${Math.round(cost).toLocaleString('en-US')} credits? ${plan.length - go.length} will be skipped.`;
}

/** Toast text for the outcome: "N ships sent to refit, M skipped (reasons)". */
export function retrofitToastText(result: RetrofitResult): string {
    const reasons = Object.entries(result.skipped);
    const m = reasons.reduce((n, [, c]) => n + (c ?? 0), 0);
    let t = `${result.sent} ship${result.sent === 1 ? '' : 's'} sent to refit`;
    if (m > 0) t += `, ${m} skipped (${reasons.map(([r, c]) => `${c} ${r}`).join(', ')})`;
    return t;
}

const isSpacePort = (s: BuiltObjectSubRole): boolean => s === S.SmallSpacePort || s === S.MediumSpacePort || s === S.LargeSpacePort;

/** Main.Part3.cs method_581: the common sub-role of the selection (a specific retrofit design is allowed), or null.
 *  One item is always fine; several must share a sub-role (space ports only with space ports). */
export function retrofitCommonSubRole(ships: readonly { subRole: BuiltObjectSubRole }[]): BuiltObjectSubRole | null {
    if (ships.length === 0) return null;
    if (ships.length === 1) return ships[0].subRole;
    const anyPort = ships.some((b) => isSpacePort(b.subRole));
    let sub: BuiltObjectSubRole = S.Undefined;
    for (const b of ships) {
        if (anyPort && !isSpacePort(b.subRole)) return null;
        if (sub !== S.Undefined && b.subRole !== sub) return null;
        sub = b.subRole;
    }
    return sub;
}

/** Main.Part3.cs method_576: the retrofit dialog's warnings (method_579 / 581 / 577). */
export function retrofitWarnings(ships: readonly BuiltObject[]): string[] {
    const out: string[] = [];
    const canRetrofit = (b: BuiltObject): boolean => !(b.owner === null && b.role !== BuiltObjectRole.Base) && (b.retrofitDesign ?? null) === null;
    if (!ships.every(canRetrofit)) out.push('Some of the selected items cannot be retrofitted');
    if (retrofitCommonSubRole(ships) === null) out.push('The selected items are not of the same type, thus you cannot retrofit them to a specific design');
    const atColony = (b: BuiltObject): boolean => b.role === BuiltObjectRole.Base || b.subRole === S.ColonyShip || b.subRole === S.ConstructionShip || b.subRole === S.ResupplyShip;
    if (ships.some(atColony)) out.push('Some of the selected items must be retrofitted at a colony');
    return out;
}

/** Not in the original: what the plan does ("2 will be retrofitted; skipped: 1 already latest design"). */
export function retrofitPlanSummary(plan: readonly RetrofitPlanEntry[]): string {
    const go = plan.filter((e) => e.skip === null).length;
    const skipped = new Map<string, number>();
    for (const e of plan) if (e.skip !== null) skipped.set(e.skip, (skipped.get(e.skip) ?? 0) + 1);
    let t = `${go} will be retrofitted`;
    if (skipped.size > 0) t += `; skipped: ${[...skipped].map(([r, n]) => `${n} ${r}`).join(', ')}`;
    return t;
}

/** The retrofit dialog's cost line (method_574: "Total retrofit cost: n credits", plus the cannot-afford note). */
export function retrofitCostText(cost: number, money: number): string {
    let t = `Total retrofit cost: ${Math.round(cost).toLocaleString('en-US')} credits`;
    if (cost > money) t += '  (Cannot afford this retrofit)';
    return t;
}

/** Main.Part11.cs method_178 / ctlBuiltObjectList_SelectionChanged: the data tabs' captions with their "(n)" counts. */
export function builtObjectTabLabels(o: BuiltObject | Habitat | null): { cargo: string; components: string; yards: string; docking: string; troops: string; weapons: string } {
    const n = (v: number, suffix = ''): string => (v > 0 ? ` (${v}${suffix})` : '');
    if (o === null) return { cargo: 'Cargo', components: 'Components', yards: 'Construction Yards', docking: 'Docking Bays', troops: 'Troops & Characters', weapons: 'Weapons' };
    const bo = o instanceof Habitat ? null : (o as BuiltObject);
    const cargo = (o.cargo as { items?: unknown[] } | null)?.items?.length ?? 0;
    const yards = ((o.constructionQueue as { constructionYards?: { shipUnderConstruction: unknown }[] | null } | null)?.constructionYards ?? []).filter((y) => y.shipUnderConstruction !== null).length;
    const bays = ((o.dockingBays as { dockedShip: unknown }[] | null) ?? []).filter((d) => d.dockedShip !== null).length;
    const troops = ((o.troops as { items?: unknown[] } | null)?.items?.length ?? 0) + (((o as { characters?: unknown[] | null }).characters)?.length ?? 0);
    return {
        cargo: `Cargo${n(cargo)}`,
        components: `Components${n(bo?.damagedComponentCount ?? 0, ' damaged')}`,
        yards: `Construction Yards${n(yards)}`,
        docking: `Docking Bays${n(bays)}`,
        troops: `Troops & Characters${n(troops)}`,
        weapons: `Weapons${n(bo?.weapons?.length ?? 0)}`,
    };
}

/** "1h 05m" / "4m 30s" / "12s" for a job's estimated time (sim ms). */
export function formatEta(ms: number): string {
    const sec = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
}

/** An enum member name as words ("WeaponBeam" → "Weapon Beam"). */
function enumWords(name: string | undefined): string {
    return (name ?? '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

// ---------------------------------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------------------------------

export interface ShipsAndBasesListOptions {
    /** The player's empire. */
    empire: Empire;
    /** The selected object's position (sorts the list by distance), or null. */
    selected: { xpos: number; ypos: number } | null;
    /** Select a ship/base or colony (Select button); the window stays open. */
    onSelect: (bo: BuiltObject | Habitat) => void;
    /** Zoom the Main View to a ship/base (Go to button / double click; closes the window). */
    onZoomTo: (bo: BuiltObject | Habitat) => void;
    /** View Fleet: open the Fleets window on this fleet. */
    onViewFleet: (sg: ShipGroup) => void;
    /** Initial filter (Construction Yards button of the top bar opens with that filter). */
    filter?: BuiltObjectFilter;
}

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;
/** int_60: the filter the window reopens with (the "Selected Item" filter is not remembered, Main.Part6.cs 3050). */
let rememberedFilter: BuiltObjectFilter = FILTER_ALL;

/** Open the Ships and Bases window, or close it if it is already open. */
export function toggleShipsAndBasesList(opts: ShipsAndBasesListOptions): void {
    if (open) {
        open.close();
    } else {
        open = createShipsAndBasesList(opts);
    }
}

/** Close the Ships and Bases window (no-op when closed). */
export function closeShipsAndBasesList(): void {
    open?.close();
}

/** Issue a fleet-forming command, asking first to turn off Fleet Formation automation like the original. */
async function withFleetFormationPrompt(empire: Empire, issue: () => void): Promise<void> {
    if (empire.controlMilitaryFleets && (await confirmAutomationOff('Fleet Formation'))) {
        issuePlayerCommand(empire.galaxy, empire, 'automationOff', ['Fleet Formation']);
    }
    issue();
}

/** method_178 sizes (body-relative original pixels). */
const W = 1024;
const H = 756;
const LIST = { x: 10, y: 10, w: 680, h: 288 };
const MAP = { x: 700, y: 25, size: 300 };
const TABS = { x: 10, y: 385, w: 680, h: 300 };
const DETAIL = { x: 700, y: 385, w: 300, h: 300 };
/** The tab row (2 + 21 px tabs) above the strip's 5 px bar. */
const TAB_STRIP_H = 28;

/** An image cell (Zoom layout): a picture centred in the cell. */
function imageCell(cell: HTMLElement, url: string | null, size: number, rotate = 0, title = ''): void {
    if (url === null) return;
    const img = el('img', 'ships-img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    if (rotate !== 0) img.style.transform = `rotate(${rotate}deg)`;
    img.onerror = () => img.remove();
    if (title) cell.title = title;
    cell.appendChild(img);
}

/** The empire flag cell (SortableImageCell with SmallFlagPicture). */
function flagCell(galaxy: Galaxy, cell: HTMLElement, empire: Empire | null): void {
    if (empire === null) {
        cell.title = '(No Empire)';
        return;
    }
    cell.title = empire.name;
    const img = el('img', 'ships-flag');
    img.alt = '';
    img.draggable = false;
    cell.appendChild(img);
    void empireFlagUrl(galaxy, empire).then((u) => {
        img.src = u;
    });
}

function textCell(cell: HTMLElement, text: string, title = text): void {
    cell.textContent = text;
    if (title) cell.title = title;
}

function createShipsAndBasesList(opts: ShipsAndBasesListOptions): OpenState {
    const { empire } = opts;
    const galaxy = empire.galaxy;
    let filter: BuiltObjectFilter = opts.filter ?? rememberedFilter;
    let rows: ShipsAndBasesRow[] = [];
    let current: ShipsAndBasesRow[] = [];
    let activeTab = 'cargo';
    let retrofitWin: OriginalWindow | null = null;
    let editor: { close: () => void } | null = null;

    const win = openOriginalWindow({
        id: 'ships',
        title: 'Ships and Bases',
        icon: 'shipsAndBases.png',
        width: W,
        height: H,
        onClose: () => {
            window.clearInterval(timer);
            document.removeEventListener('keydown', onKeyDown);
            retrofitWin?.close();
            editor?.close();
            open = null;
        },
    });
    const body = win.body;

    // --- Header: the role filter combo (cmbBuiltObjectFilter, header-relative (380, 12) 210 × 21) ---
    const filterSelect = dropDown(
        BUILT_OBJECT_FILTERS.map((f) => ({ value: f, label: f })),
        filter,
        (v) => {
            filter = v as BuiltObjectFilter;
            if (filter !== FILTER_SELECTED) rememberedFilter = filter;
            grid.setSelection([]);
            refresh();
        },
        'Show only ships and bases of one role',
    );
    filterSelect.classList.add('ships-filter');
    // Not in the original: refit the selection / every listed item to its newest design (fleetOps.planRetrofit).
    const refitCommand = (all: boolean) => (): void => {
        const pool = all ? selectedShips(rows) : selectedShips(current);
        const plan = planRetrofit(galaxy, empire, pool);
        if (plan.length === 0) return;
        const go = plan.filter((e) => e.skip === null).map((e) => e.ship);
        const scope = all ? 'listed ships and bases' : 'selected ships and bases';
        const send = (): void => {
            issuePlayerCommand(galaxy, empire, 'retrofitShips', [pool, null], (res) => {
                showToast(retrofitToastText(res));
                refresh();
            });
        };
        if (go.length === 0) {
            send();
            return;
        }
        void messageBox({ caption: 'Refit to latest designs?', text: retrofitConfirmText(plan, scope), buttons: ['Yes', 'No'], icon: 'question' }).then((b) => {
            if (b === 'Yes') send();
        });
    };
    const btnRefitSel = glassButton('Refit selected', {
        minorText: 'to latest design',
        size: FONT.small,
        title: 'Retrofit the highlighted ships and bases to the newest design of their type',
        onClick: refitCommand(false),
    });
    const btnRefitAll = glassButton('Refit all listed', {
        minorText: 'to latest design',
        size: FONT.small,
        title: 'Retrofit every ship and base in the current list (filter) to the newest design of its type',
        onClick: refitCommand(true),
    });
    if (win.header) {
        win.header.append(place(filterSelect, 380, 12, 210, 21), place(btnRefitSel, 600, 8, 170, 35), place(btnRefitAll, 776, 8, 170, 35));
    }

    // --- The list (ctlBuiltObjectList) ---
    const nameColor = (r: ShipsAndBasesRow): string => (r.nameState === 'damaged' ? 'rgb(255, 0, 0)' : r.nameState === 'unbuilt' ? 'rgb(255, 165, 0)' : '');
    /** One shipAction command per ship; `done` after the last one applied. */
    const shipActions = (ships: BuiltObject[], action: (b: BuiltObject) => ShipAction, done: () => void): void => {
        ships.forEach((b, i) => {
            issuePlayerCommand(galaxy, empire, 'shipAction', [b, action(b), false, undefined], i === ships.length - 1 ? () => done() : undefined);
        });
    };
    const toggleAutomation = (ships: BuiltObject[], on: boolean): void => {
        const own = ships.filter((b) => b.owner === empire && b.role !== BuiltObjectRole.Base);
        shipActions(own, (b) => ShipAction.forAction(on ? ShipActionType.AutomateShip : ShipActionType.UnautomateShip, b), () => refresh());
    };
    const columns: GridColumn<ShipsAndBasesRow>[] = [
        { id: 'empire', header: 'Empire', width: 25, align: 'center', sort: (r) => (r.stellarObject.empire as Empire | null)?.name ?? '', render: (r, c) => flagCell(galaxy, c, (r.stellarObject.empire as Empire | null) ?? null) },
        {
            id: 'picture',
            header: '',
            width: 35,
            align: 'center',
            render: (r, c) => {
                if (r.builtObject !== null) imageCell(c, shipImageUrl(r.builtObject), 28, -90, `${r.builtObject.design?.name ?? ''} (${BuiltObjectSubRole[r.builtObject.subRole]})`);
                else imageCell(c, habitatImageUrl(r.stellarObject as Habitat), 26);
            },
        },
        {
            id: 'name',
            header: 'Name',
            width: 140,
            sort: (r) => r.name,
            render: (r, c) => {
                textCell(c, r.name, r.nameTip || r.name);
                const col = nameColor(r);
                if (col) c.style.color = col;
            },
        },
        { id: 'role', header: 'Role', width: 130, sort: (r) => r.role, render: (r, c) => textCell(c, r.role) },
        { id: 'mission', header: 'Mission', width: 65, sort: (r) => r.mission, render: (r, c) => textCell(c, r.mission) },
        { id: 'system', header: 'System', width: 70, sort: (r) => r.system, render: (r, c) => textCell(c, r.system) },
        { id: 'firepower', header: 'Firepower', width: 30, align: 'right', sort: (r) => r.firepower, render: (r, c) => textCell(c, String(Math.round(r.firepower)), 'Firepower') },
        { id: 'speed', header: 'Speed', width: 30, align: 'right', sort: (r) => r.speed, render: (r, c) => textCell(c, String(r.speed), 'Speed') },
        { id: 'maint', header: 'Maintenance Cost', width: 40, align: 'right', sort: (r) => r.maintenance, render: (r, c) => textCell(c, String(Math.round(r.maintenance)), 'Maintenance Cost') },
        { id: 'fleet', header: 'Fleet', width: 65, sort: (r) => r.fleet, render: (r, c) => textCell(c, r.fleet) },
        {
            id: 'auto',
            header: 'Automated',
            width: 50,
            align: 'center',
            sort: (r) => (r.automated ? 'Automated' : 'Not automated'),
            render: (r, c) => {
                if (r.builtObject === null) return;
                const t = r.automated ? 'Automated' : 'Not automated';
                c.title = t;
                if (r.automated) imageCell(c, '/assets/dwu/images/ui/chrome/automate.png', 18, 0, t);
            },
            // Main.Part6.cs ctlBuiltObjectList_CellClick: toggle IsAutoControlled for the player's own non-base ships.
            onClick: (r) => {
                const b = r.builtObject;
                if (b === null || b.owner !== empire || b.role === BuiltObjectRole.Base) return;
                toggleAutomation([b], !b.isAutoControlled);
            },
        },
    ];
    const grid = new OwGrid<ShipsAndBasesRow>({
        columns,
        key: (r) => r.stellarObject,
        rowHeight: 30,
        multiSelect: true,
        empty: 'No ships or bases',
        rowClass: (r) => (r.nameState !== null ? `ships-name-${r.nameState}` : ''),
        onSelectionChange: (sel) => {
            current = sel;
            selectionChanged();
        },
        onDoubleClick: (r) => {
            win.close();
            opts.onZoomTo(r.stellarObject);
        },
    });
    body.appendChild(place(grid.el, LIST.x, LIST.y, LIST.w, LIST.h));
    grid.el.classList.add('ships-grid');

    // --- Buttons under the list (method_178 rows at y 308 and 350) ---
    const btn = (label: string, x: number, y: number, w: number, h: number, title: string, onClick: () => void): HTMLButtonElement => {
        const b = glassButton(label, { title, onClick });
        body.appendChild(place(b, x, y, w, h));
        return b;
    };
    const firstRow = (): ShipsAndBasesRow | null => current[0] ?? null;
    const btnSelect = btn('Select', 10, 308, 133, 40, 'Select the first highlighted item', () => {
        const r = firstRow();
        if (r !== null) opts.onSelect(r.stellarObject);
    });
    const btnGoto = btn('Go To', 145, 308, 133, 40, 'Zoom to the first highlighted item and close', () => {
        const r = firstRow();
        if (r !== null) {
            win.close();
            opts.onZoomTo(r.stellarObject);
        }
    });
    // Main.Part6.cs btnBuiltObjectViewDesign_Click: the design editor on the ship's design (view when in use).
    const btnDesign = btn('View Design', 280, 308, 133, 40, "Open the first highlighted item's design", () => {
        const b = firstRow()?.builtObject;
        if (!b || editor !== null) return;
        const draft = newDesignDraft(galaxy, empire, { kind: 'edit', design: b.design });
        editor = openDesignEditor({
            galaxy,
            empire,
            draft,
            sourceKind: 'edit',
            sourceDesign: b.design,
            onClose: () => {
                editor = null;
            },
        });
    });
    const btnFleet = btn('View Fleet', 415, 308, 133, 40, "Open the first highlighted ship's fleet", () => {
        const b = firstRow()?.builtObject;
        if (b && b.shipGroup instanceof ShipGroup) {
            const sg = b.shipGroup;
            win.close();
            opts.onViewFleet(sg);
        }
    });
    // cmbBuiltObjectSetFleet (method_182 items: Set Fleet..., (None), (New Fleet), the fleets).
    const setFleet = el('select', 'ow-input ow-select ships-setfleet');
    setFleet.title = 'Put the highlighted military ships in a new fleet, an existing fleet, or no fleet';
    setFleet.addEventListener('keydown', (e) => e.stopPropagation());
    body.appendChild(place(setFleet, 550, 308, 140, 21));
    const fillSetFleet = (): void => {
        setFleet.replaceChildren();
        const add = (value: string, label: string): void => {
            const o = el('option', '', label);
            o.value = value;
            setFleet.appendChild(o);
        };
        add('prompt', 'Set Fleet...');
        add('none', '(None)');
        add('new', '(New Fleet)');
        empireShipGroups(empire).forEach((sg, i) => {
            if (sg !== null) add(`fleet:${i}`, sg.name ?? '(Unnamed fleet)');
        });
        setFleet.value = 'prompt';
    };
    setFleet.addEventListener('change', () => {
        const v = setFleet.value;
        const ships = selectedShips(current);
        setFleet.value = 'prompt';
        if (v === 'prompt' || ships.length === 0) return;
        let target: ShipGroup | 'new' | null;
        if (v === 'new') target = 'new';
        else if (v === 'none') target = null;
        else {
            const g = empireShipGroups(empire)[Number(v.slice(6))];
            if (g === undefined || g === null) return;
            target = g;
        }
        const issue = (): void => issuePlayerCommand(galaxy, empire, 'setShipsFleet', [ships, target], () => refresh());
        // Leaving a fleet does not ask; forming / joining does (Main.Part6.cs 2903-2907, 2953-2957).
        if (target === null) issue();
        else void withFleetFormationPrompt(empire, issue);
    });
    // Not in the original (it toggles from the Automated column only): automate / unautomate the highlighted ships.
    const btnAutomate = glassButton('Automate', {
        size: FONT.small,
        title: 'Automate the highlighted ships (or turn automation off when they are all automated)',
        onClick: () => {
            const ships = selectedShips(current).filter((b) => b.owner === empire && b.role !== BuiltObjectRole.Base);
            if (ships.length === 0) return;
            toggleAutomation(ships, !ships.every((b) => b.isAutoControlled));
        },
    });
    body.appendChild(place(btnAutomate, 550, 331, 140, 17));

    const shipsCommand = (op: 'refuelShips' | 'repairShips' | 'retireShips') => (): void => {
        const ships = selectedShips(current);
        if (ships.length > 0) issuePlayerCommand(galaxy, empire, op, [ships], () => refresh());
    };
    const btnRefuel = btn('Refuel', 10, 350, 133, 25, 'Send the highlighted ships to refuel', shipsCommand('refuelShips'));
    const btnRepair = btn('Repair', 145, 350, 133, 25, 'Send the damaged highlighted ships to a ship yard', shipsCommand('repairShips'));
    const btnRetrofit = btn('Retrofit', 280, 350, 133, 25, 'Retrofit the highlighted ships and bases (choose the design)', () => openRetrofit(selectedShips(current)));
    const btnRetire = btn('Retire', 415, 350, 133, 25, 'Send the highlighted ships to a ship yard to be retired', shipsCommand('retireShips'));
    const btnScrap = btn('Scrap', 550, 350, 140, 25, 'Scrap the highlighted ships and bases immediately', () => void scrapSelected());

    // --- Galaxy map (gmapBuiltObject) ---
    dropText(body, 'Location of selected item in Galaxy', MAP.x, 7, { size: FONT.tiny, color: COLORS.label });
    const mapCanvas = el('canvas', 'ships-map');
    body.appendChild(place(mapCanvas, MAP.x, MAP.y, MAP.size, MAP.size));

    // --- Name box (lblBuiltObjectName + hvhxxedjqS) ---
    dropText(body, 'Name', 700, 357, { size: FONT.header, bold: true, color: COLORS.label });
    const nameBox = textBox('', '', () => undefined);
    nameBox.classList.add('ships-namebox');
    nameBox.style.fontSize = `${FONT.large}px`;
    nameBox.style.fontWeight = 'bold';
    body.appendChild(place(nameBox, 750, 355, 250, 22));
    const commitName = (): void => {
        const r = firstRow();
        const name = nameBox.value;
        if (r === null || r.builtObject === null || name.trim() === '' || name === r.builtObject.name) return;
        issuePlayerCommand(galaxy, empire, 'renameShip', [r.builtObject, name], () => refresh());
    };
    nameBox.addEventListener('blur', commitName);
    nameBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameBox.blur();
    });

    // --- Detail InfoPanel (pnlBuiltObjectDetail, CornerCurveMode.BottomRight_TopLeft) ---
    const detailFrame = gradientPanel({ corners: { tl: true, br: true }, radius: 12, className: 'sel-frame ships-detail' });
    const detailContent = el('div', 'sel-content-box ships-detail-content');
    detailFrame.appendChild(detailContent);
    body.appendChild(place(detailFrame, DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h));

    // --- Data tabs (tabBuiltObjectData) ---
    const TAB_IDS = ['cargo', 'components', 'yards', 'docking', 'troops', 'weapons', 'jobs'] as const;
    const tabs = tabStrip(
        TAB_IDS.map((id) => ({ id, label: id })),
        activeTab,
        (id) => {
            activeTab = id;
            pageKey = '';
            buildPage();
        },
    );
    tabs.classList.add('ships-tabs');
    body.appendChild(place(tabs, TABS.x, TABS.y, TABS.w, TAB_STRIP_H));
    const page = el('div', 'ships-page');
    body.appendChild(place(page, TABS.x, TABS.y + TAB_STRIP_H, TABS.w, TABS.h - TAB_STRIP_H));
    const tabButtons = [...tabs.querySelectorAll<HTMLElement>('.ow-tab')];

    function updateTabLabels(): void {
        const o = current.length === 1 ? current[0].stellarObject : null;
        const l = builtObjectTabLabels(o);
        const jobs = constructionJobRows(galaxy, empire).length;
        const labels = [l.cargo, l.components, l.yards, l.docking, l.troops, l.weapons, `Construction Jobs${jobs > 0 ? ` (${jobs})` : ''}`];
        tabButtons.forEach((b, i) => setText(b, labels[i]));
    }

    // Pages: rebuilt when their content key changes (the timer refreshes in place otherwise).
    let pageKey = '';
    function pageGrid<T>(cols: GridColumn<T>[], data: T[], x: number, y: number, w: number, h: number, empty: string): OwGrid<T> {
        const g = new OwGrid<T>({ columns: cols, key: (r) => r, rowHeight: 26, empty });
        g.setRows(data);
        page.appendChild(place(g.el, x, y, w, h));
        return g;
    }
    function buildPage(): void {
        // Read-only: the sim queries this runs must not write the game (sim/readOnlyQuery.ts; docs/sim-worker.md §9 chunk 6).
        return readOnlyQuery(() => buildPageQuery());
    }

    function buildPageQuery(): void {
        const o = current.length === 1 ? current[0].stellarObject : null;
        const bo = o !== null && !(o instanceof Habitat) ? (o as BuiltObject) : null;
        let key = `${activeTab}|`;
        if (activeTab === 'jobs') {
            key += constructionJobRows(galaxy, empire).map((j) => `${j.id}:${j.state}:${j.shipName}:${j.etaMs === null ? '' : Math.round(j.etaMs / 1000)}`).join(',');
        } else if (o !== null) {
            key += pageContentKey(activeTab, o);
        }
        if (key === pageKey) return;
        pageKey = key;
        page.replaceChildren();
        switch (activeTab) {
            case 'cargo': {
                // ctlBuiltObjectCargo (350 × 275): Empire 30, Picture 40, Name 160, Amount 60, Reserved 60.
                type CargoRow = { empire: Empire | null; url: string | null; name: string; amount: number; reserved: number };
                const items = ((o?.cargo as { items?: { commodity: { resourceId: number }; commodityComponent: { componentId: number } | null; amount: number; reserved: number; empire: unknown }[] } | null)?.items ?? []).map((c): CargoRow => {
                    const res = c.commodityComponent === null ? galaxy.resources.find((r) => r.resourceId === c.commodity.resourceId) : undefined;
                    const comp = c.commodityComponent !== null ? galaxy.researchStatic?.componentsById.get(c.commodityComponent.componentId) : undefined;
                    return {
                        empire: (c.empire as Empire | null) ?? null,
                        url: res ? resourceIconUrl(res.pictureRef) : null,
                        name: res?.name ?? (comp as { name?: string } | undefined)?.name ?? '',
                        amount: c.amount,
                        reserved: c.reserved,
                    };
                });
                pageGrid<CargoRow>(
                    [
                        { id: 'e', header: 'Empire', width: 30, render: (r, c) => flagCell(galaxy, c, r.empire) },
                        { id: 'p', header: '', width: 40, align: 'center', render: (r, c) => imageCell(c, r.url, 22) },
                        { id: 'n', header: 'Name', width: 160, sort: (r) => r.name, render: (r, c) => textCell(c, r.name) },
                        { id: 'a', header: 'Amount', width: 60, align: 'right', sort: (r) => r.amount, render: (r, c) => textCell(c, r.amount.toLocaleString('en-US')) },
                        { id: 'r', header: 'Reserved', width: 60, align: 'right', sort: (r) => r.reserved, render: (r, c) => textCell(c, r.reserved.toLocaleString('en-US')) },
                    ],
                    items,
                    0, 0, 350, 274, o === null ? '' : 'No cargo',
                );
                break;
            }
            case 'components': {
                // ctlBuiltObjectComponents (455 × 275).
                type CompRow = { name: string; category: string; status: ComponentStatus };
                const comps = (bo?.components as unknown as { items?: unknown[] } | null | undefined);
                const list = ((Array.isArray(comps) ? comps : comps?.items) ?? []) as { def: { name: string; category: number }; status: ComponentStatus }[];
                const data: CompRow[] = list.map((c) => ({ name: c.def.name, category: enumWords(componentCategoryName(c.def.category)), status: c.status }));
                const statusText = (s: ComponentStatus): string => (s === ComponentStatus.Damaged ? 'Damaged' : s === ComponentStatus.Unbuilt ? 'Unbuilt' : 'Normal');
                pageGrid<CompRow>(
                    [
                        { id: 'n', header: 'Component', width: 200, sort: (r) => r.name, render: (r, c) => { textCell(c, r.name); if (r.status !== ComponentStatus.Normal) c.style.color = r.status === ComponentStatus.Damaged ? 'rgb(255, 0, 0)' : 'rgb(255, 165, 0)'; } },
                        { id: 'c', header: 'Type', width: 150, sort: (r) => r.category, render: (r, c) => textCell(c, r.category) },
                        { id: 's', header: 'Status', fill: 1, sort: (r) => r.status, render: (r, c) => textCell(c, statusText(r.status)) },
                    ],
                    data,
                    0, 0, 455, 274, bo === null ? '' : 'No components',
                );
                if (bo !== null) {
                    dropText(page, 'Retrofit Stance', 465, 220, { size: FONT.large, color: COLORS.label });
                    const stance = dropDown([{ value: 'auto', label: 'Auto Retrofit (including advisor suggestions)' }, { value: 'never', label: 'Only Retrofit When Manually Ordered' }], bo.suppressAutoRetrofit ? 'never' : 'auto',
                        (v) => issuePlayerCommand(galaxy, empire, 'setShipRetrofitStance', [[bo], v === 'auto'], () => { pageKey = ''; buildPage(); }));
                    // cmbBuiltObjectAutoRetrofit.Enabled = false for the private sub-roles (and, here, for ships that are not ours).
                    stance.disabled = bo.empire !== empire || isPrivateDesignSubRole(bo.subRole);
                    page.appendChild(place(stance, 465, 240, 200, 21));
                }
                break;
            }
            case 'yards': {
                // ctlConstructionYards (390 × 150) + the wait queue (390 × 95 at (0, 180)).
                const site: ConstructionSite | null = o === null ? null : o instanceof Habitat ? { kind: 'colony', habitat: o } : { kind: 'builtObject', builtObject: o as BuiltObject };
                const compName = (id: number): string => galaxy.researchStatic?.componentsById.get(id)?.name ?? '';
                const yards = site !== null && o!.constructionQueue ? yardRows(site, compName) : [];
                type Y = (typeof yards)[number];
                pageGrid<Y>(
                    [
                        { id: 'n', header: 'Ship', width: 220, render: (r, c) => textCell(c, r.ship) },
                        { id: 'p', header: 'Progress', width: 80, align: 'right', render: (r, c) => textCell(c, r.ship ? r.progressText : '') },
                        { id: 's', header: 'Speed', fill: 1, align: 'right', render: (r, c) => textCell(c, String(Math.round(r.speed))) },
                    ],
                    yards,
                    0, 0, 390, 150, site === null ? '' : 'No construction yards',
                );
                dropText(page, 'Ships waiting to be constructed', 0, 160, { size: FONT.header, bold: true, color: COLORS.label });
                const waits = site !== null && o!.constructionQueue ? waitRows(site) : [];
                type Wt = (typeof waits)[number];
                pageGrid<Wt>(
                    [
                        { id: 'n', header: 'Name', width: 200, render: (r, c) => textCell(c, r.name) },
                        { id: 'r', header: 'Role', fill: 1, render: (r, c) => textCell(c, r.type) },
                    ],
                    waits,
                    0, 180, 390, 94, '',
                );
                break;
            }
            case 'docking': {
                // ctlDockingBays (555 × 130) + the wait queue (555 × 120 at (0, 155)).
                const bays = ((o?.dockingBays as { dockedShip: BuiltObject | null }[] | null) ?? []);
                pageGrid<{ dockedShip: BuiltObject | null }>(
                    [
                        { id: 'e', header: 'Empire', width: 30, render: (r, c) => (r.dockedShip ? flagCell(galaxy, c, r.dockedShip.empire) : undefined) },
                        { id: 'p', header: '', width: 40, align: 'center', render: (r, c) => (r.dockedShip ? imageCell(c, shipImageUrl(r.dockedShip), 22, -90) : undefined) },
                        { id: 'n', header: 'Ship', width: 300, render: (r, c) => textCell(c, r.dockedShip?.name ?? '(Empty)') },
                        { id: 'm', header: 'Command', fill: 1, render: (r, c) => { const m = r.dockedShip ? builtObjectMission(r.dockedShip.mission) : null; textCell(c, m !== null && m.type !== BuiltObjectMissionType.Undefined ? missionTypeLabel(m.type) : ''); } },
                    ],
                    bays,
                    0, 0, 555, 130, o === null ? '' : 'No docking bays',
                );
                dropText(page, 'Ships waiting for a Docking Bay', 0, 135, { size: FONT.header, bold: true, color: COLORS.label });
                const queue = ((o as { dockingBayWaitQueue?: BuiltObject[] | null } | null)?.dockingBayWaitQueue ?? []);
                pageGrid<BuiltObject>(
                    [
                        { id: 'e', header: 'Empire', width: 30, render: (r, c) => flagCell(galaxy, c, r.empire) },
                        { id: 'p', header: '', width: 40, align: 'center', render: (r, c) => imageCell(c, shipImageUrl(r), 22, -90) },
                        { id: 'n', header: 'Name', width: 155, render: (r, c) => textCell(c, r.name) },
                        { id: 'r', header: 'Role', width: 150, render: (r, c) => textCell(c, `${builtObjectRoleLabel(r.role)}, ${subRoleLabel(r.subRole)}`) },
                        { id: 'm', header: 'Mission', width: 80, render: (r, c) => { const m = builtObjectMission(r.mission); textCell(c, m !== null && m.type !== BuiltObjectMissionType.Undefined ? missionTypeLabel(m.type) : '(None)'); } },
                        { id: 's', header: 'System', fill: 1, render: (r, c) => textCell(c, r.nearestSystemStar?.name ?? '') },
                    ],
                    queue,
                    0, 155, 555, 119, '',
                );
                break;
            }
            case 'troops': {
                // ctlBuiltObjectCharactersTroops (455 × 275): the characters, then the troops.
                type TRow = { name: string; type: string; strength: string; troop: TroopRow | null };
                const chars = (((o as { characters?: unknown } | null)?.characters as { name: string; role: CharacterRole }[] | null) ?? []).map((ch): TRow => ({ name: ch.name, type: enumWords(CharacterRole[ch.role]), strength: '', troop: null }));
                const troops = troopRows((o?.troops as { items?: never[] } | null)?.items ?? []).map((t): TRow => ({ name: t.name, type: t.type, strength: `${Math.round(t.attack)} / ${Math.round(t.defend)}`, troop: t }));
                pageGrid<TRow>(
                    [
                        { id: 'n', header: 'Name', width: 170, sort: (r) => r.name, render: (r, c) => textCell(c, r.name) },
                        { id: 't', header: 'Type', width: 130, sort: (r) => r.type, render: (r, c) => textCell(c, r.type) },
                        { id: 'x', header: 'Experience', width: 70, render: (r, c) => textCell(c, r.troop?.experience ?? '') },
                        { id: 's', header: 'Att / Def', fill: 1, align: 'right', render: (r, c) => textCell(c, r.strength) },
                    ],
                    [...chars, ...troops],
                    0, 0, 455, 274, o === null ? '' : 'No troops or characters',
                );
                break;
            }
            case 'weapons': {
                // ctlWeapons (600 × 275): Picture 40, Name 135, Speed 50, EnergyRequired 50, FireRate 50, damage 275.
                type Wp = { name: string; speed: number; energy: number; fireRate: number; damage: number; range: number };
                const ws: Wp[] = (bo?.weapons ?? []).map((w) => ({ name: w.component.def.name, speed: w.speed, energy: w.energyRequired, fireRate: w.fireRate, damage: w.rawDamage, range: w.range }));
                const maxDmg = Math.max(1, ...ws.map((w) => w.damage));
                pageGrid<Wp>(
                    [
                        { id: 'n', header: 'Name', width: 175, sort: (r) => r.name, render: (r, c) => textCell(c, r.name) },
                        { id: 's', header: 'Speed', width: 50, align: 'right', sort: (r) => r.speed, render: (r, c) => textCell(c, String(Math.round(r.speed))) },
                        { id: 'e', header: 'Energy', width: 50, align: 'right', sort: (r) => r.energy, render: (r, c) => textCell(c, String(Math.round(r.energy))) },
                        { id: 'f', header: 'Fire Rate', width: 50, align: 'right', sort: (r) => r.fireRate, render: (r, c) => textCell(c, (r.fireRate / 1000).toFixed(1)) },
                        {
                            id: 'd',
                            header: 'Damage / Range',
                            fill: 1,
                            sort: (r) => r.damage,
                            render: (r, c) => {
                                const bar = el('div', 'ships-dmgbar');
                                bar.style.width = `${Math.round((r.damage / maxDmg) * 150)}px`;
                                c.append(bar, el('span', '', `${Math.round(r.damage)} @ ${Math.round(r.range)}`));
                            },
                        },
                    ],
                    ws,
                    0, 0, 600, 274, bo === null ? '' : 'No weapons',
                );
                break;
            }
            case 'jobs': {
                // Not in the original: the construction job board (open jobs, the ship that took each one, its ETA).
                const jobs = constructionJobRows(galaxy, empire);
                type J = (typeof jobs)[number];
                const small = (label: string, title: string, disabled: boolean, onClick: () => void): HTMLButtonElement => glassButton(label, { title, disabled, size: FONT.tiny, onClick });
                pageGrid<J>(
                    [
                        { id: 'l', header: 'Job', width: 280, render: (r, c) => textCell(c, r.label) },
                        { id: 's', header: 'Construction ship', width: 200, render: (r, c) => textCell(c, r.state === 'open' ? 'Open' : `${r.shipName}${r.state === 'next' ? ' (next)' : ''}`) },
                        { id: 'e', header: 'ETA', width: 90, align: 'right', render: (r, c) => textCell(c, r.etaMs === null ? '—' : formatEta(r.etaMs), "Estimated time until the job is done (travel + build, after the ship's current work)") },
                        {
                            id: 'b',
                            header: '',
                            fill: 1,
                            align: 'center',
                            render: (r, c) => {
                                const i = jobs.indexOf(r);
                                c.classList.add('ships-job-buttons');
                                c.append(
                                    small('▲', 'Move up (earlier jobs are handed out first)', i === 0, () => issuePlayerCommand(galaxy, empire, 'constructionJobMoveUp', [r.id], () => { pageKey = ''; buildPage(); })),
                                    small('✕', 'Cancel this construction job', false, () => issuePlayerCommand(galaxy, empire, 'constructionJobCancel', [r.id], () => { pageKey = ''; buildPage(); })),
                                );
                            },
                        },
                    ],
                    jobs,
                    0, 0, 680, 274,
                    'No construction jobs. Build orders for stations and bases are queued here and taken by the construction ship that can finish them first.',
                );
                break;
            }
        }
    }

    // --- Selection → detail, name, map, tabs, buttons (ctlBuiltObjectList_SelectionChanged) ---
    function updateDetail(): void {
        // Read-only: the sim queries this runs must not write the game (sim/readOnlyQuery.ts; docs/sim-worker.md §9 chunk 6).
        return readOnlyQuery(() => updateDetailQuery());
    }

    function updateDetailQuery(): void {
        const scroll = detailContent.querySelector('.sel-scroll');
        const top = scroll?.scrollTop ?? 0;
        if (current.length === 0) {
            renderInfoModel(detailContent, null, { galaxy, onTarget: () => undefined });
            return;
        }
        const resource = (id: number): { name: string; pictureRef: number } | null => galaxy.resources.find((r) => r.resourceId === id) ?? null;
        const first = current[0].stellarObject;
        const habitat = first instanceof Habitat ? first : ((first as BuiltObject).parentHabitat ?? (first as BuiltObject).nearestSystemStar ?? null);
        const sys = habitat !== null ? galaxy.systems.find((s) => s.systemStar === galaxy.determineHabitatSystemStar(habitat)) ?? galaxy.systems[0] : galaxy.systems[0];
        const sel = current.length > 1
            ? { habitat: sys.systemStar, system: sys, builtObjects: selectedShips(current) }
            : first instanceof Habitat
                ? { habitat: first, system: sys }
                : { habitat: sys.systemStar, system: sys, builtObject: first as BuiltObject };
        const model = buildInfoModel({ galaxy, player: empire, resource }, sel);
        renderInfoModel(detailContent, model, { galaxy, onTarget: () => undefined });
        const next = detailContent.querySelector('.sel-scroll');
        if (next !== null) next.scrollTop = top;
    }

    function drawMap(): void {
        // Read-only: the sim queries this runs must not write the game (sim/readOnlyQuery.ts; docs/sim-worker.md §9 chunk 6).
        return readOnlyQuery(() => drawMapQuery());
    }

    function drawMapQuery(): void {
        const dpr = Math.min(3, window.devicePixelRatio || 1) * Math.max(1, win.scale);
        const N = MAP.size;
        mapCanvas.width = Math.round(N * dpr);
        mapCanvas.height = Math.round(N * dpr);
        const ctx = mapCanvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, N, N);
        const s = galaxyMapScale(galaxy, N);
        // Sector grid with the A.. / 1.. labels (GalaxyMap.cs method_6, pen_1).
        const sec = galaxy.sectorSize / s;
        ctx.strokeStyle = GRID_COLOR;
        ctx.fillStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.font = `9px 'Forgotten Futurist', sans-serif`;
        const nx = Math.ceil(galaxy.sizeX / galaxy.sectorSize);
        const ny = Math.ceil(galaxy.sizeY / galaxy.sectorSize);
        for (let i = 0; i <= nx; i++) {
            const x = Math.round(i * sec) + 0.5;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, N);
            ctx.stroke();
            if (i < nx) ctx.fillText(sectorColumnLabel(i), x + 2, 9);
        }
        for (let j = 0; j <= ny; j++) {
            const y = Math.round(j * sec) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(N, y);
            ctx.stroke();
            if (j < ny && j > 0) ctx.fillText(String(j + 1), 2, y + 9);
        }
        const locations = filter !== FILTER_ALL ? rows.map((r) => r.stellarObject) : [];
        const sizes = starDotSizes(N, false);
        for (const sys of galaxy.systems) {
            const c = locations.length > 0 ? DIMMED_COLOR : starBrushColor(sys.systemStar);
            if (c === null) continue;
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.ellipse(sys.systemStar.xpos / s, sys.systemStar.ypos / s, sizes.normal / 2, sizes.normal / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        // SetLocations: a 5 px yellow dot per listed object.
        ctx.fillStyle = 'rgb(255, 255, 0)';
        for (const o of locations) {
            ctx.beginPath();
            ctx.ellipse(Math.trunc(o.xpos / s), Math.trunc(o.ypos / s), 2.5, 2.5, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        // SetPosition: the crosshair (pen_2) on the selected item.
        const sel = current[0]?.stellarObject;
        if (sel && sel.xpos > 0 && sel.ypos > 0) {
            const x = Math.trunc(sel.xpos / s) + 1.5;
            const y = Math.trunc(sel.ypos / s) + 1.5;
            ctx.strokeStyle = CROSSHAIR_COLOR;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, N);
            ctx.moveTo(0, y);
            ctx.lineTo(N, y);
            ctx.stroke();
        }
    }

    function updateButtons(): void {
        const ships = selectedShips(current);
        const st = shipsActionState(ships);
        const any = current.length > 0;
        btnSelect.disabled = !any;
        btnGoto.disabled = !any;
        btnDesign.disabled = !(current[0]?.builtObject ?? null);
        btnFleet.disabled = !st.viewFleet;
        setFleet.disabled = !st.setFleet;
        btnRefuel.disabled = !st.refuel;
        btnRepair.disabled = !st.repair;
        btnRetrofit.disabled = !st.retrofit;
        btnRetire.disabled = !st.retire;
        btnScrap.disabled = !st.scrap;
        btnRefitSel.disabled = ships.length === 0;
        btnRefitAll.disabled = selectedShips(rows).length === 0;
        const own = ships.filter((b) => b.owner === empire && b.role !== BuiltObjectRole.Base);
        btnAutomate.disabled = own.length === 0;
        setButtonLabel(btnAutomate, own.length > 0 && own.every((b) => b.isAutoControlled) ? 'Unautomate' : 'Automate');
    }

    function selectionChanged(): void {
        const r = current[0] ?? null;
        if (document.activeElement !== nameBox) nameBox.value = current.length === 1 && r !== null ? r.name : '';
        nameBox.disabled = !(current.length === 1 && r !== null && r.builtObject !== null);
        win.setTitle(current.length > 1 ? `Ships and Bases (${rows.length}) - ${current.length} selected` : `Ships and Bases (${rows.length})`);
        updateDetail();
        updateTabLabels();
        pageKey = '';
        buildPage();
        drawMap();
        updateButtons();
    }

    /** Rebuild the rows from the sim (after a filter change or an applied command), keeping the selection. */
    function refresh(): void {
        // Read-only: the sim queries this runs must not write the game (sim/readOnlyQuery.ts; docs/sim-worker.md §9 chunk 6).
        return readOnlyQuery(() => refreshQuery());
    }

    function refreshQuery(): void {
        rows = shipsAndBasesRows(empire, opts.selected, filter);
        const keep = grid.selectedRows.map((r) => r.stellarObject);
        grid.setRows(rows);
        grid.setSelection(keep);
        current = grid.selectedRows;
        fillSetFleet();
        selectionChanged();
    }

    // --- Retrofit dialog (pnlRetrofit, 400 × 279: Main.Part3.cs method_574) ---
    function openRetrofit(ships: BuiltObject[]): void {
        if (ships.length === 0) return;
        retrofitWin?.close();
        const rw = openOriginalWindow({ id: 'retrofit', title: 'Retrofit', width: 400, height: 279, onClose: () => { retrofitWin = null; } });
        retrofitWin = rw;
        rw.root.classList.add('ow-modal');
        const sub = retrofitCommonSubRole(ships);
        const designs: Design[] = sub !== null ? getBuildableDesignsBySubRoles(empire.designs, [sub], empire) : [];
        const costLabel = dropText(rw.body, '', 80, 6, { size: FONT.small, color: COLORS.text });
        dropText(rw.body, 'Design', 10, 29, { size: FONT.normal, color: COLORS.label });
        let design: Design | null = null;
        const go = glassButton('Retrofit', { size: FONT.header });
        const warnings = retrofitWarnings(ships);
        const update = (): void => {
            const plan = planRetrofit(galaxy, empire, ships, design);
            const cost = plan.filter((e) => e.skip === null).reduce((n, e) => n + e.cost, 0);
            setText(costLabel, retrofitCostText(cost, empire.stateMoney));
            go.disabled = cost > empire.stateMoney || plan.every((e) => e.skip !== null);
            setText(msg, [...warnings, retrofitPlanSummary(plan)].join('\n\n'));
        };
        // cmbRetrofitDesign: the buildable designs of the common sub-role; "(Newest design)" = method_575's per-ship
        // FindNewestCanBuildFullEvaluate.
        const combo = dropDown(
            [{ value: '', label: '(Newest design for each item)' }, ...designs.map((d, i) => ({ value: String(i), label: d.name }))],
            '',
            (v) => {
                design = v === '' ? null : designs[Number(v)] ?? null;
                update();
            },
        );
        combo.disabled = sub === null;
        rw.body.appendChild(place(combo, 80, 25, 295, 21));
        const msg = dropText(rw.body, '', 10, 60, { size: FONT.normal, color: COLORS.text, wrapWidth: 370 });
        msg.style.maxHeight = '100px';
        msg.style.overflow = 'hidden';
        rw.body.appendChild(place(go, 10, 165, 365, 40));
        go.addEventListener('click', () => {
            const d = design;
            rw.close();
            issuePlayerCommand(galaxy, empire, 'retrofitShips', [ships, d], (res) => {
                showToast(retrofitToastText(res));
                refresh();
            });
        });
        update();
    }

    // --- Scrap (btnBuiltObjectScrapSelected_Click) ---
    async function scrapSelected(): Promise<void> {
        const ships = selectedShips(current);
        if (ships.length === 0) return;
        const answer = await messageBox({
            caption: 'Scrap selected ships and bases?',
            text: 'Scrapping ships and bases permanently and immediately removes them from the game',
            buttons: ['Yes', 'No'],
            defaultButton: 'No',
            icon: 'warning',
        });
        if (answer !== 'Yes' || win.closed) return;
        // The row before the first selected one (or after it, at the top) becomes the selection.
        const shown = grid.displayed;
        const i = shown.indexOf(current[0]);
        const nextSel = shown.slice(0, Math.max(0, i)).reverse().concat(shown.slice(i + 1)).find((r) => !ships.includes(r.builtObject as BuiltObject));
        // Main.Part7.cs: a base's Retire with no target tears it (and its construction queue) down; a ship's Retire on
        // itself is "Scrap Ships Immediately".
        shipActions(ships, (b) => ShipAction.forMission(BuiltObjectMissionType.Retire, b.role === BuiltObjectRole.Base ? null : b), () => {
            grid.setSelection(nextSel ? [nextSel.stellarObject] : []);
            refresh();
        });
    }

    // Ctrl+A selects every row (DataGridView MultiSelect) while the window is open and no input has focus.
    function onKeyDown(e: KeyboardEvent): void {
        if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
            e.preventDefault();
            grid.selectAll();
        }
    }
    document.addEventListener('keydown', onKeyDown);

    // The InfoPanel, the open tab and the map follow the sim; the list itself is rebound on commands / filter changes
    // (like the original, which binds it once).
    // Worker mode: bring what the screen shows up to date now instead of up to a cold cycle later (no-op in-thread).
    requestSimRefresh(galaxy, [empire, empire.builtObjects, empire.privateBuiltObjects], () => {
        if (!win.closed) refresh();
    });
    const timer = window.setInterval(() => {
        if (win.closed) return;
        updateDetail();
        updateTabLabels();
        buildPage();
        drawMap();
    }, 1000);

    rows = shipsAndBasesRows(empire, opts.selected, filter);
    grid.setRows(rows);
    // method_178: SelectBuiltObject(the selected ship) — the first row is the nearest to the selection.
    const sel0 = opts.selected as BuiltObject | Habitat | null;
    const preselect = rows.find((r) => r.stellarObject === sel0) ?? null;
    if (preselect !== null) grid.setSelection([preselect.stellarObject], true);
    current = grid.selectedRows;
    fillSetFleet();
    selectionChanged();

    return { win, close: () => win.close() };
}

/** Content key of a data tab (rebuild the page only when it changed). */
function pageContentKey(tab: string, o: BuiltObject | Habitat): string {
    const len = (v: unknown): number => (Array.isArray(v) ? v.length : ((v as { items?: unknown[] } | null)?.items?.length ?? 0));
    switch (tab) {
        case 'cargo':
            return ((o.cargo as { items?: { amount: number; reserved: number }[] } | null)?.items ?? []).map((c) => `${c.amount}/${c.reserved}`).join(',');
        case 'components': {
            const comps = (o as BuiltObject).components as unknown as { items?: { status: number }[] } | { status: number }[] | undefined;
            const list = (Array.isArray(comps) ? comps : comps?.items) ?? [];
            return `${(o as BuiltObject).name}:${list.map((c) => c.status).join('')}:${(o as BuiltObject).suppressAutoRetrofit ? 1 : 0}`;
        }
        case 'yards': {
            const q = o.constructionQueue as { constructionYards?: { shipUnderConstruction: { name: string } | null }[] | null; constructionWaitQueue?: unknown[] | null } | null;
            return `${(q?.constructionYards ?? []).map((y) => y.shipUnderConstruction?.name ?? '').join(',')}|${len(q?.constructionWaitQueue)}|${Math.floor(Date.now() / 5000)}`;
        }
        case 'docking':
            return `${((o.dockingBays as { dockedShip: { name: string } | null }[] | null) ?? []).map((d) => d.dockedShip?.name ?? '').join(',')}|${len((o as { dockingBayWaitQueue?: unknown }).dockingBayWaitQueue)}`;
        case 'troops':
            return `${len(o.troops)}|${len((o as { characters?: unknown }).characters)}`;
        case 'weapons':
            return `${(o as BuiltObject).name}:${len((o as BuiltObject).weapons)}`;
    }
    return '';
}

/** ComponentCategoryType member name of a category value. */
function componentCategoryName(category: number): string {
    return (ComponentCategoryType as unknown as Record<number, string>)[category] ?? '';
}
