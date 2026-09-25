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
        // (M4q merge: the merged stream leaves the third and fourth empire without a research target.)
        expect(phases.map((p) => p.research)).toEqual([research, research, [], []]);
        // (re-pinned M4u: game-start character reviews / DoRaceEvent Rnd move the empires; the first and fourth empire now skip
        // one occupied mining candidate.)
        // (re-pinned M4m: the game-start military AI's Rnd draws move the empires; now the second and fourth empire skip one
        // occupied mining candidate.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // (M4q merge: now only the first empire skips one occupied mining candidate.)
        expect(phases.map((p) => p.mining)).toEqual([mining6plusSkip, mining6, mining6, mining6]);
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
// (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
const PINNED: unknown[] = [
    [
        151,
        "Sol Commonwealth",
        "MediumSpacePort",
        "Sol 2 Space Port",
        "Sol 2",
        4568460,
        2362844,
        -0.8207922577857971
    ],
    [
        152,
        "Sol Commonwealth",
        "EnergyResearchStation",
        "S96 Research Facility",
        "S96 2",
        3994306,
        2307490,
        -2.5411815643310547
    ],
    [
        153,
        "Sol Commonwealth",
        "MiningStation",
        "Epautox Mining Station",
        "Epautox",
        4574686,
        2379430,
        2.9553675651550293
    ],
    [
        154,
        "Sol Commonwealth",
        "MiningStation",
        "Sol 1 Mining Station",
        "Sol 1",
        4565984,
        2367464,
        1.5796560049057007
    ],
    [
        155,
        "Sol Commonwealth",
        "MiningStation",
        "Sol 5 Mining Station",
        "Sol 5",
        4574705,
        2379487,
        2.532393217086792
    ],
    [
        156,
        "Sol Commonwealth",
        "MiningStation",
        "LD741 Mining Station",
        "LD741",
        4559189,
        2371749,
        -2.6509978771209717
    ],
    [
        157,
        "Sol Commonwealth",
        "MiningStation",
        "S185 1 Mining Station",
        "S185 1",
        4707442,
        2968481,
        -1.9944566488265991
    ],
    [
        158,
        "Sol Commonwealth",
        "MiningStation",
        "Ahous Mining Station",
        "Ahous",
        4709027,
        2980920,
        -2.130112648010254
    ],
    [
        159,
        "Free S160 Consortium",
        "MediumSpacePort",
        "S160 3 Space Port",
        "S160 3",
        2950686,
        7974446,
        0.16904862225055695
    ],
    [
        160,
        "Free S160 Consortium",
        "HighTechResearchStation",
        "S139 Station",
        "S139 1",
        2818906,
        8094843,
        0.2866320013999939
    ],
    [
        161,
        "Free S160 Consortium",
        "GasMiningStation",
        "S160 6 Gas Mining Station",
        "S160 6",
        2946390,
        7988382,
        -2.8277010917663574
    ],
    [
        162,
        "Free S160 Consortium",
        "MiningStation",
        "Amsoi Mining Station",
        "Amsoi",
        2946434,
        7988602,
        -0.49007323384284973
    ],
    [
        163,
        "Free S160 Consortium",
        "MiningStation",
        "Glex Mining Station",
        "Glex",
        2950884,
        7971723,
        -1.8192083835601807
    ],
    [
        164,
        "Free S160 Consortium",
        "MiningStation",
        "Delf Mining Station",
        "Delf",
        2959718,
        7979063,
        1.5007612705230713
    ],
    [
        165,
        "Free S160 Consortium",
        "MiningStation",
        "NW1 Mining Station",
        "NW1",
        2948142,
        7985404,
        1.1630359888076782
    ],
    [
        166,
        "Free S160 Consortium",
        "MiningStation",
        "S160 1 Mining Station",
        "S160 1",
        2959653,
        7979142,
        2.951711416244507
    ],
    [
        167,
        "S285 Empire",
        "MediumSpacePort",
        "S285 1 Space Port",
        "S285 1",
        11085282,
        8034523,
        0.3425038754940033
    ],
    [
        168,
        "S285 Empire",
        "GasMiningStation",
        "S285 3 Gas Mining Station",
        "S285 3",
        11090629,
        8050309,
        1.3717567920684814
    ],
    [
        169,
        "S285 Empire",
        "GasMiningStation",
        "S285 4 Gas Mining Station",
        "S285 4",
        11097810,
        8048197,
        1.3075592517852783
    ],
    [
        170,
        "S285 Empire",
        "GasMiningStation",
        "KU220 Gas Mining Station",
        "KU220",
        10933123,
        7876375,
        -2.513340950012207
    ],
    [
        171,
        "S285 Empire",
        "MiningStation",
        "Epeynane Mining Station",
        "Epeynane",
        11106119,
        8047831,
        -0.3951752781867981
    ],
    [
        172,
        "S285 Empire",
        "MiningStation",
        "Oyertaud Mining Station",
        "Oyertaud",
        11097758,
        8048225,
        -0.15376242995262146
    ],
    [
        173,
        "S285 Empire",
        "MiningStation",
        "S285 2 Mining Station",
        "S285 2",
        11084834,
        8036790,
        1.2252635955810547
    ],
    [
        174,
        "S43 Industries",
        "MediumSpacePort",
        "S43 4 Space Port",
        "S43 4",
        6061376,
        4617561,
        0.03190780058503151
    ],
    [
        175,
        "S43 Industries",
        "GasMiningStation",
        "S43 3 Gas Mining Station",
        "S43 3",
        6068035,
        4588353,
        2.6656837463378906
    ],
    [
        176,
        "S43 Industries",
        "MiningStation",
        "Gaulkevi Mining Station",
        "Gaulkevi",
        5966838,
        4650650,
        2.5913093090057373
    ],
    [
        177,
        "S43 Industries",
        "MiningStation",
        "Ejoiph Mining Station",
        "Ejoiph",
        6067973,
        4588541,
        -1.4353326559066772
    ],
    [
        178,
        "S43 Industries",
        "MiningStation",
        "Aneurted Mining Station",
        "Aneurted",
        6061330,
        4617555,
        -0.23902904987335205
    ],
    [
        179,
        "S43 Industries",
        "MiningStation",
        "Equai Mining Station",
        "Equai",
        5961525,
        4658069,
        0.4720560610294342
    ],
    [
        180,
        "S43 Industries",
        "MiningStation",
        "WO307 Mining Station",
        "WO307",
        5966201,
        4645355,
        2.335200786590576
    ]
];
