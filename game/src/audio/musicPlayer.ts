// Port of DistantWorlds.MusicPlayer (MusicPlayer.cs) + MusicMood
// (DistantWorlds.Types.MusicMood), on the Web Audio API / HTMLAudioElement.
//
// The C# class drives XNA's MediaPlayer through a set of delegates; here the
// "backends" are two HTMLAudioElements (current / next) so a fade-out can
// cross-fade into the next track. Mood → track selection rules, the 50 ms
// fade timer with its sqrt curve (double_1 = 0.02, min step 0.005) and the
// * 0.6 volume scaling are ported faithfully.
//
// Browsers block autoplay until a user gesture: startMusic() defers actual
// playback to the first pointerdown/keydown.

/** Port of DistantWorlds.Types.MusicMood. */
export enum MusicMood {
    Undefined,
    Quiet,
    Moderate,
    Intense,
    Theme,
}

/** Port of the MusicFadeFinishAction switch in timer_0_Elapsed. */
enum MusicFadeFinishAction {
    StartNewMusic,
    Stop,
    Pause,
}

/** Track files in Sounds/Music/ (the folder is scanned for *.mp3 in C#). */
const MUSIC_FILES = [
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

/** Folder the tracks are served from (desktop shell maps /assets/dwu/ to the
 * DW:U install folder). */
const MUSIC_URL_PREFIX = '/assets/dwu/Sounds/Music/';

/** The theme track played by Start()/StartThemeInternal(). */
export const THEME_MUSIC_FILE = 'DistantWorldsTheme.mp3';

/** Tracks grouped by mood. The original picks randomly from every MP3 in
 * the folder (EbsZqjqvhZ); this recreation groups them by name so each mood
 * has a sensible pool. */
const MOOD_TRACKS: Record<MusicMood, string[]> = {
    [MusicMood.Undefined]: [],
    [MusicMood.Quiet]: ['Shadows.mp3', 'Suspense.mp3', 'Utopia.mp3'],
    [MusicMood.Moderate]: ['OnTrack.mp3', 'Striving.mp3', 'Outlaw.mp3', 'BoldStroke.mp3'],
    [MusicMood.Intense]: [
        'Action1.mp3',
        'Action2.mp3',
        'Desperate.mp3',
        'Forceful.mp3',
        'Frustrated.mp3',
        'Gripping.mp3',
        'Intensity.mp3',
        'Pursuit.mp3',
        'Shock.mp3',
        'Strike.mp3',
    ],
    [MusicMood.Theme]: [THEME_MUSIC_FILE],
};

/** Pure helper: pick a random track file for a mood (port of EbsZqjqvhZ's
 * "pick again while empty or same as current" loop). Returns null when the
 * mood has no tracks. */
export function pickTrackForMood(
    mood: MusicMood,
    currentFile: string | null,
    rand: () => number,
): string | null {
    const pool = MOOD_TRACKS[mood] ?? [];
    if (pool.length === 0) return null;
    let text = currentFile ?? '';
    while (text === '' || (pool.length > 1 && text === currentFile)) {
        text = pool[Math.floor(rand() * pool.length)];
    }
    return text;
}

/** One 50 ms fade-tick (port of timer_0_Elapsed' math): advance `level`
 * toward `target` by max(0.005, sqrt(level + 0.1) * 0.02) * direction and
 * clamp at the target. Returns [newLevel, reachedTarget]. */
export function fadeStep(
    level: number,
    target: number,
    direction: number,
): [number, boolean] {
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

interface FadeState {
    /** Current fade level (double_3). */
    level: number;
    /** +1 fading up, -1 fading down (double_0). */
    direction: number;
    /** Volume the fade ends at (double_2). */
    target: number;
    /** What to do when the fade completes (musicFadeFinishAction_0). */
    finish: MusicFadeFinishAction;
    /** Ticks since the last completion (int_0). */
    ticks: number;
}

class MusicPlayer {
    private readonly elA: HTMLAudioElement;
    private readonly elB: HTMLAudioElement;
    private active: HTMLAudioElement;
    private inactive: HTMLAudioElement;

    private volume = 0.5; // double_2
    private muted = false;
    private mood = MusicMood.Theme;
    private currentFile: string | null = null;

    private playing = false; // started after the first user gesture
    private paused = false;
    private stopping = false;
    private fading = false; // bool_0
    private fadeResumePending = false;
    private fade: FadeState | null = null;

    private readonly rand = Math.random;
    private readonly tickMs = 50; // Timer.Interval = 50
    private readonly timer: ReturnType<typeof setInterval>;

    constructor() {
        this.elA = new Audio();
        this.elB = new Audio();
        for (const el of [this.elA, this.elB]) {
            el.preload = 'auto';
            el.addEventListener('ended', () => this.onEnded());
        }
        this.active = this.elA;
        this.inactive = this.elB;
        this.timer = setInterval(() => this.tick(), this.tickMs);
    }

    /** True once playback has actually begun (port of IsPlaying). */
    get isPlaying(): boolean {
        return this.playing && !this.paused && !this.stopping && !this.active.paused;
    }

    /** Port of IsInitiatingFade. */
    get isFading(): boolean {
        return this.fading;
    }

    /** Port of Volume (double_2). */
    get volumeValue(): number {
        return this.volume;
    }

    /** Port of ActualVolume (MediaPlayer.Volume). */
    get actualVolume(): number {
        return this.muted ? 0 : this.volume * 0.6;
    }

    /** Register the player: playback starts on the first pointerdown/keydown
     * (browsers block autoplay before a user gesture). */
    startMusic(): void {
        if (this.playing) return;
        const begin = (): void => {
            window.removeEventListener('pointerdown', begin);
            window.removeEventListener('keydown', begin);
            this.playing = true;
            this.beginPlayback();
        };
        window.addEventListener('pointerdown', begin);
        window.addEventListener('keydown', begin);
    }

    /** Port of SetVolume(double) — clamped to [0,1], scaled by 0.6. */
    setVolume(volume: number): void {
        if (volume < 0 || volume > 1) return;
        this.volume = volume;
        this.applyVolume();
    }

    /** Port of SetVolume(SoundVolume)' mute case. */
    mute(): void {
        this.muted = true;
        this.applyVolume();
    }

    /** Port of SetVolume(SoundVolume)' non-mute cases. */
    unmute(): void {
        this.muted = false;
        this.applyVolume();
    }

    /** Switch the music to a mood: cross-fade out, then play a track picked
     * for the mood (port of ForceSwitch + the MediaEnded re-selection). */
    setMood(mood: MusicMood): void {
        this.mood = mood;
        if (!this.playing || this.stopping) return;
        this.fadeResumePending = false;
        this.startFade(this.volume, -1, MusicFadeFinishAction.StartNewMusic);
    }

    /** Port of StartThemeInternal: play the theme track. */
    playTheme(): void {
        this.mood = MusicMood.Theme;
        if (!this.playing || this.stopping) return;
        this.fadeResumePending = false;
        this.startFade(this.volume, -1, MusicFadeFinishAction.StartNewMusic);
    }

    /** Port of Pause. */
    pause(): void {
        if (!this.playing || this.stopping) return;
        this.paused = true;
        this.active.pause();
    }

    /** Port of ResumeMusic. */
    resume(): void {
        if (!this.playing || this.stopping) return;
        this.paused = false;
        this.active.play().catch(() => undefined);
    }

    /** Port of FadePause. */
    fadePause(): void {
        if (!this.playing || this.stopping) return;
        this.fadeResumePending = false;
        this.startFade(this.volume, -1, MusicFadeFinishAction.Pause);
    }

    /** Port of FadeResume. */
    fadeResume(): void {
        if (!this.playing || this.stopping) return;
        this.paused = false;
        this.fadeResumePending = true;
        this.startFade(0, 1, MusicFadeFinishAction.Pause);
    }

    /** Port of FadeStop. */
    fadeStop(): void {
        if (!this.playing) return;
        this.fadeResumePending = false;
        this.startFade(this.volume, -1, MusicFadeFinishAction.Stop);
    }

    /** Destroy audio elements and the timer (port of ~MusicPlayer). */
    dispose(): void {
        clearInterval(this.timer);
        for (const el of [this.elA, this.elB]) {
            el.pause();
            el.src = '';
        }
    }

    // ------------------------------------------------------------------

    private applyVolume(): void {
        const v = this.muted ? 0 : this.volume * 0.6;
        this.elA.volume = v;
        this.elB.volume = v;
    }

    /** Begin playback (after the user-gesture gate): play the current mood's
     * track, or the theme if none is selected yet. */
    private beginPlayback(): void {
        const file = this.pickNextFile();
        if (file === null) return;
        this.currentFile = file;
        this.loadAndPlay(this.active, file);
        this.inactive = this.elA === this.active ? this.elB : this.elA;
        this.applyVolume();
    }

    /** Port of EbsZqjqvhZ: pick a track for the current mood, never repeating
     * the one currently playing. */
    private pickNextFile(): string | null {
        return pickTrackForMood(this.mood, this.currentFile, this.rand);
    }

    private loadAndPlay(el: HTMLAudioElement, file: string): void {
        el.src = MUSIC_URL_PREFIX + file;
        el.loop = true;
        el.play().catch(() => undefined);
    }

    private startFade(target: number, direction: number, finish: MusicFadeFinishAction): void {
        this.fading = true;
        this.fade = {
            level: direction > 0 ? 0 : this.volume,
            direction,
            target,
            finish,
            ticks: 0,
        };
        if (direction > 0) {
            // Fading back up: duck the active element to silence first
            // (port of FadeResume's MediaPlayer.Volume = 0).
            this.active.volume = 0;
        }
    }

    /** Port of timer_0_Elapsed. */
    private tick(): void {
        if (!this.fading || this.fade === null) return;
        const f = this.fade;
        const [level, reached] = fadeStep(f.level, f.target, f.direction);
        if (reached) {
            f.ticks++;
            if (f.ticks > 20) {
                this.fading = false;
                const finish = f.finish;
                this.fade = null;
                this.finishFade(finish);
                return;
            }
        }
        f.level = level;
        // Port of BeginInvoke(FadeVolumeDelegate, double_3): push the fade
        // level onto the audible element(s).
        this.active.volume = this.muted ? 0 : level * 0.6;
    }

    /** Port of the switch in timer_0_Elapsed's completion branch. */
    private finishFade(finish: MusicFadeFinishAction): void {
        switch (finish) {
            case MusicFadeFinishAction.StartNewMusic: {
                const file = this.pickNextFile();
                if (file !== null) {
                    // Cross-fade in on the inactive element, then swap.
                    this.currentFile = file;
                    this.loadAndPlay(this.inactive, file);
                    this.inactive.volume = this.muted ? 0 : this.volume * 0.6;
                    this.active.pause();
                    const old = this.active;
                    this.active = this.inactive;
                    this.inactive = old;
                    this.inactive.volume = 0;
                }
                break;
            }
            case MusicFadeFinishAction.Stop: {
                this.stopping = true;
                this.active.pause();
                break;
            }
            case MusicFadeFinishAction.Pause: {
                if (finish === MusicFadeFinishAction.Pause && this.fadeResumePending) {
                    // FadeResume finished: keep playing at full volume.
                    this.active.volume = this.muted ? 0 : this.volume * 0.6;
                    this.fadeResumePending = false;
                } else {
                    this.paused = true;
                    this.active.pause();
                }
                break;
            }
        }
    }

    /** Port of mediaPlayer_0_MediaEnded: when a track ends, pick the next
     * one and keep playing. */
    private onEnded(): void {
        if (!this.playing || this.stopping || this.paused) return;
        if (this.active !== this.elA && this.active !== this.elB) return;
        const file = this.pickNextFile();
        if (file === null) return;
        this.currentFile = file;
        this.loadAndPlay(this.active, file);
    }
}

let instance: MusicPlayer | null = null;

/** Create (once) and register the global music player. Call after the main
 * menu is shown; playback itself waits for the first user gesture. */
export function startMusic(): MusicPlayer {
    if (instance === null) {
        instance = new MusicPlayer();
    }
    instance.startMusic();
    return instance;
}