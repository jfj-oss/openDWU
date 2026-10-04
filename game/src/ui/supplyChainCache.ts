// Improvements "supplyChain": the cached supply queries the UI reads (sim/logistics/supplyChain.ts). The Construction
// Yards screen, the selection panel, the Supply Shortages overlay and the resource supply panel all share one snapshot
// of the player's empire, recomputed at most once a second (SUPPLY_REFRESH_MS) and only while something visible asks
// for it. The queries run inside withPureSimReads (sim/readOnlyQuery.ts): a port-only read, no lazy record writes, so
// it is safe on the in-thread game and on a sim-worker replica alike.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { withPureSimReads } from '../sim/readOnlyQuery';
import { galaxyStarDate } from '../sim/tick/simTime';
import { calculateStrategicResourceSupplyGrowthFactor } from '../sim/taxes';
import { empireSupplySnapshot, resourceSupplyView, type EmpireSupplySnapshot, type ResourceSupplyView } from '../sim/logistics/supplyChain';
import { isImprovementEnabled } from './improvements';

/** The improvement id (ui/improvements.ts). */
export const SUPPLY_IMPROVEMENT = 'supplyChain';
/** Longest a cached result is reused (wall-clock ms). */
export const SUPPLY_REFRESH_MS = 1000;

interface SnapEntry {
    at: number;
    snap: EmpireSupplySnapshot;
}
interface ViewEntry {
    at: number;
    view: ResourceSupplyView;
}

const snaps = new WeakMap<Galaxy, SnapEntry>();
const views = new WeakMap<Galaxy, Map<number, ViewEntry>>();

/** Cost bookkeeping (perf check: scripts/supplychain-shots.mjs reads it through window.__dwu). */
export const supplyStats = { snapshots: 0, views: 0, lastSnapshotMs: 0, maxSnapshotMs: 0, lastViewMs: 0, maxViewMs: 0 };

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** True while the supply-chain improvement is on (Game Options → Improvements). */
export function supplyChainEnabled(): boolean {
    return isImprovementEnabled(SUPPLY_IMPROVEMENT);
}

/** The player's (or `empire`'s) supply snapshot, at most SUPPLY_REFRESH_MS old; null when the improvement is off. */
export function supplySnapshot(galaxy: Galaxy, empire: Empire | null = galaxy.playerEmpire, force = false): EmpireSupplySnapshot | null {
    if (empire === null || !supplyChainEnabled()) return null;
    const t = now();
    const e = snaps.get(galaxy);
    if (!force && e !== undefined && e.snap.empire === empire && t - e.at < SUPPLY_REFRESH_MS) return e.snap;
    const snap = withPureSimReads(() => empireSupplySnapshot(galaxy, empire, (h) => calculateStrategicResourceSupplyGrowthFactor(galaxy, h)));
    const ms = now() - t;
    supplyStats.snapshots++;
    supplyStats.lastSnapshotMs = ms;
    supplyStats.maxSnapshotMs = Math.max(supplyStats.maxSnapshotMs, ms);
    snaps.set(galaxy, { at: now(), snap });
    return snap;
}

/** Where `resourceId` is produced / held / needed in the player's empire, at most SUPPLY_REFRESH_MS old. */
export function resourceSupply(galaxy: Galaxy, resourceId: number, empire: Empire | null = galaxy.playerEmpire, force = false): ResourceSupplyView | null {
    if (empire === null || !supplyChainEnabled()) return null;
    let m = views.get(galaxy);
    if (m === undefined) {
        m = new Map();
        views.set(galaxy, m);
    }
    const t = now();
    const e = m.get(resourceId);
    if (!force && e !== undefined && t - e.at < SUPPLY_REFRESH_MS) return e.view;
    const snap = supplySnapshot(galaxy, empire);
    const t1 = now();
    const view = withPureSimReads(() => resourceSupplyView(galaxy, empire, resourceId, snap, galaxyStarDate(galaxy)));
    const ms = now() - t1;
    supplyStats.views++;
    supplyStats.lastViewMs = ms;
    supplyStats.maxViewMs = Math.max(supplyStats.maxViewMs, ms);
    if (m.size > 16) m.clear();
    m.set(resourceId, { at: now(), view });
    return view;
}

/** Drop the cached results (a player command changed a queue: the next read recomputes). */
export function invalidateSupply(galaxy: Galaxy): void {
    snaps.delete(galaxy);
    views.delete(galaxy);
}
