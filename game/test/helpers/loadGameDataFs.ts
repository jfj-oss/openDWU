// Node.js filesystem version of loadGameData for tests.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { GameData, FetchText } from '../../src/sim/data/gameData';
import { loadGameData } from '../../src/sim/data/gameData';
import { CustomizationSet } from '../../src/sim/data/customization';
import { createRequire } from 'node:module';

const themeIndexLib = createRequire(import.meta.url)('../../desktop/themeIndex.cjs') as {
    listThemes(root: string): string[];
    buildThemeIndex(root: string, set: string): { set: string; files: string[]; dirs: string[] } | null;
};

const dwuRoot = resolve(__dirname, '../../public/assets/dwu');

function readDwu(relPath: string): string {
    return readFileSync(resolve(dwuRoot, relPath), 'utf-8');
}

/** Content fingerprint of each loaded GameData: a hash of every file its load read (see gameDataFingerprint). */
const fingerprints = new WeakMap<GameData, string>();

/**
 * The content fingerprint of a GameData returned by loadGameDataFs (sha1 over the customization set and every data
 * file read, path + content), or null for GameData built some other way. test/helpers/gameCache.ts keys its on-disk
 * games with it.
 */
export function gameDataFingerprint(gameData: GameData): string | null {
    return fingerprints.get(gameData) ?? null;
}

// Create a FetchText mock that reads from filesystem instead of fetching; every file read is recorded in `reads`.
const fetchTextFs = (reads: Map<string, string>): FetchText => async (candidates: string[]): Promise<string> => {
    for (const candidate of candidates) {
        try {
            // Convert /assets/dwu/... to file path
            let relPath = decodeURIComponent(candidate.replace(/^\/assets\/dwu\/?/, ''));
            // Handle special case: resolve 'races' directory path
            // (resolveDataUrl might return multiple candidates for customization fallback)
            const filePath = resolve(dwuRoot, relPath);
            if (!existsSync(filePath)) {
                continue;
            }
            const content = readDwu(relPath);
            reads.set(relPath, content);
            return content;
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
/** The installed themes (Customization subfolders, Start.cs method_28 order); [] without the install. */
export function installedThemes(): string[] {
    return themeIndexLib.listThemes(dwuRoot);
}

/** The CustomizationSet of an installed theme (desktop/themeIndex.cjs, as served at /theme-manifest/<set>.json). */
export function themeIndexFs(set: string): CustomizationSet | null {
    const index = themeIndexLib.buildThemeIndex(dwuRoot, set);
    return index === null ? null : new CustomizationSet(index);
}

export async function loadGameDataFs(customizationSet?: string | CustomizationSet): Promise<GameData> {
    // Discover race file names from the races directory
    const racesDir = resolve(dwuRoot, 'races');
    const raceFileNames = readdirSync(racesDir)
        .filter((f) => f.endsWith('.txt'))
        .sort();

    // Discover design template file names (without extension) from
    // designTemplates/DEFAULT/. The C# engine loads one file per sub-role;
    // only names matching a BuiltObjectSubRole member are used by loadGameData.
    let designTemplateFiles: string[] = [];
    const templatesDir = resolve(dwuRoot, 'designTemplates', 'DEFAULT');
    if (existsSync(templatesDir)) {
        designTemplateFiles = readdirSync(templatesDir)
            .filter((f) => f.endsWith('.txt'))
            .map((f) => f.replace(/\.txt$/, ''))
            .sort();
    }

    // Discover policy file names from Policy/ (top level) and Policy/pirate/,
    // mirroring public/asset-manifest.json's "Policy" / "Policy/pirate" lists
    // (pirate entries prefixed "pirate/" — see loadGameData's policyFileNames doc).
    let policyFileNames: string[] = [];
    const policyDir = resolve(dwuRoot, 'Policy');
    if (existsSync(policyDir)) {
        policyFileNames = readdirSync(policyDir, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith('.txt'))
            .map((e) => e.name)
            .sort();
        const policyPirateDir = resolve(policyDir, 'pirate');
        if (existsSync(policyPirateDir)) {
            const pirateFiles = readdirSync(policyPirateDir)
                .filter((f) => f.endsWith('.txt'))
                .sort()
                .map((f) => `pirate/${f}`);
            policyFileNames.push(...pirateFiles);
        }
    }

    const reads = new Map<string, string>();
    const gameData = await loadGameData(fetchTextFs(reads), customizationSet, raceFileNames, designTemplateFiles, policyFileNames);
    const setKey = customizationSet instanceof CustomizationSet ? `theme:${customizationSet.name}` : (customizationSet ?? '');
    const hash = createHash('sha1').update(`customization:${setKey}\0`);
    for (const path of [...reads.keys()].sort()) hash.update(`${path}\0${reads.get(path)!}\0`);
    fingerprints.set(gameData, hash.digest('hex'));
    return gameData;
}
