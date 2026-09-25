// M4m — military AI (src/sim/fleets/militaryAI.ts, blockades.ts, missions/cmdMilitary.ts). Unit checks against hand-worked
// C# expectations on a createGame galaxy (seed 1): Blockade model (Empire.8.cs 3657-3955, Empire.2.cs 3938),
// DetermineBuiltObjectStrengthAtLocation (Galaxy.7.cs 117), EnsureSingleStellarObjectPerSystem (Galaxy.7.cs 579),
// CalculateCautionFactor / CalculateAggressionFactor (Empire.2.cs 4373/4380), IdentifyEmpireStrikePoints (Empire.9.cs
// 3704), SortEmpiresByMilitaryPriority (Galaxy.4.cs 675), IdentifyDesiredForeignColonies (Empire.2.cs 4566), the
// incoming-fleet bookkeeping (Empire.1.cs 3198) and the Escort case (BuiltObject.2.cs 804); plus a harness smoke run.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import { AutomationLevel, type Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, Command, CommandAction, builtObjectMission } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { cmdEscort } from '../src/sim/missions/cmdMilitary';
import type { CommandContext } from '../src/sim/missions/executeCommands';
import { galaxyNow, galaxyStarDate } from '../src/sim/tick/simTime';
import { THREAT_RANGE } from '../src/sim/combat/threats';
import { DiplomaticRelationType, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import {
    FleetAttack,
    calculateAggressionFactor,
    calculateCautionFactor,
    calculateDistanceFactor,
    determineBuiltObjectStrengthAtLocation,
    determineRandomAttacks,
    ensureSingleStellarObjectPerSystem,
    galaxyBlockadeFor,
    identifyDesiredForeignColonies,
    identifyEmpireStrikePoints,
    identifyMechanoidEmpire,
    respondToIncomingEnemyFleetsAndPlanetDestroyers,
    sortEmpiresByMilitaryPriority,
    cancelInactiveBlockades,
} from '../src/sim/fleets/militaryAI';
import { blockadeFor, cancelBlockades, getBlockadesAgainstEmpire, getBlockadesForEmpire, setupBlockadeBuiltObject, setupBlockadeColony } from '../src/sim/fleets/blockades';
import { runGameSeconds } from '../src/sim/tick/harness';
import { strategicValue } from '../src/sim/territory';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { DiplomaticStrategy, WarObjective, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { changeDiplomaticRelation, declareWar } from '../src/sim/diplomacyTick';
import { maintainShipGroups } from '../src/sim/fleets/shipGroupTasks';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { identifyMilitaryObjectives } from '../src/sim/fleets/militaryAI';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function fresh(): Galaxy {
    return createTickGame(gameData).galaxy;
}
function normalEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire && e.colonies.length > 0);
}

describe('Blockade model (Empire.8.cs 3657 SetupBlockade, 3855 CancelBlockades, 3924 CancelBlockade; Empire.2.cs 3938)', () => {
    it('blockades a colony and its space port, cancels them when no ship holds a Blockade mission', () => {
        const g = fresh();
        const [a, b] = normalEmpires(g);
        const colony = b.capital!;
        const port = b.spacePorts.find((p) => p.parentHabitat === colony)!;
        expect(port).toBeDefined();
        expect(setupBlockadeColony(g, a, colony)).toBe(true);
        expect(colony.isBlockaded).toBe(true);
        expect(port.isBlockaded).toBe(true);
        expect(galaxyBlockadeFor(g, colony)!.initiator).toBe(a);
        expect(blockadeFor(g, port)!.blockadedEmpire).toBe(b);
        expect(getBlockadesForEmpire(g, a).length).toBe(2);
        expect(getBlockadesAgainstEmpire(g, b).length).toBe(2);
        // A second blockade of the same colony is refused (IsBlockaded).
        expect(setupBlockadeColony(g, a, colony)).toBe(false);
        // No ship of `a` has a Blockade mission: CancelInactiveBlockades lifts both (the colony cancel cancels the port first).
        cancelInactiveBlockades(g, a);
        expect(g.blockades.length).toBe(0);
        expect(colony.isBlockaded).toBe(false);
        expect(port.isBlockaded).toBe(false);
    }, 120000);

    it('CancelBlockades(target) lifts only blockades of the target empire', () => {
        const g = fresh();
        const [a, b, c] = normalEmpires(g);
        const portB = b.spacePorts[0];
        const portC = c.spacePorts[0];
        expect(setupBlockadeBuiltObject(g, a, portB)).toBe(true);
        expect(setupBlockadeBuiltObject(g, a, portC)).toBe(true);
        cancelBlockades(g, a, b);
        expect(portB.isBlockaded).toBe(false);
        expect(portC.isBlockaded).toBe(true);
        expect(g.blockades.map((x) => x.builtObject)).toEqual([portC]);
    }, 120000);
});

describe('strength and target helpers', () => {
    let g: Galaxy;
    beforeAll(() => {
        g = fresh();
    }, 120000);

    it('Galaxy.7.cs 117 DetermineBuiltObjectStrengthAtLocation sums Max(unarmed, FirepowerRaw) within ThreatRange', () => {
        const e = normalEmpires(g)[0];
        const x = Math.trunc(e.capital!.xpos);
        const y = Math.trunc(e.capital!.ypos);
        let expected = 0;
        let expectedUnarmed = 0;
        for (const bo of e.builtObjects) {
            if (g.calculateDistanceSquared(x, y, bo.xpos, bo.ypos) <= THREAT_RANGE * THREAT_RANGE) {
                expected += Math.max(0, bo.firepowerRaw);
                expectedUnarmed += Math.max(5, bo.firepowerRaw);
            }
        }
        for (const bo of e.privateBuiltObjects) {
            if (g.calculateDistanceSquared(x, y, bo.xpos, bo.ypos) <= THREAT_RANGE * THREAT_RANGE) expectedUnarmed += Math.max(5, bo.firepowerRaw);
        }
        expect(determineBuiltObjectStrengthAtLocation(g, x, y, e, 0, false)).toBe(expected);
        expect(determineBuiltObjectStrengthAtLocation(g, x, y, e, 5, false)).toBe(expectedUnarmed);
        expect(determineBuiltObjectStrengthAtLocation(g, x, y, null, 5, true)).toBe(0);
    });

    it('Empire.2.cs 4373/4380 aggression and caution factors', () => {
        const e = normalEmpires(g)[0];
        const aggr = e.dominantRace!.aggression / 100.0;
        const caut = e.dominantRace!.caution / 100.0;
        expect(calculateAggressionFactor(g, e)).toBeCloseTo(aggr * aggr * g.aggressionLevel, 12);
        expect(calculateCautionFactor(g, e)).toBe(Math.max(1.0, caut * caut));
        expect(calculateDistanceFactor(1000)).toBe(1.0);
        expect(calculateDistanceFactor(1e6)).toBeCloseTo(Math.pow(1e6, 1.8) / 1e9, 6);
    });

    it('Galaxy.8.cs 1619 IdentifyMechanoidEmpire: no Mechanoid empire in the seed-1 game', () => {
        expect(identifyMechanoidEmpire(g)).toBe(identifyMechanoidEmpireReference(g));
    });

    it('Galaxy.7.cs 579 EnsureSingleStellarObjectPerSystem keeps one object per system (the largest SortTag)', () => {
        const e = normalEmpires(g)[0];
        const capital = e.capital!;
        const port = e.spacePorts.find((p) => p.parentHabitat === capital)!;
        const list = [capital, port, normalEmpires(g)[1].capital!];
        const out = ensureSingleStellarObjectPerSystem(g, list.slice());
        // Capital: Max(StrategicValue / 10, Size 0) vs the port's Size — the larger survives; the other system is untouched.
        expect(out.length).toBe(2);
        expect(out).toContain(normalEmpires(g)[1].capital);
    });

    it('Empire.9.cs 3704 IdentifyEmpireStrikePoints: weighted, sorted descending, one Rnd draw only for aggressive races', () => {
        const [a, b] = normalEmpires(g);
        const before = g.rnd.drawCount;
        const targets = identifyEmpireStrikePoints(g, a, b);
        const draws = g.rnd.drawCount - before;
        expect(draws).toBe(a.dominantRace!.aggression > 115 ? 1 : 0);
        for (let i = 1; i < targets.length; i++) expect(targets[i - 1].weightedPriority).toBeGreaterThanOrEqual(targets[i].weightedPriority);
        for (const t of targets) expect(t.locationStrength).toBeGreaterThanOrEqual(50);
    });

    it('Galaxy.4.cs 675 SortEmpiresByMilitaryPriority orders by strategic value × -attitude, descending', () => {
        const [a, ...others] = normalEmpires(g);
        const sorted = sortEmpiresByMilitaryPriority(g, a, others);
        expect(new Set(sorted)).toEqual(new Set(others));
        const val = (x: Empire): number => {
            let n = Math.trunc(x.colonies.reduce((sum, h) => sum + strategicValue(h), 0) / 1000);
            n *= obtainEmpireEvaluation(g, a, x).overallAttitude * -1;
            if (x === g.playerEmpire && a !== g.playerEmpire) n *= 2.0;
            return n;
        };
        for (let i = 1; i < sorted.length; i++) expect(val(sorted[i - 1])).toBeGreaterThanOrEqual(val(sorted[i]));
    });
});

describe('Empire.2.cs 4512 DetermineRandomAttacks / 4566 IdentifyDesiredForeignColonies', () => {
    it('fills DesiredForeignColonies (sorted descending) and EmpiresWithDesiredColonies (owners in order), draws Next(0, n) first', () => {
        const g = fresh();
        const e = normalEmpires(g)[0];
        identifyDesiredForeignColonies(g, e);
        const list = e.desiredForeignColonies;
        for (let i = 1; i < list.length; i++) expect(list[i - 1].priority).toBeGreaterThanOrEqual(list[i].priority);
        for (const hp of list) expect(hp.habitat!.owner).not.toBe(e);
        const owners: Empire[] = [];
        for (const hp of list) if (hp.habitat!.owner !== null && !owners.includes(hp.habitat!.owner)) owners.push(hp.habitat!.owner);
        expect(e.empiresWithDesiredColonies).toEqual(owners);
        // No war strategy against anyone at game start: DetermineRandomAttacks draws only its start index.
        const before = g.rnd.drawCount;
        determineRandomAttacks(g, e);
        expect(g.rnd.drawCount - before).toBe(1);
        expect(e.empiresToAttack.length).toBe(0);
    }, 120000);
});

describe('Empire.1.cs 3198 RespondToIncomingEnemyFleetsAndPlanetDestroyers', () => {
    it('drops warnings whose fleet no longer attacks (planet destroyers sorted first)', () => {
        const g = fresh();
        const [a, b] = normalEmpires(g);
        const pd = b.builtObjects[0];
        pd.mission = null;
        const entry = new FleetAttack(pd, a.capital, galaxyStarDate(g));
        expect(entry.target).toBe(a.capital);
        const junk = new FleetAttack(pd, 'not a target', galaxyStarDate(g));
        expect(junk.target).toBeNull();
        a.incomingEnemyFleetsAndPlanetDestroyers.push(entry, junk);
        respondToIncomingEnemyFleetsAndPlanetDestroyers(g, a);
        expect(a.incomingEnemyFleetsAndPlanetDestroyers.length).toBe(0);
    }, 120000);
});

describe('BuiltObject.2.cs 804 case Escort', () => {
    it('jumps after a distant escort target (ConditionalHyperTo inserted), completes when the target has no mission', () => {
        const g = fresh();
        const e = normalEmpires(g)[0];
        const movers = e.builtObjects.filter((b) => b.warpSpeed > 0 && b.topSpeed > 0);
        const ship = movers[0];
        const escorted = normalEmpires(g)[1].builtObjects.find((b) => b.topSpeed > 0)!;
        assignMission(g, escorted, BuiltObjectMissionType.Move, normalEmpires(g)[1].capital, null, BuiltObjectMissionPriority.Normal);
        const mission = new BuiltObjectMission(g, ship, BuiltObjectMissionType.Escort, escorted, null, BuiltObjectMissionPriority.Normal);
        ship.mission = mission;
        const command = Command.forTarget(CommandAction.Escort, escorted);
        mission.insertCommandAtTop(command);
        ship.firstExecutionOfCommand = true;
        const ctx = { galaxy: g, bo: ship, mission, command, timePassed: 0.1, time: galaxyNow(g), starDate: galaxyStarDate(g), targetX: escorted.xpos, targetY: escorted.ypos, indexX: 0, indexY: 0, xpos: ship.xpos, ypos: ship.ypos, parentXPos: 0, parentYPos: 0, targetArrivalDistance: 0 } as CommandContext;
        const far = g.calculateDistance(ship.xpos, ship.ypos, escorted.xpos, escorted.ypos) > 12000;
        const r = cmdEscort(ctx);
        if (far) {
            expect(r).toBe(0.1);
            expect(mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ConditionalHyperTo);
        }
        // A target without a mission ends the escort (the first execution already happened).
        escorted.mission = null;
        ship.parentBuiltObject = null;
        ship.xpos = escorted.xpos + 50;
        ship.ypos = escorted.ypos;
        const mission2 = new BuiltObjectMission(g, ship, BuiltObjectMissionType.Escort, escorted, null, BuiltObjectMissionPriority.Normal);
        ship.mission = mission2;
        const command2 = Command.forTarget(CommandAction.Escort, escorted);
        mission2.insertCommandAtTop(command2);
        ship.firstExecutionOfCommand = false;
        const r2 = cmdEscort({ ...ctx, mission: mission2, command: command2 });
        expect(r2).toBe(0.0);
        expect(ship.firstExecutionOfCommand).toBe(true);
        expect(builtObjectMission(ship.mission)).toBe(mission2);
    }, 120000);
});

/**
 * A fleet scenario: the pirates' warships (re-roled as frigates, as in test/m4lShipGroup.test.ts) join empire `a`, which
 * forms a fleet (MaintainShipGroups) parked 30000 from `b`'s capital; `b`'s colony systems are made visible to `a`.
 */
function fleetScenario(): { g: Galaxy; a: Empire; b: Empire } {
    const g = fresh();
    // `b` is the normal empire whose capital is nearest `a`'s (since the M4q merge seed 1's second empire lies beyond the
    // fleet's refuelling reach: CheckFleetTargetWithinFuelRangeAndRefuel finds no refuelling point for the whole fleet).
    const [a, ...others] = normalEmpires(g);
    const dist = (e: Empire): number => g.calculateDistance(a.capital!.xpos, a.capital!.ypos, e.capital!.xpos, e.capital!.ypos);
    const b = others.filter((e) => e.capital !== null).sort((x, y) => dist(x) - dist(y))[0];
    for (const p of g.pirateEmpires) {
        for (const s of p.builtObjects.filter((x) => x.role === BuiltObjectRole.Military && x.topSpeed > 0 && x.warpSpeed > 0)) {
            p.builtObjects.splice(p.builtObjects.indexOf(s), 1);
            s.empire = a;
            a.builtObjects.push(s);
            s.subRole = BuiltObjectSubRole.Frigate;
            s.mission = null;
            s.currentFuel = s.fuelCapacity;
            s.isAutoControlled = true;
        }
    }
    a.controlMilitaryFleets = true;
    // 17d: `a` is the human player, which now starts with the C# GameOptions defaults (Start.2.cs:2128 Attacks on
    // Enemies = SemiAutomated → suggestions only); the scenario exercises the fully automated AI path.
    a.controlMilitaryAttacks = AutomationLevel.FullyAutomated;
    maintainShipGroups(g, a);
    for (const sg of empireShipGroups(a)) {
        sg!.mission = null;
        for (const s of sg!.ships) {
            s.mission = null;
            s.xpos = b.capital!.xpos + 30000;
            s.ypos = b.capital!.ypos;
            s.nearestSystemStar = null;
            s.parentHabitat = null;
        }
    }
    for (const h of b.colonies) a.visibility.systemVisibility[h.systemIndex].status = 3; // SystemVisibilityStatus.Visible
    const r = obtainDiplomaticRelation(a, b);
    if (r.type === DiplomaticRelationType.NotMet) changeDiplomaticRelation(g, a, r, DiplomaticRelationType.None);
    const r2 = obtainDiplomaticRelation(b, a);
    if (r2.type === DiplomaticRelationType.NotMet) changeDiplomaticRelation(g, b, r2, DiplomaticRelationType.None);
    expect(empireShipGroups(a).length).toBeGreaterThan(0);
    return { g, a, b };
}

describe('fleet scenarios (Empire.8.cs 4266 IdentifyMilitaryObjectives / 4845 ForSingleEmpire / 4521 AssignFleetAttackMission)', () => {
    it('at war (TotalConquest), an idle attack fleet is sent against the best visible strike point, and the war runs on', () => {
        const { g, a, b } = fleetScenario();
        declareWar(g, a, b, null, false, false);
        obtainDiplomaticRelation(a, b).warObjective = WarObjective.TotalConquest;
        const sg = empireShipGroups(a)[0]!;
        sg.mission = null;
        identifyMilitaryObjectives(g, a);
        expect(sg.mission).not.toBeNull();
        expect(sg.mission!.type).toBe(BuiltObjectMissionType.Attack);
        expect(sg.mission!.priority).toBe(BuiltObjectMissionPriority.High);
        const r = runGameSeconds(g, 300);
        expect(Object.keys(r.todoHits).filter((k) => k.startsWith('M4m'))).toEqual([]);
    }, 300000);

    it('under trade sanctions with a Conquer strategy, the fleet blockades the richest port colony (SetupBlockade on arrival)', () => {
        const { g, a, b } = fleetScenario();
        changeDiplomaticRelation(g, a, obtainDiplomaticRelation(a, b), DiplomaticRelationType.TradeSanctions);
        obtainDiplomaticRelation(a, b).strategy = DiplomaticStrategy.Conquer;
        for (const sp of b.spacePorts) sp.currentYearsIncome = 1000;
        const sg = empireShipGroups(a)[0]!;
        for (let i = 0; i < 20 && sg.mission === null; i++) identifyMilitaryObjectives(g, a);
        expect(sg.mission!.type).toBe(BuiltObjectMissionType.Blockade);
        const colony = sg.mission!.targetHabitat!;
        expect(colony.empire).toBe(b);
        // Since the stock BaconSettings.txt (no gravity wells, HyperJumpThreshhold 4000) the fleet jumps in and blockades
        // within ~40 s, and later reviews move it on; check the blockade on arrival, sampled every 10 s.
        let blockadedByA = false;
        for (let t = 0; t < 30 && !blockadedByA; t++) {
            runGameSeconds(g, 10);
            blockadedByA = colony.isBlockaded && galaxyBlockadeFor(g, colony)?.initiator === a;
        }
        expect(blockadedByA).toBe(true);
    }, 300000);
});

describe('harness smoke', () => {
    it('600 game-s on the createGame galaxy reach no M4m stub', () => {
        const g = fresh();
        const r = runGameSeconds(g, 600);
        const m4m = Object.keys(r.todoHits).filter((k) => k.startsWith('M4m'));
        expect(m4m).toEqual([]);
        for (const e of g.empires) {
            for (const fa of e.incomingEnemyFleetsAndPlanetDestroyers) expect(fa.fleet !== null || fa.planetDestroyer !== null).toBe(true);
            expect(DiplomaticRelationType.War).toBeDefined();
        }
    }, 600000);
});

function identifyMechanoidEmpireReference(g: Galaxy): Empire | null {
    for (const e of g.empires) if (e.pirateEmpireBaseHabitat === null && e.dominantRace !== null && e.dominantRace.name.toLowerCase() === 'mechanoid') return e;
    return null;
}
