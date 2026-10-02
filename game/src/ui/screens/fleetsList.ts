// Fleets list panel (task 15c): a streamlined port of the original's Fleets
// panel (Main.Part9.cs:3153 tbtnShipGroups_Click toggles pnlShipGroupInfo;
// ShipGroupListView.cs for the row columns; Galaxy.2.cs:2100
// ResolveDescriptionFleetPosture for the posture text), opened by F12 or the
// top-bar fleets button. One row per player ShipGroup — name, ships, power,
// troops, home base, mission and current system; clicking a row closes the
// list, selects the fleet and zooms to its lead ship. The fleet cycle keys
// follow Main.Part8.cs:1243 btnCycleShipGroups_Click (fleetCycleList).
// The window also carries the original's fleet detail controls (Main.Part9.cs method_268 layout, Main.Part3.cs /
// Main.Part6.cs / Main.Part9.cs handlers): rename, Select Fleet, Go to Fleet, Set Home Colony, Repair and Refuel,
// Retrofit to Latest Designs, Load Troops, troop loadouts, plus the selection-panel fleet buttons (Automate, Home Base,
// Attack Point, Posture, Range, Stop, Disband; Main.Part3.cs 3582-3645). All of them go through the player command
// queue (playerOps shipAction / renameFleet / setFleetHomeColony / setFleetTroopLoadout / fleetLoadTroops /
// fleetRetrofit / fleetRepairAndRefuel).
// TODO(port): admiral portraits and the galaxy mini map of the detail panel (pnlDetailInfoShipGroup, gmapShipGroupInfo)

import './fleetsList.css';
import type { ShipGroup } from '../../sim/fleets/shipGroup';
import { empireShipGroups } from '../../sim/fleets/shipGroup';
import { FleetPosture } from '../../sim/diplomacyTick';
import { BuiltObjectMissionType } from '../../sim/missions/mission';
import type { Empire } from '../../sim/empire';
import { missionTypeLabel, missionTargetText } from '../hud';
import { ShipAction, ShipActionType } from '../../sim/player/shipAction';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import type { TroopLoadout } from '../../sim/player/fleetOps';
import type { Habitat } from '../../sim/types';
import { shipGroupTotalTroopCapacity } from '../../sim/fleets/shipGroupTasks';
import { createFleetDesignsTab } from './fleetDesignsTab';

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

/** ShipGroupListView.cs:190 "Mission" column (mission type label). */
export function fleetMissionText(sg: ShipGroup): string {
    // TODO(port): full Galaxy.3.cs:20 ResolveDescription(empire, mission)
    return sg.mission === null || sg.mission.type === BuiltObjectMissionType.Undefined
        ? '(No mission)'
        : missionTypeLabel(sg.mission.type);
}

/** Main.Part8.cs:1243 btnCycleShipGroups_Click cycles PlayerEmpire.ShipGroups
 * in list order; null slots are skipped. */
export function fleetCycleList(empire: Empire): ShipGroup[] {
    return empireShipGroups(empire).filter((sg): sg is ShipGroup => sg !== null);
}

/** One displayed row of the panel (ShipGroupListView.cs:183-191). Pure so
 * the row logic is testable without a DOM (jsdom is not configured). */
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

// Port of ShipGroupListView.cs:183-191 (row cells 1-7).
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

/** The action buttons of the fleet detail panel (the selection panel's fleet buttons + the window's own) as data. */
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

export interface FleetsListOptions {
    /** The empire whose fleets are listed (the player's). */
    empire: Empire;
    /** Select the clicked fleet (and zoom to its lead ship). */
    onSelect: (sg: ShipGroup) => void;
    /** The fleet to highlight when the window opens (View Fleet from the Ships and Bases window). */
    selected?: ShipGroup;
    /** Home Base / Attack Point: the fleet becomes the selection and the next map click picks the point
     * (Main.Part7.cs SetFleetHomeBase / SetFleetAttackPoint set mouseHoverMode). The window closes. */
    onPickPoint?: (sg: ShipGroup, mode: 'homeBase' | 'attackPoint') => void;
    /** The tab to open on (default the fleets list). */
    tab?: 'fleets' | 'designs';
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Fleets list, or close it if it is already open. */
export function toggleFleetsList(opts: FleetsListOptions): void {
    if (open) {
        open.close();
    } else {
        open = createFleetsList(opts);
    }
}

/** Close the Fleets list (no-op when closed). */
export function closeFleetsList(): void {
    open?.close();
}

function createFleetsList(opts: FleetsListOptions): OpenState {
    const { empire } = opts;
    const galaxy = empire.galaxy;
    let rows = fleetRows(empire);
    let current: ShipGroup | null = opts.selected ?? null;

    const root = document.createElement('div');
    root.className = 'fleets-list-wrap';
    const win = document.createElement('div');
    win.className = 'fleets-list-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'fleets-list-titlebar';
    const heading = document.createElement('div');
    heading.className = 'fleets-list-heading';
    titlebar.appendChild(heading);
    // Tabs: the fleets list, and Fleet Designs (player fleet templates, fleetDesignsTab.ts — a deviation, no C# panel).
    const tabs = document.createElement('div');
    tabs.className = 'fleets-list-tabs';
    const tabButton = (text: string, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fleets-list-tab';
        b.textContent = text;
        b.addEventListener('click', onClick);
        tabs.appendChild(b);
        return b;
    };
    const fleetsTab = tabButton('Fleets', () => showTab('fleets'));
    const designsTabButton = tabButton('Fleet Designs', () => showTab('designs'));
    titlebar.appendChild(tabs);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'fleets-list-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = document.createElement('div');
    body.className = 'fleets-list-body';
    win.appendChild(body);
    const detail = document.createElement('div');
    detail.className = 'fleets-detail';
    win.appendChild(detail);
    const designsBox = document.createElement('div');
    designsBox.className = 'fleets-list-body fleet-designs-box';
    win.appendChild(designsBox);
    root.appendChild(win);
    document.body.appendChild(root);
    const designsTab = createFleetDesignsTab(designsBox, empire);
    let ordersTimer: ReturnType<typeof setInterval> | null = null;
    function showTab(tab: 'fleets' | 'designs'): void {
        const designs = tab === 'designs';
        body.style.display = designs ? 'none' : '';
        detail.style.display = designs ? 'none' : '';
        designsBox.style.display = designs ? '' : 'none';
        fleetsTab.classList.toggle('fleets-list-tab-active', !designs);
        designsTabButton.classList.toggle('fleets-list-tab-active', designs);
        if (ordersTimer !== null) clearInterval(ordersTimer);
        ordersTimer = null;
        if (designs) {
            designsTab.render();
            ordersTimer = setInterval(() => designsTab.refreshOrders(), 1000); // build progress
        } else {
            refresh();
        }
    }

    /** Issue a shipAction on the fleet (the panel's generic buttons), then redraw. */
    const shipAction = (sg: ShipGroup, action: ShipAction): void => {
        issuePlayerCommand(galaxy, empire, 'shipAction', [sg, action, false], () => refresh());
    };

    function buildList(): void {
        body.replaceChildren();
        heading.textContent = `Fleets (${rows.length})`;
        const header = document.createElement('div');
        header.className = 'fleets-list-header';
        const columns: [string, boolean][] = [
            ['Name', false], ['Ships', true], ['Power', true], ['Troops', true],
            ['Home base', false], ['Mission', false], ['System', false],
        ];
        for (const [text, numeric] of columns) {
            const cell = document.createElement('span');
            cell.className = numeric ? 'fleets-list-header-cell fleets-list-number' : 'fleets-list-header-cell';
            cell.textContent = text;
            header.appendChild(cell);
        }
        body.appendChild(header);
        if (rows.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'fleets-list-empty';
            empty.textContent = 'No fleets';
            body.appendChild(empty);
            return;
        }
        for (const row of rows) {
            const line = document.createElement('div');
            line.className = 'fleets-list-row' + (row.shipGroup === current ? ' fleets-list-row-selected' : '');
            const name = document.createElement('span');
            name.className = 'fleets-list-name';
            name.textContent = row.name;
            name.title = row.name;
            const cell = (text: string, numeric = false): HTMLElement => {
                const el = document.createElement('span');
                el.className = numeric ? 'fleets-list-cell fleets-list-number' : 'fleets-list-cell';
                el.textContent = text;
                el.title = text; // cells may be ellipsized: keep the full text in the tooltip
                return el;
            };
            line.append(name, cell(String(row.ships), true), cell(String(row.power), true), cell(String(row.troops), true), cell(row.homeBase), cell(row.mission), cell(row.system));
            line.addEventListener('click', () => {
                current = row.shipGroup;
                buildList();
                buildDetail();
            });
            line.addEventListener('dblclick', () => {
                close();
                opts.onSelect(row.shipGroup);
            });
            body.appendChild(line);
        }
    }

    function buildDetail(): void {
        detail.replaceChildren();
        const sg = current !== null && empireShipGroups(empire).includes(current) ? current : null;
        if (sg === null) {
            current = null;
            const hint = document.createElement('div');
            hint.className = 'fleets-list-empty';
            hint.textContent = rows.length === 0 ? '' : 'Select a fleet to see and change its settings';
            detail.appendChild(hint);
            return;
        }
        const state = fleetPanelState(sg, sg.ships.length > 0 ? 100 : 0);
        const line = (): HTMLElement => {
            const d = document.createElement('div');
            d.className = 'fleets-detail-line';
            detail.appendChild(d);
            return d;
        };
        const label = (parent: HTMLElement, text: string): void => {
            const l = document.createElement('span');
            l.className = 'fleets-detail-label';
            l.textContent = text;
            parent.appendChild(l);
        };
        const btn = (parent: HTMLElement, text: string, title: string, enabled: boolean, onClick: () => void): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'fleets-detail-button';
            b.textContent = text;
            b.title = title;
            b.disabled = !enabled;
            b.addEventListener('click', onClick);
            parent.appendChild(b);
            return b;
        };

        // Name (txtShipGroupName; committed on leaving the box, Main.Part9.cs txtShipGroupName_Leave).
        const nameLine = line();
        label(nameLine, 'Name');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'fleets-detail-name';
        nameInput.value = sg.name ?? '';
        const commitName = (): void => {
            if (nameInput.value.trim() !== '' && nameInput.value !== sg.name) {
                issuePlayerCommand(galaxy, empire, 'renameFleet', [sg, nameInput.value], () => refresh());
            }
        };
        nameInput.addEventListener('change', commitName);
        nameInput.addEventListener('keydown', (e) => {
            e.stopPropagation(); // typing must not trigger the game's hotkeys
            if (e.key === 'Enter') nameInput.blur();
            else if (e.key === 'Escape') { nameInput.value = sg.name ?? ''; nameInput.blur(); }
        });
        nameLine.appendChild(nameInput);
        btn(nameLine, 'Select Fleet', 'Select the fleet on the map', state.enabled.select, () => opts.onSelect(sg));
        btn(nameLine, 'Go to Fleet', 'Zoom to the fleet and close', state.enabled.goto, () => { close(); opts.onSelect(sg); });

        // Home colony (cmbShipGroupInfoHomeColony + btnShipGroupInfoSetHomeColony).
        const homeLine = line();
        label(homeLine, 'Home colony');
        const homeSelect = document.createElement('select');
        homeSelect.className = 'fleets-detail-select';
        const colonies = [...empire.colonies].sort((a: Habitat, b: Habitat) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = '(Select new home colony)';
        homeSelect.appendChild(o0);
        colonies.forEach((c, i) => {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = c.name;
            homeSelect.appendChild(o);
        });
        homeLine.appendChild(homeSelect);
        btn(homeLine, 'Set Home Colony', "Make the chosen colony the fleet's home base", state.enabled.setHomeColony, () => {
            const c = colonies[Number(homeSelect.value)];
            if (homeSelect.value !== '' && c !== undefined) issuePlayerCommand(galaxy, empire, 'setFleetHomeColony', [sg, c], () => refresh());
        });
        btn(homeLine, 'Pick Home Base', 'Click a friendly base or colony on the map (click empty space to clear)', state.enabled.homeBase, () => {
            close();
            opts.onPickPoint?.(sg, 'homeBase');
        });

        // Posture / range / attack point (selection-panel buttons: SetFleetPosture, SetFleetRange, SetFleetAttackPoint).
        const postureLine = line();
        label(postureLine, 'Stance');
        btn(postureLine, `Posture: ${fleetPostureLabel(sg)}`, 'Toggle between Attack and Defend', state.enabled.posture, () => shipAction(sg, fleetShipAction('posture', sg)));
        btn(postureLine, `Range: ${fleetRangeLabel(sg.postureRangeSquared)}`, 'How far from its base or attack point the fleet takes missions (cycles)', state.enabled.range, () => shipAction(sg, fleetShipAction('range', sg)));
        btn(postureLine, 'Pick Attack Point', 'Click an enemy base or colony on the map (click empty space to clear)', state.enabled.attackPoint, () => {
            close();
            opts.onPickPoint?.(sg, 'attackPoint');
        });
        const postureText = document.createElement('span');
        postureText.className = 'fleets-detail-text';
        postureText.textContent = fleetPostureDescription(sg);
        postureLine.appendChild(postureText);

        // Orders: Repair and Refuel, Retrofit, Load Troops, Automate, Stop, Disband.
        const orderLine = line();
        btn(orderLine, 'Repair and Refuel', 'Send the fleet to a ship yard to repair, or to refuel', state.enabled.repairRefuel, () => issuePlayerCommand(galaxy, empire, 'fleetRepairAndRefuel', [sg], () => refresh()));
        btn(orderLine, 'Retrofit to Latest Designs', 'Send the fleet to a ship yard to be retrofitted', state.enabled.retrofit, () => issuePlayerCommand(galaxy, empire, 'fleetRetrofit', [sg], () => refresh()));
        btn(orderLine, 'Load Troops', 'Load troops onto the fleet', state.enabled.loadTroops, () => issuePlayerCommand(galaxy, empire, 'fleetLoadTroops', [sg], () => refresh()));
        btn(orderLine, state.automated ? 'Automation: On' : 'Automation: Off', 'Toggle whether the fleet is controlled by the AI', state.enabled.automate, () =>
            shipAction(sg, fleetShipAction(state.automated ? 'unautomate' : 'automate', sg)));
        btn(orderLine, 'Stop', 'Cancel the fleet mission and hold', state.enabled.stop, () => shipAction(sg, fleetShipAction('stop', sg)));
        btn(orderLine, 'Disband Fleet', 'Disband the fleet; its ships stay in service', state.enabled.disband, () => {
            current = null;
            shipAction(sg, fleetShipAction('disband', sg));
        });

        // Troop loadouts (chkShipGroupUseTroopLoadouts + the four numShipGroupTroopLoadout* spinners).
        const loadout = fleetTroopLoadout(sg);
        const troopLine = line();
        const use = document.createElement('input');
        use.type = 'checkbox';
        use.checked = loadout !== null;
        use.id = 'fleets-use-loadouts';
        use.addEventListener('change', () =>
            issuePlayerCommand(galaxy, empire, 'setFleetTroopLoadout', [sg, use.checked ? { infantry: 100, armored: 0, artillery: 0, specialForces: 0 } : null], () => refresh()));
        const useLabel = document.createElement('label');
        useLabel.htmlFor = use.id;
        useLabel.textContent = 'Use Troop Loadouts';
        troopLine.append(use, useLabel);
        if (loadout !== null) {
            const max = troopLoadoutMaxima(loadout);
            const spin = (key: keyof TroopLoadout, text: string): void => {
                const wrap = document.createElement('span');
                wrap.className = 'fleets-detail-spin';
                const n = document.createElement('input');
                n.type = 'number';
                n.min = '0';
                n.max = String(max[key]);
                n.value = String(loadout[key]);
                n.addEventListener('keydown', (e) => e.stopPropagation());
                n.addEventListener('change', () =>
                    issuePlayerCommand(galaxy, empire, 'setFleetTroopLoadout', [sg, { ...loadout, [key]: Math.min(max[key], Math.max(0, Number(n.value) || 0)) }], () => refresh()));
                wrap.append(n, document.createTextNode(`% ${text}`));
                troopLine.appendChild(wrap);
            };
            spin('infantry', 'Infantry');
            spin('armored', 'Armored');
            spin('artillery', 'Artillery');
            spin('specialForces', 'Special Forces');
        }
        const cap = document.createElement('span');
        cap.className = 'fleets-detail-text';
        cap.textContent = `Troop capacity ${shipGroupTotalTroopCapacity(sg).toFixed(0)}`;
        troopLine.appendChild(cap);

        // Read-only summary (the detail panel): ships, mission, target, power, troops, home base, lead, location.
        const info = document.createElement('div');
        info.className = 'fleets-detail-info';
        for (const r of shipGroupSelectionRows(sg, empire)) {
            const l = document.createElement('span');
            l.className = 'fleets-detail-label';
            l.textContent = r.label;
            const v = document.createElement('span');
            v.className = 'fleets-detail-value';
            v.textContent = r.value;
            v.title = r.value;
            info.append(l, v);
        }
        detail.appendChild(info);
    }

    /** Redraw from the sim (after a filter of rows, or an applied command). */
    function refresh(): void {
        rows = fleetRows(empire);
        buildList();
        buildDetail();
    }

    showTab(opts.tab ?? 'fleets');

    function close(): void {
        if (ordersTimer !== null) clearInterval(ordersTimer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu (and other open panels)
    // Escape handler (registered in createHud) from opening as well.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    return { root, close };
}
