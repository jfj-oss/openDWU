// Bounty hunters (scenarios/bounty-hunters, Politics & Characters). Not a port.
//
// Consequences for a terrible reputation. When an empire's stock civility rating (Empire.CivilityRating, -100..30) falls
// to bountyHuntersThreshold or below, the other empires that have met it and dislike it (weighted by their attitude to it
// and, with the Reputation ledger, their grievances; paying bountyHuntersFundPct % of their treasury, scaled by that
// weight) pool a BOUNTY on it: a galaxy-wide news line, and a decision for its owner (the human target answers from the
// message pop-up; an AI target by a simple rule): pay bountyHuntersPayoffPct % of the bounty to have it withdrawn, or fight.
//   - While it stands, a mercenary pirate faction (createEmpireMidGame kind 'pirate', Mercenary play style: the stock
//     GeneratePirateEmpire, so its base, starting fleet and ships come from the pirates' own tech) sits at a habitat on the
//     edge of the target's territory. Its fleet is sized by the bounty and the target's military (extra ships are placed at
//     its base, surplus starting ships are scrapped). It has a free protection pact with every other empire, so it is at
//     odds with the target only, and the assignMissionAllowed query keeps its ships off colonies (no invasion, bombardment
//     or raids) and off every target but the bounty's. An Attack mission on the nearest ship or station of the target is
//     given to each idle hunter every 10 days (freighters count: trade is hit).
//   - Each kill of the target's ship pays the faction bountyHuntersKillPct % of the ship's price out of the bounty.
//   - It ends when the bounty is spent ("claimed"), the target's rating recovers above bountyHuntersRecover (hysteresis:
//     withdrawn, the funders get what is left back), or it is paid off (the funders share the payment). The faction is
//     then eliminated (its ships vanish). The target cannot be hunted again for bountyHuntersCooldownYears; each repeat
//     offence posts a larger bounty (+50 % of the funding share per earlier offence).
//   - Destroying a hunter ship gives the target bountyHuntersDefianceRep civility back.
//
// Rnd: only the faction's creation (createEmpireMidGame's draws) and the extra ships' placement (the stock heading and
// parking draws). The review, funding, dispatch and payouts draw nothing. State: scenario.state.bountyHunters (plain
// data plus the target and faction Empire refs), created on the first posted bounty.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { HabitatCategoryType, type Habitat } from '../../types';
import type { Design } from '../../design';
import { BuiltObject } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { DiplomaticRelationType, empireEvaluationByEmpire, empireEvaluationsOf } from '../../diplomacy';
import { setCivilityRating } from '../../diplomacyTick';
import { PirateRelationType, changePirateRelation } from '../../pirateRelations';
import { PiratePlayStyle, latestDesignsFindNewestCanBuild, selectRandomPirateRace } from '../../pirates';
import { eliminatePirateFaction } from '../../pirates/pirateGalaxyTick';
import { generateDesignFromSpec } from '../../designGeneration';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { isHumanEmpire } from '../../humanEmpires';
import { createEmpireMidGame } from '../empireMidGame';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { raiseScenarioDecision, registerScenarioDecision, pendingScenarioDecisions, type ScenarioDecision } from '../decisions';
import { recordReputation, reputationOn, reputationSum } from '../reputation/ledger';
import { EmpireMessageType } from '../../messages';

export const BOUNTY_FLAG = 'bountyHunters';
const KEY = 'bountyHunters';
export const BOUNTY_PAYOFF_DECISION = 'bountyHunters.payoff';
const CAUSE = 'bountyHunters.bounty';

export interface BountyFunder {
    empireId: number;
    /** Credits it put in. */
    amount: number;
}

export interface Bounty {
    target: Empire;
    /** Credits posted. */
    initial: number;
    /** Credits left (kills pay out of this). */
    amount: number;
    funders: BountyFunder[];
    posted: number;
    /** The mercenary faction (null until placed / after it was lost). */
    faction: Empire | null;
    lastSpawn: number;
    lastOffer: number;
    /** Offence number (1 = first). */
    offence: number;
    kills: number;
    hunterLosses: number;
}

export interface BountyHuntersState {
    bounties: Bounty[];
    /** Target empire id → offences so far. */
    offences: Record<string, number>;
    /** Target empire id → star date before which no new bounty is posted. */
    cooldown: Record<string, number>;
    posted: number;
    claimed: number;
    withdrawn: number;
    paidOff: number;
}

export function bountyState(g: Galaxy): BountyHuntersState {
    return scenarioState<BountyHuntersState>(g, KEY, () => ({ bounties: [], offences: {}, cooldown: {}, posted: 0, claimed: 0, withdrawn: 0, paidOff: 0 }));
}

function peek(g: Galaxy): BountyHuntersState | null {
    const s = g.scenario;
    if (s === null || !(KEY in s.state)) return null;
    return s.state[KEY] as BountyHuntersState;
}

export const BOUNTY_RULES = {
    threshold: -30,
    recover: -15,
    fundPct: 3,
    payoffPct: 125,
    killPct: 50,
    perHunter: 60000,
    maxHunters: 10,
    cooldownYears: 1,
    defianceRep: 0.4,
    minBounty: 20000,
    techLevel: 1.5,
};

function P(g: Galaxy, name: string, fallback: number): number {
    return scenarioParam(g, name, fallback);
}

const days = (n: number): number => n * GAME_DAY_LENGTH;
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

function major(g: Galaxy, e: Empire | null | undefined): e is Empire {
    return e != null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && g.empires.includes(e);
}

function militaryCount(e: Empire): number {
    let n = 0;
    for (const b of e.builtObjects) if (b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed) n++;
    return n;
}

/** The bounty standing on `e` (null: none). Pure. */
export function bountyOn(g: Galaxy, e: Empire): Bounty | null {
    const st = peek(g);
    if (st === null || !scenarioFlag(g, BOUNTY_FLAG)) return null;
    return st.bounties.find((b) => b.target === e) ?? null;
}

/** The Diplomacy screen's line for an empire under bounty ("Bounty: 250,000 credits"), else null. Pure. */
export function bountyLine(g: Galaxy, e: Empire): string | null {
    const b = bountyOn(g, e);
    return b === null ? null : scenarioText('Bounty: {0} credits', fmt(b.amount));
}

/** What the target pays to have it withdrawn. */
export function payoffPrice(g: Galaxy, b: Bounty): number {
    return Math.round((b.amount * P(g, 'bountyHuntersPayoffPct', BOUNTY_RULES.payoffPct)) / 100);
}

// --- Funding ---------------------------------------------------------------------------------------------------

/** How strongly `f` wants `t` hunted, 0..1: its attitude to it (worse = more), its ledger grievances; 0 if it never met it. */
export function funderWeight(g: Galaxy, f: Empire, t: Empire): number {
    const rel = f.diplomaticRelations.byEmpire(t);
    if (rel === null || rel.type === DiplomaticRelationType.NotMet) return 0;
    const ev = empireEvaluationByEmpire(empireEvaluationsOf(f), t);
    const att = ev === null ? 0 : ev.overallAttitude;
    if (att > 20) return 0;
    let w = 0.3 + Math.max(0, -att) / 100;
    if (reputationOn(g)) w += Math.min(0.3, Math.max(0, -reputationSum(g, f, t)) / 100);
    if (rel.type === DiplomaticRelationType.War) w += 0.2;
    return Math.min(1, w);
}

function postBounty(g: Galaxy, st: BountyHuntersState, t: Empire): Bounty | null {
    const offence = (st.offences[t.empireId] ?? 0) + 1;
    const pct = Math.min(25, P(g, 'bountyHuntersFundPct', BOUNTY_RULES.fundPct) * (1 + 0.5 * (offence - 1)));
    const funders: BountyFunder[] = [];
    let total = 0;
    const picks: { e: Empire; c: number; w: number }[] = [];
    for (const e of g.empires) {
        if (!major(g, e) || e === t || e.stateMoney <= 0) continue;
        const w = funderWeight(g, e, t);
        const c = Math.floor((e.stateMoney * pct * w) / 100);
        if (c > 0) picks.push({ e, c, w });
    }
    for (const p of picks) total += p.c;
    if (total < P(g, 'bountyHuntersMin', BOUNTY_RULES.minBounty)) return null;
    for (const p of picks) {
        p.e.stateMoney -= p.c;
        funders.push({ empireId: p.e.empireId, amount: p.c });
        recordReputation(g, p.e, t, { cause: CAUSE, value: -2 * p.w, decayPerYear: 1, source: 'bountyHunters' });
    }
    const now = galaxyStarDate(g);
    const b: Bounty = { target: t, initial: total, amount: total, funders, posted: now, faction: null, lastSpawn: -1, lastOffer: now, offence, kills: 0, hunterLosses: 0 };
    st.bounties.push(b);
    st.offences[t.empireId] = offence;
    st.posted++;
    scenarioNews(g, null, scenarioText('A bounty of {0} credits has been posted on {1}.', fmt(total), t.name), () => true, t);
    return b;
}

function refundFunders(g: Galaxy, b: Bounty, sum: number): void {
    const total = b.funders.reduce((s, f) => s + f.amount, 0);
    if (total <= 0 || sum <= 0) return;
    for (const f of b.funders) {
        const e = g.empires.find((x) => x.empireId === f.empireId);
        if (e != null && e.active) e.stateMoney += (sum * f.amount) / total;
    }
}

// --- The faction -----------------------------------------------------------------------------------------------

/** Habitat for the hunters' base: the unowned planet, moon or asteroid nearest the target's colonies that is clear of every colony and ship. Pure. */
function pickBase(g: Galaxy, t: Empire): Habitat | null {
    const colonies = t.colonies.filter((c) => !c.hasBeenDestroyed);
    if (colonies.length === 0) return null;
    const sys = g.maxSolarSystemSize;
    let best: Habitat | null = null;
    let bestD = Infinity;
    for (const h of g.habitats) {
        if (h === null || h.empire !== null || h.hasBeenDestroyed || h.category === HabitatCategoryType.Star || h.category === HabitatCategoryType.GasCloud) continue;
        let d = Infinity;
        for (const c of colonies) d = Math.min(d, g.calculateDistance(h.xpos, h.ypos, c.xpos, c.ypos));
        if (d < 2 * sys || d >= bestD) continue;
        const near = g.findNearestColony(h.xpos, h.ypos, null, true);
        if (near !== null && g.calculateDistance(h.xpos, h.ypos, near.xpos, near.ypos) < 1.5 * sys) continue;
        const bo = g.findNearestBuiltObject(Math.trunc(h.xpos), Math.trunc(h.ypos), BuiltObjectRole.Undefined, false);
        if (bo !== null && g.calculateDistance(h.xpos, h.ypos, bo.xpos, bo.ypos) < 1.5 * sys) continue;
        best = h;
        bestD = d;
    }
    return best;
}

/** The hunters: the faction's live warships. */
export function hunterShips(f: Empire | null): BuiltObject[] {
    if (f === null) return [];
    return f.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed);
}

/** How many hunters the bounty and the target's military call for. */
export function hunterCount(g: Galaxy, b: Bounty): number {
    const byMoney = Math.ceil(b.amount / P(g, 'bountyHuntersPerHunter', BOUNTY_RULES.perHunter));
    const byFleet = Math.max(2, Math.ceil(militaryCount(b.target) * 0.5));
    return Math.max(1, Math.min(Math.max(2, byMoney), byFleet, Math.trunc(P(g, 'bountyHuntersMax', BOUNTY_RULES.maxHunters))));
}

function warshipDesign(g: Galaxy, f: Empire, big: boolean, n: number): Design | null {
    const S = BuiltObjectSubRole;
    const order = big ? [S.Cruiser, S.Destroyer, S.Frigate, S.Escort] : [S.Frigate, S.Escort, S.Destroyer];
    const found = order.map((s) => latestDesignsFindNewestCanBuild(f, s)).filter((d): d is Design => d !== null);
    if (found.length > 0) return found[(big ? 0 : n) % Math.min(found.length, 2)] ?? found[0];
    for (const s of order) {
        const spec = galaxyDesignSpecificationBySubRole(s);
        const d = spec === null ? null : generateDesignFromSpec(g, f, spec, 0, galaxyStarDate(g));
        if (d !== null) return d;
    }
    return null;
}

function addWarship(g: Galaxy, f: Empire, design: Design, parent: Habitat): BuiltObject {
    design.buildCount++;
    const bo = new BuiltObject(design, g.generateBuiltObjectName(design, parent), g, true);
    bo.empire = f;
    bo.purchasePrice = design.calculateCurrentPurchasePrice(g);
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    bo.nearestSystemStar = g.determineHabitatSystemStar(parent);
    bo.heading = g.selectRandomHeading();
    bo.targetHeading = bo.heading;
    const pt = g.selectRelativeParkingPoint();
    f.addBuiltObjectToGalaxy(bo, parent, false, true, Math.trunc(pt.x), Math.trunc(pt.y), false);
    return bo;
}

function pact(g: Galaxy, f: Empire, t: Empire): void {
    const now = galaxyStarDate(g);
    for (const e of g.empires) {
        if (!major(g, e) || e === t) continue;
        changePirateRelation(f, e, PirateRelationType.Protection, now, 0);
    }
}

function spawnFaction(g: Galaxy, b: Bounty): void {
    const home = pickBase(g, b.target);
    if (home === null) return;
    const race = selectRandomPirateRace(g);
    if (race === null) return;
    const f = createEmpireMidGame(g, {
        kind: 'pirate',
        race,
        home,
        piratePlayStyle: PiratePlayStyle.Mercenary,
        techLevel: P(g, 'bountyHuntersTech', BOUNTY_RULES.techLevel),
    });
    if (f === null) return;
    b.faction = f;
    b.lastSpawn = galaxyStarDate(g);
    f.stateMoney = 0;
    pact(g, f, b.target);
    fitFleet(g, b);
}

/** Brings the hunters to hunterCount: surplus starting ships are scrapped, missing ones placed at the base. */
function fitFleet(g: Galaxy, b: Bounty): void {
    const f = b.faction;
    if (f === null || f.pirateEmpireBaseHabitat === null) return;
    const want = hunterCount(g, b);
    let ships = hunterShips(f);
    while (ships.length > want) {
        const ship = ships.pop()!;
        builtObjectCompleteTeardown(g, ship);
    }
    ships = hunterShips(f);
    const big = b.amount >= 8 * P(g, 'bountyHuntersPerHunter', BOUNTY_RULES.perHunter);
    for (let i = ships.length; i < want; i++) {
        const d = warshipDesign(g, f, big, i);
        if (d === null) break;
        addWarship(g, f, d, f.pirateEmpireBaseHabitat);
    }
}

function factionAlive(g: Galaxy, f: Empire | null): f is Empire {
    return f !== null && f.active && g.pirateEmpires.includes(f) && f.pirateEmpireBaseHabitat !== null;
}

// --- Ending ----------------------------------------------------------------------------------------------------

type EndReason = 'claimed' | 'withdrawn' | 'paid' | 'gone';

function dismiss(g: Galaxy, f: Empire | null): void {
    if (f !== null && f.active && g.pirateEmpires.includes(f)) eliminatePirateFaction(g, f, null);
}

function endBounty(g: Galaxy, st: BountyHuntersState, b: Bounty, why: EndReason, paid = 0): void {
    const t = b.target;
    const i = st.bounties.indexOf(b);
    if (i >= 0) st.bounties.splice(i, 1);
    st.cooldown[t.empireId] = galaxyStarDate(g) + P(g, 'bountyHuntersCooldownYears', BOUNTY_RULES.cooldownYears) * YEAR_LENGTH;
    if (why === 'paid') {
        refundFunders(g, b, paid);
        st.paidOff++;
    } else if (why === 'withdrawn' || why === 'gone') {
        refundFunders(g, b, b.amount);
        st.withdrawn++;
    } else st.claimed++;
    dismiss(g, b.faction);
    b.faction = null;
    const text =
        why === 'paid'
            ? scenarioText('{0} paid {1} credits and the bounty on it is withdrawn. The hunters leave.', t.name, fmt(paid))
            : why === 'claimed'
              ? scenarioText('The bounty on {0} has been collected in full. The hunters leave.', t.name)
              : scenarioText('The bounty on {0} is withdrawn: its reputation has recovered. The hunters leave.', t.name);
    scenarioNews(g, null, text, () => true, t);
}

// --- Review (monthly) and dispatch (10 days) ---------------------------------------------------------------------

function offerPayoff(g: Galaxy, b: Bounty): void {
    const t = b.target;
    if (pendingScenarioDecisions(g, t).some((d) => d.kind === BOUNTY_PAYOFF_DECISION)) return;
    const price = payoffPrice(g, b);
    b.lastOffer = galaxyStarDate(g);
    raiseScenarioDecision(g, t, {
        kind: BOUNTY_PAYOFF_DECISION,
        title: scenarioText('Bounty on {0}', t.name),
        text: scenarioText('A bounty of {0} credits stands on {1}; mercenary hunters are after your ships and stations. Pay {2} credits to have it withdrawn, or fight the hunters (destroying their ships restores a little reputation).', fmt(b.amount), t.name, fmt(price)),
        options: [
            { id: 'pay', label: scenarioText('Pay {0} credits: the bounty is withdrawn', fmt(price)) },
            { id: 'fight', label: scenarioText('Refuse: fight the hunters') },
        ],
        defaultOption: 'fight',
        expiresDays: 90,
        context: { targetId: t.empireId },
    });
}

function bountyOfDecision(g: Galaxy, d: ScenarioDecision): Bounty | null {
    const st = peek(g);
    if (st === null) return null;
    const id = (d.context as { targetId?: number }).targetId;
    return st.bounties.find((b) => b.target.empireId === id) ?? null;
}

function resolvePayoff(g: Galaxy, d: ScenarioDecision, option: string): void {
    const st = peek(g);
    const b = bountyOfDecision(g, d);
    if (st === null || b === null || option !== 'pay') return;
    const price = payoffPrice(g, b);
    const t = b.target;
    if (t.stateMoney < price) {
        if (isHumanEmpire(g, t)) scenarioMessage(g, t, scenarioText('Bounty on {0}', t.name), scenarioText('You cannot afford {0} credits.', fmt(price)), { type: EmpireMessageType.GeneralWarning });
        return;
    }
    t.stateMoney -= price;
    endBounty(g, st, b, 'paid', price);
}

/** AI target's rule: pay when it is cheap against the treasury, or when the hunters outnumber a thin fleet. */
function aiChoose(g: Galaxy, d: ScenarioDecision): string {
    const b = bountyOfDecision(g, d);
    if (b === null) return 'fight';
    const price = payoffPrice(g, b);
    const money = b.target.stateMoney;
    if (price <= money * 0.15) return 'pay';
    if (price <= money * 0.4 && hunterShips(b.faction).length * 2 > militaryCount(b.target)) return 'pay';
    return 'fight';
}

/** The monthly review (exported for tests). */
export function bountyReview(g: Galaxy): void {
    const now = galaxyStarDate(g);
    let st = peek(g);
    // Standing bounties first (they may end), then new ones.
    if (st !== null) {
        for (const b of [...st.bounties]) {
            const t = b.target;
            if (!major(g, t)) {
                endBounty(g, st, b, 'gone');
                continue;
            }
            if (t.civilityRating >= P(g, 'bountyHuntersRecover', BOUNTY_RULES.recover)) {
                endBounty(g, st, b, 'withdrawn');
                continue;
            }
            if (b.amount <= b.initial * 0.02) {
                endBounty(g, st, b, 'claimed');
                continue;
            }
            if (!factionAlive(g, b.faction)) {
                b.faction = null;
                if (b.lastSpawn < 0 || now - b.lastSpawn >= days(90)) spawnFaction(g, b);
            } else {
                b.faction.stateMoney = 0;
                pact(g, b.faction, t);
                fitFleetGrow(g, b);
            }
            if (now - b.lastOffer >= days(180)) offerPayoff(g, b);
        }
    }
    const threshold = P(g, 'bountyHuntersThreshold', BOUNTY_RULES.threshold);
    for (const t of g.empires) {
        if (!major(g, t) || t.civilityRating > threshold) continue;
        if (st !== null && (st.bounties.some((b) => b.target === t) || now < (st.cooldown[t.empireId] ?? 0))) continue;
        st ??= bountyState(g);
        const b = postBounty(g, st, t);
        if (b === null) continue;
        spawnFaction(g, b);
        offerPayoff(g, b);
    }
}

/** A review adds ships when the call has grown (never scraps). */
function fitFleetGrow(g: Galaxy, b: Bounty): void {
    const f = b.faction;
    if (f === null || f.pirateEmpireBaseHabitat === null) return;
    if (hunterShips(f).length < hunterCount(g, b)) fitFleet(g, b);
}

/** The 10-day dispatch (exported for tests). */
export function bountyDispatch(g: Galaxy): void {
    const st = peek(g);
    if (st === null) return;
    for (const b of st.bounties) {
        const f = b.faction;
        if (!factionAlive(g, f)) continue;
        const targets = b.target.builtObjects.filter((o) => !o.hasBeenDestroyed && o.builtAt === null && o.xpos > -1e9);
        if (targets.length === 0) continue;
        const ships = hunterShips(f);
        const load = new Map<BuiltObject, number>();
        for (const s of ships) {
            const m = builtObjectMission(s.mission);
            if (m !== null && m.type === BuiltObjectMissionType.Attack && m.target instanceof BuiltObject && !m.target.hasBeenDestroyed) load.set(m.target, (load.get(m.target) ?? 0) + 1);
        }
        for (const s of ships) {
            const m = builtObjectMission(s.mission);
            if (m !== null && m.type === BuiltObjectMissionType.Attack && m.target instanceof BuiltObject && !m.target.hasBeenDestroyed) continue;
            let best: BuiltObject | null = null;
            let bd = Infinity;
            for (const o of targets) {
                // Stations sit still and ships run: stations are the surer prey.
                const d = g.calculateDistance(s.xpos, s.ypos, o.xpos, o.ypos) * (1 + (load.get(o) ?? 0)) * (o.role === BuiltObjectRole.Base ? 0.5 : 1);
                if (d < bd) {
                    bd = d;
                    best = o;
                }
            }
            if (best === null) continue;
            load.set(best, (load.get(best) ?? 0) + 1);
            assignMission(g, s, BuiltObjectMissionType.Attack, best, null, BuiltObjectMissionPriority.Normal);
        }
    }
}

// --- Kills ----------------------------------------------------------------------------------------------------

export function bountyOnKilled(g: Galaxy, victim: BuiltObject, destroyer: Empire | null): void {
    const st = peek(g);
    if (st === null || destroyer === null) return;
    const owner = victim.empire;
    for (const b of st.bounties) {
        if (b.faction !== null && destroyer === b.faction && owner === b.target) {
            const reward = Math.min(b.amount, Math.max(500, Math.round((victim.purchasePrice * P(g, 'bountyHuntersKillPct', BOUNTY_RULES.killPct)) / 100)));
            b.amount -= reward;
            b.faction.stateMoney += reward;
            b.kills++;
            return;
        }
        if (b.faction !== null && owner === b.faction && destroyer === b.target) {
            b.hunterLosses++;
            setCivilityRating(b.target, b.target.civilityRating + P(g, 'bountyHuntersDefianceRep', BOUNTY_RULES.defianceRep));
            return;
        }
    }
}

// --- The hunters keep to their business ---------------------------------------------------------------------------

function missionAllowed(g: Galaxy, value: boolean, a: { builtObject: BuiltObject; missionType: number; target: unknown }): boolean {
    if (!value) return value;
    const st = peek(g);
    if (st === null) return value;
    const owner = a.builtObject.empire;
    const b = st.bounties.find((x) => x.faction !== null && x.faction === owner);
    if (b === undefined) return value;
    const M = BuiltObjectMissionType;
    if (a.missionType === M.Colonize || a.missionType === M.UnloadTroops || a.missionType === M.Bombard || a.missionType === M.WaitAndBombard || a.missionType === M.Capture || a.missionType === M.Raid) return false;
    if (a.missionType === M.Attack) {
        const t = a.target;
        return t instanceof BuiltObject && t.empire === b.target;
    }
    return value;
}

registerScenarioPeriodic({ id: 'bountyHunters.review', flag: BOUNTY_FLAG, periodDays: 30, run: (g) => bountyReview(g) });
registerScenarioPeriodic({ id: 'bountyHunters.dispatch', flag: BOUNTY_FLAG, periodDays: 10, run: (g) => bountyDispatch(g) });
registerScenarioEvent({ id: 'bountyHunters.killed', flag: BOUNTY_FLAG, event: 'builtObjectKilledBy', run: (g, e) => bountyOnKilled(g, e.builtObject, e.destroyer) });
registerScenarioQuery({ id: 'bountyHunters.missions', flag: BOUNTY_FLAG, query: 'assignMissionAllowed', run: (g, v, a) => missionAllowed(g, v, a) });
// The hunters' faction takes a pirate slot while it stays, so the stock respawn does not fill it with a second one.
registerScenarioQuery({
    id: 'bountyHunters.slots',
    flag: BOUNTY_FLAG,
    query: 'pirateFactionCount',
    run: (g, v) => {
        const st = peek(g);
        return st === null ? v : v + st.bounties.filter((b) => factionAlive(g, b.faction)).length;
    },
});
registerScenarioDecision({
    id: BOUNTY_PAYOFF_DECISION,
    kind: BOUNTY_PAYOFF_DECISION,
    flag: BOUNTY_FLAG,
    resolve: resolvePayoff,
    aiChoose,
});
