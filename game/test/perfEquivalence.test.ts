// Perf patches (scripts/profile-sim.mjs): the shortcut paths return exactly what the ported code returns.
// - Galaxy.fastFindNearestUnexploredSystem skips the .NET introsort when the smallest distance is unique; checked
//   against the full netSort reference for 500 queries, with ties at the minimum forced through the fallback.
// - scenarioQuery / scenarioEmit dispatch through a per-key index; registry order and snapshot semantics hold.
import { describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { LazyNetSortOrder, netSort, netSortLastByKey } from '../src/sim/netSort';
import { Random } from '../src/sim/random';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { GalaxyScenario } from '../src/sim/scenario/state';
import { identifyUnavailableLuxuryResources } from '../src/sim/stationPlacement';
import { valueGalaxyMapForEmpire } from '../src/sim/tradeItems';
import { raceBiasesGetBias, raceBiasesGetBiasUncached, raceBiasesSetBias } from '../src/sim/raceBias';
import { HabitatPrioritization } from '../src/sim/resourceTargets';
import { planetsOf, HabitatCategoryType } from '../src/sim/types';
import { ComponentType } from '../src/sim/data/components';
import { ShipDesignFocus } from '../src/sim/researchSystem';
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

/** The pre-patch Empire.4.cs IdentifyUnavailableLuxuryResources scans (per resource: colonies, stations, targets). */
function referenceUnavailableLuxury(g: Galaxy, empire: Empire): { self: number[]; unavailable: number[] } {
    const has = (h: Habitat, id: number): boolean => h.resources.some((r) => r.resourceId === id);
    let canExtract = false;
    if (empire.research != null && empire.research.evaluateDesiredComponent(ComponentType.ExtractorLuxury, ShipDesignFocus.Balanced) !== null) canExtract = true;
    const self: number[] = [];
    const unavailable: number[] = [];
    for (const def of g.resourceSystem.luxuryResources) {
        if (def == null) continue;
        const id = def.resourceId;
        let ok = empire.colonies.some((c) => has(c, id)) || (canExtract && empire.miningStations.some((b) => b.parentHabitat !== null && has(b.parentHabitat, id)));
        if (ok) self.push(id);
        else {
            for (const t of empire.resourceTargets) {
                const h = t.habitat as Habitat;
                if (!canExtract ? h.population != null && h.population.totalAmount > 0 && has(h, id) : has(h, id)) {
                    ok = true;
                    break;
                }
            }
        }
        if (!ok) unavailable.push(id);
    }
    return { self, unavailable };
}

describe('perf shortcuts on a synthetic 120-colony empire', () => {
    const gameData = loadGameDataFs();

    it('luxury availability, galaxy-map value and race biases match the pre-patch scans', async () => {
        const game = cachedTickGame(await gameData);
        const g = game.galaxy;
        const empire = g.empires.find((e) => e !== null && e.active && e.pirateEmpireBaseHabitat === null)!;
        const other = g.empires.find((e) => e !== null && e.active && e !== empire && e.pirateEmpireBaseHabitat === null)!;
        // 120 extra "colonies" (planets with resources, list membership only) and 60 resource targets.
        const planets = g.habitats.filter((h) => h.parent !== null && h.resources.length > 0 && !empire.colonies.includes(h));
        const rnd = new Random(120);
        for (let i = 0; i < 120; i++) empire.colonies.push(planets[rnd.next(0, planets.length)]);
        for (let i = 0; i < 60; i++) empire.resourceTargets.push(new HabitatPrioritization(planets[rnd.next(0, planets.length)], i));
        const ref = referenceUnavailableLuxury(g, empire);
        identifyUnavailableLuxuryResources(g, empire);
        expect((empire.selfSuppliedLuxuryResources ?? []).map((r) => r.resourceId)).toEqual(ref.self);
        expect(empire.unavailableLuxuryResources.map((r) => r.resourceId)).toEqual(ref.unavailable);
        // Fewer colonies: some luxuries now come only from targets / nowhere.
        empire.colonies.length = 2;
        const ref2 = referenceUnavailableLuxury(g, empire);
        identifyUnavailableLuxuryResources(g, empire);
        expect((empire.selfSuppliedLuxuryResources ?? []).map((r) => r.resourceId)).toEqual(ref2.self);
        expect(empire.unavailableLuxuryResources.map((r) => r.resourceId)).toEqual(ref2.unavailable);

        // Galaxy map value with most of the galaxy explored and known (pre-patch: planetsOf per explored system).
        for (let i = 0; i < empire.systemVisibility.length; i++) if (i % 4 !== 0) empire.systemVisibility[i].status = SystemVisibilityStatus.Explored;
        for (const h of g.habitats) if (h.habitatIndex % 3 !== 0) empire.resourceMap.setResourcesKnown(h, true);
        let n = 0;
        for (let i = 0; i < empire.systemVisibility.length; i++) {
            if (!empire.visibility.checkSystemExplored(i)) continue;
            for (const h of planetsOf(g.systems[i])) if (h.category !== HabitatCategoryType.Asteroid && empire.resourceMap.checkResourcesKnown(h) && !other.resourceMap.checkResourcesKnown(h)) n++;
        }
        let value = n * 200;
        if (other === g.playerEmpire) value = Math.trunc(value * (g.playerEmpire.difficultyLevel * g.playerEmpire.difficultyLevel));
        expect(valueGalaxyMapForEmpire(g, empire, other)).toBe(value);

        // Race biases: every pair of stock races, memoised lookup = the rebuilt-list lookup (0 for unknown races).
        const races = (await gameData).races;
        const check = (): void => {
            for (const a of races) for (const b of races) expect(raceBiasesGetBias(a, b)).toBe(raceBiasesGetBiasUncached(a, b));
        };
        check();
        // An override written after the first (memoised) read is still seen.
        raceBiasesSetBias(races[0], races[1].name, 17);
        check();
        expect(raceBiasesGetBias(races[0], races[1])).toBe(raceBiasesGetBiasUncached(races[0], races[1]));
    });
});

describe('LazyNetSortOrder', () => {
    const fullOrder = (keys: number[]) => (): number[] => {
        const pairs = keys.map((k, i) => ({ i, k }));
        netSort(pairs, (a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
        return pairs.map((p) => p.i);
    };
    it('hands out exactly the netSort permutation (unique keys, ties, NaN, -0, sizes 0..300)', () => {
        const rnd = new Random(31337);
        for (let t = 0; t < 400; t++) {
            const n = t < 20 ? t : rnd.next(0, 300);
            const mode = t % 4;
            const keys = Array.from({ length: n }, () => {
                if (mode === 0) return rnd.nextDouble() * 1e12;
                if (mode === 1) return rnd.next(0, 20); // many ties
                if (mode === 2) return rnd.next(0, 3) === 0 ? -0 : rnd.next(0, 50) * 1.5;
                return rnd.next(0, 40) === 0 ? Number.NaN : rnd.nextDouble();
            });
            const expected = fullOrder(keys)();
            const lazy = new LazyNetSortOrder(keys, fullOrder(keys));
            const got: number[] = [];
            for (let j = lazy.next(); j >= 0; j = lazy.next()) got.push(j);
            expect(got).toEqual(expected);
        }
    });
});

describe('netSortLastByKey', () => {
    it('returns the element netSort + reverse puts first (unique keys, ties, NaN)', () => {
        const rnd = new Random(2718);
        for (let t = 0; t < 500; t++) {
            const n = 1 + rnd.next(0, 200);
            const mode = t % 3;
            const items = Array.from({ length: n }, (_, i) => ({ i, sortTag: mode === 0 ? rnd.nextDouble() : mode === 1 ? rnd.next(0, 6) : rnd.next(0, 30) === 0 ? Number.NaN : rnd.next(0, 100) }));
            const ref = items.slice();
            netSort(ref, (a, b) => (a.sortTag < b.sortTag ? -1 : a.sortTag > b.sortTag ? 1 : 0));
            ref.reverse();
            expect(netSortLastByKey(items.slice(), (x) => x.sortTag)).toBe(ref[0]);
        }
    });
});
