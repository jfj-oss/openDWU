import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { Empire, setGovernmentsStatic } from '../src/sim/empire';
import { makeHabitatIntoColony } from '../src/sim/colony';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { EventMessageType } from '../src/sim/eventTypes';
import { scanArea } from '../src/sim/exploration';
import { updatePosition } from '../src/sim/movement';
import { generateHabitatLocationDescription, generateIndependentColonyReport, generateLocationDescription, resolveRaceFamilyDescription } from '../src/sim/galaxyReports';
import { cachedTickGame } from './helpers/gameCache';
import { Random } from '../src/sim/random';
import { GalaxyLocation, GalaxyLocationType } from '../src/sim/galaxyLocation';
import { formatGameTextNow } from '../src/sim/textResolver';
import { generateSaleableInfoForEmpire } from '../src/sim/pirates/pirateRelationsAI';

// Parity batch D4: targeted tests for the remaining sim gaps (docs/parity/*.md).
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function makeGalaxy(): Galaxy {
    return generateGalaxy({ seed: 5, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
}
const emptyPlanets = (g: Galaxy): Habitat[] => g.habitats.filter((h) => h.category === HabitatCategoryType.Planet && h.population.totalAmount === 0);

describe('GrowPopulation(TimeSpan.Zero) at colony creation (Galaxy.8.cs 674)', () => {
    it('clamps an aged starting population to MaximumPopulation', () => {
        const g = makeGalaxy();
        const race = gameData.races.find((r) => r.name === 'Human') ?? gameData.races[0];
        const planets = emptyPlanets(g);
        const capital = planets[0];
        // The smallest planet: an age-6 population (300M..700M x quality x 1.7^6) is far above its maximum.
        const target = planets.slice(1).reduce((a, b) => (b.maxPopulation < a.maxPopulation ? b : a));
        const empire = new Empire(g, 'Test Empire', capital, race, 0, 1.0, null);
        makeHabitatIntoColony(g, target, empire, 6, race, 1.0, false);
        expect(target.population.totalAmount).toBeGreaterThan(0);
        expect(target.population.totalAmount).toBeLessThanOrEqual(target.maxPopulation);
        let sum = 0;
        for (const p of target.population.items) sum += p.amount;
        expect(sum).toBe(target.population.totalAmount);
    });
});

describe('ScanArea discovery reports (BuiltObject.1.cs 2069-2098)', () => {
    function surveyAt(game: Game, h: Habitat) {
        const g = game.galaxy;
        const player = g.playerEmpire!;
        const ship = player.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ExplorationShip)!;
        const events: { type: EventMessageType; title: string; message: string }[] = [];
        player.eventMessageRecipient = { receiveEventMessage: (type, title, message) => events.push({ type, title, message }) };
        player.resourceMap!.setResourcesKnown(h, false);
        ship.xpos = h.xpos;
        ship.ypos = h.ypos;
        updatePosition(g, ship);
        scanArea(g, ship);
        return { g, player, ship, events };
    }

    it('an independent colony sends the Independent Colony Discovered report (Galaxy.1.cs 1314)', () => {
        const game = cachedTickGame(gameData, {});
        const g = game.galaxy;
        const colony = g.independentColonies.find((h) => h.population.dominantRace !== null && h.population.dominantRace !== g.playerEmpire!.dominantRace)!;
        expect(colony).toBeDefined();
        const { events, player } = surveyAt(game, colony);
        expect(player.resourceMap!.checkResourcesKnown(colony)).toBe(true);
        const report = events.find((e) => e.type === EventMessageType.IndependentPopulation);
        expect(report).toBeDefined();
        expect(report!.message).toContain(colony.population.dominantRace!.name);
        expect(report!.message).toContain(colony.name);
        // Another race: the race report follows the intro (GenerateRaceReport's family line).
        expect(report!.message).toContain(resolveRaceFamilyDescription(g, colony.population.dominantRace!.raceFamily));
    });

    it('the player\'s report uses up one of the first secondary story clues, with one Rnd draw (Galaxy.5.cs 3692)', () => {
        const game = cachedTickGame(gameData, {});
        const g = game.galaxy;
        const colony = g.independentColonies.find((h) => h.population.dominantRace !== null)!;
        // A Distant Worlds story in progress: clue 0 used, clue 1 open at a live location.
        g.storyClueUsed = [true, false];
        g.storyClueLocations = [colony, colony];
        g.storySecondaryClueUsed = Array.from({ length: 9 }, () => false);
        const before = new Random(0);
        before.setState(g.rnd.getState());
        const expectedIndex = before.next(0, 2);
        const report = generateIndependentColonyReport(g, g.playerEmpire!, colony, colony.population.dominantRace!);
        expect(g.storySecondaryClueUsed.filter((x) => x)).toEqual([true]);
        expect(g.storySecondaryClueUsed[expectedIndex]).toBe(true);
        expect(report).toContain('*** ');
        expect(g.rnd.next(0, 1 << 30)).toBe(before.next(0, 1 << 30));
        // An AI colonizer gets no clue and draws nothing.
        const ai = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire)!;
        const r2 = new Random(0);
        r2.setState(g.rnd.getState());
        generateIndependentColonyReport(g, ai, colony, colony.population.dominantRace!);
        expect(g.rnd.next(0, 1 << 30)).toBe(r2.next(0, 1 << 30));
    });

    it('a restricted resource on an unowned planet sends the "X Discovered" message', () => {
        const game = cachedTickGame(gameData, {});
        const g = game.galaxy;
        const h = g.habitats.find((x) => x.empire === null && x.resources.some((r) => g.resourceSystem.resources[r.resourceId].superLuxuryBonusAmount > 0))!;
        expect(h).toBeDefined();
        const { events } = surveyAt(game, h);
        const names = h.resources.filter((r) => g.resourceSystem.resources[r.resourceId].superLuxuryBonusAmount > 0).map((r) => g.resourceSystem.resources[r.resourceId].name);
        const found = events.filter((e) => e.type === EventMessageType.RestrictedResourceDiscovered);
        expect(found.length).toBe(names.length);
        for (const n of names) expect(found.some((e) => e.title.includes(n))).toBe(true);
    });
});

describe('GenerateLocationDescription (Galaxy.5.cs 4807 / 4852)', () => {
    it('a point at a habitat names the habitat; a point in deep space names its sector', () => {
        const game = cachedTickGame(gameData, {});
        const g = game.galaxy;
        const planet = g.habitats.find((h) => h.category === HabitatCategoryType.Planet)!;
        const atPlanet = generateLocationDescription(g, planet.xpos, planet.ypos);
        expect(atPlanet).toBe(generateHabitatLocationDescription(g, planet));
        expect(atPlanet).toContain(planet.name);
        const star = g.determineHabitatSystemStar(planet)!;
        const far = generateLocationDescription(g, star.xpos + 60000, star.ypos);
        expect(far).not.toContain(planet.name);
        expect(far.length).toBeGreaterThan(0);
    });
});

describe('GenerateSaleableInfoForEmpire reads Galaxy.StoryCluesEnabled (Empire.5.cs 1286)', () => {
    it('the story Dead Zone is for sale only once story clues are on', () => {
        const game = cachedTickGame(gameData, {});
        const g = game.galaxy;
        const pirate = g.pirateEmpires.find((p) => p.pirateEmpireBaseHabitat !== null)!;
        const base = pirate.pirateEmpireBaseHabitat!;
        const zone = new GalaxyLocation(formatGameTextNow('Dead Zone'), GalaxyLocationType.RestrictedArea, base.xpos + 1000, base.ypos, 2000, 2000, -1);
        pirate.visibility.knownGalaxyLocations.push(zone);
        g.storyCluesEnabled = false;
        expect(generateSaleableInfoForEmpire(g, pirate, g.playerEmpire).restrictedAreaLocations).not.toContain(zone);
        g.storyCluesEnabled = true;
        expect(generateSaleableInfoForEmpire(g, pirate, g.playerEmpire).restrictedAreaLocations).toContain(zone);
    });
});

describe('IsObjectVisibleToThisEmpire(Creature) (Empire.9.cs 3037)', () => {
    it('a deep-space creature is visible only in a long-range scanner\'s range or with a ship outside a system near it', () => {
        const game = cachedTickGame(gameData, {});
        const g = game.galaxy;
        const player = g.playerEmpire!;
        const creature = g.creatures.find((c) => c != null && !c.hasBeenDestroyed)!;
        // Park it in the emptiest corner of the galaxy, away from every system.
        creature.xpos = 50;
        creature.ypos = 50;
        creature.nearestSystemStar = null;
        creature.isVisible = true;
        expect(player.visibility.isCreatureVisible(creature)).toBe(false);
        const scanner = player.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ExplorationShip)!;
        const saved = player.longRangeScanners.slice();
        scanner.sensorLongRange = 5000;
        scanner.xpos = 3000;
        scanner.ypos = 50;
        player.longRangeScanners.push(scanner);
        expect(player.visibility.isCreatureVisible(creature)).toBe(true);
        creature.isVisible = false;
        expect(player.visibility.isCreatureVisible(creature)).toBe(false);
        player.longRangeScanners.length = 0;
        player.longRangeScanners.push(...saved);
        // FindShipOutsideSystemWithScanRange(x, y, 1.0): a ship in deep space within its scan range of the creature.
        creature.isVisible = true;
        scanner.currentSpeed = 0;
        scanner.xpos = 500;
        scanner.nearestSystemStar = null; // in deep space
        const gi = g.resolveIndex(500, 50);
        g.builtObjectIndexGrid[gi.x][gi.y].push(scanner);
        expect(player.visibility.isCreatureVisible(creature)).toBe(true);
    });
});
