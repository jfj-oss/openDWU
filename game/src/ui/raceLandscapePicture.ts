// Port of Main.Part11.cs method_118 / method_119 / method_120 / method_121: a race's picture composed on its native
// planet's landscape, inside the panel frame. method_119(empire, race, width, height, frame, inset, pirate,
// piratePlayStyle) draws into a width × height bitmap, nothing when race is null, else:
//   1. the backdrop — bitmap_29[method_121(race)] (the native type's landscape, LandscapeImageOffset<Type> +
//      race.PictureRef % LandscapeImageCount<Type>), or bitmap_189 (images/ui/chrome/storyEvent.jpg) for a pirate —
//      cover-scaled (method_120) into the inner (width - 2·inset) × (height - 2·inset) box, offset by the inset (the
//      overflow is clipped only by the bitmap's own edges);
//   2. the portrait, cover-scaled the same way: an empire's GetEmpireDominantRaceImage(alternate, else normal) — a pirate
//      faction's playstyle image; else for a pirate start with a playstyle GetPirateImage(style) (else the race's); else
//      the race's alternate image (race_<i>a.png), else its normal one (RaceImageCache, Main.Part13.cs LoadRacesImg);
//   3. the frame (bitmap_31, images/ui/chrome/panelframe.png) stretched over the whole bitmap.
// Callers (all ported here): the diplomacy talk panel's race picture (Main.Part8.cs 499 / 564 / 666, 280 × 280, inset
// 7, pirate = the faction is a pirate), the new-game "Your Race" picture (Start.1.cs 4189, 300 × 300, inset 6), the
// Jump Start race picture (Start.cs 5152, 160 × 160, inset 6) and the pirate playstyle pictures (Start.2.cs 3191 / 3201,
// 160 × 160 / 300 × 300, inset 6, pirate). The Galaxy Map's landscape (pnlGalaxyMapHabitatPicture) is the habitat's
// own bitmap_29[LandscapePictureRef] alone (Main.Part10.cs 1809 / Part11.cs 1969-2101, ui/screens/galaxyMap.ts).
import type { Empire } from '../sim/empire';
import { PiratePlayStyle } from '../sim/pirates';
import { HabitatType } from '../sim/types';
import {
    LandscapeImageCountBarrenRock,
    LandscapeImageCountContinental,
    LandscapeImageCountDesert,
    LandscapeImageCountIce,
    LandscapeImageCountMarshySwamp,
    LandscapeImageCountOcean,
    LandscapeImageCountVolcanic,
    LandscapeImageOffsetBarrenRock,
    LandscapeImageOffsetContinental,
    LandscapeImageOffsetDesert,
    LandscapeImageOffsetIce,
    LandscapeImageOffsetMarshySwamp,
    LandscapeImageOffsetOcean,
    LandscapeImageOffsetVolcanic,
} from '../sim/galaxyImages';
import { landscapeImageUrl } from './landscapeImages';

const RACES = '/assets/dwu/images/units/races/';
/** bitmap_189 (Main.Part12.cs 636). */
export const STORY_EVENT_URL = '/assets/dwu/images/ui/chrome/storyEvent.jpg';
/** bitmap_31 (Main.Part12.cs 675). */
export const PANEL_FRAME_URL = '/assets/dwu/images/ui/chrome/panelframe.png';

/** The race fields method_119 / method_121 read (races.txt PictureIndex = Race.PictureRef, NativePlanetType). */
export interface RaceLike {
    pictureIndex: number;
    nativeHabitatType: HabitatType;
}

/** Main.Part11.cs 420 method_121: the race's native landscape, LandscapeImageOffset<Type> + PictureRef % Count; 0 else. */
export function raceNativeLandscapeRef(race: RaceLike | null): number {
    if (race === null) return 0;
    const p = race.pictureIndex;
    switch (race.nativeHabitatType) {
        case HabitatType.Volcanic: return LandscapeImageOffsetVolcanic + (p % LandscapeImageCountVolcanic);
        case HabitatType.Desert: return LandscapeImageOffsetDesert + (p % LandscapeImageCountDesert);
        case HabitatType.MarshySwamp: return LandscapeImageOffsetMarshySwamp + (p % LandscapeImageCountMarshySwamp);
        case HabitatType.Continental: return LandscapeImageOffsetContinental + (p % LandscapeImageCountContinental);
        case HabitatType.Ocean: return LandscapeImageOffsetOcean + (p % LandscapeImageCountOcean);
        case HabitatType.BarrenRock: return LandscapeImageOffsetBarrenRock + (p % LandscapeImageCountBarrenRock);
        case HabitatType.Ice: return LandscapeImageOffsetIce + (p % LandscapeImageCountIce);
        default: return 0;
    }
}

/** Main.Part11.cs 410 method_120: a w × h image cover-scaled into a boxW × boxH box, centred (integer GDI rectangle). */
export function coverRect(w: number, h: number, boxW: number, boxH: number): { x: number; y: number; w: number; h: number } {
    const scale = Math.max(boxW / w, boxH / h);
    const sw = Math.trunc(w * scale);
    const sh = Math.trunc(h * scale);
    return { x: Math.trunc((boxW - sw) / 2), y: Math.trunc((boxH - sh) / 2), w: sw, h: sh };
}

/** RaceImageCache.GetPirateImage / the pirate index (balanced, raider, mercenary, smuggler — LoadRacesImg 2224). */
function pirateImageUrl(style: PiratePlayStyle, alternate: boolean): string {
    const file = style === PiratePlayStyle.Pirate ? 'raider' : style === PiratePlayStyle.Mercenary ? 'mercenary' : style === PiratePlayStyle.Smuggler ? 'smuggler' : 'balanced';
    return `${RACES}pirates/${file}${alternate ? '_a' : ''}.png`;
}

/** RaceImageCache.GetRaceImage(pictureRef, alternate): race_<i>a.png / race_<i>.png. */
function raceImageUrl(pictureIndex: number, alternate: boolean): string {
    return `${RACES}race_${pictureIndex}${alternate ? 'a' : ''}.png`;
}

/** The layers method_119 draws, in order (null / [] when it draws nothing). */
export interface RacePicturePlan {
    width: number;
    height: number;
    inset: number;
    backdrop: string | null;
    /** The portrait candidates: the first that loads (the C#'s null-image fallbacks). */
    portrait: string[];
    frame: string | null;
}

export interface RacePictureOptions {
    /** empire_5: the talk panel's empire (its dominant race image); null on the start screens. */
    empire: Empire | null;
    /** race_1: the race (an empire's DominantRace); null draws nothing. */
    race: RaceLike | null;
    width: number;
    height: number;
    inset: number;
    /** bool_28: the storyEvent.jpg backdrop instead of the native landscape (a pirate). */
    pirate: boolean;
    /** piratePlayStyle_0 (start screens only; Undefined = none). */
    piratePlayStyle?: PiratePlayStyle;
}

/** Main.Part11.cs 347 method_119 as data: what it draws for these arguments (the frame is always bitmap_31 here). */
export function racePicturePlan(o: RacePictureOptions): RacePicturePlan {
    const plan: RacePicturePlan = { width: o.width, height: o.height, inset: o.inset, backdrop: null, portrait: [], frame: null };
    if (o.race === null) return plan;
    plan.backdrop = o.pirate ? STORY_EVENT_URL : landscapeImageUrl(raceNativeLandscapeRef(o.race));
    const style = o.piratePlayStyle ?? PiratePlayStyle.Undefined;
    if (o.empire !== null) {
        // GetEmpireDominantRaceImage(empire, useAlternate: true), else (useAlternate: false); a pirate faction's playstyle image.
        if (o.empire.pirateEmpireBaseHabitat !== null) plan.portrait = [pirateImageUrl(o.empire.piratePlayStyle, true), pirateImageUrl(o.empire.piratePlayStyle, false)];
        else if (o.empire.dominantRace != null) plan.portrait = [raceImageUrl(o.empire.dominantRace.pictureIndex, true), raceImageUrl(o.empire.dominantRace.pictureIndex, false)];
    } else if (o.pirate && style !== PiratePlayStyle.Undefined) {
        plan.portrait = [pirateImageUrl(style, false), raceImageUrl(o.race.pictureIndex, true), raceImageUrl(o.race.pictureIndex, false)];
    } else {
        plan.portrait = [raceImageUrl(o.race.pictureIndex, true), raceImageUrl(o.race.pictureIndex, false)];
    }
    plan.frame = PANEL_FRAME_URL;
    return plan;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url; // the theme URL hook (ui/themeUrlHook.ts) swaps in a theme's copy
    });
}

async function loadFirstImage(urls: readonly string[]): Promise<HTMLImageElement | null> {
    for (const u of urls) {
        const img = await loadImage(u);
        if (img !== null) return img;
    }
    return null;
}

/**
 * method_119's bitmap as a canvas (plan.width × plan.height CSS px; drawn once its pictures have loaded). `portrait`
 * replaces the plan's portrait candidates (a scenario's emblem override of the race picture, empireEmblem.ts).
 */
export function racePictureCanvas(plan: RacePicturePlan, className = '', portrait?: Promise<readonly string[]>): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    if (className !== '') canvas.className = className;
    const dpr = Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
    canvas.width = plan.width * dpr;
    canvas.height = plan.height * dpr;
    canvas.style.width = `${plan.width}px`;
    canvas.style.height = `${plan.height}px`;
    if (plan.backdrop === null && plan.portrait.length === 0) return canvas;
    void (async () => {
        const [back, face, frame] = await Promise.all([
            plan.backdrop !== null ? loadImage(plan.backdrop) : Promise.resolve(null),
            (portrait ?? Promise.resolve(plan.portrait)).then((urls) => loadFirstImage(urls.length > 0 ? urls : plan.portrait)),
            plan.frame !== null ? loadImage(plan.frame) : Promise.resolve(null),
        ]);
        const ctx = canvas.getContext('2d');
        if (ctx === null) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high'; // okQtJmsUqH: HighQualityBicubic
        const innerW = plan.width - plan.inset * 2;
        const innerH = plan.height - plan.inset * 2;
        for (const img of [back, face]) {
            if (img === null || img.naturalWidth === 0 || img.naturalHeight === 0) continue;
            const r = coverRect(img.naturalWidth, img.naturalHeight, innerW, innerH);
            ctx.drawImage(img, r.x + plan.inset, r.y + plan.inset, r.w, r.h);
        }
        if (frame !== null) ctx.drawImage(frame, 0, 0, plan.width, plan.height);
    })();
    return canvas;
}

/**
 * An empire's composite, method_118(empire, empire.DominantRace, w, h, bitmap_31, inset, empire is a pirate faction).
 * `emblemPortrait`: a scenario's override of the race picture (null: none), used instead of the race image.
 */
export function empireRacePicture(empire: Empire, width: number, height: number, inset: number, className = '', emblemPortrait?: Promise<string | null>): HTMLCanvasElement {
    const plan = racePicturePlan({ empire, race: empire.dominantRace ?? null, width, height, inset, pirate: empire.pirateEmpireBaseHabitat !== null });
    const portrait = emblemPortrait?.then((u): readonly string[] => (u !== null ? [u] : plan.portrait));
    return racePictureCanvas(plan, className, portrait);
}
