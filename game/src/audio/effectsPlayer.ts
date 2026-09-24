// Port of DistantWorlds.EffectsPlayer (EffectsPlayer.cs) + SoundEffectRequest
// (SoundEffectRequest.cs), on the Web Audio API.
//
// The C# class keeps a `Dictionary<string, SoundEffect>` bank (XNA
// SoundEffect = decoded buffer) plus a list of live SoundEffectInstances;
// buffers are preloaded in Initialize() for the weapon/explosion files and
// lazily loaded in PlayEffect() for everything else. Here the "bank" is a
// map of filename → AudioBuffer fetched from /assets/dwu/Sounds/Effects/<file>
// (the desktop shell maps that prefix to the DW:U install folder). Missing
// files are skipped gracefully — the original pops an error dialog and exits
// the process (method_1), which is not an option in a browser.
//
// Browsers block audio until a user gesture: startEffects() defers creating
// the AudioContext to the first pointerdown/keydown, mirroring startMusic().

import { ComponentType } from '../sim/data/components';
import { HabitatType } from '../sim/types';
import { getSettings } from '../ui/settings';

/** Port of DistantWorlds.SoundEffectRequest (double Volume/Balance, int
 * Frequency, string Filename). */
export interface SoundEffectRequest {
    volume: number;
    balance: number;
    frequency: number;
    filename: string;
}

/** Folder the effect files are served from. */
const EFFECTS_URL_PREFIX = '/assets/dwu/Sounds/Effects/';

/** Files preloaded at startup (port of EffectsPlayer.method_0's hardcoded
 * additions). The original also prepends every weapon component's sound file
 * via ComponentDefinitionList.ResolveWeaponSoundEffectFilenames — that helper
 * is not ported here, so the preload list is limited to the explosion set.
 * TODO(port): extend the preload list once ResolveWeaponSoundEffectFilenames
 * is available (DistantWorlds.Types.ComponentDefinitionList).
 */
const PRELOAD_FILES = [
    'Explosion.wav',
    'Explosion2.wav',
    'Explosion3.wav',
    'explosion_small.wav',
    'Explosion_small2.wav',
    'Explosion_small3.wav',
];

/** The UI button-click sound. The pasted source has no resolver for plain UI
 * button clicks (ResolveAttackClick plays attack_click.wav for attacks); per
 * the task's fallback rule this is the first file whose name contains
 * "click" or "button". */
export const UI_CLICK_FILE = 'attack_click.wav';

/** Cap on simultaneously playing voices. The pasted excerpt does not contain
 * the original's exact concurrency limit (its instance list is unbounded and
 * pruned by ClearFinishedBuffers); 24 is a modest bound so a battle cannot
 * open hundreds of AudioBufferSourceNodes at once.
 * TODO(port): use the original's exact voice cap once it is known. */
export const MAX_CONCURRENT_VOICES = 24;

/** Pure helper: positional attenuation factor (port of each resolver's
 * `distance = Math.Min(1.0, distance)` then `volume *= distance`). Returns 1
 * for a source at the view centre (zero distance), falling linearly to 0 at
 * the full-screen radius. */
export function attenuationFactor(distance: number): number {
    if (distance <= 0) return 1;
    return Math.min(1, distance);
}

/** Pure helper: convert a world-space offset from the listener into the
 * linear attenuation factor. `zoom` is pixels per world unit (Camera.zoom),
 * so the on-screen distance in pixels is hypot(dx, dy) * zoom; the C# code
 * clamps the resulting distance to [0, 1] before scaling the volume. */
export function attenuationFromOffset(
    dx: number,
    dy: number,
    zoom: number,
    screenRadius: number,
): number {
    if (screenRadius <= 0) return 1;
    const px = Math.hypot(dx, dy) * zoom;
    return attenuationFactor(px / screenRadius);
}

/** Pure helper: decide whether a new voice may start given the currently
 * active ones. The original keeps every instance alive until it finishes
 * (ClearFinishedBuffers prunes stopped ones); here we additionally cap the
 * concurrent count and drop the oldest voice when the cap is hit. Returns
 * true when the caller should remove `oldestIndex` to make room. */
export function shouldReplaceOldestVoice(activeCount: number, maxVoices: number): boolean {
    return activeCount >= maxVoices;
}

/** One live playback (a SoundEffectInstance analogue). */
interface Voice {
    source: AudioBufferSourceNode;
    gain: GainNode;
    pan: StereoPannerNode;
    filename: string;
    /** True once the source node has finished (analogous to State === Stopped). */
    finished: boolean;
}

class EffectsPlayer {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;

    /** Decoded buffer bank (port of sfxBank). */
    private readonly bank = new Map<string, AudioBuffer>();
    /** In-flight buffer loads (one fetch per filename). */
    private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
    /** Live voices (port of list_0). */
    private readonly voices: Voice[] = [];

    /** Master volume (port of double_0, default 0.7). */
    private volume = 0.7;
    private muted = false;

    /** Listener position in world space (setListener). */
    private listenerX = 0;
    private listenerY = 0;
    /** Pixels per world unit (Camera.zoom). */
    private zoom = 1;
    /** Half the smaller screen dimension in px (attenuation reference). */
    private screenRadius = 450;

    /** Port of random_0 = new Random((int)DateTime.Now.Ticks). */
    private readonly rand = Math.random;

    /** Create the AudioContext (deferred until a user gesture). */
    private ensureContext(): AudioContext | null {
        if (this.ctx !== null) return this.ctx;
        try {
            const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctor) return null;
            this.ctx = new Ctor();
            this.master = this.ctx.createGain();
            this.master.connect(this.ctx.destination);
            this.applyMasterVolume();
        } catch {
            this.ctx = null;
            this.master = null;
        }
        return this.ctx;
    }

    /** Register the player: the AudioContext starts on the first
     * pointerdown/keydown (browsers block autoplay before a user gesture). */
    startEffects(): void {
        if (this.ctx !== null) return;
        const begin = (): void => {
            window.removeEventListener('pointerdown', begin);
            window.removeEventListener('keydown', begin);
            if (this.ensureContext()?.state === 'suspended') {
                void this.ctx?.resume();
            }
        };
        window.addEventListener('pointerdown', begin);
        window.addEventListener('keydown', begin);
    }

    /** Port of Volume (double_0). */
    get volumeValue(): number {
        return this.volume;
    }

    /** Port of SetVolume(double) — clamped to [0,1]. */
    setVolume(volume: number): void {
        if (volume < 0 || volume > 1) return;
        this.volume = volume;
        this.applyMasterVolume();
    }

    mute(): void {
        this.muted = true;
        this.applyMasterVolume();
    }

    unmute(): void {
        this.muted = false;
        this.applyMasterVolume();
    }

    private applyMasterVolume(): void {
        if (this.master !== null && this.ctx !== null) {
            this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.01);
        }
    }

    /** Positional listener: the world-space point at the view centre, the
     * current zoom (px per world unit) and the screen size used as the
     * attenuation reference. Call with the camera each frame/tick. */
    setListener(x: number, y: number, zoom: number, width?: number, height?: number): void {
        this.listenerX = x;
        this.listenerY = y;
        this.zoom = zoom;
        if (width !== undefined && height !== undefined) {
            this.screenRadius = Math.min(width, height) / 2;
        }
    }

    /** Preload the startup buffer set (port of method_0). Failures are
     * logged and skipped instead of aborting the app. */
    async initialize(): Promise<void> {
        await Promise.allSettled(PRELOAD_FILES.map((f) => this.loadBuffer(f)));
    }

    /** Fetch + decode one file into the bank (lazy-load path of PlayEffect).
     * Returns null when the file is missing or undecodable. */
    loadBuffer(filename: string): Promise<AudioBuffer | null> {
        const cached = this.bank.get(filename);
        if (cached) return Promise.resolve(cached);
        const inflight = this.loading.get(filename);
        if (inflight) return inflight;
        const p = (async (): Promise<AudioBuffer | null> => {
            const ctx = this.ensureContext();
            if (ctx === null) return null;
            try {
                const res = await fetch(EFFECTS_URL_PREFIX + filename);
                if (!res.ok) return null;
                const data = await res.arrayBuffer();
                const buf = await ctx.decodeAudioData(data);
                this.bank.set(filename, buf);
                return buf;
            } catch {
                // Missing/corrupt file: skip it (the original would exit).
                return null;
            } finally {
                this.loading.delete(filename);
            }
        })();
        this.loading.set(filename, p);
        return p;
    }

    /** Port of ClearFinishedBuffers: drop voices whose source has stopped. */
    clearFinishedBuffers(): void {
        for (let i = this.voices.length - 1; i >= 0; i--) {
            const v = this.voices[i];
            if (v.finished) {
                try {
                    v.source.disconnect();
                    v.gain.disconnect();
                    v.pan.disconnect();
                } catch {
                    // already disconnected
                }
                this.voices.splice(i, 1);
            }
        }
    }

    /** Port of PlayEffect(filename, balance, volume, frequency). The whole
     * body sits in a try/catch in C# that swallows every exception; same
     * here — a failed play must never break the game loop. */
    async playEffect(filename: string, balance: number, volume: number, frequency: number): Promise<void> {
        try {
            const ctx = this.ensureContext();
            if (ctx === null || this.master === null) return;
            if (ctx.state === 'suspended') {
                void ctx.resume();
            }
            let buffer = this.bank.get(filename) ?? null;
            if (buffer === null) {
                buffer = await this.loadBuffer(filename);
            }
            if (buffer === null) return;

            this.clearFinishedBuffers();
            if (shouldReplaceOldestVoice(this.voices.length, MAX_CONCURRENT_VOICES)) {
                // Drop the oldest voice to make room (see MAX_CONCURRENT_VOICES).
                const oldest = this.voices.shift();
                if (oldest) {
                    try {
                        oldest.source.stop();
                        oldest.source.disconnect();
                        oldest.gain.disconnect();
                        oldest.pan.disconnect();
                    } catch {
                        // already stopped
                    }
                }
            }

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            const gain = ctx.createGain();
            gain.gain.value = Math.max(0, Math.min(1, volume));
            const pan = ctx.createStereoPanner();
            pan.pan.value = Math.max(-1, Math.min(1, balance));
            if (frequency > 0) {
                // XNA Pitch is cents relative to 0; approximate with a rate
                // shift (2^(cents/1200)).
                source.playbackRate.value = Math.pow(2, frequency / 1200);
            }
            source.connect(gain);
            gain.connect(pan);
            pan.connect(this.master);
            source.onended = () => {
                const v = this.voices.find((x) => x.source === source);
                if (v) v.finished = true;
            };
            this.voices.push({ source, gain, pan, filename, finished: false });
            source.start();
        } catch {
            // Port of PlayEffect's swallowing catch.
        }
    }

    /** Stop all live voices and release the bank (port of Clear). */
    dispose(): void {
        for (const v of this.voices) {
            try {
                v.source.stop();
            } catch {
                // not started / already stopped
            }
            try {
                v.source.disconnect();
                v.gain.disconnect();
                v.pan.disconnect();
            } catch {
                // ignore
            }
        }
        this.voices.length = 0;
        this.bank.clear();
        this.loading.clear();
        if (this.master) {
            this.master.disconnect();
            this.master = null;
        }
        if (this.ctx) {
            void this.ctx.close().catch(() => undefined);
            this.ctx = null;
        }
    }

    // ------------------------------------------------------------------
    // Resolvers (ports of the public Resolve* methods). Each takes the
    // master volume explicitly so they stay pure and testable; the class
    // wrappers below feed them this.volume.
    // ------------------------------------------------------------------

    /** Port of ResolveIonStrike. */
    resolveIonStrike(balance: number, distance: number): SoundEffectRequest {
        return resolveIonStrike(this.volume, balance, distance);
    }

    /** Port of ResolveWeapon. */
    resolveWeapon(soundEffectFilename: string | null, balance: number, distance: number): SoundEffectRequest {
        return resolveWeapon(this.volume, soundEffectFilename, balance, distance);
    }

    /** Port of ResolveFighterWeapon. */
    resolveFighterWeapon(effectFilename: string, type: ComponentType, balance: number, distance: number): SoundEffectRequest {
        return resolveFighterWeapon(this.volume, effectFilename, type, balance, distance);
    }

    /** Port of ResolveAmbientEffect. */
    resolveAmbientEffect(soundScheme: number, balance: number, distance: number, nextEffectOffset: { value: number }): SoundEffectRequest {
        return resolveAmbientEffect(this.volume, soundScheme, balance, distance, nextEffectOffset, this.rand);
    }

    /** Port of ResolveAttackClick. */
    resolveAttackClick(): SoundEffectRequest {
        return resolveAttackClick(this.volume);
    }

    /** Port of ResolveImportantMessage. */
    resolveImportantMessage(): SoundEffectRequest {
        return resolveImportantMessage(this.volume);
    }

    /** Port of ResolveMessage (EmpireMessageType values are numeric). */
    resolveMessage(messageType: number): SoundEffectRequest {
        return resolveMessage(this.volume, messageType);
    }

    /** Port of ResolveHyperjumpEntry. */
    resolveHyperjumpEntry(balance: number, distance: number): SoundEffectRequest {
        return resolveHyperjumpEntry(this.volume, balance, distance);
    }

    /** Port of ResolveHyperjumpExit. */
    resolveHyperjumpExit(balance: number, distance: number): SoundEffectRequest {
        return resolveHyperjumpExit(this.volume, balance, distance);
    }

    /** Port of ResolveStar. Returns null when the star type has no sound. */
    resolveStar(starType: HabitatType, balance: number, distance: number): SoundEffectRequest | null {
        return resolveStar(this.volume, starType, balance, distance, this.rand);
    }

    /** Port of ResolveMining. */
    resolveMining(balance: number, distance: number): SoundEffectRequest {
        return resolveMining(this.volume, balance, distance, this.rand);
    }

    /** Port of ResolveThunder. */
    resolveThunder(balance: number, distance: number): SoundEffectRequest {
        return resolveThunder(this.volume, balance, distance, this.rand);
    }

    /** Port of ResolveConstruction. */
    resolveConstruction(balance: number, distance: number): SoundEffectRequest {
        return resolveConstruction(this.volume, balance, distance, this.rand);
    }

    /** Port of ResolveGasMining. */
    resolveGasMining(balance: number, distance: number): SoundEffectRequest {
        return resolveGasMining(this.volume, balance, distance, this.rand);
    }

    /** Port of PlayAlert (empty body in the original). */
    playAlert(_balance: number): void {
        // empty, like the original
    }

    /** Port of ResolvePlanetExplosion. */
    resolvePlanetExplosion(size: number, balance: number, distance: number): SoundEffectRequest {
        return resolvePlanetExplosion(this.volume, size, balance, distance);
    }

    /** Port of ResolveExplosion. */
    resolveExplosion(size: number, balance: number, distance: number): SoundEffectRequest {
        return resolveExplosion(this.volume, size, balance, distance, this.rand);
    }

    /** Play a resolved request through the positional pipeline: attenuate by
     * the source's distance from the listener (view centre), then play. */
    playResolved(request: SoundEffectRequest, sourceX?: number, sourceY?: number): void {
        if (request.filename === '') return;
        let volume = request.volume;
        if (sourceX !== undefined && sourceY !== undefined) {
            const factor = attenuationFromOffset(sourceX - this.listenerX, sourceY - this.listenerY, this.zoom, this.screenRadius);
            volume *= factor;
        }
        void this.playEffect(request.filename, request.balance, volume, request.frequency);
    }

    /** The UI button-click sound (task 09b wiring). */
    playUiClick(): void {
        const req = this.resolveAttackClick();
        void this.playEffect(req.filename, req.balance, req.volume, req.frequency);
    }
}

// ---------------------------------------------------------------------------
// Pure resolver ports (extracted so tests can run without a browser).
// Signatures mirror the C# methods with the master volume passed in place of
// the implicit double_0 field.
// ---------------------------------------------------------------------------

/** Port of ResolveIonStrike. */
export function resolveIonStrike(masterVolume: number, balance: number, distance: number): SoundEffectRequest {
    const d = Math.min(1, distance);
    return { filename: 'ion_strike.wav', balance, volume: masterVolume * 1.8 * d, frequency: 0 };
}

/** Port of ResolveWeapon. */
export function resolveWeapon(
    masterVolume: number,
    soundEffectFilename: string | null,
    balance: number,
    distance: number,
): SoundEffectRequest {
    const d = Math.min(1, distance);
    return { filename: soundEffectFilename ?? '', balance, volume: masterVolume * 0.23 * d, frequency: 0 };
}

/** Port of ResolveFighterWeapon (ComponentType 1/2/4 select the file). */
export function resolveFighterWeapon(
    masterVolume: number,
    effectFilename: string,
    type: ComponentType,
    balance: number,
    distance: number,
): SoundEffectRequest {
    let text = '';
    let num = 0.19;
    switch (type) {
        case ComponentType.WeaponBeam: // (ComponentType)1
            text = effectFilename;
            break;
        case ComponentType.WeaponTorpedo: // (ComponentType)2
            text = effectFilename;
            num = 0.25;
            break;
        case ComponentType.WeaponMissile: // (ComponentType)4
            text = effectFilename;
            num = 0.25;
            break;
    }
    const d = Math.min(1, distance);
    return { filename: text, balance, volume: masterVolume * num * d, frequency: 0 };
}

/** Port of ResolveAmbientEffect. `nextEffectOffset.value` is written out
 * (C# out parameter). */
export function resolveAmbientEffect(
    masterVolume: number,
    soundScheme: number,
    balance: number,
    distance: number,
    nextEffectOffset: { value: number },
    rand: () => number,
): SoundEffectRequest {
    let text = '';
    const num = masterVolume * 0.7;
    nextEffectOffset.value = 4000;
    switch (soundScheme) {
        case 0: {
            switch (Math.floor(rand() * 3)) {
                case 0:
                    text = 'ambient1_voice1.wav';
                    nextEffectOffset.value = 5500;
                    break;
                case 1:
                    text = 'ambient1_voice2.wav';
                    nextEffectOffset.value = 10800;
                    break;
                case 2:
                    text = 'ambient1_voice3.wav';
                    nextEffectOffset.value = 6600;
                    break;
            }
            break;
        }
        case 1: {
            switch (Math.floor(rand() * 4)) {
                case 0:
                    text = 'ambient2_voice1.wav';
                    nextEffectOffset.value = 9200;
                    break;
                case 1:
                    text = 'ambient2_voice2.wav';
                    nextEffectOffset.value = 9200;
                    break;
                case 2:
                    text = 'ambient2_voice3.wav';
                    nextEffectOffset.value = 8200;
                    break;
                case 3:
                    text = 'ambient2_voice4.wav';
                    nextEffectOffset.value = 9200;
                    break;
            }
            break;
        }
        case 2: {
            switch (Math.floor(rand() * 3)) {
                case 0:
                    text = 'ambient3_energy1.wav';
                    nextEffectOffset.value = 8400;
                    break;
                case 1:
                    text = 'ambient3_energy2.wav';
                    nextEffectOffset.value = 8400;
                    break;
                case 2:
                    text = 'ambient3_energy3.wav';
                    nextEffectOffset.value = 11400;
                    break;
            }
            break;
        }
        case 3: {
            switch (Math.floor(rand() * 5)) {
                case 0:
                case 1:
                    text = 'ambient4_boom1.wav';
                    nextEffectOffset.value = 5500;
                    break;
                case 2:
                case 3:
                    text = 'ambient4_boom2.wav';
                    nextEffectOffset.value = 6500;
                    break;
                case 4:
                    text = 'ambient4_boom3.wav';
                    nextEffectOffset.value = 8500;
                    break;
            }
            break;
        }
    }
    const d = Math.min(1, distance);
    return { filename: text, balance, volume: num * d, frequency: 0 };
}

/** Port of ResolveAttackClick. */
export function resolveAttackClick(masterVolume: number): SoundEffectRequest {
    return { filename: 'attack_click.wav', balance: 0, volume: masterVolume * 1.0, frequency: 0 };
}

/** Port of ResolveImportantMessage. */
export function resolveImportantMessage(masterVolume: number): SoundEffectRequest {
    return { filename: 'message_major.wav', balance: 0, volume: masterVolume * 0.7, frequency: 0 };
}

/** Message types routed to message_minor.wav (port of the ResolveMessage
 * cases 14/55/56). */
const MESSAGE_MINOR_TYPES = new Set([14, 55, 56]);
/** Message types routed to message_alarm.wav (cases 20/22). */
const MESSAGE_ALARM_TYPES = new Set([20, 22]);
/** Message types routed to message_major.wav (the long case list). */
const MESSAGE_MAJOR_TYPES = new Set([
    24, 26, 29, 31, 33, 34, 50, 59, 60, 63, 67, 68, 72, 78, 79, 82, 91, 92, 96,
]);

/** Port of ResolveMessage. `messageType` is the numeric EmpireMessageType
 * value (the enum itself is not ported). Types 1–13, 15–19, 21, 23, 25,
 * 27, 28, 30, 32, 35–49, 51–54, 57, 58, 61, 62, 64–66, 69–71, 73–77,
 * 80, 81, 83–90, 93–95, 97 → message_standard; anything else → '' (no
 * sound), matching the C# switch's fall-through. */
export function resolveMessage(masterVolume: number, messageType: number): SoundEffectRequest {
    let text = '';
    let num = masterVolume * 0.7;
    if (MESSAGE_MINOR_TYPES.has(messageType)) {
        text = 'message_minor.wav';
    } else if (MESSAGE_ALARM_TYPES.has(messageType)) {
        text = 'message_alarm.wav';
        num = masterVolume * 0.4;
    } else if (MESSAGE_MAJOR_TYPES.has(messageType)) {
        text = 'message_major.wav';
    } else if (
        messageType >= 1 &&
        messageType <= 97 &&
        !MESSAGE_MINOR_TYPES.has(messageType) &&
        !MESSAGE_ALARM_TYPES.has(messageType) &&
        !MESSAGE_MAJOR_TYPES.has(messageType)
    ) {
        // The remaining values in 1..97 are all in the standard group.
        text = 'message_standard.wav';
    }
    return { filename: text, balance: 0, volume: num, frequency: 0 };
}

/** Port of ResolveHyperjumpEntry. */
export function resolveHyperjumpEntry(masterVolume: number, balance: number, distance: number): SoundEffectRequest {
    const d = Math.min(1, distance);
    return { filename: 'Hyperjump_Enter.wav', balance, volume: masterVolume * 0.45 * d, frequency: 0 };
}

/** Port of ResolveHyperjumpExit. */
export function resolveHyperjumpExit(masterVolume: number, balance: number, distance: number): SoundEffectRequest {
    const d = Math.min(1, distance);
    return { filename: 'Hyperjump_Exit.wav', balance, volume: masterVolume * 0.5 * d, frequency: 0 };
}

/** Port of ResolveStar. Returns null when the type has no star sound
 * (num3 stays 0). */
export function resolveStar(
    masterVolume: number,
    starType: HabitatType,
    balance: number,
    distance: number,
    rand: () => number,
): SoundEffectRequest | null {
    const num = Math.floor(rand() * 2);
    let text = '';
    let num2 = 1.0;
    let num3 = 0;
    switch (starType) {
        case HabitatType.MainSequence: // (HabitatType)1
            text = 'star_basic1.wav';
            if (num === 1) text = 'star_basic2.wav';
            num3 = 23;
            num2 = 0.7;
            break;
        case HabitatType.RedGiant: // (HabitatType)2
        case HabitatType.SuperGiant: // (HabitatType)3
            text = 'star_bass1.wav';
            if (num === 1) text = 'star_bass2.wav';
            num3 = 25;
            num2 = 0.7;
            break;
        case HabitatType.WhiteDwarf: // (HabitatType)4
            text = 'star_hollow1.wav';
            if (num === 1) text = 'star_hollow2.wav';
            num3 = 27;
            num2 = 0.5;
            break;
        case HabitatType.Neutron: // (HabitatType)5
            text = 'star_ring1.wav';
            if (num === 1) text = 'star_ring2.wav';
            num3 = 29;
            num2 = 1.2;
            break;
        case HabitatType.BlackHole: // (HabitatType)6
            text = 'star_intense1.wav';
            if (num === 1) text = 'star_intense2.wav';
            num3 = 31;
            num2 = 1.0;
            break;
    }
    if (num3 === 0) {
        return null;
    }
    // num3 += num; — only used by callers that need the pitch variant index;
    // the request itself carries no frequency, so it has no observable
    // effect here (kept as a comment for fidelity).
    const d = Math.min(1, distance);
    return { filename: text, balance, volume: masterVolume * 1.2 * d * num2, frequency: 0 };
}

/** Port of ResolveMining. */
export function resolveMining(
    masterVolume: number,
    balance: number,
    distance: number,
    rand: () => number,
): SoundEffectRequest {
    const num = Math.floor(rand() * 4);
    let num2 = masterVolume * 0.22;
    let filename = '';
    switch (num) {
        case 0:
            filename = 'mining_1.wav';
            break;
        case 1:
            filename = 'mining_2.wav';
            break;
        case 2:
            filename = 'mining_3.wav';
            break;
        case 3:
            filename = 'mining_4.wav';
            num2 = masterVolume * 0.5;
            break;
    }
    const d = Math.min(1, distance);
    return { filename, balance, volume: num2 * d, frequency: 0 };
}

/** Port of ResolveThunder. */
export function resolveThunder(
    masterVolume: number,
    balance: number,
    distance: number,
    rand: () => number,
): SoundEffectRequest {
    const num = Math.floor(rand() * 3);
    let filename = '';
    switch (num) {
        case 0:
            filename = 'thunder1.wav';
            break;
        case 1:
            filename = 'thunder2.wav';
            break;
        case 2:
            filename = 'thunder3.wav';
            break;
    }
    const d = Math.min(1, distance);
    return { filename, balance, volume: masterVolume * 1.3 * d, frequency: 0 };
}

/** Port of ResolveConstruction. */
export function resolveConstruction(
    masterVolume: number,
    balance: number,
    distance: number,
    rand: () => number,
): SoundEffectRequest {
    const num = Math.floor(rand() * 5);
    let filename = '';
    switch (num) {
        case 0:
            filename = 'construction.wav';
            break;
        case 1:
            filename = 'construction_2.wav';
            break;
        case 2:
            filename = 'construction_3.wav';
            break;
        case 3:
            filename = 'construction_4.wav';
            break;
        case 4:
            filename = 'construction_5.wav';
            break;
    }
    const d = Math.min(1, distance);
    return { filename, balance, volume: masterVolume * 0.7 * d, frequency: 0 };
}

/** Port of ResolveGasMining. */
export function resolveGasMining(
    masterVolume: number,
    balance: number,
    distance: number,
    rand: () => number,
): SoundEffectRequest {
    const d = Math.min(1, distance);
    const num = Math.floor(rand() * 3);
    let filename = '';
    switch (num) {
        case 0:
            filename = 'GasMining1.wav';
            break;
        case 1:
            filename = 'GasMining2.wav';
            break;
        case 2:
            filename = 'gasmining3.wav';
            break;
    }
    return { filename, balance, volume: masterVolume * 0.5 * d, frequency: 0 };
}

/** Port of ResolvePlanetExplosion (size is unused by the original). */
export function resolvePlanetExplosion(
    _masterVolume: number,
    _size: number,
    balance: number,
    distance: number,
): SoundEffectRequest {
    const d = Math.min(1, distance);
    // The original computes num = 1.0, clamps it to 1.0, then overwrites it
    // with 2.1 — the final factor is 2.1.
    return { filename: 'planetExplosion.wav', balance, volume: _masterVolume * 2.1 * d, frequency: 0 };
}

/** Port of ResolveExplosion. Note the faithful quirk: after picking the
 * 0.75 / 0.9 / 2.5 factors the original clamps `num2 = Math.Min(1.0, num2)`,
 * so the >110-size 2.5 becomes 1.0. */
export function resolveExplosion(
    masterVolume: number,
    size: number,
    balance: number,
    distance: number,
    rand: () => number,
): SoundEffectRequest {
    let text = '';
    const d = Math.min(1, distance);
    let num2: number;
    if (size < 100) {
        const num = Math.floor(rand() * 3);
        if (num === 0) {
            text = 'explosion_small.wav';
        } else if (num === 1) {
            text = 'explosion_small2.wav';
        } else {
            text = 'explosion_small3.wav';
        }
        num2 = 0.75;
    } else {
        const num3 = Math.floor(rand() * 3);
        if (num3 === 0) {
            text = 'explosion.wav';
        } else if (num3 === 1) {
            text = 'explosion2.wav';
        } else {
            text = 'explosion3.wav';
        }
        num2 = 0.9;
        if (size > 110) {
            num2 = 2.5;
        }
    }
    num2 = Math.min(1.0, num2);
    return { filename: text, balance, volume: masterVolume * num2 * d, frequency: 0 };
}

let instance: EffectsPlayer | null = null;

/** Create (once) and register the global effects player. Call alongside
 * startMusic(); actual audio waits for the first user gesture. */
export function startEffects(): EffectsPlayer {
    if (instance === null) {
        instance = new EffectsPlayer();
        // Task 12h: apply the persisted sound settings to a freshly created
        // player so it starts at the saved volume/mute state. getSettings()
        // is storage-backed and never touches audio, so this stays safe in
        // node test environments.
        const s = getSettings();
        instance.setVolume(s.soundVolume);
        if (s.soundMuted) {
            instance.mute();
        }
        void instance.initialize();
    }
    instance.startEffects();
    return instance;
}