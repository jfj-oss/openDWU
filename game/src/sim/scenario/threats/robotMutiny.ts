// 19f #9 Robot Mutiny (tasks/19f-hidden-threats.md §9, threat framework framework.ts). Not a port: new scenario
// behaviour composed of ported functions (each composed step cites its C# analogue). Registered from
// scenario/packages.ts; every handler is gated by the `threatRobotMutiny` flag, so with the flag off (or no
// scenario) nothing here runs and nothing draws. scenarios/robotmutiny includes darkfarms (D3) for the Harvester
// race the faction wears (§9 "faction race = Harvester from 19b (via D3 include...)").
//
// Arc: one existing ruin world (no new ruin created) is the hidden transmitter. Empires spread the threat themselves
// by recruiting BattleBot troops (the stock RoboticTroopFoundry path, identified by the stock marker
// troop.race === null && troop.pictureRef === galaxy.races.length, troops.ts 387/701). Once the galaxy-wide robot
// count clears the threshold at/after mutinyYear, every robot troop in every colony's garrison rises from inside
// (framework invadeFromInside) and majority-robot transports flip to the faction (framework flipToFaction). Newly
// recruited robots keep joining the faction each period afterwards, until the source is neutralised.
//
// Rnd (§0.4): draws only in mutinyTrigger (the ship-flip roll) and mutinyPeriodic's discovery roll. mutinySeed,
// mutinyHints, mutinyReinfect and the AI policy rule are deterministic. Fixed iteration orders: galaxy.habitats index
// order for the rising / reinfection sweep, normalEmpires(galaxy) order for hints / discovery / the AI rule, an
// empire's builtObjects list order for the ship-flip sweep.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { Troop, TroopType } from '../../cargo';
import { CharacterRole, getEmpireCharacters, type Character, type IntelligenceMission } from '../../characters';
import { gameYear, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { GameEndOutcome } from '../../victory';
import { galaxyStarDate } from '../../tick/simTime';
import { startStarDateForAge } from '../../galaxyTime';
import {
    KNOWLEDGE_CONFIRMED,
    arcMessage,
    arcNews,
    createThreatFaction,
    factionPopulationSharePct,
    flipToFaction,
    invadeFromInside,
    knowledgeLevel,
    normalEmpires,
    peekThreatState,
    revealTo,
    teardownIfDead,
    threatGameEnd,
    threatState,
    type SentStages,
    type ThreatKnowledge,
} from './framework';

export const ROBOT_MUTINY_KEY = 'robotMutiny';
export const ROBOT_MUTINY_FLAG = 'threatRobotMutiny';
const TAG = 'Mutiny';
const PERIOD_DAYS = 30;
/** IntelligenceMissionType.CounterIntelligence (espionage.ts): 8. */
const COUNTER_INTELLIGENCE = 8;
/** Game-end codes (19f table: 1911 Grey Tide … 1920 Corporate Coup; victory/containment = code + 100). */
export const ROBOT_MUTINY_CODE_DEFEAT = 1919;
export const ROBOT_MUTINY_CODE_CONTAINED = 2019;

export interface RobotMutinyState {
    seeded: boolean;
    source: Habitat | null;
    sourceTaken: boolean;
    triggered: boolean;
    faction: Empire | null;
    knowledge: Record<number, ThreatKnowledge[]>;
    sourceKnowledge: ThreatKnowledge[];
    stoppedRecruiting: number[];
    sentStages: SentStages;
    ended: boolean;
}

function newState(): RobotMutinyState {
    return { seeded: false, source: null, sourceTaken: false, triggered: false, faction: null, knowledge: {}, sourceKnowledge: [], stoppedRecruiting: [], sentStages: {}, ended: false };
}

export function robotMutinyState(galaxy: Galaxy): RobotMutinyState {
    return threatState(galaxy, ROBOT_MUTINY_KEY, newState);
}
export function peekRobotMutinyState(galaxy: Galaxy): RobotMutinyState | null {
    return peekThreatState<RobotMutinyState>(galaxy, ROBOT_MUTINY_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    year: (g: Galaxy) => Math.trunc(p(g, 'mutinyYear', 70)),
    minRobots: (g: Galaxy) => Math.trunc(p(g, 'mutinyMinRobots', 30)),
    shipFlipPct: (g: Galaxy) => p(g, 'mutinyShipFlipPct', 100),
    sourceDetectPct: (g: Galaxy) => p(g, 'mutinySourceDetectPct', 8),
    defeatPopulationPct: (g: Galaxy) => p(g, 'mutinyDefeatPopulationPct', 40),
};

function threatsGameEndOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags['threatsGameEnd'] !== false;
}

/** The stock BattleBot marker (troops.ts 387 RoboticTroopFoundry / 701; framework.ts makeRobotTroop). */
export function isRobotTroop(galaxy: Galaxy, t: Troop): boolean {
    return t.type === TroopType.Infantry && t.race === null && t.pictureRef === galaxy.races.length;
}

function sourceNeutralised(st: RobotMutinyState): boolean {
    return st.source === null || st.source.hasBeenDestroyed || st.sourceTaken;
}

// ---------------------------------------------------------------------------------------------------------------
// Seed (yearly, once): pick an existing ruin world as the hidden transmitter. No new ruin created.
// ---------------------------------------------------------------------------------------------------------------

export function mutinySeed(galaxy: Galaxy, st: RobotMutinyState): void {
    if (st.seeded) return;
    st.seeded = true;
    const candidates = galaxy.ruinsHabitats.filter((h) => h !== null && !h.hasBeenDestroyed);
    if (candidates.length === 0) return;
    st.source = candidates[galaxy.rnd.next(0, candidates.length)];
}

// ---------------------------------------------------------------------------------------------------------------
// Robot counting / hints
// ---------------------------------------------------------------------------------------------------------------

function empireRobotCount(galaxy: Galaxy, empire: Empire): number {
    let n = 0;
    for (const t of empire.troops.items) if (isRobotTroop(galaxy, t)) n++;
    return n;
}

function galaxyRobotCount(galaxy: Galaxy): number {
    let n = 0;
    for (const e of normalEmpires(galaxy)) n += empireRobotCount(galaxy, e);
    return n;
}

function mutinyHints(galaxy: Galaxy, st: RobotMutinyState, year: number): void {
    if (year < P.year(galaxy) - 10) return;
    for (const e of normalEmpires(galaxy)) {
        if (empireRobotCount(galaxy, e) >= 10) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Hint', onceKey: `Hint:${e.empireId}` });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------------------------------------------

/** Moves a garrisoned robot troop from the colony's defenders to the faction's invaders (§9's rising). */
function mutiniseGarrisonTroop(galaxy: Galaxy, habitat: Habitat, faction: Empire, t: Troop): void {
    const oldEmpire = t.empire as Empire | null;
    habitat.troops?.remove(t);
    if (oldEmpire !== null && oldEmpire !== faction) oldEmpire.troops.remove(t);
    invadeFromInside(galaxy, habitat, faction, [t]);
    if (!faction.troops.contains(t)) faction.troops.add(t);
}

export function mutinyTrigger(galaxy: Galaxy, st: RobotMutinyState): boolean {
    const faction = createThreatFaction(galaxy, { race: 'Harvester', name: scenarioText(`${TAG} Faction Name`), enemies: normalEmpires(galaxy) });
    if (faction === null) return false;
    st.faction = faction;
    st.triggered = true;
    for (const h of galaxy.habitats) {
        if (h === null || h.troops === null || h.empire === null || h.empire === faction) continue;
        const robots = h.troops.items.filter((t) => isRobotTroop(galaxy, t));
        for (const t of robots) mutiniseGarrisonTroop(galaxy, h, faction, t);
    }
    for (const e of normalEmpires(galaxy, faction)) {
        for (const bo of [...e.builtObjects]) {
            if (bo.hasBeenDestroyed || bo.troops === null || bo.troops.count === 0) continue;
            const robotCount = bo.troops.items.filter((t) => isRobotTroop(galaxy, t)).length;
            if (robotCount * 2 <= bo.troops.count) continue; // majority-robot only
            if (galaxy.rnd.next(0, 100) >= P.shipFlipPct(galaxy)) continue;
            flipToFaction(galaxy, bo, faction);
            for (const t of [...bo.troops.items]) {
                t.empire = faction;
                if (!faction.troops.contains(t)) faction.troops.add(t);
            }
        }
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Trigger', textTag: `${TAG} Trigger News` });
    for (const e of normalEmpires(galaxy, faction)) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Trigger' });
    return true;
}

/** §9 "the transmitter keeps re-infecting": a robot troop recruited after the trigger joins the faction next period. */
function mutinyReinfect(galaxy: Galaxy, st: RobotMutinyState): void {
    if (!st.triggered || st.faction === null || sourceNeutralised(st)) return;
    const faction = st.faction;
    for (const h of galaxy.habitats) {
        if (h === null || h.troops === null || h.empire === null || h.empire === faction) continue;
        const robots = h.troops.items.filter((t) => isRobotTroop(galaxy, t) && t.empire !== faction);
        for (const t of robots) mutiniseGarrisonTroop(galaxy, h, faction, t);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery / defusal / AI
// ---------------------------------------------------------------------------------------------------------------

function agentWatchesCounterIntelligence(c: Character): boolean {
    if (c.role !== CharacterRole.IntelligenceAgent || !c.active) return false;
    const m = c.mission as IntelligenceMission | null;
    return m !== null && m.type === COUNTER_INTELLIGENCE;
}

function mutinyDiscovery(galaxy: Galaxy, st: RobotMutinyState): void {
    if (st.source === null) return;
    const pct = P.sourceDetectPct(galaxy) / 100;
    if (pct <= 0) return;
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (empireRobotCount(galaxy, e) === 0) continue;
        if (knowledgeLevel({ knowledge: st.sourceKnowledge }, e) >= KNOWLEDGE_CONFIRMED) continue;
        const watching = getEmpireCharacters(e).some(agentWatchesCounterIntelligence);
        if (!watching) continue;
        if (galaxy.rnd.nextDouble() < pct) {
            revealTo(galaxy, { knowledge: st.sourceKnowledge }, e, KNOWLEDGE_CONFIRMED);
            arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Source Found', onceKey: `Source Found:${e.empireId}`, args: [st.source.name], subject: st.source });
        }
    }
}

/** §9 AI: an empire at knowledge level 3 stops recruiting robots (policy colonyAllowFacilityRoboticTroopFoundry = false). */
function aiStopRecruiting(galaxy: Galaxy, st: RobotMutinyState): void {
    for (const e of normalEmpires(galaxy, st.faction)) {
        if (st.stoppedRecruiting.includes(e.empireId)) continue;
        if (knowledgeLevel({ knowledge: st.sourceKnowledge }, e) < KNOWLEDGE_CONFIRMED) continue;
        if (e.policy !== null) e.policy.colonyAllowFacilityRoboticTroopFoundry = false;
        st.stoppedRecruiting.push(e.empireId);
    }
}

/** §9 counterplay: a troop landing on the source (present in `source.troops`) before the trigger defuses it. */
function checkDefused(galaxy: Galaxy, st: RobotMutinyState): void {
    if (st.triggered || st.sourceTaken || st.source === null) return;
    if (st.source.hasBeenDestroyed || (st.source.troops !== null && st.source.troops.count > 0)) {
        st.sourceTaken = true;
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Defused', args: [st.source.name] });
        if (threatsGameEndOn(galaxy)) {
            st.ended = true;
            threatGameEnd(galaxy, galaxy.playerEmpire, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), ROBOT_MUTINY_CODE_CONTAINED);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly / periodic
// ---------------------------------------------------------------------------------------------------------------

export function mutinyYearly(galaxy: Galaxy, year: number): void {
    const st = robotMutinyState(galaxy);
    if (st.ended) return;
    if (!st.seeded) {
        const startYear = gameYear(startStarDateForAge(galaxy.age));
        if (year >= startYear) mutinySeed(galaxy, st);
    }
    mutinyHints(galaxy, st, year);
    checkDefused(galaxy, st);
    if (!st.triggered && !sourceNeutralised(st) && year >= P.year(galaxy) && galaxyRobotCount(galaxy) >= P.minRobots(galaxy)) {
        mutinyTrigger(galaxy, st);
    }
}

export function mutinyPeriodic(galaxy: Galaxy): void {
    const st = peekRobotMutinyState(galaxy);
    if (st === null || st.ended) return;
    checkDefused(galaxy, st);
    mutinyReinfect(galaxy, st);
    mutinyDiscovery(galaxy, st);
    aiStopRecruiting(galaxy, st);
    if (st.faction === null) return;
    if (st.faction.active && factionPopulationSharePct(galaxy, st.faction) >= P.defeatPopulationPct(galaxy)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Defeat', args: [Math.round(factionPopulationSharePct(galaxy, st.faction))] });
        if (threatsGameEndOn(galaxy)) {
            st.ended = true;
            threatGameEnd(galaxy, st.faction, GameEndOutcome.Defeat, scenarioText(`${TAG} Defeat Title`), ROBOT_MUTINY_CODE_DEFEAT);
        }
        return;
    }
    if (teardownIfDead(galaxy, st.faction)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained' });
        if (threatsGameEndOn(galaxy)) {
            st.ended = true;
            threatGameEnd(galaxy, galaxy.playerEmpire, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), ROBOT_MUTINY_CODE_CONTAINED);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const ROBOT_MUTINY_HANDLER_IDS = ['robotMutiny.yearly', 'robotMutiny.periodic'] as const;

export function registerRobotMutiny(): void {
    registerScenarioYearly({ id: 'robotMutiny.yearly', flag: ROBOT_MUTINY_FLAG, order: 10, run: mutinyYearly });
    registerScenarioPeriodic({ id: 'robotMutiny.periodic', flag: ROBOT_MUTINY_FLAG, periodDays: PERIOD_DAYS, order: 10, run: mutinyPeriodic });
}

registerRobotMutiny();
