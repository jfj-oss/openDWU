// Theme (customization set) leftovers, each ported from the original's loaders and tested on RetreatUE Bacon plus
// another installed theme (skipped per theme when it is not installed), and on synthetic sets for the folders no
// installed theme ships:
//   1. effect animations re-counted from a theme's replacing folder (Main.Part12.cs 125 LoadEffectsExplosion,
//      Main.Part13.cs 1243 LoadHyperEffects / 1353 LoadEffects; render/effectFrames.ts);
//   2. a theme's planets/other and landscapes/other pictures after the fixed ones (HabitatImageCache.cs
//      GenerateHabitatImageFilepaths 334-343, Main.Part12.cs LoadEnvLandscapes 287-310);
//   3. the volcanic glow folder (Main.Part13.cs 1666-1688 LoadEnvironmentOverlays, MainView.cs 2515 method_50);
//   4. race-specific diplomacy mood stings (Main.Part4.cs 369 method_521);
//   5. the options' theme restored when a ?theme= game ends (Main.Part12.cs 3181-3184);
//   6. the design editor's ship-picture count and families with a theme (BaconBuiltObjectImageCache.cs AddMoreImages);
//   7. Expanded's Clean Galaxy view (GameOptions.CleanGalaxyView, MainView.2.cs method_250).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('pixi.js', () => ({ Assets: { load: vi.fn() }, Texture: class {}, BufferImageSource: class {}, CanvasSource: class {} }));

import { CustomizationSet, setActiveCustomizationSet, windowsOrdinal } from '../src/sim/data/customization';
import { installedThemes, themeIndexFs } from './helpers/loadGameDataFs';
import {
    STOCK_TRACTOR_STRIKE_FRAME_COUNT,
    constructionFrameUrls,
    engineThrusterUrls,
    explosionSetUrls,
    gasMiningFrameUrls,
    hyperFrameUrls,
    miningFrameUrls,
    planetDestroyUrls,
    tractorStrikeFrameUrls,
} from '../src/render/effectFrames';
import { diplomacyMoodSoundFile, themedAssetUrl, themeOtherLandscapeUrls } from '../src/themeAssets';
import { landscapeImageCount, landscapeImageUrl } from '../src/ui/landscapeImages';
import { themeToRestoreOnLeave } from '../src/themeLoader';
import { galaxyViewGates } from '../src/render/cleanGalaxyView';
import { DEFAULT_SETTINGS, loadSettings, setSettingsStorage } from '../src/ui/settings';
import { EFFECTS_URL_PREFIX } from '../src/audio/musicPlayer';
import { HabitatType } from '../src/sim/types';

const { MANIFEST, habitatPictureCount, habitatPictureUrl } = await import('../src/render/assets');
const { volcanicGlowIndex, volcanicGlowPixels, volcanicGlowUrls, VOLCANIC_GLOW_COLOR } = await import('../src/render/volcanicGlow');
const { SHIP_PICTURE_COUNT, shipPictureCount, shipPictureGroups } = await import('../src/ui/screens/designPanelsModel');
const { themeShipFamilyPaths, STANDARD_SHIP_IMAGE_START_INDEX } = await import('../src/render/builtObjectLayer');

const installed = new Set(installedThemes());
const BACON = 'RetreatUE Bacon';
const STPE = 'DW Universe-STPE Ver 2';
const PICARD = 'DW Universe-ST Picard Era';
const ME4 = 'Mass Effect 4 Mod';
const STARFALL = 'DW - Starfall 1.12 - Corrected';
const dwuRoot = resolve(__dirname, '../public/assets/dwu');

afterEach(() => setActiveCustomizationSet(null));

function useTheme(name: string): CustomizationSet {
    const set = themeIndexFs(name)!;
    setActiveCustomizationSet(set);
    return set;
}

const synthetic = (files: string[], dirs: string[] = []) => new CustomizationSet({ set: 'Synth', files, dirs });
const S = '/assets/dwu/Customization/Synth/';

/** The stock lists, taken with no theme active. */
function stockLists() {
    setActiveCustomizationSet(null);
    const r = {
        explosions: explosionSetUrls(),
        planetDestroy: planetDestroyUrls(),
        hyper: hyperFrameUrls(),
        engine: engineThrusterUrls(),
        mining: miningFrameUrls(),
        gasMining: gasMiningFrameUrls(),
        construction: constructionFrameUrls(),
        tractor: tractorStrikeFrameUrls(),
    };
    return r;
}

describe('1. effect frames re-counted from the folder in use (LoadEffectsExplosion / LoadHyperEffects / LoadEffects)', () => {
    it('stock: the install folders', () => {
        const s = stockLists();
        expect(s.explosions).toHaveLength(20);
        expect(s.explosions.every((l) => l.length === 20)).toBe(true);
        expect(s.explosions[0][0]).toBe('/assets/dwu/images/effects/explosions/Expl01/Expl010001.png');
        expect(s.planetDestroy).toHaveLength(120);
        expect(s.hyper.enter.map((l) => l.length)).toEqual([50, 32, 40, 43]);
        expect(s.hyper.exit.map((l) => l.length)).toEqual([35, 31, 43, 42]);
        expect(s.engine).toEqual([0, 1, 2, 3, 4, 5].map((i) => `/assets/dwu/images/effects/enginethrusters/${i}.png`));
        expect([s.mining.length, s.gasMining.length, s.construction.length]).toEqual([120, 90, 90]);
        expect(s.mining[119]).toBe('/assets/dwu/images/effects/mining/Frame_120.png');
        // bitmap_215 = GetFiles("*.png").Length = 21 files 01..21.PNG (ConvertBitmapsToTexturesIfExist: all of them).
        expect(s.tractor).toHaveLength(STOCK_TRACTOR_STRIKE_FRAME_COUNT);
        expect(s.tractor[20]).toBe('/assets/dwu/images/effects/tractorbeamstrike/21.PNG');
    });
    it.runIf(existsSync(resolve(dwuRoot, 'images/effects/tractorbeamstrike')))('the stock counts are the install folders\' *.png counts', () => {
        const png = (d: string) => readdirSync(resolve(dwuRoot, 'images/effects', d)).filter((f) => f.toLowerCase().endsWith('.png'));
        expect(png('mining')).toHaveLength(120);
        expect(png('gasmining')).toHaveLength(90);
        expect(png('construction')).toHaveLength(90);
        expect(png('tractorbeamstrike')).toHaveLength(STOCK_TRACTOR_STRIKE_FRAME_COUNT);
        expect(png('planetdestroy')).toHaveLength(120);
        for (let k = 0; k < 4; k++) {
            const n = (kind: string) => readdirSync(resolve(dwuRoot, `images/effects/${kind}/${k}`)).filter((f) => /^frame_.*\.png$/i.test(f)).length;
            expect(n('hyperenter')).toBe([50, 32, 40, 43][k]);
            expect(n('hyperexit')).toBe([35, 31, 43, 42][k]);
        }
        expect(readdirSync(resolve(dwuRoot, 'images/effects/explosions'))).toHaveLength(20);
    });
    it.skipIf(!installed.has(BACON))(`${BACON}: replaces only effects\\weapons, so every animation is the stock one`, () => {
        const stock = stockLists();
        useTheme(BACON);
        expect(explosionSetUrls()).toEqual(stock.explosions);
        expect(planetDestroyUrls()).toEqual(stock.planetDestroy);
        expect(hyperFrameUrls()).toEqual(stock.hyper);
        expect(engineThrusterUrls()).toEqual(stock.engine);
        expect(miningFrameUrls()).toEqual(stock.mining);
        expect(constructionFrameUrls()).toEqual(stock.construction);
        expect(tractorStrikeFrameUrls()).toEqual(stock.tractor);
    });
    it.skipIf(!installed.has(ME4))(`${ME4}: its enginethrusters folder (0..5.png and a Thumbs.db) replaces bitmap_209`, () => {
        const stock = stockLists();
        useTheme(ME4);
        const urls = engineThrusterUrls();
        expect(urls).toHaveLength(6);
        expect(urls[0]).toBe('/assets/dwu/Customization/Mass%20Effect%204%20Mod/images/effects/enginethrusters/0.png');
        expect(miningFrameUrls()).toEqual(stock.mining);
    });
    it('a theme folder: its own counts, names and order', () => {
        const files = [
            'images/effects/explosions/BoomB/b2.png', 'images/effects/explosions/BoomB/b1.png',
            'images/effects/explosions/boomA/A_10.png', 'images/effects/explosions/boomA/A_9.png', 'images/effects/explosions/boomA/notes.txt',
            'images/effects/planetdestroy/p2.png', 'images/effects/planetdestroy/p1.png',
            'images/effects/hyperenter/0/frame_0.png', 'images/effects/hyperenter/0/frame_1.png', 'images/effects/hyperenter/0/frame_3.png',
            'images/effects/hyperenter/1/frame_0.png',
            'images/effects/hyperenter/2/frame_0.png',
            'images/effects/enginethrusters/0.png', 'images/effects/enginethrusters/2.png', 'images/effects/enginethrusters/glow.png',
            ...Array.from({ length: 7 }, (_u, i) => `images/effects/mining/Frame_${String(i + 1).padStart(3, '0')}.png`),
            'images/effects/tractorbeamstrike/01.PNG', 'images/effects/tractorbeamstrike/02.png', 'images/effects/tractorbeamstrike/x.png',
            'images/effects/construction/readme.txt',
        ];
        setActiveCustomizationSet(synthetic(files));
        const ex = explosionSetUrls();
        expect(ex).toHaveLength(20);
        // GetDirectories in Windows order (boomA, BoomB); each set List.Sort()'ed (culture order: "A_10" < "A_9").
        expect(ex[0]).toEqual([`${S}images/effects/explosions/boomA/A_10.png`, `${S}images/effects/explosions/boomA/A_9.png`]);
        expect(ex[1]).toEqual([`${S}images/effects/explosions/BoomB/b1.png`, `${S}images/effects/explosions/BoomB/b2.png`]);
        expect(ex.slice(2).every((l) => l.length === 0)).toBe(true); // null slots past the theme's sets
        expect(planetDestroyUrls()).toEqual([`${S}images/effects/planetdestroy/p1.png`, `${S}images/effects/planetdestroy/p2.png`]);
        const hyper = hyperFrameUrls();
        // Folder 0: 3 frame_*.png, frame_2 missing → frame_0, frame_1, then null slots.
        expect(hyper.enter[0]).toEqual([`${S}images/effects/hyperenter/0/frame_0.png`, `${S}images/effects/hyperenter/0/frame_1.png`, '']);
        expect(hyper.enter.map((l) => l.length)).toEqual([3, 1, 1]);
        // The exit folder is the stock one (no theme "0"): its folders 0..2 pair with the theme's 0..2.
        expect(hyper.exit.map((l) => l.length)).toEqual([35, 31, 43]);
        // GetFiles("*.png").Length = 3 → <i>.png for i < 3 that exist: 0 and 2.
        expect(engineThrusterUrls()).toEqual([`${S}images/effects/enginethrusters/0.png`, `${S}images/effects/enginethrusters/2.png`]);
        expect(miningFrameUrls()).toHaveLength(7);
        expect(miningFrameUrls()[6]).toBe(`${S}images/effects/mining/Frame_007.png`);
        expect(tractorStrikeFrameUrls()).toEqual([`${S}images/effects/tractorbeamstrike/01.PNG`, `${S}images/effects/tractorbeamstrike/02.png`, `${S}images/effects/tractorbeamstrike/03.png`]);
        // A folder without a *.png is no replacement.
        expect(constructionFrameUrls()).toHaveLength(90);
        expect(gasMiningFrameUrls()[0]).toBe('/assets/dwu/images/effects/gasmining/Frame_001.png');
    });
    it('hyper: a folder without the "0" subfolder is no replacement; the loop stops at the first missing folder', () => {
        setActiveCustomizationSet(synthetic(['images/effects/hyperenter/a/frame_0.png', 'images/effects/hyperexit/0/frame_0.png', 'images/effects/hyperexit/2/frame_0.png']));
        const hyper = hyperFrameUrls();
        // enter = stock (4 numbered folders), exit = the theme's: folder 1 is missing → the loop breaks after enter[1].
        expect(hyper.enter.map((l) => l.length)).toEqual([50, 32]);
        expect(hyper.exit).toEqual([[`${S}images/effects/hyperexit/0/frame_0.png`]]);
    });
});

describe('2. planets/other and landscapes/other after the fixed pictures', () => {
    it('no theme: nothing past the 665 / 30', () => {
        expect(themeOtherLandscapeUrls()).toEqual([]);
        expect(landscapeImageUrl(30)).toBeNull();
        expect(landscapeImageCount()).toBe(30);
        expect(habitatPictureCount()).toBe(665);
    });
    it.skipIf(!installed.has(BACON))(`${BACON}: no other folders, so the same tables`, () => {
        useTheme(BACON);
        expect(landscapeImageUrl(30)).toBeNull();
        expect(landscapeImageCount()).toBe(30);
        expect(habitatPictureUrl(665)).toBeNull();
        expect(habitatPictureCount()).toBe(665);
        expect(landscapeImageUrl(24)).toBe('/assets/dwu/images/environment/landscapes/ocean/landscape_1.png');
    });
    it.skipIf(!installed.has(STPE))(`${STPE}: its planets/other (19 *.png) and landscapes/other (103 *.png) follow, in Directory.GetFiles order`, () => {
        const set = useTheme(STPE);
        const land = set.listFiles('images/environment/landscapes/other', '.png');
        const planets = set.listFiles('images/environment/planets/other', '.png');
        expect(land).toHaveLength(103); // plus a Thumbs.db, not a *.png
        expect(planets).toHaveLength(19);
        expect([...land].sort(windowsOrdinal)).toEqual(land);
        expect(landscapeImageCount()).toBe(30 + 103);
        expect(landscapeImageUrl(30)).toBe(set.listedFileUrl('images/environment/landscapes/other', land[0]));
        expect(landscapeImageUrl(30 + 102)).toBe(set.listedFileUrl('images/environment/landscapes/other', land[102]));
        expect(landscapeImageUrl(30 + 103)).toBeNull();
        expect(decodeURI(landscapeImageUrl(30)!)).toContain('/Customization/DW Universe-STPE Ver 2/images/environment/landscapes/other/1-Acamarian - Acamar 36e.png');
        expect(habitatPictureCount()).toBe(665 + 19);
        expect(habitatPictureUrl(665)).toBe(set.listedFileUrl('images/environment/planets/other', planets[0]));
        expect(habitatPictureUrl(665 + 19)).toBeNull();
    });
});

describe('3. the volcanic glow (LoadEnvironmentOverlays bitmap_195, method_50)', () => {
    const stockVolcanic = existsSync(resolve(dwuRoot, 'images/environment/planets/volcanic')) ? readdirSync(resolve(dwuRoot, 'images/environment/planets/volcanic')) : null;
    const withStockManifest = (fn: () => void) => {
        const saved = MANIFEST['planets/volcanic'];
        MANIFEST['planets/volcanic'] = stockVolcanic ?? [];
        try {
            fn();
        } finally {
            if (saved === undefined) delete MANIFEST['planets/volcanic'];
            else MANIFEST['planets/volcanic'] = saved;
        }
    };
    it.runIf(stockVolcanic !== null)('stock: the first 20 VolcanicG* files of the install folder', () => {
        withStockManifest(() => {
            const urls = volcanicGlowUrls();
            expect(urls).toHaveLength(20);
            expect(urls[0]).toBe('/assets/dwu/images/environment/planets/volcanic/VolcanicG-0001.png');
            expect(urls[19]).toBe('/assets/dwu/images/environment/planets/volcanic/VolcanicG-0020.png');
        });
    });
    it.skipIf(!installed.has(BACON) || !installed.has(STPE))(`${BACON} / ${STPE}: their planets/volcanic folder replaces the stock one`, () => {
        withStockManifest(() => {
            for (const name of [BACON, STPE]) {
                const set = useTheme(name);
                const glows = set.listFiles('images/environment/planets/volcanic').filter((f) => f.toLowerCase().startsWith('volcanicg'));
                const urls = volcanicGlowUrls();
                expect(urls).toHaveLength(20);
                expect(urls[0]).toBe(set.listedFileUrl('images/environment/planets/volcanic', glows[0]));
                expect(urls.every((u) => u.includes('/Customization/'))).toBe(true);
            }
        });
    });
    it('a theme volcanic folder with no glow files: no glow (the original indexes past the empty list)', () => {
        withStockManifest(() => {
            setActiveCustomizationSet(synthetic(['images/environment/planets/volcanic/Volcanic-0001.png']));
            expect(volcanicGlowUrls()).toEqual([]);
        });
    });
    it('the glow index: Volcanic habitats with PictureRef in [229, 249)', () => {
        expect(volcanicGlowIndex({ type: HabitatType.Volcanic, pictureRef: 229 })).toBe(0);
        expect(volcanicGlowIndex({ type: HabitatType.Volcanic, pictureRef: 248 })).toBe(19);
        expect(volcanicGlowIndex({ type: HabitatType.Volcanic, pictureRef: 249 })).toBe(-1);
        expect(volcanicGlowIndex({ type: HabitatType.Volcanic, pictureRef: 665 })).toBe(-1); // a theme's planets/other picture
        expect(volcanicGlowIndex({ type: HabitatType.Desert, pictureRef: 230 })).toBe(-1);
    });
    it('pixels: MakeTransparent() of an opaque lower-left colour, then RGB := (255, 64, 0) with alpha kept', () => {
        // 2 x 2: top row (10,20,30,255) (1,2,3,128); bottom row (10,20,30,255) lower-left, (9,9,9,255).
        const px = new Uint8ClampedArray([10, 20, 30, 255, 1, 2, 3, 128, 10, 20, 30, 255, 9, 9, 9, 255]);
        volcanicGlowPixels(px, 2, 2);
        const [r, g, b] = VOLCANIC_GLOW_COLOR;
        expect(Array.from(px)).toEqual([r, g, b, 0, r, g, b, 128, r, g, b, 0, r, g, b, 255]);
        // A transparent lower-left pixel: MakeTransparent does nothing.
        const px2 = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]);
        volcanicGlowPixels(px2, 1, 2);
        expect(px2[3]).toBe(255);
    });
});

describe('4. race-specific diplomacy mood stings (method_521)', () => {
    it('no theme: the stock file', () => {
        expect(diplomacyMoodSoundFile('diplomacyMoodAngry.mp3', 'Human')).toBe('diplomacyMoodAngry.mp3');
    });
    it.skipIf(!installed.has(BACON))(`${BACON}: no mood files of its own → the stock sting`, () => {
        useTheme(BACON);
        const f = diplomacyMoodSoundFile('diplomacyMoodHappy.mp3', 'Human');
        expect(f).toBe('diplomacyMoodHappy.mp3');
        expect(themedAssetUrl(EFFECTS_URL_PREFIX + f)).toBe('/assets/dwu/Sounds/Effects/diplomacyMoodHappy.mp3');
    });
    it.skipIf(!installed.has(STPE))(`${STPE}: the theme's sounds\\effects\\<Race>\\ copy (case-insensitive), else its base copy`, () => {
        useTheme(STPE);
        const f = diplomacyMoodSoundFile('diplomacyMoodAngry.mp3', 'Klingon');
        expect(f).toBe('klingon/diplomacyMoodAngry.mp3');
        expect(themedAssetUrl(EFFECTS_URL_PREFIX + f)).toBe('/assets/dwu/Customization/DW%20Universe-STPE%20Ver%202/Sounds/Effects/klingon/diplomacyMoodAngry.mp3');
        // A race without its own folder: the plain file (the theme's or the stock one, themedAssetUrl).
        expect(diplomacyMoodSoundFile('diplomacyMoodAngry.mp3', 'Human')).toBe('diplomacyMoodAngry.mp3');
    });
    it.skipIf(!installed.has(PICARD))(`${PICARD}: empty race folders → its base sounds\\effects copy`, () => {
        const set = useTheme(PICARD);
        const f = diplomacyMoodSoundFile('diplomacyMoodNeutral.mp3', 'Federation');
        expect(f).toBe('diplomacyMoodNeutral.mp3');
        expect(themedAssetUrl(EFFECTS_URL_PREFIX + f)).toBe(set.fileUrl('Sounds/Effects/diplomacyMoodNeutral.mp3'));
    });
});

describe("5. leaving a game restores the options' theme (Main.Part12.cs 3181)", () => {
    const list = [BACON, STPE];
    it('a ?theme= game over the stock options → back to the stock game', () => {
        expect(themeToRestoreOnLeave(BACON, '', list)).toBe('');
    });
    it('the same theme → stay; another stored theme → that one; a stored theme whose folder is gone → stock', () => {
        expect(themeToRestoreOnLeave(BACON, BACON, list)).toBeNull();
        expect(themeToRestoreOnLeave('', '', list)).toBeNull();
        expect(themeToRestoreOnLeave('', 'default', list)).toBeNull();
        expect(themeToRestoreOnLeave(STPE, BACON.toLowerCase(), list)).toBe(BACON);
        expect(themeToRestoreOnLeave(BACON, 'Gone Theme', list)).toBe('');
        expect(themeToRestoreOnLeave('', 'Gone Theme', list)).toBeNull();
    });
});

describe('6. ship pictures in the design editor (GetImagesSmall().Length, AddMoreImages)', () => {
    const groupsCover = (count: number) => {
        const groups = shipPictureGroups();
        expect(groups[0]).toMatchObject({ first: 0, last: STANDARD_SHIP_IMAGE_START_INDEX - 1 });
        for (let i = 1; i < groups.length; i++) expect(groups[i].first).toBe(groups[i - 1].last + 1);
        expect(groups[groups.length - 1].last).toBe(count - 1);
        return groups;
    };
    it('stock: 72 + 27 families × 24', () => {
        expect(shipPictureCount()).toBe(SHIP_PICTURE_COUNT);
        expect(SHIP_PICTURE_COUNT).toBe(72 + 27 * 24);
        expect(groupsCover(SHIP_PICTURE_COUNT)).toHaveLength(28);
    });
    for (const name of [BACON, STARFALL]) {
        it.skipIf(!installed.has(name))(`${name}: every slot AddMoreImages takes, one group per family folder`, () => {
            const set = useTheme(name);
            const n = 72 + themeShipFamilyPaths(set).length;
            expect(shipPictureCount()).toBe(n);
            const groups = groupsCover(n);
            if (name === STARFALL) {
                // Its family27..family44 folders follow the 27 stock families.
                expect(n).toBeGreaterThan(SHIP_PICTURE_COUNT);
                expect(groups.map((g) => g.label)).toContain('Family 28');
                expect(groups.map((g) => g.label)).toContain('Family 45');
            }
        });
    }
});

describe('7. Clean Galaxy view (GameOptions.CleanGalaxyView)', () => {
    it('off by default; persisted', () => {
        expect(DEFAULT_SETTINGS.cleanGalaxyView).toBe(false);
        const store = new Map<string, string>();
        setSettingsStorage({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) });
        try {
            store.set('dwu-ui-settings', JSON.stringify({ cleanGalaxyView: true }));
            expect(loadSettings().cleanGalaxyView).toBe(true);
            store.set('dwu-ui-settings', JSON.stringify({ cleanGalaxyView: 'yes' }));
            expect(loadSettings().cleanGalaxyView).toBe(false);
        } finally {
            setSettingsStorage(null);
        }
    });
    it('hides the sector grid, system rings, links and names; gas-cloud crosses stay (method_250)', () => {
        expect(galaxyViewGates(false)).toEqual({ sectorGrid: true, systemRings: true, gasCloudCrosses: true, systemLinks: true, systemNames: true });
        expect(galaxyViewGates(true)).toEqual({ sectorGrid: false, systemRings: false, gasCloudCrosses: true, systemLinks: false, systemNames: false });
    });
});
