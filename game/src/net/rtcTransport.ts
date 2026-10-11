// WebRTC data-channel Link (multiplayer Internet play without a server, docs/MULTIPLAYER.md §15).
//
// - The link: one reliable, ordered RTCDataChannel per client, to the host (the star of §8). The channel carries the
//   same text messages as the WebSocket / MessagePort links. A data channel message has a size limit (Chromium:
//   256 KB), so every message is cut into frames of at most RTC_FRAME_CHARS characters: the first character of a frame
//   says whether more frames follow ('1') or the message ends here ('0'). A message over RTC_MAX_MESSAGE_CHARS
//   (64 MB, the WebSocket server's cap) closes the link. Sending waits on the channel's bufferedAmount (a big save
//   would otherwise overflow Chromium's 16 MB send buffer, which closes the channel).
// - Signalling without a server: copy-paste codes. The host's invite code is its SDP offer cut down to what the other
//   side needs (ICE ufrag / pwd, the DTLS fingerprint, the DTLS role, the candidates), packed in binary, deflated when
//   that is shorter, base64url. The joiner rebuilds a full SDP from it, answers, and its reply code goes back the
//   same way. Each invite has a random tag; the reply carries it, so a reply belongs to exactly one invite, and an
//   invite takes one reply only.
// - NAT traversal: public STUN servers tell each side its public address (they see no game traffic). No TURN: no
//   relay of any kind. Where both routers block a direct path, ICE fails, and the screen offers the fallbacks.
//
// Headless: the standard WebRTC and Compression Streams APIs only (Chromium / Electron renderer); no DOM / Pixi / Node.

import type { Link } from './transport';

/** Public STUN servers (address discovery only; no traffic passes through them). */
export const RTC_STUN_SERVERS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478', 'stun:stun1.l.google.com:19302'];

/** Characters per data-channel frame (≤ 48 KB of UTF-8, well under Chromium's 256 KB message limit). */
export const RTC_FRAME_CHARS = 16 * 1024;
/** The largest message a link accepts (the WebSocket server's 64 MB cap). */
export const RTC_MAX_MESSAGE_CHARS = 64 * 1024 * 1024;
/** Send no more while this much is buffered in the channel; resume below the low mark. */
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 512 * 1024;
/** A connection that stays "disconnected" this long is closed (a dropped network; rejoin covers it). */
const DISCONNECTED_CLOSE_MS = 15_000;
/** The negotiated data channel's id (both sides create it; no in-band channel announcement). */
const CHANNEL_ID = 0;
const CHANNEL_LABEL = 'dwu';

// ---------------------------------------------------------------------------------------------------------------------
// The Link
// ---------------------------------------------------------------------------------------------------------------------

class RtcLink implements Link {
    onMessage: ((text: string) => void) | null = null;
    onClose: ((reason: string) => void) | null = null;
    private open = true;
    private readonly out: string[] = [];
    private inboxParts: string[] = [];
    private inboxChars = 0;
    private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    /** Bytes sent / received (stats). */
    sentChars = 0;
    receivedChars = 0;

    constructor(private readonly pc: RTCPeerConnection, private readonly dc: RTCDataChannel) {
        dc.bufferedAmountLowThreshold = LOW_WATER;
        dc.onbufferedamountlow = () => this.pump();
        dc.onmessage = (ev) => this.receive(ev.data);
        dc.onclose = () => {
            this.finish('the connection closed');
            this.teardown();
        };
        dc.onerror = () => this.finish('the connection failed');
        pc.addEventListener('connectionstatechange', () => {
            const s = pc.connectionState;
            if (s === 'failed' || s === 'closed') this.finish(s === 'failed' ? 'the connection failed (network)' : 'the connection closed');
            else if (s === 'disconnected') {
                if (this.disconnectTimer === null) this.disconnectTimer = setTimeout(() => this.finish('the connection was lost'), DISCONNECTED_CLOSE_MS);
            } else if (this.disconnectTimer !== null) {
                clearTimeout(this.disconnectTimer);
                this.disconnectTimer = null;
            }
        });
    }

    get isOpen(): boolean {
        return this.open && this.dc.readyState === 'open';
    }

    send(text: string): void {
        if (!this.open) return;
        if (text.length <= RTC_FRAME_CHARS - 1) this.out.push('0' + text);
        else {
            let i = 0;
            while (i < text.length) {
                let end = Math.min(text.length, i + RTC_FRAME_CHARS - 1);
                // Never split a surrogate pair (a lone half would be sent as U+FFFD).
                if (end < text.length) {
                    const c = text.charCodeAt(end - 1);
                    if (c >= 0xd800 && c <= 0xdbff) end--;
                }
                this.out.push((end >= text.length ? '0' : '1') + text.slice(i, end));
                i = end;
            }
        }
        this.pump();
    }

    private pump(): void {
        while (this.open && this.out.length > 0 && this.dc.readyState === 'open' && this.dc.bufferedAmount < HIGH_WATER) {
            const f = this.out.shift()!;
            try {
                this.dc.send(f);
                this.sentChars += f.length;
            } catch (err) {
                this.finish(`sending failed (${err instanceof Error ? err.message : String(err)})`);
                return;
            }
        }
    }

    private receive(data: unknown): void {
        if (!this.open) return;
        if (typeof data !== 'string' || data.length === 0 || data.length > RTC_FRAME_CHARS) return this.fail('protocol error (bad frame)');
        this.receivedChars += data.length;
        const flag = data.charCodeAt(0);
        if (flag === 0x63 /* 'c': the other side closes, with its reason */) {
            this.finish(data.slice(1, 200) || 'closed');
            return;
        }
        if (flag !== 0x30 && flag !== 0x31) return this.fail('protocol error (bad frame)');
        this.inboxChars += data.length - 1;
        if (this.inboxChars > RTC_MAX_MESSAGE_CHARS) return this.fail('a message over 64 MB');
        if (flag === 0x31) {
            this.inboxParts.push(data.slice(1));
            return;
        }
        let text: string;
        if (this.inboxParts.length === 0) text = data.slice(1);
        else {
            this.inboxParts.push(data.slice(1));
            text = this.inboxParts.join('');
            this.inboxParts = [];
        }
        this.inboxChars = 0;
        this.onMessage?.(text);
    }

    private fail(reason: string): void {
        try {
            if (this.dc.readyState === 'open') this.dc.send('c' + reason);
        } catch {
            // closing anyway
        }
        this.finish(reason);
        this.teardown();
    }

    close(reason = 'closed'): void {
        if (!this.open) return;
        // Whatever is queued goes first, then the reason; the channel closes after its buffer drained.
        this.out.push('c' + reason.slice(0, 190));
        this.pump();
        this.finish(reason);
        const started = Date.now();
        const later = (): void => {
            if (this.dc.readyState === 'open' && this.out.length > 0 && Date.now() - started < 10_000) {
                // Still sending the tail (a close right after a big message).
                while (this.out.length > 0 && this.dc.bufferedAmount < HIGH_WATER) this.dc.send(this.out.shift()!);
                setTimeout(later, 50);
                return;
            }
            if (this.dc.readyState === 'open' && this.dc.bufferedAmount > 0 && Date.now() - started < 10_000) {
                setTimeout(later, 50);
                return;
            }
            this.teardown();
        };
        setTimeout(later, 0);
    }

    async selectedPath(): Promise<string | null> {
        const stats = await this.pc.getStats();
        let pairId: string | undefined;
        stats.forEach((r: { type: string; selectedCandidatePairId?: string }) => {
            if (r.type === 'transport' && r.selectedCandidatePairId !== undefined) pairId = r.selectedCandidatePairId;
        });
        const pair = pairId !== undefined ? (stats.get(pairId) as { localCandidateId: string; remoteCandidateId: string } | undefined) : undefined;
        if (pair === undefined) return null;
        const cand = (id: string): string => {
            const c = stats.get(id) as { candidateType?: string; address?: string; port?: number } | undefined;
            return c === undefined ? '?' : `${c.candidateType ?? '?'} ${c.address ?? '?'}:${c.port ?? '?'}`;
        };
        return `${cand(pair.localCandidateId)} -> ${cand(pair.remoteCandidateId)}`;
    }

    private teardown(): void {
        try {
            this.dc.close();
        } catch {
            // closed
        }
        setTimeout(() => this.pc.close(), 500);
    }

    private finish(reason: string): void {
        if (!this.open) return;
        this.open = false;
        if (this.disconnectTimer !== null) clearTimeout(this.disconnectTimer);
        // Frames still queued are kept only for close(): close() sends its reason after them.
        this.onClose?.(reason);
        if (this.dc.readyState !== 'open') this.teardown();
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The codes: a compact SDP
// ---------------------------------------------------------------------------------------------------------------------

/** What a code carries: the parts of an SDP the other side needs. */
export interface CompactSdp {
    kind: 'invite' | 'reply';
    /** The invite's random tag (a reply carries its invite's). */
    tag: number;
    setup: 'actpass' | 'active' | 'passive';
    ufrag: string;
    pwd: string;
    /** sha-256 DTLS fingerprint, 32 bytes. */
    fingerprint: Uint8Array;
    candidates: CompactCandidate[];
}

export interface CompactCandidate {
    type: 'host' | 'srflx' | 'prflx' | 'relay';
    /** An IPv4 / IPv6 address, or an mDNS name (<uuid>.local). */
    address: string;
    port: number;
}

const CODE_PREFIX = { invite: 'DWI', reply: 'DWR' } as const;
const CODE_VERSION = 1;
/** Most candidates a code may carry (decoding), and how many of each kind a code gets (encoding). */
const MAX_CANDIDATES = 10;
const MAX_SRFLX = 2;
const MAX_HOST = 4;
const TYPES = ['host', 'srflx', 'prflx', 'relay'] as const;
const SETUPS = ['actpass', 'active', 'passive'] as const;

/** The compact form of a local SDP (after ICE gathering). Throws when the SDP lacks a needed line. */
export function compactSdp(sdp: string, kind: CompactSdp['kind'], tag: number, publicOnly = false): CompactSdp {
    const line = (re: RegExp): string => {
        const m = re.exec(sdp);
        if (m === null) throw new Error(`the connection offer lacks ${re.source}`);
        return m[1].trim();
    };
    const ufrag = line(/^a=ice-ufrag:(.+)$/m);
    const pwd = line(/^a=ice-pwd:(.+)$/m);
    const fpm = /^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)\s*$/m.exec(sdp);
    if (fpm === null) throw new Error('the connection offer has no sha-256 fingerprint');
    const fingerprint = new Uint8Array(fpm[1].split(':').map((x) => parseInt(x, 16)));
    if (fingerprint.length !== 32) throw new Error('unexpected fingerprint length');
    const setup = line(/^a=setup:(\w+)/m) as CompactSdp['setup'];
    if (!SETUPS.includes(setup)) throw new Error(`unexpected setup ${setup}`);
    const srflx: Array<CompactCandidate & { base: string }> = [];
    const host: CompactCandidate[] = [];
    const seen = new Set<string>();
    for (const m of sdp.matchAll(/^a=candidate:\S+ (\d+) (\S+) \d+ (\S+) (\d+) typ (\S+)(?: raddr (\S+))?/gm)) {
        const [, component, protocol, address, port, type, raddr] = m;
        if (component !== '1' || protocol.toLowerCase() !== 'udp') continue; // UDP only (TCP candidates rarely help a game)
        if (type !== 'host' && type !== 'srflx') continue;
        if (addressFamily(address) === null) continue;
        if (/^fe80:/i.test(address)) continue; // link-local IPv6 needs a zone id
        const key = `${address}|${port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (type === 'srflx') srflx.push({ type, address, port: Number(port), base: raddr ?? '' });
        else host.push({ type, address, port: Number(port) });
    }
    // The public address once per base kind (several local sockets map to the same public IP), the socket of the most
    // likely LAN interface first; then the host addresses, the likely LAN / VPN ones first (a PC with Docker or VM
    // bridges lists many 172.x addresses that no other machine can reach).
    srflx.sort((a, b) => hostRank(a.base) - hostRank(b.base));
    const pub: CompactCandidate[] = [];
    for (const c of srflx) {
        if (pub.length >= MAX_SRFLX) break;
        if (!pub.some((p) => p.address === c.address)) pub.push({ type: c.type, address: c.address, port: c.port });
    }
    host.sort((a, b) => hostRank(a.address) - hostRank(b.address));
    // 172.16/12 is usually a container bridge when the PC also has a 192.168 / 10.x LAN address.
    const lan = host.some((c) => hostRank(c.address) <= 1);
    const hosts = publicOnly ? [] : host.filter((c) => !(lan && hostRank(c.address) === 5)).slice(0, MAX_HOST);
    return { kind, tag: tag >>> 0, setup, ufrag, pwd, fingerprint, candidates: [...pub, ...hosts] };
}

/** How likely another player can reach a host address: home LANs, then VPN / CGNAT (Tailscale), IPv6, the rest. */
function hostRank(a: string): number {
    if (/^192\.168\./.test(a)) return 0;
    if (/^10\./.test(a)) return 1;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return 2;
    if (addressFamily(a) === 'v6') return 3;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return 5;
    if (addressFamily(a) === 'mdns') return 6;
    return 4;
}

function addressFamily(a: string): 'v4' | 'v6' | 'mdns' | null {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return 'v4';
    if (/^[0-9a-f-]{36}\.local$/i.test(a)) return 'mdns';
    if (a.includes(':') && /^[0-9a-f:.]+$/i.test(a)) return 'v6';
    return null;
}

/** A full SDP from a compact one (what the other side's setRemoteDescription takes). */
export function expandSdp(c: CompactSdp): string {
    const fp = [...c.fingerprint].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
    const lines = [
        'v=0',
        `o=- ${c.tag} 2 IN IP4 127.0.0.1`,
        's=-',
        't=0 0',
        'a=group:BUNDLE 0',
        'a=msid-semantic: WMS',
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        'c=IN IP4 0.0.0.0',
        ...candidateLines(c).map((l) => `a=${l}`),
        ...(c.candidates.length > 0 ? ['a=end-of-candidates'] : []),
        `a=ice-ufrag:${c.ufrag}`,
        `a=ice-pwd:${c.pwd}`,
        'a=ice-options:trickle',
        `a=fingerprint:sha-256 ${fp}`,
        `a=setup:${c.setup}`,
        'a=mid:0',
        'a=sctp-port:5000',
        'a=max-message-size:262144',
    ];
    return lines.join('\r\n') + '\r\n';
}

/** The candidates as `candidate:` lines (an SDP attribute without its "a=", or addIceCandidate's string). */
function candidateLines(c: CompactSdp): string[] {
    return c.candidates.map((cand, i) => {
        const typePref = cand.type === 'host' ? 126 : cand.type === 'prflx' ? 110 : cand.type === 'srflx' ? 100 : 0;
        const priority = typePref * 2 ** 24 + (65535 - i) * 2 ** 8 + 255;
        const rel = cand.type === 'host' ? '' : ' raddr 0.0.0.0 rport 0';
        return `candidate:${i + 1} 1 udp ${priority} ${cand.address} ${cand.port} typ ${cand.type}${rel} generation 0`;
    });
}

// Binary layout (all big-endian):
//   u8  version << 4 | kind << 3 | setup            (kind 0 invite, 1 reply; setup 0 actpass, 1 active, 2 passive)
//   u32 tag
//   str ufrag, str pwd   (u8 length; bit 7 set: the string's base64 decoded to bytes, else ASCII)
//   32  fingerprint
//   u8  candidate count, then each: u8 type << 2 | family (0 v4, 1 v6, 2 mDNS uuid), address (4 / 16 / 16), u16 port
function packCode(c: CompactSdp): Uint8Array {
    const out: number[] = [];
    out.push((CODE_VERSION << 4) | ((c.kind === 'reply' ? 1 : 0) << 3) | SETUPS.indexOf(c.setup));
    out.push((c.tag >>> 24) & 255, (c.tag >>> 16) & 255, (c.tag >>> 8) & 255, c.tag & 255);
    const str = (s: string): void => {
        if (s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+$/.test(s)) {
            const bytes = [...atob(s)].map((ch) => ch.charCodeAt(0));
            out.push(0x80 | bytes.length, ...bytes);
        } else {
            if (s.length > 127 || !/^[\x21-\x7e]*$/.test(s)) throw new Error('unexpected ICE credentials');
            out.push(s.length, ...[...s].map((ch) => ch.charCodeAt(0)));
        }
    };
    str(c.ufrag);
    str(c.pwd);
    out.push(...c.fingerprint);
    out.push(c.candidates.length);
    for (const cand of c.candidates) {
        const fam = addressFamily(cand.address);
        out.push((TYPES.indexOf(cand.type) << 2) | (fam === 'v4' ? 0 : fam === 'v6' ? 1 : 2));
        if (fam === 'v4') out.push(...cand.address.split('.').map(Number));
        else if (fam === 'v6') out.push(...ipv6Bytes(cand.address));
        else out.push(...hexBytes(cand.address.slice(0, 36).replace(/-/g, '')));
        out.push((cand.port >> 8) & 255, cand.port & 255);
    }
    return new Uint8Array(out);
}

function unpackCode(b: Uint8Array): CompactSdp {
    let i = 0;
    const need = (n: number): void => {
        if (i + n > b.length) throw new Error('the code is cut short (copy all of it)');
    };
    const u8 = (): number => {
        need(1);
        return b[i++];
    };
    const head = u8();
    if (head >> 4 !== CODE_VERSION) throw new Error('this code is from another version of openDWU');
    const setup = SETUPS[head & 3];
    if (setup === undefined) throw new Error('not a valid code');
    need(4);
    const tag = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    i += 4;
    const str = (): string => {
        const l = u8();
        const n = l & 0x7f;
        need(n);
        const bytes = b.subarray(i, i + n);
        i += n;
        if (l & 0x80) return btoa(String.fromCharCode(...bytes));
        return String.fromCharCode(...bytes);
    };
    const ufrag = str();
    const pwd = str();
    need(32);
    const fingerprint = b.slice(i, i + 32);
    i += 32;
    const count = u8();
    if (count > MAX_CANDIDATES) throw new Error('not a valid code');
    const candidates: CompactCandidate[] = [];
    for (let k = 0; k < count; k++) {
        const f = u8();
        const type = TYPES[f >> 2];
        const fam = f & 3;
        if (type === undefined || fam > 2) throw new Error('not a valid code');
        const n = fam === 0 ? 4 : 16;
        need(n + 2);
        const a = b.subarray(i, i + n);
        i += n;
        const address = fam === 0 ? [...a].join('.') : fam === 1 ? ipv6String(a) : uuidString(a) + '.local';
        const port = (b[i] << 8) | b[i + 1];
        i += 2;
        candidates.push({ type, address, port });
    }
    if (i !== b.length) throw new Error('not a valid code');
    return { kind: (head >> 3) & 1 ? 'reply' : 'invite', tag, setup, ufrag, pwd, fingerprint, candidates };
}

function hexBytes(hex: string): number[] {
    const out: number[] = [];
    for (let k = 0; k < hex.length; k += 2) out.push(parseInt(hex.slice(k, k + 2), 16));
    return out;
}

function ipv6Bytes(a: string): number[] {
    let addr = a;
    let tail: number[] = [];
    const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    if (v4 !== null) {
        tail = v4[1].split('.').map(Number);
        addr = addr.slice(0, -v4[1].length) + '0:0';
    }
    const [head, rest] = addr.split('::');
    const h = head === '' ? [] : head.split(':');
    const r = rest === undefined ? [] : rest === '' ? [] : rest.split(':');
    const groups = rest === undefined ? h : [...h, ...Array<string>(8 - h.length - r.length).fill('0'), ...r];
    const out: number[] = [];
    for (const g of groups.slice(0, 8)) {
        const v = parseInt(g || '0', 16);
        out.push((v >> 8) & 255, v & 255);
    }
    if (tail.length === 4) out.splice(12, 4, ...tail);
    return out;
}

function ipv6String(b: Uint8Array): string {
    const g: string[] = [];
    for (let k = 0; k < 16; k += 2) g.push(((b[k] << 8) | b[k + 1]).toString(16));
    // Shorten the longest run of zero groups.
    let best = -1;
    let bestLen = 0;
    for (let k = 0; k < 8; ) {
        if (g[k] !== '0') {
            k++;
            continue;
        }
        let e = k;
        while (e < 8 && g[e] === '0') e++;
        if (e - k > bestLen && e - k > 1) {
            best = k;
            bestLen = e - k;
        }
        k = e;
    }
    if (best < 0) return g.join(':');
    return `${g.slice(0, best).join(':')}::${g.slice(best + bestLen).join(':')}`;
}

function uuidString(b: Uint8Array): string {
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function toBase64Url(b: Uint8Array): string {
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
}

async function deflateRaw(b: Uint8Array, inflate: boolean): Promise<Uint8Array> {
    const stream = new Blob([b as BlobPart]).stream().pipeThrough(inflate ? new DecompressionStream('deflate-raw') : new CompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    if (buf.byteLength > 4096) throw new Error('not a valid code');
    return new Uint8Array(buf);
}

/**
 * The text of a code: "DWI" (invite) / "DWR" (reply), then "1" (raw) or "Z" (deflated: used when shorter), then
 * base64url of the packed bytes.
 */
export async function encodeCode(c: CompactSdp): Promise<string> {
    const raw = packCode(c);
    let body = raw;
    let mark = '1';
    try {
        const z = await deflateRaw(raw, false);
        if (z.length < raw.length) {
            body = z;
            mark = 'Z';
        }
    } catch {
        // no CompressionStream: the raw form
    }
    return `${CODE_PREFIX[c.kind]}${mark}${toBase64Url(body)}`;
}

/** Parse a pasted code (whitespace, quotes and backticks around it are ignored). Throws with a message for the player. */
export async function decodeCode(text: string, expect: CompactSdp['kind']): Promise<CompactSdp> {
    const s = text.replace(/[\s`'"<>]/g, '');
    if (s === '') throw new Error(expect === 'invite' ? 'paste the invite code from the host' : 'paste the reply code from the player');
    if (s.length > 2000) throw new Error('that is not a code (too long)');
    const kind = s.startsWith(CODE_PREFIX.invite) ? 'invite' : s.startsWith(CODE_PREFIX.reply) ? 'reply' : null;
    if (kind === null) throw new Error('that is not an openDWU connection code (it starts with DWI or DWR)');
    if (kind !== expect) throw new Error(kind === 'reply' ? 'that is a reply code: it goes to the host, who pastes it in the lobby' : 'that is an invite code: the player who joins pastes it in "Join by code"');
    const mark = s[3];
    if (mark !== '1' && mark !== 'Z') throw new Error('this code is from another version of openDWU');
    let bytes: Uint8Array;
    try {
        bytes = fromBase64Url(s.slice(4));
        if (mark === 'Z') bytes = await deflateRaw(bytes, true);
    } catch {
        throw new Error('the code is damaged (copy all of it, with the Copy button)');
    }
    const c = unpackCode(bytes);
    if (c.kind !== expect) throw new Error('not a valid code');
    return c;
}

// ---------------------------------------------------------------------------------------------------------------------
// Peer connections
// ---------------------------------------------------------------------------------------------------------------------

export interface RtcOptions {
    /** STUN servers (default RTC_STUN_SERVERS). */
    stun?: string[];
    /** Test hook: gather no candidates at all, so ICE must fail (the failure path). */
    blockIce?: boolean;
    /** Test hook: the codes carry only public (STUN) addresses, no LAN / VPN ones (a real Internet path). */
    publicOnly?: boolean;
    /** How long to wait for ICE gathering (ms); what is gathered by then goes in the code. Default 5000. */
    gatherMs?: number;
}

function newPeer(opts: RtcOptions): { pc: RTCPeerConnection; dc: RTCDataChannel } {
    const Ctor = (globalThis as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
    if (Ctor === undefined) throw new Error('this app has no WebRTC');
    const pc = new Ctor({
        // `stun: []`: none (a LAN game's backup links, docs/MULTIPLAYER.md §16: only the PCs' own addresses).
        iceServers: opts.blockIce === true || opts.stun?.length === 0 ? [] : [{ urls: opts.stun ?? RTC_STUN_SERVERS }],
        // blockIce: relay-only with no relay = no candidates (and no relay is ever configured otherwise).
        iceTransportPolicy: opts.blockIce === true ? 'relay' : 'all',
        bundlePolicy: 'max-bundle',
    });
    const dc = pc.createDataChannel(CHANNEL_LABEL, { negotiated: true, id: CHANNEL_ID, ordered: true });
    // Only the game protocol: a channel the other side opens in-band is closed at once.
    pc.ondatachannel = (ev) => ev.channel.close();
    return { pc, dc };
}

/**
 * The local SDP once its candidates are in: gathering complete, or a public (srflx) candidate and nothing new for a
 * moment (a slow or unreachable STUN server must not hold the code up), or `ms` at most.
 */
async function gathered(pc: RTCPeerConnection, ms: number): Promise<string> {
    if (pc.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve) => {
            const t0 = Date.now();
            let last = t0;
            let srflx = false;
            const timer = setInterval(() => {
                const now = Date.now();
                if (now - t0 >= ms || (srflx && now - last >= 600)) done();
            }, 100);
            function done(): void {
                clearInterval(timer);
                pc.removeEventListener('icegatheringstatechange', check);
                pc.removeEventListener('icecandidate', onCandidate);
                resolve();
            }
            function check(): void {
                if (pc.iceGatheringState === 'complete') done();
            }
            function onCandidate(ev: RTCPeerConnectionIceEvent): void {
                last = Date.now();
                if (ev.candidate !== null && / typ srflx /.test(ev.candidate.candidate)) srflx = true;
            }
            pc.addEventListener('icegatheringstatechange', check);
            pc.addEventListener('icecandidate', onCandidate);
        });
    }
    const sdp = pc.localDescription?.sdp;
    if (sdp === undefined) throw new Error('no local description');
    return sdp;
}

export type RtcState = 'preparing' | 'waiting' | 'connecting' | 'connected' | 'failed' | 'closed';

/** How long the host waits for the connection after the reply code was entered. */
export const RTC_CONNECT_TIMEOUT_MS = 30_000;

function randomTag(): number {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    return b[0];
}

/**
 * Host: one invite = one peer connection waiting for one reply. `code` is the invite; `acceptReply(code)` takes the
 * joiner's reply; `onState` follows it; when the channel opens `onLink` gets the Link (the lobby accepts it as any
 * other connection). An invite takes one reply; closing it (hosting stopped) makes its code worthless.
 */
export class RtcInvite {
    state: RtcState = 'preparing';
    code = '';
    /** Why it failed ('' otherwise). */
    error = '';
    readonly tag = randomTag();
    onState: ((state: RtcState, invite: RtcInvite) => void) | null = null;
    onLink: ((link: Link, invite: RtcInvite) => void) | null = null;
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private link: Link | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    readonly ready: Promise<void>;

    constructor(private readonly opts: RtcOptions = {}) {
        this.ready = this.prepare();
        this.ready.catch(() => undefined);
    }

    private set(state: RtcState, error = ''): void {
        if (this.state === state && this.error === error) return;
        this.state = state;
        this.error = error;
        this.onState?.(state, this);
    }

    private async prepare(): Promise<void> {
        try {
            const { pc, dc } = newPeer(this.opts);
            this.pc = pc;
            this.dc = dc;
            await pc.setLocalDescription(await pc.createOffer());
            const sdp = await gathered(pc, this.opts.gatherMs ?? 5000);
            if (this.state === 'closed') return;
            this.code = await encodeCode(compactSdp(sdp, 'invite', this.tag, this.opts.publicOnly === true));
            this.set('waiting');
        } catch (err) {
            this.set('failed', `Could not create the invite: ${err instanceof Error ? err.message : String(err)}`);
            throw err;
        }
    }

    /** Whether `reply` (a decoded reply code) answers this invite. */
    matches(reply: CompactSdp): boolean {
        return reply.tag === this.tag;
    }

    /** Apply the joiner's reply. Throws with a message when it does not fit this invite. */
    async acceptReply(reply: CompactSdp): Promise<void> {
        await this.ready;
        if (this.state !== 'waiting') throw new Error(this.state === 'closed' ? 'this invite was closed' : 'this invite has already been used: make a new one');
        if (reply.tag !== this.tag) throw new Error('this reply code belongs to another invite');
        const pc = this.pc!;
        const dc = this.dc!;
        this.set('connecting');
        this.watch(pc, dc);
        try {
            await pc.setRemoteDescription({ type: 'answer', sdp: expandSdp(reply) });
        } catch (err) {
            this.set('failed', `The reply code was not accepted (${err instanceof Error ? err.message : String(err)}).`);
            this.dispose();
        }
    }

    private watch(pc: RTCPeerConnection, dc: RTCDataChannel): void {
        const opened = (): void => {
            if (this.state !== 'connecting') return;
            if (this.timer !== null) clearTimeout(this.timer);
            this.link = new RtcLink(pc, dc);
            this.set('connected');
            this.onLink?.(this.link, this);
        };
        if (dc.readyState === 'open') opened();
        else dc.addEventListener('open', opened, { once: true });
        const failed = (why: string): void => {
            if (this.state !== 'connecting') return;
            this.set('failed', why);
            this.dispose();
        };
        pc.addEventListener('iceconnectionstatechange', () => {
            if (pc.iceConnectionState === 'failed') failed('no direct connection could be made between your network and the player\'s (their routers block it, and openDWU uses no relay server).');
        });
        this.timer = setTimeout(() => failed('no direct connection within 30 seconds: your network and the player\'s block a direct connection (openDWU uses no relay server), or the reply code was not made for this invite.'), RTC_CONNECT_TIMEOUT_MS);
    }

    /** Hosting stopped / the invite is withdrawn (an open link stays open: it belongs to the session). */
    close(): void {
        if (this.state === 'connected') return;
        this.set('closed');
        this.dispose();
    }

    private dispose(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        if (this.link === null) {
            try {
                this.pc?.close();
            } catch {
                // closed
            }
        }
    }
}

/**
 * Joiner: answer an invite. Resolves with the reply code at once (to send back to the host) and `link`, which
 * resolves when the host entered the reply and the channel opened (or rejects: failed / timed out / cancelled).
 */
export interface RtcJoin {
    reply: string;
    link: Promise<Link>;
    state: RtcState;
    onState: ((state: RtcState) => void) | null;
    cancel(): void;
}

/** How long a joiner waits for the host to enter its reply code. */
export const RTC_JOIN_TIMEOUT_MS = 5 * 60_000;

export async function answerInvite(invite: CompactSdp, opts: RtcOptions = {}): Promise<RtcJoin> {
    const { pc, dc } = newPeer(opts);
    try {
        // The host's candidates are added only after our own gathering: Chromium stops gathering early (before the
        // STUN answer) once a candidate pair to the remote works, which on a LAN is at once, and the reply would then
        // lack our public address.
        await pc.setRemoteDescription({ type: 'offer', sdp: expandSdp({ ...invite, candidates: [] }) });
        await pc.setLocalDescription(await pc.createAnswer());
        const sdp = await gathered(pc, opts.gatherMs ?? 5000);
        const reply = await encodeCode(compactSdp(sdp, 'reply', invite.tag, opts.publicOnly === true));
        for (const line of candidateLines(invite)) await pc.addIceCandidate({ candidate: line, sdpMid: '0', sdpMLineIndex: 0 });
        await pc.addIceCandidate({ candidate: '', sdpMid: '0', sdpMLineIndex: 0 }).catch(() => undefined);
        let settle: { resolve: (l: Link) => void; reject: (e: Error) => void } | null = null;
        const link = new Promise<Link>((resolve, reject) => (settle = { resolve, reject }));
        link.catch(() => undefined);
        const j: RtcJoin = {
            reply,
            link,
            state: 'waiting',
            onState: null,
            cancel: () => end('cancelled'),
        };
        const setState = (s: RtcState): void => {
            if (j.state === s) return;
            j.state = s;
            j.onState?.(s);
        };
        let done = false;
        const timer = setTimeout(() => end(`No connection within ${RTC_JOIN_TIMEOUT_MS / 60_000} minutes.`), RTC_JOIN_TIMEOUT_MS);
        function end(why: string): void {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
                pc.close();
            } catch {
                // closed
            }
            setState(why === 'cancelled' ? 'closed' : 'failed');
            settle!.reject(new Error(why));
        }
        // The host's ICE checks start when it enters the reply; ours run from now. Chromium may call the connection
        // failed while the host has not answered yet, and recovers when the host's checks arrive; so a failure here
        // is shown, not final, until the time limit.
        pc.addEventListener('iceconnectionstatechange', () => {
            if (done) return;
            const s = pc.iceConnectionState;
            if (s === 'checking') setState('connecting');
            else if (s === 'failed') setState('failed');
            else if (s === 'connected' || s === 'completed') setState('connecting');
        });
        const opened = (): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            setState('connected');
            settle!.resolve(new RtcLink(pc, dc));
        };
        if (dc.readyState === 'open') opened();
        else dc.addEventListener('open', opened, { once: true });
        return j;
    } catch (err) {
        pc.close();
        throw err;
    }
}

/**
 * The network path an open WebRTC link uses (its selected ICE candidate pair), e.g. "host 100.64.1.2:5000 ->
 * srflx 203.0.113.9:6000"; null when `link` is not a WebRTC link or no pair is selected yet.
 */
export async function rtcLinkPath(link: Link): Promise<string | null> {
    if (!(link instanceof RtcLink)) return null;
    return link.selectedPath();
}
