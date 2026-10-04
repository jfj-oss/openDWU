// Fleet templates with auto-refill and Replenish for the PLAYER (a gameplay addition inspired by Distant Worlds 2; not in
// DW:U — the original has no fleet templates at all, see player/fleetTemplates.ts).
//
// The player assigns a fleet design (template) to a fleet (fleetTemplateAssign). That alone changes nothing in the sim.
// Two things then use it, both player commands (journaled, replayed):
//   - "Replenish" (fleetTemplateReplenish): queue the fleet's missing ships once, now — all or nothing against the
//     treasury, as the original's Build Order purchase;
//   - "Auto-refill from template" (fleetTemplateAutoRefill, per fleet, off by default): the same, checked every
//     REFILL_CHECK_MS of game time while on (processFleetRefill, run by the scheduler after the construction board).
//     When the treasury cannot pay for every missing ship it buys the ships it can afford in template row order
//     (stopping at the first it cannot), and checks again after REFILL_RETRY_MS. It never queues more than is missing:
//     replacements already under construction count as present, so the queue is never spammed.
// Missing ships: per template row, the fleet's ships and its replacements under construction of that design, then of
// the same subrole (a retrofitted or upgraded ship still fills its row), as Form from existing picks them.
// The purchase is the original's Build Order path, Empire.6.cs 3017 BuildNewShips (construction/empireConstruction.ts
// buildNewShips: price from StateMoney, the yard's construction queue, component procurement), with the yards limited to
// the fleet's chosen yard or the one nearest the fleet (and the colony of that yard for colony-built resupply ships);
// a ship that yard refuses is offered to every yard as BuildNewShips does. The design built for a row is its own while
// still buildable, else the newest buildable of its subrole (fleetTemplates.ts buildDesignFor).
// Joining: each replacement is a ship of a FleetBuildOrder tagged with the link (refillLinkId); at completion
// (constructionQueue.ts → fleetTemplates.ts fleetBuildOrderShipCompleted) it is added to the fleet (ShipGroup.cs 370
// AddShipToFleet), then the original's ConstructionQueue.cs 1076 AssignFleetWaypointMission sends it to the fleet
// (its lead ship's mission target, or the fleet's gather point), as Empire.9.cs 2810 AddShipsToShipGroup does.
// A fleet destroyed in battle (every ship it had at the last check destroyed or lost) keeps its link while auto-refill
// is on: the replacements re-form it under its name and home base. A fleet the player disbanded drops its link.
// Only the player empire (galaxy.playerEmpire); AI empires never get a link, so nothing here runs for them. With no
// link that has auto-refill on, processFleetRefill returns at once and nothing changes (no Rnd, no writes).
// Headless: no DOM / Pixi. Rnd: only the draws of buildNewShips (ship names), when ships are queued.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Design } from '../design';
import type { Habitat } from '../types';
import { empireShipGroups, type ShipGroup } from '../fleets/shipGroup';
import { buildNewShips } from '../construction/empireConstruction';
import {
    buildDesignFor,
    fleetTemplateLinkOf,
    findFleetTemplate,
    linkFleetTemplate,
    unlinkFleetTemplate,
    type FleetBuildOrder,
    type FleetDesignBook,
    type FleetRefillState,
    type FleetTemplate,
    type FleetTemplateLink,
} from './fleetTemplates';

/** Game ms between two auto-refill checks of a fleet. */
export const REFILL_CHECK_MS = 10_000;
/** Game ms before a fleet whose check could not queue everything (funds, yards) is checked again. */
export const REFILL_RETRY_MS = 30_000;

function isPlayer(galaxy: Galaxy, empire: Empire): boolean {
    return galaxy.playerEmpire === empire;
}

function stillBuilding(empire: Empire, b: BuiltObject): boolean {
    return !b.hasBeenDestroyed && b.builtAt !== null && b.empire === empire;
}

function aliveOwn(empire: Empire, b: BuiltObject | null): b is BuiltObject {
    return b != null && !b.hasBeenDestroyed && b.empire === empire;
}

/** The build orders whose ships join this fleet / link (replacements and Build fleet orders of the fleet). */
function ordersFor(b: FleetDesignBook, link: FleetTemplateLink): FleetBuildOrder[] {
    return b.orders.filter((o) => o.refillLinkId === link.id || (link.fleet !== null && o.fleet === link.fleet));
}

/** Ships under construction that will join the fleet. */
export function fleetReplacementsBuilding(empire: Empire, link: FleetTemplateLink): BuiltObject[] {
    const b = empire.fleetDesigns;
    if (b === undefined) return [];
    const out: BuiltObject[] = [];
    for (const o of ordersFor(b, link)) for (const s of o.pending) if (stillBuilding(empire, s) && !out.includes(s)) out.push(s);
    return out;
}

export interface FleetShortfallRow {
    /** The template row's design. */
    design: Design;
    wanted: number;
    /** Ships of the fleet filling the row. */
    present: number;
    /** Replacements under construction filling the row. */
    building: number;
    missing: number;
}

/**
 * Per template row: what the fleet has, what is being built for it, what is missing. Exact design first (over every
 * row), then the same subrole, as pickFleetShips does with substitutes. Read-only.
 */
export function fleetShortfall(empire: Empire, link: FleetTemplateLink, t: FleetTemplate): FleetShortfallRow[] {
    const fleetShips = link.fleet !== null && empireShipGroups(empire).includes(link.fleet) ? link.fleet.ships.filter((s) => aliveOwn(empire, s)) : [];
    const building = fleetReplacementsBuilding(empire, link);
    const pool: { b: BuiltObject; building: boolean }[] = [...fleetShips.map((b) => ({ b, building: false })), ...building.filter((b) => !fleetShips.includes(b)).map((b) => ({ b, building: true }))];
    const taken = new Set<BuiltObject>();
    const rows: FleetShortfallRow[] = t.entries.map((e) => ({ design: e.design, wanted: e.count, present: 0, building: 0, missing: e.count }));
    const fill = (match: (b: BuiltObject, r: FleetShortfallRow) => boolean): void => {
        for (const r of rows) {
            for (const p of pool) {
                if (r.missing <= 0) break;
                if (taken.has(p.b) || !match(p.b, r)) continue;
                taken.add(p.b);
                if (p.building) r.building++;
                else r.present++;
                r.missing--;
            }
        }
    };
    fill((b, r) => b.design === r.design);
    fill((b, r) => b.subRole === r.design.subRole);
    return rows;
}

export interface ReplenishPlan {
    /** Ships to buy, per buildable design (rows merged), in template row order. */
    designs: Design[];
    amounts: number[];
    /** Their total purchase price (Design.CalculateCurrentPurchasePrice). */
    cost: number;
    /** Missing ships in all (buildable or not). */
    missing: number;
    /** Template rows with ships missing and no buildable design. */
    unbuildable: string[];
}

/** What Replenish would buy for the fleet now. Read-only. */
export function fleetReplenishPlan(galaxy: Galaxy, empire: Empire, link: FleetTemplateLink): ReplenishPlan {
    const plan: ReplenishPlan = { designs: [], amounts: [], cost: 0, missing: 0, unbuildable: [] };
    const t = findFleetTemplate(empire, link.templateId);
    if (t === null) return plan;
    for (const r of fleetShortfall(empire, link, t)) {
        if (r.missing <= 0) continue;
        plan.missing += r.missing;
        const d = buildDesignFor(empire, r.design);
        if (d === null) {
            plan.unbuildable.push(r.design.name);
            continue;
        }
        const i = plan.designs.indexOf(d);
        if (i >= 0) plan.amounts[i] += r.missing;
        else {
            plan.designs.push(d);
            plan.amounts.push(r.missing);
        }
        plan.cost += d.calculateCurrentPurchasePrice(galaxy) * r.missing;
    }
    return plan;
}

// ---------------------------------------------------------------------------------------------------------------
// Yards
// ---------------------------------------------------------------------------------------------------------------

/** A space port the fleet's replacements may be queued at (as BuiltObjectList.FindShortestConstructionWaitQueue takes them). */
export function isRefillYard(empire: Empire, b: BuiltObject | null): b is BuiltObject {
    return aliveOwn(empire, b) && b.isSpacePort && b.isShipYard && b.constructionQueue !== null && !b.name.startsWith('--');
}

/** The empire's yards for the yard combo, by name. Read-only. */
export function refillYards(empire: Empire): BuiltObject[] {
    return empire.spacePorts.filter((b) => isRefillYard(empire, b)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.builtObjectID - b.builtObjectID));
}

/** Where the fleet is: its lead ship, else its (last) home base, else the capital. */
function fleetReference(empire: Empire, link: FleetTemplateLink): { xpos: number; ypos: number } | null {
    const lead = link.fleet?.leadShip ?? null;
    if (lead !== null) return lead;
    if (link.gatherPoint !== null) return link.gatherPoint;
    return empire.capital;
}

function nearest<T extends { xpos: number; ypos: number }>(galaxy: Galaxy, list: readonly T[], at: { xpos: number; ypos: number } | null): T | null {
    let best: T | null = null;
    let bestD = Number.MAX_VALUE;
    for (const x of list) {
        const d = at === null ? 0 : galaxy.calculateDistanceSquared(x.xpos, x.ypos, at.xpos, at.ypos);
        if (d < bestD) {
            bestD = d;
            best = x;
        }
    }
    return best;
}

/** The yard the fleet's replacements go to: the chosen one while it is still a yard of ours, else the nearest. */
export function refillYardFor(galaxy: Galaxy, empire: Empire, link: FleetTemplateLink): BuiltObject | null {
    if (isRefillYard(empire, link.yard)) return link.yard;
    const yards = empire.spacePorts.filter((b) => isRefillYard(empire, b));
    return nearest(galaxy, yards, fleetReference(empire, link));
}

/** The buildNewShips sites for the fleet: its yard, and that yard's colony (or the nearest) for colony-built ships. */
function refillSites(galaxy: Galaxy, empire: Empire, link: FleetTemplateLink): { spacePorts: BuiltObject[]; colonies: Habitat[] } | null {
    const port = refillYardFor(galaxy, empire, link);
    const colonies = empire.colonies.filter((h) => h != null && h.empire === empire && h.constructionQueue !== null);
    const parent = port?.parentHabitat ?? null;
    const colony = parent !== null && colonies.includes(parent) ? parent : nearest(galaxy, colonies, port ?? fleetReference(empire, link));
    if (port === null && colony === null) return null;
    return { spacePorts: port !== null ? [port] : [], colonies: colony !== null ? [colony] : [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------------------------------------------

export interface ReplenishResult {
    ok: boolean;
    /** Ships queued. */
    queued: number;
    /** Ships still missing after this (not affordable, no yard, no buildable design). */
    short: number;
    message: string;
}

const fail = (message: string, short = 0): ReplenishResult => ({ ok: false, queued: 0, short, message });

/** The link's replacements order (one per link, ships appended), created on first use. */
function refillOrder(empire: Empire, link: FleetTemplateLink, t: FleetTemplate): FleetBuildOrder {
    const b = empire.fleetDesigns!;
    let o = b.orders.find((x) => x.refillLinkId === link.id) ?? null;
    if (o === null) {
        o = { id: b.nextId++, templateId: t.id, name: link.fleet?.name ?? link.name, fleet: link.fleet, pending: [], queued: 0, built: 0, existing: 0, rally: null, sector: null, refillLinkId: link.id };
        b.orders.push(o);
    }
    return o;
}

/**
 * Buy `designs` × `amounts` for the link through buildNewShips: at the fleet's yard first, then (ships that yard
 * refused) at any yard, as BuildNewShips picks them. Returns the ships queued.
 */
function purchaseReplacements(galaxy: Galaxy, empire: Empire, link: FleetTemplateLink, designs: Design[], amounts: number[]): BuiltObject[] | null {
    const sites = refillSites(galaxy, empire, link);
    const first = buildNewShips(galaxy, empire, designs, amounts, sites);
    if (!first.ok) return null;
    const built = first.built.slice();
    if (sites !== null) {
        const rest = amounts.map((n, i) => n - built.filter((s) => s.design === designs[i]).length);
        if (rest.some((n) => n > 0)) {
            const again = buildNewShips(galaxy, empire, designs, rest, null);
            if (again.ok) built.push(...again.built);
        }
    }
    return built;
}

function recordQueued(empire: Empire, link: FleetTemplateLink, t: FleetTemplate, built: BuiltObject[]): void {
    if (built.length <= 0) return;
    const o = refillOrder(empire, link, t);
    o.fleet = link.fleet;
    o.pending.push(...built);
    o.queued += built.length;
}

/**
 * Queue the link's missing ships. `partial`: buy what the treasury can pay for in row order (auto-refill); otherwise
 * all or nothing (Replenish). Updates the link's status fields.
 */
function queueMissing(galaxy: Galaxy, empire: Empire, link: FleetTemplateLink, partial: boolean): ReplenishResult {
    const t = findFleetTemplate(empire, link.templateId);
    if (t === null) return fail('The fleet has no fleet design');
    const plan = fleetReplenishPlan(galaxy, empire, link);
    const setState = (state: FleetRefillState, short: number, shortCost: number): void => {
        link.state = state;
        link.short = short;
        link.shortCost = shortCost;
    };
    if (plan.missing <= 0) {
        setState(fleetReplacementsBuilding(empire, link).length > 0 ? 'queued' : 'full', 0, 0);
        return fail('Nothing is missing');
    }
    if (plan.designs.length <= 0) {
        setState('unbuildable', plan.missing, 0);
        return fail(`No buildable design for ${plan.unbuildable.join(', ')}`, plan.missing);
    }
    let designs = plan.designs;
    let amounts = plan.amounts;
    if (plan.cost > empire.stateMoney) {
        if (!partial) {
            setState('funds', plan.missing, plan.cost);
            return fail('Cannot afford the missing ships', plan.missing);
        }
        // Row order, one ship at a time, stopping at the first the treasury cannot pay for.
        designs = [];
        amounts = [];
        let sum = 0;
        outer: for (let i = 0; i < plan.designs.length; i++) {
            const d = plan.designs[i];
            const price = d.calculateCurrentPurchasePrice(galaxy);
            for (let k = 0; k < plan.amounts[i]; k++) {
                if (sum + price > empire.stateMoney) break outer;
                sum += price;
                if (designs[designs.length - 1] !== d) {
                    designs.push(d);
                    amounts.push(0);
                }
                amounts[amounts.length - 1]++;
            }
        }
        if (designs.length <= 0) {
            setState('funds', plan.missing, plan.cost);
            return fail('Cannot afford the missing ships', plan.missing);
        }
    }
    const built = purchaseReplacements(galaxy, empire, link, designs, amounts);
    if (built === null) {
        setState('funds', plan.missing, plan.cost);
        return fail('Cannot afford the missing ships', plan.missing);
    }
    recordQueued(empire, link, t, built);
    const short = plan.missing - built.length;
    if (built.length <= 0) {
        setState(plan.unbuildable.length > 0 ? 'unbuildable' : 'noYard', short, 0);
        return fail('No ship yard could take the ships', short);
    }
    const queuedCost = built.reduce((s, b) => s + b.purchasePrice, 0);
    const buildable = plan.amounts.reduce((s, n) => s + n, 0);
    if (short <= 0) setState('queued', 0, 0);
    else if (built.length >= buildable) setState('unbuildable', short, 0);
    else if (designs !== plan.designs) setState('funds', short, Math.max(0, plan.cost - queuedCost));
    else setState('noYard', short, 0);
    return { ok: true, queued: built.length, short, message: `${built.length} replacement${built.length === 1 ? '' : 's'} queued` + (short > 0 ? `, ${short} still missing` : '') };
}

// ---------------------------------------------------------------------------------------------------------------
// Commands (playerOps.ts fleetTemplate*)
// ---------------------------------------------------------------------------------------------------------------

function ownFleet(galaxy: Galaxy, empire: Empire, fleet: ShipGroup | null): fleet is ShipGroup {
    return fleet !== null && isPlayer(galaxy, empire) && empireShipGroups(empire).includes(fleet);
}

/** Assign template `templateId` to the fleet (a non-positive id unassigns it). */
export function assignFleetTemplate(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, templateId: number): boolean {
    if (!ownFleet(galaxy, empire, fleet)) return false;
    if (templateId <= 0) {
        const link = fleetTemplateLinkOf(empire, fleet);
        if (link === null) return false;
        unlinkFleetTemplate(empire, link);
        return true;
    }
    return linkFleetTemplate(galaxy, empire, fleet, templateId) !== null;
}

/** The fleet's "Auto-refill from template" toggle (needs an assigned template). On: checked at the next frame. */
export function setFleetAutoRefill(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, on: boolean): boolean {
    if (!ownFleet(galaxy, empire, fleet)) return false;
    const link = fleetTemplateLinkOf(empire, fleet);
    if (link === null) return false;
    link.autoRefill = on;
    if (on) link.nextCheckMs = galaxy.nowMs;
    else link.state = 'idle';
    return true;
}

/** The yard the fleet's replacements are queued at (null: the one nearest the fleet). */
export function setFleetRefillYard(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, yard: BuiltObject | null): boolean {
    if (!ownFleet(galaxy, empire, fleet)) return false;
    const link = fleetTemplateLinkOf(empire, fleet);
    if (link === null || (yard !== null && !isRefillYard(empire, yard))) return false;
    link.yard = yard;
    if (link.autoRefill) link.nextCheckMs = galaxy.nowMs;
    return true;
}

/** "Replenish": queue the fleet's missing ships once, now (all or nothing), whether auto-refill is on or off. */
export function replenishFleet(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): ReplenishResult {
    if (!ownFleet(galaxy, empire, fleet)) return fail('Not one of your fleets');
    const link = fleetTemplateLinkOf(empire, fleet);
    if (link === null) return fail('The fleet has no fleet design');
    snapshot(link, fleet);
    return queueMissing(galaxy, empire, link, false);
}

// ---------------------------------------------------------------------------------------------------------------
// The periodic check (tick/scheduler.ts runSimFrame, after the construction board)
// ---------------------------------------------------------------------------------------------------------------

function snapshot(link: FleetTemplateLink, fleet: ShipGroup): void {
    link.name = fleet.name ?? link.name;
    link.gatherPoint = fleet.gatherPoint;
    link.ships = fleet.ships.slice();
}

/** One link's auto-refill check. Returns false when the link is dropped. */
function checkLink(galaxy: Galaxy, empire: Empire, b: FleetDesignBook, link: FleetTemplateLink): boolean {
    link.nextCheckMs = galaxy.nowMs + REFILL_CHECK_MS;
    if (findFleetTemplate(empire, link.templateId) === null) return false;
    const fleet = link.fleet;
    if (fleet !== null && !empireShipGroups(empire).includes(fleet)) {
        // The fleet is gone. Destroyed in battle (every ship it had at the last check destroyed or taken): it is
        // re-formed by its replacements. Disbanded by the player (a ship of it still ours): the link goes.
        const wiped = link.ships.length > 0 && link.ships.every((s) => s.hasBeenDestroyed || s.empire !== empire);
        if (!wiped) return false;
        link.fleet = null;
        link.ships = [];
        for (const o of b.orders) if (o.refillLinkId === link.id) o.fleet = null;
    } else if (fleet !== null) {
        snapshot(link, fleet);
    }
    queueMissing(galaxy, empire, link, true);
    if (link.short > 0) link.nextCheckMs = galaxy.nowMs + REFILL_RETRY_MS;
    return true;
}

/** Not in the C#: the player's fleets with auto-refill on. O(1) unless one has it on. */
export function processFleetRefill(galaxy: Galaxy): void {
    const empire = galaxy.playerEmpire;
    if (empire === null) return;
    const b = empire.fleetDesigns;
    const links = b?.links;
    if (b === undefined || links === undefined || links.length === 0) return;
    let i = 0;
    while (i < links.length) {
        const link = links[i];
        if (!link.autoRefill || galaxy.nowMs < link.nextCheckMs) {
            i++;
            continue;
        }
        if (checkLink(galaxy, empire, b, link)) i++;
        else links.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Status (read-only, for the UI)
// ---------------------------------------------------------------------------------------------------------------

export interface FleetRefillStatus {
    link: FleetTemplateLink;
    template: FleetTemplate | null;
    rows: FleetShortfallRow[];
    /** Ships of the template in all / present in the fleet / under construction / missing. */
    wanted: number;
    present: number;
    building: number;
    missing: number;
    /** Where the replacements under construction are (yard names, distinct). */
    buildingAt: string[];
    /** What Replenish would buy now. */
    plan: ReplenishPlan;
    /** The yard new replacements would go to. */
    yard: BuiltObject | null;
    /** The chosen yard is no longer ours (the nearest is used). */
    yardLost: boolean;
}

/** The fleet's template status, or null when it has no template. Read-only. */
export function fleetRefillStatus(galaxy: Galaxy, empire: Empire, fleet: ShipGroup): FleetRefillStatus | null {
    const link = fleetTemplateLinkOf(empire, fleet);
    if (link === null) return null;
    const template = findFleetTemplate(empire, link.templateId);
    const rows = template !== null ? fleetShortfall(empire, link, template) : [];
    const building = fleetReplacementsBuilding(empire, link);
    const at: string[] = [];
    for (const s of building) {
        const site = s.builtAt as { name?: string } | null;
        const name = site?.name ?? '';
        if (name !== '' && !at.includes(name)) at.push(name);
    }
    return {
        link,
        template,
        rows,
        wanted: rows.reduce((s, r) => s + r.wanted, 0),
        present: rows.reduce((s, r) => s + r.present, 0),
        building: building.length,
        missing: rows.reduce((s, r) => s + r.missing, 0),
        buildingAt: at,
        plan: fleetReplenishPlan(galaxy, empire, link),
        yard: refillYardFor(galaxy, empire, link),
        yardLost: link.yard !== null && !isRefillYard(empire, link.yard),
    };
}

