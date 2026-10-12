// The Voidbloom War — the crackdown (docs/VOIDBLOOM_WAR.md, user decisions 2, 3, 7, 9, 11, 12): the commissioner and
// the open letter, customs inspections with seizures and public burnings, neutral ships hit, the crackdown crisis
// (back down / pay / tolerate / war), the police action (blockade, raids that destroy the stock, burned fields,
// occupation, freed convoy workers, hunted freighters, agents against the governor), and the war's bookkeeping.
// Not a port: the stock pieces are the governor spawn (governors.ts), AssignMission Blockade / Move / Attack,
// DeclareWar, TakeOwnershipOfColony, Character.Kill and the reputation channel.
//
// Rnd: galaxy.rnd only in the gated periodic handlers (the sweep's inspection rolls, the agents' roll), in fixed
// orders (empire id, built-object list order; crackdowns in list order). The queries never draw.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { Population } from '../../population';
import { recalculateEmpirePopulation } from '../../taxes';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { leaveShipGroup } from '../../fleets/shipGroup';
import { takeOwnershipOfColonyFull } from '../../combat/ownership';
import { DiplomaticRelationType } from '../../diplomacy';
import { aggressionLevel, cautionLevel, declareWar, friendlinessLevel, militaryPotency } from '../../diplomacyTick';
import { CharacterDeathType, characterSendDeathMessage } from '../../characterRuntime';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../decisions';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { applyReputation } from '../reputation/ledger';
import { colonyGovernor, spawnGovernorFor } from '../governors';
import { concordHooks, rimParam, rimTraderEmpire } from '../rimTrade/common';
import { grantCasusBelli } from '../lively/warGoals';
import {
    VOIDBLOOM_FLAG,
    addHistory,
    bloomWorldOf,
    concord,
    concordAddiction,
    crackdownOn,
    empireById,
    fmt,
    isHuman,
    isNormal,
    isPirate,
    normalEmpires,
    peekVbState,
    policyOf,
    removeVoidbloom,
    vbEmpire,
    vbOn,
    vbParam,
    vbState,
    vbWarOf,
    voidbloomId,
    voidbloomStock,
    type Crackdown,
    type VbWar,
} from './common';
import { garrisonOf } from './supply';

export const CRISIS_DECISION = 'voidbloom.crisis';
/** Re-asks a tolerated crackdown's target every this many years (the AI may escalate as the Concord weakens). */
const REASK_YEARS = 3;
/** Years a backed-down target keeps its word. */
const BACKDOWN_YEARS = 6;

// ---------------------------------------------------------------------------------------------------------------
// The commissioner and the start of the crackdown
// ---------------------------------------------------------------------------------------------------------------

/** The Concord colony with the highest addiction (ties by habitat index), its capital as a fallback. Pure. */
function worstColony(galaxy: Galaxy, r: Empire): Habitat | null {
    const st = vbState(galaxy);
    let best: Habitat | null = null;
    let bv = -1;
    for (const h of r.colonies) {
        if (h.hasBeenDestroyed) continue;
        const a = st.colonies[h.habitatIndex]?.a ?? 0;
        if (a > bv || (a === bv && best !== null && h.habitatIndex < best.habitatIndex)) {
            bv = a;
            best = h;
        }
    }
    return best ?? r.capital;
}

/** The empires smuggling Voidbloom into the Concord: sold into it and still growing it with a smuggling policy. Pure. */
export function smugglersIntoConcord(galaxy: Galaxy): Empire[] {
    const st = vbState(galaxy);
    const r = rimTraderEmpire(galaxy);
    const out: Empire[] = [];
    for (const e of normalEmpires(galaxy)) {
        if (e === r) continue;
        const rec = st.empires[e.empireId];
        if (rec === undefined || rec.soldConcord <= 0 || policyOf(galaxy, e) !== 'smuggle') continue;
        if (!st.worlds.some((w) => w.habitat.empire === e)) continue;
        out.push(e);
    }
    return out;
}

/** The crackdown starts while the Concord is still strong: at a low addiction index or a modest smuggled value. Pure. */
export function crackdownDue(galaxy: Galaxy): boolean {
    const st = vbState(galaxy);
    if (st.crackdownStarted >= 0 || concord(galaxy) === null) return false;
    if (concordAddiction(galaxy) >= vbParam(galaxy, 'voidbloomCrackdownAddiction')) return true;
    return st.stats.stateDrain + st.stats.privateDrain >= vbParam(galaxy, 'voidbloomCrackdownValue');
}

export function startCrackdown(galaxy: Galaxy): void {
    const r = concord(galaxy);
    if (r === null) return;
    const st = vbState(galaxy);
    st.crackdownStarted = galaxyStarDate(galaxy);
    const where = worstColony(galaxy, r);
    if (where !== null) {
        const c = spawnGovernorFor(galaxy, r, where);
        c.name = scenarioText('Voidbloom Commissioner Name', c.name);
        st.commissioner = c;
        st.commissionerColony = where;
    }
    const name = st.commissioner?.name ?? r.name;
    // The commissioner's open letter (galactic news, a popup for every human).
    scenarioNews(galaxy, r, scenarioText('Voidbloom Letter News', name, r.name, where?.name ?? ''), () => true, where);
    addHistory(galaxy, scenarioText('Voidbloom History Letter', name, gameYear(galaxyStarDate(galaxy))));
}

// ---------------------------------------------------------------------------------------------------------------
// The crisis
// ---------------------------------------------------------------------------------------------------------------

/** Firepower of the Concord's warships kept home (its home guard: every warship not on a task force or strike). Pure. */
function homeGuard(galaxy: Galaxy, r: Empire): number {
    return Math.max(1, militaryPotency(r) * (rimParam(galaxy, 'rimTraderHomeGuardPct') / 100 + 0.25));
}

function raiseCrisis(galaxy: Galaxy, e: Empire, existing: Crackdown | null): void {
    const r = concord(galaxy);
    if (r === null) return;
    const st = vbState(galaxy);
    const now = galaxyStarDate(galaxy);
    const cd: Crackdown = existing ?? {
        targetId: e.empireId, since: now, status: 'crisis', until: -1, taskForce: [], site: null, siteSince: -1, lastAction: -1,
        raids: 0, burns: 0, occupations: 0, freed: 0, hunted: 0, agentKills: 0, answer: '', by: '',
    };
    cd.status = 'crisis';
    cd.answer = '';
    if (existing === null) st.crackdowns.push(cd);
    st.stats.crises++;
    grantCasusBelli(galaxy, e, r);
    const price = Math.round(vbParam(galaxy, 'voidbloomPayIndemnity'));
    raiseScenarioDecision(galaxy, e, {
        kind: CRISIS_DECISION,
        title: scenarioText('Voidbloom Crisis Title'),
        text: scenarioText('Voidbloom Crisis Text', r.name, st.commissioner?.name ?? r.name, fmt(price), Math.round(vbParam(galaxy, 'voidbloomPayYears'))),
        options: [
            { id: 'backDown', label: scenarioText('Voidbloom Crisis BackDown') },
            { id: 'pay', label: scenarioText('Voidbloom Crisis Pay', fmt(price)) },
            { id: 'tolerate', label: scenarioText('Voidbloom Crisis Tolerate') },
            { id: 'war', label: scenarioText('Voidbloom Crisis War') },
        ],
        defaultOption: 'tolerate',
        expiresDays: 90,
        context: { targetId: e.empireId },
    });
}

/** The AI's answer: by strength against the Concord's home guard, the profit at stake and its personality. Pure. */
export function aiCrisisChoice(galaxy: Galaxy, e: Empire): string {
    const r = concord(galaxy);
    if (r === null) return 'tolerate';
    const rec = vbEmpire(galaxy, e);
    const ratio = militaryPotency(e) / homeGuard(galaxy, r);
    const aggr = (aggressionLevel(e) - 100) / 50;
    const caution = (cautionLevel(e) - 100) / 50;
    const friendly = (friendlinessLevel(e) - 100) / 50;
    const st = vbState(galaxy);
    const years = Math.max(1, (galaxyStarDate(galaxy) - Math.max(0, st.arcStarted)) / YEAR_LENGTH);
    const profit = rec.soldConcord / years;
    const price = vbParam(galaxy, 'voidbloomPayIndemnity');
    const decline = concordDecline(galaxy);
    // The Concord is strong at first: war pays only once it has declined and the police action has started to bite.
    const cd = crackdownOn(galaxy, e);
    const bite = cd === null ? 0 : 0.25 * (cd.raids + cd.burns) + 0.8 * cd.occupations;
    const share = Math.min(1, profit / Math.max(1, price));
    const war = 3 * (ratio - 0.8) + aggr - 0.5 * caution + 3 * decline - 1.5;
    const tolerate = 1.2 + 1.5 * share - bite;
    const pay = e.stateMoney > 3 * price ? 0.6 + 0.3 * caution : -9;
    const back = 0.1 + 0.4 * friendly + 0.4 * caution - share - 0.3 * ratio;
    const opts: [string, number][] = [['war', war], ['tolerate', tolerate], ['pay', pay], ['backDown', back]];
    let best = opts[0];
    for (const o of opts) if (o[1] > best[1]) best = o;
    return best[0];
}

function resolveCrisis(galaxy: Galaxy, d: ScenarioDecision, option: string): void {
    const e = empireById(galaxy, Number(d.context.targetId));
    const r = concord(galaxy);
    if (e === null || r === null || !e.active) return;
    const cd = crackdownOn(galaxy, e);
    if (cd === null) return;
    const st = vbState(galaxy);
    const now = galaxyStarDate(galaxy);
    cd.answer = option;
    cd.by = d.answeredBy ?? '';
    const rec = vbEmpire(galaxy, e);
    switch (option) {
        case 'backDown':
            cd.status = 'backedDown';
            cd.until = now + BACKDOWN_YEARS * YEAR_LENGTH;
            rec.policy = 'legal';
            st.stats.backedDown++;
            releaseTaskForce(galaxy, cd);
            scenarioNews(galaxy, r, scenarioText('Voidbloom BackDown News', e.name, r.name), () => true, null);
            break;
        case 'pay': {
            const price = Math.round(vbParam(galaxy, 'voidbloomPayIndemnity'));
            if (e.stateMoney >= price) {
                e.stateMoney -= price;
                r.stateMoney += price;
                cd.status = 'paid';
                cd.until = now + vbParam(galaxy, 'voidbloomPayYears') * YEAR_LENGTH;
                st.stats.paid++;
                releaseTaskForce(galaxy, cd);
                scenarioNews(galaxy, r, scenarioText('Voidbloom Paid News', e.name, r.name, fmt(price)), () => true, null);
                break;
            }
            cd.status = 'tolerated';
            st.stats.tolerated++;
            break;
        }
        case 'war':
            cd.status = 'war';
            st.stats.wars++;
            declareWar(galaxy, e, r);
            if (!atWarWith(e, r)) cd.status = 'tolerated';
            break;
        default:
            cd.status = 'tolerated';
            st.stats.tolerated++;
            scenarioNews(galaxy, r, scenarioText('Voidbloom Police News', r.name, e.name), () => true, null);
            break;
    }
    cd.lastAction = now;
    addHistory(galaxy, scenarioText('Voidbloom History Crisis', e.name, scenarioText(`Voidbloom Answer ${option}`), gameYear(now)));
}

function atWarWith(a: Empire, b: Empire): boolean {
    return a.diplomaticRelations.byEmpire(b)?.type === DiplomaticRelationType.War;
}

/** Yearly: the crackdown starts; every smuggler without a live crackdown gets its crisis; expired payments end. */
export function crackdownYear(galaxy: Galaxy): void {
    const st = vbState(galaxy);
    const r = concord(galaxy);
    if (r === null) return;
    if (crackdownDue(galaxy)) startCrackdown(galaxy);
    if (st.crackdownStarted < 0) return;
    const now = galaxyStarDate(galaxy);
    for (const cd of st.crackdowns) {
        if ((cd.status === 'paid' || cd.status === 'backedDown') && now >= cd.until) cd.status = 'ended';
        // A tolerated police action: the target reconsiders every few years (escalation as the Concord weakens).
        const e = empireById(galaxy, cd.targetId);
        if (cd.status === 'tolerated' && e !== null && e.active && isNormal(galaxy, e) && now - cd.lastAction >= REASK_YEARS * YEAR_LENGTH && !isHuman(galaxy, e)) raiseCrisis(galaxy, e, cd);
    }
    // Independent growers (the rim cartel, workers who rose) face the police action without a crisis.
    const ind = galaxy.independentEmpire;
    if (ind !== null && crackdownOn(galaxy, ind) === null && st.worlds.some((w) => w.habitat.empire === ind && !w.habitat.hasBeenDestroyed)) {
        const old = st.crackdowns.find((c) => c.targetId === ind.empireId) ?? null;
        const cd: Crackdown = old ?? { targetId: ind.empireId, since: now, status: 'tolerated', until: -1, taskForce: [], site: null, siteSince: -1, lastAction: now, raids: 0, burns: 0, occupations: 0, freed: 0, hunted: 0, agentKills: 0, answer: 'independent', by: '' };
        cd.status = 'tolerated';
        if (old === null) st.crackdowns.push(cd);
    }
    for (const e of smugglersIntoConcord(galaxy)) {
        // A rich AI smuggler under a police action bribes the Concord's officials to look away.
        const live = crackdownOn(galaxy, e);
        if (live !== null && live.status === 'tolerated' && !isHuman(galaxy, e) && e.stateMoney > 6 * bribeCost(galaxy)) bribeOfficials(galaxy, e);
        if (live !== null) continue;
        const back = st.crackdowns.find((c) => c.targetId === e.empireId && c.status === 'backedDown' && now < c.until);
        if (back !== undefined) continue;
        const old = st.crackdowns.find((c) => c.targetId === e.empireId && c.status === 'ended') ?? null;
        raiseCrisis(galaxy, e, old);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Inspections (every 10 days): seizures, public burnings, neutral ships
// ---------------------------------------------------------------------------------------------------------------

/** An empire's state ships and private freighters (the freighters carry the cargo), fixed order. */
function shipsOf(e: Empire): BuiltObject[] {
    return e.privateBuiltObjects.length === 0 ? e.builtObjects : [...e.builtObjects, ...e.privateBuiltObjects];
}

function inspectionExempt(galaxy: Galaxy, e: Empire | null): boolean {
    if (e === null) return false;
    const rec = peekVbState(galaxy)?.empires[e.empireId];
    if (rec === undefined) return false;
    return rec.inspectExempt || rec.legalConcord || rec.bribedUntil > galaxyStarDate(galaxy);
}

/** The cargo's owner when it is seized: the ship's actual empire. */
function seize(galaxy: Galaxy, bo: BuiltObject, near: Habitat): number {
    const r = rimTraderEmpire(galaxy);
    const owner = bo.actualEmpire;
    const n = removeVoidbloom(galaxy, bo);
    if (n <= 0 || r === null) return 0;
    const st = vbState(galaxy);
    st.stats.seizures++;
    st.stats.seizedUnits += n;
    const value = n * 120;
    if (owner !== null && isNormal(galaxy, owner)) {
        const rec = vbEmpire(galaxy, owner);
        rec.seizedUnits += n;
        rec.seizedValue += value;
        const smuggling = policyOf(galaxy, owner) === 'smuggle';
        // The incident: the owner resents it (a casus belli for a smuggler's war); a neutral's ships hit cost the Concord more.
        applyReputation(galaxy, owner, r, smuggling ? -Math.min(20, 3 + n / 100) : -8, { cause: smuggling ? 'voidbloom.seizure' : 'voidbloom.neutral', labelKey: smuggling ? 'Voidbloom Reputation Seizure' : 'Voidbloom Reputation Neutral', source: 'voidbloom' });
        if (!smuggling && crackdownOn(galaxy, owner) === null) st.stats.neutralHits++;
        if (isHuman(galaxy, owner)) scenarioMessage(galaxy, owner, scenarioText('Voidbloom Seizure Title'), scenarioText('Voidbloom Seizure', bo.name, fmt(n), near.name), { type: EmpireMessageType.GeneralBadEvent, subject: near, popup: false });
    }
    // The public burning: a big haul is burned in public (galactic news).
    const now = galaxyStarDate(galaxy);
    if (st.stats.burnings === 0 || (n >= 300 && now - (st.lastBurning ?? -Infinity) >= YEAR_LENGTH)) {
        st.stats.burnings++;
        st.lastBurning = now;
        scenarioNews(galaxy, r, scenarioText('Voidbloom Burning News', fmt(n), near.name, st.commissioner?.name ?? r.name), () => true, near);
    }
    return n;
}

/** The sweep: ships carrying Voidbloom near a Concord colony are searched (the commissioner's colony at full chance). */
export function inspectionSweep(galaxy: Galaxy): void {
    const r = concord(galaxy);
    const st = vbState(galaxy);
    if (r === null || st.crackdownStarted < 0) return;
    const range = galaxy.maxSolarSystemSize;
    const chief = st.commissioner !== null && st.commissioner.active ? st.commissionerColony : null;
    const ports = r.colonies.filter((h) => !h.hasBeenDestroyed);
    if (ports.length === 0) return;
    const full = vbParam(galaxy, 'voidbloomInspectPct') / 100;
    const carriers = [...galaxy.empires, ...galaxy.pirateEmpires];
    if (galaxy.independentEmpire !== null && !carriers.includes(galaxy.independentEmpire)) carriers.push(galaxy.independentEmpire);
    for (const e of carriers) {
        if (e === null || !e.active || e === r) continue;
        for (const b of shipsOf(e)) {
            if (b === null || b.hasBeenDestroyed || b.cargo === null || b.cargo.items.length === 0) continue;
            if (voidbloomStock(galaxy, b) <= 0 || inspectionExempt(galaxy, b.actualEmpire)) continue;
            let near: Habitat | null = null;
            for (const h of ports) {
                if (galaxy.calculateDistance(b.xpos, b.ypos, h.xpos, h.ypos) <= range) {
                    near = h;
                    break;
                }
            }
            if (near === null) continue;
            st.stats.inspections++;
            const chance = near === chief ? full : full / 2;
            if (galaxy.rnd.nextDouble() < chance) seize(galaxy, b, near);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The police action (every 30 days)
// ---------------------------------------------------------------------------------------------------------------

function isTaskForceShip(galaxy: Galaxy, bo: BuiltObject): boolean {
    const st = peekVbState(galaxy);
    if (st === null) return false;
    for (const cd of st.crackdowns) if (cd.taskForce.includes(bo)) return true;
    return false;
}

function releaseTaskForce(galaxy: Galaxy, cd: Crackdown): void {
    const r = rimTraderEmpire(galaxy);
    for (const b of cd.taskForce) {
        if (b.hasBeenDestroyed) continue;
        b.isAutoControlled = true;
        if (r !== null && r.capital !== null) assignMission(galaxy, b, BuiltObjectMissionType.Move, r.capital, null, BuiltObjectMissionPriority.Normal);
    }
    cd.taskForce = [];
    cd.site = null;
}

function taskForceCandidates(galaxy: Galaxy, r: Empire): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const b of r.builtObjects) {
        if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || !b.isAutoControlled || !(b.firepowerRaw > 0)) continue;
        if (b.subRole === BuiltObjectSubRole.TroopTransport || b.subRole === BuiltObjectSubRole.ResupplyShip || !(b.warpSpeed > 0)) continue;
        if (isTaskForceShip(galaxy, b)) continue;
        out.push(b);
    }
    const home = r.capital;
    if (home !== null) out.sort((a, b) => galaxy.calculateDistance(a.xpos, a.ypos, home.xpos, home.ypos) - galaxy.calculateDistance(b.xpos, b.ypos, home.xpos, home.ypos) || a.builtObjectID - b.builtObjectID);
    return out;
}

/** The target's Voidbloom worlds, nearest the Concord's capital first. Pure. */
function targetWorlds(galaxy: Galaxy, r: Empire, e: Empire): Habitat[] {
    const list = vbState(galaxy).worlds.map((w) => w.habitat).filter((h) => !h.hasBeenDestroyed && h.empire === e);
    const home = r.capital;
    if (home !== null) list.sort((a, b) => galaxy.calculateDistance(a.xpos, a.ypos, home.xpos, home.ypos) - galaxy.calculateDistance(b.xpos, b.ypos, home.xpos, home.ypos) || a.habitatIndex - b.habitatIndex);
    return list;
}

function nearestConcordColony(galaxy: Galaxy, r: Empire, x: number, y: number): Habitat | null {
    let best: Habitat | null = null;
    let bd = Infinity;
    for (const h of r.colonies) {
        if (h.hasBeenDestroyed || bloomWorldOf(galaxy, h) !== null) continue;
        const d = galaxy.calculateDistance(x, y, h.xpos, h.ypos);
        if (d < bd) {
            bd = d;
            best = h;
        }
    }
    return best;
}

/** Labour convoys heading for the target's worlds within reach of the task force: the workers are freed. */
function interceptConvoys(galaxy: Galaxy, r: Empire, cd: Crackdown): void {
    const st = vbState(galaxy);
    const reach = galaxy.maxSolarSystemSize * 2;
    for (const c of st.convoys) {
        if (c.stage !== 'sea' || c.empireId !== cd.targetId || c.ship.hasBeenDestroyed) continue;
        const hit = cd.taskForce.some((b) => !b.hasBeenDestroyed && galaxy.calculateDistance(b.xpos, b.ypos, c.ship.xpos, c.ship.ypos) <= reach);
        if (!hit) continue;
        c.stage = 'freed';
        cd.freed += c.amount;
        st.stats.freed += c.amount;
        // The freed workers join the Concord (its nearest colony).
        const home = nearestConcordColony(galaxy, r, c.ship.xpos, c.ship.ypos);
        const race = galaxy.races.find((x) => x.name === c.raceName) ?? null;
        if (home !== null && race !== null && home.population !== null) {
            home.population.add(new Population(race, c.amount, galaxy));
            home.population.recalculateTotalAmount();
            recalculateEmpirePopulation(r);
        }
        const e = empireById(galaxy, cd.targetId);
        if (e !== null) scenarioMessage(galaxy, e, scenarioText('Voidbloom Convoy Title'), scenarioText('Voidbloom Convoy Freed', fmt(c.amount), r.name), { type: EmpireMessageType.GeneralBadEvent, subject: c.ship, popup: false });
    }
}

/** The target's freighters with Voidbloom within a sector of the task force are stopped and searched (and attacked in war). */
function huntFreighters(galaxy: Galaxy, r: Empire, cd: Crackdown, e: Empire): void {
    const reach = galaxy.sectorSize;
    const st = vbState(galaxy);
    for (const b of shipsOf(e)) {
        if (b === null || b.hasBeenDestroyed || b.cargo === null || voidbloomStock(galaxy, b) <= 0) continue;
        let hunter: BuiltObject | null = null;
        for (const t of cd.taskForce) if (!t.hasBeenDestroyed && galaxy.calculateDistance(t.xpos, t.ypos, b.xpos, b.ypos) <= reach) hunter = hunter ?? t;
        // Not every freighter is caught (35 % a month within a sector of the task force).
        if (hunter === null || !(galaxy.rnd.nextDouble() < 0.35)) continue;
        const near = cd.site ?? nearestConcordColony(galaxy, r, b.xpos, b.ypos);
        if (near !== null) seize(galaxy, b, near);
        cd.hunted++;
        st.stats.hunted++;
        if (cd.status === 'war' && b.role === BuiltObjectRole.Freight) assignMission(galaxy, hunter, BuiltObjectMissionType.Attack, b, null, BuiltObjectMissionPriority.High);
    }
}

/** Destroys `share` of every Voidbloom item at a holder (unreserved amounts). Returns units destroyed. */
function destroyShare(galaxy: Galaxy, holder: Habitat, share: number): number {
    const id = voidbloomId(galaxy);
    let n = 0;
    for (const c of holder.cargo?.items ?? []) {
        if (c.commodity.resourceId !== id) continue;
        const cut = Math.floor(Math.max(0, c.amount - c.reserved) * share);
        c.amount -= cut;
        n += cut;
    }
    return n;
}

function policeAction(galaxy: Galaxy, r: Empire, cd: Crackdown): void {
    const e = empireById(galaxy, cd.targetId);
    if (e === null || !e.active) {
        cd.status = 'ended';
        releaseTaskForce(galaxy, cd);
        return;
    }
    const st = vbState(galaxy);
    const now = galaxyStarDate(galaxy);
    cd.taskForce = cd.taskForce.filter((b) => !b.hasBeenDestroyed && b.actualEmpire === r);
    const worlds = targetWorlds(galaxy, r, e);
    if (worlds.length === 0) {
        // Nothing left to police: the crackdown ends (a war goes on through the stock war).
        if (cd.status !== 'war') {
            cd.status = 'ended';
            releaseTaskForce(galaxy, cd);
        }
        return;
    }
    // Muster the task force from warships the home guard can spare.
    const want = Math.trunc(vbParam(galaxy, 'voidbloomTaskForceShips'));
    if (cd.taskForce.length < want) {
        const pool = taskForceCandidates(galaxy, r);
        const guard = Math.ceil((pool.length * rimParam(galaxy, 'rimTraderHomeGuardPct')) / 100);
        const spare = Math.max(0, pool.length - guard);
        for (const b of pool.slice(0, Math.min(spare, want - cd.taskForce.length))) {
            if (b.shipGroup !== null) leaveShipGroup(galaxy, b);
            b.isAutoControlled = false;
            cd.taskForce.push(b);
        }
    }
    if (cd.taskForce.length === 0) return;
    if (cd.site === null || cd.site.empire !== e || cd.site.hasBeenDestroyed) {
        cd.site = worlds[0];
        cd.siteSince = -1;
    }
    const site = cd.site;
    // Sail and blockade.
    let present = 0;
    for (const b of cd.taskForce) {
        const at = galaxy.calculateDistance(b.xpos, b.ypos, site.xpos, site.ypos) <= galaxy.maxSolarSystemSize;
        if (at) present++;
        const m = builtObjectMission(b.mission);
        if (m !== null && (m.type === BuiltObjectMissionType.Refuel || m.type === BuiltObjectMissionType.Repair)) continue;
        if (m !== null && (m.type === BuiltObjectMissionType.Blockade || m.type === BuiltObjectMissionType.Attack) && (m.targetHabitat === site || m.targetBuiltObject !== null)) continue;
        assignMission(galaxy, b, BuiltObjectMissionType.Blockade, site, null, BuiltObjectMissionPriority.High);
    }
    interceptConvoys(galaxy, r, cd);
    huntFreighters(galaxy, r, cd, e);
    if (present === 0) return;
    if (cd.siteSince < 0) cd.siteSince = now;
    const w = bloomWorldOf(galaxy, site);
    const daysThere = (now - cd.siteSince) / GAME_DAY_LENGTH;
    // The raid (every 60 days on station): most of the stockpile on the planet is seized and destroyed (the
    // "merchants' detention"); the growers hide the rest.
    const raidDue = cd.lastRaid === undefined || now - cd.lastRaid >= 60 * GAME_DAY_LENGTH;
    const stock = raidDue ? destroyShare(galaxy, site, 0.7) : 0;
    if (raidDue) cd.lastRaid = now;
    if (stock > 0) {
        cd.raids++;
        st.stats.raids++;
        if (cd.raids === 1) scenarioNews(galaxy, r, scenarioText('Voidbloom Raid News', r.name, site.name, fmt(stock)), () => true, site);
        if (isHuman(galaxy, e)) scenarioMessage(galaxy, e, scenarioText('Voidbloom Police Title'), scenarioText('Voidbloom Raid', r.name, site.name, fmt(stock)), { type: EmpireMessageType.GeneralBadEvent, subject: site, popup: false });
    }
    // Burned fields after 30 days on station.
    if (w !== null && daysThere >= 30 && now >= w.burnedUntil) {
        w.burnedUntil = now + vbParam(galaxy, 'voidbloomBurnDays') * GAME_DAY_LENGTH;
        cd.burns++;
        st.stats.burns++;
        if (cd.burns === 1) scenarioNews(galaxy, r, scenarioText('Voidbloom Burn News', r.name, site.name), () => true, site);
        else if (isHuman(galaxy, e)) scenarioMessage(galaxy, e, scenarioText('Voidbloom Police Title'), scenarioText('Voidbloom Burn News', r.name, site.name), { type: EmpireMessageType.GeneralBadEvent, subject: site, popup: false });
    }
    // Agents against the governor (Characters & Victory's governors).
    const gov = colonyGovernor(site);
    if (gov !== null && gov.active && galaxy.rnd.nextDouble() < 0.25) {
        characterSendDeathMessage(galaxy, gov, CharacterDeathType.Assassination);
        gov.kill(galaxy);
        cd.agentKills++;
        st.stats.agentKills++;
        scenarioNews(galaxy, r, scenarioText('Voidbloom Agents News', site.name, r.name), () => true, site);
    }
    // Occupation after 90 days on station when the garrison is thinner than the task force's marines.
    if (daysThere >= 180 && garrisonOf(site) * 2 < present) {
        takeOwnershipOfColonyFull(galaxy, e, site, r, false, true);
        // The Concord frees the forced workers and shuts the world down: the people are taken to its nearest colony.
        const home = nearestConcordColony(galaxy, r, site.xpos, site.ypos);
        const pop = site.population;
        if (home !== null && home.population !== null && pop !== null) {
            for (const p of pop.items) {
                const moved = Math.max(0, p.amount - 1_000_000 / Math.max(1, pop.items.length));
                if (moved <= 0) continue;
                p.amount -= moved;
                home.population.add(new Population(p.race, moved, galaxy));
                cd.freed += moved;
                st.stats.freed += moved;
            }
            pop.recalculateTotalAmount();
            home.population.recalculateTotalAmount();
            recalculateEmpirePopulation(r);
        }
        cd.occupations++;
        st.stats.occupations++;
        cd.site = null;
        cd.siteSince = -1;
        scenarioNews(galaxy, r, scenarioText('Voidbloom Occupied News', r.name, site.name, e.name), () => true, site);
        addHistory(galaxy, scenarioText('Voidbloom History Occupied', site.name, r.name, gameYear(now)));
    }
}

export function policeTick(galaxy: Galaxy): void {
    const r = concord(galaxy);
    const st = vbState(galaxy);
    if (r === null) {
        for (const cd of st.crackdowns) if (cd.taskForce.length > 0) releaseTaskForce(galaxy, cd);
        return;
    }
    for (const cd of st.crackdowns) {
        if (cd.status === 'tolerated' || cd.status === 'war') policeAction(galaxy, r, cd);
        else if (cd.taskForce.length > 0) releaseTaskForce(galaxy, cd);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// War bookkeeping (events)
// ---------------------------------------------------------------------------------------------------------------

function onWarDeclared(galaxy: Galaxy, p: { empire: Empire; target: Empire }): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null) return;
    const other = p.empire === r ? p.target : p.target === r ? p.empire : null;
    if (other === null || !isNormal(galaxy, other)) return;
    const cd = crackdownOn(galaxy, other);
    const st = vbState(galaxy);
    const second = st.treaty !== null && st.treaty.victorId === other.empireId;
    if (cd === null && !second) return;
    if (vbWarOf(galaxy, other) !== null) return;
    if (cd !== null) cd.status = 'war';
    const w: VbWar = { empireId: other.empireId, start: galaxyStarDate(galaxy), end: -1, outcome: '', byEmpire: 0, byConcord: 0, second };
    st.wars.push(w);
    addHistory(galaxy, scenarioText('Voidbloom History War', other.name, r.name, gameYear(galaxyStarDate(galaxy))));
    scenarioNews(galaxy, null, scenarioText('Voidbloom War News', other.name, r.name), () => true, null);
}

function onWarDamage(galaxy: Galaxy, p: { inflictor: Empire; victim: Empire; value: number }): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null) return;
    if (p.victim === r) {
        const w = vbWarOf(galaxy, p.inflictor);
        if (w !== null) w.byEmpire += p.value;
    } else if (p.inflictor === r) {
        const w = vbWarOf(galaxy, p.victim);
        if (w !== null) w.byConcord += p.value;
    }
}

/** The queries: police action without war, task-force ships outside the passive posture, a penalty-free war. */
function attacksWithoutWar(galaxy: Galaxy, v: boolean, a: { empire: Empire; target: Empire }): boolean {
    if (v || !vbOn(galaxy) || a.empire !== rimTraderEmpire(galaxy)) return v;
    return crackdownOn(galaxy, a.target)?.status === 'tolerated';
}

function penaltyWaived(galaxy: Galaxy, v: boolean, a: { self: Empire; target: Empire }): boolean {
    if (v || !vbOn(galaxy)) return v;
    const r = rimTraderEmpire(galaxy);
    if (a.target === r) return crackdownOn(galaxy, a.self) !== null;
    return false;
}

concordHooks().missionExempt = (galaxy, bo) => vbOn(galaxy) && isTaskForceShip(galaxy, bo);

registerScenarioDecision({ id: CRISIS_DECISION, kind: CRISIS_DECISION, flag: VOIDBLOOM_FLAG, resolve: resolveCrisis, aiChoose: (g, d) => {
    const e = empireById(g, Number(d.context.targetId));
    return e === null ? 'tolerate' : aiCrisisChoice(g, e);
} });
registerScenarioYearly({ id: 'voidbloom.crackdown', flag: VOIDBLOOM_FLAG, order: 42, run: (g) => crackdownYear(g) });
registerScenarioPeriodic({ id: 'voidbloom.inspect', flag: VOIDBLOOM_FLAG, periodDays: 10, run: (g) => inspectionSweep(g) });
registerScenarioPeriodic({ id: 'voidbloom.police', flag: VOIDBLOOM_FLAG, periodDays: 30, run: (g) => policeTick(g) });
registerScenarioEvent({ id: 'voidbloom.warDeclared', flag: VOIDBLOOM_FLAG, event: 'warDeclared', run: onWarDeclared });
registerScenarioEvent({ id: 'voidbloom.warDamage', flag: VOIDBLOOM_FLAG, event: 'warDamageInflicted', run: onWarDamage });
registerScenarioQuery({ id: 'voidbloom.police.attack', flag: VOIDBLOOM_FLAG, query: 'attackWithoutWar', run: attacksWithoutWar });
registerScenarioQuery({ id: 'voidbloom.warPenalty', flag: VOIDBLOOM_FLAG, query: 'declareWarPenaltyWaived', run: penaltyWaived });

export function bribeCost(galaxy: Galaxy): number {
    const r = rimTraderEmpire(galaxy);
    return Math.round(80_000 + Math.min(400_000, (r?.stateMoney ?? 0) * 0.02));
}

/** Corrupt officials look away: no inspections of our ships for two years (the money is gone). */
export function bribeOfficials(galaxy: Galaxy, e: Empire): boolean {
    if (!vbOn(galaxy) || !isNormal(galaxy, e) || e === rimTraderEmpire(galaxy)) return false;
    const st = vbState(galaxy);
    if (st.crackdownStarted < 0) return false;
    const rec = vbEmpire(galaxy, e);
    const now = galaxyStarDate(galaxy);
    const cost = bribeCost(galaxy);
    if (rec.bribedUntil > now || e.stateMoney < cost) return false;
    e.stateMoney -= cost;
    rec.bribedUntil = now + 2 * YEAR_LENGTH;
    return true;
}

// The decline index lives in treaty.ts; a late-bound slot keeps this module free of the import cycle.
export const declineSlot: { fn: ((galaxy: Galaxy) => number) | null } = { fn: null };
export function concordDecline(galaxy: Galaxy): number {
    return declineSlot.fn?.(galaxy) ?? 0;
}
void isPirate;
