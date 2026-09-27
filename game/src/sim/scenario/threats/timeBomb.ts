// 19f #6 Time-bomb tech (tasks/19f-hidden-threats.md §6, framework tasks/19b-dark-farms.md §5.A /
// src/sim/scenario/threats/framework.ts). Not a port: new scenario behaviour composed of ported functions (each
// composed step cites its C# analogue). Registered from scenario/packages.ts; every handler is gated by the
// `threatTimeBomb` flag, so with the flag off (or no scenario) nothing here runs and nothing draws.
//
// Arc (Cult-driven since 19f §6 rev. 2): three precursor research nodes (scenarios/timebomb/research.txt) are seeded on
// ruin-less habitats as ruins (selectRuinsUnlockTech, as stock precursor-tech ruins are). Any empire that researches one
// (through the ruin or the stock tech trade / theft) is a "holder". The tech is only a weapon in the Cult's hands
// (scenarios/cult, threats/cult.ts; the timebomb scenario includes it and this module is inert until the `cult` flag is
// on): a detonation can only happen on a colony with a cult CELL (a converted governor, or >= 1 converted character
// present there) whose empire — or, after secession, the cult faction — holds >= 1 node. Yearly per such colony:
//     perMille = min(timeBombChancePerMillePerColony x nodesHeld x cellStrength, timeBombMaxChancePct x 10)
// with cellStrength = converted characters at the colony (a converted governor counts twice) and nodesHeld = the
// owner's held nodes (max'd with the cult faction's once it exists). While the cult faction is at war with the owner
// and holds >= 1 node, the chance is at least timeBombCultWarChancePct (a deliberate detonation). The cult faction
// inherits the nodes of the empires it seceded from (cultHooks.triggered); abandonTech never touches its nodes.
// Detonation = the explosion set-up of destroyHabitat (combat/damage.ts 1629) without the attacker-credit block.
// Counterplay (19m, flag internalSecurity): a cell on a holder colony opens a 'cultBomb' lead (suspected at once,
// confirmed when a roll first fails or by a counter-intelligence sweep); a purge on it, or an investigation that
// confirms it, turns the converts there (cult.ts deconvert) and defuses the cell.
//
// Rnd (§0.4): draws only in timeBombYearly (placement + the detonation rolls; a roll only for a colony whose chance is
// > 0) and the stock functions it calls (selectRuinsUnlockTech, the explosion image). Fixed iteration orders:
// galaxy.habitats index order for ruin candidates, galaxy.empires then empire.colonies order for cells and rolls.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { TechNode } from '../../researchSystem';
import { Explosion } from '../../combat/damage';
import { toShort } from '../../builtObjectComponent';
import { galaxyNow, galaxyStarDate } from '../../tick/simTime';
import { selectRuinsUnlockTech } from '../../ruins';
import { reviewDesignsBuiltObjectsImprovedComponents } from '../../researchTick';
import { CharacterRole, getEmpireCharacters } from '../../characters';
import { IntelligenceMissionType, cancelIntelligenceMission, characterMission, newCounterIntelligenceMission } from '../../espionage';
import { EmpireMessageType } from '../../messages';
import { gameYear, registerScenarioEvent, registerScenarioYearly } from '../hooks';
import { scenarioFlag, scenarioParam } from '../state';
import { scenarioText } from '../messages';
import {
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_SUSPECTED,
    arcMessage,
    arcNews,
    atWar,
    knowledgeLevel,
    normalEmpires,
    peekThreatState,
    revealTo,
    threatGameEnd,
    threatState,
    type SentStages,
    type ThreatKnowledge,
} from './framework';
import { CULT_FLAG, convertsAt, cultHooks, deconvert, peekCultState, type CultState } from './cult';
import { registerHiddenThing, retireHiddenTarget, securityOn, securitySlots } from '../security/registry';
import { recordReputation } from '../reputation/ledger';
import { appendEvent, empireActor, eventLogOn } from '../eventLog/log';
import { YEAR_LENGTH, startStarDateForAge } from '../../galaxyTime';
import { GameEndOutcome } from '../../victory';

export const TIME_BOMB_KEY = 'timeBomb';
export const TIME_BOMB_FLAG = 'threatTimeBomb';
const TAG = 'TimeBomb';
/** Game-end codes (19f table: 1911 Grey Tide … 1920 Corporate Coup; defeat = code, victory/containment = code + 100). */
export const TIME_BOMB_CODE_DEFEAT = 1916;
export const TIME_BOMB_CODE_CONTAINED = 2016;
/** 19m concealment of a cult bomb cell (CounterEspionageFactored scale 25–100; a convert is 50). */
const CELL_CONCEALMENT = 60;

/** research.txt overlay project ids (scenarios/timebomb/research.txt): fixed, one past the stock file's highest (371). */
export const TIME_BOMB_PROJECT_IDS = [372, 373, 374] as const;

/** A cult cell at a colony (a ThreatSite: its knowledge list is mirrored into the 19m 'cultBomb' lead). */
export interface CultCell {
    colony: Habitat;
    knowledge: ThreatKnowledge[];
    /** Star date the cell was first seen. */
    since: number;
    /** A detonation roll failed here once (the owner's lead is confirmed then). */
    failedOnce: boolean;
    /** Registered as a 19m hidden thing (on a holder colony). */
    registered: boolean;
    /** 'dead' once dissolved / defused / detonated (the 19m registry's liveness marker). */
    state?: string;
}

export interface TimeBombState {
    /** The three precursor project ids actually placed this game (subset of TIME_BOMB_PROJECT_IDS if some are missing from research.txt). */
    nodes: number[];
    placed: boolean;
    /** empireId -> project ids that empire currently has isResearched. */
    holders: Record<number, number[]>;
    destroyed: Habitat[];
    /** Detonations of a holder colony an empire's scientists have observed (for level-3 discovery). */
    analysed: Record<number, number>;
    knowledge: Record<number, number>;
    /** Colonies lost to a detonation, by the empire that lost them (for the AI's "abandon after losing one" rule). */
    lossesByEmpire: Record<number, number>;
    sentStages: SentStages;
    ended: boolean;
    /** Live cult cells (galaxy.empires then colony order of discovery). */
    cells?: CultCell[];
    /** Empire ids the cult seceded from (cultHooks.triggered). */
    cultHosts?: number[];
    /** Node ids the cult faction holds (inherited from its hosts; never abandoned). */
    cultNodes?: number[];
    /** AI empire id -> star date until which it prioritises counter-intelligence (after a detonation loss). */
    counterIntelUntil?: Record<number, number>;
    /** Cells defused (a running count, for message keys). */
    defused?: number;
    /** How the arc ended ('' while running). */
    outcome?: '' | 'defeat' | 'contained';
}

function newState(): TimeBombState {
    return { nodes: [], placed: false, holders: {}, destroyed: [], analysed: {}, knowledge: {}, lossesByEmpire: {}, sentStages: {}, ended: false, cells: [], cultHosts: [], cultNodes: [], counterIntelUntil: {}, defused: 0, outcome: '' };
}

export function timeBombState(galaxy: Galaxy): TimeBombState {
    return threatState(galaxy, TIME_BOMB_KEY, newState);
}

export function peekTimeBombState(galaxy: Galaxy): TimeBombState | null {
    return peekThreatState<TimeBombState>(galaxy, TIME_BOMB_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}

const P = {
    ruins: (g: Galaxy) => Math.trunc(p(g, 'timeBombRuins', 3)),
    chancePerMille: (g: Galaxy) => p(g, 'timeBombChancePerMillePerColony', 2),
    maxChancePct: (g: Galaxy) => p(g, 'timeBombMaxChancePct', 5),
    cultWarChancePct: (g: Galaxy) => p(g, 'timeBombCultWarChancePct', 10),
    counterIntelYears: (g: Galaxy) => p(g, 'timeBombCounterIntelYears', 1),
    grievance: (g: Galaxy) => p(g, 'timeBombDetonationGrievance', 30),
    startYear: (g: Galaxy) => Math.trunc(p(g, 'timeBombStartYear', 30)),
    defeatDestroyed: (g: Galaxy) => Math.trunc(p(g, 'timeBombDefeatDestroyed', 5)),
};

// ---------------------------------------------------------------------------------------------------------------
// Placement (once, at/after timeBombStartYear)
// ---------------------------------------------------------------------------------------------------------------

/** Ruin-less, not-yet-destroyed habitats in galaxy.habitats index order (the fixed iteration order, §0.4). */
export function ruinlessHabitats(galaxy: Galaxy): Habitat[] {
    return galaxy.habitats.filter((h) => h !== null && h.ruin === null && !h.hasBeenDestroyed);
}

/**
 * Places the precursor ruins (§6 "Placement at start"): one Next(0, candidates.length) draw per node, on distinct
 * ruin-less habitats, via selectRuinsUnlockTech(galaxy, habitat, projectId) — the same path stock precursor-ruin
 * research uses (ruins.ts 492; Start.2.cs 1274-1304 placeRuinsUnlockTech). Runs once (state.placed).
 */
export function timeBombPlace(galaxy: Galaxy, st: TimeBombState): void {
    if (st.placed) return;
    st.placed = true;
    const want = Math.min(P.ruins(galaxy), TIME_BOMB_PROJECT_IDS.length);
    const candidates = [...ruinlessHabitats(galaxy)];
    for (let i = 0; i < want; i++) {
        if (candidates.length === 0) break;
        const idx = galaxy.rnd.next(0, candidates.length);
        const habitat = candidates.splice(idx, 1)[0];
        const projectId = TIME_BOMB_PROJECT_IDS[i];
        if (selectRuinsUnlockTech(galaxy, habitat, projectId)) st.nodes.push(projectId);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Holders (researchCompleted event) and the cult faction's inherited nodes
// ---------------------------------------------------------------------------------------------------------------

function onResearchCompleted(galaxy: Galaxy, empire: Empire, project: unknown): void {
    const st = peekTimeBombState(galaxy);
    if (st === null) return;
    const node = project as TechNode | null;
    const projectId = node?.def?.projectId;
    if (projectId === undefined || !st.nodes.includes(projectId)) return;
    const held = (st.holders[empire.empireId] ??= []);
    if (!held.includes(projectId)) held.push(projectId);
}

/** Node ids `empire` currently has isResearched (recomputed from its own tech tree, holders is only used to seed the roll). */
function currentlyHeld(empire: Empire, st: TimeBombState): number[] {
    return st.nodes.filter((id) => empire.research.techTree.some((n) => n.def.projectId === id && n.isResearched));
}

/** The cult faction while it is alive (null before secession / after its teardown). */
function liveCultFaction(cst: CultState | null): Empire | null {
    const f = cst?.faction ?? null;
    return f !== null && f.active ? f : null;
}

/** The empires the cult preys on: normal empires other than the cult faction (galaxy.empires order). */
function victims(galaxy: Galaxy, cst: CultState | null): Empire[] {
    return normalEmpires(galaxy, cst?.faction ?? null);
}

/** Node ids the cult faction holds (0 before secession). */
export function cultNodesHeld(galaxy: Galaxy): number[] {
    const st = peekTimeBombState(galaxy);
    if (st === null || liveCultFaction(peekCultState(galaxy)) === null) return [];
    return st.cultNodes ?? [];
}

/**
 * The cult faction inherits the nodes every empire it seceded from currently holds (never loses them: abandonTech
 * does not apply to it). The faction's own tech-tree entries are flipped isResearched with the stock recalculation
 * (researchTick.ts 640 doResearchBreakthrough's end-of-function calls, as abandonTech runs in reverse).
 */
function syncCultNodes(galaxy: Galaxy, st: TimeBombState, cst: CultState | null): void {
    const faction = liveCultFaction(cst);
    if (faction === null) return;
    const nodes = (st.cultNodes ??= []);
    const before = nodes.length;
    for (const hostId of st.cultHosts ?? []) {
        const host = galaxy.empires.find((e) => e !== null && e.empireId === hostId) ?? null;
        if (host === null || host === faction) continue;
        for (const id of currentlyHeld(host, st)) if (!nodes.includes(id)) nodes.push(id);
    }
    if (nodes.length === before) return;
    nodes.sort((a, b) => a - b);
    let changed = false;
    for (const id of nodes) {
        const node = faction.research.techTree.find((n) => n.def.projectId === id);
        if (node !== undefined && !node.isResearched) {
            node.isResearched = true;
            changed = true;
        }
    }
    if (changed) {
        faction.research.update(faction.dominantRace);
        faction.reviewResearchAbilities();
        reviewDesignsBuiltObjectsImprovedComponents(faction);
    }
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Cult Inherits', args: [faction.name] });
}

/** cultHooks.triggered: the cult seceded from `host` — record it and inherit its nodes now. No Rnd. */
function onCultTriggered(galaxy: Galaxy, host: Empire, faction: Empire): void {
    void faction;
    if (!scenarioFlag(galaxy, TIME_BOMB_FLAG)) return;
    const st = peekTimeBombState(galaxy);
    if (st === null) return;
    const hosts = (st.cultHosts ??= []);
    if (!hosts.includes(host.empireId)) hosts.push(host.empireId);
    syncCultNodes(galaxy, st, peekCultState(galaxy));
}

// ---------------------------------------------------------------------------------------------------------------
// Cult cells
// ---------------------------------------------------------------------------------------------------------------

function colonyGovernorConverted(cst: CultState, colony: Habitat): boolean {
    const e = colony.empire;
    if (e === null) return false;
    const gov = getEmpireCharacters(e).find((c) => c.active && c.role === CharacterRole.ColonyGovernor && c.location === colony);
    return gov !== undefined && cst.converted.some((r) => r.character === gov);
}

/** Cell strength at `colony`: converted characters present (cult.ts convertsAt), a converted governor counting twice. Pure. */
export function cellStrength(cst: CultState | null, colony: Habitat): number {
    if (cst === null) return 0;
    const n = convertsAt(cst, colony).length;
    return n === 0 ? 0 : n + (colonyGovernorConverted(cst, colony) ? 1 : 0);
}

/** Nodes that arm a cell at `colony` of `owner`: the owner's held nodes, max'd with the live cult faction's. Pure. */
function armingNodes(st: TimeBombState, cst: CultState | null, owner: Empire): number {
    const own = currentlyHeld(owner, st).length;
    return liveCultFaction(cst) !== null ? Math.max(own, (st.cultNodes ?? []).length) : own;
}

/** True when the live cult faction may detonate at `owner`'s colonies on purpose (at war, >= 1 node). Pure. */
function warEligible(st: TimeBombState, cst: CultState | null, owner: Empire): boolean {
    const f = liveCultFaction(cst);
    return f !== null && (st.cultNodes ?? []).length > 0 && atWar(f, owner);
}

/**
 * The yearly detonation chance (per mille) at `colony`: 0 without a cell or without an armed holder; otherwise
 * min(chancePerMille x nodes x strength, maxChancePct x 10), raised to cultWarChancePct x 10 while the cult faction is
 * at war with the owner and holds a node. Pure.
 */
export function detonationChancePerMille(galaxy: Galaxy, colony: Habitat): number {
    const st = peekTimeBombState(galaxy);
    const cst = peekCultState(galaxy);
    const owner = colony.empire;
    if (st === null || owner === null || colony.hasBeenDestroyed) return 0;
    const strength = cellStrength(cst, colony);
    if (strength <= 0) return 0;
    const nodes = armingNodes(st, cst, owner);
    let chance = nodes > 0 ? Math.min(P.chancePerMille(galaxy) * nodes * strength, P.maxChancePct(galaxy) * 10) : 0;
    if (warEligible(st, cst, owner)) chance = Math.max(chance, P.cultWarChancePct(galaxy) * 10);
    return chance;
}

function habitatId(galaxy: Galaxy, h: Habitat): number {
    return galaxy.habitats.indexOf(h);
}

/** Forms / dissolves cells from the cult's conversion state; opens the owner's 19m lead on a holder colony. No Rnd. */
function syncCells(galaxy: Galaxy, st: TimeBombState, cst: CultState | null): void {
    const cells = (st.cells ??= []);
    // Dissolve: no converts left, colony gone, or it now belongs to the cult / nobody.
    const vs = victims(galaxy, cst);
    for (const cell of [...cells]) {
        const h = cell.colony;
        if (!h.hasBeenDestroyed && h.empire !== null && vs.includes(h.empire) && cellStrength(cst, h) > 0) continue;
        dropCell(galaxy, st, cell, 'gone');
    }
    if (cst === null) return;
    for (const e of vs) {
        for (const colony of e.colonies) {
            if (colony.hasBeenDestroyed || cellStrength(cst, colony) <= 0) continue;
            let cell = cells.find((c) => c.colony === colony);
            if (cell === undefined) {
                cell = { colony, knowledge: [], since: galaxyStarDate(galaxy), failedOnce: false, registered: false };
                cells.push(cell);
                logHidden(galaxy, e, colony, `${TAG} Cell Formed`, [colony.name]);
            }
            if (cell.registered || armingNodes(st, cst, e) <= 0 || !securityOn(galaxy)) continue;
            cell.registered = true;
            registerHiddenThing(galaxy, { kind: 'cultBomb', concealment: CELL_CONCEALMENT, empire: e, target: colony, package: '19f.timeBomb', site: cell });
            if (revealTo(galaxy, cell, e, KNOWLEDGE_SUSPECTED)) {
                arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Cell Suspected', onceKey: `Cell Suspected:${habitatId(galaxy, colony)}:${cell.since}`, args: [colony.name], type: EmpireMessageType.GeneralWarning, subject: colony });
            }
        }
    }
}

function dropCell(galaxy: Galaxy, st: TimeBombState, cell: CultCell, outcome: string): void {
    const cells = st.cells ?? [];
    const i = cells.indexOf(cell);
    if (i >= 0) cells.splice(i, 1);
    cell.state = 'dead';
    retireHiddenTarget(galaxy, 'cultBomb', cell.colony, outcome); // 19m (flag-gated)
}

/** An event-log entry nobody has seen yet (cell formation: the owner reads it only through the suspected lead). */
function logHidden(galaxy: Galaxy, owner: Empire, h: Habitat, textKey: string, args: (string | number)[]): void {
    if (!eventLogOn(galaxy)) return;
    appendEvent(galaxy, {
        category: 'threat',
        importance: 1,
        actors: [empireActor(galaxy, owner)],
        seenBy: [],
        place: { habitat: h.habitatIndex, system: h.systemIndex, x: Math.round(h.xpos), y: Math.round(h.ypos) },
        textKey,
        args,
        textFormat: 'scenario',
        data: { hidden: true },
        source: 'timebomb',
    });
}

/**
 * Counterplay (19m slot cultBombResolved; also callable directly): every converted character at `colony` loses its
 * cult status (cult.ts deconvert) and the cell is defused. Returns the number of characters turned. No Rnd.
 */
export function defuseCell(galaxy: Galaxy, empire: Empire, colony: Habitat, how: 'purge' | 'investigation'): number {
    const cst = peekCultState(galaxy);
    let turned = 0;
    if (cst !== null) for (const c of convertsAt(cst, colony)) if (deconvert(galaxy, cst, c, how === 'purge' ? 'purged' : 'investigated')) turned++;
    const st = peekTimeBombState(galaxy);
    if (st === null) return turned;
    const cell = (st.cells ?? []).find((c) => c.colony === colony);
    if (cell !== undefined) dropCell(galaxy, st, cell, 'defused');
    st.defused = (st.defused ?? 0) + 1;
    arcMessage(galaxy, st.sentStages, [empire], { prefix: TAG, stage: 'Defused', onceKey: `Defused:${st.defused}`, args: [colony.name, turned], type: EmpireMessageType.GeneralGoodEvent, subject: colony });
    return turned;
}

/**
 * True while the cult is undefeated for the Time Bomb's defeat condition: its faction alive, or >= 1 cell (computed
 * from the cult's conversion state, so a cell that just detonated does not count but every other one does). Pure.
 */
export function cultUndefeated(galaxy: Galaxy): boolean {
    const cst = peekCultState(galaxy);
    if (cst === null) return false;
    if (liveCultFaction(cst) !== null) return true;
    return victims(galaxy, cst).some((e) => e.colonies.some((h) => !h.hasBeenDestroyed && cellStrength(cst, h) > 0));
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly: placement + cells + detonation rolls
// ---------------------------------------------------------------------------------------------------------------

/** BuiltObject.1.cs 3490 DestroyHabitat's explosion set-up, without the attacker-credit block (no attacking ship here). */
function detonateHabitat(galaxy: Galaxy, habitat: Habitat): void {
    const explosion = new Explosion();
    explosion.explosionStart = galaxyNow(galaxy);
    explosion.explosionSize = toShort(Math.trunc(habitat.diameter * 4.0));
    explosion.explosionProgression = 0;
    explosion.explosionOffsetX = 0;
    explosion.explosionOffsetY = 0;
    explosion.explosionImageIndex = toShort(galaxy.rnd.next(0, 10));
    explosion.explosionWillDestroy = true;
    habitat.explosion = explosion;
    habitat.hasBeenDestroyed = true;
}

function systemName(galaxy: Galaxy, h: Habitat): string {
    return galaxy.determineHabitatSystemStar(h).name;
}

export function timeBombYearly(galaxy: Galaxy, year: number): void {
    if (!scenarioFlag(galaxy, CULT_FLAG)) return; // inert without the Cult (its actor): no state, no draws
    const st = timeBombState(galaxy);
    if (st.ended) return;
    if (!st.placed) {
        const startYear = gameYear(startStarDateForAge(galaxy.age));
        if (year >= startYear + P.startYear(galaxy)) timeBombPlace(galaxy, st);
    }
    const cst = peekCultState(galaxy);
    syncCultNodes(galaxy, st, cst);
    syncCells(galaxy, st, cst);
    for (const empire of victims(galaxy, cst)) {
        for (const colony of empire.colonies) {
            if (colony.hasBeenDestroyed || colony.population.totalAmount <= 0) continue;
            const cell = (st.cells ?? []).find((c) => c.colony === colony);
            if (cell === undefined) continue;
            const chance = detonationChancePerMille(galaxy, colony);
            if (chance <= 0) continue;
            const war = warEligible(st, cst, empire);
            // RND(19f-6): detonation roll
            if (galaxy.rnd.next(0, 1000) < chance) {
                detonate(galaxy, st, colony, empire, war ? 'war' : 'terror');
                break; // one detonation per empire per year keeps this readable / testable; the roll repeats next year.
            }
            if (!cell.failedOnce) {
                cell.failedOnce = true;
                if (cell.registered && revealTo(galaxy, cell, empire, KNOWLEDGE_CONFIRMED)) {
                    arcMessage(galaxy, st.sentStages, [empire], { prefix: TAG, stage: 'Cell Confirmed', onceKey: `Cell Confirmed:${habitatId(galaxy, colony)}:${cell.since}`, args: [colony.name], type: EmpireMessageType.GeneralWarning, subject: colony });
                }
            }
        }
    }
    aiCounterIntelligence(galaxy, st);
    aiAbandon(galaxy, st);
    endCheck(galaxy, st);
}

/**
 * Destroys `habitat` (the explosion set-up of DestroyHabitat). `by` = the cult's act ('terror' a cell's roll, 'war' the
 * faction's deliberate detonation); undefined = an unattributed call (tests). A cult detonation adds the victim's
 * grievance against the cult faction (19o ledger, flag-gated) and the AI's counter-intelligence year.
 */
export function detonate(galaxy: Galaxy, st: TimeBombState, habitat: Habitat, empire: Empire, by?: 'terror' | 'war'): void {
    detonateHabitat(galaxy, habitat);
    st.destroyed.push(habitat);
    st.lossesByEmpire[empire.empireId] = (st.lossesByEmpire[empire.empireId] ?? 0) + 1;
    const cell = (st.cells ?? []).find((c) => c.colony === habitat);
    if (cell !== undefined) dropCell(galaxy, st, cell, 'detonated');
    if (by !== undefined) {
        (st.counterIntelUntil ??= {})[empire.empireId] = galaxyStarDate(galaxy) + P.counterIntelYears(galaxy) * YEAR_LENGTH;
        const faction = liveCultFaction(peekCultState(galaxy));
        if (faction !== null) recordReputation(galaxy, empire, faction, { cause: 'timeBomb.cultDetonation', value: -P.grievance(galaxy), source: '19f' });
    }
    for (const e of normalEmpires(galaxy)) {
        if (e === empire) continue;
        const scientists = getEmpireCharacters(e).filter((c) => c.role === CharacterRole.Scientist && c.active).length;
        if (scientists === 0) continue;
        st.analysed[e.empireId] = (st.analysed[e.empireId] ?? 0) + 1;
        const level = st.analysed[e.empireId] >= 2 ? 3 : Math.max(st.knowledge[e.empireId] ?? 0, 2);
        if (level > (st.knowledge[e.empireId] ?? 0)) {
            st.knowledge[e.empireId] = level;
            if (level >= 3) arcMessage(galaxy, st.sentStages, [e], { prefix: TAG, stage: 'Confirmed', onceKey: `Confirmed:${e.empireId}` });
        }
    }
    if ((st.knowledge[empire.empireId] ?? 0) < 1) {
        st.knowledge[empire.empireId] = 1;
        arcMessage(galaxy, st.sentStages, [empire], { prefix: TAG, stage: 'Hint', onceKey: `Hint:${empire.empireId}` });
    }
    arcMessage(galaxy, st.sentStages, [empire], { prefix: TAG, stage: 'Detonation', onceKey: `Detonation:${galaxy.habitats.indexOf(habitat)}`, args: [habitat.name], subject: habitat });
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Detonation', onceKey: `Detonation News:${galaxy.habitats.indexOf(habitat)}`, textTag: by === 'war' ? `${TAG} War Detonation News` : `${TAG} Detonation News`, args: [habitat.name, systemName(galaxy, habitat)], subject: habitat });
}

// ---------------------------------------------------------------------------------------------------------------
// Counterplay: abandon; AI counter-intelligence year
// ---------------------------------------------------------------------------------------------------------------

/**
 * Player / AI order: `empire` stops using the precursor tech — its held nodes' isResearched flips false and every
 * stock recalculation the game itself runs after a research change re-runs (researchTick.ts 640 doResearchBreakthrough's
 * own end-of-function calls): research.update(race), empire.reviewResearchAbilities() (recomputes construction-size /
 * troop / colonisation abilities), reviewDesignsBuiltObjectsImprovedComponents(empire) (re-applies to existing designs
 * / ships). The cult faction cannot abandon (its nodes are the cult's weapon). No Rnd.
 */
export function abandonTech(galaxy: Galaxy, empire: Empire): boolean {
    const st = peekTimeBombState(galaxy);
    if (st === null) return false;
    if (empire === peekCultState(galaxy)?.faction) return false;
    const held = currentlyHeld(empire, st);
    if (held.length === 0) return false;
    for (const id of held) {
        const node = empire.research.techTree.find((n) => n.def.projectId === id);
        if (node !== undefined) node.isResearched = false;
    }
    empire.research.update(empire.dominantRace);
    empire.reviewResearchAbilities();
    reviewDesignsBuiltObjectsImprovedComponents(empire);
    delete st.holders[empire.empireId];
    arcMessage(galaxy, st.sentStages, [empire], { prefix: TAG, stage: 'Abandoned', onceKey: `Abandoned:${empire.empireId}`, args: [empire.name] });
    endCheck(galaxy, st);
    return true;
}

/** AI rule (§6): an AI empire at knowledge level 3 that has lost >= 1 colony abandons within one year. */
function aiAbandon(galaxy: Galaxy, st: TimeBombState): void {
    for (const e of victims(galaxy, peekCultState(galaxy))) {
        if (e === galaxy.playerEmpire) continue;
        if ((st.knowledge[e.empireId] ?? 0) < 3) continue;
        if ((st.lossesByEmpire[e.empireId] ?? 0) < 1) continue;
        if (currentlyHeld(e, st).length > 0) abandonTech(galaxy, e);
    }
}

function onCounterIntelligence(galaxy: Galaxy, empire: Empire): number {
    void galaxy;
    return getEmpireCharacters(empire).filter((c) => {
        const m = characterMission(c);
        return c.active && c.role === CharacterRole.IntelligenceAgent && m !== null && m.type === IntelligenceMissionType.CounterIntelligence;
    }).length;
}

/**
 * AI rule: for timeBombCounterIntelYears after losing a colony to a cult detonation an AI empire puts every idle agent
 * on counter-intelligence, and if none is on it, recalls its first agent from another mission (espionage.ts
 * cancelIntelligenceMission, the stock cancel) onto it. No Rnd.
 */
function aiCounterIntelligence(galaxy: Galaxy, st: TimeBombState): void {
    const until = st.counterIntelUntil ?? {};
    const now = galaxyStarDate(galaxy);
    for (const e of victims(galaxy, peekCultState(galaxy))) {
        if (e === galaxy.playerEmpire || (until[e.empireId] ?? -1) < now) continue;
        const agents = getEmpireCharacters(e).filter((c) => c.active && c.role === CharacterRole.IntelligenceAgent && c.empire === e);
        for (const a of agents) {
            const m = characterMission(a);
            if (m === null || m.type === IntelligenceMissionType.Undefined) a.mission = newCounterIntelligenceMission(galaxy, e, a);
        }
        if (onCounterIntelligence(galaxy, e) > 0) continue;
        const busy = agents.find((a) => characterMission(a) !== null);
        if (busy === undefined) continue;
        cancelIntelligenceMission(e, characterMission(busy)!);
        busy.mission = newCounterIntelligenceMission(galaxy, e, busy);
    }
}

/** True while `empire` is in its post-detonation counter-intelligence year (tests / UI). Pure. */
export function prioritisesCounterIntelligence(galaxy: Galaxy, empire: Empire): boolean {
    const until = peekTimeBombState(galaxy)?.counterIntelUntil?.[empire.empireId];
    return until !== undefined && galaxyStarDate(galaxy) <= until;
}

// ---------------------------------------------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------------------------------------------

function anyHolderLeft(galaxy: Galaxy, st: TimeBombState): boolean {
    const cst = peekCultState(galaxy);
    if (liveCultFaction(cst) !== null && (st.cultNodes ?? []).length > 0) return true;
    return victims(galaxy, cst).some((e) => currentlyHeld(e, st).length > 0);
}

function contain(galaxy: Galaxy, st: TimeBombState, stage: string, fireGameEnd: boolean): void {
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage });
    if (fireGameEnd && !threatsGameEndOn(galaxy)) return;
    st.ended = true;
    st.outcome = 'contained';
    if (fireGameEnd) threatGameEnd(galaxy, galaxy.playerEmpire, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), TIME_BOMB_CODE_CONTAINED);
}

function endCheck(galaxy: Galaxy, st: TimeBombState): void {
    if (st.ended || !st.placed) return;
    // The cult contained (its own containment path, cult.ts cultEndCheck) ends this arc too; the cult's end already
    // reported the game end (CULT_CODE_CONTAINED), so no second one is raised.
    if (peekCultState(galaxy)?.ended === true) {
        contain(galaxy, st, 'Contained Cult', false);
        return;
    }
    if (st.destroyed.length >= P.defeatDestroyed(galaxy) && cultUndefeated(galaxy)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Defeat', args: [st.destroyed.length] });
        if (threatsGameEndOn(galaxy)) {
            st.ended = true;
            st.outcome = 'defeat';
            threatGameEnd(galaxy, null, GameEndOutcome.Defeat, scenarioText(`${TAG} Defeat Title`), TIME_BOMB_CODE_DEFEAT);
        }
        return;
    }
    if (st.destroyed.length > 0 && !anyHolderLeft(galaxy, st)) contain(galaxy, st, 'Contained', true);
}

function threatsGameEndOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags['threatsGameEnd'] !== false;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const TIME_BOMB_HANDLER_IDS = ['timeBomb.yearly', 'timeBomb.research'] as const;

export function registerTimeBomb(): void {
    registerScenarioYearly({ id: 'timeBomb.yearly', flag: TIME_BOMB_FLAG, order: 10, run: timeBombYearly });
    registerScenarioEvent({ id: 'timeBomb.research', flag: TIME_BOMB_FLAG, event: 'researchCompleted', run: (g, e) => onResearchCompleted(g, e.empire, e.project) });
    cultHooks.triggered = onCultTriggered;
    securitySlots.cultBombResolved = (g, e, h, how) => {
        if (scenarioFlag(g, TIME_BOMB_FLAG)) defuseCell(g, e, h, how);
    };
}

registerTimeBomb();
