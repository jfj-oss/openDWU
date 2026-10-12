// [musicmood] Options → Music & Mood → Background mood. Presentation only: wall-clock driven, Math.random, never reads
// or writes sim state or Galaxy randomness.
//
//   off   — no bed (the default).
//   rim   — the Rim Atmosphere add-on's bed, creature calls and hull creaks exactly as before (only with that add-on on).
//   deep  — "Deep Space": the rim bed's sparse wind + underwater rumble everywhere, at every zoom, plus distant creature
//           calls and hull creaks at randomised intervals (tens of seconds to a few minutes) with randomised pitch, pan
//           and level. It includes the rim layer: with the add-on on, the rim's own positional calls / creaks still play
//           and the single bed follows the deeper of the two weights (never two beds).
// All sound is synthesised here and in rimCreatureSynth.ts (Web Audio); no sound file of the original game is used.

import { CreatureType } from "../sim/creature";
import {
  creatureVoice,
  CREAK_VOICE,
  WHALE_BELLOW,
  WHALE_MOAN,
  inRange,
  type CreakVoice,
  type CreatureVoice,
  type Range,
} from "./rimCreatureCalls";
import {
  createRimSynthBus,
  playAmbientEvent,
  playCreak,
  playCreatureVoice,
  startAmbientRumble,
  type RimSynthBus,
} from "./rimCreatureSynth";
import {
  rimAmbientBedGain,
  RimAmbientScheduler,
  type AmbientEvent,
} from "./rimAtmosphereMix";

export type BackgroundMoodKind = "off" | "rim" | "deep";

/** The bed's rim weight everywhere in Deep Space (below 1: a little sparser and quieter than deep in the rim). */
export const DEEP_BED_WEIGHT = 0.7;

/** One kind of sparse Deep Space event: mean period and the least time between two of it. */
export interface DeepEventSpec {
  kind: "call" | "creak";
  meanPeriodS: number;
  minGapS: number;
}
export const DEEP_EVENTS: readonly DeepEventSpec[] = [
  { kind: "call", meanPeriodS: 70, minGapS: 25 },
  { kind: "creak", meanPeriodS: 50, minGapS: 18 },
];
/** Never two Deep Space events closer than this (the bed's own events have their own gaps). */
export const DEEP_MIN_GAP_S = 12;
/** Pitch spread of one event (a factor drawn log-uniformly in this range). */
export const DEEP_PITCH_RANGE: Range = [0.7, 1.35];
/** Per-event level range (on top of the mood level). */
export const DEEP_LEVEL_RANGE: Range = [0.35, 1];
/** Calls are distant: this share of their natural level. */
export const DEEP_CALL_GAIN = 0.32;
export const DEEP_CREAK_GAIN = 0.3;

/** The voices a distant Deep Space call is drawn from (the creature voices plus the bed's whale voices). */
export function deepCallVoices(): CreatureVoice[] {
  const out: CreatureVoice[] = [];
  for (const t of [
    CreatureType.Kaltor,
    CreatureType.RockSpaceSlug,
    CreatureType.DesertSpaceSlug,
    CreatureType.Ardilus,
    CreatureType.SilverMist,
  ]) {
    const v = creatureVoice(t);
    if (v !== null) out.push(v);
  }
  out.push(WHALE_MOAN, WHALE_BELLOW, WHALE_MOAN);
  return out;
}

const NO_TRANSPOSE = /^(lowpass|highpass|vibrato|tremolo|grain|lfo)/i;

/** Pure: a copy of a voice table with every pitch (keys ending in Hz, except filters and modulation rates) × factor. */
export function transposeVoice<T extends object>(voice: T, factor: number): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(voice)) {
    if (!k.endsWith("Hz") || NO_TRANSPOSE.test(k)) out[k] = v;
    else if (typeof v === "number") out[k] = v * factor;
    else if (Array.isArray(v))
      out[k] = v.map((x: unknown) => (typeof x === "number" ? x * factor : x));
    else out[k] = v;
  }
  return out as T;
}

export interface DeepEvent {
  kind: "call" | "creak";
  atS: number;
  /** Index into deepCallVoices() (calls only). */
  voice: number;
  pitch: number;
  pan: number;
  level: number;
}

/** Pure per-step scheduler (Poisson per kind with per-kind and global gaps). `rand` in [0, 1). */
export class DeepSpaceScheduler {
  private lastByKind = new Map<DeepEventSpec["kind"], number>();
  private lastS = -Infinity;
  constructor(private readonly voiceCount: number) {}

  step(nowS: number, dtS: number, rand: () => number): DeepEvent[] {
    const dt = Math.max(0, Math.min(0.5, dtS));
    if (!(dt > 0) || nowS - this.lastS < DEEP_MIN_GAP_S) return [];
    for (const spec of DEEP_EVENTS) {
      if (nowS - (this.lastByKind.get(spec.kind) ?? -Infinity) < spec.minGapS)
        continue;
      if (rand() < 1 - Math.exp(-dt / spec.meanPeriodS)) {
        this.lastByKind.set(spec.kind, nowS);
        this.lastS = nowS;
        const [lo, hi] = DEEP_PITCH_RANGE;
        return [
          {
            kind: spec.kind,
            atS: nowS,
            voice: Math.floor(rand() * this.voiceCount),
            pitch: lo * Math.pow(hi / lo, rand()),
            pan: (rand() * 2 - 1) * 0.85,
            level: inRange(DEEP_LEVEL_RANGE, rand),
          },
        ];
      }
    }
    return [];
  }
}

/** The Deep Space event bus: far away (long dark tail, muffled). */
const DEEP_BUS = {
  impulseS: 8,
  decayS: 2.6,
  reverbLevel: 1.0,
  lowpassHz: 1800,
} as const;
/** The bed's bus (same as rimAtmosphereMix.ts AMBIENT_BUS). */
const BED_BUS = {
  impulseS: 7,
  decayS: 2.2,
  reverbLevel: 0.9,
  lowpassHz: 2600,
} as const;

function playDeepEvent(
  bus: RimSynthBus,
  voices: readonly CreatureVoice[],
  e: DeepEvent,
  t0: number,
  rand: () => number,
): void {
  if (e.kind === "call")
    playCreatureVoice(
      bus,
      transposeVoice(voices[e.voice] ?? WHALE_MOAN, e.pitch),
      t0,
      e.pan,
      DEEP_CALL_GAIN * e.level,
      rand,
    );
  else
    playCreak(
      bus,
      t0,
      e.pan,
      DEEP_CREAK_GAIN * e.level,
      rand,
      transposeVoice<CreakVoice>(CREAK_VOICE, e.pitch),
    );
}

/** Pure: the Deep Space bed's master gain (follows rimAtmosphereMix.ts rimAmbientBedGain at a weight of at least
 *  DEEP_BED_WEIGHT) for a mood level 0..1 × effects volume 0..1. */
export function deepBedGain(
  rimWeight: number,
  moodLevel: number,
  effectsVolume: number,
): number {
  return rimAmbientBedGain(
    Math.max(DEEP_BED_WEIGHT, rimWeight),
    clamp01(moodLevel) * clamp01(effectsVolume),
  );
}

/** Pure: the Deep Space event bus level. */
export function deepEventGain(
  moodLevel: number,
  effectsVolume: number,
): number {
  return clamp01(moodLevel) * clamp01(effectsVolume);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** The Deep Space calls / creaks layer (the bed itself is gameAudio.ts's one RimAmbientBed). update() every frame. */
export class DeepSpaceEvents {
  private bus: RimSynthBus | null = null;
  private readonly voices = deepCallVoices();
  private readonly scheduler = new DeepSpaceScheduler(this.voices.length);
  private lastS: number | null = null;

  constructor(
    private readonly contextFactory: () => AudioContext,
    private readonly rand: () => number = Math.random,
  ) {}

  update(gain: number): void {
    if (this.bus === null) {
      if (gain <= 0) return;
      try {
        const ctx = this.contextFactory();
        this.bus = createRimSynthBus(ctx, ctx.destination, this.rand, DEEP_BUS);
        this.bus.master.gain.value = 0;
      } catch {
        return;
      }
    }
    try {
      const ctx = this.bus.ctx as AudioContext;
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      this.bus.master.gain.setTargetAtTime(gain, now, 0.5);
      const dt = this.lastS === null ? 0 : now - this.lastS;
      this.lastS = now;
      if (gain > 0)
        for (const e of this.scheduler.step(now, dt, this.rand))
          playDeepEvent(this.bus, this.voices, e, now + 0.05, this.rand);
    } catch {
      // no audio
    }
  }

  dispose(): void {
    this.bus?.dispose();
    this.bus = null;
  }
}

/** Offline render of the whole Deep Space mood (bed + calls + creaks) for previews: same buses, voices and schedulers
 *  as the live mood. Returns the scheduled events. */
export function renderDeepSpaceOffline(
  ctx: BaseAudioContext,
  seconds: number,
  moodLevel: number,
  rand: () => number,
  stepS = 1 / 30,
): { bed: AmbientEvent[]; deep: DeepEvent[] } {
  const bedBus = createRimSynthBus(ctx, ctx.destination, rand, BED_BUS);
  bedBus.master.gain.value = deepBedGain(0, moodLevel, 1);
  startAmbientRumble(bedBus, 0, rand);
  const deepBus = createRimSynthBus(ctx, ctx.destination, rand, DEEP_BUS);
  deepBus.master.gain.value = deepEventGain(moodLevel, 1);
  const voices = deepCallVoices();
  const bedScheduler = new RimAmbientScheduler();
  const deepScheduler = new DeepSpaceScheduler(voices.length);
  const out = { bed: [] as AmbientEvent[], deep: [] as DeepEvent[] };
  for (let t = stepS; t < seconds - 4; t += stepS) {
    for (const e of bedScheduler.step(t, stepS, DEEP_BED_WEIGHT, rand)) {
      playAmbientEvent(bedBus, e.kind, t, e.pan, e.level, rand);
      out.bed.push(e);
    }
    for (const e of deepScheduler.step(t, stepS, rand)) {
      playDeepEvent(deepBus, voices, e, t, rand);
      out.deep.push(e);
    }
  }
  return out;
}
