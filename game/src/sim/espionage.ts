// M4z2 — espionage: intelligence missions, agent assignment, counter-intelligence, mission outcomes.
//
// C# sources:
//   IntelligenceMission.cs (ctors 33-150, Difficulty 167, Target 290), IntelligenceMissionType.cs, IntelligenceMissionOutcome.cs;
//   Empire.5.cs 4147-6110 (CalculateIntelligenceMissionBonusFromLeaderAndAmbassador .. PerformIntelligenceMissions);
//   Empire.6.cs 16-343 (DetermineIntelligenceMissionOutcome, CalculateIntelligenceMissionSuccessChance,
//   CancelIntelligenceMission, CompleteIntelligenceMission), 426-490 (AssignAgentFor*, CheckForIntelligenceMissionsOfType*);
//   Empire.10.cs 16 MarkEmpireAsRecentSpy, 3707 GenerateAutomationMessageAgentMission;
//   Galaxy.2.cs 5563 ResolveDescription(IntelligenceMission, Empire); Galaxy.8.cs 3563 CheckCancelIntelligenceMissionsWithTarget;
//   ResearchSystem.cs 240 ResolveMoreAdvancedProjects(giver, includeSpecialTech);
//   BaconEmpire.cs 43 PerformIntelligenceMission, 88 DetermineIntelligenceMissionOutcome, 113 OverrideTimeForMission,
//   655 ResetSpyMission. The Bacon spy capture / prisons are in espionagePrisoners.ts.
//
// Free functions, C# `this` (the Empire) first after the galaxy.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import type { TechNode } from './researchSystem';
import { BuiltObject as BuiltObjectClass } from './builtObject';
import { Habitat as HabitatClass } from './types';
import {
    Character,
    CharacterEventType,
    CharacterRole,
    CharacterSkillType,
    CharacterTraitType,
    IntelligenceMission,
    checkCharactersForTrait,
    doCharacterEvent,
    doCharacterEventForList,
    getCharactersByRole,
    getEmpireCharacters,
    getHighestSkillLevel,
    stellarObjectCharacters,
} from './characters';
import { CharacterDeathType, characterSendDeathMessage, habitatStartRebelling } from './characterRuntime';
import { EmpireMessageType, sendMessageToEmpire } from './messages';
import { gameText } from './colonyTick';
import { galaxyCurrentStarDate, obtainPirateRelation, PirateRelationType, type PirateRelation } from './pirateRelations';
import {
    DiplomaticRelationType,
    DiplomaticStrategy,
    LONG_MAX_VALUE,
    empireEvaluationByEmpire,
    empireEvaluationsOf,
    obtainDiplomaticRelation,
    obtainEmpireEvaluation,
    type DiplomaticRelation,
    type EmpireEvaluation,
} from './diplomacy';
import {
    AdvisorMessageType,
    cautionLevel,
    checkTaskAuthorized,
    countEmpiresWeDeclaredWarOn,
    countEmpiresWhoDeclaredWarOnUs,
    getAmbassadorsForEmpire,
    pirateRelationEvaluation,
    setCivilityRating,
    type RefCount,
} from './diplomacyTick';
import { calculateAggressionFactor, calculateCautionFactor } from './fleets/militaryAI';
import { BuiltObjectRole } from './data/designSpecifications';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { determineEmpireSystems, totalColonyStrategicValue } from './forceStructure';
import { strategicValue } from './territory';
import { empireGovernmentAttributes } from './empire';
import { isObjectAreaKnownToThisEmpire, giveTerritoryMap } from './tradeItems';
import { isObjectVisibleToThisEmpire } from './independentTraders';
import { mergeGalaxyMap } from './exploration';
import { haveRevolution } from './treasury';
import { getDevelopmentLevel, setDevelopmentLevel } from './combat/invasion';
import { inflictDamageFull } from './combat/damage';
import { ComponentStatus, csInt } from './builtObjectComponent';
import { doResearchBreakthrough } from './researchTick';
import { RaceEventType } from './eventTypes';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyNow } from './tick/simTime';
import { characterKillFromPerformIntelligenceMissions } from './espionagePrisoners';
import type { ConstructionQueue } from './construction/constructionQueue';
import { scenarioEmit } from './scenario/hooks';
import { formatGameTextNow } from './textResolver';

// ---------------------------------------------------------------------------------------------------------------
// Enums (IntelligenceMissionType.cs / IntelligenceMissionOutcome.cs, member order exact)
// ---------------------------------------------------------------------------------------------------------------

export enum IntelligenceMissionType {
    Undefined,
    SabotageConstruction,
    StealGalaxyMap,
    StealOperationsMap,
    StealTechData,
    SabotageColony,
    DeepCover,
    InciteRevolution,
    CounterIntelligence,
    StealTerritoryMap,
    AssassinateCharacter,
    DestroyBase,
}

export enum IntelligenceMissionOutcome {
    Undefined,
    SucceedNotDetect,
    SucceedDetect,
    FailNotDetect,
    FailDetect,
    Capture,
}

const T = IntelligenceMissionType;
const O = IntelligenceMissionOutcome;

/** Galaxy.RealSecondsInGalacticYear * 1000 / 12, / 4, * 1 (long). */
const TIME_ONE_MONTH = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 12);
const TIME_THREE_MONTHS = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 4);
const TIME_ONE_YEAR = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;

/** Character.Mission (IntelligenceMission or null). */
export function characterMission(character: Character): IntelligenceMission | null {
    return character.mission as IntelligenceMission | null;
}

function isRomulan(empire: Empire | null): boolean {
    return empire !== null && empire.name.includes('Romulan');
}

// ---------------------------------------------------------------------------------------------------------------
// IntelligenceMission.cs ctors / getters
// ---------------------------------------------------------------------------------------------------------------

/** IntelligenceMission.cs 33 IntelligenceMission(originatingEmpire, agent, type, startDate, Empire target). */
export function newIntelligenceMissionAgainstEmpire(originatingEmpire: Empire | null, agent: Character | null, type: IntelligenceMissionType, startDate: number, target: Empire | null): IntelligenceMission {
    const m = new IntelligenceMission(originatingEmpire, agent, startDate);
    m.targetEmpire = null;
    m.targetIsEmpire = false;
    m.type = T.Undefined;
    m.startDate = 0;
    m.timeLength = 0;
    switch (type) {
        case T.StealGalaxyMap:
        case T.StealOperationsMap:
        case T.DeepCover:
        case T.InciteRevolution:
        case T.StealTerritoryMap:
            m.type = type;
            m.startDate = startDate;
            m.timeLength = TIME_ONE_MONTH;
            m.targetEmpire = target;
            m.targetIsEmpire = true;
            break;
        default:
            throw new Error('Invalid mission type');
    }
    return m;
}

/** IntelligenceMission.cs 59 IntelligenceMission(originatingEmpire, agent, startDate, target, targetResearchProject) (StealTechData). */
export function newIntelligenceMissionStealTechData(originatingEmpire: Empire | null, agent: Character | null, startDate: number, target: Empire | null, targetResearchProject: TechNode | null): IntelligenceMission {
    const m = new IntelligenceMission(originatingEmpire, agent, startDate);
    m.type = T.StealTechData;
    m.startDate = startDate;
    m.timeLength = TIME_ONE_MONTH;
    m.targetEmpire = target;
    m.targetIsEmpire = false;
    m.targetResearchNode = targetResearchProject;
    m.targetIsResearch = true;
    return m;
}

/** IntelligenceMission.cs 86 IntelligenceMission(originatingEmpire, agent, type, startDate, BuiltObject targetBuiltObject). */
export function newIntelligenceMissionAgainstBuiltObject(originatingEmpire: Empire | null, agent: Character | null, type: IntelligenceMissionType, startDate: number, targetBuiltObject: BuiltObject): IntelligenceMission {
    // The C# ctor leaves _OriginatingEmpire / _Agent unset for invalid types (it throws anyway).
    const m = new IntelligenceMission(originatingEmpire, agent, startDate);
    m.targetEmpire = null;
    m.targetIsEmpire = false;
    switch (type) {
        case T.SabotageConstruction:
        case T.DestroyBase:
            m.type = type;
            m.startDate = startDate;
            m.timeLength = TIME_ONE_MONTH;
            m.targetEmpire = targetBuiltObject.empire;
            m.targetBuiltObject = targetBuiltObject;
            m.targetIsBuiltObject = true;
            break;
        default:
            throw new Error('Invalid mission type');
    }
    return m;
}

/** IntelligenceMission.cs 111 IntelligenceMission(originatingEmpire, agent, type, startDate, Habitat targetHabitat). */
export function newIntelligenceMissionAgainstHabitat(originatingEmpire: Empire | null, agent: Character | null, type: IntelligenceMissionType, startDate: number, targetHabitat: Habitat): IntelligenceMission {
    const m = new IntelligenceMission(originatingEmpire, agent, startDate);
    m.targetEmpire = null;
    m.targetIsEmpire = false;
    switch (type) {
        case T.SabotageConstruction:
        case T.SabotageColony:
            m.type = type;
            m.startDate = startDate;
            m.timeLength = TIME_ONE_MONTH;
            m.targetEmpire = targetHabitat.empire;
            m.targetHabitat = targetHabitat;
            m.targetIsHabitat = true;
            break;
        default:
            throw new Error('Invalid mission type');
    }
    return m;
}

/** IntelligenceMission.cs 135 IntelligenceMission(originatingEmpire, agent, type, startDate, Character targetCharacter). */
export function newIntelligenceMissionAgainstCharacter(originatingEmpire: Empire | null, agent: Character | null, type: IntelligenceMissionType, startDate: number, targetCharacter: Character): IntelligenceMission {
    if (type !== T.AssassinateCharacter) throw new Error('Invalid mission type');
    const m = new IntelligenceMission(originatingEmpire, agent, startDate);
    m.type = type;
    m.startDate = startDate;
    m.timeLength = TIME_ONE_MONTH;
    m.targetEmpire = targetCharacter.empire;
    m.targetIsEmpire = false;
    m.targetCharacter = targetCharacter;
    m.targetIsCharacter = true;
    return m;
}

/** IntelligenceMission.cs 290 Target (Empire / BuiltObject / Habitat / ResearchNode / Character, or null). */
export function intelligenceMissionTarget(m: IntelligenceMission): Empire | BuiltObject | Habitat | TechNode | Character | null {
    if (m.targetIsEmpire) return m.targetEmpire;
    if (m.targetIsBuiltObject) return m.targetBuiltObject;
    if (m.targetIsHabitat) return m.targetHabitat;
    if (m.targetIsResearch) return m.targetResearchNode;
    return m.targetIsCharacter ? m.targetCharacter : null;
}

/** IntelligenceMission.cs 280 ResetResearchProject(researchProject). */
export function intelligenceMissionResetResearchProject(m: IntelligenceMission, researchProject: TechNode | null): void {
    if (!m.targetIsResearch) return;
    m.targetResearchNode = researchProject;
}

/** C# `mission.Target is Habitat / BuiltObject / Character / ResearchNode` (a null target is none of them). */
function targetIsHabitat(m: IntelligenceMission): boolean {
    return intelligenceMissionTarget(m) instanceof HabitatClass;
}
function targetIsBuiltObject(m: IntelligenceMission): boolean {
    return intelligenceMissionTarget(m) instanceof BuiltObjectClass;
}
function targetIsCharacter(m: IntelligenceMission): boolean {
    return intelligenceMissionTarget(m) instanceof Character;
}
function targetIsResearchNode(m: IntelligenceMission): boolean {
    return m.targetIsResearch && !m.targetIsEmpire && !m.targetIsBuiltObject && !m.targetIsHabitat && m.targetResearchNode !== null;
}

/** IntelligenceMission.cs 167 Difficulty (int). No Rnd. */
export function intelligenceMissionDifficulty(m: IntelligenceMission): number {
    let difficulty = 0;
    const num1 = 20;
    let num2 = 1.0;
    const targetEmpire = m.targetEmpire;
    if (targetEmpire !== null && targetEmpire.pirateEmpireBaseHabitat !== null && m.originatingEmpire !== null && m.originatingEmpire.pirateEmpireBaseHabitat === null) num2 = 2.0;
    else if (targetEmpire!.reclusive) num2 = 3.0;
    switch (m.type) {
        case T.Undefined:
            difficulty = 0;
            break;
        case T.SabotageConstruction: {
            const num3 = Math.trunc(num1 * 1.0);
            let d1 = 1.0;
            if (m.targetIsBuiltObject) d1 = m.targetBuiltObject!.size / 1000.0;
            else if (m.targetIsHabitat) d1 = strategicValue(m.targetHabitat!) / 30000.0;
            const num4 = Math.sqrt(d1);
            difficulty = csInt(num3 * num4 * num2);
            break;
        }
        case T.StealGalaxyMap:
            difficulty = csInt(Math.trunc(num1 * 3.5) * num2);
            break;
        case T.StealOperationsMap:
            difficulty = csInt(Math.trunc(num1 * 2.8) * num2);
            break;
        case T.StealTechData: {
            let num5 = Math.trunc(num1 * 3.2);
            const node = m.targetResearchNode;
            if (
                m.targetIsResearch &&
                node !== null &&
                m.targetEmpire !== null &&
                m.targetEmpire.research.allowedRacesCount(node) > 0 &&
                m.agent !== null &&
                m.agent.empire !== null &&
                m.agent.empire.dominantRace !== null &&
                !m.targetEmpire.research.allowedRacesContains(node, m.agent.empire.dominantRace)
            ) {
                num5 = Math.trunc(num5 * 2.0);
            }
            difficulty = csInt(num5 * num2);
            break;
        }
        case T.SabotageColony: {
            let num6 = 1.0;
            const ga = targetEmpire !== null ? empireGovernmentAttributes(targetEmpire) : null;
            if (targetEmpire !== null && ga !== null) num6 = Math.sqrt(ga.stability);
            difficulty = csInt(Math.trunc(num1 * 3.6 * num6) * (strategicValue(m.targetHabitat!) / 200000.0) * num2);
            break;
        }
        case T.DeepCover:
            difficulty = csInt(Math.trunc(num1 * 8.0) * num2);
            break;
        case T.InciteRevolution: {
            let num7 = 1.0;
            const ga = targetEmpire !== null ? empireGovernmentAttributes(targetEmpire) : null;
            if (targetEmpire !== null && ga !== null) num7 = ga.stability;
            difficulty = csInt(Math.trunc(num1 * 2.5 * num7) * Math.max(1.0, Math.min(5.0, Math.sqrt(Math.sqrt(totalColonyStrategicValue(targetEmpire!) / 10000.0)))));
            break;
        }
        case T.CounterIntelligence:
            difficulty = 0;
            break;
        case T.StealTerritoryMap:
            difficulty = csInt(Math.trunc(num1 * 2.2) * num2);
            break;
        case T.AssassinateCharacter: {
            let num8 = 1.0;
            if (m.targetIsCharacter && m.targetCharacter !== null) {
                switch (m.targetCharacter.role) {
                    case CharacterRole.Leader:
                    case CharacterRole.PirateLeader:
                        num8 = 2.0;
                        break;
                    case CharacterRole.Ambassador:
                    case CharacterRole.ColonyGovernor:
                        num8 = 1.5;
                        break;
                    case CharacterRole.FleetAdmiral:
                    case CharacterRole.TroopGeneral:
                    case CharacterRole.IntelligenceAgent:
                    case CharacterRole.Scientist:
                    case CharacterRole.ShipCaptain:
                        num8 = 1.0;
                        break;
                }
            }
            difficulty = csInt(num1 * 8.0 * num8 * num2);
            break;
        }
        case T.DestroyBase: {
            let num9 = 4.0;
            const bo = m.targetBuiltObject;
            if (
                m.targetIsBuiltObject &&
                bo !== null &&
                bo.empire !== null &&
                bo.empire.pirateEmpireBaseHabitat !== null &&
                (bo.subRole === BuiltObjectSubRole.SmallSpacePort || bo.subRole === BuiltObjectSubRole.MediumSpacePort || bo.subRole === BuiltObjectSubRole.LargeSpacePort)
            ) {
                num9 = 4.5;
                if (bo.empire.pirateEmpireBaseHabitat === bo.parentHabitat) num9 = 5.0;
            }
            const num10 = csInt(num1 * num9 * num2);
            let d2 = 1.0;
            if (m.targetIsBuiltObject && bo !== null) d2 = bo.size / 300.0;
            const num11 = Math.sqrt(d2);
            difficulty = csInt(num10 * num11);
            break;
        }
    }
    return difficulty;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.5.cs 4147-4231 skill / bonus
// ---------------------------------------------------------------------------------------------------------------

/** Empire.5.cs 4147 CalculateIntelligenceMissionBonusFromLeaderAndAmbassador(missionType, targetEmpire). No Rnd. */
export function calculateIntelligenceMissionBonusFromLeaderAndAmbassador(self: Empire, missionType: IntelligenceMissionType, targetEmpire: Empire | null): number {
    let num = 1.0;
    let num2 = 1.0;
    let num3 = 1.0;
    const characters = getEmpireCharacters(self);
    if (characters != null) {
        const ambassadorsForEmpire = getAmbassadorsForEmpire(characters, targetEmpire);
        const highestSkillLevel = getHighestSkillLevel(ambassadorsForEmpire, CharacterSkillType.Espionage);
        const highestSkillLevel2 = getHighestSkillLevel(ambassadorsForEmpire, CharacterSkillType.CounterEspionage);
        num2 = 1.0 + highestSkillLevel / 100.0;
        num3 = 1.0 + highestSkillLevel2 / 100.0;
    }
    const leader = self.leader;
    switch (missionType) {
        case T.StealGalaxyMap:
        case T.StealOperationsMap:
        case T.StealTechData:
        case T.StealTerritoryMap:
            if (leader !== null) num *= 1.0 + leader.espionage / 100.0;
            num *= num2;
            break;
        case T.CounterIntelligence:
            if (leader !== null) num *= 1.0 + leader.counterEspionage / 100.0;
            num *= num3;
            break;
    }
    return num;
}

/** The agent skill switch shared by CalculateIntelligenceMissionSkill / GetIntelligenceMissionSkillLevel / PerformIntelligenceMissions / CalculateIntelligenceMissionSuccessChance. */
function agentSkillForMission(agent: Character, missionType: IntelligenceMissionType, targetEmpire: Empire | null): number {
    let num = 0;
    switch (missionType) {
        case T.CounterIntelligence:
            num = agent.counterEspionageFactored;
            break;
        case T.AssassinateCharacter:
            num = agent.assassinationFactored;
            break;
        case T.DeepCover:
            num = agent.concealmentFactored;
            break;
        case T.InciteRevolution:
            num = agent.psyOpsFactored;
            break;
        case T.SabotageConstruction:
        case T.SabotageColony:
        case T.DestroyBase:
            num = agent.sabotageFactored;
            break;
        case T.StealGalaxyMap:
        case T.StealOperationsMap:
        case T.StealTechData:
        case T.StealTerritoryMap:
            num = agent.espionageFactored;
            if (missionType === T.StealTechData && targetEmpire !== null) {
                const chars = getEmpireCharacters(targetEmpire);
                if (checkCharactersForTrait(chars, CharacterRole.Scientist, CharacterTraitType.ForeignSpy)) num *= 2;
                else if (checkCharactersForTrait(chars, CharacterRole.Scientist, CharacterTraitType.Patriot)) num = Math.trunc(num / 2);
            }
            break;
    }
    return num;
}

export interface MissionSkillDifficulties {
    oneYearDifficulty: number;
    threeMonthDifficulty: number;
    oneMonthDifficulty: number;
}

/** Empire.5.cs 4183 CalculateIntelligenceMissionSkill(agent, missionType, targetEmpire, out 1y, out 3m, out 1m). No Rnd. */
export function calculateIntelligenceMissionSkill(self: Empire, agent: Character, missionType: IntelligenceMissionType, targetEmpire: Empire | null): MissionSkillDifficulties {
    const num = cautionLevel(self) / 100.0;
    const num2 = num * 1.4;
    let num3 = agentSkillForMission(agent, missionType, targetEmpire);
    const num4 = calculateIntelligenceMissionBonusFromLeaderAndAmbassador(self, missionType, targetEmpire);
    num3 = csInt(num3 * num4);
    return {
        oneYearDifficulty: (num3 * 4.0) / num2,
        threeMonthDifficulty: (num3 * 2.0) / num2,
        oneMonthDifficulty: num3 / num2,
    };
}

/**
 * The repeated C# cascade (caller has checked Difficulty <= (int)oneYearDifficulty):
 * result.TimeLength = 1 year; if Difficulty <= (int)3m → 3 months; if Difficulty <= (int)1m → 1 month.
 */
function cascadeTimeLength(mission: IntelligenceMission, d: MissionSkillDifficulties): IntelligenceMission {
    mission.timeLength = TIME_ONE_YEAR;
    if (intelligenceMissionDifficulty(mission) <= csInt(d.threeMonthDifficulty)) {
        mission.timeLength = TIME_THREE_MONTHS;
        if (intelligenceMissionDifficulty(mission) <= csInt(d.oneMonthDifficulty)) mission.timeLength = TIME_ONE_MONTH;
    }
    return mission;
}

/** The two C# loops `for (i = start; i < n; i++) ...; for (j = 0; j < start; j++) ...` that return the first hit. */
function rotatedFirst<T>(list: readonly T[], start: number, fn: (item: T) => IntelligenceMission | null): IntelligenceMission | null {
    for (let i = start; i < list.length; i++) {
        const r = fn(list[i]);
        if (r !== null) return r;
    }
    for (let j = 0; j < start; j++) {
        const r = fn(list[j]);
        if (r !== null) return r;
    }
    return null;
}

/** DetermineSabotageMission / DetermineEspionageMission 4235-4318 / 4818-4904: the mission types this relation allows. */
function allowedMissionTypes(relation: DiplomaticRelation | null, pirateRelation: PirateRelation | null): IntelligenceMissionType[] {
    const list: IntelligenceMissionType[] = [];
    if (relation !== null) {
        if (relation.type === DiplomaticRelationType.War) {
            list.push(T.DeepCover, T.StealOperationsMap, T.DestroyBase, T.AssassinateCharacter, T.SabotageConstruction, T.SabotageColony);
        } else {
            switch (relation.strategy) {
                case DiplomaticStrategy.Conquer:
                    list.push(T.DeepCover, T.StealOperationsMap, T.SabotageConstruction, T.DestroyBase, T.AssassinateCharacter);
                    break;
                case DiplomaticStrategy.Undermine:
                    list.push(T.StealTerritoryMap, T.StealOperationsMap, T.StealTechData, T.SabotageColony, T.DestroyBase, T.AssassinateCharacter, T.InciteRevolution, T.DeepCover);
                    break;
                case DiplomaticStrategy.DefendUndermine:
                    list.push(T.StealTerritoryMap, T.StealGalaxyMap, T.StealTechData, T.DeepCover);
                    break;
                case DiplomaticStrategy.Punish:
                    list.push(T.SabotageConstruction, T.SabotageColony, T.DestroyBase, T.InciteRevolution);
                    break;
            }
        }
    } else if (pirateRelation !== null) {
        switch (pirateRelation.type) {
            case PirateRelationType.None:
                list.push(T.DeepCover, T.StealOperationsMap, T.StealTerritoryMap, T.StealGalaxyMap, T.StealTechData, T.DestroyBase, T.AssassinateCharacter, T.SabotageConstruction, T.SabotageColony);
                break;
            case PirateRelationType.Protection:
                list.push(T.DeepCover, T.StealOperationsMap, T.StealTerritoryMap, T.StealGalaxyMap, T.StealTechData);
                break;
        }
    }
    return list;
}

function constructionYardsUnderConstruction(queue: unknown): number {
    // ConstructionYardList.cs 14 CountUnderConstruction.
    const yards = (queue as ConstructionQueue).constructionYards!;
    let n = 0;
    for (let i = 0; i < yards.length; i++) if (yards[i].shipUnderConstruction !== null) n++;
    return n;
}

/**
 * Empire.5.cs 4232 DetermineSabotageMission(targetEmpire, evaluation, relation, pirateRelation, agent).
 * Rnd: [Assassinate: Next(0, knownCharacters)] [DestroyBase: Next(0, knownBases)] [SabotageColony: Next(0, knownColonies)]
 * [SabotageConstruction: Next(0, yards) if any, Next(0, knownColonies) if any] — each only when that block is reached.
 */
function determineSabotageMission(galaxy: Galaxy, self: Empire, targetEmpire: Empire, evaluation: EmpireEvaluation | null, relation: DiplomaticRelation | null, pirateRelation: PirateRelation | null, agent: Character): IntelligenceMission | null {
    let result: IntelligenceMission | null = null;
    const list = allowedMissionTypes(relation, pirateRelation);
    const now = () => galaxyCurrentStarDate(galaxy);
    let d: MissionSkillDifficulties;
    // 4330 InciteRevolution.
    if (canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.InciteRevolution)) {
        d = calculateIntelligenceMissionSkill(self, agent, T.InciteRevolution, targetEmpire);
        const intelligenceMission = newIntelligenceMissionAgainstEmpire(self, null, T.InciteRevolution, now(), targetEmpire);
        if (
            !checkWhetherTargetOfIntelligenceMission(self, targetEmpire, targetEmpire, T.InciteRevolution) &&
            !checkForIntelligenceMissionsOfTypeAgainstEmpire(self, targetEmpire, T.InciteRevolution) &&
            list.includes(T.InciteRevolution) &&
            intelligenceMissionDifficulty(intelligenceMission) <= csInt(d.oneYearDifficulty)
        ) {
            return cascadeTimeLength(intelligenceMission, d);
        }
    }
    // 4355 AssassinateCharacter.
    const characterList = resolveKnownCharacters(galaxy, self, targetEmpire);
    if (characterList.length > 0 && canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.AssassinateCharacter)) {
        d = calculateIntelligenceMissionSkill(self, agent, T.AssassinateCharacter, targetEmpire);
        const num = galaxy.rnd.next(0, characterList.length);
        const dd = d;
        result = rotatedFirst(characterList, num, (character) => {
            if (character == null || !character.active) return null;
            const m = newIntelligenceMissionAgainstCharacter(self, null, T.AssassinateCharacter, now(), character);
            if (checkWhetherTargetOfIntelligenceMission(self, targetEmpire, character, T.AssassinateCharacter) || !list.includes(T.AssassinateCharacter) || intelligenceMissionDifficulty(m) > csInt(dd.oneYearDifficulty)) return null;
            return cascadeTimeLength(m, dd);
        });
        if (result !== null) return result;
    }
    // 4413 DestroyBase.
    const list2 = resolveKnownBases(galaxy, self, targetEmpire);
    if (list2.length > 0 && canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.DestroyBase)) {
        d = calculateIntelligenceMissionSkill(self, agent, T.DestroyBase, targetEmpire);
        const num2 = galaxy.rnd.next(0, list2.length);
        const dd = d;
        result = rotatedFirst(list2, num2, (builtObject) => {
            if (builtObject == null || builtObject.hasBeenDestroyed) return null;
            const m = newIntelligenceMissionAgainstBuiltObject(self, null, T.DestroyBase, now(), builtObject);
            if (checkWhetherTargetOfIntelligenceMission(self, targetEmpire, builtObject, T.DestroyBase) || !list.includes(T.DestroyBase) || intelligenceMissionDifficulty(m) > csInt(dd.oneYearDifficulty)) return null;
            return cascadeTimeLength(m, dd);
        });
        if (result !== null) return result;
    }
    // 4471 SabotageColony.
    const list3 = resolveKnownColonies(self, targetEmpire);
    if (list3.length > 0 && canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.SabotageColony)) {
        d = calculateIntelligenceMissionSkill(self, agent, T.SabotageColony, targetEmpire);
        const num3 = galaxy.rnd.next(0, list3.length);
        const dd = d;
        result = rotatedFirst(list3, num3, (habitat) => {
            if (habitat == null || habitat.hasBeenDestroyed || !(habitat.culturalDistressFactor > 0)) return null;
            const m = newIntelligenceMissionAgainstHabitat(self, null, T.SabotageColony, now(), habitat);
            if (checkWhetherTargetOfIntelligenceMission(self, targetEmpire, habitat, T.SabotageColony) || !list.includes(T.SabotageColony) || intelligenceMissionDifficulty(m) > csInt(dd.oneYearDifficulty)) return null;
            return cascadeTimeLength(m, dd);
        });
        if (result !== null) return result;
    }
    // 4529 SabotageConstruction (one-month missions only).
    if (canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.SabotageConstruction)) {
        d = calculateIntelligenceMissionSkill(self, agent, T.SabotageConstruction, targetEmpire);
        const dd = d;
        const list4 = resolveKnownBuiltObjectConstructionYards(galaxy, self, targetEmpire);
        if (list4.length > 0) {
            const num4 = galaxy.rnd.next(0, list4.length);
            result = rotatedFirst(list4, num4, (builtObject3) => {
                if (builtObject3 != null && !builtObject3.hasBeenDestroyed && builtObject3.constructionQueue != null && constructionYardsUnderConstruction(builtObject3.constructionQueue) > 0) {
                    const m = newIntelligenceMissionAgainstBuiltObject(self, null, T.SabotageConstruction, now(), builtObject3);
                    if (!checkWhetherTargetOfIntelligenceMission(self, targetEmpire, builtObject3, T.SabotageConstruction) && list.includes(T.SabotageConstruction) && intelligenceMissionDifficulty(m) <= csInt(dd.oneMonthDifficulty)) {
                        m.timeLength = TIME_ONE_MONTH;
                        return m;
                    }
                }
                return null;
            });
            if (result !== null) return result;
        }
        if (list3.length > 0) {
            const num7 = galaxy.rnd.next(0, list3.length);
            result = rotatedFirst(list3, num7, (habitat3) => {
                if (habitat3 != null && !habitat3.hasBeenDestroyed && habitat3.constructionQueue != null && constructionYardsUnderConstruction(habitat3.constructionQueue) > 0) {
                    const m = newIntelligenceMissionAgainstHabitat(self, null, T.SabotageConstruction, now(), habitat3);
                    if (!checkWhetherTargetOfIntelligenceMission(self, targetEmpire, habitat3, T.SabotageConstruction) && list.includes(T.SabotageConstruction) && intelligenceMissionDifficulty(m) <= csInt(dd.oneMonthDifficulty)) {
                        m.timeLength = TIME_ONE_MONTH;
                        return m;
                    }
                }
                return null;
            });
            if (result !== null) return result;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.5.cs 4601-4717 Resolve* (what this empire knows of the target). No Rnd.
// ---------------------------------------------------------------------------------------------------------------

/** Empire.5.cs 4601 ResolveKnownColonies(targetEmpire). */
export function resolveKnownColonies(self: Empire, targetEmpire: Empire): Habitat[] {
    const list: Habitat[] = [];
    for (let i = 0; i < targetEmpire.colonies.length; i++) {
        const habitat = targetEmpire.colonies[i];
        if (self.visibility.checkSystemExplored(habitat.systemIndex) && habitat.owner === targetEmpire) list.push(habitat);
    }
    return list;
}

/** Empire.5.cs 4615 ResolveKnownCharacters(targetEmpire). */
export function resolveKnownCharacters(galaxy: Galaxy, self: Empire, targetEmpire: Empire): Character[] {
    const characterList: Character[] = [];
    const chars = getEmpireCharacters(targetEmpire);
    for (let i = 0; i < chars.length; i++) {
        const character = chars[i];
        if (character == null || !character.active || character.role === CharacterRole.IntelligenceAgent) continue;
        if (character.role === CharacterRole.Leader || character.role === CharacterRole.PirateLeader) {
            // C#: IsObjectAreaKnownToThisEmpire(character.Location) — a null location throws (NullReferenceException).
            if (isObjectAreaKnownToThisEmpire(galaxy, self, character.location as Habitat | BuiltObject)) characterList.push(character);
        } else if (character.location !== null && isObjectVisibleToThisEmpire(galaxy, self, character.location as Habitat | BuiltObject)) {
            characterList.push(character);
        }
    }
    return characterList;
}

/** Empire.5.cs 4640 ResolveKnownBases(targetEmpire). */
export function resolveKnownBases(galaxy: Galaxy, self: Empire, targetEmpire: Empire): BuiltObject[] {
    const list: BuiltObject[] = [];
    const builtObjectList: BuiltObject[] = [];
    builtObjectList.push(...targetEmpire.builtObjects);
    builtObjectList.push(...(targetEmpire.privateBuiltObjects as BuiltObject[]));
    for (let i = 0; i < builtObjectList.length; i++) {
        const builtObject = builtObjectList[i];
        if (builtObject.role !== BuiltObjectRole.Base) continue;
        if (builtObject.parentHabitat !== null) {
            if (self.visibility.checkSystemExplored(builtObject.parentHabitat.systemIndex)) list.push(builtObject);
        } else if (isObjectVisibleToThisEmpire(galaxy, self, builtObject)) {
            list.push(builtObject);
        }
    }
    return list;
}

/** Empire.5.cs 4668 ResolveKnownBuiltObjectConstructionYards(targetEmpire). */
export function resolveKnownBuiltObjectConstructionYards(galaxy: Galaxy, self: Empire, targetEmpire: Empire): BuiltObject[] {
    const list: BuiltObject[] = [];
    const yards = targetEmpire.constructionYards as BuiltObject[];
    for (let i = 0; i < yards.length; i++) {
        const builtObject = yards[i];
        if (builtObject.parentHabitat !== null) {
            if (self.visibility.checkSystemExplored(builtObject.parentHabitat.systemIndex)) list.push(builtObject);
        } else if (isObjectVisibleToThisEmpire(galaxy, self, builtObject)) {
            list.push(builtObject);
        }
    }
    return list;
}

/** Empire.5.cs 4689 ResolveKnownConstructionYards(targetEmpire) (UI: CharacterMission.cs). */
export function resolveKnownConstructionYards(galaxy: Galaxy, self: Empire, targetEmpire: Empire): (Habitat | BuiltObject)[] {
    const list: (Habitat | BuiltObject)[] = [];
    list.push(...resolveKnownColonies(self, targetEmpire));
    list.push(...resolveKnownBuiltObjectConstructionYards(galaxy, self, targetEmpire));
    return list;
}

/** Empire.5.cs 4718 DetermineEspionageMissionStrengthAssigned(targetEmpire) (no callers in the C#). */
export function determineEspionageMissionStrengthAssigned(self: Empire, targetEmpire: Empire): number {
    let num = 0;
    const chars = getEmpireCharacters(self);
    for (let i = 0; i < chars.length; i++) {
        const character = chars[i];
        const m = characterMission(character);
        if (m !== null && m.type !== T.Undefined && m.targetEmpire === targetEmpire) {
            switch (m.type) {
                case T.StealGalaxyMap:
                case T.StealOperationsMap:
                case T.StealTechData:
                case T.DeepCover:
                case T.StealTerritoryMap:
                    num += character.espionageFactored;
                    break;
            }
        }
    }
    return num;
}

/** Empire.5.cs 4741 DetermineSabotageMissionStrengthAssigned(targetEmpire) (no callers in the C#). */
export function determineSabotageMissionStrengthAssigned(self: Empire, targetEmpire: Empire): number {
    let num = 0;
    const chars = getEmpireCharacters(self);
    for (let i = 0; i < chars.length; i++) {
        const character = chars[i];
        const m = characterMission(character);
        if (m !== null && m.type !== T.Undefined && m.targetEmpire === targetEmpire) {
            switch (m.type) {
                case T.SabotageConstruction:
                case T.SabotageColony:
                case T.InciteRevolution:
                    num += character.sabotageFactored;
                    break;
            }
        }
    }
    return num;
}

/** Empire.5.cs 4762 CheckWhetherTargetOfIntelligenceMission(targetEmpire, potentialTarget, missionType). No Rnd. */
export function checkWhetherTargetOfIntelligenceMission(self: Empire, targetEmpire: Empire, potentialTarget: unknown, missionType: IntelligenceMissionType): boolean {
    const chars = getEmpireCharacters(self);
    if (potentialTarget instanceof HabitatClass) {
        for (let i = 0; i < chars.length; i++) {
            const m = characterMission(chars[i]);
            if (m !== null && targetIsHabitat(m) && intelligenceMissionTarget(m) === potentialTarget && m.type === missionType) return true;
        }
    } else if (potentialTarget instanceof BuiltObjectClass) {
        for (let j = 0; j < chars.length; j++) {
            const m = characterMission(chars[j]);
            if (m !== null && targetIsBuiltObject(m) && intelligenceMissionTarget(m) === potentialTarget && m.type === missionType) return true;
        }
    } else if (potentialTarget instanceof Character) {
        for (let k = 0; k < chars.length; k++) {
            const m = characterMission(chars[k]);
            if (m !== null && targetIsCharacter(m) && intelligenceMissionTarget(m) === potentialTarget && m.type === missionType) return true;
        }
    } else {
        if (missionType === T.CounterIntelligence) return false;
        for (let l = 0; l < chars.length; l++) {
            const m = characterMission(chars[l]);
            if (m !== null && m.type === missionType && m.targetEmpire === targetEmpire) return true;
        }
    }
    return false;
}

/** ResearchSystem.cs 240 ResolveMoreAdvancedProjects(giverEmpire, includeSpecialTech). No Rnd. */
export function resolveMoreAdvancedProjectsIncludeSpecial(self: Empire, giverEmpire: Empire, includeSpecialTech: boolean): TechNode[] {
    const research = self.research;
    const researchNodeList: TechNode[] = [];
    if (research.latestProjects === null || research.nextProjects === null) research.refreshLatestNextProjects(self.dominantRace);
    const giverTree = giverEmpire.research.techTree;
    for (const researchNode of research.nextProjects!.slice()) {
        if (researchNode != null) {
            // ResearchNodeList.GetEquivalent: this[ResearchNodeId] (the tech tree is in id order).
            const equivalent = giverTree.length > researchNode.def.projectId ? giverTree[researchNode.def.projectId] : null;
            if (equivalent!.isResearched) {
                if (!includeSpecialTech) {
                    if (giverEmpire.research.allowedRacesCount(equivalent!) <= 0) researchNodeList.push(equivalent!);
                } else {
                    researchNodeList.push(equivalent!);
                }
            }
        }
    }
    if (includeSpecialTech) {
        for (let index = 0; index < giverTree.length; ++index) {
            const researchNode = giverTree[index];
            if (researchNode.isResearched && giverEmpire.research.allowedRacesCount(researchNode) > 0) {
                const tree = research.techTree;
                const equivalent = tree.length > researchNode.def.projectId ? tree[researchNode.def.projectId] : null;
                if (!equivalent!.isResearched && !researchNodeList.includes(researchNode) && research.canResearchNode(equivalent!)) researchNodeList.push(researchNode);
            }
        }
    }
    return researchNodeList;
}

/**
 * Empire.5.cs 4815 DetermineEspionageMission(targetEmpire, evaluation, relation, pirateRelation, agent).
 * Rnd: Next(0, moreAdvancedProjects) whenever the target knows projects we do not (drawn before any check), nothing else.
 */
function determineEspionageMission(galaxy: Galaxy, self: Empire, targetEmpire: Empire, evaluation: EmpireEvaluation | null, relation: DiplomaticRelation | null, pirateRelation: PirateRelation | null, agent: Character): IntelligenceMission | null {
    const result: IntelligenceMission | null = null;
    const list = allowedMissionTypes(relation, pirateRelation);
    let flag = false;
    const chars = getEmpireCharacters(self);
    for (let i = 0; i < chars.length; i++) {
        const character = chars[i];
        const m = characterMission(character);
        if (character.role === CharacterRole.IntelligenceAgent && m !== null && m.type === T.DeepCover && m.targetEmpire === targetEmpire) {
            flag = true;
            break;
        }
    }
    const currentStarDate = galaxyCurrentStarDate(galaxy);
    const intelligenceMission = newIntelligenceMissionAgainstEmpire(self, null, T.StealTerritoryMap, currentStarDate, targetEmpire);
    const intelligenceMission2 = newIntelligenceMissionAgainstEmpire(self, null, T.StealOperationsMap, currentStarDate, targetEmpire);
    const intelligenceMission3 = newIntelligenceMissionAgainstEmpire(self, null, T.StealGalaxyMap, currentStarDate, targetEmpire);
    let intelligenceMission4: IntelligenceMission | null = newIntelligenceMissionStealTechData(self, null, currentStarDate, targetEmpire, null);
    const researchNodeList = resolveMoreAdvancedProjectsIncludeSpecial(self, targetEmpire, false);
    if (researchNodeList != null && researchNodeList.length > 0) {
        const index = galaxy.rnd.next(0, researchNodeList.length);
        intelligenceMissionResetResearchProject(intelligenceMission4, researchNodeList[index]);
    } else {
        intelligenceMission4 = null;
    }
    const intelligenceMission5 = newIntelligenceMissionAgainstEmpire(self, null, T.DeepCover, currentStarDate, targetEmpire);
    let d: MissionSkillDifficulties;
    if (!flag && !checkForIntelligenceMissionsOfTypeAgainstEmpire(self, targetEmpire, T.DeepCover) && list.includes(T.DeepCover) && canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.DeepCover)) {
        d = calculateIntelligenceMissionSkill(self, agent, T.DeepCover, targetEmpire);
        if (intelligenceMissionDifficulty(intelligenceMission5) <= csInt(d.oneYearDifficulty)) return cascadeTimeLength(intelligenceMission5, d);
    }
    if (intelligenceMission4 !== null && !checkForIntelligenceMissionsOfTypeAgainstEmpire(self, targetEmpire, T.StealTechData) && list.includes(T.StealTechData) && canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.StealTechData)) {
        d = calculateIntelligenceMissionSkill(self, agent, T.StealTechData, targetEmpire);
        if (intelligenceMissionDifficulty(intelligenceMission4) <= csInt(d.oneYearDifficulty)) return cascadeTimeLength(intelligenceMission4, d);
    }
    if (!flag) {
        const habitatList = determineEmpireSystems(galaxy, targetEmpire);
        let num = 0;
        for (const item of habitatList) {
            if (self.visibility.checkSystemExplored(item.systemIndex)) num++;
        }
        const num2 = num / habitatList.length;
        if (num2 < 0.9 && !checkForIntelligenceMissionsOfTypeAgainstEmpire(self, targetEmpire, T.StealTerritoryMap) && list.includes(T.StealTerritoryMap) && canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.StealTerritoryMap)) {
            d = calculateIntelligenceMissionSkill(self, agent, T.StealTerritoryMap, targetEmpire);
            if (intelligenceMissionDifficulty(intelligenceMission) <= csInt(d.oneYearDifficulty)) return cascadeTimeLength(intelligenceMission, d);
        }
    }
    if (!flag && !checkForIntelligenceMissionsOfTypeAgainstEmpire(self, targetEmpire, T.StealOperationsMap) && list.includes(T.StealOperationsMap) && canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.StealOperationsMap)) {
        d = calculateIntelligenceMissionSkill(self, agent, T.StealOperationsMap, targetEmpire);
        if (intelligenceMissionDifficulty(intelligenceMission2) <= csInt(d.oneYearDifficulty)) return cascadeTimeLength(intelligenceMission2, d);
    }
    if (!flag && !checkForIntelligenceMissionsOfTypeAgainstEmpire(self, targetEmpire, T.StealGalaxyMap) && list.includes(T.StealGalaxyMap) && canAssignIntelligenceMissionAgainstEmpire(self, targetEmpire, evaluation, relation, pirateRelation, T.StealGalaxyMap)) {
        d = calculateIntelligenceMissionSkill(self, agent, T.StealGalaxyMap, targetEmpire);
        if (intelligenceMissionDifficulty(intelligenceMission3) <= csInt(d.oneYearDifficulty)) return cascadeTimeLength(intelligenceMission3, d);
    }
    return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.5.cs 5058-5313 permission checks. No Rnd.
// ---------------------------------------------------------------------------------------------------------------

/** Empire.5.cs 5058 CheckEspionageMissionAllowedAgainstEmpire(relation, evaluation, pirateRelation). */
function checkEspionageMissionAllowedAgainstEmpire(self: Empire, relation: DiplomaticRelation | null, evaluation: EmpireEvaluation | null, pirateRelation: PirateRelation | null): boolean {
    if (checkEspionageMissionAllowedAgainstEmpirePolicy(self, relation, evaluation, pirateRelation)) {
        if (pirateRelation === null) {
            if (relation!.type === DiplomaticRelationType.War) return true;
            switch (relation!.strategy) {
                case DiplomaticStrategy.Conquer:
                case DiplomaticStrategy.Undermine:
                case DiplomaticStrategy.DefendUndermine:
                case DiplomaticStrategy.Punish:
                    return true;
                default:
                    return false;
            }
        }
        if (pirateRelation.type === PirateRelationType.None) return true;
        if (pirateRelationEvaluation(pirateRelation) < -15) return true;
    }
    return false;
}

/** The shared body of CheckEspionage/SabotageMissionAllowedAgainstEmpirePolicy (5091 / 5182) for `useWhen`. */
function missionAllowedAgainstEmpirePolicy(self: Empire, useWhen: number, relation: DiplomaticRelation | null, evaluation: EmpireEvaluation | null, pirateRelation: PirateRelation | null): boolean {
    if (self.policy != null) {
        if (pirateRelation !== null) {
            switch (useWhen) {
                case 0:
                    return true;
                case 1:
                    if (pirateRelationEvaluation(pirateRelation) <= -10) return true;
                    break;
                case 2:
                case 3:
                case 4:
                    if (pirateRelation.type === PirateRelationType.None) return true;
                    break;
            }
        } else if (relation !== null) {
            switch (useWhen) {
                case 0:
                    return true;
                case 1:
                    if (evaluation !== null && evaluation.overallAttitude <= -10) return true;
                    break;
                case 2:
                    if (relation.type === DiplomaticRelationType.None || relation.type === DiplomaticRelationType.TradeSanctions || relation.type === DiplomaticRelationType.War) return true;
                    break;
                case 3:
                    if (relation.type === DiplomaticRelationType.TradeSanctions || relation.type === DiplomaticRelationType.War) return true;
                    break;
                case 4:
                    if (relation.type === DiplomaticRelationType.War) return true;
                    break;
            }
        }
    }
    return false;
}

/** Empire.5.cs 5091 CheckEspionageMissionAllowedAgainstEmpirePolicy. */
function checkEspionageMissionAllowedAgainstEmpirePolicy(self: Empire, relation: DiplomaticRelation | null, evaluation: EmpireEvaluation | null, pirateRelation: PirateRelation | null): boolean {
    if (self.policy == null) return false;
    return missionAllowedAgainstEmpirePolicy(self, self.policy.intelligenceUseEspionageAgainstEmpireWhen, relation, evaluation, pirateRelation);
}

/** Empire.5.cs 5153 CheckSabotageMissionAllowedAgainstEmpire(relation, evaluation, pirateRelation). */
function checkSabotageMissionAllowedAgainstEmpire(self: Empire, relation: DiplomaticRelation | null, evaluation: EmpireEvaluation | null, pirateRelation: PirateRelation | null): boolean {
    if (checkSabotageMissionAllowedAgainstEmpirePolicy(self, relation, evaluation, pirateRelation)) {
        if (pirateRelation === null) {
            if (relation!.type === DiplomaticRelationType.War) return true;
            const strategy = relation!.strategy;
            if (strategy === DiplomaticStrategy.Conquer || strategy === DiplomaticStrategy.Undermine || strategy === DiplomaticStrategy.Punish) return true;
            return false;
        }
        if (pirateRelation.type === PirateRelationType.None) return true;
        if (pirateRelationEvaluation(pirateRelation) < -20) return true;
    }
    return false;
}

/** Empire.5.cs 5182 CheckSabotageMissionAllowedAgainstEmpirePolicy. */
function checkSabotageMissionAllowedAgainstEmpirePolicy(self: Empire, relation: DiplomaticRelation | null, evaluation: EmpireEvaluation | null, pirateRelation: PirateRelation | null): boolean {
    if (self.policy == null) return false;
    return missionAllowedAgainstEmpirePolicy(self, self.policy.intelligenceUseSabotageAgainstEmpireWhen, relation, evaluation, pirateRelation);
}

/** Empire.5.cs 5244 CanAssignIntelligenceMissionAgainstEmpire(empire, evaluation, relation, pirateRelation, missionType). */
export function canAssignIntelligenceMissionAgainstEmpire(self: Empire, empire: Empire, evaluation: EmpireEvaluation | null, relation: DiplomaticRelation | null, pirateRelation: PirateRelation | null, missionType: IntelligenceMissionType): boolean {
    void empire;
    const p = self.policy!;
    switch (missionType) {
        case T.CounterIntelligence:
            return true;
        case T.DeepCover:
            if (p.intelligenceAllowMissionDeepCover) return checkEspionageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
        case T.AssassinateCharacter:
            if (p.intelligenceAllowMissionAssassinateCharacter) return checkSabotageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
        case T.DestroyBase:
            if (p.intelligenceAllowMissionDestroyBase) return checkSabotageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
        case T.InciteRevolution:
            if (p.intelligenceAllowMissionInciteRevolution) return checkSabotageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
        case T.SabotageColony:
            if (p.intelligenceAllowMissionSabotageColony) return checkSabotageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
        case T.SabotageConstruction:
            if (p.intelligenceAllowMissionSabotageConstruction) return checkSabotageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
        case T.StealGalaxyMap:
            if (p.intelligenceAllowMissionStealGalaxyMap) return checkEspionageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
        case T.StealOperationsMap:
            if (p.intelligenceAllowMissionStealOperationsMap) return checkEspionageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
        case T.StealTechData:
            if (p.intelligenceAllowMissionStealTechData) return checkEspionageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
        case T.StealTerritoryMap:
            if (p.intelligenceAllowMissionStealTerritoryMap) return checkEspionageMissionAllowedAgainstEmpire(self, relation, evaluation, pirateRelation);
            break;
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Assignment: Empire.5.cs 5314-5550, Empire.6.cs 426-490
// ---------------------------------------------------------------------------------------------------------------

/**
 * Empire.5.cs 5314 AssignSpecialMissionAgainstEmpire(targetEmpire, evaluation, out espionage, out sabotage, aggression,
 * caution, empiresAtWarWith, galaxyIntoleranceLevel, ref refusalCount). aggression / caution / empiresAtWarWith /
 * intolerance are unused by the C#. Rnd: Next(0, 3) when at war (or a hostile pirate relation) or with an
 * undermining strategy, then the draws of the mission search.
 */
function assignSpecialMissionAgainstEmpire(galaxy: Galaxy, self: Empire, targetEmpire: Empire | null, evaluation: EmpireEvaluation | null, refusalCount: RefCount): { espionage: boolean; sabotage: boolean } {
    const out = { espionage: false, sabotage: false };
    if (targetEmpire === self || targetEmpire === null) return out;
    let diplomaticRelation: DiplomaticRelation | null = null;
    let pirateRelation: PirateRelation | null = null;
    if (self.pirateEmpireBaseHabitat === null && targetEmpire.pirateEmpireBaseHabitat === null) diplomaticRelation = obtainDiplomaticRelation(self, targetEmpire);
    else pirateRelation = obtainPirateRelation(self, targetEmpire);
    if (
        (diplomaticRelation !== null && diplomaticRelation.type === DiplomaticRelationType.War) ||
        (pirateRelation !== null && pirateRelation.type === PirateRelationType.None && pirateRelationEvaluation(pirateRelation) < -5)
    ) {
        switch (galaxy.rnd.next(0, 3)) {
            case 0:
                if (assignAgentForEspionageMission(galaxy, self, targetEmpire, evaluation, diplomaticRelation, pirateRelation, refusalCount)) out.espionage = true;
                break;
            case 1:
                if (assignAgentForSabotageMission(galaxy, self, targetEmpire, evaluation, diplomaticRelation, pirateRelation, refusalCount)) out.sabotage = true;
                break;
        }
    } else {
        if (
            (diplomaticRelation === null ||
                (diplomaticRelation.strategy !== DiplomaticStrategy.Punish &&
                    diplomaticRelation.strategy !== DiplomaticStrategy.Conquer &&
                    diplomaticRelation.strategy !== DiplomaticStrategy.DefendUndermine &&
                    diplomaticRelation.strategy !== DiplomaticStrategy.Undermine)) &&
            (pirateRelation === null || pirateRelation.type !== PirateRelationType.None || !(pirateRelationEvaluation(pirateRelation) < -5))
        ) {
            return out;
        }
        switch (galaxy.rnd.next(0, 3)) {
            case 0:
                if (assignAgentForEspionageMission(galaxy, self, targetEmpire, evaluation, diplomaticRelation, pirateRelation, refusalCount)) out.espionage = true;
                break;
            case 1:
                if (diplomaticRelation !== null && diplomaticRelation.strategy !== DiplomaticStrategy.DefendUndermine && assignAgentForSabotageMission(galaxy, self, targetEmpire, evaluation, diplomaticRelation, pirateRelation, refusalCount)) out.sabotage = true;
                break;
        }
    }
    return out;
}

/** Empire.5.cs 5375 CountAgentsAssigned(out attack, out defend, out unassigned) — counts every character (not only agents). */
export function countAgentsAssigned(self: Empire): { attackAgentsOnAssignment: number; defendAgentsOnAssignment: number; unassignedAgents: number } {
    let attackAgentsOnAssignment = 0;
    let defendAgentsOnAssignment = 0;
    let unassignedAgents = 0;
    const chars = getEmpireCharacters(self);
    for (let i = 0; i < chars.length; i++) {
        const m = characterMission(chars[i]);
        if (m !== null && m.type !== T.Undefined) {
            if (m.type === T.CounterIntelligence) defendAgentsOnAssignment++;
            else attackAgentsOnAssignment++;
        } else {
            unassignedAgents++;
        }
    }
    return { attackAgentsOnAssignment, defendAgentsOnAssignment, unassignedAgents };
}

/** Empire.10.cs 3707 GenerateAutomationMessageAgentMission(mission). No Rnd. */
function generateAutomationMessageAgentMission(self: Empire, mission: IntelligenceMission): string {
    let arg = '';
    if (mission.targetEmpire !== null) arg = mission.targetEmpire.name;
    return gameText('Automation Intelligence Mission', mission.agent!.name, arg, resolveIntelligenceMissionDescription(mission, self));
}

/** BaconEmpire.cs 113 OverrideTimeForMission(originEmpire, mission): "Romulan" empires run 2-week missions. */
function baconOverrideTimeForMission(originEmpire: Empire | null, mission: IntelligenceMission | null): IntelligenceMission | null {
    if (mission === null || originEmpire === null || !isRomulan(originEmpire)) return mission;
    mission.timeLength = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 24);
    return mission;
}

/** Empire.6.cs 426 AssignAgentForEspionageMission(targetEmpire, evaluation, relation, pirateRelation, ref refusalCount). */
function assignAgentForEspionageMission(galaxy: Galaxy, self: Empire, targetEmpire: Empire, evaluation: EmpireEvaluation | null, relation: DiplomaticRelation | null, pirateRelation: PirateRelation | null, refusalCount: RefCount): boolean {
    const chars = getEmpireCharacters(self);
    for (let i = 0; i < chars.length; i++) {
        const character = chars[i];
        const cm = characterMission(character);
        if (character.role !== CharacterRole.IntelligenceAgent || (cm !== null && cm.type !== T.Undefined && cm.type !== T.CounterIntelligence)) continue;
        let mission = determineEspionageMission(galaxy, self, targetEmpire, evaluation, relation, pirateRelation, character);
        mission = baconOverrideTimeForMission(self, mission);
        if (mission !== null) {
            mission.agent = character;
            if (checkTaskAuthorized(galaxy, self, self.controlAgentAssignment, refusalCount, generateAutomationMessageAgentMission(self, mission), mission, AdvisorMessageType.IntelligenceMission, mission.targetEmpire, character, null)) {
                character.mission = mission;
                return true;
            }
            mission.agent = null;
        }
    }
    return false;
}

/** Empire.6.cs 451 CheckForIntelligenceMissionsOfTypeAgainstEmpire(targetEmpire, missionType). No Rnd. */
export function checkForIntelligenceMissionsOfTypeAgainstEmpire(self: Empire, targetEmpire: Empire, missionType: IntelligenceMissionType): boolean {
    const chars = getEmpireCharacters(self);
    for (let i = 0; i < chars.length; i++) {
        const m = characterMission(chars[i]);
        if (m !== null && m.type !== T.Undefined && m.targetEmpire === targetEmpire && m.type === missionType) return true;
    }
    return false;
}

/** Empire.6.cs 464 AssignAgentForSabotageMission(targetEmpire, evaluation, relation, pirateRelation, ref refusalCount). */
function assignAgentForSabotageMission(galaxy: Galaxy, self: Empire, targetEmpire: Empire, evaluation: EmpireEvaluation | null, relation: DiplomaticRelation | null, pirateRelation: PirateRelation | null, refusalCount: RefCount): boolean {
    const chars = getEmpireCharacters(self);
    for (let i = 0; i < chars.length; i++) {
        const character = chars[i];
        const cm = characterMission(character);
        if (character.role !== CharacterRole.IntelligenceAgent || (cm !== null && cm.type !== T.Undefined && cm.type !== T.CounterIntelligence)) continue;
        const intelligenceMission = determineSabotageMission(galaxy, self, targetEmpire, evaluation, relation, pirateRelation, character);
        if (intelligenceMission !== null) {
            intelligenceMission.agent = character;
            if (checkTaskAuthorized(galaxy, self, self.controlAgentAssignment, refusalCount, generateAutomationMessageAgentMission(self, intelligenceMission), intelligenceMission, AdvisorMessageType.IntelligenceMission, intelligenceMission.targetEmpire, character, null)) {
                character.mission = intelligenceMission;
                return true;
            }
            intelligenceMission.agent = null;
        }
    }
    return false;
}

/** A fresh CounterIntelligence mission of 3 months (Empire.5.cs 5542 / 5866, BaconEmpire.cs 660). */
export function newCounterIntelligenceMission(galaxy: Galaxy, empire: Empire | null, agent: Character): IntelligenceMission {
    const intelligenceMission = new IntelligenceMission(empire, agent, galaxyCurrentStarDate(galaxy));
    intelligenceMission.timeLength = TIME_THREE_MONTHS;
    return intelligenceMission;
}

/**
 * Empire.5.cs 5401 AssignSpecialMissions. Rnd: Next(0, EmpireEvaluations.Count) (non-pirates) and
 * Next(0, PirateRelations.Count) (when agents are still free), plus the draws of each AssignSpecialMissionAgainstEmpire.
 */
export function assignSpecialMissions(galaxy: Galaxy, self: Empire): void {
    const refusalCount: RefCount = { value: 0 };
    const characterList: Character[] = [];
    const chars = getEmpireCharacters(self);
    for (let i = 0; i < chars.length; i++) {
        const character = chars[i];
        if (character.role === CharacterRole.IntelligenceAgent) characterList.push(character);
    }
    const num = Math.fround(self.policy!.intelligenceCounterIntelligenceProportion / 100);
    const num2 = csInt(Math.max(1.0, characterList.length * num));
    const num3 = characterList.length - num2;
    // aggression / caution / _Galaxy.IntoleranceLevel are passed to AssignSpecialMissionAgainstEmpire, which ignores them.
    calculateAggressionFactor(galaxy, self);
    calculateCautionFactor(galaxy, self);
    const counts = countAgentsAssigned(self);
    let num4 = num3 - counts.attackAgentsOnAssignment;
    if (num4 > 0) {
        // empiresAtWarWith (unused by the callee).
        void (countEmpiresWeDeclaredWarOn(self) + countEmpiresWhoDeclaredWarOnUs(self));
        const tryEmpire = (target: Empire | null, evaluation: EmpireEvaluation | null): void => {
            const r = assignSpecialMissionAgainstEmpire(galaxy, self, target, evaluation, refusalCount);
            if (r.espionage || r.sabotage) num4--;
        };
        if (self.pirateEmpireBaseHabitat === null) {
            const evaluations = empireEvaluationsOf(self);
            let num5 = galaxy.rnd.next(0, evaluations.length);
            for (let j = num5; j < evaluations.length; j++) {
                const empireEvaluation = evaluations[j];
                tryEmpire(empireEvaluation.empire, empireEvaluation);
                if (num4 <= 0) break;
            }
            if (num4 > 0) {
                for (let k = 0; k < num5; k++) {
                    const empireEvaluation2 = evaluations[k];
                    tryEmpire(empireEvaluation2.empire, empireEvaluation2);
                    if (num4 <= 0) break;
                }
            }
            if (num4 > 0) {
                num5 = galaxy.rnd.next(0, self.pirateRelations.count);
                for (let l = num5; l < self.pirateRelations.count; l++) {
                    tryEmpire(self.pirateRelations.get(l).otherEmpire, null);
                    if (num4 <= 0) break;
                }
                if (num4 > 0) {
                    for (let m = 0; m < num5; m++) {
                        tryEmpire(self.pirateRelations.get(m).otherEmpire, null);
                        if (num4 <= 0) break;
                    }
                }
            }
        } else {
            const num6 = galaxy.rnd.next(0, self.pirateRelations.count);
            for (let n = num6; n < self.pirateRelations.count; n++) {
                tryEmpire(self.pirateRelations.get(n).otherEmpire, null);
                if (num4 <= 0) break;
            }
            if (num4 > 0) {
                for (let num7 = 0; num7 < num6; num7++) {
                    tryEmpire(self.pirateRelations.get(num7).otherEmpire, null);
                    if (num4 <= 0) break;
                }
            }
        }
    }
    for (let num8 = 0; num8 < chars.length; num8++) {
        const character2 = chars[num8];
        const m = characterMission(character2);
        if (character2.role === CharacterRole.IntelligenceAgent && (m === null || m.type === T.Undefined)) {
            character2.mission = newCounterIntelligenceMission(galaxy, self, character2);
        }
    }
}

/** Empire.5.cs 5551 GetIntelligenceMissionSkillLevel(agent, mission). No Rnd. */
export function getIntelligenceMissionSkillLevel(agent: Character | null, mission: IntelligenceMission | null): number {
    let num = 0;
    if (agent !== null && mission !== null) num = agentSkillForMission(agent, mission.type, mission.targetEmpire);
    return num;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.5.cs 5597 PerformIntelligenceMissions
// ---------------------------------------------------------------------------------------------------------------

/** Empire.10.cs 16 MarkEmpireAsRecentSpy(spy, target) — read by EvaluatePoliticalSituation (diplomacyTick.ts). */
export function markEmpireAsRecentSpy(galaxy: Galaxy, spy: Empire | null, target: Empire | null): void {
    if (target !== null && target !== galaxy.independentEmpire && spy !== null && spy !== galaxy.independentEmpire && !target.recentSpyingEmpires.includes(spy)) {
        target.recentSpyingEmpires.push(spy);
    }
}

/** Empire.CivilityRating -= 1 + n / 8 (the setter clamps; diplomacyTick.ts setCivilityRating). */
function lowerCivility(empire: Empire, n: number): void {
    setCivilityRating(empire, empire.civilityRating - (1 + Math.trunc(n / 8)));
}

/** BaconEmpire.cs 655 ResetSpyMission(spiesToBeKilledOrCaptured, spy) (BaconBuiltObject.myMain is set in a running game). */
function baconResetSpyMission(galaxy: Galaxy, spiesToBeKilledOrCaptured: Character[], spy: Character): void {
    if (spiesToBeKilledOrCaptured.includes(spy)) return;
    spy.mission = null;
    spy.mission = newCounterIntelligenceMission(galaxy, spy.empire, spy);
}

/** The per-mission-type character event of PerformIntelligenceMissions (espionage vs sabotage). */
function isEspionageType(type: IntelligenceMissionType): boolean {
    return type === T.StealGalaxyMap || type === T.StealOperationsMap || type === T.StealTechData || type === T.DeepCover || type === T.StealTerritoryMap;
}
function isSabotageType(type: IntelligenceMissionType): boolean {
    return type === T.SabotageConstruction || type === T.SabotageColony || type === T.InciteRevolution || type === T.AssassinateCharacter || type === T.DestroyBase;
}

/**
 * Empire.5.cs 5597 PerformIntelligenceMissions. Rnd per own agent: CounterIntelligence with enemy agents present:
 * Next(0, 150|450|1800) [PredictiveHistory: Next(0, 100)], on detection Next(0, enemyAgents), NextDouble,
 * [deep-cover target: Next(0, 4|2)], then the character-event draws; other missions due: NextDouble (outcome, unless the
 * target is "Romulan"), NextDouble (discarded), then the character events and CompleteIntelligenceMission's draws.
 * BaconCharacter.Kill's clock-seeded Random (spy capture) is a galaxy-seeded stream (espionagePrisoners.ts).
 */
export function performIntelligenceMissions(galaxy: Galaxy, self: Empire): void {
    const currentStarDate = galaxyCurrentStarDate(galaxy);
    const num = TIME_ONE_MONTH;
    const num2 = TIME_THREE_MONTHS;
    const num3 = TIME_ONE_YEAR;
    const characterList: Character[] = [];
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire === self) continue;
        const ec = getEmpireCharacters(empire);
        for (let j = 0; j < ec.length; j++) {
            const character = ec[j];
            if (character != null && character.role === CharacterRole.IntelligenceAgent) {
                const mission = characterMission(character);
                if (mission !== null && mission.type !== T.Undefined && mission.targetEmpire === self) characterList.push(character);
            }
        }
    }
    for (let k = 0; k < galaxy.pirateEmpires.length; k++) {
        const empire2 = galaxy.pirateEmpires[k];
        if (empire2 === self) continue;
        const ec = getEmpireCharacters(empire2);
        for (let l = 0; l < ec.length; l++) {
            const character2 = ec[l];
            if (character2 != null && character2.role === CharacterRole.IntelligenceAgent) {
                const mission2 = characterMission(character2);
                if (mission2 !== null && mission2.type !== T.Undefined && mission2.targetEmpire === self) characterList.push(character2);
            }
        }
    }
    const characterList2: Character[] = [];
    const chars = getEmpireCharacters(self);
    for (let m = 0; m < chars.length; m++) {
        const character3 = chars[m];
        if (character3 == null || character3.role !== CharacterRole.IntelligenceAgent) continue;
        const mission3 = characterMission(character3);
        if (mission3 === null || mission3.type === T.Undefined) continue;
        let num4 = agentSkillForMission(character3, mission3.type, mission3.targetEmpire);
        const num5 = calculateIntelligenceMissionBonusFromLeaderAndAmbassador(self, mission3.type, mission3.targetEmpire);
        num4 = csInt(num4 * num5);
        // num6 (skill × 1/2/4 by mission length × (1 + EspionageBonus)) is computed but never read (5715-5728).
        const num7 = mission3.startDate + mission3.timeLength;
        let flag = true;
        if (self.pirateEmpireBaseHabitat === null && mission3.targetEmpire!.pirateEmpireBaseHabitat === null) {
            const diplomaticRelation = obtainDiplomaticRelation(self, mission3.targetEmpire);
            if (diplomaticRelation.type === DiplomaticRelationType.War) flag = false;
        } else {
            const pirateRelation = obtainPirateRelation(self, mission3.targetEmpire);
            if (pirateRelation.type === PirateRelationType.None) flag = false;
        }
        const type = mission3.type;
        if (type === T.CounterIntelligence) {
            if (characterList.length > 0) {
                let num8 = 150;
                if (mission3.timeLength >= num3) num8 *= 12;
                else if (mission3.timeLength >= num2) num8 *= 3;
                let num9 = galaxy.rnd.next(0, num8);
                const num10 = csInt(num4 * (1.0 + self.espionageBonus));
                if (self.raceEventType === RaceEventType.PredictiveHistory) num9 = galaxy.rnd.next(0, 100);
                if (num10 > num9) {
                    const index = galaxy.rnd.next(0, characterList.length);
                    const character4 = characterList[index];
                    const c4Mission = characterMission(character4);
                    if (c4Mission !== null) {
                        const num11 = calculateIntelligenceMissionSuccessChance(self, c4Mission, character4);
                        let num12 = 0.85;
                        if (self.raceEventType === RaceEventType.PredictiveHistory) num12 = 1.15;
                        const intelligenceMissionSkillLevel = getIntelligenceMissionSkillLevel(character4, c4Mission);
                        const num13 = Math.max(5.0, intelligenceMissionSkillLevel - 10.0);
                        const num14 = galaxy.rnd.nextDouble() * num12 * Math.sqrt(num10 / num13);
                        // BaconEmpire.cs 43 PerformIntelligenceMission(this): always true.
                        if (num14 > num11 && baconPerformIntelligenceMission(self)) {
                            let flag2 = false;
                            let flag3 = false;
                            if (characterMission(character4) !== null && characterMission(character4)!.type === T.DeepCover && characterMission(character4)!.outcome === O.SucceedNotDetect) {
                                let maxValue = 4;
                                if (self.raceEventType === RaceEventType.PredictiveHistory) maxValue = 2;
                                if (galaxy.rnd.next(0, maxValue) === 1) flag2 = true;
                                flag3 = true;
                            } else {
                                flag2 = true;
                            }
                            if (!flag2) continue;
                            let num15 = 5;
                            if (characterMission(character4) !== null) num15 = Math.min(30, Math.trunc(intelligenceMissionDifficulty(characterMission(character4)!) / 30));
                            const c4Empire = character4.empire!;
                            if (c4Empire.pirateEmpireBaseHabitat === null && self.pirateEmpireBaseHabitat === null) {
                                const empireEvaluation = empireEvaluationByEmpire(empireEvaluationsOf(self), c4Empire);
                                if (empireEvaluation !== null) empireEvaluation.incidentEvaluation = empireEvaluation.incidentEvaluationRaw - num15;
                                const diplomaticRelation2 = obtainDiplomaticRelation(self, c4Empire);
                                if (diplomaticRelation2.type !== DiplomaticRelationType.War && character4.empire !== null) lowerCivility(character4.empire, num15);
                            } else if (character4.empire !== null) {
                                const pirateRelation2 = obtainPirateRelation(self, character4.empire);
                                pirateRelation2.evaluationDetectedIntelligenceMissions = Math.fround(pirateRelation2.evaluationDetectedIntelligenceMissions - num15);
                                if (pirateRelation2.type === PirateRelationType.Protection && character4.empire !== null) lowerCivility(character4.empire, num15);
                            }
                            if (characterMission(character4) !== null && characterMission(character4)!.type === T.DeepCover) {
                                const viewable = character4.empire!.empiresViewable;
                                const expiry = character4.empire!.empiresViewableExpiry;
                                let num16 = viewable.indexOf(self);
                                while (num16 >= 0 && expiry[num16] !== LONG_MAX_VALUE) num16 = viewable.indexOf(self, num16 + 1);
                                if (num16 >= 0) {
                                    viewable.splice(num16, 1);
                                    expiry.splice(num16, 1);
                                }
                            }
                            const c4m = characterMission(character4);
                            if (c4m !== null && c4m.type === T.AssassinateCharacter && targetIsCharacter(c4m)) {
                                const character5 = intelligenceMissionTarget(c4m) as Character;
                                if (character5 !== null) doCharacterEvent(galaxy, CharacterEventType.TargetOfFailedAssassination, character4, character5);
                            }
                            doCharacterEvent(galaxy, CharacterEventType.IntelligenceMissionInterceptEnemy, character4, character3, true, character3.empire);
                            self.counters.processIntelligenceMissionOutcome(mission3, O.SucceedNotDetect);
                            character4.empire!.counters.processIntelligenceMissionOutcome(characterMission(character4), O.Capture);
                            if (character4.empire !== null) {
                                let arg = resolveIntelligenceMissionDescription(characterMission(character4), character4.empire);
                                let description = gameText('Our Agent Captured', character4.name, arg);
                                sendMessageToEmpire(character4.empire, character4.empire, EmpireMessageType.CharacterDeath, character4, description);
                                arg = resolveIntelligenceMissionDescription(characterMission(character4), self);
                                description = gameText('Enemy Agent Captured', character4.name, character4.empire.name, arg);
                                if (flag3) description = gameText('Enemy Deep Cover Agent Captured', character4.name, character4.empire.name);
                                sendMessageToEmpire(self, self, EmpireMessageType.CharacterDeath, character4, description);
                            }
                            if (self.counters != null) self.counters.processCharacterDeath(character4);
                            characterKillFromPerformIntelligenceMissions(galaxy, character4);
                            continue;
                        }
                    }
                }
            }
            if (currentStarDate >= num7) {
                character3.mission = null;
                character3.mission = newCounterIntelligenceMission(galaxy, self, character3);
            }
        } else if (mission3.type === T.DeepCover && mission3.outcome === O.SucceedNotDetect) {
            mergeGalaxyMap(galaxy, mission3.targetEmpire, self);
        } else {
            if (currentStarDate < num7) continue;
            const intelligenceMissionOutcome = determineIntelligenceMissionOutcome(galaxy, self, mission3, character3);
            self.counters.processIntelligenceMissionOutcome(mission3, intelligenceMissionOutcome);
            if (mission3.type !== T.CounterIntelligence) {
                switch (intelligenceMissionOutcome) {
                    case O.FailDetect:
                    case O.Capture:
                        if (mission3.targetEmpire !== null && mission3.targetEmpire.counters != null) mission3.targetEmpire.counters.intelligenceMissionSuccessCounterIntelligenceCount++;
                        break;
                }
            }
            const num17 = Math.min(30, Math.trunc(intelligenceMissionDifficulty(mission3) / 8));
            mission3.outcome = intelligenceMissionOutcome;
            const targetEmpire = mission3.targetEmpire!;
            let empireEvaluation2: EmpireEvaluation | null = null;
            let pirateRelation3: PirateRelation | null = null;
            if (targetEmpire.pirateEmpireBaseHabitat === null && self.pirateEmpireBaseHabitat === null) empireEvaluation2 = obtainEmpireEvaluation(galaxy, targetEmpire, self);
            else pirateRelation3 = obtainPirateRelation(targetEmpire, self);
            let empty = '';
            // 5910: `Galaxy.Rnd.NextDouble(); _ = EspionageBonus; _ = (double)mission3.Difficulty / 10.0;` — a discarded draw.
            galaxy.rnd.nextDouble();
            const applyIncident = (): void => {
                if (empireEvaluation2 !== null) empireEvaluation2.incidentEvaluation = empireEvaluation2.incidentEvaluationRaw - num17;
                else if (pirateRelation3 !== null) pirateRelation3.evaluationDetectedIntelligenceMissions = Math.fround(pirateRelation3.evaluationDetectedIntelligenceMissions - num17);
                if (flag) lowerCivility(character3.empire!, num17);
            };
            switch (intelligenceMissionOutcome) {
                case O.Capture: {
                    markEmpireAsRecentSpy(galaxy, character3.empire, targetEmpire);
                    applyIncident();
                    characterList2.push(character3);
                    doCharacterEvent(galaxy, CharacterEventType.IntelligenceAgentOursCaptured, character3, character3, true, character3.empire);
                    if (mission3 !== null && mission3.type === T.AssassinateCharacter && targetIsCharacter(mission3)) {
                        const character7 = intelligenceMissionTarget(mission3) as Character;
                        if (character7 !== null) doCharacterEvent(galaxy, CharacterEventType.TargetOfFailedAssassination, character3, character7);
                    }
                    empty = gameText('Our Agent Captured In Act', character3.name, resolveIntelligenceMissionDescription(mission3, self));
                    sendMessageToEmpire(self, self, EmpireMessageType.CharacterDeath, character3, empty);
                    empty = gameText('Enemy Agent Captured In Act', character3.name, self.name, resolveIntelligenceMissionDescription(mission3, targetEmpire));
                    sendMessageToEmpire(targetEmpire, targetEmpire, EmpireMessageType.CharacterDeath, character3, empty);
                    break;
                }
                case O.FailDetect: {
                    markEmpireAsRecentSpy(galaxy, character3.empire, targetEmpire);
                    applyIncident();
                    if (isEspionageType(mission3.type)) doCharacterEvent(galaxy, CharacterEventType.IntelligenceMissionFailEspionage, mission3, character3, true, character3.empire);
                    else if (isSabotageType(mission3.type)) doCharacterEvent(galaxy, CharacterEventType.IntelligenceMissionFailSabotage, mission3, character3, true, character3.empire);
                    if (mission3 !== null && mission3.type === T.AssassinateCharacter && targetIsCharacter(mission3)) {
                        const character6 = intelligenceMissionTarget(mission3) as Character;
                        if (character6 !== null) doCharacterEvent(galaxy, CharacterEventType.TargetOfFailedAssassination, character3, character6);
                    }
                    empty = gameText('Our Agent Detect Fail', character3.name, resolveIntelligenceMissionDescription(mission3, self));
                    sendMessageToEmpire(self, self, EmpireMessageType.CharacterMissionFailure, character3, empty);
                    empty = gameText('Enemy Agent Detect Fail', character3.name, self.name, resolveIntelligenceMissionDescription(mission3, targetEmpire));
                    sendMessageToEmpire(targetEmpire, targetEmpire, EmpireMessageType.CharacterMissionFailure, character3, empty);
                    break;
                }
                case O.SucceedDetect: {
                    markEmpireAsRecentSpy(galaxy, character3.empire, targetEmpire);
                    if (isEspionageType(mission3.type) || mission3.type === T.CounterIntelligence) {
                        const characterList3: Character[] = [];
                        characterList3.push(character3);
                        if (mission3.type === T.StealTechData && mission3.targetEmpire !== null) characterList3.push(...getCharactersByRole(getEmpireCharacters(mission3.targetEmpire), CharacterRole.Scientist));
                        doCharacterEventForList(galaxy, CharacterEventType.IntelligenceMissionSucceedEspionage, mission3, characterList3, true, character3.empire);
                    } else if (isSabotageType(mission3.type)) {
                        doCharacterEvent(galaxy, CharacterEventType.IntelligenceMissionSucceedSabotage, mission3, character3);
                    }
                    applyIncident();
                    empty = gameText('Our Agent Detect Succeed', character3.name, resolveIntelligenceMissionDescription(mission3, self));
                    completeIntelligenceMission(galaxy, self, mission3);
                    sendMessageToEmpire(self, self, EmpireMessageType.CharacterMissionAccomplished, character3, empty);
                    empty = gameText('Enemy Agent Detect Succeed', character3.name, self.name, resolveIntelligenceMissionDescription(mission3, targetEmpire));
                    sendMessageToEmpire(targetEmpire, targetEmpire, EmpireMessageType.CharacterMissionFailure, character3, empty);
                    break;
                }
                case O.FailNotDetect: {
                    if (isEspionageType(mission3.type)) doCharacterEvent(galaxy, CharacterEventType.IntelligenceMissionFailEspionage, mission3, character3, true, character3.empire);
                    else if (isSabotageType(mission3.type)) doCharacterEvent(galaxy, CharacterEventType.IntelligenceMissionFailSabotage, mission3, character3, true, character3.empire);
                    empty = gameText('Our Agent Fail', character3.name, resolveIntelligenceMissionDescription(mission3, self));
                    sendMessageToEmpire(self, self, EmpireMessageType.CharacterMissionFailure, character3, empty);
                    break;
                }
                case O.SucceedNotDetect: {
                    if (isEspionageType(mission3.type) || mission3.type === T.CounterIntelligence) doCharacterEvent(galaxy, CharacterEventType.IntelligenceMissionSucceedEspionage, mission3, character3);
                    else if (isSabotageType(mission3.type)) doCharacterEvent(galaxy, CharacterEventType.IntelligenceMissionSucceedSabotage, mission3, character3);
                    empty = gameText('Our Agent Succeed', character3.name, resolveIntelligenceMissionDescription(mission3, self));
                    completeIntelligenceMission(galaxy, self, mission3);
                    sendMessageToEmpire(self, self, EmpireMessageType.CharacterMissionAccomplished, character3, empty);
                    if (targetEmpire.pirateEmpireBaseHabitat !== null) break;
                    if (mission3.type === T.InciteRevolution) {
                        const ga = empireGovernmentAttributes(targetEmpire);
                        const description2 = gameText('Agent Revolution', ga!.name);
                        sendMessageToEmpire(targetEmpire, targetEmpire, EmpireMessageType.Revolution, null, description2);
                    } else if (mission3.type === T.SabotageColony && intelligenceMissionTarget(mission3) !== null && targetIsHabitat(mission3)) {
                        const habitat = intelligenceMissionTarget(mission3) as Habitat;
                        if (habitat !== null) {
                            const description3 = gameText('Agent Rebellion', habitat.name);
                            sendMessageToEmpire(targetEmpire, targetEmpire, EmpireMessageType.ColonyRebelling, habitat, description3);
                        }
                    }
                    break;
                }
            }
            if (mission3.type !== T.DeepCover || mission3.outcome !== O.SucceedNotDetect) baconResetSpyMission(galaxy, characterList2, character3);
        }
    }
    for (const item of characterList2) {
        if (self.counters != null) self.counters.processCharacterDeath(item);
        characterKillFromPerformIntelligenceMissions(galaxy, item);
    }
}

/** BaconEmpire.cs 43 PerformIntelligenceMission(empire): true (both branches). */
function baconPerformIntelligenceMission(empire: Empire): boolean {
    let flag = true;
    if (isRomulan(empire)) flag = true;
    return flag;
}

// ---------------------------------------------------------------------------------------------------------------
// Empire.6.cs 16-343
// ---------------------------------------------------------------------------------------------------------------

/**
 * Empire.6.cs 16 DetermineIntelligenceMissionOutcome → BaconEmpire.cs 88 DetermineIntelligenceMissionOutcome(empire,
 * mission, agent). Rnd: NextDouble (not drawn when the target empire's name contains "Romulan": always Capture).
 */
export function determineIntelligenceMissionOutcome(galaxy: Galaxy, self: Empire, mission: IntelligenceMission, agent: Character): IntelligenceMissionOutcome {
    const flag = isRomulan(self);
    if (mission.targetEmpire!.name.includes('Romulan')) return O.Capture;
    const missionSuccessChance = calculateIntelligenceMissionSuccessChance(self, mission, agent);
    const num1 = galaxy.rnd.nextDouble();
    let intelligenceMissionOutcome: IntelligenceMissionOutcome;
    if (num1 >= missionSuccessChance) {
        const num2 = missionSuccessChance + (1.0 - missionSuccessChance) * 0.9;
        const num3 = missionSuccessChance + (1.0 - missionSuccessChance) * 0.6;
        const num4 = missionSuccessChance + (1.0 - missionSuccessChance) * 0.25;
        intelligenceMissionOutcome = num1 <= num2 ? (num1 <= num3 ? (num1 <= num4 ? O.FailNotDetect : O.SucceedDetect) : O.FailDetect) : flag ? O.FailDetect : O.Capture;
    } else {
        intelligenceMissionOutcome = O.SucceedNotDetect;
    }
    if (mission.type === T.DeepCover && intelligenceMissionOutcome === O.SucceedDetect) intelligenceMissionOutcome = O.FailNotDetect;
    return intelligenceMissionOutcome;
}

/** Empire.6.cs 21 CalculateIntelligenceMissionSuccessChance(mission, agent). No Rnd. */
export function calculateIntelligenceMissionSuccessChance(self: Empire, mission: IntelligenceMission | null, agent: Character | null): number {
    let result = 0.0;
    if (mission !== null && agent !== null) {
        let num4 = 1;
        if (mission.timeLength <= TIME_ONE_MONTH) num4 = 1;
        else if (mission.timeLength <= TIME_THREE_MONTHS) num4 = 2;
        else if (mission.timeLength <= TIME_ONE_YEAR) num4 = 4;
        let num5 = agentSkillForMission(agent, mission.type, mission.targetEmpire);
        const num6 = calculateIntelligenceMissionBonusFromLeaderAndAmbassador(self, mission.type, mission.targetEmpire);
        num5 = csInt(num5 * num6);
        let num7 = num5 * num4;
        num7 *= 1.0 + self.espionageBonus;
        const num8 = num7 / intelligenceMissionDifficulty(mission);
        result = !(num8 > 1.0) ? 0.7 * num8 : 1.0 - 0.3 / num8;
    }
    return result;
}

/** Empire.6.cs 90 CancelIntelligenceMission(mission): a cancelled deep-cover mission drops its permanent view of the target. */
export function cancelIntelligenceMission(self: Empire, mission: IntelligenceMission): void {
    const type = mission.type;
    if (type !== T.DeepCover) return;
    let num = 0;
    let flag = false;
    const viewable = self.empiresViewable;
    const expiry = self.empiresViewableExpiry;
    let num2 = viewable.indexOf(mission.targetEmpire!);
    while (num2 >= 0 && expiry.length > num2 && !flag && num < 10) {
        const num3 = expiry[num2];
        if (num3 === LONG_MAX_VALUE) {
            viewable.splice(num2, 1);
            expiry.splice(num2, 1);
            flag = true;
        } else if (viewable.length > num2 + 1) {
            num2 = viewable.indexOf(mission.targetEmpire!, num2 + 1);
        }
        num++;
    }
}

/**
 * Empire.6.cs 117 CompleteIntelligenceMission(mission). Rnd: SabotageColony Next(0, 20), Next(0, pop/15), NextDouble (+ the
 * ColonyDevelopmentDecrease character events); SabotageConstruction per yard Next(0, 4) then per normal component
 * Next(0, 6) (or the InflictDamage draws); StealTechData without a target project Next(0, projects); DestroyBase the
 * InflictDamage draws; InciteRevolution HaveRevolution's.
 */
export function completeIntelligenceMission(galaxy: Galaxy, self: Empire, mission: IntelligenceMission): void {
    switch (mission.type) {
        case T.DeepCover: {
            const item = LONG_MAX_VALUE;
            self.empiresViewable.push(mission.targetEmpire!);
            self.empiresViewableExpiry.push(item);
            break;
        }
        case T.InciteRevolution:
            if (mission.targetEmpire!.pirateEmpireBaseHabitat === null) haveRevolution(galaxy, mission.targetEmpire!, mission.targetEmpire!.dominantRace, -1, 1.0);
            break;
        case T.AssassinateCharacter:
            if (targetIsCharacter(mission)) {
                const character = intelligenceMissionTarget(mission) as Character;
                if (character !== null && character.active) {
                    characterSendDeathMessage(galaxy, character, CharacterDeathType.Assassination);
                    character.kill(galaxy);
                }
            }
            break;
        case T.DestroyBase: {
            if (!targetIsBuiltObject(mission)) break;
            const builtObject2 = intelligenceMissionTarget(mission) as BuiltObject;
            if (builtObject2 === null || builtObject2.hasBeenDestroyed) break;
            if (builtObject2.empire !== null) {
                let habitat4: Habitat | null = null;
                if (builtObject2.parentHabitat !== null) habitat4 = galaxy.determineHabitatSystemStar(builtObject2.parentHabitat);
                else if (builtObject2.nearestSystemStar !== null) habitat4 = builtObject2.nearestSystemStar;
                let arg2 = '';
                if (habitat4 !== null) arg2 = habitat4.name;
                const description2 = formatGameTextNow('Base Destroyed Sabotage Description', [builtObject2.name, arg2]);
                const title2 = gameText('Base Destroyed Sabotage') + '!';
                sendMessageToEmpire(builtObject2.empire, builtObject2.empire, EmpireMessageType.BattleUnderAttack, builtObject2, description2, { x: Math.trunc(builtObject2.xpos), y: Math.trunc(builtObject2.ypos) }, '', title2);
            }
            inflictDamageFull(galaxy, builtObject2, builtObject2, null, 100000.0, galaxyNow(galaxy), 0, true, 0.0, false);
            break;
        }
        case T.SabotageColony: {
            if (mission.targetEmpire === null || mission.targetEmpire.pirateEmpireBaseHabitat !== null) break;
            const habitat = intelligenceMissionTarget(mission) as Habitat;
            if (habitat.population != null && habitat.population.items.length > 0) {
                const num3 = galaxy.rnd.next(0, 20);
                let num4 = Math.trunc(habitat.population.totalAmount / 15);
                if (num4 > 2000000000) num4 = 2000000000;
                const num5 = galaxy.rnd.next(0, num4);
                let val = getDevelopmentLevel(habitat) - num3;
                val = Math.max(val, 0);
                setDevelopmentLevel(habitat, val);
                habitat.population.items[0].amount -= num5;
                if (habitat.population.items[0].amount < 10000000) habitat.population.items[0].amount = 10000000;
                habitat.population.recalculateTotalAmount();
                habitat.happinessModifier = Math.fround(-15.0 + galaxy.rnd.nextDouble() * -10.0);
                habitatStartRebelling(habitat);
                doCharacterEventForList(galaxy, CharacterEventType.ColonyDevelopmentDecrease, habitat, stellarObjectCharacters(habitat), true, habitat.empire);
            }
            break;
        }
        case T.SabotageConstruction: {
            let constructionQueue: ConstructionQueue | null = null;
            let empire: Empire | null = null;
            let habitat2: Habitat | null = null;
            let stellarObject: Habitat | BuiltObject | null = null;
            if (targetIsHabitat(mission)) {
                const habitat3 = intelligenceMissionTarget(mission) as Habitat;
                constructionQueue = habitat3.constructionQueue as ConstructionQueue | null;
                empire = habitat3.empire;
                habitat2 = galaxy.determineHabitatSystemStar(habitat3);
                stellarObject = habitat3;
            } else if (targetIsBuiltObject(mission)) {
                const builtObject = intelligenceMissionTarget(mission) as BuiltObject;
                constructionQueue = builtObject.constructionQueue as ConstructionQueue | null;
                empire = builtObject.empire;
                habitat2 = builtObject.nearestSystemStar;
                stellarObject = builtObject;
            }
            let flag = false;
            const yards = constructionQueue !== null ? constructionQueue.constructionYards : null;
            if (constructionQueue !== null && yards !== null && yards.length > 0) {
                for (let i = 0; i < yards.length; i++) {
                    const constructionYard = yards[i];
                    if (constructionYard.shipUnderConstruction === null) continue;
                    if (galaxy.rnd.next(0, 4) === 1) {
                        const components = constructionYard.shipUnderConstruction.components.items;
                        for (let j = 0; j < components.length; j++) {
                            const builtObjectComponent = components[j];
                            if (builtObjectComponent.status === ComponentStatus.Normal && galaxy.rnd.next(0, 6) > 1) {
                                builtObjectComponent.status = ComponentStatus.Damaged;
                                flag = true;
                            }
                        }
                    } else {
                        const shipUnderConstruction = constructionYard.shipUnderConstruction;
                        inflictDamageFull(galaxy, shipUnderConstruction, shipUnderConstruction, null, 10000.0, galaxyNow(galaxy), 0, false, -Number.MAX_VALUE, false);
                        flag = true;
                    }
                }
            }
            if (flag && empire !== null && stellarObject !== null) {
                let arg = '';
                if (habitat2 !== null) arg = habitat2.name;
                const description = formatGameTextNow('Construction Sabotaged Description', [stellarObject.name, arg]);
                const title = gameText('Construction Sabotaged') + '!';
                sendMessageToEmpire(empire, empire, EmpireMessageType.BattleUnderAttack, stellarObject, description, { x: Math.trunc(stellarObject.xpos), y: Math.trunc(stellarObject.ypos) }, '', title);
            }
            break;
        }
        case T.StealTerritoryMap:
            giveTerritoryMap(galaxy, mission.targetEmpire, self);
            break;
        case T.StealGalaxyMap:
            mergeGalaxyMap(galaxy, mission.targetEmpire, self);
            break;
        case T.StealOperationsMap: {
            const item2 = galaxyCurrentStarDate(galaxy) + 30000;
            self.empiresViewable.push(mission.targetEmpire!);
            self.empiresViewableExpiry.push(item2);
            break;
        }
        case T.StealTechData: {
            let researchNode: TechNode | null = null;
            if (targetIsResearchNode(mission)) {
                researchNode = intelligenceMissionTarget(mission) as TechNode;
                // C# 290: `if (researchNode == null)` re-resolves — unreachable (a null Target is not a ResearchNode).
            } else {
                const researchNodeList2 = resolveMoreAdvancedProjectsIncludeSpecial(self, mission.targetEmpire!, false);
                if (researchNodeList2 != null && researchNodeList2.length > 0) {
                    const index2 = galaxy.rnd.next(0, researchNodeList2.length);
                    researchNode = researchNodeList2[index2];
                }
            }
            if (researchNode === null) break;
            // ResearchNodeList.GetEquivalent: this[ResearchNodeId].
            const tree = self.research.techTree;
            const equivalent = tree.length > researchNode.def.projectId ? tree[researchNode.def.projectId] : null;
            if (equivalent !== null) {
                // Empire.6.cs 320 (float)((double)_Galaxy.BaseTechCost * 0.5 * (EspionageFactored / 25.0)).
                let num = Math.fround(galaxy.baseTechCost * 0.5 * (mission.agent!.espionageFactored / 25.0));
                if (mission.agent !== null) num = Math.fround(num * Math.fround(mission.agent.espionageFactored / 25.0));
                let num2 = Math.fround(1);
                if (self.research.allowedRacesCount(equivalent) > 0 && (self.dominantRace === null || !self.research.allowedRacesContains(equivalent, self.dominantRace))) num2 = Math.fround(2);
                num = Math.fround(num / num2);
                equivalent.progress = Math.fround(equivalent.progress + num);
                if (equivalent.progress >= equivalent.cost) doResearchBreakthrough(galaxy, self, equivalent, true, false, false);
                intelligenceMissionResetResearchProject(mission, equivalent);
            }
            break;
        }
        case T.CounterIntelligence:
            break;
    }
    if (galaxy.scenario !== null) scenarioEmit(galaxy, 'intelMissionCompleted', { empire: self, mission, outcome: null }); // mod layer
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.8.cs 3563 CheckCancelIntelligenceMissionsWithTarget
// ---------------------------------------------------------------------------------------------------------------

function cancelMissionsWithTargetIn(list: readonly Empire[], target: unknown): void {
    for (let i = 0; i < list.length; i++) {
        const empire = list[i];
        if (empire == null || empire.characters == null) continue;
        const chars = getEmpireCharacters(empire);
        for (let j = 0; j < chars.length; j++) {
            const character = chars[j];
            if (character == null || character.role !== CharacterRole.IntelligenceAgent) continue;
            const mission = characterMission(character);
            if (mission === null || intelligenceMissionTarget(mission) === null) continue;
            if (targetIsHabitat(mission)) {
                if (intelligenceMissionTarget(mission) === target) {
                    cancelIntelligenceMission(empire, mission);
                    character.mission = null;
                }
            } else if (targetIsBuiltObject(mission)) {
                if (intelligenceMissionTarget(mission) === target) {
                    cancelIntelligenceMission(empire, mission);
                    character.mission = null;
                }
            }
        }
    }
}

/** Galaxy.8.cs 3563 CheckCancelIntelligenceMissionsWithTarget(target): drop missions against a lost colony / destroyed base. No Rnd. */
export function checkCancelIntelligenceMissionsWithTarget(galaxy: Galaxy, target: Habitat | BuiltObject | null): void {
    if (target === null) return;
    cancelMissionsWithTargetIn(galaxy.empires, target);
    cancelMissionsWithTargetIn(galaxy.pirateEmpires, target);
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.2.cs 5563 ResolveDescription(IntelligenceMission, callingEmpire) — message text only.
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.2.cs 5563 ResolveDescription(mission, callingEmpire). */
export function resolveIntelligenceMissionDescription(mission: IntelligenceMission | null, callingEmpire: Empire | null): string {
    let result = '';
    if (mission !== null) {
        let flag = false;
        switch (mission.outcome) {
            case O.FailNotDetect:
            case O.FailDetect:
            case O.Capture:
                flag = false;
                break;
            case O.SucceedNotDetect:
            case O.SucceedDetect:
                flag = true;
                break;
        }
        const target = intelligenceMissionTarget(mission);
        const empireText = (key: string): string =>
            mission.targetEmpire !== callingEmpire
                ? !flag
                    ? formatGameTextNow(`IntelligenceMissionOutcome ${key} Fail`, [mission.targetEmpire!.name])
                    : formatGameTextNow(`IntelligenceMissionOutcome ${key} Succeed`, [mission.targetEmpire!.name])
                : !flag
                  ? formatGameTextNow(`IntelligenceMissionOutcome ${key} OurEmpire Fail`)
                  : formatGameTextNow(`IntelligenceMissionOutcome ${key} OurEmpire Succeed`);
        switch (mission.type) {
            case T.CounterIntelligence:
                result = formatGameTextNow('IntelligenceMissionOutcome CounterIntelligence');
                break;
            case T.DeepCover:
                result = empireText('DeepCover');
                break;
            case T.InciteRevolution:
                result = empireText('InciteRevolution');
                break;
            case T.SabotageColony: {
                let arg2 = '';
                if (target instanceof BuiltObjectClass) arg2 = target.name;
                else if (target instanceof HabitatClass) arg2 = target.name;
                result = !flag ? formatGameTextNow('IntelligenceMissionOutcome SabotageColony Fail', [arg2]) : formatGameTextNow('IntelligenceMissionOutcome SabotageColony Succeed', [arg2]);
                break;
            }
            case T.DestroyBase: {
                let arg = '';
                if (target instanceof BuiltObjectClass) arg = target.name;
                result = !flag ? formatGameTextNow('IntelligenceMissionOutcome DestroyBase Fail', [arg]) : formatGameTextNow('IntelligenceMissionOutcome DestroyBase Succeed', [arg]);
                break;
            }
            case T.AssassinateCharacter: {
                let arg4 = '';
                let arg5 = '';
                if (target instanceof Character) {
                    arg4 = target.name;
                    if (target.location !== null) arg5 = target.location.name;
                }
                result = !flag ? formatGameTextNow('IntelligenceMissionOutcome AssassinateCharacter Fail', [arg4, arg5]) : formatGameTextNow('IntelligenceMissionOutcome AssassinateCharacter Succeed', [arg4, arg5]);
                break;
            }
            case T.SabotageConstruction: {
                let arg3 = '';
                if (target instanceof BuiltObjectClass) arg3 = target.name;
                else if (target instanceof HabitatClass) arg3 = target.name;
                result = !flag ? formatGameTextNow('IntelligenceMissionOutcome SabotageConstruction Fail', [arg3]) : formatGameTextNow('IntelligenceMissionOutcome SabotageConstruction Succeed', [arg3]);
                break;
            }
            case T.StealGalaxyMap:
                result = empireText('StealGalaxyMap');
                break;
            case T.StealTerritoryMap:
                result = empireText('StealTerritoryMap');
                break;
            case T.StealOperationsMap:
                result = empireText('StealOperationsMap');
                break;
            case T.StealTechData: {
                if (mission.targetEmpire === callingEmpire) {
                    result = !flag ? formatGameTextNow('IntelligenceMissionOutcome StealTechData OurEmpire Fail') : formatGameTextNow('IntelligenceMissionOutcome StealTechData OurEmpire Succeed');
                    break;
                }
                let researchNode: TechNode | null = null;
                if (targetIsResearchNode(mission)) researchNode = target as TechNode;
                const en = mission.targetEmpire!.name;
                result = !flag
                    ? researchNode === null
                        ? formatGameTextNow('IntelligenceMissionOutcome StealTechData Fail', [en])
                        : formatGameTextNow('IntelligenceMissionOutcome StealTechData Project Fail', [researchNode.def.name, en])
                    : researchNode === null
                      ? formatGameTextNow('IntelligenceMissionOutcome StealTechData Succeed', [en])
                      : formatGameTextNow('IntelligenceMissionOutcome StealTechData Project Succeed', [researchNode.def.name, en]);
                break;
            }
        }
    }
    return result;
}
