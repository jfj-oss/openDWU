import { describe, expect, it } from 'vitest';
import {
    COLONY_TABS,
    colonyApprovalMood,
    colonyApprovalTooltip,
    colonyCountText,
    colonyFacilitiesText,
    colonySystemName,
    colonyTabLabels,
    countColonySystems,
    developmentDescription,
    feelingDescription,
    formatGrowthPercent,
    formatPopulationM,
    formatSigned0,
    formatStrategicValueK,
    formatTaxPercent,
    populationRows,
    sortAttitudeFactors,
    taxSteps,
} from '../src/ui/screens/coloniesScreen';
import { HabitatCategoryType, type Habitat } from '../src/sim/types';
import { ShipActionType } from '../src/sim/player/shipAction';
import type { Race } from '../src/sim/data/races';

const hab = (name: string, category: HabitatCategoryType, parent: Partial<Habitat> | null = null): Habitat =>
    ({ name, category, parent }) as unknown as Habitat;

describe('Colonies screen grid (HabitatListView.BindData)', () => {
    it('resolves the system name by category', () => {
        const star = hab('Sol', HabitatCategoryType.Star);
        const planet = hab('Earth', HabitatCategoryType.Planet, star);
        const moon = hab('Luna', HabitatCategoryType.Moon, planet);
        expect(colonySystemName(star)).toBe('Sol');
        expect(colonySystemName(planet)).toBe('Sol');
        expect(colonySystemName(moon)).toBe('Sol');
        expect(colonySystemName(hab('Rock', HabitatCategoryType.Asteroid, star))).toBe('Sol');
    });

    it('lists facilities with the construction progress', () => {
        expect(colonyFacilitiesText(null)).toBe('');
        expect(colonyFacilitiesText([{ name: 'Space Port', constructionProgress: 1 }, { name: 'Academy', constructionProgress: 0.4 }])).toBe('Space Port, Academy (40%)');
    });

    it('formats the cells like the .NET column formats', () => {
        expect(formatTaxPercent(0.23)).toBe('23%');
        expect(formatTaxPercent(0)).toBe('0%');
        expect(formatPopulationM(12_429_000_000)).toBe('12429M');
        expect(formatPopulationM(350_000)).toBe('0M');
        expect(formatStrategicValueK(758_400)).toBe('758K');
        expect(formatStrategicValueK(10)).toBe('1K');
        expect(formatGrowthPercent(0.015)).toBe('+1.5%');
        expect(formatGrowthPercent(-0.02)).toBe('-2.0%');
        expect(formatGrowthPercent(0)).toBe('0.0%');
        expect(formatSigned0(9.4)).toBe('+9');
        expect(formatSigned0(-10.2)).toBe('-10');
        expect(formatSigned0(0.2)).toBe('0');
    });

    it('shows the angry mood while rebelling and REBELLING in the tooltip', () => {
        expect(colonyApprovalMood(20, false)).toBe('happy');
        expect(colonyApprovalMood(20, true)).toBe('angry');
        expect(colonyApprovalTooltip(12.7, false)).toBe('12');
        expect(colonyApprovalTooltip(-3.2, true)).toBe('-3 (REBELLING)');
    });

    it('counts colonies and distinct systems', () => {
        const cols = [{ systemIndex: 1 }, { systemIndex: 1 }, { systemIndex: 4 }];
        expect(countColonySystems(cols)).toBe(2);
        expect(colonyCountText(3, 2)).toBe('Your empire has 3 colonies in 2 systems');
    });
});

describe('Colonies screen details', () => {
    it('adds the counts to non-empty tab captions', () => {
        const l = colonyTabLabels({ cargo: 2, resources: 0, population: 1, troopsAndCharacters: 8, underConstruction: 0, docked: 0, facilities: 3 });
        expect(COLONY_TABS.map((t) => l[t])).toEqual(['Population (1)', 'Cargo (2)', 'Resources', 'Troops & Characters (8)', 'Construction Yard', 'Docking Bay', 'Facilities (3)']);
        expect(colonyTabLabels(null).cargo).toBe('Cargo');
    });

    it('lists populations largest first with the weighted TOTAL row', () => {
        const a = { name: 'A' } as Race;
        const b = { name: 'B' } as Race;
        const rows = populationRows([
            { race: a, amount: 100, growthRate: 1.1 },
            { race: b, amount: 300, growthRate: 1.0 },
        ]);
        expect(rows.map((r) => r.name)).toEqual(['B', 'A', 'TOTAL']);
        expect(rows[2].amount).toBe(400);
        expect(rows[2].growth).toBeCloseTo(0.025);
        expect(populationRows([])).toEqual([]);
    });

    it('describes feelings and development like HabitatAttitudeSummary', () => {
        expect(feelingDescription(16)).toBe('happy');
        expect(feelingDescription(9)).toBe('satisfied');
        expect(feelingDescription(-1)).toBe('unhappy');
        expect(feelingDescription(-15)).toBe('angry');
        expect(developmentDescription(10)).toBe('Our colony has a reasonable level of development');
        expect(developmentDescription(2)).toBe('Our colony has begun to develop');
        expect(sortAttitudeFactors([{ value: -10, description: 'x' }, { value: 5, description: 'y' }]).map((f) => f.value)).toEqual([5, -10]);
    });

    it('turns a tax change into ColonyTax steps (fives first, clamped to 50%)', () => {
        expect(taxSteps(0.23, 30)).toEqual([ShipActionType.ColonyTaxUp5, ShipActionType.ColonyTaxUp1, ShipActionType.ColonyTaxUp1]);
        expect(taxSteps(0.2, 13)).toEqual([ShipActionType.ColonyTaxDown5, ShipActionType.ColonyTaxDown1, ShipActionType.ColonyTaxDown1]);
        expect(taxSteps(0.45, 80)).toEqual([ShipActionType.ColonyTaxUp5]);
        expect(taxSteps(0.2, 20)).toEqual([]);
    });
});
