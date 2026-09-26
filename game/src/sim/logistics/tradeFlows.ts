// Freight-flow recorder (task 19e-9). NOT a port: DW:U never showed trade flows. It observes the one place the C# moves
// trade money — $C/DistantWorlds.Types/Empire.4.cs:1135 InitiateContract (TS logistics/contracts.ts initiateContract) —
// through the contractEvents.ts hook, and aggregates the contracts per (trading post, destination, resource) into
// 13 monthly buckets. Kept beside the galaxy in a WeakMap like player/commandLog.ts: nothing here is written into the
// galaxy graph, nothing draws Rnd, and nothing is saved (state digests, saves and seed pins are unaffected). After a
// load the flows start empty and refill; the empire-pair totals (empirePairTotals) come from saved relation data.
//
// Other sources read live (read-only):
// - $C/DistantWorlds.Types/BuiltObject.cs:3415 PerformFinancialTransaction: `currentYearsIncome` / `dateOfLastIncome`
//   per port (reset on the first income of a new year) → hubsInWindow.
// - $C/DistantWorlds.Types/DiplomaticRelation.cs:101 PerformTradeTransaction + YearlyTradeValueList → empirePairTotals
//   (same cast contracts.ts performTradeTransaction uses).
// Contracts are paid at initiation, not delivery (C# semantics): every value here is "contracted".

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import type { YearlyTradeValueList } from '../diplomacy';
import { YEAR_LENGTH } from '../galaxyTime';
import { HabitatCategoryType } from '../types';
import type { StellarObject } from './contracts';
import { isRestrictedResource } from './orders';
import { registerContractListener, type ContractEvent } from './contractEvents';

/** Months kept (the current one plus the 12 before it). */
export const FLOW_MONTHS = 13;
/** One bucket = one game month. */
export const MONTH_LENGTH = YEAR_LENGTH / 12;

export function monthIndex(starDate: number): number {
    return Math.floor(starDate / MONTH_LENGTH);
}

/** One (trading post, destination, commodity) series. */
export interface FlowEntry {
    sellingPoint: StellarObject;
    destination: StellarObject;
    /** -1 for component contracts. */
    resourceId: number;
    /** -1 for resource contracts. */
    componentId: number;
    /** System index of the selling point / destination, -1 in deep space. */
    sellerSystem: number;
    destSystem: number;
    /** Positions (world units) of the posts and of their systems' stars (the posts' own when in deep space). */
    postFromX: number;
    postFromY: number;
    postToX: number;
    postToY: number;
    sysFromX: number;
    sysFromY: number;
    sysToX: number;
    sysToY: number;
    /** Ring buffer: slot i holds month `slotMonth[i]` (-1 = empty). */
    slotMonth: Int32Array;
    value: Float64Array;
    amount: Float64Array;
    count: Int32Array;
    sellers: Set<Empire>;
    buyers: Set<Empire>;
    lastStarDate: number;
}

export interface TradeFlowLedger {
    entries: FlowEntry[];
    /** sellingPoint → destination → commodity key → entry. */
    index: Map<StellarObject, Map<StellarObject, Map<number, FlowEntry>>>;
    /** Freighter → the destination of its latest contract (for the in-flight leaders). */
    freighterDestination: WeakMap<BuiltObject, StellarObject>;
    /** Bumped on every recorded contract. */
    version: number;
    /** starDate the ledger was created (the "collecting since" note). */
    startStarDate: number;
}

export function createTradeFlowLedger(startStarDate: number): TradeFlowLedger {
    return { entries: [], index: new Map(), freighterDestination: new WeakMap(), version: 0, startStarDate };
}

function commodityKey(resourceId: number, componentId: number): number {
    return resourceId >= 0 ? resourceId : -1000 - componentId;
}

/** System index + star position of a trading post / destination (-1 and the object's own position in deep space). */
function locate(galaxy: Galaxy, o: StellarObject): { sys: number; x: number; y: number } {
    let star = null;
    if (o instanceof BuiltObject) star = o.nearestSystemStar;
    else {
        const s = galaxy.determineHabitatSystemStar(o);
        if (s.category === HabitatCategoryType.Star) star = s;
    }
    if (star === null) return { sys: -1, x: o.xpos, y: o.ypos };
    return { sys: star.systemIndex, x: star.xpos, y: star.ypos };
}

/** Add one contract to the ledger. O(1): Map lookups plus a bucket write; allocates only for a new series. */
export function recordContract(galaxy: Galaxy | null, ledger: TradeFlowLedger, ev: ContractEvent): void {
    const ck = commodityKey(ev.resourceId, ev.componentId);
    let byDest = ledger.index.get(ev.sellingPoint);
    if (byDest === undefined) {
        byDest = new Map();
        ledger.index.set(ev.sellingPoint, byDest);
    }
    let byCommodity = byDest.get(ev.destination);
    if (byCommodity === undefined) {
        byCommodity = new Map();
        byDest.set(ev.destination, byCommodity);
    }
    let e = byCommodity.get(ck);
    if (e === undefined) {
        const from = galaxy !== null ? locate(galaxy, ev.sellingPoint) : { sys: -1, x: ev.sellingPoint.xpos, y: ev.sellingPoint.ypos };
        const to = galaxy !== null ? locate(galaxy, ev.destination) : { sys: -1, x: ev.destination.xpos, y: ev.destination.ypos };
        e = {
            sellingPoint: ev.sellingPoint,
            destination: ev.destination,
            resourceId: ev.resourceId,
            componentId: ev.componentId,
            sellerSystem: from.sys,
            destSystem: to.sys,
            postFromX: ev.sellingPoint.xpos,
            postFromY: ev.sellingPoint.ypos,
            postToX: ev.destination.xpos,
            postToY: ev.destination.ypos,
            sysFromX: from.x,
            sysFromY: from.y,
            sysToX: to.x,
            sysToY: to.y,
            slotMonth: new Int32Array(FLOW_MONTHS).fill(-1),
            value: new Float64Array(FLOW_MONTHS),
            amount: new Float64Array(FLOW_MONTHS),
            count: new Int32Array(FLOW_MONTHS),
            sellers: new Set(),
            buyers: new Set(),
            lastStarDate: ev.starDate,
        };
        byCommodity.set(ck, e);
        ledger.entries.push(e);
    }
    const m = monthIndex(ev.starDate);
    const slot = ((m % FLOW_MONTHS) + FLOW_MONTHS) % FLOW_MONTHS;
    if (e.slotMonth[slot] !== m) {
        e.slotMonth[slot] = m;
        e.value[slot] = 0;
        e.amount[slot] = 0;
        e.count[slot] = 0;
    }
    e.value[slot] += ev.value;
    e.amount[slot] += ev.amount;
    e.count[slot] += 1;
    if (!e.sellers.has(ev.seller)) e.sellers.add(ev.seller);
    if (!e.buyers.has(ev.buyer)) e.buyers.add(ev.buyer);
    e.lastStarDate = ev.starDate;
    // Posts move (bases barely, ships do): keep the latest position.
    e.postFromX = ev.sellingPoint.xpos;
    e.postFromY = ev.sellingPoint.ypos;
    e.postToX = ev.destination.xpos;
    e.postToY = ev.destination.ypos;
    if (ev.freighter !== null) ledger.freighterDestination.set(ev.freighter, ev.destination);
    ledger.version++;
}

// ---------------------------------------------------------------------------
// Recording on / off
// ---------------------------------------------------------------------------

const ledgers = new WeakMap<Galaxy, TradeFlowLedger>();
let enabledCount = 0;
let unregister: (() => void) | null = null;

/** Start recording contracts for `galaxy` (idempotent). Registers the `tradeFlows.record` listener on first use. */
export function enableTradeFlowRecording(galaxy: Galaxy, startStarDate = 0): TradeFlowLedger {
    const existing = ledgers.get(galaxy);
    if (existing !== undefined) return existing;
    const ledger = createTradeFlowLedger(startStarDate);
    ledgers.set(galaxy, ledger);
    enabledCount++;
    if (unregister === null) {
        unregister = registerContractListener({
            id: 'tradeFlows.record',
            run(g, ev) {
                const l = ledgers.get(g);
                if (l !== undefined) recordContract(g, l, ev);
            },
        });
    }
    return ledger;
}

/** Stop recording for `galaxy` and drop its ledger; the listener is unregistered when no galaxy records any more. */
export function disableTradeFlowRecording(galaxy: Galaxy): void {
    if (!ledgers.delete(galaxy)) return;
    enabledCount--;
    if (enabledCount <= 0 && unregister !== null) {
        unregister();
        unregister = null;
        enabledCount = 0;
    }
}

export function tradeFlowLedger(galaxy: Galaxy): TradeFlowLedger | null {
    return ledgers.get(galaxy) ?? null;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface FlowCategory {
    key: string;
    label: string;
    /** Only scenario categories carry a colour; the default groups' colours live in the render module. */
    color?: number;
}

export const FLOW_CATEGORY_MINERAL: FlowCategory = { key: 'mineral', label: 'Mineral' };
export const FLOW_CATEGORY_GAS: FlowCategory = { key: 'gas', label: 'Gas' };
export const FLOW_CATEGORY_LUXURY: FlowCategory = { key: 'luxury', label: 'Luxury' };
export const FLOW_CATEGORY_RESTRICTED: FlowCategory = { key: 'restricted', label: 'Restricted luxury' };
export const FLOW_CATEGORY_COMPONENT: FlowCategory = { key: 'component', label: 'Component' };
export const DEFAULT_FLOW_CATEGORIES: readonly FlowCategory[] = [
    FLOW_CATEGORY_MINERAL,
    FLOW_CATEGORY_GAS,
    FLOW_CATEGORY_LUXURY,
    FLOW_CATEGORY_RESTRICTED,
    FLOW_CATEGORY_COMPONENT,
];

export type FlowCategoryFn = (galaxy: Galaxy, resourceId: number, componentId: number) => FlowCategory | null;
const categoryFns: FlowCategoryFn[] = [];

/** Scenario packages map a commodity to their own category first (19a "Rim goods"). Returns an unregister function. */
export function registerFlowCategory(fn: FlowCategoryFn): () => void {
    categoryFns.push(fn);
    return () => {
        const i = categoryFns.indexOf(fn);
        if (i >= 0) categoryFns.splice(i, 1);
    };
}

/** Category of a commodity: a registered scenario category, else Mineral / Gas / Luxury (resources.txt type 0/1/2),
 * Restricted (orders.ts isRestrictedResource) or Component. */
export function flowCategory(galaxy: Galaxy, resourceId: number, componentId = -1): FlowCategory {
    for (const fn of categoryFns) {
        const c = fn(galaxy, resourceId, componentId);
        if (c !== null) return c;
    }
    if (resourceId < 0) return FLOW_CATEGORY_COMPONENT;
    if (isRestrictedResource(galaxy, resourceId)) return FLOW_CATEGORY_RESTRICTED;
    const r = galaxy.resourceSystem.byId.get(resourceId);
    if (r === undefined) return FLOW_CATEGORY_MINERAL;
    if (r.type === 1) return FLOW_CATEGORY_GAS;
    if (r.type === 2) return FLOW_CATEGORY_LUXURY;
    return FLOW_CATEGORY_MINERAL;
}

// ---------------------------------------------------------------------------
// Queries (pure)
// ---------------------------------------------------------------------------

export type FlowLevel = 'system' | 'post';

export interface FlowFilter {
    /** Category key (flowCategory().key), or null for all. */
    category?: string | null;
    /** Single resource id, or null for all. */
    resourceId?: number | null;
    /** Only flows where this empire sells or buys. */
    empire?: Empire | null;
    /** Commodity → category (defaults to flowCategory; tests pass their own). */
    categoryOf?: (resourceId: number, componentId: number) => FlowCategory;
}

export interface FlowRow {
    key: string;
    level: FlowLevel;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    sellerSystem: number;
    destSystem: number;
    /** Set for post-level rows (and system rows made of a single post pair). */
    sellingPoint: StellarObject | null;
    destination: StellarObject | null;
    /** Commodities in this flow, largest value first. */
    resourceIds: number[];
    /** Category of the largest commodity. */
    category: FlowCategory;
    value: number;
    amount: number;
    count: number;
    /** Value per game year over the window (value * 12 / effective months). */
    valuePerYear: number;
    /** Share of the value from the last 2 months (0..1). */
    recency: number;
    sellers: Empire[];
    buyers: Empire[];
}

/** Window sums of one entry: [value, amount, count, recentValue]. */
function windowSums(e: FlowEntry, curMonth: number, months: number, out: Float64Array): void {
    out[0] = out[1] = out[2] = out[3] = 0;
    for (let i = 0; i < FLOW_MONTHS; i++) {
        const m = e.slotMonth[i];
        if (m < 0 || m > curMonth || m <= curMonth - months) continue;
        out[0] += e.value[i];
        out[1] += e.amount[i];
        out[2] += e.count[i];
        if (m > curMonth - 2) out[3] += e.value[i];
    }
}

function systemKey(sys: number, o: StellarObject): string {
    return sys >= 0 ? `s${sys}` : `o${o instanceof BuiltObject ? 'b' + o.builtObjectID : 'h' + (o as { habitatIndex: number }).habitatIndex}`;
}

interface Acc {
    row: FlowRow;
    byCommodity: Map<number, number>;
    comp: Map<number, number>;
    recent: number;
    sellers: Set<Empire>;
    buyers: Set<Empire>;
}

/**
 * Flows summed over the last `months` months (1 = ~30 days, 12 = a year) as of `nowStarDate`, one row per
 * (seller system, buyer system) at `level` 'system' or per (trading post, destination) at 'post'; sorted by value
 * descending (ties: key, so the order is stable).
 */
export function flowsInWindow(
    ledger: TradeFlowLedger,
    nowStarDate: number,
    months: number,
    filter: FlowFilter,
    level: FlowLevel = 'system',
): FlowRow[] {
    const categoryOf = filter.categoryOf ?? (() => FLOW_CATEGORY_MINERAL);
    const cur = monthIndex(nowStarDate);
    const span = Math.max(1, Math.min(FLOW_MONTHS, Math.trunc(months)));
    const elapsed = Math.max(1, Math.ceil((nowStarDate - ledger.startStarDate) / MONTH_LENGTH));
    const effMonths = Math.min(span, elapsed);
    const sums = new Float64Array(4);
    const acc = new Map<string, Acc>();
    for (const e of ledger.entries) {
        const cat = categoryOf(e.resourceId, e.componentId);
        if (filter.category != null && cat.key !== filter.category) continue;
        if (filter.resourceId != null && e.resourceId !== filter.resourceId) continue;
        if (filter.empire != null && !e.sellers.has(filter.empire) && !e.buyers.has(filter.empire)) continue;
        windowSums(e, cur, span, sums);
        if (sums[2] <= 0) continue;
        const key =
            level === 'system'
                ? `${systemKey(e.sellerSystem, e.sellingPoint)}>${systemKey(e.destSystem, e.destination)}`
                : `${systemKey(-1, e.sellingPoint)}>${systemKey(-1, e.destination)}`;
        let a = acc.get(key);
        if (a === undefined) {
            a = {
                row: {
                    key,
                    level,
                    fromX: level === 'system' ? e.sysFromX : e.postFromX,
                    fromY: level === 'system' ? e.sysFromY : e.postFromY,
                    toX: level === 'system' ? e.sysToX : e.postToX,
                    toY: level === 'system' ? e.sysToY : e.postToY,
                    sellerSystem: e.sellerSystem,
                    destSystem: e.destSystem,
                    sellingPoint: e.sellingPoint,
                    destination: e.destination,
                    resourceIds: [],
                    category: cat,
                    value: 0,
                    amount: 0,
                    count: 0,
                    valuePerYear: 0,
                    recency: 0,
                    sellers: [],
                    buyers: [],
                },
                byCommodity: new Map(),
                comp: new Map(),
                recent: 0,
                sellers: new Set(),
                buyers: new Set(),
            };
            acc.set(key, a);
        } else if (a.row.sellingPoint !== e.sellingPoint || a.row.destination !== e.destination) {
            a.row.sellingPoint = null;
            a.row.destination = null;
        }
        a.row.value += sums[0];
        a.row.amount += sums[1];
        a.row.count += sums[2];
        a.recent += sums[3];
        a.byCommodity.set(e.resourceId, (a.byCommodity.get(e.resourceId) ?? 0) + sums[0]);
        if (e.resourceId < 0) a.comp.set(e.componentId, 1);
        for (const s of e.sellers) a.sellers.add(s);
        for (const b of e.buyers) a.buyers.add(b);
    }
    const rows: FlowRow[] = [];
    for (const a of acc.values()) {
        const r = a.row;
        const commodities = [...a.byCommodity.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
        r.resourceIds = commodities.map((c) => c[0]);
        const top = commodities[0][0];
        r.category = categoryOf(top, top < 0 ? (a.comp.keys().next().value ?? -1) : -1);
        r.valuePerYear = (r.value * 12) / effMonths;
        r.recency = r.value > 0 ? a.recent / r.value : 0;
        r.sellers = [...a.sellers].sort((x, y) => x.empireId - y.empireId);
        r.buyers = [...a.buyers].sort((x, y) => x.empireId - y.empireId);
        rows.push(r);
    }
    rows.sort((x, y) => y.value - x.value || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    return rows;
}

export interface HubRow {
    port: BuiltObject;
    owner: Empire | null;
    /** currentYearsIncome when the last income was this year, else 0 (BuiltObject.cs:3415 resets it on the next). */
    income: number;
    x: number;
    y: number;
}

/** Start of the game year containing `starDate` (the C# `date - date % yearLength`). */
export function yearStart(starDate: number): number {
    return starDate - (starDate % YEAR_LENGTH);
}

/**
 * Trade hubs: every live built object with income this year (space ports, mining-station ports; income accrues in
 * contracts.ts performFinancialTransaction), sorted by income descending.
 */
export function hubsInWindow(
    galaxy: { builtObjects: readonly (BuiltObject | null)[] },
    nowStarDate: number,
    filter: { empire?: Empire | null } = {},
): HubRow[] {
    const y0 = yearStart(nowStarDate);
    const rows: HubRow[] = [];
    for (const bo of galaxy.builtObjects) {
        if (bo === null || bo === undefined || bo.hasBeenDestroyed) continue;
        if (bo.currentYearsIncome <= 0 || bo.dateOfLastIncome < y0) continue;
        const owner = bo.actualEmpire as Empire | null;
        if (filter.empire != null && owner !== filter.empire) continue;
        rows.push({ port: bo, owner, income: bo.currentYearsIncome, x: bo.xpos, y: bo.ypos });
    }
    rows.sort((a, b) => b.income - a.income || a.port.builtObjectID - b.port.builtObjectID);
    return rows;
}

export interface EmpirePairRow {
    a: Empire;
    b: Empire;
    /** The year's trade value on a's relation with b (DiplomaticRelation.cs:101: both directions of trade). */
    value: number;
}

/**
 * Empire-pair yearly trade totals from the saved relation data (DiplomaticRelation.cs:101 YearlyTradeValueList):
 * one row per unordered pair (the larger of the two relations' values, which normally agree), sorted by value desc.
 */
export function empirePairTotals(galaxy: { empires: readonly Empire[] }, nowStarDate: number): EmpirePairRow[] {
    const y0 = yearStart(nowStarDate);
    const byPair = new Map<string, EmpirePairRow>();
    for (const e of galaxy.empires) {
        for (const rel of e.diplomaticRelations) {
            const other = rel.otherEmpire;
            if (other === null || other === e) continue;
            const tv = (rel as unknown as { _tradeValues: YearlyTradeValueList })._tradeValues;
            const v = tv.getByYear(y0)?.value ?? 0;
            if (v <= 0) continue;
            const [a, b] = e.empireId < other.empireId ? [e, other] : [other, e];
            const key = `${a.empireId}:${b.empireId}`;
            const row = byPair.get(key);
            if (row === undefined) byPair.set(key, { a, b, value: v });
            else if (v > row.value) row.value = v;
        }
    }
    return [...byPair.values()].sort((x, y) => y.value - x.value || x.a.empireId - y.a.empireId || x.b.empireId - y.b.empireId);
}
