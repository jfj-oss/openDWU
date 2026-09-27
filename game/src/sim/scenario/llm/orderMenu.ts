// 19s-4 NATURAL-LANGUAGE ORDERS, sim side (tasks/19-mod-layer-scenarios.md §19s item 4; the 18a idea, grounded).
// Not a port. The legal player ops the order box may map a typed order to, the validation of the model's pick, the
// confirmation line, and the player command it becomes. The model call lives UI-side (llm/orders.ts); nothing here
// changes the galaxy: an order reaches the sim only through issuePlayerCommand, after the player's explicit confirm.
//
// The menu reuses the 18a legal-move enumeration (player/advisorBrief.ts buildAdvisorBrief: the right-click action
// menu for ships / fleets — move, attack, patrol, blockade, bombard, explore, colonize, refuel, repair, retrofit, hold,
// join / disband fleet, automate —, the Diplomacy conversation options for met empires, the Build Order per sub-role
// with its design) and adds the scenario colony-policy ops: frontier sector orders (19g-5 `frontierOrder` /
// `frontierConcede`) when that package runs. Pure (reads only, no Rnd).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { resolveGameText } from '../../textResolver';
import { buildAdvisorBrief, resolveRef, type AdvisorBrief, type AdvisorSelection, type BriefCommand } from '../../player/advisorBrief';
import { allowedTargets, refName, validateAdvisorResponse, type AdvisorCommand } from '../../player/advisorCommands';
import { listProposals } from '../../player/diplomacyProposals';
import { frontierOn, isRimSector, peekFrontierState, type FrontierOrder, type FrontierSector } from '../frontier/frontier';

/** A scenario op the menu offers beside the brief's commands. */
export interface MenuScenarioOp {
    id: string;
    /** The sector ref (`r<id>`) that the op concerns. */
    who: string;
    do: string;
    note?: string;
    op: { name: 'frontierOrder'; sectorId: number; order: FrontierOrder } | { name: 'frontierConcede'; sectorId: number };
}

export interface MenuSector {
    ref: string;
    name: string;
    rule: string;
    colonies: number;
    governor?: string;
}

export interface OrderMenu {
    /** The 18a brief (legal ship / fleet / diplomacy / build orders; ids c1…). */
    brief: AdvisorBrief;
    /** Scenario ops (ids x1…). */
    extra: MenuScenarioOp[];
    sectors: MenuSector[];
    /** Resolved labels of the diplomacy options (`e<id>|<option id>` → text). */
    labels: Record<string, string>;
}

/** Every op id the model may choose (the schema's enum, without 'none'). */
export function orderMenuIds(menu: OrderMenu): string[] {
    return [...menu.brief.commands.map((c) => c.id), ...menu.extra.map((x) => x.id)];
}

function sectorOps(galaxy: Galaxy, player: Empire): { sectors: MenuSector[]; extra: MenuScenarioOp[] } {
    const sectors: MenuSector[] = [];
    const extra: MenuScenarioOp[] = [];
    if (!frontierOn(galaxy)) return { sectors, extra };
    const st = peekFrontierState(galaxy);
    const own: FrontierSector[] = (st?.sectors ?? []).filter((s) => s.empire === player);
    for (const s of own) {
        const ref = `r${s.id}`;
        const m: MenuSector = { ref, name: s.name, rule: s.rule, colonies: s.colonies.length };
        if (s.governor !== null) m.governor = s.governor.name;
        sectors.push(m);
        const add = (d: string, op: MenuScenarioOp['op'], note?: string): void => {
            extra.push({ id: '', who: ref, do: d, op, ...(note !== undefined ? { note } : {}) });
        };
        for (const rule of ['loose', 'normal', 'tight'] as const) if (s.rule !== rule) add(`SectorRule${rule[0].toUpperCase()}${rule.slice(1)}`, { name: 'frontierOrder', sectorId: s.id, order: { kind: 'rule', rule } }, `set the sector's rule to ${rule}`);
        if (isRimSector(galaxy, s)) add(s.herdTolerance ? 'SectorHerdsOff' : 'SectorHerdsOn', { name: 'frontierOrder', sectorId: s.id, order: { kind: 'herds', on: !s.herdTolerance } }, 'herd tolerance');
        if (!s.taxRevoked && s.taxOverride !== null) add('SectorRevokeTax', { name: 'frontierOrder', sectorId: s.id, order: { kind: 'tax' } }, 'revoke the local tax rate');
        add('SectorConcede', { name: 'frontierConcede', sectorId: s.id }, 'concede: loose rule, local tax restored, governor placated');
    }
    extra.forEach((x, i) => (x.id = `x${i + 1}`));
    return { sectors, extra };
}

/** The legal ops for `player` with the HUD `selection` (null: none). Pure. */
export function buildOrderMenu(galaxy: Galaxy, player: Empire, selection: AdvisorSelection): OrderMenu {
    const brief = buildAdvisorBrief(galaxy, player, selection);
    const labels: Record<string, string> = {};
    for (const e of brief.empires) {
        const r = resolveRef(galaxy, player, e.ref);
        if (r === null || r.kind !== 'empire' || r.obj.diplomaticRelations.byEmpire(player) === null) continue;
        for (const o of listProposals(galaxy, player, r.obj)) if (o.enabled) labels[`${e.ref}|${o.id}`] = resolveGameText(o.label).replace(/\s+/g, ' ').trim();
    }
    return { brief, ...sectorOps(galaxy, player), labels };
}

/** The menu as the model sees it: the brief's facts, the sectors, and one list of orders (brief + scenario ops). */
export function orderMenuPrompt(menu: OrderMenu): { situation: string; orders: string } {
    const { commands, ...facts } = menu.brief;
    const orders: object[] = commands.map((c) => {
        const label = menu.labels[`${c.who}|${c.do}`];
        return label !== undefined ? { ...c, note: label } : c;
    });
    for (const x of menu.extra) orders.push({ id: x.id, who: x.who, do: x.do, ...(x.note !== undefined ? { note: x.note } : {}) });
    const situation = menu.sectors.length > 0 ? { ...facts, sectors: menu.sectors } : facts;
    return { situation: JSON.stringify(situation), orders: JSON.stringify(orders) };
}

/** JSON schema of the model's answer: one op id from the menu (or "none" with a question). */
export function orderResponseSchema(menu: OrderMenu): object {
    return {
        type: 'object',
        properties: {
            op: { type: 'string', enum: [...orderMenuIds(menu), 'none'] },
            targetId: { type: 'string' },
            count: { type: 'integer' },
            clarify: { type: 'string' },
        },
        required: ['op'],
    };
}

/** The mapped order awaiting the player's confirm. */
export type PendingOrder =
    | { kind: 'advisor'; menu: OrderMenu; entry: BriefCommand; command: AdvisorCommand; line: string }
    | { kind: 'scenario'; menu: OrderMenu; entry: MenuScenarioOp; line: string };

export type OrderMapping =
    | { status: 'confirm'; order: PendingOrder; line: string }
    | { status: 'clarify'; text: string }
    | { status: 'refused'; text: string };

const DEFAULT_CLARIFY = 'Which ship, fleet or place do you mean, and what should it do?';

function name(menu: OrderMenu, ref: string): string {
    return menu.sectors.find((s) => s.ref === ref)?.name ?? refName(menu.brief, ref);
}

/** The confirmation line of a brief command ("Move Fleet 3 to Kygnos"). */
export function orderLine(menu: OrderMenu, entry: BriefCommand, target: string, count?: number): string {
    const who = name(menu, entry.who);
    const t = target !== '' ? name(menu, target) : '';
    switch (entry.do) {
        case 'Move':
            return entry.note === 'return to base' ? `Return ${who} to base at ${t}` : `Move ${who} to ${t}`;
        case 'Attack':
            return `Send ${who} to attack ${t}`;
        case 'Patrol':
            return `${who}: patrol ${t}`;
        case 'Escort':
            return `${who}: escort ${t}`;
        case 'Blockade':
            return `${who}: blockade ${t}`;
        case 'Bombard':
            return `${who}: bombard ${t}`;
        case 'Explore':
            return `${who}: explore ${t}${entry.note === 'nearest unexplored system' ? ' (nearest unexplored system)' : ''}`;
        case 'Colonize':
            return `${who}: colonize ${t}`;
        case 'Refuel':
            return `Refuel ${who} at ${t}`;
        case 'Repair':
            return `Repair ${who} at ${t}`;
        case 'Retrofit':
            return `Retrofit ${who}${entry.design !== undefined ? ` to ${entry.design}` : ''} at ${t}`;
        case 'Hold':
            return `${who}: stop and hold position`;
        case 'Escape':
            return `${who}: escape`;
        case 'JoinShipGroup':
            return t !== '' ? `${who}: join ${t}` : `${who}: form a new fleet`;
        case 'AutomateShip':
            return `Put ${who} under automation`;
        case 'DisbandShipGroup':
            return `Disband ${who}`;
        case 'Build': {
            const n = Math.max(1, Math.min(20, Math.trunc(count ?? 1)));
            return `Build ${n}× ${entry.design ?? entry.note ?? 'ship'}${entry.cost !== undefined ? ` (${entry.cost * n} credits)` : ''}`;
        }
    }
    if (entry.who.startsWith('e')) {
        const label = menu.labels[`${entry.who}|${entry.do}`] ?? entry.do.replace(/[_:]+/g, ' ').toLowerCase();
        return `${entry.confirm === true ? 'DECLARE WAR — ' : ''}${who}: ${label}${entry.cost !== undefined ? ` (${entry.cost} credits)` : ''}`;
    }
    return `${who}: ${entry.do}${t !== '' ? ` → ${t}` : ''}`;
}

function scenarioLine(menu: OrderMenu, x: MenuScenarioOp): string {
    const who = name(menu, x.who);
    const op = x.op;
    if (op.name === 'frontierConcede') return `Concede to sector ${who} (loose rule, local tax restored)`;
    switch (op.order.kind) {
        case 'rule':
            return `Order sector ${who} to ${op.order.rule} rule`;
        case 'herds':
            return `Order sector ${who}: herd tolerance ${op.order.on ? 'on' : 'off'}`;
        case 'tax':
            return `Order sector ${who} to revoke its local tax rate`;
    }
}

/**
 * The model's answer (JSON text or object) → a confirmation, a clarifying question, or a refusal. Only ids of the menu
 * are accepted, a target must be one the command allows (an unambiguous name is accepted, as 18a does), and a command
 * that needs a target but got none, or a name that fits several, becomes a question. Never guesses. Pure.
 */
export function mapOrderAnswer(menu: OrderMenu, json: unknown): OrderMapping {
    let data: unknown = json;
    if (typeof json === 'string') {
        try {
            data = JSON.parse(json);
        } catch {
            return { status: 'clarify', text: DEFAULT_CLARIFY };
        }
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return { status: 'clarify', text: DEFAULT_CLARIFY };
    const a = data as { op?: unknown; targetId?: unknown; count?: unknown; clarify?: unknown };
    const op = typeof a.op === 'string' ? a.op.trim() : '';
    const clarify = typeof a.clarify === 'string' ? a.clarify.trim() : '';
    if (op === '' || op === 'none') return { status: 'clarify', text: clarify !== '' ? clarify : DEFAULT_CLARIFY };
    const x = menu.extra.find((e) => e.id === op);
    if (x !== undefined) {
        const line = scenarioLine(menu, x);
        return { status: 'confirm', order: { kind: 'scenario', menu, entry: x, line }, line };
    }
    const entry = menu.brief.commands.find((c) => c.id === op);
    if (entry === undefined) return { status: 'refused', text: `"${op}" is not an order you can give now.` };
    const cmd: AdvisorCommand = { id: entry.id };
    if (typeof a.targetId === 'string' && a.targetId.trim() !== '') cmd.targetId = a.targetId.trim();
    if (entry.do === 'Build' && typeof a.count === 'number' && Number.isFinite(a.count)) cmd.count = Math.max(1, Math.min(20, Math.trunc(a.count)));
    const v = validateAdvisorResponse(menu.brief, { reply: '', commands: [cmd] });
    if (v.clarify !== undefined) return { status: 'clarify', text: v.clarify };
    if (v.commands.length !== 1) {
        const why = v.rejected[0]?.reason ?? 'not a legal order';
        return { status: 'refused', text: `Refused: ${why}.` };
    }
    const vc = v.commands[0];
    // The target is re-resolved from the brief's own refs only (never a free-text name).
    if (vc.target !== '' && !allowedTargets(menu.brief, entry).includes(vc.target) && entry.to !== vc.target) return { status: 'refused', text: 'Refused: not a legal target.' };
    const command: AdvisorCommand = { id: entry.id };
    if (vc.target !== '' && entry.to !== vc.target) command.targetId = vc.target;
    if (cmd.count !== undefined) command.count = cmd.count;
    const line = orderLine(menu, entry, vc.target, command.count);
    return { status: 'confirm', order: { kind: 'advisor', menu, entry, command, line }, line };
}
