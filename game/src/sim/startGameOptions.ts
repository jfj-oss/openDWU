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

/** Default new-game options: Spiral, star index 3 (Standard/700), dimension
 * index 2 (Medium/8x8), a random seed, no race chosen yet (the wizard's
 * "Your Race" page fills in raceName; see defaultRaceName). */
export function defaultStartGameOptions(): StartGameOptions {
    return {
        shape: GalaxyShape.Spiral,
        starCountIndex: 3,
        dimensionIndex: 2,
        seed: Date.now() % 2147483647,
        raceName: '',
    };
}
