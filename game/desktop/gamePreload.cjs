// Preload for the game window: the shell calls the game makes. No Node APIs reach the page.
// - checkForUpdates: the main menu's Check for Updates runs the same check as the shell menu's "Check for Updates…",
//   with its dialogs.
// - simProcess: the game's simulation in a process of its own (desktop/simProcess.cjs, src/simworker/simEndpoint.ts).
//   `start()` resolves the sim's id; its MessagePort then arrives as a window message `{ dwuSimPort: id }` (a port
//   cannot cross the context bridge; window.postMessage is Electron's documented way to hand one to the page).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const exitListeners = [];
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

contextBridge.exposeInMainWorld('dwuDesktop', {
    checkForUpdates: () => ipcRenderer.invoke('dwu:check-updates'),
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
