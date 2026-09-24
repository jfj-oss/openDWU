// Unit tests for the pure helpers in src/audio/musicPlayer.ts (no audio).

import { describe, expect, it } from 'vitest';
import { MusicMood, fadeStep, pickTrackForMood } from '../src/audio/musicPlayer';

/** Deterministic PRNG so selection tests are reproducible. */
function makeRand(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        // mulberry32
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('pickTrackForMood', () => {
    it('returns null for moods with no tracks', () => {
        expect(pickTrackForMood(MusicMood.Undefined, null, makeRand(1))).toBeNull();
    });

    it('always returns a track from the mood pool', () => {
        const pools: Record<number, string[]> = {
            [MusicMood.Quiet]: ['Shadows.mp3', 'Suspense.mp3', 'Utopia.mp3'],
            [MusicMood.Moderate]: ['OnTrack.mp3', 'Striving.mp3', 'Outlaw.mp3', 'BoldStroke.mp3'],
            [MusicMood.Theme]: ['DistantWorldsTheme.mp3'],
        };
        for (const mood of [MusicMood.Quiet, MusicMood.Moderate, MusicMood.Intense, MusicMood.Theme]) {
            const rand = makeRand(42);
            for (let i = 0; i < 200; i++) {
                const pick = pickTrackForMood(mood as MusicMood, null, rand);
                expect(pick).not.toBeNull();
                if (mood === MusicMood.Intense) {
                    expect(['Action1.mp3', 'Action2.mp3', 'Desperate.mp3', 'Forceful.mp3', 'Frustrated.mp3', 'Gripping.mp3', 'Intensity.mp3', 'Pursuit.mp3', 'Shock.mp3', 'Strike.mp3']).toContain(pick);
                } else {
                    expect(pools[mood]).toContain(pick);
                }
            }
        }
    });

    it('never repeats the current track when the pool has more than one', () => {
        const rand = makeRand(7);
        for (let i = 0; i < 200; i++) {
            const pick = pickTrackForMood(MusicMood.Quiet, 'Shadows.mp3', rand);
            expect(pick).not.toBe('Shadows.mp3');
        }
    });

    it('may repeat the current track when the pool has exactly one', () => {
        const pick = pickTrackForMood(MusicMood.Theme, 'DistantWorldsTheme.mp3', makeRand(1));
        expect(pick).toBe('DistantWorldsTheme.mp3');
    });

    it('is deterministic for a given rand sequence', () => {
        const a = pickTrackForMood(MusicMood.Intense, null, makeRand(99));
        const b = pickTrackForMood(MusicMood.Intense, null, makeRand(99));
        expect(a).toBe(b);
    });
});

describe('fadeStep', () => {
    it('advances toward the target by max(0.005, sqrt(level + 0.1) * 0.02)', () => {
        // level 0.5, fading up to 1.0: step = sqrt(0.6) * 0.02 ≈ 0.01549
        const [next, reached] = fadeStep(0.5, 1.0, 1);
        expect(next).toBeCloseTo(0.5 + Math.sqrt(0.6) * 0.02, 10);
        expect(reached).toBe(false);
    });

    it('clamps at the target when fading up and reports completion', () => {
        const [next, reached] = fadeStep(0.99, 1.0, 1);
        expect(next).toBe(1.0);
        expect(reached).toBe(true);
    });

    it('does not clamp while still above the target (fading down)', () => {
        // step = sqrt(0.6) * 0.02 ≈ 0.01549 < 0.5, so no completion yet
        const [next, reached] = fadeStep(0.5, 0.0, -1);
        expect(next).toBeCloseTo(0.5 - Math.sqrt(0.6) * 0.02, 10);
        expect(reached).toBe(false);
    });

    it('reports completion once the level reaches or passes the target', () => {
        // Fading down from just above the target: the min step (0.005) is
        // larger than the remaining distance, so the level overshoots past
        // the target and the C# clamps num to the target on that tick.
        const [next, reached] = fadeStep(0.001, 0.0, -1);
        expect(next).toBe(0.0);
        expect(reached).toBe(true);
    });

    it('a full fade-out from 1.0 reaches 0.0 in a bounded number of ticks', () => {
        let level = 1.0;
        let ticks = 0;
        while (level > 0 && ticks < 1000) {
            [level] = fadeStep(level, 0.0, -1);
            ticks++;
        }
        expect(level).toBe(0.0);
        // The curve is fast near full volume and slow near silence, so allow
        // generous headroom but bound it.
        expect(ticks).toBeLessThan(1000);
    });
});