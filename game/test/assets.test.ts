// Index math for the real-art URL builders: planets, moons and asteroids index the original's HabitatImageCache table
// by Habitat.PictureRef (GalaxyImages.cs, habitatPictureUrls); stars and gas clouds take pictureRef modulo the
// manifest folder's file count (task 02b1). The builders live in src/render/assets.ts which imports pixi.js, so this
// test stubs that module before importing them.
import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Assets: { load: vi.fn() }, Texture: class {} }));

const { MANIFEST, pickFromFolder, mapStarUrls, starSpriteUrls, habitatPictureUrl, habitatPictureUrls, cloudUrls } = await import(
    '../src/render/assets'
);
import type { Habitat } from '../src/sim/types';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';

function habitat(type: HabitatType, pictureRef: number, category = HabitatCategoryType.Planet): Habitat {
    return { type, pictureRef, category } as unknown as Habitat;
}

describe('pickFromFolder (pictureRef % fileCount)', () => {
    it('wraps past the end of the folder list', () => {
        MANIFEST['planets/ocean'] = ['Ocean-0001.png', 'Ocean-0002.png', 'Ocean-0003.png'];
        // 900 % 3 === 0 -> first file; 902 % 3 === 2 -> third file.
        expect(pickFromFolder('planets/ocean', 900)).toEqual(['/assets/dwu/images/environment/planets/ocean/Ocean-0001.png']);
        expect(pickFromFolder('planets/ocean', 902)).toEqual(['/assets/dwu/images/environment/planets/ocean/Ocean-0003.png']);
    });

    it('returns [] for unknown or empty folders', () => {
        expect(pickFromFolder('nope/nothing', 5)).toEqual([]);
        MANIFEST['empty/folder'] = [];
        expect(pickFromFolder('empty/folder', 5)).toEqual([]);
    });

    it('handles negative pictureRefs without throwing', () => {
        MANIFEST['stars/rays'] = ['CoronaA-0001.png', 'CoronaA-0002.png'];
        expect(pickFromFolder('stars/rays', -1)).toEqual(['/assets/dwu/images/environment/stars/rays/CoronaA-0002.png']);
    });
});

describe('URL builders with a loaded manifest', () => {
    it('map stars index into their type folder by pictureRef % count', () => {
        MANIFEST['mapstars/mainsequence'] = [
            'StarDisk_138.png',
            'StarDisk_139.png',
            'StarDisk_140.png',
            'StarDisk_141.png',
            'StarDisk_142.png',
            'StarDisk_143.png',
        ];
        // selectStar() yields pictureRef 83/84 for main sequence: 83 % 6 = 5, 84 % 6 = 0.
        expect(mapStarUrls(habitat(HabitatType.MainSequence, 83))).toEqual([
            '/assets/dwu/images/environment/mapstars/mainsequence/StarDisk_143.png',
        ]);
        expect(mapStarUrls(habitat(HabitatType.MainSequence, 84))).toEqual([
            '/assets/dwu/images/environment/mapstars/mainsequence/StarDisk_138.png',
        ]);
    });

    it('system-zoom stars use star_disc_<pictureRef % 3>.png plus a corona ray frame', () => {
        MANIFEST['stars/rays'] = ['CoronaA-0001.png', 'CoronaA-0002.png', 'CoronaA-0003.png'];
        const urls = starSpriteUrls(habitat(HabitatType.RedGiant, 85));
        expect(urls[0]).toBe('/assets/dwu/images/environment/stars/star_disc_1.png'); // 85 % 3 = 1
        expect(urls[1]).toBe('/assets/dwu/images/environment/stars/rays/CoronaA-0002.png'); // 85 % 3 + 1 = 2
    });

    it('black holes use the blackhole disc art instead of discs+coronas', () => {
        MANIFEST['stars/blackhole'] = ['BlkHole-0001.png', 'BlkHole-0002.png'];
        const urls = starSpriteUrls(habitat(HabitatType.BlackHole, 95));
        expect(urls).toContain('/assets/dwu/images/environment/stars/blackhole/BlkHole-0002.png'); // 95 % 2 = 1
        expect(urls).toContain('/assets/dwu/images/environment/stars/star_blackhole_0.png');
    });

    it('planets, moons and asteroids draw HabitatImageCache[PictureRef] (GalaxyImages index, no modulo)', () => {
        MANIFEST['planets/sandydesert'] = ['Desert-0001.png', 'Desert-0002.png', 'Desert-0026.png'];
        // HabitatImageOffsetDesert = 204: 205 is the second desert picture, whatever the habitat's type.
        expect(habitatPictureUrls(habitat(HabitatType.Desert, 205))).toEqual(['/assets/dwu/images/environment/planets/sandydesert/Desert-0002.png']);
        expect(habitatPictureUrls(habitat(HabitatType.Ocean, 204, HabitatCategoryType.Moon))).toEqual(['/assets/dwu/images/environment/planets/sandydesert/Desert-0001.png']);
        // LoadImage's File.Exists: a picture missing from the install (manifest) is no image.
        expect(habitatPictureUrls(habitat(HabitatType.Desert, 206))).toEqual([]);
        // Out of the table (no theme planets/other images): none, and no wrap-around.
        expect(habitatPictureUrl(665)).toBeNull();
        expect(habitatPictureUrl(-1)).toBeNull();
        expect(habitatPictureUrl(1105)).toBeNull();
    });

    it('gas clouds share the flat nebulae folder', () => {
        MANIFEST['nebulae'] = ['NebulaArray16_02.png', 'NebulaArray16_03.png', 'NebulaArray16_04.png'];
        expect(cloudUrls(habitat(HabitatType.Hydrogen, 79))).toEqual([
            '/assets/dwu/images/environment/nebulae/NebulaArray16_03.png', // 79 % 3 = 2
        ]);
    });

    it('asteroids: AsteroidsMetal 549, Gold 649, Crystal 657 all live in asteroids/metal', () => {
        MANIFEST['asteroids/metal'] = ['AstCryst-0001.png', 'AstCryst-0002.png', 'AstGold-0008.png', 'AstMtl-0001.png'];
        expect(habitatPictureUrls(habitat(HabitatType.Metal, 658, HabitatCategoryType.Asteroid))).toEqual(['/assets/dwu/images/environment/asteroids/metal/AstCryst-0002.png']);
        expect(habitatPictureUrls(habitat(HabitatType.Metal, 656, HabitatCategoryType.Asteroid))).toEqual(['/assets/dwu/images/environment/asteroids/metal/AstGold-0008.png']);
        expect(habitatPictureUrls(habitat(HabitatType.Metal, 549, HabitatCategoryType.Asteroid))).toEqual(['/assets/dwu/images/environment/asteroids/metal/AstMtl-0001.png']);
    });

    it('all builders return [] when no manifest is loaded', () => {
        for (const k of Object.keys(MANIFEST)) delete MANIFEST[k];
        expect(mapStarUrls(habitat(HabitatType.MainSequence, 83))).toEqual([]);
        // Non-black-hole stars still emit the shared disc URL; black holes only the fixed disc.
        expect(starSpriteUrls(habitat(HabitatType.RedGiant, 85))).toEqual(['/assets/dwu/images/environment/stars/star_disc_1.png']);
        expect(starSpriteUrls(habitat(HabitatType.BlackHole, 95))).toEqual(['/assets/dwu/images/environment/stars/star_blackhole_0.png']);
        expect(habitatPictureUrls(habitat(HabitatType.Ocean, 190))).toEqual([]);
        expect(cloudUrls(habitat(HabitatType.Hydrogen, 79))).toEqual([]);
        expect(habitatPictureUrls(habitat(HabitatType.BarrenRock, 249, HabitatCategoryType.Asteroid))).toEqual([]);
    });
});