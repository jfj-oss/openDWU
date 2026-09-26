// Empire Summary panel (task 12j): the original's F6 "Your Empire Summary"
// screen (Main.Part5.cs) as a compact in-game DOM panel. The original is a
// full statistics window; this streamlined version shows one row per summary
// field — empire, race, government, capital, colonies, population, treasury —
// for the player's empire. Task 13b appends the Economy rows from
// EmpireSummaryEconomy.cs (leader, colony tax revenue, ship & base
// maintenance, space ports, mining stations, state/private ships & bases,
// characters). Styling follows the Empires list / tutorial-window
// dark-panel tokens.
// TODO(sim): Troop maintenance, fuel costs and Cashflow (EmpireSummaryEconomy.cs 356-381) need Empire fields not yet ported.

import './empireSummary.css';
import type { Empire } from '../../sim/empire';
import { annualStateMaintenance, annualTaxRevenue } from '../../sim/forceStructure';
import { formatThousandsK } from './coloniesList';
import { formatMoney, formatPopulation } from '../hud';
import { stabilityRow } from '../emergentPolitics'; // [emergent]

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

/** The extra Economy rows (task 13b, EmpireSummaryEconomy.cs 343-381): the
 * leader's name and the empire's annual tax revenue / state maintenance
 * (null when the sim throws TODO(port)), plus counts of space ports, mining
 * stations, state & private ships/bases and characters. */
export interface EmpireSummaryExtra {
    leaderName: string | null;
    taxRevenue: number | null;
    maintenance: number | null;
    stateShipsAndBases: number;
    privateShipsAndBases: number;
    spacePorts: number;
    miningStations: number;
    characters: number;
}

/** Impure wrapper reading the extra fields off the empire. Each sim call is
 * in its own try/catch (some paths still throw TODO(port)) and falls back to
 * null; array lengths use `?.length ?? 0`. */
export function empireSummaryExtra(e: Empire): EmpireSummaryExtra {
    let taxRevenue: number | null = null;
    try {
        taxRevenue = annualTaxRevenue(e.galaxy, e);
    } catch {
        taxRevenue = null;
    }
    let maintenance: number | null = null;
    try {
        maintenance = annualStateMaintenance(e);
    } catch {
        maintenance = null;
    }
    return {
        leaderName: e.leader?.name ?? null,
        taxRevenue,
        maintenance,
        stateShipsAndBases: e.builtObjects?.length ?? 0,
        privateShipsAndBases: e.privateBuiltObjects?.length ?? 0,
        spacePorts: e.spacePorts?.length ?? 0,
        miningStations: e.miningStations?.length ?? 0,
        characters: e.characters?.length ?? 0,
    };
}

/** Rows for the panel, in the original's order: Empire, Race, Government,
 * Capital, Colonies, Population, Treasury. Missing values show '—'. With an
 * `extra`, the Economy rows (Leader, Colony tax revenue, Ship & base
 * maintenance, Space ports, Mining stations, State ships & bases, Private
 * ships & bases, Characters) are appended after Treasury. */
export function empireSummaryRows(
    src: EmpireSummarySource,
    extra?: EmpireSummaryExtra,
): EmpireSummaryRow[] {
    const e = src.empire;
    let population = 0;
    for (const c of e.colonies) {
        population += c.population?.totalAmount ?? 0;
    }
    const rows: EmpireSummaryRow[] = [
        { label: 'Empire', value: e.name },
        { label: 'Race', value: e.dominantRace?.name ?? '—' },
        { label: 'Government', value: src.governmentName ?? '—' },
        { label: 'Capital', value: e.capital?.name ?? '—' },
        { label: 'Colonies', value: String(e.colonies.length) },
        { label: 'Population', value: formatPopulation(population) },
        { label: 'Treasury', value: formatMoney(e.stateMoney) },
    ];
    if (extra) {
        rows.push(
            { label: 'Leader', value: extra.leaderName ?? '—' },
            { label: 'Colony tax revenue', value: extra.taxRevenue == null ? '—' : formatThousandsK(extra.taxRevenue) },
            { label: 'Ship & base maintenance', value: extra.maintenance == null ? '—' : formatThousandsK(extra.maintenance) },
            { label: 'Space ports', value: String(extra.spacePorts) },
            { label: 'Mining stations', value: String(extra.miningStations) },
            { label: 'State ships & bases', value: String(extra.stateShipsAndBases) },
            { label: 'Private ships & bases', value: String(extra.privateShipsAndBases) },
            { label: 'Characters', value: String(extra.characters) },
        );
    }
    return rows;
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

    const summaryRows = empireSummaryRows(src, empireSummaryExtra(src.empire));
    // [emergent] begin — 19d1 internal politics: instability as a Stability row (flag on only)
    const stability = src.empire.galaxy ? stabilityRow(src.empire.galaxy, src.empire) : null;
    if (stability !== null) summaryRows.push(stability);
    // [emergent] end
    for (const row of summaryRows) {
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