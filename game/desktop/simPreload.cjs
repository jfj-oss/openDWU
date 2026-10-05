// Preload for the sim process window (desktop/simProcess.cjs, sim.html, src/simworker/simProcessPage.ts): hands the
// page its end of the channel to the game page, and reports an uncaught error in its worker. No Node APIs reach the
// page.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('dwu-sim:port', (event) => {
    if (event.ports.length === 1) window.postMessage({ dwuSimPort: true }, '*', event.ports);
});

contextBridge.exposeInMainWorld('dwuSim', {
    ready: () => ipcRenderer.send('dwu-sim:ready'),
    workerError: (message) => ipcRenderer.send('dwu-sim:worker-error', String(message)),
});
