// The Beacon, part 9: war credit in the Galactic Diet (Giantworks wonder, flag gwBeacon, Characters & Victory's Diet on). Not a port.
//
//   THE TALLY  while the Reclamation is at war (warOn), every empire keeps a "share of the war": points for the Reclaimer warships its ships destroyed
//              (by strength, against the average ship), capital ships (destroyed or captured), Watchers (killed or captured), harvesters, foundries
//              (beaconFoundry.ts foundryDestroyed), harvest cores retaken, the people freed (cattle ship boarded, pens opened), the refugees its
//              relocation transports brought to safety (beaconRelocation.ts relocationArrive) and cattle ships killed. Credit goes to the empire whose
//              ship made the kill / the capture (the same rule as the mega-station parts, beaconComponents.ts). Saved in BeaconState.warCredit.
//              A freighter of the Severance that arrives with an escort within megaEscortNear (any empire's) is an escorted delivery: a small item
//              for the escort's owner (megaEscort.ts).
//   THE DIET   once a year (beaconWarCreditReviewDays) the Diet reviews the tally of its members: the top beaconWarCreditTopN contributors get a vote
//              weight bonus (dietVoteWeightFactor) for the year and a reputation gain with every other member (reputation/ledger.ts applyReputation);
//              a member far below its share of the war, measured against its share of the members' military, loses a little weight and standing.
//              A news line names the top contributor. The AI coalition (beaconAi.ts) lets a lagging member commit more of its fleet (warCreditAiFactor).
// Rnd: none.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText as T } from '../../messages';
import { scenarioFlag, scenarioParam } from '../../state';
import { applyReputation } from '../../reputation/ledger';
import { dietCouncil } from '../../charactersVictory/diet/diet';
import { dietMembership } from '../../charactersVictory/diet/dietAi';
import { dietOn, dietWarCreditLine, peekDietState } from '../../charactersVictory/diet/dietState';
import { BEACON_FLAG, peekBeaconState, warOn, type BeaconState } from './beaconState';
import { cattleOf, liveCores } from './beaconHarvest';
import { strengthOf } from './beaconFleet';

const TAG = 'Beacon';

export type WarCreditKind = 'warships' | 'capitals' | 'watchers' | 'harvesters' | 'foundries' | 'depots' | 'cores' | 'freed' | 'refugees' | 'cattle' | 'escorts';
export const WAR_CREDIT_KINDS: readonly WarCreditKind[] = ['warships', 'capitals', 'watchers', 'harvesters', 'foundries', 'depots', 'cores', 'freed', 'refugees', 'cattle', 'escorts'];

export const WAR_CREDIT_LABEL: Record<Exclude<WarCreditKind, 'escorts'>, string> = {
    warships: 'warships',
    capitals: 'capital ships',
    watchers: 'Watchers',
    harvesters: 'harvesters',
    foundries: 'foundries',
    depots: 'biofuel depots',
    cores: 'cores retaken',
    freed: 'people freed',
    refugees: 'refugees saved',
    cattle: 'cattle ships',
};

/** The Knowledge page's name for a kind (the escorted deliveries' name is a GameText line). */
export function warCreditLabel(k: WarCreditKind): string {
    return k === 'escorts' ? T(`${TAG} War Credit Escorts`) : WAR_CREDIT_LABEL[k];
}

/** An empire's standing from the last review: the vote weight change (%) and what it was for. */
export interface WarCreditEffect {
    votePct: number;
    /** 'top' (rank 1..), 'slack', or '' (none). */
    why: 'top' | 'slack';
    rank: number;
}

/** The war-credit record (BeaconState.warCredit; plain data keyed by empire id). */
export interface WarCreditRec {
    /** Empire id → points by kind. */
    points: Record<string, Partial<Record<WarCreditKind, number>>>;
    /** Empire id → the standing in force until the next review. */
    effect: Record<string, WarCreditEffect>;
    /** Star date of the last review (0: the war's first pass has not run). */
    lastReview: number;
    /** Empire id of the top contributor at the last review (-1: none). */
    top: number;
    reviews: number;
}

/** The weights and limits (scenario params; defaults here). */
export const WC = {
    reviewDays: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditReviewDays', 360),
    /** Points: one Reclaimer warship of average strength (scaled by strength / average, 0.2 to 6 times), a capital ship, a Watcher, a harvester, a foundry, a core retaken, a cattle ship; per million people freed / refugees saved. */
    warship: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditWarship', 1),
    capital: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditCapital', 20),
    watcher: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditWatcher', 40),
    harvester: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditHarvester', 15),
    foundry: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditFoundry', 30),
    /** A biofuel depot destroyed (beaconDepot.ts). */
    depot: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditDepot', 10),
    core: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditCore', 30),
    cattle: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditCattle', 3),
    /** A freighter of the Severance delivered under an escort (megaEscort.ts): a small item. */
    escort: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditEscort', 1),
    freedPerMillion: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditFreedPerMillion', 1),
    refugeesPerMillion: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditRefugeesPerMillion', 0.5),
    /** The review needs this many points in all, and credits this many top contributors (each also needs beaconWarCreditTopMinSharePct % of the total). */
    minTotal: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditMinTotal', 30),
    topN: (g: Galaxy) => Math.max(0, Math.trunc(scenarioParam(g, 'beaconWarCreditTopN', 3))),
    topMinSharePct: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditTopMinSharePct', 10),
    /** Diet vote weight bonus (%) of the top contributor; the next ones get 2/3 and 1/3 of it. */
    votePct: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditVotePct', 15),
    /** Reputation every other member gains toward the top contributor (the next ones 1/2 and 1/4). */
    repTop: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditRepTop', 4),
    /** A member is a slacker when its share of the war is under this % of its share of the members' military (and that share is at least beaconWarCreditSlackMinMilPct %). */
    slackRatioPct: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditSlackRatioPct', 30),
    slackMinMilPct: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditSlackMinMilPct', 5),
    slackVotePct: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditSlackVotePct', 5),
    slackRep: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditSlackRep', 2),
    /** The AI coalition lets a lagging member commit this many % more of its fleet. */
    aiLagPct: (g: Galaxy) => scenarioParam(g, 'beaconWarCreditAiLagPct', 25),
};

function on(g: Galaxy): boolean {
    return scenarioFlag(g, BEACON_FLAG) && dietOn(g);
}

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

/** The record (created on first use). */
export function warCreditOf(st: BeaconState): WarCreditRec {
    return (st.warCredit ??= { points: {}, effect: {}, lastReview: 0, top: -1, reviews: 0 });
}

/** Whether credit is being kept now: the Beacon flag, the Diet and the Reclaimers at war. Pure. */
export function warCreditActive(g: Galaxy, st: BeaconState | null): st is BeaconState {
    return st !== null && st.faction !== null && on(g) && warOn(st);
}

function creditable(g: Galaxy, st: BeaconState, e: Empire | null): e is Empire {
    return e !== null && e !== st.faction && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

/** Adds `amount` points of `kind` to `e` (nothing unless credit is kept and `e` is a normal empire). */
export function warCreditAdd(g: Galaxy, st: BeaconState, e: Empire | null, kind: WarCreditKind, amount: number): void {
    if (!(amount > 0) || !warCreditActive(g, st) || !creditable(g, st, e)) return;
    const rec = warCreditOf(st);
    const mine = (rec.points[String(e.empireId)] ??= {});
    mine[kind] = (mine[kind] ?? 0) + amount;
}

/** The total points of an empire. Pure. */
export function warCreditTotal(st: BeaconState, e: Empire): number {
    const m = st.warCredit?.points[String(e.empireId)];
    if (m === undefined) return 0;
    let t = 0;
    for (const k of WAR_CREDIT_KINDS) t += m[k] ?? 0;
    return t;
}

// ---------------------------------------------------------------------------------------------------------------
// The credit hooks (beacon.ts onKilledBy / onBoarded, beaconHarvest.ts, beaconRelocation.ts, the foundryDestroyed event)
// ---------------------------------------------------------------------------------------------------------------

/** A Watcher was destroyed or captured by `by`. */
export function warCreditWatcher(g: Galaxy, st: BeaconState, by: Empire | null): void {
    warCreditAdd(g, st, by, 'watchers', WC.watcher(g));
}

/** A Reclaimer capital ship was captured by `by` (a destroyed one goes through warCreditKilled). */
export function warCreditCapturedCapital(g: Galaxy, st: BeaconState, by: Empire | null): void {
    warCreditAdd(g, st, by, 'capitals', WC.capital(g));
}

/**
 * A ship of the Reclaimers was destroyed by `destroyer` (call from the kill hook before the pools forget it): a harvester, a capital ship, a cattle
 * ship or a warship (by strength against the average ship; the Beacon, bases, freighters and troopers count for nothing).
 */
export function warCreditKilled(g: Galaxy, st: BeaconState, bo: BuiltObject, destroyer: Empire | null): void {
    if (!warCreditActive(g, st) || !creditable(g, st, destroyer) || bo === st.beacon) return;
    if (liveCores(st).some((c) => c.harvester === bo)) return warCreditAdd(g, st, destroyer, 'harvesters', WC.harvester(g));
    if (bo.subRole === BuiltObjectSubRole.CapitalShip) return warCreditAdd(g, st, destroyer, 'capitals', WC.capital(g));
    if (cattleOf(st).some((c) => c.ship === bo)) return warCreditAdd(g, st, destroyer, 'cattle', WC.cattle(g));
    if (bo.role !== BuiltObjectRole.Military || !(bo.topSpeed > 0)) return;
    const unit = Math.max(1, st.parts?.shipUnit ?? 0);
    warCreditAdd(g, st, destroyer, 'warships', WC.warship(g) * Math.max(0.2, Math.min(6, strengthOf(bo) / unit)));
}

/** A foundry was destroyed by `empire`. */
export function warCreditFoundry(g: Galaxy, st: BeaconState, empire: Empire | null): void {
    warCreditAdd(g, st, empire, 'foundries', WC.foundry(g));
}

/** A biofuel depot was destroyed by `empire`. */
export function warCreditDepot(g: Galaxy, st: BeaconState, empire: Empire | null): void {
    warCreditAdd(g, st, empire, 'depots', WC.depot(g));
}

/** A harvest core was retaken by `by`, with `freed` people released from its pens. */
export function warCreditCore(g: Galaxy, st: BeaconState, by: Empire | null, freed: number): void {
    warCreditAdd(g, st, by, 'cores', WC.core(g));
    warCreditPeople(g, st, by, freed);
}

/** `people` were freed by `by` (a cattle ship boarded, pens opened). */
export function warCreditPeople(g: Galaxy, st: BeaconState, by: Empire | null, people: number): void {
    warCreditAdd(g, st, by, 'freed', (people / 1e6) * WC.freedPerMillion(g));
}

/** A cattle ship was boarded and taken by `by`: the ship counts as a kill, its captives as freed. */
export function warCreditCattleTaken(g: Galaxy, st: BeaconState, by: Empire | null, people: number): void {
    warCreditAdd(g, st, by, 'cattle', WC.cattle(g));
    warCreditPeople(g, st, by, people);
}

/** A freighter of the mega-station arrived under an escort of `escort` (megaStation.ts stepContracts). */
export function warCreditEscort(g: Galaxy, st: BeaconState, escort: Empire | null): void {
    warCreditAdd(g, st, escort, 'escorts', WC.escort(g));
}

/** `people` of a relocation order of `empire` reached a safe world (beaconRelocation.ts relocationArrive). */
export function warCreditRefugees(g: Galaxy, empire: Empire | null, people: number): void {
    const st = peekBeaconState(g);
    if (st === null) return;
    warCreditAdd(g, st, empire, 'refugees', (people / 1e6) * WC.refugeesPerMillion(g));
}

// ---------------------------------------------------------------------------------------------------------------
// The ranking and the Diet's yearly review
// ---------------------------------------------------------------------------------------------------------------

export interface WarCreditRow {
    empire: Empire;
    total: number;
    sharePct: number;
    by: Partial<Record<WarCreditKind, number>>;
}

/** The empires with points, best first (ties by empire id). Pure. */
export function warCreditRanking(g: Galaxy, st: BeaconState): WarCreditRow[] {
    const rec = st.warCredit;
    if (rec === undefined) return [];
    const rows: WarCreditRow[] = [];
    let all = 0;
    for (const e of g.empires) {
        if (e === null || e === st.faction || e === g.independentEmpire) continue;
        const total = warCreditTotal(st, e);
        if (!(total > 0)) continue;
        all += total;
        rows.push({ empire: e, total, sharePct: 0, by: rec.points[String(e.empireId)] ?? {} });
    }
    for (const r of rows) r.sharePct = all > 0 ? (100 * r.total) / all : 0;
    return rows.sort((a, b) => b.total - a.total || a.empire.empireId - b.empire.empireId);
}

function military(e: Empire): number {
    let t = 0;
    for (const b of e.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0) t += strengthOf(b);
    return t;
}

function members(g: Galaxy, st: BeaconState): Empire[] {
    const c = dietCouncil(g);
    if (c === null) return [];
    const d = peekDietState(g);
    return dietMembership(g, c).filter((e) => e.active && e !== st.faction && (d === null || d.expelled[e.empireId] === undefined));
}

/** The vote weight factor from the standing in force (1 without one). Pure. */
export function warCreditVoteFactor(g: Galaxy, e: Empire): number {
    const st = peekBeaconState(g);
    if (st === null || !on(g)) return 1;
    const fx = st.warCredit?.effect[String(e.empireId)];
    return fx === undefined ? 1 : Math.max(0.1, 1 + fx.votePct / 100);
}

/** The AI coalition's cap factor for a member (beaconAi.ts): a lagging member commits more of its fleet. Pure. */
export function warCreditAiFactor(g: Galaxy, st: BeaconState, e: Empire): number {
    return st.warCredit?.effect[String(e.empireId)]?.why === 'slack' ? 1 + WC.aiLagPct(g) / 100 : 1;
}

/**
 * The yearly review of the members' tally: the standing for the next year (top contributors +, slackers -), the reputation moves and the news line.
 * Returns whether a review was held.
 */
export function warCreditReview(g: Galaxy, st: BeaconState, force = false): boolean {
    if (!warCreditActive(g, st)) return false;
    const rec = warCreditOf(st);
    const now = galaxyStarDate(g);
    if (rec.lastReview <= 0 && !force) {
        rec.lastReview = now; // the war's first pass starts the year
        return false;
    }
    if (!force && now - rec.lastReview < days(WC.reviewDays(g))) return false;
    rec.lastReview = now;
    const ms = members(g, st);
    const rows = warCreditRanking(g, st).filter((r) => ms.includes(r.empire));
    const total = rows.reduce((a, r) => a + r.total, 0);
    rec.effect = {};
    rec.top = -1;
    if (ms.length < 2 || total < WC.minTotal(g)) return false;
    rec.reviews++;
    // the top contributors
    const topN = WC.topN(g);
    const minShare = WC.topMinSharePct(g);
    const bonus = [1, 2 / 3, 1 / 3];
    const repShare = [1, 0.5, 0.25];
    let rank = 0;
    for (const r of rows) {
        if (rank >= topN || rank >= bonus.length || r.sharePct < minShare) break;
        rec.effect[String(r.empire.empireId)] = { votePct: Math.round(WC.votePct(g) * bonus[rank] * 10) / 10, why: 'top', rank: rank + 1 };
        const rep = WC.repTop(g) * repShare[rank];
        if (rep !== 0) for (const m of ms) if (m !== r.empire) applyReputation(g, m, r.empire, rep, { cause: 'beaconWarCreditTop', labelKey: 'Beacon Reputation War Credit Top', source: 'beacon-war-credit' });
        rank++;
    }
    if (rows.length > 0 && rec.effect[String(rows[0].empire.empireId)] !== undefined) rec.top = rows[0].empire.empireId;
    // the slackers: well under their share of the members' military
    const mil = new Map<Empire, number>();
    let milAll = 0;
    for (const e of ms) {
        const v = military(e);
        mil.set(e, v);
        milAll += v;
    }
    if (milAll > 0) {
        for (const e of ms) {
            if (rec.effect[String(e.empireId)] !== undefined) continue;
            const milShare = (100 * (mil.get(e) ?? 0)) / milAll;
            if (milShare < WC.slackMinMilPct(g)) continue;
            const share = (100 * warCreditTotal(st, e)) / total;
            if (share >= (milShare * WC.slackRatioPct(g)) / 100) continue;
            rec.effect[String(e.empireId)] = { votePct: -WC.slackVotePct(g), why: 'slack', rank: 0 };
            for (const m of ms) if (m !== e) applyReputation(g, m, e, -WC.slackRep(g), { cause: 'beaconWarCreditSlack', labelKey: 'Beacon Reputation War Credit Slack', source: 'beacon-war-credit' });
            if (isHumanEmpire(g, e)) {
                scenarioMessage(g, e, T(`${TAG} War Credit Slack Title`), T(`${TAG} War Credit Slack`, Math.round(share), Math.round(milShare)), { type: EmpireMessageType.GeneralBadEvent, popupMode: 'quiet' });
            }
        }
    }
    if (rec.top >= 0) {
        const top = rows[0];
        scenarioNews(g, null, T(`${TAG} War Credit News`, top.empire.name, Math.round(top.sharePct), Math.round(rec.effect[String(top.empire.empireId)].votePct)));
    }
    return true;
}

/** The Diet window's line (dietWarCreditLine). */
function dietLine(g: Galaxy): string {
    const st = peekBeaconState(g);
    if (!warCreditActive(g, st)) return '';
    const rows = warCreditRanking(g, st);
    if (rows.length === 0) return T(`${TAG} War Credit Diet None`);
    const top = rows[0];
    const me = g.playerEmpire;
    const mine = me === null ? undefined : rows.find((r) => r.empire === me);
    const fx = me === null ? undefined : st.warCredit?.effect[String(me.empireId)];
    return T(`${TAG} War Credit Diet`, top.empire.name, Math.round(top.sharePct), Math.round(top.total), mine === undefined ? 0 : Math.round(mine.sharePct), fx === undefined ? 0 : fx.votePct);
}

export function registerWarCredit(): void {
    registerScenarioPeriodic({ id: 'beacon.warCredit', flag: BEACON_FLAG, order: 26, periodDays: 30, run: (g) => { const st = peekBeaconState(g); if (st !== null) warCreditReview(g, st); } });
    registerScenarioQuery({ id: 'beacon.warCreditVote', flag: BEACON_FLAG, query: 'dietVoteWeightFactor', run: (g, v, a) => v * warCreditVoteFactor(g, a.empire) });
    registerScenarioEvent({ id: 'beacon.warCreditFoundry', flag: BEACON_FLAG, event: 'foundryDestroyed', run: (g, e) => {
        const st = peekBeaconState(g);
        if (st !== null) warCreditFoundry(g, st, e.empire);
    } });
    registerScenarioEvent({ id: 'beacon.warCreditDepot', flag: BEACON_FLAG, event: 'depotDestroyed', run: (g, e) => {
        const st = peekBeaconState(g);
        if (st !== null) warCreditDepot(g, st, e.empire);
    } });
    dietWarCreditLine.fn = dietLine;
}
