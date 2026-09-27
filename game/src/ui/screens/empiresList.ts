// Empires list panel (task 12b): a compact in-game DOM panel listing the
// known empires, opened by the HUD's Empires button. The original's Empires
// screen (Main.Part5.cs) is a full diplomacy window; this streamlined version
// shows one row per empire — colour swatch, name ("(you)" for the player),
// colony count and capital name — and zooms to the clicked empire's capital.
// Styling follows the tutorial window / HUD dark-panel tokens.

import './empiresList.css';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { PirateRelationType } from '../../sim/pirateRelations';
import { displayColorForEmpire } from '../../sim/empireColors';

export interface EmpiresListOptions {
    /** galaxy.empires — every empire in the galaxy. */
    empires: Empire[];
    playerEmpire: Empire;
    /** Zoom the Main View to a capital (the HUD centres on it at system zoom). */
    onZoomTo: (habitat: Habitat) => void;
}

/** One displayed row of the panel. Pure so the row logic is testable without
 * a DOM (jsdom is not configured). */
export interface EmpireRow {
    empire: Empire;
    /** Name, with " (you)" appended for the player's empire. */
    label: string;
    colonies: number;
    capitalName: string;
}

/** The empires the player knows. Port of DiplomaticRelationListView.cs
 * 160-176 BindData: the player, then every diplomatic relation whose Type is
 * not NotMet, then every pirate relation whose Type is not NotMet — never the
 * galaxy's independent empire. */
export function knownEmpires(player: Empire): Set<Empire> {
    const known = new Set<Empire>([player]);
    const independent = player.galaxy?.independentEmpire ?? null;
    for (const rel of player.diplomaticRelations ?? []) {
        if (rel.type !== DiplomaticRelationType.NotMet && rel.otherEmpire != null && rel.otherEmpire !== independent) {
            known.add(rel.otherEmpire);
        }
    }
    for (const rel of player.pirateRelations ?? []) {
        if (rel.type !== PirateRelationType.NotMet && rel.otherEmpire != null && rel.otherEmpire !== independent) {
            known.add(rel.otherEmpire);
        }
    }
    return known;
}

/** Rows for the panel: only empires the player has met (knownEmpires);
 * empires with an empty name or no capital are excluded (they cannot be
 * shown or zoomed to); the player comes first, then the rest sorted by name
 * (localeCompare). */
export function empireRows(empires: Empire[], player: Empire): EmpireRow[] {
    const known = knownEmpires(player);
    const visible = empires.filter((e) => known.has(e) && e.name !== '' && e.capital != null);
    const rest = visible
        .filter((e) => e !== player)
        .sort((a, b) => a.name.localeCompare(b.name));
    const ordered = visible.includes(player) ? [player, ...rest] : rest;
    return ordered.map((e) => ({
        empire: e,
        label: e === player ? `${e.name} (you)` : e.name,
        colonies: e.colonies.length,
        capitalName: e.capital!.name,
    }));
}

/** Task 19k-1d (Big Galaxies): case-insensitive substring filter on name/capital, for the panel's filter box — at 60
 * empires the plain list is long, so a filter is the fast way to find one. An empty/blank query keeps every row. */
export function filterEmpireRows(rows: EmpireRow[], query: string): EmpireRow[] {
    const q = query.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(q) || r.capitalName.toLowerCase().includes(q));
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Empires list, or close it if it is already open. */
export function toggleEmpiresList(opts: EmpiresListOptions): void {
    if (open) {
        open.close();
    } else {
        open = createEmpiresList(opts);
    }
}

/** Close the Empires list (no-op when closed). */
export function closeEmpiresList(): void {
    open?.close();
}

function createEmpiresList(opts: EmpiresListOptions): OpenState {
    const root = document.createElement('div');
    root.className = 'empires-list-wrap';

    const win = document.createElement('div');
    win.className = 'empires-list-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'empires-list-titlebar';
    const heading = document.createElement('div');
    heading.className = 'empires-list-heading';
    heading.textContent = 'Empires';
    titlebar.appendChild(heading);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'empires-list-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    // Task 19k-1d (Big Galaxies): a filter box, so a 60-empire list stays
    // usable — filters by name or capital (filterEmpireRows).
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'empires-list-filter';
    filterInput.placeholder = 'Filter by name or capital…';
    filterInput.autocomplete = 'off';
    win.appendChild(filterInput);

    const body = document.createElement('div');
    body.className = 'empires-list-body';

    // Task 12g: column headers, same grid as the rows (blank swatch column).
    const header = document.createElement('div');
    header.className = 'empires-list-header';
    const blank = document.createElement('span');
    blank.className = 'empires-list-header-swatch';
    const hName = document.createElement('span');
    hName.className = 'empires-list-header-cell';
    hName.textContent = 'Empire';
    const hColonies = document.createElement('span');
    hColonies.className = 'empires-list-header-cell empires-list-header-colonies';
    hColonies.textContent = 'Colonies';
    const hCapital = document.createElement('span');
    hCapital.className = 'empires-list-header-cell';
    hCapital.textContent = 'Capital';
    header.append(blank, hName, hColonies, hCapital);
    body.appendChild(header);

    const allRows = empireRows(opts.empires, opts.playerEmpire);
    const rowsList = document.createElement('div');
    rowsList.className = 'empires-list-rows';
    body.appendChild(rowsList);

    function renderRows(): void {
        rowsList.replaceChildren();
        const rows = filterEmpireRows(allRows, filterInput.value);
        for (const row of rows) {
            const line = document.createElement('div');
            line.className = 'empires-list-row';

            // Colour swatch: the empire's display colour (its own mainColor, or — with the big-galaxies scenario's
            // extendedPalette flag on — a distinct extra colour once the 20 key colours are spent, task 19k-1b).
            const c = displayColorForEmpire(row.empire);
            const swatch = document.createElement('span');
            swatch.className = 'empires-list-swatch';
            swatch.style.background = `rgb(${(c >> 16) & 255}, ${((c >> 8) & 255)}, ${(c & 255)})`;

            const name = document.createElement('span');
            name.className = 'empires-list-name';
            name.textContent = row.label;

            const count = document.createElement('span');
            count.className = 'empires-list-colonies';
            count.textContent = String(row.colonies);

            const capital = document.createElement('span');
            capital.className = 'empires-list-capital';
            capital.textContent = row.capitalName;

            line.append(swatch, name, count, capital);
            line.addEventListener('click', () => {
                const capitalHabitat = row.empire.capital;
                if (!capitalHabitat) return;
                close();
                opts.onZoomTo(capitalHabitat);
            });
            rowsList.appendChild(line);
        }
        if (rows.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empires-list-empty';
            empty.textContent = 'No empires match this filter.';
            rowsList.appendChild(empty);
        }
    }
    filterInput.addEventListener('input', renderRows);
    renderRows();

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