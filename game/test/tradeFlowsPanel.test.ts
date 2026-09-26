// Task 19e-9: Trade Flows panel / tooltip row builders (pure, no DOM).
import { describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import {
    FLOW_CATEGORY_GAS,
    FLOW_CATEGORY_MINERAL,
    MONTH_LENGTH,
    createTradeFlowLedger,
    empirePairTotals,
    flowsInWindow,
    recordContract,
} from '../src/sim/logistics/tradeFlows';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { flowTableRows, formatCredits, freightTooltipText, hubTableRows, pairTableRows } from '../src/ui/freightText';
import { collectingNote } from '../src/ui/screens/tradeFlows';

const indep = { empireId: 0, name: 'Independents' } as unknown as Empire;
const a = { empireId: 1, name: 'Oranthi' } as unknown as Empire;
const b = { empireId: 2, name: 'Zanid' } as unknown as Empire;
const c = { empireId: 3, name: 'Human' } as unknown as Empire;
const names = {
    systems: [{ systemStar: { name: 'Alpha' } }, { systemStar: { name: 'Beta' } }],
    resourceSystem: { byId: new Map([[1, { name: 'Voidstone' }], [2, { name: 'Hydrogen' }]]) },
    independentEmpire: indep,
} as unknown as Galaxy;
const post = (name: string, x: number) => ({ name, xpos: x, ypos: 0, habitatIndex: x }) as never;

describe('19e-9 panel rows', () => {
    const l = createTradeFlowLedger(0);
    const P1 = post('Port A', 0);
    const P2 = post('Colony B', 1000);
    const base = { starDate: 5, buyer: b, isState: false, freighter: null, componentId: -1, amount: 10 } as const;
    recordContract(null, l, { ...base, seller: a, sellingPoint: P1, destination: P2, resourceId: 1, value: 12_000 });
    recordContract(null, l, { ...base, seller: indep, sellingPoint: P1, destination: P2, resourceId: 2, value: 400 });
    recordContract(null, l, { ...base, seller: a, sellingPoint: P2, destination: P1, resourceId: 2, value: 900 });
    for (const e of l.entries) {
        e.sellerSystem = e.sellingPoint === P1 ? 0 : 1;
        e.destSystem = e.destination === P1 ? 0 : 1;
    }
    const cats = (r: number) => (r === 2 ? FLOW_CATEGORY_GAS : FLOW_CATEGORY_MINERAL);

    it('flow rows: sorted by value, system names, goods, sellers, go-to centre', () => {
        const rows = flowsInWindow(l, 10, 12, { categoryOf: cats }, 'system');
        const t = flowTableRows(names, rows);
        expect(t.map((r) => r.route)).toEqual(['Alpha → Beta', 'Beta → Alpha']);
        expect(t[0].goods).toBe('Voidstone, Hydrogen');
        expect(t[0].sellers).toBe('Independent, Oranthi');
        expect(t[0].value).toBe('12,400');
        expect(t[0].contracts).toBe(2);
        expect(t[0].x).toBe(500);
        // Year window on a ledger 10 ms old: one effective month → ×12.
        expect(t[0].perYear).toBe(formatCredits(12_400 * 12));
        expect(freightTooltipText(names, { kind: 'flow', row: rows[0] })).toBe(
            `Alpha → Beta: Voidstone, Hydrogen — ${formatCredits(12_400 * 12)} cr/yr contracted, 2 contracts, sellers: Independent, Oranthi`,
        );
        // Filter: gas only.
        const gas = flowTableRows(names, flowsInWindow(l, 10, 12, { categoryOf: cats, category: 'gas' }, 'system'));
        expect(gas.map((r) => r.value)).toEqual(['900', '400']);
        // Post level names the trading posts.
        expect(flowTableRows(names, flowsInWindow(l, 10, 12, { categoryOf: cats }, 'post'))[0].route).toBe('Port A → Colony B');
    });

    it('hub rows and tooltip', () => {
        const hub = { port: { name: 'Port A' } as never, owner: a, income: 8200.4, x: 1, y: 2 };
        expect(hubTableRows(names, [hub])).toEqual([{ name: 'Port A', owner: 'Oranthi', income: '8,200', x: 1, y: 2 }]);
        expect(freightTooltipText(names, { kind: 'hub', hub })).toBe('Port A (Oranthi) — 8,200 cr trade income this year');
    });

    it("empire-pair totals from relation trade values; the player's pairs first", () => {
        const now = 2 * YEAR_LENGTH + 100;
        const y0 = 2 * YEAR_LENGTH;
        const rel = (other: Empire, value: number, year = y0) => ({
            otherEmpire: other,
            _tradeValues: { getByYear: (y: number) => (y === year ? { year, value } : null) },
        });
        const empires = [
            { ...a, diplomaticRelations: [rel(b, 5000), rel(c, 300)] },
            { ...b, diplomaticRelations: [rel(a, 5000), rel(c, 50, y0 - YEAR_LENGTH)] },
            { ...c, diplomaticRelations: [rel(a, 300)] },
        ] as unknown as Empire[];
        // Re-point the relation targets at the empire objects in the list.
        const [ea, eb, ec] = empires;
        (ea.diplomaticRelations as unknown as Array<{ otherEmpire: Empire }>)[0].otherEmpire = eb;
        (ea.diplomaticRelations as unknown as Array<{ otherEmpire: Empire }>)[1].otherEmpire = ec;
        (eb.diplomaticRelations as unknown as Array<{ otherEmpire: Empire }>)[0].otherEmpire = ea;
        (eb.diplomaticRelations as unknown as Array<{ otherEmpire: Empire }>)[1].otherEmpire = ec;
        (ec.diplomaticRelations as unknown as Array<{ otherEmpire: Empire }>)[0].otherEmpire = ea;
        const pairs = empirePairTotals({ empires }, now);
        expect(pairs.map((p) => [p.a.name, p.b.name, p.value])).toEqual([
            ['Oranthi', 'Zanid', 5000],
            ['Oranthi', 'Human', 300],
        ]);
        const rows = pairTableRows(pairs, ec);
        expect(rows[0]).toEqual({ a: 'Oranthi', b: 'Human', value: '300', mine: true });
        expect(rows[1].mine).toBe(false);
    });

    it('collecting note while the ledger is younger than the window', () => {
        expect(collectingNote(null, 0, 1)).toMatch(/Not recording/);
        expect(collectingNote(0, 3 * MONTH_LENGTH, 1)).toBe('');
        expect(collectingNote(0, MONTH_LENGTH / 2, 12)).toMatch(/Collecting for 15 days/);
    });
});
