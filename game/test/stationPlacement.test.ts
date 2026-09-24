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

function run() {
    const g = createGame(opts()).galaxy;
    g.startingAge = 1;
    const log: string[] = [];
    traceRnd(g, log);
    const phases: Record<string, string[]>[] = [];
    const researchTargets: Habitat[][] = [];
    for (const e of g.empires) {
        const ph: Record<string, string[]> = {};
        const mark = (name: string, f: () => void) => {
            const n = log.length;
            f();
            ph[name] = log.slice(n);
        };
        checkColoniesForBaseFacilities(e);
        let ports: string[] = [];
        mark('ports', () => {
            const amount = 1 + Math.trunc(e.colonies.length / 4.5);
            const list = determineNewSpacePortLocations(g, e, e.colonies, amount, false);
            ports = list.map((h) => h.name);
            createSpacePorts(g, e, list);
        });
        mark('colonyResources', () => {
            for (const h of e.colonies.filter((c) => ports.includes(c.name))) setColonyResources(g, h, e, true);
        });
        checkColoniesForBaseFacilities(e);
        mark('researchLocations', () => determineResearchStationLocation(g, e, false, true));
        researchTargets.push(e.researchHabitats.slice());
        mark('research', () => createResearchStations(g, e, false));
        mark('mining', () => createMiningStations(g, e, false));
        mark('luxury', () => setLuxuryResourcesAtColonies(g, e));
        phases.push(ph);
    }
    return { g, phases, researchTargets };
}

function summary(g: Galaxy) {
    return g.builtObjects.map((b) => [b.builtObjectID, b.empire!.name, S[b.subRole], b.name, b.parentHabitat!.name, Math.round(b.xpos), Math.round(b.ypos), b.heading]);
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
        const g = createGame(opts()).galaxy;
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
        expect(phases.map((p) => p.research)).toEqual([research, research, research, []]);
        expect(phases.map((p) => p.mining)).toEqual([mining6plusSkip, mining6plusSkip, mining6, mining6]);
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
const PINNED: unknown[] = [
    [1,  'S147 Kingdom',  'MediumSpacePort',  'Hotaulf Space Port',  'Hotaulf',  4692181,  1539086,  0.3117123246192932],
    [2,  'S147 Kingdom',  'WeaponsResearchStation',  'S147 Station',  'S147 3',  4722542,  1541421,  0.06623484194278717],
    [3,  'S147 Kingdom',  'GasMiningStation',  'S147 2 Gas Mining Station',  'S147 2',  4718787,  1548813,  -1.5028066635131836],
    [4,  'S147 Kingdom',  'GasMiningStation',  'S147 4 Gas Mining Station',  'S147 4',  4693276,  1538109,  -3.0344324111938477],
    [5,  'S147 Kingdom',  'GasMiningStation',  'S251 3 Gas Mining Station',  'S251 3',  4865387,  948087,  -0.21368546783924103],
    [6,  'S147 Kingdom',  'MiningStation',  'Gewes Mining Station',  'Gewes',  4691819,  1550413,  -2.1986124515533447],
    [7,  'S147 Kingdom',  'MiningStation',  'Alceycev Mining Station',  'Alceycev',  4693494,  1538304,  0.18163460493087769],
    [8,  'S147 Kingdom',  'MiningStation',  'Rhuleete Mining Station',  'Rhuleete',  4693603,  1538262,  2.347738027572632],
    [9,  'Haakonish Corporation',  'MediumSpacePort',  'S281 1 Space Port',  'S281 1',  4917347,  14063045,  -0.5463184714317322],
    [10,  'Haakonish Corporation',  'HighTechResearchStation',  'S281 Station',  'S281 4',  4924994,  14065272,  2.5363035202026367],
    [11,  'Haakonish Corporation',  'GasMiningStation',  'S281 2 Gas Mining Station',  'S281 2',  4923622,  14063508,  -1.0109935998916626],
    [12,  'Haakonish Corporation',  'GasMiningStation',  'S281 5 Gas Mining Station',  'S281 5',  4895858,  14055227,  -2.6399624347686768],
    [13,  'Haakonish Corporation',  'GasMiningStation',  'S281 3 Gas Mining Station',  'S281 3',  4909334,  14049279,  -3.0068461894989014],
    [14,  'Haakonish Corporation',  'MiningStation',  'Aldoi Mining Station',  'Aldoi',  4925042,  14065209,  -2.1748621463775635],
    [15,  'Haakonish Corporation',  'MiningStation',  'Eteph Mining Station',  'Eteph',  4917406,  14063000,  2.0216245651245117],
    [16,  'Haakonish Corporation',  'MiningStation',  'Raho Mining Station',  'Raho',  4923559,  14063614,  2.331791400909424],
    [17,  'S88 Union',  'MediumSpacePort',  'Toal Space Port',  'Toal',  6757792,  9953055,  -2.193997621536255],
    [18,  'S88 Union',  'HighTechResearchStation',  'S88 Research Center',  'S88 6',  6755229,  9942387,  -0.2908647656440735],
    [19,  'S88 Union',  'GasMiningStation',  'S88 3 Gas Mining Station',  'S88 3',  6757567,  9953110,  0.27321183681488037],
    [20,  'S88 Union',  'GasMiningStation',  'S88 2 Gas Mining Station',  'S88 2',  6781906,  9959397,  -0.5728729367256165],
    [21,  'S88 Union',  'GasMiningStation',  'S88 4 Gas Mining Station',  'S88 4',  6776593,  9938310,  2.484189033508301],
    [22,  'S88 Union',  'MiningStation',  'Searocand Mining Station',  'Searocand',  6781797,  9959584,  -2.5764307975769043],
    [23,  'S88 Union',  'MiningStation',  'Owleas Mining Station',  'Owleas',  6776794,  9938213,  -2.546337366104126],
    [24,  'S88 Union',  'MiningStation',  'Eppif Mining Station',  'Eppif',  6770450,  9971152,  -2.7316136360168457],
    [25,  'S46 Corporation',  'MediumSpacePort',  'Omesmehe Space Port',  'Omesmehe',  9406520,  14860705,  0.07212747633457184],
    [26,  'S46 Corporation',  'GasMiningStation',  'S46 3 Gas Mining Station',  'S46 3',  9411017,  14892917,  -2.85225248336792],
    [27,  'S46 Corporation',  'GasMiningStation',  'S46 1 Gas Mining Station',  'S46 1',  9404751,  14875560,  -2.1098945140838623],
    [28,  'S46 Corporation',  'GasMiningStation',  'S31 6 Gas Mining Station',  'S31 6',  9772899,  13916207,  1.128775715827942],
    [29,  'S46 Corporation',  'GasMiningStation',  'S46 2 Gas Mining Station',  'S46 2',  9403254,  14881242,  1.882344365119934],
    [30,  'S46 Corporation',  'GasMiningStation',  'TJ933 Gas Mining Station',  'TJ933',  9086417,  15125422,  -0.804036021232605],
    [31,  'S46 Corporation',  'MiningStation',  'Smoumesa Mining Station',  'Smoumesa',  9406541,  14860653,  -0.7389998435974121],
];
