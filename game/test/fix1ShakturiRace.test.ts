// Galaxy.8.cs 1348 GenerateShakturi renames / re-levels Races["Shakturi"]: the TS galaxy gets its own race instance
// (Galaxy.shakturiActualRace, galaxy.ts galaxyRace) — the GameData race is untouched, a second galaxy in the same
// process still sees "Shakturi", and the instance survives save/load.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import { galaxyRaceByName, generateShakturiReturnTriggerRuins, investigateRuinsStoryEvent } from '../src/sim/story/storyEvents';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 180000);

function storyOptions(gd: GameData): CreateGameOptions {
    return { ...tickGameOptions(gd), storyReturnOfTheShakturiEnabled: true, storyDistantWorldsEnabled: false, storyShadowsEnabled: false };
}

describe('GenerateShakturi race instance is per galaxy', () => {
    it('does not touch the GameData race, is not seen by another galaxy, and survives save/load', () => {
        const shared = gameData.races.find((r) => r.name === 'Shakturi')!;
        const snap = { ...shared };
        const g = createGame(storyOptions(gameData)).galaxy;
        generateShakturiReturnTriggerRuins(g);
        const beacon = g.shakturiTriggerHabitat!;
        const n = g.empires.length;
        investigateRuinsStoryEvent(g, g.playerEmpire!, beacon, '');
        const erutkah = g.empires[n];
        expect(erutkah.dominantRace).toBe(g.shakturiActualRace);
        expect(erutkah.dominantRace!.name).toBe('Erutkah');
        expect(galaxyRaceByName(g, 'Erutkah')).toBe(g.shakturiActualRace);
        expect(galaxyRaceByName(g, 'Shakturi')).toBeNull();
        expect({ ...shared }).toEqual(snap);

        const g2 = createGame(storyOptions(gameData)).galaxy;
        expect(galaxyRaceByName(g2, 'Shakturi')).toBe(shared);
        expect(galaxyRaceByName(g2, 'Erutkah')).toBeNull();

        const loaded = galaxyFromJSON(JSON.parse(JSON.stringify(galaxyToJSON(g))), gameData);
        const erutkah2 = loaded.empires[n];
        expect(erutkah2.dominantRace).toBe(loaded.shakturiActualRace);
        expect(erutkah2.dominantRace!.name).toBe('Erutkah');
        expect(erutkah2.dominantRace!.aggression).toBe(75);
        expect(loaded.shakturiRaceBase).toBe(shared);
        expect(galaxyRaceByName(loaded, 'Erutkah')).toBe(loaded.shakturiActualRace);
        expect({ ...shared }).toEqual(snap);
    }, 300000);
});
