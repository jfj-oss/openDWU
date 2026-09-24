// Tests for the browser code path of src/sim/data/gameData.ts loadGameData:
// with no explicit race/design-template/policy file lists, it must discover
// them from public/asset-manifest.json (as the real browser build does via
// `fetch('/asset-manifest.json')`), rather than falling back to a single
// hardcoded default.txt policy / zero design templates.

import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FetchText } from '../src/sim/data/gameData';
import { loadGameData } from '../src/sim/data/gameData';

const gameRoot = resolve(__dirname, '..');
const publicDir = resolve(gameRoot, 'public');
const dwuRoot = resolve(publicDir, 'assets', 'dwu');
const installLinked = existsSync(dwuRoot);

/**
 * A FetchText that mimics the real browser fetch: serves /asset-manifest.json
 * and /assets/dwu/... URLs straight from disk, exactly like the dev/prod
 * server does for these static files. Unlike test/helpers/loadGameDataFs.ts
 * (which bypasses the manifest by supplying explicit file lists), this
 * exercises the manifest-driven default path in loadGameData.
 */
const fetchTextBrowserLike: FetchText = async (candidates: string[]): Promise<string> => {
    for (const candidate of candidates) {
        let filePath: string | null = null;
        if (candidate === '/asset-manifest.json') {
            filePath = resolve(publicDir, 'asset-manifest.json');
        } else if (candidate.startsWith('/assets/dwu/')) {
            filePath = resolve(dwuRoot, candidate.replace(/^\/assets\/dwu\//, ''));
        }
        if (filePath && existsSync(filePath)) {
            return readFileSync(filePath, 'utf-8');
        }
    }
    throw new Error(`Could not load any of: ${candidates.join(', ')}`);
};

describe('gameData.ts loadGameData — browser path (manifest-driven defaults)', () => {
    beforeAll(() => {
        // Regenerate the manifest fresh so this test doesn't depend on
        // whatever ran last (predev/prebuild) before the suite started.
        execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: gameRoot });
    });

    (installLinked ? it : it.skip)('loads every manifest-listed policy file into GameData.policies', async () => {
        const manifest = JSON.parse(readFileSync(resolve(publicDir, 'asset-manifest.json'), 'utf-8')) as Record<
            string,
            string[]
        >;
        const expectedCount = (manifest['Policy'] ?? []).length + (manifest['Policy/pirate'] ?? []).length;
        expect(expectedCount).toBeGreaterThan(0);

        const data = await loadGameData(fetchTextBrowserLike);
        expect(data.policiesByFile).toBeInstanceOf(Map);
        expect(data.policiesByFile.size).toBe(expectedCount);

        // Every value must be a fully-formed EmpirePolicy (spot-check a
        // couple of representative fields have sane defaults/parsed values).
        for (const policy of data.policiesByFile.values()) {
            expect(Number.isNaN(policy.fleetTypicalSize)).toBe(false);
        }

        // Pirate entries are keyed with a "pirate/" prefix.
        const pirateKeys = [...data.policiesByFile.keys()].filter((k) => k.startsWith('pirate/'));
        expect(pirateKeys.length).toBe((manifest['Policy/pirate'] ?? []).length);
    });

    (installLinked ? it : it.skip)('loads every manifest-listed DEFAULT design template into GameData.designTemplates', async () => {
        const manifest = JSON.parse(readFileSync(resolve(publicDir, 'asset-manifest.json'), 'utf-8')) as Record<
            string,
            string[]
        >;
        const templateFiles = manifest['designTemplates/DEFAULT'] ?? [];

        const data = await loadGameData(fetchTextBrowserLike);
        expect(data.designTemplates).toBeInstanceOf(Map);

        // Every listed file whose name resolves to a BuiltObjectSubRole
        // member should have produced an entry; count how many do.
        const { BuiltObjectSubRole } = await import('../src/sim/data/names');
        const memberNames = Object.keys(BuiltObjectSubRole).filter((k) => Number.isNaN(parseInt(k, 10)));
        const resolvable = templateFiles.filter((f) => {
            const name = f.replace(/\.txt$/i, '').toLowerCase();
            return memberNames.some((m) => m.toLowerCase() === name);
        });
        expect(data.designTemplates.size).toBe(resolvable.length);
        expect(data.designTemplates.size).toBeGreaterThan(0);
    });

    (installLinked ? it : it.skip)('discovers race files from the manifest when raceFileNames is not passed', async () => {
        const manifest = JSON.parse(readFileSync(resolve(publicDir, 'asset-manifest.json'), 'utf-8')) as Record<
            string,
            string[]
        >;
        const expectedRaceCount = (manifest['races'] ?? []).length;
        expect(expectedRaceCount).toBeGreaterThan(0);

        const data = await loadGameData(fetchTextBrowserLike);
        expect(data.races.length).toBe(expectedRaceCount);
    });

    it('falls back gracefully when the manifest is unavailable', async () => {
        // A FetchText that always fails to serve /asset-manifest.json (but
        // still serves races/*.txt via the DEFAULT_RACE_FILES fallback list,
        // when the install is linked) must not throw.
        const noManifestFetch: FetchText = async (candidates: string[]): Promise<string> => {
            for (const candidate of candidates) {
                if (candidate === '/asset-manifest.json') {
                    continue;
                }
                if (candidate.startsWith('/assets/dwu/') && installLinked) {
                    const filePath = resolve(dwuRoot, candidate.replace(/^\/assets\/dwu\//, ''));
                    if (existsSync(filePath)) {
                        return readFileSync(filePath, 'utf-8');
                    }
                }
            }
            throw new Error(`Could not load any of: ${candidates.join(', ')}`);
        };

        const data = await loadGameData(noManifestFetch);
        // No policy files could be discovered without the manifest (only the
        // "default.txt" fallback is tried, and this install has none), and no
        // design templates either — but the call must resolve, not throw.
        expect(data.policiesByFile).toBeInstanceOf(Map);
        expect(data.designTemplates).toBeInstanceOf(Map);
        if (installLinked) {
            expect(data.races.length).toBeGreaterThan(0);
        }
    });
});
