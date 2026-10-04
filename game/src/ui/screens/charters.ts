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
import { COLORS, FONT, OwGrid, dropDown, glassButton, messageBox, numericUpDown, openOriginalWindow, place, scrollPanel, setText, text, type OriginalWindow } from '../originalWindow';
import { labelledTrackBar } from '../originalWindowControls';

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

/** An original-style ScreenPanel (ui/originalWindow.ts) of the given size; Escape / the close button run `onClose`. */
function makePanel(title: string, id: string, width: number, height: number, onClose: () => void): { root: HTMLElement; body: HTMLElement; win: OriginalWindow; close: () => void } {
    let closed = false;
    const win = openOriginalWindow({
        id,
        title,
        icon: 'diplomacy.png',
        width,
        height,
        noAutoPause: true,
        onClose: () => close(),
    });
    win.root.classList.add('charters-wrap');
    function close(): void {
        if (closed) return;
        closed = true;
        if (!win.closed) win.close();
        onClose();
    }
    return { root: win.root, body: win.body, win, close };
}

let screen: (Panel & { timer: number }) | null = null;
let dialog: Panel | null = null;

/** Open (or close, when open) the Charters screen for the player. */
export function toggleChartersScreen(galaxy: Galaxy, player: Empire): void {
    if (screen !== null) {
        screen.close();
        return;
    }
    const p = makePanel('Charters', 'charters', 1300, 520, () => {
        if (screen !== null) window.clearInterval(screen.timer);
        screen = null;
    });
    const bw = p.win.bodySize.w;
    const bh = p.win.bodySize.h;
    const confirmAct = (label: string, company: Empire, op: 'charterRenew' | 'charterRelease' | 'charterNationalise'): void => {
        const run = (): void => {
            issuePlayerCommand(galaxy, player, op, [company], (ok) => {
                showToast(ok ? `${label}: ${company.name}` : `${label} failed`);
                render();
            });
        };
        if (op === 'charterRenew') run();
        else
            void messageBox({ caption: label, text: `${label} the ${company.name}?`, buttons: ['Yes', 'No'], defaultButton: 'No', icon: 'question' }).then((r) => {
                if (r === 'Yes') run();
            });
    };
    const grid = new OwGrid<CharterRow>({
        key: (r) => r.charter,
        rowHeight: 30,
        fontSize: FONT.normal,
        empty: 'No companies chartered. Select an unowned, explored planet and choose "Charter a company…".',
        rowClass: (r) => (r.actionable ? '' : 'charters-inactive'),
        columns: [
            { id: 'name', header: 'Company', fill: 1.4, render: (r, c) => (c.textContent = r.name) },
            { id: 'capital', header: 'Capital', fill: 1, render: (r, c) => (c.textContent = r.capitalName) },
            { id: 'col', header: 'Col.', width: 50, align: 'right', render: (r, c) => (c.textContent = String(r.colonies)) },
            { id: 'kind', header: 'Kind', width: 105, render: (r, c) => (c.textContent = r.kindLabel) },
            { id: 'status', header: 'Status', width: 90, render: (r, c) => (c.textContent = r.status) },
            { id: 'years', header: 'Years', width: 60, align: 'right', render: (r, c) => (c.textContent = r.actionable ? String(r.yearsLeft) : '–') },
            { id: 'tariff', header: 'Tariff', width: 60, align: 'right', render: (r, c) => (c.textContent = `${r.tariffPct}%`) },
            { id: 'this', header: 'This yr', width: 85, align: 'right', render: (r, c) => (c.textContent = fmt(r.tariffThisYear)) },
            { id: 'last', header: 'Last yr', width: 85, align: 'right', render: (r, c) => (c.textContent = fmt(r.tariffLastYear)) },
            { id: 'tribute', header: 'Tribute/yr', width: 95, align: 'right', render: (r, c) => (c.textContent = fmt(r.tribute)) },
            { id: 'strength', header: 'Strength', width: 80, align: 'right', render: (r, c) => (c.textContent = r.actionable ? `${Math.round(r.strengthRatio * 100)}%` : '–') },
            {
                id: 'actions',
                header: '',
                width: 270,
                render: (r, cell) => {
                    if (!r.actionable || r.company === null) return;
                    const company = r.company;
                    for (const [label, op] of [
                        ['Renew', 'charterRenew'],
                        ['Release', 'charterRelease'],
                        ['Nationalise', 'charterNationalise'],
                    ] as const) {
                        const b = glassButton(label, { size: FONT.tiny, className: 'ow-flow charters-btn', onClick: () => confirmAct(label, company, op) });
                        b.style.marginRight = '4px';
                        cell.append(b);
                    }
                },
            },
        ],
    });
    p.body.appendChild(place(grid.el, 8, 8, bw - 16, bh - 16));
    function render(): void {
        grid.setRows(charterRows(galaxy, player));
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
    const W = 600;
    const p = makePanel(`Charter a company — ${m.targetName}`, 'charter', W, 600, () => (dialog = null));
    const bw = p.win.bodySize.w;
    const bh = p.win.bodySize.h;
    const body = p.body;

    // Target summary: a scrolling block of key / value lines.
    const info = scrollPanel('charters-info');
    place(info, 8, 8, bw - 16, 112);
    const line = (k: string, v: string): void => {
        const row = el('div', 'charters-kv');
        row.append(el('span', 'charters-k', k), el('span', 'charters-v', v));
        info.append(row);
    };
    line('World', `${m.typeLabel}, quality ${Math.round(m.quality * 100)}%${m.rim ? ' — rim world' : ''}`);
    line('Resources', m.resources.length > 0 ? m.resources.map((r) => `${r.name} (${abundancePercentText(r.abundance)})`).join(', ') : 'none');
    line('Charter fee', `${fmt(m.fee)} (treasury ${fmt(m.treasury)})`);
    body.appendChild(info);

    // The terms form (absolute rows, 40 px pitch).
    const label = (t: string, y: number): void => void body.appendChild(place(text(t, { size: FONT.normal, color: COLORS.label }), 14, y + 4));
    const kindOptions = [
        { value: 'dominion', label: 'Dominion — tribute + tariff' },
        { value: 'protectorate', label: 'Protectorate — tariff only, defence obligation' },
    ];
    label('Relation', 132);
    let kindValue: string = m.defaults.kind;
    const kindSel = dropDown(kindOptions, kindValue, (v) => (kindValue = v));
    kindSel.classList.add('charters-input');
    kindSel.style.fontSize = `${FONT.normal}px`;
    body.appendChild(place(kindSel, 190, 132, bw - 190 - 12, 28));

    // Tariff on sales: a LabelledTrackBar, 0..50 % in 1 % steps (labelled every 10 %).
    let tariffValue = Math.max(0, Math.min(50, Math.round(m.defaults.tariffPct)));
    const tariffLabels = Array.from({ length: 51 }, (_, i) => (i % 10 === 0 ? `${i}%` : ''));
    const tariffOut = text(`${tariffValue}%`, { size: FONT.normal, bold: true, color: COLORS.link });
    const tariffBar = labelledTrackBar({
        width: bw - 16 - 70,
        height: 52,
        labelText: 'Tariff on sales',
        labelWidth: 150,
        labels: tariffLabels,
        value: tariffValue,
        size: FONT.normal,
        onChange: (v) => {
            tariffValue = v;
            setText(tariffOut, `${v}%`);
        },
    });
    body.appendChild(place(tariffBar.el, 8, 172));
    body.appendChild(place(tariffOut, bw - 8 - 56, 188));

    label('Duration (years)', 240);
    let durationValue = Math.max(1, Math.min(100, Math.trunc(m.defaults.durationYears) || 1));
    const dur = numericUpDown({ value: durationValue, min: 1, max: 100, size: FONT.normal, onChange: (v) => (durationValue = v) });
    body.appendChild(place(dur.el, 190, 240, 90, 28));
    let bx = 296;
    for (const y of [10, 20, 30]) {
        const b = glassButton(`${y}`, {
            size: FONT.normal,
            onClick: () => {
                durationValue = y;
                dur.setValue(y);
            },
        });
        body.appendChild(place(b, bx, 240, 60, 28));
        bx += 66;
    }

    // Expedition preview.
    const exp = scrollPanel('charters-expedition');
    place(exp, 8, 284, bw - 16, bh - 284 - 58);
    exp.append(el('div', 'charters-k', 'Expedition'));
    const counts = new Map<string, { design: string; n: number }>();
    for (const s of m.expedition) {
        const c = counts.get(s.role);
        if (c !== undefined) c.n++;
        else counts.set(s.role, { design: s.design, n: 1 });
    }
    for (const [role, c] of counts) exp.append(el('div', 'charters-v', `${c.n} × ${role} (${c.design})`));
    body.appendChild(exp);

    const reason = place(text(m.eligible ? '' : m.reason, { size: FONT.normal, color: 'rgb(255, 130, 100)', wrapWidth: bw - 16 - 200 }), 12, bh - 50);
    body.appendChild(reason);
    const ok = glassButton('Confirm charter', {
        size: FONT.normal,
        disabled: !m.eligible,
        onClick: () => {
            const terms = { kind: kindValue as CharterKind, tariffPct: tariffValue, durationYears: Math.max(1, Math.min(100, Math.trunc(durationValue) || m.defaults.durationYears)) };
            issuePlayerCommand(galaxy, player, 'charterCompany', [target, terms], (granted) => {
                // (A sim-worker order that never reached the game leaves the target eligible: no reason of its own.)
                const why = charterEligibility(galaxy, player, target).reason || 'the order could not be carried out';
                showToast(granted ? `Charter granted: the expedition sets out for ${target.name}` : `Charter refused: ${why}`);
            });
            p.close();
        },
    });
    body.appendChild(place(ok, bw - 8 - 190, bh - 46, 190, 36));
    dialog = { root: p.root, close: p.close };
}

/** The selection panel's "Charter a company…" button; `update` shows / enables it for the current selection. */
export function createCharterButton(get: () => { galaxy: Galaxy | null; player: Empire | null; habitat: Habitat | null }, resourceName?: (id: number) => string): { element: HTMLElement; update: () => void } {
    const b = glassButton('Charter a company…', {
        size: FONT.tiny,
        className: 'ow-flow charters-btn charters-select-btn',
        onClick: () => {
            const s = get();
            if (s.galaxy !== null && s.player !== null && s.habitat !== null) openCharterDialog(s.galaxy, s.player, s.habitat, resourceName);
        },
    });
    b.hidden = true;
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
