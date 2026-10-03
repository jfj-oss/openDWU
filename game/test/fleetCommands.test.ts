// Ships and Bases "Set Fleet" and every fleet-panel setting, issued as player commands: queued, applied only at the
// frame boundary (flushPlayerCommands), journaled (src/sim/player/fleetOps.ts, playerOps.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { flushPlayerCommands, issuePlayerCommand, pendingPlayerCommands } from '../src/sim/player/playerCommands';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { empireShipGroups, type ShipGroup } from '../src/sim/fleets/shipGroup';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { fleetShipAction, fleetAutomated } from '../src/ui/screens/fleetsList';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { GalaxyTime } from '../src/sim/galaxyTime';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function fresh(): { game: Game; mil: BuiltObject[] } {
    const game = cachedTickGame(gameData);
    const mil = game.playerEmpire.builtObjects.filter((b) => b !== null && b.role === BuiltObjectRole.Military);
    return { game, mil };
}
function apply(game: Game, op: Parameters<typeof issuePlayerCommand>[2], args: unknown[]): void {
    issuePlayerCommand(game.galaxy, game.playerEmpire, op, args as never);
    expect(pendingPlayerCommands(game.galaxy)).toBe(1); // nothing happens before the boundary
    flushPlayerCommands(game.galaxy);
    expect(pendingPlayerCommands(game.galaxy)).toBe(0);
}
function newFleet(game: Game, ships: BuiltObject[]): ShipGroup {
    apply(game, 'setShipsFleet', [ships, 'new']);
    const fleets = empireShipGroups(game.playerEmpire).filter((g): g is ShipGroup => g !== null);
    return fleets[fleets.length - 1];
}

describe('form fleet from the selected ships (cmbBuiltObjectSetFleet)', () => {
    it('New Fleet: created at the frame boundary, Military ships only, named "Nth Fleet", no home base', () => {
        const { game, mil } = fresh();
        const p = game.playerEmpire;
        const freighter = p.builtObjects.find((b) => b !== null && b.role !== BuiltObjectRole.Military && b.topSpeed > 0)!;
        const picked = [mil[0], mil[1], mil[2], freighter];
        const before = empireShipGroups(p).length;
        issuePlayerCommand(game.galaxy, p, 'setShipsFleet', [picked, 'new']);
        expect(empireShipGroups(p).length).toBe(before); // still queued
        expect(mil[0].shipGroup).toBeNull();
        flushPlayerCommands(game.galaxy);
        const fleets = empireShipGroups(p);
        expect(fleets.length).toBe(before + 1);
        const fleet = fleets[fleets.length - 1]!;
        expect(fleet.name).toBe('1st Fleet');
        expect(fleet.gatherPoint).toBeNull();
        expect(fleet.ships).toHaveLength(3);
        for (const m of [mil[0], mil[1], mil[2]]) expect(m.shipGroup).toBe(fleet);
        expect(freighter.shipGroup).toBeNull();
        const entry = commandLog(game.galaxy).find((e) => e.source === 'player' && (e as PlayerLogEntry).op === 'setShipsFleet') as PlayerLogEntry;
        expect(entry).toBeDefined();
        expect(entry.error).toBeUndefined();
    });

    it('joining an existing fleet moves the ships in; None takes them out', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        apply(game, 'setShipsFleet', [[mil[2], mil[3], mil[0]], fleet]);
        expect(fleet.ships).toHaveLength(4);
        expect(mil[3].shipGroup).toBe(fleet);
        apply(game, 'setShipsFleet', [[mil[2], mil[3]], null]);
        expect(mil[2].shipGroup).toBeNull();
        expect(mil[3].shipGroup).toBeNull();
        expect(fleet.ships).toHaveLength(2);
    });
});

describe('fleet panel settings', () => {
    it('rename (a blank name is ignored)', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        apply(game, 'renameFleet', [fleet, 'Wolf Pack']);
        expect(fleet.name).toBe('Wolf Pack');
        apply(game, 'renameFleet', [fleet, '   ']);
        expect(fleet.name).toBe('Wolf Pack');
    });

    it('home colony', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        const colony = game.playerEmpire.colonies[0];
        apply(game, 'setFleetHomeColony', [fleet, colony]);
        expect(fleet.gatherPoint).toBe(colony);
    });

    it('home base and attack point pick (map click), and clear', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        const colony = game.playerEmpire.colonies[0];
        apply(game, 'fleetPoint', [fleet, 'SetFleetHomeBase', colony]);
        expect(fleet.gatherPoint).toBe(colony);
        apply(game, 'fleetPoint', [fleet, 'SetFleetHomeBase', null]);
        expect(fleet.gatherPoint).toBeNull();
        const enemy = game.galaxy.empires.find((e) => e !== game.playerEmpire && e.colonies.length > 0)!;
        apply(game, 'fleetPoint', [fleet, 'SetFleetAttackPoint', enemy.colonies[0]]);
        expect(fleet.attackPoint).toBe(enemy.colonies[0]);
        apply(game, 'fleetPoint', [fleet, 'SetFleetAttackPoint', null]);
        expect(fleet.attackPoint).toBeNull();
    });

    it('posture toggles Attack <-> Defend', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        expect(fleet.posture).toBe(FleetPosture.Attack);
        apply(game, 'shipAction', [fleet, fleetShipAction('posture', fleet), false]);
        expect(fleet.posture).toBe(FleetPosture.Defend);
        apply(game, 'shipAction', [fleet, fleetShipAction('posture', fleet), false]);
        expect(fleet.posture).toBe(FleetPosture.Attack);
    });

    it('range cycles point -> system -> nearby -> sector -> any -> point', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        fleet.postureRangeSquared = 2250000.0;
        const seen: number[] = [];
        for (let i = 0; i < 5; i++) {
            apply(game, 'shipAction', [fleet, fleetShipAction('range', fleet), false]);
            seen.push(fleet.postureRangeSquared);
        }
        expect(seen).toEqual([2304000000.0, 250000000000.0, 1000000000000.0, 3.4028234663852886e38, 2250000.0]);
    });

    it('automation on / off', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        apply(game, 'shipAction', [fleet, fleetShipAction('unautomate', fleet), false]);
        expect(fleetAutomated(fleet)).toBe(false);
        expect(fleet.ships.every((s) => !s.isAutoControlled)).toBe(true);
        apply(game, 'shipAction', [fleet, fleetShipAction('automate', fleet), false]);
        expect(fleetAutomated(fleet)).toBe(true);
    });

    it('troop loadouts: on (100% infantry), spinner values, off (255)', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        apply(game, 'setFleetTroopLoadout', [fleet, { infantry: 100, armored: 0, artillery: 0, specialForces: 0 }]);
        expect(fleet.troopLoadoutInfantry).toBe(100);
        apply(game, 'setFleetTroopLoadout', [fleet, { infantry: 40, armored: 30, artillery: 20, specialForces: 10 }]);
        expect([fleet.troopLoadoutInfantry, fleet.troopLoadoutArmored, fleet.troopLoadoutArtillery, fleet.troopLoadoutSpecialForces]).toEqual([40, 30, 20, 10]);
        apply(game, 'setFleetTroopLoadout', [fleet, { infantry: 60, armored: 60, artillery: 0, specialForces: 0 }]); // over 100%: refused
        expect(fleet.troopLoadoutInfantry).toBe(40);
        apply(game, 'setFleetTroopLoadout', [fleet, null]);
        expect([fleet.troopLoadoutInfantry, fleet.troopLoadoutArmored, fleet.troopLoadoutArtillery, fleet.troopLoadoutSpecialForces]).toEqual([255, 255, 255, 255]);
    });

    it('stop (Hold) and Repair and Refuel give the fleet a mission; retrofit and load troops run', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        apply(game, 'fleetRepairAndRefuel', [fleet]);
        const m = builtObjectMission(fleet.mission);
        if (m !== null) expect([BuiltObjectMissionType.Refuel, BuiltObjectMissionType.Repair]).toContain(m.type);
        apply(game, 'shipAction', [fleet, fleetShipAction('stop', fleet), false]);
        apply(game, 'fleetRetrofit', [fleet]);
        apply(game, 'fleetLoadTroops', [fleet]);
        expect(empireShipGroups(game.playerEmpire)).toContain(fleet);
    });

    it('disband removes the fleet and frees its ships', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        apply(game, 'shipAction', [fleet, fleetShipAction('disband', fleet), false]);
        expect(empireShipGroups(game.playerEmpire)).not.toContain(fleet);
        expect(mil[0].shipGroup).toBeNull();
    });

    it('a command for another empire\'s fleet is refused', () => {
        const { game, mil } = fresh();
        const fleet = newFleet(game, [mil[0], mil[1]]);
        const other = game.galaxy.empires.find((e) => e !== game.playerEmpire)!;
        issuePlayerCommand(game.galaxy, other, 'setFleetTroopLoadout', [fleet, null]);
        flushPlayerCommands(game.galaxy);
        expect(fleet.troopLoadoutInfantry).not.toBe(255);
    });
});

describe('selected-ship buttons (Refuel / Repair / Retire)', () => {
    it('Retire sends each mobile ship to a yard with a Retire mission', () => {
        const { game, mil } = fresh();
        apply(game, 'retireShips', [[mil[0]]]);
        const m = builtObjectMission(mil[0].mission);
        expect(m).not.toBeNull();
        expect(m!.type).toBe(BuiltObjectMissionType.Retire);
    });

    it('Refuel and Repair run without touching an undamaged, unfuelled-need ship wrongly', () => {
        const { game, mil } = fresh();
        apply(game, 'repairShips', [[mil[1]]]);
        expect(mil[1].damagedComponentCount).toBe(0);
        apply(game, 'refuelShips', [[mil[1]]]);
        const m = builtObjectMission(mil[1].mission);
        if (m !== null) expect(m.type).toBe(BuiltObjectMissionType.Refuel);
        expect(mil[1].subRole).not.toBe(BuiltObjectSubRole.Undefined);
    });
});

describe('Retrofit Stance combo (Main.Part11.cs mUwHhIdjxs)', () => {
    it('sets SuppressAutoRetrofit on a single own ship, journaled; ignores multi-selection, private sub-roles and foreign ships', () => {
        const { game, mil } = fresh();
        const p = game.playerEmpire;
        const s = mil[0];
        expect(s.suppressAutoRetrofit).toBe(false);
        apply(game, 'setShipRetrofitStance', [[s], false]);
        expect(s.suppressAutoRetrofit).toBe(true);
        expect(commandLog(game.galaxy).some((e) => e.source === 'player' && (e as PlayerLogEntry).op === 'setShipRetrofitStance')).toBe(true);
        apply(game, 'setShipRetrofitStance', [[mil[1], mil[2]], false]); // original: Count == 1 only
        expect(mil[1].suppressAutoRetrofit).toBe(false);
        expect(mil[2].suppressAutoRetrofit).toBe(false);
        apply(game, 'setShipRetrofitStance', [[s], true]);
        expect(s.suppressAutoRetrofit).toBe(false);
        const freighter = mil[3];
        freighter.subRole = BuiltObjectSubRole.SmallFreighter; // a private sub-role: the combo is disabled
        apply(game, 'setShipRetrofitStance', [[freighter], false]);
        expect(freighter.suppressAutoRetrofit).toBe(false);
        const other = game.galaxy.empires.find((e) => e !== p && e.builtObjects.some((b) => b !== null && b.role === BuiltObjectRole.Military))!;
        const foreign = other.builtObjects.find((b) => b !== null && b.role === BuiltObjectRole.Military)!;
        apply(game, 'setShipRetrofitStance', [[foreign], false]);
        expect(foreign.suppressAutoRetrofit).toBe(false);
    });

    it('the stance survives save / load', () => {
        const { game, mil } = fresh();
        apply(game, 'setShipRetrofitStance', [[mil[0]], false]);
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        const loaded = deserializeGame(serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1 }), gameData).game;
        const ships = loaded.playerEmpire.builtObjects.filter((b) => b !== null && b.role === BuiltObjectRole.Military);
        expect(ships[0].suppressAutoRetrofit).toBe(true);
        expect(ships[1].suppressAutoRetrofit).toBe(false);
    });
});
