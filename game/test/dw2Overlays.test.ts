// [dw2overlays] The Improvements map overlays' data helpers: Resources (render/resourceOverlayData.ts), Colony Target
// Scores (render/colonyTargets.ts), Fuel Range (render/rangeRings.ts fuelOverlayData, render/fuelOverlay.ts texts), the
// Improvements registry (ui/improvements.ts) and the overlay state additions (ui/mapOverlays.ts). All read-only.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Resource } from '../src/sim/data/resources';
import { HabitatCategoryType, type Habitat } from '../src/sim/types';
import type { GameData } from '../src/sim/data/gameData';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { stateDigest } from '../src/sim/tick/digest';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import {
    ResourceRarity,
    buildKnownResourceIndex,
    habitatIcons,
    knownResourceIndexFor,
    knownResourceSignature,
    maxSystemIcons,
    resourcePickerOptions,
    resourceRarity,
    resourceTooltipText,
    systemIcons,
    systemsForFilter,
} from '../src/render/resourceOverlayData';
import { colonyTargetScoresFor, colonyTargetSignature, colonyTargetTooltip, computeColonyTargetScores, heatColor, scoreColonyTargets } from '../src/render/colonyTargets';
import { identifyColonizationTargetsFull } from '../src/sim/civilianAI';
import { expansionTargets } from '../src/ui/screens/expansionPlanner';
import { RefuelReach, fleetRangeRadii, fuelOverlayData, fuelReferenceShip, playerShipsOfSelection, refuelReach, shipFuelTypes } from '../src/render/rangeRings';
import { fuelLabelText, refuelPointStyle, refuelPointTooltip, shortDistance, FUEL_COLORS } from '../src/render/fuelOverlay';
import { iconRowLayout, resourceIconPx } from '../src/render/resourceOverlay';
import { keyedAlpha } from '../src/render/dw2OverlayArt';
import { currentRange, ultraFastFindNearestRefuellingLocation } from '../src/sim/movement';
import { improvementById, isImprovementEnabled, onImprovementsChange, overlayRowSections, setImprovementEnabled } from '../src/ui/improvements';
import { setSettingsStorage, updateSettings, type SettingsStorage } from '../src/ui/settings';
import {
    OVERLAY_ROWS,
    createMapOverlayState,
    overlayActive,
    onOverlayChange,
    overlayOptionsOf,
    setOverlay,
    setOverlayResourceFilter,
} from '../src/ui/mapOverlays';

// ---------------------------------------------------------------- fakes

function res(id: number, name: string, type: number, superLuxury = 0, pictureRef = id): Resource {
    return { resourceId: id, name, pictureRef, type, superLuxuryBonusAmount: superLuxury } as unknown as Resource;
}

function hab(name: string, systemIndex: number, resources: { resourceId: number; abundance: number }[], habitatIndex = 0): Habitat {
    return { name, systemIndex, resources, habitatIndex, parent: {}, xpos: systemIndex * 1000, ypos: 0, category: HabitatCategoryType.Planet } as unknown as Habitat;
}

const RES = new Map<number, Resource>([
    [1, res(1, 'Iron', 0)],
    [2, res(2, 'Caslon', 1)],
    [3, res(3, 'Silk', 2)],
    [4, res(4, 'Loros Fruit', 2, 50)],
]);

describe('Resources overlay data', () => {
    it('rarity follows the planner (super luxury very rare, luxury rare, else common)', () => {
        expect(resourceRarity(RES.get(1))).toBe(ResourceRarity.Common);
        expect(resourceRarity(RES.get(2))).toBe(ResourceRarity.Common);
        expect(resourceRarity(RES.get(3))).toBe(ResourceRarity.Rare);
        expect(resourceRarity(RES.get(4))).toBe(ResourceRarity.VeryRare);
        expect(resourceRarity(undefined)).toBe(ResourceRarity.Common);
    });

    const stars = [hab('Alpha', 0, []), hab('Beta', 1, []), hab('Gamma', 2, [])];
    const a1 = hab('Alpha 1', 0, [{ resourceId: 1, abundance: 300 }, { resourceId: 3, abundance: 100 }]);
    const a2 = hab('Alpha 2', 0, [{ resourceId: 1, abundance: 700 }]);
    const b1 = hab('Beta 1', 1, [{ resourceId: 2, abundance: 500 }, { resourceId: 4, abundance: 50 }]);
    const g1 = hab('Gamma 1', 2, [{ resourceId: 2, abundance: 900 }]); // unknown
    const empty = hab('Alpha 3', 0, []);
    const habitats = [b1, a1, g1, a2, empty];
    const index = buildKnownResourceIndex(habitats, (i) => stars[i] ?? null, (h) => h !== g1, (id) => RES.get(id));

    it('groups the known habitats by system, in system order, and skips the unknown and the empty', () => {
        expect(index.systems.map((s) => s.star.name)).toEqual(['Alpha', 'Beta']);
        expect(index.bySystem.has(2)).toBe(false);
        const alpha = index.bySystem.get(0)!;
        expect(alpha.habitats.map((h) => h.habitat.name)).toEqual(['Alpha 1', 'Alpha 2']);
    });

    it('aggregates per system: the best abundance and the source count, rarest first then most abundant', () => {
        const alpha = index.bySystem.get(0)!;
        expect(alpha.resources).toEqual([
            { resourceId: 3, maxAbundance: 100, habitatCount: 1, rarity: ResourceRarity.Rare },
            { resourceId: 1, maxAbundance: 700, habitatCount: 2, rarity: ResourceRarity.Common },
        ]);
        expect(index.bySystem.get(1)!.resources.map((r) => r.resourceId)).toEqual([4, 2]);
        expect(index.systemCountByResource.get(1)).toBe(1);
        expect(index.systemCountByResource.get(2)).toBe(1); // Gamma's is unknown
        expect(index.systemCountByResource.get(4)).toBe(1);
    });

    it('filters systems and icons by a chosen resource', () => {
        expect(systemsForFilter(index, null)).toBe(index.systems);
        expect(systemsForFilter(index, 2).map((s) => s.star.name)).toEqual(['Beta']);
        expect(systemsForFilter(index, 99)).toEqual([]);
        const alpha = index.bySystem.get(0)!;
        expect(systemIcons(alpha, null, 1).map((r) => r.resourceId)).toEqual([3]);
        expect(systemIcons(alpha, 1, 4).map((r) => r.maxAbundance)).toEqual([700]);
        expect(systemIcons(alpha, 2, 4)).toEqual([]);
        expect(habitatIcons(alpha.habitats[0], 1).map((r) => r.abundance)).toEqual([300]);
        expect(habitatIcons(alpha.habitats[0], null)).toHaveLength(2);
    });

    it('shows fewer icons per system as the view widens', () => {
        expect(maxSystemIcons(100)).toBe(4);
        expect(maxSystemIcons(500)).toBe(3);
        expect(maxSystemIcons(1500)).toBe(2);
        expect(maxSystemIcons(4000)).toBe(1);
        expect(resourceIconPx(100)).toBeGreaterThan(resourceIconPx(4000));
        const L = iconRowLayout(1000, 0, 3, 10, 5, 0.5);
        expect(L.step).toBeCloseTo(26);
        expect(L.x0 + L.step).toBeCloseTo(1000); // centred
        expect(L.y).toBeCloseTo(20);
    });

    it('picker: "All" first, then very rare / rare / common, known ones before the rest, with system counts', () => {
        const opts = resourcePickerOptions([...RES.values(), res(5, 'Aculon', 0)], index);
        expect(opts[0]).toMatchObject({ resourceId: null, systems: 2 });
        expect(opts.slice(1).map((o) => o.resourceId)).toEqual([4, 3, 2, 1, 5]);
        expect(opts.find((o) => o.resourceId === 5)!.label).toBe('Aculon — none known');
        expect(opts.find((o) => o.resourceId === 1)!.label).toBe('Iron — 1 system');
    });

    it('tooltip lists name, abundance %, rarity and the source count', () => {
        const t = resourceTooltipText('Alpha: known resources', index.bySystem.get(0)!.resources, (id) => RES.get(id)!.name);
        expect(t).toBe('Alpha: known resources\nSilk  10% (rare)\nIron  70% (common) · 2 sources');
    });

    it('the signature follows the ResourceMap bits, and the cached index is rebuilt only when they change', () => {
        const bits = new Uint8Array(4);
        const player = { resourceMap: { resourcesKnown: bits, checkResourcesKnown: (h: Habitat) => (bits[h.habitatIndex >> 3] & (1 << (h.habitatIndex & 7))) !== 0 } } as unknown as Empire;
        const h0 = hab('H0', 0, [{ resourceId: 1, abundance: 100 }], 0);
        const h9 = hab('H9', 0, [{ resourceId: 2, abundance: 100 }], 9);
        const galaxy = { habitats: [h0, h9], systems: [{ systemStar: stars[0] }], resourceSystem: { byId: RES } } as unknown as Galaxy;
        const s0 = knownResourceSignature(galaxy, player, false);
        const i0 = knownResourceIndexFor(galaxy, player);
        expect(i0.systems).toHaveLength(0);
        expect(knownResourceIndexFor(galaxy, player)).toBe(i0);
        bits[1] |= 1 << 1; // habitat 9 becomes known
        expect(knownResourceSignature(galaxy, player, false)).not.toBe(s0);
        const i1 = knownResourceIndexFor(galaxy, player);
        expect(i1).not.toBe(i0);
        expect(i1.systems[0].resources.map((r) => r.resourceId)).toEqual([2]);
        expect(knownResourceIndexFor(galaxy, player, true).systems[0].resources).toHaveLength(2); // the fog's reveal
        expect(knownResourceSignature(galaxy, null, false)).toBeTypeOf('number');
    });

    it('keys out the icons\' flat background colour', () => {
        expect(keyedAlpha(21, 21, 28)).toBe(0);
        expect(keyedAlpha(25, 23, 30)).toBe(0);
        expect(keyedAlpha(200, 100, 50)).toBe(255);
        const mid = keyedAlpha(36, 21, 28);
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(255);
    });
});

describe('Colony Target Scores data', () => {
    const h = (name: string, systemIndex: number): Habitat => ({ name, systemIndex, quality: 0.75 }) as unknown as Habitat;
    const A = h('A', 0);
    const B = h('B', 0);
    const C = h('C', 1);
    const D = h('D', 2);

    it('ranks best first; heat 1 → 0 by rank; each system keeps its best target', () => {
        const s = scoreColonyTargets([{ habitat: B, priority: 50 }, { habitat: A, priority: 900 }, { habitat: null, priority: 5 }, { habitat: C, priority: 50 }, { habitat: D, priority: 1 }]);
        expect(s.list.map((x) => x.habitat.name)).toEqual(['A', 'B', 'C', 'D']);
        const heat = s.list.map((x) => x.heat);
        [1, 2 / 3, 1 / 3, 0].forEach((v, i) => expect(heat[i]).toBeCloseTo(v));
        expect(s.bySystem.get(0)!.habitat).toBe(A);
        expect(s.bySystem.get(1)!.habitat).toBe(C);
        expect(s.byHabitat.get(D)!.rank).toBe(3);
    });

    it('one target is fully hot; duplicates count once; none is empty', () => {
        expect(scoreColonyTargets([{ habitat: A, priority: 3 }]).list[0].heat).toBe(1);
        expect(scoreColonyTargets([{ habitat: A, priority: 3 }, { habitat: A, priority: 3 }]).list).toHaveLength(1);
        expect(scoreColonyTargets([]).list).toEqual([]);
    });

    it('heat colours run red → amber → green', () => {
        expect(heatColor(0)).toBe(0xe04030);
        expect(heatColor(0.5)).toBe(0xf0c030);
        expect(heatColor(1)).toBe(0x40e860);
        expect(heatColor(-1)).toBe(heatColor(0));
        expect(heatColor(2)).toBe(heatColor(1));
    });

    it('tooltip: rank, name, system, quality and score', () => {
        const s = scoreColonyTargets([{ habitat: A, priority: 12345 }, { habitat: C, priority: 3 }]);
        expect(colonyTargetTooltip(s.list[0], 2, 'Sol')).toBe('Colony target 1 of 2: A (Sol)\nQuality 75% · score 12,345');
        expect(colonyTargetTooltip(s.list[1], 2, 'C')).toBe('Colony target 2 of 2: C\nQuality 75% · score 3');
    });
});

describe('Fuel Range data helpers', () => {
    function ship(fuel: number, opts: Partial<BuiltObject> = {}): BuiltObject {
        return {
            hasBeenDestroyed: false,
            warpSpeed: 1000,
            warpSpeedFuelBurn: 10,
            staticEnergyConsumption: 0,
            fuelCapacity: 1000,
            currentFuel: fuel,
            cruiseSpeed: 100,
            reactorCycleFuelConsumption: 1000,
            reactorStorageCapacity: 0,
            fuelType: { resourceId: 7 },
            ...opts,
        } as unknown as BuiltObject;
    }

    it('reach classes against the 45% / 100% rings', () => {
        const r = { range45: 45, range100: 100 };
        expect(refuelReach(10, r)).toBe(RefuelReach.RoundTrip);
        expect(refuelReach(45, r)).toBe(RefuelReach.RoundTrip);
        expect(refuelReach(46, r)).toBe(RefuelReach.OneWay);
        expect(refuelReach(100, r)).toBe(RefuelReach.OneWay);
        expect(refuelReach(101, r)).toBe(RefuelReach.Beyond);
        expect(refuelReach(1, null)).toBe(RefuelReach.Beyond);
    });

    it('the limiting ship is the one with the shortest range; no hyperdrive / tank: none', () => {
        const a = ship(900);
        const b = ship(200);
        expect(fuelReferenceShip([a, b])).toBe(b);
        expect(fuelReferenceShip([ship(500, { warpSpeed: 0 } as Partial<BuiltObject>)])).toBeNull();
        expect(fuelReferenceShip([])).toBeNull();
        expect(shipFuelTypes(b)).toEqual([{ resourceId: 7, sortTag: 800 }]);
    });

    it("the player's ships of a selection: a fleet (lead first), a box selection, one ship; never another empire's", () => {
        const me = {} as Empire;
        const other = {} as Empire;
        const s1 = ship(500, { empire: me } as Partial<BuiltObject>);
        const s2 = ship(500, { empire: me } as Partial<BuiltObject>);
        const dead = ship(500, { empire: me, hasBeenDestroyed: true } as Partial<BuiltObject>);
        const foreign = ship(500, { empire: other } as Partial<BuiltObject>);
        expect(playerShipsOfSelection({ shipGroup: { empire: me, ships: [s1, s2, dead], leadShip: s2 } }, me)).toEqual({ ships: [s1, s2], lead: s2 });
        expect(playerShipsOfSelection({ shipGroup: { empire: other, ships: [foreign], leadShip: foreign } }, me)).toEqual({ ships: [], lead: null });
        expect(playerShipsOfSelection({ builtObjects: [foreign, s1] }, me)).toEqual({ ships: [s1], lead: s1 });
        expect(playerShipsOfSelection({ builtObject: foreign }, me)).toEqual({ ships: [], lead: null });
        expect(playerShipsOfSelection({ builtObject: s1 }, me).lead).toBe(s1);
        expect(playerShipsOfSelection(null, me).ships).toEqual([]);
    });

    it('marker styles, distances, label and tooltip texts', () => {
        const base = { target: {} as Habitat, own: true, militaryOnly: false, usable: true, blocked: null } as const;
        expect(refuelPointStyle({ ...base, reach: null }).color).toBe(FUEL_COLORS.own);
        expect(refuelPointStyle({ ...base, own: false, reach: null }).color).toBe(FUEL_COLORS.foreign);
        expect(refuelPointStyle({ ...base, reach: RefuelReach.RoundTrip }).color).toBe(FUEL_COLORS.roundTrip);
        expect(refuelPointStyle({ ...base, reach: RefuelReach.OneWay }).color).toBe(FUEL_COLORS.oneWay);
        expect(refuelPointStyle({ ...base, reach: RefuelReach.Beyond }).color).toBe(FUEL_COLORS.beyond);
        expect(refuelPointStyle({ ...base, usable: false, blocked: 'treaty', reach: RefuelReach.RoundTrip })).toMatchObject({ color: FUEL_COLORS.blocked, hollow: true });
        expect(shortDistance(6_525_015)).toBe('6.5M');
        expect(shortDistance(65_250_150)).toBe('65M');
        expect(shortDistance(830_400)).toBe('830K');
        expect(shortDistance(900)).toBe('900');
        const s = ship(250);
        const near = { name: 'Depot' } as Habitat;
        const data = {
            ship: s,
            radii: { range45: 45, range100: 100 },
            nearest: near,
            points: [
                { ...base, reach: RefuelReach.RoundTrip },
                { ...base, reach: RefuelReach.OneWay },
                { ...base, reach: RefuelReach.OneWay, usable: false, blocked: 'fuel' as const },
            ],
        };
        expect(fuelLabelText(data, (o) => o.name)).toBe('Fuel 25% · reach 100\nRefuel: 1 there-and-back · 1 one-way\nWould refuel at Depot');
        expect(fuelLabelText({ ...data, ship: null }, (o) => o.name)).toBe('');
        expect(refuelPointTooltip({ ...base, own: false, usable: false, blocked: 'treaty', reach: RefuelReach.OneWay }, 'Port', 'Ackdarian Empire')).toBe(
            'Refuelling point: Port (Ackdarian Empire)\ncannot refuel here: no military refuelling agreement',
        );
        expect(refuelPointTooltip({ ...base, militaryOnly: true, reach: null }, 'Tanker', null)).toBe('Military refuelling point: Tanker (yours)');
    });
});

describe('Improvements registry and overlay state', () => {
    beforeEach(() => {
        const data = new Map<string, string>();
        const mem: SettingsStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
        setSettingsStorage(mem);
        updateSettings({ improvements: {} });
    });
    afterEach(() => {
        updateSettings({ improvements: {} });
        setSettingsStorage(null);
    });
    const IDS = ['colonyTargetScores', 'resourcesOverlay', 'fuelRangeOverlay'];

    it('registers the three overlays (on by default); switching one off hides its row and stops its drawing', () => {
        for (const id of IDS) {
            const d = improvementById(id)!;
            expect(d.label.length).toBeGreaterThan(0);
            expect(d.description.length).toBeGreaterThan(0);
            expect(d.default).toBe(true);
            expect(isImprovementEnabled(id)).toBe(true);
        }
        const s = createMapOverlayState();
        expect(overlayActive(s, 'resources')).toBe(false); // the toggle starts off
        s.resources = true;
        expect(overlayActive(s, 'resources')).toBe(true);
        let calls = 0;
        const off = onImprovementsChange(() => calls++);
        setImprovementEnabled('resourcesOverlay', false);
        expect(calls).toBe(1);
        expect(overlayActive(s, 'resources')).toBe(false);
        expect(overlayRowSections(OVERLAY_ROWS).improvements.map((r) => r.key)).toEqual(['colonyScores', 'fuelRange']);
        setImprovementEnabled('resourcesOverlay', true);
        off();
        expect(calls).toBe(2);
    });

    it('the new overlays start off and are listed in the Improvements section, not the original one', () => {
        const s = createMapOverlayState();
        expect([s.colonyScores, s.resources, s.fuelRange]).toEqual([false, false, false]);
        const { original, improvements } = overlayRowSections(OVERLAY_ROWS);
        expect(improvements.map((r) => [r.key, r.improvement])).toEqual([
            ['colonyScores', 'colonyTargetScores'],
            ['resources', 'resourcesOverlay'],
            ['fuelRange', 'fuelRangeOverlay'],
        ]);
        for (const k of ['colonyScores', 'resources', 'fuelRange']) expect(original.some((o) => o.key === k)).toBe(false);
        expect(improvements.every((r) => r.mod === undefined)).toBe(true); // no "+" badge: the section says it
    });

    it('the resource filter belongs to one overlay state and notifies like a toggle', () => {
        const s = createMapOverlayState();
        const t = createMapOverlayState();
        expect(overlayOptionsOf(s).resourceFilter).toBeNull();
        let calls = 0;
        const off = onOverlayChange(() => calls++);
        setOverlayResourceFilter(s, 2);
        setOverlayResourceFilter(s, 2);
        expect(calls).toBe(1);
        expect(overlayOptionsOf(s).resourceFilter).toBe(2);
        expect(overlayOptionsOf(t).resourceFilter).toBeNull();
        setOverlay(s, 'resources', true);
        setOverlay(s, 'resources', true);
        expect(s.resources).toBe(true);
        expect(calls).toBe(2);
        off();
    });
});

// Against the seed-1 harness game: the helpers give the sim's own answers and write nothing.
describe('Improvements overlays on the seed-1 game', () => {
    let gameData: GameData;
    let galaxy: Galaxy;
    let player: Empire;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
        galaxy = cachedTickGame(gameData, { seconds: 600 }).galaxy;
        player = galaxy.playerEmpire!;
    }, 600000);

    it('known resources: exactly the habitats the ResourceMap marks, nothing else', () => {
        const before = stateDigest(galaxy);
        const index = knownResourceIndexFor(galaxy, player);
        let expected = 0;
        for (const h of galaxy.habitats) if (h.resources.length > 0 && player.resourceMap.checkResourcesKnown(h)) expected++;
        const got = index.systems.reduce((n, s) => n + s.habitats.length, 0);
        expect(got).toBe(expected);
        expect(got).toBeGreaterThan(0);
        for (const s of index.systems) for (const h of s.habitats) expect(player.resourceMap.checkResourcesKnown(h.habitat)).toBe(true);
        expect(stateDigest(galaxy)).toBe(before);
    });

    it("colony scores: the Expansion Planner's Potential Colonies list, in its order, cached until an input changes", () => {
        // The seed-1 player (one colonizable habitat type) has no target yet: stage three on this copy — unowned planets
        // in explored systems turned into its own type, at three qualities.
        const type = player.colonizableHabitatTypesForEmpire()[0];
        const staged: Habitat[] = [];
        for (let i = 0; i < galaxy.systems.length && staged.length < 3; i++) {
            if (!player.visibility.checkSystemExplored(i)) continue;
            for (const h of galaxy.systemHabitatsOf(i)) {
                if (staged.length >= 3 || h.category !== HabitatCategoryType.Planet || h.owner !== null || h.empire !== null) continue;
                h.type = type;
                h.baseQuality = 0.6 + 0.15 * staged.length;
                staged.push(h);
            }
        }
        expect(staged.length).toBeGreaterThan(1);
        const before = stateDigest(galaxy);
        const scores = computeColonyTargetScores(galaxy, player);
        const planner = expansionTargets('colonies', galaxy, player, { includeLowQuality: false, includeAsteroids: false });
        expect(scores.list.map((s) => s.habitat)).toEqual(planner.map((t) => t.habitat));
        expect(scores.list.map((s) => s.priority)).toEqual(planner.map((t) => t.priority));
        expect(scores.list.length).toBeGreaterThan(1);
        for (const h of staged) expect(scores.byHabitat.has(h) || !galaxy.checkEmpireTerritoryCanColonizeHabitat(player, h)).toBe(true);
        expect(scores.list[0].heat).toBe(1);
        expect(scores.list[scores.list.length - 1].heat).toBe(0);
        for (const s of scores.list) expect(player.visibility.checkSystemExplored(s.habitat.systemIndex)).toBe(true);
        expect(identifyColonizationTargetsFull(galaxy, player, false, 0, 5000, false, true).length).toBe(scores.list.length);
        const c1 = colonyTargetScoresFor(galaxy, player);
        expect(colonyTargetScoresFor(galaxy, player)).toBe(c1);
        const sig = colonyTargetSignature(galaxy, player);
        player.colonies.push(player.colonies[0]); // an input changes (restored below)
        expect(colonyTargetSignature(galaxy, player)).not.toBe(sig);
        expect(colonyTargetScoresFor(galaxy, player)).not.toBe(c1);
        player.colonies.pop();
        expect(stateDigest(galaxy)).toBe(before);
    });

    it("fuel: the player's refuelling points, classed against the selection's rings, and the sim's own refuelling pick", () => {
        const before = stateDigest(galaxy);
        const none = fuelOverlayData(galaxy, player, [], null);
        expect(none.ship).toBeNull();
        expect(none.points.length).toBe(new Set([...player.refuellingLocations, ...player.refuellingLocationsMilitaryOnly]).size);
        expect(none.points.length).toBeGreaterThan(0);
        for (const p of none.points) expect(p).toMatchObject({ usable: true, reach: null, blocked: null });
        const ships = player.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.warpSpeed > 0 && b.fuelCapacity > 0);
        expect(ships.length).toBeGreaterThan(0);
        const s = ships[0];
        const d = fuelOverlayData(galaxy, player, [s], { x: s.xpos, y: s.ypos });
        expect(d.ship).toBe(s);
        expect(d.radii).toEqual(fleetRangeRadii([s]));
        for (const p of d.points) {
            const dist = Math.hypot(p.target.xpos - s.xpos, p.target.ypos - s.ypos);
            expect(p.reach).toBe(refuelReach(dist, d.radii));
            expect(p.usable).toBe(p.blocked === null);
        }
        expect(d.radii!.range100).toBeCloseTo(currentRange(s, 0));
        expect(d.nearest).toBe(ultraFastFindNearestRefuellingLocation(galaxy, player, s.xpos, s.ypos, shipFuelTypes(s), s, false, s.role === BuiltObjectRole.Military));
        expect(stateDigest(galaxy)).toBe(before);
    });
});
