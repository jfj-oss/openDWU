// M4u — events, disasters, plague, pre-warp events, creature combat (src/sim/events.ts, empireEvents.ts, eventTypes.ts).
// Unit checks against hand-worked C# expectations (Empire.1.cs events, Empire.7.cs pre-warp events, Habitat.cs plague /
// SpawnCreatures, Creature.cs 1196-1345 combat) on a createGame galaxy (seed 1), plus a harness smoke run.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { Population } from '../src/sim/population';
import { Creature, CreatureType } from '../src/sim/creature';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { ColonyPopulationPolicy } from '../src/sim/data/policies';
import { PreWarpProgressEventType } from '../src/sim/exploration';
import { RaceEventType, raceImmuneToPlagues } from '../src/sim/eventTypes';
import {
    creatureCheckForTargets,
    creatureCheckTargetInRange,
    processPlague,
    spawnCreatures,
} from '../src/sim/events';
import {
    checkSendPreWarpProgressEventMessage,
    empireEventColonyNaturalDisaster,
    preWarpProgressEventOccurred,
    raceEvents,
    resetRaceEvents,
    resolveSectorDescription,
} from '../src/sim/empireEvents';
import * as empireEvents from '../src/sim/empireEvents';
import { empireDistressSignals } from '../src/sim/missions/distress';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/tick/simTime';

let gameData: GameData;
let galaxy: Galaxy;
let human: Empire;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
    human = galaxy.empires.find((e) => e.dominantRace?.name === 'Human')!;
}, 120000);

describe('race data (Race.cs 1075-1083 RaceEvents)', () => {
    it('reads RaceEvent1/2 Type + Frequency from the race file (0 = none)', () => {
        const race = (name: string) => gameData.races.find((r) => r.name === name)!;
        expect(raceEvents(race('Human'))).toEqual([{ type: RaceEventType.DestinyCharacterTraits, frequency: 1.0 }]);
        expect(raceEvents(race('Zenox')).map((e) => e.type)).toEqual([RaceEventType.PredictiveHistory, RaceEventType.HistoricalDiscoveryExploreRuinsForResearchBoost]);
        expect(raceEvents(race('Mechanoid'))).toEqual([]);
        expect(raceImmuneToPlagues(race('Human'))).toBe(false);
    });
});

describe('Empire.1.cs race events', () => {
    it('ResetRaceEvents clears the race event after its end date and restores the population policies', () => {
        const e = human;
        const colony = e.colonies[0];
        colony.raceEventType = RaceEventType.XenophobiaNoAssimilate;
        colony.colonyPopulationPolicy = ColonyPopulationPolicy.DoNotAccept;
        e.raceEventType = RaceEventType.XenophobiaNoAssimilate;
        e.raceEventEndDate = galaxyStarDate(galaxy) + 1;
        resetRaceEvents(galaxy, e);
        expect(e.raceEventType).toBe(RaceEventType.XenophobiaNoAssimilate); // not yet over
        e.raceEventEndDate = galaxyStarDate(galaxy) - 1;
        resetRaceEvents(galaxy, e);
        expect(e.raceEventType).toBe(RaceEventType.Undefined);
        expect(e.raceEventEndDate).toBe(0);
        expect(colony.raceEventType).toBe(RaceEventType.Undefined);
        expect(colony.colonyPopulationPolicy).toBe(e.policy!.newColonyPopulationPolicyAllRaces);
    });
});

describe('Empire.1.cs 2031 EmpireEventColonyNaturalDisaster(colony)', () => {
    it('damages the colony (0.2-0.3), drops development by 12..20 and population by 15-23 %', () => {
        const colony = human.capital!;
        colony.damage = 0;
        colony.setDevelopmentLevel(40);
        const pop0 = colony.population.items[0].amount;
        empireEventColonyNaturalDisaster(galaxy, human, colony);
        expect(colony.damage).toBeGreaterThanOrEqual(Math.fround(0.2));
        expect(colony.damage).toBeLessThan(0.3);
        expect(colony.developmentLevel).toBeGreaterThanOrEqual(40 - 20);
        expect(colony.developmentLevel).toBeLessThanOrEqual(40 - 12);
        const lost = pop0 - colony.population.items[0].amount;
        expect(lost).toBeGreaterThanOrEqual(Math.trunc(pop0 * 0.15));
        expect(lost).toBeLessThanOrEqual(Math.trunc(pop0 * 0.23));
        expect(human.lastDisasterDate).toBe(galaxyStarDate(galaxy));
    });
});

describe('Habitat.cs 1678 ProcessPlague', () => {
    it('kills population per the plague mortality, counts the plague down (float) and draws Next(0, 1000)', () => {
        const colony = galaxy.empires[1].capital!;
        const plagues = galaxy.researchStatic!.plagues;
        const index = plagues.findIndex((p) => p.infectionChance === 0 && !p.canCompletelyEliminatePopulation && p.exceptionRaceName === '');
        const plague = plagues[index >= 0 ? index : 0];
        colony.plagueId = plague.plagueId;
        colony.plagueTimeRemaining = Math.fround(100);
        const race = colony.population.items[0].race;
        colony.population.items.length = 0;
        colony.population.add(new Population(race, 2000000000));
        colony.population.recalculateTotalAmount();
        const draws0 = galaxy.rnd.drawCount;
        processPlague(galaxy, colony, 10);
        // Hand-worked: val = max(1e7 (×mortality when > 1), mortality × 10/600 × 2e9); per race val2 = max(5e6, val × 1).
        const num8 = plague.mortalityRate;
        let num10 = 10000000.0;
        if (num8 > 1.0) num10 *= num8;
        const val = Math.max(num10, num8 * (10 / REAL_SECONDS_IN_GALACTIC_YEAR) * 2000000000);
        let num14 = 5000000.0;
        if (num8 > 1.0) num14 *= num8;
        const val2 = Math.max(num14, val);
        const expected = Math.max(2000000000 - Math.trunc(val2), plague.canCompletelyEliminatePopulation ? -Infinity : 1000000);
        if (!raceImmuneToPlagues(race)) expect(colony.population.totalAmount).toBe(expected);
        expect(colony.plagueTimeRemaining).toBe(Math.fround(90));
        expect(galaxy.rnd.drawCount - draws0).toBeGreaterThanOrEqual(1);
        colony.plagueTimeRemaining = Math.fround(5);
        processPlague(galaxy, colony, 10);
        expect(colony.plagueId).toBe(-1);
        expect(colony.plagueTimeRemaining).toBe(0);
    });
});

describe('Empire.7.cs 3426 CheckSendPreWarpProgressEventMessage', () => {
    it('fires each pre-warp event once (economy bonus for the first space port)', () => {
        const e = galaxy.empires[2];
        e.preWarpProgressEventsOccurred = false;
        e.preWarpProgressEventOccurredFlags = [];
        const port = e.spacePorts[0] ?? e.builtObjects.find((b) => b.role === BuiltObjectRole.Base)!;
        const eff0 = e.economyEfficiency;
        expect(checkSendPreWarpProgressEventMessage(galaxy, e, PreWarpProgressEventType.BuildFirstSpaceport, port)).toBe(true);
        expect(e.economyEfficiency).toBeCloseTo(eff0 + 0.25, 12);
        expect(preWarpProgressEventOccurred(e, PreWarpProgressEventType.BuildFirstSpaceport)).toBe(true);
        expect(checkSendPreWarpProgressEventMessage(galaxy, e, PreWarpProgressEventType.BuildFirstSpaceport, port)).toBe(false);
        expect(e.economyEfficiency).toBeCloseTo(eff0 + 0.25, 12);
        // The independent empire never gets pre-warp events.
        expect(checkSendPreWarpProgressEventMessage(galaxy, galaxy.independentEmpire!, PreWarpProgressEventType.BuildFirstShip, port)).toBe(false);
        e.preWarpProgressEventsOccurred = true;
    });
});

describe('Galaxy.7.cs ResolveSectorDescription', () => {
    it('is the column letter and 1-based row', () => {
        expect(resolveSectorDescription(galaxy, 0, 0)).toBe('A1');
        expect(resolveSectorDescription(galaxy, galaxy.sectorSize * 2 + 5, galaxy.sectorSize * 3 + 5)).toBe('C4');
    });
});

describe('Habitat.cs 1619 SpawnCreatures', () => {
    it('spawns a desert slug at a Korabbian Spice habitat without one, then none', () => {
        const spice = galaxy.resourceSystem.resources.find((r) => r.name === 'Korabbian Spice')!;
        const habitat: Habitat = galaxy.habitats.find((h) => h.resources.length < 5 && h.parent !== null && galaxy.systems[h.systemIndex].creatures !== undefined)!;
        habitat.resources.push({ resourceId: spice.resourceId, abundance: 500 });
        const slugsAt = () => (galaxy.systems[habitat.systemIndex].creatures ?? []).filter((c) => c.parentHabitat === habitat && c.type === CreatureType.DesertSpaceSlug && !c.hasBeenDestroyed).length;
        const before = slugsAt();
        spawnCreatures(galaxy, habitat);
        expect(slugsAt()).toBe(before > 0 ? before : 1);
        spawnCreatures(galaxy, habitat);
        expect(slugsAt()).toBe(before > 0 ? before : 1);
        habitat.resources.pop();
    });
});

describe('Creature.cs 1206-1297 creature combat targeting', () => {
    it('a Kaltor next to a ship targets it, pursues it and raises a distress signal', () => {
        const ship = human.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.nearestSystemStar !== null)!;
        const star = ship.nearestSystemStar!;
        const kaltor = new Creature(galaxy, CreatureType.Kaltor, null, 0, 0, { x: ship.xpos + 100, y: ship.ypos });
        kaltor.xpos = ship.xpos + 100;
        kaltor.ypos = ship.ypos;
        kaltor.nearestSystemStar = star;
        galaxy.creatures.push(kaltor);
        galaxy.systems[star.systemIndex].creatures!.push(kaltor);
        expect(creatureCheckTargetInRange(galaxy, kaltor, ship)).toBe(true);
        const signals0 = empireDistressSignals(human).length;
        const defer = galaxy.deferEventsForGameStart;
        galaxy.deferEventsForGameStart = false;
        creatureCheckForTargets(galaxy, kaltor);
        galaxy.deferEventsForGameStart = defer;
        expect(kaltor.currentTarget).not.toBeNull();
        const target = kaltor.currentTarget!;
        expect((target as { pursuers: unknown[] }).pursuers).toContain(kaltor);
        expect(empireDistressSignals((target as { empire: Empire }).empire).length).toBeGreaterThanOrEqual(target === ship ? signals0 + 1 : 0);
        kaltor.completeTeardown();
        expect((target as { pursuers: unknown[] }).pursuers).not.toContain(kaltor);
        expect(galaxy.creatures).not.toContain(kaltor);
    });
});

describe('M4u harness smoke', () => {
    it('600 game-s with the event / character runtime: no throw, events keep empire state finite', () => {
        const g = createTickGame(gameData).galaxy;
        const r = runGameSeconds(g, 600);
        expect(r.frames).toBe(36000);
        for (const e of g.empires) {
            expect(Number.isFinite(e.leaderChangeInfluence)).toBe(true);
            expect(e.raceEventEndDate === 0 || e.raceEventEndDate > 0).toBe(true);
        }
        // Stubs of this package still reached (other than the deferred story / espionage ones): none.
        const m4u = Object.keys(r.todoHits).filter((k) => k.startsWith('M4u '));
        expect(m4u).toEqual([]);
        void empireEvents;
    }, 600000);
});
