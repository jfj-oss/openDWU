// 19f #6 Time-bomb tech (tasks/19f-hidden-threats.md §6, framework tasks/19b-dark-farms.md §5.A /
// src/sim/scenario/threats/framework.ts). Not a port: new scenario behaviour composed of ported functions (each
// composed step cites its C# analogue). Registered from scenario/packages.ts; every handler is gated by the
// `threatTimeBomb` flag, so with the flag off (or no scenario) nothing here runs and nothing draws.
//
// Arc: three precursor research nodes (scenarios/timebomb/research.txt) are seeded on ruin-less habitats as ruins
// (selectRuinsUnlockTech, as stock precursor-tech ruins are). Any empire that researches one (through the ruin or
// through the stock tech trade / theft) is a "holder"; every holder colony has a small yearly chance, scaled by how
// many of the three nodes its empire holds, of a spontaneous total loss — the explosion set-up of destroyHabitat
// (combat/damage.ts 1629) without the attacker-credit block, since there is no attacking ship. No faction: this
// threat has no fight, only a risk a player can walk away from (abandonTech).
//
// Rnd (§0.4): draws only in timeBombYearly (placement + the detonation roll) and the stock functions it calls
// (selectRuinsUnlockTech). Fixed iteration orders: galaxy.habitats index order for ruin candidates, galaxy.empires
// then empire.colonies order for the detonation roll.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { TechNode } from '../../researchSystem';
import { Explosion } from '../../combat/damage';
import { toShort } from '../../builtObjectComponent';
import { galaxyNow } from '../../tick/simTime';
import { selectRuinsUnlockTech } from '../../ruins';
import { reviewDesignsBuiltObjectsImprovedComponents } from '../../researchTick';
import { CharacterRole, getEmpireCharacters } from '../../characters';
import { gameYear, registerScenarioEvent, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { arcMessage, arcNews, normalEmpires, pastThreatMinYear, peekThreatState, registerThreatExistence, threatExists, threatGameEnd, threatState, type SentStages } from './framework';
import { startStarDateForAge } from '../../galaxyTime';
import { GameEndOutcome } from '../../victory';

export const TIME_BOMB_KEY = 'timeBomb';
export const TIME_BOMB_FLAG = 'threatTimeBomb';
const TAG = 'TimeBomb';
/** Game-end codes (19f table: 1911 Grey Tide … 1920 Corporate Coup; defeat = code, victory/containment = code + 100). */
export const TIME_BOMB_CODE_DEFEAT = 1916;
export const TIME_BOMB_CODE_CONTAINED = 2016;

/** research.txt overlay project ids (scenarios/timebomb/research.txt): fixed, one past the stock file's highest (371). */
export const TIME_BOMB_PROJECT_IDS = [372, 373, 374] as const;

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
}

function newState(): TimeBombState {
    return { nodes: [], placed: false, holders: {}, destroyed: [], analysed: {}, knowledge: {}, lossesByEmpire: {}, sentStages: {}, ended: false };
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
// Holders (researchCompleted event)
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

// ---------------------------------------------------------------------------------------------------------------
// Yearly: placement + detonation roll
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
    if (!threatExists(galaxy, TIME_BOMB_KEY)) return; // §0 rarity: not this game — no state, no draws (minimal guard: shared with the reworked branch).
    const st = timeBombState(galaxy);
    if (st.ended) return;
    if (!st.placed) {
        const startYear = gameYear(startStarDateForAge(galaxy.age));
        if (year >= startYear + P.startYear(galaxy) && pastThreatMinYear(galaxy, TIME_BOMB_KEY, year)) timeBombPlace(galaxy, st); // §0 timing floor
    }
    const chance = P.chancePerMille(galaxy);
    for (const empire of normalEmpires(galaxy)) {
        const held = currentlyHeld(empire, st);
        if (held.length === 0) continue;
        for (const colony of empire.colonies) {
            if (colony.hasBeenDestroyed || colony.population.totalAmount <= 0) continue;
            if (galaxy.rnd.next(0, 1000) < chance * held.length) {
                detonate(galaxy, st, colony, empire);
                break; // one detonation per year keeps this readable / testable; the roll repeats next year.
            }
        }
    }
    aiAbandon(galaxy, st);
    endCheck(galaxy, st);
}

export function detonate(galaxy: Galaxy, st: TimeBombState, habitat: Habitat, empire: Empire): void {
    detonateHabitat(galaxy, habitat);
    st.destroyed.push(habitat);
    st.lossesByEmpire[empire.empireId] = (st.lossesByEmpire[empire.empireId] ?? 0) + 1;
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
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Detonation', onceKey: `Detonation News:${galaxy.habitats.indexOf(habitat)}`, textTag: `${TAG} Detonation News`, args: [habitat.name, systemName(galaxy, habitat)], subject: habitat });
}

// ---------------------------------------------------------------------------------------------------------------
// Counterplay: abandon
// ---------------------------------------------------------------------------------------------------------------

/**
 * Player / AI order: `empire` stops using the precursor tech — its held nodes' isResearched flips false and every
 * stock recalculation the game itself runs after a research change re-runs (researchTick.ts 640 doResearchBreakthrough's
 * own end-of-function calls): research.update(race), empire.reviewResearchAbilities() (recomputes construction-size /
 * troop / colonisation abilities), reviewDesignsBuiltObjectsImprovedComponents(empire) (re-applies to existing designs
 * / ships). No Rnd.
 */
export function abandonTech(galaxy: Galaxy, empire: Empire): boolean {
    const st = peekTimeBombState(galaxy);
    if (st === null) return false;
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
    for (const e of normalEmpires(galaxy)) {
        if (e === galaxy.playerEmpire) continue;
        if ((st.knowledge[e.empireId] ?? 0) < 3) continue;
        if ((st.lossesByEmpire[e.empireId] ?? 0) < 1) continue;
        if (currentlyHeld(e, st).length > 0) abandonTech(galaxy, e);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------------------------------------------

function anyHolderLeft(galaxy: Galaxy, st: TimeBombState): boolean {
    return normalEmpires(galaxy).some((e) => currentlyHeld(e, st).length > 0);
}

function endCheck(galaxy: Galaxy, st: TimeBombState): void {
    if (st.ended || !st.placed) return;
    const gameEndOn = threatsGameEndOn(galaxy);
    if (st.destroyed.length >= P.defeatDestroyed(galaxy)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Defeat', args: [st.destroyed.length] });
        if (gameEndOn) {
            st.ended = true;
            threatGameEnd(galaxy, null, GameEndOutcome.Defeat, scenarioText(`${TAG} Defeat Title`), TIME_BOMB_CODE_DEFEAT);
        }
        return;
    }
    if (st.destroyed.length > 0 && !anyHolderLeft(galaxy, st)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained' });
        if (gameEndOn) {
            st.ended = true;
            const player = galaxy.playerEmpire;
            threatGameEnd(galaxy, player, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), TIME_BOMB_CODE_CONTAINED);
        }
    }
}

function threatsGameEndOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags['threatsGameEnd'] !== false;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const TIME_BOMB_HANDLER_IDS = ['timeBomb.yearly', 'timeBomb.research'] as const;

export function registerTimeBomb(): void {
    registerThreatExistence(TIME_BOMB_KEY, TIME_BOMB_FLAG);
    registerScenarioYearly({ id: 'timeBomb.yearly', flag: TIME_BOMB_FLAG, order: 10, run: timeBombYearly });
    registerScenarioEvent({ id: 'timeBomb.research', flag: TIME_BOMB_FLAG, event: 'researchCompleted', run: (g, e) => onResearchCompleted(g, e.empire, e.project) });
}

registerTimeBomb();
