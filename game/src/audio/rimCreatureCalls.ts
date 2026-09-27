// 19i audio addendum — distant creature calls and hull creaks at system zoom (scenario flag `rimAtmosphere`,
// scenarios/rim-atmosphere/scenario.json). The original ships no creature or hull sounds and no audio file is ever
// committed: every voice is synthesised at runtime (src/audio/rimCreatureSynth.ts). This module is the PURE half —
// voice parameter tables, trigger rates / cooldowns, distance / pan / gain maths and the per-frame scheduler — so it
// can be tested without an AudioContext. No Galaxy, render or Web Audio import here; the game glue
// (src/audio/rimCreatureAudio.ts) feeds it plain numbers.

import { CreatureType } from '../sim/creature';

// ---------------------------------------------------------------------------
// Voice parameter tables (read by the synth; one voice per CreatureType)
// ---------------------------------------------------------------------------

export type Range = readonly [number, number];

/** Kaltor: a low bellow — sawtooth + sub-octave sine through a formant bank, slow vibrato and a groan contour. */
export interface BellowVoice {
    kind: 'bellow';
    durationS: Range;
    /** Fundamental of the glottal sawtooth. */
    baseHz: Range;
    /** Formant centres (bandpass bank) at the start and at the peak of the call (they glide "oo" → "aa" → "oo"). */
    formantsStartHz: readonly number[];
    formantsPeakHz: readonly number[];
    formantQ: readonly number[];
    formantGain: readonly number[];
    /** Pitch contour: rises by `riseRatio` over the first third, then falls to `fallRatio` × base at the end. */
    riseRatio: number;
    fallRatio: number;
    vibratoHz: Range;
    /** Vibrato depth as a fraction of the pitch. */
    vibratoDepth: number;
    /** Level of the sub-octave sine relative to the sawtooth. */
    subLevel: number;
    /** Level of the breath (band-limited noise) layer. */
    breathLevel: number;
    attackS: number;
    releaseS: number;
    level: number;
    reverbSend: number;
}

/** Space slugs: wet click-chirp clusters — short resonant noise ticks, each followed by a pitch-up chirp, plus low
 *  "gloop" blips. */
export interface ClickChirpVoice {
    kind: 'clickChirp';
    durationS: Range;
    clicks: Range;
    /** Tick resonance (bandpass centre) and its Q. */
    tickHz: Range;
    tickQ: number;
    tickLengthS: Range;
    /** Chirp start → end frequency (a rising sine sweep) and its length. */
    chirpStartHz: Range;
    chirpRatio: Range;
    chirpLengthS: Range;
    /** Chance that a tick also carries a low wet "gloop" (sine blip rising ~1.8×). */
    gloopChance: number;
    gloopHz: Range;
    level: number;
    reverbSend: number;
}

/** Ardilus: a thin keening sweep — sine + triangle glide (up, then sagging) with tremolo and a little vibrato. */
export interface KeenVoice {
    kind: 'keen';
    durationS: Range;
    startHz: Range;
    /** Peak = start × peakRatio (reached at `peakAt` of the duration), end = start × endRatio. */
    peakRatio: Range;
    peakAt: number;
    endRatio: Range;
    tremoloHz: Range;
    /** 0..1: how deep the tremolo cuts the amplitude. */
    tremoloDepth: number;
    vibratoHz: number;
    vibratoDepth: number;
    /** Level of the triangle an octave+ above (the "thin" edge). */
    overtoneLevel: number;
    highpassHz: number;
    attackS: number;
    releaseS: number;
    level: number;
    reverbSend: number;
}

/** Silver Mist: a shimmering granular texture — many detuned sines, each with its own slow random amplitude. */
export interface ShimmerVoice {
    kind: 'shimmer';
    durationS: Range;
    partials: Range;
    /** Partials are drawn from `ratios` × a base pitch, each detuned by up to ±detuneCents. */
    baseHz: Range;
    ratios: readonly number[];
    detuneCents: number;
    /** Amplitude breakpoints per partial per second (the slow random envelope). */
    breakpointsPerS: number;
    /** Per-partial stereo spread around the call's pan. */
    stereoSpread: number;
    attackS: number;
    releaseS: number;
    level: number;
    reverbSend: number;
}

export type CreatureVoice = BellowVoice | ClickChirpVoice | KeenVoice | ShimmerVoice;

const KALTOR: BellowVoice = {
    kind: 'bellow',
    durationS: [1.5, 3.0],
    baseHz: [42, 62],
    formantsStartHz: [240, 560, 1050],
    formantsPeakHz: [360, 780, 1250],
    formantQ: [5, 7, 9],
    formantGain: [1.0, 0.55, 0.22],
    riseRatio: 1.12,
    fallRatio: 0.78,
    vibratoHz: [2.2, 3.4],
    vibratoDepth: 0.025,
    subLevel: 0.9,
    breathLevel: 0.12,
    attackS: 0.35,
    releaseS: 0.7,
    level: 0.17,
    reverbSend: 0.35,
};

const SLUG_BASE: ClickChirpVoice = {
    kind: 'clickChirp',
    durationS: [0.5, 1.2],
    clicks: [6, 14],
    tickHz: [1600, 3400],
    tickQ: 7,
    tickLengthS: [0.006, 0.016],
    chirpStartHz: [520, 900],
    chirpRatio: [2.2, 3.4],
    chirpLengthS: [0.028, 0.065],
    gloopChance: 0.3,
    gloopHz: [150, 260],
    level: 0.2,
    reverbSend: 0.22,
};

/** Rock slugs: a little lower and wetter; desert slugs: higher, drier, fewer gloops. */
const ROCK_SLUG: ClickChirpVoice = { ...SLUG_BASE, tickHz: [1300, 2800], chirpStartHz: [440, 760], gloopChance: 0.4, gloopHz: [130, 220] };
const DESERT_SLUG: ClickChirpVoice = { ...SLUG_BASE, tickHz: [2000, 4200], chirpStartHz: [640, 1100], gloopChance: 0.15, gloopHz: [190, 300], level: 0.18 };

const ARDILUS: KeenVoice = {
    kind: 'keen',
    durationS: [1.2, 2.4],
    startHz: [820, 1100],
    peakRatio: [1.7, 2.1],
    peakAt: 0.35,
    endRatio: [1.25, 1.5],
    tremoloHz: [7, 11],
    tremoloDepth: 0.55,
    vibratoHz: 5.5,
    vibratoDepth: 0.008,
    overtoneLevel: 0.18,
    highpassHz: 450,
    attackS: 0.18,
    releaseS: 0.55,
    level: 0.3,
    reverbSend: 0.4,
};

const SILVER_MIST: ShimmerVoice = {
    kind: 'shimmer',
    durationS: [2.5, 4.0],
    partials: [24, 36],
    baseHz: [520, 700],
    // A loose major-pentatonic spread over ~2.5 octaves above the base (glassy, not a chord).
    ratios: [2, 2.25, 2.5, 3, 3.333, 4, 4.5, 5, 6, 6.667, 8],
    detuneCents: 14,
    breakpointsPerS: 3.2,
    stereoSpread: 0.45,
    attackS: 0.6,
    releaseS: 1.0,
    level: 0.52,
    reverbSend: 0.55,
};

/** One synthesised voice per CreatureType (null: Undefined — silent). */
export function creatureVoice(type: CreatureType): CreatureVoice | null {
    switch (type) {
        case CreatureType.Kaltor:
            return KALTOR;
        case CreatureType.RockSpaceSlug:
            return ROCK_SLUG;
        case CreatureType.DesertSpaceSlug:
            return DESERT_SLUG;
        case CreatureType.Ardilus:
            return ARDILUS;
        case CreatureType.SilverMist:
            return SILVER_MIST;
        default:
            return null;
    }
}

/** Hull creak: a low resonant noise burst with a slow pitch drop, a stick-slip grain and a metallic ring. */
export interface CreakVoice {
    durationS: Range;
    /** The resonant body's centre frequency glides from start to start × dropRatio. */
    bodyStartHz: Range;
    dropRatio: Range;
    bodyQ: number;
    /** A second, weaker body resonance at this multiple of the first. */
    bodyOvertone: number;
    /** Stick-slip grain: amplitude pulses per second and how deep they cut (0..1). */
    grainHz: Range;
    grainDepth: number;
    /** Metallic ring: a short resonant biquad bank at inharmonic (free-bar) ratios over a base pitch. */
    ringBaseHz: Range;
    ringRatios: readonly number[];
    ringQ: number;
    ringDecayS: Range;
    ringLevel: number;
    lowpassHz: number;
    attackS: number;
    level: number;
    reverbSend: number;
}

export const CREAK_VOICE: CreakVoice = {
    durationS: [0.4, 1.5],
    bodyStartHz: [150, 240],
    dropRatio: [0.6, 0.78],
    bodyQ: 14,
    bodyOvertone: 2.63,
    grainHz: [18, 42],
    grainDepth: 0.75,
    ringBaseHz: [300, 480],
    ringRatios: [1, 2.756, 5.404, 8.933],
    ringQ: 60,
    ringDecayS: [0.25, 0.6],
    ringLevel: 0.22,
    lowpassHz: 1500,
    attackS: 0.03,
    level: 0.28,
    reverbSend: 0.14,
};

// ---------------------------------------------------------------------------
// Trigger rules
// ---------------------------------------------------------------------------

/** Scenario params (scenario.json) with their defaults. */
export interface RimSoundParams {
    creatureCallRate: number;
    creakRate: number;
    creatureCallGain: number;
    creakGain: number;
}

export const RIM_SOUND_DEFAULTS: RimSoundParams = { creatureCallRate: 0.3, creakRate: 0.4, creatureCallGain: 0.5, creakGain: 0.4 };

/** At creatureCallRate 1 and full rim weight, one call attempt per this many seconds on average. */
export const CALL_BASE_PERIOD_S = 12;
/** Fraction of the rim call rate that remains in the core (weight 0): "still possible at low rate". */
export const CALL_CORE_RATE_FRACTION = 0.15;
/** At creakRate 1 and intensity 1, one creak per this many seconds on average. */
export const CREAK_BASE_PERIOD_S = 6;
/** Never two calls of the same creature within this many seconds. */
export const CREATURE_COOLDOWN_S = 25;
/** Never two calls of the same voice (creature type) within this many seconds (they would mask each other). */
export const TYPE_COOLDOWN_S = 8;
/** Minimum gap between any two creature calls. */
export const CALL_MIN_GAP_S = 2.5;
/** Minimum gap between two creak events (a double creak counts as one event). */
export const CREAK_MIN_GAP_S = 4;
/** Chance that a creak comes as a double creak, and the second one's delay. */
export const DOUBLE_CREAK_CHANCE = 0.3;
export const DOUBLE_CREAK_DELAY_S: Range = [0.3, 0.9];
/** World-unit radius around the camera centre within which creatures can be heard (Galaxy.MaxSolarSystemSize ≈ 23000). */
export const CREATURE_CALL_RANGE = 40000;
/** Rim weight at which "deep rim" creaks start; they reach full intensity at weight 1. */
export const DEEP_RIM_WEIGHT = 0.5;

/** System zoom: full level up to this zoom factor (1 / px-per-unit), fading to silence at SYSTEM_ZOOM_MAX_FACTOR. */
export const SYSTEM_ZOOM_FULL_FACTOR = 30;
export const SYSTEM_ZOOM_MAX_FACTOR = 100;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 0..1 audibility from the zoom factor: 1 at system zoom and closer, 0 at galaxy zoom. */
export function zoomAudibility(zoomFactor: number): number {
    if (!(zoomFactor > 0)) return 0;
    if (zoomFactor <= SYSTEM_ZOOM_FULL_FACTOR) return 1;
    if (zoomFactor >= SYSTEM_ZOOM_MAX_FACTOR) return 0;
    return 1 - (zoomFactor - SYSTEM_ZOOM_FULL_FACTOR) / (SYSTEM_ZOOM_MAX_FACTOR - SYSTEM_ZOOM_FULL_FACTOR);
}

/** Creature call attempts per second at a camera rim weight (0..1). */
export function callRatePerSecond(creatureCallRate: number, rimWeight: number): number {
    const w = clamp(rimWeight, 0, 1);
    return (Math.max(0, creatureCallRate) / CALL_BASE_PERIOD_S) * (CALL_CORE_RATE_FRACTION + (1 - CALL_CORE_RATE_FRACTION) * w);
}

/** Creak events per second at a creak intensity (0..1). */
export function creakRatePerSecond(creakRate: number, intensity: number): number {
    return (Math.max(0, creakRate) / CREAK_BASE_PERIOD_S) * clamp(intensity, 0, 1);
}

/** Poisson trigger: the chance that at least one event of rate `ratePerSecond` happens within `dtS` seconds. */
export function triggerProbability(ratePerSecond: number, dtS: number): number {
    if (!(ratePerSecond > 0) || !(dtS > 0)) return 0;
    return 1 - Math.exp(-ratePerSecond * dtS);
}

/** 0..1 distance attenuation within `range` (1 at the camera centre, 0 at the edge and beyond). */
export function distanceGain(distance: number, range: number): number {
    if (!(range > 0) || !(distance < range)) return 0;
    const t = 1 - Math.max(0, distance) / range;
    return t * t;
}

/** Stereo pan (-0.85..0.85) from the direction to a source: sources near the centre stay near the middle. */
export function directionPan(dx: number, dy: number, range: number): number {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 0 || !(range > 0)) return 0;
    const spread = Math.min(1, d / (0.3 * range));
    return clamp((dx / d) * spread * 0.85, -0.85, 0.85);
}

/** Creature call gain: scenario gain × effects volume × distance × zoom × rim weight at the creature (quieter,
 *  not silent, in the core). */
export function creatureCallGain(callGain: number, effectsVolume: number, distGain: number, zoom: number, rimWeight: number): number {
    return clamp(callGain, 0, 1) * clamp(effectsVolume, 0, 1) * clamp(distGain, 0, 1) * clamp(zoom, 0, 1) * (0.45 + 0.55 * clamp(rimWeight, 0, 1));
}

/** What makes a hull creak near the camera's ship. */
export interface CreakConditions {
    inStorm: boolean;
    hyperjumping: boolean;
    rimWeight: number;
}

/** 0..1 creak intensity: a storm is the strongest, then a hyperjump, then how deep in the rim the ship sits. */
export function creakIntensity(c: CreakConditions): number {
    const deepRim = clamp((c.rimWeight - DEEP_RIM_WEIGHT) / (1 - DEEP_RIM_WEIGHT), 0, 1);
    return Math.max(c.inStorm ? 1 : 0, c.hyperjumping ? 0.8 : 0, deepRim);
}

/** Creak gain: scenario gain × effects volume × distance × zoom, a little louder at higher intensity. */
export function creakGainFor(creakGain: number, effectsVolume: number, distGain: number, zoom: number, intensity: number): number {
    return clamp(creakGain, 0, 1) * clamp(effectsVolume, 0, 1) * clamp(distGain, 0, 1) * clamp(zoom, 0, 1) * (0.6 + 0.4 * clamp(intensity, 0, 1));
}

/** The world-unit radius within which the camera counts as "near" a ship: most of the visible half-diagonal. */
export function creakNearRange(halfDiagonalWorld: number): number {
    return Math.max(2000, 0.6 * halfDiagonalWorld);
}

// ---------------------------------------------------------------------------
// Scheduler (pure: time and randomness come in; events go out)
// ---------------------------------------------------------------------------

export interface CallCandidate {
    /** Identity for the per-creature cooldown (the Creature object in the game). */
    key: unknown;
    type: CreatureType;
    /** Offset from the camera centre in world units. */
    dx: number;
    dy: number;
    /** Rim weight at the creature. */
    rimWeight: number;
}

export interface CreakCandidate {
    key: unknown;
    dx: number;
    dy: number;
    /** The "near" radius (creakNearRange) the offset is measured against. */
    nearRange: number;
    conditions: CreakConditions;
}

export interface RimSoundFrame {
    /** Scenario flag on (false: the scheduler is a no-op). */
    enabled: boolean;
    zoomFactor: number;
    /** Rim weight at the camera centre (drives the call rate). */
    cameraRimWeight: number;
    /** The effects volume (0 = muted: nothing is scheduled). */
    effectsVolume: number;
    params: RimSoundParams;
    /** Creatures within CREATURE_CALL_RANGE of the camera — only asked for when a call attempt fires. */
    candidates: () => readonly CallCandidate[];
    /** The ship whose hull may creak (selected / nearest own ship near the camera), or null. */
    creak: () => CreakCandidate | null;
}

export type RimSoundEvent =
    | { kind: 'call'; type: CreatureType; key: unknown; pan: number; gain: number; delayS: number }
    | { kind: 'creak'; pan: number; gain: number; intensity: number; delayS: number };

/** Weighted pick among the candidates not in cooldown (weight = distance gain × rim emphasis); null if none. */
export function pickCallCandidate(
    candidates: readonly CallCandidate[],
    isCoolingDown: (c: CallCandidate) => boolean,
    rand: () => number,
): CallCandidate | null {
    let total = 0;
    const weights: number[] = [];
    for (const c of candidates) {
        const d = Math.sqrt(c.dx * c.dx + c.dy * c.dy);
        const w = creatureVoice(c.type) === null || isCoolingDown(c) ? 0 : distanceGain(d, CREATURE_CALL_RANGE) * (0.5 + clamp(c.rimWeight, 0, 1));
        weights.push(w);
        total += w;
    }
    if (!(total > 0)) return null;
    let r = rand() * total;
    for (let i = 0; i < candidates.length; i++) {
        r -= weights[i];
        if (weights[i] > 0 && r <= 0) return candidates[i];
    }
    for (let i = candidates.length - 1; i >= 0; i--) if (weights[i] > 0) return candidates[i];
    return null;
}

/** Per-frame trigger logic for creature calls and hull creaks. One per game view. */
export class RimSoundScheduler {
    private lastCallByKey = new Map<unknown, number>();
    private lastCallByType = new Map<CreatureType, number>();
    private lastCallS = -Infinity;
    private lastCreakS = -Infinity;

    /** `nowS` is a monotonic clock in seconds, `dtS` the time since the previous step, `rand` in [0, 1). */
    step(frame: RimSoundFrame, nowS: number, dtS: number, rand: () => number): RimSoundEvent[] {
        if (!frame.enabled || !(frame.effectsVolume > 0)) return [];
        const zoom = zoomAudibility(frame.zoomFactor);
        if (zoom <= 0) return [];
        const dt = clamp(dtS, 0, 0.25);
        const out: RimSoundEvent[] = [];
        const p = frame.params;

        // Creature calls.
        if (p.creatureCallGain > 0 && nowS - this.lastCallS >= CALL_MIN_GAP_S && rand() < triggerProbability(callRatePerSecond(p.creatureCallRate, frame.cameraRimWeight), dt)) {
            const c = pickCallCandidate(frame.candidates(), (c) => this.coolingDown(c, nowS), rand);
            if (c !== null) {
                const d = Math.sqrt(c.dx * c.dx + c.dy * c.dy);
                const gain = creatureCallGain(p.creatureCallGain, frame.effectsVolume, distanceGain(d, CREATURE_CALL_RANGE), zoom, c.rimWeight);
                if (gain > 0) {
                    out.push({ kind: 'call', type: c.type, key: c.key, pan: directionPan(c.dx, c.dy, CREATURE_CALL_RANGE), gain, delayS: 0 });
                    this.lastCallS = nowS;
                    this.lastCallByKey.set(c.key, nowS);
                    this.lastCallByType.set(c.type, nowS);
                    this.prune(nowS);
                }
            }
        }

        // Hull creaks.
        if (p.creakGain > 0 && p.creakRate > 0 && nowS - this.lastCreakS >= CREAK_MIN_GAP_S) {
            const s = frame.creak();
            if (s !== null) {
                const intensity = creakIntensity(s.conditions);
                if (intensity > 0 && rand() < triggerProbability(creakRatePerSecond(p.creakRate, intensity), dt)) {
                    const d = Math.sqrt(s.dx * s.dx + s.dy * s.dy);
                    // Near the camera: attenuate over twice the near range so a ship at the edge is still heard.
                    const gain = creakGainFor(p.creakGain, frame.effectsVolume, distanceGain(d, 2 * s.nearRange), zoom, intensity);
                    if (gain > 0 && d <= s.nearRange) {
                        const pan = directionPan(s.dx, s.dy, 2 * s.nearRange);
                        out.push({ kind: 'creak', pan, gain, intensity, delayS: 0 });
                        if (rand() < DOUBLE_CREAK_CHANCE) {
                            const delay = DOUBLE_CREAK_DELAY_S[0] + rand() * (DOUBLE_CREAK_DELAY_S[1] - DOUBLE_CREAK_DELAY_S[0]);
                            out.push({ kind: 'creak', pan, gain: gain * 0.8, intensity, delayS: delay });
                        }
                        this.lastCreakS = nowS;
                    }
                }
            }
        }
        return out;
    }

    private coolingDown(c: CallCandidate, nowS: number): boolean {
        const k = this.lastCallByKey.get(c.key);
        if (k !== undefined && nowS - k < CREATURE_COOLDOWN_S) return true;
        const t = this.lastCallByType.get(c.type);
        return t !== undefined && nowS - t < TYPE_COOLDOWN_S;
    }

    private prune(nowS: number): void {
        for (const [k, t] of this.lastCallByKey) if (nowS - t >= CREATURE_COOLDOWN_S) this.lastCallByKey.delete(k);
    }
}

// ---------------------------------------------------------------------------
// Small helpers shared with the synth
// ---------------------------------------------------------------------------

/** A value uniformly in `r` from `rand`. */
export function inRange(r: Range, rand: () => number): number {
    return r[0] + (r[1] - r[0]) * rand();
}

/** Deterministic PRNG (mulberry32) for the offline renders and tests. */
export function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
