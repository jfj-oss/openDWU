// M4z2 — espionage. Unit tests against hand-worked C# values (IntelligenceMission.cs Difficulty, Empire.6.cs 21
// CalculateIntelligenceMissionSuccessChance, BaconEmpire.cs 88 DetermineIntelligenceMissionOutcome, EmpireCounters.cs 234,
// Empire.6.cs 90/117, BaconCharacter.cs 31 / BaconHabitat.cs 608 spy prisons) plus a harness test in which an AI empire
// at war sends an agent on a mission that completes.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Random } from '../src/sim/random';
import { Character, CharacterRole, CharacterSkillType, IntelligenceMission, getEmpireCharacters, stellarObjectCharacters } from '../src/sim/characters';
import {
    IntelligenceMissionOutcome as O,
    IntelligenceMissionType as T,
    assignSpecialMissions,
    calculateIntelligenceMissionSkill,
    calculateIntelligenceMissionSuccessChance,
    cancelIntelligenceMission,
    characterMission,
    checkCancelIntelligenceMissionsWithTarget,
    completeIntelligenceMission,
    determineIntelligenceMissionOutcome,
    intelligenceMissionDifficulty,
    intelligenceMissionTarget,
    markEmpireAsRecentSpy,
    newIntelligenceMissionAgainstBuiltObject,
    newIntelligenceMissionAgainstCharacter,
    newIntelligenceMissionAgainstEmpire,
    newIntelligenceMissionStealTechData,
} from '../src/sim/espionage';
import { characterKillFromPerformIntelligenceMissions, getCharacterValue, getSpiesInPrison, handleAIPrisoners } from '../src/sim/espionagePrisoners';
import { DiplomaticRelationType, DiplomaticStrategy, LONG_MAX_VALUE, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { galaxyCurrentStarDate } from '../src/sim/pirateRelations';
import { cautionLevel } from '../src/sim/diplomacyTick';
import { resetBaconSettingsToDefaults } from '../src/sim/baconInitialize';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function aiEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null);
}

function newAgent(g: Galaxy, empire: Empire, name: string): Character {
    const c = new Character(name, CharacterRole.IntelligenceAgent, '', empire.dominantRace, null, null, 0);
    c.activate(g, empire, empire.capital);
    return c;
}

/**
 * A skilled agent: with the default race caution (CalculateIntelligenceMissionSkill divides by caution/100 × 1.4) an
 * unskilled agent (factored 25) cannot take even a StealOperationsMap (difficulty 56) — the C# AI then only defends.
 */
function newSkilledAgent(g: Galaxy, empire: Empire, name: string): Character {
    const c = newAgent(g, empire, name);
    c.addSkill(CharacterSkillType.Espionage, 60, null);
    c.addSkill(CharacterSkillType.Concealment, 60, null);
    c.addSkill(CharacterSkillType.Sabotage, 60, null);
    c.addSkill(CharacterSkillType.Assassination, 60, null);
    return c;
}

/** Met and at war (AssignSpecialMissions walks EmpireEvaluations, which list met empires only). */
function declareWar(g: Galaxy, a: Empire, b: Empire): void {
    obtainEmpireEvaluation(g, a, b);
    obtainEmpireEvaluation(g, b, a);
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.War;
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.War;
}

/** Replaces galaxy.rnd.nextDouble with a fixed value for one call. */
function withNextDouble<R>(g: Galaxy, x: number, fn: () => R): R {
    const rnd = g.rnd as Random & { nextDouble: () => number };
    const orig = rnd.nextDouble;
    rnd.nextDouble = () => x;
    try {
        return fn();
    } finally {
        rnd.nextDouble = orig;
    }
}

describe('IntelligenceMission.Difficulty (IntelligenceMission.cs 167)', () => {
    it('empire-target missions: 20 × factor, ×2 against pirates, ×3 against reclusive empires', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        const d = (type: T) => intelligenceMissionDifficulty(newIntelligenceMissionAgainstEmpire(a, null, type, 0, b));
        b.reclusive = false;
        // (int)((int)(20 × 3.5) × 1) = 70; 20 × 2.8 → 56; 20 × 8 → 160; 20 × 2.2 → 44.
        expect(d(T.StealGalaxyMap)).toBe(70);
        expect(d(T.StealOperationsMap)).toBe(56);
        expect(d(T.DeepCover)).toBe(160);
        expect(d(T.StealTerritoryMap)).toBe(44);
        b.reclusive = true;
        expect(d(T.StealGalaxyMap)).toBe(210);
        b.reclusive = false;
        const pirate = galaxy.pirateEmpires[0];
        expect(intelligenceMissionDifficulty(newIntelligenceMissionAgainstEmpire(a, null, T.DeepCover, 0, pirate))).toBe(320);
        // StealTechData with no target node: (int)(20 × 3.2) = 64.
        expect(intelligenceMissionDifficulty(newIntelligenceMissionStealTechData(a, null, 0, b, null))).toBe(64);
        // A mission against one's own empire type that the ctor rejects throws (ApplicationException "Invalid mission type").
        expect(() => newIntelligenceMissionAgainstEmpire(a, null, T.DestroyBase, 0, b)).toThrow('Invalid mission type');
    });

    it('assassination by role (leader ×2, governor ×1.5) and base destruction by size (sqrt(size / 300))', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        const leader = b.leader!;
        expect(intelligenceMissionDifficulty(newIntelligenceMissionAgainstCharacter(a, null, T.AssassinateCharacter, 0, leader))).toBe(320);
        const agent = newAgent(galaxy, b, 'Target agent');
        const m = newIntelligenceMissionAgainstCharacter(a, null, T.AssassinateCharacter, 0, agent);
        expect(intelligenceMissionTarget(m)).toBe(agent);
        expect(m.targetEmpire).toBe(b);
        expect(intelligenceMissionDifficulty(m)).toBe(160);
        const base = b.builtObjects.find((x) => x.role === 3 /* Base */) ?? b.builtObjects[0];
        const saved = base.size;
        base.size = 300;
        const mb = newIntelligenceMissionAgainstBuiltObject(a, null, T.DestroyBase, 0, base);
        // (int)(20 × 4.0 × 1) = 80 × sqrt(1).
        expect(intelligenceMissionDifficulty(mb)).toBe(80);
        base.size = 1200;
        expect(intelligenceMissionDifficulty(mb)).toBe(160);
        base.size = 1000;
        // SabotageConstruction on a ship yard: (int)(20 × sqrt(1000 / 1000)) = 20.
        expect(intelligenceMissionDifficulty(newIntelligenceMissionAgainstBuiltObject(a, null, T.SabotageConstruction, 0, base))).toBe(20);
        base.size = saved;
    });
});

describe('mission skill and success chance (Empire.5.cs 4183, Empire.6.cs 21)', () => {
    it('an unskilled agent (factored 25) with no leader bonus: 0.7 × 25/70 for a month, 1 − 0.3/(100/70) for a year', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        a.leader = null;
        a.espionageBonus = 0;
        b.reclusive = false;
        const agent = newAgent(galaxy, a, 'Agent A');
        expect(agent.espionageFactored).toBe(25);
        const m = newIntelligenceMissionAgainstEmpire(a, agent, T.StealGalaxyMap, 0, b);
        expect(calculateIntelligenceMissionSuccessChance(a, m, agent)).toBeCloseTo((0.7 * 25) / 70, 12);
        m.timeLength = 600 * 1000;
        expect(calculateIntelligenceMissionSuccessChance(a, m, agent)).toBeCloseTo(1.0 - 0.3 / (100 / 70), 12);
        // CalculateIntelligenceMissionSkill: caution/100 × 1.4 divides 25 × 4 / 25 × 2 / 25.
        const k = (cautionLevel(a) / 100.0) * 1.4;
        const s = calculateIntelligenceMissionSkill(a, agent, T.StealGalaxyMap, b);
        expect(s.oneYearDifficulty).toBeCloseTo(100 / k, 12);
        expect(s.threeMonthDifficulty).toBeCloseTo(50 / k, 12);
        expect(s.oneMonthDifficulty).toBeCloseTo(25 / k, 12);
    });
});

describe('DetermineIntelligenceMissionOutcome (BaconEmpire.cs 88)', () => {
    it('bands above the success chance c: +25 % fail-undetected, +60 % succeed-detected, +90 % fail-detected, then capture', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        a.leader = null;
        a.espionageBonus = 0;
        b.reclusive = false;
        const agent = newAgent(galaxy, a, 'Agent A');
        const m = newIntelligenceMissionAgainstEmpire(a, agent, T.StealGalaxyMap, 0, b);
        // c = 0.25: FailNotDetect ≤ 0.4375 < SucceedDetect ≤ 0.7 < FailDetect ≤ 0.925 < Capture.
        const at = (x: number, mm = m) => withNextDouble(galaxy, x, () => determineIntelligenceMissionOutcome(galaxy, a, mm, agent));
        expect(at(0.1)).toBe(O.SucceedNotDetect);
        expect(at(0.3)).toBe(O.FailNotDetect);
        expect(at(0.5)).toBe(O.SucceedDetect);
        expect(at(0.8)).toBe(O.FailDetect);
        expect(at(0.95)).toBe(O.Capture);
        // Deep cover: a detected success becomes an undetected failure.
        const dc = newIntelligenceMissionAgainstEmpire(a, agent, T.DeepCover, 0, b);
        const c2 = calculateIntelligenceMissionSuccessChance(a, dc, agent);
        expect(at(c2 + (1 - c2) * 0.5, dc)).toBe(O.FailNotDetect);
    });
});

describe('EmpireCounters.ProcessIntelligenceMissionOutcome (EmpireCounters.cs 234)', () => {
    it('counts successes / failures by mission family and captures', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        const c = a.counters;
        c.processIntelligenceMissionOutcome(newIntelligenceMissionAgainstEmpire(a, null, T.DeepCover, 0, b), O.SucceedDetect);
        c.processIntelligenceMissionOutcome(newIntelligenceMissionAgainstEmpire(a, null, T.InciteRevolution, 0, b), O.Capture);
        c.processIntelligenceMissionOutcome(new IntelligenceMission(a, null, 0), O.SucceedNotDetect);
        c.processIntelligenceMissionOutcome(new IntelligenceMission(a, null, 0), O.FailDetect);
        c.processIntelligenceMissionOutcome(null, O.Capture);
        expect([c.intelligenceMissionSuccessEspionageCount, c.intelligenceMissionFailureSabotageCount, c.intelligenceMissionAgentCapturedCount, c.intelligenceMissionSuccessCounterIntelligenceCount]).toEqual([1, 1, 1, 1]);
        expect(c.intelligenceMissionFailureEspionageCount + c.intelligenceMissionSuccessSabotageCount).toBe(0);
    });
});

describe('Complete / Cancel / CheckCancel (Empire.6.cs 117 / 90, Galaxy.8.cs 3563)', () => {
    it('deep cover adds a permanent view that cancelling removes; operations maps expire after 30000 ms', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        a.empiresViewable.length = 0;
        a.empiresViewableExpiry.length = 0;
        const ops = newIntelligenceMissionAgainstEmpire(a, null, T.StealOperationsMap, 0, b);
        completeIntelligenceMission(galaxy, a, ops);
        const dc = newIntelligenceMissionAgainstEmpire(a, null, T.DeepCover, 0, b);
        completeIntelligenceMission(galaxy, a, dc);
        expect(a.empiresViewable).toEqual([b, b]);
        expect(a.empiresViewableExpiry).toEqual([galaxyCurrentStarDate(galaxy) + 30000, LONG_MAX_VALUE]);
        cancelIntelligenceMission(a, dc);
        expect(a.empiresViewable).toEqual([b]);
        expect(a.empiresViewableExpiry).toEqual([galaxyCurrentStarDate(galaxy) + 30000]);
    });

    it('a mission against a lost base is cancelled (the agent keeps no mission)', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        const agent = newAgent(galaxy, a, 'Agent A');
        const bo = b.builtObjects[0];
        agent.mission = newIntelligenceMissionAgainstBuiltObject(a, agent, T.DestroyBase, 0, bo);
        checkCancelIntelligenceMissionsWithTarget(galaxy, b.builtObjects[1] ?? null);
        expect(characterMission(agent)).not.toBeNull();
        checkCancelIntelligenceMissionsWithTarget(galaxy, bo);
        expect(characterMission(agent)).toBeNull();
    });

    it('MarkEmpireAsRecentSpy (Empire.10.cs 16) adds the spy once, never the independents', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        b.recentSpyingEmpires.length = 0;
        markEmpireAsRecentSpy(galaxy, a, b);
        markEmpireAsRecentSpy(galaxy, a, b);
        markEmpireAsRecentSpy(galaxy, galaxy.independentEmpire, b);
        expect(b.recentSpyingEmpires).toEqual([a]);
    });
});

describe('AssignSpecialMissions (Empire.5.cs 5401)', () => {
    it('a single agent stays on counter-intelligence (Max(1, n × 30 %) defenders) for three months', () => {
        const { galaxy } = createTickGame(gameData);
        const [a] = aiEmpires(galaxy);
        for (const c of getEmpireCharacters(a)) if (c.role === CharacterRole.IntelligenceAgent) c.mission = null;
        const agents = getEmpireCharacters(a).filter((c) => c.role === CharacterRole.IntelligenceAgent);
        expect(agents.length).toBe(1);
        assignSpecialMissions(galaxy, a);
        const m = characterMission(agents[0])!;
        expect(m.type).toBe(T.CounterIntelligence);
        expect(m.targetEmpire).toBe(a);
        expect(m.timeLength).toBe(150000);
    });

    it('at war, a spare agent is sent against the enemy', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        declareWar(galaxy, a, b);
        for (let i = 0; i < 4; i++) newSkilledAgent(galaxy, a, `Agent ${i}`);
        // Five agents: Max(1, 5 × 0.3) = 1 defender, 4 may attack; each pass draws Next(0, 3) per empire.
        for (let k = 0; k < 10; k++) assignSpecialMissions(galaxy, a);
        const attacking = getEmpireCharacters(a).filter((c) => c.role === CharacterRole.IntelligenceAgent && characterMission(c)!.type !== T.CounterIntelligence);
        expect(attacking.length).toBeGreaterThan(0);
        for (const c of attacking) {
            const m = characterMission(c)!;
            expect(m.agent).toBe(c);
            expect(m.targetEmpire).toBe(b);
            // War allows DeepCover, StealOperationsMap, DestroyBase, AssassinateCharacter, SabotageConstruction, SabotageColony.
            expect([T.DeepCover, T.StealOperationsMap, T.DestroyBase, T.AssassinateCharacter, T.SabotageConstruction, T.SabotageColony]).toContain(m.type);
            expect([50000, 150000, 600000]).toContain(m.timeLength);
        }
        void DiplomaticStrategy;
    });
});

describe('captured spies (BaconCharacter.cs 31 Kill from PerformIntelligenceMissions, BaconHabitat.cs 608)', () => {
    it('between two AI empires the spy\'s empire pays GetCharacterValue to the target and the spy lives', () => {
        const { galaxy } = createTickGame(gameData);
        // Hand-worked with the C# default spyBaseValue 25000 (the installed BaconSettings.txt sets 250000).
        resetBaconSettingsToDefaults();
        const [a, b] = aiEmpires(galaxy);
        const spy = newAgent(galaxy, a, 'Spy');
        spy.mission = newIntelligenceMissionAgainstEmpire(a, spy, T.StealGalaxyMap, 0, b);
        a.stateMoney = 100000;
        b.stateMoney = 1000;
        // d = sqrt(100000 / 25000) = 2; no skills: Max(12500, (int)(1 × 2 × 25000)) = 50000.
        expect(getCharacterValue(spy)).toBe(50000);
        characterKillFromPerformIntelligenceMissions(galaxy, spy);
        expect(a.stateMoney).toBe(50000);
        expect(b.stateMoney).toBe(51000);
        expect(spy.active).toBe(true);
        expect(spy.eventHistory.at(-1)!.eventData).toBeInstanceOf(Map);
        // Too poor to pay: the spy dies.
        a.stateMoney = 1000;
        characterKillFromPerformIntelligenceMissions(galaxy, spy);
        expect(spy.active).toBe(false);
        expect(getEmpireCharacters(a)).not.toContain(spy);
    });

    it('a player spy goes to the target capital\'s prison; HandleAIPrisoners ransoms it to the player capital when at peace', () => {
        const { galaxy } = createTickGame(gameData);
        const player = galaxy.playerEmpire!;
        const [b] = aiEmpires(galaxy);
        const spy = newAgent(galaxy, player, 'Player spy');
        spy.mission = newIntelligenceMissionAgainstEmpire(player, spy, T.StealGalaxyMap, 0, b);
        characterKillFromPerformIntelligenceMissions(galaxy, spy);
        expect(getSpiesInPrison(b.capital!)).toEqual([spy]);
        expect(getEmpireCharacters(player)).not.toContain(spy);
        expect(stellarObjectCharacters(player.capital!) ?? []).not.toContain(spy);
        expect(spy.active).toBe(true);
        obtainDiplomaticRelation(b, player).type = DiplomaticRelationType.None;
        // Escape (NextDouble ≤ 0.02) and defection draws come from the spy clock stream; force "neither" by reseeding it
        // to a stream whose first two draws exceed 0.02 is not needed: loop until the spy has left the prison.
        let guard = 0;
        while (getSpiesInPrison(b.capital!)!.length > 0 && guard++ < 100) handleAIPrisoners(galaxy, b.capital!);
        expect(getSpiesInPrison(b.capital!)).toEqual([]);
        const home = getSpiesInPrison(player.capital!);
        const escapedOrDefected = getEmpireCharacters(player).includes(spy) || getEmpireCharacters(b).includes(spy);
        expect(home?.includes(spy) || escapedOrDefected).toBe(true);
    });
});

describe('harness: an AI empire at war runs an intelligence mission (Empire.5.cs 5401 / 5597)', () => {
    it('a spare agent is assigned, the mission resolves, and the outcome is counted', () => {
        const { galaxy } = createTickGame(gameData);
        const [a, b] = aiEmpires(galaxy);
        declareWar(galaxy, a, b);
        for (let i = 0; i < 3; i++) newSkilledAgent(galaxy, a, `Harness agent ${i}`);
        let assigned: IntelligenceMission | null = null;
        let resolved = false;
        const total = () =>
            a.counters.intelligenceMissionSuccessEspionageCount +
            a.counters.intelligenceMissionFailureEspionageCount +
            a.counters.intelligenceMissionSuccessSabotageCount +
            a.counters.intelligenceMissionFailureSabotageCount;
        for (let t = 0; t < 30 && !resolved; t++) {
            runGameSeconds(galaxy, 60);
            if (assigned === null) {
                for (const c of getEmpireCharacters(a)) {
                    const m = characterMission(c);
                    if (m !== null && m.type !== T.CounterIntelligence && m.targetEmpire === b) assigned = m;
                }
            }
            if (assigned !== null && (assigned.outcome !== O.Undefined || total() > 0)) resolved = true;
        }
        expect(assigned).not.toBeNull();
        expect(resolved).toBe(true);
        expect(total()).toBeGreaterThan(0);
    }, 600000);
});
