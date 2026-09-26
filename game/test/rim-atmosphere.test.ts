// 19i rim atmosphere (visual half): the layer is inert with the flag off; curve / tint maths; the murk hook.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Galaxy } from '../src/sim/galaxy';
import type { SystemInfo } from '../src/sim/types';
import type { AssetStore } from '../src/render/assets';
import type { Camera } from '../src/render/camera';
import { parseScenarioManifest } from '../src/sim/scenario';
import {
    deepFieldThinning,
    lerpColour,
    murkPatches,
    RIM_COLD,
    RIM_DEFAULTS,
    RimAtmosphereLayer,
    rimBand,
    rimFraction,
    rimGeometry,
    rimLightScale,
    rimParams,
    rimTint,
    rimWeight,
    scatterDerelicts,
    silhouetteOrbits,
} from '../src/render/rimAtmosphereLayer';

function star(x: number, y: number, systemIndex: number): SystemInfo {
    return { systemStar: { xpos: x, ypos: y, systemIndex } } as unknown as SystemInfo;
}

const SYSTEMS = [star(500, 500, 0), star(900, 500, 1), star(500, 100, 2), star(140, 500, 3)];

function fakeGalaxy(scenario: unknown): Galaxy {
    return { scenario, systems: SYSTEMS, sizeX: 1000, sizeY: 1000, randomSeed: 1, playerEmpire: null } as unknown as Galaxy;
}

const store = { dwuPresent: false } as unknown as AssetStore;

describe('RimAtmosphereLayer with the flag off', () => {
    for (const [name, scenario] of [
        ['no scenario', null],
        ['scenario without the flag', { flags: { rimAtmosphere: false }, params: { tintStrength: 1 } }],
    ] as const) {
        it(`is a no-op (${name})`, () => {
            const g = fakeGalaxy(scenario);
            const layer = new RimAtmosphereLayer(g, store);
            expect(layer.active).toBe(false);
            expect(layer.lightScale).toBeNull();
            expect(layer.weightAt(0, 0)).toBe(0);
            const world = new Container();
            const fx = new Container();
            world.addChild(new Sprite(Texture.EMPTY));
            const far = new TilingSprite(Texture.EMPTY);
            const near = new TilingSprite(Texture.EMPTY);
            fx.addChild(far, near);
            far.alpha = 0.5;
            near.alpha = 1;
            const neb = new Sprite(Texture.EMPTY);
            const icon = new Sprite(Texture.EMPTY);
            layer.mount({
                world,
                fx,
                backgroundIndex: 1,
                starfieldFar: far,
                starfieldNear: near,
                fxIndex: 2,
                nebulae: [{ sprite: neb, x: 990, y: 990 }],
                mapIcons: [{ sprite: icon, x: 990, y: 990 }],
            });
            const cam = { x: 990, y: 990, width: 800, height: 600, zoom: 1 } as unknown as Camera;
            layer.update(1, cam, 1);
            expect(world.children.length).toBe(1);
            expect(fx.children.length).toBe(2);
            expect(neb.tint).toBe(0xffffff);
            expect(icon.tint).toBe(0xffffff);
            expect(far.alpha).toBe(0.5);
            expect(near.alpha).toBe(1);
            expect(far.tint).toBe(0xffffff);
        });
    }

    it('rimParams is null off, defaults / clamps on', () => {
        expect(rimParams(fakeGalaxy(null))).toBeNull();
        expect(rimParams(fakeGalaxy({ flags: { rimAtmosphere: false }, params: {} }))).toBeNull();
        expect(rimParams(fakeGalaxy({ flags: { rimAtmosphere: true }, params: {} }))).toEqual(RIM_DEFAULTS);
        const p = rimParams(fakeGalaxy({ flags: { rimAtmosphere: true }, params: { tintStrength: 3, lightDimming: -1, rimInner: 2 } }))!;
        expect(p.tintStrength).toBe(1);
        expect(p.lightDimming).toBe(0);
        expect(p.rimInner).toBeLessThan(1);
    });

    it('the rim-atmosphere scenario manifest parses, standalone, with the flag on by default', () => {
        const m = parseScenarioManifest(JSON.parse(readFileSync('scenarios/rim-atmosphere/scenario.json', 'utf8')));
        expect(m.id).toBe('rim-atmosphere');
        expect(m.include).toEqual([]);
        expect(m.flags.find((f) => f.name === 'rimAtmosphere')?.default).toBe(true);
        for (const k of Object.keys(RIM_DEFAULTS)) {
            const def = m.params.find((q) => q.name === k);
            expect(def?.default, k).toBe(RIM_DEFAULTS[k as keyof typeof RIM_DEFAULTS]);
        }
    });
});

describe('rim curve and tint maths', () => {
    it('geometry: centre of the galaxy rect, radius = farthest star', () => {
        const geo = rimGeometry(1000, 1000, SYSTEMS.map((s) => s.systemStar));
        expect(geo).toEqual({ cx: 500, cy: 500, radius: 400 });
        expect(rimFraction(geo, 900, 500)).toBeCloseTo(1);
        expect(rimFraction(geo, 700, 500)).toBeCloseTo(0.5);
        expect(rimGeometry(1000, 800, []).radius).toBe(500);
    });

    it('weight: 0 inside rimInner, smooth to 1 across the band, monotonic', () => {
        const inner = 0.7;
        const band = rimBand(inner);
        expect(band).toBeCloseTo(0.15);
        expect(rimWeight(0.5, inner)).toBe(0);
        expect(rimWeight(inner, inner)).toBe(0);
        expect(rimWeight(inner + band / 2, inner)).toBeCloseTo(0.5);
        expect(rimWeight(inner + band, inner)).toBe(1);
        expect(rimWeight(1.2, inner)).toBe(1);
        let prev = 0;
        for (let f = 0; f <= 1.2; f += 0.01) {
            const w = rimWeight(f, inner);
            expect(w).toBeGreaterThanOrEqual(prev);
            prev = w;
        }
        expect(rimBand(0.99)).toBe(0.04);
        expect(rimBand(0)).toBe(0.3);
    });

    it('colour: lerp endpoints, cold tint only past the rim, thinning and light dimming', () => {
        expect(lerpColour(0x000000, 0xffffff, 0.5)).toBe(0x808080);
        expect(lerpColour(0x102030, 0x405060, 0)).toBe(0x102030);
        expect(lerpColour(0x102030, 0x405060, 1)).toBe(0x405060);
        expect(rimTint(0, 1)).toBe(0xffffff);
        expect(rimTint(1, 1)).toBe(RIM_COLD);
        expect(rimTint(1, 0)).toBe(0xffffff);
        expect(deepFieldThinning(0, 1)).toEqual({ far: 1, near: 1 });
        const th = deepFieldThinning(1, 0.6);
        expect(th.far).toBeLessThan(th.near);
        expect(th.far).toBeGreaterThan(0);
        expect(rimLightScale(0, 0.6)).toBe(1);
        expect(rimLightScale(1, 0.6)).toBeCloseTo(0.4);
    });

    it('derelict and silhouette scatter are deterministic and in the rim', () => {
        const geo = { cx: 0, cy: 0, radius: 1_000_000 };
        const a = scatterDerelicts(geo, 0.72, 40, [], 7);
        expect(scatterDerelicts(geo, 0.72, 40, [], 7)).toEqual(a);
        expect(a).toHaveLength(40);
        for (const d of a) {
            const f = rimFraction(geo, d.x, d.y);
            expect(f).toBeGreaterThanOrEqual(0.72);
            expect(f).toBeLessThanOrEqual(1.06 + 1e-9);
            expect(d.url).toMatch(/^\/assets\/dwu\/images\/units\/ships\/family\d+\/\w+\.png$/);
        }
        const s = silhouetteOrbits(0.72, 6, 7);
        expect(s).toHaveLength(6);
        for (const o of s) expect(o.orbit).toBeGreaterThan(0.72);
    });
});

describe('murk hook (unexplored rim systems)', () => {
    const geo = rimGeometry(1000, 1000, SYSTEMS.map((s) => s.systemStar));

    it('fogs only rim systems the viewer has not explored', () => {
        // Fractions: 0 (core), 1 (rim), 1 (rim), 0.9 (rim at inner 0.72).
        const explored = (i: number) => i === 2;
        const out = murkPatches(SYSTEMS, geo, 0.72, explored);
        expect(out.map((p) => [p.x, p.y])).toEqual([
            [900, 500],
            [140, 500],
        ]);
        for (const p of out) expect(p.w).toBeGreaterThan(0);
    });

    it('nothing without a viewing empire; everything explored = nothing', () => {
        expect(murkPatches(SYSTEMS, geo, 0.72, null)).toEqual([]);
        expect(murkPatches(SYSTEMS, geo, 0.72, () => true)).toEqual([]);
    });

    it('reuses the output array', () => {
        const out = [{ x: 1, y: 1, w: 1 }];
        const r = murkPatches(SYSTEMS, geo, 0.72, () => false, out);
        expect(r).toBe(out);
        expect(r).toHaveLength(3);
    });
});
