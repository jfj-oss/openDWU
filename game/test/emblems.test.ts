// 19r items 3 / 6: derived flags / portraits (src/render/emblemArt.ts) — the GenerateEmpireFlag port, deterministic
// composition of the company / seceded / exile / ghost variants and the herder art — and the lineage reader
// (src/render/empireLineage.ts) over the other packages' state shapes.
import { describe, expect, it } from 'vitest';
import {
    FLAG_H,
    FLAG_W,
    blankImage,
    companyFlag,
    composeEmpireFlag,
    corporatePortrait,
    exileFlag,
    exilePortrait,
    ghostFlag,
    ghostPortrait,
    herderFlag,
    herderPortrait,
    hoodDepth,
    secededFlag,
    secededPortrait,
    type RgbaImage,
} from '../src/render/emblemArt';
import { empireLineage } from '../src/render/empireLineage';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';

/** A 20 × 12 flag shape: a white bar across the middle rows. */
function shape(): RgbaImage {
    const s = blankImage(20, 12);
    for (let y = 5; y < 7; y++) for (let x = 0; x < 20; x++) s.data.set([255, 255, 255, 255], (y * 20 + x) * 4);
    return s;
}
function portrait(): RgbaImage {
    const p = blankImage(60, 60);
    for (let i = 0; i < 3600; i++) p.data.set([(i * 7) % 256, (i * 3) % 256, (i * 11) % 256, 255], i * 4);
    return p;
}
const px = (img: RgbaImage, x: number, y: number): number[] => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

describe('19r GenerateEmpireFlag port', () => {
    it('main-colour field, the shape tinted by the secondary colour, 100 × 60', () => {
        const f = composeEmpireFlag(shape(), 0x204080, 0xff8000);
        expect([f.w, f.h]).toEqual([FLAG_W, FLAG_H]);
        expect(px(f, 50, 5)).toEqual([0x20, 0x40, 0x80, 255]);
        expect(px(f, 50, 30)).toEqual([0xff, 0x80, 0x00, 255]);
        const plain = composeEmpireFlag(null, 0x112233, 0xffffff);
        expect(px(plain, 3, 3)).toEqual([0x11, 0x22, 0x33, 255]);
    });
});

describe('19r derived flags', () => {
    const base = composeEmpireFlag(shape(), 0x204080, 0xff8000);
    it('deterministic: same inputs, same bytes', () => {
        expect(companyFlag(base, 0x33aa33, 0xffffff).data).toEqual(companyFlag(base, 0x33aa33, 0xffffff).data);
        expect(secededFlag(shape(), 0xaa2222, 0xeeeeee, 5).data).toEqual(secededFlag(shape(), 0xaa2222, 0xeeeeee, 5).data);
        expect(exileFlag(base).data).toEqual(exileFlag(base).data);
        expect(ghostFlag(base).data).toEqual(ghostFlag(base).data);
        expect(herderFlag().data).toEqual(herderFlag().data);
        expect(secededFlag(shape(), 0xaa2222, 0xeeeeee, 5).data).not.toEqual(secededFlag(shape(), 0xaa2222, 0xeeeeee, 6).data);
    });
    it('company: founder flag with a seal in the hoist corner, the rest untouched', () => {
        const f = companyFlag(base, 0x33aa33, 0xffffff);
        expect(px(f, 90, 50)).toEqual(px(base, 90, 50));
        expect(px(f, 17, 17)).not.toEqual(px(base, 17, 17));
    });
    it('seceded: the parent shape in the new colours, torn at the fly', () => {
        const f = secededFlag(shape(), 0xaa2222, 0xeeeeee, 5);
        expect(px(f, 5, 5)).toEqual([0xaa, 0x22, 0x22, 255]);
        for (let y = 0; y < FLAG_H; y++) expect(f.data[(y * FLAG_W + FLAG_W - 1) * 4 + 3]).toBe(0);
        expect(f.data[(30 * FLAG_W + 2) * 4 + 3]).toBe(255);
    });
    it('exile: black border; ghost: desaturated / cold with a skull', () => {
        const e = exileFlag(base);
        expect(px(e, 0, 0)).toEqual([6, 6, 8, 255]);
        expect(px(e, 50, 10)).toEqual(px(base, 50, 10));
        const g = ghostFlag(base);
        const [r, gg, b] = px(g, 5, 5);
        expect(b).toBeGreaterThanOrEqual(r);
        expect(Math.abs(r - gg)).toBeLessThan(20);
        const [sr, sg, sb] = px(g, 50, 22);
        expect(sr + sg + sb).toBeGreaterThan(500); // bone
    });
});

describe('19r derived / herder portraits', () => {
    const p = portrait();
    it('deterministic and framed', () => {
        expect(corporatePortrait(p, 0x3344aa).data).toEqual(corporatePortrait(p, 0x3344aa).data);
        expect(secededPortrait(p, 0x3344aa, 2).data).toEqual(secededPortrait(p, 0x3344aa, 2).data);
        expect(exilePortrait(p).data).toEqual(exilePortrait(p).data);
        expect(ghostPortrait(p).data).toEqual(ghostPortrait(p).data);
        expect(px(exilePortrait(p), 0, 30)).toEqual([6, 6, 8, 255]);
        expect(secededPortrait(p, 0x3344aa, 2).data[(59 * 60 + 59) * 4 + 3]).toBe(0);
    });
    it('herder hood covers the frame outside the face opening and keeps the face', () => {
        const h = herderPortrait(p);
        expect(h.data).toEqual(herderPortrait(p).data);
        expect(hoodDepth(1, 1, 60, 60)).toBeGreaterThan(0);
        expect(hoodDepth(30, 36, 60, 60)).toBeLessThan(0);
        // A corner pixel is hood (earth tones: red ≥ green ≥ blue); the face centre differs from the hood.
        const [r, g, b, a] = px(h, 2, 2);
        expect(a).toBe(255);
        expect(r).toBeGreaterThanOrEqual(g);
        expect(g).toBeGreaterThanOrEqual(b);
    });
});

describe('19r empire lineage (other packages’ state, read by shape)', () => {
    const mk = (id: number, name: string): Empire => ({ empireId: id, name } as unknown as Empire);
    const a = mk(1, 'Aurel Empire');
    const b = mk(2, 'Bex Company');
    const c = mk(3, 'Free Aurel');
    const d = mk(4, 'Aurel Empire Government in Exile');
    const g = mk(5, 'Ghosts of Old');
    const dead = mk(6, 'Old Realm');
    const galaxy = (state: Record<string, unknown> | null): Galaxy =>
        ({ scenario: state === null ? null : { state }, empires: [a, b, c, d, g, dead], pirateEmpires: [] }) as unknown as Galaxy;
    it('none without a scenario or records', () => {
        expect(empireLineage(galaxy(null), b)).toBeNull();
        expect(empireLineage(galaxy({}), b)).toBeNull();
    });
    it('company / seceded / exile / ghost', () => {
        const gx = galaxy({
            'charteredCompanies.charters': { charters: [{ companyId: 2, founderId: 1 }] },
            politics: { events: [{ kind: 'secession', success: true, empire: a, other: c }] },
            demographics: { exileFounded: new Set([1]) },
            ghostArmada: { risen: [{ deadEmpireId: 6, deadEmpireName: 'Old Realm', faction: g }] },
        });
        expect(empireLineage(gx, b)).toEqual({ kind: 'company', parent: a, parentName: 'Aurel Empire' });
        expect(empireLineage(gx, c)?.kind).toBe('seceded');
        expect(empireLineage(gx, c)?.parent).toBe(a);
        expect(empireLineage(gx, d)?.kind).toBe('exile');
        expect(empireLineage(gx, g)).toEqual({ kind: 'ghost', parent: dead, parentName: 'Old Realm' });
        expect(empireLineage(gx, a)).toBeNull();
    });
});
