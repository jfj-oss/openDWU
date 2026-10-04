// [improvements] State ships first at shipyards (src/sim/construction/statePriority.ts), on the seed-1 harness game:
// the player's first space port, its queue driven directly (ConstructionQueue.DoConstruction) with the queued ships'
// components stocked in the port's cargo. A doConstruction with no time passed only runs ProcessWaitQueue (no build
// progress), which isolates the berth assignment.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Design } from '../src/sim/design';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { Cargo } from '../src/sim/cargo';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import { builtObjectConstructionQueue, type ConstructionQueue } from '../src/sim/construction/constructionQueue';
import { purchaseNewBuiltObjectAtBuiltObject } from '../src/sim/construction/empireConstruction';
import {
    STATE_PRIORITY_MAX_PAUSE_MS,
    constructionProgress,
    setStatePriorityShipyards,
    statePriorityActive,
    statePriorityPausedTotal,
} from '../src/sim/construction/statePriority';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';

const S = BuiltObjectSubRole;
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

interface World {
    game: Game;
    g: Galaxy;
    p: Empire;
    port: BuiltObject;
    q: ConstructionQueue;
    state: Design;
    priv: Design;
}

/** The harness game with the player's first space port emptied (its queued ships dropped) and money to spare. */
function fresh(empireOf: (g: Galaxy) => Empire = (g) => g.playerEmpire!): World {
    const game = cachedTickGame(gameData);
    const g = game.galaxy;
    const p = empireOf(g);
    p.initiateConstruction = false;
    const port = p.spacePorts[0] as BuiltObject;
    const q = builtObjectConstructionQueue(port) as ConstructionQueue;
    q.clear();
    p.stateMoney = 1e9;
    p.privateMoney = 1e9;
    const state = findNewestCanBuild(p.designs, S.Escort, p)!;
    const priv = findNewestCanBuild(p.designs, S.SmallFreighter, p)!;
    expect(state).toBeTruthy();
    expect(priv).toBeTruthy();
    q.resetProcessTime(g.nowMs);
    return { game, g, p, port, q, state, priv };
}

/** Purchase a ship at the port as the empire does (paid, components reserved) and stock its components. */
function buy(w: World, design: Design, isState: boolean): BuiltObject {
    const bo = purchaseNewBuiltObjectAtBuiltObject(w.g, w.p, design, w.port, isState, true);
    expect(bo).not.toBeNull();
    for (const c of design.components) w.port.cargo!.add(Cargo.ofComponent(c, 1, w.p));
    expect(bo!.owner != null).toBe(isState);
    return bo!;
}

/** Run the queue `dtMs` of galaxy time (0 = only ProcessWaitQueue). */
function step(w: World, dtMs: number): void {
    w.g.nowMs += dtMs;
    w.q.doConstruction(w.g, w.g.nowMs);
}

const berths = (w: World): (BuiltObject | null)[] => w.q.constructionYards!.map((y) => y.shipUnderConstruction);
const waiting = (w: World): BuiltObject[] => [...w.q.constructionWaitQueue!];
const statuses = (b: BuiltObject): ComponentStatus[] => b.components.items.map((c) => c.status);

/** Fill every berth with a private ship and let them build for a while. */
function fillWithPrivates(w: World, buildMs = 20000): BuiltObject[] {
    const n = w.q.constructionYards!.length;
    expect(n).toBeGreaterThan(0);
    const ps: BuiltObject[] = [];
    for (let i = 0; i < n; i++) ps.push(buy(w, w.priv, false));
    step(w, 0);
    expect(berths(w)).toEqual(ps);
    step(w, buildMs);
    return ps;
}

/** Money, the port's cargo (amount / reserved per commodity) and every queued ship's components. */
function ledger(w: World, ships: BuiltObject[]): string {
    const cargo = w.port.cargo!.items.map((c) => `${c.commodityComponent !== null ? 'c' + c.commodityComponent.componentId : 'r' + JSON.stringify(c.commodity)}:${c.amount}/${c.reserved}`).sort();
    return JSON.stringify({ state: w.p.stateMoney, priv: w.p.privateMoney, cargo, ships: ships.map(statuses) });
}

describe('statePriorityShipyards: the switch', () => {
    it('is off until the journaled player command turns it on (player empire only)', () => {
        const { g, p } = fresh();
        expect(statePriorityActive(g, p)).toBe(false);
        const r = runPlayerCommand(g, p, 'setStatePriorityShipyards', [true]);
        expect(r).toBe(true);
        const entry = commandLog(g).at(-1)!;
        expect('op' in entry && entry.op).toBe('setStatePriorityShipyards');
        expect(statePriorityActive(g, p)).toBe(true);
        const ai = g.empires.find((e) => e !== p)!;
        expect(setStatePriorityShipyards(g, ai, true)).toBe(false);
        expect('statePriorityShipyards' in ai).toBe(false);
        runPlayerCommand(g, p, 'setStatePriorityShipyards', [false]);
        expect('statePriorityShipyards' in p).toBe(false);
    });
});

describe('statePriorityShipyards: berths', () => {
    it('a state ship takes a free berth before private ships queued earlier', () => {
        const w = fresh();
        setStatePriorityShipyards(w.g, w.p, true);
        const n = w.q.constructionYards!.length;
        const ps: BuiltObject[] = [];
        for (let i = 0; i < n + 1; i++) ps.push(buy(w, w.priv, false));
        const s = buy(w, w.state, true);
        step(w, 0);
        expect(berths(w)).toContain(s);
        // The privates keep their queue order: the first n - 1 got the remaining berths, the last two wait.
        expect(berths(w).filter((b) => b !== s)).toEqual(ps.slice(0, n - 1));
        expect(waiting(w)).toEqual(ps.slice(n - 1));
    });

    it('a waiting state ship bumps the least-built private ship, which keeps its progress and resumes', () => {
        const w = fresh();
        setStatePriorityShipyards(w.g, w.p, true);
        const ps = fillWithPrivates(w);
        const progress = ps.map(constructionProgress);
        const victim = ps[progress.indexOf(Math.min(...progress))];
        const yi = berths(w).indexOf(victim);
        const yardProgress = w.q.constructionYards![yi].incrementalProgress;
        const before = statuses(victim);
        expect(before.some((st) => st === ComponentStatus.Normal)).toBe(true);
        const ledger0 = ledger(w, ps);

        const s = buy(w, w.state, true);
        const ledger1 = ledger(w, [...ps]);
        step(w, 0);
        expect(berths(w)[yi]).toBe(s);
        expect(waiting(w)).toEqual([victim]);
        expect(statuses(victim)).toEqual(before); // paused, nothing undone
        expect(victim.builtAt).toBe(w.port);
        expect(ledger(w, ps)).toBe(ledger1); // the bump moves nothing

        // A berth frees: the paused ship resumes with its components and the yard's fractional progress.
        w.g.nowMs += 1000;
        w.q.resetProcessTime(w.g.nowMs); // a second of pause, no build time
        expect(w.q.removeBuiltObject(s)).toBe(true);
        step(w, 0);
        expect(berths(w)[yi]).toBe(victim);
        expect(waiting(w)).toEqual([]);
        expect(statuses(victim)).toEqual(before);
        expect(w.q.constructionYards![yi].incrementalProgress).toBe(yardProgress);
        expect(victim.statePriorityPausedAt).toBeUndefined();
        expect(victim.statePriorityPausedMs).toBe(1000);
        // Everything but the state ship's own purchase is as before the bump.
        void ledger0;
        expect(ledger(w, ps)).toBe(ledger1);
    });

    it('a private ship paused more than 6 months in all is not bumped again (and is not passed over for a berth)', () => {
        const w = fresh();
        setStatePriorityShipyards(w.g, w.p, true);
        const ps = fillWithPrivates(w);
        const s1 = buy(w, w.state, true);
        step(w, 0);
        const victim = waiting(w)[0];
        expect(ps).toContain(victim);
        const yi = berths(w).indexOf(s1);
        // Paused just over 6 months; then its berth frees.
        w.g.nowMs += STATE_PRIORITY_MAX_PAUSE_MS + 1;
        w.q.resetProcessTime(w.g.nowMs);
        // Queued behind it: another state ship. The long-paused private ship still goes first (original order).
        const s2 = buy(w, w.state, true);
        w.q.removeBuiltObject(s1);
        step(w, 0);
        expect(berths(w)[yi]).toBe(victim);
        expect(statePriorityPausedTotal(w.g, victim)).toBe(STATE_PRIORITY_MAX_PAUSE_MS + 1);
        // s2 bumps another private ship, never the long-paused one.
        expect(berths(w)).toContain(s2);
        expect(berths(w)).toContain(victim);
        // More state ships: every other private ship is bumped, the exempt one keeps its berth.
        for (let i = 0; i < ps.length + 2; i++) buy(w, w.state, true);
        step(w, 0);
        expect(berths(w)).toContain(victim);
        expect(berths(w).filter((b) => b !== null && b.owner == null)).toEqual([victim]);
    });

    it('no money or component is lost or double-counted: every ship completes from exactly its stocked components', () => {
        const w = fresh();
        setStatePriorityShipyards(w.g, w.p, true);
        const count = new Map<number, number>();
        const cargoOf = (id: number) => w.port.cargo!.items.filter((c) => c.commodityComponent?.componentId === id).reduce((a, c) => a + c.amount, 0);
        const ps = fillWithPrivates(w, 5000);
        const ss = [buy(w, w.state, true), buy(w, w.state, true)];
        const all = [...ps, ...ss];
        for (const b of all) for (const c of b.design.components) count.set(c.componentId, (count.get(c.componentId) ?? 0) + 1);
        const built0 = new Map<number, number>();
        for (const b of all) for (const c of b.components.items) if (c.status === ComponentStatus.Normal) built0.set(c.componentId, (built0.get(c.componentId) ?? 0) + 1);
        const before = new Map([...count.keys()].map((id) => [id, cargoOf(id)]));
        const money = [w.p.stateMoney, w.p.privateMoney];
        let bumped = false;
        for (let i = 0; i < 3000 && all.some((b) => b.builtAt !== null); i++) {
            step(w, 5000);
            if (ps.some((b) => b.statePriorityPausedMs !== undefined || b.statePriorityPausedAt !== undefined)) bumped = true;
        }
        expect(bumped).toBe(true);
        for (const b of all) {
            expect(b.builtAt).toBeNull();
            expect(statuses(b).every((st) => st === ComponentStatus.Normal)).toBe(true);
        }
        // Each component still to build was taken from the cargo exactly once.
        for (const [id, n] of count) expect(before.get(id)! - cargoOf(id)).toBe(n - (built0.get(id) ?? 0));
        expect([w.p.stateMoney, w.p.privateMoney]).toEqual(money);
    }, 300000);
});

describe('statePriorityShipyards: off is the original', () => {
    const scenario = (w: World): string => {
        const ps = fillWithPrivates(w, 15000);
        buy(w, w.state, true);
        buy(w, w.priv, false);
        buy(w, w.state, true);
        const trace: string[] = [];
        for (let i = 0; i < 40; i++) {
            step(w, 5000);
            trace.push(JSON.stringify([berths(w).map((b) => b?.name ?? null), waiting(w).map((b) => b.name)]));
        }
        void ps;
        return stateDigest(w.g) + '|' + trace.join(';') + '|' + w.g.rnd.next(0, 1 << 30);
    };

    it('switched on then off: the same digest and Rnd as an untouched game', () => {
        const original = scenario(fresh());
        const w = fresh();
        setStatePriorityShipyards(w.g, w.p, true);
        setStatePriorityShipyards(w.g, w.p, false);
        expect(scenario(w)).toBe(original);
        const on = fresh();
        setStatePriorityShipyards(on.g, on.p, true);
        expect(scenario(on)).not.toBe(original);
    }, 300000);

    it('an AI empire\'s yards are untouched with the switch on', () => {
        const ai = (g: Galaxy) => g.empires.find((e) => e !== g.playerEmpire && e.spacePorts.length > 0 && findNewestCanBuild(e.designs, S.SmallFreighter, e) !== null && findNewestCanBuild(e.designs, S.Escort, e) !== null)!;
        const original = scenario(fresh(ai));
        const w = fresh(ai);
        setStatePriorityShipyards(w.g, w.g.playerEmpire!, true);
        expect(scenario(w)).toBe(original);
    }, 300000);
});

describe('statePriorityShipyards: save / load', () => {
    it('the switch and a paused ship round-trip; an untouched game saves none of the fields', () => {
        const w = fresh();
        const time = new GalaxyTime();
        time.togglePause();
        const start = { ...defaultStartGameOptions(), seed: 1 };
        const plain = serializeGame(w.game, time, start);
        expect(plain).not.toContain('statePriority');
        setStatePriorityShipyards(w.g, w.p, true);
        fillWithPrivates(w);
        buy(w, w.state, true);
        step(w, 0);
        const victim = waiting(w)[0];
        const progress = victim.statePriorityProgress;
        expect(victim.statePriorityPausedAt).toBe(w.g.nowMs);
        const loaded = deserializeGame(serializeGame(w.game, time, start), gameData).game;
        const p2 = loaded.galaxy.playerEmpire!;
        expect(p2.statePriorityShipyards).toBe(true);
        const q2 = builtObjectConstructionQueue(p2.spacePorts[0] as BuiltObject)!;
        const v2 = q2.constructionWaitQueue![0];
        expect(v2.name).toBe(victim.name);
        expect(v2.statePriorityPausedAt).toBe(victim.statePriorityPausedAt);
        expect(v2.statePriorityProgress).toBe(progress);
        expect(statuses(v2)).toEqual(statuses(victim));
    }, 300000);
});
