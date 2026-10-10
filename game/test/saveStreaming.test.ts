// The streamed save (serializeGameChunks / CompactEncoder.encodeJson, save format 3): the galaxy graph written straight
// to UTF-8 bytes in chunks. The codec's edge cases round-trip (and re-encode to the same text in any chunk size), and a
// whole game's save loads back to the same graph — the format-2 tree of the loaded galaxy is the original's — and the
// same save text.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame, serializeGameChunks, serializeGameParts } from '../src/sim/save/gameSave';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { ByteWriter, CompactDecoder, CompactEncoder } from '../src/sim/save/compactCodec';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

class Thing {
    a = 1;
    b: unknown = null;
}

class Wide {
    f0 = 0;
    f1 = 1;
    f2 = 2;
    f3 = 3;
    f4 = 'x';
    f5 = true;
    f6 = null;
    f7 = 7.5;
    f8 = 8;
    f9 = 'z';
    o: unknown = null;
}

describe('streamed save text', { timeout: 600000 }, () => {
    it('round-trips the codec edge cases, and writes the same text in any chunk size', () => {
        const shared = { s: 'x' };
        const t = new Thing();
        t.b = t;
        const sparse: unknown[] = [1, , 3]; // eslint-disable-line no-sparse-arrays
        // Tables (arrays of leaf-only instances of one shape), sparse rows (instances repeating the previous one's
        // primitives) and repeated plain key lists (written once, then by keyset id).
        const rows = Array.from({ length: 5 }, (_, i) => Object.assign(new Thing(), { a: i % 2 === 0 ? 7 : -0, b: i < 3 ? shared : 'k' }));
        const wide = Array.from({ length: 4 }, (_, i) => Object.assign(new Wide(), { f3: i, o: { i } }));
        const value = {
            n: [0, -0, 1.5, -2e-7, 1e21, NaN, Infinity, -Infinity],
            str: 'quote " backslash \\ newline \n tab \t unicode é ☃ \u0001 😀',
            u: undefined,
            b: [true, false, null],
            sparse,
            map: new Map<unknown, unknown>([['k', shared], [shared, 2]]),
            set: new Set([shared, 'y']),
            f64: new Float64Array([1, NaN, -0, Infinity, 0.1]),
            u8: new Uint8Array([0, 255]),
            i32: new Int32Array([-5]),
            t,
            t2: new Thing(),
            again: shared,
            empty: {},
            emptyArr: [],
            nested: { 'weird key "': [[], [{}]] },
            rows,
            ids: Array.from({ length: 4 }, (_, i) => Object.assign(new Thing(), { a: 1000000 + i, b: undefined })),
            wide,
            plains: [{ p: 1, q: 'a' }, { p: 2, q: 'b' }, { q: 3, p: 4 }],
        };
        const opts = { classes: { Thing: Thing.prototype, Wide: Wide.prototype } };
        const encode = (v: unknown, chunkBytes: number): { text: string; enc: CompactEncoder; chunks: number } => {
            const chunks: Uint8Array[] = [];
            const enc = new CompactEncoder(opts, new Map());
            const w = new ByteWriter((c) => chunks.push(c.slice()), chunkBytes);
            enc.encodeJson(v, w);
            w.end();
            return { text: Buffer.concat(chunks).toString('utf8'), enc, chunks: chunks.length };
        };
        const { text, enc } = encode(value, 1 << 22);
        expect(text).toContain('[18,'); // a table
        expect(text).toMatch(/\[\d+,"[A-Za-z0-9_-]*"/); // a sparse row
        expect(text).toContain('[16,'); // a keyed plain object
        for (const chunkBytes of [1, 7, 64]) {
            const r = encode(value, chunkBytes);
            expect(r.text).toBe(text);
            if (chunkBytes === 1) expect(r.chunks).toBeGreaterThan(20);
        }
        const back = new CompactDecoder(opts, () => undefined, JSON.parse(JSON.stringify(enc.shapes)), enc.kinds).decode(JSON.parse(text)) as typeof value;
        expect(encode(back, 1 << 22).text).toBe(text);
        expect(back.n.slice(0, 5)).toEqual([0, 0, 1.5, -2e-7, 1e21]);
        expect(Object.is(back.n[1], 0)).toBe(true); // -0 is written as 0, as JSON writes it
        expect([Number.isNaN(back.n[5]), back.n[6], back.n[7]]).toEqual([true, Infinity, -Infinity]);
        expect(back.str).toBe(value.str);
        expect('u' in back && back.u === undefined).toBe(true);
        expect(back.sparse).toEqual([1, null, 3]);
        expect(back.map.get('k')).toBe(back.again);
        expect(back.map.get(back.again)).toBe(2);
        expect(back.set.has(back.again)).toBe(true);
        expect(back.f64).toBeInstanceOf(Float64Array);
        expect([...back.f64].map(String)).toEqual(['1', 'NaN', '0', 'Infinity', '0.1']);
        expect([...back.u8, ...back.i32]).toEqual([0, 255, -5]);
        expect(back.t).toBeInstanceOf(Thing);
        expect(back.t.b).toBe(back.t);
        expect(back.nested).toEqual({ 'weird key "': [[], [{}]] });
        expect(back.rows.map((r) => [r.a, r.b === back.again ? 'shared' : r.b])).toEqual([[7, 'shared'], [0, 'shared'], [7, 'shared'], [0, 'k'], [7, 'k']]);
        expect(back.rows.every((r) => r instanceof Thing && Object.keys(r).join() === 'a,b')).toBe(true);
        expect(back.ids.map((r) => r.a)).toEqual([1000000, 1000001, 1000002, 1000003]);
        expect(back.wide.map((w) => [w.f0, w.f3, w.f9, (w.o as { i: number }).i])).toEqual([[0, 0, 'z', 0], [0, 1, 'z', 1], [0, 2, 'z', 2], [0, 3, 'z', 3]]);
        expect(back.wide.every((w) => Object.keys(w).join() === Object.keys(new Wide()).join())).toBe(true);
        expect(back.plains).toEqual(value.plains);
        expect(back.plains.map((p) => Object.keys(p).join())).toEqual(['p,q', 'p,q', 'q,p']);
    });

    it('serializeGame (streamed) is the same text in any chunk size, and loads back to the same graph and text', () => {
        const game = cachedTickGame(gameData, { seconds: 120 });
        const time = new GalaxyTime().bindGalaxy(game.galaxy);
        const startOptions = { ...defaultStartGameOptions(), seed: 1 };
        const text = serializeGame(game, time, startOptions);
        expect(text.startsWith('{"version":2,"galaxy":{"version":3,')).toBe(true);
        const small = serializeGameParts(game, time, startOptions, (c) => c, 65536);
        expect(small.length).toBeGreaterThan(10);
        expect(small.join('') === text).toBe(true);
        expect(Buffer.concat(serializeGameChunks(game, time, startOptions, 4096)).toString('utf8') === text).toBe(true);
        const loaded = deserializeGame(text, gameData);
        expect(JSON.stringify(galaxyToJSON(loaded.game.galaxy)) === JSON.stringify(galaxyToJSON(game.galaxy))).toBe(true);
        expect(serializeGame(loaded.game, loaded.time, loaded.startOptions) === text).toBe(true);
    });
});
