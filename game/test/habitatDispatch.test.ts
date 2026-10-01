// Habitat dispatch buttons: the pure ship picker and the option builder on the seed-1 harness game.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { dispatchCandidates, habitatDispatchOptions, pickDispatchShip, shipTaskCount } from '../src/sim/player/habitatDispatch';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { HabitatCategoryType } from '../src/sim/types';

let galaxy: Galaxy;
let player: Empire;

beforeAll(async () => {
    galaxy = cachedTickGame(await loadGameDataFs()).galaxy;
    player = galaxy.playerEmpire!;
});

function fake(x: number, y: number, tasks: number, role = 0): BuiltObject {
    return { xpos: x, ypos: y, hasBeenDestroyed: false, role, mission: tasks > 0 ? { type: BuiltObjectMissionType.Move } : null, subsequentMissions: new Array(Math.max(0, tasks - 1)).fill({}) } as unknown as BuiltObject;
}

describe('pickDispatchShip', () => {
    it('prefers idle over nearer busy ships', () => {
        const busyNear = fake(1, 0, 1);
        const idleFar = fake(50, 0, 0);
        expect(pickDispatchShip([busyNear, idleFar], 0, 0)).toBe(idleFar);
    });
    it('breaks ties by distance, then list order', () => {
        const a = fake(10, 0, 0);
        const b = fake(3, 0, 0);
        const c = fake(-3, 0, 0);
        expect(pickDispatchShip([a, b, c], 0, 0)).toBe(b);
    });
    it('minimises queued task count', () => {
        const light = fake(90, 0, 2);
        expect(pickDispatchShip([fake(1, 0, 3), light], 0, 0)).toBe(light);
    });
    it('excludes the selected ship and applies the role filter', () => {
        const sel = fake(0, 0, 0, 1);
        const other = fake(5, 0, 0, 2);
        const wrongRole = fake(1, 0, 0, 3);
        expect(pickDispatchShip([sel, other, wrongRole], 0, 0, [sel], (s) => s.role !== 3)).toBe(other);
        expect(pickDispatchShip([sel], 0, 0, new Set([sel]))).toBeNull();
    });
    it('counts active plus queued tasks', () => {
        expect(shipTaskCount(fake(0, 0, 0))).toBe(0);
        expect(shipTaskCount(fake(0, 0, 3))).toBe(3);
    });
});

describe('habitatDispatchOptions (seed 1)', () => {
    it('offers actions with valid ships for the home system and never sends an excluded ship', () => {
        const cap = player.capital!;
        const sys = galaxy.systems[cap.systemIndex];
        const bodies = sys.habitats.filter((h) => h.category !== HabitatCategoryType.Star && h !== cap);
        expect(dispatchCandidates(player).length).toBeGreaterThan(0);
        let total = 0;
        for (const h of bodies) {
            const opts = habitatDispatchOptions(galaxy, player, h);
            for (const o of opts) {
                total++;
                if (o.ship === null) {
                    expect(o.hint).toMatch(/^No available/);
                    continue;
                }
                expect(o.action).not.toBeNull();
                expect(o.action!.target).toBe(h);
                const excl = habitatDispatchOptions(galaxy, player, h, [o.ship]).find((x) => x.id === o.id);
                expect(excl?.ship).not.toBe(o.ship);
            }
        }
        expect(total).toBeGreaterThan(0);
    });
});
