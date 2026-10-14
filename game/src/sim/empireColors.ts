// Empire colours (task C2b/C2d). Ports of Galaxy.cs SelectColorFromKey (2633),
// SelectColorFromKeyDark (2714), SelectComplementaryColorKey (2555),
// DetermineUsedEmpireColors / CheckEmpireColorUsed / SelectUnusedMainColor
// (2386-2470), CheckListContainsColor / CheckColorsEqual,
// DetermineContrastDropShadowColor (2494-2507), DetermineSecondaryColor
// (2509-2530), DetermineContrastColor (2532-2538). Colours are 0xRRGGBB
// numbers (alpha is always 255 in these tables); Color.Empty is 0.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { humanSeats } from './humanEmpires';

const KEY_COLORS = [
    0x0000b0, 0x0040e8, 0x0080ff, 0x00ffff, 0x185018, 0x008000, 0x00cc00, 0xa0ff00, 0xffff20, 0xff681f, 0xff0030, 0x870000,
    0x604000, 0x907030, 0xe0c060, 0xa840ff, 0x7020cc, 0x843179, 0xff00ff, 0xffa6c9, 0xffffff, 0x999933, 0xc00080, 0x010101,
];

export function selectColorFromKey(key: number): number {
    return key >= 0 && key < KEY_COLORS.length ? KEY_COLORS[key] : 0;
}

// ---------------------------------------------------------------------------
// Task 19k-1b (Big Galaxies, presentation only): with >20 empires,
// SelectUnusedMainColor's 20-key budget is spent and Galaxy.cs falls back to
// a random muted RGB colour per empire (empire.mainColor keeps that value —
// this file's sim-facing functions above are untouched, so pins stay at 0).
// Part of the base game (no flag; the old big-galaxies add-on's `extendedPalette` is ignored): with more than 20
// empires the game swaps that random fallback for a fixed, contrast-picked colour from a 100-entry data table
// (20 key + 100 extended covers the wizard's 101-empire maximum) — for display only:
// selectDisplayColor / displayColorForEmpire are called from render/UI code,
// never from sim generation, so this never changes empire.mainColor itself.
// Human empires (the player and every multiplayer / hot-seat seat) chose their colour in the wizard (key or custom,
// game.ts createGameSteps); they always show exactly that colour, and the extended colours steer clear of them.
// ---------------------------------------------------------------------------

/** The 20 key colours empires are actually assigned from (KEY_COLORS[20..23] are extra fixed colours used elsewhere, not part of the 20-colour empire budget). */
const KEY_COLORS_20 = KEY_COLORS.slice(0, 20);

/** 100 additional colours for empires beyond the 20 key ones. Generated once (greedy farthest-point sampling in
 * OKLab over an in-gamut OKLCH grid with L 0.56-0.92 and chroma >= 0.05, seeded with the 20 key colours) and fixed
 * here: every entry is >= 0.059 OKLab distance from the key colours and from each other, and bright enough to read on
 * the dark starfield. Ordered best-first, so smaller galaxies get the most distinct ones. Not a C# table. */
export const EXTENDED_COLORS: readonly number[] = [
    0x23adaa, 0xb671a6, 0x99adf7, 0xce0682, 0x497aa0, 0x8ea432, 0xe781fe, 0x5ed99e, 0xd8ecca, 0xc09c8a,
    0xb84c51, 0xf24bba, 0x14d3f7, 0x6c60d3, 0xa37ef4, 0xaa3db5, 0xdad1f6, 0xfa7090, 0x47935f, 0xc98a0e,
    0x2ea2e5, 0x8b697a, 0x8cbbbe, 0x98d423, 0x17a92a, 0x39fd9e, 0x8f96b8, 0xc4e77c, 0xf9a683, 0xc5735c,
    0x8f8f6c, 0xd339e2, 0xf3317c, 0xd09add, 0x8bdcd4, 0x35c26d, 0xfdcda0, 0xfa960b, 0xa2bd6d, 0x2cf343,
    0xab4e88, 0x6f85e1, 0xfa81cb, 0xf9d630, 0x8a70b8, 0xdd410d, 0x567e71, 0xa3f5fd, 0xc0b8db, 0xca6fd3,
    0xc6d0ac, 0xb2580b, 0x803cfb, 0x768b09, 0xf7aafe, 0x3d60f8, 0x9ed1fb, 0x99eeb9, 0x1987cd, 0xe05768,
    0xd987ac, 0x60ac76, 0xfae58e, 0xda02af, 0xe9bebf, 0x689698, 0xa78089, 0xc761fc, 0xd65997, 0x8f4bd1,
    0xef816b, 0xef58fe, 0x49df6e, 0x99ac8b, 0xac1bd7, 0xc9c510, 0xcd285e, 0xb9a44d, 0xab85cd, 0x52c8b4,
    0x3270d6, 0x1f9bba, 0x43b4d4, 0xd2e609, 0x7c7d9e, 0xdb640e, 0x8273ff, 0x9d6450, 0xa08b32, 0x3ce8ce,
    0xb89ab3, 0xb66279, 0x97cda5, 0x9457ab, 0xef9499, 0x43befd, 0xdfa360, 0xc4affd, 0x6b7d47, 0xaffe88,
];

/** True when `color` is one of the 20 key colours empire.mainColor is assigned from (SelectUnusedMainColor's budget). */
function isKeyColor(color: number): boolean {
    return KEY_COLORS_20.includes(color);
}

function srgbToLinear(c: number): number {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** 0xRRGGBB to OKLab [L, a, b] (Björn Ottosson's matrices). */
function toOkLab(color: number): [number, number, number] {
    const r = srgbToLinear((color >> 16) & 0xff);
    const g = srgbToLinear((color >> 8) & 0xff);
    const b = srgbToLinear(color & 0xff);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}

/** OKLab distance between two 0xRRGGBB colours. */
export function colorDistance(a: number, b: number): number {
    const p = toOkLab(a);
    const q = toOkLab(b);
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Extended colours closer than this (OKLab) to a human's chosen colour are not handed to fallback empires. */
const CHOSEN_CLEARANCE = 0.08;

interface DisplayCache {
    empires: readonly (Empire | null)[];
    seats: readonly Empire[];
    signature: number;
    colors: Map<Empire, number>;
}
const displayCache = new WeakMap<Galaxy, DisplayCache>();

/** Cheap change detector for the empire list's colours / ids (the cache key beside the array identities). */
function colorSignature(empires: readonly (Empire | null)[]): number {
    let h = empires.length;
    for (const e of empires) if (e !== null) h = (Math.imul(h, 31) + e.mainColor + Math.imul(e.empireId, 0x9e3779b1)) | 0;
    return h;
}

/** The overflow empires' display colours for `galaxy` (only empires whose colour is replaced are in the map). */
function overflowColors(galaxy: Galaxy, seats: readonly Empire[]): Map<Empire, number> {
    const empires = galaxy.empires as readonly (Empire | null)[];
    const signature = colorSignature(empires);
    const cached = displayCache.get(galaxy);
    if (cached !== undefined && cached.empires === empires && cached.seats === seats && cached.signature === signature) return cached.colors;
    const chosen = seats.map((e) => e.mainColor);
    // Overflow: a non-human empire on SelectUnusedMainColor's random fallback (not a key colour), or one whose key
    // colour a human also picked in the wizard (the human's override happens after the AI colours are dealt).
    const overflow = empires
        .filter((e): e is Empire => e !== null && !seats.includes(e) && (!isKeyColor(e.mainColor) || chosen.includes(e.mainColor)))
        .sort((a, b) => a.empireId - b.empireId);
    let palette: readonly number[] = EXTENDED_COLORS;
    if (chosen.length > 0) {
        const clear: number[] = [];
        const near: { c: number; d: number }[] = [];
        for (const c of EXTENDED_COLORS) {
            const d = Math.min(...chosen.map((h) => colorDistance(c, h)));
            if (d >= CHOSEN_CLEARANCE) clear.push(c);
            else near.push({ c, d });
        }
        // Only if the clear ones run out, the least-close of the rest (never a human's own colour first).
        near.sort((x, y) => y.d - x.d);
        palette = clear.length >= overflow.length ? clear : [...clear, ...near.map((x) => x.c)];
    }
    const colors = new Map<Empire, number>();
    overflow.forEach((e, rank) => colors.set(e, palette[rank % palette.length]));
    displayCache.set(galaxy, { empires, seats, signature, colors });
    return colors;
}

/**
 * The display colour for `empire` (task 19k-1b): with 20 or fewer empires this is exactly `empire.mainColor` (byte-identical to the faithful game).
 * Above 20, a human empire (humanSeats: the wizard picked its colour, key or custom) keeps exactly its mainColor too;
 * any other empire whose mainColor is NOT one of the 20 key colours (SelectUnusedMainColor's random-fallback branch)
 * or duplicates a human's chosen colour instead gets a colour from EXTENDED_COLORS — skipping those near a human's
 * colour — picked by its stable rank (by empireId) among every such "overflow" empire: deterministic and distinct
 * for up to 100 of them (the wizard's 101-empire maximum). Read-only: never touches empire.mainColor or galaxy.rnd.
 */
export function displayColorForEmpire(empire: Empire): number {
    const galaxy = empire.galaxy;
    if (galaxy == null || galaxy.empires.length <= 20) return empire.mainColor;
    const seats = humanSeats(galaxy);
    if (seats.includes(empire)) return empire.mainColor;
    return overflowColors(galaxy, seats).get(empire) ?? empire.mainColor;
}

const COMPLEMENTARY = [3, 8, 20, 1, 14, 9, 4, 12, 11, 12, 20, 14, 9, 20, 12, 8, 20, 8, 11, 11, 10, 4, 19];
export function selectComplementaryColorKey(mainColorKey: number): number {
    return mainColorKey >= 0 && mainColorKey < COMPLEMENTARY.length ? COMPLEMENTARY[mainColorKey] : 0;
}

// Galaxy.cs SelectColorFromKeyDark (~line 2714).
const KEY_COLORS_DARK = [
    0x00003b, 0x00154d, 0x002b55, 0x005555, 0x081b08, 0x002b00, 0x004400, 0x355500, 0x55550b, 0x55230a,
    0x550010, 0x2d0000, 0x201500, 0x302510, 0x4b4020, 0x381555, 0x250b44, 0x2c1028, 0x550055, 0x553743,
    0xffffff, 0x333311, 0x40002b, 0x010101,
];

export function selectColorFromKeyDark(key: number): number {
    return key >= 0 && key < KEY_COLORS_DARK.length ? KEY_COLORS_DARK[key] : 0;
}

// Galaxy.cs DetermineContrastDropShadowColor (2494-2507), overload with
// (Color.White, Color.Black) defaults folded into the two-arg call sites we
// use here.
function determineContrastDropShadowColor(color: number, lightColor: number, darkColor: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const num = 1.0 - (0.333 * r + 0.333 * g + 0.333 * b) / 255.0;
    return num < 0.7 ? darkColor : lightColor;
}

// Galaxy.cs DetermineContrastColor (2532-2538).
export function determineContrastColor(color: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const red = 255 - r;
    const green = 255 - g;
    const blue = 255 - b;
    return (red << 16) | (green << 8) | blue;
}

// Galaxy.cs DetermineSecondaryColor (2509-2530).
export function determineSecondaryColor(color: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const num = (r + g + b) / 3;
    if (num > 80 && num < 176) {
        let darkColor = 0x000000;
        if (r > g && r > b) {
            darkColor = 0x300000;
        } else if (g > r && g > b) {
            darkColor = 0x003000;
        } else if (b > g && b > r) {
            darkColor = 0x000030;
        }
        return determineContrastDropShadowColor(color, 0xffffff, darkColor);
    }
    return determineContrastColor(color);
}

function determineUsedEmpireColors(galaxy: Galaxy, isPirateFaction: boolean): number[] {
    return (isPirateFaction ? galaxy.pirateEmpires : galaxy.empires).map((e) => e.mainColor);
}

export function checkEmpireColorUsed(galaxy: Galaxy, isPirateFaction: boolean, color: number): boolean {
    return determineUsedEmpireColors(galaxy, isPirateFaction).includes(color);
}

// Port of SelectUnusedMainColor (Galaxy.cs 2412-2471).
export function selectUnusedMainColor(galaxy: Galaxy, isPirateFaction: boolean): { color: number; unusedColorKey: number } {
    const used = determineUsedEmpireColors(galaxy, isPirateFaction);
    const list: number[] = [];
    const list2: number[] = [];
    for (let i = 0; i < 20; i++) {
        const c = isPirateFaction ? selectColorFromKeyDark(i) : selectColorFromKey(i);
        if (!used.includes(c)) {
            list.push(c);
            list2.push(i);
        }
    }
    if (list.length > 0) {
        const index = galaxy.rnd.next(0, list.length);
        return { color: list[index], unusedColorKey: list2[index] };
    }
    if (isPirateFaction) {
        let color = 0;
        switch (galaxy.rnd.next(0, 3)) {
            case 0:
                color = (galaxy.rnd.next(48, 96) << 16) | (galaxy.rnd.next(8, 64) << 8) | galaxy.rnd.next(8, 64);
                break;
            case 1:
                color = (galaxy.rnd.next(8, 64) << 16) | (galaxy.rnd.next(48, 96) << 8) | galaxy.rnd.next(8, 64);
                break;
            case 2:
                color = (galaxy.rnd.next(8, 64) << 16) | (galaxy.rnd.next(8, 64) << 8) | galaxy.rnd.next(48, 96);
                break;
        }
        return { color, unusedColorKey: -1 };
    }
    const r = galaxy.rnd.next(32, 256);
    const g = galaxy.rnd.next(32, 256);
    const b = galaxy.rnd.next(32, 256);
    return { color: (r << 16) | (g << 8) | b, unusedColorKey: -1 };
}
