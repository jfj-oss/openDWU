// The Harvest Cycle, Age 2: the stranded Watchers. Not a port; made of stock mechanics (a faction ship, a stock Patrol, the Watchers' cloak, the
// scenario queries the Beacon already uses). At the Age 2 galaxy's start 1-3 (by galaxy size) damaged Watchers of the old age lie where the harvest
// was worst, one in each of some Harvest Scars of the memory record (longNightState.ts scars):
//   - a real Watcher ship (the Beacon's design and art) of a dormant machine faction that is at war with no one; its drive is dead (it cannot hyperjump:
//     hyperDenyHere) and it patrols the scar world (stock Patrol), CLOAKED: the players see nothing (independentTraders.ts cloakHides).
//   - the AI empires KNOW where it is: they put no colony ship on a world of its system (colonizationTargetValue 0) and send no ship into the system
//     (assignMissionAllowed refuses, unless the whole group is strong enough to win), so they do not feed it ships.
//   - an empire ship that comes within WATCHER_ALERT of it makes it decloak (the Beacon's decloak visuals and sound follow the flag) and, in self-defence
//     (attackWithoutWar), open fire on every empire ship within WATCHER_HUNT. After WATCHER_QUIET_DAYS with none near it cloaks again.
//   - the first time a human empire sees it decloak: a popup. The Knowledge page ("Left behind") lists it from then on.
//   - boarding it (the boarding defence is at least the Reclaimer capital's, beaconFoundryCapitalDefence) gives the captor the ship and reveals one
//     foundry of the memory record's list (a Truth when none is left to show).
//   - left alone for WATCHER_DEPART_YEARS it mends its drive and leaves: it joins the Beacon's Watchers when the Beacon exists, else it is gone.
// Params (scenario params): age2WatcherMax (3), age2WatcherStarsPer (200), age2WatcherAlertRange (14000), age2WatcherHuntRange (60000),
// age2WatcherQuietDays (20), age2WatcherDamagePct (25), age2WatcherDepartYears (40), age2WatcherStrongPct (200).
// Rnd: none on galaxy.rnd except the stock ship / faction generation; the scar choice uses age2Random.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import type { Design } from '../../../design';
import { HabitatType } from '../../../types';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire } from '../../../humanEmpires';
import { galaxyStarDate } from '../../../tick/simTime';
import { damageBuiltObjectComponents } from '../../../gameStartTail';
import { calculateOverallStrengthFactorWithoutShields } from '../../../diplomacyTick';
import { takeOwnershipOfBuiltObject } from '../../../combat/ownership';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioParam } from '../../state';
import { scenarioMessage, scenarioText as T } from '../../messages';
import { HARVEST_CYCLE_FLAG, LN_TAG, memoryRecordOf, registerMemoryContributor, type PlaceRec } from './longNightState';
// (last, and in this order: these reach back into the registration cycle through beaconFleet -> longNight, which needs the imports above bound)
import { createThreatFaction } from '../framework';
import { cloakLapsedFor, peekBeaconState, P, type WatcherRec } from './beaconState';
import { designFor, machineRace, reclaimerLevel, spawnShip, syncReclaimerTech } from './beaconFleet';
import { age2Random } from './age2World';
import { grantTruth, scarHabitats } from './age2Milestones';

export const STRANDED_KEY = 'age2Watchers';
export const STRANDED_TRUTH = 'age2-watcher-ledger';
/** A system this close (game units) to a stranded Watcher's world is its danger zone for the AI. */
const DANGER_RADIUS = 30000;

export interface StrandedRec {
    ship: BuiltObject | null;
    /** The scar world it patrols. */
    world: Habitat;
    status: 'stranded' | 'taken' | 'departed' | 'destroyed';
    mode: 'dormant' | 'hunt';
    /** Star date an empire ship was last near it while it hunted. */
    lastNear: number;
    /** Empire ids that saw it decloak. */
    discovered: number[];
    takenBy: number;
}

export interface StrandedState {
    faction: Empire | null;
    list: StrandedRec[];
    /** Star date the Age 2 galaxy began. */
    start: number;
    /** Human empire ids that got the discovery popup. */
    popup: number[];
    /** Empire id -> the foundry places the ship's capture showed it. */
    revealed: Record<string, PlaceRec[]>;
}

const p = (g: Galaxy, name: string, fallback: number): number => scenarioParam(g, name, fallback);
const WP = {
    max: (g: Galaxy) => Math.trunc(p(g, 'age2WatcherMax', 3)),
    starsPer: (g: Galaxy) => p(g, 'age2WatcherStarsPer', 200),
    alert: (g: Galaxy) => p(g, 'age2WatcherAlertRange', 14000),
    hunt: (g: Galaxy) => p(g, 'age2WatcherHuntRange', 60000),
    quietDays: (g: Galaxy) => p(g, 'age2WatcherQuietDays', 20),
    damagePct: (g: Galaxy) => p(g, 'age2WatcherDamagePct', 25),
    departYears: (g: Galaxy) => p(g, 'age2WatcherDepartYears', 40),
    strongPct: (g: Galaxy) => p(g, 'age2WatcherStrongPct', 200),
    capitalDefence: (g: Galaxy) => p(g, 'beaconFoundryCapitalDefence', 2500),
};

export function peekStranded(galaxy: Galaxy): StrandedState | null {
    const s = galaxy.scenario?.state[STRANDED_KEY];
    return s === undefined || s === null ? null : (s as StrandedState);
}

/** Watchers a galaxy of `starCount` stars gets (1..max). Pure. */
export function strandedCount(starCount: number, perWatcher: number, max: number): number {
    return Math.max(1, Math.min(Math.max(1, max), Math.round(starCount / Math.max(1, perWatcher))));
}

// The Beacon's Watcher design (beacon.ts registers its maker; this file must not import beacon.ts, which imports half the add-on).
type WatcherDesigner = (galaxy: Galaxy, faction: Empire, lvl: number) => Design | null;
let designer: WatcherDesigner | null = null;
export function registerWatcherDesigner(f: WatcherDesigner): void {
    designer = f;
}

function normal(galaxy: Galaxy, e: Empire | null, st: StrandedState | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== (st?.faction ?? null);
}

/** The live recs of a still-stranded Watcher, with its ship. Pure. */
function liveRecs(galaxy: Galaxy): (StrandedRec & { ship: BuiltObject })[] {
    const st = peekStranded(galaxy);
    if (st === null) return [];
    return st.list.filter((r): r is StrandedRec & { ship: BuiltObject } => r.status === 'stranded' && r.ship !== null && !r.ship.hasBeenDestroyed && r.ship.actualEmpire === st.faction);
}

/** Every stranded Watcher ship still afloat (any owner; the renderer draws them as Watchers). Pure. */
export function strandedShips(galaxy: Galaxy): BuiltObject[] {
    const st = peekStranded(galaxy);
    if (st === null) return [];
    return st.list.filter((r) => r.ship !== null && !r.ship.hasBeenDestroyed).map((r) => r.ship!);
}

function isStrandedShip(galaxy: Galaxy, bo: BuiltObject): boolean {
    return liveRecs(galaxy).some((r) => r.ship === bo);
}

/** A system the AI keeps out of: a stranded Watcher patrols it. Pure. */
export function dangerousSystem(galaxy: Galaxy, systemIndex: number): boolean {
    return liveRecs(galaxy).some((r) => r.world.systemIndex === systemIndex);
}

function placeNear(galaxy: Galaxy, x: number, y: number): string {
    let best = '';
    let bd = Infinity;
    for (const sys of galaxy.systems) {
        const s = sys?.systemStar ?? null;
        if (s === null) continue;
        const d = galaxy.calculateDistance(x, y, s.xpos, s.ypos);
        if (d < bd) {
            bd = d;
            best = s.name;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------------
// The start
// ---------------------------------------------------------------------------------------------------------------

/** The scar worlds a Watcher may lie at: distinct systems, none a home system, in a fixed shuffled order. */
function candidateWorlds(galaxy: Galaxy): Habitat[] {
    const homes = new Set<number>();
    for (const e of galaxy.empires) if (e !== null && e !== galaxy.independentEmpire && e.capital !== null) homes.add(e.capital.systemIndex);
    const seen = new Set<number>();
    const out: Habitat[] = [];
    for (const h of scarHabitats(galaxy)) {
        if (homes.has(h.systemIndex) || seen.has(h.systemIndex)) continue;
        seen.add(h.systemIndex);
        out.push(h);
    }
    const rnd = age2Random(galaxy.randomSeed, 7);
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** The new Age 2 galaxy, once built: the stranded Watchers. Returns how many were placed. */
export function placeStranded(galaxy: Galaxy, only: readonly Habitat[] | null = null): number {
    const sc = galaxy.scenario;
    if (sc === null || peekStranded(galaxy) !== null) return 0;
    const worlds = (only ?? candidateWorlds(galaxy)).slice(0, strandedCount(galaxy.starCount, WP.starsPer(galaxy), WP.max(galaxy)));
    const state: StrandedState = { faction: null, list: [], start: galaxyStarDate(galaxy), popup: [], revealed: {} };
    sc.state[STRANDED_KEY] = state;
    if (worlds.length === 0) return 0;
    const race = machineRace(galaxy);
    if (race === null) return 0;
    const lvl = reclaimerLevel(galaxy, null, P.watcherTechBonus(galaxy));
    const faction = createThreatFaction(galaxy, { race, name: T(`${LN_TAG} Stranded Faction`), techLevel: lvl, relationBias: 0 });
    if (faction === null) return 0;
    faction.capital = galaxy.findNearestHabitatOfType(worlds[0].xpos, worlds[0].ypos, HabitatType.Undefined);
    syncReclaimerTech(galaxy, faction, lvl, true);
    state.faction = faction;
    const design = designer?.(galaxy, faction, lvl) ?? designFor(galaxy, faction, BuiltObjectSubRole.CapitalShip);
    if (design === null) return 0;
    for (const h of worlds) {
        const ship = spawnShip(galaxy, faction, design, h.xpos, h.ypos);
        ship.name = T(`${LN_TAG} Stranded Name`);
        ship.cloaked = true;
        ship.isAutoControlled = false;
        damageBuiltObjectComponents(ship, WP.damagePct(galaxy) / 100);
        assignMission(galaxy, ship, BuiltObjectMissionType.Patrol, h, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        state.list.push({ ship, world: h, status: 'stranded', mode: 'dormant', lastNear: 0, discovered: [], takenBy: -1 });
    }
    return state.list.length;
}

// ---------------------------------------------------------------------------------------------------------------
// The watch (every day)
// ---------------------------------------------------------------------------------------------------------------

/** Normal empires' ships and bases within `range` of `ship`: the empires and their ships. Pure. */
function nearEmpires(galaxy: Galaxy, st: StrandedState, ship: BuiltObject, range: number): Map<Empire, BuiltObject[]> {
    const out = new Map<Empire, BuiltObject[]>();
    const r2 = range * range;
    for (const e of galaxy.empires) {
        if (!normal(galaxy, e, st)) continue;
        for (const list of [e.builtObjects, e.privateBuiltObjects]) {
            for (const b of list) {
                if (b.hasBeenDestroyed) continue;
                const dx = b.xpos - ship.xpos;
                const dy = b.ypos - ship.ypos;
                if (dx * dx + dy * dy > r2) continue;
                const l = out.get(e);
                if (l === undefined) out.set(e, [b]);
                else l.push(b);
            }
        }
    }
    return out;
}

function decloak(galaxy: Galaxy, st: StrandedState, rec: StrandedRec & { ship: BuiltObject }, near: Map<Empire, BuiltObject[]>): void {
    const ship = rec.ship;
    ship.cloaked = false;
    ship.cloakSeenBy = undefined;
    rec.mode = 'hunt';
    rec.lastNear = galaxyStarDate(galaxy);
    const where = galaxy.systems[rec.world.systemIndex]?.systemStar?.name ?? rec.world.name;
    for (const e of near.keys()) {
        if (!rec.discovered.includes(e.empireId)) rec.discovered.push(e.empireId);
        if (!isHumanEmpire(galaxy, e) || st.popup.includes(e.empireId)) continue;
        st.popup.push(e.empireId);
        scenarioMessage(galaxy, e, T(`${LN_TAG} Stranded Found Title`), T(`${LN_TAG} Stranded Found Body`, where), { type: EmpireMessageType.GeneralWarning, subject: ship, popupMode: 'force' });
    }
}

function recloak(rec: StrandedRec & { ship: BuiltObject }): void {
    rec.ship.cloaked = true;
    rec.ship.cloakSeenBy = undefined;
    rec.mode = 'dormant';
}

function patrolWorld(galaxy: Galaxy, rec: StrandedRec & { ship: BuiltObject }): void {
    const m = builtObjectMission(rec.ship.mission);
    if (m !== null && m.type !== BuiltObjectMissionType.Undefined && m.type !== BuiltObjectMissionType.Hold && m.type !== BuiltObjectMissionType.Move) return;
    rec.ship.isAutoControlled = false;
    assignMission(galaxy, rec.ship, BuiltObjectMissionType.Patrol, rec.world, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
}

/** Leaves the ship to the Beacon's Watchers when there is a Beacon, else the ship is gone. */
function depart(galaxy: Galaxy, st: StrandedState, rec: StrandedRec & { ship: BuiltObject }): void {
    const ship = rec.ship;
    rec.status = 'departed';
    const bst = peekBeaconState(galaxy);
    if (bst !== null && bst.faction !== null && bst.faction.active && !bst.ended) {
        takeOwnershipOfBuiltObject(galaxy, bst.faction, ship, bst.faction, false);
        ship.cloaked = true;
        ship.isAutoControlled = false;
        const now = galaxyStarDate(galaxy);
        const w: WatcherRec = { index: bst.watchers.length, ship, mode: 'parked', homeX: ship.xpos, homeY: ship.ypos, target: null, modeDate: now, nextCorruptDate: now + 60 * GAME_DAY_LENGTH, until: 0, dead: false, attackedBy: [], knowledge: [], detections: 0 };
        bst.watchers.push(w);
    } else builtObjectCompleteTeardown(galaxy, ship);
    for (const id of rec.discovered) {
        const e = galaxy.empires.find((x) => x !== null && x.empireId === id);
        if (e !== undefined && e !== null && e.active && isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, T(`${LN_TAG} Stranded Gone Title`), T(`${LN_TAG} Stranded Gone Body`), { type: EmpireMessageType.GeneralNeutralEvent, popupMode: 'quiet' });
    }
    void st;
}

export function strandedPass(galaxy: Galaxy): void {
    const st = peekStranded(galaxy);
    if (st === null || st.faction === null) return;
    const now = galaxyStarDate(galaxy);
    for (const rec of st.list) {
        if (rec.status !== 'stranded') continue;
        const ship = rec.ship;
        if (ship === null || ship.hasBeenDestroyed) {
            rec.status = 'destroyed';
            continue;
        }
        if (ship.actualEmpire !== st.faction) continue; // taken: the event handler books it
        if (ship.fuelCapacity > 0) ship.currentFuel = ship.fuelCapacity;
        const live = rec as StrandedRec & { ship: BuiltObject };
        if (rec.mode === 'dormant') {
            patrolWorld(galaxy, live);
            const near = nearEmpires(galaxy, st, ship, WP.alert(galaxy));
            if (near.size > 0) decloak(galaxy, st, live, nearEmpires(galaxy, st, ship, WP.hunt(galaxy)));
            else if (now - st.start >= WP.departYears(galaxy) * YEAR_LENGTH_DAYS) depart(galaxy, st, live);
        } else {
            const near = nearEmpires(galaxy, st, ship, WP.hunt(galaxy));
            if (near.size > 0) {
                rec.lastNear = now;
                for (const e of near.keys()) if (!rec.discovered.includes(e.empireId)) rec.discovered.push(e.empireId);
            } else if (now - rec.lastNear >= WP.quietDays(galaxy) * GAME_DAY_LENGTH) recloak(live);
            else patrolWorld(galaxy, live);
        }
    }
}

/** A game year in star-date units (the unit of galaxyStarDate): 360 game days. */
const YEAR_LENGTH_DAYS = 360 * GAME_DAY_LENGTH;

// ---------------------------------------------------------------------------------------------------------------
// Boarding and destruction
// ---------------------------------------------------------------------------------------------------------------

function recOf(galaxy: Galaxy, bo: BuiltObject): StrandedRec | undefined {
    return peekStranded(galaxy)?.list.find((r) => r.ship === bo);
}

/**
 * The captor learns one foundry that survived the Long Night and that the old player never found (the record's `alive` list, less the located ones and the
 * ones this captor was already shown); a record from before `alive` was kept shows its located list as it always did; with none left, the Truth of the ledger.
 */
function prize(galaxy: Galaxy, st: StrandedState, to: Empire, ship: BuiltObject): void {
    const mem = memoryRecordOf(galaxy);
    const shown = (st.revealed[String(to.empireId)] ??= []);
    const fo = mem?.foundries;
    const located = fo?.located ?? [];
    const pool = fo?.alive !== undefined ? fo.alive.filter((a) => !located.some((l) => l.x === a.x && l.y === a.y)) : located;
    const place = pool.find((f) => !shown.some((s) => s.x === f.x && s.y === f.y));
    if (place !== undefined) {
        shown.push(place);
        if (isHumanEmpire(galaxy, to)) {
            scenarioMessage(galaxy, to, T(`${LN_TAG} Stranded Prize Title`), T(`${LN_TAG} Stranded Prize Foundry Body`, place.name, placeNear(galaxy, place.x, place.y)), { type: EmpireMessageType.GeneralGoodEvent, subject: ship, popupMode: 'force' });
        }
        return;
    }
    grantTruth(galaxy, to, STRANDED_TRUTH);
    if (isHumanEmpire(galaxy, to)) scenarioMessage(galaxy, to, T(`${LN_TAG} Stranded Prize Title`), T(`${LN_TAG} Stranded Prize Truth Body`), { type: EmpireMessageType.GeneralGoodEvent, subject: ship, popupMode: 'force' });
}

export function onStrandedOwnerChanged(galaxy: Galaxy, bo: BuiltObject, from: Empire | null, to: Empire | null): void {
    const st = peekStranded(galaxy);
    const rec = recOf(galaxy, bo);
    if (st === null || rec === undefined || rec.status !== 'stranded' || from !== st.faction || to === null || to === st.faction) return;
    rec.status = 'taken';
    rec.takenBy = to.empireId;
    bo.cloaked = false;
    bo.cloakSeenBy = undefined;
    if (!rec.discovered.includes(to.empireId)) rec.discovered.push(to.empireId);
    if (normal(galaxy, to, st)) prize(galaxy, st, to, bo);
}

function onStrandedKilled(galaxy: Galaxy, bo: BuiltObject): void {
    const rec = recOf(galaxy, bo);
    if (rec !== undefined && rec.status === 'stranded') rec.status = 'destroyed';
}

// ---------------------------------------------------------------------------------------------------------------
// The queries
// ---------------------------------------------------------------------------------------------------------------

/** attackWithoutWar: a hunting stranded Watcher may fire at any empire ship within its hunt range. Pure. */
export function strandedMayFire(galaxy: Galaxy, attacker: BuiltObject | undefined, victim: BuiltObject | undefined): boolean {
    if (attacker === undefined || victim === undefined) return false;
    const st = peekStranded(galaxy);
    if (st === null) return false;
    const rec = liveRecs(galaxy).find((r) => r.ship === attacker);
    if (rec === undefined || rec.mode !== 'hunt') return false;
    const owner = victim.actualEmpire;
    if (!normal(galaxy, owner, st)) return false;
    return galaxy.calculateDistance(attacker.xpos, attacker.ypos, victim.xpos, victim.ypos) <= WP.hunt(galaxy);
}

function groupStrength(bo: BuiltObject): number {
    const sg = bo.shipGroup as { ships?: readonly BuiltObject[] } | null | undefined;
    const ships = sg?.ships !== undefined && sg.ships.length > 0 ? sg.ships : [bo];
    let s = 0;
    for (const b of ships) if (!b.hasBeenDestroyed) s += calculateOverallStrengthFactorWithoutShields(b);
    return s;
}

/** assignMissionAllowed: an AI ship does not take a mission into a stranded Watcher's system unless its group would win. Pure. */
export function strandedMissionAllowed(galaxy: Galaxy, bo: BuiltObject, target: unknown, x: number, y: number): boolean {
    const owner = bo.actualEmpire;
    if (owner === null || isHumanEmpire(galaxy, owner)) return true;
    const recs = liveRecs(galaxy);
    if (recs.length === 0 || recs.some((r) => r.ship === bo) || owner === peekStranded(galaxy)?.faction) return true;
    const t = target as { xpos?: number; ypos?: number; empire?: Empire | null } | null;
    let px: number;
    let py: number;
    if (t !== null && t !== undefined && typeof t.xpos === 'number' && typeof t.ypos === 'number') {
        if (t.empire === owner) return true; // its own colony / ship
        px = t.xpos;
        py = t.ypos;
    } else if (x > -2000000000 && y > -2000000000) {
        px = x;
        py = y;
    } else return true;
    for (const r of recs) {
        if (galaxy.calculateDistance(px, py, r.world.xpos, r.world.ypos) > DANGER_RADIUS) continue;
        if (groupStrength(bo) >= (calculateOverallStrengthFactorWithoutShields(r.ship) * WP.strongPct(galaxy)) / 100) continue;
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The Knowledge page
// ---------------------------------------------------------------------------------------------------------------

export interface StrandedRow {
    key: string;
    what: string;
    where: string;
    status: string;
    goTo: BuiltObject | null;
    point: { x: number; y: number };
}

/** The Watchers `empire` has seen decloak, and the foundries its captures showed it. Pure. */
export function strandedRowsOf(galaxy: Galaxy, empire: Empire): StrandedRow[] {
    const st = peekStranded(galaxy);
    if (st === null) return [];
    const rows: StrandedRow[] = [];
    st.list.forEach((r, i) => {
        if (!r.discovered.includes(empire.empireId)) return;
        const status = r.status === 'stranded' ? T(`${LN_TAG} Stranded Row Stranded`) : r.status === 'taken' ? T(`${LN_TAG} Stranded Row Taken`) : r.status === 'destroyed' ? T(`${LN_TAG} Stranded Row Destroyed`) : T(`${LN_TAG} Stranded Row Gone`);
        const live = r.ship !== null && !r.ship.hasBeenDestroyed;
        rows.push({ key: `stranded:${i}`, what: T(`${LN_TAG} Stranded Name`), where: galaxy.systems[r.world.systemIndex]?.systemStar?.name ?? r.world.name, status, goTo: live && r.mode === 'hunt' ? r.ship : null, point: { x: r.world.xpos, y: r.world.ypos } });
    });
    (st.revealed[String(empire.empireId)] ?? []).forEach((f, i) => rows.push({ key: `stranded:foundry:${i}`, what: f.name, where: placeNear(galaxy, f.x, f.y), status: T(`${LN_TAG} Stranded Row Foundry`), goTo: null, point: { x: f.x, y: f.y } }));
    return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export function registerAge2Watchers(): void {
    registerMemoryContributor({ id: 'age2.watchers', capture: () => undefined, restore: (g) => void placeStranded(g) });
    registerScenarioFramePeriodic({ id: 'age2Watchers.pass', flag: HARVEST_CYCLE_FLAG, order: 28, periodDays: 1, run: (g) => strandedPass(g) });
    registerScenarioEvent({ id: 'age2Watchers.owner', flag: HARVEST_CYCLE_FLAG, event: 'builtObjectOwnerChanged', run: (g, e) => onStrandedOwnerChanged(g, e.builtObject, e.from, e.to) });
    registerScenarioEvent({ id: 'age2Watchers.killed', flag: HARVEST_CYCLE_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onStrandedKilled(g, e.builtObject) });
    registerScenarioQuery({ id: 'age2Watchers.fire', flag: HARVEST_CYCLE_FLAG, query: 'attackWithoutWar', run: (g, v, a) => v || strandedMayFire(g, a.attacker, a.victim) });
    registerScenarioQuery({ id: 'age2Watchers.noJump', flag: HARVEST_CYCLE_FLAG, query: 'hyperDenyHere', run: (g, v, a) => v || isStrandedShip(g, a.builtObject) });
    registerScenarioQuery({ id: 'age2Watchers.boarding', flag: HARVEST_CYCLE_FLAG, query: 'boardingDefenseValue', run: (g, v, a) => (isStrandedShip(g, a.builtObject) ? Math.max(v, WP.capitalDefence(g)) : v) });
    registerScenarioQuery({ id: 'age2Watchers.dormant', flag: HARVEST_CYCLE_FLAG, query: 'stateAIDormant', run: (g, v, a) => v || (peekStranded(g)?.faction === a.empire && a.empire !== null) });
    // The AI knows: no colony ship, no mission into the system.
    registerScenarioQuery({ id: 'age2Watchers.colonise', flag: HARVEST_CYCLE_FLAG, query: 'colonizationTargetValue', run: (g, v, a) => (v > 0 && !isHumanEmpire(g, a.empire) && dangerousSystem(g, a.habitat.systemIndex) ? 0 : v) });
    registerScenarioQuery({ id: 'age2Watchers.avoid', flag: HARVEST_CYCLE_FLAG, query: 'assignMissionAllowed', run: (g, v, a) => v && strandedMissionAllowed(g, a.builtObject, a.target, a.x, a.y) });
    // A cloaked Watcher its empire cannot see is neither a target nor shot at (as the Beacon's Watchers).
    registerScenarioQuery({
        id: 'age2Watchers.cloakTarget',
        flag: HARVEST_CYCLE_FLAG,
        query: 'assignMissionAllowed',
        run: (g, v, a) => {
            if (!v) return v;
            const t = a.target as { builtObjectID?: number; cloaked?: boolean } | null;
            if (t === null || t === undefined || t.builtObjectID === undefined || t.cloaked !== true) return v;
            const tb = t as unknown as BuiltObject;
            const owner = a.builtObject.actualEmpire;
            if (owner === null || owner === tb.actualEmpire || !isStrandedShip(g, tb)) return v;
            return cloakLapsedFor(tb, owner, galaxyStarDate(g));
        },
    });
    registerScenarioQuery({
        id: 'age2Watchers.cloakSpares',
        flag: HARVEST_CYCLE_FLAG,
        query: 'builtObjectSparesStaticTarget',
        run: (g, v, a) => v || (a.target.cloaked === true && a.builtObject.empire !== null && a.builtObject.empire !== a.target.empire && isStrandedShip(g, a.target) && !cloakLapsedFor(a.target, a.builtObject.empire, galaxyStarDate(g))),
    });
}
