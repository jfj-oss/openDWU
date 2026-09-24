import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRace } from '../src/sim/data/races';
import { parseRaceFamilies } from '../src/sim/data/raceFamilies';
import { parseRaceBiases, parseRaceFamilyBiases } from '../src/sim/data/biases';
import { parseGovernments, parseGovernmentBiases } from '../src/sim/data/governments';
import { HabitatType, resolveColonyHabitatTypeByIndexDesertBeforeOcean, resolveColonyIndexByHabitatTypeDesertBeforeOcean } from '../src/sim/types';

const dwuRoot = resolve(__dirname, '../public/assets/dwu');

function readDwu(relPath: string): string {
    return readFileSync(resolve(dwuRoot, relPath), 'utf-8');
}

describe('races.ts parseRace', () => {
    const racesDir = resolve(dwuRoot, 'races');
    const raceFiles = readdirSync(racesDir).filter((f) => f.endsWith('.txt'));

    it('finds all 22 race files', () => {
        expect(raceFiles.length).toBe(22);
    });

    const raceFamilies = parseRaceFamilies(readDwu('raceFamilies.txt'));
    const familyIds = new Set(raceFamilies.map((f) => f.raceFamilyId));

    for (const file of raceFiles) {
        it(`parses ${file}`, () => {
            const text = readFileSync(resolve(racesDir, file), 'utf-8');
            const race = parseRace(text);
            expect(race.name).not.toBe('');
            expect(familyIds.has(race.raceFamily)).toBe(true);
        });
    }

    it('every parsed race nativeHabitatType is one of the six colony types', () => {
        const colonyTypes = [
            HabitatType.Continental,
            HabitatType.MarshySwamp,
            HabitatType.Desert,
            HabitatType.Ocean,
            HabitatType.Ice,
            HabitatType.Volcanic,
        ];
        for (const file of raceFiles) {
            const race = parseRace(readFileSync(resolve(racesDir, file), 'utf-8'));
            expect(colonyTypes).toContain(race.nativeHabitatType);
            // The resolved type must round-trip to the raw file index.
            expect(resolveColonyIndexByHabitatTypeDesertBeforeOcean(race.nativeHabitatType)).toBe(race.nativePlanetType);
        }
    });

    // Task 06d: Race.cs LoadFromFile `case "PictureIndex": race.PictureRef = ...`
    // — every race's portrait index must be a plausible image index so that
    // /assets/dwu/images/units/races/race_<pictureRef>.png can exist.
    it('parses pictureRef (PictureIndex) in range for all races', () => {
        for (const file of raceFiles) {
            const race = parseRace(readFileSync(resolve(racesDir, file), 'utf-8'));
            expect(Number.isInteger(race.pictureIndex)).toBe(true);
            expect(race.pictureIndex).toBeGreaterThanOrEqual(0);
            expect(race.pictureIndex).toBeLessThan(1000);
        }
    });
});

describe('resolveColonyHabitatTypeByIndexDesertBeforeOcean / inverse (task 08b)', () => {
    it('maps indices 0..5 to the six colony habitat types', () => {
        expect(resolveColonyHabitatTypeByIndexDesertBeforeOcean(0)).toBe(HabitatType.Continental);
        expect(resolveColonyHabitatTypeByIndexDesertBeforeOcean(1)).toBe(HabitatType.MarshySwamp);
        expect(resolveColonyHabitatTypeByIndexDesertBeforeOcean(2)).toBe(HabitatType.Desert);
        expect(resolveColonyHabitatTypeByIndexDesertBeforeOcean(3)).toBe(HabitatType.Ocean);
        expect(resolveColonyHabitatTypeByIndexDesertBeforeOcean(4)).toBe(HabitatType.Ice);
        expect(resolveColonyHabitatTypeByIndexDesertBeforeOcean(5)).toBe(HabitatType.Volcanic);
    });

    it('out-of-range indices fall back to Continental', () => {
        for (const index of [-3, -1, 6, 7, 100]) {
            expect(resolveColonyHabitatTypeByIndexDesertBeforeOcean(index)).toBe(HabitatType.Continental);
        }
    });

    it('inverse maps the six colony types to 0..5 and non-colony types to -1', () => {
        expect(resolveColonyIndexByHabitatTypeDesertBeforeOcean(HabitatType.Continental)).toBe(0);
        expect(resolveColonyIndexByHabitatTypeDesertBeforeOcean(HabitatType.MarshySwamp)).toBe(1);
        expect(resolveColonyIndexByHabitatTypeDesertBeforeOcean(HabitatType.Desert)).toBe(2);
        expect(resolveColonyIndexByHabitatTypeDesertBeforeOcean(HabitatType.Ocean)).toBe(3);
        expect(resolveColonyIndexByHabitatTypeDesertBeforeOcean(HabitatType.Ice)).toBe(4);
        expect(resolveColonyIndexByHabitatTypeDesertBeforeOcean(HabitatType.Volcanic)).toBe(5);
        for (const type of [
            HabitatType.Undefined,
            HabitatType.MainSequence,
            HabitatType.BarrenRock,
            HabitatType.GasGiant,
            HabitatType.FrozenGasGiant,
            HabitatType.Hydrogen,
            HabitatType.Metal,
        ]) {
            expect(resolveColonyIndexByHabitatTypeDesertBeforeOcean(type)).toBe(-1);
        }
    });
});

describe('raceFamilies.ts parseRaceFamilies', () => {
    it('parses raceFamilies.txt', () => {
        const families = parseRaceFamilies(readDwu('raceFamilies.txt'));
        expect(families.length).toBeGreaterThan(0);
        for (const f of families) {
            expect(f.name).not.toBe('');
        }
    });
});

describe('biases.ts', () => {
    it('raceBiases.txt is a square matrix sized to the race count', () => {
        const racesDir = resolve(dwuRoot, 'races');
        const raceCount = readdirSync(racesDir).filter((f) => f.endsWith('.txt')).length;
        const { matrix } = parseRaceBiases(readDwu('raceBiases.txt'));
        expect(matrix.length).toBe(raceCount);
        for (const row of matrix) {
            expect(row.length).toBe(raceCount);
        }
    });

    it('raceFamilyBiases.txt is a square matrix sized to the family count', () => {
        const raceFamilies = parseRaceFamilies(readDwu('raceFamilies.txt'));
        const { matrix } = parseRaceFamilyBiases(readDwu('raceFamilyBiases.txt'));
        expect(matrix.length).toBe(raceFamilies.length);
        for (const row of matrix) {
            expect(row.length).toBe(raceFamilies.length);
        }
    });
});

describe('governments.ts', () => {
    it('parses governments.txt with more than 10 governments', () => {
        const governments = parseGovernments(readDwu('governments.txt'));
        expect(governments.length).toBeGreaterThan(10);
        for (const g of governments) {
            expect(g.name).not.toBe('');
        }
    });

    it('every governmentBiases row matches the government count', () => {
        const governments = parseGovernments(readDwu('governments.txt'));
        const biasRows = parseGovernmentBiases(readDwu('governmentBiases.txt'));
        expect(biasRows.length).toBeGreaterThan(0);
        for (const row of biasRows) {
            expect(row.biases.length).toBe(governments.length);
        }
    });
});

import { DEFAULT_RACE_FILES } from '../src/sim/data/gameData';
import { existsSync } from 'node:fs';
describe('DEFAULT_RACE_FILES', () => {
    it('lists exactly the 22 race files that exist in the install', () => {
        expect(DEFAULT_RACE_FILES.length).toBe(22);
        for (const f of DEFAULT_RACE_FILES) expect(existsSync(`public/assets/dwu/races/${f}`)).toBe(true);
    });
});

import {
    CharacterTraitType,
    ComponentCategoryType as RaceComponentCategoryType,
    RaceVictoryConditionType,
} from '../src/sim/data/races';
describe('races.ts parseRace — GenerateRaceSummary fields (Race.cs LoadFromFile)', () => {
    const race = (file: string) => parseRace(readDwu(`races/${file}`));

    it('builds victory conditions in file order, sorted by proportion then reversed', () => {
        // human.txt: 35 (15), 34 (15), 42 (25), 2 (25, Continental), 14 (20, amount 1).
        // .NET insertion sort (stable) ascending -> 35,34,14,42,2; Reverse -> 2,42,14,34,35.
        const h = race('human.txt');
        expect(h.victoryConditions.map((c) => [c.type, c.proportion])).toEqual([
            [RaceVictoryConditionType.ControlPlanetTypePercentage, 25],
            [RaceVictoryConditionType.MutualDefensePactsFormedProportionAllEmpires, 25],
            [RaceVictoryConditionType.DestroyMoreShipsThanLoseTimesFactor, 20],
            [RaceVictoryConditionType.MostTourismIncome, 15],
            [RaceVictoryConditionType.MostTradeIncome, 15],
        ]);
        expect(h.victoryConditions[0].additionalData).toBe(HabitatType.Continental); // index 1 (IncludingUndefined)
        expect(h.victoryConditions[0].amount).toBe(33);
        expect(h.victoryConditions[1].additionalData).toBeNull();
    });
    it('drops Undefined condition types (mechanoid has proportions only)', () => {
        expect(race('mechanoid.txt').victoryConditions).toEqual([]);
    });
    it('resolves condition additional data by type', () => {
        const g = race('gizurean.txt');
        const wonder = g.victoryConditions.find((c) => c.type === RaceVictoryConditionType.BuildWonder)!;
        expect(wonder.additionalData).toBe(21); // facilities.txt index
        const teekan = race('teekan.txt');
        const slug = teekan.victoryConditions.find((c) => c.type === RaceVictoryConditionType.DestroyMostCreaturesByType)!;
        expect(slug.additionalData).toBe(3); // CreatureType.DesertSpaceSlug
    });
    it('parses character, colony and other modifiers with Race defaults and clamps', () => {
        const q = race('quameno.txt');
        expect(q.characterStartingTraitAmbassador).toBe(CharacterTraitType.Linguist);
        expect(q.characterStartingTraitLeader).toBe(CharacterTraitType.Undefined);
        const h = race('human.txt');
        expect(h.intelligenceAgentAdditional).toBe(1);
        expect(h.disallowedResearchAreas).toEqual([
            RaceComponentCategoryType.Undefined, RaceComponentCategoryType.Undefined, RaceComponentCategoryType.Undefined,
        ]);
        expect(h.disallowedComponentIds).toEqual([]);
        expect(race('dhayut.txt').changePeriodYearsInterval).toBe(5);
        expect(race('dhayut.txt').changePeriodYearsLength).toBe(2);
        expect(race('shandar.txt').immuneNaturalDisastersAtColonyType).toBe(HabitatType.Volcanic);
        expect(race('zenox.txt').knownStartingGalacticHistoryLocations).toBe(2);
        const t = race('teekan.txt');
        expect(t.militaryShipSizeFactor).toBeCloseTo(0.8);
        expect(t.civilianShipSizeFactor).toBeCloseTo(1.2);
        // Race defaults when a line is absent.
        const bare = parseRace('Name ;X\n');
        expect(bare.victoryConditions).toEqual([]);
        expect(bare.characterRandomAppearanceChanceLeader).toBe(1.0);
        expect(bare.constructionSpeedModifier).toBe(1.0);
        expect(bare.disallowedResearchAreas).toEqual([]);
        // SetNameValuePair clamps / Enum.IsDefined checks.
        const clamped = parseRace('ShipSizeFactorMilitary ;9\nAdditionalIntelligenceAgents ;12\nCondition1Type ;200\nCharacterStartingTraitLeader ;250\n');
        expect(clamped.militaryShipSizeFactor).toBe(5.1);
        expect(clamped.intelligenceAgentAdditional).toBe(5);
        expect(clamped.victoryConditions).toEqual([]);
        expect(clamped.characterStartingTraitLeader).toBe(CharacterTraitType.Undefined);
    });
    it('clamps the older attribute/bonus fields like SetNameValuePair does', () => {
        // Race.cs LoadFromFile: ReproductiveRate [1.0, 1.5]; Intelligence/
        // Aggression/Caution/Friendliness/Loyalty [50, 150]; the maintenance/
        // bonus fields [0, N]; TroopStrength [50, 400].
        const tooLow = parseRace([
            'ReproductionRate ;0.1',
            'Intelligence ;1',
            'Aggression ;1',
            'Caution ;1',
            'Friendliness ;1',
            'Loyalty ;1',
            'ShipMaintenanceSavings ;-5',
            'TroopMaintenanceSavings ;-5',
            'ResourceExtractionBonus ;-5',
            'WarWearinessAttenuation ;-5',
            'SatisfactionModifier ;-5',
            'ResearchBonus ;-5',
            'EspionageBonus ;-5',
            'TradeBonus ;-5',
            'TroopStrength ;1',
        ].join('\n'));
        expect(tooLow.reproductionRate).toBe(1.0);
        expect(tooLow.intelligence).toBe(50);
        expect(tooLow.aggression).toBe(50);
        expect(tooLow.caution).toBe(50);
        expect(tooLow.friendliness).toBe(50);
        expect(tooLow.loyalty).toBe(50);
        expect(tooLow.shipMaintenanceSavings).toBe(0);
        expect(tooLow.troopMaintenanceSavings).toBe(0);
        expect(tooLow.resourceExtractionBonus).toBe(0);
        expect(tooLow.warWearinessAttenuation).toBe(0);
        expect(tooLow.satisfactionModifier).toBe(0);
        expect(tooLow.researchBonus).toBe(0);
        expect(tooLow.espionageBonus).toBe(0);
        expect(tooLow.tradeBonus).toBe(0);
        expect(tooLow.troopStrength).toBe(50);

        const tooHigh = parseRace([
            'ReproductionRate ;9',
            'Intelligence ;9999',
            'Aggression ;9999',
            'Caution ;9999',
            'Friendliness ;9999',
            'Loyalty ;9999',
            'ShipMaintenanceSavings ;9999',
            'TroopMaintenanceSavings ;9999',
            'ResourceExtractionBonus ;9999',
            'WarWearinessAttenuation ;9999',
            'SatisfactionModifier ;9999',
            'ResearchBonus ;9999',
            'EspionageBonus ;9999',
            'TradeBonus ;9999',
            'TroopStrength ;9999',
        ].join('\n'));
        expect(tooHigh.reproductionRate).toBe(1.5);
        expect(tooHigh.intelligence).toBe(150);
        expect(tooHigh.aggression).toBe(150);
        expect(tooHigh.caution).toBe(150);
        expect(tooHigh.friendliness).toBe(150);
        expect(tooHigh.loyalty).toBe(150);
        expect(tooHigh.shipMaintenanceSavings).toBe(100);
        expect(tooHigh.troopMaintenanceSavings).toBe(100);
        expect(tooHigh.resourceExtractionBonus).toBe(500);
        expect(tooHigh.warWearinessAttenuation).toBe(100);
        expect(tooHigh.satisfactionModifier).toBe(505);
        expect(tooHigh.researchBonus).toBe(510);
        expect(tooHigh.espionageBonus).toBe(515);
        expect(tooHigh.tradeBonus).toBe(520);
        expect(tooHigh.troopStrength).toBe(400);

        // Absent lines keep the Race field defaults.
        const bare = parseRace('Name ;X\n');
        expect(bare.reproductionRate).toBe(1.0);
        expect(bare.intelligence).toBe(100);
        expect(bare.shipMaintenanceSavings).toBe(0);
        expect(bare.troopStrength).toBe(100);
    });
    it('no longer leaves the summary fields in extra', () => {
        const extraKeys = Object.keys(race('human.txt').extra);
        for (const k of ['Condition1Type', 'ShipSizeFactorMilitary', 'CharacterStartingTraitLeader', 'MigrationFactor']) {
            expect(extraKeys).not.toContain(k);
        }
    });
});
