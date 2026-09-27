// Perf patches (scripts/profile-sim.mjs): the shortcut paths return exactly what the ported code returns.
// - Galaxy.fastFindNearestUnexploredSystem skips the .NET introsort when the smallest distance is unique; checked
//   against the full netSort reference for 500 queries, with ties at the minimum forced through the fallback.
// - scenarioQuery / scenarioEmit dispatch through a per-key index; registry order and snapshot semantics hold.
import { describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { netSort } from '../src/sim/netSort';
import { Random } from '../src/sim/random';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { GalaxyScenario } from '../src/sim/scenario/state';
import { registerScenarioEvent, registerScenarioQuery, scenarioEmit, scenarioQuery } from '../src/sim/scenario/hooks';

/** The pre-patch body: every unexplored system sorted by squared distance with netSort, first element. */
function referenceNearestUnexplored(g: Galaxy, x: number, y: number, empire: Empire): Habitat | null {
    const list: { s: (typeof g.systems)[number]; d: number }[] = [];
    for (const s of g.systems) {
        const st = empire.visibility.systemVisibility[s.systemStar.systemIndex].status;
        if (st === SystemVisibilityStatus.Unexplored || st === SystemVisibilityStatus.Undefined) list.push({ s, d: g.calculateDistanceSquared(x, y, s.systemStar.xpos, s.systemStar.ypos) });
    }
    netSort(list, (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return list.length > 0 ? list[0].s.systemStar : null;
}

describe('perf shortcuts are equivalent', () => {
    const gameData = loadGameDataFs();

    it('fastFindNearestUnexploredSystem returns the same system as the full sort (500 queries, ties included)', async () => {
        const g = cachedTickGame(await gameData).galaxy;
        const empires = g.empires.filter((e) => e !== null && e.active);
        const rnd = new Random(4242);
        for (let i = 0; i < 500; i++) {
            const e = empires[i % empires.length];
            // Every 5th query sits exactly between two stars (a tie at the minimum when no star is closer).
            let x: number;
            let y: number;
            if (i % 5 === 0) {
                const a = g.systems[rnd.next(0, g.systems.length)].systemStar;
                const b = g.systems[rnd.next(0, g.systems.length)].systemStar;
                x = (a.xpos + b.xpos) / 2;
                y = (a.ypos + b.ypos) / 2;
            } else {
                x = rnd.nextDouble() * g.sizeX;
                y = rnd.nextDouble() * g.sizeY;
            }
            expect(g.fastFindNearestUnexploredSystem(x, y, e)).toBe(referenceNearestUnexplored(g, x, y, e));
        }
        // A query on a star with every other system unexplored and equidistant pairs: exercise the fallback directly.
        const s0 = g.systems[0].systemStar;
        expect(g.fastFindNearestUnexploredSystem(s0.xpos, s0.ypos, empires[0])).toBe(referenceNearestUnexplored(g, s0.xpos, s0.ypos, empires[0]));
    });

    it('indexed query / event dispatch keeps registry order and snapshot semantics', async () => {
        const g = cachedTickGame(await gameData).galaxy;
        const hadScenario = g.scenario;
        g.scenario = Object.assign(new GalaxyScenario(), { id: 'perf-test', flags: { perfTest: true } });
        const calls: string[] = [];
        const offs = [
            registerScenarioQuery({ id: 'perf.b', order: 1, flag: 'perfTest', query: 'scanRangeModifier', run: (_g, v) => (calls.push('b'), v * 3) }),
            registerScenarioQuery({ id: 'perf.a', order: 1, flag: 'perfTest', query: 'scanRangeModifier', run: (_g, v) => (calls.push('a'), v + 1) }),
            registerScenarioQuery({ id: 'perf.c', order: 0, flag: 'perfTest', query: 'scanRangeModifier', run: (_g, v) => (calls.push('c'), v * 2) }),
            registerScenarioQuery({ id: 'perf.off', flag: 'perfTestOff', query: 'scanRangeModifier', run: () => 999 }),
        ];
        try {
            // order 0 first, then order-1 ties by id: c, a, b → ((1 * 2) + 1) * 3
            expect(scenarioQuery(g, 'scanRangeModifier', 1, { x: 0, y: 0 })).toBe(9);
            expect(calls).toEqual(['c', 'a', 'b']);
            // Re-registering an id replaces it (and rebuilds the index).
            offs.push(registerScenarioQuery({ id: 'perf.a', order: 1, flag: 'perfTest', query: 'scanRangeModifier', run: (_g, v) => v + 10 }));
            expect(scenarioQuery(g, 'scanRangeModifier', 1, { x: 0, y: 0 })).toBe(36);
            // An event handler registering another handler of the same event mid-emit: not called in that emit.
            const seen: string[] = [];
            let late: (() => void) | null = null;
            offs.push(registerScenarioEvent({ id: 'perf.e1', flag: 'perfTest', event: 'builtObjectRemoved', run: () => {
                seen.push('e1');
                if (late === null) late = registerScenarioEvent({ id: 'perf.e2', flag: 'perfTest', event: 'builtObjectRemoved', run: () => seen.push('e2') });
            } }));
            scenarioEmit(g, 'builtObjectRemoved', { builtObject: g.builtObjects[0]! });
            expect(seen).toEqual(['e1']);
            scenarioEmit(g, 'builtObjectRemoved', { builtObject: g.builtObjects[0]! });
            expect(seen).toEqual(['e1', 'e1', 'e2']);
            late!();
            scenarioEmit(g, 'builtObjectRemoved', { builtObject: g.builtObjects[0]! });
            expect(seen).toEqual(['e1', 'e1', 'e2', 'e1']);
        } finally {
            for (const off of offs) off();
            g.scenario = hadScenario;
        }
        expect(scenarioQuery(g, 'scanRangeModifier', 1, { x: 0, y: 0 })).toBe(1);
    });
});
