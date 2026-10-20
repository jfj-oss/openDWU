// The Beacon's site defends itself before the first mega beam (Giantworks add-on, flag gwBeacon). Not a port.
//
//   Shield   - the Great Work's scaffold carries a strong shield at every stage (beaconSiteShields, plated on like a finished wonder's: plateDesignTo); the
//              finished Beacon has its own plating (beacon.ts setupBeacon).
//   Watchers - any attack on the scaffold / the Beacon before the first beam calls every Watcher to the site at once (beacon.ts siteDefence: they come
//              within SITE_ARRIVAL of it) and they fire on every empire ship in that system (watcherMayFire), decloaked, until the fight is over; then
//              each goes back to what it was doing. Self-defence of the site, not war: nothing is declared (the Age-1 rule: war starts at the beam).
//   Fleet    - when the shield is BROKEN a Reclaimer fleet of the Watchers' faction arrives at the site (spawnSiteFleet): beaconSiteFleetPct % of the
//              strongest attacking force in the system (at least beaconSiteFleetMin), built free: before the beam there is no biofuel or awakening reserve,
//              the machines make it from nothing, as the guard's free share. It patrols the site, fires only on the attackers (and the empire ships in the
//              system while the fight is on) and, once the first beam has fired, joins the Beacon's guard (st.guards: the normal flow).
//
// Rnd: positions use the Beacon's private Random; the stock ship generation draws galaxy.rnd as everywhere else.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { ComponentType } from '../../../data/components';
import { generateDesignFromSpec } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { galaxyStarDate } from '../../../tick/simTime';
import { GAME_DAY_LENGTH } from '../../hooks';
import { refitInPlace } from '../framework';
import { P, SYSTEM_RADIUS, beaconRandom, aliveShips, type BeaconState, type SiteDefence } from './beaconState';
import { WAVE_CYCLE, designFor, patrol, spawnShip, strengthOf } from './beaconFleet';
import { breakShields, plateDesignTo, shieldBreakOf, shieldsDown } from './shields';
import { isCompact, logGw } from './state';

/** Defenders come this close to the site (world units). */
export const SITE_ARRIVAL = 1000;

/** Before the first mega beam: the Great Work is being built or the finished Beacon waits for its first beam. Pure. */
export function preBeam(st: BeaconState): boolean {
    return st.faction !== null && !st.ended && (st.phase === 'watching' || (st.phase === 'reclamation' && st.warStarted === false));
}

/** The site's base: the finished Beacon, else the scaffold (null: none standing). Pure. */
export function siteBase(st: BeaconState): BuiltObject | null {
    if (st.beacon !== null && !st.beacon.hasBeenDestroyed) return st.beacon;
    const b = st.site?.base ?? null;
    return b !== null && !b.hasBeenDestroyed ? b : null;
}

/** Whether `b` is in the site's system (within the system radius of its star or of the site base). Pure. */
export function inSiteSystem(galaxy: Galaxy, st: BeaconState, b: BuiltObject): boolean {
    const star = st.site?.system.systemStar ?? null;
    if (star !== null && galaxy.calculateDistance(b.xpos, b.ypos, star.xpos, star.ypos) <= SYSTEM_RADIUS) return true;
    const base = siteBase(st);
    return base !== null && galaxy.calculateDistance(b.xpos, b.ypos, base.xpos, base.ypos) <= SYSTEM_RADIUS;
}

/** An empire the site's defenders treat as a stranger: an ordinary empire (not the Compact that builds, the faction, pirates, the independents). Pure. */
export function isOutsider(galaxy: Galaxy, st: BeaconState, e: Empire | null): boolean {
    return e !== null && e.active && e !== st.faction && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && !isCompact(galaxy, e);
}

/** Ships of outsider empires in the site's system (military first when `militaryOnly`). */
export function outsiderShips(galaxy: Galaxy, st: BeaconState, militaryOnly: boolean): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const e of galaxy.empires) {
        if (!isOutsider(galaxy, st, e)) continue;
        for (const b of e!.builtObjects) {
            if (b.hasBeenDestroyed || (militaryOnly && b.role !== BuiltObjectRole.Military) || !inSiteSystem(galaxy, st, b)) continue;
            out.push(b);
        }
    }
    return out;
}

/** May a defender of the site fire on `victim`? An empire's ship in the site's system, or a pirate / monster that attacked the site. Pure. */
export function siteVictim(galaxy: Galaxy, st: BeaconState, victim: BuiltObject): boolean {
    if (st.defence?.attackerIds.includes(victim.builtObjectID)) return true;
    return isOutsider(galaxy, st, victim.actualEmpire) && inSiteSystem(galaxy, st, victim);
}

export function defenceOfSite(st: BeaconState): SiteDefence {
    return (st.defence ??= { active: false, lastAttack: 0, attackerIds: [], fleetDate: 0, fleet: [] });
}

/** A point within SITE_ARRIVAL of the site base (the Beacon's private Random). */
export function pointNearSite(galaxy: Galaxy, st: BeaconState, base: BuiltObject, salt: number): { x: number; y: number } {
    const rnd = beaconRandom(galaxy, st, salt);
    const a = rnd.nextDouble() * Math.PI * 2;
    const r = SITE_ARRIVAL * (0.3 + 0.65 * rnd.nextDouble());
    return { x: base.xpos + Math.cos(a) * r, y: base.ypos + Math.sin(a) * r };
}

// ---------------------------------------------------------------------------------------------------------------
// The scaffold's shield
// ---------------------------------------------------------------------------------------------------------------

/**
 * The unfinished Great Work's base carries beaconSiteShields (a fresh design of its kind for its owner, plated, refitted in place: capture.ts plate). Checked
 * every Watcher pass and at the first attack; a rebuilt scaffold gets it again. Not for the finished Beacon (setupBeacon plates it). Returns true when it plated now.
 */
export function ensureSiteShield(galaxy: Galaxy, st: BeaconState): boolean {
    if (st.phase !== 'watching') return false;
    const base = siteBase(st);
    if (base === null) return false;
    const target = P.siteShields(galaxy);
    if (!(target > 0) || base.shieldsCapacity >= target * 0.98) return false;
    const owner = base.actualEmpire;
    if (owner === null) return false;
    try {
        const spec = owner.designSpecifications.find((s) => s !== null && s.subRole === base.subRole) ?? galaxyDesignSpecificationBySubRole(base.subRole);
        if (spec === null || spec === undefined) return false;
        const d = generateDesignFromSpec(galaxy, owner, spec, 0, galaxyStarDate(galaxy));
        if (d === null) return false;
        plateDesignTo(d, ComponentType.Shields, target, (x) => x.shieldsCapacity);
        d.name = base.design.name;
        d.isObsolete = true; // never an AI build
        owner.designs.push(d);
        const name = base.name;
        refitInPlace(galaxy, base, d);
        base.name = name;
        logGw(galaxy, galaxyStarDate(galaxy), `beacon site plated: shields ${Math.round(base.shieldsCapacity)}`);
        return true;
    } catch {
        return false; // a design the generator cannot make: the base keeps its own shields
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The fleet that comes when the shield breaks
// ---------------------------------------------------------------------------------------------------------------

/** The strongest attacking force in the site's system: the largest sum of one outsider empire's warship strength there. Pure. */
export function strongestAttacker(galaxy: Galaxy, st: BeaconState): number {
    const by = new Map<Empire, number>();
    for (const b of outsiderShips(galaxy, st, true)) {
        const e = b.actualEmpire!;
        by.set(e, (by.get(e) ?? 0) + strengthOf(b));
    }
    let best = 0;
    for (const v of by.values()) if (v > best) best = v;
    return best;
}

/**
 * The shield broke before the first beam: the Reclaimer fleet comes (once). Returns the ships made (empty: none now, or it came already).
 */
export function checkSiteShield(galaxy: Galaxy, st: BeaconState): BuiltObject[] {
    const base = siteBase(st);
    const faction = st.faction;
    if (base === null || faction === null || !preBeam(st)) return [];
    const def = defenceOfSite(st);
    if (def.fleetDate > 0 || !shieldsDown(base)) return [];
    // The shield stays down for a while (a schedule, shields.ts), so the stock recharge cannot undo the break at once.
    if (shieldBreakOf(galaxy, base) === null) breakShields(galaxy, base, P.siteShieldRechargeDays(galaxy));
    def.fleetDate = galaxyStarDate(galaxy);
    const want = Math.max(P.siteFleetMin(galaxy), (strongestAttacker(galaxy, st) * P.siteFleetPct(galaxy)) / 100);
    const made: BuiltObject[] = [];
    let have = 0;
    for (let i = 0; i < P.siteFleetMaxShips(galaxy) && have < want; i++) {
        const sub = WAVE_CYCLE[i % WAVE_CYCLE.length];
        const d = designFor(galaxy, faction, sub);
        if (d === null) break;
        const bo = spawnShip(galaxy, faction, d, base.xpos, base.ypos);
        const at = pointNearSite(galaxy, st, base, 7000 + i);
        bo.xpos = at.x;
        bo.ypos = at.y;
        made.push(bo);
        st.stats.spawned++;
        const s = strengthOf(bo);
        have += s;
        if (!(s > 0)) break;
    }
    def.fleet.push(...made);
    logGw(galaxy, galaxyStarDate(galaxy), `beacon site: shield broken, ${made.length} Reclaimer ships (strength ${Math.round(have)} of ${Math.round(want)}) arrive`);
    return made;
}

/**
 * Every Watcher pass: the shield, the fight's end, the fleet's post (a patrol of the site) and, once the first beam has fired, its hand-over to the
 * Beacon's guard. Rnd: none.
 */
export function siteDefencePass(galaxy: Galaxy, st: BeaconState): void {
    ensureSiteShield(galaxy, st);
    const def = st.defence;
    if (def === undefined) return;
    const now = galaxyStarDate(galaxy);
    def.fleet = aliveShips(def.fleet, st.faction);
    if (def.active && now - def.lastAttack > P.siteQuietDays(galaxy) * GAME_DAY_LENGTH && outsiderShips(galaxy, st, true).length === 0) {
        def.active = false;
        def.attackerIds = [];
    }
    if (def.fleet.length === 0 || def.handed === true) return;
    if (preBeam(st)) {
        const base = siteBase(st);
        const hold = st.site?.habitat ?? st.site?.system.systemStar ?? null;
        if (base === null || hold === null) return;
        for (const b of def.fleet) if (galaxy.calculateDistance(b.xpos, b.ypos, base.xpos, base.ypos) <= SYSTEM_RADIUS * 2) patrol(galaxy, b, hold);
        return;
    }
    // The first beam has fired (or the Beacon fell): the fleet is the Beacon's guard from now on (beaconFleet.ts topUpGuard counts it).
    def.handed = true;
    for (const b of def.fleet) if (!st.guards.includes(b)) st.guards.push(b);
}
