// The player's answers to an incoming diplomatic conversation (a queued DialogPartType opened by
// Main.Part9.cs ReceiveMessageInternal). The options come from Main.Part9.cs:46 method_238; the chosen one is evaluated by
// Main.Part10.cs:3957 method_237, whose cases for the replies to the *other* empire's initiative are ported here (the
// replies that need no counter-offer logic; the treaty offers and the pirate protection offers have their own
// executors: playerOrders.ts acceptProposal / declineProposal, playerOps.ts acceptPirateOfferProtection).
//
// In every case the conversation option's Initiator is the player (method_238 creates the reply options with
// _Game.PlayerEmpire) and `empire` is the other party (`sender`).
//
// Runs only as a player command (playerOps.ts answerConversation), applied at the next frame boundary.
// Rnd: none, except DoResearchBreakthrough / DeclareWar / ChangeDiplomaticRelation's own draws.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { Habitat } from '../types';
import { DiplomaticRelationType, empireEvaluationByEmpire, empireEvaluationsOf, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../diplomacy';
import { SystemVisibilityStatus } from '../visibility';
import {
    changeDiplomaticRelation,
    declareWar,
    processEndOfWarWithEmpire,
    resetAttitudeLevelsAtEndOfWar,
    setCivilityRating,
} from '../diplomacyTick';
import { PirateIncomeType } from '../pirates/pirateEconomy';
import { pirateEconomyPerformIncome } from '../pirates/pirateAI';
import { ruinsSubject, locationSubject } from './hintSubjects';
import { TradeableItem, TradeableItemType, addLocationHint, giveTerritoryMap, giveTradeableItem, isTechNode } from '../tradeItems';
import { mergeGalaxyMap } from '../exploration';
import { doResearchBreakthrough, reviewDesignsBuiltObjectsImprovedComponents } from '../researchTick';
import { galaxyStarDate } from '../tick/simTime';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage, sendMessageToEmpire } from '../messages';
import { getText } from '../textResolver';
import { checkForStoryLocationHint, generateBuiltObjectStoryClue, generateMajorStoryItem } from '../story/storyEvents';
import type { BuiltObject } from '../builtObject';
import { GalaxyLocation } from '../galaxyLocation';
import type { DialogPartType } from '../data/dialogSet';
import { HabitatCategoryType, HabitatType } from '../types';
import { resolveDescription } from '../messages';
import { resolveSectorDescription } from '../empireEvents';
import { scenarioEmit } from '../scenario/hooks';

/** The response DialogPartTypes (Main.Part9.cs:46 method_238 options) this executor evaluates. */
export type ConversationReplyPart =
    | 'INFO_UNMETEMPIRE'
    | 'INFO_EXPLORATION'
    | 'INFO_INDEPENDENTCOLONY'
    | 'INFO_RUINS'
    | 'INFO_DEBRISFIELD'
    | 'INFO_PLANETDESTROYER'
    | 'INFO_RESTRICTEDAREA'
    | 'DEAL_ACCEPT'
    | 'DEAL_REJECT'
    | 'MUTUALDEFENSE_HONORREQUESTHELP'
    | 'MUTUALDEFENSE_DECLINEREQUESTHELP'
    | 'TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT'
    | 'TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT'
    | 'WAR_DECLARE_REQUESTJOINT_ACCEPT'
    | 'WAR_END_REQUESTOTHER_ACCEPT'
    | 'WAR_END_ACCEPT'
    | 'HISTORY_OFFER_LOCATIONHINT_ACCEPT'
    | 'HISTORY_OFFER_STORYCLUE_ACCEPT'
    | 'HISTORY_OFFER_STORYMESSAGE_ACCEPT';

/** What `related` carries per part: an Empire / Habitat / [x, y] of a GalaxyLocation / TradeableItem / [offered, requested]. */
export type ConversationRelated = Empire | Habitat | number[] | TradeableItem | TradeableItem[][] | null;

export interface ConversationReplyResult {
    /** The reply changed the sim. */
    ok: boolean;
    /** INFO_NOFUNDS: "Looks like you don't have enough money to pay for this". */
    noFunds: boolean;
    /** ExpireDiplomacyMessagesForEmpire(...) target (Main.Part10.cs after the treaty cases). */
    expireFor: Empire | null;
    /** A revealed story text (HISTORY_OFFER_*_ACCEPT: method_571 / method_572 dialog). */
    /**
     * The story text to show (Main.Part10.cs method_571 / method_572) and copy to Galactic History. `storyLevel` is set for
     * HISTORY_OFFER_STORYMESSAGE_ACCEPT: Galaxy.StoryReturnOfTheShakturiEventLevel as method_572 got it (before the
     * increment) — it picks the panel's picture and, at 2 and 4, its two answer buttons (story/freedomAlliance.ts).
     */
    history: { title: string; text: string; storyLevel?: number } | null;
    /** The part method_237 turns the option into (method_234), whose dialog text Main.Part10.cs:3590 method_230 shows in
     *  the talk panel's response; null when the option closes the conversation (method_294: the history offers). */
    reply: DialogPartType | null;
    /** string.Format arguments of the reply text (method_230). */
    replyArgs: string[];
}

function removeProposal(a: Empire, b: Empire): void {
    const r = a.proposedDiplomaticRelations.byEmpire(b);
    if (r !== null) a.proposedDiplomaticRelations.remove(r);
}

// Main.Part10.cs:3930 method_235 both ways.
function removeProposals(a: Empire, b: Empire): void {
    removeProposal(a, b);
    removeProposal(b, a);
}

function galaxyLocationAt(galaxy: Galaxy, xy: number[]): GalaxyLocation | null {
    return galaxy.galaxyLocations.find((l) => l.xpos === xy[0] && l.ypos === xy[1]) ?? null;
}

/** [xpos, ypos] key a GalaxyLocation travels as through the command log (which cannot carry it by identity). */
export function galaxyLocationKey(l: GalaxyLocation): number[] {
    return [l.xpos, l.ypos];
}

// Main.Part10.cs:4034-4128 INFO_* purchases (`Cost` is the message's Money).
function buyInfo(galaxy: Galaxy, player: Empire, pirate: Empire, part: ConversationReplyPart, related: ConversationRelated, cost: number, result: ConversationReplyResult): void {
    if (player.stateMoney < cost) {
        result.noFunds = true;
        return;
    }
    const now = galaxyStarDate(galaxy);
    const pay = (): void => {
        player.stateMoney -= cost;
        pirate.stateMoney += cost;
        pirateEconomyPerformIncome(galaxy, pirate, cost, PirateIncomeType.SellInfo, now);
        result.ok = true;
    };
    switch (part) {
        case 'INFO_UNMETEMPIRE': {
            const other = related as Empire | null;
            if (other === null || typeof other !== 'object' || !('diplomaticRelations' in other)) return;
            obtainDiplomaticRelation(player, other).type = DiplomaticRelationType.None;
            obtainDiplomaticRelation(other, player).type = DiplomaticRelationType.None;
            pay();
            return;
        }
        case 'INFO_EXPLORATION':
        case 'INFO_INDEPENDENTCOLONY':
        case 'INFO_RUINS': {
            const habitat = related as Habitat | null;
            if (!(habitat instanceof Habitat)) return;
            player.systemVisibility[habitat.systemIndex].status = SystemVisibilityStatus.Explored;
            pay();
            if (part === 'INFO_RUINS') addLocationHint(player, { x: Math.trunc(habitat.xpos), y: Math.trunc(habitat.ypos) }, ruinsSubject(habitat), `Pirates (bought from ${pirate.name})`);
            return;
        }
        case 'INFO_DEBRISFIELD':
        case 'INFO_PLANETDESTROYER':
        case 'INFO_RESTRICTEDAREA': {
            const loc = Array.isArray(related) ? galaxyLocationAt(galaxy, related as number[]) : null;
            if (loc === null) return;
            if (!player.visibility.knownGalaxyLocations.includes(loc)) player.visibility.knownGalaxyLocations.push(loc);
            pay();
            addLocationHint(player, { x: Math.trunc(loc.xpos + loc.width / 2), y: Math.trunc(loc.ypos + loc.height / 2) }, locationSubject(loc), `Pirates (bought from ${pirate.name})`);
            return;
        }
        default:
            return;
    }
}

// Main.Part10.cs:4387-4464 DEAL_ACCEPT / DEAL_ACCEPTCOMPLAIN.
function acceptDeal(galaxy: Galaxy, player: Empire, sender: Empire, related: ConversationRelated, result: ConversationReplyResult): void {
    if (Array.isArray(related) && related.length >= 2 && Array.isArray(related[0]) && Array.isArray(related[1])) {
        const [offered, requested] = related as TradeableItem[][];
        if (requested.length === 0) return; // `tradeableItemList2.Count > 0` gate
        for (const item of offered) giveTradeableItem(galaxy, sender, player, item, requested);
        for (const item of requested) giveTradeableItem(galaxy, player, sender, item, offered);
        result.ok = true;
        return;
    }
    if (!(related instanceof TradeableItem)) return;
    if (related.type === TradeableItemType.TerritoryMap) {
        giveTerritoryMap(galaxy, sender, player);
        giveTerritoryMap(galaxy, player, sender);
        result.ok = true;
    } else if (related.type === TradeableItemType.GalaxyMap) {
        mergeGalaxyMap(galaxy, player, sender);
        mergeGalaxyMap(galaxy, sender, player);
        result.ok = true;
    } else if (related.type === TradeableItemType.ResearchProject) {
        if (!(related.value <= player.stateMoney)) {
            result.noFunds = true;
            return;
        }
        if (isTechNode(related.item)) {
            const tree = player.research.techTree;
            // ResearchNodeList.GetEquivalent (this[ResearchNodeId]), as diplomacyTick.ts ProcessMessages does.
            const equivalent = tree.length > related.item.def.projectId ? tree[related.item.def.projectId] : null;
            if (equivalent !== null && !equivalent.isResearched) {
                doResearchBreakthrough(galaxy, player, equivalent, false, true, true);
                player.research.update(player.dominantRace);
                reviewDesignsBuiltObjectsImprovedComponents(player);
                player.reviewResearchAbilities();
                player.stateMoney -= related.value;
                sender.stateMoney += related.value;
                pirateEconomyPerformIncome(galaxy, sender, related.value, PirateIncomeType.SellInfo, galaxyStarDate(galaxy));
            }
        }
        result.ok = true;
    }
}

// Main.Part10.cs:4475-4499 DEAL_REJECT / DEAL_REJECTCOMPLAIN: the empire that made the threat carries it out. The C#
// runs `initiator.DeclareWar(empire)` on the list it read from the conversation's items (written for the player's own
// threats); for the other empire's threat the same effect is the sender acting on the player, exactly what
// tradeItems.ts processTradeDealMessage (Empire.3.cs 4378-4418) does when the AI's threat is refused.
function rejectDeal(galaxy: Galaxy, player: Empire, sender: Empire, related: ConversationRelated, result: ConversationReplyResult): void {
    if (!Array.isArray(related) || related.length < 2 || !Array.isArray(related[0]) || !Array.isArray(related[1])) return;
    const [offered, requested] = related as TradeableItem[][];
    if (requested.length === 0 || sender === player) return;
    if (sender.pirateEmpireBaseHabitat !== null || player.pirateEmpireBaseHabitat !== null) return;
    for (const item of offered) {
        if (item.type === TradeableItemType.ThreatenWar) {
            declareWar(galaxy, sender, player);
            result.expireFor = sender;
            result.ok = true;
        } else if (item.type === TradeableItemType.ThreatenTradeSanctions) {
            const current = obtainDiplomaticRelation(sender, player);
            changeDiplomaticRelation(galaxy, sender, current, DiplomaticRelationType.TradeSanctions);
            sendMessageToEmpire(sender, player, EmpireMessageType.DiplomaticRelationChange, DiplomaticRelationType.TradeSanctions, getText('We terminate all trade with you effective immediately!'));
            result.expireFor = sender;
            result.ok = true;
        }
    }
}

// Main.Part10.cs:4814 WAR_END_REQUESTOTHER_ACCEPT body (the pattern of WAR_END_ACCEPT, 4798) against `other`.
function endWarWith(galaxy: Galaxy, player: Empire, other: Empire): void {
    const now = galaxyStarDate(galaxy);
    const mine = obtainDiplomaticRelation(player, other);
    resetAttitudeLevelsAtEndOfWar(galaxy, mine);
    mine.type = DiplomaticRelationType.None;
    mine.lastDiplomacyTradeOfferDate = now;
    const theirs = obtainDiplomaticRelation(other, player);
    theirs.type = DiplomaticRelationType.None;
    theirs.lastDiplomacyTradeOfferDate = now;
    processEndOfWarWithEmpire(galaxy, player, other);
    processEndOfWarWithEmpire(galaxy, other, player);
}

/**
 * Main.Part10.cs:3957 method_237 for the replies to an incoming conversation (see the file header).
 * `related`: the conversation option's RelatedInfo (the message subject); `cost`: its Cost (the message's Money).
 */
export function answerConversationReply(
    galaxy: Galaxy,
    player: Empire,
    sender: Empire,
    part: ConversationReplyPart,
    related: ConversationRelated,
    cost: number,
): ConversationReplyResult {
    const result: ConversationReplyResult = { ok: false, noFunds: false, expireFor: null, history: null, reply: null, replyArgs: [] };
    switch (part) {
        case 'INFO_UNMETEMPIRE':
        case 'INFO_EXPLORATION':
        case 'INFO_INDEPENDENTCOLONY':
        case 'INFO_RUINS':
        case 'INFO_DEBRISFIELD':
        case 'INFO_PLANETDESTROYER':
        case 'INFO_RESTRICTEDAREA':
            buyInfo(galaxy, player, sender, part, related, cost, result);
            break;
        case 'DEAL_ACCEPT':
            acceptDeal(galaxy, player, sender, related, result);
            break;
        case 'DEAL_REJECT':
            rejectDeal(galaxy, player, sender, related, result);
            break;
        case 'MUTUALDEFENSE_HONORREQUESTHELP': {
            // Main.Part10.cs:4514: `empire_2` (the last RequestHonorMutualDefense subject) when RelatedInfo is not an Empire.
            const target = related as Empire | null;
            const ev = obtainEmpireEvaluation(galaxy, sender, player);
            ev.incidentEvaluation = ev.incidentEvaluationRaw + 30.0;
            setCivilityRating(player, player.civilityRating + 8.0);
            if (target !== null) {
                declareWar(galaxy, player, target, null, false, true);
                result.expireFor = target;
            }
            result.ok = true;
            break;
        }
        case 'MUTUALDEFENSE_DECLINEREQUESTHELP': {
            const ev = obtainEmpireEvaluation(galaxy, sender, player);
            ev.incidentEvaluation = ev.incidentEvaluationRaw - 30.0;
            setCivilityRating(player, player.civilityRating - 6.0);
            changeDiplomaticRelation(galaxy, sender, obtainDiplomaticRelation(sender, player), DiplomaticRelationType.None, true);
            result.expireFor = sender;
            result.ok = true;
            break;
        }
        case 'TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT': {
            const other = related as Empire | null;
            if (other === null) break;
            changeDiplomaticRelation(galaxy, player, obtainDiplomaticRelation(player, other), DiplomaticRelationType.None);
            removeProposals(player, other);
            result.ok = true;
            break;
        }
        case 'TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT': {
            const other = related as Empire | null;
            if (other === null) break;
            changeDiplomaticRelation(galaxy, player, obtainDiplomaticRelation(player, other), DiplomaticRelationType.TradeSanctions);
            const ev = obtainEmpireEvaluation(galaxy, sender, player);
            ev.incidentEvaluation = ev.incidentEvaluationRaw + 5.0;
            removeProposals(player, other);
            result.ok = true;
            break;
        }
        case 'WAR_DECLARE_REQUESTJOINT_ACCEPT': {
            const other = related as Empire | null;
            if (other === null) break;
            declareWar(galaxy, player, other);
            const ev = obtainEmpireEvaluation(galaxy, sender, player);
            ev.incidentEvaluation = ev.incidentEvaluationRaw + 10.0;
            removeProposals(player, other);
            result.expireFor = other;
            result.ok = true;
            break;
        }
        case 'WAR_END_REQUESTOTHER_ACCEPT': {
            const other = related as Empire | null;
            if (other === null) break;
            endWarWith(galaxy, player, other);
            result.expireFor = other;
            result.ok = true;
            break;
        }
        case 'WAR_END_ACCEPT': {
            // Main.Part10.cs:4798: the WAR_END conversation's "We agree - this war ends now" (Main.Part9.cs:500) — also
            // the answer to an AI's SubjugateRequest (Empire.8.cs 1527), whose ProposeDiplomaticRelation message names
            // DiplomaticRelationType.None and so opens WAR_END (Main.Part9.cs:1723). Ours acts only while the war is on.
            if (obtainDiplomaticRelation(player, sender).type !== DiplomaticRelationType.War) break;
            endWarWith(galaxy, player, sender);
            result.expireFor = sender;
            result.ok = true;
            if (galaxy.scenario !== null) scenarioEmit(galaxy, 'peaceSigned', { empire: player, other: sender }); // mod layer, as acceptProposal
            break;
        }
        case 'HISTORY_OFFER_LOCATIONHINT_ACCEPT': {
            // Main.Part10.cs:4988: method_234(HISTORY_LOCATIONHINT); method_241 then shows its text (method_230, Main.Part10.cs
            // 3844: string.Format(dialog, Galaxy.CheckForStoryLocationHint()) — which adds the player's location hint).
            result.replyArgs = [checkForStoryLocationHint(galaxy)];
            result.ok = true;
            break;
        }
        case 'HISTORY_OFFER_STORYCLUE_ACCEPT': {
            // Main.Part10.cs:4994 (method_571 shows the text; the GalacticHistory message keeps it).
            const clue = generateBuiltObjectStoryClue(galaxy, null as unknown as BuiltObject);
            const raceName = sender.dominantRace?.name ?? '';
            const title = getText('Reveal Historical Secret').replace('{0}', raceName);
            const text = `${getText('Reveal Historical Secret Details').replace('{0}', raceName)}\n\n${clue}`;
            sendHistory(player, title, text);
            result.history = { title, text };
            result.ok = true;
            break;
        }
        case 'HISTORY_OFFER_STORYMESSAGE_ACCEPT': {
            // Main.Part10.cs:5013.
            const level = galaxy.storyReturnOfTheShakturiEventLevel;
            const body = generateMajorStoryItem(level);
            const raceName = sender.dominantRace?.name ?? '';
            let title = getText('RACE Share Important Warning').replace('{0}', raceName);
            if (level === 2) title = getText('Ancient Guardians Reveal All');
            else if (level === 3) title = getText("The Shakturi have Returned for Revenge!");
            else if (level === 4) title = getText("The Galaxy's Last Hope");
            let text = '';
            if (raceName.toLowerCase() !== 'mechanoid' && sender.dominantRace !== galaxy.shakturiActualRace) {
                text += getText(level >= 2 ? 'The RACE tell us an important message' : 'The RACE tell us an important message Threat').replace('{0}', raceName);
                text += '\n\n';
            }
            text += body;
            if (level === 0 || level === 1 || level === 3 || level === 4) galaxy.storyReturnOfTheShakturiEventLevel++;
            sendHistory(player, title, text);
            result.history = { title, text, storyLevel: level };
            result.ok = true;
            break;
        }
    }
    conversationReplyPart(galaxy, player, sender, part, related, result);
    return result;
}

/** Main.Part10.cs:3966 method_231 → 4999 method_236: the greeting by `empire`'s overall attitude to `initiator`
 *  (< -10 angry, > 10 friendly). `galaxy` null: read without obtaining the evaluation (the UI's text-only replies; no
 *  evaluation counts as neutral); otherwise ObtainEmpireEvaluation, as the C#. */
export function attitudeGreeting(galaxy: Galaxy | null, empire: Empire, initiator: Empire): DialogPartType {
    const ev = galaxy !== null ? obtainEmpireEvaluation(galaxy, empire, initiator) : empireEvaluationByEmpire(empireEvaluationsOf(empire), initiator);
    const v = ev?.overallAttitude ?? 0;
    return v < -10 ? 'GREETING_ANGRY' : v > 10 ? 'GREETING_FRIENDLY' : 'GREETING_NEUTRAL';
}

/** The reply part (method_237's method_234) and its method_230 arguments for an answered option. */
function conversationReplyPart(galaxy: Galaxy, player: Empire, sender: Empire, part: ConversationReplyPart, related: ConversationRelated, result: ConversationReplyResult): void {
    const set = (reply: DialogPartType | null, args: string[] = []): void => {
        result.reply = reply;
        result.replyArgs = args;
    };
    if (result.noFunds) {
        set('INFO_NOFUNDS');
        return;
    }
    if (!result.ok) return;
    switch (part) {
        case 'INFO_UNMETEMPIRE':
        case 'INFO_EXPLORATION':
        case 'INFO_INDEPENDENTCOLONY':
        case 'INFO_RUINS':
        case 'INFO_DEBRISFIELD':
        case 'INFO_PLANETDESTROYER':
        case 'INFO_RESTRICTEDAREA': {
            const subject = Array.isArray(related) ? galaxyLocationAt(galaxy, related as number[]) : related;
            set(part, infoReplyArgs(galaxy, part, subject as Empire | Habitat | GalaxyLocation | null));
            return;
        }
        case 'DEAL_ACCEPT':
            // 4391-4448: a list deal → DEAL_ACCEPT_RESPONSE; a single map / tech item → method_236's greeting.
            set(related instanceof TradeableItem ? attitudeGreeting(galaxy, sender, player) : 'DEAL_ACCEPT_RESPONSE');
            return;
        case 'DEAL_REJECT':
            set('DEAL_REJECT_RESPONSE');
            return;
        case 'MUTUALDEFENSE_HONORREQUESTHELP':
            set('MUTUALDEFENSE_HONORREQUESTHELP_RESPONSE');
            return;
        case 'MUTUALDEFENSE_DECLINEREQUESTHELP':
            set('MUTUALDEFENSE_DECLINEREQUESTHELP_RESPONSE');
            return;
        case 'TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT':
        case 'TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT':
        case 'WAR_DECLARE_REQUESTJOINT_ACCEPT':
        case 'WAR_END_REQUESTOTHER_ACCEPT':
            set('TREATY_ACCEPTRESPONSE');
            return;
        case 'WAR_END_ACCEPT':
            set('WAR_END_ACCEPT_RESPONSE');
            return;
        case 'HISTORY_OFFER_LOCATIONHINT_ACCEPT':
            set('HISTORY_LOCATIONHINT', result.replyArgs);
            return;
        default:
            // HISTORY_OFFER_*_ACCEPT: Main.Part9.cs:731 method_241 shows no reply (the history dialog instead).
            set(null);
            return;
    }
}

/** Galaxy.5.cs 4851 GenerateLocationDescription(habitat): "Location Planet" (type, category, name, system, sector). */
export function generateHabitatLocationDescription(galaxy: Galaxy, habitat: Habitat): string {
    const star = galaxy.determineHabitatSystemStar(habitat) ?? habitat;
    return getText('Location Planet')
        .replace('{0}', resolveDescription(HabitatType as unknown as Record<number, string>, habitat.type).toLowerCase())
        .replace('{1}', resolveDescription(HabitatCategoryType as unknown as Record<number, string>, habitat.category).toLowerCase())
        .replace('{2}', habitat.name)
        .replace('{3}', star.name)
        .replace('{4}', resolveSectorDescription(galaxy, habitat.xpos, habitat.ypos));
}

/** Main.Part10.cs:3590 method_230, the INFO_* cases: the string.Format arguments of the bought information's text. */
export function infoReplyArgs(galaxy: Galaxy, part: DialogPartType, subject: Empire | Habitat | GalaxyLocation | null): string[] {
    switch (part) {
        case 'INFO_UNMETEMPIRE':
            return [(subject as Empire | null)?.name ?? ''];
        case 'INFO_EXPLORATION': {
            if (!(subject instanceof Habitat)) return [];
            return [subject.name, resolveSectorDescription(galaxy, subject.xpos, subject.ypos)];
        }
        case 'INFO_INDEPENDENTCOLONY':
            return subject instanceof Habitat ? [generateHabitatLocationDescription(galaxy, subject)] : [];
        case 'INFO_RUINS': {
            if (!(subject instanceof Habitat)) return [];
            const name = subject.ruin != null ? subject.ruin.name : getText('Ancient Ruins');
            return [name, generateHabitatLocationDescription(galaxy, subject)];
        }
        case 'INFO_DEBRISFIELD':
        case 'INFO_PLANETDESTROYER':
        case 'INFO_RESTRICTEDAREA': {
            if (!(subject instanceof GalaxyLocation)) return [];
            const system = galaxy.fastFindNearestSystem(subject.xpos, subject.ypos);
            return [system !== null ? system.name : getText('unknown'), resolveSectorDescription(galaxy, subject.xpos, subject.ypos)];
        }
        default:
            return [];
    }
}

// EmpireMessage(player, GalacticHistory, null) with SupressPopup, sent to the player (Main.Part10.cs:5002-5009).
function sendHistory(player: Empire, title: string, text: string): void {
    const message = new EmpireMessage(player, EmpireMessageType.GalacticHistory, null);
    message.description = text.replace(/\n/g, ' ');
    message.title = title;
    message.supressPopup = true;
    sendEmpireMessage(message, player);
}
