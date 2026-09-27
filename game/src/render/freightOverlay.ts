// Task 19e-9: Freight Flows + Trade Hubs map overlays (the private economy made visible). NOT a port: DW:U never
// showed flows. Data: src/sim/logistics/tradeFlows.ts (contracts recorded at Empire.4.cs:1135 InitiateContract;
// port income from BuiltObject.cs:3415 PerformFinancialTransaction). Drawing style follows the travel-vectors
// overlay (task 14c: MainView.2.cs:5069 method_250 overlay pass, BaconMainView.cs:19 method_253 dashed lines).
//
// Performance: the flow rows are re-queried only when the ledger changed and a game-day passed; the geometry is
// rebuilt only then, or when the zoom moves by > 15 % / the camera leaves the padded rect the last build was culled
// against. Nothing is allocated per frame otherwise. In-flight freighter leaders (system zoom only) are rebuilt at
// most every 250 ms.

import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
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
    type FlowCategory,
    type FlowFilter,
    type FlowLevel,
    type FlowRow,
    type HubRow,
} from '../sim/logistics/tradeFlows';
import type { MapOverlayState } from '../ui/mapOverlays';
import { scenarioMapFeatures } from '../sim/scenario/mapFeatures';
import { INDEPENDENT_RING_COLOR, toPixiColor } from './empireLayer';
import { dashSegments, TRAVEL_VECTOR_COLOR } from './overlayLayer';

/** Default category colours (task 19e-9 §8.2). Scenario categories carry their own. */
export const FLOW_COLORS: Readonly<Record<string, number>> = {
    mineral: 0xb0b8c0,
    gas: 0x6fd3ff,
    luxury: 0xf2c14e,
    restricted: 0xff7ad9,
    component: 0x9aa0ff,
};

export function flowColor(cat: FlowCategory): number {
    return cat.color ?? FLOW_COLORS[cat.key] ?? 0xffffff;
}

/** Most arcs drawn at once (largest first). */
export const FLOW_ARC_CAP = 400;

/** Window the map overlay shows (months). The panel can pick 1 or 12. */
export const MAP_FLOW_WINDOW_MONTHS = 12;

/** Original's system-zoom gate (MainView.pick / overlayLayer.ts markers: zoom factor 1/z < 70): above it the arcs split
 * into per-trading-post lines. */
export function flowLevelForZoom(z: number): FlowLevel {
    return 1 / z < 70 ? 'post' : 'system';
}

export interface ArcGeom {
    x1: number;
    y1: number;
    cx: number;
    cy: number;
    x2: number;
    y2: number;
}

/** Quadratic arc from (x1,y1) to (x2,y2), control point 15 % of the length to the left of travel (screen space, y down),
 * so A→B and B→A do not overlap. */
export function flowArcFor(x1: number, y1: number, x2: number, y2: number): ArcGeom {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return { x1, y1, x2, y2, cx: (x1 + x2) / 2 + 0.15 * dy, cy: (y1 + y2) / 2 - 0.15 * dx };
}

/** Line width in screen px: clamp(1, 8, sqrt(valuePerYear / 2000)). */
export function flowWidthPx(valuePerYear: number): number {
    return Math.min(8, Math.max(1, Math.sqrt(Math.max(0, valuePerYear) / 2000)));
}

export interface FlowArc extends ArcGeom {
    row: FlowRow;
    widthPx: number;
    alpha: number;
    color: number;
}

export interface CullRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Visible arcs for `rows` (sorted by value desc): zero-length ones dropped, culled by the camera's world rect (padded
 * by `padPx` screen px), capped at FLOW_ARC_CAP. */
export function flowArcsFor(rows: readonly FlowRow[], z: number, cam: CullRect, padPx = 0, cap = FLOW_ARC_CAP): FlowArc[] {
    const halfW = cam.width / (2 * z) + padPx / z;
    const halfH = cam.height / (2 * z) + padPx / z;
    const left = cam.x - halfW;
    const right = cam.x + halfW;
    const top = cam.y - halfH;
    const bottom = cam.y + halfH;
    const out: FlowArc[] = [];
    for (const row of rows) {
        if (out.length >= cap) break;
        if (row.fromX === row.toX && row.fromY === row.toY) continue;
        const g = flowArcFor(row.fromX, row.fromY, row.toX, row.toY);
        const minX = Math.min(g.x1, g.x2, g.cx);
        const maxX = Math.max(g.x1, g.x2, g.cx);
        const minY = Math.min(g.y1, g.y2, g.cy);
        const maxY = Math.max(g.y1, g.y2, g.cy);
        if (maxX < left || minX > right || maxY < top || minY > bottom) continue;
        out.push({ ...g, row, widthPx: flowWidthPx(row.valuePerYear), alpha: 0.35 + 0.65 * row.recency, color: flowColor(row.category) });
    }
    return out;
}

/** Point on the arc at t (0..1). */
function arcPoint(a: ArcGeom, t: number, out: { x: number; y: number }): void {
    const u = 1 - t;
    out.x = u * u * a.x1 + 2 * u * t * a.cx + t * t * a.x2;
    out.y = u * u * a.y1 + 2 * u * t * a.cy + t * t * a.y2;
}

const hitTmp = { x: 0, y: 0 };
/** Hover hit test: distance (screen px) from world point (wx, wy) to the curve sampled at 16 points < `px`. */
export function hitFlowArc(a: ArcGeom, wx: number, wy: number, z: number, px = 6): boolean {
    const r = px / z;
    let px0 = a.x1;
    let py0 = a.y1;
    for (let i = 1; i <= 16; i++) {
        arcPoint(a, i / 16, hitTmp);
        if (segDist2(wx, wy, px0, py0, hitTmp.x, hitTmp.y) < r * r) return true;
        px0 = hitTmp.x;
        py0 = hitTmp.y;
    }
    return false;
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx - px;
    const qy = ay + t * dy - py;
    return qx * qx + qy * qy;
}

/** Hub disc radius in screen px: clamp(6, 60, sqrt(income) / 4). */
export function hubRadiusPx(income: number): number {
    return Math.min(60, Math.max(6, Math.sqrt(Math.max(0, income)) / 4));
}

export interface HubDisc {
    hub: HubRow;
    x: number;
    y: number;
    /** Screen px. */
    r: number;
    color: number;
}

/** Visible hub discs (owner colour; independent / none grey), culled by the camera world rect. */
export function hubDiscsFor(hubs: readonly HubRow[], z: number, cam: CullRect, padPx = 0, independent: unknown = null): HubDisc[] {
    const halfW = cam.width / (2 * z) + padPx / z;
    const halfH = cam.height / (2 * z) + padPx / z;
    const out: HubDisc[] = [];
    for (const hub of hubs) {
        if (hub.x < cam.x - halfW || hub.x > cam.x + halfW || hub.y < cam.y - halfH || hub.y > cam.y + halfH) continue;
        const color = hub.owner === null || hub.owner === independent ? INDEPENDENT_RING_COLOR : toPixiColor(hub.owner.mainColor);
        out.push({ hub, x: hub.x, y: hub.y, r: hubRadiusPx(hub.income), color });
    }
    return out;
}

function isFreighter(bo: BuiltObject): boolean {
    const s = bo.subRole;
    return s === BuiltObjectSubRole.SmallFreighter || s === BuiltObjectSubRole.MediumFreighter || s === BuiltObjectSubRole.LargeFreighter;
}

export type FreightHit = { kind: 'flow'; row: FlowRow } | { kind: 'hub'; hub: HubRow };

/** Owns the flows / hubs / leaders Graphics inside the overlay root. */
export class FreightOverlay {
    private flows = new Graphics();
    private hubs = new Graphics();
    private leaders = new Graphics();
    /** Scenario routes (mod layer: the 19a treasure fleet's circuit), dashed, the leg sailed drawn solid. */
    private routes = new Graphics();
    private routesAt = 0;
    private rows: FlowRow[] = [];
    private hubRows: HubRow[] = [];
    private arcs: FlowArc[] = [];
    private discs: HubDisc[] = [];
    private queriedDay = NaN;
    private queriedVersion = -1;
    private queriedLevel: FlowLevel | null = null;
    private builtZ = NaN;
    private builtX = NaN;
    private builtY = NaN;
    private builtW = 0;
    private builtH = 0;
    private dirty = true;
    private leadersAt = 0;
    private recording = false;
    /** Panel / legend filter (null category = all). */
    filter: FlowFilter;
    /** Window the map shows (months); the Trade Flows panel sets it. */
    windowMonths = MAP_FLOW_WINDOW_MONTHS;

    constructor(
        private galaxy: Galaxy,
        root: Container,
        private state: MapOverlayState,
    ) {
        this.filter = { categoryOf: (r, c) => flowCategory(galaxy, r, c) };
        root.addChild(this.flows, this.hubs, this.leaders, this.routes);
        this.flows.visible = this.hubs.visible = this.leaders.visible = this.routes.visible = false;
        this.syncRecording();
    }

    /** Recording runs while either toggle is on (brief §10: off → no listener, nothing recorded). The panel keeps it on
     * via `keepRecording`. */
    keepRecording = false;
    syncRecording(): void {
        const want = this.state.freightFlows || this.state.tradeHubs || this.keepRecording;
        if (want && !this.recording) {
            enableTradeFlowRecording(this.galaxy, galaxyStarDate(this.galaxy));
            this.recording = true;
            this.dirty = true;
        } else if (!want && this.recording) {
            disableTradeFlowRecording(this.galaxy);
            this.recording = false;
        }
    }

    /** Force a re-query (filter changed). */
    invalidate(): void {
        this.queriedDay = NaN;
        this.dirty = true;
    }

    update(z: number, cam: Camera): void {
        const flowsOn = this.state.freightFlows;
        const hubsOn = this.state.tradeHubs;
        if (!flowsOn && !hubsOn) {
            if (this.flows.visible || this.hubs.visible || this.leaders.visible) {
                this.flows.clear();
                this.hubs.clear();
                this.leaders.clear();
                this.routes.clear();
                this.flows.visible = this.hubs.visible = this.leaders.visible = this.routes.visible = false;
                this.arcs = [];
                this.discs = [];
                this.dirty = true;
            }
            return;
        }
        const ledger = tradeFlowLedger(this.galaxy);
        const now = galaxyStarDate(this.galaxy);
        const day = Math.floor(now / GAME_DAY_LENGTH);
        const level = flowLevelForZoom(z);
        const version = ledger?.version ?? 0;
        if (Number.isNaN(this.queriedDay) || level !== this.queriedLevel || (day !== this.queriedDay && version !== this.queriedVersion)) {
            this.rows = ledger !== null ? flowsInWindow(ledger, now, this.windowMonths, this.filter, level) : [];
            this.hubRows = hubsInWindow(this.galaxy, now, { empire: this.filter.empire ?? null });
            this.queriedDay = day;
            this.queriedVersion = version;
            this.queriedLevel = level;
            this.dirty = true;
        }
        // Geometry: rebuild on new rows, zoom change > 15 %, or the camera leaving the padded rect of the last build.
        const zoomMoved = !(Math.abs(z / this.builtZ - 1) < 0.15);
        const padX = this.builtW / (2 * this.builtZ);
        const padY = this.builtH / (2 * this.builtZ);
        const panned = Math.abs(cam.x - this.builtX) > padX * 0.5 || Math.abs(cam.y - this.builtY) > padY * 0.5;
        if (this.dirty || zoomMoved || panned) {
            this.build(z, cam, flowsOn, hubsOn);
        }
        this.flows.visible = flowsOn;
        this.hubs.visible = hubsOn;
        this.updateRoutes(z, flowsOn);
        // In-flight leaders (system zoom only).
        if (flowsOn && level === 'post' && ledger !== null) {
            const t = performance.now();
            if (t - this.leadersAt > 250) {
                this.leadersAt = t;
                this.buildLeaders(z, cam, ledger.freighterDestination);
            }
            this.leaders.visible = true;
        } else if (this.leaders.visible) {
            this.leaders.clear();
            this.leaders.visible = false;
        }
    }

    private build(z: number, cam: Camera, flowsOn: boolean, hubsOn: boolean): void {
        this.dirty = false;
        this.builtZ = z;
        this.builtX = cam.x;
        this.builtY = cam.y;
        this.builtW = cam.width;
        this.builtH = cam.height;
        // Pad by one viewport so short pans reuse the geometry.
        const pad = Math.max(cam.width, cam.height) / 2;
        const f = this.flows;
        f.clear();
        this.arcs = flowsOn ? flowArcsFor(this.rows, z, cam, pad) : [];
        // Draw smallest first so the big flows sit on top.
        for (let i = this.arcs.length - 1; i >= 0; i--) {
            const a = this.arcs[i];
            const w = a.widthPx / z;
            f.moveTo(a.x1, a.y1).quadraticCurveTo(a.cx, a.cy, a.x2, a.y2).stroke({ width: w, color: a.color, alpha: a.alpha });
            // Arrow head at the buyer end, along the curve's end tangent (control point → end).
            const tx = a.x2 - a.cx;
            const ty = a.y2 - a.cy;
            const tl = Math.hypot(tx, ty);
            if (tl > 0) {
                const ux = tx / tl;
                const uy = ty / tl;
                const len = (6 + a.widthPx * 1.5) / z;
                const half = (3 + a.widthPx) / z;
                const bx = a.x2 - ux * len;
                const by = a.y2 - uy * len;
                f.poly([a.x2, a.y2, bx - uy * half, by + ux * half, bx + uy * half, by - ux * half]).fill({ color: a.color, alpha: a.alpha });
            }
        }
        const h = this.hubs;
        h.clear();
        this.discs = hubsOn ? hubDiscsFor(this.hubRows, z, cam, pad, this.galaxy.independentEmpire) : [];
        for (let i = this.discs.length - 1; i >= 0; i--) {
            const d = this.discs[i];
            const r = d.r / z;
            h.circle(d.x, d.y, r).fill({ color: d.color, alpha: 0.25 }).stroke({ width: 1 / z, color: d.color, alpha: 0.9 });
        }
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
        const routes = scenarioMapFeatures(this.galaxy, this.galaxy.playerEmpire).routes;
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

    private buildLeaders(z: number, cam: Camera, dest: WeakMap<BuiltObject, unknown>): void {
        const g = this.leaders;
        g.clear();
        const f = 1 / z;
        const halfW = cam.width / (2 * z);
        const halfH = cam.height / (2 * z);
        let any = false;
        for (const bo of this.galaxy.builtObjects) {
            if (bo === null || bo === undefined || bo.hasBeenDestroyed || !isFreighter(bo)) continue;
            if (bo.contractsToFulfill.length === 0) continue;
            if (bo.xpos < cam.x - halfW || bo.xpos > cam.x + halfW || bo.ypos < cam.y - halfH || bo.ypos > cam.y + halfH) continue;
            const d = dest.get(bo) as { xpos: number; ypos: number } | undefined;
            if (d === undefined) continue;
            // A short leader: at most 300 px towards the contract destination.
            const dx = d.xpos - bo.xpos;
            const dy = d.ypos - bo.ypos;
            const len = Math.hypot(dx, dy);
            if (len * z < 8) continue;
            const k = Math.min(1, (300 * f) / len);
            for (const [ax, ay, bx, by] of dashSegments(bo.xpos, bo.ypos, bo.xpos + dx * k, bo.ypos + dy * k, 6 * f, 4 * f, 60)) {
                g.moveTo(ax, ay).lineTo(bx, by);
            }
            any = true;
        }
        if (any) g.stroke({ width: f, color: TRAVEL_VECTOR_COLOR, alpha: 0.9 });
    }

    /** Hover: the hub under world (wx, wy), else the topmost (largest) arc within 6 px. */
    hitTest(wx: number, wy: number, z: number): FreightHit | null {
        if (this.hubs.visible) {
            for (const d of this.discs) {
                const r = d.r / z;
                const dx = wx - d.x;
                const dy = wy - d.y;
                if (dx * dx + dy * dy <= r * r) return { kind: 'hub', hub: d.hub };
            }
        }
        if (this.flows.visible) {
            for (const a of this.arcs) if (hitFlowArc(a, wx, wy, z, 6)) return { kind: 'flow', row: a.row };
        }
        return null;
    }

    destroy(): void {
        if (this.recording) disableTradeFlowRecording(this.galaxy);
        this.recording = false;
    }
}
