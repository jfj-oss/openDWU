// Fleets screen: a port of the original's pnlShipGroupInfo (Main.Part9.cs method_268, opened by F12 or the top-bar
// fleets button, tbtnShipGroups_Click) on the shared original-style window (originalWindow.ts):
//   - the 988 × 768 ScreenPanel "Fleets" with the fleets.png header icon (Main.Part12.cs bitmap_147) and the
//     "Learn about Fleets..." link (lnkFleets, (10, 8));
//   - ctlShipGroupListView (ShipGroupListView.cs, (10, 27) 950 × 283): admirals & generals, Name, Ships, Power, Troops
//     ("0,K"), Home colony, Mission (Galaxy.ResolveDescription) and Current system, sortable; double click goes to the
//     fleet;
//   - the name box (txtShipGroupName, committed on leaving it), Select Fleet / Go to Fleet, the home colony combo with
//     Set Home Colony, Repair and Refuel / Retrofit to latest designs / Load Troops;
//   - pnlDetailInfoShipGroup: the InfoPanel (BaconInfoPanel.DrawShipGroup with ShowExtendedInfo): mission and queued
//     missions, empire, base, posture, summary, troops, boarding pods and the fleet's ships as pictures with their
//     damage tint and fuel bar (click a ship to select it);
//   - the ungarrisoned-troops report (method_269) and the troop loadout group (grpShipGroupUseTroopLoadouts: the four
//     percent spinners with their "= N units" targets, method_264 / method_265 / method_267);
//   - gmapShipGroupInfo: "Location of selected Fleet in Galaxy" (GalaxyMap.cs method_6 with ShowFleetPostures: the
//     sector grid, the posture ranges (red attack / blue defend), the systems, every fleet as a yellow dot and the
//     selected fleet's crosshair).
// Kept from our earlier screen (not in the original window; the original has them on the selection panel's fleet
// buttons, Main.Part3.cs fleetSlots), in the same look: a row of fleet orders under the window's controls (posture,
// engagement range, attack point, home base, automate, stop, disband), and the "Fleet Designs" tab
// (fleetDesignsTab.ts: fleet templates, form from existing, build fleet with a sector option and progress).
// Below the orders row, the fleet's template row (fleetRefillControls.ts: fleet design, "Auto-refill from template",
// the replacements' yard, Replenish and the status line; sim/player/fleetRefill.ts — a gameplay addition).
// The fleet cycle keys follow Main.Part8.cs:1243 btnCycleShipGroups_Click (fleetCycleList).
// The first column is ShipGroupListView.cs:170-182: the first admiral / general's very small picture
// (CharacterImageCache.ObtainCharacterImageVerySmall, characterPortrait.ts) and every name as the tooltip.
// TODO(port): the galaxy map's empire territory link lines (GalaxyMap.cs method_6 LinkSystemStars).

import './fleetsList.css';
import { CHARACTER_IMAGE_SPEC, characterPortrait } from '../characterPortrait';
import type { ShipGroup } from '../../sim/fleets/shipGroup';
import { empireShipGroups } from '../../sim/fleets/shipGroup';
import { FleetPosture } from '../../sim/diplomacyTick';
import { BuiltObjectMissionType } from '../../sim/missions/mission';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import { missionTypeLabel, missionTargetText } from '../hud';
import { ShipAction, ShipActionType } from '../../sim/player/shipAction';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { PendingValues } from '../pendingCommands';
import type { TroopLoadout } from '../../sim/player/fleetOps';
import type { Habitat } from '../../sim/types';
import { getFleetAdmiralsAndGenerals, shipGroupGetTroopLoadoutTargetAmounts, shipGroupTotalTroopCapacity } from '../../sim/fleets/shipGroupTasks';
import type { Troop } from '../../sim/cargo';
import { SystemVisibilityStatus } from '../../sim/visibility';
import { createFleetDesignsTab } from './fleetDesignsTab';
import { createFleetRefillControls } from '../fleetRefillControls';
import { troopCompositionDescription, troopCountsByType } from './troops';
import { openGalactopedia } from './galactopedia';
import { CROSSHAIR_COLOR, GRID_COLOR, drawMapTerritory, galaxyMapScale, sectorColumnLabel, starBrushColor, starDotSizes } from './galaxyMap';
import { drawGalaxyMapLayers } from './galaxyMapLayers';
import { fmtK, missionDescription, shipGroupInfo, type InfoTarget } from '../selectionInfo';
import { renderInfoModel } from '../selectionInfoView';
import {
    COLORS,
    FONT,
    OwGrid,
    chromeImageUrl,
    dropDown,
    dropText,
    el,
    glassButton,
    gradientPanel,
    linkLabel,
    openOriginalWindow,
    place,
    rgbCss,
    setButtonLabel,
    setButtonMinorText,
    setText,
    tabStrip,
    text,
    type GridColumn,
    type OriginalWindow,
} from '../originalWindow';
import { requestSimRefresh } from '../../simworker/refresh';

// -------------------------------------------------------------------------------------------------------------------
// Pure helpers (tested)
// -------------------------------------------------------------------------------------------------------------------

// Port of Galaxy.2.cs:2100 ResolveDescriptionFleetPosture (GameText.txt 3454-3465).
export function fleetPostureDescription(sg: ShipGroup | null): string {
    let result = '(None)';
    if (sg === null) return result;
    const range = sg.postureRangeSquared;
    switch (sg.posture) {
        case FleetPosture.Attack: {
            const p = sg.attackPoint;
            if (p === null) result = 'Attack any targets';
            else if (range <= 2250000.0) result = `Attack ${p.name} only`;
            else if (range <= 2304000000.0) result = `Attack ${p.name} and system`;
            else if (range <= 250000000000.0) result = `Attack ${p.name} and nearby systems`;
            else if (range <= 1000000000000.0) result = `Attack ${p.name} and sector`;
            else result = `Attack ${p.name}, then any target`;
            break;
        }
        case FleetPosture.Defend: {
            const p = sg.gatherPoint;
            if (p === null) result = 'Defend any targets';
            else if (range <= 2250000.0) result = `Defend ${p.name} only`;
            else if (range <= 2304000000.0) result = `Defend ${p.name} and system`;
            else if (range <= 250000000000.0) result = `Defend ${p.name} and nearby systems`;
            else if (range <= 1000000000000.0) result = `Defend ${p.name} and sector`;
            else result = `Defend any target, based at ${p.name}`;
            break;
        }
    }
    return result;
}

// Port of ShipGroup.cs TotalFirepower (sum of FirepowerRaw over the ships).
export function fleetTotalFirepower(sg: ShipGroup): number {
    let total = 0;
    for (const ship of sg.ships) {
        if (ship) total += ship.firepowerRaw;
    }
    return total;
}

/** The fleet's name, or '(Unnamed fleet)'. */
export function fleetName(sg: ShipGroup): string {
    return sg.name ? sg.name : '(Unnamed fleet)';
}

/** ShipGroupListView.cs:191 "Current system": the lead ship's nearest system
 * star, or '(Deep Space)'. The C# would crash on a null LeadShip; here it
 * falls back to '(Deep Space)'. */
export function fleetSystemName(sg: ShipGroup): string {
    return sg.leadShip?.nearestSystemStar?.name || '(Deep Space)';
}

/** The mission type label (the selection rows' short form; the grid uses the full Galaxy.ResolveDescription). */
export function fleetMissionText(sg: ShipGroup): string {
    return sg.mission === null || sg.mission.type === BuiltObjectMissionType.Undefined
        ? '(No mission)'
        : missionTypeLabel(sg.mission.type);
}

/** Main.Part8.cs:1243 btnCycleShipGroups_Click cycles PlayerEmpire.ShipGroups
 * in list order; null slots are skipped. */
export function fleetCycleList(empire: Empire): ShipGroup[] {
    return empireShipGroups(empire).filter((sg): sg is ShipGroup => sg !== null);
}

/** One displayed row of the grid (ShipGroupListView.cs BindData). Pure so the row logic is testable without a DOM. */
export interface FleetRow {
    shipGroup: ShipGroup;
    name: string;
    ships: number;
    power: number;
    troops: number;
    homeBase: string;
    mission: string;
    system: string;
}

// Port of ShipGroupListView.cs:183-191 (row cells 1-7; the Mission cell's full text comes from fleetMissionDescription).
export function fleetRows(empire: Empire): FleetRow[] {
    return fleetCycleList(empire).map((sg) => ({
        shipGroup: sg,
        name: fleetName(sg),
        ships: sg.ships.length,
        power: fleetTotalFirepower(sg),
        troops: Math.round(sg.totalTroopAttackStrength),
        homeBase: sg.gatherPoint?.name ?? '(None)',
        mission: fleetMissionText(sg),
        system: fleetSystemName(sg),
    }));
}

/** The grid's Mission cell: Galaxy.ResolveDescription(empire, mission) (type and target). */
export function fleetMissionDescription(sg: ShipGroup): string {
    return missionDescription(sg.mission, sg.empire);
}

/** The grid's columns (ShipGroupListView constructor; widths from Main.Part9.cs method_268). */
export const FLEET_GRID_COLUMNS: readonly { id: string; header: string; width: number; align: 'left' | 'center' | 'right' }[] = [
    { id: 'admirals', header: '', width: 30, align: 'center' },
    { id: 'name', header: 'Name', width: 170, align: 'left' },
    { id: 'ships', header: 'Ships', width: 50, align: 'center' },
    { id: 'power', header: 'Power', width: 60, align: 'right' },
    { id: 'troops', header: 'Troops', width: 60, align: 'right' },
    { id: 'home', header: 'Home colony', width: 140, align: 'left' },
    { id: 'mission', header: 'Mission', width: 300, align: 'left' },
    { id: 'system', header: 'Current system', width: 140, align: 'left' },
];

/** Rows for the bottom-left selection panel when a fleet is selected. */
export function shipGroupSelectionRows(sg: ShipGroup, player: Empire | null): { label: string; value: string }[] {
    const rows: { label: string; value: string }[] = [];
    rows.push({ label: 'Ships', value: String(sg.ships.length) });
    rows.push({ label: 'Posture', value: fleetPostureDescription(sg) });
    rows.push({ label: 'Mission', value: fleetMissionText(sg) });
    if (sg.mission !== null) {
        const target = missionTargetText(sg.mission, player);
        if (target) rows.push({ label: 'Target', value: target });
    }
    rows.push({ label: 'Power', value: String(fleetTotalFirepower(sg)) });
    const troops = Math.round(sg.totalTroopAttackStrength);
    if (troops > 0) rows.push({ label: 'Troops', value: String(troops) });
    rows.push({ label: 'Home base', value: sg.gatherPoint?.name ?? '(None)' });
    rows.push({ label: 'Lead ship', value: sg.leadShip?.name ?? '—' });
    rows.push({ label: 'Location', value: fleetSystemName(sg) });
    return rows;
}

/** The fleet's lead ship is automated (Main.Part3.cs fleetSlots: `lead.IsAutoControlled` picks Automate / Unautomate). */
export function fleetAutomated(sg: ShipGroup): boolean {
    return sg.leadShip?.isAutoControlled === true;
}

/** Galaxy.2.cs ResolveDescriptionFleetPosture range ladder (the thresholds SetFleetRange cycles through), as a label. */
export function fleetRangeLabel(rangeSquared: number): string {
    if (rangeSquared <= 2250000.0) return 'Point only';
    if (rangeSquared <= 2304000000.0) return 'Point and system';
    if (rangeSquared <= 250000000000.0) return 'Nearby systems';
    if (rangeSquared <= 1000000000000.0) return 'Sector';
    return 'Any target';
}

/** The chrome icon of a posture range step (images/ui/chrome/fleetRange*.png, the selection panel's range button). */
export function fleetRangeIcon(rangeSquared: number): string {
    if (rangeSquared <= 2250000.0) return 'fleetRangeTarget.png';
    if (rangeSquared <= 2304000000.0) return 'fleetRangeSystem.png';
    if (rangeSquared <= 250000000000.0) return 'fleetRangeArea.png';
    if (rangeSquared <= 1000000000000.0) return 'fleetRangeSector.png';
    return 'fleetRangeAny.png';
}

/** Posture as the toggle shows it (FleetPosture.Attack / Defend; Main.Part7.cs SetFleetPosture toggles between them). */
export function fleetPostureLabel(sg: ShipGroup): string {
    return sg.posture === FleetPosture.Attack ? 'Attack' : sg.posture === FleetPosture.Defend ? 'Defend' : '(None)';
}

/** Main.Part9.cs ctlShipGroupListView_SelectionChanged: the loadout spinners, null when all four bytes are 255 (off). */
export function fleetTroopLoadout(sg: ShipGroup): TroopLoadout | null {
    if (sg.troopLoadoutInfantry === 255 && sg.troopLoadoutArtillery === 255 && sg.troopLoadoutArmored === 255 && sg.troopLoadoutSpecialForces === 255) return null;
    return { infantry: sg.troopLoadoutInfantry, armored: sg.troopLoadoutArmored, artillery: sg.troopLoadoutArtillery, specialForces: sg.troopLoadoutSpecialForces };
}

/** Main.Part9.cs numShipGroupTroopLoadout*: each spinner's maximum is what is left of the 100 percent (method_265). */
export function troopLoadoutMaxima(l: TroopLoadout): TroopLoadout {
    const left = 100 - (l.infantry + l.armored + l.artillery + l.specialForces);
    const m = (v: number): number => Math.min(100, v + left);
    return { infantry: m(l.infantry), armored: m(l.armored), artillery: m(l.artillery), specialForces: m(l.specialForces) };
}

/** A loadout spinner's new value for type `k` (clamped to what is left of the 100 percent, method_265). */
export function fleetLoadoutSpin(l: TroopLoadout, k: keyof TroopLoadout, v: number): TroopLoadout {
    const max = troopLoadoutMaxima(l);
    return { ...l, [k]: Math.min(max[k], Math.max(0, v)) };
}

/** The loadout the group shows: the one last sent for the fleet while its reply is on the way (pendingCommands.ts),
 *  else the fleet's. */
export function displayedFleetTroopLoadout(sg: ShipGroup, pending: PendingValues<ShipGroup, TroopLoadout | null>): TroopLoadout | null {
    return pending.value(sg, fleetTroopLoadout(sg));
}

/** setFleetTroopLoadout, noting the loadout as sent until the reply lands (quick spinner clicks each count). */
export function issueFleetTroopLoadout(galaxy: Galaxy, empire: Empire, sg: ShipGroup, loadout: TroopLoadout | null, pending: PendingValues<ShipGroup, TroopLoadout | null>, done?: () => void): void {
    const settle = pending.send(sg, loadout === null ? null : { ...loadout });
    issuePlayerCommand(galaxy, empire, 'setFleetTroopLoadout', [sg, loadout], () => {
        settle();
        done?.();
    });
}

/** Main.Part9.cs method_267: the spinner labels "% Infantry  (= N units)" (GetTroopLoadoutTargetAmounts with
 *  refactorForDisabledTroopTypes false; 0 units without a fleet) and the capacity line. */
export function troopLoadoutLabels(sg: ShipGroup | null): { infantry: string; armored: string; artillery: string; specialForces: string; description: string } {
    const a = sg !== null ? shipGroupGetTroopLoadoutTargetAmounts(sg, false) : { infantryAmount: 0, artilleryAmount: 0, armorAmount: 0, specialForcesAmount: 0 };
    const line = (type: string, n: number): string => `% ${type}  (= ${n} units)`;
    return {
        infantry: line('Infantry', a.infantryAmount),
        armored: line('Armored', a.armorAmount),
        artillery: line('Artillery', a.artilleryAmount),
        specialForces: line('Special Forces', a.specialForcesAmount),
        description: `Total Fleet Troop Capacity: ${sg !== null ? shipGroupTotalTroopCapacity(sg).toFixed(0) : '0'}`,
    };
}

/** TroopList.cs GetTroopsNotGarrisonedAtColony: troops at a colony (and in its troop list) that are not garrisoned. */
export function troopsNotGarrisonedAtColony(troops: readonly Troop[]): Troop[] {
    return troops.filter((t) => {
        if (t == null || t.garrisoned || !t.atColony) return false;
        const colony = t.colony as { troops?: { contains(t: Troop): boolean } | null } | null;
        return colony != null && colony.troops != null && colony.troops.contains(t);
    });
}

/** Main.Part9.cs method_269: "Ungarrisoned Troops At Colonies\nN troops: 3 Inf, 1 Arm" (empty without a fleet). */
export function ungarrisonedTroopReport(troops: readonly Troop[], sg: ShipGroup | null): string {
    if (sg === null) return '';
    const list = troopsNotGarrisonedAtColony(troops);
    let text = `Ungarrisoned Troops At Colonies\n${list.length} troops`;
    const c = troopCountsByType(list);
    const comp = troopCompositionDescription(c.infantry, c.artillery, c.armor, c.specialForces);
    if (comp !== '') text += `: ${comp}`;
    return text;
}

/** The action buttons of the window (its own + the fleet orders row) as data. */
export type FleetActionId =
    | 'select' | 'goto' | 'setHomeColony' | 'repairRefuel' | 'retrofit' | 'loadTroops'
    | 'homeBase' | 'attackPoint' | 'posture' | 'range' | 'automate' | 'stop' | 'disband';

export interface FleetPanelState {
    /** Enabled flag per action (method_270: all of them need a selected fleet). */
    enabled: Record<FleetActionId, boolean>;
    automated: boolean;
}

/** Enable rules: a selected fleet enables everything (Main.Part9.cs method_270); Load Troops needs free troop space
 * (Main.Part3.cs fleetSlots, TotalTroopSpaceRemaining < 100 disables it) and Stop needs a current mission. */
export function fleetPanelState(sg: ShipGroup | null, troopSpaceRemaining = 100): FleetPanelState {
    const on = sg !== null;
    const enabled = {
        select: on, goto: on, setHomeColony: on, repairRefuel: on, retrofit: on,
        loadTroops: on && troopSpaceRemaining >= 100,
        homeBase: on, attackPoint: on, posture: on, range: on, automate: on,
        stop: on && sg.mission !== null && sg.mission.type !== BuiltObjectMissionType.Undefined,
        disband: on,
    };
    return { enabled, automated: sg !== null && fleetAutomated(sg) };
}

/** The ShipAction each generic fleet button issues through `shipAction` (selection = the fleet). */
export function fleetShipAction(id: 'posture' | 'range' | 'automate' | 'unautomate' | 'stop' | 'disband' | 'homeBase' | 'attackPoint', sg: ShipGroup): ShipAction {
    switch (id) {
        case 'posture': return ShipAction.forAction(ShipActionType.SetFleetPosture, sg);
        case 'range': return ShipAction.forAction(ShipActionType.SetFleetRange, sg);
        case 'automate': return ShipAction.forAction(ShipActionType.AutomateShip, sg);
        case 'unautomate': return ShipAction.forAction(ShipActionType.UnautomateShip, sg);
        case 'homeBase': return ShipAction.forAction(ShipActionType.SetFleetHomeBase, sg);
        case 'attackPoint': return ShipAction.forAction(ShipActionType.SetFleetAttackPoint, sg);
        case 'disband': return ShipAction.forAction(ShipActionType.DisbandShipGroup, sg);
        case 'stop': return ShipAction.forMission(BuiltObjectMissionType.Hold, sg);
    }
}

/** The window size: the original's 988 × 768 plus one 62 px band for our fleet orders row (y 702). */
export const FLEETS_WINDOW = { w: 988, h: 768 + 62 + 64, ordersY: 702, ordersH: 48, refillY: 760 } as const;

/** x positions of `n` equal buttons across the grid's 950 px (10 px gaps), for the fleet orders row. */
export function rowButtonLayout(n: number, left = 10, width = 950, gap = 10): { x: number; w: number }[] {
    const w = Math.floor((width - (n - 1) * gap) / n);
    const extra = width - (n * w + (n - 1) * gap);
    return Array.from({ length: n }, (_, i) => ({ x: left + i * (w + gap) + Math.min(i, extra), w: w + (i < extra ? 1 : 0) }));
}

/** GalaxyMap.cs method_5 (ShowFleetPostures): the posture circle of a fleet in world units, or null. Attack fleets
 *  ring their attack point red, defending fleets their gather point blue, only for a bounded range above the
 *  "point only" step; an attack fleet also gets the dotted arrow from its base to the attack point. */
export function fleetPostureCircle(sg: ShipGroup): { x: number; y: number; r: number; attack: boolean; from: { x: number; y: number } | null } | null {
    if (sg.leadShip === null) return null;
    const bounded = sg.postureRangeSquared > 2250000.0 && sg.postureRangeSquared < 3.4028234663852886e38;
    const r = bounded ? Math.sqrt(sg.postureRangeSquared) : 0;
    if (sg.posture === FleetPosture.Attack) {
        const p = sg.attackPoint;
        if (p === null) return null;
        return { x: p.xpos, y: p.ypos, r, attack: true, from: sg.gatherPoint !== null ? { x: sg.gatherPoint.xpos, y: sg.gatherPoint.ypos } : null };
    }
    if (sg.posture === FleetPosture.Defend && sg.gatherPoint !== null) {
        return { x: sg.gatherPoint.xpos, y: sg.gatherPoint.ypos, r, attack: false, from: null };
    }
    return null;
}

// -------------------------------------------------------------------------------------------------------------------
// The window
// -------------------------------------------------------------------------------------------------------------------

export interface FleetsListOptions {
    /** The empire whose fleets are listed (the player's). */
    empire: Empire;
    /** Go to the fleet: select it and move the view to its lead ship (btnShipGroupGoto, method_157). */
    onSelect: (sg: ShipGroup) => void;
    /** Select Fleet (btnShipGroupSelect, method_208): select without moving the view. Default onSelect. */
    onSelectOnly?: (sg: ShipGroup) => void;
    /** A ship / empire clicked in the info panel (pnlDetailInfoShipGroup hotspots). */
    onTarget?: (t: InfoTarget) => void;
    /** The fleet to highlight when the window opens (View Fleet from the Ships and Bases window). */
    selected?: ShipGroup;
    /** Home Base / Attack Point: the fleet becomes the selection and the next map click picks the point
     * (Main.Part7.cs SetFleetHomeBase / SetFleetAttackPoint set mouseHoverMode). The window closes. */
    onPickPoint?: (sg: ShipGroup, mode: 'homeBase' | 'attackPoint') => void;
    /** The tab to open on (default the last one shown). */
    tab?: 'fleets' | 'designs';
}

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;
/** The tab shown, kept between openings. */
let lastTab: 'fleets' | 'designs' = 'fleets';

/** Open the Fleets window, or close it if it is already open. */
export function toggleFleetsList(opts: FleetsListOptions): void {
    if (open) open.close();
    else open = createFleetsList(opts);
}

/** Close the Fleets window (no-op when closed). */
export function closeFleetsList(): void {
    open?.close();
}

/** One NumericUpDown of the loadout group (font_6), 40 × 25. */
function spinner(onChange: (v: number) => void): HTMLInputElement {
    const n = el('input', 'ow-input fl-num');
    n.type = 'number';
    n.min = '0';
    n.max = '100';
    n.step = '1';
    n.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') e.stopPropagation();
    });
    n.addEventListener('change', () => onChange(Math.trunc(Number(n.value) || 0)));
    return n;
}

function createFleetsList(opts: FleetsListOptions): OpenState {
    const { empire } = opts;
    const galaxy = empire.galaxy as Galaxy;
    let current: ShipGroup | null = opts.selected ?? null;
    let timer = 0;
    let tab: 'fleets' | 'designs' = opts.tab ?? (opts.selected !== undefined ? 'fleets' : lastTab);

    const win = openOriginalWindow({
        id: 'fleets',
        title: 'Fleets',
        icon: 'fleets.png',
        width: FLEETS_WINDOW.w,
        height: FLEETS_WINDOW.h,
        onClose: () => {
            window.clearInterval(timer);
            open = null;
        },
    });
    const body = win.body;
    const close = (): void => win.close();

    // lnkFleets (10, 8).
    body.appendChild(place(linkLabel('Learn about Fleets...', () => openGalactopedia({ topic: 'Fleets' })), 10, 8));

    // Our tabs, right-aligned above the grid: the fleets page, and Fleet Designs (fleetDesignsTab.ts).
    const tabs = tabStrip([{ id: 'fleets', label: 'Fleets' }, { id: 'designs', label: 'Fleet Designs' }], tab, (id) => showTab(id as 'fleets' | 'designs'), 130);
    tabs.classList.add('fl-tabs');
    body.appendChild(place(tabs, 960 - 266, 1, 266));

    const fleetsPage = place(el('div', 'fl-page'), 0, 0, win.bodySize.w, win.bodySize.h);
    const designsPage = place(el('div', 'fl-page'), 0, 0, win.bodySize.w, win.bodySize.h);
    body.append(fleetsPage, designsPage);

    // ---------------------------------------------------------------------------------------------------------------
    // ctlShipGroupListView (10, 27) 950 × 283.
    // ---------------------------------------------------------------------------------------------------------------
    const textCell = (s: string, cell: HTMLDivElement): void => {
        cell.textContent = s;
        cell.title = s;
    };
    const admiralList = (sg: ShipGroup) => (empire.characters != null ? getFleetAdmiralsAndGenerals(empire.characters, sg) : []);
    const admirals = (sg: ShipGroup): string => admiralList(sg).map((c) => c.name).join(', ');
    const renderers: Record<string, (r: FleetRow, cell: HTMLDivElement) => void> = {
        admirals: (r, cell) => {
            const list = admiralList(r.shipGroup);
            if (list.length === 0) return;
            const pic = characterPortrait(list[0], 'verySmall', CHARACTER_IMAGE_SPEC.verySmall.bitmap);
            pic.classList.add('fl-admiral');
            cell.appendChild(pic);
            cell.title = list.map((c) => c.name).join(', ');
        },
        name: (r, cell) => textCell(r.name, cell),
        ships: (r, cell) => textCell(String(r.ships), cell),
        power: (r, cell) => textCell(String(r.power), cell),
        troops: (r, cell) => textCell(fmtK(r.shipGroup.totalTroopAttackStrength), cell),
        home: (r, cell) => textCell(r.homeBase, cell),
        mission: (r, cell) => textCell(fleetMissionDescription(r.shipGroup), cell),
        system: (r, cell) => textCell(r.system, cell),
    };
    const sorts: Record<string, (r: FleetRow) => number | string> = {
        admirals: (r) => admirals(r.shipGroup),
        name: (r) => r.name,
        ships: (r) => r.ships,
        power: (r) => r.power,
        troops: (r) => r.shipGroup.totalTroopAttackStrength,
        home: (r) => r.homeBase,
        mission: (r) => fleetMissionDescription(r.shipGroup),
        system: (r) => r.system,
    };
    const columns: GridColumn<FleetRow>[] = FLEET_GRID_COLUMNS.map((c) => ({
        id: c.id,
        header: c.header,
        // The Mission column takes what the vertical scrollbar leaves.
        ...(c.id === 'mission' ? { fill: 1 } : { width: c.width }),
        align: c.align,
        sort: sorts[c.id],
        render: renderers[c.id],
        title: c.id === 'admirals' ? 'Admirals & Generals' : undefined,
    }));
    const grid = new OwGrid<FleetRow>({
        columns,
        key: (r) => r.shipGroup,
        empty: 'No fleets',
        onSelect: (r) => {
            current = r.shipGroup;
            updateDetail(true);
        },
        onDoubleClick: (r) => {
            close();
            opts.onSelect(r.shipGroup);
        },
    });
    fleetsPage.appendChild(place(grid.el, 10, 27, 950, 283));

    // ---------------------------------------------------------------------------------------------------------------
    // Name, Select / Go to, home colony.
    // ---------------------------------------------------------------------------------------------------------------
    dropText(fleetsPage, 'Name', 10, 330, { size: FONT.header, bold: true, color: 'rgb(120, 120, 120)', shadow: false });
    const nameBox = el('input', 'ow-input ow-textbox fl-name');
    nameBox.type = 'text';
    nameBox.autocomplete = 'off';
    nameBox.spellcheck = false;
    nameBox.style.fontSize = `${FONT.large}px`;
    nameBox.style.fontWeight = 'bold';
    fleetsPage.appendChild(place(nameBox, 60, 327, 280, 22));
    // txtShipGroupName_Leave: a non-blank name is applied when the box loses focus.
    const commitName = (): void => {
        const sg = selectedFleet();
        if (sg !== null && nameBox.value.trim() !== '' && nameBox.value !== sg.name) {
            issuePlayerCommand(galaxy, empire, 'renameFleet', [sg, nameBox.value], () => refresh());
        }
    };
    nameBox.addEventListener('blur', commitName);
    nameBox.addEventListener('keydown', (e) => {
        e.stopPropagation(); // typing must not trigger the game's hotkeys
        if (e.key === 'Enter') nameBox.blur();
        else if (e.key === 'Escape') {
            nameBox.value = selectedFleet()?.name ?? '';
            nameBox.blur();
        }
    });

    const btnSelect = glassButton('Select Fleet', { onClick: () => withFleet((sg) => (opts.onSelectOnly ?? opts.onSelect)(sg)) });
    fleetsPage.appendChild(place(btnSelect, 350, 320, 140, 42));
    const btnGoto = glassButton('Go to Fleet', {
        onClick: () => {
            const sg = selectedFleet();
            close();
            if (sg !== null) opts.onSelect(sg);
        },
    });
    fleetsPage.appendChild(place(btnGoto, 500, 320, 140, 42));

    // cmbShipGroupInfoHomeColony (652, 330) 157 × 21: "(Select new home colony)" then the colonies by name.
    const colonies = [...empire.colonies].filter((c) => c != null).sort((a: Habitat, b: Habitat) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const homeCombo = dropDown([{ value: '', label: '(Select new home colony)' }, ...colonies.map((c, i) => ({ value: String(i), label: c.name }))], '', () => {});
    fleetsPage.appendChild(place(homeCombo, 652, 330, 157, 22));
    const btnHome = glassButton('Set Home Colony', {
        onClick: () =>
            withFleet((sg) => {
                const c = colonies[Number(homeCombo.value)];
                if (homeCombo.value !== '' && c !== undefined) issuePlayerCommand(galaxy, empire, 'setFleetHomeColony', [sg, c], () => refresh());
            }),
    });
    fleetsPage.appendChild(place(btnHome, 815, 320, 145, 42));

    // ---------------------------------------------------------------------------------------------------------------
    // pnlDetailInfoShipGroup (11, 380) 328 × 310, CornerCurveMode.BottomRight_TopLeft.
    // ---------------------------------------------------------------------------------------------------------------
    const infoPanel = gradientPanel({ corners: { tl: true, br: true }, radius: 10, border: COLORS.bodyBorder, borderWidth: 1, className: 'fl-info' });
    fleetsPage.appendChild(place(infoPanel, 11, 380, 328, 310));
    const infoFrame = el('div', 'sel-frame fl-info-frame');
    const infoContent = el('div', 'sel-content-box fl-info-content');
    infoFrame.appendChild(infoContent);
    infoPanel.appendChild(infoFrame);
    const onTarget = (t: InfoTarget): void => {
        if (t.kind === 'select' && t.obj === selectedFleet()) return;
        opts.onTarget?.(t);
    };

    // Repair and Refuel / Retrofit / Load Troops (350 / 450 / 550, 380) 90 × 80.
    const bigButton = (label: string, x: number, onClick: () => void): HTMLButtonElement => {
        const b = glassButton(label, { onClick, className: 'fl-wrap' });
        fleetsPage.appendChild(place(b, x, 380, 90, 80));
        return b;
    };
    const btnRepair = bigButton('Repair and Refuel', 350, () => withFleet((sg) => issuePlayerCommand(galaxy, empire, 'fleetRepairAndRefuel', [sg], () => refresh())));
    btnRepair.title = 'Send the fleet to the nearest ship yard to repair, or to the nearest refuelling point';
    const btnRetrofit = bigButton('Retrofit to latest designs', 450, () => withFleet((sg) => issuePlayerCommand(galaxy, empire, 'fleetRetrofit', [sg], () => refresh())));
    btnRetrofit.title = 'Send the fleet to a ship yard to be retrofitted to the latest designs';
    const btnLoad = bigButton('Load Troops', 550, () => withFleet((sg) => issuePlayerCommand(galaxy, empire, 'fleetLoadTroops', [sg], () => refresh())));
    btnLoad.title = 'Load troops onto the fleet';

    // lblShipGroupUngarrisonedTroopReport (350, 470) 290 × 45, font_6.
    const troopReport = text('', { size: FONT.large, color: COLORS.label, shadow: false, wrapWidth: 290 });
    troopReport.classList.add('fl-report');
    fleetsPage.appendChild(place(troopReport, 350, 470, 290, 45));

    // grpShipGroupUseTroopLoadouts (350, 515) 290 × 175 with chkShipGroupUseTroopLoadouts over its caption (360, 512).
    const group = place(el('div', 'fl-group'), 350, 515, 290, 175);
    fleetsPage.appendChild(group);
    const useCheckInput = el('input');
    useCheckInput.type = 'checkbox';
    const useCheck = el('label', 'ow-check fl-group-caption');
    useCheck.style.fontSize = `${FONT.large}px`;
    useCheck.style.fontWeight = 'bold';
    useCheck.append(useCheckInput, el('span', '', 'Use Troop Loadouts'));
    fleetsPage.appendChild(place(useCheck, 358, 505));
    // uuGypgjgrb: on = 100 % infantry; off = all four 255. The loadout last sent counts until its reply lands
    // (pendingCommands.ts): quick repeated clicks on the spinners / the check box each take effect.
    const pendingLoadout = new PendingValues<ShipGroup, TroopLoadout | null>();
    useCheckInput.addEventListener('change', () =>
        withFleet((sg) => issueFleetTroopLoadout(galaxy, empire, sg, useCheckInput.checked ? { infantry: 100, armored: 0, artillery: 0, specialForces: 0 } : null, pendingLoadout, () => refresh())),
    );
    const keys: (keyof TroopLoadout)[] = ['infantry', 'armored', 'artillery', 'specialForces'];
    const spinners = {} as Record<keyof TroopLoadout, HTMLInputElement>;
    const spinLabels = {} as Record<keyof TroopLoadout, HTMLDivElement>;
    keys.forEach((k, i) => {
        // numShipGroupTroopLoadout* (10, 23 + 30 i) 40 × 25; lblShipGroupTroopLoadout* (50, 28 + 30 i).
        const n = spinner((v) =>
            withFleet((sg) => {
                const l = displayedFleetTroopLoadout(sg, pendingLoadout);
                if (l === null) return;
                issueFleetTroopLoadout(galaxy, empire, sg, fleetLoadoutSpin(l, k, v), pendingLoadout, () => refresh());
            }),
        );
        n.style.fontSize = `${FONT.large}px`;
        group.appendChild(place(n, 10, 23 + 30 * i, 44, 25));
        spinners[k] = n;
        spinLabels[k] = dropText(group, '', 56, 27 + 30 * i, { size: FONT.large, color: COLORS.label, shadow: false });
    });
    const loadoutDesc = dropText(group, '', 10, 148, { size: FONT.large, color: COLORS.label, shadow: false });

    // lblShipGroupGalaxyMapTitle (650, 365) and gmapShipGroupInfo (650, 380) 310 × 310.
    dropText(fleetsPage, 'Location of selected Fleet in Galaxy', 650, 360, { size: FONT.normal, color: COLORS.label, shadow: false });
    const mapBox = place(el('div', 'fl-map'), 650, 380, 310, 310);
    const mapCanvas = el('canvas');
    mapBox.appendChild(mapCanvas);
    fleetsPage.appendChild(mapBox);

    // ---------------------------------------------------------------------------------------------------------------
    // Our fleet orders row (the selection panel's fleet buttons).
    // ---------------------------------------------------------------------------------------------------------------
    // The Automate toggle's state last sent per fleet, until its reply lands (pendingCommands.ts).
    const pendingAutomated = new PendingValues<ShipGroup, boolean>();
    const orderSpecs: { id: FleetActionId; label: string; icon: string; title: string; run: (sg: ShipGroup) => void }[] = [
        { id: 'posture', label: 'Posture', icon: 'fleetAttackPosture.png', title: 'Toggle the fleet posture between Attack and Defend', run: (sg) => shipAction(sg, fleetShipAction('posture', sg)) },
        { id: 'range', label: 'Range', icon: 'fleetRangeAny.png', title: 'How far from its base or attack point the fleet takes missions (cycles)', run: (sg) => shipAction(sg, fleetShipAction('range', sg)) },
        { id: 'attackPoint', label: 'Attack Point', icon: 'fleetAttackPoint.png', title: 'Click an enemy base or colony on the map (click empty space to clear)', run: (sg) => { close(); opts.onPickPoint?.(sg, 'attackPoint'); } },
        { id: 'homeBase', label: 'Home Base', icon: 'fleetHomeBase.png', title: 'Click a friendly base or colony on the map (click empty space to clear)', run: (sg) => { close(); opts.onPickPoint?.(sg, 'homeBase'); } },
        { id: 'automate', label: 'Automate', icon: 'automate.png', title: 'Toggle whether the fleet is controlled by the AI', run: (sg) => {
            // A toggle: from the state last sent while its reply is on the way (a quick second click turns it back).
            const on = !pendingAutomated.value(sg, fleetAutomated(sg));
            const settle = pendingAutomated.send(sg, on);
            shipAction(sg, fleetShipAction(on ? 'automate' : 'unautomate', sg), settle);
        } },
        { id: 'stop', label: 'Stop', icon: 'stop.png', title: 'Cancel the fleet mission and hold', run: (sg) => shipAction(sg, fleetShipAction('stop', sg)) },
        { id: 'disband', label: 'Disband Fleet', icon: 'leavefleet.png', title: 'Disband the fleet; its ships stay in service', run: (sg) => { current = null; shipAction(sg, fleetShipAction('disband', sg)); } },
    ];
    const orderButtons = new Map<FleetActionId, HTMLButtonElement>();
    rowButtonLayout(orderSpecs.length).forEach(({ x, w }, i) => {
        const s = orderSpecs[i];
        const b = glassButton(s.label, { image: s.icon, minorText: '', title: s.title, className: 'fl-order', onClick: () => withFleet(s.run) });
        fleetsPage.appendChild(place(b, x, FLEETS_WINDOW.ordersY, w, FLEETS_WINDOW.ordersH));
        orderButtons.set(s.id, b);
    });

    // ---------------------------------------------------------------------------------------------------------------
    // The fleet's template row (fleetRefillControls.ts; not in the original): fleet design, auto-refill, yard,
    // Replenish, status.
    // ---------------------------------------------------------------------------------------------------------------
    const refillRow = createFleetRefillControls(empire, 950, () => refresh());
    fleetsPage.appendChild(place(refillRow.el, 10, FLEETS_WINDOW.refillY, 950, 56));

    // ---------------------------------------------------------------------------------------------------------------
    // Fleet Designs tab.
    // ---------------------------------------------------------------------------------------------------------------
    const designsTab = createFleetDesignsTab(designsPage, empire, { w: win.bodySize.w, h: win.bodySize.h });

    // ---------------------------------------------------------------------------------------------------------------
    // State.
    // ---------------------------------------------------------------------------------------------------------------
    function selectedFleet(): ShipGroup | null {
        if (current !== null && !empireShipGroups(empire).includes(current)) current = null;
        return current;
    }
    function withFleet(fn: (sg: ShipGroup) => void): void {
        const sg = selectedFleet();
        if (sg !== null) fn(sg);
    }
    /** Issue a shipAction on the fleet (the orders row), then redraw. */
    function shipAction(sg: ShipGroup, action: ShipAction, replied?: () => void): void {
        issuePlayerCommand(galaxy, empire, 'shipAction', [sg, action, false], () => {
            replied?.();
            refresh();
        });
    }

    let infoKey = '';
    /** Refresh everything that depends on the selected fleet. `changed`: the selection changed (reset the inputs). */
    function updateDetail(changed: boolean): void {
        const sg = selectedFleet();
        const state = fleetPanelState(sg, sg !== null ? Math.max(0, shipGroupTotalTroopCapacity(sg) - totalTroopSpaceUsed(sg)) : 0);
        // method_270.
        nameBox.disabled = sg === null;
        homeCombo.disabled = sg === null;
        btnSelect.disabled = !state.enabled.select;
        btnGoto.disabled = !state.enabled.goto;
        btnHome.disabled = !state.enabled.setHomeColony;
        btnRepair.disabled = !state.enabled.repairRefuel;
        btnRetrofit.disabled = !state.enabled.retrofit;
        btnLoad.disabled = !state.enabled.loadTroops;
        if (changed || document.activeElement !== nameBox) nameBox.value = sg?.name ?? '';
        if (changed) homeCombo.value = '';

        // The info panel (re-rendered when its content changes; scroll kept).
        if (sg === null) {
            if (infoKey !== '') renderInfoModel(infoContent, null, { galaxy, onTarget });
            infoKey = '';
        } else {
            const model = shipGroupInfo({ galaxy, player: empire, resource: () => null }, sg, true);
            const key = JSON.stringify(model, (k, v) => (k === 'ship' || k === 'obj' || k === 'flagOf' || k === 'empire' || k === 'target' || k === 'troop' ? undefined : v));
            if (changed || key !== infoKey) {
                const scroll = infoContent.querySelector('.sel-scroll');
                const top = changed || scroll === null ? 0 : scroll.scrollTop;
                renderInfoModel(infoContent, model, { galaxy, onTarget });
                const next = infoContent.querySelector('.sel-scroll');
                if (next !== null) next.scrollTop = top;
                infoKey = key;
            }
        }

        // Troops: report, loadout group.
        setText(troopReport, ungarrisonedTroopReport(empire.troops?.items ?? [], sg));
        const loadout = sg !== null ? displayedFleetTroopLoadout(sg, pendingLoadout) : null;
        useCheckInput.checked = loadout !== null;
        useCheckInput.disabled = sg === null;
        group.classList.toggle('fl-disabled', loadout === null);
        const labels = troopLoadoutLabels(sg);
        const max = loadout !== null ? troopLoadoutMaxima(loadout) : null;
        for (const k of keys) {
            const n = spinners[k];
            n.disabled = loadout === null;
            if (document.activeElement !== n) n.value = String(loadout?.[k] ?? 0);
            n.max = String(max?.[k] ?? 100);
            setText(spinLabels[k], labels[k]);
        }
        setText(loadoutDesc, sg !== null ? labels.description : '');

        // Orders row.
        for (const s of orderSpecs) {
            const b = orderButtons.get(s.id)!;
            b.disabled = !state.enabled[s.id];
        }
        const minor = (id: FleetActionId, t: string): void => setButtonMinorText(orderButtons.get(id)!, t);
        const icon = (id: FleetActionId, file: string): void => {
            const img = orderButtons.get(id)!.querySelector('img');
            const url = chromeImageUrl(file);
            if (img !== null && img.getAttribute('src') !== url) img.src = url;
        };
        if (sg !== null) {
            minor('posture', fleetPostureLabel(sg));
            icon('posture', sg.posture === FleetPosture.Defend ? 'fleetDefendPosture.png' : 'fleetAttackPosture.png');
            minor('range', fleetRangeLabel(sg.postureRangeSquared));
            icon('range', fleetRangeIcon(sg.postureRangeSquared));
            minor('attackPoint', sg.attackPoint?.name ?? '(None)');
            minor('homeBase', sg.gatherPoint?.name ?? '(None)');
            const automated = pendingAutomated.value(sg, state.automated);
            minor('automate', automated ? 'On' : 'Off');
            setButtonLabel(orderButtons.get('automate')!, automated ? 'Automated' : 'Automate');
            icon('automate', automated ? 'unautomate.png' : 'automate.png');
            minor('stop', sg.mission !== null && sg.mission.type !== BuiltObjectMissionType.Undefined ? missionTypeLabel(sg.mission.type) : '(No mission)');
            minor('disband', `${sg.ships.length} ships`);
        } else {
            for (const s of orderSpecs) minor(s.id, '');
        }
        refillRow.update(sg);
        drawMap();
    }

    function totalTroopSpaceUsed(sg: ShipGroup): number {
        let used = 0;
        for (const s of sg.ships) if (s?.troops != null) used += s.troops.totalSize;
        return used;
    }

    /** GalaxyMap.cs method_6 over the whole galaxy (SetPosition: centred, Galaxy.SizeX / width per pixel). */
    function drawMap(): void {
        const W = 310;
        const dpr = Math.min(3, window.devicePixelRatio || 1) * Math.max(1, win.scale);
        const px = Math.round(W * dpr);
        if (mapCanvas.width !== px) {
            mapCanvas.width = px;
            mapCanvas.height = px;
        }
        const ctx = mapCanvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, W);
        const s = galaxyMapScale(galaxy, W);
        // GalaxyMap.cs method_6: backdrop, nebulae and territory under the grid (galaxyMapLayers.ts).
        drawGalaxyMapLayers(ctx, galaxy, s, 0, 0, { onChange: () => { if (mapCanvas.isConnected) drawMap(); } });
        drawMapTerritory(ctx, galaxy, W);
        // Sector grid + labels (pen_1, Verdana 7 pt).
        const sec = galaxy.sectorSize / s;
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= galaxy.sectorWidth; i++) {
            const x = Math.trunc(i * sec) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, Math.min(W, galaxy.sectorHeight * sec));
        }
        for (let j = 0; j <= galaxy.sectorHeight; j++) {
            const y = Math.trunc(j * sec) + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(Math.min(W, galaxy.sectorWidth * sec), y);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgb(96, 96, 170)';
        ctx.font = '9px Verdana, sans-serif';
        ctx.textBaseline = 'top';
        for (let i = 0; i < galaxy.sectorWidth; i++) ctx.fillText(sectorColumnLabel(i), Math.trunc(i * sec + sec / 2 - 3), 2);
        for (let j = 0; j < galaxy.sectorHeight; j++) ctx.fillText(String(j + 1), 2, Math.trunc(j * sec + sec / 2 - 5));
        // method_5: the fleets' posture ranges.
        for (const sg of fleetCycleList(empire)) {
            const c = fleetPostureCircle(sg);
            if (c === null) continue;
            const color = c.attack ? 'rgba(255, 0, 0, 0.251)' : 'rgba(0, 0, 255, 0.251)';
            const x = c.x / s;
            const y = c.y / s;
            const r = c.r / s;
            if (r > 0) {
                ctx.fillStyle = color;
                ctx.strokeStyle = color;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            if (c.from !== null) {
                // pen3: dotted, arrow-anchor end cap.
                const fx = c.from.x / s;
                const fy = c.from.y / s;
                ctx.strokeStyle = color;
                ctx.setLineDash([1, 2]);
                ctx.beginPath();
                ctx.moveTo(fx, fy);
                ctx.lineTo(x, y);
                ctx.stroke();
                ctx.setLineDash([]);
                const a = Math.atan2(y - fy, x - fx);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x - 5 * Math.cos(a - 0.5), y - 5 * Math.sin(a - 0.5));
                ctx.lineTo(x - 5 * Math.cos(a + 0.5), y - 5 * Math.sin(a + 0.5));
                ctx.fill();
            }
        }
        // Systems, with the dominant empire's ring when the player knows the system.
        const sizes = starDotSizes(W, false);
        for (const sys of galaxy.systems) {
            const star = sys.systemStar;
            const color = starBrushColor(star);
            const x = star.xpos / s;
            const y = star.ypos / s;
            const dom = sys.dominantEmpire?.empire ?? null;
            if (dom !== null) {
                const vis = empire.visibility?.checkSystemVisibilityStatus?.(star.systemIndex);
                if (vis === SystemVisibilityStatus.Visible || vis === SystemVisibilityStatus.Explored) {
                    ctx.strokeStyle = rgbCss(dom.mainColor);
                    ctx.lineWidth = 2;
                    ctx.setLineDash((sys.otherEmpires?.length ?? 0) > 0 ? [3, 1] : []);
                    ctx.beginPath();
                    ctx.arc(x, y, (sizes.normal + 4) / 2, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.lineWidth = 1;
                }
            }
            if (color === null) continue;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, sizes.normal / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        // SetLocations(ShipGroups): every fleet's lead ship, a yellow 5 px dot.
        ctx.fillStyle = 'rgb(255, 255, 0)';
        for (const sg of fleetCycleList(empire)) {
            if (sg.leadShip === null) continue;
            ctx.beginPath();
            ctx.arc(Math.trunc(sg.leadShip.xpos / s), Math.trunc(sg.leadShip.ypos / s), 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        // SetPosition(lead ship): the pen_2 crosshair.
        const sg = selectedFleet();
        if (sg?.leadShip != null) {
            const x = Math.trunc(sg.leadShip.xpos / s) + 1.5;
            const y = Math.trunc(sg.leadShip.ypos / s) + 1.5;
            ctx.strokeStyle = CROSSHAIR_COLOR;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, W);
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
    }

    /** Rebind the grid (keeps the selection and scroll) and refresh the detail. */
    function refresh(): void {
        if (win.closed) return;
        grid.setRows(fleetRows(empire));
        const sg = selectedFleet();
        grid.select(sg, false);
        updateDetail(false);
    }

    function showTab(t: 'fleets' | 'designs'): void {
        tab = t;
        lastTab = t;
        fleetsPage.style.display = t === 'fleets' ? '' : 'none';
        designsPage.style.display = t === 'designs' ? '' : 'none';
        if (t === 'designs') designsTab.render();
        else refresh();
    }

    // Open: bind, select the given fleet (SelectShipGroup scrolls it into view).
    grid.setRows(fleetRows(empire));
    if (current !== null) grid.select(current, true);
    updateDetail(true);
    showTab(tab);
    // Worker mode: bring what the screen shows up to date now instead of up to a cold cycle later (no-op in-thread).
    requestSimRefresh(galaxy, [empire, empire.shipGroups], () => refresh());
    timer = window.setInterval(() => {
        if (tab === 'designs') designsTab.refreshOrders(); // build progress
        else refresh();
    }, 1000);
    nameBox.blur();

    return { win, close };
}
