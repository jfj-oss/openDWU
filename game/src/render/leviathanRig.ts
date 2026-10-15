// The Leviathan's rig (Void Whale threat): the baked top-down parts of leviathanArt.ts on a rope body (head along +x,
// turned with the heading like every creature). Per frame only transforms and rope points move — a slow heavy body
// wave sweeping the broad flukes side to side, both pectoral fins rowing slowly, and a hyper-lunge flash with light
// streaks and expanding ripples (the mouth never opens). Render only; reads nothing from the sim.

import { Container, MeshRope, Point, Sprite, type Texture } from 'pixi.js';
import { halveRgba, textureFromRgba, upscaleRgba, type BackPoint, type RgbaImage } from './creatureRig';
import {
    LEV_FIN_ROOT,
    LEV_H,
    LEV_W,
    LEV_X0,
    LEV_X1,
    glowRgba,
    paintLeviathanBody,
    paintLeviathanFin,
    paintLeviathanFluke,
    rippleRgba,
    streakRgba,
} from './leviathanArt';

export interface LeviathanTextures {
    body: Texture;
    bodyImg: RgbaImage;
    lumin: Texture;
    fin: Texture;
    finTorn: Texture;
    fluke: Texture;
    glow: Texture;
    ripple: Texture;
    streak: Texture;
}

/**
 * The hide, fins, fluke and wounds keep only half the painted resolution's detail (halved, then scaled back to the
 * painted size so every part keeps its drawn size): about the pixel count of a large space port's art (≈ 510 × 510), so
 * the beast is no sharper than the original ships and stations beside it.
 */
export function leviathanPartTexture(img: RgbaImage): Texture {
    return textureFromRgba(upscaleRgba(halveRgba(img), img.w, img.h));
}

/** Bakes every part once (~0.5 s of pure raster work). */
export function leviathanTextures(): LeviathanTextures {
    const b = paintLeviathanBody();
    return {
        body: leviathanPartTexture(b.body),
        bodyImg: b.body,
        lumin: leviathanPartTexture(b.lumin),
        fin: leviathanPartTexture(paintLeviathanFin(6, false, 0.9)),
        finTorn: leviathanPartTexture(paintLeviathanFin(5, true, 0.9)),
        fluke: leviathanPartTexture(paintLeviathanFluke()),
        glow: textureFromRgba(glowRgba(128, [255, 255, 255], [150, 220, 255])),
        ripple: textureFromRgba(rippleRgba(512)),
        streak: textureFromRgba(streakRgba(256, 16)),
    };
}

/** Seconds of one tail beat. */
export const LEV_BEAT_S = 8.5;
const SEGMENTS = 30;
const CY = LEV_H / 2;
const STREAKS = 7;

export class LeviathanRig {
    readonly root = new Container();
    private readonly inner = new Container();
    private readonly points: Point[] = [];
    private readonly body: MeshRope;
    private readonly lumin: MeshRope;
    private damageRope: MeshRope | null = null;
    /** Left (torn) and right pectoral fins. */
    private readonly finL: Sprite;
    private readonly finR: Sprite;
    private readonly fluke: Sprite;
    private readonly glow: Sprite;
    private readonly ripples: Sprite[] = [];
    private readonly streaks: Sprite[] = [];
    /** 0..1 white-hot flash (a hyper-lunge); set by the creature layer. */
    flash = 0;
    /** Hyper-lunge progress 0..1 (ripple and streaks), or −1 when not jumping. */
    jumpT = -1;
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
        this.finL = sprite(tex.finTorn, 0, 0.5);
        this.finR = sprite(tex.fin, 0, 0.5);
        this.finL.scale.y = -1; // mirrored: its knobbly leading edge faces forward on the left flank too
        this.fluke = sprite(tex.fluke, 0, 0.5);
        this.body = new MeshRope({ texture: tex.body, points: this.points });
        this.lumin = new MeshRope({ texture: tex.lumin, points: this.points });
        this.lumin.blendMode = 'add';
        this.glow = sprite(tex.glow, 0.5, 0.5, true);
        this.glow.alpha = 0;
        // Under the body: fins and fluke.
        this.inner.addChild(this.finL, this.finR, this.fluke, this.body, this.lumin, this.glow);
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
        // Flukes: on the tail tip, following the stalk with a lag, sweeping side to side.
        const tail = this.carried(LEV_X0 + 4, CY);
        const p0 = this.backPoint(LEV_X0 / LEV_W);
        const p1 = this.backPoint((LEV_X0 + 60) / LEV_W);
        const back = Math.atan2(p0.y - p1.y, p0.x - p1.x);
        const stroke = Math.sin(w * t + ph - 1.0);
        this.fluke.position.set(tail.x, tail.y);
        this.fluke.rotation = back + 0.22 * amp * stroke;
        // Pectoral fins: swept back and out from each flank, rowing slowly out of step.
        const fl = this.carried(LEV_FIN_ROOT[0], LEV_FIN_ROOT[1]);
        const fr = this.carried(LEV_FIN_ROOT[0], LEV_H - LEV_FIN_ROOT[1]);
        const row = w * 0.8 * t + ph;
        this.finL.position.set(fl.x, fl.y);
        this.finL.rotation = fl.ang + Math.PI + 0.8 + 0.12 * Math.sin(row);
        this.finR.position.set(fr.x, fr.y);
        this.finR.rotation = fr.ang + Math.PI - 0.8 - 0.12 * Math.sin(row + 1.4);
        // Bioluminescence breathes slowly; it flares in the flash.
        this.lumin.alpha = Math.min(1, 0.5 + 0.2 * Math.sin(t * 0.9 + ph) + flash);
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
