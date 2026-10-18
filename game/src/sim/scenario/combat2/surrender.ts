// Surrender (scenarios/surrender-wrecks, flag surrender; the add-on id keeps its old name so saves stay valid). Not a port.
//
// In the original a ship fights until it is destroyed, flees (the design's Flee setting) or is boarded (assault pods, ProcessBoardingAssault
// → BuiltObject.1.cs 3020 boarding capture, ported in combat/boarding.ts boardingCapture). With the flag on, every 3 game seconds (the ship
// tick, and straight after every hit that damages it) an AI-controlled warship (never a human empire's ship, a pirate's or an independent's) in a battle checks whether to strike its colours:
//   - crippled: less than surrenderHealthPct of its (built) components work;
//   - no way out: its engines are out, or an attacker is faster than it and it cannot hyperjump away;
//   - outgunned: the hostile ships that are attacking it have at least surrenderOddsPct of its own (working) firepower;
//   - the captain's nerve: surrenderChancePct, scaled by the race's caution over its aggression (0.5..2); one galaxy.rnd draw per check.
// A ship that strikes leaves its fleet, drops its mission and stops dead (builtObjectTick holds it: no commands, speed 0). It no longer
// fires and nothing fires at it (weapons.ts fireWeaponsAtTarget; attackAI.ts shouldAttack), and an armed enemy of its empire within
// surrenderCaptureRange that stays surrenderCaptureSeconds takes it with a prize crew: boardingCapture, the original's capture of a
// boarded ship, so the capturing empire's capture policy (enlist, retrofit, scrap) decides. A ship nobody takes in surrenderTimeoutDays
// is taken back by its crew, which will not surrender again for as long. State: scenario.state.combat2.struck / calm.

import type { Galaxy } from '../../galaxy';
import { sparedEmpires } from '../../combat/spared';
import type { BuiltObject } from '../../builtObject';
import type { Empire } from '../../empire';
import type { StellarObject } from '../../missions/mission';
import { isBuiltObject, builtObjectMission } from '../../missions/mission';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { DiplomaticRelationType } from '../../diplomacy';
import { isHumanEmpire } from '../../humanEmpires';
import { isAiControlled } from '../../missions/playerOrder';
import { clearPreviousMissionRequirements } from '../../missions/assign';
import { leaveShipGroup } from '../../fleets/shipGroup';
import { boardingCapture } from '../../combat/boarding';
import { raceAggressionLevel, raceCautionLevel } from '../../racePeriodic';
import { EmpireMessageType } from '../../messages';
import { GAME_DAY_LENGTH, registerScenarioFramePeriodic } from '../hooks';
import { scenarioMessage, scenarioText } from '../messages';
import { c2Param, c2State, peekC2State, surrenderOn } from './common';

/** True when the ship has struck its colours. */
export function isStruck(galaxy: Galaxy, bo: BuiltObject): boolean {
    const st = peekC2State(galaxy);
    return st !== undefined && st.struck.size > 0 && st.struck.has(bo);
}

/**
 * weapons.ts fireWeaponsAtTarget: true when `self` or `target` has struck (no shot is fired). Cheap with nothing struck.
 */
export function c2StruckSpares(galaxy: Galaxy, self: BuiltObject, target: StellarObject): boolean {
    const st = peekC2State(galaxy);
    if (st === undefined || st.struck.size === 0) return false;
    return st.struck.has(self) || (isBuiltObject(target) && st.struck.has(target));
}

/** attackAI.ts shouldAttack: a ship that has struck is not a target. */
export function struckSparesTarget(galaxy: Galaxy, target: StellarObject): boolean {
    const st = peekC2State(galaxy);
    return st !== undefined && st.struck.size > 0 && isBuiltObject(target) && st.struck.has(target);
}

/** builtObjectTick: holds a ship that has struck dead in space. Returns true when it did (the commands are skipped). */
export function struckHold(galaxy: Galaxy, bo: BuiltObject): boolean {
    const st = peekC2State(galaxy);
    if (st === undefined || st.struck.size === 0 || !st.struck.has(bo)) return false;
    bo.targetSpeed = 0;
    bo.preferredSpeed = 0;
    bo.currentSpeed = 0;
    return true;
}

function hostile(a: Empire, b: Empire): boolean {
    if (a === b) return false;
    if (a.pirateEmpireBaseHabitat !== null || b.pirateEmpireBaseHabitat !== null) return true;
    return a.diplomaticRelations.byEmpire(b)?.type === DiplomaticRelationType.War;
}

/** The "temper" of the ship's people: caution over aggression, 0.5..2 (1 = average). */
export function surrenderTemper(galaxy: Galaxy, empire: Empire): number {
    const race = empire.dominantRace;
    if (race === null) return 1;
    const agg = Math.max(10, raceAggressionLevel(galaxy, race));
    const cau = Math.max(10, raceCautionLevel(galaxy, race));
    return Math.min(2, Math.max(0.5, cau / agg));
}

/** Share (0..100) of the ship's built components that work. */
export function healthPct(bo: BuiltObject): number {
    const total = bo.components.count - bo.unbuiltComponentCount;
    return total <= 0 ? 100 : ((total - bo.damagedComponentCount) * 100) / total;
}

/** The attackers of the ship that belong to empires hostile to it: their summed firepower, their fastest speed and the main one's empire. */
export function enemyAttackers(bo: BuiltObject): { threat: number; speed: number; empire: Empire | null } {
    let threat = 0;
    let speed = 0;
    let best = 0;
    let empire: Empire | null = null;
    const atk = bo.attackers;
    if (atk !== null && bo.empire !== null) {
        for (let i = 0; i < atk.length; i++) {
            const a = atk[i] as BuiltObject | null;
            if (a == null || !isBuiltObject(a as never) || a.hasBeenDestroyed || a.empire === null || !hostile(a.empire, bo.empire)) continue;
            const t = Math.max(0, a.firepowerRaw);
            threat += t;
            speed = Math.max(speed, a.topSpeed);
            if (t >= best) {
                best = t;
                empire = a.empire;
            }
        }
    }
    return { threat, speed, empire };
}

/** True when the ship cannot run: no engines, or something shooting at it is faster and it cannot jump away. */
export function cannotFlee(bo: BuiltObject, attackerSpeed: number): boolean {
    if (!(bo.topSpeed > 0)) return true;
    return attackerSpeed > bo.topSpeed * 1.1 && !(bo.canHyperJump && bo.warpSpeed > 0);
}

/** The ship strikes its colours to `toEmpire` (null: whoever comes). */
export function strikeColours(galaxy: Galaxy, bo: BuiltObject, toEmpire: Empire | null): void {
    const st = c2State(galaxy);
    if (st.struck.has(bo)) return;
    if (bo.shipGroup !== null) leaveShipGroup(galaxy, bo);
    clearPreviousMissionRequirements(galaxy, bo);
    builtObjectMission(bo.mission)?.clear();
    bo.targetSpeed = 0;
    bo.preferredSpeed = 0;
    bo.currentSpeed = 0;
    st.struck.set(bo, { sinceMs: galaxy.nowMs, toEmpireId: toEmpire !== null ? toEmpire.empireId : -1, captor: null, captureStartMs: 0 });
    st.stats.struck++;
    const owner = bo.empire;
    if (owner !== null && isHumanEmpire(galaxy, owner)) {
        scenarioMessage(galaxy, owner, scenarioText('Ship struck its colours'), scenarioText('The crew of {0} has struck its colours to the enemy.', bo.name), { type: EmpireMessageType.GeneralBadEvent, subject: bo });
    }
    if (toEmpire !== null && isHumanEmpire(galaxy, toEmpire)) {
        scenarioMessage(galaxy, toEmpire, scenarioText('Enemy ship struck its colours'), scenarioText('The crew of the {0} ship {1} has struck its colours. Keep an armed ship beside it and it will be taken.', owner?.name ?? '', bo.name), {
            type: EmpireMessageType.GeneralGoodEvent,
            subject: bo,
        });
    }
}

/** One 3-second pass for a ship: the decision to strike. May draw one galaxy.rnd number (only for a crippled, trapped, outgunned ship). */
export function surrenderTick(galaxy: Galaxy, bo: BuiltObject): void {
    const empire = bo.empire;
    if (empire === null || bo.role !== BuiltObjectRole.Military || bo.damagedComponentCount <= 0 || bo.builtAt !== null || bo.hasBeenDestroyed) return;
    const atk = bo.attackers;
    if (atk === null || atk.length === 0) return;
    if (healthPct(bo) >= c2Param(galaxy, 'surrenderHealthPct')) return;
    if (empire === galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null || isHumanEmpire(galaxy, empire) || !isAiControlled(bo)) return;
    const st = peekC2State(galaxy);
    if (st !== undefined) {
        if (st.struck.has(bo)) return;
        const calm = st.calm.get(bo);
        if (calm !== undefined && galaxy.nowMs < calm) return;
    }
    const enemies = enemyAttackers(bo);
    if (enemies.threat <= 0 || !cannotFlee(bo, enemies.speed)) return;
    if (enemies.threat < (Math.max(1, bo.firepowerRaw) * c2Param(galaxy, 'surrenderOddsPct')) / 100) return;
    const chance = (c2Param(galaxy, 'surrenderChancePct') / 100) * surrenderTemper(galaxy, empire);
    if (!(galaxy.rnd.nextDouble() < chance)) return;
    strikeColours(galaxy, bo, enemies.empire);
}

/** The nearest armed ship of an empire hostile to the struck ship, within `range`. */
function nearestCaptor(galaxy: Galaxy, bo: BuiltObject, range: number): BuiltObject | null {
    if (bo.empire === null) return null;
    const idx = galaxy.resolveIndex(bo.xpos, bo.ypos);
    const cell = galaxy.builtObjectIndexGrid[idx.x][idx.y];
    let best: BuiltObject | null = null;
    let bd = range * range;
    for (let i = 0; i < cell.length; i++) {
        const c = cell[i];
        if (c == null || c === bo || c.hasBeenDestroyed || c.empire === null || c.role !== BuiltObjectRole.Military || !(c.firepowerRaw > 0) || !(c.topSpeed > 0)) continue;
        if (!hostile(c.empire, bo.empire) || sparedEmpires(galaxy, c.empire, bo.empire)) continue;
        const st = peekC2State(galaxy);
        if (st !== undefined && st.struck.has(c)) continue;
        const dx = c.xpos - bo.xpos;
        const dy = c.ypos - bo.ypos;
        const d = dx * dx + dy * dy;
        if (d <= bd) {
            bd = d;
            best = c;
        }
    }
    return best;
}

/** Prize crews and timeouts of the ships that have struck (frame-periodic, every other game day). */
export function surrenderCaptureTick(galaxy: Galaxy): void {
    const st = peekC2State(galaxy);
    if (st === undefined || st.struck.size === 0) return;
    const now = galaxy.nowMs;
    const range = c2Param(galaxy, 'surrenderCaptureRange');
    const secs = c2Param(galaxy, 'surrenderCaptureSeconds') * 1000;
    const timeout = c2Param(galaxy, 'surrenderTimeoutDays') * GAME_DAY_LENGTH;
    for (const [bo, rec] of [...st.struck]) {
        if (bo.hasBeenDestroyed || bo.empire === null) {
            st.struck.delete(bo);
            continue;
        }
        const captor = nearestCaptor(galaxy, bo, range);
        if (captor === null) {
            rec.captor = null;
            rec.captureStartMs = 0;
        } else {
            if (rec.captor === null || rec.captureStartMs === 0) {
                rec.captor = captor;
                rec.captureStartMs = now;
            }
            if (now - rec.captureStartMs >= secs) {
                const taker = captor.empire!;
                st.struck.delete(bo);
                st.stats.captured++;
                boardingCapture(galaxy, bo, taker, now);
                continue;
            }
        }
        if (now - rec.sinceMs >= timeout) {
            st.struck.delete(bo);
            st.calm.set(bo, now + timeout);
            st.stats.recovered++;
        }
    }
}

/** "Struck colours" for the ship panel (null: not struck). */
export function struckText(galaxy: Galaxy, bo: BuiltObject): string | null {
    if (!surrenderOn(galaxy)) return null;
    const rec = peekC2State(galaxy)?.struck.get(bo);
    if (rec === undefined) return null;
    return rec.captor !== null && rec.captureStartMs > 0 ? 'Struck colours (prize crew boarding)' : 'Struck colours';
}

registerScenarioFramePeriodic({
    id: 'surrender.capture',
    flag: 'surrender',
    periodDays: 2,
    run: (galaxy) => surrenderCaptureTick(galaxy),
});
