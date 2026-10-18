// The shared combat hooks of the six combat changes (hit roll and hit damage). Not a port. Called from weapons.ts determineHitTarget
// and damage.ts inflictDamageFull only in a game with a scenario; each part is gated on its own flag, so with all six off the
// calls return their input untouched, draw nothing and create no state.

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import type { Weapon } from '../../weapon';
import type { StellarObject } from '../../missions/mission';
import { isBuiltObject } from '../../missions/mission';
import { ambushDamageFactor, ambushNoteShot } from './ambush';
import { critMissChance } from './criticals';
import { facingFactor } from './facing';
import { ambushOn, c2Param, c2State, criticalsOn, facingOn } from './common';

/**
 * weapons.ts determineHitTarget, after the stock roll (or BVR's): the ambush turns a miss into a hit (one draw, only on a miss during
 * an ambush); a ship with critical command damage loses hits (one draw per hit).
 */
export function c2AdjustHit(galaxy: Galaxy, self: BuiltObject, weapon: Weapon, target: StellarObject, r: { willHit: boolean; hitRangeChance: number }): { willHit: boolean; hitRangeChance: number } {
    let willHit = r.willHit;
    if (ambushOn(galaxy) && ambushNoteShot(galaxy, self, target) && !willHit && isBuiltObject(target)) {
        if (galaxy.rnd.nextDouble() < c2Param(galaxy, 'ambushAccuracyPct') / 100) {
            willHit = true;
            c2State(galaxy).stats.ambushTurnedHits++;
        }
    }
    if (willHit && criticalsOn(galaxy)) {
        const p = critMissChance(galaxy, self);
        if (p > 0 && galaxy.rnd.nextDouble() < p) {
            willHit = false;
            c2State(galaxy).stats.critMisses++;
        }
    }
    return willHit === r.willHit ? r : { willHit, hitRangeChance: r.hitRangeChance };
}

/** damage.ts inflictDamageFull, on a ship or base target: the hit power after the ambush bonus of the firer and the armour facing of the target. */
export function c2HitPower(galaxy: Galaxy, self: BuiltObject, target: BuiltObject, weapon: Weapon | null, hitPower: number, strikeAngle: number): number {
    let p = hitPower;
    if (ambushOn(galaxy) && weapon !== null) {
        const k = ambushDamageFactor(galaxy, self);
        if (k !== 1) {
            p *= k;
            c2State(galaxy).stats.ambushDamage += p - hitPower;
        }
    }
    if (facingOn(galaxy)) p *= facingFactor(galaxy, target, weapon, strikeAngle);
    return p;
}
