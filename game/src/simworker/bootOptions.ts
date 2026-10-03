// Sim worker: createGame options across the thread boundary (docs/sim-worker.md §5). The options are structured-cloned
// into the worker, which loses class prototypes and functions: gameData stays behind (the worker loads its own copy
// from the same URLs), the phase hook (tests only) is dropped, and class-typed options are rebuilt — so createGame in
// the worker gets options equal to the main thread's and builds the identical game (test/simWorker.test.ts).
// No DOM / Pixi imports.

import type { CreateGameOptions } from '../sim/game';
import type { GameData } from '../sim/data/gameData';
import { VictoryConditions } from '../sim/victory';

/** The cloneable part of createGame options (main thread → worker). */
export function workerCreateOptions(opts: CreateGameOptions): Omit<CreateGameOptions, 'gameData'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { gameData, __phaseHook, ...rest } = opts;
    return rest;
}

/** Rebuild createGame options in the worker: the class instances, and the worker's gameData. */
export function reviveCreateOptions(o: Omit<CreateGameOptions, 'gameData'>, gameData: GameData): CreateGameOptions {
    const out: CreateGameOptions = { ...o, gameData };
    if (o.victoryConditions != null && !(o.victoryConditions instanceof VictoryConditions)) out.victoryConditions = Object.assign(new VictoryConditions(), o.victoryConditions);
    return out;
}
