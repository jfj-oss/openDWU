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
