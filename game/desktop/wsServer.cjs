// Minimal dependency-free WebSocket server (RFC 6455) for the lockstep host (docs/MULTIPLAYER.md "Lockstep core").
// Node only: node:http upgrade + node:crypto. Text and binary frames, fragmentation, ping/pong, close. No extensions
// (no permessage-deflate), which every client accepts. Each accepted connection is a small object with the standard
// WebSocket shape (readyState, send, close, addEventListener), so src/net/wsTransport.ts wrapSocket takes it as is.
// The desktop host (Electron main process, desktop/netHost.cjs) runs it for LAN games (multiplayer Phase 3); the
// lockstep demo (scripts/lockstep-demo.mjs) loads it through scripts/lib/wsServer.mjs. CommonJS so the packaged shell
// can require it.
//
//   const server = await listenWebSocket({ port: 0, host: '127.0.0.1' }, (socket) => { ... });
//   server.port; server.close();
'use strict';
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3;

/** Default cap on one incoming message (a client sends only inputs, digests and lobby messages: a few kB). */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

class ServerSocket {
    constructor(socket, maxMessageBytes = MAX_MESSAGE_BYTES) {
        this.socket = socket;
        this.maxMessageBytes = maxMessageBytes;
        this.fragBytes = 0;
        this.readyState = OPEN;
        this.listeners = { message: [], close: [], error: [], open: [] };
        this.buf = Buffer.alloc(0);
        this.fragments = null;
        this.fragOpcode = 0;
        socket.setNoDelay(true);
        socket.on('data', (d) => this.onData(d));
        socket.on('close', () => this.finish(1006, 'connection lost'));
        socket.on('error', (err) => { this.emit('error', err); this.finish(1006, String(err?.message ?? err)); });
    }

    addEventListener(type, fn) { this.listeners[type]?.push(fn); }
    emit(type, ev) { for (const fn of this.listeners[type] ?? []) fn(ev); }

    send(data) {
        if (this.readyState !== OPEN) return;
        const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
        this.writeFrame(typeof data === 'string' ? 0x1 : 0x2, payload);
    }

    close(code = 1000, reason = '') {
        if (this.readyState !== OPEN) return;
        this.readyState = CLOSING;
        const r = Buffer.from(String(reason).slice(0, 120), 'utf8');
        const p = Buffer.alloc(2 + r.length);
        p.writeUInt16BE(code, 0);
        r.copy(p, 2);
        this.writeFrame(0x8, p);
        this.socket.end();
        this.finish(code, reason);
    }

    writeFrame(opcode, payload) {
        const len = payload.length;
        let head;
        if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
        else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
        else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
        head[0] = 0x80 | opcode; // FIN + opcode; server frames are not masked
        this.socket.write(Buffer.concat([head, payload]));
    }

    onData(d) {
        this.buf = this.buf.length === 0 ? d : Buffer.concat([this.buf, d]);
        for (;;) {
            const b = this.buf;
            if (b.length < 2) return;
            const fin = (b[0] & 0x80) !== 0, opcode = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
            let len = b[1] & 0x7f, off = 2;
            if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
            else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
            if (len > this.maxMessageBytes) { this.close(1009, 'message too big'); return; }
            const maskOff = off;
            if (masked) off += 4;
            if (b.length < off + len) return;
            let payload = b.subarray(off, off + len);
            if (masked) {
                const m = b.subarray(maskOff, maskOff + 4);
                payload = Buffer.from(payload);
                for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3];
            }
            this.buf = b.subarray(off + len);
            this.onFrame(fin, opcode, payload);
            if (this.readyState === CLOSED) return;
        }
    }

    onFrame(fin, opcode, payload) {
        if (opcode === 0x8) { // close
            const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
            const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
            if (this.readyState === OPEN) { this.readyState = CLOSING; this.writeFrame(0x8, payload.subarray(0, 2)); this.socket.end(); }
            this.finish(code, reason);
            return;
        }
        if (opcode === 0x9) { this.writeFrame(0xA, payload); return; } // ping → pong
        if (opcode === 0xA) return; // pong
        if (opcode === 0x0) { // continuation
            if (this.fragments === null) return;
            this.fragments.push(payload);
            this.fragBytes += payload.length;
            if (this.fragBytes > this.maxMessageBytes) { this.close(1009, 'message too big'); return; }
            if (fin) { const all = Buffer.concat(this.fragments); this.fragments = null; this.deliver(this.fragOpcode, all); }
            return;
        }
        if (!fin) { this.fragments = [payload]; this.fragBytes = payload.length; this.fragOpcode = opcode; return; }
        this.deliver(opcode, payload);
    }

    deliver(opcode, payload) {
        this.emit('message', { data: opcode === 0x1 ? payload.toString('utf8') : payload });
    }

    finish(code, reason) {
        if (this.readyState === CLOSED) return;
        this.readyState = CLOSED;
        this.emit('close', { code, reason });
    }
}

/**
 * Listen for WebSocket connections; `onSocket(socket, request)` gets each accepted one. Resolves with { port, close }.
 * `maxMessageBytes`: an incoming message over this closes the connection (1009).
 */
function listenWebSocket({ port = 0, host = '127.0.0.1', maxMessageBytes = MAX_MESSAGE_BYTES } = {}, onSocket) {
    const sockets = new Set();
    const server = createServer((_req, res) => { res.writeHead(426, { 'content-type': 'text/plain' }); res.end('WebSocket only'); });
    server.on('upgrade', (req, socket) => {
        const key = req.headers['sec-websocket-key'];
        if (typeof key !== 'string' || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
        const accept = createHash('sha1').update(key + GUID).digest('base64');
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
        const ws = new ServerSocket(socket, maxMessageBytes);
        sockets.add(ws);
        ws.addEventListener('close', () => sockets.delete(ws));
        onSocket(ws, req);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            resolve({
                port: server.address().port,
                close() { for (const s of sockets) s.close(1001, 'server closing'); server.close(); },
            });
        });
    });
}

module.exports = { listenWebSocket, CONNECTING, OPEN, CLOSING, CLOSED };
