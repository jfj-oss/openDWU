import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { setGovernmentsStatic, type Empire } from '../src/sim/empire';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import {
    PiratePlayStyle,
    colonyFillRatio,
    findNearestPirateFaction,
    generatePirateBaseName,
    generatePirateEmpire,
} from '../src/sim/pirates';

// Task M3e — pirate base + fleet block of Galaxy.8.cs GeneratePirateEmpire (4623-4820),
// CreatePirateMiningStations (776), super-pirate event trigger (Galaxy.cs 3297/3313).
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(age = 1, piratePrevalence = 1.0): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age, techLevel: 0.5 },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
        piratePrevalence,
    };
}

const S = BuiltObjectSubRole;
const countSub = (list: { subRole: BuiltObjectSubRole }[], sub: BuiltObjectSubRole) => list.filter((b) => b.subRole === sub).length;

// Galaxy.8.cs 4654-4687 fleet sizes; `flag` = StartingAge == 0 at game start.
function expectedFleet(style: PiratePlayStyle, flag: boolean) {
    let num7 = 2, num8 = 2, num9 = 2, num11 = 1, num12 = 1, count = 2;
    const num10 = 1;
    if (style === PiratePlayStyle.Pirate) { num7 = 3; num9 = 1; num12 = 1; }
    else if (style === PiratePlayStyle.Mercenary) { num7 = 4; num8 = 1; num9 = 1; num12 = 0; count = 1; }
    else if (style === PiratePlayStyle.Smuggler) { num7 = 1; num9 = 4; num12 = 1; count = 3; }
    if (!flag) { num7 = Math.trunc(num7 / 2); num8 = Math.trunc(num8 / 2); num11 = 0; }
    return { escorts: num7, explorers: num8, freighters: num9, construction: num10, resupply: num11, miners: num12, stations: count };
}

function checkFaction(g: Galaxy, p: Empire, flag: boolean) {
    const base = p.builtObjects[0];
    const home = p.pirateEmpireBaseHabitat!;
    expect(base.subRole).toBe(S.SmallSpacePort);
    expect(base.empire).toBe(p);
    expect(base.parentHabitat).toBe(home);
    expect(home.basesAtHabitat).toContain(base);
    expect(base.supportCostFactor).toBe(0);
    expect(p.spacePorts).toContain(base);
    expect(countSub(p.builtObjects, S.SmallSpacePort)).toBe(1);
    // Cargo by RelativeImportance (float compares against 0.4f / 0.25f / 0.1f).
    const rs = g.resourceSystem;
    for (const def of rs.strategicResourcesOrderedByRelativeImportance) {
        const ri = rs.relativeImportance.get(def.resourceId)!;
        const want = ri > Math.fround(0.4) || def.isFuel ? 6000 : ri > Math.fround(0.25) ? 4000 : ri > Math.fround(0.1) ? 2000 : 800;
        const c = base.cargo!.items.find((x) => x.commodity.resourceId === def.resourceId && x.empire === p)!;
        expect(c.amount).toBe(want);
    }
    const f = expectedFleet(p.piratePlayStyle, flag);
    // State ships: escorts, explorers, construction ship, resupply ship.
    expect(countSub(p.builtObjects, S.Escort)).toBe(f.escorts);
    expect(countSub(p.builtObjects, S.ExplorationShip)).toBe(f.explorers);
    expect(countSub(p.builtObjects, S.ConstructionShip)).toBe(f.construction);
    const resupplyDesign = p.designs.some((d) => d.subRole === S.ResupplyShip && !d.isObsolete);
    expect(countSub(p.builtObjects, S.ResupplyShip)).toBe(resupplyDesign ? f.resupply : 0);
    // Private ships: freighters, mining ships, gas mining ships (+ the mining stations).
    expect(countSub(p.privateBuiltObjects, S.SmallFreighter)).toBe(f.freighters);
    expect(countSub(p.privateBuiltObjects, S.MiningShip)).toBe(f.miners);
    expect(countSub(p.privateBuiltObjects, S.GasMiningShip)).toBe(f.miners);
    const stations = p.privateBuiltObjects.filter((b) => b.subRole === S.MiningStation || b.subRole === S.GasMiningStation);
    expect(stations.length).toBeGreaterThan(0);
    expect(stations.length).toBeLessThanOrEqual(f.stations);
    for (const st of stations) {
        expect(st.parentHabitat!.basesAtHabitat).toContain(st);
        expect(st.parentHabitat!.empire).toBeNull();
    }
    // Ships sit at the base habitat (offsetLocationFromParent: true).
    for (const b of [...p.builtObjects, ...p.privateBuiltObjects]) {
        if (b.subRole === S.MiningStation || b.subRole === S.GasMiningStation) continue;
        expect(b.parentHabitat).toBe(home);
    }
}

describe('pirate base + fleet (createGame, piratePrevalence 1.0)', () => {
    it('StartingAge 1: SmallSpacePort base with cargo, halved escorts/explorers, no resupply ship', () => {
        const g = createGame(opts(1)).galaxy;
        expect(g.pirateEmpires.length).toBe(7);
        for (const p of g.pirateEmpires) checkFaction(g, p, false);
    }, 60000);

    it('StartingAge 0: full fleet sizes (escorts/explorers not halved, resupply ship when designed)', () => {
        const g = createGame(opts(0)).galaxy;
        expect(g.pirateEmpires.length).toBeGreaterThan(0);
        for (const p of g.pirateEmpires) checkFaction(g, p, true);
    }, 60000);

    it('bases exist, so FindNearestPirateFaction finds factions and bases keep the 1,000,000 spacing', () => {
        const g = createGame(opts(1)).galaxy;
        for (const p of g.pirateEmpires) {
            const h = p.pirateEmpireBaseHabitat!;
            expect(findNearestPirateFaction(g, h.xpos, h.ypos, null, true)).toBe(p);
        }
        for (let i = 0; i < g.pirateEmpires.length; i++) {
            for (let j = 0; j < i; j++) {
                const a = g.pirateEmpires[i].pirateEmpireBaseHabitat!;
                const b = g.pirateEmpires[j].pirateEmpireBaseHabitat!;
                // GenerateNewPirateEmpires rejects a site whose nearest faction base is < 1e6 away.
                expect(g.calculateDistance(a.xpos, a.ypos, b.xpos, b.ypos)).toBeGreaterThanOrEqual(1000000.0);
            }
        }
    }, 60000);

    it('is deterministic (pinned base / fleet names for seed 1)', () => {
        const fp = () => createGame(opts(1)).galaxy.pirateEmpires.map((p) => [
            p.builtObjects.map((b) => `${S[b.subRole]}:${b.name}`).join('|'),
            p.privateBuiltObjects.map((b) => `${S[b.subRole]}:${b.name}`).join('|'),
        ]);
        const a = fp();
        expect(fp()).toEqual(a);
        expect(a).toEqual(PINNED_SEED1_FLEETS);
    }, 60000);

    it('super-pirate event cannot fire on this start (ColonyFillRatio <= 0.2)', () => {
        const g = createGame(opts(1)).galaxy;
        expect(colonyFillRatio(g)).toBeLessThanOrEqual(0.2);
        expect(g.pirateEmpires.some((p) => p.pirateEmpireSuperPirates)).toBe(false);
    }, 60000);
});

describe('Rnd sequence of the base block (Galaxy.8.cs 4626-4717)', () => {
    it('GeneratePirateBaseName draws Next(0,13), Next(0,20), Next(0,4) [+ Next(0,20) on 1]', () => {
        const g = createGame(opts(1, 0)).galaxy;
        const h = g.habitats.find((x) => x.category !== HabitatCategoryType.GasCloud && x.category !== HabitatCategoryType.Star)!;
        const log = spyRnd(g);
        generatePirateBaseName(g, h);
        expect(log.slice(0, 3).map((e) => e.k)).toEqual(['n0,13', 'n0,20', 'n0,4']);
        expect(log.length).toBe(log[2].v === 1 ? 4 : 3);
        if (log[2].v === 1) expect(log[3].k).toBe('n0,20');
    }, 60000);

    it('base name, heading, then per escort: Next(0,3), military name (3), heading, 2 offset draws', () => {
        const g = createGame(opts(0, 0)).galaxy;
        const independent = g.habitats.filter((x) => x.empire === g.independentEmpire && x.population.totalAmount > 0);
        const fuel = g.resourceSystem.fuelResources[0].resourceId;
        const home = g.habitats.find((x) => x.category !== HabitatCategoryType.GasCloud && x.category !== HabitatCategoryType.Star && x.empire === null && x.resources.some((r) => r.resourceId === fuel)) as Habitat;
        const race = g.races.find((r) => r.canBePirate)!;
        const log = spyRnd(g);
        const p = generatePirateEmpire(g, { independentColonies: independent, startingAge: 0, difficultyLevel: 1.0 }, home, 0, 0, race, -1, 0.5, PiratePlayStyle.Pirate, false, false);
        let i = log.findIndex((e, k) => e.k === 'n0,13' && log[k + 1]?.k === 'n0,20');
        expect(i).toBeGreaterThanOrEqual(0);
        i += 2;
        if (log[i].k === 'n0,4') {
            i++;
            if (log[i - 1].v === 1) expect(log[i++].k).toBe('n0,20');
        }
        expect(log[i++].k).toBe('d'); // base heading
        // Pirate play style at StartingAge 0: 3 escorts.
        for (let e = 0; e < 3; e++) {
            expect(log.slice(i, i + 7).map((x) => x.k)).toEqual(['n0,3', 'n0,76', 'n0,162', 'n0,5', 'd', 'd', 'd']);
            i += 7;
        }
        // Then the first explorer: standard name Next(0,127), Next(0,125), Next(0,7).
        expect(log.slice(i, i + 3).map((x) => x.k)).toEqual(['n0,127', 'n0,125', 'n0,7']);
        expect(countSub(p.builtObjects, S.Escort)).toBe(3);
    }, 60000);
});

function spyRnd(g: Galaxy): { k: string; v: number }[] {
    const log: { k: string; v: number }[] = [];
    const rnd = g.rnd as unknown as { next: (...a: number[]) => number; nextDouble: () => number };
    const next = rnd.next.bind(rnd);
    const nextDouble = rnd.nextDouble.bind(rnd);
    rnd.next = (...a: number[]) => {
        const v = next(...a);
        log.push({ k: 'n' + a.join(','), v });
        return v;
    };
    rnd.nextDouble = () => {
        const v = nextDouble();
        log.push({ k: 'd', v });
        return v;
    };
    return log;
}

// Seed 1, StartingAge 1: [state BuiltObjects, private BuiltObjects] per faction.
// (re-pinned: createGame now runs the price reviews, the first galaxy tick's huge block and the
// independent traders before GenerateNewPirateEmpires, plus pirate starting characters and the
// Start.2.cs 1493-1533 near-player faction.)
const PINNED_SEED1_FLEETS: unknown[] = [
    [
        'SmallSpacePort:Villainous Nest|ExplorationShip:Lucky Rover|ConstructionShip:Rusty Fantasy',
        'SmallFreighter:S272 Enterprise|SmallFreighter:S272 Starwind|SmallFreighter:Swift Nova|SmallFreighter:Pearl of S272|MiningShip:Quiet Starrider|GasMiningShip:Majestic Pearl|GasMiningStation:SC447 Gas Mining Station|GasMiningStation:EH473 Gas Mining Station|MiningStation:IB428, Asteroid Field Mining Station',
    ],
    [
        'SmallSpacePort:S106 Stronghold|Escort:Elite Sovereign|ExplorationShip:S106 Victory|ConstructionShip:Noble Empress',
        'SmallFreighter:Superb Hope|MiningShip:Hidden Orbit|GasMiningShip:Weary Disturbance|GasMiningStation:S106 9 Gas Mining Station|GasMiningStation:S106 5 Gas Mining Station',
    ],
    [
        'SmallSpacePort:S251 Rest|Escort:Insidious Devastation|ExplorationShip:Cryptic Star|ConstructionShip:Tarnished Impasse',
        'SmallFreighter:Cryptic Spirit|MiningShip:Adamant Echo|GasMiningShip:Solitary Nightstar|MiningStation:S107 3 Mining Station|MiningStation:Acruiwos Mining Station',
    ],
    [
        'SmallSpacePort:Bandits Rest|ExplorationShip:Stellar Journey|ConstructionShip:Wry Resolution',
        'SmallFreighter:Surly Imposter|SmallFreighter:Pathfinder of S97|SmallFreighter:Enchanted Bargain|SmallFreighter:S97 Adventure|MiningShip:Solemn Envoy|GasMiningShip:S97 Destiny|GasMiningStation:S257 1 Gas Mining Station|GasMiningStation:S284 4 Gas Mining Station|MiningStation:Freiten Mining Station',
    ],
    [
        'SmallSpacePort:Smugglers Haunt|Escort:Terrible Moon|ExplorationShip:Lavish Peril|ConstructionShip:Idle Scheme',
        'SmallFreighter:Grimy Starwind|MiningShip:Adamant Lurker|GasMiningShip:Slippery Imposter|GasMiningStation:Sol 3 Gas Mining Station|GasMiningStation:AB17 Gas Mining Station',
    ],
    [
        'SmallSpacePort:Gamblers Cove|Escort:Desperate Dragon|ExplorationShip:Valiant Voyager|ConstructionShip:Audacious Challenge',
        'SmallFreighter:Cautious Subterfuge|SmallFreighter:Rusty Gamble|MiningShip:Disturbance of S118|GasMiningShip:Hoard of S118|GasMiningStation:TH717 Gas Mining Station|GasMiningStation:S118 1 Gas Mining Station',
    ],
    [
        'SmallSpacePort:Villainous End|Escort:Merciless Cutlass|ExplorationShip:Radiant Lurker|ConstructionShip:Sneaky Pride',
        'SmallFreighter:Valiant Miracle|SmallFreighter:Aimless Nova|MiningShip:S68 Solace|GasMiningShip:S68 Victory|MiningStation:Sneyho Mining Station|MiningStation:S259 1 Mining Station',
    ],
];
