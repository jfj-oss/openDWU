// The Voidbloom War — the war's end and after (docs/VOIDBLOOM_WAR.md §2.4–2.6, §4, user decisions 2, 4, 12, 15): the
// Concord's decline (drain, addiction, frozen research; the navy cap shrinks), its peace gate, the unequal-treaty terms
// (PeaceTerms.extra kinds through lively-galaxy's registry, or a built-in treaty without War Goals), the AI's term
// building, the history events after a treaty (the barren rock that grows into a trade hub, "me too" treaties, the
// foreign-run customs' cut, the pretext incident and the looted wonder) and the aftermath draw with its five branches
// (self-strengthening + revanche, unrest and a zealot's civil war, client state, opening, collapse).
//
// Rnd: galaxy.rnd only in the yearly handler (the aftermath draw, the revanche delay, the splits). No Rnd elsewhere.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { IndustryType } from '../../types';
import { ColonyResourceEffect } from '../../developmentLevel';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { changeDiplomaticRelation, declareWar, militaryPotency, processEndOfWarWithEmpire, resetAttitudeLevelsAtEndOfWar } from '../../diplomacyTick';
import { initiateEmpireSplitAt } from '../../empireEvents';
import { CharacterTraitType } from '../../characters';
import { calculateWarValueHabitat } from '../../combat/damage';
import { TradeableItem, TradeableItemType, giveTradeableItem } from '../../tradeItems';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { gameYear, registerScenarioEvent, registerScenarioQuery, registerScenarioYearly, scenarioEmit } from '../hooks';
import { registerStabilityTerm } from '../stability';
import { scenarioParam } from '../state';
import { scenarioNews, scenarioText } from '../messages';
import { applyReputation } from '../reputation/ledger';
import { concordHooks, rimParam, rimTraderEmpire } from '../rimTrade/common';
import { highestResearchedLevel } from '../rimTrade/treasureFleet';
import { grantCasusBelli, warGoalsOn, type PeaceTerms, type ScenarioTerm } from '../lively/warGoals';
import { registerPeaceAppliedListener, registerPeaceTermKind, registerPeaceTermsBuilder, termsValueFor } from '../lively/peaceTerms';
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
    normalEmpires,
    peekVbState,
    vbEmpire,
    vbOn,
    vbParam,
    vbState,
    vbWarOf,
    type AftermathBranch,
    type VbTreaty,
} from './common';
import { declineSlot } from './crackdown';

// ---------------------------------------------------------------------------------------------------------------
// Decline
// ---------------------------------------------------------------------------------------------------------------

function techLevel(e: Empire): number {
    return Math.max(highestResearchedLevel(e, IndustryType.Weapon), highestResearchedLevel(e, IndustryType.Energy), highestResearchedLevel(e, IndustryType.HighTech));
}

/** Tech levels the strongest normal empire stands above the Concord. Pure. */
export function concordTechGap(galaxy: Galaxy): number {
    const r = rimTraderEmpire(galaxy);
    if (r === null) return 0;
    let best = 0;
    for (const e of normalEmpires(galaxy)) if (e !== r) best = Math.max(best, techLevel(e));
    return Math.max(0, best - techLevel(r));
}

/**
 * The Concord's decline index 0..1: addiction (0.35), the silver drained against its starting treasury (0.25), an
 * empty treasury (0.2) and its frozen research against the best normal empire (0.2: three levels behind = full). Pure.
 */
export function concordDeclineIndex(galaxy: Galaxy): number {
    const r = rimTraderEmpire(galaxy);
    const st = peekVbState(galaxy);
    if (r === null || st === null) return 0;
    const start = Math.max(1, rimParam(galaxy, 'rimTraderStartMoney'));
    const drain = Math.min(1, (st.stats.stateDrain + st.stats.privateDrain) / start);
    // Drained from its peak: the treasury against the most it ever held (at least the starting treasury).
    const peak = Math.max(start, st.concordPeak ?? 0);
    const poor = 1 - Math.min(1, Math.max(0, r.stateMoney) / peak);
    const gap = Math.min(1, concordTechGap(galaxy) / 3);
    return Math.min(1, 0.35 * concordAddiction(galaxy) + 0.25 * drain + 0.2 * poor + 0.2 * gap);
}

declineSlot.fn = concordDeclineIndex;

/** The peace gate: the Concord signs away rights only once declined this far. Pure. */
export function concordGateOpen(galaxy: Galaxy): boolean {
    // The yearly figure (the index walks every empire's tech tree); fresh when the year has none yet.
    const cached = peekVbState(galaxy)?.declineNow;
    return (cached ?? concordDeclineIndex(galaxy)) >= vbParam(galaxy, 'voidbloomGateDecline');
}

// ---------------------------------------------------------------------------------------------------------------
// The unequal-treaty terms (PeaceTerms.extra kinds)
// ---------------------------------------------------------------------------------------------------------------

const TERM_POINTS: Record<string, number> = {
    'voidbloom.legalise': 150,
    'voidbloom.inspection': 80,
    'voidbloom.toll': 120,
    'voidbloom.port': 150,
    'voidbloom.customs': 100,
};

function termText(t: ScenarioTerm): string {
    switch (t.kind) {
        case 'voidbloom.legalise':
            return scenarioText('Voidbloom Term Legalise', t.from.name, t.to.name);
        case 'voidbloom.inspection':
            return scenarioText('Voidbloom Term Inspection', t.from.name, t.to.name);
        case 'voidbloom.toll':
            return scenarioText('Voidbloom Term Toll', t.from.name, t.to.name);
        case 'voidbloom.port':
            return scenarioText('Voidbloom Term Port', t.colony?.name ?? '', t.to.name);
        case 'voidbloom.customs':
            return scenarioText('Voidbloom Term Customs', t.to.name, t.amount ?? 10, t.from.name);
        default:
            return t.kind;
    }
}

function applyTerm(galaxy: Galaxy, t: ScenarioTerm): void {
    if (!vbOn(galaxy)) return;
    const rec = vbEmpire(galaxy, t.to);
    const st = vbState(galaxy);
    switch (t.kind) {
        case 'voidbloom.legalise':
            rec.legalConcord = true;
            if (st.legalSince < 0) st.legalSince = galaxyStarDate(galaxy);
            break;
        case 'voidbloom.inspection':
            rec.inspectExempt = true;
            break;
        case 'voidbloom.toll':
            rec.tollExempt = true;
            break;
        case 'voidbloom.port':
            rec.treatyPort = t.colony ?? null;
            break;
        case 'voidbloom.customs':
            rec.tollCutPct = Math.max(rec.tollCutPct, t.amount ?? 10);
            break;
    }
}

for (const kind of Object.keys(TERM_POINTS)) {
    registerPeaceTermKind({
        kind,
        value: (g, t, e) => (t.to === e ? TERM_POINTS[t.kind] : t.from === e ? -TERM_POINTS[t.kind] : 0) * (vbOn(g) ? 1 : 0),
        describe: termText,
        sanitise: (g, t) => {
            const r = rimTraderEmpire(g);
            if (!vbOn(g) || r === null || t.from !== r || !isNormal(g, t.to)) return null;
            if (t.kind === 'voidbloom.port' && (t.colony == null || t.colony.empire !== r || t.colony.hasBeenDestroyed)) return null;
            return { kind: t.kind, from: t.from, to: t.to, colony: t.colony ?? null, amount: t.kind === 'voidbloom.customs' ? Math.min(25, Math.max(1, Math.round(t.amount ?? 10))) : undefined };
        },
        apply: applyTerm,
    });
}

/** The Concord's least valuable colony (never its capital): the "barren rock" a treaty cedes. Pure. */
export function barrenRock(galaxy: Galaxy, r: Empire): Habitat | null {
    let best: Habitat | null = null;
    let bv = Infinity;
    for (const h of r.colonies) {
        if (h.hasBeenDestroyed || h === r.capital || bloomWorldOf(galaxy, h) !== null) continue;
        const v = calculateWarValueHabitat(galaxy, h);
        if (v < bv || (v === bv && best !== null && h.habitatIndex < best.habitatIndex)) {
            bv = v;
            best = h;
        }
    }
    return best;
}

/** A treaty port: the Concord's most populous colony that is not its capital (else the capital). Pure. */
function treatyPortOf(galaxy: Galaxy, r: Empire, except: Habitat | null): Habitat | null {
    let best: Habitat | null = null;
    for (const h of r.colonies) {
        if (h.hasBeenDestroyed || h === except || h === r.capital || bloomWorldOf(galaxy, h) !== null) continue;
        if (best === null || (h.population?.totalAmount ?? 0) > (best.population?.totalAmount ?? 0)) best = h;
    }
    return best ?? r.capital;
}

/** The terms a smuggler at war with a declined Concord asks (extra terms within its budget; the barren rock first). */
export function unequalTerms(galaxy: Galaxy, victor: Empire, r: Empire, budget: number, withCede: boolean): { extra: ScenarioTerm[]; cede: Habitat | null; left: number } {
    const extra: ScenarioTerm[] = [];
    let left = budget;
    let cede: Habitat | null = null;
    if (withCede) {
        const rock = barrenRock(galaxy, r);
        if (rock !== null) {
            const p = Math.max(1, calculateWarValueHabitat(galaxy, rock)) * 1.5;
            if (p <= left || left > 300) {
                cede = rock;
                left -= p;
            }
        }
    }
    const port = treatyPortOf(galaxy, r, cede);
    const order: ScenarioTerm[] = [
        { kind: 'voidbloom.legalise', from: r, to: victor },
        { kind: 'voidbloom.port', from: r, to: victor, colony: port },
        { kind: 'voidbloom.toll', from: r, to: victor },
        { kind: 'voidbloom.inspection', from: r, to: victor },
        { kind: 'voidbloom.customs', from: r, to: victor, amount: 10 },
    ];
    for (const t of order) {
        const p = TERM_POINTS[t.kind];
        // Legalisation is the war's point: always asked.
        if (t.kind !== 'voidbloom.legalise' && p > left) continue;
        if (t.kind === 'voidbloom.port' && t.colony === null) continue;
        extra.push(t);
        left -= p;
    }
    return { extra, cede, left };
}

/** The peace dialog's extra terms the player may ask of the Concord in a Voidbloom war (empty otherwise). Pure. */
export function voidbloomTermChoices(galaxy: Galaxy, player: Empire, other: Empire): ScenarioTerm[] {
    const r = rimTraderEmpire(galaxy);
    if (!vbOn(galaxy) || r === null || other !== r || vbWarOf(galaxy, player) === null) return [];
    const port = treatyPortOf(galaxy, r, null);
    const out: ScenarioTerm[] = [{ kind: 'voidbloom.legalise', from: r, to: player }];
    if (port !== null) out.push({ kind: 'voidbloom.port', from: r, to: player, colony: port });
    out.push({ kind: 'voidbloom.toll', from: r, to: player }, { kind: 'voidbloom.inspection', from: r, to: player }, { kind: 'voidbloom.customs', from: r, to: player, amount: 10 });
    return out;
}

export function voidbloomTermText(t: ScenarioTerm): string {
    return termText(t);
}

registerPeaceTermsBuilder({
    id: 'voidbloom',
    build: (galaxy, proposer, target, t, budget) => {
        if (!vbOn(galaxy)) return budget;
        const r = rimTraderEmpire(galaxy);
        if (r === null || target !== r || vbWarOf(galaxy, proposer) === null || !concordGateOpen(galaxy)) return budget;
        const res = unequalTerms(galaxy, proposer, r, budget, !t.cede.some((c) => c.from === r));
        if (res.cede !== null) t.cede.push({ colony: res.cede, from: r, to: proposer });
        t.extra = [...(t.extra ?? []), ...res.extra];
        return Math.max(0, res.left);
    },
});

/** endWarAcceptance: before the gate opens the Concord never signs away territory or rights in a Voidbloom war. */
function warAcceptance(galaxy: Galaxy, v: boolean, a: { empire: Empire; other: Empire }): boolean {
    if (!v || !vbOn(galaxy)) return v;
    const r = rimTraderEmpire(galaxy);
    if (a.empire !== r || vbWarOf(galaxy, a.other) === null || concordGateOpen(galaxy)) return v;
    const st = galaxy.scenario?.state['warGoals'] as { offers?: Record<string, PeaceTerms> } | undefined;
    const offer = st?.offers?.[`${a.other.empireId}:${r.empireId}`] ?? null;
    if (offer === null) return v;
    const concedes = offer.cede.some((c) => c.from === r) || (offer.extra ?? []).some((x) => x.from === r) || (offer.reparations !== null && offer.reparations.payer === r);
    return concedes ? false : v;
}

/** warReviewAttitudeRelax: a smuggler under crackdown leans toward war as the Concord declines. Pure. */
function warRelax(galaxy: Galaxy, v: number, a: { empire: Empire; other: Empire }): number {
    if (!vbOn(galaxy) || a.other !== rimTraderEmpire(galaxy)) return v;
    const cd = crackdownOn(galaxy, a.empire);
    if (cd === null) return v;
    const rec = vbEmpire(galaxy, a.empire);
    return v + 5 + 15 * concordDeclineIndex(galaxy) + Math.min(10, rec.seizedUnits / 500);
}

// ---------------------------------------------------------------------------------------------------------------
// Signing: the treaty record (lively-galaxy's applyTerms, or the built-in treaty)
// ---------------------------------------------------------------------------------------------------------------

function recordTreaty(galaxy: Galaxy, victor: Empire, r: Empire, harsh: number, terms: string[], ceded: Habitat | null): void {
    const st = vbState(galaxy);
    const now = galaxyStarDate(galaxy);
    const treaty: VbTreaty = { victorId: victor.empireId, date: now, harsh, terms, branch: '', revancheAt: -1, secondWarAt: -1, reformSteps: 0, nextReformAt: -1, ceded, pretextUsed: false, looted: false };
    if (st.treaty === null) st.treaty = treaty;
    else if (st.treaty.victorId === victor.empireId) {
        st.treaty.terms = [...st.treaty.terms, ...terms];
        st.treaty.harsh += harsh;
    }
    st.stats.treaties++;
    scenarioNews(galaxy, null, scenarioText('Voidbloom Treaty News', r.name, victor.name, terms.join('; ')), () => true, null);
    addHistory(galaxy, scenarioText('Voidbloom History Treaty', r.name, victor.name, gameYear(now)));
}

/** Ends a Voidbloom war: 'treaty' (rights won), 'concord' (the Concord held: the smuggler backs down) or 'white'. */
function closeWar(galaxy: Galaxy, e: Empire, outcome: string): void {
    const w = vbWarOf(galaxy, e);
    if (w === null) return;
    w.end = galaxyStarDate(galaxy);
    w.outcome = outcome;
    const cd = crackdownOn(galaxy, e);
    const st = vbState(galaxy);
    if (cd !== null) {
        if (outcome === 'concord') {
            cd.status = 'backedDown';
            cd.until = w.end + 10 * YEAR_LENGTH;
            vbEmpire(galaxy, e).policy = 'legal';
        } else if (outcome === 'treaty') cd.status = 'ended';
        else cd.status = 'tolerated';
        cd.lastAction = w.end;
    }
    // A Concord victory in a later war takes the victor's rights back (the revanche succeeds).
    if (outcome === 'concord' && st.treaty !== null && st.treaty.victorId === e.empireId) {
        const rec = vbEmpire(galaxy, e);
        rec.legalConcord = rec.tollExempt = rec.inspectExempt = false;
        rec.treatyPort = null;
        rec.tollCutPct = 0;
        addHistory(galaxy, scenarioText('Voidbloom History Revanche Won', rimTraderEmpire(galaxy)?.name ?? '', e.name, gameYear(w.end)));
    }
}

registerPeaceAppliedListener((galaxy, t, a, b) => {
    if (!vbOn(galaxy)) return;
    const r = rimTraderEmpire(galaxy);
    if (r === null || (a !== r && b !== r)) return;
    const e = a === r ? b : a;
    if (vbWarOf(galaxy, e) === null) return;
    const ve = termsValueFor(galaxy, t, e);
    const won = ve > 0 && ((t.extra ?? []).some((x) => x.to === e) || t.cede.some((c) => c.to === e && c.from === r));
    if (won) {
        const lines: string[] = [];
        for (const c of t.cede) if (c.from === r) lines.push(scenarioText('Voidbloom Term Cede', r.name, c.colony.name, c.to.name));
        if (t.reparations !== null && t.reparations.payer === r) lines.push(scenarioText('Voidbloom Term Indemnity', fmt(t.reparations.lump), fmt(t.reparations.perYear), t.reparations.years));
        for (const x of t.extra ?? []) if (x.from === r) lines.push(termText(x));
        recordTreaty(galaxy, e, r, ve, lines, t.cede.find((c) => c.from === r)?.colony ?? null);
        closeWar(galaxy, e, 'treaty');
    } else closeWar(galaxy, e, termsValueFor(galaxy, t, r) > 0 ? 'concord' : 'white');
});

/** peaceSigned without War Goals: the built-in treaty (the barren rock, an indemnity in instalments, every right). */
function onPeaceSigned(galaxy: Galaxy, p: { empire: Empire; other: Empire }): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null || (p.empire !== r && p.other !== r)) return;
    const e = p.empire === r ? p.other : p.empire;
    const w = vbWarOf(galaxy, e);
    if (w === null) return; // closed by the applied-terms listener (War Goals on), or no Voidbloom war
    if (warGoalsOn(galaxy)) {
        closeWar(galaxy, e, 'white');
        return;
    }
    const winning = w.byEmpire > w.byConcord * 1.2;
    if (!winning || !concordGateOpen(galaxy)) {
        closeWar(galaxy, e, w.byConcord > w.byEmpire ? 'concord' : 'white');
        return;
    }
    imposeTreaty(galaxy, e, r);
}

/** The built-in unequal treaty (the barren rock, an indemnity in instalments, every right). */
function imposeTreaty(galaxy: Galaxy, e: Empire, r: Empire): void {
    const res = unequalTerms(galaxy, e, r, 600, true);
    const lines: string[] = [];
    if (res.cede !== null && res.cede.empire === r) {
        giveTradeableItem(galaxy, r, e, new TradeableItem(TradeableItemType.Colony, res.cede, 0), null);
        lines.push(scenarioText('Voidbloom Term Cede', r.name, res.cede.name, e.name));
    }
    const total = Math.floor(Math.min(Math.max(0, r.stateMoney) * 0.4, 1_500_000));
    const lump = Math.floor(total * 0.3);
    if (lump > 0) giveTradeableItem(galaxy, r, e, new TradeableItem(TradeableItemType.Money, lump, lump), null);
    const st = vbState(galaxy);
    const perYear = Math.floor((total - lump) / 5);
    if (perYear > 0) st.indemnity = { payerId: r.empireId, payeeId: e.empireId, perYear, yearsLeft: 5 };
    lines.push(scenarioText('Voidbloom Term Indemnity', fmt(lump), fmt(perYear), 5));
    for (const x of res.extra) {
        applyTerm(galaxy, x);
        lines.push(termText(x));
    }
    recordTreaty(galaxy, e, r, 600 + total / 25, lines, res.cede);
    closeWar(galaxy, e, 'treaty');
}

/**
 * The exhausted Concord sues for peace: past the gate, two years into a Voidbloom war against a smuggler with at least
 * 60 % of its strength (or ahead in the damage dealt), it signs the unequal treaty (the stock end of war, then the
 * built-in terms; peaceSigned follows for the other add-ons). The Opium War's logic: a declined power gives way.
 */
function concordSuesForPeace(galaxy: Galaxy): void {
    const r = rimTraderEmpire(galaxy);
    const st = vbState(galaxy);
    if (r === null || !concordGateOpen(galaxy)) return;
    const now = galaxyStarDate(galaxy);
    for (const w of [...st.wars]) {
        if (w.outcome !== '' || now - w.start < 2 * YEAR_LENGTH) continue;
        const e = empireById(galaxy, w.empireId);
        if (e === null || !e.active || !isNormal(galaxy, e)) continue;
        const rel = obtainDiplomaticRelation(e, r);
        if (rel.type !== DiplomaticRelationType.War) continue;
        const strong = militaryPotency(e) >= 0.6 * Math.max(1, militaryPotency(r)) || w.byEmpire > w.byConcord;
        if (!strong) continue;
        resetAttitudeLevelsAtEndOfWar(galaxy, rel, e);
        rel.type = DiplomaticRelationType.None;
        rel.lastDiplomacyTradeOfferDate = now;
        const rel2 = obtainDiplomaticRelation(r, e);
        rel2.type = DiplomaticRelationType.None;
        rel2.lastDiplomacyTradeOfferDate = now;
        processEndOfWarWithEmpire(galaxy, e, r);
        processEndOfWarWithEmpire(galaxy, r, e);
        imposeTreaty(galaxy, e, r);
        scenarioEmit(galaxy, 'peaceSigned', { empire: r, other: e });
        return;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// After the treaty: history events (yearly)
// ---------------------------------------------------------------------------------------------------------------

/** The aftermath weights (§4): base, the treaty's harshness H, the addiction index A, the Concord's colonies and money. Pure. */
export function aftermathWeights(galaxy: Galaxy, harsh: number): Record<AftermathBranch, number> {
    const r = rimTraderEmpire(galaxy);
    const A = concordAddiction(galaxy);
    const H = harsh >= vbParam(galaxy, 'voidbloomHarshPoints');
    const cols = r?.colonies.length ?? 0;
    const money = r?.stateMoney ?? 0;
    const victor = empireById(galaxy, vbState(galaxy).treaty?.victorId ?? -1);
    const strong = victor !== null && r !== null && militaryPotency(victor) > 3 * Math.max(1, militaryPotency(r));
    return {
        reform: Math.max(0, 30 + (H && A < 0.5 ? 15 : 0) - (cols <= 3 ? 15 : 0)),
        unrest: 25 + 25 * A + (H ? 10 : 0),
        client: 15 + (strong ? 15 : 0),
        opening: 10 + (A < 0.3 && money > rimParam(galaxy, 'rimTraderStartMoney') * 0.5 ? 10 : 0),
        collapse: 10 + (cols <= 4 || money < rimParam(galaxy, 'rimTraderNavyReserve') ? 20 : 0) + (H ? 5 : 0),
    };
}

const BRANCHES: readonly AftermathBranch[] = ['reform', 'unrest', 'client', 'opening', 'collapse'];

function drawBranch(galaxy: Galaxy, harsh: number): AftermathBranch {
    const w = aftermathWeights(galaxy, harsh);
    let total = 0;
    for (const b of BRANCHES) total += w[b];
    let x = galaxy.rnd.nextDouble() * total;
    for (const b of BRANCHES) {
        x -= w[b];
        if (x < 0) return b;
    }
    return 'reform';
}

function mostAddictedColony(galaxy: Galaxy, r: Empire): Habitat | null {
    const st = vbState(galaxy);
    let best: Habitat | null = null;
    let bv = -1;
    for (const h of r.colonies) {
        if (h.hasBeenDestroyed || h === r.capital) continue;
        const a = st.colonies[h.habitatIndex]?.a ?? 0;
        if (a > bv) {
            bv = a;
            best = h;
        }
    }
    return best;
}

function farthestColonies(r: Empire, n: number): Habitat[] {
    const cap = r.capital;
    if (cap === null) return [];
    return r.colonies
        .filter((h) => !h.hasBeenDestroyed && h !== cap)
        .sort((a, b) => (b.xpos - cap.xpos) ** 2 + (b.ypos - cap.ypos) ** 2 - ((a.xpos - cap.xpos) ** 2 + (a.ypos - cap.ypos) ** 2) || a.habitatIndex - b.habitatIndex)
        .slice(0, n);
}

function startBranch(galaxy: Galaxy, b: AftermathBranch): void {
    const st = vbState(galaxy);
    const t = st.treaty!;
    const r = rimTraderEmpire(galaxy);
    const victor = empireById(galaxy, t.victorId);
    const now = galaxyStarDate(galaxy);
    t.branch = b;
    if (r === null) return;
    scenarioNews(galaxy, null, scenarioText(`Voidbloom Branch ${b} News`, r.name, victor?.name ?? ''), () => true, null);
    addHistory(galaxy, scenarioText(`Voidbloom History Branch ${b}`, r.name, gameYear(now)));
    switch (b) {
        case 'reform': {
            // Self-Strengthening: the research cap rises a level every 5 years; a grudge that never fades; a revanche later.
            t.nextReformAt = now + 5 * YEAR_LENGTH;
            const lo = vbParam(galaxy, 'voidbloomRevancheMinYears');
            const hi = Math.max(lo, vbParam(galaxy, 'voidbloomRevancheMaxYears'));
            t.revancheAt = now + (lo + galaxy.rnd.nextDouble() * (hi - lo)) * YEAR_LENGTH;
            if (victor !== null) applyReputation(galaxy, r, victor, -40, { cause: 'voidbloom.treaty', labelKey: 'Voidbloom Reputation Treaty', source: 'voidbloom', decayPerYear: 0 });
            break;
        }
        case 'unrest': {
            // The zealot's civil war: the most addicted provinces rise under a prophet of the bloom.
            const seed = mostAddictedColony(galaxy, r);
            if (seed !== null) {
                const rebel = initiateEmpireSplitAt(galaxy, r, 0.35, true, seed);
                if (rebel !== null) {
                    rebel.name = scenarioText('Voidbloom Rebel Name');
                    rebel.leader?.addTrait(CharacterTraitType.Spiritual, false, galaxy);
                    if (rebel.leader !== null) rebel.leader.name = scenarioText('Voidbloom Zealot Name', rebel.leader.name);
                }
            }
            break;
        }
        case 'client':
            if (victor !== null && victor.active) {
                const rel = obtainDiplomaticRelation(victor, r);
                changeDiplomaticRelation(galaxy, victor, rel, DiplomaticRelationType.Protectorate);
            }
            break;
        case 'opening':
            st.opened = true;
            st.legalAll = now;
            if (st.legalSince < 0) st.legalSince = now;
            break;
        case 'collapse': {
            const n = 2 + galaxy.rnd.next(0, 2);
            for (const seed of farthestColonies(r, n)) if (seed.empire === r) initiateEmpireSplitAt(galaxy, r, 0.25, false, seed);
            break;
        }
    }
    if (b !== 'opening' && b !== 'client') {
        const y = vbParam(galaxy, 'voidbloomSecondWarYears');
        if (y > 0) t.secondWarAt = now + y * YEAR_LENGTH;
    }
}

function treatyYear(galaxy: Galaxy): void {
    const st = vbState(galaxy);
    concordSuesForPeace(galaxy);
    const t = st.treaty;
    const r = rimTraderEmpire(galaxy);
    const now = galaxyStarDate(galaxy);
    // The built-in treaty's indemnity instalments.
    if (st.indemnity !== null) {
        const payer = empireById(galaxy, st.indemnity.payerId);
        const payee = empireById(galaxy, st.indemnity.payeeId);
        if (payer !== null && payee !== null && payer.active && payee.active && st.indemnity.yearsLeft > 0) {
            const paid = Math.floor(Math.min(st.indemnity.perYear, Math.max(0, payer.stateMoney)));
            if (paid > 0) giveTradeableItem(galaxy, payer, payee, new TradeableItem(TradeableItemType.Money, paid, paid), null);
            st.indemnity.yearsLeft--;
        }
        if (st.indemnity.yearsLeft <= 0) st.indemnity = null;
    }
    if (r !== null) {
        st.concordPeak = Math.max(st.concordPeak ?? 0, r.stateMoney);
        st.declineNow = Math.round(concordDeclineIndex(galaxy) * 1000) / 1000;
    }
    // The gunboat moment: the Concord's frozen research falls two levels behind.
    if (r !== null && !st.gunboat && concordTechGap(galaxy) >= 2) {
        st.gunboat = true;
        scenarioNews(galaxy, r, scenarioText('Voidbloom Gunboat News', r.name), () => true, null);
        addHistory(galaxy, scenarioText('Voidbloom History Gunboat', r.name, gameYear(now)));
    }
    if (t === null || r === null) return;
    const victor = empireById(galaxy, t.victorId);
    if (t.branch === '') {
        startBranch(galaxy, drawBranch(galaxy, t.harsh));
        return;
    }
    // Foreign-run customs: a cut of the Concord's trade-house income.
    for (const e of normalEmpires(galaxy)) {
        const rec = st.empires[e.empireId];
        if (rec === undefined || rec.tollCutPct <= 0) continue;
        const cut = Math.floor((rimParam(galaxy, 'rimTraderTradeHouseIncome') * rec.tollCutPct) / 100);
        const paid = Math.min(cut, Math.max(0, r.stateMoney));
        if (paid > 0) {
            r.stateMoney -= paid;
            e.stateMoney += paid;
        }
    }
    // "Me too": strong empires that meet the Concord demand the victor's rights (most-favoured nation).
    if (victor !== null) {
        for (const e of normalEmpires(galaxy)) {
            if (e === r || e === victor) continue;
            const rec = vbEmpire(galaxy, e);
            if (rec.legalConcord || r.diplomaticRelations.byEmpire(e) === null) continue;
            if (militaryPotency(e) < 0.5 * Math.max(1, militaryPotency(r))) continue;
            rec.legalConcord = rec.tollExempt = rec.inspectExempt = true;
            st.stats.mfn++;
            scenarioNews(galaxy, e, scenarioText('Voidbloom MFN News', e.name, r.name), () => true, null);
        }
    }
    // Self-strengthening steps.
    if (t.branch === 'reform' && t.nextReformAt >= 0 && now >= t.nextReformAt) {
        const base = scenarioParam(galaxy, 'rimTraderResearchCap', 5) || 5;
        st.researchCap = Math.min(9, Math.max(st.researchCap, base) + 1);
        t.reformSteps++;
        t.nextReformAt = st.researchCap >= 9 ? -1 : now + 5 * YEAR_LENGTH;
    }
    // The revanche: the Concord goes to war to take back the treaty ports.
    if (t.revancheAt >= 0 && now >= t.revancheAt && victor !== null && victor.active) {
        t.revancheAt = -1;
        st.revanche = true;
        declareWar(galaxy, r, victor);
        scenarioNews(galaxy, r, scenarioText('Voidbloom Revanche News', r.name, victor.name), () => true, null);
    }
    // The pretext incident: years later, a seizure of the victor's ship gives it a reason for a second war.
    if (t.secondWarAt >= 0 && now >= t.secondWarAt && !t.pretextUsed && victor !== null && victor.active) {
        t.pretextUsed = true;
        grantCasusBelli(galaxy, victor, r);
        scenarioNews(galaxy, r, scenarioText('Voidbloom Pretext News', r.name, victor.name), () => true, null);
        addHistory(galaxy, scenarioText('Voidbloom History Pretext', victor.name, gameYear(now)));
        if (!isHuman(galaxy, victor) && militaryPotency(victor) >= 0.6 * Math.max(1, militaryPotency(r))) {
            st.secondWar = true;
            declareWar(galaxy, victor, r);
        }
    }
}

/** The second war's sack: war damage at the Concord's capital loots and burns its wonder (once). */
function onWarDamage(galaxy: Galaxy, p: { inflictor: Empire; victim: Empire; habitat: Habitat | null }): void {
    const st = peekVbState(galaxy);
    const t = st?.treaty ?? null;
    const r = rimTraderEmpire(galaxy);
    if (st === null || t === null || r === null || t.looted || p.victim !== r || p.inflictor.empireId !== t.victorId) return;
    if (p.habitat === null || p.habitat !== r.capital || !t.pretextUsed) return;
    t.looted = true;
    const loot = Math.floor(Math.max(0, r.stateMoney) * 0.1);
    r.stateMoney -= loot;
    p.inflictor.stateMoney += loot;
    scenarioNews(galaxy, p.inflictor, scenarioText('Voidbloom Loot News', p.inflictor.name, r.capital.name, fmt(loot)), () => true, r.capital);
    addHistory(galaxy, scenarioText('Voidbloom History Loot', r.capital.name, gameYear(galaxyStarDate(galaxy))));
}

// ---------------------------------------------------------------------------------------------------------------
// The barren rock grows into a trade hub; the burned wonder
// ---------------------------------------------------------------------------------------------------------------

function hubBonuses(galaxy: Galaxy, value: Habitat['resourceBonuses'], h: Habitat): Habitat['resourceBonuses'] {
    if (!vbOn(galaxy)) return value;
    const t = peekVbState(galaxy)?.treaty ?? null;
    if (t === null || t.ceded !== h || h.empire === null || h.empire.empireId !== t.victorId) return value;
    const years = (galaxyStarDate(galaxy) - t.date) / YEAR_LENGTH;
    const dev = Math.min(30, Math.round(2 * years));
    const income = Math.min(40, Math.round(3 * years));
    if (dev <= 0 && income <= 0) return value;
    return [...value, { resourceId: -1, effect: ColonyResourceEffect.Development, value: dev, appliesOnlyToSources: false }, { resourceId: -1, effect: ColonyResourceEffect.IncomeBoost, value: income, appliesOnlyToSources: false }];
}

function burnedWonder(galaxy: Galaxy, h: Habitat): number | null {
    const t = peekVbState(galaxy)?.treaty ?? null;
    const r = rimTraderEmpire(galaxy);
    return t !== null && t.looted && r !== null && h === r.capital ? -10 : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The Concord hooks (decline, branches, rights)
// ---------------------------------------------------------------------------------------------------------------

const H = concordHooks();
H.navyCapFactor = (g, f) => (vbOn(g) ? f * (1 - 0.5 * Math.max(concordAddiction(g), peekVbState(g)?.declineNow ?? 0)) : f);
H.researchCap = (g, cap) => {
    const st = vbOn(g) ? peekVbState(g) : null;
    if (st === null) return cap;
    if (st.opened) return 0;
    return st.researchCap > 0 ? Math.max(cap, st.researchCap) : cap;
};
H.normalised = (g) => vbOn(g) && peekVbState(g)?.opened === true;
H.warAllowed = (g, self, target) => {
    const st = vbOn(g) ? peekVbState(g) : null;
    return st !== null && st.revanche === true && target !== null && st.treaty !== null && target.empireId === st.treaty.victorId && self === rimTraderEmpire(g);
};
H.treatyAllowed = (g, self, other, type) => {
    const st = vbOn(g) ? peekVbState(g) : null;
    return st !== null && st.treaty !== null && st.treaty.branch === 'client' && other.empireId === st.treaty.victorId && type === DiplomaticRelationType.Protectorate;
};
H.capExempt = (g, h) => vbOn(g) && bloomWorldOf(g, h) !== null;
H.tradeGranted = (g, other) => {
    if (!vbOn(g)) return false;
    const rec = peekVbState(g)?.empires[other.empireId];
    return rec !== undefined && (rec.treatyPort !== null || rec.tollExempt) || dietOpenPorts(g, other);
};
H.tollExempt = (g, buyer) => vbOn(g) && (peekVbState(g)?.empires[buyer.empireId]?.tollExempt === true || dietOpenPorts(g, buyer));
H.portsOpen = (g, other) => vbOn(g) && (peekVbState(g)?.empires[other.empireId]?.treatyPort != null || dietOpenPorts(g, other));

/** The Diet's "Open the Concord's ports" law for this member (diet.ts fills the slot). */
export const openPortsSlot: { fn: ((galaxy: Galaxy, e: Empire) => boolean) | null } = { fn: null };
function dietOpenPorts(galaxy: Galaxy, e: Empire): boolean {
    return openPortsSlot.fn?.(galaxy, e) ?? false;
}

registerScenarioQuery({ id: 'voidbloom.accept', flag: VOIDBLOOM_FLAG, order: 10, query: 'endWarAcceptance', run: warAcceptance });
registerScenarioQuery({ id: 'voidbloom.relax', flag: VOIDBLOOM_FLAG, query: 'warReviewAttitudeRelax', run: warRelax });
registerScenarioQuery({ id: 'voidbloom.hub', flag: VOIDBLOOM_FLAG, query: 'colonyResourceBonuses', run: (g, v, a) => hubBonuses(g, v, a.habitat) });
registerStabilityTerm({ id: 'voidbloom.wonder', flag: VOIDBLOOM_FLAG, cause: 'voidbloomLoot', label: 'Wonder looted and burned', run: (g, h) => burnedWonder(g, h) });
registerScenarioEvent({ id: 'voidbloom.peace', flag: VOIDBLOOM_FLAG, event: 'peaceSigned', run: (g, p) => onPeaceSigned(g, p) });
registerScenarioEvent({ id: 'voidbloom.loot', flag: VOIDBLOOM_FLAG, event: 'warDamageInflicted', run: (g, p) => onWarDamage(g, p) });
registerScenarioYearly({ id: 'voidbloom.treaty', flag: VOIDBLOOM_FLAG, order: 43, run: (g) => treatyYear(g) });
void concord;
