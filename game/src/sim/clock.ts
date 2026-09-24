// Game clock state for the streamlined HUD (task 05c). The original drives
// galaxy time from Main.Part*.cs via a paused flag and a game-speed index;
// here we keep just the two fields the HUD needs. Speeds are the original's
// set of discrete multipliers (Main.Part12.cs game speed buttons).

export const GAME_SPEEDS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8];

export interface GameClock {
    /** True while the simulation is frozen (play/pause button / spacebar). */
    paused: boolean;
    /** Current speed multiplier (one of GAME_SPEEDS). */
    speed: number;
}

/** A fresh clock: running at 1x. */
export function createGameClock(): GameClock {
    return { paused: false, speed: 1 };
}

/**
 * Step the speed one notch in `dir` (+1 faster, -1 slower), clamped to the
 * ends of GAME_SPEEDS. Pure: returns the new speed value.
 */
export function stepSpeed(speed: number, dir: number): number {
    let i = GAME_SPEEDS.indexOf(speed);
    if (i < 0) {
        // Unknown speed (shouldn't happen): snap to the closest entry.
        i = 0;
        let bestDist = Infinity;
        for (let j = 0; j < GAME_SPEEDS.length; j++) {
            const d = Math.abs(GAME_SPEEDS[j] - speed);
            if (d < bestDist) {
                bestDist = d;
                i = j;
            }
        }
    }
    i += dir;
    i = Math.max(0, Math.min(GAME_SPEEDS.length - 1, i));
    return GAME_SPEEDS[i];
}