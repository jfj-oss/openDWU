// M4l — ShipGroup model & fleet tick (src/sim/fleets/shipGroup.ts, shipGroupTasks.ts). Unit checks against hand-worked
// C# expectations (ShipGroup.cs, Empire.9.cs MaintainShipGroups / AddShipsToShipGroup, Empire.cs
// GetNextFleetNumberDescription, BuiltObject.cs ReviewFleetBonuses / PerformFleetTasks) on a createGame galaxy (seed 1).
// The createGame empires start without warships, so fleets are built from pirate escorts re-roled as frigates.
import { beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { ShipGroup, empireShipGroups, shipGroupRepairBonus } from '../src/sim/fleets/shipGroup';
import {
    checkForMissionCompletion,
    checkRefuelRepairAttack,
    compareShipGroups,
    disbandShipGroup,
    empireFleetMaximumCount,
    getNextFleetNumberDescription,
    leaveShipGroup,
    maintainShipGroups,
    performFleetTasks,
    reviewFleetBonuses,
    shipGroupAddShipToFleet,
    shipGroupAssignMission,
    shipGroupDetermineLeadShip,
    shipGroupIdentifyFleetLocation,
    shipGroupIsShipAvailable,
    shipGroupListCountLargeFleets,
    shipGroupListOrderByName,
    shipGroupReviewAdmiralBonuses,
    shipGroupWarpSpeed,
    sortBuiltObjectsByDistance,
    updateFleetLeadShips,
} from '../src/sim/fleets/shipGroupTasks';
import { shipGroupDoTasks } from '../src/sim/tick/shipGroupTick';

let gameData: GameData;
let galaxy: Galaxy;
let pirate: Empire;
let ships: BuiltObject[];

/** A fresh galaxy per test (fleet state and Rnd draws are mutated by every check). */
beforeEach(async () => {
    gameData ??= await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
    const escorts = (e: Empire): BuiltObject[] => e.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.subRole === BuiltObjectSubRole.Escort && b.topSpeed > 0);
    // The pirate faction with the most escorts, topped up to three ships from other factions' escorts.
    pirate = [...galaxy.pirateEmpires].sort((a, b) => escorts(b).length - escorts(a).length)[0];
    ships = escorts(pirate);
    for (const other of galaxy.pirateEmpires) {
        for (const s of escorts(other)) {
            if (ships.length >= 3 || other === pirate) break;
            other.builtObjects.splice(other.builtObjects.indexOf(s), 1);
            s.empire = pirate;
            pirate.builtObjects.push(s);
            ships.push(s);
        }
    }
    expect(ships.length).toBeGreaterThanOrEqual(3);
    // Escorts are never fleet candidates (FindAvailableMilitaryShip, Empire.8.cs 5222): re-role them as idle frigates.
    for (const s of ships) {
        s.subRole = BuiltObjectSubRole.Frigate;
        s.mission = null;
        s.currentFuel = s.fuelCapacity;
    }
});

describe('Empire.cs 3076 GetNextFleetNumberDescription', () => {
    it('numbers fleets with English ordinals (11th-13th and 111th-113th take "th")', () => {
        const out: string[] = [];
        for (let i = 0; i < 113; i++) out.push(getNextFleetNumberDescription(pirate));
        expect(out.slice(0, 5)).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
        expect(out.slice(9, 13)).toEqual(['10th', '11th', '12th', '13th']);
        expect(out.slice(20, 23)).toEqual(['21st', '22nd', '23rd']);
        expect(out.slice(100, 103)).toEqual(['101st', '102nd', '103rd']);
        expect(out.slice(110, 113)).toEqual(['111th', '112th', '113th']);
    });
});

describe('ShipGroup model (ShipGroup.cs)', () => {
    it('Empire setter: AttackRangeSquared = (float)AttackRangeOther², troop loadouts from the policy (2740, 137)', () => {
        const sg = new ShipGroup(galaxy);
        expect(sg.posture).toBe(FleetPosture.Attack);
        sg.empire = pirate;
        expect(sg.attackRangeSquared).toBe(Math.fround(pirate.attackRangeOther * pirate.attackRangeOther));
        const p = pirate.policy!;
        if (p.troopUseDefaultTransportLoadout) {
            const num = Math.fround(1 / Math.fround(Math.fround(Math.fround(Math.fround(p.troopDefaultTransportLoadoutInfantry) + Math.fround(p.troopDefaultTransportLoadoutArmor)) + Math.fround(p.troopDefaultTransportLoadoutArtillery)) + Math.fround(p.troopDefaultTransportLoadoutSpecialForces)));
            expect(sg.troopLoadoutInfantry).toBe(Math.trunc(100 * Math.fround(p.troopDefaultTransportLoadoutInfantry) * num));
        } else {
            expect([sg.troopLoadoutInfantry, sg.troopLoadoutArmored, sg.troopLoadoutArtillery, sg.troopLoadoutSpecialForces]).toEqual([255, 255, 255, 255]);
        }
        // Bonus properties are base + extra (ShipGroup.cs 67-87).
        sg.repairBonusBase = 1.25;
        sg.repairBonusExtra = 0.1;
        expect(shipGroupRepairBonus(sg)).toBeCloseTo(1.35, 12);
    });

    it('AddShipToFleet sets the first ship as lead; LeaveShipGroup re-picks the lead and disbands an empty fleet (370, BuiltObject.1.cs 42, Empire.8.cs 5145)', () => {
        const sg = new ShipGroup(galaxy);
        sg.empire = pirate;
        empireShipGroups(pirate).push(sg);
        const [a, b] = ships;
        a.firepowerRaw = 10;
        b.firepowerRaw = 50;
        shipGroupAddShipToFleet(galaxy, sg, a);
        shipGroupAddShipToFleet(galaxy, sg, b);
        expect(sg.leadShip).toBe(a);
        expect(a.shipGroup).toBe(sg);
        expect(a.attackRangeSquared).toBe(sg.attackRangeSquared);
        // Re-adding is a no-op.
        shipGroupAddShipToFleet(galaxy, sg, a);
        expect(sg.ships).toEqual([a, b]);
        leaveShipGroup(galaxy, a);
        expect(a.shipGroup).toBeNull();
        expect(sg.leadShip).toBe(b); // Update() → DetermineLeadShip: strongest remaining ship
        leaveShipGroup(galaxy, b);
        expect(sg.ships.length).toBe(0);
        expect(empireShipGroups(pirate).includes(sg)).toBe(false);
    });

    it('DetermineLeadShip takes the strongest ship in the index cell holding most of the fleet (2598-2710)', () => {
        const sg = new ShipGroup(galaxy);
        sg.empire = pirate;
        const [a, b, c] = ships;
        for (const s of [a, b, c]) shipGroupAddShipToFleet(galaxy, sg, s);
        b.xpos = a.xpos + 100;
        b.ypos = a.ypos;
        // c is the strongest but alone in a far index cell: with 2/3 > 0.4 of the fleet in a's cell it is skipped.
        c.xpos = a.xpos + 3 * 400000;
        c.ypos = a.ypos;
        a.firepowerRaw = 10;
        b.firepowerRaw = 20;
        c.firepowerRaw = 1000;
        shipGroupDetermineLeadShip(galaxy, sg, null);
        expect(sg.leadShip).toBe(b);
        shipGroupDetermineLeadShip(galaxy, sg, b); // shipToExclude
        expect(sg.leadShip).toBe(a);
    });

    it('WarpSpeed is the slowest non-building ship times the hyperjump bonus; IsShipAvailable excludes repair missions (3241, 3570)', () => {
        const sg = new ShipGroup(galaxy);
        const [a, b] = ships;
        shipGroupAddShipToFleet(galaxy, sg, a);
        shipGroupAddShipToFleet(galaxy, sg, b);
        a.warpSpeed = 3000;
        b.warpSpeed = 2000;
        sg.hyperjumpSpeedBonusBase = 1.5;
        expect(shipGroupWarpSpeed(sg)).toBe(3000);
        expect(shipGroupIsShipAvailable(a)).toBe(true);
        a.mission = new BuiltObjectMission(galaxy, a, BuiltObjectMissionType.Repair, null, null, BuiltObjectMissionPriority.Normal);
        a.mission = Object.assign(a.mission as BuiltObjectMission, { type: BuiltObjectMissionType.Repair });
        expect(shipGroupIsShipAvailable(a)).toBe(false);
    });

    it('ReviewAdmiralBonuses resets every bonus to 1.0 with no admirals (232)', () => {
        const sg = new ShipGroup(galaxy);
        sg.empire = pirate;
        sg.weaponsRangeBonusBase = 3;
        sg.hyperjumpSpeedBonusBase = 2;
        shipGroupReviewAdmiralBonuses(galaxy, sg);
        expect([sg.weaponsRangeBonusBase, sg.hyperjumpSpeedBonusBase, sg.targetingBonusBase]).toEqual([1, 1, 1]);
    });

    it('CompareTo orders by SortTag, then culture-sensitive Name (3574)', () => {
        const mk = (name: string, tag: number): ShipGroup => Object.assign(new ShipGroup(galaxy), { name, sortTag: tag });
        const list = [mk('2nd Fleet', 0), mk('10th Fleet', 0), mk('1st Fleet', 1), mk('1st Strike Force', 0)];
        list.sort(compareShipGroups);
        expect(list.map((s) => s.name)).toEqual(['10th Fleet', '1st Strike Force', '2nd Fleet', '1st Fleet']);
        expect(shipGroupListOrderByName(list).map((s) => s.name)).toEqual(['10th Fleet', '1st Fleet', '1st Strike Force', '2nd Fleet']);
        list[0].shipTargetAmount = 15;
        expect(shipGroupListCountLargeFleets(list)).toBe(1);
    });
});

describe('fleet missions (ShipGroup.cs AssignMission 2097, CheckForMissionCompletion 516)', () => {
    it('AssignMission gives every available ship the fleet mission with a SelectRelativePoint offset and sets attack ranges', () => {
        const sg = new ShipGroup(galaxy);
        sg.empire = pirate;
        const [a, b] = ships;
        shipGroupAddShipToFleet(galaxy, sg, a);
        shipGroupAddShipToFleet(galaxy, sg, b);
        const target = pirate.pirateEmpireBaseHabitat!;
        const ok = shipGroupAssignMission(galaxy, sg, BuiltObjectMissionType.Attack, target, null, BuiltObjectMissionPriority.High, false);
        expect(ok).toBe(true);
        expect(sg.mission!.type).toBe(BuiltObjectMissionType.Attack);
        for (const s of [a, b]) {
            const m = builtObjectMission(s.mission)!;
            expect(m.type).toBe(BuiltObjectMissionType.Attack);
            expect(m.isShipGroupMission).toBe(true);
            // SetAttackRange: Attack uses AttackRangeAttack (2000) → 2000² as float.
            expect(s.attackRangeSquared).toBe(Math.fround(pirate.attackRangeAttack * pirate.attackRangeAttack));
        }
        expect(sg.attackRangeSquared).toBe(Math.fround(pirate.attackRangeAttack * pirate.attackRangeAttack));
        // No target and no coordinates → false, fleet mission untouched.
        expect(shipGroupAssignMission(galaxy, sg, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.Normal, false)).toBe(false);
    });

    it('a Move to a star draws the parking offset (NextDouble ×2) before the fleet mission', () => {
        const sg = new ShipGroup(galaxy);
        sg.empire = pirate;
        shipGroupAddShipToFleet(galaxy, sg, ships[0]);
        const star = ships[0].nearestSystemStar!;
        const before = galaxy.rnd.drawCount;
        shipGroupAssignMission(galaxy, sg, BuiltObjectMissionType.Move, star, null, BuiltObjectMissionPriority.Normal, false);
        // ≥ 2 (star offset) + 2 (the ship's SelectRelativePoint) draws; ResolveCommandsForMission may add more.
        expect(galaxy.rnd.drawCount - before).toBeGreaterThanOrEqual(4);
        expect(sg.mission!.targetHabitat).toBe(star);
        expect(shipGroupIdentifyFleetLocation(sg)).toBe(star);
    });

    it('a Hold mission completes once its star date passes and clears the ships (1053)', () => {
        const sg = new ShipGroup(galaxy);
        sg.empire = pirate;
        const [a, b] = ships;
        shipGroupAddShipToFleet(galaxy, sg, a);
        shipGroupAddShipToFleet(galaxy, sg, b);
        const star = a.nearestSystemStar!;
        shipGroupAssignMission(galaxy, sg, BuiltObjectMissionType.Hold, star, null, BuiltObjectMissionPriority.Normal, false, null, galaxyStarDate(galaxy) + 1000);
        expect(sg.mission!.type).toBe(BuiltObjectMissionType.Hold);
        checkForMissionCompletion(galaxy, sg);
        expect(sg.mission!.type).toBe(BuiltObjectMissionType.Hold);
        galaxy.nowMs += 2000;
        const held = sg.mission!;
        checkForMissionCompletion(galaxy, sg);
        expect(held.type).toBe(BuiltObjectMissionType.Undefined);
    });

    it('CheckRefuelRepairAttack sends damaged ships to repair (stubbed) and drops them from the fleet (1675-1694)', () => {
        const sg = new ShipGroup(galaxy);
        sg.empire = pirate;
        empireShipGroups(pirate).push(sg);
        const [a, b] = ships;
        shipGroupAddShipToFleet(galaxy, sg, a);
        shipGroupAddShipToFleet(galaxy, sg, b);
        a.isAutoControlled = b.isAutoControlled = true;
        pirate.controlMilitaryFleets = true;
        b.damagedComponentCount = 2;
        checkRefuelRepairAttack(galaxy, sg, false, null);
        expect(b.shipGroup).toBeNull();
        expect(sg.ships).toEqual([a]);
    });
});

describe('Empire.9.cs 2472 MaintainShipGroups', () => {
    it('forms a "1st Fleet" from idle warships, gathers it and sends each ship there', () => {
        pirate.controlMilitaryFleets = true;
        for (const s of ships) s.isAutoControlled = true;
        expect(empireShipGroups(pirate).length).toBe(0);
        const before = galaxy.rnd.drawCount;
        maintainShipGroups(galaxy, pirate);
        const groups = empireShipGroups(pirate);
        expect(groups.length).toBe(1);
        const sg = groups[0]!;
        expect(sg.name).toBe('1st Fleet');
        expect(sg.empire).toBe(pirate);
        expect(sg.ships.length).toBe(ships.length);
        expect(sg.shipTargetAmount).toBe(pirate.policy!.fleetTypicalSize);
        for (const s of ships) expect(s.shipGroup).toBe(sg);
        // Each added ship gets AssignFleetWaypointMission (SelectRelativeParkingPoint: 3 draws) — plus SelectFleetBase's
        // SelectRandomSpacePort Next(0, n) when the fleet has no gather point yet.
        expect(galaxy.rnd.drawCount - before).toBeGreaterThanOrEqual(3 * ships.length);
        if (sg.gatherPoint !== null) {
            for (const s of ships) {
                const m = builtObjectMission(s.mission)!;
                expect(m.type).toBe(BuiltObjectMissionType.Move);
                expect(m.priority).toBe(BuiltObjectMissionPriority.Low);
            }
        }
        // A second pass tops the fleet up but creates no new fleet (num8 >= num14).
        maintainShipGroups(galaxy, pirate);
        expect(empireShipGroups(pirate).length).toBe(1);
        updateFleetLeadShips(galaxy, pirate);
        expect(sg.ships.includes(sg.leadShip!)).toBe(true);
        expect(empireFleetMaximumCount(pirate)).toBe(Math.min(100, Math.max(30, Math.trunc(pirate.builtObjects.length / 10))));
        disbandShipGroup(galaxy, pirate, sg);
        expect(empireShipGroups(pirate).length).toBe(0);
        for (const s of ships) expect(s.shipGroup).toBeNull();
    });

    it('SortBuiltObjectsByDistance orders by squared distance (fuel filter ×100) (2737)', () => {
        const [a, b, c] = ships;
        a.xpos = 1000; a.ypos = 0;
        b.xpos = 200; b.ypos = 0;
        c.xpos = 500; c.ypos = 0;
        const list = [a, b, c];
        sortBuiltObjectsByDistance(galaxy, list, 0, 0);
        expect(list).toEqual([b, c, a]);
        b.currentFuel = 0;
        sortBuiltObjectsByDistance(galaxy, list, 0, 0, 0.5);
        expect(list).toEqual([c, a, b]); // b: 200² × 100 = 4e6 > a's 1e6
    });
});

describe('BuiltObject fleet methods (BuiltObject.cs 1906 / 3503)', () => {
    it('ReviewFleetBonuses takes the best fleet modifiers within 2000 of the ship', () => {
        const sg = new ShipGroup(galaxy);
        const [a, b, c] = ships;
        for (const s of [a, b, c]) shipGroupAddShipToFleet(galaxy, sg, s);
        b.xpos = a.xpos + 1500;
        b.ypos = a.ypos;
        c.xpos = a.xpos + 2500;
        c.ypos = a.ypos;
        b.fleetTargettingModifier = 10;
        c.fleetTargettingModifier = 30;
        c.fleetCountermeasureModifier = 25;
        reviewFleetBonuses(galaxy, a);
        expect([a.fleetTargettingBonus, a.fleetCountermeasureBonus]).toEqual([10, 0]);
    });

    it('PerformFleetTasks sends an idle follower more than 5000 from the lead ship back to it (SelectRelativePoint: 2 draws)', () => {
        const sg = new ShipGroup(galaxy);
        sg.empire = pirate;
        const [a, b] = ships;
        shipGroupAddShipToFleet(galaxy, sg, a);
        shipGroupAddShipToFleet(galaxy, sg, b);
        a.mission = null;
        b.mission = null;
        b.troopCapacity = 0;
        b.xpos = a.xpos + 6000;
        b.ypos = a.ypos;
        const before = galaxy.rnd.drawCount;
        performFleetTasks(galaxy, b);
        const m = builtObjectMission(b.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Move);
        expect(m.priority).toBe(BuiltObjectMissionPriority.Normal);
        expect(galaxy.rnd.drawCount - before).toBeGreaterThanOrEqual(2);
        // The lead ship itself is never sent.
        a.xpos += 10000;
        performFleetTasks(galaxy, a);
        expect(a.mission).toBeNull();
    });
});

describe('ShipGroup.DoTasks with a real fleet (ShipGroup.cs 97)', () => {
    it('runs the ported subroutines without throwing and keeps the fleet consistent', () => {
        pirate.controlMilitaryFleets = true;
        for (const s of ships) s.isAutoControlled = true;
        maintainShipGroups(galaxy, pirate);
        const sg = empireShipGroups(pirate)[0]!;
        sg.lastTouch = sg.lastPeriodicTouch = 0;
        shipGroupDoTasks(galaxy, sg, galaxy.nowMs + 60000);
        for (const s of sg.ships) expect(s.shipGroup).toBe(sg);
        expect(sg.leadShip === null || sg.ships.includes(sg.leadShip)).toBe(true);
    });
});
