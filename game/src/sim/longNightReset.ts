// The Long Night's reset (ours): build the next cycle's galaxy. Takes the old game's own new-game options (kept in its scenario state when the
// Giantworks option "The Harvest Cycle" is on: scenario/threats/giantworks/longNightState.ts recordCreateOptions), turns the start into a
// PRE-WARP one (the stock Expansion "PreWarp" galaxy and tech level 0 for every empire: no space ports, no ships, the primitive-hyperdrive
// research ruin in each home system, the stock pre-warp economy and our pre-warp build order), keeps the player's race / name / colours,
// and runs the stock createGame with the SAME galaxy seed: the same stars, planets and sectors, new empires. Deterministic: the same old
// state and data give the same new game (createGame draws only from its seed). Then the Age 2 record goes into the new galaxy's scenario
// state and the start messages go out (longNight.ts).
//
// Who swaps the result in: the driver that sees galaxyResetPending (simworker/worker.ts loop; test harnesses call performGalaxyReset).
// No DOM, no Pixi.

import type { Galaxy } from './galaxy';
import type { GameData } from './data/gameData';
import { createGame, installGameStatics, registerGameHooks, type CreateGameOptions, type EmpireStartOptions, type Game } from './game';
import { GalaxyTime } from './galaxyTime';
import { VictoryConditions } from './victory';
import { AGE_PREPARATION, longNightState, memoryContributors, peekLongNight, type MemoryRecord } from './scenario/threats/giantworks/longNightState';
import { markCrashSites, sendAge2Start } from './scenario/threats/giantworks/longNight';

/**
 * The new-game options of the Age 2 galaxy: the old game's own, with `foundPreWarp` (game.ts: the map is generated from the options as they
 * were, so it is the same map; then every empire is founded pre-warp). The player's race and government are left as the options had them
 * ('(Random)' resolves to the same race: the same seed and the same options draw the same); only what the wizard's pick or a random draw
 * made after generation (name, colours, flag) is pinned to the empire the player had. Pure; `gameData` is the game's own (overlay applied).
 */
export function age2CreateOptions(stored: Record<string, unknown>, gameData: GameData, memory: MemoryRecord): CreateGameOptions {
    const o = { ...(stored as unknown as Omit<CreateGameOptions, 'gameData'>), gameData } as CreateGameOptions;
    if (o.victoryConditions != null && !(o.victoryConditions instanceof VictoryConditions)) o.victoryConditions = Object.assign(new VictoryConditions(), o.victoryConditions);
    const id = memory.player;
    const player: EmpireStartOptions = id === null ? o.player : { ...o.player, name: id.name, primaryColor: id.primaryColor, secondaryColor: id.secondaryColor, flagShape: id.flagShape };
    return { ...o, foundPreWarp: true, player, ...(id === null ? {} : { playerFlagShape: id.flagShape }) };
}

/**
 * The Age 2 game, built from the old one at the moment its Long Night began (state.longNight.pending). Throws when the old galaxy has no
 * pending Long Night or kept no new-game options. The caller installs the game's statics before (the worker has them; headless callers
 * pass the same `gameData` they built the old game with).
 */
export function buildAge2Game(old: Game, gameData: GameData): Game {
    const ln = peekLongNight(old.galaxy);
    const memory = ln?.pending ?? null;
    if (ln === null || memory === null || ln.createOptions === undefined) throw new Error('buildAge2Game: no Long Night is pending in this galaxy');
    installGameStatics(gameData);
    registerGameHooks();
    const game = createGame(age2CreateOptions(ln.createOptions, gameData, memory));
    seedAge2(game.galaxy, memory);
    return game;
}

/** What the new galaxy gets after createGame: the age, the memory record, the crash sites, the start messages. Draws no Rnd. */
export function seedAge2(galaxy: Galaxy, memory: MemoryRecord): void {
    if (galaxy.scenario === null) throw new Error('seedAge2: the new galaxy has no scenario (the Harvest Cycle option needs the Giantworks add-on)');
    const st = longNightState(galaxy);
    st.age = AGE_PREPARATION;
    st.memory = memory;
    st.pending = null;
    markCrashSites(galaxy);
    for (const c of memoryContributors()) c.restore?.(galaxy, memory.extra[c.id]);
    sendAge2Start(galaxy);
}

/**
 * The whole swap for a driver that holds the old game and its clock: the new game and the clock over it (speed and pause as they were; the
 * game starts paused so the opening popups are read first).
 */
export function performGalaxyReset(old: Game, time: GalaxyTime, gameData: GameData): { game: Game; time: GalaxyTime } {
    const game = buildAge2Game(old, gameData);
    time.paused = true;
    time.bindGalaxy(game.galaxy);
    return { game, time };
}
