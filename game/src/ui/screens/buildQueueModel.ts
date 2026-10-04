// Build Queue (an extension; the original has no empire-wide queue screen): the pure rows behind
// ui/screens/buildQueue.ts. The original's btnBuildOrder opens pnlBuildOrder (Main.Part2.cs:404 method_628), a
// purchase form that hands the ships to Empire.BuildNewShips and closes; what is queued afterwards is only visible
// per site in the Construction Yards screen (ConstructionYardListView + the "Ships waiting to be constructed" list,
// Main.Part3.cs:681-700). This model gathers the same data for every site of the empire at once:
//   - the ships and bases on a slipway (ConstructionYard.ShipUnderConstruction) of every space port / colony /
//     construction ship, with ConstructionYardListView.cs BindData's progress (Cells[4]);
//   - the ships waiting for a yard (ConstructionQueue.ConstructionWaitQueue), in queue order;
//   - construction ships on a Build mission that have not started their base yet;
// and tags each with the order it belongs to (a fleet-design build order or a construction job board job, both
// extensions in sim/player/). Read-only: no sim state is touched.

import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { BuiltObject } from '../../sim/builtObject';
import type { Habitat } from '../../sim/types';
import type { ConstructionQueue } from '../../sim/construction/constructionQueue';
import type { ConstructionYard } from '../../sim/construction/constructionYard';
import { componentListDiff } from '../../sim/construction/constructionYard';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { BuiltObjectMissionType, builtObjectMission } from '../../sim/missions/mission';
import { resolveSubRoleDescription } from '../../sim/designGeneration';
import { fleetBuildProgress, fleetDesignBook, sectorLabel, type FleetBuildOrder } from '../../sim/player/fleetTemplates';
import { constructionJobRows, type ConstructionJobRow } from '../../sim/player/constructionBoard';

export type BuildQueueStatus = 'building' | 'retrofit' | 'waiting' | 'enroute';

/** A construction site: a ship yard base, a construction ship, or a colony (ConstructionQueue owners). */
export type BuildQueueSite = BuiltObject | Habitat;

export interface BuildQueueRow {
    /** Stable key: the ship / base being built (the construction ship for an en-route row). */
    key: object;
    /** The object under construction / waiting (null for an en-route base, which does not exist yet). */
    ship: BuiltObject | null;
    site: BuildQueueSite;
    name: string;
    design: string;
    type: string;
    location: string;
    status: BuildQueueStatus;
    /** Waiting rows: 0-based place in the site's wait queue; -1 otherwise. */
    position: number;
    /** Waiting rows: the site's wait queue length. */
    queueLength: number;
    /** 0..1 (ConstructionYardListView Progress); 0 for waiting / en-route rows. */
    progress: number;
    /** Purchase price (BuiltObject.PurchasePrice; the design's current price for an en-route base). */
    cost: number;
    /** The order the row belongs to ("Fleet: …", "Job #n") or ''. */
    order: string;
}

/** ConstructionYardListView.cs:128 BindData, Cells[4] (Progress): 1 - unbuilt / components, or the retrofit share. */
export function yardBuildProgress(yard: ConstructionYard): number {
    const ship = yard.shipUnderConstruction;
    if (ship === null) return 0;
    if (ship.retrofitDesign !== null) {
        const num1 = componentListDiff(ship.design.components, ship.retrofitDesign.components).length + Math.trunc(componentListDiff(ship.retrofitDesign.components, ship.design.components).length / 4);
        const num2 = yard.retrofitComponentsToBeBuilt !== null ? yard.retrofitComponentsToBeBuilt.length : 0;
        const num3 = yard.retrofitComponentsToBeScrapped !== null ? yard.retrofitComponentsToBeScrapped.length : 0;
        // The C# divides by zero for a retrofit to an identical component list.
        if (num1 === 0) return 1;
        return 1.0 - (num2 + Math.trunc(num3 / 4)) / num1;
    }
    if (ship.components.count === 0) return 0;
    return 1.0 - ship.unbuiltOrDamagedComponentCount / ship.components.count;
}

/** .NET "p" format (ConstructionYardListView's progress column): percent with two decimals. */
export function formatPercentP(v: number): string {
    return `${(v * 100).toFixed(2)}%`;
}

function queueOf(site: BuildQueueSite): ConstructionQueue | null {
    return (site.constructionQueue as ConstructionQueue | null | undefined) ?? null;
}

/**
 * Every site that can hold construction: the state then private built objects with a construction queue that has
 * yards (BaconMain.cs method_423's "Construction Yards" branch; construction ships carry yards too), then every colony.
 */
export function buildQueueSites(empire: Empire): BuildQueueSite[] {
    const sites: BuildQueueSite[] = [];
    const add = (list: readonly (BuiltObject | null)[]): void => {
        for (const bo of list) {
            if (!bo || bo.hasBeenDestroyed) continue;
            const q = queueOf(bo);
            if (q !== null && (q.constructionYards?.length ?? 0) > 0) sites.push(bo);
        }
    };
    add(empire.builtObjects);
    add(empire.privateBuiltObjects);
    for (const c of empire.colonies ?? []) if (c) sites.push(c);
    return sites;
}

function isBuiltObjectSite(site: BuildQueueSite): site is BuiltObject {
    return 'subRole' in site && 'isShipYard' in site;
}

function systemName(o: { nearestSystemStar?: { name: string } | null }): string {
    return o.nearestSystemStar?.name || '(Deep Space)';
}

/** The location shown for a site: the colony / base name, or for a construction ship its build target. */
export function siteLocation(site: BuildQueueSite): string {
    if (!isBuiltObjectSite(site)) return site.name;
    if (site.subRole === BuiltObjectSubRole.ConstructionShip) {
        const m = builtObjectMission(site.mission);
        if (m !== null && m.type === BuiltObjectMissionType.Build && m.targetHabitat !== null) return m.targetHabitat.name;
        return systemName(site);
    }
    return site.name;
}

/** Map each ship pending in a fleet build order to the order's label; each job-board ship to its job. */
function orderLabels(galaxy: Galaxy, empire: Empire): { ships: Map<BuiltObject, string>; builders: Map<BuiltObject, string> } {
    const ships = new Map<BuiltObject, string>();
    for (const o of fleetDesignBook(empire).orders) for (const b of o.pending) ships.set(b, `Fleet: ${o.name}`);
    const builders = new Map<BuiltObject, string>();
    for (const j of constructionJobRows(galaxy, empire)) if (j.ship !== null && j.state === 'active') builders.set(j.ship, `Job #${j.id}`);
    return { ships, builders };
}

function designName(bo: BuiltObject): string {
    return bo.retrofitDesign?.name ?? bo.design?.name ?? '';
}

/** All queued ship and base construction across the empire: per site, the slipways first, then the wait queue. */
export function buildQueueRows(galaxy: Galaxy, empire: Empire): BuildQueueRow[] {
    const rows: BuildQueueRow[] = [];
    const labels = orderLabels(galaxy, empire);
    const constructing = new Set<BuiltObject>();
    for (const site of buildQueueSites(empire)) {
        const q = queueOf(site);
        if (q === null) continue;
        const location = siteLocation(site);
        const siteOrder = isBuiltObjectSite(site) ? (labels.builders.get(site) ?? '') : '';
        for (const yard of q.constructionYards ?? []) {
            const ship = yard?.shipUnderConstruction ?? null;
            if (!yard || ship === null) continue;
            if (isBuiltObjectSite(site)) constructing.add(site);
            rows.push({
                key: ship,
                ship,
                site,
                name: ship.name,
                design: designName(ship),
                type: resolveSubRoleDescription(ship.subRole),
                location,
                status: ship.retrofitDesign !== null ? 'retrofit' : 'building',
                position: -1,
                queueLength: 0,
                progress: yardBuildProgress(yard),
                cost: ship.purchasePrice,
                order: labels.ships.get(ship) ?? siteOrder,
            });
        }
        const wait = q.constructionWaitQueue ?? [];
        wait.forEach((ship, i) => {
            if (!ship) return;
            rows.push({
                key: ship,
                ship,
                site,
                name: ship.name,
                design: designName(ship),
                type: resolveSubRoleDescription(ship.subRole),
                location,
                status: 'waiting',
                position: i,
                queueLength: wait.length,
                progress: 0,
                cost: ship.purchasePrice,
                order: labels.ships.get(ship) ?? '',
            });
        });
    }
    // Construction ships on a Build mission that have not put the base on their slipway yet.
    for (const cs of (empire.constructionShips ?? []) as (BuiltObject | null)[]) {
        if (!cs || cs.hasBeenDestroyed || constructing.has(cs)) continue;
        const m = builtObjectMission(cs.mission);
        if (m === null || m.type !== BuiltObjectMissionType.Build || m.design === null) continue;
        rows.push({
            key: cs,
            ship: null,
            site: cs,
            name: m.design.name,
            design: m.design.name,
            type: resolveSubRoleDescription(m.design.subRole),
            location: siteLocation(cs),
            status: 'enroute',
            position: -1,
            queueLength: 0,
            progress: 0,
            cost: m.design.calculateCurrentPurchasePrice(galaxy),
            order: labels.builders.get(cs) ?? '',
        });
    }
    return rows;
}

/** The Status column. */
export function buildQueueStatusText(r: BuildQueueRow): string {
    switch (r.status) {
        case 'building':
            return 'Building';
        case 'retrofit':
            return 'Retrofitting';
        case 'waiting':
            return `Waiting (${r.position + 1} of ${r.queueLength})`;
        case 'enroute':
            return 'Builder en route';
    }
}

export interface BuildQueueSummary {
    building: number;
    waiting: number;
    enroute: number;
    /** Sum of the rows' purchase prices. */
    value: number;
}

export function buildQueueSummary(rows: readonly BuildQueueRow[]): BuildQueueSummary {
    const s: BuildQueueSummary = { building: 0, waiting: 0, enroute: 0, value: 0 };
    for (const r of rows) {
        if (r.status === 'waiting') s.waiting++;
        else if (r.status === 'enroute') s.enroute++;
        else s.building++;
        s.value += r.cost;
    }
    return s;
}

/** Which Move buttons (Main.Part5.cs:2147-2213 Move to Top / Up / Down / Bottom) apply to a row. */
export function waitMoveState(r: BuildQueueRow | null): { top: boolean; up: boolean; down: boolean; bottom: boolean } {
    if (r === null || r.status !== 'waiting' || r.ship === null) return { top: false, up: false, down: false, bottom: false };
    const first = r.position <= 0;
    const last = r.position >= r.queueLength - 1;
    return { top: !first, up: !first, down: !last, bottom: !last };
}

/** Real time in ms as "1h 05m" / "3m 07s" / "12s" (the job board's estimates). */
export function formatEtaMs(ms: number): string {
    const sec = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
}

/** The job board's state column. */
export function jobStateText(j: ConstructionJobRow): string {
    return j.state === 'open' ? 'Open' : j.state === 'active' ? 'Building' : 'Next';
}

export interface FleetOrderRow {
    order: FleetBuildOrder;
    name: string;
    built: number;
    total: number;
    building: number;
    lost: number;
    where: string;
    fleet: string;
}

/** The fleet-design build orders (sim/player/fleetTemplates.ts) with their progress. */
export function fleetOrderRows(empire: Empire): FleetOrderRow[] {
    return fleetDesignBook(empire).orders.map((o) => {
        const p = fleetBuildProgress(empire, o);
        return {
            order: o,
            name: o.name,
            built: p.built,
            total: p.total,
            building: p.building,
            lost: p.lost,
            // A fleet's replacements (auto-refill / Replenish, sim/player/fleetRefill.ts).
            where: o.refillLinkId !== undefined ? 'Replacements' : o.sector === null ? 'Any sector' : `Sector ${sectorLabel(o.sector)}`,
            fleet: o.fleet?.name ?? '',
        };
    });
}
