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
import { flowTableRows, hubTableRows, pairTableRows } from '../freightText';
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
    if (ledgerStart === null) return 'Not recording: turn on Freight Flows or Trade Hubs.';
    const days = Math.max(0, Math.floor(((now - ledgerStart) / MONTH_LENGTH) * 30));
    if (now - ledgerStart >= months * MONTH_LENGTH) return '';
    return `Collecting for ${days} day${days === 1 ? '' : 's'} (since the overlay was turned on or the game loaded). Values are contracted, not delivered.`;
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
        ov.filter = {
            categoryOf,
            category: catSel.value === '' ? null : catSel.value,
            empire: empSel.value === 'mine' ? opts.playerEmpire : null,
        };
        ov.windowMonths = Number(winSel.value) || 12;
        ov.invalidate();
    }

    function refresh(): void {
        const now = galaxyStarDate(galaxy);
        const months = Number(winSel.value) || 12;
        const empire = empSel.value === 'mine' ? opts.playerEmpire : null;
        const ledger = tradeFlowLedger(galaxy);
        note.textContent = collectingNote(ledger?.startStarDate ?? null, now, months);
        const rows = ledger !== null ? flowsInWindow(ledger, now, months, { categoryOf, category: catSel.value === '' ? null : catSel.value, empire }, 'system') : [];
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
            hubTableRows(galaxy, hubsInWindow(galaxy, now, { empire })).map((h) => ({ cells: [h.name, h.owner, h.income], x: h.x, y: h.y })),
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

/** Mount the small colour legend for the Freight Flows overlay; returns its teardown. */
export function mountFreightLegend(state: MapOverlayState, onOpenPanel: () => void): () => void {
    const box = el('div', 'freight-legend');
    box.appendChild(el('div', 'freight-legend-head', 'Freight flows (width = cr/yr)'));
    for (const c of DEFAULT_FLOW_CATEGORIES) {
        const item = el('div', 'freight-legend-item');
        const sw = el('span', 'trade-flows-swatch');
        sw.style.background = hex(FLOW_COLORS[c.key]);
        item.append(sw, document.createTextNode(c.label));
        box.appendChild(item);
    }
    const more = glassButton('Top routes…', { size: FONT.tiny, className: 'ow-flow freight-legend-more', onClick: onOpenPanel });
    box.appendChild(more);
    document.body.appendChild(box);
    const sync = () => {
        box.style.display = state.freightFlows ? '' : 'none';
    };
    sync();
    const off = onOverlayChange(sync);
    return () => {
        off();
        box.remove();
    };
}
