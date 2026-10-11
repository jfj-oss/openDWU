// Host migration in the app (docs/MULTIPLAYER.md §16): who takes over when the host leaves, and the backup links that
// let the others reach the new host at once, over any network, with no server and no new codes to paste.
//
// - The host names the successor: the lowest lobby slot among the connected players (deterministic, and every peer
//   hears the same choice: `succ` on the side channel, sideChannel.ts), with the other connected players as `members`.
//   It says so again on every change and every few seconds.
// - The successor opens one WebRTC data channel to each member ahead of time, signalled through the host itself: its
//   invite code goes to the member over the side channel (`mOffer`), the member's reply comes back (`mReply`). No
//   copy-paste: the host relays the codes while it is there. A LAN game's backup links use no STUN server (only the
//   PCs' own LAN / VPN addresses); an Internet game's use the public STUN servers, as its invites do (§15). A desktop
//   successor also opens a LAN port and says where (`succAddr`), for players without a backup link (and the old host)
//   to rejoin by address.
// - The host is gone (it quit: `bye`; or its links broke): the successor waits for the first member's report on a
//   backup link (with no members it takes over at once), then becomes the hub (net/multiplayerGame.ts promote) with
//   every member whose backup link is open; each member reports to the successor (migrateTo). The lockstep session cuts
//   the old host's input stream at the same frame for everyone and plays on (net/lockstep.ts promoteToHost).
//   A successor that hears no report within MIGRATE_WAIT_MS assumes it was the one cut off, and shows the host as lost
//   (so a lone player whose own network failed does not fork the game of three).
// - A member whose backup link is missing or fails sees "Lost the connection to the host" with Rejoin: by the new
//   host's address (LAN) or, for an Internet game, a fresh invite code from the new host's banner.
// - The old host can rejoin the new host's game as a client, as any dropped player: its slot is free there.
//
// Main thread / no DOM.

import type { Link } from '../../net/transport';
import type { MultiplayerStatus } from '../../net/multiplayerGame';
import { answerInvite, decodeCode, RtcInvite, type RtcOptions } from '../../net/rtcTransport';
import type { MpHandle } from './mpHandle';
import type { SideHub, SideMsg } from './sideChannel';
import { netEndpoint } from './netBridge';
import { rtcOptions } from './internetUi';

/** How long the successor waits for a member's report before it assumes it was the one cut off. */
export const MIGRATE_WAIT_MS = 20_000;
/** How long a member waits for the new host's answer before giving up on the migration. */
export const MIGRATE_ANSWER_MS = 30_000;
/** How often the host repeats the succession (members that rejoined, links that failed). */
const ANNOUNCE_MS = 5_000;

/** A backup link: holds what arrives until the session reads it; knows when the first message came. */
class BackupLink implements Link {
    private handler: ((text: string) => void) | null = null;
    private closeHandler: ((reason: string) => void) | null = null;
    private readonly queue: string[] = [];
    private closedReason: string | null = null;
    /** When the first message waited here (a member reported), or 0. */
    firstAt = 0;

    constructor(readonly inner: Link) {
        inner.onMessage = (text) => {
            if (this.handler !== null && this.queue.length === 0) this.handler(text);
            else {
                if (this.queue.length === 0 && this.firstAt === 0) this.firstAt = Date.now();
                this.queue.push(text);
            }
        };
        inner.onClose = (reason) => {
            this.closedReason = reason;
            if (this.handler !== null && this.queue.length === 0) this.closeHandler?.(reason);
        };
    }

    get waiting(): number {
        return this.queue.length;
    }

    get onMessage(): ((text: string) => void) | null {
        return this.handler;
    }

    set onMessage(fn: ((text: string) => void) | null) {
        this.handler = fn;
        if (fn !== null && this.queue.length > 0) queueMicrotask(() => this.flush());
    }

    get onClose(): ((reason: string) => void) | null {
        return this.closeHandler;
    }

    set onClose(fn: ((reason: string) => void) | null) {
        this.closeHandler = fn;
        if (fn !== null && this.closedReason !== null && this.queue.length === 0 && this.handler !== null) queueMicrotask(() => this.flush());
    }

    private flush(): void {
        while (this.handler !== null && this.queue.length > 0) this.handler(this.queue.shift()!);
        if (this.queue.length === 0 && this.closedReason !== null) {
            const fn = this.closeHandler;
            this.closeHandler = null;
            fn?.(this.closedReason);
        }
    }

    get isOpen(): boolean {
        return this.inner.isOpen && this.closedReason === null;
    }

    send(text: string): void {
        this.inner.send(text);
    }

    close(reason?: string): void {
        this.inner.close(reason);
    }
}

export interface MigrationEnv {
    mp: MpHandle;
    side: SideHub;
    /** An Internet game: the backup links use STUN (a LAN game's: none). */
    internet: boolean;
    /** This peer became the hub (after its first survivor's report, or at once without members). */
    onPromoted(survivors: number[]): void;
    /** This peer reported to the new hub at `slot`. */
    onMigrating(slot: number): void;
    /** No migration for this peer (no backup link, or it failed): show the host as lost. */
    onNoMigration(why: string): void;
    log(message: string): void;
}

export class Migration {
    /** The successor's lobby slot (-1: none named yet) and the other connected players. */
    successor = -1;
    members: number[] = [];
    /** Where the successor can be reached by IP ("ip:port"), if it opened a LAN port. */
    successorAddresses: string[] = [];
    /** Successor: its backup link to each member; member: the one to the successor (keyed by its slot). */
    private readonly backups = new Map<number, BackupLink>();
    private readonly invites = new Map<number, RtcInvite>();
    private announceTimer: ReturnType<typeof setInterval> | null = null;
    private watchTimer: ReturnType<typeof setInterval> | null = null;
    private lastAnnounce = '';
    private lastAnnounceAt = 0;
    /** The host is gone and this peer acted on it (until the migration ends). */
    private handling = false;
    private lostAt = 0;
    private closed = false;
    /** Successor: preparing its LAN port (once). */
    private lanPort: Promise<void> | null = null;

    constructor(private readonly env: MigrationEnv) {
        const s = env.side;
        s.on('succ', (m) => this.onSucc(m));
        s.on('succAddr', (m) => {
            if (m.from === this.successor && Array.isArray(m.addresses)) this.successorAddresses = (m.addresses as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 8);
        });
        s.on('mOffer', (m) => void this.onOffer(m));
        s.on('mReply', (m) => void this.onReply(m));
        if (env.mp.role === 'host') this.startHostDuty();
        this.watchTimer = setInterval(() => this.watch(), 1000);
    }

    private rtc(): RtcOptions {
        return { ...rtcOptions(), ...(this.env.internet ? {} : { stun: [] }) };
    }

    // -------------------------------------------------------------------------------------------------------------
    // The host: name the successor
    // -------------------------------------------------------------------------------------------------------------

    startHostDuty(): void {
        if (this.announceTimer !== null) return;
        this.announce();
        this.announceTimer = setInterval(() => this.announce(), 1000);
    }

    private announce(): void {
        const mp = this.env.mp;
        if (mp.role !== 'host' || this.closed) return;
        const me = mp.slot;
        const present = mp.seats().filter((s) => s.present && s.slot !== me).map((s) => s.slot).sort((a, b) => a - b);
        const successor = present[0] ?? -1;
        const members = present.slice(1);
        const key = `${successor}|${members.join(',')}`;
        this.successor = successor;
        this.members = members;
        if (successor >= 0) this.lastNamed = successor;
        const now = Date.now();
        if (key === this.lastAnnounce && now - this.lastAnnounceAt < ANNOUNCE_MS) return;
        this.lastAnnounce = key;
        this.lastAnnounceAt = now;
        if (successor >= 0) this.env.side.send('succ', -1, { slot: successor, members });
    }

    // -------------------------------------------------------------------------------------------------------------
    // Successor and members: the backup links
    // -------------------------------------------------------------------------------------------------------------

    private onSucc(m: SideMsg): void {
        if (this.handling || this.env.mp.role !== 'client' || m.from !== this.env.mp.hostSlot()) return;
        const slot = Number(m.slot);
        const members = Array.isArray(m.members) ? (m.members as unknown[]).filter((x): x is number => Number.isInteger(x)) : [];
        if (slot !== this.successor) {
            if (this.successor !== -1) this.env.log(`successor: ${slot} (was ${this.successor})`);
            this.successorAddresses = [];
        }
        this.successor = slot;
        this.lastNamed = slot;
        this.members = members.filter((x) => x !== slot);
        const me = this.env.mp.slot;
        if (slot === me) {
            // Keep only the links to today's members; open the missing ones.
            for (const s of [...this.backups.keys()]) if (!this.members.includes(s)) this.dropBackup(s, 'no longer a member');
            for (const s of [...this.invites.keys()]) if (!this.members.includes(s)) this.invites.get(s)?.close();
            for (const s of this.members) void this.offer(s);
            this.prepareLanPort();
        } else {
            for (const s of [...this.backups.keys()]) if (s !== slot) this.dropBackup(s, 'not the successor');
        }
    }

    private dropBackup(slot: number, why: string): void {
        const b = this.backups.get(slot);
        this.backups.delete(slot);
        b?.close(why);
    }

    /** Successor: open (or keep) a backup link to member `slot`. */
    private async offer(slot: number): Promise<void> {
        if (this.backups.get(slot)?.isOpen === true) return;
        const pending = this.invites.get(slot);
        if (pending !== undefined && (pending.state === 'preparing' || pending.state === 'waiting' || pending.state === 'connecting')) return;
        const inv = new RtcInvite(this.rtc());
        this.invites.set(slot, inv);
        inv.onLink = (link) => {
            if (this.invites.get(slot) === inv) this.invites.delete(slot);
            this.dropBackup(slot, 'replaced');
            this.backups.set(slot, new BackupLink(link));
            this.env.log(`backup link to slot ${slot} open`);
        };
        inv.onState = (st) => {
            if ((st === 'failed' || st === 'closed') && this.invites.get(slot) === inv) {
                this.invites.delete(slot);
                if (st === 'failed') this.env.log(`backup link to slot ${slot}: ${inv.error}`);
            }
        };
        try {
            await inv.ready;
        } catch {
            return;
        }
        if (this.invites.get(slot) !== inv) return;
        this.env.side.send('mOffer', slot, { code: inv.code });
    }

    /** Member: the successor's offer; answer it. */
    private async onOffer(m: SideMsg): Promise<void> {
        if (this.handling || m.from !== this.successor || typeof m.code !== 'string') return;
        try {
            const j = await answerInvite(await decodeCode(m.code, 'invite'), this.rtc());
            this.env.side.send('mReply', m.from, { code: j.reply });
            const link = await j.link;
            if (this.successor !== m.from || this.handling) {
                link.close('not the successor any more');
                return;
            }
            this.dropBackup(m.from, 'replaced');
            this.backups.set(m.from, new BackupLink(link));
            this.env.log(`backup link to the successor (slot ${m.from}) open`);
        } catch (err) {
            this.env.log(`backup link to the successor failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** Successor: a member's reply. */
    private async onReply(m: SideMsg): Promise<void> {
        const inv = this.invites.get(m.from);
        if (inv === undefined || typeof m.code !== 'string') return;
        try {
            await inv.acceptReply(await decodeCode(m.code, 'reply'));
        } catch (err) {
            this.env.log(`backup link to slot ${m.from}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** Successor (desktop): a LAN port for the players that will need to rejoin by address; announced as succAddr. */
    private prepareLanPort(): void {
        const ep = netEndpoint();
        if (!ep.canHost || this.lanPort !== null) return;
        this.lanPort = (async () => {
            let got: { port: number; addresses: { address: string; family: string }[] };
            const preferred = Number(localStorageGet('dwu.mp.port') || '0');
            try {
                got = await ep.host(Number.isInteger(preferred) && preferred > 0 ? preferred : 0);
            } catch {
                got = await ep.host(0);
            }
            // Until this peer is the hub, nobody may come in.
            if (this.env.mp.role !== 'host') ep.onIncoming ??= (link) => link.close('not the host (yet)');
            const addresses = [...got.addresses.filter((a) => a.family === 'IPv4').map((a) => `${a.address}:${got.port}`), `127.0.0.1:${got.port}`];
            this.successorAddresses = addresses;
            this.ownAddresses = addresses;
            this.lanHosting = true;
            this.env.side.send('succAddr', -1, { addresses });
        })().catch((err: unknown) => this.env.log(`no LAN port for rejoins: ${err instanceof Error ? err.message : String(err)}`));
    }

    /** This peer opened a LAN port as the successor (the app stops hosting when the game ends). */
    lanHosting = false;
    /** Where this peer can be reached by IP once it took over ("ip:port"; from its LAN port). */
    ownAddresses: string[] = [];

    // -------------------------------------------------------------------------------------------------------------
    // The host is gone
    // -------------------------------------------------------------------------------------------------------------

    /** The last successor the host named (kept when everyone dropped: the old host may rejoin it). */
    lastNamed = -1;
    private status: MultiplayerStatus = { kind: 'running' };

    /** The session's status (multiplayerApp's onStatus). */
    onStatus(s: MultiplayerStatus): void {
        this.status = s;
        if (this.closed) return;
        if (s.kind === 'hostLost' && !this.handling && this.env.mp.role === 'client') {
            this.handling = true;
            this.lostAt = Date.now();
            this.takeOver();
        }
        if (s.kind !== 'hostLost' && s.kind !== 'migrating' && this.handling && this.env.mp.role === 'client' && this.env.mp.hostSlot() === this.successor) {
            // Migrated as a member: ready for the next one.
            this.handling = false;
            this.successor = -1;
            this.members = [];
        }
    }

    private takeOver(): void {
        const mp = this.env.mp;
        const me = mp.slot;
        if (this.successor === me) {
            const open = [...this.backups].filter(([, l]) => l.isOpen).map(([s]) => s);
            if (open.length === 0 && this.members.length === 0) {
                this.promote([]);
                return;
            }
            if (open.length === 0) {
                this.giveUp('no backup link to the other players is open');
                return;
            }
            this.env.log(`the host is gone: waiting for the first report (${open.length} backup link(s))`);
            // watch() promotes on the first report.
            return;
        }
        const link = this.successor >= 0 ? this.backups.get(this.successor) : undefined;
        if (link === undefined || !link.isOpen) {
            this.giveUp(this.successor < 0 ? 'no successor was named' : 'no backup link to the new host');
            return;
        }
        this.backups.delete(this.successor);
        const slot = this.successor;
        const tapped = this.env.side.tap(link, slot, true);
        this.migratingLink = tapped;
        mp.migrateTo(tapped, slot);
        this.env.onMigrating(slot);
    }

    private promote(survivors: number[]): void {
        const mp = this.env.mp;
        const side = this.env.side;
        side.becomeHost();
        const links = survivors.map((s) => {
            const l = this.backups.get(s)!;
            this.backups.delete(s);
            return { slot: s, link: side.tap(l, s, false) };
        });
        for (const s of [...this.backups.keys()]) this.dropBackup(s, 'the migration started without them');
        mp.promote(survivors);
        for (const { link } of links) mp.acceptMigrant(link);
        this.handling = false;
        this.successor = -1;
        this.members = [];
        this.lastAnnounce = '';
        this.env.onPromoted(survivors);
        this.startHostDuty();
    }

    private migratingLink: Link | null = null;

    private giveUp(why: string): void {
        this.env.log(`no host migration: ${why}`);
        this.migratingLink?.close(why);
        this.migratingLink = null;
        for (const s of [...this.backups.keys()]) this.dropBackup(s, why);
        this.env.mp.abandonMigration();
        this.env.onNoMigration(why);
    }

    /** Every second: the successor's wait for a report; refusing reports while the host is still there. */
    private watch(): void {
        if (this.closed) return;
        const mp = this.env.mp;
        const now = Date.now();
        if (mp.role === 'client' && this.handling && this.successor !== mp.slot && this.status.kind === 'migrating' && now - this.lostAt > MIGRATE_ANSWER_MS) {
            this.giveUp('the new host did not answer within 30 seconds');
            return;
        }
        if (mp.role !== 'client' || this.successor !== mp.slot) return;
        const reported = [...this.backups].filter(([, l]) => l.isOpen && l.waiting > 0);
        if (this.handling) {
            if (reported.length > 0) {
                // A member reported: the host is gone for them too. Take every open backup link (the others report
                // when they notice; the session waits for them).
                this.promote([...this.backups].filter(([, l]) => l.isOpen).map(([s]) => s));
                return;
            }
            if (now - this.lostAt > MIGRATE_WAIT_MS) this.giveUp('no other player reported within 20 seconds (this PC may be the one that lost the connection)');
            return;
        }
        // Not lost here: a member that reports has lost only its own link to the host; it rejoins the host instead.
        for (const [s, l] of reported) {
            if (now - l.firstAt > MIGRATE_WAIT_MS) {
                l.send(JSON.stringify({ t: 'bye', reason: 'the host is still in the game: rejoin it' }));
                this.dropBackup(s, 'the host is still in the game');
            }
        }
    }

    /** The game ended here. */
    close(): void {
        this.closed = true;
        if (this.announceTimer !== null) clearInterval(this.announceTimer);
        if (this.watchTimer !== null) clearInterval(this.watchTimer);
        for (const s of [...this.backups.keys()]) this.dropBackup(s, 'the game ended');
        for (const inv of this.invites.values()) inv.close();
        this.invites.clear();
    }
}

function localStorageGet(key: string): string {
    try {
        return localStorage.getItem(key) ?? '';
    } catch {
        return '';
    }
}
