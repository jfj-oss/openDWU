import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import {
    ForceStructureProjection,
    ForceStructureProjectionList,
    annualTaxRevenue,
    calculateAccurateAnnualIncome,
    calculateStateExpenditureBalance,
    csToInt32,
} from '../src/sim/forceStructure';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';

// Task M3b — Empire.9.cs ProjectForceStructure / ProjectPrivateForceStructure and
// Empire.4.cs IdentifyResourceCentres, run from GenerateEmpire's DoTasks stand-in. createGame
// later consumes the projections (Start.2.cs 1365 CreateStateShips / CreatePrivateShips), so these
// tests stop it right after the starting colonies (test-only __phaseHook).
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 60000);

function opts(techLevel: number, age: number): CreateGameOptions {
    const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age, techLevel });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: s('Human'),
        aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')],
    };
}

const S = BuiltObjectSubRole;
/** The galaxy at the GenerateEmpire DoTasks point: createGame stopped after the starting colonies. */
function atDoTasksPoint(o: CreateGameOptions): Galaxy {
    return createGame({ ...o, __phaseHook: (phase) => (phase === 'startingColonies' ? 'stop' : undefined) }).galaxy;
}
const listOf = (l: ForceStructureProjectionList | null) => (l === null ? null : l.items.map((p) => [S[p.subRole], p.amount]));
function summary(g: Galaxy) {
    return g.empires.map((e) => ({
        state: listOf(e.stateForceStructureProjections),
        private: listOf(e.privateForceStructureProjections),
        targets: e.resourceTargets.map((t) => [t.habitat!.habitatIndex, t.priority]),
    }));
}

describe('ProjectForceStructure / ProjectPrivateForceStructure at game start', () => {
    it('tech 0.5, age 1: explorers + construction ships; freighters and mining ships; deterministic', () => {
        const g = atDoTasksPoint(opts(0.5, 1));
        const a = summary(g);
        expect(a.length).toBe(4);
        for (const e of a) {
            // No ships yet: AnnualStateMaintenance = 0 and the tax income is 0, so num3 =
            // Max(1, 0/0) = NaN and every military amount is (int)NaN = int.MinValue → dropped
            // (the C# does the same). Hyperdrive → 7 explorers; 1 colony → 3 construction ships.
            expect(e.state).toEqual([['ExplorationShip', 7], ['ConstructionShip', 3]]);
            const priv = new Map(e.private!.map(([k, v]) => [k as string, v as number]));
            expect(priv.get('SmallFreighter')).toBeGreaterThan(0);
            expect(priv.get('MediumFreighter')).toBeGreaterThan(0);
            // One colony: Max(1, (int)(1 * 1.5)) * 2 mining ships of each kind.
            expect(priv.get('GasMiningShip')).toBe(2);
            expect(priv.get('MiningShip')).toBe(2);
            expect(priv.has('PassengerShip')).toBe(false); // < 2 colonies, no resort bases
            // IdentifyResourceCentres: sorted then reversed → descending priority.
            expect(e.targets.length).toBeGreaterThan(0);
            for (let i = 1; i < e.targets.length; i++) expect(e.targets[i - 1][1]).toBeGreaterThanOrEqual(e.targets[i][1]);
        }
        // Pinned for seed 1 (player empire).
        expect(a[0].private).toEqual([['SmallFreighter', 3], ['MediumFreighter', 1], ['GasMiningShip', 2], ['MiningShip', 2]]);
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        expect(a[0].targets.length).toBe(30);
        expect(summary(atDoTasksPoint(opts(0.5, 1)))).toEqual(a);
    }, 60000);

    it('tech 0 (pre-warp): 2 explorers + 2 construction ships, no military; doubled private counts', () => {
        const g = atDoTasksPoint(opts(0, 1));
        for (const e of summary(g)) {
            expect(e.state).toEqual([['ExplorationShip', 2], ['ConstructionShip', 2]]);
            const priv = new Map(e.private!.map(([k, v]) => [k as string, v as number]));
            // No hyperdrive: freighter base counts and mining ships are doubled.
            expect(priv.get('SmallFreighter')).toBeGreaterThanOrEqual(2);
            expect(priv.get('MiningShip')).toBe(4);
            expect(priv.get('GasMiningShip')).toBe(4);
        }
    }, 60000);

    it('age 0: private ships only where the nearest habitat to the capital has known resources, no mining targets', () => {
        const g = atDoTasksPoint(opts(0.5, 0));
        const a = summary(g);
        for (const e of a) {
            expect(e.state).toEqual([['ExplorationShip', 7], ['ConstructionShip', 3]]);
            expect(e.targets).toEqual([]);
        }
        // Pinned for seed 1 (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch, whose research-queue selection and research events draw Rnd): only the second empire's capital neighbour has known resources
        // (ProjectPrivateForceStructure flag), so only it projects freighters and mining ships.
        // Re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in each game-start Empire.DoTasks long block, so the
        // empires land elsewhere. (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785): now only the second
        // empire's capital neighbour has known resources, so only it projects freighters and mining ships.)
        expect(a.map((e) => e.private)).toEqual([
            [
            ],
            [
                [
                    'SmallFreighter',
                    2,
                ],
                [
                    'MediumFreighter',
                    1,
                ],
                [
                    'LargeFreighter',
                    1,
                ],
                [
                    'GasMiningShip',
                    2,
                ],
                [
                    'MiningShip',
                    2,
                ],
            ],
            [
            ],
            [
            ],
        ]);
    }, 60000);

    it('colony economy at the DoTasks point: tax snapshot −ColonyStateSupportCost, income 0', () => {
        const g = atDoTasksPoint(opts(0.5, 1));
        const e = g.playerEmpire!;
        const cap = e.capital!;
        // TakeOwnershipOfColony: RecalculateDistanceFactor (capital → 0). Re-pinned by M4j: the GenerateEmpire
        // Empire.DoTasks now runs EvaluateColonyVariables, which raises the capital's development level 10 → 15 (its
        // luxury cargo) before ReviewTaxes, so SetColonyTaxRate picks a positive rate (was 0 → −1000, i.e. only
        // −ColonyStateSupportCost) and the snapshot is AnnualRevenue × rate × TaxComplianceRate − 1000.
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785): the player capital is now Sol 2, rate 0.16f.)
        expect(cap.distanceFactor).toBe(0);
        expect(cap.taxRate).toBe(Math.fround(0.16));
        expect(cap.annualTaxRevenue).toBe(23487.80578889396);
        expect(annualTaxRevenue(g, e)).toBe(23487.80578889396);
        expect(calculateAccurateAnnualIncome(g, e)).toBe(23487.80578889396);
        const b = calculateStateExpenditureBalance(e, 0);
        const research = 1 - (b.shipMaintenancePortion + b.troopMaintenancePortion + b.facilityMaintenancePortion);
        expect(research).toBeGreaterThanOrEqual(0.06 - 1e-12);
        expect(research).toBeLessThanOrEqual(0.2 + 1e-12);
    }, 60000);
});

describe('ForceStructureProjectionList (ForceStructureProjectionList.cs)', () => {
    it('Diff yields one entry per subrole in enum order, clamped at 0', () => {
        const a = new ForceStructureProjectionList();
        a.add(new ForceStructureProjection(S.Escort, 5, 10));
        a.add(new ForceStructureProjection(S.MiningShip, 2, 10));
        const b = new ForceStructureProjectionList();
        b.add(new ForceStructureProjection(S.Escort, 2, 10));
        b.add(new ForceStructureProjection(S.MiningShip, 4, 10));
        const d = a.diff(b);
        expect(d.count).toBe(30);
        expect(d.items.map((p) => p.subRole)).toEqual(Array.from({ length: 30 }, (_, i) => i));
        expect(d.getBySubRole(S.Escort)!.amount).toBe(3);
        expect(d.getBySubRole(S.MiningShip)!.amount).toBe(0);
        expect(d.getBySubRole(S.Escort)!.projectionDate).toBe(-1);
        expect(a.totalAmount).toBe(7);
        const c = a.clone();
        c.get(0).amount = 9;
        expect(a.get(0).amount).toBe(5);
    });
    it('CompareTo orders by ObtainWeighting', () => {
        const esc = new ForceStructureProjection(S.Escort, 1, 0);
        const cons = new ForceStructureProjection(S.ConstructionShip, 1, 0);
        expect(esc.compareTo(cons)).toBe(1);
        expect(cons.compareTo(esc)).toBe(-1);
        expect(new ForceStructureProjection(S.MiningShip, 1, 0).compareTo(new ForceStructureProjection(S.GasMiningShip, 1, 0))).toBe(0);
    });
    it('csToInt32 mirrors C# (int)double incl. NaN → int.MinValue', () => {
        expect(csToInt32(3.9)).toBe(3);
        expect(csToInt32(-3.9)).toBe(-3);
        expect(csToInt32(Number.NaN)).toBe(-2147483648);
        expect(csToInt32(Number.POSITIVE_INFINITY)).toBe(-2147483648);
        expect(csToInt32(3e9)).toBe(-2147483648);
    });
});
