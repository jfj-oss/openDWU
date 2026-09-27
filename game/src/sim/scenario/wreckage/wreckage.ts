// Scenario package 19e-7 "battle wreckage & salvage" (tasks/19-mod-layer-scenarios.md §19e item 7) — the handlers: a
// destroyed ship / base leaves a wreck record in a debris field; fields decay; salvage missions (player order, AI and
// pirate idle construction ships) recover build resources and, with a chance, a foreign research project; pirate raid
// targets near big fields recover their raid countdown faster. Not a port; every handler is behind the `wreckage` flag.
//
// Base-sim hooks (scenario/hooks.ts): event builtObjectDestroyed (combat/teardown.ts CompleteTeardown of a destroyed object; BuiltObject.1.cs
// 14 DoExplosions → BuiltObject.2.cs 5171 CompleteTeardown), event constructionShipIdle (civilianAI.ts, Empire.5.cs 2669
// end of case ConstructionShip; pirateShipMissions.ts, Empire.1.cs 5116), query debrisFieldPersists (events.ts
// clearEmptyDebrisFields, Galaxy.5.cs 2893), query raidCountdownRate (pirateAI.ts UpdateRaidCountdown, BuiltObject.1.cs
// 2894 / Habitat.cs 1608).
//
// Rnd: only salvage completion draws (the tech roll: NextDouble, then Next(0, candidates)) — inside the periodic handler.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { GalaxyLocation } from '../../galaxyLocation';
import { ComponentStatus } from '../../builtObjectComponent';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { Cargo, CargoList, ResourceRef } from '../../cargo';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { assignMission, clearPreviousMissionRequirements } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { removeGalaxyLocation } from '../../events';
import { TradeableItem, TradeableItemType, giveTradeableItem } from '../../tradeItems';
import type { TechNode } from '../../researchSystem';
import { withinFuelRange } from '../../movement';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { scenarioFlag } from '../state';
import { scenarioMessage, scenarioText } from '../messages';
import {
    WRECKAGE_FLAG,
    createWreckField,
    isSalvageShip,
    peekWreckageState,
    removeWreckField,
    salvageJobOf,
    takeWrecks,
    wreckFieldById,
    wreckFieldKnownTo,
    wreckFieldValue,
    wreckParam,
    wreckRemaining,
    wreckageHooks,
    wreckageState,
    type SalvageJob,
    type WreckField,
    type WreckRecord,
} from './common';

wreckageHooks.removeLocation = (galaxy: Galaxy, location: GalaxyLocation) => removeGalaxyLocation(galaxy, location);

/** A salvage job not finished within this long is dropped (the ship keeps what it carries). */
const JOB_TIMEOUT = 2 * YEAR_LENGTH;
/** Distance to the port that counts as "delivered". */
const PORT_RANGE = 3000;

function allEmpires(galaxy: Galaxy): Empire[] {
    return [...galaxy.empires, ...galaxy.pirateEmpires].filter((e): e is Empire => e != null);
}

function empireById(galaxy: Galaxy, id: number): Empire | null {
    if (id < 0) return null;
    return allEmpires(galaxy).find((e) => e.empireId === id) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Wreck records
// ---------------------------------------------------------------------------------------------------------------

/** The wreck record of a destroyed ship / base (null: nothing was built of it). No Rnd. */
export function wreckRecordOf(galaxy: Galaxy, bo: BuiltObject, id: number): WreckRecord | null {
    const componentIds: number[] = [];
    const res = new Map<number, number>();
    for (const c of bo.components.items) {
        if (c.status === ComponentStatus.Unbuilt) continue;
        componentIds.push(c.componentId);
        // components.txt resource pairs (ComponentDefinitionList.cs LoadFromFile → ComponentDefinition.ResourcesRequired).
        for (const r of c.def.resourceRequirements) res.set(r.resourceId, (res.get(r.resourceId) ?? 0) + r.amount);
    }
    if (componentIds.length === 0) return null;
    const resources = [...res.entries()].sort((a, b) => a[0] - b[0]).map(([resourceId, amount]) => ({ resourceId, amount }));
    let value = bo.purchasePrice;
    if (!(value > 0)) value = resources.reduce((a, r) => a + r.amount, 0);
    const owner = bo.actualEmpire;
    return {
        id,
        builtObjectId: bo.builtObjectID,
        name: bo.name,
        designName: bo.design?.name ?? '',
        role: bo.role,
        subRole: bo.subRole,
        ownerEmpireId: owner !== null ? owner.empireId : -1,
        ownerName: owner !== null ? owner.name : '',
        x: bo.xpos,
        y: bo.ypos,
        size: bo.size,
        componentIds,
        resources,
        value: Math.round(value),
        starDate: galaxyStarDate(galaxy),
    };
}

/** builtObjectDestroyed: the wreck joins the nearest field within the join radius, or starts a new field there. */
export function recordWreck(galaxy: Galaxy, bo: BuiltObject): WreckRecord | null {
    const st = wreckageState(galaxy);
    const join = wreckParam(galaxy, 'wreckFieldJoinRadius');
    let field: WreckField | null = null;
    let best = Number.MAX_VALUE;
    for (const f of st.fields) {
        const d = galaxy.calculateDistance(bo.xpos, bo.ypos, f.x, f.y);
        if (d <= join && d < best) {
            field = f;
            best = d;
        }
    }
    // Several destroying explosions on one object finish in the same pass: record it once.
    if (field !== null && field.wrecks.some((w) => w.builtObjectId === bo.builtObjectID && w.name === bo.name)) return null;
    const record = wreckRecordOf(galaxy, bo, st.nextWreckId);
    if (record === null) return null;
    st.nextWreckId++;
    if (field === null) field = createWreckField(galaxy, bo.xpos, bo.ypos);
    field.wrecks.push(record);
    st.stats.wrecks++;
    // The owner knows where its ship died; empires watching the system saw the battle.
    const owner = bo.actualEmpire;
    for (const e of allEmpires(galaxy)) {
        if (e === galaxy.independentEmpire || e.visibility.knownGalaxyLocations.includes(field.location)) continue;
        if (e === owner || (field.systemIndex >= 0 && e.visibility.checkSystemVisible(field.systemIndex))) e.visibility.knownGalaxyLocations.push(field.location);
    }
    // A salvager destroyed on its trip.
    st.jobs = st.jobs.filter((j) => j.ship !== bo);
    return record;
}

/** Yearly decay: wrecks past wreckDecayYears are gone; empty fields leave the map. */
export function decayWreckFields(galaxy: Galaxy): void {
    const st = peekWreckageState(galaxy);
    if (st === null) return;
    const now = galaxyStarDate(galaxy);
    for (const f of [...st.fields]) {
        const keep = f.wrecks.filter((w) => wreckRemaining(galaxy, w, now) > 0);
        if (keep.length === f.wrecks.length) continue;
        f.wrecks = keep;
        if (keep.length === 0) {
            removeWreckField(galaxy, f);
            st.stats.fieldsDecayed++;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Salvage missions
// ---------------------------------------------------------------------------------------------------------------

function isOurHold(ship: BuiltObject, x: number, y: number): boolean {
    const m = builtObjectMission(ship.mission);
    return m !== null && m.type === BuiltObjectMissionType.MoveAndWait && Math.abs(m.x - x) < 1 && Math.abs(m.y - y) < 1;
}

/** Ends the salvage hold (the stock AI reassigns an automated ship at its next pass; a manual one idles). */
function releaseShip(galaxy: Galaxy, ship: BuiltObject): void {
    const m = builtObjectMission(ship.mission);
    if (m === null || m.type !== BuiltObjectMissionType.MoveAndWait) return;
    clearPreviousMissionRequirements(galaxy, ship);
    m.clear();
}

/**
 * Order `ship` to salvage the field (player command, AI hook). The ship flies a MoveAndWait to the field centre and
 * holds there (BuiltObject.2.cs AssignMission; ResolveCommands MoveAndWait: ConditionalHyperTo, MoveTo, Hold until the
 * star date); the periodic tick does the recovery once it has spent wreckSalvageDays on site. No Rnd.
 */
export function orderSalvage(galaxy: Galaxy, empire: Empire, ship: BuiltObject | null, fieldId: number, manual = true): boolean {
    if (!scenarioFlag(galaxy, WRECKAGE_FLAG) || ship === null || ship.hasBeenDestroyed || ship.role === BuiltObjectRole.Base || !isSalvageShip(ship)) return false;
    if (ship.actualEmpire !== empire && ship.empire !== empire) return false;
    const field = wreckFieldById(galaxy, fieldId);
    if (field === null || field.wrecks.length === 0) return false;
    const st = wreckageState(galaxy);
    st.jobs = st.jobs.filter((j) => j.ship !== ship);
    const now = galaxyStarDate(galaxy);
    assignMission(galaxy, ship, BuiltObjectMissionType.MoveAndWait, null, null, BuiltObjectMissionPriority.High, { x: field.x, y: field.y, starDate: now + YEAR_LENGTH, manuallyAssigned: manual });
    if (!isOurHold(ship, field.x, field.y)) return false;
    st.jobs.push({ ship, empireId: empire.empireId, fieldId: field.id, phase: 'travel', startStarDate: now, arrivedStarDate: -1, port: null, cargo: [], manual });
    return true;
}

/** Resources a trip recovers from `wrecks` (build resources × fraction × remaining), capped by the free cargo space. No Rnd. */
export function salvageYield(galaxy: Galaxy, ship: BuiltObject, wrecks: readonly WreckRecord[]): { resourceId: number; amount: number }[] {
    const fraction = wreckParam(galaxy, 'wreckSalvageFraction');
    const now = galaxyStarDate(galaxy);
    const total = new Map<number, number>();
    for (const w of wrecks) {
        const rem = wreckRemaining(galaxy, w, now);
        for (const r of w.resources) {
            const a = Math.floor(r.amount * fraction * rem);
            if (a > 0) total.set(r.resourceId, (total.get(r.resourceId) ?? 0) + a);
        }
    }
    let list = [...total.entries()].map(([resourceId, amount]) => ({ resourceId, amount })).sort((a, b) => b.amount - a.amount || a.resourceId - b.resourceId);
    // Cargo space (BuiltObject.CargoCapacity); a ship without cargo bays tows what it recovers.
    if (ship.cargoCapacity > 0) {
        let used = 0;
        for (const c of ship.cargo?.items ?? []) used += Math.max(0, c.amount);
        let free = Math.max(0, ship.cargoCapacity - used);
        list = list.map((r) => {
            const a = Math.min(r.amount, free);
            free -= a;
            return { resourceId: r.resourceId, amount: a };
        });
    }
    return list.filter((r) => r.amount > 0);
}

/** Research projects the wrecks' components came from that `empire` lacks (ResearchNodeDefinition.Components). */
export function foreignTechCandidates(empire: Empire, wrecks: readonly WreckRecord[]): TechNode[] {
    const ids = new Set<number>();
    for (const w of wrecks) for (const c of w.componentIds) ids.add(c);
    return empire.research.techTree.filter((n) => !n.isResearched && n.def.components.some((c) => ids.has(c)));
}

/**
 * The recovery: takes up to wreckSalvageWrecksPerTrip wrecks (most valuable first), loads their resources, rolls the
 * foreign tech (Rnd: NextDouble when there is a candidate, then Next(0, candidates)) and grants it through the ported
 * trade path (tradeItems.ts giveTradeableItem, ResearchProject: Galaxy.4.cs 4005-4036 → DoResearchBreakthrough).
 */
export function completeSalvage(galaxy: Galaxy, job: SalvageJob, field: WreckField): { wrecks: WreckRecord[]; cargo: { resourceId: number; amount: number }[]; tech: TechNode | null } {
    const st = wreckageState(galaxy);
    const ship = job.ship;
    const empire = empireById(galaxy, job.empireId)!;
    const now = galaxyStarDate(galaxy);
    const per = Math.max(1, Math.trunc(wreckParam(galaxy, 'wreckSalvageWrecksPerTrip')));
    const picked = [...field.wrecks].sort((a, b) => b.value * wreckRemaining(galaxy, b, now) - a.value * wreckRemaining(galaxy, a, now) || a.id - b.id).slice(0, per);
    const cargo = salvageYield(galaxy, ship, picked);
    if (cargo.length > 0 && ship.cargo === null) ship.cargo = new CargoList();
    for (const c of cargo) ship.cargo!.add(new Cargo(new ResourceRef(c.resourceId), c.amount, empire));
    let tech: TechNode | null = null;
    const candidates = foreignTechCandidates(empire, picked);
    if (candidates.length > 0 && galaxy.rnd.nextDouble() < wreckParam(galaxy, 'wreckTechChance')) {
        tech = candidates[galaxy.rnd.next(0, candidates.length)];
        const giver = empireById(galaxy, picked.find((w) => w.ownerEmpireId >= 0 && w.ownerEmpireId !== empire.empireId)?.ownerEmpireId ?? -1) ?? empire;
        giveTradeableItem(galaxy, giver, empire, new TradeableItem(TradeableItemType.ResearchProject, tech, 0), null);
        st.stats.techsRecovered++;
    }
    takeWrecks(galaxy, picked);
    st.stats.salvageTrips++;
    for (const c of cargo) st.stats.resourcesRecovered += c.amount;
    if (empire === galaxy.playerEmpire) {
        const names = cargo.map((c) => `${c.amount} ${galaxy.resourceSystem.byId.get(c.resourceId)?.name ?? c.resourceId}`).join(', ');
        const title = scenarioText('Scenario Wreckage Salvaged Title');
        scenarioMessage(galaxy, empire, title, scenarioText('Scenario Wreckage Salvaged', ship.name, picked.length, field.name, names === '' ? scenarioText('Scenario Wreckage Nothing') : names), { subject: ship });
        if (tech !== null) scenarioMessage(galaxy, empire, title, scenarioText('Scenario Wreckage Salvaged Tech', ship.name, field.name, tech.def.name), { subject: ship });
    }
    return { wrecks: picked, cargo, tech };
}

/** The nearest own space port (else own base with a hold) to deliver the salvage to. */
function nearestPort(galaxy: Galaxy, empire: Empire, x: number, y: number): BuiltObject | null {
    let list = empire.spacePorts.filter((b) => b != null && !b.hasBeenDestroyed);
    if (list.length === 0) list = empire.builtObjects.filter((b) => b != null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Base && b.cargo !== null);
    let best: BuiltObject | null = null;
    let bestD = Number.MAX_VALUE;
    for (const b of list) {
        const d = galaxy.calculateDistance(x, y, b.xpos, b.ypos);
        if (d < bestD) {
            best = b;
            bestD = d;
        }
    }
    return best;
}

/** Moves the trip's cargo from the ship's hold to the port's. */
function unloadSalvage(job: SalvageJob, empire: Empire, port: BuiltObject): void {
    const ship = job.ship;
    if (ship.cargo === null) return;
    if (port.cargo === null) port.cargo = new CargoList();
    for (const c of job.cargo) {
        const i = ship.cargo.indexOf(new ResourceRef(c.resourceId), empire);
        if (i < 0) continue;
        const item = ship.cargo.items[i];
        const a = Math.min(item.amount, c.amount);
        if (a <= 0) continue;
        item.amount -= a;
        if (item.amount <= 0) ship.cargo.remove(item);
        port.cargo.add(new Cargo(new ResourceRef(c.resourceId), a, empire));
    }
    job.cargo = [];
}

/** Advances every salvage job (periodic, once per long block). May draw (completeSalvage). */
export function salvageJobsTick(galaxy: Galaxy): void {
    const st = peekWreckageState(galaxy);
    if (st === null) return;
    const now = galaxyStarDate(galaxy);
    const done = new Set<SalvageJob>();
    for (const job of [...st.jobs]) {
        const ship = job.ship;
        const empire = empireById(galaxy, job.empireId);
        if (empire === null || ship.hasBeenDestroyed || (ship.actualEmpire !== empire && ship.empire !== empire) || now - job.startStarDate > JOB_TIMEOUT) {
            done.add(job);
            continue;
        }
        if (job.phase === 'travel') {
            const field = wreckFieldById(galaxy, job.fieldId);
            if (field === null || field.wrecks.length === 0) {
                if (field === null || isOurHold(ship, field.x, field.y)) releaseShip(galaxy, ship);
                done.add(job);
                continue;
            }
            const inField = galaxy.calculateDistance(ship.xpos, ship.ypos, field.x, field.y) <= Math.max(field.location.width / 2, 600) + 400;
            if (!inField) {
                if (!isOurHold(ship, field.x, field.y)) done.add(job); // the order was replaced
                continue;
            }
            if (job.arrivedStarDate < 0) job.arrivedStarDate = now;
            if (now - job.arrivedStarDate < wreckParam(galaxy, 'wreckSalvageDays') * GAME_DAY_LENGTH) continue;
            const r = completeSalvage(galaxy, job, field);
            releaseShip(galaxy, ship);
            job.cargo = r.cargo;
            const port = r.cargo.length > 0 ? nearestPort(galaxy, empire, ship.xpos, ship.ypos) : null;
            if (port === null) {
                done.add(job);
                continue;
            }
            job.phase = 'return';
            job.port = port;
            job.startStarDate = now;
            assignMission(galaxy, ship, BuiltObjectMissionType.MoveAndWait, port, null, BuiltObjectMissionPriority.High, { starDate: now + YEAR_LENGTH, manuallyAssigned: job.manual });
            continue;
        }
        // Return leg: deliver at the port (or any own port the ship happens to be at).
        const port = job.port !== null && !job.port.hasBeenDestroyed ? job.port : nearestPort(galaxy, empire, ship.xpos, ship.ypos);
        if (port === null) {
            done.add(job);
            continue;
        }
        if (galaxy.calculateDistance(ship.xpos, ship.ypos, port.xpos, port.ypos) <= PORT_RANGE) {
            unloadSalvage(job, empire, port);
            const m = builtObjectMission(ship.mission);
            if (m !== null && m.type === BuiltObjectMissionType.MoveAndWait && m.targetBuiltObject === port) releaseShip(galaxy, ship);
            done.add(job);
            continue;
        }
        const m = builtObjectMission(ship.mission);
        if (m === null || m.type === BuiltObjectMissionType.Undefined) {
            job.port = port;
            assignMission(galaxy, ship, BuiltObjectMissionType.MoveAndWait, port, null, BuiltObjectMissionPriority.High, { starDate: now + YEAR_LENGTH, manuallyAssigned: job.manual });
        }
    }
    if (done.size > 0) st.jobs = st.jobs.filter((j) => !done.has(j));
}

// ---------------------------------------------------------------------------------------------------------------
// AI / pirates
// ---------------------------------------------------------------------------------------------------------------

/**
 * constructionShipIdle (Empire.5.cs 2669 / Empire.1.cs 5116): an idle AI or pirate construction ship salvages the
 * nearest known field worth a trip within wreckAiSalvageRange and its fuel range, one ship per field per empire. No Rnd.
 */
export function aiSalvageIdleShip(galaxy: Galaxy, empire: Empire, ship: BuiltObject): boolean {
    const st = peekWreckageState(galaxy);
    if (st === null || st.fields.length === 0 || salvageJobOf(galaxy, ship) !== null) return false;
    const range = wreckParam(galaxy, 'wreckAiSalvageRange');
    const minValue = wreckParam(galaxy, 'wreckAiMinValue');
    let best: WreckField | null = null;
    let bestD = Number.MAX_VALUE;
    for (const f of st.fields) {
        if (f.wrecks.length === 0 || !wreckFieldKnownTo(empire, f)) continue;
        if (st.jobs.some((j) => j.fieldId === f.id && j.empireId === empire.empireId && j.phase === 'travel')) continue;
        const d = galaxy.calculateDistance(ship.xpos, ship.ypos, f.x, f.y);
        if (d > range || d >= bestD) continue;
        if (wreckFieldValue(galaxy, f) < minValue || !withinFuelRange(galaxy, ship, f.x, f.y, 0.1)) continue;
        best = f;
        bestD = d;
    }
    return best !== null && orderSalvage(galaxy, empire, ship, best.id, false);
}

/** True when (x, y) is within wreckPirateRaidRange of a big field (≥ wreckBigFieldShips wrecks). */
export function nearBigWreckField(galaxy: Galaxy, x: number, y: number): boolean {
    const st = peekWreckageState(galaxy);
    if (st === null) return false;
    const big = wreckParam(galaxy, 'wreckBigFieldShips');
    const range = wreckParam(galaxy, 'wreckPirateRaidRange');
    for (const f of st.fields) if (f.wrecks.length >= big && galaxy.calculateDistance(x, y, f.x, f.y) <= range) return true;
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

registerScenarioEvent({ id: 'wreckage.destroyed', flag: WRECKAGE_FLAG, event: 'builtObjectDestroyed', run: (g, p) => void recordWreck(g, p.builtObject) });
registerScenarioEvent({
    id: 'wreckage.removed',
    flag: WRECKAGE_FLAG,
    event: 'builtObjectRemoved',
    run: (g, p) => {
        const st = peekWreckageState(g);
        if (st !== null && st.jobs.some((j) => j.ship === p.builtObject)) st.jobs = st.jobs.filter((j) => j.ship !== p.builtObject);
    },
});
registerScenarioEvent({ id: 'wreckage.aiSalvage', flag: WRECKAGE_FLAG, event: 'constructionShipIdle', run: (g, p) => void aiSalvageIdleShip(g, p.empire, p.ship) });
registerScenarioPeriodic({
    id: 'wreckage.tick',
    flag: WRECKAGE_FLAG,
    periodDays: 1,
    run: (g) => {
        decayWreckFields(g);
        salvageJobsTick(g);
    },
});
registerScenarioQuery({ id: 'wreckage.persist', flag: WRECKAGE_FLAG, query: 'debrisFieldPersists', run: (g, v, a) => v || (peekWreckageState(g)?.fields.some((f) => f.location === a.location) ?? false) });
registerScenarioQuery({ id: 'wreckage.raid', flag: WRECKAGE_FLAG, query: 'raidCountdownRate', run: (g, v, a) => (nearBigWreckField(g, a.x, a.y) ? v * wreckParam(g, 'wreckPirateRaidBoost') : v) });
