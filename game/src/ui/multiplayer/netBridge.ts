// Where LAN connections come from (multiplayer Phase 3, docs/MULTIPLAYER.md §10).
//
// - Desktop app: the main process hosts and dials (desktop/netHost.cjs through gamePreload.cjs `dwuDesktop.net`); each
//   connection reaches this page as a MessagePort (a window message `{ dwuNetLink: id }`), wrapped as a Link
//   (net/portTransport.ts).
// - Browser / dev build: no server can listen in a page, so hosting is unavailable; joining opens a WebSocket here
//   (net/wsTransport.ts).
// - Internet play (WebRTC, net/rtcTransport.ts, internetUi.ts) needs neither: its links are made in this page and
//   handed to `onIncoming` like an accepted LAN connection.

import type { Link } from '../../net/transport';
import { wrapPort, type PortLike } from '../../net/portTransport';
import { connectWebSocket } from '../../net/wsTransport';

/** The default LAN port (any free port works; the host screen lets the host pick one). */
export const DEFAULT_MULTIPLAYER_PORT = 47610;

export interface NetAddress {
    name: string;
    address: string;
    family: string;
}

export interface NetEndpoint {
    /** Whether this build can host (the desktop app). */
    readonly canHost: boolean;
    /** Listen on `port` (0: any free one). Resolves with the port and this machine's addresses. */
    host(port: number): Promise<{ port: number; addresses: NetAddress[] }>;
    stopHost(): Promise<void>;
    /** Each incoming connection while hosting. */
    onIncoming: ((link: Link, remote: string) => void) | null;
    /** Connect to a host (`address`: "ip", "ip:port", "[v6]:port"). */
    connect(address: string): Promise<Link>;
    /** While hosting: ask the router to forward the port (UPnP / NAT-PMP; desktop only). Removed by stopHost. */
    mapPort(): Promise<PortMapping>;
}

/** desktop/portMapper.cjs map(): the router forwards the host's port (or why not). */
export type PortMapping =
    | { ok: true; method: string; externalIp: string; externalPort: number; publicAddress: boolean; note: string }
    | { ok: false; error: string };

interface DesktopNet {
    host(port: number): Promise<{ port: number; addresses: NetAddress[] }>;
    stopHost(): Promise<void>;
    connect(url: string): Promise<number>;
    addresses(): Promise<NetAddress[]>;
    mapPort?(): Promise<PortMapping>;
}

/** "192.168.1.5:47610" / "192.168.1.5" / "[fe80::1]:5000" / "ws://x:1" -> ws:// URL. Throws on nonsense. */
export function hostAddressToUrl(address: string, defaultPort = DEFAULT_MULTIPLAYER_PORT): string {
    const a = address.trim();
    if (a === '') throw new Error('enter the host\'s address (IP:port)');
    if (/^wss?:\/\//i.test(a)) return a;
    let host: string;
    let port: number = defaultPort;
    const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(a);
    if (v6 !== null) {
        host = `[${v6[1]}]`;
        if (v6[2] !== undefined) port = Number(v6[2]);
    } else if ((a.match(/:/g) ?? []).length > 1) {
        host = `[${a}]`; // a bare IPv6 address
    } else {
        const m = /^([^:\s/]+)(?::(\d+))?$/.exec(a);
        if (m === null) throw new Error(`not an address: ${a} (use IP:port, e.g. 192.168.1.20:${defaultPort})`);
        host = m[1];
        if (m[2] !== undefined) port = Number(m[2]);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`not a port: ${port}`);
    return `ws://${host}:${port}`;
}

function desktopNet(): DesktopNet | null {
    const d = (window as unknown as { dwuDesktop?: { net?: DesktopNet } }).dwuDesktop;
    return d?.net ?? null;
}

let endpoint: NetEndpoint | null = null;

/** The page's one endpoint (created on first use). */
export function netEndpoint(): NetEndpoint {
    if (endpoint !== null) return endpoint;
    const net = desktopNet();
    endpoint = net !== null ? createDesktopEndpoint(net) : createBrowserEndpoint();
    return endpoint;
}

function createDesktopEndpoint(net: DesktopNet): NetEndpoint {
    // Ports may arrive before or after connect()'s promise resolves with their id.
    const arrived = new Map<number, { port: PortLike; kind: string; remote: string }>();
    const waiting = new Map<number, (port: PortLike) => void>();
    const ep: NetEndpoint = {
        canHost: true,
        host: (port) => net.host(port),
        stopHost: () => net.stopHost(),
        mapPort: () => (net.mapPort !== undefined ? net.mapPort() : Promise.resolve({ ok: false as const, error: 'this app version cannot map ports' })),
        onIncoming: null,
        async connect(address) {
            const id = await net.connect(hostAddressToUrl(address));
            const got = arrived.get(id);
            if (got !== undefined) {
                arrived.delete(id);
                return wrapPort(got.port);
            }
            return await new Promise<Link>((resolve) => waiting.set(id, (port) => resolve(wrapPort(port))));
        },
    };
    window.addEventListener('message', (ev: MessageEvent) => {
        const d = ev.data as { dwuNetLink?: unknown; kind?: unknown; remote?: unknown } | null;
        if (d === null || typeof d !== 'object' || typeof d.dwuNetLink !== 'number' || ev.ports.length !== 1) return;
        const id = d.dwuNetLink;
        const port = ev.ports[0] as unknown as PortLike;
        const kind = String(d.kind);
        const remote = String(d.remote ?? '');
        if (kind === 'incoming') {
            if (ep.onIncoming !== null) ep.onIncoming(wrapPort(port), remote);
            else port.close(); // not hosting any more
            return;
        }
        const w = waiting.get(id);
        if (w !== undefined) {
            waiting.delete(id);
            w(port);
        } else arrived.set(id, { port, kind, remote });
    });
    return ep;
}

function createBrowserEndpoint(): NetEndpoint {
    return {
        canHost: false,
        host: () => Promise.reject(new Error('Hosting needs the desktop app (a browser page cannot accept connections). Join a host instead.')),
        stopHost: () => Promise.resolve(),
        mapPort: () => Promise.resolve({ ok: false as const, error: 'port mapping needs the desktop app' }),
        onIncoming: null,
        connect: (address) => connectWebSocket(hostAddressToUrl(address)),
    };
}
