// Port of DistantWorlds.MusicPlayer (MusicPlayer.cs) on an HTMLAudioElement.
//
// MusicPlayer.cs keeps no moods or playlists: its constructor lists every
// *.mp3 in the music folder (string_3, MusicPlayer.cs:107) and EbsZqjqvhZ
// (MusicPlayer.cs:347) picks a random one of them, never the one that is
// playing. Tracks do not loop: mediaPlayer_0_MediaEnded (MusicPlayer.cs:210)
// picks the next random track when the song stops. StartThemeInternal plays
// the theme file (DistantWorldsTheme.mp3), ForceSwitch fades out and starts a
// random track, FadePause/FadeResume/FadeStop run the 50 ms fade timer
// (timer_0_Elapsed, MusicPlayer.cs:286) with its sqrt curve (double_1 = 0.02,
// min step 0.005) and the 20-tick settle before the finish action, and
// MediaPlayer.Volume is always volume * 0.6.
//
// Main owns two players (Main.cs:2147-2149): musicPlayer_0 for the music and
// musicPlayer_1 for the event stings (wonder.mp3, discovery.mp3,
// diplomacyMood*.mp3, … in Sounds/Effects; Main.Part4.cs:273-478). Both
// drive XNA's single static MediaPlayer in the decompiled build, so a sting
// replaces the song; here each player has its own element so the sting plays
// while the music fades out, as in the original (non-XNA) game.
//
// Browsers block audio until a user gesture: a play() before the first
// pointerdown/keydown is retried on that gesture.

import { getSettings } from '../ui/settings';
import { pickRimWeightedTrack } from './rimAtmosphereMix'; // [rimatmo-wiring] 19i item 8 (pure; no render/Pixi import)

/** Track files in Sounds/Music/ (MusicPlayer.cs:107 Directory.GetFiles(folder, "*.mp3")). */
export const MUSIC_FILES: readonly string[] = [
    'Action1.mp3',
    'Action2.mp3',
    'BoldStroke.mp3',
    'Desperate.mp3',
    'DistantWorldsTheme.mp3',
    'DistantWorldsTheme_Legends.mp3',
    'DistantWorldsTheme_Original.mp3',
    'DistantWorldsTheme_ROTS.mp3',
    'Forceful.mp3',
    'Frustrated.mp3',
    'Gripping.mp3',
    'Intensity.mp3',
    'OnTrack.mp3',
    'Outlaw.mp3',
    'Pursuit.mp3',
    'Shadows.mp3',
    'Shock.mp3',
    'Strike.mp3',
    'Striving.mp3',
    'Suspense.mp3',
    'Utopia.mp3',
];

/** Folder the tracks are served from (the desktop shell maps /assets/dwu/ to the DW:U install folder). */
export const MUSIC_URL_PREFIX = '/assets/dwu/Sounds/Music/';
/** Folder of the event stings (Main.Part4.cs: Application.StartupPath + "\sounds\effects\"). */
export const EFFECTS_URL_PREFIX = '/assets/dwu/Sounds/Effects/';

/** Main.Part12.cs:1346 / 2430 themeMusic = "DistantWorldsTheme.mp3". */
export const THEME_MUSIC_FILE = 'DistantWorldsTheme.mp3';

/** Port of DistantWorlds.MusicFadeFinishAction. */
export enum MusicFadeFinishAction {
    StartNewMusic,
    Stop,
    Pause,
    Resume,
}

/** Port of MusicPlayer.cs:347 EbsZqjqvhZ: a random file of the folder, drawn again while it is empty or equals the
 * current one (only when the folder has more than one file). `rand` returns [0, 1). */
export function pickNextTrack(files: readonly string[], currentFile: string | null, rand: () => number): string | null {
    if (files.length === 0) return null;
    let text = currentFile ?? '';
    while (text === '' || (files.length > 1 && text === currentFile)) {
        text = files[Math.floor(rand() * files.length)];
    }
    return text;
}

/** One 50 ms fade tick (MusicPlayer.cs:288-307 timer_0_Elapsed): advance `level` toward `target` by
 * max(0.005, sqrt(level + 0.1) * 0.02) * direction and clamp at the target. Returns [newLevel, reachedTarget]. */
export function fadeStep(level: number, target: number, direction: number): [number, boolean] {
    let num = level;
    let val = Math.sqrt(level + 0.1) * 0.02;
    val = Math.max(0.005, val);
    num += direction * val;
    let flag = false;
    if (direction > 0) {
        if (num >= target) {
            flag = true;
            num = target;
        }
    } else if (num <= target) {
        flag = true;
        num = target;
    }
    return [num, flag];
}

// ---------------------------------------------------------------------------
// Media seam (XNA's static MediaPlayer), so the player logic runs in node tests.
// ---------------------------------------------------------------------------

export interface MediaBackend {
    /** MediaPlayer.Play(Song.FromUri(url)): load and start from the beginning. */
    play(url: string): void;
    pause(): void;
    resume(): void;
    stop(): void;
    /** MediaPlayer.Volume (0..1). */
    volume: number;
    /** MediaPlayer.PlayPosition in seconds (0 when stopped or ended). */
    readonly position: number;
    /** Called when the song stops at its end (MediaStateChanged → Stopped). */
    onEnded: (() => void) | null;
}

/** HTMLAudioElement backend; retries a gesture-blocked play() on the first pointerdown/keydown. */
export class HtmlMediaBackend implements MediaBackend {
    private readonly el: HTMLAudioElement;
    private blocked = false;
    onEnded: (() => void) | null = null;

    constructor() {
        this.el = new Audio();
        this.el.preload = 'auto';
        this.el.loop = false; // MediaPlayer.IsRepeating is never set: songs end and MediaEnded picks the next.
        this.el.addEventListener('ended', () => this.onEnded?.());
    }

    private start(): void {
        this.el.play().catch(() => {
            if (this.blocked) return;
            this.blocked = true;
            const retry = (): void => {
                window.removeEventListener('pointerdown', retry);
                window.removeEventListener('keydown', retry);
                this.blocked = false;
                if (this.el.src !== '' && this.el.paused && !this.el.ended && this.wantPlaying) this.el.play().catch(() => undefined);
            };
            window.addEventListener('pointerdown', retry);
            window.addEventListener('keydown', retry);
        });
    }

    private wantPlaying = false;

    private loadToken = 0;
    private loading = false;
    private objectUrl: string | null = null;

    // The song is fetched whole and played from a blob URL: switching songs then never aborts a half-streamed
    // media request (a stale load is simply dropped when it resolves).
    play(url: string): void {
        const token = ++this.loadToken;
        this.wantPlaying = true;
        this.loading = true;
        this.el.pause();
        fetch(url)
            .then((r) => (r.ok ? r.blob() : null))
            .catch(() => null)
            .then((blob) => {
                if (token !== this.loadToken) return;
                this.loading = false;
                if (blob === null) return;
                if (this.objectUrl !== null) URL.revokeObjectURL(this.objectUrl);
                this.objectUrl = URL.createObjectURL(blob);
                this.el.src = this.objectUrl;
                if (this.wantPlaying) this.start();
            });
    }
    pause(): void {
        this.wantPlaying = false;
        this.el.pause();
    }
    resume(): void {
        if (this.el.src === '' || this.el.ended) return;
        this.wantPlaying = true;
        this.start();
    }
    stop(): void {
        this.wantPlaying = false;
        if (this.loading) {
            this.loadToken++;
            this.loading = false;
        }
        this.el.pause();
        if (this.el.src !== '') this.el.currentTime = 0;
    }
    get volume(): number {
        return this.el.volume;
    }
    set volume(v: number) {
        this.el.volume = Math.max(0, Math.min(1, v));
    }
    get position(): number {
        if (this.loading) return this.wantPlaying ? 1e-3 : 0;
        if (this.el.src === '' || this.el.ended) return 0;
        // A play() still waiting for the gesture counts as playing (the song is queued on MediaPlayer).
        return this.wantPlaying ? Math.max(this.el.currentTime, 1e-3) : this.el.currentTime;
    }
}

export interface TimerSeam {
    setInterval(fn: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

const realTimers: TimerSeam = {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

// ---------------------------------------------------------------------------
// MusicPlayer
// ---------------------------------------------------------------------------

export class MusicPlayer {
    private readonly media: MediaBackend;
    private readonly timers: TimerSeam;
    private readonly rand: () => number;
    private readonly files: readonly string[];
    private readonly folder: string;
    private readonly themeFile: string;

    private string0: string | null = null; // current file (string_0)
    // [rimatmo-wiring] begin — 19i item 8: a "rim" mood, off by default (rimMoodProbability <= 0 with the flag off
    // or the camera outside the rim band). setRimMood is the only thing gameAudio.ts's frame loop touches here;
    // pick() falls back to the untouched pickNextTrack whenever the mood pool is empty or its probability is 0, so a
    // game without this scenario picks tracks exactly as before.
    private rimMoodFiles: readonly string[] = [];
    private rimMoodProbability = 0;

    /** gameAudio.ts, once per frame: the rim mood's track pool and how strongly to prefer it (0 = never). */
    setRimMood(files: readonly string[], probability: number): void {
        this.rimMoodFiles = files;
        this.rimMoodProbability = Math.max(0, Math.min(1, probability));
    }
    // [rimatmo-wiring] end
    private double0 = -1.0; // fade direction
    private readonly double1 = 0.02;
    private int0 = 0; // ticks at the fade target
    private finishAction = MusicFadeFinishAction.StartNewMusic;
    private double2 = 0.5; // Volume
    private double3 = 0.0; // fade level
    private bool0 = false; // IsInitiatingFade
    private timer: unknown = null;
    private subscribed = false; // MediaStateChanged += mediaPlayer_0_MediaEnded

    constructor(opts: { media?: MediaBackend; timers?: TimerSeam; rand?: () => number; files?: readonly string[]; folder?: string; themeFile?: string } = {}) {
        this.media = opts.media ?? new HtmlMediaBackend();
        this.timers = opts.timers ?? realTimers;
        this.rand = opts.rand ?? Math.random; // random_0 = new Random((int)DateTime.Now.Ticks) — cosmetic
        this.files = opts.files ?? MUSIC_FILES;
        this.folder = opts.folder ?? MUSIC_URL_PREFIX;
        this.themeFile = opts.themeFile ?? THEME_MUSIC_FILE;
        this.media.onEnded = () => this.mediaEnded();
    }

    /** Port of IsPlaying: MediaPlayer.PlayPosition > 0 (true while paused mid-song). */
    get isPlaying(): boolean {
        return this.media.position > 0.0;
    }
    /** Port of IsInitiatingFade. */
    get isInitiatingFade(): boolean {
        return this.bool0;
    }
    /** Port of Volume (double_2). */
    get volume(): number {
        return this.double2;
    }
    /** Port of ActualVolume (MediaPlayer.Volume). */
    get actualVolume(): number {
        return this.media.volume;
    }
    /** timer_0 is running (a fade in progress, including ForceSwitch, which leaves IsInitiatingFade false). */
    get fadeTimerRunning(): boolean {
        return this.timer !== null;
    }
    /** The file playing (string_0), for tests and the debug hook. */
    get currentFile(): string | null {
        return this.string0;
    }

    /** Port of Start: a random track. */
    start(): void {
        this.subscribed = true;
        this.string0 = this.pick();
        this.method1();
    }

    /** Port of Stop. */
    stop(): void {
        this.subscribed = false;
        this.media.stop();
    }

    /** Port of Pause. */
    pause(): void {
        this.media.pause();
    }

    /** Port of StartTheme / StartThemeInternal. */
    startTheme(): void {
        this.subscribed = true;
        this.string0 = this.themeFile;
        this.method1();
    }

    /** Port of SetFadeVolume. */
    setFadeVolume(volume: number): void {
        if (volume >= 0.0 && volume <= 1.0) this.media.volume = volume * 0.6;
    }

    /** Port of SetVolume(double). */
    setVolume(volume: number): void {
        if (volume >= 0.0 && volume <= 1.0) {
            this.double2 = volume;
            this.media.volume = this.double2 * 0.6;
        }
    }

    // The Options' mute is SetVolume(SoundVolume.Mute) (double_2 = 0); unmute restores the slider value.
    private unmutedVolume = 0.5;
    private muted = false;
    /** Options slider (UiSettings.musicVolume). */
    setUserVolume(volume: number): void {
        if (volume < 0 || volume > 1) return;
        this.unmutedVolume = volume;
        this.setVolume(this.muted ? 0 : volume);
    }
    mute(): void {
        this.muted = true;
        this.setVolume(0);
    }
    unmute(): void {
        this.muted = false;
        this.setVolume(this.unmutedVolume);
    }

    /** Port of mediaPlayer_0_MediaEnded. */
    private mediaEnded(): void {
        if (!this.subscribed) return;
        this.string0 = this.pick();
        this.method1();
    }

    /** Port of ResumeMusic. */
    resumeMusic(): void {
        this.bool0 = false;
        this.media.resume();
    }

    /** Port of method_0 (PlayMusicFileMethodDelegate): play a file at the player's volume. */
    playFile(url: string): void {
        this.bool0 = false;
        this.media.play(url);
        this.setVolume(this.double2);
    }

    private method1(): void {
        this.bool0 = false;
        if (this.string0 === null) return;
        this.playFile(this.folder + this.string0);
    }

    /** Port of FadeResume. */
    fadeResume(): void {
        this.bool0 = false;
        this.double3 = 0.0;
        this.double0 = 1.0;
        this.finishAction = MusicFadeFinishAction.Resume;
        this.media.volume = 0.0;
        this.media.resume();
        this.startTimer();
    }

    /** Port of FadePause. */
    fadePause(): void {
        this.bool0 = true;
        this.double3 = this.double2;
        this.double0 = -1.0;
        this.finishAction = MusicFadeFinishAction.Pause;
        this.startTimer();
    }

    /** Port of FadeStop. */
    fadeStop(): void {
        this.bool0 = true;
        this.double3 = this.double2;
        this.double0 = -1.0;
        this.finishAction = MusicFadeFinishAction.Stop;
        this.startTimer();
    }

    /** Port of ForceSwitch: fade out, then a new random track. */
    forceSwitch(): void {
        this.double3 = this.double2;
        this.double0 = -1.0;
        this.finishAction = MusicFadeFinishAction.StartNewMusic;
        this.startTimer();
    }

    private startTimer(): void {
        if (this.timer === null) this.timer = this.timers.setInterval(() => this.timerElapsed(), 50);
    }

    private stopTimer(): void {
        if (this.timer !== null) {
            this.timers.clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** Port of timer_0_Elapsed (exported for tests through tick()). */
    private timerElapsed(): void {
        const target = this.double0 > 0.0 ? this.double2 : 0.0;
        const [num, flag] = fadeStep(this.double3, target, this.double0 > 0.0 ? 1 : -1);
        // fadeStep uses step * sign; the C# multiplies by double_0 (±1.0), identical.
        if (flag) {
            this.bool0 = false;
            this.int0++;
            if (this.int0 > 20) {
                this.int0 = 0;
                switch (this.finishAction) {
                    case MusicFadeFinishAction.StartNewMusic:
                        this.string0 = this.pick();
                        this.method1();
                        this.setVolume(this.double2);
                        break;
                    case MusicFadeFinishAction.Stop:
                        this.stop();
                        break;
                    case MusicFadeFinishAction.Pause:
                        this.pause();
                        break;
                }
                this.finishAction = MusicFadeFinishAction.StartNewMusic;
                this.stopTimer();
                return;
            }
        }
        this.double3 = num;
        this.setFadeVolume(this.double3);
    }

    /** Test hook: run one 50 ms timer tick. */
    tick(): void {
        if (this.timer !== null) this.timerElapsed();
    }

    private pick(): string | null {
        // [rimatmo-wiring] 19i item 8: prefer the rim mood pool when one is set and its probability draws true;
        // pickRimWeightedTrack falls back to the full pool exactly like pickNextTrack when it does not.
        if (this.rimMoodFiles.length > 0 && this.rimMoodProbability > 0) {
            return pickRimWeightedTrack(this.files, this.rimMoodFiles, this.string0, this.rand, this.rimMoodProbability);
        }
        return pickNextTrack(this.files, this.string0, this.rand);
    }

    /** Stop the timer and the song (teardown). */
    dispose(): void {
        this.stopTimer();
        this.stop();
    }
}

// ---------------------------------------------------------------------------
// App glue: musicPlayer_0 (music) and musicPlayer_1 (event stings), with the
// Options' music volume / mute applied to both.
// ---------------------------------------------------------------------------

let music0: MusicPlayer | null = null;
let music1: MusicPlayer | null = null;
let userVolume = 0.5;
let userMuted = false;
let settingsRead = false;

function ensurePlayers(): { music: MusicPlayer; stings: MusicPlayer } {
    if (!settingsRead) {
        // Main.Part12.cs:1374 musicPlayer_0.SetVolume(gameOptions_0.MusicVolume) at creation.
        settingsRead = true;
        try {
            const s = getSettings();
            userVolume = Math.min(1, Math.max(0, s.musicVolume));
            userMuted = s.musicMuted;
        } catch {
            // no settings store (tests)
        }
    }
    if (music0 === null) {
        music0 = new MusicPlayer();
        music0.setUserVolume(userVolume);
        if (userMuted) music0.mute();
    }
    if (music1 === null) {
        music1 = new MusicPlayer({ files: [], folder: EFFECTS_URL_PREFIX });
        music1.setUserVolume(userVolume);
        if (userMuted) music1.mute();
    }
    return { music: music0, stings: music1 };
}

/** The music player (musicPlayer_0), created on first use. */
export function musicPlayer(): MusicPlayer {
    return ensurePlayers().music;
}

/** The event-sting player (musicPlayer_1), created on first use. */
export function stingPlayer(): MusicPlayer {
    return ensurePlayers().stings;
}

/** Options → both players (Main.Part4.cs musicPlayer_1.SetVolume(_Game.MusicVolume); Start.1.cs:2298 SetVolume(options.MusicVolume)). */
export function applyMusicSettings(volume: number, muted: boolean): void {
    userVolume = Math.min(1, Math.max(0, volume));
    userMuted = muted;
    for (const p of [music0, music1]) {
        if (p === null) continue;
        p.setUserVolume(userVolume);
        if (muted) p.mute();
        else p.unmute();
    }
}

/** MusicAdapter for the Options rows (setVolume / mute / unmute) over both players. */
export interface MusicControls {
    setVolume(v: number): void;
    mute(): void;
    unmute(): void;
}

const controls: MusicControls = {
    setVolume: (v) => applyMusicSettings(v, userMuted),
    mute: () => applyMusicSettings(userVolume, true),
    unmute: () => applyMusicSettings(userVolume, false),
};

/** Main menu shown (Start.1.cs:1211 main_0.MusicPlayer.StartTheme()). Returns the Options controls. */
export function startMusic(): MusicControls {
    const { music, stings } = ensurePlayers();
    stings.stop();
    music.startTheme();
    return controls;
}

/** The Options controls without touching playback. */
export function musicControls(): MusicControls {
    return controls;
}

/** Game view opened (Main.Part12.cs:2918 musicPlayer_0.ForceSwitch()). */
export function musicGameStarted(): void {
    musicPlayer().forceSwitch();
}

/** Game over (Main.Part12.cs:3428 DoGameEnd → musicPlayer_0.StartTheme()). */
export function musicGameEnded(): void {
    musicPlayer().startTheme();
}

/** Exit (Main.Part7.cs:4568 / Start.cs:2429: musicPlayer_0.Stop(); musicPlayer_1.Stop()). */
export function stopAllMusic(): void {
    music0?.stop();
    music1?.stop();
}

/** Event stings (Main.Part4.cs:273-461 method_515..method_521 / ArhCaEfBkk): FadePause the music, play the sting
 * on musicPlayer_1 at the music volume. */
export function playEventSting(file: string, volume?: number): void {
    const { music, stings } = ensurePlayers();
    music.fadePause();
    // musicPlayer_1.SetVolume(_Game.MusicVolume), or SetVolume(SoundVolume.Maximum) (Main.Part7.cs:517).
    stings.setUserVolume(volume ?? userVolume);
    if (userMuted) stings.mute();
    else stings.unmute();
    stings.playFile(EFFECTS_URL_PREFIX + file);
}

/** Main.Part4.cs:465 method_522 (an event / diplomacy window closed): stop the sting and fade the music back in, or
 * start a new track when nothing is playing. */
export function eventStingClosed(): void {
    const { music, stings } = ensurePlayers();
    if (stings.isPlaying) {
        stings.fadeStop();
        music.fadeResume();
    } else if (!music.isPlaying) {
        music.forceSwitch();
    }
}

/** Test hook: forget the app players. */
export function resetMusicForTests(): void {
    music0?.dispose();
    music1?.dispose();
    music0 = null;
    music1 = null;
    userVolume = 0.5;
    userMuted = false;
    settingsRead = false;
}
