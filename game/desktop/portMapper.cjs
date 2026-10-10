// Automatic port mapping on the host's router (multiplayer Internet play, docs/MULTIPLAYER.md §15, fallback (b)): when
// the players' routers block a direct WebRTC connection, the host can ask its own router to forward the LAN game port
// (the WebSocket server of netHost.cjs, TCP) and tell the others its public address. Off by default (a box on the host
// screen). Minimal, dependency-free implementations of the two common protocols:
//
// - UPnP IGD: SSDP M-SEARCH (UDP multicast 239.255.255.250:1900) finds the router's description URL; its
//   WANIPConnection / WANPPPConnection control URL takes SOAP AddPortMapping / GetExternalIPAddress /
//   DeletePortMapping.
// - NAT-PMP (RFC 6886; PCP routers answer it too): UDP 5351 on the default gateway.
//
// The mapping is removed when hosting stops (netHost.cjs stopHost / closeAll); a lease (1 hour, renewed every 20
// minutes) makes a router drop it by itself if the app dies without removing it.
'use strict';
const dgram = require('node:dgram');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const LEASE_S = 3600;
const RENEW_MS = 20 * 60_000;
const DESCRIPTION = 'openDWU multiplayer';

function withTimeout(promise, ms, what) {
    let t;
    return Promise.race([promise, new Promise((_, reject) => (t = setTimeout(() => reject(new Error(`${what}: no answer`)), ms)))]).finally(() => clearTimeout(t));
}

/** The local address the OS would use to reach `host` (no packet is sent). */
function localAddressFor(host) {
    return new Promise((resolve, reject) => {
        const s = dgram.createSocket('udp4');
        s.on('error', (e) => {
            s.close();
            reject(e);
        });
        s.connect(9, host, () => {
            const a = s.address().address;
            s.close();
            resolve(a);
        });
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// UPnP IGD
// ---------------------------------------------------------------------------------------------------------------------

const SEARCH_TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];

/** SSDP: the LOCATION URLs of the gateways that answer within `ms`. */
function ssdpSearch(ms = 2500) {
    return new Promise((resolve) => {
        const found = new Map(); // location -> source address
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const finish = () => {
            try {
                s.close();
            } catch {
                /* closed */
            }
            resolve([...found.entries()].map(([location, from]) => ({ location, from })));
        };
        s.on('error', finish);
        s.on('message', (msg, rinfo) => {
            const text = msg.toString('utf8');
            const m = /^location:\s*(\S+)/im.exec(text);
            if (m && /^http:\/\//i.test(m[1]) && !found.has(m[1])) found.set(m[1], rinfo.address);
        });
        s.bind(0, () => {
            for (const st of SEARCH_TARGETS) {
                const q = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`;
                for (let k = 0; k < 2; k++) setTimeout(() => s.send(q, 1900, '239.255.255.250', () => undefined), k * 400);
            }
            setTimeout(finish, ms);
        });
    });
}

async function fetchText(url, init, ms = 4000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
        const r = await fetch(url, { ...init, signal: ctl.signal });
        const text = await r.text();
        return { status: r.status, text };
    } finally {
        clearTimeout(t);
    }
}

/** The WAN connection service of a gateway description: { controlUrl, serviceType } or null. */
async function igdService(location) {
    const { text } = await fetchText(location);
    const base = (/<URLBase>\s*([^<\s]+)\s*<\/URLBase>/i.exec(text) || [])[1] || location;
    for (const block of text.match(/<service>[\s\S]*?<\/service>/gi) || []) {
        const type = (/<serviceType>\s*([^<\s]+)\s*<\/serviceType>/i.exec(block) || [])[1] || '';
        if (!/WAN(IP|PPP)Connection:\d/.test(type)) continue;
        const ctl = (/<controlURL>\s*([^<\s]+)\s*<\/controlURL>/i.exec(block) || [])[1];
        if (!ctl) continue;
        return { controlUrl: new URL(ctl, base).href, serviceType: type };
    }
    return null;
}

function xmlEscape(s) {
    return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

async function soap(service, action, args) {
    const body = `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service.serviceType}">${Object.entries(args)
        .map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`)
        .join('')}</u:${action}></s:Body></s:Envelope>\r\n`;
    const { status, text } = await fetchText(service.controlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${service.serviceType}#${action}"` },
        body,
    });
    if (status !== 200) {
        const code = (/<errorCode>\s*(\d+)\s*<\/errorCode>/i.exec(text) || [])[1];
        const desc = (/<errorDescription>\s*([^<]*)<\/errorDescription>/i.exec(text) || [])[1];
        const err = new Error(`UPnP ${action} refused${code ? ` (${code}${desc ? ` ${desc}` : ''})` : ` (HTTP ${status})`}`);
        err.upnpCode = code ? Number(code) : 0;
        throw err;
    }
    return text;
}

async function upnpMap(port) {
    const gateways = await ssdpSearch();
    if (gateways.length === 0) throw new Error('no UPnP router answered');
    let lastErr = null;
    for (const g of gateways) {
        try {
            const service = await igdService(g.location);
            if (service === null) continue;
            const host = new URL(service.controlUrl).hostname;
            const internal = await localAddressFor(host);
            const add = async (lease) =>
                soap(service, 'AddPortMapping', {
                    NewRemoteHost: '',
                    NewExternalPort: port,
                    NewProtocol: 'TCP',
                    NewInternalPort: port,
                    NewInternalClient: internal,
                    NewEnabled: 1,
                    NewPortMappingDescription: DESCRIPTION,
                    NewLeaseDuration: lease,
                });
            let lease = LEASE_S;
            try {
                await add(lease);
            } catch (err) {
                if (err.upnpCode !== 725) throw err; // 725 OnlyPermanentLeasesSupported
                lease = 0;
                await add(0);
            }
            let externalIp = '';
            try {
                const t = await soap(service, 'GetExternalIPAddress', {});
                externalIp = (/<NewExternalIPAddress>\s*([^<\s]*)\s*<\/NewExternalIPAddress>/i.exec(t) || [])[1] || '';
            } catch {
                /* unknown */
            }
            return {
                method: 'UPnP',
                externalIp,
                externalPort: port,
                internal,
                renew: lease > 0 ? () => add(lease) : null,
                remove: () => soap(service, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' }),
            };
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error('the UPnP router has no WAN connection service');
}

// ---------------------------------------------------------------------------------------------------------------------
// NAT-PMP
// ---------------------------------------------------------------------------------------------------------------------

/** The IPv4 default gateway (Linux /proc, macOS / BSD route, Windows route print), or null. */
function defaultGateway() {
    return new Promise((resolve) => {
        if (process.platform === 'linux') {
            try {
                for (const line of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
                    const f = line.trim().split(/\s+/);
                    if (f.length > 2 && f[1] === '00000000' && f[2] !== '00000000') {
                        const n = parseInt(f[2], 16);
                        return resolve([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255].join('.'));
                    }
                }
            } catch {
                /* no /proc */
            }
            return resolve(null);
        }
        if (process.platform === 'win32') {
            execFile('route', ['print', '-4', '0.0.0.0'], { timeout: 3000, windowsHide: true }, (err, out) => {
                const m = !err && /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/m.exec(String(out));
                resolve(m ? m[1] : null);
            });
            return;
        }
        execFile('route', ['-n', 'get', 'default'], { timeout: 3000 }, (err, out) => {
            const m = !err && /gateway:\s*(\d+\.\d+\.\d+\.\d+)/.exec(String(out));
            resolve(m ? m[1] : null);
        });
    });
}

/** One NAT-PMP request; resolves with the response, retried at 250 ms, 500 ms, 1 s. */
function natPmpRequest(gateway, req, expectOp) {
    return new Promise((resolve, reject) => {
        const s = dgram.createSocket('udp4');
        let tries = 0;
        let timer = null;
        const done = (err, res) => {
            clearTimeout(timer);
            try {
                s.close();
            } catch {
                /* closed */
            }
            if (err) reject(err);
            else resolve(res);
        };
        s.on('error', (e) => done(e));
        s.on('message', (msg, rinfo) => {
            if (rinfo.address !== gateway || msg.length < 8 || msg[0] !== 0 || msg[1] !== expectOp) return;
            const result = msg.readUInt16BE(2);
            if (result !== 0) return done(new Error(`NAT-PMP refused (result ${result})`));
            done(null, msg);
        });
        const send = () => {
            if (tries++ >= 4) return done(new Error('no NAT-PMP router answered'));
            s.send(req, 5351, gateway, () => undefined);
            timer = setTimeout(send, 250 * 2 ** (tries - 1));
        };
        s.bind(0, send);
    });
}

async function natPmpMap(port) {
    const gateway = await defaultGateway();
    if (gateway === null) throw new Error('no default gateway found');
    const map = (lifetime) => {
        const req = Buffer.alloc(12);
        req[0] = 0;
        req[1] = 2; // TCP
        req.writeUInt16BE(port, 4);
        req.writeUInt16BE(lifetime === 0 ? 0 : port, 6);
        req.writeUInt32BE(lifetime, 8);
        return natPmpRequest(gateway, req, 130);
    };
    const res = await map(LEASE_S);
    const externalPort = res.readUInt16BE(10);
    let externalIp = '';
    try {
        const a = await natPmpRequest(gateway, Buffer.from([0, 0]), 128);
        externalIp = `${a[8]}.${a[9]}.${a[10]}.${a[11]}`;
    } catch {
        /* unknown */
    }
    return { method: 'NAT-PMP', externalIp, externalPort, internal: await localAddressFor(gateway), renew: () => map(LEASE_S), remove: () => map(0) };
}

// ---------------------------------------------------------------------------------------------------------------------

/** Whether `ip` is a public IPv4 address (not private, CGNAT, loopback or link-local). */
function isPublicIPv4(ip) {
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip || '');
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 172 && b >= 16 && b < 32) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b < 128) return false; // carrier-grade NAT
    return true;
}

/**
 * The host's port mapper: map(port) tries UPnP, then NAT-PMP; unmap() removes the mapping. One mapping at a time.
 * `log` gets one line per step.
 */
function createPortMapper(log = () => undefined) {
    let current = null; // { port, mapping, timer }

    async function unmap() {
        const c = current;
        current = null;
        if (c === null) return;
        clearInterval(c.timer);
        try {
            await withTimeout(c.mapping.remove(), 4000, 'removing the mapping');
            log(`[net] removed the ${c.mapping.method} mapping of port ${c.port}`);
        } catch (err) {
            log(`[net] could not remove the ${c.mapping.method} mapping of port ${c.port}: ${err && err.message ? err.message : err} (it expires by itself within an hour)`);
        }
    }

    async function map(port) {
        await unmap();
        const errors = [];
        for (const [name, fn] of [
            ['UPnP', upnpMap],
            ['NAT-PMP', natPmpMap],
        ]) {
            try {
                const mapping = await withTimeout(fn(port), 9000, name);
                const timer = mapping.renew !== null ? setInterval(() => void mapping.renew().catch((e) => log(`[net] renewing the port mapping failed: ${e.message}`)), RENEW_MS) : null;
                current = { port, mapping, timer };
                const pub = isPublicIPv4(mapping.externalIp);
                log(`[net] ${mapping.method} mapped TCP port ${mapping.externalPort} -> ${mapping.internal}:${port} (router's address ${mapping.externalIp || 'unknown'})`);
                return {
                    ok: true,
                    method: mapping.method,
                    externalIp: mapping.externalIp,
                    externalPort: mapping.externalPort,
                    publicAddress: pub,
                    note: mapping.externalIp === ''
                        ? 'The router did not say its public address: look it up (e.g. a "what is my IP" site).'
                        : pub
                          ? ''
                          : `The router's own address ${mapping.externalIp} is not a public Internet address (your provider shares one between customers: carrier-grade NAT), so the mapping does not make this PC reachable from the Internet.`,
                };
            } catch (err) {
                errors.push(`${name}: ${err && err.message ? err.message : err}`);
            }
        }
        log(`[net] port mapping failed: ${errors.join('; ')}`);
        return { ok: false, error: errors.join('; ') };
    }

    return { map, unmap, get active() { return current !== null; } };
}

module.exports = { createPortMapper, isPublicIPv4 };
