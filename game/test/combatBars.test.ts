// Shield / hull bars under ship markers (render/combatBars.ts): fractions, colour ramp, in-combat rule.
import { describe, expect, it } from 'vitest';
import { barRects, barWidthPx, combatBarAlpha, COMBAT_FADE_S, COMBAT_HOLD_S, hullColor, hullFraction, lastCombatMs, shieldFraction, SHIELD_BAR_COLOR } from '../src/render/combatBars';
import { MIN_TIME } from '../src/sim/tick/simTime';

const ship = (o: Partial<Record<string, unknown>> = {}) =>
    ({ currentShields: 0, shieldsCapacity: 0, components: { items: new Array(10).fill(0) }, damagedComponentCount: 0, weapons: [], lastShieldStrike: MIN_TIME, attackers: [], ...o }) as never;

describe('fractions', () => {
    it('shield fraction is charge / capacity, null without shields, clamped', () => {
        expect(shieldFraction(ship())).toBeNull();
        expect(shieldFraction(ship({ shieldsCapacity: 200, currentShields: 50 }))).toBe(0.25);
        expect(shieldFraction(ship({ shieldsCapacity: 200, currentShields: -5 }))).toBe(0);
        expect(shieldFraction(ship({ shieldsCapacity: 200, currentShields: 999 }))).toBe(1);
    });
    it('hull fraction is the undamaged component share', () => {
        expect(hullFraction(ship())).toBe(1);
        expect(hullFraction(ship({ damagedComponentCount: 3 }))).toBeCloseTo(0.7);
        expect(hullFraction(ship({ damagedComponentCount: 10 }))).toBe(0);
        expect(hullFraction(ship({ components: { items: [] } }))).toBe(1);
    });
});

describe('colour ramp', () => {
    it('is green at full, yellow at half, red at zero, clamped', () => {
        expect(hullColor(1)).toBe(0x00ff30);
        expect(hullColor(0.5)).toBe(0xffff30);
        expect(hullColor(0)).toBe(0xff0030);
        expect(hullColor(2)).toBe(hullColor(1));
        expect(hullColor(-1)).toBe(hullColor(0));
    });
    it('goes green -> yellow by losing green-to-red mix monotonically', () => {
        let prevR = 256;
        for (let t = 1; t >= 0.5; t -= 0.05) {
            const r = (hullColor(t) >> 16) & 255;
            expect(r).toBeLessThanOrEqual(prevR === 256 ? 255 : 255);
            expect(r).toBeGreaterThanOrEqual(prevR === 256 ? 0 : prevR);
            prevR = r;
        }
        let prevG = 256;
        for (let t = 0.5; t >= 0; t -= 0.05) {
            const g = (hullColor(t) >> 8) & 255;
            if (prevG !== 256) expect(g).toBeLessThanOrEqual(prevG);
            prevG = g;
        }
    });
});

describe('in-combat rule', () => {
    const now = 100_000;
    it('no activity ever means no bars', () => {
        expect(combatBarAlpha(ship(), now)).toBe(0);
    });
    it('a live attacker means combat now; a destroyed one does not', () => {
        expect(lastCombatMs(ship({ attackers: [{ hasBeenDestroyed: false }] }), now)).toBe(now);
        expect(combatBarAlpha(ship({ attackers: [{ hasBeenDestroyed: true }] }), now)).toBe(0);
    });
    it('firing or a shield strike holds the bars, then fades them out', () => {
        const fired = ship({ weapons: [{ lastFired: now - 1000 }, { lastFired: MIN_TIME }] });
        expect(combatBarAlpha(fired, now)).toBe(1);
        const hit = (ageS: number) => ship({ lastShieldStrike: now - ageS * 1000 });
        expect(combatBarAlpha(hit(COMBAT_HOLD_S), now)).toBe(1);
        expect(combatBarAlpha(hit(COMBAT_HOLD_S + COMBAT_FADE_S / 2), now)).toBeCloseTo(0.5);
        expect(combatBarAlpha(hit(COMBAT_HOLD_S + COMBAT_FADE_S), now)).toBe(0);
    });
    it('uses the later of the shot and the strike', () => {
        expect(lastCombatMs(ship({ lastShieldStrike: 10, weapons: [{ lastFired: 20 }] }), now)).toBe(20);
        expect(lastCombatMs(ship({ lastShieldStrike: 30, weapons: [{ lastFired: 20 }] }), now)).toBe(30);
    });
});

describe('layout', () => {
    it('sizes the bar width from the marker, clamped', () => {
        expect(barWidthPx(4)).toBe(14);
        expect(barWidthPx(20)).toBe(24);
        expect(barWidthPx(500)).toBe(40);
    });
    it('puts shields over hull under the marker, centred; shieldless ships get the hull bar only', () => {
        const r = barRects(ship({ shieldsCapacity: 100, currentShields: 100 }), 10);
        expect(r).toHaveLength(2);
        expect(r[0].color).toBe(SHIELD_BAR_COLOR);
        expect(r[0].y).toBe(7);
        expect(r[1].y).toBe(10);
        expect(r[0].x).toBe(-r[0].w / 2);
        expect(barRects(ship(), 10)).toHaveLength(1);
    });
});
