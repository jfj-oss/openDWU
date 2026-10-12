// The Voidbloom War — the Interstellar Diet (docs/VOIDBLOOM_WAR.md §5, user decisions 5, 13, 15): the Concord sits and
// votes as a full member but never hosts nor holds the Regency; four motions of its own (registerDietMotionKind) —
// Ban Voidbloom, Open the Concord's Ports, a Diet-mediated treaty, and (after legalisation) Galactic Prohibition —
// plus sanction cases on smugglers and on the Concord (stock kinds) and the members' self-interested vote bias
// (registerCouncilExtension). With Characters & Victory's Diet off none of this runs (dietOn gates every path).
//
// Rnd: none.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { cautionLevel, changeDiplomaticRelation, friendlinessLevel } from '../../diplomacyTick';
import { TradeableItem, TradeableItemType, giveTradeableItem } from '../../tradeItems';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { scenarioText } from '../messages';
import { registerCouncilExtension, type Motion } from '../emergent/council';
import { dietCouncil, dietLawViolation } from '../charactersVictory/diet/diet';
import { dietMembership, inDiet } from '../charactersVictory/diet/dietAi';
import { registerScenarioEvent } from '../hooks';
import { dietOn, lawInForce, peekDietState, registerDietMotionKind, registerDietSeatExclusion, type DietKindCandidate, type DietState } from '../charactersVictory/diet/dietState';
import { rimParam, rimTraderEmpire, rimTraderStanding } from '../rimTrade/common';
import {
    addictionIndex,
    addHistory,
    crackdownOn,
    isNormal,
    peekVbState,
    policyOf,
    vbBanSlots,
    vbEmpire,
    vbOn,
    vbState,
    vbWarOf,
    fmt,
} from './common';
import { openPortsSlot } from './treaty';

const BAN = 'banVoidbloom';
const OPEN = 'openConcord';
const MEDIATE = 'dietTreaty';
const PROHIBIT = 'galacticProhibition';

function on(galaxy: Galaxy): boolean {
    return vbOn(galaxy) && dietOn(galaxy) && rimTraderEmpire(galaxy) !== null;
}

/** Voidbloom is a live issue: it has been sold into the Concord, or some colony is hooked. Pure. */
function live(galaxy: Galaxy): boolean {
    const st = peekVbState(galaxy);
    if (st === null) return false;
    if (st.arcStarted >= 0) return true;
    for (const k of Object.keys(st.colonies)) if (st.colonies[Number(k)].a >= 0.1) return true;
    return false;
}

function isMember(st: DietState | null, galaxy: Galaxy, e: Empire): boolean {
    void st;
    const c = dietCouncil(galaxy);
    return c !== null && inDiet(galaxy, c, e);
}

function members(galaxy: Galaxy): Empire[] {
    const c = dietCouncil(galaxy);
    return c === null ? [] : dietMembership(galaxy, c);
}

/** Voidbloom income per year of `e` (seller side). Pure. */
function income(galaxy: Galaxy, e: Empire): number {
    const st = peekVbState(galaxy);
    const rec = st?.empires[e.empireId];
    if (st === null || rec === undefined) return 0;
    const years = Math.max(1, (galaxyStarDate(galaxy) - st.startDate) / YEAR_LENGTH);
    return rec.sold / years;
}

function personality(e: Empire): { caution: number; friendly: number } {
    return { caution: (cautionLevel(e) - 100) / 50, friendly: (friendlinessLevel(e) - 100) / 50 };
}

/** Self-interest on a ban: hurt members for it, profiting ones against, a slight lean to the ban otherwise. Pure. */
function banScore(galaxy: Galaxy, voter: Empire): number {
    const r = rimTraderEmpire(galaxy);
    const p = personality(voter);
    let s = 5 + 60 * addictionIndex(galaxy, voter) + 8 * p.caution;
    if (voter === r) s += 40;
    s -= Math.min(60, income(galaxy, voter) / 4000);
    if (policyOf(galaxy, voter) === 'smuggle') s -= 25;
    return s;
}

function openScore(galaxy: Galaxy, voter: Empire): number {
    const r = rimTraderEmpire(galaxy);
    if (voter === r) return -100;
    const standing = rimTraderStanding(galaxy, voter.empireId);
    let s = 6 + Math.min(30, Math.max(0, -standing) / 1000) + 10 * personality(voter).friendly;
    if (standing >= rimParam(galaxy, 'rimTraderGrantThreshold')) s -= 25; // it profits from the closed system
    if ((peekVbState(galaxy)?.empires[voter.empireId]?.seizedUnits ?? 0) > 0) s += 15;
    return s;
}

const kindsLabel: Record<string, string> = {
    [BAN]: 'Ban Voidbloom',
    [OPEN]: "Open the Concord's ports",
    [MEDIATE]: 'Mediate the Voidbloom war',
    [PROHIBIT]: 'Galactic Prohibition',
};

registerDietMotionKind({
    kind: BAN,
    label: kindsLabel[BAN],
    needs: 'none',
    proposable: (g) => on(g) && lawInForce(peekDietState(g), BAN) === null,
    text: () => scenarioText('Voidbloom Diet Ban'),
    effect: () => 'Members ban Voidbloom: their freighters carry none and their colonies seize it; a member that smuggles it into another member breaks the law.',
    apply: (g, _st, _m, addLaw) => {
        addLaw(BAN, null, null, null, -1);
        vbState(g).stats.dietPassed++;
        addHistory(g, scenarioText('Voidbloom History Diet', kindsLabel[BAN]));
    },
    voteScore: (g, _st, voter, m) => (voter === m.proposer ? 100 : banScore(g, voter)),
    candidates: (g, st, a) => {
        if (!on(g) || !live(g) || lawInForce(st, BAN) !== null || lawInForce(st, PROHIBIT) !== null) return [];
        const s = banScore(g, a);
        return s >= 25 ? [{ kind: BAN, proposer: a, target: null, other: null, colony: null, resourceId: -1, weight: 20 + s / 2 }] : [];
    },
});

registerDietMotionKind({
    kind: OPEN,
    label: kindsLabel[OPEN],
    needs: 'none',
    proposable: (g) => on(g) && lawInForce(peekDietState(g), OPEN) === null,
    text: (g) => scenarioText('Voidbloom Diet Open', rimTraderEmpire(g)?.name ?? ''),
    effect: () => "Every member may trade at any Concord port regardless of standing and pays no toll on its rare goods (no cession, no legal Voidbloom).",
    apply: (g, _st, _m, addLaw) => {
        addLaw(OPEN, rimTraderEmpire(g), null, null, -1);
        vbState(g).stats.dietPassed++;
        addHistory(g, scenarioText('Voidbloom History Diet', kindsLabel[OPEN]));
    },
    voteScore: (g, _st, voter, m) => (voter === m.proposer ? 100 : openScore(g, voter)),
    candidates: (g, st, a) => {
        if (!on(g) || lawInForce(st, OPEN) !== null || a === rimTraderEmpire(g)) return [];
        const vb = peekVbState(g);
        if (vb === null || vb.crackdownStarted < 0) return [];
        const s = openScore(g, a);
        return s >= 20 ? [{ kind: OPEN, proposer: a, target: null, other: null, colony: null, resourceId: -1, weight: 18 + s / 2 }] : [];
    },
});

registerDietMotionKind({
    kind: MEDIATE,
    label: kindsLabel[MEDIATE],
    needs: 'empire',
    proposable: (g) => on(g) && (peekVbState(g)?.wars ?? []).some((w) => w.outcome === ''),
    text: (g, _st, m) => scenarioText('Voidbloom Diet Mediate', m.target?.name ?? '', rimTraderEmpire(g)?.name ?? ''),
    effect: () => 'A Diet treaty ends the Voidbloom war: a capped indemnity, no cession, the Concord keeps its inspections and Voidbloom stays banned.',
    apply: (g, _st, m) => {
        const r = rimTraderEmpire(g);
        const e = m.target;
        if (r === null || e === null || vbWarOf(g, e) === null) return;
        const rel = obtainDiplomaticRelation(e, r);
        if (rel.type === DiplomaticRelationType.War) changeDiplomaticRelation(g, e, rel, DiplomaticRelationType.Truce);
        const pay = Math.floor(Math.min(200_000, Math.max(0, r.stateMoney) * 0.05));
        if (pay > 0) giveTradeableItem(g, r, e, new TradeableItem(TradeableItemType.Money, pay, pay), null);
        const st = vbState(g);
        const w = vbWarOf(g, e);
        if (w !== null) {
            w.outcome = 'diet';
            w.end = galaxyStarDate(g);
        }
        const cd = crackdownOn(g, e);
        if (cd !== null) {
            cd.status = 'backedDown';
            cd.until = galaxyStarDate(g) + 10 * YEAR_LENGTH;
        }
        vbEmpire(g, e).policy = 'legal';
        st.stats.dietPassed++;
        addHistory(g, scenarioText('Voidbloom History Mediated', e.name, r.name, fmt(pay)));
    },
    voteScore: (g, _st, voter, m) => {
        const r = rimTraderEmpire(g);
        const p = personality(voter);
        if (voter === m.target) return -20 + 30 * p.caution;
        if (voter === r) return 20; // mediated terms beat an unequal treaty
        return 12 + 15 * p.friendly + 10 * p.caution;
    },
    candidates: (g, _st, a) => {
        if (!on(g)) return [];
        const out: DietKindCandidate[] = [];
        for (const w of peekVbState(g)?.wars ?? []) {
            if (w.outcome !== '' || galaxyStarDate(g) - w.start < YEAR_LENGTH) continue;
            const e = g.empires.find((x) => x !== null && x.empireId === w.empireId) ?? null;
            if (e === null || e === a) continue;
            out.push({ kind: MEDIATE, proposer: a, target: e, other: rimTraderEmpire(g), colony: null, resourceId: -1, weight: 32 + 10 * personality(a).friendly });
        }
        return out;
    },
});

registerDietMotionKind({
    kind: PROHIBIT,
    label: kindsLabel[PROHIBIT],
    needs: 'none',
    proposable: (g) => on(g) && (peekVbState(g)?.legalSince ?? -1) >= 0 && lawInForce(peekDietState(g), PROHIBIT) === null,
    text: () => scenarioText('Voidbloom Diet Prohibition'),
    effect: () => 'Voidbloom is banned galaxy-wide, the treaty legalisations included: every member bans it and only smugglers trade it.',
    apply: (g, _st, _m, addLaw) => {
        addLaw(PROHIBIT, null, null, null, -1);
        vbState(g).stats.dietPassed++;
        addHistory(g, scenarioText('Voidbloom History Diet', kindsLabel[PROHIBIT]));
    },
    voteScore: (g, _st, voter, m) => (voter === m.proposer ? 100 : banScore(g, voter) + 5),
    candidates: (g, st, a) => {
        const vb = peekVbState(g);
        if (!on(g) || vb === null || vb.legalSince < 0 || lawInForce(st, PROHIBIT) !== null) return [];
        if (galaxyStarDate(g) - vb.legalSince < 8 * YEAR_LENGTH) return [];
        const s = banScore(g, a);
        return s >= 22 ? [{ kind: PROHIBIT, proposer: a, target: null, other: null, colony: null, resourceId: -1, weight: 25 + s / 2 }] : [];
    },
});

/** Sanction cases (stock kinds): members hurt by the drug against the smugglers; members whose ships were seized against the Concord. */
function sanctionCandidates(galaxy: Galaxy): { kind: 'sanction'; proposer: Empire; target: Empire; other: Empire | null; resourceId: number; weight: number }[] {
    if (!on(galaxy)) return [];
    const r = rimTraderEmpire(galaxy)!;
    const st = vbState(galaxy);
    const out: { kind: 'sanction'; proposer: Empire; target: Empire; other: Empire | null; resourceId: number; weight: number }[] = [];
    const ms = members(galaxy);
    for (const a of [...ms].sort((x, y) => x.empireId - y.empireId)) {
        if (!isNormal(galaxy, a)) continue;
        const add = addictionIndex(galaxy, a);
        if (add >= 0.15 || a === r) {
            for (const e of ms) {
                if (e === a || !isNormal(galaxy, e) || policyOf(galaxy, e) !== 'smuggle' || (st.empires[e.empireId]?.sold ?? 0) <= 0) continue;
                out.push({ kind: 'sanction', proposer: a, target: e, other: null, resourceId: -1, weight: 30 + 60 * add + (a === r ? 15 : 0) });
            }
        }
        const seized = st.empires[a.empireId]?.seizedUnits ?? 0;
        if (a !== r && seized > 0 && policyOf(galaxy, a) !== 'smuggle' && ms.includes(r)) out.push({ kind: 'sanction', proposer: a, target: r, other: null, resourceId: -1, weight: 25 + Math.min(30, seized / 100) });
    }
    return out;
}

/** The members' self-interest on the stock kinds naming the Concord or a smuggler. Pure. */
function voteBias(galaxy: Galaxy, voter: Empire, m: Motion): number {
    if (!on(galaxy)) return 0;
    const r = rimTraderEmpire(galaxy);
    const hostile = m.kind === 'sanction' || m.kind === 'embargo' || m.kind === 'condemn';
    if (!hostile) return 0;
    const add = addictionIndex(galaxy, voter);
    if (m.target === r) {
        let s = (peekVbState(galaxy)?.empires[voter.empireId]?.seizedUnits ?? 0) > 0 ? 15 : 0;
        s -= 30 * add;
        if (policyOf(galaxy, voter) === 'smuggle') s += 15;
        return s;
    }
    if (m.target !== null && policyOf(galaxy, m.target) === 'smuggle' && (peekVbState(galaxy)?.empires[m.target.empireId]?.sold ?? 0) > 0) {
        let s = 40 * add + (voter === r ? 30 : 0);
        if (policyOf(galaxy, voter) === 'smuggle') s -= 25;
        return s;
    }
    return 0;
}

registerCouncilExtension({ id: 'voidbloom', candidates: (g) => sanctionCandidates(g), voteBias: (g, voter, m) => voteBias(g, voter, m) });
registerDietSeatExclusion((g, e) => vbOn(g) && e === rimTraderEmpire(g));

// The ban: a Diet member under Ban Voidbloom or Galactic Prohibition bans it (its own smuggling policy aside).
vbBanSlots.dietBan = (g, e) => {
    if (!on(g)) return false;
    const st = peekDietState(g);
    if (st === null || !isMember(st, g, e)) return false;
    return lawInForce(st, BAN) !== null || lawInForce(st, PROHIBIT) !== null;
};

/** Galactic Prohibition suspends every treaty legalisation. Pure. */
export function prohibitionInForce(galaxy: Galaxy): boolean {
    return on(galaxy) && lawInForce(peekDietState(galaxy), PROHIBIT) !== null;
}
vbBanSlots.prohibition = prohibitionInForce;

/** A member smuggling into another member's market under a Diet ban breaks the law (once a year per offender). */
const lastViolation = new WeakMap<Galaxy, Map<number, number>>();
registerScenarioEvent({
    id: 'voidbloom.diet.violation',
    flag: 'voidbloom',
    event: 'contractInitiated',
    run: (g, p) => {
        if (!on(g) || p.buyer === null || p.seller === p.buyer || !isNormal(g, p.seller)) return;
        const vb = peekVbState(g);
        if (vb === null) return;
        const id = g.resourceSystem.resources.find((x) => x.name === 'Voidbloom')?.resourceId ?? -1;
        if (p.resourceId !== id) return;
        const st = peekDietState(g);
        const law = lawInForce(st, PROHIBIT) ?? lawInForce(st, BAN);
        if (law === null || !isMember(st, g, p.seller) || !isMember(st, g, p.buyer)) return;
        const rec = vbEmpire(g, p.seller);
        const now = galaxyStarDate(g);
        if (rec.lastViolation !== undefined && now - rec.lastViolation < YEAR_LENGTH) return;
        rec.lastViolation = now;
        dietLawViolation(g, p.seller, law);
    },
});
void lastViolation;

openPortsSlot.fn = (g, e) => {
    if (!on(g)) return false;
    const st = peekDietState(g);
    return st !== null && lawInForce(st, OPEN) !== null && isMember(st, g, e) && e !== rimTraderEmpire(g);
};
