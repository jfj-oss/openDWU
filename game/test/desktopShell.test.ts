// Desktop shell (desktop/*.cjs) pure parts: Windows/POSIX path resolution of the dwu:// handler, install folder
// discovery and validation on every platform, the runtime asset manifest, and the update check. Runs without the
// DW:U install (fixtures are built in a temp dir or faked), so it also runs on machines without the game.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createResolver } = require('../desktop/resolvePath.cjs') as {
    createResolver(opts?: { readdir?: (dir: string) => string[]; pathImpl?: typeof path }): { resolveInsideRoot(root: string, rel: string): string | null; clearCache(): void };
};
type FsImpl = { readdir(d: string): string[]; isDir(p: string): boolean; isFile(p: string): boolean; readText(p: string): string | null };
const installLib = require('../desktop/installDir.cjs') as {
    INSTALL_FOLDER: string;
    checkInstallDir(dir: string, fsImpl?: FsImpl, p?: typeof path): { ok: boolean; dir?: string; problem?: string };
    checkInstallDirExact(dir: string, fsImpl?: FsImpl, p?: typeof path): { ok: boolean; problem?: string };
    parseLibraryFoldersVdf(text: string | null): string[];
    parseRegQueryValue(stdout: string, name: string): string | null;
    installCandidates(o: { platform: string; home: string; env?: Record<string, string>; registry?: (k: string, v: string) => string | null; fsImpl?: FsImpl }): string[];
    findInstallDir(o: { platform: string; home: string; env?: Record<string, string>; registry?: (k: string, v: string) => string | null; fsImpl?: FsImpl }): string | null;
};
const updates = require('../desktop/updateCheck.cjs') as {
    DAY_MS: number;
    assetFileNames(v: string): Record<'macDmg' | 'linuxAppImage' | 'linuxTarGz' | 'winSetup' | 'winZip', string>;
    compareVersions(a: string, b: string): number;
    isCheckDue(last: unknown, now: number, interval?: number): boolean;
    isSafeGithubUrl(u: string): boolean;
    releaseInfo(json: unknown): { version: string; tag: string; pageUrl: string | null; assets: { name: string; url: string }[] } | null;
    pickDownload(r: unknown, o: { platform: string; arch: string; kind: string }): { name: string; url: string } | null;
    repoSlug(r: unknown): string | null;
    notesExcerpt(n: string, max?: number): string;
};
const { buildAssetManifest } = require('../desktop/assetManifest.cjs') as { buildAssetManifest(root: string): Record<string, string[]> };

/** A fake filesystem from a list of file paths (directories implied), for any path flavour. */
function fakeFs(files: string[], p: typeof path.win32 | typeof path.posix, texts: Record<string, string> = {}): FsImpl {
    const dirs = new Map<string, Set<string>>();
    const fileSet = new Set<string>();
    const key = (x: string) => (p === path.win32 ? p.normalize(x).toLowerCase() : p.normalize(x));
    for (const f of files) {
        fileSet.add(key(f));
        let cur = p.normalize(f);
        for (;;) {
            const parent = p.dirname(cur);
            if (parent === cur) break;
            if (!dirs.has(key(parent))) dirs.set(key(parent), new Set());
            dirs.get(key(parent))!.add(p.basename(cur));
            cur = parent;
        }
    }
    for (const t of Object.keys(texts)) fileSet.add(key(t));
    return {
        readdir: (d) => {
            const s = dirs.get(key(d));
            if (!s) throw new Error(`ENOENT ${d}`);
            return [...s];
        },
        isDir: (x) => dirs.has(key(x)),
        isFile: (x) => fileSet.has(key(x)),
        readText: (x) => texts[Object.keys(texts).find((t) => key(t) === key(x)) ?? ''] ?? null,
    };
}

describe('desktop/resolvePath.cjs (dwu:// path resolution)', () => {
    describe('Windows paths (path.win32)', () => {
        const root = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Distant Worlds Universe';
        const tree: Record<string, string[]> = {
            [root]: ['images', 'races.txt', 'End Users Agreement.pdf'],
            [`${root}\\images`]: ['Environment', 'ui'],
            [`${root}\\images\\Environment`]: ['Planets'],
            [`${root}\\images\\Environment\\Planets`]: ['Ocean1.png'],
        };
        const r = createResolver({ pathImpl: path.win32, readdir: (d) => tree[d] ?? [] });

        it('resolves case-insensitively to the on-disk casing with backslashes', () => {
            expect(r.resolveInsideRoot(root, 'images/environment/planets/OCEAN1.png')).toBe(`${root}\\images\\Environment\\Planets\\Ocean1.png`);
            expect(r.resolveInsideRoot(root, 'RACES.TXT')).toBe(`${root}\\races.txt`);
            expect(r.resolveInsideRoot(root, 'End%20Users%20Agreement.pdf')).toBe(`${root}\\End Users Agreement.pdf`);
        });

        it('blocks traversal through backslashes, drive letters, streams and ..', () => {
            for (const evil of ['..\\..\\Windows\\win.ini', '../Windows', 'images\\..\\..\\x', 'C:\\Windows\\win.ini', 'races.txt::$DATA', 'images%5c..%5c..', '%2e%2e/x', 'a%00b']) {
                expect(r.resolveInsideRoot(root, evil), evil).toBeNull();
            }
            expect(r.resolveInsideRoot(root, '%E0%A4%A')).toBeNull(); // malformed percent-encoding
        });

        it('handles a drive root as the root folder', () => {
            const rr = createResolver({ pathImpl: path.win32, readdir: (d) => (d === 'D:\\' ? ['Races.txt'] : []) });
            expect(rr.resolveInsideRoot('D:\\', 'races.txt')).toBe('D:\\Races.txt');
        });
    });

    describe('POSIX paths', () => {
        const root = '/home/u/DWU';
        const tree: Record<string, string[]> = { [root]: ['images', 'races.txt', 'a\\b'], [`${root}/images`]: ['UI'], [`${root}/images/UI`]: ['x.png'] };
        const r = createResolver({ pathImpl: path.posix, readdir: (d) => tree[d] ?? [] });
        it('resolves case-insensitively and blocks escapes', () => {
            expect(r.resolveInsideRoot(root, 'Images/ui/X.PNG')).toBe(`${root}/images/UI/x.png`);
            expect(r.resolveInsideRoot(root, '../etc/passwd')).toBeNull();
            expect(r.resolveInsideRoot(root, 'missing.txt')).toBeNull();
            expect(r.resolveInsideRoot(root, 'a%5Cb')).toBeNull(); // a backslash never names one entry
        });
    });
});

describe('desktop/installDir.cjs (finding the DW:U install)', () => {
    it('parses libraryfolders.vdf (current and old format) and reg.exe output', () => {
        const vdf = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t\t"apps"\n\t\t{\n\t\t\t"261470"\t\t"4300000000"\n\t\t}\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}\n`;
        expect(installLib.parseLibraryFoldersVdf(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
        expect(installLib.parseLibraryFoldersVdf(`"LibraryFolders"\n{\n\t"TimeNextStatsReport"\t\t"1234"\n\t"1"\t\t"E:\\\\Games\\\\Steam"\n}\n`)).toEqual(['E:\\Games\\Steam']);
        expect(installLib.parseLibraryFoldersVdf(null as unknown as string)).toEqual([]);
        const reg = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n';
        expect(installLib.parseRegQueryValue(reg, 'SteamPath')).toBe('c:/program files (x86)/steam');
        expect(installLib.parseRegQueryValue(reg, 'InstallPath')).toBeNull();
    });

    it('Windows: registry Steam root, other-drive libraries from libraryfolders.vdf, then the defaults', () => {
        const p = path.win32;
        const install = 'E:\\SteamLibrary\\steamapps\\common\\Distant Worlds Universe';
        const fsImpl = fakeFs([`${install}\\races.txt`, `${install}\\images\\ui\\x.png`], p, {
            'D:\\Steam\\steamapps\\libraryfolders.vdf': `"libraryfolders" { "0" { "path" "D:\\\\Steam" } "1" { "path" "E:\\\\SteamLibrary" } }`,
        });
        const registry = (k: string, v: string) => (k === 'HKCU\\Software\\Valve\\Steam' && v === 'SteamPath' ? 'd:/steam' : null);
        const opts = { platform: 'win32', home: 'C:\\Users\\me', env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files' }, registry, fsImpl };
        const cands = installLib.installCandidates(opts);
        expect(cands[0]).toBe('d:\\steam\\steamapps\\common\\Distant Worlds Universe');
        expect(cands).toContain(install);
        expect(cands).toContain('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Distant Worlds Universe');
        expect(cands.indexOf(install)).toBeLessThan(cands.indexOf('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Distant Worlds Universe'));
        // D:\Steam appears twice (registry + vdf, different case): listed once.
        expect(cands.filter((c) => c.toLowerCase() === 'd:\\steam\\steamapps\\common\\distant worlds universe')).toHaveLength(1);
        expect(installLib.findInstallDir(opts)).toBe(install);
        // Without the registry, the default Steam folder is still tried.
        expect(installLib.installCandidates({ ...opts, registry: () => null })[0]).toBe('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Distant Worlds Universe');
    });

    it('macOS: Whisky / CrossOver bottles and ~/Games', () => {
        const p = path.posix;
        const bottle = '/Users/me/Library/Containers/com.isaacmarovitz.Whisky/Bottles/Steam';
        const install = `${bottle}/drive_c/Program Files (x86)/Steam/steamapps/common/Distant Worlds Universe`;
        const fsImpl = fakeFs([`${install}/races.txt`, `${install}/images/a.png`, '/Users/me/Library/Application Support/CrossOver/Bottles/CX/drive_c/x.txt'], p, {
            // A bottle's Steam lists Windows paths: ignored outside Windows.
            [`${bottle}/drive_c/Program Files (x86)/Steam/steamapps/libraryfolders.vdf`]: `"libraryfolders" { "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" } }`,
        });
        const cands = installLib.installCandidates({ platform: 'darwin', home: '/Users/me', fsImpl });
        expect(cands).toContain(install);
        expect(cands).toContain('/Users/me/Library/Application Support/CrossOver/Bottles/CX/drive_c/Program Files (x86)/Steam/steamapps/common/Distant Worlds Universe');
        expect(cands).toContain('/Users/me/Games/Distant Worlds Universe');
        expect(cands.some((c) => c.includes('C:'))).toBe(false);
        expect(installLib.findInstallDir({ platform: 'darwin', home: '/Users/me', fsImpl })).toBe(install);
    });

    it('Linux: XDG / Flatpak / Snap Steam roots and extra libraries', () => {
        const p = path.posix;
        const install = '/mnt/games/SteamLibrary/steamapps/common/Distant Worlds Universe';
        const fsImpl = fakeFs([`${install}/races.txt`, `${install}/images/a.png`], p, {
            '/home/u/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/libraryfolders.vdf': `"libraryfolders" { "1" { "path" "/mnt/games/SteamLibrary" } }`,
        });
        const cands = installLib.installCandidates({ platform: 'linux', home: '/home/u', env: { XDG_DATA_HOME: '/data' }, fsImpl });
        expect(cands[0]).toBe('/data/Steam/steamapps/common/Distant Worlds Universe');
        expect(cands).toContain('/home/u/.local/share/Steam/steamapps/common/Distant Worlds Universe');
        expect(cands).toContain('/home/u/snap/steam/common/.local/share/Steam/steamapps/common/Distant Worlds Universe');
        expect(installLib.findInstallDir({ platform: 'linux', home: '/home/u', env: {}, fsImpl })).toBe(install);
    });

    it('validates a picked folder: needs images/ and races.txt (any case); forgives a pick one or more levels up', () => {
        const p = path.win32;
        const install = 'D:\\SteamLibrary\\steamapps\\common\\Distant Worlds Universe';
        const fsImpl = fakeFs([`${install}\\RACES.TXT`, `${install}\\Images\\x.png`, 'D:\\Partial\\images\\a.png', 'D:\\Data\\races.txt', 'D:\\Empty\\readme.txt'], p);
        expect(installLib.checkInstallDir(install, fsImpl, p)).toEqual({ ok: true, dir: install });
        expect(installLib.checkInstallDir('D:\\SteamLibrary', fsImpl, p)).toEqual({ ok: true, dir: install });
        expect(installLib.checkInstallDir('D:\\SteamLibrary\\steamapps', fsImpl, p)).toEqual({ ok: true, dir: install });
        expect(installLib.checkInstallDir('D:\\SteamLibrary\\steamapps\\common', fsImpl, p)).toEqual({ ok: true, dir: install });
        expect(installLib.checkInstallDir('D:\\Partial', fsImpl, p).problem).toMatch(/no "races\.txt"/);
        expect(installLib.checkInstallDir('D:\\Data', fsImpl, p).problem).toMatch(/no "images" folder/);
        expect(installLib.checkInstallDir('D:\\Empty', fsImpl, p).problem).toMatch(/not a Distant Worlds/);
        expect(installLib.checkInstallDir('Q:\\Nope', fsImpl, p).problem).toMatch(/does not exist/);
        expect(installLib.checkInstallDir('', fsImpl, p).ok).toBe(false);
    });
});

describe('desktop/updateCheck.cjs', () => {
    it('compares versions with semver precedence', () => {
        expect(updates.compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
        expect(updates.compareVersions('v1.10.0', '1.9.9')).toBeGreaterThan(0);
        expect(updates.compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(updates.compareVersions('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0);
        expect(updates.compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
        expect(updates.compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
        expect(updates.compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0);
        expect(updates.compareVersions('nightly', '0.1.0')).toBe(0); // unparseable: never "newer"
    });

    it('checks at most daily (and recovers from a clock set back)', () => {
        const now = 1_800_000_000_000;
        expect(updates.isCheckDue(undefined, now)).toBe(true);
        expect(updates.isCheckDue(now - updates.DAY_MS + 60_000, now)).toBe(false);
        expect(updates.isCheckDue(now - updates.DAY_MS, now)).toBe(true);
        expect(updates.isCheckDue(now + 3_600_000, now)).toBe(true);
    });

    it('picks the download for this platform from the release the workflow publishes', () => {
        const names = updates.assetFileNames('0.3.0');
        const json = {
            tag_name: 'v0.3.0',
            html_url: 'https://github.com/jfj-oss/openDWU/releases/tag/v0.3.0',
            draft: false,
            assets: [...Object.values(names), `${names.winSetup}.sha256`].map((n) => ({ name: n, browser_download_url: `https://github.com/jfj-oss/openDWU/releases/download/v0.3.0/${n}` })),
        };
        const rel = updates.releaseInfo(json)!;
        expect(rel.version).toBe('0.3.0');
        expect(updates.pickDownload(rel, { platform: 'darwin', arch: 'arm64', kind: 'archive' })?.name).toBe(names.macDmg);
        expect(updates.pickDownload(rel, { platform: 'linux', arch: 'x64', kind: 'appimage' })?.name).toBe(names.linuxAppImage);
        expect(updates.pickDownload(rel, { platform: 'linux', arch: 'x64', kind: 'archive' })?.name).toBe(names.linuxTarGz);
        expect(updates.pickDownload(rel, { platform: 'win32', arch: 'x64', kind: 'nsis' })?.name).toBe(names.winSetup);
        expect(updates.pickDownload(rel, { platform: 'win32', arch: 'x64', kind: 'archive' })?.name).toBe(names.winZip);
        expect(updates.pickDownload(rel, { platform: 'darwin', arch: 'x64', kind: 'archive' })).toBeNull(); // no Intel build
        // Only GitHub URLs are ever opened.
        const evil = updates.releaseInfo({ ...json, assets: [{ name: names.macDmg, browser_download_url: 'https://evil.example/x.dmg' }] });
        expect(updates.pickDownload(evil, { platform: 'darwin', arch: 'arm64', kind: 'archive' })).toBeNull();
        expect(updates.isSafeGithubUrl('https://github.com/a/b')).toBe(true);
        expect(updates.isSafeGithubUrl('http://github.com/a/b')).toBe(false);
        expect(updates.isSafeGithubUrl('https://github.com.evil.example/')).toBe(false);
        expect(updates.releaseInfo({ ...json, draft: true })).toBeNull();
        expect(updates.releaseInfo({ tag_name: 'latest' })).toBeNull();
    });

    it('reads the repository slug of package.json', () => {
        expect(updates.repoSlug({ type: 'git', url: 'https://github.com/jfj-oss/openDWU.git' })).toBe('jfj-oss/openDWU');
        expect(updates.repoSlug('github:jfj-oss/openDWU')).toBe('jfj-oss/openDWU');
        expect(updates.repoSlug('git@github.com:jfj-oss/openDWU.git')).toBe('jfj-oss/openDWU');
        expect(updates.repoSlug(undefined)).toBeNull();
        const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { repository: unknown };
        expect(updates.repoSlug(pkg.repository)).toBe('jfj-oss/openDWU');
        expect(updates.notesExcerpt('a\r\n\r\n\r\n\r\nb'.padEnd(900, 'x'), 20)).toMatch(/^a\n\nbx{16}…$/);
    });
});

describe('desktop/assetManifest.cjs (built at runtime by the shell)', () => {
    let dir: string;
    beforeAll(() => {
        dir = mkdtempSync(path.join(tmpdir(), 'dwu-manifest-test-'));
        const files = [
            'images/environment/planets/ocean/b.png',
            'images/environment/planets/ocean/A.png',
            'images/environment/planets/ocean/notes.txt',
            'images/environment/stars/s1.png',
            'images/ui/flagshapes/f2.png',
            'images/ui/flagshapes/F1.png',
            'races/Zeta.txt',
            'races/alpha.txt',
            'Policy/p.txt',
            'Policy/pirate/q.txt',
            'designTemplates/DEFAULT/escort.txt',
            'designTemplates/Human/pirate/frigate.txt',
            'designTemplates/Human/frigate.txt',
            'Characters/Human.txt',
            'HELP/topic.mht',
            'Customization/Theme A/Help/t.mht',
            'Customization/Theme B/images/x.png',
            'races.txt',
        ];
        for (const f of files) {
            mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
            writeFileSync(path.join(dir, f), 'x');
        }
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('lists the folders in Windows order', () => {
        expect(buildAssetManifest(dir)).toEqual({
            'planets/ocean': ['A.png', 'b.png'],
            'stars': ['s1.png'],
            races: ['alpha.txt', 'Zeta.txt'],
            'ui/flagshapes': ['F1.png', 'f2.png'],
            Policy: ['p.txt'],
            'Policy/pirate': ['q.txt'],
            'designTemplates/DEFAULT': ['escort.txt'],
            'designTemplates/DEFAULT/pirate': [],
            'designTemplates/Human': ['frigate.txt'],
            'designTemplates/Human/pirate': ['frigate.txt'],
            characters: ['Human.txt'],
            Help: ['topic.mht'],
            'Customization/Theme A/help': ['t.mht'],
        });
    });

    it('equals what scripts/gen-asset-manifest.mjs writes for the same install (dev server = desktop shell)', () => {
        const out = path.join(dir, '..', `${path.basename(dir)}-out.json`);
        try {
            const env = { ...process.env, DWU_DIR: dir, ASSET_MANIFEST_OUT: out };
            // The script prefers the public/assets/dwu link; run it from a copy-free cwd only when no link exists.
            execFileSync('node', [path.join(__dirname, '..', 'scripts', 'gen-asset-manifest.mjs')], { env, stdio: 'ignore' });
            const written = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string[]>;
            const linked = (() => {
                try {
                    return require('node:fs').realpathSync(path.join(__dirname, '..', 'public', 'assets', 'dwu')) as string;
                } catch {
                    return null;
                }
            })();
            expect(written).toEqual(buildAssetManifest(linked ?? dir));
        } finally {
            rmSync(out, { force: true });
        }
    });
});

describe('desktop/simProcess.cjs (the sim in a process of its own)', () => {
    const { createSimProcesses } = require('../desktop/simProcess.cjs') as { createSimProcesses(o: unknown): SimProcesses };
    interface SimProcesses {
        start(owner: unknown): number;
        ready(sender: unknown): boolean;
        terminate(sender: unknown, id: number): void;
        workerError(sender: unknown, message: string): void;
        list(): { id: number; memory: { pid: number; workingSetGB: number } | null }[];
    }
    type Handler = (...a: unknown[]) => void;
    class FakeContents {
        static nextPid = 100;
        handlers = new Map<string, Handler[]>();
        sent: { channel: string; payload: unknown; ports?: unknown[] }[] = [];
        destroyed = false;
        pid = FakeContents.nextPid++;
        id = this.pid;
        on(ev: string, h: Handler): void {
            this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), h]);
        }
        emit(ev: string, ...a: unknown[]): void {
            for (const h of this.handlers.get(ev) ?? []) h(...a);
        }
        isDestroyed(): boolean {
            return this.destroyed;
        }
        send(channel: string, payload: unknown): void {
            this.sent.push({ channel, payload });
        }
        postMessage(channel: string, payload: unknown, ports: unknown[]): void {
            this.sent.push({ channel, payload, ports });
        }
        getOSProcessId(): number {
            return this.pid;
        }
        setWindowOpenHandler(): void {}
    }
    class FakeWindow {
        static all: FakeWindow[] = [];
        webContents = new FakeContents();
        handlers = new Map<string, Handler[]>();
        destroyed = false;
        url = '';
        constructor(readonly opts: { show: boolean; webPreferences: Record<string, unknown> }) {
            FakeWindow.all.push(this);
        }
        on(ev: string, h: Handler): void {
            this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), h]);
        }
        loadURL(u: string): void {
            this.url = u;
        }
        isDestroyed(): boolean {
            return this.destroyed;
        }
        destroy(): void {
            if (this.destroyed) return;
            this.destroyed = true;
            this.webContents.destroyed = true;
            for (const h of this.handlers.get('closed') ?? []) h();
        }
    }
    class FakeChannel {
        port1 = { name: 'port1' };
        port2 = { name: 'port2' };
    }
    function setup() {
        FakeWindow.all = [];
        const crash: string[] = [];
        const sims = createSimProcesses({
            electron: {
                BrowserWindow: FakeWindow,
                MessageChannelMain: FakeChannel,
                app: { getAppMetrics: () => FakeWindow.all.map((w) => ({ pid: w.webContents.pid, memory: { workingSetSize: 2 * 1024 * 1024, peakWorkingSetSize: 3 * 1024 * 1024 } })) },
            },
            preload: '/x/simPreload.cjs',
            url: 'dwu://app/sim.html',
            crashLog: (t: string) => crash.push(t),
            log: () => undefined,
            memoryIntervalMs: 60_000,
            version: '9.9.9',
        });
        return { sims, crash, owner: new FakeContents() };
    }

    it('opens a hidden, sandboxed, unthrottled window on the sim page and connects it to its game page once it listens', () => {
        const { sims, owner } = setup();
        const id = sims.start(owner);
        const win = FakeWindow.all[0];
        expect(win.opts.show).toBe(false);
        expect(win.opts.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: '/x/simPreload.cjs' });
        expect(win.url).toBe('dwu://app/sim.html');
        expect(sims.ready(owner)).toBe(false); // only the sim page itself
        expect(sims.ready(win.webContents)).toBe(true);
        expect(sims.ready(win.webContents)).toBe(false); // once
        expect(win.webContents.sent).toEqual([{ channel: 'dwu-sim:port', payload: null, ports: [{ name: 'port1' }] }]);
        expect(owner.sent).toEqual([{ channel: 'dwu:sim-port', payload: { id }, ports: [{ name: 'port2' }] }]);
        expect(sims.list().map((s) => s.memory?.workingSetGB)).toEqual([2]);
    });

    it('terminate (only by its owner) closes the window without an exit notice; a navigation, crash or close of the game page kills its sims', () => {
        const { sims, owner } = setup();
        const other = new FakeContents();
        const a = sims.start(owner);
        sims.terminate(other, a);
        expect(FakeWindow.all[0].destroyed).toBe(false);
        sims.terminate(owner, a);
        expect(FakeWindow.all[0].destroyed).toBe(true);
        expect(owner.sent.filter((s) => s.channel === 'dwu:sim-exit')).toEqual([]);

        sims.start(owner);
        owner.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
        expect(FakeWindow.all[1].destroyed).toBe(false); // same-document (hash) navigation
        owner.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
        expect(FakeWindow.all[1].destroyed).toBe(false); // a subframe
        owner.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
        expect(FakeWindow.all[1].destroyed).toBe(true); // reload
        sims.start(owner);
        owner.emit('render-process-gone', {}, { reason: 'oom' });
        expect(FakeWindow.all[2].destroyed).toBe(true);
        sims.start(owner);
        owner.emit('destroyed');
        expect(FakeWindow.all[3].destroyed).toBe(true);
        expect(sims.list()).toEqual([]);
    });

    it('a sim process that dies is logged to crash-log.txt with its memory and reported to its game page; worker errors go to the page', () => {
        const { sims, owner, crash } = setup();
        const id = sims.start(owner);
        const win = FakeWindow.all[0];
        win.webContents.emit('console-message', { level: 'error', message: 'sim worker: STOPPED (step loop)' });
        sims.workerError(win.webContents, 'TypeError: x is undefined');
        expect(owner.sent).toContainEqual({ channel: 'dwu:sim-error', payload: { id, message: 'TypeError: x is undefined' } });
        win.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 133 });
        expect(owner.sent).toContainEqual({ channel: 'dwu:sim-exit', payload: { id, reason: 'the simulation process ended (oom, exit code 133)' } });
        expect(owner.sent.filter((s) => s.channel === 'dwu:sim-exit')).toHaveLength(1); // the window's close after it adds nothing
        expect(win.destroyed).toBe(true);
        expect(crash).toHaveLength(1);
        expect(crash[0]).toMatch(/sim process render-process-gone reason=oom exitCode=133 version=9\.9\.9/);
        expect(crash[0]).toMatch(/last memory sample: .* sim process \d+ working set 2\.00 GB, peak 3\.00 GB/);
        expect(crash[0]).toMatch(/sim worker: STOPPED/);
        // A sim window closed from outside: reported, not a crash.
        const id2 = sims.start(owner);
        FakeWindow.all[1].destroy();
        expect(owner.sent).toContainEqual({ channel: 'dwu:sim-exit', payload: { id: id2, reason: 'the simulation window was closed' } });
        expect(crash).toHaveLength(1);
    });
});
