import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { setGovernmentsStatic } from '../src/sim/empire';
import { GalaxyShape } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { setColonyResources } from '../src/sim/colony';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import {
    checkColoniesForBaseFacilities,
    createMiningStations,
    createResearchStations,
    createSpacePorts,
    determineNewSpacePortLocations,
    determineResearchStationLocation,
    setLuxuryResourcesAtColonies,
} from '../src/sim/stationPlacement';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(): CreateGameOptions {
    const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')],
    };
}

const S = BuiltObjectSubRole;

function traceRnd(g: Galaxy, log: string[]): void {
    const rnd = g.rnd as unknown as { next: (a?: number, b?: number) => number; nextDouble: () => number };
    const next = rnd.next.bind(rnd);
    const nextDouble = rnd.nextDouble.bind(rnd);
    rnd.next = (a?: number, b?: number) => {
        const v = next(a, b);
        log.push(`Next(${a},${b})`);
        return v;
    };
    rnd.nextDouble = () => {
        const v = nextDouble();
        log.push('NextDouble');
        return v;
    };
}

// createGame's own per-empire station steps (Start.2.cs 1139-1318) with the Rnd draws of each step
// recorded at the phase boundaries (test-only __phaseHook); stopped after the per-empire setup.
function run() {
    const log: string[] = [];
    const phases: Record<string, string[]>[] = [];
    const researchTargets: Habitat[][] = [];
    let mark = 0;
    let ph: Record<string, string[]> = {};
    const take = (name: string) => {
        ph[name] = log.slice(mark);
        mark = log.length;
    };
    const g = createGame({
        ...opts(),
        __phaseHook: (phase, gal, e) => {
            switch (phase) {
                case 'firstGalaxyTick':
                    traceRnd(gal, log);
                    break;
                case 'empire:colonyRecalc':
                    ph = {};
                    mark = log.length;
                    break;
                case 'empire:spacePorts':
                    take('ports');
                    break;
                case 'empire:portColonyResources':
                    take('colonyResources');
                    break;
                case 'empire:unlockTechRuin':
                    mark = log.length;
                    break;
                case 'empire:researchLocations':
                    take('researchLocations');
                    researchTargets.push(e!.researchHabitats.slice());
                    break;
                case 'empire:researchStations':
                    take('research');
                    break;
                case 'empire:miningStations':
                    take('mining');
                    break;
                case 'empire:luxury':
                    take('luxury');
                    phases.push(ph);
                    break;
                case 'empireSetup':
                    return 'stop';
            }
            return undefined;
        },
    }).galaxy;
    return { g, phases, researchTargets };
}

/** createGame stopped before the per-empire setup (no space ports yet). */
function beforeEmpireSetup(): Galaxy {
    return createGame({ ...opts(), __phaseHook: (phase) => (phase === 'firstGalaxyTick' ? 'stop' : undefined) }).galaxy;
}

// The bases of the per-empire setup (independent traders from the first galaxy tick excluded).
function summary(g: Galaxy) {
    return g.builtObjects.filter((b) => b.empire !== g.independentEmpire).map((b) => [b.builtObjectID, b.empire!.name, S[b.subRole], b.name, b.parentHabitat!.name, Math.round(b.xpos), Math.round(b.ypos), b.heading]);
}

describe('M3d station placement at game start (tech 0.5, age 1)', () => {
    it('space ports: 1 + trunc(colonies / 4.5) at the highest-value colonies, added to empire/galaxy lists', () => {
        const { g, researchTargets } = run();
        void researchTargets;
        for (const e of g.empires) {
            const ports = e.builtObjects.filter((b) => b.subRole === S.SmallSpacePort || b.subRole === S.MediumSpacePort || b.subRole === S.LargeSpacePort);
            expect(ports.length).toBe(1 + Math.trunc(e.colonies.length / 4.5));
            expect(e.spacePorts).toEqual(ports);
            const port = ports[0];
            expect(port.parentHabitat).toBe(e.capital);
            // Single colony: a Large port design is downgraded to Medium (Galaxy.8.cs 1248).
            expect(port.subRole).toBe(S.MediumSpacePort);
            expect(port.name).toBe(`${e.capital!.name} Space Port`);
            expect(e.capital!.basesAtHabitat).toContain(port);
            expect(e.capital!.hasSpacePort).toBe(true);
            expect(g.builtObjects).toContain(port);
            expect(port.nearestSystemStar).toBe(g.determineHabitatSystemStar(e.capital!));
            // SelectRelativePoint(Diameter / 6 + 15) offset.
            expect(Math.hypot(port.parentOffsetX, port.parentOffsetY)).toBeLessThanOrEqual(Math.trunc(e.capital!.diameter / 6) + 15);
        }
    }, 60000);

    it('DetermineNewSpacePortLocations sorts by StrategicValue (then population) descending with no ports yet', () => {
        const g = beforeEmpireSetup();
        const e = g.empires[0];
        const capitals = g.empires.map((x) => x.capital!);
        const got = determineNewSpacePortLocations(g, e, capitals, 2, false);
        const sorted = capitals.slice().sort((a, b) => b.population.totalAmount - a.population.totalAmount);
        expect(got.length).toBe(2);
        // All capitals have DevelopmentLevel 0 → StrategicValue 10000 (the floor): population decides.
        expect(got).toEqual(sorted.slice(0, 2));
        expect(determineNewSpacePortLocations(g, e, capitals, 0, false)).toEqual([]);
    }, 60000);

    it('research stations at the best ResearchHabitats, mining stations at resource targets; exact Rnd draws; deterministic', () => {
        const { g, phases, researchTargets } = run();
        expect(summary(g)).toEqual(PINNED);
        // Rnd per empire and phase (C# order, Start.2.cs 1136-1318).
        const port = ['NextDouble', 'NextDouble', 'NextDouble']; // SelectRelativePoint (range + heading), SelectRandomHeading
        const research = ['NextDouble', 'NextDouble', 'Next(0,4)', 'NextDouble']; // surface point, name, heading
        const mining6 = Array(18).fill('NextDouble'); // 6 × (surface point ×2 + heading)
        const mining6plusSkip = Array(20).fill('NextDouble'); // + one candidate with a base: point drawn, nothing built
        expect(phases.map((p) => p.ports)).toEqual([port, port, port, port]);
        expect(phases.map((p) => p.researchLocations)).toEqual([[], [], [], []]);
        // (re-pinned M4k: after game-start research shifts the Rnd stream, the fourth empire has no research target.)
        // (re-pinned M4s1: ReviewPirateRelations' game-start Rnd draw moves the empires; all four now have a research target
        // and the fourth empire skips one occupied mining candidate.)
        expect(phases.map((p) => p.research)).toEqual([research, research, research, research]);
        expect(phases.map((p) => p.mining)).toEqual([mining6plusSkip, mining6, mining6plusSkip, mining6plusSkip]);
        expect(phases.map((p) => p.luxury)).toEqual([[], [], [], []]);
        for (let i = 0; i < g.empires.length; i++) {
            const e = g.empires[i];
            const stations = e.builtObjects.filter((b) => b.subRole === S.EnergyResearchStation || b.subRole === S.WeaponsResearchStation || b.subRole === S.HighTechResearchStation);
            if (researchTargets[i].length === 0) {
                expect(stations.length).toBe(0);
            } else {
                // 1 + (int)(Colonies.Count * 0.35) = 1 station, at ResearchHabitats[0] (lowest 1 - bonus).
                expect(stations.length).toBe(1);
                const st = stations[0];
                expect(st.parentHabitat).toBe(researchTargets[i][0]);
                expect(e.researchFacilities).toContain(st);
                expect(st.parentHabitat!.basesAtHabitat).toContain(st);
                // Retrofit cargo (habitat.Empire != empire).
                expect(st.cargo!.items.length).toBeGreaterThan(0);
                // Re-determined after building: the occupied habitat is no longer a target.
                expect(e.researchHabitats).not.toContain(st.parentHabitat);
            }
            // Mining: Max(6, (int)(Colonies * 1.5)) = 6, private, one per habitat.
            const mines = e.privateBuiltObjects.filter((b) => b.subRole === S.MiningStation || b.subRole === S.GasMiningStation);
            expect(mines.length).toBe(6);
            expect(e.miningStations).toEqual(mines);
            expect(new Set(mines.map((m) => m.parentHabitat)).size).toBe(6);
            for (const m of mines) {
                expect(m.parentHabitat!.empire).toBeNull();
                expect(m.parentHabitat!.basesAtHabitat[0]).toBe(m);
            }
            // SetLuxuryResourcesAtColonies: baseline recomputed, level = 5 × min(3 + sqrt(pop/1e8), 10, self-supplied).
            const c = e.capital!;
            expect(c.developmentLevelBaseline).toBe(Math.trunc(50 * Math.min(1, c.population.totalAmount / 5e8)));
            const val = Math.min(3 + Math.trunc(Math.sqrt(Math.trunc(c.population.totalAmount / 1e8))), Math.min(10, e.selfSuppliedLuxuryResources!.length));
            expect(c.developmentLevel).toBe(val * 5);
        }
        expect(summary(run().g)).toEqual(summary(g));
    }, 60000);
});

// Pinned for seed 1 (TS port): [id, empire, subRole, name, parent, x, y, heading].
// (re-pinned: createGame now runs the first galaxy tick before this loop — its 150 independent
// traders take ids 1-150 and their Rnd draws shift the station points/headings/names.)
// (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch — SelectNextResearchProject draws
// Rnd (SelectRandomLowestProject) and research events draw Next(0, num4) per industry — so later game-start
// Rnd draws shift.)
// (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in every game-start Empire long block and the Galaxy long
// block's independent-colony pirate offers draw per colony, so the station points / headings / names shift.)
const PINNED: unknown[] = [
    [
        151,
        'S147 Kingdom',
        'MediumSpacePort',
        'Hotaulf Space Port',
        'Hotaulf',
        4692135,
        1539092,
        -3.0554680824279785,
    ],
    [
        152,
        'S147 Kingdom',
        'WeaponsResearchStation',
        'S251 Research Facility',
        'S251 3',
        4865402,
        948073,
        -0.2632638216018677,
    ],
    [
        153,
        'S147 Kingdom',
        'GasMiningStation',
        'S147 2 Gas Mining Station',
        'S147 2',
        4718504,
        1548651,
        -1.5602401494979858,
    ],
    [
        154,
        'S147 Kingdom',
        'GasMiningStation',
        'S147 4 Gas Mining Station',
        'S147 4',
        4693665,
        1538347,
        -2.686237096786499,
    ],
    [
        155,
        'S147 Kingdom',
        'GasMiningStation',
        'S147 3 Gas Mining Station',
        'S147 3',
        4722288,
        1541442,
        2.2755796909332275,
    ],
    [
        156,
        'S147 Kingdom',
        'GasMiningStation',
        'S147 5 Gas Mining Station',
        'S147 5',
        4692129,
        1539066,
        2.8144781589508057,
    ],
    [
        157,
        'S147 Kingdom',
        'MiningStation',
        'Gewes Mining Station',
        'Gewes',
        4691815,
        1550425,
        1.8921269178390503,
    ],
    [
        158,
        'S147 Kingdom',
        'MiningStation',
        'Alceycev Mining Station',
        'Alceycev',
        4693515,
        1538214,
        0.7584664821624756,
    ],
    [
        159,
        'Haakonish Corporation',
        'MediumSpacePort',
        'Sloora Space Port',
        'Sloora',
        10025063,
        6068364,
        -2.0076513290405273,
    ],
    [
        160,
        'Haakonish Corporation',
        'EnergyResearchStation',
        'S190 Research Center',
        'S190 6',
        9687888,
        6109302,
        1.1416442394256592,
    ],
    [
        161,
        'Haakonish Corporation',
        'GasMiningStation',
        'S135 3 Gas Mining Station',
        'S135 3',
        10025041,
        6068583,
        1.6088614463806152,
    ],
    [
        162,
        'Haakonish Corporation',
        'GasMiningStation',
        'S135 2 Gas Mining Station',
        'S135 2',
        10015140,
        6081224,
        -1.0797971487045288,
    ],
    [
        163,
        'Haakonish Corporation',
        'GasMiningStation',
        'S207 7 Gas Mining Station',
        'S207 7',
        9837623,
        6451065,
        0.96983802318573,
    ],
    [
        164,
        'Haakonish Corporation',
        'MiningStation',
        'Ifelcos Mining Station',
        'Ifelcos',
        10025126,
        6068326,
        -1.564468502998352,
    ],
    [
        165,
        'Haakonish Corporation',
        'MiningStation',
        'Ezeglod Mining Station',
        'Ezeglod',
        10016874,
        6096565,
        -0.5045952796936035,
    ],
    [
        166,
        'Haakonish Corporation',
        'MiningStation',
        'Oplesayai Mining Station',
        'Oplesayai',
        10019081,
        6102516,
        2.641620635986328,
    ],
    [
        167,
        'S31 Sovereignty',
        'MediumSpacePort',
        'Arbai Space Port',
        'Arbai',
        9773854,
        13902311,
        2.191021203994751,
    ],
    [
        168,
        'S31 Sovereignty',
        'HighTechResearchStation',
        'S46 Station',
        'S46 1',
        9404566,
        14875511,
        -0.05220156908035278,
    ],
    [
        169,
        'S31 Sovereignty',
        'GasMiningStation',
        'S31 6 Gas Mining Station',
        'S31 6',
        9772912,
        13916260,
        2.9343111515045166,
    ],
    [
        170,
        'S31 Sovereignty',
        'GasMiningStation',
        'S46 3 Gas Mining Station',
        'S46 3',
        9410773,
        14892855,
        2.782541513442993,
    ],
    [
        171,
        'S31 Sovereignty',
        'GasMiningStation',
        'S31 4 Gas Mining Station',
        'S31 4',
        9773863,
        13902410,
        2.216297149658203,
    ],
    [
        172,
        'S31 Sovereignty',
        'GasMiningStation',
        'S31 5 Gas Mining Station',
        'S31 5',
        9750663,
        13915669,
        2.286332130432129,
    ],
    [
        173,
        'S31 Sovereignty',
        'MiningStation',
        'S31 3 Mining Station',
        'S31 3',
        9768646,
        13909666,
        -2.053757667541504,
    ],
    [
        174,
        'S31 Sovereignty',
        'MiningStation',
        'Ogredanoy Mining Station',
        'Ogredanoy',
        9774578,
        13921376,
        0.6942330598831177,
    ],
    [
        175,
        'Ugnari Corporation',
        'MediumSpacePort',
        'Etolfeu Space Port',
        'Etolfeu',
        14188178,
        7465278,
        2.3135385513305664,
    ],
    [
        176,
        'Ugnari Corporation',
        'HighTechResearchStation',
        'S50 Station',
        'S50 4',
        13989698,
        8435119,
        0.15877243876457214,
    ],
    [
        177,
        'Ugnari Corporation',
        'GasMiningStation',
        'S24 8 Gas Mining Station',
        'S24 8',
        14188411,
        7465234,
        2.6634843349456787,
    ],
    [
        178,
        'Ugnari Corporation',
        'GasMiningStation',
        'S24 6 Gas Mining Station',
        'S24 6',
        14203264,
        7462847,
        0.7954604029655457,
    ],
    [
        179,
        'Ugnari Corporation',
        'GasMiningStation',
        'S182 3 Gas Mining Station',
        'S182 3',
        13779066,
        8422919,
        2.71909761428833,
    ],
    [
        180,
        'Ugnari Corporation',
        'GasMiningStation',
        'S24 4 Gas Mining Station',
        'S24 4',
        14190892,
        7485216,
        1.1355698108673096,
    ],
    [
        181,
        'Ugnari Corporation',
        'MiningStation',
        'S24 1 Mining Station',
        'S24 1',
        14201825,
        7471592,
        0.7481600046157837,
    ],
    [
        182,
        'Ugnari Corporation',
        'MiningStation',
        'S24 2 Mining Station',
        'S24 2',
        14205895,
        7475045,
        -1.8902194499969482,
    ],
];
