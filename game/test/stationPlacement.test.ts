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
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and
        // the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785): the empires move again; no empire meets an
        // occupied mining candidate now, so every mining phase is exactly 6 stations.)
        expect(phases.map((p) => p.research)).toEqual([research, research, research, research]);
        // (re-pinned M4u: game-start character reviews / DoRaceEvent Rnd move the empires; the first and fourth empire now skip
        // one occupied mining candidate.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
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
// (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
const PINNED: unknown[] = [
    [
        136,
        "Sol Commonwealth",
        "MediumSpacePort",
        "Sol 2 Space Port",
        "Sol 2",
        4568415,
        2362871,
        -0.34413084387779236
    ],
    [
        137,
        "Sol Commonwealth",
        "HighTechResearchStation",
        "Sol Research Center",
        "Sol 7",
        4566547,
        2388271,
        0.6659872531890869
    ],
    [
        138,
        "Sol Commonwealth",
        "GasMiningStation",
        "S96 2 Gas Mining Station",
        "S96 2",
        3994581,
        2307505,
        1.1913686990737915
    ],
    [
        139,
        "Sol Commonwealth",
        "MiningStation",
        "Epautox Mining Station",
        "Epautox",
        4574688,
        2379425,
        -2.427722454071045
    ],
    [
        140,
        "Sol Commonwealth",
        "MiningStation",
        "Sol 1 Mining Station",
        "Sol 1",
        4566048,
        2367497,
        -1.2375562191009521
    ],
    [
        141,
        "Sol Commonwealth",
        "MiningStation",
        "Sol 5 Mining Station",
        "Sol 5",
        4574708,
        2379441,
        2.219999313354492
    ],
    [
        142,
        "Sol Commonwealth",
        "MiningStation",
        "LD741 Mining Station",
        "LD741",
        4559189,
        2371752,
        0.5460940003395081
    ],
    [
        143,
        "Sol Commonwealth",
        "MiningStation",
        "S185 1 Mining Station",
        "S185 1",
        4707537,
        2968547,
        2.595449447631836
    ],
    [
        144,
        "Haakonish Industries",
        "MediumSpacePort",
        "S216 2 Space Port",
        "S216 2",
        8254579,
        2932472,
        0.2054254561662674
    ],
    [
        145,
        "Haakonish Industries",
        "WeaponsResearchStation",
        "S174 Station",
        "S174 1",
        7993428,
        2399834,
        -0.36867228150367737
    ],
    [
        146,
        "Haakonish Industries",
        "GasMiningStation",
        "S216 4 Gas Mining Station",
        "S216 4",
        8249521,
        2942035,
        2.640260696411133
    ],
    [
        147,
        "Haakonish Industries",
        "MiningStation",
        "Owuilg Mining Station",
        "Owuilg",
        8254538,
        2932460,
        0.18121880292892456
    ],
    [
        148,
        "Haakonish Industries",
        "MiningStation",
        "S216 3 Mining Station",
        "S216 3",
        8254536,
        2935861,
        -2.223687171936035
    ],
    [
        149,
        "Haakonish Industries",
        "MiningStation",
        "BA496 Mining Station",
        "BA496",
        8265884,
        2940934,
        1.9737778902053833
    ],
    [
        150,
        "Haakonish Industries",
        "MiningStation",
        "HT297 Mining Station",
        "HT297",
        8252705,
        2923664,
        -0.8626134991645813
    ],
    [
        151,
        "Haakonish Industries",
        "MiningStation",
        "PM149 Mining Station",
        "PM149",
        8253528,
        2939865,
        -2.4686214923858643
    ],
    [
        152,
        "Grand Dhayut Authority",
        "MediumSpacePort",
        "S1 3 Space Port",
        "S1 3",
        9072990,
        3383317,
        -0.6356511116027832
    ],
    [
        153,
        "Grand Dhayut Authority",
        "HighTechResearchStation",
        "S188 Research Center",
        "S188 4",
        8924975,
        3086288,
        -0.42063677310943604
    ],
    [
        154,
        "Grand Dhayut Authority",
        "GasMiningStation",
        "S6 2 Gas Mining Station",
        "S6 2",
        9889927,
        3766612,
        1.249326229095459
    ],
    [
        155,
        "Grand Dhayut Authority",
        "MiningStation",
        "DN169, Asteroid Field Mining Station",
        "DN169, Asteroid Field",
        9072058,
        3379664,
        1.0001496076583862
    ],
    [
        156,
        "Grand Dhayut Authority",
        "MiningStation",
        "XO112, Asteroid Field Mining Station",
        "XO112, Asteroid Field",
        9071750,
        3379200,
        -1.340457558631897
    ],
    [
        157,
        "Grand Dhayut Authority",
        "MiningStation",
        "PW425, Asteroid Field Mining Station",
        "PW425, Asteroid Field",
        9071991,
        3379325,
        -1.4194839000701904
    ],
    [
        158,
        "Grand Dhayut Authority",
        "MiningStation",
        "Eshoa Mining Station",
        "Eshoa",
        9072966,
        3383320,
        -0.034286145120859146
    ],
    [
        159,
        "Grand Dhayut Authority",
        "MiningStation",
        "S188 3 Mining Station",
        "S188 3",
        8902380,
        3077970,
        -1.5134004354476929
    ],
    [
        160,
        "Free S34 Corporation",
        "MediumSpacePort",
        "Emoarn Space Port",
        "Emoarn",
        6829493,
        9264396,
        2.041285514831543
    ],
    [
        161,
        "Free S34 Corporation",
        "HighTechResearchStation",
        "S136 Research Center",
        "S136 1",
        6324533,
        9068363,
        -2.753337860107422
    ],
    [
        162,
        "Free S34 Corporation",
        "MiningStation",
        "S34 2 Mining Station",
        "S34 2",
        6842448,
        9280376,
        -2.021071195602417
    ],
    [
        163,
        "Free S34 Corporation",
        "MiningStation",
        "Ryibiwie Mining Station",
        "Ryibiwie",
        6855925,
        9278545,
        -0.09320308268070221
    ],
    [
        164,
        "Free S34 Corporation",
        "MiningStation",
        "IE225 Mining Station",
        "IE225",
        6831148,
        9291357,
        2.0796756744384766
    ],
    [
        165,
        "Free S34 Corporation",
        "MiningStation",
        "S34 1 Mining Station",
        "S34 1",
        6835332,
        9286795,
        0.11203910410404205
    ],
    [
        166,
        "Free S34 Corporation",
        "MiningStation",
        "HC228 Mining Station",
        "HC228",
        6846532,
        9285482,
        -2.5375473499298096
    ],
    [
        167,
        "Free S34 Corporation",
        "MiningStation",
        "Eldoa Mining Station",
        "Eldoa",
        6829458,
        9264311,
        2.057286024093628
    ]
];
