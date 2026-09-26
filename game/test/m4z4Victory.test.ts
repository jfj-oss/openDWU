// M4z4 — victory conditions, achievements, score, battle-stats report and stats XML. Unit tests against hand-worked
// C# values (Galaxy.1.cs, Galaxy.cs 3808-5247, BaconMain.cs, BaconBuiltObject.cs) per condition-type family, plus a
// harness smoke test on seed 1 with the wizard's victory conditions switched on.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { cachedTickGame } from './helpers/gameCache';
import { createGame } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { RaceVictoryConditionType as T } from '../src/sim/data/races';
import { PiratePlayStyle } from '../src/sim/pirates';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/tick/simTime';
import { startStarDateForAge } from '../src/sim/galaxyTime';
import { totalColonyStrategicValue } from '../src/sim/forceStructure';
import { CreatureType } from '../src/sim/creature';
import { defaultStartGameOptions, defaultVictoryConditions, toCreateGameOptions } from '../src/sim/startGameOptions';
import { countExploredSystems } from '../src/sim/visibility';
import { getCharactersByRole, CharacterRole, type Character } from '../src/sim/characters';
import {
    EmpireVictoryConditions,
    GameEndEventArgs,
    GameEndOutcome,
    RaceVictoryConditionProgress,
    VictoryConditionProgress,
    VictoryConditions,
    calculateRaceVictoryConditionProgress,
    calculateRaceVictoryConditionsProgress,
    checkEmpireVictoryConditionsToAchieve,
    checkEmpireVictoryConditionsToPrevent,
    checkVictoryConditions,
    countersProcessCreatureDeath,
    doGameEnd,
    formatNumber,
    gameVictoryArgs,
    generateVictoryConditionProgresses,
    resolvePirateVictoryConditions,
    setGameEndHandler,
    victoryConditionsFromWizard,
    victoryThresholdForIndex,
    type VictoryCondition,
} from '../src/sim/victory';
import {
    Achievement,
    AchievementType,
    EMPIRE_STATS_TO_TRACK,
    PIRATE_STATS_TO_TRACK,
    achievementListAddIfNotExistsOrBetter,
    buildBattleStatsReport,
    calculateCrewLevel,
    calculateEmpireScore,
    createEmptyGameStatsXml,
    determineAchievementLevel,
    determineAchievementValueForLevel,
    doubleToInvariantString,
    processGameStats,
    processGameStatsXml,
    resolveAchievementDescription,
    resolveAchievementMedalImageIndex,
    resolveAchievementName,
    resolveAchievementTitleComplete,
    reviewAchievementsForEmpire,
    updateAchievements,
} from '../src/sim/achievements';
import { SpaceBattleStats } from '../src/sim/combat/damage';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { formatGameTextNow } from '../src/sim/textResolver';

let gameData: GameData;
let galaxy: Galaxy;
let empires: Empire[];
beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = cachedTickGame(gameData).galaxy;
    empires = galaxy.empires.filter((e) => e !== galaxy.independentEmpire && e.dominantRace !== null && e.dominantRace.playable);
}, 300000);

const cond = (type: T, amount = 0, proportion = 20, additionalData: number | null = null): VictoryCondition => ({ type, amount, proportion: Math.fround(proportion), additionalData });

/** Sets one counter on every rival-eligible empire (index → value), the rest 0. */
function setAll(values: number[], set: (e: Empire, v: number) => void): void {
    empires.forEach((e, i) => set(e, values[i] ?? 0));
}

describe('model: VictoryConditionProgress.cs', () => {
    it('TotalProgress averages the enabled parts and adds the bonuses', () => {
        const race = [new RaceVictoryConditionProgress(T.ControlHomeworld, 0.25, 1, null, '', cond(T.ControlHomeworld)), new RaceVictoryConditionProgress(T.KeepLeaderAlive, 0.1, 0.5, null, '', cond(T.KeepLeaderAlive))];
        const p = new VictoryConditionProgress(empires[0], true, false, true, 0.6, 0.9, 0.3, race);
        // 3 portions: 0.6/3 + 0.3/3 + 0.35/3 = 0.4166…; + bonus 0.1 + pirate 0.05.
        p.bonusAmount = 0.1;
        p.pirateBonusAmount = 0.05;
        expect(p.getPortionCount()).toBe(3);
        expect(p.totalProgress).toBeCloseTo((0.6 + 0.3 + 0.35) / 3 + 0.15, 12);
        const all = p.getProgressAll();
        expect(all.economyProgress).toBe(0);
        expect(all.raceProgress).toBeCloseTo(0.35 / 3, 12);
    });
});

describe('wizard → VictoryConditions (Start.1.cs 3772-3805)', () => {
    it('maps the page, dating TimeLimit / StartDate from the Expansion start star date', () => {
        const v = { ...defaultVictoryConditions(), territory: true, territoryPercent: 40, economy: false, economyPercent: 50, timeLimit: true, timeLimitYears: 30, timeStart: true, startDateYears: 5, victoryThresholdPercentage: 0.8 };
        const vc = victoryConditionsFromWizard(v, 2);
        const start = startStarDateForAge(2);
        expect(vc.territory).toBe(true);
        expect(vc.territoryPercent).toBe(40);
        expect(vc.economyPercent).toBe(0); // only copied when checked
        expect(vc.timeLimitDate).toBe(start + 30 * 600000);
        expect(vc.startDate).toBe(start + 5 * 600000);
        expect(vc.victoryThresholdPercentage).toBe(0.8);
        expect(vc.enableStoryEvents).toBe(false);
        expect(vc.enableStoryEventsShadows).toBe(false);
        expect(victoryConditionsFromWizard({ ...v, timeStart: false }, 2).startDate).toBe(0);
        expect([0, 1, 2, 3, 4, 5, 6].map(victoryThresholdForIndex)).toEqual([0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.0]);
    });
    it('toCreateGameOptions carries them (and difficulty scaling) to createGame', () => {
        const o = { ...defaultStartGameOptions(), seed: 5, raceName: 'Human', difficultyScaling: true };
        const c = toCreateGameOptions(o, gameData, Array.from({ length: 800 }, (_, i) => `N${i}`));
        expect(c.victoryConditions).toBeInstanceOf(VictoryConditions);
        expect(c.victoryConditions!.victoryThresholdPercentage).toBe(1.0);
        expect(c.difficultyLevelScalesAsPlayerApproachesVictory).toBe(true);
    });
});

describe('race victory conditions: compare-empires families (Galaxy.cs 3844)', () => {
    it('Most… types: num / best rival, 1.0 and self as best when leading', () => {
        setAll([10, 20, 5, 0], (e, v) => { e.counters.destroyedEnemyMilitaryShipCount = v; e.counters.destroyedEnemyCivilianShipCount = 0; });
        const r = calculateRaceVictoryConditionProgress(galaxy, empires[0], cond(T.DestroyMostShips));
        expect(r.progress).toBe(0.5);
        expect(r.bestEmpire).toBe(empires[1]);
        const r2 = calculateRaceVictoryConditionProgress(galaxy, empires[1], cond(T.DestroyMostShips));
        expect(r2.progress).toBe(1.0);
        expect(r2.bestEmpire).toBe(empires[1]);
        expect(r2.detail).toBe(formatGameTextNow('Race Victory Condition Detail DestroyMostShips', ['20'])); // string.Format(GetText(…), num)
        // num 0 → flag false; best 20 → 0 / 20 = 0.
        expect(calculateRaceVictoryConditionProgress(galaxy, empires[3], cond(T.DestroyMostShips)).progress).toBe(0);
        setAll([], (e) => { e.counters.destroyedEnemyMilitaryShipCount = 0; });
        // Nobody has any: best stays 0 → 0.0, bestEmpire null.
        const r3 = calculateRaceVictoryConditionProgress(galaxy, empires[0], cond(T.DestroyMostShips));
        expect(r3.progress).toBe(0);
        expect(r3.bestEmpire).toBe(null);
    });
    it('DestroyMostCreaturesByType reads the creature counter named by AdditionalData', () => {
        setAll([], (e) => { e.counters.destroyedCreatureCountKaltor = 0; e.counters.destroyedCreatureCountArdilus = 0; });
        countersProcessCreatureDeath(empires[0].counters, CreatureType.Kaltor);
        countersProcessCreatureDeath(empires[0].counters, CreatureType.Kaltor);
        countersProcessCreatureDeath(empires[1].counters, CreatureType.Kaltor);
        countersProcessCreatureDeath(empires[1].counters, CreatureType.Ardilus);
        expect(calculateRaceVictoryConditionProgress(galaxy, empires[1], cond(T.DestroyMostCreaturesByType, 0, 20, CreatureType.Kaltor)).progress).toBe(0.5);
        expect(calculateRaceVictoryConditionProgress(galaxy, empires[0], cond(T.DestroyMostCreaturesByType, 0, 20, CreatureType.Kaltor)).progress).toBe(1.0);
        expect(calculateRaceVictoryConditionProgress(galaxy, empires[0], cond(T.DestroyMostCreaturesByType, 0, 20, CreatureType.Ardilus)).progress).toBe(0);
    });
    it('Least… types: (worst − num) / (worst − best) with best starting at 0 (C#: num2 = 0.0)', () => {
        setAll([5, 10, 2, 0], (e, v) => { e.counters.lossesTroopCount = v; });
        // num2 starts at 0 and only a negative value is lower → (10 − 5) / max(0.0001, 10 − 0) = 0.5.
        const r = calculateRaceVictoryConditionProgress(galaxy, empires[0], cond(T.LoseFewestTroops));
        expect(r.progress).toBe(0.5);
        expect(r.bestEmpire).toBe(null);
        // num 0 <= num2 0 → 1.0, self best.
        const r2 = calculateRaceVictoryConditionProgress(galaxy, empires[3], cond(T.LoseFewestTroops));
        expect(r2.progress).toBe(1.0);
        expect(r2.bestEmpire).toBe(empires[3]);
    });
    it('rank types: ascending (LoseFewestShips) and descending (MostHomeworlds) rank → 1 / 0.5 / 0.33 / 0', () => {
        setAll([3, 0, 1, 0], (e, v) => { e.counters.lossesMilitaryShipCount = v; e.counters.lossesCivilianShipCount = 0; });
        // distinct values [3, 0, 1] sorted ascending → [0, 1, 3]: 3 is third → 0.33; 0 is first → 1.0.
        expect(calculateRaceVictoryConditionProgress(galaxy, empires[0], cond(T.LoseFewestShips)).progress).toBe(0.33);
        expect(calculateRaceVictoryConditionProgress(galaxy, empires[2], cond(T.LoseFewestShips)).progress).toBe(0.5);
        const r = calculateRaceVictoryConditionProgress(galaxy, empires[1], cond(T.LoseFewestShips));
        expect(r.progress).toBe(1.0);
        expect(r.bestEmpire).toBe(empires[1]);
        // Every empire owns its own homeworld: all values 1 → rank 0 → 1.0 for everyone.
        for (const e of empires) expect(calculateRaceVictoryConditionProgress(galaxy, e, cond(T.MostHomeworlds)).progress).toBe(1.0);
    });
    it('Oldest… types: 0 when no such treaty', () => {
        const r = calculateRaceVictoryConditionProgress(galaxy, empires[0], cond(T.OldestMutualDefensePact));
        // num = 0 → flag false (Oldest… is in the "num > 0" group); num2 = now, num3 = 0 → (0 − 0) / max(0.0001, −now) = 0.
        expect(r.progress).toBe(0);
    });
    it('NonAllied types ignore allied rivals', () => {
        setAll([2, 9, 0, 0], (e, v) => { e.troops.items.length = 0; void v; });
        const a = empires[0];
        const b = empires[1];
        // No troops anywhere → Most types 0.
        expect(calculateRaceVictoryConditionProgress(galaxy, a, cond(T.MostTroopsNonAllied)).progress).toBe(0);
        const rel = obtainDiplomaticRelation(a, b);
        const before = rel.type;
        rel.type = DiplomaticRelationType.MutualDefensePact;
        expect(calculateRaceVictoryConditionProgress(galaxy, a, cond(T.LargestMilitaryNonAllied)).bestEmpire === b).toBe(false);
        rel.type = before;
    });
});

describe('race victory conditions: absolute families (Galaxy.cs 4960)', () => {
    it('DestroyMoreShipsThanLoseTimesFactor / DestroyMoreEnemyTroopsThanLoseTimesFactor compare against Amount', () => {
        const e = empires[0];
        e.counters.destroyedEnemyMilitaryShipCount = 3;
        e.counters.destroyedEnemyCivilianShipCount = 2;
        e.counters.lossesMilitaryShipCount = 2;
        e.counters.lossesCivilianShipCount = 0;
        expect(calculateRaceVictoryConditionProgress(galaxy, e, cond(T.DestroyMoreShipsThanLoseTimesFactor, 2)).progress).toBe(1.0); // 5 > 4
        expect(calculateRaceVictoryConditionProgress(galaxy, e, cond(T.DestroyMoreShipsThanLoseTimesFactor, 2.5)).progress).toBe(0); // 5 > 5 false
        e.counters.destroyedEnemyTroopCount = 7;
        e.counters.lossesTroopCount = 3;
        const r = calculateRaceVictoryConditionProgress(galaxy, e, cond(T.DestroyMoreEnemyTroopsThanLoseTimesFactor, 2));
        expect(r.progress).toBe(1.0);
        expect(r.bestEmpire).toBe(e);
    });
    it('ControlHomeworld, KeepLeaderAlive, ExploreGalaxyPercentage, pacts proportion', () => {
        const e = empires[0];
        const hw = calculateRaceVictoryConditionProgress(galaxy, e, cond(T.ControlHomeworld));
        expect(hw.progress).toBe(1.0);
        expect(hw.detail).toBe(e.homeWorld!.name);
        const leaders = getCharactersByRole(e.characters as Character[], CharacterRole.Leader).length;
        expect(calculateRaceVictoryConditionProgress(galaxy, e, cond(T.KeepLeaderAlive)).progress).toBe(leaders > 0 ? 1 : 0);
        const explored = countExploredSystems(e.systemVisibility);
        const expected = Math.max(0, Math.min(1, Math.min(1, explored / galaxy.systems.length) / 0.5));
        expect(calculateRaceVictoryConditionProgress(galaxy, e, cond(T.ExploreGalaxyPercentage, 50)).progress).toBeCloseTo(expected, 12);
        expect(calculateRaceVictoryConditionProgress(galaxy, e, cond(T.MutualDefensePactsFormedProportionAllEmpires, 50)).progress).toBe(0);
    });
    it('BuildWonder: 0 without the wonder, 0 for an out-of-range facility index', () => {
        expect(calculateRaceVictoryConditionProgress(galaxy, empires[0], cond(T.BuildWonder, 0, 20, 0)).progress).toBe(0);
        expect(calculateRaceVictoryConditionProgress(galaxy, empires[0], cond(T.BuildWonder, 0, 20, 99999)).progress).toBe(0);
    });
});

describe('CalculateRaceVictoryConditionsProgress / ResolvePirateVictoryConditions', () => {
    it('sums progress × Proportion / 100 and sorts the parts descending', () => {
        const e = empires[0];
        const race = e.dominantRace!;
        const r = calculateRaceVictoryConditionsProgress(galaxy, e, race);
        const conditions = race.victoryConditions ?? [];
        if (conditions.length === 0) {
            expect(r.progress).toBe(1.0);
        } else {
            let sum = 0;
            for (const p of r.conditionProgresses) sum += p.thisProgress * Math.fround(Math.fround(p.condition.proportion) / 100);
            expect(r.progress).toBeCloseTo(sum, 12);
            for (let i = 1; i < r.conditionProgresses.length; i++) expect(r.conditionProgresses[i - 1].progressTotalPortion).toBeGreaterThanOrEqual(r.conditionProgresses[i].progressTotalPortion);
        }
        expect(calculateRaceVictoryConditionsProgress(galaxy, e, null).progress).toBe(0);
    });
    it('pirate play styles (Galaxy.1.cs 353)', () => {
        const s = resolvePirateVictoryConditions(PiratePlayStyle.Smuggler);
        expect(s.map((c) => c.type)).toEqual([T.PirateMostSmugglingIncome, T.PirateMostProtectionIncome, T.MostIntelligenceMissionsSucceed, T.ResearchMostAdvanced, T.PirateBuildCriminalNetwork]);
        expect(s.map((c) => c.proportion)).toEqual([40, 15, 15, 15, 15]);
        expect(resolvePirateVictoryConditions(PiratePlayStyle.Balanced)[0]).toEqual({ type: T.PirateControlColoniesPercentage, amount: 10, proportion: 20, additionalData: null });
        expect(resolvePirateVictoryConditions(PiratePlayStyle.Undefined)).toEqual([]);
    });
});

describe('global victory (Galaxy.1.cs 88-584)', () => {
    it('GenerateVictoryConditionProgresses: territory progress = colonies / ceil-ish(total × pct)', () => {
        const vc = new VictoryConditions();
        vc.territory = true;
        vc.territoryPercent = 33;
        vc.enableRaceSpecificVictoryConditions = false;
        const list = generateVictoryConditionProgresses(galaxy, vc, false);
        const counted = galaxy.empires.filter((e) => e.active && e !== galaxy.independentEmpire);
        expect(list.length).toBe(counted.length);
        const total = Math.max(1, counted.reduce((n, e) => n + e.colonies.length, 0));
        const num8 = Math.trunc(0.99 + total * 0.33);
        for (const p of list) {
            expect(p.territoryProgress).toBeCloseTo(Math.max(0, Math.min(1, p.empire.colonies.length / num8)), 12);
            expect(p.territoryPercent).toBeCloseTo(p.empire.colonies.length / total, 12);
            expect(p.raceVictoryConditionsProgress).toBe(null);
            expect(p.totalProgress).toBeCloseTo(p.territoryProgress, 12);
        }
        expect(generateVictoryConditionProgresses(galaxy, null, false)).toEqual([]);
    });
    it('CheckVictoryConditions: time limit → highest strategic value; threshold winner; StartDate gate', () => {
        const events: GameEndEventArgs[] = [];
        setGameEndHandler(galaxy, (e) => events.push(e));
        const vc = new VictoryConditions();
        vc.timeLimit = true;
        vc.timeLimitDate = galaxyStarDate(galaxy);
        vc.victoryThresholdPercentage = 1.0;
        vc.enableRaceSpecificVictoryConditions = false;
        checkVictoryConditions(galaxy, galaxy.playerEmpire, { globalVictoryConditions: vc, playerConditionsToAchieve: null, playerConditionsToPrevent: null });
        let best: Empire | null = null;
        for (const e of galaxy.empires) if (totalColonyStrategicValue(e) > (best ? totalColonyStrategicValue(best) : 0) && e.dominantRace?.playable) best = e;
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[0].victorEmpire).toBe(best);
        expect(events[0].outcomeForPlayer).toBe(best === galaxy.playerEmpire ? GameEndOutcome.Victory : GameEndOutcome.Defeat);
        // No part enabled: TotalProgress = 0 / 0 (NaN) + bonuses → never ≥ threshold: only the time-limit event fired.
        expect(events.length).toBe(1);
        // StartDate in the future: nothing at all.
        events.length = 0;
        vc.startDate = galaxyStarDate(galaxy) + 1;
        checkVictoryConditions(galaxy, galaxy.playerEmpire, { globalVictoryConditions: vc, playerConditionsToAchieve: null, playerConditionsToPrevent: null });
        expect(events).toEqual([]);
        // Threshold 0 with territory on: the best-progress empire wins.
        vc.startDate = 0;
        vc.timeLimit = false;
        vc.territory = true;
        vc.territoryPercent = 33;
        vc.victoryThresholdPercentage = 0;
        galaxy.globalVictoryConditions = vc;
        checkVictoryConditions(galaxy, galaxy.playerEmpire, gameVictoryArgs(galaxy));
        expect(events.length).toBe(1);
        const list = generateVictoryConditionProgresses(galaxy, vc, false);
        const top = Math.max(...list.map((p) => p.totalProgress));
        expect(list.find((p) => p.empire === events[0].victorEmpire)!.totalProgress).toBe(top);
        expect(events[0].description).toBe(formatGameTextNow(events[0].victorEmpire === galaxy.playerEmpire ? 'Victory Conditions Threshold Win' : 'Victory Conditions Threshold Lose'));
        doGameEnd(galaxy, events[0]);
        expect(galaxy.gameIsFinished).toBe(true);
        galaxy.gameIsFinished = false;
        galaxy.gameVictor = null;
        galaxy.globalVictoryConditions = null;
        setGameEndHandler(galaxy, null);
    });
    it('EmpireVictoryConditions to achieve / prevent (scenario conditions)', () => {
        const ev = new EmpireVictoryConditions();
        expect(checkEmpireVictoryConditionsToAchieve(galaxy, ev, galaxy.playerEmpire)).toBe(false); // nothing listed
        ev.captureColonies.push(galaxy.playerEmpire!.capital!);
        expect(checkEmpireVictoryConditionsToAchieve(galaxy, ev, galaxy.playerEmpire)).toBe(true);
        expect(checkEmpireVictoryConditionsToPrevent(galaxy, ev, galaxy.playerEmpire)).toBe(false);
        ev.eliminateEmpires.push(empires.find((e) => e !== galaxy.playerEmpire)!);
        expect(checkEmpireVictoryConditionsToAchieve(galaxy, ev, galaxy.playerEmpire)).toBe(false);
    });
});

describe('achievements (Galaxy.1.cs 2935-3754, Empire.1.cs 3969)', () => {
    it('levels, values, medal indexes, names', () => {
        expect(determineAchievementLevel(AchievementType.DestroyEnemyMilitaryShipsAndBases, 120)).toBe(2);
        expect(determineAchievementValueForLevel(AchievementType.DestroyEnemyMilitaryShipsAndBases, 2)).toBe(100);
        expect(determineAchievementLevel(AchievementType.EliminatePirateFactions, 4)).toBe(0);
        expect(determineAchievementLevel(AchievementType.DefeatShakturi, 0)).toBe(1);
        expect(resolveAchievementMedalImageIndex(AchievementType.DestroyEnemyTroops, 3)).toBe(9);
        expect(resolveAchievementMedalImageIndex(AchievementType.SuccessfulIntelligenceMissions, 1)).toBe(52);
        const a = new Achievement(AchievementType.DestroyEnemyMilitaryShipsAndBases, 120, null);
        expect(resolveAchievementDescription(a)).toBe(formatGameTextNow('AchievementType DestroyEnemyMilitaryShipsAndBases', ['100']));
        expect(resolveAchievementTitleComplete(a)).toBe(formatGameTextNow('AchievementTitle DestroyEnemyMilitaryShipsAndBases') + ' ' + formatGameTextNow('Achievement Level C'));
        expect(resolveAchievementName(new Achievement(AchievementType.AchieveAllRaceVictoryConditions, 0, null))).toBe('');
        const list = [new Achievement(AchievementType.BuildWonders, 3, null)];
        achievementListAddIfNotExistsOrBetter(list, new Achievement(AchievementType.BuildWonders, 2, null));
        expect(list.length).toBe(1);
        achievementListAddIfNotExistsOrBetter(list, new Achievement(AchievementType.BuildWonders, 4, null));
        expect(list.length).toBe(2);
    });
    it('ReviewAchievementsForEmpire thresholds; UpdateAchievements merges and records the player unlocks', () => {
        const p = galaxy.playerEmpire!;
        const saved = { ...p.counters };
        p.counters.destroyedEnemyMilitaryShipCount = 49;
        p.counters.destroyedEnemyTroopCount = 50;
        p.counters.captureShipCount = 12;
        p.counters.destroyedCreatureCountSilverMist = 10;
        p.empireSplitCount = 1;
        galaxy.gameRaceSpecificVictoryConditionsEnabled = false;
        const list = reviewAchievementsForEmpire(galaxy, p);
        const types = list.map((a) => a.type);
        expect(types).not.toContain(AchievementType.DestroyEnemyMilitaryShipsAndBases);
        expect(types).toContain(AchievementType.DestroyEnemyTroops);
        expect(types).toContain(AchievementType.CaptureEnemyShips);
        expect(types).toContain(AchievementType.DestroySilverMists);
        expect(types).toContain(AchievementType.EmpireSplits);
        // < 10 years played: no trade / mining / war-time achievements.
        expect(types).not.toContain(AchievementType.SpendNoTimeAtWar);
        p.achievements = [new Achievement(AchievementType.CaptureEnemyShips, 20, null)];
        galaxy.unlockedAchievementNames = [];
        updateAchievements(galaxy, p);
        expect(p.achievements.find((a) => a.type === AchievementType.CaptureEnemyShips)!.value).toBe(20);
        expect(p.achievements.find((a) => a.type === AchievementType.DestroyEnemyTroops)!.value).toBe(50);
        expect(galaxy.unlockedAchievementNames).toContain(formatGameTextNow('AchievementType DestroyEnemyTroops', ['50']));
        const n = galaxy.unlockedAchievementNames.length;
        updateAchievements(galaxy, p);
        expect(galaxy.unlockedAchievementNames.length).toBe(n);
        Object.assign(p.counters, saved);
        p.empireSplitCount = 0;
        p.achievements = [];
        galaxy.unlockedAchievementNames = [];
        galaxy.gameRaceSpecificVictoryConditionsEnabled = true;
    });
    it('CalculateEmpireScore sums its parts', () => {
        const s = calculateEmpireScore(galaxy, galaxy.playerEmpire);
        expect(s.population).toBe(Math.trunc(galaxy.playerEmpire!.totalPopulation / 1000000));
        expect(s.colonies).toBe(galaxy.playerEmpire!.colonies.length * 1000);
        expect(s.score).toBe(s.population + s.economy + s.colonies + s.military + s.research + s.wonders);
        expect(calculateEmpireScore(galaxy, null).score).toBe(0);
    });
});

describe('battle stats report (BaconBuiltObject.cs 2109 / 2166)', () => {
    it('crew level bands and the ShowStats text', () => {
        const ship = galaxy.playerEmpire!.builtObjects.find((b) => b.role === BuiltObjectRole.Military);
        if (ship === undefined) return;
        ship.careerBattleStats = null;
        expect(calculateCrewLevel(ship)).toBe('green');
        const s = new SpaceBattleStats();
        s.weaponsDamageToEnemy = Math.fround(5000);
        s.damageToUs = 100;
        s.destroyedEnemyShipsFrigate = 2;
        ship.battleStats = s;
        const text = buildBattleStatsReport(ship)!;
        // 5000 − 300 = 4700 → "experienced" (≥ 3999, < 8999). The crew line is computed before the fold-in.
        expect(calculateCrewLevel(ship)).toBe('experienced');
        expect(text).toContain('Crew level: green\r\n');
        expect(text).toContain('Frigate kills: \t\t2\r\n');
        expect(text).toContain('Damage Inflicted: \t\t5000\r\n');
        expect(text).toContain('Damage Taken: \t\t100\r\n');
        expect(ship.battleStats).toBeInstanceOf(SpaceBattleStats);
        ship.careerBattleStats = null;
        ship.battleStats = null;
    });
});

describe('stats XML (BaconMain.cs 1145-1283)', () => {
    it('number formats', () => {
        expect(formatNumber(1234567, '0,,M')).toBe('1M');
        expect(formatNumber(2500000, '0,,M')).toBe('3M');
        expect(formatNumber(1234567.4, '###,###,###,###,##0')).toBe('1,234,567');
        expect(formatNumber(0.456, '0%')).toBe('46%');
        expect(formatNumber(-0.04, '+0.0;-0.0;0')).toBe('0');
        expect(formatNumber(3.25, '+0.0;-0.0;0')).toBe('+3.3');
        expect(doubleToInvariantString(1e15)).toBe('1E+15');
        expect(doubleToInvariantString(123456.5)).toBe('123456.5');
        expect(doubleToInvariantString(0.00001)).toBe('1E-05');
        expect(doubleToInvariantString(Math.fround(0.1), true)).toBe('0.1');
    });
    it('appends one TimeAndValue per stat and empire, moving touched nodes last', () => {
        const empty = createEmptyGameStatsXml();
        expect(empty).toBe('<GameStats />');
        expect(processGameStatsXml(galaxy, null, galaxy.empires, EMPIRE_STATS_TO_TRACK)).toBe(null);
        const once = processGameStatsXml(galaxy, empty, galaxy.empires, EMPIRE_STATS_TO_TRACK)!;
        const twice = processGameStatsXml(galaxy, once, galaxy.empires, EMPIRE_STATS_TO_TRACK)!;
        const count = (s: string, needle: string) => s.split(needle).length - 1;
        expect(count(once, '<GameStat name=')).toBe(EMPIRE_STATS_TO_TRACK.length);
        expect(count(twice, '<GameStat name=')).toBe(EMPIRE_STATS_TO_TRACK.length);
        expect(count(twice, '<TimeAndValue>')).toBe(2 * EMPIRE_STATS_TO_TRACK.length * galaxy.empires.length);
        const years = ((galaxyStarDate(galaxy) - startStarDateForAge(galaxy.age)) / (REAL_SECONDS_IN_GALACTIC_YEAR * 1000)).toFixed(2);
        expect(once).toContain(`<Time>${years}</Time>`);
        expect(once.startsWith('<GameStats>\r\n  <GameStat name="State Money">\r\n    <SpaceEmpire name=')).toBe(true);
        // A foreign stat stays first; tracked ones are re-appended after it.
        const withForeign = once.replace('<GameStats>', '<GameStats>\r\n  <GameStat name="Other" />');
        const moved = processGameStatsXml(galaxy, withForeign, galaxy.empires, EMPIRE_STATS_TO_TRACK)!;
        expect(moved.indexOf('name="Other"')).toBeLessThan(moved.indexOf('name="State Money"'));
        const both = processGameStats(galaxy, empty, empty);
        expect(count(both.pirates!, '<GameStat name=')).toBe(galaxy.pirateEmpires.length > 0 ? PIRATE_STATS_TO_TRACK.length : 0);
        expect(processGameStatsXml(galaxy, '<GameStats><GameStat name="State Money"><X /></GameStat></GameStats>', galaxy.empires, EMPIRE_STATS_TO_TRACK)).toBe(null);
    });
});

describe('harness: seed 1 with the wizard victory conditions', () => {
    it('runs 600 s of game time evaluating victory progress without throwing', () => {
        const v = { ...defaultVictoryConditions(), territory: true, population: true, economy: true, victoryThresholdPercentage: 0.8 };
        const g = createGame({ ...tickGameOptions(gameData), victoryConditions: victoryConditionsFromWizard(v, 1), difficultyLevelScalesAsPlayerApproachesVictory: true }).galaxy;
        expect(g.globalVictoryConditions).not.toBe(null);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        const r = runGameSeconds(g, 600);
        expect(r.todoHits['checkVictoryConditions'] ?? 0).toBe(0);
        const list = generateVictoryConditionProgresses(g, g.globalVictoryConditions, true);
        expect(list.length).toBeGreaterThan(0);
        for (const p of list) {
            expect(Number.isFinite(p.totalProgress)).toBe(true);
            expect(p.raceVictoryConditionsProgress).not.toBe(null);
        }
        for (const e of g.empires) expect(Number.isInteger(e.score)).toBe(true);
        expect(ends.every((e) => e instanceof GameEndEventArgs)).toBe(true);
    }, 300000);
});
