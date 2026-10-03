// Zoom perf helpers (render: wheel-zoom lag on late games): detached hidden subtrees, circles tessellated for their
// on-screen size, the cached anisotropy limit.
import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { AttachedChildren } from '../src/render/renderGroups';
import { circleAtScreenRes } from '../src/render/screenCircle';
import { installGlParameterCache } from '../src/render/glParamCache';

function named(n: number): Container[] {
    return Array.from({ length: n }, (_, i) => {
        const c = new Container();
        c.label = `c${i}`;
        return c;
    });
}
const labels = (root: Container): string[] => root.children.map((c) => c.label);

describe('AttachedChildren', () => {
    it('keeps only the shown children attached, in draw order, through single attach / detach steps', () => {
        const root = new Container();
        const list = new AttachedChildren(root);
        const kids = named(8);
        for (const k of kids) list.add(k);
        expect(root.children.length).toBe(0);
        for (const i of [5, 1, 7, 3]) list.set(kids[i], true);
        list.flush();
        expect(labels(root)).toEqual(['c1', 'c3', 'c5', 'c7']);
        list.set(kids[3], false);
        list.set(kids[0], true);
        list.set(kids[6], true);
        list.flush();
        expect(labels(root)).toEqual(['c0', 'c1', 'c5', 'c6', 'c7']);
        expect(kids[3].parent).toBeNull();
        expect(list.isAttached(kids[6])).toBe(true);
        expect(list.isAttached(kids[3])).toBe(false);
    });

    it('rebuilds in one pass for many changes and ignores on/off flips within a frame', () => {
        const root = new Container();
        const list = new AttachedChildren(root);
        const kids = named(100);
        for (const k of kids) list.add(k);
        for (let i = 0; i < 100; i += 2) list.set(kids[i], true);
        list.flush();
        expect(labels(root)).toEqual(kids.filter((_, i) => i % 2 === 0).map((k) => k.label));
        // Flip one on and back off before the flush: no change.
        list.set(kids[1], true);
        list.set(kids[1], false);
        list.flush();
        expect(root.children.length).toBe(50);
        expect(kids[1].parent).toBeNull();
        // Everything on (a zoom-out to the whole galaxy).
        for (const k of kids) list.set(k, true);
        list.flush();
        expect(labels(root)).toEqual(kids.map((k) => k.label));
    });

    it('a flush with nothing pending leaves the children (and Pixi structure) alone', () => {
        const root = new Container();
        const list = new AttachedChildren(root);
        const [a] = named(1);
        list.add(a);
        list.set(a, true);
        list.flush();
        const before = root.children.slice();
        list.set(a, true); // no change
        list.flush();
        expect(root.children).toEqual(before);
    });
});

describe('circleAtScreenRes', () => {
    it('draws the same world circle, built at its on-screen radius', () => {
        const z = 1 / 30000; // galaxy zoom
        const g = new Graphics();
        circleAtScreenRes(g, 5_000_000, 7_000_000, 20 * 30000, z).stroke({ width: 3 / z, color: 0xffffff });
        // World-space extent: the circle of world radius 600 000 plus half the stroke.
        const b = g.bounds;
        const half = 1.5 / z;
        expect(b.minX).toBeCloseTo(5_000_000 - 600_000 - half, -1);
        expect(b.maxX).toBeCloseTo(5_000_000 + 600_000 + half, -1);
        expect(b.minY).toBeCloseTo(7_000_000 - 600_000 - half, -1);
        expect(b.maxY).toBeCloseTo(7_000_000 + 600_000 + half, -1);
        // The shape itself is the 20 px screen circle (so Pixi gives it ~120 points, not ~20 000).
        const instr = g.context.instructions[0] as unknown as { data: { path: { shapePath: { shapePrimitives: { shape: { radius: number } }[] } } } };
        expect(instr.data.path.shapePath.shapePrimitives[0].shape.radius).toBeCloseTo(20, 6);
    });

    it('leaves the context transform as it was for the shapes drawn after it', () => {
        const g = new Graphics();
        circleAtScreenRes(g, 100, 100, 50, 0.5);
        g.rect(0, 0, 10, 10).fill(0xffffff);
        const b = g.bounds;
        expect(b.minX).toBeCloseTo(0, 6);
        expect(b.minY).toBeCloseTo(0, 6);
    });
});

describe('installGlParameterCache', () => {
    it('asks the context for the anisotropy limit once and passes other queries through', () => {
        const calls: number[] = [];
        const gl = {
            getParameter(p: number): unknown {
                calls.push(p);
                return p === 0x84ff ? 16 : p;
            },
        };
        installGlParameterCache({ gl });
        installGlParameterCache({ gl }); // idempotent
        expect(gl.getParameter(0x84ff)).toBe(16);
        expect(gl.getParameter(0x84ff)).toBe(16);
        expect(gl.getParameter(0x0d33)).toBe(0x0d33);
        expect(gl.getParameter(0x0d33)).toBe(0x0d33);
        expect(calls).toEqual([0x84ff, 0x0d33, 0x0d33]);
    });

    it('does not keep a lost-context null', () => {
        let lost = true;
        const gl = { getParameter: (_p: number): unknown => (lost ? null : 8) };
        installGlParameterCache({ gl });
        expect(gl.getParameter(0x84ff)).toBeNull();
        lost = false;
        expect(gl.getParameter(0x84ff)).toBe(8);
    });

    it('ignores a renderer without a GL context', () => {
        expect(() => installGlParameterCache({})).not.toThrow();
        expect(() => installGlParameterCache(null)).not.toThrow();
    });
});
