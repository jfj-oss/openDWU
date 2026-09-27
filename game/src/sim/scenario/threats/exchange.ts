// 19f #8 The Exchange (tasks/19f-hidden-threats.md §8, threat framework framework.ts). Not a port: new scenario
// behaviour composed of ported functions (each composed step cites its C# analogue). Registered from
// scenario/packages.ts; every handler is gated by the `threatExchange` flag, so with the flag off (or no scenario)
// nothing here runs and nothing draws.
//
// Arc: an independent trading base (a large space port, galaxy.independentEmpire-owned) is placed near the galaxy
// centre. Every year, for each pair of empires at war it slips the weaker side money (capped at 10% of that empire's
// treasury — §"Risks"), and runs a handful of real sabotage missions against war-weary empires with a false-flag
// message blaming their enemy — reusing the exact stock sabotage effects (espionage.ts completeIntelligenceMission's
// SabotageColony / SabotageConstruction / InciteRevolution branches) through a synthetic IntelligenceMission built
// with the same factory functions PerformIntelligenceMissions itself uses (the mission's own message routing plays
// no part; this module sends its own false-flag message on top). No trigger, no faction: it never declares itself.
// Counterplay is discovery (agents against a funded empire trace the money) then a stock blockade of the station, or
// destroying it.
//
// Rnd (§0.4): draws only in exchangePlace (once) and exchangeYearly (funding pair selection is deterministic by war
// order, but the sabotage target/type rolls, and completeIntelligenceMission's own draws, are Rnd). Discovery and
// blockadeCheck are deterministic (no Rnd). Fixed iteration orders: normalEmpires(galaxy) order for funding /
// sabotage / discovery, empire.colonies order for the sabotage target.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { BuiltObject as BuiltObjectClass } from '../../builtObject';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { galaxyDesignSpecificationBySubRole } from '../../gameStartTail';
import { generateDesignFromSpec } from '../../designGeneration';
import { IntelligenceMissionType, completeIntelligenceMission, newIntelligenceMissionAgainstEmpire, newIntelligenceMissionAgainstHabitat } from '../../espionage';
import { blockadeFor } from '../../fleets/blockades';
import { applyReputation } from '../reputation/ledger';
import { gameYear, radiusFraction, registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { GameEndOutcome } from '../../victory';
import { galaxyStarDate } from '../../tick/simTime';
import { startStarDateForAge } from '../../galaxyTime';
import {
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_SUSPECTED,
    arcMessage,
    arcNews,
    atWar,
    knowledgeLevel,
    normalEmpires,
    pastThreatMinYear,
    peekThreatState,
    registerThreatExistence,
    registerThreatKnownSites,
    revealTo,
    threatExists,
    threatGameEnd,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatSite,
} from './framework';

export const EXCHANGE_KEY = 'exchange';
export const EXCHANGE_FLAG = 'threatExchange';
const TAG = 'Exchange';
const PERIOD_DAYS = 30;
/** Game-end code (19f table). No defeat code: the Exchange never fights or holds territory — only containment. */
export const EXCHANGE_CODE_CONTAINED = 2018;
/** The sabotage-outcome branches of completeIntelligenceMission this threat reuses (espionage.ts 1596). */
// Resolved lazily: this module is imported through packages.ts while espionage.ts (the enum's module) may still be
// evaluating (import cycle game → packages → threats → espionage → … → game); a top-level read of the enum threw
// "Cannot read properties of undefined" in any test that imports game.ts first.
function sabotageTypes(): readonly IntelligenceMissionType[] {
    return [IntelligenceMissionType.SabotageColony, IntelligenceMissionType.SabotageConstruction, IntelligenceMissionType.InciteRevolution];
}

export interface ExchangeStation extends ThreatSite {
    bo: BuiltObject;
}

export interface ExchangeState {
    station: ExchangeStation | null;
    placed: boolean;
    fundedTotal: number;
    sabotageLog: { date: number }[];
    blockadeDays: number;
    ended: boolean;
    sentStages: SentStages;
    /** Discovery counter: intel missions an empire has completed against a currently-funded empire. */
    tracesByEmpire: Record<number, number>;
}

function newState(): ExchangeState {
    return { station: null, placed: false, fundedTotal: 0, sabotageLog: [], blockadeDays: 0, ended: false, sentStages: {}, tracesByEmpire: {} };
}

export function exchangeState(galaxy: Galaxy): ExchangeState {
    return threatState(galaxy, EXCHANGE_KEY, newState);
}
export function peekExchangeState(galaxy: Galaxy): ExchangeState | null {
    return peekThreatState<ExchangeState>(galaxy, EXCHANGE_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    year: (g: Galaxy) => Math.trunc(p(g, 'exchangeYear', 20)),
    fundPct: (g: Galaxy) => p(g, 'exchangeFundPct', 5),
    sabotagePerYear: (g: Galaxy) => Math.trunc(p(g, 'exchangeSabotagePerYear', 2)),
    blockadeDaysNeeded: (g: Galaxy) => p(g, 'exchangeBlockadeDays', 120),
};

function threatsGameEndOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags['threatsGameEnd'] !== false;
}

// ---------------------------------------------------------------------------------------------------------------
// Placement (yearly, once at exchangeYear)
// ---------------------------------------------------------------------------------------------------------------

/** Uncolonised habitats near the galaxy centre (radius fraction < 0.3 of sizeX/2), galaxy.habitats index order. */
function centralCandidates(galaxy: Galaxy): Habitat[] {
    return galaxy.habitats.filter((h) => h !== null && h.empire === null && !h.hasBeenDestroyed && radiusFraction(galaxy, h.xpos, h.ypos) <= 0.3);
}

export function exchangePlace(galaxy: Galaxy, st: ExchangeState): void {
    if (st.placed) return;
    st.placed = true;
    const owner = galaxy.independentEmpire;
    if (owner === null) return;
    const candidates = centralCandidates(galaxy);
    if (candidates.length === 0) return;
    const habitat = candidates[galaxy.rnd.next(0, candidates.length)];
    const spec = galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.LargeSpacePort);
    const design = generateDesignFromSpec(galaxy, owner, spec, 0, galaxyStarDate(galaxy));
    if (design === null) return;
    design.name = scenarioText(`${TAG} Station Name`);
    design.buildCount++;
    const name = design.name;
    const bo = new BuiltObjectClass(design, name, galaxy, true);
    bo.empire = owner;
    owner.addBuiltObjectToGalaxy(bo, habitat, false, true);
    st.station = { bo, knowledge: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Funding + sabotage (yearly)
// ---------------------------------------------------------------------------------------------------------------

/** The weaker side (lower stateMoney) of every empire-vs-empire war among normal empires, one entry per war pair. */
function warPairs(galaxy: Galaxy): { weaker: Empire; stronger: Empire }[] {
    const empires = normalEmpires(galaxy);
    const out: { weaker: Empire; stronger: Empire }[] = [];
    for (let i = 0; i < empires.length; i++) {
        for (let j = i + 1; j < empires.length; j++) {
            const a = empires[i];
            const b = empires[j];
            if (!atWar(a, b)) continue;
            out.push(a.stateMoney <= b.stateMoney ? { weaker: a, stronger: b } : { weaker: b, stronger: a });
        }
    }
    return out;
}

function fundedEmpireIds(galaxy: Galaxy): Set<number> {
    return new Set(warPairs(galaxy).map((w) => w.weaker.empireId));
}

export function exchangeYearly(galaxy: Galaxy, year: number): void {
    if (!threatExists(galaxy, EXCHANGE_KEY)) return; // §0 rarity: not this game — no state, no draws (minimal guard: shared with the reworked branch).
    const st = exchangeState(galaxy);
    if (st.ended) return;
    if (!st.placed) {
        const startYear = gameYear(startStarDateForAge(galaxy.age));
        if (year >= startYear + P.year(galaxy) && pastThreatMinYear(galaxy, EXCHANGE_KEY, year)) exchangePlace(galaxy, st); // §0 timing floor
        return;
    }
    if (st.station === null || st.station.bo.hasBeenDestroyed) return;
    const exchangeEmpire = galaxy.independentEmpire;
    if (exchangeEmpire === null) return;
    // Funding (§8): each funded empire's treasury grows by fundPct% of itself, capped at 10% growth per year.
    const pct = P.fundPct(galaxy) / 100;
    for (const w of warPairs(galaxy)) {
        const amount = Math.min(0.1 * Math.max(0, w.weaker.stateMoney), pct * Math.max(0, w.weaker.stateMoney));
        if (amount <= 0) continue;
        w.weaker.stateMoney += amount;
        st.fundedTotal += amount;
    }
    // Sabotage (§8): exchangeSabotagePerYear times, a rnd war pair's weaker side is helped by hitting its enemy.
    const pairs = warPairs(galaxy);
    for (let i = 0; i < P.sabotagePerYear(galaxy) && pairs.length > 0; i++) {
        const pair = pairs[galaxy.rnd.next(0, pairs.length)];
        const victim = pair.stronger; // the Exchange's client is `weaker`; it sabotages `stronger`, its enemy.
        if (victim.colonies.length === 0) continue;
        const colony = victim.colonies[galaxy.rnd.next(0, victim.colonies.length)];
        const types = sabotageTypes();
        const type = types[galaxy.rnd.next(0, types.length)];
        const mission = type === IntelligenceMissionType.InciteRevolution ? newIntelligenceMissionAgainstEmpire(null, null, type, galaxyStarDate(galaxy), victim) : newIntelligenceMissionAgainstHabitat(null, null, type, galaxyStarDate(galaxy), colony);
        completeIntelligenceMission(galaxy, exchangeEmpire, mission);
        st.sabotageLog.push({ date: galaxyStarDate(galaxy) });
        arcMessage(galaxy, st.sentStages, [victim], { prefix: TAG, stage: 'Sabotage', onceKey: `Sabotage:${st.sabotageLog.length}`, args: [pair.weaker.name, colony.name], subject: colony });
    }
    endCheck(galaxy, st);
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery (intelMissionCompleted)
// ---------------------------------------------------------------------------------------------------------------

function onIntelMissionCompleted(galaxy: Galaxy, empire: Empire, mission: unknown): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.station === null) return;
    const m = mission as { targetEmpire?: Empire | null } | null;
    const target = m?.targetEmpire ?? null;
    if (target === null || !fundedEmpireIds(galaxy).has(target.empireId)) return;
    const n = (st.tracesByEmpire[empire.empireId] ?? 0) + 1;
    st.tracesByEmpire[empire.empireId] = n;
    const level = n >= 2 ? KNOWLEDGE_CONFIRMED : KNOWLEDGE_SUSPECTED;
    if (!revealTo(galaxy, st.station, empire, level)) return;
    arcMessage(galaxy, st.sentStages, [empire], { prefix: TAG, stage: level >= KNOWLEDGE_CONFIRMED ? 'Funds Confirmed' : 'Funds Traced', onceKey: `Funds:${empire.empireId}:${level}`, subject: st.station.bo });
}

// ---------------------------------------------------------------------------------------------------------------
// Blockade / destruction (periodic + builtObjectRemoved)
// ---------------------------------------------------------------------------------------------------------------

function activeBlockader(galaxy: Galaxy, st: ExchangeState): Empire | null {
    if (st.station === null) return null;
    const blockade = blockadeFor(galaxy, st.station.bo);
    if (blockade === null) return null;
    const by = blockade.initiator;
    if (by === null || knowledgeLevel(st.station, by) < KNOWLEDGE_CONFIRMED) return null;
    return by;
}

function collapse(galaxy: Galaxy, st: ExchangeState, exposer: Empire | null): void {
    if (st.ended) return;
    st.ended = true;
    for (const e of galaxy.empires) {
        if (e === null || !e.active || e === exposer) continue;
        if (exposer !== null) applyReputation(galaxy, e, exposer, 20, { cause: 'exchange.exposed', source: '19f', term: 'bias', decayPerYear: 0, legacy: 'factored' });
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Collapsed' });
    if (threatsGameEndOn(galaxy)) threatGameEnd(galaxy, exposer, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), EXCHANGE_CODE_CONTAINED);
}

export function exchangeBlockadeCheck(galaxy: Galaxy): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.station === null || st.ended) return;
    const by = activeBlockader(galaxy, st);
    if (by === null) {
        st.blockadeDays = 0;
        return;
    }
    st.blockadeDays += PERIOD_DAYS;
    if (st.blockadeDays >= P.blockadeDaysNeeded(galaxy)) collapse(galaxy, st, by);
}

function onBuiltObjectRemoved(galaxy: Galaxy, bo: BuiltObject): void {
    const st = peekExchangeState(galaxy);
    if (st === null || st.station === null || st.station.bo !== bo || st.ended) return;
    collapse(galaxy, st, null);
}

function endCheck(galaxy: Galaxy, st: ExchangeState): void {
    if (st.station !== null && st.station.bo.hasBeenDestroyed) collapse(galaxy, st, null);
}

// ---------------------------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------------------------

export function exchangeKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekExchangeState(galaxy);
    if (st === null || st.station === null) return [];
    const level = knowledgeLevel(st.station, empire);
    if (level <= 0) return [];
    return [{ threat: EXCHANGE_KEY, kind: 'ship', target: st.station.bo, level, label: scenarioText(level >= KNOWLEDGE_CONFIRMED ? `${TAG} Confirmed Row` : `${TAG} Suspected Row`) }];
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const EXCHANGE_HANDLER_IDS = ['exchange.yearly', 'exchange.periodic', 'exchange.intel', 'exchange.removed'] as const;

export function registerExchange(): void {
    registerThreatExistence(EXCHANGE_KEY, EXCHANGE_FLAG);
    registerScenarioYearly({ id: 'exchange.yearly', flag: EXCHANGE_FLAG, order: 10, run: exchangeYearly });
    registerScenarioPeriodic({ id: 'exchange.periodic', flag: EXCHANGE_FLAG, periodDays: PERIOD_DAYS, order: 10, run: (g) => exchangeBlockadeCheck(g) });
    registerScenarioEvent({ id: 'exchange.intel', flag: EXCHANGE_FLAG, event: 'intelMissionCompleted', run: (g, e) => onIntelMissionCompleted(g, e.empire, e.mission) });
    registerScenarioEvent({ id: 'exchange.removed', flag: EXCHANGE_FLAG, event: 'builtObjectRemoved', run: (g, e) => onBuiltObjectRemoved(g, e.builtObject) });
    registerThreatKnownSites(EXCHANGE_KEY, exchangeKnownSites);
}

registerExchange();
