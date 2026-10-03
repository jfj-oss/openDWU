// Parity fixes A2 (docs/parity/empire-ai-economy.md, ships-combat-fleets.md, galaxy-world-events.md): each block pins one
// C# behaviour that the port previously skipped or approximated.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Empire } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { checkSystemEnemyShipLevel, determineNewSpacePortLocations } from '../src/sim/stationPlacement';
import { raceAggressionLevel, raceFriendlinessLevel, raceReproductiveRate } from '../src/sim/racePeriodic';
import { calculateRacialReputationConcern } from '../src/sim/taxes';
import { Population } from '../src/sim/population';
import { selectRandomAggressiveRace } from '../src/sim/pirates';
import { designCalculateMaintenanceCosts } from '../src/sim/construction/empireConstruction';
import { racePeriodicRaceEvent } from '../src/sim/colonyTick';
import { RaceEventType } from '../src/sim/eventTypes';
import { baconSettings } from '../src/sim/data/baconSettings';
import { empireGovernmentAttributes } from '../src/sim/empire';
import { calculateScenicFactorIncludingRuinsWonders, checkColonyForResourceClearance } from '../src/sim/civilianAI';
import { maximumFuelRange } from '../src/sim/movement';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { PlanetaryFacility } from '../src/sim/construction/facilities';
import { PlanetaryFacilityType, WonderType, facilityType } from '../src/sim/researchSystem';
import { raceBuildWonderVictoryFacility } from '../src/sim/researchTick';
import { troopLevelRequired } from '../src/sim/troops';
import { assignFleetRetrofit } from '../src/sim/construction/empireConstruction';
import { ShipGroup, empireShipGroups } from '../src/sim/fleets/shipGroup';
import { shipGroupAddShipToFleet } from '../src/sim/fleets/shipGroupTasks';
import { findNewestCanBuildFullEvaluate } from '../src/sim/designGeneration';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGame(): Game {
    return cachedTickGame(gameData);
}

function mobileWarship(g: Game, owner: Empire): BuiltObject {
    const bo = g.galaxy.builtObjects.find((b) => b != null && b.empire === owner && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.isFunctional && b.firepowerRaw > 0);
    expect(bo, `a mobile functional warship of ${owner.name}`).toBeDefined();
    return bo!;
}

describe('Empire.6.cs 3165 CheckSystemEnemyShipLevel', () => {
    it('sums FirepowerRaw of mobile functional ships of war enemies / non-protection pirates in SystemVisibility.Threats', () => {
        const g = newGame();
        const e = g.playerEmpire;
        const others = g.galaxy.empires.filter((x) => x !== e && x.pirateEmpireBaseHabitat === null && x !== g.galaxy.independentEmpire);
        const enemy = others.find((x) => g.galaxy.builtObjects.some((b) => b != null && b.empire === x && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.isFunctional && b.firepowerRaw > 0))!;
        const ship = mobileWarship(g, enemy);
        const colony = e.colonies[0];
        const sv = e.visibility.systemVisibility[colony.systemIndex];
        sv.threats = [ship];
        const rel = obtainDiplomaticRelation(e, enemy);
        rel.type = DiplomaticRelationType.NotMet;
        expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(0);
        rel.type = DiplomaticRelationType.War;
        expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(ship.firepowerRaw);
        sv.threats = [ship, ship];
        expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(2 * ship.firepowerRaw);
        // Our own ships never count.
        sv.threats = [mobileWarship(g, e)];
        expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(0);

        const pirates = g.galaxy.pirateEmpires.find((p) => g.galaxy.builtObjects.some((b) => b != null && b.empire === p && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.isFunctional && b.firepowerRaw > 0));
        if (pirates !== undefined) {
            const pship = mobileWarship(g, pirates);
            sv.threats = [pship];
            const pr = obtainPirateRelation(e, pirates);
            pr.type = PirateRelationType.Protection;
            expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(0);
            pr.type = PirateRelationType.None;
            expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(pship.firepowerRaw);
        }
    });

    it('DetermineNewSpacePortLocations(excludeColoniesWithEnemiesPresent) skips a colony whose system holds an enemy warship', () => {
        const g = newGame();
        // The seed-1 start gives each empire one colony (with its port), so offer the player an independent colony in a
        // portless system as the candidate (with ConstructionSpaceportMinimumDistance 0 any portless system qualifies).
        const e = g.playerEmpire;
        e.policy!.constructionSpaceportMinimumDistance = 0;
        const portSystems = new Set(e.spacePorts.map((p) => p.parentHabitat?.systemIndex));
        const colony = g.galaxy.habitats.find((h) => h.empire === g.galaxy.independentEmpire && h.population.totalAmount > 0 && !portSystems.has(h.systemIndex))!;
        expect(colony).toBeDefined();
        expect(determineNewSpacePortLocations(g.galaxy, e, [colony], 1, true)).toEqual([colony]);
        const enemy = g.galaxy.empires.find((x) => x !== e && x.pirateEmpireBaseHabitat === null && x !== g.galaxy.independentEmpire && g.galaxy.builtObjects.some((b) => b != null && b.empire === x && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.isFunctional && b.firepowerRaw > 0))!;
        obtainDiplomaticRelation(e, enemy).type = DiplomaticRelationType.War;
        e.visibility.systemVisibility[colony.systemIndex].threats = [mobileWarship(g, enemy)];
        expect(determineNewSpacePortLocations(g.galaxy, e, [colony], 1, true)).toEqual([]);
        expect(determineNewSpacePortLocations(g.galaxy, e, [colony], 1, false)).toEqual([colony]);
    });
});

describe('Race.cs 306-400 periodic personality (ChangePeriodActive)', () => {
    it('races/*.txt PeriodicChange* / PeriodicFactors* reach the accessors (they are parsed fields, not Race.extra)', () => {
        const dhayut = gameData.races.find((r) => r.name === 'Dhayut')!;
        expect([dhayut.changePeriodYearsInterval, dhayut.changePeriodYearsLength, dhayut.periodicAggressionLevel, dhayut.periodicGrowthRate]).toEqual([5, 2, 133, 1.28]);
    });

    it('while the period is active the C# Race properties read the periodic values at the sim call sites', () => {
        const g = newGame().galaxy;
        const dhayut = g.races.find((r) => r.name === 'Dhayut')!;
        const securan = g.races.find((r) => r.name === 'Securan')!;
        const before = {
            aggression: raceAggressionLevel(g, dhayut),
            friendliness: raceFriendlinessLevel(g, securan),
            growth: raceReproductiveRate(g, dhayut),
            concern: calculateRacialReputationConcern(g, dhayut),
            popGrowth: new Population(dhayut, 1000, g).growthRate,
        };
        expect(before).toEqual({ aggression: 119, friendliness: 110, growth: 1.12, concern: Math.max(1, (119 / 65) ** 5), popGrowth: Math.fround(1.12) });
        g.raceChangePeriodActive.add(dhayut);
        g.raceChangePeriodActive.add(securan);
        expect(raceAggressionLevel(g, dhayut)).toBe(133);
        expect(raceFriendlinessLevel(g, securan)).toBe(140);
        expect(raceReproductiveRate(g, dhayut)).toBe(1.28);
        // Empire.cs 3104 CalculateRacialReputationConcern: AggressionLevel / FriendlinessLevel.
        expect(calculateRacialReputationConcern(g, dhayut)).toBeCloseTo((133 / 65) ** 5, 10);
        // Population.cs 62: _GrowthRate = (float)race.ReproductiveRate.
        expect(new Population(dhayut, 1000, g).growthRate).toBe(Math.fround(1.28));
        // Galaxy.8.cs 3747 SelectRandomAggressiveRace: AggressionLevel >= threshold (Dhayut 133 >= 125 only while active).
        g.raceChangePeriodActive.delete(dhayut);
        const draws = () => {
            const seen = new Set<string>();
            for (let i = 0; i < 200; i++) seen.add(selectRandomAggressiveRace(g, 125)?.name ?? '-');
            return seen;
        };
        expect(draws().has('Dhayut')).toBe(false);
        g.raceChangePeriodActive.add(dhayut);
        expect(draws().has('Dhayut')).toBe(true);
    });
});

describe('BaconDesign.cs 163 CalculateMaintenanceCosts: StrengthInNumbers small-ship discount', () => {
    it('a quarter off ships of size <= 200 while the Gizurean change period (StrengthInNumbers event) is active', () => {
        const g = newGame();
        const e = g.playerEmpire;
        const gizurean = g.galaxy.races.find((r) => r.name === 'Gizurean')!;
        expect(racePeriodicRaceEvent(gizurean)).toBe(RaceEventType.StrengthInNumbersMaintenanceLowerForSmallShips);
        e.dominantRace = gizurean;
        const small = e.designs.find((d) => d.size <= 200 && d.maintenanceSavings + 0.25 < 1)!;
        const big = e.designs.find((d) => d.size > 200)!;
        expect(small).toBeDefined();
        expect(big).toBeDefined();
        const smallBase = designCalculateMaintenanceCosts(g.galaxy, small, e);
        const bigBase = designCalculateMaintenanceCosts(g.galaxy, big, e);
        g.galaxy.raceChangePeriodActive.add(gizurean);
        const smallActive = designCalculateMaintenanceCosts(g.galaxy, small, e);
        expect(designCalculateMaintenanceCosts(g.galaxy, big, e)).toBe(bigBase);
        expect(smallActive).toBeLessThan(smallBase);
        // (num1 - min(1, savings + 0.25 + leader) * num1) * num5: the drop is 0.25 * num1 * num5 (below the cap).
        const num1 = Math.trunc(small.calculateCurrentPurchasePrice(g.galaxy) / baconSettings.shipMarkupFactor) + 1 + baconSettings.shipMaintenanceCostPerSizeUnit * small.size;
        const num5 = empireGovernmentAttributes(e)?.maintenanceCosts ?? 1;
        expect(smallBase - smallActive).toBeCloseTo(0.25 * num1 * num5, 9);
    });
});

describe('Habitat.cs 1122 CalculateScenicFactorIncludingRuinsWonders: built wonders', () => {
    it('a completed wonder scores its largest Value1 / 100; an unfinished one scores nothing', () => {
        const g = newGame().galaxy;
        const h = g.habitats.find((x) => x.scenicFactor <= 0 && x.ruin === null)!;
        const wonders = (g.researchStatic?.facilities ?? []).filter((fd) => facilityType(fd) === PlanetaryFacilityType.Wonder && fd.value1 > 0);
        expect(wonders.length).toBeGreaterThan(1);
        const [a, b] = [...wonders].sort((x, y) => x.value1 - y.value1).slice(-2);
        expect(calculateScenicFactorIncludingRuinsWonders(h)).toBe(0);
        h.facilities = [new PlanetaryFacility(b, 0.5)];
        expect(calculateScenicFactorIncludingRuinsWonders(h)).toBe(0);
        h.facilities = [new PlanetaryFacility(a, 1), new PlanetaryFacility(b, 1)];
        expect(calculateScenicFactorIncludingRuinsWonders(h)).toBe(Math.max(a.value1, b.value1) / 100);
        // Natural scenery above the wonder term wins.
        h.scenicFactor = 10;
        expect(calculateScenicFactorIncludingRuinsWonders(h)).toBe(Math.max(10, b.value1 / 100));
    });
});

describe('Galaxy.3.cs 2015-2045 SetResearchRaceSpecialProjects: BuildWonder victory wonders', () => {
    it("each race-achievement wonder's research node is restricted to the races that must build it", () => {
        const g = newGame().galaxy;
        const stat = g.researchStatic!;
        const checked: string[] = [];
        for (const name of ['Gizurean', 'Shandar', 'Zenox', 'Wekkarus']) {
            const race = g.races.find((r) => r.name === name)!;
            const wonder = raceBuildWonderVictoryFacility(g, race);
            expect(wonder, `${name} BuildWonder facility`).not.toBeNull();
            if (facilityType(wonder!) !== PlanetaryFacilityType.Wonder || (wonder!.wonderType as WonderType) !== WonderType.RaceAchievement) continue;
            const node = stat.definitions.find((d) => d.facilityId !== null && d.facilityId >= 0 && stat.facilities[d.facilityId]?.facilityId === wonder!.facilityId)!;
            expect(node, `${name} wonder research node`).toBeDefined();
            expect([...(stat.allowedRaces.get(node.projectId) ?? [])]).toContain(name);
            checked.push(name);
        }
        expect(checked.length).toBeGreaterThan(0);
        // No race outside the BuildWonder owners (or the node's own SpecifiedRaces) may research them.
        for (const name of checked) {
            const race = g.races.find((r) => r.name === name)!;
            const wonder = raceBuildWonderVictoryFacility(g, race)!;
            const node = stat.definitions.find((d) => d.facilityId !== null && d.facilityId >= 0 && stat.facilities[d.facilityId]?.facilityId === wonder.facilityId)!;
            const owners = g.races.filter((r) => raceBuildWonderVictoryFacility(g, r)?.facilityId === wonder.facilityId).map((r) => r.name);
            for (const allowed of stat.allowedRaces.get(node.projectId)!) expect([...owners, ...node.allowedRaces]).toContain(allowed);
        }
    });
});

describe('Habitat.cs 318 TroopLevelRequired: Empire.Capitals and PenalColonies', () => {
    it('an extra capital gets the capital multiplier; a penal colony needs at least 200', () => {
        const g = newGame();
        const e = g.playerEmpire;
        const gal = g.galaxy;
        // A second colony for the player (test-only re-ownership of an independent colony).
        const h = gal.habitats.find((x) => x.empire === gal.independentEmpire && x.population.totalAmount > 0 && x !== e.capital && x !== e.homeWorld)!;
        h.empire = e;
        h.owner = e;
        e.policy!.troopGarrisonMinimumPerColony = 0;
        const plain = troopLevelRequired(gal, h, gal.difficultyLevel);
        const savedCapital = e.capital;
        e.capital = h;
        const asCapital = troopLevelRequired(gal, h, gal.difficultyLevel);
        e.capital = savedCapital;
        expect(asCapital).toBeGreaterThan(plain);
        e.capitals = [...e.capitals, h];
        expect(troopLevelRequired(gal, h, gal.difficultyLevel)).toBe(asCapital);
        e.capitals = e.capitals.filter((x) => x !== h);
        expect(troopLevelRequired(gal, h, gal.difficultyLevel)).toBe(plain);
        // PenalColonies: Max(200, num) before the policy multiplier.
        const mult = Math.max(e.policy!.troopRecruitInfantryLevel, e.policy!.troopGarrisonLevel);
        expect(plain, 'precondition: the plain need is below the penal floor').toBeLessThan(Math.trunc(200 * mult));
        e.penalColonies = [h];
        const penal = troopLevelRequired(gal, h, gal.difficultyLevel);
        expect(penal).toBeGreaterThanOrEqual(Math.trunc(200 * mult));
        expect(penal).toBeGreaterThanOrEqual(plain);
    });
});

describe('Empire.9.cs 625 AssignFleetRetrofit: the fleet mission carries the design', () => {
    it("ShipGroup.AssignMission(Retrofit, yard, null, design, High, true) stores the lead ship's newest design", () => {
        const g = newGame();
        const gal = g.galaxy;
        // A two-warship fleet of the player (as livelyGalaxy19l.test.ts builds them).
        const e = g.playerEmpire;
        const ships = gal.builtObjects.filter((b) => b != null && b.empire === e && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.shipGroup === null).slice(0, 2);
        expect(ships.length).toBe(2);
        const fleet = new ShipGroup(gal);
        fleet.empire = e;
        for (const s of ships) shipGroupAddShipToFleet(gal, fleet, s!);
        empireShipGroups(e).push(fleet);
        expect(fleet.leadShip).not.toBeNull();
        const yard = fleet.empire!.spacePorts[0];
        expect(assignFleetRetrofit(gal, fleet.empire!, fleet!, yard, false)).toBe(true);
        expect(fleet.mission).not.toBeNull();
        expect(fleet.mission!.type).toBe(BuiltObjectMissionType.Retrofit);
        const expected = findNewestCanBuildFullEvaluate(fleet.empire!.designs, fleet.leadShip!.subRole, null);
        expect(expected).not.toBeNull();
        expect(fleet.mission!.design).toBe(expected);
    });
});

describe('Empire.5.cs 4063 CheckColonyForResourceClearance: the cached refuelling location', () => {
    it('WithinFuelRangeAndRefuel(x, y, 0, ship.CachedRefuellingLocation) keeps the margin to the cached refuel point', () => {
        const build = () => {
            const g = newGame();
            const e = g.playerEmpire;
            const colony = e.capital!;
            const ship = g.galaxy.builtObjects.find((b) => b != null && b.empire === e && b.cargoCapacity > 0 && b.cargoSpace > 0 && b.topSpeed > 0 && b.role !== BuiltObjectRole.Base && b.subRole !== BuiltObjectSubRole.ConstructionShip)!;
            expect(ship, 'a freighter-like ship of the player').toBeDefined();
            ship.xpos = colony.xpos + 50;
            ship.ypos = colony.ypos;
            ship.currentFuel = ship.fuelCapacity;
            return { g, e, colony, ship };
        };
        // No cached point: in range, so the colony's surplus is cleared (a transport mission is assigned).
        const a = build();
        a.ship.refuellingLocation = null;
        expect(checkColonyForResourceClearance(a.g.galaxy, a.e, a.ship, a.colony)).toBe(true);
        // A cached point farther than the ship's whole fuel range from the colony: margin >= 1, no clearance.
        const b = build();
        const range = maximumFuelRange(b.ship);
        const far = b.g.galaxy.habitats.find((h) => b.g.galaxy.calculateDistance(h.xpos, h.ypos, b.colony.xpos, b.colony.ypos) > range * 1.05)!;
        expect(far).toBeDefined();
        b.ship.refuellingLocation = far;
        expect(checkColonyForResourceClearance(b.g.galaxy, b.e, b.ship, b.colony)).toBe(false);
    });
});
