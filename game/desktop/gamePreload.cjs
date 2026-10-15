// Preload for the game window: the shell calls the game makes. No Node APIs reach the page.
// - fullscreen: Game Options' Fullscreen checkbox (get / set / onChange); reportRenderer: the renderer for the log.
// - checkForUpdates: the main menu's Check for Updates runs the same check as the shell menu's "Check for Updates…",
//   with its dialogs.
// - simProcess: the game's simulation in a process of its own (desktop/simProcess.cjs, src/simworker/simEndpoint.ts).
//   `start()` resolves the sim's id; its MessagePort then arrives as a window message `{ dwuSimPort: id }` (a port
//   cannot cross the context bridge; window.postMessage is Electron's documented way to hand one to the page).
// - net: LAN multiplayer (and the router port mapping of Internet hosting) (desktop/netHost.cjs, src/net/netBridge.ts). host / connect resolve; each connection's
//   MessagePort then arrives as a window message `{ dwuNetLink: id, kind, remote }`.
// - openMusicFolder: Options → Music & Mood's "Open Music Folder" (the listing and files are dwu://app/user-music/…).
// - devHooks: the app was started with DWU_DEV_HOOKS=1 (scripts drive multiplayer games through the debug hooks).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const exitListeners = [];
const fullscreenListeners = [];
ipcRenderer.on('dwu:fullscreen-changed', (_event, on) => {
    for (const cb of fullscreenListeners) cb(on === true);
});
const errorListeners = [];
ipcRenderer.on('dwu:sim-port', (event, msg) => {
    if (msg && typeof msg.id === 'number' && event.ports.length === 1) window.postMessage({ dwuSimPort: msg.id }, '*', event.ports);
});
ipcRenderer.on('dwu:sim-exit', (_event, msg) => {
    for (const cb of exitListeners) cb(msg.id, String(msg.reason));
});
ipcRenderer.on('dwu:sim-error', (_event, msg) => {
    for (const cb of errorListeners) cb(msg.id, String(msg.message));
});

ipcRenderer.on('dwu:net-link', (event, msg) => {
    if (msg && typeof msg.id === 'number' && event.ports.length === 1) window.postMessage({ dwuNetLink: msg.id, kind: String(msg.kind), remote: String(msg.remote) }, '*', event.ports);
});

contextBridge.exposeInMainWorld('dwuDesktop', {
    // Started with DWU_DEV_HOOKS=1 (desktop/main.cjs): the multiplayer debug hooks are on (src/ui/multiplayer/devHooks.ts).
    devHooks: Array.isArray(process.argv) && process.argv.includes('--dwu-dev-hooks'),
    net: {
        host: (port) => ipcRenderer.invoke('dwu:net-host', { port: Number(port) }),
        stopHost: () => ipcRenderer.invoke('dwu:net-stop-host'),
        connect: (url) => ipcRenderer.invoke('dwu:net-connect', String(url)),
        addresses: () => ipcRenderer.invoke('dwu:net-addresses'),
        mapPort: () => ipcRenderer.invoke('dwu:net-map-port'),
    },
    checkForUpdates: () => ipcRenderer.invoke('dwu:check-updates'),
    // Game Options → Fullscreen (desktop/displayMode.cjs; F11 / Alt+Enter toggle it too; remembered in config.json).
    fullscreen: {
        get: () => ipcRenderer.invoke('dwu:fullscreen-get'),
        set: (on) => ipcRenderer.invoke('dwu:fullscreen-set', on === true),
        onChange: (cb) => {
            if (typeof cb === 'function') fullscreenListeners.push(cb);
        },
    },
    // The page's renderer for the log (Pixi renderer name, WebGL renderer string).
    reportRenderer: (info) => ipcRenderer.send('dwu:report-renderer', { renderer: String(info?.renderer ?? ''), webgl: String(info?.webgl ?? ''), gpu: String(info?.gpu ?? '') }),
    // Options → Music & Mood: open the user-data Music folder (desktop/userMusic.cjs) in the file manager.
    openMusicFolder: () => ipcRenderer.invoke('dwu:open-music-folder'),
    simProcess: {
        start: () => ipcRenderer.invoke('dwu:sim-start'),
        terminate: (id) => ipcRenderer.send('dwu:sim-terminate', Number(id)),
        onExit: (cb) => {
            if (typeof cb === 'function') exitListeners.push(cb);
        },
        onError: (cb) => {
            if (typeof cb === 'function') errorListeners.push(cb);
        },
    },
});
