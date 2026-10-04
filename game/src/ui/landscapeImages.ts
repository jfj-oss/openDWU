// Habitat.LandscapePictureRef → the landscape picture (Main.Part12.cs LoadEnvLandscapes, bitmap_29). Used by the
// Galaxy Map (pnlGalaxyMapHabitatPicture, Main.Part10.cs 1807 / Part11.cs 1967-2101), the Intelligence screen
// (CharacterSummary, Galaxy.4.cs SelectCharacterLandscapeImageIndex) and the message popups (MessagePopup.cs 294-307,
// Main.Part4.cs 681-1197). The sim stores the GalaxyImages index itself (sim/galaxy.ts SelectXxxPlanet /
// SelectHabitatPictures, Galaxy.6.cs 1956-2272); saves from before the port are migrated on load
// (sim/galaxyImages.ts migrateLegacyLandscapePictureRef), so the index is used as it is, as bitmap_29[ref].
// LoadEnvLandscapes also appends images/environment/landscapes/other/*.png after the 30 fixed pictures (the stock game
// has no such folder; a theme set may: themeAssets.ts themeOtherLandscapeUrls), bitmap_29[30 + i]. Only the habitat
// editor (scrEditHabitatPictureLandscape, Main.Part5.cs 3778 — not ported) picks one; a habitat whose ref points there
// shows it (refs past the list show nothing). A theme's copies of the 30 come through the DOM URL hook
// (ui/themeUrlHook.ts).
// The race picture on its native landscape (bitmap_29[method_121(race)], Main.Part11.cs method_119 — the diplomacy talk
// panel and the start screens) is ui/raceLandscapePicture.ts.

import { LANDSCAPE_IMAGE_COUNT, LANDSCAPE_IMAGE_FOLDERS } from '../sim/galaxyImages';
import { themeOtherLandscapeUrls } from '../themeAssets';

/** Main.Part12.cs LoadEnvLandscapes: the landscape folders in bitmap_29 order, with their file counts. */
export const LANDSCAPE_FOLDERS: readonly [string, number][] = LANDSCAPE_IMAGE_FOLDERS.map(({ folder, count }) => [folder, count]);

/**
 * Habitat.LandscapePictureRef → bitmap_29[ref]: images/environment/landscapes/<type>/landscape_<i>.png for 0-29, then a
 * theme's landscapes/other/*.png (30 + i); null when none / out of range.
 */
export function landscapeImageUrl(ref: number): string | null {
    if (!Number.isInteger(ref) || ref < 0) return null;
    for (const { folder, offset, count } of LANDSCAPE_IMAGE_FOLDERS) {
        if (ref >= offset && ref < offset + count) return `/assets/dwu/images/environment/landscapes/${folder}/landscape_${ref - offset}.png`;
    }
    if (ref < LANDSCAPE_IMAGE_COUNT) return null;
    return themeOtherLandscapeUrls()[ref - LANDSCAPE_IMAGE_COUNT] ?? null;
}

/** bitmap_29.Length (scrEditHabitatPictureLandscape.Maximum + 1): the 30 fixed landscapes plus a theme's others. */
export function landscapeImageCount(): number {
    return LANDSCAPE_IMAGE_COUNT + themeOtherLandscapeUrls().length;
}
