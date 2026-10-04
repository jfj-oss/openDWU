// Main.Part11.cs method_119 / method_120 / method_121 (ui/raceLandscapePicture.ts): the race picture on its native
// planet's landscape in the panel frame — the diplomacy talk panel (Main.Part8.cs 499) and the start screens
// (Start.1.cs 4189, Start.cs 5152, Start.2.cs 3191 / 3201).
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import { PiratePlayStyle } from '../src/sim/pirates';
import { HabitatType } from '../src/sim/types';
import { PANEL_FRAME_URL, STORY_EVENT_URL, coverRect, raceNativeLandscapeRef, racePicturePlan } from '../src/ui/raceLandscapePicture';
import { landscapeImageUrl } from '../src/ui/landscapeImages';

const gameRoot = resolve(__dirname, '..');
const installLinked = existsSync(resolve(gameRoot, 'public', 'assets', 'dwu', 'images', 'units', 'races'));
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const race = (pictureIndex: number, nativeHabitatType: HabitatType) => ({ pictureIndex, nativeHabitatType });

describe('method_121: the native landscape, LandscapeImageOffset<Type> + PictureRef % LandscapeImageCount<Type>', () => {
    it('per native type', () => {
        expect(raceNativeLandscapeRef(race(7, HabitatType.Volcanic))).toBe(28 + (7 % 2));
        expect(raceNativeLandscapeRef(race(7, HabitatType.Desert))).toBe(25 + (7 % 3));
        expect(raceNativeLandscapeRef(race(7, HabitatType.MarshySwamp))).toBe(20 + (7 % 3));
        expect(raceNativeLandscapeRef(race(7, HabitatType.Continental))).toBe(4 + (7 % 4)); // the forest one is never used
        expect(raceNativeLandscapeRef(race(7, HabitatType.Ocean))).toBe(23 + (7 % 2));
        expect(raceNativeLandscapeRef(race(7, HabitatType.BarrenRock))).toBe(0 + (7 % 4));
        expect(raceNativeLandscapeRef(race(7, HabitatType.Ice))).toBe(17 + (7 % 3));
        expect(raceNativeLandscapeRef(race(7, HabitatType.GasGiant))).toBe(0); // not in the switch
        expect(raceNativeLandscapeRef(null)).toBe(0);
    });
    it('every race of races.txt gets a landscape of its own native type', () => {
        const folder: Partial<Record<HabitatType, string>> = {
            [HabitatType.Volcanic]: 'volcanic', [HabitatType.Desert]: 'sandydesert', [HabitatType.MarshySwamp]: 'marshyswamp', [HabitatType.Continental]: 'continental',
            [HabitatType.Ocean]: 'ocean', [HabitatType.BarrenRock]: 'barrenrock', [HabitatType.Ice]: 'iceglacial',
        };
        expect(gameData.races.length).toBeGreaterThan(20);
        for (const r of gameData.races) {
            const url = landscapeImageUrl(raceNativeLandscapeRef(r));
            expect(url, r.name).not.toBeNull();
            expect(url!, `${r.name} (${r.nativeHabitatType})`).toContain(`/landscapes/${folder[r.nativeHabitatType] ?? 'barrenrock'}/`);
            if (installLinked) expect(existsSync(resolve(gameRoot, 'public', url!.replace(/^\//, ''))), url!).toBe(true);
        }
    });
});

describe('method_120: cover-fit, centred, integer rectangle', () => {
    it('fills the box, overflowing the longer side', () => {
        // A 250 × 174 landscape into the talk panel's 266 × 266 inner box: scale 266 / 174.
        expect(coverRect(250, 174, 266, 266)).toEqual({ x: -58, y: 0, w: 382, h: 266 });
        expect(coverRect(200, 200, 266, 266)).toEqual({ x: 0, y: 0, w: 266, h: 266 });
        expect(coverRect(100, 300, 288, 288)).toEqual({ x: 0, y: -288, w: 288, h: 864 });
    });
});

describe('method_119: the layers', () => {
    const empire = (o: Partial<Empire>): Empire => ({ pirateEmpireBaseHabitat: null, piratePlayStyle: PiratePlayStyle.Undefined, dominantRace: null, ...o }) as unknown as Empire;
    it('no race: nothing (the empty bitmap)', () => {
        expect(racePicturePlan({ empire: null, race: null, width: 160, height: 160, inset: 6, pirate: false })).toEqual({ width: 160, height: 160, inset: 6, backdrop: null, portrait: [], frame: null });
    });
    it('a race on the start screens: its native landscape, its alternate picture (else the normal one), the frame', () => {
        const p = racePicturePlan({ empire: null, race: race(12, HabitatType.Ocean), width: 300, height: 300, inset: 6, pirate: false });
        expect(p.backdrop).toBe(landscapeImageUrl(23 + (12 % 2)));
        expect(p.portrait).toEqual(['/assets/dwu/images/units/races/race_12a.png', '/assets/dwu/images/units/races/race_12.png']);
        expect(p.frame).toBe(PANEL_FRAME_URL);
    });
    it('the pirate playstyle picture: storyEvent.jpg, GetPirateImage(style) (not the alternate), the frame', () => {
        const p = racePicturePlan({ empire: null, race: race(3, HabitatType.Desert), width: 300, height: 300, inset: 6, pirate: true, piratePlayStyle: PiratePlayStyle.Pirate });
        expect(p.backdrop).toBe(STORY_EVENT_URL);
        expect(p.portrait[0]).toBe('/assets/dwu/images/units/races/pirates/raider.png');
        // No playstyle: the race's own picture on the space backdrop.
        expect(racePicturePlan({ empire: null, race: race(3, HabitatType.Desert), width: 160, height: 160, inset: 6, pirate: true }).portrait[0]).toBe('/assets/dwu/images/units/races/race_3a.png');
    });
    it("the talk panel: the empire's dominant race image (alternate first); a pirate faction's playstyle image on storyEvent.jpg", () => {
        const r = race(5, HabitatType.Ice);
        const p = racePicturePlan({ empire: empire({ dominantRace: r as never }), race: r, width: 280, height: 280, inset: 7, pirate: false });
        expect(p.backdrop).toBe(landscapeImageUrl(17 + (5 % 3)));
        expect(p.portrait).toEqual(['/assets/dwu/images/units/races/race_5a.png', '/assets/dwu/images/units/races/race_5.png']);
        const pirate = empire({ dominantRace: r as never, pirateEmpireBaseHabitat: {} as never, piratePlayStyle: PiratePlayStyle.Smuggler });
        const q = racePicturePlan({ empire: pirate, race: r, width: 280, height: 280, inset: 7, pirate: true });
        expect(q.backdrop).toBe(STORY_EVENT_URL);
        expect(q.portrait).toEqual(['/assets/dwu/images/units/races/pirates/smuggler_a.png', '/assets/dwu/images/units/races/pirates/smuggler.png']);
    });
    (installLinked ? it : it.skip)('the race / pirate pictures and the chrome exist in the install', () => {
        for (const url of [STORY_EVENT_URL, PANEL_FRAME_URL, '/assets/dwu/images/units/races/pirates/balanced_a.png', '/assets/dwu/images/units/races/race_0a.png']) {
            expect(existsSync(resolve(gameRoot, 'public', url.replace(/^\//, ''))), url).toBe(true);
        }
    });
});
