// 19r item 5: wreck-field debris (src/render/wreckDebris.ts) over the 19e-7 record shape — the art a wreck is cut
// from, the fragment plan / cut, pods going out with decay; the state is absent on this branch (presence check).
import { describe, expect, it } from 'vitest';
import {
    cutFragment,
    familyPictureRef,
    fragmentCount,
    insidePolygon,
    planFragments,
    podsLit,
    wreckPictureRef,
    wreckRemainingAt,
    type WreckShape,
} from '../src/render/wreckDebris';
import { wreckageStateOf } from '../src/render/artBundleLayer';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { builtObjectImagePath } from '../src/render/builtObjectLayer';
import type { Galaxy } from '../src/sim/galaxy';

const W: WreckShape = { id: 9, builtObjectId: 40, designName: 'Lance', subRole: BuiltObjectSubRole.Cruiser, ownerEmpireId: 1, x: 0, y: 0, size: 600, starDate: 0 };

describe('19r wreck art', () => {
    it('family image by sub-role (standard set order), unknown roles → generic base', () => {
        expect(builtObjectImagePath(familyPictureRef(0, BuiltObjectSubRole.Escort))).toBe('family0/escort.png');
        expect(builtObjectImagePath(familyPictureRef(3, BuiltObjectSubRole.Cruiser))).toBe('family3/cruiser.png');
        expect(builtObjectImagePath(familyPictureRef(2, BuiltObjectSubRole.DefensiveBase))).toBe('family2/genericbase.png');
    });
    it('the owner design by name wins, else the owner race family, else family 0', () => {
        const owner = { designs: [{ name: 'Lance', pictureRef: 150 }], dominantRace: { designsPictureFamilyIndex: 5 } };
        expect(wreckPictureRef(W, owner)).toBe(150);
        expect(wreckPictureRef({ ...W, designName: 'Other' }, owner)).toBe(familyPictureRef(5, BuiltObjectSubRole.Cruiser));
        expect(wreckPictureRef(W, null)).toBe(familyPictureRef(0, BuiltObjectSubRole.Cruiser));
    });
});

describe('19r fragments and pods', () => {
    const side = 60;
    const hull = new Uint8Array(side * side);
    for (let y = 22; y < 38; y++) for (let x = 6; x < 54; x++) hull[y * side + x] = 1;
    it('plans 3-6 fragments along the hull, deterministic per wreck', () => {
        expect(fragmentCount(50)).toBe(3);
        expect(fragmentCount(5000)).toBe(6);
        const a = planFragments(hull, side, 9, 4);
        expect(a).toEqual(planFragments(hull, side, 9, 4));
        expect(a).not.toEqual(planFragments(hull, side, 10, 4));
        expect(a.length).toBe(4);
        for (const f of a) expect(hull[Math.round(f.cy) * side + Math.round(f.cx)]).toBe(1);
        // Spread stern → bow.
        const xs = a.map((f) => f.cx);
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
    });
    it('a cut keeps only polygon ∩ hull pixels, darkened', () => {
        const rgba = new Uint8ClampedArray(side * side * 4);
        for (let i = 0; i < side * side; i++) if (hull[i]) rgba.set([200, 200, 200, 255], i * 4);
        const plan = planFragments(hull, side, 3, 3)[1];
        const f = cutFragment({ rgba, side }, plan, 3);
        let n = 0;
        for (let y = 0; y < f.h; y++) {
            for (let x = 0; x < f.w; x++) {
                const o = (y * f.w + x) * 4;
                if (f.rgba[o + 3] === 0) continue;
                n++;
                const sx = x + Math.round(plan.cx - f.ox);
                const sy = y + Math.round(plan.cy - f.oy);
                expect(hull[sy * side + sx]).toBe(1);
                expect(insidePolygon(plan.poly, sx + 0.5, sy + 0.5)).toBe(true);
                expect(f.rgba[o]).toBeLessThan(200);
            }
        }
        expect(n).toBeGreaterThan(10);
    });
    it('pods go out as the wreck decays (linear wreckRemaining)', () => {
        const Y = 600000;
        expect(wreckRemainingAt(0, 0, 10, Y)).toBe(1);
        expect(wreckRemainingAt(5 * Y, 0, 10, Y)).toBeCloseTo(0.5, 9);
        expect(wreckRemainingAt(20 * Y, 0, 10, Y)).toBe(0);
        expect(podsLit(6, 1)).toBe(6);
        expect(podsLit(6, 0.5)).toBe(3);
        expect(podsLit(6, 0.01)).toBe(1);
        expect(podsLit(6, 0)).toBe(0);
    });
    it('the wreckage state is read only when present', () => {
        expect(wreckageStateOf({ scenario: null } as unknown as Galaxy)).toBeNull();
        expect(wreckageStateOf({ scenario: { state: {} } } as unknown as Galaxy)).toBeNull();
        const st = { fields: [] };
        expect(wreckageStateOf({ scenario: { state: { wreckage: st } } } as unknown as Galaxy)).toBe(st);
    });
});
