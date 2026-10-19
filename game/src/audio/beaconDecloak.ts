// The Watchers' sounds (Giantworks add-on, the Beacon; presentation only), both the user's own recordings
// (public/audio/beacon/):
// - THE DECLOAK (watcher-decloak.mp3, 30.7 s, its own fade-out): played whole, untrimmed, from the moment a Watcher
//   starts to decloak (render/beaconCloakFx.ts decloaksSince), at a level by its distance from the camera and the
//   player's worlds (pulseLevel: full near either, fading, silent beyond PULSE_FAR sectors of every player world),
//   panned by its place on screen, times the Effects volume. Never two at once: a decloak while one plays (or within
//   DECLOAK_REST_S of its end) is not heard.
// - THE POPUP (watcher-popup-impend.mp3, 37.2 s): while a Watcher message's card or conversation is open (the
//   first-encounter auto-popups and the repeats opened from the ticker or a badge): it starts on the open, loops
//   seamlessly past its end (from its start to its seventh beat, POPUP_LOOP_END_S, so the 5.45 s pulse keeps time),
//   and stops with a POPUP_FADE_S fade on the close. One instance: a second Watcher card does not restart it. While
//   the decloak sound plays it ducks to POPUP_DUCK of its level (a smooth ramp) and comes back up when that ends; the
//   decloak stays at full level.
// Files fetched on first need; no AudioContext before a sound is due. Never touches sim state.

import type { Galaxy } from '../sim/galaxy';
import type { EmpireMessage } from '../sim/messages';
import type { BuiltObject } from '../sim/builtObject';
import { decloaksSince, pulseLevel, type DecloakEvent } from '../render/beaconCloakFx';
import { lastThreatLooks } from '../render/threatArt';
import { tryGetText } from '../sim/textResolver';
import { localViewerEmpire } from '../localViewer';

export const DECLOAK_URL = '/audio/beacon/watcher-decloak.mp3';
export const POPUP_URL = '/audio/beacon/watcher-popup-impend.mp3';
/** Peak gain of the decloak (full strength, Effects volume 1). */
export const DECLOAK_MAX_GAIN = 0.95;
/** After a decloak sound ends, none for this long (s). */
export const DECLOAK_REST_S = 4;
/** The popup sound's level (Effects volume 1), its ducked share, the duck / unduck ramp (s), the close fade (s). */
export const POPUP_GAIN = 0.8;
export const POPUP_DUCK = 0.4;
export const POPUP_DUCK_S = 0.6;
export const POPUP_FADE_S = 0.5;
/** The popup loop: from its start to its seventh beat (the clip pulses every 5.45 s; its last 4 s fade out). */
export const POPUP_LOOP_END_S = 32.72;
/** What the sounds did (captures read it to check playback headless). */
export const watcherSoundLog = { decloakStarts: 0, decloakGain: 0, popupStarts: 0, popupStops: 0, popupDucks: 0, popupGain: 0, context: '' };

/** A decloak whose start is older than this when the sound is ready is not played (s). */
const LATE_S = 3;

/** The camera as these need it. */
export interface DecloakView {
    x: number;
    y: number;
    zoom: number;
    width: number;
}

/** The Watcher message titles (the Beacon's GameText "Beacon Msg <kind> Title"), resolved once the texts are loaded. */
const WATCHER_KINDS = ['Detect', 'Decloak', 'Cloak', 'Corrupt', 'Attack', 'Killed'];
let watcherTitles: Set<string> | null = null;

/** Whether a message is one of the Watcher messages (a scenario message whose title is a Watcher kind's, or whose
 * subject is a Watcher). */
export function isWatcherMessage(m: EmpireMessage | null): boolean {
    if (m === null || m.scenarioPopup === undefined) return false;
    if (watcherTitles === null || watcherTitles.size === 0) {
        const t = new Set<string>();
        for (const k of WATCHER_KINDS) {
            const s = tryGetText(`Beacon Msg ${k} Title`);
            if (s !== null && s !== undefined) t.add(s);
        }
        watcherTitles = t;
    }
    if (watcherTitles.has(m.title)) return true;
    const w = lastThreatLooks().watchers;
    return w !== undefined && w.length > 0 && w.includes(m.subject as BuiltObject);
}

/** The decloak's rest rule: may a decloak sound start at nowS (s)? Pure. */
export function decloakAllowed(nowS: number, playingUntil: number): boolean {
    return nowS >= playingUntil + DECLOAK_REST_S;
}

export class BeaconWatcherSounds {
    private decloakBuf: AudioBuffer | null = null;
    private popupBuf: AudioBuffer | null = null;
    private loading = new Set<string>();
    private serial = -1;
    private events: DecloakEvent[] = [];
    private pending: { x: number; y: number; at: number }[] = [];
    /** The decloak sound plays until this (performance clock, s); -Infinity: none yet. */
    private decloakUntil = -Infinity;
    private popup: { src: AudioBufferSourceNode; gain: GainNode; ducked: boolean } | null = null;

    constructor(private readonly context: () => AudioContext) {}

    /** Whether the decloak sound is playing (s, the performance clock). */
    decloakPlaying(nowS: number): boolean {
        return nowS < this.decloakUntil;
    }

    /** Whether the popup sound is playing (not fading out). */
    popupPlaying(): boolean {
        return this.popup !== null;
    }

    /** Once per frame. `fx`: the Effects volume 0..1 (0 when muted); `openMessage`: the message whose card or
     * conversation is open; `nowS`: the performance clock (s). */
    update(galaxy: Galaxy, view: DecloakView, fx: number, openMessage: EmpireMessage | null, nowS: number): void {
        // the decloaks seen since the last frame (the first frame only marks where the list stands)
        const s = decloaksSince(Math.max(0, this.serial), this.events);
        if (this.serial >= 0) {
            const homes = localViewerEmpire(galaxy)?.colonies ?? [];
            for (const e of this.events) {
                const level = pulseLevel(e.x, e.y, view.x, view.y, homes, galaxy.sectorSize);
                if (level > 0.02 && fx > 0) this.pending.push({ x: e.x, y: e.y, at: nowS });
            }
        }
        this.serial = s;
        try {
            if (this.pending.length > 0) this.playDecloak(galaxy, view, fx, nowS);
            this.updatePopup(isWatcherMessage(openMessage), fx, nowS);
        } catch {
            this.pending.length = 0; // no Web Audio
        }
    }

    private playDecloak(galaxy: Galaxy, view: DecloakView, fx: number, nowS: number): void {
        if (this.decloakBuf === null) {
            this.load(DECLOAK_URL, (b) => (this.decloakBuf = b));
            this.pending = this.pending.filter((p) => nowS - p.at < LATE_S);
            return;
        }
        const homes = localViewerEmpire(galaxy)?.colonies ?? [];
        for (const p of this.pending) {
            if (nowS - p.at >= LATE_S || !decloakAllowed(nowS, this.decloakUntil)) continue;
            const level = pulseLevel(p.x, p.y, view.x, view.y, homes, galaxy.sectorSize);
            const gain = DECLOAK_MAX_GAIN * level * Math.max(0, Math.min(1, fx));
            if (gain <= 0.005) continue;
            const ctx = this.context();
            if (ctx.state === 'suspended') void ctx.resume();
            const src = ctx.createBufferSource();
            src.buffer = this.decloakBuf;
            const panner = ctx.createStereoPanner();
            const sx = ((p.x - view.x) * view.zoom) / Math.max(1, view.width / 2);
            panner.pan.value = Number.isFinite(sx) ? Math.max(-0.8, Math.min(0.8, sx * 0.6)) : 0;
            const g = ctx.createGain();
            g.gain.value = gain;
            src.connect(panner).connect(g).connect(ctx.destination);
            src.onended = () => src.disconnect();
            src.start();
            this.decloakUntil = nowS + this.decloakBuf.duration;
            watcherSoundLog.decloakStarts++;
            watcherSoundLog.decloakGain = gain;
            watcherSoundLog.context = ctx.state;
        }
        this.pending.length = 0;
    }

    private updatePopup(open: boolean, fx: number, nowS: number): void {
        const level = POPUP_GAIN * Math.max(0, Math.min(1, fx));
        if (open && this.popup === null) {
            if (this.popupBuf === null) {
                this.load(POPUP_URL, (b) => (this.popupBuf = b));
                return;
            }
            if (level <= 0.005) return;
            const ctx = this.context();
            if (ctx.state === 'suspended') void ctx.resume();
            const src = ctx.createBufferSource();
            src.buffer = this.popupBuf;
            src.loop = true;
            src.loopStart = 0;
            src.loopEnd = Math.min(this.popupBuf.duration, POPUP_LOOP_END_S);
            const g = ctx.createGain();
            const ducked = this.decloakPlaying(nowS);
            g.gain.value = level * (ducked ? POPUP_DUCK : 1);
            src.connect(g).connect(ctx.destination);
            src.onended = () => {
                src.disconnect();
                g.disconnect();
            };
            src.start();
            this.popup = { src, gain: g, ducked };
            watcherSoundLog.popupStarts++;
            watcherSoundLog.popupGain = g.gain.value;
            watcherSoundLog.context = ctx.state;
            return;
        }
        if (!open) {
            if (this.popup !== null) {
                const ctx = this.context();
                const { src, gain } = this.popup;
                const t = ctx.currentTime;
                gain.gain.cancelScheduledValues(t);
                gain.gain.setValueAtTime(gain.gain.value, t);
                gain.gain.linearRampToValueAtTime(0, t + POPUP_FADE_S);
                src.stop(t + POPUP_FADE_S + 0.05);
                this.popup = null;
                watcherSoundLog.popupStops++;
            }
            return;
        }
        // open and playing: duck under the decloak, follow the Effects volume
        const p = this.popup;
        if (p === null) return;
        const duck = this.decloakPlaying(nowS);
        const want = level * (duck ? POPUP_DUCK : 1);
        if (duck !== p.ducked || Math.abs(p.gain.gain.value - want) > 0.02) {
            const ctx = this.context();
            const t = ctx.currentTime;
            p.gain.gain.cancelScheduledValues(t);
            p.gain.gain.setValueAtTime(p.gain.gain.value, t);
            p.gain.gain.linearRampToValueAtTime(want, t + (duck !== p.ducked ? POPUP_DUCK_S : 0.1));
            if (duck && !p.ducked) watcherSoundLog.popupDucks++;
            p.ducked = duck;
            watcherSoundLog.popupGain = want;
        }
    }

    private load(url: string, done: (b: AudioBuffer) => void): void {
        if (this.loading.has(url)) return;
        this.loading.add(url);
        void (async () => {
            try {
                const r = await fetch(url);
                if (!r.ok) return;
                const data = await r.arrayBuffer();
                done(await this.context().decodeAudioData(data));
            } catch {
                // missing or undecodable: silent
            }
        })();
    }

    dispose(): void {
        this.pending.length = 0;
        try {
            this.popup?.src.stop();
        } catch {
            // already stopped
        }
        this.popup = null;
        this.decloakBuf = null;
        this.popupBuf = null;
    }
}
