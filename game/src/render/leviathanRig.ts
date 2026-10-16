// The Leviathan's rig (Void Whale threat): the cut parts of the Leviathan picture (leviathanArt.ts / leviathanParts.ts)
// on a rope body (head along +x, turned with the heading like every creature). Everything is baked once; per frame
// only rope points, transforms and alphas move — a slow swim: a travelling wave flexes the body from head to tail, the
// flukes sweep side to side (foreshortening a little through the stroke), the long pectoral fins row slowly, and the
// glowing head dots and spine beads pulse softly in a ripple running from the snout to the tail (the mouth never opens).
// The old harpoons stuck in it (leviathanParts.ts LEV_HARPOONS) are pinned to their part each frame: on the body they
// ride the bent rope at their entry point, on a fin or the flukes they turn and stretch with that sprite; each shaft
// trembles a little with the stroke and its line trails behind, swaying in a wave that runs down it.
// Its hyperjumps play the original game's hyper enter / exit flares (effectsLayer.ts playHyperFlare, cued by the
// creature layer). Render only; reads nothing from the sim.

import { Container, MeshRope, Point, Sprite, type Texture } from 'pixi.js';
import { smoothstep, textureFromRgba, type BackPoint, type RgbaImage } from './creatureRig';
import {
    LEV_H,
    LEV_PARTS,
    LEV_W,
    LEV_X0,
    LEV_X1,
    cropRgba,
    glowRgba,
    leviathanPartSilhouette,
    leviathanSilhouette,
} from './leviathanArt';
import { LEV_GLOW_SPOTS, LEV_HARPOONS, type LevHarpoon } from './leviathanParts';

/** The decoded part pictures (public/art/leviathan/), or null to show plain dark silhouettes. */
export interface LeviathanImages {
    body: RgbaImage;
    finL: RgbaImage;
    finR: RgbaImage;
    fluke: RgbaImage;
    /** The harpoon atlas (LEV_HARPOONS frames). */
    harpoons: RgbaImage;
}

export interface LeviathanTextures {
    body: Texture;
    bodyImg: RgbaImage;
    finL: Texture;
    finR: Texture;
    fluke: Texture;
    /** A soft blue-white dot: the pulsing glow of each head dot and spine bead. */
    dot: Texture;
    /** Per LEV_HARPOONS entry: the harpoon and its trailing line (none without the pictures). */
    harpoons: { shaft: Texture; line: Texture | null }[];
}

/**
 * The texture of a body-sized raster (the hide, the wound overlay): the parts are already cut at about the pixel count
 * of a large space port's art, so the beast is no sharper than the original ships and stations beside it.
 */
export function leviathanPartTexture(img: RgbaImage): Texture {
    return textureFromRgba(img);
}

/** Builds every texture once. */
export function leviathanTextures(imgs: LeviathanImages | null): LeviathanTextures {
    const body = imgs?.body ?? leviathanSilhouette();
    return {
        body: leviathanPartTexture(body),
        bodyImg: body,
        finL: textureFromRgba(imgs?.finL ?? leviathanPartSilhouette(LEV_PARTS.finL)),
        finR: textureFromRgba(imgs?.finR ?? leviathanPartSilhouette(LEV_PARTS.finR)),
        fluke: textureFromRgba(imgs?.fluke ?? leviathanPartSilhouette(LEV_PARTS.fluke)),
        dot: textureFromRgba(glowRgba(32, [214, 238, 255], [70, 140, 230])),
        harpoons: imgs === null ? [] : LEV_HARPOONS.map((h) => ({
            shaft: textureFromRgba(cropRgba(imgs.harpoons, h.fx, h.fy, h.fw, h.fh)),
            line: h.line === null ? null : textureFromRgba(cropRgba(imgs.harpoons, h.line.fx, h.line.fy, h.line.fw, h.line.fh)),
        })),
    };
}

/** Seconds of one tail beat. */
export const LEV_BEAT_S = 8;
/** Seconds for the glow ripple to run from snout to tail. */
export const LEV_GLOW_S = 3.2;
/** The flukes' sweep and the pectoral fins' rowing swing (rad, at full speed): the parts' joins are cut to cover them
 * (scripts/leviathan-parts.py). */
export const LEV_FLUKE_SWEEP = 0.26;
export const LEV_FIN_SWEEP = 0.16;
const SEGMENTS = 30;
const CY = LEV_H / 2;
/** Points along each harpoon's trailing line. */
const LINE_POINTS = 10;

/** `a` turned toward `b` by the fraction k (the short way round). */
function turn(a: number, b: number, k: number): number {
    const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + d * k;
}

/** A harpoon of the rig: its sprite and its line's rope (points in the rig's frame). */
interface HarpoonView {
    def: LevHarpoon;
    shaft: Sprite;
    line: MeshRope | null;
    points: Point[];
}

/** Glow pulse 0..1 of a dot at texture x `x` at time t (s): a soft travelling ripple from the snout to the tail. Pure. */
export function leviathanGlowPulse(x: number, t: number, phase = 0): number {
    const along = (LEV_X1 - x) / (LEV_X1 - LEV_X0);
    const w = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / LEV_GLOW_S + phase - along * 2 * Math.PI * 1.4);
    return w * w;
}

export class LeviathanRig {
    readonly root = new Container();
    private readonly inner = new Container();
    private readonly points: Point[] = [];
    private readonly body: MeshRope;
    private damageRope: MeshRope | null = null;
    private readonly finL: Sprite;
    private readonly finR: Sprite;
    private readonly fluke: Sprite;
    private readonly dots: Sprite[] = [];
    private readonly glowLayer = new Container();
    private readonly harpoonLayer = new Container();
    private readonly harpoons: HarpoonView[] = [];
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
        this.finL = sprite(tex.finL, LEV_PARTS.finL.ax, LEV_PARTS.finL.ay);
        this.finR = sprite(tex.finR, LEV_PARTS.finR.ax, LEV_PARTS.finR.ay);
        this.fluke = sprite(tex.fluke, LEV_PARTS.fluke.ax, LEV_PARTS.fluke.ay);
        this.body = new MeshRope({ texture: tex.body, points: this.points });
        for (const g of LEV_GLOW_SPOTS) {
            const s = sprite(tex.dot, 0.5, 0.5, true);
            // The halo reaches ~3x the dot.
            s.scale.set((g.rx * 6) / tex.dot.width, (g.ry * 6) / tex.dot.height);
            this.dots.push(s);
            this.glowLayer.addChild(s);
        }
        LEV_HARPOONS.forEach((def, i) => {
            const t = tex.harpoons[i];
            if (t === undefined) return;
            const shaft = sprite(t.shaft, def.ax, def.ay);
            const points: Point[] = [];
            let line: MeshRope | null = null;
            if (t.line !== null && def.line !== null) {
                for (let k = 0; k < LINE_POINTS; k++) points.push(new Point((k / (LINE_POINTS - 1)) * def.line.len, 0));
                line = new MeshRope({ texture: t.line, points });
                this.harpoonLayer.addChild(line);
            }
            this.harpoons.push({ def, shaft, line, points });
        });
        // Lines under the shafts.
        for (const h of this.harpoons) this.harpoonLayer.addChild(h.shaft);
        // Under the body: fins and flukes; over it: the wounds (setDamage), the harpoons, then the glows.
        this.inner.addChild(this.finL, this.finR, this.fluke, this.body, this.harpoonLayer, this.glowLayer);
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
        const amp = 0.5 + 0.5 * speed01;
        const n = this.points.length;
        // The swim: a wave travelling from the head to the tail, growing toward the tail, with a gentle head sway.
        for (let i = 0; i < n; i++) {
            const s = i / (n - 1);
            const env = Math.pow(1 - s, 2.2) * 0.05 * LEV_W * amp + 0.004 * LEV_W;
            const y = env * Math.sin(2 * Math.PI * 0.7 * s + w * t + ph) + 0.004 * LEV_W * Math.sin(w * t * 0.5 + ph);
            this.points[i].set((s - 0.5) * LEV_W, y);
        }
        // Flukes: on the tail tip, following the stalk with a lag, sweeping side to side; the blade foreshortens
        // through the stroke as it pitches.
        const fp = LEV_PARTS.fluke;
        const tail = this.carried(fp.rootX, fp.rootY);
        const stroke = Math.sin(w * t + ph - 0.9);
        this.fluke.position.set(tail.x, tail.y);
        this.fluke.rotation = tail.ang + LEV_FLUKE_SWEEP * amp * stroke;
        this.fluke.scale.set(1 - 0.12 * amp * stroke * stroke, 1 - 0.03 * amp * Math.abs(stroke));
        // Pectoral fins: rowing slowly, swept forward and back together (mirrored), a little out of step.
        const row = w * 0.75 * t + ph;
        const fl = this.carried(LEV_PARTS.finL.rootX, LEV_PARTS.finL.rootY);
        const fr = this.carried(LEV_PARTS.finR.rootX, LEV_PARTS.finR.rootY);
        const sweepL = LEV_FIN_SWEEP * Math.sin(row) * amp;
        const sweepR = LEV_FIN_SWEEP * Math.sin(row + 0.35) * amp;
        this.finL.position.set(fl.x, fl.y);
        this.finL.rotation = fl.ang + sweepL;
        this.finR.position.set(fr.x, fr.y);
        this.finR.rotation = fr.ang - sweepR;
        // Swept forward the fin lies flatter (longer seen from above); swept back it tips down a little.
        this.finL.scale.set(1 + 0.04 * Math.sin(row));
        this.finR.scale.set(1 + 0.04 * Math.sin(row + 0.35));
        this.poseHarpoons(t, w, ph, amp);
        // The glowing dots and beads: a soft ripple from the snout to the tail.
        for (let i = 0; i < this.dots.length; i++) {
            const g = LEV_GLOW_SPOTS[i];
            const d = this.dots[i];
            const at = this.carried(g.x, g.y);
            d.position.set(at.x, at.y);
            d.rotation = at.ang;
            d.alpha = Math.min(1, (g.kind === 'spine' ? 0.12 : 0.1) + 0.28 * leviathanGlowPulse(g.x, t, ph));
        }
    }

    /** A point (and a direction) on a part at rest carried to its posed place: the body rope, or a fin / the flukes. */
    private onPart(part: LevHarpoon['part'], x: number, y: number, ang: number): { x: number; y: number; ang: number; back: number } {
        if (part === 'body') {
            const at = this.carried(x, y);
            return { x: at.x, y: at.y, ang: at.ang + ang, back: at.ang + Math.PI };
        }
        const p = LEV_PARTS[part];
        const s = part === 'finL' ? this.finL : part === 'finR' ? this.finR : this.fluke;
        const c = Math.cos(s.rotation);
        const sn = Math.sin(s.rotation);
        const ox = (x - p.rootX) * s.scale.x;
        const oy = (y - p.rootY) * s.scale.y;
        const dx = Math.cos(ang) * s.scale.x;
        const dy = Math.sin(ang) * s.scale.y;
        const tail = this.carried(LEV_X0, CY);
        return {
            x: s.position.x + ox * c - oy * sn,
            y: s.position.y + ox * sn + oy * c,
            ang: Math.atan2(dx * sn + dy * c, dx * c - dy * sn),
            back: (part === 'fluke' ? tail.ang : this.carried(p.rootX, CY).ang) + Math.PI,
        };
    }

    /** The harpoons ride their parts, trembling a little; their lines trail behind in a wave running down them. */
    private poseHarpoons(t: number, w: number, ph: number, amp: number): void {
        for (let i = 0; i < this.harpoons.length; i++) {
            const h = this.harpoons[i];
            const d = h.def;
            const at = this.onPart(d.part, d.x, d.y, d.ang);
            const ang = at.ang + 0.02 * amp * Math.sin(w * 1.9 * t + ph + i * 1.7);
            h.shaft.position.set(at.x, at.y);
            h.shaft.rotation = ang;
            if (h.line === null || d.line === null) continue;
            // From the tie on the shaft: leaving along the shaft, bending back along the body, swaying.
            let x = at.x + Math.cos(ang) * d.attach;
            let y = at.y + Math.sin(ang) * d.attach;
            const seg = d.line.len / (LINE_POINTS - 1);
            h.points[0].set(x, y);
            for (let k = 1; k < LINE_POINTS; k++) {
                const s = k / (LINE_POINTS - 1);
                const sway = (0.12 + 0.3 * amp) * Math.pow(s, 1.3) * Math.sin(w * 1.15 * t + ph + i * 2.3 - 3.2 * s);
                const a = turn(ang, at.back, 0.85 * smoothstep(0, 0.75, s)) + sway;
                x += Math.cos(a) * seg;
                y += Math.sin(a) * seg;
                h.points[k].set(x, y);
            }
        }
    }
}
