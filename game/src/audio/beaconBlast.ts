// The Beacon's launch-day blast (Giantworks add-on, the Beacon; presentation only): the call, when the strike groups
// are sent out and the relay fires its beam. Our own synthesised sound (scripts/beacon-blast.py →
// public/audio/beacon/beacon-blast.ogg): its charge starts with the pulses racing down the prongs, its blast lands on
// the beam's ignition (render/beaconRelayFx.ts LAUNCH). It plays for every human player at the call — each client on
// its own, from the launch it sees in the state (render/beaconLaunch.ts pollBeaconLaunch) — not panned and not faded by
// distance (the camera is sent to the Beacon), times the Effects volume (silent when muted). The file's bytes are
// fetched once the galaxy has a Beacon; no AudioContext is created before a call. Never touches sim state.

import type { Galaxy } from '../sim/galaxy';
import { beaconLaunchState, pollBeaconLaunch } from '../render/beaconLaunch';
import { LAUNCH } from '../render/beaconRelayFx';

/** The blast (a URL of the built game: public/audio/beacon/). */
export const BLAST_URL = '/audio/beacon/beacon-blast.ogg';
/** Its gain at Effects volume 1: loud. */
export const BLAST_GAIN = 1.0;
/** The file starts this far into the launch sequence (s): with the first charge pulse. */
export const BLAST_AT_S = LAUNCH.pulse0;
/** The file's blast is this far into it (s): it lands on the ignition. */
export const BLAST_HIT_S = 2.9;
/** A call heard this late (s into the sequence) is joined part way; later than this it is not played. */
export const BLAST_LATE_S = 2.5;

/** Where in the file to start (s) and how long to wait first (s) for a call t s old: null when too late. Pure. */
export function blastStart(t: number): { offset: number; delay: number } | null {
    const late = t - BLAST_AT_S;
    if (late > BLAST_LATE_S) return null;
    return late <= 0 ? { offset: 0, delay: -late } : { offset: late, delay: 0 };
}

/** One per game view: update() once per rendered frame, dispose() with the audio graph. */
export class BeaconBlast {
    private bytes: ArrayBuffer | null = null;
    private buffer: AudioBuffer | null = null;
    private fetching = false;
    private decoding = false;
    private heard = 0;
    private wanted: number | null = null;

    constructor(private readonly context: () => AudioContext) {}

    /** `fx`: the Effects volume 0..1 (0 when muted). */
    update(galaxy: Galaxy, fx: number, nowMs: number): void {
        const st = beaconLaunchState(galaxy);
        if (st === null) return;
        if (this.bytes === null && !this.fetching && st.beacon !== undefined && st.beacon !== null) this.fetch();
        const clock = pollBeaconLaunch(galaxy, nowMs);
        if (clock.serial > this.heard) {
            this.heard = clock.serial;
            this.wanted = clock.serial;
        }
        if (this.wanted === null) return;
        const t = (nowMs - clock.atMs) / 1000;
        const start = blastStart(t);
        if (start === null || fx <= 0) {
            this.wanted = null;
            return;
        }
        if (this.buffer === null) {
            if (this.bytes !== null && !this.decoding) this.decode();
            else if (this.bytes === null && !this.fetching) this.fetch();
            return;
        }
        this.wanted = null;
        try {
            const ctx = this.context();
            if (ctx.state === 'suspended') void ctx.resume();
            const src = ctx.createBufferSource();
            src.buffer = this.buffer;
            const g = ctx.createGain();
            g.gain.value = BLAST_GAIN * Math.max(0, Math.min(1, fx));
            src.connect(g).connect(ctx.destination);
            src.onended = () => src.disconnect();
            src.start(ctx.currentTime + start.delay, start.offset);
        } catch {
            // no Web Audio
        }
    }

    private fetch(): void {
        this.fetching = true;
        void (async () => {
            try {
                const r = await fetch(BLAST_URL);
                if (r.ok) this.bytes = await r.arrayBuffer();
            } catch {
                // missing: silent
            }
        })();
    }

    private decode(): void {
        this.decoding = true;
        void (async () => {
            try {
                // decodeAudioData detaches its input: decode a copy, keep the bytes
                this.buffer = await this.context().decodeAudioData(this.bytes!.slice(0));
            } catch {
                // undecodable: silent
            }
        })();
    }

    dispose(): void {
        this.buffer = null;
        this.wanted = null;
    }
}
