// Player fleet templates ("Fleet Designs" tab of the Fleets window).
//
// Deviation: the original has no fleet templates (searched DistantWorlds.Types / Main.Part*.cs for fleet templates,
// "Build Fleet", ShipGroup templates: none — the player builds ships in the Build Order window and forms fleets in the
// Ships and Bases window's Set Fleet combo). This layer only combines those existing mechanics:
//   - a template is a name + (design, count) rows, stored on the player empire (`empire.fleetDesigns`, created on first
//     use, so AI empires and old saves carry nothing; a missing field reads as no templates);
//   - "Form from existing" = the Set Fleet '(New Fleet)' path (fleetOps.setShipsFleet) on finished unassigned ships,
//     then a fleet Move to the rally point (the fleet Move order, executeShipAction) with the rally as its home base;
//   - "Build fleet" = the Build Order purchase path (empireConstruction.buildNewShips, Empire.6.cs PurchaseNewBuiltObjects)
//     optionally limited to the yards of one galaxy sector; each queued ship joins the forming fleet when completed
//     (constructionQueue.ts completion hook), where the original's AssignFleetWaypointMission sends it to the fleet.
// Every change goes through player commands (playerOps.ts fleetTemplate*), so the command log replays it.
// Headless: no DOM / Pixi. No Rnd except what the reused executors draw.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Design } from '../design';
import type { Habitat } from '../types';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { type ShipGroup, empireShipGroups, forceCompleteMission, shipGroupAssignMission } from '../fleets/shipGroup';
import { shipGroupAddShipToFleet, shipGroupUpdate } from '../fleets/shipGroupTasks';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, type StellarObject } from '../missions/mission';
import { markFleetPlayerOrder } from '../missions/playerOrder';
import { buildNewShips } from '../construction/empireConstruction';
import { setShipConstructedHook, type ConstructionQueue } from '../construction/constructionQueue';
import { builtObjectCompleteTeardown } from '../combat/teardown';
import { findNewestCanBuild, getBuildableDesignsBySubRoles } from '../designGeneration';
import { setShipsFleet } from './fleetOps';
import { sectorColumnName } from '../sectorNames';

export interface FleetTemplateEntry {
    design: Design;
    count: number;
}

export interface FleetTemplate {
    id: number;
    name: string;
    entries: FleetTemplateEntry[];
}

/** A grid sector (Galaxy.ResolveSector coordinates). */
export interface SectorRef {
    x: number;
    y: number;
}

/** A running "Build fleet" order. */
export interface FleetBuildOrder {
    id: number;
    templateId: number;
    name: string;
    /** The fleet being formed (null until its first ship exists; re-created if it was disbanded). */
    fleet: ShipGroup | null;
    /** Queued ships not completed yet. */
    pending: BuiltObject[];
    /** Ships queued by the order. */
    queued: number;
    /** Queued ships that completed and joined. */
    built: number;
    /** Ships already in the fleet when the order started (form-from-existing part). */
    existing: number;
    rally: Habitat | BuiltObject | null;
    sector: SectorRef | null;
    /** Replacements of a template link (auto-refill / Replenish, player/fleetRefill.ts): FleetTemplateLink.id. */
    refillLinkId?: number;
}

export interface FleetDesignBook {
    nextId: number;
    templates: FleetTemplate[];
    orders: FleetBuildOrder[];
    /** Fleets with an assigned template (player/fleetRefill.ts); absent until the first assignment (old saves: none). */
    links?: FleetTemplateLink[];
}

/** The last auto-refill check's outcome (player/fleetRefill.ts), for the status line. */
export type FleetRefillState = 'idle' | 'full' | 'queued' | 'funds' | 'noYard' | 'unbuildable';

/**
 * A fleet's assigned template (player/fleetRefill.ts). Assigning one changes nothing in the sim; with `autoRefill` on
 * the fleet's missing ships are queued periodically, and Replenish queues them once.
 */
export interface FleetTemplateLink {
    id: number;
    /** The fleet; null while a wiped-out fleet is being re-formed by its replacements. */
    fleet: ShipGroup | null;
    templateId: number;
    /** Per-fleet "Auto-refill from template" (off by default). */
    autoRefill: boolean;
    /** The yard replacements are queued at (one of the empire's space ports); null = the yard nearest the fleet. */
    yard: BuiltObject | null;
    /** The fleet's name and home base at the last check (the re-formed fleet's name and rally point). */
    name: string;
    gatherPoint: StellarObject | null;
    /** The fleet's ships at the last check (tells a fleet destroyed in battle from one the player disbanded). */
    ships: BuiltObject[];
    /** galaxy.nowMs of the next auto-refill check. */
    nextCheckMs: number;
    state: FleetRefillState;
    /** Ships the last check could not queue, and their cost. */
    short: number;
    shortCost: number;
}

declare module '../empire' {
    interface Empire {
        /** Player fleet templates (player/fleetTemplates.ts); absent until first used. */
        fleetDesigns?: FleetDesignBook;
    }
}

/** The empire's template book (read-only view; empty when none was ever made). */
export function fleetDesignBook(empire: Empire): FleetDesignBook {
    return empire.fleetDesigns ?? { nextId: 1, templates: [], orders: [] };
}

function book(empire: Empire): FleetDesignBook {
    if (empire.fleetDesigns === undefined) empire.fleetDesigns = { nextId: 1, templates: [], orders: [] };
    return empire.fleetDesigns;
}

// ---------------------------------------------------------------------------------------------------------------
// Template links (a fleet's assigned template; auto-refill / Replenish in player/fleetRefill.ts)
// ---------------------------------------------------------------------------------------------------------------

/** The fleet's template link, or null (read-only). */
export function fleetTemplateLinkOf(empire: Empire, fleet: ShipGroup): FleetTemplateLink | null {
    const links = empire.fleetDesigns?.links;
    if (links === undefined) return null;
    for (let i = 0; i < links.length; i++) if (links[i].fleet === fleet) return links[i];
    return null;
}

/**
 * Assign template `templateId` to `fleet` (a new link with auto-refill off, or the existing link re-pointed). Assigning
 * changes nothing in the sim by itself. Returns the link, or null (no such template).
 */
export function linkFleetTemplate(galaxy: Galaxy, empire: Empire, fleet: ShipGroup, templateId: number): FleetTemplateLink | null {
    if (findFleetTemplate(empire, templateId) === null) return null;
    const b = book(empire);
    if (b.links === undefined) b.links = [];
    let link = fleetTemplateLinkOf(empire, fleet);
    if (link === null) {
        link = {
            id: b.nextId++,
            fleet,
            templateId,
            autoRefill: false,
            yard: null,
            name: fleet.name ?? '',
            gatherPoint: fleet.gatherPoint,
            ships: fleet.ships.slice(),
            nextCheckMs: galaxy.nowMs,
            state: 'idle',
            short: 0,
            shortCost: 0,
        };
        b.links.push(link);
    } else if (link.templateId !== templateId) {
        link.templateId = templateId;
        link.state = 'idle';
        link.short = 0;
        link.shortCost = 0;
        link.nextCheckMs = galaxy.nowMs;
    }
    return link;
}

/** Remove a link (unassign the template). Its queued replacements still finish and join the fleet. */
export function unlinkFleetTemplate(empire: Empire, link: FleetTemplateLink): void {
    const links = empire.fleetDesigns?.links;
    if (links === undefined) return;
    const i = links.indexOf(link);
    if (i >= 0) links.splice(i, 1);
}

export function findFleetTemplate(empire: Empire, id: number): FleetTemplate | null {
    return empire.fleetDesigns?.templates.find((t) => t.id === id) ?? null;
}

/** Designs a template row may use: the empire's own warship designs (Military role: Set Fleet only takes those). */
export function fleetTemplateDesignAllowed(empire: Empire, design: Design): boolean {
    return empire.designs.includes(design) && design.role === BuiltObjectRole.Military;
}

// ---------------------------------------------------------------------------------------------------------------
// Template editing
// ---------------------------------------------------------------------------------------------------------------

export function createFleetTemplate(empire: Empire, name: string): number {
    const b = book(empire);
    const id = b.nextId++;
    b.templates.push({ id, name: name.trim() === '' ? `Fleet Design ${id}` : name.trim(), entries: [] });
    return id;
}

export function renameFleetTemplate(empire: Empire, id: number, name: string): boolean {
    const t = findFleetTemplate(empire, id);
    if (t === null || name.trim() === '') return false;
    t.name = name.trim();
    return true;
}

export function deleteFleetTemplate(empire: Empire, id: number): boolean {
    const b = empire.fleetDesigns;
    if (b === undefined) return false;
    const i = b.templates.findIndex((t) => t.id === id);
    if (i < 0) return false;
    b.templates.splice(i, 1);
    // The fleets it was assigned to lose their template (and auto-refill).
    if (b.links !== undefined) b.links = b.links.filter((l) => l.templateId !== id);
    return true;
}

/** Set a row's count (0 removes the row; a new design adds a row). */
export function setFleetTemplateEntry(empire: Empire, id: number, design: Design, count: number): boolean {
    const t = findFleetTemplate(empire, id);
    if (t === null) return false;
    const n = Math.max(0, Math.min(999, Math.trunc(count)));
    const i = t.entries.findIndex((e) => e.design === design);
    if (n <= 0) {
        if (i >= 0) t.entries.splice(i, 1);
        return i >= 0;
    }
    if (i >= 0) {
        t.entries[i].count = n;
        return true;
    }
    if (!fleetTemplateDesignAllowed(empire, design)) return false;
    t.entries.push({ design, count: n });
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------------------------------------------

export interface FleetTemplateTotals {
    ships: number;
    cost: number;
    /** Sum of the designs' FirepowerRaw (the Fleets list "Power" column, ShipGroup TotalFirepower). */
    strength: number;
}

export function fleetTemplateTotals(galaxy: Galaxy, t: FleetTemplate): FleetTemplateTotals {
    let ships = 0;
    let cost = 0;
    let strength = 0;
    for (const e of t.entries) {
        ships += e.count;
        cost += e.design.calculateCurrentPurchasePrice(galaxy) * e.count;
        strength += e.design.firepowerRaw * e.count;
    }
    return { ships, cost, strength };
}

/** Finished state warships of the empire that are in no fleet (candidates for "Form from existing"). */
export function unassignedWarships(empire: Empire): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const b of empire.builtObjects) {
        if (b == null || b.empire !== empire || b.hasBeenDestroyed) continue;
        if (b.role !== BuiltObjectRole.Military || b.shipGroup !== null || b.builtAt !== null || b.retrofitDesign !== null || b.topSpeed <= 0) continue;
        out.push(b);
    }
    return out;
}

export interface FormEntryReport {
    design: Design;
    wanted: number;
    /** Ships of exactly this design taken. */
    exact: number;
    /** Same-subrole substitutes taken, per substitute design name. */
    substitutes: { designName: string; count: number }[];
    short: number;
}

export interface FleetPick {
    ships: BuiltObject[];
    entries: FormEntryReport[];
}

function distanceTo(galaxy: Galaxy, b: BuiltObject, rally: { xpos: number; ypos: number } | null): number {
    return rally === null ? 0 : galaxy.calculateDistance(b.xpos, b.ypos, rally.xpos, rally.ypos);
}

/**
 * Pick unassigned finished warships for the template: per row the ships of that exact design nearest the rally first,
 * then (allowSubstitutes) ships of the same subrole for what is still short. Read-only.
 */
export function pickFleetShips(galaxy: Galaxy, empire: Empire, t: FleetTemplate, rally: { xpos: number; ypos: number } | null, allowSubstitutes: boolean): FleetPick {
    const pool = unassignedWarships(empire)
        .map((b) => ({ b, d: distanceTo(galaxy, b, rally) }))
        .sort((p, q) => p.d - q.d || p.b.builtObjectID - q.b.builtObjectID)
        .map((p) => p.b);
    const taken = new Set<BuiltObject>();
    const ships: BuiltObject[] = [];
    const entries: FormEntryReport[] = t.entries.map((e) => ({ design: e.design, wanted: e.count, exact: 0, substitutes: [], short: e.count }));
    for (const r of entries) {
        for (const b of pool) {
            if (r.short <= 0) break;
            if (taken.has(b) || b.design !== r.design) continue;
            taken.add(b);
            ships.push(b);
            r.exact++;
            r.short--;
        }
    }
    if (allowSubstitutes) {
        for (const r of entries) {
            for (const b of pool) {
                if (r.short <= 0) break;
                if (taken.has(b) || b.subRole !== r.design.subRole) continue;
                taken.add(b);
                ships.push(b);
                r.short--;
                const s = r.substitutes.find((x) => x.designName === b.design.name);
                if (s !== undefined) s.count++;
                else r.substitutes.push({ designName: b.design.name, count: 1 });
            }
        }
    }
    return { ships, entries };
}

// ---------------------------------------------------------------------------------------------------------------
// Form from existing
// ---------------------------------------------------------------------------------------------------------------

export interface FormFleetResult {
    ok: boolean;
    fleet: ShipGroup | null;
    entries: FormEntryReport[];
    message: string;
}

function newFleet(galaxy: Galaxy, empire: Empire, ships: BuiltObject[], name: string, rally: Habitat | BuiltObject | null): ShipGroup | null {
    const fleet = setShipsFleet(galaxy, empire, ships, 'new');
    if (fleet === null) return null;
    fleet.name = name;
    if (rally !== null) fleet.gatherPoint = rally;
    return fleet;
}

/** Send the fleet to its rally point (the fleet Move order, executeShipAction) as a player order. */
function gatherFleet(galaxy: Galaxy, fleet: ShipGroup, rally: Habitat | BuiltObject | null): void {
    if (rally === null || fleet.ships.length <= 0) return;
    forceCompleteMission(galaxy, fleet);
    shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Move, rally, null, BuiltObjectMissionPriority.Normal, true);
    markFleetPlayerOrder(fleet);
}

export function formFleetFromExisting(galaxy: Galaxy, empire: Empire, templateId: number, rally: Habitat | null, allowSubstitutes: boolean): FormFleetResult {
    const t = findFleetTemplate(empire, templateId);
    if (t === null) return { ok: false, fleet: null, entries: [], message: 'No such fleet design' };
    const r = rally ?? empire.capital;
    const pick = pickFleetShips(galaxy, empire, t, r, allowSubstitutes);
    if (pick.ships.length <= 0) return { ok: false, fleet: null, entries: pick.entries, message: 'No unassigned ships match this fleet design' };
    const fleet = newFleet(galaxy, empire, pick.ships, t.name, r);
    if (fleet === null) return { ok: false, fleet: null, entries: pick.entries, message: 'Could not form the fleet' };
    gatherFleet(galaxy, fleet, r);
    linkFleetTemplate(galaxy, empire, fleet, t.id); // the fleet remembers its template (auto-refill stays off)
    const short = pick.entries.reduce((s, e) => s + e.short, 0);
    return { ok: true, fleet, entries: pick.entries, message: `${fleet.name} formed with ${fleet.ships.length} ships` + (short > 0 ? ` (${short} short)` : '') };
}

// ---------------------------------------------------------------------------------------------------------------
// Build fleet
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.7.cs ResolveSector(x, y): the grid sector of a point. */
export function sectorOf(galaxy: Galaxy, x: number, y: number): SectorRef {
    const sx = Math.max(0, Math.min(Math.trunc(Math.trunc(x) / galaxy.sectorSize), galaxy.sectorWidth - 1));
    const sy = Math.max(0, Math.min(Math.trunc(Math.trunc(y) / galaxy.sectorSize), galaxy.sectorHeight - 1));
    return { x: sx, y: sy };
}

/** Galaxy.7.cs ResolveSectorDescription: column letter + row number ("C4"). */
export function sectorLabel(s: SectorRef): string {
    return sectorColumnName(s.x) + String(s.y + 1);
}

function inSector(galaxy: Galaxy, o: { xpos: number; ypos: number }, s: SectorRef): boolean {
    const t = sectorOf(galaxy, o.xpos, o.ypos);
    return t.x === s.x && t.y === s.y;
}

/** The yards buildNewShips may use in a sector (space ports for warships, colonies for resupply ships). */
export function sectorBuildSites(galaxy: Galaxy, empire: Empire, s: SectorRef): { spacePorts: BuiltObject[]; colonies: Habitat[] } {
    return {
        spacePorts: empire.spacePorts.filter((b) => b != null && inSector(galaxy, b, s)),
        colonies: empire.colonies.filter((h) => h != null && inSector(galaxy, h, s)),
    };
}

/** Sectors holding at least one of the empire's space ports (the "Build in sector" choices). */
export function shipyardSectors(galaxy: Galaxy, empire: Empire): SectorRef[] {
    const out: SectorRef[] = [];
    for (const b of empire.spacePorts) {
        if (b == null) continue;
        const s = sectorOf(galaxy, b.xpos, b.ypos);
        if (!out.some((o) => o.x === s.x && o.y === s.y)) out.push(s);
    }
    return out.sort((a, b) => a.x - b.x || a.y - b.y);
}

/** The design a row is built with: its own while still buildable, else the newest buildable of its subrole. */
export function buildDesignFor(empire: Empire, design: Design): Design | null {
    if (empire.designs.includes(design) && getBuildableDesignsBySubRoles([design], [design.subRole], empire).length > 0) return design;
    return findNewestCanBuild(empire.designs, design.subRole as BuiltObjectSubRole, empire);
}

export type FleetBuildMode = 'missing' | 'all';

export interface BuildFleetResult {
    ok: boolean;
    orderId: number | null;
    fleet: ShipGroup | null;
    /** Ships queued per design name. */
    queued: { designName: string; count: number }[];
    /** Rows with no buildable design. */
    unbuildable: string[];
    entries: FormEntryReport[];
    message: string;
}

/**
 * "Build fleet": 'missing' first forms the fleet from unassigned ships (as Form from existing) and queues the shortfall;
 * 'all' queues every row. The ships are bought through buildNewShips (all or nothing against StateMoney, as the Build
 * Order window), at the yards of `sector` when given. The order then adds each completed ship to the fleet.
 */
export function buildFleetFromTemplate(galaxy: Galaxy, empire: Empire, templateId: number, mode: FleetBuildMode, sector: SectorRef | null, rally: Habitat | null, allowSubstitutes: boolean): BuildFleetResult {
    const fail = (message: string, entries: FormEntryReport[] = [], unbuildable: string[] = []): BuildFleetResult => ({ ok: false, orderId: null, fleet: null, queued: [], unbuildable, entries, message });
    const t = findFleetTemplate(empire, templateId);
    if (t === null) return fail('No such fleet design');
    const sites = sector === null ? null : sectorBuildSites(galaxy, empire, sector);
    if (sites !== null && sites.spacePorts.length <= 0 && sites.colonies.length <= 0) return fail(`No ship yards in sector ${sectorLabel(sector!)}`);
    const rallyPoint: Habitat | BuiltObject | null = rally ?? (sites !== null ? (sites.spacePorts[0]?.parentHabitat ?? sites.spacePorts[0] ?? sites.colonies[0] ?? null) : empire.capital);
    let pick: FleetPick | null = null;
    const need: { design: Design; count: number }[] = [];
    if (mode === 'missing') {
        pick = pickFleetShips(galaxy, empire, t, rallyPoint, allowSubstitutes);
        for (const e of pick.entries) if (e.short > 0) need.push({ design: e.design, count: e.short });
    } else {
        for (const e of t.entries) if (e.count > 0) need.push({ design: e.design, count: e.count });
    }
    const designs: Design[] = [];
    const amounts: number[] = [];
    const unbuildable: string[] = [];
    for (const n of need) {
        const d = buildDesignFor(empire, n.design);
        if (d === null) {
            unbuildable.push(n.design.name);
            continue;
        }
        const i = designs.indexOf(d);
        if (i >= 0) amounts[i] += n.count;
        else {
            designs.push(d);
            amounts.push(n.count);
        }
    }
    const entries = pick?.entries ?? [];
    let built: BuiltObject[] = [];
    if (designs.length > 0) {
        const res = buildNewShips(galaxy, empire, designs, amounts, sites);
        if (!res.ok) return fail(res.message !== undefined ? 'Cannot afford the build order' : 'The build order failed', entries, unbuildable);
        built = res.built;
    }
    const existing = pick?.ships ?? [];
    if (built.length <= 0 && existing.length <= 0) return fail(designs.length > 0 ? 'No ship yard could take the ships' : 'Nothing to build', entries, unbuildable);
    let fleet: ShipGroup | null = null;
    if (existing.length > 0) {
        fleet = newFleet(galaxy, empire, existing, t.name, rallyPoint);
        if (fleet !== null) {
            gatherFleet(galaxy, fleet, rallyPoint);
            linkFleetTemplate(galaxy, empire, fleet, t.id);
        }
    }
    const queued: { designName: string; count: number }[] = [];
    for (const b of built) {
        const q = queued.find((x) => x.designName === b.design.name);
        if (q !== undefined) q.count++;
        else queued.push({ designName: b.design.name, count: 1 });
    }
    let orderId: number | null = null;
    if (built.length > 0) {
        const bk = book(empire);
        orderId = bk.nextId++;
        bk.orders.push({ id: orderId, templateId, name: t.name, fleet, pending: built.slice(), queued: built.length, built: 0, existing: existing.length, rally: rallyPoint, sector });
    }
    const where = sector === null ? '' : ` in sector ${sectorLabel(sector)}`;
    return {
        ok: true,
        orderId,
        fleet,
        queued,
        unbuildable,
        entries,
        message: `${t.name}: ${built.length} ships queued${where}` + (existing.length > 0 ? `, ${existing.length} existing ships formed` : ''),
    };
}

export interface FleetBuildProgress {
    built: number;
    total: number;
    /** Still under construction. */
    building: number;
    /** Queued ships lost before completion (yard destroyed, ...). */
    lost: number;
}

function stillBuilding(empire: Empire, b: BuiltObject): boolean {
    return !b.hasBeenDestroyed && b.builtAt !== null && b.empire === empire;
}

export function fleetBuildProgress(empire: Empire, o: FleetBuildOrder): FleetBuildProgress {
    const building = o.pending.filter((b) => stillBuilding(empire, b)).length;
    return { built: o.built + o.existing, total: o.queued + o.existing, building, lost: o.pending.length - building };
}

/**
 * Cancel a build order: it stops adding ships to the fleet. Ships still waiting in a yard's queue (not started) are
 * removed and their purchase price refunded; ships already on a slipway finish as unassigned ships.
 */
export function cancelFleetBuildOrder(galaxy: Galaxy, empire: Empire, orderId: number): { ok: boolean; removed: number; refund: number } {
    const b = empire.fleetDesigns;
    const i = b === undefined ? -1 : b.orders.findIndex((o) => o.id === orderId);
    if (b === undefined || i < 0) return { ok: false, removed: 0, refund: 0 };
    const o = b.orders[i];
    b.orders.splice(i, 1);
    // Cancelling a fleet's replacements also stops its auto-refill (it would queue them again at the next check).
    if (o.refillLinkId !== undefined) {
        const link = b.links?.find((l) => l.id === o.refillLinkId);
        if (link !== undefined) link.autoRefill = false;
    }
    let removed = 0;
    let refund = 0;
    for (const ship of o.pending) {
        if (!stillBuilding(empire, ship)) continue;
        const site = ship.builtAt as { constructionQueue?: unknown } | null;
        const q = (site?.constructionQueue ?? null) as ConstructionQueue | null;
        const wait = q?.constructionWaitQueue ?? null;
        if (q === null || wait === null || !wait.includes(ship)) continue;
        q.removeBuiltObject(ship);
        refund += ship.purchasePrice;
        if (ship.design.buildCount > 0) ship.design.buildCount--;
        builtObjectCompleteTeardown(galaxy, ship);
        removed++;
    }
    empire.stateMoney += refund;
    return { ok: true, removed, refund };
}

/** A re-formed fleet's rally point: its old home base while still ours (or neutral), else the capital. */
function refillRally(empire: Empire, p: StellarObject | null): Habitat | BuiltObject | null {
    if (p !== null && !p.hasBeenDestroyed) {
        const owner = (p as { empire?: Empire | null }).empire ?? null;
        if (owner === null || owner === empire) return p as Habitat | BuiltObject;
    }
    return empire.capital;
}

/** Construction completion hook: a ship of a build order joins (or starts) its fleet. */
export function fleetBuildOrderShipCompleted(galaxy: Galaxy, ship: BuiltObject): void {
    const empire = ship.empire;
    const b = empire?.fleetDesigns;
    if (empire == null || b === undefined || b.orders.length <= 0) return;
    for (let i = 0; i < b.orders.length; i++) {
        const o = b.orders[i];
        const k = o.pending.indexOf(ship);
        if (k < 0) continue;
        o.pending.splice(k, 1);
        o.built++;
        if (ship.role === BuiltObjectRole.Military) {
            if (o.fleet !== null && empireShipGroups(empire).includes(o.fleet)) {
                shipGroupAddShipToFleet(galaxy, o.fleet, ship);
                shipGroupUpdate(galaxy, o.fleet);
            } else if (o.refillLinkId !== undefined) {
                // A fleet's replacements (player/fleetRefill.ts): a fleet destroyed in battle (its link re-forming) is
                // re-formed by its first replacement, under its name and home base; a fleet the player disbanded (no
                // link) is not — the ship finishes unassigned.
                const link = b.links?.find((l) => l.id === o.refillLinkId) ?? null;
                if (link !== null && link.fleet === null) {
                    const rally = refillRally(empire, link.gatherPoint);
                    o.fleet = newFleet(galaxy, empire, [ship], link.name !== '' ? link.name : o.name, rally);
                    if (o.fleet !== null) {
                        gatherFleet(galaxy, o.fleet, rally);
                        link.fleet = o.fleet;
                        link.ships = o.fleet.ships.slice();
                        link.gatherPoint = o.fleet.gatherPoint;
                    }
                }
            } else {
                o.fleet = newFleet(galaxy, empire, [ship], o.name, o.rally);
                if (o.fleet !== null) {
                    gatherFleet(galaxy, o.fleet, o.rally);
                    linkFleetTemplate(galaxy, empire, o.fleet, o.templateId);
                }
            }
        }
        if (o.pending.every((p) => !stillBuilding(empire, p))) b.orders.splice(i, 1);
        return;
    }
}

setShipConstructedHook(fleetBuildOrderShipCompleted);
