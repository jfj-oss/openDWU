// 19g-7b shared creature rig (src/render/creatureRig.ts): every variant body stays inside the ORIGINAL creature frames'
// measured value range, contrast and edge softness (artStats, the whale pilot's statistics — frames read from the install,
// never copied); the tamed-look harness state machine; container count / debris / out-of-phase work lights.
import { describe, expect, it } from 'vitest';
import { decodePng, dwuAssetPath } from './helpers/pngDecode';
import {
    FAUNA_BODIES,
    BEACON_PERIOD_S,
    CARGO_U_FROM,
    CARGO_U_TO,
    HARNESS_DEBRIS_S,
    beaconOn,
    catenarySag,
    ropeSlack,
    cargoLanes,
    containersPerLane,
    HARNESS_FADE_S,
    PALETTE_FRAMES,
    artStats,
    containerCount,
    containerLightId,
    containerRgba,
    debrisOffset,
    fallbackPaletteSource,
    harnessAlpha,
    harnessInit,
    harnessStep,
    paletteSourceFromRgba,
    plainRamp,
    rasterBody,
    restPose,
    silhouetteAt,
    type ArtStats,
} from '../src/render/creatureRig';
import { lightsOn } from '../src/render/ambientLayer';
import { faunaVariantTable } from '../src/sim/scenario/newFauna/common';

const ORIGINALS = ['kaltor/Kaltor_00000.png', 'ardilus/ArdillusMoving2_00000.png', 'spaceslug/Slug_00000.png', 'sandslug/Sandworm_00000.png'];
const haveInstall = dwuAssetPath('images/units/creatures/' + ORIGINALS[0]) !== null;

function frameStats(rel: string): { stats: ArtStats; data: Uint8ClampedArray; w: number; h: number } {
    const d = decodePng(dwuAssetPath('images/units/creatures/' + rel)!);
    return { stats: artStats(d.data, d.width, d.height), data: d.data, w: d.width, h: d.height };
}

const f3 = (x: number): string => x.toFixed(3);

describe('19g-7b creature rig — body definitions', () => {
    it('every variant look has a body definition (the lantern shoal is a swarm)', () => {
        for (const v of faunaVariantTable()) {
            if (v.look === 'lantern') continue;
            const def = FAUNA_BODIES[v.look];
            expect(def).toBeDefined();
            expect(def.segments).toBeGreaterThanOrEqual(8);
            expect(silhouetteAt(def, 0.5)).toBeGreaterThan(0.2);
        }
    });

    it.skipIf(!haveInstall)('rest-pose statistics stay inside the originals\' value range, contrast and edge softness', () => {
        const orig = ORIGINALS.map((f) => ({ f, s: frameStats(f).stats }));
        const lo = (k: keyof ArtStats): number => Math.min(...orig.map((o) => o.s[k] as number));
        const hi = (k: keyof ArtStats): number => Math.max(...orig.map((o) => o.s[k] as number));
        const rows: string[] = ['look            meanL  stdL   p5L    p95L   sat    hue  softEdge edgeW(skin)'];
        for (const o of orig) rows.push(`${('orig:' + o.f.split('/')[0]).padEnd(15)} ${f3(o.s.meanL)}  ${f3(o.s.stdL)}  ${f3(o.s.p5L)}  ${f3(o.s.p95L)}  ${f3(o.s.meanSat)}  ${String(o.s.hueDeg).padStart(3)}  ${f3(o.s.softEdge)}    ${o.s.edgeWidthFrac.toFixed(4)}`);
        const sources = new Map<string, ReturnType<typeof paletteSourceFromRgba>>();
        for (const def of Object.values(FAUNA_BODIES)) {
            let src = sources.get(def.palette.frame);
            if (src === undefined) {
                const fr = frameStats(PALETTE_FRAMES[def.palette.frame]);
                src = paletteSourceFromRgba(fr.data, fr.w, fr.h);
                sources.set(def.palette.frame, src);
            }
            const parts = rasterBody(def, src);
            const full = restPose(parts);
            const skin = restPose(parts, true);
            const s = artStats(full.data, full.w, full.h);
            const k = artStats(skin.data, skin.w, skin.h);
            rows.push(`${def.id.padEnd(15)} ${f3(s.meanL)}  ${f3(s.stdL)}  ${f3(s.p5L)}  ${f3(s.p95L)}  ${f3(s.meanSat)}  ${String(s.hueDeg).padStart(3)}  ${f3(s.softEdge)}    ${k.edgeWidthFrac.toFixed(4)}`);
            // Value range: mean inside the originals' means; the 5–95 % luma band inside theirs (± 0.015).
            expect(s.meanL, def.id).toBeGreaterThanOrEqual(lo('meanL') - 0.005);
            expect(s.meanL, def.id).toBeLessThanOrEqual(hi('meanL') + 0.005);
            expect(s.p5L, def.id).toBeGreaterThanOrEqual(lo('p5L') - 0.015);
            expect(s.p95L, def.id).toBeLessThanOrEqual(hi('p95L') + 0.015);
            expect(s.p95L, def.id).toBeGreaterThanOrEqual(lo('p95L') - 0.015);
            // Contrast.
            expect(s.stdL, def.id).toBeGreaterThanOrEqual(lo('stdL') * 0.9);
            expect(s.stdL, def.id).toBeLessThanOrEqual(hi('stdL') * 1.1);
            // Edge softness: the skin's alpha-ramp width (fraction of its length), as the pilot matched it.
            expect(k.edgeWidthFrac, def.id).toBeGreaterThanOrEqual(lo('edgeWidthFrac') * 0.8);
            expect(k.edgeWidthFrac, def.id).toBeLessThanOrEqual(hi('edgeWidthFrac') * 1.25);
            // The hue shift took: the look's mean hue is near its definition's hue.
            const dh = Math.abs(((s.hueDeg - def.palette.hueDeg + 540) % 360) - 180);
            expect(dh, def.id).toBeLessThan(25);
        }
        process.stderr.write('\n[creatureRig] rest-pose stats vs the originals\n' + rows.join('\n') + '\n');
    });

    it('rasterises without the install (neutral fallback palette)', () => {
        const parts = rasterBody(FAUNA_BODIES.hunter, fallbackPaletteSource());
        const s = artStats(parts.body.data, parts.body.w, parts.body.h);
        expect(s.pixels).toBeGreaterThan(1000);
    });
});

describe('19g-7b tamed look — harness state machine (pure)', () => {
    it('fades in over ~3 s on taming, drops as debris on going feral, ends, re-fits', () => {
        let s = harnessInit(false);
        expect(s.phase).toBe('none');
        s = harnessStep(s, false, 1);
        expect(s.phase).toBe('none');
        s = harnessStep(s, true, 10);
        expect(s).toEqual({ phase: 'on', since: 10 });
        expect(harnessAlpha(s, 10)).toBe(0);
        expect(harnessAlpha(s, 10 + HARNESS_FADE_S / 2)).toBeCloseTo(0.5, 6);
        expect(harnessAlpha(s, 10 + HARNESS_FADE_S)).toBe(1);
        expect(HARNESS_FADE_S).toBe(3);
        s = harnessStep(s, true, 20);
        expect(s.since).toBe(10);
        s = harnessStep(s, false, 30);
        expect(s).toEqual({ phase: 'dropping', since: 30 });
        expect(harnessAlpha(s, 30 + HARNESS_DEBRIS_S / 2)).toBeCloseTo(0.5, 6);
        s = harnessStep(s, false, 30 + HARNESS_DEBRIS_S - 0.01);
        expect(s.phase).toBe('dropping');
        s = harnessStep(s, false, 30 + HARNESS_DEBRIS_S);
        expect(s.phase).toBe('none');
        // Tamed again mid-drop: a fresh harness fades in.
        s = harnessStep({ phase: 'dropping', since: 50 }, true, 51);
        expect(s).toEqual({ phase: 'on', since: 51 });
        // Seen already tamed (a loaded game): no fade.
        expect(harnessAlpha(harnessInit(true), 0)).toBe(1);
    });

    it('2–6 containers by size; debris drifts off alternate sides and fades; work lights blink out of phase', () => {
        expect(containerCount(40)).toBe(2);
        expect(containerCount(55)).toBe(2);
        expect(containerCount(135)).toBe(3);
        expect(containerCount(1200)).toBe(6);
        expect(containerCount(5000)).toBe(6);
        const a = debrisOffset(0, 1, 10);
        const b = debrisOffset(1, 1, 10);
        expect(Math.sign(a.dy)).toBe(-Math.sign(b.dy));
        expect(debrisOffset(0, HARNESS_DEBRIS_S, 10).alpha).toBe(0);
        expect(Math.abs(debrisOffset(0, 2, 10).dy)).toBeGreaterThan(Math.abs(a.dy));
        // Ambient nav-light pattern (1.5 s on / 1.0 s off) with per-container offsets: not all in step.
        const ids = [0, 1, 2, 3, 4, 5].map((i) => containerLightId(17, i));
        expect(new Set(ids.map((id) => id % 20)).size).toBe(6);
        let differ = 0;
        for (let t = 0; t < 2.5; t += 0.1) {
            const on = ids.map((id) => lightsOn(t, id));
            if (on.some((x) => x !== on[0])) differ++;
        }
        expect(differ).toBeGreaterThan(5);
    });

    it('whale cargo: 2–3 lanes over the middle 60 % of the back; hunter beacon blinks at a slow regular 1 s', () => {
        expect(CARGO_U_TO - CARGO_U_FROM).toBeCloseTo(0.6, 9);
        expect(cargoLanes(1200)).toBe(3);
        expect(cargoLanes(135)).toBe(2);
        expect(containersPerLane(1200)).toBe(4);
        expect(containersPerLane(55)).toBe(2);
        expect(BEACON_PERIOD_S).toBe(1);
        const pattern = [0, 0.25, 0.5, 0.75, 1, 1.25].map((t) => beaconOn(t));
        expect(pattern).toEqual([true, true, false, false, true, true]);
    });

    it('ropes hang as catenaries and slacken / tighten with the body wave (lagging)', () => {
        expect(catenarySag(0, 10)).toBeCloseTo(0, 9);
        expect(catenarySag(1, 10)).toBeCloseTo(0, 9);
        expect(catenarySag(0.5, 10)).toBeCloseTo(10, 9);
        expect(catenarySag(0.25, 10)).toBeGreaterThan(5);
        const vals = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => ropeSlack(t, 0.5, 7.5));
        expect(Math.min(...vals)).toBeGreaterThanOrEqual(0.6);
        expect(Math.max(...vals)).toBeLessThanOrEqual(1.4);
        expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.4);
        // The lag: the slack peaks after the unlagged wave.
        expect(ropeSlack(0, 0, 7.5, 0)).not.toBeCloseTo(ropeSlack(0, 0, 7.5, 0.9), 3);
    });

    it.skipIf(!haveInstall)('containers take the original freighter palette', () => {
        const d = decodePng(dwuAssetPath('images/units/ships/family0/largefreighter.png')!);
        const src = paletteSourceFromRgba(d.data, d.width, d.height);
        const box = containerRgba(plainRamp(src), 48, 28, 0);
        const bs = artStats(box.data, box.w, box.h);
        const fs = artStats(d.data, d.width, d.height);
        expect(Math.abs(((bs.hueDeg - fs.hueDeg + 540) % 360) - 180)).toBeLessThan(40);
        expect(bs.meanL).toBeGreaterThan(fs.p5L);
        expect(bs.meanL).toBeLessThan(fs.p95L);
    });
});
