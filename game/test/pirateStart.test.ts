import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { PiratePlayStyle } from '../src/sim/pirates';
import { GalaxyShape } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// Play-as-pirate player start (Start.2.cs 567-729, bool_2).
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 60000);

function opts(): CreateGameOptions {
    const ai = { race: '(Random)', homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0.5 };
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0.5, playAsPirate: true, piratePlayStyle: PiratePlayStyle.Smuggler, name: 'Test Pirates' },
        aiEmpires: [ai, ai, ai],
    };
}

describe('createGame play-as-pirate', () => {
    it('player is a pirate faction with a fuel base near independents; AIs are normal empires', () => {
        const game = createGame(opts());
        const g = game.galaxy;
        const p = game.playerEmpire;
        expect(g.playerEmpire).toBe(p);
        expect(g.pirateEmpires).toContain(p);
        expect(g.empires).not.toContain(p);
        expect(p.name).toBe('Test Pirates');
        expect(p.piratePlayStyle).toBe(PiratePlayStyle.Smuggler);
        const base = p.pirateEmpireBaseHabitat!;
        const fuel = g.resourceSystem.fuelResources[0].resourceId;
        expect(base.resources.some((r) => r.resourceId === fuel)).toBe(true);
        expect(g.empires.length).toBe(3);
        for (const e of g.empires) expect(e.colonies.length).toBeGreaterThanOrEqual(1);
        expect(p.designs.length).toBeGreaterThan(0);
    }, 60000);
    it('is deterministic', () => {
        const run = () => {
            const g = createGame(opts()).galaxy;
            return [g.playerEmpire!.pirateEmpireBaseHabitat!.name, ...g.empires.map((e) => e.capital!.name)];
        };
        expect(run()).toEqual(run());
    }, 60000);
});
