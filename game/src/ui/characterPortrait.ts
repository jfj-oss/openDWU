// Character pictures: port of DistantWorlds.Types/CharacterImageCache.cs (CacheImage / LoadImage / OverlayRoleIcon /
// GetRoleIcon) as DOM builders. A character's picture is its own file (images/units/characters/<PictureFilename>,
// an empty folder in the base install) or else its race portrait (RaceImages[Race.PictureRef]), with the role icon
// (images/ui/chrome/characterRole_<Role>.png, Main.Part12.cs:715-723 bitmap_3) over the bottom-right corner. The three
// cached sizes: the full image (icon 0.2 of the width, 20 px from the edges), the small 38 px image (0.35, 1 px) and the
// very small 13 px image (0.48, 0 px). Never blank: a missing picture file falls back to the race portrait.

import { CharacterRole, type Character } from '../sim/characters';
import { racePortraitUrl } from './empireEmblem';

export type CharacterImageSize = 'large' | 'small' | 'verySmall';

/** CacheImage: the bitmap size of each cached image (the full one is the source bitmap, a 300 px race picture) and
 *  OverlayRoleIcon's (iconSizeRatio, minimumEdgeOffset). */
export const CHARACTER_IMAGE_SPEC: Record<CharacterImageSize, { bitmap: number; ratio: number; offset: number }> = {
    large: { bitmap: 300, ratio: 0.2, offset: 20 },
    small: { bitmap: 38, ratio: 0.35, offset: 1 },
    verySmall: { bitmap: 13, ratio: 0.48, offset: 0 },
};

/** CharacterImageCache.GetRoleIcon: images/ui/chrome/characterRole_<Role>.png (null for other roles). */
export function roleIconUrl(role: CharacterRole): string | null {
    switch (role) {
        case CharacterRole.Leader:
        case CharacterRole.Ambassador:
        case CharacterRole.ColonyGovernor:
        case CharacterRole.FleetAdmiral:
        case CharacterRole.TroopGeneral:
        case CharacterRole.IntelligenceAgent:
        case CharacterRole.Scientist:
        case CharacterRole.PirateLeader:
        case CharacterRole.ShipCaptain:
            return `/assets/dwu/images/ui/chrome/characterRole_${CharacterRole[role]}.png`;
        default:
            return null;
    }
}

/** CharacterImageCache.LoadImage: images/units/characters/<PictureFilename>, or null without a picture file. */
export function characterPictureFileUrl(c: Character): string | null {
    return c.pictureFilename ? `/assets/dwu/images/units/characters/${c.pictureFilename}` : null;
}

/** CacheImage without a picture file: the race picture (null without a race — the C# blank 200 × 200 bitmap). */
export function characterRaceImageUrl(c: Character): string | null {
    return c.race !== null ? racePortraitUrl(c.race.pictureIndex) : null;
}

/** The picture shown first: the character's own file, else the race portrait. */
export function characterPortraitUrl(c: Character): string | null {
    return characterPictureFileUrl(c) ?? characterRaceImageUrl(c);
}

/** OverlayRoleIcon: the role icon's rect in an `imageSize`-wide image (the icon bitmap is `iconW` × `iconH`, 64 × 64). */
export function roleIconOverlayRect(imageSize: number, iconSizeRatio: number, minimumEdgeOffset: number, iconW = 64, iconH = 64): { x: number; y: number; w: number; h: number } {
    const w = Math.max(1, Math.trunc(imageSize * iconSizeRatio));
    const h = Math.max(1, Math.trunc(iconH * (w / iconW)));
    return { x: imageSize - (w + minimumEdgeOffset), y: imageSize - (h + minimumEdgeOffset), w, h };
}

/** The role icon rect for one of the cached sizes, scaled to a `displaySize` box. */
export function roleIconRectForSize(size: CharacterImageSize, displaySize: number): { x: number; y: number; w: number; h: number } {
    const s = CHARACTER_IMAGE_SPEC[size];
    const r = roleIconOverlayRect(s.bitmap, s.ratio, s.offset);
    const k = displaySize / s.bitmap;
    return { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
}

function img(src: string, style: Partial<CSSStyleDeclaration>): HTMLImageElement {
    const i = document.createElement('img');
    i.src = src;
    i.alt = '';
    i.draggable = false;
    Object.assign(i.style, { position: 'absolute', pointerEvents: 'none', ...style });
    return i;
}

/**
 * The character's picture (ObtainCharacterImage / Small / VerySmall) as a `displaySize` square element: the picture
 * cover-fitted (ResolveDrawFillRectangle) with the role icon overlaid. Position the returned box yourself.
 */
export function characterPortrait(c: Character, size: CharacterImageSize, displaySize: number): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'character-portrait';
    Object.assign(box.style, { position: 'relative', overflow: 'hidden', width: `${displaySize}px`, height: `${displaySize}px`, flex: 'none' });
    const own = characterPictureFileUrl(c);
    const race = characterRaceImageUrl(c);
    const first = own ?? race;
    if (first !== null) {
        const p = img(first, { left: '0', top: '0', width: '100%', height: '100%', objectFit: 'cover' });
        if (own !== null && race !== null) {
            // LoadImage found no file: fall back to the race picture rather than drawing nothing.
            p.addEventListener('error', () => {
                if (p.src.endsWith(race)) return;
                p.src = race;
            });
        }
        box.appendChild(p);
    }
    const icon = roleIconUrl(c.role);
    if (icon !== null) {
        const r = roleIconRectForSize(size, displaySize);
        box.appendChild(img(icon, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }));
    }
    return box;
}
