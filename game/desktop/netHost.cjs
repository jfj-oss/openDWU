// LAN multiplayer networking for the game window (multiplayer Phase 3, docs/MULTIPLAYER.md §10). Node APIs stay here,
// in the main process; the game page (src/net/netBridge.ts) gets each connection as a MessagePort.
//
// - host(port): a WebSocket server (wsServer.cjs) on every interface. Each accepted connection is bridged to a new
//   MessageChannelMain; one end goes to the page ('dwu:net-link', kind 'incoming').
// - connect(url): a client WebSocket (Node's global WebSocket) to another player's host, bridged the same way (kind
//   'outgoing'). The page could open ws:// itself, but its dwu:// origin is a secure context, and Chromium blocks
//   ws:// to a LAN address from one (mixed content); the main process has no such rule.
// - addresses(): this machine's non-internal IPv4 / IPv6 addresses, for the Host screen ("tell the others").
// - mapPort(): while hosting, ask the router to forward the game port (UPnP IGD or NAT-PMP, portMapper.cjs; the host
//   screen's "Open the port on my router" box, off by default). The mapping goes when hosting stops.
//
// Internet play over WebRTC (src/net/rtcTransport.ts) needs nothing here: the data channels live in the page.
//
// On a port, the page and this file exchange { t: 'm', d: <text> } (one message) and { t: 'c', r: <reason> } (closed).
// The page going away (reload, window closed) closes its port's remote end: the socket is closed then.
'use strict';
const os = require('node:os');
const { listenWebSocket } = require('./wsServer.cjs');
const { createPortMapper } = require('./portMapper.cjs');

/**
 * @param {{ MessageChannelMain: any, ipcMain: any, isGameWindow: (sender: any) => boolean }} deps
 */
function createNetHost(deps) {
    const { MessageChannelMain, ipcMain, isGameWindow } = deps;
    let server = null; // { port, close }
    let serverOwner = null;
    let nextId = 1;
    const links = new Map(); // id -> { close(reason) }
    const mapper = createPortMapper((line) => console.log(line));

    /** Bridge `socket` (WebSocket-shaped: send, close, addEventListener) to a new port handed to `sender`. */
    function bridge(sender, socket, kind, remote) {
        const id = nextId++;
        const { port1, port2 } = new MessageChannelMain();
        let open = true;
        const finish = (reason, fromSocket) => {
            if (!open) return;
            open = false;
            links.delete(id);
            if (fromSocket) {
                try {
                    port1.postMessage({ t: 'c', r: String(reason) });
                } catch {
                    /* the page is gone */
                }
            } else {
                try {
                    socket.close(1000, String(reason).slice(0, 120));
                } catch {
                    /* already closing */
                }
            }
            try {
                port1.close();
            } catch {
                /* closed */
            }
        };
        port1.on('message', (e) => {
            const m = e.data;
            if (!m || typeof m !== 'object') return;
            if (m.t === 'm' && typeof m.d === 'string') {
                if (open) socket.send(m.d);
            } else if (m.t === 'c') finish(typeof m.r === 'string' ? m.r : 'closed', false);
        });
        port1.on('close', () => finish('the game page closed the link', false));
        port1.start();
        socket.addEventListener('message', (ev) => {
            if (!open) return;
            const d = ev.data;
            port1.postMessage({ t: 'm', d: typeof d === 'string' ? d : Buffer.isBuffer(d) ? d.toString('utf8') : String(d) });
        });
        socket.addEventListener('close', (ev) => finish(ev && ev.reason ? ev.reason : `socket closed (${ev && ev.code !== undefined ? ev.code : '?'})`, true));
        socket.addEventListener('error', () => finish('socket error', true));
        links.set(id, { close: (reason) => finish(reason, false) });
        sender.postMessage('dwu:net-link', { id, kind, remote: String(remote ?? '') }, [port2]);
        return id;
    }

    function addresses() {
        const out = [];
        for (const [name, list] of Object.entries(os.networkInterfaces())) {
            for (const a of list ?? []) {
                if (a.internal) continue;
                // Link-local IPv6 (fe80::) needs a zone id to dial; leave it out.
                if (a.family === 'IPv6' && /^fe80:/i.test(a.address)) continue;
                out.push({ name, address: a.address, family: a.family });
            }
        }
        // IPv4 first (what people type).
        out.sort((x, y) => (x.family === y.family ? 0 : x.family === 'IPv4' ? -1 : 1));
        return out;
    }

    async function stopHost() {
        await mapper.unmap();
        if (server === null) return;
        const s = server;
        server = null;
        serverOwner = null;
        s.close();
    }

    ipcMain.handle('dwu:net-addresses', (event) => (isGameWindow(event.sender) ? addresses() : []));

    ipcMain.handle('dwu:net-host', async (event, opts) => {
        if (!isGameWindow(event.sender)) throw new Error('not the game window');
        const port = Number(opts && opts.port);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`not a port: ${opts && opts.port}`);
        await stopHost();
        const sender = event.sender;
        try {
            server = await listenWebSocket({ port, host: '0.0.0.0' }, (socket, req) => {
                bridge(sender, socket, 'incoming', req && req.socket ? `${req.socket.remoteAddress}:${req.socket.remotePort}` : '');
            });
        } catch (err) {
            server = null;
            const code = err && err.code;
            if (code === 'EADDRINUSE') throw new Error(`port ${port} is already in use (another game or program is listening on it)`);
            if (code === 'EACCES') throw new Error(`port ${port} needs administrator rights; pick one above 1024`);
            throw new Error(String(err && err.message ? err.message : err));
        }
        serverOwner = sender;
        sender.once('destroyed', () => {
            if (serverOwner === sender) void stopHost();
        });
        console.log(`[net] hosting on port ${server.port}`);
        return { port: server.port, addresses: addresses() };
    });

    ipcMain.handle('dwu:net-stop-host', async (event) => {
        if (!isGameWindow(event.sender)) return;
        await stopHost();
    });

    ipcMain.handle('dwu:net-map-port', async (event) => {
        if (!isGameWindow(event.sender)) throw new Error('not the game window');
        if (server === null) throw new Error('not hosting');
        return mapper.map(server.port);
    });

    ipcMain.handle('dwu:net-connect', (event, url) => {
        if (!isGameWindow(event.sender)) throw new Error('not the game window');
        const target = String(url);
        if (!/^wss?:\/\//.test(target)) throw new Error(`not a ws:// address: ${target}`);
        const Ctor = globalThis.WebSocket;
        if (typeof Ctor !== 'function') throw new Error('this Electron has no WebSocket client');
        const sender = event.sender;
        return new Promise((resolve, reject) => {
            let ws;
            try {
                ws = new Ctor(target);
            } catch (err) {
                reject(new Error(`cannot connect to ${target}: ${err && err.message ? err.message : err}`));
                return;
            }
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                try {
                    ws.close();
                } catch {
                    /* never opened */
                }
                reject(new Error(`no answer from ${target} (is the host running, and the port open in its firewall?)`));
            }, 10000);
            ws.addEventListener('open', () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(bridge(sender, ws, 'outgoing', target));
            });
            ws.addEventListener('error', () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(new Error(`cannot connect to ${target} (no game is hosted there, or a firewall blocks it)`));
            });
        });
    });

    return {
        addresses,
        stopHost,
        mappingActive: () => mapper.active,
        closeAll(reason = 'app closing') {
            for (const l of [...links.values()]) l.close(reason);
            return stopHost();
        },
    };
}

module.exports = { createNetHost };
