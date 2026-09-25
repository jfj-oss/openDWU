// Ship Designs panel (task 16b): a streamlined port of the original's Designs
// window (F8 / top-bar tbtnDesigns). The design list and its two filter combos
// follow Main.Part8.cs method_303 (latest buildable), method_304 (latest) and
// method_306 (filters); the row columns follow DistantWorlds.Controls
// DesignListView.cs BindData; the Obsolete / Retrofit toggles follow
// Main.Part8.cs ctlDesignsList_CellClick; the detail pane's labels come from
// DesignDefense.cs, DesignMovement.cs, DesignEnergy.cs and DesignIndustry.cs.
// The original is a full design editor window; this version lists the
// player's designs with the original's columns and shows the selected design's
// stats and components.
//
// TODO(port): design editor — design validation is UI-side in the original (Main.Part6.cs:226 GetDesignWarningMessages, :164 btnDesignsSaveDesign_Click) and no sim API exposes it for the player
// TODO(port): Upgrade column toggle — Empire.SetDesignSubRoleShouldBeUpgraded (Main.Part8.cs:1105) has no sim setter
// TODO(port): copy / delete / auto-upgrade / manual-upgrade buttons, load/save design files, design images — not in 16b

import './shipDesigns.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
import type { BuiltObject } from '../../sim/builtObject';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import {
    canBuildDesign,
    checkDesignSubRoleShouldBeUpgraded,
    findNewestCanBuildFullEvaluate,
    findNewestPlanetDestroyer,
    resolveSubRoleDescription,
} from '../../sim/designGeneration';
import { designCalculateMaintenanceCosts } from '../../sim/construction/empireConstruction';
import { formatMoney, rgbCss } from '../hud';

/** cmbDesignsFilter items (Main.Part8.cs:1006-1028). */
export enum DesignFilter { Latest, LatestBuildable, NonObsolete, BuildableNonObsolete, All }
export const DESIGN_FILTER_LABELS: readonly string[] = [
    'Show Latest Designs',
    'Show Latest Buildable Designs',
    'Show Non-Obsolete Designs',
    'Show Buildable Non-Obsolete Designs',
    'Show All Designs',
];

/** cmbDesignsFilterTypes items (Main.Part8.cs:1006-1028). */
export enum DesignTypeFilter { All, StateShips, StateBases, PrivateShips, PrivateBases }
export const DESIGN_TYPE_FILTER_LABELS: readonly string[] = [
    'Show All Design Types',
    'Show State Ships',
    'Show State Bases',
    'Show Private Ships',
    'Show Private Bases',
];

const S = BuiltObjectSubRole;

/** The sub-role walk of Main.Part8.cs:697 method_303 / :753 method_304. */
export const LATEST_DESIGN_SUBROLES: readonly BuiltObjectSubRole[] = [
    S.Escort, S.Frigate, S.Destroyer, S.Cruiser, S.CapitalShip, S.TroopTransport, S.Carrier, S.ResupplyShip,
    S.ExplorationShip, S.SmallFreighter, S.MediumFreighter, S.LargeFreighter, S.ColonyShip, S.PassengerShip,
    S.ConstructionShip, S.GasMiningShip, S.MiningShip, S.GasMiningStation, S.MiningStation, S.SmallSpacePort,
    S.MediumSpacePort, S.LargeSpacePort, S.ResortBase, S.EnergyResearchStation, S.WeaponsResearchStation,
    S.HighTechResearchStation, S.MonitoringStation, S.DefensiveBase,
];

// Main.Part8.cs:835 method_306 type filters (GetDesignsByRoles/SubRolesNoObsoleteFilter).
const STATE_SHIP_ROLES: readonly BuiltObjectRole[] = [
    BuiltObjectRole.Military, BuiltObjectRole.Exploration, BuiltObjectRole.Colony, BuiltObjectRole.Build,
];
const STATE_BASE_SUBROLES: readonly BuiltObjectSubRole[] = [
    S.DefensiveBase, S.EnergyResearchStation, S.GenericBase, S.HighTechResearchStation, S.LargeSpacePort,
    S.MediumSpacePort, S.MonitoringStation, S.ResortBase, S.SmallSpacePort, S.WeaponsResearchStation,
];
const PRIVATE_SHIP_SUBROLES: readonly BuiltObjectSubRole[] = [
    S.GasMiningShip, S.LargeFreighter, S.MediumFreighter, S.MiningShip, S.PassengerShip, S.SmallFreighter,
];
const PRIVATE_BASE_SUBROLES: readonly BuiltObjectSubRole[] = [S.GasMiningStation, S.MiningStation];

// Port of DesignList.cs:113 FindNewestNonPlanetDestroyer.
export function findNewestNonPlanetDestroyer(designs: readonly Design[], subRole: BuiltObjectSubRole): Design | null {
    let num = 0;
    let result: Design | null = null;
    for (const design of designs) {
        if (design.subRole === subRole && design.dateCreated > num && !design.isObsolete && !design.isPlanetDestroyer) {
            num = design.dateCreated;
            result = design;
        }
    }
    return result;
}

// Port of Main.Part8.cs:835 method_306 (filters) with :697 method_303 (latest
// buildable) and :753 method_304 (latest).
export function filterDesigns(player: Empire, filter: DesignFilter, typeFilter: DesignTypeFilter): Design[] {
    const designs = player.designs;
    let list: Design[] = [];
    switch (filter) {
        case DesignFilter.Latest: {
            for (const subRole of LATEST_DESIGN_SUBROLES) {
                const d = findNewestNonPlanetDestroyer(designs, subRole);
                if (d !== null) list.push(d);
            }
            const pd = findNewestPlanetDestroyer(designs);
            if (pd !== null) list.push(pd);
            for (const d of designs) if (d.subRole === S.GenericBase && !d.isObsolete) list.push(d);
            break;
        }
        case DesignFilter.LatestBuildable: {
            const colony = player.pirateEmpireBaseHabitat === null ? player.capital : null;
            for (const subRole of LATEST_DESIGN_SUBROLES) {
                const d = findNewestCanBuildFullEvaluate(designs, subRole, colony, false);
                if (d !== null) list.push(d);
            }
            const pd = findNewestPlanetDestroyer(designs);
            if (pd !== null && canBuildDesign(player, pd)) list.push(pd);
            for (const d of designs) {
                if (d.subRole === S.GenericBase && !d.isObsolete && canBuildDesign(player, d)) list.push(d);
            }
            break;
        }
        case DesignFilter.NonObsolete:
            // DesignList.cs:261 GetCurrentDesigns.
            list = designs.filter((d) => !d.isObsolete);
            break;
        case DesignFilter.BuildableNonObsolete:
            // DesignList.cs:272 GetCurrentDesignsBuildable(PlayerEmpire.Capital).
            list = designs.filter(
                (d) => !d.isObsolete && d.empire !== null && canBuildDesign(d.empire as Empire, d, true, player.capital),
            );
            break;
        case DesignFilter.All:
            list = [...designs];
            break;
    }
    switch (typeFilter) {
        case DesignTypeFilter.StateShips:
            return list.filter((d) => STATE_SHIP_ROLES.includes(d.role));
        case DesignTypeFilter.StateBases:
            return list.filter((d) => STATE_BASE_SUBROLES.includes(d.subRole));
        case DesignTypeFilter.PrivateShips:
            return list.filter((d) => PRIVATE_SHIP_SUBROLES.includes(d.subRole));
        case DesignTypeFilter.PrivateBases:
            return list.filter((d) => PRIVATE_BASE_SUBROLES.includes(d.subRole));
        default:
            return list;
    }
}

// Galaxy.ResolveDescription(BuiltObjectRole): GameText.txt:1733-1740 "Ship Role …"; Undefined → "None".
export function roleDescription(role: BuiltObjectRole): string {
    switch (role) {
        case BuiltObjectRole.Military: return 'Military';
        case BuiltObjectRole.Exploration: return 'Exploration';
        case BuiltObjectRole.Freight: return 'Freight';
        case BuiltObjectRole.Passenger: return 'Passenger';
        case BuiltObjectRole.Colony: return 'Colony';
        case BuiltObjectRole.Build: return 'Build';
        case BuiltObjectRole.Resource: return 'Resource';
        case BuiltObjectRole.Base: return 'Base';
        default: return 'None';
    }
}

/** Galaxy.RealSecondsInGalacticYear. */
const REAL_SECONDS_IN_GALACTIC_YEAR = 600;

function pad(n: number, width: number): string {
    return String(n).padStart(width, '0');
}

// Port of DesignListView.cs:301 BindData, the "Date Created" cell (year.month.day).
export function designDateCreatedText(dateCreated: number): string {
    const num3 = Math.trunc(dateCreated / (1000 * REAL_SECONDS_IN_GALACTIC_YEAR));
    const num4 = num3 * (1000 * REAL_SECONDS_IN_GALACTIC_YEAR);
    const num5 = Math.trunc((dateCreated - num4) / (100 * REAL_SECONDS_IN_GALACTIC_YEAR));
    const num6 = num5 * (100 * REAL_SECONDS_IN_GALACTIC_YEAR);
    const num7 = Math.trunc((dateCreated - (num4 + num6)) / 2000);
    return `${pad(num3, 4)}.${pad(num5 + 1, 2)}.${pad(num7 + 1, 2)}`;
}

// DesignListView.cs BindData / Main.Part8.cs:1082 ctlDesignsList_CellClick: the six private sub-roles
// whose designs cannot be manually retrofitted.
export function isPrivateDesignSubRole(subRole: BuiltObjectSubRole): boolean {
    switch (subRole) {
        case S.SmallFreighter:
        case S.MediumFreighter:
        case S.LargeFreighter:
        case S.PassengerShip:
        case S.GasMiningShip:
        case S.MiningShip:
            return true;
        default:
            return false;
    }
}

// DesignListView.cs BindData "Amount": Empire.BuiltObjects + PrivateBuiltObjects of this design.
export function designAmount(design: Design, empire: Empire): number {
    let n = 0;
    for (const bo of empire.builtObjects) if (bo !== null && bo.design === design) n++;
    for (const bo of empire.privateBuiltObjects) if (bo !== null && bo.design === design) n++;
    return n;
}

export interface DesignRow {
    design: Design;
    name: string;
    role: string;
    subRole: string;
    cost: number;
    maintenance: number;
    dateCreated: string;
    size: number;
    amount: number;
    upgrade: string;
    retrofit: string;
    retrofitLocked: boolean;
    optimized: string;
    obsolete: string;
    manual: boolean;
}

// Port of DistantWorlds.Controls DesignListView.cs:301 BindData (one row).
export function designRow(design: Design, player: Empire, galaxy: Galaxy): DesignRow {
    const owner = (design.empire as Empire | null) ?? player;
    return {
        design,
        name: design.name,
        role: roleDescription(design.role),
        subRole: resolveSubRoleDescription(design.subRole),
        cost: design.calculateCurrentPurchasePrice(galaxy),
        maintenance: designCalculateMaintenanceCosts(galaxy, design, owner),
        dateCreated: designDateCreatedText(design.dateCreated),
        size: design.size,
        amount: designAmount(design, owner),
        upgrade: checkDesignSubRoleShouldBeUpgraded(player, design.subRole) ? 'Automatic' : 'Manual',
        retrofit: design.allowAutoRetrofit ? 'Automatic' : 'Manual',
        retrofitLocked: isPrivateDesignSubRole(design.subRole),
        optimized: design.optimizedDesign > 0 ? 'Yes' : 'No',
        obsolete: design.isObsolete ? 'Obsolete' : 'Not obsolete',
        manual: design.isManuallyCreated,
    };
}

function num(v: number): string {
    return String(Math.round(v));
}

// Detail labels: DesignDefense.cs:95-168, DesignMovement.cs:117-203, DesignEnergy.cs:88-138,
// DesignIndustry.cs:90-167.
export function designStatRows(design: Design): { label: string; value: string }[] {
    const rows: { label: string; value: string }[] = [];
    rows.push({ label: 'Size', value: num(design.size) });
    rows.push({ label: 'Firepower', value: num(design.firepower) });
    rows.push({ label: 'Shields', value: num(design.shieldsCapacity) });
    rows.push({ label: 'Shield Recharge Rate', value: num(design.shieldRechargeRate) });
    rows.push({ label: 'Armor', value: num(design.armor) });
    rows.push({ label: 'Reactive Armor Strength', value: num(design.armorReactive) });
    if (design.topSpeed <= 0) {
        rows.push({ label: 'Movement', value: '(No movement)' });
    } else {
        rows.push({ label: 'Cruise', value: num(design.cruiseSpeed) });
        rows.push({ label: 'Sprint', value: num(design.topSpeed) });
        rows.push({ label: 'Hyper', value: num(design.warpSpeed) });
        const range = design.maximumRange();
        if (Number.isFinite(range)) rows.push({ label: 'Range', value: formatMoney(range) });
    }
    rows.push({ label: 'Reactor Power Output', value: num(design.reactorPowerOutput) });
    rows.push({ label: 'Static Energy Usage', value: num(design.staticEnergyConsumption) });
    rows.push({ label: 'Fuel Capacity', value: num(design.fuelCapacity) });
    rows.push({ label: 'Energy Storage', value: num(design.reactorStorageCapacity) });
    rows.push({ label: 'Cargo Capacity', value: design.cargoCapacity === 0 ? '(None)' : num(design.cargoCapacity) });
    if (design.troopCapacity > 0) rows.push({ label: 'Troop Capacity', value: num(design.troopCapacity) });
    if (design.fighterCapacity > 0) rows.push({ label: 'Fighter Capacity', value: num(design.fighterCapacity) });
    if (design.constructionYardCount > 0) rows.push({ label: 'Construction', value: num(design.constructionYardCount) });
    return rows;
}

/** The design's components grouped by name, in first-seen order. */
export function componentSummary(design: Design): { name: string; count: number }[] {
    const out: { name: string; count: number }[] = [];
    const byName = new Map<string, { name: string; count: number }>();
    for (const c of design.components) {
        const entry = byName.get(c.name);
        if (entry) {
            entry.count++;
        } else {
            const e = { name: c.name, count: 1 };
            byName.set(c.name, e);
            out.push(e);
        }
    }
    return out;
}

// Main.Part8.cs:1091 ctlDesignsList_CellClick, "Obsolete" column.
export function toggleDesignObsolete(design: Design): void {
    design.isObsolete = !design.isObsolete;
}

// Main.Part8.cs:1082 ctlDesignsList_CellClick, "AutoRetrofit" column.
export function toggleDesignAutoRetrofit(design: Design, empire: Empire): boolean {
    if (isPrivateDesignSubRole(design.subRole)) return false;
    design.allowAutoRetrofit = !design.allowAutoRetrofit;
    const apply = (list: BuiltObject[]): void => {
        for (const bo of list) {
            if (bo !== null && bo.design === design) bo.suppressAutoRetrofit = !design.allowAutoRetrofit;
        }
    };
    apply(empire.builtObjects);
    apply(empire.privateBuiltObjects);
    return true;
}

// ---- DOM ----

export interface ShipDesignsOptions {
    /** The player's empire. */
    empire: Empire;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;
// Kept across open/close, like the original's combos.
let filterIndex: DesignFilter = DesignFilter.LatestBuildable;
let typeFilterIndex: DesignTypeFilter = DesignTypeFilter.All;

const MANUAL_COLOR = rgbCss((255 << 16) | (102 << 8) | 0);
const LOCKED_COLOR = rgbCss((96 << 16) | (96 << 8) | 96);
const MANUAL_TOOLTIP = 'This design is manually created';
const LOCKED_TOOLTIP = 'Private design - cannot manually retrofit';
const HEADERS = ['Name', 'Role', 'Sub-role', 'Cost', 'Maint', 'Date Created', 'Size', 'Amount', 'Upgrade', 'Retrofit', 'Optimized', 'Obsolete'] as const;
const NUMBER_COLUMNS = new Set(['Cost', 'Maint', 'Size', 'Amount']);

/** Open the Designs panel, or close it if it is already open. */
export function toggleShipDesigns(opts: ShipDesignsOptions): void {
    if (open) {
        open.close();
    } else {
        open = createShipDesigns(opts);
    }
}

/** Close the Designs panel (no-op when closed). */
export function closeShipDesigns(): void {
    open?.close();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function createShipDesigns(opts: ShipDesignsOptions): OpenState {
    const player = opts.empire;
    const galaxy = opts.empire.galaxy as Galaxy;
    let selected: Design | null = null;

    const root = el('div', 'ship-designs-wrap');
    const win = el('div', 'ship-designs-window');

    const titlebar = el('div', 'ship-designs-titlebar');
    const heading = el('div', 'ship-designs-heading');
    titlebar.appendChild(heading);
    const closeBtn = el('button', 'ship-designs-close', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    // Toolbar: the two filter combos (Main.Part8.cs:1006-1028).
    const toolbar = el('div', 'ship-designs-toolbar');
    const makeSelect = (labels: readonly string[], value: number, onChange: (v: number) => void): HTMLSelectElement => {
        const sel = el('select', 'ship-designs-select');
        labels.forEach((text, i) => {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = text;
            sel.appendChild(o);
        });
        sel.value = String(value);
        sel.addEventListener('change', () => {
            onChange(Number(sel.value));
            render();
        });
        return sel;
    };
    toolbar.append(
        makeSelect(DESIGN_FILTER_LABELS, filterIndex, (v) => { filterIndex = v as DesignFilter; }),
        makeSelect(DESIGN_TYPE_FILTER_LABELS, typeFilterIndex, (v) => { typeFilterIndex = v as DesignTypeFilter; }),
    );
    win.appendChild(toolbar);

    const body = el('div', 'ship-designs-body');
    const listPane = el('div', 'ship-designs-pane ship-designs-list');
    const detailPane = el('div', 'ship-designs-pane ship-designs-detail');
    body.append(listPane, detailPane);
    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    function render(): void {
        const designs = filterDesigns(player, filterIndex, typeFilterIndex);
        heading.textContent = `Designs (${designs.length})`;
        if (selected === null || !designs.includes(selected)) selected = designs[0] ?? null;

        listPane.replaceChildren();
        if (designs.length === 0) {
            listPane.appendChild(el('div', 'ship-designs-empty', 'No designs'));
        } else {
            const table = el('table', 'ship-designs-table');
            const thead = el('thead', '');
            const hr = el('tr', 'ship-designs-header');
            for (const h of HEADERS) {
                const th = el('th', NUMBER_COLUMNS.has(h) ? 'ship-designs-header-cell ship-designs-number' : 'ship-designs-header-cell', h);
                hr.appendChild(th);
            }
            thead.appendChild(hr);
            table.appendChild(thead);
            const tbody = el('tbody', '');
            for (const design of designs) {
                const row = designRow(design, player, galaxy);
                const tr = el('tr', design === selected ? 'ship-designs-row ship-designs-row-selected' : 'ship-designs-row');
                if (row.manual) {
                    tr.style.color = MANUAL_COLOR;
                    tr.title = MANUAL_TOOLTIP;
                }
                const cells: [string, boolean][] = [
                    [row.name, false], [row.role, false], [row.subRole, false],
                    [formatMoney(row.cost), true], [formatMoney(row.maintenance), true], [row.dateCreated, false],
                    [String(row.size), true], [String(row.amount), true], [row.upgrade, false],
                    [row.retrofit, false], [row.optimized, false], [row.obsolete, false],
                ];
                cells.forEach(([text, isNum], i) => {
                    let cls = isNum ? 'ship-designs-cell ship-designs-number' : 'ship-designs-cell';
                    if (i === 0) cls += ' ship-designs-name';
                    const td = el('td', cls, text);
                    if (i === 9 && row.retrofitLocked) {
                        td.style.color = LOCKED_COLOR;
                        td.title = LOCKED_TOOLTIP;
                    }
                    tr.appendChild(td);
                });
                tr.addEventListener('click', () => {
                    selected = design;
                    render();
                });
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            listPane.appendChild(table);
        }
        renderDetail();
    }

    function renderDetail(): void {
        detailPane.replaceChildren();
        const design = selected;
        if (design === null) return;
        detailPane.appendChild(el('div', 'ship-designs-detail-name', design.name));
        detailPane.appendChild(
            el('div', 'ship-designs-detail-role', `${resolveSubRoleDescription(design.subRole)} · ${roleDescription(design.role)}`),
        );

        const stats = el('div', 'ship-designs-stats');
        for (const { label, value } of designStatRows(design)) {
            stats.append(el('span', 'ship-designs-stat-label', label), el('span', 'ship-designs-stat-value', value));
        }
        detailPane.appendChild(stats);

        detailPane.appendChild(el('div', 'ship-designs-section', 'Components'));
        const comps = el('div', 'ship-designs-components');
        for (const { name, count } of componentSummary(design)) {
            comps.appendChild(el('div', 'ship-designs-component', `${count} × ${name}`));
        }
        detailPane.appendChild(comps);

        const buttons = el('div', 'ship-designs-buttons');
        const obsoleteBtn = el('button', 'ship-designs-button', design.isObsolete ? 'Mark Not Obsolete' : 'Mark Obsolete');
        obsoleteBtn.type = 'button';
        obsoleteBtn.addEventListener('click', () => {
            toggleDesignObsolete(design);
            render();
        });
        const retrofitBtn = el('button', 'ship-designs-button', design.allowAutoRetrofit ? 'Retrofit: Automatic' : 'Retrofit: Manual');
        retrofitBtn.type = 'button';
        if (isPrivateDesignSubRole(design.subRole)) {
            retrofitBtn.disabled = true;
            retrofitBtn.title = LOCKED_TOOLTIP;
        }
        retrofitBtn.addEventListener('click', () => {
            if (toggleDesignAutoRetrofit(design, (design.empire as Empire | null) ?? player)) render();
        });
        buttons.append(obsoleteBtn, retrofitBtn);
        detailPane.appendChild(buttons);
    }

    render();

    function close(): void {
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu Escape handler from firing too.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    return { root, close };
}
