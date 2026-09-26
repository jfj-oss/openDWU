// 19f-1 Grey Tide (tasks/19f-hidden-threats.md §1). Not a port: new scenario behaviour composed of ported functions.
// Registered from scenario/packages.ts; every handler is gated by the `greyTide` flag, so flag off draws nothing.
//
// Arc: a dormant swarm seeds in an unexplored gas giant. Each nest builds drones for free (as 19b Dark Farms' farms
// build robot troops) and, once it has one, spends it either to eat a nearby resource extractor (BuiltObjectRole
// Resource — a mining ship or station: the drone attack is abstracted to its outcome, teardown) or, once past
// nestYears, to found a new nest at the nearest gas giant no normal empire has explored. The Tide is a pirate-kind
// faction from the start (createThreatFaction kind 'pirate'), invisible until a system is explored — an explored
// nest is an ordinary base (the discovery rule). It never attacks colonies, so there is no defeat condition, only
// containment: destroying every nest ends it.
//
// TODO(19f scope): the spec's Tide race + mining-ship/gas-mining-station design templates (§1 Data) are not built;
// this uses the stock Mechanoid race as a stand-in so the faction still has a race/design set for its stock AI, and
// keeps drones as a hidden counter (not literal BuiltObject ships/missions) to stay in this task's budget.
//
// Rnd (§0.4): draws only in the flag-gated yearly seed handler and the periodic handler (nearest-target picks are
// deterministic, not drawn). Fixed iteration orders: nests by id, galaxy.empires order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { HabitatType } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { SystemVisibilityStatus } from '../../visibility';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { GameEndOutcome } from '../../victory';
import { gameYear, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { startStarDateForAge, YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import {
    KNOWLEDGE_CONFIRMED,
    arcNews,
    createThreatFaction,
    knowledgeLevel,
    normalEmpires,
    peekThreatState,
    registerThreatAction,
    registerThreatKnownSites,
    revealTo,
    teardownIfDead,
    threatGameEnd,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';

export const GREY_TIDE_KEY = 'greyTide';
export const GREY_TIDE_FLAG = 'greyTide';
const TAG = 'GreyTide';
/** Game-end codes (19f §0.8: 1911 Grey Tide … 1920 Corporate Coup; +100 = victory/containment). Never attacks colonies: no defeat code. */
export const GREY_TIDE_CODE_CONTAINED = 2011;
const PERIOD_DAYS = 30;

export interface Nest {
    id: number;
    habitat: Habitat;
    bornDate: number;
    nextSpawnDate: number;
    drones: number;
    droneProgress: number;
    eaten: number;
    state: 'alive' | 'dead';
    knowledge: ThreatKnowledge[];
}

export interface GreyTideState {
    nextId: number;
    faction: Empire | null;
    nests: Nest[];
    declared: boolean;
    sentStages: SentStages;
    ended: boolean;
}

function newState(): GreyTideState {
    return { nextId: 1, faction: null, nests: [], declared: false, sentStages: {}, ended: false };
}

export function greyTideState(galaxy: Galaxy): GreyTideState {
    return threatState(galaxy, GREY_TIDE_KEY, newState);
}

export function peekGreyTideState(galaxy: Galaxy): GreyTideState | null {
    return peekThreatState<GreyTideState>(galaxy, GREY_TIDE_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}

const P = {
    seedYear: (g: Galaxy) => p(g, 'greyTideSeedYear', 60),
    dronesPerNestYear: (g: Galaxy) => p(g, 'greyTideDronesPerNestYear', 3),
    nestYears: (g: Galaxy) => p(g, 'greyTideNestYears', 4),
    maxNests: (g: Galaxy) => p(g, 'greyTideMaxNests', 40),
    eatRange: (g: Galaxy) => p(g, 'greyTideEatRange', 3000),
};

function liveNests(st: GreyTideState): Nest[] {
    return st.nests.filter((n) => n.state === 'alive');
}

function isGasGiant(h: Habitat): boolean {
    return h.type === HabitatType.GasGiant || h.type === HabitatType.FrozenGasGiant;
}

/** No active normal empire has explored this habitat's system (Galaxy.9.cs's super-pirate seed analogue, visibility.ts 32). */
function unexploredByAll(galaxy: Galaxy, h: Habitat): boolean {
    for (const e of normalEmpires(galaxy)) {
        if (e.systemVisibility[h.systemIndex]?.status !== SystemVisibilityStatus.Unexplored) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Seed (yearly)
// ---------------------------------------------------------------------------------------------------------------

/** Gas/frozen-gas giants with no owner, in a system no active normal empire has explored, in habitat-index order. */
export function greyTideCandidates(galaxy: Galaxy, st: GreyTideState): Habitat[] {
    const taken = new Set(st.nests.map((n) => n.habitat));
    return galaxy.habitats.filter((h) => isGasGiant(h) && h.empire === null && !taken.has(h) && unexploredByAll(galaxy, h));
}

export function greyTideYearly(galaxy: Galaxy, year: number): void {
    const st = greyTideState(galaxy);
    if (st.ended || st.nests.length > 0) return;
    const startYear = gameYear(startStarDateForAge(galaxy.age));
    if (year < startYear + P.seedYear(galaxy)) return;
    const candidates = greyTideCandidates(galaxy, st);
    if (candidates.length === 0) return;
    const habitat = candidates[galaxy.rnd.next(0, candidates.length)];
    foundNest(galaxy, st, habitat);
}

/** Also used by tests to force the seed. */
export function foundNest(galaxy: Galaxy, st: GreyTideState, habitat: Habitat): Nest {
    const bornDate = galaxyStarDate(galaxy);
    const nest: Nest = { id: st.nextId++, habitat, bornDate, nextSpawnDate: bornDate + P.nestYears(galaxy) * YEAR_LENGTH, drones: 0, droneProgress: 0, eaten: 0, state: 'alive', knowledge: [] };
    st.nests.push(nest);
    ensureFaction(galaxy, st, habitat);
    return nest;
}

/** The pirate-kind Tide faction (created once, at the first nest). */
function ensureFaction(galaxy: Galaxy, st: GreyTideState, home: Habitat): Empire | null {
    if (st.faction !== null && st.faction.active) return st.faction;
    // TODO(19f scope): stand-in race — see the file header note.
    const faction = createThreatFaction(galaxy, { kind: 'pirate', race: 'Mechanoid', name: scenarioText(`${TAG} Faction Name`), home });
    st.faction = faction;
    return faction;
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic: drone production, spread (new nests), eating
// ---------------------------------------------------------------------------------------------------------------

export function greyTidePeriodic(galaxy: Galaxy, now: number): void {
    const st = greyTideState(galaxy);
    if (st.ended) return;
    for (const nest of [...liveNests(st)].sort((a, b) => a.id - b.id)) {
        produceDrones(galaxy, st, nest);
        maybeFoundNest(galaxy, st, nest, now);
        eatNearbyTarget(galaxy, st, nest);
        checkDiscovery(galaxy, st, nest);
    }
    greyTideEndCheck(galaxy, st);
}

function produceDrones(galaxy: Galaxy, st: GreyTideState, nest: Nest): void {
    void st;
    nest.droneProgress += (P.dronesPerNestYear(galaxy) * PERIOD_DAYS) / 365;
    while (nest.droneProgress >= 1) {
        nest.droneProgress -= 1;
        nest.drones++;
    }
}

/** §1 spread: a nest past nestYears with a drone to spend founds the nearest new nest (capped by maxNests). */
function maybeFoundNest(galaxy: Galaxy, st: GreyTideState, nest: Nest, now: number): void {
    if (now < nest.nextSpawnDate || nest.drones <= 0 || liveNests(st).length >= P.maxNests(galaxy)) return;
    const candidates = greyTideCandidates(galaxy, st);
    if (candidates.length === 0) return;
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const c of candidates) {
        const d = galaxy.calculateDistance(nest.habitat.xpos, nest.habitat.ypos, c.xpos, c.ypos);
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    nest.nextSpawnDate += P.nestYears(galaxy) * YEAR_LENGTH;
    if (best === null) return;
    nest.drones--;
    foundNest(galaxy, st, best);
}

/** §1 eating: a drone spent on the nearest resource extractor (mining ship/station) within range destroys it. */
function eatNearbyTarget(galaxy: Galaxy, st: GreyTideState, nest: Nest): void {
    if (nest.drones <= 0) return;
    const range = P.eatRange(galaxy);
    let best: BuiltObject | null = null;
    let bestD = Number.MAX_VALUE;
    for (const e of galaxy.empires) {
        if (e === null || !e.active || e === st.faction) continue;
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Resource) continue;
            const d = galaxy.calculateDistance(nest.habitat.xpos, nest.habitat.ypos, b.xpos, b.ypos);
            if (d <= range && d < bestD) {
                bestD = d;
                best = b;
            }
        }
    }
    if (best === null) return;
    nest.drones--;
    nest.eaten++;
    builtObjectCompleteTeardown(galaxy, best);
    if (!st.declared) {
        st.declared = true;
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Declared' });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery: an explored system's nest is an ordinary base.
// ---------------------------------------------------------------------------------------------------------------

function checkDiscovery(galaxy: Galaxy, st: GreyTideState, nest: Nest): void {
    void st;
    for (const e of normalEmpires(galaxy)) {
        if (knowledgeLevel(nest, e) >= KNOWLEDGE_CONFIRMED) continue;
        const status = e.systemVisibility[nest.habitat.systemIndex]?.status;
        if (status === SystemVisibilityStatus.Explored || status === SystemVisibilityStatus.Visible) revealTo(galaxy, nest, e, KNOWLEDGE_CONFIRMED);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Counterplay: destroying a known nest (kills its undeployed drones).
// ---------------------------------------------------------------------------------------------------------------

function knownNest(galaxy: Galaxy, empire: Empire, target: unknown): Nest | null {
    const st = peekGreyTideState(galaxy);
    if (st === null || target === null || typeof target !== 'object') return null;
    const nest = st.nests.find((n) => n.state === 'alive' && n.habitat === target) ?? null;
    if (nest === null) return null;
    return knowledgeLevel(nest, empire) >= KNOWLEDGE_CONFIRMED ? nest : null;
}

/** Also used directly by tests. */
export function destroyNest(nest: Nest): void {
    nest.state = 'dead';
    nest.drones = 0;
}

// ---------------------------------------------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------------------------------------------

export function greyTideEndCheck(galaxy: Galaxy, st: GreyTideState): void {
    if (st.ended || st.nests.length === 0) return;
    if (liveNests(st).length > 0) return;
    // Containment is about the nests (the hidden threat), not the Tide's pirate-empire shell: a stock pirate empire
    // may still hold raider ships it generated on its own (TODO(19f scope): see the file header — no literal drones).
    teardownIfDead(galaxy, st.faction);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained' });
    st.ended = true;
    const player = galaxy.playerEmpire;
    if (player !== null) threatGameEnd(galaxy, player, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), GREY_TIDE_CODE_CONTAINED);
}

// ---------------------------------------------------------------------------------------------------------------
// UI selector
// ---------------------------------------------------------------------------------------------------------------

export function greyTideKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekGreyTideState(galaxy);
    if (st === null) return [];
    const out: KnownThreatSite[] = [];
    for (const n of st.nests) {
        if (n.state === 'dead') continue;
        const level = knowledgeLevel(n, empire);
        if (level <= 0) continue;
        out.push({ threat: GREY_TIDE_KEY, kind: 'colony', target: n.habitat, level, label: scenarioText(`${TAG} Nest Row`) });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const GREY_TIDE_HANDLER_IDS = ['greyTide.yearly', 'greyTide.periodic'] as const;

export function registerGreyTide(): void {
    registerScenarioYearly({ id: 'greyTide.yearly', flag: GREY_TIDE_FLAG, order: 10, run: greyTideYearly });
    registerScenarioPeriodic({ id: 'greyTide.periodic', flag: GREY_TIDE_FLAG, order: 10, periodDays: PERIOD_DAYS, run: greyTidePeriodic });
    registerThreatKnownSites(GREY_TIDE_KEY, greyTideKnownSites);
    registerThreatAction('greyTide.destroy', {
        label: () => scenarioText(`${TAG} Destroy Action`),
        available: (g, e, target) => knownNest(g, e, target) !== null,
        run: (g, e, target) => {
            void e;
            const nest = knownNest(g, e, target);
            if (nest === null) return false;
            destroyNest(nest);
            greyTideEndCheck(g, greyTideState(g));
            return true;
        },
    });
}

registerGreyTide();
