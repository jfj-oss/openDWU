// The Ark Engine's look (Giantworks, the 'ark' wonder; render only). The Ark is a planet-sized globe ship kitbashed from
// stock DW:U hulls and stations (scripts/ark-art.py): the globe, a broad equatorial band of decks and engine bells, a
// habitation ring on six spokes, and a docking iris (a hangar mouth in the band). It never turns with its heading (its
// light stays a planet's, from the upper left); the heading shows in its engines instead: the bells on the band's aft
// side glow brighter and throw plumes while it moves.
//
// ArkFxLayer draws the whole Ark in its own container UNDER the ships (fleets fighting it fly over it, as over a planet):
// the base frame, the ring's deck turning (ark-deck.png in its own plane, then ark-occluder.png: what lies in front of
// the deck), the iris opening (ark-iris.png, a crossfade of its frames), the glow layers (the habitation lights, the
// band's decks, the engine bells), the lamps (nav, strobes, turrets, engines), and by its state (arkMode):
// - cruising: engine glow and plumes by heading, the ring turning, the lights on;
// - siphoning: the iris opens toward the colony's side: a tractor beam toward the target and a stream of passenger
//   ships funnelling in (render only: the sim's transports are delivered far off);
// - fight: turrets firing, amber warning strobes, the band's light gone red, the shield's shimmer (a flash when hit);
// - broken (shields broken, escaping or mending): scorched craters with burning rims (ark-damage, ark-glow-fire),
//   sparks, smoke trailing away, the band's lights failing in sections.
// Everything is pooled (nothing allocated per frame but an Ark's small animation record, once) and gated by drawn size.

import { Container, Matrix, Rectangle, Texture } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import { ARK_REF_SIZE, ARK_VISUAL_SCALE } from '../sim/scenario/threats/giantworks/ark';
import { SpritePool } from './fxCommon';
import { loadShipArt } from './shipArt';
import { ARK_LOOK } from './arkLights';
import { GW_ART_DIR, LAMP_CORE_PX, lampTexture, minimumSizeScale, type ArkArtRecord } from './threatArt';

/** The Ark's draw scale over its hull's own size: at least an ARK_REF_SIZE hull drawn ARK_VISUAL_SCALE x. Pure. */
export function arkDrawScale(size: number): number {
    return minimumSizeScale(size, ARK_REF_SIZE, ARK_VISUAL_SCALE);
}

export type ArkMode = 'cruising' | 'siphoning' | 'fight' | 'broken';

/** The look of an Ark record (read defensively): broken while its shields are broken (or it flees / mends them), else
 * fight while it fights, else siphoning while the siphon runs, else cruising. Pure. */
export function arkMode(rec: ArkArtRecord | null | undefined): ArkMode {
    if (rec === null || rec === undefined) return 'cruising';
    if (rec.breached === true || rec.phase === 'escaping') return 'broken';
    if (rec.fight === true) return 'fight';
    if (rec.phase === 'siphoning' && rec.target !== null && rec.target !== undefined && typeof rec.target.startedAt === 'number' && rec.target.startedAt >= 0) return 'siphoning';
    return 'cruising';
}

/** Whether the Ark fights (turrets, strobes, shield shimmer), whatever else it shows. Pure. */
export function arkFighting(rec: ArkArtRecord | null | undefined): boolean {
    return rec !== null && rec !== undefined && rec.fight === true;
}

/** Where the Ark's target lies (world), or null: its colony, else its parking spot. Pure. */
export function arkTargetPos(rec: ArkArtRecord | null | undefined, out: { x: number; y: number }): boolean {
    const t = rec?.target;
    if (t === null || t === undefined) return false;
    const c = t.colony;
    if (c !== null && c !== undefined && Number.isFinite(c.xpos) && Number.isFinite(c.ypos)) {
        out.x = c.xpos;
        out.y = c.ypos;
        return true;
    }
    if (typeof t.parkX === 'number' && typeof t.parkY === 'number' && Number.isFinite(t.parkX) && Number.isFinite(t.parkY)) {
        out.x = t.parkX;
        out.y = t.parkY;
        return true;
    }
    return false;
}

/** The engines' power 0..1 (its speed over its top speed; 1 above it, at warp). Pure. */
export function arkEnginePower(currentSpeed: number, topSpeed: number): number {
    if (!(currentSpeed > 0.5)) return 0;
    if (!(topSpeed > 0)) return 1;
    return Math.max(0, Math.min(1, currentSpeed / topSpeed));
}

/** How far an engine bell faces aft (0..1): its outward screen direction (dx, dy, its length the share in the screen
 * plane) against the heading (rad). Pure. */
export function arkEngineAft(dx: number, dy: number, heading: number): number {
    const l = Math.hypot(dx, dy);
    if (!(l > 1e-6)) return 0;
    return Math.max(0, -(dx * Math.cos(heading) + dy * Math.sin(heading)) / l) * l;
}

/** The ring deck's turn (rad) at `sec`: a slow, steady spin. */
export const ARK_SPIN = (2 * Math.PI) / 180;
export function arkSpin(sec: number): number {
    return (sec * ARK_SPIN) % (2 * Math.PI);
}

/** The iris atlas frames to draw for an opening of `open` (0 shut .. 1 open): the frame below (0: the base frame's own
 * shut iris) and above, and the upper one's share. Pure. */
export function arkIrisFrames(open: number, n: number = ARK_LOOK.irisBox[5]): { lo: number; hi: number; t: number } {
    const k = Math.max(0, Math.min(1, open)) * n;
    const lo = Math.floor(k);
    return lo >= n ? { lo: n, hi: n, t: 0 } : { lo, hi: lo + 1, t: k - lo };
}

/** The iris opens (or shuts) fully in this many seconds. */
export const ARK_IRIS_SECONDS = 3;
/** Overlays are skipped below this drawn size (px); the transports and smoke below ARK_FINE_MIN_PX. */
export const ARK_FX_MIN_PX = 28;
export const ARK_FINE_MIN_PX = 90;

/** A 0..1 hash of two integers. Pure. */
function hash01(a: number, b: number): number {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
}

/** The band glow is cut into this many upright slices (sections of the band, failing one by one when broken). */
export const ARK_BAND_SLICES = 10;

/** Whether band slice `k` is lit at `sec` while broken: each slice drops out for a while now and then, flickers back. */
export function arkBandSliceAlpha(k: number, sec: number): number {
    const P = 3.1 + 2.3 * hash01(k, 7);
    const c = Math.floor((sec + k * 0.77) / P);
    if (hash01(c, k + 31) < 0.45) return hash01(Math.floor(sec * 13), k + 3) > 0.8 ? 0.6 : 0.08;
    return 0.7 + 0.3 * hash01(Math.floor(sec * 9), k);
}

const TRANSPORT_URL = '/assets/dwu/images/units/ships/family22/passengership.png';
const LANES = 3;
const LANE_SHIPS = 9;
const NAV_RED: readonly [number, number, number] = [1.0, 0.13, 0.09];
const AMBER: readonly [number, number, number] = [1.0, 0.62, 0.14];
const WHITE: readonly [number, number, number] = [1.0, 1.0, 1.0];
const ENGINE_COL: readonly [number, number, number] = [1.0, 0.68, 0.38];
const MUZZLE: readonly [number, number, number] = [1.0, 0.8, 0.45];
const TURRET_DIM: readonly [number, number, number] = [1.0, 0.3, 0.18];
const SHIELD_COL: readonly [number, number, number] = [0.55, 0.85, 1.0];
const SPARK: readonly [number, number, number] = [1.0, 0.86, 0.55];
const HEADLIGHT: readonly [number, number, number] = [1.0, 0.95, 0.85];
const DRIVE: readonly [number, number, number] = [0.6, 0.8, 1.0];

/** One Ark's animation state (its iris, its shield's last value and hit flash). */
interface ArkAnim {
    open: number;
    lastSec: number;
    lastShields: number;
    flash: number;
    flashAng: number;
    seen: boolean;
}

const texCache = new Map<string, Texture | null>();
const texLoading = new Set<string>();
/** A texture by URL (loaded once, on first use; null until then or if it failed). */
function tex(url: string): Texture | null {
    const got = texCache.get(url);
    if (got !== undefined) return got;
    if (!texLoading.has(url)) {
        texLoading.add(url);
        void loadShipArt(url, false).then(
            (a) => texCache.set(url, a?.texture ?? null),
            () => texCache.set(url, null),
        );
    }
    return null;
}

function arkTex(name: string): Texture | null {
    return tex(`${GW_ART_DIR}${name}.png`);
}

const frameTex = new Map<string, Texture[]>();
/** Frames of an atlas texture (made once it has loaded). */
function framesOf(key: string, t: Texture | null, rects: readonly (readonly [number, number, number, number])[]): Texture[] | null {
    if (t === null) return null;
    const got = frameTex.get(key);
    if (got !== undefined) return got;
    const f = rects.map((r) => new Texture({ source: t.source, frame: new Rectangle(r[0], r[1], r[2], r[3]) }));
    frameTex.set(key, f);
    return f;
}

function irisRects(): [number, number, number, number][] {
    const [, , w, h, cols, n] = ARK_LOOK.irisBox;
    const out: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) out.push([(i % cols) * (w + 2), Math.floor(i / cols) * (h + 2), w, h]);
    return out;
}

function sliceRects(t: Texture): [number, number, number, number][] {
    const W = t.width;
    const H = t.height;
    const out: [number, number, number, number][] = [];
    for (let k = 0; k < ARK_BAND_SLICES; k++) {
        const x0 = Math.floor((W * k) / ARK_BAND_SLICES);
        const x1 = Math.floor((W * (k + 1)) / ARK_BAND_SLICES);
        out.push([x0, 0, x1 - x0, H]);
    }
    return out;
}

/** The Ark Engines' layer: a container under the ships (BuiltObjectLayer adds it before its own). */
export class ArkFxLayer {
    readonly root = new Container();
    private readonly bodies = new Container();
    private readonly glows = new Container();
    private readonly smoke = new Container();
    private readonly ships = new Container();
    private readonly lamps = new Container();
    private readonly shields = new Container();
    private bodyPool = new SpritePool(this.bodies);
    private glowPool = new SpritePool(this.glows);
    private smokePool = new SpritePool(this.smoke);
    private shipPool = new SpritePool(this.ships);
    private lampPool = new SpritePool(this.lamps);
    private shieldPool = new SpritePool(this.shields);
    private readonly mat = new Matrix();
    private readonly tgt = { x: 0, y: 0 };
    private anims = new Map<BuiltObject, ArkAnim>();

    constructor() {
        this.root.eventMode = 'none';
        this.root.addChild(this.bodies, this.glows, this.smoke, this.ships, this.lamps, this.shields);
    }

    begin(): void {
        this.bodyPool.begin();
        this.glowPool.begin();
        this.smokePool.begin();
        this.shipPool.begin();
        this.lampPool.begin();
        this.shieldPool.begin();
        for (const a of this.anims.values()) a.seen = false;
    }

    /**
     * One Ark: its base frame `texture` (cropCenter (cx, cy) frame px at world (x, y), `scale` world units per frame px),
     * drawn `px` screen px; `heading` its true heading (rad), `rec` its sim record, `sec` the clock (s).
     */
    draw(bo: BuiltObject, rec: ArkArtRecord | null, texture: Texture, cx: number, cy: number, x: number, y: number, scale: number, px: number, heading: number, sec: number): void {
        const b = this.bodyPool.acquire(texture);
        b.anchor.set(cx / texture.width, cy / texture.height);
        b.position.set(x, y);
        b.scale.set(scale);
        if (px < ARK_FX_MIN_PX) return;
        const L = ARK_LOOK;
        // frame px (fx, fy) -> world: (x + (fx - cx) * scale, y + (fy - cy) * scale)
        const wx = (fx: number): number => x + (fx - cx) * scale;
        const wy = (fy: number): number => y + (fy - cy) * scale;
        let a = this.anims.get(bo);
        if (a === undefined) {
            a = { open: 0, lastSec: sec, lastShields: bo.currentShields, flash: 0, flashAng: 0, seen: true };
            this.anims.set(bo, a);
        }
        a.seen = true;
        const dt = Math.max(0, Math.min(0.5, sec - a.lastSec));
        a.lastSec = sec;
        const mode = arkMode(rec);
        const fight = arkFighting(rec);
        const broken = mode === 'broken';
        a.open = Math.max(0, Math.min(1, a.open + (mode === 'siphoning' ? 1 : -1) * (dt / ARK_IRIS_SECONDS)));
        // a hit: the shield's charge fell (more than its own wobble)
        const sh = bo.currentShields;
        if (sh < a.lastShields - Math.max(5, bo.shieldsCapacity * 0.0015)) {
            a.flash = 1;
            a.flashAng = hash01(Math.floor(sec * 7), bo.builtObjectID) * 2 * Math.PI;
        }
        a.lastShields = sh;
        a.flash = Math.max(0, a.flash - dt / 0.7);

        // --- the turning deck and what lies over it
        const deck = arkTex('ark-deck');
        const occ = arkTex('ark-occluder');
        if (deck !== null && occ !== null) {
            const [m00, m01, m10, m11, ox, oy] = L.deckM;
            const sp = arkSpin(sec);
            const c = Math.cos(sp);
            const s = Math.sin(sp);
            // N = scale * M * R(spin): texture px -> world
            const n00 = scale * (m00 * c + m01 * s);
            const n01 = scale * (-m00 * s + m01 * c);
            const n10 = scale * (m10 * c + m11 * s);
            const n11 = scale * (-m10 * s + m11 * c);
            const k = deck.width / L.deckSide;
            this.mat.set(n00 / k, n10 / k, n01 / k, n11 / k, wx(L.frame / 2 + ox), wy(L.frame / 2 + oy));
            this.bodyPool.acquire(deck).setFromMatrix(this.mat);
            const o = this.bodyPool.acquire(occ);
            o.anchor.set(0, 0);
            o.position.set(wx(L.occluder[0]), wy(L.occluder[1]));
            o.scale.set(scale);
        }
        // --- the iris
        const atlas = arkTex('ark-iris');
        const iframes = framesOf('ark-iris', atlas, irisRects());
        if (iframes !== null && a.open > 0) {
            const f = arkIrisFrames(a.open);
            const ix = wx(L.irisBox[0]);
            const iy = wy(L.irisBox[1]);
            if (f.lo >= 1) this.frame(iframes[f.lo - 1], ix, iy, scale, 1);
            if (f.t > 0.01 && f.hi >= 1) this.frame(iframes[f.hi - 1], ix, iy, scale, f.t);
        }
        // --- the damage
        if (broken) {
            const d = arkTex('ark-damage');
            if (d !== null) this.frame(d, wx(L.damage[0]), wy(L.damage[1]), scale, 1);
        }
        // --- the glow layers
        const gs = scale * L.glowScale;
        const breathe = 0.92 + 0.08 * Math.sin(sec * 0.9);
        const hab = arkTex('ark-glow-hab');
        if (hab !== null) this.glow(hab, wx(0), wy(0), gs, (broken ? 0.55 : 1) * breathe, WHITE);
        const band = arkTex('ark-glow-band');
        const slices = band !== null ? framesOf('ark-glow-band', band, sliceRects(band)) : null;
        if (band !== null && slices !== null) {
            const tint = fight ? ([1.0, 0.62, 0.55] as const) : WHITE;
            for (let k = 0; k < slices.length; k++) {
                const al = broken ? arkBandSliceAlpha(k, sec) : breathe;
                const fr = slices[k].frame;
                this.glow(slices[k], wx(fr.x * L.glowScale), wy(0), gs, al, tint);
            }
        }
        const power = mode === 'broken' || rec?.phase === 'escaping' ? Math.max(0.6, arkEnginePower(bo.currentSpeed, bo.topSpeed)) : arkEnginePower(bo.currentSpeed, bo.topSpeed);
        const eng = arkTex('ark-glow-eng');
        if (eng !== null) this.glow(eng, wx(0), wy(0), gs, 0.35 + 0.65 * power, WHITE);
        if (broken) {
            const fire = arkTex('ark-glow-fire');
            if (fire !== null) this.glow(fire, wx(0), wy(0), gs, 0.7 + 0.3 * Math.sin(sec * 11.3) * Math.sin(sec * 4.1), WHITE);
        }
        // --- the engines: brighter aft, plumes while moving
        const plume = arkTex('ark-plume');
        for (let i = 0; i < L.engines.length; i++) {
            const e = L.engines[i];
            const aft = arkEngineAft(e[2], e[3], heading) * power;
            const br = 0.3 + 0.7 * aft;
            const flick = 0.92 + 0.08 * Math.sin(sec * 23 + i * 1.7);
            this.lamp(ENGINE_COL, wx(e[0]), wy(e[1]), (9 + 12 * br) * scale, 1.5, 0.55 + 0.45 * br * flick);
            const l = Math.hypot(e[2], e[3]);
            if (plume !== null && aft > 0.2 && l > 0.4) {
                const s = this.glowPool.acquire(plume);
                s.blendMode = 'add';
                s.anchor.set(0, 0.5);
                s.position.set(wx(e[0]), wy(e[1]));
                s.rotation = Math.atan2(e[3], e[2]);
                const len = (130 + 300 * aft) * l * (0.9 + 0.1 * flick);
                s.scale.set((len * scale) / plume.width, (52 * (0.6 + 0.4 * aft) * scale) / plume.height);
                s.alpha = Math.min(1, 0.9 * aft);
            }
        }
        // --- the lamps: nav (always), strobes (white slow; amber fast in a fight), turrets (firing in a fight)
        for (let i = 0; i < L.nav.length; i++) {
            const t = (((sec + i * 0.61) % 2.4) + 2.4) % 2.4;
            const al = t < 0.5 ? 1 - t / 0.5 : 0;
            if (al > 0.02) this.lamp(NAV_RED, wx(L.nav[i][0]), wy(L.nav[i][1]), 7 * scale, 1.3, al);
        }
        for (let i = 0; i < L.strobes.length; i++) {
            const st = L.strobes[i];
            if (fight) {
                if ((Math.floor(sec * 3) + i) % 2 === 0) this.lamp(AMBER, wx(st[0]), wy(st[1]), 15 * scale, 2.0, 1);
            } else {
                const t = (((sec + i * 0.37) % 3.0) + 3.0) % 3.0;
                if (t < 0.12) this.lamp(WHITE, wx(st[0]), wy(st[1]), 10 * scale, 1.6, 1 - t / 0.12);
            }
        }
        if (fight) {
            const bucket = Math.floor(sec * 8);
            for (let i = 0; i < L.turrets.length; i++) {
                const t = L.turrets[i];
                const h = hash01(bucket, i * 13 + 5);
                if (h > 0.62) this.lamp(MUZZLE, wx(t[0]), wy(t[1]), (6 + 7 * hash01(bucket, i)) * scale, 1.6, 1);
                else this.lamp(TURRET_DIM, wx(t[0]), wy(t[1]), 3.5 * scale, 1.0, 0.7);
            }
        }
        // --- the siphon: the tractor beam toward the target, the stream of passenger ships funnelling into the iris
        const [icx, icy, ax, ay, bx, by, odx, ody] = L.iris;
        let tAng = Math.atan2(ody, odx);
        if (arkTargetPos(rec, this.tgt)) tAng = Math.atan2(this.tgt.y - wy(icy), this.tgt.x - wx(icx));
        if (a.open > 0.35) {
            const k = (a.open - 0.35) / 0.65;
            const beam = arkTex('ark-beam');
            if (beam !== null) {
                for (const [len, wid, al] of [[0.45, 0.17, 1.0], [0.3, 0.08, 0.7]] as const) {
                    const s = this.glowPool.acquire(beam);
                    s.blendMode = 'add';
                    s.anchor.set(0, 0.5);
                    s.position.set(wx(icx), wy(icy));
                    s.rotation = tAng;
                    s.scale.set((len * L.frame * scale) / beam.width, (wid * L.frame * scale) / beam.height);
                    s.alpha = k * al * (0.8 + 0.2 * Math.sin(sec * 2.3));
                }
            }
            this.lamp(DRIVE, wx(icx), wy(icy), 0.05 * L.frame * scale, 4, 0.5 * k);
            for (let i = 0; i < 24; i++) {
                const t = (2 * Math.PI * i) / 24;
                const ph = (((i / 24 - sec / 1.6) % 1) + 1) % 1;
                this.lamp(HEADLIGHT, wx(icx + 1.45 * (ax * Math.cos(t) + bx * Math.sin(t))), wy(icy + 1.45 * (ay * Math.cos(t) + by * Math.sin(t))), 4 * scale, 1.2, k * Math.max(0.15, 1 - ph * 5));
            }
            const ship = px >= ARK_FINE_MIN_PX ? tex(TRANSPORT_URL) : null;
            for (let lane = 0; lane < LANES; lane++) {
                const off = (lane - 1) * 0.16;
                for (let j = 0; j < LANE_SHIPS; j++) {
                    const u = (((j / LANE_SHIPS + sec / 9 + lane * 0.13) % 1) + 1) % 1;
                    const dist = 0.6 * L.frame * (1 - u) ** 1.3;
                    const ang = tAng + off * (1 - u) * 2.2;
                    const fx = icx + dist * Math.cos(ang);
                    const fy = icy + dist * Math.sin(ang);
                    const al = k * Math.min(1, (1 - u) * 6) * Math.min(1, u * 8 + 0.2);
                    if (al <= 0.02) continue;
                    const lenF = 34 * (0.25 + 0.75 * Math.min(1, (1 - u) * 2.5));
                    const hd = ang + Math.PI; // toward the iris
                    if (ship !== null) {
                        const s = this.shipPool.acquire(ship);
                        s.position.set(wx(fx), wy(fy));
                        s.rotation = hd + Math.PI / 2;
                        s.scale.set((lenF * scale) / ship.height);
                        s.alpha = al;
                    }
                    this.lamp(HEADLIGHT, wx(fx + Math.cos(hd) * lenF * 0.4), wy(fy + Math.sin(hd) * lenF * 0.4), 2.5 * scale, 0.8, al);
                    this.lamp(DRIVE, wx(fx - Math.cos(hd) * lenF * 0.45), wy(fy - Math.sin(hd) * lenF * 0.45), 3 * scale, 0.8, 0.7 * al);
                }
            }
        }
        // --- broken: sparks at the hits, smoke trailing away (from the heading while it moves, else drifting out)
        if (broken) {
            const smokeT = px >= ARK_FINE_MIN_PX ? arkTex('ark-smoke') : null;
            const [gx, gy] = L.globe;
            const bucket = Math.floor(sec * 10);
            for (let h = 0; h < L.hits.length; h++) {
                const [hx, hy, hr] = L.hits[h];
                for (let j = 0; j < 4; j++) {
                    if (hash01(bucket, h * 7 + j) < 0.45) continue;
                    const sx = hx + (hash01(bucket + 1, h * 7 + j) - 0.5) * hr * 0.8;
                    const sy = hy + (hash01(bucket + 2, h * 7 + j) - 0.5) * hr * 0.8;
                    this.lamp(SPARK, wx(sx), wy(sy), (3 + 5 * hash01(bucket + 3, h + j)) * scale, 1.0, 1);
                }
                if (smokeT === null) continue;
                let tx = -Math.cos(heading);
                let ty = -Math.sin(heading);
                if (power < 0.05) {
                    const d = Math.hypot(hx - gx, hy - gy) || 1;
                    tx = (hx - gx) / d;
                    ty = (hy - gy) / d;
                }
                for (let j = 0; j < 10; j++) {
                    const t = (((j / 10 + sec / 6 + h * 0.31) % 1) + 1) % 1;
                    const run = (300 + 4 * hr) * t;
                    const s = this.smokePool.acquire(smokeT);
                    s.position.set(wx(hx + tx * run + 30 * Math.sin(j * 2.1 + h) * t), wy(hy + ty * run + 30 * Math.cos(j * 1.7 + h) * t));
                    s.scale.set(((0.8 + 3.0 * t) * hr * 1.7 * scale) / smokeT.width);
                    s.rotation = j * 1.3 + t;
                    s.alpha = Math.min(1, 1.1 * (1 - t) * Math.min(1, t * 6));
                    s.tint = 0x77716c;
                }
            }
        }
        // --- the shield: a shimmer while it fights, a flash where it is hit
        if (!broken && (fight || a.flash > 0)) {
            const shTex = arkTex('ark-shield');
            if (shTex !== null) {
                const [gx, gy, R] = L.globe;
                const s = this.shieldPool.acquire(shTex);
                s.blendMode = 'add';
                s.position.set(wx(gx), wy(gy));
                s.scale.set((2 * 1.62 * R * scale) / shTex.width);
                s.alpha = (fight ? 0.16 + 0.06 * Math.sin(sec * 3.1) : 0) + 0.6 * a.flash;
                if (a.flash > 0) {
                    const rx = gx + 1.5 * R * Math.cos(a.flashAng);
                    const ry = gy + 1.5 * R * Math.sin(a.flashAng);
                    this.lamp(SHIELD_COL, wx(rx), wy(ry), 70 * scale, 6, a.flash);
                    this.lamp(WHITE, wx(rx), wy(ry), 18 * scale, 2, a.flash);
                }
            }
        }
    }

    /** A whole frame-px overlay (its top-left at world (x, y)). */
    private frame(t: Texture, x: number, y: number, scale: number, alpha: number): void {
        const s = this.bodyPool.acquire(t);
        s.anchor.set(0, 0);
        s.position.set(x, y);
        s.scale.set(scale);
        s.alpha = alpha;
    }

    private glow(t: Texture, x: number, y: number, scale: number, alpha: number, tint: readonly [number, number, number]): void {
        if (alpha <= 0.01) return;
        const s = this.glowPool.acquire(t);
        s.blendMode = 'add';
        s.anchor.set(0, 0);
        s.position.set(x, y);
        s.scale.set(scale);
        s.alpha = Math.min(1, alpha);
        s.tint = ((Math.round(tint[0] * 255) << 16) | (Math.round(tint[1] * 255) << 8) | Math.round(tint[2] * 255)) >>> 0;
    }

    /** An additive lamp at world (x, y): core radius `r` world units, held at least `minPx` screen px. */
    private lamp(col: readonly [number, number, number], x: number, y: number, r: number, minPx: number, alpha: number): void {
        if (alpha <= 0.02) return;
        const s = this.lampPool.acquire(lampTexture(col));
        s.blendMode = 'add';
        s.position.set(x, y);
        s.scale.set(Math.max(r, minPx / this.screenK) / LAMP_CORE_PX);
        s.alpha = Math.min(1, alpha);
    }

    /** World units to screen px (the camera's zoom), for the lamps' minimum size; set before the frame's draws. */
    private screenK = 1;
    setScreenScale(worldToScreen: number): void {
        this.screenK = worldToScreen > 0 ? worldToScreen : 1;
    }

    end(): void {
        this.bodyPool.end();
        this.glowPool.end();
        this.smokePool.end();
        this.shipPool.end();
        this.lampPool.end();
        this.shieldPool.end();
        for (const [bo, a] of this.anims) if (!a.seen && bo.hasBeenDestroyed) this.anims.delete(bo);
    }
}
