// P1 RULERS' MEMORY (the diary), sim side (flag llmMemory of the llm-layer scenario). Not a port.
//
// Each major empire keeps a short list of dated FACTS about every other major empire (what that ruler remembers of the
// other), captured from the scenario events by flag-gated handlers: plain ints, empire ids, no Rnd, no lazy creation of
// other packages' state. The text (memoryLines), the mood word and the digest feed are pure renderers over the bag.
//
// ATTITUDE (user decision D2): a small, bounded, monthly nudge through the 19o reputation ledger (the one attitude
// channel; so it needs the Reputation ledger add-on, else the diary stays text only). Per ordered pair the nudge is the
// age-decayed sum of the facts' `att` values, clamped to +-ATTITUDE_CAP incident units, written as ONE ledger entry
// (cause llmMemory.diary, no yearly fade: the monthly pass re-sets it as facts age). To avoid DOUBLE COUNTING, only facts
// the stock C# does not already turn into attitude carry `att` (peace, treaties signed, helped against pirates, joined a
// war against us, ceded land); war declarations, gifts, treaty breaks, colonies taken, spies caught, and war damage all
// already move EmpireEvaluation in the stock code or the ledger, so they are diary text only (att 0).
import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { DiplomaticRelationType } from '../../diplomacy';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { registerScenarioEvent, registerScenarioPeriodic } from '../hooks';
import { scenarioState } from '../state';
import { reputationCauses, recordReputation, reputationOn } from '../reputation/ledger';

export const LLM_MEMORY_FLAG = 'llmMemory';
export const LLM_MEMORY_STATE = 'llmMemory';
const SCENARIO_ID = 'llm-layer';

export type FactKind = 'declaredWarOnUs' | 'weDeclaredWar' | 'peace' | 'treatySigned' | 'treatyBroken' | 'gift'
    | 'helpedVsPirates' | 'tookColony' | 'cededColony' | 'spyCaught' | 'joinedWarAgainstUs';

export interface MemoryFact {
    k: FactKind;
    /** Star date first seen / last merged. */
    d: number;
    last: number;
    /** Times merged. */
    n: number;
    /** Signed weight -10..+10 (the remembering ruler's view). */
    w: number;
    /** Amount (credits, colonies). */
    x?: number;
}

export interface MemoryState {
    v: 1;
    /** `${a}>${b}`: a remembers b. */
    pairs: Record<string, MemoryFact[]>;
}

/** w: diary weight; att: attitude weight (0 = the stock game already counts it); text: the diary line. */
const KINDS: Record<FactKind, { w: number; att: number; text: string }> = {
    declaredWarOnUs: { w: -8, att: 0, text: 'they declared war on us' },
    weDeclaredWar: { w: 0, att: 0, text: 'we declared war on them' },
    peace: { w: 3, att: 1, text: 'we made peace' },
    treatySigned: { w: 3, att: 1, text: 'we signed a treaty' },
    treatyBroken: { w: -6, att: 0, text: 'they tore up our treaty' },
    gift: { w: 2, att: 0, text: 'they sent us a gift' },
    helpedVsPirates: { w: 3, att: 1, text: 'their warships drove pirates from our space' },
    tookColony: { w: -6, att: 0, text: 'they took one of our colonies' },
    cededColony: { w: -2, att: 1, text: 'we ceded a colony to them in a treaty' },
    spyCaught: { w: -4, att: 0, text: 'we caught their spies' },
    joinedWarAgainstUs: { w: -4, att: -1, text: 'they joined a war against us' },
};

export const MEMORY_MAX_FACTS = 12;
export const ATTITUDE_CAP = 6;
/** Facts fade linearly to nothing over this many years. */
export const MEMORY_YEARS = 6;

export function memoryOn(galaxy: Galaxy | null | undefined): boolean {
    return galaxy != null && galaxy.scenario != null && galaxy.scenario.flags[LLM_MEMORY_FLAG] === true;
}

export function peekMemory(galaxy: Galaxy): MemoryState | null {
    const s = galaxy.scenario;
    if (s == null || !(LLM_MEMORY_STATE in s.state)) return null;
    return s.state[LLM_MEMORY_STATE] as MemoryState;
}

function isMajor(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

function recency(f: MemoryFact, now: number): number {
    return Math.max(0, 1 - (now - f.last) / (MEMORY_YEARS * YEAR_LENGTH));
}

/** Records "a remembers b: kind" (merges a same-kind fact within a year; caps the pair). */
export function remember(galaxy: Galaxy, a: Empire, b: Empire, k: FactKind, x?: number): void {
    if (a === b || !isMajor(galaxy, a) || !isMajor(galaxy, b)) return;
    const now = galaxyStarDate(galaxy);
    const st = scenarioState<MemoryState>(galaxy, LLM_MEMORY_STATE, () => ({ v: 1, pairs: {} }));
    const key = `${a.empireId}>${b.empireId}`;
    const list = (st.pairs[key] ??= []);
    for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i];
        if (f.k === k && now - f.last < YEAR_LENGTH) {
            f.n++;
            f.last = now;
            if (x !== undefined) f.x = (f.x ?? 0) + x;
            return;
        }
    }
    const fact: MemoryFact = { k, d: now, last: now, n: 1, w: KINDS[k].w };
    if (x !== undefined) fact.x = x;
    list.push(fact);
    while (list.length > MEMORY_MAX_FACTS) {
        let worst = 0;
        let ws = Infinity;
        for (let i = 0; i < list.length; i++) {
            const s = Math.abs(list[i].w) * recency(list[i], now);
            if (s < ws || (s === ws && list[i].d < list[worst].d)) { ws = s; worst = i; }
        }
        list.splice(worst, 1);
    }
}

/** The ruler a's decayed mood toward b (sum of w x recency). */
export function memoryScore(galaxy: Galaxy, a: Empire, b: Empire): number {
    const list = peekMemory(galaxy)?.pairs[`${a.empireId}>${b.empireId}`];
    if (list === undefined) return 0;
    const now = galaxyStarDate(galaxy);
    let s = 0;
    for (const f of list) s += f.w * recency(f, now);
    return Math.round(s * 10) / 10;
}

export function moodWord(score: number): string {
    if (score <= -10) return 'bitter';
    if (score <= -4) return 'wary';
    if (score >= 8) return 'grateful';
    if (score >= 3) return 'warm';
    return 'neutral';
}

/** Newest-first diary lines "YYYY text" and the mood. Pure; the scripted fallback and the digest feed. */
export function memoryLines(galaxy: Galaxy, a: Empire, b: Empire, max: number): { score: number; mood: string; lines: string[] } {
    const list = peekMemory(galaxy)?.pairs[`${a.empireId}>${b.empireId}`] ?? [];
    const sorted = list.map((f, i) => ({ f, i })).sort((p, q) => q.f.last - p.f.last || q.i - p.i);
    const lines = sorted.slice(0, Math.max(0, max)).map(({ f }) => {
        const year = Math.floor(f.last / YEAR_LENGTH);
        const t = KINDS[f.k].text + (f.k === 'gift' && f.x ? ` (${Math.round(f.x)} credits)` : '') + (f.n > 1 ? ` (x${f.n})` : '');
        return `${year} ${t}`;
    });
    const score = memoryScore(galaxy, a, b);
    return { score, mood: moodWord(score), lines };
}

/** The attitude nudge of a toward b (integer, +-ATTITUDE_CAP). */
export function memoryAttitude(galaxy: Galaxy, a: Empire, b: Empire): number {
    const list = peekMemory(galaxy)?.pairs[`${a.empireId}>${b.empireId}`];
    if (list === undefined) return 0;
    const now = galaxyStarDate(galaxy);
    let s = 0;
    for (const f of list) s += Math.abs(f.w) * KINDS[f.k].att * Math.sign(f.w || 1) * recency(f, now);
    return Math.max(-ATTITUDE_CAP, Math.min(ATTITUDE_CAP, Math.round(s)));
}

/** Top grudges / favours of `e` over the other majors (two each, one compact line each). */
export function memorySummary(galaxy: Galaxy, e: Empire): { grudges: string[]; favours: string[] } | null {
    const st = peekMemory(galaxy);
    if (st === null) return null;
    const rows: { o: Empire; s: number }[] = [];
    for (const o of galaxy.empires) {
        if (o === null || o === e || !isMajor(galaxy, o)) continue;
        const s = memoryScore(galaxy, e, o);
        if (s !== 0) rows.push({ o, s });
    }
    if (rows.length === 0) return null;
    const line = (r: { o: Empire; s: number }): string => {
        const m = memoryLines(galaxy, e, r.o, 1);
        return `${r.o.name} (${m.mood}): ${m.lines[0] ?? ''}`.slice(0, 120);
    };
    const bad = rows.filter((r) => r.s < 0).sort((p, q) => p.s - q.s || p.o.empireId - q.o.empireId).slice(0, 2);
    const good = rows.filter((r) => r.s > 0).sort((p, q) => q.s - p.s || p.o.empireId - q.o.empireId).slice(0, 2);
    return { grudges: bad.map(line), favours: good.map(line) };
}

// ---------------------------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------------------------

const TREATIES = new Set<number>([DiplomaticRelationType.FreeTradeAgreement, DiplomaticRelationType.MutualDefensePact, DiplomaticRelationType.Protectorate]);

function relType(a: Empire, b: Empire): number {
    return a.diplomaticRelations.byEmpire(b)?.type ?? DiplomaticRelationType.NotMet;
}

const gate = { scenarioId: SCENARIO_ID, flag: LLM_MEMORY_FLAG } as const;

registerScenarioEvent({
    id: 'llmMemory.warDeclared', ...gate, event: 'warDeclared',
    run: (g, p) => {
        remember(g, p.target, p.empire, 'declaredWarOnUs');
        remember(g, p.empire, p.target, 'weDeclaredWar');
        // "Joined": the declarer is allied (MDP) with a major already at war with the target.
        for (const c of g.empires) {
            if (c === null || c === p.empire || c === p.target || !isMajor(g, c)) continue;
            if (relType(p.empire, c) === DiplomaticRelationType.MutualDefensePact && relType(c, p.target) === DiplomaticRelationType.War) {
                remember(g, p.target, p.empire, 'joinedWarAgainstUs');
                break;
            }
        }
    },
});

registerScenarioEvent({
    id: 'llmMemory.peaceSigned', ...gate, event: 'peaceSigned',
    run: (g, p) => {
        remember(g, p.empire, p.other, 'peace');
        remember(g, p.other, p.empire, 'peace');
    },
});

registerScenarioEvent({
    id: 'llmMemory.relation', ...gate, event: 'diplomaticRelationChanged',
    run: (g, p) => {
        if (TREATIES.has(p.to) && !TREATIES.has(p.from)) {
            remember(g, p.empire, p.other, 'treatySigned');
            remember(g, p.other, p.empire, 'treatySigned');
        } else if (TREATIES.has(p.from) && !TREATIES.has(p.to) && p.to !== DiplomaticRelationType.NotMet) {
            // The empire that changed the relation tore the treaty up.
            remember(g, p.other, p.empire, 'treatyBroken');
        }
    },
});

registerScenarioEvent({
    id: 'llmMemory.colony', ...gate, event: 'colonyOwnerChanged',
    run: (g, p) => {
        if (p.from === null || p.to === null || p.from === p.to) return;
        // Taken in a war, else handed over (peace terms, treaty cession).
        remember(g, p.from, p.to, relType(p.from, p.to) === DiplomaticRelationType.War ? 'tookColony' : 'cededColony', 1);
    },
});

registerScenarioEvent({
    id: 'llmMemory.spy', ...gate, event: 'intelMissionExposed',
    run: (g, p) => {
        if (p.blamed !== p.target) remember(g, p.target, p.blamed, 'spyCaught');
    },
});

registerScenarioEvent({
    id: 'llmMemory.gift', ...gate, event: 'giftGiven',
    run: (g, p) => remember(g, p.receiver, p.giver, 'gift', Math.round(p.amount)),
});

registerScenarioEvent({
    id: 'llmMemory.pirateKill', ...gate, event: 'builtObjectKilledBy',
    run: (g, p) => {
        const d = p.destroyer;
        const v = p.builtObject.actualEmpire;
        if (d === null || v === null || v.pirateEmpireBaseHabitat === null || !isMajor(g, d)) return;
        // The major whose colonised system the pirate died in (first in empire order).
        for (const o of g.empires) {
            if (o === null || o === d || !isMajor(g, o)) continue;
            for (const c of o.colonies) {
                if (c.hasBeenDestroyed) continue;
                const star = g.determineHabitatSystemStar(c);
                if (g.calculateDistance(p.builtObject.xpos, p.builtObject.ypos, star.xpos, star.ypos) <= g.maxSolarSystemSize) {
                    remember(g, o, d, 'helpedVsPirates');
                    return;
                }
            }
        }
    },
});

// ---------------------------------------------------------------------------------------------------------------
// The monthly attitude pass
// ---------------------------------------------------------------------------------------------------------------

const CAUSE = 'llmMemory.diary';

registerScenarioPeriodic({
    id: 'llmMemory.attitude', ...gate, periodDays: 30,
    run: (g) => {
        const st = peekMemory(g);
        if (st === null || !reputationOn(g)) return;
        for (const key of Object.keys(st.pairs)) { // insertion order
            const [ia, ib] = key.split('>').map(Number);
            const a = g.empires.find((e) => e !== null && e.empireId === ia);
            const b = g.empires.find((e) => e !== null && e.empireId === ib);
            if (a == null || b == null) continue;
            const target = memoryAttitude(g, a, b);
            const cur = reputationCauses(g, a, b).find((e) => e.cause === CAUSE)?.value ?? 0;
            if (target !== cur) recordReputation(g, a, b, { cause: CAUSE, labelKey: 'Reputation Cause llmMemory.diary', value: target - cur, decayPerYear: 0, source: 'llmMemory' });
        }
    },
});
