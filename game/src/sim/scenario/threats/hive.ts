// 19f-5 The Hive (tasks/19f-hidden-threats.md §5). Not a port: new scenario behaviour composed of ported functions.
// Registered from scenario/packages.ts; every handler is gated by the `hive` flag, so flag off draws nothing.
//
// Arc: every independent colony at game start is a node of one hidden mind. A node absorbed by an empire stays a
// node (colonyOwnerChanged from the independent empire); at hiveThresholdPct absorbed, the Chorus declares: every
// still-independent node is handed to it outright (takeOwnershipOfColonyFull), and every absorbed node rises from
// inside with node-race militia (invadeFromInside) — the stock ground war decides each one.
//
// Rnd (§0.4): draws only in the flag-gated periodic handler (the discovery rolls) and the trigger's faction creation
// (and the stock functions it calls). colonyOwnerChanged itself draws nothing (bookkeeping only). Fixed iteration
// orders: nodes / absorbed by galaxy.habitats index order, galaxy.empires order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { takeOwnershipOfColonyFull } from '../../combat/ownership';
import { CharacterRole, generateNewCharacter } from '../../characters';
import { EmpireMessageType } from '../../messages';
import { GameEndOutcome } from '../../victory';
import { registerScenarioEvent, registerScenarioGameStart, registerScenarioPeriodic } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { registerHiddenThing, retireHiddenTarget } from '../security/registry';
import {
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_SUSPECTED,
    arcMessage,
    arcNews,
    createThreatFaction,
    invadeFromInside,
    knowledgeLevel,
    makeFactionTroop,
    normalEmpires,
    peekThreatState,
    revealTo,
    registerThreatKnownSites,
    teardownIfDead,
    threatGameEnd,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';

export const HIVE_KEY = 'hive';
export const HIVE_FLAG = 'hive';
const TAG = 'Hive';
/** Game-end codes (19f §0.8: 1911 Grey Tide … 1920 Corporate Coup; +100 = victory/containment). */
export const HIVE_CODE_CONTAINED = 2015;
const PERIOD_DAYS = 60;
/** HIVE_MIND governments.txt id (not overlaid; cited directly, 19f §5). */
const HIVE_MIND_GOVERNMENT = 11;

export interface HiveNode {
    habitat: Habitat;
    knowledge: ThreatKnowledge[];
}

export interface HiveState {
    /** galaxy.independentColonies at scenario start (habitat, plus this empire's knowledge of its node status). */
    nodes: HiveNode[];
    /** Nodes absorbed by a normal empire (subset of nodes' habitats). */
    absorbed: Habitat[];
    faction: Empire | null;
    agentsGiven: boolean;
    sentStages: SentStages;
    factionHadColonies: boolean;
    ended: boolean;
}

function newState(): HiveState {
    return { nodes: [], absorbed: [], faction: null, agentsGiven: false, sentStages: {}, factionHadColonies: false, ended: false };
}

export function hiveState(galaxy: Galaxy): HiveState {
    return threatState(galaxy, HIVE_KEY, newState);
}

export function peekHiveState(galaxy: Galaxy): HiveState | null {
    return peekThreatState<HiveState>(galaxy, HIVE_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}

const P = {
    thresholdPct: (g: Galaxy) => p(g, 'hiveThresholdPct', 40),
    militiaFactor: (g: Galaxy) => p(g, 'hiveMilitiaFactor', 1.5),
    minNodes: (g: Galaxy) => p(g, 'hiveMinNodes', 5),
    detectPct: (g: Galaxy) => p(g, 'hiveDetectPct', 15),
};

function nodeOf(st: HiveState, h: Habitat): HiveNode | undefined {
    return st.nodes.find((n) => n.habitat === h);
}

// ---------------------------------------------------------------------------------------------------------------
// Init (game start): every independent colony at the start of the game is a node.
// ---------------------------------------------------------------------------------------------------------------

export function hiveInit(galaxy: Galaxy): void {
    const st = hiveState(galaxy);
    if (st.nodes.length > 0) return;
    st.nodes = [...galaxy.independentColonies].map((habitat) => ({ habitat, knowledge: [] }));
}

// ---------------------------------------------------------------------------------------------------------------
// Spread: a node absorbed by a normal empire
// ---------------------------------------------------------------------------------------------------------------

export function onColonyOwnerChanged(galaxy: Galaxy, colony: Habitat, from: Empire | null, to: Empire | null): void {
    const st = peekHiveState(galaxy);
    if (st === null || st.faction !== null) return;
    const node = nodeOf(st, colony);
    if (node === undefined) return;
    if (from === galaxy.independentEmpire && to !== null && to !== galaxy.independentEmpire) {
        if (!st.absorbed.includes(colony)) st.absorbed.push(colony);
        registerHiddenThing(galaxy, { kind: 'hiveNode', concealment: 70, empire: to, target: colony, package: '19f.hive', site: node }); // 19m (flag-gated)
        // Advisory to the new owner: it is standing on a Hive node (level 2 — "garrison it").
        revealTo(galaxy, node, to, KNOWLEDGE_SUSPECTED);
    } else if (to === galaxy.independentEmpire && st.absorbed.includes(colony)) {
        st.absorbed.splice(st.absorbed.indexOf(colony), 1);
        retireHiddenTarget(galaxy, 'hiveNode', colony); // 19m (flag-gated)
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic: hints, discovery, trigger check
// ---------------------------------------------------------------------------------------------------------------

function absorptionPct(st: HiveState): number {
    return st.nodes.length > 0 ? (100 * st.absorbed.length) / st.nodes.length : 0;
}

export function hivePeriodic(galaxy: Galaxy, now: number): void {
    void now;
    const st = hiveState(galaxy);
    if (st.ended) return;
    if (st.faction === null) {
        const pct = absorptionPct(st);
        if (pct >= 20) arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Rumour', onceKey: 'Rumour' });
        if (pct >= 30) arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Dreams', onceKey: 'Dreams' });
        // Confirmed node status for an empire holding an absorbed node (counter-intelligence analogue, flat roll).
        const dpct = P.detectPct(galaxy) / 100;
        if (dpct > 0) {
            for (const h of [...st.absorbed]) {
                const owner = h.empire;
                if (owner === null || owner === galaxy.independentEmpire) continue;
                const node = nodeOf(st, h)!;
                if (knowledgeLevel(node, owner) >= KNOWLEDGE_CONFIRMED) continue;
                if (galaxy.rnd.nextDouble() < dpct) {
                    revealTo(galaxy, node, owner, KNOWLEDGE_CONFIRMED);
                    arcMessage(galaxy, st.sentStages, [owner], { prefix: TAG, stage: 'Confirmed', onceKey: `Confirmed:${galaxy.habitats.indexOf(h)}`, args: [h.name], type: EmpireMessageType.GeneralWarning, subject: h });
                }
            }
        }
        if (st.nodes.length >= P.minNodes(galaxy) && absorptionPct(st) >= P.thresholdPct(galaxy)) hiveTrigger(galaxy, st);
    }
    hiveEndCheck(galaxy, st);
}

// ---------------------------------------------------------------------------------------------------------------
// Trigger / faction
// ---------------------------------------------------------------------------------------------------------------

/** The most common dominant race among the absorbed nodes' colonies (ties: habitat index order). */
function majorityNodeRace(st: HiveState) {
    const counts = new Map<string, number>();
    let best: string | null = null;
    let bestN = 0;
    for (const h of st.absorbed) {
        const race = h.population?.dominantRace ?? null;
        if (race === null) continue;
        const n = (counts.get(race.name) ?? 0) + 1;
        counts.set(race.name, n);
        if (n > bestN) {
            bestN = n;
            best = race.name;
        }
    }
    return best;
}

/** §5 trigger: absorbed/nodes ≥ threshold → The Chorus rises. */
export function hiveTrigger(galaxy: Galaxy, st: HiveState): boolean {
    if (st.faction !== null) return true;
    const race = majorityNodeRace(st) ?? st.nodes[0]?.habitat.population?.dominantRace?.name ?? null;
    if (race === null) return false;
    const faction = createThreatFaction(galaxy, {
        race,
        name: scenarioText(`${TAG} Faction Name`),
        governmentId: HIVE_MIND_GOVERNMENT,
        enemies: normalEmpires(galaxy),
    });
    if (faction === null) return false;
    st.faction = faction;
    for (const n of [...st.nodes].sort((a, b) => galaxy.habitats.indexOf(a.habitat) - galaxy.habitats.indexOf(b.habitat))) {
        const h = n.habitat;
        if (h.hasBeenDestroyed) continue;
        if (h.empire === galaxy.independentEmpire) {
            takeOwnershipOfColonyFull(galaxy, galaxy.independentEmpire!, h, faction, false, false);
        } else if (st.absorbed.includes(h) && h.empire !== null && h.empire !== faction) {
            const nodeRace = h.population?.dominantRace ?? null;
            const strength = Math.trunc((nodeRace?.troopStrength ?? 60) * P.militiaFactor(galaxy));
            const troop = makeFactionTroop(galaxy, faction, strength, scenarioText(`${TAG} Militia Name`), nodeRace);
            invadeFromInside(galaxy, h, faction, [troop]);
        }
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Turn', textTag: `${TAG} Turn News` });
    for (const e of normalEmpires(galaxy, faction)) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Turn', type: EmpireMessageType.GeneralBadEvent });
    return true;
}

/** §5 dirty: one intelligence agent per 3 nodes, once the faction has a capital to base them at. */
export function hiveGiveAgents(galaxy: Galaxy, st: HiveState): void {
    if (st.faction === null || st.agentsGiven || st.faction.capital === null) return;
    st.agentsGiven = true;
    const n = Math.trunc(st.nodes.length / 3);
    for (let i = 0; i < n; i++) generateNewCharacter(galaxy, st.faction, CharacterRole.IntelligenceAgent, st.faction.capital);
}

function onFactionColonyOwnerChanged(galaxy: Galaxy, colony: Habitat, from: Empire | null, to: Empire | null): void {
    void from;
    const st = peekHiveState(galaxy);
    if (st === null || st.faction === null || to !== st.faction) return;
    if (st.faction.capital === null) st.faction.capital = colony;
    hiveGiveAgents(galaxy, st);
}

// ---------------------------------------------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------------------------------------------

export function hiveEndCheck(galaxy: Galaxy, st: HiveState): void {
    const faction = st.faction;
    if (faction === null || st.ended) return;
    if (faction.active && faction.colonies.length > 0) st.factionHadColonies = true;
    if (!st.factionHadColonies) return; // hasn't taken its first node yet
    if (faction.active && faction.colonies.length > 0) return;
    if (!teardownIfDead(galaxy, faction) && faction.active) return;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained' });
    st.ended = true;
    const player = galaxy.playerEmpire;
    if (player !== null) threatGameEnd(galaxy, player, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), HIVE_CODE_CONTAINED);
}

// ---------------------------------------------------------------------------------------------------------------
// UI selector
// ---------------------------------------------------------------------------------------------------------------

export function hiveKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekHiveState(galaxy);
    if (st === null) return [];
    const out: KnownThreatSite[] = [];
    for (const n of st.nodes) {
        if (n.habitat.hasBeenDestroyed) continue;
        const level = st.faction !== null ? KNOWLEDGE_CONFIRMED : knowledgeLevel(n, empire);
        if (level <= 0) continue;
        out.push({ threat: HIVE_KEY, kind: 'colony', target: n.habitat, level, label: scenarioText(level >= KNOWLEDGE_CONFIRMED ? `${TAG} Node Confirmed Row` : `${TAG} Node Suspected Row`) });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const HIVE_HANDLER_IDS = ['hive.init', 'hive.periodic', 'hive.colony', 'hive.factionColony'] as const;

export function registerHive(): void {
    registerScenarioGameStart({ id: 'hive.init', flag: HIVE_FLAG, run: (g) => hiveInit(g) });
    registerScenarioPeriodic({ id: 'hive.periodic', flag: HIVE_FLAG, order: 10, periodDays: PERIOD_DAYS, run: hivePeriodic });
    registerScenarioEvent({ id: 'hive.colony', flag: HIVE_FLAG, order: 0, event: 'colonyOwnerChanged', run: (g, e) => onColonyOwnerChanged(g, e.colony, e.from, e.to) });
    registerScenarioEvent({ id: 'hive.factionColony', flag: HIVE_FLAG, order: 10, event: 'colonyOwnerChanged', run: (g, e) => onFactionColonyOwnerChanged(g, e.colony, e.from, e.to) });
    registerThreatKnownSites(HIVE_KEY, hiveKnownSites);
}

registerHive();
