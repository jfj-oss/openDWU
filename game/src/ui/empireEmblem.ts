// The portrait and flag an empire is shown with in the UI (19r; the display-time override mechanism of the 19a
// Concord art, copied rather than shared). Stock: the race portrait (images/units/races/race_<PictureIndex>.png,
// Main.Part13.cs ~2195) and the flag shape tinted by the empire colours (the HUD's CSS filter). Overrides — registered
// functions returning generated art for an empire — replace either: the 19r derived flags / portraits of companies,
// seceded states, governments in exile and the Ghost Armada (render/empireLineage.ts + render/emblemArt.ts), and the
// Ossuvan herders' portrait (our own generated art, public/art/herder/portrait.png) and horned-herd flag (procedural,
// data: URL, cached).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { flagShapeUrl } from '../sim/startGameOptions';
import { HERDER_RACE } from '../sim/scenario/rimHerders/common';
import { empireLineage } from '../render/empireLineage';
import {
    companyFlag,
    composeEmpireFlag,
    corporatePortrait,
    exileFlag,
    exilePortrait,
    ghostFlag,
    ghostPortrait,
    herderFlag,
    secededFlag,
    secededPortrait,
    type RgbaImage,
} from '../render/emblemArt';

export interface EmpireEmblem {
    portraitUrl: string | null;
    flagUrl: string | null;
    /** CSS filter for the flag image ('' = draw as is). */
    flagFilter: string;
}

/** An override: generated art for `empire` (either field may be left to the stock art), or null to pass. */
export type EmblemOverride = (galaxy: Galaxy, empire: Empire) => Promise<{ portraitUrl?: string; flagUrl?: string }> | null;

const overrides: EmblemOverride[] = [];

/** Registers an emblem override (first match wins, in registration order). Returns an unregister function. */
export function registerEmblemOverride(fn: EmblemOverride): () => void {
    overrides.push(fn);
    return () => {
        const i = overrides.indexOf(fn);
        if (i >= 0) overrides.splice(i, 1);
    };
}

/** hud.ts colorHueRotate (kept local: hud.ts imports this module). */
export function hueRotateOf(rgb: number): number {
    const r = ((rgb >> 16) & 255) / 255;
    const g = ((rgb >> 8) & 255) / 255;
    const b = (rgb & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    if (max !== min) {
        const d = max - min;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return Math.round(h * 360);
}

export function racePortraitUrl(pictureIndex: number): string {
    return `/assets/dwu/images/units/races/race_${pictureIndex}.png`;
}

/** The Ossuvan herders' portrait: our own FLUX generation (tasks/19-mod-layer-scenarios.md §19g-7b art rule),
 *  committed under public/art/ rather than generated at runtime. */
export const HERDER_PORTRAIT_URL = '/art/herder/portrait.png';

/** The stock emblem (synchronous). */
export function stockEmblem(empire: Empire): EmpireEmblem {
    const race = empire.dominantRace;
    return {
        portraitUrl: race != null ? racePortraitUrl(race.pictureIndex) : null,
        flagUrl: empire.flagShape >= 0 ? flagShapeUrl(empire.flagShape) : null,
        flagFilter: `sepia(1) saturate(4) hue-rotate(${hueRotateOf(empire.mainColor)}deg)`,
    };
}

/** The emblem with any override applied (resolves to the stock one when none applies). */
export async function resolveEmpireEmblem(galaxy: Galaxy | null | undefined, empire: Empire): Promise<EmpireEmblem> {
    const stock = stockEmblem(empire);
    // Every override keys on scenario content (a scenario race or a scenario package's records).
    if (galaxy == null || galaxy.scenario == null) return stock;
    for (const fn of overrides) {
        const p = fn(galaxy, empire);
        if (p === null) continue;
        try {
            const o = await p;
            return {
                portraitUrl: o.portraitUrl ?? stock.portraitUrl,
                flagUrl: o.flagUrl ?? stock.flagUrl,
                flagFilter: o.flagUrl !== undefined ? '' : stock.flagFilter,
            };
        } catch (e) {
            console.warn('[emblem]', e);
            return stock;
        }
    }
    return stock;
}

/** Sets `img` to the stock art now and swaps in the override when it is ready. `which` picks portrait or flag. */
export function applyEmpireEmblem(img: HTMLImageElement, galaxy: Galaxy | null | undefined, empire: Empire, which: 'portrait' | 'flag'): void {
    const stock = stockEmblem(empire);
    const set = (e: EmpireEmblem): void => {
        const url = which === 'portrait' ? e.portraitUrl : e.flagUrl;
        if (url === null) return;
        if (img.src !== url) img.src = url;
        img.style.filter = which === 'flag' ? e.flagFilter : '';
    };
    set(stock);
    if (galaxy != null && galaxy.scenario != null) void resolveEmpireEmblem(galaxy, empire).then(set);
}

// ---------------------------------------------------------------------------------------------------------------
// Image plumbing (browser)
// ---------------------------------------------------------------------------------------------------------------

const rgbaCache = new Map<string, Promise<RgbaImage | null>>();

/** RGBA of an image URL (null when it fails to load). */
export function loadRgba(url: string): Promise<RgbaImage | null> {
    let p = rgbaCache.get(url);
    if (p === undefined) {
        p = new Promise<RgbaImage | null>((resolve) => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                if (ctx === null) return resolve(null);
                ctx.drawImage(img, 0, 0);
                resolve({ w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data });
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
        rgbaCache.set(url, p);
    }
    return p;
}

export function rgbaToDataUrl(img: RgbaImage): string {
    const c = document.createElement('canvas');
    c.width = img.w;
    c.height = img.h;
    const ctx = c.getContext('2d');
    if (ctx === null) return '';
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
    return c.toDataURL('image/png');
}

/** The stock 100 × 60 flag of an empire-like (shape + colours), as GenerateEmpireFlag makes it. */
export async function stockFlagRgba(flagShape: number, main: number, secondary: number): Promise<RgbaImage> {
    const shape = flagShape >= 0 ? await loadRgba(flagShapeUrl(flagShape)) : null;
    return composeEmpireFlag(shape, main, secondary);
}

const generated = new Map<string, Promise<{ portraitUrl?: string; flagUrl?: string }>>();

function once(key: string, make: () => Promise<{ portraitUrl?: string; flagUrl?: string }>): Promise<{ portraitUrl?: string; flagUrl?: string }> {
    let p = generated.get(key);
    if (p === undefined) {
        p = make();
        generated.set(key, p);
    }
    return p;
}

// ---------------------------------------------------------------------------------------------------------------
// 19r overrides
// ---------------------------------------------------------------------------------------------------------------

/** Item 3: the Ossuvan herders — our own FLUX-generated portrait (public/art/herder/portrait.png) + the procedural
 *  herd flag. */
export const herderEmblemOverride: EmblemOverride = (_galaxy, empire) => {
    const race = empire.dominantRace;
    if (race === null || race.name.toLowerCase() !== HERDER_RACE.toLowerCase()) return null;
    return once('herder', async () => ({ portraitUrl: HERDER_PORTRAIT_URL, flagUrl: rgbaToDataUrl(herderFlag()) }));
};

/** Item 6: derived flags / portraits from the empire's lineage. */
export const derivedEmblemOverride: EmblemOverride = (galaxy, empire) => {
    const lin = empireLineage(galaxy, empire);
    if (lin === null) return null;
    const p = lin.parent;
    const pShape = p?.flagShape ?? empire.flagShape;
    const pMain = p?.mainColor ?? empire.mainColor;
    const pSec = p?.secondaryColor ?? empire.secondaryColor;
    const pRace = (p?.dominantRace ?? empire.dominantRace)?.pictureIndex ?? -1;
    const key = `${lin.kind}|${empire.empireId}|${empire.mainColor}|${empire.secondaryColor}|${pShape}|${pMain}|${pSec}|${pRace}`;
    return once(key, async () => {
        const portrait = pRace >= 0 ? await loadRgba(racePortraitUrl(pRace)) : null;
        switch (lin.kind) {
            case 'company': {
                const flag = companyFlag(await stockFlagRgba(pShape, pMain, pSec), empire.mainColor, empire.secondaryColor);
                return { flagUrl: rgbaToDataUrl(flag), portraitUrl: portrait === null ? undefined : rgbaToDataUrl(corporatePortrait(portrait, empire.mainColor)) };
            }
            case 'seceded': {
                const shape = pShape >= 0 ? await loadRgba(flagShapeUrl(pShape)) : null;
                const flag = secededFlag(shape, empire.mainColor, empire.secondaryColor, empire.empireId + 1);
                return { flagUrl: rgbaToDataUrl(flag), portraitUrl: portrait === null ? undefined : rgbaToDataUrl(secededPortrait(portrait, empire.mainColor, empire.empireId + 1)) };
            }
            case 'exile': {
                const flag = exileFlag(await stockFlagRgba(pShape, pMain, pSec));
                return { flagUrl: rgbaToDataUrl(flag), portraitUrl: portrait === null ? undefined : rgbaToDataUrl(exilePortrait(portrait)) };
            }
            default: {
                const flag = ghostFlag(await stockFlagRgba(pShape, pMain, pSec));
                return { flagUrl: rgbaToDataUrl(flag), portraitUrl: portrait === null ? undefined : rgbaToDataUrl(ghostPortrait(portrait)) };
            }
        }
    });
};

registerEmblemOverride(derivedEmblemOverride);
registerEmblemOverride(herderEmblemOverride);
