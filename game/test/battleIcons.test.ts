import { describe, expect, it } from 'vitest';
import { systemsUnderFire } from '../src/render/battleIcons';
import { MIN_TIME } from '../src/sim/tick/simTime';

const me = {} as never, foe = {} as never;
const ship = (o: Record<string, unknown>) =>
    ({ empire: me, hasBeenDestroyed: false, weapons: [], lastShieldStrike: MIN_TIME, attackers: [], nearestSystemStar: { systemIndex: 3 }, ...o }) as never;

describe('systemsUnderFire', () => {
    it('shows systems with recent combat of own ships only', () => {
        const now = 100000;
        const m = systemsUnderFire(me, [
            ship({ lastShieldStrike: now - 1000 }),
            ship({ nearestSystemStar: { systemIndex: 5 } }),
            ship({ empire: foe, nearestSystemStar: { systemIndex: 6 }, lastShieldStrike: now }),
            ship({ nearestSystemStar: { systemIndex: 7 }, lastShieldStrike: now, hasBeenDestroyed: true }),
            ship({ nearestSystemStar: { systemIndex: 8 }, lastShieldStrike: now - 60000 }),
            ship({ nearestSystemStar: { systemIndex: 9 }, attackers: [{}] }),
        ], [], now);
        expect([...m.keys()].sort()).toEqual([3, 9]);
        expect(m.get(3)).toBe(1);
    });
    it('shows attacked colonies and nothing without a player', () => {
        const h = [{ owner: me, attackers: [{}], systemIndex: 2 }, { owner: foe, attackers: [{}], systemIndex: 4 }, { owner: me, attackers: [], systemIndex: 5 }] as never[];
        expect([...systemsUnderFire(me, [], h, 0).keys()]).toEqual([2]);
        expect(systemsUnderFire(null, [], h, 0).size).toBe(0);
    });
});

// The combat-activity window (moved here from the retired combatBars.ts shield/hull bars design).
import { COMBAT_FADE_S, COMBAT_HOLD_S, combatActivityAlpha, lastCombatMs } from '../src/render/battleIcons';

describe('combat activity window', () => {
    const now = 100_000;
    const s = (o: Record<string, unknown> = {}) => ({ weapons: [], lastShieldStrike: MIN_TIME, attackers: [], ...o }) as never;
    it('no activity ever means 0; a live attacker means now', () => {
        expect(combatActivityAlpha(s(), now)).toBe(0);
        expect(lastCombatMs(s({ attackers: [{ hasBeenDestroyed: false }] }), now)).toBe(now);
        expect(combatActivityAlpha(s({ attackers: [{ hasBeenDestroyed: true }] }), now)).toBe(0);
    });
    it('holds, then fades', () => {
        const hit = (ageS: number) => s({ lastShieldStrike: now - ageS * 1000 });
        expect(combatActivityAlpha(hit(COMBAT_HOLD_S), now)).toBe(1);
        expect(combatActivityAlpha(hit(COMBAT_HOLD_S + COMBAT_FADE_S / 2), now)).toBeCloseTo(0.5);
        expect(combatActivityAlpha(hit(COMBAT_HOLD_S + COMBAT_FADE_S), now)).toBe(0);
        expect(lastCombatMs(s({ lastShieldStrike: 10, weapons: [{ lastFired: 20 }] }), now)).toBe(20);
    });
});
