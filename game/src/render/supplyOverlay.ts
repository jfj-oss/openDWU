// Improvements "supplyChain": the Supply Shortages map overlay. NOT a port (DW:U has no such overlay). It marks the
// player's construction yards whose queue lacks resources and the colonies short of the luxuries they demand
// (sim/logistics/supplyChain.ts shortageMarkers, read through the ui/supplyChainCache.ts snapshot: recomputed at most
// once a second while the overlay is on, nothing at all while it is off). A yard is a diamond, a colony a ring; red
// when stalled / nothing coming / development falling, amber when short with something on its way. Markers keep a
// fixed screen size at every zoom and follow the drawn (render-interpolated) objects. Hover: mainView.ts asks
// hitTest and shows supplyChainText.ts shortageTooltip.

import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import { drawnPositionOf, type MotionInterpolator, type Point } from './renderInterp';
import type { Galaxy } from '../sim/galaxy';
import { BuiltObject } from '../sim/builtObject';
import { shortageMarkers, type ShortageMarker } from '../sim/logistics/supplyChain';
import { overlayActive, type MapOverlayState } from '../ui/mapOverlays';
import { SUPPLY_REFRESH_MS, supplySnapshot } from '../ui/supplyChainCache';

export const SHORTAGE_STALLED_COLOR = 0xff4a3a;
export const SHORTAGE_SHORT_COLOR = 0xffb428;
/** Marker radius (screen px). */
export const SHORTAGE_MARKER_PX = 11;

export function shortageColor(m: Pick<ShortageMarker, 'severity'>): number {
    return m.severity === 'stalled' ? SHORTAGE_STALLED_COLOR : SHORTAGE_SHORT_COLOR;
}

/** The marker under screen-distance `px` of world point (wx, wy) at zoom z (nearest first), or null. */
export function hitShortageMarker(markers: readonly { m: ShortageMarker; x: number; y: number }[], wx: number, wy: number, z: number, px = SHORTAGE_MARKER_PX + 3): ShortageMarker | null {
    const r = px / z;
    let best: ShortageMarker | null = null;
    let bestD = r * r;
    for (const e of markers) {
        const dx = e.x - wx;
        const dy = e.y - wy;
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
            bestD = d;
            best = e.m;
        }
    }
    return best;
}

export class SupplyOverlay {
    private g = new Graphics();
    private markers: ShortageMarker[] = [];
    private drawn: { m: ShortageMarker; x: number; y: number }[] = [];
    private queriedAt = -Infinity;
    private scratch: Point = { x: 0, y: 0 };
    /** Render interpolation (overlayLayer.ts passes its own). */
    motion: MotionInterpolator | null = null;
    /** Markers drawn in the last frame (perf / screenshot checks). */
    get count(): number {
        return this.g.visible ? this.drawn.length : 0;
    }

    constructor(
        private galaxy: Galaxy,
        root: Container,
        private state: MapOverlayState,
    ) {
        this.g.visible = false;
        root.addChild(this.g);
    }

    update(z: number, cam: Camera): void {
        if (!overlayActive(this.state, 'supplyShortages') || this.galaxy.playerEmpire === null) {
            if (this.g.visible) {
                this.g.clear();
                this.g.visible = false;
                this.drawn = [];
                this.markers = [];
                this.queriedAt = -Infinity;
            }
            return;
        }
        const t = performance.now();
        if (t - this.queriedAt >= SUPPLY_REFRESH_MS) {
            this.queriedAt = t;
            const snap = supplySnapshot(this.galaxy);
            this.markers = snap !== null ? shortageMarkers(snap) : [];
        }
        const g = this.g;
        g.clear();
        this.drawn = [];
        const halfW = cam.width / (2 * z) + 40 / z;
        const halfH = cam.height / (2 * z) + 40 / z;
        const f = 1 / z;
        const r = SHORTAGE_MARKER_PX * f;
        // Amber first, red on top.
        for (const pass of ['short', 'stalled'] as const) {
            for (const m of this.markers) {
                if (m.severity !== pass) continue;
                const o = m.target;
                if ((o as { hasBeenDestroyed?: boolean }).hasBeenDestroyed) continue;
                const p = drawnPositionOf(this.motion, o, this.scratch);
                if (p.x < cam.x - halfW || p.x > cam.x + halfW || p.y < cam.y - halfH || p.y > cam.y + halfH) continue;
                const x = p.x;
                const y = p.y;
                this.drawn.push({ m, x, y });
                const color = shortageColor(m);
                if (o instanceof BuiltObject && m.site !== null) {
                    // A yard: a diamond.
                    g.poly([x, y - r * 1.15, x + r * 1.15, y, x, y + r * 1.15, x - r * 1.15, y]).fill({ color: 0x000000, alpha: 0.35 }).stroke({ width: 2 * f, color, alpha: 0.95 });
                } else {
                    g.circle(x, y, r).fill({ color: 0x000000, alpha: 0.35 }).stroke({ width: 2 * f, color, alpha: 0.95 });
                    // A colony whose yard is short as well: an inner ring.
                    if (m.site !== null) g.circle(x, y, r * 0.6).stroke({ width: 1.5 * f, color, alpha: 0.9 });
                }
                // The "!" above the marker.
                const top = y - r - 12 * f;
                g.rect(x - 1.5 * f, top, 3 * f, 7 * f).fill({ color, alpha: 1 });
                g.rect(x - 1.5 * f, top + 8.5 * f, 3 * f, 2.5 * f).fill({ color, alpha: 1 });
            }
        }
        g.visible = this.drawn.length > 0;
    }

    /** The marker under world (wx, wy), for the hover tooltip. */
    hitTest(wx: number, wy: number, z: number): ShortageMarker | null {
        if (!this.g.visible) return null;
        return hitShortageMarker(this.drawn, wx, wy, z);
    }

    /** The markers of the last refresh (screenshot / perf checks). */
    get currentMarkers(): readonly ShortageMarker[] {
        return this.markers;
    }
}
