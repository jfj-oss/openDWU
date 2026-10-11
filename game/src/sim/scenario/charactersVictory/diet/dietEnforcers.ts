// The Interstellar Diet's enforcer blockades (docs/CHARACTERS_AND_VICTORY.md §7.4). Not a port; every stock piece is
// ported code: the faction is a mid-game empire (scenario/empireMidGame.ts createEmpireMidGame through the threat
// framework's createThreatFaction, analogue Galaxy.8.cs 1348 GenerateShakturi) kept out of every stock AI decision like
// the Exchange; its ships are copies of the members' current designs (designGeneration.ts findNewestCanBuild,
// independentTraders.ts cloneDesign) placed as CreateIndependentTrader places a ship (Empire.addBuiltObjectToGalaxy);
// the fleet is a stock ShipGroup (Empire.8.cs 2673-2700) sent with the real Blockade mission (Empire.8.cs 3748
// ImplementBlockade → BuiltObject.2.cs 540 Blockade → SetupBlockade); its targets are filtered by the real
// WithinFuelRangeAndRefuel (BuiltObject.1.cs 2479). Stance AttackIfAttacked (BuiltObjectStance.cs): it only returns
// fire, and the blockade does not attack docking ships (the blockadeEngagesDocking query).
//
// Rnd: galaxy.rnd only in the gated handlers (ship names / headings / parking points, the weighted station draw).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { Design } from '../../../design';
import { BuiltObject } from '../../../builtObject';
import { BuiltObjectStance } from '../../../design';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { BuiltObjectFleeWhen } from '../../../data/designSpecifications';
import { cloneDesign } from '../../../independentTraders';
import { findNewestCanBuild } from '../../../designGeneration';
import { ShipGroup, disbandShipGroup } from '../../../fleets/shipGroup';
import { compareShipGroups, getNextFleetNumberDescription, shipGroupAddShipToFleet, shipGroupUpdate } from '../../../fleets/shipGroupTasks';
import { netSort } from '../../../netSort';
import { FleetPosture, declareWar } from '../../../diplomacyTick';
import { DiplomaticRelationType } from '../../../diplomacy';
import { implementBlockadeBuiltObject, implementBlockadeColony, blockadeFor } from '../../../fleets/blockades';
import { determineSpacePortAtColony } from '../../../combat/attackAI';
import { withinFuelRangeAndRefuel } from '../../../movement';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { calculateRelativeEmpireMilitaryStrength } from '../../../empireEvents';
import { AutomationLevel } from '../../../empire';
import { strategicValue } from '../../../territory';
import { EmpireMessageType } from '../../../messages';
import { BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { galaxyStarDate } from '../../../tick/simTime';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { calculateEmpireScore } from '../../../achievements';
import { createThreatFaction } from '../../threats/framework';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import type { Council } from '../../emergent/council';
import { type DietEnforcerFleet, type DietState, byId, dietParam } from './dietState';
import { personality } from './dietAi';

/** The base blockade unit (the user's composition): 6 cruisers, 2 carriers, 2 battleships, 2 resupply ships. */
export const ENFORCER_UNIT: readonly [BuiltObjectSubRole, number][] = [
    [BuiltObjectSubRole.Cruiser, 6],
    [BuiltObjectSubRole.Carrier, 2],
    [BuiltObjectSubRole.CapitalShip, 2],
    [BuiltObjectSubRole.ResupplyShip, 2],
];
/** Substitutes when no member can build a sub-role (carriers / capital ships are research-gated). */
const FALLBACK: Partial<Record<BuiltObjectSubRole, BuiltObjectSubRole[]>> = {
    [BuiltObjectSubRole.Carrier]: [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer],
    [BuiltObjectSubRole.CapitalShip]: [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer],
    [BuiltObjectSubRole.Cruiser]: [BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate],
};
/** A fleet is on station within this distance of its target (world units; ParentRelativeRange × 4). */
const STATION_RANGE = 2800;

/** Is `e` the Diet Enforcers faction? Pure. */
export function isEnforcerFaction(st: DietState | null, e: Empire | null): boolean {
    return st !== null && e !== null && st.faction === e;
}

/** The enforcer fleet `bo` belongs to (null: none). Pure. */
export function enforcerFleetOf(st: DietState | null, bo: BuiltObject): DietEnforcerFleet | null {
    if (st === null || st.faction === null || bo.actualEmpire !== st.faction) return null;
    for (const f of st.enforcers) if (f.ships.includes(bo)) return f;
    return null;
}

function switchOffStockAi(f: Empire): void {
    // As the Exchange (threats/exchange.ts switchOffStockAi): no stock colonisation, diplomacy, attacks or construction.
    f.controlColonization = AutomationLevel.Undefined;
    f.controlColonyDevelopment = false;
    f.controlColonyStockLevels = false;
    f.controlColonyTaxRates = false;
    f.controlDiplomacyGifts = AutomationLevel.Undefined;
    f.controlDiplomacyOffense = AutomationLevel.Undefined;
    f.controlDiplomacyTreaties = AutomationLevel.Undefined;
    f.controlMilitaryAttacks = AutomationLevel.Undefined;
    f.controlMilitaryFleets = false;
    f.controlStateConstruction = AutomationLevel.Undefined;
    f.controlTroopGeneration = false;
    f.controlAgentAssignment = AutomationLevel.Undefined;
    f.controlColonyFacilities = AutomationLevel.Undefined;
    f.controlPopulationPolicy = false;
    f.controlCharacterLocations = false;
    f.controlOfferPirateMissions = AutomationLevel.Undefined;
    f.controlDesigns = false;
    f.initiateConstruction = false;
}

/** The faction (created on the first sanction). Null when the galaxy has no empire id left. */
export function ensureFaction(galaxy: Galaxy, st: DietState, world: Habitat, host: Empire): Empire | null {
    if (st.faction !== null && st.faction.active) return st.faction;
    const race = host.dominantRace;
    if (race === null) return null;
    const f = createThreatFaction(galaxy, {
        race,
        name: scenarioText('Diet Enforcers Name'),
        relationBias: 0,
        enemies: [],
        configurePolicy: (p) => {
            p.tradeWithOtherEmpires = false;
            p.warAttacksAllowColonyBombardment = 0;
            p.warAttacksAllowPlanetDestroying = 0;
        },
    });
    if (f === null) return null;
    // Stock AI reads Empire.Capital without a null check (19b precedent): the host world stands in.
    f.capital = world;
    switchOffStockAi(f);
    st.faction = f;
    return f;
}

/** The members' current designs of `subRole`, strongest member first (the Diet's ships come from its members' yards). */
function memberDesigns(galaxy: Galaxy, members: readonly Empire[], target: Empire, subRole: BuiltObjectSubRole): Design[] {
    const ranked = members.filter((m) => m !== target && m.active).sort((a, b) => calculateEmpireScore(galaxy, b).score - calculateEmpireScore(galaxy, a).score || byId(a, b));
    const out: Design[] = [];
    for (const m of ranked) {
        const d = findNewestCanBuild(m.designs, subRole, m);
        if (d !== null) out.push(d);
    }
    return out;
}

/** The enforcer copy of a member design: the faction's, AttackIfAttacked (return fire only). */
function enforcerDesign(galaxy: Galaxy, faction: Empire, source: Design, cache: Map<Design, Design>): Design {
    const hit = cache.get(source);
    if (hit !== undefined) return hit;
    const d = cloneDesign(source);
    d.empire = faction;
    d.stance = BuiltObjectStance.AttackIfAttacked;
    d.fleeWhen = BuiltObjectFleeWhen.Never;
    d.name = `${scenarioText('Diet Enforcer Prefix')} ${source.name}`;
    void galaxy;
    cache.set(source, d);
    return d;
}

function placeShip(galaxy: Galaxy, faction: Empire, design: Design, world: Habitat): BuiltObject {
    design.buildCount++;
    const bo = new BuiltObject(design, galaxy.generateBuiltObjectName(design, world), galaxy, true);
    bo.empire = faction;
    bo.purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
    bo.reDefine();
    bo.currentFuel = bo.fuelCapacity;
    bo.currentShields = bo.shieldsCapacity;
    bo.heading = galaxy.selectRandomHeading();
    bo.targetHeading = bo.heading;
    bo.nearestSystemStar = galaxy.determineHabitatSystemStar(world);
    const pt = galaxy.selectRelativeParkingPoint();
    faction.addBuiltObjectToGalaxy(bo, world, false, true, Math.trunc(pt.x), Math.trunc(pt.y), false);
    bo.isAutoControlled = false;
    bo.supportCostFactor = 0;
    return bo;
}

/** Members pay `amount` in shares of their CalculateEmpireScore (never the sanctioned target), each at most what it has. */
export function collectDues(galaxy: Galaxy, st: DietState, members: readonly Empire[], exclude: Empire | null, amount: number): number {
    const payers = members.filter((m) => m !== exclude && m.active);
    let total = 0;
    const scores = new Map<Empire, number>();
    for (const m of payers) {
        const s = Math.max(1, calculateEmpireScore(galaxy, m).score);
        scores.set(m, s);
        total += s;
    }
    let paid = 0;
    const cap = dietParam(galaxy, 'dietDuesMaxPct') / 100;
    for (const m of payers) {
        const want = (amount * scores.get(m)!) / Math.max(1, total);
        const pay = Math.max(0, Math.min(want, m.stateMoney * cap * 4, m.stateMoney));
        if (pay <= 0) continue;
        m.stateMoney -= pay;
        paid += pay;
        if (isHumanEmpire(galaxy, m)) scenarioMessage(galaxy, m, scenarioText('Diet Dues Title'), scenarioText('Diet Dues', Math.round(pay)), { type: EmpireMessageType.GeneralNeutralEvent, popup: false });
    }
    st.fund += paid;
    st.counters.duesPaid += paid;
    return paid;
}

/**
 * One enforcer fleet for sanctioned `target`: the base unit × 1..dietEnforcerScaleMax by the target's real relative
 * military strength (Empire.7.cs 4120), from the members' current designs, at the host world. Paid from the Diet fund
 * (dues collected now). Null: no faction id left, no designs, or the target has no colonies.
 */
export function spawnEnforcers(galaxy: Galaxy, st: DietState, c: Council, target: Empire): DietEnforcerFleet | null {
    if (st.enforcers.some((f) => f.target === target)) return null;
    if (st.world === null || st.host === null || target.colonies.length === 0) return null;
    const faction = ensureFaction(galaxy, st, st.world, st.host);
    if (faction === null) {
        st.counters.enforcerOutcomes.noFaction = (st.counters.enforcerOutcomes.noFaction ?? 0) + 1;
        return null;
    }
    const scale = Math.max(1, Math.min(dietParam(galaxy, 'dietEnforcerScaleMax'), calculateRelativeEmpireMilitaryStrength(galaxy, target)));
    const cache = new Map<Design, Design>();
    const plan: Design[] = [];
    for (const [role, n] of ENFORCER_UNIT) {
        const count = Math.max(1, Math.round(n * scale));
        let designs = memberDesigns(galaxy, c.members, target, role);
        for (const alt of FALLBACK[role] ?? []) if (designs.length === 0) designs = memberDesigns(galaxy, c.members, target, alt);
        if (designs.length === 0) continue;
        for (let i = 0; i < count; i++) plan.push(designs[i % designs.length]);
    }
    if (plan.length === 0) {
        st.counters.enforcerOutcomes.noDesigns = (st.counters.enforcerOutcomes.noDesigns ?? 0) + 1;
        return null;
    }
    let cost = 0;
    for (const d of plan) cost += d.calculateCurrentPurchasePrice(galaxy);
    cost *= dietParam(galaxy, 'dietEnforcerCostPct') / 100;
    if (st.fund < cost) collectDues(galaxy, st, c.members, target, cost - st.fund);
    st.fund = Math.max(0, st.fund - cost);
    const ships = plan.map((d) => placeShip(galaxy, faction, enforcerDesign(galaxy, faction, d, cache), st.world!));
    const sg = new ShipGroup(galaxy);
    sg.empire = faction;
    sg.shipTargetAmount = ships.length;
    sg.troopTargetStrength = 0;
    sg.gatherPoint = st.world;
    sg.posture = FleetPosture.Defend;
    for (const b of ships) shipGroupAddShipToFleet(galaxy, sg, b);
    shipGroupUpdate(galaxy, sg);
    sg.name = `${getNextFleetNumberDescription(faction)} ${scenarioText('Diet Enforcer Fleet')}`;
    const groups = faction.shipGroups as ShipGroup[];
    groups.push(sg);
    netSort(groups, compareShipGroups);
    const f: DietEnforcerFleet = { id: st.nextId++, target, fleet: sg, ships, station: null, scale, cost, since: galaxyStarDate(galaxy), stage: 'gathering', defied: false };
    st.enforcers.push(f);
    st.counters.enforcerFleets++;
    st.counters.enforcerShips += ships.length;
    scenarioNews(galaxy, null, scenarioText('Diet Enforcers Sent News', ships.length, target.name, st.world.name), () => true, ships[0]);
    if (isHumanEmpire(galaxy, target)) scenarioMessage(galaxy, target, scenarioText('Diet Enforcers Title'), scenarioText('Diet Enforcers Sent You', ships.length, st.world.name), { type: EmpireMessageType.GeneralBadEvent, subject: ships[0] });
    chooseStation(galaxy, st, f);
    return f;
}

function liveShips(f: DietEnforcerFleet): BuiltObject[] {
    return f.ships.filter((b) => !b.hasBeenDestroyed);
}

/**
 * The station: a weighted-random pick (galaxy.rnd, weight = strategic value) among the target's five most valuable
 * colonies and their space ports that EVERY ship of the fleet can reach on its fuel (WithinFuelRangeAndRefuel,
 * margin 0.1). Null when none is reachable (the fleet waits at the host world and retries).
 */
function chooseStation(galaxy: Galaxy, st: DietState, f: DietEnforcerFleet): Habitat | BuiltObject | null {
    const ships = liveShips(f);
    if (ships.length === 0) return null;
    const cols = [...f.target.colonies].filter((h) => h.empire === f.target).sort((a, b) => strategicValue(b) - strategicValue(a) || a.habitatIndex - b.habitatIndex).slice(0, 5);
    const opts: { t: Habitat | BuiltObject; w: number }[] = [];
    for (const h of cols) {
        if (!ships.every((b) => withinFuelRangeAndRefuel(galaxy, b, h.xpos, h.ypos, 0.1))) continue;
        const port = determineSpacePortAtColony(galaxy, h);
        const w = Math.max(1, strategicValue(h));
        if (blockadeFor(galaxy, h) === null) opts.push({ t: h, w });
        if (port !== null && !port.hasBeenDestroyed && blockadeFor(galaxy, port) === null) opts.push({ t: port, w: w * 0.6 });
    }
    if (opts.length === 0) return null;
    let total = 0;
    for (const o of opts) total += o.w;
    let r = galaxy.rnd.nextDouble() * total;
    let pick = opts[opts.length - 1].t;
    for (const o of opts) {
        r -= o.w;
        if (r <= 0) {
            pick = o.t;
            break;
        }
    }
    f.station = pick;
    f.stage = 'enRoute';
    sendToStation(galaxy, st, f);
    return pick;
}

function sendToStation(galaxy: Galaxy, st: DietState, f: DietEnforcerFleet): void {
    const faction = st.faction;
    if (faction === null || f.fleet === null || f.station === null) return;
    if (f.station instanceof BuiltObject) implementBlockadeBuiltObject(galaxy, faction, f.station, true, false, { value: 0 }, f.fleet);
    else implementBlockadeColony(galaxy, faction, f.station as Habitat, true, false, { value: 0 }, f.fleet);
}

/** Removes a fleet: its ships despawn (the stock teardown) and the ShipGroup is disbanded. */
export function recallEnforcers(galaxy: Galaxy, st: DietState, f: DietEnforcerFleet, outcome: string): void {
    const i = st.enforcers.indexOf(f);
    if (i >= 0) st.enforcers.splice(i, 1);
    st.counters.enforcerOutcomes[outcome] = (st.counters.enforcerOutcomes[outcome] ?? 0) + 1;
    const faction = st.faction;
    if (faction !== null && f.fleet !== null && (faction.shipGroups as (ShipGroup | null)[]).includes(f.fleet)) disbandShipGroup(galaxy, faction, f.fleet);
    for (const b of f.ships) if (!b.hasBeenDestroyed) builtObjectCompleteTeardown(galaxy, b);
    f.ships = [];
    f.fleet = null;
}

function stationValid(st: DietState, f: DietEnforcerFleet): boolean {
    const s = f.station;
    if (s === null) return false;
    if (s instanceof BuiltObject) return !s.hasBeenDestroyed && s.actualEmpire === f.target;
    return (s as Habitat).empire === f.target;
}

/**
 * Reviews every enforcer fleet (the Diet's periodic tick): losses, the sanction's end, station choice, arrival, the
 * blockade standing, fuel (a fleet without resupply ships below 15% fuel withdraws), yearly upkeep from the fund.
 */
export function reviewEnforcers(galaxy: Galaxy, st: DietState, c: Council | null, sanctioned: (e: Empire) => boolean): void {
    for (const f of [...st.enforcers]) {
        const ships = liveShips(f);
        f.ships = ships;
        if (ships.length === 0) {
            recallEnforcers(galaxy, st, f, 'destroyed');
            scenarioNews(galaxy, null, scenarioText('Diet Enforcers Destroyed News', f.target.name));
            continue;
        }
        if (!f.target.active || !sanctioned(f.target) || c === null) {
            recallEnforcers(galaxy, st, f, f.target.active ? 'ended' : 'targetGone');
            continue;
        }
        if (f.fleet === null || !(st.faction!.shipGroups as (ShipGroup | null)[]).includes(f.fleet)) {
            // The stock code disbanded the group (e.g. the lead ship died): regroup the survivors.
            f.fleet = null;
            const sg = new ShipGroup(galaxy);
            sg.empire = st.faction!;
            sg.shipTargetAmount = ships.length;
            sg.troopTargetStrength = 0;
            sg.gatherPoint = st.world;
            sg.posture = FleetPosture.Defend;
            for (const b of ships) {
                if (b.shipGroup !== null) continue;
                shipGroupAddShipToFleet(galaxy, sg, b);
            }
            shipGroupUpdate(galaxy, sg);
            sg.name = `${getNextFleetNumberDescription(st.faction!)} ${scenarioText('Diet Enforcer Fleet')}`;
            (st.faction!.shipGroups as ShipGroup[]).push(sg);
            netSort(st.faction!.shipGroups as ShipGroup[], compareShipGroups);
            f.fleet = sg;
            f.stage = 'gathering';
            f.station = null;
        }
        for (const b of ships) b.isAutoControlled = false;
        if (f.stage === 'gathering' || !stationValid(st, f)) {
            // Resupplied at the host world while it waits for a reachable station.
            if (f.stage === 'gathering' && st.world !== null) for (const b of ships) if (galaxy.calculateDistance(b.xpos, b.ypos, st.world.xpos, st.world.ypos) < STATION_RANGE * 4) b.currentFuel = b.fuelCapacity;
            f.station = null;
            f.stage = 'gathering';
            const since = ((f as { gatherSince?: number }).gatherSince ??= galaxyStarDate(galaxy));
            if (chooseStation(galaxy, st, f) !== null) delete (f as { gatherSince?: number }).gatherSince;
            // No world of the target within the fleet's fuel reach for a year: the fleet stands down (the sanction stays).
            else if (galaxyStarDate(galaxy) - since >= YEAR_LENGTH) recallEnforcers(galaxy, st, f, 'unreachable');
            continue;
        }
        const s = f.station!;
        const lead = f.fleet.leadShip ?? ships[0];
        const d = galaxy.calculateDistance(lead.xpos, lead.ypos, s.xpos, s.ypos);
        const bl = blockadeFor(galaxy, s);
        if (f.stage === 'enRoute' && d <= STATION_RANGE && bl !== null && bl.initiator === st.faction) f.stage = 'blockading';
        const m = builtObjectMission(f.fleet.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Blockade) {
            if (bl !== null && bl.initiator !== st.faction) {
                f.station = null;
                f.stage = 'gathering';
                chooseStation(galaxy, st, f);
            } else sendToStation(galaxy, st, f);
        }
        const hasResupply = ships.some((b) => b.subRole === BuiltObjectSubRole.ResupplyShip);
        if (!hasResupply && ships.some((b) => b.fuelCapacity > 0 && b.currentFuel < 0.15 * b.fuelCapacity)) {
            recallEnforcers(galaxy, st, f, 'withdrewFuel');
            continue;
        }
    }
}

/** Yearly upkeep of every fleet (dietEnforcerUpkeepPct of its cost), from the fund, topped up by dues. */
export function enforcerUpkeep(galaxy: Galaxy, st: DietState, c: Council): void {
    let need = 0;
    for (const f of st.enforcers) need += (f.cost * dietParam(galaxy, 'dietEnforcerUpkeepPct')) / 100;
    if (need <= 0) return;
    if (st.fund < need) collectDues(galaxy, st, c.members, null, need - st.fund);
    st.fund = Math.max(0, st.fund - need);
}

/**
 * A sanctioned AI target may defy the Diet openly: declare war on the enforcers (then its warships engage them). It
 * does when aggressive, not cautious, and its military is at least twice the fleet's. Returns true when it did.
 */
export function aiDefiance(galaxy: Galaxy, st: DietState, f: DietEnforcerFleet, allow: (fn: () => void) => void): boolean {
    const t = f.target;
    if (isHumanEmpire(galaxy, t) || st.faction === null || f.defied) return false;
    const p = personality(t);
    if (p.aggression - p.caution < 0.25) return false;
    let fleetFp = 0;
    for (const b of f.ships) fleetFp += b.firepowerRaw;
    let own = 0;
    for (const b of t.builtObjects) if (b !== null && !b.hasBeenDestroyed) own += b.firepowerRaw;
    if (own < 2 * fleetFp) return false;
    const r = t.diplomaticRelations.byEmpire(st.faction);
    if (r !== null && r.type === DiplomaticRelationType.War) return false;
    allow(() => declareWar(galaxy, t, st.faction!));
    return true;
}

export const ENFORCER_YEAR = YEAR_LENGTH;
