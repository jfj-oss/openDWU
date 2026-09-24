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
        // (re-pinned: in createGame's own order the fourth empire also gets a research target.)
        expect(phases.map((p) => p.research)).toEqual([research, research, research, research]);
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
// (re-pinned: createGame now runs the first galaxy tick before this loop — its 150 independent
// traders take ids 1-150 and their Rnd draws shift the station points/headings/names.)
const PINNED: unknown[] = [
    [151,  'S147 Kingdom',  'MediumSpacePort',  'Hotaulf Space Port',  'Hotaulf',  4692114,  1539085,  1.7379629611968994],
    [152,  'S147 Kingdom',  'WeaponsResearchStation',  'S147 Research Facility',  'S147 3',  4722431,  1541180,  -2.3301198482513428],
    [153,  'S147 Kingdom',  'GasMiningStation',  'S147 2 Gas Mining Station',  'S147 2',  4718793,  1548770,  2.3197569847106934],
    [154,  'S147 Kingdom',  'GasMiningStation',  'S147 4 Gas Mining Station',  'S147 4',  4693152,  1538173,  -0.7135066390037537],
    [155,  'S147 Kingdom',  'GasMiningStation',  'S251 3 Gas Mining Station',  'S251 3',  4865198,  948115,  2.1504313945770264],
    [156,  'S147 Kingdom',  'MiningStation',  'Gewes Mining Station',  'Gewes',  4691753,  1550417,  -2.4236128330230713],
    [157,  'S147 Kingdom',  'MiningStation',  'Alceycev Mining Station',  'Alceycev',  4693553,  1538348,  1.221428632736206],
    [158,  'S147 Kingdom',  'MiningStation',  'Rhuleete Mining Station',  'Rhuleete',  4693561,  1538256,  -1.4129968881607056],
    [159,  'Haakonish Corporation',  'MediumSpacePort',  'S281 1 Space Port',  'S281 1',  4917395,  14063020,  2.3799712657928467],
    [160,  'Haakonish Corporation',  'HighTechResearchStation',  'S281 Research Facility',  'S281 4',  4925051,  14065098,  2.004002809524536],
    [161,  'Haakonish Corporation',  'GasMiningStation',  'S281 2 Gas Mining Station',  'S281 2',  4923679,  14063477,  -0.508375883102417],
    [162,  'Haakonish Corporation',  'GasMiningStation',  'S281 5 Gas Mining Station',  'S281 5',  4895837,  14055302,  -0.3740006387233734],
    [163,  'Haakonish Corporation',  'GasMiningStation',  'S281 3 Gas Mining Station',  'S281 3',  4909203,  14049464,  3.1252634525299072],
    [164,  'Haakonish Corporation',  'MiningStation',  'Aldoi Mining Station',  'Aldoi',  4925029,  14065201,  -1.6735355854034424],
    [165,  'Haakonish Corporation',  'MiningStation',  'Eteph Mining Station',  'Eteph',  4917432,  14063054,  2.4699816703796387],
    [166,  'Haakonish Corporation',  'MiningStation',  'Raho Mining Station',  'Raho',  4923562,  14063615,  2.0479631423950195],
    [167,  'S88 Union',  'MediumSpacePort',  'Toal Space Port',  'Toal',  6757788,  9953093,  1.9591331481933594],
    [168,  'S88 Union',  'HighTechResearchStation',  'S88 Station',  'S88 6',  6755303,  9942202,  1.6003285646438599],
    [169,  'S88 Union',  'GasMiningStation',  'S88 3 Gas Mining Station',  'S88 3',  6758027,  9953116,  0.11749134212732315],
    [170,  'S88 Union',  'GasMiningStation',  'S88 2 Gas Mining Station',  'S88 2',  6781501,  9959701,  -2.522240161895752],
    [171,  'S88 Union',  'GasMiningStation',  'S88 4 Gas Mining Station',  'S88 4',  6776934,  9938232,  -1.4881337881088257],
    [172,  'S88 Union',  'MiningStation',  'Searocand Mining Station',  'Searocand',  6781799,  9959539,  0.324599027633667],
    [173,  'S88 Union',  'MiningStation',  'Owleas Mining Station',  'Owleas',  6776757,  9938154,  2.722996711730957],
    [174,  'S88 Union',  'MiningStation',  'Eppif Mining Station',  'Eppif',  6770501,  9971124,  2.0642170906066895],
    [175,  'S46 Corporation',  'MediumSpacePort',  'Omesmehe Space Port',  'Omesmehe',  9406560,  14860723,  1.1919268369674683],
    [176,  'S46 Corporation',  'HighTechResearchStation',  'S31 Research Station',  'S31 4',  9773893,  13902309,  2.454179048538208],
    [177,  'S46 Corporation',  'GasMiningStation',  'S46 3 Gas Mining Station',  'S46 3',  9410871,  14892393,  1.414827585220337],
    [178,  'S46 Corporation',  'GasMiningStation',  'S46 1 Gas Mining Station',  'S46 1',  9404605,  14875316,  2.4456305503845215],
    [179,  'S46 Corporation',  'GasMiningStation',  'S31 6 Gas Mining Station',  'S31 6',  9772864,  13916307,  2.0620462894439697],
    [180,  'S46 Corporation',  'GasMiningStation',  'S46 2 Gas Mining Station',  'S46 2',  9402917,  14881436,  -2.527775764465332],
    [181,  'S46 Corporation',  'GasMiningStation',  'TJ933 Gas Mining Station',  'TJ933',  9082407,  15126223,  -0.6137555837631226],
    [182,  'S46 Corporation',  'MiningStation',  'Smoumesa Mining Station',  'Smoumesa',  9406506,  14860665,  -2.4643402099609375],
];
