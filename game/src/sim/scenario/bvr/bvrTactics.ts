// BVR combat, AI tactics (scenarios/bvr-combat, flag bvrAI). Not a port. No Rnd.
//
// The original keeps a ship at the distance its design's battle tactic says (combat/attackAI.ts setOptimalAttackRanges:
// Standoff = 65-90% of its longest torpedo-family range, AllWeapons = 65-90% of its shortest beam range, PointBlank, Evade) and
// a ship closes or backs off at top speed to stay in that band. With the BVR launchers that rule would keep a ship at the range
// of an empty launcher, and nobody would use the range. With the flag on, an automated (AI-controlled) ship whose design tactic
// against a ship or base is Standoff / AllWeapons / PointBlank gets (bvrEngagement):
//   - Kite: it has missiles loaded, more loaded missile rounds in its fleet than the target's fleet has, and its missiles out-range
//     the target's longest loaded weapon by 15%: it holds the band from max(60% of its missile range, 115% of the target's reach) to
//     90% of its missile range, backing off when the target closes (the salvo is fired at a distance the enemy cannot answer).
//   - Rush: it has no missile loaded and the target's fleet has loaded missiles that out-range its guns by half: it closes fast to
//     the inside of its gun band, minimising the time under fire.
//   - A Standoff ship whose standoff weapons are all empty fights as AllWeapons (its guns), or as PointBlank with no guns: it does not
//     keep the range of an empty launcher.
//   - Otherwise the design's own band: the fleets trade missile salvos as they close, then fight with guns and torpedoes.
// Also: a ship's strength in the AI's comparisons counts a limited launcher by the share of its magazine that is loaded and by
// bvrAiValuePct (a finite magazine is worth less than a gun that never runs dry): bvrWeaponShare, used by threats.ts
// calculateFirepowerFactor and diplomacyTick's copy of it.

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import type { Weapon } from '../../weapon';
import type { StellarObject } from '../../missions/mission';
import { isBuiltObject } from '../../missions/mission';
import { BattleTactics } from '../../data/designSpecifications';
import { ComponentType } from '../../data/components';
import { isAiControlled } from '../../missions/playerOrder';
import { ammoFraction, bvrAiOn, bvrParam, isBvrMissile, isLimitedLauncher, roundsLeft } from './bvr';

/** The share (0..1) of this weapon's contribution that counts: a limited launcher by its loaded share and bvrAiValuePct, any other weapon fully. */
export function bvrWeaponShare(galaxy: Galaxy, bo: BuiltObject, weapon: Weapon): number {
    if (!isLimitedLauncher(weapon.component)) return 1;
    return (ammoFraction(galaxy, bo, weapon.component) * bvrParam(galaxy, 'bvrAiValuePct')) / 100;
}

/** The ship's longest loaded BVR missile range (0 when it has none loaded). */
export function loadedMissileRange(galaxy: Galaxy, bo: BuiltObject): number {
    let r = 0;
    for (const w of bo.weapons) {
        if (w == null || !isBvrMissile(w.component) || w.range <= r) continue;
        if (roundsLeft(galaxy, bo, w.component) > 0) r = w.range;
    }
    return r;
}

/** The weapon types that set a ship's Standoff range (BuiltObject.reDefine: the torpedo family, area and ion-pulse weapons). */
const STANDOFF_TYPES: ReadonlySet<ComponentType> = new Set([
    ComponentType.WeaponTorpedo,
    ComponentType.WeaponMissile,
    ComponentType.WeaponSuperTorpedo,
    ComponentType.WeaponSuperMissile,
    ComponentType.WeaponAreaDestruction,
    ComponentType.WeaponSuperArea,
    ComponentType.WeaponIonPulse,
    ComponentType.WeaponAreaGravity,
]);

/** The longest range among the ship's standoff weapons that can still fire (a limited launcher counts only with rounds). */
export function loadedStandoffRange(galaxy: Galaxy, bo: BuiltObject): number {
    let r = 0;
    for (const w of bo.weapons) {
        if (w == null || w.component === null || !STANDOFF_TYPES.has(w.component.type) || w.range <= r || !(w.rawDamage > 0)) continue;
        if (isLimitedLauncher(w.component) && roundsLeft(galaxy, bo, w.component) <= 0) continue;
        r = w.range;
    }
    return r;
}

/** The ship's longest weapon range that can still fire (a limited launcher counts only with rounds): what it can reach the enemy with now. */
export function loadedReach(galaxy: Galaxy, bo: BuiltObject): number {
    let r = 0;
    for (const w of bo.weapons) {
        if (w == null || w.component === null) continue;
        const t = w.component.type;
        if (t === ComponentType.WeaponPointDefense || t === ComponentType.AssaultPod || t === ComponentType.WeaponIonDefense || t === ComponentType.HyperDeny || t === ComponentType.HyperStop || t === ComponentType.WeaponTractorBeam) continue;
        if (w.range <= r) continue;
        if (isLimitedLauncher(w.component) && roundsLeft(galaxy, bo, w.component) <= 0) continue;
        r = w.range;
    }
    return r;
}

/** Loaded BVR missile rounds in the ship's fleet (the ship alone when it has none). */
export function fleetMissileRounds(galaxy: Galaxy, bo: BuiltObject): number {
    const ships = bo.shipGroup !== null ? (bo.shipGroup as { ships: (BuiltObject | null)[] }).ships : [bo];
    let n = 0;
    const seen = new Set<number>();
    for (const s of ships) {
        if (s == null || s.hasBeenDestroyed) continue;
        seen.clear();
        for (const w of s.weapons) {
            if (w == null || !isBvrMissile(w.component) || seen.has(w.component.componentId)) continue;
            seen.add(w.component.componentId);
            n += roundsLeft(galaxy, s, w.component);
        }
    }
    return n;
}

/** Longest loaded reach among the target's fleet (the target alone when it has no fleet). */
function fleetReach(galaxy: Galaxy, target: BuiltObject): number {
    const ships = target.shipGroup !== null ? (target.shipGroup as { ships: (BuiltObject | null)[] }).ships : [target];
    let r = 0;
    for (const s of ships) if (s != null && !s.hasBeenDestroyed) r = Math.max(r, loadedReach(galaxy, s));
    return r;
}

/** The longest loaded BVR missile range in the target's fleet. */
function fleetMissileReach(galaxy: Galaxy, target: BuiltObject): number {
    const ships = target.shipGroup !== null ? (target.shipGroup as { ships: (BuiltObject | null)[] }).ships : [target];
    let r = 0;
    for (const s of ships) if (s != null && !s.hasBeenDestroyed) r = Math.max(r, loadedMissileRange(galaxy, s));
    return r;
}

/** What the BVR AI changes about a ship's engagement: another tactic, or an explicit attack band [min, max]; null = the design's own. */
export interface BvrEngagement {
    tactic: BattleTactics;
    band: { min: number; max: number } | null;
}

export function bvrEngagement(galaxy: Galaxy, bo: BuiltObject, target: StellarObject, tactic: BattleTactics): BvrEngagement | null {
    if (!bvrAiOn(galaxy) || !isBuiltObject(target) || bo.empire === null || !isAiControlled(bo)) return null;
    if (tactic !== BattleTactics.Standoff && tactic !== BattleTactics.AllWeapons && tactic !== BattleTactics.PointBlank) return null;
    const mine = fleetMissileRounds(galaxy, bo);
    const theirs = fleetMissileRounds(galaxy, target);
    const myRange = loadedMissileRange(galaxy, bo);
    const theirReach = fleetReach(galaxy, target);
    if (myRange > 0 && mine > theirs && myRange > theirReach * 1.15) {
        const max = Math.trunc(myRange * 0.9);
        const min = Math.min(max - 50, Math.trunc(Math.max(myRange * 0.6, theirReach * 1.15)));
        return { tactic, band: { min: Math.max(0, min), max } };
    }
    if (myRange <= 0 && theirs > 0) {
        const gun = bo.beamWeaponsMinRange > 0 ? bo.beamWeaponsMinRange : loadedReach(galaxy, bo);
        if (gun > 0 && fleetMissileReach(galaxy, target) > gun * 1.5) return { tactic, band: { min: 0, max: Math.max(50, Math.trunc(gun * 0.75)) } };
    }
    if (tactic === BattleTactics.Standoff) {
        const loaded = loadedStandoffRange(galaxy, bo);
        if (loaded <= 0) return { tactic: bo.beamWeaponsMinRange > 0 ? BattleTactics.AllWeapons : BattleTactics.PointBlank, band: null };
        // Its standoff range is that of a launcher that has fired its last round: hold the range of what can still fire.
        if (loaded < bo.standoffWeaponsMaxRange) return { tactic, band: { min: Math.trunc(loaded * 0.65), max: Math.trunc(loaded * 0.9) } };
    }
    return null;
}
