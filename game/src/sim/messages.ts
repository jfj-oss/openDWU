// M4a: empire messages (tasks/M4-plan.md §2.4, §3.3 row M4a).
// Ports of EmpireMessageType.cs, EmpireMessage.cs, IMessageRecipient.cs and the
// Empire.SendMessageToEmpire overloads (Empire.7.cs 2916-2960). The queue is Empire.Messages
// (empire.ts `messages`); the UI reads it later (or attaches an IMessageRecipient). No Rnd.
//
// Galaxy.ResolveDescription (Galaxy.1/2/3.cs, ~3,000 lines of enum → localized text) is stubbed
// as `resolveDescription`: it returns the enum member name (a GameText key stand-in). Full text is
// M9's job.

import type { Empire } from './empire';
import type { Galaxy } from './galaxy';
import { BuiltObject } from './builtObject';
import { Habitat } from './types';
import { Empire as EmpireClass } from './empire';
import { galaxyStarDate } from './tick/simTime';

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
        else if (isPoint(subject)) this.pointSubject = subject;
        else if (subject !== null && subject !== undefined) this.otherSubject = subject;
    }

    /** Location (the Point subject slot). */
    get location(): Point {
        return this.pointSubject;
    }

    set location(value: Point) {
        this.pointSubject = value;
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

// Empire.7.cs 2921 SendMessageToEmpireWithTitle(recipient, type, subject, description, title).
export function sendMessageToEmpireWithTitle(sender: Empire | null, recipientEmpire: Empire | null, messageType: EmpireMessageType, subject: unknown, description: string, title: string): void {
    sendMessageToEmpire(sender, recipientEmpire, messageType, subject, description, { x: 0, y: 0 }, '', title);
}

// Empire.7.cs 2946-2959 SendMessageToEmpire(EmpireMessage message, Empire recipientEmpire).
export function sendEmpireMessage(message: EmpireMessage, recipientEmpire: Empire | null): void {
    if (recipientEmpire !== null) {
        if (recipientEmpire.messages !== null) {
            recipientEmpire.messages.push(message);
        }
        if (recipientEmpire.messageRecipient !== null) {
            recipientEmpire.messageRecipient.receiveMessage(message);
        }
    }
}

/** Convenience for callers that stamp messages with Galaxy.CurrentStarDate (C# callers assign StarDate themselves). */
export function stampStarDate(galaxy: Galaxy, message: EmpireMessage): EmpireMessage {
    message.starDate = galaxyStarDate(galaxy);
    return message;
}

/**
 * Galaxy.ResolveDescription(enum value) stand-in (Galaxy.1/2/3.cs, many overloads): returns the enum
 * member name, used as a GameText key. TODO(port) M9: localized descriptions.
 */
export function resolveDescription(enumType: Record<number, string>, value: number): string {
    return enumType[value] ?? String(value);
}
