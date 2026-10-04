// Empires list panel (task 12b): a compact in-game DOM panel listing the
// known empires, opened by the HUD's Empires button. The original's Empires
// screen (Main.Part5.cs) is a full diplomacy window; this streamlined version
// shows one row per empire — colour swatch, name ("(you)" for the player),
// colony count and capital name — and zooms to the clicked empire's capital.
// Original-style ScreenPanel + OwGrid (ui/originalWindow.ts).

import './empiresList.css';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { PirateRelationType } from '../../sim/pirateRelations';
// [charters] begin
import { companyTag, toggleChartersScreen } from './charters';
import { scenarioFlag } from '../../sim/scenario/state';
// [charters] end
import { applyEmpireEmblem } from '../empireEmblem';
import { leagueSection } from '../leagueRows';
import { rimTraderTag } from '../scenario/rimTraderRows';
import { displayColorForEmpire } from '../../sim/empireColors';
import { FONT, OwGrid, glassButton, openOriginalWindow, place, textBox } from '../originalWindow';

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
    // Original-style ScreenPanel (ui/originalWindow.ts); an OwGrid of the known empires like the Diplomacy list.
    const W = 600;
    const H = 640;
    const owin = openOriginalWindow({
        id: 'empires',
        title: 'Empires',
        icon: 'diplomacy.png',
        width: W,
        height: H,
        noAutoPause: true,
        onClose: () => close(),
    });
    const root = owin.root;
    root.classList.add('empires-list-wrap');
    const body = owin.body;
    const bw = owin.bodySize.w;
    const bh = owin.bodySize.h;
    // [charters] begin
    // Scenario 19c: the Charters screen button (tasks/19c-chartered-companies.md §8.3).
    const charterGalaxy = opts.playerEmpire.galaxy ?? null;
    if (charterGalaxy !== null && owin.header !== null && scenarioFlag(charterGalaxy, 'charteredCompanies')) {
        const chartersBtn = glassButton('Charters', { size: FONT.normal, className: 'charters-btn charters-header-btn', onClick: () => toggleChartersScreen(charterGalaxy, opts.playerEmpire) });
        place(chartersBtn, owin.header.clientWidth > 0 ? owin.header.clientWidth - 41 - 128 : W - 14 - 41 - 128, 10, 120, 30);
        owin.header.appendChild(chartersBtn);
    }
    // [charters] end

    // Task 19k-1d (Big Galaxies): a filter box, so a 60-empire list stays usable — filters by name or capital
    // (filterEmpireRows).
    const filterInput = textBox('', 'Filter by name or capital…', () => renderRows());
    filterInput.classList.add('empires-list-filter');
    filterInput.style.fontSize = `${FONT.normal}px`;
    place(filterInput, 8, 8, bw - 16, 28);
    body.appendChild(filterInput);

    // 19r: the independent leagues (19k-3) with their flags, when any exist.
    const leagues = leagueSection(opts.playerEmpire.galaxy, 'empires-list');
    const leagueH = leagues !== null ? Math.min(150, 34 + (leagues.children.length - 1) * 24) : 0;
    const gridH = bh - 44 - 8 - (leagueH > 0 ? leagueH + 6 : 0);

    // Task 12g column headers + rows (the swatch column has no header).
    const allRows = empireRows(opts.empires, opts.playerEmpire);
    const grid = new OwGrid<EmpireRow>({
        key: (r) => r.empire,
        rowHeight: 26,
        fontSize: FONT.normal,
        empty: 'No empires match this filter.',
        onSelect: (row) => {
            const capitalHabitat = row.empire.capital;
            if (!capitalHabitat) return;
            close();
            opts.onZoomTo(capitalHabitat);
        },
        columns: [
            {
                id: 'swatch',
                header: '',
                width: 26,
                align: 'center',
                // Colour swatch: the empire's display colour (its own mainColor, or — with the big-galaxies
                // scenario's extendedPalette flag on — a distinct extra colour once the 20 key colours are spent,
                // task 19k-1b).
                render: (row, cell) => {
                    const c = displayColorForEmpire(row.empire);
                    const swatch = document.createElement('span');
                    swatch.className = 'empires-list-swatch';
                    swatch.style.background = `rgb(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255})`;
                    cell.appendChild(swatch);
                },
            },
            {
                id: 'name',
                header: 'Empire',
                fill: 1.3,
                render: (row, cell) => {
                    const name = document.createElement('span');
                    name.className = 'empires-list-name';
                    name.textContent = row.label;
                    // [charters] begin
                    const tag = charterGalaxy !== null ? companyTag(charterGalaxy, row.empire) : '';
                    if (tag !== '') name.textContent = `${row.label} — ${tag}`;
                    // [charters] end
                    // 19r: the empire's flag (derived / scenario flags through the emblem overrides — after the
                    // charters tag's textContent assignment above, since that would wipe out a prepended child node).
                    if (row.empire.galaxy?.scenario != null) {
                        const flag = document.createElement('img');
                        flag.className = 'empires-list-flag';
                        flag.alt = '';
                        flag.draggable = false;
                        flag.style.cssText = 'width:24px;height:14px;margin-right:6px;vertical-align:middle';
                        flag.addEventListener('error', () => flag.remove());
                        applyEmpireEmblem(flag, row.empire.galaxy, row.empire, 'flag');
                        name.prepend(flag);
                    }
                    // [rimTrader] begin
                    const rimTag = row.empire.galaxy != null ? rimTraderTag(row.empire.galaxy, row.empire) : '';
                    if (rimTag !== '') name.appendChild(Object.assign(document.createElement('span'), { className: 'empires-list-tag', textContent: rimTag }));
                    // [rimTrader] end
                    cell.appendChild(name);
                },
            },
            { id: 'colonies', header: 'Colonies', width: 80, align: 'right', render: (row, cell) => (cell.textContent = String(row.colonies)) },
            { id: 'capital', header: 'Capital', fill: 1, render: (row, cell) => { cell.textContent = row.capitalName; cell.style.paddingLeft = '16px'; } },
        ],
    });
    place(grid.el, 8, 44, bw - 16, gridH);
    body.appendChild(grid.el);
    function renderRows(): void {
        grid.setRows(filterEmpireRows(allRows, filterInput.value));
    }
    renderRows();

    if (leagues !== null) {
        leagues.classList.add('empires-list-leagues-box');
        place(leagues, 8, bh - leagueH - 8, bw - 16, leagueH);
        body.appendChild(leagues);
    }

    let closing = false;
    function close(): void {
        if (closing) return;
        closing = true;
        if (!owin.closed) owin.close();
        open = null;
    }
    return { root, close };
}
