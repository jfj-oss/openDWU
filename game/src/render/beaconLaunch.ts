// The Beacon's season and its launch-day call as the presentation sees them (Giantworks add-on, the 'beacon' wonder;
// render, audio and UI only — this never writes sim state). The Beacon's sim keeps, in its state bag under
// BEACON_STATE_KEY (sim/scenario/threats/giantworks/beaconState.ts; read here defensively, every field optional):
// - season: { n, phase ('prep' | 'offensive' | 'quiet'), start, end, departed, prepStart?, launchAt? } (star dates):
//   the preparation counts down from prepStart (else start) to launchAt (else end); `departed` is the day every strike
//   group left (0 before).
// - launches / lastLaunchDate: the launch record (how many times the strike groups were called out, the star date of
//   the last call). Without it a season's departure stands in.
// From them: the countdown 0..1 (the relay's gyros spin faster and its core heats as it rises, beaconRelayFx.ts), and
// the call itself, detected once per launch by every consumer (the beam, the blast, the camera, "The End Times"):
// pollBeaconLaunch keeps one clock per galaxy — the launch's serial and the wall-clock moment it was seen. A launch
// already in the state when it is first read (a loaded save, a client joining) is not replayed, unless it happened
// within the last LAUNCH_FRESH_DAYS. In multiplayer each client sees the state and plays the call locally.

import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import { peekThreatState } from '../sim/scenario/threats/framework';
import { galaxyStarDate } from '../sim/tick/simTime';
import { GAME_DAY_LENGTH } from '../sim/scenario/hooks';
import { BEACON_STATE_KEY } from './threatArt';

/** What the presentation reads of a season (beaconState.ts Season). */
export interface BeaconSeasonLookState {
    n?: number;
    phase?: string;
    start?: number;
    end?: number;
    departed?: number;
    prepStart?: number;
    launchAt?: number;
}

/** What the presentation reads of the Beacon's state bag. */
export interface BeaconLaunchState {
    phase?: string;
    season?: BeaconSeasonLookState | null;
    launches?: number;
    lastLaunchDate?: number;
    beacon?: BuiltObject | null;
    beaconDestroyed?: boolean;
}

/** After the call the spin winds down and the core cools over this many days. */
export const COOLDOWN_DAYS = 30;
/** A launch this recent when the state is first read is still played (a client joining at the moment). */
export const LAUNCH_FRESH_DAYS = 2;

function num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

/**
 * The countdown 0..1 at star date `now` (`day`: star-date units per game day): 0 in the quiet year and before the
 * first season; through the preparation it rises from 0 to 1 at the planned departure (and holds 1 past it); after the
 * call it falls back to 0 over COOLDOWN_DAYS. Pure.
 */
export function beaconCountdown(season: BeaconSeasonLookState | null | undefined, now: number, day: number = GAME_DAY_LENGTH): number {
    if (season === null || season === undefined || typeof season !== 'object') return 0;
    if (season.phase === 'prep') {
        const s0 = num(season.prepStart) ?? num(season.start);
        const s1 = num(season.launchAt) ?? num(season.end);
        if (s0 === null || s1 === null || s1 <= s0) return 0;
        return Math.max(0, Math.min(1, (now - s0) / (s1 - s0)));
    }
    if (season.phase === 'offensive') {
        const at = (num(season.departed) ?? 0) > 0 ? num(season.departed)! : num(season.start);
        if (at === null) return 0;
        return 1 - smoothstep(0, COOLDOWN_DAYS, (now - at) / Math.max(1e-9, day));
    }
    return 0;
}

/** The gyros' spin (rad/s) at countdown c: a slow turn in the quiet year, faster and faster to the eve. Pure. */
export function beaconSpinRate(c: number): number {
    const k = Math.max(0, Math.min(1, c));
    return 0.35 + 22 * Math.pow(k, 2.2);
}

/** The key of the last launch in a state (it changes once per call), or null before the first. Pure. */
export function beaconLaunchKey(st: BeaconLaunchState | null): string | null {
    if (st === null || typeof st !== 'object') return null;
    const n = num(st.launches);
    if (n !== null) return n > 0 ? `L${n}` : null;
    const s = st.season;
    if (s === null || s === undefined || typeof s !== 'object') return null;
    const d = num(s.departed) ?? 0;
    return d > 0 ? `S${num(s.n) ?? 0}:${d}` : null;
}

/** Was the last launch the first of the game? Pure. */
export function beaconLaunchIsFirst(st: BeaconLaunchState | null): boolean {
    if (st === null || typeof st !== 'object') return false;
    const n = num(st.launches);
    if (n !== null) return n === 1;
    return num(st.season?.n) === 1;
}

/** The star date of the last launch (the record's, else the season's departure), or null. Pure. */
export function beaconLaunchDate(st: BeaconLaunchState | null): number | null {
    if (st === null || typeof st !== 'object') return null;
    return num(st.lastLaunchDate) ?? ((num(st.season?.departed) ?? 0) > 0 ? num(st.season?.departed) : null);
}

/** One galaxy's launch clock (shared by every consumer; read only outside this module). */
export interface BeaconLaunchClock {
    /** The last launch key seen. */
    key: string | null;
    /** Bumped once per launch seen live; 0 before any. */
    serial: number;
    /** performance.now() (ms) when the launch was seen. */
    atMs: number;
    /** It was the first launch of the game. */
    first: boolean;
    /** The Beacon at the call. */
    beacon: BuiltObject | null;
}

const clocks = new WeakMap<Galaxy, BeaconLaunchClock>();

/** The Beacon's state bag (null without the Beacon). */
export function beaconLaunchState(galaxy: Galaxy): BeaconLaunchState | null {
    if (galaxy.scenario === null || galaxy.scenario === undefined) return null;
    const st = peekThreatState<BeaconLaunchState>(galaxy, BEACON_STATE_KEY);
    return st !== null && typeof st === 'object' ? st : null;
}

/**
 * The step of pollBeaconLaunch on a clock (pure but for the clock it updates): a new key fires (serial + 1) unless it
 * is the first read and the launch is older than LAUNCH_FRESH_DAYS.
 */
export function stepLaunchClock(clock: BeaconLaunchClock | null, st: BeaconLaunchState | null, starDate: number, nowMs: number, day: number = GAME_DAY_LENGTH): BeaconLaunchClock {
    const key = beaconLaunchKey(st);
    const c = clock ?? { key: null, serial: 0, atMs: -Infinity, first: false, beacon: null };
    if (key === c.key) return c;
    const firstRead = clock === null;
    c.key = key;
    if (key === null) return c;
    const at = beaconLaunchDate(st);
    const fresh = at === null || starDate - at <= LAUNCH_FRESH_DAYS * day;
    if (firstRead && !fresh) return c;
    c.serial++;
    c.atMs = nowMs;
    c.first = beaconLaunchIsFirst(st);
    const b = st?.beacon;
    c.beacon = b !== undefined && b !== null && !b.hasBeenDestroyed ? b : null;
    return c;
}

/** Reads the state, fires a launch seen for the first time (once, whoever asks first), returns the galaxy's clock. */
export function pollBeaconLaunch(galaxy: Galaxy, nowMs: number): BeaconLaunchClock {
    const st = beaconLaunchState(galaxy);
    const before = clocks.get(galaxy) ?? null;
    const c = stepLaunchClock(before, st, st === null ? 0 : galaxyStarDate(galaxy), nowMs);
    if (before === null) clocks.set(galaxy, c);
    return c;
}

/** The countdown of the galaxy's Beacon now (0 without one). */
export function beaconCountdownNow(galaxy: Galaxy): number {
    const st = beaconLaunchState(galaxy);
    if (st === null || st.phase !== 'reclamation') return 0;
    return beaconCountdown(st.season ?? null, galaxyStarDate(galaxy));
}
