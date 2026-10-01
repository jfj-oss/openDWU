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
