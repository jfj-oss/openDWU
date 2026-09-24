// Sound effects (task C4), on the Web Audio API. Ports of
//   DistantWorlds/EffectsPlayer.cs      (Resolve* request builders, PlayEffect, sfx bank)
//   DistantWorlds/SoundEffectRequest.cs (Volume / Balance / Frequency / Filename)
//   Main.Part13.cs method_0/1/2         (the request queue: at most int_3 = 10
//                                        pending requests, extra requests dropped,
//                                        flushed once per Main View frame)
//   Controls/MainView.1.cs method_90    (stereo balance + distance attenuation
//                                        from the view centre)
//   DistantWorlds.Controls GlassButton / HoverButton / HoverMenuItem /
//   ListViewBase, with the sounds Main.Part13.cs 905-944 assigns them
//                                       (button1.wav / button2.wav / grid.wav)
// EffectsPlayer.DX.cs (the DirectSound backend) is intentionally not ported.
//
// Sounds load from /assets/dwu/Sounds/Effects/<file>. The C# path is
// "\sounds\effects\" on a case-insensitive file system; the dev server and
// desktop shell resolve /assets/dwu case-insensitively (task 05d).

import { Random } from '../sim/random';

export const EFFECTS_BASE_URL = '/assets/dwu/Sounds/Effects/';

// Port of SoundEffectRequest.cs.
export interface SoundEffectRequest {
    filename: string;
    balance: number;
    volume: number;
    frequency: number;
}

function request(filename: string, balance: number, volume: number): SoundEffectRequest {
    return { filename, balance, volume, frequency: 0 };
}

// Port of MainView.1.cs method_90(x, y, zoomFactor): balance -1..1 from the
// horizontal offset, and a 0.02..1 distance factor from the screen centre,
// divided by sqrt(zoom factor) (C# double_0 = 1 / pixels-per-unit) and
// silenced when zoomed out past factor 50.
export function resolveBalanceAndDistance(
    screenX: number,
    screenY: number,
    viewWidth: number,
    viewHeight: number,
    zoomFactor: number,
): { balance: number; distance: number } {
    const num = viewWidth / 2.0;
    const y = viewHeight / 2.0;
    const balance = (screenX - num) / num;
    let num2 = Math.trunc(Math.sqrt(num * num + y * y));
    num2 = Math.trunc(num2 * 1.5);
    const dx = num - screenX;
    const dy = y - screenY;
    const num3 = Math.trunc(Math.sqrt(dx * dx + dy * dy));
    let val = (num2 - num3) / num2;
    val = Math.max(0.02, val);
    const num4 = Math.max(1.0, Math.sqrt(zoomFactor));
    let distance = val / num4;
    if (zoomFactor > 50.0) {
        distance = 0.0;
    }
    return { balance, distance };
}

// C# EmpireMessageType values grouped by EffectsPlayer.ResolveMessage.
const MESSAGE_MINOR = new Set([14, 55, 56]);
const MESSAGE_ALARM = new Set([20, 22]);
const MESSAGE_MAJOR = new Set([24, 26, 29, 31, 33, 34, 50, 59, 60, 63, 67, 68, 72, 78, 79, 82, 91, 92, 96]);
const MESSAGE_NONE = new Set([0]);

// ---------------------------------------------------------------------------
// Web Audio seam (so tests can supply a fake context).
// ---------------------------------------------------------------------------

export interface AudioBackend {
    /** Decode a file into a playable buffer (null if missing). */
    load(url: string): Promise<AudioBuffer | null>;
    /** Start a buffer; returns a handle whose `ended` flag flips when done. */
    play(buffer: AudioBuffer, pan: number, gain: number, playbackRate: number): PlayingSound;
}

export interface PlayingSound {
    readonly ended: boolean;
    stop(): void;
}

// Browser backend: BufferSource -> StereoPanner -> Gain -> destination.
export class WebAudioBackend implements AudioBackend {
    private ctx: AudioContext | null = null;

    private context(): AudioContext {
        if (this.ctx === null) {
            this.ctx = new AudioContext();
        }
        // Browsers start the context suspended until a user gesture.
        if (this.ctx.state === 'suspended') {
            void this.ctx.resume();
        }
        return this.ctx;
    }

    async load(url: string): Promise<AudioBuffer | null> {
        try {
            const r = await fetch(url);
            if (!r.ok) return null;
            const data = await r.arrayBuffer();
            return await this.context().decodeAudioData(data);
        } catch {
            return null;
        }
    }

    play(buffer: AudioBuffer, pan: number, gain: number, playbackRate: number): PlayingSound {
        const ctx = this.context();
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = playbackRate;
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(panner).connect(g).connect(ctx.destination);
        const handle = { ended: false, stop: () => src.stop() };
        src.onended = () => {
            handle.ended = true;
            src.disconnect();
        };
        src.start();
        return handle;
    }
}

// ---------------------------------------------------------------------------
// EffectsPlayer
// ---------------------------------------------------------------------------

export class EffectsPlayer {
    // C# double_0 = 0.7 (the master effects volume; Main sets it from options).
    volume = 0.7;
    private backend: AudioBackend;
    private baseUrl: string;
    // C# sfxBank (filename -> SoundEffect). Promises so concurrent requests
    // for a not-yet-loaded file share one fetch.
    private sfxBank = new Map<string, Promise<AudioBuffer | null>>();
    // C# list_0: live SoundEffectInstances.
    private instances: PlayingSound[] = [];
    // C# random_0 = new Random((int)DateTime.Now.Ticks) — cosmetic variety,
    // intentionally not the galaxy stream.
    private random: Random;

    constructor(backend: AudioBackend = new WebAudioBackend(), baseUrl = EFFECTS_BASE_URL, seed = Date.now() & 0x7fffffff) {
        this.backend = backend;
        this.baseUrl = baseUrl;
        this.random = new Random(seed);
    }

    // Port of method_0 (Initialize): preload the weapon sounds (component
    // SoundEffectFilenames) and the six explosions.
    preload(weaponSoundFilenames: readonly string[] = []): Promise<void> {
        const list = [...weaponSoundFilenames, 'Explosion.wav', 'Explosion2.wav', 'Explosion3.wav', 'Explosion_Small.wav', 'Explosion_Small2.wav', 'Explosion_Small3.wav'];
        return Promise.all(list.map((f) => this.buffer(f))).then(() => undefined);
    }

    // Port of Clear.
    clear(): void {
        this.sfxBank.clear();
    }

    private buffer(filename: string): Promise<AudioBuffer | null> {
        const key = filename.toLowerCase();
        let p = this.sfxBank.get(key);
        if (p === undefined) {
            p = this.backend.load(this.baseUrl + filename);
            this.sfxBank.set(key, p);
        }
        return p;
    }

    /** Number of live (not yet cleared) sound instances. */
    get activeCount(): number {
        return this.instances.length;
    }

    // Port of ClearFinishedBuffers.
    clearFinishedBuffers(): void {
        this.instances = this.instances.filter((i) => !i.ended);
    }

    // Port of PlayEffect(filename, balance, volume, frequency): Pan =
    // clamp(balance, -1, 1), Volume = volume, Pitch = frequency when > 0 (XNA
    // pitch in octaves → playbackRate 2^pitch). Missing files are skipped.
    async playEffect(filename: string, balance: number, volume: number, frequency = 0): Promise<void> {
        if (filename === '') return;
        const buf = await this.buffer(filename);
        if (buf === null) return;
        const pan = Math.max(-1, Math.min(1, balance));
        const rate = frequency > 0 ? Math.pow(2, Math.min(1, frequency)) : 1;
        this.instances.push(this.backend.play(buf, pan, Math.max(0, Math.min(1, volume)), rate));
    }

    // --- Resolve* request builders (EffectsPlayer.cs) ---

    resolveIonStrike(balance: number, distance: number): SoundEffectRequest {
        return request('ion_strike.wav', balance, this.volume * 1.8 * Math.min(1.0, distance));
    }

    // component.SoundEffectFilename, 0.23.
    resolveWeapon(soundEffectFilename: string, balance: number, distance: number): SoundEffectRequest {
        return request(soundEffectFilename, balance, this.volume * 0.23 * Math.min(1.0, distance));
    }

    // ComponentType 1 (WeaponBeam) 0.19, 2 / 4 0.25; other types: no file.
    resolveFighterWeapon(effectFilename: string, type: number, balance: number, distance: number): SoundEffectRequest {
        let text = '';
        let num = 0.19;
        switch (type) {
            case 1:
                text = effectFilename;
                break;
            case 2:
            case 4:
                text = effectFilename;
                num = 0.25;
                break;
        }
        return request(text, balance, this.volume * num * Math.min(1.0, distance));
    }

    resolveAmbientEffect(soundScheme: number, balance: number, distance: number): { request: SoundEffectRequest; nextEffectOffset: number } {
        let text = '';
        const num = this.volume * 0.7;
        let nextEffectOffset = 4000;
        switch (soundScheme) {
            case 0:
                switch (this.random.next(0, 3)) {
                    case 0: text = 'ambient1_voice1.wav'; nextEffectOffset = 5500; break;
                    case 1: text = 'ambient1_voice2.wav'; nextEffectOffset = 10800; break;
                    case 2: text = 'ambient1_voice3.wav'; nextEffectOffset = 6600; break;
                }
                break;
            case 1:
                switch (this.random.next(0, 4)) {
                    case 0: text = 'ambient2_voice1.wav'; nextEffectOffset = 9200; break;
                    case 1: text = 'ambient2_voice2.wav'; nextEffectOffset = 9200; break;
                    case 2: text = 'ambient2_voice3.wav'; nextEffectOffset = 8200; break;
                    case 3: text = 'ambient2_voice4.wav'; nextEffectOffset = 9200; break;
                }
                break;
            case 2:
                switch (this.random.next(0, 3)) {
                    case 0: text = 'ambient3_energy1.wav'; nextEffectOffset = 8400; break;
                    case 1: text = 'ambient3_energy2.wav'; nextEffectOffset = 8400; break;
                    case 2: text = 'ambient3_energy3.wav'; nextEffectOffset = 11400; break;
                }
                break;
            case 3:
                switch (this.random.next(0, 5)) {
                    case 0:
                    case 1: text = 'ambient4_boom1.wav'; nextEffectOffset = 5500; break;
                    case 2:
                    case 3: text = 'ambient4_boom2.wav'; nextEffectOffset = 6500; break;
                    case 4: text = 'ambient4_boom3.wav'; nextEffectOffset = 8500; break;
                }
                break;
        }
        return { request: request(text, balance, num * Math.min(1.0, distance)), nextEffectOffset };
    }

    resolveAttackClick(): SoundEffectRequest {
        return request('attack_click.wav', 0.0, this.volume * 1.0);
    }

    resolveImportantMessage(): SoundEffectRequest {
        return request('message_major.wav', 0.0, this.volume * 0.7);
    }

    // Port of ResolveMessage(EmpireMessageType): every listed type not in the
    // minor / alarm / major groups plays message_standard.wav (types not
    // listed at all, e.g. 0, play nothing).
    resolveMessage(messageType: number): SoundEffectRequest {
        let text = '';
        let num = this.volume * 0.7;
        if (MESSAGE_MINOR.has(messageType)) {
            text = 'message_minor.wav';
        } else if (MESSAGE_ALARM.has(messageType)) {
            text = 'message_alarm.wav';
            num = this.volume * 0.4;
        } else if (MESSAGE_MAJOR.has(messageType)) {
            text = 'message_major.wav';
        } else if (!MESSAGE_NONE.has(messageType) && messageType >= 1 && messageType <= 97) {
            text = 'message_standard.wav';
        }
        return request(text, 0.0, num);
    }

    resolveHyperjumpEntry(balance: number, distance: number): SoundEffectRequest {
        return request('Hyperjump_Enter.wav', balance, this.volume * 0.45 * Math.min(1.0, distance));
    }

    resolveHyperjumpExit(balance: number, distance: number): SoundEffectRequest {
        return request('Hyperjump_Exit.wav', balance, this.volume * 0.5 * Math.min(1.0, distance));
    }

    // HabitatType 1 MainSequence, 2/3 Red/SuperGiant, 4 WhiteDwarf, 5 Neutron,
    // 6 BlackHole; anything else → null.
    resolveStar(starType: number, balance: number, distance: number): SoundEffectRequest | null {
        const num = this.random.next(0, 2);
        let num2 = 1.0;
        let text = '';
        let num3 = 0;
        switch (starType) {
            case 1: text = num === 1 ? 'star_basic2.wav' : 'star_basic1.wav'; num3 = 23; num2 = 0.7; break;
            case 2:
            case 3: text = num === 1 ? 'star_bass2.wav' : 'star_bass1.wav'; num3 = 25; num2 = 0.7; break;
            case 4: text = num === 1 ? 'star_hollow2.wav' : 'star_hollow1.wav'; num3 = 27; num2 = 0.5; break;
            case 5: text = num === 1 ? 'star_ring2.wav' : 'star_ring1.wav'; num3 = 29; num2 = 1.2; break;
            case 6: text = num === 1 ? 'star_intense2.wav' : 'star_intense1.wav'; num3 = 31; num2 = 1.0; break;
        }
        if (num3 === 0) return null;
        return request(text, balance, this.volume * 1.2 * Math.min(1.0, distance) * num2);
    }

    resolveMining(balance: number, distance: number): SoundEffectRequest {
        const num = this.random.next(0, 4);
        let num2 = this.volume * 0.22;
        let file = '';
        switch (num) {
            case 0: file = 'Mining_1.wav'; break;
            case 1: file = 'Mining_2.wav'; break;
            case 2: file = 'Mining_3.wav'; break;
            case 3: file = 'mining_4.wav'; num2 = this.volume * 0.5; break;
        }
        return request(file, balance, num2 * Math.min(1.0, distance));
    }

    resolveThunder(balance: number, distance: number): SoundEffectRequest {
        const file = ['thunder1.wav', 'thunder2.wav', 'thunder3.wav'][this.random.next(0, 3)];
        return request(file, balance, this.volume * 1.3 * Math.min(1.0, distance));
    }

    resolveConstruction(balance: number, distance: number): SoundEffectRequest {
        const file = ['construction.wav', 'construction_2.wav', 'construction_3.wav', 'construction_4.wav', 'construction_5.wav'][this.random.next(0, 5)];
        return request(file, balance, this.volume * 0.7 * Math.min(1.0, distance));
    }

    resolveGasMining(balance: number, distance: number): SoundEffectRequest {
        distance = Math.min(1.0, distance);
        const file = ['GasMining1.wav', 'GasMining2.wav', 'gasmining3.wav'][this.random.next(0, 3)];
        return request(file, balance, this.volume * 0.5 * distance);
    }

    // C#: num is set to 1.0, then Min(1, num), then overwritten with 2.1.
    resolvePlanetExplosion(_size: number, balance: number, distance: number): SoundEffectRequest {
        return request('planetExplosion.wav', balance, this.volume * 2.1 * Math.min(1.0, distance));
    }

    resolveExplosion(size: number, balance: number, distance: number): SoundEffectRequest {
        distance = Math.min(1.0, distance);
        let text: string;
        let num2: number;
        if (size < 100) {
            const num = this.random.next(0, 3);
            text = num === 0 ? 'explosion_small.wav' : num === 1 ? 'explosion_small2.wav' : 'explosion_small3.wav';
            num2 = 0.75;
        } else {
            const num3 = this.random.next(0, 3);
            text = num3 === 0 ? 'explosion.wav' : num3 === 1 ? 'explosion2.wav' : 'explosion3.wav';
            num2 = 0.9;
            if (size > 110) num2 = 2.5;
        }
        num2 = Math.min(1.0, num2);
        return request(text, balance, this.volume * num2 * distance);
    }

    // Main.Part10.cs method_225: grid.wav at the effects volume (control-group
    // hotkeys, selection by click in the Main View).
    resolveGrid(): SoundEffectRequest {
        return request('grid.wav', 0.0, this.volume);
    }
}

// ---------------------------------------------------------------------------
// Request queue (Main.Part13.cs method_0 / method_1 / method_2)
// ---------------------------------------------------------------------------

// C# int_3 = 10 (Main ctor, Main.Part13.cs).
export const MAX_PENDING_SOUND_REQUESTS = 10;

export class SoundEffectQueue {
    private pending: SoundEffectRequest[] = [];
    constructor(private player: EffectsPlayer, private limit = MAX_PENDING_SOUND_REQUESTS) {}

    // method_0: accepted only while fewer than `limit` are pending
    // (first-come; later requests in the same frame are dropped).
    enqueue(req: SoundEffectRequest | null): boolean {
        if (req === null) return false;
        if (this.pending.length < this.limit) {
            this.pending.push(req);
            return true;
        }
        return false;
    }

    get pendingCount(): number {
        return this.pending.length;
    }

    // method_1 + method_2: play everything pending (in order), then clear
    // finished instances. Called once per Main View frame.
    flush(): void {
        if (this.pending.length === 0) return;
        const array = this.pending;
        this.pending = [];
        for (const r of array) {
            void this.player.playEffect(r.filename, r.balance, r.volume, r.frequency);
        }
        this.player.clearFinishedBuffers();
    }
}

// ---------------------------------------------------------------------------
// UI click sounds (GlassButton / HoverButton / HoverMenuItem / ListViewBase)
// ---------------------------------------------------------------------------

// Main.Part13.cs 905-944: GlassButton → button1.wav, HoverButton and
// HoverMenuItem → button2.wav, ListViewBase → grid.wav.
export type UiClickKind = 'glass' | 'hover' | 'menuItem' | 'list';

export const UI_CLICK_SOUND: Record<UiClickKind, string> = {
    glass: 'button1.wav',
    hover: 'button2.wav',
    menuItem: 'button2.wav',
    list: 'grid.wav',
};

// Each control class plays through one static System.Media.SoundPlayer:
// Play() restarts the sound (no overlap per class) and is skipped when the
// class Volume <= 0. SoundPlayer has no volume of its own, so the click plays
// at full gain.
export class UiClickSounds {
    // GlassButton.Volume etc. (set from options.SoundEffectsVolume).
    volume = 1.0;
    private current = new Map<UiClickKind, PlayingSound>();
    private backend: AudioBackend;
    private buffers = new Map<string, Promise<AudioBuffer | null>>();

    constructor(backend: AudioBackend = new WebAudioBackend(), private baseUrl = EFFECTS_BASE_URL) {
        this.backend = backend;
    }

    async play(kind: UiClickKind): Promise<void> {
        if (this.volume <= 0.0) return;
        const file = UI_CLICK_SOUND[kind];
        let p = this.buffers.get(file);
        if (p === undefined) {
            p = this.backend.load(this.baseUrl + file);
            this.buffers.set(file, p);
        }
        const buf = await p;
        if (buf === null) return;
        this.current.get(kind)?.stop();
        this.current.set(kind, this.backend.play(buf, 0, 1, 1));
    }
}

// Shared instance for the HUD (created lazily so importing this module in
// tests or at boot doesn't create an AudioContext).
let sharedUiClicks: UiClickSounds | null = null;
export function uiClickSounds(): UiClickSounds {
    if (sharedUiClicks === null) sharedUiClicks = new UiClickSounds();
    return sharedUiClicks;
}
