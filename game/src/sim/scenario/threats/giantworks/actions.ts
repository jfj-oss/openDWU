// Giantworks: what empires do about a Great Work, and what follows. Not a port; every action rides on stock mechanics and
// the events they emit, so the player, the AI and the pirates all take part through the same code:
//   Protect  - warships on station near the site (patrol / escort / guard missions) earn days; at giantworksProtectDays the
//              Compact's regard for that empire rises and it is counted a protector (a hostile wonder later makes that a stain);
//   Sabotage - the stock espionage missions DestroyBase / SabotageConstruction on the scaffold: a destroyed section sets the
//              work back and is rebuilt; sabotaged construction sets it back a little. A saboteur who is caught (the stock
//              detection outcomes) loses standing with everyone. Never a war crime;
//   Destroy  - the scaffold or the finished wonder is destroyed by ships (stock combat: a mission Attack on a base needs no war).
//              A war crime ('greatWork', war-crimes add-on) unless the Diet has passed "Authorise demolition" or the finished
//              wonder turned hostile; the Compact's anger rises either way;
//   Seize    - the finished wonder's base changes owner by stock boarding: its holder changes, a crime unless hostile / authorised.
// Attacks on convoys count as the existing 'independents' crime (once per ship) and anger the Compact.
// Rnd: none.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { IntelligenceMissionOutcome, IntelligenceMissionType, intelligenceMissionTarget } from '../../../espionage';
import type { IntelligenceMission } from '../../../characters';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire } from '../../../humanEmpires';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioEvent } from '../../hooks';
import { scenarioFlag } from '../../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import { applyReputation } from '../../reputation/ledger';
import { dietLawViolation } from '../../charactersVictory/diet/diet';
import { lawInForce, peekDietState } from '../../charactersVictory/diet/dietState';
import { recordWarCrime, WAR_CRIMES_FLAG } from '../../charactersVictory/diet/warCrimes';
import { addProgress, destroyWork, placeScaffold } from './lifecycle';
import { kindName, onSpyMission } from './knowledge';
import { compactFaction, GW_FLAG, gwParam, gwState, greatWorks, isCompact, logGw, ordinaryEmpires, PERIOD_DAYS, TAG, type GreatWorkRecord } from './state';

export const LAW_PROTECT = 'gwProtect';
export const LAW_DEMOLISH = 'gwDemolish';
export const LAW_INTERNATIONALISE = 'gwIntl';

// ---------------------------------------------------------------------------------------------------------------
// Who is an actor, which work an object belongs to
// ---------------------------------------------------------------------------------------------------------------

/** An ordinary empire: the kind that commits crimes and earns standing (not independents, pirates, the Compact). Pure. */
export function isActor(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && !isCompact(galaxy, e);
}

export interface ObjectRole {
    work: GreatWorkRecord;
    role: 'base' | 'freighter' | 'escort' | 'guard';
}

/** The Great Work a ship or base belongs to (its scaffold / wonder, a convoy freighter or escort, a guard). Pure. */
export function workOfObject(galaxy: Galaxy, bo: BuiltObject): ObjectRole | null {
    for (const w of greatWorks(galaxy)) {
        if (w.phase !== 'building' && w.phase !== 'complete') continue;
        if (w.base === bo) return { work: w, role: 'base' };
        if (w.guards.includes(bo)) return { work: w, role: 'guard' };
        for (const c of w.convoys) {
            if (c.ships.includes(bo)) return { work: w, role: 'freighter' };
            if (c.escorts.includes(bo)) return { work: w, role: 'escort' };
        }
    }
    return null;
}

export function demolitionAuthorised(galaxy: Galaxy): boolean {
    return lawInForce(peekDietState(galaxy), LAW_DEMOLISH) !== null;
}

// ---------------------------------------------------------------------------------------------------------------
// Anger
// ---------------------------------------------------------------------------------------------------------------

export function angerOf(work: GreatWorkRecord, e: Empire): number {
    return work.anger[e.empireId] ?? 0;
}

export function addAnger(work: GreatWorkRecord, e: Empire, amount: number): void {
    work.anger[e.empireId] = Math.min(1000, (work.anger[e.empireId] ?? 0) + amount);
}

/** Yearly: the Compact's anger fades. */
export function angerYearly(galaxy: Galaxy): void {
    const keep = 1 - gwParam(galaxy, 'giantworksAngerDecayPct') / 100;
    for (const w of greatWorks(galaxy)) {
        for (const k of Object.keys(w.anger)) {
            w.anger[k] *= keep;
            if (w.anger[k] < 0.5) delete w.anger[k];
        }
    }
}

function compactRegard(galaxy: Galaxy, e: Empire, value: number, cause: string): void {
    const c = compactFaction(galaxy);
    if (c === null) return;
    applyReputation(galaxy, c, e, value, { cause, labelKey: `Reputation Cause ${cause}`, source: 'giantworks', decayPerYear: 0.5 });
}

// ---------------------------------------------------------------------------------------------------------------
// Attacks on convoys, guards and the base
// ---------------------------------------------------------------------------------------------------------------

function lawViolation(galaxy: Galaxy, work: GreatWorkRecord, e: Empire, now: number): void {
    const law = lawInForce(peekDietState(galaxy), LAW_PROTECT);
    if (law === null || work.hostile) return;
    const last = work.violations[e.empireId];
    if (last !== undefined && now - last < YEAR_LENGTH) return;
    work.violations[e.empireId] = now;
    dietLawViolation(galaxy, e, law);
}

function onAttacked(galaxy: Galaxy, bo: BuiltObject, attacker: Empire | null): void {
    if (attacker === null) return;
    const r = workOfObject(galaxy, bo);
    if (r === null || !isActor(galaxy, attacker)) return;
    const w = r.work;
    const now = galaxyStarDate(galaxy);
    if (r.role === 'base') {
        w.attackedBy = { empire: attacker, date: now };
        if (w.phase === 'complete' && w.hostile) return;
        if (angerOf(w, attacker) < 1) addAnger(w, attacker, 1);
        lawViolation(galaxy, w, attacker, now);
        return;
    }
    if (w.hits[bo.builtObjectID] !== undefined) return; // each ship counts once
    w.hits[bo.builtObjectID] = now;
    if (w.phase === 'complete' && w.hostile) return;
    addAnger(w, attacker, gwParam(galaxy, 'giantworksAngerAttack'));
    compactRegard(galaxy, attacker, -1, 'giantworks.attack');
    if (scenarioFlag(galaxy, WAR_CRIMES_FLAG)) recordWarCrime(galaxy, attacker, 'independents', null, `gw${bo.builtObjectID}`, 3600);
    lawViolation(galaxy, w, attacker, now);
    if (isHumanEmpire(galaxy, attacker) && w.hits.__told === undefined) {
        w.hits.__told = now;
        scenarioMessage(galaxy, attacker, scenarioText(`${TAG} Convoy Attacked Title`), scenarioText(`${TAG} Convoy Attacked`), { type: EmpireMessageType.GeneralWarning, subject: bo, popup: false });
    }
}

function onKilledBy(galaxy: Galaxy, bo: BuiltObject, destroyer: Empire | null): void {
    const r = workOfObject(galaxy, bo);
    if (r === null || r.role !== 'base') return;
    r.work.attackedBy = { empire: destroyer, date: galaxyStarDate(galaxy) };
}

// ---------------------------------------------------------------------------------------------------------------
// Espionage
// ---------------------------------------------------------------------------------------------------------------

function onIntelExposed(galaxy: Galaxy, performer: Empire, target: Empire): void {
    if (!isCompact(galaxy, target)) return;
    const now = galaxyStarDate(galaxy);
    for (const w of greatWorks(galaxy)) if (w.phase === 'building' || w.phase === 'complete') w.exposed = { empireId: performer.empireId, date: now };
}

function onIntelCompleted(galaxy: Galaxy, empire: Empire, m: IntelligenceMission): void {
    const T = IntelligenceMissionType;
    const now = galaxyStarDate(galaxy);
    const target = intelligenceMissionTarget(m);
    if ((m.type === T.DestroyBase || m.type === T.SabotageConstruction) && target !== null && typeof target === 'object' && 'builtObjectID' in target) {
        const r = workOfObject(galaxy, target as BuiltObject);
        if (r === null || r.role !== 'base') return;
        const w = r.work;
        const caught = w.exposed !== null && w.exposed.empireId === empire.empireId && now - w.exposed.date < 2 * GAME_DAY_LENGTH;
        const kill = m.type === T.DestroyBase;
        w.sabotage = { by: empire, date: now, caught, kill };
        if (!kill && w.phase === 'building') {
            addProgress(galaxy, w, -gwParam(galaxy, 'giantworksSabotageSmallPct') / 100);
            noteSabotage(galaxy, w, empire, caught);
        }
        return;
    }
    if (m.type === T.DeepCover || m.type === T.StealTechData) {
        const te = m.targetEmpire;
        if (te === null || te === undefined || (!isCompact(galaxy, te) && te !== galaxy.independentEmpire) || !isActor(galaxy, empire)) return;
        for (const w of greatWorks(galaxy)) onSpyMission(galaxy, w, empire, m.type === T.DeepCover ? 2 : 1);
    }
}

function noteSabotage(galaxy: Galaxy, work: GreatWorkRecord, by: Empire, caught: boolean): void {
    gwState(galaxy).stats.sabotaged++;
    logGw(galaxy, galaxyStarDate(galaxy), `work ${work.id} sabotaged by ${by.name}${caught ? ' (caught)' : ''}`);
    if (!caught) return;
    addAnger(work, by, 15);
    compactRegard(galaxy, by, -3, 'giantworks.sabotage');
    const rep = gwParam(galaxy, 'giantworksSabotageCaughtRep');
    for (const e of ordinaryEmpires(galaxy)) {
        if (e === by) continue;
        applyReputation(galaxy, e, by, -rep, { cause: 'giantworks.saboteur', labelKey: 'Reputation Cause giantworks.saboteur', source: 'giantworks', decayPerYear: 1 });
    }
    scenarioNews(galaxy, null, scenarioText(`${TAG} Sabotage Caught News`, by.name, work.system.systemStar.name), () => true, work.base ?? work.system.systemStar);
}

// ---------------------------------------------------------------------------------------------------------------
// Ownership: seizing the finished wonder
// ---------------------------------------------------------------------------------------------------------------

function onOwnerChanged(galaxy: Galaxy, bo: BuiltObject, to: Empire | null): void {
    const r = workOfObject(galaxy, bo);
    if (r === null || r.role !== 'base' || r.work.phase !== 'complete') return;
    const w = r.work;
    const compact = compactFaction(galaxy);
    if (to === null || to === compact) {
        w.holder = null;
        return;
    }
    if (w.holder === to) return;
    w.holder = to;
    logGw(galaxy, galaxyStarDate(galaxy), `work ${w.id} seized by ${to.name}`);
    if (isActor(galaxy, to) && !w.hostile && !demolitionAuthorised(galaxy)) {
        addAnger(w, to, gwParam(galaxy, 'giantworksAngerDestroy') / 2);
        if (scenarioFlag(galaxy, WAR_CRIMES_FLAG)) recordWarCrime(galaxy, to, 'greatWork', null, `seize${w.id}`, 3600, 0.5);
    }
    scenarioNews(galaxy, null, scenarioText(`${TAG} Seized News`, to.name, kindName(w.wonder)), () => true, bo);
}

// ---------------------------------------------------------------------------------------------------------------
// The scaffold or wonder is lost
// ---------------------------------------------------------------------------------------------------------------

function territoryOwnerOf(galaxy: Galaxy, work: GreatWorkRecord): Empire | null {
    const id = galaxy.checkEmpireTerritoryIdAtLocation(work.system.systemStar.xpos, work.system.systemStar.ypos);
    if (id < 0) return null;
    return galaxy.empires.find((e) => e !== null && e.empireId === id) ?? null;
}

/**
 * The scaffold / wonder is gone. Sabotage (an espionage mission) is no crime; open destruction is a war crime unless the
 * Diet authorised demolition or the finished wonder is hostile. The Compact's anger rises with the act.
 */
function resolveDestroyed(galaxy: Galaxy, work: GreatWorkRecord, by: Empire | null, viaSabotage: boolean): void {
    const wasComplete = work.phase === 'complete';
    const actor = isActor(galaxy, by) ? by : null;
    destroyWork(galaxy, work, by);
    if (actor !== null) {
        addAnger(work, actor, gwParam(galaxy, 'giantworksAngerDestroy'));
        compactRegard(galaxy, actor, -10, 'giantworks.destroy');
        const exempt = viaSabotage || (wasComplete && work.hostile) || demolitionAuthorised(galaxy);
        if (!exempt && scenarioFlag(galaxy, WAR_CRIMES_FLAG)) recordWarCrime(galaxy, actor, 'greatWork', null, `work${work.id}`, 3600);
    }
    const where = work.system.systemStar.name;
    const who = actor?.name ?? by?.name ?? '';
    scenarioNews(galaxy, null, by === null ? scenarioText(`${TAG} Destroyed News Unknown`, where) : scenarioText(`${TAG} Destroyed News`, where, who), () => true, work.system.systemStar);
    // The wreckage tells the destroyer and the territory's owner what it was.
    const learners: Empire[] = [];
    if (actor !== null) learners.push(actor);
    const owner = territoryOwnerOf(galaxy, work);
    if (owner !== null && !learners.includes(owner) && isActor(galaxy, owner)) learners.push(owner);
    for (const e of learners) {
        if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${TAG} Wreckage Title`), scenarioText(`${TAG} Wreckage`, where, kindName(work.wonder)), { type: EmpireMessageType.GeneralNeutralEvent, subject: work.system.systemStar, popup: false });
    }
}

/** A section of the scaffold was destroyed by sabotage: progress falls back, the section is rebuilt at once. */
function rebuildAfterSabotage(galaxy: Galaxy, work: GreatWorkRecord): void {
    const s = work.sabotage!;
    work.sabotage = null;
    const faction = compactFaction(galaxy);
    work.base = null;
    if (faction !== null) placeScaffold(galaxy, work, faction);
    addProgress(galaxy, work, -gwParam(galaxy, 'giantworksSabotageSetbackPct') / 100);
    noteSabotage(galaxy, work, s.by, s.caught);
}

/** Periodic, before the work's step: finds out what happened to a lost scaffold / wonder base and acts on it. True if the work changed. */
export function resolveBaseLoss(galaxy: Galaxy, work: GreatWorkRecord): boolean {
    if (work.phase !== 'building' && work.phase !== 'complete') return false;
    const base = work.base;
    if (base === null) return false;
    const compact = compactFaction(galaxy);
    const captured = work.phase === 'building' && !base.hasBeenDestroyed && compact !== null && base.actualEmpire !== compact;
    if (!base.hasBeenDestroyed && !captured) return false;
    const now = galaxyStarDate(galaxy);
    const s = work.sabotage;
    const fresh = s !== null && now - s.date < 30 * GAME_DAY_LENGTH;
    if (work.phase === 'building' && fresh && s.kill && !captured) {
        rebuildAfterSabotage(galaxy, work);
        return true;
    }
    const a = work.attackedBy;
    const by: Empire | null = a !== null && now - a.date < 2 * YEAR_LENGTH ? a.empire : fresh ? s.by : captured ? base.actualEmpire : null;
    resolveDestroyed(galaxy, work, by, fresh);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Protecting
// ---------------------------------------------------------------------------------------------------------------

/** Ships whose position lies within `range` of (x, y) (the galaxy's ship index, a square of cells around it). Pure. */
export function shipsWithin(galaxy: Galaxy, x: number, y: number, range: number): BuiltObject[] {
    const out: BuiltObject[] = [];
    const lo = galaxy.resolveIndex(x - range, y - range);
    const hi = galaxy.resolveIndex(x + range, y + range);
    const r2 = range * range;
    for (let cx = lo.x; cx <= hi.x; cx++) {
        for (let cy = lo.y; cy <= hi.y; cy++) {
            for (const b of galaxy.builtObjectIndexGrid[cx][cy]) if (b !== null && !b.hasBeenDestroyed && galaxy.calculateDistanceSquared(x, y, b.xpos, b.ypos) <= r2) out.push(b);
        }
    }
    return out;
}

/** The empires with warships on station at the site right now (galaxy.empires order). Pure. */
export function stationedEmpires(galaxy: Galaxy, work: GreatWorkRecord): Empire[] {
    const base = work.base;
    if (base === null || base.hasBeenDestroyed) return [];
    const range = Math.max(0.2, gwParam(galaxy, 'giantworksProtectRangeSectors')) * galaxy.sectorSize;
    const present = new Set<Empire>();
    for (const b of shipsWithin(galaxy, base.xpos, base.ypos, range)) {
        const e = b.actualEmpire;
        if (b.role === BuiltObjectRole.Military && b.topSpeed > 0 && isActor(galaxy, e)) present.add(e);
    }
    return galaxy.empires.filter((e): e is Empire => e !== null && present.has(e));
}

/** At most this many days of protection credit per step (a gap longer than ~1.5 long blocks is not presence). */
const PROTECT_MAX_STEP_DAYS = 60;

/** Warships on station earn protect days; enough of them and the Compact remembers. */
export function protectStep(galaxy: Galaxy, work: GreatWorkRecord): void {
    if (work.phase !== 'building') return;
    const need = gwParam(galaxy, 'giantworksProtectDays');
    // The time since the last step (the framework periodic runs once per long block, ~36 days, not every PERIOD_DAYS),
    // capped so a long gap is not credited as presence; the first step counts one period.
    const now = galaxyStarDate(galaxy);
    const credit = work.protectAt === undefined ? PERIOD_DAYS : Math.min(PROTECT_MAX_STEP_DAYS, Math.max(0, (now - work.protectAt) / GAME_DAY_LENGTH));
    work.protectAt = now;
    for (const e of stationedEmpires(galaxy, work)) {
        if (angerOf(work, e) >= 5 || work.protectors.includes(e.empireId)) continue;
        const days = (work.protectDays[e.empireId] ?? 0) + credit;
        work.protectDays[e.empireId] = days;
        if (days < need) continue;
        work.protectors.push(e.empireId);
        compactRegard(galaxy, e, gwParam(galaxy, 'giantworksProtectRep'), 'giantworks.protect');
        if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${TAG} Protected Title`), scenarioText(`${TAG} Protected`, work.system.systemStar.name), { type: EmpireMessageType.GeneralGoodEvent, subject: work.base, popup: false });
        logGw(galaxy, galaxyStarDate(galaxy), `work ${work.id} protected by ${e.name}`);
    }
}

/** Empires that protected a Great Work (for a hostile wonder's crisis: they helped it). Pure. */
export function greatWorkProtectors(galaxy: Galaxy): Empire[] {
    const ids = new Set<number>();
    for (const w of greatWorks(galaxy)) for (const id of w.protectors) ids.add(id);
    return galaxy.empires.filter((e): e is Empire => e !== null && e.active && ids.has(e.empireId));
}

// ---------------------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------------------

export function registerActionEvents(): void {
    registerScenarioEvent({ id: 'giantworks.attacked', flag: GW_FLAG, event: 'builtObjectAttacked', run: (g, e) => onAttacked(g, e.builtObject, e.attackingEmpire) });
    registerScenarioEvent({ id: 'giantworks.killed', flag: GW_FLAG, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, e.builtObject, e.destroyer) });
    registerScenarioEvent({ id: 'giantworks.owner', flag: GW_FLAG, event: 'builtObjectOwnerChanged', run: (g, e) => onOwnerChanged(g, e.builtObject, e.to) });
    registerScenarioEvent({ id: 'giantworks.exposed', flag: GW_FLAG, event: 'intelMissionExposed', run: (g, e) => onIntelExposed(g, e.empire, e.target) });
    registerScenarioEvent({ id: 'giantworks.intel', flag: GW_FLAG, event: 'intelMissionCompleted', run: (g, e) => onIntelCompleted(g, e.empire, e.mission as IntelligenceMission) });
}

void IntelligenceMissionOutcome;
void YEAR_LENGTH;
