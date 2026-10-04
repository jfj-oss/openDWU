// M4a: empire messages (tasks/M4-plan.md §2.4, §3.3 row M4a).
// Ports of EmpireMessageType.cs, EmpireMessage.cs, IMessageRecipient.cs and the
// Empire.SendMessageToEmpire overloads (Empire.7.cs 2916-2960). The queue is Empire.Messages
// (empire.ts `messages`); the UI reads it later (or attaches an IMessageRecipient). No Rnd.
//
// Galaxy.ResolveDescription(enum) (Galaxy.2.cs per-enum overloads) is `resolveDescription`: the GameText text of the
// member for the enums in enumText.ts, else the enum member name.

import type { Empire } from './empire';
import type { Galaxy } from './galaxy';
import { BuiltObject } from './builtObject';
import { Habitat, HabitatCategoryType, HabitatType } from './types';
import { Empire as EmpireClass, registerShipBasePurchasedMessageSender } from './empire';
import { galaxyStarDate } from './tick/simTime';
import { netSort } from './netSort';
import * as ET from './enumText';
import { resolveEnumTextDescription, type EnumText } from './enumText';
import { CharacterRole, CharacterSkillType, CharacterTraitType } from './characters';
import { CharacterTraitType as RaceCharacterTraitType } from './data/races';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { DisasterEventType, RaceEventType } from './eventTypes';
import { DiplomaticRelationType } from './diplomacy';

// EmpireMessageType.cs (enum, declaration order = values).
export enum EmpireMessageType {
    Undefined, DiplomaticRelationChange, ProposeDiplomaticRelation, AcceptDiplomaticRelation, RefuseDiplomaticRelation,
    RemoveColoniesFromSystem, StopMissionsAgainstUs, StopAttacks, LeaveSystem, RequestJointWar, RequestJointTradeSanctions,
    RequestStopWar, RequestLiftTradeSanctions, GiveGift, Informational, ShipBaseCompleted, ShipBasePurchased, NewColony,
    NewColonyFailed, ResearchBreakthrough, BattleUnderAttack, BattleAttacking, IncomingEnemyFleet, CharacterAppearance,
    CharacterDeath, CharacterMissionAccomplished, CharacterMissionFailure, EmpireDiscovered, ColonyGained, ColonyLost,
    ColonyDefended, ColonyRebelling, EmpireDefeated, RequestHonorMutualDefense, BlockadeInitiated, BlockadeCancelled,
    ExplorationRuins, ExplorationBuiltObject, ExplorationHabitat, ExplorationLocation, GalacticHistory, SellInfoUnmetEmpire,
    SellInfoIndependentColony, SellInfoSystemMap, SellInfoRuins, SellInfoDebrisField, SellInfoRestrictedArea,
    SellInfoPlanetDestroyer, PirateOfferProtection, CancelPirateProtection, Revolution, RestrictedResourceDiscovered,
    RestrictedResourceTradingAllowed, RestrictedResourceTradingBlocked, OfferTrade, ShipMissionComplete, ShipNeedsRefuelling,
    ShipNeedsRepair, RemoveForcesFromSystem, GeneralWarning, GeneralBadEvent, GeneralNeutralEvent, GeneralGoodEvent,
    GeneralDecision, HistoryOfferLocationHint, HistoryOfferStoryClue, ColonyFacilityCompleted, ColonyFacilityCancelled,
    ColonyWonderBegun, ColonyShipMissionCancelled, StoryMessage, AdvisorSuggestion, ColonyDestroyed, MilitaryRefuelingAllowed,
    MilitaryRefuelingBlocked, MiningRightsAllowed, MiningRightsBlocked, CharacterSkillTraitChange, ResearchCriticalBreakthrough,
    ResearchCriticalFailure, GalacticNewsNet, ShipBaseBoardedCaptured, ShipBaseBoardedLost, PirateAttackMissionAvailable,
    PirateAttackMissionCompleted, PirateAttackMissionFailed, PirateDefendMissionFailed, PirateDefendMissionAvailable,
    PirateDefendMissionCompleted, PirateSmugglingMissionAvailable, PirateSmugglingMissionCompleted, PirateSmugglerDetected,
    PlanetaryFacilityDestroyed, ShipBaseScrapped, ConstructionResourceShortage, RaidBonuses, RaidVictim, PlanetaryFacilityDamaged,
}

/** System.Drawing.Point (Point.Empty = {0, 0}). */
export interface Point {
    x: number;
    y: number;
}

/** IMessageRecipient.cs. */
export interface IMessageRecipient {
    receiveMessage(message: EmpireMessage): void;
}

function isPoint(o: unknown): o is Point {
    return typeof o === 'object' && o !== null && !Array.isArray(o) && Object.keys(o).length === 2 && typeof (o as Point).x === 'number' && typeof (o as Point).y === 'number';
}

// EmpireMessage.cs. The C# keeps one typed slot per subject class (SetSubject, `subject is T`) and the
// Subject getter returns the first non-null slot in a fixed priority order. The TS keeps the slots
// whose classes exist in the port (Habitat, BuiltObject, Empire, Point) and one `otherSubject` slot
// for the rest. TODO(port) M4b..M4u: split `otherSubject` into the remaining typed slots
// (IntelligenceMission, Race, BuiltObjectList, ShipGroup, Character, DiplomaticRelationType,
// Component, GalaxyLocation, Resource, TradeableItem, object[], HabitatType, FighterSpecification,
// PlanetaryFacilityDefinition, PlanetaryFacility, ResearchNode, EmpireActivity) as their owners land.
export class EmpireMessage {
    description = '';
    messageType: EmpireMessageType;
    priority = 0;
    sender: Empire | null;
    money = 0;
    advisorMessageType = 0;
    advisorMessageData: unknown = null;
    advisorMessageData2: unknown = null;
    hint = '';
    title = '';
    starDate = 0;
    supressPopup = false;
    /**
     * Not in the C#: the stable id of a queued advisor suggestion (Empire.nextAdvisorSuggestionId; set when it joins
     * Empire.advisorSuggestions, advisorQueue.ts). Only queued suggestions carry the field, so other messages save as
     * before. Commands name a suggestion by it (player/commandCodec.ts 'advid').
     */
    declare advisorSuggestionId?: number;
    private habitatSubject: Habitat | null = null;
    private builtObjectSubject: BuiltObject | null = null;
    private empireSubject: Empire | null = null;
    private pointSubject: Point = { x: 0, y: 0 };
    private otherSubject: unknown = null;

    // EmpireMessage(sender, messageType, subject).
    constructor(sender: Empire | null, messageType: EmpireMessageType, subject: unknown) {
        this.sender = sender;
        this.messageType = messageType;
        this.priority = 0;
        this.money = 0;
        this.description = '';
        this.setSubject(subject);
    }

    // SetSubject(object subject).
    private setSubject(subject: unknown): void {
        if (subject instanceof Habitat) this.habitatSubject = subject;
        else if (subject instanceof BuiltObject) this.builtObjectSubject = subject;
        else if (subject instanceof EmpireClass) this.empireSubject = subject;
        else if (isPoint(subject)) this.pointSubject = { x: subject.x, y: subject.y };
        else if (subject !== null && subject !== undefined) this.otherSubject = subject;
    }

    /** Location (the Point subject slot). */
    get location(): Point {
        return this.pointSubject;
    }

    // C# Point is a struct: the message keeps its own copy. Holding the caller's object aliased every message sent with a
    // shared constant (diplomacyTick.ts NO_POINT, civilianAI.ts POINT_EMPTY), so a save of a game that had been loaded
    // encoded those messages differently from the game that kept running (the 2026-10-04 soak's save → load check).
    set location(value: Point) {
        this.pointSubject = { x: value.x, y: value.y };
    }

    // Subject getter: C# priority order among the kept slots (… Empire, Habitat, BuiltObject, …, Point).
    get subject(): unknown {
        if (this.empireSubject !== null) return this.empireSubject;
        if (this.habitatSubject !== null) return this.habitatSubject;
        if (this.builtObjectSubject !== null) return this.builtObjectSubject;
        if (this.otherSubject !== null) return this.otherSubject;
        return this.pointSubject.x !== 0 || this.pointSubject.y !== 0 ? this.pointSubject : null;
    }

    set subject(value: unknown) {
        this.setSubject(value);
    }

    // ResolveTargetEmpireFromSubject (kept slots only; later slots override earlier ones as in the C#).
    resolveTargetEmpireFromSubject(): Empire | null {
        let empire: Empire | null = null;
        if (this.habitatSubject !== null) empire = this.habitatSubject.empire;
        if (this.builtObjectSubject !== null) empire = this.builtObjectSubject.empire;
        if (this.empireSubject !== null) empire = this.empireSubject;
        return empire;
    }
}

/** Empire.Messages as the typed queue (empire.ts declares it `unknown[]`). */
export function empireMessages(empire: Empire): EmpireMessage[] {
    return empire.messages as EmpireMessage[];
}

// Empire.7.cs 2916-2944: SendMessageToEmpire(recipient, type, subject, description[, location][, hint][, title]).
// C# sets no StarDate here; EmpireMessage.StarDate stays 0 unless a caller assigns it.
export function sendMessageToEmpire(
    sender: Empire | null,
    recipientEmpire: Empire | null,
    messageType: EmpireMessageType,
    subject: unknown,
    description: string,
    location: Point = { x: 0, y: 0 },
    messageHint = '',
    title = '',
): void {
    const empireMessage = new EmpireMessage(sender, messageType, subject);
    empireMessage.description = description;
    empireMessage.title = title;
    empireMessage.location = location;
    empireMessage.hint = messageHint;
    sendEmpireMessage(empireMessage, recipientEmpire);
}

// Empire.7.cs 1429 (AddBuiltObjectToGalaxy): the purchase message, registered with empire.ts (see there).
registerShipBasePurchasedMessageSender((empire, builtObject, description) => {
    sendMessageToEmpire(empire, empire, EmpireMessageType.ShipBasePurchased, builtObject, description);
});

// Empire.7.cs 2921 SendMessageToEmpireWithTitle(recipient, type, subject, description, title).
export function sendMessageToEmpireWithTitle(sender: Empire | null, recipientEmpire: Empire | null, messageType: EmpireMessageType, subject: unknown, description: string, title: string): void {
    sendMessageToEmpire(sender, recipientEmpire, messageType, subject, description, { x: 0, y: 0 }, '', title);
}

/**
 * Mod layer (19p event log, scenario/eventLog/log.ts): an observer of every delivered empire message. Not a port — the
 * C# has no such slot. The event log registers it on import and returns at once unless its scenario flag is on; it
 * only reads the message and never touches sim state or galaxy.rnd.
 */
export type EmpireMessageTap = (message: EmpireMessage, recipientEmpire: Empire) => void;
// `var` without an initializer: the event log may register while this module is still evaluating (an import cycle
// through scenario/messages.ts), so the slot must exist (hoisted, undefined) and must not be reset afterwards.
// eslint-disable-next-line no-var
var empireMessageTap: EmpireMessageTap | null | undefined;
export function setEmpireMessageTap(tap: EmpireMessageTap | null): void {
    empireMessageTap = tap;
}

// ---------------------------------------------------------------------------------------------------------------
// The player's inbox (playerMessages.ts processes it)
// ---------------------------------------------------------------------------------------------------------------

/** One Empire.SendEventMessageToEmpire call (events.ts), as Main.ReceiveEventMessage queued it. */
export interface QueuedEvent {
    type: number;
    title: string;
    message: string;
    additionalData: unknown;
    location: unknown;
}

/** What the player's inbox holds, in arrival order: a message, an event, or an authorization prompt (an advisor suggestion). */
export type PlayerInboxItem =
    | { message: EmpireMessage; event?: undefined; prompt?: undefined }
    | { message?: undefined; event: QueuedEvent; prompt?: undefined }
    | { message?: undefined; event?: undefined; prompt: EmpireMessage };

/**
 * The C# Main is the player's IMessageRecipient / IEventMessageRecipient (Main.Part12.cs:2881) and queues every call
 * for its UI thread (Main.Part9.cs 1535 ReceiveMessage / Main.Part4.cs:481 ReceiveEventMessage → BeginInvoke), which
 * then handles them one by one, in arrival order (ReceiveMessageInternal / method_523). The port keeps that queue in
 * the sim: SendMessageToEmpire / SendEventMessageToEmpire / PromptPlayerForAuthorization append to the player's inbox, and the sim drains it at fixed
 * points (playerMessages.ts processPlayerMessages: the end of every frame, after every applied command), so the
 * handling is part of the deterministic, replayable game. Per game run state, never saved: it is empty whenever a game
 * is saved (serializeGame drains it first). Attached for galaxy.playerEmpire (playerMessages.ts ensurePlayerInbox).
 */
const playerInboxes = new WeakMap<Empire, PlayerInboxItem[]>();

/** Start (or with false stop) collecting `empire`'s messages and events in its inbox. Idempotent. */
export function attachPlayerInbox(empire: Empire, on = true): void {
    if (!on) playerInboxes.delete(empire);
    else if (!playerInboxes.has(empire)) playerInboxes.set(empire, []);
}

/** `empire`'s inbox (undefined: none attached). */
export function playerInbox(empire: Empire): PlayerInboxItem[] | undefined {
    return playerInboxes.get(empire);
}

// Empire.7.cs 2946-2959 SendMessageToEmpire(EmpireMessage message, Empire recipientEmpire).
export function sendEmpireMessage(message: EmpireMessage, recipientEmpire: Empire | null): void {
    if (recipientEmpire !== null && empireMessageTap != null) empireMessageTap(message, recipientEmpire); // 19p (mod layer)
    if (recipientEmpire !== null) {
        if (recipientEmpire.messages !== null) {
            recipientEmpire.messages.push(message);
        }
        // _MessageRecipient.ReceiveMessage: the player's Main queues it (the inbox above).
        playerInboxes.get(recipientEmpire)?.push({ message });
        if (recipientEmpire.messageRecipient != null) {
            recipientEmpire.messageRecipient.receiveMessage(message);
        }
    }
}

/** EmpireMessage.cs 261 IComparable<EmpireMessage>.CompareTo: by StarDate. */
function compareEmpireMessages(a: EmpireMessage, b: EmpireMessage): number {
    return a.starDate < b.starDate ? -1 : a.starDate > b.starDate ? 1 : 0;
}

/** Empire.MessageHistory as the typed list (empire.ts declares it `unknown[]`). */
export function empireMessageHistory(empire: Empire): EmpireMessage[] {
    return empire.messageHistory as EmpireMessage[];
}

/**
 * Empire.cs 4697 AddHistoryMessage(message). The C# UI calls it for every player message it shows except
 * Informational ones (Main.Part9.cs 1508-1517).
 */
export function addHistoryMessage(empire: Empire, message: EmpireMessage): void {
    const history = empireMessageHistory(empire);
    if (!history.includes(message)) history.push(message);
}

/** Empire.cs 4708 RemoveOldHistoryMessages: keeps the newest _MaximumHistoryMessages (GalacticHistory ones always). */
export function removeOldHistoryMessages(empire: Empire): void {
    const history = empireMessageHistory(empire);
    if (history.length <= empire.maximumHistoryMessages) return;
    netSort(history, compareEmpireMessages);
    history.reverse();
    const empireMessageList: EmpireMessage[] = [];
    for (let i = empire.maximumHistoryMessages; i < history.length; i++) {
        if (history[i].messageType !== EmpireMessageType.GalacticHistory) empireMessageList.push(history[i]);
    }
    for (let j = 0; j < empireMessageList.length; j++) {
        const index = history.indexOf(empireMessageList[j]);
        if (index >= 0) history.splice(index, 1);
    }
}

/** Convenience for callers that stamp messages with Galaxy.CurrentStarDate (C# callers assign StarDate themselves). */
export function stampStarDate(galaxy: Galaxy, message: EmpireMessage): EmpireMessage {
    message.starDate = galaxyStarDate(galaxy);
    return message;
}

/** The enums whose Galaxy.2.cs ResolveDescription overload is ported (enumText.ts). Built on first use: the enum modules
 *  import this one. */
let enumTexts: Map<object, EnumText> | null = null;
function enumTextTable(enumType: object): EnumText | undefined {
    if (enumTexts === null) {
        enumTexts = new Map<object, EnumText>([
            [CharacterTraitType, ET.CHARACTER_TRAIT],
            [RaceCharacterTraitType, ET.CHARACTER_TRAIT],
            [CharacterSkillType, ET.CHARACTER_SKILL],
            [CharacterRole, ET.CHARACTER_ROLE],
            [BuiltObjectSubRole, ET.BUILT_OBJECT_SUB_ROLE],
            [DisasterEventType, ET.DISASTER_EVENT],
            [DiplomaticRelationType, ET.DIPLOMATIC_RELATION],
            [HabitatCategoryType, ET.HABITAT_CATEGORY],
            [HabitatType, ET.HABITAT_TYPE],
            [RaceEventType, ET.RACE_EVENT],
        ]);
    }
    return enumTexts.get(enumType);
}

/**
 * Galaxy.2.cs ResolveDescription(enum value) (one overload per enum): the GameText text of the member (enumText.ts;
 * `enumType[value]` is the C# member name). An enum without a ported overload yields its member name.
 */
export function resolveDescription(enumType: Record<number, string>, value: number): string {
    const table = enumTextTable(enumType);
    if (table !== undefined) return resolveEnumTextDescription(table, enumType[value]);
    return enumType[value] ?? String(value);
}

// Empire.7.cs 3400 SendEventMessageToEmpire: events.ts.
