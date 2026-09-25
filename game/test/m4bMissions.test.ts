// M4b — missions & command dispatcher: Command / BuiltObjectMission model (Command.cs, BuiltObjectMission.cs),
// ResolveCommandsForMission (BaconBuiltObjectMission.cs), AssignMission / ClearPreviousMissionRequirements
// (BuiltObject.2.cs 7620 / BuiltObject.1.cs 1361), the ExecuteCommands frame + M4b cases (BuiltObject.2.cs 399-4579),
// distress signals (Empire.3.cs 4898-5020, Empire.2.cs 3985, Empire.8.cs 4357) and a harness smoke test.
// Expectations are hand-worked from the C# listed above each block.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { Cargo, CargoList, ResourceRef } from '../src/sim/cargo';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { resetTodoCounts, todoHits } from '../src/sim/tick/todo';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { builtObjectDoTasks } from '../src/sim/tick/builtObjectTick';
import {
    BuiltObjectMission,
    BuiltObjectMissionPriority,
    BuiltObjectMissionType,
    COMMAND_COORD_UNSET,
    Command,
    CommandAction,
    MISSION_COORD_UNSET,
    builtObjectMission,
} from '../src/sim/missions/mission';
import { PATROL_ORBIT_DISTANCE, resolveCommandsForMission } from '../src/sim/missions/resolveCommands';
import { assignMission, clearPreviousMissionRequirements, recordRevertMission } from '../src/sim/missions/assign';
import { cmdClearAttackers, cmdClearParent, cmdDeploy, cmdEvaluateThreats, cmdHold, cmdRepeatSubsequentCommands, cmdSetParent, commandHandler, executeCommands, type CommandContext } from '../src/sim/missions/executeCommands';
import { DeclinedTask, DistressSignal, DistressSignalType, clearExpiredDeclinedTasks, clearOldDistressSignals, clearOutOldDistressSignals, empireDistressSignals, processDistressSignals } from '../src/sim/missions/distress';
import type { GameData } from '../src/sim/data/gameData';
import { determineDefendingStrength } from '../src/sim/combat/threats';

let gameData: GameData;
let galaxy: Galaxy;
let empire: Empire;
let ship: BuiltObject;
let planet: Habitat;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
    empire = galaxy.empires[1];
    ship = empire.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.empire === empire && b.warpSpeed > 0)!;
    // M4f: Start.2.cs 1373 AssignMissionsToBuiltObjectList gives the ship a game-start mission (parent cleared); these
    // tests want a fresh, parked ship.
    ship.mission = null;
    ship.revertMission = null;
    ship.parentHabitat = empire.capital;
    planet = galaxy.habitats.find((h) => h.category === HabitatCategoryType.Planet)!;
}, 180000);

const actions = (cmds: Command[]): CommandAction[] => cmds.map((c) => c.action);
const A = CommandAction;

describe('Command.cs', () => {
    it('Command(action): coordinates unset (-2.00000013E+09f), StarDate -1, no targets', () => {
        const c = new Command(A.MoveTo);
        expect(c.action).toBe(A.MoveTo);
        expect(c.xpos).toBe(COMMAND_COORD_UNSET);
        expect(COMMAND_COORD_UNSET).toBe(Math.fround(-2000000130)); // the float the C# literal denotes
        expect(c.xpos > -2e9).toBe(false);
        expect(c.starDate).toBe(-1);
        expect(c.targetBuiltObject).toBeNull();
        expect(c.targetShipGroup).toBeNull();
    });

    it('Command(action, x, y) keeps values above -2000000001 and stores them as float32', () => {
        const c = Command.at(A.HyperTo, 123456.7, -2000000001.0);
        expect(c.xpos).toBe(Math.fround(123456.7));
        expect(c.ypos).toBe(COMMAND_COORD_UNSET);
    });

    it('TargetRelativeXpos setter maps <= -2000000000 to the unset sentinel', () => {
        const c = new Command(A.MoveTo);
        c.targetRelativeXpos = -3e9;
        c.targetRelativeYpos = 12.5;
        expect(c.targetRelativeXpos).toBe(COMMAND_COORD_UNSET);
        expect(c.targetRelativeYpos).toBe(12.5);
    });

    it('target setters are exclusive (stellar object vs ship group) and Clone shares references', () => {
        const c = Command.forTarget(A.Dock, planet);
        expect(c.targetHabitat).toBe(planet);
        expect(c.targetBuiltObject).toBeNull();
        c.targetBuiltObject = ship;
        expect(c.targetHabitat).toBeNull();
        expect(c.targetBuiltObject).toBe(ship);
        const d = c.clone();
        expect(d).not.toBe(c);
        expect(d.action).toBe(A.Dock);
        expect(d.targetBuiltObject).toBe(ship);
        expect(d.starDate).toBe(-1);
    });
});

describe('BuiltObjectMission.cs', () => {
    it('Hold mission: one Hold command carrying the mission StarDate; ship parent cleared (531-537)', () => {
        ship.parentHabitat = planet;
        ship.parentOffsetX = 5;
        const m = new BuiltObjectMission(galaxy, ship, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.Normal, { starDate: 777 });
        expect(m.type).toBe(BuiltObjectMissionType.Hold);
        expect(actions(m.showAllCommands())).toEqual([A.Hold]);
        expect(m.fastPeekCurrentCommand()!.starDate).toBe(777);
        expect(m.x).toBe(MISSION_COORD_UNSET);
        expect(ship.parentHabitat).toBeNull();
        expect(ship.parentOffsetX).toBe(-2000000001.0);
        expect(m.repeatCommands).toBe(false);
    });

    it('CompleteCommand: dequeues, re-enqueues with RepeatCommands, sets PreviousType/Undefined when empty', () => {
        const m = new BuiltObjectMission(galaxy, ship, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.Normal, { starDate: 1 });
        m.addCommandToEnd(new Command(A.ScanArea));
        m.repeatCommands = true;
        m.completeCommand();
        expect(actions(m.showAllCommands())).toEqual([A.ScanArea, A.Hold]);
        expect(m.type).toBe(BuiltObjectMissionType.Hold);
        m.repeatCommands = false;
        expect(m.completeCommandIfMatchesAction(A.Hold)).toBe(false);
        expect(m.completeCommandIfMatchesAction(A.ScanArea)).toBe(true);
        m.completeCommand(true);
        expect(m.showAllCommands()).toEqual([]);
        expect(m.type).toBe(BuiltObjectMissionType.Undefined);
        expect(m.previousType).toBe(BuiltObjectMissionType.Hold);
    });

    it('query helpers: CheckCommandsForAction(maxSteps), GetNextDockCommand returns the first Undock, hyperjump checks', () => {
        const m = new BuiltObjectMission(galaxy, ship, BuiltObjectMissionType.Refuel, planet, null, BuiltObjectMissionPriority.Normal, { allowBuiltObjectChanges: false });
        // 999-1009: ClearParent, ConditionalHyperTo, SetParent, MoveTo, Dock, Refuel, Undock, SetParent, park(MoveTo)
        expect(actions(m.showAllCommands())).toEqual([A.ClearParent, A.ConditionalHyperTo, A.SetParent, A.MoveTo, A.Dock, A.Refuel, A.Undock, A.SetParent, A.MoveTo]);
        expect(m.checkCommandsForAction(A.Dock, 4)).toBe(false);
        expect(m.checkCommandsForAction(A.Dock, 5)).toBe(true);
        expect(m.checkCommandsForAction(A.Attack)).toBe(false);
        expect(m.getNextDockCommand()!.action).toBe(A.Undock);
        expect(m.checkCommandsForUndock()).toBe(true);
        expect(m.checkCommandsForHyperjump()).toBe(false);
        expect(m.checkCommandsForHyperjumpOrConditionalJump()).toBe(true);
        expect(m.showNextCommand()!.action).toBe(A.ConditionalHyperTo);
        expect(m.checkCommandsPastPrimaryTarget(ship)).toBe(true);
        expect(m.resolveTargetCoordinates(m)).toEqual({ x: Math.trunc(planet.xpos), y: Math.trunc(planet.ypos) });
        expect(m.resolveMissionTargetHabitatIfPossible()).toBe(planet);
        expect(BuiltObjectMission.resolveMissionTargetEmpire(m)).toBe(planet.empire);
    });

    it('EnsureCoordsInGalaxy clamps to [0, Size-1] and the Point is truncated', () => {
        const m = new BuiltObjectMission(galaxy, ship, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, { x: -50.7, y: galaxy.sizeY + 10, allowBuiltObjectChanges: false });
        // 1180-1183: ClearParent, ConditionalHyperTo(point), MoveTo(point) with point = ((int)0, (int)(SizeY - 1))
        expect(actions(m.showAllCommands())).toEqual([A.ClearParent, A.ConditionalHyperTo, A.MoveTo]);
        expect(m.showAllCommands()[1].xpos).toBe(0);
        expect(m.showAllCommands()[1].ypos).toBe(Math.fround(galaxy.sizeY - 1));
    });

    it('Clear resets everything and unresolvable missions come out cleared (522-530)', () => {
        ship.parentHabitat = planet;
        // Retrofit without a design and not a fleet mission: couldResolveCommands = false (850-857).
        const m = new BuiltObjectMission(galaxy, ship, BuiltObjectMissionType.Retrofit, planet, null, BuiltObjectMissionPriority.High);
        expect(m.type).toBe(BuiltObjectMissionType.Undefined);
        expect(m.priority).toBe(BuiltObjectMissionPriority.Undefined);
        expect(m.showAllCommands()).toEqual([]);
        expect(m.targetHabitat).toBeNull();
        expect(m.troops!.count).toBe(0);
        expect(ship.parentHabitat).toBeNull(); // ClearPreviousMissionRequirements ran
        // Waypoint without target and without positive coordinates (892-899).
        const w = new BuiltObjectMission(galaxy, ship, BuiltObjectMissionType.Waypoint, null, null, BuiltObjectMissionPriority.Normal, { allowBuiltObjectChanges: false });
        expect(w.type).toBe(BuiltObjectMissionType.Undefined);
    });
});

describe('BaconBuiltObjectMission.ResolveCommandsForMission', () => {
    const resolve = (type: BuiltObjectMissionType, target: Habitat | BuiltObject | null, target2: Habitat | BuiltObject | null = null, extra = {}) => {
        const before = galaxy.rnd.drawCount;
        const m = new BuiltObjectMission(galaxy, ship, type, target, target2, BuiltObjectMissionPriority.Normal, { allowBuiltObjectChanges: false, ...extra });
        return { m, cmds: m.showAllCommands(), draws: galaxy.rnd.drawCount - before };
    };

    it('Explore a planet (231-254): no Rnd, SetParent + ScanArea + ReassignMission', () => {
        const { cmds, draws } = resolve(BuiltObjectMissionType.Explore, planet);
        expect(actions(cmds)).toEqual([A.ClearParent, A.ConditionalHyperTo, A.SetParent, A.MoveTo, A.ScanArea, A.ClearParent, A.ReassignMission]);
        expect(cmds[1].targetHabitat).toBe(planet);
        expect(draws).toBe(0);
    });

    it('Explore a black hole (236-244): 2 Rnd draws, a point 0.7·diameter … +500 from the hole', () => {
        const hole = galaxy.habitats.find((h) => h.type === HabitatType.BlackHole);
        if (hole === undefined) return; // no black hole in this galaxy
        const { cmds, draws } = resolve(BuiltObjectMissionType.Explore, hole);
        expect(draws).toBe(2);
        expect(actions(cmds)).toEqual([A.ClearParent, A.ConditionalHyperTo, A.MoveTo, A.ScanArea, A.ClearParent, A.ReassignMission]);
        const d = Math.hypot(cmds[1].xpos - hole.xpos, cmds[1].ypos - hole.ypos);
        expect(d).toBeGreaterThanOrEqual(hole.diameter * 0.7 - 1);
        expect(d).toBeLessThanOrEqual(hole.diameter * 0.7 + 501);
    });

    it('Patrol a planet (571-624): 3 orbit points repeated Next(11,14) times, one Rnd draw', () => {
        const { cmds, draws } = resolve(BuiltObjectMissionType.Patrol, planet);
        expect(draws).toBe(1);
        const n = (cmds.length - 5) / 3;
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(11);
        expect(n).toBeLessThanOrEqual(13);
        expect(actions(cmds.slice(0, 4))).toEqual([A.ClearParent, A.ConditionalHyperTo, A.SetParent, A.MoveTo]);
        expect(actions(cmds.slice(-2))).toEqual([A.ClearParent, A.ReassignMission]);
        const s = Math.fround(PATROL_ORBIT_DISTANCE * Math.sin(Math.PI / 3));
        const c = Math.fround(PATROL_ORBIT_DISTANCE * Math.cos(Math.PI / 3));
        expect([cmds[3].targetRelativeXpos, cmds[3].targetRelativeYpos]).toEqual([0, -PATROL_ORBIT_DISTANCE]);
        expect([cmds[4].targetRelativeXpos, cmds[4].targetRelativeYpos]).toEqual([s, c]);
        expect([cmds[5].targetRelativeXpos, cmds[5].targetRelativeYpos]).toEqual([-s, c]);
        expect(cmds[6]).toBe(cmds[3]); // the same three Command objects are enqueued repeatedly
        expect(cmds[3].targetHabitat).toBe(planet);
    });

    it('Refuel at a base (999-1009) ends with a park command from SelectRelativeParkingPoint (3 draws)', () => {
        const base = empire.spacePorts[0];
        const { cmds, draws } = resolve(BuiltObjectMissionType.Refuel, base);
        expect(draws).toBe(3);
        expect(actions(cmds)).toEqual([A.ClearParent, A.ConditionalHyperTo, A.SetParent, A.MoveTo, A.Dock, A.Refuel, A.Undock, A.SetParent, A.MoveTo]);
        expect(cmds[4].targetBuiltObject).toBe(base);
        const park = cmds[8];
        expect(park.targetBuiltObject).toBeNull();
        expect(Math.hypot(park.targetRelativeXpos, park.targetRelativeYpos)).toBeGreaterThanOrEqual(149);
        expect(Math.hypot(park.targetRelativeXpos, park.targetRelativeYpos)).toBeLessThanOrEqual(301);
    });

    it('Attack a ship (703-723), Escort (683-689), Colonize (876-883), Retire ship (836-846), Deploy (1088-1100)', () => {
        const other = galaxy.empires[2].builtObjects[0];
        expect(actions(resolve(BuiltObjectMissionType.Attack, other).cmds)).toEqual([A.ClearParent, A.ConditionalHyperTo, A.Attack, A.EvaluateThreats, A.ReassignMission]);
        expect(actions(resolve(BuiltObjectMissionType.Escort, other).cmds)).toEqual([A.ClearParent, A.ConditionalHyperTo, A.Escort]);
        expect(actions(resolve(BuiltObjectMissionType.Colonize, planet).cmds)).toEqual([A.ClearParent, A.ConditionalHyperTo, A.SetParent, A.MoveTo, A.ImpulseTo, A.Colonize]);
        expect(actions(resolve(BuiltObjectMissionType.Retire, empire.spacePorts[0]).cmds)).toEqual([A.ClearParent, A.ConditionalHyperTo, A.SetParent, A.MoveTo, A.Dock, A.Scrap]);
        const dep = resolve(BuiltObjectMissionType.Deploy, planet, null, { x: 10, y: 20 });
        expect(actions(dep.cmds)).toEqual([A.ClearParent, A.ConditionalHyperTo, A.SetParent, A.MoveTo, A.Deploy]);
        expect([dep.cmds[3].targetRelativeXpos, dep.cmds[3].targetRelativeYpos]).toEqual([10, 20]);
    });

    it('Escort with a habitat target throws inside the C# try → commands so far (none)', () => {
        const { m, cmds } = resolve(BuiltObjectMissionType.Escort, planet);
        expect(cmds).toEqual([]);
        expect(m.type).toBe(BuiltObjectMissionType.Escort); // couldResolveCommands stays true
    });

    it('Transport with cargo (Bacon LoadMoreCargo 17-135): amounts become CargoCapacity / count and the queue is rebuilt', () => {
        const base = empire.spacePorts[0];
        const cargo = new CargoList();
        cargo.add(new Cargo(new ResourceRef(1), 5, empire));
        cargo.add(new Cargo(new ResourceRef(2), 5, empire));
        const { m, cmds, draws } = resolve(BuiltObjectMissionType.Transport, base, planet, { cargo });
        // 6 draws: the Transport case's park command (548) then LoadMoreCargo's park command (126).
        expect(draws).toBe(6);
        expect(actions(cmds)).toEqual([A.ClearParent, A.ConditionalHyperTo, A.SetParent, A.MoveTo, A.Dock, A.Refuel, A.Load, A.Undock, A.ConditionalHyperTo, A.SetParent, A.MoveTo, A.Dock, A.Unload, A.Refuel, A.Undock, A.SetParent, A.MoveTo]);
        expect(m.cargo!.items.map((c) => c.amount)).toEqual([Math.trunc(ship.cargoCapacity / 2), Math.trunc(ship.cargoCapacity / 2)]);
        expect(cmds[6].commodities).not.toBe(m.cargo); // Load carries a clone
        expect(cmds[6].commodities!.items[0].amount).toBe(Math.trunc(ship.cargoCapacity / 2));
        expect(cmds[11].targetHabitat).toBe(planet);
    });

    it('resolveCommandsForMission on a Base for Build returns a null queue (261-262)', () => {
        const base = empire.spacePorts[0];
        const m = new BuiltObjectMission(galaxy, base, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.Normal, { allowBuiltObjectChanges: false });
        m.type = BuiltObjectMissionType.Build;
        base.isShipYard = false;
        const r = resolveCommandsForMission(m, m, false, false);
        expect(r.commands).toBeNull();
        expect(r.couldResolveCommands).toBe(true);
    });
});

describe('BuiltObject.AssignMission (BuiltObject.2.cs 7620) / ClearPreviousMissionRequirements (BuiltObject.1.cs 1361)', () => {
    it('is a no-op for bases', () => {
        const base = empire.spacePorts[0];
        base.mission = null;
        assignMission(galaxy, base, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.Normal);
        expect(base.mission).toBeNull();
    });

    it('sets the mission, FirstExecutionOfCommand and AttackRangeSquared per mission type (7699-7731)', () => {
        ship.firstExecutionOfCommand = false;
        assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, planet, null, BuiltObjectMissionPriority.Normal);
        expect(builtObjectMission(ship.mission)!.type).toBe(BuiltObjectMissionType.Patrol);
        expect(ship.firstExecutionOfCommand).toBe(true);
        expect(ship.attackRangeSquared).toBe(Math.fround(48000 * 48000));
        const other = galaxy.empires[2].builtObjects[0];
        assignMission(galaxy, ship, BuiltObjectMissionType.Escort, other, null, BuiltObjectMissionPriority.Normal);
        expect(ship.attackRangeSquared).toBe(Math.fround(2000 * 2000));
        assignMission(galaxy, ship, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.Normal);
        expect(ship.attackRangeSquared).toBe(Math.fround(48000 * 48000));
        // manual ranges (-1) with manuallyAssigned: none applies, AttackRangeSquared >= 0 ⇒ unchanged.
        assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, planet, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        expect(ship.attackRangeSquared).toBe(Math.fround(48000 * 48000));
        expect(builtObjectMission(ship.mission)!.manuallyAssigned).toBe(true);
    });

    it('Attack missions register / unregister the ship as a pursuer of the target (7647-7689)', () => {
        const other = galaxy.empires[2].builtObjects.find((b) => b.role !== BuiltObjectRole.Base)!;
        other.pursuers = [];
        assignMission(galaxy, ship, BuiltObjectMissionType.Attack, other, null, BuiltObjectMissionPriority.High);
        expect(other.pursuers).toEqual([ship]);
        expect(ship.attackRangeSquared).toBe(Math.fround(2000 * 2000));
        assignMission(galaxy, ship, BuiltObjectMissionType.Attack, other, null, BuiltObjectMissionPriority.High);
        expect(other.pursuers).toEqual([ship]); // removed by the previous-mission check, added once
        ship.revertMission = builtObjectMission(ship.mission);
        assignMission(galaxy, ship, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        expect(other.pursuers).toEqual([]);
        expect(ship.revertMission).toBeNull();
    });

    it('RecordRevertMission stores a clone only for non-automated ships and the listed mission types (4586-4620)', () => {
        assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, planet, null, BuiltObjectMissionPriority.Normal);
        ship.revertMission = null;
        ship.isAutoControlled = true;
        recordRevertMission(galaxy, ship, BuiltObjectMissionType.Refuel);
        expect(ship.revertMission).toBeNull();
        recordRevertMission(galaxy, ship, BuiltObjectMissionType.Refuel, true);
        expect(ship.revertMission!.type).toBe(BuiltObjectMissionType.Patrol);
        expect(ship.revertMission!.targetHabitat).toBe(planet);
        expect(ship.revertMission).not.toBe(ship.mission);
        ship.revertMission = null;
        recordRevertMission(galaxy, ship, BuiltObjectMissionType.Explore, true);
        expect(ship.revertMission).toBeNull();
    });

    it('ClearPreviousMissionRequirements clears docking, parents, mission and speed clamp (1361-1517)', () => {
        const base = empire.spacePorts[0];
        assignMission(galaxy, ship, BuiltObjectMissionType.Refuel, base, null, BuiltObjectMissionPriority.Normal);
        ship.parentBuiltObject = base;
        ship.parentOffsetX = 3;
        base.dockingBayWaitQueue = [ship, ship];
        ship.dockedAt = base;
        base.dockingBays![0].dockedShip = ship;
        ship.currentSpeed = ship.topSpeed + 100;
        ship.firstExecutionOfCommand = false;
        resetTodoCounts();
        clearPreviousMissionRequirements(galaxy, ship);
        expect(base.dockingBayWaitQueue).toEqual([]);
        expect(base.dockingBays![0].dockedShip).toBeNull();
        expect(ship.dockedAt).toBeNull();
        expect(ship.parentBuiltObject).toBeNull();
        expect(ship.parentOffsetX).toBe(-2000000001.0);
        expect(builtObjectMission(ship.mission)!.type).toBe(BuiltObjectMissionType.Undefined);
        expect(ship.firstExecutionOfCommand).toBe(true);
        expect(ship.currentSpeed).toBe(ship.cruiseSpeed);
        expect(ship.targetSpeed).toBe(ship.cruiseSpeed);
        const hits = todoHits();
        // Refuel mission → CheckCancelRefuelData (ported by M4e; no reservation to release here): no M4e stub is reached.
        expect(Object.keys(hits).filter((k) => k.startsWith('M4e '))).toEqual([]);
        // UpdatePosition is ported (M4c): no stub hit.
        expect(hits['M4c updatePosition']).toBeUndefined();
    });
});

describe('ExecuteCommands (BuiltObject.2.cs 399-4579)', () => {
    function ctx(command: Command, over: Partial<CommandContext> = {}): CommandContext {
        const mission = new BuiltObjectMission(galaxy, ship, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.Normal, { starDate: 0, allowBuiltObjectChanges: false });
        mission.replaceCommandStack([command, new Command(A.ScanArea)]);
        return { galaxy, bo: ship, mission, command, timePassed: 0.5, time: 10000, starDate: 10000, targetX: 0, targetY: 0, indexX: 0, indexY: 0, xpos: ship.xpos, ypos: ship.ypos, parentXPos: -2000000001.0, parentYPos: -2000000001.0, targetArrivalDistance: 0, ...over };
    }

    it('every CommandAction with a C# case has a handler; SelfDestruct / SelectTargetToAttack have none', () => {
        for (const a of [A.Hold, A.ImpulseTo, A.MoveTo, A.SprintTo, A.HyperTo, A.ConditionalHyperTo, A.Escort, A.Dock, A.Undock, A.Load, A.Unload, A.Attack, A.Refuel, A.Build, A.Scrap, A.Retrofit, A.Repair, A.RepeatSubsequentCommands, A.EvaluateThreats, A.ReassignMission, A.SetParent, A.ClearParent, A.ClearAttackers, A.Blockade, A.Colonize, A.ExtractResources, A.ScanArea, A.Deploy, A.Undeploy, A.Bombard, A.Capture, A.Raid, A.HoldSyncFleet]) {
            expect(commandHandler(a), CommandAction[a]).not.toBeNull();
        }
        expect(commandHandler(A.SelfDestruct)).toBeNull();
        expect(commandHandler(A.SelectTargetToAttack)).toBeNull();
    });

    it('SetParent (4367): parent + offset from the current position, command completed, returns timePassed', () => {
        ship.xpos = planet.xpos + 100;
        ship.ypos = planet.ypos - 50;
        const c = ctx(Command.forTarget(A.SetParent, planet));
        expect(cmdSetParent(c)).toBe(0.5);
        expect(ship.parentHabitat).toBe(planet);
        expect(ship.parentBuiltObject).toBeNull();
        expect([ship.parentOffsetX, ship.parentOffsetY]).toEqual([100, -50]);
        expect(c.mission.fastPeekCurrentCommand()!.action).toBe(A.ScanArea);
        expect(ship.firstExecutionOfCommand).toBe(true);
    });

    it('ClearParent (4406): drops dock/build links, parents and offsets', () => {
        const base = empire.spacePorts[0];
        ship.dockedAt = base;
        base.dockingBayWaitQueue = [ship];
        base.dockingBays![0].dockedShip = ship;
        ship.parentHabitat = planet;
        const c = ctx(new Command(A.ClearParent));
        expect(cmdClearParent(c)).toBe(0.5);
        expect(ship.dockedAt).toBeNull();
        expect(base.dockingBayWaitQueue).toEqual([]);
        expect(base.dockingBays![0].dockedShip).toBeNull();
        expect(ship.parentHabitat).toBeNull();
        expect(ship.parentOffsetX).toBe(-2000000001.0);
        expect(c.mission.showAllCommands().length).toBe(1);
    });

    it('Hold (1207): waits until StarDate, then returns the overshoot in seconds (0 for a negative StarDate)', () => {
        const waiting = ctx(Command.withStarDate(A.Hold, 20000));
        expect(cmdHold(waiting)).toBe(0.0);
        expect(waiting.mission.fastPeekCurrentCommand()!.action).toBe(A.Hold);
        const done = ctx(Command.withStarDate(A.Hold, 7500));
        expect(cmdHold(done)).toBe(2.5);
        expect(done.mission.fastPeekCurrentCommand()!.action).toBe(A.ScanArea);
        const neg = ctx(Command.withStarDate(A.Hold, -1));
        expect(cmdHold(neg)).toBe(0.0);
        expect(neg.mission.fastPeekCurrentCommand()!.action).toBe(A.ScanArea);
    });

    it('Deploy / RepeatSubsequentCommands / ClearAttackers / EvaluateThreats', () => {
        ship.parentHabitat = planet;
        const d = ctx(new Command(A.Deploy));
        expect(cmdDeploy(d)).toBe(0.5);
        expect(ship.deployProgress).toBe(Math.fround(0.01));
        (ship as unknown as { _deployProgress: number })._deployProgress = 0; // undo for the later ClearParent frame test
        ship.parentHabitat = null;
        const r = ctx(new Command(A.RepeatSubsequentCommands));
        expect(cmdRepeatSubsequentCommands(r)).toBe(0.5);
        expect(r.mission.repeatCommands).toBe(true);
        expect(r.mission.showAllCommands().length).toBe(1); // ignoreRepeatCommands: the Repeat command itself is not re-queued
        ship.attackers = [planet as unknown as BuiltObject];
        const a = ctx(new Command(A.ClearAttackers));
        expect(cmdClearAttackers(a)).toBe(0.5);
        expect(ship.attackers).toEqual([]);
        const e = ctx(new Command(A.EvaluateThreats));
        ship.threats = null;
        expect(cmdEvaluateThreats(e)).toBe(0.0);
        // M4n ported ThreatEvaluation (it was a stub hit here): PerformThreatEvaluation now fills the ship's threat arrays.
        expect(ship.threats).not.toBeNull();
        expect(ship.threats!.length).toBe(ship.threatLevels!.length);
        expect(ship.threats!.length).toBeLessThanOrEqual(20);
    });

    it('frame: destroyed command target completes the command and returns timePassed (470-481)', () => {
        const other = galaxy.empires[2].builtObjects.find((b) => b.role !== BuiltObjectRole.Base)!;
        // M4f: the target may carry a game-start mission with a hyperjump, which makes the Attack stack use
        // ConditionalHyperTo(x, y) instead of the target object (BuiltObjectMission.cs 703-723); use an idle target.
        other.mission = null;
        assignMission(galaxy, ship, BuiltObjectMissionType.Attack, other, null, BuiltObjectMissionPriority.High);
        const m = builtObjectMission(ship.mission)!;
        m.completeCommand(); // skip ClearParent → ConditionalHyperTo(other)
        expect(m.fastPeekCurrentCommand()!.targetBuiltObject).toBe(other);
        other.hasBeenDestroyed = true;
        ship.currentTarget = other;
        ship.attackers = [other];
        expect(executeCommands(galaxy, ship, 0.25, 10000, 10000)).toBe(0.25);
        expect(m.fastPeekCurrentCommand()!.action).toBe(A.Attack);
        expect(ship.currentTarget).toBeNull();
        expect(ship.attackers).toEqual([]);
        other.hasBeenDestroyed = false;
        other.pursuers = [];
    });

    it('frame: no mission → epilogue (AssignQueuedMission, RevertToPreviousMission stub, speed reset); InView clamps to 0', () => {
        ship.mission = null;
        ship.revertMission = null;
        ship.shipPullAmountLocation = 0;
        ship.preferredSpeed = 5;
        ship.targetSpeed = 5;
        resetTodoCounts();
        expect(executeCommands(galaxy, ship, 0.25, 10000, 10000)).toBe(0.0);
        expect(ship.preferredSpeed).toBe(0);
        expect(ship.targetSpeed).toBe(0);
        const hits = todoHits();
        // RevertToPreviousMission → AutoRefuelRepairShip (ported by M4e): no M4e stub is reached.
        expect(Object.keys(hits).filter((k) => k.startsWith('M4e '))).toEqual([]);
        // AccelerateToTargetSpeed / CalculateCurrentHeading are ported (M4c): no M4c stub is reached.
        expect(Object.keys(hits).some((k) => k.startsWith('M4c '))).toBe(false);
        expect(Object.keys(hits).some((k) => k.startsWith('M4b '))).toBe(false);
        assignMission(galaxy, ship, BuiltObjectMissionType.Explore, planet, null, BuiltObjectMissionPriority.Normal);
        const m = builtObjectMission(ship.mission)!;
        expect(executeCommands(galaxy, ship, 0.25, 10000, 10000)).toBe(0.25); // ClearParent (M4b) consumes nothing
        expect(m.fastPeekCurrentCommand()!.action).toBe(A.ConditionalHyperTo);
        // ConditionalHyperTo is ported (M4c, was a stub that kept the command): the planet is within
        // HyperJumpThreshhold, so the jump is dropped and all the time is handed on to the next command (SetParent).
        expect(galaxy.calculateDistance(ship.xpos, ship.ypos, planet.xpos, planet.ypos)).toBeLessThanOrEqual(12000);
        resetTodoCounts();
        expect(executeCommands(galaxy, ship, 0.25, 10000, 10000)).toBe(0.25);
        expect(todoHits()['M4c cmdConditionalHyperTo']).toBeUndefined();
        expect(m.fastPeekCurrentCommand()!.action).toBe(A.SetParent);
        ship.inView = true;
        expect(executeCommands(galaxy, ship, 0.25, 10000, 10000)).toBe(0.0);
        ship.inView = false;
        ship.mission = null;
    });

    it('BuiltObject.DoTasks drives the loop: a queued Hold mission completes when the star date passes', () => {
        const sd = galaxyStarDate(galaxy);
        assignMission(galaxy, ship, BuiltObjectMissionType.Hold, null, null, BuiltObjectMissionPriority.Normal, { starDate: sd + 2000 });
        const m = builtObjectMission(ship.mission)!;
        builtObjectDoTasks(galaxy, ship, galaxy.nowMs, sd);
        builtObjectDoTasks(galaxy, ship, galaxy.nowMs + 1000, sd + 1000);
        expect(m.type).toBe(BuiltObjectMissionType.Hold);
        builtObjectDoTasks(galaxy, ship, galaxy.nowMs + 3000, sd + 3000);
        expect(m.type).toBe(BuiltObjectMissionType.Undefined);
        expect(m.previousType).toBe(BuiltObjectMissionType.Hold);
        ship.mission = null;
    });
});

describe('distress signals / declined tasks', () => {
    it('ClearOutOldDistressSignals (< now − 50 000) and ClearOldDistressSignals (< now − 90 000)', () => {
        const now = galaxyStarDate(galaxy);
        const base = empire.spacePorts[0];
        const list = empireDistressSignals(empire);
        list.length = 0;
        const a = new DistressSignal(base, DistressSignalType.UnderAttack, now - 100000);
        const b = new DistressSignal(planet, DistressSignalType.ColonyBombarded, now - 60000);
        const c = new DistressSignal(base, DistressSignalType.NeedRepair, now - 10);
        list.push(a, b, c);
        expect(a.source).toBe(base);
        expect(b.source).toBe(planet);
        expect(a.compareTo(b)).toBe(-1);
        clearOldDistressSignals(galaxy, empire);
        expect(list).toEqual([b, c]);
        clearOutOldDistressSignals(galaxy, empire);
        expect(list).toEqual([c]);
        list.length = 0;
    });

    it('ClearExpiredDeclinedTasks drops tasks whose ExpiryDate < now', () => {
        const now = galaxyStarDate(galaxy);
        const keep = new DeclinedTask(now, planet);
        const drop = new DeclinedTask(now - 1, planet);
        empire.declinedTasks = [drop, keep];
        clearExpiredDeclinedTasks(galaxy, empire);
        expect(empire.declinedTasks).toEqual([keep]);
        empire.declinedTasks = [];
    });

    it('ProcessDistressSignals: bases and habitats ask the M4n/M4m stubs, ships are skipped', () => {
        const now = galaxyStarDate(galaxy);
        const base = empire.spacePorts[0];
        const list = empireDistressSignals(empire);
        list.length = 0;
        const s1 = new DistressSignal(base, DistressSignalType.UnderAttack, now);
        s1.attackStrength = 1000;
        const s2 = new DistressSignal(ship, DistressSignalType.UnderAttack, now);
        s2.attackStrength = 1000;
        const s3 = new DistressSignal(planet, DistressSignalType.ColonyBombarded, now);
        s3.attackStrength = 1000;
        list.push(s1, s2, s3);
        resetTodoCounts();
        processDistressSignals(galaxy, empire);
        const hits = todoHits();
        // M4n ported DetermineDefendingStrength (Galaxy.6.cs 4674 / 4745): only the signals whose defenders fall short of
        // 0.75 × the attack strength reach the M4m response-fleet lookup (Empire.3.cs 4934 / 4989).
        const responses = [base, planet].filter((t) => determineDefendingStrength(galaxy, t, empire) < Math.trunc(1000 * 0.75)).length;
        expect(responses).toBeGreaterThan(0);
        expect(hits['M4m identifyNearestResponseFleet']).toBe(responses);
        list.length = 0;
        // no attack strength ⇒ defenders (0) >= 0.75 × 0 ⇒ no response fleet lookup
        const s4 = new DistressSignal(base, DistressSignalType.UnderAttack, now);
        list.push(s4);
        resetTodoCounts();
        processDistressSignals(galaxy, empire);
        expect(todoHits()['M4m identifyNearestResponseFleet']).toBeUndefined();
        list.length = 0;
    });
});

describe('harness smoke (M4b ported, other packages stubbed)', () => {
    it('60 game-s run twice gives the same digest, reaches no M4b stub and no M4b Rnd site', () => {
        const a = createTickGame(gameData).galaxy;
        const b = createTickGame(gameData).galaxy;
        const ra = runGameSeconds(a, 60);
        const rb = runGameSeconds(b, 60);
        expect(stateDigest(a)).toBe(stateDigest(b));
        expect(ra.rndDraws).toBe(rb.rndDraws);
        expect(Object.keys(ra.todoHits).filter((k) => k.startsWith('M4b '))).toEqual([]);
        // M4e is fully ported (the AutoRefuelRepairShip marker that used to be asserted here is gone).
        expect(Object.keys(ra.todoHits).filter((k) => k.startsWith('M4e '))).toEqual([]);
    }, 300000);
});
