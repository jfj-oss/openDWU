// Characters & Victory (docs/CHARACTERS_AND_VICTORY.md §4.3): a gold ring on every VIP shuttle the viewer may see —
// its own, and foreign ones inside its sensor range and not fogged (the same IsObjectVisibleToThisEmpire test the
// ship itself is drawn with, fog.ts builtObjectVisibleToPlayer) — the shuttle's name / passenger on hover, and with
// the "VIP traffic" overlay the own shuttles' routes. Our own procedural art (no original image). Read-only.

import { Container, Graphics } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { MapOverlayState } from '../ui/mapOverlays';
import { vipMarkers, type VipMarker } from '../sim/scenario/charactersVictory/vip';
import { builtObjectVisibleToPlayer } from './fog';
import { circleAtScreenRes } from './screenCircle';
import { drawnBuiltObjectPos, drawnPositionOf, type MotionInterpolator, type Point } from './renderInterp';
import type { BuiltObject } from '../sim/builtObject';
import { localViewerEmpire } from '../localViewer';

/** The ring colour (a very dark orange) and its opacity: a faint marker, not a gold beacon. */
export const VIP_RING_COLOR = 0x8a3f00;
const VIP_RING_ALPHA = 0.7;

/** Ring radius in screen pixels. */
const VIP_RING_PX = 11;

export class VipMarkerLayer {
    private readonly g = new Graphics();
    /**
     * One Graphics per ring, positioned on its shuttle and drawn about its own origin in screen-sized units. A single
     * world-space Graphics stored its vertices at galaxy coordinates (~1e6), where float32 rounding is several screen
     * pixels at high zoom, so the rings came out blotchy. Local geometry keeps the ring round at any zoom.
     */
    private readonly rings = new Container();
    private readonly ringPool: Graphics[] = [];
    private list: VipMarker[] = [];
    private frame = 0;
    private readonly pt: Point = { x: 0, y: 0 };
    motion: MotionInterpolator | null = null;

    constructor(
        private readonly galaxy: Galaxy,
        root: Container,
        private readonly state: MapOverlayState,
    ) {
        root.addChild(this.g);
        root.addChild(this.rings);
    }

    private ringAt(i: number): Graphics {
        let g = this.ringPool[i];
        if (g === undefined) {
            g = new Graphics();
            this.ringPool.push(g);
            this.rings.addChild(g);
        }
        g.visible = true;
        return g;
    }

    /** Where the shuttle's symbol is drawn: the galaxy markers' position (drawnBuiltObjectPos), so the ring stays on the icon
     *  at galaxy zoom too, where a ship that is not drawn as a sprite is sampled along its route instead of snapshot-lerped. */
    private shuttlePos(bo: BuiltObject): Point {
        if (this.motion === null) return drawnPositionOf(null, bo, this.pt);
        const p = drawnBuiltObjectPos(this.motion, bo);
        this.pt.x = p.x;
        this.pt.y = p.y;
        return this.pt;
    }

    /** Re-reads the marker list 4 times a second; the rings follow the drawn ships every frame. */
    update(z: number): void {
        const g = this.g;
        if (this.galaxy.scenario === null) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            this.hideRings(0);
            return;
        }
        const viewer = localViewerEmpire(this.galaxy);
        if (this.frame++ % 15 === 0) this.list = vipMarkers(this.galaxy, viewer, (bo) => builtObjectVisibleToPlayer(this.galaxy, viewer, bo));
        g.clear();
        if (this.list.length === 0) {
            g.visible = false;
            this.hideRings(0);
            return;
        }
        let n = 0;
        for (const m of this.list) {
            if (m.shuttle.hasBeenDestroyed) continue;
            const p = this.shuttlePos(m.shuttle);
            if (this.state.vipTraffic && m.destination !== null) {
                g.moveTo(p.x, p.y).lineTo(m.destination.x, m.destination.y).stroke({ width: 1.5 / z, color: VIP_RING_COLOR, alpha: 0.45 });
            }
            const ring = this.ringAt(n++);
            ring.clear();
            ring.position.set(p.x, p.y);
            circleAtScreenRes(ring, 0, 0, VIP_RING_PX / z, z).stroke({ width: 1.2 / z, color: VIP_RING_COLOR, alpha: VIP_RING_ALPHA });
            circleAtScreenRes(ring, 0, 0, (VIP_RING_PX + 2.5) / z, z).stroke({ width: 0.8 / z, color: VIP_RING_COLOR, alpha: VIP_RING_ALPHA * 0.5 });
        }
        this.hideRings(n);
        g.visible = true;
    }

    /** Hides the pooled rings from index `from` on. */
    private hideRings(from: number): void {
        for (let i = from; i < this.ringPool.length; i++) {
            const ring = this.ringPool[i];
            if (ring.visible) {
                ring.clear();
                ring.visible = false;
            }
        }
    }

    /** The label of the VIP shuttle under a world point (hover), or null. */
    hitTest(x: number, y: number, z: number): string | null {
        const r = 14 / z;
        for (const m of this.list) {
            if (m.shuttle.hasBeenDestroyed) continue;
            const p = this.shuttlePos(m.shuttle);
            if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r) return m.label;
        }
        return null;
    }
}
