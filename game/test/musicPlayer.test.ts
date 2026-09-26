// Unit tests for the pure helpers in src/audio/musicPlayer.ts (no audio).

import { describe, expect, it } from 'vitest';
import { MUSIC_FILES, MusicPlayer, THEME_MUSIC_FILE, fadeStep, pickNextTrack, type MediaBackend, type TimerSeam } from '../src/audio/musicPlayer';

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

describe('pickNextTrack (MusicPlayer.cs:347 EbsZqjqvhZ)', () => {
    it('draws from every mp3 in the folder (no mood pools)', () => {
        const rand = makeRand(42);
        const seen = new Set<string>();
        for (let i = 0; i < 2000; i++) seen.add(pickNextTrack(MUSIC_FILES, null, rand)!);
        expect([...seen].sort()).toEqual([...MUSIC_FILES].sort());
    });
    it('never repeats the current track when the folder has more than one', () => {
        const rand = makeRand(7);
        for (let i = 0; i < 200; i++) expect(pickNextTrack(MUSIC_FILES, 'Shadows.mp3', rand)).not.toBe('Shadows.mp3');
    });
    it('a single-file folder repeats; an empty one has nothing', () => {
        expect(pickNextTrack(['A.mp3'], 'A.mp3', makeRand(1))).toBe('A.mp3');
        expect(pickNextTrack([], null, makeRand(1))).toBeNull();
    });
});

class FakeMedia implements MediaBackend {
    url: string | null = null;
    playing = false;
    pos = 0;
    volume = 1;
    onEnded: (() => void) | null = null;
    played: string[] = [];
    play(url: string): void {
        this.url = url;
        this.playing = true;
        this.pos = 1;
        this.played.push(url);
    }
    pause(): void {
        this.playing = false;
    }
    resume(): void {
        if (this.url !== null) this.playing = true;
    }
    stop(): void {
        this.playing = false;
        this.pos = 0;
    }
    get position(): number {
        return this.pos;
    }
    end(): void {
        this.playing = false;
        this.pos = 0;
        this.onEnded?.();
    }
}

class ManualTimers implements TimerSeam {
    active = new Set<number>();
    private n = 0;
    setInterval(): unknown {
        this.active.add(++this.n);
        return this.n;
    }
    clearInterval(h: unknown): void {
        this.active.delete(h as number);
    }
}

function makePlayer(seed = 3) {
    const media = new FakeMedia();
    const timers = new ManualTimers();
    const p = new MusicPlayer({ media, timers, rand: makeRand(seed), folder: '/m/' });
    return { p, media, timers };
}

function runFade(p: MusicPlayer, max = 2000): number {
    let n = 0;
    while (p.fadeTimerRunning && n < max) {
        p.tick();
        n++;
    }
    return n;
}

describe('MusicPlayer (MusicPlayer.cs)', () => {
    it('StartTheme plays the theme; when it ends MediaEnded picks another random track', () => {
        const { p, media } = makePlayer();
        p.setVolume(0.5);
        p.startTheme();
        expect(media.url).toBe('/m/' + THEME_MUSIC_FILE);
        expect(media.volume).toBeCloseTo(0.3, 10); // Volume * 0.6
        media.end();
        expect(media.url).not.toBe('/m/' + THEME_MUSIC_FILE);
        expect(MUSIC_FILES.map((f) => '/m/' + f)).toContain(media.url);
    });
    it('ForceSwitch fades to silence, settles 20 ticks, then starts a different track at full volume', () => {
        const { p, media } = makePlayer();
        p.setVolume(1);
        p.startTheme();
        p.forceSwitch();
        expect(p.isInitiatingFade).toBe(false); // ForceSwitch leaves bool_0 alone
        const ticks = runFade(p);
        expect(ticks).toBeGreaterThan(21);
        expect(media.played.length).toBe(2);
        expect(media.url).not.toBe('/m/' + THEME_MUSIC_FILE);
        expect(media.volume).toBeCloseTo(0.6, 10);
    });
    it('FadePause pauses at silence, FadeResume fades back to the volume', () => {
        const { p, media } = makePlayer();
        p.setVolume(0.5);
        p.startTheme();
        p.fadePause();
        expect(p.isInitiatingFade).toBe(true);
        runFade(p);
        expect(media.playing).toBe(false);
        expect(media.volume).toBe(0);
        expect(p.isPlaying).toBe(true); // PlayPosition > 0 while paused
        p.fadeResume();
        expect(media.playing).toBe(true);
        expect(media.volume).toBe(0);
        runFade(p);
        expect(media.volume).toBeCloseTo(0.3, 10);
        expect(media.played.length).toBe(1);
    });
    it('Stop unsubscribes MediaEnded (FadeStop ends the music for good)', () => {
        const { p, media } = makePlayer();
        p.startTheme();
        p.fadeStop();
        runFade(p);
        expect(p.isPlaying).toBe(false);
        media.end();
        expect(media.played.length).toBe(1);
    });
    it('the Options mute is SetVolume(Mute) and unmute restores the slider', () => {
        const { p, media } = makePlayer();
        p.setUserVolume(0.8);
        p.startTheme();
        p.mute();
        expect(p.volume).toBe(0);
        expect(media.volume).toBe(0);
        p.setUserVolume(0.4);
        expect(media.volume).toBe(0);
        p.unmute();
        expect(p.volume).toBe(0.4);
        expect(media.volume).toBeCloseTo(0.24, 10);
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