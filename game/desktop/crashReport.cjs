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

/** beforeSend: no IP / user / host name / cookies / headers; every string scrubbed of the home folder and user name. */
function scrubEvent(event, opts) {
    const scrub = makeScrubber(opts.home, opts.user);
    const e = scrubDeep(event, scrub);
    e.user = undefined;
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
const tags = {};

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
        Sentry.init({
            dsn: DSN,
            release: 'opendwu@' + version,
            environment: classic ? 'classic' : 'full',
            sendDefaultPii: false,
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
            transport: env.DWU_SENTRY_TEST === '1' ? loggingTransport : undefined,
        });
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
            scope.setTag('source', info.kind === 'rejection' ? 'renderer-rejection' : 'renderer');
            Sentry.captureException(err);
        });
    } catch {
        /* ignore */
    }
}

function captureMain(err) {
    if (Sentry) Sentry.captureException(err);
}

module.exports = { DSN, sentryEnabled, makeScrubber, scrubEvent, scrubBreadcrumb, scrubLogText, isSdkCoveredCrashEntry, init, setTags, reportCrashLogEntry, reportRendererError, captureMain };
