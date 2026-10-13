// P4 "Speak freely" (flag llmNegotiation): the player's words → the treaty clerk (llm/negotiation.ts) → a confirmation
// card → Propose issues the journaled `llmNegotiate` command. The reply (the ported verdict, optionally voiced) and up
// to 3 sim-computed counter-offers follow; each counter is a card the player can propose. No model → the box hides and
// a note points to the trade panel. Also exports the counter cards for the trade panel (they work without a model).

import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { DialogPartType } from '../../sim/data/dialogSet';
import type { NegotiationPackage, NegotiationResult } from '../../sim/scenario/llm/negotiation';
import { isHumanEmpire, isMultiHuman } from '../../sim/humanEmpires';
import { cardFor, counterText, interpretNegotiation, NO_ENVOY, proposeNegotiation, voiceNegotiationReply, type NegotiationCard } from '../../llm/negotiation';
import { currentLlmLayer } from '../../llm/llmLayer';
import { el, glassButton, openOriginalWindow, type OriginalWindow } from '../originalWindow';

export interface NegotiationWindowOptions {
    galaxy: Galaxy;
    player: Empire;
    other: Empire;
    /** The dialog line of a reply part (the race's dialog file). */
    resolveReply: (part: DialogPartType, e: Empire) => Promise<string>;
    /** Open the plain trade panel instead. */
    openTrade?: () => void;
    onApplied?: (r: NegotiationResult) => void;
}

let open: OriginalWindow | null = null;

function verdictLine(r: NegotiationResult): string {
    switch (r.verdict) {
        case 'accepted':
            return 'Accepted.';
        case 'offered':
            return 'Sent: they will answer for themselves.';
        case 'improve':
            return 'They want a little more.';
        case 'insulted':
            return 'They are insulted.';
        case 'stale':
            return `Not possible: ${r.message}`;
        case 'off':
            return r.message;
        default:
            return r.message !== '' && r.reply === null ? `Refused: ${r.message}` : 'Refused.';
    }
}

/**
 * The counter cards of a result (pure sim packages): each shows what changes and a Propose button. `onPropose` gets
 * the package; `highlight` (the counter the voice mentioned) comes first.
 */
export function counterCards(galaxy: Galaxy, player: Empire, other: Empire, counters: readonly NegotiationPackage[], onPropose: (p: NegotiationPackage) => void, highlight = -1): HTMLElement {
    const box = el('div', 'negotiation-counters');
    box.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px';
    const order = counters.map((_, i) => i).sort((a, b) => (a === highlight ? -1 : b === highlight ? 1 : a - b));
    for (const i of order) {
        const c = counters[i];
        const card = el('div', 'negotiation-card');
        card.style.cssText = `border:1px solid ${i === highlight ? '#e0c060' : '#667'};border-radius:6px;padding:6px;background:rgba(0,0,0,0.35)`;
        card.appendChild(el('div', '', `Counter-offer: ${counterText(galaxy, player, other, c)}`));
        card.appendChild(glassButton('Propose', { onClick: () => onPropose(c) }));
        box.appendChild(card);
    }
    return box;
}

export function closeNegotiationWindow(): void {
    open?.close();
    open = null;
}

export function openNegotiationWindow(opts: NegotiationWindowOptions): void {
    const { galaxy, player, other } = opts;
    closeNegotiationWindow();
    const win = openOriginalWindow({ id: 'diplomacy-negotiate', title: `Speak freely — ${other.name}`, icon: 'diplomacy.png', width: 560, height: 560, noAutoPause: true, onClose: () => (open = null) });
    open = win;
    win.root.style.zIndex = '1600';
    const body = el('div', 'negotiation-body ow-scroll');
    body.style.cssText = `position:absolute;inset:0;padding:12px;overflow:auto;display:flex;flex-direction:column;gap:8px;color:#ddd;font-size:15px`;
    win.body.appendChild(body);
    const human = isMultiHuman(galaxy) && isHumanEmpire(galaxy, other);
    const queue = currentLlmLayer()?.queue ?? null;

    const input = el('textarea', 'negotiation-input');
    input.rows = 3;
    input.maxLength = 400;
    input.placeholder = 'e.g. "I will give you 5,000 credits and our galaxy map for a free trade agreement."';
    input.style.cssText = 'width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #556;border-radius:4px;padding:6px;font:inherit';
    const status = el('div', 'negotiation-status');
    const cardBox = el('div', 'negotiation-card-box');
    const replyBox = el('div', 'negotiation-reply');
    const ask = glassButton('Ask the clerk', { onClick: () => void interpret() });
    const row = el('div', '');
    row.style.cssText = 'display:flex;gap:8px';
    row.appendChild(ask);
    if (opts.openTrade !== undefined) row.appendChild(glassButton('Open trade panel', { onClick: () => opts.openTrade?.() }));
    body.append(input, row, status, cardBox, replyBox);
    input.hidden = true;
    ask.hidden = true;
    status.textContent = queue === null ? NO_ENVOY : 'Asking for the clerk…';
    if (queue !== null) {
        void queue.ensureProbe().then((up) => {
            if (win.closed) return;
            input.hidden = !up;
            ask.hidden = !up;
            status.textContent = up ? (human ? 'Your words go with the proposal; they answer for themselves.' : 'Say what you offer and what you want.') : NO_ENVOY;
            if (up) input.focus();
        });
    }

    let seq = 0;
    async function interpret(): Promise<void> {
        const my = ++seq;
        status.textContent = 'The clerk is drafting…';
        cardBox.replaceChildren();
        const m = await interpretNegotiation(galaxy, player, other, queue, input.value);
        if (win.closed || my !== seq) return;
        if (m.status !== 'card') {
            status.textContent = m.text;
            return;
        }
        status.textContent = m.understood;
        showCard(cardFor(galaxy, player, other, m, human));
    }

    function showCard(c: NegotiationCard): void {
        cardBox.replaceChildren();
        const card = el('div', 'negotiation-card');
        card.style.cssText = 'border:1px solid #e0c060;border-radius:6px;padding:8px;background:rgba(0,0,0,0.35);display:flex;flex-direction:column;gap:4px';
        card.appendChild(el('div', '', `You give: ${c.mapping.give.length > 0 ? c.mapping.give.join(', ') : 'nothing'}`));
        card.appendChild(el('div', '', `You ask: ${c.mapping.ask.length > 0 ? c.mapping.ask.join(', ') : 'nothing'}`));
        if (c.mapping.unmapped !== '') card.appendChild(el('div', '', `Not possible: ${c.mapping.unmapped} (no such term)`));
        card.appendChild(el('div', '', `Expected reception: ${c.receptionText}`));
        const btns = el('div', '');
        btns.style.cssText = 'display:flex;gap:8px';
        btns.append(
            glassButton('Propose', { onClick: () => propose(c.mapping.pkg) }),
            glassButton('Cancel', { onClick: () => cardBox.replaceChildren() }),
        );
        if (opts.openTrade !== undefined) btns.appendChild(glassButton('Open in trade panel', { onClick: () => opts.openTrade?.() }));
        card.appendChild(btns);
        cardBox.appendChild(card);
    }

    function propose(pkg: NegotiationPackage): void {
        cardBox.replaceChildren();
        replyBox.textContent = '…';
        proposeNegotiation(galaxy, player, other, pkg, (r) => {
            opts.onApplied?.(r);
            if (win.closed) return;
            void showResult(r);
        });
    }

    async function showResult(r: NegotiationResult): Promise<void> {
        replyBox.replaceChildren();
        const line = el('div', '', verdictLine(r));
        replyBox.appendChild(line);
        let original = '';
        if (r.reply !== null) {
            original = await opts.resolveReply(r.reply, other);
            if (win.closed) return;
            line.textContent = `${other.name}: ${original}`;
        }
        const cards = (hl: number): HTMLElement => counterCards(galaxy, player, other, r.counters, propose, hl);
        let shown = r.counters.length > 0 ? cards(-1) : null;
        if (shown !== null) replyBox.appendChild(shown);
        if (r.verdict === 'offered' || r.verdict === 'stale' || r.verdict === 'off' || human) return;
        const v = await voiceNegotiationReply(galaxy, player, other, queue, r, original);
        if (v === null || win.closed) return;
        line.textContent = `${other.name}: ${v.text}`;
        line.title = original;
        if (shown !== null && v.counter >= 0) {
            const next = cards(v.counter);
            shown.replaceWith(next);
            shown = next;
        }
    }
}
