// suggest — the player's advisor-suggestion queue: the AdvisorSuggestion entries of the C# DiplomaticMessageQueue
// (DistantWorlds/DiplomaticMessageQueue.cs), kept on the player empire so they are saved with the game.
//
// C# flow: Empire.8.cs 4395 CheckTaskAuthorized (SemiAutomated, player) → Empire.7.cs 3836 PromptPlayerForAuthorization
// → Main.Part9.cs 1053 PromptForAuthorizationInternal = diplomaticMessageQueue_0.AddMessage(message) +
// ExpireInvalidMessages(message). The BuildOrder suggestion (Empire.6.cs 2754) is sent with SendMessageToEmpire instead
// and reaches the same queue through Main.Part9.cs 2226 ReceiveMessageInternal (case AdvisorSuggestion) — the player's
// message pipeline (playerMessages.ts) calls `receiveAdvisorSuggestionMessage` for it. An entry leaves the queue when the player approves / declines it
// (Main.Part2.cs 1369 / 2732 RemoveMessage), when a newer equivalent suggestion replaces it (ExpireInvalidMessages), when
// a diplomacy exchange with its target empire expires it (ExpireDiplomacyMessagesForEmpire) or when it is older than
// 250 × RealSecondsInGalacticYear (DiplomaticMessageQueue.cs 671 method_3).
//
// Headless, no Rnd. The BuildOrder advice joins the queue in the sim tick (playerMessages.ts, the player's message
// pipeline); nothing else in the tick reads the queue.

import type { Empire } from './empire';
import { EmpireMessage, EmpireMessageType } from './messages';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from './galaxyTime';

// AdvisorMessageType.cs (byte enum; member order exact). Declared here (not in diplomacyTick.ts, which re-exports it)
// so the queue does not import the diplomacy runtime.
export enum AdvisorMessageType {
    Undefined,
    BuildOrder,
    BuildOneOff,
    Colonization,
    IntelligenceMission,
    EnemyAttack,
    EnemyBombard,
    EnemyBlockade,
    EnemyAttackPlanetDestroyer,
    InvadeIndependent,
    PrepareRaid,
    DiplomaticGift,
    TreatyOffer,
    WarTradeSanctions,
    ColonyFacility,
    OfferMilitaryRefueling,
    CancelMilitaryRefueling,
    OfferMiningRights,
    CancelMiningRights,
    AllowTradeRestrictedResources,
    DisallowTradeRestrictedResources,
    ComplyTradeSanctionsOther,
    ComplyWarOther,
    DefendTerritory,
    Retrofit,
    RequestLiftTradeSanctionsOther,
    RequestEndWarOther,
    OfferPirateAttackMission,
    OfferPirateDefendMission,
    OfferPirateSmuggleMission,
    PirateRaid,
    PirateFacilityEradicate,
    AcceptPirateSmugglingMission,
    DefendTarget,
}

/**
 * A PirateRelationType as EmpireMessage.AdvisorMessageData. The C# boxes the enum, so the approve handler can tell it from
 * a DiplomaticRelationType (Main.Part2.cs 1857 `is DiplomaticRelationType` / 1995 `is PirateRelationType`); in TS both
 * are numbers, so the pirate-protection suggestions (Empire.2.cs 2800-2870, pirateRelationsAI.ts) carry this box.
 * `pirateRelationType` is a PirateRelationType (pirateRelations.ts; not imported to keep this module light).
 */
export class BoxedPirateRelationType {
    constructor(readonly pirateRelationType: number) {}
}

/**
 * EmpireMessage.cs 86 ResolveTargetEmpireFromSubject over every subject class (messages.ts keeps typed slots only for
 * Habitat / BuiltObject / Empire): BuiltObjectList → its first ship's empire, ShipGroup / Character → their empire,
 * IntelligenceMission / pirate mission (EmpireActivity) → their TargetEmpire. Duck-typed on the one subject an advisor
 * message carries.
 */
export function resolveAdvisorTargetEmpire(m: EmpireMessage): Empire | null {
    const subject = m.subject as Record<string, unknown> | null;
    let empire = m.resolveTargetEmpireFromSubject();
    if (subject === null || typeof subject !== 'object') return empire;
    if (Array.isArray(subject)) {
        if (subject.length > 0 && subject[0] != null) empire = ((subject[0] as { empire?: Empire | null }).empire ?? null);
        return empire;
    }
    if (empire === null) {
        if ('targetEmpire' in subject) empire = (subject.targetEmpire as Empire | null) ?? null;
        else if ('empire' in subject) empire = (subject.empire as Empire | null) ?? null;
    }
    return empire;
}

/**
 * An advisor suggestion's Description: `string.Format(TextResolver.GetText(key), args)` kept in the colonyTick gameText
 * encoding "key|arg0|arg1|…" (the sim does not localise; textResolver.resolveGameText renders it for the window).
 * The automation texts of the other packages (militaryAI.ts, blockades.ts, empireConstruction.ts, pirate*.ts
 * GenerateAutomationMessage*) use diplomacyTick formatText(getText(key), …), which formats the GameText text now.
 */
export function advisorText(key: string, ...args: unknown[]): string {
    return args.length > 0 ? `${key}|${args.map((a) => String(a)).join('|')}` : key;
}

/** DiplomaticMessageQueue.cs 673: an entry older than 250 × Galaxy.RealSecondsInGalacticYear star-date units expires. */
export const ADVISOR_SUGGESTION_LIFETIME = 250 * REAL_SECONDS_IN_GALACTIC_YEAR;

/** The player's pending suggestions, oldest first (Empire.advisorSuggestions; a save from before the field reads as empty). */
export function advisorSuggestions(empire: Empire): EmpireMessage[] {
    if (!Array.isArray(empire.advisorSuggestions)) empire.advisorSuggestions = [];
    return empire.advisorSuggestions as EmpireMessage[];
}

const NO_SUGGESTIONS: readonly EmpireMessage[] = Object.freeze([]);

/** advisorSuggestions for a reader that must not write (the UI): never creates the list. */
export function advisorSuggestionsView(empire: Empire): readonly EmpireMessage[] {
    return Array.isArray(empire.advisorSuggestions) ? (empire.advisorSuggestions as EmpireMessage[]) : NO_SUGGESTIONS;
}

/**
 * Give a queued suggestion its stable id (EmpireMessage.advisorSuggestionId) from the empire's counter, unless it has
 * one. Not in the C# (its UI holds the object): commands name a suggestion by it (player/commandCodec.ts 'advid').
 */
export function assignAdvisorSuggestionId(empire: Empire, message: EmpireMessage): void {
    if (typeof message.advisorSuggestionId === 'number') return;
    if (typeof empire.nextAdvisorSuggestionId !== 'number' || !(empire.nextAdvisorSuggestionId >= 1)) empire.nextAdvisorSuggestionId = 1;
    message.advisorSuggestionId = empire.nextAdvisorSuggestionId++;
}

/** The queued suggestion of `empire` with stable id `id` (null: not queued, e.g. approved or expired since). */
export function findAdvisorSuggestion(empire: Empire, id: number): EmpireMessage | null {
    for (const m of advisorSuggestionsView(empire)) if (m != null && m.advisorSuggestionId === id) return m;
    return null;
}

/** The star date at which a queued suggestion expires (method_3: removed once StarDate < now − lifetime). */
export function advisorSuggestionExpiryDate(message: EmpireMessage): number {
    return message.starDate + ADVISOR_SUGGESTION_LIFETIME;
}

/** EmpireMessage.cs 82 CheckAdvisorMessageEquivalence(otherMessage). */
export function checkAdvisorMessageEquivalence(self: EmpireMessage, otherMessage: EmpireMessage | null): boolean {
    return (
        otherMessage != null &&
        self.messageType === EmpireMessageType.AdvisorSuggestion &&
        otherMessage.messageType === EmpireMessageType.AdvisorSuggestion &&
        otherMessage.subject === self.subject &&
        otherMessage.advisorMessageType === self.advisorMessageType &&
        otherMessage.advisorMessageData === self.advisorMessageData
    );
}

/** EmpireMessage.cs 84 CheckAdvisorMessageEquivalenceAbbreviated(otherMessage). */
export function checkAdvisorMessageEquivalenceAbbreviated(self: EmpireMessage, otherMessage: EmpireMessage | null): boolean {
    return (
        otherMessage != null &&
        self.messageType === EmpireMessageType.AdvisorSuggestion &&
        otherMessage.messageType === EmpireMessageType.AdvisorSuggestion &&
        otherMessage.subject === self.subject &&
        otherMessage.advisorMessageType === self.advisorMessageType
    );
}

/**
 * DiplomaticMessageQueue.cs 404 ExpireInvalidMessages(newMessage), AdvisorSuggestion cases (418-563): the queued
 * suggestions `newMessage` supersedes. (The other message types' cases concern diplomacy entries, which are not in this
 * queue.) Returns whether any entry was removed.
 */
export function expireInvalidAdvisorSuggestions(queue: EmpireMessage[], newMessage: EmpireMessage | null): boolean {
    let result = false;
    if (newMessage == null || newMessage.messageType !== EmpireMessageType.AdvisorSuggestion) return result;
    const T = AdvisorMessageType;
    for (let i = queue.length - 1; i >= 0; i--) {
        const empireMessage = queue[i];
        if (empireMessage === newMessage) continue;
        let flag = false;
        const t = empireMessage.advisorMessageType;
        switch (newMessage.advisorMessageType) {
            case T.BuildOrder:
                flag = t === newMessage.advisorMessageType;
                break;
            case T.BuildOneOff:
            case T.IntelligenceMission:
            case T.EnemyAttack:
            case T.EnemyBombard:
            case T.EnemyBlockade:
            case T.EnemyAttackPlanetDestroyer:
            case T.InvadeIndependent:
            case T.PrepareRaid:
            case T.ColonyFacility:
            case T.Retrofit:
            case T.PirateRaid:
            case T.PirateFacilityEradicate:
                flag = checkAdvisorMessageEquivalence(empireMessage, newMessage);
                break;
            case T.Colonization:
            case T.OfferPirateAttackMission:
            case T.OfferPirateDefendMission:
            case T.OfferPirateSmuggleMission:
            case T.AcceptPirateSmugglingMission:
            case T.DefendTarget:
                flag = checkAdvisorMessageEquivalenceAbbreviated(empireMessage, newMessage);
                break;
            case T.TreatyOffer:
            case T.WarTradeSanctions:
                flag = (t === T.TreatyOffer || t === T.WarTradeSanctions) && resolveAdvisorTargetEmpire(empireMessage) === resolveAdvisorTargetEmpire(newMessage);
                break;
            case T.OfferMilitaryRefueling:
            case T.CancelMilitaryRefueling:
                flag = t === T.OfferMilitaryRefueling || t === T.CancelMilitaryRefueling;
                break;
            case T.OfferMiningRights:
            case T.CancelMiningRights:
                flag = t === T.OfferMiningRights || t === T.CancelMiningRights;
                break;
            case T.AllowTradeRestrictedResources:
            case T.DisallowTradeRestrictedResources:
                flag = t === T.AllowTradeRestrictedResources || t === T.DisallowTradeRestrictedResources;
                break;
        }
        if (flag) {
            queue.splice(i, 1);
            result = true;
        }
    }
    return result;
}

/** Main.Part9.cs 1053 PromptForAuthorizationInternal: DiplomaticMessageQueue.AddMessage + ExpireInvalidMessages. */
export function addAdvisorSuggestion(empire: Empire, message: EmpireMessage): void {
    const queue = advisorSuggestions(empire);
    assignAdvisorSuggestionId(empire, message);
    queue.push(message);
    expireInvalidAdvisorSuggestions(queue, message);
}

/**
 * Main.Part9.cs 2226 ReceiveMessageInternal, case AdvisorSuggestion: a suggestion that arrived through Empire.Messages
 * (the BuildOrder advice, Empire.6.cs 2754) joins the queue. Idempotent per message. Returns whether it was added.
 */
export function receiveAdvisorSuggestionMessage(empire: Empire, message: EmpireMessage): boolean {
    if (message.messageType !== EmpireMessageType.AdvisorSuggestion) return false;
    const queue = advisorSuggestions(empire);
    if (queue.includes(message)) return false;
    addAdvisorSuggestion(empire, message);
    return true;
}

/** DiplomaticMessageQueue.cs 300 RemoveMessage(message). Returns whether it was queued. */
export function removeAdvisorSuggestion(empire: Empire, message: EmpireMessage): boolean {
    const queue = advisorSuggestions(empire);
    const i = queue.indexOf(message);
    if (i < 0) return false;
    queue.splice(i, 1);
    return true;
}

/** DiplomaticMessageQueue.cs 671 method_3(currentStarDate): drop suggestions older than the lifetime. Returns the count. */
export function expireOldAdvisorSuggestions(empire: Empire, currentStarDate: number): number {
    const num = currentStarDate - ADVISOR_SUGGESTION_LIFETIME;
    const queue = advisorSuggestions(empire);
    let removed = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i] != null && queue[i].starDate < num) {
            queue.splice(i, 1);
            removed++;
        }
    }
    return removed;
}

/**
 * DiplomaticMessageQueue.cs 344 ExpireDiplomacyMessagesForEmpire(empire), AdvisorSuggestion cases (357-380): the queued
 * suggestions of these types whose target empire (ResolveTargetEmpireFromSubject) is `empire`. Returns the count.
 */
export function expireAdvisorSuggestionsForEmpire(player: Empire, empire: Empire | null): number {
    if (empire == null) return 0;
    const T = AdvisorMessageType;
    const queue = advisorSuggestions(player);
    let removed = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
        const m = queue[i];
        switch (m.advisorMessageType) {
            case T.IntelligenceMission:
            case T.EnemyAttack:
            case T.EnemyBombard:
            case T.EnemyBlockade:
            case T.EnemyAttackPlanetDestroyer:
            case T.PrepareRaid:
            case T.DiplomaticGift:
            case T.TreatyOffer:
            case T.WarTradeSanctions:
            case T.OfferMilitaryRefueling:
            case T.CancelMilitaryRefueling:
            case T.OfferMiningRights:
            case T.CancelMiningRights:
            case T.AllowTradeRestrictedResources:
            case T.DisallowTradeRestrictedResources:
            case T.PirateRaid:
                if (resolveAdvisorTargetEmpire(m) === empire) {
                    queue.splice(i, 1);
                    removed++;
                }
                break;
        }
    }
    return removed;
}
