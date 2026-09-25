import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape, HabitatType } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

// Task C2c-4b — Galaxy.7.cs FindNearestColonizableHabitat[UnoccupiedSystem]
// wired into the Start.2.cs (~985-1060) starting-colonies loop: at age >= 2
// GalaxyClass.DetermineEmpireExpansion (Galaxy.7.cs) gives each empire an
// expansion factor > 2, so they get more than one starting colony, and each
// extra colony must be a habitat type the empire can actually colonize.
let gameData: GameData;
beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

function opts(age: number, techLevel: number): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age, techLevel });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age, techLevel },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
    };
}

function summary(o: CreateGameOptions) {
    const g = createGame(o).galaxy;
    return g.empires.map((e) => ({
        name: e.name,
        colonyCount: e.colonies.length,
        // Colonizable types (aside from the capital's own type, which is
        // fixed by the race's native habitat and not re-selected here).
        colonyTypes: e.colonies.map((c) => c.type),
        // colonizableHabitatTypesForEmpire() plus the dominant race's native
        // type (game.ts appends it before the extra-colony type pick, per
        // Start.2.cs 1036: list11.Add(byEmpireId.DominantRace.NativeHabitatType)).
        colonizable: [...e.colonizableHabitatTypesForEmpire(), e.dominantRace!.nativeHabitatType],
    }));
}

describe('starting colonies (extra colonies at age >= 2)', () => {
    it('seed 1, techLevel 0.5, age 2: empires get more than one colony, all habitable types they can colonize', () => {
        const a = summary(opts(2, 0.5));
        expect(a.length).toBe(4);
        for (const e of a) {
            expect(e.colonyCount).toBeGreaterThan(1);
        }
        // Extra colonies come either from FindNearestColonizableHabitat[UnoccupiedSystem]
        // (Galaxy.7.cs 1861/1903), which accepts an already-populated
        // independent habitat of any type (Empire.CanDesignColonizeHabitat,
        // Empire.7.cs 1509, habitat.Population.TotalAmount > 0 branch) without
        // retyping it, or from the fallback search (Start.2.cs ~1000-1075),
        // which does retype the habitat to a type in `colonizable`. So not
        // every colony's type need be in `colonizable` — check the ones that
        // are, and separately note (via the pin below) which are not.
        // (re-pinned M4u: game-start character reviews / DoRaceEvent Rnd move placement; now 3 already-populated colonies.)
        // (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets' game-start NextDouble moves placement; now 1.)
        let outsideColonizable = 0;
        for (const e of a) {
            for (const t of e.colonyTypes) {
                if (!e.colonizable.includes(t)) outsideColonizable++;
            }
        }
        // Haakonish Corporation's 2nd colony (found already-populated; re-pinned M4k, M4s1; re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785)).
        expect(outsideColonizable).toMatchPin('startingColonies.alreadyInhabitedExceptions', 2);
        // Pinned for seed 1 (TS port; C# parity ends at the first Empire.DoTasks, unported).
        expect(a.map((e) => e.colonyCount)).toMatchPin('startingColonies.colonyCounts');
        // (re-pinned M4k: game-start research shifts the Rnd stream.)
        // (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in each game-start Empire.DoTasks long block.)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        // (re-pinned M4u: see above.)
        // (re-pinned M4m: see above.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        expect(a.map((e) => e.colonyTypes)).toMatchPin('startingColonies.colonyTypes');
        // Determinism.
        expect(summary(opts(2, 0.5))).toEqual(a);
    }, 60000);
});
