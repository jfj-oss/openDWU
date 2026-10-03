// Scenario 19c — chartered companies UI (tasks/19c-chartered-companies.md §8): the Charters screen (the player's
// companies with Renew / Release / Nationalise), the charter dialog (target summary, fee, kind, tariff, duration,
// expedition preview → Confirm), and the "Charter a company…" button for a selected planet. Not a port (no C# screen).
// Every sim change goes through a player command (player/playerOps.ts charter* ops) so the command log replays it.
// Pure model builders (charterRows, charterDialogModel, charterButtonState) are unit-tested; the DOM only wires them.

import { abundancePercentText } from '../resourceAbundance';
import './charters.css';
import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { HabitatCategoryType } from '../../sim/types';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { designsFindNewestCanBuild } from '../../sim/forceStructure';
import { scenarioFlag, scenarioParam } from '../../sim/scenario/state';
import { militaryPotency } from '../../sim/diplomacyTick';
import {
    CHARTER_FLAG,
    charterEligibility,
    charterFee,
    charterOfCompany,
    charterYearsLeft,
    chartersOf,
    defaultCharterTerms,
    empireById,
    estimatedTribute,
    isRimWorld,
    type Charter,
    type CharterKind,
} from '../../sim/scenario/charteredCompanies/charters';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { showToast } from '../toast';
import { requestSimRefresh } from '../../simworker/refresh';

// ---------------------------------------------------------------------------------------------------------------
// Pure models
// ---------------------------------------------------------------------------------------------------------------

export interface CharterRow {
    charter: Charter;
    company: Empire | null;
    name: string;
    capitalName: string;
    colonies: number;
    kindLabel: string;
    status: string;
    yearsLeft: number;
    tariffPct: number;
    tariffThisYear: number;
    tariffLastYear: number;
    tariffTotal: number;
    tribute: number;
    /** Company military potency / the founder's (Empire.cs 1576 MilitaryPotency); 0 when the founder has none. */
    strengthRatio: number;
    /** Renew / Release / Nationalise are possible (active charter, company alive). */
    actionable: boolean;
}

const kindLabel = (k: CharterKind): string => (k === 'dominion' ? 'Dominion' : 'Protectorate');

/** The Charters screen rows: the founder's charters, active first, then by charter order. */
export function charterRows(galaxy: Galaxy, founder: Empire): CharterRow[] {
    const fp = militaryPotency(founder);
    const rows = chartersOf(galaxy, founder).map((c) => {
        const company = empireById(galaxy, c.companyId);
        const alive = company !== null && company.active;
        return {
            charter: c,
            company,
            name: company?.name ?? `Company #${c.companyId}`,
            capitalName: company?.capital?.name ?? galaxy.habitats[c.targetIndex]?.name ?? '',
            colonies: alive ? company.colonies.length : 0,
            kindLabel: kindLabel(c.kind),
            status: c.status,
            yearsLeft: charterYearsLeft(galaxy, c),
            tariffPct: c.tariffPct,
            tariffThisYear: c.tariffThisYear,
            tariffLastYear: c.tariffLastYear,
            tariffTotal: c.tariffTotal,
            tribute: alive ? estimatedTribute(galaxy, company) : 0,
            strengthRatio: alive && fp > 0 ? militaryPotency(company) / fp : 0,
            actionable: alive && c.status === 'active',
        };
    });
    return rows.sort((a, b) => Number(b.actionable) - Number(a.actionable));
}

export interface CharterDialogModel {
    targetName: string;
    typeLabel: string;
    quality: number;
    rim: boolean;
    resources: { resourceId: number; name: string; abundance: number }[];
    fee: number;
    treasury: number;
    eligible: boolean;
    reason: string;
    defaults: { kind: CharterKind; tariffPct: number; durationYears: number };
    /** Expedition preview: ship role and design name per ship (a role without a design is left out). */
    expedition: { role: string; design: string }[];
}

const ROLE_ORDER: [string, BuiltObjectSubRole, BuiltObjectSubRole | null][] = [
    ['Colony ship', BuiltObjectSubRole.ColonyShip, null],
    ['Construction ship', BuiltObjectSubRole.ConstructionShip, null],
    ['Escort', BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate],
    ['Freighter', BuiltObjectSubRole.SmallFreighter, BuiltObjectSubRole.MediumFreighter],
];

/** The dialog model for chartering `target` (founder's race designs preview the expedition). */
export function charterDialogModel(galaxy: Galaxy, founder: Empire, target: Habitat, resourceName: (id: number) => string = (id) => `#${id}`): CharterDialogModel {
    const el = charterEligibility(galaxy, founder, target);
    const counts: Record<string, number> = {
        'Colony ship': 1,
        'Construction ship': 1,
        Escort: Math.trunc(scenarioParam(galaxy, 'companyEscorts', 3)),
        Freighter: Math.trunc(scenarioParam(galaxy, 'companyFreighters', 2)),
    };
    const expedition: { role: string; design: string }[] = [];
    for (const [role, sub, fb] of ROLE_ORDER) {
        const d = designsFindNewestCanBuild(founder.designs, sub) ?? (fb !== null ? designsFindNewestCanBuild(founder.designs, fb) : null);
        if (d === null) continue;
        for (let i = 0; i < counts[role]; i++) expedition.push({ role, design: d.name });
    }
    return {
        targetName: target.name,
        typeLabel: target.category === HabitatCategoryType.Moon ? 'Moon' : 'Planet',
        quality: target.quality,
        rim: isRimWorld(galaxy, target),
        resources: target.resources.map((r) => ({ resourceId: r.resourceId, name: resourceName(r.resourceId), abundance: r.abundance })),
        fee: charterFee(galaxy),
        treasury: founder.stateMoney,
        eligible: el.ok,
        reason: el.reason,
        defaults: defaultCharterTerms(galaxy),
        expedition,
    };
}

/** The selection panel's charter button: hidden without the flag or for a non-planet; disabled with the reason. */
export function charterButtonState(galaxy: Galaxy | null, player: Empire | null, habitat: Habitat | null): { visible: boolean; enabled: boolean; title: string } {
    if (galaxy === null || player === null || habitat === null || !scenarioFlag(galaxy, CHARTER_FLAG)) return { visible: false, enabled: false, title: '' };
    if (habitat.category !== HabitatCategoryType.Planet && habitat.category !== HabitatCategoryType.Moon) return { visible: false, enabled: false, title: '' };
    const el = charterEligibility(galaxy, player, habitat);
    return { visible: true, enabled: el.ok, title: el.ok ? 'Charter a company to settle this world' : el.reason };
}

/** "Company of <founder>" tag for the Empires list ('' for a non-company). */
export function companyTag(galaxy: Galaxy, e: Empire): string {
    if (!scenarioFlag(galaxy, CHARTER_FLAG)) return '';
    const c = charterOfCompany(galaxy, e);
    if (c === null) return '';
    const f = empireById(galaxy, c.founderId);
    return f !== null ? `Company of ${f.name}` : 'Company';
}

/** Diplomacy screen header line for a company ('' for a non-company or with the flag off). */
export function companyHeaderLine(galaxy: Galaxy, company: Empire): string {
    if (!scenarioFlag(galaxy, CHARTER_FLAG)) return '';
    const c = charterOfCompany(galaxy, company);
    if (c === null) return '';
    const f = empireById(galaxy, c.founderId);
    const by = f !== null ? f.name : 'a vanished empire';
    if (c.status !== 'active') return `Chartered by ${by} (charter ${c.status})`;
    const n = charterYearsLeft(galaxy, c);
    return `Chartered by ${by}, expires in ${n} year${n === 1 ? '' : 's'}, tariff ${c.tariffPct} %`;
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

interface Panel {
    root: HTMLElement;
    close: () => void;
}

function makePanel(title: string, wide: boolean, onClose: () => void): { root: HTMLElement; body: HTMLElement; close: () => void } {
    const root = el('div', 'charters-wrap');
    const win = el('div', wide ? 'charters-window charters-window-wide' : 'charters-window');
    const bar = el('div', 'charters-titlebar');
    bar.append(el('div', 'charters-heading', title));
    const x = el('button', 'charters-close', '✕');
    x.type = 'button';
    x.title = 'Close';
    bar.append(x);
    const body = el('div', 'charters-body');
    win.append(bar, body);
    root.append(win);
    document.body.append(root);
    const onKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
    };
    function close(): void {
        document.removeEventListener('keydown', onKey);
        root.remove();
        onClose();
    }
    document.addEventListener('keydown', onKey);
    x.addEventListener('click', () => close());
    return { root, body, close };
}

let screen: (Panel & { timer: number }) | null = null;
let dialog: Panel | null = null;

/** Open (or close, when open) the Charters screen for the player. */
export function toggleChartersScreen(galaxy: Galaxy, player: Empire): void {
    if (screen !== null) {
        screen.close();
        return;
    }
    const p = makePanel('Charters', true, () => {
        if (screen !== null) window.clearInterval(screen.timer);
        screen = null;
    });
    const table = el('div', 'charters-table');
    const empty = el('div', 'charters-empty', 'No companies chartered. Select an unowned, explored planet and choose "Charter a company…".');
    p.body.append(table, empty);
    const head = ['Company', 'Capital', 'Col.', 'Kind', 'Status', 'Years', 'Tariff', 'This yr', 'Last yr', 'Tribute/yr', 'Strength', ''];
    const confirmAct = (label: string, company: Empire, op: 'charterRenew' | 'charterRelease' | 'charterNationalise'): void => {
        if (op !== 'charterRenew' && !window.confirm(`${label} the ${company.name}?`)) return;
        issuePlayerCommand(galaxy, player, op, [company], (ok) => {
            showToast(ok ? `${label}: ${company.name}` : `${label} failed`);
            render();
        });
    };
    function render(): void {
        const rows = charterRows(galaxy, player);
        empty.hidden = rows.length > 0;
        table.hidden = rows.length === 0;
        table.replaceChildren(...head.map((h) => el('span', 'charters-th', h)));
        for (const r of rows) {
            const cells = [
                r.name,
                r.capitalName,
                String(r.colonies),
                r.kindLabel,
                r.status,
                r.actionable ? String(r.yearsLeft) : '–',
                `${r.tariffPct}%`,
                fmt(r.tariffThisYear),
                fmt(r.tariffLastYear),
                fmt(r.tribute),
                r.actionable ? `${Math.round(r.strengthRatio * 100)}%` : '–',
            ];
            for (const c of cells) table.append(el('span', r.actionable ? 'charters-td' : 'charters-td charters-inactive', c));
            const acts = el('span', 'charters-td charters-actions');
            if (r.actionable && r.company !== null) {
                const company = r.company;
                for (const [label, op] of [
                    ['Renew', 'charterRenew'],
                    ['Release', 'charterRelease'],
                    ['Nationalise', 'charterNationalise'],
                ] as const) {
                    const b = el('button', 'charters-btn', label);
                    b.type = 'button';
                    b.addEventListener('click', () => confirmAct(label, company, op));
                    acts.append(b);
                }
            }
            table.append(acts);
        }
    }
    render();
    // Figures change with the sim; refresh in place every 2 s (buttons are rebuilt only then).
    // Worker mode: bring what the screen shows up to date now instead of up to a cold cycle later (no-op in-thread).
    requestSimRefresh(galaxy, [player], () => {
        if (p.root.isConnected) render();
    });
    const timer = window.setInterval(() => {
        if (!p.root.isConnected) return;
        render();
    }, 2000);
    screen = { root: p.root, close: p.close, timer };
}

/** Open the charter dialog for `target`. */
export function openCharterDialog(galaxy: Galaxy, player: Empire, target: Habitat, resourceName?: (id: number) => string): void {
    dialog?.close();
    const m = charterDialogModel(galaxy, player, target, resourceName);
    const p = makePanel(`Charter a company — ${m.targetName}`, false, () => (dialog = null));
    const info = el('div', 'charters-info');
    const line = (k: string, v: string): void => {
        const row = el('div', 'charters-kv');
        row.append(el('span', 'charters-k', k), el('span', 'charters-v', v));
        info.append(row);
    };
    line('World', `${m.typeLabel}, quality ${Math.round(m.quality * 100)}%${m.rim ? ' — rim world' : ''}`);
    line('Resources', m.resources.length > 0 ? m.resources.map((r) => `${r.name} (${abundancePercentText(r.abundance)})`).join(', ') : 'none');
    line('Charter fee', `${fmt(m.fee)} (treasury ${fmt(m.treasury)})`);
    p.body.append(info);

    const form = el('div', 'charters-form');
    const kindSel = el('select', 'charters-input');
    for (const [v, t] of [
        ['dominion', 'Dominion — tribute + tariff'],
        ['protectorate', 'Protectorate — tariff only, defence obligation'],
    ]) {
        const o = el('option', '', t);
        o.value = v;
        kindSel.append(o);
    }
    kindSel.value = m.defaults.kind;
    const tariff = el('input', 'charters-input');
    tariff.type = 'range';
    tariff.min = '0';
    tariff.max = '50';
    tariff.value = String(m.defaults.tariffPct);
    const tariffOut = el('span', 'charters-v', `${m.defaults.tariffPct}%`);
    tariff.addEventListener('input', () => (tariffOut.textContent = `${tariff.value}%`));
    const dur = el('input', 'charters-input charters-num');
    dur.type = 'number';
    dur.min = '1';
    dur.max = '100';
    dur.value = String(m.defaults.durationYears);
    const durQuick = el('span', 'charters-quick');
    for (const y of [10, 20, 30]) {
        const b = el('button', 'charters-btn', `${y}`);
        b.type = 'button';
        b.addEventListener('click', () => (dur.value = String(y)));
        durQuick.append(b);
    }
    const row = (label: string, ...children: HTMLElement[]): void => {
        const r = el('div', 'charters-kv');
        const v = el('span', 'charters-v');
        v.append(...children);
        r.append(el('span', 'charters-k', label), v);
        form.append(r);
    };
    row('Relation', kindSel);
    row('Tariff on sales', tariff, tariffOut);
    row('Duration (years)', dur, durQuick);
    p.body.append(form);

    const exp = el('div', 'charters-expedition');
    exp.append(el('div', 'charters-k', 'Expedition'));
    const counts = new Map<string, { design: string; n: number }>();
    for (const s of m.expedition) {
        const c = counts.get(s.role);
        if (c !== undefined) c.n++;
        else counts.set(s.role, { design: s.design, n: 1 });
    }
    for (const [role, c] of counts) exp.append(el('div', 'charters-v', `${c.n} × ${role} (${c.design})`));
    p.body.append(exp);

    const footer = el('div', 'charters-footer');
    const reason = el('span', 'charters-reason', m.eligible ? '' : m.reason);
    const ok = el('button', 'charters-btn charters-confirm', 'Confirm charter');
    ok.type = 'button';
    ok.disabled = !m.eligible;
    ok.addEventListener('click', () => {
        const terms = { kind: kindSel.value as CharterKind, tariffPct: Number(tariff.value), durationYears: Math.max(1, Math.min(100, Math.trunc(Number(dur.value) || m.defaults.durationYears))) };
        issuePlayerCommand(galaxy, player, 'charterCompany', [target, terms], (granted) => {
            const why = charterEligibility(galaxy, player, target).reason;
            showToast(granted ? `Charter granted: the expedition sets out for ${target.name}` : `Charter refused: ${why}`);
        });
        p.close();
    });
    footer.append(reason, ok);
    p.body.append(footer);
    dialog = { root: p.root, close: p.close };
}

/** The selection panel's "Charter a company…" button; `update` shows / enables it for the current selection. */
export function createCharterButton(get: () => { galaxy: Galaxy | null; player: Empire | null; habitat: Habitat | null }, resourceName?: (id: number) => string): { element: HTMLElement; update: () => void } {
    const b = el('button', 'charters-btn charters-select-btn', 'Charter a company…');
    b.type = 'button';
    b.hidden = true;
    b.addEventListener('click', () => {
        const s = get();
        if (s.galaxy !== null && s.player !== null && s.habitat !== null) openCharterDialog(s.galaxy, s.player, s.habitat, resourceName);
    });
    return {
        element: b,
        update: () => {
            const s = get();
            const st = charterButtonState(s.galaxy, s.player, s.habitat);
            b.hidden = !st.visible;
            b.disabled = !st.enabled;
            b.title = st.title;
        },
    };
}

/** Close every charter panel (game teardown). */
export function closeCharterPanels(): void {
    dialog?.close();
    screen?.close();
}
