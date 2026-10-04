// [dw2overlays] Small shared pieces of the Improvements map overlays (resourceOverlay.ts, colonyScoreOverlay.ts,
// fuelOverlay.ts): the resource icons as textures, a pooled sprite container, and the drawn size of a habitat.
//
// The resource icons are the original's /assets/dwu/images/ui/resources/Resource_<PictureRef>.bmp (24-bit BMPs on a flat
// (21, 21, 28) background, as the InfoPanel shows them). On the map that background is keyed out at load time into a
// runtime canvas (our own composite; nothing is copied into the repo).

import { Container, Sprite, Texture } from 'pixi.js';
import type { Habitat } from '../sim/types';
import { HabitatCategoryType } from '../sim/types';
import { moonDotPx, planetSpritePx, starSpritePx } from './mainView';

/** ui/hud.ts resourceIconUrl (not imported: hud.ts pulls the whole HUD). */
export function resourceIconUrl(pictureRef: number): string {
    return `/assets/dwu/images/ui/resources/Resource_${pictureRef}.bmp`;
}

/** The icons' flat background (the BMPs' corner colour). */
export const RESOURCE_ICON_KEY_RGB: readonly [number, number, number] = [21, 21, 28];

/** Alpha for one pixel of a keyed icon: 0 on the background colour, ramping up over a few levels around it. */
export function keyedAlpha(r: number, g: number, b: number, key: readonly [number, number, number] = RESOURCE_ICON_KEY_RGB): number {
    const d = Math.max(Math.abs(r - key[0]), Math.abs(g - key[1]), Math.abs(b - key[2]));
    if (d <= 6) return 0;
    if (d >= 24) return 255;
    return Math.round(((d - 6) / 18) * 255);
}

const iconTextures = new Map<number, Texture | null>();
const iconWaiters = new Map<number, (() => void)[]>();

/** The keyed texture of a resource icon, or null while it loads (or when it cannot: headless, missing art).
 * `onReady` runs once when a pending one arrives. */
export function resourceIconTexture(pictureRef: number, onReady?: () => void): Texture | null {
    const have = iconTextures.get(pictureRef);
    if (have !== undefined) return have;
    if (onReady !== undefined) {
        const w = iconWaiters.get(pictureRef);
        if (w !== undefined) {
            w.push(onReady);
            return null;
        }
    }
    if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
    if (iconWaiters.has(pictureRef)) return null;
    iconWaiters.set(pictureRef, onReady !== undefined ? [onReady] : []);
    const img = new Image();
    const done = (tex: Texture | null): void => {
        img.onload = img.onerror = null;
        iconTextures.set(pictureRef, tex);
        const w = iconWaiters.get(pictureRef) ?? [];
        iconWaiters.delete(pictureRef);
        for (const fn of w) fn();
    };
    img.onload = () => {
        try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            if (ctx === null) return done(null);
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, c.width, c.height);
            const px = data.data;
            for (let i = 0; i < px.length; i += 4) px[i + 3] = keyedAlpha(px[i], px[i + 1], px[i + 2]);
            ctx.putImageData(data, 0, 0);
            done(Texture.from(c));
        } catch {
            done(null);
        }
    };
    img.onerror = () => done(null);
    img.src = resourceIconUrl(pictureRef);
    return null;
}

let ringTex: Texture | null = null;
/** A 64 px anti-aliased white ring (6 px wide), tinted per use; our own procedural art. Null headless. */
export function ringTexture(): Texture | null {
    if (ringTex !== null) return ringTex;
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx === null) return null;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.stroke();
    ringTex = Texture.from(c);
    return ringTex;
}

/** Sprites reused frame to frame: take() the next one, end() hides the rest. */
export class SpritePool {
    readonly root = new Container();
    private sprites: Sprite[] = [];
    private n = 0;
    begin(): void {
        this.n = 0;
    }
    take(tex: Texture): Sprite {
        let s = this.sprites[this.n];
        if (s === undefined) {
            s = new Sprite(tex);
            s.anchor.set(0.5);
            this.sprites.push(s);
            this.root.addChild(s);
        } else if (s.texture !== tex) s.texture = tex;
        s.visible = true;
        this.n++;
        return s;
    }
    end(): number {
        for (let i = this.n; i < this.sprites.length; i++) this.sprites[i].visible = false;
        this.root.visible = this.n > 0;
        return this.n;
    }
    get count(): number {
        return this.n;
    }
}

/** A sprite `px` screen pixels wide (height by the texture's aspect) at zoom z. */
export function sizeSprite(s: Sprite, px: number, z: number): void {
    const w = s.texture.width || 1;
    const k = px / z / w;
    s.scale.set(k, k);
}

/** The habitat's drawn size in screen px at zoom z (MainView's per-category size functions; overlayLayer.ts drawnPx). */
export function drawnHabitatPx(h: Habitat, z: number): number {
    if (h.category === HabitatCategoryType.Star) return starSpritePx(h.diameter, z);
    if (h.category === HabitatCategoryType.Moon) return moonDotPx(h.diameter, z);
    return planetSpritePx(h.diameter, z);
}
