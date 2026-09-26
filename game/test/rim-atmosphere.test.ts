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
    EYE_MAX_PERIOD_S,
    EYE_MIN_PERIOD_S,
    eyeBlinkAlpha,
    eyeCountForSystem,
    eyeCycleIndex,
    eyeMoveOffset,
    eyePairsForSystem,
    eyeZoomFade,
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
    scatterEyes,
    type RimSystemInput,
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

    it('derelict scatter is deterministic and in the rim', () => {
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
    });
});

describe('eyes in the dark (item 6)', () => {
    it('pair count scales with density and rim weight; none in a core system (weight 0); none with density 0', () => {
        expect(eyeCountForSystem(7, 1, 1)).toBeGreaterThanOrEqual(3);
        expect(eyeCountForSystem(7, 1, 1)).toBeLessThanOrEqual(8);
        expect(eyeCountForSystem(7, 1, 0)).toBe(0); // core system
        expect(eyeCountForSystem(7, 0, 1)).toBe(0); // density disabled
        const full = eyeCountForSystem(7, 1, 1);
        const half = eyeCountForSystem(7, 1, 0.5);
        expect(half).toBeLessThanOrEqual(full);
        const doubled = eyeCountForSystem(7, 2, 1);
        expect(doubled).toBeGreaterThanOrEqual(full);
        expect(eyeCountForSystem(7, 1, 1)).toBe(eyeCountForSystem(7, 1, 1)); // deterministic
    });

    it('pairs sit past the outermost habitat orbit (never on the star/planets/stations), deterministic in seed', () => {
        const a = eyePairsForSystem(1000, -500, 20000, 6, 42);
        expect(eyePairsForSystem(1000, -500, 20000, 6, 42)).toEqual(a);
        expect(a).toHaveLength(6);
        for (const e of a) {
            const d = Math.hypot(e.x - 1000, e.y - (-500));
            expect(d).toBeGreaterThanOrEqual(20000 + 3000 - 1e-9);
            expect(e.period).toBeGreaterThanOrEqual(EYE_MIN_PERIOD_S);
            expect(e.period).toBeLessThanOrEqual(EYE_MAX_PERIOD_S);
            expect(e.onFraction).toBeGreaterThan(0);
            expect(e.onFraction).toBeLessThan(0.5); // short on-time
            expect(e.size).toBeGreaterThan(0);
            expect(e.gap).toBeGreaterThan(0);
        }
        // A different seed gives a different scatter.
        expect(eyePairsForSystem(1000, -500, 20000, 6, 43)).not.toEqual(a);
    });

    it('scatterEyes: none in core systems, none with density 0, deterministic, matches per-system placement', () => {
        const core: RimSystemInput = { seed: 1, starX: 0, starY: 0, maxOrbit: 5000, weight: 0 }; // core: no eyes
        const rim1: RimSystemInput = { seed: 2, starX: 10000, starY: 0, maxOrbit: 5000, weight: 1 }; // deep rim
        const rim2: RimSystemInput = { seed: 3, starX: 0, starY: 10000, maxOrbit: 0, weight: 0.4 }; // edge of the rim band, no planets
        const systems = [core, rim1, rim2];
        const eyes = scatterEyes(systems, 1);
        const n1 = eyeCountForSystem(rim1.seed, 1, rim1.weight);
        const n2 = eyeCountForSystem(rim2.seed, 1, rim2.weight);
        expect(eyeCountForSystem(core.seed, 1, core.weight)).toBe(0); // core system contributes nothing
        expect(eyes).toHaveLength(n1 + n2); // only the two rim systems contribute
        expect(eyes.slice(0, n1)).toEqual(eyePairsForSystem(rim1.starX, rim1.starY, rim1.maxOrbit, n1, rim1.seed));
        expect(eyes.slice(n1)).toEqual(eyePairsForSystem(rim2.starX, rim2.starY, rim2.maxOrbit, n2, rim2.seed));
        expect(scatterEyes(systems, 0)).toEqual([]); // density 0 disables everywhere
        expect(scatterEyes(systems, 1)).toEqual(eyes); // deterministic
    });

    it('blink: short, soft on-window that repeats every period; irregular per pair', () => {
        // Off almost everywhere in the cycle; the on-window is short (onFraction).
        expect(eyeBlinkAlpha(0, 4, 0.2, 0)).toBeCloseTo(0, 5);
        expect(eyeBlinkAlpha(3.9, 4, 0.2, 0)).toBeCloseTo(0, 5);
        // Mid-way through the on-window: fully lit.
        expect(eyeBlinkAlpha(0.4, 4, 0.2, 0)).toBeCloseTo(1, 5);
        // Soft ramp, not a hard on/off: just inside the window is dim, not 1.
        const justOn = eyeBlinkAlpha(0.02, 4, 0.2, 0);
        expect(justOn).toBeGreaterThan(0);
        expect(justOn).toBeLessThan(1);
        // Repeats every period.
        expect(eyeBlinkAlpha(0.4, 4, 0.2, 0)).toBeCloseTo(eyeBlinkAlpha(4.4, 4, 0.2, 0), 5);
        // Always within [0, 1].
        for (let t = 0; t < 6; t += 0.05) {
            const a = eyeBlinkAlpha(t, 5, 0.15, 1.3);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThanOrEqual(1);
        }
    });

    it('cycle index advances one per period; move offset is deterministic and occasionally zero', () => {
        expect(eyeCycleIndex(0, 4, 0)).toBe(0);
        expect(eyeCycleIndex(3.9, 4, 0)).toBe(0);
        expect(eyeCycleIndex(4.1, 4, 0)).toBe(1);
        expect(eyeMoveOffset(9, 0, 1000)).toEqual(eyeMoveOffset(9, 0, 1000)); // deterministic
        let sawZero = false;
        let sawNonZero = false;
        for (let c = 0; c < 40; c++) {
            const mv = eyeMoveOffset(9, c, 1000);
            expect(Math.hypot(mv.dx, mv.dy)).toBeLessThanOrEqual(1000 + 1e-9);
            if (mv.dx === 0 && mv.dy === 0) sawZero = true;
            else sawNonZero = true;
        }
        expect(sawZero).toBe(true); // "occasionally" moves — most cycles it does not
        expect(sawNonZero).toBe(true);
    });

    it('zoom crossfade: 0 before the ambient nav-light threshold, eases to 1, never pops (monotonic)', () => {
        expect(eyeZoomFade(0)).toBe(0);
        expect(eyeZoomFade(1 / 500)).toBe(0); // BUILT_OBJECT_MAX_FACTOR threshold itself: still fading in from 0
        expect(eyeZoomFade(1 / 500 + 1e-6)).toBeGreaterThan(0);
        expect(eyeZoomFade(1)).toBe(1);
        let prev = 0;
        for (let z = 0; z <= 0.01; z += 0.0001) {
            const a = eyeZoomFade(z);
            expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
            prev = a;
        }
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
