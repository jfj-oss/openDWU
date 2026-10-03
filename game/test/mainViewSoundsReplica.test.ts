// Main View sounds on a sim-worker replica (docs/sim-worker.md §9 chunk 2, audit §4 item 1): the sound pass must not
// write the sim's *SoundPlayed flags on a replica — the worker never sees the write, its own flag stays false, so the
// sim's re-arm (false again on the next shot) changes nothing there and the replica would keep the stale `true`: every
// later shot of that weapon would be silent. ReplicaSoundMarks keeps the played state render-side, keyed by what the
// sim changes when it re-arms a flag. In-thread (simFlagSoundMarks) nothing changes.
import { beforeAll, describe, expect, it } from 'vitest';
import { EffectsPlayer, type AudioBackend, type PlayingSound } from '../src/audio/effectsPlayer';
import { MainViewSounds, ReplicaSoundMarks, simFlagSoundMarks, type SoundView } from '../src/audio/mainViewSounds';
import { soundMarksFor } from '../src/audio/gameAudio';
import { Explosion } from '../src/sim/combat/damage';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Galaxy } from '../src/sim/galaxy';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker } from '../src/simworker/protocol';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

class SilentBackend implements AudioBackend {
    async load(): Promise<AudioBuffer | null> {
        return null;
    }
    play(): PlayingSound {
        return { ended: true, stop() {} };
    }
}
const player = (): EffectsPlayer => new EffectsPlayer(new SilentBackend(), '/x/', 1);

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 300000);

function armedShip(galaxy: Galaxy): BuiltObject {
    const bo = galaxy.builtObjects.find((b) => b !== null && !b.hasBeenDestroyed && b.weapons.length > 0);
    if (!bo) throw new Error('no armed ship in the harness game');
    return bo;
}

function viewAt(bo: BuiltObject): SoundView {
    return { x: bo.xpos, y: bo.ypos, zoom: 1, width: 1600, height: 900 };
}

function fakeClock(): () => number {
    let t = 0;
    return () => (t += 0.001);
}

describe('Main View sounds: played-marks', () => {
    it('ReplicaSoundMarks: a mark holds until the sim re-arms (new LastFired / countdown / ion stamp / explosion)', () => {
        const m = new ReplicaSoundMarks();
        const shot = { soundEffectPlayed: false, lastFired: 1000 };
        expect(m.shotPlayed(shot)).toBe(false);
        m.markShot(shot);
        expect(m.shotPlayed(shot)).toBe(true);
        expect(shot.soundEffectPlayed).toBe(false);
        shot.lastFired = 2000;
        expect(m.shotPlayed(shot)).toBe(false);
        const e = new Explosion();
        expect(m.explosionPlayed(e)).toBe(false);
        m.markExplosion(e);
        expect(m.explosionPlayed(e)).toBe(true);
        expect(e.explosionSoundPlayed).toBe(false);
        expect(m.explosionPlayed(new Explosion())).toBe(false);
        const bo = { lastIonStrike: 5, hyperjumpCountdown: 7, ionStrikeSoundPlayed: false, hyperjumpAboutToEnterSoundPlayed: false } as unknown as BuiltObject;
        m.markIonStrike(bo);
        m.markHyperEntry(bo);
        expect(m.ionStrikePlayed(bo)).toBe(true);
        expect(m.hyperEntryPlayed(bo)).toBe(true);
        (bo as { lastIonStrike: number }).lastIonStrike = 6;
        (bo as { hyperjumpCountdown: number }).hyperjumpCountdown = 8;
        expect(m.ionStrikePlayed(bo)).toBe(false);
        expect(m.hyperEntryPlayed(bo)).toBe(false);
        expect(bo.ionStrikeSoundPlayed).toBe(false);
        expect(bo.hyperjumpAboutToEnterSoundPlayed).toBe(false);
    });

    it('on a replica every shot, explosion, jump and ion strike is heard once, and no sim flag is written', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const bo = armedShip(galaxy);
        const view = viewAt(bo);
        const sounds = new MainViewSounds(player(), 1, new ReplicaSoundMarks());
        const w = bo.weapons[0];
        const file = w.component.def.soundEffectFilename.toLowerCase();
        const heard = (): string[] => sounds.collect(galaxy, view, null, galaxy.nowMs, galaxy.nowMs + 1e6).requests.map((r) => r.filename.toLowerCase());
        // A shot in flight: heard once.
        w.distanceTravelled = 1;
        w.lastFired = galaxy.nowMs;
        expect(heard()).toContain(file);
        expect(heard()).not.toContain(file);
        // What the worker's sync shows the replica after the sim fires the weapon again: a new LastFired, the flag false
        // as it always was there (never true: the worker's audio-less game never sets it).
        w.lastFired = galaxy.nowMs + 1;
        expect(w.soundEffectPlayed).toBe(false);
        expect(heard()).toContain(file);
        // Explosions: each new one once.
        (bo.explosions as Explosion[]).push(Object.assign(new Explosion(), { explosionSize: 120 }));
        expect(heard().some((f) => f.startsWith('explosion'))).toBe(true);
        expect(heard().some((f) => f.startsWith('explosion'))).toBe(false);
        (bo.explosions as Explosion[]).push(Object.assign(new Explosion(), { explosionSize: 80 }));
        expect(heard().some((f) => f.startsWith('explosion'))).toBe(true);
        // Hyperjump entry: once per jump (cmdHyperTo gives each jump a new countdown).
        bo.hyperjumpAboutToEnter = true;
        bo.hyperjumpCountdown = 1234;
        expect(heard()).toContain('hyperjump_enter.wav');
        expect(heard()).not.toContain('hyperjump_enter.wav');
        bo.hyperjumpCountdown = 5678;
        expect(heard()).toContain('hyperjump_enter.wav');
        bo.hyperjumpAboutToEnter = false;
        // Ion strike: once per strike stamp (within 1400 ms of it).
        bo.lastIonStrike = galaxy.nowMs - 10;
        expect(heard()).toContain('ion_strike.wav');
        expect(heard()).not.toContain('ion_strike.wav');
        bo.lastIonStrike = galaxy.nowMs - 5;
        expect(heard()).toContain('ion_strike.wav');
        // Nothing was written to the sim's flags.
        expect(w.soundEffectPlayed).toBe(false);
        for (const e of bo.explosions as Explosion[]) expect(e.explosionSoundPlayed).toBe(false);
        expect(bo.hyperjumpAboutToEnterSoundPlayed).toBe(false);
        expect(bo.ionStrikeSoundPlayed).toBe(false);
    });

    it('with the sim’s flags on a replica (the old behaviour), the second shot of a weapon would be silent', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const bo = armedShip(galaxy);
        const view = viewAt(bo);
        const sounds = new MainViewSounds(player(), 1, simFlagSoundMarks);
        const w = bo.weapons[0];
        const file = w.component.def.soundEffectFilename.toLowerCase();
        const heard = (): string[] => sounds.collect(galaxy, view, null, galaxy.nowMs, galaxy.nowMs + 1e6).requests.map((r) => r.filename.toLowerCase());
        w.distanceTravelled = 1;
        w.soundEffectPlayed = false;
        expect(heard()).toContain(file);
        expect(w.soundEffectPlayed).toBe(true);
        // In-thread the sim's weaponFire clears the flag; on a replica nothing would (the worker's flag never changed).
        w.lastFired = galaxy.nowMs + 1;
        expect(heard()).not.toContain(file);
    });

    it('soundMarksFor: the sim flags in-thread, render-side marks on a sim-worker replica', () => {
        const game = cachedTickGame(gameData);
        expect(soundMarksFor(game.galaxy)).toBe(simFlagSoundMarks);
        const time = new GalaxyTime();
        const host = new SimHost(game, time, {} as StartGameOptions, { now: fakeClock() });
        const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: () => undefined, now: fakeClock() });
        try {
            expect(soundMarksFor(client.galaxy)).toBeInstanceOf(ReplicaSoundMarks);
            expect(soundMarksFor(client.galaxy, false)).toBe(simFlagSoundMarks);
        } finally {
            client.dispose();
            host.dispose();
        }
    });

    it('the sound pass run on a synced replica every frame leaves it identical to the worker’s game', () => {
        const game = cachedTickGame(gameData);
        const time = new GalaxyTime();
        time.paused = false;
        const host = new SimHost(game, time, {} as StartGameOptions, { now: fakeClock() });
        const toHost = (m: ToWorker): void => {
            const c = structuredClone(m);
            if (c.type === 'command') host.command(c);
            else if (c.type === 'clock') host.clock(c);
        };
        const client = new SimClientCore(gameData, structuredClone(host.snapshot()), { post: toHost, now: fakeClock() });
        try {
            const rg = client.galaxy;
            const uiTime = new GalaxyTime();
            uiTime.bindGalaxy(rg);
            uiTime.paused = false;
            const sounds = new MainViewSounds(player(), 1, soundMarksFor(rg));
            const capital = client.game.playerEmpire.capital!;
            let requests = 0;
            for (let i = 0; i < 240; i++) {
                const m = host.tick(FRAME_REAL_MS);
                if (m !== null) client.receive(structuredClone(m));
                client.frame(uiTime);
                // Sweep the view over the player's ships so shots / jumps / mining near them are collected.
                const ships = rg.builtObjects.filter((b): b is BuiltObject => b !== null && !b.hasBeenDestroyed && b.empire === client.game.playerEmpire);
                const at: { xpos: number; ypos: number } = ships.length > 0 ? ships[i % ships.length] : capital;
                requests += sounds.collect(rg, { x: at.xpos, y: at.ypos, zoom: 0.5, width: 1600, height: 900 }, client.game.playerEmpire, rg.nowMs, uiTime.currentStarDate).requests.length;
            }
            expect(requests).toBeGreaterThan(0);
            client.replica.apply(structuredClone(host.sync.delta(true)), true);
            expect(JSON.stringify(galaxyToJSON(rg))).toBe(JSON.stringify(galaxyToJSON(game.galaxy)));
        } finally {
            client.dispose();
            host.dispose();
        }
    }, 300000);
});
