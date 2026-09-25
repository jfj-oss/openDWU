// M4z3: the scripted game-event interpreter (story/eventActions.ts, ports of Galaxy.9.cs 1179-2860 and BaconGalaxy.cs 308) —
// one test per EventActionType with the C# effect worked out by hand, plus CheckTriggerEvent / DoGameEvent /
// ExecuteOrDelayEventAction / ProcessDelayedEventActions and the save round trip of the event classes.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import { Random } from '../src/sim/random';
import {
    EventAction,
    EventActionExecutionPackage,
    EventActionExecutionType,
    EventActionType,
    EventTriggerType,
    GameEvent,
    MultipleEventActionType,
    resolveValidActionTypes,
} from '../src/sim/story/gameEventModel';
import {
    baconGalaxyExecuteEventAction,
    checkTriggerEvent,
    doGameEvent,
    executeEventAction,
    executeOrDelayEventAction,
    getMatchingGameEventIdDiplomaticRelationChange,
    getMatchingGameEventIdEmpireEncounter,
    getMatchingGameEventIdResearchBreakthrough,
    processDelayedEventActions,
} from '../src/sim/story/eventActions';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { EventMessageType } from '../src/sim/eventTypes';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { findNodeById } from '../src/sim/researchSystem';
import { getGovernmentsStatic } from '../src/sim/empire';
import { raceBiasesGetBias } from '../src/sim/raceBias';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { CreatureType } from '../src/sim/creature';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';
import { Ruin } from '../src/sim/ruins';
import { CharacterRole, generateNewCharacter } from '../src/sim/characters';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { planetaryFacilityDefinitionsStatic, PlanetaryFacility } from '../src/sim/construction/facilities';
import { galaxyToJSON, galaxyFromJSON } from '../src/sim/save/galaxySave';
import { GalaxyLocation, GalaxyLocationType } from '../src/sim/galaxyLocation';

let gameData: GameData;
let g: Galaxy;

interface Msg {
    type: number;
    title: string;
    message: string;
}
const inbox = new Map<Empire, Msg[]>();
function listen(e: Empire): Msg[] {
    const list: Msg[] = [];
    inbox.set(e, list);
    e.eventMessageRecipient = { receiveEventMessage: (type, title, message) => list.push({ type, title, message }) };
    return list;
}

function action(type: EventActionType, target: Habitat | BuiltObject | null = null, patch: Partial<EventAction> = {}): EventAction {
    const a = new EventAction(target, type);
    Object.assign(a, patch);
    return a;
}

function cloneRandom(r: Random): Random {
    const c = new Random(0);
    c.setState(r.getState());
    return c;
}

/** Draws made by `fn` on galaxy.rnd. */
function draws(fn: () => void): number {
    const before = g.rnd.drawCount;
    fn();
    return g.rnd.drawCount - before;
}

beforeAll(async () => {
    gameData = await loadGameDataFs();
    g = createTickGame(gameData).galaxy;
}, 180000);

beforeEach(() => {
    for (const e of g.empires) e.eventMessageRecipient = null;
    inbox.clear();
});

describe('GameEvent model (GameEvent.cs, EventAction.cs)', () => {
    it('resolves the valid trigger / action types by trigger object and applies the defaults', () => {
        const ev = new GameEvent(g, 1, null);
        expect(ev.validTriggerTypes[0]).toBe(EventTriggerType.DiplomaticRelationChange);
        expect(ev.triggerType).toBe(EventTriggerType.DiplomaticRelationChange);
        expect(ev.empire).toBe(g.empires[0]);
        expect(ev.empireOther).toBe(g.empires[1]);
        expect(ev.diplomaticRelationType).toBe(DiplomaticRelationType.FreeTradeAgreement);
        const bo = g.empires[0].builtObjects[0];
        const ev2 = new GameEvent(g, 2, bo);
        expect(ev2.validTriggerTypes).toEqual([EventTriggerType.Destroy, EventTriggerType.Capture]);
        const h = g.empires[0].capital!;
        const ruin = new Ruin('R', 0, 0, 0, 0, 0, 0, 0);
        const old = h.ruin;
        h.ruin = ruin;
        expect(new GameEvent(g, 3, h, ruin).validTriggerTypes).toEqual([EventTriggerType.Investigate]);
        h.ruin = old;
        expect(new GameEvent(g, 4, h).validTriggerTypes).toEqual([EventTriggerType.Destroy, EventTriggerType.Capture, EventTriggerType.Build]);
        expect(resolveValidActionTypes(bo)).toEqual([EventActionType.AcquireBuiltObject, EventActionType.DestroyBuiltObject, EventActionType.RevealObject, EventActionType.SendFleetAttack, EventActionType.CharacterGenerate]);
        expect(resolveValidActionTypes(null)).toHaveLength(34);
        expect(resolveValidActionTypes(h)).toHaveLength(20);
        const a = new EventAction(null, EventActionType.FindMoneyTreasure);
        expect([a.value, a.executionDate, a.delayDaysMinimum, a.delayDaysMaximum, a.diplomaticRelationType]).toEqual([-1, -1, -1, -1, DiplomaticRelationType.None]);
    });

    it('GameEventList ids count from 1 and stop at short.MaxValue', () => {
        const list = g.gameEvents;
        list.clearAndResetIdsToZero();
        expect(list.getNextId()).toBe(1);
        expect(list.getNextId()).toBe(2);
        list.nextId = 32767;
        expect(list.getNextId()).toBe(-1);
        list.clearAndResetIdsToZero();
    });
});

describe('CheckTriggerEvent / DoGameEvent / delays (Galaxy.9.cs 1270-1501)', () => {
    it('a matching id triggers once; the trigger ruin id is negated while triggered and restored otherwise', () => {
        const e = g.empires[0];
        const h = e.capital!;
        const oldRuin = h.ruin;
        const ruin = new Ruin('Story ruin', 0, 0, 0, 0, 0, 0, 0);
        h.ruin = ruin;
        g.gameEvents.clearAndResetIdsToZero();
        const ev = new GameEvent(g, g.gameEvents.getNextId(), h, ruin);
        ruin.gameEventId = ev.gameEventId;
        g.gameEvents.items.push(ev);
        const money = e.stateMoney;
        ev.actions!.items.push(action(EventActionType.FindMoneyTreasure, null, { moneyAmount: 500 }));
        expect(getMatchingGameEventIdEmpireEncounter(g, e, g.empires[1])).toBe(-1);
        expect(checkTriggerEvent(g, ev.gameEventId, e, EventTriggerType.Destroy, null)).toBe(false); // wrong type
        expect(checkTriggerEvent(g, ev.gameEventId, e, EventTriggerType.Investigate, null)).toBe(true);
        expect(ev.hasBeenTriggered).toBe(true);
        expect(ruin.gameEventId).toBe(-1);
        expect(e.stateMoney).toBe(money + 500);
        expect(checkTriggerEvent(g, 1, e, EventTriggerType.Investigate, null)).toBe(false); // already triggered
        // CanOnlyBeTriggeredByPlayer: an AI trigger does not fire it, and the id is restored (Math.Abs).
        const ev2 = new GameEvent(g, g.gameEvents.getNextId(), h, ruin);
        ev2.canOnlyBeTriggeredByPlayer = true;
        ruin.gameEventId = ev2.gameEventId;
        g.gameEvents.items.push(ev2);
        expect(checkTriggerEvent(g, ev2.gameEventId, g.empires[1], EventTriggerType.Investigate, null)).toBe(false);
        expect(ruin.gameEventId).toBe(2);
        h.ruin = oldRuin;
        g.gameEvents.clearAndResetIdsToZero();
    });

    it('matching-id lookups skip triggered events and compare every field', () => {
        const [e1, e2] = g.empires;
        g.gameEvents.clearAndResetIdsToZero();
        const ev = new GameEvent(g, 7, null); // DiplomaticRelationChange e1 → e2, FreeTradeAgreement
        g.gameEvents.items.push(ev);
        expect(getMatchingGameEventIdDiplomaticRelationChange(g, e1, e2, DiplomaticRelationType.FreeTradeAgreement)).toBe(7);
        expect(getMatchingGameEventIdDiplomaticRelationChange(g, e2, e1, DiplomaticRelationType.FreeTradeAgreement)).toBe(-1);
        expect(getMatchingGameEventIdDiplomaticRelationChange(g, e1, e2, DiplomaticRelationType.War)).toBe(-1);
        ev.hasBeenTriggered = true;
        expect(getMatchingGameEventIdDiplomaticRelationChange(g, e1, e2, DiplomaticRelationType.FreeTradeAgreement)).toBe(-1);
        ev.hasBeenTriggered = false;
        ev.triggerType = EventTriggerType.ResearchBreakthrough;
        expect(getMatchingGameEventIdResearchBreakthrough(g, e1, -1)).toBe(7);
        g.gameEvents.clearAndResetIdsToZero();
    });

    it('ExecuteSingleRandomAction draws Rnd.Next(0, count) and runs only that action', () => {
        const e = g.empires[0];
        const ev = new GameEvent(g, 1, null);
        ev.actions!.executionType = MultipleEventActionType.ExecuteSingleRandomAction;
        for (const amount of [10, 20, 40]) ev.actions!.items.push(action(EventActionType.FindMoneyTreasure, null, { moneyAmount: amount }));
        const expected = [10, 20, 40][cloneRandom(g.rnd).next(0, 3)];
        const money = e.stateMoney;
        expect(draws(() => doGameEvent(g, ev, e))).toBe(1);
        expect(e.stateMoney - money).toBe(expected);
        // ExecuteAllActions runs all in order, no draw.
        const ev2 = new GameEvent(g, 2, null);
        for (const amount of [1, 2]) ev2.actions!.items.push(action(EventActionType.FindMoneyTreasure, null, { moneyAmount: amount }));
        const m2 = e.stateMoney;
        expect(draws(() => doGameEvent(g, ev2, e))).toBe(0);
        expect(e.stateMoney - m2).toBe(3);
    });

    it('Delay / RandomDelay set ExecutionDate in game days (RealSecondsInGalacticYear·1000/360 = 1666 ms) and queue the action', () => {
        const e = g.empires[0];
        g.delayedActions.length = 0;
        const a = action(EventActionType.ChangeEmpireReputation, null, { empire: e, value: 1, executionType: EventActionExecutionType.Delay, delayDaysMinimum: 3 });
        executeOrDelayEventAction(g, a, e, null, 1000000);
        expect(a.executionDate).toBe(1000000 + 3 * 1666);
        const b = action(EventActionType.ChangeEmpireReputation, null, { empire: e, value: 1, executionType: EventActionExecutionType.RandomDelay, delayDaysMinimum: 2, delayDaysMaximum: 9 });
        const r = cloneRandom(g.rnd).next(0, 7);
        expect(draws(() => executeOrDelayEventAction(g, b, e, null, 1000000))).toBe(1);
        expect(b.executionDate).toBe(1000000 + (2 + r) * 1666);
        expect(g.delayedActions.map((p) => p.action)).toEqual([a, b]);
        // ProcessDelayedEventActions runs the due ones (in order) and removes only them.
        const civ = e.civilityRating;
        processDelayedEventActions(g, 1000000 + 3 * 1666);
        expect(e.civilityRating - civ).toBe(r + 2 <= 3 ? 2 : 1);
        expect(g.delayedActions.map((p) => p.action)).toEqual(r + 2 <= 3 ? [] : [b]);
        processDelayedEventActions(g, 1000000 + 20 * 1666);
        expect(g.delayedActions).toEqual([]);
    });
});

describe('ExecuteEventAction per action type (Galaxy.9.cs 1503-2860)', () => {
    it('FindMoneyTreasure: +money to the trigger empire and a GeneralDiscovery message (game event title / description appended)', () => {
        const e = g.empires[0];
        const msgs = listen(e);
        const money = e.stateMoney;
        const ev = new GameEvent(g, 1, null);
        ev.title = 'Found it';
        ev.description = 'Details';
        executeEventAction(g, action(EventActionType.FindMoneyTreasure, null, { moneyAmount: 2500 }), e, ev);
        expect(e.stateMoney).toBe(money + 2500);
        expect(msgs).toEqual([{ type: EventMessageType.GeneralDiscovery, title: 'Found it', message: 'GameEventAction Description FindMoneyTreasure|2500\n\nDetails' }]);
        // MessageTitle / MessageText override everything.
        executeEventAction(g, action(EventActionType.FindMoneyTreasure, null, { moneyAmount: 1, messageTitle: 'T', messageText: 'X' }), e, ev);
        expect(msgs[1]).toEqual({ type: EventMessageType.GeneralDiscovery, title: 'T', message: 'X' });
        // No trigger empire: nothing happens and nothing is sent.
        executeEventAction(g, action(EventActionType.FindMoneyTreasure, null, { moneyAmount: 1 }), null, null);
        expect(msgs).toHaveLength(2);
    });

    it('ChangeEmpireReputation / ChangeEmpireEvaluation / VictoryConditionBonus message the action empire', () => {
        const [e1, e2] = g.empires;
        const m1 = listen(e1);
        const m2 = listen(e2);
        const civ = e1.civilityRating;
        executeEventAction(g, action(EventActionType.ChangeEmpireReputation, null, { empire: e1, value: -4 }), e2, null);
        expect(e1.civilityRating).toBe(civ - 4);
        expect(m1.map((m) => m.title)).toEqual(['GameEventAction Title ChangeEmpireReputation Worse']);
        const ev = obtainEmpireEvaluation(g, e1, e2);
        const raw = ev.incidentEvaluationRaw;
        executeEventAction(g, action(EventActionType.ChangeEmpireEvaluation, null, { empire: e1, empireOther: e2, value: 7 }), null, null);
        expect(ev.incidentEvaluationRaw).toBe(Math.min(80, raw + 7));
        expect(m2.map((m) => m.message)).toEqual([`GameEventAction Description ChangeEmpireEvaluation Better|${e1.name}`]);
        const vb = e2.victoryBonus;
        executeEventAction(g, action(EventActionType.VictoryConditionBonus, null, { empire: e2, value: 15 }), null, null);
        expect(e2.victoryBonus).toBe(Math.fround(vb + Math.fround(0.15)));
        expect(m2[1].message).toBe('GameEventAction Description VictoryConditionBonus|+15%');
    });

    it('UnlockTech / UnlockTechForEmpire / LearnTech / ResearchBonusInProject act on the tech tree', () => {
        const e = g.empires[0];
        const locked = e.research.techTree.find((n) => !n.isResearched)!;
        locked.isEnabled = false;
        executeEventAction(g, action(EventActionType.UnlockTech, null, { value: locked.def.projectId }), e, null);
        expect(locked.isEnabled).toBe(true);
        const e2 = g.empires[1];
        const locked2 = e2.research.techTree.find((n) => !n.isResearched)!;
        locked2.isEnabled = false;
        executeEventAction(g, action(EventActionType.UnlockTechForEmpire, null, { empire: e2, value: locked2.def.projectId }), null, null);
        expect(locked2.isEnabled).toBe(true);
        const todo = e.research.techTree.find((n) => !n.isResearched && n.isEnabled)!;
        executeEventAction(g, action(EventActionType.LearnTech, null, { value: todo.def.projectId }), e, null);
        expect(todo.isResearched).toBe(true);
        const node = e.research.techTree.find((n) => !n.isResearched)!;
        const before = node.progress;
        const expected = Math.fround(before + Math.fround(cloneRandom(g.rnd).nextDouble() * node.cost));
        executeEventAction(g, action(EventActionType.ResearchBonusInProject, null, { value: node.def.projectId }), e, null);
        expect(node.progress).toBe(expected);
        expect(findNodeById(e.research.techTree, node.def.projectId)).toBe(node);
    });

    it('MakeEmpireContact / InitiateTreaty / BreakTreaty / EmpireDeclaresWarOnOtherEmpire / super-luxury trading change relations', () => {
        const e1 = g.empires[2];
        const e3 = g.empires[3];
        const r = obtainDiplomaticRelation(e1, e3);
        r.type = DiplomaticRelationType.NotMet;
        obtainDiplomaticRelation(e3, e1).type = DiplomaticRelationType.NotMet;
        executeEventAction(g, action(EventActionType.MakeEmpireContact, null, { empire: e3 }), e1, null);
        expect([obtainDiplomaticRelation(e1, e3).type, obtainDiplomaticRelation(e3, e1).type]).toEqual([DiplomaticRelationType.None, DiplomaticRelationType.None]);
        executeEventAction(g, action(EventActionType.InitiateTreaty, null, { empire: e1, empireOther: e3, diplomaticRelationType: DiplomaticRelationType.FreeTradeAgreement }), null, null);
        expect(obtainDiplomaticRelation(e1, e3).type).toBe(DiplomaticRelationType.FreeTradeAgreement);
        // Same treaty again with LockedAlliance + AllianceName: both sides locked and named, no relation change.
        executeEventAction(g, action(EventActionType.InitiateTreaty, null, { empire: e1, empireOther: e3, diplomaticRelationType: DiplomaticRelationType.FreeTradeAgreement, lockedAlliance: true, allianceName: 'Pact' }), null, null);
        expect([obtainDiplomaticRelation(e1, e3).locked, obtainDiplomaticRelation(e3, e1).locked]).toEqual([true, true]);
        expect([obtainDiplomaticRelation(e1, e3).allianceName, obtainDiplomaticRelation(e3, e1).allianceName]).toEqual(['Pact', 'Pact']);
        obtainDiplomaticRelation(e1, e3).locked = false;
        obtainDiplomaticRelation(e3, e1).locked = false;
        executeEventAction(g, action(EventActionType.StartTradingSuperLuxuryResources, null, { empire: e1, empireOther: e3 }), null, null);
        expect(obtainDiplomaticRelation(e1, e3).supplyRestrictedResources).toBe(true);
        executeEventAction(g, action(EventActionType.StopTradingSuperLuxuryResources, null, { empire: e1, empireOther: e3 }), null, null);
        expect(obtainDiplomaticRelation(e1, e3).supplyRestrictedResources).toBe(false);
        executeEventAction(g, action(EventActionType.BreakTreaty, null, { empire: e1, empireOther: e3 }), null, null);
        expect(obtainDiplomaticRelation(e1, e3).type).toBe(DiplomaticRelationType.None);
        executeEventAction(g, action(EventActionType.EmpireDeclaresWarOnOtherEmpire, null, { empire: e1, empireOther: e3 }), null, null);
        expect(obtainDiplomaticRelation(e1, e3).type).toBe(DiplomaticRelationType.War);
        // DiplomaticRelationType War + LockedAlliance: only locks the (existing) war.
        executeEventAction(g, action(EventActionType.EmpireDeclaresWarOnOtherEmpire, null, { empire: e1, empireOther: e3, diplomaticRelationType: DiplomaticRelationType.War, lockedAlliance: true }), null, null);
        expect(obtainDiplomaticRelation(e3, e1).locked).toBe(true);
    });

    it('EmpireDeclaresWarOnTriggerEmpire: the action empire declares war on the trigger empire', () => {
        const [e0, , e2] = g.empires;
        executeEventAction(g, action(EventActionType.EmpireDeclaresWarOnTriggerEmpire, null, { empire: e2 }), e0, null);
        expect(obtainDiplomaticRelation(e2, e0).type).toBe(DiplomaticRelationType.War);
    });

    it('LearnGovernmentType adds the allowable government; ChangeEmpireGovernment switches it', () => {
        const e = g.empires[0]; // the player: no revolution
        const govs = getGovernmentsStatic();
        const idx = govs.findIndex((gv) => gv !== null && !e.allowableGovernmentTypes.includes(gv.governmentId));
        executeEventAction(g, action(EventActionType.LearnGovernmentType, null, { value: idx }), e, null);
        expect(e.allowableGovernmentTypes).toContain(govs[idx]!.governmentId);
        const e1 = g.empires[1];
        const other = govs.findIndex((gv) => gv !== null && gv.governmentId !== e1.governmentId);
        executeEventAction(g, action(EventActionType.ChangeEmpireGovernment, null, { empire: e1, value: other }), null, null);
        expect(e1.governmentId).toBe(govs[other]!.governmentId);
    });

    it('ChangeRaceBias: Race.Biases gets bias + Value; evaluations of that race toward the other race are rebased on BiasRaw', () => {
        const [e0, e1] = g.empires;
        const race = e0.dominantRace!;
        const other = e1.dominantRace!;
        const before = raceBiasesGetBias(race, other);
        const ev = obtainEmpireEvaluation(g, e0, e1);
        const raw = ev.biasRaw;
        executeEventAction(g, action(EventActionType.ChangeRaceBias, null, { race, raceOther: other, value: 12 }), e0, null);
        expect(raceBiasesGetBias(race, other)).toBe(before + 12);
        expect(ev.biasRaw).toBe(raw + 12);
        executeEventAction(g, action(EventActionType.ChangeRaceBias, null, { race, raceOther: other, value: -12 }), e0, null);
        expect(raceBiasesGetBias(race, other)).toBe(before);
    });

    it('RevealObject explores the habitat system; LearnAboutSpecialLocation adds the location and a player hint', () => {
        const e = g.empires[0];
        const sys = g.systems.find((s) => e.visibility.systemVisibility[s.systemStar.systemIndex].status === SystemVisibilityStatus.Unexplored)!;
        const planet = sys.habitats.find((h) => h !== sys.systemStar) ?? sys.systemStar;
        executeEventAction(g, action(EventActionType.RevealObject, planet), e, null);
        expect(e.visibility.systemVisibility[sys.systemStar.systemIndex].status).toBe(SystemVisibilityStatus.Explored);
        const loc = new GalaxyLocation('Somewhere', GalaxyLocationType.NebulaCloud, 1000, 2000, 400, 600, -1);
        const hints = e.locationHints.length;
        executeEventAction(g, action(EventActionType.LearnAboutSpecialLocation, null, { location: loc }), e, null);
        expect(e.visibility.knownGalaxyLocations).toContain(loc);
        expect(e.locationHints.length).toBe(hints + 1);
        expect(e.locationHints[e.locationHints.length - 1]).toEqual({ x: 1200, y: 2300 });
    });

    it('General / Empire messages go to the action empire (or the other empire)', () => {
        const [e0, e1] = g.empires;
        const m0 = listen(e0);
        const m1 = listen(e1);
        executeEventAction(g, action(EventActionType.GeneralMessageToEmpire, null, { empire: e0, messageText: 'Hello' }), e1, null);
        executeEventAction(g, action(EventActionType.EmpireMessageToEmpire, null, { empire: e0, empireOther: e1, messageText: 'Hi' }), null, null);
        executeEventAction(g, action(EventActionType.GeneralMessageToEmpire, null, { empire: e0, messageText: '   ' }), e1, null);
        expect(m0).toEqual([{ type: EventMessageType.GeneralDiscovery, title: 'GameEventAction Title GeneralMessageToEmpire', message: 'Hello' }]);
        expect(m1).toEqual([{ type: EventMessageType.GeneralDiscovery, title: `GameEventAction Title EmpireMessageToEmpire|${e0.name}`, message: 'Hi' }]);
    });

    it('BuildPlanetaryFacility / DestroyPlanetaryFacility add and remove a fully built facility', () => {
        const e = g.empires[0];
        const colony = e.capital!;
        const defs = planetaryFacilityDefinitionsStatic(g);
        const idx = defs.findIndex((d) => d.type !== 8 && !(colony.facilities ?? []).some((f) => f.planetaryFacilityDefinitionId === d.facilityId));
        executeEventAction(g, action(EventActionType.BuildPlanetaryFacility, colony, { value: idx }), e, null);
        const f = (colony.facilities ?? []).find((x) => x.planetaryFacilityDefinitionId === defs[idx].facilityId) as PlanetaryFacility;
        expect(f.constructionProgress).toBe(1);
        executeEventAction(g, action(EventActionType.DestroyPlanetaryFacility, colony, { value: idx }), e, null);
        expect((colony.facilities ?? []).some((x) => x.planetaryFacilityDefinitionId === defs[idx].facilityId)).toBe(false);
    });

    it('EndPlague clears the colony plague', () => {
        const e = g.empires[0];
        const colony = e.capital!;
        colony.plagueId = 0;
        colony.plagueTimeRemaining = 5;
        executeEventAction(g, action(EventActionType.EndPlague, colony), e, null);
        expect([colony.plagueId, colony.plagueTimeRemaining]).toEqual([-1, 0]);
    });

    it('SleepingRaceAwokenAtHabitat populates an unowned planet for the independents; LearnAboutLostColony populates it unowned (null empire)', () => {
        const e = g.empires[0];
        const race = e.dominantRace!;
        const free = g.habitats.filter((h) => h.owner === null && h.empire === null && (h.population == null || h.population.items.length === 0) && h.type === HabitatType.Continental && h.category === HabitatCategoryType.Planet);
        const [h1, h2] = free;
        executeEventAction(g, action(EventActionType.SleepingRaceAwokenAtHabitat, h1, { race, value: 12 }), e, null);
        expect(h1.population.items[0].race).toBe(race);
        expect(h1.population.items[0].amount).toBe(12000000);
        expect(h1.empire).toBe(g.independentEmpire);
        executeEventAction(g, action(EventActionType.LearnAboutLostColony, h2, { race, value: 3 }), e, null);
        expect(h2.population.totalAmount).toBe(3000000);
        expect(h2.empire).toBeNull(); // C#: MakeHabitatIntoColony(habitat, null, …) → TakeOwnershipOfColony(habitat, null)
    });

    it('GenerateResourceAtHabitat / RemoveResourceAtHabitat', () => {
        const e = g.empires[0];
        const colony = e.colonies.find((c) => c.resources.length < 5)!;
        const rs = g.resourceSystem.resources;
        const idx = rs.findIndex((r) => !colony.resources.some((x) => x.resourceId === r.resourceId));
        const abundance = cloneRandom(g.rnd).next(300, 700);
        executeEventAction(g, action(EventActionType.GenerateResourceAtHabitat, colony, { value: idx }), e, null);
        expect(colony.resources.find((x) => x.resourceId === rs[idx].resourceId)?.abundance).toBe(abundance);
        executeEventAction(g, action(EventActionType.RemoveResourceAtHabitat, colony, { value: idx }), e, null);
        expect(colony.resources.some((x) => x.resourceId === rs[idx].resourceId)).toBe(false);
    });

    it('GenerateCreatureSwarm creates min(50, Value) creatures at the habitat', () => {
        const e = g.empires[0];
        const h = g.habitats.find((x) => x.category === HabitatCategoryType.Planet && x.empire === null)!;
        const n = g.creatures.length;
        executeEventAction(g, action(EventActionType.GenerateCreatureSwarm, h, { creatureType: CreatureType.Kaltor, value: 3 }), e, null);
        expect(g.creatures.length).toBe(n + 3);
        expect(g.creatures.slice(-3).every((c) => c.type === CreatureType.Kaltor)).toBe(true);
    });

    it('DestroyBuiltObject / AcquireBuiltObject / AcquireHabitat', () => {
        const [e0, e1] = g.empires;
        const victim = e1.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && !b.hasBeenDestroyed)!;
        executeEventAction(g, action(EventActionType.AcquireBuiltObject, victim), e0, null);
        expect(victim.empire).toBe(e0);
        const target = e1.builtObjects.find((b) => !b.hasBeenDestroyed && b !== victim)!;
        executeEventAction(g, action(EventActionType.DestroyBuiltObject, target), e0, null);
        expect(target.hasBeenDestroyed).toBe(true);
        // An independent colony (taking an empire's last colony would reach the unported empire teardown).
        const colony = g.independentColonies.find((c) => c.empire === g.independentEmpire && c.population.totalAmount > 0)!;
        executeEventAction(g, action(EventActionType.AcquireHabitat, colony), e0, null);
        expect(colony.empire).toBe(e0);
    });

    it('GenerateBuiltObject / GenerateRefugeeFleet leave abandoned (unowned) ships at the habitat', () => {
        const e = g.empires[0];
        const h = e.capital!;
        const n = g.builtObjects.length;
        executeEventAction(g, action(EventActionType.GenerateBuiltObject, h, { builtObjectSubRole: BuiltObjectSubRole.Frigate, techLevel: 1 }), e, null);
        expect(g.builtObjects.length).toBe(n + 1);
        expect(g.builtObjects[n].empire).toBeNull();
        expect(g.builtObjects[n].subRole).toBe(BuiltObjectSubRole.Frigate);
        executeEventAction(g, action(EventActionType.GenerateRefugeeFleet, h, { race: e.dominantRace }), e, null);
        const added = g.builtObjects.slice(n + 1);
        expect(added.map((b) => b.subRole)).toEqual([BuiltObjectSubRole.ColonyShip, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Cruiser]);
        expect(added[0].nativeRace).toBe(e.dominantRace);
        // Galaxy.9.cs 2105 ResolveDescription(BuiltObjectSubRole.ColonyShip) = GameText "Ship SubRole ColonyShip" (enumText.ts).
        expect(added[0].name).toBe('Refugee SHIPTYPE|Colony Ship');
    });

    it('IntergalacticConvoyMilitary / Civilian: Value ships of the empire arrive at the galaxy edge and move to its capital', () => {
        const e = g.empires[1];
        // A sub-role pick without a buildable design adds no ship (the 50-try loop re-reads the same pick).
        const all = () => [...e.builtObjects, ...e.privateBuiltObjects];
        const before = new Set(all());
        const d = draws(() => executeEventAction(g, action(EventActionType.IntergalacticConvoyMilitary, null, { empire: e, value: 4 }), null, null));
        expect(d).toBeGreaterThanOrEqual(4);
        const added = all().filter((b) => !before.has(b));
        expect(added.length).toBeLessThanOrEqual(4);
        for (const b of added) {
            expect(b.isAutoControlled).toBe(true);
            expect((b.mission as { type: number } | null)?.type).toBe(BuiltObjectMissionType.Move);
        }
        const n2 = all().length;
        expect(draws(() => executeEventAction(g, action(EventActionType.IntergalacticConvoyCivilian, null, { empire: e, value: 3 }), null, null))).toBeGreaterThanOrEqual(3);
        expect(all().length - n2).toBeLessThanOrEqual(3);
    });

    it('CharacterChangeImage / CharacterChangeRole / CharacterKill', () => {
        const e = g.empires[0];
        const c = generateNewCharacter(g, e, CharacterRole.Scientist, e.capital).character;
        executeEventAction(g, action(EventActionType.CharacterChangeImage, null, { empire: e, character: c, imageFilename: 'x.png' }), e, null);
        expect(c.pictureFilename).toBe('x.png');
        executeEventAction(g, action(EventActionType.CharacterChangeRole, null, { empire: e, character: c, characterRole: CharacterRole.ShipCaptain }), e, null);
        expect(c.role).toBe(CharacterRole.ShipCaptain);
        executeEventAction(g, action(EventActionType.CharacterKill, null, { empire: e, character: c }), e, null);
        expect(c.active).toBe(false);
    });

    it('SplitEmpire* draw NextDouble and run InitiateEmpireSplit (ported by M4z1, Empire.1.cs 1102)', () => {
        // Written against the M4z3 branch, where InitiateEmpireSplit still threw; on the merged tree the split
        // runs (a one-colony empire has nothing to splinter, so the empire count need not change).
        const e = g.empires[3];
        const before = g.empires.length;
        expect(() => executeEventAction(g, action(EventActionType.SplitEmpirePeacefully, null, { empire: e }), null, null)).not.toThrow();
        expect(g.empires.length).toBeGreaterThanOrEqual(before);
    });

    it('a null target / missing empire leaves every action a no-op (no message)', () => {
        const e = g.empires[0];
        const msgs = listen(e);
        for (let t = 1; t <= 56; t++) {
            if (t === EventActionType.EndPlague || t === EventActionType.BuildPlanetaryFacility || t === EventActionType.DestroyPlanetaryFacility || t === EventActionType.EnemyFleetDefectsToTriggerEmpire || t === EventActionType.ResearchBonusInProject || t === EventActionType.InterceptResource || t === EventActionType.LearnTech || t === EventActionType.UnlockTech || t === EventActionType.LearnGovernmentType) continue;
            executeEventAction(g, action(t as EventActionType, null), null, null);
        }
        expect(msgs).toEqual([]);
    });
});

describe('BaconGalaxy.ExecuteEventAction (BaconGalaxy.cs 308)', () => {
    it('ClearShipsAboutToBeDestroyed clears the list, re-queues itself 10 days later and suppresses the message', () => {
        g.delayedActions.length = 0;
        g.baconShipsToBeDestroyed.set('X', []);
        const a = action(EventActionType.StartPlague, null, { messageTitle: 'ClearShipsAboutToBeDestroyed' });
        expect(baconGalaxyExecuteEventAction(g, a, null, null, true)).toBe(false);
        expect(g.baconShipsToBeDestroyed.size).toBe(0);
        expect(a.executionDate).toBe(galaxyStarDate(g) + 1666 * 10);
        expect(g.delayedActions).toHaveLength(1);
        expect(g.delayedActions[0]).toBeInstanceOf(EventActionExecutionPackage);
        g.delayedActions.length = 0;
        expect(baconGalaxyExecuteEventAction(g, action(EventActionType.StartPlague, null, { messageTitle: 'other' }), null, null, true)).toBe(true);
    });
});

describe('save round trip (galaxySave CLASSES)', () => {
    it('keeps GameEvents and DelayedActions', () => {
        const e = g.empires[0];
        g.gameEvents.clearAndResetIdsToZero();
        const ev = new GameEvent(g, g.gameEvents.getNextId(), null);
        ev.actions!.items.push(action(EventActionType.ChangeEmpireReputation, null, { empire: e, value: 2 }));
        g.gameEvents.items.push(ev);
        g.delayedActions.push(new EventActionExecutionPackage(ev.actions!.items[0], ev, e));
        const g2 = galaxyFromJSON(JSON.parse(JSON.stringify(galaxyToJSON(g))), gameData);
        expect(g2.gameEvents.items).toHaveLength(1);
        expect(g2.gameEvents.getById(1)?.actions?.items[0].type).toBe(EventActionType.ChangeEmpireReputation);
        expect(g2.delayedActions[0].action).toBe(g2.gameEvents.items[0].actions!.items[0]);
        expect(g2.delayedActions[0].triggerEmpire).toBe(g2.empires[0]);
        expect(g2.delayedActions[0].action!.empire).toBe(g2.empires[0]);
        g.gameEvents.clearAndResetIdsToZero();
        g.delayedActions.length = 0;
    });
});
