// M4e — docking & cargo commands, refuelling (tasks/M4-plan.md §3.3 M4e).
// Unit tests against hand-worked C# values, plus a harness smoke test (ships dock, load / unload and refuel).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Habitat } from '../src/sim/types';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';
import { Cargo, CargoList, ResourceRef } from '../src/sim/cargo';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { galaxyResourceCurrentPrices } from '../src/sim/design';
import { runGameSeconds } from '../src/sim/tick/harness';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, Command, CommandAction } from '../src/sim/missions/mission';
import type { CommandContext } from '../src/sim/missions/executeCommands';
import { cmdDock, cmdLoad, cmdRefuel, cmdUndock, cmdUnload } from '../src/sim/missions/cmdDocking';
import { createHabitatDockingBays, createPopulatedHabitatDockingBays, takeOwnershipOfColonyDockingBays } from '../src/sim/logistics/dockingBays';
import { checkClearDocking, checkForShipsNoLongerDockingHabitat, checkRemoveInvalidDockingShipsFromWaitQueue, detectShipsDockingAtHabitat } from '../src/sim/logistics/docking';
import { checkCancelRefuelData, determineFuelRequired, initiateRefuelData, purchasePrivateFuel, thisYearsPrivateFuelCosts } from '../src/sim/logistics/refuel';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGalaxy(): Galaxy {
    return createTickGame(gameData).galaxy;
}

function aShip(g: Galaxy): BuiltObject {
    return (g.builtObjects as BuiltObject[]).find((b) => b.role !== BuiltObjectRole.Base && b.warpSpeed > 0 && b.empire !== null && b.empire.capital !== null && b.fuelType !== null && b.fuelCapacity > 200)!;
}

function ctxFor(g: Galaxy, bo: BuiltObject, mission: BuiltObjectMission, command: Command, timePassed: number): CommandContext {
    mission.replaceCommandStack([command, new Command(CommandAction.ScanArea)]);
    bo.mission = mission;
    return { galaxy: g, bo, mission, command, timePassed, time: 10000, starDate: 10000, targetX: -2000000001, targetY: -2000000001, indexX: 0, indexY: 0, xpos: bo.xpos, ypos: bo.ypos, parentXPos: -2000000001.0, parentYPos: -2000000001.0, targetArrivalDistance: 0 };
}

/** Put `bo` into the first free bay of `host`, as case Dock does. */
function dockAt(bo: BuiltObject, host: Habitat): void {
    const bay = host.dockingBays!.find((b) => b.dockedShip === null)!;
    bay.dockedShip = bo;
    bo.dockedAt = host;
    bo.parentHabitat = host;
    bo.parentBuiltObject = null;
}

describe('habitat docking bays and wait queues (Galaxy.8.cs 277-285, Galaxy.5.cs 1619-1644, Empire.1.cs 120-131)', () => {
    let g: Galaxy;
    beforeAll(() => {
        g = newGalaxy();
    }, 300000);

    it('every colony has 20 bays of component 74 (capacity 100) and an empty wait queue', () => {
        for (const e of g.empires) {
            const capital = e.capital!;
            expect(capital.dockingBays!.length).toBe(20);
            expect(capital.dockingBays![0].parentComponentId).toBe(74);
            expect(capital.dockingBays![0].parentBuiltObjectComponentId).toBe(-1);
            expect(capital.dockingBays![0]._capacity).toBe(100);
            expect(capital.dockingBayWaitQueue).not.toBeNull();
        }
    });

    it('populated planets get 20 bays, asteroids / barren rock / other types 1; TakeOwnershipOfColony keeps existing bays', () => {
        const h = g.habitats.find((x) => x.empire === null && x.category === HabitatCategoryType.Planet)!;
        const saved = { type: h.type, category: h.category, bays: h.dockingBays, queue: h.dockingBayWaitQueue };
        h.type = HabitatType.Ocean;
        createPopulatedHabitatDockingBays(h);
        expect(h.dockingBays!.length).toBe(20);
        h.type = HabitatType.BarrenRock;
        createPopulatedHabitatDockingBays(h);
        expect(h.dockingBays!.length).toBe(1);
        h.type = HabitatType.Ocean;
        h.category = HabitatCategoryType.Asteroid;
        createPopulatedHabitatDockingBays(h);
        expect(h.dockingBays!.length).toBe(1);
        h.type = HabitatType.GasGiant;
        h.category = HabitatCategoryType.Planet;
        createPopulatedHabitatDockingBays(h);
        expect(h.dockingBays!.length).toBe(1);
        const bays = h.dockingBays;
        takeOwnershipOfColonyDockingBays(h);
        expect(h.dockingBays).toBe(bays);
        h.dockingBays = null;
        h.dockingBayWaitQueue = null;
        takeOwnershipOfColonyDockingBays(h);
        expect(h.dockingBays!.length).toBe(20);
        expect(h.dockingBayWaitQueue).toEqual([]);
        createHabitatDockingBays(h, 3);
        expect(h.dockingBays!.length).toBe(3);
        Object.assign(h, { type: saved.type, category: saved.category, dockingBays: saved.bays, dockingBayWaitQueue: saved.queue });
    });
});

describe('CheckClearDocking / wait-queue upkeep (BuiltObject.1.cs 1275-1354, Habitat.cs 2464, Galaxy.cs 3540)', () => {
    let g: Galaxy;
    beforeAll(() => {
        g = newGalaxy();
    }, 300000);

    it('the no-argument overload only undocks at hyperjump speed; forceUndock clears bays, queue and DockedAt', () => {
        const bo = aShip(g);
        const host = bo.empire!.capital!;
        dockAt(bo, host);
        host.dockingBayWaitQueue!.push(bo);
        bo.currentSpeed = 0;
        expect(checkClearDocking(g, bo)).toBe(false);
        expect(bo.dockedAt).toBe(host);
        bo.currentSpeed = Math.fround(bo.warpSpeed);
        expect(checkClearDocking(g, bo)).toBe(true);
        expect(bo.dockedAt).toBeNull();
        expect(host.dockingBays!.some((b) => b.dockedShip === bo)).toBe(false);
        expect(host.dockingBayWaitQueue!.includes(bo)).toBe(false);
        expect(checkClearDocking(g, bo, true)).toBe(false);
        bo.currentSpeed = 0;
        bo.parentHabitat = null;
    });

    it('CheckForShipsNoLongerDocking drops queued ships whose parent is elsewhere; invalid ships leave the queue', () => {
        const bo = aShip(g);
        const host = bo.empire!.capital!;
        host.dockingBayWaitQueue!.length = 0;
        host.dockingBayWaitQueue!.push(bo);
        bo.parentHabitat = host;
        checkForShipsNoLongerDockingHabitat(g, host);
        expect(host.dockingBayWaitQueue).toEqual([bo]);
        bo.parentHabitat = null;
        checkForShipsNoLongerDockingHabitat(g, host);
        expect(host.dockingBayWaitQueue).toEqual([]);
        // Galaxy.cs 3540: a ship without a mission is removed (returns true).
        host.dockingBayWaitQueue!.push(bo);
        bo.mission = null;
        expect(checkRemoveInvalidDockingShipsFromWaitQueue(g, host)).toBe(true);
        expect(host.dockingBayWaitQueue).toEqual([]);
        expect(checkRemoveInvalidDockingShipsFromWaitQueue(g, host)).toBe(false);
    });

    it('DetectShipsDockingAtHabitat lists queued ships whose current command docks there', () => {
        const bo = aShip(g);
        const host = bo.empire!.capital!;
        const mission = new BuiltObjectMission(g, bo, BuiltObjectMissionType.Undefined, null, null, BuiltObjectMissionPriority.Normal);
        mission.replaceCommandStack([Command.forTarget(CommandAction.Dock, host)]);
        bo.mission = mission;
        host.dockingBayWaitQueue!.length = 0;
        host.dockingBayWaitQueue!.push(bo);
        expect(detectShipsDockingAtHabitat(host)).toEqual([bo]);
        mission.replaceCommandStack([Command.forTarget(CommandAction.MoveTo, host)]);
        expect(detectShipsDockingAtHabitat(host)).toEqual([]);
        host.dockingBayWaitQueue!.length = 0;
        bo.mission = null;
    });
});

describe('cases Dock / Undock (BuiltObject.2.cs 2731, 3642)', () => {
    let g: Galaxy;
    beforeAll(() => {
        g = newGalaxy();
    }, 300000);

    it('Dock: first execution parents the ship to the target, joins the queue and takes the first free bay', () => {
        const bo = aShip(g);
        const host = bo.empire!.capital!;
        bo.dockedAt = null;
        host.dockingBayWaitQueue!.length = 0;
        for (const bay of host.dockingBays!) bay.dockedShip = null;
        const mission = new BuiltObjectMission(g, bo, BuiltObjectMissionType.Undefined, null, null, BuiltObjectMissionPriority.Normal);
        bo.firstExecutionOfCommand = true;
        const c = ctxFor(g, bo, mission, Command.forTarget(CommandAction.Dock, host), 0.5);
        expect(cmdDock(c)).toBe(0.0);
        expect(bo.parentHabitat).toBe(host);
        expect(bo.parentOffsetX).toBe(bo.xpos - host.xpos);
        expect(bo.firstExecutionOfCommand).toBe(false);
        expect(bo.dockedAt).toBe(host);
        expect(host.dockingBays![0].dockedShip).toBe(bo);
        expect(host.dockingBayWaitQueue).toEqual([]);
        expect(bo.preferredSpeed).toBe(bo.cruiseSpeed);
        // Already docked on a later first execution: the command completes at once and returns the frame time.
        bo.firstExecutionOfCommand = true;
        const c2 = ctxFor(g, bo, mission, Command.forTarget(CommandAction.Dock, host), 0.5);
        expect(cmdDock(c2)).toBe(0.5);
        expect(mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ScanArea);
    });

    it('Dock: with every bay taken the ship waits in the queue', () => {
        const bo = aShip(g);
        const host = bo.empire!.capital!;
        const other = (g.builtObjects as BuiltObject[]).find((b) => b !== bo && b.role !== BuiltObjectRole.Base)!;
        for (const bay of host.dockingBays!) bay.dockedShip = other;
        bo.dockedAt = null;
        host.dockingBayWaitQueue!.length = 0;
        const mission = new BuiltObjectMission(g, bo, BuiltObjectMissionType.Undefined, null, null, BuiltObjectMissionPriority.Normal);
        bo.firstExecutionOfCommand = true;
        cmdDock(ctxFor(g, bo, mission, Command.forTarget(CommandAction.Dock, host), 0.5));
        expect(bo.dockedAt).toBeNull();
        expect(bo.preferredSpeed).toBe(0);
        expect(host.dockingBayWaitQueue).toEqual([bo]);
        for (const bay of host.dockingBays!) bay.dockedShip = null;
        host.dockingBayWaitQueue!.length = 0;
    });

    it('Undock: impulse away along the heading; once UndockRange (30) is reached the bay is freed and the parent cleared', () => {
        const bo = aShip(g);
        const host = bo.empire!.capital!;
        for (const bay of host.dockingBays!) bay.dockedShip = null;
        bo.xpos = host.xpos;
        bo.ypos = host.ypos;
        dockAt(bo, host);
        const mission = new BuiltObjectMission(g, bo, BuiltObjectMissionType.Undefined, null, null, BuiltObjectMissionPriority.Normal);
        bo.firstExecutionOfCommand = true;
        bo.heading = 0;
        const command = new Command(CommandAction.Undock);
        const c = ctxFor(g, bo, mission, command, 0.1);
        cmdUndock(c);
        expect(command.targetRelativeXpos).toBe(Math.fround(30));
        expect(bo.firstExecutionOfCommand).toBe(false);
        // Far enough: the next call frees the bay.
        // DoMovement re-derives the position from the parent offset while parented.
        bo.parentOffsetX = 40;
        bo.parentOffsetY = 0;
        bo.xpos = host.xpos + 40;
        bo.ypos = host.ypos;
        bo.currentSpeed = 5;
        const r = cmdUndock({ ...c, timePassed: 0 });
        expect(bo.dockedAt).toBeNull();
        expect(host.dockingBays!.some((b) => b.dockedShip === bo)).toBe(false);
        expect(bo.parentHabitat).toBeNull();
        expect(bo.parentOffsetX).toBe(-2000000001.0);
        expect(bo.firstExecutionOfCommand).toBe(true);
        const dist = g.calculateDistance(host.xpos, host.ypos, bo.xpos, bo.ypos);
        expect(r).toBeCloseTo((dist - 30) / bo.currentSpeed, 12);
    });
});

describe('cases Load / Unload (BuiltObject.2.cs 3232, 3698)', () => {
    let g: Galaxy;
    beforeAll(() => {
        g = newGalaxy();
    }, 300000);

    it('Load moves Capacity×dt units per call from the dock to the hold; Unload moves them back', () => {
        // (M4q: since InvadeUnwillingColonizationTargets draws its NextDouble the seed-1 empires start without private
        // freighters, so an independent trader docks at empire 0's capital.)
        const bo = (g.builtObjects as BuiltObject[]).find((b) => b.role === BuiltObjectRole.Freight && b.empire !== null && b.cargoCapacity > 500)!;
        const host = g.empires[0].capital!;
        for (const bay of host.dockingBays!) bay.dockedShip = null;
        dockAt(bo, host);
        bo.cargo = new CargoList();
        const res = g.resourceSystem.strategicResources[0].resourceId;
        host.cargo = new CargoList();
        host.cargo.add(new Cargo(new ResourceRef(res), 1000, host.empire));
        const want = new CargoList();
        want.add(new Cargo(new ResourceRef(res), 150, host.empire));
        const mission = new BuiltObjectMission(g, bo, BuiltObjectMissionType.Undefined, null, null, BuiltObjectMissionPriority.Normal);
        const load = Command.withCargo(CommandAction.Load, want);
        bo.firstExecutionOfCommand = true;
        // Capacity 100 × 0.5 s = 50 units; result = max(0, (100 × 0.5 − 50) / 100) = 0.
        const c = ctxFor(g, bo, mission, load, 0.5);
        expect(cmdLoad(c)).toBe(0);
        expect(bo.cargo.items[0].amount).toBe(50);
        expect(host.cargo.items[0].amount).toBe(950);
        expect(want.items[0].amount).toBe(100);
        // 2 s: 200 capped at the 100 still wanted; result = (200 − 100) / 100 = 1 and the cargo line is removed.
        expect(cmdLoad({ ...c, timePassed: 2 })).toBe(1);
        expect(bo.cargo.items[0].amount).toBe(150);
        expect(host.cargo.items[0].amount).toBe(850);
        expect(want.items.length).toBe(0);
        // Nothing left to load: the command completes.
        expect(cmdLoad({ ...c, timePassed: 2 })).toBe(2);
        expect(mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ScanArea);

        const give = new CargoList();
        give.add(new Cargo(new ResourceRef(res), 150, host.empire));
        const unload = Command.withCargo(CommandAction.Unload, give);
        bo.firstExecutionOfCommand = true;
        const u = ctxFor(g, bo, mission, unload, 1);
        expect(cmdUnload(u)).toBe(0);
        expect(bo.cargo.items[0].amount).toBe(50);
        expect(host.cargo.items[0].amount).toBe(950);
        // The last 50: result = (100 × 1 − 50) / 100; a freighter's emptied hold line is removed.
        expect(cmdUnload(u)).toBe(0.5);
        expect(host.cargo.items[0].amount).toBe(1000);
        expect(bo.cargo.items.length).toBe(0);
        expect(cmdUnload(u)).toBe(1);
        expect(mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ScanArea);
    });

    it('Load / Unload when not docked cancel the contracts and complete the command', () => {
        const bo = aShip(g);
        bo.dockedAt = null;
        const mission = new BuiltObjectMission(g, bo, BuiltObjectMissionType.Undefined, null, null, BuiltObjectMissionPriority.Normal);
        expect(cmdLoad(ctxFor(g, bo, mission, new Command(CommandAction.Load), 0.25))).toBe(0.25);
        expect(mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ScanArea);
        expect(cmdUnload(ctxFor(g, bo, mission, new Command(CommandAction.Unload), 0.25))).toBe(0.25);
    });
});

describe('refuelling (case Refuel 4226, refuel data 7029-7130, fuel costs)', () => {
    let g: Galaxy;
    beforeAll(() => {
        g = newGalaxy();
    }, 300000);

    it('InitiateRefuelData reserves min(Available, FuelCapacity) at the location; CheckCancelRefuelData releases it', () => {
        const bo = aShip(g);
        const host = bo.empire!.capital!;
        const fuel = bo.fuelType!.resourceId;
        host.cargo = new CargoList();
        host.cargo.add(new Cargo(new ResourceRef(fuel), 100000, host.empire));
        const n = initiateRefuelData(g, bo, host);
        expect(n).toBe(bo.fuelCapacity);
        expect(host.cargo.items[0].reserved).toBe(bo.fuelCapacity);
        expect([bo.refuelResourceId, bo.refuelAmount, bo.refuelLocationId, bo.refuelLocationIsBuiltObject]).toEqual([fuel, bo.fuelCapacity, host.habitatIndex, false]);
        expect(checkCancelRefuelData(g, bo)).toBe(true);
        expect(host.cargo.items[0].reserved).toBe(0);
        expect([bo.refuelResourceId, bo.refuelAmount, bo.refuelLocationId]).toEqual([255, 0, -1]);
        expect(checkCancelRefuelData(g, bo)).toBe(false);
    });

    it('DetermineFuelRequired: SortTag = FuelCapacity − (int)CurrentFuel, or 1', () => {
        const bo = aShip(g);
        bo.currentFuel = 10.75;
        expect(determineFuelRequired(bo, false)).toEqual([{ resourceId: bo.fuelType!.resourceId, sortTag: bo.fuelCapacity - 10 }]);
        expect(determineFuelRequired(bo)).toEqual([{ resourceId: bo.fuelType!.resourceId, sortTag: 1 }]);
    });

    it('Refuel: RefuelRate (40) × dt per call at the depot price, then completes when full', () => {
        const bo = aShip(g);
        const host = bo.empire!.capital!;
        for (const bay of host.dockingBays!) bay.dockedShip = null;
        dockAt(bo, host);
        host.isRefuellingDepot = true;
        const fuel = bo.fuelType!.resourceId;
        host.cargo = new CargoList();
        host.cargo.add(new Cargo(new ResourceRef(fuel), 5000, host.empire));
        bo.currentFuel = bo.fuelCapacity - 100;
        bo.refuelAmount = 0;
        const price = galaxyResourceCurrentPrices(g)[fuel];
        const payer = bo.owner ?? bo.empire!;
        const money0 = payer.stateMoney;
        const mission = new BuiltObjectMission(g, bo, BuiltObjectMissionType.Undefined, null, null, BuiltObjectMissionPriority.Normal);
        const c = ctxFor(g, bo, mission, new Command(CommandAction.Refuel), 1);
        expect(cmdRefuel(c)).toBe(0);
        expect(bo.currentFuel).toBe(bo.fuelCapacity - 60);
        expect(host.cargo.items[0].amount).toBe(4960);
        if (bo.owner !== null) {
            expect(payer.stateMoney).toBeCloseTo(money0 - Math.trunc(40 * price) + (payer === host.empire ? 0 : 0), 6);
            expect(payer.thisYearsStateFuelCosts).toBeGreaterThanOrEqual(Math.trunc(40 * price));
        }
        // 10 s: 400 wanted, 60 missing → 60, complete; result = (400 − 60) / 40 = 8.5.
        expect(cmdRefuel({ ...c, timePassed: 10 })).toBe(8.5);
        expect(bo.currentFuel).toBe(bo.fuelCapacity);
        expect(mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ScanArea);
        // Not docked: CheckCancelRefuelData + complete with the frame time.
        bo.dockedAt = null;
        expect(cmdRefuel(ctxFor(g, bo, mission, new Command(CommandAction.Refuel), 0.3))).toBe(0.3);
    });

    it('PurchasePrivateFuel resets the yearly total at a new year', () => {
        const e = g.empires[0];
        e.thisYearsPrivateFuelCostsValue = 50;
        e.dateOfLastPrivateFuelCost = -1;
        purchasePrivateFuel(g, e, 7);
        expect(thisYearsPrivateFuelCosts(g, e)).toBe(7);
        purchasePrivateFuel(g, e, 3);
        expect(thisYearsPrivateFuelCosts(g, e)).toBe(10);
    });
});

describe('harness smoke (seed 1, 600 game-s)', () => {
    it('ships dock at colonies and bases, and refuel missions are assigned', () => {
        const g = newGalaxy();
        // Within 600 s no ship drains far enough on its own (the threshold is ~5% of FuelCapacity), so one auto-controlled
        // empire ship (an explorer) starts nearly empty: the periodic CheckForRefuelling must send it on a Refuel mission.
        const thirsty = (g.builtObjects as BuiltObject[]).find((b) => b.role === BuiltObjectRole.Exploration && b.isAutoControlled && b.empire !== null && b.empire.capital !== null && b.fuelType !== null && b.fuelCapacity > 0)!;
        thirsty.currentFuel = 1;
        let maxDocked = 0;
        let sawRefuelMission = false;
        let sawLoadOrUnload = false;
        let thirstyMaxFuel = thirsty.currentFuel;
        runGameSeconds(g, 600, {
            onFrame: () => {
                thirstyMaxFuel = Math.max(thirstyMaxFuel, thirsty.currentFuel);
                if (g.scheduler!.frames % 60 !== 0) return;
                let docked = 0;
                for (const b of g.builtObjects) {
                    // CompleteTeardown nulls the Galaxy.BuiltObjects slot (BuiltObject.2.cs 5171, since M4s2); the age-1
                    // harness destroys ships within this run.
                    if (b == null) continue;
                    if (b.dockedAt !== null) docked++;
                    const m = b.mission as BuiltObjectMission | null;
                    if (m !== null && m.type === BuiltObjectMissionType.Refuel) sawRefuelMission = true;
                    const cmd = m !== null ? m.fastPeekCurrentCommand() : null;
                    if (cmd !== null && b.dockedAt !== null && (cmd.action === CommandAction.Load || cmd.action === CommandAction.Unload)) sawLoadOrUnload = true;
                }
                maxDocked = Math.max(maxDocked, docked);
            },
        });
        expect(maxDocked).toBeGreaterThan(0);
        expect(sawLoadOrUnload).toBe(true);
        expect(sawRefuelMission).toBe(true);
        // ... and it flies there, docks, takes on fuel (case Refuel) and undocks. (Since M4f the explorer then gets an
        // Explore mission and burns fuel again, so the peak level is checked.)
        expect(thirstyMaxFuel).toBeGreaterThan(thirsty.fuelCapacity * 0.9);
        // Docked ships sit in a bay of their dock.
        for (const b of g.builtObjects) {
            if (b != null && b.dockedAt !== null && !b.hasBeenDestroyed) {
                expect(b.dockedAt.dockingBays!.some((bay) => bay.dockedShip === b)).toBe(true);
            }
        }
    }, 600000);
});
