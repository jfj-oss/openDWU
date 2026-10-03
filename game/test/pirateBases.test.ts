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
        // M4x: Galaxy.StartingAge is the galaxy age (Galaxy.cs 982), so an age-1 start sets galaxyAge too.
        galaxyAge: age,
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
        // Seed-dependent: the Rnd stream reaching Start.cs 1493-1533 (the extra faction near the player) moved at the
        // M4m merge (military AI draws in the game-start DoTasks on top of M4s2/M4y), so seed 1 now spawns it: 7 → 8.
        // (todosweep: the galaxy layout moved again with the nebula-anchored gas clouds / star spacing: 8 on seed 1.)
        // (orbit-spacing deviation, src/sim/orbitSpacing.ts: planet positions moved, so the extra faction is gone: 7.)
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
        // Seed 1, StartingAge 1: [state BuiltObjects, private BuiltObjects] per faction.
        // (re-pinned: createGame now runs the price reviews, the first galaxy tick's huge block and the
        // independent traders before GenerateNewPirateEmpires, plus pirate starting characters and the
        // Start.2.cs 1493-1533 near-player faction.)
        // (re-pinned M4k: the game-start Empire.DoTasks now runs PerformResearch — SelectNextResearchProject draws
        // Rnd (SelectRandomLowestProject) and research events draw Next(0, num4) per industry — so later game-start
        // Rnd draws shift.)
        // (re-pinned M4s1: ReviewPirateRelations draws Rnd.NextDouble in every game-start Empire long block and the Galaxy long
        // block's independent-colony pirate offers draw per colony, so GenerateNewPirateEmpires sees a different stream.)
        // (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        // Re-pinned M4u: game-start character reviews (ReviewCharacterTraits Rnd) and ReviewEmpireEvents (DoRaceEvent Rnd) move the Rnd stream before pirate generation.
        // Re-pinned M4x: opts() now sets galaxyAge = age (Galaxy.StartingAge is the galaxy age, Galaxy.cs 982), so the age-1
        // runs use Galaxy.Age 1 (Start.2.cs int_5 > 0 game-start steps, StartStarDate + 30000000): the Rnd stream moves.
        // (re-pinned M4m: the game-start Empire.DoTasks runs the military AI — IdentifyMilitaryObjectives Next(0, EmpireEvaluations.Count), CheckTemptingTargets Next(0, Empires.Count), DetermineRandomAttacks Next(0, n) — which shifts the Rnd stream.)
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        // Moved #dd202a064f → #c1f9ba75c5: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved #c1f9ba75c5 → #239bcef10c: per-empire/race ship naming styles (shipNameStyle.ts deviation): registry prefixes + race word lists; name strings only, Rnd draws unchanged (2026-10-01)
        // Moved #239bcef10c → #6d85abdace: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        expect(a).toMatchPin('pirateBases.fleets');
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
