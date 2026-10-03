// Build Order screen (Main.Part2.cs 404 method_628 / 629 / 1135): the layout, the advisor column and the purchase
// checks of the original-style port (src/ui/screens/buildOrderModel.ts), plus the shared NumericUpDown clamp.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { AutomationLevel } from '../src/sim/empire';
import { ForceStructureProjection, ForceStructureProjectionList } from '../src/sim/forceStructureProjection';
import {
    BUILD_ORDER_CONTAINER,
    BUILD_ORDER_SIZE,
    BUILD_ORDER_SUBROLES,
    BUILD_ORDER_TOTALS_Y,
    advisorSuggestion,
    buildOrderAdvisorTargets,
    buildOrderRowYs,
    buildOrderRows,
    cannotAffordMessage,
    initialOrderAmount,
    orderAmountHighlighted,
    purchaseButtonState,
} from '../src/ui/screens/buildOrderModel';
import { clampSpinValue } from '../src/ui/originalWindow';

const S = BuiltObjectSubRole;

describe('Build Order layout (method_628)', () => {
    it('is the 810 × 778 ScreenPanel with the totals at num29 = 593', () => {
        expect(BUILD_ORDER_SIZE).toEqual({ w: 810, h: 778 });
        expect(BUILD_ORDER_TOTALS_Y).toBe(593);
        expect(BUILD_ORDER_CONTAINER).toEqual({ x: 0, y: 105, w: 760, h: 473 });
    });
    it('rows every 27 px with an 11 px gap after Carrier, Resupply Ship and Construction Ship', () => {
        const ys = buildOrderRowYs();
        expect(ys.length).toBe(16);
        expect(ys.slice(0, 7)).toEqual([0, 27, 54, 81, 108, 135, 162]);
        expect(ys[BUILD_ORDER_SUBROLES.indexOf(S.ResupplyShip)]).toBe(162 + 27 + 11);
        expect(ys[BUILD_ORDER_SUBROLES.indexOf(S.ExplorationShip)]).toBe(200 + 27 + 11);
        expect(ys[BUILD_ORDER_SUBROLES.indexOf(S.SmallFreighter)]).toBe(238 + 27 + 27 + 11);
        // The last row ends inside the container.
        expect(ys[15] + 27).toBeLessThanOrEqual(BUILD_ORDER_CONTAINER.h);
    });
});

describe('Build Order advisor column and purchase checks', () => {
    it('Advisor Suggest = max(0, min(target, 1000) - current)', () => {
        expect(advisorSuggestion(5, 2)).toBe(3);
        expect(advisorSuggestion(1, 4)).toBe(0);
        expect(advisorSuggestion(5000, 10)).toBe(990);
    });
    it('spinner highlight above 0; purchase button text', () => {
        expect(orderAmountHighlighted(0)).toBe(false);
        expect(orderAmountHighlighted(3)).toBe(true);
        expect(purchaseButtonState(0)).toEqual({ enabled: false, label: 'Purchase' });
        expect(purchaseButtonState(1234.4).label).toBe('Purchase for 1,234 credits');
    });
    it('the cannot-afford message box only when the total exceeds the state money', () => {
        expect(cannotAffordMessage(100, 100)).toBeNull();
        const m = cannotAffordMessage(3000, 1500)!;
        expect(m.caption).toBe('Cannot afford build order');
        expect(m.text).toContain('3,000 credits, but we only have 1,500 credits');
        expect(m.text).toContain('\n\nReduce your build order');
    });
    it('NumericUpDown clamp', () => {
        expect(clampSpinValue('12', 0, 10)).toBe(10);
        expect(clampSpinValue('-3', 0, 10)).toBe(0);
        expect(clampSpinValue('abc', 0, 10)).toBe(0);
        expect(clampSpinValue(4.7, 0, 10)).toBe(4);
    });
});

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('Build Order advisor targets on the harness game', () => {
    it('no state projections: every target 0, the spinners start at 0', () => {
        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        e.stateForceStructureProjections = null;
        const t = buildOrderAdvisorTargets(g, e);
        expect([...t.values()].every((v) => v === 0)).toBe(true);
        for (const r of buildOrderRows(e, g, new Map(), t)) expect(initialOrderAmount(e, r)).toBe(0);
    });
    it('projections refactored to the state money (no Rnd) plus the current force; prefilled unless Manual', () => {
        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        const state = new ForceStructureProjectionList();
        state.add(new ForceStructureProjection(S.Escort, 3, 0));
        state.add(new ForceStructureProjection(S.ExplorationShip, 1, 0));
        e.stateForceStructureProjections = state;
        e.privateForceStructureProjections = new ForceStructureProjectionList();
        e.stateMoney = 1e9;
        const rnd0 = JSON.stringify(g.rnd);
        const t = buildOrderAdvisorTargets(g, e);
        expect(JSON.stringify(g.rnd)).toBe(rnd0);
        const rows = buildOrderRows(e, g, new Map(), t);
        const esc = rows[BUILD_ORDER_SUBROLES.indexOf(S.Escort)];
        const stateEscorts = e.builtObjects.filter((b) => b && b.subRole === S.Escort).length;
        expect(t.get(S.Escort)).toBe(3 + stateEscorts);
        expect(esc.advisor).toBe(advisorSuggestion(3 + stateEscorts, esc.current));
        expect(t.get(S.Frigate)).toBe(0);
        e.controlStateConstruction = AutomationLevel.FullyAutomated;
        expect(initialOrderAmount(e, esc)).toBe(esc.advisor);
        e.controlStateConstruction = AutomationLevel.Undefined; // Manual
        expect(initialOrderAmount(e, esc)).toBe(0);
    });
    it('the refactor stops at the state money', () => {
        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        const state = new ForceStructureProjectionList();
        state.add(new ForceStructureProjection(S.Escort, 50, 0));
        e.stateForceStructureProjections = state;
        e.stateMoney = 0;
        expect(buildOrderAdvisorTargets(g, e).get(S.Escort)).toBe(0);
    });
});
