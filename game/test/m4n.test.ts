// M4n — threat evaluation & ship attack AI (src/sim/combat/threats.ts, attackAI.ts, missions/cmdAttack.ts). Unit checks
// against hand-worked C# expectations (Galaxy.7.cs threat levels, BuiltObject.1/2.cs attack AI, BaconBuiltObject.cs
// IdentifySystemThreatsToUs) on a createGame galaxy (seed 1), plus a harness smoke run.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import type { GameData } from '../src/sim/data/gameData';
import { BattleTactics, BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectStance } from '../src/sim/design';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { runGameSeconds } from '../src/sim/tick/harness';
import { MIN_TIME } from '../src/sim/tick/simTime';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, Command, CommandAction } from '../src/sim/missions/mission';
import type { CommandContext } from '../src/sim/missions/executeCommands';
import { empireDistressSignals } from '../src/sim/missions/distress';
import { cmdAttackBombardCaptureRaid } from '../src/sim/missions/cmdAttack';
import {
    ATTACK_OVERMATCH_FACTOR,
    THREAT_RANGE,
    calculateFirepowerFactor,
    calculateOverallStrengthFactor,
    calculateOverallStrengthFactorWithoutShields,
    calculateShieldStrengthFactor,
    determineRawThreatLevel,
    determineThreatLevelBuiltObject,
    evaluateAdequateAttackers,
    evaluateSystemThreats,
    evaluateThreats,
    identifySystemThreatsToUs,
    performThreatEvaluation,
} from '../src/sim/combat/threats';
import {
    determineAngle,
    determineDestroyOrCaptureTarget,
    determineTargetSpeed,
    setAttackRangeWhenNoMission,
    setOptimalAttackRanges,
    shouldAttack,
} from '../src/sim/combat/attackAI';

let gameData: GameData;
let galaxy: Galaxy;
let shipA: BuiltObject;
let shipB: BuiltObject;
let sameEmpireShip: BuiltObject;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = createTickGame(gameData).galaxy;
    // The createGame empires start with no military ships (tech level 0.5, civilian + base only); the pirate factions do.
    const military = (e: number) => galaxy.pirateEmpires[e].builtObjects.find((b) => b.role === BuiltObjectRole.Military && b.warpSpeed > 0 && b.firepowerRaw > 0 && b.isFunctional && b.topSpeed > 0)!;
    shipA = military(0);
    shipB = military(1);
    sameEmpireShip = galaxy.pirateEmpires[0].builtObjects.find((b) => b !== shipA && b.role === BuiltObjectRole.Military)!;
    // Put B in A's system, 1000 units away, and in A's index cell (the C# index is maintained by movement, M4c).
    shipB.xpos = shipA.xpos + 1000;
    shipB.ypos = shipA.ypos;
    shipB.nearestSystemStar = shipA.nearestSystemStar;
    const cell = galaxy.resolveIndex(shipA.xpos, shipA.ypos);
    if (!galaxy.builtObjectIndexGrid[cell.x][cell.y].includes(shipB)) galaxy.builtObjectIndexGrid[cell.x][cell.y].push(shipB);
    // Pirate factions rate each other by PirateRelation (Galaxy.7.cs 3706-3718: ×50 unless Protection); None avoids the
    // NotMet first-contact side effects in the assertions below.
    obtainPirateRelation(shipA.empire!, shipB.empire!).type = PirateRelationType.None;
    obtainPirateRelation(shipB.empire!, shipA.empire!).type = PirateRelationType.None;
}, 180000);
/** Galaxy.7.cs 3706-3718 / 3826-3840: the pirate-vs-pirate relation factor (PirateRelationType.None). */
const PIRATE_RELATION_FACTOR = 50;

/** Galaxy.7.cs 3688-3692: ((ThreatRange/2 − distance)²) / 1e6. */
function distanceFactor(distance: number): number {
    const num4 = Math.max(1.0, THREAT_RANGE / 2.0 - distance);
    return (num4 * num4) / 1000000.0;
}
/** Galaxy.7.cs 3785-3792: the size factor of a BuiltObject threat. */
function sizeFactor(b: BuiltObject): number {
    let num6 = 1;
    if (b.firepowerRaw > 0) num6 = Math.max(10, Math.trunc(b.size / 10));
    if (b.fighters !== null && b.fighters.length > 0) num6 = Math.max(num6, b.fighters.length * 10);
    return num6;
}

describe('BuiltObject.1.cs 2263-2308 strength factors', () => {
    it('CalculateFirepowerFactor accumulates RawDamage / (FireRate / 1000f) in float and truncates', () => {
        let num = 0;
        for (const w of shipA.weapons) num = Math.fround(num + Math.fround(Math.fround(w.rawDamage) / Math.fround(Math.fround(w.fireRate) / 1000)));
        expect(calculateFirepowerFactor(shipA)).toBe(Math.trunc(num));
        expect(calculateFirepowerFactor(shipA)).toBeGreaterThan(0);
    });
    it('CalculateOverallStrengthFactor = shields/20 + firepower + fighters; the Bacon no-shields variant is 0 for non-military', () => {
        expect(calculateShieldStrengthFactor(shipA)).toBe(Math.trunc(Math.fround(shipA.currentShields / 20)));
        expect(calculateOverallStrengthFactor(shipA)).toBe(calculateShieldStrengthFactor(shipA) + calculateFirepowerFactor(shipA));
        expect(calculateOverallStrengthFactorWithoutShields(galaxy, shipA)).toBe(calculateFirepowerFactor(shipA));
        const base = galaxy.empires[1].builtObjects.find((b) => b.role === BuiltObjectRole.Base)!;
        expect(base.firepowerRaw).toBeGreaterThan(0);
        expect(calculateOverallStrengthFactorWithoutShields(galaxy, base)).toBe(0);
    });
});

describe('Galaxy.7.cs threat levels', () => {
    it('DetermineThreatLevel(BuiltObject): pirate relation ×50, distance factor, size factor; 0 for own ships and out of range', () => {
        // The C# measures from the truncated (int) target coordinates.
        const d = Math.sqrt(galaxy.calculateDistanceSquared(shipB.xpos, shipB.ypos, Math.trunc(shipA.xpos), Math.trunc(shipA.ypos)));
        const expected = Math.max(1, Math.trunc(distanceFactor(d) * PIRATE_RELATION_FACTOR * sizeFactor(shipB)));
        expect(determineThreatLevelBuiltObject(galaxy, shipB, shipA, shipA.empire, Math.trunc(shipA.xpos), Math.trunc(shipA.ypos), THREAT_RANGE * THREAT_RANGE)).toBe(expected);
        expect(determineThreatLevelBuiltObject(galaxy, sameEmpireShip, shipA, shipA.empire, Math.trunc(shipA.xpos), Math.trunc(shipA.ypos), THREAT_RANGE * THREAT_RANGE)).toBe(0);
        // scanRangeSquared smaller than the distance² → 0.
        expect(determineThreatLevelBuiltObject(galaxy, shipB, shipA, shipA.empire, Math.trunc(shipA.xpos), Math.trunc(shipA.ypos), 999 * 999)).toBe(0);
    });
    it('DetermineRawThreatLevel: relation factor × size factor, no distance term', () => {
        expect(determineRawThreatLevel(galaxy, shipB, shipA.empire!)).toBe(PIRATE_RELATION_FACTOR * (shipB.firepowerRaw > 0 ? Math.max(10, Math.trunc(shipB.size / 10)) : 1));
        expect(determineRawThreatLevel(galaxy, sameEmpireShip, shipA.empire!)).toBe(0);
    });
    it('EvaluateThreats: B is the top threat of A, levels sorted descending, at most 20 entries', () => {
        const r = evaluateThreats(galaxy, shipA);
        expect(r.threats.length).toBe(r.threatLevels.length);
        expect(r.threats.length).toBeLessThanOrEqual(20);
        expect(r.threats[0]).toBe(shipB);
        for (let i = 1; i < r.threatLevels.length; i++) expect(r.threatLevels[i - 1]).toBeGreaterThanOrEqual(r.threatLevels[i]);
        const r2 = evaluateThreats(galaxy, shipA, 1);
        expect(r2.threats).toEqual([shipB]);
    });
    it('EvaluateSystemThreats: system-wide raw levels > 10 for foreign ships in the system', () => {
        const r = evaluateSystemThreats(galaxy, shipA.nearestSystemStar!, shipA.empire!);
        const i = r.threats.indexOf(shipB);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(r.threatLevels[i]).toBe(determineRawThreatLevel(galaxy, shipB, shipA.empire!));
        expect(r.threats.includes(sameEmpireShip)).toBe(false);
    });
});

describe('BaconBuiltObject.cs 4863 IdentifySystemThreatsToUs / BuiltObject.1.cs 208 PerformThreatEvaluation', () => {
    it('fills the SystemVisibility cache (5 s window) and the ship threat arrays; levels = distance factor × raw level', () => {
        const sv = shipA.empire!.systemVisibility[shipA.nearestSystemStar!.systemIndex];
        sv.latestThreatEvaluation = MIN_TIME;
        performThreatEvaluation(galaxy, shipA, 100000);
        expect(sv.latestThreatEvaluation).toBe(100000);
        expect(sv.threats.includes(shipB)).toBe(true);
        const raw = determineRawThreatLevel(galaxy, shipB, shipA.empire!);
        const sortTag = distanceFactor(1000) * raw;
        expect(shipA.threats![0]).toBe(shipB);
        expect(shipA.threatLevels![0]).toBe(Math.trunc(sortTag));
        expect(shipB.sortTag).toBe(sortTag);
        expect(shipA.threats!.length).toBeLessThanOrEqual(10);
        // Within the 5 s window the cache is not refreshed.
        sv.threats = [];
        sv.threatLevels = [];
        performThreatEvaluation(galaxy, shipA, 104000);
        expect(sv.latestThreatEvaluation).toBe(100000);
        expect(shipA.threats!.length).toBe(0);
        performThreatEvaluation(galaxy, shipA, 105001);
        expect(sv.latestThreatEvaluation).toBe(105001);
        expect(shipA.threats![0]).toBe(shipB);
    });
    it('totalThreatLevel sums max(1, SortTag / 1000) truncated, over the whole (filtered, sorted) list', () => {
        const r = identifySystemThreatsToUs(galaxy, shipA, shipA.nearestSystemStar!);
        expect(r.threats[0]).toBe(shipB);
        let total = 0;
        for (const level of r.threatLevels) total += Math.trunc(Math.max(1.0, Math.min(21474836.0, level / 1000.0)));
        // Only the first 10 are returned; the total covers every source entry, so it is at least the returned sum.
        expect(r.totalThreatLevel).toBeGreaterThanOrEqual(total);
        expect(shipA.totalThreatLevel).toBe(r.totalThreatLevel);
    });
});

describe('BuiltObject.1.cs 951 ShouldAttack / 930 EvaluateAdequateAttackers', () => {
    it('AttackEnemies stance: a pirate attacks an unprotected rival faction ship in the same system, never its own', () => {
        shipA.design.stance = BuiltObjectStance.AttackEnemies;
        shipA.mission = null;
        expect(shouldAttack(galaxy, shipA, shipB, 100000)).toBe(true);
        expect(shouldAttack(galaxy, shipA, sameEmpireShip, 100000)).toBe(false);
        shipB.nearestSystemStar = null;
        expect(shouldAttack(galaxy, shipA, shipB, 100000)).toBe(false);
        shipB.nearestSystemStar = shipA.nearestSystemStar;
        shipA.design.stance = BuiltObjectStance.DoNotAttack;
        expect(shouldAttack(galaxy, shipA, shipB, 100000)).toBe(false);
        shipA.design.stance = BuiltObjectStance.AttackEnemies;
    });
    it('EvaluateAdequateAttackers: no pursuers → inadequate; required = strength × empire overmatch factor + 1', () => {
        shipB.pursuers = [];
        const r = evaluateAdequateAttackers(galaxy, shipA, shipB);
        expect(r.adequate).toBe(false);
        expect(r.currentAssignedFirepower).toBe(0);
        expect(shipA.empire!.attackOvermatchFactor).toBe(2);
        expect(ATTACK_OVERMATCH_FACTOR).toBe(2.0);
    });
});

describe('BuiltObject.2.cs attack ranges', () => {
    it('SetOptimalAttackRanges Standoff: 0.65 / 0.9 of StandoffWeaponsMaxRange, clamped to PointBlank and min ≤ max − 10', () => {
        const saved = { tw: shipA.design.tacticsWeakerShips, ts: shipA.design.tacticsStrongerShips, so: shipA.standoffWeaponsMaxRange, beam: shipA.beamWeaponsMinRange };
        shipA.design.tacticsWeakerShips = BattleTactics.Standoff;
        shipA.design.tacticsStrongerShips = BattleTactics.Standoff;
        shipA.standoffWeaponsMaxRange = 1000;
        shipB.currentSpeed = 0;
        shipB.parentHabitat = null;
        shipB.parentBuiltObject = null;
        setOptimalAttackRanges(galaxy, shipA, shipB);
        expect(determineTargetSpeed(shipB)).toBe(0);
        expect(shipA.optimalMinimumAttackRange).toBe(650);
        expect(shipA.optimalMaximumAttackRange).toBe(900);
        // A moving target shrinks the maximum by its speed (900 − 260 = 640), but the maximum is then raised back to the
        // minimum (Math.Max(max, min) = 650) and the minimum clamped to max − 10 = 640 (BuiltObject.2.cs 191-193).
        shipB.currentSpeed = 260;
        setOptimalAttackRanges(galaxy, shipA, shipB);
        expect(shipA.optimalMaximumAttackRange).toBe(650);
        expect(shipA.optimalMinimumAttackRange).toBe(640);
        shipB.currentSpeed = 0;
        shipA.design.tacticsWeakerShips = saved.tw;
        shipA.design.tacticsStrongerShips = saved.ts;
        shipA.standoffWeaponsMaxRange = saved.so;
        shipA.beamWeaponsMinRange = saved.beam;
    });
    it('SetAttackRangeWhenNoMission: Empire.AttackRangeOther² (float) for automated ships, manual range when set', () => {
        shipA.mission = null;
        shipA.attackRangeSquared = 1;
        setAttackRangeWhenNoMission(galaxy, shipA);
        expect(shipA.attackRangeSquared).toBe(Math.fround(48000 * 48000));
        shipA.isAutoControlled = false;
        shipA.attackRangeSquared = 1;
        setAttackRangeWhenNoMission(galaxy, shipA); // AttackRangeOtherManual = -1 → unchanged (not < 0)
        expect(shipA.attackRangeSquared).toBe(1);
        shipA.empire!.attackRangeOtherManual = 3000;
        setAttackRangeWhenNoMission(galaxy, shipA);
        expect(shipA.attackRangeSquared).toBe(Math.fround(3000 * 3000));
        shipA.empire!.attackRangeOtherManual = -1;
        shipA.isAutoControlled = true;
    });
    it('DetermineAngle is atan2(dy, dx) with NaN → 0', () => {
        expect(determineAngle(0, 0, 1, 1)).toBe(Math.atan2(1, 1));
        expect(determineAngle(0, 0, 0, 0)).toBe(0);
    });
    it('DetermineDestroyOrCaptureTarget: no assault pods and nobody boarding → Attack', () => {
        expect(determineDestroyOrCaptureTarget(galaxy, shipA.empire!, shipA, shipB, false)).toBe(BuiltObjectMissionType.Attack);
    });
});

describe('BuiltObject.2.cs 1698 case Attack (missions/cmdAttack.ts)', () => {
    function ctx(command: Command, mission: BuiltObjectMission, over: Partial<CommandContext> = {}): CommandContext {
        mission.replaceCommandStack([command, new Command(CommandAction.ScanArea)]);
        return { galaxy, bo: shipA, mission, command, timePassed: 0.5, time: 200000, starDate: 200000, targetX: shipB.xpos, targetY: shipB.ypos, indexX: 0, indexY: 0, xpos: shipA.xpos, ypos: shipA.ypos, parentXPos: -2000000001.0, parentYPos: -2000000001.0, targetArrivalDistance: 0, ...over };
    }
    it('first execution: locks the target, raises a distress signal for the defender, full speed, result 0', () => {
        const mission = new BuiltObjectMission(galaxy, shipA, BuiltObjectMissionType.Attack, shipB, null, BuiltObjectMissionPriority.Normal, { starDate: 0, allowBuiltObjectChanges: false });
        const c = ctx(Command.forTarget(CommandAction.Attack, shipB), mission);
        shipA.mission = mission;
        shipA.firstExecutionOfCommand = true;
        shipA.currentTarget = null;
        shipA.attackers = [];
        const signalsBefore = empireDistressSignals(shipB.empire!).length;
        const result = cmdAttackBombardCaptureRaid(c);
        expect(result).toBe(0);
        expect(shipA.hyperDenyActive).toBe(true);
        expect(shipA.currentTarget).toBe(shipB);
        expect(shipA.firstExecutionOfCommand).toBe(false);
        expect(shipA.preferredSpeed).toBe(Math.fround(shipA.topSpeed));
        expect(shipA.targetSpeed).toBe(shipA.topSpeed);
        const signals = empireDistressSignals(shipB.empire!);
        expect(signals.length).toBe(signalsBefore + 1);
        expect(signals[signals.length - 1].attacker).toBe(shipA.empire);
        expect(signals[signals.length - 1].attackStrength).toBe(calculateOverallStrengthFactor(shipA));
        // The same command again on the next frame: a matching signal exists, so no new one is raised.
        cmdAttackBombardCaptureRaid(ctx(c.command, mission));
        expect(empireDistressSignals(shipB.empire!).length).toBe(signalsBefore + 1);
        // A destroyed current target completes the command and hands the frame time back.
        shipB.hasBeenDestroyed = true;
        const c2 = ctx(c.command, mission);
        expect(cmdAttackBombardCaptureRaid(c2)).toBe(0.5);
        expect(shipA.currentTarget).toBeNull();
        expect(shipA.firstExecutionOfCommand).toBe(true);
        expect(c2.mission.fastPeekCurrentCommand()!.action).toBe(CommandAction.ScanArea);
        shipB.hasBeenDestroyed = false;
        shipA.mission = null;
    });
});

describe('harness', () => {
    it('60 game-s on a fresh createGame galaxy runs the M4n entry points with no M4n stub left', () => {
        const g = createTickGame(gameData).galaxy;
        const r = runGameSeconds(g, 60);
        expect(Object.keys(r.todoHits).filter((k) => k.startsWith('M4n '))).toEqual([]);
        for (const b of g.builtObjects) {
            expect(Number.isFinite(b.optimalMaximumAttackRange) && Number.isFinite(b.optimalMinimumAttackRange)).toBe(true);
            if (b.threats !== null) expect(b.threats.length).toBe(b.threatLevels!.length);
        }
    }, 300000);
});
