// graphCodec.ts GraphDecoder shape constructors (perf: one generated constructor per saved shape, so loaded instances
// share hidden classes with in-object fields) must rebuild exactly the graph the Object.create + defineProperty path
// does: on a Mature-age game, both decodes re-serialize to the original save text, every instance has the same own
// property names, order and attributes on the same prototype, and both copies tick identically (state digest and
// save text after running).
import { beforeAll, describe, expect, it } from 'vitest';
import type { Game } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';
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

        const wa = walk(a);
        const wb = walk(b);
        expect(wa.length).toBe(wb.length);
        expect(wa.length).toBeGreaterThan(100000);
        for (let i = 0; i < wa.length; i++) {
            const x = wa[i];
            const y = wb[i];
            expect(Object.getPrototypeOf(x)).toBe(Object.getPrototypeOf(y));
            const dx = Object.getOwnPropertyDescriptors(x);
            const dy = Object.getOwnPropertyDescriptors(y);
            const kx = Reflect.ownKeys(dx);
            expect(kx).toEqual(Reflect.ownKeys(dy));
            for (const k of kx) {
                const p = (dx as Record<string | symbol, PropertyDescriptor>)[k];
                const q = (dy as Record<string | symbol, PropertyDescriptor>)[k];
                expect([p.writable, p.enumerable, p.configurable, 'get' in p]).toEqual([q.writable, q.enumerable, q.configurable, 'get' in q]);
            }
        }

        runGameSeconds(a, 20);
        runGameSeconds(b, 20);
        expect(stateDigest(a)).toBe(stateDigest(b));
        expect(a.rnd.drawCount).toBe(b.rnd.drawCount);
        expect(JSON.stringify(galaxyToJSON(a))).toBe(JSON.stringify(galaxyToJSON(b)));
    }, 1_800_000);
});
