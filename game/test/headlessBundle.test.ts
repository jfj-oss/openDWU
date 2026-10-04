// The headless scripts (scripts/sim-run.mjs, soak.mjs, lategame-start.mjs, ai-parity.mjs, profile-sim.mjs) bundle
// test/helpers/loadGameDataFs.ts with rolldown into a temp dir, defining __dirname as test/helpers. Every path the loader
// resolves must come from __dirname: a require relative to import.meta.url (the bundle's own temp location) made every
// script die at import with "Cannot find module '../../desktop/themeIndex.cjs'" (found by the 2026-10-04 soak).
import { describe, expect, it } from 'vitest';
import { build } from 'rolldown';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

describe('headless script bundle of loadGameDataFs', () => {
    it('imports from a temp dir and finds desktop/themeIndex.cjs', async () => {
        const dir = mkdtempSync(resolve(tmpdir(), 'dwu-bundle-test-'));
        try {
            await build({
                cwd: root,
                input: { load: './test/helpers/loadGameDataFs.ts' },
                platform: 'node',
                transform: { define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) } },
                output: { dir, format: 'esm', preserveModules: true, preserveModulesRoot: root },
                write: true,
                logLevel: 'silent',
            });
            const mod = (await import(resolve(dir, 'load.js'))) as { installedThemes(): string[] };
            expect(Array.isArray(mod.installedThemes())).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 120000);
});
