// Task 16a: Expansion Planner pure helpers (no jsdom).
import { describe, expect, it } from 'vitest';
import type { Ruin } from '../src/sim/ruins';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';
import {
    expansionModeLabel,
    formatMillionsM,
    habitatCategoryDescription,
    habitatTypeDescription,
    plannerStatus,
    qualityPercent,
    resourceRarity,
    resourcesDescription,
    ruinHasSpecialBonus,
    ruinText,
    type PlannerStatusInput,
} from '../src/ui/screens/expansionPlanner';
import { isKeyActionAvailable } from '../src/ui/keyboard';

function ruin(fields: Partial<Record<string, unknown>>): Ruin {
    return {
        name: 'Ancient Temple',
        developmentBonus: 0,
        playerEmpireEncountered: false,
        bonusDefensive: 0,
        bonusDiplomacy: 0,
        bonusHappiness: 0,
        bonusResearchEnergy: 0,
        bonusResearchHighTech: 0,
        bonusResearchWeapons: 0,
        bonusWealth: 0,
        ...fields,
    } as unknown as Ruin;
}

describe('expansion planner labels', () => {
    it('mode labels', () => {
        expect(expansionModeLabel('colonies')).toBe('Potential Colonies');
        expect(expansionModeLabel('resourcessupply')).toBe('Your Empire Resource Locations');
    });

    it('habitat type descriptions', () => {
        expect(habitatTypeDescription(HabitatType.Continental, HabitatCategoryType.Planet)).toBe('Continental Planet');
        expect(habitatTypeDescription(HabitatType.MarshySwamp, HabitatCategoryType.Moon)).toBe('Marshy Swamp Moon');
        expect(habitatTypeDescription(HabitatType.BarrenRock, HabitatCategoryType.Asteroid)).toBe('Asteroid');
        expect(habitatTypeDescription(HabitatType.Ice, HabitatCategoryType.Asteroid)).toBe('Ice Asteroid');
        expect(habitatCategoryDescription(HabitatCategoryType.GasCloud)).toBe('Gas Cloud');
    });

    it('resources description', () => {
        const names = (id: number) => (id === 1 ? 'Iron' : id === 2 ? 'Gold' : '');
        expect(resourcesDescription([{ resourceId: 1, abundance: 125 }], false, names)).toBe('(Unknown resources)');
        expect(resourcesDescription([], true, names)).toBe('(No resources)');
        expect(
            resourcesDescription(
                [
                    { resourceId: 1, abundance: 125 },
                    { resourceId: 2, abundance: 30 },
                ],
                true,
                names,
            ),
        ).toBe('Iron (13%), Gold (3%)');
    });

    it('resource rarity', () => {
        const sup = (id: number) => id === 9;
        const lux = (id: number) => id === 5 || id === 9;
        expect(resourceRarity([], sup, lux)).toBe('C');
        expect(resourceRarity([{ resourceId: 1 }, { resourceId: 5 }], sup, lux)).toBe('R');
        expect(resourceRarity([{ resourceId: 5 }, { resourceId: 9 }], sup, lux)).toBe('VR');
    });

    it('ruin text', () => {
        expect(ruinText(null)).toBe('');
        expect(ruinText(ruin({ developmentBonus: 0.12 }))).toBe('Ancient Temple (+12%)');
        expect(ruinText(ruin({ developmentBonus: -0.034 }))).toBe('Ancient Temple (-3%)');
        expect(ruinText(ruin({ developmentBonus: 0 }))).toBe('Ancient Temple (0%)');
    });

    it('number formats', () => {
        expect(formatMillionsM(2_600_000_000)).toBe('2600M');
        expect(formatMillionsM(0)).toBe('0M');
        expect(qualityPercent(0.5)).toBe('50%');
    });

    it('special ruins', () => {
        expect(ruinHasSpecialBonus(null)).toBe(false);
        expect(ruinHasSpecialBonus(ruin({ bonusWealth: 1 }))).toBe(false);
        expect(ruinHasSpecialBonus(ruin({ bonusWealth: 1, playerEmpireEncountered: true }))).toBe(true);
    });
});

describe('plannerStatus ladder', () => {
    const base: PlannerStatusInput = {
        forColonization: true,
        inRange: true,
        specialRuins: false,
        superLuxuryKnown: false,
        inOurSystem: false,
        quality: 0.6,
        nearPirateBase: false,
        territoryOk: true,
        canColonizeBecauseAtWar: false,
        colonizationLikeliness: 0,
        techSurvivesStorms: true,
        shipsSurviveStorms: true,
        inStorm: false,
        dangerous: false,
        category: HabitatCategoryType.Planet,
    };
    const st = (o: Partial<PlannerStatusInput>) => plannerStatus({ ...base, ...o });

    it('no match', () => {
        expect(st({})).toEqual({ color: null, reason: '' });
    });
    it('range first', () => {
        expect(st({ inRange: false })).toEqual({ color: 0xc03030, reason: 'Too far from existing colonies' });
        expect(st({ inRange: false, specialRuins: true })).toEqual({ color: 0xc03030, reason: 'Too far from existing colonies' });
    });
    it('special ruins / luxury', () => {
        expect(st({ specialRuins: true })).toEqual({ color: 0x6060ff, reason: 'Special ruins at this planet!' });
        expect(st({ superLuxuryKnown: true }).reason).toBe('Special luxury resources at this planet!');
    });
    it('our system', () => {
        expect(st({ inOurSystem: true })).toEqual({ color: 0x00c000, reason: 'Planet is in one of our systems' });
        expect(st({ inOurSystem: true, quality: 0.4 })).toEqual({ color: 0xe08000, reason: 'Low quality makes colonization undesirable' });
        expect(st({ forColonization: false, inOurSystem: true }).reason).toBe('Planet is in one of our systems');
    });
    it('pirates / territory / likeliness', () => {
        expect(st({ nearPirateBase: true })).toEqual({ color: 0xc0c000, reason: 'Pirate base in this system' });
        expect(st({ forColonization: false, territoryOk: false }).reason).toBe("Mining location in another empire's system");
        expect(st({ colonizationLikeliness: -5 }).reason).toBe('Colonization unlikely due to hostile population');
        expect(st({ colonizationLikeliness: -4 })).toEqual({ color: null, reason: '' });
    });
    it('storms / danger', () => {
        expect(st({ inStorm: true, techSurvivesStorms: false }).reason).toBe('Galactic storm makes colonization hazardous');
        expect(st({ inStorm: true, techSurvivesStorms: true })).toEqual({ color: null, reason: '' });
        expect(st({ forColonization: false, inStorm: true, shipsSurviveStorms: false }).reason).toBe(
            'Galactic storm makes construction hazardous',
        );
        expect(st({ dangerous: true }).reason).toBe('Our last scan of this location showed nearby pirates or space monsters');
    });
});

describe('keyboard', () => {
    it('F3 is implemented', () => {
        expect(isKeyActionAvailable('expansionPlannerScreen')).toBe(true);
    });
});
