// New-game wizard options (task 06b). The slider tables are ports of the
// original's star-amount mapping (BaconStart.method_60, vanilla values) and
// physical-size mapping (Start.method_69): each is a small switch on the
// slider position with a fixed default for out-of-range values.

import { GalaxyShape } from './types';

/** Wizard page state carried into galaxy generation (task 06b). */
export interface StartGameOptions {
    /** Galaxy shape selected in the radio list. */
    shape: GalaxyShape;
    /** Star Amount slider position, 0..5 (Dwarf..Huge). */
    starCountIndex: number;
    /** Physical Size slider position, 0..4 (Tiny..Huge sectors). */
    dimensionIndex: number;
    /** Seed for deterministic generation. */
    seed: number;
}

/** Wizard defaults: Spiral selected, Standard stars (index 3), Medium size
 * (index 2); the seed is filled in by the UI (random re-roll). */
export function defaultStartGameOptions(): StartGameOptions {
    return {
        shape: GalaxyShape.Spiral,
        starCountIndex: 3,
        dimensionIndex: 2,
        seed: 1,
    };
}

// Port of BaconStart.method_60 (vanilla values): star amount slider → count.
const STAR_COUNTS = [100, 250, 400, 700, 1000, 1400];
const DEFAULT_STAR_COUNT = 400; // case 2 (Small) — the C# default when out of range

/** Map a Star Amount slider index to its star count; out-of-range → 400. */
export function starCountFor(index: number): number {
    if (index >= 0 && index < STAR_COUNTS.length) {
        return STAR_COUNTS[index];
    }
    return DEFAULT_STAR_COUNT;
}

// Port of Start.method_69: physical size slider → sector width/height (square).
const SECTOR_SIZES = [4, 6, 8, 10, 15];
const DEFAULT_SECTORS = 10; // case 3 (Large) — the C# default when out of range

/** Map a Physical Size slider index to the square sector count; out-of-range → 10. */
export function sectorsFor(index: number): number {
    if (index >= 0 && index < SECTOR_SIZES.length) {
        return SECTOR_SIZES[index];
    }
    return DEFAULT_SECTORS;
}