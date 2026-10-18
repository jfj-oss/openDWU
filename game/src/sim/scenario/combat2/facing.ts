// Armour facing (scenarios/armour-facing, flags armourFacing and facingAI). Not a port.
//
// In the original a hit does the same damage wherever it lands on the hull. With the flag on a hit on a ship (never a base or a
// fixed target) is scaled by where it lands, from the angle between the direction the shot travels and the ship's heading
// (BuiltObject.heading; the shot's heading is the strike angle damage.ts inflictDamageFull gets): within facingArcDegrees of head-on
// it hits the bow (facingBowPct, 75%), within that of the same way as the ship is going it hits the stern (facingRearPct, 140%),
// else the flank (facingFlankPct, 110%). Area blasts and the explosion chain have no direction and are not scaled.
//
// AI (flag facingAI; AI-controlled warships only; one cheap pass every 3 game seconds from the ship tick, combat2/ship tick):
//   - a ship that is holding still in a fight (speed under 10) turns its bow to the nearest enemy (the turn rate of the ship, one pass
//     of calculateCurrentHeading), so a stationary fleet does not offer its flank or stern;
//   - a fast ship (facingFlankSpeedPct or more of its target's speed, the target a moving ship) that is still more than 1.5 weapon
//     ranges off circles: for up to facingFlankSeconds its approach heading is turned by 0.5 radians to the side behind the target
//     (movement.ts doMovement adds flankHeadingOffset), so it arrives on a flank or the stern instead of head-on.
// State: scenario.state.combat2.flank (ship -> { until, sign }) for the circling ships only. No Rnd.

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import type { Weapon } from '../../weapon';
import { isBuiltObject } from '../../missions/mission';
import { ComponentType } from '../../data/components';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { isAiControlled } from '../../missions/playerOrder';
import { calculateCurrentHeading } from '../../movement';
import { c2Param, c2State, facingAiOn, facingOn, peekC2State } from './common';

export type FacingZone = 'bow' | 'flank' | 'rear';

const TWO_PI = Math.PI * 2;

/** The angle (0..PI) between two directions. */
function angleBetween(a: number, b: number): number {
    let d = (a - b) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    else if (d < -Math.PI) d += TWO_PI;
    return Math.abs(d);
}

/** Where a shot travelling in `shotHeading` lands on a ship heading `heading`. */
export function facingZone(heading: number, shotHeading: number, arcDegrees: number): FacingZone {
    const arc = (arcDegrees * Math.PI) / 180;
    // Head-on: the shot travels against the ship's heading.
    if (angleBetween(shotHeading, heading + Math.PI) <= arc) return 'bow';
    if (angleBetween(shotHeading, heading) <= arc) return 'rear';
    return 'flank';
}

/** Weapons that strike without a direction (blasts of area weapons). */
function isDirectionless(weapon: Weapon): boolean {
    const t = weapon.component.type;
    return t === ComponentType.WeaponAreaGravity || t === ComponentType.WeaponAreaDestruction || t === ComponentType.WeaponSuperArea || t === ComponentType.WeaponIonPulse;
}

/** Damage factor of a hit on `target` by `weapon` with `strikeAngle` (1 when the hit has no direction or the target has no facing). Counts the zone hit. */
export function facingFactor(galaxy: Galaxy, target: BuiltObject, weapon: Weapon | null, strikeAngle: number): number {
    if (weapon === null || strikeAngle === -Number.MAX_VALUE || target.role === BuiltObjectRole.Base || isDirectionless(weapon)) return 1;
    const zone = facingZone(target.heading, strikeAngle, c2Param(galaxy, 'facingArcDegrees'));
    const st = c2State(galaxy);
    if (zone === 'bow') {
        st.stats.facingBow++;
        return c2Param(galaxy, 'facingBowPct') / 100;
    }
    if (zone === 'rear') {
        st.stats.facingRear++;
        return c2Param(galaxy, 'facingRearPct') / 100;
    }
    st.stats.facingFlank++;
    return c2Param(galaxy, 'facingFlankPct') / 100;
}

/** The ship's main enemy: its current target if that is an enemy ship, else the first enemy ship among its attackers. */
export function mainThreat(bo: BuiltObject): BuiltObject | null {
    const t = bo.currentTarget;
    if (t !== null && isBuiltObject(t as never) && (t as BuiltObject).empire !== bo.empire && !(t as BuiltObject).hasBeenDestroyed && (t as BuiltObject).role !== BuiltObjectRole.Base) return t as BuiltObject;
    const atk = bo.attackers;
    if (atk !== null) {
        for (let i = 0; i < atk.length && i < 8; i++) {
            const a = atk[i];
            if (a != null && isBuiltObject(a as never) && (a as BuiltObject).empire !== bo.empire && !(a as BuiltObject).hasBeenDestroyed && (a as BuiltObject).role !== BuiltObjectRole.Base) return a as BuiltObject;
        }
    }
    return null;
}

/** The heading offset (radians) a circling ship's approach carries now (0 = none). movement.ts doMovement adds it. */
export function flankHeadingOffset(galaxy: Galaxy, bo: BuiltObject): number {
    const st = peekC2State(galaxy);
    if (st === undefined || st.flank.size === 0) return 0;
    const rec = st.flank.get(bo);
    if (rec === undefined) return 0;
    if (galaxy.nowMs >= rec.until) {
        st.flank.delete(bo);
        return 0;
    }
    return rec.sign * 0.5;
}

/** One pass of the AI steering for a ship (every 3 game seconds, from the ship tick). */
export function facingTick(galaxy: Galaxy, bo: BuiltObject, dt: number): void {
    if (!facingAiOn(galaxy) || bo.empire === null || bo.role === BuiltObjectRole.Base || !bo.inBattle || !(bo.firepowerRaw > 0) || !isAiControlled(bo)) return;
    const st = peekC2State(galaxy);
    const threat = mainThreat(bo);
    if (threat === null) {
        st?.flank.delete(bo);
        return;
    }
    const dx = threat.xpos - bo.xpos;
    const dy = threat.ypos - bo.ypos;
    const bearing = Math.atan2(dy, dx);
    if (bo.currentSpeed < 10) {
        if (angleBetween(bearing, bo.heading) > 0.25) {
            bo.targetHeading = Math.fround(bearing);
            calculateCurrentHeading(galaxy, bo, dt);
            c2State(galaxy).stats.facingTurns++;
        }
        return;
    }
    // Flanking: a fast ship, a moving target, still far off.
    const dist = Math.hypot(dx, dy);
    const range = Math.max(300, bo.maximumWeaponsRange);
    const circling = st?.flank.get(bo);
    if (dist <= range * 1.5 || dist > range * 12 || !(threat.topSpeed > 0)) {
        if (circling !== undefined) st!.flank.delete(bo);
        return;
    }
    if (circling !== undefined || bo.topSpeed < (threat.topSpeed * c2Param(galaxy, 'facingFlankSpeedPct')) / 100) return;
    // Aim behind the target's heading: the side opposite to the way it is crossing our bearing.
    let d = (threat.heading - bearing) % TWO_PI;
    if (d > Math.PI) d -= TWO_PI;
    else if (d < -Math.PI) d += TWO_PI;
    const c = c2State(galaxy);
    c.flank.set(bo, { until: galaxy.nowMs + c2Param(galaxy, 'facingFlankSeconds') * 1000, sign: d > 0 ? -1 : 1 });
    c.stats.flankStarted++;
}

/** "Bow-on" for tests / the ship panel: true when the ship's heading is within the bow arc of `from`'s bearing. */
export function isBowOn(galaxy: Galaxy, ship: BuiltObject, from: BuiltObject): boolean {
    const bearing = Math.atan2(from.ypos - ship.ypos, from.xpos - ship.xpos);
    return angleBetween(bearing, ship.heading) <= (c2Param(galaxy, 'facingArcDegrees') * Math.PI) / 180;
}

export { facingOn };
