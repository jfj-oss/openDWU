// 19r item 4: threat site markers by reveal level (src/render/threatMarkers.ts) — the look per threat, suspected vs
// confirmed, the fallback shapes, and the geometry helpers; the 19f framework is absent on this branch (presence check).
import { describe, expect, it } from 'vitest';
import {
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_SUSPECTED,
    THREAT_MARKER_KINDS,
    ashPuffs,
    hexLatticeCentres,
    pulsePhase,
    threatMarkerStyle,
    uncertaintyFlicker,
} from '../src/render/threatMarkers';
import { threatFrameworkPresent, threatMarkerRadius } from '../src/render/artBundleLayer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GEN_LIGHT_FLASH, GEN_LIGHT_PERIOD, GEN_SHIPS_ART_DIR, genShipsArtFile, genShipsFileForSubRole, genShipsLightAlpha, genShipsLightPhase, threatArtUrl, type ThreatLooks } from '../src/render/threatArt';
import { GEN_SHIPS_LIGHTS } from '../src/render/genShipsLights';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Empire } from '../src/sim/empire';
import { decodePng } from './helpers/pngDecode';

describe('19r threat marker selection', () => {
    it('the seven looks', () => {
        expect(THREAT_MARKER_KINDS).toEqual({
            greyTide: 'ash',
            cult: 'cultRing',
            silence: 'deadSignal',
            doppelgangers: 'mirror',
            hive: 'hex',
            darkFarms: 'redPulse',
            exchange: 'ledger',
        });
    });
    it('rumours are not drawn; suspected is uncertain, confirmed solid', () => {
        for (const key of Object.keys(THREAT_MARKER_KINDS)) {
            expect(threatMarkerStyle(key, 1, 'colony')).toBeNull();
            const s = threatMarkerStyle(key, KNOWLEDGE_SUSPECTED, 'colony')!;
            const c = threatMarkerStyle(key, KNOWLEDGE_CONFIRMED, 'colony')!;
            expect(s.kind).toBe(THREAT_MARKER_KINDS[key]);
            expect(s.solid).toBe(false);
            expect(s.dashes).toBeGreaterThan(0);
            expect(s.alpha).toBeLessThan(c.alpha);
            expect(c.solid).toBe(true);
            expect(c.dashes).toBe(0);
        }
    });
    it('unknown threats fall back to the framework ring / diamond (amber → red when confirmed)', () => {
        expect(threatMarkerStyle('robotMutiny', 2, 'colony')).toMatchObject({ kind: 'ring', colour: 0xffa020 });
        expect(threatMarkerStyle('robotMutiny', 3, 'ship')).toMatchObject({ kind: 'diamond', colour: 0xff3030 });
    });
    it('suspected flickers within 0.55-1, confirmed is steady', () => {
        for (let t = 0; t < 10; t += 0.37) {
            const f = uncertaintyFlicker(false, t, 3);
            expect(f).toBeGreaterThanOrEqual(0.55);
            expect(f).toBeLessThanOrEqual(1);
            expect(uncertaintyFlicker(true, t, 3)).toBe(1);
        }
        expect(pulsePhase(3.5, 1.4)).toBeCloseTo((3.5 / 1.4) % 1, 9);
    });
    it('geometry: hex cells inside the radius, ash puffs deterministic', () => {
        const cells = hexLatticeCentres(50, 8);
        expect(cells.length).toBeGreaterThan(20);
        for (const c of cells) expect(Math.hypot(c.x, c.y) + 4).toBeLessThanOrEqual(50 + 1e-9);
        expect(ashPuffs(4)).toEqual(ashPuffs(4));
        expect(ashPuffs(4)).not.toEqual(ashPuffs(5));
    });
    it('radius: ships 14 px, colonies at least 18 px', () => {
        const ship = { threat: 'exchange', kind: 'ship' as const, target: { xpos: 0, ypos: 0 }, level: 3, label: '' };
        expect(threatMarkerRadius(ship, 0.5)).toBe(28);
        const col = { threat: 'hive', kind: 'colony' as const, target: { xpos: 0, ypos: 0, diameter: 1 }, level: 3, label: '' };
        expect(threatMarkerRadius(col, 1)).toBeGreaterThanOrEqual(18);
    });
    it('the 19f framework is looked up by presence (absent on this branch → no sites, no error)', () => {
        expect(typeof threatFrameworkPresent()).toBe('boolean');
    });
});

// threatArt.ts: the Generation Ships' bundled shipset (public/art/generation-ships/, scripts/generation-ships-ships.py).
describe('generation ships art', () => {
    const png = (f: string): string => resolve(__dirname, '../public', `${GEN_SHIPS_ART_DIR.slice(1)}${f}.png`);
    const faction = {} as Empire;
    const other = {} as Empire;
    const ship = (subRole: BuiltObjectSubRole, empire: Empire | null, role = BuiltObjectRole.Military): BuiltObject => ({ subRole, role, actualEmpire: empire, isPlanetDestroyer: false }) as unknown as BuiltObject;
    it('every subRole the threat spawns or builds has a frame (the colony ship is the world ship); bases keep stock art', () => {
        const subs = [BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Carrier, BuiltObjectSubRole.TroopTransport, BuiltObjectSubRole.ExplorationShip, BuiltObjectSubRole.ColonyShip, BuiltObjectSubRole.ConstructionShip, BuiltObjectSubRole.LargeFreighter];
        for (const sr of subs) {
            const f = genShipsFileForSubRole(sr);
            expect(f).not.toBeNull();
            expect(existsSync(png(f!))).toBe(true);
            expect(GEN_SHIPS_LIGHTS[f!]?.length ?? 0).toBeGreaterThanOrEqual(4);
        }
        expect(genShipsFileForSubRole(BuiltObjectSubRole.ColonyShip)).toBe('worldship');
        expect(genShipsFileForSubRole(BuiltObjectSubRole.MediumSpacePort)).toBeNull();
        expect(genShipsFileForSubRole(BuiltObjectSubRole.ConstructionShip)).toBe('construction');
        for (const f of Object.keys(GEN_SHIPS_LIGHTS)) expect(f in {}).toBe(false); // no key shadowed by Object.prototype
    });
    it('picked for the factions\' hulls and the world ship under any owner, nothing else', () => {
        const ws = ship(BuiltObjectSubRole.ColonyShip, other);
        const l: ThreatLooks = { genFactions: [faction], worldShips: [ws], swarmFaction: null, mothercore: null, purifierFaction: null, purifierDock: null };
        expect(genShipsArtFile(ws, l)).toBe('worldship');
        expect(genShipsArtFile(ship(BuiltObjectSubRole.Cruiser, faction), l)).toBe('cruiser');
        expect(threatArtUrl(ship(BuiltObjectSubRole.TroopTransport, faction), l)).toBe(`${GEN_SHIPS_ART_DIR}trooptransport.png`);
        expect(genShipsArtFile(ship(BuiltObjectSubRole.Cruiser, other), l)).toBeNull();
        expect(genShipsArtFile(ship(BuiltObjectSubRole.SmallSpacePort, faction, BuiltObjectRole.Base), l)).toBeNull();
        const none: ThreatLooks = { genFactions: [], worldShips: [], swarmFaction: null, mothercore: null, purifierFaction: null, purifierDock: null };
        expect(threatArtUrl(ship(BuiltObjectSubRole.Cruiser, faction), none)).toBeNull();
    });
    it('frames: a lamp housing under every light, thruster marks, no nav-light marks, no opaque black', () => {
        for (const [f, pts] of Object.entries(GEN_SHIPS_LIGHTS)) {
            const img = decodePng(png(f));
            expect(img.width).toBe(img.height);
            const px = (x: number, y: number) => img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4);
            for (const [x, y] of pts) {
                const [r, g, b, a] = px(x, y);
                expect(a, `${f} ${x},${y}`).toBeGreaterThan(200);
                expect(r).toBeGreaterThan(g * 2); // the unlit red lens
                expect(r).toBeGreaterThan(b * 2);
            }
            let blue = 0;
            for (let i = 0; i < img.data.length; i += 4) {
                const [r, g, b, a] = img.data.subarray(i, i + 4);
                if (a === 0) continue;
                if (r === 0 && g === 0 && b === 255) blue++;
                expect(r === 255 && g === 255 && b === 0).toBe(false);
                expect(a === 255 && r === 0 && g === 0 && b === 0).toBe(false);
            }
            expect(blue, f).toBeGreaterThan(0);
        }
    });
    it('red positional lights: a short flash per period, a ripple along the hull, each ship on its own phase', () => {
        const steps = 400;
        let on = 0;
        for (let i = 0; i < steps; i++) {
            const a = genShipsLightAlpha((i / steps) * GEN_LIGHT_PERIOD, 0, 0);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThanOrEqual(1);
            if (a > 0) on++;
        }
        expect(on / steps).toBeCloseTo(GEN_LIGHT_FLASH / GEN_LIGHT_PERIOD, 1);
        expect(genShipsLightAlpha(0.06, 0, 0)).toBeCloseTo(1, 5);
        expect(genShipsLightAlpha(0.06, 1, 0)).toBe(0); // the next light flashes a little later
        expect(genShipsLightAlpha(0.19, 1, 0)).toBeCloseTo(1, 5);
        expect(genShipsLightPhase(1)).not.toBeCloseTo(genShipsLightPhase(2), 2);
        for (const id of [0, 1, 7, 12345]) {
            expect(genShipsLightPhase(id)).toBeGreaterThanOrEqual(0);
            expect(genShipsLightPhase(id)).toBeLessThan(GEN_LIGHT_PERIOD);
        }
    });
});
