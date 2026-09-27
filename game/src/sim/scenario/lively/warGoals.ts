// Scenario package "lively-galaxy", flag `warGoals` (task 19g-3: war goals & peace terms). Not a port: a layer over the
// faithful war code. This file holds the state, the war goals, the war-score ledger, demilitarised systems and the
// humiliation / casus-belli memory; peaceTerms.ts holds the terms (pricing, AI proposal / acceptance, application, the
// player's commands).
//
//  - War goals: at war start (diplomacyTick.ts declareWar, Empire.7.cs 4883 DeclareWar → event `warDeclared`, after both
//    sides' SetWarObjectives, Empire.7.cs 4790) each side records a goal: a free casus belli from broken terms, the
//    conquest objective it prepared (DiplomaticRelation.WarObjectiveColonies), a border colony from a 19l incident, freeing
//    a subject of the enemy, punishing the aggressor (the side that was attacked) or "humiliate" (reparations only). AIs
//    take the first that applies; the player picks from a scenario decision (answered through the command queue: player
//    op `answerDecision`).
//  - War score: a per-war ledger fed by the ported war-damage sites (event `warDamageInflicted`: Galaxy.3.cs 529 / 541
//    InflictWarDamage, valued by 474 / 507 CalculateWarValue), colony ownership changes (event `colonyOwnerChanged`:
//    Empire.1.cs 64 TakeOwnershipOfColony), blockades (sampled from Galaxy.Blockades, BlockadeList.cs 54) and time.
//  - Demilitarised systems: a treaty that refuses the restricted empire's warships any mission into the named systems
//    (query `assignMissionAllowed` at BuiltObject.2.cs 7620 AssignMission, next to its 7622 precondition return). A
//    warship of that empire found inside such a system after the grace period breaks the treaty: the victim's
//    evaluation drops (EmpireEvaluation.IncidentEvaluation, as the C# incidents do) and it gains a casus belli — a free
//    war goal plus war-score bonus in the next war, and a war-review relaxation meanwhile (query
//    `warReviewAttitudeRelax`, Empire.8.cs 100/139).
//  - Humiliation: the side that conceded terms remembers them (decaying yearly) as a war-review relaxation against the
//    victor; the signing also lowers its IncidentEvaluation of the victor (which the stock evaluation review then decays,
//    diplomacyTick.ts evaluatePoliticalSituation 1107-1112).
//
// Rnd: none. Every handler here and in peaceTerms.ts is deterministic (no galaxy.rnd draw), so the flag changes only the
// state it touches.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { calculateWarValueHabitat } from '../../combat/damage';
import { galaxyBlockades } from '../../fleets/blockades';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { raiseScenarioDecision, registerScenarioDecision, type ScenarioDecision } from '../decisions';
import { scenarioFlag, scenarioParam, scenarioRuns, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { tryGetText } from '../../textResolver';
import { messageAbout, noteVoiceCue, seatLabel, seatSpeaker, voicesOn } from '../llm/voiceCues';
import { LIVELY_GALAXY_ID, OVERLAP_GRID, borderOverlaps, incidentCount } from './livelyGalaxy';

export const WAR_GOALS_FLAG = 'warGoals';

// ---------------------------------------------------------------------------------------------------------------
// State (galaxy.scenario.state['warGoals']; plain objects holding graph references — saved by the galaxy codec)
// ---------------------------------------------------------------------------------------------------------------

export type WarGoalKind = 'casusBelli' | 'conquest' | 'border' | 'freeSubject' | 'punish' | 'humiliate';

export interface WarGoal {
    kind: WarGoalKind;
    /** Target colonies (conquest: the prepared objectives still held by the enemy; border: the disputed colony). */
    colonies: Habitat[];
    /** freeSubject: the enemy's subject to free. */
    subject: Empire | null;
}

export interface WarSide {
    empire: Empire;
    goal: WarGoal;
    /** Who chose the goal: the AI, the player (decision answered) or still pending (player's provisional default). */
    chosenBy: 'ai' | 'player' | 'pending';
    shipsDestroyed: number;
    shipValue: number;
    coloniesTaken: number;
    colonyValue: number;
    invasions: number;
    invasionValue: number;
    blockadeDays: number;
    /** Flat bonus (casus belli). */
    bonus: number;
}

export interface WarLedger {
    a: WarSide;
    b: WarSide;
    attacker: Empire;
    startDate: number;
    /** Star date of the last blockade sample. */
    lastSample: number;
}

export interface CedeTerm {
    colony: Habitat;
    from: Empire;
    to: Empire;
}
export interface ReparationTerm {
    payer: Empire;
    payee: Empire;
    /** Paid at signing. */
    lump: number;
    /** Paid at each new game year for `years` years. */
    perYear: number;
    years: number;
}
export interface DemilTerm {
    /** The empire whose warships are kept out. */
    empire: Empire;
    beneficiary: Empire;
    /** System stars. */
    systems: Habitat[];
    years: number;
}
export interface ReleaseTerm {
    overlord: Empire;
    subject: Empire;
}
/** A peace offer's terms. Everything empty = status quo. */
export interface PeaceTerms {
    cede: CedeTerm[];
    reparations: ReparationTerm | null;
    demilitarise: DemilTerm | null;
    release: ReleaseTerm | null;
}

export interface DemilTreaty {
    empire: Empire;
    beneficiary: Empire;
    systems: Habitat[];
    signed: number;
    until: number;
    graceUntil: number;
}

export interface ReparationPlan {
    payer: Empire;
    payee: Empire;
    perYear: number;
    yearsLeft: number;
}

export interface WarGoalsState {
    /** Open wars, key `${lowerEmpireId}:${higherEmpireId}`. */
    wars: Record<string, WarLedger>;
    /** Standing peace offers, key `${proposerId}:${recipientId}`. */
    offers: Record<string, PeaceTerms>;
    treaties: DemilTreaty[];
    reparations: ReparationPlan[];
    /** Remembered humiliation (term points), key `${humiliatedId}:${victorId}`. */
    humiliations: Record<string, number>;
    /** Casus belli held, key `${victimId}:${breacherId}` → star date granted. */
    casusBelli: Record<string, number>;
}

const STATE_KEY = 'warGoals';

export function warGoalsState(galaxy: Galaxy): WarGoalsState {
    return scenarioState<WarGoalsState>(galaxy, STATE_KEY, () => ({ wars: {}, offers: {}, treaties: [], reparations: [], humiliations: {}, casusBelli: {} }));
}

/** The state without creating it (queries must not mutate). */
function peekState(galaxy: Galaxy): WarGoalsState | null {
    const s = galaxy.scenario;
    if (s === null) return null;
    return (s.state[STATE_KEY] as WarGoalsState | undefined) ?? null;
}

export function warKey(a: Empire, b: Empire): string {
    return a.empireId < b.empireId ? `${a.empireId}:${b.empireId}` : `${b.empireId}:${a.empireId}`;
}

export function pairKey(from: Empire, to: Empire): string {
    return `${from.empireId}:${to.empireId}`;
}

export function atWar(a: Empire, b: Empire): boolean {
    const r = a.diplomaticRelations.byEmpire(b);
    return r !== null && r.type === DiplomaticRelationType.War;
}

export function warGoalsOn(galaxy: Galaxy): boolean {
    return scenarioRuns(galaxy.scenario, LIVELY_GALAXY_ID) && scenarioFlag(galaxy, WAR_GOALS_FLAG);
}

function isMajor(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

// ---------------------------------------------------------------------------------------------------------------
// War goals
// ---------------------------------------------------------------------------------------------------------------

function goal(kind: WarGoalKind, colonies: Habitat[] = [], subject: Empire | null = null): WarGoal {
    return { kind, colonies, subject };
}

/** The empires `overlord` holds as subjugated dominions (DiplomaticRelationType.SubjugatedDominion, initiator = overlord). */
export function subjectsOf(overlord: Empire): Empire[] {
    const out: Empire[] = [];
    for (const r of overlord.diplomaticRelations) {
        if (r.type === DiplomaticRelationType.SubjugatedDominion && r.initiator === overlord && r.otherEmpire !== null && r.otherEmpire.active) out.push(r.otherEmpire);
    }
    return out;
}

/** The enemy colony in the 19l border overlap nearest `self`'s capital (null: no overlap colony). */
function borderColony(galaxy: Galaxy, self: Empire, enemy: Empire): Habitat | null {
    const pair = borderOverlaps(galaxy).find((p) => (p.a === self && p.b === enemy) || (p.a === enemy && p.b === self));
    if (pair === undefined) return null;
    const n = OVERLAP_GRID;
    const cw = galaxy.sizeX / n;
    const ch = galaxy.sizeY / n;
    const cap = self.capital;
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const c of enemy.colonies) {
        if (c === null || c.empire !== enemy || c === enemy.capital) continue;
        const cell = Math.min(n - 1, Math.max(0, Math.trunc(c.xpos / cw))) * n + Math.min(n - 1, Math.max(0, Math.trunc(c.ypos / ch)));
        if (!pair.cells.has(cell)) continue;
        const d = cap === null ? 0 : (c.xpos - cap.xpos) ** 2 + (c.ypos - cap.ypos) ** 2;
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best;
}

/**
 * The goals `self` may pursue against `enemy`, most specific first (the AI takes the first): a casus belli it holds, the
 * conquest objectives its war review prepared (Empire.7.cs 4790 SetWarObjectives → WarObjectiveColonies still owned by
 * the enemy), a border colony if it remembers 19l incidents, freeing the enemy's subject, punishing the aggressor
 * (`self` was attacked), and "humiliate" (reparations only; always offered). No Rnd.
 */
export function warGoalCandidates(galaxy: Galaxy, self: Empire, enemy: Empire, attacker: Empire): WarGoal[] {
    const out: WarGoal[] = [];
    const st = peekState(galaxy);
    if (st !== null && st.casusBelli[pairKey(self, enemy)] !== undefined) out.push(goal('casusBelli'));
    const rel = obtainDiplomaticRelation(self, enemy);
    const objectives = rel.warObjectiveColonies.filter((c) => c != null && !c.hasBeenDestroyed && c.empire === enemy).slice(0, 3);
    if (objectives.length > 0) out.push(goal('conquest', objectives));
    if (incidentCount(galaxy, self, enemy) > 0 || incidentCount(galaxy, enemy, self) > 0) {
        const c = borderColony(galaxy, self, enemy);
        if (c !== null) out.push(goal('border', [c]));
    }
    const subjects = subjectsOf(enemy).filter((x) => x !== self);
    if (subjects.length > 0) out.push(goal('freeSubject', [], subjects[0]));
    if (attacker === enemy) out.push(goal('punish'));
    out.push(goal('humiliate'));
    return out;
}

export function describeGoal(g: WarGoal): string {
    switch (g.kind) {
        case 'casusBelli':
            return scenarioText('Lively Goal CasusBelli');
        case 'conquest':
            return scenarioText('Lively Goal Conquest', g.colonies.map((c) => c.name).join(', '));
        case 'border':
            return scenarioText('Lively Goal Border', g.colonies.map((c) => c.name).join(', '));
        case 'freeSubject':
            return scenarioText('Lively Goal FreeSubject', g.subject?.name ?? '');
        case 'punish':
            return scenarioText('Lively Goal Punish');
        case 'humiliate':
            return scenarioText('Lively Goal Humiliate');
    }
}

/** describeGoal without the event-log text note (the voices read it outside the message path). */
function describeGoalPlain(g: WarGoal): string {
    const names = g.colonies.map((c) => c.name).join(', ');
    const tag = { casusBelli: 'CasusBelli', conquest: 'Conquest', border: 'Border', freeSubject: 'FreeSubject', punish: 'Punish', humiliate: 'Humiliate' }[g.kind];
    const t = tryGetText(`Lively Goal ${tag}`) ?? g.kind;
    return t.replace('{0}', g.kind === 'freeSubject' ? (g.subject?.name ?? '') : names);
}

function newSide(empire: Empire, g: WarGoal, chosenBy: WarSide['chosenBy']): WarSide {
    return { empire, goal: g, chosenBy, shipsDestroyed: 0, shipValue: 0, coloniesTaken: 0, colonyValue: 0, invasions: 0, invasionValue: 0, blockadeDays: 0, bonus: 0 };
}

export const WAR_GOAL_DECISION = 'lively.warGoal';

/** Records both sides' goals for a new war (`attacker` declared on `target`). Exported for tests. */
export function startWarLedger(galaxy: Galaxy, attacker: Empire, target: Empire): WarLedger {
    const st = warGoalsState(galaxy);
    const now = galaxyStarDate(galaxy);
    const sides: WarSide[] = [];
    const decisions: { side: WarSide; enemy: Empire; candidates: WarGoal[] }[] = [];
    for (const [self, enemy] of [
        [attacker, target],
        [target, attacker],
    ] as const) {
        const candidates = warGoalCandidates(galaxy, self, enemy, attacker);
        const isPlayer = self === galaxy.playerEmpire;
        const side = newSide(self, candidates[0], isPlayer ? 'pending' : 'ai');
        if (candidates[0].kind === 'casusBelli') {
            side.bonus += scenarioParam(galaxy, 'casusBelliScore', 150);
            delete st.casusBelli[pairKey(self, enemy)];
        }
        sides.push(side);
        if (isPlayer) decisions.push({ side, enemy, candidates });
    }
    const ledger: WarLedger = { a: sides[0], b: sides[1], attacker, startDate: now, lastSample: now };
    st.wars[warKey(attacker, target)] = ledger;
    delete st.offers[pairKey(attacker, target)];
    delete st.offers[pairKey(target, attacker)];
    for (const d of decisions) {
        const dec = raiseScenarioDecision(galaxy, d.side.empire, {
            kind: WAR_GOAL_DECISION,
            title: scenarioText('Lively Goal Title'),
            text: scenarioText('Lively Goal Question', d.enemy.name),
            options: d.candidates.map((c, i) => ({ id: String(i), label: describeGoal(c) })),
            defaultOption: '0',
            expiresDays: scenarioParam(galaxy, 'warGoalDecisionDays', 30),
            context: { enemy: d.enemy, candidates: d.candidates },
        });
        // 19s-2 voices (flag llmVoices; inert otherwise, no state): the marshal argues for the goal on the table.
        if (voicesOn(galaxy)) {
            const marshal = seatSpeaker(galaxy, d.side.empire, 'marshal');
            noteVoiceCue(galaxy, {
                kind: 'marshal',
                empire: d.side.empire,
                message: messageAbout(d.side.empire, dec),
                voice: d.side.empire,
                other: d.enemy,
                speaker: marshal,
                role: seatLabel('marshal', marshal),
                facts: {
                    enemy: d.enemy.name,
                    weDeclared: attacker === d.side.empire,
                    recommendedGoal: describeGoalPlain(d.candidates[0]),
                    otherGoals: d.candidates.slice(1).map(describeGoalPlain).join('; '),
                    casusBelliBonus: d.side.bonus,
                },
                ref: dec,
            });
        }
    }
    return ledger;
}

/** The open war ledger between `a` and `b` (created lazily for a war that began outside DeclareWar), or null at peace. */
export function warLedger(galaxy: Galaxy, a: Empire, b: Empire): WarLedger | null {
    if (!atWar(a, b)) return null;
    const st = warGoalsState(galaxy);
    const l = st.wars[warKey(a, b)];
    if (l !== undefined) return l;
    const rel = obtainDiplomaticRelation(a, b);
    const attacker = rel.initiator === b ? b : a;
    return startWarLedger(galaxy, attacker, attacker === a ? b : a);
}

/** Read-only ledger lookup (UI, queries): null when none is recorded. */
export function peekWarLedger(galaxy: Galaxy, a: Empire, b: Empire): WarLedger | null {
    const st = peekState(galaxy);
    if (st === null || !atWar(a, b)) return null;
    return st.wars[warKey(a, b)] ?? null;
}

export function sideOf(ledger: WarLedger, e: Empire): WarSide {
    return ledger.a.empire === e ? ledger.a : ledger.b;
}

export function enemySideOf(ledger: WarLedger, e: Empire): WarSide {
    return ledger.a.empire === e ? ledger.b : ledger.a;
}

registerScenarioDecision({
    id: WAR_GOAL_DECISION,
    kind: WAR_GOAL_DECISION,
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    resolve: (g, d: ScenarioDecision, optionId) => {
        const enemy = d.context.enemy as Empire;
        const candidates = d.context.candidates as WarGoal[];
        const ledger = peekWarLedger(g, d.empire, enemy);
        const chosen = candidates[Number(optionId)];
        if (ledger === null || chosen === undefined) return;
        const side = sideOf(ledger, d.empire);
        side.goal = chosen;
        side.chosenBy = d.answeredBy === 'player' ? 'player' : 'ai';
    },
});

// ---------------------------------------------------------------------------------------------------------------
// War score
// ---------------------------------------------------------------------------------------------------------------

/** True when `side` holds its goal on the map (a goal colony captured, the subject freed). */
export function goalAchieved(galaxy: Galaxy, ledger: WarLedger, side: WarSide): boolean {
    const enemy = enemySideOf(ledger, side.empire).empire;
    void galaxy;
    switch (side.goal.kind) {
        case 'conquest':
        case 'border':
            return side.goal.colonies.some((c) => c.empire === side.empire);
        case 'freeSubject': {
            const s = side.goal.subject;
            if (s === null) return false;
            const r = enemy.diplomaticRelations.byEmpire(s);
            return r === null || r.type !== DiplomaticRelationType.SubjugatedDominion;
        }
        default:
            return false;
    }
}

/** A side's war score in points (war-value units: Galaxy.3.cs 474 / 507 CalculateWarValue). */
export function sideScore(galaxy: Galaxy, ledger: WarLedger, side: WarSide): number {
    let s = side.shipValue;
    s += side.colonyValue * scenarioParam(galaxy, 'warScoreColonyFactor', 2);
    s += side.invasions * scenarioParam(galaxy, 'warScoreInvasion', 50);
    s += side.blockadeDays * scenarioParam(galaxy, 'warScoreBlockadePerDay', 1);
    s += side.bonus;
    if (goalAchieved(galaxy, ledger, side)) s += scenarioParam(galaxy, 'warScoreGoalBonus', 200);
    return s;
}

/** `e`'s lead over its enemy in war-score points (negative: behind). 0 when no ledger. */
export function warScoreLead(galaxy: Galaxy, e: Empire, enemy: Empire): number {
    const l = peekWarLedger(galaxy, e, enemy);
    if (l === null) return 0;
    return sideScore(galaxy, l, sideOf(l, e)) - sideScore(galaxy, l, enemySideOf(l, e));
}

/** `e`'s war score as a balance in [-100, 100] (0 = even). */
export function warScoreBalance(galaxy: Galaxy, e: Empire, enemy: Empire): number {
    const l = peekWarLedger(galaxy, e, enemy);
    if (l === null) return 0;
    const a = sideScore(galaxy, l, sideOf(l, e));
    const b = sideScore(galaxy, l, enemySideOf(l, e));
    return Math.round((100 * (a - b)) / (a + b + 1));
}

registerScenarioEvent({
    id: 'lively.warGoals.declared',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    event: 'warDeclared',
    run: (g, p) => {
        if (!isMajor(g, p.empire) || !isMajor(g, p.target)) return;
        startWarLedger(g, p.empire, p.target);
    },
});

registerScenarioEvent({
    id: 'lively.warGoals.damage',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    event: 'warDamageInflicted',
    run: (g, p) => {
        if (!isMajor(g, p.inflictor) || !isMajor(g, p.victim)) return;
        const l = warLedger(g, p.inflictor, p.victim);
        if (l === null) return;
        const side = sideOf(l, p.inflictor);
        if (p.builtObject !== null) {
            side.shipsDestroyed++;
            side.shipValue += p.value;
        } else {
            side.invasions++;
            side.invasionValue += p.value;
        }
    },
});

registerScenarioEvent({
    id: 'lively.warGoals.colony',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    event: 'colonyOwnerChanged',
    run: (g, p) => {
        if (!isMajor(g, p.from) || !isMajor(g, p.to) || p.from === p.to) return;
        const l = warLedger(g, p.to, p.from);
        if (l === null) return;
        const side = sideOf(l, p.to);
        side.coloniesTaken++;
        // Galaxy.3.cs 507 CalculateWarValue(habitat): strategic value / 50 (the colony now has its new owner).
        side.colonyValue += Math.max(1, calculateWarValueHabitat(g, p.colony));
    },
});

/** Samples blockades into the open ledgers (BlockadeList.cs 54 GetBlockadesForEmpire, by initiator). Exported for tests. */
export function sampleBlockades(galaxy: Galaxy): void {
    const st = warGoalsState(galaxy);
    const now = galaxyStarDate(galaxy);
    const blockades = galaxyBlockades(galaxy);
    for (const key of Object.keys(st.wars)) {
        const l = st.wars[key];
        const days = Math.max(0, (now - l.lastSample) / GAME_DAY_LENGTH);
        l.lastSample = now;
        if (!atWar(l.a.empire, l.b.empire)) continue;
        for (const b of blockades) {
            if (b.initiator === l.a.empire && b.blockadedEmpire === l.b.empire) l.a.blockadeDays += days;
            else if (b.initiator === l.b.empire && b.blockadedEmpire === l.a.empire) l.b.blockadeDays += days;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Demilitarised systems
// ---------------------------------------------------------------------------------------------------------------

export function isWarship(bo: BuiltObject): boolean {
    return bo.role === BuiltObjectRole.Military && !bo.hasBeenDestroyed;
}

/** The demilitarised system star containing (x, y) for `empire`'s warships, or null. Pure. */
export function demilitarisedSystemAt(galaxy: Galaxy, empire: Empire, x: number, y: number): Habitat | null {
    const st = peekState(galaxy);
    if (st === null || st.treaties.length === 0) return null;
    const now = galaxyStarDate(galaxy);
    const r = galaxy.maxSolarSystemSize;
    const r2 = r * r;
    for (const t of st.treaties) {
        if (t.empire !== empire || now >= t.until) continue;
        for (const s of t.systems) {
            const dx = s.xpos - x;
            const dy = s.ypos - y;
            if (dx * dx + dy * dy <= r2) return s;
        }
    }
    return null;
}

const COORD_UNSET = -2000000000;

/** The point a mission sends a ship to (the explicit x/y, else the target's position), or null. */
function missionPoint(target: unknown, x: number, y: number): { x: number; y: number } | null {
    if (x > COORD_UNSET && y > COORD_UNSET) return { x, y };
    if (target !== null && typeof target === 'object') {
        const t = target as { xpos?: unknown; ypos?: unknown; leadShip?: { xpos: number; ypos: number } | null };
        if (typeof t.xpos === 'number' && typeof t.ypos === 'number') return { x: t.xpos, y: t.ypos };
        if (t.leadShip != null) return { x: t.leadShip.xpos, y: t.leadShip.ypos };
    }
    return null;
}

registerScenarioQuery({
    id: 'lively.warGoals.demilitarised',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    query: 'assignMissionAllowed',
    run: (g, value, args) => {
        if (!value) return value;
        const bo = args.builtObject;
        if (bo.empire === null || !isWarship(bo)) return value;
        const st = peekState(g);
        if (st === null || st.treaties.length === 0) return value;
        const p = missionPoint(args.target, args.x, args.y);
        if (p === null) return value;
        return demilitarisedSystemAt(g, bo.empire, p.x, p.y) === null;
    },
});

/** `empire`'s warships inside a system of `t`. */
export function warshipsInside(galaxy: Galaxy, t: DemilTreaty): BuiltObject[] {
    const r = galaxy.maxSolarSystemSize;
    const r2 = r * r;
    const out: BuiltObject[] = [];
    for (const bo of t.empire.builtObjects) {
        if (bo === null || !isWarship(bo)) continue;
        for (const s of t.systems) {
            const dx = s.xpos - bo.xpos;
            const dy = s.ypos - bo.ypos;
            if (dx * dx + dy * dy <= r2) {
                out.push(bo);
                break;
            }
        }
    }
    return out;
}

/** Breaks treaty `t`: casus belli for the beneficiary, evaluation drop, messages. Exported for tests. */
export function breakDemilitarisation(galaxy: Galaxy, t: DemilTreaty, intruder: BuiltObject | null): void {
    const st = warGoalsState(galaxy);
    const i = st.treaties.indexOf(t);
    if (i >= 0) st.treaties.splice(i, 1);
    // As the C# incidents do (EmpireEvaluation.IncidentEvaluation -= x; the setter clamps).
    const ev = obtainEmpireEvaluation(galaxy, t.beneficiary, t.empire);
    ev.incidentEvaluation = ev.incidentEvaluationRaw - scenarioParam(galaxy, 'breachRelationDrop', 25);
    st.casusBelli[pairKey(t.beneficiary, t.empire)] = galaxyStarDate(galaxy);
    const systems = t.systems.map((s) => s.name).join(', ');
    scenarioMessage(galaxy, t.beneficiary, scenarioText('Lively Demil Title'), scenarioText('Lively Demil Broken Victim', t.empire.name, systems), { type: EmpireMessageType.GeneralBadEvent, subject: intruder ?? t.empire, sender: t.empire });
    scenarioMessage(galaxy, t.empire, scenarioText('Lively Demil Title'), scenarioText('Lively Demil Broken Own', t.beneficiary.name, systems), { type: EmpireMessageType.GeneralWarning, subject: intruder ?? t.beneficiary });
    scenarioNews(galaxy, null, scenarioText('Lively Demil Broken News', t.empire.name, t.beneficiary.name), (x) => x !== t.empire && x !== t.beneficiary);
}

/** The breach / expiry check (periodic; exported for tests). */
export function checkDemilitarisation(galaxy: Galaxy): void {
    const st = warGoalsState(galaxy);
    const now = galaxyStarDate(galaxy);
    for (const t of [...st.treaties]) {
        if (now >= t.until || !t.empire.active || !t.beneficiary.active) {
            st.treaties.splice(st.treaties.indexOf(t), 1);
            continue;
        }
        if (now < t.graceUntil) continue;
        const inside = warshipsInside(galaxy, t);
        if (inside.length > 0) breakDemilitarisation(galaxy, t, inside[0]);
    }
}

registerScenarioPeriodic({
    id: 'lively.warGoals.periodic',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    periodDays: 30,
    run: (g) => {
        sampleBlockades(g);
        checkDemilitarisation(g);
    },
});

// ---------------------------------------------------------------------------------------------------------------
// Humiliation, casus belli, yearly upkeep
// ---------------------------------------------------------------------------------------------------------------

export function humiliation(galaxy: Galaxy, humiliated: Empire, victor: Empire): number {
    return peekState(galaxy)?.humiliations[pairKey(humiliated, victor)] ?? 0;
}

export function holdsCasusBelli(galaxy: Galaxy, victim: Empire, breacher: Empire): boolean {
    return peekState(galaxy)?.casusBelli[pairKey(victim, breacher)] !== undefined;
}

registerScenarioQuery({
    id: 'lively.warGoals.relax',
    scenarioId: LIVELY_GALAXY_ID,
    flag: WAR_GOALS_FLAG,
    query: 'warReviewAttitudeRelax',
    run: (g, value, args) => {
        let v = value + humiliation(g, args.empire, args.other) * scenarioParam(g, 'humiliationWarFactor', 0.01);
        if (holdsCasusBelli(g, args.empire, args.other)) v += scenarioParam(g, 'casusBelliWarFactor', 5);
        return v;
    },
});

/** The yearly upkeep (exported for tests): reparation instalments, humiliation decay, casus-belli expiry, stale entries. */
export function warGoalsYearly(galaxy: Galaxy, pay: (payer: Empire, payee: Empire, amount: number) => number): void {
    const st = warGoalsState(galaxy);
    const now = galaxyStarDate(galaxy);
    for (const p of [...st.reparations]) {
        if (p.yearsLeft <= 0 || !p.payer.active || !p.payee.active) {
            st.reparations.splice(st.reparations.indexOf(p), 1);
            continue;
        }
        pay(p.payer, p.payee, p.perYear);
        p.yearsLeft--;
        if (p.yearsLeft <= 0) st.reparations.splice(st.reparations.indexOf(p), 1);
    }
    const keep = scenarioParam(galaxy, 'humiliationDecay', 0.8);
    for (const k of Object.keys(st.humiliations)) {
        st.humiliations[k] *= keep;
        if (st.humiliations[k] < 1) delete st.humiliations[k];
    }
    const cbLife = scenarioParam(galaxy, 'casusBelliYears', 10) * YEAR_LENGTH;
    for (const k of Object.keys(st.casusBelli)) if (now - st.casusBelli[k] > cbLife) delete st.casusBelli[k];
    for (const k of Object.keys(st.wars)) {
        const l = st.wars[k];
        if (!atWar(l.a.empire, l.b.empire)) delete st.wars[k];
    }
    for (const k of Object.keys(st.offers)) {
        const [from, to] = k.split(':').map(Number);
        const a = galaxy.empires.find((e) => e !== null && e.empireId === from);
        const b = galaxy.empires.find((e) => e !== null && e.empireId === to);
        if (a === undefined || b === undefined || !atWar(a, b)) delete st.offers[k];
    }
}

