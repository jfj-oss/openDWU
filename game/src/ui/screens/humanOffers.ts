// Diplomacy between human players on the screen (multiplayer Phase 5, docs/MULTIPLAYER.md §18; sim:
// player/humanDiplomacy.ts). Not in the original.
//
// - The receiver: each pending offer to this screen's player (the local viewer: in hot seat, the offer waits for that
//   player's turn) pops up — who offers what (a treaty, peace, a gift, a demand, a trade's two lists), the game time
//   left — with Accept / Reject / Counter… (counter: decline, and the Diplomacy screen opens on the sender to propose
//   something else). The answer is the journaled answerHumanOffer: its effect applies at the same frame on every peer.
// - The sender: the Diplomacy screen says "Offer sent — awaiting their reply"; the answer comes as a notice here
//   (accepted, rejected, countered, expired, no longer possible).
// - The sender's pending offers (docs/MULTIPLAYER.md §21): while it has any, a "Your offers (N)" button under the popups
//   opens the list — to whom, what, the game time left — with Withdraw on each (the journaled withdrawHumanOffer).
//
// Main thread / DOM. Reads the galaxy (in worker mode, the replica: the offers are a synced side table).

import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import { empireOfId, humanOffers, offerPending, type HumanOffer, type HumanOfferResult } from '../../sim/player/humanDiplomacy';
import { formatTradeLabel, type TradeLabel } from '../../sim/player/tradeNegotiation';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { isMultiHuman } from '../../sim/humanEmpires';
import { resolveGameText } from '../../sim/textResolver';
import { showToast } from '../toast';
import { exposeDevHook } from '../multiplayer/devHooks';
import './humanOffers.css';

export interface HumanOffersOptions {
    galaxy: () => Galaxy;
    /** This screen's player (the local viewer). */
    viewer: () => Empire | null;
    /** Counter: open the Diplomacy screen on `empire`. */
    openDiplomacy: (empire: Empire) => void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls !== '') e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function labelText(l: TradeLabel): string {
    return formatTradeLabel(resolveGameText(l.text), l);
}

/** "2:30" of game time. */
function timeLeft(ms: number): string {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What the offer is, in one line, from the receiver's side. */
export function offerText(o: HumanOffer, fromName: string): string {
    if (o.kind === 'trade' && o.trade !== null) {
        const get = o.trade.senderGives.map(labelText);
        const give = o.trade.receiverGives.map(labelText);
        const what = o.trade.kind === 'end-war' ? ' to end the war' : o.trade.kind === 'lift-sanctions' ? ' to lift the trade sanctions' : '';
        return `${fromName} proposes a trade${what}. You receive: ${get.length > 0 ? get.join(', ') : 'nothing'}. You give: ${give.length > 0 ? give.join(', ') : 'nothing'}.`;
    }
    // "Propose Free Trade Agreement" → "Free Trade Agreement" (the label is the sender's menu line).
    const label = resolveGameText(o.label).replace(/^(Propose|Offer)\s+/i, '');
    if (o.option.startsWith('GIFT_GIVE')) return `${fromName} offers you a gift of ${Math.round(o.cost).toLocaleString('en-US')} credits.`;
    if (o.option.startsWith('WARNING_')) return `${fromName} demands: ${label}.`;
    return `${fromName} proposes: ${label}.`;
}

/** The sender's own pending offer, in one line ("To X: Free Trade Agreement."). */
export function ownOfferText(o: HumanOffer, toName: string): string {
    if (o.kind === 'trade' && o.trade !== null) {
        const give = o.trade.senderGives.map(labelText);
        const get = o.trade.receiverGives.map(labelText);
        const what = o.trade.kind === 'end-war' ? ' to end the war' : o.trade.kind === 'lift-sanctions' ? ' to lift the trade sanctions' : '';
        return `Trade with ${toName}${what}. You give: ${give.length > 0 ? give.join(', ') : 'nothing'}. You receive: ${get.length > 0 ? get.join(', ') : 'nothing'}.`;
    }
    if (o.option.startsWith('GIFT_GIVE')) return `To ${toName}: a gift of ${Math.round(o.cost).toLocaleString('en-US')} credits.`;
    return `To ${toName}: ${resolveGameText(o.label).replace(/^(Propose|Offer)\s+/i, '')}.`;
}

/** What became of the sender's offer, in one line. */
function outcomeText(o: HumanOffer, toName: string, what: string): string {
    switch (o.state) {
        case 'accepted':
            return `${toName} accepted: ${what}.`;
        case 'rejected':
            return `${toName} rejected: ${what}.`;
        case 'countered':
            return `${toName} declined (${what}) and will make you another offer.`;
        case 'expired':
            return `${toName} did not answer in time: ${what} expired.`;
        case 'failed':
            return `${what}: ${o.note || 'no longer possible'}.`;
        default:
            return '';
    }
}

/** Install the offers UI for the game on screen; returns the teardown. Does nothing in a one-human game. */
export function installHumanOffers(opts: HumanOffersOptions): () => void {
    const root = h('div', 'human-offers');
    root.dataset.ui = 'human-offers';
    document.body.appendChild(root);
    /** Offers answered here (their popup closed) or shown as an outcome, by id. */
    const answered = new Set<number>();
    const told = new Set<number>();
    const popups = new Map<number, { el: HTMLElement; time: HTMLElement }>();
    const watched = new Set<number>(); // the viewer's own pending offers (their outcome is told once)
    // The sender's list of its own pending offers (withdraw).
    const ownBtn = h('button', 'human-offer-btn human-offers-own-btn');
    ownBtn.type = 'button';
    ownBtn.dataset.ui = 'own-offers';
    ownBtn.hidden = true;
    const ownPanel = h('div', 'human-offer human-offers-own');
    ownPanel.dataset.ui = 'own-offers-panel';
    ownPanel.hidden = true;
    let ownOpen = false;
    ownBtn.addEventListener('click', () => {
        ownOpen = !ownOpen;
        sync();
    });
    const withdrawing = new Set<number>();
    const withdraw = (o: HumanOffer, viewer: Empire): void => {
        withdrawing.add(o.id);
        issuePlayerCommand(opts.galaxy(), viewer, 'withdrawHumanOffer', [o.id], (r: HumanOfferResult) => {
            withdrawing.delete(o.id);
            showToast(r.ok ? 'Offer withdrawn.' : `Not possible: ${r.message}`, document.body, 4000);
        });
        sync();
    };
    let ownKey = '';
    const paintOwn = (mine: HumanOffer[], viewer: Empire | null, galaxy: Galaxy, now: number): void => {
        ownBtn.hidden = mine.length === 0 || viewer === null;
        if (mine.length === 0) ownOpen = false;
        const label = `Your offers (${mine.length}) ${ownOpen ? '▾' : '▸'}`;
        if (ownBtn.textContent !== label) ownBtn.textContent = label;
        ownPanel.hidden = !ownOpen || viewer === null;
        if (ownPanel.hidden || viewer === null) return;
        const key = mine.map((o) => `${o.id}:${withdrawing.has(o.id) ? 'w' : ''}`).join(',');
        if (key !== ownKey) {
            ownKey = key;
            ownPanel.replaceChildren(h('div', 'human-offer-title', 'Your pending offers'));
            for (const o of mine) {
                const row = h('div', 'human-offers-own-row');
                row.dataset.offer = String(o.id);
                row.appendChild(h('div', 'human-offer-text', ownOfferText(o, empireOfId(galaxy, o.to)?.name ?? 'Another player')));
                const time = h('div', 'human-offer-time');
                time.dataset.ui = 'own-offer-time';
                row.appendChild(time);
                const b = h('button', 'human-offer-btn human-offer-reject', withdrawing.has(o.id) ? 'Withdrawing…' : 'Withdraw');
                b.type = 'button';
                b.dataset.ui = 'offer-withdraw';
                b.disabled = withdrawing.has(o.id);
                b.title = 'Take the offer back: the other player can no longer accept it.';
                b.addEventListener('click', () => withdraw(o, viewer));
                const bar = h('div', 'human-offer-bar');
                bar.appendChild(b);
                row.appendChild(bar);
                ownPanel.appendChild(row);
            }
        }
        for (const o of mine) {
            const t = ownPanel.querySelector<HTMLElement>(`[data-offer="${o.id}"] [data-ui="own-offer-time"]`);
            if (t !== null) t.textContent = `Expires in ${timeLeft(o.expiresMs - now)} (game time)`;
        }
    };

    const answer = (o: HumanOffer, a: 'accept' | 'reject' | 'counter', viewer: Empire): void => {
        answered.add(o.id);
        popups.get(o.id)?.el.remove();
        popups.delete(o.id);
        const from = empireOfId(opts.galaxy(), o.from);
        issuePlayerCommand(opts.galaxy(), viewer, 'answerHumanOffer', [o.id, a], (r: HumanOfferResult) => {
            showToast(r.ok ? (a === 'accept' ? `Accepted: ${r.message}` : r.message) : `Not possible: ${r.message}`, document.body, 4000);
        });
        if (a === 'counter' && from !== null) opts.openDiplomacy(from);
    };

    const popup = (o: HumanOffer, viewer: Empire, galaxy: Galaxy): void => {
        const from = empireOfId(galaxy, o.from);
        const fromName = from?.name ?? 'Another player';
        const el = h('div', 'human-offer');
        el.dataset.offer = String(o.id);
        el.dataset.ui = 'human-offer';
        el.appendChild(h('div', 'human-offer-title', 'Diplomatic offer'));
        el.appendChild(h('div', 'human-offer-text', offerText(o, fromName)));
        const time = h('div', 'human-offer-time');
        el.appendChild(time);
        const bar = h('div', 'human-offer-bar');
        const mk = (label: string, key: 'accept' | 'reject' | 'counter', title: string): HTMLButtonElement => {
            const b = h('button', `human-offer-btn human-offer-${key}`, label);
            b.type = 'button';
            b.dataset.ui = `offer-${key}`;
            b.title = title;
            b.addEventListener('click', () => answer(o, key, viewer));
            return b;
        };
        bar.append(mk('Accept', 'accept', 'Agree: it takes effect for both of you.'), mk('Reject', 'reject', 'Refuse.'), mk('Counter…', 'counter', 'Refuse and make them another offer (the Diplomacy screen opens).'));
        el.appendChild(bar);
        root.insertBefore(el, ownBtn);
        popups.set(o.id, { el, time });
    };

    const sync = (): void => {
        let galaxy: Galaxy;
        try {
            galaxy = opts.galaxy();
        } catch {
            return;
        }
        const viewer = opts.viewer();
        const offers = isMultiHuman(galaxy) ? humanOffers(galaxy) : [];
        const now = galaxy.nowMs;
        const live = new Set<number>();
        const mine: HumanOffer[] = [];
        for (const o of offers) {
            if (viewer !== null && o.from === viewer.empireId && offerPending(o, now)) mine.push(o);
        }
        paintOwn(mine, viewer, galaxy, now);
        for (const o of offers) {
            if (viewer === null) break;
            const pending = offerPending(o, now);
            if (o.to === viewer.empireId && pending && !answered.has(o.id)) {
                live.add(o.id);
                if (!popups.has(o.id)) popup(o, viewer, galaxy);
                popups.get(o.id)!.time.textContent = `Expires in ${timeLeft(o.expiresMs - now)} (game time)`;
            }
            if (o.from === viewer.empireId) {
                if (pending) watched.add(o.id);
                else if (watched.has(o.id) && !told.has(o.id)) {
                    told.add(o.id);
                    const to = empireOfId(galaxy, o.to);
                    const what = o.kind === 'trade' ? 'your trade offer' : `your offer (${resolveGameText(o.label)})`;
                    const t = outcomeText(o.state === 'pending' ? { ...o, state: 'expired' } : o, to?.name ?? 'The other player', what);
                    if (t !== '') showToast(t, document.body, 6000);
                }
            }
        }
        // An offer no longer pending (answered elsewhere, expired, another turn's player): its popup goes.
        for (const [id, p] of popups) {
            if (!live.has(id)) {
                p.el.remove();
                popups.delete(id);
            }
        }
    };
    // The own-offers button and its list sit under the popups.
    root.append(ownBtn, ownPanel);
    const timer = setInterval(sync, 500);
    sync();
    exposeDevHook('__dwuOffers', {
        list: () => {
            try {
                return humanOffers(opts.galaxy()).map((o) => ({ ...o }));
            } catch {
                return [];
            }
        },
        /** Open (or close) the list of this player's own pending offers. */
        openOwn: (on = true) => {
            ownOpen = on;
            sync();
        },
    });
    return () => {
        clearInterval(timer);
        root.remove();
        delete (window as unknown as { __dwuOffers?: unknown }).__dwuOffers;
    };
}
