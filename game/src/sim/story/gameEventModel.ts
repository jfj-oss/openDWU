// M4z3 — scripted game-event model (the scenario editor's GameEvents and their EventActions). Ports of
// DistantWorlds.Types EventAction.cs, EventActionList.cs, EventActionExecutionPackage.cs, GameEvent.cs, GameEventList.cs and
// the byte enums EventActionType.cs, EventActionExecutionType.cs, EventTriggerType.cs, MultipleEventActionType.cs.
//
// A leaf module (type-only imports) so galaxy.ts can hold Galaxy.GameEvents / Galaxy.DelayedActions without an import
// cycle. The interpreter (CheckTriggerEvent → DoGameEvent → ExecuteOrDelayEventAction → ExecuteEventAction) is
// story/eventActions.ts.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import type { BuiltObject } from '../builtObject';
import type { Creature, CreatureType } from '../creature';
import type { Race } from '../data/races';
import type { GalaxyLocation } from '../galaxyLocation';
import type { Ruin } from '../ruins';
import type { Facility } from '../data/facilities';
import type { Character, CharacterRole } from '../characters';
import type { BuiltObjectSubRole } from '../builtObjectTypes';
import type { DiplomaticRelationType } from '../diplomacy';

/** C# StellarObject (EventAction.Target / GameEvent.TriggerObject): a Habitat, BuiltObject or Creature. */
export type EventStellarObject = Habitat | BuiltObject | Creature;

/** C# short.MinValue: StellarObject.GameEventId / Ruin.GameEventId default (StellarObject.cs 19, Ruin.cs 23). */
export const GAME_EVENT_ID_NONE = -32768;

/** C# `short` compound assignment wrap-around ((short)(x)). */
export function shortCast(value: number): number {
    return ((value << 16) >> 16);
}

// EventActionType.cs (byte enum; member order exact).
export enum EventActionType {
    Undefined,
    AcquireBuiltObject,
    AcquireHabitat,
    DestroyBuiltObject,
    FindMoneyTreasure,
    LearnExplorationInfo,
    LearnTech,
    UnlockTech,
    LearnGovernmentType,
    LearnAboutSpecialLocation,
    LearnAboutLostColony,
    SleepingRaceAwokenAtHabitat,
    SplitEmpirePeacefully,
    SplitEmpireCivilWar,
    EnemyFleetDefectsToTriggerEmpire,
    PirateFactionJoinsTriggerEmpire,
    EmpireDeclaresWarOnTriggerEmpire,
    ChangeEmpireGovernment,
    StartPlague,
    EndPlague,
    GenerateBuiltObject,
    GenerateCreatureSwarm,
    GeneratePirateAmbush,
    GenerateRefugeeFleet,
    GenerateNewEmpire,
    GenerateNewPirateFaction,
    GenerateErutkah,
    MakeEmpireContact,
    InterceptResource,
    GenerateResourceAtHabitat,
    RemoveResourceAtHabitat,
    DisasterAtColony,
    BuildPlanetaryFacility,
    DestroyPlanetaryFacility,
    RevealObject,
    ChangeRaceBias,
    ChangeEmpireReputation,
    ChangeEmpireEvaluation,
    InitiateTreaty,
    BreakTreaty,
    StartTradingSuperLuxuryResources,
    StopTradingSuperLuxuryResources,
    GeneralMessageToEmpire,
    EmpireMessageToEmpire,
    ResearchBonusInProject,
    UnlockTechForEmpire,
    EmpireDeclaresWarOnOtherEmpire,
    VictoryConditionBonus,
    SendFleetAttack,
    SendPlanetDestroyerAttack,
    IntergalacticConvoyMilitary,
    IntergalacticConvoyCivilian,
    CharacterGenerate,
    CharacterKill,
    CharacterChangeEmpire,
    CharacterChangeRole,
    CharacterChangeImage,
}

// EventActionExecutionType.cs (byte enum).
export enum EventActionExecutionType {
    Immediately,
    Delay,
    RandomDelay,
}

// EventTriggerType.cs (byte enum; member order exact).
export enum EventTriggerType {
    Undefined,
    Investigate,
    Destroy,
    Capture,
    Build,
    DiplomaticRelationChange,
    EmpireEncounter,
    ResearchBreakthrough,
    PlanetDestroyerConstructionCompleted,
    EmpireEliminated,
    CharacterAppears,
    CharacterKilled,
}

// MultipleEventActionType.cs (byte enum).
export enum MultipleEventActionType {
    ExecuteAllActions,
    ExecuteSingleRandomAction,
}

/** Runtime class tests for EventAction.ResolveValidActionTypes / GameEvent.ResolveValidTriggerTypes (`switch (targetObject)`). */
export interface StellarObjectKinds {
    isHabitat(o: unknown): boolean;
    isBuiltObject(o: unknown): boolean;
    isCreature(o: unknown): boolean;
}
let kinds: StellarObjectKinds | null = null;
/** Registered by story/eventActions.ts (it can import the runtime classes; this leaf module cannot). */
export function registerStellarObjectKinds(k: StellarObjectKinds): void {
    kinds = k;
}
function stellarKinds(): StellarObjectKinds {
    if (kinds === null) throw new Error('gameEventModel: registerStellarObjectKinds was not called (import story/eventActions)');
    return kinds;
}

/** EventAction.cs (Serializable). */
export class EventAction {
    type: EventActionType;
    target: EventStellarObject | null;
    builtObjectSubRole: BuiltObjectSubRole = 0 as BuiltObjectSubRole; // default(BuiltObjectSubRole) = Undefined
    techLevel = 0;
    moneyAmount = 0;
    value = -1;
    location: GalaxyLocation | null = null;
    race: Race | null = null;
    raceOther: Race | null = null;
    empire: Empire | null = null;
    empireOther: Empire | null = null;
    /** DiplomaticRelationType.None (EventAction.cs field initializer). */
    diplomaticRelationType: DiplomaticRelationType = 1 as DiplomaticRelationType;
    lockedAlliance = false;
    creatureType: CreatureType = 0 as CreatureType; // default(CreatureType) = Undefined
    messageTitle: string | null = null;
    messageText: string | null = null;
    imageFilename: string | null = null;
    allianceName: string | null = null;
    executionType: EventActionExecutionType = EventActionExecutionType.Immediately;
    /** long ExecutionDate = -1 (star date, game ms). */
    executionDate = -1;
    /** short DelayDaysMinimum / DelayDaysMaximum = -1. */
    delayDaysMinimum = -1;
    delayDaysMaximum = -1;
    character: Character | null = null;
    characterRole: CharacterRole = 0 as CharacterRole; // default(CharacterRole) = Undefined
    validActionTypes: EventActionType[] = [];

    /** EventAction.cs 45 EventAction(target, type). */
    constructor(target: EventStellarObject | null, type: EventActionType) {
        this.target = target;
        this.type = type;
        this.validActionTypes = resolveValidActionTypes(target);
    }
}

/** EventAction.cs 52 ResolveValidActionTypes(targetObject). No Rnd. */
export function resolveValidActionTypes(targetObject: EventStellarObject | null): EventActionType[] {
    const list: EventActionType[] = [];
    const T = EventActionType;
    if (targetObject === null) {
        list.push(
            T.ChangeEmpireGovernment, T.EmpireDeclaresWarOnTriggerEmpire, T.EndPlague, T.EnemyFleetDefectsToTriggerEmpire, T.FindMoneyTreasure,
            T.InterceptResource, T.LearnAboutSpecialLocation, T.LearnExplorationInfo, T.LearnGovernmentType, T.LearnTech, T.MakeEmpireContact,
            T.PirateFactionJoinsTriggerEmpire, T.SplitEmpireCivilWar, T.SplitEmpirePeacefully, T.UnlockTech, T.ChangeRaceBias, T.ChangeEmpireReputation,
            T.ChangeEmpireEvaluation, T.InitiateTreaty, T.BreakTreaty, T.StartTradingSuperLuxuryResources, T.StopTradingSuperLuxuryResources,
            T.GeneralMessageToEmpire, T.EmpireMessageToEmpire, T.ResearchBonusInProject, T.UnlockTechForEmpire, T.EmpireDeclaresWarOnOtherEmpire,
            T.VictoryConditionBonus, T.IntergalacticConvoyMilitary, T.IntergalacticConvoyCivilian, T.CharacterKill, T.CharacterChangeEmpire,
            T.CharacterChangeRole, T.CharacterChangeImage,
        );
    } else if (stellarKinds().isBuiltObject(targetObject)) {
        list.push(T.AcquireBuiltObject, T.DestroyBuiltObject, T.RevealObject, T.SendFleetAttack, T.CharacterGenerate);
    } else if (stellarKinds().isHabitat(targetObject)) {
        list.push(
            T.AcquireHabitat, T.BuildPlanetaryFacility, T.DestroyPlanetaryFacility, T.DisasterAtColony, T.EndPlague, T.GenerateBuiltObject,
            T.GenerateCreatureSwarm, T.GenerateNewEmpire, T.GenerateNewPirateFaction, T.GeneratePirateAmbush, T.GenerateRefugeeFleet,
            T.GenerateResourceAtHabitat, T.LearnAboutLostColony, T.RemoveResourceAtHabitat, T.SleepingRaceAwokenAtHabitat, T.StartPlague,
            T.RevealObject, T.SendFleetAttack, T.SendPlanetDestroyerAttack, T.CharacterGenerate,
        );
    }
    return list;
}

/** EventActionList.cs: List<EventAction> + ExecutionType. */
export class EventActionList {
    items: EventAction[] = [];
    executionType: MultipleEventActionType = MultipleEventActionType.ExecuteAllActions;
    get count(): number {
        return this.items.length;
    }
}

/** GameEvent.cs (Serializable). */
export class GameEvent {
    gameEventId: number;
    triggerType: EventTriggerType = EventTriggerType.Undefined;
    actions: EventActionList | null = new EventActionList();
    triggerObject: EventStellarObject | null;
    triggerRuin: Ruin | null;
    triggerFacility: Facility | null = null;
    triggerBuiltObjectSubRole: BuiltObjectSubRole = 0 as BuiltObjectSubRole;
    empire: Empire | null = null;
    empireOther: Empire | null = null;
    /** DiplomaticRelationType.None. */
    diplomaticRelationType: DiplomaticRelationType = 1 as DiplomaticRelationType;
    researchProjectId = -1;
    title = '';
    description = '';
    canOnlyBeTriggeredByPlayer = false;
    hasBeenTriggered = false;
    character: Character | null = null;
    validTriggerTypes: EventTriggerType[] = [];

    /** GameEvent.cs 38/44 GameEvent(galaxy, gameEventId, triggerObject[, triggerRuin]). */
    constructor(galaxy: Galaxy | null, gameEventId: number, triggerObject: EventStellarObject | null, triggerRuin: Ruin | null = null) {
        this.gameEventId = gameEventId;
        this.triggerObject = triggerObject;
        this.triggerRuin = triggerRuin;
        this.validTriggerTypes = resolveValidTriggerTypes(this.triggerObject, this.triggerRuin);
        // C# `ValidTriggerTypes[0]` (a Creature/null list is never empty; an unknown object type would throw).
        if (this.validTriggerTypes.length === 0) throw new Error('GameEvent.cs 52: ValidTriggerTypes[0] out of range');
        this.triggerType = this.validTriggerTypes[0];
        setDefaultsForEvent(this, this.triggerType, galaxy);
    }
}

/** GameEvent.cs 56 SetDefaultsForEvent(triggerType, galaxy). No Rnd. */
export function setDefaultsForEvent(self: GameEvent, triggerType: EventTriggerType, galaxy: Galaxy | null): void {
    if (galaxy === null || self.triggerObject !== null) return;
    const empires = galaxy.empires;
    switch (triggerType) {
        case EventTriggerType.DiplomaticRelationChange:
            if (empires == null || empires.length <= 1) break;
            self.empire = empires[0];
            self.empireOther = empires[1];
            self.diplomaticRelationType = 2 as DiplomaticRelationType; // FreeTradeAgreement
            break;
        case EventTriggerType.EmpireEncounter:
            if (empires == null || empires.length <= 0) break;
            self.empire = empires[0];
            // C# Empires[1] with Count == 1 throws ArgumentOutOfRange.
            if (empires.length < 2) throw new Error('GameEvent.cs 73: Empires[1] out of range');
            self.empireOther = empires[1];
            break;
        case EventTriggerType.ResearchBreakthrough:
            if (empires == null || empires.length <= 0) break;
            self.empire = empires[0];
            self.researchProjectId = 0;
            break;
        case EventTriggerType.PlanetDestroyerConstructionCompleted:
            if (empires == null || empires.length <= 0) break;
            self.empire = empires[0];
            break;
        case EventTriggerType.EmpireEliminated:
            if (empires != null && empires.length > 0) self.empire = empires[0];
            self.empireOther = null;
            break;
        case EventTriggerType.CharacterAppears:
            // Race.AvailableCharacters is not modelled on the TS Race: TODO(port) — the C# picks AvailableCharacters[0] when the
            // empire's race has any; the TS leaves Character null.
            if (empires == null || empires.length <= 0) break;
            self.empire = empires[0];
            break;
        case EventTriggerType.CharacterKilled: {
            if (empires == null || empires.length <= 0) break;
            self.empire = empires[0];
            const chars = self.empire.characters as Character[] | null;
            if (chars == null || chars.length <= 0) break;
            self.character = chars[0];
            break;
        }
    }
}

/** GameEvent.cs 111 ResolveValidTriggerTypes(triggerObject, triggerRuin). No Rnd. */
export function resolveValidTriggerTypes(triggerObject: EventStellarObject | null, triggerRuin: Ruin | null): EventTriggerType[] {
    const list: EventTriggerType[] = [];
    const T = EventTriggerType;
    if (triggerObject === null) {
        list.push(T.DiplomaticRelationChange, T.EmpireEncounter, T.ResearchBreakthrough, T.PlanetDestroyerConstructionCompleted, T.EmpireEliminated, T.CharacterAppears, T.CharacterKilled);
    } else if (stellarKinds().isHabitat(triggerObject)) {
        const habitat = triggerObject as Habitat;
        list.push(T.Destroy, T.Capture, T.Build);
        if (triggerRuin !== null && habitat.ruin !== null && habitat.ruin === triggerRuin) {
            list.length = 0;
            list.push(T.Investigate);
        }
    } else if (stellarKinds().isBuiltObject(triggerObject)) {
        const builtObject = triggerObject as BuiltObject;
        list.push(T.Destroy, T.Capture);
        if (builtObject.owner === null) list.push(T.Investigate);
    } else if (stellarKinds().isCreature(triggerObject)) {
        list.push(T.Destroy);
    }
    return list;
}

/** GameEventList.cs: List<GameEvent> + _NextId. */
export class GameEventList {
    items: GameEvent[] = [];
    nextId = 0;

    get count(): number {
        return this.items.length;
    }

    /** GameEventList.cs ClearAndResetIdsToZero. */
    clearAndResetIdsToZero(): void {
        this.items.length = 0;
        this.nextId = 0;
    }

    /** GameEventList.cs GetNextId: -1 once short.MaxValue is reached. */
    getNextId(): number {
        if (this.nextId >= 32767) return -1;
        ++this.nextId;
        return this.nextId;
    }

    /** GameEventList.cs GetById(gameEventId): first event with that id. */
    getById(gameEventId: number): GameEvent | null {
        for (let index = 0; index < this.items.length; ++index) {
            const byId = this.items[index];
            if (byId != null && byId.gameEventId === gameEventId) return byId;
        }
        return null;
    }
}

/** EventActionExecutionPackage.cs. */
export class EventActionExecutionPackage {
    action: EventAction | null;
    gameEvent: GameEvent | null;
    triggerEmpire: Empire | null;

    constructor(action: EventAction | null, gameEvent: GameEvent | null, triggerEmpire: Empire | null) {
        this.action = action;
        this.gameEvent = gameEvent;
        this.triggerEmpire = triggerEmpire;
    }
}
