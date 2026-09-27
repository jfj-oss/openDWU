// Troop unit images. Port of:
//  - Main.Part13.cs:2063 LoadTroops — one Troop_<i>[.png|_Armored.png|_Artillery.png|_SpecialForces.png|
//    _PirateRaider.png] per race slot i (0..raceList.Count-1), loaded into bitmap_23 (Infantry) / bitmap_24
//    (Armored) / bitmap_25 (Artillery) / bitmap_26 (SpecialForces) / bitmap_27 (PirateRaider); a missing
//    type-variant file falls back to the race's own base Troop_<i>.png (bitmap_24[i] = new Bitmap(bitmap_23[i])
//    etc, lines 2108/2124/2140/2156). One extra slot at index `raceList.Count` holds RoboticTroop.png for all
//    five arrays (lines 2163-2178: bitmap_24..27[num] = new Bitmap(bitmap_23[num])).
//  - Galaxy.8.cs:20 GenerateNewTroop: `if (race != null) troop.PictureRef = race.PictureRef;` (races.txt
//    PictureIndex) — the normal case.
//  - Habitat.cs:7159 GenerateNewTroop(isRobotic): `troop.PictureRef = _Galaxy.Races.Count;` (race == null) — one
//    past the last real race slot, matching LoadTroops' extra RoboticTroop.png slot.
//  - InfoPanel.cs:2609 DrawTroopsAgents: `_TroopImagesInfantry[troop.PictureRef]` / …Armored / …Artillery /
//    …SpecialForces / …PirateRaider selected by troop.Type, drawn unscaled at `_ImageSize` (14px; the troop PNGs
//    are native 80x80, so the colony-panel icon ratio is 14/80).
//  - ItemListPanel.cs:1236 (the RecruitTroops ship-action button): the same `bitmap_23[troop.PictureRef]` (etc)
//    lookup for a template troop.

import type { Troop } from '../sim/cargo';
import { TroopType } from '../sim/cargo';

const TROOP_IMAGE_BASE = '/assets/dwu/images/units/troops';
const ROBOTIC_TROOP_URL = `${TROOP_IMAGE_BASE}/RoboticTroop.png`;

/** InfoPanel.cs DrawTroopsAgents: icons are drawn at `_ImageSize` (14px) from native 80x80 art. */
export const TROOP_IMAGE_ICON_RATIO = 14 / 80;

const TROOP_TYPE_SUFFIX: Record<TroopType, string> = {
    [TroopType.Undefined]: '',
    [TroopType.Infantry]: '',
    [TroopType.Armored]: '_Armored',
    [TroopType.Artillery]: '_Artillery',
    [TroopType.SpecialForces]: '_SpecialForces',
    [TroopType.PirateRaider]: '_PirateRaider',
};

export interface TroopImageOptions {
    /** True when this troop's race is shown with the Concord's own (procedural) art in this game
     *  (render/concordArt.ts raceHasConcordArt) — the Oranthi race file borrows Ackdarian's PictureIndex
     *  (tasks/19a-rim-trader.md §2.3) the same way it borrows Ackdarian's DesignsPictureFamilyIndex for ships,
     *  but concordArt.ts deliberately never draws the Concord with Ackdarian's stock ship/portrait/flag art
     *  (raceDisplayOverride). No Concord-specific troop art exists (do not invent it): fall back to the
     *  original's one race-agnostic troop image (RoboticTroop.png) instead of showing Ackdarian troops as the
     *  Concord's own.
     *  TODO(art): Concord troop images — replace this fallback if/when the Concord gets its own troop art. */
    concordArt?: boolean;
}

/** The race/type image a troop is drawn with (Main.Part13.cs LoadTroops + InfoPanel.cs DrawTroopsAgents's
 *  per-type bitmap lookup). `raceCount` is `galaxy.races.length` — pass it explicitly since Troop itself only
 *  carries `pictureRef` (Race.PictureRef, or Races.Count for a robotic troop; Habitat.cs:7159). */
export function troopImageUrl(troop: Pick<Troop, 'type' | 'pictureRef'>, raceCount: number, opts?: TroopImageOptions): string {
    if (troop.pictureRef === raceCount) return ROBOTIC_TROOP_URL; // robotic troop — no race (Habitat.cs:7159)
    if (opts?.concordArt) return ROBOTIC_TROOP_URL;
    const suffix = TROOP_TYPE_SUFFIX[troop.type] ?? '';
    return `${TROOP_IMAGE_BASE}/Troop_${troop.pictureRef}${suffix}.png`;
}

/** The race's own base (Infantry, no suffix) image — LoadTroops' fallback target when a type-variant file is
 *  missing for a race slot (real for the custom slots beyond the stock races, which ship base art only). Used
 *  as the `onerror` fallback URL for an `<img>` built from {@link troopImageUrl}. */
export function troopImageBaseUrl(troop: Pick<Troop, 'pictureRef'>, raceCount: number, opts?: TroopImageOptions): string {
    if (troop.pictureRef === raceCount || opts?.concordArt) return ROBOTIC_TROOP_URL;
    return `${TROOP_IMAGE_BASE}/Troop_${troop.pictureRef}.png`;
}

/**
 * Wires the browser-side equivalent of LoadTroops' load-time fallback chain onto an `<img>` already pointed at
 * {@link troopImageUrl}: a missing type-variant file falls back to the race's own base image, and a missing base
 * image (shouldn't happen for a real race — LoadTroops treats that as a required file and would abort the
 * original) falls back to RoboticTroop.png so the browser never shows a broken-image icon.
 */
export function wireTroopImageFallback(img: HTMLImageElement, troop: Pick<Troop, 'pictureRef'>, raceCount: number, opts?: TroopImageOptions): void {
    img.addEventListener('error', () => {
        const base = troopImageBaseUrl(troop, raceCount, opts);
        if (img.src.endsWith(base)) {
            if (!img.src.endsWith(ROBOTIC_TROOP_URL)) img.src = ROBOTIC_TROOP_URL;
            return;
        }
        img.src = base;
    });
}
