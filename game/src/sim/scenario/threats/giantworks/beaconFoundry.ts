// The Beacon, part 6: the Reclaimer FOUNDRIES (Giantworks wonder, flag gwBeacon). Not a port.
// Real bases hidden in the empty void between the systems, cloaked from every sensor (the Watchers' cloak: BuiltObject.cloaked, independentTraders.ts
// cloakHides; no detection, only revealed knowledge lifts it for one empire). They are fixed when the Beacon is finished (beaconComplete) and finite across
// every cycle: a destroyed foundry is never replaced. Count: 5 at 250 star systems or fewer, linear to 10 at 1,000, then to 20 at 4,000 (cap 20).
//   BUILDING: from season 2 on the Reclaimers' new warships (strike waves, the Beacon's guard, response fleets, raiders) are made at a living foundry (round
//     robin) and fly out, cloaked until they are clear of it; what the foundries can make per pass is the share of the baseline that is alive (no foundry left:
//     no new ships). Season 1's arrivals (the first beam) are the stockpile and stay as they are.
//   GUARD: each foundry keeps a small cloaked guard (beaconFoundryGuardShips, rebuilt slowly) and mends itself fast (repairRateFactor).
//   FINDING THEM: boarding a Reclaimer CAPITAL (defence at least beaconFoundryCapitalDefence, boardingDefenseValue) and holding the prize beaconFoundryHoldDays
//     without it being retaken or destroyed reveals one foundry the captor does not know (its mind core). Any empire can do it. An escortless capital in
//     a strike group falls back (beaconFleet.ts driveGroup). A revealed foundry shows in the Intelligence screen's Threats & Leads (level 2).
//   INTEL: an investigation of a revealed foundry (threats/investigate.ts) reports its guard and output (level 3) and yields a TECH PIECE (TODO: what tech is
//     undecided: only a counter in state).
//   THE TRAP: a ship (not the Reclaimers') within beaconFoundryTrapRange of a living foundry cannot start a hyperjump (hyperDenyHere) until it is destroyed.
//   DESTROYED: the destroyer is credited (FoundryState.destroyedBy; getter foundriesDestroyedBy) and foundryDestroyed fires the scenario event of that name
//     (hooks.ts) for the void-frame components (wip/megapath). The record keeps position and status (located / destroyed) for the next cycle.
// Rnd: private beaconRandom only (placement, the revealed foundry's choice); the stock functions it calls (ship generation) draw as they do elsewhere.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Design } from '../../../design';
import type { BuiltObject } from '../../../builtObject';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { ComponentType } from '../../../data/components';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { generateDesignFromSpec } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { isHumanEmpire } from '../../../humanEmpires';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery, scenarioEmit } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText as T } from '../../messages';
import { scenarioParam } from '../../state';
import { empireTechLevel } from '../robotMutiny';
import { KNOWLEDGE_CONFIRMED, KNOWLEDGE_SUSPECTED, knowledgeLevel, normalEmpires, registerThreatKnownSites, revealTo, type KnownThreatSite, type ThreatKnowledge } from '../framework';
import { registerThreatInvestigation } from '../investigate';
import { BEACON_FLAG, SYSTEM_RADIUS, beaconPosition, beaconRandom, peekBeaconState, type BeaconState } from './beaconState';
import { addPlating, designFor, spawnShip, strengthOf } from './beaconFleet';

const TAG = 'Beacon';
/** The threat key of the foundry rows (known sites, investigations). */
export const FOUNDRY_KEY = 'beaconFoundry';
/** A cloak that never lapses (cloakSeenBy.until) for an empire that knows the foundry. */
const FOREVER = 1e15;

export interface FoundryRec {
    id: number;
    /** Where it sits in the void (kept after its destruction). */
    x: number;
    y: number;
    /** The base (null once destroyed). */
    base: BuiltObject | null;
    guard: BuiltObject[];
    status: 'active' | 'destroyed';
    /** Per-empire knowledge: Suspected = its place is revealed (a captured capital's mind core); Confirmed = investigated (strength known). */
    knowledge: ThreatKnowledge[];
    /** Warships made here (the output). */
    built: number;
    /** Star date of the last guard ship made. */
    guardDate: number;
    /** What an investigation reported, per empire id: the guard's strength and the output at the time. */
    intel: Record<string, { date: number; guard: number; built: number }>;
    destroyedBy: number;
    destroyedDate: number;
}

/** A captured Reclaimer capital being held: when `by` has held it `since` + the hold time, one foundry is revealed. */
export interface HeldCapital {
    ship: BuiltObject;
    by: Empire;
    since: number;
}

export interface FoundryState {
    list: FoundryRec[];
    /** How many foundries there were at the start (the capacity baseline). */
    initial: number;
    nextId: number;
    /** Round robin index of the next building foundry; the fraction of a ship carried to the next pass. */
    rr: number;
    carry: number;
    /** Newborn warships still cloaked (until clear of the foundries). */
    fresh: BuiltObject[];
    held: HeldCapital[];
    /** Empire id to foundries it destroyed (the credit for the void frames) / tech pieces its investigations yielded (TODO: what tech is undecided). */
    destroyedBy: Record<string, number>;
    techPieces: Record<string, number>;
    /** Star dates of the last trap message per `empire:foundry`, of the last trap scan. */
    trapMsg: Record<string, number>;
    trapScan: number;
    stats: Record<string, number>;
}

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

function p(g: Galaxy, name: string, fallback: number): number {
    return scenarioParam(g, name, fallback);
}

export const F = {
    /** 0: by galaxy size (foundryCountFor). */
    count: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconFoundryCount', 0))),
    guardShips: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconFoundryGuardShips', 3))),
    /** Days between two replacement guard ships. */
    guardRebuildDays: (g: Galaxy) => p(g, 'beaconFoundryGuardRebuildDays', 90),
    armourPct: (g: Galaxy) => p(g, 'beaconFoundryArmourPct', 400),
    shieldPct: (g: Galaxy) => p(g, 'beaconFoundryShieldPct', 300),
    gunsPct: (g: Galaxy) => p(g, 'beaconFoundryGunsPct', 150),
    repairFactor: (g: Galaxy) => p(g, 'beaconFoundryRepairFactor', 6),
    /** Boarding defence of a Reclaimer capital (stock capital ~100-300) and of a foundry (out of reach: the stored value is a short). */
    capitalDefence: (g: Galaxy) => p(g, 'beaconFoundryCapitalDefence', 2500),
    baseDefence: (g: Galaxy) => p(g, 'beaconFoundryBaseDefence', 30000),
    /** Days a captured capital must be held before its core yields a foundry. */
    holdDays: (g: Galaxy) => p(g, 'beaconFoundryHoldDays', 5),
    /** A ship this close to a living foundry cannot hyperjump away. */
    trapRange: (g: Galaxy) => p(g, 'beaconFoundryTrapRange', 12000),
    /** A new warship stays cloaked until it is this far from every living foundry. */
    cloakRange: (g: Galaxy) => p(g, 'beaconFoundryCloakRange', 25000),
    /** Escorts (warships that are not capitals) a strike group must keep with its capitals (0: the rule is off). */
    capitalEscorts: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconFoundryCapitalEscorts', 1))),
    /** The investigation's concealment is the threat framework's; this is the weight of the guard in the strength it reports. */
    msgDays: (g: Galaxy) => p(g, 'beaconFoundryTrapMsgDays', 60),
};

// ---------------------------------------------------------------------------------------------------------------
// State, counts
// ---------------------------------------------------------------------------------------------------------------

/** How many foundries a galaxy of `stars` star systems has: 5 up to 250, linear to 10 at 1,000, linear to 20 at 4,000 (cap 20). Pure. */
export function foundryCountFor(stars: number): number {
    if (stars <= 250) return 5;
    if (stars <= 1000) return Math.round(5 + (5 * (stars - 250)) / 750);
    return Math.min(20, Math.round(10 + (10 * (stars - 1000)) / 3000));
}

export function starSystemCount(galaxy: Galaxy): number {
    let n = 0;
    for (const s of galaxy.systems) if (s !== null && s !== undefined && s.systemStar !== null && s.systemStar !== undefined) n++;
    return n;
}

function newFoundryState(initial: number): FoundryState {
    return { list: [], initial, nextId: 1, rr: 0, carry: 0, fresh: [], held: [], destroyedBy: {}, techPieces: {}, trapMsg: {}, trapScan: -1e18, stats: {} };
}

function stat(fs: FoundryState, key: string, n = 1): void {
    fs.stats[key] = (fs.stats[key] ?? 0) + n;
}

export function foundriesOf(st: BeaconState): FoundryState | null {
    return st.foundries ?? null;
}

export function liveFoundries(st: BeaconState): FoundryRec[] {
    return (st.foundries?.list ?? []).filter((f) => f.status === 'active' && f.base !== null && !f.base.hasBeenDestroyed);
}

export function foundryOf(st: BeaconState, bo: BuiltObject): FoundryRec | null {
    for (const f of st.foundries?.list ?? []) if (f.base === bo) return f;
    return null;
}

/** Foundries `empire` destroyed (the void-frame credit, wip/megapath). Pure. */
export function foundriesDestroyedBy(galaxy: Galaxy, empire: Empire): number {
    return peekBeaconState(galaxy)?.foundries?.destroyedBy[String(empire.empireId)] ?? 0;
}

function isWatcherShip(st: BeaconState, bo: BuiltObject): boolean {
    return st.watchers.some((w) => w.ship === bo);
}

/** A strike group's capital with fewer than beaconFoundryCapitalEscorts escorts (warships that are not capitals): it falls back. Pure. */
export function capitalAlone(galaxy: Galaxy, st: BeaconState, g: { ships: readonly BuiltObject[] }): boolean {
    const need = F.capitalEscorts(galaxy);
    if (need <= 0 || st.foundries === undefined || st.foundries.initial <= 0) return false;
    let capitals = 0;
    let escorts = 0;
    for (const b of g.ships) {
        if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.subRole === BuiltObjectSubRole.TroopTransport) continue;
        if (isReclaimerCapital(st, b)) capitals++;
        else escorts++;
    }
    return capitals > 0 && escorts < need;
}

/** Counts a foundry event in the state's stats (the soak's measure). */
export function foundryStat(st: BeaconState, key: string, n = 1): void {
    if (st.foundries !== undefined) stat(st.foundries, key, n);
}

/** A Reclaimer capital ship (not a Watcher, not the Beacon): the prize that reveals a foundry. Pure. */
export function isReclaimerCapital(st: BeaconState, bo: BuiltObject): boolean {
    return bo.role === BuiltObjectRole.Military && bo.subRole === BuiltObjectSubRole.CapitalShip && !isWatcherShip(st, bo) && bo !== st.beacon;
}

// ---------------------------------------------------------------------------------------------------------------
// Making them
// ---------------------------------------------------------------------------------------------------------------

const WEAPONS: ReadonlySet<ComponentType> = new Set([ComponentType.WeaponBeam, ComponentType.WeaponTorpedo, ComponentType.WeaponMissile, ComponentType.WeaponIonCannon]);

/** The foundry design: the faction's defensive base, plated and with more guns (the harvester's recipe, its own sizes); never an AI build. */
export function foundryDesign(galaxy: Galaxy, faction: Empire): Design | null {
    const name = T('Beacon Foundry Design');
    for (const d of faction.designs) if (d !== null && d.name === name) return d;
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === BuiltObjectSubRole.DefensiveBase) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.DefensiveBase);
    if (spec === null || spec === undefined) return null;
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, Math.max(1, empireTechLevel(faction)), galaxyStarDate(galaxy));
        if (d === null) return null;
        addPlating(d, [d], F.armourPct(galaxy), F.shieldPct(galaxy));
        const guns = d.components.filter((c) => WEAPONS.has(c.type));
        const n = Math.round((guns.length * F.gunsPct(galaxy)) / 100);
        for (let i = 0; i < n && guns.length > 0; i++) d.components.push(guns[i % guns.length]);
        if (n > 0) d.reDefine();
        d.name = name;
        d.isObsolete = true;
        faction.designs.push(d);
        return d;
    } catch {
        return null;
    }
}

/** Places `count` points in the empty void: clear of every star, outside the empires' territory (relaxed when the galaxy is crowded), spread apart. Rnd: the private one. */
export function placeFoundries(galaxy: Galaxy, st: BeaconState, count: number): { x: number; y: number }[] {
    const stars: { x: number; y: number }[] = [];
    for (const s of galaxy.systems) {
        const star = s?.systemStar ?? null;
        if (star !== null) stars.push({ x: star.xpos, y: star.ypos });
    }
    const rnd = beaconRandom(galaxy, st, 61);
    const beacon = beaconPosition(st);
    const spacing = Math.sqrt((galaxy.sizeX * galaxy.sizeY) / Math.max(1, count));
    const marginX = galaxy.sizeX * 0.04;
    const marginY = galaxy.sizeY * 0.04;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
        let best: { x: number; y: number } | null = null;
        for (let tries = 0; tries < 6000 && best === null; tries++) {
            // the demands relax as the tries run out: first outside every territory and well apart, at the end only clear of the systems
            const relax = tries / 6000;
            const clear = SYSTEM_RADIUS * (2 - relax * 0.8);
            const apart = spacing * (0.5 - relax * 0.4);
            const x = marginX + rnd.nextDouble() * (galaxy.sizeX - 2 * marginX);
            const y = marginY + rnd.nextDouble() * (galaxy.sizeY - 2 * marginY);
            if (relax < 0.7 && galaxy.checkEmpireTerritoryIdAtLocation(x, y) >= 0) continue;
            if (beacon !== null && Math.hypot(x - beacon.x, y - beacon.y) < clear * 2) continue;
            let ok = true;
            for (const s of stars) if (Math.abs(s.x - x) < clear && Math.abs(s.y - y) < clear && Math.hypot(s.x - x, s.y - y) < clear) { ok = false; break; }
            if (!ok) continue;
            for (const o of out) if (Math.hypot(o.x - x, o.y - y) < apart) { ok = false; break; }
            if (ok) best = { x, y };
        }
        if (best !== null) out.push(best);
    }
    return out;
}

function cloak(bo: BuiltObject): void {
    bo.cloaked = true;
}

/** Raises the foundries (once, when the Beacon is finished; an older save's reclamation pass calls it too). Idempotent. */
export function ensureFoundries(galaxy: Galaxy, st: BeaconState): FoundryState | null {
    if (st.foundries !== undefined) return st.foundries;
    const faction = st.faction;
    if (faction === null || st.phase !== 'reclamation') return null;
    const stars = starSystemCount(galaxy);
    const want = F.count(galaxy) > 0 ? Math.min(20, F.count(galaxy)) : foundryCountFor(stars);
    const fs = newFoundryState(want);
    st.foundries = fs;
    const design = foundryDesign(galaxy, faction);
    if (design === null) {
        fs.initial = 0;
        return fs;
    }
    const now = galaxyStarDate(galaxy);
    for (const pt of placeFoundries(galaxy, st, want)) {
        const base = spawnShip(galaxy, faction, design, pt.x, pt.y);
        const f: FoundryRec = { id: fs.nextId++, x: pt.x, y: pt.y, base, guard: [], status: 'active', knowledge: [], built: 0, guardDate: now, intel: {}, destroyedBy: 0, destroyedDate: 0 };
        base.name = T('Beacon Foundry Name', f.id);
        cloak(base);
        fs.list.push(f);
        topUpGuard(galaxy, st, f, F.guardShips(galaxy));
    }
    fs.initial = fs.list.length;
    stat(fs, 'placed', fs.list.length);
    return fs;
}

const GUARD_CYCLE: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate];

/** Adds up to `n` guard ships (free: the foundry makes its own guard) at `f`, cloaked. */
function topUpGuard(galaxy: Galaxy, st: BeaconState, f: FoundryRec, n: number): void {
    const faction = st.faction;
    if (faction === null) return;
    f.guard = f.guard.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === faction);
    for (let i = 0; i < n && f.guard.length < F.guardShips(galaxy); i++) {
        const d = designFor(galaxy, faction, GUARD_CYCLE[f.guard.length % GUARD_CYCLE.length]);
        if (d === null) return;
        const b = spawnShip(galaxy, faction, d, f.x, f.y);
        cloak(b);
        f.guard.push(b);
        f.guardDate = galaxyStarDate(galaxy);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Where new ships are made
// ---------------------------------------------------------------------------------------------------------------

/** The foundries make the new warships (season 2 on, at least one foundry was raised). Pure. */
export function producing(st: BeaconState): boolean {
    const fs = st.foundries;
    return fs !== undefined && fs.initial > 0 && st.stats.seasons >= 2;
}

/** The share of the baseline output that is alive (0-1). Pure. */
export function capacity(st: BeaconState): number {
    const fs = st.foundries;
    if (fs === undefined || fs.initial <= 0) return 1;
    return Math.min(1, liveFoundries(st).length / fs.initial);
}

/** How many of `batch` ships may be made this pass: all of them before the foundries make the ships (or with every foundry alive), else their living share (the fraction carries over). */
export function foundryBatch(st: BeaconState, batch: number): number {
    if (!producing(st)) return batch;
    const fs = st.foundries!;
    const cap = capacity(st);
    if (cap >= 1) return batch;
    fs.carry += batch * cap;
    const n = Math.min(batch, Math.floor(fs.carry + 1e-9));
    fs.carry -= n;
    return n;
}

export interface BuildPoint {
    x: number;
    y: number;
    foundry: FoundryRec | null;
}

/** Where the next ship is made: a living foundry in turn, else `fallback` (the Beacon). */
export function buildPoint(st: BeaconState, fallback: { x: number; y: number }): BuildPoint {
    if (!producing(st)) return { x: fallback.x, y: fallback.y, foundry: null };
    const live = liveFoundries(st);
    if (live.length === 0) return { x: fallback.x, y: fallback.y, foundry: null };
    const fs = st.foundries!;
    const f = live[fs.rr++ % live.length];
    return { x: f.x, y: f.y, foundry: f };
}

/** A ship was made at `at`: it leaves the foundry cloaked (the foundry's output is counted). */
export function noteBirth(st: BeaconState, at: BuildPoint, bo: BuiltObject): void {
    if (at.foundry === null) return;
    at.foundry.built++;
    st.foundries!.fresh.push(bo);
    cloak(bo);
}

// ---------------------------------------------------------------------------------------------------------------
// Knowledge: revealing, the cloak
// ---------------------------------------------------------------------------------------------------------------

/** The foundry `f` is revealed to `empire` at `level`; returns true when the level is new. The cloak lapses for that empire only. */
export function revealFoundry(galaxy: Galaxy, f: FoundryRec, empire: Empire, level: number): boolean {
    const fresh = revealTo(galaxy, f, empire, level);
    if (fresh) syncCloak(f);
    return fresh;
}

/** Sets the cloak of a foundry and its guard: hidden from all but the empires that know the place. */
function syncCloak(f: FoundryRec): void {
    const seen = f.knowledge.filter((k) => k.level >= KNOWLEDGE_SUSPECTED).map((k) => ({ empireId: k.empireId, until: FOREVER }));
    for (const b of f.base !== null ? [f.base, ...f.guard] : f.guard) {
        if (b.hasBeenDestroyed) continue;
        b.cloaked = true;
        b.cloakSeenBy = seen.map((s) => ({ ...s }));
    }
}

function unknownTo(galaxy: Galaxy, st: BeaconState, e: Empire): FoundryRec[] {
    return liveFoundries(st).filter((f) => knowledgeLevel(f, e) < KNOWLEDGE_SUSPECTED);
}

/** The foundries `empire` has found out (the Intelligence screen, the Knowledge page). Pure. */
export function foundriesKnownTo(st: BeaconState, empire: Empire): FoundryRec[] {
    return (st.foundries?.list ?? []).filter((f) => knowledgeLevel(f, empire) >= KNOWLEDGE_SUSPECTED);
}

function guardStrength(f: FoundryRec): number {
    let s = 0;
    for (const b of f.guard) if (!b.hasBeenDestroyed) s += strengthOf(b);
    return f.base !== null && !f.base.hasBeenDestroyed ? s + strengthOf(f.base) : s;
}

// ---------------------------------------------------------------------------------------------------------------
// Captured capitals
// ---------------------------------------------------------------------------------------------------------------

function onOwnerChanged(galaxy: Galaxy, bo: BuiltObject, from: Empire | null, to: Empire | null): void {
    const st = peekBeaconState(galaxy);
    const fs = st?.foundries;
    if (st === undefined || st === null || fs === undefined || st.faction === null || from !== st.faction || to === null || to === st.faction) return;
    if (!isReclaimerCapital(st, bo) || to === galaxy.independentEmpire) return;
    fs.held = fs.held.filter((h) => h.ship !== bo);
    fs.held.push({ ship: bo, by: to, since: galaxyStarDate(galaxy) });
    stat(fs, 'capitalsTaken');
    if (isHumanEmpire(galaxy, to)) scenarioMessage(galaxy, to, T(`${TAG} Foundry Held Title`), T(`${TAG} Foundry Held`, bo.name, F.holdDays(galaxy)), { type: EmpireMessageType.GeneralGoodEvent, subject: bo, popupMode: 'quiet' });
}

/** The held capitals: lost (retaken, destroyed) or held long enough (a foundry is revealed). */
function holdPass(galaxy: Galaxy, st: BeaconState, fs: FoundryState, now: number): void {
    if (fs.held.length === 0) return;
    const keep: HeldCapital[] = [];
    for (const h of fs.held) {
        if (h.ship.hasBeenDestroyed || h.ship.actualEmpire !== h.by || !h.by.active) {
            stat(fs, 'holdsLost');
            continue;
        }
        if (now - h.since < days(F.holdDays(galaxy))) {
            keep.push(h);
            continue;
        }
        const left = unknownTo(galaxy, st, h.by);
        if (left.length === 0) {
            stat(fs, 'holdsNothingLeft');
            continue;
        }
        const f = left[beaconRandom(galaxy, st, 62).next(0, left.length)];
        revealFoundry(galaxy, f, h.by, KNOWLEDGE_SUSPECTED);
        stat(fs, 'revealed');
        if (isHumanEmpire(galaxy, h.by)) scenarioMessage(galaxy, h.by, T(`${TAG} Foundry Reveal Title`), T(`${TAG} Foundry Reveal`, h.ship.name, f.base?.name ?? '?', Math.round(f.x), Math.round(f.y)), { type: EmpireMessageType.GeneralGoodEvent, subject: f.base });
    }
    fs.held = keep;
}

// ---------------------------------------------------------------------------------------------------------------
// The trap and the passes
// ---------------------------------------------------------------------------------------------------------------

/** True when a ship of `bo`'s kind may not start a hyperjump here: it is within the trap range of a living foundry and not the Reclaimers'. Pure. */
export function trappedAt(galaxy: Galaxy, st: BeaconState, bo: BuiltObject): FoundryRec | null {
    if (st.foundries === undefined || st.faction === null || bo.actualEmpire === st.faction) return null;
    const range = F.trapRange(galaxy);
    for (const f of st.foundries.list) {
        if (f.status !== 'active' || f.base === null || f.base.hasBeenDestroyed) continue;
        if (Math.abs(bo.xpos - f.x) <= range && Math.abs(bo.ypos - f.y) <= range && Math.hypot(bo.xpos - f.x, bo.ypos - f.y) <= range) return f;
    }
    return null;
}

function trapPass(galaxy: Galaxy, st: BeaconState, fs: FoundryState, now: number): void {
    if (now - fs.trapScan < days(5)) return;
    fs.trapScan = now;
    if (liveFoundries(st).length === 0) return;
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (!isHumanEmpire(galaxy, e)) continue;
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.warpSpeed <= 0) continue;
            const f = trappedAt(galaxy, st, b);
            if (f === null) continue;
            const key = `${e.empireId}:${f.id}`;
            if (fs.trapMsg[key] !== undefined && now - fs.trapMsg[key] < days(F.msgDays(galaxy))) continue;
            fs.trapMsg[key] = now;
            stat(fs, 'trapped');
            scenarioMessage(galaxy, e, T(`${TAG} Foundry Trap Title`), T(`${TAG} Foundry Trap`, b.name, f.base?.name ?? '?'), { type: EmpireMessageType.GeneralWarning, subject: b });
        }
    }
}

/** A foundry's base was destroyed (by `destroyer`, null: no empire): credit, the event, the guard released, the news. */
function foundryFell(galaxy: Galaxy, st: BeaconState, fs: FoundryState, f: FoundryRec, destroyer: Empire | null): void {
    if (f.status === 'destroyed') return;
    const now = galaxyStarDate(galaxy);
    f.status = 'destroyed';
    f.destroyedDate = now;
    f.destroyedBy = destroyer?.empireId ?? 0;
    const base = f.base;
    f.base = null;
    stat(fs, 'destroyed');
    // its guard no longer hides: the survivors join the reserve
    for (const b of f.guard) {
        if (b.hasBeenDestroyed) continue;
        b.cloaked = false;
        b.cloakSeenBy = undefined;
        st.reserve.push(b);
    }
    f.guard = [];
    foundryDestroyed(galaxy, destroyer, f);
    if (destroyer !== null && isHumanEmpire(galaxy, destroyer)) scenarioMessage(galaxy, destroyer, T(`${TAG} Foundry Destroyed Title`), T(`${TAG} Foundry Destroyed`, base?.name ?? '?', liveFoundries(st).length, fs.initial), { type: EmpireMessageType.GeneralGoodEvent, popupMode: 'quiet' });
    scenarioNews(galaxy, null, T(`${TAG} Foundry Destroyed News`, destroyer?.name ?? '?', liveFoundries(st).length, fs.initial), () => true, null);
}

/**
 * Credits `empire` with a destroyed foundry and tells the scenario (the `foundryDestroyed` event: the void-frame components of wip/megapath
 * count from foundriesDestroyedBy). `empire` is null when no empire did it (a monster, a self-destruct): no credit.
 */
export function foundryDestroyed(galaxy: Galaxy, empire: Empire | null, foundry: FoundryRec): void {
    const st = peekBeaconState(galaxy);
    if (empire !== null && st?.foundries !== undefined) st.foundries.destroyedBy[String(empire.empireId)] = (st.foundries.destroyedBy[String(empire.empireId)] ?? 0) + 1;
    scenarioEmit(galaxy, 'foundryDestroyed', { empire, foundry });
}

export function foundryPass(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || !st.faction.active) return;
    if (st.phase !== 'reclamation') return;
    const fs = ensureFoundries(galaxy, st);
    if (fs === null) return;
    const now = galaxyStarDate(galaxy);
    // a base that fell without a killing blow we saw (torn down by a monster, a mission): no credit
    for (const f of fs.list) if (f.status === 'active' && (f.base === null || f.base.hasBeenDestroyed || f.base.actualEmpire !== st.faction)) foundryFell(galaxy, st, fs, f, null);
    // the newborn ships uncloak once clear of every living foundry
    if (fs.fresh.length > 0) {
        const range = F.cloakRange(galaxy);
        const live = liveFoundries(st);
        fs.fresh = fs.fresh.filter((b) => {
            if (b.hasBeenDestroyed) return false;
            if (live.some((f) => Math.hypot(b.xpos - f.x, b.ypos - f.y) <= range)) return true;
            b.cloaked = false;
            return false;
        });
    }
    for (const f of liveFoundries(st)) {
        f.guard = f.guard.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === st.faction);
        if (f.guard.length < F.guardShips(galaxy) && now - f.guardDate >= days(F.guardRebuildDays(galaxy))) topUpGuard(galaxy, st, f, 1);
        syncCloak(f);
    }
    holdPass(galaxy, st, fs, now);
    trapPass(galaxy, st, fs, now);
}

// ---------------------------------------------------------------------------------------------------------------
// Rows, intel
// ---------------------------------------------------------------------------------------------------------------

export function foundryKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekBeaconState(galaxy);
    if (st === null || st.foundries === undefined) return [];
    const out: KnownThreatSite[] = [];
    for (const f of st.foundries.list) {
        const level = knowledgeLevel(f, empire);
        if (level < KNOWLEDGE_SUSPECTED || f.status !== 'active' || f.base === null || f.base.hasBeenDestroyed) continue;
        const intel = f.intel[String(empire.empireId)];
        out.push({
            threat: FOUNDRY_KEY,
            kind: 'ship',
            target: f.base,
            level,
            site: f,
            label: T(`${TAG} Foundry Row`, f.base.name),
            status: intel === undefined ? T(`${TAG} Foundry Status`) : T(`${TAG} Foundry Status Intel`, Math.round(intel.guard).toLocaleString('en-US'), intel.built),
        });
    }
    return out;
}

/** Resolves an investigation of the foundry at `target` (the framework's resolution roll came up `success`); the message to send. */
export function resolveFoundryInvestigation(g: Galaxy, e: Empire, target: BuiltObject, agent: { name: string }, success: boolean): { title: string; text: string; good: boolean } {
    const st = peekBeaconState(g);
    const f = st === null ? null : foundryOf(st, target);
    const where = target.name;
    const title = T(`${TAG} Foundry Investigation Title`);
    if (st === null || f === null || !success) return { title, text: T(`${TAG} Foundry Investigation Nothing`, agent.name, where), good: false };
    const guard = guardStrength(f);
    revealFoundry(g, f, e, KNOWLEDGE_CONFIRMED);
    f.intel[String(e.empireId)] = { date: galaxyStarDate(g), guard, built: f.built };
    const fs = st.foundries!;
    // TODO(foundries): the tech piece an investigation yields: which technology is undecided, only the count is kept
    fs.techPieces[String(e.empireId)] = (fs.techPieces[String(e.empireId)] ?? 0) + 1;
    stat(fs, 'investigated');
    return { title, text: T(`${TAG} Foundry Investigation Found`, agent.name, where, Math.round(guard).toLocaleString('en-US'), f.built), good: true };
}

function registerIntel(): void {
    registerThreatInvestigation(FOUNDRY_KEY, {
        blocked: (g, e, target) => {
            const st = peekBeaconState(g);
            const f = st === null ? null : foundryOf(st, target as BuiltObject);
            return f === null || f.status !== 'active' ? 'Nothing to investigate' : null;
        },
        resolve: (g, e, target, agent, success) => resolveFoundryInvestigation(g, e, target as BuiltObject, agent, success),
    });
}

/** Tech pieces `empire` has earned from investigating foundries (TODO: the tech itself is undecided). Pure. */
export function foundryTechPieces(galaxy: Galaxy, empire: Empire): number {
    return peekBeaconState(galaxy)?.foundries?.techPieces[String(empire.empireId)] ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration (called from beacon.ts registerBeacon)
// ---------------------------------------------------------------------------------------------------------------

export function registerFoundry(): void {
    registerScenarioFramePeriodic({ id: 'beacon.foundry', flag: BEACON_FLAG, order: 26, periodDays: 2, run: (g) => foundryPass(g) });
    registerScenarioEvent({ id: 'beacon.foundryCapital', flag: BEACON_FLAG, event: 'builtObjectOwnerChanged', run: (g, e) => onOwnerChanged(g, e.builtObject, e.from, e.to) });
    registerScenarioEvent({
        id: 'beacon.foundryKilled',
        flag: BEACON_FLAG,
        event: 'builtObjectKilledBy',
        run: (g, e) => {
            const st = peekBeaconState(g);
            const fs = st?.foundries;
            if (st === null || fs === undefined) return;
            const f = foundryOf(st, e.builtObject);
            if (f !== null) foundryFell(g, st, fs, f, e.destroyer !== null && e.destroyer !== st.faction ? e.destroyer : null);
        },
    });
    // capitals and the foundry bases are all but unboardable
    registerScenarioQuery({
        id: 'beacon.foundryBoarding',
        flag: BEACON_FLAG,
        query: 'boardingDefenseValue',
        run: (g, v, a) => {
            const st = peekBeaconState(g);
            if (st === null || st.faction === null || st.foundries === undefined || a.builtObject.actualEmpire !== st.faction) return v;
            if (foundryOf(st, a.builtObject) !== null) return Math.max(v, F.baseDefence(g));
            return isReclaimerCapital(st, a.builtObject) ? Math.max(v, F.capitalDefence(g)) : v;
        },
    });
    registerScenarioQuery({
        id: 'beacon.foundryTrap',
        flag: BEACON_FLAG,
        query: 'hyperDenyHere',
        run: (g, v, a) => {
            if (v) return v;
            const st = peekBeaconState(g);
            return st !== null && st.foundries !== undefined && trappedAt(g, st, a.builtObject) !== null;
        },
    });
    // the foundries mend themselves quickly (the Reclaimers' own factor, beacon.repair, applies on top)
    registerScenarioQuery({
        id: 'beacon.foundryRepair',
        flag: BEACON_FLAG,
        query: 'repairRateFactor',
        run: (g, v, a) => {
            const st = peekBeaconState(g);
            if (st === null || st.foundries === undefined || a.builtObject.actualEmpire !== st.faction) return v;
            const b = a.builtObject;
            return foundryOf(st, b) !== null || st.foundries.list.some((f) => f.guard.includes(b)) ? v * F.repairFactor(g) : v;
        },
    });
    registerThreatKnownSites(FOUNDRY_KEY, foundryKnownSites);
    registerIntel();
}
