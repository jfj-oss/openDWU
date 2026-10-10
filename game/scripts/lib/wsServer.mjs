// The lockstep host's WebSocket server lives in desktop/wsServer.cjs (the Electron main process runs it for LAN games);
// this re-exports it for the Node scripts (scripts/lockstep-demo.mjs).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ws = require('../../desktop/wsServer.cjs');

export const { listenWebSocket, CONNECTING, OPEN, CLOSING, CLOSED } = ws;
