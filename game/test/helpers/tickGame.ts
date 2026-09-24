// Shared createGame config for the M4a tick tests: seed 1, Spiral, 300 stars, 8x8 sectors, Human + 3 random AIs,
// tech level 0.5, pirates on.
import { createGame, type CreateGameOptions, type Game } from '../../src/sim/game';
import { GalaxyShape } from '../../src/sim/types';
import type { GameData } from '../../src/sim/data/gameData';

export function tickGameOptions(gameData: GameData): CreateGameOptions {
    const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 0, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')],
        piratePrevalence: 1.0,
    };
}

export function createTickGame(gameData: GameData): Game {
    return createGame(tickGameOptions(gameData));
}
