// The buttons of a conversation dialog (messagePopups.ts) for an incoming diplomatic message. Pure: no DOM.
// Port of the option lists Main.Part9.cs:46 method_238 builds after the opening DialogPartType of a queued conversation
// (labels are the TextResolver keys it passes to ConversationOption), including the two lines it appends to every part
// outside the `break` list at Main.Part9.cs:629-659 ("Let's discuss something else..." = the full Diplomacy talk panel on
// the sender, "Goodbye" = Exit). Each button carries the effect the UI runs through issuePlayerCommand; the sim side is
// playerOrders.ts acceptProposal / declineProposal (the treaty offers, sender's pending proposal), playerOps.ts
// acceptPirateOfferProtection and answerConversation (player/conversationReplies.ts, Main.Part10.cs:3957 method_237).
//
// Every EmpireMessageType that opens a conversation (messageRouting.ts classifyEmpireMessage) and its buttons:
//   ProposeDiplomaticRelation (a pending proposal of the sender)   treaty labels below, Decline; peace also offers the
//                                                                   subjugation demand
//   ProposeDiplomaticRelation None at war, no valid proposal       WAR_END: end the war, demand subjugation, fight on
//                                                                   (an AI's SubjugateRequest)
//   PirateOfferProtection (protection / truce / extortion)         Accept, Open Diplomacy, Decline
//   SellInfo* (7 kinds)                                            buy (cost), No thanks
//   OfferTrade  list: DEAL_OFFER / DEAL_DEMAND / DEAL_THREAT       accept, reject (+ a different deal for DEAL_OFFER)
//               single item: OFFER_DEAL_TERRITORYMAP/GALAXYMAP/COMPONENT   We accept your proposal, No thanks
//   RequestHonorMutualDefense                                      honour (declares war), decline
//   RequestJointWar / RequestJointTradeSanctions / RequestStopWar / RequestLiftTradeSanctions   accept, reject
//   HistoryOfferLocationHint / HistoryOfferStoryClue / StoryMessage   Tell us more, We are not interested
//   RemoveForcesFromSystem                                         Go to <system>
//   GiveGift                                                       Thanks!
//   every other conversation (relation changes, warnings, CancelTreaty, CancelPirateProtection ...)  the default lines
// plus "Go to" whenever the message is about a place (messageGoto.ts).

import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import { GalaxyLocation } from '../sim/galaxyLocation';
import { Habitat } from '../sim/types';
import { EmpireMessageType, type EmpireMessage } from '../sim/messages';
import { DiplomaticRelationType } from '../sim/diplomacy';
import { TradeableItem } from '../sim/tradeItems';
import { formatNet, tryGetText } from '../sim/textResolver';
import { formatThousands } from '../sim/diplomacyTick';
import { attitudeGreeting, galaxyLocationKey, type ConversationRelated, type ConversationReplyPart, type ConversationReplyResult } from '../sim/player/conversationReplies';
import { messageGoToTarget } from './messageGoto';
import { pirateOfferMonthlyPrice, pirateProtectionPriceText, pirateProtectionYearlySuffix } from './pirateProtectionPrice';
import type { DialogPartType } from './messageRouting';
import type { DialogPartType as DialogPart } from '../sim/data/dialogSet';

export type ConversationEffect =
    /** playerOrders.ts acceptProposal (the sender's pending proposal). */
    | { kind: 'acceptProposal' }
    /** playerOrders.ts declineProposal. */
    | { kind: 'declineProposal' }
    /** diplomacyProposals.ts submitProposal WAR_END_SUBJUGATIONDEMAND (Main.Part9.cs:502). */
    | { kind: 'demandSubjugation' }
    /** playerOps.ts acceptPirateOfferProtection. */
    | { kind: 'acceptPirate' }
    /** playerOps.ts answerConversation. */
    | { kind: 'reply'; part: ConversationReplyPart; related: ConversationRelated; cost: number; expireSender?: boolean }
    /** The Diplomacy talk panel on the sender (Main.Part8.cs:449 method_296). */
    | { kind: 'openDiplomacy' }
    /** Main.Part10.cs:4980 GOTO_TARGET / the message link click. */
    | { kind: 'goto' }
    /** Exit / a rejection whose only effect is a text reply. */
    | { kind: 'close' };

export interface ConversationAction {
    /** The option's DialogPartType (or 'GOTO' for the added Go to button). */
    id: string;
    label: string;
    effect: ConversationEffect;
}

export interface ActionContext {
    player: Empire;
    galaxy: Galaxy | null;
    /** The sender's proposal is still on the player's list and valid (messagePopups.ts isAnswerableProposal). */
    answerable: boolean;
    /** The conversation is one of the three pirate protection offers with a sender (isPirateProtectionOfferEntry). */
    pirateOffer: boolean;
}

/** TextResolver.GetText(key) with string.Format args; the key itself when GameText is not loaded. */
function t(key: string, ...args: unknown[]): string {
    return formatNet(tryGetText(key) ?? key, args);
}

const act = (id: string, label: string, effect: ConversationEffect): ConversationAction => ({ id, label, effect });

// Main.Part9.cs:629-659: the parts that keep only their own options (no discuss / goodbye lines).
const NO_EXTRA_LINES: ReadonlySet<DialogPartType> = new Set<DialogPartType>([
    'INFO_OFFER_UNMETEMPIRE',
    'INFO_OFFER_INDEPENDENTCOLONY',
    'INFO_OFFER_SYSTEMMAPS',
    'INFO_OFFER_RUINS',
    'INFO_OFFER_RESTRICTEDAREA',
    'INFO_OFFER_DEBRISFIELD',
    'INFO_OFFER_PLANETDESTROYER',
    'PIRATE_PROTECTIONPROPOSEINITIATE',
    'OFFER_FREETRADE',
    'OFFER_PROTECTORATE',
    'OFFER_MUTUALDEFENSE',
    'DEAL_OFFER',
    'DEAL_DEMAND',
    'DEAL_THREAT',
    'MUTUALDEFENSE_REQUESTHELP',
    'TRADESANCTIONS_REQUESTLIFTOTHER',
    'TRADESANCTIONS_REQUESTIMPOSEJOINT',
    'WAR_DECLARE_REQUESTJOINT',
    'WAR_END',
    'WAR_END_SUBJUGATIONDEMAND',
    'WAR_END_REQUESTOTHER',
    'HISTORY_OFFER_LOCATIONHINT',
    'HISTORY_OFFER_STORYCLUE',
    'HISTORY_OFFER_STORYMESSAGE',
    'PIRATE_EXTORTPROTECTION',
    'PIRATE_TRUCEPROPOSEINITIATE',
]);

// method_238's INFO_OFFER_* → (INFO_ response, the option's GameText key). RelatedInfo: the message subject.
const INFO_OFFERS: Partial<Record<DialogPartType, [ConversationReplyPart, string]>> = {
    INFO_OFFER_UNMETEMPIRE: ['INFO_UNMETEMPIRE', 'Tell me about this empire'],
    INFO_OFFER_INDEPENDENTCOLONY: ['INFO_INDEPENDENTCOLONY', 'Where is this colony?'],
    INFO_OFFER_SYSTEMMAPS: ['INFO_EXPLORATION', 'Show me the system maps'],
    INFO_OFFER_RUINS: ['INFO_RUINS', 'What is this discovery?'],
    INFO_OFFER_RESTRICTEDAREA: ['INFO_RESTRICTEDAREA', 'What is this discovery?'],
    INFO_OFFER_DEBRISFIELD: ['INFO_DEBRISFIELD', 'What is this discovery?'],
    INFO_OFFER_PLANETDESTROYER: ['INFO_PLANETDESTROYER', 'What is this discovery?'],
};

/** A command-safe RelatedInfo: a GalaxyLocation travels as its [x, y] key (conversationReplies.ts galaxyLocationKey). */
function relatedOf(subject: unknown): ConversationRelated {
    if (subject instanceof GalaxyLocation) return galaxyLocationKey(subject);
    return (subject ?? null) as ConversationRelated;
}

// The pending proposal's own answers (method_238 OFFER_FREETRADE / OFFER_PROTECTORATE / OFFER_MUTUALDEFENSE /
// WAR_END / WAR_END_SUBJUGATIONDEMAND / SUBJUGATION_REQUESTRELEASE), from the proposed relation type.
function proposalActions(message: EmpireMessage, ctx: ActionContext): ConversationAction[] {
    const sender = message.sender;
    const proposed = sender === null ? null : ctx.player.proposedDiplomaticRelations.byEmpire(sender);
    const type = proposed?.type;
    const current = sender === null ? null : ctx.player.diplomaticRelations.byEmpire(sender);
    const yes = (id: string, label: string) => act(id, label, { kind: 'acceptProposal' });
    const no = (id: string, label: string) => act(id, label, { kind: 'declineProposal' });
    switch (type) {
        case DiplomaticRelationType.FreeTradeAgreement:
            return [yes('FREETRADE_ACCEPT', t('Yes, a Free Trade Agreement sounds like a great idea!')), no('FREETRADE_REJECT', t('Not at the moment, thanks'))];
        case DiplomaticRelationType.Protectorate:
            return [yes('PROTECTORATE_ACCEPT', t('Yes, we accept your offer of a Protectorate!')), no('PROTECTORATE_REJECT', t('Not at the moment, thanks'))];
        case DiplomaticRelationType.MutualDefensePact:
            return [yes('MUTUALDEFENSE_ACCEPT', t('Yes, we join you in a Mutual Defense Pact!')), no('MUTUALDEFENSE_REJECT', t('Not at the moment, thanks'))];
        case DiplomaticRelationType.SubjugatedDominion:
            return [
                yes('SUBJUGATIONDEMAND_ACCEPT', t('Yes, we accept defeat and acknowledge your status as our ruler')),
                no('SUBJUGATIONDEMAND_REJECT', t('No, we will not become your slaves!')),
            ];
        case DiplomaticRelationType.None:
        case DiplomaticRelationType.Truce:
            if (current?.type === DiplomaticRelationType.War) {
                return [
                    yes('WAR_END_ACCEPT', t('We agree - this war ends now')),
                    act('WAR_END_SUBJUGATIONDEMAND', t('We agree to end this war only if you agree to become our Subjugated Dominion'), { kind: 'demandSubjugation' }),
                    no('WAR_END_REJECT', t('No, we will fight on')),
                ];
            }
            if (current?.type === DiplomaticRelationType.SubjugatedDominion) {
                return [yes('SUBJUGATION_RELEASE', t('Alright, we set you free from subjugation')), no('SUBJUGATION_REFUSERELEASE', t('No, you must remain our slaves'))];
            }
            return [yes('ACCEPT', 'Accept Offer'), no('DECLINE', 'Decline')];
        default:
            return [yes('ACCEPT', 'Accept Offer'), no('DECLINE', 'Decline')];
    }
}

/** The monthly price of a pirate protection offer entry (see pirateOfferMonthlyPrice). */
export function pirateOfferCost(entry: { message: EmpireMessage; sender?: Empire | null }, ctx: Pick<ActionContext, 'player' | 'galaxy'>): number {
    return pirateOfferMonthlyPrice(ctx.galaxy, entry.sender ?? entry.message.sender, ctx.player, entry.message.money);
}

/** "Price: 1,234 credits per month (14,808 per year)" for the offer's dialog text; '' for a free truce. */
export function pirateOfferPriceLine(entry: { message: EmpireMessage; conversation: DialogPartType; sender?: Empire | null }, ctx: Pick<ActionContext, 'player' | 'galaxy'>): string {
    if (entry.conversation === 'PIRATE_TRUCEPROPOSEINITIATE') return '';
    const cost = pirateOfferCost(entry, ctx);
    return cost > 0 ? `Price: ${pirateProtectionPriceText(cost)}` : '';
}

function pirateActions(entry: { message: EmpireMessage; conversation: DialogPartType; sender?: Empire | null }, ctx: Pick<ActionContext, 'player' | 'galaxy'>): ConversationAction[] {
    // Main.Part9.cs:604-618: a free offer is a truce, a priced one a protection agreement.
    const cost = pirateOfferCost(entry, ctx);
    const truce = entry.conversation === 'PIRATE_TRUCEPROPOSEINITIATE' || cost <= 0;
    return [
        act(truce ? 'PIRATE_TRUCEACCEPTRESPONSE' : 'PIRATE_PROTECTIONACCEPTRESPONSE', truce ? t('We accept a truce') : t('We accept your protection', formatThousands(cost)) + pirateProtectionYearlySuffix(cost), {
            kind: 'acceptPirate',
        }),
        // Main.Part8.cs:449 method_296: the advisor-queue click opens the full Diplomacy talk panel on the pirate.
        act('OPEN_DIPLOMACY', 'Open Diplomacy', { kind: 'openDiplomacy' }),
        act(truce ? 'PIRATE_TRUCEREJECTRESPONSE' : 'PIRATE_PROTECTIONREJECTRESPONSE', t('No thanks'), { kind: 'close' }),
    ];
}

// Main.Part9.cs:293-330 (a list deal from the other empire) and 293-303 (a single map / tech offer).
function dealActions(entry: { message: EmpireMessage; conversation: DialogPartType }): ConversationAction[] {
    const subject = entry.message.subject;
    const related = relatedOf(subject);
    const reply = (part: ConversationReplyPart): ConversationEffect => ({ kind: 'reply', part, related, cost: 0 });
    switch (entry.conversation) {
        case 'DEAL_OFFER':
            return [
                act('DEAL_ACCEPT', t('We accept this proposal'), reply('DEAL_ACCEPT')),
                act('DEAL_REJECT', t('We reject this proposal'), reply('DEAL_REJECT')),
                act('DEAL_IMPROVE', t("Let's make a different deal..."), { kind: 'openDiplomacy' }),
            ];
        case 'DEAL_DEMAND':
            return [
                act('DEAL_ACCEPTCOMPLAIN', t('We accede to your outrageous demands'), reply('DEAL_ACCEPT')),
                act('DEAL_REJECTCOMPLAIN', t('This proposal is unfair'), reply('DEAL_REJECT')),
            ];
        case 'DEAL_THREAT':
            return [
                act('DEAL_ACCEPTCOMPLAIN', t('We accept your demands'), reply('DEAL_ACCEPT')),
                act('DEAL_REJECTCOMPLAIN', t('We reject your demands'), reply('DEAL_REJECT')),
            ];
        case 'OFFER_DEAL_TERRITORYMAP':
        case 'OFFER_DEAL_GALAXYMAP':
        case 'OFFER_DEAL_COMPONENT':
            if (!(subject instanceof TradeableItem)) return [];
            return [act('DEAL_ACCEPT', t('We accept your proposal'), reply('DEAL_ACCEPT')), act('Exit', t('No thanks'), { kind: 'close' })];
        default:
            return [];
    }
}

/** The buttons for a conversation entry, in the original's order. */
export function conversationActions(entry: { message: EmpireMessage; conversation: DialogPartType; sender: Empire | null }, ctx: ActionContext): ConversationAction[] {
    const { message, conversation, sender } = entry;
    const subject = message.subject;
    const out: ConversationAction[] = [];
    const empireRelated = subject !== null && typeof subject === 'object' && 'diplomaticRelations' in (subject as object) ? (subject as Empire) : null;

    if (message.messageType === EmpireMessageType.ProposeDiplomaticRelation && ctx.answerable && sender !== null) {
        out.push(...proposalActions(message, ctx));
    } else if (
        message.messageType === EmpireMessageType.ProposeDiplomaticRelation &&
        conversation === 'WAR_END' &&
        sender !== null &&
        subject === DiplomaticRelationType.None &&
        ctx.player.diplomaticRelations.byEmpire(sender)?.type === DiplomaticRelationType.War
    ) {
        // Main.Part9.cs:500 WAR_END without a pending end-of-war proposal (messagePipeline.ts isWarEndConversation: an
        // AI's SubjugateRequest, Empire.8.cs 1527): the answers act on the war itself (Main.Part10.cs:4798).
        out.push(
            act('WAR_END_ACCEPT', t('We agree - this war ends now'), { kind: 'reply', part: 'WAR_END_ACCEPT', related: null, cost: 0 }),
            act('WAR_END_SUBJUGATIONDEMAND', t('We agree to end this war only if you agree to become our Subjugated Dominion'), { kind: 'demandSubjugation' }),
            act('WAR_END_REJECT', t('No, we will fight on'), { kind: 'close' }),
        );
    } else if (ctx.pirateOffer) {
        out.push(...pirateActions(entry, ctx));
    } else if (INFO_OFFERS[conversation] !== undefined && sender !== null) {
        const [part, key] = INFO_OFFERS[conversation]!;
        out.push(act(part, t(key, formatThousands(message.money)), { kind: 'reply', part, related: relatedOf(subject), cost: message.money }), act('Exit', t('No thanks'), { kind: 'close' }));
    } else if (message.messageType === EmpireMessageType.OfferTrade && sender !== null) {
        out.push(...dealActions(entry));
    } else if (conversation === 'MUTUALDEFENSE_REQUESTHELP' && sender !== null) {
        // Main.Part9.cs:331-341: RelatedInfo is the message subject when it is an Empire.
        const ally = empireRelated ?? sender;
        out.push(
            act('MUTUALDEFENSE_HONORREQUESTHELP', t('We stand alongside our friends and allies', ally.name), { kind: 'reply', part: 'MUTUALDEFENSE_HONORREQUESTHELP', related: ally, cost: 0 }),
            act('MUTUALDEFENSE_DECLINEREQUESTHELP', t("Sorry, we can't help you right now..."), { kind: 'reply', part: 'MUTUALDEFENSE_DECLINEREQUESTHELP', related: null, cost: 0 }),
        );
    } else if (empireRelated !== null && sender !== null) {
        // Main.Part9.cs:476-519: only when RelatedInfo is an Empire.
        const name = empireRelated.name;
        const yes = (part: ConversationReplyPart, id: string, label: string) =>
            act(id, label, { kind: 'reply', part, related: empireRelated, cost: 0 });
        const no = (id: string, label: string) => act(id, label, { kind: 'close' });
        switch (conversation) {
            case 'TRADESANCTIONS_REQUESTLIFTOTHER':
                out.push(
                    yes('TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT', 'TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT', t('Lift Trade Sanctions against X', name)),
                    no('TRADESANCTIONS_REQUESTLIFTOTHER_REJECT', t('No, our Trade Sanctions will continue')),
                );
                break;
            case 'TRADESANCTIONS_REQUESTIMPOSEJOINT':
                out.push(
                    yes('TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT', 'TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT', t('Impose Trade Sanctions on X', name)),
                    no('TRADESANCTIONS_REQUESTIMPOSEJOINT_REJECT', t('No, we see no need for Trade Sanctions')),
                );
                break;
            case 'WAR_DECLARE_REQUESTJOINT':
                out.push(
                    yes('WAR_DECLARE_REQUESTJOINT_ACCEPT', 'WAR_DECLARE_REQUESTJOINT_ACCEPT', t('Ok, we declare war on the X', name)),
                    no('WAR_DECLARE_REQUESTJOINT_REJECT', t('Sorry, this is not our war')),
                );
                break;
            case 'WAR_END_REQUESTOTHER':
                out.push(
                    yes('WAR_END_REQUESTOTHER_ACCEPT', 'WAR_END_REQUESTOTHER_ACCEPT', t('Ok, we will end our war with the X', name)),
                    no('WAR_END_REQUESTOTHER_REJECT', t('No, we will continue our fight')),
                );
                break;
        }
    }
    // The history offers (Main.Part9.cs:572-583; the accept generates the text, the reject only exits).
    if (out.length === 0 && conversation.startsWith('HISTORY_OFFER_')) {
        const part: ConversationReplyPart | null =
            conversation === 'HISTORY_OFFER_STORYCLUE' ? 'HISTORY_OFFER_STORYCLUE_ACCEPT' : conversation === 'HISTORY_OFFER_STORYMESSAGE' ? 'HISTORY_OFFER_STORYMESSAGE_ACCEPT' : null;
        out.push(
            part !== null
                ? act(part, t('Tell us more'), { kind: 'reply', part, related: null, cost: 0 })
                : act('HISTORY_OFFER_LOCATIONHINT_ACCEPT', t('Tell us more'), { kind: 'close' }),
            act(`${conversation}_REJECT`, t('We are not interested'), { kind: 'close' }),
        );
    }
    if (out.length === 0 && conversation === 'GIFT_GIVE') out.push(act('GIFT_THANKS', t('Thanks!'), { kind: 'close' }));

    // "Go to": WARNING_REMOVEFORCESSYSTEM's GOTO_TARGET names the system (Main.Part9.cs:564-571); any other message about
    // a place gets a plain Go to.
    if (message.messageType === EmpireMessageType.RemoveForcesFromSystem && subject instanceof Habitat && ctx.galaxy !== null) {
        const star = ctx.galaxy.determineHabitatSystemStar(subject);
        out.push(act('GOTO_TARGET', t('Go to X system', (star ?? subject).name), { kind: 'goto' }));
    } else if (messageGoToTarget(message) !== null) {
        out.push(act('GOTO', 'Go to', { kind: 'goto' }));
    }

    if (!NO_EXTRA_LINES.has(conversation)) {
        if (sender !== null && sender !== ctx.player) out.push(act('GREETING_NEUTRAL', t("Let's discuss something else..."), { kind: 'openDiplomacy' }));
        out.push(act('Exit', t('Goodbye'), { kind: 'close' }));
    } else if (out.length === 0) {
        // An offer whose data is gone (an expired proposal): the panel still needs a way out.
        out.push(act('Exit', t('Goodbye'), { kind: 'close' }));
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The reply after a choice (Main.Part9.cs:731 method_241: method_237 → method_230 text → method_238 options)
// ---------------------------------------------------------------------------------------------------------------

/** The reply the talk panel shows after an answer: the DialogPart method_237 turned the option into (method_234)
 *  and method_230's string.Format arguments; `close` = the conversation ends there (method_294 / no reply). */
export type ConversationReplyView = { kind: 'reply'; part: DialogPart; args: string[] } | { kind: 'close' } | { kind: 'failed'; message: string };

const view = (part: DialogPart, args: string[] = []): ConversationReplyView => ({ kind: 'reply', part, args });
const CLOSE: ConversationReplyView = { kind: 'close' };

/** The answers whose effect is only a reply (kind 'close' in conversationActions) and the reply part method_237 gives
 *  them; anything else not listed here closes (Exit, WAR_END_REJECT, the history offers' rejects, Go to). */
function textOnlyReply(a: ConversationAction, entry: { message: EmpireMessage; sender: Empire | null }, player: Empire): ConversationReplyView {
    switch (a.id) {
        // Main.Part10.cs:4600-4680: the joint-action requests' refusals.
        case 'TRADESANCTIONS_REQUESTLIFTOTHER_REJECT':
        case 'TRADESANCTIONS_REQUESTIMPOSEJOINT_REJECT':
        case 'WAR_DECLARE_REQUESTJOINT_REJECT':
            return view('TREATY_REJECTRESPONSE');
        case 'WAR_END_REQUESTOTHER_REJECT': {
            // No method_237 case: the part's own text, "{0}" the other empire (method_230).
            const s = entry.message.subject;
            const name = s !== null && typeof s === 'object' && 'diplomaticRelations' in (s as object) ? (s as Empire).name : '';
            return view('WAR_END_REQUESTOTHER_REJECT', [name]);
        }
        case 'PIRATE_TRUCEREJECTRESPONSE':
        case 'PIRATE_PROTECTIONREJECTRESPONSE':
            return view(a.id);
        case 'GIFT_THANKS':
            // Main.Part10.cs GIFT_THANKS → method_236: the sender's greeting by its attitude to us.
            return entry.sender !== null ? view(attitudeGreeting(null, entry.sender, player)) : CLOSE;
        default:
            return CLOSE;
    }
}

/**
 * Port of Main.Part10.cs:3957 method_237's reply (method_234) for the conversation answers: `result` is the executor's
 * result for the action's command (undefined for a text-only answer). The treaty offers (acceptProposal /
 * declineProposal: EmpireDetailView's accept path here) reply as their method_237 cases do: FREETRADE_ /
 * PROTECTORATE_ / MUTUALDEFENSE_ACCEPT → TREATY_ACCEPTRESPONSE, SUBJUGATIONDEMAND_ACCEPT → ..._ACCEPT_RESPONSE,
 * WAR_END_ACCEPT → WAR_END_ACCEPT_RESPONSE, SUBJUGATION_RELEASE → SUBJUGATION_RELEASE_RESPONSE, the rejects →
 * TREATY_REJECTRESPONSE (WAR_END_REJECT closes, method_294).
 */
export function conversationReplyView(a: ConversationAction, entry: { message: EmpireMessage; sender: Empire | null }, player: Empire, result?: unknown): ConversationReplyView {
    const e = a.effect;
    switch (e.kind) {
        case 'acceptProposal': {
            if (result !== true) return { kind: 'failed', message: 'The offer is no longer available' };
            if (a.id === 'SUBJUGATIONDEMAND_ACCEPT') return view('SUBJUGATIONDEMAND_ACCEPT_RESPONSE');
            if (a.id === 'WAR_END_ACCEPT') return view('WAR_END_ACCEPT_RESPONSE');
            if (a.id === 'SUBJUGATION_RELEASE') return view('SUBJUGATION_RELEASE_RESPONSE');
            return view('TREATY_ACCEPTRESPONSE');
        }
        case 'declineProposal':
            return a.id === 'WAR_END_REJECT' ? CLOSE : view('TREATY_REJECTRESPONSE');
        case 'demandSubjugation': {
            const r = result as { ok: boolean; reply: DialogPart | null; replyArgs: string[]; message: string } | undefined;
            if (r === undefined || !r.ok) return { kind: 'failed', message: r?.message ?? '' };
            return r.reply !== null ? view(r.reply, r.replyArgs) : CLOSE;
        }
        case 'acceptPirate': {
            const r = result as { accepted: boolean; cost: number } | undefined;
            // cost < 0: the order never reached the game (sim worker: simworker/commandFailure.ts).
            if (r === undefined || r.cost < 0) return { kind: 'failed', message: 'The offer could not be answered (see the console)' };
            // Main.Part10.cs:5132: an arrangement already in force → PIRATE_PROTECTIONALREADYPAID; else the part's text.
            return view(r.accepted ? (a.id as DialogPart) : 'PIRATE_PROTECTIONALREADYPAID');
        }
        case 'reply': {
            const r = result as ConversationReplyResult | undefined;
            if (r === undefined) return { kind: 'failed', message: '' };
            if (!r.ok && !r.noFunds) return { kind: 'failed', message: 'The offer is no longer available' };
            if (r.reply === null) return CLOSE;
            // Main.Part10.cs:4497: DEAL_REJECTCOMPLAIN → DEAL_REJECTDEMAND_RESPONSE (the executor answers DEAL_REJECT).
            if (a.id === 'DEAL_REJECTCOMPLAIN' && r.reply === 'DEAL_REJECT_RESPONSE') return view('DEAL_REJECTDEMAND_RESPONSE');
            return view(r.reply, r.replyArgs);
        }
        case 'close':
            return textOnlyReply(a, entry, player);
        case 'openDiplomacy':
        case 'goto':
            return CLOSE;
    }
}
