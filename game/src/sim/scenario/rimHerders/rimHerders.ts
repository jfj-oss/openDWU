// Scenario package 19j "rim herders" (tasks/19-mod-layer-scenarios.md §19j): hook registrations and the herder rules —
// herder colonies at game start (1), tamed freighters (2), the harvest and the kill drop (3), drovers and guides (4), the
// protectorate / conquest / espionage paths (5), migration-season warnings (6) and the AI's choice of path (7).
// Not a port: every stock call it makes is ported code (createEmpireMidGame, changeDiplomaticRelation, Character /
// GenerateNewCharacter pieces, FindNearestAvailableFleet + ShipGroup.AssignMission as Empire.4.cs 4449
// InvadeUnwillingColonizationTargets does); the herds are 19g-7 RimHerds (rimFauna/*).
//
// Rnd: galaxy.rnd only inside this package's gated handlers (game start, periodic / yearly ticks, decision resolves).
// The base-sim hooks it adds (hooks.ts creatureKilled / habitatAttacked events, builtObjectStormImmune /
// builtObjectSelfFuelling queries) never draw. With the flag off none of this runs.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { Creature } from '../../creature';
import { Cargo, ResourceRef } from '../../cargo';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { EmpireMessageType } from '../../messages';
import { Character, CharacterRole, applyRandomCharacterSkillsTraits, generateAgentName } from '../../characters';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { FleetPosture, changeDiplomaticRelation } from '../../diplomacyTick';
import { raceAggressionLevel, raceCautionLevel } from '../../colonyTick';
import { findNearestAvailableFleet } from '../../fleets/militaryAI';
import { shipGroupAssignMission, type ShipGroup } from '../../fleets/shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, isBuiltObject } from '../../missions/mission';
import { stellarPursuers } from '../../combat/threats';
import { IntelligenceMissionType } from '../../espionage';
import { galaxyRaceByName } from '../../story/storyEvents';
import {
    GAME_DAY_LENGTH,
    gameYear,
    radiusFraction,
    registerScenarioEvent,
    registerScenarioGameStart,
    registerScenarioPeriodic,
    registerScenarioQuery,
    registerScenarioYearly,
} from '../hooks';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../decisions';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { createEmpireMidGame } from '../empireMidGame';
import { HERD_ATTACK_RANGE, type RimHerd, faunaParam, herdMembers, peekRimFaunaState, rimHerdOfCreature, setRimHerdDocile } from '../rimFauna/common';
import { spawnRimHerd, startRimHerdMigration } from '../rimFauna/rimFauna';
import { registerExtraRimGoods } from '../rimTrade/common';
import {
    DEFEND_DAYS,
    HERDER_RACE,
    RIM_HERDERS_FLAG,
    STANDING_ATTACK,
    STANDING_CONQUEST,
    type HerderColony,
    droverWithShip,
    harvestResourceIds,
    herdHostileEmpireIds,
    herdRimGoods,
    herderColonyHerds,
    herderColonyOf,
    herderColonyOfHerd,
    herderParam,
    isHerderEmpire,
    isTamedCreatureShip,
    peekRimHerdersState,
    rimHerdersState,
} from './common';

const DECISION_PROTECTORATE = 'rimHerders.protectorate';
const DECISION_CHARACTERS = 'rimHerders.characters';

function title(): string {
    return scenarioText('Scenario RimHerders Title');
}

function dist(g: Galaxy, a: { xpos: number; ypos: number }, x: number, y: number): number {
    return g.calculateDistance(a.xpos, a.ypos, x, y);
}

/** Active normal empires (no independents, no pirate factions). */
function normalEmpires(galaxy: Galaxy): Empire[] {
    return galaxy.empires.filter((e): e is Empire => e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

function empireById(galaxy: Galaxy, id: number): Empire | null {
    if (id < 0) return null;
    return galaxy.empires.find((e) => e !== null && e.empireId === id) ?? galaxy.pirateEmpires.find((e) => e !== null && e.empireId === id) ?? null;
}

function addStanding(galaxy: Galaxy, empireId: number, delta: number): void {
    const st = rimHerdersState(galaxy);
    st.standing[empireId] = (st.standing[empireId] ?? 0) + delta;
}

/** The empire the colony's herds serve (its current herder owner), or null once conquered / lost. */
function herderOwner(hc: HerderColony): Empire | null {
    if (hc.status !== 'free' && hc.status !== 'protectorate') return null;
    return hc.colony.empire;
}

function systemName(galaxy: Galaxy, systemIndex: number): string {
    return galaxy.systems[systemIndex]?.systemStar.name ?? '';
}

/** Day of the game year (0-359). */
function dayOfYear(starDate: number): number {
    return Math.floor((starDate - gameYear(starDate) * YEAR_LENGTH) / GAME_DAY_LENGTH);
}

/** Points a creature at a target (Creature.cs 1206 CheckForTargets' target set-up: pursuers, cruise speed). */
function setCreatureTarget(c: Creature, target: BuiltObject): void {
    c.currentTarget = target;
    const p = stellarPursuers(target);
    if (!p.includes(c)) p.push(c);
    c.targetSpeed = Math.fround(c.movementSpeed);
}

// ---------------------------------------------------------------------------------------------------------------
// (1) Game start: herder colonies and their herds
// ---------------------------------------------------------------------------------------------------------------

/** Makes an independent colony a herder colony: Ossuvan population, herds spawned in its home range, docile to it. */
export function makeHerderColony(galaxy: Galaxy, colony: Habitat, herdCount: number): HerderColony | null {
    const st = rimHerdersState(galaxy);
    const race = galaxyRaceByName(galaxy, HERDER_RACE);
    if (race === null || colony.empire === null) return null;
    if (herderColonyOf(galaxy, colony) !== null) return herderColonyOf(galaxy, colony);
    for (const p of colony.population.items) p.race = race;
    const hc: HerderColony = {
        colony,
        herdIds: [],
        status: 'free',
        protectorId: -1,
        herderEmpireId: -1,
        conquerorId: -1,
        feralUntil: 0,
        offered: [],
        neighbourSince: {},
        lastAttacker: null,
        defendUntil: 0,
        warnYear: -1,
        warned: [],
        hostile: [],
    };
    const sizeMin = Math.max(1, Math.trunc(faunaParam(galaxy, 'rimFaunaHerdSizeMin')));
    const sizeMax = Math.max(sizeMin, Math.trunc(faunaParam(galaxy, 'rimFaunaHerdSizeMax')));
    for (let k = 0; k < herdCount; k++) {
        const angle = galaxy.rnd.nextDouble() * Math.PI * 2.0;
        const at = { x: colony.xpos + Math.cos(angle) * 3000, y: colony.ypos + Math.sin(angle) * 3000 };
        const herd = spawnRimHerd(galaxy, colony.systemIndex, galaxy.rnd.next(sizeMin, sizeMax + 1), at);
        if (herd !== null) hc.herdIds.push(herd.id);
    }
    // Wild herds already grazing the colony's system join it.
    for (const h of peekRimFaunaState(galaxy)?.herds ?? []) {
        if (h.homeSystemIndex === colony.systemIndex && !hc.herdIds.includes(h.id) && herderColonyOfHerd(galaxy, h) === null) hc.herdIds.push(h.id);
    }
    for (const herd of herderColonyHerds(galaxy, hc)) setRimHerdDocile(galaxy, herd, colony.empire.empireId, true);
    st.colonies.push(hc);
    st.rev++;
    st.stats.herderColonies++;
    return hc;
}

/**
 * Game start (`rimHerders.start`, after `rimFauna.spawn`): independent colonies at radius fraction ≥ rimHerdersRimInner
 * (19a's rim) are the rim independent colonies; rimHerdersCount of them (Fisher-Yates shuffle of the list-order
 * collection, galaxy.rnd, then the first N) become herder colonies. Fewer rim colonies than rimHerdersCount: all of
 * them become herders and a warning is logged. Then the tamed freighters already parked at herder colonies are tagged.
 */
export function rimHerdersGameStart(galaxy: Galaxy): void {
    const inner = herderParam(galaxy, 'rimHerdersRimInner');
    const count = Math.max(0, Math.trunc(herderParam(galaxy, 'rimHerdersCount')));
    const herds = Math.max(0, Math.trunc(herderParam(galaxy, 'rimHerdersHerdsPerColony')));
    const rim: Habitat[] = [];
    for (const colony of galaxy.independentColonies) {
        if (colony.empire !== galaxy.independentEmpire || colony.population.items.length === 0) continue;
        if (radiusFraction(galaxy, colony.xpos, colony.ypos) < inner) continue;
        rim.push(colony);
    }
    if (rim.length < count) {
        console.warn(`rimHerders: rimHerdersCount ${count} exceeds the ${rim.length} rim independent colonies found; all ${rim.length} became herders`);
    }
    // Fisher-Yates shuffle (galaxy.rnd), then take the first N.
    for (let i = rim.length - 1; i > 0; i--) {
        const j = galaxy.rnd.next(0, i + 1);
        [rim[i], rim[j]] = [rim[j], rim[i]];
    }
    for (const colony of rim.slice(0, count)) makeHerderColony(galaxy, colony, herds);
    tagTamedShips(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// (2) Living infrastructure
// ---------------------------------------------------------------------------------------------------------------

function isFreighter(r: BuiltObjectSubRole): boolean {
    return r === BuiltObjectSubRole.SmallFreighter || r === BuiltObjectSubRole.MediumFreighter || r === BuiltObjectSubRole.LargeFreighter;
}

/**
 * Tags the independent freighters parked at an independent herder colony (Galaxy.7.cs 4354 GenerateIndependentTraders
 * builds them at the colony: parentHabitat = the colony until their first mission) as tamed creatures; drops dead ones.
 */
export function tagTamedShips(galaxy: Galaxy): void {
    const st = rimHerdersState(galaxy);
    const ind = galaxy.independentEmpire;
    const before = st.tamed.length;
    st.tamed = st.tamed.filter((b) => !b.hasBeenDestroyed);
    let changed = st.tamed.length !== before;
    if (ind !== null) {
        for (const bo of ind.privateBuiltObjects) {
            if (bo == null || bo.hasBeenDestroyed || !isFreighter(bo.subRole) || st.tamed.includes(bo)) continue;
            const parent = bo.parentHabitat;
            if (parent === null) continue;
            const hc = herderColonyOf(galaxy, parent);
            if (hc === null || hc.status !== 'free' || parent.empire !== ind) continue;
            st.tamed.push(bo);
            changed = true;
        }
    }
    if (changed) st.rev++;
}

// ---------------------------------------------------------------------------------------------------------------
// (3) Harvest and kill drop
// ---------------------------------------------------------------------------------------------------------------

/** Adds `amount` of a resource to a cargo list for `owner`, up to `cap` held (0 = no cap). Returns the amount added. */
function addGoods(list: { items: Cargo[]; add(c: Cargo): void }, resourceId: number, amount: number, owner: Empire | null, cap = 0): number {
    let add = Math.trunc(amount);
    if (cap > 0) {
        const held = list.items.find((c) => c.commodity.resourceId === resourceId && c.empire === owner && c.commodityComponent === null)?.amount ?? 0;
        add = Math.min(add, Math.trunc(cap - held));
    }
    if (add <= 0) return 0;
    list.add(new Cargo(new ResourceRef(resourceId), add, owner));
    return add;
}

/**
 * Sustainable harvest: each herd of a herder colony that is docile to its owner and grazing (not migrating) deposits
 * rimHerdersHarvestPerMember × members of each herd good at the colony (owner's stock, up to rimHerdersStockCap).
 */
export function rimHerdersHarvest(galaxy: Galaxy): number {
    const st = rimHerdersState(galaxy);
    const per = herderParam(galaxy, 'rimHerdersHarvestPerMember');
    const cap = herderParam(galaxy, 'rimHerdersStockCap');
    let total = 0;
    for (const hc of st.colonies) {
        const owner = herderOwner(hc);
        if (owner === null || hc.colony.hasBeenDestroyed) continue;
        for (const herd of herderColonyHerds(galaxy, hc)) {
            if (herd.migration !== null || !herd.docileEmpireIds.includes(owner.empireId)) continue;
            const n = herdMembers(herd).length;
            const ids = harvestResourceIds(galaxy, herd.type);
            if (ids.length === 0) continue;
            if (hc.colony.cargo === null) continue;
            for (const id of ids) total += addGoods(hc.colony.cargo, id, per * n, owner, cap);
        }
    }
    if (total > 0) {
        st.stats.harvests++;
        st.stats.harvested += total;
    }
    return total;
}

/** creatureKilled: a herd creature died — kill record, standing loss, and the kill drop into the killer's hold. No Rnd. */
export function rimHerdersOnCreatureKilled(galaxy: Galaxy, ev: { creature: Creature; killer: unknown; empire: Empire | null }): void {
    const herd = rimHerdOfCreature(galaxy, ev.creature);
    if (herd === null) return;
    const st = rimHerdersState(galaxy);
    st.stats.kills++;
    const e = ev.empire;
    if (e !== null && e !== galaxy.independentEmpire) {
        st.kills.push({ herdId: herd.id, systemIndex: herd.homeSystemIndex, empireId: e.empireId, date: galaxyStarDate(galaxy) });
        if (herderColonyOfHerd(galaxy, herd) !== null && !isHerderEmpire(galaxy, e)) addStanding(galaxy, e.empireId, -herderParam(galaxy, 'rimHerdersStandingKill'));
    }
    const drop = herderParam(galaxy, 'rimHerdersKillDrop');
    const killer = ev.killer;
    if (drop > 0 && isBuiltObject(killer) && killer.cargo !== null && killer.empire !== null) {
        const ids = harvestResourceIds(galaxy, ev.creature.type);
        for (const id of ids) st.stats.dropped += addGoods(killer.cargo, id, drop, killer.empire);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// (1) Herd defence
// ---------------------------------------------------------------------------------------------------------------

/** The colony's herds leave their pasture and turn on the attacker (anchor at the colony, attacker as target). */
function defendColony(galaxy: Galaxy, hc: HerderColony): void {
    const attacker = hc.lastAttacker;
    if (attacker === null || attacker.hasBeenDestroyed) return;
    const range = herderParam(galaxy, 'rimHerdersDefendRange');
    for (const herd of herderColonyHerds(galaxy, hc)) {
        if (herd.migration !== null) continue;
        for (const c of herdMembers(herd)) {
            if (c.anchorPoint === null) c.anchorPoint = { x: Math.trunc(hc.colony.xpos), y: Math.trunc(hc.colony.ypos) };
            c.anchorPoint.x = Math.trunc(hc.colony.xpos);
            c.anchorPoint.y = Math.trunc(hc.colony.ypos);
            c.anchorRange = Math.max(c.anchorRange, range);
            setCreatureTarget(c, attacker);
        }
    }
}

/** habitatAttacked: an attack on a herder colony by a ship its herds are not docile to. No Rnd. */
export function rimHerdersOnHabitatAttacked(galaxy: Galaxy, ev: { habitat: Habitat; attacker: unknown; attackingEmpire: Empire | null }): void {
    const hc = herderColonyOf(galaxy, ev.habitat);
    if (hc === null) return;
    const owner = herderOwner(hc);
    const attacker = ev.attacker;
    if (owner === null || !isBuiltObject(attacker) || attacker.empire === null || attacker.empire === owner) return;
    const herds = herderColonyHerds(galaxy, hc);
    if (herds.length === 0 || herds.every((h) => h.docileEmpireIds.includes(attacker.empire!.empireId))) return;
    const st = rimHerdersState(galaxy);
    const now = galaxyStarDate(galaxy);
    if (hc.defendUntil <= now) {
        st.stats.defences++;
        addStanding(galaxy, attacker.empire.empireId, -STANDING_ATTACK);
        scenarioMessage(galaxy, attacker.empire, title(), scenarioText('Scenario RimHerders Defend', hc.colony.name), { type: EmpireMessageType.GeneralBadEvent, subject: hc.colony });
    }
    hc.lastAttacker = attacker;
    hc.defendUntil = now + DEFEND_DAYS * GAME_DAY_LENGTH;
    defendColony(galaxy, hc);
}

/** Feral / hostile herds hunt the ships of the empires they are aggressive toward (raised attack range). */
function huntHostiles(galaxy: Galaxy, hc: HerderColony, now: number): void {
    const hostile = herdHostileEmpireIds(galaxy, hc, now);
    const mult = herderParam(galaxy, 'rimHerdersFeralRange');
    const feral = hc.status === 'conquered' && hc.feralUntil > now;
    for (const herd of herderColonyHerds(galaxy, hc)) {
        const members = herdMembers(herd);
        for (const c of members) c.attackRange = hostile.length > 0 || feral ? Math.trunc(HERD_ATTACK_RANGE * mult) : HERD_ATTACK_RANGE;
        if (hostile.length === 0) continue;
        const leader = herd.leader!;
        const range = HERD_ATTACK_RANGE * mult;
        let best: BuiltObject | null = null;
        let bestD = range;
        for (const id of hostile) {
            const e = empireById(galaxy, id);
            if (e === null) continue;
            for (const bo of e.builtObjects) {
                if (bo == null || bo.hasBeenDestroyed) continue;
                const d = dist(galaxy, bo, leader.xpos, leader.ypos);
                if (d < bestD) {
                    bestD = d;
                    best = bo;
                }
            }
        }
        if (best === null) continue;
        for (const c of members) if (c.currentTarget === null) setCreatureTarget(c, best);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// (5) Protectorate / conquest / espionage
// ---------------------------------------------------------------------------------------------------------------

/** The protectorate path: the colony becomes a herder empire (adoptOnly) under `protector`'s Protectorate treaty. */
export function formProtectorate(galaxy: Galaxy, hc: HerderColony, protector: Empire): Empire | null {
    if (hc.status !== 'free' || hc.colony.empire === null) return null;
    const st = rimHerdersState(galaxy);
    const oldOwner = hc.colony.empire;
    const tamed = st.tamed.filter((b) => !b.hasBeenDestroyed && b.parentHabitat === hc.colony && b.empire === oldOwner);
    hc.status = 'protectorate'; // before the adoption: its colonyOwnerChanged is not a conquest
    hc.protectorId = protector.empireId;
    const herder = createEmpireMidGame(galaxy, {
        race: HERDER_RACE,
        name: scenarioText('Scenario RimHerders Herder Empire Name', hc.colony.name),
        adoptOnly: true,
        adopt: { colonies: [hc.colony], builtObjects: tamed },
        techLevel: 0.3,
    });
    if (herder === null) {
        hc.status = 'free';
        hc.protectorId = -1;
        return null;
    }
    hc.herderEmpireId = herder.empireId;
    st.tamed = st.tamed.filter((b) => !tamed.includes(b));
    st.rev++;
    // Diplomacy (Empire.8.cs ChangeDiplomaticRelation): the protector offers refuge (initiator = protector).
    changeDiplomaticRelation(galaxy, protector, obtainDiplomaticRelation(protector, herder), DiplomaticRelationType.Protectorate);
    for (const herd of herderColonyHerds(galaxy, hc)) {
        setRimHerdDocile(galaxy, herd, oldOwner.empireId, false);
        setRimHerdDocile(galaxy, herd, herder.empireId, true);
        setRimHerdDocile(galaxy, herd, protector.empireId, true);
    }
    st.stats.protectorates++;
    scenarioMessage(galaxy, protector, title(), scenarioText('Scenario RimHerders Protectorate Formed', hc.colony.name, herder.name), { type: EmpireMessageType.GeneralGoodEvent, subject: hc.colony });
    scenarioNews(galaxy, protector, scenarioText('Scenario RimHerders News Protectorate', hc.colony.name, protector.name));
    return herder;
}

/** Nearest colony of `e` to (x, y) outside system `excludeSystem`. */
function nearestColony(galaxy: Galaxy, e: Empire, x: number, y: number, excludeSystem: number): Habitat | null {
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const c of e.colonies) {
        if (c.systemIndex === excludeSystem) continue;
        const d = dist(galaxy, c, x, y);
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best;
}

/** Feral herds push toward the conqueror: a migration to the conqueror's colony nearest the herd (any distance). */
function migrateTowardConqueror(galaxy: Galaxy, herd: RimHerd, conqueror: Empire): void {
    if (herd.leader === null || herd.migration !== null) return;
    const target = nearestColony(galaxy, conqueror, herd.leader.xpos, herd.leader.ypos, herd.homeSystemIndex);
    if (target === null) return;
    startRimHerdMigration(galaxy, herd, target.systemIndex, false, { x: target.xpos + 4000, y: target.ypos });
}

/** The conquest path: docile flags cleared, herds feral (raised aggression) and migrating toward the conqueror. */
export function herderColonyConquered(galaxy: Galaxy, hc: HerderColony, conqueror: Empire | null): void {
    const st = rimHerdersState(galaxy);
    for (const herd of herderColonyHerds(galaxy, hc)) herd.docileEmpireIds.length = 0;
    st.rev++;
    if (conqueror === null) {
        hc.status = 'lost';
        return;
    }
    hc.status = 'conquered';
    hc.conquerorId = conqueror.empireId;
    hc.feralUntil = galaxyStarDate(galaxy) + herderParam(galaxy, 'rimHerdersFeralYears') * YEAR_LENGTH;
    st.stats.conquests++;
    addStanding(galaxy, conqueror.empireId, -STANDING_CONQUEST);
    for (const herd of herderColonyHerds(galaxy, hc)) migrateTowardConqueror(galaxy, herd, conqueror);
    huntHostiles(galaxy, hc, galaxyStarDate(galaxy));
    scenarioMessage(galaxy, conqueror, title(), scenarioText('Scenario RimHerders Conquered', hc.colony.name), { type: EmpireMessageType.GeneralBadEvent, subject: hc.colony });
    scenarioNews(galaxy, null, scenarioText('Scenario RimHerders News Conquered', hc.colony.name, conqueror.name));
}

/** colonyOwnerChanged: a herder colony taken by a non-herder empire is a conquest. */
export function rimHerdersOnColonyOwnerChanged(galaxy: Galaxy, ev: { colony: Habitat; from: Empire | null; to: Empire | null }): void {
    const hc = herderColonyOf(galaxy, ev.colony);
    if (hc === null || hc.status === 'conquered' || hc.status === 'lost') return;
    if (ev.to !== null && (ev.to === galaxy.independentEmpire || isHerderEmpire(galaxy, ev.to))) return;
    herderColonyConquered(galaxy, hc, ev.to);
}

/** intelMissionCompleted: StealTechData against a herding empire grants the herding craft (19d3 proliferation route). */
export function rimHerdersOnIntelMission(galaxy: Galaxy, ev: { empire: Empire; mission: unknown }): void {
    const m = ev.mission as { type?: number; targetEmpire?: Empire | null } | null;
    if (m === null || m.type !== IntelligenceMissionType.StealTechData) return;
    const target = m.targetEmpire ?? null;
    if (!empireHasHerding(galaxy, target) || empireHasHerding(galaxy, ev.empire)) return;
    const st = rimHerdersState(galaxy);
    st.herding.push(ev.empire.empireId);
    st.stats.herdingStolen++;
    scenarioMessage(galaxy, ev.empire, title(), scenarioText('Scenario RimHerders Herding Stolen', target!.name), { type: EmpireMessageType.GeneralGoodEvent });
}

/** Herder empires and herding thieves hold the craft. */
export function empireHasHerding(galaxy: Galaxy, e: Empire | null): boolean {
    if (e === null) return false;
    if (isHerderEmpire(galaxy, e)) return true;
    return peekRimHerdersState(galaxy)?.herding.includes(e.empireId) ?? false;
}

/** Yearly: each herding thief domesticates the nearest herd to its capital that is not already docile to it. */
export function rimHerdersDomesticate(galaxy: Galaxy, year: number): void {
    const st = rimHerdersState(galaxy);
    const fs = peekRimFaunaState(galaxy);
    if (fs === null) return;
    const now = galaxyStarDate(galaxy);
    for (const id of st.herding) {
        const e = empireById(galaxy, id);
        if (e === null || !e.active || e.capital === null || isHerderEmpire(galaxy, e)) continue;
        if ((st.domesticatedYear[id] ?? -1) >= year) continue;
        let best: RimHerd | null = null;
        let bestD = Number.MAX_VALUE;
        for (const herd of fs.herds) {
            if (herd.leader === null || herd.docileEmpireIds.includes(id)) continue;
            const hc = herderColonyOfHerd(galaxy, herd);
            if (hc !== null && herdHostileEmpireIds(galaxy, hc, now).includes(id)) continue;
            const d = dist(galaxy, herd.leader, e.capital.xpos, e.capital.ypos);
            if (d < bestD) {
                bestD = d;
                best = herd;
            }
        }
        if (best === null) continue;
        setRimHerdDocile(galaxy, best, id, true);
        st.domesticatedYear[id] = year;
        st.stats.domesticated++;
        scenarioMessage(galaxy, e, title(), scenarioText('Scenario RimHerders Domesticated', systemName(galaxy, best.homeSystemIndex)), { type: EmpireMessageType.GeneralGoodEvent });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// (4) Drovers and guides
// ---------------------------------------------------------------------------------------------------------------

/** Drover location: the lead ship of the empire's first fleet, else the capital. Guide: an explorer, else the capital. */
function characterLocation(e: Empire, kind: 'drover' | 'guide'): BuiltObject | Habitat | null {
    if (kind === 'drover') {
        for (const g of e.shipGroups as ShipGroup[]) if (g !== null && g.leadShip !== null && !g.leadShip.hasBeenDestroyed) return g.leadShip;
    } else {
        const explorer = e.builtObjects.find((b) => b != null && !b.hasBeenDestroyed && b.subRole === BuiltObjectSubRole.ExplorationShip);
        if (explorer !== undefined) return explorer;
    }
    return e.capital;
}

/** A herder character joins `e` (Character ctor + Empire.6.cs GenerateNewCharacter's random skills / traits + Activate). */
export function herderCharacterJoins(galaxy: Galaxy, e: Empire, kind: 'drover' | 'guide'): Character | null {
    const race = galaxyRaceByName(galaxy, HERDER_RACE);
    const loc = characterLocation(e, kind);
    if (race === null || loc === null) return null;
    const role = kind === 'drover' ? CharacterRole.FleetAdmiral : CharacterRole.ShipCaptain;
    const c = new Character(generateAgentName(galaxy, e, race), role, '', race, e, loc, 0);
    applyRandomCharacterSkillsTraits(galaxy, e, c, false);
    c.activate(galaxy, e, loc);
    const st = rimHerdersState(galaxy);
    st.characters.push({ character: c, kind, empireId: e.empireId });
    st.stats.charactersJoined++;
    const label = scenarioText(kind === 'drover' ? 'Scenario RimHerders Drover' : 'Scenario RimHerders Guide');
    scenarioMessage(galaxy, e, title(), scenarioText('Scenario RimHerders Character Joined', c.name, label), { type: EmpireMessageType.CharacterAppearance, subject: c });
    return c;
}

/** Characters leave empires whose standing fell below rimHerdersLeaveStanding. */
export function reviewCharactersLeave(galaxy: Galaxy): void {
    const st = rimHerdersState(galaxy);
    const floor = herderParam(galaxy, 'rimHerdersLeaveStanding');
    for (const hc of [...st.characters]) {
        const c = hc.character;
        const gone = !c.active || c.empire === null;
        if (!gone && (st.standing[hc.empireId] ?? 0) >= floor) continue;
        st.characters.splice(st.characters.indexOf(hc), 1);
        if (gone) continue;
        const e = c.empire!;
        c.completeEmpireChange(null);
        c.completeLocationTransfer(null, null);
        st.stats.charactersLeft++;
        // Leaving lets the empire be offered again once goodwill recovers.
        const i = st.charactersOffered.indexOf(hc.empireId);
        if (i >= 0 && !st.characters.some((x) => x.empireId === hc.empireId)) st.charactersOffered.splice(i, 1);
        scenarioMessage(galaxy, e, title(), scenarioText('Scenario RimHerders Character Left', c.name), { type: EmpireMessageType.GeneralBadEvent });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// (6) Migration-season warnings
// ---------------------------------------------------------------------------------------------------------------

/** Friendly empires: the protector, or neighbours with positive standing. */
function friendlyEmpires(galaxy: Galaxy, hc: HerderColony): Empire[] {
    const st = rimHerdersState(galaxy);
    return normalEmpires(galaxy).filter((e) => !isHerderEmpire(galaxy, e) && (e.empireId === hc.protectorId || ((st.standing[e.empireId] ?? 0) > 0 && hc.neighbourSince[e.empireId] !== undefined)));
}

/** The corridor of a colony's herds: their home points and migration targets. */
function corridorPoints(galaxy: Galaxy, hc: HerderColony): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (const herd of herderColonyHerds(galaxy, hc)) {
        pts.push({ x: herd.homeX, y: herd.homeY });
        if (herd.migration !== null) pts.push({ x: herd.migration.x, y: herd.migration.y });
    }
    return pts;
}

/** The warning: herders ask friendly empires to take their warships out of the corridor before the season. */
export function rimHerdersWarn(galaxy: Galaxy, year: number): number {
    const st = rimHerdersState(galaxy);
    let n = 0;
    for (const hc of st.colonies) {
        if (herderOwner(hc) === null) continue;
        hc.warnYear = year;
        hc.warned = [];
        const where = [...new Set(herderColonyHerds(galaxy, hc).map((h) => systemName(galaxy, h.homeSystemIndex)))].join(', ');
        for (const e of friendlyEmpires(galaxy, hc)) {
            hc.warned.push(e.empireId);
            n++;
            scenarioMessage(galaxy, e, title(), scenarioText('Scenario RimHerders Migration Warning', hc.colony.name, where), { type: EmpireMessageType.RemoveForcesFromSystem, subject: hc.colony });
        }
    }
    st.stats.warnings += n;
    return n;
}

/** Season check: warned empires with warships in the corridor lose standing (and relations) and draw herd aggression. */
export function rimHerdersSeasonCheck(galaxy: Galaxy, year: number): number {
    const st = rimHerdersState(galaxy);
    const now = galaxyStarDate(galaxy);
    const radius = herderParam(galaxy, 'rimHerdersCorridor');
    const r2 = radius * radius;
    let ignored = 0;
    for (const hc of st.colonies) {
        if (hc.warnYear !== year || hc.warned.length === 0 || herderOwner(hc) === null) continue;
        const pts = corridorPoints(galaxy, hc);
        for (const id of hc.warned) {
            const e = empireById(galaxy, id);
            if (e === null) continue;
            const inCorridor = e.builtObjects.some((b) => b != null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && pts.some((p) => galaxy.calculateDistanceSquared(b.xpos, b.ypos, p.x, p.y) <= r2));
            if (!inCorridor) continue;
            ignored++;
            addStanding(galaxy, id, -herderParam(galaxy, 'rimHerdersWarnPenalty'));
            hc.hostile = hc.hostile.filter((h) => h.empireId !== id && h.until > now);
            hc.hostile.push({ empireId: id, until: now + YEAR_LENGTH });
            for (const herd of herderColonyHerds(galaxy, hc)) setRimHerdDocile(galaxy, herd, id, false);
            const herderEmpire = empireById(galaxy, hc.herderEmpireId);
            if (herderEmpire !== null && herderEmpire.active) {
                const ev = obtainEmpireEvaluation(galaxy, herderEmpire, e);
                ev.incidentEvaluation = ev.incidentEvaluationRaw - herderParam(galaxy, 'rimHerdersWarnPenalty');
            }
            const where = [...new Set(herderColonyHerds(galaxy, hc).map((h) => systemName(galaxy, h.homeSystemIndex)))].join(', ');
            scenarioMessage(galaxy, e, title(), scenarioText('Scenario RimHerders Warning Ignored', where, hc.colony.name), { type: EmpireMessageType.GeneralBadEvent, subject: hc.colony });
        }
        huntHostiles(galaxy, hc, now);
    }
    st.stats.warningsIgnored += ignored;
    return ignored;
}

// ---------------------------------------------------------------------------------------------------------------
// (7) AI: cautious races take the protectorate, aggressive ones conquer
// ---------------------------------------------------------------------------------------------------------------

/** Race caution vs. aggression (Race.cs 368 CautionLevel / 348 AggressionLevel). */
export function empirePrefersProtectorate(galaxy: Galaxy, e: Empire): boolean {
    const race = e.dominantRace;
    if (race === null) return false;
    return raceCautionLevel(galaxy, race) >= raceAggressionLevel(galaxy, race);
}

/**
 * The conquest order itself: `e`'s nearest available attack fleet gets an Attack mission on the herder colony
 * (FindNearestAvailableFleet + ShipGroup.AssignMission, as Empire.4.cs 4449 InvadeUnwillingColonizationTargets). False
 * when no fleet is free. Also the 19s-3 model-chosen conquest path (sim/scenario/llm/strategic.ts).
 */
export function orderHerderConquest(galaxy: Galaxy, hc: HerderColony, e: Empire): boolean {
    const fleet = findNearestAvailableFleet(galaxy, e, hc.colony.xpos, hc.colony.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Attack, true, 0.1, false, false, false, true, 40000);
    if (fleet === null || fleet.leadShip === null) return false;
    shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Attack, hc.colony, null, BuiltObjectMissionPriority.High, false);
    return true;
}

/**
 * An aggressive AI neighbour moves on a free herder colony: the nearest available attack fleet gets an Attack mission on
 * it, as Empire.4.cs 4449 InvadeUnwillingColonizationTargets does for an unwilling independent (FindNearestAvailableFleet
 * + ShipGroup.AssignMission). One NextDouble per candidate (rimHerdersConquestChance).
 */
export function rimHerdersAiConquest(galaxy: Galaxy): number {
    const st = rimHerdersState(galaxy);
    const chance = herderParam(galaxy, 'rimHerdersConquestChance');
    let orders = 0;
    for (const hc of st.colonies) {
        if (hc.status !== 'free' || hc.colony.hasBeenDestroyed) continue;
        for (const e of normalEmpires(galaxy)) {
            if (e === galaxy.playerEmpire || isHerderEmpire(galaxy, e) || hc.neighbourSince[e.empireId] === undefined || empirePrefersProtectorate(galaxy, e)) continue;
            if (galaxy.rnd.nextDouble() >= chance) continue;
            if (!orderHerderConquest(galaxy, hc, e)) continue;
            orders++;
            break;
        }
    }
    st.stats.conquestOrders += orders;
    return orders;
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly tick
// ---------------------------------------------------------------------------------------------------------------

/** Neighbours: normal empires with a colony within rimHerdersContactRange of the herder colony. */
function reviewNeighbours(galaxy: Galaxy, hc: HerderColony, now: number): Empire[] {
    const range = herderParam(galaxy, 'rimHerdersContactRange');
    const out: Empire[] = [];
    for (const e of normalEmpires(galaxy)) {
        if (isHerderEmpire(galaxy, e)) continue;
        const near = e.colonies.some((c) => c !== hc.colony && dist(galaxy, c, hc.colony.xpos, hc.colony.ypos) <= range);
        if (!near) {
            delete hc.neighbourSince[e.empireId];
            continue;
        }
        if (hc.neighbourSince[e.empireId] === undefined) hc.neighbourSince[e.empireId] = now;
        out.push(e);
    }
    return out;
}

function lastKillIn(galaxy: Galaxy, hc: HerderColony, empireId: number): number {
    const st = rimHerdersState(galaxy);
    let last = -1;
    for (const k of st.kills) {
        if (k.empireId !== empireId) continue;
        if (!hc.herdIds.includes(k.herdId) && k.systemIndex !== hc.colony.systemIndex) continue;
        if (k.date > last) last = k.date;
    }
    return last;
}

/** Protect path: a neighbour that has not killed in this colony's herd ranges for rimHerdersProtectYears gets the offer. */
export function rimHerdersProtectorateOffers(galaxy: Galaxy): number {
    const st = rimHerdersState(galaxy);
    const now = galaxyStarDate(galaxy);
    const years = herderParam(galaxy, 'rimHerdersProtectYears');
    const window = years * YEAR_LENGTH;
    let n = 0;
    for (let i = 0; i < st.colonies.length; i++) {
        const hc = st.colonies[i];
        if (hc.status !== 'free') continue;
        const cand = normalEmpires(galaxy)
            .filter((e) => !isHerderEmpire(galaxy, e) && !hc.offered.includes(e.empireId) && hc.neighbourSince[e.empireId] !== undefined)
            .filter((e) => now - hc.neighbourSince[e.empireId] >= window && now - Math.max(0, lastKillIn(galaxy, hc, e.empireId)) >= window)
            .sort((a, b) => (st.standing[b.empireId] ?? 0) - (st.standing[a.empireId] ?? 0) || a.empireId - b.empireId);
        const e = cand[0];
        if (e === undefined) continue;
        hc.offered.push(e.empireId);
        n++;
        raiseScenarioDecision(galaxy, e, {
            kind: DECISION_PROTECTORATE,
            title: title(),
            text: scenarioText('Scenario RimHerders Protectorate Offer', hc.colony.name, years),
            options: [
                { id: 'accept', label: scenarioText('Scenario RimHerders Protectorate Accept') },
                { id: 'decline', label: scenarioText('Scenario RimHerders Protectorate Decline') },
            ],
            defaultOption: 'decline',
            expiresDays: 90,
            context: { colonyIndex: i },
        });
    }
    return n;
}

/** Character offers to empires in good standing (once each until they leave). */
export function offerCharacters(galaxy: Galaxy): void {
    const st = rimHerdersState(galaxy);
    const need = herderParam(galaxy, 'rimHerdersCharacterStanding');
    for (const e of normalEmpires(galaxy)) {
        if (isHerderEmpire(galaxy, e) || st.charactersOffered.includes(e.empireId) || (st.standing[e.empireId] ?? 0) < need) continue;
        st.charactersOffered.push(e.empireId);
        raiseScenarioDecision(galaxy, e, {
            kind: DECISION_CHARACTERS,
            title: title(),
            text: scenarioText('Scenario RimHerders Characters Offer'),
            options: [
                { id: 'accept', label: scenarioText('Scenario RimHerders Characters Accept') },
                { id: 'decline', label: scenarioText('Scenario RimHerders Characters Decline') },
            ],
            defaultOption: 'accept',
            expiresDays: 90,
        });
    }
}

/** Protectorates pay rimHerdersTribute of their herd-goods stock to the protector's capital. */
export function rimHerdersTribute(galaxy: Galaxy): number {
    const st = rimHerdersState(galaxy);
    const share = herderParam(galaxy, 'rimHerdersTribute');
    let total = 0;
    for (const hc of st.colonies) {
        if (hc.status !== 'protectorate' || hc.colony.cargo === null) continue;
        const protector = empireById(galaxy, hc.protectorId);
        const herder = hc.colony.empire;
        if (protector === null || !protector.active || protector.capital === null || protector.capital.cargo === null || herder === null) continue;
        const paid: string[] = [];
        for (const id of harvestResourceIds(galaxy)) {
            const c = hc.colony.cargo.items.find((x) => x.commodity.resourceId === id && x.empire === herder && x.commodityComponent === null);
            if (c === undefined) continue;
            const amount = Math.trunc(c.amount * share);
            if (amount <= 0) continue;
            c.amount -= amount;
            protector.capital.cargo.add(new Cargo(new ResourceRef(id), amount, protector));
            total += amount;
            paid.push(`${amount} ${galaxy.resourceSystem.byId.get(id)?.name ?? id}`);
        }
        if (paid.length > 0) {
            st.stats.tributes++;
            scenarioMessage(galaxy, protector, title(), scenarioText('Scenario RimHerders Tribute', herder.name, paid.join(', ')), { type: EmpireMessageType.GeneralGoodEvent, subject: hc.colony });
        }
    }
    return total;
}

/** The yearly tick (`rimHerders.year`). */
export function rimHerdersYear(galaxy: Galaxy, year: number): void {
    const st = rimHerdersState(galaxy);
    const now = galaxyStarDate(galaxy);
    const gain = herderParam(galaxy, 'rimHerdersStandingGain');
    const neighbours = new Set<Empire>();
    for (const hc of st.colonies) {
        if (hc.status === 'free' || hc.status === 'protectorate') for (const e of reviewNeighbours(galaxy, hc, now)) neighbours.add(e);
        if (hc.status === 'protectorate') {
            const p = empireById(galaxy, hc.protectorId);
            if (p !== null && p.active) neighbours.add(p);
        }
    }
    // Goodwill: peaceful neighbours (no herd kills this past year) gain standing.
    for (const e of [...neighbours].sort((a, b) => a.empireId - b.empireId)) {
        if (!st.kills.some((k) => k.empireId === e.empireId && now - k.date < YEAR_LENGTH)) addStanding(galaxy, e.empireId, gain);
    }
    const window = herderParam(galaxy, 'rimHerdersProtectYears') * YEAR_LENGTH;
    st.kills = st.kills.filter((k) => now - k.date <= window);
    for (const hc of st.colonies) {
        hc.hostile = hc.hostile.filter((h) => h.until > now);
        if (hc.status === 'conquered' && hc.feralUntil > 0 && hc.feralUntil <= now) {
            hc.feralUntil = 0;
            huntHostiles(galaxy, hc, now);
            const c = empireById(galaxy, hc.conquerorId);
            if (c !== null) scenarioMessage(galaxy, c, title(), scenarioText('Scenario RimHerders Feral Calm', hc.colony.name), { type: EmpireMessageType.GeneralGoodEvent });
        }
    }
    reviewCharactersLeave(galaxy);
    offerCharacters(galaxy);
    rimHerdersProtectorateOffers(galaxy);
    rimHerdersTribute(galaxy);
    rimHerdersDomesticate(galaxy, year);
    rimHerdersAiConquest(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic tick (every long block, after rimFauna.herds)
// ---------------------------------------------------------------------------------------------------------------

export function rimHerdersTick(galaxy: Galaxy): void {
    const st = rimHerdersState(galaxy);
    const now = galaxyStarDate(galaxy);
    const year = gameYear(now);
    tagTamedShips(galaxy);
    // Herd membership: fauna herds born in a herder colony's system later (none split today) stay wild; dead herds drop out.
    const fs = peekRimFaunaState(galaxy);
    if (fs !== null) {
        for (const hc of st.colonies) {
            const live = hc.herdIds.filter((id) => fs.herds.some((h) => h.id === id));
            if (live.length !== hc.herdIds.length) {
                hc.herdIds = live;
                st.rev++;
            }
        }
    }
    const harvestDays = Math.max(1, herderParam(galaxy, 'rimHerdersHarvestDays'));
    if (st.lastHarvest < 0) st.lastHarvest = now;
    else if (now - st.lastHarvest >= harvestDays * GAME_DAY_LENGTH) {
        st.lastHarvest = now;
        rimHerdersHarvest(galaxy);
    }
    // Migration season: warn rimHerdersWarnDays before rimFaunaMigrationDay; check the corridors once the season ran.
    const day = dayOfYear(now);
    const seasonDay = faunaParam(galaxy, 'rimFaunaMigrationDay');
    const warnDay = Math.max(0, seasonDay - herderParam(galaxy, 'rimHerdersWarnDays'));
    if (year > st.lastWarnYear && day >= warnDay && day < seasonDay) {
        st.lastWarnYear = year;
        rimHerdersWarn(galaxy, year);
    }
    if (fs !== null && fs.lastMigrationYear === year && st.lastSeasonYear < year) {
        st.lastSeasonYear = year;
        rimHerdersSeasonCheck(galaxy, year);
        // Feral herds migrate harder into the conqueror's space every season.
        for (const hc of st.colonies) {
            if (hc.status !== 'conquered' || hc.feralUntil <= now) continue;
            const c = empireById(galaxy, hc.conquerorId);
            if (c === null || !c.active) continue;
            for (const herd of herderColonyHerds(galaxy, hc)) migrateTowardConqueror(galaxy, herd, c);
        }
    }
    for (const hc of st.colonies) {
        if (hc.defendUntil > now && herderOwner(hc) !== null) defendColony(galaxy, hc);
        huntHostiles(galaxy, hc, now);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------------------------

function resolveProtectorate(galaxy: Galaxy, d: ScenarioDecision, option: string): void {
    if (option !== 'accept') return;
    const hc = rimHerdersState(galaxy).colonies[d.context.colonyIndex as number];
    if (hc === undefined || !d.empire.active) return;
    formProtectorate(galaxy, hc, d.empire);
}

function resolveCharacters(galaxy: Galaxy, d: ScenarioDecision, option: string): void {
    if (option !== 'accept' || !d.empire.active) return;
    herderCharacterJoins(galaxy, d.empire, 'drover');
    herderCharacterJoins(galaxy, d.empire, 'guide');
}

// ---------------------------------------------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------------------------------------------

registerExtraRimGoods(herdRimGoods);
registerScenarioGameStart({ id: 'rimHerders.start', flag: RIM_HERDERS_FLAG, run: (g) => rimHerdersGameStart(g) });
registerScenarioPeriodic({ id: 'rimHerders.tick', flag: RIM_HERDERS_FLAG, periodDays: 1, run: (g) => rimHerdersTick(g) });
registerScenarioYearly({ id: 'rimHerders.year', flag: RIM_HERDERS_FLAG, run: (g, y) => rimHerdersYear(g, y) });
registerScenarioEvent({ id: 'rimHerders.kill', flag: RIM_HERDERS_FLAG, event: 'creatureKilled', run: rimHerdersOnCreatureKilled });
registerScenarioEvent({ id: 'rimHerders.defend', flag: RIM_HERDERS_FLAG, event: 'habitatAttacked', run: rimHerdersOnHabitatAttacked });
registerScenarioEvent({ id: 'rimHerders.owner', flag: RIM_HERDERS_FLAG, event: 'colonyOwnerChanged', run: rimHerdersOnColonyOwnerChanged });
registerScenarioEvent({ id: 'rimHerders.intel', flag: RIM_HERDERS_FLAG, event: 'intelMissionCompleted', run: rimHerdersOnIntelMission });
registerScenarioQuery({ id: 'rimHerders.storm', flag: RIM_HERDERS_FLAG, query: 'builtObjectStormImmune', run: (g, v, a) => v || isTamedCreatureShip(g, a.builtObject) });
registerScenarioQuery({ id: 'rimHerders.fuel', flag: RIM_HERDERS_FLAG, query: 'builtObjectSelfFuelling', run: (g, v, a) => v || isTamedCreatureShip(g, a.builtObject) });
registerScenarioQuery({
    id: 'rimHerders.ignore',
    flag: RIM_HERDERS_FLAG,
    query: 'creatureIgnoresTarget',
    run: (g, v, a) => {
        const herd = rimHerdOfCreature(g, a.creature);
        if (herd === null) return v;
        const target = a.target;
        const empire = (target as { empire?: Empire | null }).empire ?? null;
        const hc = herderColonyOfHerd(g, herd);
        // Hostility (feral after a conquest, an ignored warning) overrides docility and drovers.
        if (hc !== null && empire !== null && herdHostileEmpireIds(g, hc, galaxyStarDate(g)).includes(empire.empireId)) return false;
        if (v) return true;
        return isBuiltObject(target) && droverWithShip(g, target);
    },
});
registerScenarioDecision({ id: DECISION_PROTECTORATE, kind: DECISION_PROTECTORATE, flag: RIM_HERDERS_FLAG, resolve: resolveProtectorate, aiChoose: (g, d) => (empirePrefersProtectorate(g, d.empire) ? 'accept' : 'decline') });
registerScenarioDecision({ id: DECISION_CHARACTERS, kind: DECISION_CHARACTERS, flag: RIM_HERDERS_FLAG, resolve: resolveCharacters, aiChoose: () => 'accept' });

