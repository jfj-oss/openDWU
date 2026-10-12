// Dead Probe Swarm radio chatter (presentation only): a faint robotic ambience while the camera is near the swarm's
// ships at system zoom — bursts of band-passed garble with stepped formants, bit-crushed through a staircase
// shaper, data chirps, squelch clicks and static, with random gaps. Our own WebAudio synthesis (no samples). Volume
// follows proximity and the number of swarm ships near the camera, capped low, times the Effects volume (0 when
// muted); a slow gain glide fades it in and out. No AudioContext is created until the swarm is first heard.
// Never draws Galaxy randomness, never writes sim state.

import type { Galaxy } from '../sim/galaxy';
import { peekProbeSwarmState } from '../sim/scenario/threats/probeSwarm';

/** The camera as this module needs it. */
export interface ChatterView {
    x: number;
    y: number;
    zoom: number;
    width: number;
    height: number;
}

/** Peak bus gain (at full proximity weight and Effects volume 1): faint, under the other effects. */
export const CHATTER_MAX_GAIN = 0.07;
/** Heard fully up to this zoom factor (1 / zoom; the system view is 50), silent from CHATTER_SILENT_F. */
export const CHATTER_FULL_F = 60;
export const CHATTER_SILENT_F = 160;
/** Proximity range (world units) around the camera centre, capped by the view's half diagonal. */
export const CHATTER_RANGE = 26000;
const REFRESH_S = 0.4;
const FADE_TAU_S = 0.9;

/** The zoom gate: 1 up to CHATTER_FULL_F, 0 from CHATTER_SILENT_F, smooth between. Pure. */
export function chatterZoomGate(f: number): number {
    const t = Math.max(0, Math.min(1, (CHATTER_SILENT_F - f) / (CHATTER_SILENT_F - CHATTER_FULL_F)));
    return t * t * (3 - 2 * t);
}

/** The swarm's proximity weight at the camera (0 with no swarm), times the zoom gate. */
export function swarmChatterLevel(galaxy: Galaxy, view: ChatterView): number {
    if (galaxy.scenario === null) return 0;
    const st = peekProbeSwarmState(galaxy);
    const faction = st?.faction ?? null;
    if (faction === null) return 0;
    const gate = chatterZoomGate(1 / view.zoom);
    if (gate <= 0) return 0;
    const range = Math.min(CHATTER_RANGE, Math.hypot(view.width, view.height) / 2 / view.zoom + 4000);
    let sum = 0;
    for (const b of faction.builtObjects) {
        if (b.hasBeenDestroyed) continue;
        const d = Math.hypot(b.xpos - view.x, b.ypos - view.y);
        if (d < range) sum += (1 - d / range) ** 2;
    }
    return Math.min(1, Math.sqrt(sum) / 1.6) * gate;
}

// ---------------------------------------------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------------------------------------------

export interface ChatterBus {
    ctx: BaseAudioContext;
    /** Bursts connect here (the radio band + crush chain). */
    input: AudioNode;
    /** The level (proximity × Effects × cap). */
    master: GainNode;
    noise: AudioBuffer;
    dispose(): void;
}

function staircase(steps: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.round(x * steps) / steps;
    }
    return c;
}

export function createChatterBus(ctx: BaseAudioContext, destination: AudioNode, rand: () => number = Math.random): ChatterBus {
    const input = ctx.createGain();
    // The radio band: 320 Hz – 3.2 kHz, a mid presence bump, bit-crushed (a 12-level staircase), soft-limited.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 320;
    hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    lp.Q.value = 0.9;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 1400;
    peak.gain.value = 5;
    peak.Q.value = 1.2;
    const crush = ctx.createWaveShaper();
    crush.curve = staircase(12);
    const post = ctx.createBiquadFilter();
    post.type = 'lowpass';
    post.frequency.value = 4200;
    const master = ctx.createGain();
    master.gain.value = 0;
    input.connect(hp).connect(peak).connect(lp).connect(crush).connect(post).connect(master).connect(destination);
    const len = Math.floor(ctx.sampleRate * 2);
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = rand() * 2 - 1;
    const nodes: AudioNode[] = [input, hp, peak, lp, crush, post, master];
    return {
        ctx,
        input,
        master,
        noise,
        dispose(): void {
            for (const n of nodes) n.disconnect();
        },
    };
}

function noiseSource(bus: ChatterBus, t0: number, dur: number, rand: () => number): AudioBufferSourceNode {
    const src = bus.ctx.createBufferSource();
    src.buffer = bus.noise;
    src.loop = true;
    src.start(t0, rand() * 1.5, dur + 0.05);
    return src;
}

function panner(bus: ChatterBus, pan: number): AudioNode {
    const ctx = bus.ctx;
    if (typeof ctx.createStereoPanner !== 'function') return bus.input;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(bus.input);
    return p;
}

/** Garbled machine speech: noise through a stepped band-pass (formant jumps every 35–90 ms), gated in syllables. */
function garble(bus: ChatterBus, out: AudioNode, t0: number, dur: number, rand: () => number): void {
    const ctx = bus.ctx;
    const src = noiseSource(bus, t0, dur, rand);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 5 + rand() * 6;
    const g = ctx.createGain();
    g.gain.value = 0;
    // A ring-mod style buzz on top: a square carrier multiplying the band (robotic timbre).
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 70 + rand() * 90;
    const ring = ctx.createGain();
    ring.gain.value = 0.5;
    osc.connect(ring.gain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    let t = t0;
    while (t < t0 + dur) {
        const step = 0.035 + rand() * 0.055;
        bp.frequency.setValueAtTime(500 + rand() * 2300, t);
        const on = rand() < 0.72;
        g.gain.setValueAtTime(on ? 0.55 + rand() * 0.45 : 0.02, t);
        t += step;
    }
    g.gain.setValueAtTime(0, t0 + dur);
    src.connect(bp).connect(ring).connect(g).connect(out);
}

/** A data chirp: 1–4 short square / sine tones (40–120 ms) on a stepped pitch. */
function chirps(bus: ChatterBus, out: AudioNode, t0: number, rand: () => number): number {
    const ctx = bus.ctx;
    const n = 1 + Math.floor(rand() * 4);
    let t = t0;
    const base = 700 + rand() * 1400;
    for (let i = 0; i < n; i++) {
        const d = 0.04 + rand() * 0.08;
        const o = ctx.createOscillator();
        o.type = rand() < 0.6 ? 'square' : 'sine';
        o.frequency.value = base * (rand() < 0.5 ? 1 : rand() < 0.5 ? 1.5 : 0.75);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(o.type === 'square' ? 0.14 : 0.28, t + 0.004);
        g.gain.setValueAtTime(o.type === 'square' ? 0.14 : 0.28, t + d - 0.006);
        g.gain.linearRampToValueAtTime(0, t + d);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + d + 0.01);
        t += d + 0.02 + rand() * 0.05;
    }
    return t - t0;
}

/** A squelch click (a 2–4 ms noise tick). */
function click(bus: ChatterBus, out: AudioNode, t: number, rand: () => number, level = 0.6): void {
    const ctx = bus.ctx;
    const src = noiseSource(bus, t, 0.01, rand);
    const g = ctx.createGain();
    const d = 0.002 + rand() * 0.002;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    g.gain.setValueAtTime(0, t + d + 0.001);
    src.connect(g).connect(out);
}

/** Static: a hiss bed (high-passed noise) under a burst, with a squelch tail. */
function hiss(bus: ChatterBus, out: AudioNode, t0: number, dur: number, rand: () => number): void {
    const ctx = bus.ctx;
    const src = noiseSource(bus, t0, dur + 0.25, rand);
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 1800 + rand() * 1200;
    const g = ctx.createGain();
    const lvl = 0.06 + rand() * 0.06;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(lvl, t0 + 0.02);
    g.gain.setValueAtTime(lvl, t0 + dur);
    g.gain.linearRampToValueAtTime(lvl * 2.2, t0 + dur + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur + 0.22);
    src.connect(hpf).connect(g).connect(out);
}

/** One transmission at t0 (seconds, context time): returns its length. */
export function playChatterBurst(bus: ChatterBus, t0: number, rand: () => number): number {
    const out = panner(bus, (rand() - 0.5) * 1.2);
    const kind = rand();
    let dur: number;
    click(bus, out, t0, rand);
    if (kind < 0.5) {
        dur = 0.25 + rand() * 1.1;
        garble(bus, out, t0 + 0.01, dur, rand);
        if (rand() < 0.4) chirps(bus, out, t0 + dur + 0.03, rand);
    } else if (kind < 0.8) {
        dur = chirps(bus, out, t0 + 0.01, rand);
        if (rand() < 0.5) {
            const g = 0.15 + rand() * 0.4;
            garble(bus, out, t0 + dur + 0.02, g, rand);
            dur += g + 0.02;
        }
    } else {
        // Clicks and broken static only (a dead channel keyed open).
        dur = 0.2 + rand() * 0.6;
        const n = 3 + Math.floor(rand() * 8);
        for (let i = 0; i < n; i++) click(bus, out, t0 + rand() * dur, rand, 0.3 + rand() * 0.5);
    }
    hiss(bus, out, t0, dur, rand);
    click(bus, out, t0 + dur + 0.005, rand, 0.4);
    return dur + 0.25;
}

/** Gap before the next transmission (0.35–3.8 s, sometimes a quick back-and-forth). Pure over `rand`. */
export function chatterGap(rand: () => number): number {
    return rand() < 0.3 ? 0.12 + rand() * 0.3 : 0.6 + rand() * rand() * 3.2;
}

/** Schedules transmissions on `bus` over [from, to) (context seconds); returns the next start time. */
export function scheduleChatter(bus: ChatterBus, from: number, to: number, rand: () => number): number {
    let t = from;
    while (t < to) t += playChatterBurst(bus, t, rand) + chatterGap(rand);
    return t;
}

// ---------------------------------------------------------------------------------------------------------------
// Game glue
// ---------------------------------------------------------------------------------------------------------------

/** One per game view: update() once per rendered frame, dispose() with the audio graph. */
export class ProbeChatter {
    private bus: ChatterBus | null = null;
    private nextAt = 0;
    private level = 0;
    private refreshAt = -1;
    private target = 0;

    constructor(
        private readonly context: () => AudioContext,
        private readonly rand: () => number = Math.random,
    ) {}

    /** `fx`: the Effects volume 0..1 (0 when muted); `nowS`: a monotonic wall clock (s). */
    update(galaxy: Galaxy, view: ChatterView, fx: number, nowS: number): void {
        if (nowS >= this.refreshAt) {
            this.refreshAt = nowS + REFRESH_S;
            this.level = swarmChatterLevel(galaxy, view);
        }
        const target = CHATTER_MAX_GAIN * this.level * Math.max(0, Math.min(1, fx));
        if (this.bus === null && target <= 0) return;
        try {
            if (this.bus === null) {
                const ctx = this.context();
                this.bus = createChatterBus(ctx, ctx.destination, this.rand);
                this.nextAt = ctx.currentTime + 0.3;
            }
            const ctx = this.bus.ctx as AudioContext;
            if (Math.abs(target - this.target) > 1e-4) {
                this.bus.master.gain.setTargetAtTime(target, ctx.currentTime, FADE_TAU_S);
                this.target = target;
            }
            if (target <= 0) {
                // Silent: no new transmissions (the tail of the current one fades with the bus).
                this.nextAt = Math.max(this.nextAt, ctx.currentTime);
                return;
            }
            if (ctx.state === 'suspended') void ctx.resume();
            if (this.nextAt < ctx.currentTime) this.nextAt = ctx.currentTime + 0.05;
            if (this.nextAt < ctx.currentTime + 0.25) this.nextAt = scheduleChatter(this.bus, this.nextAt, ctx.currentTime + 0.25, this.rand);
        } catch {
            // no Web Audio
        }
    }

    dispose(): void {
        this.bus?.dispose();
        this.bus = null;
    }
}
