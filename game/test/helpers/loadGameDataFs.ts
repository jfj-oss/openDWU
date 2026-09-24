// Node.js filesystem version of loadGameData for tests.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { GameData, FetchText } from '../../src/sim/data/gameData';
import { loadGameData } from '../../src/sim/data/gameData';

const dwuRoot = resolve(__dirname, '../../public/assets/dwu');

function readDwu(relPath: string): string {
    return readFileSync(resolve(dwuRoot, relPath), 'utf-8');
}

// Create a FetchText mock that reads from filesystem instead of fetching
const fetchTextFs: FetchText = async (candidates: string[]): Promise<string> => {
    for (const candidate of candidates) {
        try {
            // Convert /assets/dwu/... to file path
            let relPath = candidate.replace(/^\/assets\/dwu\/?/, '');
            // Handle special case: resolve 'races' directory path
            // (resolveDataUrl might return multiple candidates for customization fallback)
            const filePath = resolve(dwuRoot, relPath);
            if (!existsSync(filePath)) {
                continue;
            }
            return readDwu(relPath);
        } catch (err) {
            // Try next candidate
            continue;
        }
    }
    throw new Error(`Could not load any of: ${candidates.join(', ')}`);
};

/**
 * Load all game data from filesystem for testing.
 */
export async function loadGameDataFs(customizationSet?: string): Promise<GameData> {
    // Discover race file names from the races directory
    const racesDir = resolve(dwuRoot, 'races');
    const raceFileNames = readdirSync(racesDir)
        .filter((f) => f.endsWith('.txt'))
        .sort();

    return loadGameData(fetchTextFs, customizationSet, raceFileNames);
}
