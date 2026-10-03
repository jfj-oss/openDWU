// Task 16d: routing of the player's EmpireMessages. Port of the Main.Part9.cs:1572 ReceiveMessageInternal
// routing, the Game.DisplayPopup*/DisplayMessage* options (Game.cs:71-127) and their defaults
// (Main.Part9.cs:2711 method_260). Pure: no DOM.
// TODO(port): message sounds (EffectsPlayer.ResolveMessage / ResolveImportantMessage)
// TODO(port): advisor-suggestion queue entries (DialogPartType.Undefined, Main.Part9.cs:2226)
// TODO(port): RestrictedResourceTrading* / PirateOfferProtection description rewrites (Main.Part9.cs:2075-2137)
// TODO(port): save the Display* options with the game (Game.cs) — session-only here

import { EmpireMessage, EmpireMessageType } from '../sim/messages';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { DiplomaticRelationType } from '../sim/diplomacy';
import { AutomationLevel, type Empire } from '../sim/empire';
import { TradeableItem, TradeableItemType } from '../sim/tradeItems';
import { GameEndEventArgs, GameEndOutcome } from '../sim/victory';
import { totalColonyStrategicValue } from '../sim/forceStructure';
import { getText } from '../sim/textResolver';

/** Game.cs:71-127: the DisplayPopup<Cat> / DisplayMessage<Cat> categories, in declaration order. */
export enum MessageCategory {
    BuiltObjectBuilt,
    DiplomacyGift,
    DiplomacyTreaty,
    DiplomacyWarTradeSanctions,
    DiplomacyEmpireMetDestroyed,
    DiplomacyRequestWarning,
    NewColony,
    ColonyInvaded,
    ResearchNewComponent,
    IntelligenceMissions,
    Exploration,
    ShipMissionComplete,
    ShipNeedsRefuelling,
    ConstructionResourceShortage,
    UnderAttackCivilianShips,
    UnderAttackCivilianBases,
    UnderAttackExplorationShips,
    UnderAttackColonyConstructionShips,
    UnderAttackMilitaryShips,
    UnderAttackOtherStateBases,
    UnderAttackColoniesSpaceportsDefensiveBases,
}

const CATEGORY_COUNT = 21;

/** The DialogPartType members ReceiveMessageInternal starts a conversation with (Main.Part9.cs:1580-2346). */
export type DialogPartType =
    | 'CANCELTREATY'
    | 'TRADESANCTIONS_LIFT'
    | 'TRADESANCTIONS_IMPOSE'
    | 'TRADESANCTIONS_REQUESTIMPOSEJOINT'
    | 'TRADESANCTIONS_REQUESTLIFTOTHER'
    | 'WAR_END'
    | 'WAR_END_ACCEPT'
    | 'WAR_END_REJECT'
    | 'WAR_END_SUBJUGATIONDEMAND'
    | 'WAR_END_REQUESTOTHER'
    | 'WAR_DECLARE'
    | 'WAR_DECLARE_REQUESTJOINT'
    | 'SUBJUGATION_RELEASE'
    | 'SUBJUGATION_REQUESTRELEASE'
    | 'SUBJUGATION_REFUSERELEASE'
    | 'SUBJUGATIONDEMAND_ACCEPT'
    | 'SUBJUGATIONDEMAND_REJECT'
    | 'FREETRADE_ACCEPT'
    | 'FREETRADE_REJECT'
    | 'MUTUALDEFENSE_ACCEPT'
    | 'MUTUALDEFENSE_REJECT'
    | 'MUTUALDEFENSE_REQUESTHELP'
    | 'PROTECTORATE_ACCEPT'
    | 'PROTECTORATE_REJECT'
    | 'OFFER_FREETRADE'
    | 'OFFER_MUTUALDEFENSE'
    | 'OFFER_PROTECTORATE'
    | 'WARNING_INTELLIGENCEMISSIONS'
    | 'WARNING_ATTACKS'
    | 'WARNING_REMOVEFORCESSYSTEM'
    | 'WARNING_GENERAL'
    | 'GIFT_GIVE'
    | 'INFO_OFFER_UNMETEMPIRE'
    | 'INFO_OFFER_INDEPENDENTCOLONY'
    | 'INFO_OFFER_SYSTEMMAPS'
    | 'INFO_OFFER_RUINS'
    | 'INFO_OFFER_DEBRISFIELD'
    | 'INFO_OFFER_RESTRICTEDAREA'
    | 'INFO_OFFER_PLANETDESTROYER'
    | 'PIRATE_EXTORTPROTECTION'
    | 'PIRATE_PROTECTIONPROPOSEINITIATE'
    | 'PIRATE_TRUCEPROPOSEINITIATE'
    | 'CANCELPIRATEPROTECTION'
    | 'CANCELPIRATEPROTECTIONPIRATE'
    | 'DEAL_THREAT'
    | 'DEAL_OFFER'
    | 'DEAL_DEMAND'
    | 'OFFER_DEAL_COMPONENT'
    | 'OFFER_DEAL_TERRITORYMAP'
    | 'OFFER_DEAL_GALAXYMAP'
    | 'HISTORY_OFFER_LOCATIONHINT'
    | 'HISTORY_OFFER_STORYCLUE'
    | 'HISTORY_OFFER_STORYMESSAGE';

// Main.Part9.cs:2360-2368: these open the conversation dialog at once (method_254) instead of queueing.
export const IMMEDIATE_CONVERSATIONS: ReadonlySet<DialogPartType> = new Set<DialogPartType>([
    'DEAL_DEMAND',
    'DEAL_THREAT',
    'MUTUALDEFENSE_REQUESTHELP',
    'WAR_DECLARE',
    'WAR_END',
    'PIRATE_EXTORTPROTECTION',
]);

export interface MessageOptions {
    popup: Record<MessageCategory, boolean>;
    ticker: Record<MessageCategory, boolean>;
    suppressAllPopups: boolean;
}

function allCategories(value: boolean): Record<MessageCategory, boolean> {
    const r = {} as Record<MessageCategory, boolean>;
    for (let c = 0; c < CATEGORY_COUNT; c++) r[c as MessageCategory] = value;
    return r;
}

// Port of Main.Part9.cs:2711 method_260: every DisplayMessage* and DisplayPopup* true, except three popups.
export function defaultMessageOptions(): MessageOptions {
    const popup = allCategories(true);
    popup[MessageCategory.BuiltObjectBuilt] = false;
    popup[MessageCategory.ShipMissionComplete] = false;
    popup[MessageCategory.ShipNeedsRefuelling] = false;
    return { popup, ticker: allCategories(true), suppressAllPopups: false };
}

let options: MessageOptions = defaultMessageOptions();

/** The session's message options (Game.DisplayPopup* / DisplayMessage* / SuppressAllPopups). */
export function getMessageOptions(): MessageOptions {
    return options;
}

export function setMessageOption(kind: 'popup' | 'ticker', category: MessageCategory, value: boolean): void {
    options[kind][category] = value;
}

export function setSuppressAllPopups(v: boolean): void {
    options.suppressAllPopups = v;
}

export function resetMessageOptions(): void {
    options = defaultMessageOptions();
}

/** Take over another thread's options (the sim worker mirrors the main thread's Game Options, messagePipeline.ts). */
export function replaceMessageOptions(o: MessageOptions): void {
    options = { popup: { ...o.popup }, ticker: { ...o.ticker }, suppressAllPopups: o.suppressAllPopups === true };
}

export interface MessageClassification {
    category: MessageCategory | null;
    /** Explicit `bool_` set by the case (null: left to method_252). */
    popup: boolean | null;
    /** Explicit `bool_2` set by the case (null: left to method_252). */
    ticker: boolean | null;
    conversation: DialogPartType | null;
    drop: boolean;
}

function cls(
    category: MessageCategory | null,
    conversation: DialogPartType | null = null,
    popup: boolean | null = null,
    ticker: boolean | null = null,
): MessageClassification {
    return { category, popup, ticker, conversation, drop: false };
}

/** A case that sets neither method_252 nor bool_/bool_2: no popup, no ticker. */
const NOTHING = (): MessageClassification => cls(null, null, false, false);

const Cat = MessageCategory;
const Rel = DiplomaticRelationType;

// Main.Part9.cs:2253-2310: BattleUnderAttack / ShipBaseBoarded* by the BuiltObject's SubRole.
function underAttackCategory(subRole: BuiltObjectSubRole): MessageCategory | null {
    switch (subRole) {
        case BuiltObjectSubRole.Escort:
        case BuiltObjectSubRole.Frigate:
        case BuiltObjectSubRole.Destroyer:
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
        case BuiltObjectSubRole.TroopTransport:
        case BuiltObjectSubRole.Carrier:
        case BuiltObjectSubRole.ResupplyShip:
            return Cat.UnderAttackMilitaryShips;
        case BuiltObjectSubRole.ExplorationShip:
            return Cat.UnderAttackExplorationShips;
        case BuiltObjectSubRole.ColonyShip:
        case BuiltObjectSubRole.ConstructionShip:
            return Cat.UnderAttackColonyConstructionShips;
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
        case BuiltObjectSubRole.PassengerShip:
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.MiningShip:
            return Cat.UnderAttackCivilianShips;
        case BuiltObjectSubRole.GasMiningStation:
        case BuiltObjectSubRole.MiningStation:
            return Cat.UnderAttackCivilianBases;
        case BuiltObjectSubRole.ResortBase:
        case BuiltObjectSubRole.GenericBase:
        case BuiltObjectSubRole.EnergyResearchStation:
        case BuiltObjectSubRole.WeaponsResearchStation:
        case BuiltObjectSubRole.HighTechResearchStation:
        case BuiltObjectSubRole.MonitoringStation:
            return Cat.UnderAttackOtherStateBases;
        case BuiltObjectSubRole.SmallSpacePort:
        case BuiltObjectSubRole.MediumSpacePort:
        case BuiltObjectSubRole.LargeSpacePort:
        case BuiltObjectSubRole.DefensiveBase:
            return Cat.UnderAttackColoniesSpaceportsDefensiveBases;
        default:
            return null;
    }
}

// Port of Main.Part9.cs:1586-1693 (DiplomaticRelationChange).
function classifyRelationChange(message: EmpireMessage, subject: DiplomaticRelationType, player: Empire | null): MessageClassification {
    switch (subject) {
        case Rel.None: {
            const rel = relationOf(message, player);
            if (rel === null) return cls(Cat.DiplomacyTreaty);
            switch (rel.type) {
                case Rel.TradeSanctions:
                    return cls(Cat.DiplomacyWarTradeSanctions, 'TRADESANCTIONS_LIFT');
                case Rel.War:
                    return cls(Cat.DiplomacyWarTradeSanctions, 'WAR_END');
                case Rel.Truce:
                    return cls(Cat.DiplomacyWarTradeSanctions);
                default: {
                    const hint = message.hint.toLowerCase();
                    if (hint.includes('trade sanctions')) return cls(Cat.DiplomacyWarTradeSanctions, 'TRADESANCTIONS_LIFT');
                    if (hint.includes('war')) return cls(Cat.DiplomacyWarTradeSanctions, 'WAR_END');
                    if (hint.includes('free trade') || hint.includes('mutual defense') || hint.includes('protectorate')) {
                        return cls(Cat.DiplomacyWarTradeSanctions, 'CANCELTREATY');
                    }
                    if (hint.includes('subjugated')) return cls(Cat.DiplomacyWarTradeSanctions, 'SUBJUGATION_RELEASE');
                    return cls(Cat.DiplomacyTreaty, 'CANCELTREATY');
                }
            }
        }
        case Rel.FreeTradeAgreement:
            return cls(Cat.DiplomacyTreaty, 'FREETRADE_ACCEPT');
        case Rel.MutualDefensePact:
            return cls(Cat.DiplomacyTreaty, 'MUTUALDEFENSE_ACCEPT');
        case Rel.SubjugatedDominion:
            return cls(Cat.DiplomacyWarTradeSanctions, 'SUBJUGATIONDEMAND_ACCEPT');
        case Rel.Protectorate:
            return cls(Cat.DiplomacyTreaty, 'PROTECTORATE_ACCEPT');
        case Rel.TradeSanctions:
            return cls(Cat.DiplomacyWarTradeSanctions, 'TRADESANCTIONS_IMPOSE');
        case Rel.War:
            return cls(Cat.DiplomacyWarTradeSanctions, 'WAR_DECLARE');
        case Rel.Truce:
            return cls(Cat.DiplomacyWarTradeSanctions);
        default:
            return NOTHING();
    }
}

// Port of Main.Part9.cs:1694-1772 (ProposeDiplomaticRelation).
function classifyPropose(message: EmpireMessage, subject: DiplomaticRelationType, player: Empire | null): MessageClassification {
    switch (subject) {
        case Rel.None: {
            const rel = relationOf(message, player);
            if (rel === null) return cls(Cat.DiplomacyTreaty);
            switch (rel.type) {
                case Rel.SubjugatedDominion:
                    return cls(
                        Cat.DiplomacyWarTradeSanctions,
                        rel.initiator !== player ? 'SUBJUGATION_RELEASE' : 'SUBJUGATION_REQUESTRELEASE',
                    );
                case Rel.TradeSanctions:
                    return cls(Cat.DiplomacyWarTradeSanctions, 'TRADESANCTIONS_LIFT');
                case Rel.War:
                    return cls(Cat.DiplomacyWarTradeSanctions, 'WAR_END');
                case Rel.Truce:
                    return cls(Cat.DiplomacyWarTradeSanctions);
                default:
                    return cls(Cat.DiplomacyTreaty, 'CANCELTREATY');
            }
        }
        case Rel.FreeTradeAgreement:
            return cls(Cat.DiplomacyTreaty, 'OFFER_FREETRADE');
        case Rel.MutualDefensePact:
            return cls(Cat.DiplomacyTreaty, 'OFFER_MUTUALDEFENSE');
        case Rel.SubjugatedDominion:
            return cls(Cat.DiplomacyWarTradeSanctions, 'WAR_END_SUBJUGATIONDEMAND');
        case Rel.Protectorate:
            return cls(Cat.DiplomacyTreaty, 'OFFER_PROTECTORATE');
        case Rel.TradeSanctions:
            return cls(Cat.DiplomacyWarTradeSanctions, 'TRADESANCTIONS_IMPOSE');
        case Rel.War:
            return cls(Cat.DiplomacyWarTradeSanctions, 'WAR_DECLARE');
        case Rel.Truce:
            return cls(Cat.DiplomacyWarTradeSanctions);
        default:
            return NOTHING();
    }
}

// Port of Main.Part9.cs:1773-1838 (AcceptDiplomaticRelation).
function classifyAccept(message: EmpireMessage, subject: DiplomaticRelationType): MessageClassification {
    switch (subject) {
        case Rel.None:
            return cls(
                Cat.DiplomacyWarTradeSanctions,
                message.description.toLowerCase().includes('subjugation') ? 'SUBJUGATION_RELEASE' : 'WAR_END_ACCEPT',
            );
        case Rel.FreeTradeAgreement:
            return cls(Cat.DiplomacyTreaty, 'FREETRADE_ACCEPT');
        case Rel.MutualDefensePact:
            return cls(Cat.DiplomacyTreaty, 'MUTUALDEFENSE_ACCEPT');
        case Rel.SubjugatedDominion:
            return cls(Cat.DiplomacyWarTradeSanctions, 'SUBJUGATIONDEMAND_ACCEPT');
        case Rel.Protectorate:
            return cls(Cat.DiplomacyTreaty, 'PROTECTORATE_ACCEPT');
        case Rel.TradeSanctions:
            return cls(Cat.DiplomacyWarTradeSanctions, 'TRADESANCTIONS_IMPOSE');
        case Rel.War:
            return cls(Cat.DiplomacyWarTradeSanctions, 'WAR_DECLARE');
        case Rel.Truce:
            return cls(Cat.DiplomacyWarTradeSanctions);
        default:
            return NOTHING();
    }
}

// Port of Main.Part9.cs:1839-1917 (RefuseDiplomaticRelation).
function classifyRefuse(message: EmpireMessage, subject: DiplomaticRelationType, player: Empire | null): MessageClassification {
    switch (subject) {
        case Rel.None: {
            const rel = relationOf(message, player);
            if (rel === null) return cls(Cat.DiplomacyTreaty);
            switch (rel.type) {
                case Rel.SubjugatedDominion:
                    return cls(Cat.DiplomacyWarTradeSanctions, 'SUBJUGATION_REFUSERELEASE');
                case Rel.TradeSanctions:
                    return cls(Cat.DiplomacyWarTradeSanctions, 'TRADESANCTIONS_LIFT');
                case Rel.War:
                    return cls(Cat.DiplomacyWarTradeSanctions, 'WAR_END_REJECT');
                case Rel.Truce:
                    return cls(Cat.DiplomacyWarTradeSanctions);
                default:
                    return cls(Cat.DiplomacyTreaty, 'CANCELTREATY');
            }
        }
        case Rel.FreeTradeAgreement:
            return cls(Cat.DiplomacyTreaty, 'FREETRADE_REJECT');
        case Rel.MutualDefensePact:
            return cls(Cat.DiplomacyTreaty, 'MUTUALDEFENSE_REJECT');
        case Rel.SubjugatedDominion:
            return cls(Cat.DiplomacyWarTradeSanctions, 'SUBJUGATIONDEMAND_REJECT');
        case Rel.Protectorate:
            return cls(Cat.DiplomacyTreaty, 'PROTECTORATE_REJECT');
        case Rel.TradeSanctions:
            return cls(Cat.DiplomacyWarTradeSanctions, 'TRADESANCTIONS_IMPOSE');
        case Rel.War:
            return cls(Cat.DiplomacyWarTradeSanctions, 'WAR_DECLARE');
        case Rel.Truce:
            return cls(Cat.DiplomacyWarTradeSanctions);
        default:
            return NOTHING();
    }
}

/** `PlayerEmpire.DiplomaticRelations[message.Sender]` (null sender → null; fakes without a list → null). */
function relationOf(message: EmpireMessage, player: Empire | null) {
    if (message.sender === null) return null;
    return player?.diplomaticRelations?.byEmpire(message.sender) ?? null;
}

// Port of Main.Part9.cs:2138-2170 (OfferTrade).
function classifyOfferTrade(subject: unknown): MessageClassification {
    if (Array.isArray(subject)) {
        const offered = (subject[0] ?? []) as TradeableItem[];
        const requested = (subject[1] ?? []) as TradeableItem[];
        let conv: DialogPartType;
        if (requested.some((t) => t.type === TradeableItemType.ThreatenWar || t.type === TradeableItemType.ThreatenTradeSanctions)) {
            conv = 'DEAL_THREAT';
        } else {
            conv = offered.length !== 0 ? 'DEAL_OFFER' : 'DEAL_DEMAND';
        }
        return cls(null, conv, false, true);
    }
    if (subject instanceof TradeableItem) {
        let conv: DialogPartType;
        switch (subject.type) {
            case TradeableItemType.ResearchProject:
                conv = 'OFFER_DEAL_COMPONENT';
                break;
            case TradeableItemType.GalaxyMap:
                conv = 'OFFER_DEAL_GALAXYMAP';
                break;
            default:
                conv = 'OFFER_DEAL_TERRITORYMAP';
                break;
        }
        return cls(null, conv, false, true);
    }
    return NOTHING();
}

// Port of the Main.Part9.cs:1580-2346 ReceiveMessageInternal switch (category via method_252, bool_/bool_2
// overrides and the ConversationOption DialogPartType).
export function classifyEmpireMessage(message: EmpireMessage, player: Empire | null): MessageClassification {
    const T = EmpireMessageType;
    const subject = message.subject;
    switch (message.messageType) {
        case T.DiplomaticRelationChange:
            return typeof subject === 'number' ? classifyRelationChange(message, subject, player) : NOTHING();
        case T.ProposeDiplomaticRelation:
            return typeof subject === 'number' ? classifyPropose(message, subject, player) : NOTHING();
        case T.AcceptDiplomaticRelation:
            return typeof subject === 'number' ? classifyAccept(message, subject) : NOTHING();
        case T.RefuseDiplomaticRelation:
            return typeof subject === 'number' ? classifyRefuse(message, subject, player) : NOTHING();
        case T.StopMissionsAgainstUs:
            return cls(Cat.DiplomacyRequestWarning, 'WARNING_INTELLIGENCEMISSIONS');
        case T.StopAttacks:
            return cls(Cat.DiplomacyRequestWarning, 'WARNING_ATTACKS');
        case T.RemoveColoniesFromSystem:
        case T.LeaveSystem:
            return cls(Cat.DiplomacyRequestWarning);
        case T.RequestJointWar:
        case T.RequestJointTradeSanctions:
        case T.RequestStopWar:
        case T.RequestLiftTradeSanctions: {
            // Main.Part9.cs:1930-1957
            let conv: DialogPartType | null = null;
            if (player?.controlDiplomacyOffense !== AutomationLevel.FullyAutomated) {
                conv =
                    message.messageType === T.RequestJointWar
                        ? 'WAR_DECLARE_REQUESTJOINT'
                        : message.messageType === T.RequestJointTradeSanctions
                          ? 'TRADESANCTIONS_REQUESTIMPOSEJOINT'
                          : message.messageType === T.RequestStopWar
                            ? 'WAR_END_REQUESTOTHER'
                            : 'TRADESANCTIONS_REQUESTLIFTOTHER';
            }
            return cls(Cat.DiplomacyRequestWarning, conv);
        }
        case T.GiveGift:
            // The C# UI then applies the gift; the TS sim's processMessages already does (not repeated here).
            return cls(Cat.DiplomacyGift, 'GIFT_GIVE');
        case T.Informational:
            return cls(null, null, false, true);
        case T.ShipBasePurchased:
            return { ...cls(null), drop: true };
        case T.NewColony:
        case T.NewColonyFailed:
            return cls(Cat.NewColony);
        case T.BattleAttacking:
            return cls(Cat.DiplomacyRequestWarning);
        case T.IncomingEnemyFleet:
            return cls(Cat.UnderAttackColoniesSpaceportsDefensiveBases);
        case T.EmpireDiscovered:
        case T.EmpireDefeated:
            return cls(Cat.DiplomacyEmpireMetDestroyed);
        case T.RequestHonorMutualDefense:
            return cls(Cat.DiplomacyWarTradeSanctions, 'MUTUALDEFENSE_REQUESTHELP');
        case T.BlockadeInitiated:
        case T.BlockadeCancelled:
            return cls(Cat.DiplomacyWarTradeSanctions);
        case T.ExplorationRuins:
        case T.ExplorationBuiltObject:
        case T.ExplorationHabitat:
        case T.ExplorationLocation:
        case T.GalacticHistory:
            return cls(Cat.Exploration);
        case T.SellInfoUnmetEmpire:
            return cls(null, 'INFO_OFFER_UNMETEMPIRE', false, true);
        case T.SellInfoIndependentColony:
            return cls(null, 'INFO_OFFER_INDEPENDENTCOLONY', false, true);
        case T.SellInfoSystemMap:
            return cls(null, 'INFO_OFFER_SYSTEMMAPS', false, true);
        case T.SellInfoRuins:
            return cls(null, 'INFO_OFFER_RUINS', false, true);
        case T.SellInfoDebrisField:
            return cls(null, 'INFO_OFFER_DEBRISFIELD', false, true);
        case T.SellInfoRestrictedArea:
            return cls(null, 'INFO_OFFER_RESTRICTEDAREA', false, true);
        case T.SellInfoPlanetDestroyer:
            return cls(null, 'INFO_OFFER_PLANETDESTROYER', false, true);
        case T.PirateOfferProtection:
            // Main.Part9.cs:2075. The C# price is CalculatePirateProtectionPricePerMonth, whose TS port calls
            // obtainPirateRelation (a render-time write), so the message's money stands in.
            if (message.hint.toLowerCase() === 'extort') return cls(Cat.DiplomacyTreaty, 'PIRATE_EXTORTPROTECTION', true, true);
            return cls(null, message.money > 0 ? 'PIRATE_PROTECTIONPROPOSEINITIATE' : 'PIRATE_TRUCEPROPOSEINITIATE', false, true);
        case T.CancelPirateProtection:
            return cls(
                null,
                message.sender === null || message.sender.pirateEmpireBaseHabitat == null ? 'CANCELPIRATEPROTECTION' : 'CANCELPIRATEPROTECTIONPIRATE',
                false,
                true,
            );
        case T.Revolution:
            return cls(Cat.ColonyInvaded);
        case T.RestrictedResourceDiscovered:
        case T.RestrictedResourceTradingAllowed:
        case T.RestrictedResourceTradingBlocked:
            return cls(Cat.Exploration);
        case T.OfferTrade:
            return classifyOfferTrade(subject);
        case T.ShipMissionComplete:
            return cls(Cat.ShipMissionComplete);
        case T.ShipNeedsRefuelling:
        case T.ShipNeedsRepair:
            return cls(Cat.ShipNeedsRefuelling);
        case T.RemoveForcesFromSystem:
            return cls(Cat.DiplomacyRequestWarning, 'WARNING_REMOVEFORCESSYSTEM', false, true);
        case T.GeneralWarning:
            return cls(Cat.DiplomacyRequestWarning, 'WARNING_GENERAL', false, true);
        case T.GeneralBadEvent:
        case T.GeneralNeutralEvent:
        case T.GeneralGoodEvent:
        case T.GeneralDecision:
            return cls(Cat.Exploration);
        case T.HistoryOfferLocationHint:
            return cls(null, 'HISTORY_OFFER_LOCATIONHINT', false, true);
        case T.HistoryOfferStoryClue:
            return cls(null, 'HISTORY_OFFER_STORYCLUE', false, true);
        case T.StoryMessage:
            return cls(null, 'HISTORY_OFFER_STORYMESSAGE', false, true);
        case T.ColonyFacilityCompleted:
        case T.ColonyFacilityCancelled:
        case T.ColonyWonderBegun:
        case T.ColonyShipMissionCancelled:
            return cls(Cat.NewColony);
        case T.AdvisorSuggestion:
            return { ...cls(null, null, false, false), drop: true };
        case T.MilitaryRefuelingAllowed:
        case T.MilitaryRefuelingBlocked:
        case T.MiningRightsAllowed:
        case T.MiningRightsBlocked:
            return cls(Cat.DiplomacyTreaty);
        case T.CharacterAppearance:
        case T.CharacterDeath:
        case T.CharacterMissionAccomplished:
        case T.CharacterMissionFailure:
        case T.CharacterSkillTraitChange:
            return cls(Cat.IntelligenceMissions);
        case T.ResearchBreakthrough:
        case T.ResearchCriticalBreakthrough:
        case T.ResearchCriticalFailure:
            return cls(Cat.ResearchNewComponent);
        case T.GalacticNewsNet:
            return cls(Cat.DiplomacyTreaty);
        case T.BattleUnderAttack:
        case T.ShipBaseBoardedCaptured:
        case T.ShipBaseBoardedLost: {
            if (subject instanceof BuiltObject) {
                const c = underAttackCategory(subject.subRole);
                return c === null ? NOTHING() : cls(c);
            }
            if (subject instanceof Habitat) return cls(Cat.UnderAttackColoniesSpaceportsDefensiveBases);
            return NOTHING();
        }
        case T.PirateAttackMissionAvailable:
        case T.PirateAttackMissionCompleted:
        case T.PirateAttackMissionFailed:
        case T.PirateDefendMissionAvailable:
        case T.PirateDefendMissionCompleted:
        case T.PirateDefendMissionFailed:
        case T.PirateSmugglingMissionAvailable:
        case T.PirateSmugglingMissionCompleted:
            return cls(Cat.DiplomacyRequestWarning);
        case T.PirateSmugglerDetected:
            return cls(Cat.UnderAttackColoniesSpaceportsDefensiveBases);
        case T.ShipBaseCompleted:
        case T.ShipBaseScrapped:
            return cls(Cat.BuiltObjectBuilt);
        case T.ConstructionResourceShortage:
            return cls(Cat.ConstructionResourceShortage);
        case T.RaidBonuses:
        case T.RaidVictim:
            return cls(Cat.ColonyInvaded);
        case T.ColonyGained:
        case T.ColonyLost:
        case T.ColonyDefended:
        case T.ColonyRebelling:
        case T.ColonyDestroyed:
        case T.PlanetaryFacilityDestroyed:
        case T.PlanetaryFacilityDamaged:
            return cls(Cat.ColonyInvaded);
        default:
            // Main.Part9.cs `default:` → bool_2 = true.
            return cls(null, null, null, true);
    }
}

export interface MessageRoute {
    category: MessageCategory | null;
    popup: boolean;
    ticker: boolean;
    conversation: DialogPartType | null;
    immediate: boolean;
}

// Port of Main.Part9.cs:1521 method_252 + the ReceiveMessageInternal tail (Main.Part9.cs:2349-2415).
export function routeEmpireMessage(message: EmpireMessage, player: Empire | null, opts: MessageOptions): MessageRoute {
    const c = classifyEmpireMessage(message, player);
    if (c.drop) return { category: null, popup: false, ticker: false, conversation: null, immediate: false };
    // method_252 runs first; the case's explicit bool_ / bool_2 sets come after it.
    let popup = c.category !== null && opts.popup[c.category];
    let ticker = c.category !== null && opts.ticker[c.category];
    if (c.popup !== null) popup = c.popup;
    if (c.ticker !== null) ticker = c.ticker;
    let immediate = false;
    if (c.conversation !== null) {
        popup = false;
        ticker = true;
        immediate = IMMEDIATE_CONVERSATIONS.has(c.conversation);
    }
    popup = popup && !message.supressPopup;
    return { category: c.category, popup, ticker, conversation: c.conversation, immediate };
}

// Main.Part9.cs:2356-2370: queue the conversation, open it now (method_254), or drop an immediate one when
// SuppressAllPopups is on.
export function shouldQueueConversation(route: MessageRoute, opts: MessageOptions): 'queue' | 'open' | 'none' {
    if (route.conversation === null) return 'none';
    if (route.immediate) return opts.suppressAllPopups ? 'none' : 'open';
    return 'queue';
}

/**
 * Main.Part9.cs 1994-2020 ReceiveMessageInternal, case EmpireDefeated: when the defeated empire (the message subject) is
 * the player's, the game ends in defeat; the victor is the remaining empire with the highest TotalColonyStrategicValue
 * (strictly greater than 0, first wins ties), in Galaxy.Empires order. Returns the Galaxy_GameEnd args, or null when the
 * message is not the player's own defeat. No Rnd.
 */
export function playerDefeatGameEnd(message: EmpireMessage, player: Empire | null, empires: readonly Empire[]): GameEndEventArgs | null {
    if (message.messageType !== EmpireMessageType.EmpireDefeated) return null;
    const subject = message.subject as Empire | null;
    if (subject === null || player === null || subject !== player) return null;
    let victorEmpire: Empire | null = null;
    let num2 = 0;
    for (let j = 0; j < empires.length; j++) {
        const empire3 = empires[j];
        const value = totalColonyStrategicValue(empire3);
        if (value > num2) {
            victorEmpire = empire3;
            num2 = value;
        }
    }
    return new GameEndEventArgs(victorEmpire, GameEndOutcome.Defeat, getText('Your empire has been completely wiped out!'), 0);
}
