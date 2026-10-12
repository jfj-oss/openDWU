// [voidbloom] The Voidbloom War on the map: a small spore glyph over each Voidbloom world the viewer has explored, and
// a faint violet ring around colonies where addiction has taken hold (wider and stronger with it). Calm and quiet:
// our own procedural art, no animation. Read-only: the marks come from the pure voidbloomMapMarks view.

import { Container, Graphics } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import { voidbloomMapMarks, type VbMapMarks } from '../sim/scenario/voidbloom/view';
import { localViewerEmpire } from '../localViewer';

const SPORE = 0xb48ad8;
const SPORE_DARK = 0x3a2650;

function drawSpore(g: Graphics, owned: boolean): void {
    g.clear();
    g.circle(0, 0, 7).fill({ color: SPORE_DARK, alpha: 0.85 }).stroke({ color: SPORE, width: 1.2, alpha: owned ? 1 : 0.7 });
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g.circle(Math.cos(a) * 3.6, Math.sin(a) * 3.6, 1.3).fill({ color: SPORE, alpha: 0.95 });
    }
    g.circle(0, 0, 1.4).fill({ color: SPORE, alpha: 0.95 });
}

export class VoidbloomMarkerLayer {
    private readonly g = new Container();
    private readonly rings = new Graphics();
    private readonly glyphs: Graphics[] = [];
    private marks: VbMapMarks | null = null;
    private frame = 0;
    private ringKey = '';

    constructor(
        private readonly galaxy: Galaxy,
        root: Container,
    ) {
        root.addChild(this.g);
        this.g.addChild(this.rings);
    }

    update(z: number): void {
        if (this.galaxy.scenario === null) {
            if (this.g.visible) this.g.visible = false;
            return;
        }
        if (this.frame++ % 30 === 0) this.marks = voidbloomMapMarks(this.galaxy, localViewerEmpire(this.galaxy));
        const m = this.marks;
        if (m === null || (m.worlds.length === 0 && m.addicted.length === 0)) {
            this.g.visible = false;
            return;
        }
        const s = 1 / z;
        const key = `${z.toFixed(4)}|${m.addicted.length}|${m.addicted.map((x) => Math.round(x.a * 20)).join(',')}`;
        if (key !== this.ringKey) {
            this.ringKey = key;
            this.rings.clear();
            for (const c of m.addicted) this.rings.circle(c.x, c.y, (14 + 16 * c.a) * s).stroke({ color: SPORE, width: 1.5 * s, alpha: 0.2 + 0.5 * c.a });
        }
        let n = 0;
        for (const w of m.worlds) {
            let gl = this.glyphs[n];
            if (gl === undefined) {
                gl = new Graphics();
                this.glyphs.push(gl);
                this.g.addChild(gl);
            }
            drawSpore(gl, w.owned);
            gl.position.set(w.x + 16 * s, w.y + 16 * s);
            gl.scale.set(s);
            gl.visible = true;
            n++;
        }
        for (let i = n; i < this.glyphs.length; i++) this.glyphs[i].visible = false;
        this.g.visible = true;
    }

    /** The label of a mark under a world point (hover), or null. */
    hitTest(x: number, y: number, z: number): string | null {
        const m = this.marks;
        if (m === null) return null;
        const r = 10 / z;
        for (const w of m.worlds) if ((w.x + 16 / z - x) ** 2 + (w.y + 16 / z - y) ** 2 <= r * r) return w.label;
        return null;
    }
}
