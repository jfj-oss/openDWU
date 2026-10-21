// The Beacon (Giantworks wonder, flag gwBeacon; design plan section 3.D, decisions in sections 10-13). Not a port: new scenario
// behaviour composed of ported functions. Registered from scenario/packages.ts; every handler is gated by the gwBeacon flag, so with
// the flag off nothing here runs and nothing draws. Part 1 of 3 (beaconFleet.ts: the Reclamation; beaconCounter.ts: counterplay).
//
// Before the Great Work is finished: two Watchers, huge cloaked mega-ships of the machine faction, wait in dark space beyond the
// galaxy rim. Every few months a Watcher drifts (cloaked) over a colony that was independent at the start, dwells there and
// CORRUPTS it (the Cult's conversion: the governor and the people quietly serve the Beacon). Corrupted worlds speed the build up
// (buildRateMultiplier) and send freighters to the site even when an empire owns them (extraSuppliers). Now and then a Watcher
// SHOWS ITSELF: it drops its cloak over a colony for a few days, passive (it is at war with no one; the AI never targets it),
// then slips away and cloaks again; attacked, it only DEFENDS ITSELF: it fires back at the ships that attacked it (and their fleets) until they are
// destroyed or gone, then goes back to what it was doing and cloaks; it goes to war with no one. Very hard to kill;
// killing one slows the build sharply.
// When the Beacon is finished the Reclamation begins (beaconFleet.ts), but not the war: the Watchers stay cloaked and gather round the Beacon
// (musterWatchers) for the ten days of the countdown. At the first mega beam the war is declared, the Watchers decloak and lead the Watcher fleets (their
// escorts are made at the Beacon), which defend the harvest cores and go on an offensive only every few years, and the first season's strike
// groups come through the beam beside their targets. Later seasons prepare at staging points as before.
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
import { EmpireMessage, EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { generateDesignFromSpec } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { calculateOverallStrengthFactorWithoutShields } from '../../../diplomacyTick';
import { assignMission, clearPreviousMissionRequirements } from '../../../missions/assign';
import { forceCompleteMission } from '../../../fleets/shipGroupTasks';
import { empireShipGroups } from '../../../fleets/shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { isHumanEmpire } from '../../../humanEmpires';
import { GameEndOutcome } from '../../../victory';
import { CharacterRole, getEmpireCharacters } from '../../../characters';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioPeriodic, registerScenarioQuery } from '../../hooks';
import { logScenarioMessage, logScenarioNews } from '../../eventLog/log';
import { registerScenarioMapFeatures, type ScenarioMapFeatures } from '../../mapFeatures';
import { scenarioMessage, scenarioNews, scenarioText as T } from '../../messages';
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
    registerThreatSpawn,
    revealTo,
    threatGameEnd,
    type KnownThreatSite,
} from '../framework';
import { genShipsSpawnPoint } from '../generationShips';
import { registerCrisisHelpers } from '../crisis';
import { refitInPlace } from '../framework';
import { completeWork, greatWorkProtectors, greatWorks, GW_KEY, markGreatWorkHostile, registerGreatWork, registerHostileWonderCrisis, spawnGreatWork, spawnNote } from './framework';
import { kindTaken } from './founders';
import { registerWarCredit, warCreditCapturedCapital, warCreditKilled, warCreditWatcher } from './beaconWarCredit';
import { assetsBroken, assetsLeftPct, creditBeaconKill, creditCapitalKill, creditHarvesterKill, creditWatcherKill, planetKnown, planetMarkerLabel, registerComponents } from './beaconComponents';
import { isCompact } from './state';
import { exitHyperjump } from '../../../movement';
import type { GreatWorkKind, GreatWorkSite } from './types';
import {
    BEACON_CODE_ASSETS,
    BEACON_CODE_MEGA,
    BEACON_CODE_VICTORY,
    BEACON_FLAG,
    BEACON_KEY,
    BEACON_KIND,
    P,
    activeCorruption,
    cloakLapsedFor,
    beaconRandom,
    beaconState,
    galaxyPopulation,
    liveWatchers,
    peekBeaconState,
    siphonGateOpen,
    watcherShips,
    beaconPosition,
    type BeaconState,
    type CorruptRec,
    type WatcherRec,
    warOn,
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
    beamPass,
    startBeamCountdown,
    reclamationMonthly,
    reclamationPeriodic,
    referenceMilitary,
    spawnShip,
    syncReclaimerTech,
} from './beaconFleet';
import { checkSiteShield, defenceOfSite, ensureSiteShield, inSiteSystem, isOutsider, outsiderShips, pointNearSite, preBeam, siteBase, siteDefencePass, siteVictim } from './beaconSite';
import { registerBeaconAi } from './beaconAi';
import { registerPursuit } from './beaconPursuit';
import { registerWatcherDesigner } from './age2Watchers';
import { dwellDaysFor, holdingAtGate, purgePass, purgeRebelStrength, recentlyPurged, siphonPass, siphonStatus } from './beaconSiphon';
import { addProgress } from './lifecycle';
import { unblockaded } from './blockade';
import { beaconTechSlowed } from './beaconTech';
import './beaconDiet';
import { ensureFoundries, foundryOf, registerFoundry } from './beaconFoundry';
import { registerMega } from './megaStation';
import { depotOf, registerDepot } from './beaconDepot';
import { counterIntelligencePass, counterMonthly, onBoarded, onKilledForSalvage, registerCounterplay, resistanceFactor } from './beaconCounter';
import './beaconRelocation'; // population relocation (registers its passes and queries)
import './beaconInterceptors'; // the refugee interceptors (registers its tick)
import { beaconArtInfo, cattleOf, cattleRepairFactor, initHarvest, knownCores, liveCores, noteCattleCore, registerHarvest, releaseCaptives, rescueCattle } from './beaconHarvest';
import type { BeaconArtInfo } from './beaconState';

declare module '../../../builtObject' {
    interface BuiltObject {
        /** The Beacon's Watchers: the ship is invisible to every other empire (independentTraders.ts / render/fog.ts), absent unless in use. */
        cloaked?: boolean;
        /** Empire ids whose sensors currently see through the cloak, with the star date it lapses. */
        cloakSeenBy?: { empireId: number; until: number }[];
        /** Star date the ship came out of the Beacon's mega beam (beaconFleet.ts fireBeam): the renderer plays the Beacon warp's arrival once (effectsLayer.ts). Absent otherwise. */
        beamArrival?: number;
    }
}

const TAG = 'Beacon';
const WATCHER_DAYS = 2;
/** Mustering Watchers wait this far from the Beacon. */
const MUSTER_RADIUS = 16000;

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

/**
 * Real engines for the Watcher: adds copies of the design's own main engines (Vortex at max tech), with the reactors and fuel cells to power
 * and feed them, until the design's own speed maths (Design.reDefine) reaches `top` / `cruise`; then maneuvering thrusters until the turn rate is
 * what it was. Pure apart from `d`. Returns the number of engines added.
 */
export function boostEngines(d: import('../../../design').Design, top: number, cruise: number): number {
    const engine = d.components.find((c) => c.type === ComponentType.EngineMainThrust);
    const reactor = d.components.find((c) => c.type === ComponentType.Reactor);
    const fuel = d.components.find((c) => c.type === ComponentType.StorageFuel);
    const vector = d.components.find((c) => c.type === ComponentType.EngineVectoring);
    if (engine === undefined || !(top > 0)) return 0;
    const turn0 = d.turnRate;
    const rangeDays0 = d.fuelCapacity / Math.max(1, d.topSpeedFuelBurn);
    let added = 0;
    for (let i = 0; i < 100 && (d.topSpeed < top || d.cruiseSpeed < cruise); i++) {
        for (let k = 0; k < 2; k++) d.components.push(engine);
        added += 2;
        // one reactor per 26 engines, and fuel cells to keep the range (fuel capacity per unit of burn) it had
        if (reactor !== undefined && added % 26 === 0) d.components.push(reactor);
        d.reDefine();
        if (fuel !== undefined && fuel.value1 > 0) {
            let guard = 0;
            while (d.fuelCapacity / Math.max(1, d.topSpeedFuelBurn) < rangeDays0 && guard++ < 40) {
                d.components.push(fuel);
                d.reDefine();
            }
        }
    }
    if (reactor !== undefined) {
        // the fuel burn must be powered with room to spare: reactors until the net power covers the burn twice over
        for (let g = 0; g < 10 && (d.reactorPowerOutput - d.staticEnergyConsumption) < 2 * d.topSpeedFuelBurn; g++) {
            d.components.push(reactor);
            d.reDefine();
        }
    }
    if (vector !== undefined) {
        for (let g = 0; g < 200 && d.turnRate < turn0 - 0.0002; g++) {
            d.components.push(vector);
            d.reDefine();
        }
    }
    return added;
}

export function watcherDesign(galaxy: Galaxy, faction: Empire, lvl: number): import('../../../design').Design | null {
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === BuiltObjectSubRole.CapitalShip) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.CapitalShip);
    if (spec === null || spec === undefined) return null;
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, lvl, galaxyStarDate(galaxy));
        if (d === null) return null;
        addPlating(d, [d], P.watcherArmourPct(galaxy), P.watcherShieldPct(galaxy));
        boostWeapons(d, P.watcherGuns(galaxy));
        boostEngines(d, P.watcherTopSpeed(galaxy), P.watcherCruiseSpeed(galaxy));
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
    st.rollDate = now;
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

export { cloakLapsedFor };

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
 * The Watcher slipped out of sight (it cloaked, or the spotter's 20 days lapsed): the empires that had ships ordered at it lose
 * track. Missions that name it (Attack and the like, set while it was visible) are cleared, as they would be for a ship that
 * jumped away; the ships and fleets go back to the stock AI. `only`: just those empires.
 */
function loseTrack(galaxy: Galaxy, faction: Empire, ship: BuiltObject, only: readonly Empire[] | null): void {
    for (const e of galaxy.empires) {
        if (e === null || e === faction || e === galaxy.independentEmpire || (only !== null && !only.includes(e))) continue;
        for (const sg of empireShipGroups(e)) {
            if (sg !== null && sg.mission !== null && sg.mission.targetBuiltObject === ship) forceCompleteMission(galaxy, sg);
        }
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed) continue;
            const m = builtObjectMission(b.mission);
            if (m !== null && m.type !== BuiltObjectMissionType.Undefined && m.targetBuiltObject === ship) {
                clearPreviousMissionRequirements(galaxy, b);
                m.clear();
            }
        }
    }
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
    const before = ship.cloakSeenBy ?? [];
    ship.cloakSeenBy = before.filter((s) => s.until > now);
    if (ship.cloakSeenBy.length < before.length && st.faction !== null) {
        const lapsed = before.filter((s) => s.until <= now).map((s) => galaxy.empires.find((x) => x !== null && x.empireId === s.empireId)).filter((x): x is Empire => x !== undefined && x !== null);
        loseTrack(galaxy, st.faction, ship, lapsed);
    }
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
        void first;
        if (isHumanEmpire(galaxy, e)) watcherMessage(galaxy, st, 'detect', e, [placeName(galaxy, ship)], ship, EmpireMessageType.GeneralWarning, false, String(w.index));
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
    const free = (c: Habitat): boolean => !c.hasBeenDestroyed && c.population.totalAmount > 0 && !taken.has(c) && c.empire !== st.faction && !recentlyPurged(_galaxy, st, c);
    const primary = st.formerIndependents.filter(free);
    if (primary.length >= P.corruptMinPool(_galaxy)) return primary;
    // the pool of start-independent worlds is exhausted or tiny: any small, low-population colony will do (never a capital)
    const max = P.corruptFallbackPop(_galaxy);
    const out = [...primary];
    for (const e of _galaxy.empires) {
        if (e === null || !e.active || e === st.faction || e.pirateEmpireBaseHabitat !== null) continue;
        for (const c of e.colonies) if (e.capital !== c && !out.includes(c) && free(c) && c.population.totalAmount <= max) out.push(c);
    }
    return out;
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
    // the owner (or the people who can see it: a colony in the system or a ship close by) hear of the odd cargo
    const star = galaxy.determineHabitatSystemStar(colony);
    for (const e of humanEmpires(galaxy)) {
        const sees = e === owner || e.colonies.some((c) => !c.hasBeenDestroyed && galaxy.determineHabitatSystemStar(c) === star && star !== null) ||
            e.builtObjects.some((b) => !b.hasBeenDestroyed && galaxy.calculateDistance(b.xpos, b.ypos, colony.xpos, colony.ypos) <= P.detectRange(galaxy));
        if (sees) watcherMessage(galaxy, st, 'corrupt', e, [colony.name], colony, EmpireMessageType.GeneralWarning);
    }
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
    if (ship.cloaked !== true && st.faction !== null) loseTrack(galaxy, st.faction, ship, null);
    ship.cloaked = true;
    w.target = null;
    setMode(w, 'return', now);
    sendTo(galaxy, ship, w.homeX, w.homeY);
    void st;
}

/** The fight is over: forget the attackers and go back to the mode it was in (a trip, a dwell, a sighting) or home, and cloak again. */
function endFight(galaxy: Galaxy, st: BeaconState, w: WatcherRec, now: number): void {
    const ship = w.ship!;
    const prev = w.prevMode;
    const t = w.target;
    const teleported = w.teleported === true;
    w.siteFight = false;
    w.teleported = false;
    if (prev === 'muster') {
        // the Great Work is finished and the beam not yet fired: back to its place round the Beacon, cloaked
        w.attackerShips = [];
        w.prevMode = undefined;
        if (st.faction !== null && ship.cloaked !== true) loseTrack(galaxy, st.faction, ship, null);
        ship.cloaked = true;
        setMode(w, 'muster', now);
        return;
    }
    if (teleported && (prev === 'travel' || prev === 'dwell') && t !== null && !t.hasBeenDestroyed) {
        // called away from a corruption trip: it sails back to its world and starts again (cloaked)
        w.attackerShips = [];
        w.prevMode = undefined;
        if (st.faction !== null && ship.cloaked !== true) loseTrack(galaxy, st.faction, ship, null);
        ship.cloaked = true;
        setMode(w, 'travel', now);
        w.until = 0;
        sendTo(galaxy, ship, t.xpos, t.ypos, t);
        return;
    }
    if (teleported && prev !== 'guard') {
        w.attackerShips = [];
        w.prevMode = undefined;
        goHome(galaxy, st, w, now);
        return;
    }
    if (prev === 'guard') {
        // back to guarding the scaffold, cloaked
        w.attackerShips = [];
        w.prevMode = undefined;
        if (st.faction !== null && ship.cloaked !== true) loseTrack(galaxy, st.faction, ship, null);
        ship.cloaked = true;
        setMode(w, 'guard', now);
        return;
    }
    const resumable = (prev === 'travel' || prev === 'dwell' || prev === 'sighting') && t !== null && !t.hasBeenDestroyed;
    w.attackerShips = [];
    w.prevMode = undefined;
    if (!resumable) {
        goHome(galaxy, st, w, now);
        return;
    }
    const fightStart = w.until; // (marks when the fight began)
    // the time spent fighting does not count against a dwell: it picks up where it stopped
    setMode(w, prev!, now - Math.max(0, fightStart - (w.prevModeDate ?? fightStart)));
    w.until = w.prevUntil ?? 0;
    if (prev === 'sighting') {
        w.until = Math.max(w.until, now + days(1)); // (still over the colony, uncloaked)
        return;
    }
    if (st.faction !== null && ship.cloaked !== true) loseTrack(galaxy, st.faction, ship, null);
    ship.cloaked = true;
    if (prev === 'travel') sendTo(galaxy, ship, t!.xpos, t!.ypos, t);
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

/** Where a mustering Watcher waits: on a ring round the Beacon (MUSTER_RADIUS), the Watchers spread evenly round it. Null without a Beacon. Pure. */
function musterPoint(st: BeaconState, w: WatcherRec): { x: number; y: number } | null {
    const pos = beaconPosition(st);
    if (pos === null) return null;
    const a = 0.6 + (2 * Math.PI * w.index) / Math.max(2, st.watchers.length);
    return { x: pos.x + MUSTER_RADIUS * Math.cos(a), y: pos.y + MUSTER_RADIUS * Math.sin(a) };
}

/**
 * The Great Work is finished: every living Watcher stops what it was doing (a corruption trip, a sighting, the guard of the scaffold, a fight, a rest in dark
 * space) and goes, cloaked, to gather round the Beacon. There it stays until the mega beam.
 */
export function musterWatchers(galaxy: Galaxy, st: BeaconState): void {
    const now = galaxyStarDate(galaxy);
    for (const w of st.watchers) {
        const ship = w.ship;
        if (w.dead || ship === null || ship.hasBeenDestroyed || ship.actualEmpire !== st.faction) continue;
        if (ship.cloaked !== true && st.faction !== null) loseTrack(galaxy, st.faction, ship, null);
        ship.cloaked = true;
        w.target = null;
        w.until = 0;
        w.attackerShips = [];
        w.prevMode = undefined;
        w.siteFight = false;
        w.teleported = false;
        setMode(w, 'muster', now);
        const at = musterPoint(st, w);
        if (at !== null) sendTo(galaxy, ship, at.x, at.y);
    }
}

/** One Watcher's turn (every 2 days). */
function driveWatcher(galaxy: Galaxy, st: BeaconState, w: WatcherRec, sightingOpen: boolean): boolean {
    const ship = w.ship;
    if (w.dead || ship === null) return false;
    if (ship.hasBeenDestroyed) return false;
    const now = galaxyStarDate(galaxy);
    if (ship.fuelCapacity > 0) ship.currentFuel = ship.fuelCapacity;
    if (w.mode === 'lead') {
        // The flagship of a Watcher fleet (beaconFleet.ts moves it with the fleet): uncloaked, no routine of its own.
        ship.cloaked = false;
        return false;
    }
    if (w.mode === 'muster') {
        // The Great Work is finished and the beam not yet fired: cloaked, it holds its place round the Beacon (beaconFleet.ts startWatcherFleets lets it go at the beam).
        ship.cloaked = true;
        const at = musterPoint(st, w);
        if (at === null) {
            goHome(galaxy, st, w, now);
            return false;
        }
        if (!arrived(galaxy, ship, at.x, at.y, 6000)) sendTo(galaxy, ship, at.x, at.y);
        return false;
    }
    if (w.mode === 'fight') {
        // Cloak down while it fights (self-defence against the attackers and their fleets only; it is at war with no one). Once no attacker is near
        // and none has hit it for 15 days it breaks off and goes back to what it was doing.
        ship.cloaked = false;
        let near = false;
        for (const id of w.attackedBy) {
            const e = galaxy.empires.find((x) => x !== null && x.empireId === id);
            if (e === undefined || e === null) continue;
            for (const b of e.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && galaxy.calculateDistance(b.xpos, b.ypos, ship.xpos, ship.ypos) < 60000) near = true;
        }
        // (w.until marks when the fight began: it breaks off after 45 days however near its enemies still are, and is drawn back in if they hit it again;
        // a fight over the site (beaconSite.ts) holds as long as the site is attacked)
        const cap = w.siteFight === true ? Infinity : days(45);
        if (near && now - w.until < cap) w.modeDate = now;
        else if (now - Math.max(w.modeDate, w.lastHit ?? 0) > days(w.siteFight === true ? P.siteQuietDays(galaxy) : 15) || now - w.until >= cap) endFight(galaxy, st, w, now);
        return false;
    }
    if (w.mode === 'guard') {
        // Guarding the scaffold that waits for its gate: cloaked over the site; attacked, it fights (onSiteAttacked / onAttacked) and comes back to this.
        ship.cloaked = true;
        const pos = scaffoldPosition(st);
        if (pos === null || !guardWanted(galaxy, st)) {
            goHome(galaxy, st, w, now);
            return false;
        }
        if (!arrived(galaxy, ship, pos.x, pos.y, 20000)) sendTo(galaxy, ship, pos.x, pos.y);
        return false;
    }
    if (w.mode === 'parked' || w.mode === 'return') {
        // A return that has not ended in 150 days (a home point the ship cannot reach: it was seen sailing for 600 days a few million units short) is given a
        // new one close by, away from the galaxy's heart; nothing of the Watchers is ever left in limbo.
        if (w.mode === 'return' && now - w.modeDate > days(150)) {
            const cx = galaxy.sizeX / 2;
            const cy = galaxy.sizeY / 2;
            let dx = ship.xpos - cx;
            let dy = ship.ypos - cy;
            const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            dx /= len;
            dy /= len;
            w.homeX = Math.min(galaxy.sizeX - 1000, Math.max(1000, ship.xpos + dx * 400000));
            w.homeY = Math.min(galaxy.sizeY - 1000, Math.max(1000, ship.ypos + dy * 400000));
            w.modeDate = now;
            st.stats.watcherRehomed = (st.stats.watcherRehomed ?? 0) + 1;
        }
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
            } else {
                setMode(w, 'dwell', now);
                w.dwellDays = dwellDaysFor(galaxy, t.population?.totalAmount ?? 0);
            }
        } else sendTo(galaxy, ship, t.xpos, t.ypos, t);
        return w.until === -1;
    }
    if (w.mode === 'dwell') {
        if (now - w.modeDate >= days(w.dwellDays ?? P.dwellDays(galaxy))) {
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

// ---------------------------------------------------------------------------------------------------------------
// The player's messages: the FIRST time an empire gets a kind it reads the confused first-encounter text and the popup opens by itself;
// later ones pick one of the repeat variants at random (the private Random). Both show in the ticker and as a badge (popupMode). AI: no UI.
// ---------------------------------------------------------------------------------------------------------------

const MSG_REPEATS = { detect: 2, decloak: 1, cloak: 3, corrupt: 3, attack: 3, killed: 3, site: 2, shield: 1 } as const;
type MsgKind = keyof typeof MSG_REPEATS;

function humanEmpires(galaxy: Galaxy): Empire[] {
    return galaxy.empires.filter((e): e is Empire => e !== null && e.active && isHumanEmpire(galaxy, e));
}

/** 'First' the first time `e` gets this kind, else 'Repeat n' (n drawn with the Beacon's seeded Random). Records the first. */
export function watcherVariant(galaxy: Galaxy, st: BeaconState, kind: MsgKind, e: Empire): string {
    st.msgSeen ??= {}; // (saves from before the messages)
    const seen = (st.msgSeen[kind] ??= []);
    if (!seen.includes(e.empireId)) {
        seen.push(e.empireId);
        return 'First';
    }
    return `Repeat ${beaconRandom(galaxy, st, 400 + Object.keys(MSG_REPEATS).indexOf(kind)).next(1, MSG_REPEATS[kind] + 1)}`;
}

const cap = (k: string): string => k.charAt(0).toUpperCase() + k.slice(1);

/** One message of `kind` to a human empire: the first one opens its popup, the repeats only show in the ticker and as a badge. `news`: a NewsNet line (the empire's name is not the recipient's). */
function watcherMessage(galaxy: Galaxy, st: BeaconState, kind: MsgKind, e: Empire, args: (string | number)[], subject: unknown, type: EmpireMessageType, news = false, throttleKey: string | null = null): void {
    if (!isHumanEmpire(galaxy, e)) return;
    const v = watcherVariant(galaxy, st, kind, e);
    const popupMode = v === 'First' ? 'force' : 'quiet';
    if (throttleKey !== null && throttled(galaxy, st, `${kind}:${throttleKey}:${e.empireId}`, v === 'First')) {
        // inside the window: the event log keeps the line, the ticker and the badge do not get one
        const m = new EmpireMessage(null, type, subject);
        m.title = T(`${TAG} Msg ${cap(kind)} Title`);
        m.description = T(`${TAG} Msg ${cap(kind)} ${v}`, ...args);
        m.starDate = galaxyStarDate(galaxy);
        logScenarioMessage(galaxy, e, m, undefined);
        return;
    }
    if (news) scenarioNews(galaxy, null, T(`${TAG} Msg ${cap(kind)} ${v}`, ...args), (x) => x === e, subject, undefined, popupMode);
    else scenarioMessage(galaxy, e, T(`${TAG} Msg ${cap(kind)} Title`), T(`${TAG} Msg ${cap(kind)} ${v}`, ...args), { type, subject, popupMode });
}

/**
 * True when a throttled message with this key was sent less than beaconMsgRepeatDays ago (it is then not sent; the event log keeps it); otherwise
 * records now as the last send and returns false. The first message of a kind (`first`) always goes out.
 */
function throttled(galaxy: Galaxy, st: BeaconState, key: string, first: boolean): boolean {
    const now = galaxyStarDate(galaxy);
    const last = (st.msgLast ??= {})[key];
    if (!first && last !== undefined && now - last < days(P.msgRepeatDays(galaxy))) return true;
    st.msgLast[key] = now;
    return false;
}

/** A NewsNet line with a fixed text for one human empire (the sighting's news). */
function watcherNews(galaxy: Galaxy, st: BeaconState, tag: string, e: Empire, args: (string | number)[], subject: unknown, throttleKey: string | null = null): void {
    if (throttleKey !== null && throttled(galaxy, st, `${tag.toLowerCase()}news:${throttleKey}:${e.empireId}`, false)) {
        logScenarioNews(galaxy, null, T(`${TAG} Msg ${tag} News`, ...args), [e], subject, undefined);
        return;
    }
    scenarioNews(galaxy, null, T(`${TAG} Msg ${tag} News`, ...args), (x) => x === e, subject, undefined, 'quiet');
}

function sightingStarts(galaxy: Galaxy, st: BeaconState, w: WatcherRec, over: Habitat): void {
    st.stats.sightings++;
    const star = galaxy.determineHabitatSystemStar(over);
    const where = star?.name ?? over.name;
    const ship = w.ship!;
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (isObjectVisibleToThisEmpire(galaxy, e, ship)) revealTo(galaxy, { knowledge: w.knowledge }, e, KNOWLEDGE_CONFIRMED);
    }
    const owner = over.empire;
    const ownerOk = owner !== null && owner !== galaxy.independentEmpire && owner !== st.faction && owner.active;
    if (ownerOk) watcherMessage(galaxy, st, 'decloak', owner, [over.name], ship, EmpireMessageType.GeneralWarning, false, String(over.habitatIndex));
    for (const e of humanEmpires(galaxy)) if (e !== owner) watcherNews(galaxy, st, 'Decloak', e, [over.name, where], ship, String(over.habitatIndex));
}

function sightingEnds(galaxy: Galaxy, st: BeaconState, w: WatcherRec, over: Habitat): void {
    const owner = over.empire;
    if (owner !== null && owner !== galaxy.independentEmpire && owner !== st.faction && owner.active) watcherMessage(galaxy, st, 'cloak', owner, [over.name], null, EmpireMessageType.GeneralNeutralEvent, false, String(over.habitatIndex));
    void w;
}

// ---------------------------------------------------------------------------------------------------------------
// Guarding the scaffold while it waits for the siphon gate
// ---------------------------------------------------------------------------------------------------------------

function scaffoldPosition(st: BeaconState): { x: number; y: number } | null {
    const gw = st.site;
    if (gw === null) return null;
    if (gw.base !== null && !gw.base.hasBeenDestroyed) return { x: gw.base.xpos, y: gw.base.ypos };
    return null;
}

/** The scaffold stands at 99.9 % and waits for the gate. */
function guardWanted(galaxy: Galaxy, st: BeaconState): boolean {
    return holdingAtGate(galaxy, st) && scaffoldPosition(st) !== null;
}

/**
 * While the scaffold waits at 99.9 % for the gate, ONE Watcher (the lowest-numbered live one that is free) comes home and guards it: cloaked over the
 * site, and when the scaffold is attacked it defends itself and the work (onSiteAttacked) under the no-war rule, so attackers must beat it first.
 * With two Watchers the other keeps corrupting (new siphon sources, the work's build speed); a lone Watcher guards and corruption pauses, the
 * baseline siphon (beaconSiphonBaseline) being the source then. A guard that died is replaced by the next free Watcher.
 */
function guardPass(galaxy: Galaxy, st: BeaconState): void {
    if (!guardWanted(galaxy, st)) return;
    const live = liveWatchers(st);
    if (live.some((w) => w.mode === 'guard' || (w.mode === 'fight' && w.prevMode === 'guard'))) return;
    const pick = live.find((w) => w.mode === 'parked' || w.mode === 'return' || w.mode === 'travel' || w.mode === 'dwell');
    if (pick === undefined) return;
    const now = galaxyStarDate(galaxy);
    pick.target = null;
    pick.until = 0;
    setMode(pick, 'guard', now);
    const pos = scaffoldPosition(st)!;
    sendTo(galaxy, pick.ship!, pos.x, pos.y);
}

/**
 * The site (the scaffold, or the finished Beacon before its first beam) was attacked (beaconSite.ts): every live Watcher comes to it at once and fights
 * the empire ships in that system, and a broken shield brings the Reclaimer fleet. Pirates and monsters get no reaction unless they attack the site.
 * Self-defence of the site, not war: nothing is declared and no relation changes.
 */
function onSiteAttacked(galaxy: Galaxy, bo: BuiltObject, attacker: unknown, attackingEmpire: Empire | null): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || !preBeam(st)) return;
    const base = siteBase(st);
    if (base === null || bo !== base) return;
    if (attackingEmpire === st.faction || (attackingEmpire !== null && isCompact(galaxy, attackingEmpire))) return;
    ensureSiteShield(galaxy, st); // (an attack in the first days, before the Watchers' pass plated it)
    siteDefence(galaxy, st, base, attacker, attackingEmpire);
    const fleet = checkSiteShield(galaxy, st);
    if (fleet.length > 0) {
        for (const e of humanEmpires(galaxy)) watcherMessage(galaxy, st, 'shield', e, [placeName(galaxy, base)], base, EmpireMessageType.GeneralBadEvent);
    }
}

/** The Watchers come to the site (a teleport within SITE_ARRIVAL, a warp-in) and open fire, decloaked, on the empire ships in that system. */
function siteDefence(galaxy: Galaxy, st: BeaconState, base: BuiltObject, attacker: unknown, attackingEmpire: Empire | null): void {
    const now = galaxyStarDate(galaxy);
    const def = defenceOfSite(st);
    const was = def.active;
    def.active = true;
    def.lastAttack = now;
    const ship = attackerShipOf(attacker);
    if (ship !== null && !isOutsider(galaxy, st, ship.actualEmpire) && !def.attackerIds.includes(ship.builtObjectID)) def.attackerIds.push(ship.builtObjectID);
    const outsiders = outsiderShips(galaxy, st, false);
    const empireIds = new Set<number>();
    for (const b of outsiders) if (b.actualEmpire !== null) empireIds.add(b.actualEmpire.empireId);
    if (attackingEmpire !== null && isOutsider(galaxy, st, attackingEmpire)) empireIds.add(attackingEmpire.empireId);
    let arrived = 0;
    for (const w of st.watchers) {
        const wship = w.ship;
        if (w.dead || wship === null || wship.hasBeenDestroyed || wship.actualEmpire !== st.faction || w.mode === 'lead') continue;
        if (w.mode !== 'fight') {
            w.prevMode = w.mode;
            w.prevUntil = w.until;
            w.prevModeDate = w.modeDate;
            if (w.mode === 'dwell') {
                w.prevModeDate = now;
                st.stats.dwellResets = (st.stats.dwellResets ?? 0) + 1;
            }
            setMode(w, 'fight', now);
            w.until = now; // marks when the fight began
        }
        wship.cloaked = false;
        w.siteFight = true;
        w.lastHit = now;
        for (const id of empireIds) if (!w.attackedBy.includes(id)) w.attackedBy.push(id);
        if (ship !== null) {
            // the ships that attacked it keep drawing its fire wherever they flee to (watcherMayFire)
            w.attackerShips ??= [];
            if (!w.attackerShips.includes(ship.builtObjectID)) w.attackerShips.push(ship.builtObjectID);
        }
        if (galaxy.calculateDistance(wship.xpos, wship.ypos, base.xpos, base.ypos) > 1000) {
            teleportTo(galaxy, st, wship, pointNearSite(galaxy, st, base, 6000 + w.index), w);
            arrived++;
        }
    }
    if (!was || arrived > 0) {
        const where = placeName(galaxy, base);
        const by = attackingEmpire !== null ? attackingEmpire.name : T(`${TAG} Independents`);
        for (const e of humanEmpires(galaxy)) watcherMessage(galaxy, st, 'site', e, [where, by], base, EmpireMessageType.GalacticNewsNet, true, 'site');
    }
}

/**
 * A Watcher is moved to a point at once (the warp-in; the sim has no flight there): out of any hyperjump, its orders cleared, then held at the point.
 * (Render: the stock arrival flare is not played, only the decloak.)
 */
function teleportTo(galaxy: Galaxy, st: BeaconState, ship: BuiltObject, at: { x: number; y: number }, w: WatcherRec): void {
    if (ship.hyperjumpPrepare || ship.currentSpeed > ship.topSpeed) exitHyperjump(galaxy, ship);
    if (st.faction !== null && ship.cloaked !== true) loseTrack(galaxy, st.faction, ship, null);
    w.teleported = true;
    ship.xpos = at.x;
    ship.ypos = at.y;
    ship.currentSpeed = 0;
    const star = st.site?.system.systemStar ?? null;
    if (star !== null) ship.nearestSystemStar = star;
    sendTo(galaxy, ship, at.x, at.y);
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
        if (w.dead) continue;
        if (w.ship === null || w.ship.hasBeenDestroyed) markDead(galaxy, st, w, null);
        else if (w.ship.actualEmpire !== st.faction) {
            // boarded and taken: the faction has lost it; for its new owner it is an ordinary (visible) ship
            w.ship.cloaked = false;
            markDead(galaxy, st, w, w.ship.actualEmpire);
        }
    }
    let sightingBusy = st.watchers.some((x) => !x.dead && (x.until === -1 || x.mode === 'sighting'));
    for (const w of st.watchers) {
        const started = driveWatcher(galaxy, st, w, !sightingBusy);
        if (started) sightingBusy = true;
        detectCloaked(galaxy, st, w);
    }
    st.sighted = st.watchers.filter((w) => !w.dead && w.ship !== null && !w.ship.hasBeenDestroyed && w.ship.cloaked !== true).map((w) => w.ship!);
    siphonPass(galaxy, st);
    siteDefencePass(galaxy, st);
    guardPass(galaxy, st);
    purgePass(galaxy, st);
    // the siphon is complete and the work waits at the last stage: the next delivery (or this nudge) finishes it
    const gw = st.site as (GreatWorkSite & { phase?: string }) | null;
    if (st.phase === 'watching' && gw !== null && gw.phase === 'building' && gw.progress >= 0.999 && siphonGateOpen(galaxy, st)) addProgress(galaxy, gw as never, 1);
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
    if (by !== null && isHumanEmpire(galaxy, by) && w.ship !== null) watcherMessage(galaxy, st, 'killed', by, [placeName(galaxy, w.ship)], null, EmpireMessageType.GeneralGoodEvent);
}

// ---------------------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------------------

function watcherOf(st: BeaconState, bo: BuiltObject): WatcherRec | undefined {
    return st.watchers.find((w) => w.ship === bo);
}

function onAttacked(galaxy: Galaxy, bo: BuiltObject, attacker: unknown, attackingEmpire: Empire | null): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null) return;
    const w = watcherOf(st, bo);
    if (w === undefined || w.dead) {
        // anything else of the faction under attack: the Beacon itself being hit shows in the news once
        return;
    }
    if (attackingEmpire === null || attackingEmpire === st.faction || !isNormalAttacker(galaxy, attackingEmpire)) return; // pirates and monsters get no reaction
    // The Reclamation has begun: the faction is at war with everyone, and the Watcher leads its fleet (beaconFleet.ts); nothing changes.
    if (!preBeam(st) || w.mode === 'lead') return;
    // SELF-DEFENCE, not war: the cloak drops and the Watcher's guns may open fire on the ships that attacked it and their fleets (attackWithoutWar,
    // watcherMayFire) until they are destroyed or gone. No war is declared or locked, and no relation changes.
    const now = galaxyStarDate(galaxy);
    bo.cloaked = false;
    if (w.mode !== 'fight') {
        w.prevMode = w.mode;
        w.prevUntil = w.until;
        w.prevModeDate = w.modeDate;
        if (w.mode === 'dwell') {
            // it leaves the world to defend itself: the corruption's progress on that world is lost (it starts the dwell again)
            w.prevModeDate = now;
            st.stats.dwellResets = (st.stats.dwellResets ?? 0) + 1;
        }
        setMode(w, 'fight', now);
        w.until = now; // marks when the fight began
        for (const e of humanEmpires(galaxy)) watcherMessage(galaxy, st, 'attack', e, [attackingEmpire.name, placeName(galaxy, bo)], bo, EmpireMessageType.GalacticNewsNet, true);
    }
    w.lastHit = now;
    const ship = attackerShipOf(attacker);
    if (ship !== null) {
        w.attackerShips ??= [];
        if (!w.attackerShips.includes(ship.builtObjectID)) w.attackerShips.push(ship.builtObjectID);
    }
    if (!w.attackedBy.includes(attackingEmpire.empireId)) w.attackedBy.push(attackingEmpire.empireId);
}

/** The ship behind an attack (a ship, or the carrier of a fighter); null for a creature or a base-less source. */
function attackerShipOf(attacker: unknown): BuiltObject | null {
    if (attacker === null || typeof attacker !== 'object') return null;
    const a = attacker as { builtObjectID?: number; parentBuiltObject?: BuiltObject | null };
    if (typeof a.builtObjectID === 'number') return attacker as BuiltObject;
    return a.parentBuiltObject ?? null;
}

/**
 * attackWithoutWar: a Watcher in a fight (before the Reclamation) may fire at `victim` only when it is one of the ships that attacked it
 * or sails in the same fleet as one of them. The stock combat code does the rest: a victim that is hit has the Watcher among its
 * attackers, so its empire's other ships near it join in against the Watcher the way they would against anyone who attacks them. Pure.
 */
export function watcherMayFire(galaxy: Galaxy, attacker: BuiltObject | undefined, victim: BuiltObject | undefined): boolean {
    if (attacker === undefined || victim === undefined) return false;
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || !preBeam(st)) return false;
    // the Reclaimer fleet the site's broken shield brought, and the Watchers called to the site: the empire ships in the site's system while the fight is on
    if (st.defence?.active === true && inSiteSystem(galaxy, st, victim)) {
        if (st.defence.fleet.includes(attacker) && siteVictim(galaxy, st, victim)) return true;
        const sw = watcherOf(st, attacker);
        if (sw !== undefined && !sw.dead && sw.mode === 'fight' && sw.siteFight === true && siteVictim(galaxy, st, victim)) return true;
    }
    const w = watcherOf(st, attacker);
    if (w === undefined || w.dead || w.mode !== 'fight' || w.attackerShips === undefined) return false;
    if (w.attackerShips.includes(victim.builtObjectID)) return true;
    const sg = victim.shipGroup as { ships?: readonly BuiltObject[] } | null | undefined;
    if (sg === null || sg === undefined || sg.ships === undefined) return false;
    return sg.ships.some((b) => !b.hasBeenDestroyed && w.attackerShips!.includes(b.builtObjectID));
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
        creditWatcherKill(galaxy, st, destroyer);
        warCreditWatcher(galaxy, st, destroyer);
        return;
    }
    if (bo.actualEmpire === st.faction) {
        warCreditKilled(galaxy, st, bo, destroyer); // (before the pools forget the ship)
        noteCattleCore(galaxy, st, bo, destroyer); // (its navigation record names the core it served)
        if ((st.cores ?? []).some((c) => c.ended === null && c.harvester === bo)) creditHarvesterKill(galaxy, st, destroyer);
        else if (bo !== st.beacon && bo.subRole === BuiltObjectSubRole.CapitalShip) creditCapitalKill(galaxy, st, destroyer);
        onShipKilled(galaxy, st, bo, destroyer);
        onKilledForSalvage(galaxy, st, bo, destroyer, false);
        if (bo === st.beacon) {
            st.beaconDestroyed = true;
            if (destroyer !== null) st.beaconKillerId = destroyer.empireId;
            // the fake-out: it does not end the Reclamation; the destroyer gets the beam lens
            creditBeaconKill(galaxy, st, destroyer);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The build: speed and suppliers
// ---------------------------------------------------------------------------------------------------------------

/** Build speed: each corrupted world speeds the Great Work up; a dead Watcher slows it sharply; past the stage the galaxy's tech allows it crawls. Pure. */
export function beaconBuildRate(galaxy: Galaxy, site: GreatWorkSite): number {
    const st = peekBeaconState(galaxy);
    if (st === null) return 1;
    const boost = Math.min(P.buildBoostCapPct(galaxy), P.buildBoostPct(galaxy) * unblockaded(galaxy, activeCorruption(st).map((c) => c.colony)).length); // (a blockaded corrupted world speeds nothing up)
    let rate = 1 + boost / 100;
    const dead = st.watchers.filter((w) => w.dead).length;
    for (let i = 0; i < dead; i++) rate *= P.watcherDeadFactorPct(galaxy) / 100;
    if (beaconTechSlowed(galaxy, site.progress)) rate *= P.techSlowPct(galaxy) / 100; // (it waits for the galaxy's technology)
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
    initHarvest(galaxy, st);
    ensureFoundries(galaxy, st);
    // No war yet: the Watchers gather, cloaked, round the Beacon and the first countdown runs; at the mega beam the war begins, the Watchers decloak and lead
    // their fleets, and the first season's groups come through (beaconFleet.ts fireBeam).
    st.warStarted = false;
    musterWatchers(galaxy, st);
    startBeamCountdown(galaxy, st);
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
        addPlating(d, [d], 300, 200); // (user 2026-10-19: was 600 / 400 with guns x1.5 — no coalition could break it)
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

/**
 * Every 5 days after completion. The threat's victories (framework.ts threatGameEndPolicy): 95% of the Reclaimers' peak assets destroyed
 * (beaconComponents.ts assetsBroken), or the mega-station fired (placeholder hook: fireMegaStation). Destroying the Beacon after it fired no
 * longer wins (the fake-out: it gives the beam lens and the Reclamation carries on). The old ending still holds: the Beacon and both Watchers
 * destroyed and no world held.
 */
export function beaconEndCheck(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.phase !== 'reclamation' || st.ended || st.faction === null) return;
    if (!st.beaconDestroyed && st.beacon !== null && st.beacon.hasBeenDestroyed) st.beaconDestroyed = true;
    if (st.megaFired === true) {
        st.assetVictoryDone = true;
        endReclamation(galaxy, st, T(`${TAG} Mega Title`), BEACON_CODE_MEGA, 'Mega');
        return;
    }
    if (st.assetVictoryDone !== true && assetsBroken(galaxy, st)) {
        st.assetVictoryDone = true;
        endReclamation(galaxy, st, T(`${TAG} Broken Title`), BEACON_CODE_ASSETS, 'Broken', Math.round(100 - assetsLeftPct(st)));
        return;
    }
    if (!st.beaconDestroyed || liveWatchers(st).length > 0 || st.watchers.some((w) => !w.dead)) return;
    if (processingWorlds(st).length > 0 || st.faction.colonies.some((c) => !c.hasBeenDestroyed)) return;
    endReclamation(galaxy, st, T(`${TAG} Victory Title`), BEACON_CODE_VICTORY, 'Victory');
}

/** The Reclamation is over (a victory): its news, the captives home, the leftover ships fall silent, the game ends (shared by every human). */
function endReclamation(galaxy: Galaxy, st: BeaconState, title: string, code: number, stage: string, arg?: number): void {
    const faction = st.faction!;
    st.ended = true;
    st.phase = 'ended';
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage, textTag: `${TAG} ${stage} News`, args: arg === undefined ? [] : [arg] });
    // the captives still on cattle ships go home; leftover ships fall silent
    for (const c of cattleOf(st)) if (!c.ship.hasBeenDestroyed) releaseCaptives(galaxy, st, c.load, c.ship, null, null);
    st.cattle = [];
    st.cattleOrders = [];
    for (const b of [...faction.builtObjects]) if (!b.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, b);
    threatGameEnd(galaxy, galaxy.playerEmpire, GameEndOutcome.Victory, title, code, true);
}

// ---------------------------------------------------------------------------------------------------------------
// Known sites and the map
// ---------------------------------------------------------------------------------------------------------------

/** The Reclaimers' assets left, as a percentage of their peak (appended to the status of their rows once they are at war). */
function assetsNote(st: BeaconState): string {
    return warOn(st) && st.parts !== undefined && st.parts.peakAssets > 0 ? ' ' + T(`${TAG} Assets Status`, Math.round(assetsLeftPct(st))) : '';
}

export function beaconKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null) return [];
    const out: KnownThreatSite[] = [];
    for (const w of st.watchers) {
        if (w.dead || w.ship === null || w.ship.hasBeenDestroyed) continue;
        const level = knowledgeLevel({ knowledge: w.knowledge }, empire);
        if (level < KNOWLEDGE_SUSPECTED) continue;
        // cloaked, a nameless contact; decloaked for good (the Reclamation's fleet flagship), a Watcher by name
        const row = w.mode === 'lead' ? 'Watcher Lead' : 'Watcher';
        out.push({ threat: BEACON_KEY, kind: 'ship', target: w.ship, level, site: { knowledge: w.knowledge }, label: T(`${TAG} ${row} Row`, placeName(galaxy, w.ship)), status: T(`${TAG} ${row} Status`) + (row === 'Watcher Lead' ? assetsNote(st) : '') });
    }
    for (const c of st.corrupted) {
        if (c.ended !== null || c.colony.empire !== empire) continue;
        if (knowledgeLevel({ knowledge: c.knowledge }, empire) < KNOWLEDGE_CONFIRMED) continue;
        out.push({ threat: BEACON_KEY, kind: 'colony', target: c.colony, level: KNOWLEDGE_CONFIRMED, site: { knowledge: c.knowledge }, label: T(`${TAG} Corrupt Row`, c.colony.name), status: T(`${TAG} Corrupt Status`, Math.round(purgeRebelStrength(galaxy, c.colony, resistanceFactor(st, empire))).toLocaleString('en-US'), c.purge !== undefined ? T(`${TAG} Corrupt Purging`) : siphonStatus(galaxy, st, c)) });
    }
    if (st.phase === 'reclamation' && st.beacon !== null && !st.beacon.hasBeenDestroyed) {
        out.push({ threat: BEACON_KEY, kind: 'ship', target: st.beacon, level: KNOWLEDGE_CONFIRMED, site: { knowledge: st.beaconKnowledge }, label: T(`${TAG} Beacon Row`, placeName(galaxy, st.beacon)), status: T(`${TAG} Beacon Status`, st.stats.conquests, Math.round(eliminatedPct(st))) + assetsNote(st) });
    }
    if (st.season !== null) {
        for (const sp of st.season.staging) {
            if (knowledgeLevel(sp, empire) < KNOWLEDGE_CONFIRMED || st.season.phase !== 'prep') continue;
            const ship = st.season.groups.flatMap((g) => g.ships).find((b) => !b.hasBeenDestroyed && galaxy.calculateDistance(b.xpos, b.ypos, sp.x, sp.y) < 25000);
            if (ship === undefined) continue;
            out.push({ threat: BEACON_KEY, kind: 'ship', target: ship, level: KNOWLEDGE_CONFIRMED, site: sp, label: T(`${TAG} Staging Row`, sp.name), status: T(`${TAG} Staging Status`, st.season.groups.filter((g) => g.staging === sp.index).reduce((n, g) => n + g.ships.length + g.transports.length, 0)) });
        }
    }
    const cores = knownCores(st, empire);
    // only the cores this empire has learned of (from the cattle ships it destroyed or boarded); the map marks them
    for (const c of cores) {
        out.push({ threat: BEACON_KEY, kind: 'colony', target: c.colony, level: KNOWLEDGE_CONFIRMED, glyph: 'core', label: T(`${TAG} Core Row`, c.colony.name), status: T(`${TAG} Core Status`, Math.round(c.waiting / 1e6).toLocaleString('en-US'), Math.round(c.processed / 1e6).toLocaleString('en-US')) + assetsNote(st) });
    }
    for (const r of processingWorlds(st)) {
        if (r.colony.empire !== st.faction || cores.some((c) => c.colony === r.colony)) continue;
        out.push({ threat: BEACON_KEY, kind: 'colony', target: r.colony, level: KNOWLEDGE_CONFIRMED, label: T(`${TAG} World Row`, r.colony.name), status: T(`${TAG} World Status`, Math.round((100 * r.drained) / Math.max(1, r.popStart))) });
    }
    return out;
}

const MARKER_COLOR = 0x8a2be2;
const PLANET_MARKER_COLOR = 0x4fc3f7;

/** Map: the staging points (those the viewer knows) and the Beacon, as the default ring marker. */
export function beaconMapFeatures(galaxy: Galaxy, viewer: Empire | null): ScenarioMapFeatures | null {
    const st = peekBeaconState(galaxy);
    if (st === null || viewer === null || st.phase !== 'reclamation') return null;
    const markers: ScenarioMapFeatures['markers'] = [];
    if (st.beacon !== null && !st.beacon.hasBeenDestroyed) markers.push({ x: st.beacon.xpos, y: st.beacon.ypos, label: '', color: MARKER_COLOR });
    if (st.season !== null && st.season.phase === 'prep') for (const sp of st.season.staging) if (knowledgeLevel(sp, viewer) >= KNOWLEDGE_CONFIRMED) markers.push({ x: sp.x, y: sp.y, label: sp.name, color: MARKER_COLOR });
    // the drifting precursor world, known to every empire from the Guardians' reveal on
    const planet = planetKnown(st);
    if (planet !== null) markers.push({ x: planet.x, y: planet.y, label: planetMarkerLabel(), color: PLANET_MARKER_COLOR });
    // (no harvest-core marker: a Reclaimer-held world looks like any taken planet on the map; the threat lists name it)
    return markers.length === 0 ? null : { markers, routes: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// What the art needs (render only): faction identification and roles
// ---------------------------------------------------------------------------------------------------------------

/** Art keys: 'cattle' is a cattle ship (a huge rectangular freighter, beaconHarvest.ts cattleDesign), 'harvester' a core's processing base. */
export type BeaconShipRole = 'watcher' | 'beacon' | 'capital' | 'cruiser' | 'destroyer' | 'frigate' | 'carrier' | 'transport' | 'planetDestroyer' | 'cattle' | 'harvester' | 'other';

export interface BeaconLooks {
    /** The machine faction ("the Watchers" / "the Reclaimers"), or null. Its ships, bases and the Beacon wear the new art. */
    faction: Empire | null;
    watchers: BuiltObject[];
    beacon: BuiltObject | null;
    /** Transports that carry Thralls (to draw the Thrall marker). */
    thrallShips: BuiltObject[];
    /** Cattle ships in flight (art key 'cattle') and the live harvesters over the cores (art key 'harvester'). */
    cattleShips: BuiltObject[];
    harvesters: BuiltObject[];
    /** The season's phase, its dates, the launch moment, the station's damage (beaconArtInfo; null before the state exists). */
    art: BeaconArtInfo | null;
}

const lookRecord: BeaconLooks = { faction: null, watchers: [], beacon: null, thrallShips: [], cattleShips: [], harvesters: [], art: null };

/** Read only (never creates state): who is who for the renderer. A shared record, refreshed in place. */
export function beaconLooks(galaxy: Galaxy): BeaconLooks {
    lookRecord.faction = null;
    lookRecord.watchers = [];
    lookRecord.beacon = null;
    lookRecord.thrallShips = [];
    lookRecord.cattleShips = [];
    lookRecord.harvesters = [];
    lookRecord.art = null;
    const st = peekBeaconState(galaxy);
    if (st === null) return lookRecord;
    lookRecord.cattleShips = cattleOf(st).map((c) => c.ship).filter((b) => !b.hasBeenDestroyed);
    lookRecord.harvesters = liveCores(st).map((c) => c.harvester).filter((b): b is BuiltObject => b !== null && !b.hasBeenDestroyed);
    lookRecord.art = beaconArtInfo(galaxy, st);
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
    if ((st.cattle ?? []).some((c) => c.ship === bo)) return 'cattle';
    if ((st.cores ?? []).some((c) => c.harvester === bo) || foundryOf(st, bo) !== null || depotOf(st, bo) !== null) return 'harvester'; // (a foundry and a depot wear the harvester's look)
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

/** The Game Editor entry that places the Beacon already finished (registerBeacon). */
export const BEACON_FINISHED_SPAWN = `${GW_KEY}:${BEACON_KIND}-finished`;

/**
 * Game Editor: the Beacon, already COMPLETE. The site and scaffold are made as for any Great Work (the Watchers come with the roll), then the real completion
 * path runs (completeWork -> beaconComplete): the Reclamation begins, the Watchers muster cloaked (here already at their places round the Beacon, not flying in
 * from the rim) and the first mega beam is beaconBeamDelayDays (10) away. A failed spawn leaves no work behind.
 */
export function spawnFinishedBeacon(galaxy: Galaxy): boolean {
    // A Beacon already under construction is finished where it stands (the editor's "Finish" beside "Spawn"); else one is placed first.
    const building = greatWorks(galaxy).some((w) => w.wonder === BEACON_KIND && w.phase === 'building');
    if (!building && !spawnGreatWork(galaxy, BEACON_KIND)) return false;
    const work = greatWorks(galaxy).find((w) => w.wonder === BEACON_KIND && w.phase === 'building');
    if (work === undefined) return false;
    completeWork(galaxy, work);
    const st = beaconState(galaxy);
    for (const w of st.watchers) {
        const at = w.ship !== null && !w.ship.hasBeenDestroyed ? musterPoint(st, w) : null;
        if (w.ship === null || at === null) continue;
        w.ship.xpos = at.x;
        w.ship.ypos = at.y;
    }
    return st.phase === 'reclamation';
}

/** Why the editor's Beacon "Finish" is unavailable (null: it can finish one under construction or place one finished). */
function finishedBeaconNote(galaxy: Galaxy): string | null {
    const works = greatWorks(galaxy).filter((w) => w.wonder === BEACON_KIND);
    if (works.some((w) => w.phase === 'building')) return null;
    if (works.some((w) => w.phase === 'complete')) return 'Already finished';
    return kindTaken(galaxy, BEACON_KIND) ? 'Not under construction yet' : null;
}

export const beaconKind: GreatWorkKind = {
    id: BEACON_KIND,
    flag: BEACON_FLAG,
    weight: 15,
    // The first tag is the most general (shared with the Ultramind and the Rift Gate: red herrings); the last is the Beacon's own tell.
    hintTags: ['superconductors', 'beacons', 'dark-alloys'],
    onRolled: beaconRolled,
    buildRateMultiplier: beaconBuildRate,
    extraSuppliers: beaconSuppliers,
    canComplete: (g) => {
        const st = peekBeaconState(g);
        return st === null || siphonGateOpen(g, st);
    },
    onComplete: beaconComplete,
    onDestroyed: beaconDestroyedEarly,
};

export const BEACON_HANDLER_IDS = ['beacon.watchers', 'beacon.reclaim', 'beacon.beam', 'beacon.monthly', 'beacon.attacked', 'beacon.killed', 'beacon.owner', 'beacon.destroyed', 'beacon.boarded', 'beacon.repair', 'beacon.armour', 'beacon.troops', 'beacon.counter', 'beacon.ai', 'beacon.cloakTarget', 'beacon.cloakSpares', 'beacon.cattleSpool', 'beacon.cattle', 'beacon.selfDefence', 'beacon.noWar', 'beacon.moratorium', 'beacon.moratoriumMonthly', 'beacon.siteAttacked'] as const;

export function registerBeacon(): void {
    registerWatcherDesigner(watcherDesign); // the Age 2 stranded Watchers are made of the same design (age2Watchers.ts)
    registerGreatWork(beaconKind);
    registerThreatSpawn({
        key: BEACON_FINISHED_SPAWN,
        label: 'Great Work: beacon (finished)',
        group: 'galactic',
        addons: [GW_KEY],
        // Finishes one under construction, or places one finished; not once it is finished (or only seeded, not yet building).
        note: (g) => spawnNote(g) ?? finishedBeaconNote(g),
        spawn: (g) => spawnFinishedBeacon(g),
    });
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
    // the mega beam fires on its day, not at the next stock long block (36 days at 1x): a day-scale check at every sim frame end
    registerScenarioFramePeriodic({ id: 'beacon.beam', flag: BEACON_FLAG, order: 21, periodDays: 1, run: (g) => beamPass(g) });
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
    registerScenarioEvent({ id: 'beacon.attacked', flag: BEACON_FLAG, event: 'builtObjectAttacked', run: (g, e) => onAttacked(g, e.builtObject, e.attacker, e.attackingEmpire) });
    registerScenarioEvent({ id: 'beacon.siteAttacked', flag: BEACON_FLAG, event: 'builtObjectAttacked', run: (g, e) => onSiteAttacked(g, e.builtObject, e.attacker, e.attackingEmpire) });
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
    registerScenarioEvent({
        id: 'beacon.boarded',
        flag: BEACON_FLAG,
        event: 'builtObjectOwnerChanged',
        run: (g, e) => {
            onBoarded(g, e.builtObject, e.from, e.to);
            // a cattle ship boarded and taken: its captives are rescued (rescueCattle: the hook a shared capture feature calls)
            const st = peekBeaconState(g);
            if (st === null || st.faction === null || e.from !== st.faction || e.to === st.faction) return;
            noteCattleCore(g, st, e.builtObject, e.to);
            rescueCattle(g, st, e.builtObject, e.to);
            // a Watcher taken (boarded, or by a story faction): lost to the faction at once (the 2-day pass may run a long block later)
            const w = watcherOf(st, e.builtObject);
            if (w !== undefined && !w.dead) {
                e.builtObject.cloaked = false;
                markDead(g, st, w, e.to);
                warCreditWatcher(g, st, e.to);
            } else if (w === undefined && e.builtObject.subRole === BuiltObjectSubRole.CapitalShip && e.builtObject !== st.beacon) warCreditCapturedCapital(g, st, e.to);
        },
    });
    // Machines mend themselves in the field (the stock AI would send a damaged warship home to a port the Reclaimers do not have).
    registerScenarioQuery({ id: 'beacon.repair', flag: BEACON_FLAG, query: 'repairRateFactor', run: (g, v, a) => (peekBeaconState(g)?.faction === a.builtObject.actualEmpire ? v * (cattleRepairFactor(g, a.builtObject) ?? 4) : v) });
    registerScenarioQuery({ id: 'beacon.armour', flag: BEACON_FLAG, query: 'armorReactivityFactor', run: (g, v, a) => { const st = peekBeaconState(g); if (st === null) return v; if (st.beacon === a.builtObject) return (v * P.stationReactivePct(g)) / 100; return st.faction !== null && a.builtObject.actualEmpire === st.faction ? (v * P.fleetReactivePct(g)) / 100 : v; } });
    registerScenarioQuery({ id: 'beacon.troops', flag: BEACON_FLAG, query: 'troopMaintenanceFactor', run: (g, v, a) => (peekBeaconState(g)?.faction === a.empire ? 0 : v) });
    // The AI never targets a cloaked Watcher: no mission (of any empire but the faction's own) may name a ship whose cloak still hides it
    // from the ship's empire. (The stock fog already keeps its AI from picking one; story factions that pick targets without the fog,
    // such as the Ancient Guardians, are stopped here.)
    registerScenarioQuery({
        id: 'beacon.cloakTarget',
        flag: BEACON_FLAG,
        query: 'assignMissionAllowed',
        run: (g, v, a) => {
            if (!v) return v;
            const t = a.target as { builtObjectID?: number; cloaked?: boolean } | null;
            if (t === null || t === undefined || t.builtObjectID === undefined || t.cloaked !== true) return v;
            const tb = t as unknown as BuiltObject;
            const owner = a.builtObject.actualEmpire;
            if (owner === null || owner === tb.actualEmpire) return v;
            return cloakLapsedFor(tb, owner, galaxyStarDate(g));
        },
    });
    // Nor does the stock combat shoot at (or board) a cloaked Watcher its empire cannot see: it is spared like a colony-system base,
    // unless it fired first (builtObjectSparesStaticTarget, the probe swarm's hook).
    registerScenarioQuery({
        id: 'beacon.cloakSpares',
        flag: BEACON_FLAG,
        query: 'builtObjectSparesStaticTarget',
        run: (g, v, a) => {
            if (v) return v;
            const t = a.target;
            if (t.cloaked !== true || a.builtObject.empire === null || a.builtObject.empire === t.empire) return v;
            return !cloakLapsedFor(t, a.builtObject.empire, galaxyStarDate(g));
        },
    });
    // Self-defence, not war: an attacked Watcher fires back at the ships that attacked it (and their fleets) without a war (stock combat asks this
    // right before the diplomatic relation test), and until the Reclamation nobody, the Reclaimers included, may declare war on the other.
    registerScenarioQuery({ id: 'beacon.selfDefence', flag: BEACON_FLAG, query: 'attackWithoutWar', run: (g, v, a) => v || watcherMayFire(g, a.attacker, a.victim) });
    registerScenarioQuery({
        id: 'beacon.noWar',
        flag: BEACON_FLAG,
        query: 'declareWarBlocked',
        run: (g, v, a) => {
            if (v) return v;
            const st = peekBeaconState(g);
            return st !== null && st.faction !== null && st.phase === 'watching' && (a.empire === st.faction || a.target === st.faction);
        },
    });
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
    registerComponents();
    registerWarCredit();
    registerCounterplay();
    registerBeaconAi();
    registerHarvest();
    registerPursuit();
    registerFoundry();
    registerMega();
    registerDepot();
}

registerBeacon();

// Kept for the soak / tests.
export { beaconArtInfo };
export { corruptCandidates as beaconCorruptCandidates, defenceOf as beaconDefenceOf, lossCheck as beaconLossCheck, referenceMilitary as beaconReferenceMilitary };
void calculateOverallStrengthFactorWithoutShields;
void BEACON_CODE_VICTORY;
