// The Beacon, part 7: the Reclaimer BIOFUEL DEPOTS (Giantworks wonder, flag gwBeacon). Not a port.
// Real bases (the faction's defensive-base design, the harvester's look: no new art) that hold the Reclaimers' FLEET biofuel, the account that pays their warships,
// cattle ships, response fleets and patrols (beaconHarvest.ts fuelOf().fleet). They sit in the open (not cloaked), lightly guarded.
//   COUNT: capped by the galaxy's size: twice the foundry curve (depotCountFor): 10 at 250 stars or fewer, 20 at 1,000, 40 at 4,000 (linear, cap 40).
//   PLACEMENT: round the harvest cores (a core calls for beaconDepotPerCore depots: the cap spread over the cores the galaxy allows, in its own system), and, on
//     about one conquest in beaconDepotConquestOdds (6), one at the world the Reclaimers took. Raised over time: one every beaconDepotBuildDays, never above the cap.
//   THE STOCK: the fleet biofuel is split equally across the living depots. A depot destroyed takes exactly its share of the CURRENT stock with it (stock / N).
//     With no depot alive (once the first was raised) new biofuel cannot be stored: it is there only until the fleet passes have spent it (beaconDepotSettleDays)
//     and the rest is lost. Before the first depot the stock (the awakening reserve) is kept as it always was.
//   REBUILDING: a destroyed depot is replaced slowly, one per beaconDepotRebuildDays, paid beaconDepotRebuildFuelPct % of the reference military from the fleet
//     biofuel, at a held core (the nearest to the old site); never above the cap.
//   DEFENCE: beaconDepotGuardShips ships stand guard (rebuilt every beaconDepotGuardRebuildDays); a threatened depot is a threatened held world to the response
//     fleets (beaconResponse.ts threatsOf asks depotThreats).
//   KNOWLEDGE: an empire that has seen a depot knows it (the Knowledge page, src/ui/knowledgeView.ts, lists depotsKnownTo); the destroyer's message says how much of
//     the fuel burned. Not carried across the Long Night: the state lives in the Beacon's and a new cycle starts without it.
// Rnd: private beaconRandom only (the angle round the world, the conquest roll).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Design } from '../../../design';
import type { BuiltObject } from '../../../builtObject';
import type { Habitat } from '../../../types';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { generateDesignFromSpec } from '../../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { isHumanEmpire, humanEmpires } from '../../../humanEmpires';
import { isObjectVisibleToThisEmpire } from '../../../independentTraders';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, scenarioEmit } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText as T } from '../../messages';
import { scenarioParam } from '../../state';
import { empireTechLevel } from '../robotMutiny';
import { BEACON_FLAG, SYSTEM_RADIUS, beaconRandom, peekBeaconState, type BeaconState } from './beaconState';
import { addPlating, designFor, enemyStrengthNear, processingWorlds, referenceMilitary, spawnShip } from './beaconFleet';
import { coreTarget, fuelOf, liveCores, payFleet } from './beaconHarvest';
import { foundryCountFor, starSystemCount } from './beaconFoundry';

const TAG = 'Beacon';

export interface DepotRec {
    id: number;
    /** Where it stands (kept after its destruction). */
    x: number;
    y: number;
    /** The world it stands beside (the response fleets treat a threat to the depot as a threat to it). */
    host: Habitat | null;
    /** The base (null once destroyed). */
    base: BuiltObject | null;
    guard: BuiltObject[];
    status: 'active' | 'destroyed';
    builtDate: number;
    guardDate: number;
    /** Ids of the empires that have seen it (the Knowledge page). */
    seenBy: number[];
    /** The empire that destroyed it (0: none) and when. */
    destroyedBy: number;
    destroyedDate: number;
    /** The share of the fuel stock (0-1) that burned with it. */
    burned: number;
}

export interface DepotState {
    list: DepotRec[];
    nextId: number;
    /** Worlds waiting for a depot (a core's slots, a conquest's one), built one per beaconDepotBuildDays. */
    pending: Habitat[];
    /** Habitat indices already accounted for: cores that called for their depots, held worlds the conquest roll was made for. */
    coreSeen: number[];
    procSeen: number[];
    /** A depot has stood: the no-depot storage rule applies from now on. */
    armed: boolean;
    /** Destroyed depots still to be replaced. */
    toRebuild: number;
    lastBuild: number;
    lastRebuild: number;
    /** With no depot: the income already counted and when unstored fuel was first seen (null: none). */
    incomeSeen: number;
    unstoredSince: number | null;
    /** Empire id to depots it destroyed (the war credit). */
    destroyedBy: Record<string, number>;
    stats: Record<string, number>;
}

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

function p(g: Galaxy, name: string, fallback: number): number {
    return scenarioParam(g, name, fallback);
}

export const D = {
    /** 0: by galaxy size (depotCountFor). */
    count: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconDepotCount', 0))),
    /** One in this many conquests that are not cores gets a depot. */
    conquestOdds: (g: Galaxy) => Math.max(1, p(g, 'beaconDepotConquestOdds', 6)),
    buildDays: (g: Galaxy) => p(g, 'beaconDepotBuildDays', 15),
    rebuildDays: (g: Galaxy) => p(g, 'beaconDepotRebuildDays', 180),
    /** A rebuilt depot costs this % of the reference military from the fleet biofuel. */
    rebuildFuelPct: (g: Galaxy) => p(g, 'beaconDepotRebuildFuelPct', 4),
    guardShips: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'beaconDepotGuardShips', 2))),
    guardRebuildDays: (g: Galaxy) => p(g, 'beaconDepotGuardRebuildDays', 60),
    armourPct: (g: Galaxy) => p(g, 'beaconDepotArmourPct', 150),
    shieldPct: (g: Galaxy) => p(g, 'beaconDepotShieldPct', 100),
    /** Days new biofuel is kept when no depot stands (the fleet passes spend it meanwhile), then the rest is lost. */
    settleDays: (g: Galaxy) => p(g, 'beaconDepotSettleDays', 6),
    /** Enemy warships this close to a depot threaten it. */
    threatRange: (g: Galaxy) => p(g, 'beaconDepotThreatRange', 30000),
};

// ---------------------------------------------------------------------------------------------------------------
// State, counts
// ---------------------------------------------------------------------------------------------------------------

/** How many depots a galaxy of `stars` star systems may have: twice the foundry curve, 10 up to 250, 20 at 1,000, 40 at 4,000 (cap 40). Pure. */
export function depotCountFor(stars: number): number {
    return Math.min(40, 2 * foundryCountFor(stars));
}

/** The cap for this galaxy (the beaconDepotCount param overrides the curve). Pure. */
export function depotCap(galaxy: Galaxy): number {
    return D.count(galaxy) > 0 ? Math.min(40, D.count(galaxy)) : depotCountFor(starSystemCount(galaxy));
}

function newDepotState(): DepotState {
    return { list: [], nextId: 1, pending: [], coreSeen: [], procSeen: [], armed: false, toRebuild: 0, lastBuild: -1e18, lastRebuild: -1e18, incomeSeen: 0, unstoredSince: null, destroyedBy: {}, stats: {} };
}

export function depotsOf(st: BeaconState): DepotState {
    return (st.depots ??= newDepotState());
}

function stat(ds: DepotState, key: string, n = 1): void {
    ds.stats[key] = (ds.stats[key] ?? 0) + n;
}

export function liveDepots(st: BeaconState): DepotRec[] {
    return (st.depots?.list ?? []).filter((d) => d.status === 'active' && d.base !== null && !d.base.hasBeenDestroyed);
}

export function depotOf(st: BeaconState, bo: BuiltObject): DepotRec | null {
    for (const d of st.depots?.list ?? []) if (d.base === bo) return d;
    return null;
}

/** The depots `empire` has seen (the Knowledge page). Pure. */
export function depotsKnownTo(st: BeaconState, empire: Empire): DepotRec[] {
    return (st.depots?.list ?? []).filter((d) => d.seenBy.includes(empire.empireId));
}

/** Depots `empire` destroyed (the war credit). Pure. */
export function depotsDestroyedBy(galaxy: Galaxy, empire: Empire): number {
    return peekBeaconState(galaxy)?.depots?.destroyedBy[String(empire.empireId)] ?? 0;
}

/** The fleet biofuel one living depot holds: the stock split equally. Pure. */
export function depotShare(st: BeaconState): number {
    const n = liveDepots(st).length;
    return n > 0 ? Math.max(0, fuelOf(st).fleet) / n : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Making them
// ---------------------------------------------------------------------------------------------------------------

/** The depot design: the faction's defensive base, lightly plated; never an AI build. */
export function depotDesign(galaxy: Galaxy, faction: Empire): Design | null {
    const name = T('Beacon Depot Design');
    for (const d of faction.designs) if (d !== null && d.name === name) return d;
    const spec = faction.designSpecifications.find((s) => s !== null && s.subRole === BuiltObjectSubRole.DefensiveBase) ?? galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.DefensiveBase);
    if (spec === null || spec === undefined) return null;
    try {
        const d = generateDesignFromSpec(galaxy, faction, spec, Math.max(1, empireTechLevel(faction)), galaxyStarDate(galaxy));
        if (d === null) return null;
        addPlating(d, [d], D.armourPct(galaxy), D.shieldPct(galaxy));
        d.name = name;
        d.isObsolete = true;
        faction.designs.push(d);
        return d;
    } catch {
        return null;
    }
}

const GUARD_CYCLE: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate];

/** Adds up to `n` guard ships (free) beside the depot. */
function topUpGuard(galaxy: Galaxy, st: BeaconState, d: DepotRec, n: number): void {
    const faction = st.faction;
    if (faction === null) return;
    d.guard = d.guard.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === faction);
    for (let i = 0; i < n && d.guard.length < D.guardShips(galaxy); i++) {
        const des = designFor(galaxy, faction, GUARD_CYCLE[d.guard.length % GUARD_CYCLE.length]);
        if (des === null) return;
        d.guard.push(spawnShip(galaxy, faction, des, d.x, d.y));
        d.guardDate = galaxyStarDate(galaxy);
    }
}

/** Raises a depot beside `host` (a random bearing, a few thousand units off the world). Null when no design can be made. */
function raiseDepot(galaxy: Galaxy, st: BeaconState, ds: DepotState, host: Habitat): DepotRec | null {
    const faction = st.faction;
    if (faction === null) return null;
    const design = depotDesign(galaxy, faction);
    if (design === null) return null;
    const rnd = beaconRandom(galaxy, st, 71);
    const angle = rnd.nextDouble() * Math.PI * 2;
    const r = SYSTEM_RADIUS * (0.15 + 0.2 * rnd.nextDouble());
    const x = host.xpos + Math.cos(angle) * r;
    const y = host.ypos + Math.sin(angle) * r;
    const base = spawnShip(galaxy, faction, design, x, y);
    const now = galaxyStarDate(galaxy);
    const d: DepotRec = { id: ds.nextId++, x, y, host, base, guard: [], status: 'active', builtDate: now, guardDate: now, seenBy: [], destroyedBy: 0, destroyedDate: 0, burned: 0 };
    base.name = T('Beacon Depot Name', d.id);
    ds.list.push(d);
    ds.armed = true;
    topUpGuard(galaxy, st, d, D.guardShips(galaxy));
    return d;
}

/** How many depots (standing or waiting) round `h`: a core's slots go to its own system first. Pure. */
function depotsAt(st: BeaconState, h: Habitat): number {
    let n = 0;
    for (const d of liveDepots(st)) if (d.host === h) n++;
    for (const x of st.depots?.pending ?? []) if (x === h) n++;
    return n;
}

/** The depots a core calls for: the cap spread over the cores the galaxy allows (at least one). Pure. */
export function perCore(galaxy: Galaxy): number {
    const cores = Math.max(1, coreTarget(galaxy));
    return Math.max(1, Math.ceil(depotCap(galaxy) / cores));
}

/** Queues the depots new cores call for and rolls for the new conquests. */
function intake(galaxy: Galaxy, st: BeaconState, ds: DepotState): void {
    const cap = depotCap(galaxy);
    const room = (): number => cap - liveDepots(st).length - ds.pending.length - ds.toRebuild;
    for (const c of liveCores(st)) {
        const i = c.colony.habitatIndex;
        if (ds.coreSeen.includes(i)) continue;
        ds.coreSeen.push(i);
        const want = Math.min(perCore(galaxy), room());
        for (let k = 0; k < want; k++) ds.pending.push(c.colony);
        // (a core that was already rolled for as a conquest keeps that depot: its slots come on top, within the cap)
        ds.procSeen.push(i);
    }
    for (const r of processingWorlds(st)) {
        const i = r.colony.habitatIndex;
        if (ds.procSeen.includes(i)) continue;
        ds.procSeen.push(i);
        if (room() <= 0) continue;
        if (beaconRandom(galaxy, st, 72).nextDouble() * D.conquestOdds(galaxy) < 1) {
            ds.pending.push(r.colony);
            stat(ds, 'conquestSlots');
        }
    }
}

/** A held world to rebuild at: the live core nearest (x, y) with the fewest depots, else the nearest held world. */
function rebuildHost(galaxy: Galaxy, st: BeaconState, x: number, y: number): Habitat | null {
    let best: Habitat | null = null;
    let bs = Infinity;
    for (const c of liveCores(st)) {
        const s = galaxy.calculateDistance(x, y, c.colony.xpos, c.colony.ypos) * (1 + depotsAt(st, c.colony));
        if (s < bs) {
            bs = s;
            best = c.colony;
        }
    }
    if (best !== null) return best;
    for (const r of processingWorlds(st)) {
        const s = galaxy.calculateDistance(x, y, r.colony.xpos, r.colony.ypos);
        if (s < bs) {
            bs = s;
            best = r.colony;
        }
    }
    return best;
}

function buildPass(galaxy: Galaxy, st: BeaconState, ds: DepotState, now: number): void {
    const cap = depotCap(galaxy);
    const faction = st.faction!;
    // first the ones called for by cores and conquests
    ds.pending = ds.pending.filter((h) => !h.hasBeenDestroyed && h.empire === faction);
    if (ds.pending.length > 0 && liveDepots(st).length < cap && now - ds.lastBuild >= days(D.buildDays(galaxy))) {
        const h = ds.pending.shift()!;
        if (raiseDepot(galaxy, st, ds, h) !== null) {
            ds.lastBuild = now;
            stat(ds, 'built');
        }
        return;
    }
    // then the replacements, slowly and paid from the fleet biofuel
    if (ds.toRebuild > 0 && liveDepots(st).length < cap && now - ds.lastRebuild >= days(D.rebuildDays(galaxy))) {
        const last = [...ds.list].reverse().find((d) => d.status === 'destroyed');
        const h = rebuildHost(galaxy, st, last?.x ?? 0, last?.y ?? 0);
        if (h === null) return;
        const cost = (referenceMilitary(galaxy, faction) * D.rebuildFuelPct(galaxy)) / 100;
        if (fuelOf(st).fleet < cost) return;
        if (raiseDepot(galaxy, st, ds, h) !== null) {
            payFleet(st, cost);
            ds.toRebuild--;
            ds.lastRebuild = now;
            stat(ds, 'rebuilt');
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Falling, the stock
// ---------------------------------------------------------------------------------------------------------------

/** A depot's base was destroyed (by `destroyer`, null: no empire): exactly its share of the current stock burns with it, the guard is released, the news. */
function depotFell(galaxy: Galaxy, st: BeaconState, ds: DepotState, d: DepotRec, destroyer: Empire | null): void {
    if (d.status === 'destroyed') return;
    const n = ds.list.filter((x) => x.status === 'active').length; // (this one still counted: the stock is split among every depot that stood)
    d.status = 'destroyed';
    d.destroyedDate = galaxyStarDate(galaxy);
    d.destroyedBy = destroyer?.empireId ?? 0;
    d.base = null;
    const fuel = fuelOf(st);
    const lost = n > 0 ? Math.max(0, fuel.fleet) / n : 0;
    fuel.fleet = Math.max(0, fuel.fleet - lost);
    d.burned = n > 0 ? 1 / n : 0;
    if (ds.toRebuild === 0) ds.lastRebuild = galaxyStarDate(galaxy); // (the rebuild clock starts when the first one falls)
    ds.toRebuild++;
    stat(ds, 'destroyed');
    stat(ds, 'fuelBurned', lost);
    for (const b of d.guard) if (!b.hasBeenDestroyed) st.reserve.push(b);
    d.guard = [];
    const left = liveDepots(st).length;
    if (destroyer !== null) ds.destroyedBy[String(destroyer.empireId)] = (ds.destroyedBy[String(destroyer.empireId)] ?? 0) + 1;
    scenarioEmit(galaxy, 'depotDestroyed', { empire: destroyer, depot: d });
    const pct = Math.round(d.burned * 100);
    // TODO-PROSE: the tags 'Beacon Depot Destroyed Title' / 'Beacon Depot Destroyed' / 'Beacon Depot Destroyed News' have placeholder text
    if (destroyer !== null && isHumanEmpire(galaxy, destroyer)) scenarioMessage(galaxy, destroyer, T(`${TAG} Depot Destroyed Title`), T(`${TAG} Depot Destroyed`, T('Beacon Depot Name', d.id), pct, left, depotCap(galaxy)), { type: EmpireMessageType.GeneralGoodEvent, popupMode: 'quiet' });
    scenarioNews(galaxy, null, T(`${TAG} Depot Destroyed News`, destroyer?.name ?? '?', pct, left), () => true, null);
}

function stockPass(galaxy: Galaxy, st: BeaconState, ds: DepotState, now: number): void {
    const fuel = fuelOf(st);
    if (liveDepots(st).length > 0 || !ds.armed) {
        ds.unstoredSince = null;
        ds.incomeSeen = fuel.income;
        return;
    }
    // no depot stands: what is made since cannot be stored; it waits only for the fleet passes to spend it
    if (fuel.income > ds.incomeSeen + 1e-9 || fuel.fleet > 0) {
        if (ds.unstoredSince === null) ds.unstoredSince = now;
    }
    ds.incomeSeen = fuel.income;
    if (ds.unstoredSince !== null && now - ds.unstoredSince >= days(D.settleDays(galaxy))) {
        if (fuel.fleet > 0) stat(ds, 'unstoredLost', fuel.fleet);
        fuel.fleet = 0;
        ds.unstoredSince = null;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------------------------------------------

export function depotPass(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st === null || st.faction === null || !st.faction.active || st.phase !== 'reclamation') return;
    const ds = depotsOf(st);
    const now = galaxyStarDate(galaxy);
    const faction = st.faction;
    // a base that fell without a killing blow we saw (a monster, a mission), or was boarded: torn down, the destroyer credited when an empire has it
    for (const d of ds.list) {
        if (d.status !== 'active') continue;
        const b = d.base;
        if (b === null || b.hasBeenDestroyed) depotFell(galaxy, st, ds, d, null);
        else if (b.actualEmpire !== faction) {
            const by = b.actualEmpire as Empire | null;
            builtObjectCompleteTeardown(galaxy, b);
            depotFell(galaxy, st, ds, d, by !== null && by !== galaxy.independentEmpire ? by : null);
        }
    }
    intake(galaxy, st, ds);
    buildPass(galaxy, st, ds, now);
    for (const d of liveDepots(st)) {
        d.guard = d.guard.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === faction);
        if (d.guard.length < D.guardShips(galaxy) && now - d.guardDate >= days(D.guardRebuildDays(galaxy))) topUpGuard(galaxy, st, d, 1);
        for (const e of humanEmpires(galaxy)) if (!d.seenBy.includes(e.empireId) && d.base !== null && isObjectVisibleToThisEmpire(galaxy, e, d.base)) d.seenBy.push(e.empireId);
    }
    stockPass(galaxy, st, ds, now);
}

/** The held worlds a depot's danger puts in danger (beaconResponse.ts threatsOf): each living depot with enemy warships near it, as its host world (held), with the enemy strength. Pure. */
export function depotThreats(galaxy: Galaxy, st: BeaconState): { world: Habitat; enemy: number }[] {
    const out: { world: Habitat; enemy: number }[] = [];
    const range = D.threatRange(galaxy);
    for (const d of liveDepots(st)) {
        const h = d.host;
        if (h === null || h.hasBeenDestroyed || h.empire !== st.faction) continue;
        const e = enemyStrengthNear(galaxy, st, d.x, d.y, range);
        if (e > 0) out.push({ world: h, enemy: e });
    }
    return out;
}

/** A one-line account for the soak hook and the tests. Pure. */
export function depotSummary(galaxy: Galaxy, st: BeaconState): { alive: number; cap: number; pending: number; toRebuild: number; share: number; fuel: number; stats: Record<string, number> } {
    const ds = st.depots;
    return { alive: liveDepots(st).length, cap: depotCap(galaxy), pending: ds?.pending.length ?? 0, toRebuild: ds?.toRebuild ?? 0, share: Math.round(depotShare(st)), fuel: Math.round(fuelOf(st).fleet), stats: { ...(ds?.stats ?? {}) } };
}

export function registerDepot(): void {
    registerScenarioFramePeriodic({ id: 'beacon.depot', flag: BEACON_FLAG, order: 27, periodDays: 2, run: (g) => depotPass(g) });
    registerScenarioEvent({
        id: 'beacon.depotKilled',
        flag: BEACON_FLAG,
        event: 'builtObjectKilledBy',
        run: (g, e) => {
            const st = peekBeaconState(g);
            const ds = st?.depots;
            if (st === null || ds === undefined) return;
            const d = depotOf(st, e.builtObject);
            if (d !== null) depotFell(g, st, ds, d, e.destroyer !== null && e.destroyer !== st.faction ? e.destroyer : null);
        },
    });
}
