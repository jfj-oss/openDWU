import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { MOVEMENT_DECELERATION_RANGE } from '../src/sim/galaxy';
import { ResourceRef } from '../src/sim/cargo';
import { Order, OrderList } from '../src/sim/logistics/orders';
import { Contract } from '../src/sim/logistics/contracts';
import {
    assignIndependentTraderMissions,
    cancelExpiredOrders,
    generateIndependentTraders,
    isObjectVisibleToThisEmpire,
    removeCompletedOrders,
    reviewIndependentColonies,
    selectPopularDesignCandidates,
    type GalaxyOrder,
} from '../src/sim/independentTraders';

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

// Records every galaxy.rnd draw (Next(a,b)=v / NextDouble).
function recordRnd(g: Galaxy): string[] {
    const log: string[] = [];
    const r = g.rnd as unknown as { next: (...a: number[]) => number; nextDouble: () => number };
    const next = r.next.bind(r);
    const nextDouble = r.nextDouble.bind(r);
    r.next = (...a: number[]) => { const v = next(...a); log.push(`Next(${a.join(',')})=${v}`); return v; };
    r.nextDouble = () => { const v = nextDouble(); log.push('NextDouble'); return v; };
    return log;
}

// createGame's first galaxy tick (Start.2.cs 1105-1106) with the long block's draws recorded;
// stopped right after it (test-only __phaseHook). No pirates: GenerateNewPirateEmpires draws nothing.
function runStartTick() {
    let log: string[] = [];
    let before: unknown[] = [];
    const g = createGame({
        ...opts(),
        __phaseHook: (phase, gal) => {
            if (phase === 'firstGalaxyTick:huge') {
                log = recordRnd(gal);
                before = gal.independentEmpire!.privateBuiltObjects.slice();
            }
            return phase === 'firstGalaxyTick' ? 'stop' : undefined;
        },
    }).galaxy;
    expect(before).toEqual([]);
    const traders = g.independentEmpire!.privateBuiltObjects.slice();
    return { g, log, traders };
}

/** createGame stopped before its first galaxy tick (the HEAD-era createGame end state + price reviews). */
function beforeFirstTick(): Galaxy {
    return createGame({ ...opts(), __phaseHook: (phase) => (phase === 'priceReviews' ? 'stop' : undefined) }).galaxy;
}

describe('independent traders (Galaxy.7.cs GenerateIndependentTraders)', () => {
    it('SelectPopularDesignCandidates: 3 per sub-role, cloned for the independent empire', () => {
        const g = beforeFirstTick();
        const originals = g.empires.flatMap((e) => e.designs);
        selectPopularDesignCandidates(g);
        expect(g.popularDesigns.length).toBe(18);
        const subRoles = [BuiltObjectSubRole.SmallFreighter, BuiltObjectSubRole.MediumFreighter, BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser];
        expect(g.popularDesigns.map((d) => d.subRole)).toEqual(subRoles.flatMap((s) => [s, s, s]));
        for (const d of g.popularDesigns) {
            expect(d.empire).toBe(g.independentEmpire);
            expect(d.buildCount).toBe(0);
            expect(originals).not.toContain(d);
        }
        // All BuildCounts are 0 at game start → the first three empires' designs (Empires order).
        // (re-pinned M4k: game-start research changes the Rnd stream before the design names are drawn)
        // (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in each game-start Empire.DoTasks long block)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        expect(g.popularDesigns.slice(0, 3).map((d) => d.name)).toEqual(['SZ1000 Light Freighter', 'LO1000 Light Hauler', 'BB1000 Merchant Freighter']);
        expect(g.popularDesigns.slice(3, 6).map((d) => d.name)).toEqual(['KX1000 Freight Hauler', 'NL1000 Cargo Ferry', 'VW1000 Cargo Freighter']);
    }, 60000);

    it('seed 1: count, ownership, placement at non-visible independent colonies', () => {
        const { g, traders } = runStartTick();
        const ind = g.independentEmpire!;
        const cols = g.independentColonies;
        expect(cols.length).toBe(10);
        let pop = 0;
        for (const c of cols) pop += c.population.totalAmount;
        // min(pop / 20000000, 10 * 15) - 0 existing non-pirate private ships.
        expect(Math.min(Math.trunc(pop / 20000000), cols.length * 15)).toBe(150);
        expect(traders.length).toBe(150);
        expect(ind.privateBuiltObjects).toEqual(traders);
        expect(ind.builtObjects.length).toBe(0);
        const freighters = g.popularDesigns.filter((d) => d.warpSpeed > 5000 && (d.subRole === BuiltObjectSubRole.SmallFreighter || d.subRole === BuiltObjectSubRole.MediumFreighter));
        for (const t of traders) {
            expect(t.empire).toBe(ind);
            expect(t.role).toBe(BuiltObjectRole.Freight);
            expect(freighters).toContain(t.design);
            expect(cols).toContain(t.parentHabitat);
            expect(isObjectVisibleToThisEmpire(g, g.playerEmpire!, t.parentHabitat!)).toBe(false);
            expect(t.xpos).toBe(t.parentHabitat!.xpos + t.parentOffsetX);
            expect(t.ypos).toBe(t.parentHabitat!.ypos + t.parentOffsetY);
            const d = Math.hypot(t.parentOffsetX, t.parentOffsetY);
            expect(d).toBeGreaterThanOrEqual(MOVEMENT_DECELERATION_RANGE - 1e-6);
            expect(d).toBeLessThanOrEqual(2 * MOVEMENT_DECELERATION_RANGE + 1e-6);
            expect(t.currentFuel).toBe(t.fuelCapacity);
            expect(t.targetHeading).toBe(t.heading);
            expect(g.builtObjects).toContain(t);
        }
        expect(freighters.reduce((s, d) => s + d.buildCount, 0)).toBe(150);
        // Player's capital system colony (Wailnas, system 128) is visible → never used.
        expect(traders.some((t) => t.parentHabitat!.name === 'Wailnas')).toBe(false);
        const perColony = new Map<string, number>();
        for (const t of traders) perColony.set(t.parentHabitat!.name, (perColony.get(t.parentHabitat!.name) ?? 0) + 1);
        // (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch, whose research-queue selection and research events draw Rnd)
        // (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in each game-start Empire.DoTasks long block)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        expect(Object.fromEntries(perColony)).toEqual({ 'Haako 4': 15, 'Dhayu 3': 13, 'S1 2': 16, Atoaklo: 23, 'S212 3': 17, 'S1 3': 14, Eroy: 12, 'S269 2': 11, 'S269 4': 18, 'S83 12': 11 });
        expect(traders.slice(0, 2).map((t) => [t.name, t.design.name])).toEqual([['Grimy Wayfarer', 'LO1000 Light Hauler'], ['Vanishing Moon', 'LO1000 Light Hauler']]);
    }, 60000);

    it('seed 1: exact Rnd draws, deterministic', () => {
        const a = runStartTick();
        // GenerateIndependentTraders draws on the long tick (up to GenerateNewPirateEmpires), then (M4s1) the independent
        // colonies' pirate offers: IndependentColoniesMakeSmugglingOffersToPirates draws Next(0, 2) per populated colony
        // and, on a 1, DetermineColonyDeficientInResources' Next(0, orders) (no orders yet: Next(0, 0));
        // IndependentColoniesMakeDefendOffersToPirates draws Next(0, 30) per colony (Galaxy.cs 3203-3276).
        // (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in each game-start Empire.DoTasks long block)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        expect(a.log.length).toBe(1563);
        expect(a.log.slice(-25)).toEqual([
            'Next(0,2)=1', 'Next(0,0)=0', 'Next(0,2)=0', 'Next(0,2)=1', 'Next(0,0)=0', 'Next(0,2)=1', 'Next(0,0)=0', 'Next(0,2)=1',
            'Next(0,0)=0', 'Next(0,2)=0', 'Next(0,2)=0', 'Next(0,2)=0', 'Next(0,2)=0', 'Next(0,2)=1', 'Next(0,0)=0',
            ...['10', '21', '14', '26', '2', '26', '22', '20', '11', '12'].map((v) => `Next(0,30)=${v}`),
        ]);
        expect(a.log.slice(0, 22)).toEqual([
            // trader 0: Next(0,3) freighter-size roll; Next(0,3) index; Next(0,10) start colony;
            // SelectRandomUniqueStandardShipName (Next(0,127), Next(0,125), Next(0,7) >= 2 → no extra draw);
            // SelectRandomHeading; SelectRelativeParkingPoint.
            'Next(0,3)=0', 'Next(0,3)=1', 'Next(0,10)=1', 'Next(0,127)=122', 'Next(0,125)=10', 'Next(0,7)=6',
            'NextDouble', 'NextDouble', 'Next(0,2)=1', 'NextDouble',
            // trader 1: same shape.
            'Next(0,3)=2', 'Next(0,3)=1', 'Next(0,10)=0', 'Next(0,127)=118', 'Next(0,125)=18', 'Next(0,7)=3',
            'NextDouble', 'NextDouble', 'Next(0,2)=1', 'NextDouble',
            'Next(0,3)=2', 'Next(0,3)=2',
        ]);
        const b = runStartTick();
        expect(b.log).toEqual(a.log);
        expect(b.traders.map((t) => [t.name, t.design.name, t.parentHabitat!.name, t.xpos, t.ypos])).toEqual(a.traders.map((t) => [t.name, t.design.name, t.parentHabitat!.name, t.xpos, t.ypos]));
    }, 60000);

    it('a second call tops up to the target only (num2 = 0 → no draws)', () => {
        const { g } = runStartTick();
        const log = recordRnd(g);
        reviewIndependentColonies(g);
        expect(generateIndependentTraders(g).length).toBe(0);
        assignIndependentTraderMissions(g); // no-op at game start
        expect(log.length).toBe(0);
        expect(g.independentEmpire!.privateBuiltObjects.length).toBe(150);
    }, 60000);

    it('fallback: no popular freighters → designs generated from the independent spec per playable race', () => {
        const g = beforeFirstTick();
        g.empireTerritory.reviewEmpireTerritory(g); // Galaxy.cs 3083-3085 huge block
        selectPopularDesignCandidates(g);
        g.popularDesigns = [];
        reviewIndependentColonies(g);
        const traders = generateIndependentTraders(g);
        const ind = g.independentEmpire!;
        expect(traders.length).toBe(150);
        const player = g.playerEmpire!.dominantRace!;
        const races = g.races.filter((r) => r.playable && r !== player);
        const kept = races.filter((r) => r.designsPictureFamilyIndex !== player.designsPictureFamilyIndex).length;
        expect(ind.designs.filter((d) => d.subRole === BuiltObjectSubRole.SmallFreighter).length).toBe(kept);
        expect(ind.designs.filter((d) => d.subRole === BuiltObjectSubRole.MediumFreighter).length).toBe(kept);
        for (const t of traders) expect(ind.designs).toContain(t.design);
    }, 60000);

    it('orders: completed and expired orders are removed', () => {
        const g = createGame(opts()).galaxy;
        const colony = g.empires[0].colonies[0];
        // Order.AmountDelivered is the sum over its contracts (Order.cs 178); AmountStillToArrive = fulfill − delivered.
        const mk = (amountRequested: number, amountDelivered: number, expiryDate: number): GalaxyOrder => {
            const o = new Order(g, colony, new ResourceRef(0), amountRequested, expiryDate, 0);
            const c = new Contract(null, amountDelivered, 0, -1, g.empires[0].empireId);
            c.amountDelivered = amountDelivered;
            o.contracts.push(c);
            return o;
        };
        const done = mk(10, 10, Number.MAX_SAFE_INTEGER);
        const open = mk(10, 5, Number.MAX_SAFE_INTEGER);
        const expired = mk(10, 5, 0);
        const orders = new OrderList(true);
        for (const o of [done, open, expired]) orders.add(o);
        removeCompletedOrders(orders);
        expect(orders.items).toEqual([open, expired]);
        cancelExpiredOrders(g, orders);
        expect(orders.items).toEqual([open]);
        expect(orders.getOrdersForHabitat(colony).items).toEqual([open]);
    }, 60000);
});
