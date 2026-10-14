// desktop/selfUpdate.cjs: which installs self-update, the checksum rules, the verified download and the in-place replace.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const su = require('../desktop/selfUpdate.cjs');
const uc = require('../desktop/updateCheck.cjs');

const GH = 'https://github.com/jfj-oss/openDWU/releases/download/v0.3.0';
function release(product = 'openDWU', withSha = true) {
    const names = uc.assetFileNames('0.3.0', product);
    const all = Object.values(names) as string[];
    const files = withSha ? [...all, ...all.map((n) => `${n}.sha256`)] : all;
    return uc.releaseInfo({ tag_name: 'v0.3.0', draft: false, assets: files.map((n) => ({ name: n, browser_download_url: `${GH}/${n}`, size: 5 })) });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dwu-su-'));

describe('self-update selection', () => {
    it('only the AppImage and the NSIS setup self-update', () => {
        expect(su.selfUpdateKind({ platform: 'linux', arch: 'x64', kind: 'appimage' })).toBe('appimage');
        expect(su.selfUpdateKind({ platform: 'win32', arch: 'x64', kind: 'nsis' })).toBe('nsis');
        expect(su.selfUpdateKind({ platform: 'linux', arch: 'x64', kind: 'archive' })).toBeNull();
        expect(su.selfUpdateKind({ platform: 'win32', arch: 'x64', kind: 'archive' })).toBeNull();
        expect(su.selfUpdateKind({ platform: 'darwin', arch: 'arm64', kind: 'archive' })).toBeNull();
        expect(su.selfUpdateKind({ platform: 'linux', arch: 'arm64', kind: 'appimage' })).toBeNull();
    });
    it('each edition updates to its own files', () => {
        const full = su.planSelfUpdate(release('openDWU'), { platform: 'linux', arch: 'x64', kind: 'appimage', product: 'full' });
        expect(full.name).toBe('openDWU-0.3.0-linux-x64.AppImage');
        expect(full.shaUrl).toBe(`${GH}/openDWU-0.3.0-linux-x64.AppImage.sha256`);
        const classic = su.planSelfUpdate(release('openDWU-Classic'), { platform: 'win32', arch: 'x64', kind: 'nsis', product: 'classic' });
        expect(classic.name).toBe('openDWU-Classic-0.3.0-windows-x64-setup.exe');
        // a Classic install never picks the full edition's files
        expect(su.planSelfUpdate(release('openDWU'), { platform: 'win32', arch: 'x64', kind: 'nsis', product: 'classic' })).toBeNull();
    });
    it('needs the .sha256 and a GitHub (or the test origin) URL', () => {
        expect(su.planSelfUpdate(release('openDWU', false), { platform: 'linux', arch: 'x64', kind: 'appimage', product: 'full' })).toBeNull();
        const evil = uc.releaseInfo({ tag_name: 'v0.3.0', assets: ['openDWU-0.3.0-linux-x64.AppImage', 'openDWU-0.3.0-linux-x64.AppImage.sha256'].map((n) => ({ name: n, browser_download_url: `http://127.0.0.1:9/${n}` })) });
        const ctx = { platform: 'linux', arch: 'x64', kind: 'appimage', product: 'full' };
        expect(su.planSelfUpdate(evil, ctx)).toBeNull();
        expect(su.planSelfUpdate(evil, { ...ctx, extraOrigin: 'http://127.0.0.1:9/repos/x' })).not.toBeNull();
    });
    it('parses sha256 listings', () => {
        const h = 'a'.repeat(64);
        expect(su.parseSha256(`${h}  x.AppImage\n`, 'x.AppImage')).toBe(h);
        expect(su.parseSha256(`${h.toUpperCase()} *dir/x.AppImage\r\n`, 'x.AppImage')).toBe(h);
        expect(su.parseSha256(`${h}  other\n`, 'x.AppImage')).toBeNull();
        expect(su.parseSha256('garbage', 'x')).toBeNull();
    });
});

function fakeFetch(files: Record<string, Buffer | string>) {
    return async (url: string) => {
        const body = files[url];
        if (body === undefined) return { ok: false, status: 404 };
        const buf = Buffer.from(body);
        const chunks = [buf.subarray(0, 3), buf.subarray(3)];
        return {
            ok: true,
            status: 200,
            text: async () => buf.toString('utf8'),
            body: { getReader: () => { let i = 0; return { read: async () => (i < chunks.length ? { done: false, value: new Uint8Array(chunks[i++]) } : { done: true, value: undefined }) }; } },
        };
    };
}

describe('verified download', () => {
    const payload = Buffer.from('new appimage bytes');
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    const plan = { name: 'x.AppImage', url: 'u://file', shaUrl: 'u://sha' };
    it('stores a file whose hash matches, reuses it next time, and waits while paused', async () => {
        const dir = tmp();
        let pausedPolls = 0;
        const f = fakeFetch({ 'u://file': payload, 'u://sha': `${hash}  x.AppImage\n` });
        const r = await su.downloadVerified({ fetchFn: f, plan, dir, isPaused: () => pausedPolls++ < 2, sleep: async () => {} });
        expect(r.reused).toBe(false);
        expect(pausedPolls).toBeGreaterThan(2);
        expect(fs.readFileSync(r.file).equals(payload)).toBe(true);
        expect(fs.existsSync(`${r.file}.part`)).toBe(false);
        const again = await su.downloadVerified({ fetchFn: fakeFetch({}), plan, dir }); // no network needed
        expect(again.reused).toBe(true);
    });
    it('refuses a mismatching or unlisted file and leaves nothing behind', async () => {
        const dir = tmp();
        const bad = fakeFetch({ 'u://file': payload, 'u://sha': `${'0'.repeat(64)}  x.AppImage\n` });
        await expect(su.downloadVerified({ fetchFn: bad, plan, dir })).rejects.toThrow(/checksum mismatch/);
        expect(fs.readdirSync(dir)).toEqual([]);
        await expect(su.downloadVerified({ fetchFn: fakeFetch({ 'u://file': payload, 'u://sha': 'nope' }), plan, dir })).rejects.toThrow(/checksum file/);
        await expect(su.downloadVerified({ fetchFn: fakeFetch({ 'u://sha': `${hash}  x.AppImage` }), plan, dir })).rejects.toThrow(/HTTP 404/);
    });
    it('a corrupted staged file is downloaded again', async () => {
        const dir = tmp();
        const f = fakeFetch({ 'u://file': payload, 'u://sha': `${hash}  x.AppImage\n` });
        const r = await su.downloadVerified({ fetchFn: f, plan, dir });
        fs.writeFileSync(r.file, 'tampered');
        expect((await su.downloadVerified({ fetchFn: f, plan, dir })).reused).toBe(false);
    });
});

describe('install helpers', () => {
    it('replaces a file in place (same path, executable) and detects read-only folders', () => {
        const dir = tmp();
        const target = path.join(dir, 'game.AppImage');
        const staged = path.join(dir, 'staged');
        fs.writeFileSync(target, 'old');
        fs.writeFileSync(staged, 'new');
        expect(su.canReplaceFile(target)).toBe(true);
        su.replaceFile(staged, target);
        expect(fs.readFileSync(target, 'utf8')).toBe('new');
        expect(fs.statSync(target).mode & 0o111).not.toBe(0);
        expect(fs.readdirSync(dir).sort()).toEqual(['game.AppImage', 'staged']);
        expect(su.canReplaceFile(path.join(dir, 'missing'))).toBe(false);
    });
    it('NSIS runs silently, and starts the app again only for Restart now', () => {
        expect(su.nsisArgs(false)).toEqual(['/S', '--updated']);
        expect(su.nsisArgs(true)).toEqual(['/S', '--updated', '--force-run']);
    });
    it('cleans staged versions that are not newer than the running one', () => {
        const root = tmp();
        for (const v of ['0.1.30', '0.1.31', '0.2.0']) fs.mkdirSync(path.join(root, v));
        su.cleanupStaged(root, '0.1.31', uc.compareVersions);
        expect(fs.readdirSync(root)).toEqual(['0.2.0']);
    });
});
