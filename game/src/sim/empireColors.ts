// Empire colours (task C2b). Ports of Galaxy.cs SelectColorFromKey (2633),
// SelectComplementaryColorKey (2555), DetermineUsedEmpireColors /
// CheckEmpireColorUsed / SelectUnusedMainColor (2386-2470),
// CheckListContainsColor / CheckColorsEqual. Colours are 0xRRGGBB numbers
// (alpha is always 255 in these tables); Color.Empty is 0.
// TODO(port): SelectColorFromKeyDark / pirate branches (C2d, pirates).

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

function determineUsedEmpireColors(galaxy: Galaxy, isPirateFaction: boolean): number[] {
    return (isPirateFaction ? galaxy.pirateEmpires : galaxy.empires).map((e) => e.mainColor);
}

export function checkEmpireColorUsed(galaxy: Galaxy, isPirateFaction: boolean, color: number): boolean {
    return determineUsedEmpireColors(galaxy, isPirateFaction).includes(color);
}

// Port of SelectUnusedMainColor (non-pirate path).
export function selectUnusedMainColor(galaxy: Galaxy, isPirateFaction: boolean): { color: number; unusedColorKey: number } {
    const used = determineUsedEmpireColors(galaxy, isPirateFaction);
    const list: number[] = [];
    const list2: number[] = [];
    for (let i = 0; i < 20; i++) {
        const c = isPirateFaction ? selectColorFromKey(i) /* TODO(port): SelectColorFromKeyDark */ : selectColorFromKey(i);
        if (!used.includes(c)) {
            list.push(c);
            list2.push(i);
        }
    }
    if (list.length > 0) {
        const index = galaxy.rnd.next(0, list.length);
        return { color: list[index], unusedColorKey: list2[index] };
    }
    // TODO(port): pirate branch (Rnd.Next(0,3) + dark RGB) — C2d.
    const r = galaxy.rnd.next(32, 256);
    const g = galaxy.rnd.next(32, 256);
    const b = galaxy.rnd.next(32, 256);
    return { color: (r << 16) | (g << 8) | b, unusedColorKey: -1 };
}
