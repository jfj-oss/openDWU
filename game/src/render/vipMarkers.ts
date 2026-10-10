// Characters & Victory (docs/CHARACTERS_AND_VICTORY.md §4.3): a gold ring on every VIP shuttle the viewer may see —
// its own, and foreign ones inside its sensor range and not fogged (the same IsObjectVisibleToThisEmpire test the
// ship itself is drawn with, fog.ts builtObjectVisibleToPlayer) — the shuttle's name / passenger on hover, and with
// the "VIP traffic" overlay the own shuttles' routes. Our own procedural art (no original image). Read-only.

import { Graphics, type Container } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { MapOverlayState } from '../ui/mapOverlays';
import { vipMarkers, type VipMarker } from '../sim/scenario/charactersVictory/vip';
import { builtObjectVisibleToPlayer } from './fog';
import { circleAtScreenRes } from './screenCircle';
import { drawnPositionOf, type MotionInterpolator, type Point } from './renderInterp';
import { localViewerEmpire } from '../localViewer';

/** The ring colour (gold). */
export const VIP_RING_COLOR = 0xffd24a;

export class VipMarkerLayer {
    private readonly g = new Graphics();
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
    }

    /** Re-reads the marker list 4 times a second; the rings follow the drawn ships every frame. */
    update(z: number): void {
        const g = this.g;
        if (this.galaxy.scenario === null) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            return;
        }
        const viewer = localViewerEmpire(this.galaxy);
        if (this.frame++ % 15 === 0) this.list = vipMarkers(this.galaxy, viewer, (bo) => builtObjectVisibleToPlayer(this.galaxy, viewer, bo));
        g.clear();
        if (this.list.length === 0) {
            g.visible = false;
            return;
        }
        const r = 11 / z;
        for (const m of this.list) {
            if (m.shuttle.hasBeenDestroyed) continue;
            const p = drawnPositionOf(this.motion, m.shuttle, this.pt);
            if (this.state.vipTraffic && m.destination !== null) {
                g.moveTo(p.x, p.y).lineTo(m.destination.x, m.destination.y).stroke({ width: 1.5 / z, color: VIP_RING_COLOR, alpha: 0.45 });
            }
            circleAtScreenRes(g, p.x, p.y, r, z).stroke({ width: 2 / z, color: VIP_RING_COLOR, alpha: 1 });
            circleAtScreenRes(g, p.x, p.y, r + 3 / z, z).stroke({ width: 1 / z, color: VIP_RING_COLOR, alpha: 0.5 });
        }
        g.visible = true;
    }

    /** The label of the VIP shuttle under a world point (hover), or null. */
    hitTest(x: number, y: number, z: number): string | null {
        const r = 14 / z;
        for (const m of this.list) {
            if (m.shuttle.hasBeenDestroyed) continue;
            const p = drawnPositionOf(this.motion, m.shuttle, this.pt);
            if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r) return `${m.shuttle.name}\n${m.label}`;
        }
        return null;
    }
}
