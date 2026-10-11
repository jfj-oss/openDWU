// 19i "Rim atmosphere" data/wiring — audio items 8 (music mood), 9 (sparse wind + underwater ambient bed) and 10 (voice static +
// distress-call ticker, ticker half in src/sim/scenario/rimDistressCalls.ts). Flag `rimAtmosphere`
// (scenarios/rim-atmosphere/scenario.json) off, or no scenario: every function below returns its "off" value
// (0 / null / the original pool) and the runtime classes never touch the Web Audio graph — no-op, per package spec.
//
// Deliberately no Galaxy / render import here (unlike src/audio/rimAtmosphereGeometry.ts, which reads the rim curve
// from src/render/rimAtmosphereLayer.ts — not edited here, a sibling package is reworking that file's dust lanes):
// this module's functions all take an already-computed weight/probability, so musicPlayer.ts (used before any
// galaxy exists, e.g. the main-menu theme) can call pickRimWeightedTrack without pulling in pixi.js. (The ambient
// bed's voices live in rimCreatureSynth.ts — Web Audio only, no render import.)
//
// Creature calls / hull creaks (item 9's other two clauses): $DWU/Sounds/Effects has no creature-call or
// hull/creak file of any kind, so (audio addendum) both are synthesised at runtime — see rimCreatureCalls.ts (pure
// tables + trigger rules), rimCreatureSynth.ts (Web Audio voices) and rimCreatureAudio.ts (game glue).

import { createRimSynthBus, playAmbientEvent, startAmbientRumble, type AmbientEventKind, type AmbientRumble, type RimSynthBus } from './rimCreatureSynth';

// ---------------------------------------------------------------------------
// Item 8 — a "rim" music mood
// ---------------------------------------------------------------------------

/** Original tracks (musicPlayer.ts MUSIC_FILES) that fit a sparse, subdued rim mood. */
export const RIM_MOOD_TRACKS: readonly string[] = ['Shadows.mp3', 'Suspense.mp3', 'Desperate.mp3', 'Frustrated.mp3'];

/** Pure: how strongly the selector should prefer RIM_MOOD_TRACKS over the full pool, given the rim weight at the
 *  camera centre and the scenario's musicMoodWeight param (0 = never, 1 = certain once weight reaches 1). */
export function rimMoodProbability(weightAtCamera: number, musicMoodWeight: number): number {
    return Math.max(0, Math.min(1, weightAtCamera * musicMoodWeight));
}

/**
 * Port-shaped picker (mirrors musicPlayer.ts pickNextTrack's redraw-while-repeat rule): with probability
 * `moodProbability` draws from the intersection of `moodFiles` and `files`, else from all of `files`; never repeats
 * `currentFile` while `files` has more than one entry. Falls back to the full pool if the mood pool alone cannot
 * satisfy that (e.g. one mood track, which is also the current one). `rand` returns [0, 1).
 */
export function pickRimWeightedTrack(files: readonly string[], moodFiles: readonly string[], currentFile: string | null, rand: () => number, moodProbability: number): string | null {
    if (files.length === 0) return null;
    const pool = moodFiles.filter((f) => files.includes(f));
    const useMood = pool.length > 0 && rand() < moodProbability;
    let list = useMood ? pool : files;
    if (files.length > 1 && list.every((f) => f === currentFile)) list = files;
    let text = currentFile ?? '';
    while (text === '' || (files.length > 1 && text === currentFile)) {
        text = list[Math.floor(rand() * list.length)];
    }
    return text;
}

// ---------------------------------------------------------------------------
// Item 9 — the ambient bed's gain and its sparse event schedule (sparse wind + underwater / submarine)
// ---------------------------------------------------------------------------

/** The bed's master gain at ambientGain 1 and full rim depth: a hard cap well under the music. */
export const RIM_AMBIENT_MAX_GAIN = 0.25;
/** The manifest's ambientGain default (scenarios/rim-atmosphere/scenario.json). */
export const RIM_AMBIENT_DEFAULT_GAIN = 0.4;
/** The rim depth ramp: gain follows weight^this (gentle: half-way into the band gives ~a third of the level). */
export const RIM_AMBIENT_DEPTH_EXPONENT = 1.6;

/** Pure: the ambient bed's master gain (0..RIM_AMBIENT_MAX_GAIN), following the rim weight at the camera centre on a
 *  gentle curve and the scenario's ambientGain param (0..1: share of the cap once fully past the rim band). */
export function rimAmbientBedGain(weightAtCamera: number, ambientGain: number): number {
    const w = Math.max(0, Math.min(1, weightAtCamera));
    return RIM_AMBIENT_MAX_GAIN * Math.max(0, Math.min(1, ambientGain)) * Math.pow(w, RIM_AMBIENT_DEPTH_EXPONENT);
}

/** One kind of sparse ambient event: its mean period at full rim depth and the least time between two of it. */
export interface AmbientEventSpec {
    kind: AmbientEventKind;
    meanPeriodS: number;
    minGapS: number;
}

/** Mostly near-silence: together about one event every ~20 s deep in the rim (a few times sparser near its edge). */
export const AMBIENT_EVENTS: readonly AmbientEventSpec[] = [
    { kind: 'gust', meanPeriodS: 40, minGapS: 22 },
    { kind: 'bubbles', meanPeriodS: 50, minGapS: 25 },
    { kind: 'groan', meanPeriodS: 60, minGapS: 30 },
    { kind: 'ping', meanPeriodS: 80, minGapS: 45 },
    { kind: 'whale', meanPeriodS: 180, minGapS: 90 },
];
/** Never two ambient events closer than this. */
export const AMBIENT_MIN_GAP_S = 9;
/** Share of the full-depth event rate left at the very edge of the rim (weight → 0): denser deeper in. */
export const AMBIENT_EDGE_RATE_FRACTION = 0.3;
/** No events until the camera is this deep (the rumble alone fades in before). */
export const AMBIENT_EVENT_MIN_WEIGHT = 0.15;

/** Pure: events per second of `spec` at a camera rim weight. */
export function ambientEventRate(spec: AmbientEventSpec, weight: number): number {
    const w = Math.max(0, Math.min(1, weight));
    if (w < AMBIENT_EVENT_MIN_WEIGHT) return 0;
    return (1 / spec.meanPeriodS) * (AMBIENT_EDGE_RATE_FRACTION + (1 - AMBIENT_EDGE_RATE_FRACTION) * w);
}

export interface AmbientEvent {
    kind: AmbientEventKind;
    /** Clock time (s) the event starts. */
    atS: number;
    pan: number;
    /** Per-event level, 0.55..1 (on top of the bed's master gain). */
    level: number;
}

/** Pure per-step scheduler for the ambient events (Poisson per kind, with per-kind and global gaps). `rand` in [0, 1). */
export class RimAmbientScheduler {
    private lastByKind = new Map<AmbientEventKind, number>();
    private lastS = -Infinity;

    step(nowS: number, dtS: number, weight: number, rand: () => number): AmbientEvent[] {
        const dt = Math.max(0, Math.min(0.5, dtS));
        if (!(dt > 0) || nowS - this.lastS < AMBIENT_MIN_GAP_S) return [];
        for (const spec of AMBIENT_EVENTS) {
            const last = this.lastByKind.get(spec.kind) ?? -Infinity;
            if (nowS - last < spec.minGapS) continue;
            const rate = ambientEventRate(spec, weight);
            if (rate > 0 && rand() < 1 - Math.exp(-rate * dt)) {
                this.lastByKind.set(spec.kind, nowS);
                this.lastS = nowS;
                return [{ kind: spec.kind, atS: nowS, pan: (rand() * 2 - 1) * 0.7, level: 0.55 + 0.45 * rand() }];
            }
        }
        return [];
    }
}

/** The ambient bed's synth bus: a long, dark impulse (the sonar tail) and a muffling master lowpass. */
const AMBIENT_BUS = { impulseS: 7, decayS: 2.2, reverbLevel: 0.9, lowpassHz: 2600 } as const;

// ---------------------------------------------------------------------------
// Item 10 — voice static gain + minimap dimming (item 13's tail, exported for the pure-function tests)
// ---------------------------------------------------------------------------

/** Pure: the faint static layer's gain (0..RIM_STATIC_MAX_GAIN) under advisor/diplomacy voice playback, following
 *  whichever of the camera or the speaking empire's capital sits deeper in the fog (the greater of the two weights,
 *  squared: little until deep in the band) and the scenario's staticGain param. Pass 0 for either weight when it is not available (e.g. no camera at that call
 *  site: the capital-only check still applies). */
export function rimVoiceStaticGain(cameraWeight: number, capitalWeight: number, staticGain: number): number {
    const w = Math.max(0, Math.min(1, Math.max(cameraWeight, capitalWeight)));
    return RIM_STATIC_MAX_GAIN * Math.max(0, Math.min(1, staticGain)) * w * w;
}

/** The voice static's gain at staticGain 1 and full depth (a soft hiss under the voice, never over it). */
export const RIM_STATIC_MAX_GAIN = 0.12;

/** Item 13's tail (design note "minimap dims the outer band"): the alpha multiplier for a minimap icon/region at
 *  this rim weight (1 = undimmed). No minimap render target exists yet in this codebase (checked src/render and
 *  src/ui — only a scenario-unrelated "replaces the minimap" HUD-layout comment); ready to multiply an icon's alpha
 *  by once one does. */
export function minimapRimDimAlpha(weight: number, dimStrength: number): number {
    return Math.max(0, Math.min(1, 1 - dimStrength * weight));
}

// ---------------------------------------------------------------------------
// Web Audio graph: a noise source → gain (no asset file; the first-pass wind bed, kept for the voice-static seam
// and A/B renders)
// ---------------------------------------------------------------------------

export interface NoiseBed {
    /** Sets the bed's gain (clamped 0..1). */
    setGain(g: number): void;
    dispose(): void;
}

/** A `seconds`-long looping noise buffer, generated once from `rand` (Math.random by default; tests inject a seeded
 *  source for determinism — the audio graph itself is never asserted on, only that setGain forwards correctly). */
function noiseBuffer(ctx: BaseAudioContext, seconds: number, rand: () => number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
    return buffer;
}

/** Continuous noise bed: BufferSource (looping) → BiquadFilter → GainNode (starts at 0) → destination. `filterType`
 *  / `filterHz` shape the source's colour — a lowpass for the wind bed (item 9), a highpass for the sharper voice
 *  static (item 10). */
export function createNoiseBed(ctx: BaseAudioContext, filterType: BiquadFilterType, filterHz: number, rand: () => number = Math.random): NoiseBed {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 4, rand);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterHz;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    let disposed = false;
    return {
        setGain(g: number): void {
            if (!disposed) gain.gain.value = Math.max(0, Math.min(1, g));
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            try {
                src.stop();
            } catch {
                // already stopped
            }
            src.disconnect();
            filter.disconnect();
            gain.disconnect();
        },
    };
}

/** The ambient bed (item 9): sparse wind + underwater / submarine, all synthesised — a very quiet continuous
 *  deep-water rumble plus rare events (slow distant gusts, sonar-like pings with a long tail, deep hull groans,
 *  bubbling / pressure hiss, very rare whale-like calls) spaced tens of seconds apart, a little denser deeper in the
 *  rim. One lazily-created graph per game view; update() every frame. Creature calls and hull creaks:
 *  rimCreatureAudio.ts. */
export class RimAmbientBed {
    private bus: RimSynthBus | null = null;
    private rumble: AmbientRumble | null = null;
    private readonly scheduler = new RimAmbientScheduler();
    private lastS: number | null = null;

    constructor(
        private readonly contextFactory: () => AudioContext = () => new AudioContext(),
        private readonly rand: () => number = Math.random,
    ) {}

    /** Call once per rendered frame with the camera's rim weight and the scenario's ambientGain param. No-op
     *  (never creates an AudioContext) while the gain would be 0, so a game with the flag off never touches audio. */
    update(weightAtCamera: number, ambientGain: number): void {
        const gain = rimAmbientBedGain(weightAtCamera, ambientGain);
        if (this.bus === null) {
            if (gain <= 0) return;
            try {
                const ctx = this.contextFactory();
                this.bus = createRimSynthBus(ctx, ctx.destination, this.rand, AMBIENT_BUS);
                this.bus.master.gain.value = 0;
                this.rumble = startAmbientRumble(this.bus, ctx.currentTime, this.rand);
            } catch {
                return; // no Web Audio (tests / unsupported)
            }
        }
        try {
            const ctx = this.bus.ctx;
            const now = ctx.currentTime;
            // Glide (no zipper noise as the camera moves).
            this.bus.master.gain.setTargetAtTime(gain, now, 0.5);
            const dt = this.lastS === null ? 0 : now - this.lastS;
            this.lastS = now;
            if (gain > 0) {
                for (const e of this.scheduler.step(now, dt, weightAtCamera, this.rand)) playAmbientEvent(this.bus, e.kind, now + 0.05, e.pan, e.level, this.rand);
            }
        } catch {
            // no audio
        }
    }

    dispose(): void {
        this.rumble?.stop();
        this.rumble = null;
        this.bus?.dispose();
        this.bus = null;
    }
}

/** Offline render of the bed (audio previews / measurement, scripts in the agent scratch): `seconds` of the bed at a
 *  fixed camera rim weight on any BaseAudioContext, through the same bus, rumble, scheduler and voices as the live
 *  bed. Returns the scheduled events. */
export function renderRimAmbientOffline(ctx: BaseAudioContext, seconds: number, weight: number, ambientGain: number, rand: () => number, stepS = 1 / 30): AmbientEvent[] {
    const bus = createRimSynthBus(ctx, ctx.destination, rand, AMBIENT_BUS);
    bus.master.gain.value = rimAmbientBedGain(weight, ambientGain);
    startAmbientRumble(bus, 0, rand);
    const scheduler = new RimAmbientScheduler();
    const out: AmbientEvent[] = [];
    for (let t = stepS; t < seconds - 2; t += stepS) {
        for (const e of scheduler.step(t, stepS, weight, rand)) {
            playAmbientEvent(bus, e.kind, t, e.pan, e.level, rand);
            out.push(e);
        }
    }
    return out;
}

/** Item 10: a short, soft static burst mixed under one diplomacy/advisor sting (gameAudio.ts playDiplomacyMood):
 *  band-limited noise faded in and out (no hard edges). Plays and disposes itself; a no-op at gain 0 (never creates
 *  an AudioContext). `contextFactory` is a test seam. */
export function playRimVoiceStaticBurst(gain: number, durationSeconds = 3, contextFactory: () => AudioContext = () => new AudioContext(), rand: () => number = Math.random): void {
    if (gain <= 0) return;
    try {
        const ctx = contextFactory();
        const dur = Math.max(0.5, durationSeconds);
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx, 2, rand);
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2600;
        bp.Q.value = 0.6;
        const g = ctx.createGain();
        const t0 = ctx.currentTime;
        const peak = Math.max(0, Math.min(RIM_STATIC_MAX_GAIN, gain));
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.4);
        g.gain.setValueAtTime(peak, t0 + dur - 0.8);
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        src.connect(bp).connect(g).connect(ctx.destination);
        src.start(t0);
        src.stop(t0 + dur + 0.05);
        src.onended = () => {
            src.disconnect();
            bp.disconnect();
            g.disconnect();
        };
    } catch {
        // no Web Audio (tests / unsupported) — the sting itself still plays
    }
}
