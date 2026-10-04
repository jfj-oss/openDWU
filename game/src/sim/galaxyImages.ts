// Port of DistantWorlds.Types/GalaxyImages.cs — the habitat and landscape picture index tables.
//
// Habitat.PictureRef (planets, moons, asteroids) is an index into HabitatImageCache's file list
// (HabitatImageCache.cs GenerateHabitatImageFilepaths): HabitatImageOffset* / HabitatImageCount* (GalaxyImages.cs 11-58),
// in the file order of HABITAT_IMAGE_SETS below — 665 fixed pictures (0-664, HabitatImageOffsetOTHER = 665), then a theme
// set's images/environment/planets/other/*.png (render/assets.ts habitatPictureUrls). Stars draw by MapPictureRef
// (MapStarImageOffset* / Count*, the LoadMapStars bitmap_196 order, MAP_STAR_IMAGE_FOLDERS) and gas clouds by their own
// pictures, not this table. (A star's PictureRef is a map-star index too, Galaxy.6.cs SelectHabitatPictures 2214-2237.)
//
// Habitat.LandscapePictureRef is an index into the app's landscape bitmaps (LandscapeImageOffset* /
// LandscapeImageCount*, lines 75-94; Main.Part12.cs LoadEnvLandscapes, bitmap_29), loaded in this order: barrenrock,
// continental, forest, frozengasgiant, gasgiant, iceglacial, marshyswamp, ocean, sandydesert, volcanic — each folder's
// landscape_<i>.png for i < its count — then any images/environment/landscapes/other/*.png (none in the shipped game).
// The offsets are the running sums of the counts, so the shipped table has 30 entries (0-29).
// The C# fields are static readonly constants, not computed from the folder listing.

import { HabitatCategoryType, HabitatType } from './types';

// GalaxyImages.cs 11-58: habitat picture offsets and counts.
export const HabitatImageOffsetBarrenRock = 0;
export const HabitatImageOffsetContinental = 21;
export const HabitatImageOffsetForest = 41;
export const HabitatImageOffsetFrozenGasGiantArgon = 67;
export const HabitatImageOffsetFrozenGasGiantHelium = 77;
export const HabitatImageOffsetFrozenGasGiantKrypton = 87;
export const HabitatImageOffsetFrozenGasGiantTyderios = 98;
export const HabitatImageOffsetFrozenGasGiantAny = 111;
export const HabitatImageOffsetGasGiantArgon = 121;
export const HabitatImageOffsetGasGiantCaslon = 126;
export const HabitatImageOffsetGasGiantHelium = 131;
export const HabitatImageOffsetGasGiantHydrogen = 139;
export const HabitatImageOffsetGasGiantKrypton = 147;
export const HabitatImageOffsetGasGiantAny = 152;
export const HabitatImageOffsetIce = 154;
export const HabitatImageOffsetMarshySwamp = 172;
export const HabitatImageOffsetOcean = 190;
export const HabitatImageOffsetDesert = 204;
export const HabitatImageOffsetVolcanic = 229;
export const HabitatImageOffsetAsteroidsNormal = 249;
export const HabitatImageOffsetAsteroidsIce = 449;
export const HabitatImageOffsetAsteroidsMetal = 549;
export const HabitatImageOffsetAsteroidsGold = 649;
export const HabitatImageOffsetAsteroidsCrystal = 657;
export const HabitatImageOffsetOTHER = 665;
export const HabitatImageCountBarrenRock = 21;
export const HabitatImageCountContinental = 20;
export const HabitatImageCountForest = 26;
export const HabitatImageCountFrozenGasGiantArgon = 10;
export const HabitatImageCountFrozenGasGiantHelium = 10;
export const HabitatImageCountFrozenGasGiantKrypton = 11;
export const HabitatImageCountFrozenGasGiantTyderios = 13;
export const HabitatImageCountFrozenGasGiantAny = 10;
export const HabitatImageCountGasGiantArgon = 5;
export const HabitatImageCountGasGiantCaslon = 5;
export const HabitatImageCountGasGiantHelium = 8;
export const HabitatImageCountGasGiantHydrogen = 8;
export const HabitatImageCountGasGiantKrypton = 5;
export const HabitatImageCountGasGiantAny = 2;
export const HabitatImageCountIce = 18;
export const HabitatImageCountMarshySwamp = 18;
export const HabitatImageCountOcean = 14;
export const HabitatImageCountDesert = 25;
export const HabitatImageCountVolcanic = 20;
export const HabitatImageCountAsteroidsNormal = 200;
export const HabitatImageCountAsteroidsIce = 100;
export const HabitatImageCountAsteroidsMetal = 100;
export const HabitatImageCountAsteroidsGold = 8;
export const HabitatImageCountAsteroidsCrystal = 8;

/** Galaxy.6.cs 2254 / 2270 (and SelectHabitatPictures 2132-2141 / 2182-2191): every frozen gas giant / gas giant picture. */
export const HabitatImageCountFrozenGasGiantAll =
    HabitatImageCountFrozenGasGiantAny + HabitatImageCountFrozenGasGiantArgon + HabitatImageCountFrozenGasGiantHelium + HabitatImageCountFrozenGasGiantKrypton + HabitatImageCountFrozenGasGiantTyderios;
export const HabitatImageCountGasGiantAll =
    HabitatImageCountGasGiantAny + HabitatImageCountGasGiantArgon + HabitatImageCountGasGiantCaslon + HabitatImageCountGasGiantHelium + HabitatImageCountGasGiantHydrogen + HabitatImageCountGasGiantKrypton;

// GalaxyImages.cs 59-71: the map-star picture table (Main.Part13.cs LoadMapStars bitmap_196: mainsequence, redgiant,
// supergiant, whitedwarf, neutron, blackhole — each folder's *.png).
export const MapStarImageCountMainSequence = 6;
export const MapStarImageCountRedGiant = 1;
export const MapStarImageCountSuperGiant = 1;
export const MapStarImageCountWhiteDwarf = 3;
export const MapStarImageCountNeutron = 2;
export const MapStarImageCountBlackHole = 1;
export const MapStarImageOffsetMainSequence = 0;
export const MapStarImageOffsetRedGiant = 6;
export const MapStarImageOffsetSuperGiant = 7;
export const MapStarImageOffsetWhiteDwarf = 8;
export const MapStarImageOffsetNeutron = 11;
export const MapStarImageOffsetBlackHole = 13;

/**
 * Main.Part13.cs LoadMapStars 993-1051: the map-star folders (under images/environment/mapstars/) in bitmap_196 order
 * with their GalaxyImages offset and count. bitmap_196 is the folders' *.png listings concatenated (Directory.GetFiles
 * order); in the shipped install each folder holds exactly its count, so bitmap_196[MapPictureRef] is the
 * (MapPictureRef - offset)-th file of the star type's folder. 14 pictures (0-13).
 */
export const MAP_STAR_IMAGE_FOLDERS: readonly { folder: string; type: HabitatType; offset: number; count: number }[] = [
    { folder: 'mainsequence', type: HabitatType.MainSequence, offset: MapStarImageOffsetMainSequence, count: MapStarImageCountMainSequence },
    { folder: 'redgiant', type: HabitatType.RedGiant, offset: MapStarImageOffsetRedGiant, count: MapStarImageCountRedGiant },
    { folder: 'supergiant', type: HabitatType.SuperGiant, offset: MapStarImageOffsetSuperGiant, count: MapStarImageCountSuperGiant },
    { folder: 'whitedwarf', type: HabitatType.WhiteDwarf, offset: MapStarImageOffsetWhiteDwarf, count: MapStarImageCountWhiteDwarf },
    { folder: 'neutron', type: HabitatType.Neutron, offset: MapStarImageOffsetNeutron, count: MapStarImageCountNeutron },
    { folder: 'blackhole', type: HabitatType.BlackHole, offset: MapStarImageOffsetBlackHole, count: MapStarImageCountBlackHole },
];

/** The number of map-star pictures (bitmap_196 of the shipped install): 14. */
export const MAP_STAR_IMAGE_COUNT = MapStarImageOffsetBlackHole + MapStarImageCountBlackHole;

/**
 * The map-star range Galaxy.6.cs SelectHabitatPictures (2214-2237) gives a star of this type — PictureRef and
 * MapPictureRef are each MapStarImageOffsetX + Rnd.Next(0, MapStarImageCountX) — or null (SuperNova: no draw, the
 * SelectStar values PictureRef 0 / MapPictureRef 0 stay; not a star type).
 */
export function mapStarImageRangeOfType(type: HabitatType): readonly [offset: number, count: number] | null {
    const f = MAP_STAR_IMAGE_FOLDERS.find((x) => x.type === type);
    return f === undefined ? null : [f.offset, f.count];
}

/**
 * Galaxy.4.cs GenerateGasCloud 2923-2947 (and the (type, x, y) overload 3040-3064): a gas cloud's MapPictureRef by
 * its type, 16-23 (the C# literals; no GalaxyImages constant, not a bitmap_196 index — the app draws clouds from
 * their own art). 0 for any other type (the byte default).
 */
export function gasCloudMapPictureRef(type: HabitatType): number {
    switch (type) {
        case HabitatType.Ammonia: return 16;
        case HabitatType.Argon: return 17;
        case HabitatType.CarbonDioxide: return 18;
        case HabitatType.Chlorine: return 19;
        case HabitatType.Helium: return 20;
        case HabitatType.Hydrogen: return 21;
        case HabitatType.NitrogenOxygen: return 22;
        case HabitatType.Oxygen: return 23;
        default: return 0;
    }
}

/**
 * HabitatImageCache.cs GenerateHabitatImageFilepaths 296-343: the habitat pictures in index order — `count` files
 * `<folder>/<prefix>-<i:0000>.png` (i = 1..count) per set, folder relative to images/environment/. The offsets are the
 * GalaxyImages constants (each the running sum of the counts before it).
 */
export const HABITAT_IMAGE_SETS: readonly { folder: string; prefix: string; offset: number; count: number }[] = [
    { folder: 'planets/barrenrock', prefix: 'Barren', offset: HabitatImageOffsetBarrenRock, count: HabitatImageCountBarrenRock },
    { folder: 'planets/continental', prefix: 'Continental', offset: HabitatImageOffsetContinental, count: HabitatImageCountContinental },
    { folder: 'planets/forest', prefix: 'Forest', offset: HabitatImageOffsetForest, count: HabitatImageCountForest },
    { folder: 'planets/frozengasgiant', prefix: 'FrozenGasAr', offset: HabitatImageOffsetFrozenGasGiantArgon, count: HabitatImageCountFrozenGasGiantArgon },
    { folder: 'planets/frozengasgiant', prefix: 'FrozenGasHe', offset: HabitatImageOffsetFrozenGasGiantHelium, count: HabitatImageCountFrozenGasGiantHelium },
    { folder: 'planets/frozengasgiant', prefix: 'FrozenGasKr', offset: HabitatImageOffsetFrozenGasGiantKrypton, count: HabitatImageCountFrozenGasGiantKrypton },
    { folder: 'planets/frozengasgiant', prefix: 'FrozenGasTy', offset: HabitatImageOffsetFrozenGasGiantTyderios, count: HabitatImageCountFrozenGasGiantTyderios },
    { folder: 'planets/frozengasgiant', prefix: 'FrozenGasOt', offset: HabitatImageOffsetFrozenGasGiantAny, count: HabitatImageCountFrozenGasGiantAny },
    { folder: 'planets/gasgiant', prefix: 'GasGiantAr', offset: HabitatImageOffsetGasGiantArgon, count: HabitatImageCountGasGiantArgon },
    { folder: 'planets/gasgiant', prefix: 'GasGiantCa', offset: HabitatImageOffsetGasGiantCaslon, count: HabitatImageCountGasGiantCaslon },
    { folder: 'planets/gasgiant', prefix: 'GasGiantHe', offset: HabitatImageOffsetGasGiantHelium, count: HabitatImageCountGasGiantHelium },
    { folder: 'planets/gasgiant', prefix: 'GasGiantHy', offset: HabitatImageOffsetGasGiantHydrogen, count: HabitatImageCountGasGiantHydrogen },
    { folder: 'planets/gasgiant', prefix: 'GasGiantKr', offset: HabitatImageOffsetGasGiantKrypton, count: HabitatImageCountGasGiantKrypton },
    { folder: 'planets/gasgiant', prefix: 'GasGiantOt', offset: HabitatImageOffsetGasGiantAny, count: HabitatImageCountGasGiantAny },
    { folder: 'planets/iceglacial', prefix: 'Glacial', offset: HabitatImageOffsetIce, count: HabitatImageCountIce },
    { folder: 'planets/marshyswamp', prefix: 'Marsh', offset: HabitatImageOffsetMarshySwamp, count: HabitatImageCountMarshySwamp },
    { folder: 'planets/ocean', prefix: 'Ocean', offset: HabitatImageOffsetOcean, count: HabitatImageCountOcean },
    { folder: 'planets/sandydesert', prefix: 'Desert', offset: HabitatImageOffsetDesert, count: HabitatImageCountDesert },
    { folder: 'planets/volcanic', prefix: 'Volcanic', offset: HabitatImageOffsetVolcanic, count: HabitatImageCountVolcanic },
    { folder: 'asteroids/rocky', prefix: 'AstRck', offset: HabitatImageOffsetAsteroidsNormal, count: HabitatImageCountAsteroidsNormal },
    { folder: 'asteroids/ice', prefix: 'AstIce', offset: HabitatImageOffsetAsteroidsIce, count: HabitatImageCountAsteroidsIce },
    { folder: 'asteroids/metal', prefix: 'AstMtl', offset: HabitatImageOffsetAsteroidsMetal, count: HabitatImageCountAsteroidsMetal },
    { folder: 'asteroids/metal', prefix: 'AstGold', offset: HabitatImageOffsetAsteroidsGold, count: HabitatImageCountAsteroidsGold },
    { folder: 'asteroids/metal', prefix: 'AstCryst', offset: HabitatImageOffsetAsteroidsCrystal, count: HabitatImageCountAsteroidsCrystal },
];

/** The number of fixed habitat pictures (HabitatImageCache without a theme's planets/other images): 665. */
export const HABITAT_IMAGE_COUNT = HabitatImageOffsetOTHER;

/** HabitatImageCache.ResolveImageFilename for a fixed picture: `<folder>/<file>` under images/environment/, or null. */
export function habitatImageFile(pictureRef: number): string | null {
    if (!Number.isInteger(pictureRef) || pictureRef < 0 || pictureRef >= HABITAT_IMAGE_COUNT) return null;
    for (const { folder, prefix, offset, count } of HABITAT_IMAGE_SETS) {
        if (pictureRef >= offset && pictureRef < offset + count) return `${folder}/${prefix}-${String(pictureRef - offset + 1).padStart(4, '0')}.png`;
    }
    return null;
}

/**
 * The GalaxyImages picture range Galaxy.6.cs gives a habitat of this category and type: [offset, count] of
 * SelectHabitatPictures (asteroids: AsteroidsNormal / Ice / Metal; Continental with Forest; gas giants every set), plus
 * the treasure asteroids' gold and crystal (Galaxy.9.cs GenerateTreasureAsteroid) for Metal. Null for stars, gas clouds
 * and types without pictures. (Metal asteroids: AsteroidsMetal, Gold and Crystal are contiguous, 549-664.)
 */
export function habitatImageRangeOf(category: HabitatCategoryType, type: HabitatType): readonly [offset: number, count: number] | null {
    if (category === HabitatCategoryType.Asteroid) {
        switch (type) {
            case HabitatType.Ice:
                return [HabitatImageOffsetAsteroidsIce, HabitatImageCountAsteroidsIce];
            case HabitatType.Metal:
                return [HabitatImageOffsetAsteroidsMetal, HabitatImageCountAsteroidsMetal + HabitatImageCountAsteroidsGold + HabitatImageCountAsteroidsCrystal];
            default:
                return [HabitatImageOffsetAsteroidsNormal, HabitatImageCountAsteroidsNormal];
        }
    }
    if (category !== HabitatCategoryType.Planet && category !== HabitatCategoryType.Moon) return null;
    switch (type) {
        case HabitatType.BarrenRock: return [HabitatImageOffsetBarrenRock, HabitatImageCountBarrenRock];
        case HabitatType.Continental: return [HabitatImageOffsetContinental, HabitatImageCountContinental + HabitatImageCountForest];
        case HabitatType.FrozenGasGiant: return [HabitatImageOffsetFrozenGasGiantArgon, HabitatImageCountFrozenGasGiantAll];
        case HabitatType.GasGiant: return [HabitatImageOffsetGasGiantArgon, HabitatImageCountGasGiantAll];
        case HabitatType.Ice: return [HabitatImageOffsetIce, HabitatImageCountIce];
        case HabitatType.MarshySwamp: return [HabitatImageOffsetMarshySwamp, HabitatImageCountMarshySwamp];
        case HabitatType.Ocean: return [HabitatImageOffsetOcean, HabitatImageCountOcean];
        case HabitatType.Desert: return [HabitatImageOffsetDesert, HabitatImageCountDesert];
        case HabitatType.Volcanic: return [HabitatImageOffsetVolcanic, HabitatImageCountVolcanic];
        default: return null;
    }
}

export const LandscapeImageOffsetBarrenRock = 0;
export const LandscapeImageOffsetContinental = 4;
export const LandscapeImageOffsetForest = 8;
export const LandscapeImageOffsetFrozenGasGiant = 9;
export const LandscapeImageOffsetGasGiant = 11;
export const LandscapeImageOffsetIce = 17;
export const LandscapeImageOffsetMarshySwamp = 20;
export const LandscapeImageOffsetOcean = 23;
export const LandscapeImageOffsetDesert = 25;
export const LandscapeImageOffsetVolcanic = 28;
export const LandscapeImageCountBarrenRock = 4;
export const LandscapeImageCountContinental = 4;
export const LandscapeImageCountForest = 1;
export const LandscapeImageCountFrozenGasGiant = 2;
export const LandscapeImageCountGasGiant = 6;
export const LandscapeImageCountIce = 3;
export const LandscapeImageCountMarshySwamp = 3;
export const LandscapeImageCountOcean = 2;
export const LandscapeImageCountDesert = 3;
export const LandscapeImageCountVolcanic = 2;

/**
 * Main.Part12.cs LoadEnvLandscapes 228-285: the landscape folders in bitmap_29 order with their GalaxyImages offset and
 * count (the file is `<folder>/landscape_<i>.png`, i < count).
 */
export const LANDSCAPE_IMAGE_FOLDERS: readonly { folder: string; offset: number; count: number }[] = [
    { folder: 'barrenrock', offset: LandscapeImageOffsetBarrenRock, count: LandscapeImageCountBarrenRock },
    { folder: 'continental', offset: LandscapeImageOffsetContinental, count: LandscapeImageCountContinental },
    { folder: 'forest', offset: LandscapeImageOffsetForest, count: LandscapeImageCountForest },
    { folder: 'frozengasgiant', offset: LandscapeImageOffsetFrozenGasGiant, count: LandscapeImageCountFrozenGasGiant },
    { folder: 'gasgiant', offset: LandscapeImageOffsetGasGiant, count: LandscapeImageCountGasGiant },
    { folder: 'iceglacial', offset: LandscapeImageOffsetIce, count: LandscapeImageCountIce },
    { folder: 'marshyswamp', offset: LandscapeImageOffsetMarshySwamp, count: LandscapeImageCountMarshySwamp },
    { folder: 'ocean', offset: LandscapeImageOffsetOcean, count: LandscapeImageCountOcean },
    { folder: 'sandydesert', offset: LandscapeImageOffsetDesert, count: LandscapeImageCountDesert },
    { folder: 'volcanic', offset: LandscapeImageOffsetVolcanic, count: LandscapeImageCountVolcanic },
];

/** The number of fixed landscape bitmaps (bitmap_29 without the optional landscapes/other images): 30. */
export const LANDSCAPE_IMAGE_COUNT = LandscapeImageOffsetVolcanic + LandscapeImageCountVolcanic;

// --- Save migration (our save format, no C# counterpart).
// Saves written before the faithful port stored a placeholder LandscapePictureRef: <hundreds> + Rnd.Next(0, 10), the
// hundreds naming the planet type the SelectXxxPlanet / SelectHabitatPictures call drew it for. Each maps to that
// type's GalaxyImages range; the placeholder's tenth (the same Rnd sample, scaled by 10) is scaled to the type's count
// — the picture the C#'s Rnd.Next(0, count) of that sample gives, to within one picture, and the same picture the UI
// showed for it before the port.
const LEGACY_PLACEHOLDER_LANDSCAPES: ReadonlyMap<number, readonly [offset: number, count: number]> = new Map([
    [200, [LandscapeImageOffsetBarrenRock, LandscapeImageCountBarrenRock]],
    [400, [LandscapeImageOffsetContinental, LandscapeImageCountContinental]],
    [600, [LandscapeImageOffsetIce, LandscapeImageCountIce]],
    [800, [LandscapeImageOffsetMarshySwamp, LandscapeImageCountMarshySwamp]],
    [1000, [LandscapeImageOffsetOcean, LandscapeImageCountOcean]],
    [1200, [LandscapeImageOffsetDesert, LandscapeImageCountDesert]],
    [1400, [LandscapeImageOffsetVolcanic, LandscapeImageCountVolcanic]],
    [1600, [LandscapeImageOffsetGasGiant, LandscapeImageCountGasGiant]],
    [1800, [LandscapeImageOffsetFrozenGasGiant, LandscapeImageCountFrozenGasGiant]],
]);

/** The GalaxyImages landscape range of a habitat type (Galaxy.6.cs SelectHabitatPictures), or null for none. */
export function landscapeImageRangeOfType(type: HabitatType): readonly [offset: number, count: number] | null {
    switch (type) {
        case HabitatType.BarrenRock: return [LandscapeImageOffsetBarrenRock, LandscapeImageCountBarrenRock];
        case HabitatType.Continental: return [LandscapeImageOffsetContinental, LandscapeImageCountContinental];
        case HabitatType.Ice: return [LandscapeImageOffsetIce, LandscapeImageCountIce];
        case HabitatType.MarshySwamp: return [LandscapeImageOffsetMarshySwamp, LandscapeImageCountMarshySwamp];
        case HabitatType.Ocean: return [LandscapeImageOffsetOcean, LandscapeImageCountOcean];
        case HabitatType.Desert: return [LandscapeImageOffsetDesert, LandscapeImageCountDesert];
        case HabitatType.Volcanic: return [LandscapeImageOffsetVolcanic, LandscapeImageCountVolcanic];
        case HabitatType.GasGiant: return [LandscapeImageOffsetGasGiant, LandscapeImageCountGasGiant];
        case HabitatType.FrozenGasGiant: return [LandscapeImageOffsetFrozenGasGiant, LandscapeImageCountFrozenGasGiant];
        default: return null;
    }
}

/**
 * A saved LandscapePictureRef as a faithful GalaxyImages index. In-range refs (-1 = none, 0-29) are returned as they
 * are; a pre-port placeholder (200-1809, see LEGACY_PLACEHOLDER_LANDSCAPES) maps into its planet type's range; any
 * other out-of-range value falls back to the first picture of the habitat's own type (-1 when the type has none).
 */
export function migrateLegacyLandscapePictureRef(ref: number, type: HabitatType): number {
    if (ref === -1 || (Number.isInteger(ref) && ref >= 0 && ref < LANDSCAPE_IMAGE_COUNT)) return ref;
    if (Number.isInteger(ref) && ref > 0) {
        const base = Math.trunc(ref / 100) * 100;
        const range = LEGACY_PLACEHOLDER_LANDSCAPES.get(base);
        const tenth = ref - base;
        if (range !== undefined && tenth < 10) return range[0] + Math.min(range[1] - 1, Math.trunc(((tenth + 0.5) * range[1]) / 10));
    }
    const own = landscapeImageRangeOfType(type);
    return own === null ? -1 : own[0];
}

// --- PictureRef save migration (our save format, no C# counterpart).
// Saves written before the faithful port (they lack GalaxySaveJSON.habitatPictureRefs) stored placeholder
// Habitat.PictureRef values — <hundreds> + Rnd.Next(0, 10) per planet type (100 barren rock … 1700 frozen gas giant,
// 2000 / 2100 / 2200 asteroids), and GalaxyImages values for the gas giants and treasure asteroids — and the renderer
// showed file `ref mod n` of the type's install folder (render/assets.ts pickFromFolder over the asset manifest's sorted
// listing: planets/<type>/ for planets and moons, asteroids/rocky|ice|metal/ for asteroids). Old and new values overlap
// (e.g. 100-109 is a pre-port barren rock but a faithful frozen gas giant), so the save version, not the value, says
// which kind a save holds. A pre-port ref becomes the GalaxyImages index of the very file the old renderer showed; the
// install folders also hold files outside the C# table (e.g. Barren-0022, VolcanicG-*, the FrozenGas-Ar01 set), which
// no index names, and those go to the habitat's own C# range, offset + (folder position mod count).

/**
 * The stock install's folder listings in the old renderer's order (scripts/gen-asset-manifest.mjs: Windows order,
 * case-insensitive ordinal), each file as its GalaxyImages index or -1 (not in the C# table), run-length encoded as
 * [first index or -1, run length] (consecutive indices). Checked against the install by test/habitatPictureRefs.test.ts.
 */
export const PRE_PORT_HABITAT_FOLDERS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
    'planets/barrenrock': [[0, 21], [-1, 5]],
    'planets/continental': [[21, 20], [-1, 2]],
    'planets/frozengasgiant': [[-1, 55], [67, 31], [111, 10], [98, 13]],
    'planets/gasgiant': [[-1, 33], [121, 33]],
    'planets/iceglacial': [[154, 18], [-1, 5]],
    'planets/marshyswamp': [[172, 18], [-1, 4]],
    'planets/ocean': [[190, 14], [-1, 5]],
    'planets/sandydesert': [[204, 25], [-1, 5]],
    'planets/volcanic': [[229, 20], [-1, 26]],
    'asteroids/rocky': [[249, 200]],
    'asteroids/ice': [[449, 100]],
    'asteroids/metal': [[657, 8], [649, 8], [549, 100]],
};

/** The old renderer's folder for a habitat (render/assets.ts planetUrls / asteroidUrls before the port), or null. */
export function prePortHabitatFolder(category: HabitatCategoryType, type: HabitatType): string | null {
    if (category === HabitatCategoryType.Asteroid) {
        return type === HabitatType.Ice ? 'asteroids/ice' : type === HabitatType.Metal ? 'asteroids/metal' : 'asteroids/rocky';
    }
    if (category !== HabitatCategoryType.Planet && category !== HabitatCategoryType.Moon) return null;
    switch (type) {
        case HabitatType.Volcanic: return 'planets/volcanic';
        case HabitatType.Desert: return 'planets/sandydesert';
        case HabitatType.MarshySwamp: return 'planets/marshyswamp';
        case HabitatType.Continental: return 'planets/continental';
        case HabitatType.BarrenRock: return 'planets/barrenrock';
        case HabitatType.Ice: return 'planets/iceglacial';
        case HabitatType.GasGiant: return 'planets/gasgiant';
        case HabitatType.FrozenGasGiant: return 'planets/frozengasgiant';
        default: return 'planets/ocean'; // PLANET_FOLDERS[type] ?? 'ocean'
    }
}

const prePortListings = new Map<string, number[]>();
function prePortListing(folder: string): number[] {
    let list = prePortListings.get(folder);
    if (list === undefined) {
        list = [];
        for (const [first, run] of PRE_PORT_HABITAT_FOLDERS[folder]) for (let i = 0; i < run; i++) list.push(first < 0 ? -1 : first + i);
        prePortListings.set(folder, list);
    }
    return list;
}

/**
 * A pre-port save's Habitat.PictureRef as the GalaxyImages index of the picture the old renderer showed for it (see
 * above); stars and gas clouds (drawn from their own tables, unchanged by the port) keep their ref.
 */
export function migratePrePortPictureRef(ref: number, category: HabitatCategoryType, type: HabitatType): number {
    const folder = prePortHabitatFolder(category, type);
    if (folder === null || !Number.isInteger(ref)) return ref;
    const list = prePortListing(folder);
    const i = ((ref % list.length) + list.length) % list.length; // pickFromFolder
    if (list[i] >= 0) return list[i];
    const range = habitatImageRangeOf(category, type) ?? [HabitatImageOffsetOcean, HabitatImageCountOcean];
    return range[0] + (i % range[1]);
}

// --- MapPictureRef save migration (our save format, no C# counterpart).
// Saves written before Habitat.MapPictureRef was ported (they lack GalaxySaveJSON.habitatMapPictureRefs) have no
// MapPictureRef at all, and their stars keep SelectStar's PictureRef (83 / 84 main sequence, 85 red giant, 86 super
// giant, 87 white dwarf, 88 neutron, 95 black hole, 0 super nova): the port's SetupSun never made the
// SelectHabitatPictures(star) call. The old renderer showed a star's map picture as file `PictureRef mod n` of its
// type's mapstars/<type>/ folder (render/assets.ts mapStarUrls → pickFromFolder over the manifest listing); in
// bitmap_196 that file is MapStarImageOffset<Type> + (PictureRef mod MapStarImageCount<Type>) — the folder counts of
// the shipped install — so each star keeps the very picture it showed. A super nova gets SelectStar's 0 (its
// SelectHabitatPictures case draws nothing), a gas cloud GenerateGasCloud's 16-23, any other habitat the byte default 0.

/** A pre-MapPictureRef save's habitat as the MapPictureRef the port now stores (see above). */
export function migratePreMapPictureRef(category: HabitatCategoryType, type: HabitatType, pictureRef: number): number {
    if (category === HabitatCategoryType.GasCloud) return gasCloudMapPictureRef(type);
    if (category !== HabitatCategoryType.Star) return 0;
    const range = mapStarImageRangeOfType(type);
    if (range === null) return 0; // SuperNova (SelectStar mapPictureRef = 0)
    const ref = Number.isInteger(pictureRef) ? pictureRef : 0;
    return range[0] + (((ref % range[1]) + range[1]) % range[1]);
}
