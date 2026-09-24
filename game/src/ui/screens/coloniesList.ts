// Colonies list panel (task 12m): a compact in-game DOM panel listing the
// player's colonies, opened by F2. The original's Colonies screen
// (Main.Part5.cs) is a full window with per-colony detail; this streamlined
// version shows one row per colony — name (with a "capital" tag for the
// capital) and population — and zooms to the clicked colony at system level.
// Styling follows the Empires list / tutorial-window dark-panel tokens.

import './coloniesList.css';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { formatPopulation } from '../hud';

export interface ColoniesListOptions {
    /** The empire whose colonies are listed (the player's). */
    empire: Empire;
    /** Zoom the Main View to a colony (system zoom, like the empires list). */
    onZoomTo: (habitat: Habitat) => void;
}

/** One displayed row of the panel. Pure so the row logic is testable without
 * a DOM (jsdom is not configured). */
export interface ColonyRow {
    habitat: Habitat;
    name: string;
    /** Population formatted via hud.formatPopulation ('1.2B' / '350M' / ...). */
    population: string;
    isCapital: boolean;
}

/** Rows for the panel: the empire's colonies sorted by population descending
 * (a missing population counts as 0), ties broken by name. */
export function colonyRows(empire: Empire): ColonyRow[] {
    return [...empire.colonies]
        .sort((a, b) => {
            const pa = a.population?.totalAmount ?? 0;
            const pb = b.population?.totalAmount ?? 0;
            if (pa !== pb) return pb - pa;
            return a.name.localeCompare(b.name);
        })
        .map((h) => ({
            habitat: h,
            name: h.name,
            population: formatPopulation(h.population?.totalAmount ?? 0),
            isCapital: empire.capital === h,
        }));
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Colonies list, or close it if it is already open. */
export function toggleColoniesList(opts: ColoniesListOptions): void {
    if (open) {
        open.close();
    } else {
        open = createColoniesList(opts);
    }
}

/** Close the Colonies list (no-op when closed). */
export function closeColoniesList(): void {
    open?.close();
}

function createColoniesList(opts: ColoniesListOptions): OpenState {
    const root = document.createElement('div');
    root.className = 'colonies-list-wrap';

    const win = document.createElement('div');
    win.className = 'colonies-list-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'colonies-list-titlebar';
    const heading = document.createElement('div');
    heading.className = 'colonies-list-heading';
    heading.textContent = 'Colonies';
    titlebar.appendChild(heading);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'colonies-list-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = document.createElement('div');
    body.className = 'colonies-list-body';

    // Column headers, same grid as the rows (Name | Population).
    const header = document.createElement('div');
    header.className = 'colonies-list-header';
    const hName = document.createElement('span');
    hName.className = 'colonies-list-header-cell';
    hName.textContent = 'Name';
    const hPopulation = document.createElement('span');
    hPopulation.className = 'colonies-list-header-cell colonies-list-header-population';
    hPopulation.textContent = 'Population';
    header.append(hName, hPopulation);
    body.appendChild(header);

    for (const row of colonyRows(opts.empire)) {
        const line = document.createElement('div');
        line.className = 'colonies-list-row';

        const name = document.createElement('span');
        name.className = 'colonies-list-name';
        name.textContent = row.name;
        if (row.isCapital) {
            const tag = document.createElement('span');
            tag.className = 'colonies-list-capital-tag';
            tag.textContent = 'capital';
            name.appendChild(tag);
        }

        const pop = document.createElement('span');
        pop.className = 'colonies-list-population';
        pop.textContent = row.population;

        line.append(name, pop);
        line.addEventListener('click', () => {
            close();
            opts.onZoomTo(row.habitat);
        });
        body.appendChild(line);
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