// War crimes remembered (scenarios/war-crimes; docs/DARK_THEMES.md §3). Not a port.
//
// Crimes, per offending empire (major empires only; pirates and the independents commit none):
//   bombard      — bombarding a populated colony (combat/damage.ts `habitatBombarded`; once per colony and 30 days)
//   destroyPlanet— destroying a planet (damage.ts destroyHabitat, `habitatDestroyed`)
//   scorch       — scorching one's own colony (Scorched Earth, `colonyScorched`)
//   refugees     — attacking a refugee convoy (Refugees & Demographics' convoys, `builtObjectAttacked`; once per ship)
//   delegate     — attacking a Diet delegate's VIP shuttle (Characters & Victory trips; once per ship)
//   enslave      — making a penal colony of conquered peoples ("Allow slavery", `colonyEnslaved`), and every year a
//                  penal colony holds enslaved workers
//   independents — attacking an independent colony (`habitatAttacked`; once per colony and year)
// Each adds its weight × WAR_CRIME_WEIGHTS to the offender's RECORD, which fades by warCrimesDecayPerYear a year (3%: a
// record halves in about 23 years — generations). Each crime also costs attitude: every other major empire's toward
// the offender −weight × warCrimesReputation, the victim's twice that (reputation/ledger.ts applyReputation: the
// ledger when the Reputation add-on runs, else the stock IncidentEvaluation). That runs with or without the Diet.
// With the Interstellar Diet running (dietOn), members may move a WAR CRIMES TRIBUNAL (registerDietMotionKind) against
// the worst offender whose record is at least warCrimesTribunalMin. Votes: self-interest (victims, rivals and those at
// war with it for; friends, allies and the offender against) and the voter's own record (the guilty fear the precedent).
// Passed: council sanctions (council.ts applyMotion 'sanction', the stock StartTradeSanctions), reparations
// (warCrimesReparationsPct of its treasury to its victims, by the harm done them; giveTradeableItem Money) and, with a
// record of warCrimesTrialMin or more, the trial of its leader, who is removed (the stock character death path;
// the stock succession names the next). The record is then halved; no new tribunal against it for 5 years.
// Rnd: none. State: scenario.state.warCrimes (plain data keyed by empire id).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { TradeableItem, TradeableItemType, giveTradeableItem } from '../../../tradeItems';
import { characterSendDeathMessage, CharacterDeathType } from '../../../characterRuntime';
import { isHumanEmpire } from '../../../humanEmpires';
import { EmpireMessageType } from '../../../messages';
import { registerScenarioEvent, registerScenarioYearly } from '../../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../../state';
import { scenarioMessage, scenarioNews } from '../../messages';
import { applyReputation } from '../../reputation/ledger';
import { applyMotion, type Motion } from '../../emergent/council';
import { demographicsStateOf } from '../../emergent/demographics';
import { tripOfShuttle } from '../common';
import { dietCouncil } from './diet';
import { dietOn, dietWarCrimesLine, registerDietMotionKind } from './dietState';

export const WAR_CRIMES_FLAG = 'warCrimes';
const KEY = 'warCrimes';
const TRIBUNAL = 'warCrimesTribunal';

export type WarCrimeKind = 'bombard' | 'destroyPlanet' | 'scorch' | 'refugees' | 'delegate' | 'enslave' | 'independents';

/** Record points per crime. */
export const WAR_CRIME_WEIGHTS: Readonly<Record<WarCrimeKind, number>> = {
    bombard: 3,
    destroyPlanet: 30,
    scorch: 12,
    refugees: 5,
    delegate: 10,
    enslave: 8,
    independents: 2,
};

export const WAR_CRIME_LABELS: Readonly<Record<WarCrimeKind, string>> = {
    bombard: 'colony bombardment',
    destroyPlanet: 'planet destruction',
    scorch: 'scorched earth',
    refugees: 'attacks on refugee convoys',
    delegate: 'attacks on Diet delegates',
    enslave: 'enslaving conquered peoples',
    independents: 'attacks on independent worlds',
};

export interface WarCrimesRecord {
    empireId: number;
    name: string;
    score: number;
    counts: Partial<Record<WarCrimeKind, number>>;
    /** victim empire id → harm (points) done to it. */
    victims: Record<string, number>;
    /** Star date before which no new tribunal may be moved against it. */
    tribunalBlockedUntil: number;
    tribunals: number;
}

export interface WarCrimesState {
    records: Record<string, WarCrimesRecord>;
    /** `${kind}:${offenderId}:${key}` → star date of the last count (the per-incident throttle). */
    last: Record<string, number>;
    tribunals: { year: number; target: string; passed: boolean; yes: number; no: number; outcome: string }[];
    totals: Partial<Record<WarCrimeKind, number>>;
}

export function warCrimesState(g: Galaxy): WarCrimesState {
    return scenarioState<WarCrimesState>(g, KEY, () => ({ records: {}, last: {}, tribunals: [], totals: {} }));
}

function major(g: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

function empireById(g: Galaxy, id: number): Empire | null {
    for (const e of g.empires) if (e !== null && e.empireId === id) return e;
    return null;
}

export function warCrimesRecord(g: Galaxy, e: Empire): WarCrimesRecord | null {
    const st = g.scenario?.state[KEY] as WarCrimesState | undefined;
    return st?.records[e.empireId] ?? null;
}

/**
 * Records one crime. `throttleKey`: at most one count per (kind, offender, key) every `throttleDays` days. `scale`
 * multiplies the weight. Returns whether it counted.
 */
export function recordWarCrime(g: Galaxy, offender: Empire | null, kind: WarCrimeKind, victim: Empire | null, throttleKey: string | null = null, throttleDays = 0, scale = 1): boolean {
    if (!major(g, offender)) return false;
    const st = warCrimesState(g);
    const now = galaxyStarDate(g);
    if (throttleKey !== null) {
        const k = `${kind}:${offender.empireId}:${throttleKey}`;
        const last = st.last[k];
        if (last !== undefined && now - last < (throttleDays * YEAR_LENGTH) / 360) return false;
        st.last[k] = now;
    }
    const w = WAR_CRIME_WEIGHTS[kind] * scale;
    const r = (st.records[offender.empireId] ??= { empireId: offender.empireId, name: offender.name, score: 0, counts: {}, victims: {}, tribunalBlockedUntil: -1, tribunals: 0 });
    r.name = offender.name;
    r.score += w;
    r.counts[kind] = (r.counts[kind] ?? 0) + 1;
    st.totals[kind] = (st.totals[kind] ?? 0) + 1;
    if (victim !== null && victim !== offender) r.victims[victim.empireId] = (r.victims[victim.empireId] ?? 0) + w;
    const rep = scenarioParam(g, 'warCrimesReputation', 0.5) * w;
    if (rep > 0) {
        for (const o of g.empires) {
            if (!major(g, o) || o === offender) continue;
            applyReputation(g, o, offender, -(o === victim ? 2 * rep : rep), { cause: `warCrimes.${kind}`, labelKey: `Reputation Cause warCrimes`, source: 'war-crimes', legacy: 'factored', decayPerYear: 1 });
        }
    }
    return true;
}

/** The worst living offender (score order, ties to the lower empire id). */
export function worstOffender(g: Galaxy): { empire: Empire; record: WarCrimesRecord } | null {
    const st = g.scenario?.state[KEY] as WarCrimesState | undefined;
    if (st === undefined) return null;
    let best: { empire: Empire; record: WarCrimesRecord } | null = null;
    for (const id of Object.keys(st.records).map(Number).sort((a, b) => a - b)) {
        const r = st.records[id];
        const e = empireById(g, id);
        if (!major(g, e)) continue;
        if (best === null || r.score > best.record.score) best = { empire: e, record: r };
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------------------------

registerScenarioEvent({
    id: 'warCrimes.bombard',
    flag: WAR_CRIMES_FLAG,
    event: 'habitatBombarded',
    run: (g, { builtObject, habitat }) => {
        if (habitat.population == null || habitat.population.totalAmount <= 0 || habitat.empire === builtObject.empire) return;
        recordWarCrime(g, builtObject.empire, 'bombard', habitat.empire, String(habitat.habitatIndex), 30);
    },
});

registerScenarioEvent({
    id: 'warCrimes.destroyPlanet',
    flag: WAR_CRIMES_FLAG,
    event: 'habitatDestroyed',
    run: (g, { habitat, destroyer }) => {
        recordWarCrime(g, destroyer, 'destroyPlanet', habitat.empire, String(habitat.habitatIndex), 3600);
    },
});

registerScenarioEvent({
    id: 'warCrimes.scorch',
    flag: WAR_CRIMES_FLAG,
    event: 'colonyScorched',
    run: (g, { empire, colony, attacker }) => {
        recordWarCrime(g, empire, 'scorch', attacker, String(colony.habitatIndex), 360);
    },
});

registerScenarioEvent({
    id: 'warCrimes.enslave',
    flag: WAR_CRIMES_FLAG,
    event: 'colonyEnslaved',
    run: (g, { empire, colony }) => {
        recordWarCrime(g, empire, 'enslave', null, String(colony.habitatIndex), 360);
    },
});

registerScenarioEvent({
    id: 'warCrimes.independents',
    flag: WAR_CRIMES_FLAG,
    event: 'habitatAttacked',
    run: (g, { habitat, attackingEmpire }) => {
        if (habitat.empire === null || habitat.empire !== g.independentEmpire || habitat.population == null || habitat.population.totalAmount <= 0) return;
        recordWarCrime(g, attackingEmpire, 'independents', null, String(habitat.habitatIndex), 360);
    },
});

function isRefugeeConvoy(g: Galaxy, bo: BuiltObject): boolean {
    return scenarioFlag(g, 'refugees') && demographicsStateOf(g).convoys.has(bo);
}

registerScenarioEvent({
    id: 'warCrimes.ships',
    flag: WAR_CRIMES_FLAG,
    event: 'builtObjectAttacked',
    run: (g, { builtObject, attackingEmpire }) => {
        if (!major(g, attackingEmpire)) return;
        if (isRefugeeConvoy(g, builtObject)) {
            recordWarCrime(g, attackingEmpire, 'refugees', null, `s${builtObject.builtObjectID}`, 3600);
            return;
        }
        const trip = tripOfShuttle(g, builtObject);
        if (trip !== null && (trip as { reason?: string }).reason === 'diet') {
            const victim = builtObject.empire;
            recordWarCrime(g, attackingEmpire, 'delegate', victim, `s${builtObject.builtObjectID}`, 3600);
        }
    },
});

// Yearly: enslaved workers held count again; records fade.
registerScenarioYearly({
    id: 'warCrimes.yearly',
    flag: WAR_CRIMES_FLAG,
    run: (g) => {
        for (const e of g.empires) {
            if (!major(g, e) || e.slavery === undefined) continue;
            for (const h of e.slavery.penal) {
                let w = 0;
                for (const p of h.population?.items ?? []) if (p.race !== e.dominantRace) w += p.amount;
                if (w > 0) recordWarCrime(g, e, 'enslave', null, `held${h.habitatIndex}`, 300, Math.min(1, w / 2e8) * 0.5);
            }
        }
        const st = g.scenario?.state[KEY] as WarCrimesState | undefined;
        if (st === undefined) return;
        const keep = 1 - scenarioParam(g, 'warCrimesDecayPerYear', 0.03);
        for (const r of Object.values(st.records)) {
            r.score *= keep;
            for (const k of Object.keys(r.victims)) r.victims[k] *= keep;
        }
        // Throttle keys older than ten years are no longer needed.
        const now = galaxyStarDate(g);
        for (const k of Object.keys(st.last)) if (now - st.last[k] > 10 * YEAR_LENGTH) delete st.last[k];
    },
});

// ---------------------------------------------------------------------------------------------------------------
// The tribunal (Interstellar Diet)
// ---------------------------------------------------------------------------------------------------------------

function on(g: Galaxy): boolean {
    return scenarioFlag(g, WAR_CRIMES_FLAG) && dietOn(g);
}

function tribunalTarget(g: Galaxy): { empire: Empire; record: WarCrimesRecord } | null {
    const w = worstOffender(g);
    if (w === null || w.record.score < scenarioParam(g, 'warCrimesTribunalMin', 40) || galaxyStarDate(g) < w.record.tribunalBlockedUntil) return null;
    return w;
}

/** A voter's score for trying `target` (> 0: yes). Self-interest plus its own record. Pure. */
export function tribunalVoteScore(g: Galaxy, voter: Empire, target: Empire): number {
    if (voter === target) return -100;
    const r = warCrimesRecord(g, target);
    if (r === null) return -10;
    let s = r.score / 5 - 5;
    s += (r.victims[voter.empireId] ?? 0) / 2;
    const own = warCrimesRecord(g, voter);
    if (own !== null) s -= own.score / 4;
    const rel = obtainDiplomaticRelation(voter, target).type;
    if (rel === DiplomaticRelationType.War) s += 20;
    else if (rel === DiplomaticRelationType.MutualDefensePact || rel === DiplomaticRelationType.Protectorate) s -= 25;
    else if (rel === DiplomaticRelationType.FreeTradeAgreement) s -= 10;
    return s;
}

function applyTribunal(g: Galaxy, target: Empire, year: number): string {
    const st = warCrimesState(g);
    const r = st.records[target.empireId];
    const parts: string[] = [];
    const c = dietCouncil(g);
    if (c !== null) {
        applyMotion(g, c, { kind: 'sanction', target, other: null, resourceId: -1 } as unknown as Motion, year);
        parts.push('sanctions');
    }
    // Reparations to the victims, by the harm done them.
    const pot = Math.floor((Math.max(0, target.stateMoney) * scenarioParam(g, 'warCrimesReparationsPct', 10)) / 100);
    const victims = Object.keys(r.victims).map(Number).sort((a, b) => a - b).map((id) => ({ e: empireById(g, id), w: r.victims[id] })).filter((x): x is { e: Empire; w: number } => major(g, x.e) && x.e !== target && x.w > 0);
    const total = victims.reduce((a, x) => a + x.w, 0);
    if (pot > 0 && total > 0) {
        let paid = 0;
        for (const v of victims) {
            const amt = Math.floor((pot * v.w) / total);
            if (amt <= 0) continue;
            giveTradeableItem(g, target, v.e, new TradeableItem(TradeableItemType.Money, amt, amt), null);
            paid += amt;
        }
        if (paid > 0) parts.push(`reparations of ${paid.toLocaleString('en-US')} credits`);
    }
    // The trial of the leader.
    const leader = target.leader;
    if (r.score >= scenarioParam(g, 'warCrimesTrialMin', 100) && leader !== null) {
        characterSendDeathMessage(g, leader, CharacterDeathType.Dismissed);
        leader.kill(g);
        parts.push(`the trial and removal of ${leader.name}`);
    }
    r.score *= 0.5;
    r.tribunals++;
    r.tribunalBlockedUntil = galaxyStarDate(g) + 5 * YEAR_LENGTH;
    return parts.join(', ');
}

registerDietMotionKind({
    kind: TRIBUNAL,
    label: 'War Crimes Tribunal',
    needs: 'empire',
    proposable: (g) => on(g) && tribunalTarget(g) !== null,
    text: (_g, _st, m) => `A War Crimes Tribunal against the ${m.target?.name ?? ''}`,
    effect: () => 'Sanctions on the offender, reparations to its victims and, for the worst records, the trial and removal of its leader.',
    apply: (g, _st, m) => {
        const t = m.target;
        if (t === null) return;
        const outcome = applyTribunal(g, t, Math.floor(galaxyStarDate(g) / YEAR_LENGTH));
        warCrimesState(g).tribunals.push({ year: Math.round((g.nowMs / YEAR_LENGTH) * 10) / 10, target: t.name, passed: true, yes: Math.round(m.yes), no: Math.round(m.no), outcome });
        scenarioNews(g, null, `The Interstellar Diet's War Crimes Tribunal has found the ${t.name} guilty: ${outcome}.`);
        if (isHumanEmpire(g, t)) scenarioMessage(g, t, 'War Crimes Tribunal', `The Diet has found us guilty of war crimes: ${outcome}.`, { type: EmpireMessageType.GeneralBadEvent, popup: true });
    },
    failed: (g, _st, m) => noteTribunalFailed(g, m.target, m.yes, m.no),
    voteScore: (g, _st, voter, m) => (m.target === null ? -100 : voter === m.proposer ? 100 : tribunalVoteScore(g, voter, m.target)),
    candidates: (g, _st, a) => {
        if (!on(g)) return [];
        const t = tribunalTarget(g);
        if (t === null || t.empire === a) return [];
        const s = tribunalVoteScore(g, a, t.empire);
        return s > 0 ? [{ kind: TRIBUNAL, proposer: a, target: t.empire, other: null, colony: null, resourceId: -1, weight: 20 + Math.min(40, s) }] : [];
    },
});

/** A failed / vetoed tribunal (diet.ts closeSession → DietMotionKindDef.failed): acquitted, no new one for 2 years. */
export function noteTribunalFailed(g: Galaxy, target: Empire | null, yes: number, no: number): void {
    if (target === null || !scenarioFlag(g, WAR_CRIMES_FLAG)) return;
    const st = warCrimesState(g);
    const r = st.records[target.empireId];
    if (r !== undefined) r.tribunalBlockedUntil = galaxyStarDate(g) + 2 * YEAR_LENGTH;
    st.tribunals.push({ year: Math.round((g.nowMs / YEAR_LENGTH) * 10) / 10, target: target.name, passed: false, yes: Math.round(yes), no: Math.round(no), outcome: 'acquitted' });
}

/** The Diet window's line. */
dietWarCrimesLine.fn = (g: Galaxy): string => {
    if (!scenarioFlag(g, WAR_CRIMES_FLAG)) return '';
    const w = worstOffender(g);
    if (w === null || w.record.score < 1) return 'War crimes: no empire stands accused.';
    const kinds = (Object.keys(w.record.counts) as WarCrimeKind[]).sort((a, b) => (w.record.counts[b] ?? 0) - (w.record.counts[a] ?? 0)).slice(0, 2).map((k) => WAR_CRIME_LABELS[k]);
    const ready = w.record.score >= scenarioParam(g, 'warCrimesTribunalMin', 40) ? ' — a tribunal may be moved' : '';
    return `War crimes: the worst record is the ${w.empire.name}'s (${Math.round(w.record.score)}: ${kinds.join(', ')})${ready}.`;
};
