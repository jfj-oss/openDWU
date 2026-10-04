// Improvements "supplyChain": the per-resource supply panel. NOT a port (DW:U has no such screen). A resource row click
// (Colonies screen Cargo / Resources tabs, the Construction Yards "Waiting For" tab, the Empire Summary's "Supply by
// resource" link) opens it: where the resource is produced in the player's empire (mining stations / ships, colonies
// mining their own planet) and held, where it is consumed or needed (colony upkeep, construction, open orders), and its
// main routes — the live contracts carrying it, which "Highlight on map" draws over the Freight Flows overlay (filtered
// to the resource). Data: sim/logistics/supplyChain.ts resourceSupplyView through ui/supplyChainCache.ts (at most once
// a second while open). Built on the shared original-style window (originalWindow.ts); Escape closes.

import './resourceSupply.css';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import type { BuiltObject } from '../../sim/builtObject';
import { ResourceGroup, resourceGroupOf } from '../../sim/resourceSystem';
import type { ResourceConsumer, ResourceProducer, ResourceRoute, ResourceStock, ResourceSupplyView } from '../../sim/logistics/supplyChain';
import type { FreightOverlay } from '../../render/freightOverlay';
import { flowCategory } from '../../sim/logistics/tradeFlows';
import { flowColor } from '../../render/freightOverlay';
import { toggleOverlay, type MapOverlayState } from '../mapOverlays';
import { COLORS, FONT, OwGrid, dropDown, dropText, glassButton, linkLabel, openOriginalWindow, place, setButtonLabel, setText, text, type OriginalWindow } from '../originalWindow';
import { resourceSupply, supplyChainEnabled } from '../supplyChainCache';
import { formatUnits, placeText, resourceName, systemNameOf } from '../supplyChainText';
import { onImprovementsChange } from '../improvements';
import { requestSimRefresh } from '../../simworker/refresh';

/** What the panel needs from the game view (main.ts sets it per view; null when none is up). */
export interface ResourceSupplyHost {
    galaxy: Galaxy;
    /** Select the object and move the view to it. */
    goTo: (target: BuiltObject | Habitat) => void;
    /** Centre the view on a world point. */
    jumpTo: (x: number, y: number) => void;
    freight: () => FreightOverlay | null;
    overlays: MapOverlayState | null;
    /** The Trade Flows panel. */
    openTradeFlows?: () => void;
}

let host: ResourceSupplyHost | null = null;

export function setResourceSupplyHost(h: ResourceSupplyHost | null): void {
    if (h === null) closeResourceSupply();
    host = h;
}

interface OpenState {
    win: OriginalWindow;
    resourceId: number;
    setResource: (id: number) => void;
    close: () => void;
}
let open: OpenState | null = null;

/** Open the panel on `resourceId` (or switch the open one to it). No-op without a game view or with the improvement off. */
export function openResourceSupply(resourceId: number): void {
    if (host === null || !supplyChainEnabled()) return;
    if (open !== null) {
        open.setResource(resourceId);
        document.body.appendChild(open.win.root);
        return;
    }
    open = createResourceSupply(host, resourceId);
}

export function closeResourceSupply(): void {
    open?.close();
}

export function isResourceSupplyOpen(): boolean {
    return open !== null;
}

/** A resource can be clicked through to the panel (a game view is up and the improvement is on). */
export function resourceSupplyAvailable(): boolean {
    return host !== null && supplyChainEnabled();
}

const PRODUCER_KIND: Record<ResourceProducer['kind'], string> = {
    miningStation: 'Mining station',
    gasMiningStation: 'Gas mining station',
    miningShip: 'Mining ship',
    colony: 'Colony (mines its planet)',
};

const REASON: Record<ResourceConsumer['reasons'][number], string> = {
    construction: 'Construction',
    luxury: 'Luxury upkeep',
    strategic: 'Growth upkeep',
    order: 'Open order',
};

/** Rows and texts of one view (pure; tested). */
export function resourceSupplyRows(galaxy: Galaxy, v: ResourceSupplyView) {
    const viewer = galaxy.playerEmpire;
    return {
        producers: v.producers.map((p) => ({
            key: p.obj,
            obj: p.obj,
            name: p.obj.name,
            system: systemNameOf(galaxy, p.obj),
            kind: PRODUCER_KIND[p.kind],
            abundance: `${Math.round(p.abundance / 10)}%`,
            stock: formatUnits(p.stock),
        })),
        stock: v.stock.map((s: ResourceStock) => ({
            key: s.obj,
            obj: s.obj,
            name: s.obj.name,
            system: systemNameOf(galaxy, s.obj),
            amount: formatUnits(s.amount),
            reserved: s.reserved > 0 ? formatUnits(s.reserved) : '',
            amountValue: s.amount,
        })),
        consumers: v.consumers.map((c) => ({
            key: c.obj,
            obj: c.obj,
            name: c.obj.name,
            system: systemNameOf(galaxy, c.obj),
            why: c.reasons.map((r) => REASON[r]).join(', '),
            missing: c.constructionMissing > 0 ? formatUnits(c.constructionMissing) : '',
            ordered: c.ordered > 0 ? formatUnits(c.ordered) : '',
            coming: c.incoming > 0 ? formatUnits(c.incoming) : c.ordered > 0 || c.constructionMissing > 0 ? 'nothing' : '',
            perYear: c.perYear > 0 ? `~${formatUnits(c.perYear)}` : '',
            short: (c.constructionMissing > 0 || c.ordered > 0) && c.incoming <= 0,
        })),
        routes: v.routes.map((r: ResourceRoute) => ({
            key: r.key,
            route: r,
            from: r.from !== null ? placeText(galaxy, r.from, viewer) : '(unknown)',
            to: placeText(galaxy, r.to, viewer),
            amount: formatUnits(r.amount),
            freighters: String(r.freighters),
        })),
    };
}

/** The panel's headline. */
export function resourceSupplySummary(galaxy: Galaxy, v: ResourceSupplyView): string {
    const def = galaxy.resourceSystem.byId.get(v.resourceId);
    const group = def === undefined ? '' : ({ [ResourceGroup.Mineral]: 'Mineral', [ResourceGroup.Gas]: 'Gas', [ResourceGroup.Luxury]: 'Luxury', [ResourceGroup.Undefined]: '' } as Record<number, string>)[resourceGroupOf(def)];
    const tags: string[] = [];
    if (group) tags.push(def!.superLuxuryBonusAmount > 0 ? 'Restricted luxury' : group);
    if (def?.isFuel) tags.push('fuel');
    const short = v.consumers.filter((c) => (c.constructionMissing > 0 || c.ordered > 0) && c.incoming <= 0).length;
    return `${tags.join(', ')}${tags.length ? ' · ' : ''}${formatUnits(v.totalStock)} in stock at ${v.stock.length} place${v.stock.length === 1 ? '' : 's'} · ${v.producers.length} producer${v.producers.length === 1 ? '' : 's'} · needed at ${v.consumers.length}${short > 0 ? ` (${short} with nothing coming)` : ''}`;
}

/** Highlight colour of a resource: its Freight Flows category colour. */
export function resourceHighlightColor(galaxy: Galaxy, resourceId: number): number {
    return flowColor(flowCategory(galaxy, resourceId, -1));
}

function createResourceSupply(h: ResourceSupplyHost, firstResource: number): OpenState {
    const galaxy = h.galaxy;
    let resourceId = firstResource;
    let timer = 0;
    let highlighted = false;
    /** Freight Flows state before "Highlight on map" turned it on (restored when the highlight ends). */
    let flowsWasOn: boolean | null = null;
    const W = 780;
    const H = 690;
    const iconOf = (id: number): string | undefined => {
        const d = galaxy.resourceSystem.byId.get(id);
        return d !== undefined ? `/assets/dwu/images/ui/resources/Resource_${d.pictureRef}.bmp` : undefined;
    };
    const win = openOriginalWindow({
        id: 'resourcesupply',
        title: '',
        iconUrl: iconOf(firstResource),
        width: W,
        height: H,
        onClose: () => {
            window.clearInterval(timer);
            offImprovements();
            endHighlight();
            open = null;
        },
    });
    const body = win.body;

    // Header: the resource picker (all resources, by name).
    const all = [...galaxy.resourceSystem.resources].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const picker = dropDown(all.map((r) => ({ value: String(r.resourceId), label: r.name })), String(resourceId), (v) => setResource(Number(v)), 'Resource');
    picker.classList.add('rs-picker');
    if (win.header) win.header.appendChild(place(picker, W - 300, 13, 240, 21));

    const summary = place(text('', { color: COLORS.label, size: FONT.small, wrapWidth: W - 40 }), 10, 6);
    body.appendChild(summary);

    const section = (title: string, x: number, y: number): void => {
        dropText(body, title, x, y, { bold: true, color: COLORS.label, size: FONT.normal });
    };
    const cell = (t: string, c: HTMLDivElement, title = t): void => {
        c.textContent = t;
        c.title = title;
    };
    type ProdRow = ReturnType<typeof resourceSupplyRows>['producers'][number];
    type StockRow = ReturnType<typeof resourceSupplyRows>['stock'][number];
    type ConsRow = ReturnType<typeof resourceSupplyRows>['consumers'][number];
    type RouteRow = ReturnType<typeof resourceSupplyRows>['routes'][number];

    section('Produced at', 10, 30);
    const prodGrid = new OwGrid<ProdRow>({
        key: (r) => r.key,
        rowHeight: 20,
        fontSize: FONT.small,
        empty: 'Nothing in your empire mines it',
        columns: [
            { id: 'name', header: 'Source', sort: (r) => r.name, render: (r, c) => cell(r.name, c) },
            { id: 'system', header: 'System', width: 80, sort: (r) => r.system, render: (r, c) => cell(r.system, c) },
            { id: 'kind', header: 'Type', width: 95, sort: (r) => r.kind, render: (r, c) => cell(r.kind, c) },
            { id: 'ab', header: 'Abund.', width: 50, align: 'right', render: (r, c) => cell(r.abundance, c, 'Abundance at the mined habitat') },
            { id: 'stock', header: 'Stock', width: 55, align: 'right', render: (r, c) => cell(r.stock, c, 'Held by the producer') },
        ],
        onDoubleClick: (r) => h.goTo(r.obj),
    });
    body.appendChild(place(prodGrid.el, 10, 50, 380, 200));

    section('Held at', 400, 30);
    const stockGrid = new OwGrid<StockRow>({
        key: (r) => r.key,
        rowHeight: 20,
        fontSize: FONT.small,
        empty: 'None in stock',
        columns: [
            { id: 'name', header: 'Location', sort: (r) => r.name, render: (r, c) => cell(r.name, c) },
            { id: 'system', header: 'System', width: 90, sort: (r) => r.system, render: (r, c) => cell(r.system, c) },
            { id: 'amount', header: 'Amount', width: 65, align: 'right', sort: (r) => r.amountValue, render: (r, c) => cell(r.amount, c) },
            { id: 'reserved', header: 'Reserved', width: 62, align: 'right', render: (r, c) => cell(r.reserved, c, 'Reserved for construction') },
        ],
        onDoubleClick: (r) => h.goTo(r.obj),
    });
    body.appendChild(place(stockGrid.el, 400, 50, 354, 200));

    section('Consumed or needed at', 10, 258);
    const consGrid = new OwGrid<ConsRow>({
        key: (r) => r.key,
        rowHeight: 20,
        fontSize: FONT.small,
        empty: 'Nothing in your empire needs it now',
        rowClass: (r) => (r.short ? 'rs-short' : ''),
        columns: [
            { id: 'name', header: 'Location', sort: (r) => r.name, render: (r, c) => cell(r.name, c) },
            { id: 'system', header: 'System', width: 95, sort: (r) => r.system, render: (r, c) => cell(r.system, c) },
            { id: 'why', header: 'Why', width: 170, sort: (r) => r.why, render: (r, c) => cell(r.why, c) },
            { id: 'missing', header: 'Missing', width: 65, align: 'right', render: (r, c) => cell(r.missing, c, 'Construction: units not in stock for the queue') },
            { id: 'ordered', header: 'Ordered', width: 65, align: 'right', render: (r, c) => cell(r.ordered, c, 'Open orders: requested − delivered') },
            { id: 'coming', header: 'Coming', width: 65, align: 'right', render: (r, c) => cell(r.coming, c, 'Contracted to freighters, on the way') },
            { id: 'year', header: 'Uses / yr', width: 70, align: 'right', render: (r, c) => cell(r.perYear, c, 'Estimated colony upkeep per game year') },
        ],
        onDoubleClick: (r) => h.goTo(r.obj),
    });
    body.appendChild(place(consGrid.el, 10, 278, 744, 172));

    section('Main routes (contracts on the way)', 10, 458);
    const routeGrid = new OwGrid<RouteRow>({
        key: (r) => r.key,
        rowHeight: 20,
        fontSize: FONT.small,
        empty: 'No freighter is carrying it for your empire now',
        columns: [
            { id: 'from', header: 'From', render: (r, c) => cell(r.from, c) },
            { id: 'to', header: 'To', render: (r, c) => cell(r.to, c) },
            { id: 'amount', header: 'Units', width: 60, align: 'right', render: (r, c) => cell(r.amount, c) },
            { id: 'freighters', header: 'Ships', width: 45, align: 'right', render: (r, c) => cell(r.freighters, c, 'Freighters') },
        ],
        onDoubleClick: (r) => {
            const a = r.route;
            if (Number.isFinite(a.fromX)) h.jumpTo((a.fromX + a.toX) / 2, (a.fromY + a.toY) / 2);
            else h.jumpTo(a.toX, a.toY);
        },
    });
    body.appendChild(place(routeGrid.el, 10, 478, 560, 134));

    const btnHighlight = glassButton('Highlight on map', {
        title: 'Turn on Freight Flows for this resource and draw its live routes',
        onClick: () => (highlighted ? endHighlight() : startHighlight()),
    });
    body.appendChild(place(btnHighlight, 580, 478, 174, 28));
    if (h.openTradeFlows) body.appendChild(place(linkLabel('Trade Flows panel…', () => h.openTradeFlows?.(), FONT.small), 584, 514));
    const recordedNote = place(text('', { color: COLORS.label, size: FONT.tiny, wrapWidth: 174 }), 580, 536);
    body.appendChild(recordedNote);

    let last: ResourceSupplyView | null = null;
    function highlightRoutes(v: ResourceSupplyView): { fromX: number; fromY: number; toX: number; toY: number }[] {
        const out: { fromX: number; fromY: number; toX: number; toY: number }[] = v.routes.filter((r) => Number.isFinite(r.fromX)).map((r) => ({ fromX: r.fromX, fromY: r.fromY, toX: r.toX, toY: r.toY }));
        for (const f of v.recorded ?? []) out.push({ fromX: f.fromX, fromY: f.fromY, toX: f.toX, toY: f.toY });
        return out;
    }
    function startHighlight(): void {
        const fo = h.freight();
        if (fo === null || h.overlays === null) return;
        highlighted = true;
        if (flowsWasOn === null) flowsWasOn = h.overlays.freightFlows;
        fo.filter = { ...fo.filter, resourceId, category: null };
        fo.invalidate();
        if (!h.overlays.freightFlows) toggleOverlay(h.overlays, 'freightFlows');
        if (last !== null) fo.setHighlight({ color: resourceHighlightColor(galaxy, resourceId), routes: highlightRoutes(last) });
        btnHighlight.classList.add('rs-on');
        setButtonLabel(btnHighlight, 'Stop highlighting');
    }
    function endHighlight(): void {
        if (!highlighted) return;
        highlighted = false;
        const fo = h.freight();
        if (fo !== null) {
            fo.setHighlight(null);
            fo.filter = { ...fo.filter, resourceId: null };
            fo.invalidate();
        }
        if (h.overlays !== null && flowsWasOn === false && h.overlays.freightFlows) toggleOverlay(h.overlays, 'freightFlows');
        flowsWasOn = null;
        btnHighlight.classList.remove('rs-on');
        setButtonLabel(btnHighlight, 'Highlight on map');
    }

    const gridKeys = new WeakMap<object, string>();
    function sync<T extends { key: unknown }>(grid: OwGrid<T>, rows: T[], sig: (r: T) => string): void {
        const key = rows.map(sig).join('\n');
        if (gridKeys.get(grid) === key) return;
        gridKeys.set(grid, key);
        const sel = grid.selected;
        grid.setRows(rows);
        if (sel !== null) grid.setSelection([sel.key]);
    }

    function refresh(force = false): void {
        if (win.closed) return;
        const v = resourceSupply(galaxy, resourceId, galaxy.playerEmpire, force);
        if (v === null) {
            win.close();
            return;
        }
        last = v;
        const name = resourceName(galaxy, resourceId);
        win.setTitle(`Resource Supply: ${name}`);
        const icon = iconOf(resourceId);
        if (icon !== undefined) win.setIcon(icon);
        if (picker.value !== String(resourceId)) picker.value = String(resourceId);
        setText(summary, resourceSupplySummary(galaxy, v));
        const rows = resourceSupplyRows(galaxy, v);
        sync(prodGrid, rows.producers, (r) => `${r.name}|${r.system}|${r.kind}|${r.abundance}|${r.stock}`);
        sync(stockGrid, rows.stock, (r) => `${r.name}|${r.amount}|${r.reserved}`);
        sync(consGrid, rows.consumers, (r) => `${r.name}|${r.why}|${r.missing}|${r.ordered}|${r.coming}|${r.perYear}`);
        sync(routeGrid, rows.routes, (r) => `${r.from}|${r.to}|${r.amount}|${r.freighters}`);
        const rec = v.recorded;
        setText(
            recordedNote,
            rec === null
                ? 'Freight Flows records trade over time while it is on; the routes above are the contracts in flight now.'
                : rec.length === 0
                  ? 'Freight Flows: no contracts for it recorded yet.'
                  : `Freight Flows (12 months): ${rec.length} route${rec.length === 1 ? '' : 's'}, top ${Math.round(rec[0].valuePerYear).toLocaleString('en-US')} cr/yr.`,
        );
        if (highlighted) h.freight()?.setHighlight({ color: resourceHighlightColor(galaxy, resourceId), routes: highlightRoutes(v) });
    }

    function setResource(id: number): void {
        if (id === resourceId) return;
        resourceId = id;
        for (const g of [prodGrid, stockGrid, consGrid, routeGrid]) gridKeys.delete(g);
        if (highlighted) {
            const fo = h.freight();
            if (fo !== null) {
                fo.filter = { ...fo.filter, resourceId };
                fo.invalidate();
            }
        }
        refresh(true);
    }

    const offImprovements = onImprovementsChange((id, on) => {
        if (!on && id === 'supplyChain') win.close();
    });
    refresh();
    // Worker mode: bring the empire's cargo / orders up to date now (no-op in-thread).
    const emp = galaxy.playerEmpire;
    if (emp !== null) requestSimRefresh(galaxy, [emp, emp.colonies, emp.privateBuiltObjects], () => refresh(true));
    timer = window.setInterval(() => refresh(), 1000);
    return {
        win,
        get resourceId() {
            return resourceId;
        },
        setResource,
        close: () => win.close(),
    };
}
