// What must be identical for two apps to play one lockstep game (multiplayer Phase 3, docs/MULTIPLAYER.md §10): the app
// version and build, the JS engine (Node and Electron run different games from one seed: §9), the protocol, the theme,
// the add-on set and the game data files. A joiner sends its fingerprint in the lobby hello; the host refuses a
// mismatch with a message that names the difference ("host runs 0.1.16, you run 0.1.15").
//
// The data fingerprint hashes every data file the game loaded (path + content), paths lower-cased as in the
// determinism runner (scripts/determinism-check/runner.ts: a case-insensitive file system opens another spelling of the
// same file). The app records the reads as it loads (noteDataRead), so the hash covers exactly what the sim was built
// from, whatever the install folder holds besides.
//
// Headless: WebCrypto (crypto.subtle) only, no DOM / Pixi / Node APIs.

/** Bumped when the lobby or lockstep wire format changes incompatibly. */
export const MULTIPLAYER_PROTOCOL_VERSION = 1;

export interface AppFingerprint {
    /** package.json version (appVersion.ts APP_VERSION). */
    version: string;
    /** The build: the git commit the app was built from (vite.config.ts __DWU_BUILD__), 'dev' when unknown. */
    build: string;
    /** The JS engine: 'Electron 44.4.5' / 'Chrome 141' / 'Node 22.23.2'. */
    engine: string;
    protocol: number;
    /** The active theme (customization set), '' = the stock game. */
    theme: string;
    /** Hash of the add-on (scenario overlay) files, and how many. */
    addons: string;
    addonFiles: number;
    /** Hash of the game data files read, and how many. */
    data: string;
    dataFiles: number;
}

/** The JS engine from a user agent (navigator.userAgent), or Node's version. */
export function engineName(userAgent: string | undefined, nodeVersion?: string): string {
    if (userAgent !== undefined) {
        const e = /Electron\/([\d.]+)/.exec(userAgent);
        if (e !== null) return `Electron ${e[1]}`;
        const c = /Chrom(?:e|ium)\/([\d.]+)/.exec(userAgent);
        if (c !== null) return `Chrome ${c[1]}`;
        const f = /Firefox\/([\d.]+)/.exec(userAgent);
        if (f !== null) return `Firefox ${f[1]}`;
        const s = /Version\/([\d.]+).*Safari/.exec(userAgent);
        if (s !== null) return `Safari ${s[1]}`;
    }
    if (nodeVersion !== undefined) return `Node ${nodeVersion}`;
    return 'unknown';
}

/**
 * Why a joiner with fingerprint `mine` cannot play the host's game (`host`), phrased for the joiner; null = they match.
 * The first difference wins, in order of what a player can fix.
 */
export function fingerprintMismatch(host: AppFingerprint, mine: AppFingerprint): string | null {
    if (host.protocol !== mine.protocol) return `The host's multiplayer protocol is version ${host.protocol}, yours is ${mine.protocol}. Both players need the same app version.`;
    if (host.version !== mine.version) return `The host runs openDWU ${host.version}, you run ${mine.version}. Both players need the same version.`;
    if (host.build !== mine.build) return `The host runs build ${host.build} of ${host.version}, you run build ${mine.build}. Both players need the same build.`;
    if (host.engine !== mine.engine) return `The host runs on ${host.engine}, you run on ${mine.engine}. Different engines compute the game differently: both players need the same app (the desktop app, the same release).`;
    if (host.theme !== mine.theme) return `The host plays the theme "${host.theme === '' ? 'Default' : host.theme}", you have "${mine.theme === '' ? 'Default' : mine.theme}" active. Switch to the same theme (main menu → Change Theme).`;
    if (host.addons !== mine.addons) return `Your add-ons differ from the host's (host: ${host.addonFiles} add-on files, ${host.addons.slice(0, 8)}; you: ${mine.addonFiles}, ${mine.addons.slice(0, 8)}). Both players need the same add-ons.`;
    if (host.data !== mine.data) return `Your game data files differ from the host's (host: ${host.dataFiles} files, ${host.data.slice(0, 8)}; you: ${mine.dataFiles} files, ${mine.data.slice(0, 8)}). Both players need the same Distant Worlds: Universe files (the same version, no edited or extra data files).`;
    return null;
}

/**
 * Phase 5 (docs/MULTIPLAYER.md §17): what kind of difference. `hard`: the app itself differs (protocol, version, build,
 * engine) — refused, no setting fixes it. `soft`: the theme (DW:U customization set: its own data and mods), the add-on
 * files or the game data — the joiner is shown what differs, and a theme can be matched for the session.
 */
export type FingerprintDifference = { kind: 'hard'; reason: string } | { kind: 'soft'; reason: string; theme: boolean; addons: boolean; data: boolean };

export function fingerprintDifference(host: AppFingerprint, mine: AppFingerprint): FingerprintDifference | null {
    const why = fingerprintMismatch(host, mine);
    if (why === null) return null;
    if (host.protocol !== mine.protocol || host.version !== mine.version || host.build !== mine.build || host.engine !== mine.engine) return { kind: 'hard', reason: why };
    return { kind: 'soft', reason: why, theme: host.theme !== mine.theme, addons: host.addons !== mine.addons, data: host.data !== mine.data };
}

/** The files behind a data / add-on difference: host's list vs. ours (fingerprintFiles), each as lower-cased paths. */
export interface FileDiff {
    /** The host has them, this app read none. */
    missing: string[];
    /** Both read them, with other contents. */
    different: string[];
    /** This app read them, the host did not. */
    extra: string[];
}

export function diffFingerprintFiles(host: ReadonlyArray<readonly [string, string]>, mine: ReadonlyArray<readonly [string, string]>): FileDiff {
    const h = new Map(host.map(([k, v]) => [k, v]));
    const m = new Map(mine.map(([k, v]) => [k, v]));
    const out: FileDiff = { missing: [], different: [], extra: [] };
    for (const [k, v] of h) {
        const x = m.get(k);
        if (x === undefined) out.missing.push(k);
        else if (x !== v) out.different.push(k);
    }
    for (const k of m.keys()) if (!h.has(k)) out.extra.push(k);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The reads behind the hashes
// ---------------------------------------------------------------------------------------------------------------------

/** Files the data hash leaves out: listings of the install folder (not read by the sim, they differ by what else is there). */
function ignoredRead(key: string): boolean {
    return key === 'asset-manifest.json' || key.startsWith('theme-manifest/');
}

const dataReads = new Map<string, string>();
const addonReads = new Map<string, string>();

/** Normalize a fetched URL to a data key: no origin, no /assets/dwu/ prefix, decoded, lower-cased. */
export function dataReadKey(url: string): string {
    let u = url;
    const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(u);
    if (origin !== null) u = u.slice(origin[0].length);
    u = u.split('?')[0];
    try {
        u = decodeURIComponent(u);
    } catch {
        // keep it encoded
    }
    return u.replace(/^\/+/, '').replace(/^assets\/dwu\//i, '').toLowerCase();
}

/**
 * The app fetched `url` (a data file, a theme file or an add-on file) with this text. A leading UTF-8 byte-order mark is
 * dropped (fetch().text() drops it, a Node file read keeps it; the parsers ignore it either way).
 */
export function noteDataRead(url: string, text: string): void {
    const key = dataReadKey(url);
    if (ignoredRead(key)) return;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (key.startsWith('assets/scenarios/')) addonReads.set(key, text);
    else dataReads.set(key, text);
}

/** The game data is being loaded again (a theme switch): forget the data reads (add-on reads stay). */
export function resetDataReads(keep: (key: string) => boolean = () => false): void {
    for (const k of [...dataReads.keys()]) if (!keep(k)) dataReads.delete(k);
}

/** sha-256 hex of `key\0text\0` for every entry, in lower-cased key order. */
export async function hashReads(reads: ReadonlyMap<string, string>): Promise<string> {
    const keys = [...reads.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (const k of keys) {
        const b = enc.encode(`${k}\0${reads.get(k)!}\0`);
        parts.push(b);
        total += b.length;
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        all.set(p, off);
        off += p.length;
    }
    const digest = await crypto.subtle.digest('SHA-256', all);
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Each recorded file's own hash (first 12 hex), to find the file behind a data mismatch. */
export async function fingerprintFiles(): Promise<Array<[string, string]>> {
    const out: Array<[string, string]> = [];
    for (const [k, v] of [...dataReads, ...addonReads].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push([k, (await hashReads(new Map([[k, v]]))).slice(0, 12)]);
    return out;
}

/** This app's fingerprint from what it has read so far. */
export async function appFingerprint(base: { version: string; build: string; engine: string; theme: string }): Promise<AppFingerprint> {
    return {
        ...base,
        protocol: MULTIPLAYER_PROTOCOL_VERSION,
        addons: await hashReads(addonReads),
        addonFiles: addonReads.size,
        data: await hashReads(dataReads),
        dataFiles: dataReads.size,
    };
}
