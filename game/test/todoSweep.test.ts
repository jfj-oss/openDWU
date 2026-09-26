// TODO(port) sweep (tasks/TODO-PORT-INVENTORY-2026-09-26.md): the "port-now" items, each asserted on a harness game
// (createTickGame: seed 1, 300 stars, player + 3 AIs, age 1) through the effect the C# statement has.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame, tickGameOptions } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { GalaxyLocationType } from '../src/sim/galaxyLocation';
import { HabitatCategoryType, type Habitat } from '../src/sim/types';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { galaxyResourceCurrentPrices } from '../src/sim/design';
import {
    annualTaxRevenue,
    calculateSpareAnnualRevenue,
    habitatAnnualRevenue,
    resourceCurrentPrice,
    troopCanRecruitFlags,
} from '../src/sim/forceStructure';
import { checkEmpireTerritoryCanBuildAtLocation, isObjectVisibleToThisEmpire, isStellarObjectDockable, assignIndependentTraderMissions } from '../src/sim/independentTraders';
import { checkEmpireTerritoryCanBuildAtHabitat, checkWhetherHabitatIsDangerous } from '../src/sim/resourceTargets';
import { aggressionLevel, cautionLevel, friendlinessLevel } from '../src/sim/diplomacyTick';
import { raceChangePeriodActive } from '../src/sim/colonyTick';
import { setEmpireDifficultyFactors } from '../src/sim/pirates';
import { EmpireMessageType } from '../src/sim/messages';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { Ruin } from '../src/sim/ruins';
import { createGame } from '../src/sim/game';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 600000);

const aiEmpires = (g: Galaxy): Empire[] => g.empires.filter((e) => e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);

describe('galaxy generation (Galaxy.4.cs 2794 GenerateGasCloud, Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid)', () => {
    it('every gas cloud sits in the central 70% of a NebulaCloud location, and stars keep the 4 x MaxSolarSystemSize spacing', () => {
        const g = createTickGame(gameData).galaxy;
        const nebulae = g.galaxyLocations.filter((l) => l.type === GalaxyLocationType.NebulaCloud);
        const clouds = g.habitats.filter((h) => h.category === HabitatCategoryType.GasCloud);
        expect(clouds.length).toBeGreaterThan(0);
        for (const c of clouds) {
            const inside = nebulae.some((l) => c.xpos >= l.xpos + l.width * 0.15 - 1e-6 && c.xpos <= l.xpos + l.width * 0.85 + 1e-6 && c.ypos >= l.ypos + l.height * 0.15 - 1e-6 && c.ypos <= l.ypos + l.height * 0.85 + 1e-6);
            expect(inside).toBe(true);
        }
        // SetupSun retries (up to 100 times) until the nearest Parent == null habitat is >= 92000 away: the stars of this
        // 300-star galaxy all found such a spot (the pre-port search ignored stars and packed them ~24000 apart).
        const stars = g.habitats.filter((h) => h.category === HabitatCategoryType.Star);
        let min = Number.MAX_VALUE;
        for (let i = 0; i < stars.length; i++) {
            for (let j = i + 1; j < stars.length; j++) min = Math.min(min, Math.hypot(stars[i].xpos - stars[j].xpos, stars[i].ypos - stars[j].ypos));
        }
        expect(min).toBeGreaterThanOrEqual(92000);
        // The runtime search (index grid) returns a Parent == null habitat: the star itself at its own position.
        expect(g.findNearestSystemGasCloudAsteroid(stars[5].xpos + 10, stars[5].ypos)).toBe(stars[5]);
        expect(g.generationTopLevelHabitats).toBeNull();
    }, 600000);

    it('GenerateContinentalPlanet gives the planet its Cargo / Troops / TroopsToRecruit / InvadingTroops lists (Galaxy.8.cs 479-482)', () => {
        const g = createTickGame(gameData).galaxy;
        const star = g.habitats.find((h) => h.category === HabitatCategoryType.Star)!;
        const p = g.generateContinentalPlanet(star);
        expect(p.cargo).not.toBeNull();
        expect(p.troops).not.toBeNull();
        expect(p.troopsToRecruit).not.toBeNull();
        expect(p.invadingTroops).not.toBeNull();
    }, 600000);
});

describe('forceStructure.ts economy reads', () => {
    it('ResourceCurrentPrices, TroopCanRecruit flags, raids, rebels and fuel costs reach the revenue maths', () => {
        const g = createTickGame(gameData).galaxy;
        const e = g.playerEmpire!;
        // Resource prices: the reviewed galaxy prices (20 reviews at game start moved them off the base price).
        const prices = galaxyResourceCurrentPrices(g);
        const moved = prices.findIndex((p, i) => p !== Math.fround(g.resourceSystem.resources[i].basePrice));
        expect(moved).toBeGreaterThanOrEqual(0);
        expect(resourceCurrentPrice(g, moved)).toBe(prices[moved]);
        expect(troopCanRecruitFlags(e)).toEqual({ infantry: e.troopCanRecruitInfantry, armored: e.troopCanRecruitArmored, artillery: e.troopCanRecruitArtillery, specialForces: e.troopCanRecruitSpecialForces });
        // Habitat.cs 878-882: a raid (countdown 30 → damage factor 0.25) cuts the colony's revenue by a quarter.
        const capital = e.capital!;
        const before = habitatAnnualRevenue(g, capital);
        capital.raidCountdown = 30;
        expect(habitatAnnualRevenue(g, capital)).toBeCloseTo(before * 0.75, 6);
        capital.raidCountdown = 0;
        // Empire.cs 1683: a rebelling colony adds no revenue.
        const tax = annualTaxRevenue(g, e);
        capital.rebelling = true;
        expect(annualTaxRevenue(g, e)).not.toBe(tax);
        capital.rebelling = false;
        // Empire.9.cs 5351: this year's state fuel costs come off the spare revenue.
        const spare = calculateSpareAnnualRevenue(g, e, 0);
        e.thisYearsStateFuelCosts = 1234;
        expect(calculateSpareAnnualRevenue(g, e, 0)).toBeCloseTo(spare - 1234, 6);
        e.thisYearsStateFuelCosts = 0;
    }, 600000);
});

describe('independentTraders.ts (Galaxy.3.cs 1799 IsStellarObjectDockable, Galaxy.cs 3671, Empire.9.cs 3065)', () => {
    it('war / trade sanctions and a blockade make a colony undockable', () => {
        const g = createTickGame(gameData).galaxy;
        const [a, b] = aiEmpires(g);
        const colony = b.capital!;
        expect(isStellarObjectDockable(g, colony, a)).toBe(true);
        const rel = obtainDiplomaticRelation(a, b);
        rel.type = DiplomaticRelationType.War;
        expect(isStellarObjectDockable(g, colony, a)).toBe(false);
        rel.type = DiplomaticRelationType.TradeSanctions;
        expect(isStellarObjectDockable(g, colony, a)).toBe(false);
        rel.type = DiplomaticRelationType.None;
        colony.isBlockaded = true;
        expect(isStellarObjectDockable(g, colony, a)).toBe(false);
        colony.isBlockaded = false;
    }, 600000);

    it('mining rights let an empire build in the other empire territory; viewable empires are visible', () => {
        const g = createTickGame(gameData).galaxy;
        const [a, b] = aiEmpires(g);
        const colony = b.capital!;
        const x = colony.xpos + 3000;
        const y = colony.ypos;
        expect(g.empireTerritory.checkLocationOwnership(g, x, y)).toBe(b.empireId);
        expect(checkEmpireTerritoryCanBuildAtLocation(g, a, x, y)).toBe(false);
        obtainDiplomaticRelation(b, a).miningRightsToOther = true;
        expect(checkEmpireTerritoryCanBuildAtLocation(g, a, x, y)).toBe(true);
        // Empire.9.cs 3071: _EmpiresViewable.
        const target = b.builtObjects.find((bo) => bo.role !== BuiltObjectRole.Base) ?? b.builtObjects[0];
        a.empiresViewable.push(b);
        expect(isObjectVisibleToThisEmpire(g, a, target)).toBe(true);
    }, 600000);

    it('a trader flagged RefuelForNextMission gets a Refuel mission; a retiring one invisible to the player is torn down', () => {
        const g = createTickGame(gameData).galaxy;
        const traders = g.independentEmpire!.privateBuiltObjects.filter((bo) => bo.role === BuiltObjectRole.Freight && bo.pirateEmpireId <= 0);
        expect(traders.length).toBeGreaterThan(1);
        const t1 = traders[0];
        t1.mission = null;
        t1.refuelForNextMission = true;
        const t2 = traders.find((t) => t !== t1 && !isObjectVisibleToThisEmpire(g, g.playerEmpire!, t)) ?? null;
        if (t2 !== null) {
            t2.mission = null;
            t2.retireForNextMission = true;
        }
        assignIndependentTraderMissions(g);
        expect(builtObjectMission(t1.mission)?.type).toBe(BuiltObjectMissionType.Refuel);
        expect(t1.refuelForNextMission).toBe(false);
        if (t2 !== null) {
            expect(t2.hasBeenDestroyed).toBe(true);
            expect(g.independentEmpire!.privateBuiltObjects.includes(t2)).toBe(false);
        }
    }, 600000);
});

describe('resourceTargets.ts (Empire.9.cs 4035 CheckWhetherHabitatIsDangerous, Galaxy.cs 3637)', () => {
    it('a pirate warship among the system threats makes the habitat dangerous', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpires(g)[0];
        const habitat = e.capital!;
        const sys = g.determineHabitatSystemStar(habitat);
        expect(checkWhetherHabitatIsDangerous(g, e, habitat)).toBe(false);
        const pirateShip = g.pirateEmpires.flatMap((p) => p.builtObjects).find((bo) => bo.role === BuiltObjectRole.Military && bo.warpSpeed > 0)!;
        expect(pirateShip).toBeDefined();
        e.visibility.systemVisibility[sys.systemIndex].threats = [pirateShip];
        expect(checkWhetherHabitatIsDangerous(g, e, habitat)).toBe(true);
    }, 600000);

    it('mining rights allow building at a habitat in the other territory', () => {
        const g = createTickGame(gameData).galaxy;
        const [a, b] = aiEmpires(g);
        const sys = g.determineHabitatSystemStar(b.capital!);
        const other = g.systemHabitatsOf(sys.systemIndex).find((h: Habitat) => h.owner === null && h.category !== HabitatCategoryType.Star)!;
        expect(checkEmpireTerritoryCanBuildAtHabitat(g, a, other)).toBe(false);
        obtainDiplomaticRelation(b, a).miningRightsToOther = true;
        expect(checkEmpireTerritoryCanBuildAtHabitat(g, a, other)).toBe(true);
    }, 600000);
});

describe('diplomacyTick.ts race levels (Race.cs 350-400)', () => {
    it('aggression / caution / friendliness switch to the periodic levels while the change period is active', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpires(g)[0];
        const race = e.dominantRace!;
        const base = [aggressionLevel(e), cautionLevel(e), friendlinessLevel(e)];
        expect(base).toEqual([race.aggression, race.caution, race.friendliness]);
        race.extra = { ...race.extra, PeriodicFactorsAggression: '180', PeriodicFactorsCaution: '60', PeriodicFactorsFriendliness: '300' };
        g.raceChangePeriodActive.add(race);
        expect(raceChangePeriodActive(g, race)).toBe(true);
        expect([aggressionLevel(e), cautionLevel(e), friendlinessLevel(e)]).toEqual([180, 60, 200]);
    }, 600000);
});

describe('empire.ts', () => {
    it('a low-quality habitat with a bonus ruin is worth colonizing (Empire.4.cs 4264)', () => {
        const g = createTickGame(gameData).galaxy;
        const e = g.playerEmpire!;
        const h = g.habitats.find((x) => x.category === HabitatCategoryType.Planet && x.quality < 0.5 && x.ruin === null && !x.resources.some((r) => (g.resourceSystem.byId.get(r.resourceId)?.superLuxuryBonusAmount ?? 0) > 0))!;
        expect(e.determineColonizeLowQualityHabitat(h)).toBe(false);
        const ruin = new Ruin('Test Ruins', 0, 0, 0, 0, 0, 0, 0);
        ruin.bonusWealth = 0.1;
        h.ruin = ruin;
        expect(e.determineColonizeLowQualityHabitat(h)).toBe(true);
    }, 600000);

    it('every purchased ship / base sends ShipBasePurchased to its owner (Empire.7.cs 1429)', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpires(g)[0];
        const purchased = (e.messages as { messageType: EmpireMessageType }[]).filter((m) => m.messageType === EmpireMessageType.ShipBasePurchased);
        expect(purchased.length).toBeGreaterThan(0);
    }, 600000);

    it('SetEmpireDifficultyFactors sets TargettingFactor / CountermeasuresFactor (BaconGalaxy.cs 137-138)', () => {
        const g = createTickGame(gameData).galaxy;
        const e = g.playerEmpire!;
        setEmpireDifficultyFactors(g, e, 4.0);
        expect(e.targettingFactor).toBeCloseTo(1.0 / Math.sqrt(e.difficultyLevel), 12);
        expect(e.countermeasuresFactor).toBeCloseTo(1.0 / Math.sqrt(e.difficultyLevel), 12);
        expect(e.targettingFactor).not.toBe(1.0);
    }, 600000);
});

describe('game.ts / gameStartTail.ts createGame tail', () => {
    it('player attack ranges and DiscoveryActionRuin come from the GameOptions; the capital ran Habitat.DoTasks', () => {
        const game = createGame(tickGameOptions(gameData));
        const p = game.playerEmpire;
        expect([p.attackRangePatrol, p.attackRangeEscort, p.attackRangeOther, p.attackRangeAttack]).toEqual([48000, 2000, 48000, 2000]);
        expect([p.attackRangePatrolManual, p.attackRangeEscortManual, p.attackRangeOtherManual, p.attackRangeAttackManual]).toEqual([-1, -1, -1, -1]);
        expect(p.discoveryActionRuin).toBe(0);
        // Start.2.cs 2035-2038: Capital.DoTasks(CurrentDateTime) stamps the capital's LastTouch with the start time.
        expect(p.capital!.lastTouch).toBe(game.galaxy.nowMs);
    }, 600000);
});
