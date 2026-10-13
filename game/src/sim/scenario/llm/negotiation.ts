// P4 REAL DIPLOMATIC NEGOTIATION, sim side (flag llmNegotiation of the llm-layer scenario). Not a port.
//
// The player says in plain words what they offer and ask; the UI's treaty clerk (llm/negotiation.ts, the model) maps the
// words onto THIS menu of legal ids, the player confirms a card, and the click issues ONE journaled player command
// `llmNegotiate(other, package)` from the player's own empire. The package is plain data (item refs by stable keys,
// never list indices): every ref is re-resolved against the live tradeable lists when the command applies, and the
// whole package is atomic (one stale ref → nothing happens).
//
// Verdicts come only from ported code: the trade part goes through submitTradeOffer (EvaluateTradeOffer unchanged, its
// Rnd draws in C# order); a treaty alone through submitProposal (the stock path). With the flag on a formal treaty
// (free trade, mutual defence, protectorate; decision D5 option B) can also be ONE ITEM of a trade package, so money,
// colonies, tech and the rest can offset a cool attitude. The bounded, deterministic rule (treatyTerms):
//   - the treaty the AI would sign anyway (its stock acceptance test passes) costs nothing;
//   - else it is for sale only above an attitude floor (TREATY_ATTITUDE_FLOOR) and never from a reclusive empire or
//     the Concord's refused kinds; its price is the kind's base × (1 + (20 − attitude) / 20), capped at 3 × base;
//   - the price enters the ported evaluator as one synthetic requested item (type Undefined, no transfer), so the
//     package's offered value must cover the asked items and the treaty, with the AI's usual markup; on Accept the
//     items change hands and the treaty is signed through the stock acceptance branch (applyAcceptedProposal).
// To another HUMAN the package becomes the usual incoming offer (humanDiplomacy.ts) with the treaty and the plain words
// attached; that player decides (accept / reject / counter); nothing here answers for a human.
//
// Counter-offers are PURE (estimateTradeResponse re-implements the no-Rnd branches of evaluateTradeOffer and writes
// nothing), so the trade panel can show them without a model and the command can return them.
// State: bag 'llmNegotiation' (a capped log), written only by the command. Flag off → nothing registers, nothing runs.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { Habitat } from '../../types';
import { GalaxyLocation } from '../../galaxyLocation';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { aggressionLevel, friendlinessLevel } from '../../diplomacyTick';
import { TradeableItem, TradeableItemType, TradeOfferResponse, isTechNode, tradeableItemsTotalValue, valueMoney } from '../../tradeItems';
import { resolveGameText } from '../../textResolver';
import { galaxyStarDate } from '../../tick/simTime';
import { isHumanEmpire, isMultiHuman } from '../../humanEmpires';
import { scenarioFlag, scenarioState } from '../state';
import { isRimTraderAI } from '../rimTrade/common';
import { memoryLines, memoryOn } from './memory';
import { identifyEmpireCapitals } from '../../forceStructure';
import {
    addTradeItem,
    beginTradeNegotiation,
    submitTradeOffer,
    tradeItemLabel,
    tradeableItemIndexOf,
    type TradeNegotiation,
    type TradeOfferResult,
    type TradeTree,
} from '../../player/tradeNegotiation';
import { applyAcceptedProposal, desiredRelationType, listProposals, submitProposal, type ProposalResult } from '../../player/diplomacyProposals';
import { humanOffers } from '../../player/humanDiplomacy';
import type { DialogPartType } from '../../data/dialogSet';

export const LLM_NEGOTIATION_FLAG = 'llmNegotiation';
export const LLM_NEGOTIATION_STATE = 'llmNegotiation';

/** The treaties a package may carry (the formal DiplomaticRelationType proposals that need the other's consent). */
export const PACKAGE_TREATIES: readonly string[] = ['OFFER_FREETRADE', 'OFFER_MUTUALDEFENSE', 'OFFER_PROTECTORATE'];
const TREATY_BASE: Readonly<Record<string, number>> = { OFFER_FREETRADE: 4000, OFFER_MUTUALDEFENSE: 10000, OFFER_PROTECTORATE: 10000 };
/** Below this attitude the AI will not sell its signature at any price. */
export const TREATY_ATTITUDE_FLOOR = -20;
/** The price grows by base/20 per attitude point below this, up to 3 × base. */
const TREATY_ATTITUDE_PAR = 20;
const MAX_REFS = 12;
const MAX_WORDS = 400;
const LOG_CAP = 60;
const MENU_CAPS: Partial<Record<TradeableItemType, number>> = {
    [TradeableItemType.Colony]: 8,
    [TradeableItemType.Base]: 4,
    [TradeableItemType.ResearchProject]: 6,
    [TradeableItemType.SystemMap]: 3,
    [TradeableItemType.SecretLocation]: 3,
    [TradeableItemType.IndependentColonyLocation]: 3,
};
const MENU_DEFAULT_CAP = 4;

export function negotiationOn(galaxy: Galaxy | null | undefined): boolean {
    return galaxy != null && galaxy.scenario != null && galaxy.scenario.flags[LLM_NEGOTIATION_FLAG] === true;
}

// ---------------------------------------------------------------------------------------------------------------
// Plain-data packages
// ---------------------------------------------------------------------------------------------------------------

/** One trade item by stable key: `t` = TradeableItemType, `k` = itemKey (habitat index / builtObjectID / empire id /
 *  project id / location), `n` = the money amount (Money only). */
export interface ItemRef {
    t: number;
    k: string;
    n?: number;
}

export interface NegotiationPackage {
    /** What the proposer gives. */
    give: ItemRef[];
    /** What the proposer asks for. */
    ask: ItemRef[];
    /** One of PACKAGE_TREATIES, or null. */
    treaty: string | null;
    /** The proposer's own words (shown to a human receiver; never read by the sim). */
    words?: string;
}

/** The stable key of a TradeableItem's object (the same on every peer). */
export function itemKey(x: unknown): string {
    if (typeof x === 'number') return 'n';
    if (x instanceof Habitat) return `h${x.habitatIndex}`;
    if (isTechNode(x)) return `r${x.def.projectId}`;
    if (x instanceof GalaxyLocation) return `l${x.name}@${Math.round(x.xpos)},${Math.round(x.ypos)}`;
    if (x !== null && typeof x === 'object') {
        const o = x as { builtObjectID?: number; empireId?: number; governmentId?: number };
        if (typeof o.builtObjectID === 'number') return `b${o.builtObjectID}`;
        if (typeof o.empireId === 'number') return `e${o.empireId}`;
        if (typeof o.governmentId === 'number') return `g${o.governmentId}`;
    }
    return '';
}

export function refOf(item: TradeableItem): ItemRef {
    return item.type === TradeableItemType.Money ? { t: item.type, k: 'n', n: Math.trunc(Number(item.item) || 0) } : { t: item.type, k: itemKey(item.item) };
}

function sameRef(a: ItemRef, b: ItemRef): boolean {
    return a.t === b.t && a.k === b.k;
}

/** The money an empire may hand over in a package (an AI keeps max(20,000, 30%) back, as addTradeItem; a human all). */
export function moneyAvailable(galaxy: Galaxy, e: Empire): number {
    const keep = isHumanEmpire(galaxy, e) ? 0 : Math.max(20000, e.stateMoney * 0.3);
    return Math.max(0, Math.trunc(e.stateMoney - keep));
}

/** The package of a trade negotiation as it stands (the trade panel's counters). */
export function packageOfNegotiation(n: TradeNegotiation, treaty: string | null = null): NegotiationPackage {
    const own = (tree: TradeTree): ItemRef[] => tree.selected.filter((t) => !tree.required.includes(t)).map(refOf);
    const ask = own(n.them);
    if (n.kind === 'end-war') ask.unshift({ t: TradeableItemType.EndWar, k: itemKey(n.other) });
    if (n.kind === 'lift-sanctions') ask.unshift({ t: TradeableItemType.LiftTradeSanctions, k: itemKey(n.other) });
    return { give: own(n.us), ask, treaty };
}

/** A command argument from the wire → a clean package (bad shapes dropped, lengths capped). */
export function sanitizePackage(raw: unknown): NegotiationPackage | null {
    if (raw === null || typeof raw !== 'object') return null;
    const p = raw as Partial<NegotiationPackage>;
    const refs = (l: unknown): ItemRef[] | null => {
        if (!Array.isArray(l) || l.length > MAX_REFS) return null;
        const out: ItemRef[] = [];
        for (const r of l) {
            if (r === null || typeof r !== 'object') return null;
            const x = r as ItemRef;
            if (!Number.isInteger(x.t) || typeof x.k !== 'string') return null;
            out.push(x.t === TradeableItemType.Money ? { t: x.t, k: 'n', n: Math.max(0, Math.trunc(Number(x.n) || 0)) } : { t: x.t, k: x.k });
        }
        return out;
    };
    const give = refs(p.give);
    const ask = refs(p.ask);
    if (give === null || ask === null) return null;
    const treaty = typeof p.treaty === 'string' && PACKAGE_TREATIES.includes(p.treaty) ? p.treaty : null;
    const words = typeof p.words === 'string' ? p.words.slice(0, MAX_WORDS) : undefined;
    return words === undefined ? { give, ask, treaty } : { give, ask, treaty, words };
}

// ---------------------------------------------------------------------------------------------------------------
// Resolving a package on the live galaxy
// ---------------------------------------------------------------------------------------------------------------

export interface ResolvedPackage {
    negotiation: TradeNegotiation;
    treaty: string | null;
    /** Trade items on the table besides the required EndWar / LiftTradeSanctions. */
    hasItems: boolean;
}

function moneyItem(n: number): TradeableItem {
    return new TradeableItem(TradeableItemType.Money, n, valueMoney(n));
}

/** Every ref resolved against the live lists, or why not (the package is atomic). Builds no state. */
export function resolvePackage(galaxy: Galaxy, player: Empire, other: Empire, pkg: NegotiationPackage): ResolvedPackage | string {
    const endWar = pkg.ask.some((r) => r.t === TradeableItemType.EndWar);
    const lift = pkg.ask.some((r) => r.t === TradeableItemType.LiftTradeSanctions);
    if (endWar && lift) return 'Not possible together';
    const n = beginTradeNegotiation(galaxy, player, other, endWar ? 'end-war' : lift ? 'lift-sanctions' : 'trade');
    if (n === null) return 'No longer on offer';
    const add = (tree: TradeTree, refs: ItemRef[], giver: Empire): string | null => {
        let money = 0;
        for (const r of refs) {
            if (r.t === TradeableItemType.EndWar || r.t === TradeableItemType.LiftTradeSanctions) {
                if (tree !== n.them || r.k !== itemKey(other)) return 'No longer on offer';
                continue;
            }
            if (r.t === TradeableItemType.Money) {
                money += Math.max(0, Math.trunc(r.n ?? 0));
                continue;
            }
            const item = tree.tradeableItems.find((t) => t.type === r.t && itemKey(t.item) === r.k);
            if (item === undefined || tradeableItemIndexOf(tree.selected, item) >= 0 || !addTradeItem(galaxy, tree, item)) return 'No longer on offer';
        }
        if (money > 0) {
            if (money > moneyAvailable(galaxy, giver)) return 'Not enough money';
            tree.selected.push(moneyItem(money));
        }
        return null;
    };
    const why = add(n.us, pkg.give, player) ?? add(n.them, pkg.ask, other);
    if (why !== null) return why;
    let treaty: string | null = null;
    if (pkg.treaty !== null) {
        if (!PACKAGE_TREATIES.includes(pkg.treaty)) return 'No such treaty';
        const o = listProposals(galaxy, player, other).find((x) => x.id === pkg.treaty);
        if (o === undefined || !o.enabled) return 'That treaty is not on offer now';
        treaty = pkg.treaty;
    }
    const hasItems = n.us.selected.length + n.them.selected.length - n.us.required.length - n.them.required.length > 0;
    if (!hasItems && treaty === null && n.kind === 'trade') return 'Put something on the table first.';
    return { negotiation: n, treaty, hasItems };
}

// ---------------------------------------------------------------------------------------------------------------
// The treaty's price (pure)
// ---------------------------------------------------------------------------------------------------------------

export interface TreatyTerms {
    /** False: they will not sign it at any price now. */
    ok: boolean;
    /** The value the package must add for the signature (0: they would sign it anyway). */
    price: number;
    why: string;
}

/** Whether the AI `ai` would sign `treaty` with `player` by the stock test alone (evaluateProposal's cases). */
function signsAnyway(ai: Empire, player: Empire, treaty: string): boolean {
    const d = desiredRelationType(ai, player);
    if (treaty === 'OFFER_FREETRADE') return d === DiplomaticRelationType.FreeTradeAgreement || d === DiplomaticRelationType.MutualDefensePact || d === DiplomaticRelationType.Protectorate;
    if (treaty === 'OFFER_PROTECTORATE') return d === DiplomaticRelationType.Protectorate;
    return d === DiplomaticRelationType.MutualDefensePact;
}

/** The bounded deterministic rule for a treaty inside a package (see the file header). Pure. */
export function treatyTerms(galaxy: Galaxy, ai: Empire, player: Empire, treaty: string): TreatyTerms {
    if (isHumanEmpire(galaxy, ai)) return { ok: true, price: 0, why: '' };
    if (ai.reclusive) return { ok: false, price: 0, why: 'They keep to themselves and sign nothing.' };
    if (treaty !== 'OFFER_FREETRADE' && scenarioFlag(galaxy, 'rimTrader') && isRimTraderAI(galaxy, ai)) return { ok: false, price: 0, why: 'The Concord signs no defence treaties.' };
    if (signsAnyway(ai, player, treaty)) return { ok: true, price: 0, why: '' };
    const attitude = obtainEmpireEvaluation(galaxy, ai, player).overallAttitude;
    if (attitude < TREATY_ATTITUDE_FLOOR) return { ok: false, price: 0, why: 'They distrust you too much to sign at any price.' };
    const base = TREATY_BASE[treaty] ?? 10000;
    const factor = Math.min(3, 1 + Math.max(0, TREATY_ATTITUDE_PAR - attitude) / TREATY_ATTITUDE_PAR);
    return { ok: true, price: Math.trunc(base * factor), why: '' };
}

function treatyItem(treaty: string, price: number): TradeableItem {
    return new TradeableItem(TradeableItemType.Undefined, `treaty:${treaty}`, price);
}

// ---------------------------------------------------------------------------------------------------------------
// The pure estimate and the counter-offers
// ---------------------------------------------------------------------------------------------------------------

export type TradeEstimate = 'accept' | 'improve' | 'refuse' | 'insulted' | 'uncertain';

/**
 * A PURE re-implementation of the deterministic branches of evaluateTradeOffer (tradeItems.ts, Empire.7.cs:1779):
 * the markup num = requested × max(0.97, (100 + (aggr − friend)/2)/100), the end-war / lift-sanctions branch, the
 * critical-items gate, Accept when offered ≥ num, PromptForImprovement when offered ≥ requested, else refuse (insulted
 * for a lowball). Threats → uncertain (those branches draw Rnd). Writes nothing, draws nothing.
 */
export function estimateTradeResponse(galaxy: Galaxy, self: Empire, offeringEmpire: Empire, offered: readonly TradeableItem[], requested: readonly TradeableItem[]): TradeEstimate {
    if (offeringEmpire === self || self.reclusive) return 'refuse';
    if (isHumanEmpire(galaxy, self) && isMultiHuman(galaxy)) return 'uncertain';
    if (self.pirateEmpireBaseHabitat !== null || offeringEmpire.pirateEmpireBaseHabitat !== null) return 'uncertain';
    const rel = obtainDiplomaticRelation(self, offeringEmpire);
    const has = (l: readonly TradeableItem[], t: TradeableItemType): boolean => l.some((x) => x.type === t);
    const offeredTotal = tradeableItemsTotalValue(offered);
    const requestedTotal = tradeableItemsTotalValue(requested);
    const val = Math.max(0.97, (100 + Math.trunc((aggressionLevel(self) - friendlinessLevel(self)) / 2)) / 100.0);
    const num = Math.trunc(requestedTotal * val) | 0;
    const val2 = Math.min(10.0, Math.max(0.2, (requestedTotal + 1) / (offeredTotal + 1)));
    const capital = requested.some((t) => t.type === TradeableItemType.Colony && t.item === self.capital);
    const endOrLift = (keep: (t: DiplomaticRelationType) => boolean): TradeEstimate | null => {
        if (rel.locked) return 'refuse';
        // determineDesiredDiplomaticRelationTypical is read through desiredRelationType's first step.
        const desired = desiredRelationType(self, offeringEmpire);
        const gate = (r: TradeEstimate): TradeEstimate => (capital ? 'refuse' : r);
        if (!keep(desired) && offeredTotal >= requestedTotal) return gate('accept');
        if (has(offered, TradeableItemType.Colony) || has(offered, TradeableItemType.Base)) {
            if (offeredTotal >= requestedTotal || offeredTotal >= num) return gate('accept');
            return 'refuse';
        }
        return null;
    };
    if (rel.type === DiplomaticRelationType.War && has(offered, TradeableItemType.EndWar)) {
        const r = endOrLift((t) => t === DiplomaticRelationType.War);
        if (r !== null) return r;
    }
    if (rel.type === DiplomaticRelationType.TradeSanctions && has(offered, TradeableItemType.LiftTradeSanctions)) {
        const r = endOrLift((t) => t === DiplomaticRelationType.TradeSanctions || t === DiplomaticRelationType.War);
        if (r !== null) return r;
    }
    if (rel.type !== DiplomaticRelationType.War && has(offered, TradeableItemType.ThreatenWar)) return 'uncertain';
    if (rel.type !== DiplomaticRelationType.War && rel.type !== DiplomaticRelationType.TradeSanctions && has(offered, TradeableItemType.ThreatenTradeSanctions)) return 'uncertain';
    if (criticalItems(galaxy, self, requested)) return 'refuse';
    if (offeredTotal >= num) return 'accept';
    if (offeredTotal >= requestedTotal) return 'improve';
    if (offeredTotal > 0 && !(val2 < 0.5)) return 'refuse';
    return 'insulted';
}

/** tradeItems.ts checkForCriticalTradeItems without its writes: a capital, or a colony in a capital system. */
function criticalItems(galaxy: Galaxy, self: Empire, items: readonly TradeableItem[]): boolean {
    const capitals = identifyEmpireCapitals(self);
    const stars = capitals.map((c) => galaxy.determineHabitatSystemStar(c));
    for (const it of items) {
        if (it.type !== TradeableItemType.Colony) continue;
        const h = it.item as Habitat;
        if (h === self.capital || capitals.includes(h) || stars.includes(galaxy.determineHabitatSystemStar(h))) return true;
    }
    return false;
}

export interface PackageEstimate {
    estimate: TradeEstimate;
    /** The value the AI sees on each side (the treaty's price counted as asked). */
    offered: number;
    requested: number;
    /** The treaty's price, or -1 when it cannot be had now. */
    treatyPrice: number;
    why: string;
}

/** The pure estimate of a whole package (the confirmation card's "expected reception"). */
export function estimatePackage(galaxy: Galaxy, player: Empire, other: Empire, pkg: NegotiationPackage): PackageEstimate {
    const r = resolvePackage(galaxy, player, other, pkg);
    if (typeof r === 'string') return { estimate: 'refuse', offered: 0, requested: 0, treatyPrice: -1, why: r };
    return estimateResolved(galaxy, player, other, r);
}

function estimateResolved(galaxy: Galaxy, player: Empire, other: Empire, r: ResolvedPackage): PackageEstimate {
    const n = r.negotiation;
    const requested = [...n.them.selected];
    let treatyPrice = 0;
    if (r.treaty !== null) {
        const tt = treatyTerms(galaxy, other, player, r.treaty);
        if (!tt.ok) return { estimate: 'refuse', offered: tradeableItemsTotalValue(n.us.selected), requested: tradeableItemsTotalValue(requested), treatyPrice: -1, why: tt.why };
        treatyPrice = tt.price;
        if (!r.hasItems) {
            return { estimate: tt.price === 0 ? 'accept' : 'refuse', offered: 0, requested: tt.price, treatyPrice, why: tt.price === 0 ? '' : 'They want something for it.' };
        }
        if (tt.price > 0) requested.push(treatyItem(r.treaty, tt.price));
    }
    const estimate = estimateTradeResponse(galaxy, other, player, n.us.selected, requested);
    return { estimate, offered: tradeableItemsTotalValue(n.us.selected), requested: tradeableItemsTotalValue(requested), treatyPrice, why: '' };
}

/**
 * At most 3 packages the estimate says the AI accepts (the Accept branch, no Rnd), built from our side of the deal:
 *   1. the same deal plus the smallest money top-up;
 *   2. one of our maps / techs / locations in place of that money;
 *   3. the deal without their most valuable asked item.
 * Ordered by what we give (value), then by the order above. Pure.
 */
export function counterCandidates(galaxy: Galaxy, other: Empire, player: Empire, pkg: NegotiationPackage): NegotiationPackage[] {
    if (isHumanEmpire(galaxy, other)) return [];
    const r = resolvePackage(galaxy, player, other, pkg);
    if (typeof r === 'string') return [];
    const est = estimateResolved(galaxy, player, other, r);
    if (est.estimate === 'accept' || est.estimate === 'uncertain' || est.treatyPrice < 0) return [];
    const out: { pkg: NegotiationPackage; value: number; order: number }[] = [];
    const tryAdd = (p: NegotiationPackage, order: number): void => {
        const e = estimatePackage(galaxy, player, other, p);
        if (e.estimate === 'accept' && !out.some((x) => JSON.stringify(x.pkg) === JSON.stringify(p))) out.push({ pkg: p, value: e.offered, order });
    };
    const base: NegotiationPackage = { give: pkg.give.map((x) => ({ ...x })), ask: pkg.ask.map((x) => ({ ...x })), treaty: pkg.treaty };
    const markup = Math.max(0.97, (100 + Math.trunc((aggressionLevel(other) - friendlinessLevel(other)) / 2)) / 100.0);
    const need = Math.max(1, Math.trunc(est.requested * markup) + 1 - est.offered);
    // 1. money top-up (rounded up to a tidy 10).
    const givenMoney = pkg.give.filter((x) => x.t === TradeableItemType.Money).reduce((s, x) => s + (x.n ?? 0), 0);
    const topUp = Math.ceil(need / 10) * 10;
    if (givenMoney + topUp <= moneyAvailable(galaxy, player)) {
        tryAdd({ ...base, give: [...base.give.filter((x) => x.t !== TradeableItemType.Money), { t: TradeableItemType.Money, k: 'n', n: givenMoney + topUp }] }, 1);
    }
    // 2. the cheapest swap item of ours worth at least the gap (maps, techs, contacts, locations; never colonies or threats).
    const swapTypes = new Set<TradeableItemType>([
        TradeableItemType.TerritoryMap, TradeableItemType.GalaxyMap, TradeableItemType.ResearchProject, TradeableItemType.ContactEmpire,
        TradeableItemType.SystemMap, TradeableItemType.SecretLocation, TradeableItemType.IndependentColonyLocation,
    ]);
    const swaps = r.negotiation.us.tradeableItems
        .filter((t) => swapTypes.has(t.type) && t.value >= need && !pkg.give.some((g) => sameRef(g, refOf(t))))
        .sort((a, b) => a.value - b.value || itemKey(a.item).localeCompare(itemKey(b.item)));
    for (const s of swaps.slice(0, 4)) {
        const before = out.length;
        tryAdd({ ...base, give: [...base.give, refOf(s)] }, 2);
        if (out.length > before) break;
    }
    // 3. without their most valuable asked item (not the war / sanctions itself).
    const askable = r.negotiation.them.selected.filter((t) => !r.negotiation.them.required.includes(t));
    if (askable.length > 0) {
        const top = [...askable].sort((a, b) => b.value - a.value || itemKey(a.item).localeCompare(itemKey(b.item)))[0];
        const topRef = refOf(top);
        const ask = base.ask.filter((x) => !sameRef(x, topRef));
        const p = { ...base, ask };
        if (ask.length + p.give.length > 0 || p.treaty !== null) tryAdd(p, 3);
    }
    return out.sort((a, b) => a.value - b.value || a.order - b.order).slice(0, 3).map((x) => x.pkg);
}

// ---------------------------------------------------------------------------------------------------------------
// The menu (what the clerk may map words onto) and the model's answer
// ---------------------------------------------------------------------------------------------------------------

export interface MenuItem {
    id: string;
    ref: ItemRef;
    label: string;
    value: number;
}

export interface NegotiationMenu {
    playerId: number;
    otherId: number;
    playerName: string;
    otherName: string;
    give: MenuItem[];
    ask: MenuItem[];
    treaties: { id: string; optionId: string; label: string }[];
    ourMoney: number;
    theirMoney: number;
    /** One line: their attitude and, with the diary on, its newest lines. */
    standing: string;
    human: boolean;
}

function labelOf(galaxy: Galaxy, t: TradeableItem): string {
    return resolveGameText(tradeItemLabel(galaxy, t, false, true).text).slice(0, 60);
}

function capped(galaxy: Galaxy, from: Empire, list: readonly TradeableItem[]): TradeableItem[] {
    const cx = from.capital?.xpos ?? 0;
    const cy = from.capital?.ypos ?? 0;
    const byType = new Map<TradeableItemType, TradeableItem[]>();
    for (const t of list) {
        if (t.type === TradeableItemType.Money || t.type === TradeableItemType.Undefined || t.type === TradeableItemType.AdoptGovernmentStyle) continue;
        const l = byType.get(t.type) ?? [];
        l.push(t);
        byType.set(t.type, l);
    }
    const out: TradeableItem[] = [];
    for (const [type, l] of [...byType.entries()].sort((a, b) => a[0] - b[0])) {
        const sorted = type === TradeableItemType.Colony
            ? [...l].sort((a, b) => {
                const ha = a.item as Habitat;
                const hb = b.item as Habitat;
                return (ha.xpos - cx) ** 2 + (ha.ypos - cy) ** 2 - ((hb.xpos - cx) ** 2 + (hb.ypos - cy) ** 2) || ha.habitatIndex - hb.habitatIndex;
            })
            : [...l].sort((a, b) => b.value - a.value || itemKey(a.item).localeCompare(itemKey(b.item)));
        out.push(...sorted.slice(0, MENU_CAPS[type] ?? MENU_DEFAULT_CAP));
    }
    void galaxy;
    return out;
}

/** The legal menu for a negotiation between `player` and `other` (ids g1…, a1…, t1…). Pure. */
export function negotiationMenu(galaxy: Galaxy, player: Empire, other: Empire): NegotiationMenu {
    const human = isMultiHuman(galaxy) && isHumanEmpire(galaxy, other);
    const n = beginTradeNegotiation(galaxy, player, other, 'trade');
    const give: MenuItem[] = [];
    const ask: MenuItem[] = [];
    if (n !== null) {
        capped(galaxy, player, n.us.tradeableItems).forEach((t, i) => give.push({ id: `g${i + 1}`, ref: refOf(t), label: labelOf(galaxy, t), value: t.value }));
        capped(galaxy, other, n.them.tradeableItems).forEach((t, i) => ask.push({ id: `a${i + 1}`, ref: refOf(t), label: labelOf(galaxy, t), value: t.value }));
    }
    for (const kind of ['end-war', 'lift-sanctions'] as const) {
        const m = beginTradeNegotiation(galaxy, player, other, kind);
        if (m === null) continue;
        const req = m.them.required[0];
        if (req !== undefined) ask.push({ id: `a${ask.length + 1}`, ref: { t: req.type, k: itemKey(other) }, label: kind === 'end-war' ? 'End our war' : 'Lift their trade sanctions on us', value: req.value });
    }
    const options = listProposals(galaxy, player, other);
    const treaties = PACKAGE_TREATIES.filter((id) => options.some((o) => o.id === id && o.enabled)).map((id, i) => ({
        id: `t${i + 1}`,
        optionId: id,
        label: id === 'OFFER_FREETRADE' ? 'Free Trade Agreement' : id === 'OFFER_MUTUALDEFENSE' ? 'Mutual Defense Pact' : 'Protectorate',
    }));
    let standing = '';
    if (!human && other.pirateEmpireBaseHabitat === null) {
        const att = Math.round(obtainEmpireEvaluation(galaxy, other, player).overallAttitude);
        standing = `Their attitude to us: ${att}.`;
        if (memoryOn(galaxy)) {
            const m = memoryLines(galaxy, other, player, 3);
            if (m.lines.length > 0) standing += ` They remember (${m.mood}): ${m.lines.join(' ')}`;
        }
    }
    return {
        playerId: player.empireId,
        otherId: other.empireId,
        playerName: player.name,
        otherName: other.name,
        give,
        ask,
        treaties,
        ourMoney: moneyAvailable(galaxy, player),
        theirMoney: moneyAvailable(galaxy, other),
        standing,
        human,
    };
}

/** The clerk's response schema over the menu's ids (understood first: constrained output follows the property order). */
export function negotiationSchema(menu: NegotiationMenu): object {
    const ids = (l: readonly { id: string }[]): object => (l.length > 0 ? { type: 'array', items: { type: 'string', enum: l.map((x) => x.id) } } : { type: 'array', maxItems: 0, items: { type: 'string' } });
    return {
        type: 'object',
        additionalProperties: false,
        required: ['understood', 'give', 'ask', 'giveMoney', 'askMoney', 'treaty', 'unmapped', 'clarify'],
        properties: {
            understood: { type: 'string' },
            give: ids(menu.give),
            ask: ids(menu.ask),
            giveMoney: { type: 'integer', minimum: 0 },
            askMoney: { type: 'integer', minimum: 0 },
            treaty: { type: 'string', enum: ['none', ...menu.treaties.map((t) => t.id)] },
            unmapped: { type: 'string' },
            clarify: { type: 'string' },
        },
    };
}

/** The menu as prompt lines (short: small models). */
export function negotiationMenuText(menu: NegotiationMenu): { give: string; ask: string; treaties: string } {
    const lines = (l: readonly MenuItem[]): string => (l.length > 0 ? l.map((x) => `${x.id}: ${x.label} (value ${Math.round(x.value)})`).join('\n') : '(nothing)');
    return {
        give: lines(menu.give),
        ask: lines(menu.ask),
        treaties: menu.treaties.length > 0 ? menu.treaties.map((t) => `${t.id}: ${t.label}`).join('\n') : '(none)',
    };
}

export type NegotiationMapping =
    | { status: 'card'; pkg: NegotiationPackage; understood: string; give: string[]; ask: string[]; unmapped: string }
    | { status: 'clarify'; text: string }
    | { status: 'refused'; text: string };

/** Validate the model's answer against the menu: unknown id → refused, money clamped, duplicates dropped. Pure. */
export function mapNegotiationAnswer(menu: NegotiationMenu, raw: string, words = ''): NegotiationMapping {
    let a: Record<string, unknown>;
    try {
        const v = JSON.parse(raw) as unknown;
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        a = v as Record<string, unknown>;
    } catch {
        return { status: 'refused', text: 'The clerk could not follow; please rephrase.' };
    }
    const str = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string).trim().slice(0, 240) : '');
    const clarify = str('clarify');
    const pick = (k: string, l: readonly MenuItem[]): MenuItem[] | null => {
        const v = a[k];
        if (v === undefined) return [];
        if (!Array.isArray(v)) return null;
        const out: MenuItem[] = [];
        for (const id of v) {
            const m = l.find((x) => x.id === id);
            if (m === undefined) return null;
            if (!out.includes(m)) out.push(m);
        }
        return out.slice(0, MAX_REFS - 1);
    };
    const give = pick('give', menu.give);
    const ask = pick('ask', menu.ask);
    if (give === null || ask === null) return { status: 'refused', text: 'The clerk named something that is not on the table; please rephrase.' };
    const t = str('treaty');
    const treaty = t === '' || t === 'none' ? null : (menu.treaties.find((x) => x.id === t) ?? undefined);
    if (treaty === undefined) return { status: 'refused', text: 'The clerk named a treaty that is not on offer; please rephrase.' };
    const int = (k: string, max: number): number => Math.max(0, Math.min(max, Math.trunc(Number(a[k]) || 0)));
    const giveMoney = int('giveMoney', menu.ourMoney);
    const askMoney = int('askMoney', menu.theirMoney);
    if (give.length + ask.length === 0 && treaty === null && giveMoney + askMoney === 0) {
        return { status: 'clarify', text: clarify !== '' ? clarify : 'What do you wish to offer or ask?' };
    }
    if (clarify !== '' && give.length + ask.length === 0 && treaty === null) return { status: 'clarify', text: clarify };
    const pkg: NegotiationPackage = {
        give: [...give.map((x) => x.ref), ...(giveMoney > 0 ? [{ t: TradeableItemType.Money as number, k: 'n', n: giveMoney }] : [])],
        ask: [...ask.map((x) => x.ref), ...(askMoney > 0 ? [{ t: TradeableItemType.Money as number, k: 'n', n: askMoney }] : [])],
        treaty: treaty === null ? null : treaty.optionId,
    };
    if (words.trim() !== '') pkg.words = words.trim().slice(0, MAX_WORDS);
    const money = (n: number): string => `${n.toLocaleString('en-US')} credits`;
    return {
        status: 'card',
        pkg,
        understood: str('understood'),
        give: [...give.map((x) => x.label), ...(giveMoney > 0 ? [money(giveMoney)] : [])],
        ask: [...ask.map((x) => x.label), ...(askMoney > 0 ? [money(askMoney)] : []), ...(treaty !== null ? [treaty.label] : [])],
        unmapped: str('unmapped'),
    };
}

/** A package in plain words from the proposer's side (the counter cards; labels from the live lists). Pure. */
export function describePackage(galaxy: Galaxy, player: Empire, other: Empire, pkg: NegotiationPackage): { give: string[]; ask: string[] } {
    const r = resolvePackage(galaxy, player, other, pkg);
    if (typeof r === 'string') return { give: [], ask: [] };
    const l = (tree: TradeTree): string[] => tree.selected.map((t) => (t.type === TradeableItemType.Money ? `${Math.trunc(Number(t.item)).toLocaleString('en-US')} credits` : labelOf(galaxy, t)));
    const treaty = r.treaty === null ? [] : [r.treaty === 'OFFER_FREETRADE' ? 'Free Trade Agreement' : r.treaty === 'OFFER_MUTUALDEFENSE' ? 'Mutual Defense Pact' : 'Protectorate'];
    const ask = l(r.negotiation.them);
    if (r.negotiation.kind === 'end-war') ask[0] = 'End our war';
    if (r.negotiation.kind === 'lift-sanctions') ask[0] = 'Lift their trade sanctions on us';
    return { give: l(r.negotiation.us), ask: [...ask, ...treaty] };
}

// ---------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------

export type NegotiationVerdict = 'accepted' | 'improve' | 'refused' | 'insulted' | 'offered' | 'stale' | 'off';

export interface NegotiationResult {
    ok: boolean;
    verdict: NegotiationVerdict;
    message: string;
    /** The dialog line of the reply (DEAL_ACCEPT, DEAL_IMPROVE, FREETRADE_ACCEPT, …), or null. */
    reply: DialogPartType | null;
    treaty: string | null;
    /** Pure counter-offers after a refusal (≤ 3). */
    counters: NegotiationPackage[];
    expireMessagesFor: Empire | null;
}

interface LogRow {
    d: number;
    from: number;
    to: number;
    verdict: NegotiationVerdict;
    give: number;
    ask: number;
    treaty: string | null;
}

interface NegotiationState {
    log: LogRow[];
}

export function negotiationLog(galaxy: Galaxy): readonly LogRow[] {
    const s = galaxy.scenario;
    if (s == null || !(LLM_NEGOTIATION_STATE in s.state)) return [];
    return (s.state[LLM_NEGOTIATION_STATE] as NegotiationState).log;
}

function logRow(galaxy: Galaxy, row: LogRow): void {
    const st = scenarioState<NegotiationState>(galaxy, LLM_NEGOTIATION_STATE, () => ({ log: [] }));
    st.log.push(row);
    if (st.log.length > LOG_CAP) st.log.splice(0, st.log.length - LOG_CAP);
}

function verdictOfTrade(r: TradeOfferResult): NegotiationVerdict {
    if (r.accepted) return 'accepted';
    if (r.response === TradeOfferResponse.PromptForImprovement) return 'improve';
    if (r.response === TradeOfferResponse.RefuseUnfair) return 'insulted';
    return 'refused';
}

const fail = (verdict: NegotiationVerdict, message: string): NegotiationResult => ({ ok: false, verdict, message, reply: null, treaty: null, counters: [], expireMessagesFor: null });

/** Attach the treaty and the words to the offer a human-bound call just made (the newest pending offer between them). */
function annotateHumanOffer(galaxy: Galaxy, player: Empire, other: Empire, treaty: string | null, words: string | undefined): void {
    const list = humanOffers(galaxy);
    const o = list[list.length - 1];
    if (o === undefined || o.from !== player.empireId || o.to !== other.empireId || o.state !== 'pending') return;
    if (treaty !== null && o.kind === 'trade') o.treaty = treaty;
    if (words !== undefined && words !== '') o.words = words;
}

/**
 * The journaled command `llmNegotiate` (player/playerOps.ts), issued for the player's OWN empire. Re-checks everything
 * on the live galaxy and runs the ported trade / treaty code (see the file header).
 */
export function applyNegotiation(galaxy: Galaxy, player: Empire, other: Empire, raw: unknown): NegotiationResult {
    if (!negotiationOn(galaxy)) return fail('off', 'Negotiation is off.');
    const pkg = sanitizePackage(raw);
    if (pkg === null) return fail('stale', 'Not a proposal.');
    if (other === player || !other.active || other === galaxy.independentEmpire || other.pirateEmpireBaseHabitat !== null || player.pirateEmpireBaseHabitat !== null) {
        return fail('stale', 'They will not hear you.');
    }
    const rel = obtainDiplomaticRelation(player, other);
    if (rel.type === DiplomaticRelationType.NotMet) return fail('stale', 'You have not met them.');
    const r = resolvePackage(galaxy, player, other, pkg);
    if (typeof r === 'string') return fail('stale', r);
    const human = isMultiHuman(galaxy) && isHumanEmpire(galaxy, other);
    const out: NegotiationResult = { ok: true, verdict: 'refused', message: '', reply: null, treaty: r.treaty, counters: [], expireMessagesFor: null };
    const give = tradeableItemsTotalValue(r.negotiation.us.selected);
    const ask = tradeableItemsTotalValue(r.negotiation.them.selected);
    if (!r.hasItems && r.treaty !== null && r.negotiation.kind === 'trade') {
        // A treaty alone: exactly the stock proposal.
        const p: ProposalResult = submitProposal(galaxy, player, other, r.treaty);
        if (!p.ok) return fail('stale', p.message);
        out.verdict = p.offer !== undefined ? 'offered' : p.accepted ? 'accepted' : 'refused';
        out.reply = p.reply;
        out.message = p.offer !== undefined ? p.message : (p.reply ?? p.message);
        out.expireMessagesFor = p.expireMessagesFor;
        if (p.offer !== undefined) annotateHumanOffer(galaxy, player, other, null, pkg.words);
    } else {
        if (r.treaty !== null && !human) {
            const tt = treatyTerms(galaxy, other, player, r.treaty);
            if (!tt.ok) {
                out.verdict = 'refused';
                out.message = tt.why;
                logRow(galaxy, { d: galaxyStarDate(galaxy), from: player.empireId, to: other.empireId, verdict: out.verdict, give, ask, treaty: r.treaty });
                return out;
            }
            if (tt.price > 0) {
                const item = treatyItem(r.treaty, tt.price);
                r.negotiation.them.required.push(item);
                r.negotiation.them.selected.push(item);
            }
        }
        const t = submitTradeOffer(galaxy, r.negotiation);
        if (!t.ok) return fail('stale', t.message);
        out.expireMessagesFor = t.expireMessagesFor;
        out.reply = t.reply;
        out.message = t.message;
        if (human) {
            out.verdict = 'offered';
            annotateHumanOffer(galaxy, player, other, r.treaty, pkg.words);
        } else {
            out.verdict = verdictOfTrade(t);
            if (t.accepted && r.treaty !== null) {
                // The treaty: the stock acceptance branch (re-checked on the state the trade just left).
                const a = applyAcceptedProposal(galaxy, player, other, r.treaty, 0);
                if (!a.ok) out.message = `${out.message} (the treaty could not be signed: ${a.message})`;
            }
        }
    }
    if (out.verdict === 'improve' || out.verdict === 'refused' || out.verdict === 'insulted') out.counters = counterCandidates(galaxy, other, player, pkg);
    logRow(galaxy, { d: galaxyStarDate(galaxy), from: player.empireId, to: other.empireId, verdict: out.verdict, give, ask, treaty: r.treaty });
    return out;
}
