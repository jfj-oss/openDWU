// Empire Summary panel (task 12j): the original's F6 "Your Empire Summary"
// screen (Main.Part5.cs) as a compact in-game DOM panel. The original is a
// full statistics window; this streamlined version shows one row per summary
// field — empire, race, government, capital, colonies, population, treasury —
// for the player's empire. Styling follows the Empires list / tutorial-window
// dark-panel tokens.

import './empireSummary.css';
import type { Empire } from '../../sim/empire';
import { formatMoney, formatPopulation } from '../hud';

/** The data the panel displays: the player's empire plus its government's
 * display name (null when unknown). */
export interface EmpireSummarySource {
    empire: Empire;
    governmentName: string | null;
}

/** One displayed row of the panel. Pure so the row logic is testable without
 * a DOM (jsdom is not configured). */
export interface EmpireSummaryRow {
    label: string;
    value: string;
}

/** Rows for the panel, in the original's order: Empire, Race, Government,
 * Capital, Colonies, Population, Treasury. Missing values show '—'. */
export function empireSummaryRows(src: EmpireSummarySource): EmpireSummaryRow[] {
    const e = src.empire;
    let population = 0;
    for (const c of e.colonies) {
        population += c.population?.totalAmount ?? 0;
    }
    return [
        { label: 'Empire', value: e.name },
        { label: 'Race', value: e.dominantRace?.name ?? '—' },
        { label: 'Government', value: src.governmentName ?? '—' },
        { label: 'Capital', value: e.capital?.name ?? '—' },
        { label: 'Colonies', value: String(e.colonies.length) },
        { label: 'Population', value: formatPopulation(population) },
        { label: 'Treasury', value: formatMoney(e.stateMoney) },
    ];
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;
let source: (() => EmpireSummarySource | null) | null = null;

/** Register the callback that supplies the panel's data (the HUD wires it to
 * the player's empire), or null to detach. */
export function setEmpireSummarySource(get: (() => EmpireSummarySource | null) | null): void {
    source = get;
}

/** The registered source's current value, or null when nothing is registered
 * or the callback returns null (task 12m: the Colonies list reads the player
 * empire through this). */
export function getEmpireSummarySource(): EmpireSummarySource | null {
    return source?.() ?? null;
}

/** Open the Empire Summary panel, or close it if it is already open. A no-op
 * when no source is registered (e.g. the generateGalaxy-only boot path). */
export function toggleEmpireSummary(): void {
    if (open) {
        open.close();
    } else if (source && typeof document !== 'undefined') {
        const s = source();
        if (s) open = createEmpireSummary(s);
    }
}

/** Close the Empire Summary panel (no-op when closed). */
export function closeEmpireSummary(): void {
    open?.close();
}

function createEmpireSummary(src: EmpireSummarySource): OpenState {
    const root = document.createElement('div');
    root.className = 'empire-summary-wrap';

    const win = document.createElement('div');
    win.className = 'empire-summary-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'empire-summary-titlebar';
    const heading = document.createElement('div');
    heading.className = 'empire-summary-heading';
    heading.textContent = 'Empire Summary';
    titlebar.appendChild(heading);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'empire-summary-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = document.createElement('div');
    body.className = 'empire-summary-body';

    for (const row of empireSummaryRows(src)) {
        const line = document.createElement('div');
        line.className = 'empire-summary-row';
        const label = document.createElement('span');
        label.className = 'empire-summary-label';
        label.textContent = row.label;
        const value = document.createElement('span');
        value.className = 'empire-summary-value';
        value.textContent = row.value;
        line.append(label, value);
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