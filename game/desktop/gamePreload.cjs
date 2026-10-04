// Preload for the game window: the one shell call the game makes (the main menu's Check for Updates runs the same
// check as the shell menu's "Check for Updates…", with its dialogs). No Node APIs reach the page.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dwuDesktop', {
    checkForUpdates: () => ipcRenderer.invoke('dwu:check-updates'),
});
