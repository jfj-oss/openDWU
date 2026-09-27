// Task 17e: the player's outgoing diplomacy — the Diplomacy screen's conversation with another empire.
//
// In the original the player picks "Speak with <empire>" (Main.Part11.cs:4963 btnEmpireTalk_Click → Main.Part8.cs:438
// method_295) and then clicks conversation options in a HyperlinkOptionsBox:
// - Main.Part9.cs:46 method_238 builds the options offered after each line of the conversation (the greeting menu:
//   Change relationship / Send a gift / Send a warning / trade negotiation; the TREATY_PROPOSAL, GIFT_PROPOSE and
//   WARNING sub-menus; the follow-up choices after a counter-proposal);
// - Main.Part10.cs:3957 method_237 evaluates the chosen option (the other empire's accept / reject and the state change)
//   and returns the reply, whose text Main.Part10.cs:3590 method_230 shows from the dialog files (data/dialogSet.ts).
// This module ports those two for the non-pirate conversation. The screen (ui/screens/diplomacyScreen.ts) only calls
// listProposals / submitProposal.
//
// Flattening: the original shows a menu, then its sub-menu. listProposals returns the sub-menu entries (the options that
// act) with `menu` naming the greeting-menu entry they sit under; a greeting-menu entry the C# does not offer in the
// current state is returned once as a disabled option with a hint naming the C# gate.
//
// Determinism: runs only from player input. galaxy.rnd draws, all in the C# order: SUBJUGATION_REQUESTRELEASE draws
// Rnd.Next(0, 80) (Main.Part10.cs:4878, only when the other empire's desired relation is None); WAR_END draws the two
// NextDouble of DetermineWhetherWantToOfferSubjugation when the other empire is winning; declaring war and treaty
// changes draw whatever ChangeDiplomaticRelation / DeclareWar draw (mutual-defense flow-on, character events).
//
// Trade negotiation (task 17e2, player/tradeNegotiation.ts): OFFER_DEAL answers OFFER_DEAL_RESPONSE with the quick
// map / tech offers as follow-ups (OFFER_DEAL_TERRITORYMAP / _GALAXYMAP / _COMPONENT:<id>); DEAL_BEGIN returns the
// negotiation (ProposalResult.trade) the screen's trade panel works on.
// Pirate player (Main.Part9.cs:175-190): propose / cancel pirate protection (PIRATE_PROTECTIONPROPOSE_OFFER,
// CANCELPIRATEPROTECTION; Main.Part10.cs:5088-5131) and the trade negotiation.
// TODO(port): a non-pirate player speaking with a pirate faction (Main.Part9.cs:191-206: PIRATE_TRUCEPROPOSE /
//   PIRATE_PROTECTIONPROPOSE, CANCELPIRATEPROTECTION, PIRATE_BUYINFO and their Main.Part9.cs:584-667 follow-ups) —
//   no options are offered there yet.
// TODO(port): the automation message box "Treaty Negotiation" (Main.Part10.cs:4150 GenerateAutomationMessageBox) is not
//   shown; the caller answers it with `SubmitProposalOptions.disableTreatyAutomation`.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { AutomationLevel } from '../empire';
import { Habitat } from '../types';
import type { BuiltObject } from '../builtObject';
import {
    DiplomaticRelationType,
    LONG_MAX_VALUE,
    obtainDiplomaticRelation,
    obtainEmpireEvaluation,
    type DiplomaticRelation,
} from '../diplomacy';
import {
    MANUAL,
    aggressionLevel,
    cancelBlockades,
    changeDiplomaticRelation,
    considerEndWar,
    declareWar,
    determineDesiredDiplomaticRelationTypical,
    determineEmpireDominatedSystems,
    determineSubjugationOfLoserInWar,
    determineVictorInWar,
    determineWhetherWantToOfferSubjugation,
    formatThousands,
    militaryPotency,
    processEndOfWarWithEmpire,
    removeMilitaryForcesFromSystem,
    resetAttitudeLevelsAtEndOfWar,
    setCivilityRating,
    valueMoneyGiftFromEmpire,
} from '../diplomacyTick';
import { gameText } from '../colonyTick';
import { tryGetText } from '../textResolver';
import { splitString } from '../data/gameText';
import type { DialogPartType } from '../data/dialogSet';
import { galaxyStarDate } from '../tick/simTime';
import { PirateExpenseType, PirateIncomeType } from '../pirates/pirateEconomy';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { beginTradeNegotiation, offerDealOptions, submitOfferDeal, type TradeNegotiation, type TradeNegotiationKind } from './tradeNegotiation';
import { PirateRelationEvaluationType, PirateRelationType, changePirateEvaluation, changePirateRelation, obtainPirateRelation } from '../pirateRelations';
import { acceptPirateProtection, calculatePirateProtectionPricePerMonth } from '../pirates/pirateRelationsAI';
import { determineDesirePirateProtection } from '../pirates/pirateAI';
import { price0 } from '../pirates/missionsMarket';
import { scenarioFlag } from '../scenario/state';
import { scenarioText } from '../scenario/messages';
import { isRimTraderAI } from '../scenario/rimTrade/common';
import { scenarioEmit, scenarioQuery } from '../scenario/hooks';

/** The greeting-menu entry (Main.Part9.cs:208-249) an option sits under. FOLLOW_UP: a reply's own options. GREETING: a
 *  greeting-menu entry that acts itself (the pirate player's protection entries, Main.Part9.cs:175-189). */
export type ProposalMenu = 'TREATY_PROPOSAL' | 'GIFT_PROPOSE' | 'WARNING' | 'DEAL_BEGIN' | 'OFFER_DEAL' | 'GREETING' | 'FOLLOW_UP';

export interface ProposalOption {
    /** Stable id: the DialogPartType, plus `:small` / `:medium` / `:large` for gifts and `:end-war` / `:lift-sanctions`
     *  / `:trade` for the trade negotiation entries. */
    id: string;
    /** ConversationOption.Type. */
    part: DialogPartType;
    menu: ProposalMenu;
    /** The greeting-menu entry's text (GameText key, gameText() encoding; resolveGameText for display). */
    menuLabel: string;
    /** ConversationOption.Text (GameText key + string.Format args, gameText() encoding). */
    label: string;
    /** ConversationOption.Cost (the gift amount). */
    cost: number;
    /** ConversationOption.RelatedInfo when it is an empire or a habitat. */
    related: Empire | Habitat | null;
    enabled: boolean;
    /** Why a disabled entry is not offered ('' when enabled). */
    hint: string;
}

export interface SubmitProposalOptions {
    /** The answer to the "Treaty Negotiation" automation message box: true = "off" (ControlDiplomacyTreaties → Manual). */
    disableTreatyAutomation?: boolean;
}

export interface ProposalResult {
    /** False when the option is not (or no longer) on offer. */
    ok: boolean;
    /** The other empire agreed, or the player's unilateral action took effect. */
    accepted: boolean;
    /** The reply the conversation shows: the DialogPartType key into dialog/*.txt (resolve with DialogSet.resolveDialog
     *  and string.Format(replyArgs)); for a refused submit, the hint. */
    message: string;
    reply: DialogPartType | null;
    /** string.Format arguments of the reply text (method_230). */
    replyArgs: string[];
    /** The options the conversation offers next that act on the reply (e.g. accept / refuse a counter-demand). */
    followUps: ProposalOption[];
    /** DiplomaticMessageQueue.ExpireDiplomacyMessagesForEmpire(empire) target: the UI's conversation queue drops that
     *  empire's pending diplomacy messages. */
    expireMessagesFor: Empire | null;
    /** The C# would have shown the "Treaty Negotiation" automation message box. */
    automationPrompt: boolean;
    /** DEAL_BEGIN: the trade negotiation to show (Main.Part10.cs:4324 method_302); null otherwise. */
    trade: TradeNegotiation | null;
}

const MENU_LABEL: Record<Exclude<ProposalMenu, 'FOLLOW_UP' | 'GREETING'>, string> = {
    TREATY_PROPOSAL: 'Change relationship',
    GIFT_PROPOSE: 'Send a gift',
    WARNING: 'Send a warning',
    DEAL_BEGIN: 'Negotiate a trade proposal...',
    OFFER_DEAL: 'Swap maps or tech',
};

/** Galaxy.2.cs:2488 ResolveDescription(DiplomaticRelationType): GameText "DiplomaticRelationType <name>", else SplitString. */
function relationTypeDescription(type: DiplomaticRelationType): string {
    const name = DiplomaticRelationType[type] ?? String(type);
    return tryGetText(`DiplomaticRelationType ${name}`) ?? splitString(name);
}

function option(
    id: string,
    part: DialogPartType,
    menu: ProposalMenu,
    label: string,
    related: Empire | Habitat | null = null,
    cost = 0.0,
    enabled = true,
    hint = '',
): ProposalOption {
    const menuLabel = menu === 'FOLLOW_UP' ? '' : menu === 'GREETING' ? label : MENU_LABEL[menu];
    return { id, part, menu, menuLabel, label, cost, related, enabled, hint };
}

/** Conversation available at all: a met, active empire other than the player (DiplomaticRelationListView.cs:164-176
 *  lists the empires met by diplomatic or pirate relation, and Speak needs a selected empire, Main.Part6.cs:2766). */
function canSpeak(galaxy: Galaxy, player: Empire, other: Empire): boolean {
    if (other === player || !other.active) return false;
    if (other === galaxy.independentEmpire) return false;
    const rel = player.diplomaticRelations.byEmpire(other);
    const met = rel !== null && rel.type !== DiplomaticRelationType.NotMet;
    if (player.pirateEmpireBaseHabitat !== null) {
        // Main.Part9.cs:175 pirate player branch (any other empire).
        const pirateRelation = player.pirateRelations.getRelationByOtherEmpire(other);
        return met || (pirateRelation !== null && pirateRelation.type !== PirateRelationType.NotMet);
    }
    // TODO(port): a non-pirate player speaking with a pirate faction (Main.Part9.cs:191-206).
    if (other.pirateEmpireBaseHabitat !== null) return false;
    return met;
}

/**
 * Main.Part9.cs:175-190 (GREETING_* case, `_Game.PlayerEmpire.PirateEmpireBaseHabitat != null`): a pirate player
 * proposes protection (a pirate other: the truce "Propose Pirate Protection Pirates", cost 0; else priced
 * CalculatePirateProtectionPricePerMonth, "0"-formatted) or cancels it, and may negotiate a trade.
 */
function piratePlayerOptions(galaxy: Galaxy, player: Empire, other: Empire): ProposalOption[] {
    const list: ProposalOption[] = [];
    // Main.Part9.cs:64-67: method_238 obtains the diplomatic relation when the other empire is not a pirate.
    if (other.pirateEmpireBaseHabitat === null) obtainDiplomaticRelation(player, other);
    const pirateRelation = obtainPirateRelation(player, other);
    if (pirateRelation.type === PirateRelationType.None) {
        if (other.pirateEmpireBaseHabitat !== null) {
            list.push(option('PIRATE_PROTECTIONPROPOSE_OFFER', 'PIRATE_PROTECTIONPROPOSE_OFFER', 'GREETING', 'Propose Pirate Protection Pirates', null, 0.0));
        } else {
            const cost2 = calculatePirateProtectionPricePerMonth(galaxy, player, other).price;
            list.push(option('PIRATE_PROTECTIONPROPOSE_OFFER', 'PIRATE_PROTECTIONPROPOSE_OFFER', 'GREETING', gameText('Propose Pirate Protection', price0(cost2)), null, cost2));
        }
    } else {
        list.push(option('CANCELPIRATEPROTECTION', 'CANCELPIRATEPROTECTION', 'GREETING', 'Cancel Pirate Protection Option'));
    }
    list.push(option('DEAL_BEGIN:trade', 'DEAL_BEGIN', 'DEAL_BEGIN', 'Negotiate a trade proposal...'));
    return list;
}

/**
 * Port of Main.Part9.cs:46 method_238 for the greeting menu (GREETING_* case, non-pirate branch, :208-249) and its
 * TREATY_PROPOSAL (:339-455), GIFT_PROPOSE (:522-540) and WARNING (:541-558) sub-menus; a pirate player gets the
 * :175-190 branch (piratePlayerOptions). Empty when the player cannot speak with `other` (not met, inactive, or a pirate
 * faction spoken to by a non-pirate player — TODO(port) above).
 */
export function listProposals(galaxy: Galaxy, player: Empire, other: Empire): ProposalOption[] {
    const list: ProposalOption[] = [];
    if (!canSpeak(galaxy, player, other)) return list;
    if (player.pirateEmpireBaseHabitat !== null) return piratePlayerOptions(galaxy, player, other);
    const diplomaticRelation = obtainDiplomaticRelation(player, other);

    // TREATY_PROPOSAL (Main.Part9.cs:339).
    list.push(...treatyProposalOptions(galaxy, player, other, diplomaticRelation));

    // Main.Part9.cs:211 "Send a gift" only when StateMoney >= 1000; GIFT_PROPOSE (:522).
    if (player.stateMoney >= 1000.0) {
        const num = player.stateMoney / 8.0;
        const num2 = num / 2.0;
        const num3 = num / 4.0;
        if (num3 > 0.0) list.push(option('GIFT_GIVE:small', 'GIFT_GIVE', 'GIFT_PROPOSE', gameText('Send small gift', formatThousands(num3)), null, num3));
        if (num2 > 0.0) list.push(option('GIFT_GIVE:medium', 'GIFT_GIVE', 'GIFT_PROPOSE', gameText('Send medium gift', formatThousands(num2)), null, num2));
        if (num > 0.0) list.push(option('GIFT_GIVE:large', 'GIFT_GIVE', 'GIFT_PROPOSE', gameText('Send large gift', formatThousands(num)), null, num));
    } else {
        list.push(option('GIFT_PROPOSE', 'GIFT_PROPOSE', 'GIFT_PROPOSE', 'Send a gift', null, 0.0, false, 'Requires 1,000 credits'));
    }

    // Main.Part9.cs:215 "Send a warning" unless at war; WARNING (:541).
    if (diplomaticRelation.type !== DiplomaticRelationType.War) {
        list.push(option('WARNING_INTELLIGENCEMISSIONS', 'WARNING_INTELLIGENCEMISSIONS', 'WARNING', 'End your treacherous covert missions against us'));
        list.push(option('WARNING_ATTACKS', 'WARNING_ATTACKS', 'WARNING', 'Stop your military attacks against us'));
        const diplomaticRelation2 = obtainDiplomaticRelation(player, other);
        if (!diplomaticRelation2.militaryRefuelingToOther) {
            const habitatList = determineEmpireSystemsWithOtherMilitaryForcesPresent(galaxy, player, other);
            const relatedInfo2 = habitatList.length > 0 ? habitatList[0] : null;
            list.push(option('WARNING_REMOVEFORCESSYSTEM', 'WARNING_REMOVEFORCESSYSTEM', 'WARNING', 'Remove your military forces from our territory', relatedInfo2));
        }
    } else {
        list.push(option('WARNING', 'WARNING', 'WARNING', 'Send a warning', null, 0.0, false, 'Not offered while at war'));
    }

    // Main.Part9.cs:225-257: trade negotiation (player/tradeNegotiation.ts).
    if (diplomaticRelation.type === DiplomaticRelationType.War && !diplomaticRelation.locked) {
        list.push(option('DEAL_BEGIN:end-war', 'DEAL_BEGIN', 'DEAL_BEGIN', 'Negotiate an end to this war...'));
    } else if (diplomaticRelation.type === DiplomaticRelationType.TradeSanctions && !diplomaticRelation.locked) {
        list.push(option('DEAL_BEGIN:lift-sanctions', 'DEAL_BEGIN', 'DEAL_BEGIN', 'Negotiate lifting trade sanctions...'));
    } else if (!other.reclusive) {
        list.push(option('OFFER_DEAL', 'OFFER_DEAL', 'OFFER_DEAL', 'Swap maps or tech'));
        list.push(option('DEAL_BEGIN:trade', 'DEAL_BEGIN', 'DEAL_BEGIN', 'Negotiate a trade proposal...'));
    }
    return list;
}

/** Main.Part9.cs:339-455 case TREATY_PROPOSAL: the relation options for the current relation type. */
function treatyProposalOptions(galaxy: Galaxy, player: Empire, empire: Empire, diplomaticRelation: DiplomaticRelation): ProposalOption[] {
    const list: ProposalOption[] = [];
    const M: ProposalMenu = 'TREATY_PROPOSAL';
    const num7 = militaryPotency(player) / militaryPotency(empire);
    let item = option('OFFER_MUTUALDEFENSE', 'OFFER_MUTUALDEFENSE', M, 'Propose Mutual Defense Pact', empire);
    if (num7 > 5.0) item = option('OFFER_PROTECTORATE', 'OFFER_PROTECTORATE', M, 'Propose Protectorate', empire);
    const item2 = option('MILITARYREFUELING_OFFER', 'MILITARYREFUELING_OFFER', M, 'Allow Military Refueling');
    const item3 = option('MILITARYREFUELING_CANCEL', 'MILITARYREFUELING_CANCEL', M, 'Cancel Military Refueling');
    const item4 = option('MININGRIGHTS_OFFER', 'MININGRIGHTS_OFFER', M, 'Allow Mining Rights');
    const item5 = option('MININGRIGHTS_CANCEL', 'MININGRIGHTS_CANCEL', M, 'Cancel Mining Rights');
    obtainDiplomaticRelation(empire, player); // Main.Part9.cs:355 (result unused)
    const declareWarOption = (): ProposalOption => option('WAR_DECLARE', 'WAR_DECLARE', M, 'Declare War!', empire);
    const cancelTreaty = (): ProposalOption =>
        option('CANCELTREATY', 'CANCELTREATY', M, gameText('Cancel our current treaty', relationTypeDescription(diplomaticRelation.type)), empire);
    const refuelling = (): void => {
        list.push(diplomaticRelation.militaryRefuelingToOther ? item3 : item2);
    };
    const mining = (): void => {
        list.push(diplomaticRelation.miningRightsToOther ? item5 : item4);
    };
    switch (diplomaticRelation.type) {
        case DiplomaticRelationType.None:
            list.push(option('OFFER_FREETRADE', 'OFFER_FREETRADE', M, 'Propose Free Trade Agreement', empire));
            list.push(item);
            list.push(option('TRADESANCTIONS_IMPOSE', 'TRADESANCTIONS_IMPOSE', M, 'Impose Trade Sanctions', empire));
            list.push(declareWarOption());
            refuelling();
            mining();
            break;
        case DiplomaticRelationType.FreeTradeAgreement:
            list.push(cancelTreaty());
            list.push(item);
            list.push(declareWarOption());
            refuelling();
            mining();
            break;
        case DiplomaticRelationType.SubjugatedDominion:
            if (diplomaticRelation.initiator === player) {
                list.push(option('SUBJUGATION_RELEASE', 'SUBJUGATION_RELEASE', M, 'We set you free from Subjugation'));
            } else {
                list.push(option('SUBJUGATION_REQUESTRELEASE', 'SUBJUGATION_REQUESTRELEASE', M, 'We beg for release from Subjugation'));
            }
            refuelling();
            mining();
            list.push(declareWarOption());
            break;
        case DiplomaticRelationType.MutualDefensePact:
        case DiplomaticRelationType.Protectorate:
            list.push(cancelTreaty());
            list.push(option('OFFER_FREETRADE', 'OFFER_FREETRADE', M, 'Propose Free Trade Agreement', empire));
            list.push(declareWarOption());
            mining();
            break;
        case DiplomaticRelationType.TradeSanctions:
            if (diplomaticRelation.initiator === player) list.push(option('TRADESANCTIONS_LIFT', 'TRADESANCTIONS_LIFT', M, 'Lift Trade Sanctions'));
            list.push(option('WAR_DECLARE', 'WAR_DECLARE', M, 'Declare War!'));
            break;
        case DiplomaticRelationType.War:
            list.push(option('WAR_END', 'WAR_END', M, 'Propose an end to War', empire));
            list.push(option('WAR_END_SUBJUGATIONDEMAND', 'WAR_END_SUBJUGATIONDEMAND', M, 'Propose an end to War if you agree to become our Subjugated Dominion', empire));
            list.push(option('WAR_END_SUBJUGATIONOFFER', 'WAR_END_SUBJUGATIONOFFER', M, 'We agree to become your Subjugated Dominion to end this war', player));
            break;
        case DiplomaticRelationType.Truce:
            list.push(option('WAR_END', 'WAR_END', M, 'Propose an end to War'));
            list.push(option('WAR_DECLARE', 'WAR_DECLARE', M, 'Declare War!'));
            break;
    }
    void galaxy;
    return list;
}

/** Main.Part9.cs:493-496 case WAR_END_SUBJUGATIONDEMAND: the options after the other empire demands our subjugation;
 *  Main.Part9.cs:273 case OFFER_DEAL_RESPONSE: the quick map / tech offers (tradeNegotiation.offerDealOptions). */
function followUpOptions(reply: DialogPartType, other: Empire, galaxy: Galaxy | null = null, player: Empire | null = null): ProposalOption[] {
    switch (reply) {
        case 'OFFER_DEAL_RESPONSE':
            if (galaxy === null || player === null) return [];
            return offerDealOptions(galaxy, player, other).map((o) => option(o.id, o.part, 'FOLLOW_UP', o.label, null, o.cost));
        case 'WAR_END_SUBJUGATIONDEMAND':
            return [
                option('SUBJUGATIONDEMAND_ACCEPT', 'SUBJUGATIONDEMAND_ACCEPT', 'FOLLOW_UP', 'Yes, we accept defeat and acknowledge your status as our ruler', other),
                option('SUBJUGATIONDEMAND_REJECT', 'SUBJUGATIONDEMAND_REJECT', 'FOLLOW_UP', 'No, we will not become your slaves!', other),
            ];
    }
    return [];
}

/** Main.Part10.cs:3869 method_231(empire_5, empire_6): empire_5's attitude to empire_6 as -1 (< -10) / 0 / 1 (> 10). */
function attitudeClass(galaxy: Galaxy, empire5: Empire, empire6: Empire): number {
    const empireEvaluation = obtainEmpireEvaluation(galaxy, empire5, empire6);
    if (empireEvaluation.overallAttitude < -10) return -1;
    if (empireEvaluation.overallAttitude > 10) return 1;
    return 0;
}

/**
 * Main.Part10.cs:3890 method_232(empire_5, empire_6): the relation empire_5 wants with empire_6
 * (DetermineDesiredDiplomaticRelationTypical of its strategy; a wanted Mutual Defense Pact becomes a Protectorate when
 * empire_6 is more than 5x as strong). None for a pirate empire_6.
 */
export function desiredRelationType(empire5: Empire, empire6: Empire): DiplomaticRelationType {
    let diplomaticRelationType = DiplomaticRelationType.None;
    if (empire6.pirateEmpireBaseHabitat === null) {
        const diplomaticRelation = obtainDiplomaticRelation(empire5, empire6);
        diplomaticRelationType = determineDesiredDiplomaticRelationTypical(diplomaticRelation.strategy, diplomaticRelation.type);
        if (diplomaticRelationType === DiplomaticRelationType.MutualDefensePact) {
            const num = militaryPotency(empire6) / militaryPotency(empire5);
            if (num > 5.0) diplomaticRelationType = DiplomaticRelationType.Protectorate;
        }
    }
    return diplomaticRelationType;
}

/** Main.Part10.cs:3930 method_235(empire_5, empire_6): drop empire_5's proposal from empire_6. */
function removeProposal(empire5: Empire, empire6: Empire): void {
    const diplomaticRelation = empire5.proposedDiplomaticRelations.byEmpire(empire6);
    if (diplomaticRelation !== null) empire5.proposedDiplomaticRelations.remove(diplomaticRelation);
}

/** Empire.9.cs:3912 DetermineEmpireSystemsWithOtherMilitaryForcesPresent(otherEmpire). */
export function determineEmpireSystemsWithOtherMilitaryForcesPresent(galaxy: Galaxy, self: Empire, otherEmpire: Empire): Habitat[] {
    const habitatList: Habitat[] = [];
    const habitatList2 = determineEmpireDominatedSystems(galaxy, self, true);
    for (const item of habitatList2) {
        const sv = self.systemVisibility[item.systemIndex];
        if (sv.threats == null || sv.threatLevels == null || sv.threats.length <= 0) continue;
        const threats = sv.threats;
        for (let i = 0; i < threats.length; i++) {
            const builtObject = threats[i];
            if (builtObject.role === BuiltObjectRole.Military && builtObject.firepowerRaw > 0 && builtObject.empire === otherEmpire && !habitatList.includes(item)) {
                habitatList.push(item);
            }
        }
    }
    return habitatList;
}

/** Empire.9.cs:4096/4102 DetermineTopThreatenedSystem(empire): the dominated system with the most of `empire`'s
 *  firepower in its threat list (none while we give them military refuelling). */
export function determineTopThreatenedSystem(galaxy: Galaxy, self: Empire, empire: Empire): Habitat | null {
    const systemStars = determineEmpireDominatedSystems(galaxy, self, true);
    let result: Habitat | null = null;
    let num = 0;
    const diplomaticRelation = obtainDiplomaticRelation(self, empire);
    if (!diplomaticRelation.militaryRefuelingToOther) {
        for (const systemStar of systemStars) {
            let num2 = 0;
            const sv = self.systemVisibility[systemStar.systemIndex];
            if (sv.threats != null && sv.threatLevels != null && sv.threats.length > 0) {
                const threats: BuiltObject[] = sv.threats;
                for (let i = 0; i < threats.length; i++) {
                    const t = threats[i];
                    const mission = builtObjectMission(t.mission);
                    if (
                        t.role !== BuiltObjectRole.Base &&
                        t.empire !== galaxy.independentEmpire &&
                        t.empire!.pirateEmpireBaseHabitat === null &&
                        t.empire === empire &&
                        t.firepowerRaw > 0 &&
                        (t.owner !== null || (t.weapons != null && t.weapons.length > 1)) &&
                        (mission === null || mission.type !== BuiltObjectMissionType.Blockade) &&
                        diplomaticRelation.type !== DiplomaticRelationType.War &&
                        !diplomaticRelation.militaryRefuelingToOther &&
                        t.subRole !== BuiltObjectSubRole.ResortBase
                    ) {
                        num2 += t.firepowerRaw;
                    }
                }
            }
            if (num2 > num) {
                result = systemStar;
                num = num2;
            }
        }
    }
    return result;
}

function refused(hint: string): ProposalResult {
    return { ok: false, accepted: false, message: hint, reply: null, replyArgs: [], followUps: [], expireMessagesFor: null, automationPrompt: false, trade: null };
}

/** The parts whose C# case opens with the "Treaty Negotiation" automation message box. */
const AUTOMATION_PROMPT_PARTS: ReadonlySet<DialogPartType> = new Set<DialogPartType>([
    'OFFER_FREETRADE', 'OFFER_PROTECTORATE', 'OFFER_MUTUALDEFENSE', 'CANCELTREATY', 'SUBJUGATION_RELEASE',
    'MININGRIGHTS_OFFER', 'MININGRIGHTS_CANCEL', 'MILITARYREFUELING_OFFER', 'MILITARYREFUELING_CANCEL',
    'PIRATE_PROTECTIONPROPOSE_OFFER', 'CANCELPIRATEPROTECTION',
]);

/**
 * The player picks `proposal` (an option from listProposals, or a follow-up from a previous result; or its id) in the
 * conversation with `other`: port of Main.Part10.cs:3957 method_237 for those option types (initiator = the player,
 * empire = `other`). The option is re-resolved against the current state (the original pauses the game while the
 * conversation is open, Main.Part8.cs:453), so a stale or disabled option is refused with ok = false.
 */
export function submitProposal(
    galaxy: Galaxy,
    player: Empire,
    other: Empire,
    proposal: ProposalOption | string,
    opts: SubmitProposalOptions = {},
): ProposalResult {
    const id = typeof proposal === 'string' ? proposal : proposal.id;
    let chosen: ProposalOption | undefined;
    if (id === 'SUBJUGATIONDEMAND_ACCEPT' || id === 'SUBJUGATIONDEMAND_REJECT') {
        // Follow-up of the other empire's WAR_END_SUBJUGATIONDEMAND (Main.Part9.cs:493); needs the war to still be on.
        if (!canSpeak(galaxy, player, other)) return refused('');
        if (obtainDiplomaticRelation(player, other).type !== DiplomaticRelationType.War) return refused('Not at war');
        chosen = followUpOptions('WAR_END_SUBJUGATIONDEMAND', other).find((o) => o.id === id);
    } else if (id.startsWith('OFFER_DEAL_')) {
        // Follow-up of OFFER_DEAL_RESPONSE (Main.Part9.cs:273), settled at once (Main.Part10.cs:4230-4323).
        if (!canSpeak(galaxy, player, other)) return refused('');
        if (!listProposals(galaxy, player, other).some((o) => o.id === 'OFFER_DEAL' && o.enabled)) return refused('No longer on offer');
        const r = submitOfferDeal(galaxy, player, other, id);
        if (!r.ok) return refused(r.message);
        return { ok: true, accepted: r.accepted, message: r.message, reply: r.reply, replyArgs: [], followUps: [], expireMessagesFor: null, automationPrompt: false, trade: null };
    } else {
        chosen = listProposals(galaxy, player, other).find((o) => o.id === id);
    }
    if (chosen === undefined) return refused('No longer on offer');
    if (!chosen.enabled) return refused(chosen.hint);
    return evaluateProposal(galaxy, player, other, chosen, opts);
}

/** Mod layer 19a (R7): proposals the Concord refuses → the stock reject reply. */
const RIM_TRADER_REFUSED_PARTS: ReadonlyMap<DialogPartType, DialogPartType> = new Map<DialogPartType, DialogPartType>([
    ['OFFER_PROTECTORATE', 'PROTECTORATE_REJECT'],
    ['OFFER_MUTUALDEFENSE', 'MUTUALDEFENSE_REJECT'],
    ['WAR_END_SUBJUGATIONDEMAND', 'SUBJUGATIONDEMAND_REJECT'],
]);

/** Main.Part10.cs:3957 method_237, the cases for the options listProposals offers. */
function evaluateProposal(galaxy: Galaxy, initiator: Empire, empire: Empire, option0: ProposalOption, opts: SubmitProposalOptions): ProposalResult {
    const result: ProposalResult = { ok: true, accepted: false, message: '', reply: null, replyArgs: [], followUps: [], expireMessagesFor: null, automationPrompt: false, trade: null };
    // Mod layer 19a: the Concord refuses defence treaties and subjugation (tasks/19a-rim-trader.md R7); before any stock draw.
    if (scenarioFlag(galaxy, 'rimTrader') && isRimTraderAI(galaxy, empire)) {
        const refusal = RIM_TRADER_REFUSED_PARTS.get(option0.part);
        if (refusal !== undefined) {
            result.reply = refusal;
            result.message = scenarioText('Scenario RimTrade Treaty Refused', empire.name);
            return result;
        }
    }
    const now = galaxyStarDate(galaxy);
    const num = attitudeClass(galaxy, empire, initiator); // Main.Part10.cs:3966
    const reply = (part: DialogPartType): void => {
        result.reply = part;
    };
    const expire = (e: Empire): void => {
        result.expireMessagesFor = e;
    };
    // Main.Part10.cs:4150 etc.: the automation message box before treaty actions.
    if (AUTOMATION_PROMPT_PARTS.has(option0.part) && initiator.controlDiplomacyTreaties === AutomationLevel.FullyAutomated) {
        result.automationPrompt = true;
        if (opts.disableTreatyAutomation === true) initiator.controlDiplomacyTreaties = MANUAL;
    }
    switch (option0.part) {
        case 'OFFER_FREETRADE': // Main.Part10.cs:4149
            if (empire.reclusive) {
                reply('FREETRADE_REJECT');
                break;
            }
            switch (desiredRelationType(empire, initiator)) {
                case DiplomaticRelationType.FreeTradeAgreement:
                case DiplomaticRelationType.MutualDefensePact:
                case DiplomaticRelationType.Protectorate:
                    reply('FREETRADE_ACCEPT');
                    result.accepted = true;
                    changeDiplomaticRelation(galaxy, initiator, obtainDiplomaticRelation(initiator, empire), DiplomaticRelationType.FreeTradeAgreement);
                    removeProposal(initiator, empire);
                    removeProposal(empire, initiator);
                    expire(empire);
                    break;
                default:
                    reply('FREETRADE_REJECT');
                    break;
            }
            break;
        case 'OFFER_PROTECTORATE': // Main.Part10.cs:4175
            if (empire.reclusive) {
                reply('PROTECTORATE_REJECT');
                break;
            }
            if (desiredRelationType(empire, initiator) === DiplomaticRelationType.Protectorate) {
                reply('PROTECTORATE_ACCEPT');
                result.accepted = true;
                changeDiplomaticRelation(galaxy, initiator, obtainDiplomaticRelation(initiator, empire), DiplomaticRelationType.Protectorate);
                removeProposal(initiator, empire);
                removeProposal(empire, initiator);
                expire(empire);
            } else {
                reply('PROTECTORATE_REJECT');
            }
            break;
        case 'OFFER_MUTUALDEFENSE': // Main.Part10.cs:4201
            if (empire.reclusive) {
                reply('MUTUALDEFENSE_REJECT');
                break;
            }
            if (desiredRelationType(empire, initiator) === DiplomaticRelationType.MutualDefensePact) {
                reply('MUTUALDEFENSE_ACCEPT');
                result.accepted = true;
                changeDiplomaticRelation(galaxy, initiator, obtainDiplomaticRelation(initiator, empire), DiplomaticRelationType.MutualDefensePact);
                removeProposal(initiator, empire);
                removeProposal(empire, initiator);
                expire(empire);
            } else {
                reply('MUTUALDEFENSE_REJECT');
            }
            break;
        case 'CANCELTREATY': // Main.Part10.cs:4569
            reply(num === -1 ? 'CANCELTREATY_RESPONSE_ANGRY' : num === 0 ? 'CANCELTREATY_RESPONSE_NEUTRAL' : 'CANCELTREATY_RESPONSE_FRIENDLY');
            result.accepted = true;
            changeDiplomaticRelation(galaxy, initiator, obtainDiplomaticRelation(initiator, empire), DiplomaticRelationType.None);
            removeProposal(initiator, empire);
            removeProposal(empire, initiator);
            expire(empire);
            break;
        case 'TRADESANCTIONS_IMPOSE': // Main.Part10.cs:4591
            reply(num === -1 ? 'TRADESANCTIONS_IMPOSE_RESPONSE_ANGRY' : num === 0 ? 'TRADESANCTIONS_IMPOSE_RESPONSE_NEUTRAL' : 'TRADESANCTIONS_IMPOSE_RESPONSE_SURPRISED');
            result.accepted = true;
            changeDiplomaticRelation(galaxy, initiator, obtainDiplomaticRelation(initiator, empire), DiplomaticRelationType.TradeSanctions);
            removeProposal(initiator, empire);
            removeProposal(empire, initiator);
            expire(empire);
            break;
        case 'TRADESANCTIONS_LIFT': // Main.Part10.cs:4609 (all three attitudes give TRADESANCTIONS_LIFT_RESPONSE)
            reply('TRADESANCTIONS_LIFT_RESPONSE');
            result.accepted = true;
            changeDiplomaticRelation(galaxy, initiator, obtainDiplomaticRelation(initiator, empire), DiplomaticRelationType.None);
            removeProposal(initiator, empire);
            removeProposal(empire, initiator);
            expire(empire);
            cancelBlockades(galaxy, initiator, empire);
            cancelBlockades(galaxy, empire, initiator);
            break;
        case 'WAR_DECLARE': // Main.Part10.cs:4649
            reply(num === -1 ? 'WAR_DECLARE_RESPONSE_EAGER' : num === 0 ? 'WAR_DECLARE_RESPONSE_NEUTRAL' : 'WAR_DECLARE_RESPONSE_SURPRISED');
            result.accepted = true;
            declareWar(galaxy, initiator, empire);
            removeProposal(initiator, empire);
            removeProposal(empire, initiator);
            expire(empire);
            break;
        case 'WAR_END': { // Main.Part10.cs:4679
            const c = considerEndWar(galaxy, empire, initiator, false);
            if (galaxy.scenario !== null) c.end = scenarioQuery(galaxy, 'endWarAcceptance', c.end, { empire, other: initiator }); // mod layer
            if (c.end) {
                const diplomaticRelation3 = obtainDiplomaticRelation(empire, initiator);
                const v = determineVictorInWar(diplomaticRelation3);
                // `&&` short-circuits as in the C#: DetermineWhetherWantToOfferSubjugation (2 NextDouble) only when they win.
                if (
                    v.victor === empire &&
                    determineWhetherWantToOfferSubjugation(galaxy, empire, empire) &&
                    determineSubjugationOfLoserInWar(v.victor, v.loser, v.winningRatio, militaryPotency(v.victor), militaryPotency(v.loser))
                ) {
                    reply('WAR_END_SUBJUGATIONDEMAND');
                    result.followUps = followUpOptions('WAR_END_SUBJUGATIONDEMAND', empire);
                    break;
                }
                reply('WAR_END_ACCEPT');
                result.accepted = true;
                const diplomaticRelation = obtainDiplomaticRelation(initiator, empire);
                resetAttitudeLevelsAtEndOfWar(galaxy, diplomaticRelation);
                diplomaticRelation.type = DiplomaticRelationType.None;
                diplomaticRelation.lastDiplomacyTradeOfferDate = now;
                const diplomaticRelation2 = obtainDiplomaticRelation(empire, initiator);
                diplomaticRelation2.type = DiplomaticRelationType.None;
                diplomaticRelation2.lastDiplomacyTradeOfferDate = now;
                processEndOfWarWithEmpire(galaxy, initiator, empire);
                processEndOfWarWithEmpire(galaxy, empire, initiator);
                expire(empire);
                if (galaxy.scenario !== null) scenarioEmit(galaxy, 'peaceSigned', { empire, other: initiator }); // mod layer
            } else {
                reply('WAR_END_REJECT');
            }
            break;
        }
        case 'WAR_END_SUBJUGATIONDEMAND': { // Main.Part10.cs:4715
            const diplomaticRelation = obtainDiplomaticRelation(initiator, empire);
            if (diplomaticRelation.type === DiplomaticRelationType.War) {
                const v = determineVictorInWar(diplomaticRelation);
                if (v.victor === initiator && determineSubjugationOfLoserInWar(v.victor, v.loser, v.winningRatio, militaryPotency(v.victor), militaryPotency(v.loser))) {
                    reply('SUBJUGATIONDEMAND_ACCEPT');
                    result.accepted = true;
                    resetAttitudeLevelsAtEndOfWar(galaxy, diplomaticRelation);
                    diplomaticRelation.type = DiplomaticRelationType.SubjugatedDominion;
                    diplomaticRelation.lastDiplomacyTradeOfferDate = now;
                    diplomaticRelation.initiator = initiator;
                    const diplomaticRelation2 = obtainDiplomaticRelation(empire, initiator);
                    diplomaticRelation2.type = DiplomaticRelationType.SubjugatedDominion;
                    diplomaticRelation2.lastDiplomacyTradeOfferDate = now;
                    diplomaticRelation2.initiator = initiator;
                    processEndOfWarWithEmpire(galaxy, initiator, empire);
                    processEndOfWarWithEmpire(galaxy, empire, initiator);
                    expire(empire);
                    setEmpireViewableForever(initiator, empire);
                } else {
                    reply('SUBJUGATIONDEMAND_REJECT');
                }
            } else {
                reply('SUBJUGATIONDEMAND_REJECT');
            }
            break;
        }
        case 'WAR_END_SUBJUGATIONOFFER': { // Main.Part10.cs:4767
            if (desiredRelationType(initiator, empire) === DiplomaticRelationType.War) {
                reply('SUBJUGATIONOFFER_REJECT');
                break;
            }
            const c = considerEndWar(galaxy, empire, initiator, true);
            if (c.end) {
                reply('SUBJUGATIONOFFER_ACCEPT');
                result.accepted = true;
                const diplomaticRelation = obtainDiplomaticRelation(initiator, empire);
                resetAttitudeLevelsAtEndOfWar(galaxy, diplomaticRelation, empire);
                diplomaticRelation.type = DiplomaticRelationType.SubjugatedDominion;
                diplomaticRelation.lastDiplomacyTradeOfferDate = now;
                diplomaticRelation.initiator = empire;
                const diplomaticRelation2 = obtainDiplomaticRelation(empire, initiator);
                diplomaticRelation2.initiator = empire;
                diplomaticRelation2.type = DiplomaticRelationType.SubjugatedDominion;
                diplomaticRelation2.lastDiplomacyTradeOfferDate = now;
                processEndOfWarWithEmpire(galaxy, initiator, empire);
                processEndOfWarWithEmpire(galaxy, empire, initiator);
                expire(empire);
            } else {
                reply('SUBJUGATIONOFFER_REJECT');
            }
            break;
        }
        case 'SUBJUGATIONDEMAND_ACCEPT': { // Main.Part10.cs:4827 (we accept their demand: they subjugate us)
            reply('SUBJUGATIONDEMAND_ACCEPT_RESPONSE');
            result.accepted = true;
            const diplomaticRelation = obtainDiplomaticRelation(empire, initiator);
            resetAttitudeLevelsAtEndOfWar(galaxy, diplomaticRelation, empire);
            diplomaticRelation.type = DiplomaticRelationType.SubjugatedDominion;
            diplomaticRelation.lastDiplomacyTradeOfferDate = now;
            diplomaticRelation.initiator = empire;
            const diplomaticRelation2 = obtainDiplomaticRelation(initiator, empire);
            diplomaticRelation2.type = DiplomaticRelationType.SubjugatedDominion;
            diplomaticRelation2.lastDiplomacyTradeOfferDate = now;
            diplomaticRelation2.initiator = empire;
            processEndOfWarWithEmpire(galaxy, initiator, empire);
            processEndOfWarWithEmpire(galaxy, empire, initiator);
            expire(empire);
            setEmpireViewableForever(empire, initiator);
            break;
        }
        case 'SUBJUGATIONDEMAND_REJECT': // Main.Part10.cs:4851
            reply('TREATY_REJECTRESPONSE');
            break;
        case 'SUBJUGATION_REQUESTRELEASE': // Main.Part10.cs:4877 (Rnd.Next(0, 80) only when they want no relation)
            if (desiredRelationType(empire, initiator) === DiplomaticRelationType.None && aggressionLevel(empire) < 130 + galaxy.rnd.next(0, 80)) {
                reply('SUBJUGATION_RELEASE');
                result.accepted = true;
                const diplomaticRelation = obtainDiplomaticRelation(empire, initiator);
                diplomaticRelation.lastDiplomacyTradeOfferDate = now;
                changeDiplomaticRelation(galaxy, empire, diplomaticRelation, DiplomaticRelationType.None);
                removeProposal(empire, initiator);
                removeProposal(initiator, empire);
                expire(empire);
            } else {
                reply('SUBJUGATION_REFUSERELEASE');
            }
            break;
        case 'SUBJUGATION_RELEASE': // Main.Part10.cs:4893
            reply('SUBJUGATION_RELEASE_RESPONSE');
            result.accepted = true;
            changeDiplomaticRelation(galaxy, initiator, obtainDiplomaticRelation(initiator, empire), DiplomaticRelationType.None);
            removeProposal(initiator, empire);
            removeProposal(empire, initiator);
            expire(empire);
            break;
        case 'GIFT_GIVE': { // Main.Part10.cs:4907
            const cost = option0.cost;
            const num7 = valueMoneyGiftFromEmpire(galaxy, empire, initiator, cost);
            const empireEvaluation2 = obtainEmpireEvaluation(galaxy, empire, initiator);
            empireEvaluation2.incidentEvaluation = empireEvaluation2.incidentEvaluationRaw + num7;
            setCivilityRating(initiator, initiator.civilityRating + num7 * 0.1);
            initiator.stateMoney -= cost;
            initiator.pirateEconomy.performExpense(cost, PirateExpenseType.Undefined, now);
            empire.stateMoney += cost;
            empire.pirateEconomy.performIncome(cost, PirateIncomeType.Undefined, now);
            const diplomaticRelation2 = obtainDiplomaticRelation(initiator, empire);
            diplomaticRelation2.lastGiftDate = now;
            reply('GIFT_THANKS');
            result.accepted = true;
            break;
        }
        case 'WARNING_INTELLIGENCEMISSIONS': // Main.Part10.cs:4925 (a reply only)
            reply(num === -1 ? 'WARNING_INTELLIGENCEMISSIONS_RESPONSE_ANGRY' : num === 0 ? 'WARNING_INTELLIGENCEMISSIONS_RESPONSE_NEUTRAL' : 'WARNING_INTELLIGENCEMISSIONS_RESPONSE_FRIENDLY');
            break;
        case 'WARNING_ATTACKS': // Main.Part10.cs:4939 (a reply only)
            reply(num === -1 ? 'WARNING_ATTACKS_RESPONSE_ANGRY' : num === 0 ? 'WARNING_ATTACKS_RESPONSE_NEUTRAL' : 'WARNING_ATTACKS_RESPONSE_FRIENDLY');
            break;
        case 'WARNING_REMOVEFORCESSYSTEM': { // Main.Part10.cs:4953
            let related: Empire | Habitat | null = option0.related;
            const habitat = determineTopThreatenedSystem(galaxy, initiator, empire);
            if (habitat !== null) {
                switch (removeMilitaryForcesFromSystem(galaxy, empire, habitat, initiator)) {
                    case 1:
                        reply('WARNING_REMOVEFORCESSYSTEM_RESPONSE_COMPLY');
                        related = habitat;
                        result.accepted = true;
                        break;
                    case 0:
                        reply('WARNING_REMOVEFORCESSYSTEM_RESPONSE_NOFORCESPRESENT');
                        break;
                    case -1:
                        reply('WARNING_REMOVEFORCESSYSTEM_RESPONSE_REFUSE');
                        related = habitat;
                        break;
                }
            } else {
                reply('WARNING_REMOVEFORCESSYSTEM_RESPONSE_NOFORCESPRESENT');
            }
            // Main.Part10.cs:3831-3839 method_230: the text is formatted with the related habitat's name.
            if (related !== null && isHabitat(related)) result.replyArgs = [related.name];
            break;
        }
        case 'MININGRIGHTS_OFFER': // Main.Part10.cs:5052
            obtainDiplomaticRelation(initiator, empire).miningRightsToOther = true;
            reply('GREETING_FRIENDLY');
            result.accepted = true;
            break;
        case 'MININGRIGHTS_CANCEL': // Main.Part10.cs:5061
            obtainDiplomaticRelation(initiator, empire).miningRightsToOther = false;
            reply('GREETING_ANGRY');
            result.accepted = true;
            break;
        case 'MILITARYREFUELING_OFFER': // Main.Part10.cs:5070
            obtainDiplomaticRelation(initiator, empire).militaryRefuelingToOther = true;
            reply('GREETING_FRIENDLY');
            result.accepted = true;
            break;
        case 'MILITARYREFUELING_CANCEL': // Main.Part10.cs:5079
            obtainDiplomaticRelation(initiator, empire).militaryRefuelingToOther = false;
            reply('GREETING_ANGRY');
            result.accepted = true;
            break;
        case 'PIRATE_PROTECTIONPROPOSE_OFFER': // Main.Part10.cs:5088
            if (determineDesirePirateProtection(galaxy, empire, initiator)) {
                acceptPirateProtection(galaxy, empire, initiator, option0.cost);
                reply('PIRATE_PROTECTIONPROPOSE_OFFER_ACCEPT');
                result.accepted = true;
            } else {
                reply('PIRATE_PROTECTIONPROPOSE_OFFER_REJECT');
            }
            break;
        case 'CANCELPIRATEPROTECTION': { // Main.Part10.cs:5103
            reply(num === -1 ? 'CANCELTREATY_RESPONSE_ANGRY' : num === 0 ? 'CANCELTREATY_RESPONSE_NEUTRAL' : 'CANCELTREATY_RESPONSE_FRIENDLY');
            result.accepted = true;
            changePirateRelation(initiator, empire, PirateRelationType.None, now);
            // 5123-5128: `if (initiator != null)` (always true here).
            const pirateRelation = obtainPirateRelation(empire, initiator);
            const evaluationChangeAmount = pirateRelation.calculateOffenseOverCancellingProtection(now);
            changePirateEvaluation(empire, initiator, evaluationChangeAmount, PirateRelationEvaluationType.ProtectionCancelled);
            break;
        }
        case 'OFFER_DEAL': // Main.Part10.cs:4227
            reply('OFFER_DEAL_RESPONSE');
            result.followUps = followUpOptions('OFFER_DEAL_RESPONSE', empire, galaxy, initiator);
            break;
        case 'DEAL_BEGIN': { // Main.Part10.cs:4324 (the reply stays DEAL_BEGIN: "What do you propose?")
            const kind = option0.id.substring('DEAL_BEGIN:'.length) as TradeNegotiationKind;
            const trade = beginTradeNegotiation(galaxy, initiator, empire, kind);
            if (trade === null) return refused('No longer on offer');
            reply('DEAL_BEGIN');
            result.trade = trade;
            break;
        }
        default:
            return refused(option0.hint);
    }
    result.message = result.reply ?? '';
    return result;
}

function isHabitat(x: Empire | Habitat): x is Habitat {
    return x instanceof Habitat;
}

/** Main.Part10.cs:4743-4751: `viewer` sees `empire` for ever (EmpiresViewable / EmpiresViewableExpiry = long.MaxValue). */
function setEmpireViewableForever(viewer: Empire, empire: Empire): void {
    const num2 = LONG_MAX_VALUE;
    const num3 = viewer.empiresViewable.indexOf(empire);
    if (num3 >= 0) {
        viewer.empiresViewableExpiry[num3] = num2;
        return;
    }
    viewer.empiresViewable.push(empire);
    viewer.empiresViewableExpiry.push(num2);
}
