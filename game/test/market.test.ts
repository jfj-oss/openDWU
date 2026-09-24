import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import { galaxyComponentCurrentPrices, galaxyResourceCurrentPrices } from '../src/sim/design';
import type { Galaxy } from '../src/sim/galaxy';

// Galaxy.1.cs ReviewResourcePrices / ReviewComponentPrices, run 20x as in Start.2.cs:1103-1107.
let gameData: GameData;
beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

function opts(): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0.5 },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
    };
}

function rndState(g: Galaxy): string {
    return JSON.stringify(g.rnd);
}

// createGame's own 20 reviews (Start.2.cs 1102-1104): state recorded at the phase boundaries
// around them and stopped right after (test-only __phaseHook).
function run(): { galaxy: Galaxy; resources: number[]; components: number[]; rndBefore: string; rndAfter: string; initialResources: number[]; initialComponents: number[] } {
    let initialResources: number[] = [];
    let initialComponents: number[] = [];
    let rndBefore = '';
    let rndAfter = '';
    const galaxy = createGame({
        ...opts(),
        __phaseHook: (phase, g) => {
            if (phase === 'startingColonies') {
                initialResources = [...galaxyResourceCurrentPrices(g)];
                initialComponents = [...galaxyComponentCurrentPrices(g)];
                rndBefore = rndState(g);
            }
            if (phase === 'priceReviews') {
                rndAfter = rndState(g);
                return 'stop';
            }
            return undefined;
        },
    }).galaxy;
    return { galaxy, resources: [...galaxyResourceCurrentPrices(galaxy)], components: [...galaxyComponentCurrentPrices(galaxy)], rndBefore, rndAfter, initialResources, initialComponents };
}

describe('market price review', () => {
    it('20 reviews: prices move from base, clamp, no Rnd draws, deterministic', () => {
        const a = run();
        const resources = a.galaxy.resourceSystem.resources;
        // ResourceSystem.Resources[i] is indexed by ResourceID in C# (array[ResourceID]).
        resources.forEach((r, i) => expect(r.resourceId).toBe(i));
        // Initial state = Galaxy ctor (Galaxy.4.cs:2175-2178): BasePrice.
        a.initialResources.forEach((p, i) => expect(p).toBe(Math.fround(resources[i].basePrice)));
        // Orders are empty at game start, so demand = 0: every price halves toward its floor
        // (BasePrice*0.1667, or BasePrice/2 for super-luxuries); 20 halvings reach it.
        for (let i = 0; i < resources.length; i++) {
            const base = Math.fround(resources[i].basePrice);
            const floor = resources[i].superLuxuryBonusAmount > 0 ? base / 2.0 : base * 0.1667;
            const cap = resources[i].superLuxuryBonusAmount > 0 ? base * 3.0 : base * 0.35;
            expect(a.resources[i]).toBe(Math.min(cap, Math.max(floor, a.resources[i])));
            expect(a.resources[i]).toBe(floor);
            if (base > 0) expect(a.resources[i]).toBeLessThan(base);
        }
        // Components = 2 * Σ current resource price * quantity (Galaxy.1.cs:1031-1043).
        for (const def of a.galaxy.researchStatic!.componentStatic!.definitions) {
            let num = 0.0;
            for (const rr of def.resourceRequirements) num += a.resources[rr.resourceId] * rr.amount;
            expect(a.components[def.componentId]).toBe(num * 2.0);
        }
        expect(a.components.some((p, i) => p !== a.initialComponents[i])).toBe(true);
        // Design.calculateCurrentPurchasePrice sees the reviewed component prices.
        const design = a.galaxy.empires[0].designs[0];
        expect(design).toBeDefined();
        {
            let num = 0.0;
            for (const c of design.components) num += a.components[c.componentId];
            expect(design.calculateCurrentPurchasePrice(a.galaxy)).toBeCloseTo(num * (design.empire?.pirateEmpireBaseHabitat != null ? 2.5 : 5.0), 9);
        }
        // No Galaxy.Rnd draws in either function.
        expect(a.rndAfter).toBe(a.rndBefore);
        const b = run();
        expect(b.resources).toEqual(a.resources);
        expect(b.components).toEqual(a.components);
    }, 120000);
});
