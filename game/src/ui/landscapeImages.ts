// Habitat.LandscapePictureRef → the landscape picture (Main.Part12.cs LoadEnvLandscapes, bitmap_29). Used by the
// Intelligence screen, the message popups and the Galaxy Map (pnlGalaxyMapHabitatPicture).

/** Main.Part12.cs LoadEnvLandscapes: the landscape bitmaps in GalaxyImages LandscapeImageOffset order. */
export const LANDSCAPE_FOLDERS: readonly [string, number][] = [
    ['barrenrock', 4],
    ['continental', 4],
    ['forest', 1],
    ['frozengasgiant', 2],
    ['gasgiant', 6],
    ['iceglacial', 3],
    ['marshyswamp', 3],
    ['ocean', 2],
    ['sandydesert', 3],
    ['volcanic', 2],
];

/** Habitat.LandscapePictureRef → images/environment/landscapes/<type>/landscape_<i>.png; null when out of range. */
export function landscapeImageUrl(ref: number): string | null {
    if (!Number.isInteger(ref) || ref < 0) return null;
    let i = ref;
    for (const [folder, count] of LANDSCAPE_FOLDERS) {
        if (i < count) return `/assets/dwu/images/environment/landscapes/${folder}/landscape_${i}.png`;
        i -= count;
    }
    return null;
}
