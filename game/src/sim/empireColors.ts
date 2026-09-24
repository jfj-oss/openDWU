// Empire colours (task C2b/C2d). Ports of Galaxy.cs SelectColorFromKey (2633),
// SelectColorFromKeyDark (2714), SelectComplementaryColorKey (2555),
// DetermineUsedEmpireColors / CheckEmpireColorUsed / SelectUnusedMainColor
// (2386-2470), CheckListContainsColor / CheckColorsEqual,
// DetermineContrastDropShadowColor (2494-2507), DetermineSecondaryColor
// (2509-2530), DetermineContrastColor (2532-2538). Colours are 0xRRGGBB
// numbers (alpha is always 255 in these tables); Color.Empty is 0.

import type { Galaxy } from './galaxy';

const KEY_COLORS = [
    0x0000b0, 0x0040e8, 0x0080ff, 0x00ffff, 0x185018, 0x008000, 0x00cc00, 0xa0ff00, 0xffff20, 0xff681f, 0xff0030, 0x870000,
    0x604000, 0x907030, 0xe0c060, 0xa840ff, 0x7020cc, 0x843179, 0xff00ff, 0xffa6c9, 0xffffff, 0x999933, 0xc00080, 0x010101,
];

export function selectColorFromKey(key: number): number {
    return key >= 0 && key < KEY_COLORS.length ? KEY_COLORS[key] : 0;
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
