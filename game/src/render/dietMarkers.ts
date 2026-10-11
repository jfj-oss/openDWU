// [charactersVictory] The Interstellar Diet on the map (docs/CHARACTERS_AND_VICTORY.md §9): the host world's seat icon
// (visible to everyone, like a wonder: the Diet is public) and the enforcer emblem on every enforcer fleet the viewer
// can see (fog.ts builtObjectVisibleToPlayer, the test the ships are drawn with). Our own procedural art (dietArt.ts).
// Read-only: the marks come from the pure dietMapMarks view.

import { Graphics, type Container } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import { dietMapMarks, type DietMapMarks } from '../sim/scenario/charactersVictory/diet/dietView';
import { builtObjectVisibleToPlayer } from './fog';
import { drawnPositionOf, type MotionInterpolator, type Point } from './renderInterp';
import { localViewerEmpire } from '../localViewer';
import { drawDietSeat, drawEnforcerEmblem } from './dietArt';

export class DietMarkerLayer {
    private readonly g = new Graphics();
    private marks: DietMapMarks | null = null;
    private frame = 0;
    private readonly pt: Point = { x: 0, y: 0 };
    motion: MotionInterpolator | null = null;

    constructor(
        private readonly galaxy: Galaxy,
        root: Container,
    ) {
        root.addChild(this.g);
    }

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
        if (this.frame++ % 15 === 0) this.marks = dietMapMarks(this.galaxy, viewer, (bo) => builtObjectVisibleToPlayer(this.galaxy, viewer, bo));
        g.clear();
        const m = this.marks;
        if (m === null || (m.world === null && m.fleets.length === 0)) {
            g.visible = false;
            return;
        }
        const pulse = 0.5 + 0.5 * Math.sin(this.frame / 12);
        if (m.world !== null) drawDietSeat(g, m.world.x, m.world.y, z, m.world.inSession, pulse);
        for (const f of m.fleets) {
            if (f.lead.hasBeenDestroyed) continue;
            const p = drawnPositionOf(this.motion, f.lead, this.pt);
            drawEnforcerEmblem(g, p.x, p.y, z);
        }
        g.visible = true;
    }

    /** The label of the seat icon or an enforcer emblem under a world point (hover), or null. */
    hitTest(x: number, y: number, z: number): string | null {
        const m = this.marks;
        if (m === null) return null;
        const r = 16 / z;
        if (m.world !== null) {
            const cy = m.world.y - 26 / z;
            if ((m.world.x - x) ** 2 + (cy - y) ** 2 <= r * r) return m.world.label;
        }
        for (const f of m.fleets) {
            if (f.lead.hasBeenDestroyed) continue;
            const p = drawnPositionOf(this.motion, f.lead, this.pt);
            if ((p.x + 14 / z - x) ** 2 + (p.y - 16 / z - y) ** 2 <= r * r) return f.label;
        }
        return null;
    }
}
