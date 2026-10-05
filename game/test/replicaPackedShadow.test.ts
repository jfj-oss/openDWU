// Replica sync: the packed shadow store (src/simworker/shadowStore.ts) changes how the encoder remembers what it sent,
// not what it sends. The encoder as it was before (test/helpers/replicaEncoderLegacy.ts: one JS array per object) and
// the current one run side by side on the same seed-1 harness game, both reading the same authoritative galaxy after
// every step: every delta must be the same, byte for byte — shells, births, bodies, their f64 lanes, strings, typed
// payloads, drops, shapes, the cold dependency, the counters — through ship / shot / explosion births, lanes widening,
// and objects dropped by the incremental mark.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { ReplicaEncoder as LegacyEncoder } from './helpers/replicaEncoderLegacy';
import type { GameData } from '../src/sim/data/gameData';
import { nextFrameMs, runSimFrame, schedulerState } from '../src/sim/tick/scheduler';
import { GalaxySyncSource } from '../src/simworker/replicaGalaxy';
import type { ReplicaDelta, ReplicaEncoder, ReplicaPart } from '../src/simworker/replicaSync';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** A fake wall clock (the cold / mark budgets then slice the same way for both encoders). */
function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.002);
}

function bytes(a: ArrayBufferView): Uint8Array {
    return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

/** The first difference between two parts (null: identical). */
function partDiff(a: ReplicaPart, b: ReplicaPart): string | null {
    for (const k of ['shells', 'births', 'birthNums', 'body', 'bodyNums'] as const) {
        const x = bytes(a[k]);
        const y = bytes(b[k]);
        if (x.length !== y.length) return `${k}: ${x.length} vs ${y.length} bytes`;
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${k}: byte ${i} differs`;
    }
    if (JSON.stringify(a.strs) !== JSON.stringify(b.strs)) return 'strs differ';
    if (JSON.stringify(a.drops) !== JSON.stringify(b.drops)) return 'drops differ';
    if (a.typed.length !== b.typed.length) return 'typed payload count differs';
    for (let i = 0; i < a.typed.length; i++) {
        if (a.typed[i].constructor !== b.typed[i].constructor) return `typed ${i}: kind differs`;
        const x = bytes(a.typed[i]);
        const y = bytes(b.typed[i]);
        if (x.length !== y.length || x.some((v, j) => v !== y[j])) return `typed ${i}: contents differ`;
    }
    return null;
}

function deltaDiff(a: ReplicaDelta, b: ReplicaDelta): string | null {
    if (a.seq !== b.seq || a.coldDep !== b.coldDep) return `seq / coldDep: ${a.seq}/${a.coldDep} vs ${b.seq}/${b.coldDep}`;
    if (JSON.stringify(a.shapes) !== JSON.stringify(b.shapes)) return 'shapes differ';
    const { diffMs: _a, hotMs: _b, ...sa } = a.stats;
    const { diffMs: _c, hotMs: _d, ...sb } = b.stats;
    if (JSON.stringify(sa) !== JSON.stringify(sb)) return `stats: ${JSON.stringify(sa)} vs ${JSON.stringify(sb)}`;
    const hot = partDiff(a.hot, b.hot);
    if (hot !== null) return `hot ${hot}`;
    const cold = partDiff(a.cold, b.cold);
    return cold === null ? null : `cold ${cold}`;
}

describe('replica sync: packed shadows', () => {
    it('the packed encoder sends exactly what the boxed-array encoder sent, step after step (seed-1 harness)', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        // Short cold cycles and a mark every cycle: many full compares, marks and drops within the run.
        const opts = { minColdSlices: 12, markEveryCycles: 1 };
        const fresh = new GalaxySyncSource(g, opts);
        const legacy = new GalaxySyncSource(g, opts, (o, roots) => new LegacyEncoder(o, roots) as unknown as ReplicaEncoder);
        const clockA = fakeClock();
        const clockB = fakeClock();
        const same = (a: ReplicaDelta, b: ReplicaDelta, at: string): void => {
            const d = deltaDiff(a, b);
            if (d !== null) throw new Error(`${at}: ${d}`);
        };
        same(fresh.encoder.diff(true, clockA), legacy.encoder.diff(true, clockB), 'snapshot');
        let shells = 0;
        let drops = 0;
        let sets = 0;
        const STEPS = 900;
        for (let step = 1; step <= STEPS; step++) {
            runSimFrame(g, nextFrameMs(schedulerState(g), 4));
            // A full compare now and then (a save, a reload), else the per-step diff.
            const full = step % 300 === 0;
            if (full) {
                fresh.refreshSideTables();
                legacy.refreshSideTables();
            }
            const a = fresh.encoder.diff(full, clockA);
            const b = legacy.encoder.diff(full, clockB);
            same(a, b, `step ${step}`);
            shells += a.hot.shells.length + a.cold.shells.length;
            drops += a.cold.drops.length;
            sets += a.stats.sets;
        }
        // The run did create and drop objects, and change fields.
        expect(shells).toBeGreaterThan(1000);
        expect(drops).toBeGreaterThan(100);
        expect(sets).toBeGreaterThan(10000);
        expect(fresh.encoder.size).toBe(legacy.encoder.size);
        // A stop-the-world mark finds the same garbage in both, and the next deltas still agree.
        expect(fresh.encoder.mark()).toBe(legacy.encoder.mark());
        same(fresh.encoder.diff(true, clockA), legacy.encoder.diff(true, clockB), 'after mark');
    }, 600000);
});
