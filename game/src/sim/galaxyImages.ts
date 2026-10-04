// Port of DistantWorlds.Types/GalaxyImages.cs — the landscape picture index table (LandscapeImageOffset* /
// LandscapeImageCount*, lines 75-94). Habitat.LandscapePictureRef is an index into the app's landscape bitmaps
// (Main.Part12.cs LoadEnvLandscapes, bitmap_29), loaded in this order: barrenrock, continental, forest,
// frozengasgiant, gasgiant, iceglacial, marshyswamp, ocean, sandydesert, volcanic — each folder's landscape_<i>.png for
// i < its count — then any images/environment/landscapes/other/*.png (none in the shipped game). The offsets are the
// running sums of the counts, so the shipped table has 30 entries (0-29).
// The C# fields are static readonly constants, not computed from the folder listing.

import { HabitatType } from './types';

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
