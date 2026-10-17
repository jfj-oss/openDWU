// The Beacon (Giantworks wonder, flag gwBeacon; design plan section 3.D, decisions in sections 10-13). Not a port: new scenario
// behaviour composed of ported functions. Registered from scenario/packages.ts; every handler is gated by the gwBeacon flag, so with
// the flag off nothing here runs and nothing draws. Part 1 of 3 (beaconFleet.ts: the Reclamation; beaconCounter.ts: counterplay).
//
// Before the Great Work is finished: two Watchers, huge cloaked mega-ships of the machine faction, wait in dark space beyond the
// galaxy rim. Every few months a Watcher drifts (cloaked) over a colony that was independent at the start, dwells there and
// CORRUPTS it (the Cult's conversion: the governor and the people quietly serve the Beacon). Corrupted worlds speed the build up
// (buildRateMultiplier) and send freighters to the site even when an empire owns them (extraSuppliers). Now and then a Watcher
// SHOWS ITSELF: it drops its cloak over a colony for a few days, passive (it is at war with no one; the AI never targets it),
// then slips away and cloaks again; it fights only if attacked (then it is at locked war with the attacker). Very hard to kill;
// killing one slows the build sharply.
// When the Beacon is finished the Reclamation begins (beaconFleet.ts). The Watchers go on corrupting and showing themselves.
//
// Cloak: a built object with `cloaked` set is not seen by any other empire (independentTraders.ts isObjectVisibleToThisEmpire,
// the fog layer), unless its empire is listed in `cloakSeenBy` (a ship or base of that empire spotted it: detectCloaked).
//
// Rnd: decisions use the private beaconRandom; the stock functions called (faction, design, ship, character generation) draw galaxy.rnd.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import { HabitatType } from '../../../types';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { ComponentType } from '../../../data/components';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { generateDesignFromSpec } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { calculateOverallStrengthFactorWithoutShields } from '../../../diplomacyTick';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { isHumanEmpire } from '../../../humanEmpires';
import { GameEndOutcome } from '../../../victory';
import { CharacterRole, getEmpireCharacters } from '../../../characters';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery } from '../../hooks';
import { registerScenarioMapFeatures, type ScenarioMapFeatures } from '../../mapFeatures';
import { scenarioMessage, scenarioText as T } from '../../messages';
import { colonyGovernor, spawnGovernorFor } from '../../governors';
import { isObjectVisibleToThisEmpire } from '../../../independentTraders';
import {
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_RUMOUR,
    KNOWLEDGE_SUSPECTED,
    arcMessage,
    arcNews,
    createThreatFaction,
    knowledgeLevel,
    lockWar,
    normalEmpires,
    registerThreatKnownSites,
    revealTo,
    threatGameEnd,
    type KnownThreatSite,
} from '../framework';
import { genShipsSpawnPoint } from '../generationShips';
import { registerCrisisHelpers } from '../crisis';
import { refitInPlace } from '../framework';
import { greatWorkProtectors, markGreatWorkHostile, registerGreatWork, registerHostileWonderCrisis } from './framework';
import type { GreatWorkKind, GreatWorkSite } from './types';
import {
    BEACON_CODE_VICTORY,
    BEACON_FLAG,
    BEACON_KEY,
    BEACON_KIND,
    P,
    activeCorruption,
    beaconRandom,
    beaconState,
    galaxyPopulation,
    liveWatchers,
    peekBeaconState,
    watcherShips,
    type BeaconState,
    type CorruptRec,
    type WatcherRec,
} from './beaconState';
import {
    addPlating,
    defenceOf,
    designFor,
    eliminatedPct,
    lossCheck,
    machineRace,
    onColonyOwnerChanged as fleetOnColonyOwnerChanged,
    onHabitatDestroyed as fleetOnHabitatDestroyed,
    onShipKilled,
    processingWorlds,
    reclaimerLevel,
    reclamationMonthly,
    reclamationPeriodic,
    referenceMilitary,
    spawnShip,
    syncReclaimerTech,
} from './beaconFleet';
import { counterIntelligencePass, counterMonthly, onBoarded, onKilledForSalvage, registerCounterplay, resistanceFactor } from './beaconCounter';

declare module '../../../builtObject' {
    interface BuiltObject {
        /** The Beacon's Watchers: the ship is invisible to every other empire (independentTraders.ts / render/fog.ts), absent unless in use. */
        cloaked?: boolean;
        /** Empire ids whose sensors currently see through the cloak, with the star date it lapses. */
        cloakSeenBy?: { empireId: number; until: number }[];
    }
}

const TAG = 'Beacon';
const WATCHER_DAYS = 2;

// ---------------------------------------------------------------------------------------------------------------
// The Watchers: faction, design, ships
// ---------------------------------------------------------------------------------------------------------------

const WEAPONS: ReadonlySet<ComponentType> = new Set([ComponentType.WeaponBeam, ComponentType.WeaponTorpedo, ComponentType.WeaponMissile, ComponentType.WeaponIonCannon, ComponentType.WeaponSuperBeam]);

/** Adds copies of the design's own weapons: `extra` times their number (Gen Ships' plating approach, for guns). */
function boostWeapons(d: import('../../../design').Design, extra: number): void {
    const guns = d.components.filter((c) => WEAPONS.has(c.type));
    if (guns.length === 0) return;
    const n = Math.round(guns.length * extra);
    for (let i = 0; i < n; i++) d.components.push(guns[i % guns.length]);
    if (n > 0) d.reDefine();
}

function watcherDesign(galaxy: Galaxy, faction: Empire, lvl: number): import('../../../design').Design | null {
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === BuiltObjectSubRole.CapitalShip) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.CapitalShip);
    if (spec === null || spec === undefined) return null;
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, lvl, galaxyStarDate(galaxy));
        if (d === null) return null;
        addPlating(d, [d], P.watcherArmourPct(galaxy), P.watcherShieldPct(galaxy));
        boostWeapons(d, P.watcherGuns(galaxy));
        d.name = T('Beacon Watcher Name', '');
        d.isObsolete = true; // never an AI build
        faction.designs.push(d);
        return d;
    } catch {
        return null;
    }
}

/** The one machine faction ("the Watchers"), created on first use. Returns null when no empire id is left. */
function ensureFaction(galaxy: Galaxy, st: BeaconState, home: { x: number; y: number }): Empire | null {
    if (st.faction !== null && st.faction.active) return st.faction;
    const race = machineRace(galaxy);
    if (race === null) return null;
    const lvl = reclaimerLevel(galaxy, null, P.watcherTechBonus(galaxy));
    const faction = createThreatFaction(galaxy, { race, name: T('Beacon Faction Watchers'), techLevel: lvl, relationBias: 0 });
    if (faction === null) return null;
    // As Generation Ships: the stock AI reads Empire.Capital without a null check; a habitat near the rim stands in until it holds a world.
    faction.capital = galaxy.findNearestHabitatOfType(home.x, home.y, HabitatType.Undefined);
    syncReclaimerTech(galaxy, faction, lvl, true);
    st.faction = faction;
    return faction;
}

function rimPoint(galaxy: Galaxy, angle: number): { x: number; y: number } {
    const cx = galaxy.sizeX / 2;
    const cy = galaxy.sizeY / 2;
    return genShipsSpawnPoint(galaxy, { xpos: cx + Math.cos(angle) * galaxy.sizeX, ypos: cy + Math.sin(angle) * galaxy.sizeY } as Habitat);
}

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

// ---------------------------------------------------------------------------------------------------------------
// onRolled: the Watchers appear (cloaked, at the rim)
// ---------------------------------------------------------------------------------------------------------------

export function beaconRolled(galaxy: Galaxy, site: GreatWorkSite): void {
    const st = beaconState(galaxy);
    if (st.watchers.length > 0) return;
    st.site = site;
    st.phase = 'watching';
    const now = galaxyStarDate(galaxy);
    const rnd = beaconRandom(galaxy, st, 1);
    st.formerIndependents = galaxy.independentColonies.filter((c) => !c.hasBeenDestroyed);
    const a0 = rnd.nextDouble() * Math.PI * 2;
    const count = P.watcherCount(galaxy);
    const homes = Array.from({ length: count }, (_, i) => rimPoint(galaxy, a0 + (i * Math.PI * 2) / count + (rnd.nextDouble() - 0.5) * 0.6));
    const faction = ensureFaction(galaxy, st, homes[0]);
    if (faction === null) return;
    const lvl = reclaimerLevel(galaxy, faction, P.watcherTechBonus(galaxy));
    const design = watcherDesign(galaxy, faction, lvl) ?? designFor(galaxy, faction, BuiltObjectSubRole.CapitalShip);
    if (design === null) return;
    homes.forEach((h, i) => {
        const ship = spawnShip(galaxy, faction, design, h.x, h.y);
        ship.name = T('Beacon Watcher Name', i + 1);
        ship.cloaked = true;
        const w: WatcherRec = {
            index: i, ship, mode: 'parked', homeX: h.x, homeY: h.y, target: null, modeDate: now, nextCorruptDate: now + days(P.corruptMinDays(galaxy) * (0.6 + 0.8 * rnd.nextDouble()) + 30 + i * 70), until: 0, dead: false,
            attackedBy: [], knowledge: [], detections: 0,
        };
        st.watchers.push(w);
    });
    st.nextSightingDate = now + days(P.sightingMinDays(galaxy) + rnd.nextDouble() * (P.sightingMaxDays(galaxy) - P.sightingMinDays(galaxy)));
}

// ---------------------------------------------------------------------------------------------------------------
// Movement and the cloak
// ---------------------------------------------------------------------------------------------------------------

function sendTo(galaxy: Galaxy, bo: BuiltObject, x: number, y: number, target: Habitat | null = null): void {
    const m = builtObjectMission(bo.mission);
    if (target !== null) {
        if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === target) return;
        bo.isAutoControlled = false;
        assignMission(galaxy, bo, BuiltObjectMissionType.Move, target, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        return;
    }
    if (m !== null && m.type === BuiltObjectMissionType.Move && m.targetHabitat === null && Math.abs(m.x - x) < 1 && Math.abs(m.y - y) < 1) return;
    bo.isAutoControlled = false;
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x, y, manuallyAssigned: true });
}

function arrived(galaxy: Galaxy, bo: BuiltObject, x: number, y: number, within = 9000): boolean {
    return galaxy.calculateDistance(bo.xpos, bo.ypos, x, y) <= within;
}

/** True when the cloak does not hide `bo` from `empire` right now. Pure. */
export function cloakLapsedFor(bo: BuiltObject, empire: Empire, now: number): boolean {
    if (bo.cloaked !== true) return true;
    if (bo.cloakSeenBy === undefined) return false;
    for (const s of bo.cloakSeenBy) if (s.empireId === empire.empireId && s.until > now) return true;
    return false;
}

/** Ships and bases of `empire` within `range` of (x, y): the nearest distance, Infinity when none. */
function nearestOwnUnit(galaxy: Galaxy, empire: Empire, x: number, y: number): number {
    let best = Infinity;
    for (const list of [empire.builtObjects, empire.privateBuiltObjects]) {
        for (const b of list) {
            if (b.hasBeenDestroyed) continue;
            const d = galaxy.calculateDistance(b.xpos, b.ypos, x, y);
            if (d < best) best = d;
        }
    }
    for (const c of empire.colonies) {
        const d = galaxy.calculateDistance(c.xpos, c.ypos, x, y);
        if (d < best) best = d;
    }
    return best;
}

/**
 * Every 2 days: an empire with a ship, base or colony close to a cloaked Watcher may spot it (beaconDetectPct per check); the
 * cloak then lapses for that empire for beaconDetectSeenDays, and its knowledge of the Watchers rises (1 rumour, 2 suspected
 * after a second sighting, 3 confirmed once it was seen uncloaked).
 */
function detectCloaked(galaxy: Galaxy, st: BeaconState, w: WatcherRec): void {
    const ship = w.ship;
    if (ship === null || ship.hasBeenDestroyed || ship.cloaked !== true) return;
    const now = galaxyStarDate(galaxy);
    ship.cloakSeenBy = (ship.cloakSeenBy ?? []).filter((s) => s.until > now);
    const rnd = beaconRandom(galaxy, st, 61 + w.index);
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (ship.cloakSeenBy.some((s) => s.empireId === e.empireId)) continue;
        if (nearestOwnUnit(galaxy, e, ship.xpos, ship.ypos) > P.detectRange(galaxy)) continue;
        if (rnd.nextDouble() * 100 >= P.detectPct(galaxy)) continue;
        ship.cloakSeenBy.push({ empireId: e.empireId, until: now + days(P.detectSeenDays(galaxy)) });
        w.detections++;
        st.stats.watcherDetections++;
        const first = knowledgeLevel({ knowledge: w.knowledge }, e) === 0;
        revealTo(galaxy, { knowledge: w.knowledge }, e, knowledgeLevel({ knowledge: w.knowledge }, e) >= KNOWLEDGE_RUMOUR ? KNOWLEDGE_SUSPECTED : KNOWLEDGE_RUMOUR);
        if (first && isHumanEmpire(galaxy, e)) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Detect', onceKey: `Detect:${w.index}:${e.empireId}`, args: [placeName(galaxy, ship)], type: EmpireMessageType.GeneralWarning, subject: ship });
    }
}

function placeName(galaxy: Galaxy, o: { xpos: number; ypos: number }): string {
    let best: string | null = null;
    let bd = Infinity;
    for (const sys of galaxy.systems) {
        const s = sys?.systemStar ?? null;
        if (s === null) continue;
        const d = galaxy.calculateDistance(o.xpos, o.ypos, s.xpos, s.ypos);
        if (d < bd) {
            bd = d;
            best = s.name;
        }
    }
    return best ?? '';
}

// ---------------------------------------------------------------------------------------------------------------
// Corruption
// ---------------------------------------------------------------------------------------------------------------

/** Former-independent colonies a Watcher may corrupt: alive, populated, not already corrupted, not in the Reclaimers' hands. Pure. */
export function corruptCandidates(_galaxy: Galaxy, st: BeaconState): Habitat[] {
    const taken = new Set<Habitat>(st.corrupted.filter((c) => c.ended === null).map((c) => c.colony));
    return st.formerIndependents.filter((c) => !c.hasBeenDestroyed && c.population.totalAmount > 0 && !taken.has(c) && c.empire !== st.faction);
}

/** Corrupts `colony` now: its governor (a new one if it has none) and people quietly serve the Beacon. Draws galaxy.rnd only through governor creation. */
export function corrupt(galaxy: Galaxy, st: BeaconState, colony: Habitat): CorruptRec | null {
    if (st.corrupted.some((c) => c.colony === colony && c.ended === null)) return null;
    const owner = colony.empire;
    let governor = null as CorruptRec['governor'];
    if (owner !== null && owner !== galaxy.independentEmpire && owner.pirateEmpireBaseHabitat === null && owner !== st.faction) {
        governor = colonyGovernor(colony);
        if (governor === null && getEmpireCharacters(owner).some((c) => c.role === CharacterRole.ColonyGovernor)) governor = spawnGovernorFor(galaxy, owner, colony);
    }
    const rec: CorruptRec = { colony, governor, date: galaxyStarDate(galaxy), knowledge: [], ended: null, endDate: 0 };
    st.corrupted.push(rec);
    st.stats.corrupted++;
    return rec;
}

// ---------------------------------------------------------------------------------------------------------------
// The Watchers' routine: drift, dwell, corrupt; show themselves; fight when attacked
// ---------------------------------------------------------------------------------------------------------------

function pickCorruptTarget(galaxy: Galaxy, st: BeaconState, w: WatcherRec): Habitat | null {
    const ship = w.ship!;
    const taken = st.watchers.map((x) => x.target).filter((t): t is Habitat => t !== null);
    const cands = corruptCandidates(galaxy, st).filter((c) => !taken.includes(c));
    if (cands.length === 0) return null;
    cands.sort((a, b) => galaxy.calculateDistance(ship.xpos, ship.ypos, a.xpos, a.ypos) - galaxy.calculateDistance(ship.xpos, ship.ypos, b.xpos, b.ypos));
    return cands[beaconRandom(galaxy, st, 71 + w.index).next(0, Math.min(6, cands.length))];
}

function pickSightingTarget(galaxy: Galaxy, st: BeaconState): Habitat | null {
    const rnd = beaconRandom(galaxy, st, 81);
    const normals = normalEmpires(galaxy, st.faction).filter((e) => e.colonies.length > 0);
    if (normals.length === 0) return null;
    const player = galaxy.playerEmpire;
    // the player's own colonies half the time: the "what was that" moment
    const owner = player !== null && player !== undefined && player.active && player.colonies.length > 0 && rnd.nextDouble() < 0.5 ? player : normals[rnd.next(0, normals.length)];
    const own = owner.colonies.filter((c) => !c.hasBeenDestroyed && c.population.totalAmount > 0);
    if (own.length === 0) return null;
    return own[rnd.next(0, own.length)];
}

function setMode(w: WatcherRec, mode: WatcherRec['mode'], now: number): void {
    w.mode = mode;
    w.modeDate = now;
}

function goHome(galaxy: Galaxy, st: BeaconState, w: WatcherRec, now: number): void {
    const ship = w.ship!;
    ship.cloaked = true;
    w.target = null;
    setMode(w, 'return', now);
    sendTo(galaxy, ship, w.homeX, w.homeY);
    void st;
}

/** After a job it does not sail back to the rim: it slips away from the colony into the nearest deep space and rests there, cloaked. */
function goRest(galaxy: Galaxy, st: BeaconState, w: WatcherRec, from: { xpos: number; ypos: number }, now: number): void {
    const cx = galaxy.sizeX / 2;
    const cy = galaxy.sizeY / 2;
    let dx = from.xpos - cx;
    let dy = from.ypos - cy;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    dx /= len;
    dy /= len;
    w.homeX = Math.min(galaxy.sizeX - 1000, Math.max(1000, from.xpos + dx * 300000));
    w.homeY = Math.min(galaxy.sizeY - 1000, Math.max(1000, from.ypos + dy * 300000));
    goHome(galaxy, st, w, now);
}

/** One Watcher's turn (every 2 days). */
function driveWatcher(galaxy: Galaxy, st: BeaconState, w: WatcherRec, sightingOpen: boolean): boolean {
    const ship = w.ship;
    if (w.dead || ship === null) return false;
    if (ship.hasBeenDestroyed) return false;
    const now = galaxyStarDate(galaxy);
    if (ship.fuelCapacity > 0) ship.currentFuel = ship.fuelCapacity;
    if (w.mode === 'fight') {
        // Cloak down while it fights; it slips away once no attacker is near for 15 days.
        ship.cloaked = false;
        let near = false;
        for (const id of w.attackedBy) {
            const e = galaxy.empires.find((x) => x !== null && x.empireId === id);
            if (e === undefined || e === null) continue;
            for (const b of e.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && galaxy.calculateDistance(b.xpos, b.ypos, ship.xpos, ship.ypos) < 60000) near = true;
        }
        // (w.until marks when the fight began: it breaks off, and cloaks, after 45 days however near its enemies still are)
        if (near && now - w.until < days(45)) w.modeDate = now;
        else if (now - w.modeDate > days(15) || now - w.until >= days(45)) goHome(galaxy, st, w, now);
        return false;
    }
    if (w.mode === 'parked' || w.mode === 'return') {
        if (w.mode === 'return' && arrived(galaxy, ship, w.homeX, w.homeY)) setMode(w, 'parked', now);
        else if (w.mode === 'return') sendTo(galaxy, ship, w.homeX, w.homeY);
        if (w.mode === 'parked' && !arrived(galaxy, ship, w.homeX, w.homeY, 40000)) sendTo(galaxy, ship, w.homeX, w.homeY);
        if (w.mode !== 'parked') return false;
        if (sightingOpen && now >= st.nextSightingDate) {
            const t = pickSightingTarget(galaxy, st);
            if (t !== null) {
                w.target = t;
                setMode(w, 'travel', now);
                w.until = -1; // marks a sighting trip
                sendTo(galaxy, ship, t.xpos, t.ypos, t);
                return true;
            }
        }
        if (now >= w.nextCorruptDate) {
            const t = pickCorruptTarget(galaxy, st, w);
            if (t === null) {
                w.nextCorruptDate = now + days(P.corruptMinDays(galaxy));
                return false;
            }
            w.target = t;
            setMode(w, 'travel', now);
            w.until = 0;
            sendTo(galaxy, ship, t.xpos, t.ypos, t);
        }
        return false;
    }
    const t = w.target;
    if (t === null || t.hasBeenDestroyed) {
        goHome(galaxy, st, w, now);
        return false;
    }
    if (w.mode === 'travel') {
        if (arrived(galaxy, ship, t.xpos, t.ypos, 12000)) {
            if (w.until === -1) {
                ship.cloaked = false;
                setMode(w, 'sighting', now);
                w.until = now + days(P.sightingDays(galaxy));
                sightingStarts(galaxy, st, w, t);
            } else setMode(w, 'dwell', now);
        } else sendTo(galaxy, ship, t.xpos, t.ypos, t);
        return w.until === -1;
    }
    if (w.mode === 'dwell') {
        if (now - w.modeDate >= days(P.dwellDays(galaxy))) {
            corrupt(galaxy, st, t);
            const rnd = beaconRandom(galaxy, st, 91 + w.index);
            w.nextCorruptDate = now + days(P.corruptMinDays(galaxy) + rnd.nextDouble() * (P.corruptMaxDays(galaxy) - P.corruptMinDays(galaxy)));
            goRest(galaxy, st, w, t, now);
        }
        return false;
    }
    if (w.mode === 'sighting') {
        if (now >= w.until) {
            sightingEnds(galaxy, st, w, t);
            goRest(galaxy, st, w, t, now);
            const rnd = beaconRandom(galaxy, st, 95);
            st.nextSightingDate = now + days(P.sightingMinDays(galaxy) + rnd.nextDouble() * (P.sightingMaxDays(galaxy) - P.sightingMinDays(galaxy)));
        }
        return false;
    }
    return false;
}

function sightingStarts(galaxy: Galaxy, st: BeaconState, w: WatcherRec, over: Habitat): void {
    st.stats.sightings++;
    const star = galaxy.determineHabitatSystemStar(over);
    const where = star?.name ?? over.name;
    const ship = w.ship!;
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (isObjectVisibleToThisEmpire(galaxy, e, ship)) revealTo(galaxy, { knowledge: w.knowledge }, e, KNOWLEDGE_CONFIRMED);
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Sighting', onceKey: `Sighting${st.stats.sightings}`, textTag: `${TAG} Sighting News`, args: [over.name, where], subject: ship });
    const owner = over.empire;
    if (owner !== null && owner !== galaxy.independentEmpire && owner !== st.faction && owner.active) {
        scenarioMessage(galaxy, owner, T(`${TAG} Sighting Title`), T(`${TAG} Sighting`, over.name), { type: EmpireMessageType.GeneralWarning, subject: ship, popup: isHumanEmpire(galaxy, owner) });
    }
}

function sightingEnds(galaxy: Galaxy, st: BeaconState, w: WatcherRec, over: Habitat): void {
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Sighting Gone', onceKey: `SightingGone${st.stats.sightings}`, textTag: `${TAG} Sighting Gone News`, args: [over.name] });
    void w;
}

/** Every 2 days: the Watchers' routine and the cloak check. */
export function watchersPeriodic(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || !st.faction.active || st.watchers.length === 0) return;
    // the Great Work was abandoned or destroyed before it was finished (the framework's own record): the Watchers leave
    const phase = (st.site as { phase?: string } | null)?.phase;
    if (st.phase === 'watching' && (phase === 'abandoned' || phase === 'destroyed')) {
        beaconDestroyedEarly(galaxy, st.site!, null);
        return;
    }
    // a Watcher that no longer exists is dead
    for (const w of st.watchers) {
        if (!w.dead && (w.ship === null || w.ship.hasBeenDestroyed)) markDead(galaxy, st, w, null);
    }
    let sightingBusy = st.watchers.some((x) => !x.dead && (x.until === -1 || x.mode === 'sighting'));
    for (const w of st.watchers) {
        const started = driveWatcher(galaxy, st, w, !sightingBusy);
        if (started) sightingBusy = true;
        detectCloaked(galaxy, st, w);
    }
    st.sighted = st.watchers.filter((w) => !w.dead && w.ship !== null && !w.ship.hasBeenDestroyed && w.ship.cloaked !== true).map((w) => w.ship!);
    // corrupted worlds that no longer exist are gone
    for (const c of st.corrupted) if (c.ended === null && c.colony.hasBeenDestroyed) {
        c.ended = 'lost';
        c.endDate = galaxyStarDate(galaxy);
    }
}

function markDead(galaxy: Galaxy, st: BeaconState, w: WatcherRec, by: Empire | null): void {
    if (w.dead) return;
    w.dead = true;
    w.mode = 'dead';
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Watcher Killed', onceKey: `WatcherKilled${w.index}`, textTag: `${TAG} Watcher Killed News`, args: [by?.name ?? T(`${TAG} Independents`)] });
    if (by !== null && isHumanEmpire(galaxy, by)) arcMessage(galaxy, st.sentStages, [by], { prefix: TAG, stage: 'Watcher Killed', onceKey: `WatcherKilledMsg${w.index}`, type: EmpireMessageType.GeneralGoodEvent });
}

// ---------------------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------------------

function watcherOf(st: BeaconState, bo: BuiltObject): WatcherRec | undefined {
    return st.watchers.find((w) => w.ship === bo);
}

function onAttacked(galaxy: Galaxy, bo: BuiltObject, attackingEmpire: Empire | null): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null) return;
    const w = watcherOf(st, bo);
    if (w === undefined || w.dead) {
        // anything else of the faction under attack: the Beacon itself being hit shows in the news once
        return;
    }
    if (attackingEmpire === null || attackingEmpire === st.faction || !isNormalAttacker(galaxy, attackingEmpire)) return; // pirates and monsters get no reaction
    bo.cloaked = false;
    if (w.mode !== 'fight') {
        setMode(w, 'fight', galaxyStarDate(galaxy));
        w.until = galaxyStarDate(galaxy);
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Watcher Fight', onceKey: `WatcherFight${w.index}:${attackingEmpire.empireId}`, textTag: `${TAG} Watcher Fight News`, args: [attackingEmpire.name] });
    }
    if (!w.attackedBy.includes(attackingEmpire.empireId)) {
        w.attackedBy.push(attackingEmpire.empireId);
        lockWar(galaxy, st.faction, attackingEmpire);
    }
}

function isNormalAttacker(galaxy: Galaxy, e: Empire): boolean {
    return e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

function onKilledBy(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null) return;
    const w = watcherOf(st, bo);
    if (w !== undefined) {
        markDead(galaxy, st, w, destroyer);
        onKilledForSalvage(galaxy, st, bo, destroyer, true);
        return;
    }
    if (bo.actualEmpire === st.faction) {
        onShipKilled(galaxy, st, bo, destroyer);
        onKilledForSalvage(galaxy, st, bo, destroyer, false);
        if (bo === st.beacon) st.beaconDestroyed = true;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The build: speed and suppliers
// ---------------------------------------------------------------------------------------------------------------

/** Build speed: each corrupted world speeds the Great Work up; a dead Watcher slows it sharply. Pure. */
export function beaconBuildRate(galaxy: Galaxy, _site: GreatWorkSite): number {
    const st = peekBeaconState(galaxy);
    if (st === null) return 1;
    const boost = Math.min(P.buildBoostCapPct(galaxy), P.buildBoostPct(galaxy) * activeCorruption(st).length);
    let rate = 1 + boost / 100;
    const dead = st.watchers.filter((w) => w.dead).length;
    for (let i = 0; i < dead; i++) rate *= P.watcherDeadFactorPct(galaxy) / 100;
    return rate;
}

/** Corrupted worlds also send freighters to the site (empire-owned ones too). Pure. */
export function beaconSuppliers(galaxy: Galaxy, _site: GreatWorkSite): Habitat[] {
    const st = peekBeaconState(galaxy);
    return st === null ? [] : activeCorruption(st).map((c) => c.colony);
}

// ---------------------------------------------------------------------------------------------------------------
// onComplete: the Reclamation begins
// ---------------------------------------------------------------------------------------------------------------

export function beaconComplete(galaxy: Galaxy, site: GreatWorkSite): void {
    const st = beaconState(galaxy);
    st.site = site;
    if (st.phase === 'reclamation' || st.ended) return;
    const now = galaxyStarDate(galaxy);
    const pos = site.base !== null ? { x: site.base.xpos, y: site.base.ypos } : { x: site.system.systemStar.xpos, y: site.system.systemStar.ypos };
    const faction = ensureFaction(galaxy, st, pos);
    if (faction === null) return;
    st.phase = 'reclamation';
    markGreatWorkHostile(site); // destroying or seizing the finished Beacon is no crime
    st.completeDate = now;
    st.reclamationDate = now;
    faction.name = T('Beacon Faction Reclaimers');
    syncReclaimerTech(galaxy, faction, reclaimerLevel(galaxy, faction, 1), true);
    setupBeacon(galaxy, st, site, faction, pos);
    st.popBaseline = galaxyPopulation(galaxy, faction);
    for (const e of normalEmpires(galaxy, faction)) lockWar(galaxy, faction, e);
    st.nextOfferDate = now + days(P.offerFirstDays(galaxy));
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Awakens', textTag: `${TAG} Awakens News`, args: [site.system.systemStar.name] });
    for (const e of normalEmpires(galaxy, faction)) {
        if (isHumanEmpire(galaxy, e)) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Awakens', type: EmpireMessageType.GeneralBadEvent, subject: st.beacon });
    }
    for (const e of normalEmpires(galaxy, faction)) revealTo(galaxy, { knowledge: st.beaconKnowledge }, e, KNOWLEDGE_CONFIRMED);
}

/** The finished wonder is the Beacon: the site's base turns to the Reclaimers, plated like a fortress (or a new base is made). */
function setupBeacon(galaxy: Galaxy, st: BeaconState, site: GreatWorkSite, faction: Empire, pos: { x: number; y: number }): void {
    const base = designFor(galaxy, faction, BuiltObjectSubRole.DefensiveBase);
    if (base === null) {
        if (site.base !== null && !site.base.hasBeenDestroyed) {
            flipBase(galaxy, site.base, faction);
            st.beacon = site.base;
            st.beacon.name = T('Beacon Beacon Name');
        }
        return;
    }
    try {
        const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === BuiltObjectSubRole.DefensiveBase) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.DefensiveBase);
        const fort = spec !== null && spec !== undefined ? generateDesignFromSpec(galaxy, faction, spec, Math.max(1, reclaimerLevel(galaxy, faction, 1)), galaxyStarDate(galaxy)) : null;
        const d = fort ?? base;
        addPlating(d, [d], 600, 400);
        boostWeapons(d, 1.5);
        d.isObsolete = true;
        faction.designs.push(d);
        if (site.base !== null && !site.base.hasBeenDestroyed) {
            // framework.ts flipToFaction: the base changes hands (state object of the faction), then is refitted in place.
            const from = site.base.actualEmpire ?? faction;
            void from;
            flipBase(galaxy, site.base, faction);
            refitInPlace(galaxy, site.base, d);
            st.beacon = site.base;
        } else {
            st.beacon = spawnShip(galaxy, faction, d, pos.x, pos.y);
        }
        st.beacon.name = T('Beacon Beacon Name');
        st.beacon.supportCostFactor = 0;
    } catch {
        st.beacon = site.base;
    }
}

import { flipToFaction } from '../framework';
function flipBase(galaxy: Galaxy, bo: BuiltObject, faction: Empire): void {
    flipToFaction(galaxy, bo, faction);
}

/** The Beacon was destroyed before it was finished: the Watchers leave the galaxy, the corruption lapses. */
export function beaconDestroyedEarly(galaxy: Galaxy, site: GreatWorkSite, by: Empire | null): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.phase !== 'watching') return;
    void site;
    void by;
    st.phase = 'ended';
    st.ended = true;
    const now = galaxyStarDate(galaxy);
    for (const w of st.watchers) {
        if (w.ship !== null && !w.ship.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, w.ship);
        w.dead = true;
        w.mode = 'dead';
    }
    for (const c of st.corrupted) if (c.ended === null) {
        c.ended = 'failed';
        c.endDate = now;
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Early Destroyed', textTag: `${TAG} Early Destroyed News` });
}

// ---------------------------------------------------------------------------------------------------------------
// The end: victory
// ---------------------------------------------------------------------------------------------------------------

/** Every 5 days after completion: victory when the Beacon and both Watchers are destroyed and the Reclaimers hold no world. */
export function beaconEndCheck(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.phase !== 'reclamation' || st.ended || st.faction === null) return;
    if (!st.beaconDestroyed && st.beacon !== null && st.beacon.hasBeenDestroyed) st.beaconDestroyed = true;
    if (!st.beaconDestroyed || liveWatchers(st).length > 0 || st.watchers.some((w) => !w.dead)) return;
    if (processingWorlds(st).length > 0 || st.faction.colonies.some((c) => !c.hasBeenDestroyed)) return;
    st.ended = true;
    st.phase = 'ended';
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Victory', textTag: `${TAG} Victory News` });
    // leftover ships fall silent
    for (const b of [...st.faction.builtObjects]) if (!b.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, b);
    const player = galaxy.playerEmpire;
    threatGameEnd(galaxy, player, GameEndOutcome.Victory, T(`${TAG} Victory Title`), BEACON_CODE_VICTORY, true);
}

// ---------------------------------------------------------------------------------------------------------------
// Known sites and the map
// ---------------------------------------------------------------------------------------------------------------

export function beaconKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null) return [];
    const out: KnownThreatSite[] = [];
    for (const w of st.watchers) {
        if (w.dead || w.ship === null || w.ship.hasBeenDestroyed) continue;
        const level = knowledgeLevel({ knowledge: w.knowledge }, empire);
        if (level < KNOWLEDGE_SUSPECTED) continue;
        out.push({ threat: BEACON_KEY, kind: 'ship', target: w.ship, level, site: { knowledge: w.knowledge }, label: T(`${TAG} Watcher Row`, placeName(galaxy, w.ship)), status: T(`${TAG} Watcher Status`) });
    }
    for (const c of st.corrupted) {
        if (c.ended !== null || c.colony.empire !== empire) continue;
        if (knowledgeLevel({ knowledge: c.knowledge }, empire) < KNOWLEDGE_CONFIRMED) continue;
        out.push({ threat: BEACON_KEY, kind: 'colony', target: c.colony, level: KNOWLEDGE_CONFIRMED, site: { knowledge: c.knowledge }, label: T(`${TAG} Corrupt Row`, c.colony.name), status: T(`${TAG} Corrupt Status`, Math.round(P.purgeCost(galaxy) * resistanceFactor(st, empire)).toLocaleString('en-US')) });
    }
    if (st.phase === 'reclamation' && st.beacon !== null && !st.beacon.hasBeenDestroyed) {
        out.push({ threat: BEACON_KEY, kind: 'ship', target: st.beacon, level: KNOWLEDGE_CONFIRMED, site: { knowledge: st.beaconKnowledge }, label: T(`${TAG} Beacon Row`, placeName(galaxy, st.beacon)), status: T(`${TAG} Beacon Status`, st.stats.conquests, Math.round(eliminatedPct(st))) });
    }
    if (st.season !== null) {
        for (const sp of st.season.staging) {
            if (knowledgeLevel(sp, empire) < KNOWLEDGE_CONFIRMED || st.season.phase !== 'prep') continue;
            const ship = st.season.groups.flatMap((g) => g.ships).find((b) => !b.hasBeenDestroyed && galaxy.calculateDistance(b.xpos, b.ypos, sp.x, sp.y) < 25000);
            if (ship === undefined) continue;
            out.push({ threat: BEACON_KEY, kind: 'ship', target: ship, level: KNOWLEDGE_CONFIRMED, site: sp, label: T(`${TAG} Staging Row`, sp.name), status: T(`${TAG} Staging Status`, st.season.groups.filter((g) => g.staging === sp.index).reduce((n, g) => n + g.ships.length + g.transports.length, 0)) });
        }
    }
    for (const r of processingWorlds(st)) {
        if (r.colony.empire !== st.faction) continue;
        out.push({ threat: BEACON_KEY, kind: 'colony', target: r.colony, level: KNOWLEDGE_CONFIRMED, label: T(`${TAG} World Row`, r.colony.name), status: T(`${TAG} World Status`, Math.round((100 * r.drained) / Math.max(1, r.popStart)), Math.round(r.pool).toLocaleString('en-US')) });
    }
    return out;
}

const MARKER_COLOR = 0x8a2be2;

/** Map: the staging points (those the viewer knows) and the Beacon, as the default ring marker. */
export function beaconMapFeatures(galaxy: Galaxy, viewer: Empire | null): ScenarioMapFeatures | null {
    const st = peekBeaconState(galaxy);
    if (st === null || viewer === null || st.phase !== 'reclamation') return null;
    const markers: ScenarioMapFeatures['markers'] = [];
    if (st.beacon !== null && !st.beacon.hasBeenDestroyed) markers.push({ x: st.beacon.xpos, y: st.beacon.ypos, label: '', color: MARKER_COLOR });
    if (st.season !== null && st.season.phase === 'prep') for (const sp of st.season.staging) if (knowledgeLevel(sp, viewer) >= KNOWLEDGE_CONFIRMED) markers.push({ x: sp.x, y: sp.y, label: sp.name, color: MARKER_COLOR });
    return markers.length === 0 ? null : { markers, routes: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// What the art needs (render only): faction identification and roles
// ---------------------------------------------------------------------------------------------------------------

export type BeaconShipRole = 'watcher' | 'beacon' | 'capital' | 'cruiser' | 'destroyer' | 'frigate' | 'carrier' | 'transport' | 'planetDestroyer' | 'other';

export interface BeaconLooks {
    /** The machine faction ("the Watchers" / "the Reclaimers"), or null. Its ships, bases and the Beacon wear the new art. */
    faction: Empire | null;
    watchers: BuiltObject[];
    beacon: BuiltObject | null;
    /** Transports that carry Thralls (to draw the Thrall marker). */
    thrallShips: BuiltObject[];
}

const lookRecord: BeaconLooks = { faction: null, watchers: [], beacon: null, thrallShips: [] };

/** Read only (never creates state): who is who for the renderer. A shared record, refreshed in place. */
export function beaconLooks(galaxy: Galaxy): BeaconLooks {
    lookRecord.faction = null;
    lookRecord.watchers = [];
    lookRecord.beacon = null;
    lookRecord.thrallShips = [];
    const st = peekBeaconState(galaxy);
    if (st === null) return lookRecord;
    lookRecord.faction = st.faction;
    lookRecord.watchers = watcherShips(st);
    lookRecord.beacon = st.beacon;
    lookRecord.thrallShips = st.thrallShips.filter((b) => !b.hasBeenDestroyed);
    return lookRecord;
}

/** The art role of a ship of the machine faction (null for any other ship). Pure. */
export function beaconShipRole(st: BeaconState, bo: BuiltObject): BeaconShipRole | null {
    if (st.faction === null || bo.actualEmpire !== st.faction) return null;
    if (bo === st.beacon) return 'beacon';
    if (st.watchers.some((w) => w.ship === bo)) return 'watcher';
    if (bo.isPlanetDestroyer) return 'planetDestroyer';
    switch (bo.subRole) {
        case BuiltObjectSubRole.CapitalShip:
            return 'capital';
        case BuiltObjectSubRole.Cruiser:
            return 'cruiser';
        case BuiltObjectSubRole.Destroyer:
            return 'destroyer';
        case BuiltObjectSubRole.Frigate:
        case BuiltObjectSubRole.Escort:
            return 'frigate';
        case BuiltObjectSubRole.Carrier:
            return 'carrier';
        case BuiltObjectSubRole.TroopTransport:
            return 'transport';
        default:
            return 'other';
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const beaconKind: GreatWorkKind = {
    id: BEACON_KIND,
    flag: BEACON_FLAG,
    weight: 15,
    // The first tag is the most general (shared with the Ultramind and the Rift Gate: red herrings); the last is the Beacon's own tell.
    hintTags: ['superconductors', 'beacons', 'dark-alloys'],
    onRolled: beaconRolled,
    buildRateMultiplier: beaconBuildRate,
    extraSuppliers: beaconSuppliers,
    onComplete: beaconComplete,
    onDestroyed: beaconDestroyedEarly,
};

export const BEACON_HANDLER_IDS = ['beacon.watchers', 'beacon.reclaim', 'beacon.monthly', 'beacon.attacked', 'beacon.killed', 'beacon.owner', 'beacon.destroyed', 'beacon.boarded', 'beacon.repair', 'beacon.troops', 'beacon.counter'] as const;

export function registerBeacon(): void {
    registerGreatWork(beaconKind);
    registerScenarioPeriodic({ id: 'beacon.watchers', flag: BEACON_FLAG, order: 20, periodDays: WATCHER_DAYS, run: (g) => watchersPeriodic(g) });
    registerScenarioPeriodic({
        id: 'beacon.reclaim',
        flag: BEACON_FLAG,
        order: 21,
        periodDays: 5,
        run: (g) => {
            reclamationPeriodic(g);
            beaconEndCheck(g);
        },
    });
    registerScenarioPeriodic({
        id: 'beacon.monthly',
        flag: BEACON_FLAG,
        order: 22,
        periodDays: 30,
        run: (g) => {
            reclamationMonthly(g);
            counterMonthly(g);
        },
    });
    registerScenarioPeriodic({ id: 'beacon.counter', flag: BEACON_FLAG, order: 23, periodDays: 60, run: (g) => counterIntelligencePass(g) });
    registerScenarioEvent({ id: 'beacon.attacked', flag: BEACON_FLAG, event: 'builtObjectAttacked', run: (g, e) => onAttacked(g, e.builtObject, e.attackingEmpire) });
    registerScenarioEvent({ id: 'beacon.killed', flag: BEACON_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, e.builtObject, e.destroyer) });
    registerScenarioEvent({
        id: 'beacon.owner',
        flag: BEACON_FLAG,
        order: 20,
        event: 'colonyOwnerChanged',
        run: (g, e) => {
            const st = peekBeaconState(g);
            if (st !== null) fleetOnColonyOwnerChanged(g, st, e.colony, e.from, e.to);
        },
    });
    registerScenarioEvent({
        id: 'beacon.destroyed',
        flag: BEACON_FLAG,
        event: 'habitatDestroyed',
        run: (g, e) => {
            const st = peekBeaconState(g);
            if (st !== null) fleetOnHabitatDestroyed(g, st, e.habitat, e.destroyer);
        },
    });
    registerScenarioEvent({ id: 'beacon.boarded', flag: BEACON_FLAG, event: 'builtObjectOwnerChanged', run: (g, e) => onBoarded(g, e.builtObject, e.from, e.to) });
    // Machines mend themselves in the field (the stock AI would send a damaged warship home to a port the Reclaimers do not have).
    registerScenarioQuery({ id: 'beacon.repair', flag: BEACON_FLAG, query: 'repairRateFactor', run: (g, v, a) => (peekBeaconState(g)?.faction === a.builtObject.actualEmpire ? v * 4 : v) });
    registerScenarioQuery({ id: 'beacon.troops', flag: BEACON_FLAG, query: 'troopMaintenanceFactor', run: (g, v, a) => (peekBeaconState(g)?.faction === a.empire ? 0 : v) });
    registerThreatKnownSites(BEACON_KEY, beaconKnownSites);
    // The Reclaimers are a crisis faction (opportunists, reputation, the council). The helpers are the empires that protected the Great Work
    // (the framework's rule) and the dealers whose bargain with the Reclaimers was found out.
    registerHostileWonderCrisis({ key: BEACON_KEY, flag: BEACON_FLAG, label: 'Reclaimers' });
    registerCrisisHelpers(BEACON_KEY, (g, faction) => {
        const out = greatWorkProtectors(g).filter((e) => e !== faction);
        const st = peekBeaconState(g);
        for (const b of st?.bargains ?? []) {
            const e = b.discovered && !b.ended ? g.empires.find((x) => x !== null && x.empireId === b.empireId) : undefined;
            if (e !== undefined && e !== null && e.active && e !== faction && !out.includes(e)) out.push(e);
        }
        return out;
    });
    registerScenarioMapFeatures(BEACON_KEY, beaconMapFeatures);
    registerCounterplay();
}

registerBeacon();

// Kept for the soak / tests.
export { corruptCandidates as beaconCorruptCandidates, defenceOf as beaconDefenceOf, lossCheck as beaconLossCheck, referenceMilitary as beaconReferenceMilitary };
void calculateOverallStrengthFactorWithoutShields;
void BEACON_CODE_VICTORY;
