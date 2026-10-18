// Ambush first strike (scenarios/ambush-strike, flag ambush). Not a port.
//
// A ship that opens fire on a ship of an empire that has NOT detected it gets an ambush for its opening seconds. "Opens fire":
// it has not fired for ambushQuietSeconds. "Not detected": the stock visibility rules (Empire.9.cs IsObjectVisibleToThisEmpire via
// independentTraders.ts isObjectVisibleToThisEmpire) say the target's empire does not see the firing ship: it is outside every
// system that empire has visibility of and beyond its long-range scanners' reach scaled by the firing ship's stealth (a cloak
// shortens that), and not shared through a treaty. Checked once per opening, not per shot. During the ambush (ambushSeconds):
//   - a shot that would miss hits instead with ambushAccuracyPct (weapons.ts determineHitTarget, hits.ts c2AdjustHit; one draw);
//   - every hit does ambushDamagePct more (damage.ts inflictDamageFull, hits.ts c2HitPower), for shots that land up to 3 seconds after.
// State: scenario.state.combat2.ambush (ship -> { lastFire, until }), pruned with the destroyed ships. AI (flag ambushAI): an AI ship
// in its ambush window counts its side as stronger when it weighs withdrawing (ambushAiFactor, threats.ts checkBattleOverwhelming).

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import type { StellarObject } from '../../missions/mission';
import { isBuiltObject } from '../../missions/mission';
import { isObjectVisibleToThisEmpire } from '../../independentTraders';
import { ambushAiOn, ambushOn, c2Param, c2State, peekC2State } from './common';

/** Shots that land this long (ms) after the window closed still count (the flight of a shot fired in it). */
const FLIGHT_SLACK_MS = 3000;

/** True while the ship's ambush window is open (for shots fired in it). */
export function ambushActive(galaxy: Galaxy, bo: BuiltObject): boolean {
    const rec = peekC2State(galaxy)?.ambush.get(bo);
    return rec !== undefined && galaxy.nowMs < rec.until;
}

/** Damage multiplier of a hit by `bo` now (1 outside an ambush). */
export function ambushDamageFactor(galaxy: Galaxy, bo: BuiltObject): number {
    const rec = peekC2State(galaxy)?.ambush.get(bo);
    if (rec === undefined || galaxy.nowMs >= rec.until + FLIGHT_SLACK_MS) return 1;
    return 1 + c2Param(galaxy, 'ambushDamagePct') / 100;
}

/** True when the empire does not see `ship` (the stock visibility test). */
export function undetectedBy(galaxy: Galaxy, ship: BuiltObject, targetEmpire: NonNullable<BuiltObject['empire']>): boolean {
    return !isObjectVisibleToThisEmpire(galaxy, targetEmpire, ship);
}

/**
 * Called for every shot a ship fires at a ship or base (weapons.ts determineHitTarget): opens the ambush when the ship was quiet and is
 * undetected; returns true while the ambush is on. No draws.
 */
export function ambushNoteShot(galaxy: Galaxy, self: BuiltObject, target: StellarObject): boolean {
    if (self.empire === null || !isBuiltObject(target) || target.empire === null || target.empire === self.empire) return false;
    const st = c2State(galaxy);
    const now = galaxy.nowMs;
    let rec = st.ambush.get(self);
    if (rec === undefined) {
        rec = { lastFire: -1e12, until: 0 };
        st.ambush.set(self, rec);
    }
    if (now - rec.lastFire > c2Param(galaxy, 'ambushQuietSeconds') * 1000 && undetectedBy(galaxy, self, target.empire)) {
        rec.until = now + c2Param(galaxy, 'ambushSeconds') * 1000;
        st.stats.ambushOpened++;
    }
    rec.lastFire = now;
    return now < rec.until;
}

/** Seconds left of the ship's ambush window (0 = none), for the ship panel. */
export function ambushSecondsLeft(galaxy: Galaxy, bo: BuiltObject): number {
    if (!ambushOn(galaxy)) return 0;
    const rec = peekC2State(galaxy)?.ambush.get(bo);
    return rec === undefined || galaxy.nowMs >= rec.until ? 0 : Math.ceil((rec.until - galaxy.nowMs) / 1000);
}

/**
 * AI: an ambushing ship, or one the threat's empire has not detected (it would open with an ambush), counts the threats against it
 * 1/(1 + ambushAiOddsPct) as heavy in its withdrawal odds (threats.ts checkBattleOverwhelming divides the threat ratio by this
 * factor): AI fleets that have stealth stay in a fight the stock odds would have them leave, and go in. 1 otherwise. The visibility
 * test is the stock one and runs only for an AI ship already in a fight with an attack mission.
 */
export function ambushAiFactor(galaxy: Galaxy, bo: BuiltObject, threat: BuiltObject | null = null): number {
    if (!ambushAiOn(galaxy)) return 1;
    const k = 1 + c2Param(galaxy, 'ambushAiOddsPct') / 100;
    if (ambushActive(galaxy, bo)) return k;
    if (threat !== null && threat.empire !== null && threat.empire !== bo.empire && undetectedBy(galaxy, bo, threat.empire)) return k;
    return 1;
}
