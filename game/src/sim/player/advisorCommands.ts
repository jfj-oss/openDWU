// 18a — the advisor's answer: the response schema the local model is constrained to, its validation against the brief
// (advisorBrief.ts) and its execution through the player command layer — executeShipAction (Main.Part7.cs 45
// method_347, the same dispatcher a menu click reaches), submitProposal (the Diplomacy conversation) and buildNewShips
// (the Build Order Purchase button). Nothing here bypasses a rule: every order is re-checked against the live galaxy
// with the brief's predicates right before it is executed, and the sim function then applies its own checks.
//
// Determinism: runs only on player input between ticks, exactly like the click it stands for (the Rnd draws are those
// of the called sim functions). A war declaration needs `confirm: true` in the command; without it the command comes
// back as 'needs-confirm' and nothing is changed.
// Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Design } from '../design';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { ShipGroup } from '../fleets/shipGroup';
import { buildNewShips } from '../construction/empireConstruction';
import { ShipAction, ShipActionType, createMissionShipAction, createMissionShipActionAt, createShipAction } from './shipAction';
import { executeShipAction, type ShipActionSelection } from './executeShipAction';
import { listProposals, submitProposal } from './diplomacyProposals';
import {
    type AdvisorBrief,
    type BriefCommand,
    type OrderTarget,
    canAttack,
    canBlockadeTarget,
    canBombardTarget,
    canColonizeTarget,
    canEscortTarget,
    canPatrolTarget,
    canRefuelAt,
    fleetRef,
    isOrderableShip,
    resolveRef,
} from './advisorBrief';

// ---------------------------------------------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------------------------------------------

/** One order the model gives: a command id from the brief, plus its target when the command takes one. */
export interface AdvisorCommand {
    id: string;
    targetId?: string;
    /** Queue after the current mission (shift-click, ShipAction.IsSubsequentAction). */
    queue?: boolean;
    /** Required for a war declaration (the player confirmed it). */
    confirm?: boolean;
    /** Build: how many ships (1-20, default 1). */
    count?: number;
}

export interface AdvisorResponse {
    reply: string;
    commands: AdvisorCommand[];
}

/** JSON schema of AdvisorResponse (Ollama `format`, OpenAI `response_format.json_schema.schema`). */
export const ADVISOR_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        reply: { type: 'string' },
        commands: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    targetId: { type: 'string' },
                    queue: { type: 'boolean' },
                    confirm: { type: 'boolean' },
                    count: { type: 'integer' },
                },
                required: ['id'],
            },
        },
    },
    required: ['reply', 'commands'],
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

export interface ValidatedCommand {
    command: AdvisorCommand;
    entry: BriefCommand;
    /** The resolved target ref ('' for commands without a target). */
    target: string;
}

export interface RejectedCommand {
    command: unknown;
    reason: string;
}

export interface AdvisorValidation {
    /** The reply text (in character), '' when the response had none. */
    reply: string;
    commands: ValidatedCommand[];
    rejected: RejectedCommand[];
    /** Set when the orders are ambiguous: a question to ask the player instead of executing anything. */
    clarify?: string;
    /** Set when the response is not usable at all (not JSON, wrong shape). */
    error?: string;
}

/** The refs a brief command accepts as target ('' = none: fixed target or no target). */
export function allowedTargets(brief: AdvisorBrief, entry: BriefCommand): string[] {
    const to = entry.to;
    if (to === undefined) return [];
    if (Array.isArray(to)) return to;
    switch (to) {
        case '*':
            return [...brief.places.map((p) => p.ref), ...brief.ships.filter((s) => s.ref !== entry.who).map((s) => s.ref), ...brief.fleets.filter((f) => f.ref !== entry.who).map((f) => f.ref)];
        case 'places':
            return brief.places.map((p) => p.ref);
        case 'systems':
            return brief.places.filter((p) => p.kind === 'System').map((p) => p.ref);
        case 'ships':
            return brief.ships.filter((s) => s.ref !== entry.who).map((s) => s.ref);
    }
    return [];
}

const SHORTHANDS = ['*', 'places', 'systems', 'ships'];

/** A fixed-target command (`to` is one ref, not a shorthand): no targetId needed. */
function isFixedTarget(entry: BriefCommand): boolean {
    return typeof entry.to === 'string' && !SHORTHANDS.includes(entry.to);
}

/** Name of a ref for messages. */
export function refName(brief: AdvisorBrief, ref: string): string {
    if (ref === 'you') return brief.empire.name;
    return (
        brief.ships.find((s) => s.ref === ref)?.name ??
        brief.fleets.find((f) => f.ref === ref)?.name ??
        brief.places.find((p) => p.ref === ref)?.name ??
        brief.empires.find((e) => e.ref === ref)?.name ??
        ref
    );
}

/** A one-line description of a command, e.g. "Wild Starway: Explore → S117". */
export function describeCommand(brief: AdvisorBrief, entry: BriefCommand, target: string, count?: number, queue?: boolean): string {
    let s = `${refName(brief, entry.who)}: ${entry.do}`;
    if (entry.design !== undefined) s += ` ${count !== undefined && count > 1 ? `${count}× ` : ''}${entry.design}`;
    if (target !== '') s += ` → ${refName(brief, target)}`;
    if (queue === true) s += ' (queued)';
    return s;
}

/**
 * Check the model's JSON (object or JSON text) against the brief: unknown ids and targets outside the command's list
 * are rejected; a command that needs a target but got none (or a name that matches several), or two immediate orders
 * for the same ship / fleet, make the whole answer a clarifying question instead of orders.
 */
export function validateAdvisorResponse(brief: AdvisorBrief, json: unknown): AdvisorValidation {
    let data: unknown = json;
    if (typeof json === 'string') {
        try {
            data = JSON.parse(json);
        } catch {
            return { reply: '', commands: [], rejected: [], error: 'The answer was not valid JSON' };
        }
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return { reply: '', commands: [], rejected: [], error: 'The answer was not a JSON object' };
    }
    const obj = data as { reply?: unknown; commands?: unknown };
    const reply = typeof obj.reply === 'string' ? obj.reply.trim() : '';
    const raw = obj.commands === undefined || obj.commands === null ? [] : obj.commands;
    if (!Array.isArray(raw)) return { reply, commands: [], rejected: [], error: '`commands` is not an array' };

    const out: AdvisorValidation = { reply, commands: [], rejected: [] };
    const questions: string[] = [];
    const seenIds = new Set<string>();
    const immediateByActor = new Map<string, ValidatedCommand>();
    for (const c of raw) {
        if (c === null || typeof c !== 'object' || typeof (c as AdvisorCommand).id !== 'string') {
            out.rejected.push({ command: c, reason: 'not a command object with an id' });
            continue;
        }
        const cmd = c as AdvisorCommand;
        const entry = brief.commands.find((x) => x.id === cmd.id.trim());
        if (entry === undefined) {
            out.rejected.push({ command: c, reason: `unknown command id ${cmd.id}` });
            continue;
        }
        const key = `${entry.id}|${cmd.targetId ?? ''}`;
        if (seenIds.has(key)) {
            out.rejected.push({ command: c, reason: `duplicate command ${entry.id}` });
            continue;
        }
        seenIds.add(key);
        let target = '';
        if (isFixedTarget(entry)) {
            target = entry.to as string;
            const t = cmd.targetId?.trim();
            if (t !== undefined && t !== '' && t !== target && t.toLowerCase() !== refName(brief, target).toLowerCase()) {
                out.rejected.push({ command: c, reason: `${entry.id} always targets ${refName(brief, target)}, not ${t}` });
                continue;
            }
        } else if (entry.to !== undefined) {
            const allowed = allowedTargets(brief, entry);
            let t = cmd.targetId?.trim() ?? '';
            if (SHORTHANDS.includes(t)) t = ''; // the shorthand word itself is not a target
            if (t === '') {
                const names = allowed.slice(0, 8).map((r) => refName(brief, r));
                questions.push(`${refName(brief, entry.who)} — ${entry.do} where? (${names.join(', ')}${allowed.length > 8 ? ', …' : ''})`);
                continue;
            }
            if (allowed.includes(t)) {
                target = t;
            } else {
                // A small model often writes the name instead of the ref: accept an unambiguous name.
                const byName = allowed.filter((r) => refName(brief, r).toLowerCase() === t.toLowerCase());
                if (byName.length === 1) {
                    target = byName[0];
                } else if (byName.length > 1) {
                    questions.push(`Which ${t} for ${refName(brief, entry.who)}'s ${entry.do}? (${byName.join(', ')})`);
                    continue;
                } else {
                    out.rejected.push({ command: c, reason: `${refName(brief, t)} is not a valid ${entry.do} target for ${refName(brief, entry.who)}` });
                    continue;
                }
            }
        }
        const v: ValidatedCommand = { command: cmd, entry, target };
        // Two immediate orders for one ship / fleet: the second would silently replace the first.
        if (cmd.queue !== true && (entry.who.startsWith('s') || entry.who.startsWith('f'))) {
            const prev = immediateByActor.get(entry.who);
            if (prev !== undefined) {
                questions.push(
                    `${refName(brief, entry.who)} can only do one thing now: ${describeCommand(brief, prev.entry, prev.target)} or ${describeCommand(brief, entry, target)}?`,
                );
                continue;
            }
            immediateByActor.set(entry.who, v);
        }
        out.commands.push(v);
    }
    if (questions.length > 0) {
        out.clarify = questions.join(' ');
        out.commands = [];
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------------------------

export type AdvisorCommandStatus = 'done' | 'failed' | 'needs-confirm';

export interface AdvisorCommandResult {
    id: string;
    ok: boolean;
    status: AdvisorCommandStatus;
    /** What was ordered, e.g. "Wild Starway: Explore → S117". */
    text: string;
    /** The sim's message: the ShipActionResult / ProposalResult / BuildNewShips text, or why it was refused. */
    message: string;
}

/** Target predicates of the commands whose `to` is a list (re-checked on the live galaxy before executing). */
function targetStillValid(galaxy: Galaxy, player: Empire, actor: BuiltObject | ShipGroup, verb: string, t: OrderTarget): boolean {
    const ship = actor instanceof ShipGroup ? actor.leadShip : actor;
    switch (verb) {
        case 'Attack':
            return canAttack(galaxy, player, t) && t !== actor;
        case 'Bombard':
            return canBombardTarget(galaxy, player, t);
        case 'Patrol':
            return canPatrolTarget(t);
        case 'Escort':
            return ship !== null && canEscortTarget(player, ship, t);
        case 'Blockade':
            return canBlockadeTarget(galaxy, player, t);
        case 'Colonize':
            return ship !== null && canColonizeTarget(galaxy, ship, t);
        case 'Refuel':
            return ship !== null && canRefuelAt(galaxy, player, ship, t);
        default:
            return true;
    }
}

function missionTypeOf(verb: string): BuiltObjectMissionType | null {
    const v = (BuiltObjectMissionType as unknown as Record<string, number>)[verb];
    return typeof v === 'number' ? (v as BuiltObjectMissionType) : null;
}

/**
 * The ShipAction a menu click would carry for this order (Main.Part8.cs method_313 / 314 / 315 factories): targeted
 * missions come from method_315 at the target's own position (offset 0, the target itself), the refuel / repair /
 * retrofit / explore sub-menu entries from method_314 + Target, fleet and ship actions from method_313 / 314.
 */
function shipActionFor(entry: BriefCommand, target: OrderTarget | null, actor: BuiltObject | ShipGroup, design: Design | null): ShipAction | null {
    switch (entry.do) {
        case 'JoinShipGroup': {
            // Main.Part8.cs 4787-4803: method_314(Undefined) + ActionType JoinShipGroup (+ Target = the fleet).
            const a = createMissionShipAction(BuiltObjectMissionType.Undefined);
            a.actionType = ShipActionType.JoinShipGroup;
            a.target = target;
            return a;
        }
        case 'AutomateShip': {
            const a = createMissionShipAction(BuiltObjectMissionType.Undefined);
            a.actionType = ShipActionType.AutomateShip;
            return a;
        }
        case 'DisbandShipGroup':
            return createShipAction(ShipActionType.DisbandShipGroup, actor); // Main.Part8.cs 3505 method_313
        case 'Hold':
            return createMissionShipAction(BuiltObjectMissionType.Hold); // 4760 method_314(Hold)
        case 'Escape':
            return createMissionShipAction(BuiltObjectMissionType.Escape); // 4782 method_314(Escape)
        case 'Explore':
        case 'Refuel':
        case 'Repair':
        case 'Retrofit': {
            const a = createMissionShipAction(missionTypeOf(entry.do)!);
            a.target = target;
            if (design !== null) a.design = design;
            return a;
        }
    }
    const mt = missionTypeOf(entry.do);
    if (mt === null || target === null) return null;
    const pos = target instanceof ShipGroup ? target.leadShip : target;
    return createMissionShipActionAt(mt, target, Math.trunc(pos?.xpos ?? 0), Math.trunc(pos?.ypos ?? 0));
}

function missionText(actor: BuiltObject | ShipGroup): string {
    const m = actor instanceof ShipGroup ? actor.mission : builtObjectMission(actor.mission);
    let s = m === null || m.type === BuiltObjectMissionType.Undefined ? 'no mission' : `mission ${BuiltObjectMissionType[m.type]}`;
    const queued = actor.subsequentMissions.length;
    if (queued > 0) s += `, ${queued} queued`;
    return s;
}

/**
 * Execute validated advisor commands in order. Each is re-resolved against the live galaxy (the actor still exists and
 * is the player's, the target still passes the order's rule) and then goes through the same sim entry point as the
 * player's click. Returns one result per command.
 */
export function executeAdvisorCommands(galaxy: Galaxy, player: Empire, brief: AdvisorBrief, commands: readonly (AdvisorCommand | ValidatedCommand)[]): AdvisorCommandResult[] {
    const results: AdvisorCommandResult[] = [];
    for (const c of commands) {
        const cmd: AdvisorCommand = 'entry' in c ? c.command : c;
        let entry: BriefCommand | undefined;
        let targetRef = '';
        if ('entry' in c) {
            entry = c.entry;
            targetRef = c.target;
        } else {
            // Unvalidated input: validate this one command on its own (same rules).
            const v = validateAdvisorResponse(brief, { reply: '', commands: [c] });
            if (v.commands.length !== 1) {
                results.push({ id: String(cmd.id), ok: false, status: 'failed', text: String(cmd.id), message: v.clarify ?? v.rejected[0]?.reason ?? 'invalid command' });
                continue;
            }
            entry = v.commands[0].entry;
            targetRef = v.commands[0].target;
        }
        results.push(executeOne(galaxy, player, brief, entry, targetRef, cmd));
    }
    return results;
}

function executeOne(galaxy: Galaxy, player: Empire, brief: AdvisorBrief, entry: BriefCommand, targetRef: string, cmd: AdvisorCommand): AdvisorCommandResult {
    const count = entry.do === 'Build' ? Math.max(1, Math.min(20, Math.trunc(cmd.count ?? 1))) : undefined;
    const text = describeCommand(brief, entry, targetRef, count, cmd.queue);
    const fail = (message: string): AdvisorCommandResult => ({ id: entry.id, ok: false, status: 'failed', text, message });
    const done = (message: string): AdvisorCommandResult => ({ id: entry.id, ok: true, status: 'done', text, message });

    // --- Build Order (Main.Part2.cs 1135 btnBuildOrderPurchase_Click → Empire.6.cs 3017 BuildNewShips) ---
    if (entry.who === 'you' && entry.do === 'Build') {
        const design = player.designs.find((d) => d.name === entry.design && !d.isObsolete);
        if (design === undefined) return fail(`design ${entry.design} is no longer available`);
        const r = buildNewShips(galaxy, player, [design], [count!]);
        if (!r.ok) return fail(r.message ?? 'build order refused');
        if (r.built.length === 0) return fail('no ship yard accepted the order');
        return done(`queued ${r.built.map((b) => b.name).join(', ')}`);
    }

    // --- Diplomacy (the conversation option, Main.Part10.cs 3957 method_237 via submitProposal) ---
    if (entry.who.startsWith('e')) {
        const r = resolveRef(galaxy, player, entry.who);
        if (r === null || r.kind !== 'empire') return fail('that empire no longer exists');
        const other = r.obj;
        const option = listProposals(galaxy, player, other).find((o) => o.id === entry.do);
        if (option === undefined || !option.enabled) return fail(option?.hint || 'no longer on offer');
        if (option.part === 'WAR_DECLARE' && cmd.confirm !== true) {
            return { id: entry.id, ok: false, status: 'needs-confirm', text, message: `Declaring war on ${other.name} needs your confirmation` };
        }
        const pr = submitProposal(galaxy, player, other, option);
        if (!pr.ok) return fail(pr.message || 'refused');
        return done(`${pr.accepted ? 'accepted' : 'rejected'}${pr.reply !== null ? ` (${pr.reply})` : ''}`);
    }

    // --- Ship / fleet orders (Main.Part7.cs 45 method_347 via executeShipAction) ---
    const ar = resolveRef(galaxy, player, entry.who);
    let actor: BuiltObject | ShipGroup;
    if (ar !== null && ar.kind === 'ship') {
        if (!isOrderableShip(player, ar.obj)) return fail(`${refName(brief, entry.who)} can no longer take orders`);
        actor = ar.obj;
    } else if (ar !== null && ar.kind === 'fleet') {
        const expected = brief.fleets.find((f) => f.ref === entry.who)?.name;
        if (ar.obj.empire !== player || ar.obj.leadShip === null || (expected !== undefined && (ar.obj.name ?? '(Unnamed fleet)') !== expected) || fleetRef(player, ar.obj) !== entry.who) {
            return fail('that fleet no longer exists');
        }
        actor = ar.obj;
    } else {
        return fail('that ship or fleet no longer exists');
    }

    let target: OrderTarget | null = null;
    if (targetRef !== '') {
        const tr = resolveRef(galaxy, player, targetRef);
        if (tr === null || tr.kind === 'empire') return fail(`${refName(brief, targetRef)} no longer exists`);
        target = tr.obj;
        if (!targetStillValid(galaxy, player, actor, entry.do, target)) return fail(`${entry.do} is no longer possible against ${refName(brief, targetRef)}`);
    }
    let design: Design | null = null;
    if (entry.do === 'Retrofit' && entry.design !== undefined && !(actor instanceof ShipGroup)) {
        design = player.designs.find((d) => d.name === entry.design && !d.isObsolete) ?? null;
        if (design === null) return fail(`design ${entry.design} is no longer available`);
    }
    const action = shipActionFor(entry, target, actor, design);
    if (action === null) return fail(`${entry.do} is not an order this advisor can give`);
    if (cmd.queue === true) action.isSubsequentAction = true;
    // ShipGroup and BuiltObject are both ShipActionSelection members.
    const selected: ShipActionSelection = actor;
    const r = executeShipAction(galaxy, player, selected, action, true);
    if (!r.ok) return fail(r.message ?? 'order refused');
    const now = missionText(actor);
    return done(r.message !== undefined && r.message !== '' ? `${r.message}; ${now}` : now);
}
