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

/** GalaxyImages.cs LandscapeImageOffset* / LandscapeImageCount* keyed by the placeholder hundreds the sim's planet
 * selectors store (sim/galaxy.ts SelectXxxPlanet: 200 + Rnd.Next(0, 10), 400 + …). */
const PLACEHOLDER_LANDSCAPES: Readonly<Record<number, readonly [number, number]>> = {
    200: [0, 4], // BarrenRock
    400: [4, 4], // Continental
    600: [17, 3], // Ice
    800: [20, 3], // MarshySwamp
    1000: [23, 2], // Ocean
    1200: [25, 3], // Desert
    1400: [28, 2], // Volcanic
    1600: [11, 6], // GasGiant
    1800: [9, 2], // FrozenGasGiant
};

/**
 * A habitat's LandscapePictureRef as a bitmap_29 index. Galaxy.6.cs 1969-2059 picks GalaxyImages
 * LandscapeImageOffsetX + Rnd.Next(0, LandscapeImageCountX); the sim's generation still stores a placeholder
 * (hundreds + Rnd.Next(0, 10)) for most planet types, so those map to the type's range here, the sample's tenth
 * scaled to the type's count (the original's Rnd.Next(0, count) of the same sample, to within a picture).
 * TODO(port): store the GalaxyImages index in sim/galaxy.ts SelectXxxPlanet (Galaxy.6.cs 1969-2059) — a sim change.
 */
export function resolveLandscapeRef(ref: number): number {
    if (!Number.isInteger(ref) || ref < 0) return -1;
    if (ref < 30) return ref;
    const base = Math.trunc(ref / 100) * 100;
    const r = PLACEHOLDER_LANDSCAPES[base];
    if (r === undefined) return -1;
    const tenth = (ref - base) % 10;
    return r[0] + Math.min(r[1] - 1, Math.trunc(((tenth + 0.5) * r[1]) / 10));
}

/** The landscape picture of a LandscapePictureRef, placeholder refs included (resolveLandscapeRef). */
export function habitatLandscapeImageUrl(ref: number): string | null {
    return landscapeImageUrl(resolveLandscapeRef(ref));
}
