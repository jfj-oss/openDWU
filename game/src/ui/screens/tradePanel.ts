// Trade negotiation panel (task 17e2): the original's two DiplomacyTradeTree controls either side of the diplomacy
// conversation (Main.Part8.cs:636 method_302; DistantWorlds.Controls/Controls/DiplomacyTradeTree.cs), streamlined:
// "They give" (ctlDiplomacyTradeThem) on the left, "We give" (ctlDiplomacyTradeUs) on the right, each with its
// "Offered Items (<total value>)" list (click an entry to take it back; required entries stay), "Clear Offered Items" and
// the tradeable items grouped as the tree shows them (click to offer); the other empire's reply and the conversation
// option ("Would you accept this trade?", Main.Part9.cs:305) below. All rules live in sim/player/tradeNegotiation.ts.
import './tradePanel.css';
import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { DialogPartType } from '../../sim/data/dialogSet';
import { resolveGameText } from '../../sim/textResolver';
import {
    addTradeItem,
    clearTradeItems,
    formatTradeLabel,
    offeredItemsValue,
    removeTradeItem,
    tradeItemLabel,
    tradeTreeRows,
    type TradeLabel,
    type TradeNegotiation,
    type TradeOfferResult,
    type TradeTree,
} from '../../sim/player/tradeNegotiation';
import { hasRemoteCommandSink, issuePlayerCommand } from '../../sim/player/playerCommands';
import type { TradeableItem } from '../../sim/tradeItems';
// [diplovoice] begin
import { FONT, glassButton, openOriginalWindow, place } from '../originalWindow';
import { counterNote, voicedLineToggle, voicingIndicator, type VoicedReply } from '../diplomatVoice';
// [diplovoice] end

export interface TradePanelOptions {
    galaxy: Galaxy;
    negotiation: TradeNegotiation;
    /** The reply line for a DialogPartType from the other empire's dialog file (method_230); resolved async. */
    resolveReply: (reply: DialogPartType, other: Empire) => Promise<string>;
    /** DiplomaticMessageQueue.ExpireDiplomacyMessagesForEmpire (a refused threat was carried out). */
    expireMessagesFor?: (empire: Empire) => void;
    /** Called after the deal changed hands or on close, so the opener can refresh. */
    onChange?: () => void;
    // [diplovoice] begin
    /** 18b: voice the other empire's reply to a proposed deal (null = not voiced; the original line stays). */
    voice?: (ctx: TradeVoiceContext, isCurrent: () => boolean, onStart: () => void) => Promise<VoicedReply | null>;
    // [diplovoice] end
}

// [diplovoice] begin
export interface TradeVoiceContext {
    /** Offered-items labels of the other empire's tree (what the player asks for) and the player's tree. */
    theyGive: string[];
    weGive: string[];
    accepted: boolean;
    reply: DialogPartType | null;
    /** The original dialog line. */
    original: string;
}
// [diplovoice] end

interface OpenPanel {
    close: () => void;
}
let open: OpenPanel | null = null;

/** Open the trade panel on `negotiation` (replacing any open one). */
export function openTradePanel(opts: TradePanelOptions): void {
    open?.close();
    open = createTradePanel(opts);
}

/** Close the trade panel (no-op when closed). */
export function closeTradePanel(): void {
    open?.close();
}

export function isTradePanelOpen(): boolean {
    return open !== null;
}

/**
 * Sim worker (docs/sim-worker.md §9 chunk 7): the worker built the negotiation a DEAL_BEGIN reply carries; its trees
 * arrive by value but their TradeableItems as replica objects (a save class: the reply names it by sync id). The panel
 * edits the offered lists, and the edited negotiation goes back by value with submitTradeOffer, so none of it may stay
 * part of the replica (a replica item would be sent by sync id, i.e. as the worker's original, and edits to replica
 * objects are writes the sync undoes). This copy is the UI-owned negotiation in-thread play has: new trees, lists and
 * TradeableItems (shared items stay shared: a required item is also in the offered list), the same empires and traded
 * objects.
 */
export function detachTradeNegotiation(n: TradeNegotiation): TradeNegotiation {
    const items = new Map<TradeableItem, TradeableItem>();
    const item = (t: TradeableItem): TradeableItem => {
        let c = items.get(t);
        if (c === undefined) {
            c = Object.assign(Object.create(Object.getPrototypeOf(t) as object) as TradeableItem, t);
            items.set(t, c);
        }
        return c;
    };
    const tree = (t: TradeTree): TradeTree => ({
        empire: t.empire,
        otherEmpire: t.otherEmpire,
        allowDiplomaticThreats: t.allowDiplomaticThreats,
        refactorValuesForEmpire: t.refactorValuesForEmpire,
        tradeableItems: t.tradeableItems.map(item),
        selected: t.selected.map(item),
        required: t.required.map(item),
        excluded: t.excluded.map(item),
    });
    return { player: n.player, other: n.other, kind: n.kind, us: tree(n.us), them: tree(n.them) };
}

/** The text of a tree / list entry: the GameText part resolved, then " (value)". */
export function tradeLabelText(label: TradeLabel): string {
    return formatTradeLabel(resolveGameText(label.text), label);
}

/** CSS class of the reply line for a result (the 17e diplomacy-reply colours). */
export function tradeReplyClass(result: TradeOfferResult | null): string {
    if (result === null) return 'trade-reply';
    if (!result.ok) return 'trade-reply trade-reply-error';
    return result.accepted ? 'trade-reply trade-reply-accepted' : 'trade-reply trade-reply-refused';
}

function el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
    return glassButton(text, { size: className === 'trade-propose' ? FONT.normal : FONT.tiny, className: `ow-flow ${className}`, onClick });
}

function rgb(c: number): string {
    return `rgb(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255})`;
}

function createTradePanel(opts: TradePanelOptions): OpenPanel {
    const { galaxy } = opts;
    // In-thread the reply's negotiation is already the UI's own; a replica's is detached first (see above).
    const negotiation = hasRemoteCommandSink(galaxy) ? detachTradeNegotiation(opts.negotiation) : opts.negotiation;
    const other = negotiation.other;
    // Original-style ScreenPanel (ui/originalWindow.ts); it sits above the Diplomacy screen and does not pause.
    const owin = openOriginalWindow({
        id: 'trade',
        title: `Trade negotiation — ${other.name}`,
        icon: 'diplomacy.png',
        width: 900,
        height: 760,
        noAutoPause: true,
        onClose: () => close(),
    });
    const root = owin.root;
    root.classList.add('trade-wrap');
    root.style.zIndex = '1600'; // above the Diplomacy screen (1500)
    const body = el('div', 'trade-body');
    place(body, 0, 0, owin.bodySize.w, owin.bodySize.h);
    owin.body.appendChild(body);

    let last: TradeOfferResult | null = null;
    // Main.Part10.cs:4324 DEAL_BEGIN: the conversation shows "What do you propose?" first.
    let replyPart: DialogPartType | null = 'DEAL_BEGIN';
    let optionLabel = 'Would you accept this trade?';
    let done = false;
    let builtKey = '';
    // [diplovoice] begin
    let voice: { result: TradeOfferResult; pending: boolean; reply: VoicedReply | null; view: { showOriginal: boolean } } | null = null;
    let closed = false;
    // [diplovoice] end

    function sideKey(tree: TradeTree): string {
        const rows = tradeTreeRows(galaxy, tree);
        return rows.map((g) => `${g.heading}:${g.rows.map((r) => r.label.text + r.label.value).join(',')}`).join(';') + '|' + tree.selected.map((t) => `${t.type}:${t.value}`).join(',');
    }

    function column(tree: TradeTree, title: string, color: number): HTMLElement {
        const col = el('div', 'trade-column');
        const head = el('div', 'trade-column-title');
        const sw = el('span', 'trade-swatch');
        sw.style.background = rgb(color);
        head.append(sw, el('span', '', title));
        col.appendChild(head);

        // DiplomacyTradeTree.cs:250 UpdateOfferedItemsHeading.
        const offeredHead = el('div', 'trade-offered-heading');
        offeredHead.append(el('span', '', `${resolveGameText('Offered Items')} (${offeredItemsValue(tree).toLocaleString('en-US')})`));
        if (!done) {
            offeredHead.appendChild(
                button('trade-small', resolveGameText('Clear Offered Items'), () => {
                    clearTradeItems(tree);
                    render(true);
                }),
            );
        }
        col.appendChild(offeredHead);
        const offered = el('div', 'trade-offered');
        if (tree.selected.length === 0) offered.appendChild(el('div', 'trade-muted', '(nothing)'));
        const showNames = tree.empire === galaxy.playerEmpire; // DiplomacyTradeTree.cs:179
        tree.selected.forEach((t, i) => {
            const required = tree.required.includes(t);
            const line = el('div', required || done ? 'trade-offered-item trade-required' : 'trade-offered-item', tradeLabelText(tradeItemLabel(galaxy, t, true, showNames)));
            if (!required && !done) {
                line.title = 'Click to remove';
                line.addEventListener('click', () => {
                    if (removeTradeItem(tree, i)) render(true);
                });
            }
            offered.appendChild(line);
        });
        col.appendChild(offered);

        // DiplomacyTradeTree.cs:255 PopulateTradeableItems.
        const list = el('div', 'trade-items');
        for (const g of tradeTreeRows(galaxy, tree)) {
            if (g.single) {
                const r = g.rows[0];
                list.appendChild(itemRow(tree, r.item, tradeLabelText(r.label), 'trade-item trade-item-single'));
                continue;
            }
            list.appendChild(el('div', 'trade-group', resolveGameText(g.heading)));
            if (g.rows.length === 0) list.appendChild(el('div', 'trade-item trade-muted', '(none)'));
            for (const r of g.rows) list.appendChild(itemRow(tree, r.item, tradeLabelText(r.label), 'trade-item'));
        }
        col.appendChild(list);
        return col;
    }

    function itemRow(tree: TradeTree, item: Parameters<typeof addTradeItem>[2], text: string, cls: string): HTMLElement {
        const row = el('div', done ? `${cls} trade-disabled` : cls, text);
        if (!done) {
            row.title = 'Click to offer';
            row.addEventListener('click', () => {
                if (addTradeItem(galaxy, tree, item)) render(true);
            });
        }
        return row;
    }

    function render(force = false): void {
        const key = `${done}|${replyPart}|${sideKey(negotiation.them)}#${sideKey(negotiation.us)}`;
        if (!force && key === builtKey) return;
        builtKey = key;
        const scrolls = [...body.querySelectorAll<HTMLElement>('.trade-items')].map((e) => e.scrollTop);
        body.replaceChildren();

        const reply = el('div', tradeReplyClass(last));
        reply.appendChild(el('span', 'trade-reply-speaker', `${other.name}:`));
        const text = el('span', 'trade-reply-text', last !== null && !last.ok ? last.message : '…');
        reply.appendChild(text);
        body.appendChild(reply);
        // [diplovoice] begin
        const v = voice !== null && voice.result === last ? voice : null;
        const isVoiced = v !== null && !v.pending && v.reply !== null && v.reply.voiced;
        if (isVoiced) {
            reply.appendChild(voicedLineToggle(text, v.reply!.text, v.reply!.original, v.view));
            const note = counterNote(v.reply!.counter);
            if (note !== null) body.appendChild(note);
        } else if (v?.pending === true) {
            reply.appendChild(voicingIndicator());
        }
        // [diplovoice] end
        if (!isVoiced && replyPart !== null && (last === null || last.ok)) {
            const part = replyPart;
            void opts.resolveReply(part, other).then((s) => {
                if (replyPart === part) text.textContent = s;
            });
        }

        const cols = el('div', 'trade-columns');
        cols.append(column(negotiation.them, other.name, other.mainColor), column(negotiation.us, negotiation.player.name, negotiation.player.mainColor));
        body.appendChild(cols);
        [...body.querySelectorAll<HTMLElement>('.trade-items')].forEach((e, i) => (e.scrollTop = scrolls[i] ?? 0));

        const footer = el('div', 'trade-footer');
        if (done) {
            footer.appendChild(button('trade-propose', 'Close', () => close()));
        } else {
            footer.appendChild(button('trade-propose', resolveGameText(optionLabel), propose));
        }
        body.appendChild(footer);
    }

    // Main.Part10.cs:4334 DEAL_OFFER.
    function propose(): void {
        // [diplovoice] begin
        const label = (t: (typeof negotiation.us.selected)[number]): string => tradeLabelText(tradeItemLabel(galaxy, t, true, true));
        const theyGive = negotiation.them.selected.map(label);
        const weGive = negotiation.us.selected.map(label);
        // [diplovoice] end
        // Command log: queued, applied at the next frame boundary; the reply shows then.
        issuePlayerCommand(galaxy, negotiation.player, 'submitTradeOffer', [negotiation], (r) => proposed(r, theyGive, weGive));
    }

    function proposed(r: TradeOfferResult, theyGive: string[], weGive: string[]): void {
        last = r;
        replyPart = r.reply;
        if (r.ok && r.nextOptionLabel !== '') optionLabel = r.nextOptionLabel;
        if (r.ok && (r.accepted || r.nextOptionLabel === '')) done = true;
        if (r.expireMessagesFor !== null) opts.expireMessagesFor?.(r.expireMessagesFor);
        opts.onChange?.();
        render(true);
        // [diplovoice] begin
        if (opts.voice !== undefined && r.ok && r.reply !== null) {
            const voiceFn = opts.voice;
            const part = r.reply;
            void opts.resolveReply(part, other).then(async (original) => {
                if (closed || last !== r) return;
                const state = { result: r, pending: false, reply: null as VoicedReply | null, view: { showOriginal: false } };
                voice = state;
                const current = (): boolean => !closed && last === r;
                const answer = await voiceFn({ theyGive, weGive, accepted: r.accepted, reply: part, original }, current, () => {
                    state.pending = true;
                    if (!closed) render(true);
                });
                state.pending = false;
                state.reply = answer;
                if (answer !== null && answer.counter?.status === 'proposed') opts.onChange?.();
                if (!closed) render(true);
            });
        }
        // [diplovoice] end
    }

    render(true);
    const timer = setInterval(() => render(false), 1000);

    function close(): void {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        if (!owin.closed) owin.close();
        if (open === panel) open = null;
        opts.onChange?.();
    }
    const panel: OpenPanel = { close };
    return panel;
}
