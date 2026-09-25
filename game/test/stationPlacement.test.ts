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
        expect(phases.map((p) => p.mining)).toEqual([mining6plusSkip, mining6, mining6, mining6plusSkip]);
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
const PINNED: unknown[] = [
    [
        151,
        "Sol Commonwealth",
        "MediumSpacePort",
        "Sol 2 Space Port",
        "Sol 2",
        4568476,
        2362774,
        0.2715461552143097
    ],
    [
        152,
        "Sol Commonwealth",
        "WeaponsResearchStation",
        "S96 Research Center",
        "S96 2",
        3994503,
        2307470,
        0.03199479356408119
    ],
    [
        153,
        "Sol Commonwealth",
        "MiningStation",
        "Epautox Mining Station",
        "Epautox",
        4574680,
        2379420,
        0.3019760549068451
    ],
    [
        154,
        "Sol Commonwealth",
        "MiningStation",
        "Sol 1 Mining Station",
        "Sol 1",
        4565984,
        2367443,
        -2.1879498958587646
    ],
    [
        155,
        "Sol Commonwealth",
        "MiningStation",
        "Sol 5 Mining Station",
        "Sol 5",
        4574625,
        2379409,
        -0.9036071300506592
    ],
    [
        156,
        "Sol Commonwealth",
        "MiningStation",
        "LD741 Mining Station",
        "LD741",
        4559188,
        2371747,
        -2.1624536514282227
    ],
    [
        157,
        "Sol Commonwealth",
        "MiningStation",
        "S185 1 Mining Station",
        "S185 1",
        4707350,
        2968564,
        -0.15501470863819122
    ],
    [
        158,
        "Sol Commonwealth",
        "MiningStation",
        "Ahous Mining Station",
        "Ahous",
        4709064,
        2980855,
        3.025357484817505
    ],
    [
        159,
        "Free S160 Consortium",
        "MediumSpacePort",
        "S160 3 Space Port",
        "S160 3",
        2950740,
        7974448,
        2.4571590423583984
    ],
    [
        160,
        "Free S160 Consortium",
        "HighTechResearchStation",
        "S139 Station",
        "S139 1",
        2819010,
        8094640,
        -0.1965635120868683
    ],
    [
        161,
        "Free S160 Consortium",
        "GasMiningStation",
        "S160 6 Gas Mining Station",
        "S160 6",
        2946371,
        7988473,
        -2.742340564727783
    ],
    [
        162,
        "Free S160 Consortium",
        "MiningStation",
        "Amsoi Mining Station",
        "Amsoi",
        2946417,
        7988573,
        -2.5909759998321533
    ],
    [
        163,
        "Free S160 Consortium",
        "MiningStation",
        "Glex Mining Station",
        "Glex",
        2950901,
        7971756,
        -1.863935112953186
    ],
    [
        164,
        "Free S160 Consortium",
        "MiningStation",
        "Delf Mining Station",
        "Delf",
        2959734,
        7979067,
        -0.8207922577857971
    ],
    [
        165,
        "Free S160 Consortium",
        "MiningStation",
        "NW1 Mining Station",
        "NW1",
        2948150,
        7985407,
        2.4463579654693604
    ],
    [
        166,
        "Free S160 Consortium",
        "MiningStation",
        "S160 1 Mining Station",
        "S160 1",
        2959689,
        7979120,
        -2.9180960655212402
    ],
    [
        167,
        "Combined S144 Alliance",
        "MediumSpacePort",
        "Aseeglet Space Port",
        "Aseeglet",
        3577173,
        12698386,
        -1.0578980445861816
    ],
    [
        168,
        "Combined S144 Alliance",
        "WeaponsResearchStation",
        "S36 Station",
        "S36 3",
        3216290,
        12089840,
        1.6561763286590576
    ],
    [
        169,
        "Combined S144 Alliance",
        "GasMiningStation",
        "S144 7 Gas Mining Station",
        "S144 7",
        3554799,
        12708237,
        -1.384136438369751
    ],
    [
        170,
        "Combined S144 Alliance",
        "GasMiningStation",
        "S144 11 Gas Mining Station",
        "S144 11",
        3570038,
        12715772,
        -1.4832037687301636
    ],
    [
        171,
        "Combined S144 Alliance",
        "GasMiningStation",
        "S144 8 Gas Mining Station",
        "S144 8",
        3575021,
        12692563,
        1.6214509010314941
    ],
    [
        172,
        "Combined S144 Alliance",
        "MiningStation",
        "Ereiti Mining Station",
        "Ereiti",
        3574996,
        12688879,
        0.13817834854125977
    ],
    [
        173,
        "Combined S144 Alliance",
        "MiningStation",
        "Ikleata Mining Station",
        "Ikleata",
        3575119,
        12688951,
        0.9272089600563049
    ],
    [
        174,
        "Combined S144 Alliance",
        "MiningStation",
        "Getoaton Mining Station",
        "Getoaton",
        3569723,
        12715842,
        -1.7945938110351562
    ],
    [
        175,
        "Ugnari Corporation",
        "MediumSpacePort",
        "Kroxoy Space Port",
        "Kroxoy",
        7555416,
        704637,
        -1.7965428829193115
    ],
    [
        176,
        "Ugnari Corporation",
        "HighTechResearchStation",
        "S181 Research Station",
        "S181 6",
        7137176,
        1441791,
        1.7650281190872192
    ],
    [
        177,
        "Ugnari Corporation",
        "GasMiningStation",
        "S181 7 Gas Mining Station",
        "S181 7",
        7139679,
        1446266,
        0.6371418833732605
    ],
    [
        178,
        "Ugnari Corporation",
        "GasMiningStation",
        "TH391 Gas Mining Station",
        "TH391",
        7293100,
        618920,
        1.1630359888076782
    ],
    [
        179,
        "Ugnari Corporation",
        "GasMiningStation",
        "S181 9 Gas Mining Station",
        "S181 9",
        7133756,
        1442177,
        2.951711416244507
    ],
    [
        180,
        "Ugnari Corporation",
        "MiningStation",
        "S252 3 Mining Station",
        "S252 3",
        7540437,
        688442,
        -2.41445255279541
    ],
    [
        181,
        "Ugnari Corporation",
        "MiningStation",
        "S252 4 Mining Station",
        "S252 4",
        7536452,
        690967,
        -1.0290274620056152
    ],
    [
        182,
        "Ugnari Corporation",
        "MiningStation",
        "Ilget Mining Station",
        "Ilget",
        7543520,
        681083,
        -1.355878233909607
    ]
];
