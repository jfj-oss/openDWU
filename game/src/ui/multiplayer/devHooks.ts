// The multiplayer debug hooks and test switches (docs/MULTIPLAYER.md §21) exist only behind a dev flag: in a dev build
// (`npm run dev`), or when the desktop app was started with DWU_DEV_HOOKS=1 (the shell passes `--dwu-dev-hooks` to the
// game window: gamePreload.cjs `dwuDesktop.devHooks`), or with `?devHooks=1` in the page's URL. A release build without
// the flag has no `window.__dwuMp`, `__dwuMpLobby`, `__dwuRtc`, `__dwuChat` or `__dwuOffers`, and ignores the
// localStorage test switches (`dwu.mp.blockIce`, `dwu.mp.publicOnly`, `dwu.mp.hideAddon`).
//
// Main thread / no DOM beyond `window`.

let cached: boolean | null = null;

/** True when the debug hooks and test switches are on (see the file header). */
export function devHooksOn(): boolean {
    if (cached !== null) return cached;
    let on = import.meta.env.DEV === true;
    try {
        if (!on) on = (window as unknown as { dwuDesktop?: { devHooks?: unknown } }).dwuDesktop?.devHooks === true;
        if (!on) on = new URLSearchParams(window.location.search).get('devHooks') === '1';
    } catch {
        // no window (tests): only the build decides
    }
    cached = on;
    return on;
}

/** A localStorage test switch: '1' and the dev flag on. */
export function devSwitch(key: string): boolean {
    if (!devHooksOn()) return false;
    try {
        return localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
}

/** A localStorage test value ('' when unset or without the dev flag). */
export function devValue(key: string): string {
    if (!devHooksOn()) return '';
    try {
        return localStorage.getItem(key) ?? '';
    } catch {
        return '';
    }
}

/** Set `window[name]` (a debug hook) only with the dev flag on. */
export function exposeDevHook(name: string, value: unknown): void {
    if (!devHooksOn()) return;
    (window as unknown as Record<string, unknown>)[name] = value;
}
