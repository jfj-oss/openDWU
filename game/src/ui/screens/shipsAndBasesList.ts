// Ships and Bases window (task 13f, extended): a streamlined port of the original's Ships and Bases window
// (Main.Part9.cs tbtnBuiltObjects_Click -> Main.Part11.cs method_178 layout, BaconMain.cs method_423 for the list and its
// filter, BuiltObjectListView.cs for the row columns), opened by F11 or the top-bar button. Rows are the empire's
// ships and bases, filtered by the role combo (cmbBuiltObjectFilter, the 18 entries of Main.Part3.cs
// SetControlLocalizedLabels), sorted by distance to the selection, multi-selectable (DataGridView MultiSelect: click,
// Ctrl+click, Shift+click) and acted on as a group: Select / Go to / View Fleet (Main.Part4.cs btnBuiltObjectSelect_Click,
// Main.Part11.cs btnBuiltObjectGoto_Click, Main.Part6.cs btnBuiltObjectViewShipGroup_Click), the Set Fleet combo
// (Main.Part6.cs cmbBuiltObjectSetFleet_SelectedIndexChanged: New Fleet / join a fleet / leave) and Refuel / Repair /
// Retire (Main.Part3.cs btnBuiltObject{Refuel,Repair,Retire}Selected_Click). Every command goes through the player
// command queue (playerOps setShipsFleet / refuelShips / repairShips / retireShips).
// TODO(port): the detail tabs, the galaxy mini map and Retrofit / Scrap selected (Main.Part3.cs
// btnBuiltObjectRetrofitSelected_Click dialog, btnBuiltObjectScrapSelected_Click) — not in this window yet.

import './shipsAndBasesList.css';
import type { BuiltObject } from '../../sim/builtObject';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../../sim/missions/mission';
import { ShipGroup, empireShipGroups } from '../../sim/fleets/shipGroup';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { subRoleLabel, missionTypeLabel } from '../hud';
import { ListSelection } from '../listSelection';
import { confirmAutomationOff } from '../orderMenu';

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
     * when the sub-role is Undefined. */
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

/** Rows for the panel: the objects the filter lists (default "(Show all ships and bases)": the empire's state-owned +
 * private ships and bases), stably sorted by squared distance to `selected` when there is one. */
export function shipsAndBasesRows(
    empire: ShipsAndBasesEmpire,
    selected: { xpos: number; ypos: number } | null,
    filter: BuiltObjectFilter = FILTER_ALL,
): ShipsAndBasesRow[] {
    return filterBuiltObjects(empire, filter, selected).map((o) => {
        if (!isBuiltObject(o)) {
            return {
                builtObject: null,
                stellarObject: o,
                name: o.name,
                role: 'Colony',
                mission: '',
                system: (o as Habitat & { nearestSystemStar?: { name: string } | null }).nearestSystemStar?.name ?? '',
                location: '',
                fleet: '',
                automated: false,
            };
        }
        const sub = subRoleLabel(o.subRole);
        const m = builtObjectMission(o.mission);
        const sg = o.shipGroup as { name?: string | null } | null | undefined;
        const fleet = sg === null || sg === undefined ? null : sg.name || '(Unnamed fleet)';
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
        };
    });
}

/** The ships (not colonies) of a row selection. */
export function selectedShips(rows: readonly ShipsAndBasesRow[]): BuiltObject[] {
    return rows.map((r) => r.builtObject).filter((b): b is BuiltObject => b !== null);
}

/** Main.Part6.cs ctlBuiltObjectList_SelectionChanged_1 (enable rules of the buttons under the list), for the selection. */
export interface ShipsActionState {
    /** Set Fleet combo: enabled when a Military ship is selected. */
    setFleet: boolean;
    /** View Fleet: the first selected ship is in a fleet. */
    viewFleet: boolean;
    retire: boolean;
    refuel: boolean;
    repair: boolean;
}
export function shipsActionState(ships: readonly BuiltObject[]): ShipsActionState {
    const mobile = (b: BuiltObject): boolean => b.topSpeed > 0 && b.role !== BuiltObjectRole.Base;
    return {
        setFleet: ships.some((b) => b.role === BuiltObjectRole.Military),
        viewFleet: ships.length > 0 && ships[0].shipGroup !== null && ships[0].shipGroup !== undefined,
        retire: ships.some((b) => b.owner !== null && mobile(b)),
        refuel: ships.some(mobile),
        repair: ships.some((b) => mobile(b) && b.damagedComponentCount > 0),
    };
}

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
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;
/** int_60: the filter the window reopens with (the "Selected Item" filter is not remembered, Main.Part6.cs 3050). */
let rememberedFilter: BuiltObjectFilter = FILTER_ALL;

/** Open the Ships and Bases list, or close it if it is already open. */
export function toggleShipsAndBasesList(opts: ShipsAndBasesListOptions): void {
    if (open) {
        open.close();
    } else {
        open = createShipsAndBasesList(opts);
    }
}

/** Close the Ships and Bases list (no-op when closed). */
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

function createShipsAndBasesList(opts: ShipsAndBasesListOptions): OpenState {
    const { empire } = opts;
    const galaxy = empire.galaxy;
    let filter: BuiltObjectFilter = opts.filter ?? rememberedFilter;
    let rows: ShipsAndBasesRow[] = [];
    const selection = new ListSelection<ShipsAndBasesRow>();

    const root = document.createElement('div');
    root.className = 'ships-list-wrap';

    const win = document.createElement('div');
    win.className = 'ships-list-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'ships-list-titlebar';
    const heading = document.createElement('div');
    heading.className = 'ships-list-heading';
    titlebar.appendChild(heading);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ships-list-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    // Filter combo (cmbBuiltObjectFilter) + selection count.
    const toolbar = document.createElement('div');
    toolbar.className = 'ships-list-toolbar';
    const filterSelect = document.createElement('select');
    filterSelect.className = 'ships-list-filter';
    filterSelect.title = 'Show only ships and bases of one role';
    for (const f of BUILT_OBJECT_FILTERS) {
        const o = document.createElement('option');
        o.value = f;
        o.textContent = f;
        filterSelect.appendChild(o);
    }
    filterSelect.value = filter;
    const selCount = document.createElement('span');
    selCount.className = 'ships-list-selcount';
    toolbar.append(filterSelect, selCount);
    win.appendChild(toolbar);

    const body = document.createElement('div');
    body.className = 'ships-list-body';
    win.appendChild(body);

    // Action bar under the list (Main.Part11.cs method_178 button row).
    const actions = document.createElement('div');
    actions.className = 'ships-list-actions';
    const button = (text: string, title: string, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ships-list-button';
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', onClick);
        actions.appendChild(b);
        return b;
    };
    const selectedRows = (): ShipsAndBasesRow[] => selection.selected();
    const btnSelect = button('Select', 'Select the first highlighted item', () => {
        const r = selection.first();
        if (r !== null) opts.onSelect(r.stellarObject);
    });
    const btnGoto = button('Go to', 'Zoom to the first highlighted item and close', () => {
        const r = selection.first();
        if (r !== null) {
            close();
            opts.onZoomTo(r.stellarObject);
        }
    });
    const btnFleet = button('View Fleet', "Open the first highlighted ship's fleet", () => {
        const b = selection.first()?.builtObject;
        if (b !== null && b !== undefined && b.shipGroup instanceof ShipGroup) {
            const sg = b.shipGroup;
            close();
            opts.onViewFleet(sg);
        }
    });
    const setFleet = document.createElement('select');
    setFleet.className = 'ships-list-setfleet';
    setFleet.title = 'Put the highlighted military ships in a new fleet, an existing fleet, or no fleet';
    actions.appendChild(setFleet);
    const SET_FLEET_PROMPT = 'Set Fleet...';
    const SET_FLEET_NEW = '(New Fleet)';
    const SET_FLEET_NONE = '(None)';
    const fillSetFleet = (): void => {
        setFleet.replaceChildren();
        const add = (value: string, text: string): void => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = text;
            setFleet.appendChild(o);
        };
        add('prompt', SET_FLEET_PROMPT);
        add('none', SET_FLEET_NONE);
        empireShipGroups(empire).forEach((sg, i) => {
            if (sg !== null) add(`fleet:${i}`, sg.name ?? '(Unnamed fleet)');
        });
        add('new', SET_FLEET_NEW);
        setFleet.value = 'prompt';
    };
    setFleet.addEventListener('change', () => {
        const v = setFleet.value;
        const ships = selectedShips(selectedRows());
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
        const done = (): void => {
            refresh();
        };
        const issue = (): void => issuePlayerCommand(galaxy, empire, 'setShipsFleet', [ships, target], done);
        // Leaving a fleet does not ask; forming / joining does (Main.Part6.cs 2903-2907, 2953-2957).
        if (target === null) issue();
        else void withFleetFormationPrompt(empire, issue);
    });
    const shipsCommand = (op: 'refuelShips' | 'repairShips' | 'retireShips') => (): void => {
        const ships = selectedShips(selectedRows());
        if (ships.length > 0) issuePlayerCommand(galaxy, empire, op, [ships], () => refresh());
    };
    const btnRefuel = button('Refuel', 'Send the highlighted ships to refuel', shipsCommand('refuelShips'));
    const btnRepair = button('Repair', 'Send the damaged highlighted ships to a ship yard', shipsCommand('repairShips'));
    const btnRetire = button('Retire', 'Send the highlighted ships to a ship yard to be retired', shipsCommand('retireShips'));
    win.appendChild(actions);

    root.appendChild(win);
    document.body.appendChild(root);

    function updateActionState(): void {
        const sel = selectedRows();
        const ships = selectedShips(sel);
        const st = shipsActionState(ships);
        btnSelect.disabled = sel.length === 0;
        btnGoto.disabled = sel.length === 0;
        btnFleet.disabled = !st.viewFleet;
        setFleet.disabled = !st.setFleet;
        btnRefuel.disabled = !st.refuel;
        btnRepair.disabled = !st.repair;
        btnRetire.disabled = !st.retire;
        selCount.textContent = sel.length > 1 ? `${sel.length} selected` : '';
    }

    const rowEls = new Map<ShipsAndBasesRow, HTMLElement>();
    function paintSelection(): void {
        for (const [r, el] of rowEls) el.classList.toggle('ships-list-row-selected', selection.isSelected(r));
        updateActionState();
    }

    function buildBody(): void {
        body.replaceChildren();
        rowEls.clear();
        heading.textContent = `${filter === FILTER_CONSTRUCTION_YARDS ? 'Construction Yards' : 'Ships and Bases'} (${rows.length})`;
        const header = document.createElement('div');
        header.className = 'ships-list-header';
        for (const text of ['Name', 'Role', 'Mission', 'System', 'Location', 'Fleet', 'Auto']) {
            const cell = document.createElement('span');
            cell.className = 'ships-list-header-cell';
            cell.textContent = text;
            header.appendChild(cell);
        }
        body.appendChild(header);
        if (rows.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ships-list-empty';
            empty.textContent = 'No ships or bases';
            body.appendChild(empty);
            return;
        }
        rows.forEach((row, index) => {
            const line = document.createElement('div');
            line.className = 'ships-list-row';
            const name = document.createElement('span');
            name.className = 'ships-list-name';
            name.textContent = row.name;
            name.title = row.name;
            const cell = (text: string): HTMLElement => {
                const el = document.createElement('span');
                el.className = 'ships-list-cell';
                el.textContent = text;
                el.title = text; // cells may be ellipsized: keep the full text in the tooltip
                return el;
            };
            line.append(name, cell(row.role), cell(row.mission), cell(row.system), cell(row.location), cell(row.fleet), cell(row.automated ? 'Auto' : ''));
            line.addEventListener('mousedown', (e) => {
                if (e.shiftKey) e.preventDefault(); // no text selection while range-selecting
            });
            line.addEventListener('click', (e) => {
                selection.click(index, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
                paintSelection();
            });
            line.addEventListener('dblclick', () => {
                close();
                opts.onZoomTo(row.stellarObject);
            });
            rowEls.set(row, line);
            body.appendChild(line);
        });
    }

    /** Rebuild the rows from the sim (after a filter change or an applied command), keeping the selection. */
    function refresh(): void {
        rows = shipsAndBasesRows(empire, opts.selected, filter);
        // Rows are rebuilt objects: carry the selection over by the listed object.
        const keep = new Set(selection.selected().map((r) => r.stellarObject));
        selection.setItems(rows);
        selection.clear();
        for (const r of rows) if (keep.has(r.stellarObject)) selection.click(rows.indexOf(r), { ctrl: true });
        fillSetFleet();
        buildBody();
        paintSelection();
    }

    filterSelect.addEventListener('change', () => {
        filter = filterSelect.value as BuiltObjectFilter;
        if (filter !== FILTER_SELECTED) rememberedFilter = filter;
        selection.clear();
        refresh();
    });

    refresh();

    function close(): void {
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu (and other open panels)
    // Escape handler (registered in createHud) from opening as well. Ctrl+A selects every row.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        } else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && !(e.target instanceof HTMLSelectElement)) {
            e.preventDefault();
            selection.selectAll();
            paintSelection();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    return { root, close };
}
