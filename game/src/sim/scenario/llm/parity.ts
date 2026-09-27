// 19s-1 AI PARITY AUDIT counters (tasks/19-mod-layer-scenarios.md §19s item 1). Not a port.
// How often do the AI empires actually use each scenario system? The soak script (scripts/ai-parity.mjs) runs the
// headless sim with every flag on and calls `sample(galaxy)` between run chunks; the audit reads the scenario state
// bags and the event log (never writes, never draws galaxy.rnd) and de-duplicates by a key per fact, so bounded
// histories (the decision history keeps 200, the council keeps its results, ...) are counted once each as long as the
// chunks are short against their retention. Packages not on this build (19n court, 19o ledger) are read behind
// presence checks and listed as absent.
//
// Columns: AI = done by / for an AI empire; Player = by the player's empire (in a headless run nobody answers its
// decisions, so they expire); Other = expired / automatic answers and totals the state does not attribute.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { DiplomaticRelationType } from '../../diplomacy';
import { eventLogEntries } from '../eventLog/log';

export interface ParityRow {
    system: string;
    counter: string;
    ai: number;
    player: number;
    other: number;
    source: string;
    /** The system's state existed at some sample (or its flag was on). */
    present: boolean;
    /** Other holds totals the state does not attribute (they count as activity for the near-zero list). */
    unattributed: boolean;
}

type Col = 'ai' | 'player' | 'other';

interface Decl {
    system: string;
    counter: string;
    source: string;
    /** State bag key(s) whose presence marks the system present. */
    keys: string[];
}

/** The fixed rows (zeros show); decision kinds and event-log sources add rows as they appear. */
const DECLARED: readonly Decl[] = [
    { system: 'Council (19d8)', counter: 'motions tabled', source: 'council.councils[].results + motion (proposer)', keys: ['council'] },
    { system: 'Council (19d8)', counter: 'motions passed', source: 'council results (passed)', keys: ['council'] },
    { system: 'Council (19d8)', counter: 'votes cast yes/no', source: 'council motion.votes (sampled while voting)', keys: ['council'] },
    { system: 'Council (19d8)', counter: 'abstentions', source: 'council motion.votes', keys: ['council'] },
    { system: 'Council (19d8)', counter: 'blocs formed', source: 'council.councils[].blocs (founder)', keys: ['council'] },
    { system: 'War goals (19g-3)', counter: 'war goals chosen', source: 'warGoals.wars[].a/b.chosenBy', keys: ['warGoals'] },
    { system: 'War goals (19g-3)', counter: 'peace terms offered', source: 'warGoals.offers (from → to)', keys: ['warGoals'] },
    { system: 'War goals (19g-3)', counter: 'peace signed with terms', source: 'warGoals.wars ledger closed while at peace', keys: ['warGoals'] },
    { system: 'War goals (19g-3)', counter: 'demilitarisation treaties', source: 'warGoals.treaties', keys: ['warGoals'] },
    { system: 'War goals (19g-3)', counter: 'reparation plans', source: 'warGoals.reparations', keys: ['warGoals'] },
    { system: 'War goals (19g-3)', counter: 'casus belli held', source: 'warGoals.casusBelli (victim)', keys: ['warGoals'] },
    { system: 'Internal security (19m)', counter: 'leads opened', source: 'security.leads (empire)', keys: ['security'] },
    { system: 'Internal security (19m)', counter: 'leads confirmed', source: 'security.leads level confirmed', keys: ['security'] },
    { system: 'Internal security (19m)', counter: 'investigations', source: 'security.investigations (sampled)', keys: ['security'] },
    { system: 'Internal security (19m)', counter: 'security log lines (actions / outcomes)', source: 'security.log', keys: ['security'] },
    { system: 'Politics (19d1)', counter: 'plots resolved', source: 'politics.events', keys: ['politics'] },
    { system: 'Politics (19d1)', counter: 'autonomy grants (faction concession)', source: 'politics.autonomy', keys: ['politics'] },
    { system: 'Court (19n)', counter: 'faction concessions', source: 'court.events kind concede', keys: ['court'] },
    { system: 'Court (19n)', counter: 'faction refusals', source: 'court.events kind refuse', keys: ['court'] },
    { system: 'Court (19n)', counter: 'schemes started', source: 'courtIntrigue.schemes', keys: ['courtIntrigue'] },
    { system: 'Reputation (19o)', counter: 'ledger pairs with entries', source: 'reputation.pairs (owner)', keys: ['reputation'] },
    { system: 'Espionage (19d3)', counter: 'spy crises opened (offender)', source: 'espionage.crises', keys: ['espionage'] },
    { system: 'Espionage (19d3)', counter: 'missions framed (originator)', source: 'espionage.frames', keys: ['espionage'] },
    { system: 'Crises (19d2)', counter: 'resource crises opened', source: 'crises.crises (empire)', keys: ['crises'] },
    { system: 'Crises (19d2)', counter: 'crisis export contracts (AI rule 3)', source: 'crises.exports', keys: ['crises'] },
    { system: 'Crises (19d2)', counter: 'mining priorities set (AI rule 2)', source: 'crises.miningPriority', keys: ['crises'] },
    { system: 'Refugees (19d5)', counter: 'asylum policies set', source: 'demographics.asylum', keys: ['demographics'] },
    { system: 'Refugees (19d5)', counter: 'refugee flows', source: 'demographics.flows', keys: ['demographics'] },
    { system: 'Rim herders (19j)', counter: 'protectorates', source: 'rimHerders.stats (total)', keys: ['rimHerders'] },
    { system: 'Rim herders (19j)', counter: 'conquests', source: 'rimHerders.stats (total)', keys: ['rimHerders'] },
    { system: 'Rim herders (19j)', counter: 'conquest orders', source: 'rimHerders.stats (total)', keys: ['rimHerders'] },
    { system: 'Rim herders (19j)', counter: 'herd hunts (kills)', source: 'rimHerders.kills (empire)', keys: ['rimHerders'] },
    { system: 'Rim herders (19j)', counter: 'tributes', source: 'rimHerders.stats (total)', keys: ['rimHerders'] },
    { system: 'Rim fauna (19g-7)', counter: 'herds killed', source: 'rimFauna.stats (total)', keys: ['rimFauna'] },
    { system: 'Independents (19k)', counter: 'leagues formed', source: 'independents.stats', keys: ['independents'] },
    { system: 'Independents (19k)', counter: 'league protectorates', source: 'independents.stats', keys: ['independents'] },
    { system: 'Independents (19k)', counter: 'station buyouts / cleared / tolerated', source: 'independents.stats', keys: ['independents'] },
    { system: 'Independents (19k)', counter: 'trade deals', source: 'independents.stats', keys: ['independents'] },
    { system: 'Wreckage (19e-7)', counter: 'salvage trips', source: 'wreckage.stats (total)', keys: ['wreckage'] },
    { system: 'Wreckage (19e-7)', counter: 'techs recovered', source: 'wreckage.stats (total)', keys: ['wreckage'] },
    { system: 'Chartered companies (19c)', counter: 'charters granted', source: 'charteredCompanies.charters (founder)', keys: ['charteredCompanies.charters'] },
    { system: 'Pirate ambition (19l)', counter: 'factions gone ambitious', source: 'lively.pirateAmbition', keys: ['lively.pirateAmbition'] },
];

function rec(x: unknown): Record<string, unknown> | null {
    return typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : null;
}

function arr(x: unknown): unknown[] {
    return Array.isArray(x) ? x : [];
}

function num(x: unknown): number {
    return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

/** Decision kind → system label (by prefix). */
function decisionSystem(kind: string): string {
    const p = kind.split('.')[0];
    const map: Record<string, string> = {
        council: 'Council (19d8)',
        lively: 'War goals (19g-3)',
        refugees: 'Refugees (19d5)',
        crises: 'Crises (19d2)',
        politics: 'Politics (19d1)',
        rimHerders: 'Rim herders (19j)',
        independents: 'Independents (19k)',
        espionage: 'Espionage (19d3)',
        charters: 'Chartered companies (19c)',
        court: 'Court (19n)',
        security: 'Internal security (19m)',
    };
    return map[p] ?? `Decisions (${p})`;
}

export class ParityAudit {
    private readonly seen = new Set<string>();
    private readonly rowsByKey = new Map<string, ParityRow>();
    /** Totals taken from cumulative stats (the last sample wins). */
    private readonly totals = new Map<string, { col: Col; value: number }>();
    private prevWars = new Map<string, { a: number; b: number }>();
    readonly eventSources = new Map<string, number>();
    private lastEventId = 0;
    samples = 0;

    constructor() {
        for (const d of DECLARED) this.row(d.system, d.counter, d.source);
    }

    private row(system: string, counter: string, source: string): ParityRow {
        const k = `${system}\u0000${counter}`;
        let r = this.rowsByKey.get(k);
        if (r === undefined) this.rowsByKey.set(k, (r = { system, counter, ai: 0, player: 0, other: 0, source, present: false, unattributed: false }));
        return r;
    }

    private bump(system: string, counter: string, source: string, col: Col, key: string | null, n = 1): void {
        if (key !== null) {
            if (this.seen.has(key)) return;
            this.seen.add(key);
        }
        const r = this.row(system, counter, source);
        r[col] += n;
        r.present = true;
    }

    private total(system: string, counter: string, source: string, col: Col, value: number, add = false): void {
        const k = `${system}\u0000${counter}\u0000${col}`;
        const prev = this.totals.get(k)?.value ?? 0;
        this.totals.set(k, { col, value: add ? prev + value : value });
        const r = this.row(system, counter, source);
        r.present = true;
        if (col === 'other') r.unattributed = true;
    }

    private colOf(galaxy: Galaxy, e: unknown): Col {
        if (e == null) return 'other';
        return e === galaxy.playerEmpire ? 'player' : 'ai';
    }

    private colOfId(galaxy: Galaxy, id: number): Col {
        return galaxy.playerEmpire !== null && galaxy.playerEmpire.empireId === id ? 'player' : 'ai';
    }

    /** Reads every state bag once (call between run chunks; pure). */
    sample(galaxy: Galaxy): void {
        this.samples++;
        const st = galaxy.scenario?.state ?? {};
        for (const d of DECLARED) if (d.keys.some((k) => k in st)) this.row(d.system, d.counter, d.source).present = true;
        this.sampleDecisions(galaxy, rec(st.decisions));
        this.sampleCouncil(galaxy, rec(st.council));
        this.sampleWarGoals(galaxy, rec(st.warGoals));
        this.sampleSecurity(galaxy, rec(st.security));
        this.samplePolitics(galaxy, rec(st.politics));
        this.sampleCourt(galaxy, rec(st.court), rec(st.courtIntrigue));
        this.sampleMisc(galaxy, st);
        this.sampleEventLog(galaxy);
    }

    private sampleDecisions(galaxy: Galaxy, s: Record<string, unknown> | null): void {
        for (const d of arr(s?.history).map(rec)) {
            if (d === null || typeof d.kind !== 'string') continue;
            const col: Col = d.answeredBy === 'ai' ? 'ai' : d.answeredBy === 'player' ? 'player' : 'other';
            const answer = typeof d.answer === 'string' ? d.answer : '?';
            this.bump(decisionSystem(d.kind), `decision ${d.kind} (answers)`, 'decisions.history (answeredBy)', col, `dec:${String(d.id)}`);
            this.bump(decisionSystem(d.kind), `decision ${d.kind} → ${answer}`, 'decisions.history (answer)', col, `deca:${String(d.id)}`);
        }
    }

    private sampleCouncil(galaxy: Galaxy, s: Record<string, unknown> | null): void {
        const S = 'Council (19d8)';
        for (const c of arr(s?.councils).map(rec)) {
            if (c === null) continue;
            const cid = String(c.id);
            for (const r of arr(c.results).map(rec)) {
                if (r === null) continue;
                this.bump(S, 'motions tabled', '', this.colOf(galaxy, r.proposer), `cm:${cid}:${String(r.motionId)}`);
                if (r.passed === true) this.bump(S, 'motions passed', '', this.colOf(galaxy, r.proposer), `cmp:${cid}:${String(r.motionId)}`);
            }
            const m = rec(c.motion);
            if (m !== null) {
                this.bump(S, 'motions tabled', '', this.colOf(galaxy, m.proposer), `cm:${cid}:${String(m.id)}`);
                for (const v of arr(m.votes).map(rec)) {
                    if (v === null) continue;
                    const e = v.empire as Empire | undefined;
                    const key = `cv:${cid}:${String(m.id)}:${e?.empireId ?? '?'}`;
                    this.bump(S, v.vote === 'abstain' ? 'abstentions' : 'votes cast yes/no', '', this.colOf(galaxy, e), key);
                }
            }
            for (const b of arr(c.blocs).map(rec)) {
                if (b !== null) this.bump(S, 'blocs formed', '', this.colOf(galaxy, b.founder), `cb:${cid}:${String(b.id)}`);
            }
        }
    }

    private sampleWarGoals(galaxy: Galaxy, s: Record<string, unknown> | null): void {
        if (s === null) return;
        const S = 'War goals (19g-3)';
        const wars = rec(s.wars) ?? {};
        const now = new Map<string, { a: number; b: number }>();
        for (const [key, l] of Object.entries(wars)) {
            const w = rec(l);
            if (w === null) continue;
            const start = String(w.startDate);
            for (const side of [rec(w.a), rec(w.b)]) {
                if (side === null) continue;
                const e = side.empire as Empire;
                // An AI-answered goal of the player's side is the expiry default (Other).
                const col: Col = side.chosenBy === 'player' ? 'player' : e === galaxy.playerEmpire ? 'other' : 'ai';
                if (side.chosenBy !== 'pending') this.bump(S, 'war goals chosen', '', col, `wg:${key}:${start}:${e.empireId}`);
            }
            const a = rec(w.a)?.empire as Empire | undefined;
            const b = rec(w.b)?.empire as Empire | undefined;
            if (a !== undefined && b !== undefined) now.set(`${key}:${start}`, { a: a.empireId, b: b.empireId });
        }
        for (const [k, pair] of this.prevWars) {
            if (now.has(k)) continue;
            const a = galaxy.empires.find((e) => e !== null && e.empireId === pair.a);
            const b = galaxy.empires.find((e) => e !== null && e.empireId === pair.b);
            const atWar = a != null && b != null && a.diplomaticRelations.byEmpire(b)?.type === DiplomaticRelationType.War;
            if (atWar) continue;
            const involvesPlayer = galaxy.playerEmpire !== null && (pair.a === galaxy.playerEmpire.empireId || pair.b === galaxy.playerEmpire.empireId);
            this.bump(S, 'peace signed with terms', '', involvesPlayer ? 'player' : 'ai', `ps:${k}`);
        }
        this.prevWars = now;
        for (const [key, t] of Object.entries(rec(s.offers) ?? {})) {
            const from = Number(key.split(':')[0]);
            this.bump(S, 'peace terms offered', '', this.colOfId(galaxy, from), `po:${key}:${JSON.stringify(Object.keys(rec(t) ?? {}))}:${this.warStartFor(wars, key)}`);
        }
        for (const t of arr(s.treaties).map(rec)) {
            if (t === null) continue;
            this.bump(S, 'demilitarisation treaties', '', this.colOf(galaxy, t.beneficiary), `dm:${(t.empire as Empire)?.empireId}:${(t.beneficiary as Empire)?.empireId}:${String(t.signed)}`);
        }
        for (const r of arr(s.reparations).map(rec)) {
            if (r === null) continue;
            this.bump(S, 'reparation plans', '', this.colOf(galaxy, r.payee), `rp:${(r.payer as Empire)?.empireId}:${(r.payee as Empire)?.empireId}:${num(r.perYear)}`);
        }
        for (const [key, date] of Object.entries(rec(s.casusBelli) ?? {})) {
            this.bump(S, 'casus belli held', '', this.colOfId(galaxy, Number(key.split(':')[0])), `cbh:${key}:${String(date)}`);
        }
    }

    private warStartFor(wars: Record<string, unknown>, pair: string): string {
        const [a, b] = pair.split(':').map(Number);
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        return String(rec(wars[key])?.startDate ?? '');
    }

    private sampleSecurity(galaxy: Galaxy, s: Record<string, unknown> | null): void {
        if (s === null) return;
        const S = 'Internal security (19m)';
        for (const l of arr(s.leads).map(rec)) {
            if (l === null) continue;
            const col = this.colOf(galaxy, l.empire);
            this.bump(S, 'leads opened', '', col, `ld:${String(l.id)}`);
            if (l.level === 'confirmed') this.bump(S, 'leads confirmed', '', col, `ldc:${String(l.id)}`);
        }
        for (const i of arr(s.investigations).map(rec)) {
            if (i === null) continue;
            this.bump(S, 'investigations', '', this.colOf(galaxy, i.empire), `inv:${String(i.leadId)}:${String(i.start)}`);
        }
        for (const x of arr(s.log).map(rec)) {
            if (x === null) continue;
            this.bump(S, 'security log lines (actions / outcomes)', '', this.colOf(galaxy, x.empire), `slog:${String(x.date)}:${String(x.text)}`);
        }
    }

    private samplePolitics(galaxy: Galaxy, s: Record<string, unknown> | null): void {
        if (s === null) return;
        const S = 'Politics (19d1)';
        for (const e of arr(s.events).map(rec)) {
            if (e === null) continue;
            const ch = rec(e.character);
            this.bump(S, 'plots resolved', '', this.colOf(galaxy, e.empire), `pe:${String(e.year)}:${(e.empire as Empire)?.empireId}:${String(e.kind)}:${String(ch?.name ?? '')}`);
            this.bump(S, `plot ${String(e.kind)} ${e.success === true ? 'succeeded' : 'failed'}`, 'politics.events', this.colOf(galaxy, e.empire), `pek:${String(e.year)}:${(e.empire as Empire)?.empireId}:${String(e.kind)}:${String(ch?.name ?? '')}`);
        }
        if (s.autonomy instanceof Map) {
            for (const [h, until] of s.autonomy as Map<unknown, unknown>) {
                const hab = rec(h);
                this.bump(S, 'autonomy grants (faction concession)', '', this.colOf(galaxy, hab?.empire), `aut:${String(hab?.habitatIndex)}:${String(until)}`);
            }
        }
    }

    private sampleCourt(galaxy: Galaxy, court: Record<string, unknown> | null, intrigue: Record<string, unknown> | null): void {
        const S = 'Court (19n)';
        for (const e of arr(court?.events).map(rec)) {
            if (e === null || (e.kind !== 'concede' && e.kind !== 'refuse')) continue;
            this.bump(S, e.kind === 'concede' ? 'faction concessions' : 'faction refusals', '', this.colOf(galaxy, e.empire), `ce:${String(e.year)}:${(e.empire as Empire)?.empireId}:${String(e.kind)}:${String(e.text)}`);
        }
        for (const s of arr(intrigue?.schemes).map(rec)) {
            if (s === null) continue;
            this.bump(S, 'schemes started', '', this.colOf(galaxy, s.empire), `sc:${String(s.id)}`);
            this.bump(S, `scheme ${String(s.kind)}`, 'courtIntrigue.schemes', this.colOf(galaxy, s.empire), `sck:${String(s.id)}`);
        }
    }

    private sampleMisc(galaxy: Galaxy, st: Record<string, unknown>): void {
        const rep = rec(rec(st.reputation)?.pairs);
        if (rep !== null) {
            for (const key of Object.keys(rep)) {
                const owner = Number(key.split('>')[0].split(':')[0]);
                this.bump('Reputation (19o)', 'ledger pairs with entries', '', this.colOfId(galaxy, owner), `rep:${key}`);
            }
        }
        const esp = rec(st.espionage);
        for (const c of arr(esp?.crises).map(rec)) if (c !== null) this.bump('Espionage (19d3)', 'spy crises opened (offender)', '', this.colOf(galaxy, c.offender), `spc:${String(c.id)}`);
        for (const f of arr(esp?.frames).map(rec)) {
            if (f !== null) this.bump('Espionage (19d3)', 'missions framed (originator)', '', this.colOf(galaxy, f.originator), `spf:${(f.originator as Empire)?.empireId}:${String(f.since)}`);
        }
        const cr = rec(st.crises);
        for (const c of arr(cr?.crises).map(rec)) if (c !== null) this.bump('Crises (19d2)', 'resource crises opened', '', this.colOf(galaxy, c.empire), `cri:${String(c.id)}`);
        if (cr?.exports instanceof Map) {
            for (const [seller, list] of cr.exports as Map<Empire, unknown[]>) {
                for (const x of arr(list).map(rec)) {
                    if (x !== null) this.bump('Crises (19d2)', 'crisis export contracts (AI rule 3)', '', this.colOf(galaxy, seller), `cex:${seller.empireId}:${String(x.resourceId)}:${(x.buyer as Empire)?.empireId}:${String(x.year)}`);
                }
            }
        }
        if (cr?.miningPriority instanceof Map) {
            for (const [e, ids] of cr.miningPriority as Map<Empire, unknown[]>) this.bump('Crises (19d2)', 'mining priorities set (AI rule 2)', '', this.colOf(galaxy, e), `cmp:${e.empireId}:${arr(ids).join(',')}`);
        }
        const dem = rec(st.demographics);
        if (dem?.asylum instanceof Map) {
            for (const [e, pol] of dem.asylum as Map<Empire, unknown>) this.bump('Refugees (19d5)', 'asylum policies set', '', this.colOf(galaxy, e), `asy:${e.empireId}:${String(pol)}`);
        }
        for (const f of arr(dem?.flows).map(rec)) if (f !== null) this.bump('Refugees (19d5)', 'refugee flows', '', 'other', `rfl:${String(f.id)}`);
        if (dem !== null) this.row('Refugees (19d5)', 'refugee flows', '').unattributed = true;
        const herd = rec(st.rimHerders);
        if (herd !== null) {
            const stats = rec(herd.stats) ?? {};
            // Herder colonies are independents (AI actors): their protectorate / conquest / tribute totals are AI.
            this.total('Rim herders (19j)', 'protectorates', '', 'other', num(stats.protectorates));
            this.total('Rim herders (19j)', 'conquests', '', 'other', num(stats.conquests));
            this.total('Rim herders (19j)', 'conquest orders', '', 'other', num(stats.conquestOrders));
            this.total('Rim herders (19j)', 'tributes', '', 'other', num(stats.tributes));
            for (const k of arr(herd.kills).map(rec)) {
                if (k !== null) this.bump('Rim herders (19j)', 'herd hunts (kills)', '', this.colOfId(galaxy, num(k.empireId)), `hk:${String(k.herdId)}:${String(k.date)}:${String(k.empireId)}`);
            }
        }
        const fauna = rec(rec(st.rimFauna)?.stats);
        if (fauna !== null) this.total('Rim fauna (19g-7)', 'herds killed', '', 'other', num(fauna.herdsKilled));
        const ind = rec(rec(st.independents)?.stats);
        if (ind !== null) {
            this.total('Independents (19k)', 'leagues formed', '', 'ai', num(ind.leaguesFormed));
            this.total('Independents (19k)', 'league protectorates', '', 'ai', num(ind.protectorates));
            this.total('Independents (19k)', 'station buyouts / cleared / tolerated', '', 'other', num(ind.buyouts) + num(ind.cleared) + num(ind.tolerated));
            this.total('Independents (19k)', 'trade deals', '', 'ai', num(ind.tradeDeals));
        }
        const wr = rec(rec(st.wreckage)?.stats);
        if (wr !== null) {
            this.total('Wreckage (19e-7)', 'salvage trips', '', 'other', num(wr.salvageTrips));
            this.total('Wreckage (19e-7)', 'techs recovered', '', 'other', num(wr.techsRecovered));
        }
        for (const c of arr(rec(st['charteredCompanies.charters'])?.charters).map(rec)) {
            if (c !== null) this.bump('Chartered companies (19c)', 'charters granted', '', this.colOfId(galaxy, num(c.founderId)), `ch:${String(c.companyId)}:${String(c.startYear)}`);
        }
        for (const [id, e] of Object.entries(rec(st['lively.pirateAmbition']) ?? {})) {
            this.bump('Pirate ambition (19l)', 'factions gone ambitious', '', 'ai', `pa:${id}:${String(rec(e)?.firstSeizeDate)}`);
        }
    }

    private sampleEventLog(galaxy: Galaxy): void {
        for (const e of eventLogEntries(galaxy)) {
            if (e.id <= this.lastEventId) continue;
            this.lastEventId = e.id;
            this.eventSources.set(e.source, (this.eventSources.get(e.source) ?? 0) + 1);
        }
    }

    /** Every row with the totals folded in, grouped by system (declared order, then new rows alphabetically). */
    rows(): ParityRow[] {
        const out = [...this.rowsByKey.values()].map((r) => ({ ...r }));
        for (const [k, t] of this.totals) {
            const [system, counter] = k.split('\u0000');
            const r = out.find((x) => x.system === system && x.counter === counter);
            if (r !== undefined) r[t.col] += t.value;
        }
        const order = new Map<string, number>();
        DECLARED.forEach((d, i) => {
            if (!order.has(d.system)) order.set(d.system, i);
        });
        return out
            .map((r, i) => ({ r, i }))
            .sort((a, b) => (order.get(a.r.system) ?? 1e6) - (order.get(b.r.system) ?? 1e6) || a.r.system.localeCompare(b.r.system) || a.i - b.i)
            .map((x) => x.r);
    }

    /** Rows below the near-zero line (see nearZeroRows). */
    nearZero(years: number, threshold?: number): ParityRow[] {
        return nearZeroRows(this.rows(), years, threshold);
    }

    /** Systems never present in the run (not on this build or flag off). */
    absent(): string[] {
        return absentSystems(this.rows());
    }

    /** The report's data (rows + event-log sources): parityMarkdown renders it. */
    data(): ParityData {
        return { rows: this.rows(), eventSources: [...this.eventSources].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
    }
}

export interface ParityData {
    rows: ParityRow[];
    eventSources: [string, number][];
}

/** The default near-zero line: fewer than one per game year (0 for a run under a year). */
export function nearZeroThreshold(years: number): number {
    return Math.max(0, Math.ceil(years) - 1);
}

/** A decision the state only ever raised for the player (the AI decides that system directly, not through it). */
function playerOnlyDecision(r: ParityRow): boolean {
    return r.counter.startsWith('decision ') && r.ai === 0 && r.player + r.other > 0;
}

/**
 * Present rows whose AI activity is at most `threshold` (default nearZeroThreshold): AI count, plus Other where Other
 * holds unattributed totals. Decisions count by their "(answers)" row only; player-only decisions are listed apart.
 */
export function nearZeroRows(rows: readonly ParityRow[], years: number, threshold = nearZeroThreshold(years)): ParityRow[] {
    return rows.filter((r) => {
        if (!r.present) return false;
        if (r.counter.startsWith('decision ') && (!r.counter.endsWith('(answers)') || playerOnlyDecision(r))) return false;
        return r.ai + (r.unattributed ? r.other : 0) <= threshold;
    });
}

/** Decisions raised only for the player in the run ("(answers)" rows). */
export function playerOnlyDecisionRows(rows: readonly ParityRow[]): ParityRow[] {
    return rows.filter((r) => r.present && r.counter.endsWith('(answers)') && playerOnlyDecision(r));
}

/** Systems with no present row. */
export function absentSystems(rows: readonly ParityRow[]): string[] {
    const bySystem = new Map<string, boolean>();
    for (const r of rows) bySystem.set(r.system, (bySystem.get(r.system) ?? false) || r.present);
    return [...bySystem].filter(([, p]) => !p).map(([sys]) => sys);
}

export interface ParityMeta {
    date: string;
    seed: number;
    years: number;
    stars: number;
    empires: number;
    scenario: string;
    flags: string[];
    flagsOff: string[];
    wallSeconds: number;
    exceptions: number;
    /** First line of each chunk exception. */
    exceptionLines?: string[];
    samples: number;
}

/** The markdown report (tasks/AI-PARITY-<date>.md) from the audit's data. */
export function parityMarkdown(data: ParityData, meta: ParityMeta): string {
    const L: string[] = [];
    const th = nearZeroThreshold(meta.years);
    L.push(`# AI parity audit — ${meta.date}`);
    L.push('');
    L.push(
        `Headless run (scripts/ai-parity.mjs): seed ${meta.seed}, ${meta.stars} stars, ${meta.empires} empires, ${meta.years} game years, scenario \`${meta.scenario}\` with every flag on` +
            (meta.flagsOff.length > 0 ? ` except ${meta.flagsOff.map((f) => `\`${f}\``).join(', ')}` : '') +
            ` (${meta.flags.length} flags). ${meta.samples} samples, ${meta.wallSeconds.toFixed(0)} s wall, ${meta.exceptions} chunk exceptions.`,
    );
    L.push('');
    L.push('Columns: **AI** = done by / for an AI empire; **Player** = the player empire (it runs on its default automation in a headless run; nobody answers its decisions, so they expire into Other); **Other** = expired or automatic answers and totals the state does not attribute to an empire. Source = the state the counter reads.');
    L.push('');
    L.push('| System | Counter | AI | Player | Other | Source |');
    L.push('|---|---|---:|---:|---:|---|');
    for (const r of data.rows) {
        if (!r.present) continue;
        L.push(`| ${r.system} | ${r.counter} | ${r.ai} | ${r.player} | ${r.other} | ${r.source} |`);
    }
    L.push('');
    L.push(`## Near-zero AI usage (≤ ${th} in ${meta.years} years)`);
    L.push('');
    L.push('The rule-tuning list for 19s-3 (candidates for the model-driven strategic layer, or for AI rule fixes). AI count, plus Other where Other holds unattributed totals; decisions by their "(answers)" row:');
    L.push('');
    const nz = nearZeroRows(data.rows, meta.years);
    if (nz.length === 0) L.push('- (none)');
    for (const r of nz) L.push(`- ${r.system}: ${r.counter} — AI ${r.ai}, player ${r.player}, other ${r.other}`);
    const po = playerOnlyDecisionRows(data.rows);
    if (po.length > 0) {
        L.push('');
        L.push('Player-only decisions (raised only for the player; the AI decides these directly, so they are not near-zero AI usage):');
        L.push('');
        for (const r of po) L.push(`- ${r.system}: ${r.counter.replace(' (answers)', '')} — ${r.player + r.other} raised, ${r.other} expired`);
    }
    L.push('');
    const absent = absentSystems(data.rows);
    L.push('## Not present in this run');
    L.push('');
    if (absent.length === 0) L.push('- (none)');
    for (const sys of absent) L.push(`- ${sys} (not on this build, or never initialised in ${meta.years} years)`);
    L.push('');
    if ((meta.exceptionLines ?? []).length > 0) {
        L.push('## Chunk exceptions (the soak continued)');
        L.push('');
        for (const e of meta.exceptionLines!) L.push(`- ${e}`);
        L.push('');
    }
    L.push('## Event log entries by source');
    L.push('');
    L.push('| Source | Entries |');
    L.push('|---|---:|');
    for (const [src, n] of data.eventSources) L.push(`| ${src} | ${n} |`);
    L.push('');
    return L.join('\n');
}

/** Flags excluded from "every flag on" by default: the Dark Farms game end would stop the soak early. */
export const PARITY_DEFAULT_OFF: readonly string[] = ['darkFarmsGameEnd'];

/** The audit's flag choice: every flag of the (merged) manifest on, except `off`. */
export function parityFlags(flags: readonly { name: string }[], off: readonly string[] = PARITY_DEFAULT_OFF): Record<string, boolean> {
    return Object.fromEntries(flags.map((f) => [f.name, !off.includes(f.name)]));
}
