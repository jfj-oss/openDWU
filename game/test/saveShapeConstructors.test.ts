// graphCodec.ts GraphDecoder shape constructors (perf: one generated constructor per saved shape, so loaded instances
// share hidden classes with in-object fields) must rebuild exactly the graph the Object.create + defineProperty path
// does, and so must compactCodec.ts (save format 3) both ways: on a Mature-age game, every decode re-serializes to the
// original format-2 tree, every instance has the same own property names, order and attributes on the same prototype,
// and the copies tick identically (state digest and save text after running).
import { beforeAll, describe, expect, it } from 'vitest';
import type { Game } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import { galaxyFromJSON, galaxyToJSON, galaxyToSaveChunks } from '../src/sim/save/galaxySave';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

let gameData: GameData;
let game: Game;

beforeAll(async () => {
    gameData = await loadGameDataFs();
    game = cachedTickGame(gameData, { age: 4, seconds: 60 });
}, 1_800_000);

/** Every object reachable from `root` (own enumerable properties, arrays, Map / Set entries), in a fixed walk order. */
function walk(root: unknown): object[] {
    const out: object[] = [];
    const seen = new Set<object>();
    const stack: unknown[] = [root];
    while (stack.length > 0) {
        const v = stack.pop();
        if (v === null || typeof v !== 'object' || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
        if (v instanceof Map) for (const [k, x] of v) stack.push(k, x);
        else if (v instanceof Set) for (const x of v) stack.push(x);
        else if (ArrayBuffer.isView(v)) continue;
        else for (const k of Object.keys(v)) stack.push((v as Record<string, unknown>)[k]);
    }
    return out;
}

describe('save decoder shape constructors', () => {
    it('rebuild the same graph as the defineProperty path, and tick identically', () => {
        const text = JSON.stringify(galaxyToJSON(game.galaxy));
        const a = galaxyFromJSON(JSON.parse(text), gameData);
        const b = galaxyFromJSON(JSON.parse(text), gameData, { shapeConstructors: false });
        expect(JSON.stringify(galaxyToJSON(a))).toBe(text);
        expect(JSON.stringify(galaxyToJSON(b))).toBe(text);
        // The save file's format 3 (compactCodec.ts), both ways, rebuilds the same graph as format 2.
        const text3 = Buffer.concat(galaxyToSaveChunks(game.galaxy)).toString('utf8');
        const c = galaxyFromJSON(JSON.parse(text3), gameData);
        const d = galaxyFromJSON(JSON.parse(text3), gameData, { shapeConstructors: false });
        expect(JSON.stringify(galaxyToJSON(c))).toBe(text);
        expect(JSON.stringify(galaxyToJSON(d))).toBe(text);

        const wa = walk(a);
        expect(wa.length).toBeGreaterThan(100000);
        for (const other of [b, c, d]) sameGraph(wa, walk(other));

        runGameSeconds(a, 20);
        runGameSeconds(b, 20);
        runGameSeconds(c, 20);
        expect(stateDigest(a)).toBe(stateDigest(b));
        expect(stateDigest(c)).toBe(stateDigest(a));
        expect(a.rnd.drawCount).toBe(b.rnd.drawCount);
        expect(c.rnd.drawCount).toBe(a.rnd.drawCount);
        expect(JSON.stringify(galaxyToJSON(a))).toBe(JSON.stringify(galaxyToJSON(b)));
        expect(JSON.stringify(galaxyToJSON(c))).toBe(JSON.stringify(galaxyToJSON(a)));
    }, 1_800_000);
});

/**
 * The two walks are the same graph: per object the prototype and the own property names, order and attributes. Each
 * check is a plain comparison first and an expect only on a difference (the same assertion, but not millions of
 * expect calls on a 100 000-object graph).
 */
function sameGraph(wa: object[], wb: object[]): void {
    expect(wa.length).toBe(wb.length);
    for (let i = 0; i < wa.length; i++) {
        const x = wa[i];
        const y = wb[i];
        if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) expect(Object.getPrototypeOf(x)).toBe(Object.getPrototypeOf(y));
        const dx = Object.getOwnPropertyDescriptors(x);
        const dy = Object.getOwnPropertyDescriptors(y);
        const kx = Reflect.ownKeys(dx);
        const ky = Reflect.ownKeys(dy);
        if (kx.length !== ky.length || kx.some((k, j) => k !== ky[j])) expect(kx).toEqual(ky);
        for (const k of kx) {
            const p = (dx as Record<string | symbol, PropertyDescriptor>)[k];
            const q = (dy as Record<string | symbol, PropertyDescriptor>)[k];
            const ap = [p.writable, p.enumerable, p.configurable, 'get' in p];
            const aq = [q.writable, q.enumerable, q.configurable, 'get' in q];
            if (ap.some((v, j) => v !== aq[j])) expect(ap).toEqual(aq);
        }
    }
}
