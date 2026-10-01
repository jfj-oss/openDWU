// Unit checks for the save format's reference-tracking codec (src/sim/save/graphCodec.ts).
import { describe, expect, it } from 'vitest';
import { GraphDecoder, GraphEncoder, type GraphCodecOptions } from '../src/sim/save/graphCodec';

class Node {
    name = '';
    next: Node | null = null;
    hidden = 0;
}

function roundTrip(value: unknown, options: GraphCodecOptions): { text: string; back: unknown; text2: string } {
    const encoder = new GraphEncoder(options, new Map());
    const text = JSON.stringify(encoder.encode(value));
    // Class instances are {$s, $v} against the encoder's shape table, which the save stores beside the graph.
    const back = new GraphDecoder(options, () => undefined, JSON.parse(JSON.stringify(encoder.shapes))).decode(JSON.parse(text));
    const text2 = JSON.stringify(new GraphEncoder(options, new Map()).encode(back));
    return { text, back, text2 };
}

describe('graphCodec', () => {
    const options: GraphCodecOptions = { classes: { Node: Node.prototype } };

    it('keeps null holes, sparse slots, undefined and non-finite numbers in arrays', () => {
        // eslint-disable-next-line no-sparse-arrays
        const list: unknown[] = [1, null, , undefined, NaN, -Infinity];
        const { back, text, text2 } = roundTrip({ list }, options);
        const b = (back as { list: unknown[] }).list;
        expect(b.length).toBe(6);
        expect(b[1]).toBeNull();
        expect(b[2]).toBeNull(); // a sparse slot is written as a JSON null (galaxy.builtObjects holes are explicit nulls)
        expect(b[3]).toBeUndefined();
        expect(Number.isNaN(b[4])).toBe(true);
        expect(b[5]).toBe(-Infinity);
        expect(text2).toBe(text);
    });

    it('round-trips Map / Set (object keys by identity), typed arrays and cycles', () => {
        const a = new Node();
        const b = new Node();
        a.name = 'a';
        b.name = 'b';
        a.next = b;
        b.next = a;
        const value = {
            map: new Map<unknown, unknown>([[a, b], ['k', [a]]]),
            set: new Set<unknown>([b, 3]),
            u8: new Uint8Array([1, 2, 255]),
            f32: new Float32Array([0.5, -1.25]),
            i32: new Int32Array([-7]),
            a,
        };
        const { back, text, text2 } = roundTrip(value, options);
        const v = back as typeof value;
        expect(v.a).toBeInstanceOf(Node);
        expect(v.a.next!.next).toBe(v.a);
        expect(v.map.get(v.a)).toBe(v.a.next);
        expect(v.set.has(v.a.next)).toBe(true);
        expect(v.u8).toBeInstanceOf(Uint8Array);
        expect([...v.u8]).toEqual([1, 2, 255]);
        expect(v.f32).toBeInstanceOf(Float32Array);
        expect([...v.i32]).toEqual([-7]);
        expect(text2).toBe(text);
    });

    it('writes each class shape once and still reads the older {$t, $f} instances', () => {
        const a = new Node();
        const b = new Node();
        a.next = b;
        const encoder = new GraphEncoder(options, new Map());
        const enc = encoder.encode([a, b]);
        expect(encoder.shapes).toEqual([['Node', 'name', 'next', 'hidden']]);
        expect(JSON.stringify(enc)).not.toContain('hidden');
        const old = [{ $t: 'Node', $f: { name: 'x', next: null, hidden: 3 } }];
        const back = new GraphDecoder(options, () => undefined).decode(old) as Node[];
        expect(back[0]).toBeInstanceOf(Node);
        expect(back[0].hidden).toBe(3);
    });

    it('rejects functions and unregistered classes, and honours skipFields / revive', () => {
        expect(() => new GraphEncoder(options, new Map()).encode({ f: () => 1 })).toThrow(/Cannot serialize a function at \$\.f/);
        class Other {}
        expect(() => new GraphEncoder(options, new Map()).encode([new Other()])).toThrow(/Other at \$\[0\]: class not registered/);
        const withHooks: GraphCodecOptions = {
            classes: { Node: Node.prototype },
            skipFields: new Map([[Node.prototype, new Set(['hidden'])]]),
            revive: new Map([[Node.prototype, (n: object) => ((n as Node).hidden = 42)]]),
        };
        const n = new Node();
        n.hidden = 7;
        const { back } = roundTrip(n, withHooks);
        expect((back as Node).hidden).toBe(42);
    });
});
