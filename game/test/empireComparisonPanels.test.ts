// Parity #14: the Empire Comparison window's panel models (empireComparison.ts) and the Game Summary panel helpers
// (gameSummary.ts). Hand-built fixtures; no DOM.
import { describe, expect, it } from 'vitest';
import {
    comparisonGraphRows,
    diplomaticRelationTypeReadOnly,
    isVictoryProgressVisible,
    pirateRelationTypeReadOnly,
    scenarioConditionLines,
    scenarioConditionsText,
    topColonies,
    topColonyRowCap,
    topColonyStatsLine,
    victoryBarGeometry,
    victoryBarSegments,
    victoryDetailModel,
    victoryDetailTop,
    victoryHeaderLines,
    type VictoryDetailContext,
} from '../src/ui/screens/empireComparison';
import {
    MEDAL_FILES,
    addGameSummary,
    emptyGameSummaryList,
    groupedInt,
    loadGameSummaryList,
    medalImageUrl,
    resolveDifficultyDescription,
    resolveValidEmpires,
    saveGameSummaryList,
    sortGameSummariesForDisplay,
    storedAchievementsAddIfNotExistsOrBetter,
    gameSummaryAreas,
    type StoredAchievement,
    type StoredGameSummary,
} from '../src/ui/screens/gameSummary';
import { EmpireVictoryConditions, RaceVictoryConditionProgress, VictoryConditionProgress, VictoryConditions } from '../src/sim/victory';
import { AchievementType } from '../src/sim/achievements';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType } from '../src/sim/diplomacy';
import { PirateRelation, PirateRelationList, PirateRelationType } from '../src/sim/pirateRelations';
import { RaceVictoryConditionType } from '../src/sim/data/races';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';

function emp(empireId: number, name: string, over: Partial<Record<string, unknown>> = {}): Empire {
    return {
        empireId,
        name,
        colonies: [],
        active: true,
        pirateEmpireBaseHabitat: null,
        diplomaticRelations: new DiplomaticRelationList(),
        pirateRelations: new PirateRelationList(),
        dominantRace: { name: 'Human' },
        ...over,
    } as unknown as Empire;
}

function relate(self: Empire, other: Empire, type: DiplomaticRelationType): void {
    self.diplomaticRelations.add(new DiplomaticRelation(type, self, self, other, false));
}

function colony(name: string, owner: Empire, systemIndex: number, pop: number): Habitat {
    const h = { name, owner, empire: owner, systemIndex, population: { items: pop > 0 ? [{}] : [], totalAmount: pop } } as unknown as Habitat;
    (owner.colonies as Habitat[]).push(h);
    return h;
}

describe('comparisonGraphRows (EmpireComparison.cs DrawEmpireComparison)', () => {
    it('ranks descending, rows from y 47 every 25 px, bar fills against the leader', () => {
        const { top, rows } = comparisonGraphRows([{ item: 'a', value: 50 }, { item: 'b', value: 200 }, { item: 'c', value: 100 }], 660);
        expect(top).toBe(200);
        expect(rows.map((r) => r.item)).toEqual(['b', 'c', 'a']);
        expect(rows.map((r) => r.y)).toEqual([47, 72, 97]);
        expect(rows.map((r) => r.fillWidth)).toEqual([800, 400, 200]);
        expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    });
    it('caps the rows at num4 + 1 = (height - 50) / 25 + 1', () => {
        const items = Array.from({ length: 40 }, (_, i) => ({ item: i, value: 40 - i }));
        expect(comparisonGraphRows(items, 660).rows).toHaveLength(25);
        expect(comparisonGraphRows(items, 300).rows).toHaveLength(11);
    });
    it('an all-zero comparison draws empty bars', () => {
        expect(comparisonGraphRows([{ item: 'a', value: 0 }], 660).rows[0].fillWidth).toBe(0);
    });
});

describe('topColonies (TopColonies.cs DrawColonies)', () => {
    const player = emp(1, 'Us');
    const other = emp(2, 'Them');
    const unmet = emp(3, 'Unmet');
    const pirate = emp(4, 'Pirates', { pirateEmpireBaseHabitat: {} });
    relate(player, other, DiplomaticRelationType.None);
    relate(player, unmet, DiplomaticRelationType.NotMet);
    player.pirateRelations.add(new PirateRelation(player, pirate, PirateRelationType.None));
    (player as unknown as { visibility: unknown }).visibility = { checkSystemExplored: (i: number) => i !== 9 };
    const mine = colony('Mine', player, 9, 1e9);
    const theirs = colony('Theirs', other, 1, 2e9);
    const hidden = colony('Hidden', other, 9, 5e9);
    const notOwned = colony('NotOwned', other, 1, 5e9);
    (notOwned as unknown as { owner: Empire }).owner = unmet;
    colony('UnmetCol', unmet, 1, 9e9);
    const pir = colony('Lair', pirate, 2, 3e9);
    const sv = new Map<Habitat, number>([[mine, 10000], [theirs, 10000], [pir, 30000]]);
    it('player colonies always, met empires / pirates in explored systems, sorted by strategic value then population', () => {
        const list = topColonies(player, (h) => sv.get(h) ?? 0);
        expect(list).toEqual([pir, theirs, mine]);
        expect(list).not.toContain(hidden);
        expect(list).not.toContain(notOwned);
    });
    it('row cap and stats line', () => {
        expect(topColonyRowCap(660)).toBe(10);
        expect(topColonyStatsLine(2_345_600_000, 87, 12_400)).toBe('Population: 2346M,   Development Level: 87%,   GDP: 12K credits');
    });
});

describe('relation lookups are read-only', () => {
    it('missing relations read as NotMet and are not added', () => {
        const a = emp(1, 'A', { galaxy: { independentEmpire: null } });
        const b = emp(2, 'B');
        expect(diplomaticRelationTypeReadOnly(a, b)).toBe(DiplomaticRelationType.NotMet);
        expect(a.diplomaticRelations.count ?? [...a.diplomaticRelations].length).toBe(0);
        expect(diplomaticRelationTypeReadOnly(a, a)).toBe(DiplomaticRelationType.None);
        expect(pirateRelationTypeReadOnly(a, b)).toBe(PirateRelationType.NotMet);
        expect(a.pirateRelations.count).toBe(0);
    });
    it('isVictoryProgressVisible: diplomatic for two normal empires, pirate relations otherwise', () => {
        const player = emp(1, 'P', { galaxy: { independentEmpire: null } });
        const met = emp(2, 'Met');
        const unmet = emp(3, 'Unmet');
        const pirate = emp(4, 'Pirate', { pirateEmpireBaseHabitat: {} });
        relate(player, met, DiplomaticRelationType.War);
        expect(isVictoryProgressVisible(player, player)).toBe(true);
        expect(isVictoryProgressVisible(player, met)).toBe(true);
        expect(isVictoryProgressVisible(player, unmet)).toBe(false);
        expect(isVictoryProgressVisible(player, pirate)).toBe(false);
        player.pirateRelations.add(new PirateRelation(player, pirate, PirateRelationType.None));
        expect(isVictoryProgressVisible(player, pirate)).toBe(true);
    });
});

describe('victory bars (RaceVictoryConditionsPanel.cs DrawConditions)', () => {
    it('geometry: 36 px flag, race at 39, bar from 64, threshold line', () => {
        expect(victoryBarGeometry(840, 0.5)).toEqual({ flagW: 36, raceX: 39, barX: 64, barW: 776, thresholdX: 64 + 388 });
    });
    it('stacked segments; a sub-pixel segment advances x without drawing', () => {
        const gvc = new VictoryConditions();
        gvc.economy = true;
        gvc.territory = true;
        gvc.enableRaceSpecificVictoryConditions = false;
        const p = new VictoryConditionProgress({ name: 'X' } as Empire, true, true, false, 0.5, 0.001, 0, null);
        p.bonusAmount = 0.1;
        const segs = victoryBarSegments(p, gvc, 64, 776);
        // portions: 2 → economy 0.0005 × 776 < 1 (skipped), territory 0.25 × 776 = 194, bonus 77.6.
        expect(segs.map((s) => s.kind)).toEqual(['territory', 'bonus']);
        expect(segs[0]).toEqual({ kind: 'territory', x: 64, w: 194 });
        expect(segs[1].x).toBe(Math.trunc(64 + 0.0005 * 776 + 194));
        expect(segs[1].w).toBe(77);
    });
    it('detail box below the row when it fits, else above', () => {
        expect(victoryDetailTop(0, 30, 660)).toBe(5 + 22 + 30);
        expect(victoryDetailTop(12, 30, 660)).toBe(5 + 12 * 28 - 300 + 30);
    });
});

function ctx(over: Partial<VictoryDetailContext> = {}): VictoryDetailContext {
    return {
        isPlayer: false,
        isPirate: false,
        economyValue: 1234567,
        populationValue: 4_200_000_000,
        colonyCount: 7,
        pirateColonies: null,
        ownedColonyPopulation: 0,
        raceName: 'Human',
        piratePlayStyle: 'Raider',
        describe: () => 'Do the thing',
        bestEmpireName: (c) => c.bestEmpire?.name ?? null,
        ...over,
    };
}

describe('victoryDetailModel (DrawEmpireConditionsDetail)', () => {
    const gvc = new VictoryConditions();
    gvc.economy = true;
    gvc.economyPercent = 40;
    gvc.territory = true;
    gvc.territoryPercent = 30;
    gvc.victoryThresholdPercentage = 0.75;
    const e = { name: 'Zorg' } as Empire;
    const best = { name: 'Best' } as Empire;
    const cond = { type: RaceVictoryConditionType.DestroyMostShips, proportion: 25, amount: 0, additionalData: null };
    const race = [new RaceVictoryConditionProgress(cond.type, 0.1, 0.4, best, '12 ships', cond), new RaceVictoryConditionProgress(cond.type, 0.05, 0.2, null, '', cond)];
    const p = new VictoryConditionProgress(e, true, true, false, 0.6, 0.3, 0, race);
    p.economyPercent = 0.123;
    p.territoryPercent = 0.2;
    it('three portions: columns at k · W/4 + 5, separators, race column twice as wide', () => {
        const m = victoryDetailModel(p, gvc, ctx(), 840);
        expect(m.columnWidth).toBe(210);
        expect(m.separators).toEqual([210, 420]);
        expect(m.columns.map((c) => [c.kind, c.x, c.width])).toEqual([['economy', 5, 200], ['territory', 215, 200]]);
        expect(m.columns[0].heading).toBe('Economy  10/33%');
        expect(m.columns[0].target).toBe("Empire's private economy (GDP) generates 40% of galaxy total");
        expect(m.columns[0].who).toBe('Zorg:');
        expect(m.columns[0].value).toBe("Empire's private economy (GDP) generates 12% of galaxy total  (1,234,567 credits)");
        expect(m.columns[1].value).toBe('Control 20% of colonies in the galaxy  (7 colonies)');
        expect(m.race).not.toBeNull();
        expect(m.race!.x).toBe(425);
        expect(m.race!.width).toBe(410);
        expect(m.race!.descriptionWidth).toBe(350);
        expect(m.race!.heading).toBe('Human Race Victory Conditions  5/33%');
        expect(m.race!.rows[0]).toEqual({ portion: '25%', description: 'Do the thing', progress: '40%', extra: 'Best: 12 ships' });
        expect(m.race!.rows[1].extra).toBeNull();
        expect(m.title).toBe('Zorg  (35%)');
        expect(m.threshold).toBe('Victory Threshold: 75%');
        expect(m.height).toBe(300);
        expect(m.bonus).toBeNull();
    });
    it('an unmet best empire is not named; the player reads "Your Empire"', () => {
        const m = victoryDetailModel(p, gvc, ctx({ isPlayer: true, bestEmpireName: () => null }), 840);
        expect(m.race!.rows[0].extra).toBe('12 ships');
        expect(m.columns[0].who).toBe('Your Empire:');
    });
    it('pirate variants: play-style heading, owned + controlled / 2 territory, population bonus footer', () => {
        const pp = new VictoryConditionProgress(e, true, false, false, 0.5, 0, 0, race);
        pp.territoryPercent = 0.1;
        pp.pirateBonusAmount = 0.02;
        const m = victoryDetailModel(pp, gvc, ctx({ isPirate: true, pirateColonies: { controlled: 3, owned: 2 }, ownedColonyPopulation: 1e9 }), 840);
        expect(m.columns[0].value).toBe('Control 10% of colonies in the galaxy  (3.5 colonies:  3 controlled, 2 owned)');
        expect(m.race!.heading).toBe('Raider Victory Conditions  8/50%');
        expect(m.height).toBe(360);
        expect(m.bonus).toEqual({ title: 'Pirate Colonized Population Bonus: +2.0%', detail: '1000M population at colonies owned by Zorg' });
    });
    it('game-event bonus with standing wonders', () => {
        const pb = new VictoryConditionProgress(e, false, true, false, 0, 0.5, 0, null);
        pb.bonusAmount = 0.05;
        pb.standingWonderBonusAmount = 0.02;
        const m = victoryDetailModel(pb, gvc, ctx(), 840);
        expect(m.columnWidth).toBe(420);
        expect(m.bonus).toEqual({ title: 'Game Events and Standing Wonders Bonus: +5.0%', detail: '+5.0% total bonuses from game events and standing wonders' });
    });
    it('race conditions only: one full-width portion', () => {
        const pr = new VictoryConditionProgress(e, false, false, false, 0, 0, 0, race);
        const m = victoryDetailModel(pr, gvc, ctx(), 840);
        expect(m.columnWidth).toBe(840);
        expect(m.race!.x).toBe(5);
        expect(m.race!.width).toBe(830);
    });
});

describe('victory header and scenario lists', () => {
    it('race panel header (DrawVictoryConditions)', () => {
        const c = new VictoryConditions();
        c.timeLimit = true;
        c.timeLimitDate = 3;
        const r = victoryHeaderLines({ finished: true, victorName: 'Zorg', conditions: c, scenarioConditions: false, defend: null, target: null, starDateText: (d) => `SD${d}` });
        expect(r.lines.map((l) => [l.text, l.x, l.y])).toEqual([
            ['GAME OVER', 10, 10],
            ['Winner: Zorg', 50, 24],
            [' Game finishes at SD3', 10, 52],
            ['(Winner is the empire with the greatest strategic value at this time)', 50, 66],
        ]);
        expect(r.endY).toBe(94);
    });
    it('sandbox when nothing applies (race conditions count as a condition)', () => {
        const c = new VictoryConditions();
        c.enableRaceSpecificVictoryConditions = false;
        expect(victoryHeaderLines({ finished: false, victorName: null, conditions: c, scenarioConditions: false, defend: null, target: null, starDateText: String }).lines[0].text).toBe('SANDBOX MODE (Open Play - No victory conditions)');
        c.enableRaceSpecificVictoryConditions = true;
        expect(victoryHeaderLines({ finished: false, victorName: null, conditions: c, scenarioConditions: false, defend: null, target: null, starDateText: String }).lines).toEqual([]);
    });
    it('scenario lists (GameVictoryConditions.cs)', () => {
        const owner = { name: 'Zorg' } as Empire;
        const cap = { name: 'Zorgon Prime', empire: owner } as unknown as Habitat;
        (owner as unknown as { capital: Habitat }).capital = cap;
        const ach = new EmpireVictoryConditions();
        ach.captureColonies.push(cap, { name: 'Moon', empire: owner } as unknown as Habitat);
        ach.eliminateEmpires.push({ name: 'Bad' } as Empire);
        const prev = new EmpireVictoryConditions();
        prev.captureColonies.push(cap);
        const r = scenarioConditionLines(scenarioConditionsText(ach, true), scenarioConditionsText(prev, false), 100);
        expect(r.lines.map((l) => [l.text, l.x, l.y])).toEqual([
            ['Your Conditions to Achieve', 30, 100],
            ['Capture the following colonies: ', 70, 128],
            ['Zorg capital', 310, 128],
            ['Moon', 310, 142],
            ['Eliminate the following empires: ', 70, 170],
            ['Bad', 310, 170],
            ['Your Conditions to Prevent', 30, 198],
            ['Loss of the following colonies: ', 70, 226],
            ['Zorgon Prime', 310, 226],
        ]);
        expect(r.endY).toBe(254);
    });
});

describe('Game Summary (GameSummaryPanel.cs)', () => {
    it('medal files: index per type/level, with the on-disk .PNG names', () => {
        expect(MEDAL_FILES).toHaveLength(55);
        expect(medalImageUrl(AchievementType.DestroyEnemyMilitaryShipsAndBases, 60)).toBe('/assets/dwu/images/ui/achievements/DestroyEnemyMilitaryShips_1.PNG');
        expect(medalImageUrl(AchievementType.DestroyEnemyCivilianShipsAndBases, 2000)).toBe('/assets/dwu/images/ui/achievements/DestroyEnemyCivilianShips_3.png');
        expect(medalImageUrl(AchievementType.EliminateEnemyEmpires, 5)).toBe('/assets/dwu/images/ui/achievements/EliminateEnemyEmpires_2.PNG');
        expect(medalImageUrl(AchievementType.DestroySilverMists, 100)).toBe('/assets/dwu/images/ui/achievements/DestroySilverMists_3.PNG');
        expect(medalImageUrl(AchievementType.SuccessfulIntelligenceMissions, 25)).toBe('/assets/dwu/images/ui/achievements/SuccessfulIntelligenceMissions_1.png');
        expect(medalImageUrl(AchievementType.AchieveAllRaceVictoryConditions, 1)).toBe('/assets/dwu/images/ui/achievements/AchieveAllRaceVictoryConditions.png');
    });
    const ach = (type: AchievementType, value: number): StoredAchievement => ({ type, value, raceName: null, racePictureIndex: null });
    const summary = (score: number, achievements: StoredAchievement[] = []): StoredGameSummary => ({
        galaxyStarCount: 500, difficultyLevel: 1, playerRaceName: 'Human', playerRacePictureIndex: 3, playerGovernmentName: 'Democracy',
        playerEmpireName: `E${score}`, playerMainColor: 0xff0000, playerScore: score, playerVictory: false, playerAchievements: achievements,
    });
    it('AddIfNotExistsOrBetter: a type already there with a >= value blocks the new one', () => {
        const list: StoredAchievement[] = [ach(AchievementType.StartWars, 5)];
        storedAchievementsAddIfNotExistsOrBetter(list, ach(AchievementType.StartWars, 3));
        storedAchievementsAddIfNotExistsOrBetter(list, ach(AchievementType.StartWars, 5));
        expect(list).toHaveLength(1);
        storedAchievementsAddIfNotExistsOrBetter(list, ach(AchievementType.StartWars, 9));
        storedAchievementsAddIfNotExistsOrBetter(list, ach(AchievementType.BreakTreaties, 1));
        expect(list.map((a) => [a.type, a.value])).toEqual([[AchievementType.StartWars, 5], [AchievementType.StartWars, 9], [AchievementType.BreakTreaties, 1]]);
    });
    it('addGameSummary merges the achievements; display order is by score descending', () => {
        const list = emptyGameSummaryList();
        addGameSummary(list, summary(100, [ach(AchievementType.StartWars, 1)]));
        addGameSummary(list, summary(300, [ach(AchievementType.StartWars, 1), ach(AchievementType.DefeatAncients, 1)]));
        addGameSummary(list, summary(200));
        expect(list.playerAchievements.map((a) => a.type)).toEqual([AchievementType.StartWars, AchievementType.DefeatAncients]);
        expect(sortGameSummariesForDisplay(list.summaries).map((s) => s.playerScore)).toEqual([300, 200, 100]);
    });
    it('persists through storage; garbage reads as an empty list', () => {
        const mem = new Map<string, string>();
        const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
        const list = emptyGameSummaryList();
        addGameSummary(list, summary(42));
        saveGameSummaryList(list, storage);
        expect(loadGameSummaryList(storage)).toEqual(list);
        mem.set('dwu.gameSummaries', '{nope');
        expect(loadGameSummaryList(storage)).toEqual(emptyGameSummaryList());
        expect(loadGameSummaryList(null)).toEqual(emptyGameSummaryList());
    });
    it('ResolveValidEmpires: met empires of the player kind while playing, all once finished, never Mechanoid/Shakturi', () => {
        const player = emp(1, 'P');
        const met = emp(2, 'Met');
        const mech = emp(3, 'Mech', { dominantRace: { name: 'Mechanoid' } });
        const inactive = emp(4, 'Gone', { active: false });
        const unmet = emp(5, 'Unmet');
        relate(player, met, DiplomaticRelationType.None);
        relate(player, mech, DiplomaticRelationType.None);
        relate(player, inactive, DiplomaticRelationType.None);
        relate(player, unmet, DiplomaticRelationType.NotMet);
        const galaxy = { playerEmpire: player, empires: [player, met, mech, inactive, unmet], pirateEmpires: [], gameIsFinished: false, shakturiActualRace: null } as unknown as Galaxy;
        expect(resolveValidEmpires(galaxy).map((e) => e.name)).toEqual(['P', 'Met']);
        galaxy.gameIsFinished = true;
        expect(resolveValidEmpires(galaxy).map((e) => e.name)).toEqual(['P', 'Met', 'Gone', 'Unmet']);
    });
    it('areas, difficulty and score formats', () => {
        const a = gameSummaryAreas(860, 660);
        expect(a.detail).toEqual({ x: 10, y: 10, w: 240, h: 170 });
        expect(a.medals).toEqual({ x: 260, y: 10, w: 590, h: 170 });
        expect(a.factions).toEqual({ x: 10, y: 190, w: 840, h: 130 });
        expect(a.collection).toEqual({ x: 10, y: 330, w: 840, h: 80 });
        expect(a.games).toEqual({ x: 10, y: 420, w: 840, h: 230 });
        expect([0.5, 1, 1.2, 1.5, 2].map(resolveDifficultyDescription)).toEqual(['Easy', 'Normal', 'Hard', 'Very Hard', 'Extreme']);
        expect(groupedInt(1234567)).toBe('1,234,567');
        expect(groupedInt(0)).toBe('0');
    });
});
