// loadGameData requests only files the C# would open: the C# File.Exists checks (DesignSpecification.LoadFromFile's
// pirate / race template, Galaxy.4.cs LoadCharacters, LoadEmpirePolicy) are answered from the asset manifest, so a
// missing file (designTemplates/<race>/[pirate/]planetdestroyer.txt, characters/Mechanoid.txt, characters/Shakturi.txt)
// is never requested, and no file is requested twice.

import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadGameData, manifestFileLookup, type FetchText } from '../src/sim/data/gameData';

const gameRoot = resolve(__dirname, '..');
const dwuRoot = resolve(gameRoot, 'public', 'assets', 'dwu');
const installLinked = existsSync(dwuRoot);

/** A browser-like fetch over the install that records every URL it is asked for, and which of them do not exist. */
function recordingFetch(manifestText: string | null) {
    const requested: string[] = [];
    const missing: string[] = [];
    const fetch: FetchText = async (candidates) => {
        for (const c of candidates) {
            requested.push(c);
            if (c === '/asset-manifest.json') {
                if (manifestText !== null) return manifestText;
            } else {
                const p = resolve(dwuRoot, c.replace(/^\/assets\/dwu\//, ''));
                if (existsSync(p)) return readFileSync(p, 'utf-8');
            }
            missing.push(c);
        }
        throw new Error(`404 ${candidates.join(', ')}`);
    };
    return { fetch, requested, missing };
}

describe('manifestFileLookup (File.Exists stand-in)', () => {
    const manifest = { 'designTemplates/human': ['capitalship.txt'], 'designTemplates/human/pirate': [], characters: ['human.txt'] };
    it('finds a listed file case-insensitively and returns its on-disk path', () => {
        expect(manifestFileLookup(manifest, 'characters/Human.txt')).toBe('characters/human.txt');
        expect(manifestFileLookup(manifest, 'designTemplates/Human/CapitalShip.txt')).toBe('designTemplates/human/capitalship.txt');
    });
    it('null for a file missing from a listed folder (do not request it)', () => {
        expect(manifestFileLookup(manifest, 'characters/Mechanoid.txt')).toBeNull();
        expect(manifestFileLookup(manifest, 'designTemplates/human/pirate/planetdestroyer.txt')).toBeNull();
    });
    it('undefined (unknown: request it) without a manifest, for an unlisted folder, or with a customization set', () => {
        expect(manifestFileLookup(null, 'characters/Human.txt')).toBeUndefined();
        expect(manifestFileLookup(manifest, 'designTemplates/zenox/frigate.txt')).toBeUndefined();
        expect(manifestFileLookup(manifest, 'characters/Human.txt', 'SomeSet')).toBeUndefined();
        expect(manifestFileLookup(manifest, 'characters/Human.txt', 'default')).toBe('characters/human.txt');
    });
});

describe('loadGameData request list', () => {
    let manifestText = '';
    beforeAll(() => {
        // A private manifest (the other manifest tests regenerate public/asset-manifest.json concurrently).
        const out = join(mkdtempSync(join(tmpdir(), 'dwu-manifest-')), 'asset-manifest.json');
        execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: gameRoot, env: { ...process.env, ASSET_MANIFEST_OUT: out } });
        manifestText = readFileSync(out, 'utf-8');
    });

    (installLinked ? it : it.skip)('requests no missing file and no file twice', async () => {
        const { fetch, requested, missing } = recordingFetch(manifestText);
        const data = await loadGameData(fetch);
        expect(missing).toEqual([]);
        expect(new Set(requested).size).toBe(requested.length);
        expect(requested.some((r) => /planetdestroyer\.txt$/i.test(r))).toBe(false);
        expect(requested.some((r) => /characters\/(mechanoid|shakturi)\.txt$/i.test(r))).toBe(false);
        // The C# results are unchanged: races without a characters file have none; planet destroyers fall back.
        expect(data.characterFiles?.has('Mechanoid')).toBe(false);
        expect(data.characterFiles?.has('Human')).toBe(true);
        expect(data.characterFiles!.size).toBe(data.races.length - 2);
        expect(data.policies?.size).toBe(data.races.length);
        expect(data.piratePolicies?.size).toBe(data.races.length);
        expect(data.designNames?.length).toBeGreaterThan(0);
        expect(data.characterNames).toBeDefined();
    });

    (installLinked ? it : it.skip)('the manifest-driven load gives the same data as requesting every candidate', async () => {
        const withManifest = await loadGameData(recordingFetch(manifestText).fetch);
        const races = withManifest.races.map((r) => `${r.name.toLowerCase()}.txt`);
        const policyFiles = [...withManifest.policiesByFile.keys()];
        const templateFiles = [...withManifest.designTemplates.keys()];
        // Explicit lists → no manifest → every candidate is requested (and the missing ones fail).
        const probe = recordingFetch(null);
        const without = await loadGameData(probe.fetch, undefined, races, templateFiles, policyFiles);
        expect(probe.missing.length).toBeGreaterThan(0);
        expect([...without.designSpecificationTexts!.entries()].sort()).toEqual([...withManifest.designSpecificationTexts!.entries()].sort());
        expect([...without.characterFiles!.keys()].sort()).toEqual([...withManifest.characterFiles!.keys()].sort());
        expect([...without.characterFiles!.entries()].sort()).toEqual([...withManifest.characterFiles!.entries()].sort());
        expect([...without.policies!.entries()].sort()).toEqual([...withManifest.policies!.entries()].sort());
        expect([...without.piratePolicies!.entries()].sort()).toEqual([...withManifest.piratePolicies!.entries()].sort());
    });
});
