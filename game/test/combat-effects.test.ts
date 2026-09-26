// combatfx: pure parts of the combat effects layer (src/render/effectsLayer.ts) and the shared animation helpers
// (src/render/fxCommon.ts) — weapon record → draw command mapping (MainView.2.cs method_171 / 159-161), explosion
// timing and placement (DoExplosions, method_185), strike windows, hyperjump triggers (method_97), culling, and the
// pooled one-shot animation player (AnimationSystem.cs).
import { describe, expect, it } from 'vitest';
import { Container, Texture } from 'pixi.js';
import {
    AREA_IMAGE_COUNT,
    BEAM_IMAGE_COUNT,
    EXPLOSION_SET_DIRS,
    TORPEDO_IMAGE_COUNT,
    WeaponArt,
    WeaponDrawKind,
    areaRampAlpha,
    circleInView,
    explosionFrameUrl,
    explosionImageAt,
    explosionWorldRect,
    hyperAnimationPlacement,
    hyperEnterDue,
    newWeaponDraw,
    oscillateColor,
    segmentInView,
    shieldStrikeVisible,
    shipZoomFactor,
    tractorStrikeVisible,
    viewBounds,
    weaponDrawCommand,
    weaponFadeAlpha,
    type WeaponLike,
} from '../src/render/effectsLayer';
import { AnimationPlayer, FrameSet, SpritePool, animationFrameIndex, loopFrameIndex } from '../src/render/fxCommon';
import type { AssetStore } from '../src/render/assets';
import { ComponentType } from '../src/sim/data/components';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { MIN_TIME } from '../src/sim/tick/simTime';

function weapon(type: ComponentType, over: Partial<WeaponLike> & { special?: number; range?: number; rawDamage?: number; bombardDamage?: number; damageLoss?: number } = {}): WeaponLike {
    return {
        distanceTravelled: over.distanceTravelled ?? 100,
        power: over.power ?? 20,
        heading: over.heading ?? 0.5,
        x: over.x ?? 100,
        y: over.y ?? 0,
        lastFired: over.lastFired ?? 1000,
        target: over.target ?? null,
        range: over.range ?? 1000,
        rawDamage: over.rawDamage ?? 16,
        bombardDamage: over.bombardDamage ?? 0,
        damageLoss: over.damageLoss ?? 0,
        component: { type, specialImageIndex: over.special ?? 0 },
    };
}

const origin = { xpos: 0, ypos: 0 };

describe('weaponFadeAlpha (method_171 num3/num4/num5)', () => {
    it('is opaque until the family fade start, then fades linearly to 0 at full range', () => {
        expect(weaponFadeAlpha(ComponentType.WeaponBeam, 500, 1000)).toBe(1);
        // Beam fade starts at 0.75: at 0.875 of range num4 = 0.5 → (int)(127.5) = 127.
        expect(weaponFadeAlpha(ComponentType.WeaponBeam, 875, 1000)).toBeCloseTo(127 / 255, 6);
        expect(weaponFadeAlpha(ComponentType.WeaponBeam, 1000, 1000)).toBe(0);
        // Torpedo starts fading at 0.6, phaser at 0.97, assault pods never.
        expect(weaponFadeAlpha(ComponentType.WeaponTorpedo, 700, 1000)).toBeLessThan(1);
        expect(weaponFadeAlpha(ComponentType.WeaponPhaser, 960, 1000)).toBe(1);
        expect(weaponFadeAlpha(ComponentType.AssaultPod, 1000, 1000)).toBe(1);
    });
});

describe('weaponDrawCommand (MainView.2.cs 1509 method_171)', () => {
    const out = newWeaponDraw();

    it('draws nothing for an idle weapon (DistanceTravelled < 0)', () => {
        expect(weaponDrawCommand(weapon(ComponentType.WeaponBeam, { distanceTravelled: -1 }), origin, 1, 0, out)).toBe(WeaponDrawKind.None);
    });

    it('maps an intercepted missile (Power = float.MaxValue) to the explosion animation at the shot', () => {
        const w = weapon(ComponentType.WeaponMissile, { power: Math.fround(3.4028234663852886e38), x: 40, y: 50 });
        expect(weaponDrawCommand(w, origin, 1, 0, out)).toBe(WeaponDrawKind.Intercepted);
        expect([out.x, out.y]).toEqual([40, 50]);
    });

    it('beam bolt: 10·sqrt(RawDamage) long (capped 300) at the shot, along the heading, squeezed across near the firer', () => {
        const w = weapon(ComponentType.WeaponBeam, { rawDamage: 16, x: 100, y: 0, heading: 0.25, special: 5 });
        expect(weaponDrawCommand(w, origin, 2, 0, out)).toBe(WeaponDrawKind.Bolt);
        expect(out.art).toBe(WeaponArt.Beam);
        expect(out.artIndex).toBe(5);
        expect(out.alongPx).toBeCloseTo(40 / 2, 9);
        expect(out.across).toBeCloseTo(20, 9); // 100/2 = 50 px from the firer >= 40: not squeezed
        expect(out.rotation).toBe(0.25);
        // 10 world units from the firer at f = 1: d = 10 < 40 → across scaled by d / num.
        weaponDrawCommand(weapon(ComponentType.WeaponBeam, { rawDamage: 16, x: 10, y: 0 }), origin, 1, 0, out);
        expect(out.alongPx).toBeCloseTo(40, 9);
        expect(out.across).toBeCloseTo(10, 9);
        // Out-of-range art index falls back to beam_0.
        weaponDrawCommand(weapon(ComponentType.WeaponBeam, { special: BEAM_IMAGE_COUNT }), origin, 1, 0, out);
        expect(out.artIndex).toBe(0);
    });

    it('rail guns use 7·sqrt(RawDamage); assault pods a fixed 18 with the pod art, never squeezed', () => {
        weaponDrawCommand(weapon(ComponentType.WeaponRailGun, { rawDamage: 100, x: 500 }), origin, 1, 0, out);
        expect(out.alongPx).toBeCloseTo(70, 9);
        weaponDrawCommand(weapon(ComponentType.AssaultPod, { rawDamage: 100, x: 1 }), origin, 1, 0, out);
        expect(out.art).toBe(WeaponArt.AssaultPod);
        expect(out.alongPx).toBe(18);
        expect(out.across).toBe(18);
    });

    it('torpedo: spins at π rad/s since LastFired, (Power/3 + 7) px capped at 18', () => {
        const w = weapon(ComponentType.WeaponTorpedo, { power: 9, lastFired: 1000, special: 3 });
        expect(weaponDrawCommand(w, origin, 1, 3000, out)).toBe(WeaponDrawKind.Projectile);
        expect(out.art).toBe(WeaponArt.Torpedo);
        expect(out.artIndex).toBe(3);
        expect(out.alongPx).toBe(10);
        expect(out.rotation).toBeCloseTo(2 * Math.PI, 9);
        weaponDrawCommand(weapon(ComponentType.WeaponTorpedo, { power: 300 }), origin, 1, 0, out);
        expect(out.alongPx).toBe(18);
        // Never below 1 px when zoomed far out.
        weaponDrawCommand(weapon(ComponentType.WeaponTorpedo, { power: 9 }), origin, 100, 0, out);
        expect(out.alongPx).toBe(1);
        weaponDrawCommand(weapon(ComponentType.WeaponTorpedo, { special: TORPEDO_IMAGE_COUNT }), origin, 1, 0, out);
        expect(out.artIndex).toBe(0);
    });

    it('missile: faces its heading, drawn 3.5× its (Power/5 + 5) px size', () => {
        weaponDrawCommand(weapon(ComponentType.WeaponMissile, { power: 20, heading: 1.2 }), origin, 1, 0, out);
        expect(out.rotation).toBe(1.2);
        expect(out.alongPx).toBeCloseTo(3.5 * 9, 9);
    });

    it('bombard at a habitat: bombard-damage sized, white, facing its heading', () => {
        const planet = new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, 'p', 0, 0);
        const w = weapon(ComponentType.WeaponBombard, { bombardDamage: 4, target: planet, heading: 2, distanceTravelled: 990, range: 1000 });
        weaponDrawCommand(w, origin, 1, 0, out);
        expect(out.kind).toBe(WeaponDrawKind.Projectile);
        expect(out.alpha).toBe(1); // Color.White, no fade
        expect(out.rotation).toBe(2);
        expect(out.alongPx).toBe(26); // min(4·2.5 / 0.5 + 6, 26)
    });

    it('phaser: a beam stretched from the firer to the target while it is within 1.2 × range', () => {
        const target = { xpos: 300, ypos: 400 };
        const w = weapon(ComponentType.WeaponPhaser, { target, range: 1000 });
        expect(weaponDrawCommand(w, origin, 2, 0, out)).toBe(WeaponDrawKind.Stretched);
        expect([out.x, out.y]).toEqual([0, 0]);
        expect(out.alongPx).toBeCloseTo(250, 9);
        expect(out.across).toBeCloseTo(0.5, 9);
        expect(out.rotation).toBeCloseTo(Math.atan2(400, 300), 12);
        expect(out.alpha).toBeGreaterThanOrEqual(144 / 255 - 1e-9);
        expect(weaponDrawCommand(weapon(ComponentType.WeaponPhaser, { target: { xpos: 1300, ypos: 0 }, range: 1000 }), origin, 1, 0, out)).toBe(WeaponDrawKind.None);
        expect(weaponDrawCommand(weapon(ComponentType.WeaponTractorBeam, { target: null }), origin, 1, 0, out)).toBe(WeaponDrawKind.None);
    });

    it('area weapons: a ring 2 × DistanceTravelled across around the shot, with the purple firing line', () => {
        const w = weapon(ComponentType.WeaponAreaDestruction, { distanceTravelled: 150, x: 10, y: 20, special: AREA_IMAGE_COUNT + 2 });
        expect(weaponDrawCommand(w, { xpos: 5, ypos: 5 }, 3, 0, out)).toBe(WeaponDrawKind.Area);
        expect(out.alongPx).toBeCloseTo(100, 9);
        expect(out.artIndex).toBe(0);
        expect(out.lineWidth).toBe(3);
        expect([out.lineFromX, out.lineFromY]).toEqual([5, 5]);
    });

    it('area ramp: fades in over 2 % and out over the last 10 % of range', () => {
        expect(areaRampAlpha(0, 1000)).toBe(0);
        expect(areaRampAlpha(10, 1000)).toBe(127);
        expect(areaRampAlpha(500, 1000)).toBe(255);
        expect(areaRampAlpha(1000, 1000)).toBe(0);
    });
});

describe('oscillateColor (GraphicsHelper.OscillateColor)', () => {
    it('is `end` at an even second, `start` at the next odd second, ping-pong in between', () => {
        const a = 0xff102030;
        const b = 0x80000000;
        expect(oscillateColor(a, b, 2000)).toBe(b >>> 0);
        expect(oscillateColor(a, b, 3000)).toBe(a >>> 0);
        const mid = oscillateColor(a, b, 2500);
        expect((mid >>> 24) & 0xff).toBeGreaterThan(0x80);
        expect((mid >>> 24) & 0xff).toBeLessThan(0xff);
    });
});

describe('explosions (BuiltObject.1.cs DoExplosions, MainView.2.cs method_185)', () => {
    it('runs 20 images over clamp(size / 2, 50, 100) / 60 s, then ends', () => {
        expect(explosionImageAt(1000, 60, 1000)).toBe(0);
        // size 60 → length 50 → 50/60 s total; half-way = image 10.
        expect(explosionImageAt(1000, 60, 1000 + (25 / 60) * 1000)).toBe(10);
        expect(explosionImageAt(1000, 60, 1000 + (49.9 / 60) * 1000)).toBe(19);
        expect(explosionImageAt(1000, 60, 1000 + (51 / 60) * 1000)).toBe(-1);
        // A big one (size 400) lasts 100 / 60 s.
        expect(explosionImageAt(0, 400, 1500)).toBe(18);
    });

    it('is centred at up to 3× zoom-out, then drawn size / shipZoomFactor px from the same top-left', () => {
        const rect = { left: 0, top: 0, size: 0 };
        const e = { explosionSize: 60, explosionOffsetX: 4, explosionOffsetY: -2 };
        explosionWorldRect(100.7, 200.2, e, 2, shipZoomFactor(2), rect);
        expect(rect).toEqual({ left: 74, top: 168, size: 60 });
        // f = 30: ship zoom factor 10 → 6 px → 180 world units wide from the same top-left.
        explosionWorldRect(100.7, 200.2, e, 30, shipZoomFactor(30), rect);
        expect(rect).toEqual({ left: 74, top: 168, size: 180 });
    });

    it('shipZoomFactor = CalculateShipZoomFactor', () => {
        expect(shipZoomFactor(1)).toBe(1);
        expect(shipZoomFactor(3)).toBe(3);
        expect(shipZoomFactor(6)).toBe(3);
        expect(shipZoomFactor(60)).toBe(20);
    });

    it('art path follows the install folders in GetDirectories order', () => {
        expect(EXPLOSION_SET_DIRS).toHaveLength(20);
        expect(explosionFrameUrl(0, 0)).toBe('/assets/dwu/images/effects/explosions/Expl01/Expl010001.png');
        expect(explosionFrameUrl(19, 19)).toBe('/assets/dwu/images/effects/explosions/Expl07h/Expl07h0020.png');
    });
});

describe('strike windows and hyperjump triggers', () => {
    it('shield strike 200 ms, tractor strike 2 s, never before the first strike', () => {
        expect(shieldStrikeVisible(MIN_TIME, 0)).toBe(false);
        expect(shieldStrikeVisible(1000, 1199)).toBe(true);
        expect(shieldStrikeVisible(1000, 1200)).toBe(false);
        expect(tractorStrikeVisible(1000, 2999)).toBe(true);
        expect(tractorStrikeVisible(1000, 3000)).toBe(false);
    });

    it('hyper enter starts in the last 800 ms of the countdown, only while flagged and able to jump', () => {
        expect(hyperEnterDue(10_000, 9_500, true, true)).toBe(true);
        expect(hyperEnterDue(10_000, 9_000, true, true)).toBe(false);
        expect(hyperEnterDue(10_000, 10_000, true, true)).toBe(false);
        expect(hyperEnterDue(10_000, 9_500, false, true)).toBe(false);
        expect(hyperEnterDue(10_000, 9_500, true, false)).toBe(false);
    });

    it('hyper animation: sqrt(size·30) square, (that × 0.7) / 2 behind the ship', () => {
        const p = hyperAnimationPlacement(120, 0, { dx: 0, dy: 0, size: 0 });
        expect(p.size).toBe(60);
        expect(p.dx).toBeCloseTo(-21, 9);
        expect(p.dy).toBeCloseTo(0, 9);
    });
});

describe('culling', () => {
    const b = viewBounds({ x: 0, y: 0, width: 200, height: 100, zoom: 0.5 }, 50, { left: 0, top: 0, right: 0, bottom: 0 });
    it('derives the world rect of the view plus the px margin', () => {
        expect(b).toEqual({ left: -300, top: -200, right: 300, bottom: 200 });
    });
    it('keeps circles / segments touching it and drops the rest', () => {
        expect(circleInView(b, 310, 0, 20)).toBe(true);
        expect(circleInView(b, 330, 0, 20)).toBe(false);
        expect(segmentInView(b, -1000, 0, 1000, 0, 1)).toBe(true);
        expect(segmentInView(b, -1000, 500, 1000, 500, 1)).toBe(false);
    });
});

describe('animation timing (AnimationSystem.cs method_1, MainView.1.cs method_117)', () => {
    it('one-shot: frame step = trunc(frames / fps · 1000) / (frames − 1) ms; −1 when done', () => {
        // 31 frames at 30 fps: 1033 ms / 30 = 34 ms per frame.
        expect(animationFrameIndex(0, 0, 31, 30)).toBe(0);
        expect(animationFrameIndex(0, 33, 31, 30)).toBe(0);
        expect(animationFrameIndex(0, 34, 31, 30)).toBe(1);
        expect(animationFrameIndex(0, 34 * 30, 31, 30)).toBe(30);
        expect(animationFrameIndex(0, 34 * 31, 31, 30)).toBe(-1);
        expect(animationFrameIndex(500, 0, 31, 30)).toBe(0); // not started yet: first frame
    });
    it('looping: wraps and never indexes past the last frame', () => {
        for (let t = 0; t < 5000; t += 7) {
            const i = loopFrameIndex(t, 12, 10);
            expect(i).toBeGreaterThanOrEqual(0);
            expect(i).toBeLessThan(12);
        }
        expect(loopFrameIndex(0, 12, 10)).toBe(0);
        expect(loopFrameIndex(1200, 12, 10)).toBe(0);
    });
});

describe('pooling (fxCommon)', () => {
    const tex = new Texture();
    const store = { loadFirst: () => Promise.resolve(tex) } as unknown as AssetStore;

    it('SpritePool reuses sprites and hides the unused ones', () => {
        const parent = new Container();
        const pool = new SpritePool(parent);
        pool.begin();
        const a = pool.acquire(tex);
        pool.acquire(tex);
        pool.end();
        expect(parent.children).toHaveLength(2);
        pool.begin();
        expect(pool.acquire(tex)).toBe(a);
        pool.end();
        expect(parent.children).toHaveLength(2);
        expect(parent.children[1].visible).toBe(false);
    });

    it('AnimationPlayer draws until the last frame, then recycles the record; full → replaces the oldest', async () => {
        const frames = new FrameSet(store, ['a', 'b', 'c']);
        frames.request();
        await Promise.resolve();
        await Promise.resolve();
        const parent = new Container();
        const pool = new SpritePool(parent);
        const anim = new AnimationPlayer(2);
        anim.add(frames, 0, 10, 0, 0, 10, 10, 0);
        pool.begin();
        anim.draw(0, pool, () => true);
        pool.end();
        expect(pool.count).toBe(1);
        expect(anim.count).toBe(1);
        pool.begin();
        anim.draw(10_000, pool, () => true);
        pool.end();
        expect(anim.count).toBe(0);
        expect(pool.count).toBe(0);
        anim.add(frames, 1, 10, 0, 0, 1, 1, 0);
        anim.add(frames, 2, 10, 0, 0, 1, 1, 0);
        anim.add(frames, 3, 10, 0, 0, 1, 1, 0);
        expect(anim.count).toBe(2);
        // Culled animations keep running but draw nothing.
        pool.begin();
        anim.draw(3, pool, () => false);
        pool.end();
        expect(pool.count).toBe(0);
        expect(anim.count).toBe(2);
    });
});
