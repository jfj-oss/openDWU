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
import { galaxyStarDate } from '../../tick/simTime';
import { registerGuardianPeace, gameYear, registerScenarioEvent, registerScenarioGameStart, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly, type HomePlacementHelpers } from '../hooks';
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
    threatEmpires,
    pastThreatMinYear,
    peekThreatState,
    revealTo,
    registerThreatExistence,
    registerThreatSpawn,
    nearestToEmpire,
    registerThreatKnownSites,
    teardownIfDead,
    threatExists,
    threatGameEnd,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';
import { risingShortfall } from './cult';
import { applyIncomeFloor, capturedFleetLimit, foundMiningStations, pumpNavy, directFleets, topUpGarrisons, ensureConstructionShips, averageMilitary, makeTroopsOfStrength, navyRise, newNavyState, spawnPendingNavy, syncFactionTech, takeMiningStationsNear, topUpPorts, type NavyState } from './factionNavy';

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
    /**
     * Every colony that was independent: the ones at scenario start (habitat, plus this empire's knowledge of its node status) and the
     * ones the settling of an older start had already given to an empire.
     */
    nodes: HiveNode[];
    /** Nodes absorbed by a normal empire (subset of nodes' habitats). */
    absorbed: Habitat[];
    /** The add-on was on from game start, so `nodes` / `absorbed` are exact (also in a game the Hive rolled "not this game" for). Absent: a Game Editor spawn fell back on a guess. */
    tracked?: boolean;
    /** Game year of the last yearly rise roll (hiveRiseChancePct). */
    riseRollYear?: number;
    faction: Empire | null;
    agentsGiven: boolean;
    sentStages: SentStages;
    factionHadColonies: boolean;
    ended: boolean;
    /** The faction's economy / navy bookkeeping (factionNavy.ts); null until it rises. */
    navy?: NavyState | null;
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
    maxNodesSeized: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'hiveMaxNodesSeized', 30))),
    /** Once the threshold is met (and the year floor passed) the Chorus rises with this chance each game year (100: at the first check). */
    /** Each absorbed node rises with troops this many times its colony's defence on top of the militia (up to hiveRisingMaxStrength); 0: the militia alone. */
    risingOverkill: (g: Galaxy) => Math.max(0, p(g, 'hiveRisingOverkill', 6)),
    risingMaxStrength: (g: Galaxy) => Math.max(0, p(g, 'hiveRisingMaxStrength', 3000000)),
    riseChancePct: (g: Galaxy) => Math.max(0, Math.min(100, p(g, 'hiveRiseChancePct', 20))),
};

/** Nearest-cluster radius for "the largest absorbed cluster" (§4 hiveMaxNodesSeized: nearest that cluster first). */
const CLUSTER_RADIUS = 3000;

function nodeOf(st: HiveState, h: Habitat): HiveNode | undefined {
    return st.nodes.find((n) => n.habitat === h);
}

// ---------------------------------------------------------------------------------------------------------------
// Init (game start): every independent colony at the start of the game is a node.
// ---------------------------------------------------------------------------------------------------------------

export function hiveInit(galaxy: Galaxy, ctx?: HomePlacementHelpers): void {
    // The record is kept in every game the add-on is on in, also one the Hive rolled "not this game" for (§0 rarity: it draws nothing
    // and posts nothing), so a Game Editor spawn in year 50 still knows which colonies were independent.
    const st = hiveState(galaxy);
    if (st.tracked === true) return;
    st.tracked = true;
    st.nodes = [...galaxy.independentColonies].map((habitat) => ({ habitat, knowledge: [] }));
    // An older start's settling gave some independent colonies to the empires (the extra colonies of "Settling colonies", game.ts): nodes already absorbed.
    const exists = threatExists(galaxy, HIVE_KEY);
    for (const habitat of ctx?.settledIndependents ?? []) {
        const owner = habitat.empire;
        if (habitat.hasBeenDestroyed || owner === null || owner === galaxy.independentEmpire || st.nodes.some((n) => n.habitat === habitat)) continue;
        const node: HiveNode = { habitat, knowledge: [] };
        st.nodes.push(node);
        st.absorbed.push(habitat);
        if (exists) registerHiddenThing(galaxy, { kind: 'hiveNode', concealment: 70, empire: owner, target: habitat, package: '19f.hive', site: node }); // 19m (flag-gated)
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Spread: a node absorbed by a normal empire
// ---------------------------------------------------------------------------------------------------------------

export function onColonyOwnerChanged(galaxy: Galaxy, colony: Habitat, from: Empire | null, to: Empire | null): void {
    const st = peekHiveState(galaxy);
    if (st === null || st.faction !== null) return;
    const node = nodeOf(st, colony);
    if (node === undefined) return;
    // Recorded in every game the add-on is on in; the hidden thing and the advisory only where the Hive exists.
    const exists = threatExists(galaxy, HIVE_KEY);
    if (from === galaxy.independentEmpire && to !== null && to !== galaxy.independentEmpire) {
        if (!st.absorbed.includes(colony)) st.absorbed.push(colony);
        if (!exists) return;
        registerHiddenThing(galaxy, { kind: 'hiveNode', concealment: 70, empire: to, target: colony, package: '19f.hive', site: node }); // 19m (flag-gated)
        // Advisory to the new owner: it is standing on a Hive node (level 2 — "garrison it").
        revealTo(galaxy, node, to, KNOWLEDGE_SUSPECTED);
    } else if (to === galaxy.independentEmpire && st.absorbed.includes(colony)) {
        st.absorbed.splice(st.absorbed.indexOf(colony), 1);
        if (exists) retireHiddenTarget(galaxy, 'hiveNode', colony); // 19m (flag-gated)
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic: hints, discovery, trigger check
// ---------------------------------------------------------------------------------------------------------------

function absorptionPct(st: HiveState): number {
    return st.nodes.length > 0 ? (100 * st.absorbed.length) / st.nodes.length : 0;
}

export function hivePeriodic(galaxy: Galaxy, now: number): void {
    if (!threatExists(galaxy, HIVE_KEY)) return; // §0 rarity: not this game — no state, no draws.
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
        if (st.nodes.length >= P.minNodes(galaxy) && absorptionPct(st) >= P.thresholdPct(galaxy) && pastThreatMinYear(galaxy, HIVE_KEY)) {
            // Most nodes are usually absorbed long before the year floor passes (an older start's settling alone absorbs most of them), so
            // meeting the threshold does not raise the Chorus at once: from then on it has a chance each game year.
            const year = gameYear(galaxyStarDate(galaxy));
            if (st.riseRollYear !== year) {
                st.riseRollYear = year;
                const chance = P.riseChancePct(galaxy);
                if (chance >= 100 || galaxy.rnd.nextDouble() * 100 < chance) hiveTrigger(galaxy, st);
            }
        }
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

/** The centre of the largest cluster among `st.absorbed` (habitats within CLUSTER_RADIUS of each other); null if none absorbed. */
function largestAbsorbedClusterCenter(galaxy: Galaxy, st: HiveState): { x: number; y: number } | null {
    if (st.absorbed.length === 0) return null;
    let best = st.absorbed[0];
    let bestCount = -1;
    for (const h of st.absorbed) {
        let n = 0;
        for (const other of st.absorbed) if (galaxy.calculateDistance(h.xpos, h.ypos, other.xpos, other.ypos) <= CLUSTER_RADIUS) n++;
        if (n > bestCount) {
            bestCount = n;
            best = h;
        }
    }
    return { x: best.xpos, y: best.ypos };
}

/**
 * §4 hiveMaxNodesSeized: the still-independent nodes the trigger seizes outright — at most the cap, nearest the
 * largest absorbed cluster first (ties, and no absorbed cluster to measure from: habitat index order). Under the
 * cap every still-independent node is seized, in the same set as before this param existed.
 */
function seizedIndependentNodes(galaxy: Galaxy, st: HiveState, near: Habitat | null = null): Set<Habitat> {
    const independent = st.nodes.filter((n) => !n.habitat.hasBeenDestroyed && n.habitat.empire === galaxy.independentEmpire);
    const cap = P.maxNodesSeized(galaxy);
    if (independent.length <= cap) return new Set(independent.map((n) => n.habitat));
    const center = largestAbsorbedClusterCenter(galaxy, st) ?? (near === null ? null : { x: near.xpos, y: near.ypos });
    const byDistance = [...independent].sort((a, b) => {
        const ia = galaxy.habitats.indexOf(a.habitat);
        const ib = galaxy.habitats.indexOf(b.habitat);
        if (center === null) return ia - ib;
        const da = galaxy.calculateDistance(center.x, center.y, a.habitat.xpos, a.habitat.ypos);
        const db = galaxy.calculateDistance(center.x, center.y, b.habitat.xpos, b.habitat.ypos);
        return da - db || ia - ib;
    });
    return new Set(byDistance.slice(0, cap).map((n) => n.habitat));
}

/** §5 trigger: absorbed/nodes ≥ threshold → The Chorus rises. */
export function hiveTrigger(galaxy: Galaxy, st: HiveState, near: Habitat | null = null): boolean {
    if (st.faction !== null) return true;
    const race = majorityNodeRace(st) ?? st.nodes[0]?.habitat.population?.dominantRace?.name ?? null;
    if (race === null) return false;
    const faction = createThreatFaction(galaxy, {
        race,
        name: scenarioText(`${TAG} Faction Name`),
        governmentId: HIVE_MIND_GOVERNMENT,
        enemies: threatEmpires(galaxy),
    });
    if (faction === null) return false;
    st.faction = faction;
    st.navy = newNavyState();
    navyRise(galaxy, 'hive', faction, st.navy, averageMilitary(galaxy, faction)); // tech, money, the starting navy (the empires' average military)
    const seized = seizedIndependentNodes(galaxy, st, near);
    for (const n of [...st.nodes].sort((a, b) => galaxy.habitats.indexOf(a.habitat) - galaxy.habitats.indexOf(b.habitat))) {
        const h = n.habitat;
        if (h.hasBeenDestroyed) continue;
        if (h.empire === galaxy.independentEmpire) {
            // §4 hiveMaxNodesSeized: at most that many still-independent nodes seized outright; the rest stay
            // independent (still tracked in st.nodes for later reinfection if absorbed after this).
            if (seized.has(h)) takeOwnershipOfColonyFull(galaxy, galaxy.independentEmpire!, h, faction, false, false);
        } else if (st.absorbed.includes(h) && h.empire !== null && h.empire !== faction) {
            const nodeRace = h.population?.dominantRace ?? null;
            const strength = Math.trunc((nodeRace?.troopStrength ?? 60) * P.militiaFactor(galaxy));
            const troop = makeFactionTroop(galaxy, faction, strength, scenarioText(`${TAG} Militia Name`), nodeRace);
            takeMiningStationsNear(galaxy, 'hive', faction, st.navy, h.empire, h); // the host's stations nearest the node change hands
            const host = h.empire;
            invadeFromInside(galaxy, h, faction, [troop]);
            if (P.risingOverkill(galaxy) > 0) {
                const extra = risingShortfall(galaxy, h, host, faction, P.risingOverkill(galaxy), P.risingMaxStrength(galaxy));
                if (extra > 0) invadeFromInside(galaxy, h, faction, makeTroopsOfStrength(galaxy, faction, extra, scenarioText(`${TAG} Militia Name`), nodeRace));
            }
        }
    }
    topUpPorts(galaxy, 'hive', faction, st.navy);
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Turn', textTag: `${TAG} Turn News` });
    for (const e of threatEmpires(galaxy, faction)) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Turn', type: EmpireMessageType.GeneralBadEvent });
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
    st.navy ??= newNavyState();
    topUpGarrisons(galaxy, 'hive', st.faction, st.navy, scenarioText(`${TAG} Militia Name`), colony); // a newly held world starts at the full garrison
}

// ---------------------------------------------------------------------------------------------------------------
// The faction's economy and navy (factionNavy.ts)
// ---------------------------------------------------------------------------------------------------------------

/** Monthly: income floor, ports on its biggest worlds, and the starting ships once it holds a world. */
export function hiveNavyMonthly(galaxy: Galaxy): void {
    const st = peekHiveState(galaxy);
    const faction = st?.faction ?? null;
    if (st === null || faction === null || !faction.active || st.ended) return;
    st.navy ??= newNavyState();
    applyIncomeFloor(galaxy, 'hive', faction, st.navy);
    topUpPorts(galaxy, 'hive', faction, st.navy);
    spawnPendingNavy(galaxy, faction, st.navy);
    foundMiningStations(galaxy, 'hive', faction, st.navy);
    pumpNavy(galaxy, 'hive', faction, st.navy); // the navy's floor: bought outright while it is below its target
    ensureConstructionShips(galaxy, 'hive', faction);
    topUpGarrisons(galaxy, 'hive', faction, st.navy, scenarioText(`${TAG} Militia Name`)); // every held world kept at hiveGarrison, free upkeep
}

/** Every 5 days: fleets defend a world under attack, and go on the offensive when none is. */
export function hiveFleets(galaxy: Galaxy): void {
    const st = peekHiveState(galaxy);
    const faction = st?.faction ?? null;
    if (st === null || faction === null || !faction.active || st.ended) return;
    st.navy ??= newNavyState();
    directFleets(galaxy, 'hive', faction, st.navy);
}

/** Yearly: research re-synced to the galaxy average (never above), designs refreshed. */
export function hiveNavyYearly(galaxy: Galaxy): void {
    const st = peekHiveState(galaxy);
    const faction = st?.faction ?? null;
    if (st === null || faction === null || !faction.active || st.ended) return;
    syncFactionTech(galaxy, faction);
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
    if (player !== null) threatGameEnd(galaxy, player, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), HIVE_CODE_CONTAINED, true);
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
        out.push({ threat: HIVE_KEY, kind: 'colony', target: n.habitat, level, site: n, label: scenarioText(level >= KNOWLEDGE_CONFIRMED ? `${TAG} Node Confirmed Row` : `${TAG} Node Suspected Row`) });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const HIVE_HANDLER_IDS = ['hive.init', 'hive.periodic', 'hive.colony', 'hive.factionColony', 'hive.navy', 'hive.navyYearly', 'hive.navyTroops', 'hive.conquestFleet', 'hive.fleets'] as const;

/** Colonies of the empires whose dominant race is no empire's (active or not, pirates and independents aside): natives taken from the independents. Habitat order. Pure. */
export function formerIndependentGuess(galaxy: Galaxy): Habitat[] {
    const races = new Set<unknown>();
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) if (e.dominantRace !== null) races.add(e.dominantRace);
    const out: Habitat[] = [];
    for (const h of galaxy.habitats) {
        const owner = h.empire;
        if (h.hasBeenDestroyed || owner === null || owner === galaxy.independentEmpire || owner.pirateEmpireBaseHabitat !== null) continue;
        const race = h.population?.dominantRace ?? null;
        if (race !== null && !races.has(race) && h.population.totalAmount > 0) out.push(h);
    }
    return out;
}

/** Game Editor: null when the Chorus can be raised now. Pure. */
export function hiveSpawnNote(galaxy: Galaxy): string | null {
    const st = peekHiveState(galaxy);
    if (st !== null && (st.faction !== null || st.ended)) return st.ended ? 'Already over' : 'Already risen';
    return (st !== null && st.nodes.length > 0) || galaxy.independentColonies.length > 0 ? null : 'No independent colonies';
}

/** Game Editor: the Chorus declares now: every still-independent colony is handed to it (the ones nearest the player first when capped). */
export function hiveSpawnNow(galaxy: Galaxy, victim: Empire): boolean {
    const st = hiveState(galaxy);
    if (st.nodes.length === 0 && st.tracked !== true) {
        st.nodes = [...galaxy.independentColonies].map((habitat) => ({ habitat, knowledge: [] }));
        // No record (the add-on was not on from the start): the colonies that went to an empire from the independents are guessed from
        // their people: a dominant race that no empire has ever had (the settling of an older start gives a colony the empire's own race,
        // so only the ones absorbed in play, with their natives, can be recognised this way).
        for (const habitat of formerIndependentGuess(galaxy)) {
            st.nodes.push({ habitat, knowledge: [] });
            st.absorbed.push(habitat);
        }
    }
    if (st.nodes.length === 0) return false;
    return hiveTrigger(galaxy, st, nearestToEmpire(galaxy, victim, st.nodes.map((n) => n.habitat)));
}

export function registerHive(): void {
    registerThreatExistence(HIVE_KEY, HIVE_FLAG);
    registerGuardianPeace(HIVE_KEY, HIVE_FLAG, (g) => [peekHiveState(g)?.faction]); // the Ancient Guardians and this threat never fight
    registerThreatSpawn({ key: HIVE_KEY, label: 'The Hive', group: 'galactic', addons: ['hive'], note: hiveSpawnNote, spawn: hiveSpawnNow });
    registerScenarioGameStart({ id: 'hive.init', flag: HIVE_FLAG, run: (g, ctx) => hiveInit(g, ctx) });
    registerScenarioPeriodic({ id: 'hive.periodic', flag: HIVE_FLAG, order: 10, periodDays: PERIOD_DAYS, run: hivePeriodic });
    registerScenarioEvent({ id: 'hive.colony', flag: HIVE_FLAG, order: 0, event: 'colonyOwnerChanged', run: (g, e) => onColonyOwnerChanged(g, e.colony, e.from, e.to) });
    registerScenarioEvent({ id: 'hive.factionColony', flag: HIVE_FLAG, order: 10, event: 'colonyOwnerChanged', run: (g, e) => onFactionColonyOwnerChanged(g, e.colony, e.from, e.to) });
    registerScenarioYearly({ id: 'hive.navyYearly', flag: HIVE_FLAG, order: 11, run: (g) => hiveNavyYearly(g) });
    registerScenarioPeriodic({ id: 'hive.navy', flag: HIVE_FLAG, order: 11, periodDays: 30, run: (g) => hiveNavyMonthly(g) });
    registerScenarioPeriodic({ id: 'hive.fleets', flag: HIVE_FLAG, order: 12, periodDays: 5, run: (g) => hiveFleets(g) });
    registerScenarioQuery({ id: 'hive.navyTroops', flag: HIVE_FLAG, query: 'troopMaintenanceFactor', run: (g, v, a) => (peekHiveState(g)?.faction === a.empire ? 0 : v) });
    registerScenarioQuery({ id: 'hive.conquestFleet', flag: HIVE_FLAG, query: 'conquestWarshipLimit', run: (g, v, a) => capturedFleetLimit(g, 'hive', a.conqueror, peekHiveState(g)?.faction ?? null, v) });
    registerThreatKnownSites(HIVE_KEY, hiveKnownSites);
}

registerHive();
