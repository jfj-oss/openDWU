import { describe, expect, it } from 'vitest';
import {
    achievementRows,
    canContinueAfterGameEnd,
    formatComparisonValue,
    gameEndBannerLines,
    globalConditionLines,
    installGameEndHandler,
    isKnownEmpire,
    knownEmpires,
    percent0,
    rankDescending,
    removeGameEndHandler,
    victoryProgressRows,
} from '../src/ui/screens/empireComparison';
import type { ConditionEmpireStat, ConditionInput } from '../src/ui/screens/empireComparison';
import { GameEndEventArgs, GameEndOutcome, onGameEnd, VictoryConditionProgress, VictoryConditions } from '../src/sim/victory';
import { Achievement, AchievementType } from '../src/sim/achievements';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType } from '../src/sim/diplomacy';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { isKeyActionAvailable } from '../src/ui/keyboard';

describe('formatting', () => {
    it('percent0', () => {
        expect(percent0(0.756)).toBe('76%');
        expect(percent0(NaN)).toBe('0%');
    });
    it('formatComparisonValue', () => {
        expect(formatComparisonValue('population', 2_600_000_000)).toBe('2600M');
        expect(formatComparisonValue('territory', 7)).toBe('7 colonies');
        expect(formatComparisonValue('territory', 1)).toBe('1 colony');
        expect(formatComparisonValue('economy', 12_345)).toBe('12K credits');
        expect(formatComparisonValue('strategicValue', 250_000)).toBe('250K');
        expect(formatComparisonValue('military', 42)).toBe('42 firepower');
    });
});

function stat(name: string, over: Partial<ConditionEmpireStat>): ConditionEmpireStat {
    return { name, playable: true, known: false, isPlayer: false, revenue: 0, population: 0, colonies: 0, ...over };
}

function baseInput(): ConditionInput {
    const conditions = new VictoryConditions();
    conditions.economy = true;
    conditions.economyPercent = 40;
    return {
        conditions,
        finished: false,
        victorName: null,
        raceSpecificEnabled: false,
        scenarioConditions: false,
        empires: [
            stat('Us', { isPlayer: true, known: true, revenue: 100 }),
            stat('Zorg', { known: false, revenue: 300 }),
            stat('Mech', { playable: false, revenue: 1000 }),
        ],
        defend: null,
        target: null,
        starDateText: (d) => `SD${d}`,
    };
}

const texts = (input: ConditionInput): string[] => globalConditionLines(input).map((l) => l.text);

describe('globalConditionLines', () => {
    it('economy with an unknown closest empire', () => {
        expect(texts(baseInput())).toEqual([
            'Global Conditions',
            "Empire's private economy (GDP) generates 40% of galaxy total",
            'Closest Empire: (Unknown empire)',
        ]);
    });
    it('known closest empire and share over all empires', () => {
        const input = baseInput();
        input.empires[1].known = true;
        expect(texts(input)).toContain('Closest Empire: Zorg (21%)');
    });
    it('no closest empire', () => {
        const input = baseInput();
        for (const e of input.empires) e.revenue = 0;
        expect(texts(input)).toContain('Closest Empire: (None)');
    });
    it('time limit and start date', () => {
        const input = baseInput();
        input.conditions!.timeLimit = true;
        input.conditions!.timeLimitDate = 5;
        input.conditions!.startDate = 9;
        const t = texts(input);
        expect(t.slice(0, 4)).toEqual([
            'Global Conditions',
            'Game finishes at SD5',
            '(Winner is the empire with the greatest strategic value at this time)',
            'Victory Conditions do not apply until SD9',
        ]);
    });
    it('game over and winner first', () => {
        const input = baseInput();
        input.finished = true;
        input.victorName = 'Zorg';
        const lines = globalConditionLines(input);
        expect(lines[0]).toEqual({ text: 'GAME OVER', emphasis: true });
        expect(lines[1]).toEqual({ text: 'Winner: Zorg', emphasis: true });
    });
    it('defend colony', () => {
        const input = baseInput();
        input.defend = { category: 'planet', name: 'Terra', empireName: 'Us' };
        expect(texts(input)).toContain('You must prevent the planet Terra of the Us from being taken over or destroyed');
    });
    it('sandbox mode', () => {
        const input = baseInput();
        input.conditions!.economy = false;
        let t = texts(input);
        expect(t[t.length - 1]).toBe('SANDBOX MODE (Open Play - No victory conditions)');
        input.raceSpecificEnabled = true;
        t = texts(input);
        expect(t.slice(-2)).toEqual(['Race-specific Victory Conditions are Active', 'SANDBOX MODE (Open Play - No victory conditions)']);
        input.raceSpecificEnabled = false;
        input.conditions = null;
        t = texts(input);
        expect(t[t.length - 1]).toBe('SANDBOX MODE (Open Play - No victory conditions)');
    });
    it('territory', () => {
        const input = baseInput();
        input.conditions!.economy = false;
        input.conditions!.territory = true;
        input.conditions!.territoryPercent = 25;
        input.empires[0].colonies = 3;
        input.empires[1].colonies = 1;
        input.empires[1].known = true;
        const t = texts(input);
        expect(t).toContain('Control 25% of colonies in the galaxy');
        expect(t).toContain('Closest Empire: Us (75%)');
    });
});

describe('rankDescending', () => {
    it('stable descending with ranks from 1', () => {
        const a = { id: 'a' };
        const b = { id: 'b' };
        const c = { id: 'c' };
        const r = rankDescending([{ item: a, value: 5 }, { item: b, value: 9 }, { item: c, value: 5 }]);
        expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
        expect(r.map((x) => x.item)).toEqual([b, a, c]);
        expect(r.map((x) => x.value)).toEqual([9, 5, 5]);
    });
});

function fakeEmpire(empireId: number, name: string): Empire {
    return { empireId, name, colonies: [] } as unknown as Empire;
}

function playerWithRelations(): { player: Empire; a: Empire; b: Empire; c: Empire } {
    const player = fakeEmpire(1, 'Player');
    const a = fakeEmpire(2, 'Alpha');
    const b = fakeEmpire(3, 'Beta');
    const c = fakeEmpire(4, 'Gamma');
    const list = new DiplomaticRelationList();
    list.add(new DiplomaticRelation(DiplomaticRelationType.War, player, player, a, false));
    list.add(new DiplomaticRelation(DiplomaticRelationType.NotMet, player, player, b, false));
    (player as unknown as { diplomaticRelations: DiplomaticRelationList }).diplomaticRelations = list;
    return { player, a, b, c };
}

describe('known empires', () => {
    it('knownEmpires', () => {
        const { player, a } = playerWithRelations();
        expect(knownEmpires(player)).toEqual([player, a]);
    });
    it('isKnownEmpire', () => {
        const { player, a, b, c } = playerWithRelations();
        expect(isKnownEmpire(player, player)).toBe(true);
        expect(isKnownEmpire(player, a)).toBe(true);
        expect(isKnownEmpire(player, b)).toBe(false);
        expect(isKnownEmpire(player, c)).toBe(false);
    });
});

describe('victoryProgressRows', () => {
    it('filters unknown empires and sorts descending', () => {
        const { player, a, b } = playerWithRelations();
        const progresses = [
            new VictoryConditionProgress(a, true, false, true, 0.5, 0, 0.2, null),
            new VictoryConditionProgress(player, true, false, true, 0.5, 0, 0.2, null),
            new VictoryConditionProgress(b, true, false, true, 0.9, 0, 0.9, null),
        ];
        const rows = victoryProgressRows(progresses, player, (e) => isKnownEmpire(player, e));
        expect(rows.map((r) => r.name)).toEqual(['Player', 'Alpha']);
        const p = rows[0];
        expect(p.isPlayer).toBe(true);
        expect(p.territory).toBeCloseTo(0.25);
        expect(p.economy).toBeNull();
        expect(p.population).toBeCloseTo(0.1);
        expect(p.race).toBeNull();
        expect(p.total).toBeCloseTo(0.35);
        expect(p.bonus).toBe(0);
    });
});

describe('achievementRows', () => {
    const text = new Map([
        ['AchievementTitle ConquerEnemyColonies', 'Conqueror'],
        ['AchievementType ConquerEnemyColonies', 'Conquer {0} Enemy Colonies'],
        ['Achievement Level II', 'II'],
    ]);
    it('resolves through GameText', () => {
        expect(achievementRows([new Achievement(AchievementType.ConquerEnemyColonies, 60, null)], text)).toEqual([
            { title: 'Conqueror', level: 'II', description: 'Conquer 50 Enemy Colonies' },
        ]);
    });
    it('shows keys without GameText', () => {
        expect(achievementRows([new Achievement(AchievementType.ConquerEnemyColonies, 60, null)], null)).toEqual([
            { title: 'AchievementTitle ConquerEnemyColonies', level: 'Achievement Level II', description: 'AchievementType ConquerEnemyColonies' },
        ]);
    });
    it('no level text for StartWars', () => {
        expect(achievementRows([new Achievement(AchievementType.StartWars, 20, null)], null)[0].level).toBe('');
    });
    it('skips null and Undefined', () => {
        expect(achievementRows([null, new Achievement(AchievementType.Undefined, 5, null)], text)).toEqual([]);
    });
});

describe('game end', () => {
    const victor = fakeEmpire(2, 'Zorg');
    it('gameEndBannerLines', () => {
        expect(gameEndBannerLines(new GameEndEventArgs(victor, GameEndOutcome.Victory, 'd', 0))).toEqual(['VICTORY!', ' ', 'd']);
        expect(gameEndBannerLines(new GameEndEventArgs(victor, GameEndOutcome.Defeat, 'd', 0))).toEqual(['DEFEAT!', ' ', 'd']);
        expect(gameEndBannerLines(new GameEndEventArgs(victor, GameEndOutcome.Stalemate, 'd', 0))).toEqual([' ', 'd']);
    });
    it('canContinueAfterGameEnd', () => {
        const defeat = new GameEndEventArgs(victor, GameEndOutcome.Defeat, 'd', 0);
        expect(canContinueAfterGameEnd(defeat, { colonies: [], active: true } as unknown as Empire)).toBe(false);
        expect(canContinueAfterGameEnd(defeat, { colonies: [{}], active: true } as unknown as Empire)).toBe(true);
        expect(canContinueAfterGameEnd(new GameEndEventArgs(victor, GameEndOutcome.Victory, 'd', 0), { colonies: [], active: true } as unknown as Empire)).toBe(true);
    });
    it('installGameEndHandler / removeGameEndHandler', () => {
        const galaxy = { empires: [], pirateEmpires: [], gameIsFinished: false, gameVictor: null, playerEmpire: null } as unknown as Galaxy;
        const time = { paused: false };
        installGameEndHandler(galaxy, time);
        onGameEnd(galaxy, new GameEndEventArgs(victor, GameEndOutcome.Defeat, 'x', 0));
        expect(galaxy.gameIsFinished).toBe(true);
        expect(galaxy.gameVictor).toBe(victor);
        expect(time.paused).toBe(true);
        // Without a subscriber the sim still ends the game (DoGameEnd's model part is the sim's: victory.ts onGameEnd);
        // only the UI part (the pause, the banner) is gone.
        galaxy.gameIsFinished = false;
        time.paused = false;
        removeGameEndHandler(galaxy);
        onGameEnd(galaxy, new GameEndEventArgs(victor, GameEndOutcome.Defeat, 'x', 0));
        expect(galaxy.gameIsFinished).toBe(true);
        expect(time.paused).toBe(false);
    });
});

describe('keyboard', () => {
    it('V is implemented', () => {
        expect(isKeyActionAvailable('empireComparisonScreen')).toBe(true);
    });
});
