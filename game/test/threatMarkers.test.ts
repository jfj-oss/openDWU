// 19r item 4: threat site markers by reveal level (src/render/threatMarkers.ts) — the look per threat, suspected vs
// confirmed, the fallback shapes, and the geometry helpers; the 19f framework is absent on this branch (presence check).
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
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
    beaconBreath,
    beaconFrameArt,
    beaconPhase,
    watcherHeat,
    watcherPartLift,
    watcherPartSwing,
    watcherStartedOpening,
    watcherUnfoldStep,
} from '../src/render/beaconFx';
import { HORN_COOLDOWN_S, HORN_SAME_WATCHER_S, HORN_URL, hornAllowed, hornLevel } from '../src/audio/beaconHorn';
import { readFileSync } from 'node:fs';
import type { Galaxy } from '../src/sim/galaxy';
import {
    CASINO_BAD,
    CASINO_BALL_PERIOD,
    CASINO_BLINK,
    CASINO_BUZZ,
    CASINO_DEAD,
    CASINO_SEQ,
    CASINO_STATE_KEY,
    GIANTWORKS_STATE_KEY,
    GREAT_WORK_WORLD_SIZE,
    GW_ART_DIR,
    SANCTUARY_WHALES,
    casinoBallPos,
    casinoLaneFade,
    casinoLaneShip,
    casinoLaneShips,
    casinoNeonAlpha,
    casinoRotorAngle,
    greatWorkArtUrl,
    greatWorkAt,
    greatWorkDrawPx,
    greatWorkDrawnFrame,
    greatWorkFrame,
    greatWorkSites,
    gwLightAlpha,
    SANCTUARY_SPILL_LEN,
    SANCTUARY_SPILL_PUFFS,
    sanctuaryAlarmPulse,
    sanctuaryBreached,
    sanctuaryEmergencyAlpha,
    sanctuarySpillPuff,
    gwRackAlpha,
    gwTracePulse,
    gwUltramindPulse,
    ultramindLookFor,
    greatWorkDrawPxOf,
    ULTRAMIND_CUBE_COVER,
    sanctuaryWhaleCount,
    sanctuaryWhalePose,
    type GreatWorkArtSite,
    ARK_STATE_KEY,
    arkRecordOf,
} from '../src/render/threatArt';
import { ARK_BAND_SLICES, ARK_SPIN, arkBandSliceAlpha, arkDrawScale, arkEngineAft, arkEnginePower, arkFighting, arkIrisFrames, arkMode, arkSpin, arkTargetPos } from '../src/render/arkFx';
import { ARK_LOOK } from '../src/render/arkLights';
import { ARK_KEY, ARK_REF_SIZE, ARK_VISUAL_SCALE } from '../src/sim/scenario/threats/giantworks/ark';
import { GW_CASINO_LOOKS, GW_LIGHTS, GW_LIGHT_KINDS, GW_SANCTUARY_GLASS_R, GW_UM_RACKS, GW_UM_TRACES } from '../src/render/giantworksLights';
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

    it('frames: square, the content box centred, light layers inside their atlas, no markers, no opaque black', () => {
        for (const [f, art] of [...Object.entries(BEACON_FRAMES), ['watcher', WATCHER_ART] as const]) {
            const img = decodePng(png(f));
            expect(img.width, f).toBe(art.size);
            expect(img.height, f).toBe(art.size);
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            let blue = 0, yellow = 0, black = 0, cyan = 0;
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
                    if (a > 200 && b > r + 40 && g > r + 20 && b > 90) cyan++;
                }
            }
            expect(blue, `${f} blue`).toBe(0);
            expect(yellow, `${f} yellow`).toBe(0);
            expect(black, `${f} black`).toBe(0);
            // the content box centred on the frame (the game turns a frame about its content box's centre), off the edges
            expect(Math.abs((x0 + x1) / 2 - art.size / 2), f).toBeLessThanOrEqual(1);
            expect(Math.abs((y0 + y1) / 2 - art.size / 2), f).toBeLessThanOrEqual(1);
            expect(Math.min(x0, y0, img.width - 1 - x1, img.height - 1 - y1), f).toBeGreaterThanOrEqual(4);
            // every frame carries the faction's cyan light lines
            expect(cyan, `${f} cyan`).toBeGreaterThan(5);
            const fx = decodePng(png(`${f}-fx`));
            const rects = [art.glow, ...(f === 'watcher' ? [WATCHER_ART.sockets] : [])];
            for (const r of rects) {
                expect(r.x + r.w, f).toBeLessThanOrEqual(fx.width);
                expect(r.y + r.h, f).toBeLessThanOrEqual(fx.height);
                expect(r.dx + r.w, f).toBeLessThanOrEqual(art.size);
                expect(r.dy + r.h, f).toBeLessThanOrEqual(art.size);
            }
        }
    });

    it('the Watcher: its open body and parts on its canvas; closed it is the reference; open, the parts stay on the canvas', () => {
        const body = decodePng(png('watcher-body'));
        const closed = decodePng(png('watcher'));
        expect(body.width).toBe(WATCHER_ART.size);
        const parts = decodePng(png('watcher-parts'));
        expect(WATCHER_ART.parts.length).toBeGreaterThanOrEqual(8); // two horns and six legs at least
        // the closed frame is the body with every part at rest over it: away from the flank plates the body's pixels
        // are the closed frame's wherever the body is opaque
        let same = 0, n = 0;
        for (let i = 0; i < closed.data.length; i += 4) {
            if (body.data[i + 3] === 255 && closed.data[i + 3] === 255) {
                n++;
                if (body.data[i] === closed.data[i] && body.data[i + 1] === closed.data[i + 1] && body.data[i + 2] === closed.data[i + 2]) same++;
            }
        }
        expect(same / n).toBeGreaterThan(0.8);
        for (const p of WATCHER_ART.parts) {
            expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(parts.width);
            expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(parts.height);
            expect(p.delay).toBeGreaterThanOrEqual(0);
            expect(p.delay).toBeLessThan(1);
            for (const t of [0, 0.5, 1]) {
                const a = p.swing * t;
                const r = p.rect;
                for (const [cx, cy] of [[r.dx, r.dy], [r.dx + r.w, r.dy], [r.dx, r.dy + r.h], [r.dx + r.w, r.dy + r.h]]) {
                    const x = p.hinge[0] + (cx - p.hinge[0]) * Math.cos(a) - (cy - p.hinge[1]) * Math.sin(a);
                    const y = p.hinge[1] + (cx - p.hinge[0]) * Math.sin(a) + (cy - p.hinge[1]) * Math.cos(a);
                    // a corner of the part's box (the part itself is inside it) stays on the canvas
                    expect(x).toBeGreaterThan(-4);
                    expect(y).toBeGreaterThan(-4);
                    expect(x).toBeLessThan(WATCHER_ART.size + 4);
                    expect(y).toBeLessThan(WATCHER_ART.size + 4);
                }
            }
        }
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

    it('the breath: a slow swell and ebb, lingering low, each hull on its own phase', () => {
        const P = 8;
        let max = 0, low = 0;
        for (let i = 0; i < 400; i++) {
            const b = beaconBreath((i / 400) * P, P);
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThanOrEqual(1);
            max = Math.max(max, b);
            if (b < 0.25) low++;
        }
        expect(max).toBeCloseTo(1, 3);
        expect(beaconBreath(0.5 * P, P)).toBeCloseTo(1, 5);
        expect(beaconBreath(0, P)).toBeCloseTo(0, 5);
        expect(beaconBreath(0.5 * P + 3 * P, P)).toBeCloseTo(1, 5); // periodic
        expect(low / 400).toBeGreaterThan(0.3); // a long lull
        expect(beaconPhase(1, P)).not.toBeCloseTo(beaconPhase(2, P), 2);
        for (const art of [...Object.values(BEACON_FRAMES), WATCHER_ART]) expect(art.breath).toBeGreaterThan(3);
    });

    it('the Watcher unfolds: each part lifts, then swings out, one after another; opens over 10 s, folds over 7 s', () => {
        for (const d of [0, 0.2, 0.5]) {
            expect(watcherPartSwing(0, d)).toBe(0);
            expect(watcherPartLift(0, d)).toBe(0);
            expect(watcherPartSwing(1, d)).toBe(1);
            let last = 0;
            for (let u = 0; u <= 1.0001; u += 0.05) {
                const s = watcherPartSwing(u, d);
                expect(s).toBeGreaterThanOrEqual(last);
                last = s;
            }
        }
        expect(watcherPartLift(0.15, 0)).toBeGreaterThan(watcherPartSwing(0.15, 0)); // up off the body before it swings
        expect(watcherPartSwing(0.5, 0)).toBeGreaterThan(watcherPartSwing(0.5, 0.3)); // one after another
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

    it('the Watcher heats as it opens: its lines red-orange over the cyan, on the body and on each part\'s own box', () => {
        expect(watcherHeat(0)).toBe(0);
        expect(watcherHeat(1)).toBe(1);
        let last = 0;
        for (let u = 0; u <= 1.0001; u += 0.05) {
            expect(watcherHeat(u)).toBeGreaterThanOrEqual(last);
            last = watcherHeat(u);
        }
        const hot = decodePng(png('watcher-hot'));
        const fx = decodePng(png('watcher-fx'));
        for (const r of [WATCHER_ART.hot]) {
            expect(r.x + r.w).toBeLessThanOrEqual(hot.width);
            expect(r.y + r.h).toBeLessThanOrEqual(hot.height);
        }
        expect(WATCHER_ART.warm.y + WATCHER_ART.warm.h).toBeLessThanOrEqual(fx.height);
        let partsWithLines = 0;
        for (const p of WATCHER_ART.parts) {
            if (p.hot === null) continue;
            partsWithLines++;
            expect(p.hot.y + p.hot.h).toBeLessThanOrEqual(hot.height);
            // the same box as the part, so it turns with it
            expect([p.hot.w, p.hot.h, p.hot.dx, p.hot.dy]).toEqual([p.rect.w, p.rect.h, p.rect.dx, p.rect.dy]);
        }
        expect(partsWithLines).toBeGreaterThan(0);
        // the overlay is red-orange (red over blue) wherever it shows
        let warmPx = 0, coldPx = 0;
        const r0 = WATCHER_ART.hot;
        for (let y = r0.y; y < r0.y + r0.h; y++) {
            for (let x = r0.x; x < r0.x + r0.w; x++) {
                const i = (y * hot.width + x) * 4;
                if (hot.data[i + 3] < 128) continue;
                if (hot.data[i] > hot.data[i + 2] + 60) warmPx++;
                else coldPx++;
            }
        }
        expect(warmPx).toBeGreaterThan(20);
        expect(coldPx).toBe(0);
    });

    it('the Watcher\'s horn: cued once as it starts opening, by distance and zoom, with cooldowns; our own sound file', () => {
        expect(watcherStartedOpening(0, 0.01, true)).toBe(true);
        expect(watcherStartedOpening(0.2, 0.21, true)).toBe(false); // already opening
        expect(watcherStartedOpening(0, 0, true)).toBe(false);
        expect(watcherStartedOpening(0.01, 0, false)).toBe(false); // closing
        const view = { x: 0, y: 0, zoom: 1 / 20, width: 1600, height: 1000 };
        const centre = hornLevel(0, 0, view);
        expect(centre.level).toBeCloseTo(1, 6);
        expect(centre.pan).toBeCloseTo(0, 6);
        const edge = hornLevel(800 * 20, 0, view); // the right edge of the screen
        expect(edge.level).toBeGreaterThan(0.2);
        expect(edge.level).toBeLessThan(centre.level);
        expect(edge.pan).toBeGreaterThan(0.5);
        expect(hornLevel(800 * 20 * 3, 0, view).level).toBe(0); // well off screen
        expect(hornLevel(0, 0, { ...view, zoom: 1 / 2000 }).level).toBe(0); // the galaxy view
        expect(hornAllowed(100, -Infinity, undefined)).toBe(true);
        expect(hornAllowed(100, 100 - HORN_COOLDOWN_S + 1, undefined)).toBe(false); // the global cooldown
        expect(hornAllowed(100, -Infinity, 100 - HORN_SAME_WATCHER_S + 1)).toBe(false); // the same Watcher again
        expect(hornAllowed(100, 100 - HORN_COOLDOWN_S, 100 - HORN_SAME_WATCHER_S)).toBe(true);
        const ogg = readFileSync(resolve(__dirname, '../public', HORN_URL.slice(1)));
        expect(ogg.subarray(0, 4).toString('latin1')).toBe('OggS');
        expect(ogg.length).toBeGreaterThan(20000);
    });
});

// threatArt.ts: Giantworks — the Great Work's scaffold stages and finished wonders (public/art/giantworks/,
// scripts/giantworks-art.py), its lights, the Sanctuary's whales, and the map glyphs (threatMarkers.ts).
describe('giantworks art', () => {
    const png = (f: string): string => resolve(__dirname, '../public', `${GW_ART_DIR.slice(1)}${f}.png`);
    const FRAMES = ['scaffold_0', 'scaffold_1', 'scaffold_2', 'scaffold_3', 'casino', 'casino-pirate', 'ultramind', 'ultramind-awake', 'ultramind-node', 'ultramind-node-awake', 'sanctuary'];
    const UM_FRAMES = ['ultramind', 'ultramind-awake', 'ultramind-node', 'ultramind-node-awake'];
    const site = (stage: number, wonder: string, habitat: Habitat | null = null): GreatWorkArtSite => ({ base: null, stage, wonder, habitat });
    it('the scaffold of each stage is shared by every wonder; complete, the wonder\'s own frame', () => {
        for (const w of ['casino', 'ultramind', 'sanctuary', 'beacon', 'riftGate']) {
            for (let s = 0; s < 4; s++) expect(greatWorkFrame(site(s, w))).toBe(`scaffold_${s}`);
        }
        expect(greatWorkFrame(site(4, 'casino'))).toBe('casino');
        expect(greatWorkFrame(site(4, 'ultramind'))).toBe('ultramind');
        expect(greatWorkFrame(site(4, 'ultramind', {} as Habitat))).toBe('ultramind-node');
        // the Ultramind turned on its partners (its own module sets `awakened`): the red, split-open frames
        expect(greatWorkFrame({ ...site(4, 'ultramind'), awakened: true })).toBe('ultramind-awake');
        expect(greatWorkFrame({ ...site(4, 'ultramind', {} as Habitat), awakened: true })).toBe('ultramind-node-awake');
        expect(greatWorkFrame({ ...site(4, 'ultramind'), awakened: false })).toBe('ultramind');
        expect(greatWorkFrame({ ...site(2, 'ultramind'), awakened: true })).toBe('scaffold_2');
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
    it('an Ultramind round a planet wears the caged-planet look or the solid cube, by a hash of its site and the 30-day bucket of the date (deterministic, no state)', () => {
        const DAY = GAME_DAY_LENGTH;
        // the same site and bucket always give the same look; across a year both looks turn up
        for (const id of [1, 2, 7]) {
            for (let b = 0; b < 12; b++) expect(ultramindLookFor(id, b * 30 * DAY + 1)).toBe(ultramindLookFor(id, b * 30 * DAY + 29 * DAY));
        }
        const seen = new Set<string>();
        for (let b = 0; b < 24; b++) seen.add(ultramindLookFor(3, b * 30 * DAY));
        expect([...seen].sort()).toEqual(['cage', 'cube']);
        const planet = {} as Habitat;
        const l = { genFactions: [], worldShips: [], swarmFaction: null, mothercore: null, purifierFaction: null, purifierDock: null, ultramindLook: new Map<Habitat, 'cage' | 'cube'>(), ultramindCover: new Map<Habitat, number>() };
        // the cage look keeps the uplink node (and the cage over the planet); the cube look draws the whole cube over the planet; the awakened state follows the look
        expect(greatWorkFrame(site(4, 'ultramind', planet), l)).toBe('ultramind-node');
        l.ultramindLook.set(planet, 'cage');
        expect(greatWorkFrame({ ...site(4, 'ultramind', planet), awakened: true }, l)).toBe('ultramind-node-awake');
        l.ultramindLook.set(planet, 'cube');
        expect(greatWorkFrame(site(4, 'ultramind', planet), l)).toBe('ultramind');
        expect(greatWorkFrame({ ...site(4, 'ultramind', planet), awakened: true }, l)).toBe('ultramind-awake');
        expect(greatWorkDrawPx('ultramind', 1)).toBe(GREAT_WORK_WORLD_SIZE);
        // the solid cube is drawn at least ULTRAMIND_CUBE_COVER times the picture it covers (a gas giant is far wider than the standard frame)
        const planetSite = site(4, 'ultramind', planet);
        l.ultramindCover.set(planet, 100);
        expect(greatWorkDrawPxOf(planetSite, 'ultramind', 1, l)).toBe(GREAT_WORK_WORLD_SIZE); // a small planet: the standard frame
        l.ultramindCover.set(planet, 969);
        expect(greatWorkDrawPxOf(planetSite, 'ultramind', 1, l)).toBe(Math.trunc(969 * ULTRAMIND_CUBE_COVER));
        expect(greatWorkDrawPxOf(planetSite, 'ultramind', 2, l)).toBe(Math.trunc((969 * ULTRAMIND_CUBE_COVER) / 2));
        l.ultramindLook.set(planet, 'cage');
        expect(greatWorkDrawPxOf(planetSite, 'ultramind-node', 1, l)).toBe(280); // the cage look keeps the node's size
        // without a planet it stays the solid cube
        expect(greatWorkFrame(site(4, 'ultramind'), l)).toBe('ultramind');
    });
    it('one fixed world size per frame (the node half), whatever the base', () => {
        expect(greatWorkDrawPx('scaffold_2', 1)).toBe(GREAT_WORK_WORLD_SIZE);
        expect(greatWorkDrawPx('casino', 4)).toBe(GREAT_WORK_WORLD_SIZE / 4);
        expect(greatWorkDrawPx('ultramind-node', 1)).toBe(GREAT_WORK_WORLD_SIZE / 2);
        expect(greatWorkDrawPx('ultramind-node-awake', 1)).toBe(GREAT_WORK_WORLD_SIZE / 2);
        expect(greatWorkDrawPx('toString', 1)).toBe(GREAT_WORK_WORLD_SIZE); // no prototype key taken for a scale
    });
    it('frames: square, the crop square is the whole frame, no opaque black or marker colours, one connected body', () => {
        const shells = ['ultramind-shell', 'ultramind-shell-back', 'ultramind-shell-awake', 'ultramind-shell-back-awake'];
        const files = [...FRAMES, 'sanctuary-front', 'casino-neon', 'casino-rotor-main', 'casino-rotor-night', 'casino-wheel', 'casino-pirate-neon', 'casino-pirate-rotor-main', ...shells, ...UM_FRAMES.map((f) => `${f}-glow`), 'ultramind-shell-glow', 'ultramind-shell-awake-glow'];
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
            const pts = GW_LIGHTS[f.split('-').join('_')];
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
    it('light patterns stay in 0..1; nav lights flash', () => {
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
    });
    it('the Gilded Orbit\'s neon (and the den\'s, mostly dark): pieces of each look\'s atlas on the frame, each its own flicker', () => {
        expect(Object.keys(GW_CASINO_LOOKS).sort()).toEqual(['casino', 'casino-pirate']);
        for (const [name, look] of Object.entries(GW_CASINO_LOOKS)) {
            const atlas = decodePng(png(look.neonFile));
            const behs = new Set<number>();
            for (const r of look.neon) {
                const [ax, ay, w, h, fx, fy, beh] = r;
                expect(ax >= 0 && ay >= 0 && ax + w <= atlas.width && ay + h <= atlas.height, name).toBe(true);
                expect(fx >= 0 && fy >= 0 && fx + w <= 720 && fy + h <= 720, name).toBe(true);
                behs.add(beh);
            }
            if (name === 'casino') expect([...behs].sort()).toEqual([CASINO_BUZZ, CASINO_DEAD, CASINO_SEQ, CASINO_BLINK].sort());
            else expect([...behs].every((b) => b === CASINO_BAD || b === CASINO_DEAD)).toBe(true); // the den's signs only fail
        }
        // the signs mostly dark in the den
        expect(GW_CASINO_LOOKS.casino.neon.length).toBeGreaterThanOrEqual(30);
        expect(GW_CASINO_LOOKS['casino-pirate'].neon.length).toBeLessThan(GW_CASINO_LOOKS.casino.neon.length * 0.5);
        expect(GW_CASINO_LOOKS['casino-pirate'].neon.length).toBeGreaterThan(5);
        const share = (beh: number, p1: number, p2: number, p3: number, k: number): { on: number; off: number } => {
            let on = 0;
            let off = 0;
            for (let i = 0; i < 1200; i++) {
                const v = casinoNeonAlpha(beh, p1, p2, p3, i * 0.05, k);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
                if (v > 0.5) on++;
                if (v < 0.1) off++;
            }
            return { on: on / 1200, off: off / 1200 };
        };
        // a steady tube is lit almost always, but stutters now and then; a dead one is mostly dark; a bad one fails often
        const buzz = share(CASINO_BUZZ, 3, 0, 0, 4);
        expect(buzz.on).toBeGreaterThan(0.85);
        expect(buzz.off).toBeGreaterThan(0);
        expect(share(CASINO_DEAD, 5, 0, 0, 9).on).toBeLessThan(0.6);
        const bad = share(CASINO_BAD, 2, 0, 0, 6);
        expect(bad.off).toBeGreaterThan(0.25);
        expect(bad.on).toBeGreaterThan(0.2);
        // a run fills one by one, holds, goes dark
        const lit = (st: number): number => {
            let n = 0;
            for (let i = 0; i < 6; i++) if (casinoNeonAlpha(CASINO_SEQ, i, 6, 0.4, (st + 0.5) * 0.4, i) > 0.5) n++;
            return n;
        };
        expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(lit)).toEqual([0, 1, 2, 3, 4, 5, 6, 6, 0]);
        // two blink sets take turns
        for (const t of [0.1, 0.5, 0.9, 1.3]) {
            expect(casinoNeonAlpha(CASINO_BLINK, 0, 0.8, 0, t, 1) > 0.5).toBe(casinoNeonAlpha(CASINO_BLINK, 1, 0.8, 0, t, 2) < 0.5);
        }
    });
    it('the Gilded Orbit\'s wheels turn on the frame (the den\'s grind or stand); the ball keeps to the bowl; the ships fade out with distance', () => {
        const pt = { x: 0, y: 0, a: 0 };
        for (const [name, look] of Object.entries(GW_CASINO_LOOKS)) {
            const img = decodePng(png(name));
            const alpha = (x: number, y: number): number => img.data[(Math.floor(y) * img.width + Math.floor(x)) * 4 + 3];
            for (let i = 0; i < look.rotors.length; i++) {
                const r = look.rotors[i];
                expect(look.rotorFiles[r[0]], name).toBeDefined();
                expect(alpha(r[1], r[2])).toBe(255);
                // its plane seen on the sphere: not mirrored, foreshortened at most
                expect(r[3] * r[6] - r[4] * r[5]).toBeGreaterThan(0.5);
                expect(Math.hypot(r[3], r[5])).toBeLessThanOrEqual(1.001);
                expect(Math.hypot(r[4], r[6])).toBeLessThanOrEqual(1.001);
                expect(r[7]).not.toBe(0);
                if (!look.ball) continue;
                let inPocket = 0;
                for (let t = 0; t < CASINO_BALL_PERIOD * 2; t += 0.1) {
                    casinoBallPos(r, i, t, pt);
                    const rad = Math.hypot(pt.x, pt.y);
                    expect(rad).toBeLessThanOrEqual(r[9]);
                    expect(pt.a).toBeGreaterThanOrEqual(0);
                    expect(pt.a).toBeLessThanOrEqual(1);
                    if (Math.abs(rad - r[8] * 0.58) < 0.01) inPocket++;
                }
                expect(inPocket).toBeGreaterThan(0);
            }
            if (look.wheel !== null) expect(alpha(look.wheel[0], look.wheel[1])).toBeGreaterThan(120);
            const [near, far] = look.laneFade;
            expect(casinoLaneFade(look, near - 10)).toBe(1);
            expect(casinoLaneFade(look, far + 1)).toBe(0);
            for (let r = near; r < far; r += 5) expect(casinoLaneFade(look, r + 5)).toBeLessThanOrEqual(casinoLaneFade(look, r));
            let shown = 0;
            for (let li = 0; li < look.lanes.length; li++) {
                for (let k = 0; k < casinoLaneShips(look, li); k++) {
                    casinoLaneShip(look, li, k, 7.3, 360, 360, pt);
                    if (Math.hypot(pt.x - 360, pt.y - 360) > far) expect(pt.a).toBe(0);
                    else if (pt.a > 0.2) shown++;
                }
            }
            expect(shown, name).toBeGreaterThan(name === 'casino' ? 10 : 2);
        }
        const casino = GW_CASINO_LOOKS.casino;
        const den = GW_CASINO_LOOKS['casino-pirate'];
        expect(casino.rotors.length).toBe(2);
        expect(casino.wheel).not.toBeNull();
        expect(casino.ball).toBe(true);
        // the den: one roulette wheel grinding round in fits (the other stands), the observation wheel stopped, no ball,
        // thinner traffic
        expect(den.rotors.length).toBe(1);
        expect(den.rotors[0][10]).toBeGreaterThan(0);
        expect(den.wheel).toBeNull();
        expect(den.ball).toBe(false);
        expect(den.lane[0]).toBeGreaterThan(casino.lane[0]);
        let stuck = 0;
        let back = 0;
        let prev = casinoRotorAngle(den.rotors[0], 0);
        for (let t = 0.05; t < 30; t += 0.05) {
            const a = casinoRotorAngle(den.rotors[0], t);
            if (Math.abs(a - prev) < 1e-9) stuck++;
            if ((a - prev) * Math.sign(den.rotors[0][7]) < -0.05) back++;
            prev = a;
        }
        expect(stuck / 600).toBeGreaterThan(0.5);
        expect(back).toBe(0);
        expect(casinoRotorAngle(casino.rotors[0], 2) - casinoRotorAngle(casino.rotors[0], 1)).toBeCloseTo(casino.rotors[0][7], 9);
        // the marquee bulbs chase; most are dead in the den
        const bulb = GW_LIGHT_KINDS.indexOf('bulb');
        const bulbs = (f: string): number => GW_LIGHTS[f].filter((p) => p[2] === bulb).length;
        expect(bulbs('casino')).toBeGreaterThan(40);
        expect(bulbs('casino_pirate')).toBeLessThan(bulbs('casino') * 0.4);
        expect(gwLightAlpha(bulb, 0, 0, 1)).not.toBe(gwLightAlpha(bulb, 0, 1, 1));
    });
    it('a casino whose smugglers\' front is out (its record revealed) draws as the pirate den; any other phase as the casino', () => {
        const base = { hasBeenDestroyed: false } as unknown as BuiltObject;
        const casinoSite: GreatWorkArtSite = { id: 7, base, stage: 4, wonder: 'casino', habitat: null };
        const galaxyWith = (recs: unknown): Galaxy => ({ scenario: { state: { [GIANTWORKS_STATE_KEY]: { sites: [casinoSite] }, [CASINO_STATE_KEY]: recs } } }) as unknown as Galaxy;
        const at = (recs: unknown): string => greatWorkFrame(casinoSite, threatLooks(galaxyWith(recs)));
        expect(at({ sites: [{ workId: 7, phase: 'revealed' }], faction: null })).toBe('casino-pirate');
        expect(greatWorkArtUrl(base)).toBe(`${GW_ART_DIR}casino-pirate.png`);
        for (const phase of ['open', 'renovation', 'clean', 'closed']) expect(at({ sites: [{ workId: 7, phase }] })).toBe('casino');
        expect(at({ sites: [{ workId: 8, phase: 'revealed' }] })).toBe('casino'); // another Great Work's
        expect(at({ sites: [null, { phase: 'revealed' }] })).toBe('casino');
        expect(at({})).toBe('casino');
        expect(at(undefined)).toBe('casino');
        expect(greatWorkDrawPx('casino-pirate', 2)).toBe(greatWorkDrawPx('casino', 2));
        threatLooks({ scenario: null } as unknown as Galaxy);
        expect(greatWorkFrame(casinoSite)).toBe('casino');
    });
    it('the Ultramind: rack lights on its racks, traces on the cube, patterns in 0..1, the awakened ones faster', () => {
        // the cube, its node, and the planet cage's front half (its rack lights and pulses too)
        for (const f of [...UM_FRAMES, 'ultramind-shell', 'ultramind-shell-awake']) {
            const key = f.split('-').join('_');
            const r = GW_UM_RACKS[key];
            const tr = GW_UM_TRACES[key];
            expect(r.length % 8, f).toBe(0);
            expect(r.length / 8, f).toBeGreaterThan(100);
            expect(tr.length, f).toBeGreaterThan(f.includes('shell') ? 10 : 20);
            const img = decodePng(png(f));
            const W = img.width;
            for (let i = 0; i < r.length; i += 8) {
                const [x, y, w, h, face] = r.slice(i, i + 5);
                expect(img.data[(Math.round(y) * W + Math.round(x)) * 4 + 3], `${f} rack ${x},${y}`).toBeGreaterThan(200);
                expect(w).toBeGreaterThan(1);
                expect(h).toBeGreaterThan(0.8);
                expect(Math.abs(face)).toBe(1);
            }
            for (const pl of tr) {
                expect(pl.length % 2).toBe(0);
                for (let j = 0; j < pl.length; j += 2) expect(img.data[(Math.round(pl[j + 1]) * W + Math.round(pl[j])) * 4 + 3], `${f} trace`).toBeGreaterThan(120);
            }
        }
        // read as a browser does (a premultiplied 8-bit canvas): no pixel comes back in a light-marker colour
        const shells = ['ultramind-shell', 'ultramind-shell-back', 'ultramind-shell-awake', 'ultramind-shell-back-awake', 'ultramind-shell-glow', 'ultramind-shell-awake-glow'];
        for (const f of [...UM_FRAMES, ...UM_FRAMES.map((g) => `${g}-glow`), ...shells]) {
            const d = decodePng(png(f)).data;
            let bad = 0;
            for (let i = 0; i < d.length; i += 4) {
                const a = d[i + 3];
                if (a === 0) continue;
                const back = (v: number): number => Math.min(255, Math.round((Math.round((v * a) / 255) * 255) / a));
                const r = back(d[i]);
                const g = back(d[i + 1]);
                const b = back(d[i + 2]);
                if ((r === 255 && g === 255 && b === 0) || (r === 0 && g === 0 && b === 255)) bad++;
            }
            expect(bad, f).toBe(0);
        }
        // the light patterns: in 0..1, every unit blinking (lit and dark moments), the awakened cube lit more and faster
        let calmOn = 0;
        let angryOn = 0;
        let calmFlips = 0;
        let angryFlips = 0;
        for (let row = 0; row < 40; row++) {
            for (let col = 0; col < 4; col++) {
                let pc = -1;
                let pa = -1;
                for (let t = 0; t < 10; t += 0.05) {
                    const c = gwRackAlpha(t, row, col, false);
                    const a = gwRackAlpha(t, row, col, true);
                    for (const v of [c, a]) {
                        expect(v).toBeGreaterThanOrEqual(0);
                        expect(v).toBeLessThanOrEqual(1);
                    }
                    calmOn += c;
                    angryOn += a;
                    if (pc >= 0 && Math.abs(c - pc) > 0.3) calmFlips++;
                    if (pa >= 0 && Math.abs(a - pa) > 0.3) angryFlips++;
                    pc = c;
                    pa = a;
                }
            }
        }
        expect(calmFlips).toBeGreaterThan(400);
        expect(angryFlips).toBeGreaterThan(calmFlips * 1.5);
        expect(angryOn).toBeGreaterThan(calmOn * 1.2);
        // the data pulses run the trace's length and pause (calm), all but back to back awakened
        let seen = 0;
        let prev = -1;
        let moved = 0;
        for (let t = 0; t < 20; t += 0.02) {
            const d = gwTracePulse(t, 3, 120, false);
            expect(d).toBeLessThanOrEqual(120);
            if (d >= 0) {
                seen++;
                if (prev >= 0 && d > prev) moved++;
            }
            prev = d;
        }
        expect(seen).toBeGreaterThan(50);
        expect(seen).toBeLessThan(1000);
        expect(moved).toBeGreaterThan(40);
        let angry = 0;
        for (let t = 0; t < 20; t += 0.02) if (gwTracePulse(t, 3, 120, true) >= 0) angry++;
        expect(angry).toBeGreaterThan(seen);
        for (let t = 0; t < 10; t += 0.1) {
            expect(gwUltramindPulse(t)).toBeGreaterThan(0.3);
            expect(gwUltramindPulse(t, true)).toBeLessThanOrEqual(1);
        }
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
    it('the Sanctuary breached: only an exact true; broken panes, venting plumes, alarm glow and emergency lamps', () => {
        expect(sanctuaryBreached({})).toBe(false);
        expect(sanctuaryBreached({ breached: false })).toBe(false);
        expect(sanctuaryBreached({ breached: true })).toBe(true);
        expect(sanctuaryBreached({ breached: 1 as unknown as boolean })).toBe(false);
        expect(sanctuaryBreached({ breached: 'yes' as unknown as boolean })).toBe(false);
        // the layers: there, clean (no opaque black, no marker colour even after a browser's premultiplied read)
        for (const f of ['sanctuary-breach', 'sanctuary-alarm', 'sanctuary-spill']) {
            expect(existsSync(png(f)), f).toBe(true);
            const img = decodePng(png(f));
            if (f !== 'sanctuary-spill') expect([img.width, img.height]).toEqual([720, 720]);
            const d = img.data;
            let bad = 0;
            let lit = 0;
            for (let i = 0; i < d.length; i += 4) {
                const a = d[i + 3];
                if (a === 0) continue;
                lit++;
                const c = [0, 1, 2].map((k) => Math.round((Math.round((d[i + k] * a) / 255) * 255) / a));
                if ((c[0] === 255 && c[1] === 255 && c[2] === 0) || (c[0] === 0 && c[1] === 0 && c[2] === 255)) bad++;
                else if (a === 255 && d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) bad++;
            }
            expect(bad, f).toBe(0);
            expect(lit, f).toBeGreaterThan(500);
        }
        // the breaks sit on the glass, one plume length each; the emergency lamps are red nav lamps
        const breaks = GW_LIGHTS.sanctuary_breaks;
        expect(breaks.length).toBe(SANCTUARY_SPILL_LEN.length);
        for (const [x, y] of breaks) expect(Math.hypot(x - 360, y - 360)).toBeLessThan(GW_SANCTUARY_GLASS_R);
        const lamps = GW_LIGHTS.sanctuary_emergency;
        expect(lamps.length).toBeGreaterThan(8);
        for (const l of lamps) expect(l[2]).toBe(GW_LIGHT_KINDS.indexOf('nav'));
        // each plume puffs: phases spread, growing as they drift out, fading in and out
        for (let k = 0; k < breaks.length; k++) {
            const ts = new Set<number>();
            for (let j = 0; j < SANCTUARY_SPILL_PUFFS; j++) {
                const p = sanctuarySpillPuff(12.3, k, j);
                expect(p.t).toBeGreaterThanOrEqual(0);
                expect(p.t).toBeLessThan(1);
                expect(p.alpha).toBeGreaterThanOrEqual(0);
                expect(p.alpha).toBeLessThanOrEqual(1);
                expect(p.len).toBeLessThanOrEqual(SANCTUARY_SPILL_LEN[k] * 1.2);
                ts.add(Math.round(p.t * 100));
            }
            expect(ts.size).toBe(SANCTUARY_SPILL_PUFFS);
            const a = sanctuarySpillPuff(0, k, 0);
            const b = sanctuarySpillPuff(0.4, k, 0);
            if (b.t > a.t) expect(b.len).toBeGreaterThan(a.len);
            expect(sanctuarySpillPuff(-5, k, 1).t).toBeGreaterThanOrEqual(0);
        }
        // the alarm glow fades in and out, never quite off; the lamps flash odd and even in turn
        let lo = 1;
        let hi = 0;
        for (let t = 0; t < 4.4; t += 0.05) {
            const p = sanctuaryAlarmPulse(t);
            lo = Math.min(lo, p);
            hi = Math.max(hi, p);
        }
        expect(lo).toBeGreaterThanOrEqual(0.1);
        expect(lo).toBeLessThan(0.2);
        expect(hi).toBeGreaterThan(0.9);
        expect(sanctuaryEmergencyAlpha(0, 0)).toBeGreaterThan(0.9);
        expect(sanctuaryEmergencyAlpha(0, 1)).toBeLessThan(0.2);
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

describe('the Ark Engine art', () => {
    const png = (f: string): string => resolve(__dirname, '../public', `${GW_ART_DIR.slice(1)}${f}.png`);
    const site = (stage: number): GreatWorkArtSite => ({ base: null, stage, wonder: 'ark', habitat: null });
    const ship = (extra: Record<string, unknown> = {}): BuiltObject => ({ hasBeenDestroyed: false, ...extra }) as unknown as BuiltObject;
    it('a finished Ark draws its own frame (the scaffold while it is built); the state key is the sim\'s', () => {
        for (let s = 0; s < 4; s++) expect(greatWorkFrame(site(s))).toBe(`scaffold_${s}`);
        expect(greatWorkFrame(site(4))).toBe('ark');
        expect(greatWorkDrawnFrame(site(4))).toBe('ark');
        expect(ARK_STATE_KEY).toBe(ARK_KEY);
        expect(ARK_LOOK.frame).toBeGreaterThanOrEqual(2048);
    });
    it('threatLooks keeps the Arks afloat by ship (read defensively)', () => {
        const a1 = ship();
        const a2 = ship({ hasBeenDestroyed: true });
        const base = ship();
        const g = (ark: unknown): Galaxy => ({ scenario: { state: { [GIANTWORKS_STATE_KEY]: { sites: [{ ...site(4), base }] }, [ARK_STATE_KEY]: ark } } }) as unknown as Galaxy;
        let lk = threatLooks(g({ arks: [{ ship: a1, phase: 'roaming' }, { ship: a2, phase: 'lost' }, null, { ship: null }, 7] }));
        expect([...lk.arks!.keys()]).toEqual([a1]);
        expect(arkRecordOf(a1)?.phase).toBe('roaming');
        expect(arkRecordOf(a2)).toBeNull();
        for (const bad of [undefined, null, {}, { arks: 3 }, 'x']) {
            lk = threatLooks(g(bad));
            expect(lk.arks!.size).toBe(0);
        }
        threatLooks({ scenario: null } as unknown as Galaxy);
        expect(arkRecordOf(a1)).toBeNull();
    });
    it('the look by state: broken over fight over siphoning over cruising', () => {
        const started = { colony: { xpos: 1, ypos: 2 }, startedAt: 5 };
        expect(arkMode(null)).toBe('cruising');
        expect(arkMode({ phase: 'roaming' })).toBe('cruising');
        expect(arkMode({ phase: 'siphoning', target: { startedAt: -1 } })).toBe('cruising'); // waiting for the owner's answer
        expect(arkMode({ phase: 'siphoning', target: started })).toBe('siphoning');
        expect(arkMode({ phase: 'siphoning', target: started, fight: true })).toBe('fight');
        expect(arkMode({ phase: 'siphoning', fight: true, breached: true })).toBe('broken');
        expect(arkMode({ phase: 'escaping' })).toBe('broken');
        expect(arkMode({ phase: 'repairing', breached: true })).toBe('broken');
        expect(arkMode({ phase: 'repairing', breached: false })).toBe('cruising');
        expect(arkFighting({ fight: true })).toBe(true);
        expect(arkFighting({ fight: 'yes' as unknown as boolean })).toBe(false);
        const out = { x: 0, y: 0 };
        expect(arkTargetPos({ target: started }, out)).toBe(true);
        expect(out).toEqual({ x: 1, y: 2 });
        expect(arkTargetPos({ target: { colony: null, parkX: 9, parkY: 8 } }, out)).toBe(true);
        expect(out).toEqual({ x: 9, y: 8 });
        expect(arkTargetPos({ target: { parkX: Number.NaN, parkY: 1 } }, out)).toBe(false);
        expect(arkTargetPos({}, out)).toBe(false);
    });
    it('engines: power by speed, the aft bells brightest (the globe never turns: the heading shows in its engines)', () => {
        expect(arkEnginePower(0, 100)).toBe(0);
        expect(arkEnginePower(50, 100)).toBe(0.5);
        expect(arkEnginePower(900, 100)).toBe(1);
        expect(arkEnginePower(30, 0)).toBe(1);
        // a bell facing left on screen is aft when heading right, not when heading left
        expect(arkEngineAft(-1, 0, 0)).toBeCloseTo(1, 9);
        expect(arkEngineAft(-1, 0, Math.PI)).toBe(0);
        expect(arkEngineAft(-0.5, 0, 0)).toBeCloseTo(0.5, 9); // half its axis in the screen plane
        expect(arkEngineAft(0, 0, 1)).toBe(0);
        // the engine rows face every way round the band: whatever the heading, some bells are aft
        for (let h = 0; h < 8; h++) {
            const heading = (h * Math.PI) / 4;
            const best = Math.max(...ARK_LOOK.engines.map((e) => arkEngineAft(e[2], e[3], heading)));
            if (Math.sin(heading) <= 0.2) expect(best, `heading ${h}`).toBeGreaterThan(0.3);
        }
    });
    it('the iris opens through its atlas (a crossfade of neighbouring frames); the deck turns steadily', () => {
        const n = ARK_LOOK.irisBox[5];
        expect(arkIrisFrames(0)).toEqual({ lo: 0, hi: 1, t: 0 });
        expect(arkIrisFrames(1)).toEqual({ lo: n, hi: n, t: 0 });
        expect(arkIrisFrames(2)).toEqual({ lo: n, hi: n, t: 0 });
        const mid = arkIrisFrames(0.5);
        expect(mid.lo).toBe(n / 2);
        const q = arkIrisFrames(0.51);
        expect(q.hi).toBe(q.lo + 1);
        expect(q.t).toBeGreaterThan(0);
        expect(q.t).toBeLessThan(1);
        expect(arkSpin(10) - arkSpin(5)).toBeCloseTo(5 * ARK_SPIN, 9);
        expect(arkSpin(1e6)).toBeLessThan(2 * Math.PI);
        for (let k = 0; k < ARK_BAND_SLICES; k++) {
            const v = [0, 1.3, 2.7, 4.4, 9.1].map((t) => arkBandSliceAlpha(k, t));
            for (const a of v) expect(a).toBeGreaterThanOrEqual(0);
            for (const a of v) expect(a).toBeLessThanOrEqual(1);
        }
    });
    it('planet-sized: at least an ARK_REF_SIZE hull drawn ARK_VISUAL_SCALE x, whatever its own size', () => {
        expect(arkDrawScale(ARK_REF_SIZE)).toBeCloseTo(ARK_VISUAL_SCALE, 9);
        expect(arkDrawScale(ARK_REF_SIZE * 1e4)).toBe(1);
        // drawn size = sqrt(size * areaRatio * 8) * scale: the same for any hull up to ARK_VISUAL_SCALE^2 x the reference
        const drawn = (size: number): number => Math.sqrt(size * 3 * 8) * arkDrawScale(size);
        expect(drawn(6000)).toBeCloseTo(drawn(15000), 6);
        // the threat layers size it the same (the ambient layer, the site marker's ring)
        const ark = ship({ size: 9000 });
        const lk = threatLooks({ scenario: { state: { [GIANTWORKS_STATE_KEY]: { sites: [{ ...site(4), base: ark }] }, [ARK_STATE_KEY]: { arks: [{ ship: ark }] } } } } as unknown as Galaxy);
        expect(threatDrawScale(lk, ark)).toBeCloseTo(arkDrawScale(9000), 9);
        threatLooks({ scenario: null } as unknown as Galaxy);
        expect(Math.abs(greatWorkDrawPx('ark', 1) - ARK_LOOK.worldSide)).toBeLessThanOrEqual(1);
        // planet-sized: the globe wider than the largest gas giant (diameter 970), far wider than a capital ship
        const globeWorld = (2 * ARK_LOOK.globe[2] * ARK_LOOK.worldSide) / ARK_LOOK.frame;
        expect(globeWorld).toBeGreaterThan(970);
        expect(globeWorld).toBeLessThan(2000);
    });
    it('the frames: one structure, the overlays in register, no opaque black nor marker colours', () => {
        const base = decodePng(png('ark'));
        expect(base.width).toBe(ARK_LOOK.frame);
        expect(base.height).toBe(ARK_LOOK.frame);
        const W = base.width;
        const alphaAt = (x: number, y: number): number => base.data[(Math.round(y) * W + Math.round(x)) * 4 + 3];
        // registration pixels: the crop square is the whole frame
        expect(alphaAt(4, 4)).toBeGreaterThan(0);
        expect(alphaAt(W - 5, W - 5)).toBeGreaterThan(0);
        expect(ARK_LOOK.engines.length).toBeGreaterThanOrEqual(8);
        expect(ARK_LOOK.turrets.length).toBeGreaterThan(10);
        for (const rows of [ARK_LOOK.engines, ARK_LOOK.turrets, ARK_LOOK.nav, ARK_LOOK.strobes, ARK_LOOK.hits]) {
            for (const r of rows) expect(alphaAt(r[0], r[1]), `${r[0]},${r[1]}`).toBeGreaterThan(200);
        }
        expect(alphaAt(ARK_LOOK.iris[0], ARK_LOOK.iris[1])).toBe(255);
        const [gx, gy, R] = ARK_LOOK.globe;
        expect(alphaAt(gx, gy)).toBe(255);
        expect(alphaAt(gx, gy - R * 0.98)).toBe(255);
        const iris = decodePng(png('ark-iris'));
        const [ix, iy, iw, ih, cols, n] = ARK_LOOK.irisBox;
        expect(iris.width).toBe(cols * (iw + 2));
        expect(iris.height).toBe(Math.ceil(n / cols) * (ih + 2));
        expect(ix + iw).toBeLessThanOrEqual(W);
        expect(iy + ih).toBeLessThanOrEqual(W);
        const deck = decodePng(png('ark-deck'));
        expect(deck.width).toBe(ARK_LOOK.deckSide);
        for (const [f, at] of [['ark-occluder', ARK_LOOK.occluder], ['ark-damage', ARK_LOOK.damage]] as const) {
            const im = decodePng(png(f));
            expect(at[0] + im.width, f).toBeLessThanOrEqual(W);
            expect(at[1] + im.height, f).toBeLessThanOrEqual(W);
        }
        for (const f of ['ark', 'ark-deck', 'ark-occluder', 'ark-iris', 'ark-damage', 'ark-glow-hab', 'ark-glow-band', 'ark-glow-eng', 'ark-glow-fire', 'ark-shield', 'ark-beam', 'ark-plume', 'ark-smoke']) {
            const im = decodePng(png(f));
            let black = 0;
            let marker = 0;
            for (let i = 0; i < im.data.length; i += 4) {
                const [r, g, b, a] = [im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]];
                if (a === 255 && r === 0 && g === 0 && b === 0) black++;
                if (a > 0 && ((r === 0 && g === 0 && b === 255) || (r === 255 && g === 255 && b === 0))) marker++;
            }
            expect(black, f).toBe(0);
            expect(marker, f).toBe(0);
        }
        // one connected structure: from the globe's centre, the opaque pixels reach the ring's far ends
        const seen = new Uint8Array(W * W);
        const stack = [Math.round(gy) * W + Math.round(gx)];
        seen[stack[0]] = 1;
        let count = 0;
        while (stack.length > 0) {
            const p = stack.pop()!;
            count++;
            const x = p % W;
            const y = (p - x) / W;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
                    const q = ny * W + nx;
                    if (seen[q] === 0 && base.data[q * 4 + 3] > 40) {
                        seen[q] = 1;
                        stack.push(q);
                    }
                }
            }
        }
        let opaque = 0;
        for (let i = 3; i < base.data.length; i += 4) if (base.data[i] > 40) opaque++;
        expect(count).toBe(opaque);
    });
});
