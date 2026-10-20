// Giantworks: the life of a Great Work. Not a port; composed of ported functions (each step cites its analogue).
//   seeded     - founders, site and wonder chosen at game start (founders.ts); nothing exists at the site yet;
//   building   - from the Gathering: the Founders' Compact (a neutral faction, the Exchange pattern: createEmpireMidGame adoptOnly,
//                stock AI off), the scaffold base at the site, and convoys of stock freighters from every founding world. Each
//                delivered freighter adds `perShip` progress (kind.buildRateMultiplier); five stages, the scaffold is renamed per stage;
//   complete   - the wonder is public (Confirmed for everyone) and kind.onComplete / periodic run;
//   destroyed / abandoned - the work is over (kind.onDestroyed).
// Rnd: convoy sizes, departure jitter and freighter picks draw from the add-on's own Random; the stock ship creation
// (generateBuiltObjectName, selectRelativeParkingPoint, selectRandomHeading) and createEmpireMidGame draw galaxy.rnd inside
// this add-on's own flag-gated periodic handler only.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { AutomationLevel } from '../../../empire';
import type { Habitat } from '../../../types';
import type { Design } from '../../../design';
import type { Race } from '../../../data/races';
import type { EmpirePolicy } from '../../../data/policies';
import { BuiltObject } from '../../../builtObject';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { galaxyDesignSpecificationBySubRole } from '../../../gameStartTail';
import { createNewDesigns, generateDesignFromSpec } from '../../../designGeneration';
import { latestDesignsFindNewestCanBuild } from '../../../pirates';
import { generateStartingCharacters } from '../../../characters';
import { DiplomaticRelation, DiplomaticRelationType } from '../../../diplomacy';
import { EmpireMessageType } from '../../../messages';
import { YEAR_LENGTH, startStarDateForAge } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { assignMission } from '../../../missions/assign';
import { createEmpireMidGame } from '../../empireMidGame';
import { isHumanEmpire } from '../../../humanEmpires';
import { GAME_DAY_LENGTH } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import { arcNews } from '../framework';
import { empireTechLevel } from '../robotMutiny';
import { capitals, chooseCircles, circlesCentroid, pickSite, siteBlocked, siteHabitat, systemsWithBases } from './founders';
import { confirmToAll, convoyTag, spreadRumour, updateKnowledge, kindName } from './knowledge';
import { greatWorkKind } from './registry';
import { compactFaction, gwParam, gwState, logGw, nextRandom, ordinaryEmpires, TAG, type GreatWorkConvoy, type GreatWorkRecord } from './state';
import { knowledgeLevel } from '../framework';
import { blockaderOf, blockadeSpeedFactor, gwBlockadesOn, worldAlive } from './blockade';

/** A freighter within this distance of the scaffold has delivered. */
export const DELIVER_RANGE = 9000;
/** Armed escorts that stay to guard a site. */
const GUARDS_MAX = 6;
const COORD_UNSET = -2000000001;

// ---------------------------------------------------------------------------------------------------------------
// The Founders' Compact
// ---------------------------------------------------------------------------------------------------------------

/** The stock empire AI off, as the Exchange does (Empire.cs Control* automation fields = Manual; no construction, colonisation, war). */
function switchOffStockAi(faction: Empire): void {
    faction.controlColonization = AutomationLevel.Undefined;
    faction.controlColonyDevelopment = false;
    faction.controlColonyStockLevels = false;
    faction.controlColonyTaxRates = false;
    faction.controlDiplomacyGifts = AutomationLevel.Undefined;
    faction.controlDiplomacyOffense = AutomationLevel.Undefined;
    faction.controlDiplomacyTreaties = AutomationLevel.Undefined;
    faction.controlMilitaryAttacks = AutomationLevel.Undefined;
    faction.controlMilitaryFleets = false;
    faction.controlStateConstruction = AutomationLevel.Undefined;
    faction.controlTroopGeneration = false;
    faction.controlAgentAssignment = AutomationLevel.Undefined;
    faction.controlColonyFacilities = AutomationLevel.Undefined;
    faction.controlPopulationPolicy = false;
    faction.controlCharacterLocations = false;
    faction.controlOfferPirateMissions = AutomationLevel.Undefined;
    faction.initiateConstruction = false;
}

/** Start.2.cs 1376-1427 meeting: a None relation on both sides (NotMet upgraded), as the Exchange introduces itself. */
function introduce(a: Empire, b: Empire): void {
    let r = a.diplomaticRelations.byEmpire(b);
    if (r === null) a.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, a, b, false));
    else if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
    r = b.diplomaticRelations.byEmpire(a);
    if (r === null) b.diplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, a, b, a, false));
    else if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
}

function peacefulPolicy(policy: EmpirePolicy): void {
    policy.offerPirateAttackMissions = 0;
    policy.offerDefensivePirateMissions = 0;
    policy.offerDefensivePirateMissionsSituation = 0;
    policy.offerSmugglingPirateMissions = 0;
}

/** The people the Compact is made of: the most numerous race of the first founding world. */
function compactRace(galaxy: Galaxy, work: GreatWorkRecord): Race | null {
    for (const h of work.founders) {
        const r = (h.population?.dominantRace as Race | null | undefined) ?? null;
        if (r !== null) return r;
    }
    return (galaxy.races.find((r): r is Race => r !== null && r.playable && r.canBeNormalEmpire) as Race | undefined) ?? null;
}

/** The mean tech level of the ordinary empires (the Compact builds at about that level). Pure. */
export function averageTech(galaxy: Galaxy): number {
    const es = ordinaryEmpires(galaxy);
    if (es.length === 0) return 1;
    return es.reduce((a, e) => a + empireTechLevel(e), 0) / es.length;
}

/** The Compact, created at the first Gathering (null if the galaxy has no empire id left). */
export function ensureCompact(galaxy: Galaxy, work: GreatWorkRecord): Empire | null {
    const st = gwState(galaxy);
    if (st.compact !== null && st.compact.active) return st.compact;
    const race = compactRace(galaxy, work);
    if (race === null) return null;
    const tech = Math.max(1, Math.min(7, Math.round(averageTech(galaxy))));
    const faction = createEmpireMidGame(galaxy, {
        kind: 'empire',
        race,
        name: scenarioText(`${TAG} Faction Name`),
        adoptOnly: true,
        techLevel: tech,
        configurePolicy: peacefulPolicy,
    });
    if (faction === null) return null;
    const standIn = work.habitat ?? work.system.systemStar;
    faction.capital = standIn; // stand-in capital: the stock AI reads Capital without a null check (the Exchange precedent)
    switchOffStockAi(faction);
    const now = galaxyStarDate(galaxy);
    createNewDesigns(galaxy, faction, now, now, true);
    generateStartingCharacters(galaxy, faction, standIn);
    for (const e of ordinaryEmpires(galaxy)) introduce(faction, e);
    faction.stateMoney = Math.max(faction.stateMoney, 5_000_000);
    st.compact = faction;
    return faction;
}

// ---------------------------------------------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------------------------------------------

export function factionDesign(galaxy: Galaxy, faction: Empire, subRole: BuiltObjectSubRole, fresh = false): Design | null {
    if (!fresh) {
        const d = latestDesignsFindNewestCanBuild(faction, subRole);
        if (d !== null) return d;
    }
    const spec = galaxyDesignSpecificationBySubRole(subRole);
    if (spec === null) return null;
    return generateDesignFromSpec(galaxy, faction, spec, 0, galaxyStarDate(galaxy));
}

/** A state-owned base / ship of the faction at `parent` (createIndependentShip / createStartingShip pattern, as the Exchange). */
export function placeObject(galaxy: Galaxy, faction: Empire, design: Design, parent: Habitat, name: string | null, parking: boolean): BuiltObject {
    design.buildCount++;
    const bo = new BuiltObject(design, name ?? galaxy.generateBuiltObjectName(design, parent), galaxy, true);
    bo.empire = faction;
    bo.purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    bo.nearestSystemStar = galaxy.determineHabitatSystemStar(parent);
    bo.supportCostFactor = 0; // paid for by the Compact's founders: no upkeep
    if (parking) {
        bo.heading = galaxy.selectRandomHeading();
        bo.targetHeading = bo.heading;
        const pt = galaxy.selectRelativeParkingPoint();
        faction.addBuiltObjectToGalaxy(bo, parent, false, true, Math.trunc(pt.x), Math.trunc(pt.y), false);
    } else {
        faction.addBuiltObjectToGalaxy(bo, parent, false, true, COORD_UNSET, COORD_UNSET, false);
    }
    return bo;
}

function stageName(stage: number): string {
    return scenarioText(`${TAG} Stage ${Math.min(4, stage)}`);
}

/** The scaffold base's name for a stage (the wonder renames the finished base). */
function scaffoldNameFor(work: GreatWorkRecord): string {
    return scenarioText(`${TAG} Scaffold Name`, stageName(work.stage));
}

/** Places a fresh scaffold base at the site (the first one, or the rebuilt one after a section was destroyed). */
export function placeScaffold(galaxy: Galaxy, work: GreatWorkRecord, faction: Empire): BuiltObject | null {
    const design = factionDesign(galaxy, faction, BuiltObjectSubRole.LargeSpacePort, true);
    if (design === null) return null;
    design.name = scenarioText(`${TAG} Scaffold Design`);
    const parent = work.habitat ?? work.system.systemStar;
    work.scaffoldName = scaffoldNameFor(work);
    const bo = placeObject(galaxy, faction, design, parent, work.scaffoldName, false);
    work.base = bo;
    return bo;
}

// ---------------------------------------------------------------------------------------------------------------
// The Gathering
// ---------------------------------------------------------------------------------------------------------------

/** Founding worlds that still send convoys: alive, populated and independent (a conquered founder stops). Pure. */
export function liveFounders(galaxy: Galaxy, work: GreatWorkRecord): Habitat[] {
    return work.founders.filter((h) => !h.hasBeenDestroyed && h.empire === galaxy.independentEmpire && h.population !== null && h.population !== undefined && h.population.totalAmount > 0);
}

function supplierValid(galaxy: Galaxy, work: GreatWorkRecord, h: Habitat): boolean {
    if (h.hasBeenDestroyed || h.population === null || h.population === undefined || h.population.totalAmount <= 0) return false;
    return h.empire === galaxy.independentEmpire || !work.founders.includes(h); // a founder taken by an empire stops; a wonder's extra suppliers (corrupted worlds) do not need to be independent
}

/** The worlds that send convoys now: the suppliers that are not blockaded (a blockaded world sends nothing). */
function senders(galaxy: Galaxy, work: GreatWorkRecord): Habitat[] {
    return suppliers(galaxy, work).filter((h) => blockaderOf(galaxy, h) === null);
}

/** Founding circles that still have a world sending convoys. Pure. */
function liveCircles(galaxy: Galaxy, work: GreatWorkRecord): number {
    const live = new Set(liveFounders(galaxy, work));
    return work.circles.filter((c) => c.some((h) => live.has(h))).length;
}

/**
 * The Gathering finds the founding worlds gone (absorbed, conquered or destroyed in the years since the seeding; in a late-age start
 * the empires have swallowed most independents by then): fewer than two circles left, so the founders are chosen again from the
 * independent worlds that remain (pilgrim colonies for a wedge without), with the same rules as at the seeding. The circles that
 * survive are kept when they are picked again. Another Great Work's founders are skipped.
 */
function refoundIfLost(galaxy: Galaxy, work: GreatWorkRecord): void {
    if (liveCircles(galaxy, work) >= 2) return;
    const st = gwState(galaxy);
    const used = new Set<Habitat>();
    for (const w of st.sites) if (w !== work && w.phase !== 'abandoned' && w.phase !== 'destroyed') for (const h of w.founders) used.add(h);
    const offset = nextRandom(galaxy).nextDouble() * ((Math.PI * 2) / 3);
    const { circles, pilgrims } = chooseCircles(galaxy, offset, used);
    if (circles.length < 2) {
        logGw(galaxy, galaxyStarDate(galaxy), `work ${work.id}: founders lost and only ${circles.length} circle(s) to re-found`);
        return;
    }
    logGw(galaxy, galaxyStarDate(galaxy), `work ${work.id}: founders lost, re-founded at ${circles.flat().map((h) => h.name).join(', ')}`);
    work.circles = circles;
    work.pilgrims = pilgrims;
    work.founders = circles.flat();
}

/**
 * Starts the building: re-checks the site (an empire may have settled it), creates the Compact and the scaffold, plans the
 * convoys. Returns false when it could not start (the work is then abandoned).
 */
export function startBuilding(galaxy: Galaxy, work: GreatWorkRecord): boolean {
    const now = galaxyStarDate(galaxy);
    if (work.phase !== 'seeded') return false;
    if (siteBlocked(galaxy, work.system, systemsWithBases(galaxy), capitals(galaxy), false) !== null) {
        const c = circlesCentroid(work.circles);
        const sys = pickSite(galaxy, c.x, c.y);
        if (sys === null) return abandon(galaxy, work, 'no empty system');
        work.system = sys;
        work.habitat = siteHabitat(galaxy, sys);
    }
    refoundIfLost(galaxy, work);
    const suppliers = liveFounders(galaxy, work);
    if (suppliers.length === 0) return abandon(galaxy, work, 'no founders left');
    const faction = ensureCompact(galaxy, work);
    if (faction === null) return abandon(galaxy, work, 'no empire id for the Compact');
    work.stage = 0;
    work.progress = 0;
    if (placeScaffold(galaxy, work, faction) === null) return abandon(galaxy, work, 'no scaffold design');
    work.phase = 'building';
    work.startDate = now;
    work.lastDelivery = now;
    work.suppliers = suppliers.slice();
    const per = (360 / gwParam(galaxy, 'giantworksConvoyDays')) * ((gwParam(galaxy, 'giantworksConvoyMin') + gwParam(galaxy, 'giantworksConvoyMax')) / 2);
    work.perShip = 1 / Math.max(1, suppliers.length * per * (work.buildYears ?? gwParam(galaxy, 'giantworksBuildMinYears')));
    const days = gwParam(galaxy, 'giantworksConvoyDays');
    suppliers.forEach((h, i) => {
        work.nextDeparture[String(h.habitatIndex)] = now + ((i + 0.2) / suppliers.length) * days * GAME_DAY_LENGTH;
    });
    if (!work.rumoured) spreadRumour(galaxy, work);
    const names = work.circles.map((c) => c[0].name);
    arcNews(galaxy, gwState(galaxy).sent, { prefix: TAG, stage: 'Gather', onceKey: `Gather:${work.id}`, args: [names[0] ?? '', names[1] ?? '', names[2] ?? ''] });
    logGw(galaxy, now, `work ${work.id} begins: Compact ${faction.name}, scaffold at ${work.system.systemStar.name}, ${suppliers.length} suppliers, ${work.perShip.toFixed(4)} per freighter`);
    return true;
}

export function abandon(galaxy: Galaxy, work: GreatWorkRecord, why: string): false {
    if (work.phase === 'complete' || work.phase === 'destroyed') return false;
    work.phase = 'abandoned';
    for (const c of work.convoys) for (const b of [...c.ships, ...c.escorts]) if (!b.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, b);
    work.convoys = [];
    logGw(galaxy, galaxyStarDate(galaxy), `work ${work.id} abandoned: ${why}`);
    return false;
}

/** The Gathering is due: the work's tech trigger (rolled in giantworksGatherTechMin..Max, on the research techLevel scale the siphon gate uses) reached by the empires' average tech (not before the floor year), or the much later fallback year passed. Pure. */
export function gatheringDue(galaxy: Galaxy, work: GreatWorkRecord): boolean {
    const now = galaxyStarDate(galaxy);
    if (work.forced || now >= work.gatherDate) return true;
    const floor = startStarDateForAge(galaxy.age) + gwParam(galaxy, 'giantworksGatherFloorYear') * YEAR_LENGTH;
    return now >= floor && averageTech(galaxy) >= (work.gatherTech ?? gwParam(galaxy, 'giantworksGatherTechMin'));
}

// ---------------------------------------------------------------------------------------------------------------
// Convoys
// ---------------------------------------------------------------------------------------------------------------

function distance(galaxy: Galaxy, a: { xpos: number; ypos: number }, b: { xpos: number; ypos: number }): number {
    return galaxy.calculateDistance(a.xpos, a.ypos, b.xpos, b.ypos);
}

function idle(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Hold;
}

function sendTo(galaxy: Galaxy, bo: BuiltObject, work: GreatWorkRecord): void {
    if (work.base === null) return;
    assignMission(galaxy, bo, BuiltObjectMissionType.Move, work.base, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
}

function inFlight(work: GreatWorkRecord, origin: Habitat): number {
    let n = 0;
    for (const c of work.convoys) if (c.origin === origin) n += c.ships.length;
    return n;
}

/** All worlds that send convoys now: the founders and the wonder's extra suppliers. */
function suppliers(galaxy: Galaxy, work: GreatWorkRecord): Habitat[] {
    const kind = greatWorkKind(work.wonder);
    const out: Habitat[] = [];
    for (const h of [...work.suppliers, ...(kind?.extraSuppliers?.(galaxy, work) ?? [])]) if (!out.includes(h) && supplierValid(galaxy, work, h)) out.push(h);
    return out;
}

function spawnConvoy(galaxy: Galaxy, work: GreatWorkRecord, faction: Empire, origin: Habitat, rnd: import('../../../random').Random): GreatWorkConvoy | null {
    const small = factionDesign(galaxy, faction, BuiltObjectSubRole.SmallFreighter);
    const medium = factionDesign(galaxy, faction, BuiltObjectSubRole.MediumFreighter);
    if (small === null && medium === null) return null;
    const min = Math.max(1, Math.trunc(gwParam(galaxy, 'giantworksConvoyMin')));
    const max = Math.max(min, Math.trunc(gwParam(galaxy, 'giantworksConvoyMax')));
    const size = rnd.next(min, max + 1);
    const tag = convoyTag(galaxy, work, rnd);
    const ships: BuiltObject[] = [];
    for (let i = 0; i < size; i++) {
        const design = (rnd.next(0, 3) === 1 ? medium ?? small : small ?? medium)!;
        const bo = placeObject(galaxy, faction, design, origin, null, true);
        ships.push(bo);
        sendTo(galaxy, bo, work);
    }
    const escorts: BuiltObject[] = [];
    const esc = factionDesign(galaxy, faction, BuiltObjectSubRole.Frigate);
    for (let i = 0; esc !== null && i < Math.trunc(gwParam(galaxy, 'giantworksEscorts')); i++) {
        const bo = placeObject(galaxy, faction, esc, origin, null, true);
        escorts.push(bo);
        if (ships.length > 0) assignMission(galaxy, bo, BuiltObjectMissionType.Escort, ships[0], null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        else sendTo(galaxy, bo, work);
    }
    const st = gwState(galaxy);
    const c: GreatWorkConvoy = { id: ++work.convoySeq, origin, ships, escorts, tag, departed: galaxyStarDate(galaxy), size: ships.length, delivered: 0, lost: 0, seen: [] };
    work.convoys.push(c);
    st.stats.convoys++;
    st.stats.freighters += ships.length;
    return c;
}

/** Moves the convoys: arrivals deliver (progress), the lost are counted, idle ships are sent on, fuel is topped up. Returns the freighters delivered. */
function stepConvoys(galaxy: Galaxy, work: GreatWorkRecord, faction: Empire): number {
    const base = work.base;
    if (base === null || base.hasBeenDestroyed) return 0;
    const st = gwState(galaxy);
    let delivered = 0;
    for (const c of work.convoys) {
        const alive: BuiltObject[] = [];
        for (const b of c.ships) {
            if (b.hasBeenDestroyed || b.actualEmpire !== faction) {
                c.lost++;
                work.lost++;
                st.stats.lost++;
                continue;
            }
            if (distance(galaxy, b, base) <= DELIVER_RANGE) {
                delivered++;
                c.delivered++;
                const key = String(c.origin.habitatIndex);
                work.deliveredBy[key] = (work.deliveredBy[key] ?? 0) + 1;
                builtObjectCompleteTeardown(galaxy, b);
                continue;
            }
            b.currentFuel = b.fuelCapacity;
            const m = builtObjectMission(b.mission) as { targetBuiltObject?: BuiltObject | null } | null;
            if (idle(b) || m?.targetBuiltObject !== base) sendTo(galaxy, b, work);
            alive.push(b);
        }
        c.ships = alive;
        const esc: BuiltObject[] = [];
        for (const b of c.escorts) {
            if (b.hasBeenDestroyed || b.actualEmpire !== faction) continue;
            b.currentFuel = b.fuelCapacity;
            if (distance(galaxy, b, base) <= DELIVER_RANGE) {
                work.guards = work.guards.filter((g) => !g.hasBeenDestroyed);
                if (work.guards.length < GUARDS_MAX) work.guards.push(b);
                else builtObjectCompleteTeardown(galaxy, b);
                continue;
            }
            if (idle(b)) sendTo(galaxy, b, work);
            esc.push(b);
        }
        c.escorts = esc;
    }
    work.convoys = work.convoys.filter((c) => c.ships.length > 0 || c.escorts.length > 0);
    return delivered;
}

function departures(galaxy: Galaxy, work: GreatWorkRecord, faction: Empire, now: number): void {
    const rnd = nextRandom(galaxy);
    const days = gwParam(galaxy, 'giantworksConvoyDays');
    const cap = gwParam(galaxy, 'giantworksMaxInFlight');
    for (const s of senders(galaxy, work)) {
        const key = String(s.habitatIndex);
        if (work.nextDeparture[key] === undefined) work.nextDeparture[key] = now + rnd.nextDouble() * days * GAME_DAY_LENGTH;
        if (work.nextDeparture[key] > now) continue;
        if (inFlight(work, s) >= cap) {
            work.nextDeparture[key] = now + 30 * GAME_DAY_LENGTH;
            continue;
        }
        spawnConvoy(galaxy, work, faction, s, rnd);
        work.nextDeparture[key] = now + days * GAME_DAY_LENGTH * (0.85 + rnd.nextDouble() * 0.3);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Progress, stages, completion
// ---------------------------------------------------------------------------------------------------------------

/** The stage of a progress. Pure. */
export function stageOf(progress: number): 0 | 1 | 2 | 3 | 4 {
    if (progress >= 1) return 4;
    return Math.min(3, Math.max(0, Math.floor(progress * 4))) as 0 | 1 | 2 | 3;
}

function tellStage(galaxy: Galaxy, work: GreatWorkRecord): void {
    for (const e of ordinaryEmpires(galaxy)) {
        if (!isHumanEmpire(galaxy, e)) continue;
        if (!work.seenBy.includes(e.empireId) && knowledgeLevel(work, e) < 2) continue;
        scenarioMessage(galaxy, e, scenarioText(`${TAG} Stage Title`), scenarioText(`${TAG} Stage Reached`, work.system.systemStar.name, stageName(work.stage)), {
            type: EmpireMessageType.GeneralNeutralEvent,
            subject: work.base ?? work.system.systemStar,
            popup: false,
        });
    }
}

function renameScaffold(work: GreatWorkRecord): void {
    if (work.base !== null && !work.base.hasBeenDestroyed && work.phase === 'building') {
        work.scaffoldName = scaffoldNameFor(work);
        work.base.name = work.scaffoldName;
    }
}

/** Adds (or, negative, takes back) progress; stages follow, completion at 1. */
export function addProgress(galaxy: Galaxy, work: GreatWorkRecord, delta: number): void {
    if (work.phase !== 'building') return;
    work.progress = Math.max(0, Math.min(1, work.progress + delta));
    if (work.progress >= 1 && greatWorkKind(work.wonder)?.canComplete?.(galaxy, work) === false) work.progress = 0.999; // (the Beacon waits for its siphoned knowledge)
    const stage = stageOf(work.progress);
    if (stage >= 4) {
        completeWork(galaxy, work);
        return;
    }
    if (stage !== work.stage) {
        const up = stage > work.stage;
        work.stage = stage;
        renameScaffold(work);
        if (up) tellStage(galaxy, work);
    }
}

export function completeWork(galaxy: Galaxy, work: GreatWorkRecord): void {
    if (work.phase !== 'building') return;
    const now = galaxyStarDate(galaxy);
    work.phase = 'complete';
    work.progress = 1;
    work.stage = 4;
    work.completeDate = now;
    for (const c of work.convoys) for (const b of [...c.ships, ...c.escorts]) if (!b.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, b);
    work.convoys = [];
    gwState(galaxy).stats.completed++;
    confirmToAll(galaxy, work);
    const kind = greatWorkKind(work.wonder);
    const name = kindName(work.wonder);
    const text = scenarioText(`${TAG} Complete ${work.wonder}`);
    scenarioNews(galaxy, null, text === `${TAG} Complete ${work.wonder}` ? scenarioText(`${TAG} Complete News`, name, work.system.systemStar.name) : text, () => true, work.base ?? work.system.systemStar);
    kind?.onComplete(galaxy, work);
    if (work.base !== null && !work.base.hasBeenDestroyed && work.base.name === work.scaffoldName) work.base.name = name;
    logGw(galaxy, now, `work ${work.id} complete: ${work.wonder}`);
}

/** The work is over because it was destroyed by `by` (null: no known destroyer). The crime and the anger are the caller's. */
export function destroyWork(galaxy: Galaxy, work: GreatWorkRecord, by: Empire | null): void {
    if (work.phase !== 'building' && work.phase !== 'complete') return;
    const wasComplete = work.phase === 'complete';
    work.phase = 'destroyed';
    work.destroyedBy = by;
    for (const c of work.convoys) for (const b of [...c.ships, ...c.escorts]) if (!b.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, b);
    work.convoys = [];
    gwState(galaxy).stats.destroyed++;
    greatWorkKind(work.wonder)?.onDestroyed?.(galaxy, work, by);
    logGw(galaxy, galaxyStarDate(galaxy), `work ${work.id} destroyed by ${by?.name ?? 'unknown'}${wasComplete ? ' (finished)' : ''}`);
}

// ---------------------------------------------------------------------------------------------------------------
// The periodic step of one work
// ---------------------------------------------------------------------------------------------------------------

/** Per-period upkeep of the faction's treasury (it pays nothing but must never be bankrupt). */
function keepSolvent(faction: Empire): void {
    if (faction.stateMoney < 5_000_000) faction.stateMoney = 5_000_000;
}

/** One 10-day step of a work. */
export function stepWork(galaxy: Galaxy, work: GreatWorkRecord): void {
    const now = galaxyStarDate(galaxy);
    switch (work.phase) {
        case 'seeded':
            if (!work.rumoured && !work.forced && now >= work.rumourDate) spreadRumour(galaxy, work);
            if (gatheringDue(galaxy, work)) startBuilding(galaxy, work);
            return;
        case 'building': {
            const faction = compactFaction(galaxy);
            if (faction === null) {
                abandon(galaxy, work, 'the Compact is gone');
                return;
            }
            keepSolvent(faction);
            if (work.base === null || work.base.hasBeenDestroyed) return; // the actions module resolves what happened to it
            work.guards = work.guards.filter((g) => !g.hasBeenDestroyed);
            const delivered = stepConvoys(galaxy, work, faction);
            if (delivered > 0) {
                const mult = Math.max(0, Math.min(10, greatWorkKind(work.wonder)?.buildRateMultiplier?.(galaxy, work) ?? 1));
                work.delivered += delivered;
                gwState(galaxy).stats.delivered += delivered;
                work.lastDelivery = now;
                // a wonder's extra suppliers (the Beacon's corrupted worlds) keep the work alive but add no speed: progress per freighter is shared out over every sending world once they outnumber the founders (the wonder's buildRateMultiplier is the speed-up)
                let share = work.suppliers.length / Math.max(work.suppliers.length, suppliers(galaxy, work).length);
                if (gwBlockadesOn(galaxy)) {
                    // Blockades that bite: the founders the empires control cut the SPEED (20% each, blockade.ts), not just the convoys: the freighters that still
                    // come are worth what the missing ones would have been (a world that is gone is a plain loss), times the speed left
                    const gone = work.suppliers.filter((h) => !worldAlive(h)).length;
                    share = (blockadeSpeedFactor(galaxy, work) * Math.max(0, work.suppliers.length - gone)) / Math.max(1, senders(galaxy, work).length);
                }
                addProgress(galaxy, work, delivered * work.perShip * share * mult);
            }
            if (work.phase !== 'building') return;
            if (now - Math.max(work.lastDelivery, work.startDate) > gwParam(galaxy, 'giantworksStallYears') * YEAR_LENGTH) {
                abandon(galaxy, work, 'no deliveries');
                return;
            }
            departures(galaxy, work, faction, now);
            updateKnowledge(galaxy, work);
            return;
        }
        case 'complete': {
            const faction = compactFaction(galaxy);
            if (faction !== null) keepSolvent(faction);
            work.guards = work.guards.filter((g) => !g.hasBeenDestroyed);
            greatWorkKind(work.wonder)?.periodic?.(galaxy, work);
            return;
        }
        default:
            return;
    }
}

