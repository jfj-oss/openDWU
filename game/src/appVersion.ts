// The app's own version (game/package.json, injected by vite.config.ts as __DWU_VERSION__) and the main menu's
// update check outside the desktop shell. The desktop apps run their own check (desktop/main.cjs checkForUpdates,
// reached through gamePreload.cjs).

declare const __DWU_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __DWU_VERSION__ === 'string' ? __DWU_VERSION__ : '0.0.0';

export const RELEASES_URL = 'https://github.com/jfj-oss/openDWU/releases';
const LATEST_RELEASE_API = 'https://api.github.com/repos/jfj-oss/openDWU/releases/latest';

/** "v1.2.3" / "1.2.3-beta" -> [1, 2, 3] (a prerelease suffix is ignored); null when it is not a version. */
export function parseVersion(v: string): [number, number, number] | null {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** > 0 when `a` is newer than `b`, 0 when equal or either is not a version. */
export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (pa === null || pb === null) return 0;
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
}

export type UpdateCheckResult =
    | { kind: 'upToDate'; latest: string }
    | { kind: 'newer'; latest: string; url: string }
    | { kind: 'noRelease' }
    | { kind: 'error'; message: string };

/** The latest GitHub release against APP_VERSION (browser builds: GitHub's API allows cross-origin reads). */
export async function checkLatestRelease(fetchFn: typeof fetch = fetch): Promise<UpdateCheckResult> {
    try {
        const r = await fetchFn(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
        if (r.status === 404) return { kind: 'noRelease' };
        if (!r.ok) return { kind: 'error', message: `GitHub answered HTTP ${r.status}` };
        const j = (await r.json()) as { tag_name?: unknown; html_url?: unknown };
        const latest = typeof j.tag_name === 'string' ? j.tag_name.replace(/^v/, '') : '';
        if (parseVersion(latest) === null) return { kind: 'error', message: 'unexpected answer from GitHub' };
        if (compareVersions(latest, APP_VERSION) > 0) return { kind: 'newer', latest, url: typeof j.html_url === 'string' ? j.html_url : RELEASES_URL };
        return { kind: 'upToDate', latest };
    } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
}
