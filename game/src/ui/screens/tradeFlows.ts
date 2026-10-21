// Task 19e-9: Trade Flows panel + the Freight Flows map legend. NOT a port (DW:U has no such screen): it lists what
// src/sim/logistics/tradeFlows.ts records — top routes (contracts at Empire.4.cs:1135 InitiateContract), top trade
// hubs (BuiltObject.cs:3415 currentYearsIncome) and empire-pair yearly totals (DiplomaticRelation.cs:101
// YearlyTradeValueList). Original-style ScreenPanel (ui/originalWindow.ts); rows refresh in place once a second; Escape closes.
import './tradeFlows.css';
import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import { galaxyStarDate } from '../../sim/tick/simTime';
import {
    DEFAULT_FLOW_CATEGORIES,
    MONTH_LENGTH,
    empirePairTotals,
    flowCategory,
    flowsInWindow,
    hubsInWindow,
    tradeFlowLedger,
} from '../../sim/logistics/tradeFlows';
import { flowColor, FLOW_COLORS, type FreightOverlay } from '../../render/freightOverlay';
import { flowTableRows, formatCredits, hubTableRows, pairTableRows } from '../freightText';
import { resourceIconPath } from '../resourceIcons';
import { onSettingsChange, uiScaleFactor } from '../settings';
import { topClearancePx } from '../hudFit';
import { onOverlayChange, type MapOverlayState } from '../mapOverlays';
import { FONT, dropDown, glassButton, openOriginalWindow, place, scrollPanel } from '../originalWindow';

export interface TradeFlowsOptions {
    galaxy: Galaxy;
    playerEmpire: Empire | null;
    /** The Main View's overlay (filter / window / recording), when a view is up. */
    overlay: () => FreightOverlay | null;
    /** Centre the map on a world point (main.ts: camera.centerOn). */
    jumpTo: (x: number, y: number) => void;
}

/** Panel windows: ~30 days and a year. */
export const TRADE_FLOW_WINDOWS: ReadonlyArray<{ months: number; label: string }> = [
    { months: 1, label: '30 days' },
    { months: 12, label: '1 year' },
];

/** "collecting since load" note: shown while the ledger is younger than the chosen window. */
export function collectingNote(ledgerStart: number | null, now: number, months: number): string {
    if (ledgerStart === null) return 'Loading the recorded trade…';
    const days = Math.max(0, Math.floor(((now - ledgerStart) / MONTH_LENGTH) * 30));
    if (now - ledgerStart >= months * MONTH_LENGTH) return '';
    return `Collecting for ${days} day${days === 1 ? '' : 's'} (since the game started or was loaded). Values are contracted, not delivered.`;
}

interface OpenState {
    close: () => void;
}
let open: OpenState | null = null;

export function toggleTradeFlows(opts: TradeFlowsOptions): void {
    if (open !== null) open.close();
    else open = createTradeFlows(opts);
}

export function openTradeFlows(opts: TradeFlowsOptions): void {
    if (open === null) open = createTradeFlows(opts);
}

export function closeTradeFlows(): void {
    open?.close();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function hex(c: number): string {
    return `#${c.toString(16).padStart(6, '0')}`;
}

/** A table whose row elements are reused on refresh (no rebuild of clickable DOM each tick). */
class RowPool {
    readonly body: HTMLElement;
    private rows: Array<{ root: HTMLElement; cells: HTMLElement[]; swatch: HTMLElement | null; x: number; y: number }> = [];
    constructor(
        parent: HTMLElement,
        title: string,
        private headers: string[],
        private swatch: boolean,
        private onClick: (x: number, y: number) => void,
    ) {
        parent.appendChild(el('div', 'trade-flows-section-head', title));
        const head = el('div', `trade-flows-row trade-flows-header cols-${headers.length}${swatch ? ' has-swatch' : ''}`);
        if (swatch) head.appendChild(el('span', 'trade-flows-swatch blank'));
        for (const h of headers) head.appendChild(el('span', 'trade-flows-cell', h));
        parent.appendChild(head);
        this.body = el('div', 'trade-flows-rows');
        parent.appendChild(this.body);
    }
    set(data: Array<{ cells: string[]; color?: string; x: number; y: number; title?: string; mine?: boolean }>, empty: string): void {
        while (this.rows.length < data.length) {
            const root = el('div', `trade-flows-row cols-${this.headers.length}${this.swatch ? ' has-swatch' : ''}`);
            const sw = this.swatch ? el('span', 'trade-flows-swatch') : null;
            if (sw !== null) root.appendChild(sw);
            const cells = this.headers.map(() => el('span', 'trade-flows-cell'));
            root.append(...cells);
            const entry = { root, cells, swatch: sw, x: 0, y: 0 };
            root.addEventListener('click', () => {
                if (Number.isFinite(entry.x)) this.onClick(entry.x, entry.y);
            });
            this.body.appendChild(root);
            this.rows.push(entry);
        }
        for (let i = 0; i < this.rows.length; i++) {
            const r = this.rows[i];
            const d = data[i];
            r.root.style.display = d === undefined ? 'none' : '';
            if (d === undefined) continue;
            for (let c = 0; c < r.cells.length; c++) if (r.cells[c].textContent !== d.cells[c]) r.cells[c].textContent = d.cells[c];
            if (r.swatch !== null && d.color !== undefined) r.swatch.style.background = d.color;
            r.root.title = d.title ?? '';
            r.root.classList.toggle('mine', d.mine === true);
            r.root.classList.toggle('clickable', Number.isFinite(d.x));
            r.x = d.x;
            r.y = d.y;
        }
        this.body.dataset.empty = data.length === 0 ? empty : '';
    }
}

function createTradeFlows(opts: TradeFlowsOptions): OpenState {
    const { galaxy } = opts;
    // Original-style ScreenPanel (ui/originalWindow.ts); does not pause the game.
    const owin = openOriginalWindow({
        id: 'tradeflows',
        title: 'Trade Flows',
        icon: 'diplomacy.png',
        width: 640,
        height: 760,
        noAutoPause: true,
        onClose: () => close(),
    });
    const root = owin.root;
    root.classList.add('trade-flows-wrap');
    const bw = owin.bodySize.w;
    const bh = owin.bodySize.h;

    // Filters.
    const ov0 = opts.overlay();
    const catSel = dropDown([{ value: '', label: 'All goods' }, ...DEFAULT_FLOW_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))], ov0?.filter.category ?? '', () => {}, 'Goods');
    catSel.setAttribute('aria-label', 'Goods');
    const empSel = dropDown([{ value: 'all', label: 'All empires' }, ...(opts.playerEmpire !== null ? [{ value: 'mine', label: 'My empire' }] : [])], ov0?.filter.empire != null ? 'mine' : 'all', () => {}, 'Empire');
    empSel.setAttribute('aria-label', 'Empire');
    const winSel = dropDown(TRADE_FLOW_WINDOWS.map((w) => ({ value: String(w.months), label: w.label })), String(ov0?.windowMonths ?? 12), () => {}, 'Window');
    winSel.setAttribute('aria-label', 'Window');
    const fw = Math.floor((bw - 16 - 12) / 3);
    owin.body.append(place(catSel, 8, 8, fw, 28), place(empSel, 8 + fw + 6, 8, fw, 28), place(winSel, 8 + 2 * (fw + 6), 8, fw, 28));
    for (const s of [catSel, empSel, winSel]) s.style.fontSize = `${FONT.normal}px`;

    // Everything below the filters scrolls.
    const body = scrollPanel('trade-flows-body');
    place(body, 8, 44, bw - 16, bh - 52);
    owin.body.appendChild(body);

    // Legend.
    const legend = el('div', 'trade-flows-legend');
    for (const c of DEFAULT_FLOW_CATEGORIES) {
        const item = el('span', 'trade-flows-legend-item');
        const sw = el('span', 'trade-flows-swatch');
        sw.style.background = hex(FLOW_COLORS[c.key]);
        item.append(sw, document.createTextNode(c.label));
        legend.appendChild(item);
    }
    body.appendChild(legend);
    const note = el('div', 'trade-flows-note');
    body.appendChild(note);

    const jump = (x: number, y: number) => opts.jumpTo(x, y);
    const flowsT = new RowPool(body, 'Top routes', ['Route', 'Goods', 'cr/yr', 'Contracts'], true, jump);
    const hubsT = new RowPool(body, 'Trade hubs (income this year)', ['Port', 'Owner', 'Income'], false, jump);
    const pairsT = new RowPool(body, 'Empire trade this year', ['Empire', 'Empire', 'Value'], false, () => {});

    const categoryOf = (r: number, c: number) => flowCategory(galaxy, r, c);
    function applyFilters(): void {
        const ov = opts.overlay();
        if (ov === null) return;
        const category = catSel.value === '' ? null : catSel.value;
        ov.filter = {
            categoryOf,
            category,
            resourceId: category === (ov.filter.category ?? null) ? (ov.filter.resourceId ?? null) : null,
            empire: empSel.value === 'mine' ? opts.playerEmpire : null,
        };
        ov.windowMonths = Number(winSel.value) || 12;
        ov.invalidate();
    }

    function refresh(): void {
        // The map legend's cargo toggles set the same filter: follow them.
        const ovNow = opts.overlay();
        if (ovNow !== null && catSel.value !== (ovNow.filter.category ?? '')) catSel.value = ovNow.filter.category ?? '';
        const now = galaxyStarDate(galaxy);
        const months = Number(winSel.value) || 12;
        const empire = empSel.value === 'mine' ? opts.playerEmpire : null;
        const ledger = tradeFlowLedger(galaxy);
        note.textContent = collectingNote(ledger?.startStarDate ?? null, now, months);
        // Only routes / hubs the viewer knows of (the map overlay's fog rules, freightOverlay.ts).
        const rows = (ledger !== null ? flowsInWindow(ledger, now, months, { categoryOf, category: catSel.value === '' ? null : catSel.value, resourceId: ovNow?.filter.resourceId ?? null, empire }, 'system') : []).filter(
            (r) => ovNow?.rowKnown(r) ?? true,
        );
        flowsT.set(
            flowTableRows(galaxy, rows).map((r, i) => ({
                cells: [r.route, r.goods, r.perYear, String(r.contracts)],
                color: hex(flowColor(rows[i].category)),
                x: r.x,
                y: r.y,
                title: `${r.route}: ${r.value} cr contracted in the window; sellers: ${r.sellers}`,
            })),
            'No contracts recorded yet.',
        );
        hubsT.set(
            hubTableRows(galaxy, hubsInWindow(galaxy, now, { empire }).filter((h) => ovNow?.hubKnown(h) ?? true)).map((h) => ({ cells: [h.name, h.owner, h.income], x: h.x, y: h.y })),
            'No port income this year.',
        );
        pairsT.set(
            pairTableRows(empirePairTotals(galaxy, now), opts.playerEmpire).map((p) => ({ cells: [p.a, p.b, p.value], x: NaN, y: NaN, mine: p.mine })),
            'No trade between empires this year.',
        );
    }

    const ov = opts.overlay();
    if (ov !== null) {
        ov.keepRecording = true;
        ov.syncRecording();
    }
    for (const s of [catSel, empSel, winSel]) {
        s.addEventListener('change', () => {
            applyFilters();
            refresh();
        });
    }
    refresh();
    const timer = window.setInterval(refresh, 1000);

    let closing = false;
    function close(): void {
        if (closing) return;
        closing = true;
        window.clearInterval(timer);
        const o = opts.overlay();
        if (o !== null) {
            o.keepRecording = false;
            o.syncRecording();
        }
        if (!owin.closed) owin.close();
        open = null;
    }
    return { close };
}

// ---------------------------------------------------------------------------
// Map legend (shown while Freight Flows is on)
// ---------------------------------------------------------------------------

/** Resources listed under an expanded cargo row (the largest first). */
export const LEGEND_RESOURCE_ROWS = 10;

/** The legend's head line: how many routes are drawn. */
export function legendShownText(shown: number, known: number, filtered: boolean): string {
    if (shown === 0) return known === 0 ? (filtered ? 'No routes of this cargo recorded' : 'No routes recorded yet') : 'No routes in view';
    return `Top ${shown} route${shown === 1 ? '' : 's'} shown`;
}

/** Where the legend goes (screen px): right of the left sidebar's buttons / open panel, below the top strip, above the
 * selection frame. Read from the HUD's laid-out boxes, so it follows the UI scale. It scales with the UI scale as far
 * as it fits that room (never below 100 %; past that its list scrolls). */
function legendPlace(box: HTMLElement): void {
    const ui = uiScaleFactor();
    let left = 40;
    for (const e of document.querySelectorAll<HTMLElement>('.ls-root .ls-button, .ls-root .ls-panel:not([hidden]) > *')) {
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) left = Math.max(left, Math.ceil(r.right) + 8);
    }
    const w = box.offsetWidth * ui;
    const top = topClearancePx(window.innerWidth, window.innerHeight, ui, left + w) + 4;
    let bottom = window.innerHeight - 8;
    const sel = document.querySelector<HTMLElement>('.sel-frame');
    if (sel !== null) {
        const r = sel.getBoundingClientRect();
        if (r.height > 0 && r.left < left + w) bottom = Math.min(bottom, Math.floor(r.top) - 8);
    }
    const room = Math.max(80, bottom - top);
    const s = Math.max(1, Math.min(ui, room / Math.max(LEGEND_MIN_FIT_PX, box.scrollHeight)));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.transform = s === 1 ? '' : `scale(${s})`;
    box.style.maxHeight = `${room / s}px`;
}

/** The legend's height (layout px) that legendPlace fits at the very least: its rows with a few resources open. */
const LEGEND_MIN_FIT_PX = 300;

/**
 * Mount the Freight Flows legend: the cargo colours as toggles (click a cargo to show only it, again for all; a cargo
 * with resources also lists the resources of it that the visible routes carry, click one to show only it), "Show all",
 * and the "Top routes…" panel button. Returns its teardown.
 */
export function mountFreightLegend(state: MapOverlayState, onOpenPanel: () => void, overlay: () => FreightOverlay | null, galaxy: Galaxy): () => void {
    const box = el('div', 'freight-legend');
    box.appendChild(el('div', 'freight-legend-head', 'Freight flows'));
    const sub = el('div', 'freight-legend-sub', '');
    box.appendChild(sub);
    const cats: Array<{ key: string; row: HTMLElement; list: HTMLElement; listSig: string }> = [];
    for (const c of DEFAULT_FLOW_CATEGORIES) {
        const row = el('div', 'freight-legend-item');
        row.dataset.cat = c.key;
        row.title = `Show only ${c.label.toLowerCase()} freight (click again for all)`;
        const sw = el('span', 'trade-flows-swatch');
        sw.style.background = hex(FLOW_COLORS[c.key]);
        row.append(sw, document.createTextNode(c.label));
        const list = el('div', 'freight-legend-res-list');
        list.hidden = true;
        row.addEventListener('click', () => {
            const ov = overlay();
            if (ov === null) return;
            const cur = ov.filter.category ?? null;
            // A second click on the selected cargo (with no single resource picked) shows every cargo again.
            if (cur === c.key && (ov.filter.resourceId ?? null) === null) ov.setCargoFilter(null);
            else ov.setCargoFilter(c.key);
            sync();
        });
        box.append(row, list);
        cats.push({ key: c.key, row, list, listSig: '' });
    }
    const all = el('div', 'freight-legend-item freight-legend-all', 'Show all');
    all.addEventListener('click', () => {
        overlay()?.setCargoFilter(null);
        sync();
    });
    box.appendChild(all);
    box.appendChild(el('div', 'freight-legend-note', 'Width = cr/yr'));
    const more = glassButton('Top routes…', { size: FONT.tiny, className: 'ow-flow freight-legend-more', onClick: onOpenPanel });
    box.appendChild(more);
    document.body.appendChild(box);

    const resourceRow = (resourceId: number, perYear: number): HTMLElement => {
        const res = galaxy.resourceSystem.byId.get(resourceId);
        const r = el('div', 'freight-legend-res');
        r.dataset.res = String(resourceId);
        const img = document.createElement('img');
        img.className = 'freight-legend-res-icon';
        img.alt = '';
        img.src = resourceIconPath(res?.pictureRef ?? -1);
        img.onerror = () => (img.style.visibility = 'hidden');
        r.append(img, el('span', 'freight-legend-res-name', res?.name ?? `#${resourceId}`), el('span', 'freight-legend-res-value', formatCredits(perYear)));
        r.title = `Show only ${res?.name ?? 'this resource'} (${formatCredits(perYear)} cr/yr on the routes you know)`;
        r.addEventListener('click', (e) => {
            e.stopPropagation();
            const ov = overlay();
            if (ov === null) return;
            const cat = ov.filter.category ?? null;
            if ((ov.filter.resourceId ?? null) === resourceId) ov.setCargoFilter(cat);
            else ov.setCargoFilter(cat, resourceId);
            sync();
        });
        return r;
    };

    const sync = (): void => {
        const on = state.freightFlows;
        box.style.display = on ? '' : 'none';
        if (!on) return;
        const ov = overlay();
        const info = ov?.legendInfo() ?? { shown: 0, known: 0, category: null, resourceId: null };
        const filtered = info.category !== null || info.resourceId !== null;
        const t = legendShownText(info.shown, info.known, filtered);
        if (sub.textContent !== t) sub.textContent = t;
        box.classList.toggle('filtered', filtered);
        all.hidden = !filtered;
        for (const c of cats) {
            const selected = info.category === c.key;
            c.row.classList.toggle('selected', selected);
            c.row.classList.toggle('dimmed', filtered && !selected);
            // The selected cargo lists its resources (components are one row: no per-component list).
            const list = selected && ov !== null && c.key !== 'component' ? ov.resourceBreakdown(c.key).slice(0, LEGEND_RESOURCE_ROWS) : [];
            const sig = list.map((x) => `${x.resourceId}:${Math.round(x.perYear)}`).join(',');
            if (sig !== c.listSig) {
                c.listSig = sig;
                c.list.replaceChildren(...list.map((x) => resourceRow(x.resourceId, x.perYear)));
            }
            c.list.hidden = list.length === 0;
            for (const r of c.list.children) {
                const picked = Number((r as HTMLElement).dataset.res) === info.resourceId;
                r.classList.toggle('selected', picked);
                r.classList.toggle('dimmed', info.resourceId !== null && !picked);
            }
        }
        legendPlace(box);
    };
    sync();
    const off = onOverlayChange(sync);
    const offSettings = onSettingsChange(sync);
    window.addEventListener('resize', sync);
    // The route count / resource list follow the overlay's rebuilds; a light poll while the legend is up.
    const timer = window.setInterval(() => {
        if (state.freightFlows) sync();
    }, 400);
    return () => {
        off();
        offSettings();
        window.removeEventListener('resize', sync);
        window.clearInterval(timer);
        box.remove();
    };
}
