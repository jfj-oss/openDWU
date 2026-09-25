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
        // M4x: galaxyAge now defaults to 1; this test's pins / asserts are for Galaxy.Age 0 (START_STAR_DATE etc.).
        galaxyAge: 0,
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
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and
        // the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785): the empires move again; no empire meets an
        // occupied mining candidate now, so every mining phase is exactly 6 stations.)
        expect(phases.map((p) => p.research)).toEqual([research, research, research, research]);
        // (re-pinned M4u: game-start character reviews / DoRaceEvent Rnd move the empires; the first and fourth empire now skip
        // one occupied mining candidate.)
        // (re-pinned M4m: the game-start military AI's Rnd draws move the empires; now the second and fourth empire skip one
        // occupied mining candidate.)
        expect(phases.map((p) => p.mining)).toEqual([mining6, mining6plusSkip, mining6, mining6plusSkip]);
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
// (re-pinned M4u: game-start character reviews (ReviewCharacterTraits Rnd) and ReviewEmpireEvents (DoRaceEvent Rnd) move the empires and the station points.)
// (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
const PINNED: unknown[] = [
    [
        151,
        "Sol Commonwealth",
        "MediumSpacePort",
        "Sol 2 Space Port",
        "Sol 2",
        4568462,
        2362832,
        -0.6915271282196045
    ],
    [
        152,
        "Sol Commonwealth",
        "HighTechResearchStation",
        "Sol Research Facility",
        "Sol 7",
        4566688,
        2388313,
        -0.7827394008636475
    ],
    [
        153,
        "Sol Commonwealth",
        "GasMiningStation",
        "S96 2 Gas Mining Station",
        "S96 2",
        3994499,
        2307457,
        0.9080791473388672
    ],
    [
        154,
        "Sol Commonwealth",
        "MiningStation",
        "Epautox Mining Station",
        "Epautox",
        4574688,
        2379442,
        -1.7784017324447632
    ],
    [
        155,
        "Sol Commonwealth",
        "MiningStation",
        "Sol 1 Mining Station",
        "Sol 1",
        4565956,
        2367375,
        -2.5400640964508057
    ],
    [
        156,
        "Sol Commonwealth",
        "MiningStation",
        "Sol 5 Mining Station",
        "Sol 5",
        4574630,
        2379464,
        -1.687022089958191
    ],
    [
        157,
        "Sol Commonwealth",
        "MiningStation",
        "LD741 Mining Station",
        "LD741",
        4559190,
        2371749,
        2.371245861053467
    ],
    [
        158,
        "Sol Commonwealth",
        "MiningStation",
        "S185 1 Mining Station",
        "S185 1",
        4707429,
        2968489,
        0.9198262095451355
    ],
    [
        159,
        "Haakonish Corporation",
        "MediumSpacePort",
        "Owooggim Space Port",
        "Owooggim",
        5818086,
        5070468,
        0.8593568205833435
    ],
    [
        160,
        "Haakonish Corporation",
        "HighTechResearchStation",
        "S186 Station",
        "S186 7",
        5820407,
        5097495,
        -2.1107699871063232
    ],
    [
        161,
        "Haakonish Corporation",
        "GasMiningStation",
        "S186 5 Gas Mining Station",
        "S186 5",
        5819309,
        5095434,
        2.179788827896118
    ],
    [
        162,
        "Haakonish Corporation",
        "GasMiningStation",
        "S186 8 Gas Mining Station",
        "S186 8",
        5811143,
        5095239,
        -1.5643227100372314
    ],
    [
        163,
        "Haakonish Corporation",
        "GasMiningStation",
        "S186 4 Gas Mining Station",
        "S186 4",
        5818139,
        5070151,
        -2.2724788188934326
    ],
    [
        164,
        "Haakonish Corporation",
        "MiningStation",
        "S186 1 Mining Station",
        "S186 1",
        5825050,
        5086373,
        0.5316790342330933
    ],
    [
        165,
        "Haakonish Corporation",
        "MiningStation",
        "Klece Mining Station",
        "Klece",
        5811177,
        5095164,
        -2.4552001953125
    ],
    [
        166,
        "Haakonish Corporation",
        "MiningStation",
        "Tozaicans Mining Station",
        "Tozaicans",
        5818090,
        5070401,
        0.5617148280143738
    ],
    [
        167,
        "Dhayut Nation",
        "MediumSpacePort",
        "Ghoawu Space Port",
        "Ghoawu",
        12751588,
        8019457,
        1.9655818939208984
    ],
    [
        168,
        "Dhayut Nation",
        "HighTechResearchStation",
        "S270 Research Center",
        "S270 2",
        12966497,
        8157795,
        -0.7350144386291504
    ],
    [
        169,
        "Dhayut Nation",
        "GasMiningStation",
        "S122 4 Gas Mining Station",
        "S122 4",
        12751519,
        8019406,
        1.367544174194336
    ],
    [
        170,
        "Dhayut Nation",
        "GasMiningStation",
        "S122 2 Gas Mining Station",
        "S122 2",
        12741623,
        8028690,
        -1.2213705778121948
    ],
    [
        171,
        "Dhayut Nation",
        "GasMiningStation",
        "S122 5 Gas Mining Station",
        "S122 5",
        12722649,
        8026821,
        -0.44109824299812317
    ],
    [
        172,
        "Dhayut Nation",
        "GasMiningStation",
        "S122 3 Gas Mining Station",
        "S122 3",
        12729682,
        8005284,
        2.247117519378662
    ],
    [
        173,
        "Dhayut Nation",
        "GasMiningStation",
        "S270 3 Gas Mining Station",
        "S270 3",
        12937889,
        8158493,
        -2.607952117919922
    ],
    [
        174,
        "Dhayut Nation",
        "MiningStation",
        "Ijafan Mining Station",
        "Ijafan",
        12741453,
        8028856,
        2.1669955253601074
    ],
    [
        175,
        "Free Ugnari Consortium",
        "MediumSpacePort",
        "Toit Space Port",
        "Toit",
        5982694,
        4644972,
        -2.579533338546753
    ],
    [
        176,
        "Free Ugnari Consortium",
        "HighTechResearchStation",
        "S43 Research Facility",
        "S43 3",
        6067883,
        4588963,
        -1.4024603366851807
    ],
    [
        177,
        "Free Ugnari Consortium",
        "MiningStation",
        "Gaulkevi Mining Station",
        "Gaulkevi",
        5966816,
        4650649,
        2.866032838821411
    ],
    [
        178,
        "Free Ugnari Consortium",
        "MiningStation",
        "Ejoiph Mining Station",
        "Ejoiph",
        6067908,
        4588524,
        -0.33333995938301086
    ],
    [
        179,
        "Free Ugnari Consortium",
        "MiningStation",
        "Aneurted Mining Station",
        "Aneurted",
        6061306,
        4617546,
        -2.6028342247009277
    ],
    [
        180,
        "Free Ugnari Consortium",
        "MiningStation",
        "Equai Mining Station",
        "Equai",
        5961548,
        4658078,
        -2.1756908893585205
    ],
    [
        181,
        "Free Ugnari Consortium",
        "MiningStation",
        "WO307 Mining Station",
        "WO307",
        5966205,
        4645361,
        1.7783395051956177
    ],
    [
        182,
        "Free Ugnari Consortium",
        "MiningStation",
        "Deulipo Mining Station",
        "Deulipo",
        5961575,
        4658107,
        -0.5163811445236206
    ]
];
