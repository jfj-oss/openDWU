// Designs screen (F8 / the top bar's tbtnDesigns): a port of the original pnlDesigns ScreenPanel on the shared
// original-style window (../originalWindow.ts).
// Sources:
// - DistantWorlds/Main.Part8.cs:980 method_307 (window 980 × 690: the filter combos at (10, 18) / (190, 18), the
//   maximum-size label (370, 15), Load / Save (635, 10) / (800, 10), the upgrade-roles explanation (10, 60), Show Empire
//   Policy (635, 62), the design list (10, 122) 945 × 450 with its column widths, and the six buttons along y 580);
// - Main.Part8.cs:697 method_303 / :753 method_304 / :835 method_306 (filters), :808 method_305 (maximum size label),
//   :1081 ctlDesignsList_CellClick (the Obsolete / Upgrade / Retrofit cells toggle), :926 btnDesignsUpgradeManual_Click;
//   Main.Part6.cs:1047 btnDesignsAddNew_Click, :1060 btnDesignsCopyAsNew_Click, :1114 btnDesignsDelete_Click;
//   Main.Part7.cs:4840 btnDesignsEdit_Click; Main.Part12.cs:4453 GenerateAutomationMessageBox;
// - DistantWorlds.Controls/Controls/DesignListView.cs (columns, BindData: the manual-design colour, the private-design
//   retrofit cell, the red obsolete cross, multi-select).
// The design editor (pnlDesignDetail) is designEditor.ts. Every change goes through a player command or the editor.
// Our additions (kept from the streamlined screen): the selected design's summary on the right (picture, the stat rows,
// its components) — the original window has no detail pane; double-click a row to edit it.
// - "Auto Upgrade Selected Designs": BaconMain.cs:2471 btnDesignsUpgrade_Click (player/designTools.ts
//   autoUpgradeDesigns, the autoUpgradeDesigns command);
// - Load Designs... / Save Selected Designs...: Main.Part4.cs:1682 mgohAuJwBE / :1598 btnDesignsSave_Click. The
//   original's Open / Save file dialogs are a file input and a download here (player/designTools.ts has the file
//   format; loading is the loadDesignFile command).
// TODO(port): the empire-colour tint of the list's ship pictures (DesignListView.PrepareBuiltObjectImage).

import './designsScreen.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
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
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { PendingValues } from '../pendingCommands';
import { formatMoney } from '../hud';
import { resolveGameText } from '../../sim/textResolver';
import {
    deleteDesignQuestion,
    designAutomationPromptApplies,
    isDesignInUse,
    newDesignDraft,
    type DesignDraftSource,
} from '../../sim/player/designEditor';
import { openDesignEditor, type DesignEditorHandle } from './designEditor';
import { DESIGN_FILE_EXTENSION, writeDesignFile } from '../../sim/player/designTools';
import { isPrivateDesignSubRole, toggleDesignObsolete, toggleDesignAutoRetrofit } from '../../sim/player/playerOrders';
import { builtObjectImageUrl, resolveDrawPictureRef } from '../../render/builtObjectLayer';
import { empireFlagUrl } from '../selectionInfoView';
import { toggleEmpirePolicy } from './empirePolicy';
import {
    COLORS,
    FONT,
    OwGrid,
    darkRect,
    dropDown,
    dropText,
    el,
    glassButton,
    messageBox,
    openOriginalWindow,
    place,
    scrollPanel,
    setText,
    text,
    type OriginalWindow,
} from '../originalWindow';
import { componentImageUrl, gt, maximumSizeText } from './designPanelsModel';
import { requestSimRefresh } from '../../simworker/refresh';
export { isPrivateDesignSubRole, toggleDesignObsolete, toggleDesignAutoRetrofit };

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
    // Main.Part9.cs 5081: lblDesignWeaponFirepowerValue.Text = design_0.FirepowerRaw (Design._Firepower is never assigned).
    rows.push({ label: 'Firepower', value: num(design.firepowerRaw) });
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


// ---------------------------------------------------------------------------------------------------------------------
// DOM (pnlDesigns)
// ---------------------------------------------------------------------------------------------------------------------

export interface ShipDesignsOptions {
    /** The player's empire. */
    empire: Empire;
}

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;
// Kept across open/close, like the original's combos (filled once, cmbDesignsFilter.SelectedIndex = 1).
let filterIndex: DesignFilter = DesignFilter.LatestBuildable;
let typeFilterIndex: DesignTypeFilter = DesignTypeFilter.All;

/** pnlDesigns.Size (Main.Part8.cs:988). */
export const DESIGNS_WINDOW = { w: 980, h: 690 } as const;
/** Our detail pane right of the list (not in the original): its width, added to the window. */
export const DESIGNS_DETAIL_WIDTH = 262;

const MANUAL_TOOLTIP = 'This design is manually created';
const LOCKED_TOOLTIP = 'Private design - cannot manually retrofit';

/** Open the Designs window, or close it if it is already open (Main.Part9.cs:4339 tbtnDesigns_Click). */
export function toggleShipDesigns(opts: ShipDesignsOptions): void {
    if (open) open.close();
    else open = createShipDesigns(opts);
}

/** Close the Designs window (no-op when closed). */
export function closeShipDesigns(): void {
    open?.close();
}

export function isShipDesignsOpen(): boolean {
    return open !== null;
}

/** A design's picture (BuiltObjectImageCache.GetImagesSmall()[PictureRef]). */
export function designPictureUrl(design: Pick<Design, 'pictureRef' | 'subRole' | 'isPlanetDestroyer'>): string | null {
    return builtObjectImageUrl(resolveDrawPictureRef({ pictureRef: design.pictureRef, isPlanetDestroyer: design.isPlanetDestroyer, subRole: design.subRole, builtObjectID: 0 }));
}

/** A ship picture turned like RotateFlip(Rotate270FlipNone) and zoomed into its box. */
export function shipPicture(url: string | null, className = ''): HTMLDivElement {
    const box = el('div', `dsg-ship${className ? ` ${className}` : ''}`);
    if (url !== null) {
        const img = el('img');
        img.src = url;
        img.alt = '';
        img.draggable = false;
        box.appendChild(img);
    }
    return box;
}

/** DesignListView.GenerateObsoleteImage: a red 16 × 16 cross with a bar (pen 2, round caps). */
function obsoleteIcon(): HTMLElement {
    const s = el('span', 'dsg-obsolete-icon');
    s.innerHTML =
        '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 2 L11 14 M11 2 L4 14 M1 8 L14 8"/></svg>';
    return s;
}

/**
 * Main.Part12.cs:4453 GenerateAutomationMessageBox("Ship Design"): when the empire automates ship design, ask whether
 * to turn it off ("Off" sets ControlDesigns = false). Resolves once answered.
 */
export async function askDesignAutomation(galaxy: Galaxy, empire: Empire): Promise<void> {
    const task = gt('Ship Design');
    const off = gt('Turn off automation');
    const r = await messageBox({
        caption: gt('Turn Off TASKNAME Automation?', task),
        text: gt('Would you like to turn off automation', task),
        buttons: [gt('Leave automation on'), off],
        icon: 'question',
        width: 520,
        buttonWidth: 190,
    });
    if (r === off) issuePlayerCommand(galaxy, empire, 'setEmpireControl', ['controlDesigns', false]);
}

function createShipDesigns(opts: ShipDesignsOptions): OpenState {
    const player = opts.empire;
    const galaxy = player.galaxy as Galaxy;
    let editor: DesignEditorHandle | null = null;
    let busy = false; // a message box is up
    const flagUrls = new Map<Empire, string>();

    const win = openOriginalWindow({
        id: 'designs',
        title: gt('Designs'),
        icon: 'designs.png',
        width: DESIGNS_WINDOW.w + DESIGNS_DETAIL_WIDTH,
        height: DESIGNS_WINDOW.h,
        onClose: () => {
            editor?.close();
            window.clearInterval(timer);
            open = null;
        },
    });
    const body = win.body;

    // cmbDesignsFilter / cmbDesignsFilterTypes (Main.Part8.cs:997-1028).
    body.appendChild(place(dropDown(DESIGN_FILTER_LABELS.map((l, i) => ({ value: String(i), label: gt(l) })), String(filterIndex), (v) => {
        filterIndex = Number(v) as DesignFilter;
        refreshList();
    }), 10, 18, 165, 21));
    body.appendChild(place(dropDown(DESIGN_TYPE_FILTER_LABELS.map((l, i) => ({ value: String(i), label: gt(l) })), String(typeFilterIndex), (v) => {
        typeFilterIndex = Number(v) as DesignTypeFilter;
        refreshList();
    }), 190, 18, 165, 21));
    // lblDesignsMaximumSize (method_305).
    const maxSize = dropText(body, maximumSizeText(player), 370, 15, { color: COLORS.text });
    // btnDesignsLoad / btnDesignsSave.
    body.appendChild(place(glassButton(gt('Load Designs...'), { onClick: () => loadDesigns() }), 635, 10, 155, 40));
    body.appendChild(place(glassButton(`${gt('Save Selected Designs')}...`, { onClick: () => void saveSelected() }), 800, 10, 155, 40));
    // lblDesignsUpgradeRolesExplanation (10, 60) 615 × 45, MiddleLeft, font_3.
    const explanation = el('div', 'dsg-explanation');
    explanation.appendChild(text(gt('Designs Upgrade Roles Explanation'), { size: FONT.normal, wrapWidth: 615, color: COLORS.text }));
    body.appendChild(place(explanation, 10, 60, 615, 45));
    // btnDesignsShowEmpirePolicy → method_595.
    body.appendChild(place(glassButton(gt('Show Empire Policy'), { onClick: () => toggleEmpirePolicy({ empire: player }) }), 635, 62, 320, 40));

    // ctlDesignsList (10, 122) 945 × 450 with method_307's column widths (Name takes what the scrollbar leaves).
    // The Upgrade toggle per sub-role as last sent, until its reply lands (pendingCommands.ts).
    const pendingUpgrade = new PendingValues<number, boolean>();
    const upgradeShown = (subRole: number): boolean => pendingUpgrade.value(subRole, checkDesignSubRoleShouldBeUpgraded(player, subRole));
    const grid = new OwGrid<DesignRow>({
        key: (r) => r.design,
        multiSelect: true,
        rowClass: (r) => (r.manual ? 'dsg-manual' : ''),
        onSelect: () => renderDetail(),
        onDoubleClick: (r) => void startEditor({ kind: 'edit', design: r.design }),
        empty: '',
        columns: [
            {
                id: 'EmpirePicture', header: '', width: 22,
                sort: (r) => (r.design.empire as Empire | null)?.name ?? '',
                render: (r, cell) => {
                    const owner = (r.design.empire as Empire | null) ?? player;
                    const img = el('img', 'dsg-flag');
                    img.alt = '';
                    const known = flagUrls.get(owner);
                    if (known) img.src = known;
                    else void empireFlagUrl(galaxy, owner).then((u) => { flagUrls.set(owner, u); img.src = u; });
                    cell.title = owner.name;
                    cell.appendChild(img);
                },
            },
            { id: 'Picture', header: '', width: 30, render: (r, cell) => cell.appendChild(shipPicture(designPictureUrl(r.design), 'dsg-ship-row')) },
            { id: 'Name', header: gt('Name'), sort: (r) => r.name, render: (r, cell) => tip(cell, r, r.name) },
            { id: 'Role', header: gt('Role'), width: 80, sort: (r) => r.role, render: (r, cell) => tip(cell, r, r.role) },
            { id: 'SubRole', header: gt('SubRole'), width: 140, sort: (r) => r.subRole, render: (r, cell) => tip(cell, r, r.subRole) },
            { id: 'Cost', header: gt('Cost'), width: 50, align: 'right', sort: (r) => r.cost, render: (r, cell) => tip(cell, r, String(Math.round(r.cost))) },
            { id: 'Maintenance', header: gt('Maintenance Abbreviation'), width: 50, align: 'right', sort: (r) => r.maintenance, render: (r, cell) => tip(cell, r, String(Math.round(r.maintenance))) },
            { id: 'DateCreated', header: gt('Date Created'), width: 80, sort: (r) => r.design.dateCreated, render: (r, cell) => tip(cell, r, r.dateCreated) },
            { id: 'Size', header: gt('Size'), width: 45, align: 'right', sort: (r) => r.size, render: (r, cell) => tip(cell, r, String(r.size)) },
            { id: 'BuildCount', header: gt('Amount'), width: 55, align: 'right', sort: (r) => r.amount, render: (r, cell) => tip(cell, r, String(r.amount)) },
            {
                id: 'Upgrade', header: gt('Upgrade'), width: 65, align: 'center', sort: (r) => r.upgrade,
                render: (r, cell) => tip(cell, r, gt(r.upgrade)),
                onClick: (r) => {
                    // ctlDesignsList_CellClick "Upgrade": SetDesignSubRoleShouldBeUpgraded(SubRole, !current) — current as
                    // last sent while its reply is on the way (a quick second click turns it back).
                    const now = upgradeShown(r.design.subRole);
                    const settle = pendingUpgrade.send(r.design.subRole, !now);
                    issuePlayerCommand(galaxy, player, 'setDesignSubRoleUpgrade', [r.design.subRole, !now], () => {
                        settle();
                        refreshList();
                    });
                },
            },
            {
                id: 'AutoRetrofit', header: gt('Retrofit'), width: 65, align: 'center', sort: (r) => r.retrofit,
                render: (r, cell) => {
                    if (r.retrofitLocked) {
                        cell.classList.add('dsg-locked');
                        cell.title = gt(LOCKED_TOOLTIP);
                    }
                    tip(cell, r, gt(r.retrofit));
                },
                onClick: (r) => {
                    // "AutoRetrofit": not for the six private sub-roles.
                    if (r.retrofitLocked) return;
                    const owner = (r.design.empire as Empire | null) ?? player;
                    issuePlayerCommand(galaxy, owner, 'toggleDesignAutoRetrofit', [r.design], () => refreshList());
                },
            },
            {
                id: 'Optimized', header: gt('Optimized'), width: 70, align: 'center', sort: (r) => r.optimized,
                render: (r, cell) => {
                    if (r.optimized === 'Yes') cell.title = gt('This is an optimized design');
                    tip(cell, r, gt(r.optimized));
                },
            },
            {
                id: 'Obsolete', header: gt('Obsolete'), width: 40, align: 'center', sort: (r) => r.obsolete,
                render: (r, cell) => {
                    cell.title = gt(r.obsolete);
                    if (r.design.isObsolete) cell.appendChild(obsoleteIcon());
                },
                onClick: (r) => {
                    // "Obsolete": design.IsObsolete = !design.IsObsolete.
                    issuePlayerCommand(galaxy, player, 'toggleDesignObsolete', [r.design], () => refreshList());
                },
            },
        ],
    });
    grid.el.classList.add('dsg-list');
    body.appendChild(place(grid.el, 10, 122, 945, 450));

    /** DesignListView: a manually created design's cells are (255, 102, 0) with "This design is manually created". */
    function tip(cell: HTMLDivElement, r: DesignRow, value: string): void {
        cell.textContent = value;
        if (r.manual && cell.title === '') cell.title = gt(MANUAL_TOOLTIP);
    }

    // The buttons along y 580 (method_307).
    const single = (): Design | null => {
        const sel = grid.selectedAll;
        return sel.length === 1 ? sel[0].design : (grid.selected?.design ?? null);
    };
    const editBtn = glassButton(gt('Edit'), { onClick: () => { const d = single(); if (d) void startEditor({ kind: 'edit', design: d }); } });
    const addBtn = glassButton(gt('Add New'), { onClick: () => void startEditor({ kind: 'blank' }) });
    const copyBtn = glassButton(gt('Copy As New'), { onClick: () => { const d = single(); if (d) void startEditor({ kind: 'copy', design: d }); } });
    const upgradeManualBtn = glassButton(gt('Manually Upgrade Design'), {
        onClick: () => {
            // btnDesignsUpgradeManual_Click: exactly one selected row.
            const sel = grid.selectedAll;
            if (sel.length === 1) void startEditor({ kind: 'upgrade', design: sel[0].design });
        },
    });
    const autoUpgradeBtn = glassButton(gt('Auto Upgrade Selected Designs'), { onClick: () => void autoUpgradeSelected() });
    const deleteBtn = glassButton(gt('Delete Selected Designs'), { onClick: () => void deleteSelected() });
    body.append(
        place(editBtn, 10, 580, 128, 40),
        place(addBtn, 148, 580, 128, 40),
        place(copyBtn, 286, 580, 128, 40),
        place(upgradeManualBtn, 424, 580, 170, 40),
        place(autoUpgradeBtn, 604, 580, 170, 40),
        place(deleteBtn, 784, 580, 171, 40),
    );

    // Our detail pane (not in the original): the selected design at a glance.
    const detail = darkRect();
    detail.classList.add('dsg-detail');
    body.appendChild(place(detail, DESIGNS_WINDOW.w - 16 + 4, 10, DESIGNS_DETAIL_WIDTH - 14, 610));
    const detailName = dropText(detail, '', 8, 6, { size: FONT.large, bold: true, color: '#fff' });
    detailName.classList.add('dsg-detail-name');
    const detailRole = dropText(detail, '', 8, 28, { size: FONT.small, color: COLORS.label });
    const detailPic = place(shipPicture(null, 'dsg-detail-pic'), 8, 50, DESIGNS_DETAIL_WIDTH - 30, 96);
    detail.appendChild(detailPic);
    const detailStats = place(el('div', 'dsg-detail-stats'), 8, 152, DESIGNS_DETAIL_WIDTH - 30, 238);
    detail.appendChild(detailStats);
    dropText(detail, gt('Components'), 8, 394, { size: FONT.normal, bold: true, color: '#fff' });
    const detailComps = place(scrollPanel('dsg-detail-comps'), 8, 414, DESIGNS_DETAIL_WIDTH - 30, 188);
    detail.appendChild(detailComps);

    function renderDetail(): void {
        const sel = grid.selectedAll;
        const design = sel.length === 1 ? sel[0].design : grid.selected?.design ?? null;
        const enable = (b: HTMLButtonElement, on: boolean): void => { b.disabled = !on; };
        enable(editBtn, design !== null);
        enable(copyBtn, design !== null);
        enable(upgradeManualBtn, sel.length === 1);
        enable(deleteBtn, sel.length > 0);
        enable(autoUpgradeBtn, sel.length > 0);
        if (design === null) {
            setText(detailName, sel.length > 1 ? `${sel.length} ${gt('Designs')}` : '');
            setText(detailRole, '');
            detailPic.replaceChildren();
            detailStats.replaceChildren();
            detailComps.replaceChildren();
            return;
        }
        setText(detailName, design.name);
        setText(detailRole, `${resolveSubRoleDescription(design.subRole)} · ${roleDescription(design.role)}`);
        const url = designPictureUrl(design);
        const img = detailPic.querySelector('img');
        if (url === null) detailPic.replaceChildren();
        else if (img === null || img.getAttribute('src') !== url) detailPic.replaceChildren(...shipPicture(url).childNodes);
        detailStats.replaceChildren();
        for (const { label, value } of designStatRows(design)) {
            const row = el('div', 'dsg-detail-row');
            row.append(el('span', 'dsg-detail-label', gt(label)), el('span', 'dsg-detail-value', value));
            detailStats.appendChild(row);
        }
        detailComps.replaceChildren();
        const pics = new Map<string, number>();
        for (const c of design.components) if (!pics.has(c.name)) pics.set(c.name, c.pictureRef);
        for (const { name, count } of componentSummary(design)) {
            const row = el('div', 'dsg-detail-comp');
            const ic = el('img');
            ic.src = componentImageUrl(pics.get(name) ?? 0);
            ic.alt = '';
            row.append(ic, el('span', 'dsg-detail-count', `${count}×`), el('span', 'dsg-detail-cname', name));
            detailComps.appendChild(row);
        }
    }

    function refreshList(selectDesign: Design | null = null): void {
        const designs = filterDesigns(player, filterIndex, typeFilterIndex);
        const prev = selectDesign ?? grid.selected?.design ?? null;
        grid.setRows(designs.map((d) => {
            const row = designRow(d, player, galaxy);
            if (pendingUpgrade.has(d.subRole)) row.upgrade = upgradeShown(d.subRole) ? 'Automatic' : 'Manual';
            return row;
        }));
        // The grid keeps its (multi-)selection by key across re-binds; select only a new design or when none is left.
        if (selectDesign !== null && designs.includes(selectDesign)) grid.select(selectDesign, true);
        else if (designs.length > 0 && (prev === null || !designs.includes(prev))) grid.select(designs[0], false);
        setText(maxSize, maximumSizeText(player));
        renderDetail();
    }

    // Edit / Add New / Copy As New / Manually Upgrade: the automation question first, then the editor.
    async function startEditor(source: DesignDraftSource): Promise<void> {
        if (editor !== null || busy) return;
        busy = true;
        try {
            if (designAutomationPromptApplies(player, source.kind, source.kind === 'blank' ? null : source.design)) await askDesignAutomation(galaxy, player);
        } finally {
            busy = false;
        }
        if (win.closed || editor !== null) return;
        const draft = newDesignDraft(galaxy, player, source);
        editor = openDesignEditor({
            galaxy,
            empire: player,
            draft,
            sourceKind: source.kind,
            sourceDesign: source.kind === 'blank' ? null : source.design,
            onClose: (saved) => {
                editor = null;
                if (!win.closed) refreshList(saved);
            },
        });
    }

    // btnDesignsDelete_Click: automation question, the in-use check (one design), "Are you sure…", then delete.
    async function deleteSelected(): Promise<void> {
        if (busy || editor !== null) return;
        const designs = grid.selectedAll.map((r) => r.design);
        if (designs.length === 0) return;
        busy = true;
        try {
            if (designAutomationPromptApplies(player, 'delete', null)) await askDesignAutomation(galaxy, player);
            if (designs.length === 1 && isDesignInUse(player, designs[0])) {
                await messageBox({ caption: gt('Cannot Delete Design'), text: gt('This design is in use and cannot be deleted'), icon: 'stop' });
                return;
            }
            const q = deleteDesignQuestion(designs.length);
            const yes = gt('Yes');
            const r = await messageBox({ caption: resolveGameText(q.title), text: resolveGameText(q.message), buttons: [yes, gt('No')], icon: 'question' });
            if (r !== yes || win.closed) return;
            issuePlayerCommand(galaxy, player, 'deleteDesign', [designs], (res) => {
                if (!win.closed) refreshList();
                if (res.message !== undefined) {
                    void messageBox({ caption: resolveGameText(res.title ?? ''), text: resolveGameText(res.message), icon: 'warning' });
                }
            });
        } finally {
            busy = false;
        }
    }

    // BaconMain.cs:2471 btnDesignsUpgrade_Click: the automation question whenever ControlDesigns is on, then upgrade the
    // selection; one selected design → the new design is selected.
    async function autoUpgradeSelected(): Promise<void> {
        if (busy || editor !== null) return;
        busy = true;
        try {
            if (player.controlDesigns) await askDesignAutomation(galaxy, player);
            if (win.closed) return;
            const designs = grid.selectedAll.map((r) => r.design);
            if (designs.length <= 0) return;
            issuePlayerCommand(galaxy, player, 'autoUpgradeDesigns', [designs], (res) => {
                if (!win.closed) refreshList(res.select);
            });
        } finally {
            busy = false;
        }
    }

    // btnDesignsSave_Click: "No designs have been selected", else the selected designs as a file (a download here).
    async function saveSelected(): Promise<void> {
        if (busy) return;
        const designs = grid.selectedAll.map((r) => r.design);
        if (designs.length <= 0) {
            busy = true;
            try {
                await messageBox({ caption: gt('No designs to save'), text: gt('No designs have been selected'), icon: 'information' });
            } finally {
                busy = false;
            }
            return;
        }
        const blob = new Blob([writeDesignFile(designs)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a');
        a.href = url;
        a.download = `${designs.length === 1 ? designs[0].name.replace(/[\\/:*?"<>|]+/g, '_') || 'designs' : 'designs'}${DESIGN_FILE_EXTENSION}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // mgohAuJwBE (Load Designs...): pick a file (a file input here), then load it through the command log.
    function loadDesigns(): void {
        if (busy || editor !== null) return;
        const input = el('input');
        input.type = 'file';
        input.accept = `${DESIGN_FILE_EXTENSION},.json,.dwd`;
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.remove();
            if (file === undefined) return;
            void file.text().then((textContent) => {
                if (win.closed) return;
                issuePlayerCommand(galaxy, player, 'loadDesignFile', [textContent], (res) => {
                    if (!win.closed) refreshList();
                    if (!res.ok && res.message !== undefined) {
                        void messageBox({ caption: resolveGameText(res.title ?? ''), text: resolveGameText(res.message), icon: 'warning' });
                    }
                });
            });
        });
        document.body.appendChild(input);
        input.click();
    }

    refreshList();
    // The list follows the sim (Amount, costs, automation upgrades) while open; a light re-bind keeps the selection.
    // Worker mode: bring what the screen shows up to date now instead of up to a cold cycle later (no-op in-thread).
    requestSimRefresh(galaxy, [player, player.designs], () => {
        if (!win.closed && editor === null && !busy) refreshList();
    });
    const timer = window.setInterval(() => {
        if (editor === null && !busy) refreshList();
    }, 2000);

    const state: OpenState = { win, close: () => win.close() };
    return state;
}
