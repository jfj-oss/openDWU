// 19i audio addendum — the Web Audio synthesis of the creature calls and hull creaks (no audio files: oscillators,
// generated noise buffers, biquad formant/resonator banks, gain envelopes and a convolution reverb whose impulse is
// generated here). Works on any BaseAudioContext, so the same code renders live (AudioContext, rimCreatureAudio.ts)
// and offline (OfflineAudioContext, scripts/rim-voices-render.mjs). Parameters come from the pure tables in
// rimCreatureCalls.ts; `rand` is injected so offline renders are reproducible.

import { CREAK_VOICE, creatureVoice, inRange, type BellowVoice, type ClickChirpVoice, type CreakVoice, type CreatureVoice, type KeenVoice, type ShimmerVoice } from './rimCreatureCalls';
import type { CreatureType } from '../sim/creature';

// ---------------------------------------------------------------------------
// Shared bus: voices → (dry + reverb send) → gentle compressor → master gain → destination
// ---------------------------------------------------------------------------

export interface RimSynthBus {
    readonly ctx: BaseAudioContext;
    /** Dry input (each voice's panner connects here). */
    readonly input: GainNode;
    /** Reverb send input. */
    readonly reverbIn: GainNode;
    /** Master gain after the compressor (the effects volume is applied per voice, this stays 1). */
    readonly master: GainNode;
    dispose(): void;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A 2 s white-noise buffer per context (generated once). */
function noiseBuffer(ctx: BaseAudioContext, rand: () => number): AudioBuffer {
    let b = noiseCache.get(ctx);
    if (b === undefined) {
        b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2), ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
        noiseCache.set(ctx, b);
    }
    return b;
}

/** A generated stereo impulse: exponentially decaying noise that darkens as it decays (a cold, wide space). */
export function spaceImpulse(ctx: BaseAudioContext, rand: () => number, seconds = 2.6, decayS = 0.75): AudioBuffer {
    const n = Math.round(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    const preDelay = Math.round(ctx.sampleRate * 0.02);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = preDelay; i < n; i++) {
            const t = (i - preDelay) / ctx.sampleRate;
            // One-pole lowpass whose cutoff falls with time: bright early reflections, dark tail.
            const a = 0.15 + 0.8 * Math.min(1, t / seconds);
            lp = lp * a + (rand() * 2 - 1) * (1 - a);
            d[i] = lp * Math.exp(-t / decayS) * 2.2;
        }
    }
    return buf;
}

export function createRimSynthBus(ctx: BaseAudioContext, destination: AudioNode, rand: () => number = Math.random): RimSynthBus {
    const input = ctx.createGain();
    const reverbIn = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = spaceImpulse(ctx, rand);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.015;
    comp.release.value = 0.35;
    const master = ctx.createGain();
    master.gain.value = 1;
    input.connect(comp);
    reverbIn.connect(convolver).connect(reverbOut).connect(comp);
    comp.connect(master).connect(destination);
    return {
        ctx,
        input,
        reverbIn,
        master,
        dispose(): void {
            for (const n of [input, reverbIn, convolver, reverbOut, comp, master]) n.disconnect();
        },
    };
}

// ---------------------------------------------------------------------------
// Voice plumbing
// ---------------------------------------------------------------------------

interface VoiceOut {
    /** The voice's sum (connect the voice's graph into this). */
    sum: GainNode;
    /** Every node created, disconnected when the last source ends. */
    nodes: AudioNode[];
    sources: AudioScheduledSourceNode[];
}

function voiceOut(bus: RimSynthBus, pan: number, gain: number, reverbSend: number): VoiceOut {
    const ctx = bus.ctx;
    const sum = ctx.createGain();
    sum.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    const send = ctx.createGain();
    send.gain.value = reverbSend;
    sum.connect(panner);
    panner.connect(bus.input);
    panner.connect(send).connect(bus.reverbIn);
    return { sum, nodes: [sum, panner, send], sources: [] };
}

function track<T extends AudioNode>(v: VoiceOut, n: T): T {
    v.nodes.push(n);
    if (n instanceof AudioScheduledSourceNode) v.sources.push(n);
    return n;
}

/** Disconnect the whole voice once its last source has ended (live contexts; harmless offline). */
function finish(v: VoiceOut, endTime: number): number {
    let remaining = v.sources.length;
    for (const s of v.sources) {
        s.onended = () => {
            remaining--;
            if (remaining <= 0) for (const n of v.nodes) n.disconnect();
        };
    }
    return endTime;
}

function noiseSource(ctx: BaseAudioContext, v: VoiceOut, rand: () => number): AudioBufferSourceNode {
    const s = track(v, ctx.createBufferSource());
    s.buffer = noiseBuffer(ctx, rand);
    s.loop = true;
    return s;
}

function osc(ctx: BaseAudioContext, v: VoiceOut, type: OscillatorType, hz: number): OscillatorNode {
    const o = track(v, ctx.createOscillator());
    o.type = type;
    o.frequency.value = hz;
    return o;
}

function filter(ctx: BaseAudioContext, v: VoiceOut, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
    const f = track(v, ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
}

function gainNode(ctx: BaseAudioContext, v: VoiceOut, g: number): GainNode {
    const n = track(v, ctx.createGain());
    n.gain.value = g;
    return n;
}

/** Attack / hold / release envelope on `p` (linear attack, exponential release to silence). */
function envelope(p: AudioParam, t0: number, dur: number, attack: number, release: number, peak = 1, sustain = peak): void {
    p.setValueAtTime(0, t0);
    p.linearRampToValueAtTime(peak, t0 + attack);
    p.linearRampToValueAtTime(sustain, Math.max(t0 + attack, t0 + dur - release));
    p.exponentialRampToValueAtTime(0.0001, t0 + dur);
    p.setValueAtTime(0, t0 + dur + 0.001);
}

// ---------------------------------------------------------------------------
// Kaltor: low bellow
// ---------------------------------------------------------------------------

function bellow(bus: RimSynthBus, p: BellowVoice, t0: number, pan: number, gain: number, rand: () => number): number {
    const ctx = bus.ctx;
    const v = voiceOut(bus, pan, gain * p.level, p.reverbSend);
    const dur = inRange(p.durationS, rand);
    const base = inRange(p.baseHz, rand);
    const tRise = t0 + dur * 0.33;
    const tEnd = t0 + dur;
    const pitch = (o: OscillatorNode, mul: number): void => {
        o.frequency.setValueAtTime(base * mul, t0);
        o.frequency.linearRampToValueAtTime(base * mul * p.riseRatio, tRise);
        o.frequency.exponentialRampToValueAtTime(base * mul * p.fallRatio, tEnd);
    };
    const saw = osc(ctx, v, 'sawtooth', base);
    pitch(saw, 1);
    const sub = osc(ctx, v, 'sine', base / 2);
    pitch(sub, 0.5);
    // Slow vibrato on both (an AudioParam input adds to the automated value).
    const lfo = osc(ctx, v, 'sine', inRange(p.vibratoHz, rand));
    const vibSaw = gainNode(ctx, v, base * p.vibratoDepth);
    const vibSub = gainNode(ctx, v, base * 0.5 * p.vibratoDepth);
    lfo.connect(vibSaw).connect(saw.frequency);
    lfo.connect(vibSub).connect(sub.frequency);

    const amp = gainNode(ctx, v, 0);
    envelope(amp.gain, t0, dur, p.attackS, p.releaseS, 1, 0.75);
    const tone = gainNode(ctx, v, 1);
    // Formant bank: parallel bandpasses gliding "oo" → "aa" → "oo".
    for (let i = 0; i < p.formantsStartHz.length; i++) {
        const f = filter(ctx, v, 'bandpass', p.formantsStartHz[i], p.formantQ[i]);
        f.frequency.setValueAtTime(p.formantsStartHz[i], t0);
        f.frequency.linearRampToValueAtTime(p.formantsPeakHz[i], t0 + dur * 0.4);
        f.frequency.linearRampToValueAtTime(p.formantsStartHz[i] * 1.05, tEnd);
        const g = gainNode(ctx, v, p.formantGain[i] * 3.2);
        saw.connect(f).connect(g).connect(tone);
    }
    // A little of the raw low end for the chest.
    const body = filter(ctx, v, 'lowpass', 220, 0.8);
    const bodyG = gainNode(ctx, v, 0.35);
    saw.connect(body).connect(bodyG).connect(tone);
    const subG = gainNode(ctx, v, p.subLevel);
    sub.connect(subG).connect(tone);
    // Breath.
    const nz = noiseSource(ctx, v, rand);
    const breath = filter(ctx, v, 'bandpass', 380, 1.4);
    const breathG = gainNode(ctx, v, p.breathLevel * 3);
    nz.connect(breath).connect(breathG).connect(tone);

    const lp = filter(ctx, v, 'lowpass', 1600, 0.7);
    tone.connect(lp).connect(amp).connect(v.sum);
    for (const s of [saw, sub, lfo, nz]) {
        s.start(t0);
        s.stop(tEnd + 0.05);
    }
    return finish(v, tEnd);
}

// ---------------------------------------------------------------------------
// Space slugs: wet click-chirp clusters
// ---------------------------------------------------------------------------

function clickChirp(bus: RimSynthBus, p: ClickChirpVoice, t0: number, pan: number, gain: number, rand: () => number): number {
    const ctx = bus.ctx;
    const v = voiceOut(bus, pan, gain * p.level, p.reverbSend);
    const dur = inRange(p.durationS, rand);
    const count = Math.round(inRange(p.clicks, rand));
    // Clustered onsets: short bursts of 2–4 ticks 20–60 ms apart, bursts spread over the call.
    const times: number[] = [];
    while (times.length < count) {
        let t = t0 + rand() * dur * 0.85;
        const burst = 2 + Math.floor(rand() * 3);
        for (let i = 0; i < burst && times.length < count; i++) {
            times.push(t);
            t += 0.02 + rand() * 0.04;
        }
    }
    times.sort((a, b) => a - b);
    const out = filter(ctx, v, 'lowpass', 7000, 0.7);
    out.connect(v.sum);
    const noise = noiseBuffer(ctx, rand);
    let end = t0;
    for (const t of times) {
        // Tick: a few ms of noise through a resonant bandpass.
        const len = inRange(p.tickLengthS, rand);
        const src = track(v, ctx.createBufferSource());
        src.buffer = noise;
        const bp = filter(ctx, v, 'bandpass', inRange(p.tickHz, rand), p.tickQ);
        const tg = gainNode(ctx, v, 0);
        tg.gain.setValueAtTime(0, t);
        tg.gain.linearRampToValueAtTime(6, t + 0.001);
        tg.gain.exponentialRampToValueAtTime(0.001, t + len + 0.02);
        src.connect(bp).connect(tg).connect(out);
        src.start(t, rand() * 1.5);
        src.stop(t + len + 0.03);
        // Chirp: a rising sine sweep just after the tick.
        const c0 = t + 0.004;
        const clen = inRange(p.chirpLengthS, rand);
        const f0 = inRange(p.chirpStartHz, rand);
        const co = osc(ctx, v, 'sine', f0);
        co.frequency.setValueAtTime(f0, c0);
        co.frequency.exponentialRampToValueAtTime(f0 * inRange(p.chirpRatio, rand), c0 + clen);
        const cg = gainNode(ctx, v, 0);
        cg.gain.setValueAtTime(0, c0);
        cg.gain.linearRampToValueAtTime(0.35, c0 + 0.003);
        cg.gain.exponentialRampToValueAtTime(0.001, c0 + clen);
        co.connect(cg).connect(out);
        co.start(c0);
        co.stop(c0 + clen + 0.01);
        end = Math.max(end, c0 + clen + 0.01);
        // Gloop: a low wet blip rising ~1.8×.
        if (rand() < p.gloopChance) {
            const g0 = t + 0.01;
            const gf = inRange(p.gloopHz, rand);
            const go = osc(ctx, v, 'sine', gf);
            go.frequency.setValueAtTime(gf, g0);
            go.frequency.exponentialRampToValueAtTime(gf * 1.8, g0 + 0.06);
            const gg = gainNode(ctx, v, 0);
            gg.gain.setValueAtTime(0, g0);
            gg.gain.linearRampToValueAtTime(0.5, g0 + 0.008);
            gg.gain.exponentialRampToValueAtTime(0.001, g0 + 0.09);
            go.connect(gg).connect(out);
            go.start(g0);
            go.stop(g0 + 0.1);
            end = Math.max(end, g0 + 0.1);
        }
    }
    return finish(v, end);
}

// ---------------------------------------------------------------------------
// Ardilus: thin keening sweep
// ---------------------------------------------------------------------------

function keen(bus: RimSynthBus, p: KeenVoice, t0: number, pan: number, gain: number, rand: () => number): number {
    const ctx = bus.ctx;
    const v = voiceOut(bus, pan, gain * p.level, p.reverbSend);
    const dur = inRange(p.durationS, rand);
    const f0 = inRange(p.startHz, rand);
    const fPeak = f0 * inRange(p.peakRatio, rand);
    const fEnd = f0 * inRange(p.endRatio, rand);
    const tEnd = t0 + dur;
    const glide = (o: OscillatorNode, mul: number): void => {
        o.frequency.setValueAtTime(f0 * mul, t0);
        o.frequency.exponentialRampToValueAtTime(fPeak * mul, t0 + dur * p.peakAt);
        o.frequency.exponentialRampToValueAtTime(fEnd * mul, tEnd);
    };
    const sine = osc(ctx, v, 'sine', f0);
    glide(sine, 1);
    const tri = osc(ctx, v, 'triangle', f0 * 2.01);
    glide(tri, 2.01);
    const vib = osc(ctx, v, 'sine', p.vibratoHz);
    const vibG = gainNode(ctx, v, fPeak * p.vibratoDepth);
    const vibG2 = gainNode(ctx, v, fPeak * 2.01 * p.vibratoDepth);
    vib.connect(vibG).connect(sine.frequency);
    vib.connect(vibG2).connect(tri.frequency);
    // Tremolo: gain = (1 - depth/2) + depth/2 · sin, its rate quickening through the call.
    const trem = gainNode(ctx, v, 1 - p.tremoloDepth / 2);
    const tremLfo = osc(ctx, v, 'sine', p.tremoloHz[0]);
    const tr0 = inRange(p.tremoloHz, rand);
    tremLfo.frequency.setValueAtTime(tr0 * 0.8, t0);
    tremLfo.frequency.linearRampToValueAtTime(tr0 * 1.2, tEnd);
    const tremDepth = gainNode(ctx, v, p.tremoloDepth / 2);
    tremLfo.connect(tremDepth).connect(trem.gain);
    const triG = gainNode(ctx, v, p.overtoneLevel);
    const hp = filter(ctx, v, 'highpass', p.highpassHz, 0.7);
    const amp = gainNode(ctx, v, 0);
    envelope(amp.gain, t0, dur, p.attackS, p.releaseS, 1, 0.7);
    sine.connect(trem);
    tri.connect(triG).connect(trem);
    trem.connect(hp).connect(amp).connect(v.sum);
    for (const s of [sine, tri, vib, tremLfo]) {
        s.start(t0);
        s.stop(tEnd + 0.05);
    }
    return finish(v, tEnd);
}

// ---------------------------------------------------------------------------
// Silver Mist: shimmering granular texture
// ---------------------------------------------------------------------------

function shimmer(bus: RimSynthBus, p: ShimmerVoice, t0: number, pan: number, gain: number, rand: () => number): number {
    const ctx = bus.ctx;
    const v = voiceOut(bus, pan, gain * p.level, p.reverbSend);
    const dur = inRange(p.durationS, rand);
    const n = Math.round(inRange(p.partials, rand));
    const base = inRange(p.baseHz, rand);
    const tEnd = t0 + dur;
    const amp = gainNode(ctx, v, 0);
    envelope(amp.gain, t0, dur, p.attackS, p.releaseS);
    const hp = filter(ctx, v, 'highpass', 900, 0.7);
    hp.connect(amp).connect(v.sum);
    const partialGain = 2.4 / n;
    const steps = Math.max(2, Math.round(dur * p.breakpointsPerS));
    for (let i = 0; i < n; i++) {
        const ratio = p.ratios[Math.floor(rand() * p.ratios.length)];
        const cents = (rand() * 2 - 1) * p.detuneCents;
        const o = osc(ctx, v, 'sine', base * ratio);
        o.detune.setValueAtTime(cents, t0);
        o.detune.linearRampToValueAtTime(cents + (rand() * 2 - 1) * 6, tEnd);
        // Slow random amplitude: a breakpoint every 1/breakpointsPerS s, squared for sparse glints.
        const g = gainNode(ctx, v, 0);
        g.gain.setValueAtTime(0, t0);
        for (let k = 1; k <= steps; k++) {
            const r = rand();
            g.gain.linearRampToValueAtTime(partialGain * r * r, t0 + (dur * k) / steps);
        }
        const pn = track(v, ctx.createStereoPanner());
        pn.pan.value = (rand() * 2 - 1) * p.stereoSpread;
        o.connect(g).connect(pn).connect(hp);
        o.start(t0);
        o.stop(tEnd + 0.05);
    }
    return finish(v, tEnd);
}

// ---------------------------------------------------------------------------
// Hull creak
// ---------------------------------------------------------------------------

/** A hull creak: resonant noise body with a slow pitch drop and stick-slip grain, plus a struck metallic ring. */
export function playCreak(bus: RimSynthBus, t0: number, pan: number, gain: number, rand: () => number, p: CreakVoice = CREAK_VOICE): number {
    const ctx = bus.ctx;
    const v = voiceOut(bus, pan, gain * p.level, p.reverbSend);
    const dur = inRange(p.durationS, rand);
    const tEnd = t0 + dur;
    const fStart = inRange(p.bodyStartHz, rand);
    const fEnd = fStart * inRange(p.dropRatio, rand);
    const lp = filter(ctx, v, 'lowpass', p.lowpassHz, 0.7);
    lp.connect(v.sum);

    // Body: two resonances on noise, gliding down together.
    const nz = noiseSource(ctx, v, rand);
    const b1 = filter(ctx, v, 'bandpass', fStart, p.bodyQ);
    b1.frequency.setValueAtTime(fStart, t0);
    b1.frequency.exponentialRampToValueAtTime(fEnd, tEnd);
    const b2 = filter(ctx, v, 'bandpass', fStart * p.bodyOvertone, p.bodyQ * 0.7);
    b2.frequency.setValueAtTime(fStart * p.bodyOvertone, t0);
    b2.frequency.exponentialRampToValueAtTime(fEnd * p.bodyOvertone, tEnd);
    const b1g = gainNode(ctx, v, 26);
    const b2g = gainNode(ctx, v, 5);
    // Stick-slip grain: irregular amplitude pulses (the "ratchet" of a creak), their rate slowing with the pitch.
    const grain = gainNode(ctx, v, 1 - p.grainDepth);
    const g0 = inRange(p.grainHz, rand);
    let t = t0;
    while (t < tEnd) {
        const rate = g0 * (1 - 0.4 * ((t - t0) / dur));
        const period = (1 / rate) * (0.6 + rand() * 0.8);
        const hit = 1 - p.grainDepth + p.grainDepth * (0.5 + 0.5 * rand());
        grain.gain.setValueAtTime(hit, t);
        grain.gain.exponentialRampToValueAtTime(Math.max(0.01, 1 - p.grainDepth), t + period * 0.9);
        t += period;
    }
    const amp = gainNode(ctx, v, 0);
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(1, t0 + p.attackS);
    amp.gain.linearRampToValueAtTime(0.7, t0 + dur * 0.7);
    amp.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    nz.connect(b1).connect(b1g).connect(grain);
    nz.connect(b2).connect(b2g).connect(grain);
    grain.connect(amp).connect(lp);
    nz.start(t0, rand() * 1.5);
    nz.stop(tEnd + 0.05);

    // Metallic ring: a short noise strike into a high-Q biquad bank at free-bar ratios, struck at the onset and
    // (sometimes) again at a slip mid-creak.
    const ringBase = inRange(p.ringBaseHz, rand);
    const ringDecay = inRange(p.ringDecayS, rand);
    const strikes = rand() < 0.5 ? [t0] : [t0, t0 + dur * (0.35 + rand() * 0.4)];
    let end = tEnd;
    for (const ts of strikes) {
        const strike = track(v, ctx.createBufferSource());
        strike.buffer = noiseBuffer(ctx, rand);
        const sg = gainNode(ctx, v, 0);
        sg.gain.setValueAtTime(1, ts);
        sg.gain.exponentialRampToValueAtTime(0.001, ts + 0.006);
        const ring = gainNode(ctx, v, 0);
        ring.gain.setValueAtTime(p.ringLevel, ts);
        ring.gain.exponentialRampToValueAtTime(0.0005, ts + ringDecay);
        strike.connect(sg);
        for (let i = 0; i < p.ringRatios.length; i++) {
            const bp = filter(ctx, v, 'bandpass', ringBase * p.ringRatios[i], p.ringQ);
            const bg = gainNode(ctx, v, 40 / Math.pow(i + 1, 1.6));
            sg.connect(bp).connect(bg).connect(ring);
        }
        ring.connect(lp);
        strike.start(ts, rand() * 1.5);
        strike.stop(ts + 0.01);
        end = Math.max(end, ts + ringDecay);
    }
    // Keep the ring bank alive past its strike: a silent carrier holds the voice until the ring has decayed.
    const hold = osc(ctx, v, 'sine', 1);
    const holdG = gainNode(ctx, v, 0);
    hold.connect(holdG).connect(lp);
    hold.start(t0);
    hold.stop(end + 0.05);
    return finish(v, end);
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Play one creature voice at `t0` (context time); returns its end time, or null for a silent type. */
export function playCreatureVoice(bus: RimSynthBus, voice: CreatureVoice, t0: number, pan: number, gain: number, rand: () => number): number {
    switch (voice.kind) {
        case 'bellow':
            return bellow(bus, voice, t0, pan, gain, rand);
        case 'clickChirp':
            return clickChirp(bus, voice, t0, pan, gain, rand);
        case 'keen':
            return keen(bus, voice, t0, pan, gain, rand);
        case 'shimmer':
            return shimmer(bus, voice, t0, pan, gain, rand);
    }
}

/** Play a creature type's call (null for CreatureType.Undefined). */
export function playCreatureCall(bus: RimSynthBus, type: CreatureType, t0: number, pan: number, gain: number, rand: () => number): number | null {
    const voice = creatureVoice(type);
    return voice === null ? null : playCreatureVoice(bus, voice, t0, pan, gain, rand);
}
