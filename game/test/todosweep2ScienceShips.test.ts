import { beforeAll, describe, expect, it } from 'vitest';
import { setGovernmentsStatic } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentType } from '../src/sim/data/components';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { baconSettings } from '../src/sim/data/baconSettings';
import { baconInitializeSettings } from '../src/sim/baconSettings';
import { PROCESS_EMPIRE_SCIENCE_SHIPS, getCurrentResearchNode, processScienceShipsOf, storeScientificData, tryRefillScientifiData } from '../src/sim/baconScienceShips';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/tick/simTime';
import type { TechNode } from '../src/sim/researchSystem';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

// Sweep 2: BaconEmpire.cs 170-275 ProcessScienceShips + BaconMain.cs 700-715 / BaconGalaxy.cs 322-329 scheduling.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

const LAB_TYPES = [ComponentType.LabsWeaponsLab, ComponentType.LabsEnergyLab, ComponentType.LabsHighTechLab];

/** The seed-1 start exploration ships carry no labs: turn two components of the first one into an energy and a high-tech lab. */
function labShip(empire: Empire): BuiltObject {
    const ship = empire.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ExplorationShip)!;
    const items = ship.components.items.filter((c) => c.status === ComponentStatus.Normal);
    Object.defineProperty(items[0], 'type', { value: ComponentType.LabsEnergyLab });
    Object.defineProperty(items[1], 'type', { value: ComponentType.LabsHighTechLab });
    return ship;
}

describe('ProcessEmpireScienceShips scheduling (BaconMain.cs 700-715)', () => {
    it('createGame queues one action Next(26, 35) days out; a second BaconInitialize adds none', () => {
        const game = cachedTickGame(gameData);
        expect(baconSettings.researchPerLab).toBe(1000); // BaconSettings.txt researchPerLab=1000
        const galaxy = game.galaxy;
        const queued = galaxy.delayedActions.filter((p) => p.action?.messageTitle === PROCESS_EMPIRE_SCIENCE_SHIPS);
        expect(queued.length).toBe(1);
        const day = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 360);
        const days = (queued[0].action!.executionDate - galaxyStarDate(galaxy)) / day;
        expect(Number.isInteger(days)).toBe(true);
        expect(days).toBeGreaterThanOrEqual(26);
        expect(days).toBeLessThanOrEqual(34);
        expect(queued[0].triggerEmpire).toBe(galaxy.playerEmpire);
        const before = galaxy.rnd.getState();
        baconInitializeSettings(galaxy, gameData.baconSettings);
        expect(galaxy.delayedActions.filter((p) => p.action?.messageTitle === PROCESS_EMPIRE_SCIENCE_SHIPS).length).toBe(1);
        const probe = galaxy.rnd.next(0, 1 << 30);
        galaxy.rnd.setState(before);
        expect(galaxy.rnd.next(0, 1 << 30)).toBe(probe); // no draw
    });
});

describe('BaconEmpire.ProcessScienceShips', () => {
    it('each working lab advances a random unresearched project of its industry by researchPerLab × (1 + ResearchBonus)', () => {
        const game = cachedTickGame(gameData);
        const galaxy = game.galaxy;
        const empire = game.playerEmpire;
        const ship = labShip(empire);
        expect(ship).toBeDefined();
        const labs = LAB_TYPES.map((t) => ship.components.items.some((c) => c.type === t && c.status === ComponentStatus.Normal));
        const labCount = labs.filter((x) => x).length;
        expect(labCount).toBeGreaterThan(0);
        ship.baconValues = new Map<string, unknown>([['scientificData', 50]]);
        processScienceShipsOf(galaxy, [empire]);
        expect(ship.baconValues.get('scientificData')).toBe(50 - labCount);
        for (let i = 0; i < 3; i++) {
            const node = getCurrentResearchNode(ship, i);
            if (!labs[i]) {
                expect(node).toBeNull();
                continue;
            }
            expect(node).not.toBeNull();
            expect(node!.progress).toBeGreaterThanOrEqual(Math.fround(1000 * Math.fround(1 + empire.researchBonus)) - 1e-3);
        }
        // Second run: the same nodes keep accruing (no new draw while unresearched).
        const nodes = [0, 1, 2].map((i) => getCurrentResearchNode(ship, i));
        const progress = nodes.map((n) => n?.progress ?? 0);
        processScienceShipsOf(galaxy, [empire]);
        nodes.forEach((n, i) => {
            if (n === null) return;
            expect(getCurrentResearchNode(ship, i)).toBe(n);
            expect(n.progress).toBe(Math.fround(progress[i] + Math.fround(1000 * Math.fround(1 + empire.researchBonus))));
        });
    });

    it('a ship with BaconValues but no scientificData / lab keys throws KeyNotFound: the rest of the list is skipped', () => {
        const game = cachedTickGame(gameData);
        const galaxy = game.galaxy;
        const empire = game.playerEmpire;
        const ships = empire.builtObjects.filter((b) => b.subRole === BuiltObjectSubRole.ExplorationShip);
        expect(ships.length).toBeGreaterThan(0);
        ships[0].baconValues = new Map<string, unknown>([['other', 1]]);
        for (const s of ships.slice(1)) s.baconValues = new Map<string, unknown>([['scientificData', 10]]);
        expect(() => processScienceShipsOf(galaxy, [empire])).not.toThrow();
        for (const s of ships.slice(1)) expect(s.baconValues!.get('scientificData')).toBe(10);
    });

    it('Store / TryRefill move scientific data between the ship and the capital (BaconEmpire.cs 1342 / 1373)', () => {
        const game = cachedTickGame(gameData);
        const empire = game.playerEmpire;
        const ship = empire.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ExplorationShip)!;
        const capital = empire.capital!;
        capital.baconValues = null;
        ship.baconValues = new Map<string, unknown>([['scientificData', 130]]);
        storeScientificData(ship);
        expect(ship.baconValues.get('scientificData')).toBe(100);
        expect(capital.baconValues!.get('scientificData')).toBe(30);
        ship.baconValues.set('scientificData', 1);
        tryRefillScientifiData(ship);
        expect(ship.baconValues.get('scientificData')).toBe(31);
        expect(capital.baconValues!.get('scientificData')).toBe(0);
    });

    it('completing a project sets IsResearched and sends a ResearchBreakthrough message', () => {
        const game = cachedTickGame(gameData);
        const galaxy = game.galaxy;
        const empire = game.playerEmpire;
        const ship = labShip(empire);
        const labIndex = LAB_TYPES.findIndex((t) => ship.components.items.some((c) => c.type === t && c.status === ComponentStatus.Normal));
        ship.baconValues = new Map<string, unknown>([['scientificData', 5]]);
        processScienceShipsOf(galaxy, [empire]);
        const node = getCurrentResearchNode(ship, labIndex) as TechNode;
        node.progress = Math.fround(node.cost - 1);
        const messages = empire.messages.length;
        processScienceShipsOf(galaxy, [empire]);
        expect(node.isResearched).toBe(true);
        expect(empire.messages.length).toBeGreaterThan(messages);
    });
});
