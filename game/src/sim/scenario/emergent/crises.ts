// 19d2 Resource crises (tasks/19d2-resource-crises.md): scarcity shocks and their propagation through the ported private
// economy. Not a port — the scenario amplifies mechanics the port already has:
//   - luxuries → development / approval (colonyTick.ts evaluateColonyVariablesCore, Empire.4.cs 2943) — plus the
//     `crises.shortage` approval term here (§2.7);
//   - prices (market.ts reviewResourcePrices, Galaxy.1.cs 1204) — the crisis ceiling in crisesCore.crisisPrice (§2.6);
//   - fuel (movement.ts checkFuelHandicap, BaconBuiltObject.cs 4651) — grounded fleets are reported here (§2.5);
//   - smuggling (pirates/missionsMarket.ts, Empire.2.cs 1426 / 2288) — crisis-priced offers (§2.9);
//   - depletion (empireEvents.ts empireEventColonyResourceDepletion, Empire.1.cs 1888) — reused for exhausted sources.
//
// Everything runs behind the `resourceCrises` scenario flag. Rnd (tasks/19d1 §S5): only the yearly handler draws —
// `// RND(19d2)` marks each draw; the record hooks in ported code never draw.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Habitat } from '../../types';
import type { ShipGroup } from '../../fleets/shipGroup';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { galaxyResourceCurrentPrices } from '../../design';
import { EmpireMessageType } from '../../messages';
import { ResourceGroup, resourceGroupOf } from '../../resourceSystem';
import { empireEventColonyResourceDepletion } from '../../empireEvents';
import { OrderType, countResourceSupplyLocations, empireCreateOrder } from '../../logistics/orders';
import { ResourceRef } from '../../cargo';
import { calculateResourceLevelSpaceport, determineCriticalResources, determineSpacePortAtHabitat } from '../../logistics/colonySupply';
import { registerScenarioEvent, registerScenarioYearly } from '../hooks';
import { registerStabilityTerm } from '../stability';
import { pendingScenarioDecisions, raiseScenarioDecision, registerScenarioDecision } from '../decisions';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import {
    CRISES_FLAG,
    type Crisis,
    type CrisisKind,
    type CrisesState,
    crisesState,
    reserveUnitsPerAbundance,
    resourceAtCrisisPrice,
    shortageShockChance,
    shortageTerm,
} from './crisesCore';
import { fuelDecisionOptions, resolveFuelDecision } from './crisesActions';

export * from './crisesCore';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function resourceName(galaxy: Galaxy, resourceId: number): string {
    return galaxy.resourceSystem.byId.get(resourceId)?.name ?? '';
}

function isLuxury(galaxy: Galaxy, resourceId: number): boolean {
    const r = galaxy.resourceSystem.byId.get(resourceId);
    return r !== undefined && resourceGroupOf(r) === ResourceGroup.Luxury;
}

function isFuel(galaxy: Galaxy, resourceId: number): boolean {
    return galaxy.resourceSystem.byId.get(resourceId)?.isFuel === true;
}

/**
 * Luxury resource ids in a colony's cargo held by `owner` — the per-id form of colonyTick.ts cargoResourceCounts
 * (CargoList.cs 619 ResourceGroupCount(Luxury, empire)); re-implemented here, not exported from colonyTick. Pure.
 */
export function colonyLuxuryIds(galaxy: Galaxy, h: Habitat, owner: Empire | null): number[] {
    const out: number[] = [];
    if (owner === null || h.cargo === null) return out;
    for (const c of h.cargo.items) {
        const r = galaxy.resourceSystem.byId.get(c.commodity.resourceId);
        if (r === undefined || c.empire !== owner || !(c.amount > 0)) continue;
        if (resourceGroupOf(r) === ResourceGroup.Luxury && !out.includes(r.resourceId)) out.push(r.resourceId);
    }
    return out;
}

/** Resource ids in stock (amount > 0) at a colony and its space port. Pure. */
function colonyStockIds(h: Habitat): number[] {
    const out: number[] = [];
    const add = (items: readonly { commodity: { resourceId: number }; amount: number }[]): void => {
        for (const c of items) if (c.amount > 0 && !out.includes(c.commodity.resourceId)) out.push(c.commodity.resourceId);
    };
    if (h.cargo !== null) add(h.cargo.items);
    const port = determineSpacePortAtHabitat(h);
    if (port !== null && port.cargo !== null) add(port.cargo.items);
    return out;
}

/** Luxury + race-critical ids in stock at a colony (trigger 2's "had a year ago"). */
function colonyEssentialStock(galaxy: Galaxy, h: Habitat): number[] {
    const critical = determineCriticalResources(galaxy, h);
    return colonyStockIds(h).filter((id) => isLuxury(galaxy, id) || critical.includes(id));
}

/** True when the empire holds `resourceId` in stock at a colony / space port, or has a supply location for it. */
function empireHasResource(galaxy: Galaxy, e: Empire, resourceId: number): boolean {
    for (const h of e.colonies) {
        if (h.cargo !== null && h.cargo.items.some((c) => c.commodity.resourceId === resourceId && c.amount > 0)) return true;
    }
    for (const p of e.spacePorts) {
        if (p.cargo !== null && p.cargo.items.some((c) => c.commodity.resourceId === resourceId && c.amount > 0)) return true;
    }
    return countResourceSupplyLocations(galaxy, e, resourceId, false) > 0;
}

function mostValuable(galaxy: Galaxy, ids: readonly number[]): number {
    const prices = galaxyResourceCurrentPrices(galaxy);
    let best = ids[0];
    for (const id of ids) if (prices[id] > prices[best] || (prices[id] === prices[best] && id < best)) best = id;
    return best;
}

function activeEmpires(galaxy: Galaxy): Empire[] {
    return galaxy.empires.filter((e): e is Empire => e != null && e.active && e !== galaxy.independentEmpire);
}

// ---------------------------------------------------------------------------
// Crises bookkeeping
// ---------------------------------------------------------------------------

function openCrisis(galaxy: Galaxy, st: CrisesState, kind: CrisisKind, resourceId: number, habitat: Habitat | null, empire: Empire | null, year: number, severity: number): Crisis {
    const c: Crisis = { id: st.nextCrisisId++, kind, resourceId, habitat, empire, startYear: year, severity: Math.max(0, Math.min(1, severity)), resolvedYear: -1, okSinceYear: -1 };
    st.crises.push(c);
    return c;
}

function hasOpenCrisis(st: CrisesState, kind: CrisisKind, habitat: Habitat | null, empire: Empire | null, resourceId: number): boolean {
    return st.crises.some((c) => c.resolvedYear < 0 && c.kind === kind && c.habitat === habitat && c.empire === empire && c.resourceId === resourceId);
}

/** Sends the colony shortage message (GeneralBadEvent, subject = colony) for a newly opened colony crisis. */
function sendShortageMessage(galaxy: Galaxy, c: Crisis): void {
    if (c.empire === null || c.habitat === null) return;
    scenarioMessage(galaxy, c.empire, scenarioText('Emergent Shortage Title'), scenarioText('Emergent Shortage COLONY RESOURCE', c.habitat.name, resourceName(galaxy, c.resourceId)), {
        type: EmpireMessageType.GeneralBadEvent,
        subject: c.habitat,
    });
}

/** Removes a source (the ported ResourceDepletion event, Empire.1.cs 1888) and forgets its reserve bookkeeping. */
function exhaustSource(galaxy: Galaxy, st: CrisesState, h: Habitat, resourceId: number, recipient: Empire | null): void {
    empireEventColonyResourceDepletion(galaxy, h, resourceId, recipient);
    st.extracted.get(h)?.delete(resourceId);
    st.baseAbundance.get(h)?.delete(resourceId);
    st.reserveStage.get(h)?.delete(resourceId);
}

function sourceRecipient(galaxy: Galaxy, st: CrisesState, h: Habitat): Empire | null {
    if (h.empire !== null && h.empire !== galaxy.independentEmpire) return h.empire;
    return st.extractor.get(h) ?? null;
}

// ---------------------------------------------------------------------------
// Trigger 1: reserves
// ---------------------------------------------------------------------------

/** §2.1: reserve thresholds of every recorded source (50 % → abundance 75 %, 80 % → 50 %, 100 % → depleted). No Rnd. */
export function reviewReserves(galaxy: Galaxy, year: number): void {
    const st = crisesState(galaxy);
    const perAbundance = reserveUnitsPerAbundance(galaxy);
    if (perAbundance <= 0) return;
    for (const [h, byRes] of [...st.extracted]) {
        for (const [resourceId, units] of [...byRes]) {
            const entry = h.resources.find((r) => r.resourceId === resourceId);
            if (entry === undefined) {
                // Gone by other means (the random ResourceDepletion event, a stock change): stop tracking it.
                byRes.delete(resourceId);
                continue;
            }
            const base = st.baseAbundance.get(h)?.get(resourceId) ?? entry.abundance;
            const reserve = base * perAbundance;
            if (!(reserve > 0)) continue;
            const frac = units / reserve;
            const recipient = sourceRecipient(galaxy, st, h);
            if (frac >= 1) {
                exhaustSource(galaxy, st, h, resourceId, recipient);
                if (!hasOpenCrisis(st, 'depletion', h, recipient, resourceId)) {
                    const others = recipient !== null ? countResourceSupplyLocations(galaxy, recipient, resourceId, false) : 0;
                    openCrisis(galaxy, st, 'depletion', resourceId, h, recipient, year, 1 / (1 + others));
                }
                continue;
            }
            let stages = st.reserveStage.get(h);
            if (stages === undefined) {
                stages = new Map();
                st.reserveStage.set(h, stages);
            }
            const stage = stages.get(resourceId) ?? 0;
            const want = frac >= 0.8 ? 2 : frac >= 0.5 ? 1 : 0;
            if (want > stage) {
                stages.set(resourceId, want);
                entry.abundance = Math.trunc(base * (want === 2 ? 0.5 : 0.75));
                if (recipient !== null) {
                    scenarioMessage(
                        galaxy,
                        recipient,
                        scenarioText('Emergent Reserves Low Title'),
                        scenarioText('Emergent Reserves Low RESOURCE HABITAT PERCENT', resourceName(galaxy, resourceId), h.name, Math.round(frac * 100)),
                        { type: EmpireMessageType.GeneralWarning, subject: h },
                    );
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Triggers 2, 3 and the shortage bookkeeping (§2.2, §2.3, §2.7)
// ---------------------------------------------------------------------------

/** Per colony: luxuries lost since the last review (shortage term), blockade and raid crises. Returns lost ids per empire colony. */
function reviewColonies(galaxy: Galaxy, st: CrisesState, year: number): Map<Empire, Map<number, number>> {
    const lostCounts = new Map<Empire, Map<number, number>>();
    const seen = new Set<Habitat>();
    for (const e of activeEmpires(galaxy)) {
        const perRes = new Map<number, number>();
        lostCounts.set(e, perRes);
        for (const h of e.colonies) {
            if (h == null || h.hasBeenDestroyed || h.empire !== e) continue;
            seen.add(h);
            // §2.7 luxuries lost this year.
            const lux = colonyLuxuryIds(galaxy, h, h.owner);
            const last = st.lastLuxuries.get(h);
            if (last !== undefined) {
                const lost = last.filter((id) => !lux.includes(id));
                if (lost.length > 0) {
                    const list = st.lostLuxuries.get(h) ?? [];
                    list.push({ year, count: lost.length, resourceIds: lost });
                    st.lostLuxuries.set(h, list);
                    for (const id of lost) perRes.set(id, (perRes.get(id) ?? 0) + 1);
                }
            }
            st.lastLuxuries.set(h, lux);
            // §2.2 blockades: essential stock lost while blockaded.
            const stock = colonyEssentialStock(galaxy, h);
            const lastStock = st.lastStock.get(h);
            if (h.isBlockaded && lastStock !== undefined) {
                const lostStock = lastStock.filter((id) => !stock.includes(id));
                if (lostStock.length > 0) {
                    const rid = mostValuable(galaxy, lostStock);
                    if (!hasOpenCrisis(st, 'blockade', h, e, rid)) {
                        const c = openCrisis(galaxy, st, 'blockade', rid, h, e, year, lostStock.length / Math.max(1, lastStock.length));
                        sendShortageMessage(galaxy, c);
                    }
                }
            }
            st.lastStock.set(h, stock);
            // §2.3 raids: looted luxury / fuel no longer in stock.
            const looted = st.raidLosses.get(h);
            if (looted !== undefined) {
                const gone = looted.filter((id) => (isLuxury(galaxy, id) || isFuel(galaxy, id)) && !stock.includes(id) && !colonyStockIds(h).includes(id));
                if (gone.length > 0) {
                    const rid = mostValuable(galaxy, gone);
                    if (!hasOpenCrisis(st, 'raid', h, e, rid)) {
                        const c = openCrisis(galaxy, st, 'raid', rid, h, e, year, gone.length / Math.max(1, looted.length));
                        sendShortageMessage(galaxy, c);
                    }
                }
            }
        }
    }
    st.raidLosses.clear();
    // Forget colonies no empire owns any more; trim loss entries older than two years.
    for (const m of [st.lastLuxuries, st.lastStock] as Map<Habitat, unknown>[]) {
        for (const h of [...m.keys()]) if (!seen.has(h)) m.delete(h);
    }
    for (const [h, list] of [...st.lostLuxuries]) {
        const keep = list.filter((x) => year - x.year < 2);
        if (keep.length === 0) st.lostLuxuries.delete(h);
        else st.lostLuxuries.set(h, keep);
    }
    return lostCounts;
}

// ---------------------------------------------------------------------------
// Trigger 4: galaxy supply shock
// ---------------------------------------------------------------------------

/** Sources of a resource in galaxy.empires order: owned colonies with it, then habitats their mining stations work. */
function resourceSources(galaxy: Galaxy, resourceId: number): Habitat[] {
    const out: Habitat[] = [];
    for (const e of activeEmpires(galaxy)) {
        for (const h of e.colonies) {
            if (h.empire === e && !out.includes(h) && h.resources.some((r) => r.resourceId === resourceId)) out.push(h);
        }
        for (const bo of [...e.builtObjects, ...e.privateBuiltObjects] as BuiltObject[]) {
            if (bo.subRole !== BuiltObjectSubRole.GasMiningStation && bo.subRole !== BuiltObjectSubRole.MiningStation) continue;
            const h = bo.parentHabitat;
            if (h !== null && !out.includes(h) && h.resources.some((r) => r.resourceId === resourceId)) out.push(h);
        }
    }
    return out;
}

/** True when `h` is some empire's only supply of one of its race's critical resources `resourceId`. */
function isOnlyCriticalSupply(galaxy: Galaxy, h: Habitat, resourceId: number): boolean {
    for (const e of activeEmpires(galaxy)) {
        const race = e.dominantRace;
        if (race === null || !race.criticalResources.some((b) => b != null && b.resourceId === resourceId)) continue;
        if (countResourceSupplyLocations(galaxy, e, resourceId, false) > 1) continue;
        const mines = (e.builtObjects as BuiltObject[]).some((bo) => bo.parentHabitat === h && (bo.subRole === BuiltObjectSubRole.GasMiningStation || bo.subRole === BuiltObjectSubRole.MiningStation));
        if (h.empire === e || mines) return true;
    }
    return false;
}

/** §2.4: yearly roll for one galaxy supply shock on the scarcest luxury or fuel resource. */
export function reviewSupplyShock(galaxy: Galaxy, year: number): Crisis | null {
    const st = crisesState(galaxy);
    if (!(galaxy.rnd.nextDouble() < shortageShockChance(galaxy))) return null; // RND(19d2): shock roll
    let bestId = -1;
    let bestCount = Number.MAX_SAFE_INTEGER;
    let bestSources: Habitat[] = [];
    const empires = activeEmpires(galaxy);
    for (const def of galaxy.resourceSystem.resources) {
        if (!(resourceGroupOf(def) === ResourceGroup.Luxury || def.isFuel) || def.superLuxuryBonusAmount > 0) continue;
        const sources = resourceSources(galaxy, def.resourceId).filter((h) => !isOnlyCriticalSupply(galaxy, h, def.resourceId));
        if (sources.length === 0) continue;
        let count = 0;
        for (const e of empires) count += countResourceSupplyLocations(galaxy, e, def.resourceId, true);
        if (count < bestCount || (count === bestCount && def.resourceId < bestId)) {
            bestId = def.resourceId;
            bestCount = count;
            bestSources = sources;
        }
    }
    if (bestId < 0) return null;
    const h = bestSources[galaxy.rnd.next(0, bestSources.length)]; // RND(19d2): shock source
    const recipient = sourceRecipient(galaxy, st, h) ?? ownerOfMining(galaxy, h);
    exhaustSource(galaxy, st, h, bestId, recipient);
    const c = openCrisis(galaxy, st, 'shock', bestId, h, recipient, year, 1 / Math.max(1, bestCount));
    scenarioNews(galaxy, null, scenarioText('Emergent Supply Shock RESOURCE HABITAT', resourceName(galaxy, bestId), h.name), undefined, h);
    return c;
}

function ownerOfMining(galaxy: Galaxy, h: Habitat): Empire | null {
    for (const e of activeEmpires(galaxy)) {
        if ([...e.builtObjects, ...e.privateBuiltObjects].some((bo) => (bo as BuiltObject).parentHabitat === h)) return e;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Trigger 5: fuel crisis
// ---------------------------------------------------------------------------

/** Fuel resource ids an empire holds (amount > 0) at its colonies and space ports. */
function empireFuelStock(galaxy: Galaxy, e: Empire): Set<number> {
    const out = new Set<number>();
    const add = (items: readonly { commodity: { resourceId: number }; amount: number }[]): void => {
        for (const c of items) if (c.amount > 0 && isFuel(galaxy, c.commodity.resourceId)) out.add(c.commodity.resourceId);
    };
    for (const h of e.colonies) if (h.cargo !== null) add(h.cargo.items);
    for (const p of e.spacePorts) if (p.cargo !== null) add(p.cargo.items);
    return out;
}

/**
 * A grounded military ship: fuel-handicapped by the ported checkFuelHandicap (BaconBuiltObject.cs 4651), out of fuel,
 * or low on fuel (< 10 %) with no stock of its fuel at any of the empire's refuelling points.
 */
export function shipGrounded(ship: BuiltObject, fuelStock: ReadonlySet<number>): boolean {
    if (ship._fuelHandicapped) return true;
    if (ship.fuelCapacity <= 0) return false;
    if (ship.currentFuel <= 0) return true;
    return ship.currentFuel < ship.fuelCapacity * 0.1 && ship.fuelType !== null && !fuelStock.has(ship.fuelType.resourceId);
}

export interface FuelReview {
    military: number;
    grounded: number;
    fuelId: number;
    fleet: ShipGroup | null;
    ship: BuiltObject | null;
}

/** Counts an empire's grounded military ships (pure). */
export function countGroundedShips(galaxy: Galaxy, e: Empire): FuelReview {
    const stock = empireFuelStock(galaxy, e);
    let military = 0;
    let grounded = 0;
    const byFuel = new Map<number, number>();
    const byFleet = new Map<ShipGroup, number>();
    let firstShip: BuiltObject | null = null;
    for (const bo of e.builtObjects as BuiltObject[]) {
        if (bo == null || bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Military || bo.builtAt !== null) continue;
        military++;
        if (!shipGrounded(bo, stock)) continue;
        grounded++;
        firstShip ??= bo;
        if (bo.fuelType !== null) byFuel.set(bo.fuelType.resourceId, (byFuel.get(bo.fuelType.resourceId) ?? 0) + 1);
        const g = bo.shipGroup as ShipGroup | null;
        if (g !== null) byFleet.set(g, (byFleet.get(g) ?? 0) + 1);
    }
    let fuelId = -1;
    for (const [id, n] of byFuel) if (fuelId < 0 || n > byFuel.get(fuelId)! || (n === byFuel.get(fuelId)! && id < fuelId)) fuelId = id;
    let fleet: ShipGroup | null = null;
    for (const [g, n] of byFleet) if (fleet === null || n > byFleet.get(fleet)!) fleet = g;
    return { military, grounded, fuelId, fleet, ship: firstShip };
}

/** AI rule 1 / the emergency-purchase amount: 2 × CalculateResourceLevelSpaceport (Galaxy.cs 1541) for the fuel. */
export function crisisFuelAmount(galaxy: Galaxy, fuelId: number): number {
    return 2 * calculateResourceLevelSpaceport(galaxy, fuelId, 0, 1.0);
}

/** The capital's space port (else the first space port), the delivery point for crisis fuel. */
export function capitalPort(e: Empire): BuiltObject | null {
    const p = e.capital !== null ? determineSpacePortAtHabitat(e.capital) : null;
    return p ?? (e.spacePorts.length > 0 ? e.spacePorts[0] : null);
}

/** §4 AI rule 1: a state order for the crisis fuel at the capital port unless one of at least that amount is open. */
export function placeCrisisFuelOrder(galaxy: Galaxy, e: Empire, fuelId: number): boolean {
    const port = capitalPort(e);
    if (port === null) return false;
    const amount = crisisFuelAmount(galaxy, fuelId);
    if (amount <= 0) return false;
    for (const o of galaxy.orders.items) {
        if (o.requestingBuiltObject === port && o.commodityResource !== null && o.commodityResource.resourceId === fuelId && o.amountOutstandingToContract >= amount) return false;
    }
    empireCreateOrder(galaxy, e, port, new ResourceRef(fuelId), amount, true, OrderType.Standard);
    return true;
}

/**
 * §2.5 fuel crisis review for one empire (from the yearly handler: movement.ts checkForStrandedShips only runs for the
 * player's empire, so the spec's hook there would miss every AI). Opens a `fuel` crisis when ≥ 25 % of the military ships
 * are grounded (once per empire per year), messages the empire; AI rule 1 / the player's decision follow.
 */
export function reviewFuelCrisis(galaxy: Galaxy, e: Empire, year: number): Crisis | null {
    const st = crisesState(galaxy);
    const r = countGroundedShips(galaxy, e);
    const prev = st.fuelReport.get(e);
    st.fuelReport.set(e, { year, grounded: r.grounded, military: r.military });
    let crisis: Crisis | null = st.crises.find((c) => c.resolvedYear < 0 && c.kind === 'fuel' && c.empire === e) ?? null;
    if (crisis === null && r.military > 0 && r.grounded * 4 >= r.military && r.fuelId >= 0 && (prev === undefined || prev.year !== year)) {
        crisis = openCrisis(galaxy, st, 'fuel', r.fuelId, null, e, year, r.grounded / r.military);
        const subject = r.fleet ?? r.ship;
        const where = r.fleet !== null ? (r.fleet as unknown as { name?: string }).name ?? '' : r.ship?.name ?? '';
        scenarioMessage(galaxy, e, scenarioText('Emergent Fleets Grounded Title'), scenarioText('Emergent Fleets Grounded COUNT TOTAL RESOURCE FLEET', r.grounded, r.military, resourceName(galaxy, r.fuelId), where), {
            type: EmpireMessageType.GeneralWarning,
            subject,
        });
        if (e === galaxy.playerEmpire) raiseFuelDecision(galaxy, e, crisis);
    }
    if (crisis !== null && e !== galaxy.playerEmpire) placeCrisisFuelOrder(galaxy, e, crisis.resourceId);
    return crisis;
}

export const FUEL_DECISION = 'crises.fuel';

function raiseFuelDecision(galaxy: Galaxy, e: Empire, c: Crisis): void {
    if (pendingScenarioDecisions(galaxy, e).some((d) => d.kind === FUEL_DECISION)) return;
    const amount = crisisFuelAmount(galaxy, c.resourceId);
    const options = fuelDecisionOptions(galaxy, e, c.resourceId, amount);
    raiseScenarioDecision(galaxy, e, {
        kind: FUEL_DECISION,
        title: scenarioText('Emergent Fuel Decision Title'),
        text: scenarioText('Emergent Fuel Decision RESOURCE', resourceName(galaxy, c.resourceId)),
        options,
        defaultOption: 'wait',
        expiresDays: 60,
        context: { crisisId: c.id, fuelId: c.resourceId, amount },
    });
}

// ---------------------------------------------------------------------------
// Resolution, AI rule 2, price news
// ---------------------------------------------------------------------------

function crisisSatisfied(galaxy: Galaxy, c: Crisis): boolean {
    switch (c.kind) {
        case 'blockade':
            return c.habitat !== null && !c.habitat.isBlockaded && colonyStockIds(c.habitat).includes(c.resourceId);
        case 'raid':
            return c.habitat !== null && colonyStockIds(c.habitat).includes(c.resourceId);
        case 'fuel': {
            if (c.empire === null) return true;
            const r = countGroundedShips(galaxy, c.empire);
            return r.grounded * 4 < r.military || r.military === 0;
        }
        default:
            return c.empire === null || empireHasResource(galaxy, c.empire, c.resourceId);
    }
}

function crisisGone(galaxy: Galaxy, c: Crisis): boolean {
    if (c.empire !== null && !c.empire.active) return true;
    if (c.kind === 'blockade' || c.kind === 'raid') return c.habitat === null || c.habitat.hasBeenDestroyed || c.habitat.empire !== c.empire;
    return false;
}

/** §2.8 resolution: the resource is back at two consecutive reviews (a full year), or the colony / empire is gone. */
function resolveCrises(galaxy: Galaxy, st: CrisesState, year: number): void {
    for (const c of st.crises) {
        if (c.resolvedYear >= 0) continue;
        if (crisisGone(galaxy, c)) {
            c.resolvedYear = year;
            continue;
        }
        if (!crisisSatisfied(galaxy, c)) {
            c.okSinceYear = -1;
            continue;
        }
        if (c.okSinceYear < 0) {
            c.okSinceYear = year;
            continue;
        }
        if (year - c.okSinceYear < 1) continue;
        c.resolvedYear = year;
        if (c.empire !== null) {
            scenarioMessage(galaxy, c.empire, scenarioText('Emergent Crisis Resolved Title'), scenarioText('Emergent Crisis Resolved RESOURCE PLACE', resourceName(galaxy, c.resourceId), c.habitat?.name ?? c.empire.name), {
                type: EmpireMessageType.GeneralGoodEvent,
                subject: c.habitat ?? c.empire,
            });
        }
    }
    // Keep the resolved history short (the UI lists open crises; resolved ones only feed tests / the chronicle).
    const resolved = st.crises.filter((c) => c.resolvedYear >= 0);
    if (resolved.length > 100) {
        const drop = new Set(resolved.slice(0, resolved.length - 100));
        st.crises = st.crises.filter((c) => !drop.has(c));
    }
}

/** §4 AI rule 2: luxuries lost at ≥ 25 % of an AI empire's colonies this year become its mining priority. */
function reviewMiningPriority(galaxy: Galaxy, st: CrisesState, lostCounts: Map<Empire, Map<number, number>>): void {
    for (const e of activeEmpires(galaxy)) {
        if (e === galaxy.playerEmpire) continue;
        const per = lostCounts.get(e);
        const ids: number[] = [];
        if (per !== undefined && e.colonies.length > 0) {
            for (const [id, n] of per) if (n * 4 >= e.colonies.length) ids.push(id);
        }
        ids.sort((a, b) => a - b);
        if (ids.length > 0) st.miningPriority.set(e, ids);
        else st.miningPriority.delete(e);
    }
}

/** §5 news: "price spike" at most once per resource per year. */
function reviewPriceNews(galaxy: Galaxy, st: CrisesState, year: number): void {
    const prices = galaxyResourceCurrentPrices(galaxy);
    for (const def of galaxy.resourceSystem.resources) {
        if (!resourceAtCrisisPrice(def, prices[def.resourceId])) continue;
        if (st.priceNewsYear.get(def.resourceId) === year) continue;
        st.priceNewsYear.set(def.resourceId, year);
        scenarioNews(galaxy, null, scenarioText('Emergent Price Spike RESOURCE PRICE', def.name, prices[def.resourceId].toFixed(2)));
    }
}

/** §2.8 the yearly handler. */
export function reviewCrises(galaxy: Galaxy, year: number): void {
    const st = crisesState(galaxy);
    reviewReserves(galaxy, year);
    const lostCounts = reviewColonies(galaxy, st, year);
    reviewSupplyShock(galaxy, year);
    for (const e of activeEmpires(galaxy)) reviewFuelCrisis(galaxy, e, year);
    resolveCrises(galaxy, st, year);
    reviewMiningPriority(galaxy, st, lostCounts);
    reviewPriceNews(galaxy, st, year);
    for (const [e, list] of [...st.exports]) {
        const keep = list.filter((x) => year - x.year <= 1);
        if (keep.length === 0) st.exports.delete(e);
        else st.exports.set(e, keep);
    }
}

// ---------------------------------------------------------------------------
// Registration (module load; packages.ts imports this module)
// ---------------------------------------------------------------------------

registerScenarioYearly({ id: 'emergent.crises', flag: CRISES_FLAG, order: 20, run: reviewCrises });

// §2.7 approval term. The §S3 approval-term hook (tasks/19d1 §S3) is not on this branch: the mod layer's
// empireApprovalRating query adds the term after the stock multipliers instead.
registerStabilityTerm({
    id: 'crises.shortage',
    flag: CRISES_FLAG,
    cause: 'shortages',
    label: 'Shortages',
    run: (galaxy, habitat) => shortageTerm(galaxy, habitat),
});

// AI rule 3 bookkeeping: who sold what to whom (logistics/contracts.ts initiateContract; no Rnd).
registerScenarioEvent({
    id: 'crises.exports',
    flag: CRISES_FLAG,
    event: 'contractInitiated',
    run: (galaxy, p) => {
        if (p.resourceId < 0 || p.seller === p.buyer) return;
        const st = crisesState(galaxy);
        const year = Math.floor(galaxy.scenario!.lastYear);
        const list = st.exports.get(p.seller) ?? [];
        if (!list.some((x) => x.resourceId === p.resourceId && x.buyer === p.buyer && x.year === year)) list.push({ resourceId: p.resourceId, buyer: p.buyer, year });
        st.exports.set(p.seller, list);
    },
});

registerScenarioDecision({
    id: FUEL_DECISION,
    kind: FUEL_DECISION,
    flag: CRISES_FLAG,
    resolve: resolveFuelDecision,
    aiChoose: () => 'wait',
});
