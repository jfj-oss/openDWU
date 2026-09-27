// Empire colours (task C2b/C2d). Ports of Galaxy.cs SelectColorFromKey (2633),
// SelectColorFromKeyDark (2714), SelectComplementaryColorKey (2555),
// DetermineUsedEmpireColors / CheckEmpireColorUsed / SelectUnusedMainColor
// (2386-2470), CheckListContainsColor / CheckColorsEqual,
// DetermineContrastDropShadowColor (2494-2507), DetermineSecondaryColor
// (2509-2530), DetermineContrastColor (2532-2538). Colours are 0xRRGGBB
// numbers (alpha is always 255 in these tables); Color.Empty is 0.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import { scenarioFlag } from './scenario/state';

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
// The `big-galaxies` scenario's `extendedPalette` flag swaps that random
// fallback for a fixed, contrast-picked colour from a 40-entry data table
// (20 key + 40 extended = 60, the "Big galaxies" cap) — for display only:
// selectDisplayColor / displayColorForEmpire are called from render/UI code,
// never from sim generation, so this never changes empire.mainColor itself.
// ---------------------------------------------------------------------------

/** The 20 key colours empires are actually assigned from (KEY_COLORS[20..23] are extra fixed colours used elsewhere, not part of the 20-colour empire budget). */
const KEY_COLORS_20 = KEY_COLORS.slice(0, 20);

/** 40 additional colours for empires beyond the 20 key ones (task 19k-1b), picked for hue/lightness spread so they
 * read as distinct from the 20 key colours and from each other on the dark starfield background. Not a C# table. */
const EXTENDED_COLORS: readonly number[] = [
    0xf0574c, 0xd2512d, 0xf4a77b, 0xdda05f, 0xeca413, 0xe6d589, 0xf0eb4c, 0xbfd22d, 0xd4f47b, 0xa9dd5f,
    0x71ec13, 0xa3e689, 0x62f04c, 0x2dd22f, 0x7bf48f, 0x5fdd87, 0x13ec78, 0x89e6c2, 0x4cf0ca, 0x2dd2c5,
    0x7becf4, 0x5fc2dd, 0x139cec, 0x89b6e6, 0x4c83f0, 0x2d4bd2, 0x7b7ff4, 0x6e5fdd, 0x4d13ec, 0xb089e6,
    0xa94cf0, 0xa32dd2, 0xe47bf4, 0xdd5fdb, 0xec13c8, 0xe689c9, 0xf04ca4, 0xd22d6c, 0xf47b97, 0xdd5f6a,
];

/** True when `color` is one of the 20 key colours empire.mainColor is assigned from (SelectUnusedMainColor's budget). */
function isKeyColor(color: number): boolean {
    return KEY_COLORS_20.includes(color);
}

/**
 * The display colour for `empire` (task 19k-1b): with the `extendedPalette` scenario flag off, or with no scenario,
 * this is exactly `empire.mainColor` (byte-identical to the faithful game). With it on, an empire whose mainColor is
 * NOT one of the 20 key colours (i.e. it hit SelectUnusedMainColor's random-fallback branch, meaning >20 empires in
 * this galaxy already claimed the key colours) instead gets a colour from EXTENDED_COLORS, picked by that empire's
 * stable rank (by empireId) among every such "overflow" empire — deterministic and distinct for up to 40 of them
 * (60 empires total: 20 key + 40 extended). Read-only: never touches empire.mainColor or galaxy.rnd.
 */
export function displayColorForEmpire(empire: Empire): number {
    const galaxy = empire.galaxy;
    if (galaxy == null || !scenarioFlag(galaxy, 'extendedPalette') || isKeyColor(empire.mainColor)) {
        return empire.mainColor;
    }
    const overflow = galaxy.empires
        .filter((e): e is Empire => e !== null && !isKeyColor(e.mainColor))
        .sort((a, b) => a.empireId - b.empireId);
    const rank = overflow.indexOf(empire);
    return rank < 0 ? empire.mainColor : EXTENDED_COLORS[rank % EXTENDED_COLORS.length];
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
