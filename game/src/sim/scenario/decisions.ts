// Scenario decisions (tasks/MODLAYER-DESIGN.md §4): a scenario raises a question with options for an empire; the player
// answers it from the message popup (ui/messagePopups.ts), an AI empire answers at once through the package's aiChoose,
// and an unanswered question falls back to its default option when it expires. Not a port.
//
// State (saved) lives in scenarioState(galaxy, 'decisions'): plain objects, so the save codec needs no new class.
// Rnd: raising / answering draws nothing itself; a package's resolve / aiChoose may draw (they run inside the scenario
// hook that raised the question, or from player input / the long-block expiry check, all behind the package's gate).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { EmpireMessageType } from '../messages';
import { galaxyStarDate } from '../tick/simTime';
import { GAME_DAY_LENGTH, scenarioGateOpen, type ScenarioHandlerGate } from './hooks';
import { scenarioMessage } from './messages';
import { scenarioState } from './state';
import { isHumanEmpire } from '../humanEmpires';

export interface ScenarioDecisionOption {
    id: string;
    label: string;
}

/** One question (plain data; `scenarioDecision: true` marks it for the UI). */
export interface ScenarioDecision {
    scenarioDecision: true;
    id: number;
    kind: string;
    empire: Empire;
    title: string;
    text: string;
    options: ScenarioDecisionOption[];
    defaultOption: string;
    raisedStarDate: number;
    /** Star date the default option applies (0 = never expires). */
    expiresStarDate: number;
    /** Package data (saveable values only). */
    context: Record<string, unknown>;
    answer: string | null;
    answeredStarDate: number;
    answeredBy: 'player' | 'ai' | 'expired' | null;
}

interface DecisionState {
    nextId: number;
    pending: ScenarioDecision[];
    /** Answered decisions, oldest first (kept for replay / the chronicle; trimmed to the last 200). */
    history: ScenarioDecision[];
}

export interface ScenarioDecisionHandler extends ScenarioHandlerGate {
    /** The decision kind this handler owns (raiseScenarioDecision's `kind`). */
    kind: string;
    /** Applies the chosen option. */
    resolve: (galaxy: Galaxy, decision: ScenarioDecision, optionId: string) => void;
    /** An AI empire's choice (default: the decision's default option). */
    aiChoose?: (galaxy: Galaxy, decision: ScenarioDecision) => string;
}

// Registry. `var` + accessor on purpose: a scenario package (e.g. charteredCompanies/charters.ts, imported through
// packages.ts) can call registerScenarioDecision while this module is still evaluating, via the import cycle
// decisions → messages → … → game → packages → charters. A `const` would throw the temporal-dead-zone error there;
// `var` is hoisted as undefined and the accessor creates the list on first use.
// eslint-disable-next-line no-var
var handlersStore: ScenarioDecisionHandler[] | undefined;
function handlers(): ScenarioDecisionHandler[] {
    return (handlersStore ??= []);
}

/** Registers (or replaces, by kind) the handler of a decision kind. Returns an unregister function. */
export function registerScenarioDecision(handler: ScenarioDecisionHandler): () => void {
    const i = handlers().findIndex((h) => h.kind === handler.kind);
    if (i >= 0) handlers().splice(i, 1);
    handlers().push(handler);
    return () => {
        const j = handlers().indexOf(handler);
        if (j >= 0) handlers().splice(j, 1);
    };
}

function decisionState(galaxy: Galaxy): DecisionState {
    return scenarioState<DecisionState>(galaxy, 'decisions', () => ({ nextId: 1, pending: [], history: [] }));
}

export interface RaiseDecisionSpec {
    kind: string;
    title: string;
    text: string;
    options: ScenarioDecisionOption[];
    /** Default option id (default: the first option). */
    defaultOption?: string;
    /** Game days until the default applies (omitted / 0: never). */
    expiresDays?: number;
    context?: Record<string, unknown>;
}

/** True for a ScenarioDecision (message subjects). */
export function isScenarioDecision(x: unknown): x is ScenarioDecision {
    return typeof x === 'object' && x !== null && (x as { scenarioDecision?: unknown }).scenarioDecision === true;
}

/**
 * Raises a question for `empire`. The human player's empire gets a GeneralDecision message whose subject is the
 * decision (the popup shows the options); any other empire answers at once (aiChoose, else the default).
 */
export function raiseScenarioDecision(galaxy: Galaxy, empire: Empire, spec: RaiseDecisionSpec): ScenarioDecision {
    if (spec.options.length === 0) throw new Error(`raiseScenarioDecision(${spec.kind}): no options`);
    const st = decisionState(galaxy);
    const now = galaxyStarDate(galaxy);
    const d: ScenarioDecision = {
        scenarioDecision: true,
        id: st.nextId++,
        kind: spec.kind,
        empire,
        title: spec.title,
        text: spec.text,
        options: spec.options.map((o) => ({ ...o })),
        defaultOption: spec.defaultOption ?? spec.options[0].id,
        raisedStarDate: now,
        expiresStarDate: spec.expiresDays !== undefined && spec.expiresDays > 0 ? now + spec.expiresDays * GAME_DAY_LENGTH : 0,
        context: spec.context ?? {},
        answer: null,
        answeredStarDate: 0,
        answeredBy: null,
    };
    st.pending.push(d);
    if (isHumanEmpire(galaxy, empire)) {
        scenarioMessage(galaxy, empire, spec.title, spec.text, { type: EmpireMessageType.GeneralDecision, subject: d });
    } else {
        const h = handlers().find((x) => x.kind === d.kind);
        const choice = h?.aiChoose?.(galaxy, d) ?? d.defaultOption;
        answerScenarioDecision(galaxy, d.id, choice, 'ai');
    }
    return d;
}

/** Pending (unanswered) decisions, optionally for one empire. */
export function pendingScenarioDecisions(galaxy: Galaxy, empire?: Empire): readonly ScenarioDecision[] {
    if (galaxy.scenario === null || !('decisions' in galaxy.scenario.state)) return [];
    const p = decisionState(galaxy).pending;
    return empire === undefined ? p : p.filter((d) => d.empire === empire);
}

/**
 * Answers a pending decision (player input from the popup, an AI choice, or expiry) and runs its handler's resolve.
 * Returns false when the decision is not pending or the option does not exist.
 */
export function answerScenarioDecision(galaxy: Galaxy, decisionId: number, optionId: string, by: 'player' | 'ai' | 'expired' = 'player'): boolean {
    if (galaxy.scenario === null) return false;
    const st = decisionState(galaxy);
    const i = st.pending.findIndex((d) => d.id === decisionId);
    if (i < 0) return false;
    const d = st.pending[i];
    if (!d.options.some((o) => o.id === optionId)) return false;
    st.pending.splice(i, 1);
    d.answer = optionId;
    d.answeredStarDate = galaxyStarDate(galaxy);
    d.answeredBy = by;
    st.history.push(d);
    if (st.history.length > 200) st.history.splice(0, st.history.length - 200);
    const h = handlers().find((x) => x.kind === d.kind);
    if (h !== undefined && scenarioGateOpen(galaxy, h)) h.resolve(galaxy, d, optionId);
    return true;
}

/** Applies the default option of every expired pending decision (galaxyTick long block, with the scenario ticks). */
export function expireScenarioDecisions(galaxy: Galaxy): void {
    if (galaxy.scenario === null || !('decisions' in galaxy.scenario.state)) return;
    const now = galaxyStarDate(galaxy);
    for (const d of [...decisionState(galaxy).pending]) {
        if (d.expiresStarDate > 0 && now >= d.expiresStarDate) answerScenarioDecision(galaxy, d.id, d.defaultOption, 'expired');
    }
}
