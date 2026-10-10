// Hot-seat human players chosen in the new-game wizard (multiplayer Phase 2, docs/MULTIPLAYER.md §7). Not in the C#:
// DW:U has exactly one human. StartGameOptions.humanPlayers lists the EXTRA humans (players 2..N); player 1 is the
// wizard's own "Your Race" / "Your Empire" choice, as today. Absent (or empty) = one human, today's game, so every
// single-player start and save is unchanged.
//
// Headless: no DOM / Pixi. No Rnd.

import type { GameData } from './data/gameData';
import type { EmpireStartOptions } from './game';

/** One extra human player (a row of the wizard's "Human players (hot seat)" list). */
export interface HumanPlayerStart {
    /** Empire display name ('' = the "<Race> Empire" default, as for a manual AI row). */
    name: string;
    /** Race name (a parsed races/*.txt Name), '' = (Random). */
    race: string;
    /** Government id from governments.txt, -1 = (Random). */
    governmentId: number;
    /** Flag primary colour (background), '#rrggbb'. */
    primaryColor: string;
    /** Flag secondary colour (shape tint), '#rrggbb'. */
    secondaryColor: string;
}

/** Most humans on one PC (player 1 + this many extra rows). */
export const HOT_SEAT_EXTRA_HUMANS_MAX = 7;

/** The extra humans of a start (the field may be absent). */
export function extraHumanPlayers(o: { humanPlayers?: readonly HumanPlayerStart[] }): readonly HumanPlayerStart[] {
    return o.humanPlayers ?? [];
}

/** Total humans of a start: player 1 plus the extra rows. */
export function humanPlayerCount(o: { humanPlayers?: readonly HumanPlayerStart[] }): number {
    return 1 + extraHumanPlayers(o).length;
}

function parseHex(c: string, fallback: number): number {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    return m === null ? fallback : parseInt(m[1], 16);
}

/**
 * The EmpireStartOptions of the extra humans, for createGame (hand-off: the Phase 1 "createGame taking N humans" work
 * calls this from toCreateGameOptions; nothing calls it yet). Each extra human starts like player 1 (`player`: the same
 * age, tech level, home-system quality and corruption, a random start location) with its own race, government, name
 * and flag colours; the flag shape is player 1's (the wizard does not offer a per-player shape yet).
 */
export function humanPlayerEmpireStarts(humans: readonly HumanPlayerStart[], gameData: GameData, player: EmpireStartOptions): EmpireStartOptions[] {
    return humans.map((h) => ({
        ...(h.name === '' ? {} : { name: h.name }),
        race: h.race === '' ? '(Random)' : h.race,
        governmentStyle: h.governmentId >= 0 ? (gameData.governments[h.governmentId]?.name ?? '(Random)') : '(Random)',
        homeSystemFavourability: player.homeSystemFavourability,
        startLocation: '(Random)',
        age: player.age,
        techLevel: player.techLevel,
        ...(player.corruptionMultiplier !== undefined ? { corruptionMultiplier: player.corruptionMultiplier } : {}),
        primaryColor: parseHex(h.primaryColor, 0x808080),
        secondaryColor: parseHex(h.secondaryColor, 0xffffff),
        ...(player.flagShape !== undefined ? { flagShape: player.flagShape } : {}),
    }));
}
