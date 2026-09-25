// Tests for scripts/gen-asset-manifest.mjs (data-loader TODOs task): the
// manifest must enumerate races/, Policy/, Policy/pirate/, and every
// designTemplates/<race>/ folder, in addition to the pre-existing
// images/environment/ folders.

import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const gameRoot = resolve(__dirname, '..');
const manifestPath = resolve(gameRoot, 'public', 'asset-manifest.json');
const dwuRoot = resolve(gameRoot, 'public', 'assets', 'dwu');

type Manifest = Record<string, string[]>;

describe('gen-asset-manifest.mjs', () => {
    let manifest: Manifest;
    const installLinked = existsSync(dwuRoot);

    beforeAll(() => {
        // Regenerate the manifest fresh so this test doesn't depend on
        // whatever ran last (predev/prebuild) before the suite started.
        execFileSync('node', ['scripts/gen-asset-manifest.mjs'], { cwd: gameRoot });
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest;
    });

    it('is valid JSON with folder -> file-name-list entries', () => {
        expect(typeof manifest).toBe('object');
        for (const [key, value] of Object.entries(manifest)) {
            expect(typeof key).toBe('string');
            expect(Array.isArray(value)).toBe(true);
            for (const name of value) {
                expect(typeof name).toBe('string');
            }
        }
    });

    (installLinked ? it : it.skip)('lists races/*.txt sorted case-insensitively', () => {
        const expected = readdirSync(resolve(dwuRoot, 'races'))
            .filter((f) => f.toLowerCase().endsWith('.txt'))
            .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        expect(manifest.races).toBeDefined();
        expect(manifest.races.length).toBe(expected.length);
        expect(manifest.races.map((f) => f.toLowerCase())).toEqual(expected.map((f) => f.toLowerCase()));
        // Verify case-insensitive ordinal sort order is respected.
        const lower = manifest.races.map((f) => f.toLowerCase());
        expect(lower).toEqual([...lower].sort());
    });

    (installLinked ? it : it.skip)('lists Policy/*.txt (top-level only, no pirate/ entries)', () => {
        const expected = readdirSync(resolve(dwuRoot, 'Policy'), { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
            .map((e) => e.name);
        expect(manifest['Policy']).toBeDefined();
        expect(manifest['Policy'].length).toBe(expected.length);
        expect(new Set(manifest['Policy'])).toEqual(new Set(expected));
    });

    (installLinked && existsSync(resolve(dwuRoot, 'Policy', 'pirate')) ? it : it.skip)(
        'lists Policy/pirate/*.txt',
        () => {
            const expected = readdirSync(resolve(dwuRoot, 'Policy', 'pirate')).filter((f) =>
                f.toLowerCase().endsWith('.txt')
            );
            expect(manifest['Policy/pirate']).toBeDefined();
            expect(manifest['Policy/pirate'].length).toBe(expected.length);
            expect(new Set(manifest['Policy/pirate'])).toEqual(new Set(expected));
        }
    );

    (installLinked ? it : it.skip)('lists every designTemplates/<race>/ folder', () => {
        const designTemplatesDir = resolve(dwuRoot, 'designTemplates');
        const races = readdirSync(designTemplatesDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        expect(races.length).toBeGreaterThan(0);
        for (const race of races) {
            const files = readdirSync(resolve(designTemplatesDir, race), { withFileTypes: true }).filter(
                (e) => e.isFile() && e.name.toLowerCase().endsWith('.txt')
            );
            const key = `designTemplates/${race}`;
            if (files.length === 0) {
                continue;
            }
            expect(manifest[key], `manifest missing key ${key}`).toBeDefined();
            expect(manifest[key].length).toBe(files.length);
        }
        // DEFAULT (used by loadGameData for design template discovery) must
        // be among the listed race folders when it has any .txt files.
        expect(races).toContain('DEFAULT');
    });

    it('still lists images/environment/ folders (backward compatible)', () => {
        if (!existsSync(resolve(dwuRoot, 'images', 'environment'))) {
            return;
        }
        const imageKeys = Object.keys(manifest).filter(
            (k) => !k.startsWith('designTemplates/') && k !== 'races' && k !== 'Policy' && k !== 'Policy/pirate'
                && k !== 'Help' && !k.startsWith('Customization/')
        );
        expect(imageKeys.length).toBeGreaterThan(0);
    });

    // Case-insensitive folder lookup helper mirroring the generator's.
    const findEntry = (dir: string, name: string): string | null => {
        const target = name.toLowerCase();
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name.toLowerCase() === target) return e.name;
        }
        return null;
    };

    (installLinked ? it : it.skip)('lists Help/*.mht (top level only, folder matched case-insensitively)', () => {
        const helpName = findEntry(dwuRoot, 'help');
        expect(helpName).not.toBeNull();
        const expected = readdirSync(resolve(dwuRoot, helpName!), { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mht'))
            .map((e) => e.name);
        if (expected.length === 0) {
            expect(manifest['Help']).toBeUndefined();
            return;
        }
        expect(manifest['Help']).toBeDefined();
        expect(new Set(manifest['Help'])).toEqual(new Set(expected));
        // Sorted case-insensitively (windowsOrdinal order).
        const lower = manifest['Help'].map((f) => f.toLowerCase());
        expect(lower).toEqual([...lower].sort());
    });

    (installLinked ? it : it.skip)('lists Customization/<set>/help/*.mht for every set with a help folder', () => {
        const customizationDir = resolve(dwuRoot, 'Customization');
        if (!existsSync(customizationDir)) return;
        const sets = readdirSync(customizationDir, { withFileTypes: true }).filter((e) => e.isDirectory());
        for (const set of sets) {
            const helpName = findEntry(resolve(dwuRoot, 'Customization', set.name), 'help');
            const key = `Customization/${set.name}/help`;
            if (!helpName) {
                expect(manifest[key]).toBeUndefined();
                continue;
            }
            const expected = readdirSync(resolve(dwuRoot, 'Customization', set.name, helpName), { withFileTypes: true })
                .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mht'))
                .map((e) => e.name);
            if (expected.length === 0) {
                expect(manifest[key]).toBeUndefined();
            } else {
                expect(manifest[key], `manifest missing key ${key}`).toBeDefined();
                expect(new Set(manifest[key])).toEqual(new Set(expected));
            }
        }
    });
    (installLinked ? it : it.skip)('lists designTemplates/<race>/pirate/*.txt and characters/*.txt (always present, [] when absent)', () => {
        const templatesDir = resolve(dwuRoot, 'designTemplates');
        for (const race of readdirSync(templatesDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
            const key = `designTemplates/${race.name}/pirate`;
            expect(manifest[key], `manifest missing key ${key}`).toBeDefined();
            const pirateDir = resolve(templatesDir, race.name, 'pirate');
            const expected = existsSync(pirateDir) ? readdirSync(pirateDir).filter((f) => f.toLowerCase().endsWith('.txt')) : [];
            expect(new Set(manifest[key])).toEqual(new Set(expected));
        }
        const charactersDir = resolve(dwuRoot, 'characters');
        const expected = existsSync(charactersDir) ? readdirSync(charactersDir).filter((f) => f.toLowerCase().endsWith('.txt')) : [];
        expect(new Set(manifest['characters'])).toEqual(new Set(expected));
    });
});
