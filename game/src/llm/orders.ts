// 19s-4 NATURAL-LANGUAGE ORDERS (tasks/19-mod-layer-scenarios.md §19s item 4; the 18a idea, grounded). Not a port.
//
// The order box: the typed order + the legal ops of the current selection / context (sim/scenario/llm/orderMenu.ts,
// the 18a legal-move enumeration plus scenario ops) → ONE 'player'-priority request through the foundations queue,
// schema-constrained to one op id of that menu → a confirmation line ("Move Fleet 3 to Kygnos — confirm?"). Only the
// player's explicit confirm issues it, as a player command through the command queue (issuePlayerCommand: applied and
// journaled at the next frame boundary, replayable without the model). Unknown / ambiguous → a clarifying question;
// an id outside the menu → refused; no model → nothing (the player uses the menus). Nothing runs inside the tick.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import type { AdvisorSelection } from '../sim/player/advisorBrief';
import type { AdvisorCommandResult } from '../sim/player/advisorCommands';
import { buildOrderMenu, mapOrderAnswer, orderMenuPrompt, orderResponseSchema, type OrderMapping, type OrderMenu, type PendingOrder } from '../sim/scenario/llm/orderMenu';
import { fillPrompt } from './prompts/chronicle';
import { ORDERS_PROMPT_VERSION, ORDERS_SYSTEM } from './prompts/archivist';
import type { ChatMessage } from '../ui/advisorClient';
import type { LlmQueue, LlmResult } from './queue';
import { readReplica } from './replicaReads';

export const NO_ORDER_CLERK = 'No order clerk is available (no model answered): give the order through the menus.';

export type OrderOutcome = OrderMapping | { status: 'unavailable'; text: string };

export function buildOrderMessages(empire: Empire, menu: OrderMenu, text: string): ChatMessage[] {
    const p = orderMenuPrompt(menu);
    const system = fillPrompt(ORDERS_SYSTEM, { empire: empire.name, situation: p.situation, orders: p.orders });
    return [
        { role: 'system', content: system },
        { role: 'user', content: text.trim().slice(0, 400) },
    ];
}

/** Map a typed order to one legal op (or a question / a refusal). Never issues anything. Never rejects. */
export async function interpretOrder(galaxy: Galaxy, player: Empire, queue: LlmQueue | null, selection: AdvisorSelection, text: string): Promise<OrderOutcome> {
    if (text.trim() === '') return { status: 'clarify', text: 'What are your orders?' };
    if (queue === null) return { status: 'unavailable', text: NO_ORDER_CLERK };
    const menu = readReplica(galaxy, () => buildOrderMenu(galaxy, player, selection));
    const messages = buildOrderMessages(player, menu, text);
    let res: LlmResult;
    try {
        res = await queue.submit({
            priority: 'player',
            purpose: 'orders',
            situation: `v${ORDERS_PROMPT_VERSION}\n${messages[0].content}\n${messages[1].content}`,
            messages,
            schema: orderResponseSchema(menu),
            schemaName: 'order',
            temperature: 0,
            cache: false,
        });
    } catch (e) {
        res = { outcome: 'error', text: '', tokens: 0, latencyMs: 0, error: String(e) };
    }
    if (res.outcome !== 'ok' && res.outcome !== 'cached') return { status: 'unavailable', text: NO_ORDER_CLERK };
    return mapOrderAnswer(menu, res.text);
}

/** The result of a confirmed order, reported when the command applied (at the frame boundary). */
export interface ConfirmedOrderResult {
    ok: boolean;
    message: string;
}

/**
 * The player confirmed: issue the order through the command queue (applied at the next frame boundary and journaled).
 * A war declaration's own confirm is this click. Must be called between frames (a UI handler).
 */
export function confirmOrder(galaxy: Galaxy, player: Empire, order: PendingOrder, onApplied?: (r: ConfirmedOrderResult) => void): void {
    if (order.kind === 'advisor') {
        const command = { ...order.command };
        if (order.entry.confirm === true) command.confirm = true;
        issuePlayerCommand(galaxy, player, 'advisorCommands', [order.menu.brief, [command]], (rs: AdvisorCommandResult[]) => {
            const r = rs[0];
            onApplied?.({ ok: r?.ok === true, message: r !== undefined ? `${r.text}: ${r.message}` : 'not applied' });
        });
        return;
    }
    const op = order.entry.op;
    if (op.name === 'frontierOrder') {
        issuePlayerCommand(galaxy, player, 'frontierOrder', [op.sectorId, op.order], (r) =>
            onApplied?.({ ok: r.ok && r.refused !== true, message: r.refused === true ? 'the governor refused the order' : r.ok ? 'done' : (r.reason ?? 'refused') }),
        );
    } else {
        issuePlayerCommand(galaxy, player, 'frontierConcede', [op.sectorId], (r) => onApplied?.({ ok: r.ok, message: r.ok ? 'done' : (r.reason ?? 'refused') }));
    }
}
