// Streamlined (not in the original): two selection aids drawn in SCREEN px on MainView's fx layer (beside the
// method_212 selection circles and the range rings), so no world-unit tessellation cost at any zoom (the bug fixed
// for the battle markers in galaxyMarkers.ts, 0185cabf):
//
// - Queued orders: when the player's ship or fleet is selected and has shift-click orders queued
//   (BuiltObject / ShipGroup SubsequentMissions; ui/orderMenu.ts sets ShipAction.isSubsequentAction), a faint dashed
//   path from the ship (the fleet's lead) to its current mission target, then on to each queued target, with small
//   numbered markers (the same numbers as the selection panel's "Then: 1. ...  2. ..." line, selectionInfo.ts).
// - Fleet members: when the player's fleet is selected, a light ring on every member that is not drawn with its own
//   selection circle (at galaxy / sector zoom the fleet icon stands for the whole fleet, galaxyMarkers.drawnAsFleet),
//   and a faint line from each straggler to the lead ship, so a scattered fleet's ships are easy to find.
//
// Both Graphics are rebuilt only when their (rounded) screen geometry changes. Reads only the selection's ships and
// missions, so it works on the worker-mode replica as well (subsequentMissions is a field of the hot BuiltObject /
// ShipGroup objects, synced like the rest of the graph: simworker/replicaSync.ts). No sim writes.

import { Container, Graphics, Text } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { BuiltObjectMissionType, builtObjectMission, builtObjectSubsequentMissions, type BuiltObjectMission } from '../sim/missions/mission';
import { sameBoxes } from './selectionCircle';
import { segmentCircle } from './screenCircle';

export const QUEUED_PATH_COLOR = 0xd8e4ff;
export const QUEUED_PATH_ALPHA = 0.55;
export const QUEUED_PATH_DASH_PX = 6;
export const QUEUED_PATH_GAP_PX = 5;
export const QUEUED_MARKER_RADIUS_PX = 7;
export const FLEET_MEMBER_COLOR = 0x9fe8ff;
export const FLEET_MEMBER_RING_PX = 6;
/** A member farther than this from the lead (screen px) gets a line to it. */
export const FLEET_STRAGGLER_PX = 18;
/** Off-screen slack (px) kept when clipping lines to the view. */
const CLIP_PAD = 40;

type Selection = { builtObject?: BuiltObject; shipGroup?: ShipGroup; builtObjects?: BuiltObject[] } | null;
type Pt = { x: number; y: number };

/** A mission's target point (BuiltObjectMission.ResolveTargetCoordinates), or null when it has none (Point.IsEmpty). */
export function missionTargetPoint(m: BuiltObjectMission | null): Pt | null {
    if (m === null || m.type === BuiltObjectMissionType.Undefined) return null;
    const p = m.resolveTargetCoordinates(m);
    if (p.x === 0 && p.y === 0) return null;
    return p;
}

/**
 * The selected ship / fleet's queued-orders path in world coords: [current target?, queued 1, queued 2, ...], each
 * tagged with its queue number (0 = the current mission). Empty when nothing is queued or the selection is not the
 * player's own ship / fleet.
 */
export function queuedPath(sel: Selection, player: Empire | null): { from: BuiltObject; points: Array<Pt & { n: number }> } | null {
    if (sel === null || player === null) return null;
    let from: BuiltObject | null;
    let current: BuiltObjectMission | null;
    let queued: readonly (BuiltObjectMission | null)[];
    if (sel.shipGroup !== undefined) {
        const sg = sel.shipGroup;
        if (sg.empire !== player) return null;
        from = sg.leadShip ?? sg.ships[0] ?? null;
        current = sg.mission;
        queued = sg.subsequentMissions;
    } else if (sel.builtObject !== undefined && sel.builtObjects === undefined) {
        from = sel.builtObject;
        if (from.actualEmpire !== player) return null;
        current = builtObjectMission(from.mission);
        queued = builtObjectSubsequentMissions(from);
    } else return null;
    if (from === null || from.hasBeenDestroyed || queued.length === 0) return null;
    const points: Array<Pt & { n: number }> = [];
    const c = missionTargetPoint(current);
    if (c !== null) points.push({ x: c.x, y: c.y, n: 0 });
    let n = 0;
    for (const m of queued) {
        if (m == null) continue;
        n++;
        const p = missionTargetPoint(m);
        if (p !== null) points.push({ x: p.x, y: p.y, n });
    }
    return n > 0 ? { from, points } : null;
}

/** Liang-Barsky: the part of segment a-b inside [x0, x1] x [y0, y1], or null. */
export function clipSegment(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
    const dx = bx - ax;
    const dy = by - ay;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return null;
        } else {
            const r = q[i] / p[i];
            if (p[i] < 0) {
                if (r > t1) return null;
                if (r > t0) t0 = r;
            } else {
                if (r < t0) return null;
                if (r < t1) t1 = r;
            }
        }
    }
    return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** Dashes of a screen-px segment, phase-continuous from the segment start. */
function dashLine(g: Graphics, ax: number, ay: number, bx: number, by: number, dash: number, gap: number): void {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.5) return;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    for (let t = 0; t < len; t += dash + gap) {
        const e = Math.min(t + dash, len);
        g.moveTo(ax + ux * t, ay + uy * t).lineTo(ax + ux * e, ay + uy * e);
    }
}

export interface SelectionPathDeps {
    getSelection: () => Selection;
    player: () => Empire | null;
    /** World -> screen px. */
    toScreen: (x: number, y: number) => Pt;
    /** The ship's drawn (render-interpolated) world position. */
    drawnPos: (bo: BuiltObject) => Pt;
    /** The ship's drawn art size this frame in px (0: not drawn: no selection circle of its own). */
    drawnPx: (bo: BuiltObject) => number;
}

export class SelectionPathLayer {
    readonly root = new Container();
    private readonly fleetG = new Graphics();
    private readonly pathG = new Graphics();
    private readonly labels = new Container();
    private readonly labelPool: Text[] = [];
    private pathKey: number[] = [];
    private fleetKey: number[] = [];
    private readonly scratch: number[] = [];

    constructor(private readonly deps: SelectionPathDeps) {
        this.root.eventMode = 'none';
        this.root.addChild(this.fleetG, this.pathG, this.labels);
    }

    update(viewW: number, viewH: number): void {
        const sel = this.deps.getSelection();
        const player = this.deps.player();
        this.updateFleet(sel, player, viewW, viewH);
        this.updatePath(sel, player, viewW, viewH);
    }

    private updateFleet(sel: Selection, player: Empire | null, w: number, h: number): void {
        const g = this.fleetG;
        const sg = sel?.shipGroup ?? null;
        const key = this.scratch;
        key.length = 0;
        if (sg !== null && player !== null && sg.empire === player && sg.ships.length > 1) {
            const lead = sg.leadShip ?? sg.ships[0];
            const ld = lead !== undefined && !lead.hasBeenDestroyed ? this.deps.drawnPos(lead) : null;
            const lp = ld !== null ? this.deps.toScreen(ld.x, ld.y) : null;
            for (const bo of sg.ships) {
                if (bo.hasBeenDestroyed || bo === lead) continue;
                const d = this.deps.drawnPos(bo);
                const s = this.deps.toScreen(d.x, d.y);
                // ring flag: not drawn with its own selection circle (MainView.drawSelectionCircles) and on screen.
                const onScreen = s.x > -CLIP_PAD && s.x < w + CLIP_PAD && s.y > -CLIP_PAD && s.y < h + CLIP_PAD;
                const ring = onScreen && this.deps.drawnPx(bo) <= 0 ? 1 : 0;
                key.push(Math.round(s.x), Math.round(s.y), ring);
            }
            if (lp !== null) key.push(Math.round(lp.x), Math.round(lp.y), 2);
        }
        if (key.length === 0) {
            if (g.visible) {
                g.clear();
                g.visible = false;
                this.fleetKey.length = 0;
            }
            return;
        }
        g.visible = true;
        if (sameBoxes(key, this.fleetKey)) return;
        this.fleetKey = key.slice();
        g.clear();
        const hasLead = key[key.length - 1] === 2;
        const lx = hasLead ? key[key.length - 3] : 0;
        const ly = hasLead ? key[key.length - 2] : 0;
        const n = hasLead ? key.length - 3 : key.length;
        // Straggler lines (clipped to the view), then the member rings over them.
        let lines = 0;
        if (hasLead) {
            for (let i = 0; i < n; i += 3) {
                const x = key[i];
                const y = key[i + 1];
                if (Math.hypot(x - lx, y - ly) < FLEET_STRAGGLER_PX) continue;
                const c = clipSegment(lx, ly, x, y, -CLIP_PAD, -CLIP_PAD, w + CLIP_PAD, h + CLIP_PAD);
                if (c === null) continue;
                g.moveTo(c[0], c[1]).lineTo(c[2], c[3]);
                lines++;
            }
            if (lines > 0) g.stroke({ width: 1, color: FLEET_MEMBER_COLOR, alpha: 0.28 });
        }
        let rings = 0;
        for (let i = 0; i < n; i += 3) {
            if (key[i + 2] !== 1) continue;
            segmentCircle(g, key[i], key[i + 1], FLEET_MEMBER_RING_PX, 14);
            rings++;
        }
        if (rings > 0) g.stroke({ width: 1.5, color: FLEET_MEMBER_COLOR, alpha: 0.8 });
    }

    private updatePath(sel: Selection, player: Empire | null, w: number, h: number): void {
        const g = this.pathG;
        const path = queuedPath(sel, player);
        const key = this.scratch;
        key.length = 0;
        if (path !== null) {
            const d = this.deps.drawnPos(path.from);
            const s = this.deps.toScreen(d.x, d.y);
            key.push(Math.round(s.x), Math.round(s.y), -1);
            for (const p of path.points) {
                const q = this.deps.toScreen(p.x, p.y);
                key.push(Math.round(q.x), Math.round(q.y), p.n);
            }
        }
        if (key.length <= 3) {
            if (g.visible) {
                g.clear();
                g.visible = false;
                this.pathKey.length = 0;
            }
            for (const t of this.labelPool) t.visible = false;
            return;
        }
        g.visible = true;
        if (sameBoxes(key, this.pathKey)) return;
        this.pathKey = key.slice();
        g.clear();
        const x0 = -CLIP_PAD;
        const y0 = -CLIP_PAD;
        const x1 = w + CLIP_PAD;
        const y1 = h + CLIP_PAD;
        for (let i = 3; i < key.length; i += 3) {
            const c = clipSegment(key[i - 3], key[i - 2], key[i], key[i + 1], x0, y0, x1, y1);
            if (c !== null) dashLine(g, c[0], c[1], c[2], c[3], QUEUED_PATH_DASH_PX, QUEUED_PATH_GAP_PX);
        }
        g.stroke({ width: 1.5, color: QUEUED_PATH_COLOR, alpha: QUEUED_PATH_ALPHA });
        // Markers: a small hollow ring at the current target, a numbered disc at each queued one.
        let labels = 0;
        for (let i = 3; i < key.length; i += 3) {
            const x = key[i];
            const y = key[i + 1];
            if (x < x0 || x > x1 || y < y0 || y > y1) continue;
            const num = key[i + 2];
            if (num === 0) {
                segmentCircle(g, x, y, 4, 12);
                g.stroke({ width: 1.5, color: QUEUED_PATH_COLOR, alpha: 0.8 });
                continue;
            }
            g.circle(x, y, QUEUED_MARKER_RADIUS_PX).fill({ color: 0x101828, alpha: 0.85 }).stroke({ width: 1.5, color: QUEUED_PATH_COLOR, alpha: 0.9 });
            const t = this.label(labels++);
            const s = String(num);
            if (t.text !== s) t.text = s;
            t.position.set(x, y);
        }
        for (let i = labels; i < this.labelPool.length; i++) this.labelPool[i].visible = false;
    }

    private label(i: number): Text {
        let t = this.labelPool[i];
        if (t === undefined) {
            t = new Text({ text: '', style: { fontSize: 10, fontWeight: 'bold', fill: QUEUED_PATH_COLOR } });
            t.anchor.set(0.5, 0.5);
            this.labelPool.push(t);
            this.labels.addChild(t);
        }
        t.visible = true;
        return t;
    }

    destroy(): void {
        this.root.destroy({ children: true });
    }
}
