// Index math for the real-art URL builders: planets, moons and asteroids index the original's HabitatImageCache table
// by Habitat.PictureRef (GalaxyImages.cs, habitatPictureUrls); stars index bitmap_196 (Main.Part13.cs LoadMapStars,
// the mapstars folders concatenated) by Habitat.MapPictureRef, a super nova's own picture bitmap_206 by
// NovaImageIndexMajor; gas clouds take pictureRef modulo the manifest folder's file count (task 02b1). The builders
// live in src/render/assets.ts which imports pixi.js, so this test stubs that module before importing them.
import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Assets: { load: vi.fn() }, Texture: class {} }));

const { MANIFEST, pickFromFolder, mapStarUrls, mapStarImageUrls, starPictureUrls, habitatPictureUrl, habitatPictureUrls, cloudUrls } = await import(
    '../src/render/assets'
);
import type { Habitat } from '../src/sim/types';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';

function habitat(type: HabitatType, pictureRef: number, category = HabitatCategoryType.Planet): Habitat {
    return { type, pictureRef, category } as unknown as Habitat;
}
function star(type: HabitatType, mapPictureRef: number, novaImageIndexMajor = 0): Habitat {
    return { type, category: HabitatCategoryType.Star, pictureRef: mapPictureRef, mapPictureRef, novaImageIndexMajor } as unknown as Habitat;
}
const MAPSTARS: Record<string, string[]> = {
    'mapstars/mainsequence': ['StarDisk_138.png', 'StarDisk_139.png', 'StarDisk_140.png', 'StarDisk_141.png', 'StarDisk_142.png', 'StarDisk_143.png'],
    'mapstars/redgiant': ['StarDisk_144.png'],
    'mapstars/supergiant': ['StarDisk_144.png'],
    'mapstars/whitedwarf': ['StarDisk_135.png', 'StarDisk_136.png', 'StarDisk_137.png'],
    'mapstars/neutron': ['StarDisk_133.png', 'StarDisk_134.png'],
    'mapstars/blackhole': ['star_blackhole_0.png'],
    'mapstars/flares': ['StarFlare128_color030.png'],
};

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
    it('map stars: bitmap_196[MapPictureRef], the LoadMapStars folders concatenated (no modulo, flares not included)', () => {
        Object.assign(MANIFEST, MAPSTARS);
        const dir = '/assets/dwu/images/environment/mapstars';
        expect(mapStarImageUrls()).toEqual([
            ...MAPSTARS['mapstars/mainsequence'].map((f) => `${dir}/mainsequence/${f}`),
            `${dir}/redgiant/StarDisk_144.png`,
            `${dir}/supergiant/StarDisk_144.png`,
            ...MAPSTARS['mapstars/whitedwarf'].map((f) => `${dir}/whitedwarf/${f}`),
            ...MAPSTARS['mapstars/neutron'].map((f) => `${dir}/neutron/${f}`),
            `${dir}/blackhole/star_blackhole_0.png`,
        ]);
        expect(mapStarUrls(star(HabitatType.MainSequence, 0))).toEqual([`${dir}/mainsequence/StarDisk_138.png`]);
        expect(mapStarUrls(star(HabitatType.MainSequence, 5))).toEqual([`${dir}/mainsequence/StarDisk_143.png`]);
        expect(mapStarUrls(star(HabitatType.RedGiant, 6))).toEqual([`${dir}/redgiant/StarDisk_144.png`]);
        expect(mapStarUrls(star(HabitatType.SuperGiant, 7))).toEqual([`${dir}/supergiant/StarDisk_144.png`]);
        expect(mapStarUrls(star(HabitatType.WhiteDwarf, 10))).toEqual([`${dir}/whitedwarf/StarDisk_137.png`]);
        expect(mapStarUrls(star(HabitatType.Neutron, 11))).toEqual([`${dir}/neutron/StarDisk_133.png`]);
        expect(mapStarUrls(star(HabitatType.BlackHole, 13))).toEqual([`${dir}/blackhole/star_blackhole_0.png`]);
        // A super nova's MapPictureRef is SelectStar's 0: bitmap_196[0] where the C# reads it (lists, system panel).
        expect(mapStarUrls(star(HabitatType.SuperNova, 0))).toEqual([`${dir}/mainsequence/StarDisk_138.png`]);
        // Outside bitmap_196 (a gas cloud's 16-23) or no star: nothing.
        expect(mapStarUrls(star(HabitatType.MainSequence, 14))).toEqual([]);
        expect(mapStarUrls({ type: HabitatType.Hydrogen, category: HabitatCategoryType.GasCloud, mapPictureRef: 0 } as unknown as Habitat)).toEqual([]);
    });

    it("star pictures (method_54 / the galaxy pass): a super nova's bitmap_206[NovaImageIndexMajor], else bitmap_196", () => {
        Object.assign(MANIFEST, MAPSTARS);
        MANIFEST['supernovae'] = ['NovaCloud-0001.png', 'NovaCloud-0002.png', 'NovaCloud-0074.png'];
        expect(starPictureUrls(star(HabitatType.SuperNova, 0, 2))).toEqual(['/assets/dwu/images/environment/supernovae/NovaCloud-0074.png']);
        expect(starPictureUrls(star(HabitatType.SuperNova, 0, 3))).toEqual([]);
        expect(starPictureUrls(star(HabitatType.WhiteDwarf, 9))).toEqual(['/assets/dwu/images/environment/mapstars/whitedwarf/StarDisk_136.png']);
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
        expect(mapStarUrls(star(HabitatType.MainSequence, 3))).toEqual([]);
        expect(starPictureUrls(star(HabitatType.SuperNova, 0, 1))).toEqual([]);
        expect(habitatPictureUrls(habitat(HabitatType.Ocean, 190))).toEqual([]);
        expect(cloudUrls(habitat(HabitatType.Hydrogen, 79))).toEqual([]);
        expect(habitatPictureUrls(habitat(HabitatType.BarrenRock, 249, HabitatCategoryType.Asteroid))).toEqual([]);
    });
});