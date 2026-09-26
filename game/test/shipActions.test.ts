// 17b — player orders: ShipAction (ShipAction.cs) + the Main.Part7.cs 45 method_347 dispatcher
// (src/sim/player/executeShipAction.ts), on the seed-1 harness game. Expectations are hand-worked from the C#.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { Habitat, HabitatCategoryType } from '../src/sim/types';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { ShipGroup, empireShipGroups } from '../src/sim/fleets/shipGroup';
import { ShipAction, ShipActionType, createMissionShipAction, createMissionShipActionAt, createShipAction } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';

let gameData: GameData;
let galaxy: Galaxy;
let player: Empire;

beforeEach(async () => {
    gameData ??= await loadGameDataFs();
    galaxy = cachedTickGame(gameData).galaxy;
    player = galaxy.playerEmpire!;
});

/** A mobile player ship that is not a base and is not being built. */
function playerShip(): BuiltObject {
    const ship = player.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0);
    expect(ship).toBeDefined();
    return ship!;
}

/** A second planet/moon in the galaxy (not a star), away from the ship. */
function someHabitat(): Habitat {
    const h = galaxy.habitats.find((x) => x.category === HabitatCategoryType.Planet && x !== player.capital);
    expect(h).toBeDefined();
    return h!;
}

describe('ShipAction.cs / Main.Part8.cs 1496-1536 factories', () => {
    it('method_313/314 build action and mission orders with an empty position', () => {
        const a = createShipAction(ShipActionType.AutomateShip, null);
        expect(a.actionType).toBe(ShipActionType.AutomateShip);
        expect(a.missionType).toBe(BuiltObjectMissionType.Undefined);
        expect(a.enabled).toBe(true);
        const m = createMissionShipAction(BuiltObjectMissionType.Hold);
        expect(m.missionType).toBe(BuiltObjectMissionType.Hold);
        expect(m.actionType).toBe(ShipActionType.Undefined);
        expect(m.position).toEqual({ x: 0, y: 0 });
        expect(m.target).toBeNull();
    });

    it('method_315 stores the click offset from a habitat, the click point with no target, and a system as its star', () => {
        const h = someHabitat();
        const a = createMissionShipActionAt(BuiltObjectMissionType.Move, h, Math.trunc(h.xpos) + 120, Math.trunc(h.ypos) - 40);
        expect(a.target).toBe(h);
        expect(a.position).toEqual({ x: 120, y: -40 });
        const b = createMissionShipActionAt(BuiltObjectMissionType.Move, null, 5000, 7000);
        expect(b.target).toBeNull();
        expect(b.position).toEqual({ x: 5000, y: 7000 });
        const sys = galaxy.systems[0];
        const c = createMissionShipActionAt(BuiltObjectMissionType.Patrol, sys, Math.trunc(sys.systemStar.xpos), Math.trunc(sys.systemStar.ypos));
        expect(c.target).toBe(sys.systemStar);
        expect(c.position).toEqual({ x: 0, y: 0 });
    });

    it('Clone copies mission, target, position, design, action type and the queue flag (not Target2)', () => {
        const a = ShipAction.forMission(BuiltObjectMissionType.Attack, 'x', 'y');
        a.actionType = ShipActionType.AssignAttack;
        a.isSubsequentAction = true;
        const c = a.clone();
        expect(c.missionType).toBe(BuiltObjectMissionType.Attack);
        expect(c.actionType).toBe(ShipActionType.AssignAttack);
        expect(c.target).toBe('x');
        expect(c.target2).toBeNull();
        expect(c.isSubsequentAction).toBe(true);
    });
});

describe('Main.Part7.cs 45 method_347 — ship orders', () => {
    it('Move to a habitat: AssignMission(Move, habitat, null, Normal, manuallyAssigned) and the ship is no longer automated (772-817)', () => {
        const ship = playerShip();
        const h = someHabitat();
        const action = createMissionShipActionAt(BuiltObjectMissionType.Move, h, Math.trunc(h.xpos), Math.trunc(h.ypos));
        const r = executeShipAction(galaxy, player, ship, action, true);
        expect(r.ok).toBe(true);
        const m = builtObjectMission(ship.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Move);
        expect(m.targetHabitat).toBe(h);
        expect(m.priority).toBe(BuiltObjectMissionPriority.Normal);
        expect(ship.isAutoControlled).toBe(false);
    });

    it('a shift-click (IsSubsequentAction) queues the Move instead of replacing the mission', () => {
        const ship = playerShip();
        const before = builtObjectMission(ship.mission);
        const h = someHabitat();
        const action = createMissionShipActionAt(BuiltObjectMissionType.Move, h, Math.trunc(h.xpos), Math.trunc(h.ypos));
        action.isSubsequentAction = true;
        const queued = ship.subsequentMissions.length;
        executeShipAction(galaxy, player, ship, action, true);
        expect(builtObjectMission(ship.mission)).toBe(before);
        expect(ship.subsequentMissions.length).toBe(queued + 1);
        const q = builtObjectMission(ship.subsequentMissions[queued])!;
        expect(q.type).toBe(BuiltObjectMissionType.Move);
        expect(q.priority).toBe(BuiltObjectMissionPriority.Normal);
        // ClearQueuedMissions (474-476)
        executeShipAction(galaxy, player, ship, createShipAction(ShipActionType.ClearQueuedMissions, ship), true);
        expect(ship.subsequentMissions.length).toBe(0);
    });

    it('UnautomateShip clears IsAutoControlled; AutomateShip sets it back (416-429, 514-516)', () => {
        const ship = playerShip();
        ship.isAutoControlled = true;
        expect(executeShipAction(galaxy, player, ship, createShipAction(ShipActionType.UnautomateShip, ship), true).ok).toBe(true);
        expect(ship.isAutoControlled).toBe(false);
        executeShipAction(galaxy, player, ship, createShipAction(ShipActionType.AutomateShip, ship), true);
        expect(ship.isAutoControlled).toBe(true);
    });
});

describe('Main.Part7.cs 45 method_347 — fleets', () => {
    function militaryShips(n: number): BuiltObject[] {
        const list = player.builtObjects.filter((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0).slice(0, n);
        expect(list.length).toBe(n);
        for (const s of list) {
            s.role = BuiltObjectRole.Military;
            s.subRole = BuiltObjectSubRole.Frigate;
        }
        return list;
    }

    it('CreateNewFleet (1573-1605) makes a named ShipGroup with the ship as lead, sorted into the empire and selected', () => {
        const [ship] = militaryShips(1);
        const groupsBefore = empireShipGroups(player).length;
        const r = executeShipAction(galaxy, player, [ship], createShipAction(ShipActionType.CreateNewFleet, null), true);
        expect(r.ok).toBe(true);
        const g = ship.shipGroup as ShipGroup;
        expect(g).toBeInstanceOf(ShipGroup);
        expect(g.leadShip).toBe(ship);
        expect(g.ships).toEqual([ship]);
        expect(g.empire).toBe(player);
        expect(g.name).toMatch(/ Fleet$/);
        expect(empireShipGroups(player).length).toBe(groupsBefore + 1);
        expect(empireShipGroups(player)).toContain(g);
        expect(r.select).toBe(g);
    });

    it('JoinShipGroup / LeaveShipGroup / DisbandShipGroup round-trip (430-473, 1255-1270)', () => {
        const [a, b] = militaryShips(2);
        executeShipAction(galaxy, player, [a], createShipAction(ShipActionType.CreateNewFleet, null), true);
        const g = a.shipGroup as ShipGroup;
        executeShipAction(galaxy, player, b, createShipAction(ShipActionType.JoinShipGroup, g), true);
        expect(b.shipGroup).toBe(g);
        expect(g.ships).toEqual([a, b]);
        executeShipAction(galaxy, player, b, createShipAction(ShipActionType.SetAsLeadShipInGroup, g), true);
        expect(g.leadShip).toBe(b);
        executeShipAction(galaxy, player, b, createShipAction(ShipActionType.LeaveShipGroup, g), true);
        expect(b.shipGroup).toBeNull();
        expect(g.ships).toEqual([a]);
        const r = executeShipAction(galaxy, player, g, createShipAction(ShipActionType.DisbandShipGroup, g), true);
        expect(r.ok).toBe(true);
        expect(r.select).toBeNull();
        expect(a.shipGroup).toBeNull();
        expect(g.ships.length).toBe(0);
        expect(empireShipGroups(player)).not.toContain(g);
    });

    it('JoinShipGroup with no target on a single ship forms a new fleet (439-458)', () => {
        const [a] = militaryShips(1);
        const r = executeShipAction(galaxy, player, a, createShipAction(ShipActionType.JoinShipGroup, null), true);
        const g = a.shipGroup as ShipGroup;
        expect(g.leadShip).toBe(a);
        expect(g.gatherPoint).toBeNull();
        expect(r.select).toBe(g);
    });

    it('SetFleetPosture toggles Attack/Defend and SetFleetRange steps through the five ranges (1277-1311)', () => {
        const [a] = militaryShips(1);
        executeShipAction(galaxy, player, [a], createShipAction(ShipActionType.CreateNewFleet, null), true);
        const g = a.shipGroup as ShipGroup;
        const p0 = g.posture;
        executeShipAction(galaxy, player, g, createShipAction(ShipActionType.SetFleetPosture, g), true);
        expect(g.posture).not.toBe(p0);
        executeShipAction(galaxy, player, g, createShipAction(ShipActionType.SetFleetPosture, g), true);
        expect(g.posture).toBe(p0);
        g.postureRangeSquared = 2250000.0;
        const seen: number[] = [];
        for (let i = 0; i < 5; i++) {
            executeShipAction(galaxy, player, g, createShipAction(ShipActionType.SetFleetRange, g), true);
            seen.push(g.postureRangeSquared);
        }
        expect(seen).toEqual([2304000000.0, 250000000000.0, 1000000000000.0, 3.4028234663852886e38, 2250000.0]);
    });
});

describe('Main.Part7.cs 45 method_347 — colonies', () => {
    it('ColonyTaxUp5 / Down5 change the tax by 0.05 as a float, clamped to [0, 0.5] (830-862)', () => {
        const colony = player.capital!;
        colony.taxRate = Math.fround(0.2);
        executeShipAction(galaxy, player, colony, createShipAction(ShipActionType.ColonyTaxUp5, colony), true);
        expect(colony.taxRate).toBe(Math.fround(Math.fround(0.2) + 0.05));
        colony.taxRate = Math.fround(0.48);
        executeShipAction(galaxy, player, colony, createShipAction(ShipActionType.ColonyTaxUp5, colony), true);
        expect(colony.taxRate).toBe(0.5);
        colony.taxRate = Math.fround(0.03);
        executeShipAction(galaxy, player, colony, createShipAction(ShipActionType.ColonyTaxDown5, colony), true);
        expect(colony.taxRate).toBe(0);
    });

    it('asks the Colony Tax Rates automation prompt when tax rates are automated, and turns automation off on "Off"', () => {
        const colony = player.capital!;
        player.controlColonyTaxRates = true;
        const r = executeShipAction(galaxy, player, colony, createShipAction(ShipActionType.ColonyTaxUp1, colony), true);
        expect(r.automationPrompts).toEqual(['Colony Tax Rates']);
        expect(player.controlColonyTaxRates).toBe(true);
        executeShipAction(galaxy, player, colony, createShipAction(ShipActionType.ColonyTaxUp1, colony), true, { automationPrompt: () => true });
        expect(player.controlColonyTaxRates).toBe(false);
    });

    it("a foreign colony's tax is not touched", () => {
        const foreign = galaxy.empires.find((e) => e !== player && e.capital !== null)!.capital!;
        const before = foreign.taxRate;
        executeShipAction(galaxy, player, foreign, createShipAction(ShipActionType.ColonyTaxUp5, foreign), true);
        expect(foreign.taxRate).toBe(before);
    });
});

describe('Main.Part7.cs 45 method_347 — invalid orders', () => {
    it('nothing selected: ok false with a message', () => {
        const r = executeShipAction(galaxy, player, null, createMissionShipAction(BuiltObjectMissionType.Move), true);
        expect(r.ok).toBe(false);
        expect(r.message).toBeTruthy();
    });

    it('CreateNewFleet from a selection without military ships: ok false, no fleet, ships untouched', () => {
        const ship = player.builtObjects.find((b) => b.role !== BuiltObjectRole.Military && b.role !== BuiltObjectRole.Base && b.builtAt === null)!;
        const groupsBefore = empireShipGroups(player).length;
        const missionBefore = ship.mission;
        const r = executeShipAction(galaxy, player, [ship], createShipAction(ShipActionType.CreateNewFleet, null), true);
        expect(r.ok).toBe(false);
        expect(r.message).toBeTruthy();
        expect(empireShipGroups(player).length).toBe(groupsBefore);
        expect(ship.shipGroup).toBeNull();
        expect(ship.mission).toBe(missionBefore);
    });

    it('sub-menu actions only ask the UI to open the menu', () => {
        const colony = player.capital!;
        const a = createShipAction(ShipActionType.ColonyBuildOptions, colony);
        const r = executeShipAction(galaxy, player, colony, a, true);
        expect(r.ok).toBe(true);
        expect(r.openSubMenu).toBe(a);
    });
});
