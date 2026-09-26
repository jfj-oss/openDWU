// Galaxy.5.cs 4472 (InvestigateRuins, RuinType.Origins): `ruin.OriginsRace.SatisfactionModifier +=
// ruin.OriginsApprovalRatingBonus` mutates the race object of the galaxy (Galaxy.4.cs 2132 `Races = LoadRaces(...)`: every
// C# galaxy owns its Races, serialized with the game). The TS galaxy owns copies of the GameData races (cloneGalaxyRaces):
// the ruin must not touch the shared GameData race, a second galaxy must not see it, and it must survive save/load.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { tickGameOptions } from './helpers/tickGame';
import { createGame } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import { investigateRuins } from '../src/sim/exploration';
import { Ruin, RuinType } from '../src/sim/ruins';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 180000);

describe('Origins ruin satisfaction modifier is per galaxy', () => {
    it('mutates the galaxy race only and round-trips through the save', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = g.playerEmpire!;
        const race = player.dominantRace!;
        const shared = gameData.races.find((r) => r.name === race.name)!;
        expect(race).not.toBe(shared);
        expect(g.races).toContain(race);
        const before = shared.satisfactionModifier;
        expect(race.satisfactionModifier).toBe(before);

        const habitat = g.systems.flatMap((s) => s.habitats).find((h) => h.ruin == null && h.population.items.length === 0 && h.empire == null)!;
        const ruin = new Ruin('Test Origins', 0, 0, 0, 0, 0, 0, 0);
        ruin.type = RuinType.Origins;
        ruin.originsRace = race;
        ruin.originsApprovalRatingBonus = 12;
        habitat.ruin = ruin;
        investigateRuins(g, player, habitat);

        expect(race.satisfactionModifier).toBe(before + 12);
        expect(shared.satisfactionModifier).toBe(before);
        const g2 = createGame(tickGameOptions(gameData)).galaxy; // a new galaxy (built here, not the test game cache)
        expect(g2.races.find((r) => r.name === race.name)!.satisfactionModifier).toBe(before);

        const loaded = galaxyFromJSON(JSON.parse(JSON.stringify(galaxyToJSON(g))), gameData);
        const loadedRace = loaded.playerEmpire!.dominantRace!;
        expect(loaded.races).toContain(loadedRace);
        expect(loadedRace).not.toBe(shared);
        expect(loadedRace.satisfactionModifier).toBe(before + 12);
        expect(shared.satisfactionModifier).toBe(before);
    }, 300000);
});
