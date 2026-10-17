// 19r item 4: threat site markers by reveal level (src/render/threatMarkers.ts) — the look per threat, suspected vs
// confirmed, the fallback shapes, and the geometry helpers; the 19f framework is absent on this branch (presence check).
import { describe, expect, it } from 'vitest';
import {
    GW_COMPACT_THREAT,
    GW_SITE_THREAT,
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_RUMOUR,
    KNOWLEDGE_SUSPECTED,
    THREAT_MARKER_KINDS,
    ashPuffs,
    greatWorkArcFill,
    hexLatticeCentres,
    pulsePhase,
    threatMarkerStyle,
    uncertaintyFlicker,
} from '../src/render/threatMarkers';
import { threatFrameworkPresent, threatMarkerRadius } from '../src/render/artBundleLayer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GEN_LIGHT_FLASH, GEN_LIGHT_PERIOD, GEN_SHIPS_ART_DIR, genShipsArtFile, genShipsFileForSubRole, genShipsLightAlpha, genShipsLightPhase, PURIFIER_VISUAL_SCALE, purifierArtUrl, threatArtUrl, threatDrawScale, type ThreatLooks } from '../src/render/threatArt';
import { GEN_SHIPS_LIGHTS } from '../src/render/genShipsLights';
import {
    BEACON_ART_DIR,
    WATCHER_REF_SIZE,
    WATCHER_VISUAL_SCALE,
    beaconArtFile,
    beaconFileForSubRole,
    BEACON_STATE_KEY,
    beaconLooksActive,
    isReclaimerHull,
    isWatcher,
    minimumSizeScale,
    threatLooks,
    watcherOpenTarget,
} from '../src/render/threatArt';
import { BEACON_FRAMES, WATCHER_ART } from '../src/render/beaconArtData';
import {
    WATCHER_CLOSE_S,
    WATCHER_OPEN_S,
    beaconBeat,
    beaconFrameArt,
    beaconPhase,
    veinBandAlpha,
    watcherPlateLift,
    watcherPlateSwing,
    watcherUnfoldStep,
} from '../src/render/beaconFx';
import type { Galaxy } from '../src/sim/galaxy';
import {
    GIANTWORKS_STATE_KEY,
    GREAT_WORK_WORLD_SIZE,
    GW_ART_DIR,
    SANCTUARY_WHALES,
    greatWorkArtUrl,
    greatWorkAt,
    greatWorkDrawPx,
    greatWorkDrawnFrame,
    greatWorkFrame,
    greatWorkSites,
    gwLightAlpha,
    gwNeonAlpha,
    sanctuaryWhaleCount,
    sanctuaryWhalePose,
    type GreatWorkArtSite,
} from '../src/render/threatArt';
import { GW_LIGHTS, GW_LIGHT_KINDS, GW_SANCTUARY_GLASS_R } from '../src/render/giantworksLights';
import type { Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Empire } from '../src/sim/empire';
import { decodePng } from './helpers/pngDecode';

const SEVEN = ['greyTide', 'cult', 'silence', 'doppelgangers', 'hive', 'darkFarms', 'exchange'];

describe('19r threat marker selection', () => {
    it('the seven looks, and Giantworks\' site and Compact', () => {
        expect(THREAT_MARKER_KINDS).toEqual({
            greyTide: 'ash',
            cult: 'cultRing',
            silence: 'deadSignal',
            doppelgangers: 'mirror',
            hive: 'hex',
            darkFarms: 'redPulse',
            exchange: 'ledger',
            giantworks: 'greatWork',
            giantworksCompact: 'compact',
        });
        expect(GW_SITE_THREAT).toBe('giantworks');
        expect(GW_COMPACT_THREAT).toBe('giantworksCompact');
    });
    it('rumours are not drawn; suspected is uncertain, confirmed solid', () => {
        for (const key of SEVEN) {
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

// The Purifier's escorts and dock (scripts/purifier-ships.py: meshed stock hulls in the planet destroyer's silver /
// champagne / copper with lit antennas, a half-ruined shipyard); the Purifier's planet destroyer a half-built crescent.
describe('purifier art', () => {
    const png = (f: string): string => resolve(__dirname, '../public/art/purifier', `${f}.png`);
    const faction = {} as Empire;
    const other = {} as Empire;
    const bo = (subRole: BuiltObjectSubRole, empire: Empire | null, role = BuiltObjectRole.Military, isPlanetDestroyer = false): BuiltObject =>
        ({ subRole, role, actualEmpire: empire, isPlanetDestroyer }) as unknown as BuiltObject;
    const ESCORTS = ['frigate', 'destroyer', 'cruiser', 'capitalship', 'carrier', 'trooptransport'];
    it('picked by subRole for the faction (the dock base_1, other bases base_0, its planet destroyer the crescent)', () => {
        const dock = bo(BuiltObjectSubRole.GenericBase, faction, BuiltObjectRole.Base);
        const l: ThreatLooks = { genFactions: [], worldShips: [], swarmFaction: null, mothercore: null, purifierFaction: faction, purifierDock: dock };
        const want: [BuiltObjectSubRole, string][] = [
            [BuiltObjectSubRole.Escort, 'frigate'],
            [BuiltObjectSubRole.Frigate, 'frigate'],
            [BuiltObjectSubRole.Destroyer, 'destroyer'],
            [BuiltObjectSubRole.Cruiser, 'cruiser'],
            [BuiltObjectSubRole.CapitalShip, 'capitalship'],
            [BuiltObjectSubRole.Carrier, 'carrier'],
            [BuiltObjectSubRole.TroopTransport, 'trooptransport'],
        ];
        for (const [sr, f] of want) expect(purifierArtUrl(bo(sr, faction), l)).toBe(`/art/purifier/${f}.png`);
        expect(purifierArtUrl(dock, l)).toBe('/art/purifier/base_1.png');
        expect(purifierArtUrl(bo(BuiltObjectSubRole.SmallSpacePort, faction, BuiltObjectRole.Base), l)).toBe('/art/purifier/base_0.png');
        expect(purifierArtUrl(bo(BuiltObjectSubRole.CapitalShip, faction, BuiltObjectRole.Military, true), l)).toBe('/art/purifier/planetdestroyer.png');
        expect(purifierArtUrl(bo(BuiltObjectSubRole.CapitalShip, other, BuiltObjectRole.Military, true), l)).toBeNull(); // other planet destroyers: stock
        expect(threatDrawScale(l, bo(BuiltObjectSubRole.CapitalShip, faction, BuiltObjectRole.Military, true))).toBe(PURIFIER_VISUAL_SCALE);
        expect(threatDrawScale(l, bo(BuiltObjectSubRole.CapitalShip, faction))).toBe(1);
        expect(purifierArtUrl(bo(BuiltObjectSubRole.Cruiser, other), l)).toBeNull();
        expect(purifierArtUrl(bo(BuiltObjectSubRole.ExplorationShip, faction), l)).toBeNull();
    });
    it('frames: square, warm metal, thruster marks on every escort, antenna lights, no opaque black; the dock berth is empty space', () => {
        for (const f of [...ESCORTS, 'base_0', 'base_1', 'planetdestroyer']) {
            const img = decodePng(png(f));
            expect(img.width).toBe(img.height);
            let blue = 0;
            let yellow = 0;
            let n = 0;
            let r0 = 0;
            let b0 = 0;
            for (let i = 0; i < img.data.length; i += 4) {
                const [r, g, b, a] = img.data.subarray(i, i + 4);
                if (a === 0) continue;
                if (r === 0 && g === 0 && b === 255) {
                    blue++;
                    continue;
                }
                if (r === 255 && g === 255 && b === 0) yellow++;
                expect(a === 255 && r === 0 && g === 0 && b === 0, f).toBe(false);
                if (a > 200 && !(r === 255 && g === 255 && b === 0)) {
                    n++;
                    r0 += r;
                    b0 += b;
                }
            }
            if (ESCORTS.includes(f) || f === 'planetdestroyer') expect(blue, f).toBeGreaterThan(0);
            // the antenna tip lights: nav-light markers (blinking like the planet destroyer's), within the scan cap of 20
            expect(yellow, f).toBeGreaterThan(0);
            expect(yellow, f).toBeLessThanOrEqual(20);
            expect(r0 / n, f).toBeGreaterThan((b0 / n) * 1.15); // the planet destroyer's warm metal (red / blue ~1.29), not the stock grey (~1.0)
        }
        const dock = decodePng(png('base_1'));
        const c = (Math.round(dock.height * 0.44) * dock.width + Math.round(dock.width / 2)) * 4;
        expect(dock.data[c + 3]).toBe(0); // where the Purifier slept
        // the Purifier moves: its half-built frame is one connected structure (no loose pieces), alpha > 76, 8-connected
        const pd = decodePng(png('planetdestroyer'));
        const W = pd.width;
        const seen = new Uint8Array(W * pd.height);
        let parts = 0;
        for (let s = 0; s < seen.length; s++) {
            if (seen[s] || pd.data[s * 4 + 3] <= 76) continue;
            parts++;
            const stack = [s];
            seen[s] = 1;
            while (stack.length > 0) {
                const p = stack.pop() as number;
                const x = p % W;
                const y = (p - x) / W;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= W || ny >= pd.height) continue;
                        const q = ny * W + nx;
                        if (!seen[q] && pd.data[q * 4 + 3] > 76) {
                            seen[q] = 1;
                            stack.push(q);
                        }
                    }
                }
            }
        }
        expect(parts).toBe(1);
    });
});

// threatArt.ts / beaconFx.ts: the Beacon's bundled art (Giantworks; public/art/beacon/, scripts/beacon-ships.py).
describe('the Beacon art', () => {
    const png = (f: string): string => resolve(__dirname, '../public', `${BEACON_ART_DIR.slice(1)}${f}.png`);
    const reclaimers = {} as Empire;
    const other = {} as Empire;
    const ship = (subRole: BuiltObjectSubRole, empire: Empire | null, role = BuiltObjectRole.Military, size = 500, currentSpeed = 0): BuiltObject =>
        ({ subRole, role, actualEmpire: empire, isPlanetDestroyer: false, size, currentSpeed, builtObjectID: 7, hasBeenDestroyed: false }) as unknown as BuiltObject;
    const watcher = ship(BuiltObjectSubRole.CapitalShip, other, BuiltObjectRole.Military, 800);
    const beacon = ship(BuiltObjectSubRole.LargeSpacePort, null, BuiltObjectRole.Base, 3000);
    const l: ThreatLooks = { genFactions: [], worldShips: [], swarmFaction: null, mothercore: null, purifierFaction: null, purifierDock: null, reclaimers, watchers: [watcher], watchersSighted: null, beacon };

    it('a frame for every Reclaimer role (warships, the Thrall carriers, the utility ship); bases keep stock art', () => {
        const want: [BuiltObjectSubRole, string][] = [
            [BuiltObjectSubRole.Escort, 'escort'],
            [BuiltObjectSubRole.Frigate, 'frigate'],
            [BuiltObjectSubRole.Destroyer, 'destroyer'],
            [BuiltObjectSubRole.Cruiser, 'cruiser'],
            [BuiltObjectSubRole.CapitalShip, 'capitalship'],
            [BuiltObjectSubRole.Carrier, 'carrier'],
            [BuiltObjectSubRole.TroopTransport, 'trooptransport'],
            [BuiltObjectSubRole.ConstructionShip, 'construction'],
        ];
        for (const [sr, f] of want) {
            expect(beaconFileForSubRole(sr)).toBe(f);
            expect(BEACON_FRAMES[f], f).toBeDefined();
        }
        expect(beaconFileForSubRole(BuiltObjectSubRole.MediumSpacePort)).toBeNull();
        expect(beaconArtFile(ship(BuiltObjectSubRole.Cruiser, reclaimers), l)).toBe('cruiser');
        expect(beaconArtFile(ship(BuiltObjectSubRole.SmallSpacePort, reclaimers, BuiltObjectRole.Base), l)).toBeNull();
        expect(beaconArtFile(ship(BuiltObjectSubRole.Cruiser, other), l)).toBeNull();
        expect(beaconArtFile(watcher, l)).toBe('watcher');
        expect(beaconArtFile(beacon, l)).toBe('beacon');
        expect(isReclaimerHull(ship(BuiltObjectSubRole.Frigate, reclaimers), l)).toBe(true);
        expect(isWatcher(watcher, l)).toBe(true);
        expect(threatArtUrl(ship(BuiltObjectSubRole.Carrier, reclaimers), l)).toBe(`${BEACON_ART_DIR}carrier.png`);
        expect(threatArtUrl(watcher, l)).toBe(`${BEACON_ART_DIR}watcher.png`);
        const none: ThreatLooks = { genFactions: [], worldShips: [], swarmFaction: null, mothercore: null, purifierFaction: null, purifierDock: null };
        expect(beaconLooksActive(none)).toBe(false);
        expect(threatArtUrl(ship(BuiltObjectSubRole.Cruiser, reclaimers), none)).toBeNull();
        for (const f of Object.keys(BEACON_FRAMES)) expect(f in {}).toBe(false);
    });

    it('the Watchers and the Beacon are drawn at least a set size; a bigger hull keeps its own', () => {
        expect(threatDrawScale(l, watcher)).toBeCloseTo(minimumSizeScale(800, WATCHER_REF_SIZE, WATCHER_VISUAL_SCALE), 9);
        expect(threatDrawScale(l, watcher)).toBeGreaterThan(2);
        expect(threatDrawScale(l, beacon)).toBeGreaterThanOrEqual(1);
        expect(threatDrawScale(l, ship(BuiltObjectSubRole.Cruiser, reclaimers))).toBe(1);
        expect(minimumSizeScale(1e7, WATCHER_REF_SIZE, WATCHER_VISUAL_SCALE)).toBe(1);
        // the drawn size (∝ sqrt(size) × scale) is the same for any hull below the floor
        const drawn = (size: number): number => Math.sqrt(size) * minimumSizeScale(size, WATCHER_REF_SIZE, WATCHER_VISUAL_SCALE);
        expect(drawn(300)).toBeCloseTo(drawn(1200), 6);
        expect(watcherOpenTarget(watcher, l)).toBe(true); // no sighted list: open while it sits still
        expect(watcherOpenTarget(ship(BuiltObjectSubRole.CapitalShip, other, BuiltObjectRole.Military, 800, 30), { ...l, watchersSighted: null })).toBe(false);
        expect(watcherOpenTarget(watcher, { ...l, watchersSighted: [] })).toBe(false);
        expect(watcherOpenTarget(watcher, { ...l, watchersSighted: [watcher] })).toBe(true);
    });

    it('frames: square, the heart at the centre of the content box, pulse layers inside their atlas, no markers, no opaque black', () => {
        for (const [f, art] of [...Object.entries(BEACON_FRAMES), ['watcher', WATCHER_ART] as const]) {
            const img = decodePng(png(f));
            expect(img.width, f).toBe(art.size);
            expect(img.height, f).toBe(art.size);
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            let blue = 0, yellow = 0, black = 0;
            const d = img.data;
            for (let y = 0; y < img.height; y++) {
                for (let x = 0; x < img.width; x++) {
                    const i = (y * img.width + x) * 4;
                    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
                    if (a === 0) continue;
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                    if (r === 0 && g === 0 && b === 255) blue++;
                    if (r === 255 && g === 255 && b === 0) yellow++;
                    if (a === 255 && r === 0 && g === 0 && b === 0) black++;
                }
            }
            expect(blue, `${f} blue`).toBe(0);
            expect(yellow, `${f} yellow`).toBe(0);
            expect(black, `${f} black`).toBe(0);
            // the content box centred on the heart (the game turns a frame about its content box's centre), off the edges
            expect(Math.abs((x0 + x1) / 2 - art.core[0]), f).toBeLessThanOrEqual(1);
            expect(Math.abs((y0 + y1) / 2 - art.core[1]), f).toBeLessThanOrEqual(1);
            expect(Math.min(x0, y0, img.width - 1 - x1, img.height - 1 - y1), f).toBeGreaterThanOrEqual(4);
            // the heart is red and bright
            const ci = (Math.round(art.core[1]) * img.width + Math.round(art.core[0])) * 4;
            expect(img.data[ci], f).toBeGreaterThan(200);
            expect(img.data[ci], f).toBeGreaterThan(img.data[ci + 2]);
            const fx = decodePng(png(`${f}-fx`));
            const rects = [art.organs, ...art.veins, ...(f === 'watcher' ? [WATCHER_ART.seams, ...WATCHER_ART.plates.map((p) => p.glow)] : [])];
            for (const r of rects) {
                expect(r.x + r.w, f).toBeLessThanOrEqual(fx.width);
                expect(r.y + r.h, f).toBeLessThanOrEqual(fx.height);
                expect(r.dx + r.w, f).toBeLessThanOrEqual(art.size);
                expect(r.dy + r.h, f).toBeLessThanOrEqual(art.size);
            }
            // the vein bands run outward: the outermost band reaches further than the innermost
            expect(art.veins[2].w * art.veins[2].h, f).toBeGreaterThan(art.veins[0].w * art.veins[0].h);
        }
    });

    it('the Watcher: its open body and plates on the pod\'s canvas; open, the plates stay on the canvas', () => {
        const body = decodePng(png('watcher-body'));
        expect(body.width).toBe(WATCHER_ART.size);
        WATCHER_ART.plates.forEach((p, k) => {
            const img = decodePng(png(`watcher-plate-${k}`));
            expect(img.width).toBe(p.w);
            expect(img.height).toBe(p.h);
            for (const t of [0, 0.5, 1]) {
                const a = WATCHER_ART.swing * t;
                for (const [cx, cy] of [[p.dx, p.dy], [p.dx + p.w, p.dy], [p.dx, p.dy + p.h], [p.dx + p.w, p.dy + p.h]]) {
                    const x = p.hinge[0] + (cx - p.hinge[0]) * Math.cos(a) - (cy - p.hinge[1]) * Math.sin(a);
                    const y = p.hinge[1] + (cx - p.hinge[0]) * Math.sin(a) + (cy - p.hinge[1]) * Math.cos(a);
                    // a corner of the plate's box (the plate itself is inside it) reaches at most a little off the canvas
                    expect(Math.hypot(x - WATCHER_ART.size / 2, y - WATCHER_ART.size / 2)).toBeLessThan(WATCHER_ART.size * 0.62);
                }
            }
        });
    });

    it('reads the Beacon sim\'s state bag: the faction, the Watchers (records with modes, or ships), the Beacon', () => {
        const w1 = ship(BuiltObjectSubRole.CapitalShip, reclaimers, BuiltObjectRole.Military, 800, 30);
        const w2 = ship(BuiltObjectSubRole.CapitalShip, reclaimers, BuiltObjectRole.Military, 800, 0);
        const g = (state: Record<string, unknown>): Galaxy => ({ scenario: { state } }) as unknown as Galaxy;
        let lk = threatLooks(g({ [BEACON_STATE_KEY]: { faction: reclaimers, watchers: [{ ship: w1, mode: 'travel' }, { ship: w2, mode: 'sighting' }, { ship: null, mode: 'dead' }], beacon } }));
        expect(lk.reclaimers).toBe(reclaimers);
        expect(lk.watchers).toEqual([w1, w2]);
        expect(lk.beacon).toBe(beacon);
        expect(beaconArtFile(w1, lk)).toBe('watcher'); // a Watcher before its faction's ship role
        expect(watcherOpenTarget(w1, lk)).toBe(false);
        expect(watcherOpenTarget(w2, lk)).toBe(true);
        lk = threatLooks(g({ [BEACON_STATE_KEY]: { faction: reclaimers, watchers: [{ ship: w1, mode: 'fight' }, { ship: w2, mode: 'parked' }] } }));
        expect(watcherOpenTarget(w1, lk)).toBe(true);
        expect(watcherOpenTarget(w2, lk)).toBe(false);
        lk = threatLooks(g({ [BEACON_STATE_KEY]: { watchers: [w1, w2] } }));
        expect(lk.watchersSighted).toBeNull();
        expect(watcherOpenTarget(w1, lk)).toBe(false); // moving
        expect(watcherOpenTarget(w2, lk)).toBe(true); // sitting still
        lk = threatLooks(g({ [BEACON_STATE_KEY]: { watchers: [w1, w2], sighted: [w1] } }));
        expect(watcherOpenTarget(w1, lk)).toBe(true);
        expect(watcherOpenTarget(w2, lk)).toBe(false);
        lk = threatLooks(g({}));
        expect(beaconLooksActive(lk)).toBe(false);
        expect(lk.watchers).toEqual([]);
    });

    it('the heartbeat: a strong beat then a weaker one, quiet in between, each hull on its own phase', () => {
        const P = 2;
        let max = 0;
        for (let i = 0; i < 400; i++) {
            const b = beaconBeat((i / 400) * P, P);
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThanOrEqual(1);
            max = Math.max(max, b);
        }
        expect(max).toBeCloseTo(1, 5);
        expect(beaconBeat(0.06 * P, P)).toBeCloseTo(1, 5);
        expect(beaconBeat(0.26 * P, P)).toBeCloseTo(0.6, 5);
        expect(beaconBeat(0.8 * P, P)).toBeLessThan(0.05);
        expect(beaconBeat(0.06 * P + P * 3, P)).toBeCloseTo(1, 5); // periodic
        expect(beaconPhase(1, P)).not.toBeCloseTo(beaconPhase(2, P), 2);
        // the pulse runs outward: band k is brightest a little after band k - 1
        const peak = (k: number): number => {
            let best = 0, at = 0;
            for (let i = 0; i < 400; i++) {
                const t = (i / 400) * P;
                const v = veinBandAlpha(t, P, 0, k);
                if (v > best) [best, at] = [v, t];
            }
            return at;
        };
        expect(peak(1)).toBeGreaterThan(peak(0));
        expect(peak(2)).toBeGreaterThan(peak(1));
    });

    it('the Watcher unfolds: lifts, then swings out plate by plate; opens over 10 s, folds over 7 s', () => {
        for (let k = 0; k < 3; k++) {
            expect(watcherPlateSwing(0, k)).toBe(0);
            expect(watcherPlateLift(0, k)).toBe(0);
            expect(watcherPlateSwing(1, k)).toBe(1);
            let last = 0;
            for (let u = 0; u <= 1.0001; u += 0.05) {
                const s = watcherPlateSwing(u, k);
                expect(s).toBeGreaterThanOrEqual(last);
                last = s;
            }
        }
        expect(watcherPlateLift(0.15, 0)).toBeGreaterThan(watcherPlateSwing(0.15, 0)); // up off the body before it swings
        expect(watcherPlateSwing(0.5, 0)).toBeGreaterThan(watcherPlateSwing(0.5, 2)); // one after another
        let u = 0;
        for (let i = 0; i < 100; i++) u = watcherUnfoldStep(u, true, WATCHER_OPEN_S / 100);
        expect(u).toBeCloseTo(1, 9);
        for (let i = 0; i < 50; i++) u = watcherUnfoldStep(u, false, WATCHER_CLOSE_S / 100);
        expect(u).toBeCloseTo(0.5, 9);
        expect(WATCHER_OPEN_S).toBe(10);
        expect(WATCHER_CLOSE_S).toBe(7);
        expect(beaconFrameArt('watcher')).toBe(WATCHER_ART);
        expect(beaconFrameArt('nope')).toBeNull();
    });
});

// threatArt.ts: Giantworks — the Great Work's scaffold stages and finished wonders (public/art/giantworks/,
// scripts/giantworks-art.py), its lights, the Sanctuary's whales, and the map glyphs (threatMarkers.ts).
describe('giantworks art', () => {
    const png = (f: string): string => resolve(__dirname, '../public', `${GW_ART_DIR.slice(1)}${f}.png`);
    const FRAMES = ['scaffold_0', 'scaffold_1', 'scaffold_2', 'scaffold_3', 'casino', 'ultramind', 'ultramind-node', 'sanctuary'];
    const site = (stage: number, wonder: string, habitat: Habitat | null = null): GreatWorkArtSite => ({ base: null, stage, wonder, habitat });
    it('the scaffold of each stage is shared by every wonder; complete, the wonder\'s own frame', () => {
        for (const w of ['casino', 'ultramind', 'sanctuary', 'beacon', 'riftGate']) {
            for (let s = 0; s < 4; s++) expect(greatWorkFrame(site(s, w))).toBe(`scaffold_${s}`);
        }
        expect(greatWorkFrame(site(4, 'casino'))).toBe('casino');
        expect(greatWorkFrame(site(4, 'ultramind'))).toBe('ultramind');
        expect(greatWorkFrame(site(4, 'ultramind', {} as Habitat))).toBe('ultramind-node');
        expect(greatWorkFrame(site(4, 'sanctuary'))).toBe('sanctuary');
        expect(greatWorkFrame(site(4, 'riftGate'))).toBe('scaffold_3'); // no art of its own yet
        // a finished Beacon is drawn by the Beacon's own art and paths, not the Great Work's
        expect(greatWorkFrame(site(4, 'beacon'))).toBe('beacon');
        expect(greatWorkDrawnFrame(site(4, 'beacon'))).toBeNull();
        expect(greatWorkDrawnFrame(site(4, 'casino'))).toBe('casino');
        expect(greatWorkDrawnFrame(site(2, 'beacon'))).toBe('scaffold_2');
        expect(greatWorkFrame(site(-1, 'casino'))).toBe('scaffold_0');
        expect(greatWorkFrame(site(Number.NaN, 'casino'))).toBe('scaffold_0');
    });
    it('one fixed world size per frame (the node half), whatever the base', () => {
        expect(greatWorkDrawPx('scaffold_2', 1)).toBe(GREAT_WORK_WORLD_SIZE);
        expect(greatWorkDrawPx('casino', 4)).toBe(GREAT_WORK_WORLD_SIZE / 4);
        expect(greatWorkDrawPx('ultramind-node', 1)).toBe(GREAT_WORK_WORLD_SIZE / 2);
        expect(greatWorkDrawPx('toString', 1)).toBe(GREAT_WORK_WORLD_SIZE); // no prototype key taken for a scale
    });
    it('frames: square, the crop square is the whole frame, no opaque black or marker colours, one connected body', () => {
        const files = [...FRAMES, 'sanctuary-front', 'ultramind-shell', 'casino-neon-a', 'casino-neon-b', 'ultramind-glow', 'ultramind-node-glow', 'ultramind-shell-glow'];
        for (const f of files) {
            expect(existsSync(png(f)), f).toBe(true);
            const img = decodePng(png(f));
            expect(img.width).toBe(img.height);
            const W = img.width;
            const a = (x: number, y: number): number => img.data[(y * W + x) * 4 + 3];
            if (FRAMES.includes(f)) {
                // registration pixels: shipImageMetrics' crop is the whole texture, so every frame shares one centre
                expect(a(4, 4), f).toBeGreaterThan(0);
                expect(a(W - 5, W - 5), f).toBeGreaterThan(0);
            }
            let bad = 0;
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] === 0) continue;
                if ((d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 0) || (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 255)) bad++;
                else if (d[i + 3] === 255 && d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) bad++;
            }
            expect(bad, f).toBe(0);
            if (!FRAMES.includes(f)) continue;
            // no loose pieces: every solid pixel reachable from the centre through the structure
            const seen = new Uint8Array(W * W);
            const stack = [((W >> 1) * W + (W >> 1))];
            seen[stack[0]] = 1;
            while (stack.length > 0) {
                const p = stack.pop()!;
                const x = p % W;
                const y = (p - x) / W;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
                        const q = ny * W + nx;
                        if (seen[q] === 0 && a(nx, ny) > 20) {
                            seen[q] = 1;
                            stack.push(q);
                        }
                    }
                }
            }
            let loose = 0;
            for (let p = 0; p < W * W; p++) if (seen[p] === 0 && img.data[p * 4 + 3] > 128) loose++;
            expect(loose, f).toBeLessThan(12);
        }
    });
    it('lights: on the structure, known kinds; every frame lit', () => {
        for (const f of FRAMES) {
            const pts = GW_LIGHTS[f.replace('-', '_')];
            expect(pts?.length ?? 0, f).toBeGreaterThanOrEqual(6);
            const img = decodePng(png(f));
            for (const [x, y, k] of pts) {
                expect(img.data[(y * img.width + x) * 4 + 3], `${f} ${x},${y}`).toBeGreaterThan(120);
                expect(k).toBeGreaterThanOrEqual(0);
                expect(k).toBeLessThan(GW_LIGHT_KINDS.length);
            }
        }
        // the stages grow: more lights as the work goes on
        expect(GW_LIGHTS.scaffold_3.length).toBeGreaterThan(GW_LIGHTS.scaffold_0.length);
        for (const f of Object.keys(GW_LIGHTS)) expect(f in {}).toBe(false);
    });
    it('light patterns stay in 0..1; nav lights flash; the neon sets take turns', () => {
        for (let kind = 0; kind < GW_LIGHT_KINDS.length; kind++) {
            for (let t = 0; t < 12; t += 0.07) {
                const v = gwLightAlpha(kind, t, 3, 20);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            }
        }
        const nav = GW_LIGHT_KINDS.indexOf('nav');
        let on = 0;
        for (let i = 0; i < 480; i++) if (gwLightAlpha(nav, (i / 480) * 2.4, 0, 1) > 0) on++;
        expect(on / 480).toBeGreaterThan(0.1);
        expect(on / 480).toBeLessThan(0.3);
        // A and B in counter-phase: when one is at its brightest the other is dim
        const ts = [0.275, 0.825];
        expect(gwNeonAlpha(ts[0], false)).toBeGreaterThan(gwNeonAlpha(ts[0], true));
        expect(gwNeonAlpha(ts[1], true)).toBeGreaterThan(gwNeonAlpha(ts[1], false));
    });
    it('the Sanctuary\'s whales swim inside the glass, and move', () => {
        expect(GW_SANCTUARY_GLASS_R).toBeGreaterThan(100);
        for (const w of SANCTUARY_WHALES) {
            let moved = 0;
            let prev = sanctuaryWhalePose(w, 0);
            for (let t = 0.5; t < 120; t += 0.5) {
                const p = sanctuaryWhalePose(w, t);
                // its centre well inside, its body (half its length) at most grazing the rim (the mask clips it there)
                expect(Math.hypot(p.x, p.y) + w.len * 0.3).toBeLessThan(1.02);
                moved += Math.hypot(p.x - prev.x, p.y - prev.y);
                // swimming head first: the heading follows the path
                const ahead = sanctuaryWhalePose(w, t + 0.05);
                const dir = Math.atan2(ahead.y - p.y, ahead.x - p.x);
                expect(Math.abs(Math.atan2(Math.sin(dir - p.heading), Math.cos(dir - p.heading)))).toBeLessThan(0.1);
                prev = p;
            }
            expect(moved).toBeGreaterThan(1);
        }
        // a few whales of different sizes; the count follows the site (default 4)
        expect(new Set(SANCTUARY_WHALES.map((w) => w.len)).size).toBe(SANCTUARY_WHALES.length);
        expect(sanctuaryWhaleCount({})).toBe(4);
        expect(sanctuaryWhaleCount({ whales: 0 })).toBe(1);
        expect(sanctuaryWhaleCount({ whales: 99 })).toBe(SANCTUARY_WHALES.length);
    });
    it('sites are read from the add-on\'s state by their base; the Ultramind\'s planet once complete', () => {
        const base = { hasBeenDestroyed: false } as unknown as BuiltObject;
        const gone = { hasBeenDestroyed: true } as unknown as BuiltObject;
        const planet = { xpos: 1, ypos: 2 } as unknown as Habitat;
        const sites: GreatWorkArtSite[] = [
            { base, stage: 4, wonder: 'ultramind', habitat: planet, progress: 1 },
            { base: gone, stage: 2, wonder: 'casino', habitat: null },
        ];
        const galaxy = { scenario: { state: { [GIANTWORKS_STATE_KEY]: { sites } } } } as unknown as Galaxy;
        expect(greatWorkSites(galaxy)).toBe(sites);
        expect(greatWorkSites({ scenario: null } as unknown as Galaxy)).toEqual([]);
        expect(greatWorkSites({ scenario: { state: {} } } as unknown as Galaxy)).toEqual([]);
        const l = threatLooks(galaxy);
        expect(l.greatWorks!.get(base)).toBe(sites[0]);
        expect(l.greatWorks!.has(gone)).toBe(false);
        expect(l.ultramindPlanets!.get(planet)).toBe(sites[0]);
        expect(greatWorkArtUrl(base, l)).toBe(`${GW_ART_DIR}ultramind-node.png`);
        expect(threatArtUrl(base, l)).toBe(`${GW_ART_DIR}ultramind-node.png`);
        expect(greatWorkAt(planet, l)).toBe(sites[0]);
        expect(greatWorkAt(base, l)).toBe(sites[0]);
        sites[0].stage = 3;
        const l2 = threatLooks(galaxy);
        expect(l2.ultramindPlanets!.size).toBe(0); // not wrapped before it is finished
        expect(threatArtUrl(base, l2)).toBe(`${GW_ART_DIR}scaffold_3.png`);
        // a finished Beacon wonder is the Beacon (its art and size floor) when the Beacon's sim names none
        sites[0].stage = 4;
        sites[0].wonder = 'beacon';
        const l3 = threatLooks(galaxy);
        expect(l3.beacon).toBe(base);
        expect(beaconLooksActive(l3)).toBe(true);
        expect(threatArtUrl(base, l3)).toBe(`${BEACON_ART_DIR}beacon.png`);
        threatLooks({ scenario: null } as unknown as Galaxy);
    });
    it('map glyphs: the site from the rumour on (always solid), the Compact faint at rumour, sure from suspected', () => {
        expect(threatMarkerStyle(GW_SITE_THREAT, 0, 'ship')).toBeNull();
        expect(threatMarkerStyle(GW_SITE_THREAT, KNOWLEDGE_RUMOUR, 'ship')).toMatchObject({ kind: 'greatWork', solid: true, dashes: 0 });
        expect(threatMarkerStyle(GW_COMPACT_THREAT, 0, 'colony')).toBeNull();
        const faint = threatMarkerStyle(GW_COMPACT_THREAT, KNOWLEDGE_RUMOUR, 'colony')!;
        const sure = threatMarkerStyle(GW_COMPACT_THREAT, KNOWLEDGE_SUSPECTED, 'colony')!;
        expect(faint).toMatchObject({ kind: 'compact', solid: false });
        expect(faint.alpha).toBeLessThan(sure.alpha);
        expect(sure).toMatchObject({ kind: 'compact', solid: true, dashes: 0 });
        // the four stage arcs fill in order with the progress
        expect([0, 1, 2, 3].map((q) => greatWorkArcFill(0, q))).toEqual([0, 0, 0, 0]);
        expect([0, 1, 2, 3].map((q) => greatWorkArcFill(0.375, q))).toEqual([1, 0.5, 0, 0]);
        expect([0, 1, 2, 3].map((q) => greatWorkArcFill(1, q))).toEqual([1, 1, 1, 1]);
        expect(threatMarkerStyle('toString', 2, 'colony')).toMatchObject({ kind: 'ring' });
    });
});
