// User deviation from DW:U: a manual order (move / attack / patrol / ...) no longer clears IsAutoControlled — only
// the explicit Automate / Unautomate toggle changes it. The order's missions are marked `playerOrdered`
// (src/sim/missions/playerOrder.ts); while one is the ship's (or its fleet's) unfinished mission the ship counts as
// manually controlled (isAiControlled false), so the empire AI leaves it alone; once it completes, automation resumes.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission, type BuiltObjectMission } from '../src/sim/missions/mission';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { ShipActionType, createMissionShipActionAt, createShipAction } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { hasActivePlayerOrder, isAiControlled } from '../src/sim/missions/playerOrder';
import { runGameSeconds } from '../src/sim/tick/harness';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function explorer(game: Game): BuiltObject {
    const ship = game.playerEmpire.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ExplorationShip && b.builtAt === null && b.topSpeed > 0);
    expect(ship).toBeDefined();
    expect(ship!.isAutoControlled).toBe(true);
    return ship!;
}

/** A point `d` units from the ship, clamped into the galaxy. */
function pointAway(game: Game, ship: BuiltObject, d: number): { x: number; y: number } {
    const g = game.galaxy;
    const x = ship.xpos + d < g.sizeX - 1000 ? ship.xpos + d : ship.xpos - d;
    return { x: Math.trunc(x), y: Math.trunc(ship.ypos) };
}

function missionOf(ship: BuiltObject): BuiltObjectMission | null {
    return builtObjectMission(ship.mission);
}

describe('manual orders keep IsAutoControlled; the AI leaves the order alone until it is done', () => {
    it('an automated explorer ordered to move stays automated, flies the Move without being retasked, then explores again', () => {
        const game = cachedTickGame(gameData);
        const ship = explorer(game);
        expect(missionOf(ship)?.type).toBe(BuiltObjectMissionType.Explore); // the AI's own work
        const p = pointAway(game, ship, 40000);
        const r = executeShipAction(game.galaxy, game.playerEmpire, ship, createMissionShipActionAt(BuiltObjectMissionType.Move, null, p.x, p.y), true);
        expect(r.ok).toBe(true);
        // (1) the order leaves automation on
        expect(ship.isAutoControlled).toBe(true);
        const order = missionOf(ship)!;
        expect(order.type).toBe(BuiltObjectMissionType.Move);
        expect(order.playerOrdered).toBe(true);
        expect(hasActivePlayerOrder(ship)).toBe(true);
        expect(isAiControlled(ship)).toBe(false);
        // (2) the ship carries the order out across many AI ticks: the mission stays the player's Move until it is done
        const startDist = Math.hypot(ship.xpos - p.x, ship.ypos - p.y);
        let seconds = 0;
        while (seconds < 240 && missionOf(ship) === order && order.type === BuiltObjectMissionType.Move) {
            runGameSeconds(game, 1);
            seconds++;
            expect(ship.isAutoControlled).toBe(true);
            const m = missionOf(ship);
            if (m !== order) break;
        }
        expect(seconds).toBeGreaterThan(3); // several AI passes ran while the order was in progress
        const endDist = Math.hypot(ship.xpos - p.x, ship.ypos - p.y);
        expect(endDist).toBeLessThan(Math.min(2000, startDist)); // it got there (the Move was not replaced en route)
        // (3) done: automation resumes and the AI gives the explorer work again
        let t = 0;
        while (t < 120 && !(isAiControlled(ship) && (missionOf(ship)?.type ?? BuiltObjectMissionType.Undefined) !== BuiltObjectMissionType.Undefined)) {
            runGameSeconds(game, 1);
            t++;
        }
        expect(ship.isAutoControlled).toBe(true);
        expect(hasActivePlayerOrder(ship)).toBe(false);
        const next = missionOf(ship)!;
        expect(next.type).not.toBe(BuiltObjectMissionType.Undefined);
        expect(next.playerOrdered).toBeUndefined();
    }, 300000);

    it('a queued (shift) order is a player order too; the flag survives save / load', () => {
        const game = cachedTickGame(gameData);
        const ship = explorer(game);
        const p = pointAway(game, ship, 40000);
        const move = createMissionShipActionAt(BuiltObjectMissionType.Move, null, p.x, p.y);
        executeShipAction(game.galaxy, game.playerEmpire, ship, move, true);
        const q = createMissionShipActionAt(BuiltObjectMissionType.Move, null, p.x, p.y + 5000);
        q.isSubsequentAction = true;
        executeShipAction(game.galaxy, game.playerEmpire, ship, q, true);
        const queued = ship.subsequentMissions[ship.subsequentMissions.length - 1] as BuiltObjectMission;
        expect(queued.playerOrdered).toBe(true);
        expect(ship.isAutoControlled).toBe(true);
        // save / load round trip keeps the marks
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        const text = serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1 });
        const loaded = deserializeGame(text, gameData).game;
        const ship2 = loaded.playerEmpire.builtObjects.find((b) => b.name === ship.name)!;
        expect(missionOf(ship2)!.playerOrdered).toBe(true);
        expect((ship2.subsequentMissions[ship2.subsequentMissions.length - 1] as BuiltObjectMission).playerOrdered).toBe(true);
        expect(ship2.isAutoControlled).toBe(true);
        expect(isAiControlled(ship2)).toBe(false);
        // a mission the AI assigns never carries the mark (AI empires never see it)
        for (const e of loaded.galaxy.empires) {
            if (e === loaded.playerEmpire) continue;
            for (const b of e.builtObjects) expect(missionOf(b)?.playerOrdered).toBeUndefined();
        }
    }, 300000);

    it('an automated fleet ordered to move stays automated and keeps the order until it completes', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        const ships = p.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0 && b.shipGroup === null).slice(0, 2);
        expect(ships.length).toBe(2);
        const create = createShipAction(ShipActionType.CreateNewFleet, null);
        const r0 = executeShipAction(game.galaxy, p, ships, create, true);
        const fleet = r0.select as ShipGroup;
        expect(fleet).toBeInstanceOf(ShipGroup);
        for (const s of fleet.ships) expect(s.isAutoControlled).toBe(true);
        const lead = fleet.leadShip!;
        const dest = pointAway(game, lead, 40000);
        executeShipAction(game.galaxy, p, fleet, createMissionShipActionAt(BuiltObjectMissionType.Move, null, dest.x, dest.y), true);
        // (1)
        for (const s of fleet.ships) expect(s.isAutoControlled).toBe(true);
        const order = fleet.mission!;
        expect(order.type).toBe(BuiltObjectMissionType.Move);
        expect(order.playerOrdered).toBe(true);
        for (const s of fleet.ships) expect(isAiControlled(s)).toBe(false);
        // (2) the fleet mission stays the player's Move across the AI passes until it is done
        let seconds = 0;
        while (seconds < 240 && fleet.mission === order && order.type === BuiltObjectMissionType.Move) {
            runGameSeconds(game, 1);
            seconds++;
            for (const s of fleet.ships) expect(s.isAutoControlled).toBe(true);
        }
        expect(seconds).toBeGreaterThan(3);
        const lead2 = fleet.leadShip!;
        expect(Math.hypot(lead2.xpos - dest.x, lead2.ypos - dest.y)).toBeLessThan(3000);
        // (3) done: the fleet is back under automation
        // (the ships finish their own legs of the fleet Move a moment after the fleet mission completes)
        let t = 0;
        while (t < 60 && fleet.ships.some((s) => hasActivePlayerOrder(s))) {
            runGameSeconds(game, 1);
            t++;
        }
        for (const s of fleet.ships) {
            expect(s.isAutoControlled).toBe(true);
            expect(hasActivePlayerOrder(s)).toBe(false);
            expect(isAiControlled(s)).toBe(true);
        }
    }, 300000);

    it('(4) the explicit Unautomate / Automate toggle still changes IsAutoControlled, for a ship and a fleet', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        const ship = explorer(game);
        executeShipAction(game.galaxy, p, ship, createShipAction(ShipActionType.UnautomateShip, ship), true);
        expect(ship.isAutoControlled).toBe(false);
        expect(isAiControlled(ship)).toBe(false);
        // a manual order on an unautomated ship leaves it unautomated
        const dest = pointAway(game, ship, 20000);
        executeShipAction(game.galaxy, p, ship, createMissionShipActionAt(BuiltObjectMissionType.Move, null, dest.x, dest.y), true);
        expect(ship.isAutoControlled).toBe(false);
        executeShipAction(game.galaxy, p, ship, createShipAction(ShipActionType.AutomateShip, ship), true);
        expect(ship.isAutoControlled).toBe(true);
        // AutomateShip hands the ship straight back to the AI (its new mission is the AI's, not a player order)
        expect(missionOf(ship)?.playerOrdered).toBeUndefined();

        const ships = p.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.builtAt === null && b.topSpeed > 0 && b.shipGroup === null).slice(0, 2);
        const fleet = executeShipAction(game.galaxy, p, ships, createShipAction(ShipActionType.CreateNewFleet, null), true).select as ShipGroup;
        executeShipAction(game.galaxy, p, fleet, createShipAction(ShipActionType.UnautomateShip, fleet), true);
        for (const s of fleet.ships) expect(s.isAutoControlled).toBe(false);
        executeShipAction(game.galaxy, p, fleet, createShipAction(ShipActionType.AutomateShip, fleet), true);
        for (const s of fleet.ships) expect(s.isAutoControlled).toBe(true);
    }, 300000);
});
