// Scenario package "lively-galaxy", flag `warGoals` (task 19g-3): peace terms. Not a port — a layer over the ported
// end-of-war code:
//
//  - Terms: cede named colonies, reparations (a lump sum at signing + yearly instalments), demilitarise named systems
//    for N years, release a subject; nothing = status quo. Each term is priced in war-score points (warGoals.ts).
//  - Proposing: when an empire queues an end-war proposal (Empire.8.cs 1550 EndWarRequest → event `peaceProposed`), its
//    terms are built from its war-score lead and its war goal (buildTerms) and stored with the offer. The stock timing
//    of the proposal (Empire.8.cs 742 ReviewDiplomaticSituations → 755 ApplyDiplomaticStrategyToRelation: ConsiderEndWar
//    by objectives, war weariness 25 × aggression/100 (Empire.8.cs 904 ConsiderEndWar), heavy losses, no attack fleets)
//    is unchanged.
//  - Accepting: the AI's verdict on an end-war proposal is the query `endWarAcceptance` (Empire.3.cs 3651 ConsiderTreaty-
//    Proposals `if (ConsiderEndWar(thisEmpire, out endReason))`, Main.Part10.cs 4679 WAR_END). The stock ConsiderEndWar
//    verdict stays the gate (or the terms fulfil the accepter's war goal), and the terms must be worth what the war
//    score and the accepter's war weariness (Empire._WarWeariness, taxes.ts empireWarWeariness) say it should concede
//    or may demand (acceptsTerms).
//  - Signing: the stock end of war runs (ResetAttitudeLevelsAtEndOfWar, both relations to None, ProcessEndOfWarWithEmpire
//    — Empire.3.cs 3316 / 3466), then event `peaceSigned` applies the terms through ported code: colonies by
//    Galaxy.4.cs 3857 GiveTradeableItem (Colony → Empire.1.cs 64 TakeOwnershipOfColony), money by GiveTradeableItem
//    (Money), a subject released by Empire.8.cs EndSubjugation's ChangeDiplomaticRelation(relation, None), and
//    relations by EmpireEvaluation.IncidentEvaluation (the humiliated side).
//  - The player: an AI offer raises a decision (accept / decline / counter); the diplomacy screen shows the war score and
//    the offer and composes terms; both reach the sim as player commands (playerOps `answerDecision`,
//    `proposePeaceTerms`).
//
// Rnd: none (ConsiderEndWar and everything here are deterministic).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { DiplomaticRelation, DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { changeDiplomaticRelation, considerEndWar, processEndOfWarWithEmpire, resetAttitudeLevelsAtEndOfWar } from '../../diplomacyTick';
import { calculateWarValueHabitat } from '../../combat/damage';
import { empireWarWeariness } from '../../taxes';
import { TradeableItem, TradeableItemType, giveTradeableItem } from '../../tradeItems';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../missions/mission';
import { EmpireMessageType, sendMessageToEmpire } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioQuery, registerScenarioYearly, scenarioEmit } from '../hooks';
import { answerScenarioDecision, pendingScenarioDecisions, raiseScenarioDecision, registerScenarioDecision } from '../decisions';
import { scenarioParam } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { LIVELY_GALAXY_ID } from './livelyGalaxy';
import {
    WAR_GOALS_FLAG,
    atWar,
    describeGoal,
    enemySideOf,
    pairKey,
    peekWarLedger,
    sideOf,
    sideScore,
    subjectsOf,
    warGoalsOn,
    warGoalsState,
    warGoalsYearly,
    warKey,
    warLedger,
    warScoreLead,
    warshipsInside,
    type DemilTreaty,
    type PeaceTerms,
    type WarGoal,
    type WarSide,
} from './warGoals';
import { acceptProposal } from '../../player/playerOrders';
import { isHumanEmpire } from '../../humanEmpires';

// ---------------------------------------------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------------------------------------------

export function statusQuo(): PeaceTerms {
    return { cede: [], reparations: null, demilitarise: null, release: null };
}

export function isStatusQuo(t: PeaceTerms): boolean {
    return t.cede.length === 0 && t.reparations === null && t.demilitarise === null && t.release === null;
}

/** A ceded colony's price: its war value (Galaxy.3.cs 507 CalculateWarValue) × termColonyFactor, at least 1. */
export function colonyPrice(galaxy: Galaxy, c: Habitat): number {
    return Math.max(1, calculateWarValueHabitat(galaxy, c)) * scenarioParam(galaxy, 'termColonyFactor', 1.5);
}

function moneyPerPoint(galaxy: Galaxy): number {
    return Math.max(1, scenarioParam(galaxy, 'termMoneyPerPoint', 25));
}

function demilPrice(galaxy: Galaxy, systems: number, years: number): number {
    const ref = Math.max(1, scenarioParam(galaxy, 'demilYears', 10));
    return systems * scenarioParam(galaxy, 'termDemilPoints', 100) * (years / ref);
}

/** The terms' value to `e` in war-score points: what it gains minus what it gives. */
export function termsValueFor(galaxy: Galaxy, t: PeaceTerms, e: Empire): number {
    let v = 0;
    for (const c of t.cede) {
        const p = colonyPrice(galaxy, c.colony);
        if (c.to === e) v += p;
        if (c.from === e) v -= p;
    }
    if (t.reparations !== null) {
        const r = t.reparations;
        const p = (r.lump + r.perYear * r.years) / moneyPerPoint(galaxy);
        if (r.payee === e) v += p;
        if (r.payer === e) v -= p;
    }
    if (t.demilitarise !== null) {
        const d = t.demilitarise;
        const p = demilPrice(galaxy, d.systems.length, d.years);
        if (d.beneficiary === e) v += p;
        if (d.empire === e) v -= p;
    }
    if (t.release !== null) {
        const p = scenarioParam(galaxy, 'termReleasePoints', 300);
        if (t.release.overlord === e) v -= p;
        else v += p;
    }
    return v;
}

/** True when the terms give `e` what its war goal asks for. */
export function termsMeetGoal(t: PeaceTerms, e: Empire, g: WarGoal): boolean {
    switch (g.kind) {
        case 'conquest':
        case 'border':
            return t.cede.some((c) => c.to === e && g.colonies.includes(c.colony));
        case 'freeSubject':
            return t.release !== null && t.release.subject === g.subject;
        default:
            return (t.reparations !== null && t.reparations.payee === e) || (t.demilitarise !== null && t.demilitarise.beneficiary === e);
    }
}

/** `e`'s war weariness in term points (Empire._WarWeariness × termWearinessPoints). */
function wearinessPoints(galaxy: Galaxy, e: Empire): number {
    return empireWarWeariness(e) * scenarioParam(galaxy, 'termWearinessPoints', 20);
}

/**
 * The value `accepter` requires from terms offered by `proposer` (may be negative: it will concede that much). Ahead in
 * the war it demands a share of its lead; behind it concedes up to its deficit; war weariness lowers the bar either way.
 */
export function requiredValue(galaxy: Galaxy, accepter: Empire, proposer: Empire): number {
    const lead = warScoreLead(galaxy, proposer, accepter); // > 0: the proposer is ahead
    const wear = wearinessPoints(galaxy, accepter);
    if (lead >= 0) return -(lead * scenarioParam(galaxy, 'termConcedeShare', 1) + wear);
    return -lead * scenarioParam(galaxy, 'termDemandShare', 0.5) - wear;
}

/**
 * Whether `accepter` accepts `terms` from `proposer`. `stockEnd` is ConsiderEndWar's verdict (Empire.8.cs 904: objectives
 * met, weariness above 25 × aggression/100, outnumbered, heavy losses, no attack fleets — and never before the
 * minimum war length). The terms must meet the required value; terms that fulfil the accepter's war goal open the gate
 * even when ConsiderEndWar would fight on, but not before Galaxy.MinimumWarLengthPeriodYears (0.5).
 */
export function acceptsTerms(galaxy: Galaxy, accepter: Empire, proposer: Empire, terms: PeaceTerms, stockEnd: boolean): boolean {
    const value = termsValueFor(galaxy, terms, accepter);
    if (value < requiredValue(galaxy, accepter, proposer)) return false;
    if (stockEnd) return true;
    const ledger = peekWarLedger(galaxy, accepter, proposer);
    if (ledger === null || value < 0 || !termsMeetGoal(terms, accepter, sideOf(ledger, accepter).goal)) return false;
    const rel = obtainDiplomaticRelation(accepter, proposer);
    if (rel.locked) return false;
    return galaxyStarDate(galaxy) >= rel.startDateOfLastChange + 0.5 * YEAR_LENGTH;
}

// ---------------------------------------------------------------------------------------------------------------
// Building terms (the AI's offer, the player's suggested terms)
// ---------------------------------------------------------------------------------------------------------------

/** `victim`'s system nearest `from`'s capital, excluding its capital's system (demilitarisation candidate). */
export function borderSystemsOf(galaxy: Galaxy, victim: Empire, from: Empire, max = 6): Habitat[] {
    const cap = from.capital;
    const capSys = victim.capital !== null ? victim.capital.systemIndex : -1;
    const seen = new Set<number>();
    const stars: Habitat[] = [];
    for (const c of victim.colonies) {
        if (c === null || c.empire !== victim || c.systemIndex === capSys || seen.has(c.systemIndex)) continue;
        seen.add(c.systemIndex);
        const star = galaxy.systems[c.systemIndex]?.systemStar;
        if (star != null) stars.push(star);
    }
    if (cap !== null) stars.sort((a, b) => (a.xpos - cap.xpos) ** 2 + (a.ypos - cap.ypos) ** 2 - ((b.xpos - cap.xpos) ** 2 + (b.ypos - cap.ypos) ** 2) || a.systemIndex - b.systemIndex);
    return stars.slice(0, max);
}

/** The terms `proposer` asks of (or offers to) `target`, from the war score, its goal and the target's weariness. */
export function buildTerms(galaxy: Galaxy, proposer: Empire, target: Empire): PeaceTerms {
    const t = statusQuo();
    const ledger = peekWarLedger(galaxy, proposer, target);
    if (ledger === null) return t;
    const lead = warScoreLead(galaxy, proposer, target);
    const threshold = scenarioParam(galaxy, 'termDemandThreshold', 100);
    const mpp = moneyPerPoint(galaxy);
    if (lead <= threshold) {
        // Not clearly ahead: offer what the target requires (reparations paid by the proposer), else the status quo.
        const need = requiredValue(galaxy, target, proposer);
        if (need > 0) {
            const lump = Math.floor(Math.min(need * mpp, Math.max(0, proposer.stateMoney) * 0.5));
            if (lump > 0) t.reparations = { payer: proposer, payee: target, lump, perYear: 0, years: 0 };
        }
        return t;
    }
    let budget = -requiredValue(galaxy, target, proposer) * 0.9;
    const g = sideOf(ledger, proposer).goal;
    if (g.kind === 'conquest' || g.kind === 'border') {
        for (const c of g.colonies) {
            if (c.empire !== target || c === target.capital || c.hasBeenDestroyed) continue;
            const p = colonyPrice(galaxy, c);
            if (p > budget) continue;
            t.cede.push({ colony: c, from: target, to: proposer });
            budget -= p;
        }
    } else if (g.kind === 'freeSubject' && g.subject !== null && subjectsOf(target).includes(g.subject)) {
        const p = scenarioParam(galaxy, 'termReleasePoints', 300);
        if (p <= budget) {
            t.release = { overlord: target, subject: g.subject };
            budget -= p;
        }
    } else if (g.kind === 'punish' || g.kind === 'casusBelli') {
        const years = Math.max(1, Math.round(scenarioParam(galaxy, 'demilYears', 10)));
        const systems = borderSystemsOf(galaxy, target, proposer, 1);
        const p = demilPrice(galaxy, systems.length, years);
        if (systems.length > 0 && p <= budget) {
            t.demilitarise = { empire: target, beneficiary: proposer, systems, years };
            budget -= p;
        }
    }
    const total = Math.floor(budget * mpp);
    if (total >= mpp) {
        const years = Math.max(0, Math.round(scenarioParam(galaxy, 'reparationYears', 5)));
        let lump = Math.floor(Math.min(total * scenarioParam(galaxy, 'reparationLumpShare', 0.4), Math.max(0, target.stateMoney) * 0.5));
        if (years === 0) lump = Math.floor(Math.min(total, Math.max(0, target.stateMoney)));
        const perYear = years > 0 ? Math.floor((total - lump) / years) : 0;
        if (lump > 0 || perYear > 0) t.reparations = { payer: target, payee: proposer, lump, perYear, years: perYear > 0 ? years : 0 };
    }
    return t;
}

/** Terms limited to what is valid between `a` and `b` now (player input is sanitised through this). */
export function sanitiseTerms(galaxy: Galaxy, t: PeaceTerms, a: Empire, b: Empire): PeaceTerms {
    const party = (e: Empire | null | undefined): e is Empire => e === a || e === b;
    const out = statusQuo();
    const seen = new Set<Habitat>();
    for (const c of t.cede ?? []) {
        if (c == null || !party(c.from) || !party(c.to) || c.from === c.to) continue;
        if (c.colony == null || c.colony.empire !== c.from || c.colony === c.from.capital || c.colony.hasBeenDestroyed || seen.has(c.colony)) continue;
        seen.add(c.colony);
        out.cede.push({ colony: c.colony, from: c.from, to: c.to });
    }
    const r = t.reparations;
    if (r != null && party(r.payer) && party(r.payee) && r.payer !== r.payee) {
        const lump = Number.isFinite(r.lump) ? Math.max(0, Math.floor(r.lump)) : 0;
        const years = Number.isFinite(r.years) ? Math.min(20, Math.max(0, Math.floor(r.years))) : 0;
        const perYear = years > 0 && Number.isFinite(r.perYear) ? Math.max(0, Math.floor(r.perYear)) : 0;
        if (lump > 0 || perYear > 0) out.reparations = { payer: r.payer, payee: r.payee, lump, perYear, years: perYear > 0 ? years : 0 };
    }
    const d = t.demilitarise;
    if (d != null && party(d.empire) && party(d.beneficiary) && d.empire !== d.beneficiary) {
        const systems = (d.systems ?? []).filter((s, i, arr) => s != null && galaxy.systems[s.systemIndex]?.systemStar === s && arr.indexOf(s) === i).slice(0, 5);
        const years = Number.isFinite(d.years) ? Math.min(30, Math.max(1, Math.floor(d.years))) : 1;
        if (systems.length > 0) out.demilitarise = { empire: d.empire, beneficiary: d.beneficiary, systems, years };
    }
    const rel = t.release;
    if (rel != null && party(rel.overlord) && rel.subject != null && subjectsOf(rel.overlord).includes(rel.subject)) out.release = { overlord: rel.overlord, subject: rel.subject };
    return out;
}

export function describeTerms(t: PeaceTerms): string[] {
    const out: string[] = [];
    for (const c of t.cede) out.push(scenarioText('Lively Term Cede', c.from.name, c.colony.name, c.to.name));
    if (t.reparations !== null) {
        const r = t.reparations;
        if (r.lump > 0) out.push(scenarioText('Lively Term Lump', r.payer.name, r.lump.toLocaleString('en-US'), r.payee.name));
        if (r.perYear > 0 && r.years > 0) out.push(scenarioText('Lively Term Yearly', r.payer.name, r.perYear.toLocaleString('en-US'), r.payee.name, r.years));
    }
    if (t.demilitarise !== null) {
        const d = t.demilitarise;
        out.push(scenarioText('Lively Term Demil', d.empire.name, d.systems.map((s) => s.name).join(', '), d.years));
    }
    if (t.release !== null) out.push(scenarioText('Lively Term Release', t.release.overlord.name, t.release.subject.name));
    if (out.length === 0) out.push(scenarioText('Lively Term StatusQuo'));
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Applying terms
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.4.cs 3857 GiveTradeableItem(Money): at most what the payer has. Returns the amount paid. */
export function payReparations(galaxy: Galaxy, payer: Empire, payee: Empire, amount: number): number {
    const paid = Math.floor(Math.min(amount, Math.max(0, payer.stateMoney)));
    if (paid <= 0) return 0;
    giveTradeableItem(galaxy, payer, payee, new TradeableItem(TradeableItemType.Money, paid, paid), null);
    return paid;
}

/** Applies accepted terms between `a` and `b` (after the stock end of war). Exported for tests. */
export function applyTerms(galaxy: Galaxy, t: PeaceTerms, a: Empire, b: Empire): void {
    const st = warGoalsState(galaxy);
    const now = galaxyStarDate(galaxy);
    const valueA = termsValueFor(galaxy, t, a);
    const valueB = termsValueFor(galaxy, t, b);
    for (const c of t.cede) {
        // Galaxy.4.cs 3857 GiveTradeableItem(Colony) → Empire.1.cs 64 TakeOwnershipOfColony (tradeItems.ts).
        if (c.colony.empire === c.from && !c.colony.hasBeenDestroyed) giveTradeableItem(galaxy, c.from, c.to, new TradeableItem(TradeableItemType.Colony, c.colony, 0), null);
    }
    if (t.reparations !== null) {
        const r = t.reparations;
        if (r.lump > 0) payReparations(galaxy, r.payer, r.payee, r.lump);
        if (r.perYear > 0 && r.years > 0) st.reparations.push({ payer: r.payer, payee: r.payee, perYear: r.perYear, yearsLeft: r.years });
    }
    if (t.demilitarise !== null) {
        const d = t.demilitarise;
        const treaty: DemilTreaty = {
            empire: d.empire,
            beneficiary: d.beneficiary,
            systems: [...d.systems],
            signed: now,
            until: now + d.years * YEAR_LENGTH,
            graceUntil: now + scenarioParam(galaxy, 'demilGraceDays', 60) * GAME_DAY_LENGTH,
        };
        st.treaties.push(treaty);
        // Warships already inside are ordered home (BuiltObject.2.cs 7620 AssignMission Move → the capital).
        const home = d.empire.capital;
        if (home !== null) for (const bo of warshipsInside(galaxy, treaty)) assignMission(galaxy, bo, BuiltObjectMissionType.Move, home, null, BuiltObjectMissionPriority.High);
    }
    if (t.release !== null) {
        // Empire.8.cs EndSubjugation: ChangeDiplomaticRelation(relation, None) + the release message (Empire.7.cs 3849).
        const rel = obtainDiplomaticRelation(t.release.overlord, t.release.subject);
        if (rel.type === DiplomaticRelationType.SubjugatedDominion && rel.initiator === t.release.overlord) {
            changeDiplomaticRelation(galaxy, t.release.overlord, rel, DiplomaticRelationType.None);
            rel.lastDiplomacyTradeOfferDate = now;
            sendMessageToEmpire(t.release.overlord, t.release.subject, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.None, 'We are releasing you from subjugation to us. We no longer consider you to be our conquered dominion.');
        }
    }
    // The side that conceded remembers it (humiliation) and thinks less of the victor.
    const [loser, victor, lost] = valueA < valueB ? [a, b, -valueA] : [b, a, -valueB];
    if (lost > 0) {
        const k = pairKey(loser, victor);
        st.humiliations[k] = (st.humiliations[k] ?? 0) + lost;
        const ev = obtainEmpireEvaluation(galaxy, loser, victor);
        const drop = Math.min(scenarioParam(galaxy, 'humiliationRelationCap', 30), lost * scenarioParam(galaxy, 'humiliationRelationDrop', 0.02));
        ev.incidentEvaluation = ev.incidentEvaluationRaw - drop;
    }
    const lines = describeTerms(t).join('; ');
    scenarioMessage(galaxy, a, scenarioText('Lively Peace Title'), scenarioText('Lively Peace Signed', b.name, lines), { type: EmpireMessageType.GeneralNeutralEvent, subject: b, sender: b });
    scenarioMessage(galaxy, b, scenarioText('Lively Peace Title'), scenarioText('Lively Peace Signed', a.name, lines), { type: EmpireMessageType.GeneralNeutralEvent, subject: a, sender: a });
    if (!isStatusQuo(t)) scenarioNews(galaxy, null, scenarioText('Lively Peace News', a.name, b.name, lines), (x) => x !== a && x !== b);
}

// ---------------------------------------------------------------------------------------------------------------
// Offers, acceptance, signing (hooks)
// ---------------------------------------------------------------------------------------------------------------

export const PEACE_DECISION = 'lively.peace';

/** The standing offer `from` → `to` (null: none; a stock proposal without terms is the status quo). */
export function peaceOffer(galaxy: Galaxy, from: Empire, to: Empire): PeaceTerms | null {
    const s = galaxy.scenario;
    const st = s === null ? undefined : (s.state['warGoals'] as { offers: Record<string, PeaceTerms> } | undefined);
    return st?.offers[pairKey(from, to)] ?? null;
}

/** The player's pending peace decision about `other`'s offer (id), or null. */
export function pendingPeaceDecision(galaxy: Galaxy, player: Empire, other: Empire): number | null {
    const d = pendingScenarioDecisions(galaxy, player).find((x) => x.kind === PEACE_DECISION && x.context.other === other);
    return d === undefined ? null : d.id;
}

function raisePeaceDecision(galaxy: Galaxy, player: Empire, other: Empire, terms: PeaceTerms): void {
    const pending = pendingPeaceDecision(galaxy, player, other);
    if (pending !== null) answerScenarioDecision(galaxy, pending, 'decline', 'expired');
    raiseScenarioDecision(galaxy, player, {
        kind: PEACE_DECISION,
        title: scenarioText('Lively Peace Offer Title', other.name),
        text: scenarioText('Lively Peace Offer Text', other.name, describeTerms(terms).join('; ')),
        options: [
            { id: 'accept', label: scenarioText('Lively Peace Accept') },
            { id: 'decline', label: scenarioText('Lively Peace Decline') },
            { id: 'counter', label: scenarioText('Lively Peace Counter') },
        ],
        defaultOption: 'decline',
        expiresDays: scenarioParam(galaxy, 'peaceDecisionDays', 60),
        context: { other },
    });
}

registerScenarioEvent({
    id: 'lively.warGoals.proposed',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    event: 'peaceProposed',
    run: (g, p) => {
        if (peekWarLedger(g, p.empire, p.other) === null) return;
        const terms = buildTerms(g, p.empire, p.other);
        warGoalsState(g).offers[pairKey(p.empire, p.other)] = terms;
        if (isHumanEmpire(g, p.other)) raisePeaceDecision(g, p.other, p.empire, terms);
    },
});

registerScenarioQuery({
    id: 'lively.warGoals.accept',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    query: 'endWarAcceptance',
    run: (g, value, args) => {
        if (peekWarLedger(g, args.empire, args.other) === null) return value;
        return acceptsTerms(g, args.empire, args.other, peaceOffer(g, args.other, args.empire) ?? statusQuo(), value);
    },
});

/** `accepter` accepted `proposer`'s end-war proposal: apply the proposer's terms and close the ledger. */
function onPeaceSigned(galaxy: Galaxy, accepter: Empire, proposer: Empire): void {
    const st = warGoalsState(galaxy);
    const terms = st.offers[pairKey(proposer, accepter)] ?? statusQuo();
    delete st.offers[pairKey(proposer, accepter)];
    delete st.offers[pairKey(accepter, proposer)];
    delete st.wars[warKey(accepter, proposer)];
    for (const [player, other] of [
        [accepter, proposer],
        [proposer, accepter],
    ] as const) {
        if (!isHumanEmpire(galaxy, player)) continue;
        const id = pendingPeaceDecision(galaxy, player, other);
        if (id !== null) answerScenarioDecision(galaxy, id, 'decline', 'expired');
    }
    applyTerms(galaxy, sanitiseTerms(galaxy, terms, accepter, proposer), accepter, proposer);
}

registerScenarioEvent({
    id: 'lively.warGoals.signed',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    event: 'peaceSigned',
    run: (g, p) => onPeaceSigned(g, p.empire, p.other),
});

registerScenarioYearly({
    id: 'lively.warGoals.yearly',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    order: 30,
    run: (g) => warGoalsYearly(g, (payer, payee, amount) => payReparations(g, payer, payee, amount)),
});

// ---------------------------------------------------------------------------------------------------------------
// The player's side (commands: playerOps `proposePeaceTerms`, `answerDecision`)
// ---------------------------------------------------------------------------------------------------------------

export interface PeaceTermsResult {
    ok: boolean;
    accepted: boolean;
    message: string;
    /** The AI's counter-offer when it refused (now standing as its offer, with a decision for the player). */
    counter: PeaceTerms | null;
}

/** Ends the war as the accepted WAR_END does (Main.Part10.cs 4679): stock end-of-war processing, then `peaceSigned`. */
function endWarAccepted(galaxy: Galaxy, accepter: Empire, proposer: Empire): void {
    const now = galaxyStarDate(galaxy);
    const rel = obtainDiplomaticRelation(proposer, accepter);
    resetAttitudeLevelsAtEndOfWar(galaxy, rel);
    rel.type = DiplomaticRelationType.None;
    rel.lastDiplomacyTradeOfferDate = now;
    const rel2 = obtainDiplomaticRelation(accepter, proposer);
    rel2.type = DiplomaticRelationType.None;
    rel2.lastDiplomacyTradeOfferDate = now;
    processEndOfWarWithEmpire(galaxy, proposer, accepter);
    processEndOfWarWithEmpire(galaxy, accepter, proposer);
    sendMessageToEmpire(accepter, proposer, EmpireMessageType.AcceptDiplomaticRelation, DiplomaticRelationType.None, 'We agree to end this war. We will cease hostilities immediately.');
    scenarioEmit(galaxy, 'peaceSigned', { empire: accepter, other: proposer });
}

/**
 * `empire` offers `other` peace on `terms` (the player's terms dialog / the counter option). The AI answers at once:
 * accepted → the war ends and the terms apply; refused → it counters with its own terms (a standing offer the player
 * can accept, decline or counter). Only between frames (a player command).
 */
export function proposePeaceTerms(galaxy: Galaxy, empire: Empire, other: Empire, terms: PeaceTerms): PeaceTermsResult {
    const res: PeaceTermsResult = { ok: false, accepted: false, message: '', counter: null };
    if (!warGoalsOn(galaxy)) return { ...res, message: 'War goals are off' };
    if (!atWar(empire, other)) return { ...res, message: 'Not at war' };
    const rel = obtainDiplomaticRelation(other, empire);
    if (rel.locked) return { ...res, message: 'This war cannot be ended' };
    const t = sanitiseTerms(galaxy, terms, empire, other);
    res.ok = true;
    const st = warGoalsState(galaxy);
    warLedger(galaxy, empire, other); // a war begun outside DeclareWar gets its ledger now
    const stockEnd = considerEndWar(galaxy, other, empire, false).end;
    if (acceptsTerms(galaxy, other, empire, t, stockEnd)) {
        st.offers[pairKey(empire, other)] = t;
        res.accepted = true;
        res.message = scenarioText('Lively Peace Accepted', other.name);
        endWarAccepted(galaxy, other, empire);
        return res;
    }
    delete st.offers[pairKey(empire, other)];
    const counter = buildTerms(galaxy, other, empire);
    res.counter = counter;
    res.message = scenarioText('Lively Peace Refused', other.name);
    st.offers[pairKey(other, empire)] = counter;
    // The counter stands as the other empire's end-war proposal (Empire.8.cs 1550 EndWarRequest's proposal, without its
    // proposal-date gate: this is the reply in the same conversation).
    if (empire.proposedDiplomaticRelations.byEmpire(other) === null) {
        empire.proposedDiplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.None, other, other, empire, galaxyStarDate(galaxy), rel.supplyRestrictedResources));
    }
    if (isHumanEmpire(galaxy, empire)) raisePeaceDecision(galaxy, empire, other, counter);
    return res;
}

/** The player's answer to a peace decision (resolve of PEACE_DECISION). */
function resolvePeace(galaxy: Galaxy, player: Empire, other: Empire, option: string): void {
    if (!atWar(player, other)) return;
    const proposal = player.proposedDiplomaticRelations.byEmpire(other);
    switch (option) {
        case 'accept':
            if (proposal === null) return; // the offer lapsed (Galaxy.TreatyOfferValidYears)
            // EmpireDetailView.cs 803 btnEmpireDetailAcceptTreaty_Click (playerOrders.ts acceptProposal) — emits peaceSigned.
            acceptProposal(player, other);
            return;
        case 'decline':
            if (proposal !== null) player.proposedDiplomaticRelations.remove(proposal);
            delete warGoalsState(galaxy).offers[pairKey(other, player)];
            return;
        case 'counter':
            if (proposal !== null) player.proposedDiplomaticRelations.remove(proposal);
            proposePeaceTerms(galaxy, player, other, buildTerms(galaxy, player, other));
            return;
    }
}

registerScenarioDecision({
    id: PEACE_DECISION,
    kind: PEACE_DECISION,
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    resolve: (g, d, optionId) => {
        // An expired / superseded question changes nothing (the stock proposal lapses on its own, Galaxy.TreatyOfferValidYears).
        if (d.answeredBy === 'expired') return;
        resolvePeace(g, d.empire, d.context.other as Empire, optionId);
    },
});

// ---------------------------------------------------------------------------------------------------------------
// UI read-outs (pure)
// ---------------------------------------------------------------------------------------------------------------

export interface WarSideView {
    goal: string;
    goalChosenBy: string;
    score: number;
    shipsDestroyed: number;
    shipValue: number;
    coloniesTaken: number;
    invasions: number;
    blockadeDays: number;
}

export interface WarView {
    us: WarSideView;
    them: WarSideView;
    /** Our balance in [-100, 100]. */
    balance: number;
    days: number;
    theirOffer: string[] | null;
    decisionId: number | null;
}

export function warView(galaxy: Galaxy, player: Empire, other: Empire): WarView | null {
    if (!warGoalsOn(galaxy)) return null;
    const l = peekWarLedger(galaxy, player, other);
    if (l === null) return null;
    const mk = (s: WarSide): WarSideView => ({
        goal: describeGoal(s.goal),
        goalChosenBy: s.chosenBy,
        score: Math.round(sideScore(galaxy, l, s)),
        shipsDestroyed: s.shipsDestroyed,
        shipValue: s.shipValue,
        coloniesTaken: s.coloniesTaken,
        invasions: s.invasions,
        blockadeDays: Math.round(s.blockadeDays),
    });
    const us = mk(sideOf(l, player));
    const them = mk(enemySideOf(l, player));
    const offer = peaceOffer(galaxy, other, player);
    return {
        us,
        them,
        balance: Math.round((100 * (us.score - them.score)) / (us.score + them.score + 1)),
        days: Math.floor((galaxyStarDate(galaxy) - l.startDate) / GAME_DAY_LENGTH),
        theirOffer: offer !== null && player.proposedDiplomaticRelations.byEmpire(other) !== null ? describeTerms(offer) : null,
        decisionId: pendingPeaceDecision(galaxy, player, other),
    };
}

/** What the terms dialog can offer between `player` and `other`. */
export function termsChoices(galaxy: Galaxy, player: Empire, other: Empire): { theirColonies: Habitat[]; ourColonies: Habitat[]; theirSystems: Habitat[]; ourSystems: Habitat[]; theirSubjects: Empire[]; ourSubjects: Empire[] } {
    const near = (list: Habitat[], to: Empire): Habitat[] => {
        const cap = to.capital;
        const out = list.filter((c) => c !== null && !c.hasBeenDestroyed);
        if (cap !== null) out.sort((a, b) => (a.xpos - cap.xpos) ** 2 + (a.ypos - cap.ypos) ** 2 - ((b.xpos - cap.xpos) ** 2 + (b.ypos - cap.ypos) ** 2) || a.habitatIndex - b.habitatIndex);
        return out.slice(0, 8);
    };
    return {
        theirColonies: near(other.colonies.filter((c) => c !== null && c.empire === other && c !== other.capital), player),
        ourColonies: near(player.colonies.filter((c) => c !== null && c.empire === player && c !== player.capital), other),
        theirSystems: borderSystemsOf(galaxy, other, player),
        ourSystems: borderSystemsOf(galaxy, player, other),
        theirSubjects: subjectsOf(other),
        ourSubjects: subjectsOf(player),
    };
}
