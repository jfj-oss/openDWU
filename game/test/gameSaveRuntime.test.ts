// @slow — soak: 600 s / 1800 s runs with save/load round trips (test:slow tier; see vite.config.ts testTier).
// Save/load after the simulation has run: runtime-only model objects (ShipGroup fleets, DistressSignal /
// DeclinedTask, blockades, fighters, invasion stats, pirate colony control, orders / contracts, missions) must
// round-trip through the graph codec byte-identically and keep their shared identity.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { findStaticDataLeaks, flatEmpireList } from '../src/sim/save/galaxySave';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { HabitatCategoryType, type Habitat } from '../src/sim/types';
import { generateSuperPirateFaction } from '../src/sim/pirates';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const startOptions = { ...defaultStartGameOptions(), seed: 1 };

function timeOf(galaxy: Galaxy): GalaxyTime {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(galaxy.nowMs);
    return time;
}

/** Counts every reachable class instance by constructor name (own enumerable fields, arrays, Maps, Sets). */
function classCensus(root: object): Map<string, number> {
    const seen = new Set<object>();
    const out = new Map<string, number>();
    const stack: unknown[] = [root];
    while (stack.length > 0) {
        const v = stack.pop();
        if (v === null || typeof v !== 'object' || seen.has(v)) continue;
        seen.add(v);
        const proto = Object.getPrototypeOf(v) as object | null;
        if (Array.isArray(v)) stack.push(...v);
        else if (v instanceof Map) for (const [k, x] of v) stack.push(k, x);
        else if (v instanceof Set) stack.push(...v);
        else if (ArrayBuffer.isView(v)) continue;
        else {
            if (proto !== null && proto !== Object.prototype) {
                const name = (proto as { constructor: { name: string } }).constructor.name;
                out.set(name, (out.get(name) ?? 0) + 1);
            }
            stack.push(...Object.values(v));
        }
    }
    return out;
}

function roundTrip(game: Game): { text: string; restored: ReturnType<typeof deserializeGame>; text2: string } {
    const text = serializeGame(game, timeOf(game.galaxy), startOptions);
    const restored = deserializeGame(text, gameData);
    const text2 = serializeGame(restored.game, restored.time, restored.startOptions);
    return { text, restored, text2 };
}

function paired(a: Galaxy, b: Galaxy): [Empire, Empire][] {
    const ea = flatEmpireList(a);
    const eb = flatEmpireList(b);
    expect(eb.length).toBe(ea.length);
    return ea.map((e, i) => [e, eb[i]]);
}

function checkIdentity(original: Galaxy, restored: Galaxy): void {
    // Census: every class instance count matches (static data excluded — externals are the same instances).
    expect(classCensus(restored)).toEqual(classCensus(original));
    const byId = new Map<number, BuiltObject>();
    for (const b of restored.builtObjects) if (b != null) byId.set(b.builtObjectID, b);
    expect(restored.builtObjects.length).toBe(original.builtObjects.length);
    expect(restored.builtObjects.map((b) => b == null)).toEqual(original.builtObjects.map((b) => b == null));
    for (const [a, b] of paired(original, restored)) {
        expect(b.shipGroups.length, a.name).toBe(a.shipGroups.length);
        for (const g of b.shipGroups as (ShipGroup | null)[]) {
            if (g === null) continue;
            expect(g).toBeInstanceOf(ShipGroup);
            expect(g.empire).toBe(b);
            for (const ship of g.ships) {
                expect(ship.shipGroup).toBe(g);
                expect(byId.get(ship.builtObjectID)).toBe(ship);
            }
        }
        for (const bo of b.builtObjects) {
            expect(byId.get(bo.builtObjectID)).toBe(bo);
            if (bo.shipGroup !== null) expect(b.shipGroups).toContain(bo.shipGroup);
        }
        expect(b.distressSignals.length).toBe(a.distressSignals.length);
        expect(b.declinedTasks.length).toBe(a.declinedTasks.length);
    }
    expect(restored.blockades.length).toBe(original.blockades.length);
    expect(restored.orders.length).toBe(original.orders.length);
    // Habitat-owned runtime state.
    for (let i = 0; i < original.habitats.length; i++) {
        const [ha, hb] = [original.habitats[i], restored.habitats[i]];
        expect(hb.invasionStats === null).toBe(ha.invasionStats === null);
        expect(hb.pirateColonyControl.count).toBe(ha.pirateColonyControl.count);
    }
}

describe('game save/load after the sim has run', { timeout: 600000 }, () => {
    let game: Game;
    let rt: ReturnType<typeof roundTrip>;
    beforeAll(() => {
        game = createTickGame(gameData);
        runGameSeconds(game, 600);
        rt = roundTrip(game);
    }, 1800000);

    it('seed 1 after 600 s: serialize → deserialize → serialize is byte-identical', () => {
        expect(rt.text2).toBe(rt.text);
    });

    it('seed 1 after 600 s: runtime objects exist and keep their identity', () => {
        const g = game.galaxy;
        expect(g.nowMs).toBeGreaterThanOrEqual(600_000);
        const census = classCensus(g);
        // The run should have produced the runtime-only classes this test is about.
        expect(census.get('ShipGroup') ?? 0).toBeGreaterThan(0);
        expect(census.get('BuiltObjectMission') ?? 0).toBeGreaterThan(0);
        checkIdentity(g, rt.restored.game.galaxy);
        expect(rt.restored.time.elapsedMs).toBe(g.nowMs);
    });

    it('no static GameData object is written by value (all come back as the shared static instances)', () => {
        expect(findStaticDataLeaks(game.galaxy, gameData)).toEqual([]);
    });

    it('null holes in galaxy.builtObjects (teardown before RemoveNullBuiltObjects) are kept as null', () => {
        const probe = deserializeGame(rt.text, gameData).game;
        const list = probe.galaxy.builtObjects as (BuiltObject | null)[];
        const holes = [1, Math.trunc(list.length / 2), list.length - 1];
        for (const i of holes) list[i] = null;
        const text = serializeGame(probe, timeOf(probe.galaxy), startOptions);
        const back = deserializeGame(text, gameData);
        const after = back.game.galaxy.builtObjects as (BuiltObject | null)[];
        expect(after.length).toBe(list.length);
        for (let i = 0; i < list.length; i++) expect(after[i] === null, `slot ${i}`).toBe(list[i] === null);
        expect(serializeGame(back.game, back.time, back.startOptions)).toBe(text);
    });

    it('loading does not change the game: original and loaded game stay in lockstep for +300 s', () => {
        const original = game;
        const loaded = rt.restored.game;
        expect(loaded.galaxy.rnd.drawCount).toBe(original.galaxy.rnd.drawCount);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(original.galaxy));
        for (let step = 1; step <= 3; step++) {
            const ra = runGameSeconds(original, 100);
            const rb = runGameSeconds(loaded, 100);
            expect(rb.rndDraws, `+${step * 100} s draws`).toBe(ra.rndDraws);
            expect(Number.isFinite(rb.rndDraws)).toBe(true);
            expect(loaded.galaxy.rnd.drawCount).toBe(original.galaxy.rnd.drawCount);
            expect(stateDigest(loaded.galaxy), `+${step * 100} s digest`).toBe(stateDigest(original.galaxy));
        }
        const a = serializeGame(original, timeOf(original.galaxy), startOptions);
        const b = serializeGame(loaded, timeOf(loaded.galaxy), startOptions);
        expect(b.length).toBe(a.length);
        expect(b === a).toBe(true);
    });
});

function addSuperPirates(game: Game): Empire {
    const g = game.galaxy;
    const fuel = g.resourceSystem.fuelResources[0].resourceId;
    const home = g.habitats.find(
        (x) => x.category !== HabitatCategoryType.GasCloud && x.category !== HabitatCategoryType.Star && x.empire === null && x.basesAtHabitat.length === 0 && x.resources.some((r) => r.resourceId === fuel),
    ) as Habitat;
    return generateSuperPirateFaction(g, { independentColonies: g.independentColonies, startingAge: g.startingAge, difficultyLevel: g.difficultyLevel }, home, 'Deadly Phantoms', null, 4);
}

// 1800 s with the normal pirate factions (piratePrevalence 1.0). The super-pirate run stops at 600 s: with them the
// seed-1 game reaches the unported Empire.CompleteTeardown (TODO(port) M4u, events.ts) at ~660 s.
for (const [label, seconds, superPirates] of [['pirates, 1800 s', 1800, false], ['super pirates, 600 s', 600, true]] as const) {
    describe(`game save/load: seed 1 with ${label}`, { timeout: 2400000 }, () => {
        let game: Game;
        let rt: ReturnType<typeof roundTrip>;
        let superPirate: Empire | null = null;
        beforeAll(() => {
            game = createTickGame(gameData);
            if (superPirates) superPirate = addSuperPirates(game);
            runGameSeconds(game, seconds);
            rt = roundTrip(game);
        }, 2400000); // 40 min: the 1800 s soak runs at ~1/3 speed while other suites load the machine

        it('round trip is byte-identical', () => {
            expect(rt.text2).toBe(rt.text);
        });

        it('identity survives', () => {
            expect(game.galaxy.pirateEmpires.length).toBeGreaterThan(0);
            if (superPirate !== null) {
                const i = game.galaxy.pirateEmpires.indexOf(superPirate);
                expect(i).toBeGreaterThanOrEqual(0);
                expect(rt.restored.game.galaxy.pirateEmpires[i].builtObjects.length).toBe(superPirate.builtObjects.length);
            }
            checkIdentity(game.galaxy, rt.restored.game.galaxy);
            expect(findStaticDataLeaks(game.galaxy, gameData)).toEqual([]);
        });
    });
}
