// Build Queue (ui/screens/buildQueueModel.ts): empire-wide construction rows, yard progress, wait-queue move state,
// fleet build order rows (no jsdom; mock sim objects).
import { describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import type { ConstructionYard } from '../src/sim/construction/constructionYard';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import {
    buildQueueRows,
    buildQueueSites,
    buildQueueStatusText,
    buildQueueSummary,
    fleetOrderRows,
    formatEtaMs,
    formatPercentP,
    waitMoveState,
    yardBuildProgress,
} from '../src/ui/screens/buildQueueModel';

const comps = (ids: number[]) => ids.map((componentId) => ({ componentId, name: `C${componentId}` }));
const ship = (name: string, subRole: BuiltObjectSubRole, price: number, extra: Record<string, unknown> = {}) => ({
    name,
    subRole,
    isShipYard: false,
    hasBeenDestroyed: false,
    purchasePrice: price,
    design: { name: `${name} design` },
    retrofitDesign: null,
    components: { count: 10 },
    unbuiltOrDamagedComponentCount: 4,
    ...extra,
});

const escort = ship('Escort A', BuiltObjectSubRole.Escort, 1200);
const w1 = ship('W1', BuiltObjectSubRole.Frigate, 2500);
const w2 = ship('W2', BuiltObjectSubRole.Destroyer, 4000);
const yard = { componentId: 5, shipUnderConstruction: escort, retrofitComponentsToBeBuilt: null, retrofitComponentsToBeScrapped: null };
const idle = { componentId: 5, shipUnderConstruction: null, retrofitComponentsToBeBuilt: null, retrofitComponentsToBeScrapped: null };
const port = { ...ship('Sol Port', BuiltObjectSubRole.SmallSpacePort, 0), isShipYard: true, constructionQueue: { constructionYards: [yard, idle], constructionWaitQueue: [w1, w2] } };
const empty = { ...ship('Empty Port', BuiltObjectSubRole.SmallSpacePort, 0), isShipYard: true, constructionQueue: { constructionYards: [], constructionWaitQueue: [] } };
const freighter = { ...ship('F', BuiltObjectSubRole.SmallFreighter, 0), constructionQueue: null };
const colonyShip = ship('Seed', BuiltObjectSubRole.ColonyShip, 3000);
const terra = { name: 'Terra', constructionQueue: { constructionYards: [{ ...idle, shipUnderConstruction: colonyShip }], constructionWaitQueue: [] } };
const mine = { name: 'Mining Station', subRole: BuiltObjectSubRole.MiningStation, calculateCurrentPurchasePrice: () => 5000 };
const target = { name: 'Io' };
const builder = {
    ...ship('Builder', BuiltObjectSubRole.ConstructionShip, 0),
    constructionQueue: { constructionYards: [idle], constructionWaitQueue: [] },
    mission: { type: BuiltObjectMissionType.Build, design: mine, targetHabitat: target },
    nearestSystemStar: { name: 'Sol' },
};
const galaxy = {} as Galaxy;
const makeEmpire = (extra: Record<string, unknown> = {}) =>
    ({ builtObjects: [freighter, port, builder], privateBuiltObjects: [empty], colonies: [terra], constructionShips: [builder], ...extra }) as unknown as Empire;

describe('buildQueueSites', () => {
    it('lists built objects with yards (state, then private), then every colony', () => {
        expect(buildQueueSites(makeEmpire())).toEqual([port, builder, terra]);
    });
});

describe('buildQueueRows', () => {
    const rows = buildQueueRows(galaxy, makeEmpire());
    it('per site: slipways first, then the wait queue in order; then builders en route', () => {
        expect(rows.map((r) => [r.name, r.status, r.location])).toEqual([
            ['Escort A', 'building', 'Sol Port'],
            ['W1', 'waiting', 'Sol Port'],
            ['W2', 'waiting', 'Sol Port'],
            ['Seed', 'building', 'Terra'],
            ['Mining Station', 'enroute', 'Io'],
        ]);
    });
    it('fills progress, cost, type and positions', () => {
        expect(rows[0]).toMatchObject({ progress: 0.6, cost: 1200, type: 'Escort', design: 'Escort A design' });
        expect(rows[2]).toMatchObject({ position: 1, queueLength: 2, progress: 0, cost: 4000 });
        expect(rows[4]).toMatchObject({ ship: null, site: builder, cost: 5000, type: 'Mining Station' });
        expect(buildQueueStatusText(rows[1])).toBe('Waiting (1 of 2)');
        expect(buildQueueStatusText(rows[4])).toBe('Builder en route');
    });
    it('summarises', () => {
        expect(buildQueueSummary(rows)).toEqual({ building: 2, waiting: 2, enroute: 1, value: 1200 + 2500 + 4000 + 3000 + 5000 });
    });
    it('a construction ship already building its base is not also listed en route', () => {
        const base = ship('New Mine', BuiltObjectSubRole.MiningStation, 5000);
        const busy = { ...builder, constructionQueue: { constructionYards: [{ ...idle, shipUnderConstruction: base }], constructionWaitQueue: [] } };
        const r = buildQueueRows(galaxy, makeEmpire({ builtObjects: [busy], colonies: [], constructionShips: [busy], privateBuiltObjects: [] }));
        expect(r.map((x) => [x.name, x.status, x.location])).toEqual([['New Mine', 'building', 'Io']]);
    });
    it('tags ships pending in a fleet build order', () => {
        const order = { id: 1, templateId: 1, name: 'Strike Group', fleet: null, pending: [w2], queued: 2, built: 1, existing: 0, sector: null };
        const r = buildQueueRows(galaxy, makeEmpire({ fleetDesigns: { nextId: 2, templates: [], orders: [order] } }));
        expect(r.find((x) => x.name === 'W2')?.order).toBe('Fleet: Strike Group');
        expect(r.find((x) => x.name === 'W1')?.order).toBe('');
    });
});

describe('yardBuildProgress (ConstructionYardListView.cs BindData)', () => {
    it('new build and idle yard', () => {
        expect(yardBuildProgress(yard as unknown as ConstructionYard)).toBeCloseTo(0.6);
        expect(yardBuildProgress(idle as unknown as ConstructionYard)).toBe(0);
        expect(formatPercentP(0.6)).toBe('60.00%');
    });
    it('retrofit share with the truncating /4', () => {
        const s = { design: { components: comps([1, 2, 3, 4]) }, retrofitDesign: { components: comps([1, 2, 5, 6, 7]) }, components: { count: 5 }, unbuiltOrDamagedComponentCount: 0 };
        const y = { shipUnderConstruction: s, retrofitComponentsToBeBuilt: comps([5]), retrofitComponentsToBeScrapped: comps([3, 4]) };
        expect(formatPercentP(yardBuildProgress(y as unknown as ConstructionYard))).toBe('66.67%');
    });
});

describe('waitMoveState (Main.Part5.cs Move to Top / Up / Down / Bottom)', () => {
    const rows = buildQueueRows(galaxy, makeEmpire());
    it('first waiting row moves only down, last only up, others none', () => {
        expect(waitMoveState(rows[1])).toEqual({ top: false, up: false, down: true, bottom: true });
        expect(waitMoveState(rows[2])).toEqual({ top: true, up: true, down: false, bottom: false });
        expect(waitMoveState(rows[0])).toEqual({ top: false, up: false, down: false, bottom: false });
        expect(waitMoveState(null)).toEqual({ top: false, up: false, down: false, bottom: false });
    });
});

describe('fleetOrderRows / formatEtaMs', () => {
    it('reports progress per order', () => {
        const e = { fleetDesigns: { nextId: 2, templates: [], orders: [{ id: 1, templateId: 1, name: 'Strike', fleet: { name: '1st Fleet' }, pending: [{ hasBeenDestroyed: false, builtAt: {}, empire: null }], queued: 3, built: 2, existing: 1, sector: null }] } } as unknown as Empire;
        (e as unknown as { fleetDesigns: { orders: { pending: { empire: unknown }[] }[] } }).fleetDesigns.orders[0].pending[0].empire = e;
        expect(fleetOrderRows(e)[0]).toMatchObject({ name: 'Strike', built: 3, total: 4, building: 1, lost: 0, where: 'Any sector', fleet: '1st Fleet' });
    });
    it('formats estimates', () => {
        expect(formatEtaMs(12_400)).toBe('12s');
        expect(formatEtaMs(187_000)).toBe('3m 07s');
        expect(formatEtaMs(3_900_000)).toBe('1h 05m');
    });
});
