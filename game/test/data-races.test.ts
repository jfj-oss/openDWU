import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRace } from '../src/sim/data/races';
import { parseRaceFamilies } from '../src/sim/data/raceFamilies';
import { parseRaceBiases, parseRaceFamilyBiases } from '../src/sim/data/biases';
import { parseGovernments, parseGovernmentBiases } from '../src/sim/data/governments';

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
