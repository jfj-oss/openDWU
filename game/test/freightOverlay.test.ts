// Task 19e-9: freight-flow overlay — contract hook, recorder, queries and the overlay's pure render helpers.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { YearlyTradeValueList } from '../src/sim/diplomacy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { contractListenersActive, registerContractListener, type ContractEvent } from '../src/sim/logistics/contractEvents';
import {
    FLOW_CATEGORY_GAS,
    FLOW_CATEGORY_LUXURY,
    FLOW_CATEGORY_MINERAL,
    FLOW_MONTHS,
    MONTH_LENGTH,
    createTradeFlowLedger,
    disableTradeFlowRecording,
    empirePairTotals,
    enableTradeFlowRecording,
    flowCategory,
    flowsInWindow,
    hubsInWindow,
    pruneTradeFlowLedger,
    recordContract,
    registerFlowCategory,
    tradeFlowLedger,
    yearStart,
    type FlowCategory,
} from '../src/sim/logistics/tradeFlows';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import {
    FLOW_LINE_MAX_PX,
    FLOW_LINE_MIN_PX,
    FLOW_ROUTE_MIN_SHARE,
    FLOW_ROUTES_GALAXY,
    FLOW_ROUTES_SECTOR,
    FreightOverlay,
    clipSegmentToView,
    flowArcFor,
    flowColor,
    freightLeader,
    hubDiscsFor,
    hubRadiusPx,
    mergeRouteDirections,
    resourceTotals,
    routeCountForView,
    routeWidthPx,
    segmentInView,
    selectTopRoutes,
    type FlowRoute,
} from '../src/render/freightOverlay';
import { Container } from 'pixi.js';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 600_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!();
});

function tradeValueSum(galaxy: Galaxy): number {
    let sum = 0;
    for (const e of galaxy.empires) {
        for (const rel of e.diplomaticRelations) {
            const tv = (rel as unknown as { _tradeValues: YearlyTradeValueList })._tradeValues;
            for (const it of tv.items) if (it !== null) sum += it.value;
        }
    }
    return sum;
}

describe('19e-9 contract hook + recorder on the harness game', () => {
    it('no listener is registered until recording is enabled', () => {
        expect(contractListenersActive()).toBe(false);
    });

    it('routes exist after 60 game-days and the ledger sums to the contracted amounts', () => {
        const { galaxy } = cachedTickGame(gameData);
        const events: ContractEvent[] = [];
        cleanups.push(registerContractListener({ id: 'test.collect', run: (_g, ev) => events.push(ev) }));
        const start = galaxyStarDate(galaxy);
        const ledger = enableTradeFlowRecording(galaxy, start);
        cleanups.push(() => disableTradeFlowRecording(galaxy));
        const tradeBefore = tradeValueSum(galaxy);
        runGameSeconds(galaxy, 100); // 60 game-days (GAME_DAY_LENGTH = 600 s / 360)
        const now = galaxyStarDate(galaxy);
        expect(events.length).toBeGreaterThan(0);
        for (const ev of events) {
            expect(ev.buyer).not.toBeNull();
            expect(ev.amount).toBeGreaterThan(0);
        }
        const rows = flowsInWindow(ledger, now, 12, {}, 'post');
        expect(rows.length).toBeGreaterThan(0);
        const sysRows = flowsInWindow(ledger, now, 12, {}, 'system');
        expect(sysRows.length).toBeGreaterThan(0);
        expect(sysRows.length).toBeLessThanOrEqual(rows.length);
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        const evAmount = sum(events.map((e) => e.amount));
        const evValue = sum(events.map((e) => e.value));
        expect(sum(rows.map((r) => r.amount))).toBeCloseTo(evAmount, 6);
        expect(sum(rows.map((r) => r.value))).toBeCloseTo(evValue, 3);
        expect(sum(sysRows.map((r) => r.count))).toBe(events.length);
        // DiplomaticRelation.cs:101: a foreign sale (independents / pirates excluded) adds its value to both relations.
        const foreign = events.filter(
            (e) =>
                e.seller !== galaxy.independentEmpire &&
                e.buyer !== galaxy.independentEmpire &&
                e.seller !== e.buyer &&
                e.seller.pirateEmpireBaseHabitat === null &&
                e.buyer.pirateEmpireBaseHabitat === null,
        );
        const tradeDelta = tradeValueSum(galaxy) - tradeBefore;
        expect(tradeDelta).toBeCloseTo(2 * sum(foreign.map((e) => e.value)), 3);
        console.log(`[19e-9] 60 days: ${events.length} contracts (${foreign.length} foreign), ${rows.length} post flows, ${sysRows.length} system flows, ${Math.round(evValue)} cr`);
        // Hubs: the ports that took income this year.
        const hubs = hubsInWindow(galaxy, now);
        for (let i = 1; i < hubs.length; i++) expect(hubs[i - 1].income).toBeGreaterThanOrEqual(hubs[i].income);
        // Empire pairs from saved relation data.
        for (const p of empirePairTotals(galaxy, now)) expect(p.a.empireId).toBeLessThan(p.b.empireId);
    }, 1_200_000);

    it('recording on changes nothing in the galaxy (digest + Rnd draws)', async () => {
        const { stateDigest } = await import('../src/sim/tick/digest');
        const off = cachedTickGame(gameData).galaxy;
        const on = cachedTickGame(gameData).galaxy;
        enableTradeFlowRecording(on, galaxyStarDate(on));
        cleanups.push(() => disableTradeFlowRecording(on));
        const t0 = performance.now();
        runGameSeconds(off, 90);
        const t1 = performance.now();
        runGameSeconds(on, 90);
        const t2 = performance.now();
        expect(tradeFlowLedger(on)!.version).toBeGreaterThan(0);
        expect(on.rnd.drawCount).toBe(off.rnd.drawCount);
        expect(stateDigest(on)).toBe(stateDigest(off));
        const ratio = (t2 - t1) / (t1 - t0);
        console.log(`[19e-9] recording on/off time ratio over 90 s: ${ratio.toFixed(3)}`);
        // Timing only, not asserted: the ratio climbs past 2 when other suites share the machine (gate runs at load 20+).
        void ratio;
    }, 1_200_000);

    it('disabling the last recording galaxy unregisters the listener', () => {
        const g = {} as Galaxy;
        enableTradeFlowRecording(g);
        expect(contractListenersActive()).toBe(true);
        disableTradeFlowRecording(g);
        expect(contractListenersActive()).toBe(false);
        expect(tradeFlowLedger(g)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Synthetic ledger math
// ---------------------------------------------------------------------------

const empA = { empireId: 1, name: 'A', mainColor: 0xff0000 } as unknown as Empire;
const empB = { empireId: 2, name: 'B', mainColor: 0x00ff00 } as unknown as Empire;
const empC = { empireId: 3, name: 'C', mainColor: 0x0000ff } as unknown as Empire;
function post(x: number, y: number, idx: number): never {
    return { xpos: x, ypos: y, habitatIndex: idx } as never;
}
const P1 = post(0, 0, 1);
const P2 = post(1000, 0, 2);
const P3 = post(0, 1000, 3);
function ev(p: Partial<ContractEvent> & { starDate: number }): ContractEvent {
    return {
        seller: empA,
        sellingPoint: P1,
        buyer: empB,
        destination: P2,
        resourceId: 1,
        componentId: -1,
        amount: 10,
        value: 100,
        isState: false,
        freighter: null,
        ...p,
    };
}
const cats = (r: number): FlowCategory => (r === 2 ? FLOW_CATEGORY_GAS : FLOW_CATEGORY_MINERAL);

describe('19e-9 ledger math (synthetic)', () => {
    it('sums per post pair, groups commodities, sorts by value', () => {
        const l = createTradeFlowLedger(0);
        recordContract(null, l, ev({ starDate: 10 }));
        recordContract(null, l, ev({ starDate: 20, resourceId: 2, value: 300, amount: 5 }));
        recordContract(null, l, ev({ starDate: 30, destination: P3, value: 50, seller: empC }));
        const rows = flowsInWindow(l, 40, 12, { categoryOf: cats }, 'post');
        expect(rows.map((r) => r.value)).toEqual([400, 50]);
        expect(rows[0].resourceIds).toEqual([2, 1]);
        expect(rows[0].category).toBe(FLOW_CATEGORY_GAS);
        expect(rows[0].count).toBe(2);
        expect(rows[0].amount).toBe(15);
        expect(rows[1].sellers).toEqual([empC]);
        // Filters.
        expect(flowsInWindow(l, 40, 12, { categoryOf: cats, category: 'mineral' }, 'post').map((r) => r.value)).toEqual([100, 50]);
        expect(flowsInWindow(l, 40, 12, { categoryOf: cats, resourceId: 2 }, 'post').map((r) => r.value)).toEqual([300]);
        expect(flowsInWindow(l, 40, 12, { categoryOf: cats, empire: empC }, 'post').map((r) => r.value)).toEqual([50]);
    });

    it('keeps 13 monthly buckets; the window selects months; old months roll off', () => {
        const l = createTradeFlowLedger(0);
        for (let m = 0; m < 20; m++) recordContract(null, l, ev({ starDate: m * MONTH_LENGTH + 5, value: m + 1 }));
        const now = 19 * MONTH_LENGTH + 10;
        const all = flowsInWindow(l, now, FLOW_MONTHS, {}, 'post');
        // months 7..19 → values 8..20
        let want = 0;
        for (let v = 8; v <= 20; v++) want += v;
        expect(all[0].value).toBe(want);
        expect(flowsInWindow(l, now, 1, {}, 'post')[0].value).toBe(20);
        const two = flowsInWindow(l, now, 2, {}, 'post')[0];
        expect(two.value).toBe(39);
        expect(two.recency).toBe(1);
        expect(two.valuePerYear).toBeCloseTo((39 * 12) / 2, 6);
        expect(flowsInWindow(l, now, 12, {}, 'post')[0].recency).toBeCloseTo(39 / (want - 8), 6);
    });

    it('deep-space posts key by object; system rows merge posts of one system pair', () => {
        const l = createTradeFlowLedger(0);
        recordContract(null, l, ev({ starDate: 1 }));
        recordContract(null, l, ev({ starDate: 1, sellingPoint: P3 }));
        // null galaxy → every post is "deep space" (system -1): the system rows stay separate.
        expect(flowsInWindow(l, 2, 12, {}, 'system')).toHaveLength(2);
        // Same system for both sellers → merged.
        for (const e of l.entries) e.sellerSystem = 7;
        const merged = flowsInWindow(l, 2, 12, {}, 'system');
        expect(merged).toHaveLength(1);
        expect(merged[0].value).toBe(200);
        expect(merged[0].sellingPoint).toBeNull();
    });

    it('component contracts categorise as Component and do not crash', () => {
        const galaxy = { resourceSystem: { byId: new Map(), resources: [] } } as unknown as Galaxy;
        expect(flowCategory(galaxy, -1, 12).key).toBe('component');
        const l = createTradeFlowLedger(0);
        recordContract(null, l, ev({ starDate: 1, resourceId: -1, componentId: 12 }));
        expect(flowsInWindow(l, 2, 12, { categoryOf: (r, c) => flowCategory(galaxy, r, c) }, 'post')[0].category.key).toBe('component');
    });

    it('a registered scenario category wins, and takes its own colour', () => {
        const galaxy = { resourceSystem: { byId: new Map(), resources: [] } } as unknown as Galaxy;
        const rim: FlowCategory = { key: 'rim', label: 'Rim goods', color: 0x12ab34 };
        const off = registerFlowCategory((_g, r) => (r === 5 ? rim : null));
        try {
            expect(flowCategory(galaxy, 5)).toBe(rim);
            expect(flowColor(rim)).toBe(0x12ab34);
        } finally {
            off();
        }
        expect(flowCategory(galaxy, 5).key).not.toBe('rim');
    });

    it('hubs: a port whose last income is from last year shows nothing (C# year reset)', () => {
        const now = 3 * YEAR_LENGTH + 1000;
        const bo = (id: number, income: number, date: number) =>
            ({ builtObjectID: id, currentYearsIncome: income, dateOfLastIncome: date, hasBeenDestroyed: false, actualEmpire: empA, xpos: 0, ypos: 0 }) as never;
        const rows = hubsInWindow({ builtObjects: [bo(1, 500, yearStart(now) - 1), bo(2, 200, now - 10), bo(3, 900, now), null] }, now);
        expect(rows.map((r) => r.port.builtObjectID)).toEqual([3, 2]);
    });
});

// ---------------------------------------------------------------------------
// Render helpers (pure)
// ---------------------------------------------------------------------------

describe('19e-9 overlay layout helpers', () => {
    const cam = { x: 0, y: 0, width: 1000, height: 1000 };
    it('arc control point sits to the left of travel (the supply-chain highlight)', () => {
        const ab = flowArcFor(0, 0, 1000, 0);
        expect(ab.cx).toBeCloseTo(500, 6);
        expect(ab.cy).toBeCloseTo(-150, 6); // left of +x in screen space (y down) is -y
    });

    it('line width is FLOW_LINE_MIN_PX..FLOW_LINE_MAX_PX on screen by sqrt(volume / the largest)', () => {
        expect(routeWidthPx(0, 100)).toBe(FLOW_LINE_MIN_PX);
        expect(routeWidthPx(100, 100)).toBe(FLOW_LINE_MAX_PX);
        expect(routeWidthPx(25, 100)).toBeCloseTo(FLOW_LINE_MIN_PX + (FLOW_LINE_MAX_PX - FLOW_LINE_MIN_PX) * 0.5, 9);
        expect(routeWidthPx(1e12, 100)).toBe(FLOW_LINE_MAX_PX);
        expect(routeWidthPx(5, 0)).toBe(FLOW_LINE_MIN_PX);
    });

    it('route count: 15 when the view spans more than three sectors, 25 closer in', () => {
        expect(FLOW_ROUTES_GALAXY).toBe(15);
        expect(FLOW_ROUTES_SECTOR).toBe(25);
        expect(routeCountForView(10 * 1000, 6 * 1000, 1000)).toBe(FLOW_ROUTES_GALAXY);
        expect(routeCountForView(1800, 1000, 1000)).toBe(FLOW_ROUTES_SECTOR);
    });

    it('segmentInView clips against the camera rect', () => {
        expect(segmentInView(-100, 0, 100, 0, 1, cam)).toBe(true);
        expect(segmentInView(-5000, 0, 5000, 0, 1, cam)).toBe(true); // passes through, both ends outside
        expect(segmentInView(-5000, -5000, -4000, 5000, 1, cam)).toBe(false);
        expect(segmentInView(600, 600, 5000, 600, 1, cam)).toBe(false);
        expect(segmentInView(600, 0, 5000, 0, 1, cam, 200)).toBe(true); // within the padding
        // The on-screen part (where the arrowhead goes): x -500..500 of -1500..2500.
        const c = clipSegmentToView(-1500, 0, 2500, 0, 1, cam)!;
        expect(c[0]).toBeCloseTo(0.25, 9);
        expect(c[1]).toBeCloseTo(0.5, 9);
        expect(clipSegmentToView(0, 0, 100, 0, 1, cam)).toEqual([0, 1]);
    });

    it('hub discs: top n in view the viewer knows, 5..20 px by income against the largest, owner colour', () => {
        expect(hubRadiusPx(0, 100)).toBe(5);
        expect(hubRadiusPx(100, 100)).toBe(20);
        const hub = (income: number, x: number, owner: Empire | null = empB) => ({ port: {} as never, owner, income, x, y: 0 });
        const hubs = [hub(1000, 0), hub(900, 9000), hub(500, 10), hub(400, 20, null), hub(50, 30)];
        const discs = hubDiscsFor(hubs, 1, cam, 2, (h) => h.income !== 500);
        // 900 is out of view, 500 not known; 50 is under 10 % of 1000 (and n = 2 stops at two).
        expect(discs.map((d) => d.hub.income)).toEqual([1000, 400]);
        expect(discs[0].color).toBe(0x00ff00);
        expect(discs[0].r).toBe(20);
        expect(hubDiscsFor(hubs, 1, cam, 10).map((d) => d.hub.income)).toEqual([1000, 500, 400]);
    });
});

// ---------------------------------------------------------------------------
// Route merging, top-N, cargo / resource filters
// ---------------------------------------------------------------------------

/** A ledger whose posts sit in systems (post index = system index; the system's star at the post). */
function systemLedger(contracts: Array<{ from: number; to: number; resourceId: number; value: number }>, starDate = 1): ReturnType<typeof createTradeFlowLedger> {
    const l = createTradeFlowLedger(starDate - 1);
    const posts = new Map<number, never>();
    const at = (i: number) => {
        let p = posts.get(i);
        if (p === undefined) posts.set(i, (p = post((i % 10) * 1000, Math.floor(i / 10) * 1000, 500 + i)));
        return p;
    };
    for (const c of contracts) recordContract(null, l, ev({ starDate, sellingPoint: at(c.from), destination: at(c.to), resourceId: c.resourceId, value: c.value }));
    for (const e of l.entries) {
        e.sellerSystem = (e.sellingPoint as unknown as { habitatIndex: number }).habitatIndex - 500;
        e.destSystem = (e.destination as unknown as { habitatIndex: number }).habitatIndex - 500;
    }
    return l;
}
// 1, 2: mineral; 3: gas; 4: luxury.
const cats4 = (r: number): FlowCategory => (r === 3 ? FLOW_CATEGORY_GAS : r === 4 ? FLOW_CATEGORY_LUXURY : FLOW_CATEGORY_MINERAL);

describe('freight routes: both directions merged, top N, filters', () => {
    it('merges A→B and B→A into one route, oriented along the larger direction', () => {
        const l = systemLedger([
            { from: 1, to: 2, resourceId: 1, value: 100 },
            { from: 2, to: 1, resourceId: 3, value: 300 },
            { from: 1, to: 3, resourceId: 4, value: 50 },
            { from: 5, to: 5, resourceId: 1, value: 999 }, // within one system: no line
        ]);
        const routes = mergeRouteDirections(flowsInWindow(l, 2, 12, { categoryOf: cats4 }, 'system'));
        expect(routes).toHaveLength(2);
        const r = routes[0];
        expect(r.aSystem).toBe(2);
        expect(r.bSystem).toBe(1);
        expect(r.abPerYear).toBe(300 * 12);
        expect(r.baPerYear).toBe(100 * 12);
        expect(r.total).toBe(400 * 12);
        expect(r.category).toBe(FLOW_CATEGORY_GAS);
        expect(r.resourceIds.sort()).toEqual([1, 3]);
        expect([r.ax, r.ay, r.bx, r.by]).toEqual([2000, 0, 1000, 0]);
        expect(routes[1].ba).toBeNull();
    });

    it('top N: the largest routes the filter accepts, those under 10 % of the largest dropped', () => {
        const contracts = [];
        for (let i = 0; i < 40; i++) contracts.push({ from: 0, to: i + 1, resourceId: 1, value: 1000 - i * 10 });
        contracts.push({ from: 50, to: 51, resourceId: 1, value: 5000 }); // the largest, but hidden from the viewer
        contracts.push({ from: 60, to: 61, resourceId: 1, value: 50 }); // under 10 %
        const routes = mergeRouteDirections(flowsInWindow(createAndFill(contracts), 2, 12, { categoryOf: cats4 }, 'system'));
        const hidden = (r: FlowRoute) => r.aSystem === 50 || r.bSystem === 50;
        const top15 = selectTopRoutes(routes, FLOW_ROUTES_GALAXY, (r) => !hidden(r));
        expect(top15).toHaveLength(15);
        expect(top15[0].total).toBe(1000 * 12);
        expect(top15.every((r) => !hidden(r))).toBe(true);
        for (let i = 1; i < top15.length; i++) expect(top15[i].total).toBeLessThanOrEqual(top15[i - 1].total);
        const all = selectTopRoutes(routes, 1000, (r) => !hidden(r));
        expect(all).toHaveLength(40); // the 50 cr route is under FLOW_ROUTE_MIN_SHARE of 1000
        expect(all.at(-1)!.total).toBeGreaterThanOrEqual(all[0].total * FLOW_ROUTE_MIN_SHARE);
        // Accepting the hidden one makes it the largest: the cut follows it.
        expect(selectTopRoutes(routes, 5, () => true)[0].total).toBe(5000 * 12);
    });

    it('a cargo filter draws only that cargo; a resource filter only routes carrying that resource', () => {
        const contracts = [];
        for (let i = 0; i < 30; i++) contracts.push({ from: i, to: i + 1, resourceId: 1 + (i % 4), value: 100 + i });
        contracts.push({ from: 3, to: 4, resourceId: 2, value: 70 }); // mixed route: minerals 1 and 2 (and 4 one way)
        const l = createAndFill(contracts);
        for (const cat of ['mineral', 'gas', 'luxury']) {
            const routes = selectTopRoutes(mergeRouteDirections(flowsInWindow(l, 2, 12, { categoryOf: cats4, category: cat }, 'system')), 25, () => true, 0);
            expect(routes.length).toBeGreaterThan(0);
            expect(routes.every((r) => r.category.key === cat)).toBe(true);
            for (const r of routes) for (const id of r.resourceIds) expect(cats4(id).key).toBe(cat);
        }
        for (const id of [1, 2, 3, 4]) {
            const routes = selectTopRoutes(mergeRouteDirections(flowsInWindow(l, 2, 12, { categoryOf: cats4, category: cats4(id).key, resourceId: id }, 'system')), 25, () => true, 0);
            expect(routes.length).toBeGreaterThan(0);
            expect(routes.every((r) => r.resourceIds.length === 1 && r.resourceIds[0] === id)).toBe(true);
        }
    });

    it('resourceTotals sums each resource over the accepted rows, largest first', () => {
        const l = createAndFill([
            { from: 1, to: 2, resourceId: 1, value: 100 },
            { from: 1, to: 2, resourceId: 2, value: 300 },
            { from: 2, to: 3, resourceId: 1, value: 50 },
            { from: 7, to: 8, resourceId: 2, value: 1000 }, // not accepted
        ]);
        const rows = flowsInWindow(l, 2, 12, { categoryOf: cats4, category: 'mineral' }, 'system');
        const t = resourceTotals(rows, (r) => r.sellerSystem !== 7);
        expect(t).toEqual([
            { resourceId: 2, perYear: 300 * 12 },
            { resourceId: 1, perYear: 150 * 12 },
        ]);
    });

    it('pruning drops series that left every window and keeps the rest', () => {
        const l = createTradeFlowLedger(0);
        recordContract(null, l, ev({ starDate: 1 }));
        recordContract(null, l, ev({ starDate: 20 * MONTH_LENGTH, destination: P3 }));
        const entries = l.entries;
        expect(pruneTradeFlowLedger(l, 20 * MONTH_LENGTH + 5)).toBe(1);
        expect(l.entries).toBe(entries); // spliced in place (the worker's synced view shares it)
        expect(l.entries).toHaveLength(1);
        expect(l.index.get(P1)?.has(P2)).toBe(false);
        // A new contract on the dropped pair starts a fresh series.
        recordContract(null, l, ev({ starDate: 20 * MONTH_LENGTH + 6 }));
        expect(l.entries).toHaveLength(2);
        expect(flowsInWindow(l, 20 * MONTH_LENGTH + 7, 12, {}, 'post').map((r) => r.value)).toEqual([100, 100]);
    });
});

function createAndFill(contracts: Array<{ from: number; to: number; resourceId: number; value: number }>) {
    return systemLedger(contracts);
}

describe('FreightOverlay: fog, top N and the cargo filter on a hand-built galaxy', () => {
    it('draws only routes / hubs in explored systems, at most N, and the filtered cargo only', () => {
        const explored = new Set([0, 1, 2, 3, 4, 5]);
        const viewer = { empireId: 9, visibility: { checkSystemVisibilityStatus: (i: number) => (explored.has(i) ? 2 : 1) } };
        const port = (id: number, sys: number, income: number) => ({
            builtObjectID: id,
            currentYearsIncome: income,
            dateOfLastIncome: Number.MAX_SAFE_INTEGER,
            hasBeenDestroyed: false,
            actualEmpire: empA,
            empire: empA,
            xpos: sys * 1000,
            ypos: 0,
            nearestSystemStar: { systemIndex: sys },
        });
        const galaxy = {
            builtObjects: [port(1, 2, 5000), port(2, 8, 9000)],
            sectorSize: 100_000,
            independentEmpire: null,
            playerEmpire: viewer,
            scenario: null,
            nowMs: 20,
            age: 0,
            resourceSystem: { byId: new Map(), resources: [] },
        } as unknown as Galaxy;
        const state = { freightFlows: true, tradeHubs: true } as never;
        const ov = new FreightOverlay(galaxy, new Container(), state);
        cleanups.push(() => ov.destroy());
        const l = tradeFlowLedger(galaxy)!;
        expect(l).not.toBeNull(); // recording from construction, overlay on or off
        const src = systemLedger([
            { from: 1, to: 2, resourceId: 1, value: 500 },
            { from: 2, to: 9, resourceId: 3, value: 9000 }, // 9 unexplored: never drawn
            { from: 3, to: 4, resourceId: 3, value: 400 },
            { from: 4, to: 5, resourceId: 4, value: 300 },
        ], galaxyStarDate(galaxy));
        l.entries.push(...src.entries);
        l.startStarDate = src.startStarDate;
        l.version++;
        ov.filter = { categoryOf: cats4 };
        ov.invalidate();
        const cam = { x: 5000, y: 0, width: 1000, height: 1000, zoom: 0.05 } as never;
        ov.update(0.05, cam);
        expect(ov.shown.map((r) => [r.aSystem, r.bSystem])).toEqual([
            [1, 2],
            [3, 4],
            [4, 5],
        ]);
        expect(ov.discs.map((d) => d.hub.port.builtObjectID)).toEqual([1]);
        expect(ov.legendInfo()).toEqual({ shown: 3, known: 3, category: null, resourceId: null });
        ov.setCargoFilter('gas');
        ov.update(0.05, cam);
        expect(ov.shown.map((r) => r.category.key)).toEqual(['gas']);
        expect(ov.resourceBreakdown('gas')).toEqual([{ resourceId: 3, perYear: 400 * 12 }]);
        ov.setCargoFilter('mineral', 1);
        ov.update(0.05, cam);
        expect(ov.shown.map((r) => r.resourceIds)).toEqual([[1]]);
        // The hover finds the drawn line near its middle.
        const hit = ov.hitTest(1500, 0, 0.05);
        expect(hit?.kind).toBe('flow');
        // Off: nothing drawn, and nothing per frame but the early return.
        (state as { freightFlows: boolean; tradeHubs: boolean }).freightFlows = false;
        (state as { freightFlows: boolean; tradeHubs: boolean }).tradeHubs = false;
        ov.update(0.05, cam);
        expect(ov.shown).toEqual([]);
        expect(tradeFlowLedger(galaxy)).toBe(l); // still recording
    });
});

describe('freightLeader (in-flight leader between drawn positions)', () => {
    it('runs from the drawn freighter towards the drawn destination, at most 300 px, none under 8 px', () => {
        const z = 0.1; // 300 px = 3000 world units
        expect(freightLeader(100, 0, 1100, 0, z)).toEqual({ x1: 100, y1: 0, x2: 1100, y2: 0 });
        const long = freightLeader(0, 0, 0, 10_000, z)!;
        expect(long.y2).toBeCloseTo(3000, 9);
        expect(freightLeader(0, 0, 50, 0, z)).toBeNull();
    });
});
