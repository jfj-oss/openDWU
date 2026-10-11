// Colony Economy: state bonds sold to the empire's own private sector (docs/ECONOMY.md §4). Not a port: DW:U has no
// state debt (a negative StateMoney simply stays negative; the AI's budget rules react to it). Here, when the treasury
// runs low, the state borrows from Empire.PrivateMoney and repays monthly instalments (an annuity: principal +
// interest) from the treasury back into private money. Limits keep it from being abused:
//   - outstanding principal ≤ econBondCapPct % of the annual tax revenue; at most MAX_BONDS bonds; one issue per
//     ISSUE_GAP_DAYS; a bond takes at most econBondPrivateSharePct % of the private surplus (facilities.ts privateSurplus);
//   - the yearly instalments of every bond together ≤ MAX_SERVICE_SHARE of the tax revenue;
//   - arrears (instalments the treasury could not pay) worth more than DEFAULT_MONTHS instalments are a default: the
//     bonds are written off (the private sector loses them), every colony takes a DEFAULT_APPROVAL approval term for
//     DEFAULT_PENALTY_YEARS (the stability ledger, cause "bonds"), and no new bond is sold for NO_ISSUE_YEARS.
// Rate: econBondRatePct − 1.5 points per Investment Bank (at most −4) + 2 when the debt is over half the cap + 2 with
// arrears; never below MIN_RATE_PCT.
// No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { galaxyStarDate } from '../../tick/simTime';
import { annualTaxRevenue, annualFacilityMaintenance } from '../../forceStructure';
import { annualStateMaintenanceExcludingUnderConstruction, calculateAnnualCashflow } from '../../treasury';
import { annualTroopMaintenance } from '../../troops';
import { isHumanEmpire } from '../../humanEmpires';
import { registerScenarioPeriodic } from '../hooks';
import { registerStabilityTerm } from '../stability';
import { DAY, ECON_BOND_FLAG, ECON_FLAG, YEAR, econOn, econParam, empireRecord, hasPrivateSector, peekEmpire, type Bond, type EconEmpire } from './common';
import { investmentBankCount, privateSurplus } from './facilities';

export const BOND_RULES = {
    MAX_BONDS: 4,
    ISSUE_GAP_DAYS: 180,
    MIN_BOND: 5000,
    MAX_SERVICE_SHARE: 0.3,
    DEFAULT_MONTHS: 12,
    DEFAULT_APPROVAL: -5,
    DEFAULT_PENALTY_YEARS: 3,
    NO_ISSUE_YEARS: 5,
    MIN_RATE_PCT: 2,
    BANK_DISCOUNT_PCT: 1.5,
    BANK_DISCOUNT_MAX_PCT: 4,
    /** The AI (or the player's automatic bonds) borrows when the treasury is below this many months of state expenses. */
    LOW_MONTHS: 1.5,
    /** ...unless the yearly cashflow is this many months of expenses in the red (borrowing would only delay a default). */
    DEFICIT_MONTHS: 3,
    /** ...and borrows up to this many months' worth. */
    TARGET_MONTHS: 4,
    /** Instalment period (game days). */
    PERIOD_DAYS: 30,
};

/** Annual state expenses (maintenance, troops, facilities). Pure. */
export function annualStateExpenses(galaxy: Galaxy, e: Empire): number {
    void galaxy;
    return annualStateMaintenanceExcludingUnderConstruction(e) + annualTroopMaintenance(e) + annualFacilityMaintenance(e);
}

/** The rate a new bond would carry now (fraction a year). Pure. */
export function bondRate(galaxy: Galaxy, e: Empire): number {
    let pct = econParam(galaxy, 'econBondRatePct');
    pct -= Math.min(BOND_RULES.BANK_DISCOUNT_MAX_PCT, BOND_RULES.BANK_DISCOUNT_PCT * investmentBankCount(galaxy, e));
    const r = peekEmpire(galaxy, e);
    const cap = bondCap(galaxy, e);
    if (r !== null && cap > 0 && outstanding(r) > cap / 2) pct += 2;
    if (r !== null && r.arrears > 0) pct += 2;
    return Math.max(BOND_RULES.MIN_RATE_PCT, pct) / 100;
}

/** The most principal the empire may owe (econBondCapPct % of its annual tax revenue). Pure. */
export function bondCap(galaxy: Galaxy, e: Empire): number {
    return Math.max(0, (annualTaxRevenue(galaxy, e) * econParam(galaxy, 'econBondCapPct')) / 100);
}

export function outstanding(r: EconEmpire | null): number {
    if (r === null) return 0;
    let s = 0;
    for (const b of r.bonds) s += b.outstanding;
    return s;
}

/** Instalment per period of a bond (annuity on its original terms). */
export function instalment(b: Bond): number {
    const n = Math.max(1, Math.round((b.maturity - b.issued) / (BOND_RULES.PERIOD_DAYS * DAY)));
    const i = (b.rate * BOND_RULES.PERIOD_DAYS) / 360;
    if (i <= 0) return b.principal / n;
    return (b.principal * i) / (1 - Math.pow(1 + i, -n));
}

/** Yearly debt service of every bond. */
export function annualService(r: EconEmpire | null): number {
    if (r === null) return 0;
    let s = 0;
    for (const b of r.bonds) s += instalment(b) * (360 / BOND_RULES.PERIOD_DAYS);
    return s;
}

export interface BondQuote {
    /** The most a new bond may raise now (0: none). */
    max: number;
    rate: number;
    termYears: number;
    /** Why not (null: a bond may be sold). */
    refusal: string | null;
}

/** What a new bond could raise now and why not. Pure. */
export function bondQuote(galaxy: Galaxy, e: Empire): BondQuote {
    const rate = bondRate(galaxy, e);
    const termYears = econParam(galaxy, 'econBondTermYears');
    const q = (max: number, refusal: string | null): BondQuote => ({ max: Math.max(0, Math.floor(max)), rate, termYears, refusal });
    if (!econOn(galaxy, ECON_BOND_FLAG)) return q(0, 'Bonds are off');
    if (!hasPrivateSector(galaxy, e)) return q(0, 'This government has no private sector to borrow from');
    const r = peekEmpire(galaxy, e);
    const now = galaxyStarDate(galaxy);
    if (r !== null && now - r.defaultedAt < BOND_RULES.NO_ISSUE_YEARS * YEAR) return q(0, 'No lender will buy your bonds after the default');
    if (r !== null && r.bonds.length >= BOND_RULES.MAX_BONDS) return q(0, `At most ${BOND_RULES.MAX_BONDS} bonds outstanding`);
    if (r !== null && now - r.lastIssue < BOND_RULES.ISSUE_GAP_DAYS * DAY) return q(0, `One bond every ${BOND_RULES.ISSUE_GAP_DAYS} days`);
    const tax = annualTaxRevenue(galaxy, e);
    const roomCap = bondCap(galaxy, e) - outstanding(r);
    if (roomCap < BOND_RULES.MIN_BOND) return q(0, 'Debt limit reached (outstanding debt ≤ the annual tax revenue)');
    // Service room: yearly instalments of all bonds ≤ MAX_SERVICE_SHARE of the tax revenue.
    const serviceRoom = BOND_RULES.MAX_SERVICE_SHARE * tax - annualService(r);
    const perUnit = annuityPerYear(rate, termYears);
    const roomService = perUnit > 0 ? serviceRoom / perUnit : 0;
    const roomPrivate = (privateSurplus(galaxy, e) * econParam(galaxy, 'econBondPrivateSharePct')) / 100;
    const max = Math.min(roomCap, roomService, roomPrivate);
    if (max < BOND_RULES.MIN_BOND) return q(0, roomPrivate < BOND_RULES.MIN_BOND ? 'The private sector has no money to lend' : 'Repayments would take too much of the tax revenue');
    return q(max, null);
}

/** Yearly payment per credit borrowed at `rate` over `years` (monthly annuity). */
function annuityPerYear(rate: number, years: number): number {
    const n = Math.max(1, Math.round((years * 360) / BOND_RULES.PERIOD_DAYS));
    const i = (rate * BOND_RULES.PERIOD_DAYS) / 360;
    const per = i <= 0 ? 1 / n : i / (1 - Math.pow(1 + i, -n));
    return per * (360 / BOND_RULES.PERIOD_DAYS);
}

/** Sells a bond of `amount` (clamped to the quote). Returns the bond or null (refused / too small). */
export function issueBond(galaxy: Galaxy, e: Empire, amount: number): Bond | null {
    const q = bondQuote(galaxy, e);
    if (q.refusal !== null) return null;
    const a = Math.floor(Math.min(amount, q.max));
    if (!(a >= BOND_RULES.MIN_BOND)) return null;
    const r = empireRecord(galaxy, e);
    const now = galaxyStarDate(galaxy);
    const b: Bond = { id: r.nextBondId++, principal: a, outstanding: a, rate: q.rate, issued: now, maturity: now + q.termYears * YEAR, paid: 0, missed: 0, interestPaid: 0 };
    r.bonds.push(b);
    r.lastIssue = now;
    r.borrowedTotal += a;
    e.privateMoney -= a;
    e.stateMoney += a;
    return b;
}

/** Repays a bond early in full (principal outstanding, no penalty). False when the treasury cannot. */
export function repayBond(galaxy: Galaxy, e: Empire, bondId: number): boolean {
    if (!econOn(galaxy, ECON_BOND_FLAG)) return false;
    const r = peekEmpire(galaxy, e);
    const b = r?.bonds.find((x) => x.id === bondId);
    if (r === null || r === undefined || b === undefined) return false;
    if (e.stateMoney < b.outstanding) return false;
    e.stateMoney -= b.outstanding;
    e.privateMoney += b.outstanding;
    r.repaidTotal += b.outstanding;
    b.outstanding = 0;
    r.bonds = r.bonds.filter((x) => x !== b);
    return true;
}

/** Player setting (journaled): the state sells bonds by itself when the treasury runs low. */
export function setAutoBonds(galaxy: Galaxy, e: Empire, on: boolean): boolean {
    if (!econOn(galaxy, ECON_BOND_FLAG) || !hasPrivateSector(galaxy, e)) return false;
    empireRecord(galaxy, e).autoBonds = on;
    return true;
}

/** One instalment period: pay what is due (arrears first), default when the arrears grow too large. */
function serviceBonds(galaxy: Galaxy, e: Empire, r: EconEmpire): void {
    if (r.bonds.length === 0 && r.arrears === 0) return;
    const now = galaxyStarDate(galaxy);
    let due = r.arrears;
    const parts: { b: Bond; interest: number; principal: number }[] = [];
    for (const b of r.bonds) {
        const i = (b.rate * BOND_RULES.PERIOD_DAYS) / 360;
        const interest = b.outstanding * i;
        const pay = Math.min(instalment(b), b.outstanding + interest);
        parts.push({ b, interest, principal: Math.max(0, pay - interest) });
        due += pay;
    }
    if (e.stateMoney >= due) {
        e.stateMoney -= due;
        e.privateMoney += due;
        r.repaidTotal += due;
        for (const p of parts) {
            p.b.outstanding = Math.max(0, p.b.outstanding - p.principal);
            p.b.interestPaid += p.interest;
            r.interestTotal += p.interest;
            p.b.paid++;
        }
        r.arrears = 0;
    } else {
        // Missed: the instalments (with their interest) carry over; what the treasury holds pays part of the arrears.
        const part = Math.max(0, Math.floor(e.stateMoney));
        e.stateMoney -= part;
        e.privateMoney += part;
        r.repaidTotal += part;
        r.arrears = due - part;
        for (const p of parts) {
            p.b.missed++;
            p.b.outstanding = Math.max(0, p.b.outstanding - p.principal);
            p.b.interestPaid += p.interest;
            r.interestTotal += p.interest;
        }
        const monthly = parts.reduce((s, p) => s + p.interest + p.principal, 0);
        if (monthly > 0 && r.arrears > BOND_RULES.DEFAULT_MONTHS * monthly) {
            // Default: the private sector loses what is owed.
            r.bonds = [];
            r.arrears = 0;
            r.defaultedAt = now;
            return;
        }
    }
    r.bonds = r.bonds.filter((b) => b.outstanding > 0.5 && now < b.maturity + 30 * DAY);
}

/** Whether the empire's treasury is low enough to borrow (AI / automatic bonds). Pure. */
export function treasuryLow(galaxy: Galaxy, e: Empire): boolean {
    const monthly = annualStateExpenses(galaxy, e) / 12;
    return monthly > 0 && e.stateMoney < BOND_RULES.LOW_MONTHS * monthly;
}

function maybeBorrow(galaxy: Galaxy, e: Empire, r: EconEmpire | null): void {
    const auto = !isHumanEmpire(galaxy, e) || (r?.autoBonds ?? false);
    if (!auto || !treasuryLow(galaxy, e)) return;
    const monthly = annualStateExpenses(galaxy, e) / 12;
    if (calculateAnnualCashflow(galaxy, e) < -BOND_RULES.DEFICIT_MONTHS * monthly) return;
    const want = BOND_RULES.TARGET_MONTHS * monthly - e.stateMoney;
    if (want < BOND_RULES.MIN_BOND) return;
    issueBond(galaxy, e, want);
}

function bondsTick(galaxy: Galaxy): void {
    for (const e of galaxy.empires) {
        if (!hasPrivateSector(galaxy, e)) continue;
        const r = peekEmpire(galaxy, e);
        if (r !== null) serviceBonds(galaxy, e, r);
        maybeBorrow(galaxy, e, r);
    }
}

registerScenarioPeriodic({ id: 'colonyEconomy.bonds', flag: ECON_FLAG, periodDays: BOND_RULES.PERIOD_DAYS, run: (g) => econOn(g, ECON_BOND_FLAG) && bondsTick(g) });

// A default costs approval at every colony for a few years (the stability ledger).
registerStabilityTerm({
    id: 'colonyEconomy.bondDefault',
    flag: ECON_FLAG,
    cause: 'bonds',
    label: 'Defaulted on bonds',
    run: (galaxy: Galaxy, h: Habitat, e: Empire | null) => {
        if (e === null || !econOn(galaxy, ECON_BOND_FLAG)) return null;
        const r = peekEmpire(galaxy, e);
        if (r === null || r.defaultedAt < 0) return null;
        return galaxyStarDate(galaxy) - r.defaultedAt < BOND_RULES.DEFAULT_PENALTY_YEARS * YEAR ? BOND_RULES.DEFAULT_APPROVAL : null;
    },
});

/** The treasury view's rows (UI). Pure. */
export interface BondView {
    bonds: { id: number; principal: number; outstanding: number; ratePct: number; instalment: number; paymentsLeft: number; maturity: number; missed: number }[];
    outstanding: number;
    arrears: number;
    annualService: number;
    interestPaid: number;
    borrowedTotal: number;
    repaidTotal: number;
    cap: number;
    quote: BondQuote;
    autoBonds: boolean;
    defaulted: boolean;
}

export function bondView(galaxy: Galaxy, e: Empire): BondView {
    const r = peekEmpire(galaxy, e);
    const now = galaxyStarDate(galaxy);
    return {
        bonds: (r?.bonds ?? []).map((b) => ({
            id: b.id,
            principal: b.principal,
            outstanding: b.outstanding,
            ratePct: b.rate * 100,
            instalment: instalment(b),
            paymentsLeft: Math.max(0, Math.ceil((b.maturity - now) / (BOND_RULES.PERIOD_DAYS * DAY))),
            maturity: b.maturity,
            missed: b.missed,
        })),
        outstanding: outstanding(r),
        arrears: r?.arrears ?? 0,
        annualService: annualService(r),
        interestPaid: r?.interestTotal ?? 0,
        borrowedTotal: r?.borrowedTotal ?? 0,
        repaidTotal: r?.repaidTotal ?? 0,
        cap: bondCap(galaxy, e),
        quote: bondQuote(galaxy, e),
        autoBonds: r?.autoBonds ?? false,
        defaulted: r !== null && r.defaultedAt >= 0 && now - r.defaultedAt < BOND_RULES.NO_ISSUE_YEARS * YEAR,
    };
}
