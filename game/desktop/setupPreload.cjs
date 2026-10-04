// Preload of the setup window (desktop/setup.html): the few main-process calls the page may make, nothing else.
// Runs sandboxed with contextIsolation; the game window has no preload at all.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dwuSetup', {
    /** { mode: 'first-run' | 'change', platform, current, previous, searched, version, menuHint, home } */
    info: () => ipcRenderer.invoke('dwu-setup:info'),
    /** Native folder picker; resolves the chosen path or null. */
    browse: (start) => ipcRenderer.invoke('dwu-setup:browse', String(start ?? '')),
    /** { ok: true, dir } | { ok: false, problem } without saving anything. */
    check: (dir) => ipcRenderer.invoke('dwu-setup:check', String(dir ?? '')),
    /** Validate, save and use the folder (closes the window on success). */
    use: (dir) => ipcRenderer.invoke('dwu-setup:use', String(dir ?? '')),
    /** First run: continue without the game files. Change mode: cancel. */
    skip: () => ipcRenderer.invoke('dwu-setup:skip'),
    /** First run: quit. Change mode: cancel. */
    quit: () => ipcRenderer.invoke('dwu-setup:quit'),
});
