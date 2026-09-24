import { describe, expect, it } from 'vitest';
import {
    EffectsPlayer,
    MAX_PENDING_SOUND_REQUESTS,
    SoundEffectQueue,
    UiClickSounds,
    resolveBalanceAndDistance,
    type AudioBackend,
    type PlayingSound,
} from '../src/audio/effectsPlayer';

// Task C4 — EffectsPlayer.cs / SoundEffectRequest.cs / Main.Part13.cs queue.
class FakeBackend implements AudioBackend {
    loads: string[] = [];
    plays: { url: string; pan: number; gain: number; rate: number; h: PlayingSound & { ended: boolean; stopped: boolean } }[] = [];
    missing = new Set<string>();
    async load(url: string): Promise<AudioBuffer | null> {
        this.loads.push(url);
        return this.missing.has(url) ? null : ({ url } as unknown as AudioBuffer);
    }
    play(buffer: AudioBuffer, pan: number, gain: number, rate: number): PlayingSound {
        const h = { ended: false, stopped: false, stop() { this.stopped = true; this.ended = true; } };
        this.plays.push({ url: (buffer as unknown as { url: string }).url, pan, gain, rate, h });
        return h;
    }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('resolveBalanceAndDistance (MainView.1.cs method_90)', () => {
    it('centre is full volume, balance 0', () => {
        const r = resolveBalanceAndDistance(800, 450, 1600, 900, 1);
        expect(r.balance).toBe(0);
        expect(r.distance).toBe(1);
    });
    it('balance spans -1..1 across the view; distance falls off with offset and zoom', () => {
        expect(resolveBalanceAndDistance(0, 450, 1600, 900, 1).balance).toBe(-1);
        expect(resolveBalanceAndDistance(1600, 450, 1600, 900, 1).balance).toBe(1);
        const edge = resolveBalanceAndDistance(1600, 450, 1600, 900, 1).distance;
        expect(edge).toBeLessThan(1);
        expect(edge).toBeGreaterThan(0.02);
        expect(resolveBalanceAndDistance(800, 450, 1600, 900, 4).distance).toBeCloseTo(0.5);
        expect(resolveBalanceAndDistance(800, 450, 1600, 900, 51).distance).toBe(0);
        expect(resolveBalanceAndDistance(100000, 450, 1600, 900, 1).distance).toBe(0.02);
    });
});

describe('EffectsPlayer resolvers', () => {
    const p = new EffectsPlayer(new FakeBackend(), '/x/', 1);
    it('uses the C# gain constants against volume 0.7', () => {
        expect(p.resolveIonStrike(0.2, 0.5)).toEqual({ filename: 'ion_strike.wav', balance: 0.2, volume: 0.7 * 1.8 * 0.5, frequency: 0 });
        expect(p.resolveWeapon('Laser.wav', 0, 2).volume).toBeCloseTo(0.7 * 0.23); // distance clamped to 1
        expect(p.resolveAttackClick().volume).toBeCloseTo(0.7);
        expect(p.resolveHyperjumpEntry(0, 1).volume).toBeCloseTo(0.7 * 0.45);
        expect(p.resolveHyperjumpExit(0, 1).volume).toBeCloseTo(0.7 * 0.5);
        expect(p.resolvePlanetExplosion(1, 0, 1).volume).toBeCloseTo(0.7 * 2.1);
    });
    it('fighter weapons by component type', () => {
        expect(p.resolveFighterWeapon('a.wav', 1, 0, 1).volume).toBeCloseTo(0.7 * 0.19);
        expect(p.resolveFighterWeapon('a.wav', 2, 0, 1).volume).toBeCloseTo(0.7 * 0.25);
        expect(p.resolveFighterWeapon('a.wav', 3, 0, 1).filename).toBe('');
    });
    it('explosions: small < 100, large capped at 1.0', () => {
        const small = p.resolveExplosion(50, 0, 1);
        expect(small.filename).toMatch(/^explosion_small\d?\.wav$/);
        expect(small.volume).toBeCloseTo(0.7 * 0.75);
        const big = p.resolveExplosion(200, 0, 1);
        expect(big.filename).toMatch(/^explosion\d?\.wav$/);
        expect(big.volume).toBeCloseTo(0.7); // 2.5 -> Min(1.0)
    });
    it('stars: known types only', () => {
        expect(p.resolveStar(1, 0, 1)!.filename).toMatch(/^star_basic[12]\.wav$/);
        expect(p.resolveStar(5, 0, 1)!.volume).toBeCloseTo(0.7 * 1.2 * 1.2);
        expect(p.resolveStar(7, 0, 1)).toBeNull();
    });
    it('messages map to the four message sounds', () => {
        expect(p.resolveMessage(1).filename).toBe('message_standard.wav');
        expect(p.resolveMessage(14).filename).toBe('message_minor.wav');
        const alarm = p.resolveMessage(20);
        expect(alarm.filename).toBe('message_alarm.wav');
        expect(alarm.volume).toBeCloseTo(0.7 * 0.4);
        expect(p.resolveMessage(24).filename).toBe('message_major.wav');
        expect(p.resolveMessage(0).filename).toBe('');
    });
    it('ambient schemes give the C# next-effect offsets', () => {
        const offsets = new Set([4000, 5500, 10800, 6600, 9200, 8200, 8400, 11400, 6500, 8500]);
        for (let s = 0; s < 4; s++) {
            const r = p.resolveAmbientEffect(s, 0, 1);
            expect(r.request.filename).toMatch(/^ambient\d_/);
            expect(offsets.has(r.nextEffectOffset)).toBe(true);
            expect(r.request.volume).toBeCloseTo(0.7 * 0.7);
        }
    });
});

describe('playback and the request queue', () => {
    it('PlayEffect clamps pan, loads once, skips missing files', async () => {
        const b = new FakeBackend();
        b.missing.add('/x/nope.wav');
        const p = new EffectsPlayer(b, '/x/', 1);
        await p.playEffect('Laser.wav', 3, 0.5);
        await p.playEffect('laser.wav', -3, 0.5);
        await p.playEffect('nope.wav', 0, 1);
        expect(b.loads).toEqual(['/x/Laser.wav', '/x/nope.wav']);
        expect(b.plays.map((x) => x.pan)).toEqual([1, -1]);
        expect(p.activeCount).toBe(2);
        b.plays[0].h.ended = true;
        p.clearFinishedBuffers();
        expect(p.activeCount).toBe(1);
    });
    it('queue keeps at most 10 per flush and drops the rest', async () => {
        const b = new FakeBackend();
        const p = new EffectsPlayer(b, '/x/', 1);
        const q = new SoundEffectQueue(p);
        let accepted = 0;
        for (let i = 0; i < 15; i++) if (q.enqueue(p.resolveAttackClick())) accepted++;
        expect(MAX_PENDING_SOUND_REQUESTS).toBe(10);
        expect(accepted).toBe(10);
        q.flush();
        expect(q.pendingCount).toBe(0);
        await flush();
        expect(b.plays.length).toBe(10);
        expect(q.enqueue(p.resolveAttackClick())).toBe(true);
    });
});

describe('UI click sounds (GlassButton / HoverMenuItem)', () => {
    it('plays button1 / button2 / grid and restarts per class', async () => {
        const b = new FakeBackend();
        const ui = new UiClickSounds(b, '/x/');
        await ui.play('glass');
        await ui.play('glass');
        await ui.play('menuItem');
        await ui.play('list');
        expect(b.plays.map((x) => x.url)).toEqual(['/x/button1.wav', '/x/button1.wav', '/x/button2.wav', '/x/grid.wav']);
        expect(b.plays[0].h.stopped).toBe(true); // restarted, like SoundPlayer.Play()
        expect(b.plays[2].h.stopped).toBe(false);
        ui.volume = 0;
        await ui.play('glass');
        expect(b.plays.length).toBe(4);
    });
});
