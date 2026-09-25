// Fleets list panel (task 15c): a streamlined port of the original's Fleets
// panel (Main.Part9.cs:3153 tbtnShipGroups_Click toggles pnlShipGroupInfo;
// ShipGroupListView.cs for the row columns; Galaxy.2.cs:2100
// ResolveDescriptionFleetPosture for the posture text), opened by F12 or the
// top-bar fleets button. One row per player ShipGroup — name, ships, power,
// troops, home base, mission and current system; clicking a row closes the
// list, selects the fleet and zooms to its lead ship. The fleet cycle keys
// follow Main.Part8.cs:1243 btnCycleShipGroups_Click (fleetCycleList).
// TODO(port): posture/orders editing, admiral portraits, fleet detail tabs — not in 15c (no sim setters)

import './fleetsList.css';
import type { ShipGroup } from '../../sim/fleets/shipGroup';
import { empireShipGroups } from '../../sim/fleets/shipGroup';
import { FleetPosture } from '../../sim/diplomacyTick';
import { BuiltObjectMissionType } from '../../sim/missions/mission';
import type { Empire } from '../../sim/empire';
import { missionTypeLabel, missionTargetText } from '../hud';

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

export interface FleetsListOptions {
    /** The empire whose fleets are listed (the player's). */
    empire: Empire;
    /** Select the clicked fleet (and zoom to its lead ship). */
    onSelect: (sg: ShipGroup) => void;
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
    const rows = fleetRows(opts.empire);

    const root = document.createElement('div');
    root.className = 'fleets-list-wrap';

    const win = document.createElement('div');
    win.className = 'fleets-list-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'fleets-list-titlebar';
    const heading = document.createElement('div');
    heading.className = 'fleets-list-heading';
    heading.textContent = `Fleets (${rows.length})`;
    titlebar.appendChild(heading);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'fleets-list-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = document.createElement('div');
    body.className = 'fleets-list-body';

    // Column headers, same grid as the rows.
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
    } else {
        for (const row of rows) {
            const line = document.createElement('div');
            line.className = 'fleets-list-row';

            const name = document.createElement('span');
            name.className = 'fleets-list-name';
            name.textContent = row.name;
            name.title = row.name;

            const cell = (text: string, numeric = false): HTMLElement => {
                const el = document.createElement('span');
                el.className = numeric ? 'fleets-list-cell fleets-list-number' : 'fleets-list-cell';
                el.textContent = text;
                // Cells may be ellipsized: keep the full text in the tooltip.
                el.title = text;
                return el;
            };

            line.append(
                name,
                cell(String(row.ships), true),
                cell(String(row.power), true),
                cell(String(row.troops), true),
                cell(row.homeBase),
                cell(row.mission),
                cell(row.system),
            );
            line.addEventListener('click', () => {
                close();
                opts.onSelect(row.shipGroup);
            });
            body.appendChild(line);
        }
    }
    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    function close(): void {
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu (and other open panels)
    // Escape handler (registered in createHud) from opening as well.
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
