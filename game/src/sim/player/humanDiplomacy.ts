// Diplomacy between human players (multiplayer Phase 5, docs/MULTIPLAYER.md §18). Not in the original (one human).
//
// The Diplomacy screen's proposals and trades (player/diplomacyProposals.ts, player/tradeNegotiation.ts) are answered at
// once by the other empire's AI. When the other empire is a human's (decision §4.9: the AI never decides for a human),
// a proposal that needs their consent becomes an OFFER instead: it waits for that player's answer — accept, reject or
// counter (reject and propose something else) — or expires after HUMAN_OFFER_TIMEOUT_MS of game time.
//
// - Everything is a journaled player command, so lockstep stays deterministic: the offer is made when the sender's
//   submitProposal / submitTradeOffer applies (every peer adds the same offer at the same frame), the answer is the
//   receiver's answerHumanOffer, and the effect of an accepted offer is applied by that command, at its frame, on every
//   peer, through the same code an AI's acceptance runs (evaluateProposal with the decision given; the trade's
//   giveTradeableItem both ways).
// - Expiry is read from galaxy time when a command touches the list (no tick of its own: a game without offers runs
//   exactly as before); the screens show the time left from the same clock.
// - Hot seat: an offer waits in the galaxy until its receiver's turn (the popup is shown to the local viewer only).
// - Acts that need no consent (declare war, cancel a treaty, impose or lift sanctions, release a dominion, mining /
//   refuelling rights) take effect at once, as before.
// - The offers are sim state outside the object graph: the save side table `humanOffers` (sim/save/galaxySave.ts),
//   written only while there is one, so every other game saves the same text as before; the replica sync carries it.
//
// Headless (sim): no DOM.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { EncodedArg } from './commandCodec';
import type { TradeLabel, TradeNegotiation } from './tradeNegotiation';
import { offerTable as table, type HumanOffer, type HumanOfferAnswer, type HumanOfferState } from './humanOfferTable';

export { savedHumanOffers, restoreHumanOffers, type HumanOffer, type HumanOfferAnswer, type HumanOfferState } from './humanOfferTable';

/**
 * The command-log codec (player/commandCodec.ts), handed in by playerCommands.ts: importing it here would close an
 * import cycle through the save code (tradeNegotiation → here → commandCodec → galaxySave → … → tradeNegotiation).
 */
let codec: { encode: (galaxy: Galaxy, value: unknown) => EncodedArg; decode: (galaxy: Galaxy, value: EncodedArg) => unknown } | null = null;

export function setHumanOfferCodec(c: typeof codec): void {
    codec = c;
}

/** How long an offer waits for its answer, in game ms (3 minutes at 2x). */
export const HUMAN_OFFER_TIMEOUT_MS = 6 * 60_000;
/** Answered offers kept for the sender's screen this long (game ms), at most HUMAN_OFFERS_KEEP of them. */
const ANSWERED_KEEP_MS = 3 * 60_000;
const HUMAN_OFFERS_KEEP = 40;

/** The offers (pending and recently answered), oldest first. */
export function humanOffers(galaxy: Galaxy): readonly HumanOffer[] {
    return table(galaxy, false)?.offers ?? [];
}

/** The empire with this empireId (offers name empires by id: JSON, stable). */
export function empireOfId(galaxy: Galaxy, id: number): Empire | null {
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires, galaxy.independentEmpire]) if (e != null && e.empireId === id) return e;
    return null;
}

/** Whether an offer still waits for its answer at galaxy time `nowMs`. */
export function offerPending(o: HumanOffer, nowMs: number): boolean {
    return o.state === 'pending' && nowMs < o.expiresMs;
}

/** Mark the expired ones, drop old answered ones (only when a command touches the list). */
function settle(galaxy: Galaxy): { nextId: number; offers: HumanOffer[] } {
    const t = table(galaxy, true)!;
    const now = galaxy.nowMs;
    for (const o of t.offers) {
        if (o.state === 'pending' && now >= o.expiresMs) {
            o.state = 'expired';
            o.answeredMs = o.expiresMs;
        }
    }
    t.offers = t.offers.filter((o) => o.state === 'pending' || now - o.answeredMs < ANSWERED_KEEP_MS);
    while (t.offers.length > HUMAN_OFFERS_KEEP) {
        const i = t.offers.findIndex((o) => o.state !== 'pending');
        if (i < 0) break;
        t.offers.splice(i, 1);
    }
    return t;
}

function add(galaxy: Galaxy, o: Omit<HumanOffer, 'id' | 'createdMs' | 'expiresMs' | 'state' | 'answeredMs' | 'note'>): HumanOffer {
    const t = settle(galaxy);
    // One pending offer of the same kind between the same two empires: the newer replaces it.
    for (const old of t.offers) {
        if (old.state === 'pending' && old.from === o.from && old.to === o.to && old.option === o.option) {
            old.state = 'withdrawn';
            old.answeredMs = galaxy.nowMs;
            old.note = 'replaced by a newer offer';
        }
    }
    const offer: HumanOffer = { ...o, id: t.nextId++, createdMs: galaxy.nowMs, expiresMs: galaxy.nowMs + HUMAN_OFFER_TIMEOUT_MS, state: 'pending', answeredMs: 0, note: '' };
    t.offers.push(offer);
    return offer;
}

/** A proposal to a human's empire (diplomacyProposals.ts submitProposal): an offer. */
export function addProposalOffer(galaxy: Galaxy, from: Empire, to: Empire, option: { id: string; label: string; cost: number }): HumanOffer {
    return add(galaxy, { from: from.empireId, to: to.empireId, kind: 'proposal', option: option.id, label: option.label, cost: option.cost, trade: null });
}

/** A trade to a human's empire (tradeNegotiation.ts submitTradeOffer): an offer (the negotiation by value, encoded). */
export function addTradeOffer(galaxy: Galaxy, negotiation: TradeNegotiation, receiverGives: TradeLabel[], senderGives: TradeLabel[]): HumanOffer {
    if (codec === null) throw new Error('humanDiplomacy: no command codec');
    const encoded = codec.encode(galaxy, negotiation);
    return add(galaxy, { from: negotiation.player.empireId, to: negotiation.other.empireId, kind: 'trade', option: 'trade', label: '', cost: 0, trade: { kind: negotiation.kind, encoded, receiverGives, senderGives } });
}

/** The negotiation of a trade offer, decoded against the galaxy now (throws when an item no longer resolves). */
export function offerNegotiation(galaxy: Galaxy, o: HumanOffer): TradeNegotiation {
    if (o.trade === null) throw new Error('not a trade offer');
    if (codec === null) throw new Error('humanDiplomacy: no command codec');
    return codec.decode(galaxy, o.trade.encoded) as TradeNegotiation;
}

export interface HumanOfferResult {
    ok: boolean;
    /** What happened, for the screen. */
    message: string;
    offer: HumanOffer | null;
}

/**
 * The receiver's answer (the journaled answerHumanOffer). `accept` applies the offer through `apply` (diplomacyProposals
 * / tradeNegotiation: the same effect an AI's acceptance has), which says whether it still could.
 */
export function answerOffer(galaxy: Galaxy, empire: Empire, id: number, answer: HumanOfferAnswer, apply: (o: HumanOffer, from: Empire, to: Empire) => { ok: boolean; message: string }): HumanOfferResult {
    const t = settle(galaxy);
    const o = t.offers.find((x) => x.id === id);
    if (o === undefined) return { ok: false, message: 'No such offer.', offer: null };
    if (o.to !== empire.empireId) return { ok: false, message: 'This offer is not for you.', offer: o };
    if (o.state !== 'pending') return { ok: false, message: o.state === 'expired' ? 'The offer has expired.' : 'The offer is no longer open.', offer: o };
    const from = empireOfId(galaxy, o.from);
    if (from === null || !from.active || !empire.active) {
        o.state = 'failed';
        o.answeredMs = galaxy.nowMs;
        o.note = 'An empire of this offer is gone.';
        return { ok: false, message: o.note, offer: o };
    }
    o.answeredMs = galaxy.nowMs;
    if (answer !== 'accept') {
        o.state = answer === 'counter' ? 'countered' : 'rejected';
        return { ok: true, message: answer === 'counter' ? 'You declined; make them another offer.' : 'You rejected the offer.', offer: o };
    }
    const r = apply(o, from, empire);
    o.state = r.ok ? 'accepted' : 'failed';
    o.note = r.ok ? '' : r.message;
    return { ok: r.ok, message: r.message, offer: o };
}

/** The sender takes its pending offer back (withdrawHumanOffer). */
export function withdrawOffer(galaxy: Galaxy, empire: Empire, id: number): HumanOfferResult {
    const t = settle(galaxy);
    const o = t.offers.find((x) => x.id === id);
    if (o === undefined || o.from !== empire.empireId || o.state !== 'pending') return { ok: false, message: 'No open offer of yours.', offer: o ?? null };
    o.state = 'withdrawn';
    o.answeredMs = galaxy.nowMs;
    return { ok: true, message: 'Offer withdrawn.', offer: o };
}

