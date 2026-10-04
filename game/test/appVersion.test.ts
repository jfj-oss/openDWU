import { describe, expect, it } from 'vitest';
import { APP_VERSION, checkLatestRelease, compareVersions } from '../src/appVersion';
import { readFileSync } from 'node:fs';

describe('app version and the main menu update check', () => {
    it('APP_VERSION is game/package.json version', () => {
        expect(APP_VERSION).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
    });
    it('compares versions', () => {
        expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
        expect(compareVersions('v0.1.0', '0.1.0')).toBe(0);
        expect(compareVersions('0.1.0', '0.1.10')).toBeLessThan(0);
        expect(compareVersions('junk', '0.1.0')).toBe(0);
    });
    it('reads the latest GitHub release', async () => {
        const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
        expect(await checkLatestRelease(answer(200, { tag_name: 'v99.0.0', html_url: 'https://github.com/jfj-oss/openDWU/releases/tag/v99.0.0' }))).toEqual({ kind: 'newer', latest: '99.0.0', url: 'https://github.com/jfj-oss/openDWU/releases/tag/v99.0.0' });
        expect(await checkLatestRelease(answer(200, { tag_name: `v${APP_VERSION}` }))).toEqual({ kind: 'upToDate', latest: APP_VERSION });
        expect(await checkLatestRelease(answer(404, {}))).toEqual({ kind: 'noRelease' });
        expect((await checkLatestRelease(answer(500, {}))).kind).toBe('error');
    });
});
