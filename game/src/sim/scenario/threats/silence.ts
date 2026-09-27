// 19f-3 The Silence (tasks/19f-hidden-threats.md §3). Not a port: new scenario behaviour composed of ported functions.
// Registered from scenario/packages.ts; every handler is gated by the `silence` flag, so flag off draws nothing.
//
// Arc: a precursor ruin starts transmitting. A RestrictedArea / HyperjumpDisabled zone (generateRestrictedZone,
// story/storyStart.ts 304 — the stock effect the stock detectHyperDeny, movement.ts 734, already honours) grows around
// it every period (framework.ts resizeRestrictedZone, the general re-index-and-resize this threat's growth needed);
// pirates are exempt (the `hyperDenyExempt` query this threat adds to hooks.ts / movement.ts). No faction: the
// "declaration" is the zone appearing (loud — level 3 to everyone at once). Counterplay: a qualifying ship (troop
// transport or Explore mission) holds position at the source long enough to shut it down.
//
// Rnd (§0.4): draws only in the flag-gated yearly start handler (picking the ruin) and the stock function it calls
// (generateRestrictedZone's zone-name draws). Growth and the shutdown check are deterministic (no Rnd). Fixed
// iteration: getBuiltObjectsAtLocation's own order (stationPlacement.ts).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { GalaxyLocation } from '../../galaxyLocation';
import { generateRestrictedZone } from '../../story/storyStart';
import { getBuiltObjectsAtLocation } from '../../stationPlacement';
import { BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { GameEndOutcome } from '../../victory';
import { gameYear, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { startStarDateForAge } from '../../galaxyTime';
import {
    arcNews,
    normalEmpires,
    pastThreatMinYear,
    peekThreatState,
    registerThreatExistence,
    registerThreatKnownSites,
    resizeRestrictedZone,
    threatExists,
    threatGameEnd,
    threatState,
    type KnownThreatSite,
    type SentStages,
} from './framework';

export const SILENCE_KEY = 'silence';
export const SILENCE_FLAG = 'silence';
const TAG = 'Silence';
/** Game-end codes (19f §0.8: 1911 Grey Tide … 1920 Corporate Coup; +100 = victory/containment). No faction, so no defeat code. */
export const SILENCE_CODE_SHUTDOWN = 2013;
const PERIOD_DAYS = 30;
/** Shutdown radius (BuiltObject holding position at the source; §3). */
const SHUTDOWN_RANGE = 1000;

export interface SilenceState {
    source: Habitat | null;
    zone: GalaxyLocation | null;
    radius: number;
    shutdownProgressDays: number;
    lastShutdownEmpire: Empire | null;
    sentStages: SentStages;
    ended: boolean;
}

function newState(): SilenceState {
    return { source: null, zone: null, radius: 0, shutdownProgressDays: 0, lastShutdownEmpire: null, sentStages: {}, ended: false };
}

export function silenceState(galaxy: Galaxy): SilenceState {
    return threatState(galaxy, SILENCE_KEY, newState);
}

export function peekSilenceState(galaxy: Galaxy): SilenceState | null {
    return peekThreatState<SilenceState>(galaxy, SILENCE_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}

const P = {
    startYear: (g: Galaxy) => p(g, 'silenceStartYear', 50),
    startRadius: (g: Galaxy) => p(g, 'silenceStartRadius', 5000),
    growthPerYear: (g: Galaxy) => p(g, 'silenceGrowthPerYear', 4000),
    maxRadius: (g: Galaxy) => p(g, 'silenceMaxRadius', 120000),
    shutdownDays: (g: Galaxy) => p(g, 'silenceShutdownDays', 60),
};

// ---------------------------------------------------------------------------------------------------------------
// Start (yearly)
// ---------------------------------------------------------------------------------------------------------------

/** Ruin habitats a Silence source may start at (any habitat with a ruin; one Silence per game). */
export function silenceCandidates(galaxy: Galaxy): Habitat[] {
    return galaxy.ruinsHabitats.filter((h) => !h.hasBeenDestroyed);
}

export function silenceYearly(galaxy: Galaxy, year: number): void {
    if (!threatExists(galaxy, SILENCE_KEY)) return; // §0 rarity: not this game — no state, no draws.
    const st = silenceState(galaxy);
    if (st.ended || st.source !== null) return;
    const startYear = gameYear(startStarDateForAge(galaxy.age));
    if (year < startYear + P.startYear(galaxy) || !pastThreatMinYear(galaxy, SILENCE_KEY, year)) return; // §0 timing: also waits for the shared/overridden floor.
    const candidates = silenceCandidates(galaxy);
    if (candidates.length === 0) return;
    const source = candidates[galaxy.rnd.next(0, candidates.length)];
    startSilence(galaxy, st, source);
}

/** Also used by tests to force the start. */
export function startSilence(galaxy: Galaxy, st: SilenceState, source: Habitat): void {
    st.source = source;
    st.radius = P.startRadius(galaxy);
    st.zone = generateRestrictedZone(galaxy, scenarioText(`${TAG} Zone Name`), scenarioText(`${TAG} Zone Message`), st.radius * 2, source.xpos, source.ypos, 0);
    // Loud from the start: every normal empire (and pirate faction) hears it at once.
    // Loud from the start (§3): level 3 to everyone — no per-empire knowledge bookkeeping; silenceKnownSites reports it directly.
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Start', args: [source.name], subject: source });
}

// ---------------------------------------------------------------------------------------------------------------
// Growth (periodic)
// ---------------------------------------------------------------------------------------------------------------

export function silenceGrow(galaxy: Galaxy, st: SilenceState): void {
    if (st.zone === null || st.source === null) return;
    const grow = (P.growthPerYear(galaxy) * PERIOD_DAYS) / 365;
    const max = P.maxRadius(galaxy);
    if (st.radius >= max) return;
    st.radius = Math.min(max, st.radius + grow);
    resizeRestrictedZone(galaxy, st.zone, st.source.xpos, st.source.ypos, st.radius);
}

// ---------------------------------------------------------------------------------------------------------------
// Shutdown check (periodic)
// ---------------------------------------------------------------------------------------------------------------

function qualifies(bo: BuiltObject): boolean {
    if (bo.hasBeenDestroyed || bo.actualEmpire === null) return false;
    if (bo.troopCapacity > 0) return true;
    const m = builtObjectMission(bo.mission);
    return m !== null && m.type === BuiltObjectMissionType.Explore;
}

export function silenceShutdownCheck(galaxy: Galaxy, st: SilenceState): void {
    if (st.source === null || st.zone === null) return;
    const near = getBuiltObjectsAtLocation(galaxy, st.source.xpos, st.source.ypos, SHUTDOWN_RANGE);
    const ship = near.find(qualifies) ?? null;
    if (ship === null) {
        st.shutdownProgressDays = 0;
        return;
    }
    st.lastShutdownEmpire = ship.actualEmpire;
    st.shutdownProgressDays += PERIOD_DAYS;
    if (st.shutdownProgressDays < P.shutdownDays(galaxy)) return;
    shutdownSilence(galaxy, st);
}

/** Also used by tests / the player action to force the shutdown. */
export function shutdownSilence(galaxy: Galaxy, st: SilenceState): void {
    if (st.zone === null || st.ended) return;
    galaxy.removeGalaxyLocationIndex(st.zone);
    const i = galaxy.galaxyLocations.indexOf(st.zone);
    if (i >= 0) galaxy.galaxyLocations.splice(i, 1);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Shutdown', args: [st.source?.name ?? ''] });
    st.ended = true;
    const victor = st.lastShutdownEmpire ?? galaxy.playerEmpire;
    if (victor !== null) threatGameEnd(galaxy, victor, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), SILENCE_CODE_SHUTDOWN);
}

// ---------------------------------------------------------------------------------------------------------------
// hyperDenyExempt query: pirates are immune to the zone's hyperdrive-disable effect.
// ---------------------------------------------------------------------------------------------------------------

export function silenceHyperDenyExempt(galaxy: Galaxy, value: boolean, args: { builtObject: BuiltObject; location: GalaxyLocation }): boolean {
    const st = peekSilenceState(galaxy);
    if (st === null || st.zone === null || args.location !== st.zone) return value;
    const e = args.builtObject.actualEmpire;
    return e !== null && e.pirateEmpireBaseHabitat !== null ? true : value;
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic
// ---------------------------------------------------------------------------------------------------------------

export function silencePeriodic(galaxy: Galaxy, now: number): void {
    if (!threatExists(galaxy, SILENCE_KEY)) return; // §0 rarity: not this game — no state, no draws.
    void now;
    const st = silenceState(galaxy);
    if (st.ended || st.source === null) return;
    silenceGrow(galaxy, st);
    silenceShutdownCheck(galaxy, st);
}

// ---------------------------------------------------------------------------------------------------------------
// AI: empires with a colony inside the zone send one exploration ship toward the source (best-effort; a hint only —
// the stock war/exploration AI already reassigns idle explorers, so this just nudges one per empire per period).
// ---------------------------------------------------------------------------------------------------------------

export function silenceAiHint(galaxy: Galaxy): Empire[] {
    const st = peekSilenceState(galaxy);
    if (st === null || st.source === null || st.zone === null) return [];
    const inside: Empire[] = [];
    for (const e of normalEmpires(galaxy)) {
        if (e.colonies.some((h) => galaxy.calculateDistance(h.xpos, h.ypos, st.source!.xpos, st.source!.ypos) <= st.radius)) inside.push(e);
    }
    return inside;
}

// ---------------------------------------------------------------------------------------------------------------
// UI selector
// ---------------------------------------------------------------------------------------------------------------

export function silenceKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    void empire;
    const st = peekSilenceState(galaxy);
    if (st === null || st.source === null || st.ended) return [];
    // Loud from the start (§3): level 3 to everyone.
    return [{ threat: SILENCE_KEY, kind: 'colony', target: st.source, level: 3, label: scenarioText(`${TAG} Source Row`) }];
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const SILENCE_HANDLER_IDS = ['silence.yearly', 'silence.periodic'] as const;
export const SILENCE_QUERY_IDS = ['silence.exempt'] as const;

export function registerSilence(): void {
    registerThreatExistence(SILENCE_KEY, SILENCE_FLAG);
    registerScenarioYearly({ id: 'silence.yearly', flag: SILENCE_FLAG, order: 10, run: silenceYearly });
    registerScenarioPeriodic({ id: 'silence.periodic', flag: SILENCE_FLAG, order: 10, periodDays: PERIOD_DAYS, run: silencePeriodic });
    registerScenarioQuery({ id: 'silence.exempt', flag: SILENCE_FLAG, query: 'hyperDenyExempt', run: silenceHyperDenyExempt });
    registerThreatKnownSites(SILENCE_KEY, silenceKnownSites);
}

registerSilence();
