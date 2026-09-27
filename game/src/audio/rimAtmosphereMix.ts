// 19i "Rim atmosphere" data/wiring — audio items 8 (music mood), 9 (wind/static ambient bed) and 10 (voice static +
// distress-call ticker, ticker half in src/sim/scenario/rimDistressCalls.ts). Flag `rimAtmosphere`
// (scenarios/rim-atmosphere/scenario.json) off, or no scenario: every function below returns its "off" value
// (0 / null / the original pool) and the runtime classes never touch the Web Audio graph — no-op, per package spec.
//
// Deliberately no Galaxy / render import here (unlike src/audio/rimAtmosphereGeometry.ts, which reads the rim curve
// from src/render/rimAtmosphereLayer.ts — not edited here, a sibling package is reworking that file's dust lanes):
// this module's functions all take an already-computed weight/probability, so musicPlayer.ts (used before any
// galaxy exists, e.g. the main-menu theme) can call pickRimWeightedTrack without pulling in pixi.js.
//
// Creature calls / hull creaks (item 9's other two clauses): $DWU/Sounds/Effects has no creature-call or
// hull/creak file of any kind, so (audio addendum) both are synthesised at runtime — see rimCreatureCalls.ts (pure
// tables + trigger rules), rimCreatureSynth.ts (Web Audio voices) and rimCreatureAudio.ts (game glue).

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
// Item 9 — wind/static ambient bed gain
// ---------------------------------------------------------------------------

/** Pure: the ambient bed's gain (0..1), following the rim weight at the camera centre and the scenario's
 *  ambientGain param (the gain once fully past the rim band). */
export function rimAmbientBedGain(weightAtCamera: number, ambientGain: number): number {
    return Math.max(0, Math.min(1, weightAtCamera * ambientGain));
}

// ---------------------------------------------------------------------------
// Item 10 — voice static gain + minimap dimming (item 13's tail, exported for the pure-function tests)
// ---------------------------------------------------------------------------

/** Pure: the faint static layer's gain (0..1) under advisor/diplomacy voice playback, following whichever of the
 *  camera or the speaking empire's capital sits deeper in the fog (the greater of the two weights) and the
 *  scenario's staticGain param. Pass 0 for either weight when it is not available (e.g. no camera at that call
 *  site: the capital-only check still applies). */
export function rimVoiceStaticGain(cameraWeight: number, capitalWeight: number, staticGain: number): number {
    return Math.max(0, Math.min(1, Math.max(cameraWeight, capitalWeight) * staticGain));
}

/** Item 13's tail (design note "minimap dims the outer band"): the alpha multiplier for a minimap icon/region at
 *  this rim weight (1 = undimmed). No minimap render target exists yet in this codebase (checked src/render and
 *  src/ui — only a scenario-unrelated "replaces the minimap" HUD-layout comment); ready to multiply an icon's alpha
 *  by once one does. */
export function minimapRimDimAlpha(weight: number, dimStrength: number): number {
    return Math.max(0, Math.min(1, 1 - dimStrength * weight));
}

// ---------------------------------------------------------------------------
// Web Audio graph: a noise source → gain (no asset file)
// ---------------------------------------------------------------------------

export interface NoiseBed {
    /** Sets the bed's gain (clamped 0..1). */
    setGain(g: number): void;
    dispose(): void;
}

/** A `seconds`-long looping noise buffer, generated once from `rand` (Math.random by default; tests inject a seeded
 *  source for determinism — the audio graph itself is never asserted on, only that setGain forwards correctly). */
function noiseBuffer(ctx: AudioContext, seconds: number, rand: () => number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
    return buffer;
}

/** Continuous noise bed: BufferSource (looping) → BiquadFilter → GainNode (starts at 0) → destination. `filterType`
 *  / `filterHz` shape the source's colour — a lowpass for the wind bed (item 9), a highpass for the sharper voice
 *  static (item 10). */
export function createNoiseBed(ctx: AudioContext, filterType: BiquadFilterType, filterHz: number, rand: () => number = Math.random): NoiseBed {
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

/** The wind/static ambient bed (item 9): one lazily-created noise bed per app session, gain updated every frame
 *  from rimAmbientBedGain. Distant creature calls and hull creaks: rimCreatureAudio.ts. */
export class RimAmbientBed {
    private bed: NoiseBed | null = null;

    constructor(
        private readonly contextFactory: () => AudioContext = () => new AudioContext(),
        private readonly rand: () => number = Math.random,
    ) {}

    /** Call once per rendered frame with the camera's rim weight and the scenario's ambientGain param. No-op
     *  (never creates an AudioContext) while the gain would be 0, so a game with the flag off never touches audio. */
    update(weightAtCamera: number, ambientGain: number): void {
        const gain = rimAmbientBedGain(weightAtCamera, ambientGain);
        if (this.bed === null) {
            if (gain <= 0) return;
            try {
                this.bed = createNoiseBed(this.contextFactory(), 'lowpass', 700, this.rand);
            } catch {
                return; // no Web Audio (tests / unsupported)
            }
        }
        this.bed.setGain(gain);
    }

    dispose(): void {
        this.bed?.dispose();
        this.bed = null;
    }
}

/** Item 10: a short static burst mixed under one diplomacy/advisor sting (gameAudio.ts playDiplomacyMood). Plays
 *  and disposes itself; a no-op at gain 0 (never creates an AudioContext). `contextFactory` is a test seam. */
export function playRimVoiceStaticBurst(gain: number, durationSeconds = 3, contextFactory: () => AudioContext = () => new AudioContext(), rand: () => number = Math.random): void {
    if (gain <= 0) return;
    try {
        const ctx = contextFactory();
        const bed = createNoiseBed(ctx, 'highpass', 2200, rand);
        bed.setGain(gain);
        setTimeout(() => bed.dispose(), Math.max(0, durationSeconds) * 1000);
    } catch {
        // no Web Audio (tests / unsupported) — the sting itself still plays
    }
}
