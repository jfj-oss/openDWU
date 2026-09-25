// Task 16c: Construction Yards site rows, yard progress, wait rows and wait-queue moves (no jsdom).
import { describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { ConstructionYard } from '../src/sim/construction/constructionYard';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import {
    constructionSiteRows,
    constructionSites,
    formatProgressP,
    moveWaitQueueItem,
    waitRows,
    yardProgress,
    yardRows,
    type ConstructionSite,
} from '../src/ui/screens/constructionYards';
import { isKeyActionAvailable } from '../src/ui/keyboard';

const comps = (ids: number[]) => ids.map((componentId) => ({ componentId, name: `C${componentId}` }));

const escort = { name: 'Escort A', subRole: BuiltObjectSubRole.Escort, unbuiltOrDamagedComponentCount: 3, components: { count: 12 }, retrofitDesign: null, purchasePrice: 1200 };
const yard = { componentId: 5, shipUnderConstruction: escort, constructionSpeed: 40, retrofitComponentsToBeBuilt: null, retrofitComponentsToBeScrapped: null };
const idle = { componentId: 5, shipUnderConstruction: null, constructionSpeed: 40, retrofitComponentsToBeBuilt: null, retrofitComponentsToBeScrapped: null };
const w1 = { name: 'W1', subRole: BuiltObjectSubRole.Frigate, purchasePrice: 2500 };
const w2 = { name: 'W2', subRole: BuiltObjectSubRole.Destroyer, purchasePrice: 4000 };
const w3 = { name: 'W3', subRole: BuiltObjectSubRole.Escort, purchasePrice: 900 };
const queue = { constructionYards: [yard, idle], constructionWaitQueue: [w1, w2, w3], constructionSpeed: 80 };
const port = { name: 'Sol Port', subRole: BuiltObjectSubRole.SmallSpacePort, isShipYard: true, constructionQueue: queue };
const noYards = { name: 'Empty Port', subRole: BuiltObjectSubRole.SmallSpacePort, isShipYard: true, constructionQueue: { constructionYards: [], constructionWaitQueue: [], constructionSpeed: 0 } };
const freighter = { name: 'F', subRole: BuiltObjectSubRole.SmallFreighter, isShipYard: false, constructionQueue: null };
const colony = { name: 'Terra', constructionQueue: null };
const empire = { builtObjects: [freighter, port], privateBuiltObjects: [noYards], colonies: [colony] } as unknown as Empire;

const portSite: ConstructionSite = { kind: 'builtObject', builtObject: port as unknown as BuiltObject };
const asYard = (y: unknown) => y as ConstructionYard;
const asBO = (b: unknown) => b as BuiltObject;

describe('constructionSites / constructionSiteRows (BaconMain.cs method_423)', () => {
    it('lists yard bases with yards, then every colony', () => {
        const sites = constructionSites(empire);
        expect(sites.map((s) => s.kind)).toEqual(['builtObject', 'colony']);
        expect(sites[0].kind === 'builtObject' && sites[0].builtObject).toBe(port);
    });
    it('builds the site rows', () => {
        const rows = constructionSiteRows(empire);
        expect(rows[0]).toMatchObject({ name: 'Sol Port', type: 'Small Space Port', yards: 2, building: 1, waiting: 3, speed: 80 });
        expect(rows[1]).toMatchObject({ name: 'Terra', type: 'Colony', yards: 0, building: 0, waiting: 0, speed: 0 });
    });
});

describe('yardProgress (ConstructionYardListView.cs BindData)', () => {
    it('new build: 1 - unbuilt / components', () => {
        expect(yardProgress(asYard(yard))).toBe(0.75);
        expect(formatProgressP(yardProgress(asYard(yard)))).toBe('75.00%');
        expect(yardProgress(asYard(idle))).toBe(0);
    });
    it('retrofit: truncating /4 divisions', () => {
        const ship = { name: 'R', design: { components: comps([1, 2, 3, 4]) }, retrofitDesign: { components: comps([1, 2, 5, 6, 7]) }, components: { count: 5 }, unbuiltOrDamagedComponentCount: 0 };
        const y = { componentId: 5, shipUnderConstruction: ship, constructionSpeed: 40, retrofitComponentsToBeBuilt: comps([5]), retrofitComponentsToBeScrapped: comps([3, 4]) };
        expect(formatProgressP(yardProgress(asYard(y)))).toBe('66.67%');
    });
    it('guards a ship with no components', () => {
        const y = { ...yard, shipUnderConstruction: { ...escort, unbuiltOrDamagedComponentCount: 0, components: { count: 0 } } };
        expect(yardProgress(asYard(y))).toBe(0);
    });
});

describe('yardRows / waitRows', () => {
    it('one row per yard with a component id', () => {
        const rows = yardRows(portSite, (id) => (id === 5 ? 'Construction Yard' : ''));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ yard: 'Construction Yard', ship: 'Escort A', progressText: '75.00%', speed: 40 });
        expect(rows[1].ship).toBe('');
    });
    it('skips yards with a negative component id', () => {
        const site: ConstructionSite = { kind: 'builtObject', builtObject: asBO({ ...port, constructionQueue: { ...queue, constructionYards: [yard, { ...idle, componentId: -1 }] } }) };
        expect(yardRows(site, () => 'Y')).toHaveLength(1);
    });
    it('lists the wait queue in order', () => {
        const rows = waitRows(portSite);
        expect(rows.map((r) => r.name)).toEqual(['W1', 'W2', 'W3']);
        expect(rows[0].price).toBe('2,500');
        expect(rows[0].type).toBe('Frigate');
    });
});

describe('moveWaitQueueItem (Main.Part5.cs:2147-2213)', () => {
    const [a, b, c] = [w1, w2, w3].map(asBO);
    it('top', () => {
        const q = [a, b, c];
        expect(moveWaitQueueItem(q, c, 'top')).toBe(true);
        expect(q).toEqual([c, a, b]);
        expect(moveWaitQueueItem(q, c, 'top')).toBe(false);
        expect(q).toEqual([c, a, b]);
    });
    it('down', () => {
        const q = [a, b, c];
        expect(moveWaitQueueItem(q, a, 'down')).toBe(true);
        expect(q).toEqual([b, a, c]);
        expect(moveWaitQueueItem(q, c, 'down')).toBe(false);
    });
    it('bottom', () => {
        const q = [a, b, c];
        expect(moveWaitQueueItem(q, a, 'bottom')).toBe(true);
        expect(q).toEqual([b, c, a]);
        expect(moveWaitQueueItem(q, a, 'bottom')).toBe(false);
    });
    it('up', () => {
        const q = [a, b, c];
        expect(moveWaitQueueItem(q, b, 'up')).toBe(true);
        expect(q).toEqual([b, a, c]);
        expect(moveWaitQueueItem(q, b, 'up')).toBe(false);
    });
    it('an item not in the queue', () => {
        const q = [a, b];
        for (const m of ['top', 'up', 'down', 'bottom'] as const) expect(moveWaitQueueItem(q, c, m)).toBe(false);
        expect(q).toEqual([a, b]);
    });
});

describe('key bindings', () => {
    it('F9 / F10 are implemented', () => {
        expect(isKeyActionAvailable('constructionYardsScreen')).toBe(true);
        expect(isKeyActionAvailable('buildOrderScreen')).toBe(true);
    });
});
