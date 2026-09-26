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
    recordContract,
    registerFlowCategory,
    tradeFlowLedger,
    yearStart,
    type FlowCategory,
} from '../src/sim/logistics/tradeFlows';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import {
    FLOW_ARC_CAP,
    flowArcFor,
    flowArcsFor,
    flowColor,
    flowWidthPx,
    hitFlowArc,
    hubDiscsFor,
    hubRadiusPx,
} from '../src/render/freightOverlay';

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
        expect(ratio).toBeLessThan(1.5);
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
    it('arc control point sits to the left of travel, so A→B and B→A do not overlap', () => {
        const ab = flowArcFor(0, 0, 1000, 0);
        const ba = flowArcFor(1000, 0, 0, 0);
        expect(ab.cx).toBeCloseTo(500, 6);
        expect(ab.cy).toBeCloseTo(-150, 6); // left of +x in screen space (y down) is -y
        expect(ba.cy).toBeCloseTo(150, 6);
    });

    it('width clamps to 1..8 px', () => {
        expect(flowWidthPx(0)).toBe(1);
        expect(flowWidthPx(2000 * 16)).toBe(4);
        expect(flowWidthPx(1e12)).toBe(8);
    });

    it('culls arcs outside the camera and caps at 400, largest first', () => {
        const l = createTradeFlowLedger(0);
        for (let i = 0; i < 450; i++) {
            recordContract(null, l, ev({ starDate: 1, sellingPoint: post(-100, i, 1000 + i), destination: post(100, i, 2000 + i), value: i + 1 }));
        }
        recordContract(null, l, ev({ starDate: 1, sellingPoint: post(90_000, 90_000, 1), destination: post(91_000, 90_000, 2), value: 1e9 }));
        const rows = flowsInWindow(l, 2, 12, {}, 'post');
        const arcs = flowArcsFor(rows, 1, cam);
        expect(arcs).toHaveLength(FLOW_ARC_CAP);
        expect(arcs[0].row.value).toBe(450);
        expect(arcs.some((a) => a.row.value === 1e9)).toBe(false);
    });

    it('hit test finds the arc near its curve and misses far away', () => {
        const a = flowArcFor(0, 0, 1000, 0);
        expect(hitFlowArc(a, 500, -75, 1, 6)).toBe(true);
        expect(hitFlowArc(a, 500, 200, 1, 6)).toBe(false);
    });

    it('hub discs clamp 6..60 px and use the owner colour', () => {
        expect(hubRadiusPx(0)).toBe(6);
        expect(hubRadiusPx(10_000)).toBe(25);
        expect(hubRadiusPx(1e12)).toBe(60);
        const discs = hubDiscsFor([{ port: {} as never, owner: empB, income: 1600, x: 5, y: 6 }], 1, cam);
        expect(discs[0].color).toBe(0x00ff00);
        expect(discs[0].r).toBe(10);
    });
});
