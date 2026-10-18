// Crash reporting (Sentry) for the desktop app: on by default in packaged builds, no setting, no UI (README privacy
// section). Pure helpers first (scrubbing; tested in test/desktopShell.test.ts), then init() which needs Electron.
//
// Captured: main-process exceptions, the page's uncaught errors / unhandled rejections (forwarded by gamePreload.cjs,
// since a sandboxed preload cannot load the SDK), native crashes (Electron's crashReporter minidumps of every process,
// via the SDK) and child / render process exits, plus each crash-log.txt entry (desktop/main.cjs appendCrashLog).
// Never sent: IP address, cookies / headers, save files, the player's home directory and user name (-> "~").
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

/** Share of sessions that send performance samples (and traces). */
const TRACES_SAMPLE_RATE = 0.01;

const DSN = 'https://4a591feb9cb1936747834e83b67f1215@o4512255043305472.ingest.de.sentry.io/4512255051169872';

/** Sentry runs only in a packaged app (or with DWU_SENTRY=1 for testing). */
function sentryEnabled(isPackaged, env) {
    return isPackaged || env.DWU_SENTRY === '1';
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A function that rewrites a string: the home directory (either slash flavour) and the user name become "~". */
function makeScrubber(home, user) {
    const homes = [];
    if (home && home.length > 3) {
        for (const h of new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])) homes.push(escapeRe(h.replace(/[\\/]+$/, '')));
    }
    const homeRe = homes.length > 0 ? new RegExp(`(?:${homes.join('|')})`, 'gi') : null;
    // Home folders of other spellings (/Users/<name>, /home/<name>, C:\Users\<name>), whoever the name is.
    const genericRe = /(?:[A-Za-z]:)?[\\/](?:Users|home)[\\/][^\\/\s"':;,)\]]+/g;
    const userRe = user && user.length >= 3 ? new RegExp(`\\b${escapeRe(user)}\\b`, 'gi') : null;
    return (s) => {
        let t = String(s);
        if (homeRe) t = t.replace(homeRe, '~');
        t = t.replace(genericRe, '~');
        if (userRe) t = t.replace(userRe, '~');
        return t;
    };
}

function scrubDeep(value, scrub, depth = 0) {
    if (typeof value === 'string') return scrub(value);
    if (value === null || typeof value !== 'object' || depth > 12) return value;
    if (Array.isArray(value)) return value.map((v) => scrubDeep(v, scrub, depth + 1));
    const out = {};
    for (const k of Object.keys(value)) out[k] = scrubDeep(value[k], scrub, depth + 1);
    return out;
}

/** beforeSend: no IP / user (but the random install id) / host name / cookies / headers; every string scrubbed of the home folder and user name. */
function scrubEvent(event, opts) {
    const scrub = makeScrubber(opts.home, opts.user);
    const e = scrubDeep(event, scrub);
    const id = event.user && typeof event.user.id === 'string' && /^[0-9a-f-]{36}$/.test(event.user.id) ? event.user.id : '';
    e.user = id ? { id } : undefined;
    delete e.server_name;
    if (e.request) {
        delete e.request.cookies;
        delete e.request.headers;
        delete e.request.env;
        delete e.request.data;
    }
    if (e.contexts && e.contexts.device) delete e.contexts.device.name;
    return e;
}

function scrubBreadcrumb(crumb, opts) {
    return scrubDeep(crumb, makeScrubber(opts.home, opts.user));
}

/** Crash-log text to attach: scrubbed, the newest `maxBytes`. */
function scrubLogText(text, opts, maxBytes = 20000) {
    const t = makeScrubber(opts.home, opts.user)(text);
    return t.length > maxBytes ? t.slice(t.length - maxBytes) : t;
}

/** Entries the SDK already reports itself (child / render process exits with their minidumps): breadcrumb only. */
function isSdkCoveredCrashEntry(text) {
    return /^\S+ (render-process-gone|gpu-process-gone) /.test(text);
}

let Sentry = null;
let scrubOpts = { home: '', user: '' };
let electronApp = null;
/** This session sends performance samples (decided once). */
let perfSampled = false;
const consoleTail = [];
const tags = {};

/**
 * A random id for this install (userData/install-id, made on first use), so release health can count distinct players.
 * Says nothing about the player or the machine; '' when the folder cannot be written.
 */
function installId(userDataDir) {
    const file = path.join(userDataDir, 'install-id');
    try {
        const id = fs.readFileSync(file, 'utf8').trim();
        if (/^[0-9a-f-]{36}$/.test(id)) return id;
    } catch {
        /* first launch */
    }
    try {
        const id = require('node:crypto').randomUUID();
        fs.mkdirSync(userDataDir, { recursive: true });
        fs.writeFileSync(file, id + '\n');
        return id;
    } catch {
        return '';
    }
}

/** Starts Sentry in the main process; returns false (and loads nothing) when disabled. Call before anything else. */
function init({ app, version, classic, env = process.env }) {
    if (!sentryEnabled(app.isPackaged, env)) return false;
    electronApp = app;
    try {
        let user = '';
        try {
            user = os.userInfo().username;
        } catch {
            /* no user database */
        }
        scrubOpts = { home: os.homedir(), user };
        try {
            Sentry = require('./sentry.cjs'); // the staged bundle (scripts/package-desktop.mjs)
        } catch {
            Sentry = require('@sentry/electron/main');
        }
        const id = installId(app.getPath('userData'));
        Sentry.init({
            dsn: DSN,
            // Optional keys only when set: an explicit `undefined` overrides the SDK's default (no transport -> init throws).
            ...(id ? { initialScope: { user: { id } } } : {}),
            release: 'opendwu@' + version,
            environment: classic ? 'classic' : 'full',
            sendDefaultPii: false,
            // userInfo false also sets the SDK's infer_ip 'never': without it Sentry stores the sender's IP address.
            dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false },
            // Sessions (release health) are the SDK default in the main process and the pages.
            tracesSampleRate: TRACES_SAMPLE_RATE,
            traceLifecycle: 'static', // whole transactions (what reportPerf sends), scrubbed by beforeSendTransaction
            beforeSendTransaction: (tx) => scrubEvent(tx, scrubOpts),
            beforeSend(event, hint) {
                const out = scrubEvent(event, scrubOpts);
                try {
                    const crashLogPath = path.join(electronApp.getPath('userData'), 'crash-log.txt');
                    if (fs.existsSync(crashLogPath) && hint && (out.level === 'fatal' || out.level === 'error')) {
                        const data = scrubLogText(fs.readFileSync(crashLogPath, 'utf8'), scrubOpts);
                        if (data) (hint.attachments = hint.attachments || []).push({ filename: 'crash-log.txt', data, contentType: 'text/plain' });
                    }
                } catch {
                    /* no log */
                }
                if (env.DWU_SENTRY_TEST === '1') console.log(`[sentry] sending event ${out.event_id} ${out.message ?? out.exception?.values?.[0]?.value ?? ''}`);
                return out;
            },
            beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb, scrubOpts),
            ...(env.DWU_SENTRY_TEST === '1' ? { transport: loggingTransport } : {}),
        });
        perfSampled = env.DWU_SENTRY_TEST === '1' || Math.random() < TRACES_SAMPLE_RATE;
        setTags({ os: process.platform, arch: process.arch, edition: classic ? 'classic' : 'full', os_release: os.release() });
        return true;
    } catch (err) {
        Sentry = null;
        console.warn('[sentry] init failed', err && err.message);
        return false;
    }
}

/** Wraps the SDK's default transport to log the HTTP result (DWU_SENTRY_TEST=1 only). */
function loggingTransport(options) {
    const inner = Sentry.makeElectronOfflineTransport()(options);
    return {
        ...inner,
        send: async (envelope) => {
            const res = await inner.send(envelope);
            console.log(`[sentry] transport result ${JSON.stringify(res)}`);
            return res;
        },
    };
}

function setTags(t) {
    Object.assign(tags, t);
    if (Sentry) Sentry.setTags(t);
}

/** A crash-log.txt entry: always a breadcrumb; an event too unless the SDK reports that crash itself. */
function reportCrashLogEntry(text) {
    if (!Sentry) return;
    try {
        const firstLine = scrubLogText(String(text).split('\n')[0], scrubOpts, 300);
        Sentry.addBreadcrumb({ category: 'crash-log', level: 'error', message: firstLine });
        if (isSdkCoveredCrashEntry(text)) return;
        Sentry.withScope((scope) => {
            scope.setTag('source', 'crash-log');
            scope.setExtra('entry', scrubLogText(String(text), scrubOpts, 4000));
            Sentry.captureMessage(firstLine.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, ''), 'error');
        });
    } catch {
        /* never break the game over a report */
    }
}

/** An error the game page reports (dwu:report-error). */
function reportRendererError(info) {
    if (!Sentry || !info || typeof info !== 'object') return;
    try {
        const err = new Error(String(info.message ?? '').slice(0, 500));
        err.name = String(info.name ?? 'Error').slice(0, 60);
        err.stack = String(info.stack ?? '').slice(0, 6000) || undefined;
        Sentry.withScope((scope) => {
            scope.setTag('source', info.kind === 'rejection' ? 'renderer-rejection' : info.kind === 'sim-error' ? 'sim-error' : 'renderer');
            Sentry.captureException(err);
        });
    } catch {
        /* ignore */
    }
}

const num = (v, max = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(-max, v)) : 0);
const str = (v, n = 200) => String(v ?? '').slice(0, n);

/** Whether this session sends the once-a-game-minute performance sample (1 %). */
function isPerfSampled() {
    return !!Sentry && perfSampled;
}

/** One performance measurement event (a transaction with measurements; no per-frame spans). Sampled sessions only. */
function reportPerf(info) {
    if (!Sentry || !perfSampled || !info || typeof info !== 'object') return;
    try {
        const now = Date.now() / 1000;
        const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        const m = (value, unit = 'none') => ({ value: num(value), unit });
        Sentry.captureEvent({
            type: 'transaction',
            transaction: 'game-minute',
            start_timestamp: now - 60,
            timestamp: now,
            contexts: { trace: { trace_id: hex(32), span_id: hex(16), op: 'game.perf', status: 'ok' } },
            tags: { renderer_mode: str(info.renderer, 20), gpu: str(info.gpu, 120) },
            measurements: { avg_fps: m(info.avgFps), p95_frame_ms: m(info.p95FrameMs, 'millisecond'), slowest_sim_tick_ms: m(info.slowestSimMs, 'millisecond'), stars: m(info.stars), empires: m(info.empires) },
        });
    } catch {
        /* ignore */
    }
}

/** A multiplayer desync (one event each): both digests, the frame, the differing sections, players. No save. */
function reportDesync(info) {
    if (!Sentry || !info || typeof info !== 'object') return;
    try {
        const sections = Array.isArray(info.sections) ? info.sections.slice(0, 40).map((x) => str(x, 60)) : [];
        Sentry.withScope((scope) => {
            scope.setTag('source', 'desync');
            scope.setTag('players', str(info.players, 4));
            scope.setExtras({ frame: num(info.frame), lastGoodFrame: num(info.lastGood), hostDigest: str(info.host), clientDigest: str(info.client), sections, deep: !!info.deep, role: str(info.role, 10) });
            scope.setFingerprint(['desync', ...sections.slice(0, 5)]);
            // captureEvent, not captureMessage: a message event gets a stack trace attached and Sentry then titles the
            // issue after its top frame ("AsyncLocalStorage.run"); this keeps the title readable.
            Sentry.captureEvent({ message: `Multiplayer desync${sections.length > 0 ? `: ${sections.slice(0, 3).join(', ')}` : ''}`, level: 'error' });
        });
    } catch {
        /* ignore */
    }
}

/** The page's recent warnings / errors (desktop/main.cjs console-message), for bug reports. */
function noteConsole(line) {
    consoleTail.push(String(line).slice(0, 500));
    if (consoleTail.length > 200) consoleTail.shift();
}

/**
 * "Report a bug" (the player's own button): Sentry user feedback with the game view (JPEG buffer, <= 1280 px), the last
 * ~200 lines of the crash log and console, and the info the page gathers. Resolves { ok, error? }. No save is attached.
 */
async function sendFeedback({ message, screenshot, info }) {
    if (!Sentry) return { ok: false, error: 'Bug reports are sent only from the installed app.' };
    try {
        const text = String(message ?? '').trim().slice(0, 4000);
        if (text === '') return { ok: false, error: 'Please describe what happened.' };
        let log = '';
        try {
            log = fs.readFileSync(path.join(electronApp.getPath('userData'), 'crash-log.txt'), 'utf8').split('\n').slice(-200).join('\n');
        } catch {
            /* no crash log */
        }
        const attachments = [{ filename: 'log.txt', contentType: 'text/plain', data: scrubLogText(`${log}\n--- page warnings / errors ---\n${consoleTail.join('\n')}\n`, scrubOpts, 60000) }];
        if (screenshot && screenshot.length > 0) attachments.push({ filename: 'screenshot.jpg', contentType: 'image/jpeg', data: screenshot });
        const clean = scrubDeep(info && typeof info === 'object' ? info : {}, makeScrubber(scrubOpts.home, scrubOpts.user));
        Sentry.withScope((scope) => {
            scope.setTag('source', 'bug-report');
            scope.setExtras({ gameInfo: JSON.stringify(clean).slice(0, 4000) });
            Sentry.captureFeedback({ message: scrubLogText(text, scrubOpts, 4000) }, { attachments });
        });
        const flushed = await Sentry.flush(8000);
        return flushed ? { ok: true } : { ok: false, error: 'The report could not be sent (no connection?). Try again later.' };
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err).slice(0, 200) };
    }
}

function captureMain(err) {
    if (Sentry) Sentry.captureException(err);
}

function scrubOptions() {
    return scrubOpts;
}

module.exports = { scrubOptions, DSN, installId, TRACES_SAMPLE_RATE, isPerfSampled, reportPerf, reportDesync, noteConsole, sendFeedback, sentryEnabled, makeScrubber, scrubEvent, scrubBreadcrumb, scrubLogText, isSdkCoveredCrashEntry, init, setTags, reportCrashLogEntry, reportRendererError, captureMain };
