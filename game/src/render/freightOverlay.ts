// Task 19e-9: Freight Flows + Trade Hubs map overlays (the private economy made visible). NOT a port: DW:U never
// showed flows. Data: src/sim/logistics/tradeFlows.ts (contracts recorded at Empire.4.cs:1135 InitiateContract;
// port income from BuiltObject.cs:3415 PerformFinancialTransaction). Drawing style follows the travel-vectors
// overlay (task 14c: MainView.2.cs:5069 method_250 overlay pass, BaconMainView.cs:19 method_253 dashed lines).
//
// Performance: the flow rows are re-queried only when the ledger changed and a game-day passed; the geometry is
// rebuilt only then, or when the zoom moves by > 15 % / the camera leaves the padded rect the last build was culled
// against. Nothing is allocated per frame otherwise. In-flight freighter leaders (system zoom only) are rebuilt at
// most every 250 ms.

import { circleAtScreenRes } from './screenCircle';
import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import { fogOf } from './fog';
import { drawnPositionOf, type MotionInterpolator, type Point } from './renderInterp';
import type { Galaxy } from '../sim/galaxy';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { GAME_DAY_LENGTH } from '../sim/scenario/hooks';
import { galaxyStarDate } from '../sim/tick/simTime';
import {
    disableTradeFlowRecording,
    enableTradeFlowRecording,
    flowCategory,
    flowsInWindow,
    hubsInWindow,
    tradeFlowLedger,
    tradeFlowsRemote,
    type FlowCategory,
    type FlowFilter,
    type FlowLevel,
    type FlowRow,
    type HubRow,
    type TradeFlowLedger,
} from '../sim/logistics/tradeFlows';
import type { StellarObject } from '../sim/logistics/contracts';
import { BuiltObject } from '../sim/builtObject';
import { SystemVisibilityStatus } from '../sim/visibility';
import type { MapOverlayState } from '../ui/mapOverlays';
import { scenarioMapFeatures } from '../sim/scenario/mapFeatures';
import { INDEPENDENT_RING_COLOR, toPixiColor } from './empireLayer';
import { dashSegments, TRAVEL_VECTOR_COLOR } from './overlayLayer';
import { localViewerEmpire } from '../localViewer';
import type { FlowShareInfo } from '../ui/freightText';
import { DrawSig } from './drawCache';

/** Category colours (task 19e-9 §8.2; brightened for the rework so each reads over territory shading). Scenario
 * categories carry their own. */
export const FLOW_COLORS: Readonly<Record<string, number>> = {
    mineral: 0xdfe7ef,
    gas: 0x3fd8ff,
    luxury: 0xffc23a,
    restricted: 0xff52c8,
    component: 0x8cff5a,
};

export function flowColor(cat: FlowCategory): number {
    return cat.color ?? FLOW_COLORS[cat.key] ?? 0xffffff;
}

/** Routes drawn at once when the view spans the galaxy (more than FLOW_SECTOR_VIEW_SECTORS sectors across). */
export const FLOW_ROUTES_GALAXY = 15;
/** Routes drawn at once at sector zoom and closer. */
export const FLOW_ROUTES_SECTOR = 25;
/** A view wider than this many sectors (its longer side) counts as galaxy zoom. */
export const FLOW_SECTOR_VIEW_SECTORS = 3;
/** Routes below this share of the largest one drawn are left out. */
export const FLOW_ROUTE_MIN_SHARE = 0.1;
/** Line widths on screen (px), by the route's volume against the largest drawn: not scaled with the zoom. */
export const FLOW_LINE_MIN_PX = 1.5;
export const FLOW_LINE_MAX_PX = 6;
/** The dark halo's width on each side of a line (px). */
export const FLOW_HALO_PX = 1.5;
/** Gap left at each end so the line stops short of the star (px). */
export const FLOW_END_GAP_PX = 7;
/** A route's return leg gets its own arrowhead from this share of the main direction's volume. */
export const FLOW_TWO_WAY_SHARE = 0.25;

/** Window the map overlay shows (months). The panel can pick 1 or 12. */
export const MAP_FLOW_WINDOW_MONTHS = 12;

/** Original's system-zoom gate (MainView.pick / overlayLayer.ts markers: zoom factor 1/z < 70): the in-flight freighter
 * leaders are drawn at system zoom only. */
export function flowLevelForZoom(z: number): FlowLevel {
    return 1 / z < 70 ? 'post' : 'system';
}

/** How many routes (and trade hubs) are drawn for a view `viewW` x `viewH` world units wide. */
export function routeCountForView(viewW: number, viewH: number, sectorSize: number): number {
    return Math.max(viewW, viewH) > FLOW_SECTOR_VIEW_SECTORS * sectorSize ? FLOW_ROUTES_GALAXY : FLOW_ROUTES_SECTOR;
}

export interface ArcGeom {
    x1: number;
    y1: number;
    cx: number;
    cy: number;
    x2: number;
    y2: number;
}

/** Quadratic arc from (x1,y1) to (x2,y2), control point 15 % of the length to the left of travel (screen space, y down)
 * — the supply-chain highlight's routes (they are per direction). */
export function flowArcFor(x1: number, y1: number, x2: number, y2: number): ArcGeom {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return { x1, y1, x2, y2, cx: (x1 + x2) / 2 + 0.15 * dy, cy: (y1 + y2) / 2 - 0.15 * dx };
}

/**
 * One drawn line: both directions between a pair of systems (or deep-space posts). A is the seller end of the larger
 * direction, so the main arrowhead points A → B.
 */
export interface FlowRoute {
    key: string;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    /** System index of each end (-1: a deep-space post). */
    aSystem: number;
    bSystem: number;
    /** The post at each end when it is a single one (deep space, or one post in the system), else null. */
    aPost: StellarObject | null;
    bPost: StellarObject | null;
    /** A → B and B → A rows (null when nothing went that way). */
    ab: FlowRow | null;
    ba: FlowRow | null;
    abPerYear: number;
    baPerYear: number;
    /** abPerYear + baPerYear. */
    total: number;
    /** The larger direction's category (its largest commodity's). */
    category: FlowCategory;
    /** Every commodity carried either way. */
    resourceIds: number[];
}

function rowEnds(row: FlowRow): [string, string] {
    const i = row.key.indexOf('>');
    return [row.key.slice(0, i), row.key.slice(i + 1)];
}

/** Merge the per-direction system rows into one route per unordered end pair, largest total first (ties: key).
 * Zero-length rows (both ends in one system) are dropped. */
export function mergeRouteDirections(rows: readonly FlowRow[]): FlowRoute[] {
    const byPair = new Map<string, FlowRoute>();
    for (const row of rows) {
        const [from, to] = rowEnds(row);
        if (from === to || (row.fromX === row.toX && row.fromY === row.toY)) continue;
        const key = from < to ? `${from}|${to}` : `${to}|${from}`;
        let r = byPair.get(key);
        if (r === undefined) {
            r = {
                key,
                ax: row.fromX,
                ay: row.fromY,
                bx: row.toX,
                by: row.toY,
                aSystem: row.sellerSystem,
                bSystem: row.destSystem,
                aPost: row.sellingPoint,
                bPost: row.destination,
                ab: row,
                ba: null,
                abPerYear: row.valuePerYear,
                baPerYear: 0,
                total: row.valuePerYear,
                category: row.category,
                resourceIds: row.resourceIds.slice(),
            };
            byPair.set(key, r);
            continue;
        }
        // Rows come one per direction: this is the other one.
        r.ba = row;
        r.baPerYear = row.valuePerYear;
        r.total += row.valuePerYear;
        for (const id of row.resourceIds) if (!r.resourceIds.includes(id)) r.resourceIds.push(id);
    }
    const out = [...byPair.values()];
    for (const r of out) {
        if (r.ba !== null && r.baPerYear > r.abPerYear) {
            const ab = r.ab!;
            const ba = r.ba;
            r.ab = ba;
            r.ba = ab;
            r.abPerYear = ba.valuePerYear;
            r.baPerYear = ab.valuePerYear;
            r.ax = ba.fromX;
            r.ay = ba.fromY;
            r.bx = ba.toX;
            r.by = ba.toY;
            r.aSystem = ba.sellerSystem;
            r.bSystem = ba.destSystem;
            r.aPost = ba.sellingPoint;
            r.bPost = ba.destination;
            r.category = ba.category;
        }
    }
    out.sort((x, y) => y.total - x.total || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    return out;
}

/**
 * The routes to draw: the first `n` of `routes` (sorted largest first) that `accept` lets through (the viewer knows
 * both ends, the line crosses the view), less those under `minShare` of the largest one taken.
 */
export function selectTopRoutes(routes: readonly FlowRoute[], n: number, accept: (r: FlowRoute) => boolean, minShare = FLOW_ROUTE_MIN_SHARE): FlowRoute[] {
    const out: FlowRoute[] = [];
    for (const r of routes) {
        if (out.length >= n) break;
        if (r.total <= 0 || !accept(r)) continue;
        if (out.length > 0 && r.total < out[0].total * minShare) break; // sorted: every later one is smaller still
        out.push(r);
    }
    return out;
}

/** Line width in screen px: FLOW_LINE_MIN_PX..FLOW_LINE_MAX_PX by sqrt(volume / the largest drawn). */
export function routeWidthPx(total: number, max: number): number {
    if (!(max > 0)) return FLOW_LINE_MIN_PX;
    const t = Math.sqrt(Math.max(0, Math.min(1, total / max)));
    return FLOW_LINE_MIN_PX + (FLOW_LINE_MAX_PX - FLOW_LINE_MIN_PX) * t;
}

export interface CullRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The part of the segment (x1,y1)-(x2,y2) inside the camera's world rect padded by `padPx` (Liang-Barsky clip), as
 * [t0, t1] along it, or null when it misses the rect. */
export function clipSegmentToView(x1: number, y1: number, x2: number, y2: number, z: number, cam: CullRect, padPx = 0): [number, number] | null {
    const halfW = cam.width / (2 * z) + padPx / z;
    const halfH = cam.height / (2 * z) + padPx / z;
    const dx = x2 - x1;
    const dy = y2 - y1;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - (cam.x - halfW), cam.x + halfW - x1, y1 - (cam.y - halfH), cam.y + halfH - y1];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return null;
            continue;
        }
        const t = q[i] / p[i];
        if (p[i] < 0) {
            if (t > t1) return null;
            if (t > t0) t0 = t;
        } else {
            if (t < t0) return null;
            if (t < t1) t1 = t;
        }
    }
    return [t0, t1];
}

/** Whether the segment (x1,y1)-(x2,y2) crosses the camera's world rect, padded by `padPx`. */
export function segmentInView(x1: number, y1: number, x2: number, y2: number, z: number, cam: CullRect, padPx = 0): boolean {
    return clipSegmentToView(x1, y1, x2, y2, z, cam, padPx) !== null;
}

/** Squared distance from (px, py) to the segment (ax, ay)-(bx, by). */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx - px;
    const qy = ay + t * dy - py;
    return qx * qx + qy * qy;
}

/** Per-resource totals (cr/yr) of the routes `accept` lets through, largest first: the legend's resource list. */
export function resourceTotals(rows: readonly FlowRow[], accept: (row: FlowRow) => boolean): Array<{ resourceId: number; perYear: number }> {
    const m = new Map<number, number>();
    for (const row of rows) {
        if (row.value <= 0 || !accept(row)) continue;
        const k = row.valuePerYear / row.value;
        for (let i = 0; i < row.resourceIds.length; i++) m.set(row.resourceIds[i], (m.get(row.resourceIds[i]) ?? 0) + (row.resourceValues[i] ?? 0) * k);
    }
    return [...m.entries()].map(([resourceId, perYear]) => ({ resourceId, perYear })).sort((a, b) => b.perYear - a.perYear || a.resourceId - b.resourceId);
}

/** Known trade totals (cr/yr) for the tooltip's shares: per cargo category, per resource, per trading post, and all. */
export interface TradeTotals {
    all: number;
    byCategory: Map<string, number>;
    byResource: Map<number, number>;
    /** Per trading post / destination: the trade it sold or received (a contract counts for both its ends). */
    byPost: Map<StellarObject, number>;
}

/** Totals over the rows `accept` lets through (the routes the viewer knows both ends of: every one, not only those
 * drawn). Post-level rows give byPost; system rows with several posts at an end leave that end out of it. */
export function tradeTotals(rows: readonly FlowRow[], accept: (row: FlowRow) => boolean, categoryOf: (resourceId: number) => FlowCategory): TradeTotals {
    const t: TradeTotals = { all: 0, byCategory: new Map(), byResource: new Map(), byPost: new Map() };
    for (const row of rows) {
        if (row.value <= 0 || !accept(row)) continue;
        const k = row.valuePerYear / row.value;
        t.all += row.valuePerYear;
        for (let i = 0; i < row.resourceIds.length; i++) {
            const id = row.resourceIds[i];
            const v = (row.resourceValues[i] ?? 0) * k;
            t.byResource.set(id, (t.byResource.get(id) ?? 0) + v);
            const cat = categoryOf(id).key;
            t.byCategory.set(cat, (t.byCategory.get(cat) ?? 0) + v);
        }
        for (const o of [row.sellingPoint, row.destination]) if (o !== null) t.byPost.set(o, (t.byPost.get(o) ?? 0) + row.valuePerYear);
    }
    return t;
}

/**
 * One direction's share for the tooltip: with a resource picked, that resource against all of it; otherwise the row's
 * own cargo (its largest commodity's category) against all trade of that cargo, the rest of the row as `otherValue`.
 */
export function flowShare(
    row: FlowRow,
    totals: TradeTotals,
    categoryOf: (resourceId: number) => FlowCategory,
    resource: { id: number; name: string } | null,
): FlowShareInfo {
    const k = row.value > 0 ? row.valuePerYear / row.value : 0;
    if (resource !== null) {
        const i = row.resourceIds.indexOf(resource.id);
        const v = i >= 0 ? (row.resourceValues[i] ?? 0) * k : 0;
        return { cargoLabel: resource.name, cargoValue: v, total: totals.byResource.get(resource.id) ?? 0, otherValue: Math.max(0, row.valuePerYear - v) };
    }
    const key = row.category.key;
    let v = 0;
    for (let i = 0; i < row.resourceIds.length; i++) if (categoryOf(row.resourceIds[i]).key === key) v += (row.resourceValues[i] ?? 0) * k;
    return { cargoLabel: row.category.label.toLowerCase(), cargoValue: v, total: totals.byCategory.get(key) ?? 0, otherValue: Math.max(0, row.valuePerYear - v) };
}

/** Hub disc radius in screen px: 5..20 by sqrt(income / the largest drawn). */
export function hubRadiusPx(income: number, max: number): number {
    if (!(max > 0)) return 5;
    return 5 + 15 * Math.sqrt(Math.max(0, Math.min(1, income / max)));
}

export interface HubDisc {
    hub: HubRow;
    x: number;
    y: number;
    /** Screen px. */
    r: number;
    color: number;
}

/** The hub discs to draw: the first `n` of `hubs` (income desc) that `accept` lets through and that lie in the camera
 * rect, less those under `minShare` of the largest; owner colour, independent / none grey. */
export function hubDiscsFor(
    hubs: readonly HubRow[],
    z: number,
    cam: CullRect,
    n: number,
    accept: (h: HubRow) => boolean = () => true,
    independent: unknown = null,
    minShare = FLOW_ROUTE_MIN_SHARE,
): HubDisc[] {
    const halfW = cam.width / (2 * z);
    const halfH = cam.height / (2 * z);
    const out: HubDisc[] = [];
    let max = 0;
    for (const hub of hubs) {
        if (out.length >= n) break;
        if (hub.x < cam.x - halfW || hub.x > cam.x + halfW || hub.y < cam.y - halfH || hub.y > cam.y + halfH) continue;
        if (!accept(hub)) continue;
        if (out.length === 0) max = hub.income;
        else if (hub.income < max * minShare) break;
        const color = hub.owner === null || hub.owner === independent ? INDEPENDENT_RING_COLOR : toPixiColor(hub.owner.mainColor);
        out.push({ hub, x: hub.x, y: hub.y, r: hubRadiusPx(hub.income, max), color });
    }
    return out;
}

function isFreighter(bo: BuiltObject): boolean {
    const s = bo.subRole;
    return s === BuiltObjectSubRole.SmallFreighter || s === BuiltObjectSubRole.MediumFreighter || s === BuiltObjectSubRole.LargeFreighter;
}

/** A hovered route (with each direction's share of its cargo's known trade) or hub (with its freight volume and share
 * of all known trade). */
export type FreightHit =
    | { kind: 'flow'; route: FlowRoute; abShare: FlowShareInfo | null; baShare: FlowShareInfo | null }
    | { kind: 'hub'; hub: HubRow; volume: number | null; allTrade: number };

/**
 * An in-flight freighter's leader, drawn from where the freighter is drawn (sx, sy) towards where its contract
 * destination is drawn (tx, ty) — both render-interpolated positions (renderInterp.ts) — at most 300 px long; null
 * when the destination is under 8 px away.
 */
export function freightLeader(sx: number, sy: number, tx: number, ty: number, z: number): { x1: number; y1: number; x2: number; y2: number } | null {
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy);
    if (len * z < 8) return null;
    const k = Math.min(1, 300 / z / len);
    return { x1: sx, y1: sy, x2: sx + dx * k, y2: sy + dy * k };
}

/** What the legend shows (FreightOverlay.legendInfo). */
export interface FreightLegendInfo {
    /** Routes drawn now. */
    shown: number;
    /** Routes with both ends known to the viewer (before the top-N cut), all goods / the filter. */
    known: number;
    category: string | null;
    resourceId: number | null;
}

/** Owns the flows / hubs / leaders Graphics inside the overlay root. */
export class FreightOverlay {
    private flows = new Graphics();
    private hubs = new Graphics();
    private leaders = new Graphics();
    /** Scenario routes (mod layer: the 19a treasure fleet's circuit), dashed, the leg sailed drawn solid. */
    private routes = new Graphics();
    private routesAt = 0;
    /** [improvements] supplyChain: one resource's live routes (the resource supply panel's "Highlight on map"),
     *  drawn as bright dashed arcs over the recorded flows while Freight Flows is on. */
    private highlightG = new Graphics();
    private highlightDrawnZ = NaN;
    private highlightDirty = false;
    private _highlight: { color: number; routes: ReadonlyArray<{ fromX: number; fromY: number; toX: number; toY: number }> } | null = null;
    /** System rows of the current window and filter (flowsInWindow), queried at most once a second. */
    private rows: FlowRow[] = [];
    /** `rows` with both directions merged, largest first. */
    private merged: FlowRoute[] = [];
    /** Of `merged`, those whose both ends the viewer knows (re-tested on each build). */
    private knownCount = 0;
    private hubRows: HubRow[] = [];
    /** The routes drawn now (largest first). */
    shown: FlowRoute[] = [];
    private widths: number[] = [];
    discs: HubDisc[] = [];
    private queriedDay = NaN;
    private queriedVersion = -1;
    private queriedLedger: TradeFlowLedger | null = null;
    private queriedAt = -Infinity;
    private builtZ = NaN;
    private builtX = NaN;
    private builtY = NaN;
    private builtW = 0;
    private builtH = 0;
    private builtFlows = false;
    private builtHubs = false;
    private dirty = true;
    private leadersAt = 0;
    private remoteRecording = false;
    private localRecording = false;
    /** Panel / legend filter (null category = all). */
    filter: FlowFilter;
    /** Window the map shows (months); the Trade Flows panel sets it. */
    windowMonths = MAP_FLOW_WINDOW_MONTHS;
    /** Render interpolation (renderInterp.ts; from OverlayLayer.motion): leaders run between the drawn freighter and
     * the drawn destination. Null: the sim positions. */
    motion: MotionInterpolator | null = null;
    private fromScratch: Point = { x: 0, y: 0 };
    private toScratch: Point = { x: 0, y: 0 };
    /** Known trade totals for the tooltip (every cargo, the current empire filter), cached per query. */
    private totals: { key: string; totals: TradeTotals } | null = null;
    /** The legend's per-resource list, cached per query and category. */
    private breakdown: { key: string; list: Array<{ resourceId: number; perYear: number }> } | null = null;

    constructor(
        private galaxy: Galaxy,
        root: Container,
        private state: MapOverlayState,
    ) {
        this.filter = { categoryOf: (r, c) => flowCategory(galaxy, r, c) };
        root.addChild(this.flows, this.hubs, this.leaders, this.routes, this.highlightG);
        this.flows.visible = this.hubs.visible = this.leaders.visible = this.routes.visible = this.highlightG.visible = false;
        this.syncRecording();
    }

    /**
     * Contracts are recorded for the whole game, so the overlay has the last year of flows the moment it is turned on
     * (the recorder only observes contracts: an O(1) bucket write each, no sim state, no Rnd, nothing saved). In-thread
     * it records from here until destroy. In worker mode the worker records from its start, and this switches whether
     * the ledger is synced to this thread: while either toggle is on, or the panel keeps it (`keepRecording`).
     */
    keepRecording = false;
    syncRecording(): void {
        if (!tradeFlowsRemote(this.galaxy)) {
            if (!this.localRecording) {
                enableTradeFlowRecording(this.galaxy, galaxyStarDate(this.galaxy));
                this.localRecording = true;
                this.invalidate();
            }
            return;
        }
        const want = this.state.freightFlows || this.state.tradeHubs || this.keepRecording;
        if (want && !this.remoteRecording) {
            enableTradeFlowRecording(this.galaxy, galaxyStarDate(this.galaxy));
            this.remoteRecording = true;
            this.invalidate();
        } else if (!want && this.remoteRecording) {
            disableTradeFlowRecording(this.galaxy);
            this.remoteRecording = false;
        }
    }

    /** [improvements] supplyChain: highlight these routes (null clears). */
    setHighlight(h: { color: number; routes: ReadonlyArray<{ fromX: number; fromY: number; toX: number; toY: number }> } | null): void {
        this._highlight = h;
        this.highlightDirty = true;
    }
    get highlight(): { color: number; routes: ReadonlyArray<{ fromX: number; fromY: number; toX: number; toY: number }> } | null {
        return this._highlight;
    }

    private updateHighlight(z: number, flowsOn: boolean): void {
        const g = this.highlightG;
        const h = this._highlight;
        if (!flowsOn || h === null || h.routes.length === 0) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            return;
        }
        if (!this.highlightDirty && g.visible && Math.abs(z / this.highlightDrawnZ - 1) < 0.15) return;
        this.highlightDirty = false;
        this.highlightDrawnZ = z;
        g.clear();
        const f = 1 / z;
        for (const r of h.routes) {
            if (!Number.isFinite(r.fromX) || !Number.isFinite(r.toX) || (r.fromX === r.toX && r.fromY === r.toY)) continue;
            const a = flowArcFor(r.fromX, r.fromY, r.toX, r.toY);
            g.moveTo(a.x1, a.y1).quadraticCurveTo(a.cx, a.cy, a.x2, a.y2).stroke({ width: 7 * f, color: 0x000000, alpha: 0.45 });
            g.moveTo(a.x1, a.y1).quadraticCurveTo(a.cx, a.cy, a.x2, a.y2).stroke({ width: 3.5 * f, color: h.color, alpha: 1 });
            circleAtScreenRes(g, a.x2, a.y2, 6 * f, z).fill({ color: h.color, alpha: 1 });
            circleAtScreenRes(g, a.x1, a.y1, 4 * f, z).stroke({ width: 2 * f, color: h.color, alpha: 1 });
        }
        g.visible = true;
    }

    /** Force a re-query (filter changed). */
    invalidate(): void {
        this.queriedDay = NaN;
        this.breakdown = null;
        this.totals = null;
        this.dirty = true;
    }

    /** Show only `category` (null: every cargo), and of it only `resourceId` (null: all of them). */
    setCargoFilter(category: string | null, resourceId: number | null = null): void {
        this.filter = { ...this.filter, category, resourceId };
        this.invalidate();
    }

    /** What the legend shows. */
    legendInfo(): FreightLegendInfo {
        return { shown: this.shown.length, known: this.knownCount, category: this.filter.category ?? null, resourceId: this.filter.resourceId ?? null };
    }

    // --- What the viewer may see (fog.ts; galaxyMarkers.ts explored test) -------------------------------------------

    /** The viewer has explored system `sys` (Explored or Visible); a deep-space end (-1) needs its post seen. */
    private endKnown(sys: number, post: StellarObject | null): boolean {
        const fog = fogOf(this.galaxy);
        if (fog.reveal) return true;
        const viewer = localViewerEmpire(this.galaxy);
        if (viewer === null) return true;
        if (sys >= 0) return viewer.visibility.checkSystemVisibilityStatus(sys) >= SystemVisibilityStatus.Explored;
        return post instanceof BuiltObject && fog.builtObject(post);
    }

    private routeKnown(r: FlowRoute): boolean {
        return this.endKnown(r.aSystem, r.aPost) && this.endKnown(r.bSystem, r.bPost);
    }

    /** Both ends of `row` are known to the viewer (the Trade Flows panel lists only these too). */
    rowKnown(row: FlowRow): boolean {
        return this.endKnown(row.sellerSystem, row.sellingPoint) && this.endKnown(row.destSystem, row.destination);
    }

    /** The viewer knows the hub's system (or sees the deep-space port). */
    hubKnown(h: HubRow): boolean {
        return this.endKnown(h.port.nearestSystemStar?.systemIndex ?? -1, h.port);
    }

    /**
     * The legend's resource list for `category`: per resource, the cr/yr on the routes the viewer knows both ends of
     * (the whole window, before the top-N cut), largest first. Cached until the next query.
     */
    resourceBreakdown(category: string): Array<{ resourceId: number; perYear: number }> {
        const ledger = tradeFlowLedger(this.galaxy);
        if (ledger === null) return [];
        const key = `${category}:${this.queriedLedger === ledger ? this.queriedVersion : -1}:${this.queriedDay}`;
        if (this.breakdown !== null && this.breakdown.key === key) return this.breakdown.list;
        const rows = flowsInWindow(ledger, galaxyStarDate(this.galaxy), this.windowMonths, { ...this.filter, category, resourceId: null }, 'system');
        const list = resourceTotals(rows, (row) => row.sellerSystem !== row.destSystem && this.rowKnown(row)).filter((x) => x.resourceId >= 0);
        this.breakdown = { key, list };
        return list;
    }

    /**
     * Totals of the trade the viewer knows (both ends known; every cargo, the empire filter kept), over the window, for
     * the hover shares: all routes, not only the drawn top N. Post level, so the hubs get their own volume too. Cached
     * until the next query.
     */
    knownTotals(): TradeTotals {
        const ledger = tradeFlowLedger(this.galaxy);
        const key = `${this.queriedLedger === ledger ? this.queriedVersion : -1}:${this.queriedDay}:${this.windowMonths}:${this.filter.empire?.empireId ?? -1}`;
        if (this.totals !== null && this.totals.key === key) return this.totals.totals;
        const categoryOf = this.filter.categoryOf ?? ((r: number) => flowCategory(this.galaxy, r, -1));
        const rows = ledger === null ? [] : flowsInWindow(ledger, galaxyStarDate(this.galaxy), this.windowMonths, { ...this.filter, category: null, resourceId: null }, 'post');
        const totals = tradeTotals(rows, (row) => this.rowKnown(row), (r) => categoryOf(r, -1));
        this.totals = { key, totals };
        return totals;
    }

    private shareOf(row: FlowRow | null, totals: TradeTotals): FlowShareInfo | null {
        if (row === null) return null;
        const categoryOf = this.filter.categoryOf ?? ((r: number) => flowCategory(this.galaxy, r, -1));
        const id = this.filter.resourceId ?? null;
        const resource = id === null ? null : { id, name: this.galaxy.resourceSystem.byId.get(id)?.name ?? `#${id}` };
        return flowShare(row, totals, (r) => categoryOf(r, -1), resource);
    }

    update(z: number, cam: Camera): void {
        const flowsOn = this.state.freightFlows;
        const hubsOn = this.state.tradeHubs;
        if (!flowsOn && !hubsOn) {
            if (this.flows.visible || this.hubs.visible || this.leaders.visible) {
                this.flows.clear();
                this.hubs.clear();
                this.leaders.clear();
                this.leaderSig.reset();
                this.routes.clear();
                this.highlightG.clear();
                this.flows.visible = this.hubs.visible = this.leaders.visible = this.routes.visible = this.highlightG.visible = false;
                this.shown = [];
                this.discs = [];
                this.queriedDay = NaN; // re-query at once when turned back on
                this.dirty = true;
            }
            return;
        }
        const ledger = tradeFlowLedger(this.galaxy);
        const now = galaxyStarDate(this.galaxy);
        const day = Math.floor(now / GAME_DAY_LENGTH);
        const version = ledger?.version ?? 0;
        const t = performance.now();
        // Re-query on a new ledger (the worker's first sync), a filter change, or new contracts on a new game day — at
        // most once a second (a query walks every series of the ledger).
        if (
            Number.isNaN(this.queriedDay) ||
            ledger !== this.queriedLedger ||
            (day !== this.queriedDay && version !== this.queriedVersion && t - this.queriedAt > 1000)
        ) {
            this.rows = ledger !== null ? flowsInWindow(ledger, now, this.windowMonths, this.filter, 'system') : [];
            this.merged = mergeRouteDirections(this.rows);
            this.hubRows = hubsInWindow(this.galaxy, now, { empire: this.filter.empire ?? null });
            this.queriedDay = day;
            this.queriedVersion = version;
            this.queriedLedger = ledger;
            this.queriedAt = t;
            this.dirty = true;
        }
        // Geometry: line widths are in screen px, so rebuild on a zoom change > 3 %, a pan of > 10 % of the view (the
        // top N are picked among the routes in view) or new rows. At most ~25 lines: a rebuild is cheap.
        const zoomMoved = !(Math.abs(z / this.builtZ - 1) < 0.03);
        const panned = Math.abs(cam.x - this.builtX) * z > this.builtW * 0.1 || Math.abs(cam.y - this.builtY) * z > this.builtH * 0.1;
        const resized = cam.width !== this.builtW || cam.height !== this.builtH;
        // One of the two toggles switched while the other stays on: its half was not built.
        const toggled = flowsOn !== this.builtFlows || hubsOn !== this.builtHubs;
        if (this.dirty || zoomMoved || panned || resized || toggled) this.build(z, cam, flowsOn, hubsOn);
        this.flows.visible = flowsOn;
        this.hubs.visible = hubsOn;
        this.updateRoutes(z, flowsOn);
        this.updateHighlight(z, flowsOn); // [improvements] supplyChain
        // In-flight leaders (system zoom only).
        if (flowsOn && flowLevelForZoom(z) === 'post' && ledger !== null) {
            if (t - this.leadersAt > 250) {
                this.leadersAt = t;
                this.buildLeaders(z, cam, ledger.freighterDestination);
            }
            this.leaders.visible = true;
        } else if (this.leaders.visible) {
            this.leaders.clear();
            this.leaderSig.reset();
            this.leaders.visible = false;
        }
    }

    private build(z: number, cam: Camera, flowsOn: boolean, hubsOn: boolean): void {
        this.dirty = false;
        this.builtFlows = flowsOn;
        this.builtHubs = hubsOn;
        this.builtZ = z;
        this.builtX = cam.x;
        this.builtY = cam.y;
        this.builtW = cam.width;
        this.builtH = cam.height;
        const n = routeCountForView(cam.width / z, cam.height / z, this.galaxy.sectorSize);
        const f = this.flows;
        f.clear();
        this.shown = [];
        this.widths = [];
        if (flowsOn) {
            let known = 0;
            for (const r of this.merged) if (this.routeKnown(r)) known++;
            this.knownCount = known;
            this.shown = selectTopRoutes(this.merged, n, (r) => segmentInView(r.ax, r.ay, r.bx, r.by, z, cam) && this.routeKnown(r));
            const max = this.shown[0]?.total ?? 0;
            this.widths = this.shown.map((r) => routeWidthPx(r.total, max));
            // Halos first (one pass, so no line's halo cuts across another line), then the lines smallest first.
            // The arrowheads sit on the part of each line on screen (a long route's own middle is often off it), staggered
            // between 35 % and 65 % of it so the heads of lines leaving one star do not bunch up.
            const mids = this.shown.map((r, i) => {
                const c = clipSegmentToView(r.ax, r.ay, r.bx, r.by, z, cam, -24);
                const k = 0.35 + 0.3 * ((i * 0.618034) % 1);
                return c === null ? 0.5 : c[0] + (c[1] - c[0]) * k;
            });
            for (let i = this.shown.length - 1; i >= 0; i--) this.drawRoute(f, this.shown[i], this.widths[i], z, true, mids[i]);
            for (let i = this.shown.length - 1; i >= 0; i--) this.drawRoute(f, this.shown[i], this.widths[i], z, false, mids[i]);
        }
        const h = this.hubs;
        h.clear();
        this.discs = hubsOn ? hubDiscsFor(this.hubRows, z, cam, n, (hub) => this.hubKnown(hub), this.galaxy.independentEmpire) : [];
        for (let i = this.discs.length - 1; i >= 0; i--) {
            const d = this.discs[i];
            const r = d.r / z;
            // Owner-colour disc in a white ring (over a dark halo): it reads apart from the owner-coloured faction rings.
            circleAtScreenRes(h, d.x, d.y, r, z).stroke({ width: 4.5 / z, color: 0x000000, alpha: 0.55 });
            circleAtScreenRes(h, d.x, d.y, r, z).fill({ color: d.color, alpha: 0.35 }).stroke({ width: 1.75 / z, color: 0xffffff, alpha: 0.9 });
        }
    }

    /** One route: a straight line between the two ends (stopping short of the stars), an arrowhead at `mid` (0..1 along
     * it) pointing A → B, and a second one pointing back when the return leg carries FLOW_TWO_WAY_SHARE or more. */
    private drawRoute(g: Graphics, r: FlowRoute, w: number, z: number, halo: boolean, mid: number): void {
        const dx = r.bx - r.ax;
        const dy = r.by - r.ay;
        const len = Math.hypot(dx, dy);
        if (!(len > 0)) return;
        const ux = dx / len;
        const uy = dy / len;
        const gap = Math.min(FLOW_END_GAP_PX / z, len * 0.2);
        const x1 = r.ax + ux * gap;
        const y1 = r.ay + uy * gap;
        const x2 = r.bx - ux * gap;
        const y2 = r.by - uy * gap;
        const color = halo ? 0x000000 : flowColor(r.category);
        const alpha = halo ? 0.6 : 0.95;
        const width = halo ? w + 2 * FLOW_HALO_PX : w;
        g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: width / z, color, alpha, cap: 'round' });
        // Arrowheads, sized with the line; skipped when the line is too short on screen to hold them.
        const headLen = (6 + w * 1.3) / z;
        const headHalf = (3.5 + w * 0.9) / z;
        if (len * z < 40 + headLen * z * 2) return;
        const twoWay = r.ba !== null && r.baPerYear >= r.abPerYear * FLOW_TWO_WAY_SHARE;
        const off = twoWay ? headLen * 0.9 : 0;
        const head = (tipX: number, tipY: number, vx: number, vy: number): void => {
            const bx = tipX - vx * headLen;
            const by = tipY - vy * headLen;
            const pts = [tipX, tipY, bx - vy * headHalf, by + vx * headHalf, bx + vy * headHalf, by - vx * headHalf];
            if (halo) g.poly(pts).stroke({ width: (2 * FLOW_HALO_PX) / z, color, alpha, join: 'round' });
            else g.poly(pts).fill({ color, alpha: 1 });
        };
        const mx = r.ax + dx * mid;
        const my = r.ay + dy * mid;
        head(mx + ux * (off + headLen / 2), my + uy * (off + headLen / 2), ux, uy);
        if (twoWay) head(mx - ux * (off + headLen / 2), my - uy * (off + headLen / 2), -ux, -uy);
    }

    private updateRoutes(z: number, flowsOn: boolean): void {
        const g = this.routes;
        if (!flowsOn || this.galaxy.scenario === null) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            return;
        }
        const t = performance.now();
        if (g.visible && t - this.routesAt < 250) return;
        this.routesAt = t;
        g.clear();
        const routes = scenarioMapFeatures(this.galaxy, localViewerEmpire(this.galaxy)).routes;
        const f = 1 / z;
        for (const r of routes) {
            for (let i = 0; i + 1 < r.points.length; i++) {
                const a = r.points[i];
                const b = r.points[i + 1];
                if (i === r.activeLeg) {
                    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2.5 * f, color: r.color, alpha: 0.95 });
                } else {
                    for (const [ax, ay, bx, by] of dashSegments(a.x, a.y, b.x, b.y, 10 * f, 6 * f, 400)) g.moveTo(ax, ay).lineTo(bx, by);
                    g.stroke({ width: 1.5 * f, color: r.color, alpha: 0.7 });
                }
            }
        }
        g.visible = routes.length > 0;
    }

    private readonly leaderSig = new DrawSig();
    private buildLeaders(z: number, cam: Camera, dest: WeakMap<BuiltObject, unknown>): void {
        const g = this.leaders;
        const f = 1 / z;
        // The leaders are listed first and the Graphics rebuilt only when one moved (or the zoom changed): freighters
        // at rest or a paused game redraw nothing four times a second.
        const sig = this.leaderSig;
        sig.begin();
        sig.push(f);
        const ends: { x1: number; y1: number; x2: number; y2: number }[] = [];
        const halfW = cam.width / (2 * z);
        const halfH = cam.height / (2 * z);
        let any = false;
        const fog = fogOf(this.galaxy);
        for (const bo of this.galaxy.builtObjects) {
            if (bo === null || bo === undefined || bo.hasBeenDestroyed || !isFreighter(bo)) continue;
            if (bo.contractsToFulfill.length === 0) continue;
            if (!fog.builtObject(bo)) continue; // fog.ts: no travel leader for a ship the player cannot see
            const d = dest.get(bo) as { xpos: number; ypos: number } | undefined;
            if (d === undefined) continue;
            // Endpoints where the freighter and its destination are drawn (render-interpolated).
            const s = drawnPositionOf(this.motion, bo, this.fromScratch);
            if (s.x < cam.x - halfW || s.x > cam.x + halfW || s.y < cam.y - halfH || s.y > cam.y + halfH) continue;
            const t = drawnPositionOf(this.motion, d, this.toScratch);
            // A short leader: at most 300 px towards the contract destination.
            const leader = freightLeader(s.x, s.y, t.x, t.y, z);
            if (leader === null) continue;
            ends.push(leader);
            sig.push4(leader.x1, leader.y1, leader.x2, leader.y2);
            any = true;
        }
        if (!sig.changed()) return;
        g.clear();
        for (const leader of ends) {
            for (const [ax, ay, bx, by] of dashSegments(leader.x1, leader.y1, leader.x2, leader.y2, 6 * f, 4 * f, 60)) {
                g.moveTo(ax, ay).lineTo(bx, by);
            }
        }
        if (any) g.stroke({ width: f, color: TRAVEL_VECTOR_COLOR, alpha: 0.9 });
    }

    /** Hover: the hub under world (wx, wy), else the largest route within its half width + 4 px. */
    hitTest(wx: number, wy: number, z: number): FreightHit | null {
        if (this.hubs.visible) {
            for (const d of this.discs) {
                const r = d.r / z;
                const dx = wx - d.x;
                const dy = wy - d.y;
                if (dx * dx + dy * dy <= r * r) {
                    const t = this.knownTotals();
                    return { kind: 'hub', hub: d.hub, volume: t.byPost.get(d.hub.port) ?? null, allTrade: t.all };
                }
            }
        }
        if (this.flows.visible) {
            for (let i = 0; i < this.shown.length; i++) {
                const a = this.shown[i];
                const tol = (this.widths[i] / 2 + 4) / z;
                if (segDist2(wx, wy, a.ax, a.ay, a.bx, a.by) <= tol * tol) {
                    const t = this.knownTotals();
                    return { kind: 'flow', route: a, abShare: this.shareOf(a.ab, t), baShare: this.shareOf(a.ba, t) };
                }
            }
        }
        return null;
    }

    destroy(): void {
        if (this.localRecording || this.remoteRecording) disableTradeFlowRecording(this.galaxy);
        this.localRecording = this.remoteRecording = false;
    }
}
