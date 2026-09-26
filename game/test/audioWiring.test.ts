// Audio trigger wiring (game/tasks/AUDIO-WIRING-2026-09-26.md): the Main View sound pass
// (MainView.1.cs / MainView.2.cs draw-site requests), the ambient music rule (MainView.1.cs:2812),
// the event / diplomacy / investigate stings (Main.Part4.cs / Main.Part7.cs), the message sounds
// (Main.Part9.cs:2352) and the UI click classes (Main.Part13.cs:905-944).
import { beforeAll, describe, expect, it } from 'vitest';
import { EffectsPlayer, type AudioBackend, type PlayingSound, type SoundEffectRequest } from '../src/audio/effectsPlayer';
import { ambientMusicAction, MainViewSounds, type MusicState, type SoundView } from '../src/audio/mainViewSounds';
import { diplomacyMoodFile, eventStingFile, investigateSting, messageSoundRequests, STING_DISCOVERY } from '../src/audio/gameAudio';
import { classifyUiClick, type ClosestLike } from '../src/audio/uiClicks';
import { EventMessageType } from '../src/sim/eventTypes';
import { Creature, CreatureType } from '../src/sim/creature';
import { ShipAction, ShipActionType } from '../src/sim/player/shipAction';
import { Explosion } from '../src/sim/combat/damage';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import type { MessageRoute } from '../src/ui/messageRouting';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
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

const player = () => new EffectsPlayer(new SilentBackend(), '/x/', 1);

describe('eventStingFile (Main.Part4.cs:487 method_523)', () => {
    it('maps each sting family', () => {
        expect(eventStingFile(EventMessageType.WonderBuilt, null, false, false)).toBe('wonder.mp3');
        expect(eventStingFile(EventMessageType.LostColonyFound, null, false, false)).toBe('happyEvent.mp3');
        expect(eventStingFile(EventMessageType.IndependentPopulation, null, false, false)).toBe('happyEvent.mp3');
        expect(eventStingFile(EventMessageType.RaceEvent, null, false, false)).toBe('raceEvent.mp3');
        expect(eventStingFile(EventMessageType.CharacterEvent, null, false, false)).toBe('characterEvent.mp3');
        expect(eventStingFile(EventMessageType.LeaderChange, null, false, false)).toBe('characterEvent.mp3');
        expect(eventStingFile(EventMessageType.DisasterEvent, null, false, false)).toBe('disaster.mp3');
        expect(eventStingFile(EventMessageType.EmpireSplits, null, false, false)).toBe('disaster.mp3');
        expect(eventStingFile(EventMessageType.PhantomPirates, null, false, false)).toBe('dread.mp3');
        expect(eventStingFile(EventMessageType.StoryClue, null, false, false)).toBe(STING_DISCOVERY);
        expect(eventStingFile(EventMessageType.RogueFleetDefectsToUs, null, false, false)).toBe(STING_DISCOVERY);
        expect(eventStingFile(EventMessageType.ResourceDepletion, null, false, false)).toBeNull();
    });
    it('creature outbreak plays dread only for the Silver Mist', () => {
        const c = Object.create(Creature.prototype) as Creature;
        (c as { type: CreatureType }).type = CreatureType.SilverMist;
        expect(eventStingFile(EventMessageType.CreatureOutbreak, c, false, false)).toBe('dread.mp3');
        (c as { type: CreatureType }).type = CreatureType.Kaltor;
        expect(eventStingFile(EventMessageType.CreatureOutbreak, c, false, false)).toBeNull();
    });
    it('SuppressAllPopups silences every sting; a playing sting blocks the flag7 group only', () => {
        expect(eventStingFile(EventMessageType.WonderBuilt, null, true, false)).toBeNull();
        expect(eventStingFile(EventMessageType.RogueFleetDefectsToUs, null, true, false)).toBeNull();
        expect(eventStingFile(EventMessageType.WonderBuilt, null, false, true)).toBeNull();
        expect(eventStingFile(EventMessageType.RogueFleetDefectsToUs, null, false, true)).toBe(STING_DISCOVERY);
    });
});

describe('diplomacyMoodFile (Main.Part4.cs:369 method_521)', () => {
    it('pirate > reclusive > attitude bands', () => {
        expect(diplomacyMoodFile(true, true, 50)).toBe('diplomacyMoodMenacing.mp3');
        expect(diplomacyMoodFile(false, true, 50)).toBe('diplomacyMoodNeutral.mp3');
        expect(diplomacyMoodFile(false, false, -10.5)).toBe('diplomacyMoodAngry.mp3');
        expect(diplomacyMoodFile(false, false, -10)).toBe('diplomacyMoodNeutral.mp3');
        expect(diplomacyMoodFile(false, false, 9.9)).toBe('diplomacyMoodNeutral.mp3');
        expect(diplomacyMoodFile(false, false, 10)).toBe('diplomacyMoodHappy.mp3');
    });
});

describe('messageSoundRequests (Main.Part9.cs:2352-2360)', () => {
    const route = (o: Partial<MessageRoute>): MessageRoute => ({ category: null, popup: false, ticker: false, conversation: null, immediate: false, ...o });
    it('popup or ticker → ResolveMessage, conversation → also ResolveImportantMessage', () => {
        const p = player();
        expect(messageSoundRequests(p, 22, route({ popup: true }), false).map((r) => r.filename)).toEqual(['message_alarm.wav']);
        expect(messageSoundRequests(p, 14, route({ ticker: true }), false).map((r) => r.filename)).toEqual(['message_minor.wav']);
        expect(messageSoundRequests(p, 14, route({}), false)).toEqual([]);
        expect(messageSoundRequests(p, 1, route({ ticker: true, conversation: 5 as never }), false).map((r) => r.filename)).toEqual(['message_standard.wav', 'message_major.wav']);
    });
    it('SuppressAllPopups drops the message sound but not the conversation one', () => {
        const p = player();
        expect(messageSoundRequests(p, 1, route({ ticker: true, conversation: 5 as never }), true).map((r) => r.filename)).toEqual(['message_major.wav']);
    });
});

describe('ambientMusicAction (MainView.1.cs:2812-2819)', () => {
    const m = (o: Partial<MusicState>): MusicState => ({ isPlaying: true, isInitiatingFade: false, fadeTimerRunning: false, actualVolume: 0.3, ...o });
    it('fades the music out in an ambient area below zoom 100', () => {
        expect(ambientMusicAction(true, 50, true, m({}), false)).toBe('fadePause');
        expect(ambientMusicAction(true, 150, true, m({}), false)).toBeNull();
        expect(ambientMusicAction(true, 50, true, m({ isInitiatingFade: true }), false)).toBeNull();
    });
    it('fades back in when silent, running and no sting', () => {
        expect(ambientMusicAction(false, 50, true, m({ actualVolume: 0 }), false)).toBe('fadeResume');
        expect(ambientMusicAction(false, 50, false, m({ actualVolume: 0 }), false)).toBeNull();
        expect(ambientMusicAction(false, 50, true, m({ actualVolume: 0 }), true)).toBeNull();
        expect(ambientMusicAction(false, 50, true, m({ actualVolume: 0.3 }), false)).toBeNull();
        expect(ambientMusicAction(false, 50, true, m({ isPlaying: false, fadeTimerRunning: true }), false)).toBeNull();
    });
});

describe('classifyUiClick (Main.Part13.cs:905-944 control sounds)', () => {
    const el = (matches: string[]): ClosestLike => ({ closest: (sel: string) => (sel.split(',').some((s) => matches.includes(s.trim())) ? {} : null) });
    it('menu items, start-screen items, buttons and list rows', () => {
        expect(classifyUiClick(el(['.order-menu-item', 'button:not(:disabled)']))).toBe('menuItem');
        expect(classifyUiClick(el(['.main-menu-item']))).toBe('hover');
        expect(classifyUiClick(el(['button:not(:disabled)']))).toBe('glass');
        expect(classifyUiClick(el(['tbody tr']))).toBe('list');
        expect(classifyUiClick(el([]))).toBeNull();
        expect(classifyUiClick(el(['#hud', 'button:not(:disabled)']))).toBeNull();
        expect(classifyUiClick(null)).toBeNull();
    });
});

describe('Main View sound pass on the harness game (MainView.1.cs / MainView.2.cs)', () => {
    let gameData: GameData;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    }, 300000);

    function armedShip(galaxy: { builtObjects: (BuiltObject | null)[] }): BuiltObject {
        const bo = galaxy.builtObjects.find((b) => b !== null && !b.hasBeenDestroyed && b.weapons.length > 0);
        if (!bo) throw new Error('no armed ship in the harness game');
        return bo;
    }

    it('weapons, explosions and hyperjumps request once, with no galaxy random draws', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const bo = armedShip(galaxy);
        const view: SoundView = { x: bo.xpos, y: bo.ypos, zoom: 1, width: 1600, height: 900 };
        const sounds = new MainViewSounds(player(), 1);
        const before = JSON.stringify(galaxy.rnd);
        const w = bo.weapons[0];
        w.distanceTravelled = 1;
        w.soundEffectPlayed = false;
        const e = new Explosion();
        e.explosionSize = 120;
        (bo.explosions as Explosion[]).push(e);
        bo.hyperjumpAboutToEnter = true;
        bo.hyperjumpAboutToEnterSoundPlayed = false;
        bo.hyperjumpJustExited = true;
        const r1 = sounds.collect(galaxy, view, null, galaxy.nowMs, galaxy.nowMs + 1e6);
        const files = r1.requests.map((r: SoundEffectRequest) => r.filename.toLowerCase());
        expect(files).toContain(w.component.def.soundEffectFilename.toLowerCase());
        expect(files.some((f) => f.startsWith('explosion'))).toBe(true);
        expect(files).toContain('hyperjump_enter.wav');
        expect(files).toContain('hyperjump_exit.wav');
        expect(w.soundEffectPlayed).toBe(true);
        expect(e.explosionSoundPlayed).toBe(true);
        // Centre of the view at zoom factor 1: full distance, no balance.
        const weaponReq = r1.requests.find((r) => r.filename.toLowerCase() === w.component.def.soundEffectFilename.toLowerCase())!;
        expect(weaponReq.balance).toBeCloseTo(0, 5);
        expect(weaponReq.volume).toBeCloseTo(0.7 * 0.23, 5);
        // Second frame: played flags hold; JustExited has no flag (the sim clears it next tick).
        bo.hyperjumpJustExited = false;
        const r2 = sounds.collect(galaxy, view, null, galaxy.nowMs, galaxy.nowMs + 1e6);
        const files2 = r2.requests.map((r) => r.filename.toLowerCase());
        expect(files2).not.toContain(w.component.def.soundEffectFilename.toLowerCase());
        expect(files2).not.toContain('hyperjump_enter.wav');
        expect(JSON.stringify(galaxy.rnd)).toBe(before);
    });

    it('zoomed out past factor 500 nothing is heard; past 50 the distance is 0', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const bo = armedShip(galaxy);
        const w = bo.weapons[0];
        w.distanceTravelled = 1;
        w.soundEffectPlayed = false;
        const far = new MainViewSounds(player(), 1).collect(galaxy, { x: bo.xpos, y: bo.ypos, zoom: 1 / 600, width: 1600, height: 900 }, null, galaxy.nowMs, galaxy.nowMs);
        expect(far.requests.some((r) => r.filename === w.component.def.soundEffectFilename)).toBe(false);
        expect(w.soundEffectPlayed).toBe(false);
        const mid = new MainViewSounds(player(), 1).collect(galaxy, { x: bo.xpos, y: bo.ypos, zoom: 1 / 60, width: 1600, height: 900 }, null, galaxy.nowMs, galaxy.nowMs);
        const req = mid.requests.find((r) => r.filename === w.component.def.soundEffectFilename);
        expect(req?.volume).toBe(0);
    });

    it('stars sound every 4200 ms of star date', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const star = galaxy.systems.map((x) => x.systemStar).find((h) => h.category === HabitatCategoryType.Star && h.type === HabitatType.MainSequence)!;
        const view: SoundView = { x: star.xpos, y: star.ypos, zoom: 1 / 5, width: 1600, height: 900 };
        const sounds = new MainViewSounds(player(), 1);
        const t = 1_000_000;
        const starFiles = (r: { requests: SoundEffectRequest[] }) => r.requests.filter((q) => q.filename.startsWith('star_')).length;
        expect(starFiles(sounds.collect(galaxy, view, null, 0, t))).toBe(1);
        expect(starFiles(sounds.collect(galaxy, view, null, 0, t + 4200))).toBe(0);
        expect(starFiles(sounds.collect(galaxy, view, null, 0, t + 4201))).toBe(1);
    });

    it('investigate orders play discovery (Main.Part7.cs:504 / 515)', () => {
        const galaxy = cachedTickGame(gameData).galaxy;
        const empire = galaxy.playerEmpire!;
        const ship = empire.builtObjects.find((b) => b.role !== BuiltObjectRole.Base) as BuiltObject;
        const abandoned = galaxy.builtObjects.find((b) => b !== null && b.empire === null) ?? null;
        if (abandoned !== null) {
            const a = ShipAction.forAction(ShipActionType.InvestigateBuiltObject, abandoned);
            expect(investigateSting(galaxy, empire, ship, a)).toEqual({ file: STING_DISCOVERY, maximum: true });
            expect(investigateSting(galaxy, empire, null, a)).toBeNull();
        }
        const b = ShipAction.forAction(ShipActionType.Undefined, null);
        expect(investigateSting(galaxy, empire, ship, b)).toBeNull();
    });
});
