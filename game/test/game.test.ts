import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// Task C2c-4 — createGame (Start.2.cs method_81 region + Galaxy.7.cs GenerateEmpire).
let gameData: GameData;
beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

function opts(): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0 },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
    };
}
function summary(o: CreateGameOptions) {
    const g = createGame(o).galaxy;
    return g.empires.map((e) => ({ name: e.name, capital: g.systems[e.capital!.systemIndex].systemStar.name, colonies: e.colonies.length }));
}

describe('createGame', () => {
    it('seed 1: player + 3 AIs placed, deterministic', () => {
        const a = summary(opts());
        // Pinned for seed 1 (TS port; C# parity diverges at the first Empire.DoTasks, unported).
        // (re-pinned: design generation + colonizable-habitat search)
        // (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch, whose research-queue selection and research events draw Rnd)
        // (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in each game-start Empire.DoTasks long block)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        // (re-pinned M4u: game-start character reviews (ReviewCharacterTraits Rnd) and ReviewEmpireEvents (DoRaceEvent Rnd))
        // (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        expect(a.map((e) => e.capital)).toMatchPin('game.capitals');
        expect(a.map((e) => e.colonies)).toEqual([1, 1, 1, 1]);
        expect(a.length).toBe(4);
        for (const e of a) expect(e.colonies).toBeGreaterThanOrEqual(1);
        expect(new Set(a.map((e) => e.capital)).size).toBe(4);
        expect(summary(opts())).toEqual(a);
    }, 60000);
});
