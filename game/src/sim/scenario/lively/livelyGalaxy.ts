// Scenario package "lively-galaxy" (task 19l, livelier mid game). Not a port: three flags on top of the faithful war
// review, each off = the stock game.
//
//  1. ambitionPressure — per-empire ambition rises every peaceful year with idle military strength and falls with each
//     war and each colony lost. Above `ambitionThreshold` the empire "grows restless" and its war review (Empire.8.cs 66
//     ReviewDiplomaticStrategies) relaxes the Conquer attitude threshold num9 (Empire.8.cs 100/139, the gate
//     SOAK-2026-09-26 §A2 names) by ambition × ambitionWarFactor, through the query `warReviewAttitudeRelax`.
//  2. borderFriction — yearly, every pair of met empires whose colony-influence areas overlap on the territory grid rolls a
//     border incident (mining-station dispute, blockade, seizure) weighted by the overlap and both aggressions. An incident
//     lowers the victim's evaluation of the aggressor (and the aggressor's of the victim by half), is remembered (decaying
//     yearly) and counted toward the victim's war review through the same query; a seizure hands an unescorted mining
//     station of the victim inside the overlap to the aggressor via Empire.1.cs 524 TakeOwnershipOfBuiltObject (as
//     GiveTradeableItem does for a traded base, tradeItems.ts). Every incident calls borderIncident(), the binding point
//     for the 19d3 crisis machinery.
//  3. smallerInvasions — the ≥10-ship troop-fleet rule (Empire.8.cs 1049 PrepareFleetsForWar, the audit's "1047"; also
//     504 CheckCanConductNewWar and 1163 SelectFleetWarAttackTarget) and its troop ratio (num3 / 2) are relaxed against
//     colonies whose troop defence is below `invasionWeakTroops`, through the queries `invasionMinFleetShips` /
//     `invasionTroopRatio`. `invasionMinShips` 0 = the stock rule.
//
// Rnd: only the borderFriction yearly handler draws (galaxy.rnd), per the mod-layer Rnd policy. Queries and event
// handlers never draw.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { aggressionLevel, determineEmpiresAtWarWith } from '../../diplomacyTick';
import { takeOwnershipOfBuiltObject } from '../../combat/ownership';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioEvent, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { isHumanEmpire } from '../../humanEmpires';

export const LIVELY_GALAXY_ID = 'lively-galaxy';

// ---------------------------------------------------------------------------------------------------------------
// State (saved in galaxy.scenario.state; plain data keyed by empireId)
// ---------------------------------------------------------------------------------------------------------------

export interface AmbitionEntry {
    ambition: number;
    /** Consecutive yearly ticks the empire spent at peace. */
    yearsSinceWar: number;
    /** True while ambition is at or above the threshold (the "grows restless" message fires on the crossing). */
    restless: boolean;
    /** Star date of the last war-start drop (the relation-change event may reach us once per side). */
    lastWarDrop: number;
}

/** Ambition per empire (key: empireId). */
export function ambitionState(galaxy: Galaxy): Record<string, AmbitionEntry> {
    return scenarioState(galaxy, 'lively.ambition', () => ({}) as Record<string, AmbitionEntry>);
}

/** Remembered border incidents: key `${victimId}:${aggressorId}` → decaying count. */
export function incidentMemory(galaxy: Galaxy): Record<string, number> {
    return scenarioState(galaxy, 'lively.incidents', () => ({}) as Record<string, number>);
}

function ambitionOf(galaxy: Galaxy, empire: Empire): AmbitionEntry {
    const all = ambitionState(galaxy);
    const key = String(empire.empireId);
    let e = all[key];
    if (e === undefined) {
        e = { ambition: 0, yearsSinceWar: 0, restless: false, lastWarDrop: -1 };
        all[key] = e;
    }
    return e;
}

/** The empires the package considers: active major empires (not pirates, not the independents). */
export function majorEmpires(galaxy: Galaxy): Empire[] {
    return galaxy.empires.filter((e) => e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

function isWarship(bo: BuiltObject): boolean {
    return bo.role === BuiltObjectRole.Military && !bo.hasBeenDestroyed;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. ambitionPressure
// ---------------------------------------------------------------------------------------------------------------

/** Idle warships: military ships of an empire at peace (0 while at war). */
export function idleWarships(empire: Empire): number {
    if (determineEmpiresAtWarWith(empire).length > 0) return 0;
    let n = 0;
    for (const bo of empire.builtObjects) if (bo !== null && isWarship(bo)) n++;
    return n;
}

function lowerAmbition(galaxy: Galaxy, empire: Empire, amount: number): void {
    const e = ambitionOf(galaxy, empire);
    e.ambition = Math.max(0, e.ambition - amount);
    if (e.restless && e.ambition < scenarioParam(galaxy, 'ambitionThreshold', 5)) e.restless = false;
}

/** The yearly ambition update (exported for tests). */
export function ambitionYearly(galaxy: Galaxy): void {
    const rise = scenarioParam(galaxy, 'ambitionRise', 1);
    const shipsRef = Math.max(1, scenarioParam(galaxy, 'ambitionShipsRef', 15));
    const max = scenarioParam(galaxy, 'ambitionMax', 20);
    const threshold = scenarioParam(galaxy, 'ambitionThreshold', 5);
    const warDrop = scenarioParam(galaxy, 'ambitionWarDrop', 6);
    for (const empire of majorEmpires(galaxy)) {
        const e = ambitionOf(galaxy, empire);
        if (determineEmpiresAtWarWith(empire).length > 0) {
            // Each year of war spends ambition.
            e.yearsSinceWar = 0;
            lowerAmbition(galaxy, empire, warDrop);
            continue;
        }
        e.yearsSinceWar++;
        const strength = Math.min(2, idleWarships(empire) / shipsRef);
        const peace = 1 + Math.min(e.yearsSinceWar, 10) / 10;
        e.ambition = Math.min(max, e.ambition + rise * strength * peace);
        if (!e.restless && e.ambition >= threshold && e.ambition > 0) {
            e.restless = true;
            if (!isHumanEmpire(galaxy, empire)) {
                scenarioMessage(galaxy, empire, scenarioText('Lively Restless Title'), scenarioText('Lively Restless Own'), { type: EmpireMessageType.GeneralWarning, subject: empire });
                scenarioNews(galaxy, null, scenarioText('Lively Restless News', empire.name), (x) => x !== empire, empire);
            }
        }
    }
}

/** The war-review relaxation from ambition (attitude points; 0 below the threshold). */
export function ambitionRelax(galaxy: Galaxy, empire: Empire): number {
    const e = ambitionState(galaxy)[String(empire.empireId)];
    if (e === undefined) return 0;
    if (e.ambition < scenarioParam(galaxy, 'ambitionThreshold', 5) || e.ambition <= 0) return 0;
    return e.ambition * scenarioParam(galaxy, 'ambitionWarFactor', 0.6);
}

registerScenarioYearly({ id: 'lively.ambition', scenarioId: LIVELY_GALAXY_ID, flag: 'ambitionPressure', order: 10, run: (g) => ambitionYearly(g) });

registerScenarioQuery({
    id: 'lively.ambition.relax',
    scenarioId: LIVELY_GALAXY_ID,
    flag: 'ambitionPressure',
    query: 'warReviewAttitudeRelax',
    run: (g, value, args) => {
        // The player's empire never reviews through here unless automated; relaxation applies to whoever reviews.
        return value + ambitionRelax(g, args.empire);
    },
});

// A new war (either side) spends ambition; so does each colony lost.
registerScenarioEvent({
    id: 'lively.ambition.war',
    scenarioId: LIVELY_GALAXY_ID,
    flag: 'ambitionPressure',
    event: 'diplomaticRelationChanged',
    run: (g, p) => {
        if (p.to !== DiplomaticRelationType.War || p.from === DiplomaticRelationType.War) return;
        const now = galaxyStarDate(g);
        const drop = scenarioParam(g, 'ambitionWarDrop', 6);
        for (const e of [p.empire, p.other]) {
            if (e === null || e === g.independentEmpire) continue;
            const a = ambitionOf(g, e);
            if (a.lastWarDrop === now) continue;
            a.lastWarDrop = now;
            a.yearsSinceWar = 0;
            lowerAmbition(g, e, drop);
        }
    },
});

registerScenarioEvent({
    id: 'lively.ambition.loss',
    scenarioId: LIVELY_GALAXY_ID,
    flag: 'ambitionPressure',
    event: 'colonyOwnerChanged',
    run: (g, p) => {
        if (p.from === null || p.from === p.to || p.from === g.independentEmpire) return;
        lowerAmbition(g, p.from, scenarioParam(g, 'ambitionLossDrop', 2));
    },
});

// ---------------------------------------------------------------------------------------------------------------
// 2. borderFriction
// ---------------------------------------------------------------------------------------------------------------

export type BorderIncidentKind = 'dispute' | 'blockade' | 'seizure';

/** Severity multiplier of each incident kind (relation drop and the borderIncident severity). */
export const BORDER_INCIDENT_SEVERITY: Record<BorderIncidentKind, number> = { dispute: 1, blockade: 1.5, seizure: 2 };

export type BorderIncidentBinding = (galaxy: Galaxy, a: Empire, b: Empire, kind: BorderIncidentKind, severity: number) => void;

let borderIncidentBinding: BorderIncidentBinding | null = null;

/**
 * Local hook: a border incident between `a` (aggressor) and `b` (victim) of `kind` and `severity`. TODO(19d3): bind the
 * 19d3 crisis machinery here (bindBorderIncident) once it is merged; until then a no-op. Must not draw galaxy.rnd
 * unless the binding is itself gated on its scenario flag (it runs inside the borderFriction yearly handler).
 */
export function borderIncident(galaxy: Galaxy, a: Empire, b: Empire, kind: BorderIncidentKind, severity: number): void {
    if (borderIncidentBinding !== null) borderIncidentBinding(galaxy, a, b, kind, severity);
}

/** Binds (or with null unbinds) the borderIncident hook. Returns the previous binding. */
export function bindBorderIncident(fn: BorderIncidentBinding | null): BorderIncidentBinding | null {
    const prev = borderIncidentBinding;
    borderIncidentBinding = fn;
    return prev;
}

/** Overlap grid resolution: the territory grid (TERRITORY_INDEX_SIZE 2000) sampled every 10th cell. */
export const OVERLAP_GRID = 200;

export interface BorderOverlap {
    a: Empire;
    b: Empire;
    /** Overlapping cells (index cx * OVERLAP_GRID + cy). */
    cells: Set<number>;
}

function overlapCell(galaxy: Galaxy, x: number, y: number): number {
    const cx = Math.min(OVERLAP_GRID - 1, Math.max(0, Math.trunc(x / (galaxy.sizeX / OVERLAP_GRID))));
    const cy = Math.min(OVERLAP_GRID - 1, Math.max(0, Math.trunc(y / (galaxy.sizeY / OVERLAP_GRID))));
    return cx * OVERLAP_GRID + cy;
}

/**
 * Pairs of empires whose colony-influence areas overlap: each empire claims every grid cell whose centre lies inside the
 * influence radius of one of its colonies (Habitat.colonyInfluenceRadius, kept by the territory review — territory.ts
 * recalculateColonyInfluenceRadius); cells claimed by two empires overlap. The territory grid itself gives each cell to
 * the strongest influence only, so the overlap is taken from the influence areas it is built from. Pairs ordered by
 * (lower empireId, higher empireId). No Rnd.
 */
export function borderOverlaps(galaxy: Galaxy): BorderOverlap[] {
    const cw = galaxy.sizeX / OVERLAP_GRID;
    const ch = galaxy.sizeY / OVERLAP_GRID;
    const claims = new Map<number, Empire[]>();
    const empires = majorEmpires(galaxy).sort((x, y) => x.empireId - y.empireId);
    for (const empire of empires) {
        for (const colony of empire.colonies) {
            if (colony === null || colony.empire !== empire) continue;
            const r = colony.colonyInfluenceRadius;
            if (!(r > 0)) continue;
            const x0 = Math.max(0, Math.floor((colony.xpos - r) / cw));
            const x1 = Math.min(OVERLAP_GRID - 1, Math.floor((colony.xpos + r) / cw));
            const y0 = Math.max(0, Math.floor((colony.ypos - r) / ch));
            const y1 = Math.min(OVERLAP_GRID - 1, Math.floor((colony.ypos + r) / ch));
            const r2 = r * r;
            for (let cx = x0; cx <= x1; cx++) {
                const dx = (cx + 0.5) * cw - colony.xpos;
                for (let cy = y0; cy <= y1; cy++) {
                    const dy = (cy + 0.5) * ch - colony.ypos;
                    if (dx * dx + dy * dy > r2) continue;
                    const cell = cx * OVERLAP_GRID + cy;
                    let list = claims.get(cell);
                    if (list === undefined) {
                        list = [];
                        claims.set(cell, list);
                    }
                    if (list[list.length - 1] !== empire) list.push(empire);
                }
            }
        }
    }
    const pairs = new Map<string, BorderOverlap>();
    for (const [cell, list] of claims) {
        if (list.length < 2) continue;
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const key = `${list[i].empireId}:${list[j].empireId}`;
                let p = pairs.get(key);
                if (p === undefined) {
                    p = { a: list[i], b: list[j], cells: new Set() };
                    pairs.set(key, p);
                }
                p.cells.add(cell);
            }
        }
    }
    return [...pairs.values()].sort((x, y) => x.a.empireId - y.a.empireId || x.b.empireId - y.b.empireId);
}

/** Mining stations of `victim` inside `cells` with no warship of the victim within a system's size. */
export function unescortedStationsIn(galaxy: Galaxy, victim: Empire, cells: Set<number>): BuiltObject[] {
    const range = galaxy.maxSolarSystemSize;
    const range2 = range * range;
    const warships = victim.builtObjects.filter((bo) => bo !== null && isWarship(bo));
    const out: BuiltObject[] = [];
    for (const st of victim.miningStations) {
        if (st === null || st.hasBeenDestroyed || st.empire !== victim) continue;
        if (!cells.has(overlapCell(galaxy, st.xpos, st.ypos))) continue;
        let escorted = false;
        for (const w of warships) {
            const dx = w.xpos - st.xpos;
            const dy = w.ypos - st.ypos;
            if (dx * dx + dy * dy <= range2) {
                escorted = true;
                break;
            }
        }
        if (!escorted) out.push(st);
    }
    return out;
}

/** Remembered incidents `victim` holds against `aggressor`. */
export function incidentCount(galaxy: Galaxy, victim: Empire, aggressor: Empire): number {
    return incidentMemory(galaxy)[`${victim.empireId}:${aggressor.empireId}`] ?? 0;
}

/**
 * Applies one border incident (no Rnd except the seizure's station pick, which the caller passes). Exported for tests.
 * Returns the seized station, if any.
 */
export function applyBorderIncident(galaxy: Galaxy, aggressor: Empire, victim: Empire, kind: BorderIncidentKind, station: BuiltObject | null): BuiltObject | null {
    const severity = BORDER_INCIDENT_SEVERITY[kind];
    const drop = scenarioParam(galaxy, 'incidentRelationDrop', 4) * severity;
    // As the C# incidents do (EmpireEvaluation.IncidentEvaluation -= x; the setter clamps).
    const ev = obtainEmpireEvaluation(galaxy, victim, aggressor);
    ev.incidentEvaluation = ev.incidentEvaluation - drop;
    const ev2 = obtainEmpireEvaluation(galaxy, aggressor, victim);
    ev2.incidentEvaluation = ev2.incidentEvaluation - drop / 2;
    const mem = incidentMemory(galaxy);
    const key = `${victim.empireId}:${aggressor.empireId}`;
    mem[key] = (mem[key] ?? 0) + 1;
    let seized: BuiltObject | null = null;
    let subject: unknown = aggressor;
    if (kind === 'seizure' && station !== null) {
        // Empire.1.cs 524 TakeOwnershipOfBuiltObject(builtObject, newEmpire, setDesignAsObsolete: true), called on the
        // receiving empire exactly as GiveTradeableItem hands over a traded base (tradeItems.ts TradeableItemType.Base).
        takeOwnershipOfBuiltObject(galaxy, aggressor, station, aggressor, true);
        seized = station;
        subject = station;
    }
    const text =
        kind === 'dispute'
            ? scenarioText('Lively Incident Dispute', aggressor.name)
            : kind === 'blockade'
              ? scenarioText('Lively Incident Blockade', aggressor.name)
              : scenarioText('Lively Incident Seizure', aggressor.name, seized !== null ? seized.name : '');
    scenarioMessage(galaxy, victim, scenarioText('Lively Incident Title'), text, { type: EmpireMessageType.GeneralBadEvent, subject, sender: aggressor });
    scenarioMessage(galaxy, aggressor, scenarioText('Lively Incident Title'), scenarioText('Lively Incident Aggressor', victim.name), { type: EmpireMessageType.GeneralNeutralEvent, subject });
    borderIncident(galaxy, aggressor, victim, kind, severity);
    return seized;
}

/** The yearly friction pass (exported for tests). Draws galaxy.rnd. */
export function borderFrictionYearly(galaxy: Galaxy): void {
    // Incident memory fades.
    const keep = scenarioParam(galaxy, 'incidentMemoryDecay', 0.6);
    const mem = incidentMemory(galaxy);
    for (const k of Object.keys(mem)) {
        mem[k] *= keep;
        if (mem[k] < 0.1) delete mem[k];
    }
    const chance = scenarioParam(galaxy, 'frictionChance', 0.35);
    const ref = Math.max(1, scenarioParam(galaxy, 'frictionOverlapRef', 40));
    const maxChance = scenarioParam(galaxy, 'frictionMaxChance', 0.8);
    for (const pair of borderOverlaps(galaxy)) {
        const { a, b } = pair;
        const rel = obtainDiplomaticRelation(a, b);
        if (rel === null || rel.type === DiplomaticRelationType.NotMet || rel.type === DiplomaticRelationType.War) continue;
        const aggA = Math.max(1, aggressionLevel(a));
        const aggB = Math.max(1, aggressionLevel(b));
        const p = Math.min(maxChance, (pair.cells.size / ref) * chance * ((aggA + aggB) / 200));
        if (!(galaxy.rnd.nextDouble() < p)) continue;
        const aggressor = galaxy.rnd.nextDouble() * (aggA + aggB) < aggA ? a : b;
        const victim = aggressor === a ? b : a;
        const roll = galaxy.rnd.nextDouble();
        let kind: BorderIncidentKind = roll < 0.5 ? 'dispute' : roll < 0.8 ? 'blockade' : 'seizure';
        let station: BuiltObject | null = null;
        if (kind === 'seizure') {
            const stations = unescortedStationsIn(galaxy, victim, pair.cells);
            if (stations.length === 0) kind = 'dispute';
            else station = stations[galaxy.rnd.next(0, stations.length)];
        }
        applyBorderIncident(galaxy, aggressor, victim, kind, station);
    }
}

registerScenarioYearly({ id: 'lively.friction', scenarioId: LIVELY_GALAXY_ID, flag: 'borderFriction', order: 20, run: (g) => borderFrictionYearly(g) });

registerScenarioQuery({
    id: 'lively.friction.relax',
    scenarioId: LIVELY_GALAXY_ID,
    flag: 'borderFriction',
    query: 'warReviewAttitudeRelax',
    run: (g, value, args) => value + incidentCount(g, args.empire, args.other) * scenarioParam(g, 'incidentWarFactor', 1.5),
});

// ---------------------------------------------------------------------------------------------------------------
// 3. smallerInvasions
// ---------------------------------------------------------------------------------------------------------------

/** True when the smaller-invasion rule applies to `target` (param set and the colony's troop defence is weak). */
export function smallInvasionApplies(galaxy: Galaxy, target: Habitat): boolean {
    const minShips = scenarioParam(galaxy, 'invasionMinShips', 0);
    if (!(minShips > 0)) return false;
    const troops = target.troops !== null ? target.troops.totalDefendStrength : 0;
    return troops < scenarioParam(galaxy, 'invasionWeakTroops', 30000);
}

registerScenarioQuery({
    id: 'lively.invasion.ships',
    scenarioId: LIVELY_GALAXY_ID,
    flag: 'smallerInvasions',
    query: 'invasionMinFleetShips',
    run: (g, value, args) => (smallInvasionApplies(g, args.target) ? Math.min(value, Math.max(1, Math.trunc(scenarioParam(g, 'invasionMinShips', 0)))) : value),
});

registerScenarioQuery({
    id: 'lively.invasion.ratio',
    scenarioId: LIVELY_GALAXY_ID,
    flag: 'smallerInvasions',
    query: 'invasionTroopRatio',
    run: (g, value, args) => (smallInvasionApplies(g, args.target) ? Math.min(value, scenarioParam(g, 'invasionTroopRatio', 0.35)) : value),
});
