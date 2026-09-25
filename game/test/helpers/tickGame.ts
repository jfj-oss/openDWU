// Shared createGame config for the M4a tick tests: seed 1, Spiral, 300 stars, 8x8 sectors, Human + 3 random AIs,
// tech level 0.5, pirates on, age 1.
// Age 1 is the game's default "Starting" empire start: Main.Part9.cs 2680 defaults YourEmpireExpansion = 1, which
// Start.1.cs 3711-3715 / Start.cs 4302 (method_57: "Starting" -> 1) map to Age 1 (age 0 is the PreWarp start).
import { createGame, type CreateGameOptions, type Game } from '../../src/sim/game';
import { GalaxyShape } from '../../src/sim/types';
import type { GameData } from '../../src/sim/data/gameData';

export function tickGameOptions(gameData: GameData): CreateGameOptions {
    const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')],
        piratePrevalence: 1.0,
        // Pre-warp galaxy (Galaxy.Age / StartingAge 0) with age-0 empires, as before galaxyAge defaulted to 1 (M4x).
        galaxyAge: 0,
    };
}

export function createTickGame(gameData: GameData): Game {
    return createGame(tickGameOptions(gameData));
}

/** The same config with every empire at `age` (0 = the PreWarp start). */
export function createTickGameAtAge(gameData: GameData, age: number): Game {
    const o = tickGameOptions(gameData);
    return createGame({ ...o, player: { ...o.player, age }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age })) });
}
