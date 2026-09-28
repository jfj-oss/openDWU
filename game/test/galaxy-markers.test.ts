// Faction markers, fleet icons and station-presence discs (render/galaxyMarkers.ts): pure helpers.

import { describe, expect, it } from 'vitest';
import {
    brighten,
    clickSelection,
    collectStationPresence,
    contrastTextColor,
    doubleClickFleet,
    empireMarkerColor,
    factionRingBandAlpha,
    fleetIconPx,
    galaxyOverlayAlpha,
    markerShapeForSubRole,
    perShipSymbolPx,
    pickDrawnSymbol,
    presenceBandAlpha,
    presenceDiscRadius,
    shipSymbolPx,
    stationPresenceVisible,
    symbolAlpha,
    symbolArtFor,
    symbolBand,
    symbolSizeMultiplier,
    systemRingRadiusPx,
    SYSTEM_INFLUENCE_RADIUS,
    type DrawnSymbol,
} from '../src/render/galaxyMarkers';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { HabitatCategoryType } from '../src/sim/types';
import { createMapOverlayState } from '../src/ui/mapOverlays';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';

const BASES = [
    BuiltObjectSubRole.GasMiningStation,
    BuiltObjectSubRole.MiningStation,
    BuiltObjectSubRole.SmallSpacePort,
    BuiltObjectSubRole.MediumSpacePort,
    BuiltObjectSubRole.LargeSpacePort,
    BuiltObjectSubRole.ResortBase,
    BuiltObjectSubRole.GenericBase,
    BuiltObjectSubRole.EnergyResearchStation,
    BuiltObjectSubRole.WeaponsResearchStation,
    BuiltObjectSubRole.HighTechResearchStation,
    BuiltObjectSubRole.MonitoringStation,
    BuiltObjectSubRole.DefensiveBase,
];
const WARSHIPS = [
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.TroopTransport,
    BuiltObjectSubRole.Carrier,
    BuiltObjectSubRole.ResupplyShip,
];
const CIVILIAN = [
    BuiltObjectSubRole.SmallFreighter,
    BuiltObjectSubRole.MediumFreighter,
    BuiltObjectSubRole.LargeFreighter,
    BuiltObjectSubRole.PassengerShip,
    BuiltObjectSubRole.GasMiningShip,
    BuiltObjectSubRole.MiningShip,
];

describe('markerShapeForSubRole (shape by sub-role)', () => {
    it('squares for construction ships, hexagons for every base, triangles for warships, circles for private ships', () => {
        expect(markerShapeForSubRole(BuiltObjectSubRole.ConstructionShip)).toBe('square');
        for (const s of BASES) expect(markerShapeForSubRole(s), BuiltObjectSubRole[s]).toBe('hexagon');
        for (const s of WARSHIPS) expect(markerShapeForSubRole(s), BuiltObjectSubRole[s]).toBe('triangle');
        for (const s of CIVILIAN) expect(markerShapeForSubRole(s), BuiltObjectSubRole[s]).toBe('circle');
    });
    it("diamonds for exploration / colony ships (the original's Exploration/Colony symbol); none for Undefined", () => {
        expect(markerShapeForSubRole(BuiltObjectSubRole.ExplorationShip)).toBe('diamond');
        expect(markerShapeForSubRole(BuiltObjectSubRole.ColonyShip)).toBe('diamond');
        expect(markerShapeForSubRole(BuiltObjectSubRole.Undefined)).toBeNull();
    });
});

describe('symbolArtFor (MainView.2.cs method_178)', () => {
    it('picks the shipsymbols art by role, mining stations apart from the other bases', () => {
        expect(symbolArtFor(BuiltObjectRole.Military, BuiltObjectSubRole.Cruiser)).toBe('military');
        expect(symbolArtFor(BuiltObjectRole.Freight, BuiltObjectSubRole.SmallFreighter)).toBe('freighter');
        expect(symbolArtFor(BuiltObjectRole.Passenger, BuiltObjectSubRole.PassengerShip)).toBe('passengership');
        expect(symbolArtFor(BuiltObjectRole.Exploration, BuiltObjectSubRole.ExplorationShip)).toBe('exploration');
        expect(symbolArtFor(BuiltObjectRole.Colony, BuiltObjectSubRole.ColonyShip)).toBe('exploration');
        expect(symbolArtFor(BuiltObjectRole.Build, BuiltObjectSubRole.ConstructionShip)).toBe('construction');
        expect(symbolArtFor(BuiltObjectRole.Resource, BuiltObjectSubRole.MiningShip)).toBe('miningship');
        expect(symbolArtFor(BuiltObjectRole.Base, BuiltObjectSubRole.MiningStation)).toBe('miningstation');
        expect(symbolArtFor(BuiltObjectRole.Base, BuiltObjectSubRole.GasMiningStation)).toBe('miningstation');
        expect(symbolArtFor(BuiltObjectRole.Base, BuiltObjectSubRole.SmallSpacePort)).toBe('base');
        expect(symbolArtFor(BuiltObjectRole.Base, BuiltObjectSubRole.DefensiveBase)).toBe('base');
        expect(symbolArtFor(BuiltObjectRole.Undefined, BuiltObjectSubRole.Undefined)).toBeNull();
    });
});

describe('symbol sizes', () => {
    it('num68 (MainView.2.cs 5955-5980): sqrt(400/f) below 400, 4000/f beyond 4000, clamped [6, 12 | 15 bases]', () => {
        expect(shipSymbolPx(400, false)).toBe(10);
        expect(shipSymbolPx(300, false)).toBe(11);
        expect(shipSymbolPx(100, false)).toBe(12);
        expect(shipSymbolPx(100, true)).toBe(15);
        expect(shipSymbolPx(5000, false)).toBe(8);
        expect(shipSymbolPx(40000, true)).toBe(6);
    });
    it('fleet icon num82 (6112-6124): 22, scaled like num68, at least 12', () => {
        expect(fleetIconPx(400)).toBe(22);
        expect(fleetIconPx(200)).toBe(31);
        expect(fleetIconPx(8000)).toBe(12);
    });
    it('per-ship symbols are at least 8 px (10 for bases) (MainView.1.cs 1094-1103)', () => {
        expect(perShipSymbolPx(3, false)).toBe(8);
        expect(perShipSymbolPx(3, true)).toBe(10);
        expect(perShipSymbolPx(40, false)).toBe(40);
    });
    it('DrawShipSymbolXna multipliers (2448-2477), x1.2 at galaxy level', () => {
        expect(symbolSizeMultiplier(BuiltObjectRole.Military, BuiltObjectSubRole.Cruiser, false)).toBe(1.4);
        expect(symbolSizeMultiplier(BuiltObjectRole.Exploration, BuiltObjectSubRole.ExplorationShip, false)).toBe(1.5);
        expect(symbolSizeMultiplier(BuiltObjectRole.Resource, BuiltObjectSubRole.MiningShip, false)).toBe(1.3);
        expect(symbolSizeMultiplier(BuiltObjectRole.Passenger, BuiltObjectSubRole.PassengerShip, false)).toBe(1.6);
        expect(symbolSizeMultiplier(BuiltObjectRole.Base, BuiltObjectSubRole.MiningStation, false)).toBe(1.8);
        expect(symbolSizeMultiplier(BuiltObjectRole.Base, BuiltObjectSubRole.SmallSpacePort, false)).toBe(1.2);
        expect(symbolSizeMultiplier(BuiltObjectRole.Military, BuiltObjectSubRole.Cruiser, true)).toBeCloseTo(1.68);
    });
});

describe('alpha / style by zoom band', () => {
    it('outline symbols up to f = 10, filled per-ship symbols to f = 150, the galaxy pass beyond', () => {
        expect(symbolBand(1)).toBe('outline');
        expect(symbolBand(10)).toBe('outline');
        expect(symbolBand(11)).toBe('filled');
        expect(symbolBand(150)).toBe('filled');
        expect(symbolBand(151)).toBe('galaxy');
        expect(symbolBand(20000)).toBe('galaxy');
    });
    it('outline alpha max(0.6, f/3) (+48 for ships), opaque for galaxy-level and unowned symbols', () => {
        expect(symbolAlpha(1, true, true)).toBe(153 / 255);
        expect(symbolAlpha(1, true, false)).toBe(201 / 255);
        expect(symbolAlpha(3, true, false)).toBe(1);
        expect(symbolAlpha(1, false, false)).toBe(1);
        expect(symbolAlpha(200, true, false)).toBe(1);
    });
    it('galaxyOverlayAlpha ports int_15 = clamp((f - 70) * 1.2, 0, 255) (MainView.cs 1540-1548)', () => {
        expect(galaxyOverlayAlpha(70)).toBe(0);
        expect(galaxyOverlayAlpha(170)).toBe(120 / 255);
        expect(galaxyOverlayAlpha(283)).toBe(1);
    });
    it('faction rings only beyond f = 150 (num16, MainView.2.cs:5153)', () => {
        expect(factionRingBandAlpha(150)).toBe(0);
        expect(factionRingBandAlpha(151)).toBeCloseTo(galaxyOverlayAlpha(151));
        expect(factionRingBandAlpha(2000)).toBe(1);
    });
    it('presence discs at 0.25 (method_236(0.25)) once past system zoom', () => {
        expect(presenceBandAlpha(50)).toBe(0);
        expect(presenceBandAlpha(1000)).toBe(0.25);
    });
});

describe('stationPresenceVisible', () => {
    it('shows the discs only with their toggle on and Empire Territory off', () => {
        expect(stationPresenceVisible({ stationPresence: true, empireTerritory: false })).toBe(true);
        expect(stationPresenceVisible({ stationPresence: true, empireTerritory: true })).toBe(false);
        expect(stationPresenceVisible({ stationPresence: false, empireTerritory: false })).toBe(false);
        expect(stationPresenceVisible({ stationPresence: false, empireTerritory: true })).toBe(false);
    });
    it('defaults: both toggles on, so the discs stay hidden until territory is turned off', () => {
        const s = createMapOverlayState();
        expect(s.factionMarkers).toBe(true);
        expect(s.stationPresence).toBe(true);
        expect(stationPresenceVisible(s)).toBe(false);
        s.empireTerritory = false;
        expect(stationPresenceVisible(s)).toBe(true);
    });
});

describe('presenceDiscRadius', () => {
    it("is the original's system-influence radius (150000 * 1.1 / 2) for one, growing with sqrt(count)", () => {
        expect(SYSTEM_INFLUENCE_RADIUS).toBe(82500);
        expect(presenceDiscRadius(0)).toBe(0);
        expect(presenceDiscRadius(1)).toBeCloseTo(82500);
        expect(presenceDiscRadius(4)).toBeCloseTo(82500 * 1.4);
        expect(presenceDiscRadius(9)).toBeCloseTo(82500 * 1.8);
    });
    it('grows monotonically and stays a small fraction of the 0.5 M+ colony influence range', () => {
        let prev = 0;
        for (let n = 1; n < 200; n++) {
            const r = presenceDiscRadius(n);
            expect(r).toBeGreaterThanOrEqual(prev);
            prev = r;
        }
        expect(prev).toBeLessThanOrEqual(82500 * 2.5);
    });
});

describe('systemRingRadiusPx (MainView.2.cs method_250 val3)', () => {
    it('is MaxSolarSystemSize / f for small empires, bigger with strategic value (capped at 1.5 M)', () => {
        expect(systemRingRadiusPx(1000, 0, 0, 23000)).toBe(23);
        expect(systemRingRadiusPx(1000, 1_500_000, 0, 23000)).toBe(Math.trunc((Math.pow(1_500_000, 0.35) * 600) / 1000));
        expect(systemRingRadiusPx(1000, 9_000_000, 0, 23000)).toBe(systemRingRadiusPx(1000, 1_500_000, 0, 23000));
    });
    it('is pushed outside the star icon when it would hug it', () => {
        expect(systemRingRadiusPx(20000, 0, 0, 23000)).toBe(7); // val3 = 1, val4 = 8 -> 8/2 + 3
    });
});

describe('colours', () => {
    it('brightens by +48 per channel, clamped (method_226)', () => {
        expect(brighten(0x102030, 48)).toBe(0x405060);
        expect(brighten(0xfff0e0, 48)).toBe(0xffffff);
    });
    it("swaps the pirates' (1,1,1) black for (48,48,48)", () => {
        expect(empireMarkerColor({ mainColor: 0x010101 } as Empire)).toBe(0x303030);
        expect(empireMarkerColor({ mainColor: 0x00ff00 } as Empire)).toBe(0x00ff00);
    });
    it('fleet count text is black on bright tints, white on dark (method_263)', () => {
        expect(contrastTextColor(0xffff00)).toBe(0x000000);
        expect(contrastTextColor(0x00a000)).toBe(0xffffff);
    });
});

describe('picking and selection', () => {
    const bo = (id: number, empire: Empire | null = null, shipGroup: unknown = null) => ({ builtObjectID: id, empire, shipGroup }) as unknown as BuiltObject;
    const player = { empireId: 1 } as Empire;
    const other = { empireId: 2 } as Empire;
    const a = bo(1);
    const b = bo(2);
    const lead = bo(3);
    const fleet = { leadShip: lead, ships: [lead] } as unknown as ShipGroup;
    const z = 1 / 1000; // f = 1000: 1 px = 1000 world units
    const drawn: DrawnSymbol[] = [
        { bo: a, group: null, x: 0, y: 0, halfPx: 6 },
        { bo: b, group: null, x: 5000, y: 0, halfPx: 6 },
        { bo: lead, group: fleet, x: 30000, y: 0, halfPx: 11 },
        { bo: bo(7), group: null, x: 31000, y: 0, halfPx: 6 },
    ];
    it('picks the symbol whose box (half size + 2 px) holds the point, nearest first', () => {
        expect(pickDrawnSymbol(drawn, 1000, 0, z)?.bo).toBe(a);
        expect(pickDrawnSymbol(drawn, -8000, 0, z)?.bo).toBe(a);
        expect(pickDrawnSymbol(drawn, -9000, 0, z)).toBeNull();
    });
    it('prefers a fleet icon over ship symbols under the same point', () => {
        const hit = pickDrawnSymbol(drawn, 31000, 0, z);
        expect(hit?.group).toBe(fleet);
    });
    it('a click on a fleet icon selects the fleet, on a symbol the ship', () => {
        expect(clickSelection({ bo: lead, group: fleet })).toBe(fleet);
        expect(clickSelection({ bo: a, group: null })).toBe(a);
    });
    it("double-clicking one of the player's own fleet ships selects its fleet (Main.Part7.cs 3494-3502)", () => {
        const member = bo(4, player, fleet);
        expect(doubleClickFleet(member, player)).toBe(fleet);
        expect(doubleClickFleet(bo(5, player, null), player)).toBeNull(); // not in a fleet
        expect(doubleClickFleet(bo(6, other, fleet), player)).toBeNull(); // someone else's ship
        expect(doubleClickFleet(member, null)).toBeNull();
    });
});

describe('collectStationPresence', () => {
    const a = { empireId: 1, mainColor: 0xff0000 } as Empire;
    const b = { empireId: 2, mainColor: 0x0000ff } as Empire;
    const indep = { empireId: 9, mainColor: 0x606060 } as Empire;
    const star0 = { xpos: 0, ypos: 0, systemIndex: 0, category: HabitatCategoryType.Star };
    const star1 = { xpos: 1_000_000, ypos: 0, systemIndex: 1, category: HabitatCategoryType.Star };
    const planet = (sys: number, owner: Empire | null) => ({ systemIndex: sys, category: HabitatCategoryType.Planet, owner, empire: owner });
    const base = (empire: Empire | null, x: number, star: typeof star0, parent: unknown = null, destroyed = false) => ({
        role: BuiltObjectRole.Base,
        empire,
        xpos: x,
        ypos: 0,
        nearestSystemStar: star,
        parentHabitat: parent,
        hasBeenDestroyed: destroyed,
    });
    const hiddenBase = base(b, 9000, star0);
    const galaxy = {
        systems: [{ systemStar: star0 }, { systemStar: star1 }],
        habitats: [star0, star1, planet(0, a), planet(0, a), planet(1, indep), planet(1, b)],
        builtObjects: [
            base(a, 5000, star0), // in system 0
            base(b, 8000, star0), // in system 0, second empire
            base(b, 0, star0, planet(0, a)), // at a habitat of system 0
            hiddenBase, // not known to the viewer
            base(a, 500_000, star0), // deep space: too far from any star
            base(indep, 1_000_000, star1), // independent: never drawn
            base(a, 1_000_000, star1, null, true), // destroyed
            { ...base(a, 1_000_000, star1), role: BuiltObjectRole.Military }, // a ship, not a station
            null,
        ],
        independentEmpire: indep,
        maxSolarSystemSize: 23000,
    };
    it('counts known bases + colonies per empire per explored system, one entry each, bigger first', () => {
        const out = collectStationPresence(galaxy as never, () => true, (bo) => bo !== (hiddenBase as unknown));
        expect(out.map((p) => [p.systemIndex, p.empire.empireId, p.count])).toEqual([
            [0, 1, 3], // two colonies + one station
            [0, 2, 2], // two known stations (the third is unknown)
            [1, 2, 1], // one colony
        ]);
    });
    it('draws nothing in systems the viewer has not explored', () => {
        const out = collectStationPresence(galaxy as never, (i) => i === 1);
        expect(out.map((p) => [p.systemIndex, p.empire.empireId, p.count])).toEqual([[1, 2, 1]]);
    });
});
