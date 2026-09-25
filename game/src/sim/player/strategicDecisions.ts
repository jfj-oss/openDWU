// 18c — the model's strategic answer for an AI empire: the response schema the local model is constrained to, its
// validation against the brief (player/strategicBrief.ts) and its application through the same sim entry points the
// scripted AI uses (Empire.8.cs StartWar / OfferFreeTrade / OfferMutualDefense / CancelTreatiesIfTimePassed /
// StartTradeSanctionsIfTimePassed / EndTradeSanctionsIfTimePassed / EndWarRequest / GiveGiftWhenSufficientTimePassed;
// PrepareFleetsForWar + SendAttackFleets; the EmpirePolicy fields the 17d policy panel sets).
//
// No bypass: a decision is re-listed on the live galaxy right before it is applied (the brief may be a few seconds
// old), then the ported C# function runs with all of its own gates (proposal interval, automation authorization,
// CheckReadyForWar …). A gate that declines leaves the command 'blocked'. Every command that reached the sim is
// appended to the external command log (player/commandLog.ts) with the star date, so seed + log replays the game.
//
// Determinism: runs only between ticks, like a player's click (the Rnd draws are those of the called sim functions,
// e.g. the gift amount). Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { DiplomaticRelationType } from '../diplomacy';
import {
    cancelTreatiesIfTimePassed,
    checkReadyForWar,
    endTradeSanctionsIfTimePassed,
    endWarRequest,
    giveGiftWhenSufficientTimePassed,
    offerFreeTrade,
    offerMutualDefense,
    prepareFleetsForWar,
    startTradeSanctionsIfTimePassed,
    startWar,
} from '../diplomacyTick';
import { sendAttackFleets } from '../fleets/militaryAI';
import { getEmpireById } from '../logistics/contracts';
import { galaxyStarDate } from '../tick/simTime';
import { resolveTechFocus, type EmpirePolicy } from '../data/policies';
import { appendCommandLog, type StrategicCommand } from './commandLog';
import {
    PRIORITY_LEVELS,
    STRATEGIC_POLICY_FIELDS,
    TECH_FOCUS_NAMES,
    listStrategicOptions,
    policyKeyOf,
    type StrategicBrief,
    type StrategicKind,
    type StrategicOptionDef,
    type StrategicPolicyField,
} from './strategicBrief';

// ---------------------------------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------------------------------

export interface StrategicDecision {
    id: string;
    targetId?: string;
}

export interface StrategicResponse {
    rationale: string;
    decisions: StrategicDecision[];
}

/** At most this many decisions are applied per answer. */
export const MAX_STRATEGIC_DECISIONS = 3;
/** Longest rationale kept. */
export const MAX_RATIONALE_CHARS = 400;

/** JSON schema of StrategicResponse with `id` constrained to the brief's decision ids (rationale first: the model
 *  states its reasoning before it commits). */
export function strategicResponseSchema(brief: StrategicBrief): object {
    return {
        type: 'object',
        properties: {
            rationale: { type: 'string' },
            decisions: {
                type: 'array',
                maxItems: MAX_STRATEGIC_DECISIONS,
                items: {
                    type: 'object',
                    properties: { id: { type: 'string', enum: brief.decisions.map((d) => d.id) }, targetId: { type: 'string' } },
                    required: ['id'],
                },
            },
        },
        required: ['rationale', 'decisions'],
    };
}

export interface RejectedStrategicDecision {
    id: string;
    targetId?: string;
    reason: string;
}

export interface ValidatedStrategicResponse {
    rationale: string;
    decisions: StrategicDecision[];
    rejected: RejectedStrategicDecision[];
    /** The answer was not usable at all. */
    error?: string;
}

/** Parse and check the model's answer against the brief: unknown ids and targetIds outside a decision's `to` list are
 *  rejected; "none" and duplicates are dropped; at most MAX_STRATEGIC_DECISIONS are kept. */
export function validateStrategicResponse(brief: StrategicBrief, raw: string): ValidatedStrategicResponse {
    const out: ValidatedStrategicResponse = { rationale: '', decisions: [], rejected: [] };
    let obj: unknown;
    try {
        obj = JSON.parse(raw);
    } catch {
        out.error = 'the answer is not JSON';
        return out;
    }
    if (obj === null || typeof obj !== 'object') {
        out.error = 'the answer is not an object';
        return out;
    }
    const o = obj as { rationale?: unknown; decisions?: unknown };
    if (typeof o.rationale === 'string') {
        const r = o.rationale.replace(/\s+/g, ' ').trim();
        out.rationale = r.length > MAX_RATIONALE_CHARS ? `${r.slice(0, MAX_RATIONALE_CHARS - 3)}...` : r;
    }
    if (!Array.isArray(o.decisions)) {
        out.error = 'the answer has no decisions list';
        return out;
    }
    const byId = new Map(brief.decisions.map((d) => [d.id, d]));
    const seen = new Set<string>();
    for (const item of o.decisions) {
        if (item === null || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') {
            out.rejected.push({ id: String((item as { id?: unknown } | null)?.id ?? ''), reason: 'malformed decision' });
            continue;
        }
        const d = item as { id: string; targetId?: unknown };
        const targetId = typeof d.targetId === 'string' && d.targetId.trim() !== '' ? d.targetId.trim() : undefined;
        const opt = byId.get(d.id);
        if (opt === undefined) {
            out.rejected.push({ id: d.id, ...(targetId !== undefined ? { targetId } : {}), reason: 'not one of the legal decisions' });
            continue;
        }
        if (opt.kind === 'NoChange' || seen.has(d.id)) continue;
        if (opt.to !== undefined) {
            if (targetId === undefined || !opt.to.includes(targetId)) {
                out.rejected.push({ id: d.id, ...(targetId !== undefined ? { targetId } : {}), reason: `targetId must be one of: ${opt.to.join(', ')}` });
                continue;
            }
        }
        seen.add(d.id);
        if (out.decisions.length >= MAX_STRATEGIC_DECISIONS) {
            out.rejected.push({ id: d.id, reason: `more than ${MAX_STRATEGIC_DECISIONS} decisions` });
            continue;
        }
        out.decisions.push(opt.to !== undefined ? { id: d.id, targetId } : { id: d.id });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------------------------

export type StrategicResultStatus =
    /** The sim carried it out (war declared, offer sent, value set …). */
    | 'applied'
    /** It reached the ported C# function, whose own gate declined it (fleets not ready, interval not passed …). */
    | 'blocked'
    /** Not (or no longer) a legal decision for this empire; nothing was called. */
    | 'rejected';

export interface StrategicDecisionResult {
    id: string;
    kind: StrategicKind | '';
    status: StrategicResultStatus;
    /** What was done / why not, in words. */
    text: string;
    /** The resolved command (applied / blocked). */
    command?: StrategicCommand;
}

function setPolicy(ai: Empire, mutate: (p: EmpirePolicy) => void): void {
    // The 17d panel builds a new EmpirePolicy and assigns it (Main.Part3.cs WqesexberY_Click); copy, then change.
    const cur = ai.policy!;
    const next: EmpirePolicy = { ...cur, researchDesignTechFocus: cur.researchDesignTechFocus.map((f) => ({ ...f })) };
    mutate(next);
    ai.policy = next;
}

function setTechFocusSlot(p: EmpirePolicy, slot: number, index: number): void {
    const { category, type } = resolveTechFocus(index);
    const pr = p as unknown as Record<string, number>;
    pr[`researchDesignTechFocus${slot}`] = category;
    pr[`researchDesignTechFocusType${slot}`] = type;
    p.researchDesignTechFocus[slot - 1] = { category, type };
}

/**
 * Apply one resolved command for `ai` through the ported C# entry point. Returns whether it took effect. Also the
 * replay path of a command-log entry. The caller has checked legality (listStrategicOptions) for model decisions.
 */
export function applyStrategicCommand(galaxy: Galaxy, ai: Empire, cmd: StrategicCommand): { status: 'applied' | 'blocked'; text: string } {
    const other = cmd.target !== undefined ? getEmpireById(galaxy, cmd.target) : null;
    const rel = other !== null ? ai.diplomaticRelations.byEmpire(other) : null;
    const proposalFrom = (): unknown => (other !== null ? other.proposedDiplomaticRelations.byEmpire(ai) : null);
    const done = (ok: boolean, yes: string, no: string): { status: 'applied' | 'blocked'; text: string } => ({ status: ok ? 'applied' : 'blocked', text: ok ? yes : no });
    const name = other?.name ?? '?';
    switch (cmd.kind as StrategicKind) {
        case 'DeclareWar': {
            if (other === null || rel === null) return done(false, '', 'no such empire');
            // Empire.8.cs 587 Conquer branch, as the scripted review runs it.
            if (rel.type !== DiplomaticRelationType.War && checkReadyForWar(galaxy, ai, other)) startWar(galaxy, ai, other);
            return done(rel.type === DiplomaticRelationType.War, `Declared war on the ${name}`, 'War postponed: the attack fleets are not ready yet (CheckReadyForWar) or the war was not authorized');
        }
        case 'OfferFreeTrade': {
            if (other === null) return done(false, '', 'no such empire');
            const before = proposalFrom();
            offerFreeTrade(galaxy, ai, other);
            const after = proposalFrom();
            return done(after !== null && after !== before, `Proposed a Free Trade Agreement to the ${name}`, 'The offer was not sent (OfferFreeTrade gates)');
        }
        case 'OfferMutualDefense': {
            if (other === null) return done(false, '', 'no such empire');
            const before = proposalFrom();
            offerMutualDefense(galaxy, ai, other);
            const after = proposalFrom() as { type?: DiplomaticRelationType } | null;
            const kind = after?.type === DiplomaticRelationType.Protectorate ? 'Protectorate' : 'Mutual Defense Pact';
            return done(after !== null && after !== before, `Proposed a ${kind} to the ${name}`, 'The offer was not sent (OfferMutualDefense gates)');
        }
        case 'CancelTreaty': {
            if (other === null || rel === null) return done(false, '', 'no such empire');
            const was = DiplomaticRelationType[rel.type];
            cancelTreatiesIfTimePassed(galaxy, ai, other);
            return done(rel.type === DiplomaticRelationType.None, `Cancelled the ${was} with the ${name}`, 'The treaty was not cancelled (CancelTreaties gates)');
        }
        case 'ImposeTradeSanctions': {
            if (other === null || rel === null) return done(false, '', 'no such empire');
            startTradeSanctionsIfTimePassed(galaxy, ai, other);
            return done(rel.type === DiplomaticRelationType.TradeSanctions, `Imposed trade sanctions on the ${name}`, 'No sanctions (StartTradeSanctions gates)');
        }
        case 'LiftTradeSanctions': {
            if (other === null || rel === null) return done(false, '', 'no such empire');
            endTradeSanctionsIfTimePassed(galaxy, ai, other);
            return done(rel.type === DiplomaticRelationType.None, `Lifted the trade sanctions on the ${name}`, 'Sanctions stay (EndTradeSanctions gates)');
        }
        case 'ProposePeace': {
            if (other === null) return done(false, '', 'no such empire');
            const before = proposalFrom();
            endWarRequest(galaxy, ai, other);
            const after = proposalFrom();
            return done(after !== null && after !== before, `Proposed an end to the war with the ${name}`, 'No peace offer sent (EndWarRequest gates)');
        }
        case 'SendGift': {
            if (other === null) return done(false, '', 'no such empire');
            const money = ai.stateMoney;
            giveGiftWhenSufficientTimePassed(galaxy, ai, other, cmd.small === true);
            const given = Math.round(money - ai.stateMoney);
            return done(given > 0, `Sent the ${name} a gift of ${given.toLocaleString('en-US')} credits`, 'No gift sent (GiveGiftWhenSufficientTimePassed gates)');
        }
        case 'WarTarget': {
            if (other === null) return done(false, '', 'no such empire');
            // The war-start fleet calls (Empire.8.cs 1703 PrepareFleetsForWar, Empire.7.cs 4828 SendAttackFleets).
            const n = prepareFleetsForWar(galaxy, ai, other);
            sendAttackFleets(galaxy, ai, other);
            return done(n > 0, `Sent ${n} attack fleet(s) against the ${name}`, `No attack fleet could be assigned against the ${name}`);
        }
        case 'SetTechFocus': {
            if (ai.policy === null || cmd.slot === undefined || cmd.focus === undefined) return done(false, '', 'no policy');
            const slot = cmd.slot;
            const focus = cmd.focus;
            setPolicy(ai, (p) => setTechFocusSlot(p, slot, focus));
            return done(true, `Tech emphasis ${slot} set to ${TECH_FOCUS_NAMES[focus] ?? focus}`, '');
        }
        case 'SetPolicy': {
            if (ai.policy === null || cmd.field === undefined || cmd.value === undefined) return done(false, '', 'no policy');
            const field = STRATEGIC_POLICY_FIELDS.find((f) => f.field === cmd.field);
            if (field === undefined) return done(false, '', `unknown policy field ${cmd.field}`);
            const value = cmd.value;
            setPolicy(ai, (p) => {
                (p as unknown as Record<string, number>)[policyKeyOf(field.field as StrategicPolicyField)] = value;
            });
            const level = PRIORITY_LEVELS.find((l) => l.value === value)?.name ?? String(value);
            return done(true, `${field.label} set to ${level}`, '');
        }
        case 'NoChange':
            return done(true, 'No change', '');
    }
    return done(false, '', `unknown command ${cmd.kind}`);
}

/** The resolved command for a decision (the sim objects become ids). */
function commandFor(opt: StrategicOptionDef, targetId: string | undefined): StrategicCommand {
    const cmd: StrategicCommand = { kind: opt.kind };
    if (opt.targetEmpire !== undefined) cmd.target = opt.targetEmpire.empireId;
    if (opt.kind === 'SendGift') cmd.small = opt.small === true;
    if (opt.kind === 'SetTechFocus') {
        cmd.slot = opt.slot;
        cmd.focus = opt.choices!.get(targetId!);
    }
    if (opt.kind === 'SetPolicy') {
        cmd.field = opt.field;
        cmd.value = opt.choices!.get(targetId!);
    }
    return cmd;
}

/**
 * Apply the validated decisions for AI empire `ai`, in order. Each is re-listed on the live galaxy (listStrategicOptions)
 * — gone → 'rejected' — then applied through applyStrategicCommand and journaled in the command log with `rationale`.
 */
export function applyStrategicDecisions(galaxy: Galaxy, ai: Empire, decisions: readonly StrategicDecision[], rationale = ''): StrategicDecisionResult[] {
    const results: StrategicDecisionResult[] = [];
    for (const d of decisions) {
        const live = listStrategicOptions(galaxy, ai);
        const opt = live.find((o) => o.id === d.id);
        if (opt === undefined) {
            results.push({ id: d.id, kind: '', status: 'rejected', text: `${d.id}: not (or no longer) a legal decision` });
            continue;
        }
        if (opt.kind === 'NoChange') continue;
        if (opt.choices !== undefined && (d.targetId === undefined || !opt.choices.has(d.targetId))) {
            results.push({ id: d.id, kind: opt.kind, status: 'rejected', text: `${opt.what}: ${d.targetId ?? '(none)'} is not one of ${[...opt.choices.keys()].join(', ')}` });
            continue;
        }
        const cmd = commandFor(opt, d.targetId);
        const r = applyStrategicCommand(galaxy, ai, cmd);
        appendCommandLog(galaxy, {
            starDate: galaxyStarDate(galaxy),
            nowMs: galaxy.nowMs,
            source: 'ai-advisor',
            empireId: ai.empireId,
            decisionId: d.id,
            command: cmd,
            status: r.status,
            ...(rationale !== '' ? { rationale } : {}),
        });
        results.push({ id: d.id, kind: opt.kind, status: r.status, text: r.text, command: cmd });
    }
    return results;
}
