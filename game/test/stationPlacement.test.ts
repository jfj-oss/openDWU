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
        expect(phases.map((p) => p.ports)).toEqual([port, port, port, port]);
        expect(phases.map((p) => p.researchLocations)).toEqual([[], [], [], []]);
        // (re-pinned M4k: after game-start research shifts the Rnd stream, the fourth empire has no research target.)
        // (re-pinned M4s1: ReviewPirateRelations' game-start Rnd draw moves the empires; all four now have a research target
        // and the fourth empire skips one occupied mining candidate.)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and
        // the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785): the empires move again; no empire meets an
        // occupied mining candidate now, so every mining phase is exactly 6 stations.)
        expect(phases.map((p) => p.research)).toEqual([research, research, research, research]);
        expect(phases.map((p) => p.mining)).toEqual([mining6, mining6, mining6, mining6]);
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
// (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
const PINNED: unknown[] = [
    [
        151,
        'Sol Commonwealth',
        'MediumSpacePort',
        'Sol 2 Space Port',
        'Sol 2',
        4568462,
        2362832,
        -0.6915271282196045,
    ],
    [
        152,
        'Sol Commonwealth',
        'HighTechResearchStation',
        'Sol Research Facility',
        'Sol 7',
        4566688,
        2388313,
        -0.7827394008636475,
    ],
    [
        153,
        'Sol Commonwealth',
        'GasMiningStation',
        'S96 2 Gas Mining Station',
        'S96 2',
        3994499,
        2307457,
        0.9080791473388672,
    ],
    [
        154,
        'Sol Commonwealth',
        'MiningStation',
        'Epautox Mining Station',
        'Epautox',
        4574688,
        2379442,
        -1.7784017324447632,
    ],
    [
        155,
        'Sol Commonwealth',
        'MiningStation',
        'Sol 1 Mining Station',
        'Sol 1',
        4565956,
        2367375,
        -2.5400640964508057,
    ],
    [
        156,
        'Sol Commonwealth',
        'MiningStation',
        'Sol 5 Mining Station',
        'Sol 5',
        4574630,
        2379464,
        -1.687022089958191,
    ],
    [
        157,
        'Sol Commonwealth',
        'MiningStation',
        'LD741 Mining Station',
        'LD741',
        4559190,
        2371749,
        2.371245861053467,
    ],
    [
        158,
        'Sol Commonwealth',
        'MiningStation',
        'S185 1 Mining Station',
        'S185 1',
        4707429,
        2968489,
        0.9198262095451355,
    ],
    [
        159,
        'Free S288 Syndicate',
        'MediumSpacePort',
        'Sikui Space Port',
        'Sikui',
        3341007,
        6776038,
        0.8593568205833435,
    ],
    [
        160,
        'Free S288 Syndicate',
        'WeaponsResearchStation',
        'S204 Station',
        'S204 2',
        2672158,
        6636580,
        -2.1107699871063232,
    ],
    [
        161,
        'Free S288 Syndicate',
        'GasMiningStation',
        'S288 4 Gas Mining Station',
        'S288 4',
        3323374,
        6757869,
        2.179788827896118,
    ],
    [
        162,
        'Free S288 Syndicate',
        'GasMiningStation',
        'S288 7 Gas Mining Station',
        'S288 7',
        3316786,
        6773078,
        -1.5643227100372314,
    ],
    [
        163,
        'Free S288 Syndicate',
        'GasMiningStation',
        'S288 5 Gas Mining Station',
        'S288 5',
        3341066,
        6775685,
        -2.2724788188934326,
    ],
    [
        164,
        'Free S288 Syndicate',
        'MiningStation',
        'Rhoaf Mining Station',
        'Rhoaf',
        3341062,
        6776053,
        0.6194853782653809,
    ],
    [
        165,
        'Free S288 Syndicate',
        'MiningStation',
        'S288 2 Mining Station',
        'S288 2',
        3334629,
        6774115,
        2.580986261367798,
    ],
    [
        166,
        'Free S288 Syndicate',
        'MiningStation',
        'Rhos Mining Station',
        'Rhos',
        3332219,
        6788886,
        -1.3572254180908203,
    ],
    [
        167,
        'Grand Dhayut Territory',
        'MediumSpacePort',
        'Stera Space Port',
        'Stera',
        12751580,
        8019438,
        1.40562903881073,
    ],
    [
        168,
        'Grand Dhayut Territory',
        'EnergyResearchStation',
        'S270 Research Facility',
        'S270 2',
        12966624,
        8157758,
        1.8893911838531494,
    ],
    [
        169,
        'Grand Dhayut Territory',
        'GasMiningStation',
        'S122 4 Gas Mining Station',
        'S122 4',
        12751637,
        8019406,
        2.070136547088623,
    ],
    [
        170,
        'Grand Dhayut Territory',
        'GasMiningStation',
        'S122 2 Gas Mining Station',
        'S122 2',
        12741581,
        8029232,
        0.5311100482940674,
    ],
    [
        171,
        'Grand Dhayut Territory',
        'GasMiningStation',
        'S122 5 Gas Mining Station',
        'S122 5',
        12722513,
        8026847,
        -2.4840052127838135,
    ],
    [
        172,
        'Grand Dhayut Territory',
        'GasMiningStation',
        'S122 3 Gas Mining Station',
        'S122 3',
        12729827,
        8005530,
        -2.776538372039795,
    ],
    [
        173,
        'Grand Dhayut Territory',
        'GasMiningStation',
        'S270 3 Gas Mining Station',
        'S270 3',
        12937507,
        8158776,
        -2.4079017639160156,
    ],
    [
        174,
        'Grand Dhayut Territory',
        'MiningStation',
        'Rigean Mining Station',
        'Rigean',
        12741487,
        8028805,
        1.5158288478851318,
    ],
    [
        175,
        'Free Ugnari Industries',
        'MediumSpacePort',
        'Nelk Space Port',
        'Nelk',
        13032546,
        4939078,
        -0.5168828368186951,
    ],
    [
        176,
        'Free Ugnari Industries',
        'HighTechResearchStation',
        'S9 Research Facility',
        'S9 4',
        12808784,
        4974333,
        1.7838804721832275,
    ],
    [
        177,
        'Free Ugnari Industries',
        'GasMiningStation',
        'S24 5 Gas Mining Station',
        'S24 5',
        13032631,
        4938693,
        -1.3837441205978394,
    ],
    [
        178,
        'Free Ugnari Industries',
        'GasMiningStation',
        'S24 6 Gas Mining Station',
        'S24 6',
        13029921,
        4965812,
        -3.110987901687622,
    ],
    [
        179,
        'Free Ugnari Industries',
        'GasMiningStation',
        'S24 7 Gas Mining Station',
        'S24 7',
        13029017,
        4967392,
        -2.1051905155181885,
    ],
    [
        180,
        'Free Ugnari Industries',
        'GasMiningStation',
        'S24 4 Gas Mining Station',
        'S24 4',
        13022528,
        4955494,
        2.769502878189087,
    ],
    [
        181,
        'Free Ugnari Industries',
        'GasMiningStation',
        'S29 5 Gas Mining Station',
        'S29 5',
        12712754,
        4918846,
        -1.8699712753295898,
    ],
    [
        182,
        'Free Ugnari Industries',
        'MiningStation',
        'S24 1 Mining Station',
        'S24 1',
        13037624,
        4953323,
        0.2538743317127228,
    ],
];
