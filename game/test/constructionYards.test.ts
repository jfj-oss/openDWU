// Task 16c: Construction Yards site rows, yard progress, wait rows and wait-queue moves (no jsdom).
import { describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { ConstructionYard } from '../src/sim/construction/constructionYard';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { AutomationLevel } from '../src/sim/empire';
import type { Design } from '../src/sim/design';
import type { Habitat } from '../src/sim/types';
import {
    constructionSiteRows,
    constructionSites,
    formatProgressP,
    fleetOrderByShip,
    maximumSizeText,
    moveWaitQueueItem,
    purchaseAutomationTask,
    purchaserDesigns,
    purchaserLabel,
    siteBuildProgress,
    waitRows,
    YARDS_LAYOUT,
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
        expect(rows[0]).toMatchObject({ name: 'Sol Port', type: 'Small Space Port', system: '(Deep Space)', yards: 2, building: 1, waiting: 3, speed: 80, progress: 0.75 });
        expect(rows[1]).toMatchObject({ name: 'Terra', type: 'Colony', yards: 0, building: 0, waiting: 0, speed: 0, progress: 0 });
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
        const rows = yardRows(portSite, (id) => (id === 5 ? { name: 'Construction Yard', pictureRef: 7 } : null));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ name: 'Construction Yard', componentPicture: 7, ship: 'Escort A', progressText: '75.00%', speed: 40 });
        expect(rows[0].yard).toBe(yard);
        expect(rows[1].ship).toBe('');
    });
    it('skips yards with a negative component id', () => {
        const site: ConstructionSite = { kind: 'builtObject', builtObject: asBO({ ...port, constructionQueue: { ...queue, constructionYards: [yard, { ...idle, componentId: -1 }] } }) };
        expect(yardRows(site, () => ({ name: 'Y', pictureRef: 0 }))).toHaveLength(1);
    });
    it('lists the wait queue in order', () => {
        const rows = waitRows(portSite);
        expect(rows.map((r) => r.name)).toEqual(['W1', 'W2', 'W3']);
        expect(rows[0].price).toBe(2500);
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

describe('siteBuildProgress', () => {
    it('averages the busy yards only', () => {
        const half = { ...yard, shipUnderConstruction: { ...escort, unbuiltOrDamagedComponentCount: 6 } };
        expect(siteBuildProgress([asYard(yard), asYard(idle), asYard(half), null])).toBeCloseTo(0.625);
        expect(siteBuildProgress([asYard(idle)])).toBe(0);
    });
});

describe('purchaserDesigns (ConstructionYardPurchaser.cs PopulateDesigns)', () => {
    const d = (name: string, subRole: BuiltObjectSubRole, role: BuiltObjectRole, extra: Record<string, unknown> = {}) =>
        ({ name, subRole, role, isObsolete: false, isPlanetDestroyer: false, ...extra }) as unknown as Design;
    const esc = d('Esc', BuiltObjectSubRole.Escort, BuiltObjectRole.Military);
    const old = d('Old', BuiltObjectSubRole.Escort, BuiltObjectRole.Military, { isObsolete: true });
    const pd = d('PD', BuiltObjectSubRole.CapitalShip, BuiltObjectRole.Military, { isPlanetDestroyer: true });
    const frt = d('Frt', BuiltObjectSubRole.SmallFreighter, BuiltObjectRole.Freight);
    const sp = d('SP', BuiltObjectSubRole.SmallSpacePort, BuiltObjectRole.Base);
    const def = d('Def', BuiltObjectSubRole.DefensiveBase, BuiltObjectRole.Base);
    const secret = d('Secret', BuiltObjectSubRole.Cruiser, BuiltObjectRole.Military);
    const all = [esc, old, pd, frt, sp, def, secret];
    const checks = { canBuild: () => true, researched: (x: Design) => x !== secret, colonyHasSpacePort: () => true };
    it('at a ship yard: no obsolete / planet destroyers / private / unresearched / bases', () => {
        expect(purchaserDesigns(all, portSite, checks).map((x) => x.name)).toEqual(['Esc']);
        expect(purchaserDesigns(all, portSite, checks, false).map((x) => x.name)).toEqual(['Esc', 'Frt']);
    });
    it('at a colony: bases allowed, no second space port', () => {
        const site: ConstructionSite = { kind: 'colony', habitat: { name: 'Terra', constructionQueue: queue } as unknown as Habitat };
        expect(purchaserDesigns(all, site, checks).map((x) => x.name)).toEqual(['Esc', 'Def']);
        expect(purchaserDesigns(all, site, { ...checks, colonyHasSpacePort: () => false }).map((x) => x.name)).toEqual(['Esc', 'SP', 'Def']);
    });
    it('passes the colony to CanBuildBuiltObject; nothing without a queue', () => {
        const seen: (Habitat | null)[] = [];
        purchaserDesigns([esc], portSite, { ...checks, canBuild: (_x, c) => (seen.push(c), true) });
        expect(seen).toEqual([null]);
        expect(purchaserDesigns(all, { kind: 'colony', habitat: colony as unknown as Habitat }, checks)).toEqual([]);
    });
    it('labels with the sub-role and price', () => {
        expect(purchaserLabel(esc, 1234.9)).toMatch(/^Escort: Esc \(1234 credits\)$/);
    });
});

describe('misc helpers', () => {
    it('maximumSizeText (Main.Part8.cs method_305)', () => {
        expect(maximumSizeText({ any: 300, civilian: 300, military: 300, base: 900 })).toBe('Maximum Ship size: 300\nMaximum Base size: 900 (when not at colony)');
        expect(maximumSizeText({ any: 300, civilian: 400, military: 350, base: 900 })).toBe('Maximum Ship size: 300, C:400, M:350\nMaximum Base size: 900 (when not at colony)');
    });
    it('fleetOrderByShip: first order wins', () => {
        const [a, b] = [w1, w2].map(asBO);
        const m = fleetOrderByShip([{ name: 'Alpha', pending: [a] }, { name: 'Beta', pending: [a, b] }]);
        expect(m.get(a)).toBe('Alpha');
        expect(m.get(b)).toBe('Beta');
    });
    it('purchaseAutomationTask', () => {
        const auto = { controlColonization: AutomationLevel.FullyAutomated, controlStateConstruction: AutomationLevel.FullyAutomated };
        const manual = { controlColonization: AutomationLevel.Undefined, controlStateConstruction: AutomationLevel.PartiallyAutomated };
        expect(purchaseAutomationTask(auto, { subRole: BuiltObjectSubRole.ColonyShip })).toBe('Colonization');
        expect(purchaseAutomationTask(auto, { subRole: BuiltObjectSubRole.Escort })).toBe('Ship Building');
        expect(purchaseAutomationTask(manual, { subRole: BuiltObjectSubRole.Escort })).toBeNull();
        expect(purchaseAutomationTask(manual, { subRole: BuiltObjectSubRole.ColonyShip })).toBeNull();
    });
    it('layout fits the body of the 1024 × 756 ScreenPanel', () => {
        const L = YARDS_LAYOUT;
        const bodyW = L.window.w - 16;
        const bodyH = L.window.h - 63;
        expect(L.detail.x + L.detail.w).toBeLessThanOrEqual(bodyW);
        expect(L.tabs.y + L.tabs.h).toBeLessThanOrEqual(bodyH);
        expect(L.page.y + L.page.h).toBeLessThanOrEqual(bodyH);
    });
});
