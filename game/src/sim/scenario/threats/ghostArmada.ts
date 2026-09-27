// 19f #7 Ghost Armada (tasks/19f-hidden-threats.md §7, threat framework framework.ts). Not a port: new scenario
// behaviour composed of ported functions (each composed step cites its C# analogue). Registered from
// scenario/packages.ts; every handler is gated by the `threatGhostArmada` flag, so with the flag off (or no
// scenario) nothing here runs and nothing draws.
//
// Arc: every military ship destroyed in combat is recorded against its empire (capped, FIFO); when that empire is
// wiped out, `ghostDelayYears` later its recorded wrecks rise at a debris field as a pirate-flavoured faction flying
// the dead empire's race and name, at locked war with its conqueror only, raiding the conqueror's nearest
// undefended colonies within range.
//
// Persona note (§7 "LLM persona via 18c when available"): 18c (tasks/18-local-llm-diplomacy.md) is a UI-layer
// feature (src/ui/aiAdvisorDriver.ts, src/sim/player/strategicBrief.ts / diplomatBrief.ts personaLines) that derives
// its persona text live from an empire's race, government and ruler-character traits — there is no sim-side persona
// registry to plug into, and none is added here. Creating the ghost faction with the dead empire's race via the
// normal createThreatFaction path is sufficient: when 18c is enabled it narrates the Ghosts' race-flavoured persona
// automatically from that race, with no extra wiring; the sim runs identically with 18c on or off — a scripted raid
// pattern (targeting below), the persona layer is purely optional narration on top.
//
// Rnd (§0.4): draws only in ghostArmadaYearly (the rise: debris field placement, createThreatFaction, per-ship
// damage rolls) and the stock functions it calls. ghostArmadaPeriodic (targeting) assigns missions only, no Rnd.
// Fixed iteration orders: galaxy.empires order for wreck recording (via the emit's own empire), state.pending /
// state.risen in push (id) order, a risen faction's builtObjects in list order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { Design } from '../../design';
import type { Race } from '../../data/races';
import { BuiltObject } from '../../builtObject';
import { ComponentStatus } from '../../builtObjectComponent';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { generateDebrisField } from '../../story/storyStart';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioEvent, registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { GameEndOutcome } from '../../victory';
import {
    KNOWLEDGE_RUMOUR,
    arcMessage,
    arcNews,
    atWar,
    createThreatFaction,
    normalEmpires,
    peekThreatState,
    registerThreatKnownSites,
    revealTo,
    teardownIfDead,
    threatGameEnd,
    threatState,
    type KnownThreatSite,
    type SentStages,
    type ThreatKnowledge,
} from './framework';

export const GHOST_ARMADA_KEY = 'ghostArmada';
export const GHOST_ARMADA_FLAG = 'threatGhostArmada';
const TAG = 'GhostArmada';
const PERIOD_DAYS = 30;
const WRECK_CAP_DEFAULT = 40;
/** Game-end code (19f table: 1911 Grey Tide … 1920 Corporate Coup; victory/containment = code + 100). Ghost Armada
 * never holds territory, so it has no defeat code — only the containment ending, as Silence / the Exchange also do. */
export const GHOST_ARMADA_CODE_CONTAINED = 2017;

export interface GhostWreck {
    design: Design;
    x: number;
    y: number;
    empireId: number;
    date: number;
}

export interface GhostPending {
    deadEmpireId: number;
    deadEmpireName: string;
    race: Race | null;
    conqueror: Empire | null;
    date: number;
}

export interface GhostRisen {
    deadEmpireId: number;
    deadEmpireName: string;
    conqueror: Empire | null;
    faction: Empire;
    /** A nearby habitat stands in as the debris field's subject / map marker (a GalaxyLocation is not a KnownThreatSite target). */
    field: Habitat | null;
    knowledge: ThreatKnowledge[];
}

export interface GhostArmadaState {
    wrecks: GhostWreck[];
    pending: GhostPending[];
    risen: GhostRisen[];
    sentStages: SentStages;
}

function newState(): GhostArmadaState {
    return { wrecks: [], pending: [], risen: [], sentStages: {} };
}

export function ghostArmadaState(galaxy: Galaxy): GhostArmadaState {
    return threatState(galaxy, GHOST_ARMADA_KEY, newState);
}

export function peekGhostArmadaState(galaxy: Galaxy): GhostArmadaState | null {
    return peekThreatState<GhostArmadaState>(galaxy, GHOST_ARMADA_KEY);
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    delayYears: (g: Galaxy) => p(g, 'ghostDelayYears', 3),
    maxShips: (g: Galaxy) => Math.trunc(p(g, 'ghostMaxShips', 30)),
    raidRange: (g: Galaxy) => p(g, 'ghostRaidRange', 60000),
    wreckCap: (g: Galaxy) => Math.trunc(p(g, 'ghostWreckCapPerEmpire', WRECK_CAP_DEFAULT)),
};

function threatsGameEndOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags['threatsGameEnd'] !== false;
}

// ---------------------------------------------------------------------------------------------------------------
// Recording (builtObjectRemoved, empireEliminated)
// ---------------------------------------------------------------------------------------------------------------

function onBuiltObjectRemoved(galaxy: Galaxy, bo: BuiltObject): void {
    const st = ghostArmadaState(galaxy);
    if (!bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Military || bo.design === null) return;
    const empire = bo.actualEmpire;
    if (empire === null || empire === galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null) return;
    const cap = P.wreckCap(galaxy);
    const forEmpire = st.wrecks.filter((w) => w.empireId === empire.empireId);
    if (forEmpire.length >= cap) {
        const i = st.wrecks.indexOf(forEmpire[0]); // oldest of this empire (push order): FIFO, no Rnd.
        if (i >= 0) st.wrecks.splice(i, 1);
    }
    st.wrecks.push({ design: bo.design, x: bo.xpos, y: bo.ypos, empireId: empire.empireId, date: galaxyStarDate(galaxy) });
}

function onEmpireEliminated(galaxy: Galaxy, empire: Empire, conqueror: Empire | null): void {
    const st = ghostArmadaState(galaxy);
    if (!st.wrecks.some((w) => w.empireId === empire.empireId)) return; // nothing recorded to rise from
    st.pending.push({ deadEmpireId: empire.empireId, deadEmpireName: empire.name, race: empire.dominantRace, conqueror, date: galaxyStarDate(galaxy) });
}

// ---------------------------------------------------------------------------------------------------------------
// Rise (yearly)
// ---------------------------------------------------------------------------------------------------------------

/** The wreck location with the most other wrecks of the same dead empire within 3000 units of it: the "densest cluster". */
function densestClusterCenter(galaxy: Galaxy, wrecks: readonly GhostWreck[]): { x: number; y: number } {
    let best = wrecks[0];
    let bestCount = -1;
    for (const w of wrecks) {
        let n = 0;
        for (const other of wrecks) if (galaxy.calculateDistance(w.x, w.y, other.x, other.y) <= 3000) n++;
        if (n > bestCount) {
            bestCount = n;
            best = w;
        }
    }
    return { x: best.x, y: best.y };
}

function placeFactionShip(galaxy: Galaxy, faction: Empire, design: Design, x: number, y: number): BuiltObject {
    design.buildCount++;
    const name = galaxy.selectUniqueBuiltObjectName(design, null);
    const bo = new BuiltObject(design, name, galaxy, true);
    bo.empire = faction;
    bo.xpos = x;
    bo.ypos = y;
    bo.heading = galaxy.selectRandomHeading();
    bo.targetHeading = bo.heading;
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    faction.addBuiltObjectToGalaxy(bo, null, false, true);
    return bo;
}

export function ghostArmadaYearly(galaxy: Galaxy): void {
    const st = ghostArmadaState(galaxy);
    const now = galaxyStarDate(galaxy);
    const delay = P.delayYears(galaxy) * YEAR_LENGTH;
    const stillPending: GhostPending[] = [];
    for (const entry of st.pending) {
        if (now - entry.date < delay) {
            stillPending.push(entry);
            continue;
        }
        rise(galaxy, st, entry);
    }
    st.pending = stillPending;
}

function rise(galaxy: Galaxy, st: GhostArmadaState, entry: GhostPending): void {
    const wrecks = st.wrecks.filter((w) => w.empireId === entry.deadEmpireId);
    if (wrecks.length === 0 || entry.race === null) return;
    const center = densestClusterCenter(galaxy, wrecks);
    // A nearby habitat (any owner) as the map marker / capital placeholder; not required to exist.
    const nearHabitat = galaxy.findNearestColony(center.x, center.y, null, true);
    const fieldName = `${entry.deadEmpireName} Debris Field`;
    generateDebrisField(galaxy, center.x, center.y, fieldName, Math.min(12, Math.max(6, wrecks.length)));
    const faction = createThreatFaction(galaxy, {
        race: entry.race,
        name: scenarioText(`${TAG} Faction Name`, entry.deadEmpireName),
        enemies: entry.conqueror !== null && entry.conqueror.active ? [entry.conqueror] : [],
        relationBias: -100,
    });
    if (faction === null) return;
    // Risk (as 19b darkFarms §13): stock AI code reads Empire.Capital without a null check; the Ghosts never own a
    // colony, so a nearby (unowned-by-them) habitat stands in, exactly as darkFarms's provisional capital does.
    faction.capital = nearHabitat;
    const max = Math.min(P.maxShips(galaxy), wrecks.length);
    for (let i = 0; i < max; i++) {
        const w = wrecks[i];
        const bo = placeFactionShip(galaxy, faction, w.design, center.x, center.y);
        const count = Math.max(2, bo.components.count);
        const damageRolls = galaxy.rnd.next(1, count);
        for (let j = 0; j < damageRolls; j++) {
            const idx = galaxy.rnd.next(0, bo.components.count);
            bo.components.items[idx].status = ComponentStatus.Damaged;
        }
        bo.reDefine();
    }
    const risen: GhostRisen = { deadEmpireId: entry.deadEmpireId, deadEmpireName: entry.deadEmpireName, conqueror: entry.conqueror, faction, field: nearHabitat, knowledge: [] };
    st.risen.push(risen);
    const recipients = entry.conqueror !== null ? [entry.conqueror] : [];
    arcMessage(galaxy, st.sentStages, recipients, { prefix: TAG, stage: 'Rise', onceKey: `Rise:${entry.deadEmpireId}`, args: [entry.deadEmpireName, fieldName], subject: nearHabitat });
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Rise', onceKey: `Rise News:${entry.deadEmpireId}`, textTag: `${TAG} Rise News`, args: [entry.deadEmpireName, fieldName, entry.conqueror?.name ?? ''], subject: nearHabitat });
    for (const e of normalEmpires(galaxy, faction)) revealTo(galaxy, risen, e, KNOWLEDGE_RUMOUR);
}

// ---------------------------------------------------------------------------------------------------------------
// Targeting (periodic) — raids only the conqueror; ships never receive orders against anyone else (the stock combat
// AI still lets them defend themselves if attacked by a third party — "unless attacked", §7 "AI").
// ---------------------------------------------------------------------------------------------------------------

function isIdle(bo: BuiltObject): boolean {
    const m = builtObjectMission(bo.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined || m.type === BuiltObjectMissionType.Hold;
}

export function ghostArmadaPeriodic(galaxy: Galaxy): void {
    const st = peekGhostArmadaState(galaxy);
    if (st === null) return;
    const range = P.raidRange(galaxy);
    for (const r of [...st.risen]) {
        if (!r.faction.active) continue;
        if (teardownIfDead(galaxy, r.faction)) {
            if (arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained', onceKey: `Contained:${r.deadEmpireId}`, args: [r.deadEmpireName] }) && threatsGameEndOn(galaxy)) {
                threatGameEnd(galaxy, r.conqueror, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), GHOST_ARMADA_CODE_CONTAINED);
            }
            continue;
        }
        const conqueror = r.conqueror;
        if (conqueror === null || !conqueror.active || !atWar(r.faction, conqueror)) continue;
        const home = r.field ?? { xpos: 0, ypos: 0 };
        let best: Habitat | null = null;
        let bestScore = Number.MAX_VALUE;
        for (const c of conqueror.colonies) {
            if (c.hasBeenDestroyed) continue;
            const d = galaxy.calculateDistance(home.xpos, home.ypos, c.xpos, c.ypos);
            if (d > range) continue;
            const garrison = c.troops?.totalDefendStrength ?? 0;
            const score = (garrison + 1) * d;
            if (score < bestScore) {
                bestScore = score;
                best = c;
            }
        }
        if (best === null) continue;
        for (const bo of r.faction.builtObjects) {
            if (bo.hasBeenDestroyed || !isIdle(bo)) continue;
            assignMission(galaxy, bo, BuiltObjectMissionType.Attack, best, null, BuiltObjectMissionPriority.High, { manuallyAssigned: true });
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------------------------

export function ghostArmadaKnownSites(galaxy: Galaxy, empire: Empire): KnownThreatSite[] {
    const st = peekGhostArmadaState(galaxy);
    if (st === null) return [];
    const out: KnownThreatSite[] = [];
    for (const r of st.risen) {
        if (!r.faction.active || r.field === null) continue;
        const level = r.knowledge.find((k) => k.empireId === empire.empireId)?.level ?? 0;
        if (level <= 0) continue;
        out.push({ threat: GHOST_ARMADA_KEY, kind: 'colony', target: r.field, level, label: scenarioText(`${TAG} Field Row`) });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const GHOST_ARMADA_HANDLER_IDS = ['ghostArmada.removed', 'ghostArmada.eliminated', 'ghostArmada.yearly', 'ghostArmada.periodic'] as const;

export function registerGhostArmada(): void {
    registerScenarioEvent({ id: 'ghostArmada.removed', flag: GHOST_ARMADA_FLAG, event: 'builtObjectRemoved', run: (g, e) => onBuiltObjectRemoved(g, e.builtObject) });
    registerScenarioEvent({ id: 'ghostArmada.eliminated', flag: GHOST_ARMADA_FLAG, event: 'empireEliminated', run: (g, e) => onEmpireEliminated(g, e.empire, e.conqueror) });
    registerScenarioYearly({ id: 'ghostArmada.yearly', flag: GHOST_ARMADA_FLAG, order: 10, run: (g) => ghostArmadaYearly(g) });
    registerScenarioPeriodic({ id: 'ghostArmada.periodic', flag: GHOST_ARMADA_FLAG, periodDays: PERIOD_DAYS, order: 10, run: (g) => ghostArmadaPeriodic(g) });
    registerThreatKnownSites(GHOST_ARMADA_KEY, ghostArmadaKnownSites);
}

registerGhostArmada();
