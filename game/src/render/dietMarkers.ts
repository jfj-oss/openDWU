// [charactersVictory] The Interstellar Diet on the map (docs/CHARACTERS_AND_VICTORY.md §9): the host world's seat icon
// (visible to everyone, like a wonder: the Diet is public) and the enforcer emblem on every enforcer fleet the viewer
// can see (fog.ts builtObjectVisibleToPlayer, the test the ships are drawn with). Our own procedural art (dietArt.ts).
// Read-only: the marks come from the pure dietMapMarks view.

import { Container, Graphics } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import { dietMapMarks, type DietMapMarks } from '../sim/scenario/charactersVictory/diet/dietView';
import { builtObjectVisibleToPlayer } from './fog';
import { drawnPositionOf, type MotionInterpolator, type Point } from './renderInterp';
import { localViewerEmpire } from '../localViewer';
import { drawDietSeat, drawEnforcerEmblem } from './dietArt';

/** Seat pulse period while the Diet is in session (real seconds): a slow, calm breathing. */
const SEAT_PULSE_S = 4;

export class DietMarkerLayer {
    // The marks are drawn once at screen-pixel size (z = 1) in their own Graphics and placed with a 1/z scale: drawing
    // them straight in world units at 1/z made Pixi tessellate the curves at a tiny size, so they turned blocky and
    // unreadable when zoomed far in.
    private readonly g = new Container();
    private readonly seat = new Graphics();
    private readonly emblems: Graphics[] = [];
    private seatKey = '';
    private marks: DietMapMarks | null = null;
    private frame = 0;
    private readonly pt: Point = { x: 0, y: 0 };
    motion: MotionInterpolator | null = null;

    constructor(
        private readonly galaxy: Galaxy,
        root: Container,
    ) {
        root.addChild(this.g);
        this.g.addChild(this.seat);
    }

    private emblem(i: number): Graphics {
        let e = this.emblems[i];
        if (e === undefined) {
            e = new Graphics();
            drawEnforcerEmblem(e, 0, 0, 1);
            this.emblems.push(e);
            this.g.addChild(e);
        }
        return e;
    }

    update(z: number): void {
        const g = this.g;
        if (this.galaxy.scenario === null) {
            if (g.visible) g.visible = false;
            return;
        }
        const viewer = localViewerEmpire(this.galaxy);
        if (this.frame++ % 15 === 0) this.marks = dietMapMarks(this.galaxy, viewer, (bo) => builtObjectVisibleToPlayer(this.galaxy, viewer, bo));
        const m = this.marks;
        if (m === null || (m.world === null && m.fleets.length === 0)) {
            g.visible = false;
            return;
        }
        const s = 1 / z;
        if (m.world !== null) {
            const inSession = m.world.inSession;
            const pulse = inSession ? 0.5 + 0.5 * Math.sin((performance.now() / 1000) * ((2 * Math.PI) / SEAT_PULSE_S)) : 0;
            // Redraw only when the look changes (pulse quantised to 1/32).
            const key = inSession ? `s${Math.round(pulse * 32)}` : 'n';
            if (key !== this.seatKey) {
                this.seatKey = key;
                this.seat.clear();
                drawDietSeat(this.seat, 0, 0, 1, inSession, pulse);
            }
            this.seat.position.set(m.world.x, m.world.y);
            this.seat.scale.set(s);
            this.seat.visible = true;
        } else this.seat.visible = false;
        let n = 0;
        for (const f of m.fleets) {
            if (f.lead.hasBeenDestroyed) continue;
            const p = drawnPositionOf(this.motion, f.lead, this.pt);
            const e = this.emblem(n++);
            e.position.set(p.x, p.y);
            e.scale.set(s);
            e.visible = true;
        }
        for (let i = n; i < this.emblems.length; i++) this.emblems[i].visible = false;
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
