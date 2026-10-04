// Effect animation frame lists with a theme (customization set) that replaces an effect folder: the original's
// loaders re-count the frames from the folder they use (Directory.GetFiles / GetDirectories), so a theme's folder can
// hold more or fewer frames than the stock one. Pure URL logic over the active CustomizationSet; with no theme (or a
// theme without that folder) every list is the stock one, unchanged.
//
//   Main.Part12.cs 125 LoadEffectsExplosion — effects\explosions\: the theme's folder when it has a subfolder; one set
//     per subfolder (Directory.GetDirectories order) into bitmap_19[i], each set its *.png sorted (List.Sort, the
//     culture comparer); effects\planetdestroy\ (the theme's when it holds a *.png): its *.png sorted (bitmap_20);
//   Main.Part13.cs 1243 LoadHyperEffects — effects\hyperenter\ / hyperexit\ (each the theme's when it has a "0"
//     subfolder): for k < GetDirectories(enter).Length, folder "<k>" (stop at the first missing enter or exit folder),
//     Bitmap[GetFiles("frame_*.png").Length] filled from frame_0.png on, stopping at the first missing file;
//   Main.Part13.cs 1353 LoadEffects — effects\enginethrusters\ (theme's when it holds a *.png): for i <
//     GetFiles("*.png").Length the existing <i>.png, compacted (bitmap_209); mining\ / gasmining\ / construction\:
//     GetFiles("*.png").Length frames Frame_<i+1:000>.png (bitmap_210 / 211 / 212); tractorbeamstrike\: the count's
//     <i+1:00>.png (bitmap_215).
import { activeCustomizationSet, customizationFileUrl, type CustomizationSet } from '../sim/data/customization';
import { themeArtFolder } from '../themeAssets';

const IMG = '/assets/dwu/images';

/** effects/explosions/<dir>: the stock folder's Directory.GetDirectories (case-insensitive ordinal) order = ExplosionImageIndex. */
export const EXPLOSION_SET_DIRS = [
    'Expl01', 'Expl01b', 'Expl01c', 'Expl01d', 'Expl01e',
    'Expl02a', 'Expl02b', 'Expl02c', 'Expl02d',
    'Expl05a', 'Expl05b', 'Expl05c', 'Expl05d', 'Expl05e',
    'Expl07c', 'Expl07d', 'Expl07e', 'Expl07f', 'Expl07g', 'Expl07h',
] as const;
/** Main.Part13.cs 135: bitmap_19 = new Bitmap[20][] — the explosion set slots (sim ExplosionImageIndex 0..19). */
export const EXPLOSION_SET_SLOTS = 20;
/** The stock explosion sets' frame count (each Expl<..>0001..0020.png; Galaxy.ExplosionImageCount). */
export const STOCK_EXPLOSION_FRAME_COUNT = 20;
/** effects/planetdestroy/ExplPlanet040001..0120.png (Galaxy.ExplosionHabitatImageCount). */
export const STOCK_PLANET_DESTROY_FRAME_COUNT = 120;
/** effects/hyperenter/<k>/frame_<n>.png and hyperexit/<k>/ file counts of the install's numbered folders 0..3 (its
 * named folders — calistadal, equinox, gerax — count in GetDirectories but the loop stops at the missing "4"). */
export const HYPER_ENTER_FRAME_COUNTS = [50, 32, 40, 43] as const;
export const HYPER_EXIT_FRAME_COUNTS = [35, 31, 43, 42] as const;
/** The stock hyper folders' GetDirectories count (0, 1, 2, 3, calistadal, equinox, gerax). */
const STOCK_HYPER_DIR_COUNT = 7;
/** effects/enginethrusters/: the stock folder holds 0..5.png (and seven exhaust_*.png the <i>.png loop never hits). */
export const STOCK_ENGINE_THRUSTER_COUNT = 6;
/** effects/mining/Frame_001..120, gasmining/ and construction/ Frame_001..090 (GetFiles("*.png").Length). */
export const STOCK_MINING_FRAME_COUNT = 120;
export const STOCK_GAS_MINING_FRAME_COUNT = 90;
export const STOCK_CONSTRUCTION_FRAME_COUNT = 90;
/** effects/tractorbeamstrike/01..21.PNG (GetFiles("*.png").Length = 21). */
export const STOCK_TRACTOR_STRIKE_FRAME_COUNT = 21;

/** List<string>.Sort() of file paths: the culture-sensitive default comparer. */
const cultureCompare = new Intl.Collator('en-US').compare;

/** The URL of `name` in the theme's folder `dir` (a missing file gives a URL that 404s: the original's null bitmap). */
function themeFileUrl(set: CustomizationSet, dir: string, name: string): string {
    return set.fileUrl(`${dir}/${name}`) ?? customizationFileUrl(set.name, `${set.actualDir(dir) ?? dir}/${name}`);
}

function stockExplosionSet(s: number): string[] {
    const dir = EXPLOSION_SET_DIRS[s];
    return Array.from({ length: STOCK_EXPLOSION_FRAME_COUNT }, (_u, i) => `${IMG}/effects/explosions/${dir}/${dir}${String(i + 1).padStart(4, '0')}.png`);
}

/**
 * bitmap_19: the explosion sets, slot i = ExplosionImageIndex i. A theme's explosions folder with any subfolder
 * replaces the stock sets: slot i is its i-th subfolder's *.png (sorted); slots past its subfolder count stay empty
 * (the original leaves them null; more than 20 subfolders overflow bitmap_19 there and are cut here).
 */
export function explosionSetUrls(): string[][] {
    const theme = themeArtFolder('images/effects/explosions');
    const set = activeCustomizationSet();
    if (theme === null || set === null) return EXPLOSION_SET_DIRS.map((_d, s) => stockExplosionSet(s));
    const out: string[][] = [];
    for (let i = 0; i < EXPLOSION_SET_SLOTS; i++) {
        const sub = theme.subfolders[i];
        if (sub === undefined) {
            out.push([]);
            continue;
        }
        const dir = `images/effects/explosions/${sub}`;
        out.push(set.listFiles(dir, '.png').sort(cultureCompare).map((f) => set.listedFileUrl(dir, f)));
    }
    return out;
}

/** bitmap_20: the planet-destroyer explosion frames (the theme's planetdestroy\*.png sorted, or the stock 120). */
export function planetDestroyUrls(): string[] {
    const theme = themeArtFolder('images/effects/planetdestroy');
    if (theme === null) {
        return Array.from({ length: STOCK_PLANET_DESTROY_FRAME_COUNT }, (_u, i) => `${IMG}/effects/planetdestroy/ExplPlanet04${String(i + 1).padStart(4, '0')}.png`);
    }
    return theme.files.filter((f) => f.toLowerCase().endsWith('.png')).sort(cultureCompare).map(theme.urlOf);
}

/** One hyper folder's listing as LoadHyperEffects sees it. */
interface HyperListing {
    /** Directory.GetDirectories(folder).Length. */
    dirCount: number;
    /** Directory.Exists(folder\<k>\). */
    hasDir(k: number): boolean;
    /** GetFiles(folder\<k>\, "frame_*.png").Length. */
    frameFileCount(k: number): number;
    /** File.Exists(folder\<k>\frame_<l>.png). */
    hasFrame(k: number, l: number): boolean;
    url(k: number, l: number): string;
}

function stockHyperListing(kind: 'hyperenter' | 'hyperexit'): HyperListing {
    const counts: readonly number[] = kind === 'hyperenter' ? HYPER_ENTER_FRAME_COUNTS : HYPER_EXIT_FRAME_COUNTS;
    return {
        dirCount: STOCK_HYPER_DIR_COUNT,
        hasDir: (k) => k < counts.length,
        frameFileCount: (k) => counts[k] ?? 0,
        hasFrame: (k, l) => l < (counts[k] ?? 0),
        url: (k, l) => `${IMG}/effects/${kind}/${k}/frame_${l}.png`,
    };
}

function themeHyperListing(set: CustomizationSet, kind: 'hyperenter' | 'hyperexit'): HyperListing | null {
    const root = `images/effects/${kind}`;
    // Directory.GetDirectories(<theme>\effects\<kind>\, "0").Length > 0.
    if (!set.dirExists(`${root}/0`)) return null;
    const isFrame = (f: string): boolean => /^frame_.*\.png$/i.test(f);
    return {
        dirCount: set.subfolders(root).length,
        hasDir: (k) => set.dirExists(`${root}/${k}`),
        frameFileCount: (k) => set.listFiles(`${root}/${k}`).filter(isFrame).length,
        hasFrame: (k, l) => set.fileExists(`${root}/${k}/frame_${l}.png`),
        url: (k, l) => themeFileUrl(set, `${root}/${k}`, `frame_${l}.png`),
    };
}

/**
 * LoadHyperEffects (Main.Part13.cs 1243-1351): list_3 / list_4, one frame list per hyper drive animation folder.
 * A list is GetFiles("frame_*.png").Length long; frames from the first missing frame_<l>.png on stay empty (the
 * original's null bitmaps).
 * TODO(port): the ApplicationException the original throws when either folder has no subfolder or the two counts
 * differ (1281-1292) — a broken theme stops the load there; here the lists are built as far as they go.
 */
export function hyperFrameUrls(): { enter: string[][]; exit: string[][] } {
    const set = activeCustomizationSet();
    const enter = (set !== null ? themeHyperListing(set, 'hyperenter') : null) ?? stockHyperListing('hyperenter');
    const exit = (set !== null ? themeHyperListing(set, 'hyperexit') : null) ?? stockHyperListing('hyperexit');
    const out = { enter: [] as string[][], exit: [] as string[][] };
    const frames = (l: HyperListing, k: number): string[] => {
        const n = l.frameFileCount(k);
        const urls: string[] = [];
        for (let i = 0; i < n; i++) {
            // `if (!File.Exists(...)) break;`: from the first missing frame on, the array's slots stay null.
            if (!l.hasFrame(k, i)) break;
            urls.push(l.url(k, i));
        }
        // The slots past the break stay null bitmaps ('' = no picture, fxCommon FrameSet), the animation keeps its length.
        while (urls.length < n) urls.push('');
        return urls;
    };
    for (let k = 0; k < enter.dirCount; k++) {
        if (!enter.hasDir(k)) break;
        out.enter.push(frames(enter, k));
        if (!exit.hasDir(k)) break;
        out.exit.push(frames(exit, k));
    }
    return out;
}

/** bitmap_209: the engine thruster pictures — <i>.png for i < the folder's *.png count, the missing ones dropped. */
export function engineThrusterUrls(): string[] {
    const theme = themeArtFolder('images/effects/enginethrusters');
    const set = activeCustomizationSet();
    if (theme === null || set === null) return Array.from({ length: STOCK_ENGINE_THRUSTER_COUNT }, (_u, i) => `${IMG}/effects/enginethrusters/${i}.png`);
    const n = theme.files.filter((f) => f.toLowerCase().endsWith('.png')).length;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
        const url = set.fileUrl(`images/effects/enginethrusters/${i}.png`);
        if (url !== null) out.push(url);
    }
    return out;
}

/** Frames numbered by a pattern over a folder's *.png count (mining, gas mining, construction, tractor strike). */
function countedFrames(folder: string, stockCount: number, name: (i: number) => string, stockName: (i: number) => string = name): string[] {
    const theme = themeArtFolder(`images/effects/${folder}`);
    const set = activeCustomizationSet();
    if (theme === null || set === null) return Array.from({ length: stockCount }, (_u, i) => `${IMG}/effects/${folder}/${stockName(i)}`);
    const n = theme.files.filter((f) => f.toLowerCase().endsWith('.png')).length;
    return Array.from({ length: n }, (_u, i) => themeFileUrl(set, `images/effects/${folder}`, name(i)));
}

const frame000 = (i: number): string => `Frame_${String(i + 1).padStart(3, '0')}.png`;

/** bitmap_210: effects\mining\Frame_<i+1:000>.png. */
export function miningFrameUrls(): string[] {
    return countedFrames('mining', STOCK_MINING_FRAME_COUNT, frame000);
}

/** bitmap_211: effects\gasmining\Frame_<i+1:000>.png. */
export function gasMiningFrameUrls(): string[] {
    return countedFrames('gasmining', STOCK_GAS_MINING_FRAME_COUNT, frame000);
}

/** bitmap_212 (texture2D_33): effects\construction\Frame_<i+1:000>.png. */
export function constructionFrameUrls(): string[] {
    return countedFrames('construction', STOCK_CONSTRUCTION_FRAME_COUNT, frame000);
}

/** bitmap_215 (texture2D_34): effects\tractorbeamstrike\<i+1:00>.png (the stock files are spelled .PNG). */
export function tractorStrikeFrameUrls(): string[] {
    return countedFrames(
        'tractorbeamstrike',
        STOCK_TRACTOR_STRIKE_FRAME_COUNT,
        (i) => `${String(i + 1).padStart(2, '0')}.png`,
        (i) => `${String(i + 1).padStart(2, '0')}.PNG`,
    );
}
