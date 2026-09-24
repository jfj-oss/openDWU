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
        expect(phases.map((p) => p.research)).toEqual([research, research, research, []]);
        expect(phases.map((p) => p.mining)).toEqual([mining6plusSkip, mining6, mining6plusSkip, mining6]);
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
const PINNED: unknown[] = [
    [
        151,
        'S147 Kingdom',
        'MediumSpacePort',
        'Hotaulf Space Port',
        'Hotaulf',
        4692104,
        1539139,
        1.1795955896377563,
    ],
    [
        152,
        'S147 Kingdom',
        'WeaponsResearchStation',
        'S147 Research Facility',
        'S147 3',
        4722222,
        1540935,
        -0.49174293875694275,
    ],
    [
        153,
        'S147 Kingdom',
        'GasMiningStation',
        'S147 2 Gas Mining Station',
        'S147 2',
        4718464,
        1548420,
        -2.8698713779449463,
    ],
    [
        154,
        'S147 Kingdom',
        'GasMiningStation',
        'S147 4 Gas Mining Station',
        'S147 4',
        4693595,
        1538152,
        -1.9486198425292969,
    ],
    [
        155,
        'S147 Kingdom',
        'GasMiningStation',
        'S251 3 Gas Mining Station',
        'S251 3',
        4865416,
        948072,
        2.79824161529541,
    ],
    [
        156,
        'S147 Kingdom',
        'MiningStation',
        'Gewes Mining Station',
        'Gewes',
        4691800,
        1550466,
        1.1821671724319458,
    ],
    [
        157,
        'S147 Kingdom',
        'MiningStation',
        'Alceycev Mining Station',
        'Alceycev',
        4693592,
        1538218,
        1.9197100400924683,
    ],
    [
        158,
        'S147 Kingdom',
        'MiningStation',
        'Rhuleete Mining Station',
        'Rhuleete',
        4693550,
        1538356,
        -1.3651620149612427,
    ],
    [
        159,
        'S216 Corporation',
        'MediumSpacePort',
        'S216 3 Space Port',
        'S216 3',
        493917,
        7846745,
        -0.9609630703926086,
    ],
    [
        160,
        'S216 Corporation',
        'HighTechResearchStation',
        'S51 Research Facility',
        'S51 4',
        2052096,
        8165953,
        -2.9045915603637695,
    ],
    [
        161,
        'S216 Corporation',
        'GasMiningStation',
        'S216 6 Gas Mining Station',
        'S216 6',
        482064,
        7859157,
        2.940887451171875,
    ],
    [
        162,
        'S216 Corporation',
        'GasMiningStation',
        'S216 7 Gas Mining Station',
        'S216 7',
        494801,
        7834353,
        0.3467186391353607,
    ],
    [
        163,
        'S216 Corporation',
        'GasMiningStation',
        'S216 8 Gas Mining Station',
        'S216 8',
        489870,
        7830982,
        -2.4236128330230713,
    ],
    [
        164,
        'S216 Corporation',
        'MiningStation',
        'Olteynan Mining Station',
        'Olteynan',
        494808,
        7834497,
        1.221428632736206,
    ],
    [
        165,
        'S216 Corporation',
        'MiningStation',
        'Okoloot Mining Station',
        'Okoloot',
        486386,
        7852891,
        -1.4129968881607056,
    ],
    [
        166,
        'S216 Corporation',
        'MiningStation',
        'Baul Mining Station',
        'Baul',
        496333,
        7842296,
        1.3704555034637451,
    ],
    [167, 'S96 Union', 'MediumSpacePort', 'S96 3 Space Port', 'S96 3', 7196363, 1339989, 0.46895283460617065],
    [
        168,
        'S96 Union',
        'HighTechResearchStation',
        'S200 Research Station',
        'S200 2',
        7055628,
        1750761,
        -0.508375883102417,
    ],
    [
        169,
        'S96 Union',
        'GasMiningStation',
        'S200 4 Gas Mining Station',
        'S200 4',
        7067886,
        1756267,
        -0.3740006387233734,
    ],
    [
        170,
        'S96 Union',
        'GasMiningStation',
        'S115 2 Gas Mining Station',
        'S115 2',
        6571930,
        971132,
        3.1252634525299072,
    ],
    [171, 'S96 Union', 'MiningStation', 'Elda Mining Station', 'Elda', 7198968, 1355070, -1.6735355854034424],
    [172, 'S96 Union', 'MiningStation', 'S96 1 Mining Station', 'S96 1', 7202973, 1337561, 2.4699816703796387],
    [173, 'S96 Union', 'MiningStation', 'Dret Mining Station', 'Dret', 7196361, 1339940, 2.0479631423950195],
    [
        174,
        'S96 Union',
        'MiningStation',
        'Awatehai Mining Station',
        'Awatehai',
        6564923,
        944938,
        -0.9956833124160767,
    ],
    [
        175,
        'Ugnari Consortium',
        'MediumSpacePort',
        'S75 9 Space Port',
        'S75 9',
        12798638,
        12804770,
        1.8739069700241089,
    ],
    [
        176,
        'Ugnari Consortium',
        'GasMiningStation',
        'S75 3 Gas Mining Station',
        'S75 3',
        12782722,
        12805065,
        -0.03724362701177597,
    ],
    [
        177,
        'Ugnari Consortium',
        'GasMiningStation',
        'BF486 Gas Mining Station',
        'BF486',
        11594288,
        11950481,
        -1.7279473543167114,
    ],
    [
        178,
        'Ugnari Consortium',
        'GasMiningStation',
        'ZT619 Gas Mining Station',
        'ZT619',
        12952593,
        10790329,
        -0.6010177135467529,
    ],
    [
        179,
        'Ugnari Consortium',
        'GasMiningStation',
        'S75 1 Gas Mining Station',
        'S75 1',
        12769956,
        12793468,
        0.5805075168609619,
    ],
    [
        180,
        'Ugnari Consortium',
        'GasMiningStation',
        'EB105 Gas Mining Station',
        'EB105',
        13537757,
        12797206,
        -0.11954093724489212,
    ],
    [
        181,
        'Ugnari Consortium',
        'MiningStation',
        'Grer Mining Station',
        'Grer',
        12767630,
        12791701,
        -2.9240293502807617,
    ],
];
