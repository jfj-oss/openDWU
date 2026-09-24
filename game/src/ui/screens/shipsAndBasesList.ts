// Ships and Bases list panel (task 13f): a streamlined port of the original's
// Ships and Bases window (Main.Part9.cs tbtnBuiltObjects_Click, BaconMain.cs
// method_423 for the list, BuiltObjectListView.cs for the row columns), opened
// by F11 or the top-bar button. The original is a 1024x756 window with filter
// combos, detail tabs and a mini galaxy map; this version shows one row per
// ship/base — name, role (+ sub-role), system and location — sorted by
// distance to the selection when there is one, and zooms to the clicked object
// at system level. Styling follows the Empires list / tutorial-window
// dark-panel tokens.

import './shipsAndBasesList.css';
import type { BuiltObject } from '../../sim/builtObject';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { subRoleLabel } from '../hud';

/** Human label for a built-object role: 'None' for Undefined (GameText.txt
 * "Ship Role Base" -> Base, ... , Undefined -> "None"), otherwise the enum
 * name (Galaxy.2.cs ResolveDescription(BuiltObjectRole)). */
export function builtObjectRoleLabel(role: BuiltObjectRole): string {
    if (role === BuiltObjectRole.Undefined) return 'None';
    return BuiltObjectRole[role];
}

/** One displayed row of the panel. Pure so the row logic is testable without
 * a DOM (jsdom is not configured). */
export interface ShipsAndBasesRow {
    builtObject: BuiltObject;
    name: string;
    /** `${role}, ${subRole}` (BuiltObjectListView.cs 545-561); just the role
     * when the sub-role is Undefined. */
    role: string;
    /** Nearest system star's name, or '(Deep Space)'. */
    system: string;
    /** Parent habitat's name, or '' for free-flying ships. */
    location: string;
}

/** Rows for the panel: the empire's state-owned + private ships and bases
 * (BaconMain.cs method_423 default filter "(Show all ships and bases)"). With
 * a `selected` position the list is stably sorted by squared distance to it
 * (BaconMain.cs OrderByDistance, Galaxy.CalculateDistanceSquaredStatic). */
export function shipsAndBasesRows(
    empire: { builtObjects: BuiltObject[]; privateBuiltObjects: BuiltObject[] },
    selected: { xpos: number; ypos: number } | null,
): ShipsAndBasesRow[] {
    const list = [...empire.builtObjects, ...empire.privateBuiltObjects].filter((b) => b !== null);
    if (selected !== null) {
        // Array.prototype.sort is stable, like C# LINQ OrderBy.
        list.sort((a, b) => {
            const da = (a.xpos - selected.xpos) ** 2 + (a.ypos - selected.ypos) ** 2;
            const db = (b.xpos - selected.xpos) ** 2 + (b.ypos - selected.ypos) ** 2;
            return da - db;
        });
    }
    return list.map((bo) => {
        const sub = subRoleLabel(bo.subRole);
        return {
            builtObject: bo,
            name: bo.name,
            role: sub ? `${builtObjectRoleLabel(bo.role)}, ${sub}` : builtObjectRoleLabel(bo.role),
            system: bo.nearestSystemStar?.name || '(Deep Space)',
            location: bo.parentHabitat?.name ?? '',
        };
    });
}

export interface ShipsAndBasesListOptions {
    /** The empire whose ships and bases are listed (the player's). */
    empire: { builtObjects: BuiltObject[]; privateBuiltObjects: BuiltObject[] };
    /** The selected object's position (sorts the list by distance), or null. */
    selected: { xpos: number; ypos: number } | null;
    /** Zoom the Main View to a ship/base (system zoom, like the colonies list). */
    onZoomTo: (bo: BuiltObject) => void;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;

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

function createShipsAndBasesList(opts: ShipsAndBasesListOptions): OpenState {
    const rows = shipsAndBasesRows(opts.empire, opts.selected);

    const root = document.createElement('div');
    root.className = 'ships-list-wrap';

    const win = document.createElement('div');
    win.className = 'ships-list-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'ships-list-titlebar';
    const heading = document.createElement('div');
    heading.className = 'ships-list-heading';
    heading.textContent = `Ships and Bases (${rows.length})`;
    titlebar.appendChild(heading);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ships-list-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = document.createElement('div');
    body.className = 'ships-list-body';

    // Column headers, same grid as the rows (Name | Role | System | Location).
    const header = document.createElement('div');
    header.className = 'ships-list-header';
    const hName = document.createElement('span');
    hName.className = 'ships-list-header-cell';
    hName.textContent = 'Name';
    for (const text of ['Role', 'System', 'Location'] as const) {
        const cell = document.createElement('span');
        cell.className = 'ships-list-header-cell';
        cell.textContent = text;
        header.appendChild(cell);
    }
    header.prepend(hName);
    body.appendChild(header);

    if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ships-list-empty';
        empty.textContent = 'No ships or bases';
        body.appendChild(empty);
    } else {
        for (const row of rows) {
            const line = document.createElement('div');
            line.className = 'ships-list-row';

            const name = document.createElement('span');
            name.className = 'ships-list-name';
            name.textContent = row.name;

            const role = document.createElement('span');
            role.className = 'ships-list-cell';
            role.textContent = row.role;
            // The role cell may be ellipsized: keep the full text in the tooltip.
            role.title = row.role;

            const system = document.createElement('span');
            system.className = 'ships-list-cell';
            system.textContent = row.system;

            const location = document.createElement('span');
            location.className = 'ships-list-cell';
            location.textContent = row.location;

            line.append(name, role, system, location);
            line.addEventListener('click', () => {
                close();
                opts.onZoomTo(row.builtObject);
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