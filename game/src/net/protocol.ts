// Lockstep wire protocol (multiplayer Phase 3 core, docs/MULTIPLAYER.md "Lockstep core"). Plain JSON messages over a
// string Link (transport.ts). Star topology: every client talks only to the host; the host relays each client's inputs
// to the other clients, so the host's view of who sent what is authoritative (joins and leaves are decided there).
//
// Headless: no DOM / Pixi / Node APIs.

import type { EncodedArg } from '../sim/player/commandCodec';

/** Peer id: the host is 0, clients 1, 2, … in join order (never reused in a session). */
export type PeerId = number;

/** The shared clock: game speed (Galaxy TimeSpeed, 0.25 … 4) and pause. Only the host changes it. */
export interface ClockState {
    speed: number;
    paused: boolean;
}

/**
 * One journaled player command on the wire: what a peer needs to re-issue it (sim/player/commandLog.ts PlayerLogEntry):
 * the issuing empire by its stable Empire.empireId (not its flatEmpireList index, which can move before the command's
 * frame), the PLAYER_OPS key, and the arguments in the current command-log codec encoding (sim/player/commandCodec.ts
 * COMMAND_CODEC_VERSION: stable ids, never list positions).
 */
export interface NetCommand {
    /** The issuing peer and its per-peer sequence number (unique per peer, increasing). */
    peer: PeerId;
    seq: number;
    /** Empire.empireId of the issuing empire (a LockstepSim may use any stable empire key; GalaxyLockstepSim this). */
    empire: number;
    op: string;
    args: EncodedArg[];
    /** Wall-clock epoch ms when it was issued (stats only; never read by the sim). */
    sentAt: number;
}

/** A peer's input for one frame: its commands (possibly none: the "no input" ack) and, from the host, a clock change. */
export interface FrameInput {
    frame: number;
    peer: PeerId;
    cmds: NetCommand[];
    /** Host only: the clock from this frame on (absent: unchanged). */
    clock?: ClockState;
}

export interface PeerInfo {
    id: PeerId;
    name: string;
    /** First frame this peer sends input for. */
    fromFrame: number;
    /** First frame it no longer sends input for (it left), or null while in the session. */
    leftFrom: number | null;
}

export interface LockstepParams {
    /** A command issued at frame F is applied at frame F + inputDelay on every peer. */
    inputDelay: number;
    /** Peers compare stateDigest every this many frames. */
    digestInterval: number;
}

/** Client → host: first message on a new link. */
export interface HelloMsg {
    t: 'hello';
    name: string;
    /** A client that built the game itself (same seed / save): its frame and digest. The host skips the save when they
     *  equal its own (it is still at that frame). */
    have?: { frame: number; digest: string };
}

/**
 * A save on the wire (join / resync): serializeGame's text, gzip-compressed (saveCompression.ts), sent ahead of the
 * message that names it as `chunks` SaveChunkMsg pieces with this `id` (each at most SAVE_CHUNK_BYTES of the gzip,
 * base64: the link carries text). A 450 MB save is ~45 MB of gzip, ~60 MB on the wire.
 */
export interface WireSave {
    id: number;
    chunks: number;
    /** Bytes of the gzip. */
    bytes: number;
}

/** Bytes of gzip per SaveChunkMsg (1.4 MB of base64). */
export const SAVE_CHUNK_BYTES = 1 << 20;

/** Host → client: one piece of a compressed save (WireSave), base64. Sent just before the welcome / resync. */
export interface SaveChunkMsg {
    t: 'saveChunk';
    id: number;
    index: number;
    data: string;
}

/** Host → client: the answer to hello. */
export interface WelcomeMsg {
    t: 'welcome';
    peer: PeerId;
    /** The boundary the client starts at (the next frame to run). */
    frame: number;
    /** serializeGame at that boundary (its chunks came first), or null when the client's own game already equals it. */
    save: WireSave | null;
    clock: ClockState;
    /** Every input the host knows for frames >= `frame`. */
    inputs: FrameInput[];
    peers: PeerInfo[];
    params: LockstepParams;
}

export interface InputsMsg {
    t: 'inputs';
    list: FrameInput[];
}

/** Client → host: its stateDigest at a boundary. `epoch` = how many resyncs it has applied (stale digests are ignored). */
export interface DigestMsg {
    t: 'digest';
    frame: number;
    digest: string;
    epoch: number;
}

/** Host → client: the client desynced; reload this save and continue at `frame`. */
export interface ResyncMsg {
    t: 'resync';
    frame: number;
    /** The save of that boundary (its chunks came first). */
    save: WireSave;
    clock: ClockState;
    inputs: FrameInput[];
    epoch: number;
}

export interface PeerJoinedMsg {
    t: 'peerJoined';
    peer: PeerInfo;
}

export interface PeerLeftMsg {
    t: 'peerLeft';
    peer: PeerId;
    fromFrame: number;
}

/** Client → host: please pause / resume (the host decides; it is applied as a host clock change). */
export interface PauseRequestMsg {
    t: 'pauseRequest';
    paused: boolean;
}

/** Either way: round-trip probe. */
export interface PingMsg {
    t: 'ping';
    id: number;
    at: number;
}

export interface PongMsg {
    t: 'pong';
    id: number;
    at: number;
}

/** Host → clients: the session is over (host quit). */
export interface ByeMsg {
    t: 'bye';
    reason: string;
}

export type NetMessage = HelloMsg | WelcomeMsg | SaveChunkMsg | InputsMsg | DigestMsg | ResyncMsg | PeerJoinedMsg | PeerLeftMsg | PauseRequestMsg | PingMsg | PongMsg | ByeMsg;
