// New-game wizard options (task 06b). Headless — no DOM/Pixi imports.
import { GalaxyShape } from './types';
import type { Race } from './data/races';

export interface StartGameOptions {
    shape: GalaxyShape;
    /** Index into the star-amount slider (0..5), see starCountFor. */
    starCountIndex: number;
    /** Index into the physical-size slider (0..4), see sectorsFor. */
    dimensionIndex: number;
    seed: number;
    /** Task 06d: name of the player's race (a parsed races/*.txt Name).
     *  Empty until a race is chosen on the wizard's "Your Race" page. */
    raceName: string;
    /** Task 06e: empire display name. Default "<Race name> Empire"; the
     *  wizard re-derives it when the race changes and the user hasn't
     *  edited it (see defaultEmpireName / applyEmpireDefaults). */
    empireName: string;
    /** Task 06e: governmentId from governments.txt (-1 = not chosen yet;
     *  the wizard's "Your Empire" page fills it in). */
    governmentId: number;
    /** Task 06e: index 0..82 into images/ui/flagshapes/flagNN.png. */
    flagShapeIndex: number;
    /** Task 06e: flag primary colour (background), '#rrggbb'. */
    primaryColor: string;
    /** Task 06e: flag secondary colour (shape tint), '#rrggbb'. */
    secondaryColor: string;
}

/**
 * Port of Start.cs BaconStart.method_60 (vanilla star-amount slider values).
 * Dwarf/Tiny/Small/Standard/Large/Huge; out-of-range defaults to Standard.
 */
export function starCountFor(index: number): number {
    switch (index) {
        case 0:
            return 100;
        case 1:
            return 250;
        case 2:
            return 400;
        case 3:
            return 700;
        case 4:
            return 1000;
        case 5:
            return 1400;
        default:
            return 400;
    }
}

/**
 * Port of Start.cs Start.method_69 (physical-size slider values, sectors per
 * side). Tiny/Small/Medium/Large/Huge; out-of-range defaults to (10,10).
 */
export function sectorsFor(index: number): number {
    switch (index) {
        case 0:
            return 4;
        case 1:
            return 6;
        case 2:
            return 8;
        case 3:
            return 10;
        case 4:
            return 15;
        default:
            return 10;
    }
}

/** Task 06d: the wizard's default player race — the first playable race,
 * sorted by name. Falls back to the first race overall (still sorted) when
 * no race is playable, and '' when there are no races at all. */
export function defaultRaceName(races: Race[]): string {
    const sorted = [...races].sort((a, b) => a.name.localeCompare(b.name));
    const playable = sorted.find((r) => r.playable);
    return (playable ?? sorted[0])?.name ?? '';
}

/** Task 06e: the wizard's default empire name for a chosen race. */
export function defaultEmpireName(raceName: string): string {
    return `${raceName} Empire`;
}

/** Task 06e: the flag colour palette (12 colours); the wizard picks the
 * primary/secondary defaults deterministically by race index. */
export const FLAG_COLOR_PALETTE = [
    '#c8373a', // red
    '#e8a33d', // orange
    '#e8d24a', // yellow
    '#5aa05a', // green
    '#3a8f9e', // teal
    '#3a6fb0', // blue
    '#6a5acd', // indigo
    '#9e4fb0', // purple
    '#b05a8f', // pink
    '#8a6f4f', // brown
    '#9aa5b1', // grey
    '#f0f0f0', // white
] as const;

/** Task 06e: deterministic default flag colours for a race index —
 * primary at index % 12, secondary offset by 5. */
export function defaultFlagColors(raceIndex: number): { primary: string; secondary: string } {
    const n = FLAG_COLOR_PALETTE.length;
    const i = ((raceIndex % n) + n) % n;
    return {
        primary: FLAG_COLOR_PALETTE[i],
        secondary: FLAG_COLOR_PALETTE[(i + 5) % n],
    };
}

/** Task 06e: URL of a flag shape tile (flagNN.png, two-digit index). */
export function flagShapeUrl(index: number): string {
    return `/assets/dwu/images/ui/flagshapes/flag${String(index).padStart(2, '0')}.png`;
}

/** Task 06e: apply the "Your Empire" page defaults to options when the
 * user hasn't customised each field yet:
 * - empireName: "<Race name> Empire". Auto-updates when the race changes
 *   (prevRaceName) as long as the current name still equals the previous
 *   race's default (or is empty); a user-edited name survives.
 * - governmentId: -1 until the wizard's dropdown fills it in.
 * - flagShapeIndex / colours: deterministic pick from FLAG_COLOR_PALETTE
 *   by race index, only while the user hasn't touched them. */
export function applyEmpireDefaults(options: StartGameOptions, raceIndex: number, prevRaceName?: string): void {
    const prevDefault = prevRaceName !== undefined ? defaultEmpireName(prevRaceName) : '';
    if (options.empireName === '' || options.empireName === prevDefault) {
        options.empireName = defaultEmpireName(options.raceName);
    }
    if (options.governmentId < 0) {
        options.governmentId = -1;
    }
    if (options.flagShapeIndex < 0) {
        options.flagShapeIndex = raceIndex % 83;
    }
    if (options.primaryColor === '') {
        options.primaryColor = defaultFlagColors(raceIndex).primary;
    }
    if (options.secondaryColor === '') {
        options.secondaryColor = defaultFlagColors(raceIndex).secondary;
    }
}

/** Default new-game options: Spiral, star index 3 (Standard/700), dimension
 * index 2 (Medium/8x8), a random seed, no race chosen yet (the wizard's
 * "Your Race" page fills in raceName; see defaultRaceName). The "Your
 * Empire" fields start uncustomised so applyEmpireDefaults can fill them. */
export function defaultStartGameOptions(): StartGameOptions {
    return {
        shape: GalaxyShape.Spiral,
        starCountIndex: 3,
        dimensionIndex: 2,
        seed: Date.now() % 2147483647,
        raceName: '',
        empireName: '',
        governmentId: -1,
        flagShapeIndex: -1,
        primaryColor: '',
        secondaryColor: '',
    };
}
