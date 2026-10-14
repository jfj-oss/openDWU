// Anonymous usage statistics (Aptabase, EU region): which versions / systems / game setups are in use. Always on in
// packaged builds (DWU_APTABASE=1 forces it for testing, DWU_APTABASE=0 turns it off); no setting, like crash reports.
// Aptabase's HTTP API is used directly (POST /api/v0/events) instead of the SDK: the page's events arrive over IPC and
// the whole thing is a few dozen lines, with no extra package in the app.
//
// Only the events and props of EVENTS below are ever sent (everything else is dropped); values are numbers, booleans or
// short strings made of letters, digits and "-_.,: " (no paths, names or free text). Events are queued and sent in
// batches in the background (every 30 s and at quit); if the request fails (offline) that batch is dropped, never retried.
// Pure parts (no Electron imports) are unit-tested in test/desktopShell.test.ts.
'use strict';
const crypto = require('node:crypto');

const APP_KEY = 'A-EU-4193350005';
const HOSTS = { EU: 'https://eu.aptabase.com', US: 'https://us.aptabase.com' };
const SDK_VERSION = 'openDWU-http@1';

/** Allowed props per event (name -> max length for strings; 'n' = number, 'b' = boolean). */
const EVENTS = {
    app_started: { version: 24, edition: 12, os: 12, arch: 8, gpu_vendor: 12, renderer: 12, locale: 16 },
    game_started: { stars: 'n', empires: 'n', shape: 24, age: 'n', difficulty: 'n', edition: 12, addons: 400, multiplayer: 'b', players: 'n', theme: 40 },
    game_loaded: { stars: 'n', empires: 'n', shape: 24, age: 'n', difficulty: 'n', edition: 12, addons: 400, multiplayer: 'b', players: 'n', theme: 40 },
    session_ended: { minutes: 'n', year: 'n', result: 12 },
    screen_opened: { screen: 48 },
    mp_desync: {},
    update_installed: { from: 24, to: 24 },
};

function cleanString(v, max) {
    return String(v).replace(/[^A-Za-z0-9 _.,:+-]/g, '').slice(0, max);
}

/** The props of `name` reduced to the allowed keys and types, or null when `name` is not an event we send. */
function sanitizeProps(name, props) {
    const schema = Object.prototype.hasOwnProperty.call(EVENTS, name) ? EVENTS[name] : null;
    if (!schema) return null;
    const out = {};
    for (const [k, t] of Object.entries(schema)) {
        const v = props && typeof props === 'object' ? props[k] : undefined;
        if (v === undefined || v === null) continue;
        if (t === 'n') {
            if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
        } else if (t === 'b') {
            if (typeof v === 'boolean') out[k] = v;
        } else if (typeof v === 'string' || typeof v === 'number') {
            const s = cleanString(v, t);
            if (s !== '') out[k] = s;
        }
    }
    return out;
}

/** "NVIDIA GeForce …" / "ANGLE (AMD …)" -> nvidia | amd | intel | apple | other | unknown. */
function gpuVendor(text) {
    const t = String(text ?? '').toLowerCase();
    if (t === '') return 'unknown';
    for (const v of ['nvidia', 'amd', 'intel', 'apple']) if (t.includes(v)) return v;
    if (t.includes('radeon') || t.includes('ati ')) return 'amd';
    return 'other';
}

/** One Aptabase event object (https://github.com/aptabase/aptabase/blob/main/docs/HTTP.md), or null when not allowed. */
function buildEvent({ name, props, sessionId, now, system }) {
    const p = sanitizeProps(name, props);
    if (p === null) return null;
    return {
        timestamp: new Date(now).toISOString(),
        sessionId,
        eventName: name,
        systemProps: {
            isDebug: false,
            locale: cleanString(system.locale ?? '', 16),
            osName: system.osName,
            osVersion: system.osVersion,
            engineName: 'Electron',
            engineVersion: system.engineVersion,
            appVersion: system.appVersion,
            sdkVersion: SDK_VERSION,
        },
        props: p,
    };
}

function hostFor(appKey) {
    const m = /^A-(EU|US)-\d+$/.exec(appKey);
    return m ? HOSTS[m[1]] : null;
}

const OS_NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

/**
 * The tracker. `fetchFn` is fetch-shaped (Electron's net.fetch). track() only queues; send happens on a timer / flush().
 * `system`: { locale, osName, osVersion, engineVersion, appVersion }.
 */
function createTracker({ fetchFn, system, appKey = APP_KEY, enabled, now = Date.now, intervalMs = 30000, timer = setInterval, log = () => {} }) {
    const sessionId = crypto.randomUUID();
    const seenScreens = new Set();
    let queue = [];
    let sending = null;
    const host = hostFor(appKey);
    const on = !!enabled && host !== null;

    async function sendBatch(batch) {
        try {
            const res = await fetchFn(`${host}/api/v0/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'App-Key': appKey },
                body: JSON.stringify(batch),
                cache: 'no-store',
            });
            log(`[aptabase] sent ${batch.length} event(s): HTTP ${res.status}`);
            return res.status;
        } catch (err) {
            log(`[aptabase] dropped ${batch.length} event(s): ${err && err.message ? err.message : err}`);
            return 0;
        }
    }

    async function flush() {
        if (!on) return;
        if (sending) await sending;
        if (queue.length === 0) return;
        sending = (async () => {
            while (queue.length > 0) {
                const batch = queue.slice(0, 25);
                queue = queue.slice(25);
                await sendBatch(batch);
            }
        })().finally(() => {
            sending = null;
        });
        await sending;
    }

    if (on) {
        const t = timer(() => void flush(), intervalMs);
        if (t && typeof t.unref === 'function') t.unref();
    }

    return {
        enabled: on,
        sessionId,
        /** Queue an event (screen_opened: only the first open of each screen per session). */
        track(name, props) {
            if (!on) return false;
            if (name === 'screen_opened') {
                const s = props && typeof props.screen === 'string' ? cleanString(props.screen, 48) : '';
                if (s === '' || seenScreens.has(s) || seenScreens.size >= 80) return false;
                seenScreens.add(s);
            }
            const ev = buildEvent({ name, props, sessionId, now: now(), system });
            if (ev === null) return false;
            if (queue.length >= 200) queue.shift();
            queue.push(ev);
            return true;
        },
        flush,
        queued: () => queue.length,
    };
}

module.exports = { APP_KEY, EVENTS, OS_NAMES, sanitizeProps, gpuVendor, buildEvent, hostFor, createTracker };
