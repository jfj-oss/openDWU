// Colonies list panel (task 12m): a compact in-game DOM panel listing the
// player's colonies, opened by F2. The original's Colonies screen
// (Main.Part5.cs) is a full window with per-colony detail; this streamlined
// version shows one row per colony — name (with a "capital" tag for the
// capital) and population — and zooms to the clicked colony at system level.
// Styling follows the Empires list / tutorial-window dark-panel tokens.

import './coloniesList.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import { habitatDevelopmentLevel } from '../../sim/developmentLevel';
import { empireApprovalRating } from '../../sim/taxes';
import { habitatAnnualRevenue } from '../../sim/forceStructure';
import { formatPopulation } from '../hud';
import { colonyShortageMarker, crisesApprovalBreakdown } from '../../sim/scenario/emergent/crisesCore';
import { governorLoyaltyText } from '../emergentPolitics'; // [emergent]
import { colonyLedgerLines } from '../internalSecurityView'; // [security]

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
    /** DevelopmentLevel as '${Math.trunc(d)}%' (ItemListPanel.cs 897), or '—'. */
    development: string;
    /** Approval-mood icon (happy/neutral/sad/angry, ItemListPanel.cs 895-898); null = no icon. */
    approval: ApprovalMood | null;
    /** GDP (Habitat.AnnualRevenue) via formatThousandsK, or '—'. */
    gdp: string;
    tax: string;
    troops: string;
    /** Mod layer (19d2): the shortage marker's tooltip (lost luxuries / open crisis), or null (no marker). */
    shortage: string | null;
    /** Mod layer: scenario approval terms as tooltip lines ('Shortages -6.0'), or null. */
    approvalBreakdown: string | null;
}

/** Scenario extras for one colony row (19d2 shortage marker + approval breakdown). */
export interface ColonyScenarioInfo {
    shortage: string | null;
    approvalBreakdown: { label: string; value: number }[];
}

/** The scenario extras of a colony, or null with no scenario. Pure. */
export function colonyScenarioInfo(galaxy: Galaxy, h: Habitat): ColonyScenarioInfo | null {
    if (galaxy.scenario === null) return null;
    // 19m: with internal security on, the tooltip lists every stability-ledger cause.
    return { shortage: colonyShortageMarker(galaxy, h), approvalBreakdown: colonyLedgerLines(galaxy, h) ?? crisesApprovalBreakdown(galaxy, h) };
}

/** The four approval icons drawn by ItemListPanel.cs 895-898
 * (Main.Part12.cs 621-625: images/ui/chrome/happy|neutral|sad|angry.png). */
export type ApprovalMood = 'happy' | 'neutral' | 'sad' | 'angry';

/** Port of the ItemListPanel.cs 895-898 thresholds: > 15 happy, > 0 neutral,
 * > -15 sad, else angry. */
export function approvalMood(rating: number): ApprovalMood {
    if (rating > 15.0) return 'happy';
    if (rating > 0.0) return 'neutral';
    if (!(rating > -15.0)) return 'angry';
    return 'sad';
}

/** C# .ToString("0,K"): divide by 1000, round, append a literal 'K'
 * (1234567 -> '1235K', 0 -> '0K'). */
export function formatThousandsK(v: number): string {
    return `${Math.round(v / 1000)}K`;
}

/** Per-colony metrics read from the sim (task 13b). */
export interface ColonyMetrics {
    development: number;
    approval: number;
    revenue: number;
}

/** Impure wrapper around the three sim getters for one colony:
 * DevelopmentLevel (developmentLevel.ts), EmpireApprovalRating (taxes.ts) and
 * AnnualRevenue (forceStructure.ts). Some sim paths still throw TODO(port),
 * so any exception — or a non-finite value — yields null. */
export function colonyMetrics(galaxy: Galaxy, h: Habitat): ColonyMetrics | null {
    try {
        const development = habitatDevelopmentLevel(h);
        const approval = empireApprovalRating(galaxy, h);
        const revenue = habitatAnnualRevenue(galaxy, h);
        if (!Number.isFinite(development) || !Number.isFinite(approval) || !Number.isFinite(revenue)) {
            return null;
        }
        return { development, approval, revenue };
    } catch {
        return null;
    }
}

/** Rows for the panel: the empire's colonies sorted by population descending
 * (a missing population counts as 0), ties broken by name. With a `metrics`
 * callback the development/approval/GDP columns are filled in; without it
 * they show '—' / null. */
export function colonyRows(
    empire: Empire,
    metrics?: (h: Habitat) => ColonyMetrics | null,
    scenario?: (h: Habitat) => ColonyScenarioInfo | null,
): ColonyRow[] {
    return [...empire.colonies]
        .sort((a, b) => {
            const pa = a.population?.totalAmount ?? 0;
            const pb = b.population?.totalAmount ?? 0;
            if (pa !== pb) return pb - pa;
            return a.name.localeCompare(b.name);
        })
        .map((h) => {
            const m = metrics ? metrics(h) : null;
            const s = scenario ? scenario(h) : null;
            return {
                habitat: h,
                name: h.name,
                population: formatPopulation(h.population?.totalAmount ?? 0),
                isCapital: empire.capital === h,
                development: m ? `${Math.trunc(m.development)}%` : '—',
                approval: m ? approvalMood(m.approval) : null,
                gdp: m ? formatThousandsK(m.revenue) : '—',
                tax: `${Math.round((h.taxRate ?? 0) * 100)}%`,
                troops: String(h.troops?.count ?? 0),
                shortage: s?.shortage ?? null,
                approvalBreakdown: s !== null && s.approvalBreakdown.length > 0 ? s.approvalBreakdown.map((l) => `${l.label} ${l.value.toFixed(1)}`).join('\n') : null,
            };
        });
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

    // Column headers, same grid as the rows (Name | Population | Dev. | Approval | GDP | Tax | Troops).
    const header = document.createElement('div');
    header.className = 'colonies-list-header';
    const hName = document.createElement('span');
    hName.className = 'colonies-list-header-cell';
    hName.textContent = 'Name';
    for (const [text, cls] of [
        ['Population', 'colonies-list-header-population'],
        ['Dev.', 'colonies-list-header-number'],
        ['Approval', 'colonies-list-header-approval'],
        ['GDP', 'colonies-list-header-number'],
        ['Tax', 'colonies-list-header-number'],
        ['Troops', 'colonies-list-header-number'],
    ] as const) {
        const cell = document.createElement('span');
        cell.className = `colonies-list-header-cell ${cls}`;
        cell.textContent = text;
        header.appendChild(cell);
    }
    header.prepend(hName);
    body.appendChild(header);

    for (const row of colonyRows(opts.empire, (h) => colonyMetrics(opts.empire.galaxy, h), (h) => colonyScenarioInfo(opts.empire.galaxy, h))) {
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
        if (row.shortage !== null) {
            // Mod layer (19d2): shortage marker, lost luxuries in the tooltip.
            const tag = document.createElement('span');
            tag.className = 'colonies-list-shortage-tag';
            tag.textContent = 'shortage';
            tag.title = row.shortage;
            name.appendChild(tag);
        }

        const pop = document.createElement('span');
        pop.className = 'colonies-list-population';
        pop.textContent = row.population;

        const dev = document.createElement('span');
        dev.className = 'colonies-list-number';
        dev.textContent = row.development;

        const approval = document.createElement('span');
        approval.className = 'colonies-list-approval';
        if (row.approval) {
            const img = document.createElement('img');
            img.className = 'colonies-list-approval-icon';
            img.src = `/assets/dwu/images/ui/chrome/${row.approval}.png`;
            img.alt = row.approval;
            img.title = row.approvalBreakdown !== null ? `${row.approval}\n${row.approvalBreakdown}` : row.approval;
            img.draggable = false;
            approval.appendChild(img);
        }

        const gdp = document.createElement('span');
        gdp.className = 'colonies-list-number';
        gdp.textContent = row.gdp;

        const tax = document.createElement('span');
        tax.className = 'colonies-list-number';
        tax.textContent = row.tax;

        const troops = document.createElement('span');
        troops.className = 'colonies-list-number';
        troops.textContent = row.troops;

        line.append(name, pop, dev, approval, gdp, tax, troops);
        // [emergent] begin — 19d1 internal politics: the governor's loyalty as the name tooltip (flag on only)
        const governor = governorLoyaltyText(opts.empire.galaxy, row.habitat);
        if (governor !== null) name.title = `Governor ${governor}`;
        // [emergent] end
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