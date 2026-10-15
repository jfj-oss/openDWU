// The Leviathan's rig (Void Whale threat): the baked profile parts of leviathanArt.ts on a rope body. Per frame only
// transforms and rope points move — a slow heavy tail beat travelling down the body (whales beat their flukes up and
// down, which in profile is exactly the rope's bend), drifting pectoral fins, the jaw gaping on a swallow (maw and
// throat glow revealed), a hyper-lunge flash with an expanding ripple and light streaks, and a slow roll that keeps the
// belly down on screen when it turns to swim leftward. Render only; reads nothing from the sim.

import { Container, MeshRope, Point, Sprite, type Texture } from 'pixi.js';
import { textureFromRgba, type BackPoint, type RgbaImage } from './creatureRig';
import {
    JAW_HINGE,
    JAW_H,
    JAW_W,
    LEV_FAR_FIN_ROOT,
    LEV_FIN_ROOT,
    LEV_H,
    LEV_HINGE,
    LEV_W,
    LEV_X0,
    LEV_X1,
    MAW_ANGLE,
    glowRgba,
    paintLeviathanBody,
    paintLeviathanFin,
    paintLeviathanFluke,
    paintLeviathanJaw,
    paintLeviathanMaw,
    rippleRgba,
    streakRgba,
} from './leviathanArt';

export interface LeviathanTextures {
    body: Texture;
    bodyImg: RgbaImage;
    lumin: Texture;
    jaw: Texture;
    maw: Texture;
    fin: Texture;
    farFin: Texture;
    fluke: Texture;
    glow: Texture;
    throat: Texture;
    ripple: Texture;
    streak: Texture;
}

/** Bakes every part once (~0.5 s of pure raster work). */
export function leviathanTextures(): LeviathanTextures {
    const b = paintLeviathanBody();
    return {
        body: textureFromRgba(b.body),
        bodyImg: b.body,
        lumin: textureFromRgba(b.lumin),
        jaw: textureFromRgba(paintLeviathanJaw()),
        maw: textureFromRgba(paintLeviathanMaw()),
        fin: textureFromRgba(paintLeviathanFin(5, true, 1)),
        farFin: textureFromRgba(paintLeviathanFin(6, false, 0.5)),
        fluke: textureFromRgba(paintLeviathanFluke()),
        glow: textureFromRgba(glowRgba(128, [255, 255, 255], [150, 220, 255])),
        throat: textureFromRgba(glowRgba(96, [255, 170, 130], [200, 20, 30])),
        ripple: textureFromRgba(rippleRgba(512)),
        streak: textureFromRgba(streakRgba(256, 16)),
    };
}

/** Jaw gape (rad) at jawOpen 1. */
export const LEV_GAPE = 0.62;
/** Seconds of one tail beat. */
export const LEV_BEAT_S = 8.5;
const SEGMENTS = 30;
const CY = LEV_H / 2;
const STREAKS = 7;

/** Which way up the profile is drawn for a heading (rad): +1 belly down when swimming rightward, −1 leftward. A small
 * hysteresis around vertical keeps it from flickering. Pure. */
export function leviathanFacing(heading: number, prev: number): number {
    const c = Math.cos(heading);
    if (c > 0.12) return 1;
    if (c < -0.12) return -1;
    return prev >= 0 ? 1 : -1;
}

export class LeviathanRig {
    readonly root = new Container();
    /** Mirrored (scale.y) for the belly-down roll. */
    private readonly inner = new Container();
    private readonly points: Point[] = [];
    private readonly body: MeshRope;
    private readonly lumin: MeshRope;
    private damageRope: MeshRope | null = null;
    private readonly jaw: Sprite;
    private readonly maw: Sprite;
    private readonly throat: Sprite;
    private readonly fin: Sprite;
    private readonly farFin: Sprite;
    private readonly fluke: Sprite;
    private readonly glow: Sprite;
    private readonly ripples: Sprite[] = [];
    private readonly streaks: Sprite[] = [];
    /** 0 closed .. 1 wide open; set by the creature layer. */
    jawOpen = 0;
    /** 0..1 white-hot flash (a hyper-lunge); set by the creature layer. */
    flash = 0;
    /** Hyper-lunge progress 0..1 (ripple and streaks), or −1 when not jumping. */
    jumpT = -1;
    private facing = 1;
    private roll = 1;
    private lastT = -1;
    /** Body length in local units (the drawn width the layer scales to). */
    readonly length = LEV_W;
    readonly width = LEV_H;

    constructor(private readonly tex: LeviathanTextures, private readonly phase: number) {
        this.root.eventMode = 'none';
        this.root.addChild(this.inner);
        for (let i = 0; i < SEGMENTS; i++) this.points.push(new Point((i / (SEGMENTS - 1) - 0.5) * LEV_W, 0));
        const sprite = (t: Texture, ax: number, ay: number, add = false): Sprite => {
            const s = new Sprite(t);
            s.anchor.set(ax, ay);
            if (add) s.blendMode = 'add';
            return s;
        };
        this.farFin = sprite(tex.farFin, 0, 0.5);
        this.fluke = sprite(tex.fluke, 0, 0.5);
        this.maw = sprite(tex.maw, 0, 0);
        this.throat = sprite(tex.throat, 0.5, 0.5, true);
        this.body = new MeshRope({ texture: tex.body, points: this.points });
        this.lumin = new MeshRope({ texture: tex.lumin, points: this.points });
        this.lumin.blendMode = 'add';
        this.jaw = sprite(tex.jaw, JAW_HINGE[0] / JAW_W, JAW_HINGE[1] / JAW_H);
        this.fin = sprite(tex.fin, 0, 0.5);
        this.glow = sprite(tex.glow, 0.5, 0.5, true);
        this.glow.alpha = 0;
        this.inner.addChild(this.farFin, this.fluke, this.maw, this.throat, this.body, this.lumin, this.jaw, this.fin, this.glow);
        for (let i = 0; i < 2; i++) {
            const r = sprite(tex.ripple, 0.5, 0.5, true);
            r.alpha = 0;
            this.ripples.push(r);
            this.inner.addChild(r);
        }
        for (let i = 0; i < STREAKS; i++) {
            const s = sprite(tex.streak, 1, 0.5, true);
            s.alpha = 0;
            this.streaks.push(s);
            this.inner.addChild(s);
        }
    }

    /** The body raster (the wound overlay's mask). */
    get bodyImage(): RgbaImage {
        return this.tex.bodyImg;
    }

    get periodS(): number {
        return LEV_BEAT_S;
    }

    /** Shows `tex` (wounds in body-texture space, same size as the body) over the hide, or removes it (null). */
    setDamage(tex: Texture | null): void {
        if (tex === null) {
            this.damageRope?.destroy();
            this.damageRope = null;
            return;
        }
        if (this.damageRope === null) {
            this.damageRope = new MeshRope({ texture: tex, points: this.points });
            this.inner.addChildAt(this.damageRope, this.inner.getChildIndex(this.body) + 1);
        } else if (this.damageRope.texture !== tex) this.damageRope.texture = tex;
    }

    /** The heading the layer draws it at (rad): sets which way up the profile is. */
    face(heading: number): void {
        this.facing = leviathanFacing(heading, this.facing);
    }

    /** Centreline point at texture-x fraction u (0 tail end of the texture … 1 snout end). */
    backPoint(u: number): BackPoint {
        const n = this.points.length;
        const si = Math.max(0, Math.min(n - 1.0001, u * (n - 1)));
        const j = Math.floor(si);
        const a = this.points[j];
        const b = this.points[Math.min(n - 1, j + 1)];
        const k = si - j;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }

    /** A texture-space point (px) carried by the bent body: position and local angle. */
    private carried(tx: number, ty: number): { x: number; y: number; ang: number } {
        const bp = this.backPoint(tx / LEV_W);
        const off = ty - CY;
        return { x: bp.x - Math.sin(bp.ang) * off, y: bp.y + Math.cos(bp.ang) * off, ang: bp.ang };
    }

    /** Pose at time t (s); `speed01` damps the beat when it idles. */
    pose(t: number, speed01 = 1): void {
        const dt = this.lastT < 0 ? 10 : Math.max(0, Math.min(0.25, t - this.lastT));
        this.lastT = t;
        // The roll toward belly-down: through zero (edge-on) over ~1 s.
        this.roll += Math.sign(this.facing - this.roll) * Math.min(Math.abs(this.facing - this.roll), dt * 2.2);
        const w = (2 * Math.PI) / LEV_BEAT_S;
        const ph = this.phase;
        const amp = 0.45 + 0.55 * speed01;
        const flash = Math.max(0, Math.min(1, this.flash));
        // Hyper-lunge: the whole body stretches forward.
        const stretch = 1 + 0.28 * flash;
        const n = this.points.length;
        for (let i = 0; i < n; i++) {
            const s = i / (n - 1);
            const env = Math.pow(1 - s, 2.3) * 0.12 * LEV_H * amp + 0.006 * LEV_H;
            const y = env * Math.sin(2 * Math.PI * 0.55 * s + w * t + ph) + 0.008 * LEV_H * Math.sin(w * t * 0.5 + ph);
            this.points[i].set((s - 0.5) * LEV_W * stretch, y);
        }
        this.inner.scale.y = this.roll;
        // Fluke: on the tail tip, following the stalk with a lag, its lobes foreshortening with the stroke.
        const tail = this.carried(LEV_X0 + 4, CY);
        const p0 = this.backPoint(LEV_X0 / LEV_W);
        const p1 = this.backPoint((LEV_X0 + 60) / LEV_W);
        const back = Math.atan2(p0.y - p1.y, p0.x - p1.x);
        const stroke = Math.sin(w * t + ph - 1.0);
        this.fluke.position.set(tail.x, tail.y);
        this.fluke.rotation = back + 0.18 * amp * stroke;
        this.fluke.scale.set(1, 0.72 + 0.22 * Math.abs(Math.cos(w * t + ph - 1.0)));
        // Pectoral fins: swept back and down, slow drifting strokes.
        const fr = this.carried(LEV_FIN_ROOT[0], LEV_FIN_ROOT[1]);
        this.fin.position.set(fr.x, fr.y);
        this.fin.rotation = fr.ang + Math.PI - 0.5 + 0.13 * Math.sin(w * t * 0.8 + ph + 0.6);
        const ff = this.carried(LEV_FAR_FIN_ROOT[0], LEV_FAR_FIN_ROOT[1]);
        this.farFin.position.set(ff.x, ff.y);
        this.farFin.rotation = ff.ang + Math.PI - 0.72 + 0.13 * Math.sin(w * t * 0.8 + ph + 2.2);
        // The jaw: hinged under the head; the maw wedge and the throat glow fill the gape.
        const open = Math.max(0, Math.min(1, this.jawOpen));
        const gape = open * LEV_GAPE;
        const hinge = this.carried(LEV_HINGE[0], LEV_HINGE[1]);
        this.jaw.position.set(hinge.x, hinge.y);
        this.jaw.rotation = hinge.ang + gape + 0.02 * Math.sin(w * t * 1.3 + ph);
        this.maw.visible = open > 0.01;
        this.maw.position.set(hinge.x, hinge.y);
        this.maw.rotation = hinge.ang;
        this.maw.scale.set(1, Math.tan(gape) / Math.tan(MAW_ANGLE));
        const thr = this.carried(LEV_HINGE[0] + 120, LEV_HINGE[1] + 40 * open);
        this.throat.position.set(thr.x, thr.y);
        this.throat.scale.set((80 + 360 * open) / this.throat.texture.width);
        this.throat.alpha = open * 0.9;
        // Bioluminescence breathes slowly; it flares as the jaw opens and in the flash.
        this.lumin.alpha = Math.min(1, 0.55 + 0.25 * Math.sin(t * 0.9 + ph) + 0.4 * open + flash);
        // The hyper-lunge: a white-hot body glow, light streaks dragged back along it, two ripples rolling out.
        const mid = this.carried((LEV_X0 + LEV_X1) / 2, CY - 20);
        this.glow.position.set(mid.x, mid.y);
        this.glow.rotation = mid.ang;
        this.glow.scale.set((LEV_W * 1.5 * stretch) / this.glow.texture.width, (LEV_H * 1.2) / this.glow.texture.height);
        this.glow.alpha = flash;
        const jt = this.jumpT;
        for (let i = 0; i < STREAKS; i++) {
            const s = this.streaks[i];
            const ty = CY + (i / (STREAKS - 1) - 0.5) * LEV_H * 0.6;
            const at = this.carried(LEV_X1 * (0.55 + 0.4 * ((i * 37) % 7) / 7), ty);
            s.position.set(at.x, at.y);
            s.rotation = at.ang;
            s.scale.set((LEV_W * (0.8 + 0.9 * flash) * (0.6 + 0.4 * (((i * 53) % 5) / 5))) / s.texture.width, 1.6);
            s.alpha = flash * 0.9;
        }
        for (let i = 0; i < this.ripples.length; i++) {
            const r = this.ripples[i];
            const k = jt < 0 ? -1 : jt - i * 0.18;
            if (k <= 0 || k >= 1) {
                r.alpha = 0;
                continue;
            }
            const ease = 1 - Math.pow(1 - k, 2.5);
            r.position.set(mid.x, mid.y);
            r.scale.set((LEV_W * (0.5 + 2.6 * ease)) / r.texture.width);
            r.alpha = (1 - k) * (i === 0 ? 1 : 0.6);
        }
    }
}
