// The Watcher's horn (Giantworks add-on, the Beacon; presentation only): a long, low, distorted brass call as a
// Watcher starts to open. Our own synthesised sound (scripts/beacon-horn.py → public/audio/beacon/watcher-horn.ogg).
// The cue comes from the render side (beaconFx.ts takeWatcherHornCues: a Watcher that started opening while drawn);
// it plays panned by its place on screen, at a level by its distance from the view centre and the zoom, times the
// Effects volume (0 when muted). At most once per Watcher per opening, and never twice within HORN_COOLDOWN_S.
// The file is fetched on the first cue; no AudioContext is created before one. Never touches sim state.

import type { BuiltObject } from '../sim/builtObject';
import { takeWatcherHornCues } from '../render/beaconFx';

/** The horn (a URL of the built game: public/audio/beacon/). */
export const HORN_URL = '/audio/beacon/watcher-horn.ogg';
/** Peak gain (at the view centre, at system zoom, Effects volume 1): loud. */
export const HORN_MAX_GAIN = 0.95;
/** No horn within this long of the last one (s), whichever Watcher. */
export const HORN_COOLDOWN_S = 25;
/** The same Watcher not again within this long (s), even if it opens again. */
export const HORN_SAME_WATCHER_S = 90;
/** Heard fully up to this zoom factor (1 / zoom; the system view is 50), silent from HORN_SILENT_F. */
export const HORN_FULL_F = 80;
export const HORN_SILENT_F = 600;
/** A cue older than this (s) when the sound is ready is dropped (the opening has gone on without it). */
const HORN_LATE_S = 2;

/** The camera as this module needs it. */
export interface HornView {
    x: number;
    y: number;
    zoom: number;
    width: number;
    height: number;
}

/** Level 0..1 and pan -1..1 of a horn at world (x, y) for the view: full near the view centre, fading to a third at
 * the screen's edge and to nothing a screen beyond it; gated by the zoom. Pure. */
export function hornLevel(x: number, y: number, view: HornView): { level: number; pan: number } {
    const f = 1 / Math.max(1e-9, view.zoom);
    const z = Math.max(0, Math.min(1, (HORN_SILENT_F - f) / (HORN_SILENT_F - HORN_FULL_F)));
    const zoomGate = z * z * (3 - 2 * z);
    const halfW = Math.max(1, view.width / 2);
    const halfH = Math.max(1, view.height / 2);
    const sx = ((x - view.x) * view.zoom) / halfW;
    const sy = ((y - view.y) * view.zoom) / halfH;
    const r = Math.hypot(sx, sy);
    const near = r <= 1 ? 1 - 0.65 * r : Math.max(0, 0.35 * (2 - r));
    const pan = Math.max(-1, Math.min(1, sx * 0.8));
    return { level: Math.max(0, Math.min(1, near * zoomGate)), pan: Number.isFinite(pan) ? pan : 0 };
}

/** The anti-spam rule: may Watcher `bo` sound now (s)? Pure given the state. */
export function hornAllowed(nowS: number, lastAny: number, lastFor: number | undefined): boolean {
    if (nowS - lastAny < HORN_COOLDOWN_S) return false;
    if (lastFor !== undefined && nowS - lastFor < HORN_SAME_WATCHER_S) return false;
    return true;
}

/** One per game view: update() once per rendered frame, dispose() with the audio graph. */
export class BeaconHorn {
    private buffer: AudioBuffer | null = null;
    private loading = false;
    private lastAny = -Infinity;
    private lastFor = new WeakMap<BuiltObject, number>();
    private pending: { bo: BuiltObject; at: number }[] = [];
    private readonly cues: BuiltObject[] = [];

    constructor(private readonly context: () => AudioContext) {}

    /** `fx`: the Effects volume 0..1 (0 when muted); `nowS`: a monotonic wall clock (s). */
    update(view: HornView, fx: number, nowS: number): void {
        this.cues.length = 0;
        takeWatcherHornCues(this.cues);
        for (const bo of this.cues) {
            if (!hornAllowed(nowS, this.lastAny, this.lastFor.get(bo))) continue;
            // Claimed even when it turns out unheard (muted, far off): one call per opening.
            this.lastAny = nowS;
            this.lastFor.set(bo, nowS);
            if (fx <= 0 || hornLevel(bo.xpos, bo.ypos, view).level <= 0.01) continue;
            this.pending.push({ bo, at: nowS });
        }
        if (this.pending.length === 0) return;
        try {
            if (this.buffer === null) {
                this.load();
                this.pending = this.pending.filter((p) => nowS - p.at < HORN_LATE_S);
                return;
            }
            const ctx = this.context();
            if (ctx.state === 'suspended') void ctx.resume();
            for (const p of this.pending) {
                if (nowS - p.at >= HORN_LATE_S || p.bo.hasBeenDestroyed) continue;
                const { level, pan } = hornLevel(p.bo.xpos, p.bo.ypos, view);
                const gain = HORN_MAX_GAIN * level * Math.max(0, Math.min(1, fx));
                if (gain <= 0.005) continue;
                const src = ctx.createBufferSource();
                src.buffer = this.buffer;
                const panner = ctx.createStereoPanner();
                panner.pan.value = pan;
                const g = ctx.createGain();
                g.gain.value = gain;
                src.connect(panner).connect(g).connect(ctx.destination);
                src.onended = () => src.disconnect();
                src.start();
            }
            this.pending.length = 0;
        } catch {
            this.pending.length = 0; // no Web Audio
        }
    }

    private load(): void {
        if (this.loading) return;
        this.loading = true;
        void (async () => {
            try {
                const r = await fetch(HORN_URL);
                if (!r.ok) return;
                const data = await r.arrayBuffer();
                this.buffer = await this.context().decodeAudioData(data);
            } catch {
                // missing or undecodable: silent
            }
        })();
    }

    dispose(): void {
        this.pending.length = 0;
        this.buffer = null;
    }
}
