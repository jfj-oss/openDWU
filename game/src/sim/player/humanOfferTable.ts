// The side table of human-to-human diplomacy offers (humanDiplomacy.ts; docs/MULTIPLAYER.md §18), on its own so the
// save (sim/save/galaxySave.ts) can read it without importing the diplomacy code. Plain JSON: empires by empireId, a
// trade's negotiation in the command-log codec.
//
// Headless (sim): no DOM.

import type { Galaxy } from '../galaxy';
import type { EncodedArg } from './commandCodec';
import type { TradeLabel, TradeNegotiationKind } from './tradeNegotiation';

export type HumanOfferState = 'pending' | 'accepted' | 'rejected' | 'countered' | 'expired' | 'withdrawn' | 'failed';
export type HumanOfferAnswer = 'accept' | 'reject' | 'counter';

export interface HumanOffer {
    id: number;
    /** Empire.empireId of the sender and the receiver. */
    from: number;
    to: number;
    kind: 'proposal' | 'trade';
    /** proposal: the ProposalOption id (e.g. 'OFFER_FREETRADE', 'GIFT_GIVE:small', 'WAR_END'); trade: 'trade'. */
    option: string;
    /** proposal: its label (gameText() encoding; resolveGameText for display). */
    label: string;
    /** proposal: ConversationOption.Cost (a gift's amount, fixed when it was offered). */
    cost: number;
    /** trade: the negotiation in the command-log codec (stable ids), and its items' labels (gameText() encoding):
     *  `receiverGives` = the sender's "them" list, `senderGives` = its "us" list. */
    trade: { kind: TradeNegotiationKind; encoded: EncodedArg; receiverGives: TradeLabel[]; senderGives: TradeLabel[] } | null;
    /** Galaxy time (nowMs) it was made and when it expires. */
    createdMs: number;
    expiresMs: number;
    state: HumanOfferState;
    answeredMs: number;
    /** Why it failed / was refused ('' otherwise). */
    note: string;
}


interface OfferTable {
    nextId: number;
    offers: HumanOffer[];
}

const tables = new WeakMap<Galaxy, OfferTable>();
let revision = 0;

/** Bumped on every change (the sim worker freshens the replica's copy: simworker/simHost.ts). */
export function humanOffersRevision(): number {
    return revision;
}

/** The galaxy's table (`create`: make it when missing; else null while no offer was ever made). A caller that may
 *  change it (`create`) counts as a change. */
export function offerTable(galaxy: Galaxy, create: boolean): OfferTable | null {
    let t = tables.get(galaxy);
    if (t === undefined && create) tables.set(galaxy, (t = { nextId: 1, offers: [] }));
    if (create) revision++;
    return t ?? null;
}

/** The replica sync's value: the live table, or null (none). */
export function liveHumanOffers(galaxy: Galaxy): OfferTable | null {
    return tables.get(galaxy) ?? null;
}

export interface SavedHumanOffers {
    nextId: number;
    offers: HumanOffer[];
}

/**
 * What the save writes: the table once an offer was ever made (its id counter too: a resync or join save must carry it),
 * or undefined (no key) — every game without offers saves the same text as before.
 */
export function savedHumanOffers(galaxy: Galaxy): SavedHumanOffers | undefined {
    const t = tables.get(galaxy);
    if (t === undefined || (t.offers.length === 0 && t.nextId <= 1)) return undefined;
    return { nextId: t.nextId, offers: t.offers.map((o) => structuredClone(o)) };
}

/** A loaded save's / synced table (undefined or null: none). */
export function restoreHumanOffers(galaxy: Galaxy, saved: SavedHumanOffers | null | undefined): void {
    revision++;
    if (saved == null || !Array.isArray(saved.offers)) {
        tables.delete(galaxy);
        return;
    }
    tables.set(galaxy, { nextId: Number.isInteger(saved.nextId) ? saved.nextId : 1, offers: saved.offers.map((o) => structuredClone(o)) });
}
